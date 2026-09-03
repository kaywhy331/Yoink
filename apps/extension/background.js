"use strict";

importScripts("runtime-config.js", "popup-state.js", "trackalacker-push.js", "observer-recipe-root.js");

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
const PopupState = globalThis.YoinkPopupStateModule;
if (!PopupState?.classifyPageContext || !PopupState?.qualificationPopupResult
  || !PopupState?.appDestinationUrl || !PopupState?.cartReadyState
  || !PopupState?.preferredActionHandoff || !PopupState?.CART_READY_STORAGE_KEY) {
  throw new Error("Yoink Companion has no packaged popup state model.");
}
const API_ROOT = `${RUNTIME_CONFIG.apiOrigin}/api/v1`;
const APP_ROOT = RUNTIME_CONFIG.appOrigin;
const LOCAL_PACKAGE_UPDATES = RUNTIME_CONFIG.localPackageUpdates;
const EVIDENCE_REQUEST_TIMEOUT_MS = 10_000;
const HEALTH_ALARM = "yoink-health";
const JOB_ALARM = "yoink-jobs";
const WATCH_QUEUE_ALARM = "yoink-watch-queue";
const AUTO_REVERIFICATION_ALARM = "yoink-auto-reverification";
const MAX_ACTION_JOBS_PER_CYCLE = 4;
const ACTION_JOB_WAIT_MS = 25_000;
const ACTION_JOB_REQUEST_TIMEOUT_MS = 28_000;
const ACTION_HANDOFF_WAIT_MS = 25_000;
const ACTION_HANDOFF_REQUEST_TIMEOUT_MS = 28_000;
const NOTIFICATION_WAIT_MS = 25_000;
const NOTIFICATION_REQUEST_TIMEOUT_MS = 28_000;
const MAX_NOTIFICATIONS_PER_CYCLE = 20;
const POST_CLICK_SETTLE_MAX_MS = 1_500;
const POST_CLICK_SETTLE_QUIET_MS = 125;
const POST_CLICK_SETTLE_MIN_MS = 300;
const CART_DOM_RETRY_QUIET_MS = 60;
const CART_DOM_RETRY_FALLBACK_MS = 250;
const CART_BASELINE_WAIT_MAX_MS = 1_500;
const CART_PROOF_WAIT_MAX_MS = 2_250;
const WARM_CART_BASELINE_WAIT_MAX_MS = 350;
const CART_BASELINE_MAX_AGE_MS = 5 * 60_000;
const WARM_READINESS_LANES_PER_CYCLE = 2;
const AUTO_REVERIFICATION_PERIOD_MINUTES = 6 * 60;
const AUTO_REVERIFICATION_COOLDOWN_MS = 24 * 60 * 60_000;
const MAX_REVERIFICATION_CANDIDATES_PER_LANE = 8;
const POST_CLICK_SETTLE_STATE_KEY = "__yoinkPostClickSettleV1";
const READINESS_KEY = "readiness";
const POPUP_RESULT_STORAGE_KEY = PopupState.POPUP_RESULT_STORAGE_KEY;
const POPUP_UPDATE_HANDOFF_STORAGE_KEY = PopupState.POPUP_UPDATE_HANDOFF_STORAGE_KEY;
const CART_READY_STORAGE_KEY = PopupState.CART_READY_STORAGE_KEY;
const ACTION_HANDOFF_AVAILABILITY_VERSION_KEY = "yoinkActionHandoffAvailabilityVersionV1";
const DEVICE_KEY = "pairedDevice";
const ACTIVE_JOB_KEY = "activeRetailerJobV1";
const LEGACY_ACTIVE_TARGET_JOB_KEY = "activeTargetJob";
const RETAILER_ACTION_TABS_KEY = "yoinkRetailerActionTabsV1";
const WARM_READINESS_CURSOR_KEY = "yoinkWarmReadinessCursorV1";
const WATCH_QUEUE_STATE_KEY = "yoinkWatchQueueStateV1";
const WATCH_QUEUE_LEASE_KEY = "yoinkWatchQueueLeaseV1";
const REVERIFICATION_STATE_KEY = "yoinkRetailerReverificationStateV1";
const AUTO_REVERIFICATION_SETTINGS_KEY = "yoinkAutoReverificationSettingsV1";
const ORDER_HANDOFF_KEY = "yoinkOrderHandoffsV1";
const CART_READY_SOUND_KEY = "yoinkCartReadySoundEnabledV1";
const TRACKALACKER_PUSH_STATE_KEY = "yoinkTrackalackerPushStateV1";
const TRACKALACKER_PUSH_QUEUE_KEY = "yoinkTrackalackerPushQueueV1";
const TRACKALACKER_SYNC_STATE_KEY = "yoinkTrackalackerSyncStateV1";
const NOTIFICATION_HISTORY_KEY = "yoinkNotificationHistoryV1";
const NOTIFICATION_ROUTES_KEY = "yoinkNotificationRoutesV1";
const CART_READY_NOTIFICATION_PREFIX = "yoink-cart-ready:";
const NEEDS_YOU_NOTIFICATION_PREFIX = "yoink-needs-you:";
const COMMUNITY_CONTRIBUTION_TIMES_KEY = "yoinkCommunityContributionTimesV1";
const LEGACY_OBSERVER_RECIPE_KEY_PIN = "yoinkObserverRecipeKeyPinV1";
const OBSERVER_RECIPE_TRUST_STATE_KEY = "yoinkObserverRecipeTrustStateV1";
const OBSERVER_RECIPE_STATUS_KEY = "yoinkObserverRecipeStatusV1";
const ADAPTER_DIAGNOSTIC_QUEUE_KEY = "yoinkAdapterDiagnosticQueueV1";
const COMMUNITY_CONTRIBUTION_INTERVAL_MS = 60_000;
const CONTEXT_MENU_IDS = Object.freeze({
  open: "yoink-open",
  inspectProduct: "yoink-inspect-product",
  inspectDrawings: "yoink-inspect-drawings",
  reconnect: "yoink-reconnect-trackalacker",
  sync: "yoink-sync-products",
  settings: "yoink-settings"
});
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
const TARGET_OBSERVER_VERSION = "target-observer-v5";
const RETAILER_OBSERVER_VERSIONS = {
  walmart: "walmart-observer-v7",
  amazon: "amazon-observer-v8",
  bestbuy: "bestbuy-observer-v10",
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
const TARGET_ADD_ADAPTER_VERSION = "target-add-v7";
const WALMART_ADD_ADAPTER_VERSION = "walmart-add-v8";
const WALMART_DRAW_OBSERVER_VERSION = "walmart-draw-observer-v1";
const AMAZON_ADD_ADAPTER_VERSION = "amazon-add-v9";
const BESTBUY_ADD_ADAPTER_VERSION = "bestbuy-add-v11";
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
    baselineOperation: "inspectTargetCartBaseline",
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
    baselineOperation: "inspectWalmartCartBaseline",
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
    baselineOperation: "inspectAmazonCartBaseline",
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
    baselineOperation: "inspectBestBuyCartBaseline",
    prepareOperation: "prepareBestBuyAdd",
    commitOperation: "commitBestBuyAdd",
    verifyCartOperation: "verifyBestBuyAddedCart"
  })
});
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const TrackalackerPush = globalThis.YoinkTrackalackerPush;
const ObserverRecipeRoot = globalThis.YoinkObserverRecipeRoot;
let jobCyclePromise = null;
let watchQueueCyclePromise = null;
let warmReadinessCyclePromise = null;
let warmReadinessRequestPromise = null;
let automaticReverificationPromise = null;
let retailerReverificationPromise = null;
let signalJobHandoffPromise = null;
let notificationCyclePromise = null;
let notificationCyclePendingWaitMs = -1;
let notificationRouteActionQueue = Promise.resolve();
let trackalackerEnrollmentPromise = null;
let trackalackerDrainPromise = null;
let trackalackerStateQueue = Promise.resolve();
let trackalackerQueueQueue = Promise.resolve();
let cartReadyStateQueue = Promise.resolve();
let actionHandoffReconciliationPromise = null;
let actionHandoffReconciliationPendingWaitMs = 0;
const retailerSessionRefreshes = new Map();
let offscreenDocumentPromise = null;
let adapterDiagnosticDrainPromise = null;
let adapterDiagnosticQueueLock = Promise.resolve();
let deviceCredentialRotationPromise = null;

