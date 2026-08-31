import {
  canonicalRetailerProductUrl,
  extractRetailerSku
} from "../../browser-adapters/src/retailers.js";
import { extractTargetSku } from "../../browser-adapters/src/target.js";
import type {
  DiscordChannelSignalInput,
  SignalProviderEnvelope
} from "../../contracts/src/signal-provider.js";
import type { SignalEventInput, SupportedRetailerId } from "../../contracts/src/index.js";
import { stableHash } from "../../domain/src/ids.js";
import { cleanText, normalizeRetailerSku, positiveCents } from "../../domain/src/normalize.js";
import { sanitizeDiagnosticData } from "../../domain/src/redaction.js";
import type { SignalProviderChannel } from "../../database/src/signal-provider-repository.js";

export const DISCORD_SIGNAL_ADAPTER_VERSION = "discord-channel-v1" as const;
const MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,179}$/;
const EVENT_TYPES = new Set<SignalEventInput["eventType"]>([
  "in_stock", "restock", "preorder", "price_change", "unknown"
]);
const AVAILABILITY = new Set(["in_stock", "preorder", "out_of_stock", "unknown"]);
const SELLER_TYPES = new Set(["first_party", "third_party", "unknown"]);
const FULFILLMENTS = new Set(["shipping", "pickup", "either", "manual", "unknown"]);

function exactIdentity(retailerId: SupportedRetailerId, suppliedSku: unknown, suppliedUrl: unknown): {
  retailerSku: string;
  canonicalUrl: string;
} {
  const urlValue = cleanText(suppliedUrl, 4_096);
  const supplied = normalizeRetailerSku(suppliedSku);
  const extracted = retailerId === "target"
    ? extractTargetSku(urlValue)
    : extractRetailerSku(retailerId, urlValue);
  if (!extracted || extracted !== supplied) {
    throw new Error("Discord signal facts must bind one exact retailer URL and SKU.");
  }
  const canonicalUrl = retailerId === "target"
    ? `https://www.target.com/p/-/A-${supplied}`
    : canonicalRetailerProductUrl(retailerId, urlValue);
  if (!canonicalUrl) throw new Error("Discord signal facts require a supported exact product URL.");
  return { retailerSku: supplied, canonicalUrl };
}

function timestamp(value: unknown): string {
  const parsed = new Date(cleanText(value, 40));
  if (Number.isNaN(parsed.getTime())) throw new Error("Discord signal facts require a valid observed timestamp.");
  return parsed.toISOString();
}

function optionalOrderLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 99) {
    throw new Error("Discord signal order limits must be whole numbers from 1 through 99.");
  }
  return parsed;
}

export function discordSignalEnvelope(
  input: DiscordChannelSignalInput,
  channel: SignalProviderChannel,
  receivedAt = Date.now()
): SignalProviderEnvelope {
  if (input?.contractVersion !== 1 || channel.provider !== "discord" || input.channelId !== channel.id) {
    throw new Error("The Discord signal and configured channel do not match.");
  }
  const messageId = cleanText(input.messageId, 180);
  if (!MESSAGE_ID.test(messageId)) throw new Error("A bounded Discord message ID is required.");
  const facts = input.facts;
  if (!facts || typeof facts !== "object") throw new Error("Structured Discord commerce facts are required.");
  if (!EVENT_TYPES.has(facts.eventType)) throw new Error("The Discord signal event type is invalid.");
  const identity = exactIdentity(facts.retailerId, facts.retailerSku, facts.canonicalUrl);
  const availability = AVAILABILITY.has(String(facts.availability))
    ? facts.availability!
    : "unknown";
  const sellerType = SELLER_TYPES.has(String(facts.sellerType)) ? facts.sellerType! : "unknown";
  const fulfillment = FULFILLMENTS.has(String(facts.fulfillment)) ? facts.fulfillment! : "unknown";
  const currency = cleanText(facts.currency || "USD", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Discord signal currency must be a three-letter code.");
  const summary = cleanText(sanitizeDiagnosticData(input.summary || "Discord channel signal"), 500);
  return {
    contractVersion: 1,
    provider: "discord",
    channelId: channel.id,
    signal: {
      schemaVersion: 1,
      signalId: `discord:${stableHash("yoink_discord_signal_v1", channel.id, messageId)}`,
      sourceConnectionId: channel.sourceConnectionId,
      source: "discord",
      externalEventId: messageId,
      eventType: facts.eventType,
      observedAt: timestamp(input.observedAt),
      receivedAt: new Date(receivedAt).toISOString(),
      test: input.test === true,
      identity: {
        retailerId: facts.retailerId,
        retailerSku: identity.retailerSku,
        canonicalUrl: identity.canonicalUrl,
        title: cleanText(facts.title, 300)
      },
      offer: {
        availability,
        unitPriceCents: positiveCents(facts.unitPriceCents, true),
        currency,
        sellerName: cleanText(facts.sellerName, 160),
        sellerType,
        fulfillment,
        orderLimit: optionalOrderLimit(facts.orderLimit)
      },
      evidence: {
        headline: summary,
        body: "Received through an explicitly configured private Discord channel.",
        clickUrl: identity.canonicalUrl
      },
      parserVersion: DISCORD_SIGNAL_ADAPTER_VERSION
    }
  };
}
