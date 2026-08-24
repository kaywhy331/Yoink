import {
  AMAZON_ADD_ADAPTER_VERSION,
  AMAZON_OBSERVER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  RETAILER_OBSERVER_VERSIONS,
  SELECTED_OFFER_ATTRIBUTE_KEYS,
  SELECTED_OFFER_SCOPE_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_OBSERVER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION,
  type Availability,
  type RetailerObserverVersion,
  type RetailerShadowObservationInput,
  type SelectedOfferAttributeKey,
  type SelectedOfferSelectionState,
  type SellerType,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText, normalizedKey, positiveCents } from "../../domain/src/normalize.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const AVAILABILITY = new Set<Availability>(["in_stock", "preorder", "out_of_stock", "unknown"]);
const SELLER_TYPES = new Set<SellerType>(["first_party", "third_party", "unknown"]);
const FULFILLMENTS = new Set(["shipping", "pickup", "unknown"] as const);
const INTERACTIVE_BLOCKS = new Set(["", "auth", "mfa", "location", "membership", "queue", "high_demand", "unknown"] as const);
const PURCHASE_ROUTE_KINDS = new Set(["none", "amazon_buy_now"] as const);
const ROUTE_REASON_CODES = new Set([
  "not_applicable",
  "offer_not_actionable",
  "offer_id_missing_or_ambiguous",
  "offer_route_verified",
  "route_validation_failed"
] as const);
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_OBSERVATION_AGE_MS = 10 * 60_000;
const QUALIFICATION_EVIDENCE_WINDOW_MS = 30 * 24 * 60 * 60_000;
const RETENTION_LIMIT = 1_000;
const EXACT_RETAILER_SKUS = new Set<SupportedRetailerId>([
  "target", "walmart", "amazon", "bestbuy", "ravensburger",
  "booksamillion", "pbandai", "pokemoncenter"
]);
const SELECTED_OFFER_STATES = new Set<SelectedOfferSelectionState>(["exact", "listing_only", "unresolved"]);
const SELECTED_OFFER_KEYS = new Set<SelectedOfferAttributeKey>(SELECTED_OFFER_ATTRIBUTE_KEYS);

interface StoredSelectedOfferScope {
  schemaVersion: typeof SELECTED_OFFER_SCOPE_VERSION;
  selectionState: SelectedOfferSelectionState;
  childOfferKey: string;
  attributes: Partial<Record<SelectedOfferAttributeKey, string>>;
  fingerprint: string;
}

function selectedOfferScope(
  input: RetailerShadowObservationInput["selectedOffer"],
  retailerId: SupportedRetailerId,
  retailerSku: string
): StoredSelectedOfferScope {
  if (!input) {
    const selectionState = "unresolved" as const;
    return {
      schemaVersion: SELECTED_OFFER_SCOPE_VERSION,
      selectionState,
      childOfferKey: retailerSku,
      attributes: {},
      fingerprint: stableHash(
        "selected-offer-scope-v1", retailerId, retailerSku, retailerSku, "{}", selectionState
      )
    };
  }
  if (input.schemaVersion !== SELECTED_OFFER_SCOPE_VERSION || !SELECTED_OFFER_STATES.has(input.selectionState)
    || !input.attributes || typeof input.attributes !== "object" || Array.isArray(input.attributes)) {
    throw new Error("The selected-offer identity scope is invalid.");
  }
  const childOfferKey = cleanText(input.childOfferKey, 120).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,119}$/.test(childOfferKey) || childOfferKey !== retailerSku) {
    throw new Error("The selected child offer must match the server-verified public retailer SKU.");
  }
  const attributes: Partial<Record<SelectedOfferAttributeKey, string>> = {};
  for (const rawKey of Object.keys(input.attributes).sort()) {
    if (!SELECTED_OFFER_KEYS.has(rawKey as SelectedOfferAttributeKey)) {
      throw new Error("The selected-offer identity contains an unsupported variant dimension.");
    }
    const key = rawKey as SelectedOfferAttributeKey;
    const value = normalizedKey(input.attributes[key], 120);
    if (!value || /[<>]/.test(value)) throw new Error("The selected-offer variant value is invalid.");
    attributes[key] = value;
  }
  const hasAttributes = Object.keys(attributes).length > 0;
  if (input.selectionState === "exact" && !hasAttributes && !EXACT_RETAILER_SKUS.has(retailerId)) {
    throw new Error("This retailer requires an exact selected variant before community identity is complete.");
  }
  if (input.selectionState === "listing_only" && hasAttributes) {
    throw new Error("A listing-only selected-offer scope cannot contain selected variant dimensions.");
  }
  const attributesJson = JSON.stringify(attributes);
  return {
    schemaVersion: SELECTED_OFFER_SCOPE_VERSION,
    selectionState: input.selectionState,
    childOfferKey,
    attributes,
    fingerprint: stableHash(
      "selected-offer-scope-v1", retailerId, retailerSku, childOfferKey,
      attributesJson, input.selectionState
    )
  };
}

function suppliedProductUrl(
  value: unknown,
  canonicalHost: string,
  expectedSku: string,
  skuFromUrl: (url: URL) => string,
  identityQuery: "" | "sku" | "ID" = ""
): string {
  try {
    const url = new URL(cleanText(value, 4_096));
    const domain = canonicalHost.replace(/^www\./, "");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname.length > 1_000
      || (url.hostname !== domain && url.hostname !== canonicalHost && !url.hostname.endsWith(`.${domain}`))) return "";
    if (skuFromUrl(url).toUpperCase() !== expectedSku.toUpperCase()) return "";
    url.hostname = canonicalHost;
    url.port = "";
    url.hash = "";
    url.search = "";
    if (identityQuery) url.searchParams.set(identityQuery, expectedSku);
    return url.href;
  } catch {
    return "";
  }
}