function readiness(connected, details = {}, device = null) {
  const communitySharingRetailers = Array.isArray(details.communitySharingRetailers)
    ? [...new Set(details.communitySharingRetailers
      .map((value) => String(value || ""))
      .filter((value) => value === "target" || Object.hasOwn(RETAILER_OBSERVER_VERSIONS, value)))]
    : [];
  return {
    connected,
    paired: Boolean(device?.id),
    deviceName: typeof device?.name === "string" ? device.name.slice(0, 100) : "",
    checkedAt: new Date().toISOString(),
    version: typeof details.version === "string" ? details.version.slice(0, 40) : "",
    executionMode: details.executionMode === "live" ? "live" : "shadow",
    actionsPaused: details.actionsPaused !== false,
    chromeMutationEnabled: details.chromeMutationEnabled === true,
    targetAddExecutionEnabled: details.targetAddExecutionEnabled === true,
    walmartAddExecutionEnabled: details.walmartAddExecutionEnabled === true,
    amazonAddExecutionEnabled: details.amazonAddExecutionEnabled === true,
    bestBuyAddExecutionEnabled: details.bestBuyAddExecutionEnabled === true,
    targetAddCapable: true,
    walmartAddCapable: true,
    amazonAddCapable: true,
    bestBuyAddCapable: true,
    targetShadowAccess: details.targetShadowAccess === true,
    communitySharingRetailers,
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
    observerRecipeRecoveryEvidence: true,
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

function extensionUpdateHandoff(channel, releaseVersion) {
  return PopupState.popupUpdateHandoff?.({ channel, releaseVersion }) || null;
}

async function persistExtensionUpdateHandoff(channel, releaseVersion) {
  const handoff = extensionUpdateHandoff(channel, releaseVersion);
  if (!handoff || !POPUP_UPDATE_HANDOFF_STORAGE_KEY) return null;
  await chrome.storage.session.set({ [POPUP_UPDATE_HANDOFF_STORAGE_KEY]: handoff });
  return handoff;
}

async function checkExtensionUpdate(download = false, requestManaged = false) {
  if (!LOCAL_PACKAGE_UPDATES) {
    let managedResult = null;
    if (requestManaged) {
      if (typeof chrome.runtime.requestUpdateCheck !== "function") {
        throw new Error("Chrome update checks are unavailable in this browser.");
      }
      managedResult = await chrome.runtime.requestUpdateCheck();
    }
    const managedStatus = ["throttled", "no_update", "update_available"].includes(managedResult?.status)
      ? managedResult.status : "";
    const releaseVersion = comparableVersion(managedResult?.version)
      ? String(managedResult.version) : EXTENSION_VERSION;
    const updateAvailable = managedStatus === "update_available";
    const handoff = updateAvailable && comparableVersion(managedResult?.version)
      ? await persistExtensionUpdateHandoff("managed", releaseVersion) : null;
    return {
      update: {
        installedVersion: EXTENSION_VERSION,
        releaseVersion,
        updateAvailable,
        packageReady: false,
        sha256: "",
        sizeBytes: 0,
        downloadUrl: "",
        downloadStarted: false,
        channel: "managed",
        managedByBrowser: true,
        ...(managedStatus ? { managedStatus } : {}),
        ...(handoff ? { handoff } : {})
      }
    };
  }
  const release = normalizedExtensionRelease(await request("/extension/release", {}, 10_000));
  let downloadStarted = false;
  let handoff = null;
  if (download && release.updateAvailable && release.packageReady) {
    handoff = await persistExtensionUpdateHandoff("local", release.releaseVersion);
    await chrome.tabs.create({ url: release.downloadUrl, active: true });
    downloadStarted = true;
  }
  return { update: { ...release, downloadStarted, ...(handoff ? { handoff } : {}) } };
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
  "verified", "dom_hydration_recovered", "semantic_layout_recovered",
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
  "authorization_expired", "add_control_changed", "fulfillment_selection_failed", "offer_binding_changed", "click_failed",
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
    ? observerVersionForRetailer(retailerId)
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
    || (outcome === "passed" && reasonCode === "semantic_layout_recovered")
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
    adapterVersion: observerVersionForRetailer(identity.retailerId),
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

function observerVersionForRetailer(retailerId) {
  return retailerId === "target" ? TARGET_OBSERVER_VERSION : RETAILER_OBSERVER_VERSIONS[retailerId];
}

const EXPECTED_LIVE_REJECTIONS = new Set([
  "manual_action_required", "out_of_stock", "third_party_seller", "signal_seller_mismatch",
  "over_unit_cap", "fulfillment_not_supported", "seller_policy_not_supported",
  "quantity_not_supported", "unsupported_action", "job_expired"
]);

function runnerFailureStage(reasonCode) {
  if (["offer_id_missing_or_ambiguous", "offer_binding_changed"].includes(reasonCode)) return "offer_binding";
  if (["add_control_unavailable", "add_control_changed"].includes(reasonCode)) return "add_control";
  if (reasonCode === "seller_unverified") return "seller_binding";
  if (reasonCode === "price_unavailable") return "price_binding";
  if (["fulfillment_unverified", "fulfillment_selection_failed"].includes(reasonCode)) return "fulfillment_binding";
  if (["listing_mismatch", "product_page_unverified"].includes(reasonCode)) return "page_identity";
  if (reasonCode === "manual_action_required") return "interactive_block";
  if (EXPECTED_LIVE_REJECTIONS.has(reasonCode)) return "policy";
  return "runner";
}

async function recordTabOperationDiagnostic(tabId, retailerId, operation, outcome, failureStage, reasonCode, requiredFulfillment = "shipping") {
  if (!["target", "walmart", "amazon", "bestbuy"].includes(retailerId)) return null;
  const device = await storedDevice();
  if (!device?.token) throw new Error("The paired Chrome device is unavailable for adapter diagnostics.");
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: [retailerId === "target" ? "target-shadow.js" : "retailer-shadow.js"]
  });
  const injections = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: ["collectOperationDiagnostic", retailerId, requiredFulfillment === "pickup" ? "pickup" : "shipping"],
    func: (_operationName, exactRetailerId, exactFulfillment) => {
      try {
        if (exactRetailerId === "target") {
          const observer = globalThis.YoinkTargetShadow;
          if (!observer || typeof observer.collectTargetShadowAttempt !== "function") {
            return { ok: false, message: "The Target shadow observer is unavailable." };
          }
          return { ok: true, diagnostic: observer.collectTargetShadowAttempt(document, location.href, exactFulfillment).diagnostic };
        }
        const observer = globalThis.YoinkRetailerShadow;
        if (!observer || typeof observer.collectRetailerShadowAttempt !== "function") {
          return { ok: false, message: "The retailer shadow observer is unavailable." };
        }
        return { ok: true, diagnostic: observer.collectRetailerShadowAttempt(document, location.href, exactRetailerId, exactFulfillment).diagnostic };
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
      throw new Error("Yoink did not acknowledge the Chrome companion request before its safety timeout.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function settleRequiredWork(...promises) {
  const results = await Promise.allSettled(promises);
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  return results.map((result) => result.value);
}

function actionJobLeaseRequest(index, accessibleRetailers = null) {
  const waitMs = index === 0 ? ACTION_JOB_WAIT_MS : 0;
  const retailers = Array.isArray(accessibleRetailers)
    ? [...new Set(accessibleRetailers.map((value) => String(value || "").toLowerCase())
      .filter((value) => Object.hasOwn(ADD_LANES, value)))].slice(0, 4)
    : null;
  return {
    path: `/devices/self/jobs/next?wait=${waitMs}${retailers === null ? "" : `&retailers=${retailers.join(",")}`}`,
    timeoutMs: waitMs > 0 ? ACTION_JOB_REQUEST_TIMEOUT_MS : 3_000
  };
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
    throw new Error("The signed observer recipe payload is incompatible with this Chrome companion.");
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

function boundedObserverRecoveryEvidence(value, fieldOutcomes) {
  if (!Array.isArray(value) || value.length > 5) {
    throw new Error("The packaged observer recipe oracle returned invalid recovery evidence.");
  }
  const order = new Map(["availability", "unitPrice", "seller", "fulfillment", "addControl"]
    .map((field, index) => [field, index]));
  const evidence = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(["field", "normalizedValue"].sort())
      || !order.has(item.field)) {
      throw new Error("The packaged observer recipe oracle returned invalid recovery evidence.");
    }
    const normalizedValue = item.normalizedValue;
    if (item.field === "availability" && !["in_stock", "preorder", "out_of_stock"].includes(normalizedValue)) {
      throw new Error("The packaged observer recipe oracle returned invalid recovery evidence.");
    }
    if (item.field === "unitPrice" && (!Number.isSafeInteger(normalizedValue)
      || normalizedValue <= 0 || normalizedValue > 100_000_000)) {
      throw new Error("The packaged observer recipe oracle returned invalid recovery evidence.");
    }
    if (item.field === "seller") {
      const seller = String(normalizedValue || "");
      const lower = seller.toLocaleLowerCase("en-US");
      const forbidden = ["password", "payment", "credit card", "card number", "cvv", "address", "email", "phone", "cookie", "token"];
      if (!seller || seller.length > 160 || seller !== lower || seller.trim() !== seller
        || !/^[\p{L}\p{N} .,&'()_+-]+$/u.test(seller)
        || seller.includes("@") || /https?:|\d{12,}/i.test(seller)
        || forbidden.some((term) => lower.includes(term))) {
        throw new Error("The packaged observer recipe oracle returned invalid recovery evidence.");
      }
    }
    if (item.field === "fulfillment" && !["shipping", "pickup"].includes(normalizedValue)) {
      throw new Error("The packaged observer recipe oracle returned invalid recovery evidence.");
    }
    if (item.field === "addControl" && typeof normalizedValue !== "boolean") {
      throw new Error("The packaged observer recipe oracle returned invalid recovery evidence.");
    }
    return { field: item.field, normalizedValue };
  }).sort((left, right) => Number(order.get(left.field)) - Number(order.get(right.field)));
  const eligibleFields = fieldOutcomes.filter((item) => item?.recipeState === "value"
    && item.packagedState === "missing" && item.oracleState === "agreed"
    && item.disposition === "verified").map((item) => item.field).sort();
  const recoveredFields = evidence.map((item) => item.field).sort();
  if (new Set(recoveredFields).size !== recoveredFields.length
    || JSON.stringify(recoveredFields) !== JSON.stringify(eligibleFields)) {
    throw new Error("The packaged observer recipe oracle returned inconsistent recovery evidence.");
  }
  return evidence;
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
  return { ...result, recoveryEvidence: boundedObserverRecoveryEvidence(result.recoveryEvidence, result.fieldOutcomes) };
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
        contractVersion: 3,
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
        recoveryEvidence: evaluation.recoveryEvidence,
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
    "signal_delivery_retryable",
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

async function sendTrackalackerBatch(envelopes) {
  const device = await storedDevice();
  if (!device?.token) return { delivered: false, retryable: true, status: 401 };
  try {
    const payload = await request("/devices/self/sources/trackalacker/signals/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({
        signals: envelopes.map((envelope) => ({ ...envelope, idempotencyKey: envelope.signalId }))
      })
    }, 5_000);
    const receipts = Array.isArray(payload?.receipts) ? payload.receipts : [];
    if (receipts.length !== envelopes.length) throw new Error("Yoink returned an incomplete signal batch receipt.");
    return {
      delivered: true,
      retryable: false,
      status: 202,
      acceptedIds: receipts.filter((receipt) => receipt?.accepted === true)
        .map((receipt) => envelopes[Number(receipt.index)]?.signalId).filter(Boolean),
      rejectedIds: receipts.filter((receipt) => receipt?.accepted !== true && receipt?.retryable !== true)
        .map((receipt) => envelopes[Number(receipt.index)]?.signalId).filter(Boolean),
      retryableIds: receipts.filter((receipt) => receipt?.accepted !== true && receipt?.retryable === true)
        .map((receipt) => envelopes[Number(receipt.index)]?.signalId).filter(Boolean)
    };
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
    const attemptedIds = new Set();
    while (true) {
      const queue = await readTrackalackerQueue();
      const batch = queue.filter((entry) => !attemptedIds.has(entry.signalId)).slice(0, 20);
      if (!batch.length) break;
      const result = await sendTrackalackerBatch(batch);
      if (result.delivered) {
        const completed = new Set([...(result.acceptedIds || []), ...(result.rejectedIds || [])]);
        for (const signalId of result.retryableIds || []) attemptedIds.add(signalId);
        await mutateTrackalackerQueue((current) => current.filter((entry) => !completed.has(entry.signalId)));
        delivered += result.acceptedIds?.length || 0;
        await updateTrackalackerState({
          lastDeliveryAt: new Date().toISOString(),
          lastHttpStatus: result.status,
          errorCode: result.retryableIds?.length
            ? "signal_delivery_retryable"
            : result.rejectedIds?.length ? "signal_delivery_rejected" : ""
        });
        continue;
      }
      if (!result.retryable && result.status) {
        const failedIds = new Set(batch.map((entry) => entry.signalId));
        await mutateTrackalackerQueue((current) => current.filter((entry) => !failedIds.has(entry.signalId)));
        await updateTrackalackerState({ errorCode: "signal_delivery_rejected", lastHttpStatus: result.status });
        continue;
      }
      await updateTrackalackerState({
        errorCode: result.status ? "signal_delivery_http" : "local_app_unreachable",
        lastHttpStatus: result.status
      });
      for (const entry of batch) attemptedIds.add(entry.signalId);
    }
    const next = await readTrackalackerState();
    return { delivered, state: next };
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
    await runSignalDeliveryCycle();
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
    await runSignalDeliveryCycle();
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

async function recordTrackalackerSyncSample(message, sender) {
  if (!senderIsTrackalacker(sender)) throw new Error("A signed-in TrackaLacker tab is required.");
  const current = await readTrackalackerSyncState();
  if (!current.syncId || String(message?.syncId || "") !== current.syncId) return { recorded: false };
  const device = await storedDevice();
  if (!device?.token) throw new Error("The paired Chrome device is unavailable.");
  return request("/devices/self/sources/trackalacker/catalog", {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({ syncId: current.syncId, rawSample: message.sample })
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

// Badge colours cannot read popup.css, so these mirror the dark-theme status
// tokens in apps/web/tokens.css (--theme-good-dark, --theme-warning-dark,
// --theme-bad-dark). Update both places together.
const BADGE_COLORS = Object.freeze({
  good: "#55e6b1",
  warning: "#ffca6b",
  bad: "#ff8a9a"
});

async function showBadge(state) {
  if (await showActionHandoffBadge(await readCartReadyState())) return;
  const color = !state.connected ? BADGE_COLORS.bad : state.paired ? BADGE_COLORS.good : BADGE_COLORS.warning;
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
      targetAddExecutionEnabled: controlPlane?.targetAddExecutionEnabled ?? health.targetAddExecutionEnabled,
      walmartAddExecutionEnabled: controlPlane?.walmartAddExecutionEnabled ?? health.walmartAddExecutionEnabled,
      amazonAddExecutionEnabled: controlPlane?.amazonAddExecutionEnabled ?? health.amazonAddExecutionEnabled,
      bestBuyAddExecutionEnabled: controlPlane?.bestBuyAddExecutionEnabled ?? health.bestBuyAddExecutionEnabled,
      communitySharingRetailers: controlPlane?.communitySharingRetailers,
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
  await updateContextMenuHealth(state);
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

async function deleteLocalCompanionData(confirmation) {
  if (confirmation !== "DELETE_ALL_LOCAL_YOINK_DATA") {
    throw new Error("Local data deletion requires deliberate confirmation.");
  }
  const device = await storedDevice();
  await globalThis.registration?.pushManager?.getSubscription?.()
    .then((subscription) => subscription?.unsubscribe?.()).catch(() => undefined);
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  const [retainedLocal, retainedSession] = await Promise.all([
    chrome.storage.local.get(null),
    chrome.storage.session.get(null)
  ]);
  const retainedKeys = [
    ...Object.keys(retainedLocal || {}).map((key) => `local:${key}`),
    ...Object.keys(retainedSession || {}).map((key) => `session:${key}`)
  ];
  if (retainedKeys.length) {
    throw new Error("Chrome retained local Yoink data. Close other Yoink extension pages and try again.");
  }
  await Promise.all([
    chrome.action.setBadgeText({ text: "" }),
    chrome.action.setTitle({ title: "Yoink Companion · Not paired" })
  ]).catch(() => undefined);
  let verified = false;
  if (device?.token && device?.id) {
    try {
      await request("/devices/self/privacy/local-deletion", {
        method: "POST",
        headers: { Authorization: `Bearer ${device.token}` },
        body: JSON.stringify({
          contractVersion: 1,
          localCleared: true,
          sessionCleared: true,
          retainedKeys
        })
      }, EVIDENCE_REQUEST_TIMEOUT_MS);
      verified = true;
    } catch {
      // Deletion is never rolled back merely because its remote receipt is unavailable.
    }
  }
  return { deleted: true, verified };
}

async function operationTab(tabId = null) {
  if (Number.isInteger(tabId)) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error("The exact retailer tab is no longer available.");
    return tab;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function inspectTargetTab(tabId = null) {
  if (!await targetShadowAccess()) throw new Error("Allow Target page access, then try again.");
  const device = await storedDevice();
  if (!device?.id || !device?.token) throw new Error("Pair this Chrome companion before inspecting Target.");
  const tab = await operationTab(tabId);
  if (!Number.isInteger(tab?.id) || !exactTargetProductUrl(tab.url)) {
    throw new Error("Open an exact Target product page in the active tab, then try again.");
  }
  const identity = { retailerId: "target", retailerSku: targetSkuFromUrl(tab.url) };
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      files: ["target-shadow.js"]
    });
  } catch {
    await reportObserverRuntimeFailure(device, identity, "observer_bundle_injection_failed");
    throw new Error("Yoink could not load the Target observer. Reload the extension and try again.");
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
        args: ["collectTargetShadowAttempt", attemptCount, domChanged],
        func: (_operationName, currentAttempt, changed) => {
          try {
            const observer = globalThis.YoinkTargetShadow;
            if (!observer || typeof observer.collectTargetShadowAttempt !== "function") {
              return { ok: false, reasonCode: "observer_runtime_unavailable" };
            }
            return { ok: true, ...observer.collectTargetShadowAttempt(document, location.href, "shipping", currentAttempt, changed) };
          } catch {
            return { ok: false, reasonCode: "observer_collection_failed" };
          }
        }
      });
    } catch {
      await reportObserverRuntimeFailure(device, identity, "observer_execution_failed", attemptCount, domChanged);
      throw new Error("Yoink could not inspect this Target page. Reload the page and try again.");
    }
    const result = injections.find((entry) => entry.frameId === 0)?.result;
    if (!result) {
      await reportObserverRuntimeFailure(device, identity, "observer_top_frame_missing", attemptCount, domChanged);
      throw new Error("Yoink could not inspect this Target page. Reload the page and try again.");
    }
    if (!result.ok) {
      const reasonCode = OBSERVER_RUNTIME_FAILURE_REASONS.has(result.reasonCode)
        ? result.reasonCode : "observer_collection_failed";
      await reportObserverRuntimeFailure(device, identity, reasonCode, attemptCount, domChanged);
      throw new Error("Yoink could not inspect this Target page. The failure was reported for repair.");
    }
    let observation;
    let diagnostic;
    try {
      observation = targetObservationPayload(result.observation);
      diagnostic = retailerDiagnosticPayload(result.diagnostic, "target", { attemptCount, domChanged });
    } catch {
      await reportObserverRuntimeFailure(device, identity, "observer_contract_invalid", attemptCount, domChanged);
      throw new Error("Yoink received invalid Target evidence. The failure was reported for repair.");
    }
    const layoutSignature = JSON.stringify(diagnostic.layout);
    if (priorLayout && priorLayout !== layoutSignature) domChanged = true;
    priorLayout = layoutSignature;
    attempts.push({ observation, diagnostic });
    const retryable = diagnostic.outcome !== "passed"
      && !diagnostic.layout.securityChallenge
      && !diagnostic.layout.interactiveBlock
      && observation.sellerType !== "third_party"
      && ["availability_binding", "add_control", "offer_binding", "price_binding", "seller_binding", "fulfillment_binding"]
        .includes(diagnostic.failureStage);
    if (!retryable || attemptCount === 3) break;
    await new Promise((resolve) => setTimeout(resolve, attemptCount === 1 ? 300 : 700));
  }
  const initial = attempts[0];
  const final = attempts.at(-1);
  if (!initial || !final) throw new Error("The Target page returned no shadow evidence.");
  const recovered = initial.diagnostic.outcome !== "passed" && final.diagnostic.outcome === "passed";
  const diagnostic = recovered
    ? retailerDiagnosticPayload(initial.diagnostic, "target", {
      outcome: "recovered",
      failureStage: initial.diagnostic.failureStage,
      reasonCode: "dom_hydration_recovered",
      attemptCount: attempts.length,
      domChanged
    })
    : retailerDiagnosticPayload(final.diagnostic, "target", {
      attemptCount: attempts.length,
      domChanged
    });
  const [payload, diagnosticPayload] = await Promise.all([
    request("/devices/self/shadow-observations/target", {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify(final.observation)
    }, EVIDENCE_REQUEST_TIMEOUT_MS),
    postRetailerDiagnostic(device, diagnostic)
  ]);
  const recipeTrial = await runObserverRecipeShadow(tab.id, "target", payload.observation, diagnosticPayload.diagnostic, device);
  return {
    state: await checkHealth(),
    observation: payload.observation,
    productIdentity: payload.productIdentity || null,
    diagnostic: diagnosticPayload.diagnostic,
    recipeTrial
  };
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

async function inspectRetailerTab(tabId = null) {
  const device = await storedDevice();
  if (!device?.id || !device?.token) throw new Error("Pair this Chrome companion before inspecting a retailer.");
  const tab = await operationTab(tabId);
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
            return { ok: true, ...observer.collectRetailerShadowAttempt(document, location.href, retailerId, "shipping", currentAttempt, changed) };
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
    productIdentity: observationPayload.productIdentity || null,
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

async function executeReadOnlyCartAction(tabId, retailerId, operation, args = [], timeoutMs = CART_BASELINE_WAIT_MAX_MS) {
  const lane = ADD_LANES[retailerId];
  if (!lane || ![lane.baselineOperation, lane.verifyCartOperation].includes(operation)) {
    return { ok: false, reason: "runner_unavailable" };
  }
  const boundedTimeoutMs = Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 3_000
    ? timeoutMs : CART_BASELINE_WAIT_MAX_MS;
  const injections = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: (operationName, operationArgs, globalName, waitMs, quietMs, fallbackMs) => new Promise((resolve) => {
      const runner = globalThis[globalName];
      const method = runner?.[operationName];
      if (typeof method !== "function") {
        resolve({ ok: false, reason: "runner_unavailable" });
        return;
      }
      const transientReasons = new Set(["cart_unverified", "quantity_unavailable"]);
      let finished = false;
      let mutationTimer;
      let fallbackTimer;
      let deadlineTimer;
      let observer;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(mutationTimer);
        clearInterval(fallbackTimer);
        clearTimeout(deadlineTimer);
        observer?.disconnect?.();
        resolve(result);
      };
      const inspect = (final = false) => {
        if (finished) return;
        let result;
        try {
          result = method(document, location.href, ...(operationArgs || []));
        } catch {
          result = { ok: false, reason: "runner_failed" };
        }
        if (!result || typeof result !== "object") result = { ok: false, reason: "runner_no_result" };
        const retryable = result.ok !== true && transientReasons.has(String(result.reason || ""));
        if (!retryable || final) finish(result);
      };
      const inspectAfterMutation = () => {
        if (finished || mutationTimer) return;
        mutationTimer = setTimeout(() => {
          mutationTimer = undefined;
          inspect(false);
        }, quietMs);
      };
      try {
        const root = document.documentElement || document;
        observer = new MutationObserver(inspectAfterMutation);
        observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
      } catch {
        observer = null;
      }
      // Mutation delivery is the fast path. A low-frequency in-page read is a
      // bounded fallback for state reflected through DOM properties or shadow
      // roots that do not notify the document observer.
      fallbackTimer = setInterval(() => inspect(false), fallbackMs);
      deadlineTimer = setTimeout(() => {
        clearTimeout(mutationTimer);
        mutationTimer = undefined;
        inspect(true);
      }, waitMs);
      inspect(false);
    }),
    args: [
      operation,
      args,
      lane.runnerGlobal,
      boundedTimeoutMs,
      CART_DOM_RETRY_QUIET_MS,
      CART_DOM_RETRY_FALLBACK_MS
    ]
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
    || !["in_stock", "preorder"].includes(observation.availability)
    || observation.addControlActionable !== true
    || Boolean(observation.securityChallenge || observation.interactiveBlock)
    || !Number.isSafeInteger(price)
    || price <= 0
    || observation.fulfillment !== "shipping"
    || observation.sellerType !== "first_party"
    || observation.sellerName !== "Target") {
    throw new Error("Open an available Target-sold product with Shipping or same-day Delivery available before running the no-click rehearsal.");
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

async function rehearseTargetTab(existingInspection = null, tabId = null) {
  const inspection = existingInspection || await inspectTargetTab(tabId);
  const observation = inspection.observation;
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this Chrome companion before rehearsing Target.");
  let job;
  try {
    job = targetRehearsalJob(observation);
  } catch (error) {
    const expectedPolicyRejection = observation.sellerType === "third_party"
      || !["in_stock", "preorder"].includes(observation.availability)
      || observation.fulfillment === "pickup"
      || Boolean(observation.securityChallenge || observation.interactiveBlock);
    const reasonCode = observation.securityChallenge || observation.interactiveBlock
      ? "manual_action_required"
      : !["in_stock", "preorder"].includes(observation.availability)
        ? "out_of_stock"
        : observation.sellerType === "third_party"
          ? "third_party_seller"
          : observation.fulfillment === "pickup"
            ? "fulfillment_not_supported"
            : safeReasonCode(inspection.diagnostic?.reasonCode || "offer_not_actionable");
    await postRetailerDiagnostic(device, operationDiagnostic(
      inspection.diagnostic,
      "target",
      "rehearse_add",
      expectedPolicyRejection ? "rejected" : "failed",
      expectedPolicyRejection ? (observation.securityChallenge || observation.interactiveBlock ? "interactive_block" : "policy")
        : inspection.diagnostic?.failureStage || "runner",
      reasonCode
    ));
    throw error;
  }
  const tab = await operationTab(tabId);
  if (!Number.isInteger(tab?.id)
    || targetSkuFromUrl(tab.url) !== observation.retailerSku) {
    throw new Error("Keep the inspected Target product page active while the no-click rehearsal runs.");
  }
  await injectTargetAction(tab.id);
  const result = await executeTargetAction(tab.id, "rehearseTargetAdd", [job]);
  const passed = result?.ok === true && result?.wouldClick === true;
  const reasonCode = passed ? "verified" : safeReasonCode(result?.reason);
  const manualRejection = reasonCode === "manual_action_required";
  const operationEvidence = operationDiagnostic(
    inspection.diagnostic,
    "target",
    "rehearse_add",
    passed ? "passed" : manualRejection ? "rejected" : "failed",
    passed ? "complete" : manualRejection ? "interactive_block" : runnerFailureStage(reasonCode),
    reasonCode
  );
  const [payload] = await Promise.all([
    request("/devices/self/qualification-trials/target-add", {
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
    }, EVIDENCE_REQUEST_TIMEOUT_MS),
    postRetailerDiagnostic(device, operationEvidence)
  ]);
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
    throw new Error("Open an available Walmart-sold product with shipping explicitly available before running the no-click rehearsal.");
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

async function rehearseWalmartTab(existingInspection = null, tabId = null) {
  const inspection = existingInspection || await inspectRetailerTab(tabId);
  const observation = inspection.observation;
  const job = walmartRehearsalJob(observation);
  const tab = await operationTab(tabId);
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
    throw new Error("Open an available Amazon.com-sold product with a unique shipping offer before running the no-click rehearsal.");
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

async function rehearseAmazonTab(existingInspection = null, tabId = null) {
  const inspection = existingInspection || await inspectRetailerTab(tabId);
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
  const tab = await operationTab(tabId);
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
    || !["in_stock", "preorder"].includes(observation.availability)
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
    if (observation?.securityChallenge) {
      throw new Error("Complete the visible Best Buy security check in this tab, then retry qualification.");
    }
    if (observation?.interactiveBlock === "auth") {
      throw new Error("Sign in to Best Buy in this tab, confirm your location, then retry qualification.");
    }
    if (observation?.interactiveBlock === "mfa") {
      throw new Error("Complete Best Buy account verification in this tab, then retry qualification.");
    }
    if (observation?.interactiveBlock === "location") {
      throw new Error("Confirm your Best Buy location and select Shipping, then retry qualification.");
    }
    if (observation?.fulfillment === "pickup") {
      throw new Error("Best Buy pickup evidence was recorded. Select Shipping on an available Best Buy-sold offer before rehearsing.");
    }
    throw new Error("Open an available offer explicitly sold by Best Buy, select Shipping, and verify a usable Add to cart or Pre-order control before rehearsing.");
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

async function rehearseBestBuyTab(existingInspection = null, tabId = null) {
  const inspection = existingInspection || await inspectRetailerTab(tabId);
  const observation = inspection.observation;
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this Chrome companion before rehearsing Best Buy.");
  let job;
  try {
    job = bestBuyRehearsalJob(observation);
  } catch (error) {
    const expectedPolicyRejection = observation.sellerType === "third_party"
      || !["in_stock", "preorder"].includes(observation.availability)
      || observation.fulfillment === "pickup"
      || Boolean(observation.securityChallenge || observation.interactiveBlock);
    const reasonCode = observation.securityChallenge || observation.interactiveBlock
      ? "manual_action_required"
      : !["in_stock", "preorder"].includes(observation.availability)
        ? "out_of_stock"
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
  const tab = await operationTab(tabId);
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

async function inspectAndQualifyActiveTab(tabId = null) {
  const tab = await operationTab(tabId);
  const popupPage = PopupState.classifyPageContext(tab?.url);
  const identity = canonicalRetailerIdentity(tab?.url);
  if (!identity || popupPage.kind !== "product"
    || popupPage.retailerId !== identity.retailerId
    || popupPage.sku !== identity.retailerSku) {
    throw new Error("Open an exact supported retailer product page first.");
  }
  const guardedRehearsals = {
    target: rehearseTargetTab,
    walmart: rehearseWalmartTab,
    amazon: rehearseAmazonTab,
    bestbuy: rehearseBestBuyTab
  };
  const inspection = identity.retailerId === "target"
    ? await inspectTargetTab(tab?.id)
    : await inspectRetailerTab(tab?.id);
  const rehearsal = guardedRehearsals[identity.retailerId];
  if (!rehearsal) {
    return {
      ...inspection,
      retailerId: identity.retailerId,
      workflow: "inspection",
      qualificationAvailable: false
    };
  }
  if (typeof chrome.runtime.sendMessage === "function") {
    void chrome.runtime.sendMessage({
      type: "yoink:popup-progress",
      stage: "qualifying",
      contextKey: popupPage.key
    }).catch(() => undefined);
  }
  try {
    return {
      ...await rehearsal(inspection, tab?.id),
      productIdentity: inspection.productIdentity || null,
      retailerId: identity.retailerId,
      workflow: "qualification",
      qualificationAvailable: true
    };
  } catch (error) {
    return {
      ...inspection,
      retailerId: identity.retailerId,
      workflow: "qualification",
      qualificationAvailable: true,
      rehearsal: {
        ok: false,
        reason: safeReasonCode(inspection.diagnostic?.reasonCode || "offer_not_actionable"),
        trialId: ""
      },
      message: error instanceof Error ? error.message : "The current offer did not qualify."
    };
  }
}

const REVERIFICATION_COVERAGE = new Set([
  "first_party_actionable", "shipping_actionable", "pickup_actionable",
  "offer_route_ready", "pre_click_rehearsal"
]);

function normalizedReverificationCandidate(value, retailerId) {
  const identity = canonicalRetailerIdentity(value?.canonicalUrl);
  if (identity?.retailerId !== retailerId
    || identity.retailerSku !== String(value?.retailerSku || "").toUpperCase()) return null;
  return {
    retailerSku: identity.retailerSku,
    canonicalUrl: identity.canonicalUrl,
    title: String(value?.title || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160),
    trialObservedAt: String(value?.trialObservedAt || "").slice(0, 40),
    source: ["evidence_history", "repair_queue", "catalog"].includes(String(value?.source || ""))
      ? String(value.source) : "evidence_history",
    qualificationTypes: [...new Set((Array.isArray(value?.qualificationTypes) ? value.qualificationTypes : [])
      .map((item) => String(item || ""))
      .filter((item) => REVERIFICATION_COVERAGE.has(item)))].slice(0, REVERIFICATION_COVERAGE.size),
    currentObserverEvidence: value?.currentObserverEvidence === true,
    currentRehearsalPassed: value?.currentRehearsalPassed === true,
    priorRehearsalPassed: value?.priorRehearsalPassed === true,
    repairableObserverFailure: value?.repairableObserverFailure === true,
    layoutFingerprint: /^[a-f0-9]{64}$/i.test(String(value?.layoutFingerprint || ""))
      ? String(value.layoutFingerprint).toLowerCase() : ""
  };
}

function normalizedReverificationPlan(value) {
  const lanes = [];
  for (const item of Array.isArray(value?.lanes) ? value.lanes.slice(0, 4) : []) {
    const retailerId = String(item?.retailerId || "");
    if (!ADD_LANES[retailerId] || lanes.some((lane) => lane.retailerId === retailerId)) continue;
    const sourceCandidates = Array.isArray(item?.candidates) && item.candidates.length
      ? item.candidates : item?.candidate ? [item.candidate] : [];
    const candidates = [];
    for (const source of sourceCandidates.slice(0, 8)) {
      const candidate = normalizedReverificationCandidate(source, retailerId);
      if (!candidate || candidates.some((entry) => entry.retailerSku === candidate.retailerSku)) continue;
      candidates.push(candidate);
    }
    const evidenceChecks = Array.isArray(item?.evidence?.checks)
      ? item.evidence.checks.slice(0, 12).map((check) => ({
        id: safeReasonCode(check?.id || "unknown"),
        observed: Math.max(0, Math.min(1_000, Math.floor(Number(check?.observed) || 0))),
        required: Math.max(0, Math.min(100, Math.floor(Number(check?.required) || 0))),
        requiredForQualification: check?.requiredForQualification === true,
        met: check?.met === true
      })) : [];
    lanes.push({
      retailerId,
      expectedAdapterVersion: String(item.expectedAdapterVersion || "").slice(0, 80),
      qualification: {
        status: ["qualified", "suspended", "retired", "missing"].includes(String(item.qualification?.status || ""))
          ? String(item.qualification.status) : "missing",
        warning: ["none", "expiring", "expired", "version_changed"].includes(String(item.qualification?.warning || ""))
          ? String(item.qualification.warning) : "none",
        expiresAt: String(item.qualification?.expiresAt || "").slice(0, 40)
      },
      candidate: candidates[0] ?? null,
      candidates,
      evidence: {
        liveEvidenceReady: item?.evidence?.liveEvidenceReady === true,
        rehearsalReady: item?.evidence?.rehearsalReady === true,
        qualificationEvidenceReady: item?.evidence?.qualificationEvidenceReady === true,
        distinctSkuCount: Math.max(0, Math.min(1_000, Math.floor(Number(item?.evidence?.distinctSkuCount) || 0))),
        checks: evidenceChecks
      },
      automaticCheckNeeded: item?.automaticCheckNeeded === true
    });
  }
  return { createdAt: String(value?.createdAt || "").slice(0, 40), lanes };
}

async function getReverificationPlan() {
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this Chrome companion before checking stores again.");
  const payload = await request("/devices/self/readiness/reverification-plan", {
    headers: { Authorization: `Bearer ${device.token}` }
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
  return normalizedReverificationPlan(payload?.plan);
}

function normalizedAutoReverificationSettings(value) {
  return {
    schemaVersion: 1,
    enabled: value?.schemaVersion === 1 ? value?.enabled === true : true
  };
}

function reverificationPlanSignature(plan) {
  const material = (plan?.lanes || []).map((lane) => [
    lane.retailerId,
    lane.expectedAdapterVersion,
    lane.qualification.status,
    lane.qualification.warning,
    lane.automaticCheckNeeded ? "needed" : "steady",
    lane.candidates.map((candidate) => [
      candidate.retailerSku,
      candidate.repairableObserverFailure ? "repair" : "sample",
      candidate.currentObserverEvidence ? "observer-current" : "observer-stale",
      candidate.currentRehearsalPassed ? "rehearsal-current" : "rehearsal-stale",
      candidate.layoutFingerprint || "layout-unknown"
    ].join(":"))
  ].flat().join("|")).join(";");
  let hash = 2166136261;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `reverification-plan-v1:${material.length}:${hash.toString(16).padStart(8, "0")}`;
}

async function readAutoReverificationSettings() {
  const stored = await chrome.storage.local.get(AUTO_REVERIFICATION_SETTINGS_KEY);
  return normalizedAutoReverificationSettings(stored[AUTO_REVERIFICATION_SETTINGS_KEY]);
}

async function setAutoReverificationEnabled(enabled) {
  const settings = { schemaVersion: 1, enabled: enabled === true };
  await chrome.storage.local.set({ [AUTO_REVERIFICATION_SETTINGS_KEY]: settings });
  if (settings.enabled) void runAutomaticReverification(false);
  return { settings };
}

async function saveReverificationState(state, results = [], metadata = {}) {
  const value = {
    schemaVersion: 1,
    state: ["running", "complete", "partial", "error"].includes(state) ? state : "error",
    results: results.slice(0, 4).map((result) => ({
      retailerId: String(result.retailerId || "").slice(0, 40),
      retailerSku: String(result.retailerSku || "").slice(0, 80),
      outcome: ["passed", "partial", "blocked", "missing_candidate", "access_missing", "error"].includes(result.outcome)
        ? result.outcome : "error",
      reasonCode: safeReasonCode(result.reasonCode || result.outcome),
      attemptedProductCount: Math.max(0, Math.min(MAX_REVERIFICATION_CANDIDATES_PER_LANE,
        Math.floor(Number(result.attemptedProductCount) || 0))),
      passedProductCount: Math.max(0, Math.min(MAX_REVERIFICATION_CANDIDATES_PER_LANE,
        Math.floor(Number(result.passedProductCount) || 0)))
    })),
    automatic: metadata.automatic === true,
    planSignature: String(metadata.planSignature || "").slice(0, 2_000),
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [REVERIFICATION_STATE_KEY]: value });
  return value;
}

async function performRetailerReverification(retailerIds = [], metadata = {}) {
  if (await activeJob().catch(() => null)) {
    throw new Error("Wait for the current cart action to finish before checking stores again.");
  }
  const requested = [...new Set((Array.isArray(retailerIds) ? retailerIds : [])
    .map((value) => String(value || "")).filter((value) => ADD_LANES[value]))].slice(0, 4);
  if (!requested.length) throw new Error("Choose at least one supported store to check again.");
  let plan = await getReverificationPlan();
  const stateMetadata = {
    ...metadata,
    planSignature: metadata.planSignature || reverificationPlanSignature(plan)
  };
  const results = [];
  await saveReverificationState("running", results, stateMetadata);
  for (const retailerId of requested) {
    let lane = plan.lanes.find((item) => item.retailerId === retailerId);
    const candidates = (lane?.candidates || []).slice(0, MAX_REVERIFICATION_CANDIDATES_PER_LANE);
    if (!lane || !candidates.length) {
      results.push({
        retailerId,
        retailerSku: "",
        outcome: "missing_candidate",
        reasonCode: "qualification_candidate_missing",
        attemptedProductCount: 0,
        passedProductCount: 0
      });
      await saveReverificationState("running", results, stateMetadata);
      continue;
    }
    const origins = retailerId === "target" ? TARGET_ORIGINS : RETAILER_ORIGINS[retailerId];
    if (!origins || !await chrome.permissions.contains({ origins })) {
      results.push({
        retailerId,
        retailerSku: lane.candidate?.retailerSku || "",
        outcome: "access_missing",
        reasonCode: "retailer_access_missing",
        attemptedProductCount: 0,
        passedProductCount: 0
      });
      await saveReverificationState("running", results, stateMetadata);
      continue;
    }
    let attemptedProductCount = 0;
    let passedProductCount = 0;
    let lastRetailerSku = lane.candidate?.retailerSku || "";
    let lastReasonCode = "qualification_candidate_exhausted";
    for (const candidate of candidates) {
      if (await activeJob().catch(() => null)) {
        lastReasonCode = "action_job_active";
        break;
      }
      let tabId = null;
      lastRetailerSku = candidate.retailerSku;
      attemptedProductCount += 1;
      try {
        const tab = await chrome.tabs.create({ url: candidate.canonicalUrl, active: false });
        if (!Number.isInteger(tab?.id)) throw new Error("qualification_tab_unavailable");
        tabId = tab.id;
        await waitForExactProductTab(tabId, retailerId, candidate.retailerSku);
        const verified = await inspectAndQualifyActiveTab(tabId);
        const passed = verified?.rehearsal?.ok === true;
        if (passed) passedProductCount += 1;
        lastReasonCode = passed
          ? "verified"
          : safeReasonCode(verified?.rehearsal?.reason || "qualification_blocked");
      } catch (error) {
        lastReasonCode = safeReasonCode(error instanceof Error ? error.message : "qualification_failed");
      } finally {
        if (Number.isInteger(tabId)) await chrome.tabs.remove(tabId).catch(() => undefined);
      }
      plan = await getReverificationPlan();
      lane = plan.lanes.find((item) => item.retailerId === retailerId) || lane;
      const unresolvedRepair = lane.candidates.some((item) => item.repairableObserverFailure);
      if (!unresolvedRepair
        && lane.evidence.qualificationEvidenceReady
        && (lane.qualification.warning === "none" || passedProductCount > 0)) break;
    }
    const unresolvedRepair = lane.candidates.some((item) => item.repairableObserverFailure);
    const evidenceReady = !unresolvedRepair && lane.evidence.qualificationEvidenceReady
      && (lane.qualification.warning !== "expiring" || passedProductCount > 0);
    results.push({
      retailerId,
      retailerSku: lastRetailerSku,
      outcome: evidenceReady ? "passed" : passedProductCount > 0 ? "partial" : "blocked",
      reasonCode: evidenceReady ? "qualification_evidence_ready" : lastReasonCode,
      attemptedProductCount,
      passedProductCount
    });
    await saveReverificationState("running", results, stateMetadata);
  }
  const state = results.every((result) => result.outcome === "passed") ? "complete" : "partial";
  const persisted = await saveReverificationState(state, results, stateMetadata);
  return { plan, ...persisted };
}

function runRetailerReverification(retailerIds = [], metadata = {}) {
  if (retailerReverificationPromise) return retailerReverificationPromise;
  retailerReverificationPromise = performRetailerReverification(retailerIds, metadata)
    .finally(() => { retailerReverificationPromise = null; });
  return retailerReverificationPromise;
}

function runAutomaticReverification(force = false) {
  if (automaticReverificationPromise) return automaticReverificationPromise;
  automaticReverificationPromise = (async () => {
    const settings = await readAutoReverificationSettings();
    if (!settings.enabled && !force) return { settings, started: false, reason: "automatic_checks_disabled" };
    const stored = (await chrome.storage.local.get(REVERIFICATION_STATE_KEY))[REVERIFICATION_STATE_KEY];
    const plan = await getReverificationPlan();
    const planSignature = reverificationPlanSignature(plan);
    const lastRunAt = stored?.automatic === true ? new Date(String(stored.updatedAt || "")).getTime() : Number.NaN;
    if (!force && Number.isFinite(lastRunAt)
      && lastRunAt > Date.now() - AUTO_REVERIFICATION_COOLDOWN_MS
      && stored?.planSignature === planSignature) {
      return { settings, started: false, reason: "automatic_check_cooldown", state: stored };
    }
    const retailerIds = plan.lanes
      .filter((lane) => lane.automaticCheckNeeded && lane.candidates.length > 0)
      .map((lane) => lane.retailerId);
    if (!retailerIds.length) return { settings, started: false, reason: "no_store_checks_needed", plan };
    const result = await runRetailerReverification(retailerIds, { automatic: true, planSignature });
    return { settings, started: true, reason: result.state, ...result };
  })().finally(() => { automaticReverificationPromise = null; });
  return automaticReverificationPromise;
}

async function automaticReverificationStatus() {
  const [settings, stored, plan] = await Promise.all([
    readAutoReverificationSettings(),
    chrome.storage.local.get(REVERIFICATION_STATE_KEY),
    getReverificationPlan().catch(() => null)
  ]);
  return {
    settings,
    state: stored[REVERIFICATION_STATE_KEY] || null,
    plan
  };
}

async function persistPopupResult(result) {
  if (result?.schemaVersion !== 1 || !result.contextKey) return;
  await chrome.storage.session.set({ [POPUP_RESULT_STORAGE_KEY]: result }).catch(() => undefined);
}

async function inspectAndQualifyPopupOperation() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const page = PopupState.classifyPageContext(tabs[0]?.url);
  if (page.kind !== "product") throw new Error("Open an exact supported retailer product page first.");
  try {
    const result = await inspectAndQualifyActiveTab();
    const popupResult = PopupState.qualificationPopupResult(result, page);
    await persistPopupResult(popupResult);
    return { ...result, popupResult };
  } catch (error) {
    await persistPopupResult(PopupState.errorPopupResult(page.key, error));
    throw error;
  }
}

async function inspectWalmartDrawPopupOperation() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const page = PopupState.classifyPageContext(tabs[0]?.url);
  if (page.kind !== "walmart_draw") throw new Error("Open the exact Walmart Collectibles Draw page first.");
  try {
    const result = await inspectWalmartDrawHubTab();
    const popupResult = PopupState.drawingsPopupResult(result, page);
    await persistPopupResult(popupResult);
    return { ...result, popupResult };
  } catch (error) {
    await persistPopupResult(PopupState.errorPopupResult(page.key, error));
    throw error;
  }
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
    || !["shipping", "pickup"].includes(job.fulfillment)
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
  if (["confirmed", "manual_review", "submission_uncertain"].includes(active.phase)) {
    void reconcileActionHandoffs(ACTION_HANDOFF_WAIT_MS);
  }
  return payload.job;
}

async function reportJobBatch(active, events) {
  if (!Array.isArray(events) || !events.length) throw new Error("A job progress batch is required.");
  const device = await storedDevice();
  if (!device?.token) throw new Error("The paired Chrome device is unavailable.");
  const payload = await request(`/devices/self/jobs/${encodeURIComponent(active.id)}/events/batch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({
      capabilityToken: active.capabilityToken,
      events: events.map((event) => ({
        state: event.state,
        reasonCode: safeReasonCode(event.reasonCode),
        message: String(event.message || "Chrome reported guarded retailer add progress.").slice(0, 500),
        evidence: event.evidence || {}
      }))
    })
  });
  active.phase = payload.job?.state || events.at(-1)?.state || active.phase;
  await saveActiveJob(active);
  if (["confirmed", "manual_review", "submission_uncertain"].includes(active.phase)) {
    void reconcileActionHandoffs(ACTION_HANDOFF_WAIT_MS);
  }
  return payload.job;
}

async function heartbeatJob(active) {
  const device = await storedDevice();
  if (!device?.token) throw new Error("The paired Chrome device is unavailable.");
  return request(`/devices/self/jobs/${encodeURIComponent(active.id)}/heartbeat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({ capabilityToken: active.capabilityToken })
  });
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

function waitForExactProductTab(tabId, retailerId, retailerSku, timeoutMs = 25_000) {
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
      if (tab?.status !== "complete") return false;
      const identity = canonicalRetailerIdentity(tab.url);
      return identity?.retailerId === retailerId && identity.retailerSku === retailerSku;
    };
    listener = (updatedId, changeInfo, tab) => {
      if (updatedId === tabId && (changeInfo.status === "complete" || tab.status === "complete") && accepted(tab)) {
        finish(null, tab);
      }
    };
    timeout = setTimeout(() => finish(new Error("The watched product page did not finish loading in time.")), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (accepted(tab)) finish(null, tab);
    }).catch(() => undefined);
  });
}

function postClickNavigationSignal(tabId) {
  let listener;
  let observedChange = false;
  let resolved = false;
  let resolveSignal;
  const promise = new Promise((resolve) => { resolveSignal = resolve; });
  const finish = (reason) => {
    if (resolved) return;
    resolved = true;
    chrome.tabs.onUpdated.removeListener(listener);
    resolveSignal({ settled: true, reason });
  };
  listener = (updatedId, changeInfo, tab) => {
    if (updatedId !== tabId) return;
    if (changeInfo.url || changeInfo.status === "loading") observedChange = true;
    if (observedChange && (changeInfo.status === "complete" || tab?.status === "complete")) {
      finish("tab_complete");
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
  return {
    promise,
    cancel() {
      if (resolved) return;
      resolved = true;
      chrome.tabs.onUpdated.removeListener(listener);
    }
  };
}

async function armPostClickDomSettle(tabId, token) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: (_operation, key, expectedToken) => {
      const root = globalThis;
      const existing = root[key];
      existing?.observer?.disconnect?.();
      const state = {
        token: expectedToken,
        armedAt: performance.now(),
        lastMutationAt: 0,
        mutationCount: 0,
        notify: null,
        observer: null
      };
      const observer = new MutationObserver((records) => {
        if (!records.length) return;
        state.mutationCount += records.length;
        state.lastMutationAt = performance.now();
        state.notify?.();
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-busy", "aria-label", "class", "disabled", "data-test", "data-testid"]
      });
      state.observer = observer;
      root[key] = state;
      return { armed: true, token: expectedToken };
    },
    args: ["yoink_post_click_settle_arm", POST_CLICK_SETTLE_STATE_KEY, token]
  });
  return results.find((entry) => entry.frameId === 0)?.result?.armed === true;
}

async function waitForPostClickDomSettle(tabId, token) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func: (_operation, key, expectedToken, timeoutMs, quietMs, minimumMs) => new Promise((resolve) => {
        const root = globalThis;
        const state = root[key];
        if (!state || state.token !== expectedToken) {
          setTimeout(() => resolve({ settled: false, reason: "observer_unavailable" }), timeoutMs);
          return;
        }
        let finished = false;
        let quietTimer;
        let timeout;
        const finish = (settled, reason) => {
          if (finished) return;
          finished = true;
          clearTimeout(quietTimer);
          clearTimeout(timeout);
          state.observer?.disconnect?.();
          state.notify = null;
          if (root[key]?.token === expectedToken) delete root[key];
          resolve({ settled, reason });
        };
        const schedule = () => {
          clearTimeout(quietTimer);
          const now = performance.now();
          const minimumRemaining = Math.max(0, minimumMs - (now - state.armedAt));
          const quietRemaining = Math.max(0, quietMs - (now - state.lastMutationAt));
          quietTimer = setTimeout(
            () => finish(true, "dom_mutation"),
            Math.max(minimumRemaining, quietRemaining)
          );
        };
        state.notify = schedule;
        if (state.mutationCount > 0) schedule();
        timeout = setTimeout(() => finish(false, "timeout"), timeoutMs);
      }),
      args: [
        "yoink_post_click_settle_wait",
        POST_CLICK_SETTLE_STATE_KEY,
        token,
        POST_CLICK_SETTLE_MAX_MS,
        POST_CLICK_SETTLE_QUIET_MS,
        POST_CLICK_SETTLE_MIN_MS
      ]
    });
    const result = results.find((entry) => entry.frameId === 0)?.result;
    return result && typeof result === "object"
      ? result
      : { settled: false, reason: "observer_unavailable" };
  } catch {
    await new Promise((resolve) => setTimeout(resolve, POST_CLICK_SETTLE_MAX_MS));
    return { settled: false, reason: "observer_unavailable" };
  }
}

