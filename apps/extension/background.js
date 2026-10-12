"use strict";

importScripts("runtime-config.js", "adapter-versions.js", "add-lanes.js", "popup-state.js", "trackalacker-push.js", "observer-recipe-root.js");

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
  || !PopupState?.preferredActionHandoff || !PopupState?.CART_READY_STORAGE_KEY
  || !PopupState?.bestBuyWaitState || !PopupState?.BESTBUY_WAIT_STORAGE_KEY) {
  throw new Error("Yoink Companion has no packaged popup state model.");
}
const API_ROOT = `${RUNTIME_CONFIG.apiOrigin}/api/v1`;
const APP_ROOT = RUNTIME_CONFIG.appOrigin;
const LOCAL_PACKAGE_UPDATES = RUNTIME_CONFIG.localPackageUpdates;
const EVIDENCE_REQUEST_TIMEOUT_MS = 10_000;
const OBSERVER_HYDRATION_MAX_MS = 8_000;
const OBSERVER_HYDRATION_QUIET_MS = 100;
const OBSERVER_HYDRATION_FALLBACK_MS = 400;
const HEALTH_ALARM = "yoink-health";
const JOB_ALARM = "yoink-jobs";
const WATCH_QUEUE_ALARM = "yoink-watch-queue";
const AUTO_REVERIFICATION_ALARM = "yoink-auto-reverification";
const MAX_ACTION_JOBS_PER_CYCLE = 4;
// A plan for several (Kevin, 2026-10-10): these stores add up to this many of
// one item per call, never past the store's own per-order limit.
const CART_QUANTITY_MAX = 10;
const QUANTITY_LANES = new Set(["amazon", "target", "walmart", "bestbuy"]);
const ACTION_JOB_WAIT_MS = 25_000;
const ACTION_JOB_REQUEST_TIMEOUT_MS = 28_000;
// A cart add's progress reports and heartbeats wait this long for Yoink. Kevin's
// Walmart test call (2026-10-12) stopped before its store page loaded: the PC's
// Yoink, busy with other requests, took over the usual 3 s to note the add's
// first step. Its own telemetry shows it can take up to ~6 s to answer.
const JOB_REPORT_TIMEOUT_MS = 15_000;
const ACTION_HANDOFF_WAIT_MS = 25_000;
const ACTION_HANDOFF_REQUEST_TIMEOUT_MS = 28_000;
const NOTIFICATION_WAIT_MS = 25_000;
const NOTIFICATION_REQUEST_TIMEOUT_MS = 28_000;
const MAX_NOTIFICATIONS_PER_CYCLE = 20;
const POST_CLICK_SETTLE_MAX_MS = 1_500;
// An armed observer the worker never waited on (it died mid-add) disconnects itself.
const POST_CLICK_SETTLE_ABANDON_MS = 60_000;
const POST_CLICK_SETTLE_QUIET_MS = 125;
const POST_CLICK_SETTLE_MIN_MS = 300;
const CART_DOM_RETRY_QUIET_MS = 60;
const CART_DOM_RETRY_FALLBACK_MS = 250;
const CART_BASELINE_WAIT_MAX_MS = 1_500;
const CART_PROOF_WAIT_MAX_MS = 2_250;
// A cart that wouldn't read in a background tab gets one more read while shown.
const CART_VISIBLE_RETRY_WAIT_MS = 3_000;
// After raising a cart line, the store's update gets this long before the cart is loaded again.
const CART_RAISE_SETTLE_MS = 1_500;
const WARM_CART_BASELINE_WAIT_MAX_MS = 350;
const CART_BASELINE_MAX_AGE_MS = 5 * 60_000;
const WARM_READINESS_LANES_PER_CYCLE = 2;
// A store without a kept cart tab is checked in a background tab that closes
// again straight away, at most this often, so warming never leaves cart tabs
// open between calls. A real add reads its own cart in a fresh tab.
const WARM_READINESS_RECHECK_MS = 20 * 60_000;
const AUTO_REVERIFICATION_PERIOD_MINUTES = 6 * 60;
// While any lane still needs evidence the loop wakes hourly; the per-lane
// backoffs below keep an individual store from being reopened faster than
// its last outcome allows. Healthy lanes fall back to the six-hour period.
const AUTO_REVERIFICATION_ATTENTION_PERIOD_MINUTES = 60;
// The first run after install, update, or browser start waits only long
// enough for the control-plane heartbeat to settle.
const AUTO_REVERIFICATION_FIRST_RUN_DELAY_MINUTES = 2;
// chrome.notifications cannot decode SVG: create() rejects with "Unable to
// download all specified images." and nothing is shown, in Chrome and Brave.
const NOTIFICATION_ICON = "yoink-icon-128.png";
const LOCAL_RELOAD_SIGNATURE_KEY = "yoinkLocalReloadSignatureV1";
const LOCAL_RELOAD_MAX_ATTEMPTS = 3;
const LOCAL_RELOAD_RETRY_MS = 5 * 60_000;
const LOCAL_RELOAD_SETTLE_MS = 45_000;
const AUTO_REVERIFICATION_COOLDOWN_MS = 24 * 60 * 60_000;
// Automatic store checks back off per lane: a passing lane may be rechecked
// after 30 minutes, a lane that keeps failing waits 1 h, 4 h, 12 h, then 24 h,
// and a lane parked on a user action (sign in, permission, challenge) waits a
// full day unless the plan's trigger material changes first.
const AUTO_REVERIFICATION_PASS_BACKOFF_MS = 30 * 60_000;
const AUTO_REVERIFICATION_FAILURE_BACKOFF_MS = Object.freeze([
  60 * 60_000, 4 * 60 * 60_000, 12 * 60 * 60_000, 24 * 60 * 60_000
]);
const AUTO_REVERIFICATION_DAILY_CAP = 6;
const MAX_REVERIFICATION_CANDIDATES_PER_LANE = 8;
// Overridable so a test can prove the unreachable-product path quickly.
let REVERIFICATION_TAB_WAIT_MS = 25_000;
// One list decides which observer failure stages are worth a hydration
// retry. It is shared by the Target loop, the retailer loop, and the injected
// waiter so the three can never drift apart.
const HYDRATION_RETRYABLE_STAGES = Object.freeze([
  "availability_binding", "add_control", "sku_binding", "offer_binding",
  "price_binding", "seller_binding", "fulfillment_binding", "route_binding"
]);
const EVIDENCE_CAPSULE_BINDING_STAGES = Object.freeze([
  "availability_binding", "add_control", "sku_binding", "offer_binding",
  "price_binding", "seller_binding", "fulfillment_binding", "quantity_binding", "route_binding"
]);
const REVERIFICATION_PARKED_REASONS = new Set([
  "manual_action_required", "retailer_access_missing", "action_job_active",
  "retailer_session_signed_out", "retailer_session_challenged"
]);
const REVERIFICATION_SKIPPED_REASONS = new Set([
  "companion_update_required", "app_update_required", "adapter_version_mismatch"
]);
const POST_CLICK_SETTLE_STATE_KEY = "__yoinkPostClickSettleV1";
const BESTBUY_POST_ADD_KEY = "yoinkBestBuyPostAddV1";
const BESTBUY_BROWSER_SESSION_KEY = "yoinkBestBuyBrowserSessionV1";
const BESTBUY_WAIT_NOTIFICATION_PREFIX = "yoink-bestbuy-wait:";
const BESTBUY_POST_ADD_POLL_MS = 2_000;
const BESTBUY_QUEUE_POLL_MS = 5_000;
const BESTBUY_CART_RECHECK_MS = 10_000;
let bestBuyPostAddTimer = null;
const READINESS_KEY = "readiness";
const POPUP_RESULT_STORAGE_KEY = PopupState.POPUP_RESULT_STORAGE_KEY;
const POPUP_UPDATE_HANDOFF_STORAGE_KEY = PopupState.POPUP_UPDATE_HANDOFF_STORAGE_KEY;
const CART_READY_STORAGE_KEY = PopupState.CART_READY_STORAGE_KEY;
const ACTION_HANDOFF_AVAILABILITY_VERSION_KEY = "yoinkActionHandoffAvailabilityVersionV1";
const DEVICE_KEY = "pairedDevice";
// Last outcome of each companion loop, so a loop that silently fails (HTTP 403,
// timeouts, a rejected lease) is visible in the popup and in the heartbeat.
const LOOP_HEALTH_KEY = "yoinkLoopHealthV1";
const LOOP_HEALTH_LOOPS = ["jobs", "notifications", "watch", "health"];
const LOOP_HEALTH_REFRESH_MS = 5 * 60_000;
// Heartbeat 401s for the stored token. The pairing is dropped only after two
// such refusals at least AUTH_FAILURE_CONFIRM_MS apart.
const AUTH_FAILURES_KEY = "yoinkAuthFailuresV1";
const AUTH_FAILURE_CONFIRM_MS = 60_000;
const UNPAIRED_NOTIFICATION_ID = "yoink-unpaired";
const PUSH_EVENT_WAIT_BOUND_MS = 4 * 60_000;
const ACTIVE_JOB_KEY = "activeRetailerJobV1";
const LEGACY_ACTIVE_TARGET_JOB_KEY = "activeTargetJob";
const RETAILER_ACTION_TABS_KEY = "yoinkRetailerActionTabsV1";
// Retry when sold out: the tab each waiting job reloads on its next try.
const RESTOCK_TABS_KEY = "yoinkRestockTabsV1";
const WARM_READINESS_CURSOR_KEY = "yoinkWarmReadinessCursorV1";
const WARM_READINESS_CHECKED_KEY = "yoinkWarmReadinessCheckedV1";
const WATCH_QUEUE_STATE_KEY = "yoinkWatchQueueStateV1";
const WATCH_QUEUE_LEASE_KEY = "yoinkWatchQueueLeaseV1";
const REVERIFICATION_STATE_KEY = "yoinkRetailerReverificationStateV1";
const REVERIFICATION_TAB_KEY = "yoinkReverificationTabV1";
const AUTO_REVERIFICATION_SETTINGS_KEY = "yoinkAutoReverificationSettingsV1";
const ORDER_HANDOFF_KEY = "yoinkOrderHandoffsV1";
const CART_READY_SOUND_KEY = "yoinkCartReadySoundEnabledV1";
const TRACKALACKER_PUSH_STATE_KEY = "yoinkTrackalackerPushStateV1";
const TRACKALACKER_PUSH_QUEUE_KEY = "yoinkTrackalackerPushQueueV1";
const TRACKALACKER_SYNC_STATE_KEY = "yoinkTrackalackerSyncStateV1";
// Automatic TrackaLacker sync (Kevin, 2026-10-09): when each kind last ran and
// when to try again after TrackaLacker pushed back.
const TRACKALACKER_SYNC_SCHEDULE_KEY = "yoinkTrackalackerSyncScheduleV1";
const TRACKALACKER_SYNC_ALARM = "yoink-trackalacker-sync";
// Barcodes (Kevin, 2026-10-09): each new All New item's store page is read once
// in a background tab, a few pages a run, so the same item is one product.
const BARCODE_CHECK_ALARM = "yoink-barcode-check";
const BARCODE_CHECK_STATE_KEY = "yoinkBarcodeCheckStateV1";
const BARCODE_PAGE_SETTLE_MS = 2_500;
const BARCODE_PAGE_PAUSE_MS = 6_000;
// A store that answers with a bot check is left alone for six hours; Yoink never gets past one.
const BARCODE_CHALLENGE_BACKOFF_MS = 6 * 60 * 60_000;
const BARCODE_RUN_STALE_MS = 15 * 60_000;
const TRACKALACKER_QUICK_SYNC_EVERY_MS = 60 * 60_000;
const TRACKALACKER_FULL_SYNC_EVERY_MS = 20 * 60 * 60_000;
// A run that has sent no progress for this long (it reports every 2 s) was cut off.
const TRACKALACKER_SYNC_STALE_MS = 3 * 60_000;
const NOTIFICATION_HISTORY_KEY = "yoinkNotificationHistoryV1";
const NOTIFICATION_ROUTES_KEY = "yoinkNotificationRoutesV1";
const WATCH_READY_ROUTES_KEY = "yoinkWatchReadyRoutesV1";
const CART_READY_NOTIFICATION_PREFIX = "yoink-cart-ready:";
const NEEDS_YOU_NOTIFICATION_PREFIX = "yoink-needs-you:";
const WATCH_READY_NOTIFICATION_PREFIX = "yoink-watch-ready:";
const ACTION_STOPPED_NOTIFICATION_PREFIX = "yoink-action-stopped:";
const COMMUNITY_CONTRIBUTION_TIMES_KEY = "yoinkCommunityContributionTimesV1";
const LEGACY_OBSERVER_RECIPE_KEY_PIN = "yoinkObserverRecipeKeyPinV1";
const OBSERVER_RECIPE_TRUST_STATE_KEY = "yoinkObserverRecipeTrustStateV1";
const OBSERVER_RECIPE_STATUS_KEY = "yoinkObserverRecipeStatusV1";
const ADAPTER_DIAGNOSTIC_QUEUE_KEY = "yoinkAdapterDiagnosticQueueV1";
const EVIDENCE_CAPSULE_QUEUE_KEY = "yoinkEvidenceCapsuleQueueV1";
const QUALIFICATION_LAUNCH_HASH = "yoink-inspect-and-qualify";
const COMMUNITY_CONTRIBUTION_INTERVAL_MS = 60_000;
const CONTEXT_MENU_IDS = Object.freeze({
  open: "yoink-open",
  inspectProduct: "yoink-inspect-product",
  saveRepair: "yoink-save-repair-page",
  inspectDrawings: "yoink-inspect-drawings",
  reconnect: "yoink-reconnect-trackalacker",
  sync: "yoink-sync-products",
  settings: "yoink-settings"
});
const TRACKALACKER_PUSH_QUEUE_LIMIT = 50;
const TRACKALACKER_SUBSCRIPTION_READ_TIMEOUT_MS = 5_000;
const TRACKALACKER_SUBSCRIPTION_RETRY_MS = 60_000;
const TRACKALACKER_AUTO_RECONNECT_KEY = "yoinkTrackalackerAutoReconnectV1";
const TRACKALACKER_AUTO_RECONNECT_SPACING_MS = 30 * 60_000;
const ADAPTER_DIAGNOSTIC_QUEUE_LIMIT = 50;
const ADAPTER_DIAGNOSTIC_QUEUE_MAX_AGE_MS = 9 * 60_000;
const EVIDENCE_CAPSULE_QUEUE_LIMIT = 2;
const EVIDENCE_CAPSULE_QUEUE_MAX_ATTEMPTS = 3;
const qualificationLaunchTabs = new Map();
let qualificationLaunchQueue = Promise.resolve();
const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;
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
  pokemoncenter: ["https://*.pokemoncenter.com/*"],
  asus: ["https://eshop.asus.com/*"],
  audioadvice: ["https://www.audioadvice.com/*"],
  bananarepublic: ["https://bananarepublic.gap.com/*", "https://secure-bananarepublic.gap.com/*"],
  bananarepublicfactory: ["https://bananarepublicfactory.gapfactory.com/*", "https://secure-bananarepublicfactory.gapfactory.com/*"],
  athleta: ["https://athleta.gap.com/*", "https://secure-athleta.gap.com/*"],
  americaneagle: ["https://*.ae.com/*"],
  aninebing: ["https://*.aninebing.com/*"]
};
const ADAPTER_VERSIONS = globalThis.YoinkAdapterVersions;
if (!ADAPTER_VERSIONS?.observer?.target || !ADAPTER_VERSIONS?.add?.target
  || !ADAPTER_VERSIONS?.walmartDrawObserver) {
  throw new Error("Yoink Companion has no generated adapter version map.");
}
const TARGET_OBSERVER_VERSION = ADAPTER_VERSIONS.observer.target;
const RETAILER_OBSERVER_VERSIONS = Object.freeze(Object.fromEntries(
  Object.entries(ADAPTER_VERSIONS.observer).filter(([retailerId]) => retailerId !== "target")
));
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
  pokemoncenter: /^\d{2,3}-\d{5}(?:-\d{3})?$/,
  asus: /^[A-Z0-9]{8}-[A-Z0-9]{6}$/,
  audioadvice: /^\d{10,20}$/,
  bananarepublic: /^\d{9}0000$/,
  bananarepublicfactory: /^\d{10}0000$/,
  athleta: /^\d{9}0000$/,
  americaneagle: /^\d{10}$/,
  aninebing: /^\d{10,20}$/
});
const SUPPORTED_RETAILER_DOMAINS = Object.freeze([
  "target.com", "walmart.com", "amazon.com", "bestbuy.com", "disneystore.com",
  "ravensburger.us", "merch.riotgames.com", "booksamillion.com", "fanatics.com",
  "kohls.com", "macys.com", "p-bandai.com", "pokemoncenter.com", "aninebing.com", "ae.com", "athleta.gap.com", "www.audioadvice.com", "bananarepublic.gap.com", "bananarepublicfactory.gapfactory.com", "eshop.asus.com"
]);
const WALMART_DRAW_OBSERVER_VERSION = ADAPTER_VERSIONS.walmartDrawObserver;
const PACKAGED_ADD_LANES = globalThis.YoinkAddLaneRegistryModule?.ADD_LANES;
if (!PACKAGED_ADD_LANES) throw new Error("Yoink Companion has no packaged add-lane registry.");
const ADD_LANES = Object.freeze(Object.fromEntries(Object.entries(PACKAGED_ADD_LANES).map(([retailerId, lane]) => {
  if (lane.id !== retailerId
    || lane.contractVersion !== ADAPTER_VERSIONS.add[retailerId]
    || lane.observerVersion !== ADAPTER_VERSIONS.observer[retailerId]
    || lane.packVersion !== ADAPTER_VERSIONS.pack[retailerId]) {
    throw new Error(`Yoink Companion has skewed ${retailerId} add-lane metadata.`);
  }
  return [retailerId, Object.freeze({
    ...lane,
    adapterVersion: lane.contractVersion,
    baselineOperation: lane.operations.baseline,
    prepareOperation: lane.operations.prepare,
    commitOperation: lane.operations.commit,
    verifyCartOperation: lane.operations.verifyCart
  })];
})));
const LEGACY_ADD_CAPABILITY_VERSION_KEYS = Object.freeze([
  "targetAddAdapterVersion",
  "walmartAddAdapterVersion",
  "amazonAddAdapterVersion",
  "bestBuyAddAdapterVersion"
]);
if (!LEGACY_ADD_CAPABILITY_VERSION_KEYS.every((key) =>
  Object.values(ADD_LANES).some((lane) => lane.capability.version === key))) {
  throw new Error("Yoink Companion is missing an existing add-lane capability alias.");
}
const REQUIRED_BESTBUY_REHEARSAL_GUIDANCE = Object.freeze([
  "Sign in to Best Buy in this tab, confirm your location, then retry qualification.",
  "Complete the visible Best Buy security check in this tab, then retry qualification."
]);
if (!REQUIRED_BESTBUY_REHEARSAL_GUIDANCE.every((message) =>
  Object.values(ADD_LANES.bestbuy.rehearsalGuidance).includes(message))) {
  throw new Error("Yoink Companion is missing required Best Buy stop guidance.");
}
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
let trackalackerReconciliationPromise = null;
let trackalackerSubscriptionRetryAt = 0;
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
let evidenceCapsuleDrainPromise = null;
let evidenceCapsuleQueueLock = Promise.resolve();
let deviceCredentialRotationPromise = null;
let healthCheckPromise = null;
// Cart tabs the warm-readiness cycle is reading right now. A job leased in the
// meantime never reuses one of these, so two runners never share a tab.
const warmingTabIds = new Set();
let healthCheckQueuedPromise = null;
let loopHealthQueue = Promise.resolve();

function loopOutcomeFailed(reason) {
  return ["cycle_failed", "watch_cycle_failed", "health_failed", "lease_contract_rejected"].includes(reason);
}

function normalizedLoopHealth(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const loops = {};
  for (const loop of LOOP_HEALTH_LOOPS) {
    const entry = source[loop];
    if (!entry || typeof entry !== "object") continue;
    const at = String(entry.at || "").slice(0, 40);
    if (!Number.isFinite(new Date(at).getTime())) continue;
    loops[loop] = {
      at,
      reason: /^[a-z][a-z0-9_]{1,79}$/.test(String(entry.reason || "")) ? String(entry.reason) : "unknown",
      ok: entry.ok === true,
      status: Math.max(0, Math.min(599, Math.trunc(Number(entry.status) || 0))),
      code: /^[a-z][a-z0-9_]{1,79}$/.test(String(entry.code || "")) ? String(entry.code) : "",
      consecutiveFailures: Math.max(0, Math.min(10_000, Math.trunc(Number(entry.consecutiveFailures) || 0))),
      lastOkAt: Number.isFinite(new Date(String(entry.lastOkAt || "")).getTime()) ? String(entry.lastOkAt).slice(0, 40) : ""
    };
  }
  return loops;
}

async function readLoopHealth() {
  return normalizedLoopHealth((await chrome.storage.local.get(LOOP_HEALTH_KEY))[LOOP_HEALTH_KEY]);
}

function loopOutcomeFromError(reason, error) {
  return {
    reason,
    status: Number.isInteger(error?.status) ? error.status : 0,
    code: String(error?.code || "")
  };
}

// Persists one loop's last outcome. Writes are serialized so concurrent loops
// cannot drop each other's entries; a storage failure never breaks a loop.
function recordLoopOutcome(loop, outcome = {}) {
  if (!LOOP_HEALTH_LOOPS.includes(loop)) return Promise.resolve();
  const write = async () => {
    const current = await readLoopHealth();
    const previous = current[loop] || null;
    const reason = /^[a-z][a-z0-9_]{1,79}$/.test(String(outcome.reason || "")) ? String(outcome.reason) : "unknown";
    const ok = !loopOutcomeFailed(reason);
    // A steady healthy loop (the same OK reason every 30 s) is rewritten only
    // every few minutes to keep storage churn low; failures always persist.
    if (ok && previous?.ok && previous.reason === reason
      && Date.now() - new Date(previous.at).getTime() < LOOP_HEALTH_REFRESH_MS) return;
    const at = new Date().toISOString();
    current[loop] = {
      at,
      reason,
      ok,
      status: Math.max(0, Math.min(599, Math.trunc(Number(outcome.status) || 0))),
      code: /^[a-z][a-z0-9_]{1,79}$/.test(String(outcome.code || "")) ? String(outcome.code) : "",
      consecutiveFailures: ok ? 0 : (previous?.consecutiveFailures || 0) + 1,
      lastOkAt: ok ? at : previous?.lastOkAt || ""
    };
    await chrome.storage.local.set({ [LOOP_HEALTH_KEY]: current });
  };
  loopHealthQueue = loopHealthQueue.then(write, write).catch(() => undefined);
  return loopHealthQueue;
}

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
    companionCompatible: details.companionCompatible !== false,
    companionCompatibilityReason: typeof details.companionCompatibilityReason === "string"
      ? details.companionCompatibilityReason.slice(0, 80) : "",
    executionMode: details.executionMode === "live" ? "live" : "shadow",
    actionsPaused: details.actionsPaused !== false,
    chromeMutationEnabled: details.chromeMutationEnabled === true,
    targetAddExecutionEnabled: details.targetAddExecutionEnabled === true,
    walmartAddExecutionEnabled: details.walmartAddExecutionEnabled === true,
    amazonAddExecutionEnabled: details.amazonAddExecutionEnabled === true,
    bestBuyAddExecutionEnabled: details.bestBuyAddExecutionEnabled === true,
    pokemonCenterAddExecutionEnabled: details.pokemonCenterAddExecutionEnabled === true,
    asusAddExecutionEnabled: details.asusAddExecutionEnabled === true,
    audioadviceAddExecutionEnabled: details.audioadviceAddExecutionEnabled === true,
    bananarepublicAddExecutionEnabled: details.bananarepublicAddExecutionEnabled === true,
    bananarepublicfactoryAddExecutionEnabled: details.bananarepublicfactoryAddExecutionEnabled === true,
    athletaAddExecutionEnabled: details.athletaAddExecutionEnabled === true,
    americanEagleAddExecutionEnabled: details.americanEagleAddExecutionEnabled === true,
    anineBingAddExecutionEnabled: details.anineBingAddExecutionEnabled === true,
    localEvidenceCapsules: details.localEvidenceCapsules === true,
    evidenceCapsuleTransport: details.evidenceCapsuleTransport === "loopback" ? "loopback" : "none",
    targetAddCapable: true,
    walmartAddCapable: true,
    amazonAddCapable: true,
    bestBuyAddCapable: true,
    pokemonCenterAddCapable: true,
    asusAddCapable: true,
    audioadviceAddCapable: true,
    bananarepublicAddCapable: true,
    bananarepublicfactoryAddCapable: true,
    athletaAddCapable: true,
    americanEagleAddCapable: true,
    anineBingAddCapable: true,
    targetShadowAccess: details.targetShadowAccess === true,
    communitySharingRetailers,
    trackalackerPush: details.trackalackerPush || normalizeTrackalackerState(),
    trackalackerSync: details.trackalackerSync || normalizeTrackalackerSyncState(),
    // The server's resume preflight, passed through untouched apart from shape
    // checks, so the popup renders the same blockers and summary as the dashboard.
    actionsResume: normalizedActionsResume(details.resume),
    failure: connected ? null : normalizedHealthFailure(details.failure),
    loopHealth: normalizedLoopHealth(details.loopHealth),
    accessibleRetailers: Array.isArray(details.accessibleRetailers)
      ? details.accessibleRetailers.filter((value) => Object.hasOwn(ADD_LANES, value)) : [],
    lastReadyAt: connected ? new Date().toISOString() : (typeof details.lastReadyAt === "string" ? details.lastReadyAt : ""),
    message: connected ? "Yoink control plane ready" : "Yoink control plane unavailable"
  };
}

function normalizedActionsResume(value) {
  if (!value || typeof value !== "object") return null;
  const action = (candidate) => candidate && typeof candidate === "object" && typeof candidate.kind === "string"
    ? {
      kind: candidate.kind.slice(0, 40),
      label: String(candidate.label || "").slice(0, 80),
      retailerId: String(candidate.retailerId || "").slice(0, 40),
      route: String(candidate.route || "").slice(0, 80)
    }
    : null;
  return {
    allowed: value.allowed === true,
    blockers: (Array.isArray(value.blockers) ? value.blockers : []).slice(0, 5).map((blocker) => ({
      code: String(blocker?.code || "").slice(0, 40),
      message: String(blocker?.message || "").slice(0, 240),
      nextAction: action(blocker?.nextAction)
    })),
    nextAction: action(value.nextAction),
    pending: value.pending && typeof value.pending === "object"
      ? { requestId: String(value.pending.requestId || "").slice(0, 120), createdAt: String(value.pending.createdAt || ""), expiresAt: String(value.pending.expiresAt || "") }
      : null,
    summary: (Array.isArray(value.summary) ? value.summary : []).slice(0, 6).map((line) => String(line).slice(0, 160)),
    confirmation: value.confirmation && typeof value.confirmation === "object"
      ? { title: String(value.confirmation.title || "").slice(0, 80), summary: String(value.confirmation.summary || "").slice(0, 240), confirmLabel: String(value.confirmation.confirmLabel || "").slice(0, 40) }
      : null,
    presentation: String(value.presentation || "").slice(0, 40),
    confirmationToken: /^[A-Za-z0-9_.:-]{8,200}$/.test(String(value.confirmationToken || ""))
      ? String(value.confirmationToken) : ""
  };
}

function normalizedHealthFailure(value) {
  if (!value || typeof value !== "object") return null;
  return {
    kind: ["not_ready", "unreachable", "refused", "timeout"].includes(value.kind) ? value.kind : "unreachable",
    status: Number.isInteger(value.status) ? value.status : 0,
    reasons: (Array.isArray(value.reasons) ? value.reasons : []).slice(0, 6).map((reason) => String(reason).slice(0, 60)),
    request: String(value.request || "").slice(0, 40)
  };
}

// Classifies why a health check failed so the popup can say "starting",
// "not running" or "refused (HTTP n)" instead of one generic sentence.
function healthFailure(error, requestName) {
  if (error?.code === "not_ready") return { kind: "not_ready", status: 503, reasons: error.reasons || [], request: requestName };
  if (Number.isInteger(error?.status) && error.status >= 400) return { kind: "refused", status: error.status, reasons: [], request: requestName };
  if (/safety timeout/i.test(String(error?.message || ""))) return { kind: "timeout", status: 0, reasons: [], request: requestName };
  return { kind: "unreachable", status: 0, reasons: [], request: requestName };
}

