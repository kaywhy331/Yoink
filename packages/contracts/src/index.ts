export const ACTIONS = ["notify", "add_to_cart", "prepare_checkout", "submit_order"] as const;
export { ADD_LANE_IDS, ADD_LANES, addLane, type AddLaneDefinition, type AddLaneId } from "./add-lanes.js";
export type Action = (typeof ACTIONS)[number];

/**
 * Deployment-owned capabilities for internal workload identities. A hosted
 * service is assigned exactly one of these values after its signed actor
 * identity has been verified; callers never select a capability themselves.
 */
export const INTERNAL_SERVICE_CAPABILITY_POLICY_VERSION = 1;
export const INTERNAL_SERVICE_CAPABILITIES = [
  "internal.delivery",
  "internal.eligibility",
  "internal.principal"
] as const;
export type InternalServiceCapability = (typeof INTERNAL_SERVICE_CAPABILITIES)[number];

export const PRICE_POLICY_KINDS = [
  "below_msrp",
  "at_or_below_msrp",
  "slightly_above_msrp",
  "absolute_max",
  "above_msrp",
  "any"
] as const;
export type PricePolicyKind = (typeof PRICE_POLICY_KINDS)[number];

export type SellerPolicy = "first_party_only" | "allow_third_party";
export type SellerType = "first_party" | "third_party" | "unknown";
export type Fulfillment = "shipping" | "pickup" | "either" | "manual" | "unknown";
export const ACTION_FULFILLMENTS = ["shipping", "pickup"] as const;
export type ActionFulfillment = (typeof ACTION_FULFILLMENTS)[number];
export type Availability = "in_stock" | "preorder" | "out_of_stock" | "unknown";
export const TARGET_OBSERVER_VERSION = "target-observer-v9";
export const WALMART_OBSERVER_VERSION = "walmart-observer-v8";
export const WALMART_DRAW_OBSERVER_VERSION = "walmart-draw-observer-v2";
export const AMAZON_OBSERVER_VERSION = "amazon-observer-v9";
export const BESTBUY_OBSERVER_VERSION = "bestbuy-observer-v14";
export const DISNEY_OBSERVER_VERSION = "disney-observer-v2";
export const RAVENSBURGER_OBSERVER_VERSION = "ravensburger-observer-v2";
export const RIOT_OBSERVER_VERSION = "riot-observer-v2";
export const BOOKSAMILLION_OBSERVER_VERSION = "booksamillion-observer-v2";
export const FANATICS_OBSERVER_VERSION = "fanatics-observer-v2";
export const KOHLS_OBSERVER_VERSION = "kohls-observer-v2";
export const MACYS_OBSERVER_VERSION = "macys-observer-v2";
export const PBANDAI_OBSERVER_VERSION = "pbandai-observer-v3";
export const POKEMONCENTER_OBSERVER_VERSION = "pokemoncenter-observer-v4";
export const ASUS_OBSERVER_VERSION = "asus-observer-v1";
export const AUDIOADVICE_OBSERVER_VERSION = "audioadvice-observer-v1";
export const BANANAREPUBLIC_OBSERVER_VERSION = "bananarepublic-observer-v1";
export const BANANAREPUBLICFACTORY_OBSERVER_VERSION = "bananarepublicfactory-observer-v1";
export const ATHLETA_OBSERVER_VERSION = "athleta-observer-v1";
export const AMERICANEAGLE_OBSERVER_VERSION = "americaneagle-observer-v1";
export const ANINEBING_OBSERVER_VERSION = "aninebing-observer-v1";
export const RETAILER_OBSERVER_VERSIONS = {
  target: TARGET_OBSERVER_VERSION,
  walmart: WALMART_OBSERVER_VERSION,
  amazon: AMAZON_OBSERVER_VERSION,
  bestbuy: BESTBUY_OBSERVER_VERSION,
  disney: DISNEY_OBSERVER_VERSION,
  ravensburger: RAVENSBURGER_OBSERVER_VERSION,
  riot: RIOT_OBSERVER_VERSION,
  booksamillion: BOOKSAMILLION_OBSERVER_VERSION,
  fanatics: FANATICS_OBSERVER_VERSION,
  kohls: KOHLS_OBSERVER_VERSION,
  macys: MACYS_OBSERVER_VERSION,
  pbandai: PBANDAI_OBSERVER_VERSION,
  pokemoncenter: POKEMONCENTER_OBSERVER_VERSION,
  asus: ASUS_OBSERVER_VERSION,
  audioadvice: AUDIOADVICE_OBSERVER_VERSION,
  bananarepublic: BANANAREPUBLIC_OBSERVER_VERSION,
  bananarepublicfactory: BANANAREPUBLICFACTORY_OBSERVER_VERSION,
  athleta: ATHLETA_OBSERVER_VERSION,
  americaneagle: AMERICANEAGLE_OBSERVER_VERSION,
  aninebing: ANINEBING_OBSERVER_VERSION
} as const;
export type SupportedRetailerId = keyof typeof RETAILER_OBSERVER_VERSIONS;
export type RetailerObserverVersion = (typeof RETAILER_OBSERVER_VERSIONS)[SupportedRetailerId];
export const TARGET_ADD_ADAPTER_VERSION = "target-add-v12";
export const TARGET_ADD_CONTRACT_VERSION = TARGET_ADD_ADAPTER_VERSION;
export const TARGET_SELECTOR_PACK_VERSION = "target-pack-v1";
export const TARGET_ADD_ACTIVATION_CONFIRMATION = "ENABLE_TARGET_ADD_V12";
export const WALMART_ADD_ADAPTER_VERSION = "walmart-add-v10";
export const WALMART_ADD_CONTRACT_VERSION = WALMART_ADD_ADAPTER_VERSION;
export const WALMART_SELECTOR_PACK_VERSION = "walmart-pack-v1";
export const WALMART_ADD_ACTIVATION_CONFIRMATION = "ENABLE_WALMART_ADD_V10";
export const AMAZON_ADD_ADAPTER_VERSION = "amazon-add-v11";
export const AMAZON_ADD_CONTRACT_VERSION = AMAZON_ADD_ADAPTER_VERSION;
export const AMAZON_SELECTOR_PACK_VERSION = "amazon-pack-v2";
export const AMAZON_ADD_ACTIVATION_CONFIRMATION = "ENABLE_AMAZON_ADD_V11";
export const BESTBUY_ADD_ADAPTER_VERSION = "bestbuy-add-v18";
export const BESTBUY_ADD_CONTRACT_VERSION = BESTBUY_ADD_ADAPTER_VERSION;
export const BESTBUY_SELECTOR_PACK_VERSION = "bestbuy-pack-v2";
export const BESTBUY_ADD_ACTIVATION_CONFIRMATION = "ENABLE_BESTBUY_ADD_V18";
export const POKEMONCENTER_ADD_ADAPTER_VERSION = "pokemoncenter-add-v1";
export const ASUS_ADD_ADAPTER_VERSION = "asus-add-v1";
export const AUDIOADVICE_ADD_ADAPTER_VERSION = "audioadvice-add-v1";
export const BANANAREPUBLIC_ADD_ADAPTER_VERSION = "bananarepublic-add-v1";
export const BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION = "bananarepublicfactory-add-v1";
export const ATHLETA_ADD_ADAPTER_VERSION = "athleta-add-v1";
export const AMERICANEAGLE_ADD_ADAPTER_VERSION = "americaneagle-add-v1";
export const ANINEBING_ADD_ADAPTER_VERSION = "aninebing-add-v1";
export const POKEMONCENTER_ADD_CONTRACT_VERSION = POKEMONCENTER_ADD_ADAPTER_VERSION;
export const ASUS_ADD_CONTRACT_VERSION = ASUS_ADD_ADAPTER_VERSION;
export const AUDIOADVICE_ADD_CONTRACT_VERSION = AUDIOADVICE_ADD_ADAPTER_VERSION;
export const BANANAREPUBLIC_ADD_CONTRACT_VERSION = BANANAREPUBLIC_ADD_ADAPTER_VERSION;
export const BANANAREPUBLICFACTORY_ADD_CONTRACT_VERSION = BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION;
export const ATHLETA_ADD_CONTRACT_VERSION = ATHLETA_ADD_ADAPTER_VERSION;
export const AMERICANEAGLE_ADD_CONTRACT_VERSION = AMERICANEAGLE_ADD_ADAPTER_VERSION;
export const ANINEBING_ADD_CONTRACT_VERSION = ANINEBING_ADD_ADAPTER_VERSION;
export const POKEMONCENTER_ADD_ACTIVATION_CONFIRMATION = "ENABLE_POKEMONCENTER_ADD_V1";
export const ASUS_ADD_ACTIVATION_CONFIRMATION = "ENABLE_ASUS_ADD_V1";
export const AUDIOADVICE_ADD_ACTIVATION_CONFIRMATION = "ENABLE_AUDIOADVICE_ADD_V1";
export const BANANAREPUBLIC_ADD_ACTIVATION_CONFIRMATION = "ENABLE_BANANAREPUBLIC_ADD_V1";
export const BANANAREPUBLICFACTORY_ADD_ACTIVATION_CONFIRMATION = "ENABLE_BANANAREPUBLICFACTORY_ADD_V1";
export const ATHLETA_ADD_ACTIVATION_CONFIRMATION = "ENABLE_ATHLETA_ADD_V1";
export const AMERICANEAGLE_ADD_ACTIVATION_CONFIRMATION = "ENABLE_AMERICANEAGLE_ADD_V1";
export const ANINEBING_ADD_ACTIVATION_CONFIRMATION = "ENABLE_ANINEBING_ADD_V1";
export const RETAILERS_SELECTOR_PACK_VERSION = "retailers-pack-v1";
export const DISNEY_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const RAVENSBURGER_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const RIOT_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const BOOKSAMILLION_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const FANATICS_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const KOHLS_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const MACYS_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const PBANDAI_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const POKEMONCENTER_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const ASUS_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const AUDIOADVICE_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const BANANAREPUBLIC_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const BANANAREPUBLICFACTORY_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const ATHLETA_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const AMERICANEAGLE_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const ANINEBING_SELECTOR_PACK_VERSION = RETAILERS_SELECTOR_PACK_VERSION;
export const RETAILER_SELECTOR_PACK_VERSIONS = {
  target: TARGET_SELECTOR_PACK_VERSION,
  walmart: WALMART_SELECTOR_PACK_VERSION,
  amazon: AMAZON_SELECTOR_PACK_VERSION,
  bestbuy: BESTBUY_SELECTOR_PACK_VERSION,
  disney: DISNEY_SELECTOR_PACK_VERSION,
  ravensburger: RAVENSBURGER_SELECTOR_PACK_VERSION,
  riot: RIOT_SELECTOR_PACK_VERSION,
  booksamillion: BOOKSAMILLION_SELECTOR_PACK_VERSION,
  fanatics: FANATICS_SELECTOR_PACK_VERSION,
  kohls: KOHLS_SELECTOR_PACK_VERSION,
  macys: MACYS_SELECTOR_PACK_VERSION,
  pbandai: PBANDAI_SELECTOR_PACK_VERSION,
  pokemoncenter: POKEMONCENTER_SELECTOR_PACK_VERSION,
  asus: ASUS_SELECTOR_PACK_VERSION,
  audioadvice: AUDIOADVICE_SELECTOR_PACK_VERSION,
  bananarepublic: BANANAREPUBLIC_SELECTOR_PACK_VERSION,
  bananarepublicfactory: BANANAREPUBLICFACTORY_SELECTOR_PACK_VERSION,
  athleta: ATHLETA_SELECTOR_PACK_VERSION,
  americaneagle: AMERICANEAGLE_SELECTOR_PACK_VERSION,
  aninebing: ANINEBING_SELECTOR_PACK_VERSION
} as const satisfies Record<SupportedRetailerId, string>;