async function clearPostClickDomSettle(tabId, token) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: (_operation, key, expectedToken) => {
      const root = globalThis;
      const state = root[key];
      if (state?.token !== expectedToken) return false;
      state.observer?.disconnect?.();
      state.notify = null;
      delete root[key];
      return true;
    },
    args: ["yoink_post_click_settle_clear", POST_CLICK_SETTLE_STATE_KEY, token]
  }).catch(() => undefined);
}

async function createPostClickSettle(tabId) {
  const token = crypto.randomUUID();
  const navigation = postClickNavigationSignal(tabId);
  const armed = await armPostClickDomSettle(tabId, token).catch(() => false);
  return {
    async wait() {
      const startedAt = Date.now();
      try {
        const result = await Promise.race([
          navigation.promise,
          armed
            ? waitForPostClickDomSettle(tabId, token)
            : new Promise((resolve) => setTimeout(
              () => resolve({ settled: false, reason: "observer_unavailable" }),
              POST_CLICK_SETTLE_MAX_MS
            ))
        ]);
        return {
          reason: ["tab_complete", "dom_mutation", "timeout", "observer_unavailable"].includes(result?.reason)
            ? result.reason : "observer_unavailable",
          durationMs: Math.max(0, Date.now() - startedAt)
        };
      } finally {
        navigation.cancel();
        await clearPostClickDomSettle(tabId, token);
      }
    },
    async cancel() {
      navigation.cancel();
      await clearPostClickDomSettle(tabId, token);
    }
  };
}

