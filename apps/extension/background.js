"use strict";

importScripts("runtime-config.js", "trackalacker-push.js", "observer-recipe-root.js");

function normalizedRuntimeOrigin(value, profile) {
  const parsed = new URL(String(value || ""));
  const exactOrigin = !parsed.username && !parsed.password
    && parsed.pathname === "/" && !parsed.search && !parsed.hash;
  const loopback = parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost")
    || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (!exactOrigin
    || (profile === "local" && (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1"))
    || (profile === "production" && (parsed.protocol !== "https:" || loopback))) {
    throw new Error("Yoink Companion has an invalid packaged runtime origin.");
  }
  return parsed.origin;
}

function normalizedRuntimeConfig(value) {
  const profile = value?.profile === "production" ? "production" : value?.profile === "local" ? "local" : "";
  if (!profile || typeof value?.localPackageUpdates !== "boolean"
    || value.localPackageUpdates !== (profile === "local")) {
    throw new Error("Yoink Companion has an invalid packaged runtime profile.");
  }
  return Object.freeze({
    profile,
    apiOrigin: normalizedRuntimeOrigin(value.apiOrigin, profile),
    appOrigin: normalizedRuntimeOrigin(value.appOrigin, profile),
    localPackageUpdates: value.localPackageUpdates
  });
}

const RUNTIME_CONFIG = normalizedRuntimeConfig(globalThis.YoinkRuntimeConfig);
const API_ROOT = `${RUNTIME_CONFIG.apiOrigin}/api/v1`;
const APP_ROOT = RUNTIME_CONFIG.appOrigin;
const LOCAL_PACKAGE_UPDATES = RUNTIME_CONFIG.localPackageUpdates;
const EVIDENCE_REQUEST_TIMEOUT_MS = 10_000;
const HEALTH_ALARM = "yoink-health";
const JOB_ALARM = "yoink-jobs";
const READINESS_KEY = "readiness";
const DEVICE_KEY = "pairedDevice";
const ACTIVE_JOB_KEY = "activeRetailerJobV1";
const LEGACY_ACTIVE_TARGET_JOB_KEY = "activeTargetJob";
const TRACKALACKER_PUSH_STATE_KEY = "yoinkTrackalackerPushStateV1";
const TRACKALACKER_PUSH_QUEUE_KEY = "yoinkTrackalackerPushQueueV1";
const TRACKALACKER_SYNC_STATE_KEY = "yoinkTrackalackerSyncStateV1";
const NOTIFICATION_HISTORY_KEY = "yoinkNotificationHistoryV1";
const NOTIFICATION_ROUTES_KEY = "yoinkNotificationRoutesV1";
const COMMUNITY_CONTRIBUTION_TIMES_KEY = "yoinkCommunityContributionTimesV1";
const LEGACY_OBSERVER_RECIPE_KEY_PIN = "yoinkObserverRecipeKeyPinV1";
const OBSERVER_RECIPE_TRUST_STATE_KEY = "yoinkObserverRecipeTrustStateV1";
const OBSERVER_RECIPE_STATUS_KEY = "yoinkObserverRecipeStatusV1";
const ADAPTER_DIAGNOSTIC_QUEUE_KEY = "yoinkAdapterDiagnosticQueueV1";
const COMMUNITY_CONTRIBUTION_INTERVAL_MS = 60_000;
const TRACKALACKER_PUSH_QUEUE_LIMIT = 50;
const ADAPTER_DIAGNOSTIC_QUEUE_LIMIT = 50;
const ADAPTER_DIAGNOSTIC_QUEUE_MAX_AGE_MS = 9 * 60_000;
const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;
const TRACKALACKER_DEVICE_NICKNAME = "Desktop - Windows - Chrome";
const TRACKALACKER_SETTINGS_URL = "https://www.trackalacker.com/users/settings/notifications/edit";
const TRACKALACKER_ORIGINS = ["https://trackalacker.com/*", "https://www.trackalacker.com/*"];
const TARGET_ORIGINS = ["https://www.target.com/*"];
const RETAILER_ORIGINS = {
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
const TARGET_OBSERVER_VERSION = "target-observer-v1";
const RETAILER_OBSERVER_VERSIONS = {
  walmart: "walmart-observer-v4",
  amazon: "amazon-observer-v6",
  bestbuy: "bestbuy-observer-v5",
  disney: "disney-observer-v1",
  ravensburger: "ravensburger-observer-v1",
  riot: "riot-observer-v1",
  booksamillion: "booksamillion-observer-v1",
  fanatics: "fanatics-observer-v1",
  kohls: "kohls-observer-v1",
  macys: "macys-observer-v1",
  pbandai: "pbandai-observer-v2",
  pokemoncenter: "pokemoncenter-observer-v2"
};
const RETAILER_SKU_PATTERNS = Object.freeze({
  walmart: /^\d{5,20}$/,
  amazon: /^[A-Z0-9]{10}$/,
  bestbuy: /^\d{5,20}$/,
  disney: /^\d{10,20}$/,
  ravensburger: /^\d{5,20}$/,
  riot: /^[A-Z0-9](?:[A-Z0-9-]{1,118}[A-Z0-9])?$/,
  booksamillion: /^[A-Z0-9]{10,20}$/,
  fanatics: /^\d{6,20}$/,
  kohls: /^\d{5,12}$/,
  macys: /^\d{5,20}$/,
  pbandai: /^[A-Z]\d{10}$/,
  pokemoncenter: /^\d{2,3}-\d{5}(?:-\d{3})?$/
});
const SUPPORTED_RETAILER_DOMAINS = Object.freeze([
  "target.com", "walmart.com", "amazon.com", "bestbuy.com", "disneystore.com",
  "ravensburger.us", "merch.riotgames.com", "booksamillion.com", "fanatics.com",
  "kohls.com", "macys.com", "p-bandai.com", "pokemoncenter.com"
]);
const TARGET_ADD_ADAPTER_VERSION = "target-add-v1";
const WALMART_ADD_ADAPTER_VERSION = "walmart-add-v3";
const WALMART_DRAW_OBSERVER_VERSION = "walmart-draw-observer-v1";
const AMAZON_ADD_ADAPTER_VERSION = "amazon-add-v5";
const BESTBUY_ADD_ADAPTER_VERSION = "bestbuy-add-v3";
const TARGET_CART_URL = "https://www.target.com/cart";
const WALMART_CART_URL = "https://www.walmart.com/cart";
const AMAZON_CART_URL = "https://www.amazon.com/gp/cart/view.html";
const BESTBUY_CART_URL = "https://www.bestbuy.com/cart";
const ADD_LANES = Object.freeze({
  target: Object.freeze({
    name: "Target",
    adapterVersion: TARGET_ADD_ADAPTER_VERSION,
    cartUrl: TARGET_CART_URL,
    runnerFile: "target-action.js",
    runnerGlobal: "YoinkTargetAction",
    emptyOperation: "inspectTargetEmptyCart",
    prepareOperation: "prepareTargetAdd",
    commitOperation: "commitTargetAdd",
    verifyCartOperation: "verifyTargetAddedCart"
  }),
  walmart: Object.freeze({
    name: "Walmart",
    adapterVersion: WALMART_ADD_ADAPTER_VERSION,
    cartUrl: WALMART_CART_URL,
    runnerFile: "walmart-action.js",
    runnerGlobal: "YoinkWalmartAction",
    emptyOperation: "inspectWalmartEmptyCart",
    prepareOperation: "prepareWalmartAdd",
    commitOperation: "commitWalmartAdd",
    verifyCartOperation: "verifyWalmartAddedCart"
  }),
  amazon: Object.freeze({
    name: "Amazon",
    adapterVersion: AMAZON_ADD_ADAPTER_VERSION,
    cartUrl: AMAZON_CART_URL,
    runnerFile: "amazon-action.js",
    runnerGlobal: "YoinkAmazonAction",
    emptyOperation: "inspectAmazonEmptyCart",
    prepareOperation: "prepareAmazonAdd",
    commitOperation: "commitAmazonAdd",
    verifyCartOperation: "verifyAmazonAddedCart"
  }),
  bestbuy: Object.freeze({
    name: "Best Buy",
    adapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
    cartUrl: BESTBUY_CART_URL,
    runnerFile: "bestbuy-action.js",
    runnerGlobal: "YoinkBestBuyAction",
    emptyOperation: "inspectBestBuyEmptyCart",
    prepareOperation: "prepareBestBuyAdd",
    commitOperation: "commitBestBuyAdd",
    verifyCartOperation: "verifyBestBuyAddedCart"
  })
});
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const TrackalackerPush = globalThis.YoinkTrackalackerPush;
const ObserverRecipeRoot = globalThis.YoinkObserverRecipeRoot;
let jobCyclePromise = null;
let notificationCyclePromise = null;
let trackalackerEnrollmentPromise = null;
let trackalackerDrainPromise = null;
let trackalackerStateQueue = Promise.resolve();
let trackalackerQueueQueue = Promise.resolve();
let adapterDiagnosticDrainPromise = null;
let adapterDiagnosticQueueLock = Promise.resolve();
let deviceCredentialRotationPromise = null;

function readiness(connected, details = {}, device = null) {
  return {
    connected,
    paired: Boolean(device?.id),
    deviceName: typeof device?.name === "string" ? device.name.slice(0, 100) : "",
    checkedAt: new Date().toISOString(),
    version: typeof details.version === "string" ? details.version.slice(0, 40) : "",
    executionMode: details.executionMode === "live" ? "live" : "shadow",
    actionsPaused: details.actionsPaused !== false,
    chromeMutationEnabled: details.chromeMutationEnabled === true,
    targetAddCapable: true,
    walmartAddCapable: true,
    amazonAddCapable: true,
    bestBuyAddCapable: true,
    targetShadowAccess: details.targetShadowAccess === true,
    trackalackerPush: details.trackalackerPush || normalizeTrackalackerState(),
    trackalackerSync: details.trackalackerSync || normalizeTrackalackerSyncState(),
    message: connected ? "Yoink control plane ready" : "Yoink control plane unavailable"
  };
}

function targetCapabilities() {
  return {
    readiness: true,
    jobReconciliation: true,
    notifications: true,
    retailerMutation: false,
    targetAddOnly: true,
    targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION,
    walmartAddOnly: true,
    walmartAddAdapterVersion: WALMART_ADD_ADAPTER_VERSION,
    amazonAddOnly: true,
    amazonAddAdapterVersion: AMAZON_ADD_ADAPTER_VERSION,
    bestBuyAddOnly: true,
    bestBuyAddAdapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
    retailerShadow: true,
    communityReadOnlyEvidence: true,
    exactSelectedOfferEvidence: true,
    observerRecipeShadow: true,
    observerRecipePackagedOracle: true,
    sanitizedAdapterDiagnostics: true,
    durableAdapterDiagnostics: true,
    privacyBoundedRepairLandmarks: true,
    rotatableDeviceCredentials: true,
    productionTransportProfile: RUNTIME_CONFIG.profile === "production",
    managedExtensionUpdates: RUNTIME_CONFIG.profile === "production",
    walmartDrawReadOnly: true,
    trackalackerPush: true,
    trackalackerCatalogSync: true
  };
}

function comparableVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(String(value || ""));
  return match ? match.slice(1, 4).map((part) => Number(part)) : null;
}

function compareVersions(left, right) {
  const a = comparableVersion(left);
  const b = comparableVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function normalizedExtensionRelease(value) {
  const version = String(value?.version || "");
  const packageReady = value?.packageReady === true;
  const sha256 = String(value?.sha256 || "");
  const sizeBytes = Number(value?.sizeBytes);
  const downloadPath = String(value?.downloadUrl || "");
  if (!comparableVersion(version)) throw new Error("Yoink returned invalid extension release metadata.");
  if (packageReady && (downloadPath !== "/api/v1/extension/release/download"
    || !/^[a-f0-9]{64}$/.test(sha256)
    || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > 20 * 1024 * 1024)) {
    throw new Error("Yoink returned invalid extension package metadata.");
  }
  return {
    installedVersion: EXTENSION_VERSION,
    releaseVersion: version,
    updateAvailable: compareVersions(version, EXTENSION_VERSION) > 0,
    packageReady,
    sha256: packageReady ? sha256 : "",
    sizeBytes: packageReady ? sizeBytes : 0,
    downloadUrl: packageReady ? `${APP_ROOT}${downloadPath}` : "",
    channel: "local",
    managedByBrowser: false
  };
}

async function checkExtensionUpdate(download = false) {
  if (!LOCAL_PACKAGE_UPDATES) {
    return {
      update: {
        installedVersion: EXTENSION_VERSION,
        releaseVersion: EXTENSION_VERSION,
        updateAvailable: false,
        packageReady: false,
        sha256: "",
        sizeBytes: 0,
        downloadUrl: "",
        downloadStarted: false,
        channel: "managed",
        managedByBrowser: true
      }
    };
  }
  const release = normalizedExtensionRelease(await request("/extension/release", {}, 10_000));
  let downloadStarted = false;
  if (download && release.updateAvailable && release.packageReady) {
    await chrome.tabs.create({ url: release.downloadUrl, active: true });
    downloadStarted = true;
  }
  return { update: { ...release, downloadStarted } };
}

async function targetShadowAccess() {
  return chrome.permissions.contains({ origins: TARGET_ORIGINS });
}

async function addLaneAccess(retailerId) {
  const origins = retailerId === "target" ? TARGET_ORIGINS : RETAILER_ORIGINS[retailerId];
  return Boolean(origins && await chrome.permissions.contains({ origins }));
}

function exactTargetProductUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:"
      && url.hostname === "www.target.com"
      && !url.username
      && !url.password
      && /(?:^|\/)A-\d{6,}(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function exactWalmartDrawHubUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (url.hostname === "walmart.com" || url.hostname.endsWith(".walmart.com"))
      && url.pathname.replace(/\/+$/, "") === "/shop/collectibles/draw";
  } catch {
    return false;
  }
}

function targetSkuFromUrl(value) {
  if (!exactTargetProductUrl(value)) return "";
  try {
    return new URL(value).pathname.match(/(?:^|\/)A-(\d{6,})(?:\/|$)/i)?.[1] || "";
  } catch {
    return "";
  }
}

const SELECTED_OFFER_ATTRIBUTE_KEYS = new Set([
  "size", "color", "edition", "language", "pack", "condition", "finish", "style"
]);

function selectedOfferPayload(value, retailerSku) {
  if (!value || typeof value !== "object"
    || value.schemaVersion !== 1
    || !["exact", "listing_only", "unresolved"].includes(value.selectionState)
    || !value.attributes || typeof value.attributes !== "object" || Array.isArray(value.attributes)) {
    throw new Error("The retailer observer returned invalid selected-offer identity.");
  }
  const childOfferKey = String(value.childOfferKey || "").toUpperCase();
  if (childOfferKey !== retailerSku || !/^[A-Z0-9][A-Z0-9._-]{1,119}$/.test(childOfferKey)) {
    throw new Error("The retailer observer returned an unbound child offer.");
  }
  const attributes = {};
  for (const key of Object.keys(value.attributes).sort()) {
    if (!SELECTED_OFFER_ATTRIBUTE_KEYS.has(key)) {
      throw new Error("The retailer observer returned an unsupported variant dimension.");
    }
    const normalized = String(value.attributes[key] || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!normalized || /[<>]/.test(normalized)) {
      throw new Error("The retailer observer returned invalid variant evidence.");
    }
    attributes[key] = normalized;
  }
  if (value.selectionState === "listing_only" && Object.keys(attributes).length) {
    throw new Error("Listing-only evidence cannot include selected variant dimensions.");
  }
  return {
    schemaVersion: 1,
    selectionState: value.selectionState,
    childOfferKey,
    attributes
  };
}

function targetObservationPayload(value) {
  if (!value || typeof value !== "object") throw new Error("The Target observer returned no evidence.");
  const availability = ["in_stock", "preorder", "out_of_stock", "unknown"].includes(value.availability)
    ? value.availability : "unknown";
  const sellerType = ["first_party", "third_party", "unknown"].includes(value.sellerType)
    ? value.sellerType : "unknown";
  const fulfillment = ["shipping", "pickup", "unknown"].includes(value.fulfillment)
    ? value.fulfillment : "unknown";
  const interactiveBlock = ["", "auth", "mfa", "location", "membership", "queue", "high_demand", "unknown"].includes(value.interactiveBlock)
    ? value.interactiveBlock : "unknown";
  const purchaseRouteKind = ["none", "amazon_buy_now"].includes(value.purchaseRouteKind)
    ? value.purchaseRouteKind : "none";
  const routeReasonCode = ["not_applicable", "offer_not_actionable", "offer_id_missing_or_ambiguous", "offer_route_verified", "route_validation_failed"].includes(value.routeReasonCode)
    ? value.routeReasonCode : "not_applicable";
  const retailerSku = String(value.retailerSku || "");
  if (value.adapterVersion !== TARGET_OBSERVER_VERSION
    || value.contractVersion !== 1
    || value.pageKind !== "product"
    || value.retailerId !== "target"
    || !/^\d{6,}$/.test(retailerSku)
    || typeof value.addControlActionable !== "boolean"
    || typeof value.securityChallenge !== "boolean") {
    throw new Error("The Target observer returned invalid evidence.");
  }
  const unitPriceCents = value.unitPriceCents === null ? null : Number(value.unitPriceCents);
  if (unitPriceCents !== null && (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0)) {
    throw new Error("The Target observer returned invalid price evidence.");
  }
  const selectedOffer = selectedOfferPayload(value.selectedOffer, retailerSku);
  return {
    adapterVersion: TARGET_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt: String(value.observedAt || ""),
    pageKind: "product",
    retailerId: "target",
    retailerSku,
    availability,
    unitPriceCents,
    currency: "USD",
    sellerName: String(value.sellerName || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160),
    sellerType,
    fulfillment,
    addControlActionable: value.addControlActionable,
    securityChallenge: value.securityChallenge,
    interactiveBlock,
    purchaseRouteKind,
    purchaseRouteReady: value.purchaseRouteReady === true,
    routeReasonCode,
    selectedOffer
  };
}

function retailerObservationPayload(value, retailerId) {
  if (!value || typeof value !== "object") throw new Error("The retailer observer returned no evidence.");
  const expectedVersion = RETAILER_OBSERVER_VERSIONS[retailerId];
  const availability = ["in_stock", "preorder", "out_of_stock", "unknown"].includes(value.availability)
    ? value.availability : "unknown";
  const sellerType = ["first_party", "third_party", "unknown"].includes(value.sellerType)
    ? value.sellerType : "unknown";
  const fulfillment = ["shipping", "pickup", "unknown"].includes(value.fulfillment)
    ? value.fulfillment : "unknown";
  const interactiveBlock = ["", "auth", "mfa", "location", "membership", "queue", "high_demand", "unknown"].includes(value.interactiveBlock)
    ? value.interactiveBlock : "unknown";
  const purchaseRouteKind = retailerId === "amazon" && value.purchaseRouteKind === "amazon_buy_now"
    ? "amazon_buy_now" : "none";
  const routeReasonCode = retailerId === "amazon"
    && ["offer_not_actionable", "offer_id_missing_or_ambiguous", "offer_route_verified", "route_validation_failed"].includes(value.routeReasonCode)
    ? value.routeReasonCode : "not_applicable";
  const retailerSku = String(value.retailerSku || "").toUpperCase();
  const validSku = RETAILER_SKU_PATTERNS[retailerId]?.test(retailerSku) === true;
  const canonicalIdentity = value.canonicalUrl ? canonicalRetailerIdentity(value.canonicalUrl) : null;
  const reconstructedCanonicalUrl = retailerId === "walmart" ? `https://www.walmart.com/ip/${retailerSku}`
    : retailerId === "amazon" ? `https://www.amazon.com/dp/${retailerSku}`
      : retailerId === "bestbuy" ? `https://www.bestbuy.com/site/-/${retailerSku}.p`
        : retailerId === "riot" ? `https://merch.riotgames.com/en-us/product/${retailerSku.toLowerCase()}/`
          : retailerId === "booksamillion" ? `https://www.booksamillion.com/p/-/${retailerSku}`
            : retailerId === "pbandai" ? `https://p-bandai.com/us/item/${retailerSku}`
              : "";
  const canonicalUrl = canonicalIdentity?.retailerId === retailerId && canonicalIdentity.retailerSku === retailerSku
    ? canonicalIdentity.canonicalUrl : reconstructedCanonicalUrl;
  if (!expectedVersion
    || value.adapterVersion !== expectedVersion
    || value.contractVersion !== 1
    || value.pageKind !== "product"
    || value.retailerId !== retailerId
    || !validSku
    || !canonicalUrl
    || typeof value.addControlActionable !== "boolean"
    || typeof value.securityChallenge !== "boolean") {
    throw new Error("The retailer observer returned invalid evidence.");
  }
  const unitPriceCents = value.unitPriceCents === null ? null : Number(value.unitPriceCents);
  if (unitPriceCents !== null && (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0)) {
    throw new Error("The retailer observer returned invalid price evidence.");
  }
  const selectedOffer = selectedOfferPayload(value.selectedOffer, retailerSku);
  return {
    adapterVersion: expectedVersion,
    contractVersion: 1,
    observedAt: String(value.observedAt || ""),
    pageKind: "product",
    retailerId,
    retailerSku,
    canonicalUrl,
    availability,
    unitPriceCents,
    currency: "USD",
    sellerName: String(value.sellerName || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160),
    sellerType,
    fulfillment,
    addControlActionable: value.addControlActionable,
    securityChallenge: value.securityChallenge,
    interactiveBlock,
    purchaseRouteKind,
    purchaseRouteReady: retailerId === "amazon" && value.purchaseRouteReady === true,
    routeReasonCode,
    selectedOffer
  };
}

const WALMART_DRAW_OUTCOMES = new Set(["passed", "partial", "failed", "manual"]);
const WALMART_DRAW_STATES = new Set(["active", "upcoming", "closed", "unknown"]);
const WALMART_DRAW_REASONS = new Set([
  "verified", "no_active_drawings", "draw_binding_incomplete", "security_challenge",
  "interactive_auth", "interactive_mfa", "interactive_location", "interactive_membership",
  "interactive_queue", "interactive_unknown", "draw_module_missing", "draw_payload_missing",
  "observer_bundle_injection_failed", "observer_execution_failed", "observer_top_frame_missing",
  "observer_runtime_unavailable", "observer_collection_failed", "observer_contract_invalid"
]);

function walmartDrawNullableInteger(value, minimum, maximum) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error("The Walmart Draw observer returned invalid bounded evidence.");
  }
  return number;
}