function targetCapabilities() {
  const addLaneCapabilities = Object.fromEntries(Object.values(ADD_LANES).flatMap((lane) => [
    [lane.capability.enabled, true],
    [lane.capability.version, lane.contractVersion]
  ]));
  return {
    readiness: true,
    jobReconciliation: true,
    officialMsrpCartV1: true,
    // Sets a quantity above one at Amazon, Target, Walmart and Best Buy, never past the store's limit.
    cartQuantityV1: true,
    approvedAmazonTest20261002: true,
    notifications: true,
    retailerMutation: false,
    ...addLaneCapabilities,
    retailerShadow: true,
    communityReadOnlyEvidence: true,
    exactSelectedOfferEvidence: true,
    observerRecipeShadow: true,
    observerRecipePackagedOracle: true,
    observerRecipeRecoveryEvidence: true,
    sanitizedAdapterDiagnostics: true,
    durableAdapterDiagnostics: true,
    privacyBoundedRepairLandmarks: true,
    localEvidenceCapsules: RUNTIME_CONFIG.profile === "local",
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
              : retailerId === "pokemoncenter" ? `https://www.pokemoncenter.com/product/${retailerSku}`
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
  "product_identity_missing", "product_page_unavailable", "security_challenge",
  "interactive_auth", "interactive_mfa", "interactive_location", "interactive_membership",
  "interactive_queue", "interactive_high_demand", "interactive_unknown",
  "availability_selector_miss",
  "add_control_selector_miss", "add_control_missing", "add_control_ambiguous", "add_control_disabled",
  "explicit_sku_binding_missing", "explicit_sku_binding_ambiguous",
  "offer_binding_missing", "offer_binding_ambiguous", "price_selector_miss", "price_binding_missing",
  "seller_selector_miss", "seller_binding_missing", "fulfillment_selector_miss", "fulfillment_binding_missing",
  "selected_offer_binding_unresolved",
  "listing_unavailable_layout", "listing_variant_unselected",
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
  "price_unavailable", "over_unit_cap", "over_total_cap", "fulfillment_unverified", "authorization_missing",
  "authorization_expired", "add_control_changed", "fulfillment_selection_failed", "offer_binding_changed", "click_failed",
  "offer_unverified", "click_uncertain", "cart_page_unverified", "cart_unverified",
  "foreign_cart_line", "verified_empty", "cart_evidence_stale", "offer_proof_mismatch",
  "quantity_unavailable", "clicked",
  "stock_unverified", "listed_price_changed", "desired_variant_unverified", "desired_variant_changed",
  "official_msrp_authorization_missing", "official_msrp_authorization_invalid", "official_msrp_cart_policy_invalid",
  "quantity_control_unavailable", "quantity_line_ambiguous", "quantity_unchanged", "quantity_limit_reached",
  "quantity_unverified", "quantity_changed",
  "cart_delta_unverified"
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
  const packVersion = String(overrides.packVersion || value.packVersion || ADAPTER_VERSIONS.pack[retailerId] || "");
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
    packVersion,
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
  return requestErrorRetryable(error);
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

function evidenceCapsuleRetryable(error) {
  return requestErrorRetryable(error);
}

function withEvidenceCapsuleQueueLock(work) {
  const next = evidenceCapsuleQueueLock.then(work, work);
  evidenceCapsuleQueueLock = next.then(() => undefined, () => undefined);
  return next;
}

function queuedEvidenceCapsule(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !/^[A-Za-z0-9_-]{3,160}$/.test(String(value.deviceId || ""))
    || !value.capsule || typeof value.capsule !== "object" || Array.isArray(value.capsule)
    || !/^cap_[A-Za-z0-9_-]{8,120}$/.test(String(value.capsule.id || ""))) return null;
  const attempts = Number(value.attempts || 0);
  if (!Number.isInteger(attempts) || attempts < 0 || attempts >= EVIDENCE_CAPSULE_QUEUE_MAX_ATTEMPTS) return null;
  return { deviceId: String(value.deviceId), capsule: value.capsule, attempts };
}

async function readEvidenceCapsuleQueueUnlocked() {
  const stored = (await chrome.storage.local.get(EVIDENCE_CAPSULE_QUEUE_KEY))[EVIDENCE_CAPSULE_QUEUE_KEY];
  if (!Array.isArray(stored)) return [];
  const ids = new Set();
  const result = [];
  for (let index = stored.length - 1; index >= 0; index -= 1) {
    const entry = queuedEvidenceCapsule(stored[index]);
    if (!entry || ids.has(entry.capsule.id)) continue;
    ids.add(entry.capsule.id);
    result.unshift(entry);
  }
  return result.slice(-EVIDENCE_CAPSULE_QUEUE_LIMIT);
}

async function enqueueEvidenceCapsule(device, capsule, attempts = 1) {
  if (RUNTIME_CONFIG.profile !== "local" || attempts >= EVIDENCE_CAPSULE_QUEUE_MAX_ATTEMPTS
    || !/^[A-Za-z0-9_-]{3,160}$/.test(String(device?.id || ""))) return null;
  return withEvidenceCapsuleQueueLock(async () => {
    const current = await readEvidenceCapsuleQueueUnlocked();
    const next = [
      ...current.filter((entry) => entry.capsule.id !== capsule.id),
      { deviceId: String(device.id), capsule, attempts }
    ].slice(-EVIDENCE_CAPSULE_QUEUE_LIMIT);
    try {
      await chrome.storage.local.set({ [EVIDENCE_CAPSULE_QUEUE_KEY]: next });
      return next.at(-1) || null;
    } catch {
      // A large snapshot may exhaust extension storage. Capture remains fail-closed and never escapes locally.
      return null;
    }
  });
}

async function sendEvidenceCapsule(device, capsule) {
  if (RUNTIME_CONFIG.profile !== "local") return null;
  return request(`/devices/self/evidence-capsules/${encodeURIComponent(capsule.retailerId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify(capsule)
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
}

async function postEvidenceCapsule(device, capsule) {
  if (RUNTIME_CONFIG.profile !== "local") return null;
  try {
    return await sendEvidenceCapsule(device, capsule);
  } catch (error) {
    if (Number(error?.status || 0) === 409) return { duplicate: true };
    if (evidenceCapsuleRetryable(error)) await enqueueEvidenceCapsule(device, capsule, 1);
    throw error;
  }
}

async function drainEvidenceCapsuleQueue() {
  if (RUNTIME_CONFIG.profile !== "local") return { delivered: 0, pending: 0 };
  if (evidenceCapsuleDrainPromise) return evidenceCapsuleDrainPromise;
  evidenceCapsuleDrainPromise = withEvidenceCapsuleQueueLock(async () => {
    const current = await readEvidenceCapsuleQueueUnlocked();
    const device = await storedDevice();
    if (!device?.id || !device?.token) return { delivered: 0, pending: current.length };
    const remaining = [];
    let delivered = 0;
    for (const entry of current) {
      if (entry.deviceId !== device.id) continue;
      try {
        await sendEvidenceCapsule(device, entry.capsule);
        delivered += 1;
      } catch (error) {
        if (Number(error?.status || 0) === 409) {
          delivered += 1;
          continue;
        }
        const attempts = entry.attempts + 1;
        if (evidenceCapsuleRetryable(error) && attempts < EVIDENCE_CAPSULE_QUEUE_MAX_ATTEMPTS) {
          remaining.push({ ...entry, attempts });
        }
      }
    }
    await chrome.storage.local.set({ [EVIDENCE_CAPSULE_QUEUE_KEY]: remaining.slice(-EVIDENCE_CAPSULE_QUEUE_LIMIT) });
    return { delivered, pending: remaining.length };
  }).finally(() => { evidenceCapsuleDrainPromise = null; });
  return evidenceCapsuleDrainPromise;
}

// A live add the page turned down for a reason that can also be a binding miss
// ("sold out" or "another seller" while the buy box hadn't loaded, a price or
// Add button not found) keeps a page snapshot, so the store's adapter can be
// repaired from diagnostics. One per store item every 6 hours.
const REJECTION_CAPSULE_REASONS = Object.freeze([
  "out_of_stock", "stock_unverified", "third_party_seller", "seller_unverified", "signal_seller_mismatch",
  "desired_variant_unverified", "desired_variant_changed", "listed_price_changed", "fulfillment_unverified"
]);
const REJECTION_CAPSULE_INTERVAL_MS = 6 * 60 * 60_000;
const REJECTION_CAPSULES_KEY = "yoinkRejectionCapsulesV1";

function rejectionCapsuleDiagnostic(diagnostic) {
  return diagnostic?.operation === "live_add" && diagnostic?.outcome === "rejected"
    && REJECTION_CAPSULE_REASONS.includes(String(diagnostic?.reasonCode || ""));
}

async function claimRejectionCapsule(diagnostic, now = Date.now()) {
  const key = `${diagnostic.retailerId}:${diagnostic.retailerSku}`;
  const stored = (await chrome.storage.local.get(REJECTION_CAPSULES_KEY))[REJECTION_CAPSULES_KEY];
  const recent = Object.fromEntries(Object.entries(stored && typeof stored === "object" ? stored : {})
    .filter(([, at]) => Number.isFinite(Number(at)) && now - Number(at) < REJECTION_CAPSULE_INTERVAL_MS)
    .slice(-50));
  if (recent[key]) return false;
  recent[key] = now;
  await chrome.storage.local.set({ [REJECTION_CAPSULES_KEY]: recent });
  return true;
}

// A cart Yoink couldn't read, or a cart line it couldn't raise, keeps a
// sanitized snapshot of the cart page (one per store every 6 hours), so the
// store's cart reader can be repaired from diagnostics: no real Target,
// Walmart or Best Buy cart page had been seen when quantities shipped.
const CART_CAPSULE_REASONS = Object.freeze([
  "cart_unverified", "cart_page_unverified", "cart_delta_unverified", "quantity_unavailable", "foreign_cart_line",
  "quantity_control_unavailable", "quantity_line_ambiguous", "quantity_unchanged"
]);

function cartCapsuleDiagnostic(diagnostic) {
  return diagnostic?.operation === "live_add" && diagnostic?.outcome === "failed" && diagnostic?.failureStage === "runner"
    && diagnostic?.layout?.pageKind === "other" && CART_CAPSULE_REASONS.includes(String(diagnostic?.reasonCode || ""));
}

async function captureCartEvidence(tabId, active, reasonCode) {
  const retailerId = active?.retailerId || active?.runnerJob?.retailerId;
  const retailerSku = String(active?.runnerJob?.retailerSku || "");
  if (!Number.isInteger(tabId) || !ADD_LANES[retailerId] || !retailerSku || !CART_CAPSULE_REASONS.includes(reasonCode)) return null;
  try {
    const zeroCounts = Object.fromEntries(DIAGNOSTIC_COUNT_FIELDS.map((field) => [field, 0]));
    const diagnostic = retailerDiagnosticPayload({
      contractVersion: 1, observedAt: new Date().toISOString(), retailerId, retailerSku,
      operation: "live_add", outcome: "failed", failureStage: "runner", reasonCode, attemptCount: 1, domChanged: false,
      layout: { schemaVersion: 1, pageKind: "other", scopeKind: "none", sellerShape: "none", fulfillmentShape: "none",
        ...zeroCounts, securityChallenge: false, interactiveBlock: "" }
    }, retailerId);
    if (!await claimRejectionCapsule({ retailerId, retailerSku: "cart" })) return null;
    return await captureTabEvidenceCapsule(tabId, diagnostic, { requiredFulfillment: active.runnerJob?.fulfillment });
  } catch {
    return null;
  }
}

function evidenceCapsuleTrigger(diagnostic, manual = false) {
  if (manual) return "manual";
  if (diagnostic?.operation === "observe" && diagnostic?.outcome === "failed") return "diagnostic_failed";
  if (rejectionCapsuleDiagnostic(diagnostic) || cartCapsuleDiagnostic(diagnostic)) return "live_add_non_pass";
  if (!["rehearse_add", "live_add"].includes(diagnostic?.operation)
    || !["failed", "rejected"].includes(diagnostic?.outcome)
    || !EVIDENCE_CAPSULE_BINDING_STAGES.includes(diagnostic?.failureStage)) return "";
  return diagnostic.operation === "rehearse_add" ? "rehearsal_non_pass" : "live_add_non_pass";
}

async function captureTabEvidenceCapsule(
  tabId,
  diagnostic,
  { manual = false, requiredFulfillment = "shipping", trace = [] } = {}
) {
  if (RUNTIME_CONFIG.profile !== "local") return null;
  const trigger = evidenceCapsuleTrigger(diagnostic, manual);
  if (!trigger) return null;
  if (!manual && rejectionCapsuleDiagnostic(diagnostic) && !await claimRejectionCapsule(diagnostic)) return null;
  const readinessState = (await chrome.storage.local.get(READINESS_KEY))[READINESS_KEY];
  if (readinessState?.localEvidenceCapsules === false) {
    if (manual) throw new Error("Page snapshots for store repairs are turned off in Yoink settings.");
    return null;
  }
  const device = await storedDevice();
  if (!device?.id || !device?.token) {
    if (manual) throw new Error("Pair this Chrome companion before saving a page snapshot.");
    return null;
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: ["evidence-capsule.js"]
  });
  const injections = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: [{
      retailerId: diagnostic.retailerId,
      retailerSku: diagnostic.retailerSku,
      diagnostic,
      trigger,
      observerVersion: observerVersionForRetailer(diagnostic.retailerId),
      addAdapterVersion: ADD_LANES[diagnostic.retailerId]?.adapterVersion || "",
      packVersion: ADAPTER_VERSIONS.pack[diagnostic.retailerId] || "",
      extensionVersion: EXTENSION_VERSION,
      requiredFulfillment: requiredFulfillment === "pickup" ? "pickup" : "shipping",
      trace: Array.isArray(trace) ? trace : [],
      budgetMs: 1_500
    }],
    func: async (input) => {
      try {
        const api = globalThis.YoinkEvidenceCapsuleModule;
        if (!api || typeof api.captureEvidenceCapsule !== "function") {
          return { ok: false, message: "The page snapshot collector is unavailable." };
        }
        const capsule = await api.captureEvidenceCapsule({ ...input, document, url: location.href });
        return { ok: true, capsule };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "The page snapshot could not be created." };
      }
    }
  });
  const result = injections.find((entry) => entry.frameId === 0)?.result;
  if (!result?.ok || !result.capsule) {
    if (manual) throw new Error(result?.message || "The page snapshot could not be created.");
    return null;
  }
  await postEvidenceCapsule(device, result.capsule);
  return result.capsule;
}

async function postOperationDiagnosticWithCapsule(device, tabId, diagnostic, requiredFulfillment = "shipping", trace = []) {
  if (Number.isInteger(tabId)) {
    await captureTabEvidenceCapsule(tabId, diagnostic, { requiredFulfillment, trace }).catch(() => null);
  }
  return postRetailerDiagnostic(device, diagnostic);
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

// A saved product whose page no longer resolves to the exact product (removed
// listing, redirect, sign-in wall) is recorded as a terminal rejection so the
// server can close its open repair entry instead of replaying it forever.
function productPageUnavailableDiagnostic(identity) {
  if (!identity?.retailerId || !identity.retailerSku) {
    throw new Error("The unreachable product diagnostic needs an exact retailer identity.");
  }
  const zeroCounts = Object.fromEntries(DIAGNOSTIC_COUNT_FIELDS.map((field) => [field, 0]));
  return retailerDiagnosticPayload({
    contractVersion: 1,
    observedAt: new Date().toISOString(),
    retailerId: identity.retailerId,
    retailerSku: identity.retailerSku,
    adapterVersion: observerVersionForRetailer(identity.retailerId),
    operation: "observe",
    outcome: "rejected",
    failureStage: "page_identity",
    reasonCode: "product_page_unavailable",
    attemptCount: 1,
    domChanged: false,
    layout: {
      schemaVersion: 1,
      pageKind: "other",
      scopeKind: "none",
      sellerShape: "none",
      fulfillmentShape: "none",
      ...zeroCounts,
      securityChallenge: false,
      interactiveBlock: ""
    }
  }, identity.retailerId);
}

async function reportProductPageUnavailable(device, identity) {
  try {
    return await postRetailerDiagnostic(device, productPageUnavailableDiagnostic(identity));
  } catch {
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
  "over_unit_cap", "over_total_cap", "fulfillment_not_supported", "seller_policy_not_supported",
  "quantity_not_supported", "unsupported_action", "job_expired",
  "listed_price_changed", "desired_variant_unverified", "desired_variant_changed", "stock_unverified",
  "official_msrp_authorization_missing", "official_msrp_authorization_invalid", "official_msrp_cart_policy_invalid"
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
  if (!["target", "walmart", "amazon", "bestbuy", "pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"].includes(retailerId)) return null;
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
    args: [
      "collectOperationDiagnostic",
      retailerId,
      requiredFulfillment === "pickup" ? "pickup" : "shipping",
      RUNTIME_CONFIG.profile === "local"
    ],
    func: (_operationName, exactRetailerId, exactFulfillment, collectTrace) => {
      try {
        const environment = collectTrace ? { trace: { record() {} } } : undefined;
        if (exactRetailerId === "target") {
          const observer = globalThis.YoinkTargetShadow;
          if (!observer || typeof observer.collectTargetShadowAttempt !== "function") {
            return { ok: false, message: "The Target shadow observer is unavailable." };
          }
          const attempt = observer.collectTargetShadowAttempt(document, location.href, exactFulfillment, 1, false, environment);
          return { ok: true, diagnostic: attempt.diagnostic, trace: attempt.trace || [] };
        }
        const observer = globalThis.YoinkRetailerShadow;
        if (!observer || typeof observer.collectRetailerShadowAttempt !== "function") {
          return { ok: false, message: "The retailer shadow observer is unavailable." };
        }
        const attempt = observer.collectRetailerShadowAttempt(
          document, location.href, exactRetailerId, exactFulfillment, 1, false, environment
        );
        return { ok: true, diagnostic: attempt.diagnostic, trace: attempt.trace || [] };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "The retailer diagnostic could not be collected." };
      }
    }
  });
  const result = injections.find((entry) => entry.frameId === 0)?.result;
  if (!result?.ok) throw new Error(result?.message || "The retailer diagnostic could not be collected.");
  const diagnostic = operationDiagnostic(result.diagnostic, retailerId, operation, outcome, failureStage, reasonCode);
  await captureTabEvidenceCapsule(tabId, diagnostic, {
    requiredFulfillment,
    trace: result.trace || []
  }).catch(() => null);
  return postRetailerDiagnostic(device, diagnostic);
}

/**
 * Runs inside a store's product page: the item's own barcode (UPC, EAN or
 * GTIN), or "" when the page names none or more than one. A labelled barcode
 * in the product details or the page's product data comes first; else one
 * barcode named in the page's own scripts (Walmart's and Target's product data).
 * Self-contained: Chrome copies it into the page.
 */
function readPageBarcode() {
  const valid = (digits) => {
    if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
    const numbers = [...digits].map(Number);
    const check = numbers.pop();
    let sum = 0;
    for (let index = numbers.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
      sum += numbers[index] * (position % 2 === 0 ? 3 : 1);
    }
    return (10 - (sum % 10)) % 10 === check;
  };
  const add = (set, value) => {
    // "UPC: 196214106611 2 pack" reads as its first number, else all its digits.
    for (const candidate of [String(value ?? "").trim().split(/\s+/)[0], String(value ?? "").replace(/[\s-]/g, "")]) {
      const digits = String(candidate || "").replace(/-/g, "");
      if (valid(digits) && !/^0+$/.test(digits.slice(0, -1))) { set.add(digits.padStart(14, "0")); return; }
    }
  };
  const challenge = /robot or human|are you a human|access denied|verify you are (a )?human|captcha|pardon our interruption/i.test(document.title || "")
    || Boolean(document.querySelector("#px-captcha, iframe[src*='captcha'], form[action*='captcha'], #challenge-form"))
    || /\/blocked(?:\/|$)/.test(location.pathname);
  if (challenge) return { challenge: true, gtin: "" };
  const strong = new Set();
  let visited = 0;
  const visit = (value, depth = 0) => {
    if (++visited > 2_000 || depth > 10 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const entry of value) visit(entry, depth + 1); return; }
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.includes("Product")) {
      for (const key of ["gtin", "gtin8", "gtin12", "gtin13", "gtin14", "upc"]) add(strong, value[key]);
    }
    if (value["@graph"]) visit(value["@graph"], depth + 1);
    if (value.mainEntity) visit(value.mainEntity, depth + 1);
  };
  for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
    if ((script.textContent || "").length > 512_000) continue;
    try { visit(JSON.parse(script.textContent || "")); } catch { /* Ignore malformed structured data. */ }
  }
  const scope = document.querySelector("main, [role='main']") || document.body;
  let text = typeof scope?.innerText === "string" ? scope.innerText : "";
  if (!text && scope) {
    // Without layout (a page still painting), each piece of text on its own line, as innerText would.
    const pieces = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && pieces.length < 20_000) {
      if (!["SCRIPT", "STYLE", "NOSCRIPT"].includes(walker.currentNode.parentElement?.tagName || "")) pieces.push(walker.currentNode.textContent || "");
    }
    text = pieces.join("\n");
  }
  text = text.slice(0, 400_000);
  for (const match of text.matchAll(/\b(?:UPC|GTIN|EAN)(?:-A|-13|-14)?\b[^\S\n]*(?:code|number|#)?[^\S\n]*[:#]?[^\S\n]*(\d[\d -]{6,18}\d)/gi)) add(strong, match[1]);
  if (strong.size === 1) return { gtin: [...strong][0] };
  if (strong.size > 1) return { gtin: "", ambiguous: true };
  const named = new Set();
  for (const script of document.querySelectorAll("script:not([src])")) {
    const source = script.textContent || "";
    if (source.length > 3_000_000) continue;
    for (const match of source.matchAll(/\\?["'](?:upc|gtin(?:8|12|13|14)?|primary_barcode|ean)\\?["']\s*:\s*\\?["'](\d{8,14})\\?["']/gi)) add(named, match[1]);
  }
  if (named.size === 1) return { gtin: [...named][0] };
  return { gtin: "", ambiguous: named.size > 1 };
}

/**
 * Reads the barcode of the product page open in this tab and sends it. A
 * page Yoink opened for this (listingId) also reports that it had none.
 */
async function captureListingBarcode(tabId, retailerId, retailerSku, listingId = "") {
  const device = await storedDevice();
  if (!device?.token || !Number.isInteger(tabId) || !retailerId || !retailerSku) return null;
  const injections = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: readPageBarcode });
  const result = injections.find((entry) => entry.frameId === 0)?.result || {};
  if (result.challenge) return { challenge: true, gtin: "" };
  if (!result.gtin && !listingId) return result;
  await request("/devices/self/catalog/barcodes", {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({ items: [{ ...(listingId ? { listingId } : {}), retailerId, retailerSku, gtin: result.gtin || "" }] })
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
  return result;
}

/**
 * Opens each All New item's store page the server lists, one at a time in a
 * background tab, reads its barcode and closes it. A cart add always comes
 * first, and a store's bot check stops visits there for six hours.
 */
async function runBarcodeChecks(now = Date.now()) {
  const device = await storedDevice();
  if (!device?.token) return { ran: false, reason: "not_paired" };
  const state = (await chrome.storage.local.get(BARCODE_CHECK_STATE_KEY).catch(() => ({})))[BARCODE_CHECK_STATE_KEY] || {};
  const runningSince = Date.parse(String(state.runningSince || ""));
  if (Number.isFinite(runningSince) && now - runningSince < BARCODE_RUN_STALE_MS) return { ran: false, reason: "running" };
  if (await activeJob().catch(() => null)) return { ran: false, reason: "action_job_active" };
  const plan = await request("/devices/self/catalog/barcode-plan", {
    headers: { Authorization: `Bearer ${device.token}` }
  }, EVIDENCE_REQUEST_TIMEOUT_MS);
  const items = Array.isArray(plan?.items) ? plan.items : [];
  const backoff = { ...(state.backoff || {}) };
  if (!items.length) return { ran: true, read: 0, visited: 0 };
  await chrome.storage.local.set({ [BARCODE_CHECK_STATE_KEY]: { ...state, backoff, runningSince: new Date(now).toISOString() } });
  let read = 0;
  let visited = 0;
  try {
    for (const item of items) {
      if (Number(backoff[item.retailerId] || 0) > Date.now()) continue;
      const origins = item.retailerId === "target" ? TARGET_ORIGINS : RETAILER_ORIGINS[item.retailerId];
      if (!origins || !await chrome.permissions.contains({ origins }).catch(() => false)) continue;
      if (await activeJob().catch(() => null)) break;
      if (visited > 0) await new Promise((resolve) => setTimeout(resolve, BARCODE_PAGE_PAUSE_MS));
      visited += 1;
      let tabId = null;
      try {
        const tab = await chrome.tabs.create({ url: item.canonicalUrl, active: false });
        tabId = Number.isInteger(tab?.id) ? tab.id : null;
        if (tabId === null) continue;
        await waitForExactProductTab(tabId, item.retailerId, item.retailerSku, REVERIFICATION_TAB_WAIT_MS);
        await new Promise((resolve) => setTimeout(resolve, BARCODE_PAGE_SETTLE_MS));
        const result = await captureListingBarcode(tabId, item.retailerId, item.retailerSku, item.listingId);
        if (result?.challenge) backoff[item.retailerId] = Date.now() + BARCODE_CHALLENGE_BACKOFF_MS;
        else if (result?.gtin) read += 1;
      } catch {
        // A page that didn't load is tried again on a later run.
      } finally {
        if (Number.isInteger(tabId)) await chrome.tabs.remove(tabId).catch(() => undefined);
      }
    }
  } finally {
    await chrome.storage.local.set({ [BARCODE_CHECK_STATE_KEY]: {
      backoff, runningSince: "", lastRunAt: new Date().toISOString(), lastRead: read, lastVisited: visited
    } }).catch(() => undefined);
  }
  return { ran: true, read, visited };
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
      // The typed error code lets callers distinguish version skew from a bad
      // payload without parsing the human message.
      error.code = /^[a-z][a-z0-9_]{1,79}$/.test(String(payload.error || "")) ? String(payload.error) : "";
      // A 4xx is the server's final answer (validation, conflict, blocked
      // change); only 5xx, 408 and 429 are worth another attempt.
      error.retryable = response.status >= 500 || [408, 429].includes(response.status);
      error.details = payload.details && typeof payload.details === "object" ? payload.details : null;
      throw error;
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error("Yoink did not acknowledge the Chrome companion request before its safety timeout.");
      timeoutError.status = 0;
      timeoutError.code = "timeout";
      timeoutError.retryable = true;
      throw timeoutError;
    }
    // A fetch that never produced a response (app stopped, port closed) is
    // always worth another attempt; HTTP errors above already carry their own.
    if (error && typeof error === "object" && typeof error.retryable !== "boolean") {
      try {
        error.retryable = true;
        if (!error.code) error.code = "network_error";
      } catch {
        // Frozen error objects keep their original shape.
      }
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// One retry rule for every queue: the request() error says whether the server
// answered finally (4xx) or the attempt can be repeated (timeout, network, 5xx,
// 408, 429). Errors raised outside request() stay retryable.
function requestErrorRetryable(error) {
  return error?.retryable !== false;
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
      .filter((value) => Object.hasOwn(ADD_LANES, value)))].slice(0, Object.keys(ADD_LANES).length)
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
    // Every envelope needs exactly one receipt: indexes must be the set 0..n-1,
    // or a receipt bug would leave envelopes neither removed nor retried.
    const receiptIndexes = new Set(receipts.map((receipt) => Number(receipt?.index)));
    if (receipts.length !== envelopes.length || receiptIndexes.size !== envelopes.length
      || envelopes.some((_, index) => !receiptIndexes.has(index))) {
      throw new Error("Yoink returned an incomplete signal batch receipt.");
    }
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
    return { delivered: false, retryable: requestErrorRetryable(error), status };
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
        // Anything in this batch that did not complete was attempted, so the
        // loop can never resend the same batch within one drain.
        for (const entry of batch) if (!completed.has(entry.signalId)) attemptedIds.add(entry.signalId);
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
      if (updatedId === tabId && (changeInfo.status === "complete" || tab.status === "complete") && tab.discarded !== true
        && trackalackerTabUrl(tab.url)) finish(null, tab);
    };
    timeout = setTimeout(() => finish(new Error("TrackaLacker did not finish loading in time.")), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === "complete" && tab.discarded !== true && trackalackerTabUrl(tab.url)) finish(null, tab);
    }).catch(() => undefined);
  });
}

// Brave and Chrome put background tabs to sleep. A sleeping tab never finishes
// loading until it is shown, so Reconnect used to time out on the shopper's own
// open TrackaLacker tab. Use a loaded tab, wake a sleeping one by reloading it,
// and open a new tab only when neither works.
// A background open (automatic reconnect) does not switch tabs, and a tab it
// opened that never loads is closed again.
async function openTrackalackerTab({ background = false } = {}) {
  const tabs = (await chrome.tabs.query({ url: TRACKALACKER_ORIGINS }).catch(() => []))
    .filter((tab) => Number.isInteger(tab?.id) && trackalackerTabUrl(tab.url));
  const loaded = tabs.find((tab) => tab.status === "complete" && tab.discarded !== true);
  if (loaded) return { id: loaded.id, created: false };
  if (tabs[0]) {
    try {
      await chrome.tabs.reload(tabs[0].id);
      await waitForTrackalackerTab(tabs[0].id);
      return { id: tabs[0].id, created: false };
    } catch {
      // A tab that cannot be woken is left as it is; a new one opens below.
    }
  }
  const created = await chrome.tabs.create({ url: TRACKALACKER_SETTINGS_URL, active: !background });
  if (!Number.isInteger(created?.id)) throw new Error("Chrome could not open TrackaLacker.");
  try {
    await waitForTrackalackerTab(created.id);
  } catch (error) {
    if (background) await chrome.tabs.remove(created.id).catch(() => undefined);
    throw error;
  }
  return { id: created.id, created: true };
}

async function trackalackerTab() {
  return (await openTrackalackerTab()).id;
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

async function performTrackalackerEnrollment(force = false, { automatic = false } = {}) {
  if (!TrackalackerPush) throw new Error("The TrackaLacker bridge is unavailable. Reload the extension and try again.");
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this Chrome companion before connecting TrackaLacker.");
  let tab;
  try {
    tab = await openTrackalackerTab({ background: automatic });
  } catch (error) {
    // Without this the attempt left no trace: the app kept showing the older status.
    await postTrackalackerStatus(await updateTrackalackerState({ enabled: true, state: "error", ready: false, errorCode: "page_bridge_failed", lastHttpStatus: 0 }));
    throw error;
  }
  try {
    return await enrollThroughTrackalackerTab(tab.id, force);
  } finally {
    // An automatic reconnect closes a tab it opened; the shopper's own tabs stay.
    if (automatic && tab.created) await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

async function enrollThroughTrackalackerTab(tabId, force) {
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
  const registration = TrackalackerPush.deviceRegistrationPayload(found.subscription, (await companionBrowser()).name);
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

function connectTrackalacker(force = true, options = {}) {
  if (trackalackerEnrollmentPromise) return trackalackerEnrollmentPromise;
  trackalackerEnrollmentPromise = (async () => {
    // A user-requested reconnect must not race an older status observation.
    await trackalackerReconciliationPromise?.catch(() => undefined);
    trackalackerSubscriptionRetryAt = 0;
    return performTrackalackerEnrollment(force, options);
  })().finally(() => { trackalackerEnrollmentPromise = null; });
  return trackalackerEnrollmentPromise;
}

// Reloading the companion (every local update) deletes its push
// subscription, so calls used to stop after each update until someone pressed
// Reconnect. A connection that was registered before reconnects by itself
// through a TrackaLacker tab: as soon as a new version runs, then at most every
// 30 minutes while it stays down. Reconciliation itself stays read-only, and a
// connection that was never set up, or was turned off, is left alone.
async function reconnectTrackalackerAutomatically(state) {
  if (!state?.enabled || state.ready || !state.lastRegistrationAt
    || !["awaiting_page", "error"].includes(state.state) || trackalackerEnrollmentPromise) return false;
  const previous = (await chrome.storage.local.get(TRACKALACKER_AUTO_RECONNECT_KEY))[TRACKALACKER_AUTO_RECONNECT_KEY];
  if (previous?.version === EXTENSION_VERSION
    && Date.now() - Number(previous.at || 0) < TRACKALACKER_AUTO_RECONNECT_SPACING_MS) return false;
  // Only the popup can ask for TrackaLacker access; without it, wait for Reconnect.
  if (!await chrome.permissions.contains({ origins: TRACKALACKER_ORIGINS }).catch(() => false)) return false;
  await chrome.storage.local.set({ [TRACKALACKER_AUTO_RECONNECT_KEY]: { version: EXTENSION_VERSION, at: Date.now() } });
  await connectTrackalacker(false, { automatic: true });
  return true;
}

// Reconnect renews a registered push that has gone quiet (the popup's "No
// calls for …"): the unchanged-fingerprint shortcut would only report
// "already registered", leaving TrackaLacker's side and the label unchanged.
async function reconnectTrackalackerFromShopper() {
  const state = await readTrackalackerState().catch(() => null);
  return connectTrackalacker(PopupState.trackalackerPushQuietMs?.(state, Date.now()) != null);
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
    updatedAt: String(value.updatedAt || "").slice(0, 40),
    mode: value.mode === "quick" ? "quick" : "full",
    automatic: value.automatic === true,
    resumeOf: /^tlsync_[A-Za-z0-9_-]{8,112}$/.test(String(value.resumeOf || "")) ? String(value.resumeOf) : "",
    stopReason: ["blocked", "signed_out", "challenged"].includes(String(value.stopReason || "")) ? String(value.stopReason) : "",
    // A TrackaLacker tab this sync opened in the background, closed when it ends.
    openedTabId: Number.isInteger(value.openedTabId) ? value.openedTabId : null
  };
}

function trackalackerSyncActive(state, now = Date.now()) {
  const updatedAt = Date.parse(state?.updatedAt || "");
  return ["starting", "discovering", "importing"].includes(state?.phase)
    && Number.isFinite(updatedAt) && now - updatedAt < TRACKALACKER_SYNC_STALE_MS;
}

async function readTrackalackerSyncSchedule() {
  const stored = (await chrome.storage.local.get(TRACKALACKER_SYNC_SCHEDULE_KEY))[TRACKALACKER_SYNC_SCHEDULE_KEY];
  return stored && typeof stored === "object" ? stored : {};
}

async function updateTrackalackerSyncSchedule(changes) {
  const next = { ...(await readTrackalackerSyncSchedule()), ...changes };
  await chrome.storage.local.set({ [TRACKALACKER_SYNC_SCHEDULE_KEY]: next });
  return next;
}

/**
 * Which automatic sync is due: a quick refresh (prices, stock, new follows)
 * every hour, and a full pass (stale History too) once a night between 2 and
 * 6 a.m. local time. Nothing while a run is going or after TrackaLacker
 * pushed back.
 */
function trackalackerSyncDue(state, schedule, now = Date.now(), hour = new Date(now).getHours()) {
  if (trackalackerSyncActive(state, now)) return "";
  if (Number(schedule?.retryAfter || 0) > now) return "";
  const since = (value) => now - (Number(value) || 0);
  if (hour >= 2 && hour < 6 && since(schedule?.lastFullAt) >= TRACKALACKER_FULL_SYNC_EVERY_MS) return "full";
  if (since(schedule?.lastStartedAt) >= TRACKALACKER_QUICK_SYNC_EVERY_MS) return "quick";
  return "";
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
    } else if (host === "eshop.asus.com" && !url.port) {
      retailerId = "asus";
      retailerSku = !url.searchParams.has("config")
        ? (url.pathname.match(/^\/us\/([a-z0-9]{8}-[a-z0-9]{6})-[a-z0-9-]+\.html$/)?.[1] || "").toUpperCase() : "";
    } else if (host === "www.audioadvice.com" && !url.port) {
      retailerId = "audioadvice";
      const variant = url.searchParams.get("variant") || "";
      retailerSku = /^\/products\/[a-z0-9-]+\/?$/.test(url.pathname) && url.searchParams.getAll("variant").length === 1
        && /^\d{10,20}$/.test(variant) ? variant : "";
    } else if (host === "bananarepublic.gap.com" && !url.port) {
      retailerId = "bananarepublic";
      const pid = url.searchParams.get("pid") || "";
      retailerSku = url.pathname === "/browse/product.do" && url.searchParams.getAll("pid").length === 1
        && /^\d{9}0000$/.test(pid) && (!url.searchParams.has("vid")
          || url.searchParams.getAll("vid").length === 1 && url.searchParams.get("vid") === "1") ? pid : "";
    } else if (host === "bananarepublicfactory.gapfactory.com" && !url.port) {
      retailerId = "bananarepublicfactory";
      const pid = url.searchParams.get("pid") || "";
      retailerSku = url.pathname === "/browse/product.do" && url.searchParams.getAll("pid").length === 1
        && /^\d{10}0000$/.test(pid) && (!url.searchParams.has("vid")
          || url.searchParams.getAll("vid").length === 1 && url.searchParams.get("vid") === "1") ? pid : "";
    } else if (host === "athleta.gap.com" && !url.port) {
      retailerId = "athleta";
      const pid = url.searchParams.get("pid") || "";
      retailerSku = url.pathname === "/browse/product.do" && url.searchParams.getAll("pid").length === 1
        && /^\d{9}0000$/.test(pid) && (!url.searchParams.has("vid")
          || url.searchParams.getAll("vid").length === 1 && url.searchParams.get("vid") === "1") ? pid : "";
    } else if ((host === "ae.com" || host === "www.ae.com") && !url.port) {
      retailerId = "americaneagle";
      retailerSku = /^\/us\/en\/p\/(?:[a-z0-9-]+\/)*\d{4}_\d{4}_\d{3}\/?$/.test(url.pathname)
        && url.searchParams.getAll("sku").length === 1 ? url.searchParams.get("sku") || "" : "";
    } else if (host === "aninebing.com" || host === "www.aninebing.com") {
      retailerId = "aninebing";
      retailerSku = /^\/products\/[a-z0-9-]+\/?$/.test(url.pathname) ? url.searchParams.get("variant") || "" : "";
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
                  : retailerId === "asus" ? `https://eshop.asus.com${url.pathname}`
                  : retailerId === "audioadvice" ? `https://www.audioadvice.com${url.pathname}?variant=${retailerSku}`
                  : retailerId === "bananarepublic" ? `https://bananarepublic.gap.com/browse/product.do?pid=${retailerSku}`
                  : retailerId === "bananarepublicfactory" ? `https://bananarepublicfactory.gapfactory.com/browse/product.do?pid=${retailerSku}`
                  : retailerId === "athleta" ? `https://athleta.gap.com/browse/product.do?pid=${retailerSku}`
                  : retailerId === "americaneagle" ? `https://www.ae.com${url.pathname}?sku=${retailerSku}`
                  : retailerId === "aninebing" ? `https://www.aninebing.com${url.pathname}?variant=${retailerSku}`
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

async function retailerTabIdentity(tab) {
  const identity = canonicalRetailerIdentity(tab?.url);
  if (identity) return identity;
  const page = PopupState.classifyPageContext(tab?.url);
  if (!Number.isInteger(tab?.id) || page.kind !== "product_link") return null;
  if (page.retailerId === "americaneagle") {
    if (!await chrome.permissions.contains({ origins: RETAILER_ORIGINS.americaneagle })) {
      throw new Error("Allow American Eagle page access, then try again.");
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", files: ["retailer-shadow.js"] });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "ISOLATED", args: [page.productCode],
      func: (expectedPath) => {
        if (location.pathname !== expectedPath) return null;
        return globalThis.YoinkRetailerShadow.collectRetailerShadowObservation(document, location.href, "americaneagle");
      }
    });
    const observed = results.find(entry => entry.frameId === 0)?.result;
    const identity = canonicalRetailerIdentity(observed?.canonicalUrl);
    if (!identity || identity.retailerId !== "americaneagle" || identity.retailerSku !== observed?.retailerSku) {
      throw new Error("Open an available American Eagle product with One Size selected, let the page finish loading, then inspect again.");
    }
    return identity;
  }
  if (page.retailerId === "audioadvice") {
    if (!await chrome.permissions.contains({ origins: RETAILER_ORIGINS.audioadvice })) {
      throw new Error("Allow Audio Advice page access, then try again.");
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", files: ["retailer-shadow.js"] });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "ISOLATED", args: [page.productCode],
      func: (expectedPath) => {
        if (location.pathname !== expectedPath) return null;
        return globalThis.YoinkRetailerShadow.collectRetailerShadowObservation(document, location.href, "audioadvice");
      }
    });
    const observed = results.find(entry => entry.frameId === 0)?.result;
    const identity = canonicalRetailerIdentity(observed?.canonicalUrl);
    if (!identity || identity.retailerId !== "audioadvice" || identity.retailerSku !== observed?.retailerSku) {
      throw new Error("Open an available Audio Advice product, let the page finish loading, then inspect again.");
    }
    return identity;
  }
  if (page.retailerId === "aninebing") {
    if (!await chrome.permissions.contains({ origins: RETAILER_ORIGINS.aninebing })) {
      throw new Error("Allow ANINE BING page access, then try again.");
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", files: ["retailer-shadow.js"] });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "ISOLATED", args: [page.productCode],
      func: (expectedPath) => {
        if (location.pathname !== expectedPath) return null;
        return globalThis.YoinkRetailerShadow.collectRetailerShadowObservation(document, location.href, "aninebing");
      }
    });
    const observed = results.find(entry => entry.frameId === 0)?.result;
    const identity = canonicalRetailerIdentity(observed?.canonicalUrl);
    if (!identity || identity.retailerId !== "aninebing" || identity.retailerSku !== observed?.retailerSku) {
      throw new Error("Select an available ANINE BING size and color, let the page finish loading, then inspect again.");
    }
    return identity;
  }
  if (!await chrome.permissions.contains({ origins: RETAILER_ORIGINS.bestbuy })) {
    throw new Error("Allow Best Buy page access, then try again.");
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", files: ["retailer-shadow.js"] });
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: "ISOLATED",
    args: ["resolveBestBuyProductIdentity", page.productCode],
    func: async (_operation, expectedCode) => {
      const read = () => {
        const observer = globalThis.YoinkRetailerShadow;
        if (observer?.bestBuyProductCode(location.href) !== expectedCode) return "";
        return observer.bestBuyPageSku(document, location.href);
      };
      const sku = read();
      if (sku) return sku;
      // Metadata can arrive after the page shell. Wait without store clicks.
      return new Promise((resolve) => {
        const observer = new MutationObserver(() => { const sku = read(); if (sku) finish(sku); });
        const timer = setTimeout(() => finish(""), 8_000);
        const finish = (value) => { clearTimeout(timer); observer.disconnect(); resolve(value); };
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      });
    }
  });
  const sku = results.find((entry) => entry.frameId === 0)?.result;
  if (typeof sku !== "string" || !RETAILER_SKU_PATTERNS.bestbuy.test(sku)) {
    throw new Error("Best Buy product recognized, but its item number is missing or conflicting. Let the page finish loading, then inspect again.");
  }
  return { retailerId: "bestbuy", retailerSku: sku, canonicalUrl: `https://www.bestbuy.com/site/-/${sku}.p` };
}

