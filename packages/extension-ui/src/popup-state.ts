import { extractTargetSku } from "../../browser-adapters/src/target.js";
import {
  canonicalRetailerProductUrl,
  extractRetailerSku
} from "../../browser-adapters/src/retailers.js";
import type { SupportedRetailerId } from "../../contracts/src/index.js";

export const POPUP_RESULT_STORAGE_KEY = "yoinkPopupResultV1";
export const POPUP_UPDATE_HANDOFF_STORAGE_KEY = "yoinkUpdateHandoffV1";

export type YoinkAppDestination = "dashboard" | "connections" | "operations" | "settings";

const APP_DESTINATION_ROUTES: Record<YoinkAppDestination, { pathname: string; hash: string }> = {
  dashboard: { pathname: "/", hash: "" },
  connections: { pathname: "/admin", hash: "connections" },
  operations: { pathname: "/admin", hash: "operations" },
  settings: { pathname: "/admin", hash: "settings" }
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
  pokemoncenter: { name: "Pokémon Center", domains: ["pokemoncenter.com"], identityLabel: "SKU" }
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
  pokemoncenter: ["https://*.pokemoncenter.com/*"]
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
  "https://*.pokemoncenter.com/product/*"
];

export type PopupPageContext =
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
  if (retailerId === "pbandai") return /^\/us\/item\/[a-z]\d{10}(?:\/|$)/i.test(path);
  return /^\/product\/\d{2,3}-\d{5}(?:-\d{3})?(?:\/|$)/i.test(path);
}

export function classifyPageContext(value: unknown): PopupPageContext {
  const url = trustedHttpsUrl(value);
  if (!url) return { kind: "unsupported", key: "unsupported" };
  const retailerId = retailerFromUrl(url);
  if (!retailerId) return { kind: "unsupported", key: "unsupported" };
  const retailer = RETAILERS[retailerId];
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
  | "open_yoink"
  | "inspect_product"
  | "inspect_drawings"
  | "reconnect_trackalacker"
  | "review_pause"
  | "review_mode"
  | "confirm_share_evidence";
export type PopupOperationStage =
  | "idle"
  | "requesting_access"
  | "inspecting"
  | "qualifying"
  | "pairing"
  | "reconnecting"
  | "updating"
  | "sharing";

export interface PopupHealthState {
  connected?: boolean;
  paired?: boolean;
  deviceName?: string;
  checkedAt?: string;
  version?: string;
  executionMode?: string;
  actionsPaused?: boolean;
  chromeMutationEnabled?: boolean;
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
  if (page.kind !== "product") return null;
  const response = record(value);
  const observation = record(response.observation);
  const rehearsal = record(response.rehearsal);
  const productTitle = exactCatalogProductTitle(response, page);
  const price = resultMoney(observation.unitPriceCents);
  const fulfillment = resultTitleCase(observation.fulfillment || "Fulfillment unavailable");
  const seller = cleanResultText(observation.sellerName || "Seller unavailable", 160);
  const lines = [`${page.identityLabel} ${page.sku}`, price, seller, fulfillment];
  if (observation.availability) lines.push(`Availability: ${resultTitleCase(observation.availability)}`);
  if (observation.interactiveBlock) lines.push(`Manual step: ${resultTitleCase(observation.interactiveBlock)}`);
  if (observation.purchaseRouteReady === true) lines.push("Exact offer binding verified");
  const qualification = response.workflow === "qualification";
  lines.push(qualification
    ? "Qualification stopped at the final pre-click boundary."
    : "Read-only inspection completed; no retailer control was clicked.");
  if (!qualification) return persistedResult(page.key, "inspected", `Inspected · ${price}`, lines.join(" · "), now, productTitle);
  if (rehearsal.ok === true) {
    return persistedResult(page.key, "qualified", `Qualified · ${price} · ${fulfillment}`, lines.join(" · "), now, productTitle);
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
  const details = `${items.length} exact drawing item${items.length === 1 ? "" : "s"} observed. Entry remains manual; no entry, address, payment, or account state was collected.`;
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
    id: "sync" | "signals" | "reconnect" | "pause" | "mode";
    label: string;
    action: "none" | "reconnect_trackalacker" | "review_pause" | "review_mode";
  } | null;
  result: PersistedPopupResult | null;
  details: Array<{ label: string; value: string }>;
  menu: {
    syncProducts: boolean;
    shareEvidence: boolean;
    manageStoreAccess: boolean;
    checkUpdates: boolean;
  };
}

export type PopupContextMenuCommand =
  | "open_yoink"
  | "inspect_product"
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
  if (stage === "qualifying") return "Qualifying…";
  if (stage === "pairing") return "Pairing…";
  if (stage === "reconnecting") return "Reconnecting…";
  if (stage === "updating") return "Checking update…";
  if (stage === "sharing") return "Sharing…";
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
    ? `Signals live · ${count.toLocaleString("en-US")} followed`
    : "Signals live";
}