function walmartDrawScanPayload(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) {
    throw new Error("The Walmart Draw observer returned no scan evidence.");
  }
  const outcome = String(value.outcome || "");
  const reasonCode = String(value.reasonCode || "").toLocaleLowerCase("en-US");
  const interactiveBlock = ["", "auth", "mfa", "location", "membership", "queue", "high_demand", "unknown"].includes(value.interactiveBlock)
    ? value.interactiveBlock : "unknown";
  const expectedCardCount = Number(value.expectedCardCount);
  const observedCardCount = Number(value.observedCardCount);
  const observedTime = new Date(String(value.observedAt || "")).getTime();
  if (value.adapterVersion !== WALMART_DRAW_OBSERVER_VERSION
    || value.contractVersion !== 1
    || value.pageKind !== "walmart_draw_hub"
    || !WALMART_DRAW_OUTCOMES.has(outcome)
    || !WALMART_DRAW_REASONS.has(reasonCode)
    || !Number.isFinite(observedTime)
    || !Number.isInteger(expectedCardCount) || expectedCardCount < 0 || expectedCardCount > 24
    || !Number.isInteger(observedCardCount) || observedCardCount < 0 || observedCardCount > 24
    || expectedCardCount < observedCardCount
    || value.items.length !== observedCardCount
    || typeof value.securityChallenge !== "boolean") {
    throw new Error("The Walmart Draw observer returned invalid scan evidence.");
  }
  const reasonMatches = outcome === "passed" ? ["verified", "no_active_drawings"].includes(reasonCode)
    : outcome === "partial" ? reasonCode === "draw_binding_incomplete"
      : outcome === "manual" ? reasonCode === "security_challenge" || reasonCode.startsWith("interactive_")
        : ["draw_module_missing", "draw_payload_missing"].includes(reasonCode) || reasonCode.startsWith("observer_");
  const expectedInteractiveReason = interactiveBlock ? `interactive_${interactiveBlock}` : "";
  if (!reasonMatches
    || value.securityChallenge !== (reasonCode === "security_challenge")
    || (outcome !== "manual" && interactiveBlock !== "")
    || (outcome === "manual" && reasonCode !== "security_challenge" && reasonCode !== expectedInteractiveReason)
    || (reasonCode === "security_challenge" && interactiveBlock !== "")
    || (["failed", "manual"].includes(outcome) && observedCardCount !== 0)) {
    throw new Error("The Walmart Draw observer returned inconsistent scan evidence.");
  }
  const seen = new Set();
  const items = value.items.map((item) => {
    if (!item || typeof item !== "object") throw new Error("The Walmart Draw observer returned an invalid item.");
    const retailerSku = String(item.retailerSku || "");
    const title = String(item.title || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
    const sellerName = String(item.sellerName || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    const unitPriceCents = item.unitPriceCents === null ? null : Number(item.unitPriceCents);
    const closeTime = item.closesAt === null ? null : new Date(String(item.closesAt || "")).getTime();
    if (!/^\d{5,20}$/.test(retailerSku) || seen.has(retailerSku) || !title
      || (unitPriceCents !== null && (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 || unitPriceCents > 100_000_000))
      || item.currency !== "USD"
      || !["first_party", "third_party", "unknown"].includes(item.sellerType)
      || !WALMART_DRAW_STATES.has(item.drawState)
      || (item.sellerType === "third_party" && !sellerName)
      || (item.closesAt !== null && !Number.isFinite(closeTime))
      || typeof item.drawControlPresent !== "boolean"
      || typeof item.addControlSuppressed !== "boolean") {
      throw new Error("The Walmart Draw observer returned invalid item evidence.");
    }
    seen.add(retailerSku);
    return {
      retailerSku,
      title,
      unitPriceCents,
      currency: "USD",
      sellerName: item.sellerType === "first_party" ? "Walmart" : sellerName,
      sellerType: item.sellerType,
      drawState: item.drawState,
      closesAt: item.closesAt === null ? null : new Date(closeTime).toISOString(),
      conditionCode: walmartDrawNullableInteger(item.conditionCode, 0, 9_999_999),
      conditionGroupCode: walmartDrawNullableInteger(item.conditionGroupCode, 0, 9_999),
      orderMinLimit: walmartDrawNullableInteger(item.orderMinLimit, 1, 99),
      orderMaxLimit: walmartDrawNullableInteger(item.orderMaxLimit, 1, 99),
      drawControlPresent: item.drawControlPresent,
      addControlSuppressed: item.addControlSuppressed
    };
  });
  return {
    adapterVersion: WALMART_DRAW_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt: new Date(observedTime).toISOString(),
    pageKind: "walmart_draw_hub",
    outcome,
    reasonCode,
    expectedCardCount,
    observedCardCount,
    securityChallenge: value.securityChallenge,
    interactiveBlock,
    items
  };
}

function walmartDrawFailurePayload(reasonCode) {
  return walmartDrawScanPayload({
    adapterVersion: WALMART_DRAW_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt: new Date().toISOString(),
    pageKind: "walmart_draw_hub",
    outcome: "failed",
    reasonCode,
    expectedCardCount: 0,
    observedCardCount: 0,
    securityChallenge: false,
    interactiveBlock: "",
    items: []
  });
}

async function postWalmartDrawScan(device, scan) {
  const payload = walmartDrawScanPayload(scan);
  return request("/devices/self/walmart-draw/scans", {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify(payload)
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
}

async function reportWalmartDrawFailure(device, reasonCode) {
  try {
    return await postWalmartDrawScan(device, walmartDrawFailurePayload(reasonCode));
  } catch {
    return null;
  }
}

const DIAGNOSTIC_OPERATIONS = new Set(["observe", "rehearse_add", "live_add"]);
const DIAGNOSTIC_OUTCOMES = new Set(["passed", "failed", "rejected", "recovered"]);
const DIAGNOSTIC_STAGES = new Set([
  "complete", "page_identity", "interactive_block", "availability_binding", "add_control", "sku_binding",
  "offer_binding", "price_binding", "seller_binding", "fulfillment_binding",
  "quantity_binding", "route_binding", "policy", "runner"
]);
const DIAGNOSTIC_SCOPE_KINDS = new Set(["none", "form", "buybox", "qualified_buybox", "accordion", "other"]);
const DIAGNOSTIC_SELLER_SHAPES = new Set(["none", "legacy", "offer_display_combined", "offer_display_split"]);
const DIAGNOSTIC_FULFILLMENT_SHAPES = new Set(["none", "shipping", "pickup", "mixed"]);
const DIAGNOSTIC_BLOCKS = new Set(["", "auth", "mfa", "location", "membership", "queue", "high_demand", "unknown"]);
const DIAGNOSTIC_REPAIR_LANDMARK_ATTRIBUTES = new Set([
  "data-testid", "data-test-id", "data-automation-id", "data-button-state", "name", "itemprop"
]);
const DIAGNOSTIC_REPAIR_LANDMARK_ELEMENTS = new Set([
  "button", "input", "role_button", "div", "span", "p", "label", "section", "li"
]);
const DIAGNOSTIC_REPAIR_CONTROL_ELEMENTS = new Set(["button", "input", "role_button"]);
const DIAGNOSTIC_REPAIR_FIELDS = new Set([
  "availability", "unitPrice", "seller", "fulfillment", "addControl"
]);
const DIAGNOSTIC_REPAIR_LANDMARK_TOKENS = new Set([
  "pdp", "product", "detail", "buy", "box", "fulfillment", "shipping", "delivery",
  "primary", "main", "add", "to", "cart", "bag", "pre", "preorder", "order",
  "button", "btn", "control", "atc", "submit", "action", "purchase", "state",
  "available", "availability", "unavailable", "inventory", "stock", "in", "out", "sold",
  "price", "amount", "cost", "current", "customer", "sale", "offer", "value",
  "seller", "merchant", "vendor", "display", "name", "by", "fulfilled",
  "ship", "pickup", "pick", "up", "store", "method", "option", "selected",
  "status", "label", "message", "info", "commerce"
]);
const DIAGNOSTIC_REPAIR_LANDMARK_INTENT = {
  availability: /(?:availability|available|unavailable|inventory|stock|sold[_.:-]?out|pre[_.:-]?order)/i,
  unitPrice: /(?:price|amount|cost|sale[_.:-]?price|customer[_.:-]?price|offer[_.:-]?price)/i,
  seller: /(?:seller|merchant|vendor|sold[_.:-]?by)/i,
  fulfillment: /(?:fulfillment|shipping|delivery|pickup|pick[_.:-]?up|ship[_.:-]?to)/i,
  addControl: /(?:add|cart|bag|pre[_.:-]?order|atc)/i
};
const DIAGNOSTIC_REPAIR_COUNT_FIELDS = {
  availability: "genericAvailabilityCandidateCount",
  unitPrice: "genericPriceCandidateCount",
  seller: "genericSellerCandidateCount",
  fulfillment: "genericFulfillmentCandidateCount"
};
const DIAGNOSTIC_REPAIR_SELECTOR_MISS_REASONS = new Set([
  "availability_selector_miss", "add_control_selector_miss", "price_selector_miss",
  "seller_selector_miss", "fulfillment_selector_miss"
]);
const DIAGNOSTIC_REPAIR_REASON_FIELDS = {
  availability_selector_miss: "availability",
  add_control_selector_miss: "addControl",
  price_selector_miss: "unitPrice",
  seller_selector_miss: "seller",
  fulfillment_selector_miss: "fulfillment"
};
const DIAGNOSTIC_REPAIR_REASON_STAGES = {
  availability_selector_miss: "availability_binding",
  add_control_selector_miss: "add_control",
  price_selector_miss: "price_binding",
  seller_selector_miss: "seller_binding",
  fulfillment_selector_miss: "fulfillment_binding"
};
const DIAGNOSTIC_COUNT_FIELDS = [
  "addControlCount", "genericAddIntentCount", "scopedControlCount", "explicitSkuInputCount", "exactSkuInputCount",
  "variationSkuCount", "canonicalOfferInputCount", "canonicalOfferDistinctCount",
  "alternateOfferInputCount", "alternateOfferDistinctCount", "priceCandidateCount", "quantityControlCount"
];
const OBSERVER_RUNTIME_FAILURE_REASONS = new Set([
  "observer_bundle_injection_failed",
  "observer_execution_failed",
  "observer_top_frame_missing",
  "observer_runtime_unavailable",
  "observer_collection_failed",
  "observer_contract_invalid"
]);
const DIAGNOSTIC_REASON_CODES = new Set([
  "verified", "dom_hydration_recovered",
  ...OBSERVER_RUNTIME_FAILURE_REASONS,
  "product_identity_missing", "security_challenge",
  "interactive_auth", "interactive_mfa", "interactive_location", "interactive_membership",
  "interactive_queue", "interactive_high_demand", "interactive_unknown",
  "availability_selector_miss",
  "add_control_selector_miss", "add_control_missing", "add_control_ambiguous", "add_control_disabled",
  "explicit_sku_binding_missing", "explicit_sku_binding_ambiguous",
  "offer_binding_missing", "offer_binding_ambiguous", "price_selector_miss", "price_binding_missing",
  "seller_selector_miss", "seller_binding_missing", "fulfillment_selector_miss", "fulfillment_binding_missing",
  "selected_offer_binding_unresolved",
  "offer_scope_not_actionable",
  "not_applicable", "offer_not_actionable", "offer_id_missing_or_ambiguous",
  "offer_route_verified", "route_validation_failed", "route_binding_failed",
  "rehearsal_failed", "runner_unavailable", "runner_failed", "runner_no_result",
  "adapter_version_mismatch", "unsupported_action", "quantity_not_supported",
  "seller_policy_not_supported", "fulfillment_not_supported", "contract_version_mismatch",
  "job_identity_invalid", "canonical_url_invalid", "quantity_invalid", "unit_cap_invalid",
  "total_cap_invalid", "job_expired", "offer_stale", "listing_mismatch",
  "product_page_unverified", "manual_action_required", "preorder_not_supported", "out_of_stock", "add_control_unavailable",
  "currency_mismatch", "seller_unverified", "third_party_seller", "signal_seller_mismatch",
  "price_unavailable", "over_unit_cap", "fulfillment_unverified", "authorization_missing",
  "authorization_expired", "add_control_changed", "offer_binding_changed", "click_failed",
  "offer_unverified", "click_uncertain", "cart_page_unverified", "cart_unverified",
  "foreign_cart_line", "verified_empty", "cart_evidence_stale", "offer_proof_mismatch",
  "quantity_unavailable", "clicked"
]);

function diagnosticCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 50) throw new Error("The retailer diagnostic contains an invalid bounded count.");
  return count;
}

function diagnosticRepairLandmarks(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5) {
    throw new Error("The retailer diagnostic contains invalid repair landmarks.");
  }
  const seen = new Set();
  return value.map((landmark) => {
    if (!landmark || typeof landmark !== "object"
      || !DIAGNOSTIC_REPAIR_FIELDS.has(landmark.field)
      || !DIAGNOSTIC_REPAIR_LANDMARK_ELEMENTS.has(landmark.elementKind)
      || (landmark.field === "addControl" && !DIAGNOSTIC_REPAIR_CONTROL_ELEMENTS.has(landmark.elementKind))
      || (landmark.field !== "addControl" && landmark.elementKind === "input")
      || !DIAGNOSTIC_REPAIR_LANDMARK_ATTRIBUTES.has(landmark.attribute)) {
      throw new Error("The retailer diagnostic contains an invalid repair landmark.");
    }
    const normalized = String(landmark.value || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_.:-]{1,63}$/.test(normalized)
      || !DIAGNOSTIC_REPAIR_LANDMARK_INTENT[landmark.field].test(normalized)
      || /(?:checkout|buy[_.:-]?now|place[_.:-]?order|submit[_.:-]?order|payment|credit|debit|address|email|phone|account|password|cookie|csrf|token)/i.test(normalized)
      || !normalized.split(/[_.:-]+/).filter(Boolean)
        .every((token) => DIAGNOSTIC_REPAIR_LANDMARK_TOKENS.has(token.toLocaleLowerCase("en-US")))
      || /\d{4,}|[a-f0-9]{12,}/i.test(normalized)) {
      throw new Error("The retailer diagnostic repair landmark is not privacy bounded.");
    }
    const key = `${landmark.field}:${landmark.elementKind}:${landmark.attribute}:${normalized}`;
    if (seen.has(key)) throw new Error("The retailer diagnostic contains duplicate repair landmarks.");
    seen.add(key);
    return {
      field: landmark.field,
      elementKind: landmark.elementKind,
      attribute: landmark.attribute,
      value: normalized
    };
  });
}

function retailerDiagnosticPayload(value, retailerId, overrides = {}) {
  if (!value || typeof value !== "object" || !value.layout || typeof value.layout !== "object") {
    throw new Error("The retailer observer returned no adapter diagnostic.");
  }
  const operation = String(overrides.operation || value.operation || "");
  const outcome = String(overrides.outcome || value.outcome || "");
  const failureStage = String(overrides.failureStage || value.failureStage || "");
  const reasonCode = safeReasonCode(overrides.reasonCode || value.reasonCode);
  const expectedAdapterVersion = operation === "observe"
    ? RETAILER_OBSERVER_VERSIONS[retailerId]
    : ADD_LANES[retailerId]?.adapterVersion;
  if (!DIAGNOSTIC_OPERATIONS.has(operation)
    || !DIAGNOSTIC_OUTCOMES.has(outcome)
    || !DIAGNOSTIC_STAGES.has(failureStage)
    || !DIAGNOSTIC_REASON_CODES.has(reasonCode)
    || !expectedAdapterVersion
    || ((outcome === "passed") !== (failureStage === "complete"))) {
    throw new Error("The retailer observer returned an invalid adapter diagnostic.");
  }
  if (DIAGNOSTIC_REPAIR_SELECTOR_MISS_REASONS.has(reasonCode)
    && failureStage !== DIAGNOSTIC_REPAIR_REASON_STAGES[reasonCode]) {
    throw new Error("The retailer observer returned an inconsistent selector-miss diagnostic.");
  }
  const layout = value.layout;
  if (layout.schemaVersion !== 1
    || !["product", "other"].includes(layout.pageKind)
    || !DIAGNOSTIC_SCOPE_KINDS.has(layout.scopeKind)
    || !DIAGNOSTIC_SELLER_SHAPES.has(layout.sellerShape)
    || !DIAGNOSTIC_FULFILLMENT_SHAPES.has(layout.fulfillmentShape)
    || !DIAGNOSTIC_BLOCKS.has(layout.interactiveBlock)
    || typeof layout.securityChallenge !== "boolean") {
    throw new Error("The retailer observer returned invalid structural diagnostic evidence.");
  }
  const counts = Object.fromEntries(DIAGNOSTIC_COUNT_FIELDS.map((field) => [field, diagnosticCount(layout[field])]));
  const repairCandidateCounts = Object.fromEntries(Object.values(DIAGNOSTIC_REPAIR_COUNT_FIELDS)
    .map((field) => [field, diagnosticCount(layout[field] ?? 0)]));
  const repairLandmarks = diagnosticRepairLandmarks(layout.repairLandmarks);
  if (repairLandmarks.length && (
    layout.pageKind !== "product"
    || layout.securityChallenge !== false
    || layout.interactiveBlock !== ""
  )) {
    throw new Error("The retailer diagnostic repair landmark does not describe an unblocked selector miss.");
  }
  for (const landmark of repairLandmarks) {
    const count = landmark.field === "addControl"
      ? counts.genericAddIntentCount
      : repairCandidateCounts[DIAGNOSTIC_REPAIR_COUNT_FIELDS[landmark.field]];
    if (count < 1) throw new Error("The retailer diagnostic repair landmark lacks matching structural evidence.");
  }
  const repairEvidenceAllowed = operation === "observe" && (
    (outcome === "failed" && DIAGNOSTIC_REPAIR_SELECTOR_MISS_REASONS.has(reasonCode))
    || (outcome === "recovered" && reasonCode === "dom_hydration_recovered")
  );
  if (repairLandmarks.length && !repairEvidenceAllowed) {
    throw new Error("The retailer diagnostic repair landmark is outside a selector-miss result.");
  }
  const requiredRepairField = DIAGNOSTIC_REPAIR_REASON_FIELDS[reasonCode];
  if (requiredRepairField && requiredRepairField !== "addControl"
    && !repairLandmarks.some((landmark) => landmark.field === requiredRepairField)) {
    throw new Error("The retailer diagnostic selector miss lacks its matching landmark.");
  }
  const attemptCount = Number(overrides.attemptCount ?? value.attemptCount);
  const domChanged = overrides.domChanged === undefined ? value.domChanged === true : overrides.domChanged === true;
  if (!Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount > 3
    || (outcome === "recovered" && attemptCount < 2)) {
    throw new Error("The retailer observer returned invalid retry diagnostic evidence.");
  }
  return {
    contractVersion: 1,
    observedAt: String(overrides.observedAt || value.observedAt || ""),
    retailerId,
    retailerSku: String(value.retailerSku || "").toUpperCase(),
    adapterVersion: expectedAdapterVersion,
    operation,
    outcome,
    failureStage,
    reasonCode,
    attemptCount,
    domChanged,
    layout: {
      schemaVersion: 1,
      pageKind: layout.pageKind,
      scopeKind: layout.scopeKind,
      sellerShape: layout.sellerShape,
      fulfillmentShape: layout.fulfillmentShape,
      ...counts,
      ...Object.fromEntries(Object.entries(repairCandidateCounts).filter(([, count]) => count > 0)),
      securityChallenge: layout.securityChallenge,
      interactiveBlock: layout.interactiveBlock,
      ...(repairLandmarks.length ? { repairLandmarks } : {})
    }
  };
}

