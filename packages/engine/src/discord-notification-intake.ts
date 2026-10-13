import type { SignalEventInput, SignalIdentityClaims } from "../../contracts/src/index.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, type YoinkDatabase } from "../../database/src/database.js";
import {
  DiscordNotificationRepository,
  type DiscordTrace
} from "../../database/src/discord-notification-repository.js";
import { runWithRequestScope, type RequestScope } from "../../database/src/request-scope.js";
import { SignalProviderRepository } from "../../database/src/signal-provider-repository.js";
import { cleanText } from "../../domain/src/normalize.js";
import { sanitizeDiagnosticData } from "../../domain/src/redaction.js";
import {
  DISCORD_NOTIFICATION_PARSER_VERSION,
  discordNotificationSignalId,
  readDiscordNotification,
  type DiscordNotificationFacts,
  type DiscordToast
} from "../../sources/src/discord-notification.js";
import type { DurableSignalIngressService } from "./signal-ingress.js";

/** One Discord notification as Windows showed it. */
export interface CapturedDiscordNotification {
  /** Stable across re-reads of the same Windows notification. */
  reference: string;
  /** When Windows received it (epoch ms). */
  arrivedAt: number;
  toast: DiscordToast;
}

export type DiscordIntakeOutcome = "call" | "duplicate" | "ignored" | "disabled" | "channel_off" | "too_old" | "rejected";

export interface DiscordIntakeResult {
  outcome: DiscordIntakeOutcome;
  reason: string;
  signalId: string;
  channelName: string;
  traceMethod: DiscordTrace["method"] | "";
}

/** The local install's owner, as the Discord reader writes calls for them. */
export const DISCORD_NOTIFICATION_SCOPE: Readonly<RequestScope> = Object.freeze({
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "service",
  actorId: "discord_notifications",
  internalServiceCapability: "internal.delivery"
});

function result(outcome: DiscordIntakeOutcome, reason: string, extra: Partial<DiscordIntakeResult> = {}): DiscordIntakeResult {
  return { outcome, reason, signalId: "", channelName: "", traceMethod: "", ...extra };
}

/**
 * A Discord notification becomes a call like a TrackaLacker one: Yoink traces
 * it to a product and store listing, and the plan for that product decides
 * whether to add it to the cart. Notifications that mention no store item,
 * stock or price (a chat message, a DM) are not kept.
 */
export class DiscordNotificationIntake {
  private readonly repository: DiscordNotificationRepository;
  private readonly providers: SignalProviderRepository;

  constructor(
    db: YoinkDatabase,
    private readonly ingress: DurableSignalIngressService,
    private readonly scope: RequestScope = DISCORD_NOTIFICATION_SCOPE
  ) {
    this.repository = new DiscordNotificationRepository(db);
    this.providers = new SignalProviderRepository(db);
  }

  enabled(): boolean {
    return runWithRequestScope(this.scope, () => this.repository.settings().enabled);
  }

  accept(notification: CapturedDiscordNotification, now = Date.now()): DiscordIntakeResult {
    return runWithRequestScope(this.scope, () => this.acceptInScope(notification, now));
  }

  private acceptInScope(notification: CapturedDiscordNotification, now: number): DiscordIntakeResult {
    if (!this.repository.settings().enabled) return result("disabled", "Reading Discord notifications is off.");
    const facts = readDiscordNotification(notification.toast);
    if (!facts.relevant) return result("ignored", facts.relevance, { channelName: facts.channel.name });
    const channel = this.providers.ensureNotificationChannel(facts.channel.name, facts.channel.key, now);
    if (channel.status !== "active") {
      return result("channel_off", `${channel.name} is set to ignore.`, { channelName: channel.name });
    }
    if (!Number.isFinite(notification.arrivedAt) || notification.arrivedAt < now - channel.replayWindowSeconds * 1_000) {
      return result("too_old", "Windows showed it before Yoink could read it, too long ago to act on.", { channelName: channel.name });
    }
    const signalId = discordNotificationSignalId(channel.id, notification.reference);
    if (this.ingress.hasProviderSignal("discord", channel.sourceConnectionId, signalId)) {
      return result("duplicate", "Yoink already has this notification.", { signalId, channelName: channel.name });
    }
    const trace = this.repository.trace(facts);
    try {
      this.ingress.acceptProvider({
        contractVersion: 1,
        provider: "discord",
        channelId: channel.id,
        signal: discordSignal(notification, facts, trace, channel.sourceConnectionId, signalId, now)
      }, now);
    } catch (error) {
      const code = String((error as { code?: unknown } | null)?.code || "") || "signal_rejected";
      return result("rejected", cleanText(error instanceof Error ? error.message : code, 200), {
        signalId, channelName: channel.name, traceMethod: trace.method
      });
    }
    return result("call", trace.explanation, { signalId, channelName: channel.name, traceMethod: trace.method });
  }
}

export function discordSignal(
  notification: CapturedDiscordNotification,
  facts: DiscordNotificationFacts,
  trace: DiscordTrace,
  sourceConnectionId: string,
  signalId: string,
  now: number
): SignalEventInput {
  const link = facts.links[0];
  const listing = trace.listing;
  // A traced call names the exact Yoink listing; an untraced one keeps what the
  // message said (its store, any link) so the call log can show it.
  const identity: SignalIdentityClaims = listing
    ? {
        retailerId: listing.retailerId,
        retailerSku: listing.retailerSku,
        canonicalUrl: listing.canonicalUrl,
        title: trace.variantTitle
      }
    : { title: trace.variantTitle || facts.productText || facts.text };
  if (!listing) {
    const retailerId = link?.retailerId ?? facts.stores[0] ?? "";
    if (retailerId) identity.retailerId = retailerId;
    if (link) {
      identity.retailerSku = link.retailerSku;
      identity.canonicalUrl = link.canonicalUrl;
    }
  }
  if (trace.textKey) identity.globalIdentifiers = { discord_text: trace.textKey };
  return {
    schemaVersion: 1,
    signalId,
    sourceConnectionId,
    source: "discord",
    externalEventId: notification.reference,
    eventType: facts.eventType,
    observedAt: new Date(notification.arrivedAt).toISOString(),
    receivedAt: new Date(now).toISOString(),
    test: false,
    identity,
    // At Amazon, Target, Walmart and Best Buy a cart add needs the call's price at or
    // under the shopper's MSRP and max, as with TrackaLacker; Chrome still checks the
    // live page. The price stays out of price history (chat text, not the store).
    offer: {
      availability: facts.availability,
      unitPriceCents: facts.priceCents,
      currency: "USD",
      sellerType: "unknown",
      fulfillment: "unknown",
      orderLimit: null
    },
    evidence: {
      headline: cleanText(sanitizeDiagnosticData(facts.text), 500),
      body: cleanText(trace.explanation, 2_000),
      clickUrl: listing?.canonicalUrl || link?.canonicalUrl || ""
    },
    parserVersion: DISCORD_NOTIFICATION_PARSER_VERSION
  };
}
