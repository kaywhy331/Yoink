import {
  buildAmazonBuyNowUrl,
  extractAmazonOfferListingId,
  observeRetailerOffer,
  extractRetailerSku,
  canonicalRetailerProductUrl,
  retailerAdapterLayoutEvidence,
  retailerObserverVersion
} from "../../../packages/browser-adapters/src/retailers.js";
import { observeWalmartDrawHub } from "../../../packages/browser-adapters/src/walmart-draw.js";
import type {
  Fulfillment,
  RetailerAdapterDiagnosticInput,
  RetailerAdapterDiagnosticOutcome,
  RetailerAdapterDiagnosticStage,
  RetailerAdapterLayoutEvidence,
  RetailerShadowObservationInput,
  SupportedRetailerId
} from "../../../packages/contracts/src/index.js";

const SUPPORTED = new Set<SupportedRetailerId>([
  "walmart", "amazon", "bestbuy", "disney", "ravensburger", "riot",
  "booksamillion", "fanatics", "kohls", "macys", "pbandai", "pokemoncenter"
]);

export function rehearseAmazonBuyNowRoute(documentValue: Document, urlValue: string) {
  const asin = extractRetailerSku("amazon", urlValue);
  if (!asin) return { purchaseRouteKind: "amazon_buy_now" as const, purchaseRouteReady: false, routeReasonCode: "offer_not_actionable" as const };
  const observation = observeRetailerOffer(documentValue, urlValue, "amazon", asin, "shipping");
  if (!observation.addControlActionable || observation.securityChallenge || observation.interactiveBlock
    || observation.fulfillment !== "shipping" || !["in_stock", "preorder"].includes(observation.availability)) {
    return { purchaseRouteKind: "amazon_buy_now" as const, purchaseRouteReady: false, routeReasonCode: "offer_not_actionable" as const };
  }
  const offerListingId = extractAmazonOfferListingId(documentValue, asin);
  if (!offerListingId) {
    return { purchaseRouteKind: "amazon_buy_now" as const, purchaseRouteReady: false, routeReasonCode: "offer_id_missing_or_ambiguous" as const };
  }
  try {
    const route = new URL(buildAmazonBuyNowUrl({ asin, offerListingId, quantity: 1 }));
    const valid = route.origin === "https://www.amazon.com"
      && route.pathname === "/checkout/entry/buynow"
      && route.searchParams.get("ASIN") === asin
      && route.searchParams.get("items[0.base][asin]") === asin
      && route.searchParams.get("quantity") === "1"
      && route.searchParams.get("offerListingID") === offerListingId;
    return {
      purchaseRouteKind: "amazon_buy_now" as const,
      purchaseRouteReady: valid,
      routeReasonCode: valid ? "offer_route_verified" as const : "route_validation_failed" as const
    };
  } catch {
    return { purchaseRouteKind: "amazon_buy_now" as const, purchaseRouteReady: false, routeReasonCode: "route_validation_failed" as const };
  }
}

export function collectRetailerShadowObservation(
  documentValue: Document,
  urlValue: string,
  retailerId: SupportedRetailerId,
  requiredFulfillment: Fulfillment = "either"
): RetailerShadowObservationInput {
  if (!documentValue || !SUPPORTED.has(retailerId)) throw new Error("A supported retailer page is required.");
  const exactRetailer = retailerId as Exclude<SupportedRetailerId, "target">;
  const retailerSku = extractRetailerSku(exactRetailer, urlValue);
  if (!retailerSku) throw new Error("Open an exact supported retailer product page before inspecting it.");
  const observation = observeRetailerOffer(documentValue, urlValue, exactRetailer, retailerSku, requiredFulfillment);
  if (observation.pageKind !== "product" || observation.retailerSku !== retailerSku) {
    throw new Error("The exact retailer product page could not be verified.");
  }
  const routeEvidence = retailerId === "amazon"
    ? rehearseAmazonBuyNowRoute(documentValue, urlValue)
    : { purchaseRouteKind: "none" as const, purchaseRouteReady: false, routeReasonCode: "not_applicable" as const };
  return {
    adapterVersion: retailerObserverVersion(retailerId),
    contractVersion: 1,
    observedAt: observation.observedAt,
    pageKind: "product",
    retailerId,
    retailerSku,
    canonicalUrl: canonicalRetailerProductUrl(exactRetailer, urlValue),
    availability: observation.availability,
    unitPriceCents: observation.unitPriceCents,
    currency: "USD",
    sellerName: observation.sellerName,
    sellerType: observation.sellerType,
    fulfillment: observation.fulfillment === "shipping" || observation.fulfillment === "pickup"
      ? observation.fulfillment : "unknown",
    addControlActionable: observation.addControlActionable,
    securityChallenge: observation.securityChallenge,
    interactiveBlock: observation.interactiveBlock,
    ...routeEvidence
  };
}

