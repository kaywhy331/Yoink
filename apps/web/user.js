const state = {
  overview: null,
  products: [],
  productGroups: [],
  productTotal: 0,
  productStores: [],
  productRequestSequence: 0,
  browse: { store: "", availability: "", plan: "", price: "", sort: "newest" },
  profiles: [],
  quickAddBusy: false,
  quickMenuTrigger: null,
  productStoreSelections: new Map(),
  plans: [],
  legacyTransition: null,
  actions: [],
  actionInsights: null,
  actionGlossary: {},
  actionStageFilter: "all",
  actionHandoffAvailabilityEpoch: "",
  actionHandoffAvailabilityVersion: 0,
  actionHandoffRequestSequence: 0,
  actionHandoffAppliedSequence: 0,
  actionHandoffPreload: undefined,
  actionActivityRequestSequence: 0,
  actionActivityAppliedSequence: 0,
  cartOutcomeActionId: "",
  cartOutcomeReturnFocus: null,
  proposals: [],
  editingPlan: null,
  setupProduct: null,
  setupPreflight: null,
  setupPreflightSignature: "",
  setupPreflightScheduledSignature: "",
  setupPreflightPendingSignature: "",
  setupPreflightRevision: 0,
  setupPreflightTimer: null,
  productLinkPreview: null,
  productLinkPreviewInput: "",
  privacy: null,
  privacyCompliance: null,
  calls: [],
  dropWindows: [],
  dropClockTimer: null,
  walmartHandoffExpiryTimer: null,
  homeWalmartHandoffExpiryTimer: null,
  openedWalmartPurchaseJobs: new Set(),
  homeRecentActions: [],
  actionPlatform: null,
  affiliateRouting: null,
  query: "",
  loadedRoutes: new Set(),
  routeLoadPromise: null,
  productPageSize: 48,
  productView: "grid",
  callFilter: "all",
  callDisplayLimit: 25,
  actionDisplayLimit: 25,
  planFilter: "all",
  planBulkMode: false,
  planSelection: new Set(),
  planBulkProfileId: "",
  planBulkDraft: null,
  settingsView: "purchase"
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const requestConfirmation = (options) => {
  if (typeof globalThis.YoinkDialogs?.confirmDialog !== "function") {
    throw new Error("The confirmation dialog is unavailable.");
  }
  return globalThis.YoinkDialogs.confirmDialog(options);
};
const DISMISSED_ANNOUNCEMENT_KEY = "yoinkDismissedAnnouncementV1";
const ANNOUNCEMENT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;
const PRODUCT_VIEW_KEY = "yoinkProductViewV1";
try { state.productView = localStorage.getItem(PRODUCT_VIEW_KEY) === "list" ? "list" : "grid"; } catch { /* Grid remains the default. */ }
const RETAILER_CART_URLS = Object.freeze({
  target: "https://www.target.com/cart",
  walmart: "https://www.walmart.com/cart",
  amazon: "https://www.amazon.com/gp/cart/view.html",
  bestbuy: "https://www.bestbuy.com/cart"
});
const GUARDED_RETAILER_DIRECT_HOSTS = new Set(["target.com", "walmart.com", "amazon.com", "bestbuy.com"]);
const ACTION_HANDOFF_AVAILABILITY_EPOCH_PATTERN = /^[a-f0-9]{32}$/;

function nextActionHandoffRequestSequence() {
  state.actionHandoffRequestSequence += 1;
  return state.actionHandoffRequestSequence;
}

function normalizedActionHandoffEpoch(value) {
  const epoch = String(value ?? "");
  return epoch === "" || ACTION_HANDOFF_AVAILABILITY_EPOCH_PATTERN.test(epoch) ? epoch : null;
}

function normalizedActionHandoffVersion(value) {
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function applyActionHandoffCursor(epochValue, versionValue, requestSequence) {
  const epoch = normalizedActionHandoffEpoch(epochValue);
  const version = normalizedActionHandoffVersion(versionValue);
  if (epoch === null || version === null || !Number.isSafeInteger(requestSequence)) return false;
  const currentEpoch = state.actionHandoffAvailabilityEpoch;
  const currentVersion = state.actionHandoffAvailabilityVersion;
  const appliedSequence = state.actionHandoffAppliedSequence;
  if (epoch === currentEpoch) {
    if (version < currentVersion) return false;
    if (version === currentVersion && requestSequence < appliedSequence) return false;
    state.actionHandoffAvailabilityVersion = version;
    state.actionHandoffAppliedSequence = Math.max(appliedSequence, requestSequence);
    return true;
  }
  // Versions restart from zero with a new API process. A new epoch is valid
  // only from a request started no earlier than the last applied response;
  // this prevents a late response from the replaced process moving UI back.
  if (requestSequence < appliedSequence) return false;
  state.actionHandoffAvailabilityEpoch = epoch;
  state.actionHandoffAvailabilityVersion = version;
  state.actionHandoffAppliedSequence = requestSequence;
  return true;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;"
  })[character]);
}

function normalizedRetailerHostname(value) {
  return String(value || "").toLocaleLowerCase("en-US").replace(/\.$/, "").replace(/^www\./, "");
}

function safeDirectRetailerUrl(value) {
  try {
    const destination = new URL(String(value || ""));
    if (destination.protocol !== "https:" || destination.username || destination.password || destination.port) return "";
    const hostname = normalizedRetailerHostname(destination.hostname);
    const configuredDomains = Number(state.affiliateRouting?.protocolVersion) === 1
      && Array.isArray(state.affiliateRouting?.registeredRetailerDomains)
      ? state.affiliateRouting.registeredRetailerDomains
        .map(normalizedRetailerHostname)
        .filter((domain) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))
      : [];
    if (!GUARDED_RETAILER_DIRECT_HOSTS.has(hostname) && !configuredDomains.includes(hostname)) return "";
    return destination.href;
  } catch {
    return "";
  }
}

function howlAffiliateUrl(value, articleName = "", trackingId = "") {
  try {
    const destination = new URL(String(value || ""));
    if (destination.protocol !== "https:" || destination.username || destination.password || destination.port) return "";
    const routing = state.affiliateRouting;
    if (Number(routing?.protocolVersion) !== 1 || !Array.isArray(routing?.stores)
      || !Array.isArray(routing?.registeredRetailerDomains)) return "";
    const host = normalizedRetailerHostname(destination.hostname);
    const path = `/${destination.pathname}`.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    const store = routing.stores
      .filter((candidate) => {
        const prefix = String(candidate?.pathPrefix || "/").toLocaleLowerCase("en-US");
        const pathMatches = prefix === "/" || path.toLocaleLowerCase("en-US") === prefix
          || path.toLocaleLowerCase("en-US").startsWith(`${prefix}/`);
        return normalizedRetailerHostname(candidate?.hostname) === host && pathMatches;
      })
      .sort((left, right) => String(right.pathPrefix || "").length - String(left.pathPrefix || "").length)[0];
    const directStore = routing.registeredRetailerDomains.some((domain) => normalizedRetailerHostname(domain) === host);
    if (!store) return directStore ? destination.href : "";
    if (routing.endpoint !== "https://howl.link/link"
      || !/^[a-z0-9][a-z0-9_-]{1,79}$/.test(String(routing.publisherSlug || ""))) return "";
    const articleUrl = new URL(location.pathname || "/", location.origin);
    articleUrl.search = "";
    articleUrl.hash = "";
    const route = new URL(routing.endpoint);
    route.searchParams.set("url", destination.href);
    route.searchParams.set("publisher_slug", routing.publisherSlug);
    route.searchParams.set(
      "article_name",
      String(articleName || document.title || "Yoink product dashboard").replace(/\s+/g, " ").trim().slice(0, 100)
        || "Yoink product dashboard"
    );
    route.searchParams.set("article_url", articleUrl.href);
    const boundedTrackingId = String(trackingId || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (boundedTrackingId) route.searchParams.set("u1", boundedTrackingId);
    return route.href;
  } catch {
    return "";
  }
}

function retailerLinkMarkup(value, articleName, label, className = "canonical", trackingId = "", interaction = {}) {
  const directHref = safeDirectRetailerUrl(value);
  if (!directHref) return "";
  const href = howlAffiliateUrl(directHref, articleName, trackingId) || directHref;
  let affiliate = false;
  try { affiliate = new URL(href).origin === "https://howl.link"; } catch { return ""; }
  const jobId = /^[A-Za-z0-9_-]{3,120}$/.test(String(interaction.jobId || "")) ? String(interaction.jobId) : "";
  const destinationKind = interaction.destinationKind === "cart" ? "cart" : "store";
  return `<a class="${escapeHtml(className)}" data-store-link data-store-canonical="${escapeHtml(directHref)}" data-store-job="${escapeHtml(jobId)}" data-store-route="${affiliate ? "affiliate" : "direct"}" data-store-destination="${destinationKind}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer${affiliate ? " sponsored" : ""}">${escapeHtml(label)}</a>`;
}

function recordStoreLinkClick(link) {
  const canonicalUrl = String(link?.dataset?.storeCanonical || "");
  const jobId = String(link?.dataset?.storeJob || "");
  const routeKind = String(link?.dataset?.storeRoute || "direct");
  const destinationKind = String(link?.dataset?.storeDestination || "store");
  const panel = link.closest?.("[data-panel]") || document.querySelector("[data-panel].active");
  const surface = String(panel?.dataset?.panel || "home");
  if (!canonicalUrl || !["affiliate", "direct"].includes(routeKind)
    || !["store", "cart"].includes(destinationKind)) return;
  void api("/api/v1/user/store-link-clicks", {
    method: "POST",
    keepalive: true,
    body: JSON.stringify({
      jobId,
      canonicalUrl,
      routeKind,
      destinationKind,
      surface,
      confirmation: "RECORD_STORE_LINK_CLICK"
    })
  }).catch(() => undefined);
}

function walmartItemIdFromPdp(value) {
  try {
    const url = new URL(String(value || ""));
    const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !["walmart.com", "www.walmart.com"].includes(hostname)) return "";
    return url.pathname.match(/^\/ip\/(?:[^/]+\/)?(\d{5,20})\/?$/i)?.[1] || "";
  } catch {
    return "";
  }
}

function exactWalmartReviewOrderUrl(value, walmartItemId) {
  try {
    const url = new URL(String(value || ""));
    const keys = [...url.searchParams.keys()];
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
      || !["walmart.com", "www.walmart.com"].includes(url.hostname.toLocaleLowerCase("en-US"))
      || url.pathname !== "/affil/cart/reviewOrder"
      || !/^\d{5,20}$/.test(String(walmartItemId || ""))
      || keys.length !== 3 || new Set(keys).size !== 3
      || !keys.every((key) => ["items", "cn", "veh"].includes(key))
      || url.searchParams.get("items") !== walmartItemId
      || url.searchParams.get("cn") !== "nc"
      || url.searchParams.get("veh") !== "aff") return "";
    return url.href;
  } catch {
    return "";
  }
}

function exactHowlWalmartReviewOrderUrl(value, walmartItemId) {
  try {
    const url = new URL(String(value || ""));
    const keys = [...url.searchParams.keys()];
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
      || url.hostname.toLocaleLowerCase("en-US") !== "howl.link" || url.pathname !== "/link"
      || keys.length !== 5 || new Set(keys).size !== 5
      || !keys.every((key) => ["url", "publisher_slug", "article_name", "article_url", "u1"].includes(key))
      || !/^[a-z0-9][a-z0-9_-]{1,79}$/.test(String(url.searchParams.get("publisher_slug") || ""))
      || !String(url.searchParams.get("article_name") || "").trim()
      || url.searchParams.get("u1") !== `walmart_${walmartItemId}`
      || !exactWalmartReviewOrderUrl(url.searchParams.get("url"), walmartItemId)) return "";
    const articleUrl = new URL(String(url.searchParams.get("article_url") || ""));
    if (articleUrl.protocol !== "https:" || articleUrl.username || articleUrl.password || articleUrl.port) return "";
    return url.href;
  } catch {
    return "";
  }
}

function scheduleWalmartHandoffExpiry(calls) {
  if (state.walmartHandoffExpiryTimer !== null) clearTimeout(state.walmartHandoffExpiryTimer);
  state.walmartHandoffExpiryTimer = null;
  const now = Date.now();
  const nextExpiry = calls.map((call) => new Date(String(call?.purchaseHandoff?.expiresAt || "")).getTime())
    .filter((expiry) => Number.isFinite(expiry) && expiry > now)
    .sort((left, right) => left - right)[0];
  if (!Number.isFinite(nextExpiry)) return;
  state.walmartHandoffExpiryTimer = setTimeout(() => {
    state.walmartHandoffExpiryTimer = null;
    renderCalls();
  }, Math.min(2_147_483_647, Math.max(1, nextExpiry - now + 25)));
}

function walmartPurchaseLinkMarkup(call, surface = "calls") {
  const handoff = call?.purchaseHandoff;
  if (call?.retailerId !== "walmart"
    || handoff?.kind !== "walmart_review_order") return "";
  const actionJobId = String(call.actionJobId || call.id || "");
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(actionJobId)
    || !["calls", "home"].includes(surface)
    || state.openedWalmartPurchaseJobs.has(actionJobId)) return "";
  const walmartItemId = String(handoff.walmartItemId || "");
  if (!/^\d{5,20}$/.test(walmartItemId)
    || String(call.retailerSku || "") !== walmartItemId
    || walmartItemIdFromPdp(call.canonicalUrl) !== walmartItemId) return "";

  const pdpUrl = `https://www.walmart.com/ip/${walmartItemId}`;
  const reviewOrder = new URL("https://www.walmart.com/affil/cart/reviewOrder");
  reviewOrder.searchParams.set("items", walmartItemId);
  reviewOrder.searchParams.set("cn", "nc");
  reviewOrder.searchParams.set("veh", "aff");
  const directCartUrl = reviewOrder.href;
  const trackingId = `walmart_${walmartItemId}`;
  const expiresAt = new Date(String(handoff.expiresAt || "")).getTime();
  const coreRouteValid = exactWalmartReviewOrderUrl(handoff.directFallbackUrl, walmartItemId)
    && handoff.pdpFallbackUrl === pdpUrl
    && handoff.trackingId === trackingId
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now();
  if (!coreRouteValid) return "";

  const serverHowlRoute = exactHowlWalmartReviewOrderUrl(handoff.destinationUrl, walmartItemId);
  const serverDirectRoute = exactWalmartReviewOrderUrl(handoff.destinationUrl, walmartItemId);
  // A valid server-owned Howl route is already the highest-priority handoff.
  // A raw server route can be wrapped from the current dashboard policy. If
  // the supplied affiliate destination is malformed, retain the separately
  // validated raw reviewOrder fallback instead of downgrading to the PDP.
  const locallyWrappedRoute = serverDirectRoute
    ? howlAffiliateUrl(directCartUrl, call.title, trackingId)
    : "";
  const href = serverHowlRoute || locallyWrappedRoute || directCartUrl;
  const affiliate = href.startsWith("https://howl.link/");
  return `<a class="button primary walmart-buy" data-walmart-buy="${escapeHtml(walmartItemId)}" data-walmart-job="${escapeHtml(actionJobId)}" data-walmart-route="${affiliate ? "howl" : "direct"}" data-walmart-surface="${surface}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer${affiliate ? " sponsored" : ""}">Buy at Walmart ↗</a>`;
}

function recordWalmartPurchaseClick(link) {
  const actionJobId = String(link?.dataset?.walmartJob || "");
  const routeKind = String(link?.dataset?.walmartRoute || "");
  const surface = String(link?.dataset?.walmartSurface || "calls");
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(actionJobId)
    || !["howl", "direct"].includes(routeKind)
    || !["calls", "home"].includes(surface)
    || state.openedWalmartPurchaseJobs.has(actionJobId)) return;
  state.openedWalmartPurchaseJobs.add(actionJobId);
  // Let the native anchor action start first, then consume every dashboard
  // copy of this one-use handoff so Home and Calls cannot open it twice.
  setTimeout(() => {
    if (state.overview?.actionHandoff?.primary?.id === actionJobId
      && state.overview.actionHandoff.primary.stage === "purchase_ready") {
      state.overview = {
        ...state.overview,
        actionHandoff: { ...state.overview.actionHandoff, primary: null }
      };
      renderHomePriority();
    }
    if (state.actionHandoffPreload?.primary?.id === actionJobId) {
      state.actionHandoffPreload = { ...state.actionHandoffPreload, primary: null };
    }
    if (state.calls.some((call) => String(call.actionJobId || "") === actionJobId)) {
      state.calls = state.calls.map((call) => String(call.actionJobId || "") === actionJobId
        ? { ...call, purchaseHandoff: null } : call);
      renderCalls();
    }
  }, 0);
  // This receipt must never delay or replace retailer navigation. The server
  // revalidates the current handoff and atomically consumes it by job.
  void api(`/api/v1/user/purchase-handoffs/${encodeURIComponent(actionJobId)}/click`, {
    method: "POST",
    keepalive: true,
    body: JSON.stringify({
      routeKind,
      surface,
      confirmation: "OPEN_WALMART_PURCHASE_HANDOFF"
    })
  }).catch(() => undefined);
}

function walmartPdpFallbackLinkMarkup(call) {
  const walmartItemId = walmartItemIdFromPdp(call?.canonicalUrl);
  if (!walmartItemId || String(call?.retailerSku || "") !== walmartItemId) return "";
  const pdpUrl = `https://www.walmart.com/ip/${walmartItemId}`;
  const affiliateUrl = howlAffiliateUrl(pdpUrl, call.title, `walmart_${walmartItemId}`);
  const href = affiliateUrl || pdpUrl;
  const affiliate = affiliateUrl.startsWith("https://howl.link/");
  const actionJobId = /^[A-Za-z0-9_-]{3,120}$/.test(String(call?.actionJobId || "")) ? String(call.actionJobId) : "";
  return `<a class="canonical" data-store-link data-store-canonical="${escapeHtml(pdpUrl)}" data-store-job="${escapeHtml(actionJobId)}" data-store-route="${affiliate ? "affiliate" : "direct"}" data-store-destination="store" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer${affiliate ? " sponsored" : ""}">Store page ↗</a>`;
}

function money(cents, currency = "USD") {
  if (cents === null || cents === undefined || cents === "" || !Number.isFinite(Number(cents))) return "No price recorded";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(cents) / 100);
}

function moneyInput(cents) {
  return cents !== null && cents !== undefined && cents !== "" && Number.isFinite(Number(cents))
    ? (Number(cents) / 100).toFixed(2)
    : "";
}

function centsInput(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars <= 0 || Math.round(dollars * 100) > 100_000_000) {
    throw new Error(`${label} must be a positive dollar amount or blank.`);
  }
  return Math.round(dollars * 100);
}

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function relative(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Unknown time";
  const minutes = Math.round((time - Date.now()) / 60_000);
  if (Math.abs(minutes) < 6 * 60) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(minutes, "minute");
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(minutes / 60), "hour");
}

function supportedTimezone(value, fallback) {
  const candidate = String(value || fallback || "UTC");
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return fallback || "UTC";
  }
}

function viewerTimezone() {
  return supportedTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC");
}

function dropDateTime(value, timeZone, { weekday = true, zone = true } = {}) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    ...(weekday ? { weekday: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
    ...(zone ? { timeZoneName: "short" } : {}),
    timeZone
  }).format(date).replace(",", "");
}

function dropCountdown(startsAt, closesAt, now = Date.now()) {
  const start = new Date(startsAt).getTime();
  const close = new Date(closesAt).getTime();
  const format = (difference, verb) => {
    const minutes = Math.max(1, Math.ceil(difference / 60_000));
    return `${verb} ${new Intl.RelativeTimeFormat(undefined, { numeric: "always" }).format(minutes, "minute")}`;
  };
  if (Number.isFinite(start) && start > now && start - now < 60 * 60_000) return format(start - now, "starts");
  if (Number.isFinite(start) && start <= now && Number.isFinite(close) && close > now && close - now < 60 * 60_000) {
    return format(close - now, "closes");
  }
  return "";
}

function formatDropWindowSchedule(window, now = Date.now()) {
  const startsAt = String(window?.startsAt || window?.expectedAt || "");
  const closesAt = String(window?.closesAt || "");
  const start = new Date(startsAt).getTime();
  const close = new Date(closesAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(close)) return "Schedule unavailable";
  const localZone = viewerTimezone();
  const sourceZone = supportedTimezone(window?.timezone || window?.watch?.timezone, localZone);
  const local = `${dropDateTime(startsAt, localZone)} · closes ${dropDateTime(closesAt, localZone, { weekday: false, zone: false })}`;
  const source = sourceZone !== localZone
    ? ` · source ${dropDateTime(startsAt, sourceZone)} · closes ${dropDateTime(closesAt, sourceZone, { weekday: false })}`
    : "";
  const countdown = dropCountdown(startsAt, closesAt, now);
  return `${local}${source}${countdown ? ` · ${countdown}` : ""}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reference = payload.correlationId ? ` Reference ${payload.correlationId}.` : "";
    const error = new Error(`${payload.message || `Yoink request failed with HTTP ${response.status}.`}${reference}`);
    error.code = String(payload.error || "request_failed");
    error.status = response.status;
    error.reference = String(payload.correlationId || "");
    throw error;
  }
  return payload;
}

let missingStatusUiReported = false;
function reportMissingStatusUi() {
  if (missingStatusUiReported) return;
  missingStatusUiReported = true;
  console.error("status.js did not load; inline status disabled");
}

const statusUi = globalThis.YoinkStatus || {
  currentTrigger: (element) => {
    reportMissingStatusUi();
    return element || document.activeElement || document.querySelector("main");
  },
  setInlineStatus: (element, options) => {
    reportMissingStatusUi();
    const status = document.createElement("div");
    status.className = `inline-status ${options.state || "info"}`;
    status.textContent = options.message || "";
    (element || document.querySelector("main") || document.body).insertAdjacentElement?.("afterend", status);
    return status;
  },
  pushToast: (root, options) => {
    reportMissingStatusUi();
    const item = document.createElement("div");
    item.className = `toast-item ${options.state || "success"}`;
    const message = document.createElement("span");
    message.textContent = options.message || "";
    item.append(message);
    if (options.action?.label && typeof options.action.onClick === "function") {
      const action = document.createElement("button");
      action.className = "toast-action";
      action.type = "button";
      action.textContent = options.action.label;
      action.addEventListener("click", options.action.onClick, { once: true });
      item.append(action);
    }
    root.replaceChildren(item);
    root.classList.add("show");
    return item;
  }
};

function setInlineStatus(element, options) {
  return statusUi.setInlineStatus(element, options);
}

function toast(message, error = false, options = {}) {
  return statusUi.pushToast($("#toast"), {
    ...options,
    element: options.element || statusUi.currentTrigger(),
    message,
    reference: options.reference,
    state: error ? "error" : "success"
  });
}

const PRIMARY_TAB_FOR_PANEL = Object.freeze({ insights: "activity" });
const USER_PANEL_ROUTES = Object.freeze({
  home: "home",
  products: "products",
  calls: "calls",
  plans: "plans",
  activity: "activity",
  insights: "activity/insights",
  preferences: "settings"
});
const USER_SETTINGS_ROUTES = Object.freeze({
  purchase: "settings",
  chrome: "settings/chrome",
  notifications: "settings/notifications",
  privacy: "settings/privacy"
});
const USER_ROUTE_ALIASES = Object.freeze({
  preferences: "settings",
  connections: "settings/chrome",
  "settings/review": "settings/notifications",
  health: "activity/insights",
  diagnostics: "settings/chrome"
});
const USER_SKELETON_TARGETS = Object.freeze({
  home: "#homeRecentList",
  products: "#productList",
  calls: "#callList",
  plans: "#planList",
  activity: "#actionList",
  insights: "#analyticsMetrics",
  preferences: "#profileList"
});

function userSkeletonMarkup(label, count = 3) {
  return `<div class="skeleton-list" role="status" aria-label="Loading ${escapeHtml(label)}">${Array.from({ length: count }, () => '<span class="skeleton-row" aria-hidden="true"></span>').join("")}</div>`;
}

function showUserRouteSkeleton(route) {
  if (state.loadedRoutes.has(route)) return false;
  const selector = USER_SKELETON_TARGETS[route];
  if (!selector) return false;
  const target = $(selector);
  if (!target || target.textContent.trim() || target.children.length) return false;
  target.innerHTML = userSkeletonMarkup(route.replaceAll("-", " "));
  return true;
}

function currentUserHashRoute(panel = activeUserRoute()) {
  if (panel === "calls" && state.callFilter === "drawings") return "calls/drawings";
  return panel === "preferences"
    ? USER_SETTINGS_ROUTES[state.settingsView] || USER_SETTINGS_ROUTES.purchase
    : USER_PANEL_ROUTES[panel] || USER_PANEL_ROUTES.home;
}

function writeUserRoute(mode, panel) {
  if (mode !== "push" && mode !== "replace") return;
  const route = currentUserHashRoute(panel);
  if (location.hash.slice(1) === route) return;
  history[`${mode}State`](null, "", `#${route}`);
}