async function openRetailerTab(retailerId, url, expected, active = true) {
  const lane = ADD_LANES[retailerId];
  const tab = await chrome.tabs.create({ url, active: active !== false });
  if (!Number.isInteger(tab?.id)) throw new Error(`Chrome could not open the ${lane?.name || "retailer"} execution tab.`);
  await waitForTab(tab.id, retailerId, expected);
  return tab.id;
}

async function captureRetailerCartContext(tabId, retailerId, lane, timeoutMs = CART_BASELINE_WAIT_MAX_MS) {
  await injectAddAction(tabId, retailerId);
  const [baseline, inspectedSignedInState] = await settleRequiredWork(
    executeReadOnlyCartAction(
      tabId,
      retailerId,
      lane.baselineOperation,
      [],
      timeoutMs
    ),
    inspectRetailerSessionState(tabId, retailerId).catch(() => "unknown")
  );
  return {
    baseline,
    signedInState: baseline?.reason === "manual_action_required"
      ? "challenged" : inspectedSignedInState
  };
}

async function navigateRetailerTab(tabId, retailerId, url, expected) {
  await chrome.tabs.update(tabId, { url, active: true });
  await waitForTab(tabId, retailerId, expected);
}

async function acquireRetailerTab(reusableTabId, retailerId, url, expected) {
  if (Number.isInteger(reusableTabId)) {
    try {
      const reusable = await chrome.tabs.get(reusableTabId);
      if (Number.isInteger(reusable?.id)) {
        await navigateRetailerTab(reusable.id, retailerId, url, expected);
        return reusable.id;
      }
    } catch {
      // A closed or no-longer-loadable prior action tab is replaced before mutation.
    }
  }
  return openRetailerTab(retailerId, url, expected);
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

function markJobTiming(active, name, now = Date.now()) {
  if (!active || !["leasedAt", "baselineReadyAt", "offerVerifiedAt", "clickedAt", "settledAt", "cartReadyAt"].includes(name)) return;
  active.timing = {
    ...(active.timing && typeof active.timing === "object" ? active.timing : {}),
    [name]: now
  };
}

function boundedLatency(start, end) {
  const from = Number(start);
  const to = Number(end);
  const elapsed = Math.round(to - from);
  return Number.isSafeInteger(elapsed) && elapsed >= 0 && elapsed <= 60 * 60_000
    ? elapsed : undefined;
}

function cartReadyLatency(active, readyAt = Date.now()) {
  const leaseToCartReadyMs = boundedLatency(active?.timing?.leasedAt, readyAt);
  const leaseToBaselineMs = boundedLatency(active?.timing?.leasedAt, active?.timing?.baselineReadyAt);
  const baselineToOfferMs = boundedLatency(active?.timing?.baselineReadyAt, active?.timing?.offerVerifiedAt);
  const offerToClickMs = boundedLatency(active?.timing?.offerVerifiedAt, active?.timing?.clickedAt);
  const clickToCartReadyMs = boundedLatency(active?.timing?.clickedAt, readyAt);
  const clickToSettleMs = boundedLatency(active?.timing?.clickedAt, active?.timing?.settledAt);
  const settleToCartReadyMs = boundedLatency(active?.timing?.settledAt, readyAt);
  return {
    ...(leaseToCartReadyMs !== undefined ? { leaseToCartReadyMs } : {}),
    ...(leaseToBaselineMs !== undefined ? { leaseToBaselineMs } : {}),
    ...(baselineToOfferMs !== undefined ? { baselineToOfferMs } : {}),
    ...(offerToClickMs !== undefined ? { offerToClickMs } : {}),
    ...(clickToCartReadyMs !== undefined ? { clickToCartReadyMs } : {}),
    ...(clickToSettleMs !== undefined ? { clickToSettleMs } : {}),
    ...(settleToCartReadyMs !== undefined ? { settleToCartReadyMs } : {})
  };
}

function freshCartBaseline(value, retailerId, now = Date.now()) {
  if (!value || typeof value !== "object" || value.contractVersion !== 1
    || value.retailerId !== retailerId || !Array.isArray(value.lines)
    || !Number.isSafeInteger(value.lineCount) || value.lineCount !== value.lines.length
    || value.lines.length > 25) return null;
  const observedAt = new Date(String(value.observedAt || "")).getTime();
  if (!Number.isFinite(observedAt) || observedAt > now + 1_000 || now - observedAt > CART_BASELINE_MAX_AGE_MS) return null;
  const lines = value.lines.map((line) => ({
    retailerSku: String(line?.retailerSku || "").toLocaleUpperCase("en-US"),
    quantity: Number(line?.quantity)
  }));
  if (lines.some((line) => !/^[A-Z0-9][A-Z0-9._-]{0,119}$/.test(line.retailerSku)
    || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 99)) return null;
  if (new Set(lines.map((line) => line.retailerSku)).size !== lines.length) return null;
  return {
    contractVersion: 1,
    retailerId,
    observedAt: new Date(observedAt).toISOString(),
    lineCount: lines.length,
    lines: lines.sort((left, right) => left.retailerSku.localeCompare(right.retailerSku, "en-US"))
  };
}

async function readCartReadyState() {
  const stored = await chrome.storage.session.get(CART_READY_STORAGE_KEY);
  return PopupState.cartReadyState(stored[CART_READY_STORAGE_KEY]);
}

async function readRetailerActionTabs() {
  const value = (await chrome.storage.session.get(RETAILER_ACTION_TABS_KEY))[RETAILER_ACTION_TABS_KEY];
  const tabs = [1, 2].includes(value?.schemaVersion) && value.tabs && typeof value.tabs === "object" && !Array.isArray(value.tabs)
    ? value.tabs : {};
  return new Map(Object.entries(tabs).flatMap(([retailerId, stored]) => {
    if (!Object.hasOwn(ADD_LANES, retailerId)) return [];
    const tabId = Number.isInteger(stored) ? Number(stored) : Number(stored?.tabId);
    if (!Number.isInteger(tabId) || tabId <= 0) return [];
    return [[retailerId, {
      tabId,
      cartBaseline: freshCartBaseline(stored?.cartBaseline, retailerId),
      signedInState: ["ready", "signed_out", "challenged"].includes(stored?.signedInState)
        ? stored.signedInState : "unknown"
    }]];
  }));
}

async function rememberRetailerActionTab(retailerId, tabId, cartBaseline = undefined, signedInState = undefined) {
  if (!Object.hasOwn(ADD_LANES, retailerId) || !Number.isInteger(tabId) || tabId <= 0) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!Number.isInteger(tab?.id)) return;
  const tabs = await readRetailerActionTabs();
  const current = tabs.get(retailerId);
  tabs.set(retailerId, {
    tabId,
    cartBaseline: cartBaseline === undefined
      ? current?.cartBaseline || null
      : freshCartBaseline(cartBaseline, retailerId),
    signedInState: signedInState === undefined
      ? current?.signedInState || "unknown"
      : ["ready", "signed_out", "challenged"].includes(signedInState) ? signedInState : "unknown"
  });
  await chrome.storage.session.set({
    [RETAILER_ACTION_TABS_KEY]: { schemaVersion: 2, tabs: Object.fromEntries(tabs) }
  });
}

async function inspectRetailerSessionState(tabId, retailerId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: ["inspectRetailerSessionState", retailerId],
    func: (_operation, exactRetailerId) => {
      const visible = (element) => {
        if (!(element instanceof Element)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0
          && rect.width > 0 && rect.height > 0;
      };
      const anyVisible = (selectors) => selectors.some((selector) => [...document.querySelectorAll(selector)].some(visible));
      const ready = {
        target: ['a[href*="/logout" i]', 'button[data-test*="account-menu" i]'],
        walmart: ['a[href*="/account/logout" i]', 'button[data-automation-id="account-menu-button"]'],
        amazon: ['#nav-item-signout', 'a[href*="/gp/flex/sign-out" i]'],
        bestbuy: ['a[href*="/identity/global/signout" i]', 'a[href*="/logout" i]']
      }[exactRetailerId] || [];
      const signedOut = {
        target: ['a[href*="/login" i]', 'a[href*="/signin" i]'],
        walmart: ['a[href*="/account/login" i]', 'a[href*="/signin" i]'],
        amazon: ['a[href*="/ap/signin" i]'],
        bestbuy: ['a[href*="/identity/global/signin" i]', 'a[href*="/login" i]']
      }[exactRetailerId] || [];
      const challenge = [
        "iframe[src*='captcha' i]",
        "iframe[title*='human verification' i]",
        "[data-test*='captcha' i]",
        "[data-testid*='captcha' i]",
        "[id*='captcha' i]",
        "[class*='captcha' i]"
      ];
      const challengeText = String(document.body?.innerText || "").slice(0, 50_000);
      if (anyVisible(challenge)
        || /verify you are human|robot or human|activate and hold the button|unusual traffic|security challenge|additional security check is required|checking your browser|performing security verification|enable javascript and cookies to continue|sorry, you have been blocked/i.test(challengeText)) {
        return "challenged";
      }
      if (anyVisible(ready)) return "ready";
      if (anyVisible(signedOut)) return "signed_out";
      return "unknown";
    }
  });
  const state = results.find((entry) => entry.frameId === 0)?.result;
  return ["ready", "signed_out", "challenged"].includes(state) ? state : "unknown";
}

async function forgetRetailerActionTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  const tabs = await readRetailerActionTabs();
  let changed = false;
  for (const [retailerId, stored] of tabs) {
    if (stored.tabId !== tabId) continue;
    tabs.delete(retailerId);
    changed = true;
  }
  if (changed) {
    await chrome.storage.session.set({
      [RETAILER_ACTION_TABS_KEY]: { schemaVersion: 2, tabs: Object.fromEntries(tabs) }
    });
  }
}