function observationDiagnosticState(
  observation: RetailerShadowObservationInput,
  layout: RetailerAdapterLayoutEvidence
): { outcome: RetailerAdapterDiagnosticOutcome; failureStage: RetailerAdapterDiagnosticStage; reasonCode: string } {
  if (layout.pageKind !== "product") return { outcome: "failed", failureStage: "page_identity", reasonCode: "product_identity_missing" };
  if (layout.securityChallenge || layout.interactiveBlock) {
    return {
      outcome: "rejected",
      failureStage: "interactive_block",
      reasonCode: layout.securityChallenge ? "security_challenge" : `interactive_${layout.interactiveBlock}`
    };
  }
  if (layout.addControlCount === 0) {
    return (layout.genericAddIntentCount ?? 0) > 0
      ? { outcome: "failed", failureStage: "add_control", reasonCode: "add_control_selector_miss" }
      : { outcome: "rejected", failureStage: "add_control", reasonCode: "add_control_missing" };
  }
  if (layout.addControlCount > 1 && layout.scopedControlCount !== 1) {
    return { outcome: "failed", failureStage: "add_control", reasonCode: "add_control_ambiguous" };
  }
  if (!observation.addControlActionable && layout.scopedControlCount > 0) {
    return { outcome: "rejected", failureStage: "add_control", reasonCode: "add_control_disabled" };
  }
  if (observation.retailerId === "amazon") {
    if (layout.explicitSkuInputCount === 0 || layout.exactSkuInputCount === 0) {
      return { outcome: "failed", failureStage: "sku_binding", reasonCode: "explicit_sku_binding_missing" };
    }
    if (layout.exactSkuInputCount !== layout.explicitSkuInputCount) {
      return { outcome: "failed", failureStage: "sku_binding", reasonCode: "explicit_sku_binding_ambiguous" };
    }
    const primaryOfferCount = layout.canonicalOfferInputCount > 0
      ? layout.canonicalOfferDistinctCount : layout.alternateOfferDistinctCount;
    if (primaryOfferCount === 0) return { outcome: "failed", failureStage: "offer_binding", reasonCode: "offer_binding_missing" };
    if (primaryOfferCount !== 1) return { outcome: "failed", failureStage: "offer_binding", reasonCode: "offer_binding_ambiguous" };
  }
  if (layout.priceCandidateCount === 0 || observation.unitPriceCents === null) {
    return { outcome: "failed", failureStage: "price_binding", reasonCode: "price_binding_missing" };
  }
  if (observation.sellerType === "unknown") {
    return { outcome: "failed", failureStage: "seller_binding", reasonCode: "seller_binding_missing" };
  }
  if (observation.fulfillment === "unknown") {
    return { outcome: "failed", failureStage: "fulfillment_binding", reasonCode: "fulfillment_binding_missing" };
  }
  if (!observation.addControlActionable) {
    return { outcome: "failed", failureStage: "offer_binding", reasonCode: "offer_scope_not_actionable" };
  }
  if (observation.retailerId === "amazon" && observation.purchaseRouteReady !== true) {
    return {
      outcome: "failed",
      failureStage: "route_binding",
      reasonCode: observation.routeReasonCode || "route_binding_failed"
    };
  }
  return { outcome: "passed", failureStage: "complete", reasonCode: "verified" };
}

export function collectRetailerShadowAttempt(
  documentValue: Document,
  urlValue: string,
  retailerId: SupportedRetailerId,
  requiredFulfillment: Fulfillment = "either",
  attemptCount = 1,
  domChanged = false
): { observation: ReturnType<typeof collectRetailerShadowObservation>; diagnostic: RetailerAdapterDiagnosticInput } {
  if (retailerId === "target") throw new Error("Target uses its separate shadow observer.");
  const observation = collectRetailerShadowObservation(documentValue, urlValue, retailerId, requiredFulfillment);
  const layout = retailerAdapterLayoutEvidence(documentValue, urlValue, retailerId, observation.retailerSku);
  const state = observationDiagnosticState(observation, layout);
  return {
    observation,
    diagnostic: {
      contractVersion: 1,
      observedAt: observation.observedAt,
      retailerId,
      retailerSku: observation.retailerSku,
      adapterVersion: observation.adapterVersion,
      operation: "observe",
      outcome: state.outcome,
      failureStage: state.failureStage,
      reasonCode: state.reasonCode,
      attemptCount: Math.max(1, Math.min(3, Math.trunc(attemptCount) || 1)),
      domChanged: domChanged === true,
      layout
    }
  };
}

Object.defineProperty(globalThis, "YoinkRetailerShadow", {
  value: Object.freeze({
    collectRetailerShadowAttempt,
    collectRetailerShadowObservation,
    observeWalmartDrawHub,
    rehearseAmazonBuyNowRoute
  }),
  configurable: true
});