function setTab(name, { load = true, historyMode = "replace" } = {}) {
  const primary = PRIMARY_TAB_FOR_PANEL[name] || name;
  $$("[data-tab]").forEach((button) => {
    const buttonPrimary = PRIMARY_TAB_FOR_PANEL[button.dataset.tab] || button.dataset.tab;
    const active = button.dataset.tab === name || (button.closest(".tabs") && buttonPrimary === primary);
    button.classList.toggle("active", Boolean(active));
    if (button.closest(".tabs")) button.setAttribute("aria-current", active ? "page" : "false");
  });
  $$("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
  writeUserRoute(historyMode, name);
  if (load && state.overview) {
    showUserRouteSkeleton(name);
    state.routeLoadPromise = loadUserRoute(name).catch((error) => toast(error.message || "That workspace could not load.", true));
  }
}

function setSettingsView(name, { historyMode = "replace" } = {}) {
  const allowed = new Set(["purchase", "chrome", "notifications", "privacy"]);
  state.settingsView = allowed.has(name) ? name : "purchase";
  $$('[data-settings-view]').forEach((button) => {
    const active = button.dataset.settingsView === state.settingsView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-settings-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== state.settingsView;
  });
  if (activeUserRoute() === "preferences") writeUserRoute(historyMode, "preferences");
}

function applyHashRoute() {
  const requested = location.hash.slice(1).replace(/^\/+|\/+$/g, "");
  const route = USER_ROUTE_ALIASES[requested] || requested || "home";
  if (route === "calls/drawings") state.callFilter = "drawings";
  else if (route === "calls") state.callFilter = "all";
  const panel = ({
    home: "home",
    products: "products",
    calls: "calls",
    "calls/drawings": "calls",
    plans: "plans",
    activity: "activity",
    "activity/insights": "insights",
    settings: "preferences",
    "settings/chrome": "preferences",
    "settings/notifications": "preferences",
    "settings/privacy": "preferences"
  })[route] || "home";
  if (panel === "preferences") {
    const settingsView = ({
      settings: "purchase",
      "settings/chrome": "chrome",
      "settings/notifications": "notifications",
      "settings/privacy": "privacy"
    })[route] || "purchase";
    setSettingsView(settingsView, { historyMode: "none" });
  }
  setTab(panel, { historyMode: "none" });
  if (panel === "calls") syncCallFilterView();
  const canonical = currentUserHashRoute(panel);
  if (requested !== canonical) history.replaceState(null, "", `#${canonical}`);
}

function words(value) {
  return String(value || "").replaceAll("_", " ").replace(/^\w/, (character) => character.toUpperCase());
}

const AVAILABILITY_LABELS = Object.freeze({
  in_stock: "In stock",
  preorder: "Preorder",
  out_of_stock: "Out of stock",
  unknown: "Unknown"
});
const FULFILLMENT_LABELS = Object.freeze({ shipping: "Shipping", pickup: "Pickup", manual: "Shipping" });
const ACTION_KIND_LABELS = Object.freeze({ add_to_cart: "Add to cart", notify: "Notify only", observe: "Watch" });
const ACTION_STATE_LABELS = Object.freeze({
  notify_only: "Notified",
  shadow_ready: "Checked only",
  awaiting_executor: "Queued",
  leased: "Starting",
  navigating: "Opening store",
  verifying_listing: "Checking offer",
  offer_verified: "Offer verified",
  add_authorized: "Ready to add",
  adding: "Adding",
  cart_verified: "Verifying cart",
  checkout_review: "Needs you",
  submit_authorized: "Needs you",
  submitting: "Needs you",
  confirmed: "Ready to check out",
  expired: "Expired",
  cancelled: "Closed",
  offer_rejected: "Did not match",
  manual_review: "Needs you",
  submission_uncertain: "Needs you"
});
const DECISION_SOURCE_LABELS = Object.freeze({ purchase_intent: "your plan", strategy: "default rules" });
const RESERVATION_LABELS = Object.freeze({
  active: "spend reserved",
  committed: "spend recorded",
  released: "reservation released"
});
const REASON_LABELS = Object.freeze({
  saved: "Plan saved",
  user_confirmed: "You confirmed the result",
  user_deleted: "Plan deleted",
  deleted: "Plan deleted",
  notification_only: "Notify only",
  no_enabled_target: "No store enabled",
  unsupported_target: "This store cannot add to cart",
  retailer_lane_activated: "Store checks passed",
  howl_route_ready: "Store link ready",
  amazon_associate_route_ready: "Store link ready",
  attribution_disabled: "Store link tracking is off",
  lane_not_qualified: "Store checks not ready",
  mapping_unavailable: "This store cannot add to cart",
  policy_incomplete: "Plan limits incomplete",
  retailer_session_blocked: "Sign in to the store in Chrome",
  runtime_offer_required: "Waiting for a fresh offer",
  companion_adapter_unavailable: "Chrome companion needs an update",
  armed_for_fresh_offer: "Ready for the next fresh offer",
  scheduled_window_edited: "Drop schedule changed",
  user_opt_in: "You chose Watch",
  read_only_observation: "Watching for stock"
});
const DRAW_STATE_LABELS = Object.freeze({ active: "Open", upcoming: "Upcoming", closed: "Closed", unknown: "Unknown" });
const DRAW_SCAN_LABELS = Object.freeze({
  passed: "Checked",
  partial: "Partly checked",
  failed: "Check failed",
  manual: "Checked by hand"
});
const STORE_CHECK_WARNING_LABELS = Object.freeze({
  expiring: "Check again soon",
  expired: "Sign in again",
  version_changed: "Store changed, check again"
});

function labelFor(map, value, fallback = words(value)) {
  return map[String(value || "")] || fallback;
}

function retailerDisplayName(value) {
  return ({
    target: "Target",
    walmart: "Walmart",
    amazon: "Amazon",
    bestbuy: "Best Buy",
    disney: "Disney Store",
    ravensburger: "Ravensburger",
    riot: "Riot Games Merch",
    booksamillion: "Books-A-Million",
    fanatics: "Fanatics",
    kohls: "Kohl's",
    macys: "Macy's",
    pbandai: "Premium Bandai",
    pokemoncenter: "Pokémon Center"
  })[String(value || "")] || words(value);
}

function guardedLaneReady(retailerId) {
  return state.overview?.guardedAddLanes?.[retailerId] === true;
}

function variantSummary(attributes) {
  if (!attributes || typeof attributes !== "object") return "";
  return Object.entries(attributes)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([name, value]) => `${words(name)} ${value}`)
    .join(" · ");
}

function setupActionMarkup(action, label, quiet = false) {
  if (!action || !label) return "";
  if (action === "download_companion") {
    const configured = state.overview?.setup?.companion?.downloadUrl;
    const href = configured === undefined ? "/api/v1/extension/release/download" : configured;
    if (!href) return '<span>Companion installation is managed by your Yoink administrator.</span>';
    return `<a class="button ${quiet ? "quiet" : "primary"}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  }
  return `<button class="button ${quiet ? "quiet" : "primary"}" data-setup-action="${escapeHtml(action)}" type="button">${escapeHtml(label)}</button>`;
}

function deriveUserHome(overview) {
  const paused = overview?.settings?.actionsPaused === true;
  const spend = overview?.spend || {};
  const setup = overview?.setup || null;
  const handoff = overview?.actionHandoff || {};
  const primary = handoff.primary || null;
  const needsYou = primary?.stage === "needs_you";
  const cartReady = primary?.stage === "ready_to_checkout";
  const purchaseReady = primary?.stage === "purchase_ready";
  const nextSetupStep = primary
    ? null
    : (setup?.steps || []).find((item) => item.state !== "complete") || null;
  const status = needsYou ? "needs_you"
    : cartReady ? "cart_ready"
      : purchaseReady ? "purchase_ready"
      : primary ? "handoff"
        : nextSetupStep ? "setup"
          : paused ? "paused" : "ready";
  const headline = status === "needs_you" ? "A store action needs you."
    : status === "cart_ready" ? "Your cart is ready."
      : status === "purchase_ready" ? "Buy at Walmart is ready."
      : status === "handoff" ? "A store action is ready to review."
        : status === "setup" ? setup.headline
          : status === "paused" ? "Purchase actions are paused." : "Yoink is ready.";
  const summary = primary
    ? `${primary.title} · ${retailerDisplayName(primary.retailerId)}.`
    : status === "setup" ? setup.summary
      : status === "paused" ? "Monitoring and notifications continue while store actions wait."
        : "Calls are live.";
  return {
    status,
    headline,
    summary,
    paused,
    spend,
    handoff,
    primary,
    needsYou,
    cartReady,
    purchaseReady,
    nextSetupStep
  };
}

function scheduleHomeWalmartHandoffExpiry(primary) {
  if (state.homeWalmartHandoffExpiryTimer !== null) {
    clearTimeout(state.homeWalmartHandoffExpiryTimer);
  }
  state.homeWalmartHandoffExpiryTimer = null;
  if (primary?.stage !== "purchase_ready") return;
  const expiry = new Date(String(primary.purchaseHandoff?.expiresAt || "")).getTime();
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return;
  state.homeWalmartHandoffExpiryTimer = setTimeout(() => {
    state.homeWalmartHandoffExpiryTimer = null;
    if (state.overview?.actionHandoff?.primary?.id === primary.id
      && state.overview.actionHandoff.primary.stage === "purchase_ready") {
      state.overview = {
        ...state.overview,
        actionHandoff: { ...state.overview.actionHandoff, primary: null }
      };
      renderHomePriority();
    }
    void refreshCompactActionHandoff(0).catch(() => undefined);
  }, Math.min(2_147_483_647, Math.max(1, expiry - Date.now() + 25)));
}

function renderHomeActionHandoff(handoff, { updateHeadline = false } = {}) {
  const primary = handoff?.primary || null;
  const needsYou = primary?.stage === "needs_you";
  const purchaseReady = primary?.stage === "purchase_ready";
  scheduleHomeWalmartHandoffExpiry(primary);
  if (updateHeadline && primary) {
    const model = deriveUserHome({ actionHandoff: handoff });
    $("#homeHeadline").textContent = model.headline;
    $("#homeSummary").textContent = model.summary;
  }

  const panel = $("#homeActionHandoff");
  panel.hidden = !primary;
  $("#homeFallback").hidden = Boolean(primary);
  panel.classList.toggle("attention", needsYou);
  if (!primary) {
    $("#homeActionHandoffActions").innerHTML = "";
    return;
  }
  const retailer = retailerDisplayName(primary.retailerId);
  const otherCount = Math.max(0,
    Number(handoff?.counts?.readyToCheckout || 0) + Number(handoff?.counts?.needsYou || 0) - 1);
  $("#homeActionHandoffEyebrow").textContent = needsYou ? "Needs you"
    : purchaseReady ? "Ready at Walmart" : "Ready to check out";
  $("#homeActionHandoffTitle").textContent = needsYou
    ? `Review ${primary.title}`
    : purchaseReady ? `${primary.title} is ready to add`
      : `${primary.title} is in your cart`;
  $("#homeActionHandoffCopy").textContent = `${retailer} · ${purchaseReady ? "Item " : ""}${primary.retailerSku}. ${primary.statusSummary}${otherCount ? ` ${otherCount.toLocaleString()} more handoff${otherCount === 1 ? " is" : "s are"} in Activity.` : ""}`;
  if (purchaseReady) {
    const purchaseAction = walmartPurchaseLinkMarkup({
      ...primary,
      actionJobId: primary.id
    }, "home");
    panel.hidden = !purchaseAction;
    $("#homeActionHandoffActions").innerHTML = purchaseAction
      ? `${purchaseAction}<button class="button quiet" data-tab="calls" type="button">Details</button>`
      : "";
    return;
  }
  const destination = RETAILER_CART_URLS[primary.retailerId] || primary.canonicalUrl;
  $("#homeActionHandoffActions").innerHTML = `${retailerLinkMarkup(
    destination,
    `${primary.title} cart handoff`,
    needsYou ? "Review store ↗" : "Open cart ↗",
    "button primary home-cart-handoff-link",
    "",
    { jobId: primary.id, destinationKind: "cart" }
  )}<button class="button quiet" data-tab="activity" type="button">Details</button>`;
}

function renderHomePriority() {
  const overview = state.overview;
  if (!overview) return;
  const model = deriveUserHome(overview);
  const { paused, spend, handoff, primary, needsYou, cartReady, purchaseReady, nextSetupStep } = model;
  const actionLabel = needsYou ? "Needs review"
    : cartReady ? "Cart ready" : purchaseReady ? "Walmart ready" : paused ? "Paused" : "Enabled";
  const heroState = $("#heroState");
  const completedSetupSteps = Math.max(0, Number(overview.setup?.completedSteps) || 0);
  const totalSetupSteps = Math.max(1, Number(overview.setup?.totalSteps) || 5);
  const currentSetupStep = Math.min(totalSetupSteps, completedSetupSteps + 1);
  heroState.classList.toggle("contextual", Boolean(nextSetupStep));
  heroState.innerHTML = nextSetupStep
    ? `<section class="home-next-action" data-home-setup aria-labelledby="homeNextActionTitle">
      <p class="eyebrow">Step ${currentSetupStep.toLocaleString("en-US")} of ${totalSetupSteps.toLocaleString("en-US")}</p>
      <h2 id="homeNextActionTitle">${escapeHtml(nextSetupStep.title)}</h2>
      <p>${escapeHtml(nextSetupStep.summary)}</p>
      <div class="inline-actions">${setupActionMarkup(nextSetupStep.primaryAction, nextSetupStep.primaryActionLabel)}${setupActionMarkup(nextSetupStep.secondaryAction, nextSetupStep.secondaryActionLabel, true)}</div>
    </section>`
    : `<div class="state-row"><span><i class="dot ${needsYou || paused ? "warn" : "good"}" role="img" aria-label="${needsYou || paused ? "Attention" : "OK"}"></i>Actions</span><strong>${actionLabel}</strong></div>
      <div class="state-row"><span><i class="dot ${Number(spend.activeReservationCount || 0) ? "warn" : "good"}" role="img" aria-label="${Number(spend.activeReservationCount || 0) ? "Reserved spend active" : "No reserved spend"}"></i>Spending reserved</span><strong>${escapeHtml(money(spend.activeReservedCents || 0))}</strong></div>`;

  $("#homeHeadline").textContent = model.headline;
  $("#homeSummary").textContent = model.summary;
  renderHomeActionHandoff(handoff);
}

function renderHomeRecentOutcomes() {
  const items = (Array.isArray(state.homeRecentActions) ? state.homeRecentActions : [])
    .filter((action) => ["got_it", "missed_it"].includes(String(action.userReportOutcome)))
    .sort((first, second) => new Date(second.userReportedAt || second.createdAt || 0).getTime()
      - new Date(first.userReportedAt || first.createdAt || 0).getTime())
    .slice(0, 5);
  $("#homeRecentList").innerHTML = items.length
    ? items.map((action) => {
      const gotIt = action.userReportOutcome === "got_it";
      const amount = gotIt && Number.isSafeInteger(Number(action.userReportedTotalCents))
        ? ` · ${money(Number(action.userReportedTotalCents), action.currency)}`
        : "";
      const happenedAt = action.userReportedAt || action.createdAt;
      return `<article class="home-summary-row">
        <div><strong>${escapeHtml(action.title || `${retailerDisplayName(action.retailerId)} product`)}</strong><small>${escapeHtml(retailerDisplayName(action.retailerId))} · ${escapeHtml(action.retailerSku || "Item")}${amount ? escapeHtml(amount) : ""}${happenedAt ? ` · ${escapeHtml(relative(happenedAt))}` : ""}</small></div>
        <span class="tag ${gotIt ? "good" : "warn"}">${gotIt ? "Got it" : "Missed"}</span>
      </article>`;
    }).join("")
    : '<div class="home-summary-empty">No checkout outcomes yet.</div>';
}

function renderHomeLimits() {
  const analytics = state.actionPlatform?.analytics?.spend || {};
  const overviewSpend = state.overview?.spend || {};
  const policy = overviewSpend.policy || {};
  const rows = [
    {
      label: "Today",
      cadence: "daily",
      cap: analytics.dailyCapCents ?? policy.dailyCapCents,
      available: analytics.availableTodayCents ?? overviewSpend.availableTodayCents
    },
    {
      label: "This month",
      cadence: "monthly",
      cap: analytics.monthlyCapCents ?? policy.monthlyCapCents,
      available: analytics.availableThisMonthCents ?? overviewSpend.availableThisMonthCents
    }
  ];
  $("#homeLimitGrid").innerHTML = rows.map((row) => {
    const cap = Number(row.cap);
    const hasCap = row.cap !== null && row.cap !== undefined && Number.isFinite(cap) && cap >= 0;
    const available = Number(row.available);
    const headroom = Number.isFinite(available) ? Math.max(0, available) : 0;
    return `<article class="home-limit"><span>${escapeHtml(row.label)}</span><strong>${hasCap ? `${escapeHtml(money(headroom))} left` : "No limit"}</strong><small>${hasCap ? `${escapeHtml(money(cap))} ${escapeHtml(row.cadence)} limit` : `No ${escapeHtml(row.cadence)} limit set`}</small></article>`;
  }).join("");
}

function renderHomeSections() {
  renderUpcomingDrops();
  renderHomeRecentOutcomes();
  renderHomeLimits();
}

function renderUserAccount(permissions = []) {
  const actor = state.overview?.actor || {};
  const displayName = String(actor.displayName || "Signed-in user");
  const roles = Array.isArray(actor.roleLabels) ? actor.roleLabels.filter(Boolean) : [];
  $("#userAccountAvatar").textContent = displayName.trim().slice(0, 1).toUpperCase() || "Y";
  $("#userAccountName").textContent = displayName;
  $("#userAccountRole").textContent = roles.join(" · ") || "Account";
  $("#userAccountTenant").textContent = actor.tenantName || "Yoink";
  $("#userAccountSession").textContent = actor.sessionKind === "local" ? "Local session" : "Hosted session";
  $("#adminLink").hidden = !permissions.includes("admin.read");
  const signOut = $("#userSignOutLink");
  signOut.hidden = !actor.signOutUrl;
  if (actor.signOutUrl) signOut.href = actor.signOutUrl;
}

function resumeBlockedByStoreChecks(overview) {
  const lanes = overview?.guardedAddLanes;
  if (!lanes || typeof lanes !== "object") return false;
  return !Object.values(lanes).some((ready) => ready === true);
}

function renderOverview() {
  const { settings, permissions, spend } = state.overview;
  const paused = settings.actionsPaused === true;
  const modePill = $("#modePill");
  const modeLabel = paused ? "Paused" : settings.executionMode === "live" ? "Running" : "Test mode";
  modePill.textContent = modeLabel;
  modePill.dataset.mobileLabel = modeLabel;
  modePill.dataset.mobileState = paused ? "paused" : settings.executionMode === "live" ? "ready" : "monitoring";
  modePill.setAttribute("aria-label", paused ? "Actions paused" : `Store actions: ${modeLabel}`);
  const pauseButton = $("#pauseButton");
  const resumeBlocked = paused && resumeBlockedByStoreChecks(state.overview);
  pauseButton.textContent = paused ? "Resume actions" : "Pause actions";
  pauseButton.disabled = resumeBlocked;
  const pauseReason = $("#pauseReason");
  pauseReason.textContent = resumeBlocked
    ? "Turn on cart adds for at least one store first."
    : paused ? "Cart adds are paused. Watching and notifications continue." : "";
  pauseReason.hidden = !pauseReason.textContent;
  pauseButton.title = resumeBlocked ? pauseReason.textContent : "";
  renderUserAccount(permissions || []);
  renderHomePriority();
  renderUpcomingDrops();
  renderHomeLimits();
  const companionLink = $("#companionDownloadLink");
  const configuredCompanionUrl = state.overview?.setup?.companion?.downloadUrl;
  const companionUrl = configuredCompanionUrl === undefined
    ? "/api/v1/extension/release/download"
    : configuredCompanionUrl;
  companionLink.hidden = !companionUrl;
  if (companionUrl) companionLink.href = companionUrl;
  renderAnnouncement();
  renderSpend(spend);
}

function dismissedAnnouncementId() {
  try { return localStorage.getItem(DISMISSED_ANNOUNCEMENT_KEY) || ""; } catch { return ""; }
}

function announcementIsCurrent(announcement, nowMs = Date.now()) {
  if (!announcement?.id) return false;
  const publishedAtMs = Date.parse(String(announcement.publishedAt || ""));
  return !Number.isFinite(publishedAtMs) || nowMs - publishedAtMs <= ANNOUNCEMENT_MAX_AGE_MS;
}

function renderAnnouncement() {
  const panel = $("#releaseAnnouncement");
  const announcement = state.overview?.announcement;
  if (!announcementIsCurrent(announcement) || dismissedAnnouncementId() === announcement.id) {
    panel.hidden = true;
    return;
  }
  $("#releaseAnnouncementVersion").textContent = `New in ${announcement.version}`;
  $("#releaseAnnouncementTitle").textContent = announcement.title;
  $("#releaseAnnouncementLink").href = announcement.docsUrl || "/docs";
  panel.hidden = false;
}

function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function populateTimezoneSelect(select, selectedTimezone) {
  let supported = [];
  try {
    supported = typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  } catch {
    supported = [];
  }
  const zones = [...new Set([...supported, browserTimezone(), selectedTimezone, "UTC"]
    .map((value) => String(value || "").trim())
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const hasSelectedOption = [...select.options].some((option) => option.value === selectedTimezone);
  if (select.dataset.timezonesReady !== "true" || !hasSelectedOption) {
    select.replaceChildren(...zones.map((timezone) => {
      const option = document.createElement("option");
      option.value = timezone;
      option.textContent = timezone.replaceAll("_", " ");
      return option;
    }));
    select.dataset.timezonesReady = "true";
  }
  select.value = selectedTimezone;
}

function renderSpend(spend) {
  if (!spend) return;
  $("#spendSummary").textContent = `${money(spend.activeReservedCents)} reserved · ${money(spend.spentTodayCents)} spent today · order submission remains closed.`;
  const form = $("#spendForm");
  const selectedTimezone = spend.policy.timezone || browserTimezone();
  populateTimezoneSelect(form.elements.timezone, selectedTimezone);
  if (form.contains(document.activeElement)) return;
  form.elements.revision.value = spend.policy.revision;
  form.elements.perOrder.value = moneyInput(spend.policy.perOrderCapCents);
  form.elements.daily.value = moneyInput(spend.policy.dailyCapCents);
  form.elements.monthly.value = moneyInput(spend.policy.monthlyCapCents);
  form.elements.timezone.value = selectedTimezone;
  if (!form.elements.periodResetHour.options.length) {
    form.elements.periodResetHour.innerHTML = Array.from({ length: 24 }, (_, hour) => `<option value="${hour}">${new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2020, 0, 1, hour))}</option>`).join("");
  }
  form.elements.periodResetHour.value = String(Number(spend.policy.periodResetHour || 0));
}

function renderPrivacy() {
  const inventory = state.privacy;
  if (!inventory) return;
  const categories = Array.isArray(inventory.categories) ? inventory.categories : [];
  $("#privacySummary").textContent = `${Number(inventory.totalRecords || 0).toLocaleString()} records across ${categories.length} private categories are ready in one versioned JSON file.`;
  $("#privacyCategories").innerHTML = categories.map((category) => `<div class="mini-row"><span>${escapeHtml(category.label)}</span><strong>${Number(category.recordCount || 0).toLocaleString()}</strong></div>`).join("");
  $("#privacyBoundary").textContent = inventory.credentialMaterialsExcluded === true
    ? "Chrome companion tokens, pairing codes, request nonces, and action capabilities are excluded. Other users and tenant-wide administrator data are never included. Account deletion stays closed until hosted identity revocation and durable cleanup are proven."
    : "The data-export boundary is unavailable; do not download until Yoink can verify credential exclusion.";
  $("#privacyExportLink").hidden = inventory.credentialMaterialsExcluded !== true;
  const compliance = state.privacyCompliance;
  $("#privacyPolicyLink").textContent = compliance?.policyViewed ? "Privacy policy viewed" : "Privacy policy";
  $("#acknowledgePrivacyChange").hidden = !compliance || compliance.changeAcknowledged === true;
}

function listingEffectivePrice(listing) {
  const current = Number(listing.currentPriceCents);
  if (listing.currentPriceCents !== null && listing.currentPriceCents !== undefined && Number.isFinite(current) && current > 0) {
    return { cents: current, kind: "seen" };
  }
  const msrp = Number(listing.msrpCents);
  if (listing.msrpCents !== null && listing.msrpCents !== undefined && Number.isFinite(msrp) && msrp > 0) {
    return { cents: msrp, kind: "catalog" };
  }
  return null;
}

function listingAvailable(listing) {
  if (typeof listing?.purchasable === "boolean") return listing.purchasable;
  return ["in_stock", "preorder"].includes(String(listing?.status));
}

function bestListing(group) {
  return [...(group.listings || [])].sort((first, second) => {
    const availability = Number(!listingAvailable(first)) - Number(!listingAvailable(second));
    if (availability !== 0) return availability;
    const lane = Number(!(first.executionSupported && guardedLaneReady(first.retailerId)))
      - Number(!(second.executionSupported && guardedLaneReady(second.retailerId)));
    if (lane !== 0) return lane;
    const firstPrice = listingEffectivePrice(first)?.cents;
    const secondPrice = listingEffectivePrice(second)?.cents;
    if (firstPrice === undefined && secondPrice === undefined) return 0;
    if (firstPrice === undefined) return 1;
    if (secondPrice === undefined) return -1;
    return firstPrice - secondPrice;
  })[0];
}

function renderStoreFilterOptions() {
  const select = $("#browseStore");
  if (!select) return;
  const stores = Array.isArray(state.productStores) ? state.productStores : [];
  select.innerHTML = ['<option value="">All stores</option>', ...stores
    .map((store) => `<option value="${escapeHtml(store.retailerId)}">${escapeHtml(store.retailerName)} · ${Number(store.productCount || 0).toLocaleString()}</option>`)].join("");
  select.value = stores.some((store) => store.retailerId === state.browse.store) ? state.browse.store : "";
}

function renderProducts() {
  const missionByVariant = new Map(state.plans.map((plan) => [plan.variantId, plan]));
  const productList = $("#productList");
  productList.dataset.productView = state.productView;
  $$('.product-view-toggle [data-product-view]').forEach((button) => {
    const active = button.dataset.productView === state.productView;
    button.setAttribute("aria-pressed", String(active));
  });
  renderStoreFilterOptions();
  renderProductReviewStatus();
  const groups = state.productGroups;
  const filtering = Boolean(state.browse.store || state.browse.availability || state.browse.plan || state.browse.price);
  $("#browseCount").textContent = `${state.productTotal.toLocaleString()} product${state.productTotal === 1 ? "" : "s"}`;
  $("#loadMoreProducts").hidden = state.productGroups.length >= state.productTotal;
  if (!groups.length && filtering) {
    productList.innerHTML = '<div class="empty"><p>No products match the current filters.</p><button class="button secondary" data-clear-browse type="button">Clear filters</button></div>';
    return;
  }
  if (!groups.length) {
    productList.innerHTML = '<div class="empty"><p>No approved products match. Add a supported store product page for review.</p><button class="button secondary" data-open-product-link type="button">Add product link</button></div>';
    return;
  }
  productList.innerHTML = groups.map((group, index) => productCardMarkup(group, missionByVariant, { eagerImage: index < 6 })).join("");
  for (const image of $$("#productList .card-media img")) {
    image.addEventListener("error", () => { image.remove(); }, { once: true });
  }
}

function renderProductReviewStatus() {
  const panel = $("#productReviewStatus");
  const proposals = (state.proposals || [])
    .filter((proposal) => ["pending", "approved"].includes(String(proposal.status)))
    .sort((first, second) => new Date(second.updatedAt || second.createdAt || 0).getTime()
      - new Date(first.updatedAt || first.createdAt || 0).getTime())
    .slice(0, 5);
  panel.hidden = proposals.length < 1;
  if (!proposals.length) {
    $("#productReviewList").innerHTML = "";
    return;
  }
  $("#productReviewList").innerHTML = proposals.map((proposal) => {
    const approved = proposal.status === "approved";
    const title = proposal.payload?.title || `${retailerDisplayName(proposal.retailerId)} product`;
    const group = approved ? state.productGroups.find((candidate) => (candidate.listings || []).some((listing) =>
      listing.listingId === proposal.appliedListingId
        || (listing.retailerId === proposal.retailerId && listing.retailerSku === proposal.retailerSku))) : null;
    const titleMarkup = group
      ? `<button class="title-link" data-product-detail="${escapeHtml(group.variantId)}" type="button">${escapeHtml(title)}</button>`
      : `<strong>${escapeHtml(title)}</strong>`;
    return `<div class="mini-row" data-product-review="${escapeHtml(proposal.id)}"><span>${titleMarkup}<small>${escapeHtml(retailerDisplayName(proposal.retailerId))} · ${escapeHtml(proposal.retailerSku || proposal.payload?.retailerSku || "Item")}${approved ? " · Available in Products" : ""}</small></span><span class="tag ${approved ? "good" : "warn"}">${approved ? "Approved" : "In review"}</span></div>`;
  }).join("");
}

function mediaMarkup(group, { eager = false } = {}) {
  const letter = String(group.title || "?").trim().charAt(0).toUpperCase() || "?";
  const image = group.imageUrl
    ? `<img src="${escapeHtml(group.imageUrl)}" alt="" loading="${eager ? "eager" : "lazy"}" referrerpolicy="no-referrer">`
    : "";
  return `<div class="card-media" aria-hidden="true"><span class="media-letter">${escapeHtml(letter)}</span>${image}</div>`;
}

function quickAddMarkup(listing, group) {
  if (!listing) return "";
  const defaultProfile = state.profiles.find((profile) => profile.isDefault === true) || null;
  if (state.profiles.length && !defaultProfile) {
    return `<button class="button primary" data-quick-menu="${escapeHtml(listing.listingId)}" type="button" title="Choose a Quick add setup for ${escapeHtml(group.title)}">Choose setup</button>`;
  }
  const caret = state.profiles.length
    ? `<button class="button primary caret" data-quick-menu="${escapeHtml(listing.listingId)}" type="button" aria-label="Choose a Quick add setup" title="Choose a Quick add setup">▾</button>`
    : "";
  const configuration = defaultProfile ? `the “${defaultProfile.name}” setup` : "the Notify-only setup";
  return `<span class="split-button">
    <button class="button primary" data-quick-add="${escapeHtml(listing.listingId)}" type="button" title="${escapeHtml(`Quick add ${group.title} with ${configuration}`)}">Quick add</button>
    ${caret}
  </span>`;
}

function productCardMarkup(group, missionByVariant, { eagerImage = false } = {}) {
  const plan = missionByVariant.get(group.variantId);
  const listings = group.listings || [];
  const exactVariant = variantSummary(group.variantAttributes);
  const inStockCount = Number(group.inStockListingCount ?? listings.filter((listing) => listing.status === "in_stock").length);
  const preorderCount = Number(group.preorderListingCount ?? listings.filter((listing) => listing.status === "preorder").length);
  const outOfStockCount = Number(group.outOfStockListingCount ?? listings.filter((listing) => listing.status === "out_of_stock").length);
  const focusListing = state.browse.store
    ? listings.find((listing) => String(listing.retailerId) === state.browse.store) || null
    : null;
  const primary = focusListing || bestListing(group);
  const primaryPrice = listingEffectivePrice(primary || {});
  const storeCount = Number(group.storeCount ?? listings.length);
  const storeSummary = focusListing
    ? focusListing.retailerName
    : `${storeCount.toLocaleString()} store${storeCount === 1 ? "" : "s"}`;
  const availabilitySummary = focusListing
    ? labelFor(AVAILABILITY_LABELS, focusListing.status)
    : inStockCount > 0
      ? `${inStockCount.toLocaleString()} in stock`
      : preorderCount > 0
        ? `${preorderCount.toLocaleString()} preorder`
        : outOfStockCount > 0
          ? "Out of stock"
          : "Availability unknown";
  // The badge colour honours the server's purchasable flag when listings are
  // present; the counts still drive the wording so stock and buyability both show.
  const available = focusListing
    ? listingAvailable(focusListing)
    : listings.length
      ? listings.some((listing) => listing.status === "in_stock" && listingAvailable(listing))
      : inStockCount > 0;
  const priceValue = primaryPrice ? money(primaryPrice.cents, primary?.currency || group.currency) : "—";
  const priceContext = primaryPrice
    ? primaryPrice.kind === "catalog" ? "Catalog price" : focusListing ? `Last seen at ${focusListing.retailerName}` : "Best available offer"
    : "No price recorded";
  const primaryAction = plan
    ? `<button class="button secondary" data-edit-plan="${escapeHtml(plan.id)}" type="button">Review plan</button>`
    : listings.length > 1
      ? `<button class="button primary" data-product-detail="${escapeHtml(group.variantId)}" data-choose-store type="button">Quick add</button>`
      : quickAddMarkup(primary, group);
  return `<article class="product-card product-group" data-store="${escapeHtml(primary?.retailerId || "")}">
    ${mediaMarkup(group, { eager: eagerImage })}
    <div class="product-card-content">
      <p class="product-offer-summary"><span>${escapeHtml(storeSummary)}</span><span aria-hidden="true">·</span><strong class="${available ? "good" : "warn"}">${escapeHtml(availabilitySummary)}</strong></p>
      <h3><button class="title-link" data-product-detail="${escapeHtml(group.variantId)}" type="button">${escapeHtml(group.title)}</button></h3>
      ${exactVariant ? `<p class="product-variant">${escapeHtml(exactVariant)}</p>` : ""}
      <div class="product-price"><strong>${escapeHtml(priceValue)}</strong><small>${escapeHtml(priceContext)}</small></div>
    </div>
    <div class="card-actions">
      ${primaryAction}
      <button class="button quiet" data-product-detail="${escapeHtml(group.variantId)}" type="button">Details</button>
    </div>
  </article>`;
}

function profileSummary(profile) {
  const price = profile.priceMode === "fixed_cap" ? `cap ${money(profile.maxUnitPriceCents)}`
    : profile.priceMode === "msrp" ? "MSRP cap"
    : profile.priceMode === "msrp_offset_percent" ? `MSRP ${Number(profile.msrpOffsetPercent) > 0 ? "+" : ""}${Number(profile.msrpOffsetPercent || 0)}%`
    : "store price cap";
  const action = profile.actionCeiling === "add_to_cart" ? "add to cart" : "notify only";
  const fulfillment = profile.fulfillment === "pickup" ? "pickup" : "shipping";
  return `qty ${Number(profile.targetQuantity)} · ${price} · ${action} · ${fulfillment}${profile.isDefault ? " · default" : ""}`;
}

// Resolves the per-item price cap for a quick add from a listing's known prices
// and the chosen profile's price mode. Mirrors the server's own price-mode
// resolution used when a profile is later applied to existing plans.
function resolveProfileMaxUnitPriceCents(product, profile) {
  if (!profile) {
    const price = listingEffectivePrice(product);
    return price?.cents ?? null;
  }
  if (profile.priceMode === "fixed_cap") {
    const cents = Number(profile.maxUnitPriceCents);
    return Number.isFinite(cents) && cents > 0 ? cents : null;
  }
  if (profile.priceMode === "msrp" || profile.priceMode === "msrp_offset_percent") {
    const msrp = Number(product.msrpCents);
    if (!Number.isFinite(msrp) || msrp <= 0) return null;
    if (profile.priceMode === "msrp") return msrp;
    const percent = Number(profile.msrpOffsetPercent ?? 0);
    const cents = Math.round(msrp * (100 + percent) / 100);
    return Number.isFinite(cents) && cents > 0 ? cents : null;
  }
  const price = listingEffectivePrice(product);
  return price?.cents ?? null;
}

function closeQuickMenu({ restoreFocus = false } = {}) {
  const menu = $("#quickAddMenu");
  const trigger = state.quickMenuTrigger || null;
  menu.hidden = true;
  menu.innerHTML = "";
  delete menu.dataset.anchor;
  state.quickMenuTrigger = null;
  if (trigger?.isConnected) {
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  }
}

function openQuickMenu(anchor, listingId) {
  const menu = $("#quickAddMenu");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Quick add setups");
  menu.innerHTML = [
    `<button role="menuitem" data-quick-add="${escapeHtml(listingId)}" type="button"><strong>Notify-only setup</strong><small>qty 1 · store price cap · notify only · shipping</small></button>`,
    ...state.profiles.map((profile) => `<button role="menuitem" data-quick-add="${escapeHtml(listingId)}" data-profile-id="${escapeHtml(profile.id)}" type="button"><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profileSummary(profile))}</small></button>`),
    `<button role="menuitem" data-track-listing="${escapeHtml(listingId)}" type="button"><strong>Custom setup…</strong><small>Review every limit before creating the plan</small></button>`
  ].join("");
  const rect = anchor.getBoundingClientRect();
  menu.hidden = false;
  menu.dataset.anchor = listingId;
  state.quickMenuTrigger = anchor;
  anchor.setAttribute("aria-expanded", "true");
  const width = Math.min(300, window.innerWidth - 24);
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 12)}px`;
  menu.querySelector('[role="menuitem"]')?.focus();
}