function senderIsTrackalacker(sender) {
  // Content operations come only from the TrackaLacker sync script in a top
  // frame of a real https TrackaLacker tab. Subframes and other pages are refused.
  return sender?.id === chrome.runtime.id
    && Number.isInteger(sender?.tab?.id)
    && sender?.frameId === 0
    && trackalackerTabUrl(sender?.tab?.url)
    && trackalackerTabUrl(sender?.url);
}

function senderIsExtensionPage(sender) {
  // Popup, options and offscreen pages. Options opens in a tab, so a tab alone
  // is not disqualifying; the sender URL must be this extension's own origin.
  // Content scripts report the page URL here, never chrome-extension://.
  if (sender?.id !== chrome.runtime.id) return false;
  const extensionOrigin = String(chrome.runtime.getURL("") || "");
  return Boolean(extensionOrigin) && String(sender?.url || "").startsWith(extensionOrigin);
}

async function resolveTrackalackerListing(message, sender) {
  if (!senderIsTrackalacker(sender)) throw new Error("A signed-in TrackaLacker tab is required.");
  const expected = ["target", ...Object.keys(RETAILER_OBSERVER_VERSIONS)].includes(String(message?.expectedRetailer || ""))
    ? String(message.expectedRetailer) : "";
  let identity = canonicalRetailerIdentity(message?.url);
  if (identity && (!expected || identity.retailerId === expected)) return { identity };
  try {
    const initial = new URL(String(message?.url || ""));
    // Credentials are sent with this fetch, so require https and the exact host.
    if (!trackalackerTabUrl(initial.href)) return { identity: null };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(initial.href, { method: "GET", credentials: "include", redirect: "follow", cache: "no-store", signal: controller.signal });
      const finalUrl = String(response.url || "");
      identity = /^https:\/\//i.test(finalUrl) ? canonicalRetailerIdentity(finalUrl) : null;
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
  const { mode: _mode, automatic: _automatic, resumeOf: _resumeOf, openedTabId: _openedTabId, ...reported } = message || {};
  const state = await updateTrackalackerSyncState(reported);
  if (["complete", "error"].includes(state.phase)) await finishTrackalackerSync(state);
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
  try {
    return await request("/devices/self/sources/trackalacker/catalog", {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({ syncId: current.syncId, item: message.item })
    }, 15_000);
  } catch (error) {
    // Conflicts are final; say what an admin can do rather than retrying.
    if (error?.code === "listing_already_mapped") {
      throw new Error("This listing is already linked to another product. Ask an admin to review it in Catalog.");
    }
    if (error?.code === "variant_conflict") {
      throw new Error("This product and store item point at different exact variants. Ask an admin to review the mapping in Catalog.");
    }
    throw error;
  }
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

/** The sync script's first request: what Yoink already knows, so the run skips that work. */
async function trackalackerSyncPlan(message, sender) {
  if (!senderIsTrackalacker(sender)) throw new Error("A signed-in TrackaLacker tab is required.");
  const current = await readTrackalackerSyncState();
  if (!current.syncId || String(message?.syncId || "") !== current.syncId) throw new Error("This TrackaLacker sync is no longer active.");
  const device = await storedDevice();
  if (!device?.token) throw new Error("The paired Chrome device is unavailable.");
  const query = current.resumeOf ? `?resumeOf=${encodeURIComponent(current.resumeOf)}` : "";
  const response = await request(`/devices/self/sources/trackalacker/catalog/known${query}`, {
    headers: { Authorization: `Bearer ${device.token}` }
  }, 15_000);
  return { mode: current.mode, plan: response?.plan || { listings: {}, skipProductIds: [] } };
}

let trackalackerSyncSettled = null;
function holdReloadsForTrackalackerSync() {
  if (trackalackerSyncSettled) return;
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  // Never longer than a long full pass, whatever happens to the tab.
  const timer = setTimeout(() => release(), 30 * 60_000);
  trackalackerSyncSettled = { promise, release: () => { clearTimeout(timer); release(); trackalackerSyncSettled = null; } };
}

/** A run ended: note when, back off if TrackaLacker pushed back, close a tab it opened. */
async function finishTrackalackerSync(state) {
  const now = Date.now();
  const backoff = state.stopReason === "signed_out" ? 6 * 60 * 60_000
    : state.stopReason ? 2 * 60 * 60_000 : 0;
  await updateTrackalackerSyncSchedule({
    ...(state.phase === "complete" && state.mode === "full" ? { lastFullAt: now } : {}),
    ...(backoff ? { retryAfter: now + backoff } : {})
  });
  if (Number.isInteger(state.openedTabId)) {
    await chrome.tabs.remove(state.openedTabId).catch(() => undefined);
    await updateTrackalackerSyncState({ openedTabId: null });
  }
  trackalackerSyncSettled?.release();
}

async function runScheduledTrackalackerSync(now = Date.now()) {
  const device = await storedDevice();
  if (!device?.token) return "";
  if (!await chrome.permissions.contains({ origins: TRACKALACKER_ORIGINS }).catch(() => false)) return "";
  const mode = trackalackerSyncDue(await readTrackalackerSyncState(), await readTrackalackerSyncSchedule(), now);
  if (!mode) return "";
  try {
    await startTrackalackerSync({ mode, automatic: true });
  } catch {
    // TrackaLacker unreachable or not signed in: try again in half an hour.
    await updateTrackalackerSyncSchedule({ retryAfter: now + 30 * 60_000 });
  }
  return mode;
}

/**
 * Starts a TrackaLacker library sync. "full" (the menu's Sync products and the
 * nightly pass) also reads History that is over 7 days old; "quick" (hourly)
 * refreshes prices, stock and new follows. A run an update cut off is picked
 * up where it stopped.
 */
async function startTrackalackerSync({ mode = "full", automatic = false } = {}) {
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this Chrome companion before syncing TrackaLacker.");
  const current = await readTrackalackerSyncState();
  if (trackalackerSyncActive(current)) return { state: current, alreadyRunning: true };
  const updatedAt = Date.parse(current.updatedAt || "");
  const resumeOf = ["starting", "discovering", "importing"].includes(current.phase) && current.syncId
    && Number.isFinite(updatedAt) && Date.now() - updatedAt < 6 * 60 * 60_000 ? current.syncId : "";
  const opened = automatic ? await openTrackalackerTab({ background: true }) : { id: await trackalackerTab(), created: false };
  const tabId = opened.id;
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
    stopReason: "",
    mode,
    automatic,
    resumeOf,
    openedTabId: opened.created ? tabId : null,
    message: resumeOf ? "Picking up the sync an update interrupted…"
      : mode === "quick" ? "Refreshing prices and stock from TrackaLacker…" : "Starting a full TrackaLacker library pass…"
  });
  await updateTrackalackerSyncSchedule({ lastStartedAt: Date.now() });
  holdReloadsForTrackalackerSync();
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
        message: state.message,
        ...(resumeOf ? { resumeOf } : {})
      })
    }, 15_000);
    await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", files: ["trackalacker-sync.js"] });
    const executions = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: (requestedSyncId, requestedMode) => {
        try {
          const sync = globalThis.YoinkTrackalackerSync;
          if (!sync || typeof sync.startTrackalackerSync !== "function") return { ok: false, message: "TrackaLacker sync module is unavailable." };
          return sync.startTrackalackerSync(requestedSyncId, requestedMode);
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : "TrackaLacker sync could not start." };
        }
      },
      args: [syncId, mode]
    });
    const result = executions.find((entry) => entry.frameId === 0)?.result;
    if (!result?.ok) throw new Error(result?.message || "TrackaLacker sync could not start.");
    state = await readTrackalackerSyncState();
    return { state, alreadyRunning: result.alreadyRunning === true };
  } catch (error) {
    state = await updateTrackalackerSyncState({ phase: "error", message: error instanceof Error ? error.message : "TrackaLacker sync could not start." });
    await finishTrackalackerSync(state).catch(() => undefined);
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
  if (await showBestBuyWaitBadge()) return;
  if (await showActionHandoffBadge(await readCartReadyState())) return;
  const color = !state.connected ? BADGE_COLORS.bad : state.paired ? BADGE_COLORS.good : BADGE_COLORS.warning;
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text: !state.connected ? "!" : state.paired ? "" : "?" });
  await chrome.action.setTitle({ title: !state.connected
    ? "Yoink is not running"
    : state.paired ? `Yoink ${state.version || ""} paired` : "Yoink is ready; pairing required" });
}

function packagedVersionSignature(versions) {
  if (!versions || typeof versions !== "object") return "";
  const parts = [String(versions.extension || "")];
  for (const group of ["observer", "add", "pack"]) {
    const map = versions[group] && typeof versions[group] === "object" ? versions[group] : {};
    for (const key of Object.keys(map).sort()) parts.push(`${group}:${key}=${String(map[key] || "")}`);
  }
  return parts.join("|");
}

function installedVersionSignature() {
  return packagedVersionSignature({
    extension: EXTENSION_VERSION,
    observer: ADAPTER_VERSIONS.observer,
    add: ADAPTER_VERSIONS.add,
    pack: ADAPTER_VERSIONS.pack
  });
}

// Work that a reload would cut short; see maybeReloadForLocalUpdate.
function localReloadBlockers() {
  return [automaticReverificationPromise, retailerReverificationPromise, evidenceCapsuleDrainPromise, watchQueueCyclePromise,
    trackalackerEnrollmentPromise, trackalackerSyncSettled?.promise].filter(Boolean);
}

function settlesWithin(promises, ms) {
  let timer;
  return Promise.race([
    Promise.allSettled(promises).then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); })
  ]).finally(() => clearTimeout(timer));
}

// A local development install loads straight from the source directory. When
// the app reports packaged versions this worker does not have, the files on
// disk have already changed; one reload picks them up without a visit to
// chrome://extensions. Each version signature reloads at most once, so an
// install whose files did not change cannot loop. Managed installs never
// self-reload.
async function maybeReloadForLocalUpdate(health) {
  if (RUNTIME_CONFIG.profile !== "local" || typeof chrome.runtime?.reload !== "function") return false;
  const expected = packagedVersionSignature(health?.packagedVersions);
  if (!expected || expected === installedVersionSignature()) return false;
  // An unpacked install reports "development"; without the management API,
  // a manifest with no update_url is the same signal (store and managed
  // installs always carry one).
  let development = false;
  try {
    if (typeof chrome.management?.getSelf === "function") {
      development = String((await chrome.management.getSelf())?.installType || "") === "development";
    } else {
      development = !chrome.runtime.getManifest()?.update_url;
    }
  } catch {
    development = false;
  }
  if (!development) return false;
  // A reload clears storage.session (active job, action tabs, order handoff,
  // watch lease). Never reload under an add or a watch observation; the next
  // health tick retries because the signature is only written when the reload
  // really happens. The job and notification long polls are not checked: they
  // hold ~25 s of every 30 s and a dropped poll loses nothing (the active-job
  // record is what marks a real add in flight).
  // The health alarm starts the automatic store-check decision and the capsule
  // drain in the same tick as this check, so giving up whenever they were in
  // flight meant an installed companion practically never reloaded. Let that
  // work finish first (bounded; a real store check can take minutes).
  const busy = localReloadBlockers();
  if (busy.length && !await settlesWithin(busy, LOCAL_RELOAD_SETTLE_MS)) return false;
  if (localReloadBlockers().length || await activeJob().catch(() => null)
    || await readWatchLease().catch(() => null)) return false;
  // A reload can land before companion-sync has finished copying the new
  // files, leaving the old versions installed. Retry a few times, spaced out,
  // instead of giving up on the first attempt for this signature.
  const stored = (await chrome.storage.local.get(LOCAL_RELOAD_SIGNATURE_KEY))[LOCAL_RELOAD_SIGNATURE_KEY];
  const previous = stored && typeof stored === "object" && stored.signature === expected ? stored : null;
  const attempts = Number(previous?.attempts) || 0;
  if (attempts >= LOCAL_RELOAD_MAX_ATTEMPTS
    || (previous && Date.now() - Number(previous.at || 0) < LOCAL_RELOAD_RETRY_MS)) return false;
  await chrome.storage.local.set({ [LOCAL_RELOAD_SIGNATURE_KEY]: { signature: expected, attempts: attempts + 1, at: Date.now() } });
  chrome.runtime.reload();
  return true;
}

async function accessibleAddRetailers() {
  const laneIds = Object.keys(ADD_LANES);
  const access = await Promise.all(laneIds.map((retailerId) => addLaneAccess(retailerId).catch(() => false)));
  return laneIds.filter((_, index) => access[index]);
}

// Compact loop outcomes for the heartbeat body, so the server can tell "the
// companion polls and is refused" from "the companion never polls".
function heartbeatLoopHealth(loops) {
  return Object.fromEntries(Object.entries(loops).map(([loop, entry]) => [loop, {
    at: entry.at,
    reason: entry.reason,
    ok: entry.ok,
    status: entry.status,
    code: entry.code,
    consecutiveFailures: entry.consecutiveFailures
  }]));
}

// Only the heartbeat's own token counts: a 401 for a token that has since been
// rotated or replaced says nothing about the current pairing. Two refusals at
// least a minute apart, with no success between, remove the pairing and tell
// the shopper; a single transient 401 only surfaces as a refused heartbeat.
async function handleHeartbeatUnauthorized(tokenUsed, now = Date.now()) {
  const stored = await storedDevice();
  if (!stored?.token || stored.token !== tokenUsed || stored.pendingCredential) return { removed: false, device: stored };
  const failures = (await chrome.storage.local.get(AUTH_FAILURES_KEY))[AUTH_FAILURES_KEY];
  const firstAt = failures && failures.token === await tokenFingerprint(tokenUsed)
    ? Number(new Date(String(failures.firstAt || "")).getTime()) : NaN;
  if (!Number.isFinite(firstAt) || firstAt > now) {
    await chrome.storage.local.set({
      [AUTH_FAILURES_KEY]: { token: await tokenFingerprint(tokenUsed), firstAt: new Date(now).toISOString(), count: 1 }
    });
    return { removed: false, device: stored };
  }
  if (now - firstAt < AUTH_FAILURE_CONFIRM_MS) return { removed: false, device: stored };
  await chrome.storage.local.remove(DEVICE_KEY);
  await chrome.storage.local.remove(AUTH_FAILURES_KEY);
  try {
    await chrome.notifications?.create?.(UNPAIRED_NOTIFICATION_ID, {
      type: "basic",
      iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
      title: "This browser was unpaired by Yoink",
      message: "Yoink no longer accepts this browser's pairing. Open Yoink › Setup › Chrome and pair again.",
      priority: 2
    });
  } catch {
    // The badge and popup still show the unpaired state.
  }
  return { removed: true, device: null };
}

async function tokenFingerprint(token) {
  // Never persist a second copy of the bearer token; a short hash is enough to
  // tell whether the recorded refusals belong to the token still stored.
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token || "")));
    return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return String(token || "").length.toString(16);
  }
}

// Writes the heartbeat's device metadata only if the stored pairing still uses
// the token this heartbeat was sent with. A credential rotation or re-pair that
// committed meanwhile wins, so a retired token can never be written back.
async function commitHeartbeatDevice(tokenUsed, update) {
  const stored = await storedDevice();
  if (!stored?.token || stored.token !== tokenUsed || stored.pendingCredential) return stored;
  const merged = { ...stored, ...update };
  await chrome.storage.local.set({ [DEVICE_KEY]: merged });
  return merged;
}

// One health check at a time. Callers that only need the current state share
// the in-flight check; callers that just changed the pairing or the pause
// setting pass fresh:true and get a new check that starts after it.
function checkHealth(options = {}) {
  if (healthCheckPromise) {
    if (options?.fresh !== true) return healthCheckPromise;
    healthCheckQueuedPromise ??= healthCheckPromise.catch(() => undefined).then(() => {
      healthCheckQueuedPromise = null;
      return checkHealth();
    });
    return healthCheckQueuedPromise;
  }
  healthCheckPromise = runHealthCheck().finally(() => { healthCheckPromise = null; });
  return healthCheckPromise;
}

