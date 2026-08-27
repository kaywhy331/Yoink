export const ACTIONS = ["notify", "add_to_cart", "prepare_checkout", "submit_order"] as const;
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
export type Availability = "in_stock" | "preorder" | "out_of_stock" | "unknown";
export const TARGET_OBSERVER_VERSION = "target-observer-v1";
export const WALMART_OBSERVER_VERSION = "walmart-observer-v4";
export const WALMART_DRAW_OBSERVER_VERSION = "walmart-draw-observer-v1";
export const AMAZON_OBSERVER_VERSION = "amazon-observer-v6";
export const BESTBUY_OBSERVER_VERSION = "bestbuy-observer-v5";
export const DISNEY_OBSERVER_VERSION = "disney-observer-v1";
export const RAVENSBURGER_OBSERVER_VERSION = "ravensburger-observer-v1";
export const RIOT_OBSERVER_VERSION = "riot-observer-v1";
export const BOOKSAMILLION_OBSERVER_VERSION = "booksamillion-observer-v1";
export const FANATICS_OBSERVER_VERSION = "fanatics-observer-v1";
export const KOHLS_OBSERVER_VERSION = "kohls-observer-v1";
export const MACYS_OBSERVER_VERSION = "macys-observer-v1";
export const PBANDAI_OBSERVER_VERSION = "pbandai-observer-v2";
export const POKEMONCENTER_OBSERVER_VERSION = "pokemoncenter-observer-v2";
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
  pokemoncenter: POKEMONCENTER_OBSERVER_VERSION
} as const;
export type SupportedRetailerId = keyof typeof RETAILER_OBSERVER_VERSIONS;
export type RetailerObserverVersion = (typeof RETAILER_OBSERVER_VERSIONS)[SupportedRetailerId];
export const TARGET_ADD_ADAPTER_VERSION = "target-add-v1";
export const TARGET_ADD_ACTIVATION_CONFIRMATION = "ENABLE_TARGET_ADD_V1";
export const WALMART_ADD_ADAPTER_VERSION = "walmart-add-v3";
export const WALMART_ADD_ACTIVATION_CONFIRMATION = "ENABLE_WALMART_ADD_V3";
export const AMAZON_ADD_ADAPTER_VERSION = "amazon-add-v5";
export const AMAZON_ADD_ACTIVATION_CONFIRMATION = "ENABLE_AMAZON_ADD_V5";
export const BESTBUY_ADD_ADAPTER_VERSION = "bestbuy-add-v3";
export const BESTBUY_ADD_ACTIVATION_CONFIRMATION = "ENABLE_BESTBUY_ADD_V3";

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
  "fulfillment_unverified",
  "authorization_missing",
  "authorization_expired",
  "add_control_changed",
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
  "clicked"
] as const;
export type RetailerAdapterDiagnosticReasonCode = (typeof RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES)[number];

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
  operation: RetailerAdapterDiagnosticOperation;
  outcome: RetailerAdapterDiagnosticOutcome;
  failureStage: RetailerAdapterDiagnosticStage;
  reasonCode: string;
  attemptCount: number;
  domChanged: boolean;
  layout: RetailerAdapterLayoutEvidence;
}

export const OPERATOR_ALERT_EVENT_FAMILIES = ["adapter_repair"] as const;
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
  "superseded_by_release"
] as const;
export type OperatorAlertResolutionReasonCode = (typeof OPERATOR_ALERT_RESOLUTION_REASON_CODES)[number];

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

export type MissionStatus = "active" | "paused" | "satisfied" | "archived";
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
  msrpCents?: number | null;
  observedPriceCents?: number | null;
  currency?: string;
  observedAt?: string;
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
  eventType: "in_stock" | "restock" | "preorder" | "price_change" | "unknown";
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
}

export interface MissionTargetUpdateInput {
  id: string;
  enabled: boolean;
  maxUnitPriceCents: number | null;
  sellerPolicy: SellerPolicy | "inherit";
  fulfillment: Fulfillment | "inherit";
}

export type SubstitutionPolicy = "exact_only" | "verified_equivalent";
export type PurchaseIntentDecisionMode = "strategy" | "purchase_intent";

export interface PurchaseIntentPolicyTarget {
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
  listingId: string;
  targetQuantity: number;
  maxUnitPriceCents: number;
  maxAllInCents: number;
  actionCeiling: "notify" | "add_to_cart";
  sellerPolicy: "first_party_only";
  fulfillment: "shipping" | "pickup" | "either" | "manual";
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
  confirmation: "CREATE_EXACT_PURCHASE_PLAN";
}

export interface PurchaseIntentCreateInputV2 extends PurchaseIntentDraftInput {
  contractVersion: 2;
  preflightFingerprint: string;
  preflightedAt: string;
  confirmation: "CREATE_EXACT_PURCHASE_PLAN";
}

export type PurchaseIntentCreateInput = PurchaseIntentCreateInputV1 | PurchaseIntentCreateInputV2;

export interface MissionUpdateInput {
  status: MissionStatus;
  targetQuantity: number;
  targets: MissionTargetUpdateInput[];
  policy?: PurchaseIntentPolicyUpdateInput;
}

export interface SpendPolicy {
  revision: number;
  currency: "USD";
  perOrderCapCents: number | null;
  dailyCapCents: number | null;
  monthlyCapCents: number | null;
  orderSubmissionEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SpendPolicyUpdateInput {
  expectedRevision: number;
  perOrderCapCents: number | null;
  dailyCapCents: number | null;
  monthlyCapCents: number | null;
}

export interface AppSettingsUpdateInput {
  dedupeWindowSeconds: number;
  affiliateMode: "prefer_fallback" | "require" | "disabled";
  taxBps: number;
  storeAllowancesCents: Record<string, number>;
}

export interface PurchaseProfile {
  id: string;
  name: string;
  targetQuantity: number;
  actionCeiling: "notify" | "add_to_cart";
  priceMode: "store_price" | "fixed_cap";
  maxUnitPriceCents: number | null;
  cooldownSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseProfileInput {
  id?: string;
  name: string;
  targetQuantity: number;
  actionCeiling: "notify" | "add_to_cart";
  priceMode: "store_price" | "fixed_cap";
  maxUnitPriceCents?: number | null;
  cooldownSeconds?: number;
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