function quickMenuItems() {
  return $$('#quickAddMenu [role="menuitem"]');
}

$("#quickAddMenu").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeQuickMenu({ restoreFocus: true });
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = quickMenuItems();
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement);
  const next = event.key === "Home" ? 0
    : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (index < 0 ? 0 : (index + 1) % items.length)
        : (index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length);
  items[next].focus();
});

async function quickAdd(listingId, profileId = "", options = {}) {
  if (state.quickAddBusy) return;
  const actionElement = options.element || statusUi.currentTrigger();
  const product = state.products.find((item) => item.listingId === listingId);
  if (!product) throw new Error("That product is no longer in this catalog view. Refresh and try again.");
  const existing = state.plans.find((plan) => plan.variantId === product.variantId);
  if (existing) return openPlan(existing.id);
  const profile = profileId
    ? state.profiles.find((candidate) => candidate.id === profileId)
    : state.profiles.find((candidate) => candidate.isDefault === true) || null;
  if (profileId && !profile) throw new Error("That Quick add setup is no longer available.");
  const maxUnitPriceCents = resolveProfileMaxUnitPriceCents(product, profile);
  if (!maxUnitPriceCents) {
    toast(profile && (profile.priceMode === "msrp" || profile.priceMode === "msrp_offset_percent")
      ? `No MSRP is recorded for ${product.title} yet, so choose your own caps.`
      : `No ${product.retailerName} price is recorded yet, so choose your own caps.`);
    return openSetup(listingId);
  }
  const targetQuantity = Number(profile?.targetQuantity ?? 1);
  const actionCeiling = profile?.actionCeiling === "add_to_cart" && product.executionSupported === true
    ? "add_to_cart"
    : "notify";
  const fulfillment = actionCeiling === "add_to_cart" && profile?.fulfillment === "pickup"
    ? "pickup"
    : "shipping";
  state.quickAddBusy = true;
  try {
    // The item price is the only figure a quick-add profile sets directly; the
    // server always auto-raises the reviewed total to cover taxes and store-fee
    // reserves during this no-write preview, so a single round trip is enough.
    const draft = {
      contractVersion: 2,
      listingId,
      targetQuantity,
      maxUnitPriceCents,
      maxAllInCents: maxUnitPriceCents * targetQuantity,
      actionCeiling,
      sellerPolicy: "first_party_only",
      fulfillment,
      substitutionPolicy: "exact_only",
      expiresAt: "",
      cooldownSeconds: Number(profile?.cooldownSeconds ?? 0),
      confirmation: "PREFLIGHT_EXACT_PURCHASE_PLAN"
    };
    const { preflight } = await api("/api/v1/user/purchase-intents/preflight", { method: "POST", body: JSON.stringify(draft) });
    const creation = await api("/api/v1/user/purchase-intents", {
      method: "POST",
      body: JSON.stringify({
        ...preflight.draft,
        contractVersion: 2,
        quickAddProfileId: profile?.id || "",
        confirmation: "CREATE_EXACT_PURCHASE_PLAN",
        preflightFingerprint: preflight.preflightFingerprint,
        preflightedAt: preflight.preflightedAt
      })
    });
    if (options.refresh !== false) await refresh();
    if (options.silent !== true) {
      const planId = String(creation.purchaseIntent?.id || "");
      const setupName = profile?.name || "Notify-only setup";
      setInlineStatus(actionElement, {
        state: "success",
        message: `${product.title} was added with ${setupName}.`
      });
      toast("Purchase plan added.", false, planId ? {
        element: actionElement,
        durationMs: 10_000,
        action: {
          label: "Undo",
          onClick: async () => {
            await api(`/api/v1/user/purchase-intents/${encodeURIComponent(planId)}`, {
              method: "DELETE",
              body: JSON.stringify({ confirmation: "DELETE_PURCHASE_PLAN" })
            });
            await refresh();
            toast("Purchase plan removed.");
          }
        }
      } : { element: actionElement });
    }
    return true;
  } catch (error) {
    if (error.code === "purchase_intent_exists") {
      if (options.refresh !== false) await refresh();
      if (options.silent !== true) toast("That product already has a plan. Review its limits before changing it.");
      return false;
    } else {
      throw error;
    }
  } finally {
    state.quickAddBusy = false;
  }
}

function selectedProductListing(group) {
  const selectedId = state.productStoreSelections.get(group.variantId);
  const selected = (group.listings || []).find((listing) => listing.listingId === selectedId)
    || bestListing(group)
    || null;
  if (selected) state.productStoreSelections.set(group.variantId, selected.listingId);
  return selected;
}

function renderProductDetail(variantId) {
  const group = state.productGroups.find((candidate) => candidate.variantId === variantId);
  if (!group) throw new Error("That product is no longer in the current catalog view. Refresh and try again.");
  const plan = state.plans.find((candidate) => candidate.variantId === variantId);
  const exactVariant = variantSummary(group.variantAttributes);
  const selected = selectedProductListing(group);
  $("#productDialogTitle").textContent = group.title;
  const rows = (group.listings || []).map((listing) => {
    const price = listingEffectivePrice(listing);
    const chipAvailable = listingAvailable(listing);
    const chosen = selected?.listingId === listing.listingId;
    return `<div class="detail-row${chipAvailable ? "" : " muted"}" data-offer-listing="${escapeHtml(listing.listingId)}">
      <div class="detail-store"><strong>${escapeHtml(listing.retailerName)}</strong><small>SKU ${escapeHtml(listing.retailerSku)}</small></div>
      <div class="detail-price"><strong>${price ? escapeHtml(money(price.cents, listing.currency)) : "No price"}</strong><small>${price ? price.kind === "seen" ? "Last seen" : "Catalog price" : ""}</small></div>
      <span class="tag ${chipAvailable ? "good" : "warn"}">${escapeHtml(labelFor(AVAILABILITY_LABELS, listing.status))}</span>
      <div class="detail-actions">
        ${plan ? "" : `<label class="check"><input name="productStoreChoice" data-product-store-choice="${escapeHtml(listing.listingId)}" data-variant-id="${escapeHtml(group.variantId)}" type="radio" ${chosen ? "checked" : ""}><span>Use this store</span></label>`}
        ${retailerLinkMarkup(listing.canonicalUrl, group.title, "View ↗")}
      </div>
    </div>`;
  }).join("");
  const primaryActions = plan
    ? `<button class="button secondary" data-edit-plan="${escapeHtml(plan.id)}" type="button">Edit plan</button>`
    : selected
      ? `${quickAddMarkup(selected, group)}<button class="button quiet" data-track-listing="${escapeHtml(selected.listingId)}" type="button">Custom setup</button>`
      : "";
  const detailSummary = [
    exactVariant ? escapeHtml(exactVariant) : "",
    plan
      ? '<span class="tag good">Plan active</span>'
      : selected ? `<span class="tag good">${escapeHtml(selected.retailerName)} selected</span>` : ""
  ].filter(Boolean).join(" ");
  $("#productDialogBody").innerHTML = `
    <div class="detail-summary">
      ${group.imageUrl ? `<img class="detail-image" src="${escapeHtml(group.imageUrl)}" alt="" referrerpolicy="no-referrer">` : ""}
      <div>${detailSummary ? `<p>${detailSummary}</p>` : ""}<div class="inline-actions" data-product-primary-actions>${primaryActions}</div></div>
    </div>
    <div class="detail-rows">${rows}</div>`;
  for (const image of $$("#productDialogBody img")) {
    image.addEventListener("error", () => { image.remove(); }, { once: true });
  }
}

function openProductDetail(variantId) {
  renderProductDetail(variantId);
  $("#productDialog").showModal();
}

$("#productDialogBody").addEventListener("change", (event) => {
  const choice = event.target.closest?.("[data-product-store-choice]");
  if (!choice?.checked || !choice.dataset.variantId || !choice.dataset.productStoreChoice) return;
  state.productStoreSelections.set(choice.dataset.variantId, choice.dataset.productStoreChoice);
  renderProductDetail(choice.dataset.variantId);
  requestAnimationFrame(() => {
    $("#productDialogBody [data-product-store-choice]:checked")?.focus();
  });
});

function renderProfiles() {
  const list = $("#profileList");
  if (!list) return;
  list.innerHTML = state.profiles.length
    ? state.profiles.map((profile) => `<div class="mini-row profile-row"><span><strong>${escapeHtml(profile.name)}</strong><small> · ${escapeHtml(profileSummary(profile))}</small></span><span class="inline-actions"><button class="button quiet" data-profile-edit="${escapeHtml(profile.id)}" type="button">Edit</button><button class="button quiet" data-profile-delete="${escapeHtml(profile.id)}" type="button">Remove</button></span></div>`).join("")
    : '<div class="mini-row"><span>No Quick add setups yet. Quick add uses the Notify-only setup until you save one.</span></div>';
}

function renderWalmartDraws() {
  const draws = state.overview?.walmartDraws || {};
  const latest = draws.latestScan || null;
  const items = Array.isArray(draws.items) ? draws.items : [];
  $("#walmartDrawSummary").innerHTML = `<article class="plan-card"><div><div class="card-top"><h3>Latest check</h3><span class="tag ${latest?.outcome === "passed" ? "good" : "warn"}">${escapeHtml(latest ? labelFor(DRAW_SCAN_LABELS, latest.outcome) : "Not checked yet")}</span></div><p>${latest ? `${Number(latest.observedCardCount || 0)} of ${Number(latest.expectedCardCount || 0)} cards recorded ${relative(latest.observedAt)}.` : "No drawing check is recorded yet."}</p></div>${retailerLinkMarkup("https://www.walmart.com/shop/collectibles/draw", "Walmart Collectibles Draw", "Open Walmart Draw ↗")}</article>`;
  $("#walmartDrawList").innerHTML = items.length ? items.map((item) => {
    const closesAt = new Date(String(item.closesAt || "")).getTime();
    const closes = Number.isFinite(closesAt)
      ? `Closes ${dropDateTime(item.closesAt, viewerTimezone())}`
      : "Closing time unknown";
    const details = [
      `Walmart item ${item.retailerSku}`,
      item.sellerName || "seller unknown",
      money(item.unitPriceCents, item.currency),
      closes
    ];
    return `<article class="product-card" data-store="walmart">
    <div class="card-top"><span class="store">Walmart</span><span class="tag">Drawing</span></div>
    <h3>${escapeHtml(item.title)}</h3>
    <p>${details.map((detail) => escapeHtml(detail)).join(" · ")}</p>
    <div class="tags"><span class="tag ${item.drawState === "active" ? "good" : "warn"}">${escapeHtml(labelFor(DRAW_STATE_LABELS, item.drawState || "unknown"))}</span>${item.tracked ? '<span class="tag good">Matches your plan</span>' : ""}</div>
    <div class="card-actions">${retailerLinkMarkup(item.canonicalUrl, item.title, "View item ↗")}</div>
  </article>`;
  }).join("") : '<div class="empty">No open drawings are currently recorded.</div>';
}

function qualificationCandidateFor(readiness) {
  const unresolved = Array.isArray(readiness?.targets)
    ? readiness.targets.find((target) => target.reasonCode === "lane_not_qualified")
    : null;
  if (!unresolved) return null;
  return (state.overview?.qualificationCandidates || [])
    .find((candidate) => candidate.retailerId === unresolved.retailerId) || null;
}

