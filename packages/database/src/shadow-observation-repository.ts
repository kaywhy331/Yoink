import { canonicalRetailerUrl as exactCanonicalRetailerUrl } from "../../domain/src/attribution.js";
import {
  AMAZON_ADD_ADAPTER_VERSION,
  AMAZON_OBSERVER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  POKEMONCENTER_ADD_ADAPTER_VERSION,
  ASUS_ADD_ADAPTER_VERSION,
  AUDIOADVICE_ADD_ADAPTER_VERSION,
  BANANAREPUBLIC_ADD_ADAPTER_VERSION,
  BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION,
  ATHLETA_ADD_ADAPTER_VERSION,
  AMERICANEAGLE_ADD_ADAPTER_VERSION,
  ANINEBING_ADD_ADAPTER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  POKEMONCENTER_OBSERVER_VERSION,
  ASUS_OBSERVER_VERSION,
  AUDIOADVICE_OBSERVER_VERSION,
  BANANAREPUBLIC_OBSERVER_VERSION,
  BANANAREPUBLICFACTORY_OBSERVER_VERSION,
  ATHLETA_OBSERVER_VERSION,
  AMERICANEAGLE_OBSERVER_VERSION,
  ANINEBING_OBSERVER_VERSION,
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
const QUALIFICATION_WARNING_MS = 7 * 24 * 60 * 60_000;
const RETENTION_LIMIT = 1_000;
const EXACT_RETAILER_SKUS = new Set<SupportedRetailerId>([
  "target", "walmart", "amazon", "bestbuy", "ravensburger",
  "booksamillion", "pbandai", "pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"
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
  },
  asus: {
    skuPattern: /^[A-Z0-9]{8}-[A-Z0-9]{6}$/,
    canonicalUrl: (sku, suppliedUrl) => exactCanonicalRetailerUrl(suppliedUrl, "asus", sku),
    firstPartyName: "ASUS"
  },
  audioadvice: {
    skuPattern: /^\d{10,20}$/,
    canonicalUrl: (sku, suppliedUrl) => exactCanonicalRetailerUrl(suppliedUrl, "audioadvice", sku),
    firstPartyName: "Audio Advice"
  },
  bananarepublic: {
    skuPattern: /^\d{9}0000$/,
    canonicalUrl: (sku, suppliedUrl) => exactCanonicalRetailerUrl(suppliedUrl, "bananarepublic", sku),
    firstPartyName: "Banana Republic"
  },
  bananarepublicfactory: {
    skuPattern: /^\d{10}0000$/,
    canonicalUrl: (sku, suppliedUrl) => exactCanonicalRetailerUrl(suppliedUrl, "bananarepublicfactory", sku),
    firstPartyName: "Banana Republic Factory"
  },
  athleta: {
    skuPattern: /^\d{9}0000$/,
    canonicalUrl: (sku, suppliedUrl) => exactCanonicalRetailerUrl(suppliedUrl, "athleta", sku),
    firstPartyName: "Athleta"
  },
  americaneagle: {
    skuPattern: /^\d{10}$/,
    canonicalUrl: (sku, suppliedUrl) => exactCanonicalRetailerUrl(suppliedUrl, "americaneagle", sku),
    firstPartyName: "American Eagle"
  },
  aninebing: {
    skuPattern: /^\d{10,20}$/,
    canonicalUrl: (sku, suppliedUrl) => {
      try {
        const url = new URL(String(suppliedUrl || ""));
        if (url.protocol !== "https:" || url.username || url.password || url.port
          || !["aninebing.com", "www.aninebing.com"].includes(url.hostname)
          || !/^\/products\/[a-z0-9-]+\/?$/.test(url.pathname) || url.searchParams.get("variant") !== sku) return "";
        url.hostname = "www.aninebing.com";
        url.search = "";
        url.searchParams.set("variant", sku);
        url.hash = "";
        return url.href;
      } catch { return ""; }
    },
    firstPartyName: "ANINE BING"
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
  products: QualificationCheckProduct[];
}

export interface QualificationCheckProduct {
  retailerSku: string;
  canonicalUrl: string;
  observedAt: string;
  status: "passed" | "did_not_pass" | "needs_store_step" | "counted";
  detail: string;
}

export type AddQualificationWarning = "none" | "expiring" | "expired" | "version_changed";

export interface AddQualificationRecord {
  adapterVersion: string;
  highestAction: string;
  status: "qualified" | "suspended" | "retired";
  qualifiedAt: string;
  updatedAt: string;
  expiresAt: string;
  expiresInMs: number | null;
  currentVersion: boolean;
  warning: AddQualificationWarning;
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
  qualification: AddQualificationRecord | null;
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
  qualification: AddQualificationRecord | null;
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
  qualification: AddQualificationRecord | null;
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
  qualification: AddQualificationRecord | null;
  addToCartQualified: boolean;
  mutationAuthorized: boolean;
  nextStep: string;
}

export interface PokemonCenterQualificationReadiness {
  retailerId: "pokemoncenter";
  adapterVersion: typeof POKEMONCENTER_OBSERVER_VERSION;
  addAdapterVersion: typeof POKEMONCENTER_ADD_ADAPTER_VERSION;
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
  qualification: AddQualificationRecord | null;
  addToCartQualified: boolean;
  mutationAuthorized: boolean;
  nextStep: string;
}

export interface AnineBingQualificationReadiness {
  retailerId: "aninebing";
  adapterVersion: typeof ANINEBING_OBSERVER_VERSION;
  addAdapterVersion: typeof ANINEBING_ADD_ADAPTER_VERSION;
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
  qualification: AddQualificationRecord | null;
  addToCartQualified: boolean;
  mutationAuthorized: boolean;
  nextStep: string;
}

export interface AmericanEagleQualificationReadiness {
  retailerId: "americaneagle";
  adapterVersion: typeof AMERICANEAGLE_OBSERVER_VERSION;
  addAdapterVersion: typeof AMERICANEAGLE_ADD_ADAPTER_VERSION;
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
  qualification: AddQualificationRecord | null;
  addToCartQualified: boolean;
  mutationAuthorized: boolean;
  nextStep: string;
}

export interface AthletaQualificationReadiness {
  retailerId: "athleta";
  adapterVersion: typeof ATHLETA_OBSERVER_VERSION;
  addAdapterVersion: typeof ATHLETA_ADD_ADAPTER_VERSION;
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
  qualification: AddQualificationRecord | null;
  addToCartQualified: boolean;
  mutationAuthorized: boolean;
  nextStep: string;
}

export interface AudioAdviceQualificationReadiness {
  retailerId: "audioadvice";
  adapterVersion: typeof AUDIOADVICE_OBSERVER_VERSION;
  addAdapterVersion: typeof AUDIOADVICE_ADD_ADAPTER_VERSION;
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
  qualification: AddQualificationRecord | null;
  addToCartQualified: boolean;
  mutationAuthorized: boolean;
  nextStep: string;
}

export interface BananaRepublicQualificationReadiness {
  retailerId: "bananarepublic";
  adapterVersion: typeof BANANAREPUBLIC_OBSERVER_VERSION;
  addAdapterVersion: typeof BANANAREPUBLIC_ADD_ADAPTER_VERSION;
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
  qualification: AddQualificationRecord | null;
  addToCartQualified: boolean;
  mutationAuthorized: boolean;
  nextStep: string;
}

export interface BananaRepublicFactoryQualificationReadiness {
  retailerId: "bananarepublicfactory";
  adapterVersion: typeof BANANAREPUBLICFACTORY_OBSERVER_VERSION;
  addAdapterVersion: typeof BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION;
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
  qualification: AddQualificationRecord | null;
  addToCartQualified: boolean;
  mutationAuthorized: boolean;
  nextStep: string;
}

export interface AsusQualificationReadiness {
  retailerId: "asus";
  adapterVersion: typeof ASUS_OBSERVER_VERSION;
  addAdapterVersion: typeof ASUS_ADD_ADAPTER_VERSION;
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
  qualification: AddQualificationRecord | null;
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

export interface QualificationCandidate {
  retailerId: "target" | "walmart" | "amazon" | "bestbuy" | "pokemoncenter" | "aninebing" | "americaneagle" | "asus" | "athleta" | "audioadvice" | "bananarepublic" | "bananarepublicfactory";
  retailerSku: string;
  canonicalUrl: string;
  unitPriceCents: number;
  currency: "USD";
  sellerName: string;
  fulfillment: "shipping";
  observedAt: string;
  shadowObservationId: string;
  rehearsalPassed: boolean;
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
  canonicalUrl: string;
  availability: Availability;
  sellerName: string;
  sellerType: SellerType;
  fulfillment: "shipping" | "pickup" | "unknown";
  addControlActionable: number;
  purchaseRouteReady: number;
  observationState: ShadowObservationState;
  interactiveBlock?: string;
  securityChallenge?: number;
  evidenceHash: string;
  observedAt: string;
}

interface QualificationRow {
  adapterVersion: string;
  highestAction: string;
  status: "qualified" | "suspended" | "retired";
  qualifiedAt: string;
  updatedAt: string;
  expiresAt: string;
}

function qualificationState(
  row: QualificationRow | null,
  expectedAdapterVersion: string,
  now: number
): { qualification: AddQualificationRecord | null; addToCartQualified: boolean } {
  if (!row) return { qualification: null, addToCartQualified: false };
  const expirationTime = new Date(row.expiresAt).getTime();
  const currentVersion = row.adapterVersion === expectedAdapterVersion;
  const warning: AddQualificationWarning = !currentVersion
    ? "version_changed"
    : !Number.isFinite(expirationTime) || expirationTime <= now
      ? "expired"
      : expirationTime <= now + QUALIFICATION_WARNING_MS
        ? "expiring"
        : "none";
  const actionRank: Record<string, number> = { notify: 0, add_to_cart: 1, prepare_checkout: 2, submit_order: 3 };
  return {
    qualification: {
      ...row,
      expiresInMs: Number.isFinite(expirationTime) ? Math.round(expirationTime - now) : null,
      currentVersion,
      warning
    },
    addToCartQualified: row.status === "qualified"
      && currentVersion
      && Number.isFinite(expirationTime)
      && expirationTime > now
      && Number(actionRank[row.highestAction] ?? -1) >= 1
  };
}

interface QualificationTrialRow {
  retailerSku: string;
  canonicalUrl: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
  evidenceHash: string;
  observedAt: string;
}

type QualificationCheckId = TargetQualificationCheckId | AmazonQualificationCheckId;

function latestBySku<T extends { retailerSku: string; observedAt: string }>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const current = latest.get(row.retailerSku);
    if (!current || row.observedAt >= current.observedAt) latest.set(row.retailerSku, row);
  }
  return [...latest.values()].sort((left, right) => right.observedAt.localeCompare(left.observedAt));
}

function qualificationCheckProducts(
  checkId: QualificationCheckId,
  rows: QualificationEvidenceRow[],
  trials: QualificationTrialRow[],
  firstPartyName: string
): QualificationCheckProduct[] {
  if (checkId === "pre_click_rehearsal") {
    const products: QualificationCheckProduct[] = latestBySku(trials).map((trial) => ({
      retailerSku: trial.retailerSku,
      canonicalUrl: trial.canonicalUrl,
      observedAt: trial.observedAt,
      status: trial.outcome === "passed" ? "passed" : "did_not_pass",
      detail: trial.outcome === "passed" ? "No-click rehearsal passed" : trial.reasonCode.replaceAll("_", " ")
    }));
    if (firstPartyName === "Best Buy") {
      for (const row of latestBySku(rows)) {
        if (row.observationState !== "manual_block" || products.some(product => product.retailerSku === row.retailerSku)) continue;
        products.push({ retailerSku: row.retailerSku, canonicalUrl: row.canonicalUrl, observedAt: row.observedAt,
          status: "needs_store_step", detail: `Rehearsal blocked before final validation. ${bestBuyQualificationStoreStep(row)}` });
      }
    }
    return products;
  }
  return latestBySku(rows).map((row) => {
    if (firstPartyName === "Best Buy" && checkId === "sku_diversity") {
      return { retailerSku: row.retailerSku, canonicalUrl: row.canonicalUrl, observedAt: row.observedAt,
        status: "counted", detail: "Product identity counted toward distinct SKU coverage; offer qualification is separate." };
    }
    if (firstPartyName === "Best Buy" && row.observationState === "manual_block") {
      return { retailerSku: row.retailerSku, canonicalUrl: row.canonicalUrl, observedAt: row.observedAt,
        status: "needs_store_step", detail: bestBuyQualificationStoreStep(row) };
    }
    const actionable = row.observationState === "actionable_candidate";
    const passed = checkId === "first_party_actionable"
      ? actionable && row.sellerType === "first_party" && row.sellerName === firstPartyName
      : checkId === "named_marketplace_actionable"
        ? actionable && row.sellerType === "third_party" && Boolean(row.sellerName)
        : checkId === "shipping_actionable"
          ? actionable && row.fulfillment === "shipping"
          : checkId === "pickup_actionable"
            ? actionable && row.fulfillment === "pickup"
            : checkId === "offer_route_ready"
              ? actionable && row.purchaseRouteReady === 1
              : checkId === "unavailable_fail_closed"
                ? row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable"
                : checkId === "sku_diversity";
    return {
      retailerSku: row.retailerSku,
      canonicalUrl: row.canonicalUrl,
      observedAt: row.observedAt,
      status: passed ? "passed" : "did_not_pass",
      detail: `${row.observationState.replaceAll("_", " ")} · ${row.availability.replaceAll("_", " ")} · ${row.sellerName || "seller unknown"} · ${row.fulfillment}`
    };
  });
}

function bestBuyQualificationStoreStep(row: QualificationEvidenceRow): string {
  if (row.securityChallenge) return "Security verification required. Complete Best Buy’s browser check, then inspect again.";
  if (row.interactiveBlock === "high_demand") return "Reservation required. Complete Best Buy’s reservation steps, then inspect again when the offer has a selected fulfillment option and a usable Add control.";
  if (row.interactiveBlock === "queue") return "Waiting in Best Buy’s queue. Keep the original tab open and inspect again after admission.";
  if (row.interactiveBlock === "auth" || row.interactiveBlock === "mfa") return "Account verification required. Complete Best Buy’s sign-in or verification step, then inspect again.";
  if (row.interactiveBlock === "location") return "Store or location selection required. Complete the Best Buy location step, then inspect again.";
  if (row.interactiveBlock === "membership") return "Membership step required. Complete Best Buy’s membership step, then inspect again.";
  return "Best Buy needs a manual step before the offer can be checked. Complete the step in the product tab, then inspect again.";
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

  qualificationCandidates(now = Date.now()): QualificationCandidate[] {
    const guardedRetailers = new Set<QualificationCandidate["retailerId"]>([
      "target", "walmart", "amazon", "bestbuy", "pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"
    ]);
    const currentObserverVersions: Record<QualificationCandidate["retailerId"], string> = {
      target: TARGET_OBSERVER_VERSION,
      walmart: WALMART_OBSERVER_VERSION,
      amazon: AMAZON_OBSERVER_VERSION,
      bestbuy: BESTBUY_OBSERVER_VERSION,
      pokemoncenter: POKEMONCENTER_OBSERVER_VERSION,
      asus: ASUS_OBSERVER_VERSION,
      audioadvice: AUDIOADVICE_OBSERVER_VERSION,
      bananarepublic: BANANAREPUBLIC_OBSERVER_VERSION,
      bananarepublicfactory: BANANAREPUBLICFACTORY_OBSERVER_VERSION,
      athleta: ATHLETA_OBSERVER_VERSION,
      americaneagle: AMERICANEAGLE_OBSERVER_VERSION,
      aninebing: ANINEBING_OBSERVER_VERSION
    };
    const currentAddVersions: Record<QualificationCandidate["retailerId"], string> = {
      target: TARGET_ADD_ADAPTER_VERSION,
      walmart: WALMART_ADD_ADAPTER_VERSION,
      amazon: AMAZON_ADD_ADAPTER_VERSION,
      bestbuy: BESTBUY_ADD_ADAPTER_VERSION,
      pokemoncenter: POKEMONCENTER_ADD_ADAPTER_VERSION,
      asus: ASUS_ADD_ADAPTER_VERSION,
      audioadvice: AUDIOADVICE_ADD_ADAPTER_VERSION,
      bananarepublic: BANANAREPUBLIC_ADD_ADAPTER_VERSION,
      bananarepublicfactory: BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION,
      athleta: ATHLETA_ADD_ADAPTER_VERSION,
      americaneagle: AMERICANEAGLE_ADD_ADAPTER_VERSION,
      aninebing: ANINEBING_ADD_ADAPTER_VERSION
    };
    const cutoff = now - QUALIFICATION_EVIDENCE_WINDOW_MS;
    const passedRows = this.db.all<{ shadowObservationId: string; retailerId: QualificationCandidate["retailerId"]; adapterVersion: string }>(
      `SELECT shadow_observation_id AS shadowObservationId, retailer_id AS retailerId,
              adapter_version AS adapterVersion
       FROM retailer_adapter_trials
       WHERE user_id = ? AND trial_kind = 'pre_click_rehearsal' AND outcome = 'passed'
         AND observed_at >= ?`,
      currentRequestScope().userId,
      nowIso(cutoff)
    );
    const passed = new Set(passedRows
      .filter((row) => guardedRetailers.has(row.retailerId)
        && row.adapterVersion === currentAddVersions[row.retailerId])
      .map((row) => row.shadowObservationId));
    const selected = new Map<QualificationCandidate["retailerId"], QualificationCandidate>();
    for (const observation of this.listRecent(250)) {
      if (!guardedRetailers.has(observation.retailerId as QualificationCandidate["retailerId"])) continue;
      const retailerId = observation.retailerId as QualificationCandidate["retailerId"];
      if (selected.has(retailerId)
        || observation.adapterVersion !== currentObserverVersions[retailerId]
        || new Date(observation.observedAt).getTime() < cutoff
        || observation.observationState !== "actionable_candidate"
        || !["in_stock", "preorder"].includes(observation.availability)
        || observation.sellerType !== "first_party"
        || observation.fulfillment !== "shipping"
        || !observation.addControlActionable
        || observation.securityChallenge
        || Boolean(observation.interactiveBlock)
        || !Number.isSafeInteger(observation.unitPriceCents)
        || Number(observation.unitPriceCents) <= 0
        || (retailerId === "amazon" && observation.purchaseRouteReady !== true)) continue;
      selected.set(retailerId, {
        retailerId,
        retailerSku: observation.retailerSku,
        canonicalUrl: observation.canonicalUrl,
        unitPriceCents: Number(observation.unitPriceCents),
        currency: "USD",
        sellerName: observation.sellerName,
        fulfillment: "shipping",
        observedAt: observation.observedAt,
        shadowObservationId: observation.id,
        rehearsalPassed: passed.has(observation.id)
      });
    }
    return [...selected.values()].sort((left, right) => left.retailerId.localeCompare(right.retailerId));
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
        mode: ["target", "walmart", "amazon", "bestbuy", "pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"].includes(retailerId) ? "guarded_add" : "read_only"
      };
    });
  }

  targetQualificationReadiness(now = Date.now()): TargetQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, canonical_url AS canonicalUrl, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt
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
    const trialRows = this.db.all<QualificationTrialRow>(
      `SELECT trial.retailer_sku AS retailerSku, shadow.canonical_url AS canonicalUrl,
              trial.outcome, trial.reason_code AS reasonCode,
              trial.evidence_hash AS evidenceHash, trial.observed_at AS observedAt
       FROM retailer_adapter_trials trial
       JOIN retailer_shadow_observations shadow ON shadow.id = trial.shadow_observation_id
       WHERE trial.user_id = ? AND trial.retailer_id = 'target' AND trial.adapter_version = ?
         AND trial.trial_kind = 'pre_click_rehearsal' AND trial.observed_at >= ?
       ORDER BY trial.observed_at, trial.id`,
      currentRequestScope().userId,
      TARGET_ADD_ADAPTER_VERSION,
      cutoff
    );
    const rehearsals = trialRows.filter((trial) => trial.outcome === "passed");
    const counts: Record<TargetQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Target").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<TargetQualificationCheck, "observed" | "met" | "products">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an available Target-sold offer with a usable Add or Pre-order control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: `Optional coverage for a future marketplace-capable adapter; ${TARGET_ADD_ADAPTER_VERSION} rejects it.`,
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
        detail: "Optional live coverage for explicitly configured Pickup; Shipping remains the default.",
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
      met: counts[definition.id] >= definition.required,
      products: qualificationCheckProducts(definition.id, rows, trialRows, "Target")
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
    const qualificationRow = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt,
              expires_at AS expiresAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'target'`,
      currentRequestScope().userId
    ) ?? null;
    const { qualification, addToCartQualified } = qualificationState(
      qualificationRow,
      TARGET_ADD_ADAPTER_VERSION,
      now
    );
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = qualification?.warning === "version_changed"
      ? "The packaged Target add runner changed. Re-run the no-click qualification before guarded adds can resume."
      : qualification?.warning === "expired"
        ? "The Target add qualification expired. Re-run the no-click qualification before guarded adds can resume."
        : mutationAuthorized
          ? "Guarded Target add-to-cart execution is active for Target-sold offers matching the saved Shipping or Pickup choice, quantity one."
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
      `SELECT retailer_sku AS retailerSku, canonical_url AS canonicalUrl, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt
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
    const trialRows = this.db.all<QualificationTrialRow>(
      `SELECT trial.retailer_sku AS retailerSku, shadow.canonical_url AS canonicalUrl,
              trial.outcome, trial.reason_code AS reasonCode,
              trial.evidence_hash AS evidenceHash, trial.observed_at AS observedAt
       FROM retailer_adapter_trials trial
       JOIN retailer_shadow_observations shadow ON shadow.id = trial.shadow_observation_id
       WHERE trial.user_id = ? AND trial.retailer_id = 'walmart' AND trial.adapter_version = ?
         AND trial.trial_kind = 'pre_click_rehearsal' AND trial.observed_at >= ?
       ORDER BY trial.observed_at, trial.id`,
      currentRequestScope().userId,
      WALMART_ADD_ADAPTER_VERSION,
      cutoff
    );
    const rehearsals = trialRows.filter((trial) => trial.outcome === "passed");
    const counts: Record<WalmartQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Walmart").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<WalmartQualificationCheck, "observed" | "met" | "products">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an available Walmart-sold offer with a usable Add or Pre-order control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: `Optional coverage for a future marketplace-capable adapter; ${WALMART_ADD_ADAPTER_VERSION} rejects it.`,
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
        detail: "Optional live coverage for explicitly configured Pickup; Shipping remains the default.",
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
      met: counts[definition.id] >= definition.required,
      products: qualificationCheckProducts(definition.id, rows, trialRows, "Walmart")
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
    const qualificationRow = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt,
              expires_at AS expiresAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'walmart'`,
      currentRequestScope().userId
    ) ?? null;
    const { qualification, addToCartQualified } = qualificationState(
      qualificationRow,
      WALMART_ADD_ADAPTER_VERSION,
      now
    );
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = qualification?.warning === "version_changed"
      ? "The packaged Walmart add runner changed. Re-run the no-click qualification before guarded adds can resume."
      : qualification?.warning === "expired"
        ? "The Walmart add qualification expired. Re-run the no-click qualification before guarded adds can resume."
        : mutationAuthorized
          ? "Guarded Walmart add-to-cart execution is active for Walmart-sold offers matching the saved Shipping or Pickup choice, quantity one."
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
      `SELECT retailer_sku AS retailerSku, canonical_url AS canonicalUrl, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt
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
    const trialRows = this.db.all<QualificationTrialRow>(
      `SELECT trial.retailer_sku AS retailerSku, shadow.canonical_url AS canonicalUrl,
              trial.outcome, trial.reason_code AS reasonCode,
              trial.evidence_hash AS evidenceHash, trial.observed_at AS observedAt
       FROM retailer_adapter_trials trial
       JOIN retailer_shadow_observations shadow ON shadow.id = trial.shadow_observation_id
       WHERE trial.user_id = ? AND trial.retailer_id = 'amazon' AND trial.adapter_version = ?
         AND trial.trial_kind = 'pre_click_rehearsal' AND trial.observed_at >= ?
       ORDER BY trial.observed_at, trial.id`,
      currentRequestScope().userId,
      AMAZON_ADD_ADAPTER_VERSION,
      cutoff
    );
    const rehearsals = trialRows.filter((trial) => trial.outcome === "passed");
    const counts: Record<AmazonQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Amazon.com").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      offer_route_ready: actionable.filter((row) => row.purchaseRouteReady === 1).length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<AmazonQualificationCheck, "observed" | "met" | "products">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an available Amazon.com-sold offer with a usable Add or Pre-order control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: `Optional fail-closed coverage; ${AMAZON_ADD_ADAPTER_VERSION} rejects marketplace sellers.`,
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
      met: counts[definition.id] >= definition.required,
      products: qualificationCheckProducts(definition.id, rows, trialRows, "Amazon.com")
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
    const qualificationRow = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt,
              expires_at AS expiresAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'amazon'`,
      currentRequestScope().userId
    ) ?? null;
    const { qualification, addToCartQualified } = qualificationState(
      qualificationRow,
      AMAZON_ADD_ADAPTER_VERSION,
      now
    );
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = qualification?.warning === "version_changed"
      ? "The packaged Amazon add runner changed. Re-run the no-click qualification before guarded adds can resume."
      : qualification?.warning === "expired"
        ? "The Amazon add qualification expired. Re-run the no-click qualification before guarded adds can resume."
        : mutationAuthorized
          ? "Guarded Amazon add-to-cart execution is active for Amazon.com-sold offers matching the saved Shipping or Pickup choice, quantity one."
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
      `SELECT retailer_sku AS retailerSku, canonical_url AS canonicalUrl, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              interactive_block AS interactiveBlock, security_challenge AS securityChallenge,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'bestbuy' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      BESTBUY_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const trialRows = this.db.all<QualificationTrialRow>(
      `SELECT trial.retailer_sku AS retailerSku, shadow.canonical_url AS canonicalUrl,
              trial.outcome, trial.reason_code AS reasonCode,
              trial.evidence_hash AS evidenceHash, trial.observed_at AS observedAt
       FROM retailer_adapter_trials trial
       JOIN retailer_shadow_observations shadow ON shadow.id = trial.shadow_observation_id
       WHERE trial.user_id = ? AND trial.retailer_id = 'bestbuy' AND trial.adapter_version = ?
         AND trial.trial_kind = 'pre_click_rehearsal' AND trial.observed_at >= ?
       ORDER BY trial.observed_at, trial.id`,
      currentRequestScope().userId,
      BESTBUY_ADD_ADAPTER_VERSION,
      cutoff
    );
    const rehearsals = trialRows.filter((trial) => trial.outcome === "passed");
    const counts: Record<BestBuyQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Best Buy").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<BestBuyQualificationCheck, "observed" | "met" | "products">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an available offer explicitly labeled Sold by Best Buy with a usable Add or Pre-order control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: `Optional fail-closed coverage; ${BESTBUY_ADD_ADAPTER_VERSION} rejects every marketplace seller.`,
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
        detail: "Optional live coverage for explicitly configured Pickup; Shipping remains the default.",
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
      met: counts[definition.id] >= definition.required,
      products: qualificationCheckProducts(definition.id, rows, trialRows, "Best Buy")
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
    const qualificationRow = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt,
              expires_at AS expiresAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'bestbuy'`,
      currentRequestScope().userId
    ) ?? null;
    const { qualification, addToCartQualified } = qualificationState(
      qualificationRow,
      BESTBUY_ADD_ADAPTER_VERSION,
      now
    );
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const blockedOffer = !actionable.length ? latestBySku(rows).find(row => row.observationState === "manual_block") : undefined;
    const nextStep = qualification?.warning === "version_changed"
      ? "The packaged Best Buy add runner changed. Re-run the no-click qualification before guarded adds can resume."
      : qualification?.warning === "expired"
        ? "The Best Buy add qualification expired. Re-run the no-click qualification before guarded adds can resume."
        : mutationAuthorized
          ? "Guarded Best Buy add-to-cart execution is active for Best Buy-sold offers matching the saved Shipping or Pickup choice, quantity one."
          : addToCartQualified
            ? "Best Buy add-to-cart is qualified but globally paused. Resume Actions to enable it."
            : !liveEvidenceReady
              ? blockedOffer ? bestBuyQualificationStoreStep(blockedOffer)
                : firstMissingLive?.detail ?? "Collect current Best Buy evidence before an add-to-cart rehearsal."
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

  pokemonCenterQualificationReadiness(now = Date.now()): PokemonCenterQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, canonical_url AS canonicalUrl, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'pokemoncenter' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      POKEMONCENTER_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const trialRows = this.db.all<QualificationTrialRow>(
      `SELECT trial.retailer_sku AS retailerSku, shadow.canonical_url AS canonicalUrl,
              trial.outcome, trial.reason_code AS reasonCode,
              trial.evidence_hash AS evidenceHash, trial.observed_at AS observedAt
       FROM retailer_adapter_trials trial
       JOIN retailer_shadow_observations shadow ON shadow.id = trial.shadow_observation_id
       WHERE trial.user_id = ? AND trial.retailer_id = 'pokemoncenter' AND trial.adapter_version = ?
         AND trial.trial_kind = 'pre_click_rehearsal' AND trial.observed_at >= ?
       ORDER BY trial.observed_at, trial.id`,
      currentRequestScope().userId,
      POKEMONCENTER_ADD_ADAPTER_VERSION,
      cutoff
    );
    const rehearsals = trialRows.filter((trial) => trial.outcome === "passed");
    const counts: Record<BestBuyQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Pokémon Center").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<BestBuyQualificationCheck, "observed" | "met" | "products">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an available Pokémon Center product with an exact SKU, USD price, quantity one and a usable Add control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: `Optional fail-closed coverage; ${POKEMONCENTER_ADD_ADAPTER_VERSION} rejects every marketplace seller.`,
        required: 1,
        requiredForQualification: false
      },
      {
        id: "shipping_actionable",
        label: "Selected shipping fulfillment",
        detail: "Capture one actionable Pokémon Center offer with shipping explicitly selected.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "pickup_actionable",
        label: "Pickup fulfillment",
        detail: "Unsupported by this shipping-only adapter; pickup evidence cannot authorize an Add.",
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
        detail: "Capture at least two different exact Pokémon Center products.",
        required: 2,
        requiredForQualification: true
      },
      {
        id: "pre_click_rehearsal",
        label: "No-click add rehearsal",
        detail: "Run the production Pokémon Center add runner through final validation without clicking.",
        required: 1,
        requiredForQualification: true
      }
    ];
    const checks = definitions.map((definition) => ({
      ...definition,
      observed: counts[definition.id],
      met: counts[definition.id] >= definition.required,
      products: qualificationCheckProducts(definition.id, rows, trialRows, "Pokémon Center")
    }));
    const liveEvidenceReady = checks
      .filter((check) => check.requiredForQualification && check.id !== "pre_click_rehearsal")
      .every((check) => check.met);
    const rehearsalReady = checks.find((check) => check.id === "pre_click_rehearsal")?.met === true;
    const qualificationEvidenceReady = liveEvidenceReady && rehearsalReady;
    const evidenceHashes = [...new Set(rows.map((row) => row.evidenceHash))].sort();
    const liveEvidenceHash = evidenceHashes.length
      ? stableHash("pokemoncenter-live-qualification-readiness-v1", POKEMONCENTER_OBSERVER_VERSION, ...evidenceHashes)
      : "";
    const qualificationHashes = [...evidenceHashes, ...rehearsals.map((row) => row.evidenceHash)].sort();
    const qualificationEvidenceHash = qualificationHashes.length
      ? stableHash("pokemoncenter-add-qualification-evidence-v1", POKEMONCENTER_ADD_ADAPTER_VERSION, ...qualificationHashes)
      : "";
    const qualificationRow = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt,
              expires_at AS expiresAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'pokemoncenter'`,
      currentRequestScope().userId
    ) ?? null;
    const { qualification, addToCartQualified } = qualificationState(
      qualificationRow,
      POKEMONCENTER_ADD_ADAPTER_VERSION,
      now
    );
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = qualification?.warning === "version_changed"
      ? "The packaged Pokémon Center add runner changed. Re-run the no-click qualification before guarded adds can resume."
      : qualification?.warning === "expired"
        ? "The Pokémon Center add qualification expired. Re-run the no-click qualification before guarded adds can resume."
        : mutationAuthorized
          ? "Guarded Pokémon Center add-to-cart execution is active for Pokémon Center-sold offers with shipping, quantity one."
          : addToCartQualified
            ? "Pokémon Center add-to-cart is qualified but globally paused. Resume Actions to enable it."
            : !liveEvidenceReady
              ? firstMissingLive?.detail ?? "Collect current Pokémon Center evidence before an add-to-cart rehearsal."
              : !rehearsalReady
                ? "Run one mutation-disabled Pokémon Center add rehearsal from the Chrome companion."
                : "The live dossier and no-click rehearsal are complete. Explicit Pokémon Center add-only qualification review is the remaining gate.";
    return {
      retailerId: "pokemoncenter",
      adapterVersion: POKEMONCENTER_OBSERVER_VERSION,
      addAdapterVersion: POKEMONCENTER_ADD_ADAPTER_VERSION,
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
  asusQualificationReadiness(now = Date.now()): AsusQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, canonical_url AS canonicalUrl, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'asus' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      ASUS_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const trialRows = this.db.all<QualificationTrialRow>(
      `SELECT trial.retailer_sku AS retailerSku, shadow.canonical_url AS canonicalUrl,
              trial.outcome, trial.reason_code AS reasonCode,
              trial.evidence_hash AS evidenceHash, trial.observed_at AS observedAt
       FROM retailer_adapter_trials trial
       JOIN retailer_shadow_observations shadow ON shadow.id = trial.shadow_observation_id
       WHERE trial.user_id = ? AND trial.retailer_id = 'asus' AND trial.adapter_version = ?
         AND trial.trial_kind = 'pre_click_rehearsal' AND trial.observed_at >= ?
       ORDER BY trial.observed_at, trial.id`,
      currentRequestScope().userId,
      ASUS_ADD_ADAPTER_VERSION,
      cutoff
    );
    const rehearsals = trialRows.filter((trial) => trial.outcome === "passed");
    const counts: Record<BestBuyQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "ASUS").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<BestBuyQualificationCheck, "observed" | "met" | "products">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an available ASUS product with an exact SKU, USD price, quantity one and a usable Add control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: `Optional fail-closed coverage; ${ASUS_ADD_ADAPTER_VERSION} rejects every marketplace seller.`,
        required: 1,
        requiredForQualification: false
      },
      {
        id: "shipping_actionable",
        label: "Selected shipping fulfillment",
        detail: "Capture one actionable ASUS offer with shipping explicitly selected.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "pickup_actionable",
        label: "Pickup fulfillment",
        detail: "Unsupported by this shipping-only adapter; pickup evidence cannot authorize an Add.",
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
        detail: "Capture at least two different exact ASUS products.",
        required: 2,
        requiredForQualification: true
      },
      {
        id: "pre_click_rehearsal",
        label: "No-click add rehearsal",
        detail: "Run the production ASUS add runner through final validation without clicking.",
        required: 1,
        requiredForQualification: true
      }
    ];
    const checks = definitions.map((definition) => ({
      ...definition,
      observed: counts[definition.id],
      met: counts[definition.id] >= definition.required,
      products: qualificationCheckProducts(definition.id, rows, trialRows, "ASUS")
    }));
    const liveEvidenceReady = checks
      .filter((check) => check.requiredForQualification && check.id !== "pre_click_rehearsal")
      .every((check) => check.met);
    const rehearsalReady = checks.find((check) => check.id === "pre_click_rehearsal")?.met === true;
    const qualificationEvidenceReady = liveEvidenceReady && rehearsalReady;
    const evidenceHashes = [...new Set(rows.map((row) => row.evidenceHash))].sort();
    const liveEvidenceHash = evidenceHashes.length
      ? stableHash("asus-live-qualification-readiness-v1", ASUS_OBSERVER_VERSION, ...evidenceHashes)
      : "";
    const qualificationHashes = [...evidenceHashes, ...rehearsals.map((row) => row.evidenceHash)].sort();
    const qualificationEvidenceHash = qualificationHashes.length
      ? stableHash("asus-add-qualification-evidence-v1", ASUS_ADD_ADAPTER_VERSION, ...qualificationHashes)
      : "";
    const qualificationRow = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt,
              expires_at AS expiresAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'asus'`,
      currentRequestScope().userId
    ) ?? null;
    const { qualification, addToCartQualified } = qualificationState(
      qualificationRow,
      ASUS_ADD_ADAPTER_VERSION,
      now
    );
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = qualification?.warning === "version_changed"
      ? "The packaged ASUS add runner changed. Re-run the no-click qualification before guarded adds can resume."
      : qualification?.warning === "expired"
        ? "The ASUS add qualification expired. Re-run the no-click qualification before guarded adds can resume."
        : mutationAuthorized
          ? "Guarded ASUS add-to-cart execution is active for ASUS-sold offers with shipping, quantity one."
          : addToCartQualified
            ? "ASUS add-to-cart is qualified but globally paused. Resume Actions to enable it."
            : !liveEvidenceReady
              ? firstMissingLive?.detail ?? "Collect current ASUS evidence before an add-to-cart rehearsal."
              : !rehearsalReady
                ? "Run one mutation-disabled ASUS add rehearsal from the Chrome companion."
                : "The live dossier and no-click rehearsal are complete. Explicit ASUS add-only qualification review is the remaining gate.";
    return {
      retailerId: "asus",
      adapterVersion: ASUS_OBSERVER_VERSION,
      addAdapterVersion: ASUS_ADD_ADAPTER_VERSION,
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
  audioadviceQualificationReadiness(now = Date.now()): AudioAdviceQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, canonical_url AS canonicalUrl, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'audioadvice' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      AUDIOADVICE_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const trialRows = this.db.all<QualificationTrialRow>(
      `SELECT trial.retailer_sku AS retailerSku, shadow.canonical_url AS canonicalUrl,
              trial.outcome, trial.reason_code AS reasonCode,
              trial.evidence_hash AS evidenceHash, trial.observed_at AS observedAt
       FROM retailer_adapter_trials trial
       JOIN retailer_shadow_observations shadow ON shadow.id = trial.shadow_observation_id
       WHERE trial.user_id = ? AND trial.retailer_id = 'audioadvice' AND trial.adapter_version = ?
         AND trial.trial_kind = 'pre_click_rehearsal' AND trial.observed_at >= ?
       ORDER BY trial.observed_at, trial.id`,
      currentRequestScope().userId,
      AUDIOADVICE_ADD_ADAPTER_VERSION,
      cutoff
    );
    const rehearsals = trialRows.filter((trial) => trial.outcome === "passed");
    const counts: Record<BestBuyQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Audio Advice").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<BestBuyQualificationCheck, "observed" | "met" | "products">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an available Audio Advice product with an exact SKU, USD price, quantity one and a usable Add control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: `Optional fail-closed coverage; ${AUDIOADVICE_ADD_ADAPTER_VERSION} rejects every marketplace seller.`,
        required: 1,
        requiredForQualification: false
      },
      {
        id: "shipping_actionable",
        label: "Selected shipping fulfillment",
        detail: "Capture one actionable Audio Advice offer with shipping explicitly selected.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "pickup_actionable",
        label: "Pickup fulfillment",
        detail: "Unsupported by this shipping-only adapter; pickup evidence cannot authorize an Add.",
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
        detail: "Capture at least two different exact Audio Advice products.",
        required: 2,
        requiredForQualification: true
      },
      {
        id: "pre_click_rehearsal",
        label: "No-click add rehearsal",
        detail: "Run the production Audio Advice add runner through final validation without clicking.",
        required: 1,
        requiredForQualification: true
      }
    ];
    const checks = definitions.map((definition) => ({
      ...definition,
      observed: counts[definition.id],
      met: counts[definition.id] >= definition.required,
      products: qualificationCheckProducts(definition.id, rows, trialRows, "Audio Advice")
    }));
    const liveEvidenceReady = checks
      .filter((check) => check.requiredForQualification && check.id !== "pre_click_rehearsal")
      .every((check) => check.met);
    const rehearsalReady = checks.find((check) => check.id === "pre_click_rehearsal")?.met === true;
    const qualificationEvidenceReady = liveEvidenceReady && rehearsalReady;
    const evidenceHashes = [...new Set(rows.map((row) => row.evidenceHash))].sort();
    const liveEvidenceHash = evidenceHashes.length
      ? stableHash("audioadvice-live-qualification-readiness-v1", AUDIOADVICE_OBSERVER_VERSION, ...evidenceHashes)
      : "";
    const qualificationHashes = [...evidenceHashes, ...rehearsals.map((row) => row.evidenceHash)].sort();
    const qualificationEvidenceHash = qualificationHashes.length
      ? stableHash("audioadvice-add-qualification-evidence-v1", AUDIOADVICE_ADD_ADAPTER_VERSION, ...qualificationHashes)
      : "";
    const qualificationRow = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt,
              expires_at AS expiresAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'audioadvice'`,
      currentRequestScope().userId
    ) ?? null;
    const { qualification, addToCartQualified } = qualificationState(
      qualificationRow,
      AUDIOADVICE_ADD_ADAPTER_VERSION,
      now
    );
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = qualification?.warning === "version_changed"
      ? "The packaged Audio Advice add runner changed. Re-run the no-click qualification before guarded adds can resume."
      : qualification?.warning === "expired"
        ? "The Audio Advice add qualification expired. Re-run the no-click qualification before guarded adds can resume."
        : mutationAuthorized
          ? "Guarded Audio Advice add-to-cart execution is active for Audio Advice-sold offers with shipping, quantity one."
          : addToCartQualified
            ? "Audio Advice add-to-cart is qualified but globally paused. Resume Actions to enable it."
            : !liveEvidenceReady
              ? firstMissingLive?.detail ?? "Collect current Audio Advice evidence before an add-to-cart rehearsal."
              : !rehearsalReady
                ? "Run one mutation-disabled Audio Advice add rehearsal from the Chrome companion."
                : "The live dossier and no-click rehearsal are complete. Explicit Audio Advice add-only qualification review is the remaining gate.";
    return {
      retailerId: "audioadvice",
      adapterVersion: AUDIOADVICE_OBSERVER_VERSION,
      addAdapterVersion: AUDIOADVICE_ADD_ADAPTER_VERSION,
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
  bananarepublicQualificationReadiness(now = Date.now()): BananaRepublicQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, canonical_url AS canonicalUrl, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'bananarepublic' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      BANANAREPUBLIC_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const trialRows = this.db.all<QualificationTrialRow>(
      `SELECT trial.retailer_sku AS retailerSku, shadow.canonical_url AS canonicalUrl,
              trial.outcome, trial.reason_code AS reasonCode,
              trial.evidence_hash AS evidenceHash, trial.observed_at AS observedAt
       FROM retailer_adapter_trials trial
       JOIN retailer_shadow_observations shadow ON shadow.id = trial.shadow_observation_id
       WHERE trial.user_id = ? AND trial.retailer_id = 'bananarepublic' AND trial.adapter_version = ?
         AND trial.trial_kind = 'pre_click_rehearsal' AND trial.observed_at >= ?
       ORDER BY trial.observed_at, trial.id`,
      currentRequestScope().userId,
      BANANAREPUBLIC_ADD_ADAPTER_VERSION,
      cutoff
    );
    const rehearsals = trialRows.filter((trial) => trial.outcome === "passed");
    const counts: Record<BestBuyQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Banana Republic").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<BestBuyQualificationCheck, "observed" | "met" | "products">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an available Banana Republic product with an exact SKU, USD price, quantity one and a usable Add control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: `Optional fail-closed coverage; ${BANANAREPUBLIC_ADD_ADAPTER_VERSION} rejects every marketplace seller.`,
        required: 1,
        requiredForQualification: false
      },
      {
        id: "shipping_actionable",
        label: "Selected shipping fulfillment",
        detail: "Capture one actionable Banana Republic offer with shipping explicitly selected.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "pickup_actionable",
        label: "Pickup fulfillment",
        detail: "Unsupported by this shipping-only adapter; pickup evidence cannot authorize an Add.",
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
        detail: "Capture at least two different exact Banana Republic products.",
        required: 2,
        requiredForQualification: true
      },
      {
        id: "pre_click_rehearsal",
        label: "No-click add rehearsal",
        detail: "Run the production Banana Republic add runner through final validation without clicking.",
        required: 1,
        requiredForQualification: true
      }
    ];
    const checks = definitions.map((definition) => ({
      ...definition,
      observed: counts[definition.id],
      met: counts[definition.id] >= definition.required,
      products: qualificationCheckProducts(definition.id, rows, trialRows, "Banana Republic")
    }));
    const liveEvidenceReady = checks
      .filter((check) => check.requiredForQualification && check.id !== "pre_click_rehearsal")
      .every((check) => check.met);
    const rehearsalReady = checks.find((check) => check.id === "pre_click_rehearsal")?.met === true;
    const qualificationEvidenceReady = liveEvidenceReady && rehearsalReady;
    const evidenceHashes = [...new Set(rows.map((row) => row.evidenceHash))].sort();
    const liveEvidenceHash = evidenceHashes.length
      ? stableHash("bananarepublic-live-qualification-readiness-v1", BANANAREPUBLIC_OBSERVER_VERSION, ...evidenceHashes)
      : "";
    const qualificationHashes = [...evidenceHashes, ...rehearsals.map((row) => row.evidenceHash)].sort();
    const qualificationEvidenceHash = qualificationHashes.length
      ? stableHash("bananarepublic-add-qualification-evidence-v1", BANANAREPUBLIC_ADD_ADAPTER_VERSION, ...qualificationHashes)
      : "";
    const qualificationRow = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt,
              expires_at AS expiresAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'bananarepublic'`,
      currentRequestScope().userId
    ) ?? null;
    const { qualification, addToCartQualified } = qualificationState(
      qualificationRow,
      BANANAREPUBLIC_ADD_ADAPTER_VERSION,
      now
    );
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = qualification?.warning === "version_changed"
      ? "The packaged Banana Republic add runner changed. Re-run the no-click qualification before guarded adds can resume."
      : qualification?.warning === "expired"
        ? "The Banana Republic add qualification expired. Re-run the no-click qualification before guarded adds can resume."
        : mutationAuthorized
          ? "Guarded Banana Republic add-to-cart execution is active for Banana Republic-sold offers with shipping, quantity one."
          : addToCartQualified
            ? "Banana Republic add-to-cart is qualified but globally paused. Resume Actions to enable it."
            : !liveEvidenceReady
              ? firstMissingLive?.detail ?? "Collect current Banana Republic evidence before an add-to-cart rehearsal."
              : !rehearsalReady
                ? "Run one mutation-disabled Banana Republic add rehearsal from the Chrome companion."
                : "The live dossier and no-click rehearsal are complete. Explicit Banana Republic add-only qualification review is the remaining gate.";
    return {
      retailerId: "bananarepublic",
      adapterVersion: BANANAREPUBLIC_OBSERVER_VERSION,
      addAdapterVersion: BANANAREPUBLIC_ADD_ADAPTER_VERSION,
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
  bananarepublicfactoryQualificationReadiness(now = Date.now()): BananaRepublicFactoryQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, canonical_url AS canonicalUrl, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'bananarepublicfactory' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      BANANAREPUBLICFACTORY_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const trialRows = this.db.all<QualificationTrialRow>(
      `SELECT trial.retailer_sku AS retailerSku, shadow.canonical_url AS canonicalUrl,
              trial.outcome, trial.reason_code AS reasonCode,
              trial.evidence_hash AS evidenceHash, trial.observed_at AS observedAt
       FROM retailer_adapter_trials trial
       JOIN retailer_shadow_observations shadow ON shadow.id = trial.shadow_observation_id
       WHERE trial.user_id = ? AND trial.retailer_id = 'bananarepublicfactory' AND trial.adapter_version = ?
         AND trial.trial_kind = 'pre_click_rehearsal' AND trial.observed_at >= ?
       ORDER BY trial.observed_at, trial.id`,
      currentRequestScope().userId,
      BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION,
      cutoff
    );
    const rehearsals = trialRows.filter((trial) => trial.outcome === "passed");
    const counts: Record<BestBuyQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Banana Republic Factory").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<BestBuyQualificationCheck, "observed" | "met" | "products">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an available Banana Republic Factory product with an exact SKU, USD price, quantity one and a usable Add control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: `Optional fail-closed coverage; ${BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION} rejects every marketplace seller.`,
        required: 1,
        requiredForQualification: false
      },
      {
        id: "shipping_actionable",
        label: "Selected shipping fulfillment",
        detail: "Capture one actionable Banana Republic Factory offer with shipping explicitly selected.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "pickup_actionable",
        label: "Pickup fulfillment",
        detail: "Unsupported by this shipping-only adapter; pickup evidence cannot authorize an Add.",
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
        detail: "Capture at least two different exact Banana Republic Factory products.",
        required: 2,
        requiredForQualification: true
      },
      {
        id: "pre_click_rehearsal",
        label: "No-click add rehearsal",
        detail: "Run the production Banana Republic Factory add runner through final validation without clicking.",
        required: 1,
        requiredForQualification: true
      }
    ];
    const checks = definitions.map((definition) => ({
      ...definition,
      observed: counts[definition.id],
      met: counts[definition.id] >= definition.required,
      products: qualificationCheckProducts(definition.id, rows, trialRows, "Banana Republic Factory")
    }));
    const liveEvidenceReady = checks
      .filter((check) => check.requiredForQualification && check.id !== "pre_click_rehearsal")
      .every((check) => check.met);
    const rehearsalReady = checks.find((check) => check.id === "pre_click_rehearsal")?.met === true;
    const qualificationEvidenceReady = liveEvidenceReady && rehearsalReady;
    const evidenceHashes = [...new Set(rows.map((row) => row.evidenceHash))].sort();
    const liveEvidenceHash = evidenceHashes.length
      ? stableHash("bananarepublicfactory-live-qualification-readiness-v1", BANANAREPUBLICFACTORY_OBSERVER_VERSION, ...evidenceHashes)
      : "";
    const qualificationHashes = [...evidenceHashes, ...rehearsals.map((row) => row.evidenceHash)].sort();
    const qualificationEvidenceHash = qualificationHashes.length
      ? stableHash("bananarepublicfactory-add-qualification-evidence-v1", BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION, ...qualificationHashes)
      : "";
    const qualificationRow = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt,
              expires_at AS expiresAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'bananarepublicfactory'`,
      currentRequestScope().userId
    ) ?? null;
    const { qualification, addToCartQualified } = qualificationState(
      qualificationRow,
      BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION,
      now
    );
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = qualification?.warning === "version_changed"
      ? "The packaged Banana Republic Factory add runner changed. Re-run the no-click qualification before guarded adds can resume."
      : qualification?.warning === "expired"
        ? "The Banana Republic Factory add qualification expired. Re-run the no-click qualification before guarded adds can resume."
        : mutationAuthorized
          ? "Guarded Banana Republic Factory add-to-cart execution is active for Banana Republic Factory-sold offers with shipping, quantity one."
          : addToCartQualified
            ? "Banana Republic Factory add-to-cart is qualified but globally paused. Resume Actions to enable it."
            : !liveEvidenceReady
              ? firstMissingLive?.detail ?? "Collect current Banana Republic Factory evidence before an add-to-cart rehearsal."
              : !rehearsalReady
                ? "Run one mutation-disabled Banana Republic Factory add rehearsal from the Chrome companion."
                : "The live dossier and no-click rehearsal are complete. Explicit Banana Republic Factory add-only qualification review is the remaining gate.";
    return {
      retailerId: "bananarepublicfactory",
      adapterVersion: BANANAREPUBLICFACTORY_OBSERVER_VERSION,
      addAdapterVersion: BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION,
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
  athletaQualificationReadiness(now = Date.now()): AthletaQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, canonical_url AS canonicalUrl, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'athleta' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      ATHLETA_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const trialRows = this.db.all<QualificationTrialRow>(
      `SELECT trial.retailer_sku AS retailerSku, shadow.canonical_url AS canonicalUrl,
              trial.outcome, trial.reason_code AS reasonCode,
              trial.evidence_hash AS evidenceHash, trial.observed_at AS observedAt
       FROM retailer_adapter_trials trial
       JOIN retailer_shadow_observations shadow ON shadow.id = trial.shadow_observation_id
       WHERE trial.user_id = ? AND trial.retailer_id = 'athleta' AND trial.adapter_version = ?
         AND trial.trial_kind = 'pre_click_rehearsal' AND trial.observed_at >= ?
       ORDER BY trial.observed_at, trial.id`,
      currentRequestScope().userId,
      ATHLETA_ADD_ADAPTER_VERSION,
      cutoff
    );
    const rehearsals = trialRows.filter((trial) => trial.outcome === "passed");
    const counts: Record<BestBuyQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "Athleta").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<BestBuyQualificationCheck, "observed" | "met" | "products">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an available Athleta product with an exact SKU, USD price, quantity one and a usable Add control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: `Optional fail-closed coverage; ${ATHLETA_ADD_ADAPTER_VERSION} rejects every marketplace seller.`,
        required: 1,
        requiredForQualification: false
      },
      {
        id: "shipping_actionable",
        label: "Selected shipping fulfillment",
        detail: "Capture one actionable Athleta offer with shipping explicitly selected.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "pickup_actionable",
        label: "Pickup fulfillment",
        detail: "Unsupported by this shipping-only adapter; pickup evidence cannot authorize an Add.",
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
        detail: "Capture at least two different exact Athleta products.",
        required: 2,
        requiredForQualification: true
      },
      {
        id: "pre_click_rehearsal",
        label: "No-click add rehearsal",
        detail: "Run the production Athleta add runner through final validation without clicking.",
        required: 1,
        requiredForQualification: true
      }
    ];
    const checks = definitions.map((definition) => ({
      ...definition,
      observed: counts[definition.id],
      met: counts[definition.id] >= definition.required,
      products: qualificationCheckProducts(definition.id, rows, trialRows, "Athleta")
    }));
    const liveEvidenceReady = checks
      .filter((check) => check.requiredForQualification && check.id !== "pre_click_rehearsal")
      .every((check) => check.met);
    const rehearsalReady = checks.find((check) => check.id === "pre_click_rehearsal")?.met === true;
    const qualificationEvidenceReady = liveEvidenceReady && rehearsalReady;
    const evidenceHashes = [...new Set(rows.map((row) => row.evidenceHash))].sort();
    const liveEvidenceHash = evidenceHashes.length
      ? stableHash("athleta-live-qualification-readiness-v1", ATHLETA_OBSERVER_VERSION, ...evidenceHashes)
      : "";
    const qualificationHashes = [...evidenceHashes, ...rehearsals.map((row) => row.evidenceHash)].sort();
    const qualificationEvidenceHash = qualificationHashes.length
      ? stableHash("athleta-add-qualification-evidence-v1", ATHLETA_ADD_ADAPTER_VERSION, ...qualificationHashes)
      : "";
    const qualificationRow = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt,
              expires_at AS expiresAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'athleta'`,
      currentRequestScope().userId
    ) ?? null;
    const { qualification, addToCartQualified } = qualificationState(
      qualificationRow,
      ATHLETA_ADD_ADAPTER_VERSION,
      now
    );
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = qualification?.warning === "version_changed"
      ? "The packaged Athleta add runner changed. Re-run the no-click qualification before guarded adds can resume."
      : qualification?.warning === "expired"
        ? "The Athleta add qualification expired. Re-run the no-click qualification before guarded adds can resume."
        : mutationAuthorized
          ? "Guarded Athleta add-to-cart execution is active for Athleta-sold offers with shipping, quantity one."
          : addToCartQualified
            ? "Athleta add-to-cart is qualified but globally paused. Resume Actions to enable it."
            : !liveEvidenceReady
              ? firstMissingLive?.detail ?? "Collect current Athleta evidence before an add-to-cart rehearsal."
              : !rehearsalReady
                ? "Run one mutation-disabled Athleta add rehearsal from the Chrome companion."
                : "The live dossier and no-click rehearsal are complete. Explicit Athleta add-only qualification review is the remaining gate.";
    return {
      retailerId: "athleta",
      adapterVersion: ATHLETA_OBSERVER_VERSION,
      addAdapterVersion: ATHLETA_ADD_ADAPTER_VERSION,
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
  americanEagleQualificationReadiness(now = Date.now()): AmericanEagleQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, canonical_url AS canonicalUrl, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'americaneagle' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      AMERICANEAGLE_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const trialRows = this.db.all<QualificationTrialRow>(
      `SELECT trial.retailer_sku AS retailerSku, shadow.canonical_url AS canonicalUrl,
              trial.outcome, trial.reason_code AS reasonCode,
              trial.evidence_hash AS evidenceHash, trial.observed_at AS observedAt
       FROM retailer_adapter_trials trial
       JOIN retailer_shadow_observations shadow ON shadow.id = trial.shadow_observation_id
       WHERE trial.user_id = ? AND trial.retailer_id = 'americaneagle' AND trial.adapter_version = ?
         AND trial.trial_kind = 'pre_click_rehearsal' AND trial.observed_at >= ?
       ORDER BY trial.observed_at, trial.id`,
      currentRequestScope().userId,
      AMERICANEAGLE_ADD_ADAPTER_VERSION,
      cutoff
    );
    const rehearsals = trialRows.filter((trial) => trial.outcome === "passed");
    const counts: Record<BestBuyQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "American Eagle").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<BestBuyQualificationCheck, "observed" | "met" | "products">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an available American Eagle product with an exact SKU, USD price, quantity one and a usable Add control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: `Optional fail-closed coverage; ${AMERICANEAGLE_ADD_ADAPTER_VERSION} rejects every marketplace seller.`,
        required: 1,
        requiredForQualification: false
      },
      {
        id: "shipping_actionable",
        label: "Selected shipping fulfillment",
        detail: "Capture one actionable American Eagle offer with shipping explicitly selected.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "pickup_actionable",
        label: "Pickup fulfillment",
        detail: "Unsupported by this shipping-only adapter; pickup evidence cannot authorize an Add.",
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
        detail: "Capture at least two different exact American Eagle products.",
        required: 2,
        requiredForQualification: true
      },
      {
        id: "pre_click_rehearsal",
        label: "No-click add rehearsal",
        detail: "Run the production American Eagle add runner through final validation without clicking.",
        required: 1,
        requiredForQualification: true
      }
    ];
    const checks = definitions.map((definition) => ({
      ...definition,
      observed: counts[definition.id],
      met: counts[definition.id] >= definition.required,
      products: qualificationCheckProducts(definition.id, rows, trialRows, "American Eagle")
    }));
    const liveEvidenceReady = checks
      .filter((check) => check.requiredForQualification && check.id !== "pre_click_rehearsal")
      .every((check) => check.met);
    const rehearsalReady = checks.find((check) => check.id === "pre_click_rehearsal")?.met === true;
    const qualificationEvidenceReady = liveEvidenceReady && rehearsalReady;
    const evidenceHashes = [...new Set(rows.map((row) => row.evidenceHash))].sort();
    const liveEvidenceHash = evidenceHashes.length
      ? stableHash("americaneagle-live-qualification-readiness-v1", AMERICANEAGLE_OBSERVER_VERSION, ...evidenceHashes)
      : "";
    const qualificationHashes = [...evidenceHashes, ...rehearsals.map((row) => row.evidenceHash)].sort();
    const qualificationEvidenceHash = qualificationHashes.length
      ? stableHash("americaneagle-add-qualification-evidence-v1", AMERICANEAGLE_ADD_ADAPTER_VERSION, ...qualificationHashes)
      : "";
    const qualificationRow = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt,
              expires_at AS expiresAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'americaneagle'`,
      currentRequestScope().userId
    ) ?? null;
    const { qualification, addToCartQualified } = qualificationState(
      qualificationRow,
      AMERICANEAGLE_ADD_ADAPTER_VERSION,
      now
    );
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = qualification?.warning === "version_changed"
      ? "The packaged American Eagle add runner changed. Re-run the no-click qualification before guarded adds can resume."
      : qualification?.warning === "expired"
        ? "The American Eagle add qualification expired. Re-run the no-click qualification before guarded adds can resume."
        : mutationAuthorized
          ? "Guarded American Eagle add-to-cart execution is active for American Eagle-sold offers with shipping, quantity one."
          : addToCartQualified
            ? "American Eagle add-to-cart is qualified but globally paused. Resume Actions to enable it."
            : !liveEvidenceReady
              ? firstMissingLive?.detail ?? "Collect current American Eagle evidence before an add-to-cart rehearsal."
              : !rehearsalReady
                ? "Run one mutation-disabled American Eagle add rehearsal from the Chrome companion."
                : "The live dossier and no-click rehearsal are complete. Explicit American Eagle add-only qualification review is the remaining gate.";
    return {
      retailerId: "americaneagle",
      adapterVersion: AMERICANEAGLE_OBSERVER_VERSION,
      addAdapterVersion: AMERICANEAGLE_ADD_ADAPTER_VERSION,
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
  anineBingQualificationReadiness(now = Date.now()): AnineBingQualificationReadiness {
    const cutoff = nowIso(now - QUALIFICATION_EVIDENCE_WINDOW_MS);
    const rows = this.db.all<QualificationEvidenceRow>(
      `SELECT retailer_sku AS retailerSku, canonical_url AS canonicalUrl, availability,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              add_control_actionable AS addControlActionable,
              purchase_route_ready AS purchaseRouteReady,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              observed_at AS observedAt
       FROM retailer_shadow_observations
       WHERE user_id = ? AND retailer_id = 'aninebing' AND adapter_version = ?
         AND observed_at >= ?
       ORDER BY observed_at, id`,
      currentRequestScope().userId,
      ANINEBING_OBSERVER_VERSION,
      cutoff
    );
    const actionable = rows.filter((row) => row.observationState === "actionable_candidate");
    const distinctSkuCount = new Set(rows.map((row) => row.retailerSku)).size;
    const trialRows = this.db.all<QualificationTrialRow>(
      `SELECT trial.retailer_sku AS retailerSku, shadow.canonical_url AS canonicalUrl,
              trial.outcome, trial.reason_code AS reasonCode,
              trial.evidence_hash AS evidenceHash, trial.observed_at AS observedAt
       FROM retailer_adapter_trials trial
       JOIN retailer_shadow_observations shadow ON shadow.id = trial.shadow_observation_id
       WHERE trial.user_id = ? AND trial.retailer_id = 'aninebing' AND trial.adapter_version = ?
         AND trial.trial_kind = 'pre_click_rehearsal' AND trial.observed_at >= ?
       ORDER BY trial.observed_at, trial.id`,
      currentRequestScope().userId,
      ANINEBING_ADD_ADAPTER_VERSION,
      cutoff
    );
    const rehearsals = trialRows.filter((trial) => trial.outcome === "passed");
    const counts: Record<BestBuyQualificationCheckId, number> = {
      first_party_actionable: actionable.filter((row) => row.sellerType === "first_party" && row.sellerName === "ANINE BING").length,
      named_marketplace_actionable: actionable.filter((row) => row.sellerType === "third_party" && Boolean(row.sellerName)).length,
      shipping_actionable: actionable.filter((row) => row.fulfillment === "shipping").length,
      pickup_actionable: actionable.filter((row) => row.fulfillment === "pickup").length,
      unavailable_fail_closed: rows.filter((row) => row.availability === "out_of_stock" && row.addControlActionable === 0 && row.observationState === "not_actionable").length,
      sku_diversity: distinctSkuCount,
      pre_click_rehearsal: rehearsals.length
    };
    const definitions: Array<Omit<BestBuyQualificationCheck, "observed" | "met" | "products">> = [
      {
        id: "first_party_actionable",
        label: "First-party offer",
        detail: "Capture an available ANINE BING product with an exact SKU, USD price, quantity one and a usable Add control.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "named_marketplace_actionable",
        label: "Named marketplace offer",
        detail: `Optional fail-closed coverage; ${ANINEBING_ADD_ADAPTER_VERSION} rejects every marketplace seller.`,
        required: 1,
        requiredForQualification: false
      },
      {
        id: "shipping_actionable",
        label: "Selected shipping fulfillment",
        detail: "Capture one actionable ANINE BING offer with shipping explicitly selected.",
        required: 1,
        requiredForQualification: true
      },
      {
        id: "pickup_actionable",
        label: "Pickup fulfillment",
        detail: "Unsupported by this shipping-only adapter; pickup evidence cannot authorize an Add.",
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
        detail: "Capture at least two different exact ANINE BING products.",
        required: 2,
        requiredForQualification: true
      },
      {
        id: "pre_click_rehearsal",
        label: "No-click add rehearsal",
        detail: "Run the production ANINE BING add runner through final validation without clicking.",
        required: 1,
        requiredForQualification: true
      }
    ];
    const checks = definitions.map((definition) => ({
      ...definition,
      observed: counts[definition.id],
      met: counts[definition.id] >= definition.required,
      products: qualificationCheckProducts(definition.id, rows, trialRows, "ANINE BING")
    }));
    const liveEvidenceReady = checks
      .filter((check) => check.requiredForQualification && check.id !== "pre_click_rehearsal")
      .every((check) => check.met);
    const rehearsalReady = checks.find((check) => check.id === "pre_click_rehearsal")?.met === true;
    const qualificationEvidenceReady = liveEvidenceReady && rehearsalReady;
    const evidenceHashes = [...new Set(rows.map((row) => row.evidenceHash))].sort();
    const liveEvidenceHash = evidenceHashes.length
      ? stableHash("aninebing-live-qualification-readiness-v1", ANINEBING_OBSERVER_VERSION, ...evidenceHashes)
      : "";
    const qualificationHashes = [...evidenceHashes, ...rehearsals.map((row) => row.evidenceHash)].sort();
    const qualificationEvidenceHash = qualificationHashes.length
      ? stableHash("aninebing-add-qualification-evidence-v1", ANINEBING_ADD_ADAPTER_VERSION, ...qualificationHashes)
      : "";
    const qualificationRow = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, updated_at AS updatedAt,
              expires_at AS expiresAt
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = 'aninebing'`,
      currentRequestScope().userId
    ) ?? null;
    const { qualification, addToCartQualified } = qualificationState(
      qualificationRow,
      ANINEBING_ADD_ADAPTER_VERSION,
      now
    );
    const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
      "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    const mutationAuthorized = addToCartQualified
      && control?.execution_mode === "live"
      && control.actions_paused === 0;
    const firstMissingLive = checks.find((check) => check.requiredForQualification
      && check.id !== "pre_click_rehearsal" && !check.met);
    const nextStep = qualification?.warning === "version_changed"
      ? "The packaged ANINE BING add runner changed. Re-run the no-click qualification before guarded adds can resume."
      : qualification?.warning === "expired"
        ? "The ANINE BING add qualification expired. Re-run the no-click qualification before guarded adds can resume."
        : mutationAuthorized
          ? "Guarded ANINE BING add-to-cart execution is active for ANINE BING-sold offers with shipping, quantity one."
          : addToCartQualified
            ? "ANINE BING add-to-cart is qualified but globally paused. Resume Actions to enable it."
            : !liveEvidenceReady
              ? firstMissingLive?.detail ?? "Collect current ANINE BING evidence before an add-to-cart rehearsal."
              : !rehearsalReady
                ? "Run one mutation-disabled ANINE BING add rehearsal from the Chrome companion."
                : "The live dossier and no-click rehearsal are complete. Explicit ANINE BING add-only qualification review is the remaining gate.";
    return {
      retailerId: "aninebing",
      adapterVersion: ANINEBING_OBSERVER_VERSION,
      addAdapterVersion: ANINEBING_ADD_ADAPTER_VERSION,
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