async function runHealthCheck() {
  let state;
  let failedRequest = "health";
  try {
    const health = await request("/health");
    if (health?.status !== "ready") {
      const notReady = new Error("not_ready");
      notReady.code = "not_ready";
      notReady.reasons = Array.isArray(health?.reasons) ? health.reasons : [];
      throw notReady;
    }
    // A ready answer is the proof "Background checks" can reach Yoink. Without
    // it two failures (say, during a server restart) would read as
    // unreachable forever, since nothing else resets the count.
    await recordLoopOutcome("health", { reason: "ready" });
    failedRequest = "heartbeat";
    void maybeReloadForLocalUpdate(health).catch(() => false);
    let device = await storedDevice();
    if (device?.pendingCredential) device = await maintainDeviceCredential(device);
    let controlPlane = null;
    const loopHealth = await readLoopHealth().catch(() => ({}));
    const accessibleRetailers = await accessibleAddRetailers();
    if (device?.token) {
      const tokenUsed = device.token;
      const browser = await companionBrowser();
      try {
        const heartbeat = await request("/devices/self/heartbeat", {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenUsed}` },
          body: JSON.stringify({
            name: browser.name,
            platform: browser.platform,
            extensionVersion: EXTENSION_VERSION,
            capabilities: targetCapabilities(),
            loopHealth: heartbeatLoopHealth(loopHealth),
            accessibleRetailers
          })
        });
        const credential = normalizedDeviceCredentialStatus(heartbeat.credential);
        await chrome.storage.local.remove(AUTH_FAILURES_KEY).catch(() => undefined);
        device = await commitHeartbeatDevice(tokenUsed, {
          id: heartbeat.device.id,
          name: heartbeat.device.name,
          credentialGeneration: credential?.generation ?? device.credentialGeneration
        });
        controlPlane = heartbeat.controlPlane || null;
        if (credential?.rotationDue && device?.token === tokenUsed) {
          device = await maintainDeviceCredential(device, credential);
        }
      } catch (error) {
        if (error?.status === 401) {
          const outcome = await handleHeartbeatUnauthorized(tokenUsed);
          if (!outcome.removed) throw error;
          device = null;
        } else {
          throw error;
        }
      }
    }
    state = readiness(true, {
      ...health,
      executionMode: controlPlane?.executionMode ?? health.executionMode,
      companionCompatible: controlPlane?.companionCompatible ?? health.companionCompatible,
      companionCompatibilityReason: controlPlane?.companionCompatibilityReason ?? health.companionCompatibilityReason,
      actionsPaused: controlPlane?.actionsPaused ?? health.actionsPaused,
      resume: controlPlane?.resume ?? null,
      chromeMutationEnabled: controlPlane?.retailerMutationEnabled ?? health.chromeMutationEnabled,
      targetAddExecutionEnabled: controlPlane?.targetAddExecutionEnabled ?? health.targetAddExecutionEnabled,
      walmartAddExecutionEnabled: controlPlane?.walmartAddExecutionEnabled ?? health.walmartAddExecutionEnabled,
      amazonAddExecutionEnabled: controlPlane?.amazonAddExecutionEnabled ?? health.amazonAddExecutionEnabled,
      bestBuyAddExecutionEnabled: controlPlane?.bestBuyAddExecutionEnabled ?? health.bestBuyAddExecutionEnabled,
      pokemonCenterAddExecutionEnabled: controlPlane?.pokemonCenterAddExecutionEnabled ?? health.pokemonCenterAddExecutionEnabled,
      communitySharingRetailers: controlPlane?.communitySharingRetailers,
      loopHealth,
      accessibleRetailers,
      targetShadowAccess: await targetShadowAccess(),
      trackalackerPush: await readTrackalackerState(),
      trackalackerSync: await readTrackalackerSyncState()
    }, device);
  } catch (error) {
    await recordLoopOutcome("health", loopOutcomeFromError("health_failed", error));
    const previous = await chrome.storage.local.get(READINESS_KEY).then((stored) => stored[READINESS_KEY]).catch(() => null);
    state = readiness(false, {
      failure: healthFailure(error, failedRequest),
      lastReadyAt: typeof previous?.lastReadyAt === "string" ? previous.lastReadyAt : "",
      loopHealth: await readLoopHealth().catch(() => ({})),
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

// Pauses or resumes the shopper's store actions from the popup, then refreshes
// health so the popup, badge, and context menu all reflect the new state at once.
async function setActionsPausedFromPopup(paused, confirmationToken = "") {
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this browser with Yoink before changing store actions.");
  // A resume forwards the token of the preflight the shopper confirmed, when
  // the server issued one, so a scope that changed since can be refused.
  const token = paused !== true && /^[A-Za-z0-9_.:-]{8,200}$/.test(String(confirmationToken || ""))
    ? String(confirmationToken) : "";
  const payload = await request("/devices/self/settings/actions", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({ paused: paused === true, ...(token ? { confirmationToken: token } : {}) })
  }, 6000);
  const state = await checkHealth({ fresh: true });
  return {
    disposition: payload?.disposition === "pending_approval" ? "pending_approval" : "applied",
    paused: state?.actionsPaused === true,
    state
  };
}

// Brave and Edge run this same companion. The app names each paired browser
// "Desktop - Windows - <browser>" from what it reports here, and TrackaLacker
// lists the push registration under the same name.
let companionBrowserPromise = null;

function companionBrowser() {
  companionBrowserPromise ??= (async () => {
    const browserNavigator = globalThis.navigator;
    let brave = false;
    try {
      brave = typeof browserNavigator?.brave?.isBrave === "function" && await browserNavigator.brave.isBrave() === true;
    } catch {
      brave = false;
    }
    const brands = Array.isArray(browserNavigator?.userAgentData?.brands)
      ? browserNavigator.userAgentData.brands.map((entry) => String(entry?.brand || "")) : [];
    const browser = brave || brands.includes("Brave") ? { id: "brave", label: "Brave" }
      : brands.includes("Microsoft Edge") ? { id: "edge", label: "Edge" }
        : { id: "chrome", label: "Chrome" };
    return { platform: `windows-${browser.id}`, name: `Desktop - Windows - ${browser.label}` };
  })();
  return companionBrowserPromise;
}

async function pairDevice(code) {
  const browser = await companionBrowser();
  const payload = await request("/devices/pair", {
    method: "POST",
    body: JSON.stringify({
      pairingCode: String(code || "").trim(),
      name: browser.name,
      platform: browser.platform,
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
  await chrome.storage.local.remove(AUTH_FAILURES_KEY).catch(() => undefined);
  return checkHealth({ fresh: true });
}

async function forgetDevice() {
  await chrome.storage.local.remove(DEVICE_KEY);
  await chrome.storage.local.remove(AUTH_FAILURES_KEY).catch(() => undefined);
  return checkHealth({ fresh: true });
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

// Retailer SPAs can report tab completion while their exact offer is still a
// placeholder. Re-run the read-only observer on DOM change (with a bounded
// fallback) before turning a transient shell into an operator incident.
async function waitForShadowHydration(tabId, retailerId, targetObserver, attemptCount, priorLayoutSignature) {
  const injections = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: [
      targetObserver ? "waitForTargetShadowHydration" : "waitForRetailerShadowHydration",
      retailerId,
      targetObserver,
      attemptCount,
      priorLayoutSignature,
      OBSERVER_HYDRATION_MAX_MS,
      OBSERVER_HYDRATION_QUIET_MS,
      OBSERVER_HYDRATION_FALLBACK_MS,
      [...HYDRATION_RETRYABLE_STAGES],
      RUNTIME_CONFIG.profile === "local"
    ],
    func: (_operationName, exactRetailerId, useTargetObserver, currentAttempt, initialLayoutSignature, waitMs, quietMs, fallbackMs, retryableStageList, collectTrace) => new Promise((resolve) => {
      const observerApi = useTargetObserver ? globalThis.YoinkTargetShadow : globalThis.YoinkRetailerShadow;
      const collectAttempt = useTargetObserver
        ? observerApi?.collectTargetShadowAttempt
        : observerApi?.collectRetailerShadowAttempt;
      if (typeof collectAttempt !== "function") {
        resolve({ ok: false, reasonCode: "observer_runtime_unavailable" });
        return;
      }
      const retryableStages = new Set(Array.isArray(retryableStageList) ? retryableStageList : []);
      const environment = collectTrace ? { trace: { record() {} } } : undefined;
      let settled = false;
      let mutationSeen = false;
      let mutationTimer;
      let fallbackTimer;
      let deadlineTimer;
      let mutationObserver;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(mutationTimer);
        clearInterval(fallbackTimer);
        clearTimeout(deadlineTimer);
        mutationObserver?.disconnect?.();
        resolve(result);
      };
      const inspect = (final = false) => {
        if (settled) return;
        let attempt;
        try {
          attempt = useTargetObserver
            ? collectAttempt(document, location.href, "shipping", currentAttempt, mutationSeen, environment)
            : collectAttempt(document, location.href, exactRetailerId, "shipping", currentAttempt, mutationSeen, environment);
        } catch {
          finish({ ok: false, reasonCode: "observer_collection_failed" });
          return;
        }
        const diagnostic = attempt?.diagnostic;
        const observation = attempt?.observation;
        const layoutSignature = JSON.stringify(diagnostic?.layout || {});
        // Only a structural change counts. Unrelated mutations (carousels,
        // countdowns) must not mark the repair evidence as DOM-changed.
        const domChanged = layoutSignature !== initialLayoutSignature;
        const retryable = diagnostic?.outcome === "failed"
          && !diagnostic?.layout?.securityChallenge
          && !diagnostic?.layout?.interactiveBlock
          && observation?.sellerType !== "third_party"
          && retryableStages.has(String(diagnostic?.failureStage || ""));
        if (!retryable || final) finish({ ok: true, ...attempt, domChanged });
      };
      const inspectAfterMutation = () => {
        mutationSeen = true;
        if (settled || mutationTimer) return;
        mutationTimer = setTimeout(() => {
          mutationTimer = undefined;
          inspect(false);
        }, quietMs);
      };
      try {
        mutationObserver = new MutationObserver(inspectAfterMutation);
        mutationObserver.observe(document.documentElement || document, {
          childList: true,
          subtree: true,
          attributes: true
        });
      } catch {
        mutationObserver = null;
      }
      fallbackTimer = setInterval(() => inspect(false), fallbackMs);
      deadlineTimer = setTimeout(() => {
        clearTimeout(mutationTimer);
        mutationTimer = undefined;
        inspect(true);
      }, waitMs);
      inspect(false);
    })
  });
  return injections.find((entry) => entry.frameId === 0)?.result || null;
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
  for (let attemptCount = 1; attemptCount <= 2; attemptCount += 1) {
    let result;
    try {
      if (attemptCount === 1) {
        const injections = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "ISOLATED",
          args: ["collectTargetShadowAttempt", attemptCount, domChanged, RUNTIME_CONFIG.profile === "local"],
          func: (_operationName, currentAttempt, changed, collectTrace) => {
            try {
              const observer = globalThis.YoinkTargetShadow;
              if (!observer || typeof observer.collectTargetShadowAttempt !== "function") {
                return { ok: false, reasonCode: "observer_runtime_unavailable" };
              }
              const environment = collectTrace ? { trace: { record() {} } } : undefined;
              return { ok: true, ...observer.collectTargetShadowAttempt(
                document, location.href, "shipping", currentAttempt, changed, environment
              ) };
            } catch {
              return { ok: false, reasonCode: "observer_collection_failed" };
            }
          }
        });
        result = injections.find((entry) => entry.frameId === 0)?.result;
      } else {
        result = await waitForShadowHydration(tab.id, "target", true, attemptCount, priorLayout);
      }
    } catch {
      // An interrupted hydration wait (navigation, document replacement) is
      // not an observer runtime failure: keep the first attempt's evidence.
      if (attemptCount > 1 && attempts.length) break;
      await reportObserverRuntimeFailure(device, identity, "observer_execution_failed", attemptCount, domChanged);
      throw new Error("Yoink could not inspect this Target page. Reload the page and try again.");
    }
    if (!result) {
      if (attemptCount > 1 && attempts.length) break;
      await reportObserverRuntimeFailure(device, identity, "observer_top_frame_missing", attemptCount, domChanged);
      throw new Error("Yoink could not inspect this Target page. Reload the page and try again.");
    }
    if (!result.ok) {
      if (attemptCount > 1 && attempts.length) break;
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
    if (result.domChanged === true) domChanged = true;
    if (priorLayout && priorLayout !== layoutSignature) domChanged = true;
    priorLayout = layoutSignature;
    attempts.push({
      observation,
      diagnostic,
      trace: Array.isArray(result.trace) ? result.trace : []
    });
    const retryable = diagnostic.outcome === "failed"
      && !diagnostic.layout.securityChallenge
      && !diagnostic.layout.interactiveBlock
      && observation.sellerType !== "third_party"
      && HYDRATION_RETRYABLE_STAGES.includes(diagnostic.failureStage);
    if (!retryable || attemptCount === 2) break;
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
  await captureTabEvidenceCapsule(tab.id, diagnostic, { trace: final.trace || [] }).catch(() => null);
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
  const identity = await retailerTabIdentity(tab);
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
  const shippingSelection = identity.retailerId === "bestbuy"
    ? await selectBestBuyShippingTab(tab.id, identity.retailerSku) : null;
  const attempts = [];
  let priorLayout = "";
  let domChanged = false;
  for (let attemptCount = 1; attemptCount <= 2; attemptCount += 1) {
    let result;
    try {
      if (attemptCount === 1) {
        const injections = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "ISOLATED",
          args: [identity.retailerId, attemptCount, domChanged, RUNTIME_CONFIG.profile === "local"],
          func: (retailerId, currentAttempt, changed, collectTrace) => {
            try {
              const observer = globalThis.YoinkRetailerShadow;
              if (!observer || typeof observer.collectRetailerShadowAttempt !== "function") {
                return { ok: false, reasonCode: "observer_runtime_unavailable" };
              }
              const environment = collectTrace ? { trace: { record() {} } } : undefined;
              return { ok: true, ...observer.collectRetailerShadowAttempt(
                document, location.href, retailerId, "shipping", currentAttempt, changed, environment
              ) };
            } catch {
              return { ok: false, reasonCode: "observer_collection_failed" };
            }
          }
        });
        result = injections.find((entry) => entry.frameId === 0)?.result;
      } else {
        result = await waitForShadowHydration(tab.id, identity.retailerId, false, attemptCount, priorLayout);
      }
    } catch {
      // An interrupted hydration wait keeps the first attempt's evidence
      // instead of opening a zero-layout runtime incident.
      if (attemptCount > 1 && attempts.length) break;
      await reportObserverRuntimeFailure(device, identity, "observer_execution_failed", attemptCount, domChanged);
      throw new Error("Yoink could not inspect this retailer page. Reload the page and try again.");
    }
    if (!result) {
      if (attemptCount > 1 && attempts.length) break;
      await reportObserverRuntimeFailure(device, identity, "observer_top_frame_missing", attemptCount, domChanged);
      throw new Error("Yoink could not inspect this retailer page. Reload the page and try again.");
    }
    if (!result.ok) {
      if (attemptCount > 1 && attempts.length) break;
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
      if (observation.retailerSku !== identity.retailerSku || diagnostic.retailerSku !== identity.retailerSku) {
        throw new Error("The product identity changed during inspection.");
      }
    } catch {
      await reportObserverRuntimeFailure(device, identity, "observer_contract_invalid", attemptCount, domChanged);
      throw new Error("Yoink received invalid retailer evidence. The failure was reported for repair.");
    }
    const layoutSignature = JSON.stringify(diagnostic.layout);
    if (result.domChanged === true) domChanged = true;
    if (priorLayout && priorLayout !== layoutSignature) domChanged = true;
    priorLayout = layoutSignature;
    attempts.push({
      observation,
      diagnostic,
      trace: Array.isArray(result.trace) ? result.trace : []
    });
    const retryable = [
      "walmart", "amazon", "bestbuy", "disney", "ravensburger", "riot", "booksamillion",
      "fanatics", "kohls", "macys", "pbandai", "pokemoncenter"
    ].includes(identity.retailerId)
      && diagnostic.outcome === "failed"
      && !diagnostic.layout.securityChallenge
      && !diagnostic.layout.interactiveBlock
      && observation.sellerType !== "third_party"
      && HYDRATION_RETRYABLE_STAGES.includes(diagnostic.failureStage);
    if (!retryable || attemptCount === 2) break;
  }
  const initial = attempts[0];
  const final = attempts.at(-1);
  if (!initial || !final) throw new Error("The retailer page returned no shadow evidence.");
  const recovered = initial.diagnostic.outcome !== "passed" && final.diagnostic.outcome === "passed";
  let diagnostic = recovered
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
  if (shippingSelection?.ok === false && !final.observation.securityChallenge
    && !final.observation.interactiveBlock && final.observation.sellerType !== "third_party"
    && final.observation.availability !== "out_of_stock") {
    diagnostic = retailerDiagnosticPayload(diagnostic, identity.retailerId, {
      outcome: "failed", failureStage: "fulfillment_binding",
      reasonCode: shippingSelection.reason === "fulfillment_selection_failed"
        ? "fulfillment_selection_failed" : "fulfillment_unverified"
    });
  }
  await captureTabEvidenceCapsule(tab.id, diagnostic, { trace: final.trace || [] }).catch(() => null);
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
    recipeTrial,
    ...(shippingSelection ? { shippingSelection } : {})
  };
}

async function saveCurrentPageForRepair(tabId = null) {
  if (RUNTIME_CONFIG.profile !== "local") {
    throw new Error("Page snapshots for store repairs are available only with the local companion.");
  }
  const device = await storedDevice();
  if (!device?.id || !device?.token) throw new Error("Pair this Chrome companion before saving a page snapshot.");
  const tab = await operationTab(tabId);
  const identity = await retailerTabIdentity(tab);
  if (!identity || !Object.hasOwn(RETAILER_ORIGINS, identity.retailerId) && identity.retailerId !== "target") {
    throw new Error("Open a supported product page and try again.");
  }
  const origins = identity.retailerId === "target" ? TARGET_ORIGINS : RETAILER_ORIGINS[identity.retailerId];
  if (!origins || !await chrome.permissions.contains({ origins })) {
    throw new Error(`Allow ${identity.retailerId} page access, then try again.`);
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "ISOLATED",
    files: [identity.retailerId === "target" ? "target-shadow.js" : "retailer-shadow.js"]
  });
  const injections = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "ISOLATED",
    args: [identity.retailerId, RUNTIME_CONFIG.profile === "local"],
    func: (retailerId, collectTrace) => {
      try {
        const observer = retailerId === "target" ? globalThis.YoinkTargetShadow : globalThis.YoinkRetailerShadow;
        const environment = collectTrace ? { trace: { record() {} } } : undefined;
        const result = retailerId === "target"
          ? observer?.collectTargetShadowAttempt?.(document, location.href, "shipping", 1, false, environment)
          : observer?.collectRetailerShadowAttempt?.(document, location.href, retailerId, "shipping", 1, false, environment);
        return result ? { ok: true, ...result } : { ok: false, message: "The store observer is unavailable." };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "The page could not be inspected." };
      }
    }
  });
  const result = injections.find((entry) => entry.frameId === 0)?.result;
  if (!result?.ok || !result.diagnostic) throw new Error(result?.message || "The page could not be inspected.");
  const diagnostic = retailerDiagnosticPayload(result.diagnostic, identity.retailerId);
  const capsule = await captureTabEvidenceCapsule(tab.id, diagnostic, {
    manual: true,
    trace: result.trace || []
  });
  if (!capsule) throw new Error("The page snapshot could not be saved.");
  return { saved: true, capsuleId: capsule.id, state: await checkHealth() };
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
  // Only the last minute matters for the rate limit, so keep just the recent
  // entries (bounded) instead of one key per product forever.
  const recordedAt = Date.now();
  const recentTimes = Object.entries(contributionTimes)
    .filter(([key, value]) => key !== rateKey && Number.isFinite(Number(value))
      && recordedAt - Number(value) < COMMUNITY_CONTRIBUTION_INTERVAL_MS)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, 199);
  await chrome.storage.local.set({
    [COMMUNITY_CONTRIBUTION_TIMES_KEY]: Object.fromEntries([...recentTimes, [rateKey, recordedAt]])
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

// Store checks and page reads run in background tabs, where Best Buy never
// draws its Shipping choices; they keep the short wait. A live add waits up
// to 8 s while the choices are still loading.
async function selectBestBuyShippingTab(tabId, expectedSku) {
  try {
    await injectAddAction(tabId, "bestbuy");
    return await executeAddAction(tabId, "bestbuy", "selectBestBuyShipping", [expectedSku, null, { loadingTimeoutMs: 3_000 }]);
  } catch {
    return { ok: false, reason: "fulfillment_selection_failed", selectionClicked: false };
  }
}

async function injectAddAction(tabId, retailerId) {
  const lane = ADD_LANES[retailerId];
  if (!lane) throw new Error("The retailer add runner is unavailable.");
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    ...(retailerId === "bestbuy" ? { injectImmediately: true } : {}),
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
    ...(retailerId === "bestbuy" && operation === "inspectBestBuyPostAdd" ? { injectImmediately: true } : {}),
    func: async (operationName, operationArgs, globalName) => {
      try {
        const runner = globalThis[globalName];
        const method = runner?.[operationName];
        if (typeof method !== "function") return { ok: false, reason: "runner_unavailable" };
        return await method(document, location.href, ...(operationArgs || []));
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
      let inFlight = false;
      let lastResult = { ok: false, reason: "cart_unverified" };
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
      const inspect = async () => {
        if (finished || inFlight) return;
        inFlight = true;
        let result;
        try {
          result = await method(document, location.href, ...(operationArgs || []));
        } catch {
          result = { ok: false, reason: "runner_failed" };
        }
        inFlight = false;
        if (finished) return;
        if (!result || typeof result !== "object") result = { ok: false, reason: "runner_no_result" };
        lastResult = result;
        const retryable = result.ok !== true && transientReasons.has(String(result.reason || ""));
        if (!retryable) finish(result);
      };
      const inspectAfterMutation = () => {
        if (finished || mutationTimer) return;
        mutationTimer = setTimeout(() => {
          mutationTimer = undefined;
          void inspect();
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
      fallbackTimer = setInterval(() => { void inspect(); }, fallbackMs);
      deadlineTimer = setTimeout(() => {
        // A pending cart request cannot extend this operation's deadline or
        // cause overlapping reads. Late completions have no effect.
        finish(lastResult);
      }, waitMs);
      void inspect();
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

// The store's page is judged when it has settled, not at the first "complete":
// a buy box that is still loading reads as no Add button, no price or no
// seller. Prepare runs again on each quiet DOM change (and every 400 ms) until
// it passes, a non-transient reason comes back, or the bound runs out. Each
// run re-verifies the whole page; only the passing run's authorization is used.
const PREPARE_SETTLE_MAX_MS = 6_000;
const PREPARE_SETTLE_QUIET_MS = 120;
const PREPARE_SETTLE_FALLBACK_MS = 400;
const PREPARE_TRANSIENT_REASONS = Object.freeze([
  "out_of_stock", "stock_unverified", "add_control_unavailable", "price_unavailable", "seller_unverified",
  "fulfillment_unverified", "desired_variant_unverified", "offer_unverified", "offer_id_missing_or_ambiguous",
  // Amazon updates its hidden quantity field a moment after the dropdown changes.
  "quantity_unverified"
]);

async function executePreparedAddAction(tabId, retailerId, args = [], timeoutMs = PREPARE_SETTLE_MAX_MS) {
  const lane = ADD_LANES[retailerId];
  if (!lane) return { ok: false, reason: "runner_unavailable" };
  const injections = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: (operationName, operationArgs, globalName, waitMs, quietMs, fallbackMs, transient) => new Promise((resolve) => {
      const runner = globalThis[globalName];
      const method = runner?.[operationName];
      if (typeof method !== "function") {
        resolve({ ok: false, reason: "runner_unavailable" });
        return;
      }
      const transientReasons = new Set(transient);
      const startedAt = Date.now();
      let attempts = 0;
      let finished = false;
      let inFlight = false;
      let lastResult = { ok: false, reason: "offer_unverified" };
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
        resolve({ ...result, prepareAttempts: attempts, prepareMs: Date.now() - startedAt });
      };
      const inspect = async () => {
        if (finished || inFlight) return;
        inFlight = true;
        attempts += 1;
        let result;
        try {
          result = await method(document, location.href, ...(operationArgs || []));
        } catch {
          result = { ok: false, reason: "runner_failed" };
        }
        inFlight = false;
        if (finished) return;
        if (!result || typeof result !== "object") result = { ok: false, reason: "runner_no_result" };
        lastResult = result;
        if (result.ok === true || !transientReasons.has(String(result.reason || ""))) finish(result);
      };
      const inspectAfterMutation = () => {
        if (finished || mutationTimer) return;
        mutationTimer = setTimeout(() => {
          mutationTimer = undefined;
          void inspect();
        }, quietMs);
      };
      try {
        observer = new MutationObserver(inspectAfterMutation);
        observer.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, characterData: true });
      } catch {
        observer = null;
      }
      fallbackTimer = setInterval(() => { void inspect(); }, fallbackMs);
      deadlineTimer = setTimeout(() => { finish(lastResult); }, waitMs);
      void inspect();
    }),
    args: [
      lane.prepareOperation,
      args,
      lane.runnerGlobal,
      Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 10_000 ? timeoutMs : PREPARE_SETTLE_MAX_MS,
      PREPARE_SETTLE_QUIET_MS,
      PREPARE_SETTLE_FALLBACK_MS,
      [...PREPARE_TRANSIENT_REASONS]
    ]
  });
  return injections.find((entry) => entry.frameId === 0)?.result || { ok: false, reason: "runner_no_result" };
}

function safeReasonCode(value) {
  const reason = String(value || "rehearsal_failed").toLowerCase();
  return /^[a-z][a-z0-9_]{1,79}$/.test(reason) ? reason : "rehearsal_failed";
}

function addRehearsalGuidance(lane, observation) {
  const guidance = lane.rehearsalGuidance;
  if (["high_demand", "queue"].includes(observation?.interactiveBlock) && guidance.highDemand) {
    return guidance.highDemand;
  }
  if (observation?.securityChallenge && guidance.securityChallenge) return guidance.securityChallenge;
  if (observation?.interactiveBlock === "auth" && guidance.auth) return guidance.auth;
  if (observation?.interactiveBlock === "mfa" && guidance.mfa) return guidance.mfa;
  if (observation?.interactiveBlock === "location" && guidance.location) return guidance.location;
  if (observation?.fulfillment === "pickup" && guidance.pickup) return guidance.pickup;
  return guidance.default;
}

function addRehearsalJob(lane, observation) {
  const price = Number(observation?.unitPriceCents);
  const validSku = new RegExp(lane.skuPattern).test(String(observation?.retailerSku || ""));
  const exactRouteReady = lane.rehearsalPolicy !== "first_party_exact_route"
    || observation?.purchaseRouteReady === true;
  if (!observation?.id
    || observation.retailerId !== lane.id
    || !validSku
    || !["in_stock", "preorder"].includes(observation.availability)
    || observation.addControlActionable !== true
    || Boolean(observation.securityChallenge || observation.interactiveBlock)
    || !Number.isSafeInteger(price)
    || price <= 0
    || observation.fulfillment !== "shipping"
    || observation.sellerType !== "first_party"
    || observation.sellerName !== lane.firstPartySeller
    || !exactRouteReady) {
    throw new Error(addRehearsalGuidance(lane, observation));
  }
  return {
    adapterVersion: lane.contractVersion,
    contractVersion: 1,
    jobId: `rehearsal_${String(observation.id).slice(0, 100)}`,
    validationMode: "rehearsal",
    retailerId: lane.id,
    retailerSku: String(observation.retailerSku),
    canonicalUrl: String(observation.canonicalUrl),
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: price,
    maxOrderTotalCents: price,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: lane.firstPartySeller,
    fulfillment: "shipping",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
}

const ADD_REHEARSAL_POLICY_HOOKS = Object.freeze({
  first_party_shipping: Object.freeze({ resultFailureStage: runnerFailureStage }),
  first_party_exact_route: Object.freeze({ resultFailureStage: () => "runner" })
});

function addRehearsalBuildFailure(inspection) {
  const observation = inspection?.observation || {};
  if (inspection?.shippingSelection?.ok === false && inspection?.diagnostic
    && !["passed", "recovered"].includes(inspection.diagnostic.outcome)) {
    return {
      outcome: inspection.diagnostic.outcome,
      failureStage: inspection.diagnostic.failureStage,
      reasonCode: inspection.diagnostic.reasonCode
    };
  }
  const interactive = Boolean(observation.securityChallenge || observation.interactiveBlock);
  // Unknown means the observer could not prove availability, not sold out.
  const unavailable = observation.availability === "out_of_stock";
  const thirdParty = observation.sellerType === "third_party";
  const unsupportedFulfillment = observation.fulfillment === "pickup";
  const expectedStop = interactive || unavailable || thirdParty || unsupportedFulfillment;
  const reasonCode = interactive
    ? "manual_action_required"
    : unavailable
      ? "out_of_stock"
      : thirdParty
        ? "third_party_seller"
        : unsupportedFulfillment
          ? "fulfillment_not_supported"
          : safeReasonCode(inspection?.diagnostic?.reasonCode || observation.routeReasonCode || "offer_not_actionable");
  return {
    outcome: expectedStop ? "rejected" : "failed",
    failureStage: interactive ? "interactive_block"
      : expectedStop ? "policy" : inspection?.diagnostic?.failureStage || "runner",
    reasonCode
  };
}

async function rehearseAddTab(retailerId, existingInspection = null, tabId = null) {
  const lane = ADD_LANES[retailerId];
  const policy = ADD_REHEARSAL_POLICY_HOOKS[lane?.rehearsalPolicy];
  if (!lane || !policy) throw new Error("The retailer add runner is unavailable.");
  const inspection = existingInspection || (retailerId === "target"
    ? await inspectTargetTab(tabId)
    : await inspectRetailerTab(tabId));
  const observation = inspection.observation;
  const device = await storedDevice();
  if (!device?.token) throw new Error("Pair this Chrome companion before rehearsing " + lane.name + ".");
  // A rehearsal re-injects the runner, which would drop the authorization a
  // real add is holding in the same tab.
  if (await activeJob().catch(() => null)) {
    throw new Error("A store action is running. Try the rehearsal again when it finishes.");
  }

  let job;
  try {
    if (inspection.shippingSelection?.ok === false) {
      throw new Error(observation.securityChallenge || observation.interactiveBlock
        ? addRehearsalGuidance(lane, observation)
        : "Yoink could not verify Shipping on this Best Buy offer. Nothing was added; Pickup will not be used.");
    }
    job = addRehearsalJob(lane, observation);
  } catch (error) {
    const nonPass = addRehearsalBuildFailure(inspection);
    const operationEvidence = operationDiagnostic(
      inspection.diagnostic,
      retailerId,
      "rehearse_add",
      nonPass.outcome,
      nonPass.failureStage,
      nonPass.reasonCode
    );
    const failedTab = await operationTab(tabId).catch(() => null);
    await postOperationDiagnosticWithCapsule(
      device,
      failedTab?.id,
      operationEvidence,
      "shipping",
      inspection.trace || []
    );
    throw error;
  }

  const tab = await operationTab(tabId);
  const identity = await retailerTabIdentity(tab);
  if (!Number.isInteger(tab?.id)
    || identity?.retailerId !== retailerId
    || identity.retailerSku !== observation.retailerSku) {
    throw new Error("Keep the inspected " + lane.name + " product page active while the no-click rehearsal runs.");
  }
  await injectAddAction(tab.id, retailerId);
  const result = await executeAddAction(tab.id, retailerId, lane.operations.rehearse, [job]);
  const passed = result?.ok === true && result?.wouldClick === true;
  const reasonCode = passed ? "verified" : safeReasonCode(result?.reason);
  const manualRejection = reasonCode === "manual_action_required";
  const operationEvidence = operationDiagnostic(
    inspection.diagnostic,
    retailerId,
    "rehearse_add",
    passed ? "passed" : manualRejection ? "rejected" : "failed",
    passed ? "complete" : manualRejection ? "interactive_block" : policy.resultFailureStage(reasonCode),
    reasonCode
  );
  const [payload] = await Promise.all([
    request("/devices/self/qualification-trials/" + lane.trialRouteSlug, {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({
        adapterVersion: lane.contractVersion,
        observerVersion: lane.observerVersion,
        packVersion: lane.packVersion,
        contractVersion: 1,
        shadowObservationId: observation.id,
        observedAt: new Date().toISOString(),
        outcome: passed ? "passed" : "rejected",
        reasonCode
      })
    }, EVIDENCE_REQUEST_TIMEOUT_MS),
    postOperationDiagnosticWithCapsule(device, tab.id, operationEvidence, "shipping", inspection.trace || [])
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
  const identity = await retailerTabIdentity(tab);
  if (!identity || !["product", "product_link"].includes(popupPage.kind)
    || popupPage.retailerId !== identity.retailerId
    || (popupPage.kind === "product" && popupPage.sku !== identity.retailerSku)) {
    throw new Error("Open an exact supported retailer product page first.");
  }
  void captureListingBarcode(tab?.id, identity.retailerId, identity.retailerSku).catch(() => null);
  const inspection = identity.retailerId === "target"
    ? await inspectTargetTab(tab?.id)
    : await inspectRetailerTab(tab?.id);
  if (inspection.observation?.retailerSku !== identity.retailerSku) {
    throw new Error("The product changed during inspection. Inspect the current page again.");
  }
  if (!ADD_LANES[identity.retailerId]) {
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
      ...await rehearseAddTab(identity.retailerId, inspection, tab?.id),
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

function markedQualificationLaunch(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.hash !== `#${QUALIFICATION_LAUNCH_HASH}`) return null;
    return canonicalRetailerIdentity(url.href);
  } catch {
    return null;
  }
}

async function clearQualificationLaunchMarker(tabId, identity) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: [identity.canonicalUrl, QUALIFICATION_LAUNCH_HASH],
    func: (canonicalUrl, marker) => {
      if (location.hash === `#${marker}`) history.replaceState(null, "", canonicalUrl);
    }
  }).catch(() => undefined);
}