function automationReadinessMarkup(readiness) {
  if (!readiness || typeof readiness !== "object") return "";
  const ready = readiness.level === "ready";
  const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
  const candidate = qualificationCandidateFor(readiness);
  const candidateMarkup = candidate
      ? `<div class="qualification-candidate"><span><strong>${escapeHtml(retailerDisplayName(candidate.retailerId))} store check product</strong><small>${escapeHtml(candidate.retailerSku)} · ${escapeHtml(money(candidate.unitPriceCents, candidate.currency))} · Shipping · observed ${escapeHtml(relative(candidate.observedAt))}${candidate.rehearsalPassed ? " · check passed" : ""}</small></span>${retailerLinkMarkup(candidate.canonicalUrl, `${retailerDisplayName(candidate.retailerId)} store check product`, "Open product ↗", "button quiet")}</div>`
    : "";
  const checkMarkup = checks.map((item) => {
    const symbol = item.state === "pass" ? "✓" : item.state === "runtime" ? "↻" : "•";
    return `<li class="${escapeHtml(item.state)}"><span aria-hidden="true">${symbol}</span><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div></li>`;
  }).join("");
  const technicalMarkup = readiness.technicalReason
    ? `<small class="automation-technical"><strong>Technical reason:</strong> <code>${escapeHtml(readiness.technicalReason)}</code></small>`
    : "";
  return `<section class="automation-readiness ${escapeHtml(readiness.level || "waiting")}" aria-label="Automation readiness">
    <div class="automation-readiness-head"><span class="tag ${ready ? "good" : "warn"}">${ready ? "Ready" : readiness.level === "off" ? "Off" : "Needs attention"}</span><strong>${escapeHtml(readiness.headline || "Automation status unavailable")}</strong></div>
    <p>${escapeHtml(readiness.summary || "")}</p>
    ${readiness.nextActionLabel ? `<small class="automation-next"><strong>Next:</strong> ${escapeHtml(readiness.nextActionLabel)}</small>` : ""}
    ${candidateMarkup}
    ${checkMarkup || technicalMarkup ? `<details><summary>Details</summary>${checkMarkup ? `<ul>${checkMarkup}</ul>` : ""}${technicalMarkup}</details>` : ""}
  </section>`;
}

function planReadinessGroup(plan) {
  if (plan?.status !== "active") return "attention";
  if (plan?.actionCeiling !== "add_to_cart") return "monitoring";
  return plan?.automationReadiness?.readyForGuardedAdd === true ? "ready" : "attention";
}

function planEligibleForBulkProfile(plan) {
  return ["active", "paused"].includes(String(plan?.status || ""));
}

const PLAN_STATUS_LABELS = Object.freeze({
  active: "Active",
  paused: "Paused",
  satisfied: "Satisfied",
  archived: "Archived"
});

function planStatusLabel(status) {
  return PLAN_STATUS_LABELS[String(status || "")] || "Unavailable";
}