const RETAILER_RULES: Record<SupportedRetailerId, {
  skuPattern: RegExp;
  canonicalUrl: (sku: string, suppliedUrl?: unknown) => string;
  firstPartyName: string;
}> = {
  target: {
    skuPattern: /^\d{6,20}$/,
    canonicalUrl: (sku) => `https://www.target.com/p/-/A-${sku}`,
    firstPartyName: "Target"
  },
  walmart: {
    skuPattern: /^\d{5,20}$/,
    canonicalUrl: (sku) => `https://www.walmart.com/ip/${sku}`,
    firstPartyName: "Walmart"
  },
  amazon: {
    skuPattern: /^[A-Z0-9]{10}$/,
    canonicalUrl: (sku) => `https://www.amazon.com/dp/${sku}`,
    firstPartyName: "Amazon.com"
  },
  bestbuy: {
    skuPattern: /^\d{5,20}$/,
    canonicalUrl: (sku) => `https://www.bestbuy.com/site/-/${sku}.p`,
    firstPartyName: "Best Buy"
  },
  disney: {
    skuPattern: /^\d{10,20}$/,
    canonicalUrl: (sku, suppliedUrl) => suppliedProductUrl(
      suppliedUrl,
      "www.disneystore.com",
      sku,
      (url) => url.pathname.match(/-(\d{10,20})\.html(?:\/|$)/i)?.[1] || ""
    ),
    firstPartyName: "Disney Store"
  },
  ravensburger: {
    skuPattern: /^\d{5,20}$/,
    canonicalUrl: (sku, suppliedUrl) => suppliedProductUrl(
      suppliedUrl,
      "www.ravensburger.us",
      sku,
      (url) => /^\/en-US\/products\//i.test(url.pathname)
        ? url.pathname.match(/-(\d{5,20})(?:\/|$)/i)?.[1] || ""
        : ""
    ),
    firstPartyName: "Ravensburger"
  },
  riot: {
    skuPattern: /^[A-Z0-9](?:[A-Z0-9-]{1,118}[A-Z0-9])?$/,
    canonicalUrl: (sku) => `https://merch.riotgames.com/en-us/product/${sku.toLocaleLowerCase("en-US")}/`,
    firstPartyName: "Riot Games Merch"
  },
  booksamillion: {
    skuPattern: /^[A-Z0-9]{10,20}$/,
    canonicalUrl: (sku) => `https://www.booksamillion.com/p/-/${sku}`,
    firstPartyName: "Books-A-Million"
  },
  fanatics: {
    skuPattern: /^\d{6,20}$/,
    canonicalUrl: (sku, suppliedUrl) => suppliedProductUrl(
      suppliedUrl,
      "www.fanatics.com",
      sku,
      (url) => url.pathname.replace(/%2B/gi, "+").match(/(?:^|\+)p-(\d{6,20})(?:\+|$)/i)?.[1] || ""
    ),
    firstPartyName: "Fanatics"
  },
  kohls: {
    skuPattern: /^\d{5,12}$/,
    canonicalUrl: (sku, suppliedUrl) => suppliedProductUrl(
      suppliedUrl,
      "www.kohls.com",
      sku,
      (url) => url.pathname.match(/^\/product\/prd-(\d{5,12})\//i)?.[1] || ""
    ),
    firstPartyName: "Kohl's"
  },
  macys: {
    skuPattern: /^\d{5,20}$/,
    canonicalUrl: (sku, suppliedUrl) => suppliedProductUrl(
      suppliedUrl,
      "www.macys.com",
      sku,
      (url) => /^\/shop\/product\//i.test(url.pathname) ? url.searchParams.get("ID") || url.searchParams.get("id") || "" : "",
      "ID"
    ),
    firstPartyName: "Macy's"
  },
  pbandai: {
    skuPattern: /^[A-Z]\d{10}$/,
    canonicalUrl: (sku) => `https://p-bandai.com/us/item/${sku}`,
    firstPartyName: "Premium Bandai"
  },
  pokemoncenter: {
    skuPattern: /^\d{2,3}-\d{5}(?:-\d{3})?$/,
    canonicalUrl: (sku, suppliedUrl) => suppliedProductUrl(
      suppliedUrl,
      "www.pokemoncenter.com",
      sku,
      (url) => url.pathname.match(/^\/product\/(\d{2,3}-\d{5}(?:-\d{3})?)(?:\/|$)/i)?.[1] || ""
    ),
    firstPartyName: "Pokémon Center"
  }
};

export type ShadowObservationState = "actionable_candidate" | "not_actionable" | "manual_block";

export interface StoredShadowObservation {
  id: string;
  deviceId: string;
  retailerId: SupportedRetailerId;
  adapterVersion: RetailerObserverVersion;
  contractVersion: 1;
  pageKind: "product";
  retailerSku: string;
  canonicalUrl: string;
  availability: Availability;
  unitPriceCents: number | null;
  currency: "USD";
  sellerName: string;
  sellerType: SellerType;
  fulfillment: "shipping" | "pickup" | "unknown";
  addControlActionable: boolean;
  securityChallenge: boolean;
  interactiveBlock: RetailerShadowObservationInput["interactiveBlock"];
  purchaseRouteKind: "none" | "amazon_buy_now";
  purchaseRouteReady: boolean;
  routeReasonCode: NonNullable<RetailerShadowObservationInput["routeReasonCode"]>;
  selectedOffer: StoredSelectedOfferScope;
  observationState: ShadowObservationState;
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
}

export type TargetQualificationCheckId =
  | "first_party_actionable"
  | "named_marketplace_actionable"
  | "shipping_actionable"
  | "pickup_actionable"
  | "unavailable_fail_closed"
  | "sku_diversity"
  | "pre_click_rehearsal";

export interface TargetQualificationCheck {
  id: TargetQualificationCheckId;
  label: string;
  detail: string;
  observed: number;
  required: number;
  requiredForQualification: boolean;
  met: boolean;
}

export interface TargetQualificationReadiness {
  retailerId: "target";
  adapterVersion: typeof TARGET_OBSERVER_VERSION;
  addAdapterVersion: typeof TARGET_ADD_ADAPTER_VERSION;
  evidenceWindowDays: 30;
  observationCount: number;
  distinctSkuCount: number;
  checks: TargetQualificationCheck[];
  liveEvidenceReady: boolean;
  rehearsalReady: boolean;
  qualificationEvidenceReady: boolean;
  rehearsalCount: number;
  liveEvidenceHash: string;
  qualificationEvidenceHash: string;
  qualification: null | {
    adapterVersion: string;
    highestAction: string;
    status: "qualified" | "suspended" | "retired";
    qualifiedAt: string;
    updatedAt: string;
  };
  addToCartQualified: boolean;
  mutationAuthorized: boolean;
  nextStep: string;
}

export type WalmartQualificationCheckId = TargetQualificationCheckId;

export interface WalmartQualificationCheck extends Omit<TargetQualificationCheck, "id"> {
  id: WalmartQualificationCheckId;
}

export interface WalmartQualificationReadiness {
  retailerId: "walmart";
  adapterVersion: typeof WALMART_OBSERVER_VERSION;
  addAdapterVersion: typeof WALMART_ADD_ADAPTER_VERSION;
  evidenceWindowDays: 30;
  observationCount: number;
  distinctSkuCount: number;
  checks: WalmartQualificationCheck[];
  liveEvidenceReady: boolean;
  rehearsalReady: boolean;
  qualificationEvidenceReady: boolean;
  rehearsalCount: number;
  liveEvidenceHash: string;
  qualificationEvidenceHash: string;
  qualification: null | {
    adapterVersion: string;
    highestAction: string;
    status: "qualified" | "suspended" | "retired";
    qualifiedAt: string;
    updatedAt: string;
  };
  addToCartQualified: boolean;
  mutationAuthorized: boolean;
  nextStep: string;
}

export type AmazonQualificationCheckId =
  | "first_party_actionable"
  | "named_marketplace_actionable"
  | "shipping_actionable"
  | "offer_route_ready"
  | "unavailable_fail_closed"
  | "sku_diversity"
  | "pre_click_rehearsal";

export interface AmazonQualificationCheck extends Omit<TargetQualificationCheck, "id"> {
  id: AmazonQualificationCheckId;
}

export interface AmazonQualificationReadiness {
  retailerId: "amazon";
  adapterVersion: typeof AMAZON_OBSERVER_VERSION;
  addAdapterVersion: typeof AMAZON_ADD_ADAPTER_VERSION;
  evidenceWindowDays: 30;
  observationCount: number;
  distinctSkuCount: number;
  checks: AmazonQualificationCheck[];
  liveEvidenceReady: boolean;
  rehearsalReady: boolean;
  qualificationEvidenceReady: boolean;
  rehearsalCount: number;
  liveEvidenceHash: string;
  qualificationEvidenceHash: string;
  qualification: null | {
    adapterVersion: string;
    highestAction: string;
    status: "qualified" | "suspended" | "retired";
    qualifiedAt: string;
    updatedAt: string;
  };
  addToCartQualified: boolean;
  mutationAuthorized: boolean;
  nextStep: string;
}

export type BestBuyQualificationCheckId = TargetQualificationCheckId;

export interface BestBuyQualificationCheck extends Omit<TargetQualificationCheck, "id"> {
  id: BestBuyQualificationCheckId;
}

export interface BestBuyQualificationReadiness {
  retailerId: "bestbuy";
  adapterVersion: typeof BESTBUY_OBSERVER_VERSION;
  addAdapterVersion: typeof BESTBUY_ADD_ADAPTER_VERSION;
  evidenceWindowDays: 30;
  observationCount: number;
  distinctSkuCount: number;
  checks: BestBuyQualificationCheck[];
  liveEvidenceReady: boolean;
  rehearsalReady: boolean;
  qualificationEvidenceReady: boolean;
  rehearsalCount: number;
  liveEvidenceHash: string;
  qualificationEvidenceHash: string;
  qualification: null | {
    adapterVersion: string;
    highestAction: string;
    status: "qualified" | "suspended" | "retired";
    qualifiedAt: string;
    updatedAt: string;
  };
  addToCartQualified: boolean;
  mutationAuthorized: boolean;
  nextStep: string;
}

export interface RetailerEvidenceReadiness {
  retailerId: SupportedRetailerId;
  adapterVersion: RetailerObserverVersion;
  observationCount: number;
  distinctSkuCount: number;
  actionableCandidateCount: number;
  firstPartyCount: number;
  namedMarketplaceCount: number;
  shippingCount: number;
  pickupCount: number;
  unavailableCount: number;
  manualBlockCount: number;
  purchaseRouteReadyCount: number;
  latestObservedAt: string;
  mode: "guarded_add" | "read_only";
}

interface ObservationRow {
  id: string;
  deviceId: string;
  retailerId: SupportedRetailerId;
  adapterVersion: RetailerObserverVersion;
  contractVersion: 1;
  pageKind: "product";
  retailerSku: string;
  canonicalUrl: string;
  availability: Availability;
  unitPriceCents: number | null;
  currency: "USD";
  sellerName: string;
  sellerType: SellerType;
  fulfillment: "shipping" | "pickup" | "unknown";
  addControlActionable: number;
  securityChallenge: number;
  interactiveBlock: RetailerShadowObservationInput["interactiveBlock"];
  purchaseRouteKind: "none" | "amazon_buy_now";
  purchaseRouteReady: number;
  routeReasonCode: NonNullable<RetailerShadowObservationInput["routeReasonCode"]>;
  selectedOfferSchemaVersion: 0 | 1;
  selectedOfferState: SelectedOfferSelectionState;
  childOfferKey: string;
  variantAttributesJson: string;
  selectedOfferFingerprint: string;
  observationState: ShadowObservationState;
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
}

interface QualificationEvidenceRow {
  retailerSku: string;
  availability: Availability;
  sellerName: string;
  sellerType: SellerType;
  fulfillment: "shipping" | "pickup" | "unknown";
  addControlActionable: number;
  purchaseRouteReady: number;
  observationState: ShadowObservationState;
  evidenceHash: string;
}

interface QualificationRow {
  adapterVersion: string;
  highestAction: string;
  status: "qualified" | "suspended" | "retired";
  qualifiedAt: string;
  updatedAt: string;
}

interface QualificationTrialRow {
  evidenceHash: string;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
}

function rowToObservation(row: ObservationRow): StoredShadowObservation {
  let attributes: StoredSelectedOfferScope["attributes"] = {};
  try { attributes = JSON.parse(row.variantAttributesJson) as StoredSelectedOfferScope["attributes"]; } catch { attributes = {}; }
  const {
    selectedOfferSchemaVersion, selectedOfferState, childOfferKey,
    variantAttributesJson: _variantAttributesJson,
    selectedOfferFingerprint, ...observation
  } = row;
  return {
    ...observation,
    addControlActionable: row.addControlActionable === 1,
    securityChallenge: row.securityChallenge === 1,
    purchaseRouteReady: row.purchaseRouteReady === 1,
    selectedOffer: {
      schemaVersion: SELECTED_OFFER_SCOPE_VERSION,
      selectionState: selectedOfferSchemaVersion === 1 ? selectedOfferState : "unresolved",
      childOfferKey: childOfferKey || row.retailerSku,
      attributes,
      fingerprint: selectedOfferFingerprint || stableHash(
        "selected-offer-scope-v1", row.retailerId, row.retailerSku,
        childOfferKey || row.retailerSku, JSON.stringify(attributes), "unresolved"
      )
    }
  };
}

export class ShadowObservationRepository {
  constructor(private readonly db: YoinkDatabase) {}

  record(deviceId: string, input: RetailerShadowObservationInput, now = Date.now()): StoredShadowObservation {
    if (!input || typeof input !== "object") throw new Error("A retailer shadow observation is required.");
    const cleanDeviceId = cleanText(deviceId, 120);
    const device = this.db.get<{ id: string }>(
      "SELECT id FROM extension_devices WHERE id = ? AND user_id = ? AND status = 'active'",
      cleanDeviceId,
      currentRequestScope().userId
    );
    if (!device) throw new Error("The paired Chrome device is unavailable.");
    if (!Object.hasOwn(RETAILER_RULES, input.retailerId) || input.pageKind !== "product") {
      throw new Error("Only a supported exact retailer product-page observation is accepted.");
    }
    const retailerId = input.retailerId;
    const rules = RETAILER_RULES[retailerId];
    if (input.adapterVersion !== RETAILER_OBSERVER_VERSIONS[retailerId] || input.contractVersion !== 1) {
      throw new Error("The retailer observer contract version is unsupported.");
    }
    const retailerSku = cleanText(input.retailerSku, 64).toUpperCase();
    if (!rules.skuPattern.test(retailerSku)) {
      throw new Error(retailerId === "target" ? "A valid exact Target TCIN is required." : "A valid exact retailer SKU is required.");
    }
    const observedTime = new Date(input.observedAt).getTime();
    if (!Number.isFinite(observedTime) || observedTime > now + MAX_CLOCK_SKEW_MS || now - observedTime > MAX_OBSERVATION_AGE_MS) {
      throw new Error("The retailer shadow observation is stale or has an invalid timestamp.");
    }
    if (!AVAILABILITY.has(input.availability)) throw new Error("The retailer availability evidence is invalid.");
    const unitPriceCents = positiveCents(input.unitPriceCents, true);
    if (input.currency !== "USD") throw new Error("Retailer shadow prices must use USD.");
    if (!SELLER_TYPES.has(input.sellerType)) throw new Error("The retailer seller type is invalid.");
    const sellerName = cleanText(input.sellerName, 160);
    if (input.sellerType === "third_party" && !sellerName) throw new Error("A third-party seller must be identified.");
    if (!FULFILLMENTS.has(input.fulfillment)) throw new Error("The retailer fulfillment evidence is invalid.");
    if (!INTERACTIVE_BLOCKS.has(input.interactiveBlock)) throw new Error("The retailer interactive-block evidence is invalid.");
    const addControlActionable = requiredBoolean(input.addControlActionable, "Retailer add-control evidence");
    const securityChallenge = requiredBoolean(input.securityChallenge, "Retailer security-challenge evidence");
    const purchaseRouteKind = input.purchaseRouteKind ?? "none";
    const purchaseRouteReady = input.purchaseRouteReady === undefined
      ? false : requiredBoolean(input.purchaseRouteReady, "Retailer purchase-route evidence");
    const routeReasonCode = input.routeReasonCode ?? "not_applicable";
    if (!PURCHASE_ROUTE_KINDS.has(purchaseRouteKind) || !ROUTE_REASON_CODES.has(routeReasonCode)) {
      throw new Error("The retailer purchase-route evidence is invalid.");
    }
    if (retailerId !== "amazon" && (purchaseRouteKind !== "none" || purchaseRouteReady || routeReasonCode !== "not_applicable")) {
      throw new Error("Only Amazon observations may include an Amazon Buy Now route rehearsal.");
    }
    if (retailerId === "amazon" && purchaseRouteKind === "amazon_buy_now" && purchaseRouteReady !== (routeReasonCode === "offer_route_verified")) {
      throw new Error("Amazon purchase-route readiness and its reason are inconsistent.");
    }
    if (purchaseRouteReady && purchaseRouteKind !== "amazon_buy_now") {
      throw new Error("A ready purchase route requires the Amazon Buy Now route kind.");
    }
    const observedAt = new Date(observedTime).toISOString();
    const receivedAt = nowIso(now);
    const canonicalUrl = rules.canonicalUrl(retailerSku, input.canonicalUrl);
    if (!canonicalUrl) throw new Error("The exact canonical retailer product URL is invalid.");
    const selectedOffer = selectedOfferScope(input.selectedOffer, retailerId, retailerSku);
    const observationState: ShadowObservationState = securityChallenge || input.interactiveBlock
      ? "manual_block"
      : ["in_stock", "preorder"].includes(input.availability)
        && addControlActionable
        && unitPriceCents !== null
        && input.sellerType !== "unknown"
        && input.fulfillment !== "unknown"
        ? "actionable_candidate"
        : "not_actionable";
    const normalized: Omit<StoredShadowObservation, "id" | "deviceId" | "evidenceHash" | "receivedAt"> = {
      adapterVersion: RETAILER_OBSERVER_VERSIONS[retailerId],
      contractVersion: 1,
      pageKind: "product",
      retailerId,
      retailerSku,
      canonicalUrl,
      availability: input.availability,
      unitPriceCents,
      currency: "USD",
      sellerName: input.sellerType === "first_party" ? rules.firstPartyName : sellerName,
      sellerType: input.sellerType,
      fulfillment: input.fulfillment,
      addControlActionable,
      securityChallenge,
      interactiveBlock: input.interactiveBlock,
      purchaseRouteKind,
      purchaseRouteReady,
      routeReasonCode,
      selectedOffer,
      observationState,
      observedAt
    };
    const evidenceHash = stableHash("retailer-shadow-observation-v2", JSON.stringify(normalized));
    const id = newId("shadow_observation");

    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO retailer_shadow_observations(
           id, tenant_id, user_id, device_id, retailer_id, adapter_version,
           contract_version, page_kind, retailer_sku, canonical_url,
           availability, unit_price_cents, currency, seller_name, seller_type,
           fulfillment, add_control_actionable, security_challenge,
           interactive_block, purchase_route_kind, purchase_route_ready,
           route_reason_code, selected_offer_schema_version, selected_offer_state,
           child_offer_key, variant_attributes_json, selected_offer_fingerprint,
           observation_state, evidence_hash, observed_at, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        cleanDeviceId,
        normalized.retailerId,
        normalized.adapterVersion,
        normalized.contractVersion,
        normalized.pageKind,
        normalized.retailerSku,
        normalized.canonicalUrl,
        normalized.availability,
        normalized.unitPriceCents,
        normalized.currency,
        normalized.sellerName,
        normalized.sellerType,
        normalized.fulfillment,
        normalized.addControlActionable ? 1 : 0,
        normalized.securityChallenge ? 1 : 0,
        normalized.interactiveBlock,
        normalized.purchaseRouteKind,
        normalized.purchaseRouteReady ? 1 : 0,
        normalized.routeReasonCode,
        normalized.selectedOffer.schemaVersion,
        normalized.selectedOffer.selectionState,
        normalized.selectedOffer.childOfferKey,
        JSON.stringify(normalized.selectedOffer.attributes),
        normalized.selectedOffer.fingerprint,
        normalized.observationState,
        evidenceHash,
        normalized.observedAt,
        receivedAt
      );
      this.db.run(
        `DELETE FROM retailer_shadow_observations
         WHERE user_id = ? AND id NOT IN (
           SELECT id FROM retailer_shadow_observations
           WHERE user_id = ? ORDER BY received_at DESC, id DESC LIMIT ?
         )`,
        currentRequestScope().userId,
        currentRequestScope().userId,
        RETENTION_LIMIT
      );
    });
    return {
      id,
      deviceId: cleanDeviceId,
      ...normalized,
      evidenceHash,
      receivedAt
    };
  }

  listRecent(limit = 50): StoredShadowObservation[] {
    const safeLimit = Math.max(1, Math.min(250, Math.trunc(Number(limit) || 50)));
    const rows = this.db.all<ObservationRow>(
      `SELECT id, device_id AS deviceId, retailer_id AS retailerId,
              adapter_version AS adapterVersion, contract_version AS contractVersion,
              page_kind AS pageKind, retailer_sku AS retailerSku,
              canonical_url AS canonicalUrl, availability,
              unit_price_cents AS unitPriceCents, currency, seller_name AS sellerName,
              seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              security_challenge AS securityChallenge,
              interactive_block AS interactiveBlock,
              purchase_route_kind AS purchaseRouteKind,
              purchase_route_ready AS purchaseRouteReady,
              route_reason_code AS routeReasonCode,
              selected_offer_schema_version AS selectedOfferSchemaVersion,
              selected_offer_state AS selectedOfferState,
              child_offer_key AS childOfferKey,
              variant_attributes_json AS variantAttributesJson,
              selected_offer_fingerprint AS selectedOfferFingerprint,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_shadow_observations
       WHERE user_id = ? ORDER BY received_at DESC, id DESC LIMIT ?`,
      currentRequestScope().userId,
      safeLimit
    );
    return rows.map(rowToObservation);
  }

  retailerEvidenceReadiness(now = Date.now()): RetailerEvidenceReadiness[] {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<{
      retailerId: SupportedRetailerId;
      observationCount: number;
      distinctSkuCount: number;
      actionableCandidateCount: number;
      firstPartyCount: number;
      namedMarketplaceCount: number;
      shippingCount: number;
      pickupCount: number;
      unavailableCount: number;
      manualBlockCount: number;
      purchaseRouteReadyCount: number;
      latestObservedAt: string | null;
    }>(
      `SELECT retailer_id AS retailerId,
              COUNT(*) AS observationCount,
              COUNT(DISTINCT retailer_sku) AS distinctSkuCount,
              SUM(CASE WHEN observation_state = 'actionable_candidate' THEN 1 ELSE 0 END) AS actionableCandidateCount,
              SUM(CASE WHEN seller_type = 'first_party' THEN 1 ELSE 0 END) AS firstPartyCount,
              SUM(CASE WHEN seller_type = 'third_party' AND seller_name <> '' THEN 1 ELSE 0 END) AS namedMarketplaceCount,
              SUM(CASE WHEN fulfillment = 'shipping' THEN 1 ELSE 0 END) AS shippingCount,
              SUM(CASE WHEN fulfillment = 'pickup' THEN 1 ELSE 0 END) AS pickupCount,
              SUM(CASE WHEN availability = 'out_of_stock' THEN 1 ELSE 0 END) AS unavailableCount,
              SUM(CASE WHEN observation_state = 'manual_block' THEN 1 ELSE 0 END) AS manualBlockCount,
              SUM(CASE WHEN purchase_route_ready = 1 THEN 1 ELSE 0 END) AS purchaseRouteReadyCount,
              MAX(observed_at) AS latestObservedAt
       FROM retailer_shadow_observations
       WHERE user_id = ? AND observed_at >= ?
       GROUP BY retailer_id`,
      currentRequestScope().userId,
      cutoff
    );
    const byRetailer = new Map(rows.map((row) => [row.retailerId, row]));
    return (Object.keys(RETAILER_OBSERVER_VERSIONS) as SupportedRetailerId[]).map((retailerId) => {
      const row = byRetailer.get(retailerId);
      return {
        retailerId,
        adapterVersion: RETAILER_OBSERVER_VERSIONS[retailerId],
        observationCount: Number(row?.observationCount ?? 0),
        distinctSkuCount: Number(row?.distinctSkuCount ?? 0),
        actionableCandidateCount: Number(row?.actionableCandidateCount ?? 0),
        firstPartyCount: Number(row?.firstPartyCount ?? 0),
        namedMarketplaceCount: Number(row?.namedMarketplaceCount ?? 0),
        shippingCount: Number(row?.shippingCount ?? 0),
        pickupCount: Number(row?.pickupCount ?? 0),
        unavailableCount: Number(row?.unavailableCount ?? 0),
        manualBlockCount: Number(row?.manualBlockCount ?? 0),
        purchaseRouteReadyCount: Number(row?.purchaseRouteReadyCount ?? 0),
        latestObservedAt: row?.latestObservedAt ?? "",
        mode: ["target", "walmart", "amazon", "bestbuy"].includes(retailerId) ? "guarded_add" : "read_only"
      };
    });
  }

  targetQualificationReadiness(now = Date.now()): TargetQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              observation_state AS observationState, evidence_hash AS evidenceHash
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'target' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      TARGET_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const rehearsals = this.db.all<QualificationTrialRow>(
      `SELECT evidence_hash AS evidenceHash FROM retailer_adapter_trials
       WHERE user_id = ? AND retailer_id = 'target' AND adapter_version = ?
         AND trial_kind = 'pre_click_rehearsal' AND outcome = 'passed'
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      TARGET_ADD_ADAPTER_VERSION,
      cutoff
    );
    const counts: Record<TargetQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Target").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<TargetQualificationCheck, "observed" | "met">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an in-stock Target-sold offer with a usable add control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: "Optional coverage for a future marketplace-capable adapter; target-add-v1 rejects it.",
        required: 1,
        requiredForQualification: false
      },
      {
        id: "shipping_actionable",
        label: "Shipping fulfillment",
        detail: "Capture one actionable offer bound specifically to shipping.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "pickup_actionable",
        label: "Pickup fulfillment",
        detail: "Optional coverage for a future pickup-capable adapter; target-add-v1 rejects it.",
        required: 1,
        requiredForQualification: false
      },
      {
        id: "unavailable_fail_closed",
        label: "Unavailable offer",
        detail: "Optional live fail-closed coverage; automated fixtures already enforce this case.",
        required: 1,
        requiredForQualification: false
      },
      {
        id: "sku_diversity",
        label: "Distinct TCIN coverage",
        detail: "Capture at least two different exact Target products.",
        required: 2,
        requiredForQualification: true
      },
      {
        id: "pre_click_rehearsal",
        label: "No-click add rehearsal",
        detail: "Run the production add runner through final validation without clicking.",
        required: 1,
        requiredForQualification: true
      }
    ];
    const checks = definitions.map((definition) => ({
      ...definition,
      observed: counts[definition.id],
      met: counts[definition.id] >= definition.required
    }));
    const liveEvidenceReady = checks
      .filter((check) => check.requiredForQualification && check.id !== "pre_click_rehearsal")
      .every((check) => check.met);
    const rehearsalReady = checks.find((check) => check.id === "pre_click_rehearsal")?.met === true;
    const qualificationEvidenceReady = liveEvidenceReady && rehearsalReady;
    const evidenceHashes = [...new Set(rows.map((row) => row.evidenceHash))].sort();
    const liveEvidenceHash = evidenceHashes.length
      ? stableHash("target-live-qualification-readiness-v1", TARGET_OBSERVER_VERSION, ...evidenceHashes)
      : "";
    const qualificationHashes = [...evidenceHashes, ...rehearsals.map((row) => row.evidenceHash)].sort();
    const qualificationEvidenceHash = qualificationHashes.length
      ? stableHash("target-add-qualification-evidence-v1", TARGET_ADD_ADAPTER_VERSION, ...qualificationHashes)
      : "";
    const qualification = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'target'`,
      currentRequestScope().userId
    ) ?? null;
    const actionRank: Record<string, number> = { notify: 0, add_to_cart: 1, prepare_checkout: 2, submit_order: 3 };
    const addToCartQualified = qualification?.status === "qualified"
      && qualification.adapterVersion === TARGET_ADD_ADAPTER_VERSION
      && Number(actionRank[qualification.highestAction] ?? -1) >= 1;
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = mutationAuthorized
      ? "Guarded Target add-to-cart execution is active for Target-sold shipping offers, quantity one."
      : addToCartQualified
        ? "Target add-to-cart is qualified but globally paused. Use Actions paused to resume it."
      : !liveEvidenceReady
        ? firstMissingLive?.detail ?? "Collect current Target read-only evidence before an add-to-cart rehearsal."
        : !rehearsalReady
          ? "Run one mutation-disabled Target add rehearsal from the Chrome companion."
          : "The live dossier and no-click rehearsal are complete. Explicit add-only qualification review is the remaining gate.";
    return {
      retailerId: "target",
      adapterVersion: TARGET_OBSERVER_VERSION,
      addAdapterVersion: TARGET_ADD_ADAPTER_VERSION,
      evidenceWindowDays: 30,
      observationCount: rows.length,
      distinctSkuCount,
      checks,
      liveEvidenceReady,
      rehearsalReady,
      qualificationEvidenceReady,
      rehearsalCount: rehearsals.length,
      liveEvidenceHash,
      qualificationEvidenceHash,
      qualification,
      addToCartQualified,
      mutationAuthorized,
      nextStep
    };
  }

  walmartQualificationReadiness(now = Date.now()): WalmartQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              observation_state AS observationState, evidence_hash AS evidenceHash
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'walmart' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      WALMART_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const rehearsals = this.db.all<QualificationTrialRow>(
      `SELECT evidence_hash AS evidenceHash FROM retailer_adapter_trials
       WHERE user_id = ? AND retailer_id = 'walmart' AND adapter_version = ?
         AND trial_kind = 'pre_click_rehearsal' AND outcome = 'passed'
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      WALMART_ADD_ADAPTER_VERSION,
      cutoff
    );
    const counts: Record<WalmartQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Walmart").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<WalmartQualificationCheck, "observed" | "met">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an in-stock Walmart-sold offer with a usable add control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: "Optional coverage for a future marketplace-capable adapter; walmart-add-v3 rejects it.",
        required: 1,
        requiredForQualification: false
      },
      {
        id: "shipping_actionable",
        label: "Shipping fulfillment",
        detail: "Capture one actionable Walmart offer explicitly bound to shipping.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "pickup_actionable",
        label: "Pickup fulfillment",
        detail: "Optional coverage for a future pickup-capable adapter; walmart-add-v3 rejects it.",
        required: 1,
        requiredForQualification: false
      },
      {
        id: "unavailable_fail_closed",
        label: "Unavailable offer",
        detail: "Optional live fail-closed coverage; automated fixtures already enforce this case.",
        required: 1,
        requiredForQualification: false
      },
      {
        id: "sku_diversity",
        label: "Distinct item-ID coverage",
        detail: "Capture at least two different exact Walmart products.",
        required: 2,
        requiredForQualification: true
      },
      {
        id: "pre_click_rehearsal",
        label: "No-click add rehearsal",
        detail: "Run the production Walmart add runner through final validation without clicking.",
        required: 1,
        requiredForQualification: true
      }
    ];
    const checks = definitions.map((definition) => ({
      ...definition,
      observed: counts[definition.id],
      met: counts[definition.id] >= definition.required
    }));
    const liveEvidenceReady = checks
      .filter((check) => check.requiredForQualification && check.id !== "pre_click_rehearsal")
      .every((check) => check.met);
    const rehearsalReady = checks.find((check) => check.id === "pre_click_rehearsal")?.met === true;
    const qualificationEvidenceReady = liveEvidenceReady && rehearsalReady;
    const evidenceHashes = [...new Set(rows.map((row) => row.evidenceHash))].sort();
    const liveEvidenceHash = evidenceHashes.length
      ? stableHash("walmart-live-qualification-readiness-v1", WALMART_OBSERVER_VERSION, ...evidenceHashes)
      : "";
    const qualificationHashes = [...evidenceHashes, ...rehearsals.map((row) => row.evidenceHash)].sort();
    const qualificationEvidenceHash = qualificationHashes.length
      ? stableHash("walmart-add-qualification-evidence-v1", WALMART_ADD_ADAPTER_VERSION, ...qualificationHashes)
      : "";
    const qualification = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'walmart'`,
      currentRequestScope().userId
    ) ?? null;
    const actionRank: Record<string, number> = { notify: 0, add_to_cart: 1, prepare_checkout: 2, submit_order: 3 };
    const addToCartQualified = qualification?.status === "qualified"
      && qualification.adapterVersion === WALMART_ADD_ADAPTER_VERSION
      && Number(actionRank[qualification.highestAction] ?? -1) >= 1;
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = mutationAuthorized
      ? "Guarded Walmart add-to-cart execution is active for Walmart-sold shipping offers, quantity one."
      : addToCartQualified
        ? "Walmart add-to-cart is qualified but globally paused. Resume Actions to enable it."
        : !liveEvidenceReady
          ? firstMissingLive?.detail ?? "Collect current Walmart read-only evidence before an add-to-cart rehearsal."
          : !rehearsalReady
            ? "Run one mutation-disabled Walmart add rehearsal from the Chrome companion."
            : "The live dossier and no-click rehearsal are complete. Explicit Walmart add-only qualification review is the remaining gate.";
    return {
      retailerId: "walmart",
      adapterVersion: WALMART_OBSERVER_VERSION,
      addAdapterVersion: WALMART_ADD_ADAPTER_VERSION,
      evidenceWindowDays: 30,
      observationCount: rows.length,
      distinctSkuCount,
      checks,
      liveEvidenceReady,
      rehearsalReady,
      qualificationEvidenceReady,
      rehearsalCount: rehearsals.length,
      liveEvidenceHash,
      qualificationEvidenceHash,
      qualification,
      addToCartQualified,
      mutationAuthorized,
      nextStep
    };
  }

  amazonQualificationReadiness(now = Date.now()): AmazonQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              observation_state AS observationState, evidence_hash AS evidenceHash
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'amazon' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      AMAZON_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const rehearsals = this.db.all<QualificationTrialRow>(
      `SELECT evidence_hash AS evidenceHash FROM retailer_adapter_trials
       WHERE user_id = ? AND retailer_id = 'amazon' AND adapter_version = ?
         AND trial_kind = 'pre_click_rehearsal' AND outcome = 'passed'
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      AMAZON_ADD_ADAPTER_VERSION,
      cutoff
    );
    const counts: Record<AmazonQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Amazon.com").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      offer_route_ready: actionable.filter((row) => row.purchaseRouteReady === 1).length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<AmazonQualificationCheck, "observed" | "met">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an in-stock Amazon.com-sold offer with a usable add control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: "Optional fail-closed coverage; amazon-add-v5 rejects marketplace sellers.",
        required: 1,
        requiredForQualification: false
      },
      {
        id: "shipping_actionable",
        label: "Shipping fulfillment",
        detail: "Capture one actionable Amazon offer explicitly bound to shipping.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "offer_route_ready",
        label: "Ephemeral offer binding",
        detail: "Capture one exact ASIN with a unique offer binding retained only inside the page runner.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "unavailable_fail_closed",
        label: "Unavailable offer",
        detail: "Optional live fail-closed coverage; automated fixtures already enforce this case.",
        required: 1,
        requiredForQualification: false
      },
      {
        id: "sku_diversity",
        label: "Distinct ASIN coverage",
        detail: "Capture at least two different exact Amazon products.",
        required: 2,
        requiredForQualification: true
      },
      {
        id: "pre_click_rehearsal",
        label: "No-click add rehearsal",
        detail: "Run the production Amazon add runner through final validation without clicking.",
        required: 1,
        requiredForQualification: true
      }
    ];
    const checks = definitions.map((definition) => ({
      ...definition,
      observed: counts[definition.id],
      met: counts[definition.id] >= definition.required
    }));
    const liveEvidenceReady = checks
      .filter((check) => check.requiredForQualification && check.id !== "pre_click_rehearsal")
      .every((check) => check.met);
    const rehearsalReady = checks.find((check) => check.id === "pre_click_rehearsal")?.met === true;
    const qualificationEvidenceReady = liveEvidenceReady && rehearsalReady;
    const evidenceHashes = [...new Set(rows.map((row) => row.evidenceHash))].sort();
    const liveEvidenceHash = evidenceHashes.length
      ? stableHash("amazon-live-qualification-readiness-v1", AMAZON_OBSERVER_VERSION, ...evidenceHashes)
      : "";
    const qualificationHashes = [...evidenceHashes, ...rehearsals.map((row) => row.evidenceHash)].sort();
    const qualificationEvidenceHash = qualificationHashes.length
      ? stableHash("amazon-add-qualification-evidence-v1", AMAZON_ADD_ADAPTER_VERSION, ...qualificationHashes)
      : "";
    const qualification = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'amazon'`,
      currentRequestScope().userId
    ) ?? null;
    const actionRank: Record<string, number> = { notify: 0, add_to_cart: 1, prepare_checkout: 2, submit_order: 3 };
    const addToCartQualified = qualification?.status === "qualified"
      && qualification.adapterVersion === AMAZON_ADD_ADAPTER_VERSION
      && Number(actionRank[qualification.highestAction] ?? -1) >= 1;
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = mutationAuthorized
      ? "Guarded Amazon add-to-cart execution is active for Amazon.com-sold shipping offers, quantity one."
      : addToCartQualified
        ? "Amazon add-to-cart is qualified but globally paused. Resume Actions to enable it."
        : !liveEvidenceReady
          ? firstMissingLive?.detail ?? "Collect current Amazon evidence before an add-to-cart rehearsal."
          : !rehearsalReady
            ? "Run one mutation-disabled Amazon add rehearsal from the Chrome companion."
            : "The live dossier and no-click rehearsal are complete. Explicit Amazon add-only qualification review is the remaining gate.";
    return {
      retailerId: "amazon",
      adapterVersion: AMAZON_OBSERVER_VERSION,
      addAdapterVersion: AMAZON_ADD_ADAPTER_VERSION,
      evidenceWindowDays: 30,
      observationCount: rows.length,
      distinctSkuCount,
      checks,
      liveEvidenceReady,
      rehearsalReady,
      qualificationEvidenceReady,
      rehearsalCount: rehearsals.length,
      liveEvidenceHash,
      qualificationEvidenceHash,
      qualification,
      addToCartQualified,
      mutationAuthorized,
      nextStep
    };
  }

  bestBuyQualificationReadiness(now = Date.now()): BestBuyQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              observation_state AS observationState, evidence_hash AS evidenceHash
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'bestbuy' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      BESTBUY_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate" && row.availability === "in_stock");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const rehearsals = this.db.all<QualificationTrialRow>(
      `SELECT evidence_hash AS evidenceHash FROM retailer_adapter_trials
       WHERE user_id = ? AND retailer_id = 'bestbuy' AND adapter_version = ?
         AND trial_kind = 'pre_click_rehearsal' AND outcome = 'passed'
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      BESTBUY_ADD_ADAPTER_VERSION,
      cutoff
    );
    const counts: Record<BestBuyQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Best Buy").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<BestBuyQualificationCheck, "observed" | "met">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an in-stock offer explicitly labeled Sold by Best Buy with a usable add control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: "Optional fail-closed coverage; bestbuy-add-v3 rejects every marketplace seller.",
        required: 1,
        requiredForQualification: false
      },
      {
        id: "shipping_actionable",
        label: "Selected shipping fulfillment",
        detail: "Capture one actionable Best Buy offer with shipping explicitly selected.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "pickup_actionable",
        label: "Pickup fulfillment",
        detail: "Optional fail-closed coverage; bestbuy-add-v3 rejects pickup.",
        required: 1,
        requiredForQualification: false
      },
      {
        id: "unavailable_fail_closed",
        label: "Unavailable offer",
        detail: "Optional live fail-closed coverage; automated fixtures already enforce this case.",
        required: 1,
        requiredForQualification: false
      },
      {
        id: "sku_diversity",
        label: "Distinct SKU coverage",
        detail: "Capture at least two different exact Best Buy products.",
        required: 2,
        requiredForQualification: true
      },
      {
        id: "pre_click_rehearsal",
        label: "No-click add rehearsal",
        detail: "Run the production Best Buy add runner through final validation without clicking.",
        required: 1,
        requiredForQualification: true
      }
    ];
    const checks = definitions.map((definition) => ({
      ...definition,
      observed: counts[definition.id],
      met: counts[definition.id] >= definition.required
    }));
    const liveEvidenceReady = checks
      .filter((check) => check.requiredForQualification && check.id !== "pre_click_rehearsal")
      .every((check) => check.met);
    const rehearsalReady = checks.find((check) => check.id === "pre_click_rehearsal")?.met === true;
    const qualificationEvidenceReady = liveEvidenceReady && rehearsalReady;
    const evidenceHashes = [...new Set(rows.map((row) => row.evidenceHash))].sort();
    const liveEvidenceHash = evidenceHashes.length
      ? stableHash("bestbuy-live-qualification-readiness-v1", BESTBUY_OBSERVER_VERSION, ...evidenceHashes)
      : "";
    const qualificationHashes = [...evidenceHashes, ...rehearsals.map((row) => row.evidenceHash)].sort();
    const qualificationEvidenceHash = qualificationHashes.length
      ? stableHash("bestbuy-add-qualification-evidence-v1", BESTBUY_ADD_ADAPTER_VERSION, ...qualificationHashes)
      : "";
    const qualification = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'bestbuy'`,
      currentRequestScope().userId
    ) ?? null;
    const actionRank: Record<string, number> = { notify: 0, add_to_cart: 1, prepare_checkout: 2, submit_order: 3 };
    const addToCartQualified = qualification?.status === "qualified"
      && qualification.adapterVersion === BESTBUY_ADD_ADAPTER_VERSION
      && Number(actionRank[qualification.highestAction] ?? -1) >= 1;
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = mutationAuthorized
      ? "Guarded Best Buy add-to-cart execution is active for Best Buy-sold, selected-shipping offers, quantity one."
      : addToCartQualified
        ? "Best Buy add-to-cart is qualified but globally paused. Resume Actions to enable it."
        : !liveEvidenceReady
          ? firstMissingLive?.detail ?? "Collect current Best Buy evidence before an add-to-cart rehearsal."
          : !rehearsalReady
            ? "Run one mutation-disabled Best Buy add rehearsal from the Chrome companion."
            : "The live dossier and no-click rehearsal are complete. Explicit Best Buy add-only qualification review is the remaining gate.";
    return {
      retailerId: "bestbuy",
      adapterVersion: BESTBUY_OBSERVER_VERSION,
      addAdapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
      evidenceWindowDays: 30,
      observationCount: rows.length,
      distinctSkuCount,
      checks,
      liveEvidenceReady,
      rehearsalReady,
      qualificationEvidenceReady,
      rehearsalCount: rehearsals.length,
      liveEvidenceHash,
      qualificationEvidenceHash,
      qualification,
      addToCartQualified,
      mutationAuthorized,
      nextStep
    };
  }

  count(): number {
    return Number(this.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM retailer_shadow_observations WHERE user_id = ?",
      currentRequestScope().userId
    )?.count ?? 0);
  }
}