function scheduleMarkedQualification(tabId, value) {
  const identity = markedQualificationLaunch(value);
  if (!Number.isInteger(tabId) || !identity || !ADD_LANES[identity.retailerId]) return false;
  const key = `${identity.retailerId}:${identity.retailerSku}`;
  if (qualificationLaunchTabs.get(tabId) === key) return false;
  qualificationLaunchTabs.set(tabId, key);
  const run = qualificationLaunchQueue.then(async () => {
    await clearQualificationLaunchMarker(tabId, identity);
    try {
      const result = await inspectAndQualifyActiveTab(tabId);
      void chrome.runtime.sendMessage({
        type: "yoink:auto-qualification-result",
        retailerId: identity.retailerId,
        retailerSku: identity.retailerSku,
        ok: result?.rehearsal?.ok === true,
        reasonCode: safeReasonCode(result?.rehearsal?.reason || result?.diagnostic?.reasonCode || "verified")
      }).catch(() => undefined);
    } catch {
      void chrome.runtime.sendMessage({
        type: "yoink:auto-qualification-result",
        retailerId: identity.retailerId,
        retailerSku: identity.retailerSku,
        ok: false,
        reasonCode: "inspection_failed"
      }).catch(() => undefined);
    }
  });
  qualificationLaunchQueue = run.catch(() => undefined);
  return true;
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

const REVERIFICATION_OUTCOMES = new Set([
  "passed", "partial", "blocked", "missing_candidate", "access_missing", "parked", "error", "skipped"
]);
const REVERIFICATION_TRIGGERS = new Set(["scheduled", "plan_changed", "manual", "settings_enabled"]);
const REVERIFICATION_STATES = new Set(["running", "complete", "partial", "error"]);

function normalizedLastAutomaticRun(value) {
  if (!value || typeof value !== "object") return null;
  const outcome = String(value.outcome || "");
  if (!REVERIFICATION_OUTCOMES.has(outcome)) return null;
  return {
    runId: String(value.runId || "").slice(0, 80),
    outcome,
    reasonCode: safeReasonCode(value.reasonCode || outcome),
    attemptedProductCount: Math.max(0, Math.min(MAX_REVERIFICATION_CANDIDATES_PER_LANE,
      Math.floor(Number(value.attemptedProductCount) || 0))),
    passedProductCount: Math.max(0, Math.min(MAX_REVERIFICATION_CANDIDATES_PER_LANE,
      Math.floor(Number(value.passedProductCount) || 0))),
    finishedAt: String(value.finishedAt || "").slice(0, 40),
    extensionVersion: String(value.extensionVersion || "").slice(0, 40)
  };
}

function normalizedReverificationPlan(value) {
  const lanes = [];
  for (const item of Array.isArray(value?.lanes) ? value.lanes.slice(0, Object.keys(ADD_LANES).length) : []) {
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
    const signedInState = String(item?.session?.signedInState || "");
    lanes.push({
      retailerId,
      expectedAdapterVersion: String(item.expectedAdapterVersion || "").slice(0, 80),
      expectedObserverVersion: String(item.expectedObserverVersion || "").slice(0, 80),
      qualification: {
        status: ["qualified", "suspended", "retired", "missing"].includes(String(item.qualification?.status || ""))
          ? String(item.qualification.status) : "missing",
        warning: ["none", "expiring", "expired", "version_changed"].includes(String(item.qualification?.warning || ""))
          ? String(item.qualification.warning) : "none",
        expiresAt: String(item.qualification?.expiresAt || "").slice(0, 40)
      },
      session: {
        signedInState: ["unknown", "ready", "signed_out", "challenged"].includes(signedInState) ? signedInState : "unknown"
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
      automaticCheckNeeded: item?.automaticCheckNeeded === true,
      degraded: item?.degraded === true,
      degradedReasons: (Array.isArray(item?.degradedReasons) ? item.degradedReasons : [])
        .slice(0, 4).map((reason) => safeReasonCode(reason)),
      blockedReason: ["no_purchasable_candidate", "no_candidate"].includes(String(item?.blockedReason || ""))
        ? String(item.blockedReason) : "",
      lastAutomaticRun: normalizedLastAutomaticRun(item?.lastAutomaticRun),
      consecutiveNonPassingRuns: Math.max(0, Math.min(1_000, Math.floor(Number(item?.consecutiveNonPassingRuns) || 0)))
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

// The trigger signature carries only the material that should start a new
// bounded replay: packaged versions, lane status, and which exact products
// are queued for repair. Evidence freshness bits are deliberately excluded so
// a run cannot re-arm itself by posting the evidence it just collected.
function reverificationPlanSignature(plan) {
  const laneMaterial = (plan?.lanes || []).map((lane) => [
    lane.retailerId,
    lane.expectedAdapterVersion,
    lane.expectedObserverVersion,
    ADAPTER_VERSIONS.pack[lane.retailerId] || "",
    lane.qualification.status,
    lane.qualification.warning,
    lane.automaticCheckNeeded ? "needed" : "steady",
    lane.degraded ? "degraded" : "healthy",
    lane.blockedReason || "unblocked",
    lane.candidates
      .filter((candidate) => candidate.repairableObserverFailure)
      .map((candidate) => candidate.retailerSku)
      .sort()
      .join(",")
  ].join("|")).join(";");
  const material = `${EXTENSION_VERSION}|${laneMaterial}`;
  let hash = 2166136261;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `reverification-plan-v3:${material.length}:${hash.toString(16).padStart(8, "0")}`;
}

async function readAutoReverificationSettings() {
  const stored = await chrome.storage.local.get(AUTO_REVERIFICATION_SETTINGS_KEY);
  return normalizedAutoReverificationSettings(stored[AUTO_REVERIFICATION_SETTINGS_KEY]);
}

async function setAutoReverificationEnabled(enabled) {
  const settings = { schemaVersion: 1, enabled: enabled === true };
  await chrome.storage.local.set({ [AUTO_REVERIFICATION_SETTINGS_KEY]: settings });
  if (settings.enabled) void runAutomaticReverification(false, "settings_enabled").catch(() => undefined);
  return { settings };
}

function normalizedReverificationResult(value) {
  const retailerId = String(value?.retailerId || "").slice(0, 40);
  if (!retailerId) return null;
  return {
    retailerId,
    retailerSku: String(value?.retailerSku || "").slice(0, 80),
    outcome: REVERIFICATION_OUTCOMES.has(value?.outcome) ? value.outcome : "error",
    reasonCode: safeReasonCode(value?.reasonCode || value?.outcome),
    attemptedProductCount: Math.max(0, Math.min(MAX_REVERIFICATION_CANDIDATES_PER_LANE,
      Math.floor(Number(value?.attemptedProductCount) || 0))),
    passedProductCount: Math.max(0, Math.min(MAX_REVERIFICATION_CANDIDATES_PER_LANE,
      Math.floor(Number(value?.passedProductCount) || 0)))
  };
}

function boundedLaneCounter(value) {
  const counters = {};
  for (const [retailerId, count] of Object.entries(value && typeof value === "object" ? value : {})) {
    if (!ADD_LANES[retailerId]) continue;
    counters[retailerId] = Math.max(0, Math.min(1_000, Math.floor(Number(count) || 0)));
  }
  return counters;
}

function boundedLaneOutcomes(value) {
  const outcomes = {};
  for (const [retailerId, entry] of Object.entries(value && typeof value === "object" ? value : {})) {
    if (!ADD_LANES[retailerId] || !REVERIFICATION_OUTCOMES.has(entry?.outcome)) continue;
    outcomes[retailerId] = {
      outcome: entry.outcome,
      reasonCode: safeReasonCode(entry.reasonCode || entry.outcome),
      at: String(entry.at || "").slice(0, 40)
    };
  }
  return outcomes;
}

function normalizedReverificationState(value) {
  if (!value || typeof value !== "object") return null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(value.automaticRunsToday?.day || ""))
    ? String(value.automaticRunsToday.day) : "";
  return {
    schemaVersion: 2,
    state: REVERIFICATION_STATES.has(value.state) ? value.state : "error",
    results: (Array.isArray(value.results) ? value.results : []).slice(0, Object.keys(ADD_LANES).length)
      .map(normalizedReverificationResult).filter(Boolean),
    automatic: value.automatic === true,
    trigger: REVERIFICATION_TRIGGERS.has(value.trigger) ? value.trigger : (value.automatic === true ? "scheduled" : "manual"),
    runId: /^[A-Za-z0-9_-]{8,80}$/.test(String(value.runId || "")) ? String(value.runId) : "",
    planSignature: String(value.planSignature || "").slice(0, 200),
    reasonCode: value.reasonCode ? safeReasonCode(value.reasonCode) : "",
    laneIndex: Math.max(0, Math.min(3, Math.floor(Number(value.laneIndex) || 0))),
    candidateIndex: Math.max(0, Math.min(MAX_REVERIFICATION_CANDIDATES_PER_LANE, Math.floor(Number(value.candidateIndex) || 0))),
    consecutiveNonPassingRuns: boundedLaneCounter(value.consecutiveNonPassingRuns),
    laneOutcomes: boundedLaneOutcomes(value.laneOutcomes),
    lastRunAt: String(value.lastRunAt || value.updatedAt || "").slice(0, 40),
    lastAutomaticRunAt: String(value.lastAutomaticRunAt || (value.automatic === true ? value.updatedAt : "") || "").slice(0, 40),
    automaticRunsToday: { day, count: day ? Math.max(0, Math.min(1_000, Math.floor(Number(value.automaticRunsToday?.count) || 0))) : 0 },
    startedAt: String(value.startedAt || "").slice(0, 40),
    updatedAt: String(value.updatedAt || "").slice(0, 40)
  };
}

async function readReverificationState() {
  const stored = await chrome.storage.local.get(REVERIFICATION_STATE_KEY);
  return normalizedReverificationState(stored[REVERIFICATION_STATE_KEY]);
}

async function persistReverificationRun(run) {
  run.updatedAt = new Date().toISOString();
  const value = normalizedReverificationState(run);
  await chrome.storage.local.set({ [REVERIFICATION_STATE_KEY]: value });
  return value;
}

function newReverificationRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function laneBackoffMs(state, retailerId) {
  const last = state?.laneOutcomes?.[retailerId];
  if (!last) return 0;
  if (last.outcome === "passed") return AUTO_REVERIFICATION_PASS_BACKOFF_MS;
  if (["parked", "access_missing", "skipped", "missing_candidate"].includes(last.outcome)) {
    return AUTO_REVERIFICATION_COOLDOWN_MS;
  }
  const failures = Math.max(1, Number(state?.consecutiveNonPassingRuns?.[retailerId]) || 1);
  return AUTO_REVERIFICATION_FAILURE_BACKOFF_MS[Math.min(failures, AUTO_REVERIFICATION_FAILURE_BACKOFF_MS.length) - 1];
}

function automaticCheckPolicy() {
  return {
    schemaVersion: 1,
    dailyRunLimit: AUTO_REVERIFICATION_DAILY_CAP,
    dayBoundary: "UTC",
    firstRunDelayMinutes: AUTO_REVERIFICATION_FIRST_RUN_DELAY_MINUTES,
    attentionPeriodMinutes: AUTO_REVERIFICATION_ATTENTION_PERIOD_MINUTES,
    steadyPeriodMinutes: AUTO_REVERIFICATION_PERIOD_MINUTES,
    passBackoffMs: AUTO_REVERIFICATION_PASS_BACKOFF_MS,
    failureBackoffMs: [...AUTO_REVERIFICATION_FAILURE_BACKOFF_MS],
    helpBackoffMs: AUTO_REVERIFICATION_COOLDOWN_MS
  };
}

// The runner and Settings use this same decision. One store's later run must
// not move another store's backoff; old persisted records retain a fallback.
function automaticCheckDecision(settings, stored, plan, now = Date.now(), force = false) {
  const planSignature = plan ? reverificationPlanSignature(plan) : "";
  const planChanged = Boolean(plan && stored?.planSignature !== planSignature);
  const today = new Date(now).toISOString().slice(0, 10);
  const runsToday = stored?.automaticRunsToday?.day === today ? stored.automaticRunsToday.count : 0;
  const resetAt = new Date(`${today}T00:00:00.000Z`).getTime() + 24 * 60 * 60_000;
  const capped = !force && runsToday >= AUTO_REVERIFICATION_DAILY_CAP;
  const enabled = settings.enabled || force;
  const lanes = (plan?.lanes || []).map((lane) => {
    const last = stored?.laneOutcomes?.[lane.retailerId];
    const ownLastAt = Date.parse(last?.at || "");
    const lastAt = Number.isFinite(ownLastAt) ? ownLastAt : Date.parse(stored?.lastRunAt || "");
    const backoffUntil = !force && !planChanged && Number.isFinite(lastAt)
      ? lastAt + laneBackoffMs(stored, lane.retailerId) : now;
    const blockedReason = lane.blockedReason || (!lane.candidates?.length ? "qualification_candidate_missing" : "");
    const needed = lane.automaticCheckNeeded && !blockedReason;
    const eligibleAt = enabled && needed ? Math.max(now, backoffUntil, capped ? resetAt : now) : null;
    return {
      retailerId: lane.retailerId,
      state: !enabled ? "off" : !lane.automaticCheckNeeded ? "current"
        : blockedReason ? "blocked" : eligibleAt > now ? "waiting" : "eligible",
      reasonCode: blockedReason || (capped ? "automatic_check_daily_cap"
        : backoffUntil > now ? last?.reasonCode || "automatic_check_cooldown" : ""),
      lastCheckedAt: Number.isFinite(lastAt) && (last || stored?.results?.some(result => result.retailerId === lane.retailerId))
        ? new Date(lastAt).toISOString() : "",
      lastOutcome: last?.outcome || "",
      cooldownUntil: needed && backoffUntil > now ? new Date(backoffUntil).toISOString() : "",
      eligibleAt: eligibleAt === null ? null : new Date(eligibleAt).toISOString(),
      needed: Boolean(needed),
      cooldownEligible: Boolean(needed && backoffUntil <= now)
    };
  });
  const needed = lanes.filter(lane => lane.needed);
  const eligible = needed.filter(lane => lane.cooldownEligible);
  const reason = !enabled ? "automatic_checks_disabled" : !plan ? "plan_unavailable"
    : !needed.length ? lanes.some(lane => lane.state === "blocked") ? "store_checks_blocked" : "no_store_checks_needed" : !eligible.length ? "automatic_check_cooldown"
      : capped ? "automatic_check_daily_cap" : "ready";
  const times = lanes.flatMap(lane => lane.eligibleAt ? [Date.parse(lane.eligibleAt)] : []);
  return {
    schemaVersion: 1, computedAt: new Date(now).toISOString(), enabled: Boolean(settings.enabled),
    reason, planSignature, planChanged, runsToday, resetAt: new Date(resetAt).toISOString(),
    nextEligibleAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    eligibleRetailerIds: eligible.map(lane => lane.retailerId),
    neededRetailerIds: needed.map(lane => lane.retailerId),
    lanes
  };
}

function adapterVersionNumber(value) {
  const match = /-v(\d+)$/.exec(String(value || ""));
  return match ? Number(match[1]) : Number.NaN;
}

// The plan tells the companion which packaged contracts the app expects. A
// mismatch means every evidence post would be rejected, so the lane is
// skipped with a reason the settings page can turn into an update prompt.
function laneVersionSkew(lane) {
  const packaged = [
    [lane.expectedAdapterVersion, ADD_LANES[lane.retailerId]?.adapterVersion || ""],
    [lane.expectedObserverVersion, observerVersionForRetailer(lane.retailerId) || ""]
  ];
  for (const [expected, installed] of packaged) {
    if (!expected || expected === installed) continue;
    const expectedNumber = adapterVersionNumber(expected);
    const installedNumber = adapterVersionNumber(installed);
    return Number.isFinite(expectedNumber) && Number.isFinite(installedNumber) && installedNumber < expectedNumber
      ? "companion_update_required"
      : "app_update_required";
  }
  return "";
}

async function rememberReverificationTab(tabId, retailerId, retailerSku) {
  await chrome.storage.session.set({
    [REVERIFICATION_TAB_KEY]: {
      schemaVersion: 1,
      tabId,
      retailerId,
      retailerSku,
      openedAt: new Date().toISOString()
    }
  }).catch(() => undefined);
}

async function forgetReverificationTab() {
  await chrome.storage.session.remove(REVERIFICATION_TAB_KEY).catch(() => undefined);
}

// A recycled service worker loses its in-memory run. Close the tab it left
// behind and turn the stale "running" record into a terminal error so the
// backoff logic, not the stale record, decides when the next replay starts.
async function reconcileReverificationRestart() {
  const stored = (await chrome.storage.session.get(REVERIFICATION_TAB_KEY).catch(() => ({})))[REVERIFICATION_TAB_KEY];
  if (Number.isInteger(stored?.tabId)) await chrome.tabs.remove(stored.tabId).catch(() => undefined);
  await forgetReverificationTab();
  const state = await readReverificationState();
  if (state?.state === "running") {
    await persistReverificationRun({ ...state, state: "error", reasonCode: "worker_restarted" });
  }
}

async function postReverificationRunReceipt(device, run, result, startedAt) {
  if (!device?.token) return null;
  try {
    return await request("/devices/self/readiness/reverification-runs", {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({
        contractVersion: 1,
        runId: run.runId,
        retailerId: result.retailerId,
        automatic: run.automatic === true,
        trigger: run.trigger,
        outcome: result.outcome,
        reasonCode: result.reasonCode,
        attemptedProductCount: result.attemptedProductCount,
        passedProductCount: result.passedProductCount,
        startedAt,
        finishedAt: new Date().toISOString(),
        extensionVersion: EXTENSION_VERSION,
        planSignature: String(run.planSignature || "").slice(0, 200)
      })
    }, EVIDENCE_REQUEST_TIMEOUT_MS);
  } catch {
    // Receipts are operator telemetry; they never change the local outcome.
    return null;
  }
}

function bumpAutomaticRunsToday(previous, startedAt) {
  const day = startedAt.slice(0, 10);
  return { day, count: (previous?.day === day ? previous.count : 0) + 1 };
}

async function performRetailerReverification(retailerIds = [], metadata = {}) {
  if (await activeJob().catch(() => null)) {
    throw new Error("Wait for the current cart action to finish before checking stores again.");
  }
  const requested = [...new Set((Array.isArray(retailerIds) ? retailerIds : [])
    .map((value) => String(value || "")).filter((value) => ADD_LANES[value]))].slice(0, Object.keys(ADD_LANES).length);
  if (!requested.length) throw new Error("Choose at least one supported store to check again.");
  const device = await storedDevice();
  let plan = metadata.plan?.lanes ? metadata.plan : await getReverificationPlan();
  const previous = await readReverificationState();
  const automatic = metadata.automatic === true;
  const startedAt = new Date().toISOString();
  const run = {
    schemaVersion: 2,
    state: "running",
    results: [],
    automatic,
    trigger: REVERIFICATION_TRIGGERS.has(metadata.trigger) ? metadata.trigger : automatic ? "scheduled" : "manual",
    runId: newReverificationRunId(),
    planSignature: metadata.planSignature || reverificationPlanSignature(plan),
    reasonCode: "",
    laneIndex: 0,
    candidateIndex: 0,
    consecutiveNonPassingRuns: { ...(previous?.consecutiveNonPassingRuns || {}) },
    laneOutcomes: { ...(previous?.laneOutcomes || {}) },
    lastRunAt: startedAt,
    lastAutomaticRunAt: automatic ? startedAt : (previous?.lastAutomaticRunAt || ""),
    automaticRunsToday: automatic
      ? bumpAutomaticRunsToday(previous?.automaticRunsToday, startedAt)
      : (previous?.automaticRunsToday || { day: "", count: 0 }),
    startedAt,
    updatedAt: startedAt
  };
  await persistReverificationRun(run);
  const recordLaneResult = async (result, laneStartedAt) => {
    const normalized = normalizedReverificationResult(result);
    run.results.push(normalized);
    if (normalized.outcome === "passed") {
      run.consecutiveNonPassingRuns[normalized.retailerId] = 0;
    } else if (["partial", "blocked", "error"].includes(normalized.outcome)) {
      run.consecutiveNonPassingRuns[normalized.retailerId] = (run.consecutiveNonPassingRuns[normalized.retailerId] || 0) + 1;
    }
    run.laneOutcomes[normalized.retailerId] = {
      outcome: normalized.outcome,
      reasonCode: normalized.reasonCode,
      at: new Date().toISOString()
    };
    await persistReverificationRun(run);
    await postReverificationRunReceipt(device, run, normalized, laneStartedAt);
  };
  let currentRetailerId = requested[0];
  let laneStartedAt = startedAt;
  let attemptedProductCount = 0;
  let passedProductCount = 0;
  try {
    for (let laneIndex = 0; laneIndex < requested.length; laneIndex += 1) {
      const retailerId = requested[laneIndex];
      currentRetailerId = retailerId;
      laneStartedAt = new Date().toISOString();
      run.laneIndex = laneIndex;
      run.candidateIndex = 0;
      attemptedProductCount = 0;
      passedProductCount = 0;
      let lane = plan.lanes.find((item) => item.retailerId === retailerId);
      const candidates = (lane?.candidates || []).slice(0, MAX_REVERIFICATION_CANDIDATES_PER_LANE);
      const skew = lane ? laneVersionSkew(lane) : "";
      if (skew) {
        await recordLaneResult({
          retailerId,
          retailerSku: "",
          outcome: "skipped",
          reasonCode: skew,
          attemptedProductCount: 0,
          passedProductCount: 0
        }, laneStartedAt);
        continue;
      }
      if (!lane || !candidates.length) {
        await recordLaneResult({
          retailerId,
          retailerSku: "",
          outcome: "missing_candidate",
          reasonCode: "qualification_candidate_missing",
          attemptedProductCount: 0,
          passedProductCount: 0
        }, laneStartedAt);
        continue;
      }
      const origins = retailerId === "target" ? TARGET_ORIGINS : RETAILER_ORIGINS[retailerId];
      if (!origins || !await chrome.permissions.contains({ origins })) {
        await recordLaneResult({
          retailerId,
          retailerSku: lane.candidate?.retailerSku || "",
          outcome: "access_missing",
          reasonCode: "retailer_access_missing",
          attemptedProductCount: 0,
          passedProductCount: 0
        }, laneStartedAt);
        continue;
      }
      if (lane.session.signedInState === "signed_out" || lane.session.signedInState === "challenged") {
        await recordLaneResult({
          retailerId,
          retailerSku: lane.candidate?.retailerSku || "",
          outcome: "parked",
          reasonCode: lane.session.signedInState === "signed_out"
            ? "retailer_session_signed_out" : "retailer_session_challenged",
          attemptedProductCount: 0,
          passedProductCount: 0
        }, laneStartedAt);
        continue;
      }
      let lastRetailerSku = lane.candidate?.retailerSku || "";
      let lastReasonCode = "qualification_candidate_exhausted";
      let parkedReason = "";
      let skewReason = "";
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        const candidate = candidates[candidateIndex];
        run.candidateIndex = candidateIndex;
        if (await activeJob().catch(() => null)) {
          parkedReason = "action_job_active";
          lastReasonCode = parkedReason;
          break;
        }
        let tabId = null;
        lastRetailerSku = candidate.retailerSku;
        attemptedProductCount += 1;
        try {
          const tab = await chrome.tabs.create({ url: candidate.canonicalUrl, active: false });
          if (!Number.isInteger(tab?.id)) throw new Error("qualification_tab_unavailable");
          tabId = tab.id;
          await rememberReverificationTab(tabId, retailerId, candidate.retailerSku);
          let reachable = true;
          try {
            await waitForExactProductTab(tabId, retailerId, candidate.retailerSku, REVERIFICATION_TAB_WAIT_MS);
          } catch {
            reachable = false;
          }
          if (!reachable) {
            await reportProductPageUnavailable(device, { retailerId, retailerSku: candidate.retailerSku });
            lastReasonCode = "product_page_unavailable";
            continue;
          }
          const verified = await inspectAndQualifyActiveTab(tabId);
          const passed = verified?.rehearsal?.ok === true;
          if (passed) passedProductCount += 1;
          lastReasonCode = passed
            ? "verified"
            : safeReasonCode(verified?.rehearsal?.reason || "qualification_blocked");
          if (lastReasonCode === "manual_action_required") parkedReason = lastReasonCode;
        } catch (error) {
          if (Number(error?.status) === 409 && error?.code === "adapter_version_mismatch") {
            skewReason = "adapter_version_mismatch";
            lastReasonCode = skewReason;
            break;
          }
          lastReasonCode = safeReasonCode(error instanceof Error ? error.message : "qualification_failed");
        } finally {
          if (Number.isInteger(tabId)) await chrome.tabs.remove(tabId).catch(() => undefined);
          await forgetReverificationTab();
        }
        if (parkedReason) break;
        plan = await getReverificationPlan();
        lane = plan.lanes.find((item) => item.retailerId === retailerId) || lane;
        const unresolvedRepair = lane.candidates.some((item) => item.repairableObserverFailure);
        if (!unresolvedRepair
          && lane.evidence.qualificationEvidenceReady
          && (lane.qualification.warning === "none" || passedProductCount > 0)) break;
      }
      const unresolvedRepair = lane.candidates.some((item) => item.repairableObserverFailure);
      const evidenceReady = !skewReason && !unresolvedRepair && lane.evidence.qualificationEvidenceReady
        && (lane.qualification.warning !== "expiring" || passedProductCount > 0);
      const outcome = skewReason ? "skipped"
        : evidenceReady ? "passed"
          : passedProductCount > 0 ? "partial"
            : parkedReason ? "parked"
              : "blocked";
      await recordLaneResult({
        retailerId,
        retailerSku: lastRetailerSku,
        outcome,
        reasonCode: evidenceReady ? "qualification_evidence_ready" : (skewReason || parkedReason || lastReasonCode),
        attemptedProductCount,
        passedProductCount
      }, laneStartedAt);
    }
    run.state = run.results.every((result) => result.outcome === "passed") ? "complete" : "partial";
    const persisted = await persistReverificationRun(run);
    return { plan, ...persisted };
  } catch (error) {
    run.state = "error";
    run.reasonCode = safeReasonCode(error instanceof Error ? error.message : "qualification_failed");
    await persistReverificationRun(run);
    await postReverificationRunReceipt(device, run, {
      retailerId: currentRetailerId,
      retailerSku: "",
      outcome: "error",
      reasonCode: run.reasonCode,
      attemptedProductCount,
      passedProductCount
    }, laneStartedAt);
    throw error;
  }
}

function runRetailerReverification(retailerIds = [], metadata = {}) {
  if (retailerReverificationPromise) return retailerReverificationPromise;
  retailerReverificationPromise = performRetailerReverification(retailerIds, metadata)
    .finally(() => { retailerReverificationPromise = null; });
  return retailerReverificationPromise;
}

function automaticCheckPeriodMinutes(plan) {
  const attention = Array.isArray(plan?.lanes)
    && plan.lanes.some((lane) => lane?.automaticCheckNeeded === true && !lane?.blockedReason);
  return attention ? AUTO_REVERIFICATION_ATTENTION_PERIOD_MINUTES : AUTO_REVERIFICATION_PERIOD_MINUTES;
}

async function scheduleAutomaticReverification(plan) {
  const periodInMinutes = automaticCheckPeriodMinutes(plan);
  try {
    await chrome.alarms.create(AUTO_REVERIFICATION_ALARM, { delayInMinutes: periodInMinutes, periodInMinutes });
  } catch {
    // The alarm registered at startup keeps its period.
  }
  return periodInMinutes;
}

// A held decision is still a decision. Recording it means an empty run
// history proves the loop is not firing, instead of hiding behind "nothing
// needed checking".
async function postAutomaticDecisionReceipts(lanes, reasonCode, planSignature) {
  const device = await storedDevice();
  if (!device?.token || !lanes.length) return 0;
  const now = new Date().toISOString();
  const run = { runId: newReverificationRunId(), automatic: true, trigger: "scheduled", planSignature };
  let posted = 0;
  for (const lane of lanes) {
    const receipt = await postReverificationRunReceipt(device, run, {
      retailerId: lane.retailerId,
      retailerSku: "",
      outcome: "skipped",
      reasonCode,
      attemptedProductCount: 0,
      passedProductCount: 0
    }, now);
    if (receipt) posted += 1;
  }
  return posted;
}

function runAutomaticReverification(force = false, trigger = "") {
  if (automaticReverificationPromise) return automaticReverificationPromise;
  automaticReverificationPromise = (async () => {
    const settings = await readAutoReverificationSettings();
    if (!settings.enabled && !force) return { settings, started: false, reason: "automatic_checks_disabled" };
    const stored = await readReverificationState();
    const plan = await getReverificationPlan();
    const decision = automaticCheckDecision(settings, stored, plan, Date.now(), force);
    const { planSignature, planChanged } = decision;
    if (["no_store_checks_needed", "store_checks_blocked"].includes(decision.reason)) {
      await scheduleAutomaticReverification(plan);
      return { settings, started: false, reason: decision.reason, plan };
    }
    if (decision.reason === "automatic_check_cooldown") {
      await scheduleAutomaticReverification(plan);
      await postAutomaticDecisionReceipts(plan.lanes.filter(lane => decision.neededRetailerIds.includes(lane.retailerId)), "automatic_check_cooldown", planSignature);
      return { settings, started: false, reason: "automatic_check_cooldown", state: stored, plan };
    }
    if (decision.reason === "automatic_check_daily_cap") {
      await scheduleAutomaticReverification(plan);
      await postAutomaticDecisionReceipts(plan.lanes.filter(lane => decision.eligibleRetailerIds.includes(lane.retailerId)), "automatic_check_daily_cap", planSignature);
      return { settings, started: false, reason: "automatic_check_daily_cap", state: stored, plan };
    }
    const runTrigger = REVERIFICATION_TRIGGERS.has(trigger) ? trigger
      : force ? "manual" : planChanged ? "plan_changed" : "scheduled";
    const result = await runRetailerReverification(decision.eligibleRetailerIds, {
      automatic: !force,
      trigger: runTrigger,
      planSignature,
      plan
    });
    await scheduleAutomaticReverification(result.plan || plan);
    return { settings, started: true, reason: result.state, ...result };
  })().finally(() => { automaticReverificationPromise = null; });
  return automaticReverificationPromise;
}

async function automaticReverificationStatus() {
  const [settings, state, plan, alarm] = await Promise.all([
    readAutoReverificationSettings(),
    readReverificationState(),
    getReverificationPlan().catch(() => null),
    Promise.resolve(chrome.alarms.get?.(AUTO_REVERIFICATION_ALARM)).catch(() => null)
  ]);
  return { settings, state, plan, policy: automaticCheckPolicy(), schedule: {
    ...automaticCheckDecision(settings, state, plan),
    running: Boolean(automaticReverificationPromise || retailerReverificationPromise),
    nextReviewAt: Number.isFinite(alarm?.scheduledTime) ? new Date(alarm.scheduledTime).toISOString() : null
  } };
}

async function persistPopupResult(result) {
  if (result?.schemaVersion !== 1 || !result.contextKey) return;
  await chrome.storage.session.set({ [POPUP_RESULT_STORAGE_KEY]: result }).catch(() => undefined);
}

async function inspectAndQualifyPopupOperation() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const page = PopupState.classifyPageContext(tabs[0]?.url);
  if (page.kind !== "product" && page.kind !== "product_link") throw new Error("Open an exact supported retailer product page first.");
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

function exactApprovedAmazonTest(job) {
  const a=job?.approvedTest,now=Date.now();
  return !!a && RUNTIME_CONFIG.profile==="local" && a.version===1
    && a.approvalId==="owner_approved_amazon_cart_test_20261002"
    && a.jobId==="amazon_test_20261002_B0D9ZTW7PS" && job.id===a.jobId
    && a.deviceId==="device_7d1ae7d55d5e4ddb84f7a0a2c5607b5e"
    && a.desiredVariant==="1.25-inch single cube; pack of 1; color may vary"
    && a.sourceEventId==="signal_event_6b16d83b73f04df8a34bd0c7c0a722a3" && a.sourceObservedAt==="2026-10-02T14:34:12.075Z"
    && JSON.stringify(a.exceptions)===JSON.stringify(["owner_approved_TEST_above_MSRP","owner_approved_TEST_stale_signal"])
    && a.noOrderAuthorization===true && !job.officialMsrp
    && Date.parse(a.issuedAt)<=now && Date.parse(a.issuedAt)>=Date.parse(a.sourceObservedAt)
    && Date.parse(a.expiresAt)>now && Date.parse(a.expiresAt)-Date.parse(a.issuedAt)<=300000
    && Date.parse(a.expiresAt)<=Date.parse("2026-10-03T00:00:00Z") && job.expiresAt===a.expiresAt
    && job.retailerId==="amazon" && job.retailerSku==="B0D9ZTW7PS" && job.canonicalUrl==="https://www.amazon.com/dp/B0D9ZTW7PS"
    && job.action==="add_to_cart" && job.quantity===1 && job.maxUnitPriceCents===699 && job.maxOrderTotalCents===699
    && job.currency==="USD" && job.sellerPolicy==="first_party_only" && job.expectedSeller==="Amazon.com" && job.fulfillment==="shipping";
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
    || !Number.isInteger(job.quantity)
    || job.quantity < 1
    || job.quantity > (QUANTITY_LANES.has(retailerId) ? CART_QUANTITY_MAX : 1)
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
  if(job.approvedTest && !exactApprovedAmazonTest(job))throw new Error("The exact dated Amazon TEST authorization is invalid.");
  // Retry when sold out: a later try of this job, valid until the window closes.
  const restockRetry = job.restockRetry === undefined ? null : {
    attempt: Number(job.restockRetry?.attempt),
    until: String(job.restockRetry?.until || "")
  };
  if (restockRetry && (!Number.isInteger(restockRetry.attempt) || restockRetry.attempt < 1 || restockRetry.attempt > 10
    || !Number.isFinite(Date.parse(restockRetry.until)) || Date.parse(restockRetry.until) <= Date.now())) {
    throw new Error("Yoink returned an invalid sold-out retry.");
  }
  if (["amazon", "target", "walmart", "bestbuy"].includes(retailerId) && !exactApprovedAmazonTest(job)
    && (!job.officialMsrp || job.officialMsrp.version !== 1 || job.officialMsrp.retailerId !== retailerId
      || job.officialMsrp.retailerSku !== retailerSku || !(job.officialMsrp.unitPriceCents <= job.maxUnitPriceCents)
      || !(job.maxUnitPriceCents <= job.officialMsrp.msrpCents))) {
    throw new Error("Official MSRP and exact variant authorization are missing; review this offer first.");
  }
  return {
    id: jobId,
    capabilityToken,
    retailerId,
    // A test call the shopper sent from Setup › Stores; its alerts say TEST.
    ...(job.testCall === true ? { testCall: true } : {}),
    ...(restockRetry ? { restockRetry } : {}),
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
      quantity: job.quantity,
      ...(job.officialMsrp ? { officialMsrp: job.officialMsrp } : {}),
      ...(job.approvedTest ? { approvedTest: job.approvedTest } : {}),
      ...(restockRetry ? { restockRetryUntil: restockRetry.until } : {}),
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
  const saved = (await chrome.storage.local.get(BESTBUY_POST_ADD_KEY))[BESTBUY_POST_ADD_KEY];
  if (saved?.retailerId === "bestbuy" && saved.phase === "adding" && saved.runnerJob?.jobId === saved.id) {
    const session = (await chrome.storage.session.get(BESTBUY_BROWSER_SESSION_KEY))[BESTBUY_BROWSER_SESSION_KEY];
    // Tab IDs cannot be trusted across a full browser restart. Preserve the receipt,
    // but hand off through Activity instead of touching a possibly unrelated tab.
    return session && session === saved.browserSessionId ? saved
      : { ...saved, tabId: null, verificationTabId: null, waitingTabId: null, browserRestartedAfterAdd: true };
  }
  const legacy = (await chrome.storage.session.get(LEGACY_ACTIVE_TARGET_JOB_KEY))[LEGACY_ACTIVE_TARGET_JOB_KEY] || null;
  if (!legacy) return null;
  const migrated = { ...legacy, retailerId: "target" };
  await chrome.storage.session.set({ [ACTIVE_JOB_KEY]: migrated });
  await chrome.storage.session.remove(LEGACY_ACTIVE_TARGET_JOB_KEY);
  return migrated;
}

async function saveActiveJob(value) {
  if (value?.retailerId === "bestbuy" && value.phase === "adding") {
    let session = (await chrome.storage.session.get(BESTBUY_BROWSER_SESSION_KEY))[BESTBUY_BROWSER_SESSION_KEY];
    if (!session) {
      session = crypto.randomUUID();
      await chrome.storage.session.set({ [BESTBUY_BROWSER_SESSION_KEY]: session });
    }
    // Persist before the click. Recovery never reuses this page authorization.
    await chrome.storage.local.set({
      [BESTBUY_POST_ADD_KEY]: { ...value, authorizationId: "", browserSessionId: session }
    });
  }
  await chrome.storage.session.set({ [ACTIVE_JOB_KEY]: value });
  await chrome.storage.session.remove(LEGACY_ACTIVE_TARGET_JOB_KEY);
}

async function clearActiveJob() {
  clearTimeout(bestBuyPostAddTimer);
  bestBuyPostAddTimer = null;
  await chrome.storage.local.remove(BESTBUY_POST_ADD_KEY);
  await chrome.storage.session.remove(ACTIVE_JOB_KEY);
  await chrome.storage.session.remove(LEGACY_ACTIVE_TARGET_JOB_KEY);
  await clearBestBuyWait();
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
  }, JOB_REPORT_TIMEOUT_MS);
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
  }, JOB_REPORT_TIMEOUT_MS);
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
  }, JOB_REPORT_TIMEOUT_MS);
}