async function sendRetailerDiagnostic(device, diagnostic) {
  const payload = retailerDiagnosticPayload(diagnostic, diagnostic.retailerId);
  return request(`/devices/self/adapter-diagnostics/${encodeURIComponent(payload.retailerId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify(payload)
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
}

function adapterDiagnosticRetryable(error) {
  const status = Number(error?.status || 0);
  return !status || status >= 500 || [408, 429].includes(status);
}

function withAdapterDiagnosticQueueLock(work) {
  const next = adapterDiagnosticQueueLock.then(work, work);
  adapterDiagnosticQueueLock = next.then(() => undefined, () => undefined);
  return next;
}

function queuedAdapterDiagnostic(value, now = Date.now()) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !/^[A-Za-z0-9_-]{3,160}$/.test(String(value.deviceId || ""))) return null;
    const diagnostic = retailerDiagnosticPayload(value.diagnostic, value.diagnostic?.retailerId);
    const observedAt = new Date(diagnostic.observedAt).getTime();
    if (!Number.isFinite(observedAt)
      || observedAt > now + 5 * 60_000
      || now - observedAt > ADAPTER_DIAGNOSTIC_QUEUE_MAX_AGE_MS) return null;
    return { deviceId: String(value.deviceId), diagnostic };
  } catch {
    return null;
  }
}

async function readAdapterDiagnosticQueueUnlocked(now = Date.now()) {
  const stored = (await chrome.storage.local.get(ADAPTER_DIAGNOSTIC_QUEUE_KEY))[ADAPTER_DIAGNOSTIC_QUEUE_KEY];
  if (!Array.isArray(stored)) return [];
  const normalized = stored
    .map((entry) => queuedAdapterDiagnostic(entry, now))
    .filter(Boolean);
  const identities = new Set();
  const unique = [];
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const entry = normalized[index];
    const identity = adapterDiagnosticQueueIdentity(entry);
    if (identities.has(identity)) continue;
    identities.add(identity);
    unique.unshift(entry);
  }
  return unique.slice(-ADAPTER_DIAGNOSTIC_QUEUE_LIMIT);
}

function adapterDiagnosticQueueIdentity(entry) {
  return `${entry.deviceId}:${JSON.stringify(entry.diagnostic)}`;
}

async function enqueueAdapterDiagnostic(device, diagnostic) {
  const payload = retailerDiagnosticPayload(diagnostic, diagnostic.retailerId);
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(String(device?.id || ""))) return null;
  return withAdapterDiagnosticQueueLock(async () => {
    const current = await readAdapterDiagnosticQueueUnlocked();
    const entry = { deviceId: String(device.id), diagnostic: payload };
    const identity = adapterDiagnosticQueueIdentity(entry);
    const next = [
      ...current.filter((item) => adapterDiagnosticQueueIdentity(item) !== identity),
      entry
    ].slice(-ADAPTER_DIAGNOSTIC_QUEUE_LIMIT);
    await chrome.storage.local.set({ [ADAPTER_DIAGNOSTIC_QUEUE_KEY]: next });
    return entry;
  });
}

async function postRetailerDiagnostic(device, diagnostic) {
  const payload = retailerDiagnosticPayload(diagnostic, diagnostic.retailerId);
  try {
    return await sendRetailerDiagnostic(device, payload);
  } catch (error) {
    if (adapterDiagnosticRetryable(error)) await enqueueAdapterDiagnostic(device, payload);
    throw error;
  }
}

async function drainAdapterDiagnosticQueue() {
  if (adapterDiagnosticDrainPromise) return adapterDiagnosticDrainPromise;
  adapterDiagnosticDrainPromise = withAdapterDiagnosticQueueLock(async () => {
    const current = await readAdapterDiagnosticQueueUnlocked();
    const device = await storedDevice();
    if (!device?.id || !device?.token) {
      await chrome.storage.local.set({ [ADAPTER_DIAGNOSTIC_QUEUE_KEY]: current });
      return { delivered: 0, pending: current.length };
    }
    const deliverable = current.filter((entry) => entry.deviceId === device.id);
    let delivered = 0;
    let remaining = [];
    for (let index = 0; index < deliverable.length; index += 1) {
      const entry = deliverable[index];
      try {
        await sendRetailerDiagnostic(device, entry.diagnostic);
        delivered += 1;
      } catch (error) {
        if (adapterDiagnosticRetryable(error)) {
          remaining = deliverable.slice(index);
          break;
        }
      }
    }
    await chrome.storage.local.set({ [ADAPTER_DIAGNOSTIC_QUEUE_KEY]: remaining });
    return { delivered, pending: remaining.length };
  }).finally(() => { adapterDiagnosticDrainPromise = null; });
  return adapterDiagnosticDrainPromise;
}

function observerRuntimeFailureDiagnostic(identity, reasonCode, attemptCount = 1, domChanged = false) {
  if (!identity || !OBSERVER_RUNTIME_FAILURE_REASONS.has(reasonCode)) {
    throw new Error("The observer runtime failure reason is unsupported.");
  }
  const zeroCounts = Object.fromEntries(DIAGNOSTIC_COUNT_FIELDS.map((field) => [field, 0]));
  return retailerDiagnosticPayload({
    contractVersion: 1,
    observedAt: new Date().toISOString(),
    retailerId: identity.retailerId,
    retailerSku: identity.retailerSku,
    adapterVersion: RETAILER_OBSERVER_VERSIONS[identity.retailerId],
    operation: "observe",
    outcome: "failed",
    failureStage: "runner",
    reasonCode,
    attemptCount,
    domChanged,
    layout: {
      schemaVersion: 1,
      pageKind: "product",
      scopeKind: "none",
      sellerShape: "none",
      fulfillmentShape: "none",
      ...zeroCounts,
      securityChallenge: false,
      interactiveBlock: ""
    }
  }, identity.retailerId);
}

async function reportObserverRuntimeFailure(device, identity, reasonCode, attemptCount = 1, domChanged = false) {
  try {
    return await postRetailerDiagnostic(
      device,
      observerRuntimeFailureDiagnostic(identity, reasonCode, attemptCount, domChanged)
    );
  } catch {
    // Runtime telemetry is best effort and must never replace the original,
    // bounded inspection failure shown to the user.
    return null;
  }
}

function operationDiagnostic(base, retailerId, operation, outcome, failureStage, reasonCode) {
  return retailerDiagnosticPayload(base, retailerId, {
    operation,
    outcome,
    failureStage,
    reasonCode,
    observedAt: new Date().toISOString(),
    attemptCount: base.attemptCount || 1,
    domChanged: base.domChanged === true
  });
}

const EXPECTED_LIVE_REJECTIONS = new Set([
  "manual_action_required", "preorder_not_supported", "out_of_stock", "third_party_seller", "signal_seller_mismatch",
  "over_unit_cap", "fulfillment_not_supported", "seller_policy_not_supported",
  "quantity_not_supported", "unsupported_action", "job_expired"
]);

function runnerFailureStage(reasonCode) {
  if (["offer_id_missing_or_ambiguous", "offer_binding_changed"].includes(reasonCode)) return "offer_binding";
  if (["add_control_unavailable", "add_control_changed"].includes(reasonCode)) return "add_control";
  if (reasonCode === "seller_unverified") return "seller_binding";
  if (reasonCode === "price_unavailable") return "price_binding";
  if (reasonCode === "fulfillment_unverified") return "fulfillment_binding";
  if (["listing_mismatch", "product_page_unverified"].includes(reasonCode)) return "page_identity";
  if (reasonCode === "manual_action_required") return "interactive_block";
  if (EXPECTED_LIVE_REJECTIONS.has(reasonCode)) return "policy";
  return "runner";
}

async function recordTabOperationDiagnostic(tabId, retailerId, operation, outcome, failureStage, reasonCode) {
  if (retailerId === "target" || !["walmart", "amazon", "bestbuy"].includes(retailerId)) return null;
  const device = await storedDevice();
  if (!device?.token) throw new Error("The paired Chrome device is unavailable for adapter diagnostics.");
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: ["retailer-shadow.js"]
  });
  const injections = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: [retailerId],
    func: (exactRetailerId) => {
      try {
        const observer = globalThis.YoinkRetailerShadow;
        if (!observer || typeof observer.collectRetailerShadowAttempt !== "function") {
          return { ok: false, message: "The retailer shadow observer is unavailable." };
        }
        return { ok: true, diagnostic: observer.collectRetailerShadowAttempt(document, location.href, exactRetailerId, "either").diagnostic };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "The retailer diagnostic could not be collected." };
      }
    }
  });
  const result = injections.find((entry) => entry.frameId === 0)?.result;
  if (!result?.ok) throw new Error(result?.message || "The retailer diagnostic could not be collected.");
  const diagnostic = operationDiagnostic(result.diagnostic, retailerId, operation, outcome, failureStage, reasonCode);
  return postRetailerDiagnostic(device, diagnostic);
}

async function request(path, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
      headers: options.body
        ? { "Content-Type": "application/json", ...(options.headers || {}) }
        : options.headers
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `Yoink returned HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Yoink did not acknowledge the companion request before its safety timeout.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function base64urlBytes(value) {
  const encoded = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function stableHashHex(...parts) {
  let framed = "";
  for (const part of parts) {
    const value = part === null || part === undefined ? "" : String(part);
    framed += `${new TextEncoder().encode(value).length}:${value}|`;
  }
  return sha256Hex(framed);
}

function exactObjectKeys(value, expected) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("The observer recipe trust payload is not canonical JSON.");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

async function verifyEd25519(publicKeySpki, signature, message) {
  try {
    const publicKey = await crypto.subtle.importKey(
      "spki",
      base64urlBytes(publicKeySpki),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      base64urlBytes(signature),
      new TextEncoder().encode(message)
    );
  } catch {
    return false;
  }
}

async function normalizedObserverRecipeTrustManifest(value, root, now) {
  if (!exactObjectKeys(value, ["algorithm", "rootKeyId", "payload", "signature"])
    || value.algorithm !== "Ed25519" || value.rootKeyId !== root.keyId
    || !/^[A-Za-z0-9_-]{80,120}$/.test(String(value.signature || ""))) {
    throw new Error("The observer recipe trust manifest envelope is invalid.");
  }
  const payload = value.payload;
  if (!exactObjectKeys(payload, [
    "contractVersion", "generation", "rootKeyId", "issuedAt", "expiresAt",
    "previousManifestHash", "keys", "revokedKeyIds"
  ]) || payload.contractVersion !== 1 || payload.rootKeyId !== root.keyId
    || !Number.isSafeInteger(payload.generation) || payload.generation < 1
    || !Array.isArray(payload.keys) || payload.keys.length < 1 || payload.keys.length > 8
    || !Array.isArray(payload.revokedKeyIds) || payload.revokedKeyIds.length > 32) {
    throw new Error("The observer recipe trust manifest payload is invalid.");
  }
  const issuedAt = new Date(payload.issuedAt).getTime();
  const expiresAt = new Date(payload.expiresAt).getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now + 5 * 60_000
    || expiresAt <= issuedAt || expiresAt - issuedAt > 400 * 24 * 60 * 60_000) {
    throw new Error("The observer recipe trust manifest lifetime is invalid.");
  }
  const revokedKeyIds = payload.revokedKeyIds.map((keyId) => String(keyId));
  if (new Set(revokedKeyIds).size !== revokedKeyIds.length
    || revokedKeyIds.some((keyId) => !/^[a-f0-9]{64}$/.test(keyId))) {
    throw new Error("The observer recipe trust revocation set is invalid.");
  }
  const seen = new Set();
  const keys = [];
  for (const key of payload.keys) {
    if (!exactObjectKeys(key, [
      "algorithm", "keyId", "publicKeySpki", "usage", "status", "notBefore", "notAfter"
    ]) || key.algorithm !== "Ed25519" || key.usage !== "observer_recipe_signing"
      || !["active", "retired"].includes(key.status)
      || !/^[a-f0-9]{64}$/.test(String(key.keyId || ""))
      || !/^[A-Za-z0-9_-]{40,120}$/.test(String(key.publicKeySpki || ""))
      || seen.has(key.keyId)
      || await sha256Hex(base64urlBytes(key.publicKeySpki)) !== key.keyId) {
      throw new Error("The observer recipe intermediate-key manifest is invalid.");
    }
    const notBefore = new Date(key.notBefore).getTime();
    const notAfter = new Date(key.notAfter).getTime();
    if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || notBefore > now + 5 * 60_000
      || notAfter <= notBefore) {
      throw new Error("The observer recipe intermediate-key lifetime is invalid.");
    }
    seen.add(key.keyId);
    keys.push({ ...key });
  }
  const activeKeys = keys.filter((key) => key.status === "active" && !revokedKeyIds.includes(key.keyId));
  if (activeKeys.length !== 1) {
    throw new Error("The observer recipe trust manifest must identify exactly one unrevoked active key.");
  }
  if (!await verifyEd25519(root.publicKeySpki, value.signature, canonicalJson(payload))) {
    throw new Error("The observer recipe trust manifest root signature is invalid.");
  }
  const manifestHash = await sha256Hex(`yoink-observer-recipe-trust-manifest-v1|${canonicalJson(value)}`);
  return {
    manifest: value,
    manifestHash,
    issuedAt,
    expiresAt,
    activeKey: activeKeys[0],
    keys,
    revokedKeyIds
  };
}

async function verifiedObserverRecipeTrust(value) {
  const now = Date.now();
  const root = ObserverRecipeRoot;
  if (!exactObjectKeys(root, ["algorithm", "keyId", "minimumManifestGeneration", "publicKeySpki"])
    || root.algorithm !== "Ed25519" || !/^[a-f0-9]{64}$/.test(String(root.keyId || ""))
    || !Number.isSafeInteger(root.minimumManifestGeneration) || root.minimumManifestGeneration < 1
    || !/^[A-Za-z0-9_-]{40,120}$/.test(String(root.publicKeySpki || ""))
    || await sha256Hex(base64urlBytes(root.publicKeySpki)) !== root.keyId) {
    throw new Error("The packaged observer recipe root is invalid.");
  }
  if (!exactObjectKeys(value, [
    "contractVersion", "rootKeyId", "manifestHash", "manifest", "manifestChain", "transparencyReceipt"
  ]) || value.contractVersion !== 1 || value.rootKeyId !== root.keyId
    || !/^[a-f0-9]{64}$/.test(String(value.manifestHash || ""))
    || !Array.isArray(value.manifestChain) || value.manifestChain.length < 1 || value.manifestChain.length > 128) {
    throw new Error("The observer recipe rooted trust bundle is invalid.");
  }
  const chain = [];
  for (const manifest of value.manifestChain) {
    chain.push(await normalizedObserverRecipeTrustManifest(manifest, root, now));
  }
  for (let index = 0; index < chain.length; index += 1) {
    const current = chain[index];
    const previous = chain[index - 1];
    if (!previous) {
      if (current.manifest.payload.generation !== 1 || current.manifest.payload.previousManifestHash !== "") {
        throw new Error("The observer recipe trust chain does not begin at generation one.");
      }
      continue;
    }
    const payload = current.manifest.payload;
    if (payload.generation !== previous.manifest.payload.generation + 1
      || payload.previousManifestHash !== previous.manifestHash
      || current.issuedAt < previous.issuedAt
      || previous.revokedKeyIds.some((keyId) => !current.revokedKeyIds.includes(keyId))) {
      throw new Error("The observer recipe trust chain is not monotonic.");
    }
    const known = new Set([...current.keys.map((key) => key.keyId), ...current.revokedKeyIds]);
    if (previous.keys.some((key) => !known.has(key.keyId))) {
      throw new Error("The observer recipe trust chain silently removed a prior key.");
    }
  }
  const current = chain.at(-1);
  if (!current || current.manifest.payload.generation < root.minimumManifestGeneration
    || current.manifestHash !== value.manifestHash
    || canonicalJson(current.manifest) !== canonicalJson(value.manifest)
    || current.expiresAt <= now
    || new Date(current.activeKey.notBefore).getTime() > now + 5 * 60_000
    || new Date(current.activeKey.notAfter).getTime() <= now
    || new Date(current.activeKey.notAfter).getTime() > current.expiresAt) {
    throw new Error("The current observer recipe trust manifest is unavailable or expired.");
  }
  const receipt = value.transparencyReceipt;
  if (!exactObjectKeys(receipt, [
    "sequence", "eventType", "manifestGeneration", "manifestHash", "signingKeyId",
    "subjectHash", "previousEventHash", "eventHash", "createdAt"
  ])) throw new Error("The observer recipe transparency receipt is invalid.");
  const expectedEventHash = await stableHashHex(
    "observer-recipe-transparency-v1",
    receipt.sequence,
    receipt.eventType,
    receipt.manifestGeneration,
    receipt.manifestHash,
    receipt.signingKeyId,
    receipt.subjectHash,
    receipt.previousEventHash,
    receipt.createdAt
  );
  if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1
    || receipt.eventType !== "manifest_installed"
    || receipt.manifestGeneration !== current.manifest.payload.generation
    || receipt.manifestHash !== current.manifestHash || receipt.subjectHash !== current.manifestHash
    || receipt.signingKeyId !== current.activeKey.keyId
    || !/^(?:|[a-f0-9]{64})$/.test(String(receipt.previousEventHash || ""))
    || !/^[a-f0-9]{64}$/.test(String(receipt.eventHash || ""))
    || receipt.eventHash !== expectedEventHash
    || !Number.isFinite(new Date(receipt.createdAt).getTime())
    || new Date(receipt.createdAt).getTime() > now + 5 * 60_000) {
    throw new Error("The observer recipe transparency receipt is invalid.");
  }
  const stored = (await chrome.storage.local.get(OBSERVER_RECIPE_TRUST_STATE_KEY))[OBSERVER_RECIPE_TRUST_STATE_KEY];
  if (stored) {
    if (stored.rootKeyId !== root.keyId || !Number.isSafeInteger(stored.generation)
      || !/^[a-f0-9]{64}$/.test(String(stored.manifestHash || ""))) {
      throw new Error("The stored observer recipe trust state is invalid.");
    }
    if (current.manifest.payload.generation < stored.generation) {
      throw new Error("The observer recipe trust manifest was rolled back.");
    }
    if (current.manifest.payload.generation === stored.generation && current.manifestHash !== stored.manifestHash) {
      throw new Error("The observer recipe trust manifest conflicts with the pinned generation.");
    }
    if (current.manifest.payload.generation > stored.generation
      && !chain.some((manifest) => manifest.manifest.payload.generation === stored.generation
        && manifest.manifestHash === stored.manifestHash)) {
      throw new Error("The observer recipe trust rotation does not extend the pinned chain.");
    }
    if (Number.isSafeInteger(stored.transparencySequence)
      && (receipt.sequence < stored.transparencySequence
        || (receipt.sequence === stored.transparencySequence && receipt.eventHash !== stored.transparencyEventHash))) {
      throw new Error("The observer recipe transparency receipt was rolled back.");
    }
    if (Number.isSafeInteger(stored.transparencySequence)
      && receipt.sequence === stored.transparencySequence + 1
      && receipt.previousEventHash !== stored.transparencyEventHash) {
      throw new Error("The observer recipe transparency chain does not extend the pinned checkpoint.");
    }
  }
  return {
    activeKey: current.activeKey,
    state: {
      contractVersion: 1,
      rootKeyId: root.keyId,
      generation: current.manifest.payload.generation,
      manifestHash: current.manifestHash,
      previousManifestHash: current.manifest.payload.previousManifestHash,
      activeKeyId: current.activeKey.keyId,
      activePublicKeySpki: current.activeKey.publicKeySpki,
      knownKeyIds: current.keys.map((key) => key.keyId),
      revokedKeyIds: current.revokedKeyIds,
      expiresAt: current.manifest.payload.expiresAt,
      transparencySequence: receipt.sequence,
      transparencyEventHash: receipt.eventHash,
      verifiedAt: new Date(now).toISOString()
    }
  };
}

