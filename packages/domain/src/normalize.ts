import type {
  Availability,
  Fulfillment,
  NormalizedSignal,
  SanitizedSignalEvidence,
  SellerType,
  SignalEventInput
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "./ids.js";

const AVAILABILITY = new Set<Availability>(["in_stock", "preorder", "out_of_stock", "unknown"]);
const SELLER_TYPES = new Set<SellerType>(["first_party", "third_party", "unknown"]);
const FULFILLMENTS = new Set<Fulfillment>(["shipping", "pickup", "either", "manual", "unknown"]);
const EVENT_TYPES = new Set<SignalEventInput["eventType"]>([
  "in_stock", "restock", "preorder", "price_change", "drop_window", "queue_open", "unknown"
]);

export function cleanText(value: unknown, maximum = 240): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

export function normalizedKey(value: unknown, maximum = 180): string {
  return cleanText(value, maximum).normalize("NFKC").toLocaleLowerCase("en-US");
}

export function normalizeRetailerId(value: unknown): string {
  const retailer = normalizedKey(value, 60).replace(/[^a-z0-9_-]/g, "");
  if (!retailer) throw new Error("A retailer ID is required.");
  return retailer;
}

export function normalizeRetailerSku(value: unknown): string {
  const sku = cleanText(value, 64).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(sku)) throw new Error("A valid exact retailer SKU is required.");
  return sku;
}

export function positiveCents(value: unknown, optional = false): number | null {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000) {
    throw new Error("Money must be a positive integer number of minor currency units.");
  }
  return cents;
}

export function safeHttpsUrl(value: unknown): string {
  const source = cleanText(value, 4_096);
  if (!source) return "";
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("A valid HTTPS URL is required.");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("A credential-free HTTPS URL is required.");
  url.hash = "";
  url.search = "";
  return url.href;
}

function cleanOfferId(value: unknown): string {
  let offerId = cleanText(value, 2_048);
  if (!offerId) return "";
  try {
    offerId = decodeURIComponent(offerId);
  } catch {
    throw new Error("The offer identifier is not valid URL encoding.");
  }
  offerId = offerId.replace(/^`+|`+$/g, "").trim();
  if (!offerId || /[`\u0000-\u001f\u007f]/.test(offerId)) throw new Error("The offer identifier is malformed.");
  return offerId;
}

function sanitizedEvidence(input: SanitizedSignalEvidence | undefined): Required<SanitizedSignalEvidence> {
  return {
    headline: cleanText(input?.headline, 500),
    body: cleanText(input?.body, 2_000),
    msrpStatus: normalizedKey(input?.msrpStatus, 60),
    clickUrl: input?.clickUrl ? safeHttpsUrl(input.clickUrl) : ""
  };
}

export function normalizeSignal(input: SignalEventInput, now = Date.now()): NormalizedSignal {
  if (!input || typeof input !== "object") throw new Error("A signal object is required.");
  const sourceConnectionId = cleanText(input.sourceConnectionId, 120);
  const source = normalizedKey(input.source, 60).replace(/[^a-z0-9_-]/g, "");
  const externalEventId = cleanText(input.externalEventId, 180);
  if (!sourceConnectionId || !source || !externalEventId) {
    throw new Error("Signal source connection, source, and external event ID are required.");
  }
  const observed = new Date(input.observedAt);
  const received = new Date(input.receivedAt ?? now);
  if (Number.isNaN(observed.getTime()) || Number.isNaN(received.getTime())) throw new Error("Signal timestamps are invalid.");
  if (observed.getTime() > now + 5 * 60_000) throw new Error("The signal timestamp is too far in the future.");

  const retailerId = input.identity.retailerId ? normalizeRetailerId(input.identity.retailerId) : "";
  const retailerSku = input.identity.retailerSku ? normalizeRetailerSku(input.identity.retailerSku) : "";
  const unitPriceCents = positiveCents(input.offer?.unitPriceCents, true);
  const orderLimitValue = input.offer?.orderLimit;
  const orderLimit = orderLimitValue === null || orderLimitValue === undefined
    ? null
    : Number(orderLimitValue);
  if (orderLimit !== null && (!Number.isInteger(orderLimit) || orderLimit < 1 || orderLimit > 99)) {
    throw new Error("Signal order limit must be a whole number from 1 to 99.");
  }
  const ephemeralOfferId = cleanOfferId(input.offer?.offerId);
  const suppliedFingerprint = cleanText(input.offer?.offerFingerprint, 64).toLowerCase();
  const offerFingerprint = /^[a-f0-9]{64}$/.test(suppliedFingerprint)
    ? suppliedFingerprint
    : ephemeralOfferId ? stableHash("offer", ephemeralOfferId) : "";
  const availability = AVAILABILITY.has(input.offer?.availability as Availability)
    ? input.offer?.availability as Availability
    : "unknown";
  const sellerType = SELLER_TYPES.has(input.offer?.sellerType as SellerType)
    ? input.offer?.sellerType as SellerType
    : "unknown";
  const fulfillment = FULFILLMENTS.has(input.offer?.fulfillment as Fulfillment)
    ? input.offer?.fulfillment as Fulfillment
    : "unknown";
  const globalIdentifiers: Record<string, string> = {};
  for (const [kind, rawValue] of Object.entries(input.identity.globalIdentifiers ?? {})) {
    const key = normalizedKey(kind, 40).replace(/[^a-z0-9_-]/g, "");
    const value = cleanText(rawValue, 100).toUpperCase();
    if (key && value) globalIdentifiers[key] = value;
  }

  return {
    schemaVersion: Number.isInteger(input.schemaVersion) && Number(input.schemaVersion) > 0 ? Number(input.schemaVersion) : 1,
    signalId: cleanText(input.signalId, 180) || newId("sig"),
    sourceConnectionId,
    source,
    externalEventId,
    eventType: EVENT_TYPES.has(input.eventType) ? input.eventType : "unknown",
    observedAt: observed.toISOString(),
    receivedAt: received.toISOString(),
    test: input.test === true,
    identity: {
      sourceProductId: cleanText(input.identity.sourceProductId, 120),
      sourceListingId: cleanText(input.identity.sourceListingId, 120),
      retailerId,
      retailerSku,
      canonicalUrl: input.identity.canonicalUrl ? safeHttpsUrl(input.identity.canonicalUrl) : "",
      title: cleanText(input.identity.title, 300),
      globalIdentifiers
    },
    offer: {
      availability,
      unitPriceCents,
      currency: cleanText(input.offer?.currency || "USD", 3).toUpperCase(),
      sellerName: cleanText(input.offer?.sellerName, 160),
      sellerType,
      orderLimit,
      fulfillment,
      offerFingerprint
    },
    evidence: sanitizedEvidence(input.evidence),
    parserVersion: cleanText(input.parserVersion || "unknown", 80),
    transportHash: stableHash(sourceConnectionId, externalEventId),
    ephemeralOfferId
  };
}