// Best Buy's product pages now live at /product/<name>/<code>, a URL with no
// SKU in it (Kevin's Test call, 2026-10-11): opening an exact SKU's link can
// land there. The page is accepted as loaded; the store's runner then proves
// the SKU on the page itself before it reads the offer or clicks anything.
function bestBuyCodeOnlyProductUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password
      && (url.hostname === "bestbuy.com" || url.hostname.endsWith(".bestbuy.com"))
      && /^\/product\/[^/]+\/(?=[0-9]*[a-z])[a-z0-9]{10}\/?$/i.test(url.pathname) && !url.searchParams.has("skuId");
  } catch {
    return false;
  }
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
      return identity?.retailerId === retailerId && identity.retailerSku === expected
        || retailerId === "bestbuy" && bestBuyCodeOnlyProductUrl(tab.url);
    };
    listener = (updatedId, changeInfo, tab) => {
      if (updatedId === tabId && (changeInfo.status === "complete" || tab.status === "complete") && accepted(tab)) finish(null, tab);
    };
    // A tab that never reached the page says why when the store told it: its
    // robot check, or the product link moving to another item.
    timeout = setTimeout(() => {
      const late = () => new Error(`The ${lane?.name || "retailer"} tab did not finish loading in time.`);
      chrome.tabs.get(tabId)
        .then((tab) => {
          const reason = storeStopReason(tab, retailerId, expected);
          finish(reason ? storeStopError(reason, lane) : late());
        })
        .catch(() => finish(late()));
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (accepted(tab)) finish(null, tab);
    }).catch(() => undefined);
  });
}