async function reportRetailerReadiness(retailerId, input = {}) {
  const lane = ADD_LANES[retailerId];
  const device = await storedDevice();
  if (!lane || !device?.token) return null;
  const baseline = freshCartBaseline(input.cartBaseline, retailerId);
  const observedAt = baseline?.observedAt;
  return request(`/devices/self/readiness/${encodeURIComponent(retailerId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({
      contractVersion: 1,
      retailerId,
      signedInState: ["ready", "signed_out", "challenged"].includes(input.signedInState)
        ? input.signedInState : "unknown",
      cartBaselineState: baseline ? "ready" : input.cartBaselineState === "stale" ? "stale" : "unavailable",
      ...(observedAt ? {
        baselineObservedAt: observedAt,
        expiresAt: new Date(new Date(observedAt).getTime() + CART_BASELINE_MAX_AGE_MS).toISOString()
      } : {}),
      adapterVersion: lane.adapterVersion,
      ...(input.errorCode ? { errorCode: safeReasonCode(input.errorCode) } : {})
    })
  }, 3_000).catch(() => null);
}

function retailerLanePageUrl(retailerId, value) {
  const lane = ADD_LANES[retailerId];
  if (!lane) return false;
  try {
    const url = new URL(String(value || ""));
    const expectedHost = new URL(lane.cartUrl).hostname.replace(/^www\./, "");
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (url.hostname === expectedHost || url.hostname.endsWith(`.${expectedHost}`));
  } catch {
    return false;
  }
}

async function refreshRetailerSessionOnce(tabId, value) {
  if (await activeJob().catch(() => null)) {
    return { refreshed: false, reason: "action_job_active" };
  }
  const storedTabs = await readRetailerActionTabs();
  const identity = canonicalRetailerIdentity(value);
  const storedMatch = [...storedTabs].find(([, stored]) => stored.tabId === tabId);
  const retailerId = Object.hasOwn(ADD_LANES, identity?.retailerId)
    ? identity.retailerId : storedMatch?.[0] || "";
  const stored = storedTabs.get(retailerId);
  if (!retailerId || !retailerLanePageUrl(retailerId, value)
    || (!identity && stored?.tabId !== tabId)
    || !await addLaneAccess(retailerId)) {
    return { refreshed: false, reason: "retailer_page_unavailable" };
  }
  const wasBlocked = ["signed_out", "challenged"].includes(stored?.signedInState);
  const signedInState = await inspectRetailerSessionState(tabId, retailerId).catch(() => "unknown");
  if (stored) {
    await rememberRetailerActionTab(retailerId, stored.tabId, undefined, signedInState);
  }
  const cartBaseline = freshCartBaseline(stored?.cartBaseline, retailerId);
  const readiness = await reportRetailerReadiness(retailerId, {
    cartBaseline,
    cartBaselineState: cartBaseline ? "ready" : "unavailable",
    signedInState,
    ...(["signed_out", "challenged"].includes(signedInState)
      ? { errorCode: signedInState === "challenged" ? "security_challenge" : "signed_out" }
      : {})
  });
  const recovered = Boolean(readiness) && wasBlocked
    && !["signed_out", "challenged"].includes(signedInState);
  if (recovered) void runSignalJobHandoff();
  return { refreshed: Boolean(readiness), recovered, retailerId, signedInState };
}

function refreshRetailerSessionFromTab(tabId, value) {
  if (!Number.isInteger(tabId) || tabId <= 0) return Promise.resolve({ refreshed: false, reason: "tab_unavailable" });
  const existing = retailerSessionRefreshes.get(tabId);
  if (existing) {
    existing.pending = true;
    existing.pendingValue = value;
    return existing.promise;
  }
  const entry = { pending: false, pendingValue: "", promise: null };
  entry.promise = (async () => {
    let result = await refreshRetailerSessionOnce(tabId, value);
    // Login and security flows can emit a second completed navigation while
    // the first read-only inspection is settling. Coalesce that latest page
    // into one follow-up instead of losing the recovery edge.
    if (entry.pending) {
      result = await refreshRetailerSessionOnce(tabId, entry.pendingValue);
    }
    return result;
  })().catch(() => ({ refreshed: false, reason: "session_refresh_failed" }))
    .finally(() => { retailerSessionRefreshes.delete(tabId); });
  retailerSessionRefreshes.set(tabId, entry);
  return entry.promise;
}

async function showActionHandoffBadge(state) {
  const handoffs = PopupState.cartReadyState(state).items;
  const count = handoffs.length;
  if (!count) return false;
  const needsYou = handoffs.filter((item) => item.kind === "needs_you").length;
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: needsYou ? BADGE_COLORS.warning : BADGE_COLORS.good }),
    chrome.action.setBadgeText({ text: count > 9 ? "9+" : String(count) }),
    chrome.action.setTitle({ title: needsYou
      ? `Yoink · ${needsYou} action${needsYou === 1 ? "" : "s"} need review`
      : `Yoink · ${count} cart${count === 1 ? "" : "s"} ready for checkout` })
  ]);
  return true;
}

async function refreshActionBadge() {
  const stored = await chrome.storage.local.get(READINESS_KEY);
  const readiness = stored[READINESS_KEY];
  if (readiness && typeof readiness === "object") {
    await showBadge(readiness);
    return;
  }
  // An absent cache is not evidence that the companion is offline. This can
  // occur before the first minute health cycle or after session data cleanup;
  // keep the badge quiet until an actual health result establishes a state.
  if (await showActionHandoffBadge(await readCartReadyState())) return;
  await Promise.all([
    chrome.action.setBadgeText({ text: "" }),
    chrome.action.setTitle({ title: "Yoink" })
  ]);
}

function mutateCartReadyState(mutator) {
  const task = cartReadyStateQueue.then(async () => {
    const current = await readCartReadyState();
    const next = PopupState.cartReadyState(mutator(current));
    await chrome.storage.session.set({ [CART_READY_STORAGE_KEY]: next });
    await refreshActionBadge();
    return next;
  });
  cartReadyStateQueue = task.catch(() => undefined);
  return task;
}

function retailerCartTab(tab, retailerId) {
  const lane = ADD_LANES[retailerId];
  if (!lane || !Number.isInteger(tab?.id)) return false;
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

async function clearActionHandoffNotifications(jobId) {
  const id = String(jobId || "");
  await Promise.all([
    chrome.notifications?.clear?.(`${CART_READY_NOTIFICATION_PREFIX}${id}`).catch(() => undefined),
    chrome.notifications?.clear?.(`${NEEDS_YOU_NOTIFICATION_PREFIX}${id}`).catch(() => undefined)
  ]);
}

async function closeActionHandoff(jobId) {
  const id = String(jobId || "");
  const state = await mutateCartReadyState((current) => ({
    schemaVersion: 1,
    items: current.items.filter((item) => item.jobId !== id)
  }));
  const storedHandoffs = (await chrome.storage.session.get(ORDER_HANDOFF_KEY))[ORDER_HANDOFF_KEY];
  if (Array.isArray(storedHandoffs)) {
    await chrome.storage.session.set({
      [ORDER_HANDOFF_KEY]: storedHandoffs.filter((entry) => entry?.jobId !== id)
    });
  }
  await clearActionHandoffNotifications(id);
  return state;
}

async function markActionHandoffOpened(jobId, now = Date.now()) {
  const id = String(jobId || "");
  const openedAt = new Date(now).toISOString();
  const state = await mutateCartReadyState((current) => ({
    schemaVersion: 1,
    items: current.items.map((item) => item.jobId === id
      ? { ...item, openedAt: item.openedAt || openedAt }
      : item)
  }));
  await clearActionHandoffNotifications(id);
  return state;
}

function boundedActionHandoffWaitMs(value) {
  return Math.max(0, Math.min(ACTION_HANDOFF_WAIT_MS, Math.floor(Number(value) || 0)));
}

function normalizedActionHandoffAvailabilityVersion(value) {
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : -1;
}

async function applyActionHandoffStatuses(knownIds, entries) {
  const statuses = new Map((Array.isArray(entries) ? entries : []).flatMap((entry) => {
    const jobId = String(entry?.jobId || "");
    const status = String(entry?.status || "");
    return knownIds.has(jobId) && ["cart_ready", "needs_you", "closed"].includes(status)
      ? [[jobId, status]] : [];
  }));
  if (!statuses.size) return { checked: 0, closed: 0, open: true };
  const closedIds = new Set([...statuses].filter(([, status]) => status === "closed").map(([jobId]) => jobId));
  const changedIds = new Set();
  const state = await mutateCartReadyState((current) => ({
    schemaVersion: 1,
    items: current.items.flatMap((item) => {
      const status = statuses.get(item.jobId);
      if (!status) return [item];
      if (status === "closed") return [];
      if (item.kind === status) return [item];
      changedIds.add(item.jobId);
      if (status === "needs_you") {
        return [{ ...item, kind: status, reasonCode: item.reasonCode || "manual_review" }];
      }
      const { reasonCode: _reasonCode, ...withoutReason } = item;
      return [{ ...withoutReason, kind: status }];
    })
  }));
  if (closedIds.size) {
    const storedHandoffs = (await chrome.storage.session.get(ORDER_HANDOFF_KEY))[ORDER_HANDOFF_KEY];
    if (Array.isArray(storedHandoffs)) {
      await chrome.storage.session.set({
        [ORDER_HANDOFF_KEY]: storedHandoffs.filter((entry) => !closedIds.has(String(entry?.jobId || "")))
      });
    }
  }
  await Promise.all([...new Set([...closedIds, ...changedIds])].flatMap((jobId) => [
    chrome.notifications?.clear?.(`${CART_READY_NOTIFICATION_PREFIX}${jobId}`).catch(() => undefined),
    chrome.notifications?.clear?.(`${NEEDS_YOU_NOTIFICATION_PREFIX}${jobId}`).catch(() => undefined)
  ]));
  return {
    checked: statuses.size,
    closed: closedIds.size,
    open: state.items.some((item) => knownIds.has(item.jobId))
  };
}

async function performActionHandoffReconciliation(waitMs) {
  const current = await readCartReadyState();
  if (!current.items.length) return { checked: 0, closed: 0 };
  const device = await storedDevice();
  if (!device?.token) return { checked: 0, closed: 0 };
  const jobIds = current.items.map((item) => item.jobId);
  const knownIds = new Set(jobIds);
  const storedVersion = (await chrome.storage.session.get(ACTION_HANDOFF_AVAILABILITY_VERSION_KEY))[
    ACTION_HANDOFF_AVAILABILITY_VERSION_KEY
  ];
  let availabilityVersion = normalizedActionHandoffAvailabilityVersion(storedVersion);
  const deadline = Date.now() + waitMs;
  let checked = 0;
  let closed = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remainingWaitMs = waitMs > 0 ? Math.max(0, deadline - Date.now()) : 0;
    if (attempt > 0 && remainingWaitMs <= 0) break;
    const sentVersion = availabilityVersion;
    const response = await request("/devices/self/action-handoffs/reconcile", {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({
        contractVersion: 1,
        jobIds,
        availabilityVersion: sentVersion,
        waitMs: remainingWaitMs
      })
    }, remainingWaitMs > 0 ? ACTION_HANDOFF_REQUEST_TIMEOUT_MS : 3_000);
    const receivedVersion = normalizedActionHandoffAvailabilityVersion(response?.availabilityVersion);
    if (receivedVersion >= 0) {
      availabilityVersion = receivedVersion;
      await chrome.storage.session.set({ [ACTION_HANDOFF_AVAILABILITY_VERSION_KEY]: receivedVersion });
    }
    const applied = await applyActionHandoffStatuses(knownIds, response?.items);
    checked = Math.max(checked, applied.checked);
    closed = Math.max(closed, applied.closed);
    if (waitMs <= 0 || !applied.open || attempt > 0
      || receivedVersion < 0 || receivedVersion === sentVersion) break;
  }
  return { checked, closed };
}

function reconcileActionHandoffs(waitMs = 0) {
  const boundedWaitMs = boundedActionHandoffWaitMs(waitMs);
  if (actionHandoffReconciliationPromise) {
    actionHandoffReconciliationPendingWaitMs = Math.max(
      actionHandoffReconciliationPendingWaitMs,
      boundedWaitMs
    );
    return actionHandoffReconciliationPromise;
  }
  actionHandoffReconciliationPromise = performActionHandoffReconciliation(boundedWaitMs)
    .catch(() => ({ checked: 0, closed: 0 }))
    .finally(() => {
      actionHandoffReconciliationPromise = null;
      const pendingWaitMs = actionHandoffReconciliationPendingWaitMs;
      actionHandoffReconciliationPendingWaitMs = 0;
      if (pendingWaitMs > 0) void reconcileActionHandoffs(pendingWaitMs);
    });
  return actionHandoffReconciliationPromise;
}

function retailerHandoffTab(tab, item) {
  if (item?.kind !== "needs_you") return retailerCartTab(tab, item?.retailerId);
  const lane = ADD_LANES[item?.retailerId];
  if (!lane || !Number.isInteger(tab?.id)) return false;
  try {
    const actual = new URL(String(tab.url || ""));
    const expected = new URL(lane.cartUrl);
    return actual.protocol === "https:" && !actual.username && !actual.password
      && actual.hostname === expected.hostname;
  } catch {
    return false;
  }
}

async function focusCartReady(jobId = "") {
  const current = await readCartReadyState();
  const requestedId = String(jobId || "");
  const item = requestedId
    ? current.items.find((candidate) => candidate.jobId === requestedId)
    : PopupState.preferredActionHandoff(current);
  if (!item) {
    await mutateCartReadyState(() => current);
    throw new Error("This action handoff is no longer available.");
  }
  const tab = await chrome.tabs.get(item.tabId).catch(() => null);
  if (!retailerHandoffTab(tab, item)) {
    const running = await activeJob().catch(() => null);
    if (Number.isInteger(tab?.id) && running?.tabId === item.tabId
      && (running.retailerId || running.runnerJob?.retailerId) === item.retailerId) {
      await chrome.tabs.update(item.tabId, { active: true });
      const state = await markActionHandoffOpened(item.jobId);
      return {
        opened: true,
        pending: true,
        item: state.items.find((candidate) => candidate.jobId === item.jobId) || item,
        cartReady: state
      };
    }
    const lane = ADD_LANES[item.retailerId];
    if (!lane) throw new Error(`The ${item.retailerName} cart could not be reopened.`);
    const replacement = await chrome.tabs.create({ url: lane.cartUrl, active: true }).catch(() => null);
    if (!retailerHandoffTab(replacement, item)) {
      throw new Error(`The ${item.retailerName} cart could not be reopened.`);
    }
    const state = await mutateCartReadyState((currentState) => ({
      schemaVersion: 1,
      items: currentState.items.map((candidate) => candidate.jobId === item.jobId
        ? { ...candidate, tabId: replacement.id, openedAt: candidate.openedAt || new Date().toISOString() }
        : candidate)
    }));
    const storedHandoffs = (await chrome.storage.session.get(ORDER_HANDOFF_KEY))[ORDER_HANDOFF_KEY];
    const rebound = {
      jobId: item.jobId,
      retailerId: item.retailerId,
      tabId: replacement.id,
      recordedAt: item.recordedAt,
      kind: item.kind
    };
    await chrome.storage.session.set({
      [ORDER_HANDOFF_KEY]: [
        ...(Array.isArray(storedHandoffs)
          ? storedHandoffs.filter((entry) => entry?.jobId !== item.jobId)
          : []),
        rebound
      ].slice(-20)
    });
    await clearActionHandoffNotifications(item.jobId);
    return {
      opened: true,
      reopened: true,
      item: state.items.find((candidate) => candidate.jobId === item.jobId) || item,
      cartReady: state
    };
  }
  await chrome.tabs.update(item.tabId, { active: true });
  const state = await markActionHandoffOpened(item.jobId);
  return {
    opened: true,
    item: state.items.find((candidate) => candidate.jobId === item.jobId) || item,
    cartReady: state
  };
}

async function reportCartOutcomeFromPopup(input = {}) {
  const jobId = String(input.jobId || "");
  const outcome = String(input.outcome || "");
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(jobId)
    || !["got_it", "missed_it"].includes(outcome)
    || input.confirmation !== "I_REVIEWED_CHECKOUT_RESULT") {
    throw new Error("Review the checkout result before closing this cart action.");
  }
  const current = await readCartReadyState();
  if (!current.items.some((item) => item.jobId === jobId)) {
    throw new Error("This action handoff is no longer available.");
  }
  const actualTotalCents = outcome === "got_it" ? Number(input.actualTotalCents) : null;
  if (outcome === "got_it" && (!Number.isSafeInteger(actualTotalCents)
    || actualTotalCents <= 0 || actualTotalCents > 100_000_000)) {
    throw new Error("Enter a valid amount charged.");
  }
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this browser before closing the cart action.");
  const response = await request(`/devices/self/jobs/${encodeURIComponent(jobId)}/outcome`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({
      outcome,
      actualTotalCents,
      confirmation: "I_REVIEWED_CHECKOUT_RESULT"
    })
  }, 5_000);
  const cartReady = await closeActionHandoff(jobId);
  return { outcome: response.outcome, cartReady };
}

async function ensureCartReadySoundDocument() {
  if (!chrome.offscreen?.createDocument || !chrome.runtime.getContexts) return false;
  if (offscreenDocumentPromise) return offscreenDocumentPromise;
  offscreenDocumentPromise = (async () => {
    const documentUrl = chrome.runtime.getURL("offscreen.html");
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [documentUrl]
    });
    if (!contexts.length) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play the user-enabled cart-ready cue."
      });
    }
    return true;
  })().catch(() => false).finally(() => { offscreenDocumentPromise = null; });
  return offscreenDocumentPromise;
}

async function playCartReadySound() {
  const enabled = (await chrome.storage.local.get(CART_READY_SOUND_KEY))[CART_READY_SOUND_KEY] === true;
  if (!enabled || !await ensureCartReadySoundDocument()) return false;
  await chrome.runtime.sendMessage({ type: "yoink:play-cart-ready-sound" }).catch(() => undefined);
  return true;
}

async function publishActionHandoff(active, kind, reasonCode = "", readyAt = Date.now()) {
  const retailerId = active.retailerId || active.runnerJob?.retailerId;
  const lane = ADD_LANES[retailerId];
  const raw = {
    schemaVersion: 1,
    kind: kind === "needs_you" ? "needs_you" : "cart_ready",
    jobId: active.id,
    retailerId,
    retailerSku: active.runnerJob?.retailerSku,
    tabId: active.tabId,
    recordedAt: new Date(readyAt).toISOString(),
    reviewedMaximumCents: active.runnerJob?.maxOrderTotalCents,
    ...(kind === "needs_you" ? { reasonCode: safeReasonCode(reasonCode || "manual_review") } : {}),
    latency: kind === "cart_ready" ? cartReadyLatency(active, readyAt) : {}
  };
  const item = PopupState.cartReadyState({ schemaVersion: 1, items: [raw] }, readyAt).items[0];
  if (!lane || !item) return null;
  const storedHandoffs = (await chrome.storage.session.get(ORDER_HANDOFF_KEY))[ORDER_HANDOFF_KEY];
  const handoffs = Array.isArray(storedHandoffs) ? storedHandoffs.filter((entry) => {
    const recordedAt = new Date(String(entry?.recordedAt || "")).getTime();
    return /^[A-Za-z0-9_-]{3,120}$/.test(String(entry?.jobId || ""))
      && Object.hasOwn(ADD_LANES, entry?.retailerId)
      && Number.isInteger(entry?.tabId) && entry.tabId > 0
      && Number.isFinite(recordedAt) && readyAt - recordedAt < 35 * 60_000;
  }) : [];
  await chrome.storage.session.set({
    [ORDER_HANDOFF_KEY]: [
      ...handoffs.filter((entry) => entry.jobId !== item.jobId),
      {
        jobId: item.jobId,
        retailerId: item.retailerId,
        tabId: item.tabId,
        recordedAt: item.recordedAt,
        kind: item.kind
      }
    ].slice(-20)
  });
  await mutateCartReadyState((current) => ({
    schemaVersion: 1,
    items: [...current.items.filter((candidate) => candidate.jobId !== item.jobId), item]
  }));
  const notificationPrefix = item.kind === "needs_you"
    ? NEEDS_YOU_NOTIFICATION_PREFIX : CART_READY_NOTIFICATION_PREFIX;
  await chrome.notifications?.clear?.(`${item.kind === "needs_you" ? CART_READY_NOTIFICATION_PREFIX : NEEDS_YOU_NOTIFICATION_PREFIX}${item.jobId}`).catch(() => undefined);
  await chrome.notifications?.create?.(`${notificationPrefix}${item.jobId}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("yoink-icon.svg"),
    title: item.kind === "needs_you" ? `Review ${item.retailerName} add` : `Cart ready at ${item.retailerName}`,
    message: item.kind === "needs_you"
      ? `${item.identityLabel} ${item.retailerSku} could not be verified after Add. Check the open retailer tab.`
      : `${item.identityLabel} ${item.retailerSku} was added. Checkout remains manual.`,
    contextMessage: "Yoink needs you",
    priority: 2,
    requireInteraction: true
  }).catch(() => undefined);
  void playCartReadySound().catch(() => undefined);
  return item;
}

function publishCartReady(active, readyAt = Date.now()) {
  return publishActionHandoff(active, "cart_ready", "", readyAt);
}

function publishNeedsYou(active, reasonCode, readyAt = Date.now()) {
  return publishActionHandoff(active, "needs_you", reasonCode, readyAt);
}

function retailerConfirmationPage(retailerId, value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
    if (retailerId === "target") {
      return (host === "target.com" || host.endsWith(".target.com"))
        && /(?:^|\/)(?:order-confirmation|co-order-confirmation|thank-you)(?:\/|$)/.test(path);
    }
    if (retailerId === "walmart") {
      return (host === "walmart.com" || host.endsWith(".walmart.com"))
        && /(?:^|\/)(?:thank-you|thankyou|order-confirmation)(?:\/|$)/.test(path);
    }
    if (retailerId === "amazon") {
      return (host === "amazon.com" || host.endsWith(".amazon.com"))
        && /(?:^|\/)(?:thankyou|thank-you|order-confirmation)(?:\/|$)/.test(path);
    }
    if (retailerId === "bestbuy") {
      return (host === "bestbuy.com" || host.endsWith(".bestbuy.com"))
        && /(?:^|\/)(?:thank-you|thankyou|order-confirmation)(?:\/|$)/.test(path);
    }
    return false;
  } catch {
    return false;
  }
}