function observerRecipeSelector(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  const lower = normalized.toLocaleLowerCase("en-US");
  const forbidden = [
    "password", "passwd", "payment", "credit", "debit", "card-number", "cardnumber",
    "cvv", "cvc", "account", "address", "email", "phone", "cookie", "csrf", "token",
    "authorization", "checkout", "place-order", "submit-order", "buy-now"
  ];
  if (normalized.length < 2 || normalized.length > 160
    || !/^[A-Za-z0-9#.\[\]="' _>+~-]+$/.test(normalized)
    || /[*,():;{}@/\\]/.test(normalized)
    || lower.includes("xpath")
    || forbidden.some((term) => lower.includes(term))) {
    throw new Error("The signed observer recipe contains a selector outside the packaged safe subset.");
  }
  return normalized;
}

function normalizedObserverRecipeEnvelope(value, key, retailerId) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["algorithm", "keyId", "payload", "publicKeySpki", "signature"])) {
    throw new Error("The observer recipe envelope schema is invalid.");
  }
  if (value.algorithm !== "Ed25519" || !/^[a-f0-9]{64}$/.test(String(value.keyId || ""))
    || !/^[A-Za-z0-9_-]{40,120}$/.test(String(value.publicKeySpki || ""))
    || !/^[A-Za-z0-9_-]{80,120}$/.test(String(value.signature || ""))
    || key?.algorithm !== "Ed25519") {
    throw new Error("The observer recipe signing key metadata is invalid.");
  }
  const payload = value.payload;
  const payloadKeys = [
    "contractVersion", "expiresAt", "fields", "issuedAt", "minimumExtensionVersion",
    "recipeId", "recipeVersion", "retailerId", "rollbackRecipeId", "state"
  ];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(payloadKeys.sort())
    || payload.contractVersion !== 1 || payload.retailerId !== retailerId
    || !["shadow", "canary", "trusted_read_only"].includes(payload.state)
    || !/^[A-Za-z0-9_-]{3,120}$/.test(String(payload.recipeId || ""))
    || !/^[a-z0-9][a-z0-9._-]{1,39}$/.test(String(payload.recipeVersion || ""))
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(payload.minimumExtensionVersion || ""))
    || compareVersions(EXTENSION_VERSION, payload.minimumExtensionVersion) < 0
    || (payload.rollbackRecipeId && !/^[A-Za-z0-9_-]{3,120}$/.test(payload.rollbackRecipeId))) {
    throw new Error("The signed observer recipe payload is incompatible with this companion.");
  }
  const issued = new Date(payload.issuedAt).getTime();
  const expires = new Date(payload.expiresAt).getTime();
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > Date.now() + 5 * 60_000
    || expires <= Date.now() || expires - issued > 30 * 24 * 60 * 60_000) {
    throw new Error("The signed observer recipe is expired or outside its bounded lifetime.");
  }
  const fieldNames = ["availability", "unitPrice", "seller", "fulfillment", "addControl"];
  const modes = ["text", "attribute", "presence", "disabled_state"];
  const attributes = ["aria-label", "content", "data-testid", "data-automation-id"];
  if (!payload.fields || typeof payload.fields !== "object" || Array.isArray(payload.fields)
    || Object.keys(payload.fields).length < 1
    || Object.keys(payload.fields).some((field) => !fieldNames.includes(field))) {
    throw new Error("The observer recipe contains an unsupported field.");
  }
  const safeFields = {};
  let selectorCount = 0;
  for (const field of fieldNames) {
    const definition = payload.fields[field];
    if (definition === undefined) continue;
    if (!definition || typeof definition !== "object" || Array.isArray(definition)
      || Object.keys(definition).some((item) => !["mode", "selectors", "attribute"].includes(item))
      || !modes.includes(definition.mode) || !Array.isArray(definition.selectors)
      || definition.selectors.length < 1 || definition.selectors.length > 5) {
      throw new Error("The observer recipe field schema is invalid.");
    }
    const allowedModes = {
      availability: ["text", "presence", "disabled_state"],
      unitPrice: ["text", "attribute"],
      seller: ["text", "attribute"],
      fulfillment: ["text", "presence"],
      addControl: ["presence", "disabled_state", "attribute"]
    };
    if (!allowedModes[field].includes(definition.mode)) throw new Error("The observer recipe field mode is invalid.");
    const selectors = [...new Set(definition.selectors.map(observerRecipeSelector))];
    selectorCount += selectors.length;
    if (selectorCount > 25) throw new Error("The observer recipe exceeds its selector budget.");
    if (definition.mode === "attribute") {
      if (!attributes.includes(definition.attribute)) throw new Error("The observer recipe attribute is invalid.");
      safeFields[field] = { mode: definition.mode, selectors, attribute: definition.attribute };
    } else {
      if (definition.attribute !== undefined) throw new Error("The observer recipe field contains an unexpected attribute.");
      safeFields[field] = { mode: definition.mode, selectors };
    }
  }
  return {
    envelope: { ...value, payload: { ...payload, fields: safeFields } },
    canonicalPayload: JSON.stringify(payload)
  };
}

async function verifiedObserverRecipe(value, rootedTrust, retailerId) {
  const normalized = normalizedObserverRecipeEnvelope(value, rootedTrust.activeKey, retailerId);
  const spki = base64urlBytes(normalized.envelope.publicKeySpki);
  if (await sha256Hex(spki) !== normalized.envelope.keyId) throw new Error("The observer recipe key fingerprint does not match its public key.");
  if (rootedTrust.state.revokedKeyIds.includes(normalized.envelope.keyId)) {
    throw new Error("The observer recipe signing key is revoked.");
  }
  if (normalized.envelope.keyId !== rootedTrust.activeKey.keyId
    || normalized.envelope.publicKeySpki !== rootedTrust.activeKey.publicKeySpki) {
    throw new Error("The observer recipe was not signed by the current active intermediate key.");
  }
  const valid = await verifyEd25519(
    normalized.envelope.publicKeySpki,
    normalized.envelope.signature,
    normalized.canonicalPayload
  );
  if (!valid) throw new Error("The observer recipe signature is invalid.");
  return normalized.envelope.payload;
}

async function evaluateObserverRecipe(tabId, fields, bundledObservation, diagnostic) {
  const packagedPassed = !diagnostic || ["passed", "recovered"].includes(String(diagnostic.outcome || ""));
  const failureStage = String(diagnostic?.failureStage || "");
  const expected = {
    retailerSku: bundledObservation.retailerSku,
    availability: bundledObservation.availability,
    unitPriceCents: bundledObservation.unitPriceCents,
    sellerName: bundledObservation.sellerName,
    fulfillment: bundledObservation.fulfillment,
    addControlActionable: bundledObservation.addControlActionable,
    known: {
      availability: bundledObservation.availability !== "unknown" && failureStage !== "availability_binding",
      unitPrice: Number.isSafeInteger(bundledObservation.unitPriceCents)
        && !["price_binding", "offer_binding"].includes(failureStage),
      seller: Boolean(bundledObservation.sellerName) && bundledObservation.sellerType !== "unknown"
        && !["seller_binding", "offer_binding"].includes(failureStage),
      fulfillment: bundledObservation.fulfillment !== "unknown"
        && !["fulfillment_binding", "offer_binding"].includes(failureStage),
      addControl: packagedPassed
    }
  };
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: ["observer-recipe-oracle.js"]
  });
  const injections = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: ["evaluateObserverRecipeEvidence", fields, expected],
    func: (operation, recipeFields, packagedEvidence) => {
      const oracle = globalThis.YoinkObserverRecipeOracle;
      if (operation !== "evaluateObserverRecipeEvidence"
        || !oracle || typeof oracle.evaluateObserverRecipeEvidence !== "function") return null;
      return oracle.evaluateObserverRecipeEvidence(document, recipeFields, packagedEvidence);
    }
  });
  const result = injections.find((entry) => entry.frameId === 0)?.result;
  const counts = [
    "evaluatedFieldCount", "agreedFieldCount", "ambiguousFieldCount",
    "oracleEvaluatedFieldCount", "oracleAgreedFieldCount", "oracleConflictFieldCount",
    "packagedMissingFieldCount", "packagedConflictFieldCount", "insufficientFieldCount"
  ];
  if (!result || result.validationProfile !== "packaged_structured_oracle_v1"
    || !Array.isArray(result.fieldOutcomes) || result.fieldOutcomes.length < 1 || result.fieldOutcomes.length > 5
    || counts.some((key) => !Number.isInteger(result[key]) || result[key] < 0 || result[key] > 5)
    || typeof result.shape !== "string" || result.shape.length > 600) {
    throw new Error("The packaged observer recipe oracle returned no bounded result.");
  }
  return result;
}

async function runObserverRecipeShadow(tabId, retailerId, observation, diagnostic, device) {
  try {
    const distributed = await request(`/devices/self/observer-recipes/${encodeURIComponent(retailerId)}`, {
      headers: { Authorization: `Bearer ${device.token}` }
    }, EVIDENCE_REQUEST_TIMEOUT_MS);
    if (!distributed.recipe) return null;
    const rootedTrust = await verifiedObserverRecipeTrust(distributed.trust);
    const recipe = await verifiedObserverRecipe(distributed.recipe, rootedTrust, retailerId);
    await chrome.storage.local.set({ [OBSERVER_RECIPE_TRUST_STATE_KEY]: rootedTrust.state });
    await chrome.storage.local.remove(LEGACY_OBSERVER_RECIPE_KEY_PIN);
    const evaluation = await evaluateObserverRecipe(tabId, recipe.fields, observation, diagnostic);
    const diagnosticFingerprint = String(diagnostic?.layoutFingerprint || "");
    const layoutFingerprint = /^[a-f0-9]{64}$/.test(diagnosticFingerprint)
      ? diagnosticFingerprint
      : await sha256Hex(`observer-recipe-bounded-layout-v1|${retailerId}|${evaluation.shape}`);
    const outcome = evaluation.agreedFieldCount === evaluation.evaluatedFieldCount
      && evaluation.ambiguousFieldCount === 0
      && evaluation.oracleConflictFieldCount === 0
      && evaluation.packagedConflictFieldCount === 0
      && evaluation.insufficientFieldCount === 0 ? "passed" : "failed";
    const payload = await request(`/devices/self/observer-recipe-trials/${encodeURIComponent(retailerId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({
        contractVersion: 2,
        recipeId: recipe.recipeId,
        recipeVersion: recipe.recipeVersion,
        retailerId,
        retailerSku: observation.retailerSku,
        observerVersion: observation.adapterVersion,
        layoutFingerprint,
        outcome,
        evaluatedFieldCount: evaluation.evaluatedFieldCount,
        agreedFieldCount: evaluation.agreedFieldCount,
        ambiguousFieldCount: evaluation.ambiguousFieldCount,
        validationProfile: evaluation.validationProfile,
        oracleEvaluatedFieldCount: evaluation.oracleEvaluatedFieldCount,
        oracleAgreedFieldCount: evaluation.oracleAgreedFieldCount,
        oracleConflictFieldCount: evaluation.oracleConflictFieldCount,
        packagedMissingFieldCount: evaluation.packagedMissingFieldCount,
        packagedConflictFieldCount: evaluation.packagedConflictFieldCount,
        insufficientFieldCount: evaluation.insufficientFieldCount,
        fieldOutcomes: evaluation.fieldOutcomes,
        observedAt: new Date().toISOString()
      })
    }, EVIDENCE_REQUEST_TIMEOUT_MS);
    await chrome.storage.local.set({
      [OBSERVER_RECIPE_STATUS_KEY]: {
        recipeId: recipe.recipeId,
        retailerId,
        state: recipe.state,
        outcome,
        validationProfile: evaluation.validationProfile,
        oracleAgreedFieldCount: evaluation.oracleAgreedFieldCount,
        packagedConflictFieldCount: evaluation.packagedConflictFieldCount,
        checkedAt: new Date().toISOString()
      }
    });
    return payload.trial;
  } catch (error) {
    await chrome.storage.local.set({
      [OBSERVER_RECIPE_STATUS_KEY]: {
        recipeId: "",
        retailerId,
        state: "rejected",
        outcome: "failed_closed",
        message: String(error instanceof Error ? error.message : "Observer recipe rejected.").slice(0, 160),
        checkedAt: new Date().toISOString()
      }
    });
    return null;
  }
}

function normalizedStoredDevice(value) {
  if (!value || typeof value !== "object"
    || !/^[A-Za-z0-9_-]{3,120}$/.test(String(value.id || ""))
    || !DEVICE_TOKEN_PATTERN.test(String(value.token || ""))) return null;
  const device = {
    id: String(value.id),
    token: String(value.token),
    name: String(value.name || "Paired Chrome").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100),
    credentialGeneration: Number.isSafeInteger(value.credentialGeneration) && value.credentialGeneration >= 1
      ? value.credentialGeneration : 1
  };
  const pending = value.pendingCredential;
  if (pending && typeof pending === "object"
    && DEVICE_TOKEN_PATTERN.test(String(pending.token || ""))
    && Number.isSafeInteger(pending.generation) && pending.generation >= 2 && pending.generation <= 1_000_000
    && Number.isFinite(new Date(String(pending.expiresAt || "")).getTime())) {
    device.pendingCredential = {
      token: String(pending.token),
      generation: pending.generation,
      expiresAt: String(pending.expiresAt).slice(0, 40)
    };
  }
  return device;
}

async function storedDevice() {
  return normalizedStoredDevice((await chrome.storage.local.get(DEVICE_KEY))[DEVICE_KEY]);
}

function normalizedDeviceCredentialStatus(value) {
  if (!value || typeof value !== "object"
    || !Number.isSafeInteger(value.generation) || value.generation < 1
    || !Number.isFinite(new Date(String(value.issuedAt || "")).getTime())
    || !Number.isFinite(new Date(String(value.rotateAfter || "")).getTime())
    || typeof value.rotationDue !== "boolean") return null;
  return {
    generation: value.generation,
    issuedAt: String(value.issuedAt).slice(0, 40),
    rotateAfter: String(value.rotateAfter).slice(0, 40),
    rotationDue: value.rotationDue
  };
}

function normalizedDeviceCredentialRotation(value, deviceId) {
  if (!value || typeof value !== "object"
    || value.deviceId !== deviceId
    || !normalizedDeviceCredentialStatus(value.credential)) {
    throw new Error("Yoink returned an invalid credential rotation receipt.");
  }
  return value.credential;
}

async function commitPendingDeviceCredential(device) {
  const pending = device?.pendingCredential;
  if (!pending) return device;
  try {
    const payload = await request("/devices/self/credential-rotation/commit", {
      method: "POST",
      headers: { Authorization: `Bearer ${pending.token}` },
      body: JSON.stringify({ generation: pending.generation })
    });
    const credential = normalizedDeviceCredentialRotation(payload.rotation, device.id);
    if (credential.generation !== pending.generation) {
      throw new Error("Yoink returned a mismatched credential generation.");
    }
    const rotated = {
      id: device.id,
      token: pending.token,
      name: device.name,
      credentialGeneration: pending.generation
    };
    await chrome.storage.local.set({ [DEVICE_KEY]: rotated });
    return rotated;
  } catch (error) {
    if ([400, 401, 409].includes(Number(error?.status))) {
      const current = {
        id: device.id,
        token: device.token,
        name: device.name,
        credentialGeneration: device.credentialGeneration
      };
      await chrome.storage.local.set({ [DEVICE_KEY]: current });
      return current;
    }
    return device;
  }
}

async function rotateDeviceCredential(device, credential) {
  if (!device?.token || !credential?.rotationDue) return device;
  try {
    const payload = await request("/devices/self/credential-rotation/begin", {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: "{}"
    });
    const rotation = payload.rotation;
    if (!rotation || typeof rotation !== "object"
      || !DEVICE_TOKEN_PATTERN.test(String(rotation.token || ""))
      || !Number.isSafeInteger(rotation.generation)
      || rotation.generation !== credential.generation + 1
      || !Number.isFinite(new Date(String(rotation.expiresAt || "")).getTime())) {
      throw new Error("Yoink returned an invalid pending device credential.");
    }
    const pendingDevice = {
      ...device,
      pendingCredential: {
        token: String(rotation.token),
        generation: rotation.generation,
        expiresAt: String(rotation.expiresAt).slice(0, 40)
      }
    };
    await chrome.storage.local.set({ [DEVICE_KEY]: pendingDevice });
    return commitPendingDeviceCredential(pendingDevice);
  } catch {
    return device;
  }
}

async function maintainDeviceCredential(device, credential = null) {
  if (!device) return null;
  if (deviceCredentialRotationPromise) return deviceCredentialRotationPromise;
  deviceCredentialRotationPromise = (async () => {
    const resumingPendingRotation = Boolean(device.pendingCredential);
    const resumed = await commitPendingDeviceCredential(device);
    if (resumingPendingRotation) return resumed;
    return rotateDeviceCredential(resumed, credential);
  })();
  try {
    return await deviceCredentialRotationPromise;
  } finally {
    deviceCredentialRotationPromise = null;
  }
}

function normalizeTrackalackerState(value = {}) {
  const allowedStates = new Set(["disabled", "awaiting_page", "subscribing", "registering", "ready", "error"]);
  const state = allowedStates.has(String(value.state || "")) ? String(value.state) : "disabled";
  const allowedErrors = new Set([
    "", "push_api_unavailable", "push_subscription_read_failed", "subscription_key_mismatch",
    "push_subscribe_failed", "push_silent_migration_failed", "silent_push_unavailable",
    "missing_subscription", "incomplete_subscription", "subscription_fingerprint_failed",
    "page_bridge_failed", "network_error", "http_error", "signal_delivery_rejected",
    "signal_delivery_http", "local_app_unreachable"
  ]);
  const errorCode = String(value.errorCode || "");
  return {
    enabled: value.enabled === true,
    state,
    ready: value.ready === true && state === "ready",
    subscriptionPresent: value.subscriptionPresent === true,
    registeredFingerprint: /^[a-f0-9]{64}$/.test(String(value.registeredFingerprint || ""))
      ? String(value.registeredFingerprint) : "",
    pendingSignals: Math.max(0, Math.min(TRACKALACKER_PUSH_QUEUE_LIMIT, Number(value.pendingSignals) || 0)),
    lastHttpStatus: Math.max(0, Math.min(599, Number(value.lastHttpStatus) || 0)),
    errorCode: allowedErrors.has(errorCode) ? errorCode : "",
    lastRegistrationAt: String(value.lastRegistrationAt || "").slice(0, 40),
    lastNotificationAt: String(value.lastNotificationAt || "").slice(0, 40),
    lastDeliveryAt: String(value.lastDeliveryAt || "").slice(0, 40),
    updatedAt: String(value.updatedAt || "").slice(0, 40)
  };
}

async function readTrackalackerState() {
  const stored = await chrome.storage.local.get(TRACKALACKER_PUSH_STATE_KEY);
  return normalizeTrackalackerState(stored[TRACKALACKER_PUSH_STATE_KEY]);
}

function updateTrackalackerState(changes = {}) {
  const task = trackalackerStateQueue.then(async () => {
    const current = await readTrackalackerState();
    const next = normalizeTrackalackerState({ ...current, ...changes, updatedAt: new Date().toISOString() });
    await chrome.storage.local.set({ [TRACKALACKER_PUSH_STATE_KEY]: next });
    return next;
  });
  trackalackerStateQueue = task.catch(() => undefined);
  return task;
}

function normalizeTrackalackerQueue(value) {
  if (!Array.isArray(value) || !TrackalackerPush) return [];
  const output = [];
  for (const entry of value.slice(-TRACKALACKER_PUSH_QUEUE_LIMIT)) {
    if (!entry || typeof entry !== "object" || entry.source?.transport !== "chrome_extension_web_push") continue;
    const sanitized = TrackalackerPush.signalEnvelopeFromPush(
      { title: entry.notification?.title, body: entry.notification?.body },
      entry.signalId,
      entry.source?.receivedAt,
      chrome.runtime.id,
      {
        sourceProductId: entry.notification?.sourceProductId,
        listingId: entry.notification?.sourceListingId,
        productSlug: entry.notification?.sourceProductSlug,
        retailer: entry.notification?.sourceRetailer,
        sku: entry.notification?.sourceRetailerSku
      }
    );
    if (sanitized) output.push(sanitized);
  }
  return output;
}

async function readTrackalackerQueue() {
  const stored = await chrome.storage.local.get(TRACKALACKER_PUSH_QUEUE_KEY);
  return normalizeTrackalackerQueue(stored[TRACKALACKER_PUSH_QUEUE_KEY]);
}

function mutateTrackalackerQueue(mutator) {
  const task = trackalackerQueueQueue.then(async () => {
    const current = await readTrackalackerQueue();
    const next = normalizeTrackalackerQueue(mutator(current));
    await chrome.storage.local.set({ [TRACKALACKER_PUSH_QUEUE_KEY]: next });
    await updateTrackalackerState({ pendingSignals: next.length });
    return next;
  });
  trackalackerQueueQueue = task.catch(() => undefined);
  return task;
}

async function postTrackalackerStatus(state = null) {
  const device = await storedDevice();
  if (!device?.token) return false;
  const current = state || await readTrackalackerState();
  const queue = await readTrackalackerQueue();
  try {
    await request("/devices/self/sources/trackalacker/status", {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({
        state: current.state,
        ready: current.ready,
        subscriptionPresent: current.subscriptionPresent,
        pendingSignals: queue.length,
        lastHttpStatus: current.lastHttpStatus,
        errorCode: current.errorCode,
        lastRegistrationAt: current.lastRegistrationAt,
        lastNotificationAt: current.lastNotificationAt,
        lastDeliveryAt: current.lastDeliveryAt,
        updatedAt: current.updatedAt || new Date().toISOString()
      })
    }, 5_000);
    return true;
  } catch {
    return false;
  }
}

async function sendTrackalackerEnvelope(envelope) {
  const device = await storedDevice();
  if (!device?.token) return { delivered: false, retryable: true, status: 401 };
  try {
    await request("/devices/self/sources/trackalacker/signals", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${device.token}`,
        "Idempotency-Key": envelope.signalId
      },
      body: JSON.stringify(envelope)
    }, 5_000);
    return { delivered: true, retryable: false, status: 202 };
  } catch (error) {
    const status = Number(error?.status || 0);
    return { delivered: false, retryable: !status || status >= 500 || [408, 429].includes(status), status };
  }
}

