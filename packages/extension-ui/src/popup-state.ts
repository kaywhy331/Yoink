import { audioAdviceUrlSku } from "../../browser-adapters/src/audioadvice.js";
import { bananarepublicUrlSku } from "../../browser-adapters/src/bananarepublic.js";
import { bananarepublicfactoryUrlSku } from "../../browser-adapters/src/bananarepublicfactory.js";
import { athletaUrlSku } from "../../browser-adapters/src/athleta.js";
import { asusUrlSku } from "../../browser-adapters/src/asus.js";
import { americanEagleStyleColor } from "../../browser-adapters/src/americaneagle.js";
import { extractTargetSku } from "../../browser-adapters/src/target.js";
import {
  canonicalRetailerProductUrl,
  extractRetailerSku
} from "../../browser-adapters/src/retailers.js";
import type { SupportedRetailerId } from "../../contracts/src/index.js";
import { bestBuyProductCode } from "../../browser-adapters/src/bestbuy-identity.js";

export const POPUP_RESULT_STORAGE_KEY = "yoinkPopupResultV1";
export const POPUP_UPDATE_HANDOFF_STORAGE_KEY = "yoinkUpdateHandoffV1";
export const CART_READY_STORAGE_KEY = "yoinkCartReadyV1";
export const BESTBUY_WAIT_STORAGE_KEY = "yoinkBestBuyWaitV1";

export type YoinkAppDestination = "dashboard" | "actions" | "insights" | "connections" | "settings";

const APP_DESTINATION_ROUTES: Record<YoinkAppDestination, { pathname: string; hash: string }> = {
  dashboard: { pathname: "/", hash: "home" },
  actions: { pathname: "/", hash: "activity" },
  insights: { pathname: "/", hash: "activity/insights" },
  connections: { pathname: "/", hash: "settings/chrome" },
  settings: { pathname: "/", hash: "settings" }
};

export function appDestinationUrl(appOrigin: string, destination: YoinkAppDestination = "dashboard"): string {
  const route = APP_DESTINATION_ROUTES[destination];
  if (!route) throw new Error("Unknown Yoink app destination.");
  const url = new URL(route.pathname, appOrigin);
  if (route.hash) url.hash = route.hash;
  return url.href;
}

const RETAILERS: Record<SupportedRetailerId, {
  name: string;
  domains: string[];
  identityLabel: string;
}> = {
  target: { name: "Target", domains: ["target.com"], identityLabel: "TCIN" },
  walmart: { name: "Walmart", domains: ["walmart.com"], identityLabel: "Item" },
  amazon: { name: "Amazon", domains: ["amazon.com"], identityLabel: "ASIN" },
  bestbuy: { name: "Best Buy", domains: ["bestbuy.com"], identityLabel: "SKU" },
  disney: { name: "Disney Store", domains: ["disneystore.com"], identityLabel: "SKU" },
  ravensburger: { name: "Ravensburger", domains: ["ravensburger.us"], identityLabel: "SKU" },
  riot: { name: "Riot Games Merch", domains: ["merch.riotgames.com"], identityLabel: "SKU" },
  booksamillion: { name: "Books-A-Million", domains: ["booksamillion.com"], identityLabel: "SKU" },
  fanatics: { name: "Fanatics", domains: ["fanatics.com"], identityLabel: "SKU" },
  kohls: { name: "Kohl's", domains: ["kohls.com"], identityLabel: "SKU" },
  macys: { name: "Macy's", domains: ["macys.com"], identityLabel: "SKU" },
  pbandai: { name: "Premium Bandai", domains: ["p-bandai.com"], identityLabel: "SKU" },
  pokemoncenter: { name: "Pokémon Center", domains: ["pokemoncenter.com"], identityLabel: "SKU" },
  asus: { name: "ASUS", domains: ["eshop.asus.com"], identityLabel: "Part number" },
  audioadvice: { name: "Audio Advice", domains: ["www.audioadvice.com"], identityLabel: "Variant" },
  bananarepublic: { name: "Banana Republic", domains: ["bananarepublic.gap.com"], identityLabel: "Variant" },
  bananarepublicfactory: { name: "Banana Republic Factory", domains: ["bananarepublicfactory.gapfactory.com"], identityLabel: "Variant" },
  athleta: { name: "Athleta", domains: ["athleta.gap.com"], identityLabel: "Variant" },
  americaneagle: { name: "American Eagle", domains: ["ae.com"], identityLabel: "Variant" },
  aninebing: { name: "ANINE BING", domains: ["aninebing.com"], identityLabel: "Variant" }
};

const RETAILER_ORDER = Object.keys(RETAILERS) as SupportedRetailerId[];

export const RETAILER_ORIGINS: Record<SupportedRetailerId, string[]> = {
  target: ["https://www.target.com/*"],
  walmart: ["https://*.walmart.com/*"],
  amazon: ["https://*.amazon.com/*"],
  bestbuy: ["https://*.bestbuy.com/*"],
  disney: ["https://www.disneystore.com/*"],
  ravensburger: ["https://*.ravensburger.us/*"],
  riot: ["https://merch.riotgames.com/*"],
  booksamillion: ["https://*.booksamillion.com/*"],
  fanatics: ["https://*.fanatics.com/*"],
  kohls: ["https://*.kohls.com/*"],
  macys: ["https://*.macys.com/*"],
  pbandai: ["https://*.p-bandai.com/*"],
  pokemoncenter: ["https://*.pokemoncenter.com/*"],
  asus: ["https://eshop.asus.com/*"],
  audioadvice: ["https://www.audioadvice.com/*"],
  bananarepublic: ["https://bananarepublic.gap.com/*", "https://secure-bananarepublic.gap.com/*"],
  bananarepublicfactory: ["https://bananarepublicfactory.gapfactory.com/*", "https://secure-bananarepublicfactory.gapfactory.com/*"],
  athleta: ["https://athleta.gap.com/*", "https://secure-athleta.gap.com/*"],
  americaneagle: ["https://*.ae.com/*"],
  aninebing: ["https://*.aninebing.com/*"]
};

export const PRODUCT_DOCUMENT_PATTERNS = [
  "https://www.target.com/p/*",
  "https://*.walmart.com/ip/*",
  "https://*.amazon.com/dp/*",
  "https://*.amazon.com/*/dp/*",
  "https://*.amazon.com/gp/product/*",
  "https://*.amazon.com/gp/aw/d/*",
  "https://*.bestbuy.com/product/*",
  "https://*.bestbuy.com/site/*.p*",
  "https://www.disneystore.com/*.html*",
  "https://*.ravensburger.us/en-US/products/*",
  "https://merch.riotgames.com/en-us/product/*",
  "https://*.booksamillion.com/p/*",
  "https://*.fanatics.com/*+p-*",
  "https://*.fanatics.com/*%2Bp-*",
  "https://*.kohls.com/product/prd-*",
  "https://*.macys.com/shop/product/*",
  "https://*.p-bandai.com/us/item/*",
  "https://*.pokemoncenter.com/product/*",
  "https://eshop.asus.com/us/*.html",
  "https://athleta.gap.com/browse/product.do*",
  "https://www.audioadvice.com/products/*",
  "https://bananarepublic.gap.com/browse/product.do*",
  "https://bananarepublicfactory.gapfactory.com/browse/product.do*",

  "https://*.ae.com/us/en/p/*",
  "https://*.aninebing.com/products/*"
];

