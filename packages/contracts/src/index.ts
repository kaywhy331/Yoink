export const ACTIONS = ["notify", "add_to_cart", "prepare_checkout", "submit_order"] as const;
export type Action = (typeof ACTIONS)[number];

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
export const AMAZON_OBSERVER_VERSION = "amazon-observer-v6";
export const BESTBUY_OBSERVER_VERSION = "bestbuy-observer-v4";
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

export interface RetailerAdapterLayoutEvidence {
  schemaVersion: 1;
  pageKind: "product" | "other";
  scopeKind: "none" | "form" | "buybox" | "qualified_buybox" | "accordion" | "other";
  sellerShape: "none" | "legacy" | "offer_display_combined" | "offer_display_split";
  fulfillmentShape: "none" | "shipping" | "pickup" | "mixed";
  addControlCount: number;
  /** Count-only drift signal; optional so diagnostics from the preceding companion remain ingestible. */
  genericAddIntentCount?: number;
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
  interactiveBlock: "" | "auth" | "mfa" | "location" | "membership" | "queue" | "unknown";
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
  interactiveBlock: "" | "auth" | "mfa" | "location" | "membership" | "queue" | "unknown";
  purchaseRouteKind?: "none" | "amazon_buy_now";
  purchaseRouteReady?: boolean;
  routeReasonCode?: "not_applicable" | "offer_not_actionable" | "offer_id_missing_or_ambiguous" | "offer_route_verified" | "route_validation_failed";
}

export interface TargetShadowObservationInput extends RetailerShadowObservationInput {
  adapterVersion: typeof TARGET_OBSERVER_VERSION;
  retailerId: "target";
}

export interface WalmartShadowObservationInput extends RetailerShadowObservationInput {
  adapterVersion: typeof WALMART_OBSERVER_VERSION;
  retailerId: "walmart";
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

export interface ObserverRecipeTrialInput {
  contractVersion: typeof OBSERVER_RECIPE_CONTRACT_VERSION;
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
  substitutionPolicy?: SubstitutionPolicy;
  expiresAt?: string;
  cooldownSeconds?: number;
  changeReason?: string;
}

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