async function drainTrackalackerQueue() {
  if (trackalackerDrainPromise) return trackalackerDrainPromise;
  trackalackerDrainPromise = (async () => {
    const state = await readTrackalackerState();
    if (!state.enabled) return { delivered: 0 };
    let delivered = 0;
    while (true) {
      const queue = await readTrackalackerQueue();
      const envelope = queue[0];
      if (!envelope) break;
      const result = await sendTrackalackerEnvelope(envelope);
      if (result.delivered) {
        await mutateTrackalackerQueue((current) => current.filter((entry) => entry.signalId !== envelope.signalId));
        delivered += 1;
        await updateTrackalackerState({ lastDeliveryAt: new Date().toISOString(), lastHttpStatus: result.status, errorCode: "" });
        continue;
      }
      if (!result.retryable && result.status) {
        await mutateTrackalackerQueue((current) => current.filter((entry) => entry.signalId !== envelope.signalId));
        await updateTrackalackerState({ errorCode: "signal_delivery_rejected", lastHttpStatus: result.status });
        continue;
      }
      await updateTrackalackerState({
        errorCode: result.status ? "signal_delivery_http" : "local_app_unreachable",
        lastHttpStatus: result.status
      });
      break;
    }
    const next = await readTrackalackerState();
    await postTrackalackerStatus(next);
    return { delivered };
  })().finally(() => { trackalackerDrainPromise = null; });
  return trackalackerDrainPromise;
}

function trackalackerTabUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && ["trackalacker.com", "www.trackalacker.com"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function waitForTrackalackerTab(tabId, timeoutMs = 25_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const finish = (error, tab) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error); else resolve(tab);
    };
    const listener = (updatedId, changeInfo, tab) => {
      if (updatedId === tabId && (changeInfo.status === "complete" || tab.status === "complete") && trackalackerTabUrl(tab.url)) finish(null, tab);
    };
    timeout = setTimeout(() => finish(new Error("TrackaLacker did not finish loading in time.")), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === "complete" && trackalackerTabUrl(tab.url)) finish(null, tab);
    }).catch(() => undefined);
  });
}

async function trackalackerTab() {
  const tabs = await chrome.tabs.query({ url: TRACKALACKER_ORIGINS }).catch(() => []);
  const existing = tabs.find((tab) => Number.isInteger(tab?.id) && trackalackerTabUrl(tab.url));
  if (existing) {
    if (existing.status !== "complete") await waitForTrackalackerTab(existing.id);
    return existing.id;
  }
  const created = await chrome.tabs.create({ url: TRACKALACKER_SETTINGS_URL, active: true });
  if (!Number.isInteger(created?.id)) throw new Error("Chrome could not open TrackaLacker.");
  await waitForTrackalackerTab(created.id);
  return created.id;
}

function safeEnrollmentResult(value = {}) {
  const status = Math.max(0, Math.min(599, Number(value.status) || 0));
  const allowed = new Set(["enrolled", "updated", "already_registered", "http_error", "network_error"]);
  return {
    ok: value.ok === true,
    duplicate: value.duplicate === true,
    pageSubscriptionPresent: value.pageSubscriptionPresent === true,
    status,
    code: allowed.has(String(value.code || "")) ? String(value.code) : status ? "http_error" : "network_error"
  };
}

async function performTrackalackerEnrollment(force = false) {
  if (!TrackalackerPush) throw new Error("The TrackaLacker bridge is unavailable. Reload the extension and try again.");
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this Chrome companion before connecting TrackaLacker.");
  const tabId = await trackalackerTab();
  let state = await updateTrackalackerState({ enabled: true, state: "subscribing", ready: false, errorCode: "", lastHttpStatus: 0 });
  await postTrackalackerStatus(state);
  let pagePush = { subscriptionPresent: false, applicationServerKey: "" };
  try {
    const executions = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: TrackalackerPush.inspectPagePushSubscription,
      args: []
    });
    const result = executions?.find((entry) => entry.frameId === 0)?.result;
    pagePush = {
      subscriptionPresent: result?.subscriptionPresent === true,
      applicationServerKey: /^[A-Za-z0-9_-]{80,100}$/.test(String(result?.applicationServerKey || ""))
        ? String(result.applicationServerKey) : ""
    };
  } catch {
    // The confirmed public key remains the compatible fallback.
  }
  let applicationServerKey;
  try {
    applicationServerKey = pagePush.applicationServerKey
      ? TrackalackerPush.applicationServerKeyFromBase64Url(pagePush.applicationServerKey)
      : TrackalackerPush.vapidApplicationServerKey();
  } catch {
    applicationServerKey = TrackalackerPush.vapidApplicationServerKey();
  }
  const found = await TrackalackerPush.ensureSilentPushSubscription(globalThis.registration?.pushManager, applicationServerKey);
  if (!found.ok) {
    state = await updateTrackalackerState({ state: "error", ready: false, subscriptionPresent: false, errorCode: found.reason, lastHttpStatus: 0 });
    await postTrackalackerStatus(state);
    throw new Error("Chrome could not create the TrackaLacker push subscription.");
  }
  const fingerprint = await TrackalackerPush.subscriptionFingerprint(found.subscription).catch(() => "");
  const current = await readTrackalackerState();
  if (!force && !found.previousEndpoint && fingerprint && current.registeredFingerprint === fingerprint) {
    state = await updateTrackalackerState({ state: "ready", ready: true, subscriptionPresent: true, errorCode: "", lastHttpStatus: current.lastHttpStatus || 200 });
    await postTrackalackerStatus(state);
    await drainTrackalackerQueue();
    return { state, diagnostic: "Device already registered", pageSubscriptionPresent: pagePush.subscriptionPresent };
  }
  const registration = TrackalackerPush.deviceRegistrationPayload(found.subscription, TRACKALACKER_DEVICE_NICKNAME);
  const migration = found.previousEndpoint
    ? TrackalackerPush.deviceTokenUpdatePayload(found.previousEndpoint, found.subscription)
    : null;
  if (!registration.ok || !fingerprint) {
    state = await updateTrackalackerState({ state: "error", ready: false, subscriptionPresent: true, errorCode: registration.reason || "subscription_fingerprint_failed" });
    await postTrackalackerStatus(state);
    throw new Error("Chrome returned an incomplete TrackaLacker push subscription.");
  }
  state = await updateTrackalackerState({ state: "registering", ready: false, subscriptionPresent: true, errorCode: "", lastHttpStatus: 0 });
  await postTrackalackerStatus(state);
  let result = null;
  try {
    if (migration?.ok) {
      const updated = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", func: TrackalackerPush.updateDeviceTokenInPage, args: [migration.payload]
      });
      result = safeEnrollmentResult(updated?.find((entry) => entry.frameId === 0)?.result);
    }
    if (!result?.ok) {
      const registered = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", func: TrackalackerPush.registerDeviceInPage, args: [registration.payload]
      });
      result = safeEnrollmentResult(registered?.find((entry) => entry.frameId === 0)?.result);
    }
  } catch {
    result = { ok: false, duplicate: false, status: 0, code: "page_bridge_failed", pageSubscriptionPresent: false };
  }
  if (result.ok) {
    state = await updateTrackalackerState({
      enabled: true,
      state: "ready",
      ready: true,
      subscriptionPresent: true,
      registeredFingerprint: fingerprint,
      errorCode: found.warning || "",
      lastHttpStatus: result.status || 200,
      lastRegistrationAt: new Date().toISOString()
    });
    await postTrackalackerStatus(state);
    await drainTrackalackerQueue();
    return {
      state,
      diagnostic: TrackalackerPush.safeRegistrationDiagnostic(result),
      pageSubscriptionPresent: result.pageSubscriptionPresent || pagePush.subscriptionPresent
    };
  }
  state = await updateTrackalackerState({ state: "error", ready: false, subscriptionPresent: true, errorCode: result.code, lastHttpStatus: result.status });
  await postTrackalackerStatus(state);
  throw new Error(result.status
    ? `TrackaLacker device registration failed with HTTP ${result.status}. Confirm this tab is signed in, then retry.`
    : "TrackaLacker device registration could not use the signed-in page. Confirm this tab is signed in, then retry.");
}

function connectTrackalacker(force = true) {
  if (trackalackerEnrollmentPromise) return trackalackerEnrollmentPromise;
  trackalackerEnrollmentPromise = performTrackalackerEnrollment(force).finally(() => { trackalackerEnrollmentPromise = null; });
  return trackalackerEnrollmentPromise;
}

function normalizeTrackalackerSyncState(value = {}) {
  const phases = new Set(["idle", "starting", "discovering", "importing", "complete", "error"]);
  const counter = (input) => {
    const number = Number(input);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  };
  return {
    syncId: /^[A-Za-z0-9_-]{8,120}$/.test(String(value.syncId || "")) ? String(value.syncId) : "",
    phase: phases.has(String(value.phase || "")) ? String(value.phase) : "idle",
    page: counter(value.page),
    pages: counter(value.pages),
    discovered: counter(value.discovered),
    processed: counter(value.processed),
    imported: counter(value.imported),
    failed: counter(value.failed),
    currentTitle: String(value.currentTitle || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
    message: String(value.message || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
    updatedAt: String(value.updatedAt || "").slice(0, 40)
  };
}

async function readTrackalackerSyncState() {
  const stored = await chrome.storage.local.get(TRACKALACKER_SYNC_STATE_KEY);
  return normalizeTrackalackerSyncState(stored[TRACKALACKER_SYNC_STATE_KEY]);
}

async function updateTrackalackerSyncState(changes = {}) {
  const current = await readTrackalackerSyncState();
  const next = normalizeTrackalackerSyncState({ ...current, ...changes, updatedAt: new Date().toISOString() });
  await chrome.storage.local.set({ [TRACKALACKER_SYNC_STATE_KEY]: next });
  return next;
}

function canonicalRetailerIdentity(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    let retailerId = "";
    let retailerSku = "";
    if (host === "target.com" || host.endsWith(".target.com")) {
      retailerId = "target";
      retailerSku = url.pathname.match(/(?:\/|-)A-(\d{6,12})(?:\/|$)/i)?.[1] || "";
    } else if (host === "walmart.com" || host.endsWith(".walmart.com")) {
      retailerId = "walmart";
      retailerSku = url.pathname.match(/\/ip\/(?:[^/]+\/)?(\d{5,20})(?:\/|$)/i)?.[1]
        || url.searchParams.get("itemId") || url.searchParams.get("items") || "";
    } else if (host === "amazon.com" || host.endsWith(".amazon.com")) {
      retailerId = "amazon";
      retailerSku = (url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]
        || url.searchParams.get("ASIN") || "").toUpperCase();
    } else if (host === "bestbuy.com" || host.endsWith(".bestbuy.com")) {
      retailerId = "bestbuy";
      retailerSku = url.pathname.match(/^\/product\/[^/]+\/(?:[^/]+\/sku\/)?(\d{5,20})(?:\/|$)/i)?.[1]
        || url.pathname.match(/^\/site\/[^/]+\/(\d{5,20})\.p(?:\/|$)/i)?.[1]
        || url.searchParams.get("skuId") || "";
    } else if (host === "disneystore.com" || host.endsWith(".disneystore.com")) {
      retailerId = "disney";
      retailerSku = url.pathname.match(/-(\d{10,20})\.html(?:\/|$)/i)?.[1] || "";
    } else if (host === "ravensburger.us" || host.endsWith(".ravensburger.us")) {
      retailerId = "ravensburger";
      retailerSku = /^\/en-US\/products\//i.test(url.pathname) ? url.pathname.match(/-(\d{5,20})(?:\/|$)/i)?.[1] || "" : "";
    } else if (host === "merch.riotgames.com") {
      retailerId = "riot";
      retailerSku = (url.pathname.match(/^\/en-us\/product\/([a-z0-9](?:[a-z0-9-]{1,118}[a-z0-9])?)\/?$/i)?.[1] || "").toUpperCase();
    } else if (host === "booksamillion.com" || host.endsWith(".booksamillion.com")) {
      retailerId = "booksamillion";
      retailerSku = (url.pathname.match(/^\/p\/-\/([a-z0-9]{10,20})(?:\/|$)/i)?.[1]
        || url.pathname.match(/^\/p\/([a-z0-9]{10,20})(?:\/|$)/i)?.[1] || "").toUpperCase();
    } else if (host === "fanatics.com" || host.endsWith(".fanatics.com")) {
      retailerId = "fanatics";
      retailerSku = url.pathname.replace(/%2B/gi, "+").match(/(?:^|\+)p-(\d{6,20})(?:\+|$)/i)?.[1] || "";
    } else if (host === "kohls.com" || host.endsWith(".kohls.com")) {
      retailerId = "kohls";
      retailerSku = url.pathname.match(/^\/product\/prd-(\d{5,12})\//i)?.[1] || "";
    } else if (host === "macys.com" || host.endsWith(".macys.com")) {
      retailerId = "macys";
      retailerSku = /^\/shop\/product\//i.test(url.pathname) ? url.searchParams.get("ID") || url.searchParams.get("id") || "" : "";
    } else if (host === "p-bandai.com" || host.endsWith(".p-bandai.com")) {
      retailerId = "pbandai";
      retailerSku = (url.pathname.match(/^\/us\/item\/([A-Z]\d{10})(?:\/|$)/i)?.[1] || "").toUpperCase();
    } else if (host === "pokemoncenter.com" || host.endsWith(".pokemoncenter.com")) {
      retailerId = "pokemoncenter";
      retailerSku = url.pathname.match(/^\/product\/(\d{2,3}-\d{5}(?:-\d{3})?)(?:\/|$)/i)?.[1] || "";
    }
    const valid = retailerId === "target" ? /^\d{6,12}$/.test(retailerSku)
      : RETAILER_SKU_PATTERNS[retailerId]?.test(retailerSku) === true;
    if (!valid) return null;
    const canonicalUrl = retailerId === "target" ? `https://www.target.com/p/-/A-${retailerSku}`
      : retailerId === "walmart" ? `https://www.walmart.com/ip/${retailerSku}`
        : retailerId === "amazon" ? `https://www.amazon.com/dp/${retailerSku}`
          : retailerId === "bestbuy" ? `https://www.bestbuy.com/site/-/${retailerSku}.p`
            : retailerId === "riot" ? `https://merch.riotgames.com/en-us/product/${retailerSku.toLowerCase()}/`
              : retailerId === "booksamillion" ? `https://www.booksamillion.com/p/-/${retailerSku}`
                : retailerId === "pbandai" ? `https://p-bandai.com/us/item/${retailerSku}`
                  : retailerId === "pokemoncenter" ? `https://www.pokemoncenter.com${url.pathname}`
                : (() => {
                  const product = new URL(`https://${retailerId === "disney" ? "www.disneystore.com"
                    : retailerId === "ravensburger" ? "www.ravensburger.us"
                      : retailerId === "fanatics" ? "www.fanatics.com"
                        : retailerId === "kohls" ? "www.kohls.com" : "www.macys.com"}${url.pathname}`);
                  if (retailerId === "macys") product.searchParams.set("ID", retailerSku);
                  return product.href;
                })();
    return { retailerId, retailerSku, canonicalUrl };
  } catch {
    return null;
  }
}

function senderIsTrackalacker(sender) {
  return Number.isInteger(sender?.tab?.id) && trackalackerTabUrl(sender?.tab?.url);
}

async function resolveTrackalackerListing(message, sender) {
  if (!senderIsTrackalacker(sender)) throw new Error("A signed-in TrackaLacker tab is required.");
  const expected = ["target", ...Object.keys(RETAILER_OBSERVER_VERSIONS)].includes(String(message?.expectedRetailer || ""))
    ? String(message.expectedRetailer) : "";
  let identity = canonicalRetailerIdentity(message?.url);
  if (identity && (!expected || identity.retailerId === expected)) return { identity };
  try {
    const initial = new URL(String(message?.url || ""));
    if (!["trackalacker.com", "www.trackalacker.com"].includes(initial.hostname.toLowerCase())) return { identity: null };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(initial.href, { method: "GET", credentials: "include", redirect: "follow", cache: "no-store", signal: controller.signal });
      identity = canonicalRetailerIdentity(response.url);
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    identity = null;
  }
  return { identity: identity && (!expected || identity.retailerId === expected) ? identity : null };
}

async function recordTrackalackerSyncProgress(message, sender) {
  if (!senderIsTrackalacker(sender)) throw new Error("A signed-in TrackaLacker tab is required.");
  const current = await readTrackalackerSyncState();
  if (!current.syncId || String(message?.syncId || "") !== current.syncId) throw new Error("This TrackaLacker sync is no longer active.");
  const state = await updateTrackalackerSyncState(message);
  const device = await storedDevice();
  if (!device?.token) throw new Error("The paired Chrome device is unavailable.");
  await request(`/devices/self/sources/trackalacker/sync-runs/${encodeURIComponent(state.syncId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({
      phase: state.phase,
      page: state.page,
      pages: state.pages,
      discovered: state.discovered,
      processed: state.processed,
      imported: state.imported,
      failed: state.failed,
      message: state.message
    })
  }, 15_000);
  return state;
}

async function acceptTrackalackerSyncItem(message, sender) {
  if (!senderIsTrackalacker(sender)) throw new Error("A signed-in TrackaLacker tab is required.");
  const current = await readTrackalackerSyncState();
  if (!current.syncId || String(message?.syncId || "") !== current.syncId || !["starting", "discovering", "importing"].includes(current.phase)) {
    throw new Error("This TrackaLacker sync is no longer active.");
  }
  const device = await storedDevice();
  if (!device?.token) throw new Error("The paired Chrome device is unavailable.");
  return request("/devices/self/sources/trackalacker/catalog", {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({ syncId: current.syncId, item: message.item })
  }, 15_000);
}

async function startTrackalackerSync() {
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this Chrome companion before syncing TrackaLacker.");
  const current = await readTrackalackerSyncState();
  const updatedAt = new Date(current.updatedAt || "").getTime();
  const currentRunFresh = Number.isFinite(updatedAt) && Date.now() - updatedAt < 10 * 60_000;
  if (["starting", "discovering", "importing"].includes(current.phase) && currentRunFresh) return { state: current, alreadyRunning: true };
  const tabId = await trackalackerTab();
  const syncId = `tlsync_${crypto.randomUUID().replaceAll("-", "")}`;
  let state = await updateTrackalackerSyncState({
    syncId,
    phase: "starting",
    page: 0,
    pages: 0,
    discovered: 0,
    processed: 0,
    imported: 0,
    failed: 0,
    currentTitle: "",
    message: "Starting one bounded followed-library pass…"
  });
  try {
    await request("/devices/self/sources/trackalacker/sync-runs", {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({
        syncId,
        phase: "starting",
        page: 0,
        pages: 0,
        discovered: 0,
        processed: 0,
        imported: 0,
        failed: 0,
        message: state.message
      })
    }, 15_000);
    await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", files: ["trackalacker-sync.js"] });
    const executions = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: (requestedSyncId) => {
        try {
          const sync = globalThis.YoinkTrackalackerSync;
          if (!sync || typeof sync.startTrackalackerSync !== "function") return { ok: false, message: "TrackaLacker sync module is unavailable." };
          return sync.startTrackalackerSync(requestedSyncId);
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : "TrackaLacker sync could not start." };
        }
      },
      args: [syncId]
    });
    const result = executions.find((entry) => entry.frameId === 0)?.result;
    if (!result?.ok) throw new Error(result?.message || "TrackaLacker sync could not start.");
    state = await readTrackalackerSyncState();
    return { state, alreadyRunning: result.alreadyRunning === true };
  } catch (error) {
    state = await updateTrackalackerSyncState({ phase: "error", message: error instanceof Error ? error.message : "TrackaLacker sync could not start." });
    await request(`/devices/self/sources/trackalacker/sync-runs/${encodeURIComponent(syncId)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({
        phase: "error", page: state.page, pages: state.pages,
        discovered: state.discovered, processed: state.processed,
        imported: state.imported, failed: state.failed, message: state.message
      })
    }, 15_000).catch(() => undefined);
    throw new Error(state.message);
  }
}

