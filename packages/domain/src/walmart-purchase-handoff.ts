import { buildHowlAffiliateRoute } from "./howl-affiliate-stores.js";
import { cleanText } from "./normalize.js";
import {
  validateWalmartSignalPurchase,
  WALMART_PURCHASE_HANDOFF_MAX_AGE_MS
} from "./walmart-purchase-validation.js";

export interface WalmartHowlAttribution {
  publisherSlug: unknown;
  articleName: unknown;
  articleUrl: unknown;
}

export interface WalmartPurchaseHandoff {
  kind: "walmart_review_order";
  walmartItemId: string;
  destinationUrl: string;
  directFallbackUrl: string;
  pdpFallbackUrl: string;
  trackingId: string;
  expiresAt: string;
}

export function deriveWalmartPurchaseHandoff(
  signal: Record<string, unknown>,
  now = Date.now(),
  howl: WalmartHowlAttribution | null = null
): WalmartPurchaseHandoff | null {
  // A reviewOrder navigation may add the item. It must never race a guarded
  // Chrome mutation or repeat an already-confirmed cart add.
  if (String(signal.actionJobAction ?? "") !== "notify"
    || String(signal.actionJobState ?? "") !== "notify_only") return null;

  const validation = validateWalmartSignalPurchase({
    retailerId: signal.retailerId,
    retailerSku: signal.retailerSku,
    canonicalUrl: signal.canonicalUrl,
    availability: signal.availability,
    observedAt: signal.observedAt,
    expiresAt: signal.actionJobExpiresAt,
    unitPriceCents: signal.unitPriceCents,
    approvedMaxUnitPriceCents: signal.effectiveUnitCapCents ?? signal.actionJobMaxUnitPriceCents,
    currency: signal.currency,
    sellerName: signal.sellerName,
    sellerType: signal.sellerType,
    sellerPolicy: signal.actionJobSellerPolicy,
    observedFulfillment: signal.fulfillment,
    missionFulfillment: signal.actionJobFulfillment,
    sourceTrustLevel: signal.sourceTrustLevel,
    missionDecision: signal.missionDecision,
    cartMutationInFlight: false
  }, now);
  if (!validation.eligible || !validation.destinations) return null;

  const observedAt = new Date(String(signal.observedAt ?? "")).getTime();
  const jobExpiresAt = new Date(String(signal.actionJobExpiresAt ?? "")).getTime();
  const expiresAt = new Date(Math.min(
    jobExpiresAt,
    observedAt + WALMART_PURCHASE_HANDOFF_MAX_AGE_MS
  )).toISOString();
  const articleName = cleanText(howl?.articleName, 200) || "Walmart product alert";
  const affiliateUrl = howl
    ? buildHowlAffiliateRoute({
      destinationUrl: validation.destinations.reviewOrderUrl,
      publisherSlug: howl.publisherSlug,
      articleName,
      articleUrl: howl.articleUrl,
      trackingId: validation.destinations.trackingId
    })
    : "";

  return {
    kind: "walmart_review_order",
    walmartItemId: validation.destinations.walmartItemId,
    destinationUrl: affiliateUrl || validation.destinations.reviewOrderUrl,
    directFallbackUrl: validation.destinations.reviewOrderUrl,
    pdpFallbackUrl: validation.destinations.pdpUrl,
    trackingId: validation.destinations.trackingId,
    expiresAt
  };
}