async function togglePlanStatus(planId, button) {
  const summary = state.plans.find((plan) => plan.id === planId);
  if (!summary || !["active", "paused"].includes(String(summary.status))) {
    throw new Error("Only an active or paused plan can change state here.");
  }
  const nextStatus = summary.status === "paused" ? "active" : "paused";
  const priorLabel = button.textContent;
  button.disabled = true;
  button.textContent = nextStatus === "paused" ? "Pausing…" : "Resuming…";
  try {
    const { purchaseIntent: plan } = await api(`/api/v1/user/purchase-intents/${encodeURIComponent(planId)}`);
    if (!plan || plan.status !== summary.status || !Array.isArray(plan.targets)) {
      throw new Error("This plan changed. Refresh and try again.");
    }
    await api(`/api/v1/user/purchase-intents/${encodeURIComponent(planId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: nextStatus,
        targetQuantity: Number(plan.targetQuantity),
        targets: plan.targets.map((target) => ({
          id: target.id,
          enabled: target.enabled === true,
          maxUnitPriceCents: target.maxUnitPriceCents ?? null,
          sellerPolicy: target.sellerPolicy,
          fulfillment: shopperFulfillment(target.fulfillment)
        })),
        policy: {
          expectedRevision: Number(plan.intentPolicy?.revision || 1),
          changeReason: `Plan ${nextStatus === "paused" ? "paused" : "resumed"} from the user dashboard.`
        }
      })
    });
    await refresh();
    toast(nextStatus === "paused" ? "Plan paused." : "Plan resumed.");
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = priorLabel;
    }
  }
}

function renderPlanBulkControls(visiblePlans) {
  const eligiblePlans = state.plans.filter(planEligibleForBulkProfile);
  const eligibleIds = new Set(eligiblePlans.map((plan) => plan.id));
  for (const id of state.planSelection) {
    if (!eligibleIds.has(id)) state.planSelection.delete(id);
  }
  const toggle = $("#togglePlanBulk");
  const canBulkApply = state.profiles.length > 0 && eligiblePlans.length > 1;
  toggle.hidden = !canBulkApply;
  if (!canBulkApply) {
    state.planBulkMode = false;
    state.planSelection.clear();
  }
  toggle.textContent = state.planBulkMode ? "Cancel selection" : "Select plans";

  const bar = $("#planBulkBar");
  bar.hidden = !state.planBulkMode;
  if (bar.hidden) return;
  const profileSelect = $("#planBulkProfile");
  const profileIds = new Set(state.profiles.map((profile) => profile.id));
  if (!profileIds.has(state.planBulkProfileId)) state.planBulkProfileId = "";
  profileSelect.innerHTML = `<option value="">Choose setup…</option>${state.profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(`${profile.name} · ${profileSummary(profile)}`)}</option>`).join("")}`;
  profileSelect.value = state.planBulkProfileId;

  const visibleEligible = visiblePlans.filter(planEligibleForBulkProfile);
  const visibleSelectedCount = visibleEligible.filter((plan) => state.planSelection.has(plan.id)).length;
  const selectVisible = $("#planBulkSelectVisible");
  selectVisible.disabled = visibleEligible.length < 1;
  selectVisible.checked = visibleEligible.length > 0 && visibleSelectedCount === visibleEligible.length;
  selectVisible.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleEligible.length;
  const selectedCount = state.planSelection.size;
  const applyButton = $("#applyPlanBulkProfile");
  applyButton.disabled = selectedCount < 1 || !state.planBulkProfileId;
  applyButton.textContent = selectedCount ? `Apply setup to ${selectedCount}` : "Apply setup";
}

function renderPlans() {
  renderLegacyPlanTransition();
  const groups = state.plans.reduce((counts, plan) => {
    counts[planReadinessGroup(plan)] += 1;
    return counts;
  }, { ready: 0, attention: 0, monitoring: 0 });
  const summaryParts = [
    `${state.plans.length.toLocaleString()} plan${state.plans.length === 1 ? "" : "s"}`,
    groups.ready ? `${groups.ready.toLocaleString()} cart ready` : "",
    groups.attention ? `${groups.attention.toLocaleString()} need${groups.attention === 1 ? "s" : ""} attention` : "",
    groups.monitoring ? `${groups.monitoring.toLocaleString()} monitoring only` : ""
  ].filter(Boolean);
  $("#planSummary").textContent = state.plans.length
    ? summaryParts.join(" · ")
    : "Create a plan from a product when you are ready.";
  $("#planFilterControl").hidden = state.plans.length < 2;
  $("#planFilter").value = state.planFilter;
  const groupOrder = { attention: 0, ready: 1, monitoring: 2 };
  const visiblePlans = state.plans
    .filter((plan) => state.planFilter === "all" || planReadinessGroup(plan) === state.planFilter)
    .sort((first, second) => {
      const groupDifference = groupOrder[planReadinessGroup(first)] - groupOrder[planReadinessGroup(second)];
      return groupDifference || String(first.title || "").localeCompare(String(second.title || ""));
    });
  renderPlanBulkControls(visiblePlans);
  $("#planList").innerHTML = visiblePlans.length ? visiblePlans.map((plan) => {
    const store = plan.primaryRetailerName || "No store enabled";
    const current = plan.primaryCurrentPriceCents ? money(plan.primaryCurrentPriceCents) : "not seen yet";
    const maximum = plan.primaryMaxUnitPriceCents ? money(plan.primaryMaxUnitPriceCents) : "not set";
    const fulfillment = plan.primaryFulfillment ? labelFor(FULFILLMENT_LABELS, plan.primaryFulfillment) : "Delivery not selected";
    const action = plan.actionCeiling === "add_to_cart" ? "Add to cart" : "Notify only";
    const linkedProfile = state.profiles.find((profile) => profile.id === plan.quickAddProfileId) || null;
    const profileLine = linkedProfile
      ? linkedProfile.actionCeiling === "add_to_cart" && plan.actionCeiling !== "add_to_cart"
        ? `<p class="plan-profile-line"><strong>Setup “${escapeHtml(linkedProfile.name)}” linked</strong> · waiting for current store or price evidence; retry is automatic</p>`
        : `<p class="plan-profile-line">Setup “${escapeHtml(linkedProfile.name)}” linked</p>`
      : "";
    const decision = plan.decisionMode === "purchase_intent" ? "This reviewed plan decides" : "Default rules decide";
    const readiness = plan.automationReadiness || {};
    const storeSessionAction = readiness.state === "guarded_add_session_blocked" && plan.primaryCanonicalUrl
      ? retailerLinkMarkup(
          plan.primaryCanonicalUrl,
          `${plan.title || store} store-session recovery`,
          `Open ${store} ↗`,
          "button primary"
        )
      : "";
    const selection = state.planBulkMode && planEligibleForBulkProfile(plan)
      ? `<label class="plan-select"><input data-plan-select="${escapeHtml(plan.id)}" type="checkbox" ${state.planSelection.has(plan.id) ? "checked" : ""}><span class="sr-only">Select ${escapeHtml(plan.title)}</span></label>`
      : "";
    return `<article class="plan-card" data-store="${escapeHtml(String(plan.primaryRetailerName || "").toLowerCase().replace(/\s+/g, ""))}">
      <div class="plan-row">
        ${selection}
        <div class="plan-summary">
          <div class="plan-summary-top"><h3>${escapeHtml(plan.title)}</h3><span class="tag ${plan.status === "active" ? "good" : "warn"}">${escapeHtml(planStatusLabel(plan.status))}</span></div>
          <p class="plan-line"><strong>${escapeHtml(store)}</strong> · cap ${escapeHtml(maximum)} · qty ${Number(plan.targetQuantity || 1)} · ${escapeHtml(action)}</p>
          ${profileLine}
          <p class="plan-readiness-headline"><span class="dot ${readiness.level === "ready" ? "good" : "warn"}" role="img" aria-label="${readiness.level === "ready" ? "Ready" : "Needs attention"}"></span>${escapeHtml(readiness.headline || "Readiness unavailable")}</p>
        </div>
        <div class="inline-actions">${storeSessionAction}${["active", "paused"].includes(String(plan.status)) ? `<button class="button quiet" data-toggle-plan-status="${escapeHtml(plan.id)}" type="button">${plan.status === "paused" ? "Resume" : "Pause"}</button>` : ""}<button class="button ${storeSessionAction ? "quiet" : "secondary"}" data-edit-plan="${escapeHtml(plan.id)}" type="button">Review or change</button></div>
      </div>
      <details class="plan-details">
        <summary>Details</summary>
        <p>${plan.primaryRetailerSku ? `SKU ${escapeHtml(plan.primaryRetailerSku)} · ` : ""}last seen ${escapeHtml(current)} · ${escapeHtml(fulfillment)} · maximum total ${escapeHtml(plan.maxAllInCents ? money(plan.maxAllInCents) : "not set")} · ${Number(plan.enabledTargetCount || 0)} of ${Number(plan.targetCount || 0)} stores enabled</p>
        <p>${escapeHtml(decision)} when a matching offer arrives. Cart attempts add one item and confirm the cart change.</p>
        ${automationReadinessMarkup(readiness)}
      </details>
    </article>`;
  }).join("") : state.plans.length
    ? `<div class="empty">No ${escapeHtml($("#planFilter").selectedOptions[0]?.textContent?.toLocaleLowerCase("en-US") || "matching")} plans.</div>`
    : '<div class="empty"><p>Quick add a product from Products to create your first plan.</p><button class="button secondary" data-tab="products" type="button">Open Products</button></div>';
}

function openPlanBulkApplyDialog() {
  const missionIds = [...state.planSelection];
  const profile = state.profiles.find((candidate) => candidate.id === state.planBulkProfileId);
  const plans = missionIds
    .map((id) => state.plans.find((plan) => plan.id === id))
    .filter((plan) => planEligibleForBulkProfile(plan));
  if (!profile || !plans.length || plans.length !== missionIds.length) {
    throw new Error("Refresh and choose a current Quick add setup and at least one active or paused plan.");
  }
  state.planBulkDraft = { profileId: profile.id, missionIds: plans.map((plan) => plan.id) };
  $("#planBulkApplyTitle").textContent = `Apply “${profile.name}” to ${plans.length.toLocaleString()} plan${plans.length === 1 ? "" : "s"}?`;
  $("#planBulkApplySummary").textContent = profileSummary(profile);
  $("#planBulkApplySamples").innerHTML = plans.slice(0, 5).map((plan) => `<div class="mini-row"><span>${escapeHtml(plan.title)}</span><strong>${escapeHtml(planStatusLabel(plan.status))}</strong></div>`).join("")
    + (plans.length > 5 ? `<div class="mini-row"><span>And ${plans.length - 5} more</span><strong>Selected</strong></div>` : "");
  const cartAction = profile.actionCeiling === "add_to_cart";
  const boundary = $("#planBulkApplyBoundary");
  boundary.className = `boundary-note ${cartAction ? "warn" : "good"}`;
  boundary.innerHTML = cartAction
    ? `<strong>Cart actions can be enabled.</strong> Eligible plans update now; others keep their limits until ready. ${profile.fulfillment === "pickup" ? "Pickup applies only where selected and available." : "Shipping remains required."}`
    : "<strong>No store action is authorized.</strong> Selected plans become notification-only.";
  $("#planBulkApplyReviewCopy").textContent = cartAction
    ? "I reviewed this setup, its price method, fulfillment, quantity, and the selected plans."
    : "I reviewed this notification-only setup and the selected plans.";
  const form = $("#planBulkApplyForm");
  form.elements.reviewed.checked = false;
  $("#confirmPlanBulkApply").disabled = true;
  $("#planBulkApplyDialog").showModal();
  requestAnimationFrame(() => form.elements.reviewed.focus());
}

function renderLegacyPlanTransition() {
  const preview = state.legacyTransition;
  const host = $("#planSummaryNotices");
  const count = Number(preview?.eligibleCount || 0);
  if (!count) {
    host.replaceChildren();
    const dialog = $("#legacyPlanTransitionDialog");
    if (dialog?.hasAttribute("open")) dialog.close();
    dialog?.remove();
    return;
  }
  host.innerHTML = `<section class="plan-transition" data-legacy-plan-transition>
    <div><strong>${count.toLocaleString()} imported plan${count === 1 ? " needs" : "s need"} review</strong><span>Make ${count === 1 ? "it" : "them"} notification-only.</span></div>
    <button class="button secondary" id="reviewLegacyPlanTransitionButton" type="button">Review</button>
  </section>`;
}

function ensureLegacyPlanTransitionDialog() {
  let dialog = $("#legacyPlanTransitionDialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "legacyPlanTransitionDialog";
  dialog.className = "compact-dialog";
  dialog.innerHTML = `<form id="legacyPlanTransitionForm">
    <div class="dialog-heading"><div><p class="eyebrow">One-time plan update</p><h2>Make imported plans monitoring-ready</h2></div><button class="icon-button" data-close-dialog type="button" aria-label="Close">×</button></div>
    <p class="dialog-copy" id="legacyPlanTransitionSummary"></p>
    <div class="mini-list" id="legacyPlanTransitionSamples"></div>
    <label class="review-confirm"><input name="reviewed" type="checkbox" required><span>Make these plans notification-only.</span></label>
    <div class="dialog-actions"><button class="button quiet" data-close-dialog type="button">Cancel</button><button class="button primary" id="transitionLegacyPlansButton" type="submit" disabled>Make plans monitoring-ready</button></div>
  </form>`;
  document.body.append(dialog);
  const form = $("#legacyPlanTransitionForm");
  form.elements.reviewed.addEventListener("change", (event) => {
    $("#transitionLegacyPlansButton").disabled = event.target.checked !== true;
  });
  form.addEventListener("submit", submitLegacyPlanTransition);
  return dialog;
}

function openLegacyPlanTransition() {
  const preview = state.legacyTransition;
  const count = Number(preview?.eligibleCount || 0);
  if (!preview || count < 1) {
    toast("No imported plans currently need transition.");
    return;
  }
  const dialog = ensureLegacyPlanTransitionDialog();
  const active = Number(preview.activeCount || 0);
  const paused = Number(preview.pausedCount || 0);
  $("#legacyPlanTransitionSummary").textContent = `${count.toLocaleString()} plan${count === 1 ? "" : "s"} will use ${count === 1 ? "its" : "their"} own limits instead of the default rules and become notify-only plans (${active.toLocaleString()} active${paused ? `, ${paused.toLocaleString()} paused` : ""}).`;
  const samples = Array.isArray(preview.samplePlans) ? preview.samplePlans : [];
  $("#legacyPlanTransitionSamples").innerHTML = samples.map((plan) => `<div class="mini-row"><span>${escapeHtml(plan.title)}</span><strong>${escapeHtml(planStatusLabel(plan.status))}</strong></div>`).join("");
  const form = $("#legacyPlanTransitionForm");
  form.elements.reviewed.checked = false;
  $("#transitionLegacyPlansButton").disabled = true;
  dialog.showModal();
  requestAnimationFrame(() => form.elements.reviewed.focus());
}

async function transitionLegacyPlans() {
  const preview = state.legacyTransition;
  if (!preview || Number(preview.eligibleCount || 0) < 1) throw new Error("Refresh the current transition preview first.");
  const result = await api("/api/v1/user/purchase-intents/legacy-transition", {
    method: "POST",
    body: JSON.stringify({
      contractVersion: Number(preview.contractVersion),
      previewFingerprint: preview.previewFingerprint,
      confirmation: "CONVERT_LEGACY_PLANS_TO_NOTIFICATIONS"
    })
  });
  return result.transition || {};
}

async function submitLegacyPlanTransition(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#transitionLegacyPlansButton");
  try {
    if (form.elements.reviewed.checked !== true) {
      throw new Error("Review and confirm the notification-only transition first.");
    }
    button.disabled = true;
    button.textContent = "Updating plans…";
    const transition = await transitionLegacyPlans();
    $("#legacyPlanTransitionDialog").close();
    await refresh();
    setTab("plans");
    const count = Number(transition.transitionedCount || 0);
    toast(`${count.toLocaleString()} imported plan${count === 1 ? " is" : "s are"} now user-controlled and notification-ready. Cart actions still require explicit limits per product.`);
  } catch (error) {
    if (error.code === "legacy_purchase_intent_transition_stale") await refresh();
    toast(error.message || "The imported plans could not be transitioned.", true);
  } finally {
    button.textContent = "Make plans monitoring-ready";
    button.disabled = form.elements.reviewed.checked !== true;
  }
}

function actionStage(action) {
  return action?.stage || (["manual_review", "submission_uncertain"].includes(action?.state)
    ? "needs_you" : action?.state === "confirmed" && action?.action === "add_to_cart" ? "ready_to_checkout" : "closed");
}

function closeableCartAction(action) {
  return action?.action === "add_to_cart"
    && !action?.userReportOutcome
    && ["ready_to_checkout", "needs_you"].includes(actionStage(action));
}

function actionOutcomeCard(actionId) {
  return $$('[data-action-job]').find((card) => card.dataset.actionJob === String(actionId || "")) || null;
}

function openCartOutcomeDialog(actionId, returnFocus = null) {
  const action = state.actions.find((item) => item.id === actionId);
  if (!closeableCartAction(action)) {
    toast("Refresh before recording this checkout result.", true);
    return;
  }
  const dialog = $("#cartOutcomeDialog");
  const form = $("#cartOutcomeForm");
  form.reset();
  form.removeAttribute("aria-busy");
  form.elements.actionId.value = action.id;
  form.elements.actualTotal.removeAttribute("aria-invalid");
  const maxTotalCents = Number(action.maxOrderTotalCents);
  const prefillCents = [
    action.maxOrderTotalCents,
    action.lastObservedPriceCents,
    action.observedPriceCents,
    action.unitPriceCents,
    action.maxUnitPriceCents
  ].map(Number).find((value) => Number.isSafeInteger(value) && value > 0) || null;
  form.elements.actualTotal.removeAttribute("max");
  form.elements.actualTotal.value = prefillCents === null ? "" : (prefillCents / 100).toFixed(2);
  const limit = $("#cartOutcomeLimit");
  limit.classList.remove("warn");
  limit.classList.toggle("good", prefillCents !== null);
  if (Number.isSafeInteger(maxTotalCents) && maxTotalCents > 0) {
    limit.textContent = `Reviewed maximum for this action: ${money(maxTotalCents, action.currency)}.`;
  } else {
    form.elements.actualTotal.removeAttribute("max");
    limit.textContent = prefillCents === null
      ? "Enter the amount charged."
      : `Last observed price: ${money(prefillCents, action.currency)}.`;
  }
  $("#cartOutcomeSummary").textContent = `${action.title} · ${retailerDisplayName(action.retailerId)} · ${action.retailerSku}`;
  $("#cartOutcomeStatus").hidden = true;
  $("#cartOutcomeStatus").textContent = "";
  state.cartOutcomeActionId = action.id;
  state.cartOutcomeReturnFocus = returnFocus;
  dialog.showModal();
  requestAnimationFrame(() => form.elements.actualTotal.focus());
}

function syncCartOutcomeCapWarning() {
  const action = state.actions.find((item) => item.id === state.cartOutcomeActionId);
  const input = $("#cartOutcomeForm").elements.actualTotal;
  const limit = $("#cartOutcomeLimit");
  const maximum = Number(action?.maxOrderTotalCents);
  const actual = Math.round(Number(input.value) * 100);
  const overBy = Number.isSafeInteger(maximum) && maximum > 0 && Number.isSafeInteger(actual)
    ? Math.max(0, actual - maximum)
    : 0;
  limit.classList.toggle("warn", overBy > 0);
  limit.classList.toggle("good", overBy === 0);
  limit.textContent = overBy > 0
    ? `Above your reviewed maximum by ${money(overBy, action?.currency)}; this will be recorded as actual spend.`
    : Number.isSafeInteger(maximum) && maximum > 0
      ? `Reviewed maximum for this action: ${money(maximum, action?.currency)}.`
      : "Enter the amount charged.";
}

async function reportCartOutcome(action, outcome, actualTotalCents, { dialogForm = null } = {}) {
  if (!closeableCartAction(action) || !["got_it", "missed_it"].includes(outcome)) {
    toast("Refresh before closing this cart action.", true);
    return false;
  }
  const card = actionOutcomeCard(action.id);
  const cardControls = card ? [...card.querySelectorAll("button[data-cart-got-it], button[data-cart-missed-it]")] : [];
  const cardStatus = card?.querySelector("[data-outcome-status]") || null;
  const dialogControls = dialogForm ? [...dialogForm.elements] : [];
  const controls = [...new Set([...cardControls, ...dialogControls])];
  controls.forEach((control) => { control.disabled = true; });
  if (card) card.setAttribute("aria-busy", "true");
  if (dialogForm) dialogForm.setAttribute("aria-busy", "true");
  const pendingMessage = outcome === "got_it" ? "Recording purchase…" : "Closing action…";
  if (cardStatus) {
    cardStatus.hidden = false;
    cardStatus.textContent = pendingMessage;
  }
  if (dialogForm) {
    $("#cartOutcomeStatus").hidden = false;
    $("#cartOutcomeStatus").textContent = pendingMessage;
  }
  try {
    await api(`/api/v1/user/jobs/${encodeURIComponent(action.id)}/outcome`, {
      method: "POST",
      body: JSON.stringify({
        outcome,
        actualTotalCents,
        confirmation: "I_REVIEWED_CHECKOUT_RESULT"
      })
    });
    state.loadedRoutes.delete("home");
    if (dialogForm && $("#cartOutcomeDialog").hasAttribute("open")) $("#cartOutcomeDialog").close();
    toast(outcome === "got_it" ? "Purchase recorded and plan progress updated." : "Cart action closed as Missed it.");
    try {
      await refresh();
      scheduleAdaptivePoll();
    } catch {
      if (cardStatus) {
        cardStatus.hidden = false;
        cardStatus.textContent = "Result recorded. Refresh Activity to update this row.";
      }
      scheduleAdaptivePoll();
      toast("Checkout result was recorded, but Activity could not refresh yet.", true);
    }
    return true;
  } catch (error) {
    controls.forEach((control) => { if (control.isConnected) control.disabled = false; });
    if (card) card.removeAttribute("aria-busy");
    if (dialogForm) dialogForm.removeAttribute("aria-busy");
    const message = error.message || "The checkout result could not be recorded.";
    if (cardStatus) {
      cardStatus.hidden = false;
      cardStatus.textContent = "Couldn’t record this result. Try again.";
    }
    if (dialogForm) {
      $("#cartOutcomeStatus").hidden = false;
      $("#cartOutcomeStatus").textContent = "Couldn’t record this purchase. Try again.";
    }
    toast(message, true);
    return false;
  }
}

function renderActions() {
  const stages = state.actionInsights?.stages || {};
  const readyCount = Number(stages.ready_to_checkout || 0);
  const needsYouCount = Number(stages.needs_you || 0);
  const handoff = $("#actionHandoff");
  handoff.hidden = readyCount + needsYouCount < 1;
  if (!handoff.hidden) {
    const ready = readyCount > 0;
    $("#actionHandoffEyebrow").textContent = ready ? "Ready to check out" : "Needs you";
    $("#actionHandoffTitle").textContent = ready
      ? `${readyCount.toLocaleString()} cart${readyCount === 1 ? " is" : "s are"} ready`
      : `${needsYouCount.toLocaleString()} action${needsYouCount === 1 ? " needs" : "s need"} review`;
    $("#actionHandoffCopy").textContent = ready
      ? "Open the store cart, finish checkout yourself, then close the result below."
      : "Check the store session, then choose Got it or Missed it so Yoink can close the plan safely.";
  }
  const stageLabels = {
    queued: "Queued",
    checking: "Checking",
    ready_to_checkout: "Ready to check out",
    needs_you: "Needs you",
    closed: "Closed"
  };
  const stageDescriptions = {
    queued: "Waiting for Chrome to start the action.",
    checking: "Chrome is checking the live store page.",
    ready_to_checkout: "The item is in the store cart and ready for your checkout.",
    needs_you: "Review the store cart or session before closing the result.",
    closed: "The action has a final result."
  };
  const totalStageCount = Object.keys(stageLabels)
    .reduce((total, stage) => total + Number(stages[stage] || 0), 0);
  const filterButtons = [
    { stage: "all", label: "All", count: totalStageCount, description: "Show every recorded action." },
    ...Object.entries(stageLabels).map(([stage, label]) => ({
      stage,
      label,
      count: Number(stages[stage] || 0),
      description: state.actionGlossary?.[stage]?.summary || stageDescriptions[stage]
    }))
  ];
  $("#actionStageSummary").innerHTML = totalStageCount > 0 ? filterButtons.map((item) => {
    const selected = state.actionStageFilter === item.stage;
    return `<button class="action-stage-filter${selected ? " active" : ""}" data-action-stage-filter="${escapeHtml(item.stage)}" type="button" aria-pressed="${selected}" aria-controls="actionList" title="${escapeHtml(item.description)}">${escapeHtml(item.label)} · ${item.count.toLocaleString()}</button>`;
  }).join("") : "";
  const glossaryEntries = Object.entries(state.actionGlossary || {});
  $("#actionStatusGlossary").hidden = glossaryEntries.length < 1 && state.actions.length < 1;
  $("#actionActivityDetails").hidden = state.actions.length < 1;

  const actionPriority = { ready_to_checkout: 0, needs_you: 1, checking: 2, queued: 3, closed: 4 };
  const filteredActions = state.actionStageFilter === "all"
    ? [...state.actions]
    : state.actions.filter((action) => actionStage(action) === state.actionStageFilter);
  const visibleActions = filteredActions
    .sort((first, second) => Number(actionPriority[actionStage(first)] ?? 9) - Number(actionPriority[actionStage(second)] ?? 9))
    .slice(0, state.actionDisplayLimit);
  $("#showMoreActions").hidden = visibleActions.length >= filteredActions.length;
  $("#actionList").innerHTML = visibleActions.length ? visibleActions.map((action) => {
    const stage = actionStage(action);
    const confirmation = (state.actionPlatform?.orderConfirmations || [])
      .find((item) => item.actionJobId === action.id);
    const canClose = closeableCartAction(action);
    return `<article class="action-card" data-action-job="${escapeHtml(action.id)}" data-store="${escapeHtml(action.retailerId || "")}" data-stage="${escapeHtml(stage)}">
    <div><div class="card-top"><h3>${escapeHtml(action.title)}</h3><span class="tag ${stage === "ready_to_checkout" || action.userReportOutcome === "got_it" ? "good" : stage === "needs_you" ? "warn" : stage === "checking" ? "info" : ""}">${escapeHtml(action.statusLabel || (stage === "needs_you" ? "Needs you" : labelFor(ACTION_STATE_LABELS, action.state)))}</span></div>
    <p>${escapeHtml(retailerDisplayName(action.retailerId))} · ${escapeHtml(action.retailerSku)}</p>
    ${confirmation ? `<p><strong>Checkout confirmation observed</strong> · ${escapeHtml(relative(confirmation.observedAt))}. Confirm the result below; Yoink did not collect order or payment details.</p>` : ""}
    <details class="action-evidence"><summary>Details</summary>
      <p>${escapeHtml(labelFor(ACTION_KIND_LABELS, action.action))} · ${escapeHtml(labelFor(DECISION_SOURCE_LABELS, action.decisionSource, "default rules"))} · unit cap ${escapeHtml(money(action.maxUnitPriceCents, action.currency))}${action.spendReservationStatus ? ` · ${escapeHtml(labelFor(RESERVATION_LABELS, action.spendReservationStatus))}` : ""}</p>
      ${action.statusSummary ? `<p>${escapeHtml(action.statusSummary)}</p>` : ""}
      ${action.decisionReason ? `<p><strong>Latest:</strong> ${escapeHtml(action.decisionReason)}${action.decisionReasonCode ? ` · ${escapeHtml(labelFor(REASON_LABELS, action.decisionReasonCode))}` : ""}</p>` : ""}
    </details></div>
    <div class="action-controls"><div class="inline-actions">
      ${["ready_to_checkout", "needs_you"].includes(stage) && RETAILER_CART_URLS[action.retailerId]
        ? retailerLinkMarkup(
          RETAILER_CART_URLS[action.retailerId],
          `${action.title} cart handoff`,
          stage === "ready_to_checkout" ? "Open cart ↗" : "Review store ↗",
          "button primary cart-handoff-link",
          "",
          { jobId: action.id, destinationKind: "cart" }
        )
        : ""}
      ${retailerLinkMarkup(action.canonicalUrl, action.title, "Store page ↗", "canonical", "", { jobId: action.id, destinationKind: "store" })}
    </div>
    ${canClose ? `<div class="cart-closeout"><span>Checkout result</span><div class="inline-actions"><button class="button secondary" data-cart-got-it="${escapeHtml(action.id)}" type="button">Got it</button><button class="button secondary" data-cart-missed-it="${escapeHtml(action.id)}" type="button">Missed it</button></div><small class="outcome-status" data-outcome-status role="status" aria-live="polite" hidden></small></div>` : ""}
    </div>
  </article>`;
  }).join("") : `<div class="empty">${state.actions.length
    ? `No ${escapeHtml(stageLabels[state.actionStageFilter] || "matching").toLowerCase()} actions.`
    : "No purchase or notification actions have been recorded yet."}</div>`;
}

function callHasPlan(call) {
  const product = state.products.find((item) => item.listingId === call.listingId);
  return Boolean(product && state.plans.some((plan) => plan.variantId === product.variantId));
}

function currentDropWindows(now = Date.now()) {
  return (Array.isArray(state.dropWindows) ? state.dropWindows : [])
    .filter((window) => ["scheduled", "active"].includes(String(window.status))
      && new Date(window.closesAt).getTime() > now)
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
}

function dropWatchToggle(item) {
  const watch = item?.watch || null;
  const active = watch && ["queued", "observing"].includes(String(watch.state));
  const title = String(item?.title || `${retailerDisplayName(item?.retailerId)} item`);
  if (active) {
    return `<button class="drop-watch-toggle" data-watch-cancel="${escapeHtml(watch.id)}" type="button" aria-pressed="true" aria-label="Stop watching ${escapeHtml(title)}">Watching</button>`;
  }
  if (!watch) {
    return `<button class="drop-watch-toggle" data-watch-enroll="${escapeHtml(item.id)}" type="button" aria-pressed="false" aria-label="Watch ${escapeHtml(title)}">Watch ${escapeHtml(title)}</button>`;
  }
  const observed = watch.state === "seen_in_stock";
  return `<button class="drop-watch-toggle" type="button" aria-pressed="false" disabled>${observed ? "Seen in stock" : "Watch ended"}</button>`;
}

function renderUpcomingDrops() {
  const windows = currentDropWindows();
  const visible = windows.slice(0, 3);
  const markup = visible.map((window) => {
    const items = Array.isArray(window.items) ? window.items : [];
    const shownItems = items.slice(0, 4);
    return `<article class="upcoming-drop-row">
      <div><strong>${escapeHtml(window.title || `${retailerDisplayName(window.retailerId)} drop`)}</strong><small>${escapeHtml(formatDropWindowSchedule(window))}</small></div>
      <div class="upcoming-drop-items">${shownItems.map(dropWatchToggle).join("")}${items.length > shownItems.length ? `<span class="tag">+${(items.length - shownItems.length).toLocaleString()} in Calls</span>` : ""}</div>
    </article>`;
  }).join("");
  $$("#homeUpcomingDrops, #callsUpcomingDrops").forEach((panel) => {
    panel.hidden = visible.length === 0;
    const list = $("[data-upcoming-drop-list]", panel);
    if (list) list.innerHTML = markup;
  });
}

function scheduleDropClock() {
  if (state.dropClockTimer !== null) clearInterval(state.dropClockTimer);
  state.dropClockTimer = null;
  if (!currentDropWindows().length) return;
  state.dropClockTimer = setInterval(() => {
    renderUpcomingDrops();
    if (activeUserRoute() === "calls") renderCalls();
  }, 30_000);
}

function watchWindowSummary(call) {
  const watch = call.watch || null;
  const now = Date.now();
  const observationStartsAt = new Date(String(watch?.observationStartsAt || call.startsAt || "")).getTime();
  const closesAt = new Date(String(watch?.observationClosesAt || call.closesAt || "")).getTime();
  const schedule = formatDropWindowSchedule(call, now);
  if (Number.isFinite(closesAt) && closesAt <= now) return `${schedule} · Watch window closed.`;
  if (watch && Number.isFinite(observationStartsAt) && observationStartsAt > now) {
    return `${schedule} · Watching starts ${relative(new Date(observationStartsAt).toISOString())}.`;
  }
  if (watch && Number.isFinite(closesAt)) {
    return `${schedule} · Watching for stock.`;
  }
  if (Number.isFinite(observationStartsAt) && observationStartsAt > now) {
    return `${schedule} · Watch opens ${relative(new Date(observationStartsAt).toISOString())}.`;
  }
  return Number.isFinite(closesAt) ? schedule : "Watch window not scheduled.";
}

function watchReadinessSummary(watch) {
  if (!watch) return "";
  const count = Number(watch.observationCount || 0);
  const availability = labelFor(AVAILABILITY_LABELS, watch.lastAvailability || "unknown");
  const reason = watch.readiness?.reasonCode ? labelFor(REASON_LABELS, watch.readiness.reasonCode) : "";
  const enrollment = watch.enrollment === "auto_armed" ? "Watched automatically for your plan" : "You chose Watch";
  if (!count) return `${enrollment} · waiting for the first Chrome check.`;
  return `${enrollment} · ${count.toLocaleString()} check${count === 1 ? "" : "s"} · ${availability}${watch.lastObservedAt ? ` · ${relative(watch.lastObservedAt)}` : ""}${reason ? ` · ${reason}` : ""}.`;
}

function renderWatchQueueSetting() {
  const watchMode = state.actionPlatform?.watchQueueMode === "auto_armed" ? "auto_armed" : "manual";
  const control = $("#watchQueueMode");
  if (control && document.activeElement !== control) control.value = watchMode;
  $("#watchQueueModeStatus").textContent = watchMode === "auto_armed"
    ? "Upcoming and open drops for active plans are watched automatically without adding to cart."
    : "Drops are watched only when you choose Watch.";
}

function syncCallFilterView() {
  const callFilter = ["all", "products", "drawings"].includes(state.callFilter) ? state.callFilter : "all";
  state.callFilter = callFilter;
  $$('[data-call-filter]').forEach((button) => {
    const active = button.dataset.callFilter === callFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#callProductResults").hidden = callFilter === "drawings";
  $("#callDrawingResults").hidden = callFilter === "products";
  return callFilter;
}

function renderCalls() {
  renderUpcomingDrops();
  renderWatchQueueSetting();
  renderWalmartDraws();
  const callFilter = syncCallFilterView();
  const select = $("#callBulkProfile");
  const selected = select.value;
  const defaultProfile = state.profiles.find((profile) => profile.isDefault === true) || null;
  const requiresProfileChoice = state.profiles.length > 0 && !defaultProfile;
  const defaultOption = requiresProfileChoice
      ? '<option value="" disabled>Choose setup…</option><option value="__notify">Notify-only setup</option>'
      : `<option value="">${defaultProfile ? `Default setup · ${escapeHtml(defaultProfile.name)}` : "Notify-only setup"}</option>`;
  select.innerHTML = [defaultOption, ...state.profiles.map((profile) =>
    `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`)].join("");
  const retainedSelection = selected === "__notify" || state.profiles.some((profile) => profile.id === selected);
  select.value = retainedSelection ? selected : "";
  const calls = Array.isArray(state.calls) ? state.calls : [];
  const drawings = Array.isArray(state.overview?.walmartDraws?.items) ? state.overview.walmartDraws.items : [];
  const visibleCount = callFilter === "products" ? calls.length : callFilter === "drawings" ? drawings.length : calls.length + drawings.length;
  const countLabel = callFilter === "products" ? "product call" : callFilter === "drawings" ? "drawing" : "call";
  $("#callCount").textContent = `${visibleCount.toLocaleString()} ${countLabel}${visibleCount === 1 ? "" : "s"}`;
  scheduleWalmartHandoffExpiry(calls);
  const visibleCalls = calls.slice(0, state.callDisplayLimit);
  $("#showMoreCalls").hidden = callFilter === "drawings" || visibleCalls.length >= calls.length;
  $("#callList").innerHTML = calls.length ? visibleCalls.map((call) => {
    const planned = callHasPlan(call);
    const walmartPurchaseAction = walmartPurchaseLinkMarkup(call);
    const storePageAction = walmartPurchaseAction
      ? walmartPdpFallbackLinkMarkup(call)
      : call.canonicalUrl ? retailerLinkMarkup(call.canonicalUrl, call.title, "Store page ↗") : "";
    const watch = call.watch || null;
    const watchActive = watch && ["queued", "observing"].includes(watch.state);
    const eligible = Boolean(call.listingId) && !planned && !walmartPurchaseAction;
    const membership = String(call.earlyAccess?.membership || "");
    const queueExpected = call.earlyAccess?.queueExpected === true;
    const typeTag = call.kind === "signal" ? "Signal" : call.kind === "queue_open" ? "Queue" : "Drop";
    const stateTag = words(String(call.status || "received"));
    const stateClass = ["confirmed", "seen_in_stock", "in_stock", "purchase_ready"].includes(call.status)
      ? "good"
      : ["failed", "expired", "cancelled"].includes(call.status) ? "warn" : "";
    const qualifierTag = call.falsePositiveReported
      ? "False positive reported"
      : walmartPurchaseAction ? "Buy ready"
        : planned ? "Plan ready"
          : watchActive ? "Watching"
            : call.kind === "signal" ? String(call.source || "") : "";
    const qualifierClass = call.falsePositiveReported ? "warn" : (planned || walmartPurchaseAction) ? "good" : "";
    const details = [
      retailerDisplayName(call.retailerId),
      call.retailerSku,
      call.unitPriceCents ? money(call.unitPriceCents, call.currency) : "",
      relative(call.occurredAt),
      membership ? `Access: ${membership}` : "",
      queueExpected ? "Queue expected" : ""
    ].filter(Boolean);
    return `<article class="action-card call-card" data-store="${escapeHtml(call.retailerId || "")}">
      <label class="call-select"><input type="checkbox" data-call-select="${escapeHtml(call.listingId)}" ${eligible ? "" : "disabled"}><span class="sr-only">Select ${escapeHtml(call.title)}</span></label>
      <div><div class="card-top"><h3>${escapeHtml(call.title || `${retailerDisplayName(call.retailerId)} product`)}</h3><span class="tag">${escapeHtml(typeTag)}</span></div>
      <p>${details.map((detail) => escapeHtml(detail)).join(" · ")}</p>
      <div class="call-tags"><span class="tag ${stateClass}">${escapeHtml(stateTag)}</span>${qualifierTag ? `<span class="tag ${qualifierClass}">${escapeHtml(qualifierTag)}</span>` : ""}</div>
      ${call.closesAt ? `<p>${escapeHtml(watchWindowSummary(call))}</p>` : ""}
      ${watch ? `<p class="watch-readiness">${escapeHtml(watchReadinessSummary(watch))}</p>` : ""}</div>
      <div class="action-controls"><div class="inline-actions">
        ${walmartPurchaseAction}
        ${eligible ? quickAddMarkup({ listingId: call.listingId }, { title: call.title || `${retailerDisplayName(call.retailerId)} product` }) : ""}
        ${call.dropWindowItemId && !watch ? `<button class="button secondary" data-watch-enroll="${escapeHtml(call.dropWindowItemId)}" type="button">Watch</button>` : ""}
        ${watchActive ? `<button class="button quiet" data-watch-cancel="${escapeHtml(watch.id)}" type="button">Stop watching</button>` : ""}
        ${call.kind === "signal" && call.sourceChannelId && !call.falsePositiveReported ? `<button class="button quiet" data-false-positive="${escapeHtml(call.id)}" type="button">Report false positive</button>` : ""}
        ${storePageAction}
      </div></div>
    </article>`;
  }).join("") : '<div class="empty">No calls or scheduled drops have arrived yet.</div>';
  syncCallBulkAction();
}

function syncCallBulkAction() {
  const selectedCount = $$('[data-call-select]:checked').length;
  $("#callSelectionToolbar").hidden = selectedCount === 0 || state.callFilter === "drawings";
  $("#callSelectionCount").textContent = `${selectedCount.toLocaleString()} selected`;
  const profile = $("#callBulkProfile");
  const requiresProfileChoice = state.profiles.length > 0
    && !state.profiles.some((candidate) => candidate.isDefault === true);
  $("#callBulkAdd").disabled = selectedCount === 0 || (requiresProfileChoice && !profile.value);
}

function renderActionPlatform() {
  renderWatchQueueSetting();
  const platform = state.actionPlatform || {};
  const analytics = platform.analytics || {};
  const funnel = analytics.funnel || {};
  const spend = analytics.spend || {};
  const dailyHeadroom = spend.dailyCapCents === null || spend.dailyCapCents === undefined
    ? "No daily cap"
    : `${money(spend.availableTodayCents || 0)} of ${money(spend.dailyCapCents)} left`;
  const monthlyHeadroom = spend.monthlyCapCents === null || spend.monthlyCapCents === undefined
    ? "No monthly cap"
    : `${money(spend.availableThisMonthCents || 0)} of ${money(spend.monthlyCapCents)} left`;
  const metrics = [
    [Object.values(funnel).reduce((sum, value) => sum + Number(value || 0), 0), "Actions"],
    [funnel.ready_to_checkout || 0, "Ready to check out"],
    [funnel.needs_you || 0, "Needs you"],
    [analytics.hitRateBps === null || analytics.hitRateBps === undefined ? "—" : `${(Number(analytics.hitRateBps) / 100).toFixed(1)}%`, "Closed hit rate"],
    [money(spend.committedCents || 0), "User-reported spend"],
    [Number(spend.overCapCount || 0), "Over-cap purchases"],
    [money(spend.overCapAmountCents || 0), "Above reviewed maximum"],
    [dailyHeadroom, "Daily cap headroom"],
    [monthlyHeadroom, "Monthly cap headroom"],
    [spend.savingsVsMsrpCents === null || spend.savingsVsMsrpCents === undefined
      ? "—" : money(spend.savingsVsMsrpCents),
    spend.savingsCoverage === "partial" ? "MSRP savings · partial" : "MSRP savings"]
  ];
  $("#analyticsMetrics").innerHTML = metrics.map(([value, label]) => `<article class="metric"><strong>${typeof value === "number" ? value.toLocaleString() : escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`).join("");
  $("#retailerAnalytics").innerHTML = (analytics.retailers || []).map((item) => `<div class="mini-row"><span><strong>${escapeHtml(retailerDisplayName(item.retailerId))}</strong><small>${Number(item.carted || 0)} carted · ${Number(item.gotIt || 0)} got it · ${Number(item.missed || 0)} missed</small></span><strong>${escapeHtml(money(item.committedCents || 0))}</strong></div>`).join("") || '<div class="mini-row"><span>No closed outcomes yet.</span></div>';
  $("#readinessList").innerHTML = (platform.readiness || []).map((lane) => {
    const ready = lane.readyForGuardedAdd === true;
    const warning = lane.qualification?.warning || "none";
    const qualificationNeedsAttention = warning !== "none";
    const readinessLabel = qualificationNeedsAttention ? labelFor(STORE_CHECK_WARNING_LABELS, warning) : ready ? "Ready" : "Needs setup";
    return `<div class="mini-row"><span><strong>${escapeHtml(retailerDisplayName(lane.retailerId))}</strong><small>${(lane.checklist || []).map((check) => `<span aria-hidden="true">${check.ready ? "✓" : "○"}</span> ${escapeHtml(check.label)}`).join(" · ")}</small></span><span class="tag ${ready && !qualificationNeedsAttention ? "good" : "warn"}">${escapeHtml(readinessLabel)}</span></div>`;
  }).join("") || '<div class="mini-row"><span>No supported stores are configured.</span></div>';
  renderConnectors();
}

function renderConnectors() {
  const connectors = state.actionPlatform?.connectors || [];
  const deliveries = state.actionPlatform?.connectorDeliveries || [];
  $("#connectorList").innerHTML = connectors.map((connector) => {
    const latest = deliveries.find((delivery) => delivery.connectorId === connector.id);
    return `<div class="mini-row"><span><strong>${escapeHtml(connector.name)}</strong><small>${escapeHtml(words(connector.kind))} · ${connector.events.map(words).join(", ")}${latest ? ` · latest ${words(latest.state)}` : ""}</small></span><div class="inline-actions"><span class="tag ${connector.enabled && connector.runtimeBound ? "good" : "warn"}">${connector.runtimeBound ? connector.enabled ? "Ready" : "Paused" : "Needs setup"}</span><button class="button quiet" data-connector-test="${escapeHtml(connector.id)}" type="button" ${connector.runtimeBound ? "" : "disabled"}>Test</button><button class="button quiet" data-connector-toggle="${escapeHtml(connector.id)}" type="button">${connector.enabled ? "Pause" : "Enable"}</button></div></div>`;
  }).join("") || '<div class="mini-row"><span>No notification sources yet.</span></div>';
}

function activeUserRoute() {
  return $("[data-panel].active")?.dataset.panel || "home";
}

function applyProductPage(products, append = false) {
  const incoming = products.items || [];
  state.productGroups = append ? [...state.productGroups, ...incoming] : incoming;
  state.productTotal = Number(products.total ?? state.productGroups.length);
  if (Array.isArray(products.facets?.stores)) {
    state.productStores = products.facets.stores;
  } else if (!append) {
    const stores = new Map();
    for (const group of state.productGroups) {
      for (const listing of group.listings || []) {
        const current = stores.get(listing.retailerId) || { retailerId: listing.retailerId, retailerName: listing.retailerName, variants: new Set() };
        current.variants.add(group.variantId);
        stores.set(listing.retailerId, current);
      }
    }
    state.productStores = [...stores.values()]
      .map((store) => ({ retailerId: store.retailerId, retailerName: store.retailerName, productCount: store.variants.size }))
      .sort((first, second) => first.retailerName.localeCompare(second.retailerName));
  }
  state.products = state.productGroups.flatMap((group) => (group.listings || []).map((listing) => ({
    variantId: group.variantId,
    title: group.title,
    variantAttributes: group.variantAttributes,
    ...listing
  })));
}

function loadedProductLimit() {
  const loaded = Number(state.productGroups.length) || state.productPageSize;
  return Math.max(state.productPageSize, Math.min(200, loaded));
}

function productLibraryPath(offset = 0, { filtered = true, limit = state.productPageSize } = {}) {
  const parameters = new URLSearchParams();
  parameters.set("limit", String(limit));
  parameters.set("offset", String(offset));
  if (filtered) {
    if (state.query) parameters.set("q", state.query);
    if (state.browse.store) parameters.set("store", state.browse.store);
    if (state.browse.availability) parameters.set("availability", state.browse.availability);
    if (state.browse.plan) parameters.set("plan", state.browse.plan);
    if (state.browse.price) {
      const [minimum, maximum] = state.browse.price.split("-");
      if (minimum !== "") parameters.set("priceMin", minimum);
      if (maximum !== "") parameters.set("priceMax", maximum);
    }
    parameters.set("sort", state.browse.sort || "newest");
  }
  return `/api/v1/user/library/products?${parameters.toString()}`;
}

function renderUserRoute(route) {
  if (route === "home") renderHomeSections();
  if (route === "products") renderProducts();
  if (route === "calls") renderCalls();
  if (route === "plans") renderPlans();
  if (route === "activity") renderActions();
  if (route === "insights") renderActionPlatform();
  if (route === "preferences") {
    renderActionPlatform(); renderPrivacy(); renderProfiles();
    setSettingsView(state.settingsView);
  }
}

async function loadUserRoute(route, { force = false, preservePagination = false } = {}) {
  if (!force && state.loadedRoutes.has(route)) {
    renderUserRoute(route);
    return;
  }
  const routeRequest = (path, fallback) => {
    const request = api(path);
    return preservePagination ? request : request.catch(() => fallback);
  };
  if (route === "home") {
    const [dropWindowResponse, recentActions, actionPlatform] = await Promise.all([
      routeRequest("/api/v1/user/drop-windows", { items: [] }),
      routeRequest("/api/v1/user/jobs?limit=5&offset=0&q=user_reported_", { items: [] }),
      routeRequest("/api/v1/user/action-platform", {})
    ]);
    state.dropWindows = dropWindowResponse.items || [];
    state.homeRecentActions = (recentActions.items || [])
      .filter((action) => ["got_it", "missed_it"].includes(String(action.userReportOutcome)))
      .sort((first, second) => new Date(second.userReportedAt || second.createdAt || 0).getTime()
        - new Date(first.userReportedAt || first.createdAt || 0).getTime())
      .slice(0, 5);
    state.actionPlatform = actionPlatform || null;
    scheduleDropClock();
  } else if (route === "products") {
    const requestSequence = state.productRequestSequence + 1;
    state.productRequestSequence = requestSequence;
    const [products, plans, legacyTransition, profiles, proposals] = await Promise.all([
      api(productLibraryPath(0, {
        limit: preservePagination ? loadedProductLimit() : state.productPageSize
      })),
      api("/api/v1/user/purchase-intents?limit=200&offset=0"),
      api("/api/v1/user/purchase-intents/legacy-transition"),
      routeRequest("/api/v1/user/purchase-profiles", { items: [] }),
      routeRequest("/api/v1/user/catalog/proposals?limit=100&offset=0", { items: [] })
    ]);
    if (requestSequence !== state.productRequestSequence) return false;
    applyProductPage(products);
    state.plans = plans.items || [];
    state.legacyTransition = legacyTransition.preview || null;
    state.profiles = profiles.items || [];
    state.proposals = proposals.items || [];
  } else if (route === "calls") {
    const [calls, dropWindows, actionPlatform, profiles, plans, products] = await Promise.all([
      routeRequest("/api/v1/user/calls", { items: [] }),
      routeRequest("/api/v1/user/drop-windows", { items: [] }),
      routeRequest("/api/v1/user/action-platform", {}),
      routeRequest("/api/v1/user/purchase-profiles", { items: [] }),
      api("/api/v1/user/purchase-intents?limit=200&offset=0"),
      api(productLibraryPath(0, { filtered: false, limit: 200 }))
    ]);
    state.calls = calls.items || [];
    state.dropWindows = dropWindows.items || [];
    state.actionPlatform = actionPlatform || null;
    state.profiles = profiles.items || [];
    state.plans = plans.items || [];
    state.products = (products.items || []).flatMap((group) => (group.listings || []).map((listing) => ({
      variantId: group.variantId,
      title: group.title,
      variantAttributes: group.variantAttributes,
      ...listing
    })));
    scheduleDropClock();
  } else if (route === "plans") {
    const [plans, legacyTransition, profiles] = await Promise.all([
      api("/api/v1/user/purchase-intents?limit=200&offset=0"),
      api("/api/v1/user/purchase-intents/legacy-transition"),
      routeRequest("/api/v1/user/purchase-profiles", { items: [] })
    ]);
    state.plans = plans.items || [];
    state.legacyTransition = legacyTransition.preview || null;
    state.profiles = profiles.items || [];
  } else if (route === "activity") {
    await refreshActionActivity();
  } else if (route === "insights") {
    const actionPlatform = await routeRequest("/api/v1/user/action-platform", {});
    state.actionPlatform = actionPlatform || null;
  } else if (route === "preferences") {
    const [privacy, profiles, actionPlatform] = await Promise.all([
      api("/api/v1/user/privacy"),
      routeRequest("/api/v1/user/purchase-profiles", { items: [] }),
      routeRequest("/api/v1/user/action-platform", {})
    ]);
    state.privacy = privacy.inventory || null;
    state.privacyCompliance = privacy.compliance || state.privacyCompliance;
    state.profiles = profiles.items || [];
    state.actionPlatform = actionPlatform || null;
  }
  state.loadedRoutes.add(route);
  renderUserRoute(route);
  return true;
}

async function loadMoreProducts() {
  const requestSequence = state.productRequestSequence;
  const products = await api(productLibraryPath(state.productGroups.length));
  if (requestSequence !== state.productRequestSequence) return false;
  applyProductPage(products, true);
  renderProducts();
  return true;
}

async function refresh({ priorityRoute = "", priorityRouteLoad = null, preservePagination = false } = {}) {
  const route = activeUserRoute();
  const handoffRequestSequence = nextActionHandoffRequestSequence();
  showUserRouteSkeleton(route);
  const [overview, affiliateRouting] = await Promise.all([
    api("/api/v1/user/overview"),
    state.affiliateRouting
      ? Promise.resolve({ affiliateRouting: state.affiliateRouting })
      : api("/api/v1/affiliate-routing").catch(() => null)
  ]);
  const hasCurrentHandoff = Boolean(state.overview) || state.actionHandoffPreload !== undefined;
  const previousHandoff = state.overview?.actionHandoff ?? state.actionHandoffPreload;
  const applyHandoff = applyActionHandoffCursor(
    overview.actionHandoffAvailabilityEpoch,
    overview.actionHandoffAvailabilityVersion,
    handoffRequestSequence
  );
  state.overview = !applyHandoff && hasCurrentHandoff
    ? { ...overview, actionHandoff: previousHandoff || null }
    : overview;
  state.actionHandoffPreload = undefined;
  state.affiliateRouting = affiliateRouting?.affiliateRouting || overview.affiliateRouting || state.affiliateRouting;
  renderOverview();
  renderWalmartDraws();
  if (priorityRoute === route && priorityRouteLoad) {
    if (await priorityRouteLoad) {
      state.loadedRoutes.add(route);
      renderUserRoute(route);
    } else {
      await loadUserRoute(route, { force: true, preservePagination });
    }
  } else {
    await loadUserRoute(route, { force: true, preservePagination });
  }
  setUserDataStale(false);
}

function applyActionActivity(actions) {
  state.actions = actions?.items || [];
  state.actionInsights = actions?.insights || null;
  state.actionGlossary = actions?.glossary || {};
}

async function refreshActionActivity() {
  const requestSequence = state.actionActivityRequestSequence + 1;
  state.actionActivityRequestSequence = requestSequence;
  const actions = await api("/api/v1/user/jobs?limit=100&offset=0");
  if (requestSequence < state.actionActivityAppliedSequence) return false;
  state.actionActivityAppliedSequence = requestSequence;
  applyActionActivity(actions);
  renderActions();
  return true;
}

async function refreshCompactActionHandoff(waitMs = 0) {
  const requestSequence = nextActionHandoffRequestSequence();
  const boundedWaitMs = Math.max(0, Math.min(5_000, Math.floor(Number(waitMs) || 0)));
  const epoch = normalizedActionHandoffEpoch(state.actionHandoffAvailabilityEpoch) || "";
  const version = normalizedActionHandoffVersion(state.actionHandoffAvailabilityVersion) ?? 0;
  const epochQuery = epoch ? `&epoch=${encodeURIComponent(epoch)}` : "";
  const payload = await api(`/api/v1/user/action-handoff?wait=${boundedWaitMs}&version=${version}${epochQuery}`);
  setUserDataStale(false);
  if (!applyActionHandoffCursor(payload.availabilityEpoch, payload.availabilityVersion, requestSequence)) return;
  const actionHandoff = payload.actionHandoff || null;
  if (!state.overview) {
    state.actionHandoffPreload = actionHandoff;
    renderHomeActionHandoff(actionHandoff, { updateHeadline: true });
    return;
  }
  state.overview = { ...state.overview, actionHandoff };
  renderHomePriority();
}

async function refreshVisibleActionState(waitMs = 0) {
  const route = activeUserRoute();
  if (route === "activity") return refreshActionActivity();
  const handoff = refreshCompactActionHandoff(waitMs);
  if (["products", "calls", "plans"].includes(route)) {
    return Promise.all([handoff, loadUserRoute(route, { force: true, preservePagination: true })]);
  }
  return handoff;
}

function actionToggleErrorCopy(error, pausing) {
  const code = String(error?.code || "");
  const status = Number(error?.status || 0);
  if (code === "authentication_required" || status === 401 || status === 403) {
    return "Sign in again to change actions.";
  }
  if (code === "request_rejected" && !pausing) return "Turn on cart adds for at least one store first.";
  return pausing ? "Actions could not be paused. Try again." : "Actions could not be turned on. Try again.";
}

async function toggleActions() {
  const paused = state.overview.settings.actionsPaused !== true;
  if (paused && !(await requestConfirmation({
    title: "Pause purchase actions?",
    summary: "Monitoring and notifications will continue, but Yoink will not add items to store carts.",
    confirmLabel: "Pause actions"
  })).confirmed) return;
  let result;
  try {
    result = await api("/api/v1/user/settings/actions", {
      method: "PATCH",
      body: JSON.stringify({ paused, reason: paused ? "Paused from the user dashboard." : "Resumed from the user dashboard." })
    });
  } catch (error) {
    // Store-check failures come back as engineering copy; keep the dashboard in plain words.
    const plain = new Error(actionToggleErrorCopy(error, paused));
    plain.code = error?.code;
    plain.reference = error?.reference;
    throw plain;
  }
  await refresh();
  if (result.disposition === "pending_approval") {
    toast("Resume request sent for independent approval. Purchase actions remain paused.");
    return;
  }
  toast(paused ? "All purchase actions are paused." : "Cart actions are enabled within your saved limits and current store checks.");
}

function setupAmount(name, label, required = false) {
  try {
    const value = centsInput($("#setupForm").elements[name].value, label);
    if (required && value === null) throw new Error(`${label} is required.`);
    return value;
  } catch {
    return null;
  }
}

function quantityProgressCopy(value) {
  const quantity = Number(value);
  return `Yoink adds one at a time until you have ${Number.isInteger(quantity) && quantity > 0 ? quantity : "N"}.`;
}

function shopperFulfillment(value) {
  return value === "pickup" ? "pickup" : "shipping";
}

function setupAutomaticMinimum() {
  const form = $("#setupForm");
  const product = state.setupProduct;
  const quantity = Number(form.elements.targetQuantity.value || 0);
  const unit = setupAmount("maxUnitPrice", "Maximum item price");
  if (!product || unit === null || !Number.isInteger(quantity) || quantity < 1) return null;
  const taxBps = Math.max(0, Number(state.overview?.settings?.taxBps || 0));
  const storeReserve = Math.max(0, Number(state.overview?.settings?.storeAllowancesCents?.[product.retailerId] || 0));
  const required = Math.ceil(unit * quantity * (10_000 + taxBps) / 10_000) + storeReserve;
  return Number.isSafeInteger(required) ? { required, taxBps, storeReserve } : null;
}

function setupDraftPayload(confirmation) {
  const form = $("#setupForm");
  if (!state.setupProduct) throw new Error("Choose the store product again before continuing.");
  const targetQuantity = Number(form.elements.targetQuantity.value);
  if (!Number.isInteger(targetQuantity) || targetQuantity < 1 || targetQuantity > 99) {
    throw new Error("Quantity must be 1 through 99.");
  }
  const maxUnitPriceCents = centsInput(form.elements.maxUnitPrice.value, "The maximum item price");
  const maxAllInCents = centsInput(form.elements.maxAllIn.value, "The maximum total");
  if (maxUnitPriceCents === null || maxAllInCents === null) {
    throw new Error("Enter both a maximum item price and maximum total.");
  }
  if (maxAllInCents < maxUnitPriceCents * targetQuantity) {
    throw new Error("The maximum total must cover the maximum item price for every requested item.");
  }
  const cooldownMinutes = Number(form.elements.cooldownMinutes.value || 0);
  if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 0 || cooldownMinutes > 43_200) {
    throw new Error("The wait between attempts must be from zero through 43,200 minutes.");
  }
  const actionCeiling = form.elements.actionCeiling.value;
  if (actionCeiling === "add_to_cart" && state.setupProduct.executionSupported !== true) {
    throw new Error("This store is monitor-only and cannot be authorized for cart actions.");
  }
  const expiresValue = form.elements.expiresAt.value;
  const expiry = expiresValue ? new Date(expiresValue) : null;
  if (expiry && !Number.isFinite(expiry.getTime())) throw new Error("Choose a valid end time or leave it blank.");
  return {
    contractVersion: 2,
    listingId: form.elements.listingId.value,
    targetQuantity,
    maxUnitPriceCents,
    maxAllInCents,
    actionCeiling,
    sellerPolicy: "first_party_only",
    fulfillment: shopperFulfillment(form.elements.fulfillment.value),
    substitutionPolicy: "exact_only",
    expiresAt: expiry ? expiry.toISOString() : "",
    cooldownSeconds: cooldownMinutes * 60,
    confirmation
  };
}

function renderSetupPreflight(mode, headline, copy, preflight = null) {
  const element = $("#setupPreflight");
  element.className = `setup-preflight ${mode}`;
  const cost = preflight?.cost;
  const currency = cost?.currency || state.setupProduct?.currency || "USD";
  const costs = cost ? `<div class="preflight-costs">
    <div><small>Maximum items</small><b>${escapeHtml(money(cost.itemSubtotalCapCents, currency))}</b></div>
    <div><small>Required total</small><b>${escapeHtml(money(cost.minimumAllInCents, currency))}</b></div>
    <div><small>Tax and store hold</small><b>${escapeHtml(money(Number(cost.taxReserveCents || 0) + Number(cost.storeReserveCents || 0), currency))}</b></div>
    <div><small>Room within your limit</small><b>${escapeHtml(money(cost.headroomCents, currency))}</b></div>
  </div>` : "";
  const autoRaisedNote = cost?.autoRaised
    ? `<p class="boundary-note good">Your maximum total was automatically raised to ${escapeHtml(money(cost.reviewedAllInCents, currency))} to cover taxes and store fees — the item price above stays your real cap.</p>`
    : "";
  element.innerHTML = `<div><span>${mode === "ready" ? "Checked" : mode === "error" ? "Needs attention" : "Price check"}</span><strong>${escapeHtml(headline)}</strong></div>
    <p>${escapeHtml(copy)}</p>${costs}${autoRaisedNote}`;
}

function updateSetupCreateState() {
  const form = $("#setupForm");
  const reviewed = form.elements.reviewed;
  $("#createPlanButton").disabled = !state.setupPreflight || reviewed.checked !== true;
}

function setupPreflightInputSignature() {
  const form = $("#setupForm");
  return JSON.stringify({
    listingId: form.elements.listingId.value,
    targetQuantity: form.elements.targetQuantity.value.trim(),
    maxUnitPrice: form.elements.maxUnitPrice.value.trim(),
    maxAllIn: form.elements.maxAllIn.value.trim(),
    actionCeiling: form.elements.actionCeiling.value,
    fulfillment: shopperFulfillment(form.elements.fulfillment.value),
    expiresAt: form.elements.expiresAt.value,
    cooldownMinutes: form.elements.cooldownMinutes.value.trim()
  });
}

function invalidateSetupPreflight(signature = setupPreflightInputSignature()) {
  clearTimeout(state.setupPreflightTimer);
  state.setupPreflightTimer = null;
  state.setupPreflightScheduledSignature = "";
  if (state.setupPreflight && signature === state.setupPreflightSignature) {
    const reviewed = $("#setupForm").elements.reviewed;
    reviewed.disabled = false;
    updateSetupCreateState();
    return { changed: false, revision: state.setupPreflightRevision, signature };
  }
  state.setupPreflight = null;
  state.setupPreflightRevision += 1;
  const reviewed = $("#setupForm").elements.reviewed;
  reviewed.checked = false;
  reviewed.disabled = true;
  renderSetupPreflight("checking", "Checking your choices", "Yoink will validate this plan without saving it.");
  updateSetupCreateState();
  return { changed: true, revision: state.setupPreflightRevision, signature };
}

function scheduleSetupPreflight(delay = 600) {
  const signature = setupPreflightInputSignature();
  if ((state.setupPreflight && signature === state.setupPreflightSignature)
    || signature === state.setupPreflightPendingSignature
    || (state.setupPreflightTimer !== null && signature === state.setupPreflightScheduledSignature)) {
    if (state.setupPreflight && signature === state.setupPreflightSignature) {
      $("#setupForm").elements.reviewed.disabled = false;
      updateSetupCreateState();
    }
    return;
  }
  const invalidation = invalidateSetupPreflight(signature);
  if (!invalidation.changed) return;
  state.setupPreflightScheduledSignature = signature;
  state.setupPreflightTimer = setTimeout(() => {
    state.setupPreflightTimer = null;
    state.setupPreflightScheduledSignature = "";
    void requestSetupPreflight(invalidation.revision, signature);
  }, delay);
}

async function requestSetupPreflight(revision, signature) {
  if (revision !== state.setupPreflightRevision || signature !== setupPreflightInputSignature()
    || !state.setupProduct || !$("#setupDialog").hasAttribute("open")) return;
  let draft;
  try {
    draft = setupDraftPayload("PREFLIGHT_EXACT_PURCHASE_PLAN");
  } catch (error) {
    if (revision === state.setupPreflightRevision) {
      renderSetupPreflight("error", "Complete the plan details", error.message || "Review the highlighted values.");
    }
    return;
  }
  state.setupPreflightPendingSignature = signature;
  renderSetupPreflight("checking", "Checking price and action limits", "Yoink is checking this draft. No plan has been saved.");
  try {
    const result = await api("/api/v1/user/purchase-intents/preflight", {
      method: "POST",
      body: JSON.stringify(draft)
    });
    if (revision !== state.setupPreflightRevision || signature !== setupPreflightInputSignature()) return;
    const preflight = result.preflight;
    if (!preflight || preflight.noPurchasePlanSaved !== true
      || !/^[a-f0-9]{64}$/.test(String(preflight.preflightFingerprint || ""))
      || !preflight.preflightedAt) {
      throw new Error("The price check did not finish. Try again.");
    }
    state.setupPreflight = preflight;
    state.setupPreflightSignature = signature;
    const readiness = preflight.automationReadiness || {};
    renderSetupPreflight(
      "ready",
      "Ready for your review",
      `After saving: ${readiness.headline || "the plan will use these limits"}. ${readiness.summary || "Fresh offer checks still apply."} No plan was saved by this check.`,
      preflight
    );
    $("#setupForm").elements.reviewed.disabled = false;
    updateSetupCreateState();
  } catch (error) {
    if (revision !== state.setupPreflightRevision || signature !== setupPreflightInputSignature()) return;
    renderSetupPreflight("error", "Fix this before saving", error.message || "This plan could not be checked.");
    updateSetupCreateState();
  } finally {
    if (state.setupPreflightPendingSignature === signature) state.setupPreflightPendingSignature = "";
  }
}

function syncSetupAction() {
  const form = $("#setupForm");
  const adding = form.elements.actionCeiling.value === "add_to_cart";
  if (form.elements.fulfillment.value !== "pickup") form.elements.fulfillment.value = "shipping";
  form.elements.fulfillment.disabled = false;
  $("#setupQuantityHelp").textContent = quantityProgressCopy(form.elements.targetQuantity.value);
  const note = $("#setupExecutionNote");
  const minimum = setupAutomaticMinimum();
  const reviewedTotal = setupAmount("maxAllIn", "Maximum total");
  const totalTooLow = adding && minimum && (reviewedTotal === null || reviewedTotal < minimum.required);
  const laneReady = guardedLaneReady(state.setupProduct?.retailerId);
  form.elements.maxAllIn.setAttribute("aria-invalid", totalTooLow ? "true" : "false");
  note.className = `setup-boundary-line ${state.setupProduct?.executionSupported && (!adding || laneReady) && !totalTooLow ? "good" : "warn"}`;
  note.textContent = state.setupProduct?.executionSupported !== true
    ? "Notification mode only for this store."
    : adding && !laneReady
      ? "Cart mode stays closed until this store's checks are ready."
      : adding && totalTooLow
        ? `Maximum total must cover ${money(minimum.required)} including reserves.`
        : adding
          ? "Cart mode adds one exact item after a fresh Chrome check; you finish checkout."
          : "Notification mode does not click store controls.";
}

function renderSetupReview() {
  const form = $("#setupForm");
  const product = state.setupProduct;
  if (!product) return;
  const quantity = Math.max(1, Number(form.elements.targetQuantity.value || 1));
  const unit = setupAmount("maxUnitPrice", "Maximum item price");
  const allIn = setupAmount("maxAllIn", "Maximum total");
  const action = form.elements.actionCeiling.value === "add_to_cart" ? "Add to cart" : "Notify only";
  const expiry = form.elements.expiresAt.value
    ? new Date(form.elements.expiresAt.value).toLocaleString()
    : "No end date";
  const rows = [
    ["Store", product.retailerName],
    ["Quantity", String(quantity)],
    ["Each", unit === null ? "Enter an amount" : money(unit, product.currency)],
    ["Total", allIn === null ? "Enter an amount" : money(allIn, product.currency)],
    ["Delivery", labelFor(FULFILLMENT_LABELS, form.elements.fulfillment.value)],
    ["Action", action],
    ["Stops", expiry]
  ];
  $("#setupReviewRows").innerHTML = rows.map(([label, value]) => `<div class="review-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

function openSetup(listingId) {
  const product = state.products.find((item) => item.listingId === listingId);
  if (!product) throw new Error("That product is no longer in this catalog view. Refresh and try again.");
  const existing = state.plans.find((plan) => plan.variantId === product.variantId);
  if (existing) return openPlan(existing.id);
  state.setupProduct = product;
  state.setupPreflight = null;
  state.setupPreflightSignature = "";
  state.setupPreflightScheduledSignature = "";
  state.setupPreflightPendingSignature = "";
  const form = $("#setupForm");
  form.reset();
  form.elements.reviewed.disabled = true;
  form.elements.listingId.value = product.listingId;
  const hasCurrentPrice = product.currentPriceCents !== null
    && product.currentPriceCents !== undefined
    && Number.isFinite(Number(product.currentPriceCents));
  const knownPrice = hasCurrentPrice ? Number(product.currentPriceCents) : Number(product.msrpCents);
  if (Number.isSafeInteger(knownPrice) && knownPrice > 0) {
    form.elements.maxUnitPrice.value = moneyInput(knownPrice);
    form.elements.maxAllIn.value = moneyInput(knownPrice);
  }
  const addRadio = form.querySelector('input[value="add_to_cart"]');
  addRadio.disabled = product.executionSupported !== true;
  if (addRadio.disabled) form.elements.actionCeiling.value = "notify";
  const exactVariant = variantSummary(product.variantAttributes);
  const group = state.productGroups.find((candidate) => candidate.variantId === product.variantId);
  const storeOffers = group?.listings?.length ? group.listings : [product];
  $("#setupProductSummary").innerHTML = `<div><span class="store">${escapeHtml(product.retailerName)}</span><h3>${escapeHtml(product.title)}</h3><p>SKU ${escapeHtml(product.retailerSku)}${exactVariant ? ` · ${escapeHtml(exactVariant)}` : ""}</p></div><strong class="exact-price">${escapeHtml(hasCurrentPrice ? money(knownPrice, product.currency) : money(product.msrpCents, product.currency))}</strong>`;
  $("#setupStore").textContent = product.retailerName;
  $("#setupStoreChoices").innerHTML = storeOffers.map((offer) => `<span class="tag ${offer.listingId === product.listingId ? "good" : ""}">${escapeHtml(offer.retailerName)}${offer.listingId === product.listingId ? " · Selected" : ""}</span>`).join("");
  $("#changeSetupStore").hidden = storeOffers.length < 2;
  $("#changeSetupStore").dataset.variantId = product.variantId;
  syncSetupAction();
  renderSetupReview();
  $("#setupDialog").showModal();
  scheduleSetupPreflight(0);
  requestAnimationFrame(() => form.elements.targetQuantity.focus());
}

async function openPlan(id) {
  const { purchaseIntent: mission } = await api(`/api/v1/user/purchase-intents/${encodeURIComponent(id)}`);
  state.editingPlan = mission;
  const form = $("#planForm");
  form.elements.id.value = mission.id;
  form.elements.status.querySelector('option[data-legacy-archived="true"]')?.remove();
  form.elements.status.querySelector('option[data-readonly-status="true"]')?.remove();
  form.elements.status.disabled = false;
  if (mission.status === "archived") {
    const legacyArchived = new Option("Archived (legacy)", "archived", true, true);
    legacyArchived.disabled = true;
    legacyArchived.dataset.legacyArchived = "true";
    form.elements.status.add(legacyArchived);
    form.elements.status.disabled = true;
  } else if (mission.status === "satisfied") {
    const satisfied = new Option("Satisfied", "satisfied", true, true);
    satisfied.disabled = true;
    satisfied.dataset.readonlyStatus = "true";
    form.elements.status.add(satisfied);
    form.elements.status.disabled = true;
  }
  form.elements.status.value = mission.status;
  form.elements.targetQuantity.value = mission.targetQuantity;
  const policy = mission.intentPolicy || {};
  form.elements.maxAllIn.value = moneyInput(policy.maxAllInCents);
  const directPlan = policy.decisionMode === "purchase_intent";
  form.elements.actionCeiling.value = directPlan && ["notify", "add_to_cart"].includes(policy.actionCeiling)
    ? policy.actionCeiling
    : "notify";
  form.elements.cooldownMinutes.value = Math.round(Number(policy.cooldownSeconds || 0) / 60);
  form.elements.expiresAt.value = localDateTime(policy.expiresAt);
  $("#planModeTitle").textContent = directPlan
    ? "This reviewed plan decides directly; rules are optional."
    : "This plan currently uses the default rules.";
  $("#planModeCopy").textContent = directPlan
    ? "These limits can authorize cart actions after current store checks."
    : "Saving makes this a direct notify-only plan unless you choose cart actions.";
  $("#planDialogTitle").textContent = mission.title;
  $("#targetEditors").innerHTML = mission.targets.map((target) => {
    const legacyFulfillmentMapped = target.legacyFulfillmentMapped === true || target.fulfillment === "manual";
    const fulfillment = shopperFulfillment(target.fulfillment);
    return `<article class="target-editor" data-target-id="${escapeHtml(target.id)}" data-retailer-id="${escapeHtml(target.retailerId)}" data-execution-supported="${target.executionSupported === true}" data-last-observed-price-cents="${Number.isSafeInteger(Number(target.lastObservedPriceCents)) ? Number(target.lastObservedPriceCents) : ""}">
      <div class="card-top"><div><strong>${escapeHtml(target.retailerName)}</strong><span class="tag ${target.executionSupported === true ? "good" : ""} target-capability">${target.executionSupported === true ? "Cart mapping available" : "Monitoring only"}</span><p>${escapeHtml(target.retailerSku)} · ${escapeHtml(money(target.lastObservedPriceCents, target.currency))}</p></div>${retailerLinkMarkup(target.canonicalUrl, mission.title, "View ↗")}</div>
      <div class="target-fields">
        <label class="check"><input data-field="enabled" type="checkbox" ${target.enabled ? "checked" : ""}><span>Use store</span></label>
        <label><span>Maximum price</span><input data-field="maxPrice" inputmode="decimal" placeholder="Rule limit" value="${target.maxUnitPriceCents ? (target.maxUnitPriceCents / 100).toFixed(2) : ""}"></label>
        <div class="field-note target-fixed-seller"><strong>Seller</strong><span>Store only</span></div>
        <label><span>Delivery</span><select data-field="fulfillment" aria-describedby="planFulfillmentHelp"><option value="shipping" ${fulfillment === "shipping" ? "selected" : ""}>Shipping</option><option value="pickup" ${fulfillment === "pickup" ? "selected" : ""}>Pickup</option></select></label>
        ${legacyFulfillmentMapped ? '<p class="boundary-note legacy-fulfillment-note">This legacy Manual setting is shown as Shipping. Save the plan to confirm the change.</p>' : ""}
      </div>
    </article>`;
  }).join("");
  const supportedTargets = mission.targets.filter((target) => target.executionSupported === true);
  form.elements.actionCeiling.querySelector('option[value="add_to_cart"]').disabled = supportedTargets.length < 1;
  $("#prepareGuardedPlanButton").hidden = supportedTargets.length < 1;
  syncPlanAction();
  $("#planDialog").showModal();
}

function planTargetDrafts(form, strict = false) {
  return $$("[data-target-id]", form).map((card) => {
    const rawPrice = $("[data-field=maxPrice]", card).value.trim();
    const dollars = rawPrice ? Number(rawPrice) : null;
    if (strict && dollars !== null && (!Number.isFinite(dollars) || dollars <= 0)) {
      throw new Error("Every enabled store needs a positive maximum item price for cart actions.");
    }
    return {
      id: card.dataset.targetId,
      retailerId: card.dataset.retailerId,
      executionSupported: card.dataset.executionSupported === "true",
      enabled: $("[data-field=enabled]", card).checked,
      maxUnitPriceCents: dollars !== null && Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null,
      sellerPolicy: "first_party_only",
      fulfillment: shopperFulfillment($("[data-field=fulfillment]", card).value)
    };
  });
}

function planAutomaticMinimum(form, targets = planTargetDrafts(form)) {
  const quantity = Number(form.elements.targetQuantity.value);
  const enabled = targets.filter((target) => target.enabled);
  if (!Number.isInteger(quantity) || quantity < 1 || !enabled.length
    || enabled.some((target) => target.maxUnitPriceCents === null)) return null;
  const taxBps = Math.max(0, Number(state.overview?.settings?.taxBps || 0));
  const required = Math.max(...enabled.map((target) => {
    const storeReserve = Math.max(0, Number(state.overview?.settings?.storeAllowancesCents?.[target.retailerId] || 0));
    return Math.ceil(target.maxUnitPriceCents * quantity * (10_000 + taxBps) / 10_000) + storeReserve;
  }));
  return Number.isSafeInteger(required) ? required : null;
}

function syncPlanAction(normalizeTargets = false) {
  const form = $("#planForm");
  const adding = form.elements.actionCeiling.value === "add_to_cart";
  $("#planQuantityHelp").textContent = quantityProgressCopy(form.elements.targetQuantity.value);
  $$("[data-target-id]", form).forEach((card) => {
    const supported = card.dataset.executionSupported === "true";
    const enabledControl = $("[data-field=enabled]", card);
    enabledControl.disabled = adding && !supported;
    if (adding && normalizeTargets) {
      if (!supported) {
        enabledControl.checked = false;
      } else if (enabledControl.checked) {
        if ($("[data-field=fulfillment]", card).value !== "pickup") {
          $("[data-field=fulfillment]", card).value = "shipping";
        }
      }
    }
  });
  const targets = planTargetDrafts(form);
  const enabled = targets.filter((target) => target.enabled);
  const unsafe = enabled.find((target) => !target.executionSupported
    || target.maxUnitPriceCents === null
    || target.sellerPolicy !== "first_party_only"
    || !["shipping", "pickup"].includes(target.fulfillment));
  const minimum = planAutomaticMinimum(form, targets);
  const reviewedTotal = (() => {
    try { return centsInput(form.elements.maxAllIn.value, "The all-in cap"); } catch { return null; }
  })();
  const totalTooLow = adding && minimum !== null && (reviewedTotal === null || reviewedTotal < minimum);
  form.elements.maxAllIn.setAttribute("aria-invalid", totalTooLow ? "true" : "false");
  const note = $("#planExecutionNote");
  note.className = `boundary-note ${!adding || (enabled.length && !unsafe && !totalTooLow) ? "good" : "warn"}`;
  note.textContent = !adding
    ? "Fresh matches create notifications. No store control is clicked."
    : !enabled.length
      ? "Enable one store before choosing a cart action."
      : unsafe
        ? "Every enabled cart store needs an add mapping, a maximum item price, Store only seller, and a selected delivery method."
        : minimum === null
          ? "Enter a valid quantity and maximum item price for every enabled store."
          : totalTooLow
            ? `Raise the maximum total to at least ${money(minimum)} only if you accept that bound, or choose notifications.`
            : `The reviewed total covers the current ${money(minimum)} tax and store-fee reserve. Each cart attempt adds one item, and Chrome rechecks the live offer.`;
}

function prepareGuardedPlanDraft() {
  const form = $("#planForm");
  const supportedCards = $$("[data-target-id]", form).filter((card) => card.dataset.executionSupported === "true");
  if (!supportedCards.length) {
    toast("This plan has no supported store for cart actions.", true);
    return;
  }
  if (!supportedCards.some((card) => $("[data-field=enabled]", card).checked)) {
    toast("Enable at least one store with cart support, then switch to cart mode again.", true);
    return;
  }
  form.elements.actionCeiling.value = "add_to_cart";
  let preparedCount = 0;
  let missingPriceCount = 0;
  let retainedPickupCount = 0;
  for (const card of $$("[data-target-id]", form)) {
    const enabled = $("[data-field=enabled]", card);
    if (card.dataset.executionSupported !== "true") {
      enabled.checked = false;
      continue;
    }
    if (!enabled.checked) continue;
    if ($("[data-field=fulfillment]", card).value === "pickup") {
      retainedPickupCount += 1;
    } else {
      $("[data-field=fulfillment]", card).value = "shipping";
    }
    const price = $("[data-field=maxPrice]", card);
    if (!price.value.trim()) {
      const observed = Number(card.dataset.lastObservedPriceCents);
      if (Number.isSafeInteger(observed) && observed > 0) {
        price.value = moneyInput(observed);
      } else {
        missingPriceCount += 1;
      }
    }
    preparedCount += 1;
  }
  syncPlanAction(true);
  const minimum = planAutomaticMinimum(form);
  if (minimum !== null) {
    let currentTotal = null;
    try { currentTotal = centsInput(form.elements.maxAllIn.value, "The all-in cap"); } catch { currentTotal = null; }
    if (currentTotal === null || currentTotal < minimum) form.elements.maxAllIn.value = moneyInput(minimum);
  }
  syncPlanAction();
  toast(missingPriceCount
    ? `Prepared ${preparedCount} supported store${preparedCount === 1 ? "" : "s"}. Enter ${missingPriceCount} missing price cap${missingPriceCount === 1 ? "" : "s"}, then review every field before saving.`
    : `Prepared ${preparedCount} supported store${preparedCount === 1 ? "" : "s"}; Shipping is the default${retainedPickupCount ? ` and ${retainedPickupCount} explicit Pickup choice${retainedPickupCount === 1 ? " was" : "s were"} retained` : ""}. Review every price and the maximum total before saving.`);
}

async function createPairingCode(showPreferences = false) {
  if (showPreferences) { setSettingsView("chrome"); setTab("preferences"); }
  const result = await api("/api/v1/user/devices/pairing-code", { method: "POST", body: "{}" });
  const pairing = $("#pairing");
  pairing.hidden = false;
  pairing.innerHTML = `<span>One-time code</span><strong>${escapeHtml(result.pairing.code)}</strong><small>Expires ${escapeHtml(relative(result.pairing.expiresAt))}</small>`;
  pairing.tabIndex = -1;
  pairing.focus();
  requestAnimationFrame(() => pairing.focus());
  toast("Enter this one-time code in the Yoink Chrome companion.");
}

function clearProductLinkPreview() {
  state.productLinkPreview = null;
  state.productLinkPreviewInput = "";
  $("#productLinkPreview").hidden = true;
  $("#productLinkPreview").innerHTML = "";
  $("#productLinkConfirm").hidden = true;
  $("#productLinkForm").elements.confirmed.checked = false;
  $("#submitProductLinkButton").disabled = true;
}

function openProductLinkDialog() {
  const form = $("#productLinkForm");
  form.reset();
  clearProductLinkPreview();
  $("#productLinkDialog").showModal();
  requestAnimationFrame(() => form.elements.url.focus());
}

function openSignalConnectDialog() {
  $("#signalConnectStatus").textContent = "Finish the three steps, then re-check.";
  $("#signalConnectDialog").showModal();
  requestAnimationFrame(() => $("#recheckSignalConnection").focus());
}

async function recheckSignalConnection() {
  const button = $("#recheckSignalConnection");
  button.disabled = true;
  button.textContent = "Checking…";
  $("#signalConnectStatus").textContent = "Checking the current source…";
  try {
    await refresh();
    const signalStep = (state.overview?.setup?.steps || []).find((step) => step.id === "signal");
    if (signalStep?.state === "complete") {
      $("#signalConnectDialog").close();
      toast("TrackaLacker is connected.");
      return;
    }
    $("#signalConnectStatus").textContent = "TrackaLacker is not connected yet. Finish the three steps, then re-check.";
  } finally {
    button.disabled = false;
    button.textContent = "Re-check";
  }
}

async function focusFirstQuickAdd() {
  setTab("products");
  await state.routeLoadPromise;
  const control = $("#productList [data-quick-add], #productList [data-quick-menu]");
  if (!control) {
    $("#addProductButton").focus();
    toast("Choose “Add product link” to add an approved product first.");
    return;
  }
  control.focus({ preventScroll: true });
  if (typeof control.scrollIntoView === "function") control.scrollIntoView({ block: "center" });
  const label = control.textContent.trim() || "Quick add";
  toast(`Choose “${label}” to create your first plan.`);
}

async function checkProductLink() {
  const form = $("#productLinkForm");
  const url = form.elements.url.value.trim();
  if (!url) throw new Error("Paste the store product page first.");
  const button = $("#checkProductLinkButton");
  button.disabled = true;
  button.textContent = "Checking item ID…";
  try {
    const { preview } = await api("/api/v1/user/catalog/link-preview", {
      method: "POST",
      body: JSON.stringify({ url })
    });
    state.productLinkPreview = preview;
    state.productLinkPreviewInput = url;
    $("#productLinkPreview").hidden = false;
    $("#productLinkPreview").innerHTML = `<div class="card-top"><span class="store">${escapeHtml(preview.retailerName)}</span><span class="tag good">Product found</span></div>
      <h3>${escapeHtml(preview.retailerSku)}</h3>
      <p>${escapeHtml(preview.capabilityLabel)}</p>
      <p><strong>Not accepted from this link:</strong> stock status, price, seller, fulfillment, or permission to purchase.</p>
      ${retailerLinkMarkup(preview.canonicalUrl, `${preview.retailerName} product preview`, `${preview.canonicalUrl} ↗`)}`;
    $("#productLinkConfirm").hidden = false;
    $("#productLinkConfirm").querySelector("input").focus();
  } finally {
    button.disabled = false;
    button.textContent = "Check link";
  }
}

document.addEventListener("click", async (event) => {
  const walmartPurchaseLink = event.target.closest?.("a[data-walmart-buy]");
  if (walmartPurchaseLink) recordWalmartPurchaseClick(walmartPurchaseLink);
  const storeLink = event.target.closest?.("a[data-store-link]");
  if (storeLink) recordStoreLinkClick(storeLink);
  const button = event.target.closest("button");
  const quickMenu = $("#quickAddMenu");
  if (!quickMenu.hidden && !quickMenu.contains(event.target) && !(button && button.dataset.quickMenu)) closeQuickMenu();
  if (!button) return;
  try {
    if (button.id === "userDataFreshness") {
      button.disabled = true;
      try { await resumeVisibleDashboard(); } finally { button.disabled = false; }
      return;
    }
    if (button.dataset.productView) {
      state.productView = button.dataset.productView === "list" ? "list" : "grid";
      try { localStorage.setItem(PRODUCT_VIEW_KEY, state.productView); } catch { /* Layout persistence remains best effort. */ }
      renderProducts();
    }
    if (button.dataset.callFilter) {
      state.callFilter = ["products", "drawings"].includes(button.dataset.callFilter) ? button.dataset.callFilter : "all";
      state.callDisplayLimit = 25;
      renderCalls();
      writeUserRoute("push", "calls");
      return;
    }
    if (button.dataset.tab) {
      setTab(button.dataset.tab, { historyMode: "push" });
    }
    if (button.dataset.settingsView) setSettingsView(button.dataset.settingsView, { historyMode: "push" });
    if (button.id === "loadMoreProducts") {
      button.disabled = true;
      try { await loadMoreProducts(); } finally { button.disabled = false; }
    }
    if (button.id === "showMoreCalls") {
      state.callDisplayLimit += 25;
      renderCalls();
    }
    if (button.id === "showMoreActions") {
      state.actionDisplayLimit += 25;
      renderActions();
    }
    if (button.dataset.actionStageFilter) {
      state.actionStageFilter = button.dataset.actionStageFilter;
      state.actionDisplayLimit = 25;
      renderActions();
      return;
    }
    if (button.id === "togglePlanBulk") {
      state.planBulkMode = !state.planBulkMode;
      state.planSelection.clear();
      state.planBulkDraft = null;
      renderPlans();
      return;
    }
    if (button.id === "applyPlanBulkProfile") {
      openPlanBulkApplyDialog();
      return;
    }
    if (button.id === "reviewLegacyPlanTransitionButton") {
      openLegacyPlanTransition();
      return;
    }
    if (button.dataset.cartGotIt) {
      openCartOutcomeDialog(button.dataset.cartGotIt, button);
      return;
    }
    if (button.dataset.cartMissedIt) {
      const action = state.actions.find((item) => item.id === button.dataset.cartMissedIt);
      if (!closeableCartAction(action)) {
        toast("Refresh before closing this cart action.", true);
        return;
      }
      const decision = await requestConfirmation({
        title: "Mark this cart as missed?",
        summary: "This closes the action without recording a purchase or spend.",
        scope: [`${action.title} · ${retailerDisplayName(action.retailerId)} · ${action.retailerSku}`],
        confirmLabel: "Mark missed"
      });
      if (!decision.confirmed) return;
      await reportCartOutcome(action, "missed_it", null);
      return;
    }
    if (button.dataset.togglePlanStatus) {
      await togglePlanStatus(button.dataset.togglePlanStatus, button);
      return;
    }
    if (button.hasAttribute("data-close-dialog")) button.closest("dialog")?.close();
    if (button.dataset.quickMenu) {
      if (!quickMenu.hidden && quickMenu.dataset.anchor === button.dataset.quickMenu) {
        closeQuickMenu();
      } else {
        openQuickMenu(button, button.dataset.quickMenu);
      }
    }
    if (button.dataset.quickAdd) {
      closeQuickMenu();
      if ($("#productDialog").hasAttribute("open")) $("#productDialog").close();
      await quickAdd(button.dataset.quickAdd, button.dataset.profileId || "");
    }
    if (button.dataset.watchEnroll) {
      button.disabled = true;
      await api(`/api/v1/user/watch-queue/${encodeURIComponent(button.dataset.watchEnroll)}/enroll`, {
        method: "POST", body: "{}"
      });
      await refresh();
      toast("Watching this drop. Nothing is added to cart.");
    }
    if (button.dataset.watchCancel) {
      button.disabled = true;
      await api(`/api/v1/user/watch-queue/${encodeURIComponent(button.dataset.watchCancel)}/cancel`, {
        method: "POST", body: "{}"
      });
      await refresh();
      toast("Watch stopped. No store action was taken.");
    }
    if (button.dataset.falsePositive) {
      const call = state.calls.find((item) => item.id === button.dataset.falsePositive);
      if (!call?.sourceChannelId || !call.id.startsWith("signal:")) {
        throw new Error("Refresh before reporting this call.");
      }
      if (!(await requestConfirmation({
        title: "Report a false positive?",
        summary: "This updates the source scorecard and does not change your plan.",
        confirmLabel: "Report false positive"
      })).confirmed) return;
      button.disabled = true;
      await api("/api/v1/user/source-feedback/false-positive", {
        method: "POST",
        body: JSON.stringify({
          channelId: call.sourceChannelId,
          signalId: call.id.slice("signal:".length),
          confirmation: "REPORT_FALSE_POSITIVE"
        })
      });
      await refresh();
      setTab("calls");
      toast("False positive recorded for this source channel.");
    }
    if (button.dataset.connectorTest) {
      button.disabled = true;
      await api(`/api/v1/user/connectors/${encodeURIComponent(button.dataset.connectorTest)}/test`, {
        method: "POST", body: "{}"
      });
      await refresh();
      setTab("preferences");
      toast("Connector test queued.");
    }
    if (button.dataset.connectorToggle) {
      const connector = state.actionPlatform?.connectors?.find((item) => item.id === button.dataset.connectorToggle);
      if (!connector) throw new Error("Refresh before changing this connector.");
      button.disabled = true;
      await api(`/api/v1/user/connectors/${encodeURIComponent(connector.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          contractVersion: 1,
          kind: connector.kind,
          name: connector.name,
          endpointReference: connector.endpointReference,
          enabled: !connector.enabled,
          events: connector.events
        })
      });
      await refresh();
      setTab("preferences");
      toast(connector.enabled ? "Connector paused." : "Connector enabled.");
    }
    if (button.id === "callBulkAdd") {
      const listingIds = [...new Set($$("[data-call-select]:checked").map((input) => input.dataset.callSelect).filter(Boolean))];
      if (!listingIds.length) throw new Error("Select at least one product without a plan.");
      button.disabled = true;
      const selectedProfileId = $("#callBulkProfile").value;
      const profileId = selectedProfileId === "__notify" ? "" : selectedProfileId;
      let added = 0;
      for (const listingId of listingIds) {
        if (await quickAdd(listingId, profileId, { refresh: false, silent: true })) added += 1;
      }
      await refresh();
      setTab("calls");
      toast(`${added.toLocaleString()} product${added === 1 ? "" : "s"} added with the selected setup.`);
    }
    if (button.id === "acknowledgePrivacyChange") {
      await api("/api/v1/user/privacy/change-acknowledged", { method: "POST", body: "{}" });
      await refresh();
      setTab("preferences");
      toast("Privacy change notice acknowledged.");
    }
    if (button.dataset.productDetail) openProductDetail(button.dataset.productDetail);
    if (button.id === "newProfileButton") {
      openNewProfileDialog();
      return;
    }
    if (button.dataset.profileEdit) {
      beginProfileEdit(button.dataset.profileEdit);
      return;
    }
    if (button.dataset.profileDelete) {
      const result = await api(`/api/v1/user/purchase-profiles/${encodeURIComponent(button.dataset.profileDelete)}`, { method: "DELETE" });
      state.profiles = result.items || [];
      renderProfiles();
      renderProducts();
      toast("Quick add setup removed.");
    }
    if (button.id === "pauseButton") await toggleActions();
    if (button.id === "dismissReleaseAnnouncement") {
      const id = String(state.overview?.announcement?.id || "");
      try { if (id) localStorage.setItem(DISMISSED_ANNOUNCEMENT_KEY, id); } catch { /* Dismissal remains best effort. */ }
      $("#releaseAnnouncement").hidden = true;
    }
    if (button.id === "addProductButton" || button.hasAttribute("data-open-product-link")) openProductLinkDialog();
    if (button.hasAttribute("data-clear-browse")) {
      state.browse = { store: "", availability: "", plan: "", price: "", sort: state.browse.sort };
      for (const id of ["browseStore", "browseAvailability", "browsePlan", "browsePrice"]) {
        const control = $(`#${id}`);
        if (control) control.value = "";
      }
      await loadUserRoute("products", { force: true });
    }
    if (button.id === "checkProductLinkButton") await checkProductLink();
    if (button.id === "changeSetupStore") {
      const variantId = button.dataset.variantId;
      $("#setupDialog").close();
      if (variantId) openProductDetail(variantId);
      return;
    }
    if (button.dataset.trackListing) {
      closeQuickMenu();
      if ($("#productDialog").hasAttribute("open")) $("#productDialog").close();
      await openSetup(button.dataset.trackListing);
    }
    if (button.dataset.editPlan) {
      if ($("#productDialog").hasAttribute("open")) $("#productDialog").close();
      await openPlan(button.dataset.editPlan);
    }
    if (button.id === "deletePlanButton") {
      const plan = state.editingPlan;
      if (!plan?.id) throw new Error("Refresh before deleting this purchase plan.");
      if (!(await requestConfirmation({
        title: `Delete “${plan.title}”?`,
        summary: "This stops pending checks and removes the plan. Prior action and spend history is retained for safety.",
        confirmLabel: "Delete plan",
        danger: true
      })).confirmed) return;
      button.disabled = true;
      try {
        await api(`/api/v1/user/purchase-intents/${encodeURIComponent(plan.id)}`, {
          method: "DELETE",
          body: JSON.stringify({ confirmation: "DELETE_PURCHASE_PLAN" })
        });
        $("#planDialog").close();
        state.editingPlan = null;
        await refresh();
        setTab("plans");
        toast("Purchase plan deleted.");
      } finally {
        button.disabled = false;
      }
    }
    if (button.id === "pairButton") {
      await createPairingCode();
    }
    if (button.dataset.setupAction === "pair_companion") await createPairingCode(true);
    if (button.dataset.setupAction === "connect_signal") openSignalConnectDialog();
    if (button.dataset.setupAction === "add_product") openProductLinkDialog();
    if (button.dataset.setupAction === "choose_product") await focusFirstQuickAdd();
    if (button.dataset.setupAction === "resume_actions") await toggleActions();
  } catch (error) { toast(error.message || "The request failed.", true); }
});