async function showBadge(state) {
  const color = !state.connected ? "#BE5B4B" : state.paired ? "#1D9D77" : "#C89648";
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text: !state.connected ? "!" : state.paired ? "" : "?" });
  await chrome.action.setTitle({ title: !state.connected
    ? "Yoink is not running"
    : state.paired ? `Yoink ${state.version || ""} paired` : "Yoink is ready; pairing required" });
}

async function checkHealth() {
  let state;
  try {
    const health = await request("/health");
    if (health?.status !== "ready") throw new Error("not_ready");
    let device = await storedDevice();
    if (device?.pendingCredential) device = await maintainDeviceCredential(device);
    let controlPlane = null;
    if (device?.token) {
      try {
        const heartbeat = await request("/devices/self/heartbeat", {
          method: "POST",
          headers: { Authorization: `Bearer ${device.token}` },
          body: JSON.stringify({
            platform: "windows-chrome",
            extensionVersion: EXTENSION_VERSION,
            capabilities: targetCapabilities()
          })
        });
        const credential = normalizedDeviceCredentialStatus(heartbeat.credential);
        device = {
          ...device,
          id: heartbeat.device.id,
          name: heartbeat.device.name,
          credentialGeneration: credential?.generation ?? device.credentialGeneration
        };
        controlPlane = heartbeat.controlPlane || null;
        await chrome.storage.local.set({ [DEVICE_KEY]: device });
        if (credential?.rotationDue) device = await maintainDeviceCredential(device, credential);
      } catch (error) {
        if (error?.status === 401) {
          if (!device?.pendingCredential) {
            await chrome.storage.local.remove(DEVICE_KEY);
            device = null;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }
    state = readiness(true, {
      ...health,
      executionMode: controlPlane?.executionMode ?? health.executionMode,
      actionsPaused: controlPlane?.actionsPaused ?? health.actionsPaused,
      chromeMutationEnabled: controlPlane?.retailerMutationEnabled ?? health.chromeMutationEnabled,
      targetShadowAccess: await targetShadowAccess(),
      trackalackerPush: await readTrackalackerState(),
      trackalackerSync: await readTrackalackerSyncState()
    }, device);
  } catch {
    state = readiness(false, {
      targetShadowAccess: await targetShadowAccess().catch(() => false),
      trackalackerPush: await readTrackalackerState().catch(() => normalizeTrackalackerState()),
      trackalackerSync: await readTrackalackerSyncState().catch(() => normalizeTrackalackerSyncState())
    }, await storedDevice());
  }
  await chrome.storage.local.set({ [READINESS_KEY]: state });
  await showBadge(state);
  return state;
}

async function pairDevice(code) {
  const payload = await request("/devices/pair", {
    method: "POST",
    body: JSON.stringify({
      pairingCode: String(code || "").trim(),
      name: "Desktop - Windows - Chrome",
      platform: "windows-chrome",
      extensionVersion: EXTENSION_VERSION,
      capabilities: targetCapabilities()
    })
  });
  if (!payload.device?.id || !payload.device?.token) throw new Error("Yoink returned an incomplete pairing response.");
  const credential = normalizedDeviceCredentialStatus(payload.device.credential);
  await chrome.storage.local.set({
    [DEVICE_KEY]: {
      id: payload.device.id,
      token: payload.device.token,
      name: payload.device.name,
      credentialGeneration: credential?.generation ?? 1
    }
  });
  return checkHealth();
}

async function forgetDevice() {
  await chrome.storage.local.remove(DEVICE_KEY);
  return checkHealth();
}

async function inspectTargetTab() {
  if (!await targetShadowAccess()) throw new Error("Allow Target page access, then try again.");
  const device = await storedDevice();
  if (!device?.id || !device?.token) throw new Error("Pair this Chrome companion before inspecting Target.");
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!Number.isInteger(tab?.id) || !exactTargetProductUrl(tab.url)) {
    throw new Error("Open an exact Target product page in the active tab, then try again.");
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "ISOLATED",
    files: ["target-shadow.js"]
  });
  const injections = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "ISOLATED",
    func: () => {
      try {
        const observer = globalThis.YoinkTargetShadow;
        if (!observer || typeof observer.collectTargetShadowObservation !== "function") {
          return { ok: false, message: "The Target shadow observer is unavailable." };
        }
        return { ok: true, observation: observer.collectTargetShadowObservation(document, location.href) };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "The Target page could not be inspected." };
      }
    }
  });
  const result = injections.find((entry) => entry.frameId === 0)?.result;
  if (!result?.ok) throw new Error(result?.message || "The Target page returned no shadow evidence.");
  const observation = targetObservationPayload(result.observation);
  const payload = await request("/devices/self/shadow-observations/target", {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify(observation)
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
  const recipeTrial = await runObserverRecipeShadow(tab.id, "target", payload.observation, null, device);
  return { state: await checkHealth(), observation: payload.observation, recipeTrial };
}

async function inspectWalmartDrawHubTab() {
  const device = await storedDevice();
  if (!device?.id || !device?.token) throw new Error("Pair this Chrome companion before inspecting Walmart drawings.");
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!Number.isInteger(tab?.id) || !exactWalmartDrawHubUrl(tab.url)) {
    throw new Error("Open the exact Walmart Collectibles Draw page in the active tab, then try again.");
  }
  const origins = RETAILER_ORIGINS.walmart;
  if (!await chrome.permissions.contains({ origins })) {
    throw new Error("Allow Walmart page access, then try again.");
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      files: ["retailer-shadow.js"]
    });
  } catch {
    await reportWalmartDrawFailure(device, "observer_bundle_injection_failed");
    throw new Error("Yoink could not load the Walmart Draw observer. The failure was reported for repair.");
  }
  let injections;
  try {
    injections = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      args: ["observeWalmartDrawHub"],
      func: () => {
        try {
          const observer = globalThis.YoinkRetailerShadow;
          if (!observer || typeof observer.observeWalmartDrawHub !== "function") {
            return { ok: false, reasonCode: "observer_runtime_unavailable" };
          }
          return { ok: true, scan: observer.observeWalmartDrawHub(document, location.href) };
        } catch {
          return { ok: false, reasonCode: "observer_collection_failed" };
        }
      }
    });
  } catch {
    await reportWalmartDrawFailure(device, "observer_execution_failed");
    throw new Error("Yoink could not inspect Walmart drawings. The failure was reported for repair.");
  }
  const result = injections.find((entry) => entry.frameId === 0)?.result;
  if (!result) {
    await reportWalmartDrawFailure(device, "observer_top_frame_missing");
    throw new Error("Yoink could not inspect Walmart drawings. The failure was reported for repair.");
  }
  if (!result.ok) {
    const reasonCode = OBSERVER_RUNTIME_FAILURE_REASONS.has(result.reasonCode)
      ? result.reasonCode : "observer_collection_failed";
    await reportWalmartDrawFailure(device, reasonCode);
    throw new Error("Yoink could not inspect Walmart drawings. The failure was reported for repair.");
  }
  let scan;
  try {
    scan = walmartDrawScanPayload(result.scan);
  } catch {
    await reportWalmartDrawFailure(device, "observer_contract_invalid");
    throw new Error("Yoink received invalid Walmart Draw evidence. The failure was reported for repair.");
  }
  const response = await postWalmartDrawScan(device, scan);
  return { state: await checkHealth(), scan: response.scan };
}

