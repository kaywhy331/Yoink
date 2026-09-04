import {
  createAdapterTraceBuffer,
  TARGET_OBSERVER_VERSION,
  type AdapterEnvironment,
  type AdapterTraceEntry,
  type Fulfillment,
  type RetailerAdapterDiagnosticInput,
  type RetailerAdapterDiagnosticOutcome,
  type RetailerAdapterDiagnosticStage,
  type RetailerAdapterLayoutEvidence,
  type TargetShadowObservationInput
} from "../../../packages/contracts/src/index.js";
import {
  extractTargetSku,
  observeTargetOffer,
  observeTargetSelectedOfferScope,
  targetAdapterLayoutEvidence
} from "../../../packages/browser-adapters/src/target.js";

export function collectTargetShadowObservation(
  documentValue: Document = globalThis.document,
  urlValue: string = globalThis.location?.href ?? "",
  requiredFulfillment: Fulfillment = "shipping",
  environment?: AdapterEnvironment
): TargetShadowObservationInput {
  if (!documentValue) throw new Error("The current Target page is unavailable.");
  const retailerSku = extractTargetSku(urlValue);
  if (!retailerSku) throw new Error("Open an exact Target product page before inspecting it.");
  const fulfillmentPreference = requiredFulfillment === "pickup" ? "pickup" : "shipping";
  const observation = observeTargetOffer(
    documentValue, urlValue, retailerSku, fulfillmentPreference, undefined, environment
  );
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
    selectedOffer: observeTargetSelectedOfferScope(
      documentValue, urlValue, retailerSku, fulfillmentPreference, environment
    )
  });
}

function targetObservationDiagnosticState(
  observation: TargetShadowObservationInput,
  layout: RetailerAdapterLayoutEvidence
): {
  outcome: RetailerAdapterDiagnosticOutcome;
  failureStage: RetailerAdapterDiagnosticStage;
  reasonCode: string;
} {
  if (layout.pageKind !== "product") {
    return { outcome: "failed", failureStage: "page_identity", reasonCode: "product_identity_missing" };
  }
  if (layout.securityChallenge || layout.interactiveBlock) {
    return {
      outcome: "rejected",
      failureStage: "interactive_block",
      reasonCode: layout.securityChallenge ? "security_challenge" : `interactive_${layout.interactiveBlock}`
    };
  }
  if (observation.availability === "out_of_stock") {
    return { outcome: "rejected", failureStage: "availability_binding", reasonCode: "listing_unavailable_layout" };
  }
  if (observation.selectedOffer?.selectionState === "unresolved") {
    return { outcome: "rejected", failureStage: "offer_binding", reasonCode: "listing_variant_unselected" };
  }
  if (layout.addControlCount === 0) {
    return {
      outcome: "failed",
      failureStage: "add_control",
      reasonCode: (layout.genericAddIntentCount ?? 0) > 0 ? "add_control_selector_miss" : "add_control_missing"
    };
  }
  if (layout.addControlCount > 1 && layout.scopedControlCount !== 1) {
    return { outcome: "failed", failureStage: "add_control", reasonCode: "add_control_ambiguous" };
  }
  if (!observation.addControlActionable && layout.scopedControlCount > 0) {
    return { outcome: "rejected", failureStage: "add_control", reasonCode: "add_control_disabled" };
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
  return { outcome: "passed", failureStage: "complete", reasonCode: "verified" };
}

export function collectTargetShadowAttempt(
  documentValue: Document = globalThis.document,
  urlValue: string = globalThis.location?.href ?? "",
  requiredFulfillment: Fulfillment = "shipping",
  attemptCount = 1,
  domChanged = false,
  environment?: AdapterEnvironment
): { observation: TargetShadowObservationInput; diagnostic: RetailerAdapterDiagnosticInput; trace?: AdapterTraceEntry[] } {
  const traceBuffer = environment ? createAdapterTraceBuffer() : null;
  const tracedEnvironment = environment && traceBuffer ? {
    ...environment,
    trace: {
      record(entry: AdapterTraceEntry) {
        traceBuffer.record(entry);
        environment.trace?.record(entry);
      }
    }
  } satisfies AdapterEnvironment : undefined;
  const observation = collectTargetShadowObservation(documentValue, urlValue, requiredFulfillment, tracedEnvironment);
  const layout = targetAdapterLayoutEvidence(
    documentValue,
    urlValue,
    observation.retailerSku,
    requiredFulfillment,
    tracedEnvironment
  );
  const state = targetObservationDiagnosticState(observation, layout);
  return {
    observation,
    diagnostic: {
      contractVersion: 1,
      observedAt: observation.observedAt,
      retailerId: "target",
      retailerSku: observation.retailerSku,
      adapterVersion: TARGET_OBSERVER_VERSION,
      operation: "observe",
      outcome: state.outcome,
      failureStage: state.failureStage,
      reasonCode: state.reasonCode,
      attemptCount: Math.max(1, Math.min(3, Math.trunc(attemptCount) || 1)),
      domChanged: domChanged === true,
      layout
    },
    ...(traceBuffer ? { trace: traceBuffer.entries } : {})
  };
}

Object.defineProperty(globalThis, "YoinkTargetShadow", {
  value: Object.freeze({ collectTargetShadowAttempt, collectTargetShadowObservation }),
  configurable: true
});