$("#callList").addEventListener("change", () => {
  syncCallBulkAction();
});
$("#callBulkProfile").addEventListener("change", syncCallBulkAction);
$("#callBulkClear").addEventListener("click", () => {
  const focusTarget = $("[data-call-select]:not(:disabled)");
  $$('[data-call-select]:checked').forEach((input) => { input.checked = false; });
  syncCallBulkAction();
  focusTarget?.focus();
});

$("#recheckSignalConnection").addEventListener("click", () => { void recheckSignalConnection(); });

$("#connectorForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const events = [...form.querySelectorAll('input[name="events"]:checked')].map((input) => input.value);
  try {
    if (!events.length) throw new Error("Choose at least one connector update.");
    await api("/api/v1/user/connectors", {
      method: "POST",
      body: JSON.stringify({
        contractVersion: 1,
        kind: form.elements.kind.value,
        name: form.elements.name.value.trim(),
        endpointReference: form.elements.endpointReference.value.trim(),
        enabled: true,
        events
      })
    });
    form.reset();
    for (const checkbox of form.querySelectorAll('input[name="events"]')) checkbox.checked = true;
    await refresh();
    setTab("preferences");
    toast("Action connector saved.");
  } catch (error) {
    toast(error.message || "The connector could not be saved.", true);
  }
});