async function inspectRetailerTab() {
  const device = await storedDevice();
  if (!device?.id || !device?.token) throw new Error("Pair this Chrome companion before inspecting a retailer.");
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const identity = Number.isInteger(tab?.id) ? canonicalRetailerIdentity(tab.url) : null;
  if (!identity || !Object.hasOwn(RETAILER_ORIGINS, identity.retailerId)) {
    throw new Error("Open an exact supported retailer product page in the active tab, then try again.");
  }
  const origins = RETAILER_ORIGINS[identity.retailerId];
  if (!origins || !await chrome.permissions.contains({ origins })) {
    throw new Error(`Allow ${identity.retailerId} page access, then try again.`);
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      files: ["retailer-shadow.js"]
    });
  } catch {
    await reportObserverRuntimeFailure(device, identity, "observer_bundle_injection_failed");
    throw new Error("Yoink could not load the retailer observer. Reload the extension and try again.");
  }
  const attempts = [];
  let priorLayout = "";
  let domChanged = false;
  for (let attemptCount = 1; attemptCount <= 3; attemptCount += 1) {
    let injections;
    try {
      injections = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "ISOLATED",
        args: [identity.retailerId, attemptCount, domChanged],
        func: (retailerId, currentAttempt, changed) => {
          try {
            const observer = globalThis.YoinkRetailerShadow;
            if (!observer || typeof observer.collectRetailerShadowAttempt !== "function") {
              return { ok: false, reasonCode: "observer_runtime_unavailable" };
            }
            return { ok: true, ...observer.collectRetailerShadowAttempt(document, location.href, retailerId, "either", currentAttempt, changed) };
          } catch {
            return { ok: false, reasonCode: "observer_collection_failed" };
          }
        }
      });
    } catch {
      await reportObserverRuntimeFailure(device, identity, "observer_execution_failed", attemptCount, domChanged);
      throw new Error("Yoink could not inspect this retailer page. Reload the page and try again.");
    }
    const result = injections.find((entry) => entry.frameId === 0)?.result;
    if (!result) {
      await reportObserverRuntimeFailure(device, identity, "observer_top_frame_missing", attemptCount, domChanged);
      throw new Error("Yoink could not inspect this retailer page. Reload the page and try again.");
    }
    if (!result.ok) {
      const reasonCode = OBSERVER_RUNTIME_FAILURE_REASONS.has(result.reasonCode)
        ? result.reasonCode
        : "observer_collection_failed";
      await reportObserverRuntimeFailure(device, identity, reasonCode, attemptCount, domChanged);
      throw new Error("Yoink could not inspect this retailer page. The failure was reported for repair.");
    }
    let observation;
    let diagnostic;
    try {
      observation = retailerObservationPayload(result.observation, identity.retailerId);
      diagnostic = retailerDiagnosticPayload(result.diagnostic, identity.retailerId, { attemptCount, domChanged });
    } catch {
      await reportObserverRuntimeFailure(device, identity, "observer_contract_invalid", attemptCount, domChanged);
      throw new Error("Yoink received invalid retailer evidence. The failure was reported for repair.");
    }
    const layoutSignature = JSON.stringify(diagnostic.layout);
    if (priorLayout && priorLayout !== layoutSignature) domChanged = true;
    priorLayout = layoutSignature;
    attempts.push({ observation, diagnostic });
    const retryable = [
      "amazon", "bestbuy", "disney", "ravensburger", "riot", "booksamillion",
      "fanatics", "kohls", "macys", "pbandai", "pokemoncenter"
    ].includes(identity.retailerId)
      && diagnostic.outcome !== "passed"
      && !diagnostic.layout.securityChallenge
      && !diagnostic.layout.interactiveBlock
      && observation.sellerType !== "third_party"
      && ["availability_binding", "add_control", "sku_binding", "offer_binding", "price_binding", "seller_binding", "fulfillment_binding", "route_binding"].includes(diagnostic.failureStage);
    if (!retryable || attemptCount === 3) break;
    await new Promise((resolve) => setTimeout(resolve, attemptCount === 1 ? 300 : 700));
  }
  const initial = attempts[0];
  const final = attempts.at(-1);
  if (!initial || !final) throw new Error("The retailer page returned no shadow evidence.");
  const recovered = initial.diagnostic.outcome !== "passed" && final.diagnostic.outcome === "passed";
  const diagnostic = recovered
    ? retailerDiagnosticPayload(initial.diagnostic, identity.retailerId, {
      outcome: "recovered",
      failureStage: initial.diagnostic.failureStage,
      reasonCode: "dom_hydration_recovered",
      attemptCount: attempts.length,
      domChanged
    })
    : retailerDiagnosticPayload(final.diagnostic, identity.retailerId, {
      attemptCount: attempts.length,
      domChanged
    });
  const [observationPayload, diagnosticPayload] = await Promise.all([
    request(`/devices/self/shadow-observations/${encodeURIComponent(identity.retailerId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify(final.observation)
    }, EVIDENCE_REQUEST_TIMEOUT_MS),
    postRetailerDiagnostic(device, diagnostic)
  ]);
  const recipeTrial = await runObserverRecipeShadow(
    tab.id,
    identity.retailerId,
    observationPayload.observation,
    diagnosticPayload.diagnostic,
    device
  );
  return {
    state: await checkHealth(),
    observation: observationPayload.observation,
    diagnostic: diagnosticPayload.diagnostic,
    recipeTrial
  };
}

async function contributeRetailerTab() {
  const device = await storedDevice();
  if (!device?.id || !device?.token) throw new Error("Pair this Chrome companion before sharing evidence.");
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!Number.isInteger(tab?.id)) throw new Error("Open an exact supported retailer product page first.");
  const retailerId = exactTargetProductUrl(tab.url)
    ? "target"
    : canonicalRetailerIdentity(tab.url)?.retailerId;
  if (!retailerId || (retailerId !== "target" && !Object.hasOwn(RETAILER_ORIGINS, retailerId))) {
    throw new Error("Open an exact supported retailer product page first.");
  }

  // This inspection is deliberately initiated only by the popup button. The
  // contribution envelope references server-accepted evidence IDs and cannot
  // carry DOM, page text, cookies, offer tokens, or account data.
  const evidence = retailerId === "target" ? await inspectTargetTab() : await inspectRetailerTab();
  const retailerSku = String(evidence.observation?.retailerSku || "");
  if (!retailerSku) throw new Error("The server did not accept an exact product identity.");
  const selectedOfferFingerprint = String(evidence.observation?.selectedOffer?.fingerprint || "");
  if (!/^[a-f0-9]{64}$/.test(selectedOfferFingerprint)) {
    throw new Error("The server did not accept an exact selected-offer identity.");
  }
  const rateKey = [
    retailerId,
    retailerSku,
    selectedOfferFingerprint,
    String(evidence.observation?.sellerType || "unknown"),
    String(evidence.observation?.sellerName || "").toLocaleLowerCase("en-US"),
    String(evidence.observation?.fulfillment || "unknown")
  ].join(":");
  const storedTimes = (await chrome.storage.local.get(COMMUNITY_CONTRIBUTION_TIMES_KEY))[COMMUNITY_CONTRIBUTION_TIMES_KEY];
  const contributionTimes = storedTimes && typeof storedTimes === "object" && !Array.isArray(storedTimes)
    ? storedTimes : {};
  const previous = Number(contributionTimes[rateKey]);
  if (Number.isFinite(previous) && Date.now() - previous < COMMUNITY_CONTRIBUTION_INTERVAL_MS) {
    throw new Error("This exact product was already shared within the last minute.");
  }
  const issued = await request(`/devices/self/community/nonces/${encodeURIComponent(retailerId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: "{}"
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
  const payload = await request(`/devices/self/community/contributions/${encodeURIComponent(retailerId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({
      contractVersion: 1,
      nonce: issued.nonce,
      shadowObservationId: evidence.observation.id,
      ...(retailerId === "target" ? {} : { adapterDiagnosticId: evidence.diagnostic?.id })
    })
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
  await chrome.storage.local.set({
    [COMMUNITY_CONTRIBUTION_TIMES_KEY]: { ...contributionTimes, [rateKey]: Date.now() }
  });
  return {
    state: evidence.state,
    observation: evidence.observation,
    receipt: payload.receipt,
    assertion: payload.assertion
  };
}

async function injectTargetAction(tabId) {
  return injectAddAction(tabId, "target");
}

async function injectAddAction(tabId, retailerId) {
  const lane = ADD_LANES[retailerId];
  if (!lane) throw new Error("The retailer add runner is unavailable.");
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: [lane.runnerFile]
  });
}

async function executeTargetAction(tabId, operation, args = []) {
  return executeAddAction(tabId, "target", operation, args);
}

async function executeAddAction(tabId, retailerId, operation, args = []) {
  const lane = ADD_LANES[retailerId];
  if (!lane) return { ok: false, reason: "runner_unavailable" };
  const injections = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: (operationName, operationArgs, globalName) => {
      try {
        const runner = globalThis[globalName];
        const method = runner?.[operationName];
        if (typeof method !== "function") return { ok: false, reason: "runner_unavailable" };
        return method(document, location.href, ...(operationArgs || []));
      } catch {
        return { ok: false, reason: "runner_failed" };
      }
    },
    args: [operation, args, lane.runnerGlobal]
  });
  return injections.find((entry) => entry.frameId === 0)?.result || { ok: false, reason: "runner_no_result" };
}

function safeReasonCode(value) {
  const reason = String(value || "rehearsal_failed").toLowerCase();
  return /^[a-z][a-z0-9_]{1,79}$/.test(reason) ? reason : "rehearsal_failed";
}

function targetRehearsalJob(observation) {
  const price = Number(observation?.unitPriceCents);
  if (!observation?.id
    || !/^\d{6,}$/.test(String(observation.retailerSku || ""))
    || !Number.isSafeInteger(price)
    || price <= 0
    || observation.fulfillment !== "shipping"
    || observation.sellerType !== "first_party"
    || observation.sellerName !== "Target") {
    throw new Error("Open an in-stock, Target-sold product with shipping available before running the no-click rehearsal.");
  }
  return {
    adapterVersion: TARGET_ADD_ADAPTER_VERSION,
    contractVersion: 1,
    jobId: `rehearsal_${String(observation.id).slice(0, 100)}`,
    retailerId: "target",
    retailerSku: String(observation.retailerSku),
    canonicalUrl: String(observation.canonicalUrl),
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: price,
    maxOrderTotalCents: price,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: String(observation.sellerName || "").slice(0, 160),
    fulfillment: "shipping",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
}

async function rehearseTargetTab() {
  const inspection = await inspectTargetTab();
  const observation = inspection.observation;
  const job = targetRehearsalJob(observation);
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!Number.isInteger(tab?.id)
    || targetSkuFromUrl(tab.url) !== observation.retailerSku) {
    throw new Error("Keep the inspected Target product page active while the no-click rehearsal runs.");
  }
  await injectTargetAction(tab.id);
  const result = await executeTargetAction(tab.id, "rehearseTargetAdd", [job]);
  const passed = result?.ok === true && result?.wouldClick === true;
  const reasonCode = passed ? "verified" : safeReasonCode(result?.reason);
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this Chrome companion before rehearsing Target.");
  const payload = await request("/devices/self/qualification-trials/target-add", {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      observerVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1,
      shadowObservationId: observation.id,
      observedAt: new Date().toISOString(),
      outcome: passed ? "passed" : "rejected",
      reasonCode
    })
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
  return {
    state: await checkHealth(),
    observation,
    rehearsal: { ok: passed, reason: reasonCode, trialId: payload.trial?.id || "" }
  };
}

function walmartRehearsalJob(observation) {
  const price = Number(observation?.unitPriceCents);
  if (!observation?.id
    || observation.retailerId !== "walmart"
    || !/^\d{5,20}$/.test(String(observation.retailerSku || ""))
    || !Number.isSafeInteger(price)
    || price <= 0
    || observation.fulfillment !== "shipping"
    || observation.sellerType !== "first_party"
    || observation.sellerName !== "Walmart") {
    throw new Error("Open an in-stock, Walmart-sold product with shipping explicitly available before running the no-click rehearsal.");
  }
  return {
    adapterVersion: WALMART_ADD_ADAPTER_VERSION,
    contractVersion: 1,
    jobId: `rehearsal_${String(observation.id).slice(0, 100)}`,
    retailerId: "walmart",
    retailerSku: String(observation.retailerSku),
    canonicalUrl: String(observation.canonicalUrl),
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: price,
    maxOrderTotalCents: price,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Walmart",
    fulfillment: "shipping",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
}

async function rehearseWalmartTab() {
  const inspection = await inspectRetailerTab();
  const observation = inspection.observation;
  const job = walmartRehearsalJob(observation);
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const identity = canonicalRetailerIdentity(tab?.url);
  if (!Number.isInteger(tab?.id)
    || identity?.retailerId !== "walmart"
    || identity.retailerSku !== observation.retailerSku) {
    throw new Error("Keep the inspected Walmart product page active while the no-click rehearsal runs.");
  }
  await injectAddAction(tab.id, "walmart");
  const result = await executeAddAction(tab.id, "walmart", "rehearseWalmartAdd", [job]);
  const passed = result?.ok === true && result?.wouldClick === true;
  const reasonCode = passed ? "verified" : safeReasonCode(result?.reason);
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this Chrome companion before rehearsing Walmart.");
  const payload = await request("/devices/self/qualification-trials/walmart-add", {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({
      adapterVersion: WALMART_ADD_ADAPTER_VERSION,
      observerVersion: RETAILER_OBSERVER_VERSIONS.walmart,
      contractVersion: 1,
      shadowObservationId: observation.id,
      observedAt: new Date().toISOString(),
      outcome: passed ? "passed" : "rejected",
      reasonCode
    })
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
  return {
    state: await checkHealth(),
    observation,
    rehearsal: { ok: passed, reason: reasonCode, trialId: payload.trial?.id || "" }
  };
}

function amazonRehearsalJob(observation) {
  const price = Number(observation?.unitPriceCents);
  if (!observation?.id
    || observation.retailerId !== "amazon"
    || !/^[A-Z0-9]{10}$/.test(String(observation.retailerSku || ""))
    || !Number.isSafeInteger(price)
    || price <= 0
    || observation.fulfillment !== "shipping"
    || observation.sellerType !== "first_party"
    || observation.sellerName !== "Amazon.com"
    || observation.purchaseRouteReady !== true) {
    throw new Error("Open an in-stock, Amazon.com-sold product with a unique shipping offer before running the no-click rehearsal.");
  }
  return {
    adapterVersion: AMAZON_ADD_ADAPTER_VERSION,
    contractVersion: 1,
    jobId: `rehearsal_${String(observation.id).slice(0, 100)}`,
    retailerId: "amazon",
    retailerSku: String(observation.retailerSku),
    canonicalUrl: String(observation.canonicalUrl),
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: price,
    maxOrderTotalCents: price,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Amazon.com",
    fulfillment: "shipping",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
}

async function rehearseAmazonTab() {
  const inspection = await inspectRetailerTab();
  const observation = inspection.observation;
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this Chrome companion before rehearsing Amazon.");
  let job;
  try {
    job = amazonRehearsalJob(observation);
  } catch (error) {
    const expectedPolicyRejection = observation.sellerType === "third_party"
      || observation.fulfillment === "pickup"
      || Boolean(observation.securityChallenge || observation.interactiveBlock);
    const reasonCode = observation.sellerType === "third_party"
      ? "third_party_seller"
      : observation.fulfillment === "pickup"
        ? "fulfillment_not_supported"
        : observation.securityChallenge || observation.interactiveBlock
          ? "manual_action_required"
          : safeReasonCode(inspection.diagnostic?.reasonCode || observation.routeReasonCode || "offer_not_actionable");
    await postRetailerDiagnostic(device, operationDiagnostic(
      inspection.diagnostic,
      "amazon",
      "rehearse_add",
      expectedPolicyRejection ? "rejected" : "failed",
      expectedPolicyRejection ? (observation.securityChallenge || observation.interactiveBlock ? "interactive_block" : "policy")
        : inspection.diagnostic?.failureStage || "route_binding",
      reasonCode
    ));
    throw error;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const identity = canonicalRetailerIdentity(tab?.url);
  if (!Number.isInteger(tab?.id)
    || identity?.retailerId !== "amazon"
    || identity.retailerSku !== observation.retailerSku) {
    throw new Error("Keep the inspected Amazon product page active while the no-click rehearsal runs.");
  }
  await injectAddAction(tab.id, "amazon");
  const result = await executeAddAction(tab.id, "amazon", "rehearseAmazonAdd", [job]);
  const passed = result?.ok === true && result?.wouldClick === true;
  const reasonCode = passed ? "verified" : safeReasonCode(result?.reason);
  const manualRejection = reasonCode === "manual_action_required";
  const operationEvidence = operationDiagnostic(
    inspection.diagnostic,
    "amazon",
    "rehearse_add",
    passed ? "passed" : manualRejection ? "rejected" : "failed",
    passed ? "complete" : manualRejection ? "interactive_block" : "runner",
    reasonCode
  );
  const [payload] = await Promise.all([
    request("/devices/self/qualification-trials/amazon-add", {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({
        adapterVersion: AMAZON_ADD_ADAPTER_VERSION,
        observerVersion: RETAILER_OBSERVER_VERSIONS.amazon,
        contractVersion: 1,
        shadowObservationId: observation.id,
        observedAt: new Date().toISOString(),
        outcome: passed ? "passed" : "rejected",
        reasonCode
      })
    }, EVIDENCE_REQUEST_TIMEOUT_MS),
    postRetailerDiagnostic(device, operationEvidence)
  ]);
  return {
    state: await checkHealth(),
    observation,
    rehearsal: { ok: passed, reason: reasonCode, trialId: payload.trial?.id || "" }
  };
}

function bestBuyRehearsalJob(observation) {
  const price = Number(observation?.unitPriceCents);
  if (!observation?.id
    || observation.retailerId !== "bestbuy"
    || !/^\d{5,20}$/.test(String(observation.retailerSku || ""))
    || observation.availability !== "in_stock"
    || observation.addControlActionable !== true
    || Boolean(observation.securityChallenge || observation.interactiveBlock)
    || !Number.isSafeInteger(price)
    || price <= 0
    || observation.fulfillment !== "shipping"
    || observation.sellerType !== "first_party"
    || observation.sellerName !== "Best Buy") {
    if (observation?.interactiveBlock === "high_demand" || observation?.interactiveBlock === "queue") {
      throw new Error("Best Buy high-demand or queue evidence was recorded, but automated demand-gate handling remains closed.");
    }
    if (observation?.availability === "preorder") {
      throw new Error("Best Buy preorder evidence was recorded, but preorder adds remain closed. Use an in-stock Best Buy-sold offer with Shipping selected.");
    }
    if (observation?.fulfillment === "pickup") {
      throw new Error("Best Buy pickup evidence was recorded. Select Shipping on an in-stock Best Buy-sold offer before rehearsing.");
    }
    throw new Error("Open an in-stock offer explicitly sold by Best Buy, select Shipping, and verify a usable Add to cart control before rehearsing.");
  }
  return {
    adapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
    contractVersion: 1,
    jobId: `rehearsal_${String(observation.id).slice(0, 100)}`,
    retailerId: "bestbuy",
    retailerSku: String(observation.retailerSku),
    canonicalUrl: String(observation.canonicalUrl),
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: price,
    maxOrderTotalCents: price,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Best Buy",
    fulfillment: "shipping",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
}

async function rehearseBestBuyTab() {
  const inspection = await inspectRetailerTab();
  const observation = inspection.observation;
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this Chrome companion before rehearsing Best Buy.");
  let job;
  try {
    job = bestBuyRehearsalJob(observation);
  } catch (error) {
    const expectedPolicyRejection = observation.sellerType === "third_party"
      || observation.availability === "preorder"
      || observation.fulfillment === "pickup"
      || Boolean(observation.securityChallenge || observation.interactiveBlock);
    const reasonCode = observation.securityChallenge || observation.interactiveBlock
      ? "manual_action_required"
      : observation.availability === "preorder"
        ? "preorder_not_supported"
        : observation.sellerType === "third_party"
          ? "third_party_seller"
          : observation.fulfillment === "pickup"
            ? "fulfillment_not_supported"
            : safeReasonCode(inspection.diagnostic?.reasonCode || "offer_not_actionable");
    await postRetailerDiagnostic(device, operationDiagnostic(
      inspection.diagnostic,
      "bestbuy",
      "rehearse_add",
      expectedPolicyRejection ? "rejected" : "failed",
      expectedPolicyRejection ? (observation.securityChallenge || observation.interactiveBlock ? "interactive_block" : "policy")
        : inspection.diagnostic?.failureStage || "runner",
      reasonCode
    ));
    throw error;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const identity = canonicalRetailerIdentity(tab?.url);
  if (!Number.isInteger(tab?.id)
    || identity?.retailerId !== "bestbuy"
    || identity.retailerSku !== observation.retailerSku) {
    throw new Error("Keep the inspected Best Buy product page active while the no-click rehearsal runs.");
  }
  await injectAddAction(tab.id, "bestbuy");
  const result = await executeAddAction(tab.id, "bestbuy", "rehearseBestBuyAdd", [job]);
  const passed = result?.ok === true && result?.wouldClick === true;
  const reasonCode = passed ? "verified" : safeReasonCode(result?.reason);
  const manualRejection = reasonCode === "manual_action_required";
  const operationEvidence = operationDiagnostic(
    inspection.diagnostic,
    "bestbuy",
    "rehearse_add",
    passed ? "passed" : manualRejection ? "rejected" : "failed",
    passed ? "complete" : manualRejection ? "interactive_block" : runnerFailureStage(reasonCode),
    reasonCode
  );
  const [payload] = await Promise.all([
    request("/devices/self/qualification-trials/bestbuy-add", {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({
        adapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
        observerVersion: RETAILER_OBSERVER_VERSIONS.bestbuy,
        contractVersion: 1,
        shadowObservationId: observation.id,
        observedAt: new Date().toISOString(),
        outcome: passed ? "passed" : "rejected",
        reasonCode
      })
    }, EVIDENCE_REQUEST_TIMEOUT_MS),
    postRetailerDiagnostic(device, operationEvidence)
  ]);
  return {
    state: await checkHealth(),
    observation,
    rehearsal: { ok: passed, reason: reasonCode, trialId: payload.trial?.id || "" }
  };
}

function normalizedLeaseJob(value) {
  const job = value?.job;
  if (!job || typeof job !== "object") return null;
  const retailerId = String(job.retailerId || "");
  const lane = ADD_LANES[retailerId];
  const canonicalUrl = String(job.canonicalUrl || "");
  const retailerSku = String(job.retailerSku || "");
  const identity = canonicalRetailerIdentity(canonicalUrl);
  const capabilityToken = String(job.capabilityToken || "");
  const expiresAt = String(job.expiresAt || "");
  const jobId = String(job.id || "");
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(jobId)
    || job.contractVersion !== 1
    || !lane
    || job.adapterVersion !== lane.adapterVersion
    || job.action !== "add_to_cart"
    || job.quantity !== 1
    || identity?.retailerId !== retailerId
    || identity.retailerSku !== retailerSku
    || !/^[A-Za-z0-9_-]{40,100}$/.test(capabilityToken)
    || !Number.isSafeInteger(job.maxUnitPriceCents)
    || job.maxUnitPriceCents <= 0
    || !Number.isSafeInteger(job.maxOrderTotalCents)
    || job.maxOrderTotalCents <= 0
    || job.currency !== "USD"
    || job.sellerPolicy !== "first_party_only"
    || job.fulfillment !== "shipping"
    || !Number.isFinite(new Date(expiresAt).getTime())
    || new Date(expiresAt).getTime() <= Date.now()) {
    throw new Error("Yoink returned an unsupported retailer add job.");
  }
  return {
    id: jobId,
    capabilityToken,
    retailerId,
    navigationUrl: notificationRoute({
      canonicalUrl,
      attributionUrl: job.attributionUrl,
      retailerId,
      retailerSku
    }) || canonicalUrl,
    runnerJob: {
      adapterVersion: lane.adapterVersion,
      contractVersion: 1,
      jobId,
      retailerId,
      retailerSku,
      canonicalUrl,
      action: "add_to_cart",
      quantity: 1,
      maxUnitPriceCents: job.maxUnitPriceCents,
      maxOrderTotalCents: job.maxOrderTotalCents,
      currency: "USD",
      sellerPolicy: job.sellerPolicy,
      expectedSeller: String(job.expectedSeller || "").slice(0, 160),
      fulfillment: job.fulfillment,
      expiresAt
    }
  };
}

async function activeJob() {
  const current = (await chrome.storage.session.get(ACTIVE_JOB_KEY))[ACTIVE_JOB_KEY] || null;
  if (current) return current;
  const legacy = (await chrome.storage.session.get(LEGACY_ACTIVE_TARGET_JOB_KEY))[LEGACY_ACTIVE_TARGET_JOB_KEY] || null;
  if (!legacy) return null;
  const migrated = { ...legacy, retailerId: "target" };
  await chrome.storage.session.set({ [ACTIVE_JOB_KEY]: migrated });
  await chrome.storage.session.remove(LEGACY_ACTIVE_TARGET_JOB_KEY);
  return migrated;
}

async function saveActiveJob(value) {
  await chrome.storage.session.set({ [ACTIVE_JOB_KEY]: value });
  await chrome.storage.session.remove(LEGACY_ACTIVE_TARGET_JOB_KEY);
}

async function clearActiveJob() {
  await chrome.storage.session.remove(ACTIVE_JOB_KEY);
  await chrome.storage.session.remove(LEGACY_ACTIVE_TARGET_JOB_KEY);
}

async function reportJob(active, state, reasonCode, message, evidence = {}) {
  const device = await storedDevice();
  if (!device?.token) throw new Error("The paired Chrome device is unavailable.");
  const payload = await request(`/devices/self/jobs/${encodeURIComponent(active.id)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({
      capabilityToken: active.capabilityToken,
      state,
      reasonCode: safeReasonCode(reasonCode),
      message: String(message || "Chrome reported guarded retailer add progress.").slice(0, 500),
      evidence
    })
  });
  active.phase = payload.job?.state || state;
  await saveActiveJob(active);
  return payload.job;
}

function waitForTab(tabId, retailerId, expected, timeoutMs = 25_000) {
  const lane = ADD_LANES[retailerId];
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    let listener;
    const finish = (error, tab) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error); else resolve(tab);
    };
    const accepted = (tab) => {
      if (tab?.status !== "complete" || !lane) return false;
      if (expected === "cart") {
        try {
          const actual = new URL(String(tab.url || ""));
          const cart = new URL(lane.cartUrl);
          const cartPath = cart.pathname.replace(/\/$/, "");
          return actual.protocol === "https:" && !actual.username && !actual.password
            && actual.origin === cart.origin
            && (actual.pathname === cartPath || actual.pathname.startsWith(`${cartPath}/`));
        } catch {
          return false;
        }
      }
      const identity = canonicalRetailerIdentity(tab.url);
      return identity?.retailerId === retailerId && identity.retailerSku === expected;
    };
    listener = (updatedId, changeInfo, tab) => {
      if (updatedId === tabId && (changeInfo.status === "complete" || tab.status === "complete") && accepted(tab)) finish(null, tab);
    };
    timeout = setTimeout(() => finish(new Error(`The ${lane?.name || "retailer"} tab did not finish loading in time.`)), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (accepted(tab)) finish(null, tab);
    }).catch(() => undefined);
  });
}

async function openRetailerTab(retailerId, url, expected) {
  const lane = ADD_LANES[retailerId];
  const tab = await chrome.tabs.create({ url, active: true });
  if (!Number.isInteger(tab?.id)) throw new Error(`Chrome could not open the ${lane?.name || "retailer"} execution tab.`);
  await waitForTab(tab.id, retailerId, expected);
  return tab.id;
}

async function navigateRetailerTab(tabId, retailerId, url, expected) {
  await chrome.tabs.update(tabId, { url, active: true });
  await waitForTab(tabId, retailerId, expected);
}

function safeOfferEvidence(proof) {
  return {
    retailerId: ["target", "walmart", "amazon", "bestbuy"].includes(proof?.retailerId) ? proof.retailerId : "",
    retailerSku: String(proof?.retailerSku || ""),
    unitPriceCents: Number.isSafeInteger(proof?.unitPriceCents) ? proof.unitPriceCents : null,
    currency: proof?.currency === "USD" ? "USD" : "",
    sellerType: ["first_party", "third_party"].includes(proof?.sellerType) ? proof.sellerType : "unknown",
    fulfillment: ["shipping", "pickup"].includes(proof?.fulfillment) ? proof.fulfillment : "unknown"
  };
}