// Paths and titles stores use for their robot checks (Walmart's Press & Hold
// is served at /blocked, Amazon's at /errors/validateCaptcha).
const STORE_CHECK_PATHS = Object.freeze([/^\/blocked(?:\/|$)/i, /^\/errors\/validatecaptcha/i, /captcha/i]);
const STORE_CHECK_TITLE = /robot or human|verify (?:that )?you(?:'|’)?re (?:a )?human|verify you are (?:a )?human|are you a robot|access denied|just a moment|security check|captcha/i;

/** "security_challenge" or "listing_mismatch" for a store tab that stopped short of the expected page, else "". */
function storeStopReason(tab, retailerId, expected) {
  const lane = ADD_LANES[retailerId];
  let url;
  let home;
  try {
    url = new URL(String(tab?.url || ""));
    home = new URL(lane.cartUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || (url.hostname !== home && !url.hostname.endsWith(`.${home}`))) return "";
  if (STORE_CHECK_PATHS.some((pattern) => pattern.test(url.pathname)) || STORE_CHECK_TITLE.test(String(tab?.title || ""))) {
    return "security_challenge";
  }
  if (expected === "cart") return "";
  const identity = canonicalRetailerIdentity(url.href);
  return identity?.retailerId === retailerId && identity.retailerSku && identity.retailerSku !== expected
    ? "listing_mismatch" : "";
}

function storeStopError(reason, lane) {
  const error = new Error(reason === "security_challenge"
    ? `${lane?.name || "The store"} showed its robot or security check.`
    : `${lane?.name || "The store"} opened a different item than the call named.`);
  error.storeStop = reason;
  return error;
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
      return identity?.retailerId === retailerId && identity.retailerSku === retailerSku
        || retailerId === "bestbuy" && bestBuyCodeOnlyProductUrl(tab.url);
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
    func: (_operation, key, expectedToken, abandonAfterMs) => {
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
      // If the worker dies before waiting, the page must not keep a
      // document-wide observer for the rest of its life.
      setTimeout(() => {
        if (root[key] !== state) return;
        observer.disconnect();
        delete root[key];
      }, abandonAfterMs);
      return { armed: true, token: expectedToken };
    },
    args: ["yoink_post_click_settle_arm", POST_CLICK_SETTLE_STATE_KEY, token, POST_CLICK_SETTLE_ABANDON_MS]
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

// Retry when sold out: the same product page again, in the background. The
// address is unchanged, so wait for the reload to start before accepting the page.
async function reloadRetailerTab(tabId, retailerId, url, expected) {
  let listener;
  const started = new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    listener = (updatedId, changeInfo) => {
      if (updatedId === tabId && changeInfo.status === "loading") {
        clearTimeout(timeout);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  try {
    const updated = await chrome.tabs.update(tabId, { url });
    if (updated?.status !== "loading") await started;
  } finally {
    chrome.tabs.onUpdated.removeListener(listener);
  }
  await waitForTab(tabId, retailerId, expected);
  return tabId;
}

async function readRestockTabs() {
  try {
    const stored = (await chrome.storage.session.get(RESTOCK_TABS_KEY))[RESTOCK_TABS_KEY];
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

async function keepRestockTab(jobId, tabId, retailerId, until) {
  const kept = await readRestockTabs();
  kept[jobId] = { tabId, retailerId, until };
  await chrome.storage.session.set({ [RESTOCK_TABS_KEY]: kept });
}

/** The kept tab for a job's next try, if it is still open. */
async function takeRestockTab(jobId) {
  const kept = await readRestockTabs();
  const entry = kept[jobId];
  if (!entry) return null;
  delete kept[jobId];
  await chrome.storage.session.set({ [RESTOCK_TABS_KEY]: kept });
  const tab = await chrome.tabs.get(entry.tabId).catch(() => null);
  return Number.isInteger(tab?.id) ? tab.id : null;
}

/** A job that never came back (its window closed, the item was edited) leaves no tab behind. */
async function closeStaleRestockTabs(now = Date.now()) {
  const kept = await readRestockTabs();
  let changed = false;
  for (const [jobId, entry] of Object.entries(kept)) {
    if (Date.parse(entry?.until || "") + 2 * 60_000 > now) continue;
    delete kept[jobId];
    changed = true;
    if (Number.isInteger(entry?.tabId)) await chrome.tabs.remove(entry.tabId).catch(() => undefined);
  }
  if (changed) await chrome.storage.session.set({ [RESTOCK_TABS_KEY]: kept });
}

/**
 * Kevin, 2026-10-09: a cart add that didn't succeed closes its tab. With
 * Retry when sold out set for this job, the tab stays for its next try.
 * Tabs that need the shopper (sign in, an uncertain click) are left open by
 * their own paths and never come here.
 */
async function settleFailedAttemptTab(active, reported) {
  const tabId = active?.tabId;
  if (!Number.isInteger(tabId)) return;
  await forgetRetailerActionTab(tabId).catch(() => undefined);
  if (reported?.state === "awaiting_executor" && reported.restockRetryUntil) {
    await keepRestockTab(active.id, tabId, active.retailerId, String(reported.restockRetryUntil));
    return;
  }
  await chrome.tabs.remove(tabId).catch(() => undefined);
}

// The job's one tab (Kevin, 2026-10-11): a kept or reusable tab moves to the
// page, otherwise a new tab opens. Its id is saved before any wait, so a tab
// that stops on the store's robot check is still the job's.
async function openJobTab(active, tabId, retailerId, url, expected) {
  if (Number.isInteger(tabId)) {
    active.tabId = tabId;
    await saveActiveJob(active);
    try {
      await moveJobTab(active, url, expected);
      return tabId;
    } catch (error) {
      if (error?.storeStop) throw error;
      // A closed or no-longer-loadable prior tab is replaced before mutation.
      await chrome.tabs.remove(tabId).catch(() => undefined);
      active.quietTab = false;
    }
  }
  const tab = await chrome.tabs.create({ url, active: true });
  if (!Number.isInteger(tab?.id)) throw new Error(`Chrome could not open the ${ADD_LANES[retailerId]?.name || "retailer"} execution tab.`);
  active.tabId = tab.id;
  await saveActiveJob(active);
  await waitForTab(tab.id, retailerId, expected);
  return tab.id;
}

/** Moves the job's tab to its next page: in front, or quietly for a Retry when sold out try. */
async function moveJobTab(active, url, expected) {
  const retailerId = active.retailerId || active.runnerJob?.retailerId;
  if (active.quietTab) await reloadRetailerTab(active.tabId, retailerId, url, expected);
  else await navigateRetailerTab(active.tabId, retailerId, url, expected);
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
    retailerId: ["target", "walmart", "amazon", "bestbuy", "pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"].includes(proof?.retailerId) ? proof.retailerId : "",
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
        pokemoncenter: ['a[href*="/logout" i]', 'a[href*="/signout" i]'],
        bestbuy: ['a[href*="/identity/global/signout" i]', 'a[href*="/logout" i]']
      }[exactRetailerId] || [];
      const signedOut = {
        target: ['a[href*="/login" i]', 'a[href*="/signin" i]'],
        walmart: ['a[href*="/account/login" i]', 'a[href*="/signin" i]'],
        amazon: ['a[href*="/ap/signin" i]'],
        pokemoncenter: ['a[href*="/login" i]', 'a[href*="/sign-in" i]'],
        bestbuy: ['a[href*="/identity/global/signin" i]', 'a[href*="/login" i]']
      }[exactRetailerId] || [];
      const challenge = [
        "iframe[src*='captcha' i]",
        "iframe[title*='human verification' i]",
        "iframe[src*='_Incapsula_Resource' i]",
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
      && (lane.pageHosts ? lane.pageHosts.includes(url.hostname)
        : url.hostname === expectedHost || url.hostname.endsWith(`.${expectedHost}`));
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
  if (await showBestBuyWaitBadge()) return;
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

// A cart-ready tab moves on to the store's checkout (1.30.8), where the
// shopper may be on any checkout step when they come back to it; until now a
// click on its alert looked for the cart page only, so it opened a second
// checkout tab and then failed.
function retailerCheckoutTab(tab, retailerId) {
  const lane = ADD_LANES[retailerId];
  if (!lane?.checkoutUrl || !Number.isInteger(tab?.id)) return false;
  try {
    const actual = new URL(String(tab.url || ""));
    const expected = new URL(lane.checkoutUrl);
    return actual.protocol === "https:" && !actual.username && !actual.password
      && actual.hostname === expected.hostname;
  } catch {
    return false;
  }
}

function retailerHandoffTab(tab, item) {
  if (item?.kind !== "needs_you") return retailerCartTab(tab, item?.retailerId) || retailerCheckoutTab(tab, item?.retailerId);
  const lane = ADD_LANES[item?.retailerId];
  if (!lane || !Number.isInteger(tab?.id)) return false;
  if (lane.pageHosts) return retailerLanePageUrl(item.retailerId, tab.url);
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
    const replacement = await chrome.tabs.create({
      url: item.kind === "cart_ready" && lane.checkoutUrl ? lane.checkoutUrl : lane.cartUrl,
      active: true
    }).catch(() => null);
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
    iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
    title: (active.runnerJob?.approvedTest || active.testCall ? "TEST · " : "") + (item.kind === "needs_you" ? `Review ${item.retailerName} add` : `Cart ready at ${item.retailerName}`),
    message: item.kind === "needs_you"
      ? `${item.identityLabel} ${item.retailerSku} could not be verified after Add. Check the open retailer tab.`
      : `${item.identityLabel} ${item.retailerSku} was added. ${item.kind === "cart_ready" && lane.checkoutUrl ? "Checkout is open; you place the order." : "Checkout remains manual."}${active.runnerJob?.approvedTest ? " Owner-approved above-MSRP / older-alert TEST. No order placed." : ""}${active.testCall ? " This was a test call: remove it from your cart if you don't want it." : ""}`,
    contextMessage: "Yoink needs you",
    priority: 2,
    requireInteraction: true
  }).catch(() => undefined);
  void playCartReadySound().catch(() => undefined);
  // The cart is proven, so the handoff tab moves on to checkout: the shopper
  // reviews the order there and places it. Nothing on the page is clicked.
  if (item.kind === "cart_ready" && lane.checkoutUrl) {
    await chrome.tabs.update(item.tabId, { url: lane.checkoutUrl, active: true }).catch(() => undefined);
  }
  return item;
}

function publishCartReady(active, readyAt = Date.now()) {
  return publishActionHandoff(active, "cart_ready", "", readyAt);
}

function publishNeedsYou(active, reasonCode, readyAt = Date.now()) {
  return publishActionHandoff(active, "needs_you", reasonCode, readyAt);
}

function stoppedActionReason(reasonCode) {
  const reason = safeReasonCode(reasonCode || "action_stopped");
  const known = {
    listed_price_changed: "The item price changed since the alert. Review the new price before another attempt.",
    desired_variant_unverified: "The exact selected variant could not be verified.",
    desired_variant_changed: "The selected variant changed. Review the item again.",
    official_msrp_authorization_missing: "Official MSRP evidence needs review.",
    official_msrp_authorization_invalid: "The approved MSRP evidence or alert expired or changed.",
    retailer_access_missing: "Chrome access to this store is off.",
    worker_restarted_before_add: "Chrome restarted before it could finish checking the item.",
    cart_unverified: "Yoink could not prove the current cart before the add.",
    cart_baseline_stale: "The saved cart check was no longer fresh.",
    cart_page_unverified: "Yoink could not read the store cart. Make sure you are signed in to the store in Chrome.",
    cart_evidence_stale: "The saved cart check was no longer fresh.",
    manual_action_required: "The store asked for a sign-in or security check. Finish it in Chrome.",
    security_challenge: "The store showed its robot or security check. Finish it in the open tab, then try again.",
    listing_mismatch: "The store's link opened a different item than the call named, so nothing was added.",
    extension_error: "Chrome stopped before it could finish checking the item.",
    out_of_stock: "The item was no longer in stock.",
    over_unit_cap: "The current price was above your max price.",
    over_total_cap: "With tax and fees the order would be above your max total.",
    price_above_limit: "The current price was above your reviewed limit.",
    third_party_seller: "A marketplace seller, not the store itself, was selling it.",
    signal_seller_mismatch: "The current seller did not match your plan.",
    seller_unverified: "Yoink could not confirm the store itself was the seller.",
    seller_mismatch: "The current seller did not match your plan.",
    add_control_unavailable: "The store page had no Add to cart button for this item.",
    fulfillment_unverified: "The requested delivery or pickup option was unavailable.",
    fulfillment_selection_failed: "The requested delivery or pickup option was unavailable.",
    fulfillment_mismatch: "The requested delivery or pickup option was unavailable.",
    offer_unverified: "The live item details could not be verified."
  };
  return known[reason] || "The live item no longer passed every check in your plan.";
}

async function publishActionStopped(active, reasonCode) {
  const retailerId = active?.retailerId || active?.runnerJob?.retailerId;
  const lane = ADD_LANES[retailerId];
  const jobId = String(active?.id || "");
  if (!lane || !/^[A-Za-z0-9_-]{3,120}$/.test(jobId)) return false;
  const retailerSku = String(active?.runnerJob?.retailerSku || "").slice(0, 40);
  await chrome.notifications?.create?.(`${ACTION_STOPPED_NOTIFICATION_PREFIX}${jobId}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
    title: `${lane.name} action stopped safely`,
    message: `Item ${retailerSku}: ${stoppedActionReason(reasonCode)} No Add click was authorized.`,
    contextMessage: "Open Yoink Activity for details",
    priority: 1,
    requireInteraction: true
  });
  return true;
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
  let cartTabId = active.tabId;
  if (ONE_TAB_CART_LANES.has(retailerId) && !Number.isInteger(active.verificationTabId)) {
    // Kevin, 2026-10-11: the product tab itself moves on to the cart, and from
    // there to checkout; no second tab. It leaves the Add page only once the
    // store has had time to finish the add (or has moved on by itself).
    await settleRequiredWork(
      heartbeatJob(active),
      (async () => {
        await waitForAddToFinish(active);
        const tab = await chrome.tabs.get(active.tabId);
        if (!retailerCartTab(tab, retailerId)) await moveJobTab({ ...active, quietTab: false }, lane.cartUrl, "cart");
      })()
    );
  } else {
    // Unloading the Add page can cancel a pending store request even after a
    // quiet DOM interval. Preserve it, including any delayed store step, while
    // reading cart in a separate tab. Persist that tab for worker recovery.
    // Token-then-add XHR stores (Gap family, AE, ASUS, Shopify, Pokémon
    // Center) routinely outlast the post-click settle.
    await settleRequiredWork(
      heartbeatJob(active),
      (async () => {
        let cart = Number.isInteger(active.verificationTabId)
          ? await chrome.tabs.get(active.verificationTabId).catch(() => null) : null;
        if (!cart) {
          cart = await chrome.tabs.create({ url: lane.cartUrl, active: false });
          if (!Number.isInteger(cart?.id)) throw new Error("The verification cart tab could not be opened.");
          active.verificationTabId = cart.id;
          await saveActiveJob(active);
        }
        cartTabId = cart.id;
        await waitForTab(cartTabId, retailerId, "cart");
      })()
    );
  }
  await injectAddAction(cartTabId, retailerId);
  let result;
  for (;;) {
    result = await executeReadOnlyCartAction(
      cartTabId,
      retailerId,
      lane.verifyCartOperation,
      [addedCartJob(active), active.proof, active.cartBaseline],
      CART_PROOF_WAIT_MAX_MS
    );
    if (result?.reason === "cart_unverified" && !active.cartShownForProof) {
      // The add happened; a cart that only draws in a visible tab is shown for one more read.
      active.cartShownForProof = true;
      await saveActiveJob(active);
      await chrome.tabs.update(cartTabId, { active: true }).catch(() => undefined);
      result = await executeReadOnlyCartAction(cartTabId, retailerId, lane.verifyCartOperation,
        [addedCartJob(active), active.proof, active.cartBaseline], CART_VISIBLE_RETRY_WAIT_MS);
    }
    if (result?.ok || result?.reason !== "cart_delta_unverified"
      || typeof lane.baselineOperation !== "string"
      || Number(active.cartRefreshCount || 0) >= 2
      || new Date(active.runnerJob.expiresAt).getTime() <= Date.now()) break;
    // A separate server-rendered cart may have loaded before Add completed.
    // Refresh only a fully readable cart that is exactly unchanged; conflicts,
    // unknown rows and store gates go to manual review without a refresh.
    const current = await executeReadOnlyCartAction(cartTabId, retailerId, lane.baselineOperation, [], CART_BASELINE_WAIT_MAX_MS);
    const before = active.cartBaseline;
    if (!current?.ok || current.proof?.retailerId !== retailerId
      || current.proof.lineCount !== before.lineCount
      || current.proof.lines.length !== before.lines.length
      || !before.lines.every(line => current.proof.lines.some(candidate =>
        candidate.retailerSku === line.retailerSku && candidate.quantity === line.quantity))) break;
    const tab = await chrome.tabs.get(cartTabId).catch(() => null);
    if (!retailerCartTab(tab, retailerId)) break;
    active.cartRefreshCount = Number(active.cartRefreshCount || 0) + 1;
    await saveActiveJob(active);
    await navigateRetailerTab(cartTabId, retailerId, lane.cartUrl, "cart");
    await injectAddAction(cartTabId, retailerId);
  }
  if (result?.ok) result = await raiseCartQuantity(active, cartTabId, result);
  if (!result?.ok) {
    await captureCartEvidence(cartTabId, active, result?.reason || "cart_unverified");
    await publishNeedsYou(active, result?.reason || "cart_unverified").catch(() => undefined);
    await reportJob(active, "manual_review", result?.reason || "cart_unverified", `The exact ${lane.name} cart result could not be proven after Add; automatic retry is locked.`);
    await clearActiveJob();
    return { confirmed: false, cartBaseline: null };
  }
  return completeVerifiedCart(active, result, cartTabId);
}

// Stores whose job runs in one tab from the cart check to checkout. Best Buy
// keeps its product tab still after Add (a queue can appear there); the other
// lanes' add requests can outlast any fixed wait.
const ONE_TAB_CART_LANES = new Set(["amazon", "target", "walmart"]);
// How long after the Add click the product page stays before the tab moves on
// to the cart, unless the store has already moved it to a new page itself.
const ADD_FINISH_GRACE_MS = 2_000;

async function waitForAddToFinish(active) {
  if (active.postClickSettle?.reason === "tab_complete") return;
  const clickedAt = Number(active.timing?.clickedAt);
  const remaining = Number.isFinite(clickedAt) ? clickedAt + ADD_FINISH_GRACE_MS - Date.now() : ADD_FINISH_GRACE_MS;
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, ADD_FINISH_GRACE_MS)));
}

/**
 * How many this job adds (Kevin, 2026-10-10: a quantity per item, never past
 * the store's own limit). The store's runner says what its product page set
 * (`add`) and how far the cart line should be raised afterwards (`raiseTo`,
 * a total); anything missing or out of range falls back to one item.
 */
function cartQuantityPlan(prepared, job) {
  const requested = Number.isInteger(job?.quantity) && job.quantity >= 1 && job.quantity <= CART_QUANTITY_MAX ? job.quantity : 1;
  const plan = prepared?.quantity;
  const storeLimit = Number.isInteger(plan?.storeLimit) && plan.storeLimit >= 1 && plan.storeLimit <= 99 ? plan.storeLimit : null;
  const add = Number.isInteger(plan?.add) && plan.add >= 1 && plan.add <= requested ? plan.add : 1;
  const raiseTo = Number.isInteger(plan?.raiseTo) && plan.raiseTo >= add && plan.raiseTo <= requested ? plan.raiseTo : add;
  return { requested, storeLimit, add, raiseTo, raiseReason: "" };
}

/** The job as the cart should show it right after the Add click: the quantity the product page added. */
function addedCartJob(active) {
  return { ...active.runnerJob, quantity: Number(active.quantityPlan?.add) || 1 };
}

// Results that mean the raise touched nothing on the cart page (it checks the
// line, target, seller and price before it sets anything).
const QUANTITY_RAISE_UNTOUCHED = new Set([
  "quantity_control_unavailable", "quantity_line_ambiguous", "quantity_line_missing", "quantity_target_invalid",
  "manual_action_required", "runner_unavailable", "cart_unverified", "cart_page_unverified",
  "third_party_seller", "over_unit_cap", "over_total_cap"
]);

/**
 * After a verified add, raises the item's cart line toward the planned
 * quantity and proves the whole cart again against the pre-add baseline.
 * The line may end anywhere from what the Add put there up to the plan (the
 * store's limit can stop it sooner); anything else, or a cart that can't be
 * read after a change, is not proven.
 */
async function raiseCartQuantity(active, cartTabId, verified) {
  const retailerId = active.retailerId || active.runnerJob?.retailerId;
  const lane = ADD_LANES[retailerId];
  const plan = active.quantityPlan;
  if (!plan || plan.raiseTo <= plan.add || !lane?.operations?.raiseCart) return verified;
  const sku = String(active.runnerJob.retailerSku || "").toUpperCase();
  const baselineQuantity = Number(active.cartBaseline?.lines?.find((line) => line.retailerSku === sku)?.quantity) || 0;
  await heartbeatJob(active).catch(() => undefined);
  let raised;
  try {
    await injectAddAction(cartTabId, retailerId);
    // The add's own proof lets a store bind a cart line that names only its product code (Best Buy).
    raised = await executeAddAction(cartTabId, retailerId, lane.operations.raiseCart, [active.runnerJob, {
      baselineQuantity,
      currentQuantity: baselineQuantity + plan.add,
      targetQuantity: baselineQuantity + plan.raiseTo
    }, active.proof]);
  } catch {
    raised = { ok: false, reason: "runner_failed" };
  }
  const storeLimit = Number.isInteger(raised?.storeLimit) && raised.storeLimit >= 1 && raised.storeLimit <= 99
    ? raised.storeLimit : plan.storeLimit;
  active.quantityPlan = { ...plan, storeLimit, raiseReason: raised?.ok ? "" : safeReasonCode(raised?.reason || "quantity_unchanged") };
  await saveActiveJob(active);
  if (!raised?.ok) await captureCartEvidence(cartTabId, active, active.quantityPlan.raiseReason);
  if (!raised?.ok && QUANTITY_RAISE_UNTOUCHED.has(String(raised?.reason || ""))) return verified;
  // What the store kept, not what the page shows: a quantity field Yoink set
  // reads back as set even if the store ignored it. Let the update finish,
  // load the cart again, and count from the store's own page.
  await new Promise((resolve) => setTimeout(resolve, CART_RAISE_SETTLE_MS));
  await navigateRetailerTab(cartTabId, retailerId, lane.cartUrl, "cart");
  await injectAddAction(cartTabId, retailerId);
  const current = await executeReadOnlyCartAction(cartTabId, retailerId, lane.baselineOperation, [], CART_PROOF_WAIT_MAX_MS);
  const line = current?.ok ? current.proof?.lines?.find((entry) => entry.retailerSku === sku) : null;
  const added = Number(line?.quantity) - baselineQuantity;
  if (!Number.isInteger(added) || added < plan.add || added > plan.raiseTo) {
    return { ok: false, reason: current?.ok ? "cart_delta_unverified" : current?.reason || "cart_unverified" };
  }
  const intended = raised?.ok && Number.isInteger(raised.quantity) ? Number(raised.quantity) - baselineQuantity : null;
  if (intended !== null && added < intended) {
    active.quantityPlan = { ...active.quantityPlan, raiseReason: "quantity_unconfirmed" };
    await saveActiveJob(active);
  }
  const result = await executeReadOnlyCartAction(cartTabId, retailerId, lane.verifyCartOperation,
    [{ ...active.runnerJob, quantity: added }, active.proof, active.cartBaseline], CART_PROOF_WAIT_MAX_MS);
  return result?.ok ? result : { ok: false, reason: result?.reason || "cart_unverified" };
}

async function completeVerifiedCart(active, result, cartTabId = active.tabId) {
  const retailerId = active.retailerId || active.runnerJob?.retailerId;
  const lane = ADD_LANES[retailerId];
  const readyAt = Date.now();
  const proof = result?.proof;
  const proofAge = readyAt - Date.parse(proof?.observedAt || "");
  const requested = Number(active.quantityPlan?.requested) || 1;
  if (result?.ok !== true || proof?.contractVersion !== 1 || proof.jobId !== active.id
    || proof.retailerId !== retailerId || proof.retailerSku !== active.runnerJob?.retailerSku
    || !Number.isInteger(proof.quantity) || proof.quantity < 1 || proof.quantity > requested
    || proof.sellerType !== "first_party"
    // Any price at or under the plan's max (Kevin, 2026-10-11).
    || !Number.isSafeInteger(proof.unitPriceCents) || proof.unitPriceCents <= 0
    || !(proof.unitPriceCents <= active.runnerJob?.maxUnitPriceCents)
    || !Number.isFinite(proofAge) || proofAge < 0 || proofAge > 30_000) {
    await publishNeedsYou(active, "cart_unverified").catch(() => undefined);
    await reportJob(active, "manual_review", "cart_unverified", "The final exact cart proof is missing, changed or stale; no cart-success notification was sent.");
    await clearActiveJob();
    return { confirmed: false, cartBaseline: null };
  }
  markJobTiming(active, "cartReadyAt", readyAt);
  const latency = cartReadyLatency(active, readyAt);
  // The browser has already proven the exact +1 cart delta, so hand control
  // back to the user immediately. Control-plane reporting must never delay
  // the local notification, badge, sound, popup state, or cart-tab handoff.
  if (retailerId === "bestbuy") await clearBestBuyWait();
  const approvedTest=!!active.runnerJob?.approvedTest;
  if(approvedTest){
    await reportJob(active,"cart_verified","approved_test_cart_verified","TEST cart delta verified.",{
      approvedTestCartProof:result.proof,approvedTestCartBaseline:result.cartBaseline
    });
  }
  // Kevin, 2026-10-11: a job ends in one tab, on checkout. Where the cart was
  // read in a second tab (Best Buy keeps its product page still after Add),
  // the product tab moves on to checkout and the cart tab closes; a store
  // without a checkout page hands off on its cart and closes the product tab.
  const ownTabOpen = Number.isInteger(active.tabId) && active.tabId !== cartTabId
    && await chrome.tabs.get(active.tabId).then((tab) => Number.isInteger(tab?.id)).catch(() => false);
  const handoffTabId = ownTabOpen && lane?.checkoutUrl ? active.tabId : cartTabId;
  await publishCartReady({ ...active, tabId: handoffTabId }, readyAt).catch(() => undefined);
  if (ownTabOpen) await chrome.tabs.remove(handoffTabId === cartTabId ? active.tabId : cartTabId).catch(() => undefined);
  // A tab handed off on checkout is the shopper's now, even one kept from an earlier add.
  if (lane?.checkoutUrl) await forgetRetailerActionTab(handoffTabId).catch(() => undefined);
  const added = proof.quantity;
  const quantityEvidence = {
    quantity: added,
    requestedQuantity: requested,
    ...(Number.isInteger(active.quantityPlan?.storeLimit) ? { storeLimit: active.quantityPlan.storeLimit } : {}),
    ...(active.quantityPlan?.raiseReason ? { quantityRaiseReason: active.quantityPlan.raiseReason } : {})
  };
  await reportJobBatch(active, [
    ...(!approvedTest ? [{
      state: "cart_verified",
      reasonCode: "exact_cart_delta_verified",
      message: `The ${lane.name} cart changed by exactly ${added === 1 ? "one authorized item" : `${added} authorized items`} and every baseline quantity remained unchanged.`,
      evidence: {
        retailerId,
        retailerSku: active.runnerJob.retailerSku,
        ...quantityEvidence,
        unitPriceCents: result.proof?.unitPriceCents ?? null,
        sellerType: result.proof?.sellerType ?? "unknown"
      }
    }] : []),
    {
      state: "confirmed",
      reasonCode: `${retailerId}_add_confirmed`,
      message: `${lane.name} add-to-cart completed and the exact +${added} cart delta was verified.`,
      evidence: {
        retailerId,
        retailerSku: active.runnerJob.retailerSku,
        ...quantityEvidence,
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
  // A cart handed off on checkout is the shopper's now: the next add never reuses that tab.
  return { confirmed: true, tabId: lane?.checkoutUrl ? null : handoffTabId, cartBaseline,
    signedInState: active.signedInState || "unknown" };
}

function bestBuyPostAddDeadline(active) {
  const times = [
    new Date(active.runnerJob?.expiresAt || "").getTime(),
    new Date(active.cartBaseline?.observedAt || "").getTime() + CART_BASELINE_MAX_AGE_MS,
    new Date(active.proof?.observedAt || active.cartBaseline?.observedAt || "").getTime() + CART_BASELINE_MAX_AGE_MS
  ];
  return times.every(Number.isFinite) ? Math.min(...times) : 0;
}

// A tab Yoink just opened on the Best Buy cart that hasn't committed a page yet.
function bestBuyTabCommitting(tab) {
  if (!Number.isInteger(tab?.id) || tab.status === "complete") return false;
  const committed = String(tab.url || "");
  if (committed && committed !== "about:blank") return false;
  return bestBuyPostAddTab({ id: tab.id, url: tab.pendingUrl || ADD_LANES.bestbuy.cartUrl });
}

function bestBuyPostAddTab(tab) {
  if (!Number.isInteger(tab?.id)) return false;
  try {
    const url = new URL(String(tab.url || ""));
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (url.hostname === "bestbuy.com" || url.hostname.endsWith(".bestbuy.com"));
  } catch { return false; }
}

async function showBestBuyWaitBadge() {
  const stored = (await chrome.storage.session.get(PopupState.BESTBUY_WAIT_STORAGE_KEY))[PopupState.BESTBUY_WAIT_STORAGE_KEY];
  const wait = PopupState.bestBuyWaitState(stored);
  if (!wait) return false;
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.warning }),
    chrome.action.setBadgeText({ text: wait.needsAction ? "!" : "WAIT" }),
    chrome.action.setTitle({ title: wait.needsAction
      ? "Yoink · Best Buy needs your verification (including any SMS code)"
      : "Yoink · Waiting for Best Buy cart confirmation" })
  ]);
  return true;
}

async function clearBestBuyWait() {
  const key = PopupState.BESTBUY_WAIT_STORAGE_KEY;
  const stored = (await chrome.storage.session.get(key))[key];
  if (!stored) return;
  await chrome.storage.session.remove(key);
  await chrome.notifications?.clear?.(`${BESTBUY_WAIT_NOTIFICATION_PREFIX}${stored.jobId}`).catch(() => undefined);
  await refreshActionBadge();
}

async function focusBestBuyWait(jobId) {
  const active = await activeJob();
  if (active?.id !== jobId || active.retailerId !== "bestbuy" || active.phase !== "adding" || active.browserRestartedAfterAdd) {
    throw new Error("This Best Buy wait is no longer active. Check Yoink Activity.");
  }
  const tab = await chrome.tabs.get(active.waitingTabId || active.tabId).catch(() => null);
  if (!bestBuyPostAddTab(tab)) throw new Error("The Best Buy waiting tab was closed or changed. Check Yoink Activity.");
  await chrome.tabs.update(tab.id, { active: true });
  if (Number.isInteger(tab.windowId)) await chrome.windows?.update?.(tab.windowId, { focused: true });
  return { opened: true, tabId: tab.id };
}

async function publishBestBuyWait(active, reason) {
  const wait = PopupState.bestBuyWaitState({
    schemaVersion: 1, jobId: active.id, retailerSku: active.runnerJob?.retailerSku,
    reason, clicked: Number.isFinite(active.timing?.clickedAt),
    expiresAt: new Date(bestBuyPostAddDeadline(active)).toISOString()
  });
  if (!wait) return;
  const stage = wait.needsAction ? "needs_action" : "waiting";
  const alertChanged = active.postAddAlertStage !== stage;
  active.postAddWaitReason = reason;
  active.postAddAlertStage = stage;
  // Persist the receipt and the minimal popup state before making the alert clickable.
  await saveActiveJob(active);
  await chrome.storage.session.set({ [PopupState.BESTBUY_WAIT_STORAGE_KEY]: wait });
  await showBestBuyWaitBadge();
  if (alertChanged) {
    await chrome.notifications?.create?.(`${BESTBUY_WAIT_NOTIFICATION_PREFIX}${active.id}`, {
      type: "basic", iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
      title: wait.needsAction ? "Best Buy needs you" : wait.clicked ? "Best Buy Add triggered" : "Checking Best Buy add",
      message: wait.needsAction
        ? "Complete Best Buy’s steps, including any SMS code, in the waiting tab. Yoink is watching for cart confirmation."
        : "Keep the Best Buy tab open. Yoink is waiting for cart confirmation and will alert you if verification is needed.",
      contextMessage: `Yoink · Best Buy · SKU ${wait.retailerSku}`, priority: wait.needsAction ? 2 : 0, requireInteraction: true
    }).catch(() => undefined);
    void playCartReadySound().catch(() => undefined);
  }
}

async function bestBuyWaiting(active, reason) {
  await publishBestBuyWait(active, reason);
  clearTimeout(bestBuyPostAddTimer);
  // Design choice: while Best Buy's post-add wait is open this device holds its
  // one active job (the server answers device_busy to other leases), so a
  // Best Buy queue delays other stores on this browser until it resolves.
  // Once a queue is confirmed the page changes slowly; poll less often there.
  const pollMs = active.bestBuyQueueSeen ? BESTBUY_QUEUE_POLL_MS : BESTBUY_POST_ADD_POLL_MS;
  bestBuyPostAddTimer = setTimeout(() => { bestBuyPostAddTimer = null; void runJobCycle(); }, pollMs);
  // The existing 30-second job alarm resumes this read-only wait if the worker sleeps.
  return { confirmed: false, waiting: true, tabId: null, cartBaseline: null, continueCycle: false };
}

async function stopBestBuyPostAdd(active, reason) {
  await clearBestBuyWait();
  await chrome.notifications?.clear?.(`${BESTBUY_WAIT_NOTIFICATION_PREFIX}${active.id}`).catch(() => undefined);
  await forgetRetailerActionTab(active.tabId);
  await failActiveJob({ ...active, tabId: active.waitingTabId || active.tabId }, true, reason);
  return { confirmed: false, tabId: null, cartBaseline: null, continueCycle: false };
}

async function advanceBestBuyPostAdd(active) {
  if (active.browserRestartedAfterAdd) {
    await chrome.notifications?.create?.(`${ACTION_STOPPED_NOTIFICATION_PREFIX}${active.id}`, {
      type: "basic", iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON), title: "Review Best Buy add",
      message: "Chrome restarted after Add. Check your restored Best Buy queue or cart before trying again. Automatic retry is locked.",
      contextMessage: "Open Yoink Activity", priority: 2, requireInteraction: true
    }).catch(() => undefined);
    return stopBestBuyPostAdd(active, "browser_restarted_after_add");
  }
  if (bestBuyPostAddDeadline(active) - Date.now() <= 5_000) return stopBestBuyPostAdd(active, "bestbuy_wait_expired");
  const original = await chrome.tabs.get(active.tabId).catch(() => null);
  if (!Number.isInteger(original?.id)) return stopBestBuyPostAdd(active, "bestbuy_queue_tab_closed");
  active.waitingTabId = original.id;
  if (!bestBuyPostAddTab(original)) return stopBestBuyPostAdd(active, "page_changed");
  await forgetRetailerActionTab(original.id);
  if (!await addLaneAccess("bestbuy")) return stopBestBuyPostAdd(active, "retailer_access_missing");
  if (!active.postAddHeartbeatAt || Date.now() - active.postAddHeartbeatAt >= 15_000) {
    const heartbeat = await heartbeatJob(active);
    if (["confirmed", "manual_review", "cancelled", "submission_uncertain"].includes(heartbeat?.heartbeat?.state)) return stopBestBuyPostAdd(active, "job_no_longer_active");
    active.postAddHeartbeatAt = Date.now();
    await saveActiveJob(active);
  }
  let observation;
  try {
    await injectAddAction(original.id, "bestbuy");
    observation = await executeAddAction(original.id, "bestbuy", "inspectBestBuyPostAdd", [active.runnerJob]);
  } catch { return bestBuyWaiting(active, "bestbuy_state_unavailable"); }
  if (observation?.state === "queue") {
    active.bestBuyQueueSeen = true;
    return bestBuyWaiting(active, "bestbuy_queue_waiting");
  }
  if (observation?.state === "user_action") {
    if (["page_changed", "listing_mismatch"].includes(observation.reason)) return stopBestBuyPostAdd(active, observation.reason);
    return bestBuyWaiting(active, observation.reason === "security_challenge" ? "security_challenge" : "manual_action_required");
  }
  // SMS/account prompts can already be visible while unrelated resources are
  // still loading. Alert from their DOM, but defer all cart work until load completes.
  if (original.status !== "complete") return bestBuyWaiting(active, "bestbuy_cart_pending");
  if (!["product", "cart"].includes(observation?.state)) return bestBuyWaiting(active, "bestbuy_state_unavailable");
  if (active.lastCartCheckAt && Date.now() - active.lastCartCheckAt < BESTBUY_CART_RECHECK_MS) {
    return bestBuyWaiting(active, active.bestBuyQueueSeen && observation.addControlActionable ? "bestbuy_queue_next_step" : "bestbuy_cart_pending");
  }
  let cartTabId = original.id;
  if (observation.state !== "cart") {
    let cart = Number.isInteger(active.verificationTabId) ? await chrome.tabs.get(active.verificationTabId).catch(() => null) : null;
    if (!cart) {
      // The original product/queue tab is never navigated, including when a
      // delayed queue appears after this probe or the worker restarts.
      const created = await chrome.tabs.create({ url: ADD_LANES.bestbuy.cartUrl, active: false });
      if (!Number.isInteger(created?.id)) return stopBestBuyPostAdd(active, "cart_unverified");
      active.verificationTabId = created.id;
      await saveActiveJob(active);
      cart = await chrome.tabs.get(created.id).catch(() => null);
    }
    if (!cart) return stopBestBuyPostAdd(active, "bestbuy_cart_tab_changed");
    active.waitingTabId = cart.id;
    // A new tab has no committed URL until Best Buy's first response arrives;
    // that is loading, not a changed tab, so the next poll looks again.
    if (bestBuyTabCommitting(cart)) return bestBuyWaiting(active, "bestbuy_cart_pending");
    // A cart navigation can itself redirect into a queue. Observe its actual
    // page before considering a refresh, and let subsequent polls watch loading.
    if (!bestBuyPostAddTab(cart)) return stopBestBuyPostAdd(active, "bestbuy_cart_tab_changed");
    await injectAddAction(cart.id, "bestbuy");
    const cartState = await executeAddAction(cart.id, "bestbuy", "inspectBestBuyPostAdd", [active.runnerJob]);
    if (cartState?.state === "queue" || cartState?.state === "user_action") {
      if (["page_changed", "listing_mismatch"].includes(cartState.reason)) return stopBestBuyPostAdd(active, "bestbuy_cart_tab_changed");
      return bestBuyWaiting(active, cartState.state === "queue" ? "bestbuy_queue_waiting" : "manual_action_required");
    }
    if (cart.status !== "complete") return bestBuyWaiting(active, "bestbuy_cart_pending");
    if (cartState?.state !== "cart") return stopBestBuyPostAdd(active, "bestbuy_cart_tab_changed");
    if (active.lastCartCheckAt) {
      active.lastCartCheckAt = 0;
      await saveActiveJob(active);
      await chrome.tabs.update(cart.id, { url: ADD_LANES.bestbuy.cartUrl });
      return bestBuyWaiting(active, "bestbuy_cart_pending");
    }
    cartTabId = active.verificationTabId;
  }
  active.lastCartCheckAt = Date.now();
  await saveActiveJob(active);
  await injectAddAction(cartTabId, "bestbuy");
  const result = await executeReadOnlyCartAction(cartTabId, "bestbuy", ADD_LANES.bestbuy.verifyCartOperation,
    [addedCartJob(active), active.proof, active.cartBaseline], CART_PROOF_WAIT_MAX_MS);
  if (result?.ok) {
    // Recheck the original tab after the cart read. A newly appeared queue or
    // a changed product cannot be treated as a completed Add.
    await injectAddAction(original.id, "bestbuy");
    const after = await executeAddAction(original.id, "bestbuy", "inspectBestBuyPostAdd", [active.runnerJob]);
    if (after?.state === "queue") {
      active.bestBuyQueueSeen = true;
      active.waitingTabId = original.id;
      return bestBuyWaiting(active, "bestbuy_queue_waiting");
    }
    if (after?.state === "user_action") {
      if (["page_changed", "listing_mismatch"].includes(after.reason)) return stopBestBuyPostAdd(active, after.reason);
      active.waitingTabId = original.id;
      return bestBuyWaiting(active, "manual_action_required");
    }
    if (!["product", "cart"].includes(after?.state)) return bestBuyWaiting(active, "bestbuy_state_unavailable");
    if (bestBuyPostAddDeadline(active) - Date.now() <= 5_000) return stopBestBuyPostAdd(active, "bestbuy_wait_expired");
    const raised = await raiseCartQuantity(active, cartTabId, result);
    if (!raised?.ok) return stopBestBuyPostAdd(active, raised?.reason || "cart_unverified");
    const verified = await completeVerifiedCart(active, raised, cartTabId);
    return { ...verified, continueCycle: true };
  }
  if (["cart_unverified", "quantity_unavailable"].includes(result?.reason)) await captureCartEvidence(cartTabId, active, result.reason);
  if (["cart_unverified", "quantity_unavailable", "manual_action_required"].includes(result?.reason)
    || result?.reason === "cart_delta_unverified" && result.pending === true) {
    if (active.bestBuyQueueSeen && observation.addControlActionable) active.waitingTabId = original.id;
    return bestBuyWaiting(active, active.bestBuyQueueSeen && observation.addControlActionable ? "bestbuy_queue_next_step" : "bestbuy_cart_pending");
  }
  return stopBestBuyPostAdd(active, result?.reason || "cart_unverified");
}

// An unexpected error during a cart add used to be reported as a bare
// "extension_error", so a stop like Kevin's Walmart test call (2026-10-08)
// couldn't be told apart. The code now names the job's step and the kind of
// error; the error text itself stays in the browser.
function extensionErrorCode(active, error) {
  const phase = /^[a-z_]{1,32}$/.test(String(active?.phase || "")) ? active.phase : "unknown";
  const text = String(error?.message || error || "").toLowerCase();
  const kind = /no tab with id|tab was closed|tab .*closed|no current window/.test(text) ? "tab_closed"
    : /cannot access|permission|not allowed|missing host/.test(text) ? "access"
      : /timed? ?out|did not finish loading|deadline/.test(text) ? "timeout"
        : /frame|executescript|injection|scripting|runner/.test(text) ? "script"
          : /failed to fetch|\bnetwork\b|\bhttp \d{3}\b|yoink returned/.test(text) ? "network"
            : "other";
  return `extension_error_${phase}_${kind}`;
}

// The store's own answer before any Add is told as such, not as a Chrome
// error (Kevin's Walmart test call, 2026-10-12, ended as "Chrome stopped").
// A robot check needs the shopper, so its tab stays open and in front;
// a link that opened another item closes like any other try.
async function stopOnStorePage(active, reason) {
  const retailerId = active.retailerId || active.runnerJob?.retailerId;
  const name = ADD_LANES[retailerId]?.name || "retailer";
  if (reason === "security_challenge") {
    void reportRetailerReadiness(retailerId, { cartBaseline: active.cartBaseline, signedInState: "challenged", errorCode: "security_challenge" });
  }
  await publishActionStopped(active, reason).catch(() => undefined);
  await reportJob(active, "cancelled", reason, reason === "security_challenge"
    ? `${name} showed its robot or security check before the Add boundary; the tab stays open for the shopper.`
    : `${name} opened a different item than the job named; no Add click was authorized.`).catch(() => undefined);
  await clearActiveJob();
  if (reason === "security_challenge" && Number.isInteger(active.tabId)) {
    await forgetRetailerActionTab(active.tabId).catch(() => undefined);
    await chrome.tabs.update(active.tabId, { active: true }).catch(() => undefined);
  } else {
    await settleFailedAttemptTab(active, null);
  }
  return { confirmed: false, tabId: null, continueCycle: true };
}

async function failActiveJob(active, mutationPossible, reason = "extension_error") {
  const retailerId = active.retailerId || active.runnerJob?.retailerId;
  const name = ADD_LANES[retailerId]?.name || "retailer";
  if (mutationPossible) {
    await publishNeedsYou(active, reason).catch(() => undefined);
  } else {
    await publishActionStopped(active, reason).catch(() => undefined);
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
  reusableSignedInState = "unknown",
  restockTabId = null
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
  try {
    if (!await addLaneAccess(retailerId)) {
      await publishActionStopped(active, "retailer_access_missing").catch(() => undefined);
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
    } else {
      // Kevin, 2026-10-11: one tab from start to checkout, never a second tab
      // beside it. The job's own tab reads the cart first (the exact pre-add
      // baseline), then opens the product page, adds, and moves on to the cart
      // and checkout. A Retry when sold out try reuses its kept tab and stays
      // in the background until the add.
      const restockTab = Number.isInteger(restockTabId)
        ? await chrome.tabs.get(restockTabId).catch(() => null) : null;
      active.quietTab = Number.isInteger(restockTab?.id);
      await settleRequiredWork(
        reportJob(active, "navigating", "cart_baseline_started", `Chrome opened ${lane.name} cart to bind the exact pre-add baseline.`),
        openJobTab(active, active.quietTab ? restockTab.id : reusableTab ? reusableTabId : null, retailerId, lane.cartUrl, "cart")
      );
      let cartContext = await captureRetailerCartContext(
        active.tabId,
        retailerId,
        lane,
        CART_BASELINE_WAIT_MAX_MS
      );
      // Some carts (Target's) only draw in a visible tab: a background retry
      // tab is shown for one more read before giving up.
      if (cartContext?.baseline?.reason === "cart_unverified" && active.quietTab) {
        await chrome.tabs.update(active.tabId, { active: true }).catch(() => undefined);
        cartContext = await captureRetailerCartContext(active.tabId, retailerId, lane, CART_VISIBLE_RETRY_WAIT_MS);
      }
      const baseline = cartContext.baseline;
      if (!baseline?.ok || !baseline.proof) {
        active.signedInState = cartContext.signedInState;
        await chrome.tabs.update(active.tabId, { active: true }).catch(() => undefined);
        await captureCartEvidence(active.tabId, active, baseline?.reason || "cart_unverified");
        void reportRetailerReadiness(retailerId, {
          cartBaselineState: baseline?.reason === "cart_baseline_stale" ? "stale" : "unavailable",
          signedInState: active.signedInState,
          errorCode: baseline?.reason || "cart_unverified"
        });
        await publishActionStopped(active, baseline?.reason || "cart_unverified").catch(() => undefined);
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

    if(active.runnerJob?.approvedTest){
      const device=await storedDevice();
      if(device?.id!==active.runnerJob.approvedTest.deviceId)throw new Error("approved_test_device_changed");
      if(active.cartBaseline?.lines?.some(line=>line.retailerSku===active.runnerJob.retailerSku))throw new Error("approved_test_item_already_in_cart");
      const testTab=await chrome.tabs.update(active.tabId,{active:true});
      await chrome.windows.update(testTab.windowId,{focused:true});
      await chrome.scripting.executeScript({target:{tabId:active.tabId},world:"ISOLATED",func:()=>{
        const a=document.querySelector("#nav-link-accountList");
        if(a)a.focus();
      }});
      await new Promise(resolve=>setTimeout(resolve,400));
      active.signedInState=await inspectRetailerSessionState(active.tabId,"amazon");
      if(active.signedInState!=="ready")throw new Error("approved_test_signin_not_ready");
      await reportRetailerReadiness("amazon",{cartBaseline:active.cartBaseline,signedInState:active.signedInState});
    }
    await moveJobTab(active, active.navigationUrl, active.runnerJob.retailerSku);
    const [, prepared] = await settleRequiredWork(
      reportJob(active, "verifying_listing", "product_page_ready", `Chrome started exact live ${lane.name} offer verification.`,active.runnerJob?.approvedTest?{approvedTestBaseline:active.cartBaseline}:{}),
      (async () => {
        await injectAddAction(active.tabId, retailerId);
        if (retailerId === "bestbuy" && active.runnerJob.fulfillment === "shipping") {
          const selected = await executeAddAction(active.tabId, retailerId, "selectBestBuyShipping", [active.runnerJob.retailerSku]);
          if (!selected?.ok) return selected;
        }
        // Walmart may preselect Pickup for an item stocked nearby; a shipping job chooses
        // Shipping first. A page without a Shipping choice is left to the offer check.
        if (retailerId === "walmart" && active.runnerJob.fulfillment === "shipping") {
          const selected = await executeAddAction(active.tabId, retailerId, "selectWalmartShipping", [active.runnerJob.retailerSku]);
          if (!selected?.ok && !["fulfillment_unverified", "runner_unavailable"].includes(String(selected?.reason || ""))) return selected;
        }
        // Amazon may feature another seller's offer and list its own as a second
        // buying option (Kevin's Test call, 2026-10-11). Its own row is opened
        // first (a row header, never Add or Buy Now); the offer check decides.
        if (retailerId === "amazon" && !active.runnerJob.approvedTest) {
          const selected = await executeAddAction(active.tabId, retailerId, "selectAmazonOwnOffer", [active.runnerJob]);
          if (!selected?.ok && !["runner_unavailable", "runner_failed", "runner_no_result"].includes(String(selected?.reason || ""))) return selected;
        }
        return executePreparedAddAction(active.tabId, retailerId, [active.runnerJob]);
      })()
    );
    if (!prepared?.ok) {
      const reasonCode = safeReasonCode(prepared?.reason || "offer_unverified");
      // A diagnostic that can't be recorded must never turn the store's answer
      // into "Chrome stopped before adding".
      await recordTabOperationDiagnostic(
        active.tabId,
        retailerId,
        "live_add",
        EXPECTED_LIVE_REJECTIONS.has(reasonCode) ? "rejected" : "failed",
        runnerFailureStage(reasonCode),
        reasonCode,
        active.runnerJob.fulfillment
      ).catch(() => null);
      const reported = await reportJob(active, "offer_rejected", prepared?.reason || "offer_unverified", `The live ${lane.name} offer did not satisfy the immutable action contract.`, {
        offerReadAttempts: Number(prepared?.prepareAttempts) || 1,
        offerReadMs: Number(prepared?.prepareMs) || 0
      });
      await captureListingBarcode(active.tabId, retailerId, active.runnerJob.retailerSku).catch(() => null);
      // A sold-out item with Retry when sold out on is tried again later, so no stopped alert yet.
      if (reported?.state !== "awaiting_executor") await publishActionStopped(active, reasonCode).catch(() => undefined);
      await clearActiveJob();
      await settleFailedAttemptTab(active, reported);
      return { confirmed: false, tabId: null, continueCycle: true };
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
    // The item's barcode, read off the page while it is open; never on the cart path.
    void captureListingBarcode(active.tabId, retailerId, active.runnerJob.retailerSku).catch(() => null);
    active.proof = prepared.proof;
    active.authorizationId = prepared.authorizationId;
    active.quantityPlan = cartQuantityPlan(prepared, active.runnerJob);
    markJobTiming(active, "offerVerifiedAt");
    await saveActiveJob(active);
    const [, postClickSettle] = await settleRequiredWork(
      reportJobBatch(active, [
        {
          state: "offer_verified",
          reasonCode: "live_offer_verified",
          message: `The exact ${lane.name} SKU, seller, price, stock, and fulfillment passed live verification.`,
          evidence: {...safeOfferEvidence(active.proof),...(active.runnerJob?.approvedTest?{approvedTestOfferProof:active.proof}:{})}
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
    const committed = await executeAddAction(active.tabId, retailerId, lane.commitOperation, [active.runnerJob, active.authorizationId])
      .catch((error) => {
        if (retailerId !== "bestbuy") throw error;
        return { ok: false, reason: "click_uncertain", clicked: false };
      });
    active.authorizationId = "";
    await saveActiveJob(active);
    if (!committed?.ok || committed?.clicked !== true) {
      await postClickSettle.cancel();
      if (retailerId === "bestbuy" && ["click_uncertain", "runner_no_result", "runner_failed", "click_failed"].includes(committed?.reason)) {
        return await advanceBestBuyPostAdd(active);
      }
      if (retailerId === "bestbuy") return stopBestBuyPostAdd(active, committed?.reason || "click_uncertain");
      const reasonCode = safeReasonCode(committed?.reason || "click_uncertain");
      await recordTabOperationDiagnostic(active.tabId, retailerId, "live_add", "failed", runnerFailureStage(reasonCode), reasonCode, active.runnerJob.fulfillment)
        .catch(() => null);
      await publishNeedsYou(active, reasonCode).catch(() => undefined);
      await reportJob(active, "manual_review", committed?.reason || "click_uncertain", "The Add boundary did not return a confirmed click result; automatic retry is locked.");
      await clearActiveJob();
      return { confirmed: false, tabId: active.tabId, continueCycle: false };
    }
    active.proof = committed.proof;
    markJobTiming(active, "clickedAt");
    await saveActiveJob(active);
    if (retailerId === "bestbuy") await publishBestBuyWait(active, "bestbuy_add_triggered");
    const settled = await postClickSettle.wait();
    markJobTiming(active, "settledAt");
    active.postClickSettle = settled;
    await saveActiveJob(active);
    if (retailerId === "bestbuy") return await advanceBestBuyPostAdd(active);
    const verification = await verifyAddedCart(active);
    return {
      confirmed: verification.confirmed,
      // A tab handed off on checkout (tabId null) is the shopper's: the next add never borrows it.
      tabId: Object.hasOwn(verification, "tabId") ? verification.tabId : active.tabId,
      continueCycle: verification.confirmed,
      cartBaseline: verification.cartBaseline,
      signedInState: verification.signedInState || active.signedInState || "unknown"
    };
  } catch (error) {
    const mutationPossible = ["adding", "cart_verified"].includes(active.phase);
    if (retailerId === "bestbuy" && mutationPossible) return stopBestBuyPostAdd(active, "extension_error");
    if (!mutationPossible && error?.storeStop) return stopOnStorePage(active, error.storeStop);
    await failActiveJob(active, mutationPossible, extensionErrorCode(active, error));
    if (mutationPossible) return { confirmed: false, tabId: active.tabId, continueCycle: false };
    // Nothing was added: the attempt is over, so is its tab.
    await settleFailedAttemptTab(active, null);
    return { confirmed: false, tabId: null, continueCycle: true };
  }
}

async function resumeActiveRetailerJob() {
  const active = await activeJob();
  if (!active) return false;
  if (active.retailerId === "bestbuy" && ["adding", "cart_verified"].includes(active.phase) && active.proof) {
    try { await advanceBestBuyPostAdd(active); }
    catch { await stopBestBuyPostAdd(active, "recovery_failed"); }
    return true;
  }
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
    let notification;
    try {
      notification = normalizedNotificationLease(payload);
    } catch {
      // A delivery this companion cannot display is closed as failed instead
      // of being re-leased up to three times ahead of every other delivery.
      const rejected = payload?.notification;
      if (/^[A-Za-z0-9_-]{3,160}$/.test(String(rejected?.id || ""))
        && /^[A-Za-z0-9_-]{40,100}$/.test(String(rejected?.capabilityToken || ""))) {
        await acknowledgeNotification(device, { id: String(rejected.id), capabilityToken: String(rejected.capabilityToken) },
          "failed", "invalid_delivery").catch(() => undefined);
        void closureAcknowledgement;
        continue;
      }
      throw new Error("Yoink returned an invalid notification delivery.");
    }
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
        iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
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
        .then((value) => {
          void recordLoopOutcome("notifications", { reason: value.reason });
          return value;
        }, (error) => {
          void recordLoopOutcome("notifications", loopOutcomeFromError("cycle_failed", error));
          return { delivered: 0, reason: "cycle_failed" };
        });
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

async function publishWatchSeen(lease, now = Date.now()) {
  const identity = canonicalRetailerIdentity(lease?.canonicalUrl);
  if (!identity || identity.retailerId !== lease?.retailerId
    || identity.retailerSku !== String(lease?.retailerSku || "").toUpperCase()) return false;
  const stored = (await chrome.storage.local.get(WATCH_READY_ROUTES_KEY))[WATCH_READY_ROUTES_KEY];
  const routes = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const retained = Object.fromEntries(Object.entries(routes).filter(([, route]) =>
    route && typeof route === "object"
      && Number.isFinite(new Date(String(route.expiresAt || "")).getTime())
      && new Date(String(route.expiresAt)).getTime() > now));
  retained[lease.id] = {
    url: identity.canonicalUrl,
    expiresAt: new Date(now + 35 * 60_000).toISOString()
  };
  await chrome.storage.local.set({ [WATCH_READY_ROUTES_KEY]: retained });
  const lane = ADD_LANES[identity.retailerId];
  const retailerName = lane?.name || identity.retailerId.slice(0, 1).toUpperCase() + identity.retailerId.slice(1);
  await chrome.notifications?.create?.(`${WATCH_READY_NOTIFICATION_PREFIX}${lease.id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
    title: `In stock at ${retailerName}`,
    message: `Item ${identity.retailerSku} was seen in stock. Open the store page while it is available.`,
    contextMessage: "Yoink watch",
    priority: 2,
    requireInteraction: true
  });
  return true;
}

async function openWatchSeen(watchId) {
  const stored = (await chrome.storage.local.get(WATCH_READY_ROUTES_KEY))[WATCH_READY_ROUTES_KEY];
  const routes = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const route = routes[watchId];
  const identity = canonicalRetailerIdentity(route?.url);
  if (!identity || new Date(String(route?.expiresAt || "")).getTime() <= Date.now()) {
    delete routes[watchId];
    await chrome.storage.local.set({ [WATCH_READY_ROUTES_KEY]: routes });
    throw new Error("This watched item is no longer available from the notification.");
  }
  delete routes[watchId];
  await chrome.storage.local.set({ [WATCH_READY_ROUTES_KEY]: routes });
  await chrome.tabs.create({ url: identity.canonicalUrl, active: true });
  await chrome.notifications.clear(`${WATCH_READY_NOTIFICATION_PREFIX}${watchId}`).catch(() => undefined);
  return true;
}

async function collectWatchObservation(tabId, lease) {
  if (lease.retailerId === "bestbuy") {
    const selected = await selectBestBuyShippingTab(tabId, lease.retailerSku);
    if (!selected?.ok) throw new Error(selected?.reason || "fulfillment_selection_failed");
  }
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
      if (reported?.item?.state === "seen_in_stock") {
        await publishWatchSeen(lease).catch(() => undefined);
      }
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
  })().then((result) => {
    void recordLoopOutcome("watch", { reason: result.reason });
    return result;
  }, (error) => {
    void recordLoopOutcome("watch", loopOutcomeFromError("watch_cycle_failed", error));
    return { observed: false, reason: "watch_cycle_failed" };
  }).finally(() => { watchQueueCyclePromise = null; });
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
    const [storedTabs, cartReady, cursorStorage, checkedStorage] = await Promise.all([
      readRetailerActionTabs(),
      readCartReadyState(),
      chrome.storage.session.get(WARM_READINESS_CURSOR_KEY),
      chrome.storage.session.get(WARM_READINESS_CHECKED_KEY)
    ]);
    const storedChecks = checkedStorage[WARM_READINESS_CHECKED_KEY];
    const checkedAt = storedChecks && typeof storedChecks === "object" ? { ...storedChecks } : {};
    let recentlyChecked = 0;
    const retailerIds = Object.keys(ADD_LANES);
    const cursor = Number.isSafeInteger(cursorStorage[WARM_READINESS_CURSOR_KEY])
      ? cursorStorage[WARM_READINESS_CURSOR_KEY] % retailerIds.length : 0;
    const protectedTabs = new Set(cartReady.items.map((item) => item.tabId));
    // A tab kept for a sold-out item's next try is never borrowed for other work.
    for (const kept of Object.values(await readRestockTabs())) protectedTabs.add(kept?.tabId);

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
      const keptCartTab = retailerCartTab(tab, retailerId);
      const lastCheckedAt = Number(checkedAt[retailerId]);
      if (!keptCartTab && Number.isFinite(lastCheckedAt) && Date.now() - lastCheckedAt < WARM_READINESS_RECHECK_MS) {
        recentlyChecked += 1;
        continue;
      }
      let createdTabId = null;
      try {
        if (!keptCartTab) {
          checkedAt[retailerId] = Date.now();
          await chrome.storage.session.set({ [WARM_READINESS_CHECKED_KEY]: checkedAt });
          tab = await chrome.tabs.create({ url: lane.cartUrl, active: false });
          if (!Number.isInteger(tab?.id)) throw new Error("warm_cart_tab_unavailable");
          createdTabId = tab.id;
        }
        await waitForTab(tab.id, retailerId, "cart");
        if (jobCyclePromise || await activeJob().catch(() => null)) {
          results.push({ warmed: false, retailerId, signedInState: stored?.signedInState || "unknown", reason: "action_job_started" });
          break;
        }
        warmingTabIds.add(tab.id);
        let signedInState = await inspectRetailerSessionState(tab.id, retailerId).catch(() => "unknown");
        let cartBaseline = freshCartBaseline(stored?.cartBaseline, retailerId);
        let errorCode = "";
        if (!cartBaseline) {
          if (await activeJob().catch(() => null)) {
            results.push({ warmed: false, retailerId, signedInState, reason: "action_job_started" });
            break;
          }
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
        // A job that started during the read owns the tab record now.
        if (await activeJob().catch(() => null)) {
          results.push({ warmed: false, retailerId, signedInState, reason: "action_job_started" });
          break;
        }
        // Only a cart tab an earlier add left open is kept for reuse; a tab
        // this check opened closes below.
        if (!Number.isInteger(createdTabId)) await rememberRetailerActionTab(retailerId, tab.id, cartBaseline, signedInState);
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
        results.push({ warmed: false, retailerId, signedInState, reason });
      } finally {
        if (Number.isInteger(tab?.id)) warmingTabIds.delete(tab.id);
        if (Number.isInteger(createdTabId)) await chrome.tabs.remove(createdTabId).catch(() => undefined);
      }
    }
    const warmedCount = results.filter((result) => result.warmed).length;
    return {
      warmed: warmedCount > 0,
      warmedCount,
      attemptedCount: results.length,
      reason: !results.length ? recentlyChecked ? "recently_checked" : "retailer_access_missing"
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
    let rejectedLeases = 0;
    // The authenticated lease is the action preflight: the server rechecks
    // live mode, pause, device status/capabilities, lane qualification, spend,
    // job expiry, and single-device ownership atomically. General health and
    // heartbeat refresh stay on their minute alarm instead of adding two
    // unrelated round trips in front of every signal-triggered lease.
    const device = await storedDevice();
    if (!device?.token) return { leased, confirmed, reason: "device_unavailable" };
    const cachedReadiness = (await chrome.storage.local.get(READINESS_KEY))[READINESS_KEY];
    if (cachedReadiness?.companionCompatible === false) {
      return { leased, confirmed, reason: "companion_incompatible" };
    }
    // A sold-out item whose retries never came back leaves no tab behind.
    await closeStaleRestockTabs().catch(() => undefined);
    const accessibleRetailers = await accessibleAddRetailers();
    if (!accessibleRetailers.length) return { leased, confirmed, reason: "retailer_access_missing" };
    const [storedTabs, cartReady] = await Promise.all([
      readRetailerActionTabs(),
      readCartReadyState()
    ]);
    const protectedTabs = new Set(cartReady.items.map((item) => item.tabId));
    // A tab kept for a sold-out item's next try is never borrowed for other work.
    for (const kept of Object.values(await readRestockTabs())) protectedTabs.add(kept?.tabId);
    const reusableTabs = new Map([...storedTabs]
      .filter(([, stored]) => !protectedTabs.has(stored.tabId) && !warmingTabIds.has(stored.tabId))
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
      let lease;
      try {
        lease = normalizedLeaseJob(response);
      } catch {
        // A lease this companion cannot run (contract, adapter or identity
        // skew) would otherwise stay leased until its TTL and keep the server
        // answering device_busy. Hand it back, then try the next job.
        await rejectUnsupportedLease(device, response?.job);
        rejectedLeases += 1;
        continue;
      }
      if (!lease) {
        const leaseReason = ["no_jobs", "actions_paused", "shadow_mode", "device_busy", "device_unavailable", "companion_incompatible"]
          .includes(String(response?.reason || "")) ? String(response.reason) : "jobs_unavailable";
        return {
          leased,
          confirmed,
          reason: rejectedLeases ? "lease_contract_rejected" : leaseReason
        };
      }
      leased += 1;
      // Retry when sold out: reload the tab kept from the last try instead of opening a new one.
      const restockTabId = lease.restockRetry ? await takeRestockTab(lease.id) : null;
      const reusableCandidate = Number.isInteger(restockTabId) ? null : reusableTabs.get(lease.retailerId);
      const reusable = warmingTabIds.has(reusableCandidate?.tabId) ? null : reusableCandidate;
      const outcome = await executeLeasedRetailerJob(
        lease,
        reusable?.tabId,
        reusable?.cartBaseline,
        reusable?.signedInState,
        restockTabId
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
    return { leased, confirmed, reason: rejectedLeases ? "lease_contract_rejected" : "cycle_limit" };
  })().then((result) => {
    void recordLoopOutcome("jobs", { reason: result.reason });
    return result;
  }, (error) => {
    void recordLoopOutcome("jobs", loopOutcomeFromError("cycle_failed", error));
    return { leased: 0, confirmed: 0, reason: "cycle_failed" };
  }).finally(() => { jobCyclePromise = null; });
  return jobCyclePromise;
}

async function rejectUnsupportedLease(device, job) {
  const jobId = String(job?.id || "");
  const capabilityToken = String(job?.capabilityToken || "");
  if (!device?.token || !/^[A-Za-z0-9_-]{3,120}$/.test(jobId) || !/^[A-Za-z0-9_-]{40,100}$/.test(capabilityToken)) return false;
  return request(`/devices/self/jobs/${encodeURIComponent(jobId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device.token}` },
    body: JSON.stringify({
      capabilityToken,
      state: "cancelled",
      reasonCode: "lease_contract_rejected",
      message: "Chrome could not accept this add job (contract, adapter or listing identity mismatch) and released it before any store action.",
      evidence: {}
    })
  }, JOB_REPORT_TIMEOUT_MS).then(() => true, () => false);
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
  // The push event's waitUntil must settle well inside Chrome's 5-minute event
  // limit, or Chrome kills the worker mid-add. A long multi-job or Best Buy
  // cycle keeps running past this bound; the job alarm stays the durable path.
  const cycle = runSignalDeliveryCycle(true).catch(() => undefined);
  let boundTimer;
  const bound = new Promise((resolve) => { boundTimer = setTimeout(resolve, PUSH_EVENT_WAIT_BOUND_MS); });
  await Promise.allSettled([notification, Promise.race([cycle, bound])]);
  clearTimeout(boundTimer);
}

function reconcileTrackalackerSubscription() {
  if (trackalackerReconciliationPromise) return trackalackerReconciliationPromise;
  trackalackerReconciliationPromise = (async () => {
    let current = await readTrackalackerState();
    if (!current.enabled || trackalackerEnrollmentPromise || Date.now() < trackalackerSubscriptionRetryAt) return current;
    // Extension reload can delete the registration without delivering a
    // pushsubscriptionchange event. Never treat persisted presence as proof.
    // This observes only the extension registration: no enrollment or tab work.
    let timer;
    let observed;
    try {
      observed = await Promise.race([
        (async () => {
          const manager = globalThis.registration?.pushManager;
          if (typeof manager?.getSubscription !== "function") return { present: false, errorCode: "push_api_unavailable" };
          const subscription = await manager.getSubscription();
          if (!subscription) return { present: false };
          const fingerprint = await TrackalackerPush.subscriptionFingerprint(subscription).catch(() => "");
          return fingerprint ? { present: true, fingerprint }
            : { present: true, errorCode: "subscription_fingerprint_failed" };
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("push_read_timeout")), TRACKALACKER_SUBSCRIPTION_READ_TIMEOUT_MS); })
      ]);
    } catch {
      observed = { present: false, errorCode: "push_subscription_read_failed" };
    } finally {
      clearTimeout(timer);
    }
    current = await readTrackalackerState();
    if (!current.enabled || trackalackerEnrollmentPromise) return current;
    trackalackerSubscriptionRetryAt = observed.errorCode ? Date.now() + TRACKALACKER_SUBSCRIPTION_RETRY_MS : 0;
    let changes = { subscriptionPresent: observed.present };
    if (observed.errorCode) {
      changes = { ...changes, state: "error", ready: false, errorCode: observed.errorCode };
    } else if (!observed.present || observed.fingerprint !== current.registeredFingerprint) {
      changes = { ...changes, state: "awaiting_page", ready: false, registeredFingerprint: "", errorCode: observed.present ? "" : "missing_subscription" };
    } else if (current.state === "error" && ["push_api_unavailable", "push_subscription_read_failed", "subscription_fingerprint_failed"].includes(current.errorCode)) {
      // Only a matching, previously acknowledged registration can recover from
      // a transient observation failure. Enrollment errors still need Reconnect.
      changes = { ...changes, state: "ready", ready: true, errorCode: "" };
    }
    return Object.entries(changes).some(([key, value]) => current[key] !== value)
      ? updateTrackalackerState(changes) : current;
  })().finally(() => { trackalackerReconciliationPromise = null; });
  return trackalackerReconciliationPromise;
}

async function handleTrackalackerSubscriptionChange() {
  trackalackerSubscriptionRetryAt = 0;
  await postTrackalackerStatus(await reconcileTrackalackerSubscription());
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
      id: CONTEXT_MENU_IDS.saveRepair,
      title: "Save this page for a store repair",
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
    updateContextMenu(CONTEXT_MENU_IDS.saveRepair, { visible: productCommands.includes("save_repair_page") }),
    updateContextMenu(CONTEXT_MENU_IDS.inspectDrawings, { visible: drawingCommands.includes("inspect_drawings") }),
    updateContextMenu(CONTEXT_MENU_IDS.reconnect, { visible: idleCommands.includes("reconnect_trackalacker") }),
    updateContextMenu(CONTEXT_MENU_IDS.sync, { visible: idleCommands.includes("sync_products") })
  ]);
}

