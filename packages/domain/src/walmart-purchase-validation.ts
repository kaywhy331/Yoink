import { normalizedKey } from "./normalize.js";
import {
  buildWalmartPurchaseDestinations,
  extractWalmartItemId,
  normalizeWalmartItemId,
  type WalmartPurchaseDestinations
} from "./walmart-purchase-route.js";

export const WALMART_PURCHASE_HANDOFF_MAX_AGE_MS = 120_000;

export type WalmartPurchaseValidationReason =
  | "ready"
  | "not_walmart"
  | "item_identity_invalid"
  | "item_identity_mismatch"
  | "not_in_stock"
  | "signal_not_current"
  | "price_unverified"
  | "price_above_limit"
  | "currency_unsupported"
  | "seller_unverified"
  | "seller_policy_unsupported"
  | "fulfillment_unsupported"
  | "source_untrusted"
  | "mission_not_qualified"
  | "cart_mutation_in_flight";

export interface WalmartSignalPurchaseCandidate {
  retailerId: unknown;
  retailerSku: unknown;
  canonicalUrl: unknown;
  availability: unknown;
  observedAt: unknown;
  expiresAt: unknown;
  unitPriceCents: unknown;
  approvedMaxUnitPriceCents: unknown;
  currency: unknown;
  sellerName: unknown;
  sellerType: unknown;
  sellerPolicy: unknown;
  observedFulfillment: unknown;
  missionFulfillment: unknown;
  sourceTrustLevel: unknown;
  missionDecision: unknown;
  cartMutationInFlight: boolean;
}

export interface WalmartSignalPurchaseValidation {
  eligible: boolean;
  reason: WalmartPurchaseValidationReason;
  destinations: WalmartPurchaseDestinations | null;
}

function rejected(reason: Exclude<WalmartPurchaseValidationReason, "ready">): WalmartSignalPurchaseValidation {
  return { eligible: false, reason, destinations: null };
}

function positiveSafeCents(value: unknown): number | null {
  const cents = Number(value);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000 ? cents : null;
}

export function validateWalmartSignalPurchase(
  input: WalmartSignalPurchaseCandidate,
  now = Date.now()
): WalmartSignalPurchaseValidation {
  if (normalizedKey(input.retailerId, 60) !== "walmart") return rejected("not_walmart");

  const retailerSku = normalizeWalmartItemId(input.retailerSku);
  const urlItemId = extractWalmartItemId(input.canonicalUrl);
  if (!retailerSku || !urlItemId) return rejected("item_identity_invalid");
  if (retailerSku !== urlItemId) return rejected("item_identity_mismatch");

  if (normalizedKey(input.availability, 40) !== "in_stock") return rejected("not_in_stock");
  const observedAt = new Date(String(input.observedAt ?? "")).getTime();
  const expiresAt = new Date(String(input.expiresAt ?? "")).getTime();
  if (!Number.isFinite(observedAt)
    || !Number.isFinite(expiresAt)
    || observedAt > now + 30_000
    || now - observedAt > WALMART_PURCHASE_HANDOFF_MAX_AGE_MS
    || expiresAt <= now) return rejected("signal_not_current");

  const unitPriceCents = positiveSafeCents(input.unitPriceCents);
  const approvedMaxUnitPriceCents = positiveSafeCents(input.approvedMaxUnitPriceCents);
  if (unitPriceCents === null || approvedMaxUnitPriceCents === null) return rejected("price_unverified");
  if (unitPriceCents > approvedMaxUnitPriceCents) return rejected("price_above_limit");
  if (normalizedKey(input.currency, 3) !== "usd") return rejected("currency_unsupported");

  const sellerName = normalizedKey(input.sellerName, 160);
  if (normalizedKey(input.sellerType, 40) !== "first_party"
    || !["walmart", "walmart.com"].includes(sellerName)) return rejected("seller_unverified");
  if (normalizedKey(input.sellerPolicy, 40) !== "first_party_only") {
    return rejected("seller_policy_unsupported");
  }

  if (!["shipping", "either"].includes(normalizedKey(input.observedFulfillment, 40))
    || !["shipping", "either"].includes(normalizedKey(input.missionFulfillment, 40))) {
    return rejected("fulfillment_unsupported");
  }
  if (normalizedKey(input.sourceTrustLevel, 40) !== "trusted_exact") return rejected("source_untrusted");
  if (normalizedKey(input.missionDecision, 80) !== "qualified") return rejected("mission_not_qualified");
  if (input.cartMutationInFlight) return rejected("cart_mutation_in_flight");

  return {
    eligible: true,
    reason: "ready",
    destinations: buildWalmartPurchaseDestinations(retailerSku)
  };
}