async function observeOrderConfirmation(tabId, url) {
  const device = await storedDevice();
  if (!device?.token || !Number.isInteger(tabId)) return false;
  const stored = (await chrome.storage.session.get(ORDER_HANDOFF_KEY))[ORDER_HANDOFF_KEY];
  if (!Array.isArray(stored)) return false;
  const now = Date.now();
  const handoff = stored.find((entry) => entry?.tabId === tabId
    && retailerConfirmationPage(entry?.retailerId, url)
    && now - new Date(String(entry?.recordedAt || "")).getTime() <= 30 * 60_000);
  if (!handoff) return false;
  await request("/devices/self/order-confirmations", {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({
      contractVersion: 1,
      actionJobId: handoff.jobId,
      retailerId: handoff.retailerId,
      pageClass: "confirmation",
      observedAt: new Date().toISOString()
    })
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
  await Promise.all([
    chrome.storage.session.set({
      [ORDER_HANDOFF_KEY]: stored.filter((entry) => entry !== handoff)
    }),
    closeActionHandoff(handoff.jobId)
  ]);
  return true;
}

async function verifyAddedCart(active) {
  const retailerId = active.retailerId || active.runnerJob?.retailerId;
  const lane = ADD_LANES[retailerId];
  if (!lane || !Number.isInteger(active.tabId) || !active.proof || !active.cartBaseline) {
    throw new Error("The retailer cart verification context is unavailable.");
  }
  // Returning to cart is non-mutating, so overlap it with the required lease
  // heartbeat. Both must settle successfully before cart proof begins.
  await settleRequiredWork(
    heartbeatJob(active),
    navigateRetailerTab(active.tabId, retailerId, lane.cartUrl, "cart")
  );
  await injectAddAction(active.tabId, retailerId);
  const result = await executeReadOnlyCartAction(
    active.tabId,
    retailerId,
    lane.verifyCartOperation,
    [active.runnerJob, active.proof, active.cartBaseline],
    CART_PROOF_WAIT_MAX_MS
  );
  if (!result?.ok) {
    await publishNeedsYou(active, result?.reason || "cart_unverified").catch(() => undefined);
    await reportJob(active, "manual_review", result?.reason || "cart_unverified", `The exact ${lane.name} cart result could not be proven after Add; automatic retry is locked.`);
    await clearActiveJob();
    return { confirmed: false, cartBaseline: null };
  }
  const readyAt = Date.now();
  markJobTiming(active, "cartReadyAt", readyAt);
  const latency = cartReadyLatency(active, readyAt);
  // The browser has already proven the exact +1 cart delta, so hand control
  // back to the user immediately. Control-plane reporting must never delay
  // the local notification, badge, sound, popup state, or cart-tab handoff.
  await publishCartReady(active, readyAt).catch(() => undefined);
  await reportJobBatch(active, [
    {
      state: "cart_verified",
      reasonCode: "exact_cart_delta_verified",
      message: `The ${lane.name} cart changed by exactly one authorized item and every baseline quantity remained unchanged.`,
      evidence: {
        retailerId,
        retailerSku: active.runnerJob.retailerSku,
        quantity: 1,
        unitPriceCents: result.proof?.unitPriceCents ?? null,
        sellerType: result.proof?.sellerType ?? "unknown"
      }
    },
    {
      state: "confirmed",
      reasonCode: `${retailerId}_add_confirmed`,
      message: `${lane.name} add-to-cart completed and the exact +1 cart delta was verified.`,
      evidence: {
        retailerId,
        retailerSku: active.runnerJob.retailerSku,
        quantity: 1,
        baselineLineCount: Number(active.cartBaseline?.lineCount) || 0,
        latency
      }
    }
  ]);
  const cartBaseline = freshCartBaseline(result.cartBaseline, retailerId, readyAt);
  void reportRetailerReadiness(retailerId, {
    cartBaseline,
    signedInState: active.signedInState || "unknown"
  });
  await clearActiveJob();
  return { confirmed: true, cartBaseline, signedInState: active.signedInState || "unknown" };
}

async function failActiveJob(active, mutationPossible, reason = "extension_error") {
  const retailerId = active.retailerId || active.runnerJob?.retailerId;
  const name = ADD_LANES[retailerId]?.name || "retailer";
  if (mutationPossible) {
    await publishNeedsYou(active, reason).catch(() => undefined);
  }
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

async function executeLeasedRetailerJob(
  lease,
  reusableTabId = null,
  reusableBaseline = null,
  reusableSignedInState = "unknown"
) {
  const retailerId = lease.retailerId || lease.runnerJob?.retailerId;
  const lane = ADD_LANES[retailerId];
  if (!lane) throw new Error("The leased retailer lane is unsupported.");
  const active = {
    ...lease,
    phase: "leased",
    tabId: null,
    proof: null,
    cartBaseline: null,
    signedInState: ["ready", "signed_out", "challenged"].includes(reusableSignedInState)
      ? reusableSignedInState : "unknown",
    timing: { leasedAt: Date.now() }
  };
  await saveActiveJob(active);
  let productPageReady = false;
  try {
    if (!await addLaneAccess(retailerId)) {
      await reportJob(active, "cancelled", "retailer_access_missing", `${lane.name} add stopped before mutation because Chrome page access is not granted.`);
      await clearActiveJob();
      return { confirmed: false, tabId: null, continueCycle: true };
    }
    const cachedBaseline = freshCartBaseline(reusableBaseline, retailerId);
    const reusableTab = Number.isInteger(reusableTabId)
      ? await chrome.tabs.get(reusableTabId).catch(() => null) : null;
    if (cachedBaseline && retailerCartTab(reusableTab, retailerId)) {
      active.tabId = reusableTabId;
      active.cartBaseline = cachedBaseline;
      const [, signedInState] = await settleRequiredWork(
        reportJob(active, "navigating", "cart_baseline_reused", `Chrome reused the fresh, exact ${lane.name} cart baseline from the preceding verified add.`),
        inspectRetailerSessionState(active.tabId, retailerId).catch(() => active.signedInState)
      );
      active.signedInState = signedInState;
      markJobTiming(active, "baselineReadyAt");
      await saveActiveJob(active);
    } else if (!reusableTab) {
      let productTabId = null;
      let baselineTabId = null;
      let cartContext;
      try {
        const [, readyProductTabId, readyCartContext] = await settleRequiredWork(
          reportJob(active, "navigating", "cold_context_started", `Chrome started the exact ${lane.name} product page and pre-add cart baseline in parallel.`),
          openRetailerTab(retailerId, active.navigationUrl, active.runnerJob.retailerSku, true)
            .then((tabId) => {
              productTabId = tabId;
              return tabId;
            }),
          (async () => {
            baselineTabId = await openRetailerTab(retailerId, lane.cartUrl, "cart", false);
            const context = await captureRetailerCartContext(
              baselineTabId,
              retailerId,
              lane,
              CART_BASELINE_WAIT_MAX_MS
            );
            return { ...context, tabId: baselineTabId, baselineReadyAt: Date.now() };
          })()
        );
        productTabId = readyProductTabId;
        cartContext = readyCartContext;
      } catch (error) {
        if (Number.isInteger(baselineTabId)) {
          await chrome.tabs.remove(baselineTabId).catch(() => undefined);
        }
        if (Number.isInteger(productTabId)) {
          active.tabId = productTabId;
          await saveActiveJob(active).catch(() => undefined);
        }
        throw error;
      }
      const baseline = cartContext?.baseline;
      if (!baseline?.ok || !baseline.proof) {
        active.tabId = cartContext?.tabId || baselineTabId;
        active.signedInState = cartContext?.signedInState || "unknown";
        await saveActiveJob(active);
        if (Number.isInteger(productTabId) && productTabId !== active.tabId) {
          await chrome.tabs.remove(productTabId).catch(() => undefined);
        }
        if (Number.isInteger(active.tabId)) {
          await chrome.tabs.update(active.tabId, { active: true }).catch(() => undefined);
        }
        void reportRetailerReadiness(retailerId, {
          cartBaselineState: baseline?.reason === "cart_baseline_stale" ? "stale" : "unavailable",
          signedInState: active.signedInState,
          errorCode: baseline?.reason || "cart_unverified"
        });
        await reportJob(active, "cancelled", baseline?.reason || "cart_unverified", `${lane.name} add stopped before mutation because the current cart baseline could not be proven.`);
        await clearActiveJob();
        return { confirmed: false, tabId: active.tabId, continueCycle: true, cartBaseline: null };
      }
      active.tabId = productTabId;
      active.cartBaseline = baseline.proof;
      active.signedInState = cartContext.signedInState;
      markJobTiming(active, "baselineReadyAt", cartContext.baselineReadyAt);
      await settleRequiredWork(
        saveActiveJob(active),
        Number.isInteger(baselineTabId)
          ? chrome.tabs.remove(baselineTabId).catch(() => undefined)
          : Promise.resolve()
      );
      productPageReady = true;
      void reportRetailerReadiness(retailerId, {
        cartBaseline: baseline.proof,
        signedInState: active.signedInState
      });
    } else {
      const [, tabId] = await settleRequiredWork(
        reportJob(active, "navigating", "cart_baseline_started", `Chrome opened ${lane.name} cart to bind the exact pre-add baseline.`),
        acquireRetailerTab(reusableTabId, retailerId, lane.cartUrl, "cart")
      );
      active.tabId = tabId;
      await saveActiveJob(active);
      const cartContext = await captureRetailerCartContext(
        active.tabId,
        retailerId,
        lane,
        CART_BASELINE_WAIT_MAX_MS
      );
      const baseline = cartContext.baseline;
      if (!baseline?.ok || !baseline.proof) {
        active.signedInState = cartContext.signedInState;
        void reportRetailerReadiness(retailerId, {
          cartBaselineState: baseline?.reason === "cart_baseline_stale" ? "stale" : "unavailable",
          signedInState: active.signedInState,
          errorCode: baseline?.reason || "cart_unverified"
        });
        await reportJob(active, "cancelled", baseline?.reason || "cart_unverified", `${lane.name} add stopped before mutation because the current cart baseline could not be proven.`);
        await clearActiveJob();
        return { confirmed: false, tabId: active.tabId, continueCycle: true, cartBaseline: null };
      }
      active.cartBaseline = baseline.proof;
      active.signedInState = cartContext.signedInState;
      void reportRetailerReadiness(retailerId, {
        cartBaseline: baseline.proof,
        signedInState: active.signedInState
      });
      markJobTiming(active, "baselineReadyAt");
      await saveActiveJob(active);
    }

    if (!productPageReady) {
      await navigateRetailerTab(active.tabId, retailerId, active.navigationUrl, active.runnerJob.retailerSku);
    }
    const [, prepared] = await settleRequiredWork(
      reportJob(active, "verifying_listing", "product_page_ready", `Chrome started exact live ${lane.name} offer verification.`),
      (async () => {
        await injectAddAction(active.tabId, retailerId);
        return executeAddAction(active.tabId, retailerId, lane.prepareOperation, [active.runnerJob]);
      })()
    );
    if (!prepared?.ok) {
      const reasonCode = safeReasonCode(prepared?.reason || "offer_unverified");
      await recordTabOperationDiagnostic(
        active.tabId,
        retailerId,
        "live_add",
        EXPECTED_LIVE_REJECTIONS.has(reasonCode) ? "rejected" : "failed",
        runnerFailureStage(reasonCode),
        reasonCode,
        active.runnerJob.fulfillment
      );
      await reportJob(active, "offer_rejected", prepared?.reason || "offer_unverified", `The live ${lane.name} offer did not satisfy the immutable action contract.`);
      await clearActiveJob();
      return { confirmed: false, tabId: active.tabId, continueCycle: true };
    }
    // A successful structural diagnostic is useful telemetry, but it must not
    // sit on the cart hot path. The exact offer proof below remains the
    // authoritative action gate; diagnostic delivery is best-effort and the
    // durable diagnostic outbox handles retryable delivery failures.
    void recordTabOperationDiagnostic(
      active.tabId,
      retailerId,
      "live_add",
      "passed",
      "complete",
      "verified",
      active.runnerJob.fulfillment
    ).catch(() => undefined);
    active.proof = prepared.proof;
    active.authorizationId = prepared.authorizationId;
    markJobTiming(active, "offerVerifiedAt");
    await saveActiveJob(active);
    const [, postClickSettle] = await settleRequiredWork(
      reportJobBatch(active, [
        {
          state: "offer_verified",
          reasonCode: "live_offer_verified",
          message: `The exact ${lane.name} SKU, seller, price, stock, and fulfillment passed live verification.`,
          evidence: safeOfferEvidence(active.proof)
        },
        {
          state: "add_authorized",
          reasonCode: "add_boundary_prepared",
          message: `The exact ${lane.name} Add control is prepared for one final revalidation.`
        },
        {
          state: "adding",
          reasonCode: "add_receipt_armed",
          message: "The durable at-most-once Add receipt was armed before the browser click."
        }
      ]),
      createPostClickSettle(active.tabId)
    );
    const committed = await executeAddAction(active.tabId, retailerId, lane.commitOperation, [active.runnerJob, active.authorizationId]);
    active.authorizationId = "";
    await saveActiveJob(active);
    if (!committed?.ok || committed?.clicked !== true) {
      await postClickSettle.cancel();
      const reasonCode = safeReasonCode(committed?.reason || "click_uncertain");
      await recordTabOperationDiagnostic(active.tabId, retailerId, "live_add", "failed", runnerFailureStage(reasonCode), reasonCode, active.runnerJob.fulfillment);
      await publishNeedsYou(active, reasonCode).catch(() => undefined);
      await reportJob(active, "manual_review", committed?.reason || "click_uncertain", "The Add boundary did not return a confirmed click result; automatic retry is locked.");
      await clearActiveJob();
      return { confirmed: false, tabId: active.tabId, continueCycle: false };
    }
    active.proof = committed.proof;
    markJobTiming(active, "clickedAt");
    await saveActiveJob(active);
    const settled = await postClickSettle.wait();
    markJobTiming(active, "settledAt");
    active.postClickSettle = settled;
    await saveActiveJob(active);
    const verification = await verifyAddedCart(active);
    return {
      confirmed: verification.confirmed,
      tabId: active.tabId,
      continueCycle: verification.confirmed,
      cartBaseline: verification.cartBaseline,
      signedInState: verification.signedInState || active.signedInState || "unknown"
    };
  } catch {
    const mutationPossible = ["adding", "cart_verified"].includes(active.phase);
    await failActiveJob(active, mutationPossible);
    return { confirmed: false, tabId: active.tabId, continueCycle: !mutationPossible };
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

function exactWalmartReviewOrderRoute(value, retailerSku) {
  try {
    const url = new URL(String(value || ""));
    const itemId = String(retailerSku || "");
    const keys = [...url.searchParams.keys()];
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
      || !["walmart.com", "www.walmart.com"].includes(url.hostname)
      || url.pathname !== "/affil/cart/reviewOrder"
      || !/^\d{5,20}$/.test(itemId)
      || keys.length !== 3 || new Set(keys).size !== 3
      || !keys.every((key) => ["items", "cn", "veh"].includes(key))
      || url.searchParams.get("items") !== itemId
      || url.searchParams.get("cn") !== "nc"
      || url.searchParams.get("veh") !== "aff") return "";
    return url.href;
  } catch {
    return "";
  }
}

function exactHowlWalmartReviewOrderRoute(value, retailerSku) {
  try {
    const url = new URL(String(value || ""));
    const keys = [...url.searchParams.keys()];
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
      || url.hostname !== "howl.link" || url.pathname !== "/link"
      || keys.length !== 5 || new Set(keys).size !== 5
      || !keys.every((key) => ["url", "publisher_slug", "article_name", "article_url", "u1"].includes(key))
      || !/^[a-z0-9][a-z0-9_-]{1,79}$/.test(String(url.searchParams.get("publisher_slug") || ""))
      || !String(url.searchParams.get("article_name") || "").trim()
      || url.searchParams.get("u1") !== `walmart_${retailerSku}`
      || !exactWalmartReviewOrderRoute(url.searchParams.get("url"), retailerSku)) return "";
    const articleUrl = new URL(String(url.searchParams.get("article_url") || ""));
    if (articleUrl.protocol !== "https:" || articleUrl.username || articleUrl.password || articleUrl.port) return "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizedWalmartNotificationHandoff(notification, now = Date.now()) {
  const handoff = notification?.purchaseHandoff;
  if (!handoff || typeof handoff !== "object" || handoff.kind !== "walmart_review_order"
    || notification.retailerId !== "walmart"
    || String(handoff.walmartItemId || "") !== String(notification.retailerSku || "")) return null;
  const pdpFallbackRoute = exactRetailerNotificationUrl(
    handoff.pdpFallbackUrl,
    notification.retailerId,
    notification.retailerSku
  );
  const canonicalUrl = exactRetailerNotificationUrl(
    notification.canonicalUrl,
    notification.retailerId,
    notification.retailerSku
  );
  const directFallbackRoute = exactWalmartReviewOrderRoute(
    handoff.directFallbackUrl,
    notification.retailerSku
  );
  const expiresAt = String(handoff.expiresAt || "");
  const expiry = new Date(expiresAt).getTime();
  const notificationExpiry = new Date(String(notification.expiresAt || "")).getTime();
  if (!pdpFallbackRoute || pdpFallbackRoute !== canonicalUrl || !directFallbackRoute
    || !Number.isFinite(expiry) || !Number.isFinite(notificationExpiry)
    || expiry <= now || expiry > notificationExpiry) return null;
  const route = exactHowlWalmartReviewOrderRoute(handoff.destinationUrl, notification.retailerSku)
    || exactWalmartReviewOrderRoute(handoff.destinationUrl, notification.retailerSku)
    || directFallbackRoute;
  return {
    kind: "walmart_review_order",
    retailerId: "walmart",
    retailerSku: String(notification.retailerSku),
    title: String(notification.title || "Walmart opportunity")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "Walmart opportunity",
    route,
    directFallbackRoute,
    pdpFallbackRoute,
    expiresAt
  };
}

function normalizedNotificationLease(value) {
  const notification = value?.notification;
  if (!notification || typeof notification !== "object") return null;
  const id = String(notification.id || "");
  const capabilityToken = String(notification.capabilityToken || "");
  const expiresAt = String(notification.expiresAt || "");
  const purchaseHandoff = normalizedWalmartNotificationHandoff(notification);
  const route = purchaseHandoff?.route || notificationRoute(notification);
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
    route,
    storedRoute: purchaseHandoff || route,
    contextMessage: purchaseHandoff ? "Buy at Walmart · opens cart" : "Yoink strategy match"
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
    .filter(([id, route]) => /^[A-Za-z0-9_-]{3,160}$/.test(id)
      && ((typeof route === "string" && route.length <= 4_096)
        || (route && typeof route === "object" && !Array.isArray(route)
          && JSON.stringify(route).length <= 13_000)))
    .slice(-100));
}

async function stageNotificationRoute(notification) {
  const routes = await notificationRoutes();
  const nextRoutes = Object.fromEntries([
    ...Object.entries(routes).filter(([id]) => id !== notification.id),
    [notification.id, notification.storedRoute]
  ].slice(-100));
  await chrome.storage.local.set({ [NOTIFICATION_ROUTES_KEY]: nextRoutes });
}

async function rememberNotification(notification) {
  const history = await notificationHistory();
  const routes = await notificationRoutes();
  const nextHistory = [...history.filter((id) => id !== notification.id), notification.id].slice(-200);
  const nextRoutes = Object.fromEntries([
    ...Object.entries(routes).filter(([id]) => id !== notification.id),
    [notification.id, notification.storedRoute]
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

function boundedNotificationWait(value) {
  const waitMs = Math.floor(Number(value) || 0);
  return Number.isSafeInteger(waitMs) ? Math.max(0, Math.min(NOTIFICATION_WAIT_MS, waitMs)) : 0;
}

async function runNotificationDrain(waitMs = 0) {
  const device = await storedDevice();
  if (!device?.token) return { delivered: 0, reason: "device_unavailable" };
  let delivered = 0;
  for (let index = 0; index < MAX_NOTIFICATIONS_PER_CYCLE; index += 1) {
    const leaseWaitMs = index === 0 ? boundedNotificationWait(waitMs) : 0;
    // The authenticated lease validates that the paired device is active and
    // notification-capable. Only the first request may wait; ready deliveries
    // then drain immediately without another alarm or another long poll.
    const payload = await request(`/devices/self/notifications/next?wait=${leaseWaitMs}`, {
      headers: { Authorization: `Bearer ${device.token}` }
    }, leaseWaitMs > 0 ? NOTIFICATION_REQUEST_TIMEOUT_MS : 3_000);
    const closedDeliveryIds = normalizedClosedNotificationDeliveryIds(payload?.closedDeliveryIds);
    const reconciled = await reconcileClosedNotificationRoutes(closedDeliveryIds);
    const closureAcknowledgement = closedDeliveryIds.length
      ? request("/devices/self/notifications/closures/ack", {
        method: "POST",
        headers: { Authorization: `Bearer ${device.token}` },
        body: JSON.stringify({ contractVersion: 1, deliveryIds: closedDeliveryIds })
      }).catch(() => undefined)
      : Promise.resolve();
    const notification = normalizedNotificationLease(payload);
    if (!notification) {
      await closureAcknowledgement;
      return {
        delivered,
        reconciled,
        reason: String(payload?.reason || (delivered ? "drained" : "no_notifications"))
      };
    }
    void closureAcknowledgement;
    const history = await notificationHistory();
    if (history.includes(notification.id)) {
      await acknowledgeNotification(device, notification, "delivered");
      continue;
    }
    let shown = false;
    try {
      // Persist the validated click route before Chrome makes the notification
      // interactive. A user can click immediately after create resolves.
      await stageNotificationRoute(notification);
      await chrome.notifications.create(`yoink-opportunity:${notification.id}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("yoink-icon.svg"),
        title: notification.title,
        message: notification.message,
        contextMessage: notification.contextMessage,
        priority: 2
      });
      shown = true;
      await rememberNotification(notification);
      await acknowledgeNotification(device, notification, "delivered");
      delivered += 1;
    } catch {
      if (!shown) await acknowledgeNotification(device, notification, "failed", "chrome_notification_failed").catch(() => undefined);
      throw new Error("Chrome notification delivery failed.");
    }
  }
  return { delivered, reason: "cycle_limit" };
}

function runNotificationCycle(waitMs = 0) {
  const requestedWaitMs = boundedNotificationWait(waitMs);
  if (notificationCyclePromise) {
    notificationCyclePendingWaitMs = Math.max(notificationCyclePendingWaitMs, requestedWaitMs);
    return notificationCyclePromise;
  }
  notificationCyclePromise = (async () => {
    let nextWaitMs = requestedWaitMs;
    let delivered = 0;
    let reason = "no_notifications";
    do {
      const result = await runNotificationDrain(nextWaitMs)
        .catch(() => ({ delivered: 0, reason: "cycle_failed" }));
      delivered += result.delivered;
      reason = result.reason;
      nextWaitMs = notificationCyclePendingWaitMs;
      notificationCyclePendingWaitMs = -1;
    } while (nextWaitMs >= 0);
    return { delivered, reason };
  })().finally(() => { notificationCyclePromise = null; });
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

function watchObservationBody(lease, observation = null, reasonCode = "") {
  const exact = observation
    && observation.retailerId === lease.retailerId
    && String(observation.retailerSku || "").toUpperCase() === String(lease.retailerSku || "").toUpperCase()
    ? observation : null;
  return {
    contractVersion: 1,
    capabilityToken: lease.capabilityToken,
    retailerId: lease.retailerId,
    retailerSku: lease.retailerSku,
    availability: exact?.availability || "unknown",
    unitPriceCents: Number.isSafeInteger(exact?.unitPriceCents) ? exact.unitPriceCents : null,
    currency: exact?.currency === "USD" ? "USD" : "USD",
    sellerName: String(exact?.sellerName || "").slice(0, 160),
    sellerType: ["first_party", "third_party"].includes(exact?.sellerType) ? exact.sellerType : "unknown",
    fulfillment: ["shipping", "pickup"].includes(exact?.fulfillment) ? exact.fulfillment : "unknown",
    observerVersion: lease.retailerId === "target"
      ? TARGET_OBSERVER_VERSION
      : RETAILER_OBSERVER_VERSIONS[lease.retailerId] || "unsupported-observer",
    observedAt: exact?.observedAt || new Date().toISOString(),
    extensionVersion: EXTENSION_VERSION,
    ...(reasonCode ? { reasonCode: safeReasonCode(reasonCode) } : {})
  };
}

async function postWatchObservation(device, lease, observation = null, reasonCode = "") {
  return request(`/devices/self/watch-queue/${encodeURIComponent(lease.id)}/observations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify(watchObservationBody(lease, observation, reasonCode))
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
}

function normalizedWatchLease(value) {
  if (!value || value.contractVersion !== 1 || value.readOnly !== true || value.quantity !== 1
    || !/^watch_item_[a-f0-9]{32}$/.test(String(value.id || ""))
    || !/^[A-Za-z0-9_-]{20,100}$/.test(String(value.capabilityToken || ""))) return null;
  const leaseExpiresAt = String(value.leaseExpiresAt || "");
  if (!leaseExpiresAt || new Date(leaseExpiresAt).getTime() <= Date.now()) return null;
  const identity = canonicalRetailerIdentity(value.canonicalUrl);
  if (!identity || identity.retailerId !== value.retailerId
    || identity.retailerSku !== String(value.retailerSku || "").toUpperCase()) return null;
  return {
    contractVersion: 1,
    id: String(value.id),
    capabilityToken: String(value.capabilityToken),
    leaseExpiresAt,
    retailerId: identity.retailerId,
    retailerSku: identity.retailerSku,
    canonicalUrl: identity.canonicalUrl,
    readOnly: true,
    quantity: 1
  };
}

function watchQueuePublicState(state, lease = null, reason = "") {
  return {
    schemaVersion: 1,
    state: ["idle", "leased", "observing", "reported", "retrying", "error"].includes(state) ? state : "error",
    watchItemId: String(lease?.id || "").slice(0, 80),
    retailerId: String(lease?.retailerId || "").slice(0, 40),
    retailerSku: String(lease?.retailerSku || "").slice(0, 80),
    leaseExpiresAt: String(lease?.leaseExpiresAt || "").slice(0, 40),
    reasonCode: safeReasonCode(reason),
    updatedAt: new Date().toISOString()
  };
}

async function saveWatchLease(lease) {
  const normalized = normalizedWatchLease(lease);
  if (!normalized) throw new Error("watch_lease_invalid");
  await Promise.all([
    chrome.storage.session.set({ [WATCH_QUEUE_LEASE_KEY]: normalized }),
    chrome.storage.local.set({ [WATCH_QUEUE_STATE_KEY]: watchQueuePublicState("leased", normalized, "leased") })
  ]);
  return normalized;
}

async function readWatchLease() {
  const stored = await chrome.storage.session.get(WATCH_QUEUE_LEASE_KEY);
  const lease = normalizedWatchLease(stored[WATCH_QUEUE_LEASE_KEY]);
  if (!lease && stored[WATCH_QUEUE_LEASE_KEY]) await chrome.storage.session.remove(WATCH_QUEUE_LEASE_KEY);
  return lease;
}

async function updateWatchQueueState(state, lease = null, reason = "") {
  await chrome.storage.local.set({ [WATCH_QUEUE_STATE_KEY]: watchQueuePublicState(state, lease, reason) });
}

async function finishWatchLease(lease, reason) {
  await Promise.all([
    chrome.storage.session.remove(WATCH_QUEUE_LEASE_KEY),
    updateWatchQueueState("reported", lease, reason)
  ]);
}

async function collectWatchObservation(tabId, lease) {
  if (lease.retailerId === "target") {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      files: ["target-shadow.js"]
    });
    const injections = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: () => {
        try {
          const observer = globalThis.YoinkTargetShadow;
          return observer?.collectTargetShadowObservation
            ? { ok: true, observation: observer.collectTargetShadowObservation(document, location.href) }
            : { ok: false, reasonCode: "observer_runtime_unavailable" };
        } catch {
          return { ok: false, reasonCode: "observer_collection_failed" };
        }
      }
    });
    const result = injections.find((entry) => entry.frameId === 0)?.result;
    if (!result?.ok) throw new Error(result?.reasonCode || "observer_collection_failed");
    return targetObservationPayload(result.observation);
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: ["retailer-shadow.js"]
  });
  let result = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const injections = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      args: [lease.retailerId, attempt],
      func: (retailerId, attemptCount) => {
        try {
          const observer = globalThis.YoinkRetailerShadow;
          return observer?.collectRetailerShadowAttempt
            ? { ok: true, ...observer.collectRetailerShadowAttempt(document, location.href, retailerId, "shipping", attemptCount, false) }
            : { ok: false, reasonCode: "observer_runtime_unavailable" };
        } catch {
          return { ok: false, reasonCode: "observer_collection_failed" };
        }
      }
    });
    result = injections.find((entry) => entry.frameId === 0)?.result;
    if (!result?.ok || result.observation?.availability !== "unknown" || attempt === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!result?.ok) throw new Error(result?.reasonCode || "observer_collection_failed");
  return retailerObservationPayload(result.observation, lease.retailerId);
}

async function runWatchQueueCycle() {
  if (watchQueueCyclePromise) return watchQueueCyclePromise;
  watchQueueCyclePromise = (async () => {
    const device = await storedDevice();
    if (!device?.token) return { observed: false, reason: "device_unavailable" };
    if (await activeJob().catch(() => null)) return { observed: false, reason: "action_job_active" };
    let lease = await readWatchLease();
    if (!lease) {
      const response = await request("/devices/self/watch-queue/next", {
        headers: { Authorization: `Bearer ${device.token}` }
      });
      if (!response?.item) {
        await updateWatchQueueState("idle", null, String(response?.reason || "no_watch_items"));
        return { observed: false, reason: String(response?.reason || "no_watch_items") };
      }
      lease = await saveWatchLease(response.item);
    }
    await updateWatchQueueState("observing", lease, "read_only_observation");
    const identity = canonicalRetailerIdentity(lease.canonicalUrl);
    if (!identity || identity.retailerId !== lease.retailerId
      || identity.retailerSku !== String(lease.retailerSku || "").toUpperCase()) {
      await postWatchObservation(device, lease, null, "listing_identity_invalid");
      await finishWatchLease(lease, "listing_identity_invalid");
      return { observed: true, reason: "listing_identity_invalid" };
    }
    const origins = lease.retailerId === "target" ? TARGET_ORIGINS : RETAILER_ORIGINS[lease.retailerId];
    if (!origins || !await chrome.permissions.contains({ origins })) {
      await postWatchObservation(device, lease, null, "access_missing");
      await finishWatchLease(lease, "access_missing");
      return { observed: true, reason: "access_missing" };
    }
    let tabId = null;
    try {
      const tab = await chrome.tabs.create({ url: identity.canonicalUrl, active: false });
      if (!Number.isInteger(tab?.id)) throw new Error("watch_tab_unavailable");
      tabId = tab.id;
      await waitForExactProductTab(tabId, identity.retailerId, identity.retailerSku);
      const observation = await collectWatchObservation(tabId, lease);
      const reported = await postWatchObservation(device, lease, observation,
        observation.securityChallenge ? "security_challenge"
          : observation.interactiveBlock ? `interactive_${observation.interactiveBlock}` : "observed");
      await finishWatchLease(lease, observation.availability);
      if (reported?.signal) await runSignalActionHandoff();
      return { observed: true, reason: observation.availability };
    } catch (error) {
      const reason = safeReasonCode(error instanceof Error ? error.message : "observation_failed");
      const reported = await postWatchObservation(device, lease, null, reason)
        .then(() => true).catch(() => false);
      if (reported) await finishWatchLease(lease, reason);
      else await updateWatchQueueState("retrying", lease, reason);
      return { observed: true, reason };
    } finally {
      if (Number.isInteger(tabId)) await chrome.tabs.remove(tabId).catch(() => undefined);
    }
  })().catch(() => ({ observed: false, reason: "watch_cycle_failed" }))
    .finally(() => { watchQueueCyclePromise = null; });
  return watchQueueCyclePromise;
}

function warmReadinessBlocked(control) {
  if (!control?.connected || !control?.paired) return "device_unavailable";
  if (control.actionsPaused === true) return "actions_paused";
  if (control.executionMode !== "live") return "shadow_mode";
  if (control.chromeMutationEnabled !== true) return "retailer_actions_unavailable";
  return "";
}

function warmLaneEnabled(control, retailerId) {
  return control?.[`${retailerId}AddExecutionEnabled`] === true;
}

async function runWarmReadinessCycle(control = null) {
  if (warmReadinessCyclePromise) return warmReadinessCyclePromise;
  warmReadinessCyclePromise = (async () => {
    const storedControl = control || (await chrome.storage.local.get(READINESS_KEY))[READINESS_KEY];
    const blocked = warmReadinessBlocked(storedControl);
    if (blocked) {
      return {
        warmed: false,
        warmedCount: 0,
        attemptedCount: 0,
        reason: blocked,
        results: []
      };
    }
    if (jobCyclePromise || await activeJob().catch(() => null)) {
      return {
        warmed: false,
        warmedCount: 0,
        attemptedCount: 0,
        reason: "action_job_active",
        results: []
      };
    }
    const device = await storedDevice();
    if (!device?.token) {
      return {
        warmed: false,
        warmedCount: 0,
        attemptedCount: 0,
        reason: "device_unavailable",
        results: []
      };
    }
    const [storedTabs, cartReady, cursorStorage] = await Promise.all([
      readRetailerActionTabs(),
      readCartReadyState(),
      chrome.storage.session.get(WARM_READINESS_CURSOR_KEY)
    ]);
    const retailerIds = Object.keys(ADD_LANES);
    const cursor = Number.isSafeInteger(cursorStorage[WARM_READINESS_CURSOR_KEY])
      ? cursorStorage[WARM_READINESS_CURSOR_KEY] % retailerIds.length : 0;
    const protectedTabs = new Set(cartReady.items.map((item) => item.tabId));

    const results = [];
    for (let offset = 0; offset < retailerIds.length && results.length < WARM_READINESS_LANES_PER_CYCLE; offset += 1) {
      if (results.length && (jobCyclePromise || await activeJob().catch(() => null))) break;
      const index = (cursor + offset) % retailerIds.length;
      const retailerId = retailerIds[index];
      if (!warmLaneEnabled(storedControl, retailerId)) continue;
      if (!await addLaneAccess(retailerId)) continue;
      const lane = ADD_LANES[retailerId];
      const stored = storedTabs.get(retailerId);
      if (protectedTabs.has(stored?.tabId)) continue;
      let tab = Number.isInteger(stored?.tabId)
        ? await chrome.tabs.get(stored.tabId).catch(() => null) : null;
      if (stored?.signedInState === "challenged" && Number.isInteger(tab?.id)
        && !retailerCartTab(tab, retailerId)) {
        await chrome.storage.session.set({
          [WARM_READINESS_CURSOR_KEY]: (index + 1) % retailerIds.length
        });
        results.push({
          warmed: false,
          retailerId,
          signedInState: "challenged",
          reason: "manual_action_required"
        });
        continue;
      }
      let createdTabId = null;
      try {
        if (!retailerCartTab(tab, retailerId)) {
          tab = await chrome.tabs.create({ url: lane.cartUrl, active: false });
          if (!Number.isInteger(tab?.id)) throw new Error("warm_cart_tab_unavailable");
          createdTabId = tab.id;
        }
        await waitForTab(tab.id, retailerId, "cart");
        if (jobCyclePromise || await activeJob().catch(() => null)) {
          if (Number.isInteger(createdTabId)) await chrome.tabs.remove(createdTabId).catch(() => undefined);
          results.push({ warmed: false, retailerId, signedInState: stored?.signedInState || "unknown", reason: "action_job_started" });
          break;
        }
        let signedInState = await inspectRetailerSessionState(tab.id, retailerId).catch(() => "unknown");
        let cartBaseline = freshCartBaseline(stored?.cartBaseline, retailerId);
        let errorCode = "";
        if (!cartBaseline) {
          await injectAddAction(tab.id, retailerId);
          const baseline = await executeReadOnlyCartAction(
            tab.id,
            retailerId,
            lane.baselineOperation,
            [],
            WARM_CART_BASELINE_WAIT_MAX_MS
          );
          cartBaseline = baseline?.ok ? freshCartBaseline(baseline.proof, retailerId) : null;
          errorCode = cartBaseline ? "" : safeReasonCode(baseline?.reason || "cart_unverified");
          if (baseline?.reason === "manual_action_required") signedInState = "challenged";
        }
        await rememberRetailerActionTab(retailerId, tab.id, cartBaseline, signedInState);
        await reportRetailerReadiness(retailerId, {
          cartBaseline,
          cartBaselineState: cartBaseline ? "ready" : "unavailable",
          signedInState,
          ...(errorCode ? { errorCode } : {})
        });
        await chrome.storage.session.set({
          [WARM_READINESS_CURSOR_KEY]: (index + 1) % retailerIds.length
        });
        results.push({
          warmed: Boolean(cartBaseline),
          retailerId,
          signedInState,
          reason: cartBaseline ? "baseline_ready" : errorCode || "cart_unverified"
        });
      } catch (error) {
        const reason = safeReasonCode(error instanceof Error ? error.message : "warm_readiness_failed");
        const signedInState = Number.isInteger(tab?.id)
          ? await inspectRetailerSessionState(tab.id, retailerId).catch(() => "unknown")
          : "unknown";
        await reportRetailerReadiness(retailerId, {
          cartBaselineState: "unavailable",
          signedInState,
          errorCode: reason
        });
        await chrome.storage.session.set({
          [WARM_READINESS_CURSOR_KEY]: (index + 1) % retailerIds.length
        });
        if (Number.isInteger(createdTabId) && !retailerCartTab(tab, retailerId)) {
          await chrome.tabs.remove(createdTabId).catch(() => undefined);
        }
        results.push({ warmed: false, retailerId, signedInState, reason });
      }
    }
    const warmedCount = results.filter((result) => result.warmed).length;
    return {
      warmed: warmedCount > 0,
      warmedCount,
      attemptedCount: results.length,
      reason: !results.length ? "retailer_access_missing"
        : warmedCount === results.length ? "baselines_ready"
          : warmedCount > 0 ? "partial" : results.at(-1)?.reason || "warm_readiness_failed",
      results
    };
  })().catch(() => ({
    warmed: false,
    warmedCount: 0,
    attemptedCount: 0,
    reason: "warm_readiness_failed",
    results: []
  }))
    .finally(() => { warmReadinessCyclePromise = null; });
  return warmReadinessCyclePromise;
}

function requestWarmReadinessCycle(control = null) {
  if (warmReadinessRequestPromise) return warmReadinessRequestPromise;
  warmReadinessRequestPromise = (async () => {
    let result = null;
    // The 25-second action-job watch intentionally owns priority over
    // background warming. Health and job alarms can align, so dropping the
    // warm request here would repeatedly leave half the retailer lanes cold.
    // Wait behind the current action cycle, then retry once for the narrow
    // promise-finalization race without ever running beside a real add.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const activeCycle = jobCyclePromise;
      if (activeCycle) await activeCycle.catch(() => undefined);
      result = await runWarmReadinessCycle(control);
      if (result?.reason !== "action_job_active") return result;
    }
    return result;
  })().finally(() => { warmReadinessRequestPromise = null; });
  return warmReadinessRequestPromise;
}

async function runJobCycle(onFirstLeaseDispatched = null) {
  if (jobCyclePromise) {
    if (typeof onFirstLeaseDispatched === "function") onFirstLeaseDispatched();
    return jobCyclePromise;
  }
  jobCyclePromise = (async () => {
    if (await resumeActiveRetailerJob()) {
      return { leased: 0, confirmed: 0, reason: "active_job_recovered" };
    }
    let leased = 0;
    let confirmed = 0;
    // The authenticated lease is the action preflight: the server rechecks
    // live mode, pause, device status/capabilities, lane qualification, spend,
    // job expiry, and single-device ownership atomically. General health and
    // heartbeat refresh stay on their minute alarm instead of adding two
    // unrelated round trips in front of every signal-triggered lease.
    const device = await storedDevice();
    if (!device?.token) return { leased, confirmed, reason: "device_unavailable" };
    const [targetAccess, walmartAccess, amazonAccess, bestBuyAccess] = await Promise.all([
      addLaneAccess("target"),
      addLaneAccess("walmart"),
      addLaneAccess("amazon"),
      addLaneAccess("bestbuy")
    ]);
    if (!targetAccess && !walmartAccess && !amazonAccess && !bestBuyAccess) {
      return { leased, confirmed, reason: "retailer_access_missing" };
    }
    const accessibleRetailers = [
      ...(targetAccess ? ["target"] : []),
      ...(walmartAccess ? ["walmart"] : []),
      ...(amazonAccess ? ["amazon"] : []),
      ...(bestBuyAccess ? ["bestbuy"] : [])
    ];
    const [storedTabs, cartReady] = await Promise.all([
      readRetailerActionTabs(),
      readCartReadyState()
    ]);
    const protectedTabs = new Set(cartReady.items.map((item) => item.tabId));
    const reusableTabs = new Map([...storedTabs]
      .filter(([, stored]) => !protectedTabs.has(stored.tabId))
      .map(([retailerId, stored]) => [retailerId, stored]));
    for (let index = 0; index < MAX_ACTION_JOBS_PER_CYCLE; index += 1) {
      const leaseRequest = actionJobLeaseRequest(index, accessibleRetailers);
      const responsePromise = request(leaseRequest.path, {
        headers: { Authorization: `Bearer ${device.token}` }
      }, leaseRequest.timeoutMs);
      if (index === 0 && typeof onFirstLeaseDispatched === "function") {
        onFirstLeaseDispatched();
      }
      const response = await responsePromise;
      const lease = normalizedLeaseJob(response);
      if (!lease) {
        const leaseReason = ["no_jobs", "actions_paused", "shadow_mode", "device_busy", "device_unavailable"]
          .includes(String(response?.reason || "")) ? String(response.reason) : "jobs_unavailable";
        return {
          leased,
          confirmed,
          reason: leaseReason
        };
      }
      leased += 1;
      const reusable = reusableTabs.get(lease.retailerId);
      const outcome = await executeLeasedRetailerJob(
        lease,
        reusable?.tabId,
        reusable?.cartBaseline,
        reusable?.signedInState
      );
      if (Number.isInteger(outcome.tabId)) {
        reusableTabs.set(lease.retailerId, {
          tabId: outcome.tabId,
          cartBaseline: outcome.cartBaseline || null,
          signedInState: outcome.signedInState || "unknown"
        });
        await rememberRetailerActionTab(
          lease.retailerId,
          outcome.tabId,
          outcome.cartBaseline,
          outcome.signedInState
        );
      }
      if (!outcome?.confirmed) {
        if (outcome?.continueCycle === true) continue;
        return { leased, confirmed, reason: "job_stopped" };
      }
      confirmed += 1;
    }
    return { leased, confirmed, reason: "cycle_limit" };
  })().catch(() => ({ leased: 0, confirmed: 0, reason: "cycle_failed" })).finally(() => { jobCyclePromise = null; });
  return jobCyclePromise;
}

function runSignalJobHandoff() {
  if (signalJobHandoffPromise) return signalJobHandoffPromise;
  signalJobHandoffPromise = runJobCycle()
    .finally(() => { signalJobHandoffPromise = null; });
  return signalJobHandoffPromise;
}

function runSignalActionHandoff(existingJobHandoff = null) {
  return Promise.allSettled([
    existingJobHandoff || runSignalJobHandoff(),
    runNotificationCycle(NOTIFICATION_WAIT_MS)
  ]);
}

function runJobAlarmCycle() {
  let secondaryStarted = false;
  const startSecondaryWork = () => {
    if (secondaryStarted) return;
    secondaryStarted = true;
    void reconcileActionHandoffs(ACTION_HANDOFF_WAIT_MS);
    // Server-side providers do not necessarily have a local Chrome push event
    // to start the notification watcher. Hold the notification lease beside
    // the guarded-job lease across most of this 30-second alarm interval so a
    // notify-only result can wake on the shared availability pulse instead of
    // waiting for the next alarm. The alarm remains the durable recovery path
    // if Chrome suspends either bounded request.
    void runNotificationCycle(NOTIFICATION_WAIT_MS);
  };
  // Dispatch the time-sensitive cart lease before starting background
  // reconciliation and notification polling. If local prerequisites stop the
  // cycle before a lease, the finally path still runs both secondary tasks.
  void runJobCycle(startSecondaryWork).finally(startSecondaryWork);
}

async function runSignalDeliveryCycle(startLeaseWatch = false) {
  // A valid push already gives Chrome enough reason to open the authoritative
  // server-side job watch. Starting it before the durable ingress response
  // removes one serial network hop; the lease endpoint still performs every
  // action, policy, qualification, spend, device, and expiry check.
  const earlyHandoff = startLeaseWatch ? runSignalJobHandoff() : null;
  const delivery = await drainTrackalackerQueue();
  const status = delivery?.state ? postTrackalackerStatus(delivery.state) : Promise.resolve(false);
  const handoff = delivery?.delivered > 0
    ? runSignalActionHandoff(earlyHandoff)
    : Promise.resolve(null);
  await Promise.allSettled([handoff, status]);
  return delivery;
}

async function handleTrackalackerPushEvent(event) {
  const state = await readTrackalackerState();
  if (!state.enabled || !TrackalackerPush) return;
  let payload = null;
  try { payload = event.data?.json(); } catch { payload = null; }
  const receivedAt = new Date().toISOString();
  const signalId = `push:trackalacker:${crypto.randomUUID()}`;
  const notification = (async () => {
    let visibleNotificationRequired = true;
    try {
      const subscription = await globalThis.registration?.pushManager?.getSubscription?.();
      visibleNotificationRequired = subscription?.options?.userVisibleOnly !== false;
    } catch {
      visibleNotificationRequired = true;
    }
    if (!visibleNotificationRequired) return;
    const presentation = TrackalackerPush.notificationPresentation(payload, signalId);
    await globalThis.registration?.showNotification?.(presentation.title, presentation.options).catch(() => undefined);
  })();
  const envelope = TrackalackerPush.signalEnvelopeFromPush(payload, signalId, receivedAt, chrome.runtime.id);
  if (!envelope) {
    const failed = await updateTrackalackerState({ lastNotificationAt: receivedAt, errorCode: "signal_delivery_rejected" });
    await Promise.allSettled([notification, postTrackalackerStatus(failed)]);
    return;
  }
  await mutateTrackalackerQueue((current) => current.some((entry) => entry.signalId === envelope.signalId)
    ? current : [...current, envelope]);
  await updateTrackalackerState({ lastNotificationAt: receivedAt, errorCode: "" });
  await Promise.allSettled([notification, runSignalDeliveryCycle(true)]);
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

function contextMenuCallback(operation) {
  return new Promise((resolve, reject) => {
    operation(() => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message || "The extension menu could not be updated."));
      else resolve();
    });
  });
}