function contextMenuCommand(menuItemId) {
  if (menuItemId === CONTEXT_MENU_IDS.open) return "open_yoink";
  if (menuItemId === CONTEXT_MENU_IDS.inspectProduct) return "inspect_product";
  if (menuItemId === CONTEXT_MENU_IDS.saveRepair) return "save_repair_page";
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
  if (["inspect_product", "save_repair_page"].includes(command) && ["product", "product_link"].includes(page.kind)) {
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
      && (command === "inspect_product" || command === "save_repair_page" || command === "inspect_drawings")) {
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
    if (command === "save_repair_page") {
      await saveCurrentPageForRepair(current.tab.id);
      await showContextMenuOutcome({ summary: "Saved on this computer" });
      return;
    }
    if (command === "inspect_drawings") {
      const result = await inspectWalmartDrawPopupOperation();
      await showContextMenuOutcome(result.popupResult);
      return;
    }
    if (command === "reconnect_trackalacker") {
      const result = await reconnectTrackalackerFromShopper();
      await showContextMenuOutcome({ summary: result.diagnostic || "TrackaLacker connected" });
      return;
    }
    if (command === "sync_products") {
      const result = await startTrackalackerSync({ mode: "full" });
      await showContextMenuOutcome({ summary: result.alreadyRunning ? "Product sync already running" : "Product sync started" });
    }
  } catch (error) {
    await showContextMenuOutcome({ message: error instanceof Error ? error.message : "Action failed" }, true);
  }
}

function companionAlarmSpecs() {
  return [
    [HEALTH_ALARM, { periodInMinutes: 1 }],
    [JOB_ALARM, { periodInMinutes: 0.5 }],
    [WATCH_QUEUE_ALARM, { periodInMinutes: 0.5 }],
    [TRACKALACKER_SYNC_ALARM, { delayInMinutes: 1, periodInMinutes: 10 }],
    [BARCODE_CHECK_ALARM, { delayInMinutes: 3, periodInMinutes: 20 }],
    [AUTO_REVERIFICATION_ALARM, {
      delayInMinutes: AUTO_REVERIFICATION_FIRST_RUN_DELAY_MINUTES,
      periodInMinutes: AUTO_REVERIFICATION_ATTENTION_PERIOD_MINUTES
    }]
  ];
}

// Every loop hangs off these alarms. Each is created independently so one
// failure cannot leave the others missing; recreate replaces the schedule.
async function createCompanionAlarms() {
  for (const [name, spec] of companionAlarmSpecs()) {
    try {
      await chrome.alarms.create(name, spec);
    } catch {
      // The next worker start re-checks through ensureCompanionAlarms.
    }
  }
}

// Runs on every service-worker start, not only install/startup: Chrome may
// drop alarms across restarts, and a failed initialize() must not leave the
// companion without its heartbeat, job and notification loops.
async function ensureCompanionAlarms() {
  if (typeof chrome.alarms?.get !== "function") return;
  for (const [name, spec] of companionAlarmSpecs()) {
    try {
      if (!await chrome.alarms.get(name)) await chrome.alarms.create(name, spec);
    } catch {
      // Best effort; initialize() creates them again on install/startup.
    }
  }
}

async function initialize() {
  await createCompanionAlarms();
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
  await ensureContextMenus();
  await reconcileTrackalackerSubscription();
  const health = await checkHealth();
  await reconcileActionHandoffs();
  void reconcileActionHandoffs(ACTION_HANDOFF_WAIT_MS);
  await reconcileReverificationRestart();
  await drainAdapterDiagnosticQueue();
  await drainEvidenceCapsuleQueue();
  const signalDelivery = await runSignalDeliveryCycle();
  // A cold worker may have server-originated Discord/API/admin work waiting
  // even when its local TrackaLacker queue is empty. Establish both bounded
  // watches together so startup has the same event-driven handoff semantics
  // as a locally accepted signal.
  if (!signalDelivery?.delivered) await runSignalActionHandoff();
  void runWatchQueueCycle();
  void requestWarmReadinessCycle(health).catch(() => undefined);
  void runAutomaticReverification(false).catch(() => undefined);
}

function initializeCompanion() {
  return initialize().catch((error) => recordLoopOutcome("health", loopOutcomeFromError("health_failed", error)));
}

chrome.runtime.onInstalled.addListener(() => { void initializeCompanion(); });
chrome.runtime.onStartup.addListener(() => { void initializeCompanion(); });
void ensureCompanionAlarms();
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
    const contextCommand = ["product", "product_link"].includes(page.kind)
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
    const healthFailed = (error) => recordLoopOutcome("health", loopOutcomeFromError("health_failed", error));
    void drainAdapterDiagnosticQueue().catch(healthFailed);
    void drainEvidenceCapsuleQueue().catch(healthFailed);
    void reconcileTrackalackerSubscription().then(() => checkHealth()).then((health) =>
      runSignalDeliveryCycle().finally(() => requestWarmReadinessCycle(health))).catch(healthFailed);
    void reconcileTrackalackerSubscription().then(reconnectTrackalackerAutomatically).catch(() => undefined);
    // Re-read the lightweight plan on the health cadence so a newly logged
    // layout failure or packaged adapter change starts its bounded repair
    // batch promptly. The stable plan signature prevents duplicate tab work.
    void runAutomaticReverification(false).catch(healthFailed);
    void runNotificationCycle().catch(() => undefined);
  }
  if (alarm.name === JOB_ALARM) {
    runJobAlarmCycle();
  }
  if (alarm.name === WATCH_QUEUE_ALARM) {
    void runWatchQueueCycle();
  }
  if (alarm.name === TRACKALACKER_SYNC_ALARM) {
    void runScheduledTrackalackerSync().catch(() => undefined);
  }
  if (alarm.name === BARCODE_CHECK_ALARM) {
    void runBarcodeChecks().catch(() => undefined);
  }
  if (alarm.name === AUTO_REVERIFICATION_ALARM) {
    void runAutomaticReverification(false).catch(() => undefined);
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const inspectAndQualify = message?.type === "yoink:inspect-and-qualify";
  const inspection = message?.type === "yoink:inspect-target";
  const walmartDrawInspection = message?.type === "yoink:inspect-walmart-draw";
  const retailerInspection = message?.type === "yoink:inspect-retailer";
  const repairPageSave = message?.type === "yoink:save-repair-page";
  const communityContribution = message?.type === "yoink:contribute-retailer";
  const rehearsalRetailerId = /^yoink:rehearse-([a-z][a-z0-9]{1,31})$/.exec(
    String(message?.type || "")
  )?.[1] || "";
  const trackalackerConnection = message?.type === "yoink:connect-trackalacker";
  const trackalackerSync = message?.type === "yoink:sync-trackalacker";
  const extensionUpdate = message?.type === "yoink:check-update";
  const cartReadyOpen = message?.type === "yoink:open-cart-ready";
  const bestBuyWaitOpen = message?.type === "yoink:open-bestbuy-wait";
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
    "yoink:trackalacker-sync-plan",
    "yoink:resolve-trackalacker-listing",
    "yoink:trackalacker-sync-progress",
    "yoink:trackalacker-sync-item",
    "yoink:trackalacker-sync-sample"
  ].includes(message?.type);
  const actionsPauseSet = message?.type === "yoink:set-actions-paused";
  const pageOperation = inspectAndQualify || inspection || walmartDrawInspection || retailerInspection || repairPageSave || communityContribution || Boolean(rehearsalRetailerId) || trackalackerConnection || trackalackerSync || extensionUpdate || cartReadyOpen || bestBuyWaitOpen || cartOutcomeReport || purchaseOpportunityGet || purchaseOpportunityOpen || localDataDeletion || reverificationPlan || retailerReverification || automaticReverificationGet || automaticReverificationSet || automaticReverificationRun || actionsPauseSet || contentOperation;
  // Every non-content operation is a popup/options command. Content scripts
  // (TrackaLacker sync, injected retailer runners) share this channel and must
  // never reach pairing, pause/resume, local-data deletion or tab-opening work.
  const handledOperation = pageOperation || ["yoink:check-health", "yoink:pair-device", "yoink:forget-device"]
    .includes(message?.type);
  if (handledOperation
    && (contentOperation ? !senderIsTrackalacker(sender) : !senderIsExtensionPage(sender))) {
    sendResponse({ ok: false, message: "This Yoink Companion command is only available from the companion itself." });
    return false;
  }
  const operation = message?.type === "yoink:check-health"
    ? checkHealth()
    : actionsPauseSet
      ? setActionsPausedFromPopup(message.paused === true, message.confirmationToken)
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
          : repairPageSave
            ? saveCurrentPageForRepair()
          : communityContribution
            ? contributeRetailerTab()
          : ADD_LANES[rehearsalRetailerId]
            ? rehearseAddTab(rehearsalRetailerId)
            : trackalackerConnection
              ? reconnectTrackalackerFromShopper()
              : trackalackerSync
                ? startTrackalackerSync({ mode: "full" })
                : extensionUpdate
                  ? checkExtensionUpdate(message.download === true, message.requestManaged === true)
                : cartReadyOpen
                  ? focusCartReady(message.jobId)
                : bestBuyWaitOpen
                  ? focusBestBuyWait(message.jobId)
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
                  ? runRetailerReverification(message.retailerIds, { automatic: false, trigger: "manual" })
                : automaticReverificationGet
                  ? automaticReverificationStatus()
                : automaticReverificationSet
                  ? setAutoReverificationEnabled(message.enabled)
                : automaticReverificationRun
                  ? runAutomaticReverification(true, "manual")
                : message?.type === "yoink:trackalacker-sync-plan"
                  ? trackalackerSyncPlan(message, sender)
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
  if (notificationId === UNPAIRED_NOTIFICATION_ID) {
    void chrome.tabs.create({ url: appViewUrl("settings"), active: true })
      .then(() => chrome.notifications.clear(notificationId).catch(() => undefined))
      .catch(() => undefined);
    return;
  }
  const bestBuyWaitMatch = /^yoink-bestbuy-wait:([A-Za-z0-9_-]{3,120})$/.exec(String(notificationId || ""));
  if (bestBuyWaitMatch) {
    void focusBestBuyWait(bestBuyWaitMatch[1]).catch(() => undefined);
    return;
  }
  const stoppedMatch = /^yoink-action-stopped:([A-Za-z0-9_-]{3,120})$/.exec(String(notificationId || ""));
  if (stoppedMatch) {
    void chrome.tabs.create({ url: appViewUrl("actions"), active: true })
      .then(() => chrome.notifications.clear(notificationId).catch(() => undefined))
      .catch(() => undefined);
    return;
  }
  const watchMatch = /^yoink-watch-ready:(watch_item_[a-f0-9]{32})$/.exec(String(notificationId || ""));
  if (watchMatch) {
    void openWatchSeen(watchMatch[1]).catch(async () => {
      await chrome.notifications.clear(notificationId).catch(() => undefined);
    });
    return;
  }
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
  const watchMatch = /^yoink-watch-ready:(watch_item_[a-f0-9]{32})$/.exec(String(notificationId || ""));
  if (watchMatch) {
    void chrome.storage.local.get(WATCH_READY_ROUTES_KEY).then((stored) => {
      const routes = stored[WATCH_READY_ROUTES_KEY];
      if (!routes || typeof routes !== "object" || Array.isArray(routes)) return;
      delete routes[watchMatch[1]];
      return chrome.storage.local.set({ [WATCH_READY_ROUTES_KEY]: routes });
    }).catch(() => undefined);
    return;
  }
  const match = /^yoink-opportunity:([A-Za-z0-9_-]{3,160})$/.exec(String(notificationId || ""));
  if (match) void Promise.allSettled([
    forgetNotificationRoute(match[1]),
    reportNotificationInteraction(match[1], "dismissed")
  ]);
});

chrome.tabs.onRemoved?.addListener((tabId) => {
  qualificationLaunchTabs.delete(tabId);
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

// Every completed navigation in every tab wakes this worker. Only supported
// store pages (including their secure checkout hosts) and marked qualification
// launches need work; everything else returns before any storage read.
function tabUpdateNeedsWork(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return false;
    if (url.hash === `#${QUALIFICATION_LAUNCH_HASH}`) return true;
    const host = url.hostname.toLowerCase();
    return [...SUPPORTED_RETAILER_DOMAINS, "gap.com", "gapfactory.com", "audioadvice.com"]
      .some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" && tab?.status !== "complete") return;
  const url = tab?.url || changeInfo.url;
  if (!tabUpdateNeedsWork(url)) return;
  scheduleMarkedQualification(tabId, url);
  void observeOrderConfirmation(tabId, url).catch(() => undefined);
  void refreshRetailerSessionFromTab(tabId, url).catch(() => undefined);
});
