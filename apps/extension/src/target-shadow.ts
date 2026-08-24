import { TARGET_OBSERVER_VERSION, type TargetShadowObservationInput } from "../../../packages/contracts/src/index.js";
import {
  extractTargetSku,
  observeTargetOffer,
  observeTargetSelectedOfferScope
} from "../../../packages/browser-adapters/src/target.js";

export function collectTargetShadowObservation(
  documentValue: Document = globalThis.document,
  urlValue: string = globalThis.location?.href ?? ""
): TargetShadowObservationInput {
  if (!documentValue) throw new Error("The current Target page is unavailable.");
  const retailerSku = extractTargetSku(urlValue);
  if (!retailerSku) throw new Error("Open an exact Target product page before inspecting it.");
  const observation = observeTargetOffer(documentValue, urlValue, retailerSku, "either");
  if (observation.pageKind !== "product" || observation.retailerId !== "target" || observation.retailerSku !== retailerSku) {
    throw new Error("The exact Target product page could not be verified.");
  }
  const fulfillment = observation.fulfillment === "shipping" || observation.fulfillment === "pickup"
    ? observation.fulfillment
    : "unknown";
  return Object.freeze({
    adapterVersion: TARGET_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt: observation.observedAt,
    pageKind: "product",
    retailerId: "target",
    retailerSku,
    availability: observation.availability,
    unitPriceCents: observation.unitPriceCents,
    currency: "USD",
    sellerName: observation.sellerName,
    sellerType: observation.sellerType,
    fulfillment,
    addControlActionable: observation.addControlActionable,
    securityChallenge: observation.securityChallenge,
    interactiveBlock: observation.interactiveBlock,
    selectedOffer: observeTargetSelectedOfferScope(documentValue, urlValue, retailerSku, "either")
  });
}

Object.defineProperty(globalThis, "YoinkTargetShadow", {
  value: Object.freeze({ collectTargetShadowObservation }),
  configurable: true
});
