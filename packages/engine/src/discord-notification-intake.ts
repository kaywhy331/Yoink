import { DROP_WINDOW_CONTRACT_VERSION } from "../../contracts/src/action-platform.js";
import { RETAILER_OBSERVER_VERSIONS, type SignalEventInput, type SignalIdentityClaims, type SupportedRetailerId } from "../../contracts/src/index.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, type YoinkDatabase } from "../../database/src/database.js";
import {
  DiscordNotificationRepository,
  type DiscordTrace
} from "../../database/src/discord-notification-repository.js";
import { DISCORD_DROP_WINDOW_ORIGIN, DropWindowRepository } from "../../database/src/drop-window-repository.js";
import { runWithRequestScope, type RequestScope } from "../../database/src/request-scope.js";
import { SignalProviderRepository } from "../../database/src/signal-provider-repository.js";
import { cleanText } from "../../domain/src/normalize.js";
import { formatDropTime } from "../../domain/src/call-result.js";
import { itemTitleFromUrl } from "../../domain/src/collections.js";
import { sanitizeDiagnosticData } from "../../domain/src/redaction.js";
import { localTimeZone } from "../../sources/src/drop-time.js";
import {
  DISCORD_NOTIFICATION_PARSER_VERSION,
  discordMessageParts,
  discordNotificationSignalId,
  discordItemPages,
  discordMessageShape,
  discordProductTitle,
  discordShortLinks,
  readDiscordNotification,
  type DiscordNotificationFacts,
  type DiscordToast,
  type FollowedLinks
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
  /** For a skipped notification: its line, word, link and mention counts, never its text. */
  shape?: string;
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

/** Follows a message's short links to the store items they lead to. */
export type DiscordLinkFollower = (links: readonly string[]) => Promise<FollowedLinks>;

/**
 * A Discord notification becomes a call like a TrackaLacker one (Kevin,
 * 2026-10-13: "validate the listing … and try to add to cart if it meets the
 * criteria"): Yoink follows its short links, checks where its links land,
 * traces it to a product and store listing, links a store item it doesn't
 * have yet, and the plan for that product decides whether Chrome checks the
 * store page and adds it to the cart. A message listing several items is a
 * call per item; a drop time becomes a drop window for the item; a notice
 * that names no product is logged and nothing more. Notifications that
 * mention no store item, stock or price (a chat message, a DM) are not kept.
 */
export class DiscordNotificationIntake {
  private readonly repository: DiscordNotificationRepository;
  private readonly providers: SignalProviderRepository;
  private readonly dropWindows: DropWindowRepository;

  constructor(
    db: YoinkDatabase,
    private readonly ingress: DurableSignalIngressService,
    private readonly scope: RequestScope = DISCORD_NOTIFICATION_SCOPE,
    private readonly followLinks: DiscordLinkFollower | null = null,
    private readonly timeZone: string = localTimeZone()
  ) {
    this.repository = new DiscordNotificationRepository(db);
    this.providers = new SignalProviderRepository(db);
    this.dropWindows = new DropWindowRepository(db);
  }

  enabled(): boolean {
    return runWithRequestScope(this.scope, () => this.repository.settings().enabled);
  }

  /** Follows the message's short links first (when it has any and would be kept), then records it. */
  async receive(notification: CapturedDiscordNotification, now = Date.now()): Promise<DiscordIntakeResult> {
    const shortLinks = this.followLinks ? discordShortLinks(notification.toast) : [];
    if (!shortLinks.length || !this.followLinks) return this.accept(notification, now);
    const early = runWithRequestScope(this.scope, () => this.gate(notification, this.read(notification, {}), now));
    if (early.outcome !== "call") return early;
    let followed: FollowedLinks = {};
    try {
      followed = await this.followLinks(shortLinks);
    } catch {
      followed = Object.fromEntries(shortLinks.map((link) => [link, { item: null, landing: "" }]));
    }
    return this.accept(notification, now, followed);
  }

  accept(notification: CapturedDiscordNotification, now = Date.now(), followed: FollowedLinks = {}): DiscordIntakeResult {
    return runWithRequestScope(this.scope, () => this.acceptInScope(notification, now, followed));
  }

  private read(notification: CapturedDiscordNotification, followed: FollowedLinks): DiscordNotificationFacts {
    return readDiscordNotification(notification.toast, followed, { arrivedAt: notification.arrivedAt, timeZone: this.timeZone });
  }

  /** Whether the notification is one to record: "call" to go on, or why not. */
  private gate(notification: CapturedDiscordNotification, facts: DiscordNotificationFacts, now: number): DiscordIntakeResult {
    if (!this.repository.settings().enabled) return result("disabled", "Reading Discord notifications is off.");
    if (!facts.relevant) {
      return result("ignored", facts.relevance, { channelName: facts.channel.name, shape: discordMessageShape(notification.toast) });
    }
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
    return result("call", "", { signalId, channelName: channel.name });
  }

  private acceptInScope(notification: CapturedDiscordNotification, now: number, followed: FollowedLinks): DiscordIntakeResult {
    const whole = this.gate(notification, this.read(notification, followed), now);
    if (whole.outcome !== "call") return whole;
    const parts = discordMessageParts(notification.toast, followed);
    if (parts.length === 1) return this.acceptPart(notification, now, followed);
    // Several items in one message: a call each, under the message's own reference and the item's place in it.
    const results = parts.map((toast, index) => this.acceptPart({ ...notification, reference: `${notification.reference}#${index + 1}`, toast }, now, followed));
    const calls = results.filter((item) => item.outcome === "call");
    const first = calls[0] ?? results[0]!;
    return {
      ...first,
      outcome: calls.length ? "call" : first.outcome,
      reason: cleanText(`${parts.length} items: ${results.map((item, index) => `${index + 1}. ${item.reason}`).join(" ")}`, 1_000)
    };
  }

  private acceptPart(notification: CapturedDiscordNotification, now: number, followed: FollowedLinks): DiscordIntakeResult {
    const facts = this.read(notification, followed);
    const gate = this.gate(notification, facts, now);
    if (gate.outcome !== "call") return gate;
    const channel = this.providers.ensureNotificationChannel(facts.channel.name, facts.channel.key, now);
    const signalId = gate.signalId;
    let trace = facts.kind === "notice" ? noticeTrace(facts) : this.repository.trace(facts);
    // A store item Yoink doesn't have yet is linked to Yoink before the call is recorded.
    const unknown = facts.kind !== "notice" && facts.availability !== "out_of_stock" ? this.repository.unknownStoreItem(facts) : null;
    const pageTitle = (item: { retailerId: string; retailerSku: string }): string => itemTitleFromUrl(discordItemPages(notification.toast, followed)
      .find((found) => found.item.retailerId === item.retailerId && found.item.retailerSku === item.retailerSku)?.page ?? "");
    // An item a Discord message added under a name that names nothing takes this message's name for it.
    if (trace.method === "link" && trace.listing) {
      try {
        const better = discordProductTitle(facts.productText) || pageTitle(trace.listing);
        if (better && this.repository.renameDiscordProduct(trace.listing.id, better, now)) {
          trace = { ...trace, variantTitle: better, explanation: `${trace.explanation} Yoink named the product ${better}.` };
        }
      } catch {
        // A name that can't be saved leaves the product as it was.
      }
    }
    if (unknown) {
      try {
        trace = this.repository.linkStoreItem(trace, {
          link: unknown,
          // The message's product words, else the name in the store page's address.
          title: discordProductTitle(facts.productText) || pageTitle(unknown),
          availability: facts.availability,
          sourceConnectionId: channel.sourceConnectionId,
          observedAt: new Date(Math.min(notification.arrivedAt, now)).toISOString()
        }, now) ?? trace;
      } catch {
        // The call is still recorded as the message traced; linking is tried again on its next message.
      }
    }
    if (facts.drop) trace = { ...trace, explanation: `${trace.explanation} ${this.dropWindowFor(facts, trace, now)}`.trim() };
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
    // The same call at each other store the shopper wants it from, under the message's reference and the store.
    for (const listing of trace.alsoAt ?? []) {
      const reference = `${notification.reference}@${listing.retailerId}`;
      const storeSignalId = discordNotificationSignalId(channel.id, reference);
      if (this.ingress.hasProviderSignal("discord", channel.sourceConnectionId, storeSignalId)) continue;
      try {
        this.ingress.acceptProvider({
          contractVersion: 1,
          provider: "discord",
          channelId: channel.id,
          signal: discordSignal({ ...notification, reference }, facts, { ...trace, listing, alsoAt: [] },
            channel.sourceConnectionId, storeSignalId, now)
        }, now);
      } catch {
        // One store's call failing leaves the others recorded.
      }
    }
    return result("call", trace.explanation, { signalId, channelName: channel.name, traceMethod: trace.method });
  }

  /**
   * A drop or queue time for an item traced to a store listing becomes a drop
   * window (Kevin, 2026-10-13: "drop ETA"): Chrome checks the item's page from
   * 15 minutes before it until the window closes, and a plan adds it once it is
   * in stock. A drawing is entered, not added to a cart, so it gets no window.
   * Returns the sentence the call's Why gets.
   */
  private dropWindowFor(facts: DiscordNotificationFacts, trace: DiscordTrace, now: number): string {
    const drop = facts.drop;
    if (!drop) return "";
    if (drop.kind === "drawing") return "";
    const listing = trace.listing;
    if (!listing) return "";
    if (!Object.hasOwn(RETAILER_OBSERVER_VERSIONS, listing.retailerId)) return "";
    // An exact time: two hours (Kevin, 2026-08-30: drops trickle out), a queue one. A day or part of one
    // ("should drop tonight"): the window it names, checked at a slower pace (lower confidence).
    const broad = drop.until !== undefined;
    const closesAt = drop.until ?? drop.at + (drop.kind === "queue" ? 1 : 2) * 60 * 60_000;
    try {
      const existing = broad ? this.dropWindows.openWindowOverlapping(listing.id, drop.at, closesAt)
        : this.dropWindows.openWindowNear(listing.id, drop.at);
      if (existing) return "Yoink already has a drop window for it at that time.";
      this.dropWindows.create({
        contractVersion: DROP_WINDOW_CONTRACT_VERSION,
        kind: drop.kind === "queue" ? "queue_open" : "drop_window",
        retailerId: listing.retailerId as SupportedRetailerId,
        title: cleanText(trace.variantTitle || facts.productText, 160) || "Discord drop",
        startsAt: new Date(drop.at).toISOString(),
        closesAt: new Date(closesAt).toISOString(),
        spreadSeconds: 0,
        confidenceBps: broad ? 2_500 : 5_000,
        timezone: drop.zone,
        authorNote: cleanText(`From Discord, ${facts.channel.name}: ${drop.phrase}`, 500),
        products: [{ listingId: listing.id }]
      }, now, DISCORD_DROP_WINDOW_ORIGIN);
      return broad
        ? `Yoink set a drop window for it until ${formatDropTime(new Date(closesAt).toISOString(), drop.zone)}: Chrome checks its page every few minutes.`
        : "Yoink set a drop window for it: Chrome checks its page from 15 minutes before.";
    } catch (error) {
      return `Yoink couldn't set a drop window for it (${cleanText(error instanceof Error ? error.message : String(error), 160)}).`;
    }
  }
}

/** Why a notice is no product call: where its links land, or what it says. */
function noticeTrace(facts: DiscordNotificationFacts): DiscordTrace {
  const PAGES: Record<string, string> = {
    search: "search page", category: "category page", drawing: "drawing page", queue: "queue page",
    cart: "cart", home: "home page", other: "page that isn't a product's"
  };
  const landing = facts.landings[0];
  const where = landing
    ? `The link lands on ${landing.retailerId ? `${storeName(landing.retailerId)}'s` : "a"} ${PAGES[landing.kind] ?? PAGES.other}, not a product's page`
    : "The message is a notice, not about a product";
  return {
    method: "none", variantId: "", variantTitle: "", listing: null, score: null, textKey: "",
    explanation: `${where}, so Yoink didn't act on it.`
  };
}

function storeName(retailerId: string): string {
  return ({ walmart: "Walmart", target: "Target", amazon: "Amazon", bestbuy: "Best Buy", pokemoncenter: "Pokémon Center" } as Record<string, string>)[retailerId]
    ?? retailerId;
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
  // What kind of message it was, and its drop time, go with the call (Calls › Discord shows them).
  const extra: Record<string, string> = {};
  if (trace.textKey) extra.discord_text = trace.textKey;
  if (facts.kind !== "item") extra.discord_kind = facts.drop ? facts.drop.kind : facts.kind;
  // The product was found but no store: the call log says so instead of "not matched".
  else if (trace.variantId && !listing) extra.discord_kind = "no_store";
  if (facts.drop) extra.discord_drop_at = new Date(facts.drop.at).toISOString();
  if (facts.drop?.until !== undefined) extra.discord_drop_until = new Date(facts.drop.until).toISOString();
  if (Object.keys(extra).length) identity.globalIdentifiers = extra;
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