$("#productLinkForm").addEventListener("input", (event) => {
  const form = event.currentTarget;
  if (event.target.name === "url" && form.elements.url.value.trim() !== state.productLinkPreviewInput) {
    clearProductLinkPreview();
  }
  $("#submitProductLinkButton").disabled = !state.productLinkPreview
    || form.elements.url.value.trim() !== state.productLinkPreviewInput
    || form.elements.confirmed.checked !== true;
});

$("#productLinkForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#submitProductLinkButton");
  try {
    const url = form.elements.url.value.trim();
    if (!state.productLinkPreview || state.productLinkPreviewInput !== url) {
      throw new Error("Check the product link again before sending it for review.");
    }
    if (form.elements.confirmed.checked !== true) {
      throw new Error("Confirm the product-page review first.");
    }
    button.disabled = true;
    button.textContent = "Sending safely…";
    const result = await api("/api/v1/user/catalog/link-proposals", {
      method: "POST",
      body: JSON.stringify({
        url,
        title: form.elements.title.value,
        confirmation: "PROPOSE_EXACT_PRODUCT_LINK"
      })
    });
    $("#productLinkDialog").close();
    clearProductLinkPreview();
    setTab("products", { load: false });
    await refresh();
    toast(result.disposition === "duplicate_pending"
      ? "That product suggestion is already waiting for review."
      : "Product link sent for review. No stock claim, plan, or store action was created.");
  } catch (error) {
    toast(error.message || "The product link could not be sent for review.", true);
  } finally {
    button.disabled = !state.productLinkPreview || form.elements.confirmed.checked !== true;
    button.textContent = "Send for review";
  }
});