async function ensureContextMenus() {
  if (!chrome.contextMenus) return;
  await contextMenuCallback((done) => chrome.contextMenus.removeAll(done)).catch(() => undefined);
  const definitions = [
    { id: CONTEXT_MENU_IDS.open, title: "Open Yoink", contexts: ["action"] },
    {
      id: CONTEXT_MENU_IDS.inspectProduct,
      title: "Inspect product",
      contexts: ["action"],
      documentUrlPatterns: PopupState.PRODUCT_DOCUMENT_PATTERNS
    },
    {
      id: CONTEXT_MENU_IDS.inspectDrawings,
      title: "Inspect drawings",
      contexts: ["action"],
      documentUrlPatterns: ["https://*.walmart.com/shop/collectibles/draw*"]
    },
    { id: CONTEXT_MENU_IDS.reconnect, title: "Reconnect TrackaLacker", contexts: ["action"], visible: false },
    { id: CONTEXT_MENU_IDS.sync, title: "Sync products", contexts: ["action"] },
    { id: CONTEXT_MENU_IDS.settings, title: "Extension settings", contexts: ["action"] }
  ];
  for (const definition of definitions) {
    await contextMenuCallback((done) => chrome.contextMenus.create(definition, done));
  }
}

function updateContextMenu(id, properties) {
  if (!chrome.contextMenus) return Promise.resolve();
  return contextMenuCallback((done) => chrome.contextMenus.update(id, properties, done)).catch(() => undefined);
}

async function updateContextMenuHealth(state) {
  if (!chrome.contextMenus) return;
  const base = {
    health: state,
    installedVersion: EXTENSION_VERSION,
    production: RUNTIME_CONFIG.profile === "production"
  };
  const idleCommands = PopupState.deriveContextMenuCommands({
    ...base,
    page: PopupState.classifyPageContext("")
  });
  const productCommands = PopupState.deriveContextMenuCommands({
    ...base,
    page: PopupState.classifyPageContext("https://www.target.com/p/-/A-123456")
  });
  const drawingCommands = PopupState.deriveContextMenuCommands({
    ...base,
    page: PopupState.classifyPageContext("https://www.walmart.com/shop/collectibles/draw")
  });
  await Promise.all([
    updateContextMenu(CONTEXT_MENU_IDS.inspectProduct, { visible: productCommands.includes("inspect_product") }),
    updateContextMenu(CONTEXT_MENU_IDS.inspectDrawings, { visible: drawingCommands.includes("inspect_drawings") }),
    updateContextMenu(CONTEXT_MENU_IDS.reconnect, { visible: idleCommands.includes("reconnect_trackalacker") }),
    updateContextMenu(CONTEXT_MENU_IDS.sync, { visible: idleCommands.includes("sync_products") })
  ]);
}