function resultStateLabel(result: PersistedPopupResult): string {
  if (result.outcome === "qualified") return "Qualified";
  if (result.outcome === "blocked") return "Blocked";
  if (result.outcome === "error") return "Error";
  return "Inspected";
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
  const status = statusFor(health, versionDifference);
  const trackalackerReady = health.trackalackerPush?.ready === true;
  const monitoringOnly = health.executionMode !== "live" || health.chromeMutationEnabled !== true;
  const pageActionable = input.page.kind === "product" || input.page.kind === "walmart_draw";
  const matchedResult = input.lastResult?.schemaVersion === 1
    && input.lastResult.contextKey === input.page.key ? input.lastResult : null;
  const handoffRecordedAt = new Date(String(input.updateHandoff?.recordedAt || "")).getTime();
  const readyUpdateHandoff = input.updateHandoff?.schemaVersion === 1
    && compareVersions(input.updateHandoff.releaseVersion, health.version) === 0
    && Number.isFinite(handoffRecordedAt)
    && handoffRecordedAt <= now + 60_000
    && now - handoffRecordedAt < 24 * 60 * 60_000
      ? input.updateHandoff : null;
  let hardBlocker: PopupViewModel["hardBlocker"] = null;
  let context: PopupViewModel["context"] = {
    visible: false,
    eyebrow: "",
    title: "",
    supporting: "",
    pairing: false
  };
  let primaryAction: PopupViewModel["primaryAction"] = null;

  if (health.connected !== true) {
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
      supporting: "Enter the one-time code from Yoink → Connections.",
      pairing: true
    };
    primaryAction = { id: "pair", label: "Pair browser", disabled: false };
  } else if (versionDifference > 0) {
    hardBlocker = "companion_update";
    if (readyUpdateHandoff) {
      context = {
        visible: true,
        eyebrow: readyUpdateHandoff.channel === "managed" ? "UPDATE READY" : "UPDATE DOWNLOADED",
        title: readyUpdateHandoff.channel === "managed" ? "Restart companion" : "Replace extension files",
        supporting: readyUpdateHandoff.channel === "managed"
          ? `Reload to finish installing Yoink ${readyUpdateHandoff.releaseVersion}.`
          : `Use the Yoink ${readyUpdateHandoff.releaseVersion} files, then reload.`,
        pairing: false
      };
      primaryAction = { id: "reload_companion", label: "Reload companion", disabled: false };
    } else {
      context = {
        visible: true,
        eyebrow: "UPDATE REQUIRED",
        title: "Update companion",
        supporting: `Yoink ${health.version || ""} requires the matching companion.`,
        pairing: false
      };
      primaryAction = { id: "update_companion", label: "Update companion", disabled: false };
    }
  } else if (versionDifference < 0) {
    hardBlocker = "app_update";
    context = {
      visible: true,
      eyebrow: "VERSION MISMATCH",
      title: "Update Yoink",
      supporting: "The companion is newer than the running Yoink app.",
      pairing: false
    };
    primaryAction = { id: "open_yoink", label: "Open Yoink", disabled: false };
  } else if (input.confirmation === "share_evidence" && input.page.kind === "product") {
    context = {
      visible: true,
      eyebrow: "COMMUNITY EVIDENCE",
      title: `Share ${input.page.retailerName} evidence?`,
      supporting: "Shares one sanitized stock assertion. No account or page text is included.",
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
      label: matchedResult ? resultStateLabel(matchedResult) : "Inspect product",
      disabled: false
    };
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
      label: matchedResult ? resultStateLabel(matchedResult) : "Inspect drawings",
      disabled: false
    };
  } else if (!trackalackerReady) {
    context = {
      visible: true,
      eyebrow: "TRACKALACKER",
      title: "Signals disconnected",
      supporting: "Reconnect to receive product signals.",
      pairing: false
    };
    primaryAction = { id: "reconnect_trackalacker", label: "Reconnect", disabled: false };
  } else if (health.actionsPaused === true) {
    context = {
      visible: true,
      eyebrow: "RETAILER ACTIONS",
      title: "Retailer actions paused",
      supporting: "Monitoring continues.",
      pairing: false
    };
    primaryAction = { id: "review_pause", label: "Review paused actions", disabled: false };
  } else if (monitoringOnly) {
    context = {
      visible: true,
      eyebrow: "RETAILER ACTIONS",
      title: health.executionMode !== "live" ? "Test mode" : "Monitoring only",
      supporting: "Retailer clicks are off.",
      pairing: false
    };
    primaryAction = { id: "review_mode", label: "Review action mode", disabled: false };
  }

  const operation = input.operation?.contextKey === input.page.key || hardBlocker !== null
    ? input.operation : null;
  if (primaryAction && operation && operation.stage !== "idle") {
    const label = operationLabel(primaryAction.id, operation.stage);
    if (label) primaryAction = { ...primaryAction, label, disabled: true };
  }

  let activity: PopupViewModel["activity"] = null;
  if (hardBlocker !== null) {
    activity = null;
  } else if (runningSync(health, now)) {
    const processed = Math.max(0, Number(health.trackalackerSync?.processed) || 0);
    const discovered = Math.max(0, Number(health.trackalackerSync?.discovered) || 0);
    activity = { id: "sync", label: `Syncing products · ${processed} of ${discovered}`, action: "none" };
  } else if (pageActionable && !trackalackerReady) {
    activity = { id: "reconnect", label: "TrackaLacker disconnected · Reconnect", action: "reconnect_trackalacker" };
  } else if (pageActionable && health.actionsPaused === true) {
    activity = { id: "pause", label: "Retailer actions paused · Review", action: "review_pause" };
  } else if (pageActionable && monitoringOnly) {
    activity = {
      id: "mode",
      label: `${health.executionMode !== "live" ? "Test mode" : "Monitoring only"} · Review`,
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
  return {
    status,
    statusLabel: statusLabel(status),
    hardBlocker,
    context,
    primaryAction,
    activity,
    result: matchedResult,
    details: [
      { label: "Browser", value: health.paired === true ? "Paired" : "Not paired" },
      { label: "TrackaLacker", value: trackalackerReady ? "Connected" : "Disconnected" },
      { label: "Retailer actions", value: retailerActions },
      { label: "Store access", value: storeAccess },
      { label: "Checked", value: health.checkedAt || "Not checked" }
    ],
    menu: {
      syncProducts: health.connected === true && health.paired === true,
      shareEvidence: hardBlocker === null && input.page.kind === "product" && sharingRetailers.has(input.page.retailerId),
      manageStoreAccess: true,
      checkUpdates: !input.production && health.connected === true
    }
  };
}

export function deriveContextMenuCommands(input: PopupViewInput): PopupContextMenuCommand[] {
  const view = derivePopupView(input);
  const commands: PopupContextMenuCommand[] = ["open_yoink"];
  if (view.hardBlocker === null) {
    if (input.page.kind === "product") commands.push("inspect_product");
    if (input.page.kind === "walmart_draw") commands.push("inspect_drawings");
    commands.push(input.health?.trackalackerPush?.ready === true
      ? "sync_products" : "reconnect_trackalacker");
  }
  commands.push("settings");
  return commands;
}