const SETUP_MONEY_FIELDS = new Set(["maxUnitPrice", "maxAllIn"]);

$("#setupForm").addEventListener("input", (event) => {
  if (event.target.name === "reviewed") {
    updateSetupCreateState();
    return;
  }
  syncSetupAction();
  renderSetupReview();
  if (SETUP_MONEY_FIELDS.has(event.target.name)) invalidateSetupPreflight();
  else scheduleSetupPreflight();
});

$("#setupForm").addEventListener("change", (event) => {
  if (event.target.name === "reviewed") return;
  const form = event.currentTarget;
  if (["targetQuantity", "maxUnitPrice"].includes(event.target.name)) {
    const quantity = Number(form.elements.targetQuantity.value);
    const unit = setupAmount("maxUnitPrice", "Maximum item price");
    const currentTotal = setupAmount("maxAllIn", "Maximum total");
    const minimum = unit === null ? null : unit * quantity;
    if (Number.isSafeInteger(minimum) && minimum > 0 && (currentTotal === null || currentTotal < minimum)) {
      form.elements.maxAllIn.value = moneyInput(minimum);
    }
  }
  syncSetupAction();
  renderSetupReview();
  scheduleSetupPreflight();
});

$("#setupForm").addEventListener("blur", (event) => {
  if (!SETUP_MONEY_FIELDS.has(event.target.name)) return;
  syncSetupAction();
  renderSetupReview();
  scheduleSetupPreflight();
}, true);

$("#setupDialog").addEventListener("close", () => {
  clearTimeout(state.setupPreflightTimer);
  state.setupPreflightTimer = null;
  state.setupPreflight = null;
  state.setupPreflightSignature = "";
  state.setupPreflightScheduledSignature = "";
  state.setupPreflightPendingSignature = "";
  state.setupPreflightRevision += 1;
  updateSetupCreateState();
});

$("#setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#createPlanButton");
  try {
    if (!state.setupPreflight) throw new Error("Wait for the current price check before creating this purchase plan.");
    if (form.elements.reviewed.checked !== true) throw new Error("Review and confirm the current checked plan first.");
    // Resubmit the server's own just-validated draft rather than re-reading the
    // form: this is what carries any automatic tax/store-fee reserve raise, and
    // keeps the create request exactly what the preflight fingerprint was bound to.
    const draft = { ...state.setupPreflight.draft, contractVersion: 2, confirmation: "CREATE_EXACT_PURCHASE_PLAN" };
    button.disabled = true;
    button.textContent = "Creating safely…";
    await api("/api/v1/user/purchase-intents", {
      method: "POST",
      body: JSON.stringify({
        ...draft,
        preflightFingerprint: state.setupPreflight.preflightFingerprint,
        preflightedAt: state.setupPreflight.preflightedAt
      })
    });
    $("#setupDialog").close();
    state.setupProduct = null;
    await refresh();
    setTab("plans");
    toast(draft.actionCeiling === "add_to_cart"
      ? "Plan created. Review its store readiness."
      : "Purchase plan created in notification-only mode.");
  } catch (error) {
    if (error.code === "purchase_intent_exists") {
      $("#setupDialog").close();
      state.setupProduct = null;
      await refresh();
      setTab("plans");
      toast("That product already has a plan. Review its limits before changing it.");
    } else {
      if (["purchase_intent_preflight_required", "purchase_intent_preflight_stale"].includes(error.code)) {
        scheduleSetupPreflight(0);
      }
      toast(error.message || "The purchase plan could not be created.", true);
    }
  } finally {
    button.textContent = "Create purchase plan";
    updateSetupCreateState();
  }
});

$("#planForm").addEventListener("input", () => syncPlanAction());
$("#planForm").addEventListener("change", (event) => {
  syncPlanAction(event.target.name === "actionCeiling" && event.target.value === "add_to_cart");
});
$("#prepareGuardedPlanButton").addEventListener("click", prepareGuardedPlanDraft);

$("#planBulkApplyForm").elements.reviewed.addEventListener("change", (event) => {
  $("#confirmPlanBulkApply").disabled = event.target.checked !== true;
});

$("#planBulkApplyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#confirmPlanBulkApply");
  const draft = state.planBulkDraft;
  try {
    if (form.elements.reviewed.checked !== true || !draft?.profileId || !draft?.missionIds?.length) {
      throw new Error("Review and confirm the Quick add setup and selected plans first.");
    }
    button.disabled = true;
    button.textContent = "Applying setup…";
    const { applied } = await api("/api/v1/user/purchase-profiles/apply", {
      method: "POST",
      body: JSON.stringify({
        profileId: draft.profileId,
        missionIds: draft.missionIds,
        confirmation: "APPLY_PROFILE_TO_SELECTED_PURCHASE_PLANS"
      })
    });
    $("#planBulkApplyDialog").close();
    state.planBulkMode = false;
    state.planSelection.clear();
    state.planBulkDraft = null;
    await refresh();
    setTab("plans");
    const updated = Number(applied?.propagation?.updatedMissionCount || 0);
    const skipped = Array.isArray(applied?.propagation?.skipped) ? applied.propagation.skipped.length : 0;
    toast(skipped
      ? `${updated.toLocaleString()} plan${updated === 1 ? "" : "s"} updated with “${applied.profile.name}”; ${skipped.toLocaleString()} kept prior limits and will retry automatically when required store or price evidence is available.`
      : `${updated.toLocaleString()} plan${updated === 1 ? "" : "s"} updated with “${applied.profile.name}”.`);
  } catch (error) {
    if (["purchase_profile_plan_selection_stale", "purchase_profile_not_found"].includes(error.code)) await refresh();
    toast(error.message || "The Quick add setup could not be applied.", true);
  } finally {
    button.textContent = "Apply setup";
    button.disabled = form.elements.reviewed.checked !== true;
  }
});

$("#planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const drafts = planTargetDrafts(form, true);
    const targets = drafts.map(({ retailerId: _retailerId, executionSupported: _executionSupported, sellerPolicy: _sellerPolicy, ...target }) => target);
    const actionCeiling = form.elements.actionCeiling.value;
    const maxAllInCents = centsInput(form.elements.maxAllIn.value, "The all-in cap");
    if (actionCeiling === "add_to_cart") {
      const enabled = drafts.filter((target) => target.enabled);
      if (!enabled.length) throw new Error("Enable one store before choosing a cart action.");
      if (enabled.some((target) => !target.executionSupported
        || target.maxUnitPriceCents === null
        || target.sellerPolicy !== "first_party_only"
        || !["shipping", "pickup"].includes(target.fulfillment))) {
        throw new Error("Every enabled cart store needs an add mapping, a maximum item price, Store only seller, and a selected delivery method.");
      }
      const minimum = planAutomaticMinimum(form, drafts);
      if (minimum === null || maxAllInCents === null || maxAllInCents < minimum) {
        throw new Error(`Cart actions need a maximum total of at least ${minimum === null ? "the calculated safety bound" : money(minimum)}.`);
      }
    }
    const expiresValue = event.currentTarget.elements.expiresAt.value;
    await api(`/api/v1/user/purchase-intents/${encodeURIComponent(event.currentTarget.elements.id.value)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: event.currentTarget.elements.status.value,
        targetQuantity: Number(event.currentTarget.elements.targetQuantity.value),
        targets,
        policy: {
          expectedRevision: Number(state.editingPlan.intentPolicy?.revision || 1),
          maxAllInCents,
          actionCeiling,
          decisionMode: "purchase_intent",
          maxSignalAgeSeconds: Number(state.editingPlan.intentPolicy?.maxSignalAgeSeconds || 120),
          cooldownSeconds: Number(event.currentTarget.elements.cooldownMinutes.value || 0) * 60,
          expiresAt: expiresValue ? new Date(expiresValue).toISOString() : "",
          changeReason: "Updated from the user purchase dashboard."
        }
      })
    });
    $("#planDialog").close(); await refresh(); toast("Plan saved.");
  } catch (error) { toast(error.message || "Plan could not be saved.", true); }
});

$("#spendForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/v1/user/spend-policy", {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: Number(event.currentTarget.elements.revision.value),
        perOrderCapCents: centsInput(event.currentTarget.elements.perOrder.value, "The per-order cap"),
        dailyCapCents: centsInput(event.currentTarget.elements.daily.value, "The daily cap"),
        monthlyCapCents: centsInput(event.currentTarget.elements.monthly.value, "The monthly cap"),
        timezone: event.currentTarget.elements.timezone.value.trim(),
        periodResetHour: Number(event.currentTarget.elements.periodResetHour.value)
      })
    });
    await refresh();
    toast("Spending limits saved.");
  } catch (error) { toast(error.message || "Spending limits could not be saved.", true); }
});

function beginProfileEdit(profileId) {
  const profile = state.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) return;
  resetProfileForm();
  const form = $("#profileForm");
  form.elements.id.value = profile.id;
  form.elements.name.value = profile.name;
  form.elements.targetQuantity.value = profile.targetQuantity;
  form.elements.priceMode.value = profile.priceMode;
  form.elements.maxUnitPrice.value = profile.priceMode === "fixed_cap" ? moneyInput(profile.maxUnitPriceCents) : "";
  form.elements.msrpOffsetPercent.value = profile.priceMode === "msrp_offset_percent" && profile.msrpOffsetPercent !== null
    ? String(profile.msrpOffsetPercent)
    : "";
  form.elements.actionCeiling.value = profile.actionCeiling;
  form.elements.fulfillment.value = profile.fulfillment === "pickup" ? "pickup" : "shipping";
  form.elements.cooldownMinutes.value = Math.round(Number(profile.cooldownSeconds || 0) / 60);
  form.elements.isDefault.checked = profile.isDefault === true;
  syncProfilePriceMode();
  $("#profileDialogTitle").textContent = "Edit setup";
  $("#saveProfileButton").textContent = "Save changes";
  $("#profileDialog").showModal();
  requestAnimationFrame(() => form.elements.name.focus());
}

function resetProfileForm() {
  const form = $("#profileForm");
  form.reset();
  form.elements.id.value = "";
  form.elements.fulfillment.value = "shipping";
  form.elements.isDefault.checked = state.profiles.length === 0;
  syncProfilePriceMode();
  $("#profileDialogTitle").textContent = "New setup";
  $("#saveProfileButton").textContent = "Save setup";
}

function openNewProfileDialog() {
  resetProfileForm();
  $("#profileDialog").showModal();
  requestAnimationFrame(() => $("#profileForm").elements.name.focus());
}

function syncProfilePriceMode() {
  const form = $("#profileForm");
  const mode = form.elements.priceMode.value;
  form.elements.maxUnitPrice.disabled = mode !== "fixed_cap";
  if (mode !== "fixed_cap") form.elements.maxUnitPrice.value = "";
  form.elements.msrpOffsetPercent.disabled = mode !== "msrp_offset_percent";
  if (mode !== "msrp_offset_percent") form.elements.msrpOffsetPercent.value = "";
}

$("#profileForm").elements.priceMode.addEventListener("change", syncProfilePriceMode);
syncProfilePriceMode();

$("#watchQueueMode").addEventListener("change", async (event) => {
  const control = event.currentTarget;
  const previous = state.actionPlatform?.watchQueueMode === "auto_armed" ? "auto_armed" : "manual";
  const mode = control.value === "auto_armed" ? "auto_armed" : "manual";
  control.disabled = true;
  try {
    const result = await api("/api/v1/user/watch-queue/settings", {
      method: "PATCH",
      body: JSON.stringify({ mode, confirmation: "SET_WATCH_QUEUE_MODE" })
    });
    state.actionPlatform = {
      ...(state.actionPlatform || {}),
      watchQueueMode: result.watchQueue?.mode || mode
    };
    await refresh();
    setTab("preferences");
    setSettingsView("purchase");
    const enrolled = Number(result.watchQueue?.newlyEnrolledCount || 0);
    toast(mode === "auto_armed"
      ? `Watching drops for active plans.${enrolled ? ` ${enrolled.toLocaleString()} open item${enrolled === 1 ? " is" : "s are"} now watched.` : ""}`
      : "Drops are watched only when you choose Watch. Current watches stay until you stop them.");
  } catch (error) {
    control.value = previous;
    toast(error.message || "The watch mode could not be changed.", true);
  } finally {
    control.disabled = false;
  }
});

$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const actionElement = event.submitter || $("#saveProfileButton");
  try {
    const cooldownMinutes = Number(form.elements.cooldownMinutes.value || 0);
    if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 0 || cooldownMinutes > 43_200) {
      throw new Error("The wait between attempts must be from zero through 43,200 minutes.");
    }
    const priceMode = ["fixed_cap", "msrp", "msrp_offset_percent"].includes(form.elements.priceMode.value)
      ? form.elements.priceMode.value
      : "store_price";
    let msrpOffsetPercent = null;
    if (priceMode === "msrp_offset_percent") {
      const raw = form.elements.msrpOffsetPercent.value.trim();
      const parsed = Number(raw);
      if (!raw || !Number.isInteger(parsed) || parsed < -90 || parsed > 90) {
        throw new Error("The MSRP offset percent must be a whole number from -90 through 90.");
      }
      msrpOffsetPercent = parsed;
    }
    const result = await api("/api/v1/user/purchase-profiles", {
      method: "POST",
      body: JSON.stringify({
        id: form.elements.id.value || undefined,
        name: form.elements.name.value.trim(),
        targetQuantity: Number(form.elements.targetQuantity.value),
        actionCeiling: form.elements.actionCeiling.value === "add_to_cart" ? "add_to_cart" : "notify",
        fulfillment: form.elements.fulfillment.value === "pickup" ? "pickup" : "shipping",
        priceMode,
        maxUnitPriceCents: priceMode === "fixed_cap" ? centsInput(form.elements.maxUnitPrice.value, "The fixed maximum item price") : null,
        msrpOffsetPercent,
        isDefault: form.elements.isDefault.checked === true,
        cooldownSeconds: cooldownMinutes * 60
      })
    });
    state.profiles = result.items || [];
    $("#profileDialog").close();
    renderProfiles();
    renderProducts();
    const propagation = result.propagation || {};
    const updatedCount = Number(propagation.updatedMissionCount || 0);
    const skippedCount = Array.isArray(propagation.skipped) ? propagation.skipped.length : 0;
    if (updatedCount || skippedCount) {
      const parts = [];
      if (updatedCount) parts.push(`${updatedCount} linked purchase plan${updatedCount === 1 ? "" : "s"} updated`);
      if (skippedCount) parts.push(`${skippedCount} kept its prior limits (price not yet known)`);
      setInlineStatus($("#newProfileButton"), {
        state: "success",
        message: `Quick add setup saved. ${parts.join("; ")}.`
      });
      toast("Quick add setup saved.", false, { element: actionElement });
    } else {
      toast("Quick add setup saved.", false, { element: actionElement });
    }
  } catch (error) { toast(error.message || "The setup could not be saved.", true, { element: actionElement, reference: error.reference }); }
});

$("#profileDialog").addEventListener("close", resetProfileForm);

for (const [controlId, browseKey] of [
  ["browseStore", "store"],
  ["browseAvailability", "availability"],
  ["browsePlan", "plan"],
  ["browsePrice", "price"],
  ["browseSort", "sort"]
]) {
  $(`#${controlId}`).addEventListener("change", async (event) => {
    state.browse[browseKey] = event.target.value;
    try {
      await loadUserRoute("products", { force: true });
    } catch (error) {
      toast(error.message || "Product filters could not be applied.", true);
    }
  });
}

$("#planFilter").addEventListener("change", (event) => {
  state.planFilter = event.target.value;
  renderPlans();
});

$("#planBulkProfile").addEventListener("change", (event) => {
  state.planBulkProfileId = event.target.value;
  renderPlans();
});

$("#planBulkSelectVisible").addEventListener("change", (event) => {
  const visiblePlans = state.plans.filter((plan) => (state.planFilter === "all" || planReadinessGroup(plan) === state.planFilter)
    && planEligibleForBulkProfile(plan));
  for (const plan of visiblePlans) {
    if (event.target.checked) state.planSelection.add(plan.id);
    else state.planSelection.delete(plan.id);
  }
  renderPlans();
});

document.addEventListener("change", (event) => {
  const planId = event.target?.dataset?.planSelect;
  if (!planId) return;
  if (event.target.checked) state.planSelection.add(planId);
  else state.planSelection.delete(planId);
  renderPlans();
});

let searchTimer;
$("#productSearch").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    state.query = event.target.value.trim();
    try { await loadUserRoute("products", { force: true }); } catch (error) { toast(error.message || "Product search failed.", true); }
  }, 250);
});

$("#cartOutcomeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const action = state.actions.find((item) => item.id === state.cartOutcomeActionId
    && item.id === form.elements.actionId.value);
  if (!closeableCartAction(action)) {
    toast("Refresh before recording this checkout result.", true);
    $("#cartOutcomeDialog").close();
    return;
  }
  try {
    const actualTotalCents = centsInput(form.elements.actualTotal.value, "The amount charged for this item");
    if (actualTotalCents === null) throw new Error("Enter the amount charged for this item.");
    syncCartOutcomeCapWarning();
    form.elements.actualTotal.removeAttribute("aria-invalid");
    await reportCartOutcome(action, "got_it", actualTotalCents, { dialogForm: form });
  } catch (error) {
    form.elements.actualTotal.setAttribute("aria-invalid", "true");
    $("#cartOutcomeStatus").hidden = false;
    $("#cartOutcomeStatus").textContent = error.message || "Enter a valid amount charged for this item.";
    toast(error.message || "Enter a valid amount charged for this item.", true);
    form.elements.actualTotal.focus();
  }
});

$("#cartOutcomeForm").elements.actualTotal.addEventListener("input", syncCartOutcomeCapWarning);

$("#cartOutcomeDialog").addEventListener("cancel", (event) => {
  if ($("#cartOutcomeForm").hasAttribute("aria-busy")) event.preventDefault();
});

$("#cartOutcomeDialog").addEventListener("close", () => {
  const returnFocus = state.cartOutcomeReturnFocus;
  state.cartOutcomeActionId = "";
  state.cartOutcomeReturnFocus = null;
  $("#cartOutcomeForm").reset();
  $("#cartOutcomeForm").removeAttribute("aria-busy");
  if (returnFocus?.isConnected && typeof returnFocus.focus === "function") {
    requestAnimationFrame(() => returnFocus.focus());
  }
});

let adaptivePollTimer = null;
let adaptivePollRunning = false;
function setUserDataStale(stale) {
  const indicator = $("#userDataFreshness");
  indicator.hidden = !stale;
  indicator.textContent = stale ? "Updates paused · Retry" : "Updates current";
}
function adaptivePollDelay() {
  const activityStages = state.actionInsights?.stages || {};
  const compactStages = state.overview?.actionHandoff?.counts || {};
  const queued = Number(activityStages.queued || compactStages.queued || 0);
  const checking = Number(activityStages.checking || compactStages.checking || 0);
  if (queued + checking > 0) return 3_000;
  return activeUserRoute() === "activity" ? 15_000 : 30_000;
}
function scheduleAdaptivePoll() {
  if (adaptivePollTimer !== null) clearTimeout(adaptivePollTimer);
  adaptivePollTimer = null;
  if (document.visibilityState !== "visible") return;
  adaptivePollTimer = setTimeout(async () => {
    adaptivePollTimer = null;
    if (adaptivePollRunning || document.visibilityState !== "visible") {
      scheduleAdaptivePoll();
      return;
    }
    adaptivePollRunning = true;
    try {
      await refreshVisibleActionState(0);
      setUserDataStale(false);
    } catch {
      setUserDataStale(true);
    }
    finally {
      adaptivePollRunning = false;
      scheduleAdaptivePoll();
    }
  }, adaptivePollDelay());
}

function beginPriorityRouteLoad(route) {
  return route === "activity"
    ? refreshActionActivity().then(() => true, () => false)
    : null;
}

function beginCompactHandoffWatch(route) {
  return route === "activity"
    ? null
    : refreshCompactActionHandoff(5_000).catch(() => setUserDataStale(true));
}

function resumeVisibleDashboard() {
  // A cart-ready handoff is the most time-sensitive dashboard state. Start
  // its compact, versioned watch before the broader overview/workspace
  // refresh so slow secondary data cannot delay the route to checkout.
  const route = activeUserRoute();
  const priorityRouteLoad = beginPriorityRouteLoad(route);
  void beginCompactHandoffWatch(route);
  scheduleAdaptivePoll();
      return refresh({
        priorityRoute: priorityRouteLoad ? route : "",
        priorityRouteLoad,
        preservePagination: true
      })
    .catch(() => setUserDataStale(true))
    .finally(scheduleAdaptivePoll);
}

window.addEventListener("hashchange", () => {
  applyHashRoute();
  scheduleAdaptivePoll();
});
window.addEventListener("popstate", () => {
  applyHashRoute();
  scheduleAdaptivePoll();
});
applyHashRoute();
const initialRoute = activeUserRoute();
const initialPriorityRouteLoad = beginPriorityRouteLoad(initialRoute);
if (initialRoute === "home") void refreshCompactActionHandoff(0).catch(() => undefined);
refresh({
  priorityRoute: initialPriorityRouteLoad ? initialRoute : "",
  priorityRouteLoad: initialPriorityRouteLoad
}).catch((error) => toast(error.message || "Yoink could not load.", true)).finally(() => {
  applyHashRoute();
  void beginCompactHandoffWatch(activeUserRoute());
  scheduleAdaptivePoll();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void resumeVisibleDashboard();
  } else {
    scheduleAdaptivePoll();
  }
});