function contextMenuCommand(menuItemId) {
  if (menuItemId === CONTEXT_MENU_IDS.open) return "open_yoink";
  if (menuItemId === CONTEXT_MENU_IDS.inspectProduct) return "inspect_product";
  if (menuItemId === CONTEXT_MENU_IDS.inspectDrawings) return "inspect_drawings";
  if (menuItemId === CONTEXT_MENU_IDS.reconnect) return "reconnect_trackalacker";
  if (menuItemId === CONTEXT_MENU_IDS.sync) return "sync_products";
  if (menuItemId === CONTEXT_MENU_IDS.settings) return "settings";
  return "";
}

function appViewUrl(destination = "dashboard") {
  return PopupState.appDestinationUrl(APP_ROOT, destination);
}

function contextMenuPermission(command, page) {
  if (command === "inspect_product" && page.kind === "product") {
    return chrome.permissions.request({ origins: PopupState.RETAILER_ORIGINS[page.retailerId] });
  }
  if (command === "inspect_drawings" && page.kind === "walmart_draw") {
    return chrome.permissions.request({ origins: PopupState.RETAILER_ORIGINS.walmart });
  }
  if (command === "reconnect_trackalacker") {
    return chrome.permissions.request({ origins: TRACKALACKER_ORIGINS });
  }
  if (command === "sync_products") {
    return chrome.permissions.request({ origins: TRACKALACKER_ORIGINS });
  }
  return Promise.resolve(true);
}

async function currentContextMenuTab(tab) {
  if (!Number.isInteger(tab?.id)) throw new Error("No active browser tab is available.");
  const fresh = await chrome.tabs.get(tab.id);
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!fresh || active[0]?.id !== tab.id) throw new Error("Keep the original tab active and try again.");
  return { tab: fresh, page: PopupState.classifyPageContext(fresh.url) };
}

async function showContextMenuOutcome(result, error = false) {
  if (await showActionHandoffBadge(await readCartReadyState()).catch(() => null)) return;
  const title = String(result?.summary || result?.message || (error ? "Action failed" : "Action complete"))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  await Promise.all([
    chrome.action.setTitle({ title: `Yoink · ${title}` }),
    chrome.action.setBadgeBackgroundColor({ color: error ? BADGE_COLORS.bad : BADGE_COLORS.good }),
    chrome.action.setBadgeText({ text: error ? "!" : "✓" })
  ]).catch(() => undefined);
}

async function handleContextMenuClick(command, presentedPage, permissionPromise, tab) {
  try {
    const current = await currentContextMenuTab(tab);
    const state = await checkHealth();
    const allowed = PopupState.deriveContextMenuCommands({
      health: state,
      page: current.page,
      installedVersion: EXTENSION_VERSION,
      production: RUNTIME_CONFIG.profile === "production"
    });
    if (!allowed.includes(command)) throw new Error("This action is no longer available.");
    if (current.page.key !== presentedPage.key
      && (command === "inspect_product" || command === "inspect_drawings")) {
      throw new Error("The active page changed. Open the extension and try again.");
    }
    if (!await permissionPromise) throw new Error("Required page access wasn’t approved.");
    if (command === "open_yoink") {
      await chrome.tabs.create({ url: appViewUrl(), active: true });
      return;
    }
    if (command === "settings") {
      await chrome.runtime.openOptionsPage();
      return;
    }
    if (command === "inspect_product") {
      const result = await inspectAndQualifyPopupOperation();
      await showContextMenuOutcome(result.popupResult);
      return;
    }
    if (command === "inspect_drawings") {
      const result = await inspectWalmartDrawPopupOperation();
      await showContextMenuOutcome(result.popupResult);
      return;
    }
    if (command === "reconnect_trackalacker") {
      const result = await connectTrackalacker(false);
      await showContextMenuOutcome({ summary: result.diagnostic || "TrackaLacker connected" });
      return;
    }
    if (command === "sync_products") {
      const result = await startTrackalackerSync();
      await showContextMenuOutcome({ summary: result.alreadyRunning ? "Product sync already running" : "Product sync started" });
    }
  } catch (error) {
    await showContextMenuOutcome({ message: error instanceof Error ? error.message : "Action failed" }, true);
  }
}

async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.alarms.create(HEALTH_ALARM, { periodInMinutes: 1 });
  await chrome.alarms.create(JOB_ALARM, { periodInMinutes: 0.5 });
  await chrome.alarms.create(WATCH_QUEUE_ALARM, { periodInMinutes: 0.5 });
  await chrome.alarms.create(AUTO_REVERIFICATION_ALARM, {
    periodInMinutes: AUTO_REVERIFICATION_PERIOD_MINUTES
  });
  await ensureContextMenus();
  const health = await checkHealth();
  await reconcileActionHandoffs();
  void reconcileActionHandoffs(ACTION_HANDOFF_WAIT_MS);
  await drainAdapterDiagnosticQueue();
  const signalDelivery = await runSignalDeliveryCycle();
  // A cold worker may have server-originated Discord/API/admin work waiting
  // even when its local TrackaLacker queue is empty. Establish both bounded
  // watches together so startup has the same event-driven handoff semantics
  // as a locally accepted signal.
  if (!signalDelivery?.delivered) await runSignalActionHandoff();
  void runWatchQueueCycle();
  void requestWarmReadinessCycle(health);
  void runAutomaticReverification(false);
}

chrome.runtime.onInstalled.addListener(() => { void initialize(); });
chrome.runtime.onStartup.addListener(() => { void initialize(); });
chrome.runtime.onUpdateAvailable?.addListener((details) => {
  if (LOCAL_PACKAGE_UPDATES || !comparableVersion(details?.version)) return;
  void persistExtensionUpdateHandoff("managed", String(details.version));
});
if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    const command = contextMenuCommand(info.menuItemId);
    if (!command) return;
    const presentedPage = PopupState.classifyPageContext(tab?.url || info.pageUrl);
    let permissionPromise;
    try {
      permissionPromise = contextMenuPermission(command, presentedPage);
    } catch (error) {
      permissionPromise = Promise.reject(error);
    }
    void handleContextMenuClick(command, presentedPage, permissionPromise, tab);
  });
}
chrome.commands?.onCommand?.addListener((command) => {
  if (command !== "inspect-current-page") return;
  void (async () => {
    // The shortcut rotates through unseen handoffs; the popup instead keeps an
    // opened handoff first until its checkout outcome is recorded.
    const handoff = PopupState.preferredActionHandoff(await readCartReadyState(), Date.now(), "unopened_first");
    if (handoff) {
      await focusCartReady(handoff.jobId);
      return;
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    const page = PopupState.classifyPageContext(tab?.url);
    const contextCommand = page.kind === "product"
      ? "inspect_product"
      : page.kind === "walmart_draw"
        ? "inspect_drawings"
        : "";
    if (!contextCommand) {
      await showContextMenuOutcome({ message: "Open a supported product or Walmart Draw page first." }, true);
      return;
    }
    let permissionPromise;
    try {
      permissionPromise = contextMenuPermission(contextCommand, page);
    } catch (error) {
      permissionPromise = Promise.reject(error);
    }
    await handleContextMenuClick(contextCommand, page, permissionPromise, tab);
  })().catch((error) => showContextMenuOutcome({
    message: error instanceof Error ? error.message : "Action failed"
  }, true));
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEALTH_ALARM) {
    void drainAdapterDiagnosticQueue();
    void checkHealth().then((health) =>
      runSignalDeliveryCycle().finally(() => requestWarmReadinessCycle(health)));
    // Re-read the lightweight plan on the health cadence so a newly logged
    // layout failure or packaged adapter change starts its bounded repair
    // batch promptly. The stable plan signature prevents duplicate tab work.
    void runAutomaticReverification(false);
    void runNotificationCycle();
  }
  if (alarm.name === JOB_ALARM) {
    runJobAlarmCycle();
  }
  if (alarm.name === WATCH_QUEUE_ALARM) {
    void runWatchQueueCycle();
  }
  if (alarm.name === AUTO_REVERIFICATION_ALARM) {
    void runAutomaticReverification(false);
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const inspectAndQualify = message?.type === "yoink:inspect-and-qualify";
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
  const cartReadyOpen = message?.type === "yoink:open-cart-ready";
  const cartOutcomeReport = message?.type === "yoink:report-cart-outcome";
  const purchaseOpportunityGet = message?.type === "yoink:get-purchase-opportunity";
  const purchaseOpportunityOpen = message?.type === "yoink:open-purchase-opportunity";
  const localDataDeletion = message?.type === "yoink:delete-local-data";
  const reverificationPlan = message?.type === "yoink:get-reverification-plan";
  const retailerReverification = message?.type === "yoink:reverify-retailer-lanes";
  const automaticReverificationGet = message?.type === "yoink:get-auto-reverification";
  const automaticReverificationSet = message?.type === "yoink:set-auto-reverification";
  const automaticReverificationRun = message?.type === "yoink:run-auto-reverification";
  const contentOperation = [
    "yoink:resolve-trackalacker-listing",
    "yoink:trackalacker-sync-progress",
    "yoink:trackalacker-sync-item",
    "yoink:trackalacker-sync-sample"
  ].includes(message?.type);
  const pageOperation = inspectAndQualify || inspection || walmartDrawInspection || retailerInspection || communityContribution || rehearsal || walmartRehearsal || amazonRehearsal || bestBuyRehearsal || trackalackerConnection || trackalackerSync || extensionUpdate || cartReadyOpen || cartOutcomeReport || purchaseOpportunityGet || purchaseOpportunityOpen || localDataDeletion || reverificationPlan || retailerReverification || automaticReverificationGet || automaticReverificationSet || automaticReverificationRun || contentOperation;
  const operation = message?.type === "yoink:check-health"
    ? checkHealth()
    : message?.type === "yoink:pair-device"
      ? pairDevice(message.code)
      : message?.type === "yoink:forget-device"
        ? forgetDevice()
        : inspectAndQualify
          ? inspectAndQualifyPopupOperation()
        : inspection
          ? inspectTargetTab()
          : walmartDrawInspection
            ? inspectWalmartDrawPopupOperation()
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
                  ? checkExtensionUpdate(message.download === true, message.requestManaged === true)
                : cartReadyOpen
                  ? focusCartReady(message.jobId)
                : cartOutcomeReport
                  ? reportCartOutcomeFromPopup(message)
                : purchaseOpportunityGet
                  ? pendingPurchaseOpportunity().then((opportunity) => ({ opportunity }))
                : purchaseOpportunityOpen
                  ? openStoredNotificationRoute(message.deliveryId)
                : localDataDeletion
                  ? deleteLocalCompanionData(message.confirmation)
                : reverificationPlan
                  ? getReverificationPlan().then((plan) => ({ plan }))
                : retailerReverification
                  ? runRetailerReverification(message.retailerIds)
                : automaticReverificationGet
                  ? automaticReverificationStatus()
                : automaticReverificationSet
                  ? setAutoReverificationEnabled(message.enabled)
                : automaticReverificationRun
                  ? runAutomaticReverification(true)
                : message?.type === "yoink:resolve-trackalacker-listing"
                  ? resolveTrackalackerListing(message, sender)
                  : message?.type === "yoink:trackalacker-sync-progress"
                    ? recordTrackalackerSyncProgress(message, sender)
                    : message?.type === "yoink:trackalacker-sync-item"
                      ? acceptTrackalackerSyncItem(message, sender)
                      : message?.type === "yoink:trackalacker-sync-sample"
                        ? recordTrackalackerSyncSample(message, sender)
            : null;
  if (!operation) return false;
  operation.then((result) => sendResponse(pageOperation ? { ok: true, ...result } : { ok: true, state: result })).catch((error) => {
    sendResponse({ ok: false, message: error instanceof Error ? error.message : "The Chrome companion request failed." });
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

function trustedStoredNotificationRoute(value, now = Date.now()) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const retailerSku = String(value.retailerSku || "");
    const pdpFallbackRoute = exactRetailerNotificationUrl(
      value.pdpFallbackRoute,
      value.retailerId,
      retailerSku
    );
    if (value.kind !== "walmart_review_order" || value.retailerId !== "walmart"
      || !pdpFallbackRoute) return "";
    const expiry = new Date(String(value.expiresAt || "")).getTime();
    if (!Number.isFinite(expiry) || expiry <= now) return pdpFallbackRoute;
    const directFallbackRoute = exactWalmartReviewOrderRoute(value.directFallbackRoute, retailerSku);
    if (!directFallbackRoute) return pdpFallbackRoute;
    return exactHowlWalmartReviewOrderRoute(value.route, retailerSku)
      || exactWalmartReviewOrderRoute(value.route, retailerSku)
      || directFallbackRoute;
  }
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return "";
    const allowedRetailer = SUPPORTED_RETAILER_DOMAINS
      .some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    if (allowedRetailer) {
      if ((url.hostname === "walmart.com" || url.hostname.endsWith(".walmart.com"))
        && url.pathname === "/affil/cart/reviewOrder") return "";
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
    if ((destination.hostname === "walmart.com" || destination.hostname.endsWith(".walmart.com"))
      && destination.pathname === "/affil/cart/reviewOrder") return "";
    const destinationAllowed = SUPPORTED_RETAILER_DOMAINS
      .some((domain) => destination.hostname === domain || destination.hostname.endsWith(`.${domain}`));
    return destinationAllowed ? url.href : "";
  } catch {
    return "";
  }
}

function popupPurchaseOpportunity(deliveryId, value, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(String(deliveryId || ""))
    || !value || typeof value !== "object" || Array.isArray(value)
    || value.kind !== "walmart_review_order"
    || value.retailerId !== "walmart") return null;
  const retailerSku = String(value.retailerSku || "");
  const expiresAt = String(value.expiresAt || "");
  const expiry = new Date(expiresAt).getTime();
  const directRoute = exactWalmartReviewOrderRoute(value.directFallbackRoute, retailerSku);
  const route = trustedStoredNotificationRoute(value, now);
  if (!/^\d{5,20}$/.test(retailerSku)
    || !Number.isFinite(expiry)
    || expiry <= now
    || expiry > now + 5 * 60_000
    || !directRoute
    || !route
    || route === value.pdpFallbackRoute) return null;
  return {
    schemaVersion: 1,
    deliveryId: String(deliveryId),
    kind: "walmart_review_order",
    retailerId: "walmart",
    retailerName: "Walmart",
    identityLabel: "Item",
    retailerSku,
    title: String(value.title || "Walmart opportunity")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || `Walmart item ${retailerSku}`,
    expiresAt: new Date(expiry).toISOString()
  };
}

async function pendingPurchaseOpportunity(now = Date.now()) {
  const routes = await notificationRoutes();
  for (const [deliveryId, storedRoute] of Object.entries(routes).reverse()) {
    const opportunity = popupPurchaseOpportunity(deliveryId, storedRoute, now);
    if (opportunity) return opportunity;
  }
  return null;
}

function queuedNotificationRouteAction(operation) {
  const task = notificationRouteActionQueue.then(operation);
  notificationRouteActionQueue = task.catch(() => undefined);
  return task;
}

function normalizedClosedNotificationDeliveryIds(value) {
  return [...new Set(Array.isArray(value) ? value : [])]
    .map((entry) => String(entry || ""))
    .filter((entry) => /^[A-Za-z0-9_-]{3,160}$/.test(entry))
    .slice(0, 100);
}

function reconcileClosedNotificationRoutes(value) {
  const closedIds = normalizedClosedNotificationDeliveryIds(value);
  if (!closedIds.length) return Promise.resolve(0);
  return queuedNotificationRouteAction(async () => {
    const closed = new Set(closedIds);
    const routes = await notificationRoutes();
    const retained = Object.fromEntries(
      Object.entries(routes).filter(([deliveryId]) => !closed.has(deliveryId))
    );
    const removed = Object.keys(routes).length - Object.keys(retained).length;
    if (removed > 0) {
      await chrome.storage.local.set({ [NOTIFICATION_ROUTES_KEY]: retained });
    }
    void Promise.allSettled(closedIds.map((deliveryId) =>
      chrome.notifications.clear(`yoink-opportunity:${deliveryId}`)));
    return removed;
  });
}

function forgetNotificationRoute(deliveryId) {
  return queuedNotificationRouteAction(async () => {
    if (!/^[A-Za-z0-9_-]{3,160}$/.test(String(deliveryId || ""))) return false;
    const routes = await notificationRoutes();
    if (!Object.hasOwn(routes, deliveryId)) return false;
    await chrome.storage.local.set({
      [NOTIFICATION_ROUTES_KEY]: Object.fromEntries(
        Object.entries(routes).filter(([id]) => id !== deliveryId)
      )
    });
    return true;
  });
}

function openStoredNotificationRoute(deliveryId) {
  return queuedNotificationRouteAction(async () => {
    if (!/^[A-Za-z0-9_-]{3,160}$/.test(String(deliveryId || ""))) {
      throw new Error("This product opportunity is invalid.");
    }
    const routes = await notificationRoutes();
    const storedRoute = routes[deliveryId];
    const route = trustedStoredNotificationRoute(storedRoute);
    if (!route) throw new Error("This product opportunity is no longer available.");
    const remainingRoutes = Object.fromEntries(
      Object.entries(routes).filter(([id]) => id !== deliveryId)
    );
    // Consume the local route before navigation so a popup and OS-notification
    // click cannot add the same reviewOrder item twice. The queue keeps this
    // one-use boundary atomic within the service worker.
    await chrome.storage.local.set({ [NOTIFICATION_ROUTES_KEY]: remainingRoutes });
    try {
      const tab = await chrome.tabs.create({ url: route, active: true });
      void Promise.allSettled([
        reportNotificationInteraction(deliveryId, "clicked"),
        chrome.notifications.clear(`yoink-opportunity:${deliveryId}`)
      ]);
      return {
        opened: true,
        tabId: Number.isInteger(tab?.id) ? tab.id : null,
        opportunity: await pendingPurchaseOpportunity()
      };
    } catch (error) {
      const latest = await notificationRoutes();
      if (!Object.hasOwn(latest, deliveryId)) {
        await chrome.storage.local.set({
          [NOTIFICATION_ROUTES_KEY]: Object.fromEntries([
            ...Object.entries(latest),
            [deliveryId, storedRoute]
          ].slice(-100))
        });
      }
      throw error;
    }
  });
}

chrome.notifications?.onClicked?.addListener((notificationId) => {
  const handoffMatch = /^(?:yoink-cart-ready|yoink-needs-you):([A-Za-z0-9_-]{3,120})$/.exec(String(notificationId || ""));
  if (handoffMatch) {
    void focusCartReady(handoffMatch[1]).catch(async () => {
      await chrome.notifications.clear(notificationId).catch(() => undefined);
    });
    return;
  }
  const match = /^yoink-opportunity:([A-Za-z0-9_-]{3,160})$/.exec(String(notificationId || ""));
  if (!match) return;
  const deliveryId = match[1];
  void openStoredNotificationRoute(deliveryId).catch(async () => {
    await chrome.notifications.clear(notificationId).catch(() => undefined);
  });
});

chrome.notifications?.onClosed?.addListener((notificationId, byUser) => {
  if (!byUser) return;
  const match = /^yoink-opportunity:([A-Za-z0-9_-]{3,160})$/.exec(String(notificationId || ""));
  if (match) void Promise.allSettled([
    forgetNotificationRoute(match[1]),
    reportNotificationInteraction(match[1], "dismissed")
  ]);
});

chrome.tabs.onRemoved?.addListener((tabId) => {
  void forgetRetailerActionTab(tabId).catch(() => undefined);
  void (async () => {
    const stored = (await chrome.storage.session.get(ORDER_HANDOFF_KEY))[ORDER_HANDOFF_KEY];
    if (Array.isArray(stored)) {
      await chrome.storage.session.set({
        [ORDER_HANDOFF_KEY]: stored.filter((entry) => entry?.tabId !== tabId)
      });
    }
  })().catch(() => undefined);
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" && tab?.status !== "complete") return;
  const url = tab?.url || changeInfo.url;
  void observeOrderConfirmation(tabId, url).catch(() => undefined);
  void refreshRetailerSessionFromTab(tabId, url).catch(() => undefined);
});