export type PopupPageContext =
  | { kind: "product_link"; key: string; retailerId: "bestbuy" | "aninebing" | "americaneagle" | "audioadvice"; retailerName: string; productCode: string }
  | {
    kind: "product";
    key: string;
    retailerId: SupportedRetailerId;
    retailerName: string;
    identityLabel: string;
    sku: string;
    canonicalUrl: string;
  }
  | {
    kind: "walmart_draw";
    key: "walmart_draw";
    retailerId: "walmart";
    retailerName: "Walmart";
  }
  | {
    kind: "supported_non_product";
    key: string;
    retailerId: SupportedRetailerId;
    retailerName: string;
  }
  | { kind: "unsupported"; key: "unsupported" };

function trustedHttpsUrl(value: unknown): URL | null {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function retailerFromUrl(url: URL): SupportedRetailerId | null {
  const host = url.hostname.toLocaleLowerCase("en-US");
  return RETAILER_ORDER.find((retailerId) =>
    RETAILERS[retailerId].domains.some((domain) => hostMatches(host, domain))) ?? null;
}

function exactProductRoute(retailerId: SupportedRetailerId, url: URL): boolean {
  const path = url.pathname;
  if (retailerId === "target") return url.hostname.toLocaleLowerCase("en-US") === "www.target.com"
    && /(?:^|\/)A-\d{6,}(?:\/|$)/i.test(path);
  if (retailerId === "walmart") return /\/ip\/(?:[^/?#]+\/)?\d{5,20}(?:\/|$)/i.test(path);
  if (retailerId === "amazon") return /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}(?:\/|$)/i.test(path);
  if (retailerId === "bestbuy") {
    return /^\/product\/[^/]+\/(?:[^/]+\/sku\/)?\d{5,20}(?:\/|$)/i.test(path)
      || /^\/site\/[^/]+\/\d{5,20}\.p(?:\/|$)/i.test(path);
  }
  if (retailerId === "disney") return /-\d{10,20}\.html(?:\/|$)/i.test(path);
  if (retailerId === "ravensburger") return /^\/en-US\/products\/.*-\d{5,20}(?:\/|$)/i.test(path);
  if (retailerId === "riot") return /^\/en-us\/product\/[a-z0-9](?:[a-z0-9-]{1,118}[a-z0-9])?\/?$/i.test(path);
  if (retailerId === "booksamillion") return /^\/p\/(?:-\/)?[a-z0-9]{10,20}(?:\/|$)/i.test(path);
  if (retailerId === "fanatics") return /(?:^|\+)p-\d{6,20}(?:\+|$)/i.test(path.replace(/%2B/gi, "+"));
  if (retailerId === "kohls") return /^\/product\/prd-\d{5,12}\//i.test(path);
  if (retailerId === "macys") return /^\/shop\/product\//i.test(path) && /^\d{5,20}$/.test(url.searchParams.get("ID") || url.searchParams.get("id") || "");
  if (retailerId === "asus") return Boolean(asusUrlSku(url.href));
  if (retailerId === "audioadvice") return /^\/products\/[a-z0-9-]+\/?$/.test(path);
  if (retailerId === "bananarepublic") return Boolean(bananarepublicUrlSku(url.href));
  if (retailerId === "bananarepublicfactory") return Boolean(bananarepublicfactoryUrlSku(url.href));
  if (retailerId === "athleta") return Boolean(athletaUrlSku(url.href));
  if (retailerId === "americaneagle") return Boolean(americanEagleStyleColor(url.href));
  if (retailerId === "aninebing") return /^\/products\/[a-z0-9-]+\/?$/.test(path);
  if (retailerId === "pbandai") return /^\/us\/item\/[a-z]\d{10}(?:\/|$)/i.test(path);
  return /^\/product\/\d{2,3}-\d{5}(?:-\d{3})?(?:\/|$)/i.test(path);
}

export function classifyPageContext(value: unknown): PopupPageContext {
  const url = trustedHttpsUrl(value);
  if (!url) return { kind: "unsupported", key: "unsupported" };
  const retailerId = retailerFromUrl(url);
  if (!retailerId) return { kind: "unsupported", key: "unsupported" };
  const retailer = RETAILERS[retailerId];
  const productCode = retailerId === "bestbuy" ? bestBuyProductCode(url.href) : "";
  if (productCode && !extractRetailerSku("bestbuy", url.href)) {
    return { kind: "product_link", key: `product_link:bestbuy:${productCode}`, retailerId: "bestbuy", retailerName: "Best Buy", productCode };
  }
  if (retailerId === "americaneagle" && exactProductRoute(retailerId, url) && !extractRetailerSku("americaneagle", url.href)) {
    return { kind: "product_link", key: `product_link:americaneagle:${url.pathname}`, retailerId, retailerName: retailer.name, productCode: url.pathname };
  }
  if (retailerId === "audioadvice" && exactProductRoute(retailerId, url) && !extractRetailerSku("audioadvice", url.href)) {
    return { kind: "product_link", key: `product_link:audioadvice:${url.pathname}`, retailerId, retailerName: retailer.name, productCode: url.pathname };
  }
  if (retailerId === "aninebing" && exactProductRoute(retailerId, url) && !extractRetailerSku("aninebing", url.href)) {
    return { kind: "product_link", key: `product_link:aninebing:${url.pathname}`, retailerId, retailerName: retailer.name, productCode: url.pathname };
  }
  if (retailerId === "walmart" && url.pathname.replace(/\/+$/, "") === "/shop/collectibles/draw") {
    return { kind: "walmart_draw", key: "walmart_draw", retailerId: "walmart", retailerName: "Walmart" };
  }
  if (!exactProductRoute(retailerId, url)) {
    return {
      kind: "supported_non_product",
      key: `supported:${retailerId}`,
      retailerId,
      retailerName: retailer.name
    };
  }
  const sku = retailerId === "target"
    ? extractTargetSku(url.href)
    : extractRetailerSku(retailerId, url.href);
  if (!sku) {
    return {
      kind: "supported_non_product",
      key: `supported:${retailerId}`,
      retailerId,
      retailerName: retailer.name
    };
  }
  const canonicalUrl = retailerId === "target"
    ? `https://www.target.com/p/-/A-${sku}`
    : canonicalRetailerProductUrl(retailerId, url.href);
  return {
    kind: "product",
    key: `product:${retailerId}:${sku}`,
    retailerId,
    retailerName: retailer.name,
    identityLabel: retailer.identityLabel,
    sku,
    canonicalUrl
  };
}

export type PopupStatus = "ready" | "monitoring" | "paused" | "attention";
export type PopupActionId =
  | "retry"
  | "pair"
  | "update_companion"
  | "reload_companion"
  | "open_cart"
  | "open_bestbuy_wait"
  | "open_purchase"
  | "open_yoink"
  | "inspect_product"
  | "inspect_drawings"
  | "reconnect_trackalacker"
  | "review_pause"
  | "review_mode"
  | "confirm_share_evidence";
export type PopupOperationStage =
  | "idle"
  | "checking_stores"
  | "requesting_access"
  | "inspecting"
  | "qualifying"
  | "pairing"
  | "reconnecting"
  | "opening_cart"
  | "updating"
  | "sharing"
  | "saving";

export interface PopupHealthState {
  connected?: boolean;
  paired?: boolean;
  deviceName?: string;
  checkedAt?: string;
  version?: string;
  companionCompatible?: boolean;
  companionCompatibilityReason?: string;
  executionMode?: string;
  actionsPaused?: boolean;
  chromeMutationEnabled?: boolean;
  localEvidenceCapsules?: boolean;
  evidenceCapsuleTransport?: "loopback" | "none";
  trackalackerPush?: {
    ready?: boolean;
    state?: string;
  };
  trackalackerSync?: {
    phase?: string;
    processed?: number;
    discovered?: number;
    updatedAt?: string;
  };
  communitySharingRetailers?: string[];
  popupSummary?: {
    followedCount?: number;
    followedCountUpdatedAt?: string;
  };
}

export interface PersistedPopupResult {
  schemaVersion: 1;
  contextKey: string;
  outcome: "qualified" | "blocked" | "inspected" | "drawings" | "error";
  summary: string;
  details: string;
  recordedAt: string;
  productTitle?: string;
}

export interface PopupUpdateHandoff {
  schemaVersion: 1;
  channel: "local" | "managed";
  releaseVersion: string;
  recordedAt: string;
}

export interface BestBuyWaitState {
  schemaVersion: 1;
  jobId: string;
  retailerSku: string;
  reason: string;
  clicked: boolean;
  needsAction: boolean;
  expiresAt: string;
}

// Presentation only. This never contains page authorization, SMS codes, or
// an offer/cart proof and cannot authorize a store action.
export function bestBuyWaitState(value: unknown, now = Date.now()): BestBuyWaitState | null {
  const candidate = record(value);
  const jobId = String(candidate.jobId || "");
  const retailerSku = String(candidate.retailerSku || "");
  const reason = String(candidate.reason || "");
  const expiry = new Date(String(candidate.expiresAt || "")).getTime();
  if (candidate.schemaVersion !== 1 || !/^[A-Za-z0-9_-]{3,120}$/.test(jobId)
    || !/^\d{5,20}$/.test(retailerSku) || !Number.isFinite(expiry)
    || expiry <= now || expiry > now + 5 * 60_000
    || !["bestbuy_add_triggered", "bestbuy_queue_waiting", "bestbuy_queue_next_step",
      "bestbuy_cart_pending", "bestbuy_state_unavailable", "manual_action_required", "security_challenge"].includes(reason)) return null;
  return {
    schemaVersion: 1, jobId, retailerSku, reason, clicked: candidate.clicked === true,
    needsAction: ["bestbuy_queue_next_step", "manual_action_required", "security_challenge"].includes(reason),
    expiresAt: new Date(expiry).toISOString()
  };
}

export type CartReadyRetailerId = "target" | "walmart" | "amazon" | "bestbuy" | "pokemoncenter" | "aninebing" | "americaneagle" | "asus" | "athleta" | "audioadvice" | "bananarepublic" | "bananarepublicfactory";
export type ActionHandoffKind = "cart_ready" | "needs_you";

export interface PersistedCartReadyItem {
  schemaVersion: 1;
  kind: ActionHandoffKind;
  jobId: string;
  retailerId: CartReadyRetailerId;
  retailerName: string;
  identityLabel: string;
  retailerSku: string;
  tabId: number;
  recordedAt: string;
  openedAt?: string;
  reviewedMaximumCents?: number;
  reasonCode?: string;
  latency: {
    leaseToCartReadyMs?: number;
    leaseToBaselineMs?: number;
    baselineToOfferMs?: number;
    offerToClickMs?: number;
    clickToSettleMs?: number;
    clickToCartReadyMs?: number;
    settleToCartReadyMs?: number;
  };
}

export interface PersistedCartReadyState {
  schemaVersion: 1;
  items: PersistedCartReadyItem[];
}

export interface PopupPurchaseOpportunity {
  schemaVersion: 1;
  deliveryId: string;
  kind: "walmart_review_order";
  retailerId: "walmart";
  retailerName: "Walmart";
  identityLabel: "Item";
  retailerSku: string;
  title: string;
  expiresAt: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function cleanResultText(value: unknown, maximum = 360): string {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

const CART_READY_RETAILERS: Record<CartReadyRetailerId, { name: string; identityLabel: string }> = {
  target: { name: "Target", identityLabel: "TCIN" },
  walmart: { name: "Walmart", identityLabel: "Item" },
  amazon: { name: "Amazon", identityLabel: "ASIN" },
  bestbuy: { name: "Best Buy", identityLabel: "SKU" },
  pokemoncenter: { name: "Pokémon Center", identityLabel: "SKU" },
  asus: { name: "ASUS", identityLabel: "Part number" },
  audioadvice: { name: "Audio Advice", identityLabel: "Variant" },
  bananarepublic: { name: "Banana Republic", identityLabel: "Variant" },
  bananarepublicfactory: { name: "Banana Republic Factory", identityLabel: "Variant" },
  athleta: { name: "Athleta", identityLabel: "Variant" },
  americaneagle: { name: "American Eagle", identityLabel: "Variant" },
  aninebing: { name: "ANINE BING", identityLabel: "Variant" }
};

function cartReadyLatency(value: unknown): PersistedCartReadyItem["latency"] {
  const candidate = record(value);
  const duration = (input: unknown): number | undefined => {
    const milliseconds = Number(input);
    return Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 60 * 60_000
      ? milliseconds : undefined;
  };
  const leaseToCartReadyMs = duration(candidate.leaseToCartReadyMs);
  const leaseToBaselineMs = duration(candidate.leaseToBaselineMs);
  const baselineToOfferMs = duration(candidate.baselineToOfferMs);
  const offerToClickMs = duration(candidate.offerToClickMs);
  const clickToSettleMs = duration(candidate.clickToSettleMs);
  const clickToCartReadyMs = duration(candidate.clickToCartReadyMs);
  const settleToCartReadyMs = duration(candidate.settleToCartReadyMs);
  return {
    ...(leaseToCartReadyMs !== undefined ? { leaseToCartReadyMs } : {}),
    ...(leaseToBaselineMs !== undefined ? { leaseToBaselineMs } : {}),
    ...(baselineToOfferMs !== undefined ? { baselineToOfferMs } : {}),
    ...(offerToClickMs !== undefined ? { offerToClickMs } : {}),
    ...(clickToSettleMs !== undefined ? { clickToSettleMs } : {}),
    ...(clickToCartReadyMs !== undefined ? { clickToCartReadyMs } : {}),
    ...(settleToCartReadyMs !== undefined ? { settleToCartReadyMs } : {})
  };
}

export function cartReadyState(value: unknown, now = Date.now()): PersistedCartReadyState {
  const source = record(value);
  const input = Array.isArray(source.items) ? source.items : [];
  const unique = new Map<string, PersistedCartReadyItem>();
  for (const raw of input.slice(-20)) {
    const candidate = record(raw);
    const retailerId = String(candidate.retailerId || "") as CartReadyRetailerId;
    const retailer = CART_READY_RETAILERS[retailerId];
    const kind: ActionHandoffKind = candidate.kind === "needs_you" ? "needs_you" : "cart_ready";
    const jobId = cleanResultText(candidate.jobId, 120);
    const retailerSku = cleanResultText(candidate.retailerSku, 120).toLocaleUpperCase("en-US");
    const tabId = Number(candidate.tabId);
    const recordedAt = new Date(String(candidate.recordedAt || "")).getTime();
    const openedAt = new Date(String(candidate.openedAt || "")).getTime();
    const reviewedMaximumCents = Number(candidate.reviewedMaximumCents);
    if (candidate.schemaVersion !== 1
      || !retailer
      || !/^[A-Za-z0-9_-]{3,120}$/.test(jobId)
      || !/^[A-Z0-9-]{3,120}$/.test(retailerSku)
      || !Number.isSafeInteger(tabId)
      || tabId < 0
      || !Number.isFinite(recordedAt)
      || recordedAt > now + 60_000
      || now - recordedAt >= 24 * 60 * 60_000) continue;
    unique.set(jobId, {
      schemaVersion: 1,
      kind,
      jobId,
      retailerId,
      retailerName: retailer.name,
      identityLabel: retailer.identityLabel,
      retailerSku,
      tabId,
      recordedAt: new Date(recordedAt).toISOString(),
      ...(Number.isFinite(openedAt)
        && openedAt >= recordedAt
        && openedAt <= now + 60_000
        && now - openedAt < 24 * 60 * 60_000
          ? { openedAt: new Date(openedAt).toISOString() } : {}),
      ...(Number.isSafeInteger(reviewedMaximumCents)
        && reviewedMaximumCents > 0
        && reviewedMaximumCents <= 100_000_000
          ? { reviewedMaximumCents } : {}),
      ...(kind === "needs_you" && /^[a-z][a-z0-9_]{1,79}$/.test(String(candidate.reasonCode || ""))
        ? { reasonCode: String(candidate.reasonCode) } : {}),
      latency: cartReadyLatency(candidate.latency)
    });
  }
  return { schemaVersion: 1, items: [...unique.values()].slice(-10) };
}

/**
 * `pending_outcome_first` (the popup default) keeps an opened handoff, whose
 * "Did you check out?" prompt is still unanswered, ahead of newer unopened
 * ones. `unopened_first` rotates through unseen handoffs, which is what the
 * keyboard shortcut needs because it cannot record an outcome.
 */
export type ActionHandoffRanking = "pending_outcome_first" | "unopened_first";

export function preferredActionHandoff(
  value: unknown,
  now = Date.now(),
  ranking: ActionHandoffRanking = "pending_outcome_first"
): PersistedCartReadyItem | null {
  const items = cartReadyState(value, now).items;
  const newest = (kind: ActionHandoffKind, opened: boolean): PersistedCartReadyItem | null =>
    items.filter((item) => item.kind === kind && Boolean(item.openedAt) === opened).at(-1) ?? null;
  const tiers = ranking === "unopened_first" ? [false, true] : [true, false];
  for (const opened of tiers) {
    const item = newest("needs_you", opened) ?? newest("cart_ready", opened);
    if (item) return item;
  }
  return null;
}

export function popupPurchaseOpportunity(
  value: unknown,
  now = Date.now()
): PopupPurchaseOpportunity | null {
  const candidate = record(value);
  const deliveryId = cleanResultText(candidate.deliveryId, 160);
  const retailerSku = cleanResultText(candidate.retailerSku, 32);
  const expiry = new Date(String(candidate.expiresAt || "")).getTime();
  if (candidate.schemaVersion !== 1
    || candidate.kind !== "walmart_review_order"
    || candidate.retailerId !== "walmart"
    || !/^[A-Za-z0-9_-]{3,160}$/.test(deliveryId)
    || !/^\d{5,20}$/.test(retailerSku)
    || !Number.isFinite(expiry)
    || expiry <= now
    || expiry > now + 5 * 60_000) return null;
  return {
    schemaVersion: 1,
    deliveryId,
    kind: "walmart_review_order",
    retailerId: "walmart",
    retailerName: "Walmart",
    identityLabel: "Item",
    retailerSku,
    title: cleanResultText(candidate.title, 160) || `Walmart item ${retailerSku}`,
    expiresAt: new Date(expiry).toISOString()
  };
}

function safeErrorText(value: unknown): string {
  return cleanResultText(value, 600)
    .replace(/https?:\/\/\S+/gi, "[redacted URL]")
    .replace(/\b(authorization|bearer|cookie|csrf|secret|session|token)\s*[:=]?\s*[^\s·,;]+/gi, "$1 [redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]")
    .slice(0, 300);
}

function resultTitleCase(value: unknown): string {
  return cleanResultText(value, 80).replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function resultMoney(value: unknown): string {
  const cents = value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  return Number.isSafeInteger(cents) && cents >= 0
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
    : "Price unavailable";
}

function persistedResult(
  contextKey: string,
  outcome: PersistedPopupResult["outcome"],
  summary: string,
  details: string,
  now: number,
  productTitle = ""
): PersistedPopupResult {
  const sanitizedTitle = cleanResultText(productTitle, 300);
  return {
    schemaVersion: 1,
    contextKey: cleanResultText(contextKey, 180),
    outcome,
    summary: cleanResultText(summary, 180),
    details: cleanResultText(details, 1_200),
    recordedAt: new Date(now).toISOString(),
    ...(sanitizedTitle ? { productTitle: sanitizedTitle } : {})
  };
}

export function popupUpdateHandoff(value: unknown, now = Date.now()): PopupUpdateHandoff | null {
  const candidate = record(value);
  const channel = candidate.channel === "local" || candidate.channel === "managed"
    ? candidate.channel : null;
  const releaseVersion = cleanResultText(candidate.releaseVersion, 40);
  if (!channel || !comparableVersion(releaseVersion)) return null;
  return {
    schemaVersion: 1,
    channel,
    releaseVersion,
    recordedAt: new Date(now).toISOString()
  };
}

function exactCatalogProductTitle(response: Record<string, unknown>, page: Extract<PopupPageContext, { kind: "product" }>): string {
  const identity = record(response.productIdentity);
  const retailerId = cleanResultText(identity.retailerId, 40).toLocaleLowerCase("en-US");
  const retailerSku = cleanResultText(identity.retailerSku, 120).toLocaleUpperCase("en-US");
  if (identity.source !== "catalog_exact_retailer_sku"
    || retailerId !== page.retailerId
    || retailerSku !== page.sku.toLocaleUpperCase("en-US")) return "";
  return cleanResultText(identity.title, 300);
}

export function qualificationPopupResult(
  value: unknown,
  page: PopupPageContext,
  now = Date.now()
): PersistedPopupResult | null {
  if (page.kind !== "product" && page.kind !== "product_link") return null;
  const response = record(value);
  const observation = record(response.observation);
  const resolvedPage = page.kind === "product_link" ? classifyPageContext(observation.canonicalUrl) : page;
  if (resolvedPage.kind !== "product" || resolvedPage.retailerId !== page.retailerId
    || (page.kind === "product_link" && resolvedPage.sku !== observation.retailerSku)) return null;
  const rehearsal = record(response.rehearsal);
  const productTitle = exactCatalogProductTitle(response, resolvedPage);
  const price = resultMoney(observation.unitPriceCents);
  const fulfillment = resultTitleCase(observation.fulfillment || "Fulfillment unavailable");
  const seller = cleanResultText(observation.sellerName || "Seller unavailable", 160);
  const lines = [`${resolvedPage.identityLabel} ${resolvedPage.sku}`, price, seller, fulfillment];
  if (observation.availability) lines.push(`Availability: ${resultTitleCase(observation.availability)}`);
  if (observation.securityChallenge === true) lines.push("Security check on the page");
  else if (observation.interactiveBlock) lines.push(`Manual step: ${resultTitleCase(observation.interactiveBlock)}`);
  if (observation.purchaseRouteReady === true) lines.push("Exact offer binding verified");
  const qualification = response.workflow === "qualification";
  if (resolvedPage.retailerId === "bestbuy" && observation.interactiveBlock === "high_demand"
    && !observation.securityChallenge) {
    const reason = "Complete Best Buy’s reservation steps in this tab, then inspect the product again. Nothing was added.";
    return persistedResult(page.key, "blocked", `Reservation required · ${reason}`, `${lines.join(" · ")} · ${reason}`, now, productTitle);
  }
  if (!qualification) {
    return persistedResult(page.key, "inspected", `Inspected · ${price}`, lines.join(" · "), now, productTitle);
  }
  if (rehearsal.ok === true) {
    return persistedResult(page.key, "qualified", `Check passed · ${price} · ${fulfillment}`, lines.join(" · "), now, productTitle);
  }
  if (resolvedPage.retailerId === "bestbuy" && (observation.fulfillment === "pickup" || record(response.shippingSelection).ok === false)
    && !observation.securityChallenge && !observation.interactiveBlock) {
    const reason = "Yoink could not verify Shipping on this offer. Nothing was added; Pickup will not be used.";
    return persistedResult(page.key, "blocked", `Shipping not verified · ${reason}`, `${lines.join(" · ")} · ${reason}`, now, productTitle);
  }
  const reason = safeErrorText(response.message || resultTitleCase(rehearsal.reason || "Offer not verified"));
  return persistedResult(page.key, "blocked", `Blocked · ${reason}`, `${lines.join(" · ")} · ${reason}`, now, productTitle);
}

export function drawingsPopupResult(
  value: unknown,
  page: PopupPageContext,
  now = Date.now()
): PersistedPopupResult | null {
  if (page.kind !== "walmart_draw") return null;
  const response = record(value);
  const scan = record(response.scan);
  const items = Array.isArray(scan.items) ? scan.items : [];
  const active = items.filter((item) => record(item).drawState === "active").length;
  const summary = `Inspected · ${active} active drawing${active === 1 ? "" : "s"}`;
  const details = `${items.length} exact drawing item${items.length === 1 ? "" : "s"} observed.`;
  return persistedResult(page.key, "drawings", summary, details, now);
}

export function errorPopupResult(
  contextKey: string,
  error: unknown,
  blocked = false,
  now = Date.now()
): PersistedPopupResult {
  const message = safeErrorText(record(error).message || error || "The request could not be completed.")
    || "The request could not be completed.";
  return persistedResult(contextKey, blocked ? "blocked" : "error", `${blocked ? "Blocked" : "Error"} · ${message}`, message, now);
}

export interface PopupViewInput {
  health?: PopupHealthState | null;
  page: PopupPageContext;
  installedVersion: string;
  production: boolean;
  pageAccessGranted?: boolean;
  operation?: {
    stage: PopupOperationStage;
    contextKey: string;
  } | null;
  lastResult?: PersistedPopupResult | null;
  updateHandoff?: PopupUpdateHandoff | null;
  cartReady?: PersistedCartReadyState | null;
  bestBuyWait?: BestBuyWaitState | null;
  cartOutcome?: {
    jobId: string;
    stage: "choice" | "amount" | "submitting";
    error?: string;
  } | null;
  purchaseOpportunity?: PopupPurchaseOpportunity | null;
  confirmation?: "share_evidence" | null;
  notice?: string;
  now?: number;
}

export interface PopupViewModel {
  status: PopupStatus;
  statusLabel: "Ready" | "Monitoring" | "Paused" | "Needs attention";
  hardBlocker: "unavailable" | "unpaired" | "companion_update" | "app_update" | null;
  context: {
    visible: boolean;
    eyebrow: string;
    title: string;
    supporting: string;
    pairing: boolean;
  };
  primaryAction: {
    id: PopupActionId;
    label: string;
    disabled: boolean;
  } | null;
  activity: {
    id: "purchase" | "sync" | "signals" | "reconnect" | "pause" | "mode";
    label: string;
    action: "none" | "open_purchase" | "reconnect_trackalacker" | "review_pause" | "review_mode";
  } | null;
  resultStatus: {
    label: "Check passed" | "Blocked" | "Shipping not verified" | "Reservation required" | "Error" | "Inspected";
    tone: "success" | "warning" | "danger" | "neutral";
  } | null;
  result: PersistedPopupResult | null;
  cartReady: PersistedCartReadyItem | null;
  bestBuyWait: BestBuyWaitState | null;
  cartOutcome: {
    jobId: string;
    stage: "choice" | "amount" | "submitting";
    reviewedMaximumCents: number | null;
    error: string;
  } | null;
  purchaseOpportunity: PopupPurchaseOpportunity | null;
  details: Array<{ label: string; value: string }>;
  menu: {
    syncProducts: boolean;
    shareEvidence: boolean;
    saveRepairPage: boolean;
    checkUpdates: boolean;
    checkStoresNow: boolean;
  };
}

export type PopupContextMenuCommand =
  | "open_yoink"
  | "inspect_product"
  | "save_repair_page"
  | "inspect_drawings"
  | "reconnect_trackalacker"
  | "sync_products"
  | "settings";

function comparableVersion(value: unknown): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(String(value || ""));
  return match ? match.slice(1, 4).map((part) => Number(part)) : null;
}

export function compareVersions(left: unknown, right: unknown): number {
  const a = comparableVersion(left);
  const b = comparableVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    const leftPart = a[index] ?? 0;
    const rightPart = b[index] ?? 0;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function operationLabel(action: PopupActionId, stage: PopupOperationStage): string | null {
  if (stage === "requesting_access") return "Requesting access…";
  if (stage === "inspecting") return action === "inspect_drawings" ? "Inspecting drawings…" : "Inspecting…";
  if (stage === "qualifying") return "Checking offer…";
  if (stage === "pairing") return "Pairing…";
  if (stage === "reconnecting") return "Reconnecting…";
  if (stage === "opening_cart") return action === "open_bestbuy_wait" ? "Opening Best Buy…"
    : action === "open_purchase" ? "Opening Walmart…" : "Opening cart…";
  if (stage === "updating") return "Checking update…";
  if (stage === "checking_stores") return "Checking stores…";
  if (stage === "sharing") return "Sharing…";
  if (stage === "saving") return "Saving…";
  return null;
}

function runningSync(health: PopupHealthState, now: number): boolean {
  const sync = health.trackalackerSync;
  const updatedAt = new Date(String(sync?.updatedAt || "")).getTime();
  return ["starting", "discovering", "importing"].includes(String(sync?.phase || ""))
    && Number.isFinite(updatedAt)
    && now - updatedAt < 10 * 60_000;
}

function signalsLabel(health: PopupHealthState, now: number): string {
  const count = Number(health.popupSummary?.followedCount);
  const updatedAt = new Date(String(health.popupSummary?.followedCountUpdatedAt || "")).getTime();
  return Number.isSafeInteger(count) && count >= 0 && Number.isFinite(updatedAt) && now - updatedAt < 10 * 60_000
    ? `Calls live · ${count.toLocaleString("en-US")} followed`
    : "Calls live";
}

function resultStateLabel(result: PersistedPopupResult): NonNullable<PopupViewModel["resultStatus"]>["label"] {
  if (result.outcome === "blocked" && result.summary.startsWith("Reservation required · ")) return "Reservation required";
  if (result.outcome === "qualified") return "Check passed";
  if (result.outcome === "blocked" && result.summary.startsWith("Shipping not verified · ")) return "Shipping not verified";
  if (result.outcome === "blocked") return "Blocked";
  if (result.outcome === "error") return "Error";
  return "Inspected";
}

function resultStateTone(result: PersistedPopupResult): NonNullable<PopupViewModel["resultStatus"]>["tone"] {
  if (result.outcome === "qualified") return "success";
  if (result.outcome === "blocked") return "warning";
  if (result.outcome === "error") return "danger";
  return "neutral";
}

function resultSupporting(result: PersistedPopupResult): string {
  const separator = result.summary.indexOf(" · ");
  return separator >= 0 ? result.summary.slice(separator + 3) : "";
}

function statusFor(health: PopupHealthState, versionDifference: number): PopupStatus {
  if (health.connected !== true || health.paired !== true || versionDifference !== 0) return "attention";
  if (health.trackalackerPush?.ready !== true) return "attention";
  if (health.actionsPaused === true) return "paused";
  if (health.executionMode !== "live" || health.chromeMutationEnabled !== true) return "monitoring";
  return "ready";
}

function statusLabel(status: PopupStatus): PopupViewModel["statusLabel"] {
  if (status === "ready") return "Ready";
  if (status === "monitoring") return "Monitoring";
  if (status === "paused") return "Paused";
  return "Needs attention";
}

export function derivePopupView(input: PopupViewInput): PopupViewModel {
  const health = input.health ?? {};
  const now = input.now ?? Date.now();
  const versionDifference = health.connected === true && comparableVersion(health.version)
    ? compareVersions(health.version, input.installedVersion)
    : 0;
  let status = statusFor(health, versionDifference);
  const trackalackerReady = health.trackalackerPush?.ready === true;
  const monitoringOnly = health.executionMode !== "live" || health.chromeMutationEnabled !== true;
  const pageActionable = input.page.kind === "product" || input.page.kind === "product_link" || input.page.kind === "walmart_draw";
  const matchedResult = input.lastResult?.schemaVersion === 1
    && input.lastResult.contextKey === input.page.key ? input.lastResult : null;
  const handoffRecordedAt = new Date(String(input.updateHandoff?.recordedAt || "")).getTime();
  const readyUpdateHandoff = input.updateHandoff?.schemaVersion === 1
    && compareVersions(input.updateHandoff.releaseVersion, health.version) === 0
    && Number.isFinite(handoffRecordedAt)
    && handoffRecordedAt <= now + 60_000
    && now - handoffRecordedAt < 24 * 60 * 60_000
      ? input.updateHandoff : null;
  const actionHandoffs = cartReadyState(input.cartReady, now).items;
  const bestBuyWait = bestBuyWaitState(input.bestBuyWait, now);
  const needsYouHandoffs = actionHandoffs.filter((item) => item.kind === "needs_you");
  const cartReadyHandoffs = actionHandoffs.filter((item) => item.kind === "cart_ready");
  const requestedOutcomeJobId = cleanResultText(input.cartOutcome?.jobId, 120);
  const requestedOutcomeHandoff = /^[A-Za-z0-9_-]{3,120}$/.test(requestedOutcomeJobId)
    ? actionHandoffs.find((item) => item.jobId === requestedOutcomeJobId) ?? null
    : null;
  const preferredHandoff = requestedOutcomeHandoff
    ?? preferredActionHandoff({ schemaVersion: 1, items: actionHandoffs }, now);
  const purchaseOpportunity = popupPurchaseOpportunity(input.purchaseOpportunity, now);
  let hardBlocker: PopupViewModel["hardBlocker"] = null;
  let context: PopupViewModel["context"] = {
    visible: false,
    eyebrow: "",
    title: "",
    supporting: "",
    pairing: false
  };
  let primaryAction: PopupViewModel["primaryAction"] = null;

  // A locally persisted cart/review handoff stays actionable even if the
  // control plane is temporarily unavailable or asks for an update. The
  // shopper must always be able to finish or close out an already-started add.
  if (bestBuyWait) {
    status = "attention";
    context = {
      visible: true, eyebrow: "BEST BUY", pairing: false,
      title: bestBuyWait.needsAction ? "Best Buy needs your verification"
        : bestBuyWait.clicked ? "Add triggered · Waiting for Best Buy" : "Checking Best Buy add",
      supporting: `SKU ${bestBuyWait.retailerSku} · ${bestBuyWait.needsAction
        ? "Complete Best Buy’s steps, including any SMS code, in the open store tab. Yoink is waiting for cart confirmation."
        : "Keep the store tab open. Yoink is waiting for cart confirmation."}`
    };
    primaryAction = { id: "open_bestbuy_wait", label: bestBuyWait.needsAction ? "Complete verification" : "Open waiting tab", disabled: false };
  } else if (preferredHandoff) {
    status = "attention";
    if (preferredHandoff.kind === "needs_you") {
      context = {
        visible: true,
        eyebrow: "NEEDS YOU",
        title: needsYouHandoffs.length === 1
          ? `${preferredHandoff.retailerName} needs review`
          : `${needsYouHandoffs.length} actions need review`,
        supporting: needsYouHandoffs.length === 1
          ? `${preferredHandoff.identityLabel} ${preferredHandoff.retailerSku} · Check the store cart or session`
          : "Check the open store tabs",
        pairing: false
      };
      primaryAction = {
        id: "open_cart",
        label: preferredHandoff.openedAt ? "Return to store" : "Review store",
        disabled: false
      };
    } else {
      context = {
        visible: true,
        eyebrow: "CART READY",
        title: cartReadyHandoffs.length === 1
          ? `${preferredHandoff.retailerName} cart ready`
          : `${cartReadyHandoffs.length} carts ready`,
        supporting: cartReadyHandoffs.length === 1
          ? `${preferredHandoff.identityLabel} ${preferredHandoff.retailerSku}`
          : "Open the store cart",
        pairing: false
      };
      primaryAction = {
        id: "open_cart",
        label: preferredHandoff.openedAt ? "Return to cart" : "Open cart",
        disabled: false
      };
    }
  } else if (health.connected !== true) {
    hardBlocker = "unavailable";
    context = {
      visible: true,
      eyebrow: "YOINK",
      title: "Yoink unavailable",
      supporting: input.production ? "Check your connection, then retry." : "Start Yoink, then retry.",
      pairing: false
    };
    primaryAction = { id: "retry", label: "Retry", disabled: false };
  } else if (health.paired !== true) {
    hardBlocker = "unpaired";
    context = {
      visible: true,
      eyebrow: "BROWSER",
      title: "Pair this browser",
      supporting: "Enter the code from Yoink › Settings › Chrome.",
      pairing: true
    };
    primaryAction = { id: "pair", label: "Pair browser", disabled: false };
  } else if (versionDifference > 0) {
    if (health.companionCompatible === false) hardBlocker = "companion_update";
    if (readyUpdateHandoff) {
      context = {
        visible: true,
        eyebrow: readyUpdateHandoff.channel === "managed" ? "UPDATE READY" : "UPDATE DOWNLOADED",
        title: readyUpdateHandoff.channel === "managed" ? "Reload Chrome companion" : "Replace extension files",
        supporting: readyUpdateHandoff.channel === "managed"
          ? `1. Let Chrome finish the Yoink ${readyUpdateHandoff.releaseVersion} update. 2. Choose Reload Chrome companion.`
          : `1. Open Downloads and extract Yoink-Companion-${readyUpdateHandoff.releaseVersion}.zip. 2. Copy those files over the current Yoink extension folder. 3. Return here and choose Reload Chrome companion.`,
        pairing: false
      };
      primaryAction = { id: "reload_companion", label: "Reload Chrome companion", disabled: false };
    } else {
      context = {
        visible: true,
        eyebrow: "UPDATE REQUIRED",
        title: "Update Chrome companion",
        supporting: `Yoink ${health.version || ""} requires the matching Chrome companion.`,
        pairing: false
      };
      primaryAction = { id: "update_companion", label: "Update Chrome companion", disabled: false };
    }
  } else if (versionDifference < 0) {
    if (health.companionCompatible === false) hardBlocker = "app_update";
    context = {
      visible: true,
      eyebrow: "VERSION MISMATCH",
      title: "Update Yoink",
      supporting: "The Chrome companion is newer than the running Yoink app.",
      pairing: false
    };
    primaryAction = { id: "open_yoink", label: "Open Yoink", disabled: false };
  } else if (input.confirmation === "share_evidence" && input.page.kind === "product") {
    context = {
      visible: true,
      eyebrow: "COMMUNITY EVIDENCE",
      title: `Share ${input.page.retailerName} evidence?`,
      supporting: "Shares one stock update. No account or page text is included.",
      pairing: false
    };
    primaryAction = { id: "confirm_share_evidence", label: "Share evidence", disabled: false };
  } else if (input.page.kind === "product") {
    const productTitle = cleanResultText(matchedResult?.productTitle, 300);
    const resultSummary = matchedResult ? resultSupporting(matchedResult) : "";
    context = {
      visible: true,
      eyebrow: input.page.retailerName.toLocaleUpperCase("en-US"),
      title: productTitle || `${input.page.retailerName} product · ${input.page.identityLabel} ${input.page.sku}`,
      supporting: productTitle
        ? [`${input.page.identityLabel} ${input.page.sku}`, input.notice || resultSummary].filter(Boolean).join(" · ")
        : input.notice || resultSummary,
      pairing: false
    };
    primaryAction = {
      id: "inspect_product",
      label: matchedResult ? "Inspect again" : "Inspect product",
      disabled: false
    };
  } else if (input.page.kind === "product_link") {
    context = {
      visible: true,
      eyebrow: input.page.retailerName.toLocaleUpperCase("en-US"),
      title: cleanResultText(matchedResult?.productTitle, 300) || `${input.page.retailerName} product`,
      supporting: input.notice || (matchedResult ? resultSupporting(matchedResult) : "Inspect this page to identify the item."),
      pairing: false
    };
    primaryAction = { id: "inspect_product", label: matchedResult ? "Inspect again" : "Inspect product", disabled: false };
  } else if (input.page.kind === "walmart_draw") {
    context = {
      visible: true,
      eyebrow: "WALMART",
      title: "Collectibles Draw",
      supporting: input.notice || (matchedResult ? resultSupporting(matchedResult) : "Entry stays manual"),
      pairing: false
    };
    primaryAction = {
      id: "inspect_drawings",
      label: matchedResult ? "Inspect again" : "Inspect drawings",
      disabled: false
    };
  } else if (purchaseOpportunity) {
    status = "attention";
    context = {
      visible: true,
      eyebrow: "WALMART",
      title: purchaseOpportunity.title,
      supporting: `${purchaseOpportunity.identityLabel} ${purchaseOpportunity.retailerSku} · Ready to add`,
      pairing: false
    };
    primaryAction = { id: "open_purchase", label: "Buy at Walmart", disabled: false };
  } else if (!trackalackerReady) {
    context = {
      visible: true,
      eyebrow: "TRACKALACKER",
      title: "TrackaLacker disconnected",
      supporting: "Reconnect to receive calls.",
      pairing: false
    };
    primaryAction = { id: "reconnect_trackalacker", label: "Reconnect", disabled: false };
  } else if (health.actionsPaused === true) {
    context = {
      visible: true,
      eyebrow: "STORE ACTIONS",
      title: "Store actions paused",
      supporting: "Monitoring continues. Resume from Home.",
      pairing: false
    };
    primaryAction = { id: "review_pause", label: "Open Home", disabled: false };
  } else if (monitoringOnly) {
    context = {
      visible: true,
      eyebrow: "STORE ACTIONS",
      title: health.executionMode !== "live" ? "Test mode" : "Monitoring only",
      supporting: "Store clicks are off. Details are under Insights.",
      pairing: false
    };
    primaryAction = { id: "review_mode", label: "Open Insights", disabled: false };
  }

  const operation = input.operation?.contextKey === input.page.key || hardBlocker !== null
    ? input.operation : null;
  if (primaryAction && operation && operation.stage !== "idle") {
    const label = operationLabel(primaryAction.id, operation.stage);
    if (label) primaryAction = { ...primaryAction, label, disabled: true };
  }

  let activity: PopupViewModel["activity"] = null;
  if (purchaseOpportunity && hardBlocker === null) status = "attention";
  if (hardBlocker !== null) {
    activity = null;
  } else if (pageActionable && purchaseOpportunity) {
    activity = {
      id: "purchase",
      label: `Walmart ${purchaseOpportunity.identityLabel} ${purchaseOpportunity.retailerSku} ready · Open`,
      action: "open_purchase"
    };
  } else if (runningSync(health, now)) {
    const processed = Math.max(0, Number(health.trackalackerSync?.processed) || 0);
    const discovered = Math.max(0, Number(health.trackalackerSync?.discovered) || 0);
    activity = { id: "sync", label: `Syncing products · ${processed} of ${discovered}`, action: "none" };
  } else if (pageActionable && !trackalackerReady) {
    activity = { id: "reconnect", label: "TrackaLacker disconnected · Reconnect", action: "reconnect_trackalacker" };
  } else if (pageActionable && health.actionsPaused === true) {
    activity = { id: "pause", label: "Store actions paused · Open Home", action: "review_pause" };
  } else if (pageActionable && monitoringOnly) {
    activity = {
      id: "mode",
      label: `${health.executionMode !== "live" ? "Test mode" : "Monitoring only"} · Open Insights`,
      action: "review_mode"
    };
  } else if (trackalackerReady) {
    activity = { id: "signals", label: signalsLabel(health, now), action: "none" };
  }

  const retailerActions = health.actionsPaused === true ? "Paused"
    : health.executionMode !== "live" ? "Test mode"
      : health.chromeMutationEnabled === true ? "Enabled" : "Monitoring";
  const storeAccess = pageActionable
    ? input.pageAccessGranted === true ? "Available" : "Requires approval"
    : "On demand";
  const sharingRetailers = new Set(Array.isArray(health.communitySharingRetailers)
    ? health.communitySharingRetailers : []);
  const requestedOutcomeStage = ["choice", "amount", "submitting"].includes(String(input.cartOutcome?.stage || ""))
    ? input.cartOutcome?.stage as "choice" | "amount" | "submitting"
    : null;
  const outcomeHandoff = requestedOutcomeHandoff
    ?? (preferredHandoff?.openedAt ? preferredHandoff : null);
  const cartOutcome = hardBlocker === null
    && outcomeHandoff?.openedAt
      ? {
          jobId: outcomeHandoff.jobId,
          stage: requestedOutcomeStage ?? "choice",
          reviewedMaximumCents: outcomeHandoff.reviewedMaximumCents ?? null,
          error: cleanResultText(input.cartOutcome?.error, 180)
        }
      : null;
  return {
    status,
    statusLabel: statusLabel(status),
    hardBlocker,
    context,
    primaryAction,
    activity,
    resultStatus: bestBuyWait || preferredHandoff || !matchedResult ? null : {
      label: resultStateLabel(matchedResult),
      tone: resultStateTone(matchedResult)
    },
    result: bestBuyWait || preferredHandoff ? null : matchedResult,
    cartReady: bestBuyWait ? null : preferredHandoff,
    bestBuyWait,
    cartOutcome: bestBuyWait ? null : cartOutcome,
    purchaseOpportunity,
    details: [
      { label: "Browser", value: health.paired === true ? "Paired" : "Not paired" },
      { label: "TrackaLacker", value: trackalackerReady ? "Connected" : "Disconnected" },
      { label: "Store actions", value: retailerActions },
      { label: "Store access", value: storeAccess },
      { label: "Checked", value: health.checkedAt || "Not checked" }
    ],
    menu: {
      syncProducts: health.connected === true && health.paired === true,
      shareEvidence: hardBlocker === null && input.page.kind === "product" && sharingRetailers.has(input.page.retailerId),
      saveRepairPage: !input.production && hardBlocker === null && ["product", "product_link"].includes(input.page.kind)
        && health.localEvidenceCapsules === true && health.evidenceCapsuleTransport === "loopback",
      checkUpdates: !input.production && health.connected === true,
      checkStoresNow: health.connected === true && health.paired === true
    }
  };
}

export function deriveContextMenuCommands(input: PopupViewInput): PopupContextMenuCommand[] {
  const view = derivePopupView(input);
  const commands: PopupContextMenuCommand[] = ["open_yoink"];
  if (view.hardBlocker === null) {
    if (input.page.kind === "product" || input.page.kind === "product_link") commands.push("inspect_product");
    if (!input.production && ["product", "product_link"].includes(input.page.kind) && input.health?.localEvidenceCapsules === true
      && input.health?.evidenceCapsuleTransport === "loopback") commands.push("save_repair_page");
    if (input.page.kind === "walmart_draw") commands.push("inspect_drawings");
    commands.push(input.health?.trackalackerPush?.ready === true
      ? "sync_products" : "reconnect_trackalacker");
  }
  commands.push("settings");
  return commands;
}