export const RETAILER_ADAPTER_DIAGNOSTIC_OPERATIONS = ["observe", "rehearse_add", "live_add"] as const;
export type RetailerAdapterDiagnosticOperation = (typeof RETAILER_ADAPTER_DIAGNOSTIC_OPERATIONS)[number];
export const RETAILER_ADAPTER_DIAGNOSTIC_OUTCOMES = ["passed", "failed", "rejected", "recovered"] as const;
export type RetailerAdapterDiagnosticOutcome = (typeof RETAILER_ADAPTER_DIAGNOSTIC_OUTCOMES)[number];
export const RETAILER_ADAPTER_DIAGNOSTIC_STAGES = [
  "complete",
  "page_identity",
  "interactive_block",
  "availability_binding",
  "add_control",
  "sku_binding",
  "offer_binding",
  "price_binding",
  "seller_binding",
  "fulfillment_binding",
  "quantity_binding",
  "route_binding",
  "policy",
  "runner"
] as const;
export type RetailerAdapterDiagnosticStage = (typeof RETAILER_ADAPTER_DIAGNOSTIC_STAGES)[number];
export const RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES = [
  "verified",
  "dom_hydration_recovered",
  "semantic_layout_recovered",
  "observer_bundle_injection_failed",
  "observer_execution_failed",
  "observer_top_frame_missing",
  "observer_runtime_unavailable",
  "observer_collection_failed",
  "observer_contract_invalid",
  "product_identity_missing",
  "security_challenge",
  "interactive_auth",
  "interactive_mfa",
  "interactive_location",
  "interactive_membership",
  "interactive_queue",
  "interactive_high_demand",
  "interactive_unknown",
  "availability_selector_miss",
  "add_control_selector_miss",
  "add_control_missing",
  "add_control_ambiguous",
  "add_control_disabled",
  "explicit_sku_binding_missing",
  "explicit_sku_binding_ambiguous",
  "offer_binding_missing",
  "offer_binding_ambiguous",
  "price_selector_miss",
  "price_binding_missing",
  "seller_selector_miss",
  "seller_binding_missing",
  "fulfillment_selector_miss",
  "fulfillment_binding_missing",
  "selected_offer_binding_unresolved",
  "listing_unavailable_layout",
  "listing_variant_unselected",
  "offer_scope_not_actionable",
  "not_applicable",
  "offer_not_actionable",
  "offer_id_missing_or_ambiguous",
  "offer_route_verified",
  "route_validation_failed",
  "route_binding_failed",
  "rehearsal_failed",
  "runner_unavailable",
  "runner_failed",
  "runner_no_result",
  "adapter_version_mismatch",
  "unsupported_action",
  "quantity_not_supported",
  "seller_policy_not_supported",
  "fulfillment_not_supported",
  "contract_version_mismatch",
  "job_identity_invalid",
  "canonical_url_invalid",
  "quantity_invalid",
  "unit_cap_invalid",
  "total_cap_invalid",
  "job_expired",
  "offer_stale",
  "listing_mismatch",
  "product_page_unverified",
  "product_page_unavailable",
  "manual_action_required",
  "preorder_not_supported",
  "out_of_stock",
  "add_control_unavailable",
  "currency_mismatch",
  "seller_unverified",
  "third_party_seller",
  "signal_seller_mismatch",
  "price_unavailable",
  "over_unit_cap",
  "over_total_cap",
  "fulfillment_unverified",
  "authorization_missing",
  "authorization_expired",
  "add_control_changed",
  "fulfillment_selection_failed",
  "offer_binding_changed",
  "click_failed",
  "offer_unverified",
  "click_uncertain",
  "cart_page_unverified",
  "cart_unverified",
  "foreign_cart_line",
  "verified_empty",
  "cart_evidence_stale",
  "offer_proof_mismatch",
  "quantity_unavailable",
  "clicked",
  // Live-add results the shared contract can return, recorded as they are
  // rather than failing the diagnostic (and with it the job report).
  "stock_unverified",
  "listed_price_changed",
  "desired_variant_unverified",
  "desired_variant_changed",
  "official_msrp_authorization_missing",
  "official_msrp_authorization_invalid",
  "official_msrp_cart_policy_invalid",
  // Raising a cart line to the shopper's quantity (Kevin, 2026-10-10).
  "quantity_control_unavailable",
  "quantity_line_ambiguous",
  "quantity_unchanged",
  "quantity_limit_reached",
  // A quantity the product page wouldn't show, or that changed before the click (Amazon).
  "quantity_unverified",
  "quantity_changed",
  // A cart that changed other than by the add (Kevin's repeat NeeDoh call, 2026-10-12):
  // its snapshot was refused for want of this code, so the cart page never reached diagnostics.
  "cart_delta_unverified",
  // Amazon's buy box with no offer it features, only See All Buying Options (Kevin's NeeDoh, 2026-10-12).
  "no_featured_offer"
] as const;
export type RetailerAdapterDiagnosticReasonCode = (typeof RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES)[number];

/**
 * One bounded receipt for an automatic (or manual) store re-verification run
 * performed by the Chrome companion. It carries counts, enums, and reason
 * codes only: no product URLs, page text, or observed offer values. The
 * server uses it to expose the last automatic result on the readiness plan
 * and to open a "store checks stalled" operator alert after repeated
 * non-passing runs. It cannot qualify, lease, or execute anything.
 */
export const RETAILER_REVERIFICATION_RUN_CONTRACT_VERSION = 1;
export const RETAILER_REVERIFICATION_RUN_TRIGGERS = ["scheduled", "plan_changed", "manual", "settings_enabled"] as const;
export type RetailerReverificationRunTrigger = (typeof RETAILER_REVERIFICATION_RUN_TRIGGERS)[number];
export const RETAILER_REVERIFICATION_RUN_OUTCOMES = [
  "passed", "partial", "blocked", "missing_candidate", "access_missing", "parked", "error", "skipped"
] as const;
export type RetailerReverificationRunOutcome = (typeof RETAILER_REVERIFICATION_RUN_OUTCOMES)[number];
export const RETAILER_REVERIFICATION_RUN_MAX_PRODUCTS = 8;
export interface RetailerReverificationRunInput {
  contractVersion: typeof RETAILER_REVERIFICATION_RUN_CONTRACT_VERSION;
  runId: string;
  retailerId: "target" | "walmart" | "amazon" | "bestbuy" | "pokemoncenter" | "aninebing" | "americaneagle" | "asus" | "athleta" | "audioadvice" | "bananarepublic" | "bananarepublicfactory";
  automatic: boolean;
  trigger: RetailerReverificationRunTrigger;
  outcome: RetailerReverificationRunOutcome;
  reasonCode: string;
  attemptedProductCount: number;
  passedProductCount: number;
  startedAt: string;
  finishedAt: string;
  extensionVersion: string;
  planSignature: string;
}

export const RETAILER_ADAPTER_REPAIR_LANDMARK_ATTRIBUTES = [
  "data-testid", "data-test-id", "data-automation-id", "data-button-state", "name", "itemprop"
] as const;
export type RetailerAdapterRepairLandmarkAttribute =
  (typeof RETAILER_ADAPTER_REPAIR_LANDMARK_ATTRIBUTES)[number];

/**
 * A deliberately narrow structural landmark for one of the five packaged
 * read-only commerce fields. It contains no DOM text, class list, ID, URL,
 * product value, seller value, price, or arbitrary selector. The server
 * independently validates this shape before deriving a non-executable
 * suggestion.
 */
export interface RetailerAdapterRepairLandmark {
  field: "availability" | "unitPrice" | "seller" | "fulfillment" | "addControl";
  elementKind: "button" | "input" | "role_button" | "div" | "span" | "p" | "label" | "section" | "li";
  attribute: RetailerAdapterRepairLandmarkAttribute;
  value: string;
}

export interface RetailerAdapterLayoutEvidence {
  schemaVersion: 1;
  pageKind: "product" | "other";
  scopeKind: "none" | "form" | "buybox" | "qualified_buybox" | "accordion" | "other";
  sellerShape: "none" | "legacy" | "offer_display_combined" | "offer_display_split";
  fulfillmentShape: "none" | "shipping" | "pickup" | "mixed";
  addControlCount: number;
  /** Count-only drift signal; optional so diagnostics from the preceding companion remain ingestible. */
  genericAddIntentCount?: number;
  /** Privacy-bounded semantic candidate counts; omitted when zero for backward-stable fingerprints. */
  genericAvailabilityCandidateCount?: number;
  genericPriceCandidateCount?: number;
  genericSellerCandidateCount?: number;
  genericFulfillmentCandidateCount?: number;
  scopedControlCount: number;
  explicitSkuInputCount: number;
  exactSkuInputCount: number;
  variationSkuCount: number;
  canonicalOfferInputCount: number;
  canonicalOfferDistinctCount: number;
  alternateOfferInputCount: number;
  alternateOfferDistinctCount: number;
  priceCandidateCount: number;
  quantityControlCount: number;
  securityChallenge: boolean;
  interactiveBlock: "" | "auth" | "mfa" | "location" | "membership" | "queue" | "high_demand" | "unknown";
  /** Optional additive evidence emitted only for locally unique, stable structural attributes. */
  repairLandmarks?: RetailerAdapterRepairLandmark[];
}

export interface RetailerAdapterDiagnosticInput {
  contractVersion: 1;
  observedAt: string;
  retailerId: SupportedRetailerId;
  retailerSku: string;
  adapterVersion: string;
  packVersion?: string;
  operation: RetailerAdapterDiagnosticOperation;
  outcome: RetailerAdapterDiagnosticOutcome;
  failureStage: RetailerAdapterDiagnosticStage;
  reasonCode: string;
  attemptCount: number;
  domChanged: boolean;
  layout: RetailerAdapterLayoutEvidence;
}

export const ADAPTER_TRACE_STEPS = [
  "page_identity",
  "interactive_block",
  "structured_offer",
  "offer_scope",
  "add_control",
  "availability",
  "price",
  "seller",
  "fulfillment",
  "quantity",
  "route",
  "sku_binding",
  "trace"
] as const;
export type AdapterTraceStep = (typeof ADAPTER_TRACE_STEPS)[number];
export const ADAPTER_TRACE_REJECTIONS = [
  "not_visible",
  "outside_offer_root",
  "merchandising_scope",
  "sku_mismatch",
  "disabled",
  "ambiguous",
  "intent_mismatch",
  "pattern_mismatch",
  "no_price_text",
  "foreign_currency",
  "condition_failed",
  "not_selected",
  "not_actionable"
] as const;
export type AdapterTraceRejection = (typeof ADAPTER_TRACE_REJECTIONS)[number];

/** Local-only adapter decision detail. This type is never part of the hosted diagnostic contract. */
export interface AdapterTraceEntry {
  step: AdapterTraceStep;
  selector?: string;
  matched?: number;
  visible?: number;
  scoped?: number;
  chosen?: number;
  reject?: AdapterTraceRejection;
  condition?: string;
  expected?: string;
  actual?: string;
  passed?: boolean;
  truncated?: true;
}

export interface AdapterTraceSink {
  record(entry: AdapterTraceEntry): void;
}

export interface AdapterEnvironment {
  trace?: AdapterTraceSink;
  /** Supplied only by offline replay. Production adapters do not derive visibility from page attributes. */
  isVisible?: (element: Element) => boolean;
}