async function verifyAddedCart(active) {
  const retailerId = active.retailerId || active.runnerJob?.retailerId;
  const lane = ADD_LANES[retailerId];
  if (!lane || !Number.isInteger(active.tabId) || !active.proof) throw new Error("The retailer cart verification context is unavailable.");
  await navigateRetailerTab(active.tabId, retailerId, lane.cartUrl, "cart");
  await injectAddAction(active.tabId, retailerId);
  let result = { ok: false, reason: "cart_unverified" };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = await executeAddAction(active.tabId, retailerId, lane.verifyCartOperation, [active.runnerJob, active.proof]);
    if (result?.ok || !["cart_unverified", "quantity_unavailable"].includes(result?.reason)) break;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  if (!result?.ok) {
    await reportJob(active, "manual_review", result?.reason || "cart_unverified", `The exact ${lane.name} cart result could not be proven after Add; automatic retry is locked.`);
    await clearActiveJob();
    return false;
  }
  await reportJob(active, "cart_verified", "exact_cart_verified", `The cart contains one exact ${lane.name} line at the authorized quantity and price.`, {
    retailerSku: active.runnerJob.retailerSku,
    quantity: 1,
    unitPriceCents: result.proof?.unitPriceCents ?? null,
    sellerType: result.proof?.sellerType ?? "unknown"
  });
  await reportJob(active, "confirmed", `${retailerId}_add_confirmed`, `${lane.name} add-to-cart completed and the exact cart line was verified.`, {
    retailerSku: active.runnerJob.retailerSku,
    quantity: 1
  });
  await clearActiveJob();
  return true;
}

async function failActiveJob(active, mutationPossible, reason = "extension_error") {
  const retailerId = active.retailerId || active.runnerJob?.retailerId;
  const name = ADD_LANES[retailerId]?.name || "retailer";
  try {
    await reportJob(
      active,
      mutationPossible ? "manual_review" : "cancelled",
      reason,
      mutationPossible
        ? `Chrome stopped after the ${name} mutation boundary; automatic retry is locked for review.`
        : `Chrome stopped before the ${name} mutation boundary; no Add click was authorized.`
    );
  } catch {
    // Lease expiry recovery on the control plane remains the final fail-closed path.
  }
  await clearActiveJob();
}

async function executeLeasedRetailerJob(lease) {
  const retailerId = lease.retailerId || lease.runnerJob?.retailerId;
  const lane = ADD_LANES[retailerId];
  if (!lane) throw new Error("The leased retailer lane is unsupported.");
  const active = { ...lease, phase: "leased", tabId: null, proof: null };
  await saveActiveJob(active);
  try {
    if (!await addLaneAccess(retailerId)) {
      await reportJob(active, "cancelled", "retailer_access_missing", `${lane.name} add stopped before mutation because Chrome page access is not granted.`);
      await clearActiveJob();
      return;
    }
    await reportJob(active, "navigating", "cart_preflight_started", `Chrome opened ${lane.name} cart for an empty-cart preflight.`);
    active.tabId = await openRetailerTab(retailerId, lane.cartUrl, "cart");
    await saveActiveJob(active);
    await injectAddAction(active.tabId, retailerId);
    const empty = await executeAddAction(active.tabId, retailerId, lane.emptyOperation);
    if (!empty?.ok) {
      await reportJob(active, "cancelled", empty?.reason || "cart_unverified", `${lane.name} add stopped before mutation because the cart was not provably empty.`);
      await clearActiveJob();
      return;
    }

    await navigateRetailerTab(active.tabId, retailerId, active.navigationUrl, active.runnerJob.retailerSku);
    await reportJob(active, "verifying_listing", "product_page_ready", `Chrome started exact live ${lane.name} offer verification.`);
    await injectAddAction(active.tabId, retailerId);
    const prepared = await executeAddAction(active.tabId, retailerId, lane.prepareOperation, [active.runnerJob]);
    if (!prepared?.ok) {
      const reasonCode = safeReasonCode(prepared?.reason || "offer_unverified");
      await recordTabOperationDiagnostic(
        active.tabId,
        retailerId,
        "live_add",
        EXPECTED_LIVE_REJECTIONS.has(reasonCode) ? "rejected" : "failed",
        runnerFailureStage(reasonCode),
        reasonCode
      );
      await reportJob(active, "offer_rejected", prepared?.reason || "offer_unverified", `The live ${lane.name} offer did not satisfy the immutable action contract.`);
      await clearActiveJob();
      return;
    }
    await recordTabOperationDiagnostic(active.tabId, retailerId, "live_add", "passed", "complete", "verified");
    active.proof = prepared.proof;
    active.authorizationId = prepared.authorizationId;
    await saveActiveJob(active);
    await reportJob(active, "offer_verified", "live_offer_verified", `The exact ${lane.name} SKU, seller, price, stock, and fulfillment passed live verification.`, safeOfferEvidence(active.proof));
    await reportJob(active, "add_authorized", "add_boundary_prepared", `The exact ${lane.name} Add control is prepared for one final revalidation.`);
    await reportJob(active, "adding", "add_receipt_armed", "The durable at-most-once Add receipt was armed before the browser click.");
    const committed = await executeAddAction(active.tabId, retailerId, lane.commitOperation, [active.runnerJob, active.authorizationId]);
    active.authorizationId = "";
    await saveActiveJob(active);
    if (!committed?.ok || committed?.clicked !== true) {
      const reasonCode = safeReasonCode(committed?.reason || "click_uncertain");
      await recordTabOperationDiagnostic(active.tabId, retailerId, "live_add", "failed", runnerFailureStage(reasonCode), reasonCode);
      await reportJob(active, "manual_review", committed?.reason || "click_uncertain", "The Add boundary did not return a confirmed click result; automatic retry is locked.");
      await clearActiveJob();
      return;
    }
    active.proof = committed.proof;
    await saveActiveJob(active);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await verifyAddedCart(active);
  } catch {
    await failActiveJob(active, ["adding", "cart_verified"].includes(active.phase));
  }
}

async function resumeActiveRetailerJob() {
  const active = await activeJob();
  if (!active) return false;
  if (["adding", "cart_verified"].includes(active.phase) && active.proof && Number.isInteger(active.tabId)) {
    try {
      await verifyAddedCart(active);
    } catch {
      await failActiveJob(active, true, "recovery_failed");
    }
    return true;
  }
  await failActiveJob(active, false, "worker_restarted_before_add");
  return true;
}

function exactRetailerNotificationUrl(value, retailerId, retailerSku) {
  const identity = canonicalRetailerIdentity(value);
  return identity
    && identity.retailerId === String(retailerId || "")
    && identity.retailerSku === String(retailerSku || "").toUpperCase()
    ? identity.canonicalUrl
    : "";
}

function notificationRoute(value) {
  const canonicalUrl = exactRetailerNotificationUrl(value?.canonicalUrl, value?.retailerId, value?.retailerSku);
  if (!canonicalUrl) return "";
  try {
    const attribution = new URL(String(value?.attributionUrl || ""));
    if (attribution.protocol !== "https:" || attribution.username || attribution.password) return canonicalUrl;
    if (value.retailerId === "amazon") {
      const direct = exactRetailerNotificationUrl(attribution.href, value.retailerId, value.retailerSku);
      const parameters = [...attribution.searchParams.keys()];
      if (direct && parameters.length === 1 && parameters[0] === "tag"
        && /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(String(attribution.searchParams.get("tag") || ""))) {
        attribution.hash = "";
        return attribution.href;
      }
      return canonicalUrl;
    }
    if (attribution.hostname !== "howl.link" || attribution.pathname !== "/link") return canonicalUrl;
    const destination = exactRetailerNotificationUrl(
      attribution.searchParams.get("url"),
      value.retailerId,
      value.retailerSku
    );
    return destination === canonicalUrl ? attribution.href : canonicalUrl;
  } catch {
    return canonicalUrl;
  }
}

function normalizedNotificationLease(value) {
  const notification = value?.notification;
  if (!notification || typeof notification !== "object") return null;
  const id = String(notification.id || "");
  const capabilityToken = String(notification.capabilityToken || "");
  const expiresAt = String(notification.expiresAt || "");
  const route = notificationRoute(notification);
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(id)
    || !/^[A-Za-z0-9_-]{40,100}$/.test(capabilityToken)
    || notification.action !== "notify"
    || !route
    || !Number.isFinite(new Date(expiresAt).getTime())
    || new Date(expiresAt).getTime() <= Date.now()) {
    throw new Error("Yoink returned an invalid notification delivery.");
  }
  return {
    id,
    capabilityToken,
    title: String(notification.title || "Yoink opportunity").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "Yoink opportunity",
    message: String(notification.message || "A strategy matched.").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) || "A strategy matched.",
    route
  };
}

async function notificationHistory() {
  const value = (await chrome.storage.local.get(NOTIFICATION_HISTORY_KEY))[NOTIFICATION_HISTORY_KEY];
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && /^[A-Za-z0-9_-]{3,160}$/.test(entry)).slice(-200)
    : [];
}

async function notificationRoutes() {
  const value = (await chrome.storage.local.get(NOTIFICATION_ROUTES_KEY))[NOTIFICATION_ROUTES_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([id, route]) => /^[A-Za-z0-9_-]{3,160}$/.test(id) && typeof route === "string" && route.length <= 4_096)
    .slice(-100));
}

async function rememberNotification(notification) {
  const history = await notificationHistory();
  const routes = await notificationRoutes();
  const nextHistory = [...history.filter((id) => id !== notification.id), notification.id].slice(-200);
  const nextRoutes = Object.fromEntries([
    ...Object.entries(routes).filter(([id]) => id !== notification.id),
    [notification.id, notification.route]
  ].slice(-100));
  await chrome.storage.local.set({
    [NOTIFICATION_HISTORY_KEY]: nextHistory,
    [NOTIFICATION_ROUTES_KEY]: nextRoutes
  });
}

async function acknowledgeNotification(device, notification, outcome, failureCode = "") {
  return request(`/devices/self/notifications/${encodeURIComponent(notification.id)}/ack`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({ capabilityToken: notification.capabilityToken, outcome, failureCode })
  });
}

async function runNotificationCycle() {
  if (notificationCyclePromise) return notificationCyclePromise;
  notificationCyclePromise = (async () => {
    const state = await checkHealth();
    if (!state.connected || !state.paired) return;
    const device = await storedDevice();
    if (!device?.token) return;
    const payload = await request("/devices/self/notifications/next", {
      headers: { Authorization: `Bearer ${device.token}` }
    });
    const notification = normalizedNotificationLease(payload);
    if (!notification) return;
    const history = await notificationHistory();
    if (history.includes(notification.id)) {
      await acknowledgeNotification(device, notification, "delivered");
      return;
    }
    let shown = false;
    try {
      await chrome.notifications.create(`yoink-opportunity:${notification.id}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("yoink-icon.svg"),
        title: notification.title,
        message: notification.message,
        contextMessage: "Yoink strategy match",
        priority: 2
      });
      shown = true;
      await rememberNotification(notification);
      await acknowledgeNotification(device, notification, "delivered");
    } catch {
      if (!shown) await acknowledgeNotification(device, notification, "failed", "chrome_notification_failed").catch(() => undefined);
      throw new Error("Chrome notification delivery failed.");
    }
  })().catch(() => undefined).finally(() => { notificationCyclePromise = null; });
  return notificationCyclePromise;
}

async function reportNotificationInteraction(deliveryId, interaction) {
  const device = await storedDevice();
  if (!device?.token) return;
  await request(`/devices/self/notifications/${encodeURIComponent(deliveryId)}/interaction`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({ interaction })
  }).catch(() => undefined);
}

async function runJobCycle() {
  if (jobCyclePromise) return jobCyclePromise;
  jobCyclePromise = (async () => {
    if (await resumeActiveRetailerJob()) return;
    const state = await checkHealth();
    if (!state.connected || !state.paired || state.executionMode !== "live" || state.actionsPaused || !state.chromeMutationEnabled) return;
    const [targetAccess, walmartAccess, amazonAccess, bestBuyAccess] = await Promise.all([
      addLaneAccess("target"),
      addLaneAccess("walmart"),
      addLaneAccess("amazon"),
      addLaneAccess("bestbuy")
    ]);
    if (!targetAccess && !walmartAccess && !amazonAccess && !bestBuyAccess) return;
    const device = await storedDevice();
    if (!device?.token) return;
    const response = await request("/devices/self/jobs/next", {
      headers: { Authorization: `Bearer ${device.token}` }
    });
    const lease = normalizedLeaseJob(response);
    if (lease) await executeLeasedRetailerJob(lease);
  })().catch(() => undefined).finally(() => { jobCyclePromise = null; });
  return jobCyclePromise;
}

async function handleTrackalackerPushEvent(event) {
  const state = await readTrackalackerState();
  if (!state.enabled || !TrackalackerPush) return;
  let payload = null;
  try { payload = event.data?.json(); } catch { payload = null; }
  const receivedAt = new Date().toISOString();
  const signalId = `push:trackalacker:${crypto.randomUUID()}`;
  let visibleNotificationRequired = true;
  try {
    const subscription = await globalThis.registration?.pushManager?.getSubscription?.();
    visibleNotificationRequired = subscription?.options?.userVisibleOnly !== false;
  } catch {
    visibleNotificationRequired = true;
  }
  if (visibleNotificationRequired) {
    const presentation = TrackalackerPush.notificationPresentation(payload, signalId);
    await globalThis.registration?.showNotification?.(presentation.title, presentation.options).catch(() => undefined);
  }
  const envelope = TrackalackerPush.signalEnvelopeFromPush(payload, signalId, receivedAt, chrome.runtime.id);
  if (!envelope) {
    const failed = await updateTrackalackerState({ lastNotificationAt: receivedAt, errorCode: "signal_delivery_rejected" });
    await postTrackalackerStatus(failed);
    return;
  }
  await mutateTrackalackerQueue((current) => current.some((entry) => entry.signalId === envelope.signalId)
    ? current : [...current, envelope]);
  const next = await updateTrackalackerState({ lastNotificationAt: receivedAt, errorCode: "" });
  await postTrackalackerStatus(next);
  await drainTrackalackerQueue();
}

async function handleTrackalackerSubscriptionChange() {
  const current = await readTrackalackerState();
  const state = await updateTrackalackerState({
    registeredFingerprint: "",
    ready: false,
    subscriptionPresent: false,
    state: current.enabled ? "awaiting_page" : "disabled",
    errorCode: ""
  });
  await postTrackalackerStatus(state);
  if (!current.enabled) return;
  const allowed = await chrome.permissions.contains({ origins: TRACKALACKER_ORIGINS }).catch(() => false);
  if (!allowed) return;
  const tabs = await chrome.tabs.query({ url: TRACKALACKER_ORIGINS }).catch(() => []);
  if (tabs.some((tab) => Number.isInteger(tab?.id))) await connectTrackalacker(false).catch(() => undefined);
}

async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.alarms.create(HEALTH_ALARM, { periodInMinutes: 1 });
  await chrome.alarms.create(JOB_ALARM, { periodInMinutes: 0.5 });
  await checkHealth();
  await drainAdapterDiagnosticQueue();
  await drainTrackalackerQueue();
  await runNotificationCycle();
  await runJobCycle();
}

chrome.runtime.onInstalled.addListener(() => { void initialize(); });
chrome.runtime.onStartup.addListener(() => { void initialize(); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEALTH_ALARM) {
    void checkHealth();
    void drainAdapterDiagnosticQueue();
    void drainTrackalackerQueue();
    void runNotificationCycle();
  }
  if (alarm.name === JOB_ALARM) {
    void runNotificationCycle();
    void runJobCycle();
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const inspection = message?.type === "yoink:inspect-target";
  const walmartDrawInspection = message?.type === "yoink:inspect-walmart-draw";
  const retailerInspection = message?.type === "yoink:inspect-retailer";
  const communityContribution = message?.type === "yoink:contribute-retailer";
  const rehearsal = message?.type === "yoink:rehearse-target";
  const walmartRehearsal = message?.type === "yoink:rehearse-walmart";
  const amazonRehearsal = message?.type === "yoink:rehearse-amazon";
  const bestBuyRehearsal = message?.type === "yoink:rehearse-bestbuy";
  const trackalackerConnection = message?.type === "yoink:connect-trackalacker";
  const trackalackerSync = message?.type === "yoink:sync-trackalacker";
  const extensionUpdate = message?.type === "yoink:check-update";
  const contentOperation = [
    "yoink:resolve-trackalacker-listing",
    "yoink:trackalacker-sync-progress",
    "yoink:trackalacker-sync-item"
  ].includes(message?.type);
  const pageOperation = inspection || walmartDrawInspection || retailerInspection || communityContribution || rehearsal || walmartRehearsal || amazonRehearsal || bestBuyRehearsal || trackalackerConnection || trackalackerSync || extensionUpdate || contentOperation;
  const operation = message?.type === "yoink:check-health"
    ? checkHealth()
    : message?.type === "yoink:pair-device"
      ? pairDevice(message.code)
      : message?.type === "yoink:forget-device"
        ? forgetDevice()
        : inspection
          ? inspectTargetTab()
          : walmartDrawInspection
            ? inspectWalmartDrawHubTab()
          : retailerInspection
            ? inspectRetailerTab()
          : communityContribution
            ? contributeRetailerTab()
          : rehearsal
            ? rehearseTargetTab()
            : walmartRehearsal
              ? rehearseWalmartTab()
            : amazonRehearsal
              ? rehearseAmazonTab()
            : bestBuyRehearsal
              ? rehearseBestBuyTab()
            : trackalackerConnection
              ? connectTrackalacker(false)
              : trackalackerSync
                ? startTrackalackerSync()
                : extensionUpdate
                  ? checkExtensionUpdate(message.download === true)
                : message?.type === "yoink:resolve-trackalacker-listing"
                  ? resolveTrackalackerListing(message, sender)
                  : message?.type === "yoink:trackalacker-sync-progress"
                    ? recordTrackalackerSyncProgress(message, sender)
                    : message?.type === "yoink:trackalacker-sync-item"
                      ? acceptTrackalackerSyncItem(message, sender)
            : null;
  if (!operation) return false;
  operation.then((result) => sendResponse(pageOperation ? { ok: true, ...result } : { ok: true, state: result })).catch((error) => {
    sendResponse({ ok: false, message: error instanceof Error ? error.message : "The companion request failed." });
  });
  return true;
});

self.addEventListener("push", (event) => {
  event.waitUntil(handleTrackalackerPushEvent(event));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(handleTrackalackerSubscriptionChange());
});

self.addEventListener("notificationclick", (event) => {
  if (event.notification?.data?.yoinkTrackalacker !== true) return;
  event.notification.close();
  const url = TrackalackerPush?.notificationUrl(event.notification?.data?.url) || TRACKALACKER_SETTINGS_URL;
  event.waitUntil(chrome.tabs.create({ url, active: true }));
});

function trustedStoredNotificationRoute(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return "";
    const allowedRetailer = SUPPORTED_RETAILER_DOMAINS
      .some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    if (allowedRetailer) {
      if (url.hostname === "amazon.com" || url.hostname.endsWith(".amazon.com")) {
        const keys = [...url.searchParams.keys()];
        if (keys.length && (keys.length !== 1 || keys[0] !== "tag"
          || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(String(url.searchParams.get("tag") || "")))) return "";
      }
      return url.href;
    }
    if (url.hostname !== "howl.link" || url.pathname !== "/link") return "";
    const destination = new URL(String(url.searchParams.get("url") || ""));
    if (destination.protocol !== "https:" || destination.username || destination.password) return "";
    const destinationAllowed = SUPPORTED_RETAILER_DOMAINS
      .some((domain) => destination.hostname === domain || destination.hostname.endsWith(`.${domain}`));
    return destinationAllowed ? url.href : "";
  } catch {
    return "";
  }
}

chrome.notifications?.onClicked?.addListener((notificationId) => {
  const match = /^yoink-opportunity:([A-Za-z0-9_-]{3,160})$/.exec(String(notificationId || ""));
  if (!match) return;
  const deliveryId = match[1];
  void (async () => {
    const routes = await notificationRoutes();
    const route = trustedStoredNotificationRoute(routes[deliveryId]);
    await reportNotificationInteraction(deliveryId, "clicked");
    if (route) await chrome.tabs.create({ url: route, active: true });
    await chrome.notifications.clear(notificationId).catch(() => undefined);
  })();
});

chrome.notifications?.onClosed?.addListener((notificationId, byUser) => {
  if (!byUser) return;
  const match = /^yoink-opportunity:([A-Za-z0-9_-]{3,160})$/.exec(String(notificationId || ""));
  if (match) void reportNotificationInteraction(match[1], "dismissed");
});