/** A privacy-bounded, local-only trace sink used by capture and offline replay. */
export interface AdapterTraceBuffer extends AdapterTraceSink {
  readonly entries: AdapterTraceEntry[];
}

function boundedTraceText(value: unknown, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

export function createAdapterTraceBuffer(maximumEntries = 300): AdapterTraceBuffer {
  const maximum = Math.max(1, Math.min(300, Math.trunc(maximumEntries) || 300));
  const entries: AdapterTraceEntry[] = [];
  let truncated = false;
  return {
    entries,
    record(entry) {
      if (truncated) return;
      if (entries.length >= maximum) {
        entries[maximum - 1] = { step: "trace", truncated: true };
        truncated = true;
        return;
      }
      const normalized: AdapterTraceEntry = { ...entry };
      if (entry.selector !== undefined) normalized.selector = boundedTraceText(entry.selector, 200) ?? "";
      if (entry.condition !== undefined) normalized.condition = boundedTraceText(entry.condition, 80) ?? "";
      if (entry.expected !== undefined) normalized.expected = boundedTraceText(entry.expected, 60) ?? "";
      if (entry.actual !== undefined) normalized.actual = boundedTraceText(entry.actual, 60) ?? "";
      entries.push(normalized);
    }
  };
}

export const EVIDENCE_CAPSULE_CONTRACT_VERSION = 1;
export const EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;
export const EVIDENCE_CAPSULE_TRIGGERS = [
  "diagnostic_failed",
  "rehearsal_non_pass",
  "live_add_non_pass",
  "manual"
] as const;
export type EvidenceCapsuleTrigger = (typeof EVIDENCE_CAPSULE_TRIGGERS)[number];

export interface EvidenceCapsuleSnapshot {
  encoding: "gzip+base64";
  bytes: number;
  sha256: string;
  html: string;
}

export interface EvidenceCapsuleRedactions {
  scriptsRemoved: number;
  jsonBlocksKept: number;
  keysRedacted: number;
  inputsCleared: number;
  iframesReduced: number;
  mediaStripped: number;
  textRedactions: number;
}

export interface EvidenceCapsuleEnvelope {
  contractVersion: typeof EVIDENCE_CAPSULE_CONTRACT_VERSION;
  id: string;
  capturedAt: string;
  retailerId: SupportedRetailerId;
  retailerSku: string;
  operation: RetailerAdapterDiagnosticOperation;
  trigger: EvidenceCapsuleTrigger;
  outcome: RetailerAdapterDiagnosticOutcome;
  failureStage: RetailerAdapterDiagnosticStage;
  reasonCode: string;
  observerVersion: string;
  addAdapterVersion: string;
  packVersion: string;
  extensionVersion: string;
  url: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
  requiredFulfillment: "shipping" | "pickup";
  diagnostic: RetailerAdapterDiagnosticInput;
  trace: AdapterTraceEntry[];
  snapshot: EvidenceCapsuleSnapshot;
  redactions: EvidenceCapsuleRedactions;
  reductionApplied: Array<"svg_children" | "styles" | "hidden_elements" | "cut_at_cap">;
  truncated: boolean;
}

export interface EvidenceCapsuleIndexEntry {
  id: string;
  retailerId: SupportedRetailerId;
  retailerSku: string;
  operation: RetailerAdapterDiagnosticOperation;
  trigger: EvidenceCapsuleTrigger;
  outcome: RetailerAdapterDiagnosticOutcome;
  failureStage: RetailerAdapterDiagnosticStage;
  reasonCode: string;
  observerVersion: string;
  addAdapterVersion: string;
  packVersion: string;
  extensionVersion: string;
  layoutFingerprint: string;
  sha256: string;
  bytes: number;
  capturedAt: string;
  receivedAt: string;
  expiresAt: string;
  incidentKeyHash: string;
  path: string;
}

export const OPERATOR_ALERT_EVENT_FAMILIES = ["adapter_repair", "qualification_stalled"] as const;
export type OperatorAlertEventFamily = (typeof OPERATOR_ALERT_EVENT_FAMILIES)[number];
export const OPERATOR_ALERT_SEVERITIES = ["info", "warning", "error", "critical"] as const;
export type OperatorAlertSeverity = (typeof OPERATOR_ALERT_SEVERITIES)[number];
export const OPERATOR_ALERT_ROUTES = ["dashboard", "audit_outbox"] as const;
export type OperatorAlertRoute = (typeof OPERATOR_ALERT_ROUTES)[number];
export const OPERATOR_ALERT_CONNECTOR_KINDS = ["webhook"] as const;
export type OperatorAlertConnectorKind = (typeof OPERATOR_ALERT_CONNECTOR_KINDS)[number];
export const SAVE_OPERATOR_ALERT_RULE_CONFIRMATION = "SAVE_OPERATOR_ALERT_RULE";
export const SAVE_OPERATOR_ALERT_CONNECTOR_CONFIRMATION = "SAVE_OPERATOR_ALERT_CONNECTOR";
export const RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION = "RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY";
export const ACKNOWLEDGE_OPERATOR_ALERT_CONFIRMATION = "ACKNOWLEDGE_OPERATOR_ALERT";
export const RESOLVE_OPERATOR_ALERT_CONFIRMATION = "RESOLVE_OPERATOR_ALERT";
export const OPERATOR_ALERT_CONNECTOR_REPLAY_REASON_CODES = [
  "receiver_recovered",
  "rate_limit_cleared",
  "operator_verified_retry"
] as const;
export type OperatorAlertConnectorReplayReasonCode = (typeof OPERATOR_ALERT_CONNECTOR_REPLAY_REASON_CODES)[number];
export const OPERATOR_ALERT_ACKNOWLEDGEMENT_REASON_CODES = ["operator_investigating"] as const;
export type OperatorAlertAcknowledgementReasonCode = (typeof OPERATOR_ALERT_ACKNOWLEDGEMENT_REASON_CODES)[number];
export const OPERATOR_ALERT_RESOLUTION_REASON_CODES = [
  "maintainer_resolved",
  "maintainer_triaged",
  "false_positive",
  "superseded_by_release",
  "adapter_fixed_by_replay"
] as const;
export type OperatorAlertResolutionReasonCode = (typeof OPERATOR_ALERT_RESOLUTION_REASON_CODES)[number];
export const ADAPTER_REPAIR_RECHECK_REASON_CODES = [
  "adapter_fixed_by_replay",
  "regressed_after_replay_fix"
] as const;
export type AdapterRepairRecheckReasonCode = (typeof ADAPTER_REPAIR_RECHECK_REASON_CODES)[number];

/**
 * Operator alerts are deliberately limited to sanitized aggregate diagnostics.
 * They are separate from end-user product notifications and cannot authorize
 * retailer mutation.
 */
export interface OperatorAlertRuleInput {
  eventFamily: OperatorAlertEventFamily;
  name: string;
  enabled: boolean;
  severity: OperatorAlertSeverity;
  minimumOccurrences: number;
  dedupeWindowSeconds: number;
  escalationAfterSeconds: number;
  retailerScope: SupportedRetailerId | "*";
  operationScope: RetailerAdapterDiagnosticOperation | "*";
  routes: OperatorAlertRoute[];
  confirmation: typeof SAVE_OPERATOR_ALERT_RULE_CONFIRMATION;
}

/**
 * Connector destinations are deployment-owned. Admins may bind an alert
 * connector to an opaque reference, but URLs and signing secrets are never
 * accepted through the API or persisted in Yoink's database.
 */
export interface OperatorAlertConnectorInput {
  name: string;
  enabled: boolean;
  kind: OperatorAlertConnectorKind;
  endpointReference: string;
  minimumSeverity: OperatorAlertSeverity;
  confirmation: typeof SAVE_OPERATOR_ALERT_CONNECTOR_CONFIRMATION;
}

/**
 * A manual replay retains the original delivery identity, payload, and exact
 * deployment binding. It cannot create or retarget an alert message.
 */
export interface OperatorAlertConnectorReplayInput {
  reasonCode: OperatorAlertConnectorReplayReasonCode;
  confirmation: typeof RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY_CONFIRMATION;
}

export interface OperatorAlertAcknowledgeInput {
  reasonCode: OperatorAlertAcknowledgementReasonCode;
  note?: string;
  confirmation: typeof ACKNOWLEDGE_OPERATOR_ALERT_CONFIRMATION;
}

export interface OperatorAlertResolveInput {
  reasonCode: OperatorAlertResolutionReasonCode;
  note: string;
  confirmation: typeof RESOLVE_OPERATOR_ALERT_CONFIRMATION;
}

export interface TargetAddRehearsalInput {
  adapterVersion: typeof TARGET_ADD_ADAPTER_VERSION;
  observerVersion: typeof TARGET_OBSERVER_VERSION;
  packVersion?: string;
  contractVersion: 1;
  shadowObservationId: string;
  observedAt: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
}

export interface TargetAddActivationInput {
  adapterVersion: typeof TARGET_ADD_ADAPTER_VERSION;
  evidenceHash: string;
  confirmation: typeof TARGET_ADD_ACTIVATION_CONFIRMATION;
}

export interface WalmartAddRehearsalInput {
  adapterVersion: typeof WALMART_ADD_ADAPTER_VERSION;
  observerVersion: typeof WALMART_OBSERVER_VERSION;
  packVersion?: string;
  contractVersion: 1;
  shadowObservationId: string;
  observedAt: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
}

export interface WalmartAddActivationInput {
  adapterVersion: typeof WALMART_ADD_ADAPTER_VERSION;
  evidenceHash: string;
  confirmation: typeof WALMART_ADD_ACTIVATION_CONFIRMATION;
}

export interface AmazonAddRehearsalInput {
  adapterVersion: typeof AMAZON_ADD_ADAPTER_VERSION;
  observerVersion: typeof AMAZON_OBSERVER_VERSION;
  packVersion?: string;
  contractVersion: 1;
  shadowObservationId: string;
  observedAt: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
}

export interface AmazonAddActivationInput {
  adapterVersion: typeof AMAZON_ADD_ADAPTER_VERSION;
  evidenceHash: string;
  confirmation: typeof AMAZON_ADD_ACTIVATION_CONFIRMATION;
}

export interface BestBuyAddRehearsalInput {
  adapterVersion: typeof BESTBUY_ADD_ADAPTER_VERSION;
  observerVersion: typeof BESTBUY_OBSERVER_VERSION;
  packVersion?: string;
  contractVersion: 1;
  shadowObservationId: string;
  observedAt: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
}

export interface BestBuyAddActivationInput {
  adapterVersion: typeof BESTBUY_ADD_ADAPTER_VERSION;
  evidenceHash: string;
  confirmation: typeof BESTBUY_ADD_ACTIVATION_CONFIRMATION;
}

export interface PokemonCenterAddRehearsalInput {
  adapterVersion: typeof POKEMONCENTER_ADD_ADAPTER_VERSION;
  observerVersion: typeof POKEMONCENTER_OBSERVER_VERSION;
  packVersion?: string;
  contractVersion: 1;
  shadowObservationId: string;
  observedAt: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
}

export interface AnineBingAddRehearsalInput {
  adapterVersion: typeof ANINEBING_ADD_ADAPTER_VERSION;
  observerVersion: typeof ANINEBING_OBSERVER_VERSION;
  packVersion?: string;
  contractVersion: 1;
  shadowObservationId: string;
  observedAt: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
}

export interface AmericanEagleAddRehearsalInput {
  adapterVersion: typeof AMERICANEAGLE_ADD_ADAPTER_VERSION;
  observerVersion: typeof AMERICANEAGLE_OBSERVER_VERSION;
  packVersion?: string;
  contractVersion: 1;
  shadowObservationId: string;
  observedAt: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
}

export interface AthletaAddRehearsalInput {
  adapterVersion: typeof ATHLETA_ADD_ADAPTER_VERSION;
  observerVersion: typeof ATHLETA_OBSERVER_VERSION;
  packVersion?: string;
  contractVersion: 1;
  shadowObservationId: string;
  observedAt: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
}

export interface AudioAdviceAddRehearsalInput {
  adapterVersion: typeof AUDIOADVICE_ADD_ADAPTER_VERSION;
  observerVersion: typeof AUDIOADVICE_OBSERVER_VERSION;
  packVersion?: string;
  contractVersion: 1;
  shadowObservationId: string;
  observedAt: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
}

export interface BananaRepublicAddRehearsalInput {
  adapterVersion: typeof BANANAREPUBLIC_ADD_ADAPTER_VERSION;
  observerVersion: typeof BANANAREPUBLIC_OBSERVER_VERSION;
  packVersion?: string;
  contractVersion: 1;
  shadowObservationId: string;
  observedAt: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
}

export interface BananaRepublicFactoryAddRehearsalInput {
  adapterVersion: typeof BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION;
  observerVersion: typeof BANANAREPUBLICFACTORY_OBSERVER_VERSION;
  packVersion?: string;
  contractVersion: 1;
  shadowObservationId: string;
  observedAt: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
}

export interface AsusAddRehearsalInput {
  adapterVersion: typeof ASUS_ADD_ADAPTER_VERSION;
  observerVersion: typeof ASUS_OBSERVER_VERSION;
  packVersion?: string;
  contractVersion: 1;
  shadowObservationId: string;
  observedAt: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
}

export interface PokemonCenterAddActivationInput {
  adapterVersion: typeof POKEMONCENTER_ADD_ADAPTER_VERSION;
  evidenceHash: string;
  confirmation: typeof POKEMONCENTER_ADD_ACTIVATION_CONFIRMATION;
}

export interface AnineBingAddActivationInput {
  adapterVersion: typeof ANINEBING_ADD_ADAPTER_VERSION;
  evidenceHash: string;
  confirmation: typeof ANINEBING_ADD_ACTIVATION_CONFIRMATION;
}

export interface AmericanEagleAddActivationInput {
  adapterVersion: typeof AMERICANEAGLE_ADD_ADAPTER_VERSION;
  evidenceHash: string;
  confirmation: typeof AMERICANEAGLE_ADD_ACTIVATION_CONFIRMATION;
}

export interface AthletaAddActivationInput {
  adapterVersion: typeof ATHLETA_ADD_ADAPTER_VERSION;
  evidenceHash: string;
  confirmation: typeof ATHLETA_ADD_ACTIVATION_CONFIRMATION;
}

export interface AudioAdviceAddActivationInput {
  adapterVersion: typeof AUDIOADVICE_ADD_ADAPTER_VERSION;
  evidenceHash: string;
  confirmation: typeof AUDIOADVICE_ADD_ACTIVATION_CONFIRMATION;
}

export interface BananaRepublicAddActivationInput {
  adapterVersion: typeof BANANAREPUBLIC_ADD_ADAPTER_VERSION;
  evidenceHash: string;
  confirmation: typeof BANANAREPUBLIC_ADD_ACTIVATION_CONFIRMATION;
}

export interface BananaRepublicFactoryAddActivationInput {
  adapterVersion: typeof BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION;
  evidenceHash: string;
  confirmation: typeof BANANAREPUBLICFACTORY_ADD_ACTIVATION_CONFIRMATION;
}

export interface AsusAddActivationInput {
  adapterVersion: typeof ASUS_ADD_ADAPTER_VERSION;
  evidenceHash: string;
  confirmation: typeof ASUS_ADD_ACTIVATION_CONFIRMATION;
}

export const SELECTED_OFFER_SCOPE_VERSION = 1;
export const SELECTED_OFFER_SELECTION_STATES = ["exact", "listing_only", "unresolved"] as const;
export type SelectedOfferSelectionState = (typeof SELECTED_OFFER_SELECTION_STATES)[number];
export const SELECTED_OFFER_ATTRIBUTE_KEYS = [
  "size", "color", "edition", "language", "pack", "condition", "finish", "style"
] as const;
export type SelectedOfferAttributeKey = (typeof SELECTED_OFFER_ATTRIBUTE_KEYS)[number];

/**
 * Public, normalized identity for the offer selected on a product page. This
 * contract deliberately excludes opaque offer tokens, DOM, form values, and
 * account/location data. A listing-only or unresolved scope is evidence, but
 * can never be promoted as exact community inventory.
 */
export interface SelectedOfferScopeInput {
  schemaVersion: typeof SELECTED_OFFER_SCOPE_VERSION;
  selectionState: SelectedOfferSelectionState;
  childOfferKey: string;
  attributes: Partial<Record<SelectedOfferAttributeKey, string>>;
}

export interface RetailerShadowObservationInput {
  adapterVersion: RetailerObserverVersion;
  contractVersion: 1;
  observedAt: string;
  pageKind: "product";
  retailerId: SupportedRetailerId;
  retailerSku: string;
  canonicalUrl?: string;
  availability: Availability;
  unitPriceCents: number | null;
  currency: "USD";
  sellerName: string;
  sellerType: SellerType;
  fulfillment: "shipping" | "pickup" | "unknown";
  addControlActionable: boolean;
  securityChallenge: boolean;
  interactiveBlock: "" | "auth" | "mfa" | "location" | "membership" | "queue" | "high_demand" | "unknown";
  purchaseRouteKind?: "none" | "amazon_buy_now";
  purchaseRouteReady?: boolean;
  routeReasonCode?: "not_applicable" | "offer_not_actionable" | "offer_id_missing_or_ambiguous" | "offer_route_verified" | "route_validation_failed";
  /** Optional only so previously packaged observers remain fail-closed and ingestible. */
  selectedOffer?: SelectedOfferScopeInput;
}

export interface TargetShadowObservationInput extends RetailerShadowObservationInput {
  adapterVersion: typeof TARGET_OBSERVER_VERSION;
  retailerId: "target";
}

export interface WalmartShadowObservationInput extends RetailerShadowObservationInput {
  adapterVersion: typeof WALMART_OBSERVER_VERSION;
  retailerId: "walmart";
}

export const WALMART_DRAW_STATES = ["active", "upcoming", "closed", "unknown"] as const;
export type WalmartDrawState = (typeof WALMART_DRAW_STATES)[number];
export const WALMART_DRAW_SCAN_OUTCOMES = ["passed", "partial", "failed", "manual"] as const;
export type WalmartDrawScanOutcome = (typeof WALMART_DRAW_SCAN_OUTCOMES)[number];

export interface WalmartDrawItemObservationInput {
  retailerSku: string;
  title: string;
  unitPriceCents: number | null;
  currency: "USD";
  sellerName: string;
  sellerType: SellerType;
  drawState: WalmartDrawState;
  closesAt: string | null;
  conditionCode: number | null;
  conditionGroupCode: number | null;
  orderMinLimit: number | null;
  orderMaxLimit: number | null;
  drawControlPresent: boolean;
  addControlSuppressed: boolean;
}

/**
 * Read-only Walmart Draw discovery. This contract deliberately excludes entry
 * status, address, payment, membership, session, and drawing-entry tokens.
 */
export interface WalmartDrawScanInput {
  adapterVersion: typeof WALMART_DRAW_OBSERVER_VERSION;
  contractVersion: 1;
  observedAt: string;
  pageKind: "walmart_draw_hub";
  outcome: WalmartDrawScanOutcome;
  reasonCode: string;
  expectedCardCount: number;
  observedCardCount: number;
  securityChallenge: boolean;
  interactiveBlock: "" | "auth" | "mfa" | "location" | "membership" | "queue" | "high_demand" | "unknown";
  items: WalmartDrawItemObservationInput[];
}

export interface AmazonShadowObservationInput extends RetailerShadowObservationInput {
  adapterVersion: typeof AMAZON_OBSERVER_VERSION;
  retailerId: "amazon";
}
export interface BestBuyShadowObservationInput extends RetailerShadowObservationInput {
  adapterVersion: typeof BESTBUY_OBSERVER_VERSION;
  retailerId: "bestbuy";
}

export const COMMUNITY_EVIDENCE_CONTRACT_VERSION = 1;
export const COMMUNITY_PRIVACY_VERSION = "community-readonly-v1";
export const COMMUNITY_CONTRIBUTION_CONFIRMATION = "SHARE_READ_ONLY_STOCK_EVIDENCE";

export interface CommunityConsentUpdateInput {
  retailerId: SupportedRetailerId;
  enabled: boolean;
  locationScope: string;
  privacyVersion: typeof COMMUNITY_PRIVACY_VERSION;
  confirmation: typeof COMMUNITY_CONTRIBUTION_CONFIRMATION;
}

export interface CommunityContributionInput {
  contractVersion: typeof COMMUNITY_EVIDENCE_CONTRACT_VERSION;
  nonce: string;
  shadowObservationId: string;
  adapterDiagnosticId?: string;
}

export const IDENTITY_CLAIM_CONTRACT_VERSION = 1;
export const IDENTITY_CLAIM_CONFIRMATION = "PROPOSE_EXACT_PRODUCT_EQUIVALENCE";
export const IDENTITY_CLAIM_REVIEW_CONFIRMATION = "REVIEW_IDENTITY_CLAIM_WITHOUT_REMAP";
export const IDENTITY_IDENTIFIER_KINDS = ["gtin", "upc", "ean", "isbn", "brand_mpn"] as const;
export type IdentityIdentifierKind = (typeof IDENTITY_IDENTIFIER_KINDS)[number];

export interface IdentityVariantAttributesInput {
  size?: string;
  color?: string;
  edition?: string;
  language?: string;
  packCount?: number;
  condition?: "new" | "used" | "refurbished" | "collectible" | "unknown";
}

export interface IdentityClaimInput {
  contractVersion: typeof IDENTITY_CLAIM_CONTRACT_VERSION;
  listingId: string;
  referenceListingId: string;
  identifierKind: IdentityIdentifierKind;
  identifierValue?: string;
  brand?: string;
  mpn?: string;
  attributes?: IdentityVariantAttributesInput;
  provenanceNote?: string;
  confirmation: typeof IDENTITY_CLAIM_CONFIRMATION;
}

export interface IdentityClaimReviewInput {
  outcome: "reviewed" | "rejected";
  note?: string;
  confirmation: typeof IDENTITY_CLAIM_REVIEW_CONFIRMATION;
}

export const OBSERVER_RECIPE_CONTRACT_VERSION = 1;
export const OBSERVER_RECIPE_FIELDS = ["availability", "unitPrice", "seller", "fulfillment", "addControl"] as const;
export const OBSERVER_RECIPE_MODES = ["text", "attribute", "presence", "disabled_state"] as const;
export const OBSERVER_RECIPE_STATES = ["quarantined", "shadow", "canary", "trusted_read_only", "disabled"] as const;
export type ObserverRecipeField = (typeof OBSERVER_RECIPE_FIELDS)[number];
export type ObserverRecipeMode = (typeof OBSERVER_RECIPE_MODES)[number];
export type ObserverRecipeState = (typeof OBSERVER_RECIPE_STATES)[number];

export interface ObserverRecipeFieldInput {
  mode: ObserverRecipeMode;
  selectors: string[];
  attribute?: "aria-label" | "content" | "data-testid" | "data-automation-id";
}

export interface ObserverRecipeProposalInput {
  contractVersion: typeof OBSERVER_RECIPE_CONTRACT_VERSION;
  retailerId: SupportedRetailerId;
  recipeVersion: string;
  minimumExtensionVersion: string;
  expiresAt: string;
  rollbackRecipeId?: string;
  fields: Partial<Record<ObserverRecipeField, ObserverRecipeFieldInput>>;
  provenanceCode: string;
  confirmation: "PROPOSE_OBSERVER_ONLY_RECIPE";
}

export interface ObserverRecipePromotionInput {
  targetState: "shadow" | "canary" | "trusted_read_only";
  confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE";
}

export interface ObserverRecipeResignInput {
  confirmation: "RESIGN_ROOTED_OBSERVER_RECIPE";
}

export const OBSERVER_RECIPE_TRIAL_CONTRACT_VERSION = 2;
export const OBSERVER_RECIPE_RECOVERY_EVIDENCE_CONTRACT_VERSION = 3;
export const OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION = 1;
export const OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_CONTRACT_VERSION = 1;
export const OBSERVER_RECIPE_TRIAL_VALIDATION_PROFILE = "packaged_structured_oracle_v1";
export const OBSERVER_RECIPE_RECOVERY_PROVENANCE = "recipe_packaged_oracle_agreement_v1";
export const OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_SOURCE = "external_identity_risk_v1";
export const CONFIRM_OBSERVER_RECIPE_RECOVERY_EVIDENCE = "CONFIRM_NORMALIZED_RECOVERY_EVIDENCE";
export const REJECT_OBSERVER_RECIPE_RECOVERY_EVIDENCE = "REJECT_NORMALIZED_RECOVERY_EVIDENCE";
export const REVOKE_OBSERVER_RECIPE_RECOVERY_CONFIRMATION = "REVOKE_NORMALIZED_RECOVERY_CONFIRMATION";
export const OBSERVER_RECIPE_TRIAL_RECIPE_STATES = ["value", "missing", "ambiguous", "unrecognized"] as const;
export const OBSERVER_RECIPE_TRIAL_PACKAGED_STATES = ["agreed", "conflict", "missing", "not_evaluated"] as const;
export const OBSERVER_RECIPE_TRIAL_ORACLE_STATES = ["agreed", "conflict", "missing", "ambiguous", "not_evaluated"] as const;
export const OBSERVER_RECIPE_TRIAL_DISPOSITIONS = ["verified", "conflict", "insufficient"] as const;
export type ObserverRecipeTrialRecipeState = (typeof OBSERVER_RECIPE_TRIAL_RECIPE_STATES)[number];
export type ObserverRecipeTrialPackagedState = (typeof OBSERVER_RECIPE_TRIAL_PACKAGED_STATES)[number];
export type ObserverRecipeTrialOracleState = (typeof OBSERVER_RECIPE_TRIAL_ORACLE_STATES)[number];
export type ObserverRecipeTrialDisposition = (typeof OBSERVER_RECIPE_TRIAL_DISPOSITIONS)[number];

/**
 * Privacy-bounded comparison receipt. It identifies only a fixed commerce
 * field and state enums; extracted values, selectors, URLs, DOM, and account
 * context are deliberately excluded.
 */
export interface ObserverRecipeTrialFieldOutcome {
  field: ObserverRecipeField;
  recipeState: ObserverRecipeTrialRecipeState;
  packagedState: ObserverRecipeTrialPackagedState;
  oracleState: ObserverRecipeTrialOracleState;
  disposition: ObserverRecipeTrialDisposition;
}

/**
 * A normalized public commerce value recovered only when a signed recipe and
 * the packaged structured-page oracle agree while the bundled observer has no
 * value. These values enter quarantine evidence; they never fill an
 * observation or authorize an action.
 */
export interface ObserverRecipeRecoveryEvidenceInput {
  field: ObserverRecipeField;
  normalizedValue: string | number | boolean;
}

export type ObserverRecipeRecoveryReviewDecision = "confirmed" | "rejected" | "revoked";

/**
 * A deliberately closed user-review envelope. Free text is excluded so a
 * confirmation event cannot become a side channel for page or account data.
 */
export interface ObserverRecipeRecoveryReviewInput {
  contractVersion: typeof OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION;
  decision: ObserverRecipeRecoveryReviewDecision;
  confirmation:
    | typeof CONFIRM_OBSERVER_RECIPE_RECOVERY_EVIDENCE
    | typeof REJECT_OBSERVER_RECIPE_RECOVERY_EVIDENCE
    | typeof REVOKE_OBSERVER_RECIPE_RECOVERY_CONFIRMATION;
}

/**
 * A short-lived decision produced by a separately authenticated identity/risk
 * service. Account and proof inputs are already pseudonymized hashes; raw IdP,
 * device-risk, address, IP, and location payloads are outside this contract.
 */
export interface ObserverRecipeContributorEligibilityInput {
  contractVersion: typeof OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_CONTRACT_VERSION;
  deviceId: string;
  contributorRefHash: string;
  regionScope: string;
  accountEligible: boolean;
  deviceEligible: boolean;
  regionEligible: boolean;
  proofHash: string;
  source: typeof OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_SOURCE;
  attestedAt: string;
  expiresAt: string;
}

export interface ObserverRecipeTrialInput {
  /** Version 1 remains ingestible for older companions but is never oracle evidence. */
  contractVersion: typeof OBSERVER_RECIPE_CONTRACT_VERSION
    | typeof OBSERVER_RECIPE_TRIAL_CONTRACT_VERSION
    | typeof OBSERVER_RECIPE_RECOVERY_EVIDENCE_CONTRACT_VERSION;
  recipeId: string;
  recipeVersion: string;
  retailerId: SupportedRetailerId;
  retailerSku: string;
  observerVersion: string;
  layoutFingerprint: string;
  outcome: "passed" | "failed";
  evaluatedFieldCount: number;
  agreedFieldCount: number;
  ambiguousFieldCount: number;
  validationProfile?: typeof OBSERVER_RECIPE_TRIAL_VALIDATION_PROFILE;
  oracleEvaluatedFieldCount?: number;
  oracleAgreedFieldCount?: number;
  oracleConflictFieldCount?: number;
  packagedMissingFieldCount?: number;
  packagedConflictFieldCount?: number;
  insufficientFieldCount?: number;
  fieldOutcomes?: ObserverRecipeTrialFieldOutcome[];
  recoveryEvidence?: ObserverRecipeRecoveryEvidenceInput[];
  observedAt: string;
}

export interface SignedObserverRecipePayload {
  contractVersion: typeof OBSERVER_RECIPE_CONTRACT_VERSION;
  recipeId: string;
  retailerId: SupportedRetailerId;
  recipeVersion: string;
  state: "shadow" | "canary" | "trusted_read_only";
  minimumExtensionVersion: string;
  issuedAt: string;
  expiresAt: string;
  rollbackRecipeId: string;
  fields: Partial<Record<ObserverRecipeField, ObserverRecipeFieldInput>>;
}

export interface SignedObserverRecipeEnvelope {
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpki: string;
  payload: SignedObserverRecipePayload;
  signature: string;
}

export const OBSERVER_RECIPE_TRUST_CONTRACT_VERSION = 1;
export const INSTALL_OBSERVER_RECIPE_TRUST_MANIFEST_CONFIRMATION = "INSTALL_ROOTED_OBSERVER_RECIPE_TRUST_MANIFEST";

export interface ObserverRecipeTrustKey {
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpki: string;
  usage: "observer_recipe_signing";
  status: "active" | "retired";
  notBefore: string;
  notAfter: string;
}

export interface ObserverRecipeTrustManifestPayload {
  contractVersion: typeof OBSERVER_RECIPE_TRUST_CONTRACT_VERSION;
  generation: number;
  rootKeyId: string;
  issuedAt: string;
  expiresAt: string;
  previousManifestHash: string;
  keys: ObserverRecipeTrustKey[];
  revokedKeyIds: string[];
}

export interface SignedObserverRecipeTrustManifest {
  algorithm: "Ed25519";
  rootKeyId: string;
  payload: ObserverRecipeTrustManifestPayload;
  signature: string;
}

export interface ObserverRecipeTrustManifestInstallInput {
  manifest: SignedObserverRecipeTrustManifest;
  confirmation: typeof INSTALL_OBSERVER_RECIPE_TRUST_MANIFEST_CONFIRMATION;
}

export interface ObserverRecipeTrustTransparencyReceipt {
  sequence: number;
  eventType: "manifest_installed" | "recipe_signed";
  manifestGeneration: number;
  manifestHash: string;
  signingKeyId: string;
  subjectHash: string;
  previousEventHash: string;
  eventHash: string;
  createdAt: string;
}

export const OBSERVER_RECIPE_WITNESS_CONTRACT_VERSION = 1;

export interface ObserverRecipeWitnessCheckpoint {
  contractVersion: typeof OBSERVER_RECIPE_WITNESS_CONTRACT_VERSION;
  logId: string;
  rootKeyId: string;
  manifestGeneration: number;
  manifestHash: string;
  transparencySequence: number;
  transparencyEventHash: string;
}

export interface ObserverRecipeWitnessPublishRequest {
  contractVersion: typeof OBSERVER_RECIPE_WITNESS_CONTRACT_VERSION;
  checkpoint: ObserverRecipeWitnessCheckpoint;
  checkpointHash: string;
  previousReceiptHash: string;
}

export interface ObserverRecipeWitnessReceiptPayload {
  contractVersion: typeof OBSERVER_RECIPE_WITNESS_CONTRACT_VERSION;
  checkpoint: ObserverRecipeWitnessCheckpoint;
  checkpointHash: string;
  witnessSequence: number;
  previousReceiptHash: string;
  witnessedAt: string;
  validUntil: string;
}

export interface SignedObserverRecipeWitnessReceipt {
  algorithm: "Ed25519";
  keyId: string;
  payload: ObserverRecipeWitnessReceiptPayload;
  signature: string;
}

export type MissionStatus = "active" | "paused" | "satisfied" | "archived" | "deleted";
export type EditableMissionStatus = Exclude<MissionStatus, "deleted">;
export type ResolutionStatus = "matched" | "unresolved" | "ambiguous";
export const JOB_STATES = [
  "notify_only",
  "shadow_ready",
  "awaiting_executor",
  "leased",
  "navigating",
  "verifying_listing",
  "offer_verified",
  "add_authorized",
  "adding",
  "cart_verified",
  "checkout_review",
  "submit_authorized",
  "submitting",
  "confirmed",
  "expired",
  "cancelled",
  "offer_rejected",
  "manual_review",
  "submission_uncertain"
] as const;
export type JobState = (typeof JOB_STATES)[number];

export interface PricePolicy {
  kind: PricePolicyKind;
  maxPriceCents?: number;
  toleranceBps?: number;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  enabled: boolean;
  position: number;
  revision: number;
  sources: string[];
  retailers: string[];
  pricePolicy: PricePolicy;
  sellerPolicy: SellerPolicy;
  allowedSellers: string[];
  includeKeywords: string;
  excludeKeywords: string;
  action: Action;
  quantity: number | "max";
  fulfillment: Fulfillment;
  maxSignalAgeSeconds: number;
}

export interface CatalogListingInput {
  sourceConnectionId: string;
  source: string;
  sourceProductId: string;
  /** For an item of an "All New …" entry: its own name, from its store link. */
  itemTitle?: string;
  sourceListingId?: string;
  sourceProductAliases?: Record<string, string>;
  sourceProductUrl?: string;
  sourceListingUrl?: string;
  title: string;
  brand?: string;
  variantAttributes?: Record<string, string>;
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
  listingStatus?: Availability;
  executionSupported?: boolean;
  sellerType?: ListingSellerType;
  msrpCents?: number | null;
  observedPriceCents?: number | null;
  currency?: string;
  observedAt?: string;
}

// Who sells through a retailer item ID. Marketplace retailers (Walmart, Amazon)
// give every seller its own ID, so one product can carry many IDs at one store.
export type ListingSellerType = "first_party" | "third_party" | "unknown";

// How a listing represents its store on product surfaces. Exactly one listing per
// (product, store) is primary; alternates fold under it; hidden never renders.
export type ListingOfferRole = "primary" | "alternate" | "hidden";

// The shopper-facing product read model: one product, its identity facts, and its
// offers grouped by store. Every user surface consumes this shape, never listing rows.
export interface LibraryProductListing {
  listingId: string;
  retailerId: string;
  retailerName: string;
  retailerSku: string;
  canonicalUrl: string;
  status: Availability;
  purchasable: boolean;
  executionSupported: boolean;
  sellerType: ListingSellerType;
  offerRole: ListingOfferRole;
  msrpCents: number | null;
  estimatedMsrpCents: number | null;
  msrpReference: TrackalackerMsrpReference | null;
  currency: string;
  currentPriceCents: number | null;
  priceObservedAt: string | null;
  priceSource: string | null;
  observedAvailability: Availability | null;
  availabilityObservedAt: string | null;
  availabilitySource: string | null;
  updatedAt: string;
  /** The store item's barcode as a 14-digit GTIN, when its page showed one. */
  gtin?: string;
}

export interface LibraryProductStore {
  retailerId: string;
  retailerName: string;
  executionSupported: boolean;
  listingCount: number;
  primary: LibraryProductListing;
  alternates: LibraryProductListing[];
}

// A store the source reports for the product that has no registered retailer yet.
// Visible for monitoring so the product's store list matches what the source says.
export interface LibraryProductOtherStore {
  storeName: string;
  availability: Availability;
  unitPriceCents: number | null;
  currency: string;
  url: string;
  observedAt: string;
}

export interface LibraryProduct {
  variantId: string;
  familyId: string;
  title: string;
  brand: string;
  /** The product's HTTPS image link, or a same-origin /media/products/… path once this install saved its own copy. */
  imageUrl: string;
  variantAttributes: Record<string, string>;
  msrpCents: number | null;
  createdAt: string;
  storeCount: number;
  listingCount: number;
  availableListingCount: number;
  inStockListingCount: number;
  preorderListingCount: number;
  outOfStockListingCount: number;
  bestPriceCents: number | null;
  currency: string;
  lastActivityAt: string | null;
  stores: LibraryProductStore[];
  otherStores: LibraryProductOtherStore[];
  otherStoreCount: number;
  listings: LibraryProductListing[];
  /** An "All New …" entry: how many items it holds and whether you want all of them. */
  collection?: { itemCount: number; wanted: boolean; mode: CollectionWantMode | "" };
  /** An item of an "All New …" entry. */
  collectionVariantId?: string;
  collectionTitle?: string;
}

/**
 * Want every item of an "All New …" entry (Kevin, 2026-10-09: "Anything that is
 * 'All New' should do it for all the related items"): each item, now and as
 * new ones arrive, is wanted with Yoink's suggested price as its max, or its
 * first store price while it has no history.
 */
export type CollectionWantMode = "add_to_cart" | "notify";
export const COLLECTION_WANT_ORIGIN = "collection_want";
export const COLLECTION_WANT_CONFIRMATION = "WANT_ALL_NEW_ITEMS";
export interface CollectionWant { variantId: string; mode: CollectionWantMode; since: string }
export interface CollectionWantInput { contractVersion: 1; variantId: string; mode: CollectionWantMode; confirmation: typeof COLLECTION_WANT_CONFIRMATION }
export interface CollectionWantResult {
  variantId: string;
  title: string;
  mode: CollectionWantMode;
  wanted: Array<{ variantId: string; title: string; maxUnitPriceCents: number }>;
  waiting: Array<{ variantId: string; title: string; reason: string }>;
}
/**
 * Barcodes (Kevin, 2026-10-09: "Can't we associate them based on a attribute?
 * like UPC?"): store items of All New entries whose page the companion reads
 * once in a background tab, and the barcodes it reads from any store page.
 */
export interface ListingBarcodePlanItem { listingId: string; retailerId: string; retailerSku: string; canonicalUrl: string }
export interface ListingBarcodeReport {
  listingId?: string;
  retailerId: string;
  retailerSku: string;
  /** UPC, EAN or GTIN as read from the page; "" when the page shows none. */
  gtin: string;
}
export interface ListingBarcodeResult { recorded: number; merged: number; split: number }

/** What wanting an entry does for each of its items; nothing is saved. */
export interface CollectionWantPreview {
  variantId: string;
  title: string;
  wanted: boolean;
  mode: CollectionWantMode | "";
  items: Array<{ variantId: string; title: string; retailerName: string; maxUnitPriceCents: number | null; note: string }>;
}

export const CATALOG_IDENTITY_OPERATION_CONFIRMATION = "PROPOSE_CATALOG_IDENTITY_OPERATION";
export const CATALOG_IDENTITY_APPROVAL_CONFIRMATION = "APPROVE_CATALOG_IDENTITY_OPERATION";
export const CATALOG_IDENTITY_REJECTION_CONFIRMATION = "REJECT_CATALOG_IDENTITY_OPERATION";

export interface CatalogVariantMergeInput {
  kind: "merge_variants";
  sourceVariantId: string;
  targetVariantId: string;
  reviewedIdentityClaimId: string;
  reasonCode: string;
  confirmation: typeof CATALOG_IDENTITY_OPERATION_CONFIRMATION;
}

export interface CatalogVariantSplitInput {
  kind: "split_variant";
  sourceVariantId: string;
  listingIds: string[];
  newTitle: string;
  newBrand?: string;
  newVariantAttributes: Record<string, string>;
  reasonCode: string;
  confirmation: typeof CATALOG_IDENTITY_OPERATION_CONFIRMATION;
}

export interface CatalogIdentityRollbackInput {
  kind: "rollback";
  reversedOperationId: string;
  reasonCode: string;
  confirmation: typeof CATALOG_IDENTITY_OPERATION_CONFIRMATION;
}

export type CatalogIdentityOperationProposalInput =
  | CatalogVariantMergeInput
  | CatalogVariantSplitInput
  | CatalogIdentityRollbackInput;

export interface CatalogIdentityOperationDecisionInput {
  outcome: "approve" | "reject";
  note: string;
  confirmation:
    | typeof CATALOG_IDENTITY_APPROVAL_CONFIRMATION
    | typeof CATALOG_IDENTITY_REJECTION_CONFIRMATION;
}

export interface TrackalackerPushEnvelope {
  schemaVersion: 1;
  signalId: string;
  testSignal?: boolean;
  source: {
    provider: "trackalacker";
    transport: "chrome_extension_web_push" | "synthetic_replay";
    notificationId: string;
    applicationName?: string;
    applicationId?: string;
    domain: "trackalacker.com";
    createdAt: string;
    receivedAt: string;
  };
  notification: {
    title?: string;
    body?: string;
    textElements?: string[];
    sourceProductId?: string;
    sourceListingId?: string;
    sourceProductSlug?: string;
    sourceRetailer?: string;
    sourceRetailerSku?: string;
  };
}

export interface TrackalackerPushStatusInput {
  state: "disabled" | "awaiting_page" | "subscribing" | "registering" | "ready" | "error";
  ready: boolean;
  subscriptionPresent: boolean;
  pendingSignals: number;
  lastHttpStatus: number;
  errorCode: string;
  lastRegistrationAt?: string;
  lastNotificationAt?: string;
  lastDeliveryAt?: string;
  updatedAt: string;
}

export interface TrackalackerMsrpReference {
  kind: "reported_msrp" | "approximate_msrp";
  priceCents: number;
  currency: "USD";
  label: "In Stock (MSRP)" | "In Stock (~ MSRP)";
  sourceUrl: string;
  reportedAt: string;
  timeZone: string;
  sampleCount: number;
  observedAt: string;
}

export interface TrackalackerCatalogListingInput {
  sourceListingId: string;
  storeName: string;
  retailerId?: string;
  retailerSku?: string;
  canonicalUrl?: string;
  sourceListingUrl: string;
  outboundUrl?: string;
  availability?: Availability;
  unitPriceCents?: number | null;
  sellerType?: ListingSellerType;
  sellerName?: string;
  msrpReference?: TrackalackerMsrpReference | null;
  /** The sync read this listing's History (whether or not it found an MSRP). */
  historyChecked?: boolean;
}

/**
 * What Yoink already knows about a TrackaLacker listing, so a sync skips work
 * it has done before (Kevin, 2026-10-09: the full sync took 1 h 45 min).
 */
export interface TrackalackerKnownListing {
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
  outboundUrl: string;
  /** When its History was last read or last gave a dated MSRP; "" = never. */
  historyCheckedAt: string;
}

export interface TrackalackerSyncPlan {
  listings: Record<string, TrackalackerKnownListing>;
  /** Products an interrupted run already saved; the run that resumes it skips them. */
  skipProductIds: string[];
  /** TrackaLacker products Yoink already has a picture for; the rest get their page's share image. */
  productsWithImages?: string[];
}

export interface TrackalackerCatalogItemInput {
  sourceProductId: string;
  sourceProductSlug?: string;
  sourceProductUrl: string;
  title: string;
  imageUrl?: string;
  msrpCents?: number | null;
  observedAt: string;
  listings: TrackalackerCatalogListingInput[];
}

// A bounded, key-truncated-values sample of the first followed product's raw field
// structure, captured once per sync run so an operator can see TrackaLacker's real
// field names for image/MSRP without a schema change. Values are pre-sanitized by the
// extension and re-sanitized by the audit pipeline before persistence.
export type TrackalackerRawFieldSample = Record<string, unknown>;

export type SourceSyncPhase = "starting" | "discovering" | "importing" | "complete" | "error";

export interface SourceSyncProgressInput {
  syncId: string;
  phase: SourceSyncPhase;
  page: number;
  pages: number;
  discovered: number;
  processed: number;
  imported: number;
  failed: number;
  message?: string;
  /** Starting: the interrupted run on this device that this one picks up from. */
  resumeOf?: string;
}

export interface SignalIdentityClaims {
  sourceProductId?: string;
  sourceListingId?: string;
  retailerId?: string;
  retailerSku?: string;
  canonicalUrl?: string;
  title?: string;
  globalIdentifiers?: Record<string, string>;
}

export interface SignalOfferClaims {
  availability?: Availability;
  unitPriceCents?: number | null;
  currency?: string;
  sellerName?: string;
  sellerType?: SellerType;
  orderLimit?: number | null;
  fulfillment?: Fulfillment;
  offerId?: string;
  offerFingerprint?: string;
}

export interface SanitizedSignalEvidence {
  headline?: string;
  body?: string;
  msrpStatus?: string;
  clickUrl?: string;
}

export interface SignalEventInput {
  schemaVersion?: number;
  signalId?: string;
  sourceConnectionId: string;
  source: string;
  externalEventId: string;
  eventType: "in_stock" | "restock" | "preorder" | "price_change" | "drop_window" | "queue_open" | "unknown";
  observedAt: string;
  receivedAt?: string;
  test?: boolean;
  identity: SignalIdentityClaims;
  offer?: SignalOfferClaims;
  evidence?: SanitizedSignalEvidence;
  parserVersion?: string;
}

export interface NormalizedSignal {
  schemaVersion: number;
  signalId: string;
  sourceConnectionId: string;
  source: string;
  externalEventId: string;
  eventType: SignalEventInput["eventType"];
  observedAt: string;
  receivedAt: string;
  test: boolean;
  identity: Required<Pick<SignalIdentityClaims, "sourceProductId" | "sourceListingId" | "retailerId" | "retailerSku" | "canonicalUrl" | "title">> & {
    globalIdentifiers: Record<string, string>;
  };
  offer: Required<Pick<SignalOfferClaims, "availability" | "currency" | "sellerName" | "sellerType" | "fulfillment">> & {
    unitPriceCents: number | null;
    orderLimit: number | null;
    offerFingerprint: string;
  };
  evidence: Required<SanitizedSignalEvidence>;
  parserVersion: string;
  transportHash: string;
  ephemeralOfferId: string;
}

export interface ListingContext {
  id: string;
  variantId: string;
  title: string;
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
  executionSupported: boolean;
  msrpCents: number | null;
  currency: string;
}

export interface MissionContext {
  id: string;
  status: MissionStatus;
  targetQuantity: number;
  targetId: string;
  targetEnabled: boolean;
  maxUnitPriceCents: number | null;
  sellerPolicy: SellerPolicy | "inherit";
  fulfillment: Fulfillment | "inherit";
  /** How the plan began: a shopper choice, or `signal:<source>` when a call created it. */
  origin?: string;
}

export interface MissionTargetUpdateInput {
  id: string;
  enabled: boolean;
  maxUnitPriceCents: number | null;
  sellerPolicy?: SellerPolicy | "inherit";
  fulfillment: Fulfillment | "inherit";
}

export type SubstitutionPolicy = "exact_only" | "verified_equivalent";
export type PurchaseIntentDecisionMode = "strategy" | "purchase_intent";

export interface PurchaseIntentPolicyTarget {
  officialMsrpEvidenceId?: string;
  officialMsrpEvidenceHash?: string;
  desiredVariant?: string;
  targetId: string;
  listingId: string;
  retailerId: string;
  enabled: boolean;
  maxUnitPriceCents: number | null;
  sellerPolicy: SellerPolicy | "inherit";
  fulfillment: Fulfillment | "inherit";
}

export interface PurchaseIntentPolicy {
  id: string;
  missionId: string;
  revision: number;
  quantity: number;
  currency: string;
  maxAllInCents: number | null;
  actionCeiling: Action;
  decisionMode: PurchaseIntentDecisionMode;
  maxSignalAgeSeconds: number;
  substitutionPolicy: SubstitutionPolicy;
  expiresAt: string;
  cooldownSeconds: number;
  targets: PurchaseIntentPolicyTarget[];
  policyHash: string;
  changeReason: string;
  createdByActorId: string;
  createdAt: string;
}

export interface PurchaseIntentPolicyUpdateInput {
  /** Evidence IDs explicitly presented to the shopper; never populated by auto reconciliation. */
  officialMsrpEvidenceIds?: Record<string, string>;
  expectedRevision?: number;
  maxAllInCents?: number | null;
  actionCeiling?: Action;
  decisionMode?: PurchaseIntentDecisionMode;
  maxSignalAgeSeconds?: number;
  substitutionPolicy?: SubstitutionPolicy;
  expiresAt?: string;
  cooldownSeconds?: number;
  changeReason?: string;
}

export interface PurchaseIntentDraftInput {
  officialMsrpEvidenceId?: string;
  listingId: string;
  targetQuantity: number;
  maxUnitPriceCents: number;
  maxAllInCents: number;
  actionCeiling: "notify" | "add_to_cart";
  sellerPolicy: "first_party_only";
  fulfillment: "shipping" | "pickup" | "manual";
  substitutionPolicy: "exact_only";
  expiresAt?: string;
  cooldownSeconds: number;
}

export interface PurchaseIntentPreflightInput extends PurchaseIntentDraftInput {
  contractVersion: 2;
  confirmation: "PREFLIGHT_EXACT_PURCHASE_PLAN";
}

export const PURCHASE_INTENT_PREFLIGHT_TTL_SECONDS = 300;

export interface PurchaseIntentCreateInputV1 extends PurchaseIntentDraftInput {
  contractVersion: 1;
  quickAddProfileId?: string;
  confirmation: "CREATE_EXACT_PURCHASE_PLAN";
}

export interface PurchaseIntentCreateInputV2 extends PurchaseIntentDraftInput {
  contractVersion: 2;
  preflightFingerprint: string;
  preflightedAt: string;
  quickAddProfileId?: string;
  confirmation: "CREATE_EXACT_PURCHASE_PLAN";
}

export type PurchaseIntentCreateInput = PurchaseIntentCreateInputV1 | PurchaseIntentCreateInputV2;

/**
 * "Want it": one plan for a product across every store that sells it (each
 * store's primary offer that is not a marketplace seller), with one max price.
 * A preview writes nothing and returns a fingerprint; saving needs that
 * fingerprint, so what was shown is what is saved.
 */
/**
 * A test call: one call the shopper sends from Setup › Stores for an item on
 * their Want list, so they can watch Chrome add it to the cart and open
 * checkout without waiting for a restock (Kevin, 2026-10-08). It comes from
 * its own source, which no device can post to, and runs the same plan, MSRP
 * and cart checks as a TrackaLacker call. No order is placed.
 */
export const YOINK_TEST_CALL_SOURCE = "yoink_test";
export const TEST_CALL_CONTRACT_VERSION = 1;
export const TEST_CALL_CONFIRMATION = "SEND_TEST_CALL";
export const TEST_CALL_SPACING_SECONDS = 300;

export interface TestCallCandidate {
  listingId: string;
  title: string;
  retailerId: string;
  retailerName: string;
  retailerSku: string;
  /** The store price Yoink last recorded; the test call claims this price. */
  priceCents: number | null;
  maxUnitPriceCents: number | null;
  msrpCents: number | null;
  ready: boolean;
  /** Why the item can't be tested yet, when it can't. */
  reason: string;
}

/** A plan made only for one test call; it expires and is removed afterwards. */
export const TEST_CALL_PLAN_ORIGIN = "test_call";
export const TEST_CALL_PLAN_MINUTES = 15;

/**
 * Test any in-stock item (Kevin, 2026-10-08): called items are usually sold
 * out by the time he tests, so he gives a product link and its MSRP instead.
 */
export interface TestCallLinkInput {
  contractVersion: typeof TEST_CALL_CONTRACT_VERSION;
  url: string;
  msrpCents: number;
  /** The store whose Test call was pressed; the link must be for it. */
  retailerId: string;
  /** How many to add, 1 to 10 (default 1); the store's own limit still applies. */
  quantity?: number;
  confirmation: typeof TEST_CALL_CONFIRMATION;
}

export interface TestCallInput {
  contractVersion: typeof TEST_CALL_CONTRACT_VERSION;
  listingId: string;
  confirmation: typeof TEST_CALL_CONFIRMATION;
}

export const PRODUCT_WANT_CONTRACT_VERSION = 1;
export const PRODUCT_WANT_PREVIEW_CONFIRMATION = "PREVIEW_PRODUCT_WANT";
export const PRODUCT_WANT_SAVE_CONFIRMATION = "SAVE_PRODUCT_WANT";
export const PRODUCT_WANT_PREVIEW_TTL_SECONDS = 300;
export const PRODUCT_WANT_MAX_QUANTITY = 10;

export type ProductWantMode = "add_to_cart" | "notify";

export interface ProductWantInput {
  contractVersion: typeof PRODUCT_WANT_CONTRACT_VERSION;
  /** Any listing of the product. */
  listingId: string;
  mode: ProductWantMode;
  /** May be omitted in a preview: it then starts from the plan's max, the MSRP, or the lowest store price. */
  maxUnitPriceCents?: number | null;
  targetQuantity?: number;
  /**
   * Add to cart at Amazon, Target, Walmart and Best Buy only runs at or below
   * a reviewed MSRP. For a store without one, the shopper confirms the MSRP
   * here; saving records that confirmation for each such store.
   */
  confirmedMsrpCents?: number | null;
  /**
   * "msrp" (default): add only at or below the MSRP. "max_price" (Kevin,
   * 2026-10-08): any price up to the max, still only when the store itself
   * sells it; the MSRP isn't checked. Omitted, the item keeps its saved rule.
   */
  priceRule?: ProductWantPriceRule;
  confirmation: typeof PRODUCT_WANT_PREVIEW_CONFIRMATION | typeof PRODUCT_WANT_SAVE_CONFIRMATION;
  previewFingerprint?: string;
  previewedAt?: string;
}

export type ProductWantStoreWatch = "add_to_cart" | "alert" | "off";
export type ProductWantPriceRule = "msrp" | "max_price";

export interface ProductWantStore {
  /** `id` is "" until saving records the MSRP the shopper confirmed; `confirmedByYou` marks an MSRP the shopper (not a manufacturer page) set. */
  officialMsrp?: { id: string; cents: number; sourceUrl: string; desiredVariant: string; expiresAt: string; confirmedByYou?: boolean;
    /** The item's "any price up to my max" rule: `cents` is the max, not an MSRP. */
    maxPriceOnly?: boolean };
  canonicalUrl?: string;
  priceObservedAt?: string | null;
  priceSourceLabel?: string;
  listingId: string;
  retailerId: string;
  retailerName: string;
  retailerSku: string;
  priceCents: number | null;
  availability: string;
  /** Cart adds can run at this store for this account right now. */
  cartReady: boolean;
  watch: ProductWantStoreWatch;
  note: string;
}

export interface ProductWantPlanSummary {
  id: string;
  status: string;
  /** `signal:<source>` when a call created the plan rather than the shopper. */
  origin: string;
  revision: number;
  mode: string;
  maxUnitPriceCents: number | null;
  targetQuantity: number;
}

export interface ProductWantPreview {
  officialMsrpCents?: number | null;
  priceRule: ProductWantPriceRule;
  /**
   * `needed` while Add to cart at a store above has no reviewed MSRP and none
   * was confirmed; `suggestedCents` is the MSRP the catalog or TrackaLacker
   * reports, which the shopper confirms or corrects.
   */
  msrpConfirmation: {
    needed: boolean;
    suggestedCents: number | null;
    /** Where the suggestion came from: TrackaLacker's reported MSRP, else the lowest Best Buy, Target or Walmart price. */
    suggestedSource: "trackalacker" | "store_price" | "";
    /** "TrackaLacker" or "<store>'s price", for the field's help text. */
    suggestedLabel: string;
    confirmedCents: number | null;
  };
  variantAttributes?: Record<string, string>;
  contractVersion: typeof PRODUCT_WANT_CONTRACT_VERSION;
  noPlanSaved: true;
  listingId: string;
  variantId: string;
  title: string;
  /** The product's HTTPS image link, or a same-origin /media/products/… path once this install saved its own copy. */
  imageUrl: string;
  msrpCents: number | null;
  requestedMode: ProductWantMode;
  mode: ProductWantMode;
  summary: string;
  targetQuantity: number;
  maxUnitPriceCents: number | null;
  maxAllInCents: number | null;
  stores: ProductWantStore[];
  spendingLimit: { allowed: boolean; reasonCode: string; message: string };
  plan: ProductWantPlanSummary | null;
  canSave: boolean;
  previewFingerprint: string;
  previewedAt: string;
  validForSeconds: number;
}

/**
 * Fill in MSRPs: one step that confirms the suggested MSRP for every cart item
 * still missing one (Kevin, 2026-10-08: "fill it in with the Best Buy or
 * Target or Walmart MSRP"). The shopper sees each value and can leave items out.
 */
export const MSRP_FILL_CONTRACT_VERSION = 1;
export const MSRP_FILL_CONFIRMATION = "FILL_MISSING_MSRPS";
/** Stores whose own price stands in for an MSRP nobody reported. */
// A plain literal (not Object.freeze) so the extension bundles, which import this module, can drop it.
export const MSRP_STORE_PRICE_RETAILERS: readonly string[] = ["bestbuy", "target", "walmart"];

export interface MsrpFillItem {
  planId: string;
  title: string;
  msrpCents: number | null;
  /** "TrackaLacker" or "<store>'s price". */
  sourceLabel: string;
  currentMaxCents: number | null;
  /** The max after filling: it can't stay above the MSRP. */
  newMaxCents: number | null;
  canFill: boolean;
  reason: string;
}

export interface MsrpFillInput {
  contractVersion: typeof MSRP_FILL_CONTRACT_VERSION;
  planIds: string[];
  confirmation: typeof MSRP_FILL_CONFIRMATION;
}

export interface MsrpFillResult {
  updated: Array<{ planId: string; title: string; msrpCents: number }>;
  skipped: Array<{ planId: string; title: string; reason: string }>;
}

/**
 * Each store's recorded prices for one product (Kevin, 2026-10-08: "show a
 * graph of the price history... each vendor's price history"). A point is
 * kept where the price changed, plus the latest one.
 */
export interface ProductPriceHistory {
  variantId: string;
  title: string;
  msrpCents: number | null;
  sinceAt: string;
  stores: Array<{ retailerId: string; retailerName: string; points: Array<{ at: string; priceCents: number }> }>;
  /** The numbers under the chart; null when no store has a price in the window. */
  summary: PriceHistorySummary | null;
}

/** A price with where and when it was in effect. */
export interface PriceHistoryMark {
  priceCents: number;
  retailerId: string;
  retailerName: string;
  at: string;
}

/**
 * The numbers under the Want it chart (Kevin, 2026-10-09): the lowest and
 * highest price in the window, and Yoink's suggested price, a fair going
 * price without spikes or marked-up stores. See summarizePriceHistory.
 */
export interface PriceHistorySummary {
  windowDays: number;
  lowest: PriceHistoryMark;
  highest: PriceHistoryMark;
  suggested: { priceCents: number; retailerId: string; retailerName: string };
  /** A store priced within this much of the cheapest store's usual price counts toward the suggestion. */
  toleranceCents: number;
  /** Each store's usual price in the window, cheapest first; counted = within the tolerance. */
  stores: Array<{ retailerId: string; retailerName: string; usualCents: number; counted: boolean }>;
}

export interface ProductWantSaveResult {
  purchaseIntentId: string;
  created: boolean;
  preview: ProductWantPreview;
}

export interface MissionUpdateInput {
  status: EditableMissionStatus;
  targetQuantity: number;
  targets: MissionTargetUpdateInput[];
  policy?: PurchaseIntentPolicyUpdateInput;
}

export const PURCHASE_INTENT_DELETE_CONFIRMATION = "DELETE_PURCHASE_PLAN";

export interface PurchaseIntentDeleteInput {
  confirmation: typeof PURCHASE_INTENT_DELETE_CONFIRMATION;
}

/** The shopper's cleanup of plans that calls created by themselves (origin `signal:*`). */
export const CALL_ADDED_PLANS_CONTRACT_VERSION = 1;
export const CALL_ADDED_PLANS_REMOVE_CONFIRMATION = "REMOVE_CALL_ADDED_PLANS";
export const CALL_ADDED_PLANS_MAX_SELECTION = 500;

export interface CallAddedPlan {
  id: string;
  title: string;
  status: "active" | "paused";
  actionCeiling: string;
  /** Comma-separated, like the purchase-intents list. */
  enabledStoreNames: string;
  /** The product's HTTPS image link, or a same-origin /media/products/… path once this install saved its own copy. */
  imageUrl: string;
  maxUnitPriceCents: number | null;
  createdAt: string;
}

export interface CallAddedPlanRemovalInput {
  contractVersion: typeof CALL_ADDED_PLANS_CONTRACT_VERSION;
  ids: string[];
  confirmation: typeof CALL_ADDED_PLANS_REMOVE_CONFIRMATION;
}

export interface CallAddedPlanRemovalResult {
  removed: number;
  skipped: Array<{ id: string; title: string; reason: "changed" | "action_in_progress"; message: string }>;
}

/** The Setup page's per-store cart-add switch (local self-serve; hosted keeps admin approval). */
export const STORE_CART_ADDS_TURN_ON_CONFIRMATION = "TURN_ON_STORE_CART_ADDS";
export const STORE_CART_ADDS_TURN_OFF_CONFIRMATION = "TURN_OFF_STORE_CART_ADDS";

/** Why a wanted cart item did not join a store that was just turned on. */
export type WantedStoreJoinSkipReason = "spending_limit" | "needs_review" | "changed";

export const LEGACY_PURCHASE_INTENT_TRANSITION_CONTRACT_VERSION = 1;
export const LEGACY_PURCHASE_INTENT_TRANSITION_CONFIRMATION = "CONVERT_LEGACY_PLANS_TO_NOTIFICATIONS";

export interface LegacyPurchaseIntentTransitionInput {
  contractVersion: typeof LEGACY_PURCHASE_INTENT_TRANSITION_CONTRACT_VERSION;
  previewFingerprint: string;
  confirmation: typeof LEGACY_PURCHASE_INTENT_TRANSITION_CONFIRMATION;
}

export interface SpendPolicy {
  revision: number;
  currency: "USD";
  perOrderCapCents: number | null;
  dailyCapCents: number | null;
  monthlyCapCents: number | null;
  timezone: string;
  periodResetHour: number;
  orderSubmissionEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SpendPolicyUpdateInput {
  expectedRevision: number;
  perOrderCapCents: number | null;
  dailyCapCents: number | null;
  monthlyCapCents: number | null;
  timezone?: string;
  periodResetHour?: number;
}

/** Retry when sold out (Setup › Stores): tries spread over a window after a cart add finds the item out of stock. */
export interface RestockRetrySettings {
  enabled: boolean;
  /** Tries after the first one, 1 through 10. */
  attempts: number;
  /** Minutes the tries are spread over, 1 through 60. */
  windowMinutes: number;
}
export const RESTOCK_RETRY_DEFAULTS: Readonly<RestockRetrySettings> = { enabled: false, attempts: 3, windowMinutes: 10 };
export const RESTOCK_RETRY_LIMITS = { attempts: { min: 1, max: 10 }, windowMinutes: { min: 1, max: 60 }, minSpacingSeconds: 30 } as const;

export interface AppSettingsUpdateInput {
  dedupeWindowSeconds: number;
  affiliateMode: "prefer_fallback" | "require" | "disabled";
  taxBps: number;
  storeAllowancesCents: Record<string, number>;
}

export type PurchaseProfilePriceMode = "store_price" | "fixed_cap" | "msrp" | "msrp_offset_percent"
  | "estimated_msrp" | "estimated_msrp_offset_percent";
export type PurchaseProfileFulfillment = "shipping" | "pickup";

export interface PurchaseProfile {
  id: string;
  name: string;
  targetQuantity: number;
  actionCeiling: "notify" | "add_to_cart";
  fulfillment: PurchaseProfileFulfillment;
  priceMode: PurchaseProfilePriceMode;
  maxUnitPriceCents: number | null;
  msrpOffsetPercent: number | null;
  isDefault: boolean;
  cooldownSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseProfileInput {
  id?: string;
  name: string;
  targetQuantity: number;
  actionCeiling: "notify" | "add_to_cart";
  fulfillment?: PurchaseProfileFulfillment;
  priceMode: PurchaseProfilePriceMode;
  maxUnitPriceCents?: number | null;
  msrpOffsetPercent?: number | null;
  isDefault?: boolean;
  cooldownSeconds?: number;
}

export const PURCHASE_PROFILE_PROPAGATION_SKIP_REASONS = [
  "plan_expired",
  "unsupported_currency",
  "limit_out_of_range",
  "msrp_unavailable",
  "estimated_msrp_unavailable",
  "official_msrp_plan_review_required",
  "price_unavailable",
  "no_enabled_target",
  "unsupported_target"
] as const;
export type PurchaseProfilePropagationSkipReason = (typeof PURCHASE_PROFILE_PROPAGATION_SKIP_REASONS)[number];

export interface PurchaseProfilePropagationSkip {
  missionId: string;
  title: string;
  reasonCode: PurchaseProfilePropagationSkipReason;
}

export interface PurchaseProfilePropagationSummary {
  matchedMissionCount: number;
  updatedMissionCount: number;
  skipped: PurchaseProfilePropagationSkip[];
}

export interface PurchaseProfileSaveResult {
  profiles: PurchaseProfile[];
  propagation: PurchaseProfilePropagationSummary;
}

export const PURCHASE_PROFILE_APPLY_CONFIRMATION = "APPLY_PROFILE_TO_SELECTED_PURCHASE_PLANS" as const;

export interface PurchaseProfileApplyInput {
  profileId: string;
  missionIds: string[];
  confirmation: typeof PURCHASE_PROFILE_APPLY_CONFIRMATION;
}

export interface PurchaseProfileApplyResult {
  profile: PurchaseProfile;
  selectedMissionCount: number;
  linkedMissionCount: number;
  propagation: PurchaseProfilePropagationSummary;
}

export interface PurchaseProfileRetailerReconciliationResult {
  retailerId: "target" | "walmart" | "amazon" | "bestbuy" | "pokemoncenter" | "aninebing" | "americaneagle" | "asus" | "athleta" | "audioadvice" | "bananarepublic" | "bananarepublicfactory";
  matchedProfileCount: number;
  matchedMissionCount: number;
  updatedMissionCount: number;
  skipped: PurchaseProfilePropagationSkip[];
}

export type AttributionProvider = "canonical" | "howl" | "amazon_associates";

export interface AttributionPolicyDefinition {
  id: string;
  retailerId: string;
  retailerName: string;
  enabled: boolean;
  provider: AttributionProvider;
  publisherSlug: string;
  articleBaseUrl: string;
  associateTag: string;
  howlEligible: boolean;
  howlStoreName: string;
  valid: boolean;
  validationReason: string;
}

export interface AttributionPolicyUpdateInput {
  retailerId: string;
  enabled: boolean;
  provider: AttributionProvider;
  publisherSlug: string;
  articleBaseUrl: string;
  associateTag: string;
}

export interface AttributionPlan {
  policyId: string;
  retailerId: string;
  provider: AttributionProvider;
  outcome: "affiliate_route" | "canonical_disabled" | "canonical_fallback" | "required_route_unavailable";
  reasonCode: string;
  routeUrl: string;
  metadata: Record<string, string>;
  blocked: boolean;
}

export type StrategyEvaluationState =
  | "matched"
  | "unmatched"
  | "stale"
  | "needs_price"
  | "quantity_limited";

export interface StrategyEvaluation {
  state: StrategyEvaluationState;
  reason: string;
  strategy: StrategyDefinition | null;
  decisionSource: "strategy" | "purchase_intent";
  maxSignalAgeSeconds: number;
  effectiveUnitCapCents: number | null;
  effectiveQuantity: number;
  effectiveAction: Action;
  sellerPolicy: SellerPolicy;
  fulfillment: Fulfillment;
}

export interface SignalProcessingResult {
  accepted: boolean;
  signalId: string;
  duplicate: boolean;
  corroborated: boolean;
  resolution: ResolutionStatus;
  resolutionMethod: string;
  missionId: string;
  missionCreated: boolean;
  incidentId: string;
  strategyId: string;
  decision: string;
  reason: string;
  actionJobId: string;
  actionJobState: JobState | "";
}
