const state = {
  overview: null,
  storeSetups: [],
  storeSetup: null,
  storeSetupData: null,
  storeSetupSequence: 0,
  storeSetupLoading: false,
  storeSetupReturnFocus: null,
  storeSwitchPending: new Set(),
  products: [],
  productGroups: [],
  productTotal: 0,
  productStores: [],
  productRequestSequence: 0,
  browse: { store: "", availability: "", plan: "", price: "", category: "", sort: "newest" },
  want: null,
  justYoinked: "",
  plans: [],
  planOffset: 0,
  planPageSize: 50,
  planTotal: 0,
  planQuery: "",
  planView: "all",
  planRequestSequence: 0,
  legacyTransition: null,
  callAdded: null,
  actions: [],
  actionTotal: 0,
  actionInsights: null,
  actionGlossary: {},
  actionStageFilter: "all",
  cartActions: [],
  cartActionsSequence: 0,
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
  dismissedProposalIds: new Set(),
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
  callTotal: 0,
  callNextOffset: 0,
  callHasMore: false,
  callRequestSequence: 0,
  homeCalls: [],
  homeCallSummary: null,
  devices: [],
  connectorHistory: { items: [], total: 0 },
  connectorOffset: 0,
  connectorFilter: "",
  connectorHistorySequence: 0,
  connectorHistoryLoaded: false,
  connectorHistoryLoading: false,
  connectorHistoryError: false,
  preferenceRequestSequence: 0,
  overviewRequestSequence: 0,
  overviewAppliedSequence: 0,
  activityFilters: {},
  watchHistoryLimit: 25,
  entity: null,
  entityLoading: null,
  entityRequestSequence: 0,
  detailProduct: null,
  pairing: null,
  pairingTimer: null,
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
  routeLoadErrors: new Map(),
  routeLoadStamps: new Map(),
  routeLoadPromise: null,
  productPageSize: 48,
  callFilter: "all",
  // Setup › Discord and Calls › Discord: what Yoink reads from Discord's Windows notifications.
  discord: null,
  discordCalls: [],
  discordCallTotal: 0,
  discordLink: null,
  callDisplayLimit: 25,
  actionDisplayLimit: 25,
  setupSection: "",
  reviewHistory: { items: [], total: 0, offset: 0, sequence: 0, loading: false, error: false },
  deliveryHealthLoading: false,
  testAlertSending: false,
  testAlertWatch: null
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
const POPULAR_SHOP_CATEGORIES = Object.freeze([
  { id: "needoh", label: "NeeDoh" },
  { id: "pokemon", label: "Pokémon" },
  { id: "disney_lorcana", label: "Disney Lorcana" },
  { id: "one_piece", label: "One Piece" }
]);
const RETAILER_CART_URLS = Object.freeze({
  target: "https://www.target.com/cart",
  walmart: "https://www.walmart.com/cart",
  amazon: "https://www.amazon.com/gp/cart/view.html",
  bestbuy: "https://www.bestbuy.com/cart",
  pokemoncenter: "https://www.pokemoncenter.com/cart",
  asus: "https://eshop.asus.com/us/checkout/cart/",
  audioadvice: "https://www.audioadvice.com/cart",
  bananarepublic: "https://secure-bananarepublic.gap.com/shopping-bag",
  bananarepublicfactory: "https://secure-bananarepublicfactory.gapfactory.com/shopping-bag",
  athleta: "https://secure-athleta.gap.com/shopping-bag",
  americaneagle: "https://www.ae.com/us/en/cart",
  aninebing: "https://www.aninebing.com/cart"
});
const GUARDED_RETAILER_DIRECT_HOSTS = new Set(["target.com", "walmart.com", "amazon.com", "bestbuy.com", "pokemoncenter.com", "aninebing.com", "ae.com", "athleta.gap.com", "secure-athleta.gap.com", "audioadvice.com", "bananarepublic.gap.com", "secure-bananarepublic.gap.com", "bananarepublicfactory.gapfactory.com", "secure-bananarepublicfactory.gapfactory.com", "eshop.asus.com"]);
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

// escapeHtml stops attribute breakout but not a javascript: or data: scheme.
// Every dynamic href goes through this: only https: links and same-origin
// paths survive; anything else becomes "" so the link goes nowhere.
function safeHref(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, location.href);
    if (url.protocol === "https:" && !url.username && !url.password) return raw;
    if (url.origin === location.origin) return raw;
  } catch {
    return "";
  }
  return "";
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
  // Click receipts keep the analytics surface names the server already knows.
  const panel = link.closest?.("[data-panel]") || document.querySelector("[data-panel].active");
  const surface = link.closest?.("#wantedSection") ? "plans"
    : ({ cart: "home", find: "products", setup: "settings", calls: "calls", activity: "activity" })[String(panel?.dataset?.panel || "cart")] || "home";
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

// One formatter per currency. A null, blank or malformed currency code makes
// Intl.NumberFormat throw a RangeError, which would abort a whole list render,
// so anything that isn't a three-letter code (or that Intl rejects) falls back
// to USD.
const currencyFormatters = new Map();
function currencyFormatter(currency) {
  const code = /^[A-Z]{3}$/i.test(String(currency ?? "")) ? String(currency).toUpperCase() : "USD";
  let formatter = currencyFormatters.get(code);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(undefined, { style: "currency", currency: code });
    } catch {
      formatter = currencyFormatters.get("USD") || new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
    }
    currencyFormatters.set(code, formatter);
  }
  return formatter;
}

function money(cents, currency = "USD") {
  if (cents === null || cents === undefined || cents === "" || !Number.isFinite(Number(cents))) return "No price recorded";
  return currencyFormatter(currency).format(Number(cents) / 100);
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
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(dollars) || dollars <= 0 || Math.round(dollars * 100) > 100_000_000) {
    throw new Error(`${label} must be a positive dollar amount with at most two decimal places, or blank.`);
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
  const hours = Math.round(minutes / 60);
  // Past two days an hour count stops being readable ("480 hours ago" for a
  // companion that went quiet weeks ago).
  if (Math.abs(hours) < 48) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(hours, "hour");
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(hours / 24), "day");
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
  const controller = new AbortController();
  const { signal, timeoutMs = 15_000, ...requestOptions } = options;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const response = await fetch(path, {
      ...requestOptions,
      signal: controller.signal,
      // X-Yoink-Request marks the call as coming from Yoink's own pages; the
      // API refuses mutations without it (or a JSON body) so a cross-site
      // form or no-cors fetch cannot reach a mutating route.
      headers: {
        "X-Yoink-Request": "1",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    noteServerBuild(response.headers?.get?.("x-yoink-build") ?? "");
    const payload = await response.json().catch((error) => {
      if (controller.signal.aborted) throw error;
      return {};
    });
    if (!response.ok) {
      const reference = String(payload.correlationId || "");
      const error = new Error(`${payload.message || `Yoink request failed with HTTP ${response.status}.`}${reference ? ` Reference ${reference}.` : ""}`);
      error.reference = reference;
      error.code = String(payload.error || "request_failed");
      error.status = response.status;
      error.details = payload.details && typeof payload.details === "object" ? payload.details : null;
      throw error;
    }
    return payload;
  } catch (cause) {
    if (!controller.signal.aborted) throw cause;
    const mutation = options.method && options.method !== "GET";
    const error = new Error(signal?.aborted ? "Request cancelled." : mutation
      ? "The request timed out. Check the current state before trying again; your change may have been saved."
      : "The request timed out. Check your connection and retry.");
    error.code = signal?.aborted ? "request_cancelled" : "request_timeout";
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

// The page was served by one build; every response names the build that
// answered. When they differ the server was rebuilt underneath this page, so
// say so once instead of rendering payloads this bundle may not understand.
let serverBuildNoticed = false;
function noteServerBuild(headerValue) {
  const served = document.querySelector('meta[name="yoink-build"]')?.content || "";
  const running = String(headerValue || "");
  if (serverBuildNoticed || !served || !running || served === running || served.includes("{{")) return;
  serverBuildNoticed = true;
  const banner = document.createElement("div");
  banner.className = "build-drift-banner";
  banner.setAttribute("role", "status");
  banner.innerHTML = `<span>Yoink was updated. Reload to use the new version.</span><button class="button secondary" type="button">Reload</button>`;
  banner.querySelector("button").addEventListener("click", () => location.reload());
  document.body.prepend(banner);
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

// Three tabs: Cart (what's ready, what you want, what calls did), Find (every
// product once) and Setup (stores, Chrome, alerts, limits, data). The full call
// log and the result history are views inside Cart.
const PRIMARY_TAB_FOR_PANEL = Object.freeze({ calls: "cart", activity: "cart" });
const USER_PANEL_ROUTES = Object.freeze({
  cart: "cart",
  calls: "cart/calls",
  activity: "cart/history",
  find: "find",
  setup: "setup"
});
const SETUP_SECTIONS = Object.freeze(["stores", "chrome", "discord", "alerts", "limits", "data"]);
// Older companions, docs and bookmarks link to the seven-tab routes; each one
// lands on the place that now holds the same thing.
const USER_ROUTE_ALIASES = Object.freeze({
  home: "cart",
  plans: "cart",
  products: "find",
  stores: "setup/stores",
  calls: "cart/calls",
  "calls/drawings": "cart/calls/drawings",
  activity: "cart/history",
  "activity/insights": "cart/history",
  insights: "cart/history",
  health: "cart/history",
  settings: "setup",
  preferences: "setup",
  "settings/chrome": "setup/chrome",
  connections: "setup/chrome",
  diagnostics: "setup/chrome",
  "settings/notifications": "setup/alerts",
  "settings/review": "setup/alerts",
  "settings/privacy": "setup/data",
  "setup/drops": "setup/limits"
});
// Old Settings views (still sent by delivery levers and call fixes) map onto
// the one Setup page's sections.
const SETUP_SECTION_FOR_VIEW = Object.freeze({
  purchase: "limits",
  chrome: "chrome",
  notifications: "alerts",
  privacy: "data"
});
const USER_SKELETON_TARGETS = Object.freeze({
  cart: "#planList",
  find: "#productList",
  calls: "#callList",
  activity: "#actionList",
  setup: "#storeSwitchList"
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

function baseUserHashRoute(panel = activeUserRoute()) {
  if (panel === "find") {
    const query = new URLSearchParams();
    if (state.query) query.set("q", state.query);
    for (const [key, value] of Object.entries(state.browse)) if (value && !(key === "sort" && value === "newest")) query.set(key, value);
    return `find${query.size ? `?${query}` : ""}`;
  }
  if (panel === "calls" && state.callFilter === "drawings") return "cart/calls/drawings";
  if (panel === "calls" && state.callFilter === "discord") return "cart/calls/discord";
  if (panel === "setup") return SETUP_SECTIONS.includes(state.setupSection) ? `setup/${state.setupSection}` : "setup";
  return USER_PANEL_ROUTES[panel] || USER_PANEL_ROUTES.cart;
}

function currentUserHashRoute(panel = activeUserRoute()) {
  const [base, raw = ""] = baseUserHashRoute(panel).split("?");
  const query = new URLSearchParams(raw);
  if (panel === "cart") {
    if (state.planQuery) query.set("q", state.planQuery);
    if (state.planView !== "all") query.set("view", state.planView);
  }
  if (state.storeSetup?.panel === panel) {
    query.set("setupStore", state.storeSetup.retailerId);
    if (state.storeSetup.planId) query.set("returnPlanId", state.storeSetup.planId);
  }
  if (state.entity?.panel === panel) query.set(`${state.entity.kind}Id`, state.entity.id);
  if (panel === "activity") for (const [key, value] of Object.entries(state.activityFilters || {})) if (value) query.set(key, value);
  return `${base}${query.size ? `?${query}` : ""}`;
}

function writeUserRoute(mode, panel) {
  if (mode !== "push" && mode !== "replace") return;
  const route = currentUserHashRoute(panel);
  if (location.hash.slice(1) === route) return;
  history[`${mode}State`](null, "", `#${route}`);
}

function setTab(name, { load = true, historyMode = "replace" } = {}) {
  if (name !== activeUserRoute()) {
    const dirty = document.querySelector('dialog[open][data-dirty="true"]');
    if (dirty) {
      writeUserRoute("replace", activeUserRoute());
      toast("Your draft is still open. Save it or close it before leaving this workspace.");
      return;
    }
    closeStoreSetup({ writeRoute: false });
    state.entityRequestSequence += 1;
    state.entityLoading = null;
    state.entity = null;
    for (const dialog of document.querySelectorAll("dialog[open]")) { dialog.dataset.entityKey = ""; dialog.close(); }
  }
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

// Setup is one page; a section route only scrolls to that part of it.
function setSetupSection(name, { historyMode = "replace", scroll = true } = {}) {
  const previous = state.setupSection;
  state.setupSection = SETUP_SECTIONS.includes(name) ? name : "";
  $$("[data-setup-section]").forEach((button) => {
    button.setAttribute("aria-current", String(button.dataset.setupSection === state.setupSection));
  });
  if (activeUserRoute() === "setup") writeUserRoute(historyMode, "setup");
  if (scroll && state.setupSection) {
    const block = document.querySelector(`[data-setup-block="${state.setupSection}"]`);
    if (block && typeof block.scrollIntoView === "function") block.scrollIntoView({ block: "start" });
  }
  if (state.setupSection === "alerts" && state.overview && !state.connectorHistoryLoaded && !state.connectorHistoryLoading && !state.connectorHistoryError) {
    void loadConnectorHistory().catch(() => undefined);
  }
  // Opening Alerts re-reads the Chrome delivery receipts; the overview's copy
  // can be minutes old by the time the shopper looks.
  if (state.setupSection === "alerts" && previous !== "alerts" && state.overview) {
    void refreshDeliveryHealth();
  }
}

function applyHashRoute() {
  const [rawRoute, rawQuery = ""] = location.hash.slice(1).split("?");
  const requested = rawRoute.replace(/^\/+|\/+$/g, "");
  const routeQuery = new URLSearchParams(rawQuery);
  const nextEntityId = routeQuery.get("planId") || routeQuery.get("productId") || "";
  if (document.querySelector('dialog[open][data-dirty="true"]') && location.hash.slice(1) !== currentUserHashRoute()) {
    writeUserRoute("replace", activeUserRoute());
    toast("Your draft is still open. Save it or close it before leaving this detail.");
    return;
  }
  const route = USER_ROUTE_ALIASES[requested] || requested || "cart";
  if (route === "cart/history") {
    const nextFilters = Object.fromEntries(["window", "store", "product", "asOf"].map((key) => [key, routeQuery.get(key) || ""]).filter(([, value]) => value));
    if (JSON.stringify(nextFilters) !== JSON.stringify(state.activityFilters)) {
      state.activityFilters = nextFilters;
      state.actions = [];
      state.actionDisplayLimit = 25;
      state.loadedRoutes.delete("activity");
    }
  }
  if (route === "cart") {
    const query = routeQuery.get("q") || "";
    // Old #plans links filtered by action or status; keep the nearest view.
    const legacyView = requested !== "plans" ? ""
      : ["add_to_cart", "notify"].includes(routeQuery.get("action") || "") ? routeQuery.get("action")
        : routeQuery.get("status") === "paused" ? "paused" : "";
    const requestedView = routeQuery.get("view") || legacyView;
    const view = ["add_to_cart", "notify", "paused"].includes(requestedView) ? requestedView : "all";
    if (query !== state.planQuery || view !== state.planView) {
      state.planQuery = query; state.planView = view; state.planOffset = 0;
      state.loadedRoutes.delete("cart"); state.planRequestSequence += 1;
    }
    $("#planSearch").value = query;
  }
  if (route === "find") {
    state.query = routeQuery.get("q") || "";
    $("#productSearch").value = state.query;
    for (const key of Object.keys(state.browse)) state.browse[key] = routeQuery.get(key) || (key === "sort" ? "newest" : "");
    if (!routeQuery.has("availability") && rememberedInStockOnly()) state.browse.availability = "in_stock";
    for (const [id, key] of [["browseAvailability", "availability"], ["browsePlan", "plan"], ["browsePrice", "price"], ["browseSort", "sort"]]) $(`#${id}`).value = state.browse[key];
    state.loadedRoutes.delete("find");
  }
  if (route === "cart/calls/drawings") state.callFilter = "drawings";
  else if (route === "cart/calls/discord") state.callFilter = "discord";
  else if (route === "cart/calls") state.callFilter = "all";
  const setupSection = route.startsWith("setup/") ? route.slice("setup/".length) : "";
  const panel = route === "cart" ? "cart"
    : route === "cart/calls" || route === "cart/calls/drawings" || route === "cart/calls/discord" ? "calls"
      : route === "cart/history" ? "activity"
        : route === "find" ? "find"
          : route === "setup" || SETUP_SECTIONS.includes(setupSection) ? "setup"
            : "cart";
  const kind = routeQuery.has("planId") && ["cart", "find", "calls"].includes(panel) ? "plan" : ["cart", "find"].includes(panel) && routeQuery.has("productId") ? "product" : "";
  const nextKey = kind && nextEntityId ? `${panel}:${kind}:${nextEntityId}` : "";
  const currentDetail = kind ? $(kind === "plan" ? "#planDialog" : "#productDialog") : null;
  const keepOpenDetail = nextKey && nextKey === entityKey() && panel === activeUserRoute()
    && currentDetail?.open && currentDetail.dataset.entityKey === nextKey;
  const keepPendingDetail = nextKey && nextKey === entityKey() && panel === activeUserRoute()
    && state.entityLoading?.key === nextKey;
  if (!keepOpenDetail && !keepPendingDetail) {
    state.entityRequestSequence += 1;
    state.entityLoading = null;
    state.entity = null;
    for (const id of ["productDialog", "planDialog", "entityErrorDialog"]) { const dialog = $(`#${id}`); dialog.dataset.entityKey = ""; if (dialog.open) dialog.close(); }
  }
  setTab(panel, { historyMode: "none" });
  if (panel === "setup") setSetupSection(setupSection, { historyMode: "none", scroll: Boolean(setupSection) });
  state.entity = kind && nextEntityId ? { kind, id: nextEntityId, panel } : null;
  void restoreEntityDetail();
  const setupStore = routeQuery.get("setupStore") || "";
  if (!kind && isGuardedStore(setupStore)) {
    const next = { retailerId: setupStore, planId: routeQuery.get("returnPlanId") || "", panel };
    if (JSON.stringify(next) !== JSON.stringify(state.storeSetup)) {
      state.storeSetup = next;
      state.storeSetupData = null;
      void loadStoreSetup();
    }
  } else closeStoreSetup({ writeRoute: false });
  if (panel === "calls") syncCallFilterView();
  const canonical = currentUserHashRoute(panel);
  if (requested !== canonical || location.hash.slice(1) !== canonical) history.replaceState(null, "", `#${canonical}`);
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
  official_msrp_plan_review_required: "Review this item's official MSRP and exact variant",
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
    pokemoncenter: "Pokémon Center",
    asus: "ASUS",
    audioadvice: "Audio Advice",
    bananarepublic: "Banana Republic",
    bananarepublicfactory: "Banana Republic Factory",
    athleta: "Athleta",
    americaneagle: "American Eagle",
    aninebing: "ANINE BING"
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
    return `<a class="button ${quiet ? "quiet" : "primary"}" href="${escapeHtml(safeHref(href))}">${escapeHtml(label)}</a>`;
  }
  return `<button class="button ${quiet ? "quiet" : "primary"}" data-setup-action="${escapeHtml(action)}" type="button">${escapeHtml(label)}</button>`;
}

// This hint only prefills a fresh reviewed form. It never restores consent or changes a saved plan.
function firstPlanJourney() {
  return state.overview?.counts?.purchaseIntents === 0;
}

function firstPlanIntentKey() {
  const actor = state.overview?.actor?.userId;
  return actor ? `yoinkFirstPlanIntent:${actor}` : "";
}

function firstPlanIntent() {
  const key = firstPlanIntentKey();
  if (!firstPlanJourney() || !key) return "";
  try {
    const hint = JSON.parse(sessionStorage.getItem(key) || "null");
    if (hint && ["notify", "add_to_cart"].includes(hint.intent)
      && Number.isFinite(hint.savedAt) && hint.savedAt <= Date.now()
      && Date.now() - hint.savedAt < 24 * 60 * 60 * 1000) return hint.intent;
  } catch { /* A missing or invalid hint leaves the reviewed form at notify only. */ }
  return "";
}

function firstPlanMarkup() {
  const intent = firstPlanIntent();
  return `<div class="first-plan-intent" role="group" aria-label="What should Yoink do?">
    <p>What should Yoink do?</p>
    <div class="inline-actions">
      <button class="button ${intent === "notify" ? "primary" : "quiet"}" data-first-plan-intent="notify" aria-pressed="${intent === "notify"}" type="button">Notify only</button>
      <button class="button ${intent === "add_to_cart" ? "primary" : "quiet"}" data-first-plan-intent="add_to_cart" aria-pressed="${intent === "add_to_cart"}" type="button">Add to cart</button>
    </div>
    <p>${intent === "add_to_cart" ? "One item, within your limits, when the store is ready. You handle checkout."
      : "Follow exact offers. Review your product and limits before saving."}</p>
  </div>`;
}

function setupProgressMarkup(setup) {
  if (typeof setup?.savedPlanCount !== "number") return "";
  return `<ol class="setup-progress" aria-label="Setup progress">
    <li>Plan: <strong>${setup.savedPlanCount ? "Saved" : "Not saved"}</strong></li>
    <li>Monitoring: <strong>${setup.readyForMonitoring ? "Configured" : "Not ready"}</strong></li>
    <li>Cart actions: <strong>${setup.readyForGuardedAdds ? "Ready for offer checks" : setup.guardedCartPlanCount ? "Not ready" : "Off"}</strong></li>
  </ol>`;
}

// The "continue on desktop" hint is for a shopper on a phone.
function narrowScreen() {
  try { return window.matchMedia?.("(max-width: 700px)")?.matches === true; } catch { return false; }
}

function desktopHandoffMarkup(setup) {
  if (!setup?.savedPlanCount || setup.companion?.onlineCurrentCount > 0) return "";
  return `<div class="desktop-handoff"><p>On a phone? Your plan is saved to your account. Continue in desktop Chrome, sign in to the same account, then finish setup.</p>
    <button class="button quiet" data-setup-action="desktop_handoff" type="button">Copy desktop setup link</button>
    <label data-desktop-link hidden>Desktop setup link<input readonly aria-label="Desktop setup link"></label></div>`;
}

// Delivery health (W2, X-01): the server's receipts for whether a call can
// reach this shopper. Home, Settings and the Chrome list render this one
// object instead of calling calls "live" from a stored flag; an older API
// that omits it gets no delivery claim at all.
const DELIVERY_BLOCKED_POLL_STATES = new Set(["offline", "refused", "never", "silent", "no_store_access"]);
// The steps delivery depends on. They keep Home's priority because they are
// usually why delivery is blocked; later setup steps yield to delivery (I3).
const UPSTREAM_SETUP_STEPS = new Set(["companion", "signal"]);
const DELIVERY_RECEIPT_STATES = ["ok", "attention", "waiting", "none"];
const DELIVERY_RECEIPT_TAGS = Object.freeze({
  ok: { tone: "good", label: "OK" },
  attention: { tone: "warn", label: "Attention" },
  waiting: { tone: "info", label: "Waiting" },
  none: { tone: "", label: "Not yet" }
});
// Levers this page can perform. Opening Chrome, reloading the companion and
// granting store access happen in Chrome, so those are shown as a step (I2).
const WEB_DELIVERY_LEVERS = new Set(["send_test_alert", "pair_companion", "view_plans"]);
const DELIVERED_TEST_ALERT_STATES = new Set(["delivered", "clicked", "dismissed"]);
const OPEN_TEST_ALERT_STATES = new Set(["pending", "leased"]);
const TEST_ALERT_POLL_MS = 3_000;
const TEST_ALERT_WATCH_MS = 60_000;

function deliveryHealthOf(overview) {
  const value = overview?.deliveryHealth;
  return value && typeof value === "object" && value.contractVersion === 1 && Array.isArray(value.receipts) ? value : null;
}

function latestTimestamp(...values) {
  let latest = "";
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const time = new Date(String(value || "")).getTime();
    if (Number.isFinite(time) && time > latestTime) {
      latest = String(value);
      latestTime = time;
    }
  }
  return latest;
}

// The newest refusal the companion reported for its polling loops.
function deliveryRefusal(device) {
  const loops = device?.loopHealth && typeof device.loopHealth === "object" ? device.loopHealth : {};
  return ["notifications", "jobs"].map((loop) => loops[loop])
    .filter((entry) => entry && entry.ok !== true && Number(entry.status) >= 400)
    .sort((first, second) => new Date(second.at || 0).getTime() - new Date(first.at || 0).getTime())[0] || null;
}

// Whether (and when) one companion last asked Yoink for calls: the receipt
// that "online" alone never proved.
function devicePollSummary(device) {
  const lastPoll = latestTimestamp(device?.lastNotificationPollAt, device?.lastJobPollAt);
  switch (String(device?.pollState || "")) {
    case "polling": return { tone: "good", text: `Asked for calls ${relative(lastPoll)}` };
    case "silent": return { tone: "warn", text: `Last asked for calls ${relative(lastPoll)}` };
    case "refused": {
      const refusal = deliveryRefusal(device);
      return { tone: "bad", text: `Refused${refusal ? ` (HTTP ${Number(refusal.status)})` : ""}` };
    }
    case "no_store_access": return { tone: "warn", text: "No store access" };
    case "never": return { tone: "warn", text: "Never asked for calls" };
    case "offline": return { tone: "", text: lastPoll ? `Last asked for calls ${relative(lastPoll)}` : "Never asked for calls" };
    default: return null;
  }
}

function primaryDeliveryDevice(delivery) {
  const devices = Array.isArray(delivery?.channel?.devices) ? delivery.channel.devices : [];
  return devices.find((device) => device.online && device.notificationsCapable)
    || devices.find((device) => device.online) || devices[0] || null;
}

function deliveryChannelLine(delivery) {
  const device = primaryDeliveryDevice(delivery);
  if (!device) return "No Chrome companion is paired.";
  const presence = device.online ? "Online" : `Offline · last seen ${relative(device.lastSeenAt)}`;
  return [presence, devicePollSummary(device)?.text].filter(Boolean).join(" · ");
}

function deliveryLeverMarkup(lever, { primary = false } = {}) {
  if (!lever?.code || !lever.label) return "";
  const kind = primary ? "primary" : "secondary";
  if (lever.code === "reconnect_source") {
    const href = safeHref(lever.url);
    if (href) return `<a class="button ${kind}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(lever.label)} ↗</a>`;
  }
  if (WEB_DELIVERY_LEVERS.has(lever.code)) {
    return `<button class="button ${kind}" data-delivery-lever="${escapeHtml(lever.code)}" type="button">${escapeHtml(lever.label)}</button>`;
  }
  return `<span class="delivery-instruction">${escapeHtml(lever.label)}</span>`;
}

// The test-alert watch re-renders these surfaces every few seconds; keep
// keyboard focus on the delivery control the shopper was using.
function captureDeliveryFocus(container) {
  const active = document.activeElement;
  const key = container && active && container.contains(active)
    ? active.dataset?.deliveryLever || active.dataset?.openSettings || ""
    : "";
  if (!key) return () => undefined;
  return () => {
    const current = document.activeElement;
    if (current && current !== document.body && current.isConnected) return;
    [...container.querySelectorAll("[data-delivery-lever], [data-open-settings]")]
      .find((element) => (element.dataset.deliveryLever || element.dataset.openSettings) === key)
      ?.focus({ preventScroll: true });
  };
}

function homeDeliveryMarkup(delivery) {
  const device = primaryDeliveryDevice(delivery);
  return `<section class="home-next-action" data-home-delivery aria-labelledby="homeDeliveryActionTitle">
      <p class="eyebrow">Delivery</p>
      <h2 id="homeDeliveryActionTitle">${escapeHtml(device?.name || "Chrome companion")}</h2>
      <p>${escapeHtml(deliveryChannelLine(delivery))}</p>
      <div class="inline-actions">${deliveryLeverMarkup(delivery.nextAction, { primary: true })}</div>
    </section>`;
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
  const steps = Array.isArray(setup?.steps) ? setup.steps : [];
  const firstIncomplete = setup?.level === "review_saved_plans"
    ? steps.find((item) => item.id === "action")
    : steps.find((item) => item.state !== "complete");
  // A shopper who paused on purpose, with plans saved and every other step
  // done, gets a status row with Resume rather than a permanent "Step 5 of 5".
  const deliberatePause = paused
    && firstIncomplete?.id === "action"
    && Number(overview?.counts?.purchaseIntents || 0) > 0
    && steps.filter((item) => item.id !== "action").every((item) => item.state === "complete");
  const nextSetupStep = primary || deliberatePause ? null : firstIncomplete || null;
  const delivery = deliveryHealthOf(overview);
  const deliveryBlocked = Boolean(delivery) && Number(overview?.counts?.purchaseIntents || 0) > 0
    && (delivery.state === "attention" || DELIVERY_BLOCKED_POLL_STATES.has(String(delivery.channel?.pollState || "")));
  const upstreamSetup = Boolean(nextSetupStep) && UPSTREAM_SETUP_STEPS.has(String(nextSetupStep.id));
  const status = needsYou ? "needs_you"
    : cartReady ? "cart_ready"
      : purchaseReady ? "purchase_ready"
      : primary ? "handoff"
        : nextSetupStep && (upstreamSetup || !deliveryBlocked) ? "setup"
          : deliveryBlocked ? "delivery"
            : paused ? "paused" : "ready";
  const wantedCount = Number(overview?.counts?.purchaseIntents || 0);
  const headline = status === "needs_you" ? "A cart needs you."
    : status === "cart_ready" ? "Your cart is ready."
      : status === "purchase_ready" ? "Buy at Walmart is ready."
      : status === "handoff" ? "A store action is ready to review."
        : status === "setup" ? setup.headline
          : status === "delivery" ? delivery.headline
            : status === "paused" ? "Auto-cart is off."
              : wantedCount > 0 ? `Watching ${wantedCount.toLocaleString()} item${wantedCount === 1 ? "" : "s"}.` : "Yoink is ready.";
  // "Ready" says only what a receipt proves: the server's delivery summary,
  // or nothing about calls at all when an older API sends none.
  const summary = primary
    ? `${primary.title} · ${retailerDisplayName(primary.retailerId)}.`
    : status === "setup" ? setup.summary
      : status === "delivery" ? delivery.summary
        : status === "paused" ? "Yoink still logs every call for something you want."
          : delivery?.summary || "Nothing needs you right now.";
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
    nextSetupStep: status === "setup" ? nextSetupStep : null,
    delivery
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
    delete panel.dataset.actionJob;
    return;
  }
  panel.dataset.actionJob = String(primary.id || "");
  const retailer = retailerDisplayName(primary.retailerId);
  const otherCount = Math.max(0,
    Number(handoff?.counts?.readyToCheckout || 0) + Number(handoff?.counts?.needsYou || 0) - 1);
  $("#homeActionHandoffEyebrow").textContent = needsYou ? "Needs you"
    : purchaseReady ? "Ready at Walmart" : "Ready to check out";
  $("#homeActionHandoffTitle").textContent = needsYou
    ? `Review ${primary.title}`
    : purchaseReady ? `${primary.title} is ready to add`
      : `${primary.title} is in your cart`;
  $("#homeActionHandoffCopy").textContent = `${retailer} · ${purchaseReady ? "Item " : ""}${primary.retailerSku}. ${primary.statusSummary}${otherCount ? ` ${otherCount.toLocaleString()} more ${otherCount === 1 ? "cart is" : "carts are"} below.` : ""}`;
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
  const closeout = cartCloseoutMarkup((state.cartActions || []).find((action) => action.id === primary.id));
  $("#homeActionHandoffActions").innerHTML = `${retailerLinkMarkup(
    destination,
    `${primary.title} cart handoff`,
    needsYou ? "Review store ↗" : `Check out at ${retailer} ↗`,
    "button primary home-cart-handoff-link",
    "",
    { jobId: primary.id, destinationKind: "cart" }
  )}${closeout || '<button class="button quiet" data-tab="activity" type="button">Details</button>'}`;
}

function renderHomePriority() {
  const overview = state.overview;
  if (!overview) return;
  const model = deriveUserHome(overview);
  const { paused, handoff, primary, nextSetupStep, delivery } = model;
  const heroState = $("#heroState");
  const completedSetupSteps = Math.max(0, Number(overview.setup?.completedSteps) || 0);
  const totalSetupSteps = Math.max(1, Number(overview.setup?.totalSteps) || 5);
  const currentSetupStep = Math.max(1, (overview.setup?.steps || []).indexOf(nextSetupStep) + 1);
  const restoreFocus = captureDeliveryFocus(heroState);
  heroState.classList.toggle("contextual", Boolean(nextSetupStep) || model.status === "delivery");
  heroState.innerHTML = model.status === "delivery"
    ? homeDeliveryMarkup(delivery)
    : nextSetupStep
    ? `<section class="home-next-action" data-home-setup aria-labelledby="homeNextActionTitle">
      <p class="eyebrow">Step ${currentSetupStep.toLocaleString("en-US")} of ${totalSetupSteps.toLocaleString("en-US")} · ${completedSetupSteps} complete</p>
      ${firstPlanJourney() ? firstPlanMarkup() : ""}
      <h2 id="homeNextActionTitle">${escapeHtml(nextSetupStep.title)}</h2>
      <p>${escapeHtml(nextSetupStep.summary)}</p>
      ${firstPlanJourney() ? setupProgressMarkup(overview.setup) : ""}${narrowScreen() ? desktopHandoffMarkup(overview.setup) : ""}
      <div class="inline-actions">${setupActionMarkup(nextSetupStep.primaryAction, nextSetupStep.primaryActionLabel)}${setupActionMarkup(nextSetupStep.secondaryAction, nextSetupStep.secondaryActionLabel, true)}</div>
    </section>`
    : paused && !primary ? `<p class="cart-paused-note">Matches are only logged until Auto-cart is on.${homePausedActionMarkup()}</p>`
      : "";
  heroState.hidden = !heroState.innerHTML.trim();
  restoreFocus();

  $("#homeHeadline").textContent = model.headline;
  // The setup card below carries the specific step, so the general summary
  // would only repeat it.
  $("#homeSummary").textContent = nextSetupStep ? "" : model.summary;
  renderHomeActionHandoff(handoff);
  renderHomeDelivery();
  renderTabSignals();
}

function deliveryReceiptMarkup(receipt) {
  const receiptState = DELIVERY_RECEIPT_STATES.includes(receipt?.state) ? receipt.state : "none";
  const tag = DELIVERY_RECEIPT_TAGS[receiptState];
  const at = String(receipt?.at || "");
  const dated = Number.isFinite(new Date(at).getTime());
  const detail = String(receipt?.detail || "");
  // Attention details stay visible; the others are for screen readers and hover.
  return `<li class="delivery-receipt ${receiptState}" data-delivery-receipt="${escapeHtml(receipt?.key || "")}"${detail ? ` title="${escapeHtml(detail)}"` : ""}>
      <span class="delivery-receipt-label">${escapeHtml(receipt?.label || "")}</span>
      <strong>${dated ? `<time datetime="${escapeHtml(at)}">${escapeHtml(relative(at))}</time>` : "Never"}</strong>
      <span class="tag ${tag.tone}">${escapeHtml(tag.label)}</span>
      ${detail ? `<small${receiptState === "attention" ? "" : ' class="sr-only"'}>${escapeHtml(detail)}</small>` : ""}
    </li>`;
}

// The receipts strip shows whenever there is a plan or a paired companion,
// whatever the hero leads with, so a quiet channel is never hidden (I3).
function renderHomeDelivery() {
  const section = $("#homeDelivery");
  if (!section) return;
  const overview = state.overview;
  const delivery = deliveryHealthOf(overview);
  const visible = Boolean(delivery) && (Number(overview?.counts?.purchaseIntents || 0) > 0
    || Number(delivery.channel?.pairedDevices || 0) > 0);
  section.hidden = !visible;
  if (!visible) {
    section.innerHTML = "";
    return;
  }
  const restoreFocus = captureDeliveryFocus(section);
  // When delivery leads Home, the hero already carries its lever.
  const lever = deriveUserHome(overview).status === "delivery" ? "" : deliveryLeverMarkup(delivery.nextAction);
  section.innerHTML = `<h3 id="homeDeliveryTitle">Delivery receipts</h3>
    <ol class="delivery-receipts">${delivery.receipts.map(deliveryReceiptMarkup).join("")}</ol>
    ${lever ? `<div class="delivery-next">${lever}</div>` : ""}`;
  restoreFocus();
}

function deliveryTestAlertSummary(alert) {
  if (DELIVERED_TEST_ALERT_STATES.has(String(alert.state)) && alert.deliveredAt) return `Chrome showed it ${relative(alert.deliveredAt)}.`;
  return String(alert.summary || "");
}

// Settings → Notifications: the Chrome channel, its 7-day counts and the one
// action that proves it end to end, a real test alert (W2).
function renderDeliveryCard() {
  const card = $("#deliveryCard");
  if (!card) return;
  const delivery = deliveryHealthOf(state.overview);
  if (!delivery) {
    // Empty collapses the card (CSS :empty); an older API makes no delivery claim.
    card.innerHTML = "";
    return;
  }
  const restoreFocus = captureDeliveryFocus(card);
  const counts = delivery.notifications || {};
  const created = Math.max(0, Number(counts.created) || 0);
  const delivered = Math.max(0, Number(counts.delivered) || 0);
  const undelivered = Math.max(0, Number(counts.expired) || 0) + Math.max(0, Number(counts.failed) || 0);
  const days = Math.max(1, Number(counts.windowDays) || 7);
  const tag = DELIVERY_RECEIPT_TAGS[DELIVERY_RECEIPT_STATES.includes(delivery.state) ? delivery.state : "none"];
  const alert = delivery.testAlert && typeof delivery.testAlert === "object" ? delivery.testAlert : null;
  card.innerHTML = `<div>
      <div class="card-top"><h3 id="deliveryCardTitle">Chrome notifications</h3><span class="tag ${tag.tone}">${escapeHtml(tag.label)}</span></div>
      <p><strong>${escapeHtml(delivery.headline)}</strong> ${escapeHtml(delivery.summary)}</p>
      <p>${escapeHtml(delivery.channel?.explanation || "")}</p>
      <div class="delivery-counts" role="group" aria-label="Calls in the last ${days} days">
        <small>Last ${days} days</small>
        <span><strong>${created.toLocaleString("en-US")}</strong>${created === 1 ? "call" : "calls"}</span>
        <span><strong>${delivered.toLocaleString("en-US")}</strong>delivered</span>
        <span><strong>${undelivered.toLocaleString("en-US")}</strong>not delivered</span>
      </div>
      ${undelivered && counts.dominantFailureReason ? `<p class="delivery-failure">${escapeHtml(counts.dominantFailureReason)}</p>` : ""}
      <div class="inline-actions"><button class="button secondary" data-delivery-lever="send_test_alert" type="button">Send test alert</button></div>
      ${alert ? `<div class="mini-row delivery-test-receipt"><span><strong>Latest test alert · ${escapeHtml(alert.label || "Requested")}</strong><small>${escapeHtml(deliveryTestAlertSummary(alert))} Sent ${escapeHtml(relative(alert.requestedAt))}.</small></span></div>` : ""}
    </div>`;
  restoreFocus();
}

// A newer delivery-health snapshot (the GET route, a test alert) replaces the
// overview's copy and re-renders every surface that shows it.
function applyDeliveryHealth(value) {
  if (!state.overview || !deliveryHealthOf({ deliveryHealth: value })) return false;
  const current = deliveryHealthOf(state.overview);
  if (current && new Date(value.generatedAt).getTime() < new Date(current.generatedAt).getTime()) return false;
  state.overview = { ...state.overview, deliveryHealth: value };
  renderHomePriority();
  renderDeliveryCard();
  if (state.devices.length) renderPairedDevices();
  return true;
}

async function refreshDeliveryHealth() {
  if (state.deliveryHealthLoading) return false;
  state.deliveryHealthLoading = true;
  try {
    const payload = await api("/api/v1/user/delivery-health");
    return applyDeliveryHealth(payload.deliveryHealth);
  } catch {
    // The overview's copy stays on screen; a failed refresh must not blank it.
    return false;
  } finally {
    state.deliveryHealthLoading = false;
  }
}

function stopTestAlertWatch() {
  const watch = state.testAlertWatch;
  if (watch?.timer) clearTimeout(watch.timer);
  state.testAlertWatch = null;
}

function announceTestAlertResult() {
  const alert = deliveryHealthOf(state.overview)?.testAlert;
  if (!alert) return;
  if (DELIVERED_TEST_ALERT_STATES.has(String(alert.state))) toast("Chrome showed the test alert.");
  else if (!OPEN_TEST_ALERT_STATES.has(String(alert.state))) toast(`Test alert not delivered. ${deliveryTestAlertSummary(alert)}`, true);
  else toast("Chrome has not shown the test alert yet.");
}

// After a test alert, re-read delivery health every few seconds for up to a
// minute, until Chrome picks it up and reports it. Leaving the view or a
// failed read ends the watch; the receipt in Settings keeps the last state.
function watchTestAlert() {
  stopTestAlertWatch();
  const watch = { startedAt: Date.now(), route: activeUserRoute(), timer: null };
  state.testAlertWatch = watch;
  const tick = async () => {
    watch.timer = null;
    if (state.testAlertWatch !== watch) return;
    if (activeUserRoute() !== watch.route) {
      stopTestAlertWatch();
      return;
    }
    try {
      const payload = await api("/api/v1/user/delivery-health");
      if (state.testAlertWatch !== watch) return;
      applyDeliveryHealth(payload.deliveryHealth);
    } catch {
      if (state.testAlertWatch === watch) stopTestAlertWatch();
      return;
    }
    const alertState = String(deliveryHealthOf(state.overview)?.testAlert?.state || "");
    if (!OPEN_TEST_ALERT_STATES.has(alertState) || Date.now() - watch.startedAt >= TEST_ALERT_WATCH_MS) {
      stopTestAlertWatch();
      announceTestAlertResult();
      return;
    }
    watch.timer = setTimeout(tick, TEST_ALERT_POLL_MS);
  };
  watch.timer = setTimeout(tick, TEST_ALERT_POLL_MS);
}

async function sendTestAlert() {
  if (state.testAlertSending) return;
  state.testAlertSending = true;
  for (const button of $$('[data-delivery-lever="send_test_alert"]')) button.disabled = true;
  try {
    const result = await api("/api/v1/user/delivery-health/test-alert", { method: "POST", body: "{}" });
    applyDeliveryHealth(result.deliveryHealth);
    toast("Test alert sent. Watch for it in Chrome.");
    watchTestAlert();
  } catch (error) {
    // 409s name the missing piece; offer the step that supplies it.
    const action = error.code === "test_alert_needs_device"
      ? { label: "Pair Chrome", onClick: () => createPairingCode(true) }
      : error.code === "test_alert_needs_plan"
        ? { label: "Open Plans", onClick: () => setTab("plans", { historyMode: "push" }) }
        : null;
    toast(error.message || "The test alert could not be sent.", true, action ? { action } : {});
  } finally {
    state.testAlertSending = false;
    for (const button of $$('[data-delivery-lever="send_test_alert"]')) button.disabled = false;
  }
}

async function followDeliveryLever(button) {
  const code = button.dataset.deliveryLever;
  if (code === "send_test_alert") await sendTestAlert();
  else if (code === "pair_companion") await createPairingCode(true);
  else if (code === "view_plans") setTab("cart", { historyMode: "push" });
}

function openSettingsView(view) {
  setTab("setup", { historyMode: "push" });
  setSetupSection(SETUP_SECTION_FOR_VIEW[view] || view, { historyMode: "replace" });
}

// The Home status row's resume control mirrors the header: one server-supplied
// preflight decides whether it says Resume, "Resume requested", or the next step.
function homePausedActionMarkup() {
  const resume = resumePreflight();
  if (resume.presentation === "setting_up") return "";
  if (resume.pending) return ` <button class="text-button" type="button" data-resume-next-action="open_activity" data-resume-route="activity">Turn-on requested · Open History</button>`;
  if (!resume.allowed) return resume.nextAction ? ` ${resumeNextActionMarkup(resume.nextAction)}` : "";
  return ` <button class="text-button" type="button" data-home-resume-actions>Turn on Auto-cart</button>`;
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
    : "";
  // Results appear once there is one; History stays reachable from the status line.
  $("#homeRecent").hidden = items.length === 0;
}

function renderHomeSections() {
  renderCartReadyList();
  renderHomeCallLog();
  renderUpcomingDrops();
  renderHomeRecentOutcomes();
  renderCartStatusLine();
}

// The Cart tab carries a count of carts waiting for checkout; Setup gets a dot
// while a setup step or the delivery path needs the shopper.
function renderTabSignals() {
  const counts = state.overview?.actionHandoff?.counts || {};
  const waiting = Math.max(0, Number(counts.readyToCheckout || 0)) + Math.max(0, Number(counts.needsYou || 0));
  const badge = $("#cartTabCount");
  if (badge) {
    badge.hidden = waiting < 1;
    badge.textContent = waiting ? waiting.toLocaleString() : "";
    badge.setAttribute("aria-label", waiting ? `${waiting.toLocaleString()} ready to check out` : "");
  }
  const dot = $("#setupTabDot");
  if (dot) {
    const status = state.overview ? deriveUserHome(state.overview).status : "";
    const attention = status === "setup" || status === "delivery";
    dot.hidden = !attention;
    dot.setAttribute("aria-label", attention ? "Needs attention" : "");
  }
}

// One line under the Cart: when the last call came in and whether Chrome is
// picking calls up, from the server's delivery receipts only.
function renderCartStatusLine() {
  const line = $("#cartStatusLine");
  if (!line) return;
  const delivery = deliveryHealthOf(state.overview);
  if (!delivery) {
    line.textContent = "";
    return;
  }
  const receipt = (key) => delivery.receipts.find((item) => item.key === key) || null;
  const lastCall = receipt("signal");
  const callAt = String(lastCall?.at || "");
  const device = primaryDeliveryDevice(delivery);
  const parts = [
    Number.isFinite(new Date(callAt).getTime()) ? `Last call ${relative(callAt)}` : "No calls yet",
    !device ? "Chrome isn't paired"
      : device.online ? "Chrome connected"
        : `Chrome offline${device.lastSeenAt ? ` · last seen ${relative(device.lastSeenAt)}` : ""}`
  ];
  line.innerHTML = `${escapeHtml(parts.join(" · "))} <button class="text-button" type="button" data-open-settings="notifications">Details</button> <button class="text-button" type="button" data-tab="activity">History</button>`;
}

function readyActions() {
  const primaryId = String(state.overview?.actionHandoff?.primary?.id || "");
  return (Array.isArray(state.cartActions) ? state.cartActions : [])
    .filter((action) => closeableCartAction(action) && action.id !== primaryId);
}

function cartCloseoutMarkup(action) {
  if (!closeableCartAction(action)) return "";
  return `<span class="cart-closeout-buttons"><button class="button secondary" data-cart-got-it="${escapeHtml(action.id)}" type="button">Got it</button><button class="button quiet" data-cart-missed-it="${escapeHtml(action.id)}" type="button">Missed it</button></span>`;
}

// Every other cart waiting for checkout, below the newest one in the card above.
function renderCartReadyList() {
  const list = $("#cartReadyList");
  if (!list) return;
  const items = readyActions();
  const restoreListUi = captureListUi("#cartReadyList");
  list.innerHTML = items.map((action) => {
    const stage = actionStage(action);
    const store = retailerDisplayName(action.retailerId);
    const added = action.cartReadyAt || action.createdAt;
    const cart = RETAILER_CART_URLS[action.retailerId]
      ? retailerLinkMarkup(RETAILER_CART_URLS[action.retailerId], `${action.title} cart handoff`,
        stage === "needs_you" ? "Review store ↗" : `Check out at ${store} ↗`, "button primary cart-handoff-link", "",
        { jobId: action.id, destinationKind: "cart" })
      : "";
    return `<article class="ready-row" data-ui-key="${escapeHtml(action.id)}" data-action-job="${escapeHtml(action.id)}" data-store="${escapeHtml(action.retailerId || "")}" data-stage="${escapeHtml(stage)}">
      <div class="ready-row-main"><strong>${escapeHtml(action.title)}</strong><small>${escapeHtml([stage === "needs_you" ? "Needs you" : "In your cart", store, added ? relative(added) : ""].filter(Boolean).join(" · "))}</small></div>
      <div class="inline-actions">${cart}${cartCloseoutMarkup(action)}</div>
      <small class="outcome-status" data-outcome-status role="status" aria-live="polite" hidden></small>
    </article>`;
  }).join("");
  list.hidden = items.length === 0;
  restoreListUi();
}

const HOME_CALL_LOG_SIZE = 8;
// Fetch more than are shown so folded repeats still leave a full log.
const HOME_CALL_LOG_FETCH = 24;
const CALL_RESULT_TONES = Object.freeze({ good: "good", info: "info", warn: "warn", muted: "" });

function callLogSummaryText(summary) {
  const lastCall = summary?.lastCallAt ? ` · last call ${relative(summary.lastCallAt)}` : "";
  const total = Number(summary?.total || 0);
  if (!total) return summary?.lastCallAt ? `No calls in the last 24 hours${lastCall}.` : "";
  const count = (value, singular, plural = `${singular}s`) => Number(value) ? `${Number(value).toLocaleString()} ${Number(value) === 1 ? singular : plural}` : "";
  const parts = [
    count(summary.added, "added", "added"),
    count(summary.adding, "adding", "adding"),
    count(summary.needsYou, "needs you", "need you"),
    count(summary.alerts, "skipped", "skipped"),
    count(summary.notAdded, "not added", "not added"),
    count(summary.noAction, "no action", "no action")
  ].filter(Boolean);
  return `Last 24 hours: ${count(total, "call")}${parts.length ? ` · ${parts.join(" · ")}` : ""}${lastCall}${summary.truncated ? " (counting the newest 2,000)" : ""}.`;
}

function callResultReasonMarkup(result) {
  if (!result?.reason && !result?.detail) return "";
  return `<p class="call-log-reason"><strong>${escapeHtml(result.reason || result.label)}</strong>${result.detail ? `<span>${escapeHtml(result.detail)}</span>` : ""}</p>`;
}

function callFixMarkup(call, { excludeWant = false } = {}) {
  const result = call?.result || {};
  const store = retailerDisplayName(call.retailerId);
  switch (result.fix) {
    case "want_it":
    case "edit_want":
      return !excludeWant && call.listingId ? wantMarkup(call.listingId, callPlan(call), call.title) : "";
    case "store_setup":
      return call.retailerId ? `<button class="button quiet" data-store-setup="${escapeHtml(call.retailerId)}" type="button">Set up ${escapeHtml(store)}</button>` : "";
    case "resume_actions":
      return '<button class="button quiet" data-home-resume-actions type="button">Turn on Auto-cart</button>';
    case "open_cart":
      return RETAILER_CART_URLS[call.retailerId]
        ? retailerLinkMarkup(RETAILER_CART_URLS[call.retailerId], `${call.title} cart handoff`, "Open cart ↗", "button primary cart-handoff-link", "", { jobId: call.actionJobId, destinationKind: "cart" })
        : "";
    case "spending_limits":
      return '<button class="button quiet" data-open-settings="purchase" type="button">Spending limits</button>';
    case "link_product":
      return call.discord?.linkable !== false && call.discord ? `<button class="button quiet" data-discord-link="${escapeHtml(String(call.id || "").replace(/^signal:/, ""))}" type="button">Link product</button>` : "";
    default:
      return "";
  }
}

function callLogRowMarkup(call, repeats = 1) {
  const result = call.result || { label: "Received", reason: "", detail: "", tone: "muted" };
  const title = call.title || `${retailerDisplayName(call.retailerId)} product`;
  const reason = result.reason && result.reason !== result.label ? result.reason : "";
  const meta = [
    call.discord ? `Discord ${call.discord.channel || ""}`.trim() : "",
    retailerDisplayName(call.retailerId),
    call.unitPriceCents ? money(call.unitPriceCents, call.currency) : "",
    relative(call.receivedAt || call.occurredAt),
    repeats > 1 ? `${repeats.toLocaleString()} calls` : ""
  ].filter(Boolean).join(" · ");
  const actions = [
    callFixMarkup(call),
    call.canonicalUrl ? retailerLinkMarkup(call.canonicalUrl, title, "Store page ↗", "button quiet") : ""
  ].join("");
  return `<article class="call-log-row" data-ui-key="${escapeHtml(call.id)}" data-result="${escapeHtml(result.kind || "")}" data-store="${escapeHtml(call.retailerId || "")}">
    <span class="tag ${CALL_RESULT_TONES[result.tone] ?? ""}">${escapeHtml(result.label)}</span>
    <div class="call-log-main"><strong>${escapeHtml(title)}</strong><small>${reason ? `<b class="call-reason-inline">${escapeHtml(reason)}</b> · ` : ""}${escapeHtml(meta)}</small>${result.detail || call.discord ? `<details class="call-log-why"><summary>Why</summary>${result.detail ? `<p>${escapeHtml(result.detail)}</p>` : ""}${call.discord ? discordTraceMarkup(call) : ""}</details>` : ""}</div>
    ${actions.trim() ? `<div class="call-log-actions">${actions}</div>` : ""}
  </article>`;
}

// Stores often re-send the same restock minutes apart. Back-to-back calls for
// the same item with the same result read as one row with a count.
function groupedCallRows(calls) {
  const rows = [];
  for (const call of calls) {
    const previous = rows.at(-1);
    const key = [call.listingId || call.title, call.result?.label, call.result?.reason].join("|");
    if (previous && previous.key === key) previous.repeats += 1;
    else rows.push({ key, call, repeats: 1 });
  }
  return rows;
}

function renderHomeCallLog() {
  const list = $("#homeCallList");
  if (!list) return;
  const calls = (Array.isArray(state.homeCalls) ? state.homeCalls : []).slice(0, HOME_CALL_LOG_FETCH);
  const rows = groupedCallRows(calls).slice(0, HOME_CALL_LOG_SIZE);
  $("#homeCallSummary").textContent = callLogSummaryText(state.homeCallSummary);
  const restoreListUi = captureListUi("#homeCallList");
  list.innerHTML = rows.length
    ? rows.map((row) => callLogRowMarkup(row.call, row.repeats)).join("")
    : '<div class="home-summary-empty">No calls yet. When TrackaLacker sends one, it shows here with what Yoink did and why.</div>';
  restoreListUi();
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
  if (safeHref(actor.signOutUrl)) signOut.href = safeHref(actor.signOutUrl);
}

function resumeBlockedByStoreChecks(overview) {
  const lanes = overview?.guardedAddLanes;
  if (!lanes || typeof lanes !== "object") return false;
  return !Object.values(lanes).some((ready) => ready === true);
}

// The server's resume preflight is the one source for "can actions resume,
// why not, and what is the next step". When an older API omits it, the
// dashboard falls back to the store-check map with the same words.
const RESUME_BLOCKED_FALLBACK = "Turn on a store in Setup before turning on Auto-cart.";
function resumePreflight(overview = state.overview) {
  const resume = overview?.settings?.resume;
  if (resume && typeof resume === "object") return resume;
  const paused = overview?.settings?.actionsPaused === true;
  const blocked = paused && resumeBlockedByStoreChecks(overview);
  return {
    paused,
    pauseReason: String(overview?.settings?.pauseReason || ""),
    pausedAt: "",
    pausedBy: "shopper",
    pausedByLabel: "",
    allowed: paused && !blocked,
    blockers: blocked ? [{ code: "no_store_ready", message: RESUME_BLOCKED_FALLBACK, nextAction: { kind: "open_stores", label: "Open Setup", route: "stores" } }] : [],
    nextAction: blocked ? { kind: "open_stores", label: "Open Setup", route: "stores" } : null,
    pending: null,
    summary: [],
    confirmation: { title: "Turn on Auto-cart?", summary: "Yoink may add one item to a cart when a call matches something you want.", confirmLabel: "Turn on Auto-cart" },
    presentation: !paused ? (overview?.settings?.executionMode === "live" ? "running" : "test_mode")
      : Number(overview?.counts?.purchaseIntents || 0) === 0 ? "setting_up" : "paused",
    presentationLabel: !paused ? (overview?.settings?.executionMode === "live" ? "Running" : "Test mode")
      : Number(overview?.counts?.purchaseIntents || 0) === 0 ? "Setting up" : "Paused"
  };
}

function resumeNextActionMarkup(nextAction, className = "text-button") {
  if (!nextAction?.kind) return "";
  return `<button class="${className}" type="button" data-resume-next-action="${escapeHtml(nextAction.kind)}" data-resume-retailer="${escapeHtml(nextAction.retailerId || "")}" data-resume-route="${escapeHtml(nextAction.route || "")}">${escapeHtml(nextAction.label || "Next step")}</button>`;
}

async function followResumeNextAction(button) {
  const kind = String(button?.dataset?.resumeNextAction || "");
  const retailerId = String(button?.dataset?.resumeRetailer || "");
  if (kind === "store_setup" && retailerId && isGuardedStore(retailerId)) {
    await openStoreSetup(retailerId, null, button);
    return;
  }
  // Server next steps still name the seven-tab routes; send each one to the
  // place that holds it now.
  const route = String(button?.dataset?.resumeRoute || "stores").split("/")[0] || "stores";
  if (route === "activity") setTab("activity", { historyMode: "push" });
  else if (["stores", "settings", "preferences"].includes(route)) {
    setTab("setup", { historyMode: "push" });
    setSetupSection(route === "stores" ? "stores" : "", { historyMode: "replace" });
  } else setTab(route === "products" ? "find" : "cart", { historyMode: "push" });
}

function pausedSinceCopy(resume) {
  if (!resume?.paused) return "";
  const who = resume.pausedByLabel ? `Turned off by ${resume.pausedByLabel}` : "Off";
  const when = resume.pausedAt ? ` ${relative(resume.pausedAt)}` : "";
  // Stored reasons end with a full stop of their own.
  const reason = String(resume.pauseReason || "").trim().replace(/\.+$/, "");
  return `${who}${when}${reason ? ` · ${reason}` : ""}. Calls are still logged.`;
}

function setAutoCartSwitch({ on = false, label, stateName, title = "" }) {
  const toggle = $("#pauseButton");
  const modePill = $("#modePill");
  toggle.setAttribute("aria-checked", String(on));
  toggle.dataset.state = stateName;
  toggle.title = title;
  modePill.textContent = label;
  modePill.dataset.mobileLabel = label;
  modePill.dataset.mobileState = stateName;
}

function renderOfflineHeader() {
  setAutoCartSwitch({ on: false, label: "Offline", stateName: "offline" });
  const pauseButton = $("#pauseButton");
  pauseButton.disabled = true;
  pauseButton.setAttribute("aria-label", "Auto-cart: Yoink is offline");
  const pauseReason = $("#pauseReason");
  pauseReason.innerHTML = `Yoink could not be reached. <button class="text-button" type="button" data-retry-route="cart">Retry</button>`;
  pauseReason.hidden = false;
}

// The header's one switch: Auto-cart on means Yoink may add wanted items to a
// cart at stores that are on; off means calls only alert. Turning it on still
// confirms with the server's own summary of what goes live.
function renderOverview() {
  const { settings, permissions, spend } = state.overview;
  const paused = settings.actionsPaused === true;
  const resume = resumePreflight();
  const pauseButton = $("#pauseButton");
  const settingUp = resume.presentation === "setting_up";
  const approvalPending = resume.presentation === "approval_pending" || Boolean(resume.pending);
  const blocker = paused ? resume.blockers?.[0] || null : null;
  const resumeBlocked = paused && !resume.allowed;
  const testMode = !paused && settings.executionMode !== "live";
  setAutoCartSwitch(approvalPending
    ? { on: false, label: "Requested", stateName: "pending", title: "Turning Auto-cart on is waiting for approval." }
    : paused
      ? { on: false, label: "Off", stateName: "off", title: resumeBlocked ? String(blocker?.message || RESUME_BLOCKED_FALLBACK) : pausedSinceCopy(resume) }
      : testMode
        ? { on: true, label: "Test", stateName: "test", title: "Yoink only checks calls until a store is on." }
        : { on: true, label: "On", stateName: "on" });
  pauseButton.setAttribute("aria-label", approvalPending ? "Auto-cart: turn-on requested"
    : paused ? "Auto-cart is off" : testMode ? "Auto-cart is in test mode" : "Auto-cart is on");
  pauseButton.hidden = settingUp;
  pauseButton.disabled = resumeBlocked || approvalPending;
  const pauseReason = $("#pauseReason");
  if (settingUp) {
    pauseReason.textContent = "";
  } else if (approvalPending) {
    pauseReason.innerHTML = `${escapeHtml(blocker?.message || "Turning Auto-cart on is waiting for approval.")} ${resumeNextActionMarkup(blocker?.nextAction || { kind: "open_activity", label: "Open History", route: "activity" })}`;
  } else if (resumeBlocked) {
    pauseReason.innerHTML = `${escapeHtml(blocker?.message || RESUME_BLOCKED_FALLBACK)} ${resumeNextActionMarkup(blocker?.nextAction || resume.nextAction)}`;
  } else {
    pauseReason.textContent = "";
  }
  pauseReason.hidden = !pauseReason.textContent;
  renderUserAccount(permissions || []);
  renderHomePriority();
  renderDeliveryCard();
  if (state.devices.length) renderPairedDevices();
  renderUpcomingDrops();
  renderCartStatusLine();
  const companionLink = $("#companionDownloadLink");
  const configuredCompanionUrl = state.overview?.setup?.companion?.downloadUrl;
  const companionUrl = safeHref(configuredCompanionUrl === undefined
    ? "/api/v1/extension/release/download"
    : configuredCompanionUrl);
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
  $("#releaseAnnouncementLink").href = safeHref(announcement.docsUrl) || "/docs";
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
  // What the caps leave today and this month, now that Home's Limits cards and
  // Insights' headroom metrics are gone.
  const left = (available, cap, period) => cap !== null && cap !== undefined && Number.isFinite(Number(available))
    ? `${money(Math.max(0, Number(available)))} of ${money(cap)} left ${period}` : "";
  $("#spendSummary").textContent = `${[
    `${money(spend.activeReservedCents)} reserved`,
    `${money(spend.spentTodayCents)} spent today`,
    left(spend.availableTodayCents, spend.policy?.dailyCapCents, "today"),
    left(spend.availableThisMonthCents, spend.policy?.monthlyCapCents, "this month")
  ].filter(Boolean).join(" · ")}.`;
  const form = $("#spendForm");
  const selectedTimezone = spend.policy.timezone || browserTimezone();
  if (form.dataset.dirty === "true" || form.contains(document.activeElement)) {
    const changed = Number(form.elements.revision.value) !== Number(spend.policy.revision);
    let notice = $("#spendDraftStatus");
    if (!notice) {
      notice = document.createElement("p");
      notice.id = "spendDraftStatus";
      notice.className = "boundary-note";
      notice.setAttribute("role", "status");
      form.append(notice);
    }
    notice.innerHTML = changed
      ? 'Saved limits changed elsewhere. Your draft is kept. Review the saved limits before saving again. <button class="button quiet" id="reloadSpendPolicy" type="button">Load saved limits</button>'
      : "Unsaved limits are kept while this page updates.";
    notice.hidden = false;
    return;
  }
  $("#spendDraftStatus")?.setAttribute("hidden", "");
  populateTimezoneSelect(form.elements.timezone, selectedTimezone);
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

// This is a display age only. Action qualification still uses fresh Chrome
// evidence and the plan's existing limits.
// A report shows its status until it has missed a refresh: TrackaLacker stock
// refreshes hourly since 1.30.22, so "stale" after 2 hours (Kevin, 2026-10-09:
// it said stale right after a check). Only a report from the last 5 minutes
// counts as available (green, sorted first), since hot items sell out fast.
const STOCK_AVAILABLE_FOR_MS = 5 * 60_000;
const STOCK_STALE_AFTER_MS = 2 * 60 * 60_000;
function listingStockEvidence(listing, now = Date.now()) {
  const observedAt = String(listing?.availabilityObservedAt || "");
  const time = Date.parse(observedAt);
  const age = now - time;
  const status = String(listing?.observedAvailability || "unknown");
  const known = ["in_stock", "preorder", "out_of_stock"].includes(status);
  const validTime = Number.isFinite(time) && age >= 0;
  const freshness = !validTime || !known ? "unknown"
    : age >= STOCK_STALE_AFTER_MS ? "stale" : age >= STOCK_AVAILABLE_FOR_MS ? "aging" : "recent";
  // Chrome saw another seller's offer on the store's page: the store itself isn't selling it.
  const otherSeller = listing?.availabilitySellerType === "third_party" && ["in_stock", "preorder"].includes(status);
  const label = freshness === "unknown" ? "Stock unknown"
    : freshness === "stale" ? "Stock info stale"
    : otherSeller ? "Only another seller has it"
    : status === "in_stock" ? "Reported in stock"
    : status === "preorder" ? "Reported preorder" : "Reported sold out";
  return { freshness, label, status, observedAt,
    available: !otherSeller && freshness === "recent" && ["in_stock", "preorder"].includes(status) && listingAvailable(listing) };
}

function observationSourceLabel(source) {
  return { trackalacker: "TrackaLacker", browser: "Chrome companion", discord: "Discord", api: "API source" }[source] || "Recorded update";
}

function observationTimeLabel(value) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time) || time > Date.now()) return "Time unknown";
  const age = Date.now() - time;
  if (age < 60_000) return "Just now";
  const days = Math.floor(age / 86_400_000);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ago`;
  const hours = Math.floor(age / 3_600_000);
  return hours > 0 ? `${hours} hr ago` : `${Math.floor(age / 60_000)} min ago`;
}

function observationTimeMarkup(value) {
  const date = new Date(String(value || ""));
  const timestamp = Number.isFinite(date.getTime()) ? date.toISOString() : "";
  return `<time data-observation-time="${escapeHtml(timestamp)}" ${timestamp ? `datetime="${escapeHtml(timestamp)}" title="${escapeHtml(date.toLocaleString())}"` : ""}>${escapeHtml(observationTimeLabel(timestamp))}</time>`;
}

function stockStatusMarkup(listing, className = "") {
  const evidence = listingStockEvidence(listing);
  return `<strong class="${className ? `${className} ` : ""}${evidence.available ? "good" : "warn"}" data-stock-status data-observed-availability="${escapeHtml(evidence.status)}" data-availability-observed-at="${escapeHtml(evidence.observedAt)}" data-purchasable="${listingAvailable(listing)}" data-freshness="${evidence.freshness}">${evidence.label}</strong>`;
}

function stockObservationMarkup(listing) {
  if (!listing?.availabilityObservedAt) return "No stock update recorded";
  const status = labelFor(AVAILABILITY_LABELS, listing.observedAvailability || "unknown");
  return `Last report: ${escapeHtml(status.toLowerCase())} · ${observationTimeMarkup(listing.availabilityObservedAt)} · ${escapeHtml(observationSourceLabel(listing.availabilitySource))}`;
}

function priceObservationMarkup(listing) {
  return `Price seen ${observationTimeMarkup(listing?.priceObservedAt)} · ${escapeHtml(observationSourceLabel(listing?.priceSource))}`;
}

function msrpReferenceMarkup(listing) {
  const reference = listing?.msrpReference;
  if (!reference) return listing?.msrpCents ? `<small>Catalog MSRP (unverified) ${escapeHtml(money(listing.msrpCents, listing.currency))}</small>` : "<small>MSRP unavailable</small>";
  const label = reference.kind === "approximate_msrp" ? "Estimated MSRP" : "Reported MSRP";
  let sourceLink = "TrackaLacker History";
  try {
    const url = new URL(reference.sourceUrl);
    if (url.protocol === "https:" && !url.username && !url.password && ["trackalacker.com", "www.trackalacker.com"].includes(url.hostname)) {
      sourceLink = `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">TrackaLacker History ↗</a>`;
    }
  } catch { /* A reference remains readable even if its source URL is unavailable. */ }
  return `<small>${label} ${escapeHtml(money(reference.priceCents, reference.currency))} · ${escapeHtml(reference.label)}</small><small>${sourceLink} · ${escapeHtml(reference.reportedAt)} ${escapeHtml(reference.timeZone || "source local time")} · ${Number(reference.sampleCount)} matching reports</small>`;
}

function updateProductEvidenceTimes() {
  for (const time of $$('[data-observation-time]')) time.textContent = observationTimeLabel(time.dataset.observationTime);
  for (const status of $$('[data-stock-status]')) {
    const evidence = listingStockEvidence({ ...status.dataset, purchasable: status.dataset.purchasable === "true" });
    status.textContent = evidence.label;
    status.dataset.freshness = evidence.freshness;
    status.classList.toggle("good", evidence.available);
    status.classList.toggle("warn", !evidence.available);
  }
}

// Ranks a product's listings for the card and the default store choice. A store's
// primary offer always outranks its alternates (marketplace sellers, pack variations)
// so resale listings never drive the product's price or stock line.
// The offer a product card shows (Kevin, 2026-10-09: "pricing > availability"):
// a store's own offer first, then the cheapest price, then stock. With In stock
// only on, a store that has it comes before price.
function bestListing(group) {
  const inStockOnly = state.browse.availability === "in_stock";
  return [...(group.listings || [])].sort((first, second) => {
    const role = Number(first.offerRole === "alternate") - Number(second.offerRole === "alternate");
    if (role !== 0) return role;
    if (inStockOnly) {
      const stocked = Number(first.status !== "in_stock") - Number(second.status !== "in_stock");
      if (stocked !== 0) return stocked;
    }
    const firstPrice = listingEffectivePrice(first)?.cents;
    const secondPrice = listingEffectivePrice(second)?.cents;
    if (firstPrice !== secondPrice) {
      if (firstPrice === undefined) return 1;
      if (secondPrice === undefined) return -1;
      return firstPrice - secondPrice;
    }
    const freshnessRank = (listing) => {
      const evidence = listingStockEvidence(listing);
      return evidence.available ? 0 : ["recent", "aging", "stale", "unknown"].indexOf(evidence.freshness) + 1;
    };
    const freshness = freshnessRank(first) - freshnessRank(second);
    if (freshness !== 0) return freshness;
    const availability = Number(!listingAvailable(first)) - Number(!listingAvailable(second));
    if (availability !== 0) return availability;
    const lane = Number(!(first.executionSupported && guardedLaneReady(first.retailerId)))
      - Number(!(second.executionSupported && guardedLaneReady(second.retailerId)));
    return lane;
  })[0];
}

// Find › In stock only (Kevin, 2026-10-09): remembered on this browser.
const IN_STOCK_ONLY_KEY = "yoinkFindInStockOnly";
function rememberedInStockOnly() {
  try { return localStorage.getItem(IN_STOCK_ONLY_KEY) === "1"; } catch { return false; }
}
function rememberInStockOnly(on) {
  try { localStorage.setItem(IN_STOCK_ONLY_KEY, on ? "1" : "0"); } catch { /* not remembered */ }
}

function renderStoreFilterOptions() {
  const select = $("#browseStore");
  if (!select) return;
  const stores = Array.isArray(state.productStores) ? state.productStores : [];
  select.innerHTML = ['<option value="">All stores</option>', ...stores
    .map((store) => `<option value="${escapeHtml(store.retailerId)}">${escapeHtml(store.retailerName)} · ${Number(store.productCount || 0).toLocaleString()}</option>`)].join("");
  select.value = stores.some((store) => store.retailerId === state.browse.store) ? state.browse.store : "";
}

// Background polls and the drop clock re-render whole lists. Without this a
// keyboard or screen-reader user has focus thrown back to <body> and open
// <details> collapse mid-interaction. Cards carry data-ui-key; capture which
// card/control had focus (and the quick-add menu's trigger) before the render
// and point them at the rebuilt equivalents afterwards. renderPlans keeps its
// own older copy of this pattern.
function captureListUi(listSelector) {
  const list = $(listSelector);
  if (!list) return () => undefined;
  const describe = (element) => {
    const card = element && list.contains(element) ? element.closest("[data-ui-key]") : null;
    if (!card || card === element) return null;
    const attribute = element.id ? "id" : element.getAttributeNames?.().find((name) => name.startsWith("data-"));
    const controls = [...card.querySelectorAll("button,input,select,textarea,a,summary")];
    return { key: card.dataset.uiKey, attribute, value: attribute ? element.getAttribute(attribute) : null, tag: element.tagName, index: controls.indexOf(element) };
  };
  const locate = (descriptor) => {
    if (!descriptor) return null;
    const card = [...list.querySelectorAll("[data-ui-key]")].find((node) => node.dataset.uiKey === descriptor.key);
    if (!card) return null;
    const controls = [...card.querySelectorAll("button,input,select,textarea,a,summary")];
    const matches = descriptor.attribute ? controls.filter((element) => element.tagName === descriptor.tag && element.getAttribute(descriptor.attribute) === descriptor.value) : [];
    return (matches.length === 1 ? matches[0] : matches.includes(controls[descriptor.index]) ? controls[descriptor.index] : null)
      || (controls[descriptor.index]?.tagName === descriptor.tag ? controls[descriptor.index] : null);
  };
  const expanded = new Map([...list.querySelectorAll("[data-ui-key]")]
    .map((card) => [card.dataset.uiKey, [...card.querySelectorAll("details")].map((detail) => detail.open)]));
  const focused = describe(document.activeElement);
  return () => {
    for (const card of list.querySelectorAll("[data-ui-key]")) {
      const open = expanded.get(card.dataset.uiKey);
      if (open) [...card.querySelectorAll("details")].forEach((detail, index) => { detail.open = open[index] === true; });
    }
    if (focused && (document.activeElement === document.body || !document.activeElement?.isConnected)) {
      locate(focused)?.focus({ preventScroll: true });
    }
  };
}

// Find's quick filters: one tap each, mirrored by the selects under More filters.
function findChipList() {
  const stores = (Array.isArray(state.productStores) ? state.productStores : [])
    .filter((store) => Number(store.productCount || 0) > 0)
    .sort((first, second) => Number(second.productCount || 0) - Number(first.productCount || 0))
    .slice(0, 6);
  return [
    { key: "plan", value: "planned", label: "Wanted" },
    ...stores.map((store) => ({ key: "store", value: store.retailerId, label: store.retailerName })),
    ...POPULAR_SHOP_CATEGORIES.map((category) => ({ key: "category", value: category.id, label: category.label }))
  ];
}

function renderFindChips() {
  const host = $("#findChips");
  if (!host) return;
  host.innerHTML = findChipList().map((chip) => {
    const active = state.browse[chip.key] === chip.value;
    return `<button class="chip-button" data-find-chip="${escapeHtml(chip.key)}" data-find-value="${escapeHtml(chip.value)}" data-store="${chip.key === "store" ? escapeHtml(chip.value) : ""}" type="button" aria-pressed="${active}">${escapeHtml(chip.label)}</button>`;
  }).join("");
}

function renderProducts() {
  const missionByVariant = new Map(state.plans.map((plan) => [plan.variantId, plan]));
  const productList = $("#productList");
  renderStoreFilterOptions();
  renderFindChips();
  $("#inStockOnly").checked = state.browse.availability === "in_stock";
  renderProductReviewStatus();
  const groups = state.productGroups;
  const filtering = Boolean(state.query || state.browse.store || state.browse.availability || state.browse.plan || state.browse.price || state.browse.category);
  $("#browseCount").textContent = `${state.productTotal.toLocaleString()} product${state.productTotal === 1 ? "" : "s"}`;
  $("#loadMoreProducts").hidden = state.productGroups.length >= state.productTotal;
  if (!groups.length && filtering) {
    productList.innerHTML = '<div class="empty"><p>No products match the current search or filters.</p><button class="button secondary" data-clear-browse type="button">Clear search and filters</button></div>';
    return;
  }
  if (!groups.length) {
    productList.innerHTML = '<div class="empty"><p>No approved products match. Add a supported store product page for review.</p><button class="button secondary" data-open-product-link type="button">Add product link</button></div>';
    return;
  }
  const restoreListUi = captureListUi("#productList");
  productList.innerHTML = groups.map((group, index) => productCardMarkup(group, missionByVariant, { eagerImage: index < 6 })).join("");
  restoreListUi();
}

function renderProductReviewStatus() {
  const panel = $("#productReviewStatus");
  const proposals = (state.proposals || [])
    .filter((proposal) => ["pending", "approved", "rejected"].includes(String(proposal.status))
      && !state.dismissedProposalIds.has(proposal.id))
    .sort((first, second) => new Date(second.updatedAt || second.createdAt || 0).getTime()
      - new Date(first.updatedAt || first.createdAt || 0).getTime())
    .slice(0, 5);
  panel.hidden = (state.proposalTotal ?? state.proposals.length) < 1;
  if (!proposals.length) {
    $("#productReviewList").innerHTML = "";
    return;
  }
  $("#productReviewList").innerHTML = proposals.map((proposal) => {
    const approved = proposal.status === "approved";
    const rejected = proposal.status === "rejected";
    const title = proposal.payload?.title || `${retailerDisplayName(proposal.retailerId)} product`;
    const group = approved ? state.productGroups.find((candidate) => (candidate.listings || []).some((listing) =>
      listing.listingId === proposal.appliedListingId
        || (listing.retailerId === proposal.retailerId && listing.retailerSku === proposal.retailerSku))) : null;
    const titleMarkup = group
      ? `<button class="title-link" data-product-detail="${escapeHtml(group.variantId)}" type="button">${escapeHtml(title)}</button>`
      : `<strong>${escapeHtml(title)}</strong>`;
    const status = approved ? "Approved" : rejected ? "Rejected" : "In review";
    const note = rejected && proposal.reviewNote
      ? `<small><strong>Review note:</strong> ${escapeHtml(proposal.reviewNote)}</small>`
      : "";
    const actions = rejected
      ? `<span class="inline-actions"><button class="button quiet" data-correct-proposal="${escapeHtml(proposal.id)}" type="button">Correct and resubmit</button><button class="button quiet" data-dismiss-proposal="${escapeHtml(proposal.id)}" type="button" aria-label="Dismiss rejected product suggestion">Dismiss</button></span>`
      : `<span class="tag ${approved ? "good" : "warn"}">${status}</span>`;
    return `<div class="mini-row" data-product-review="${escapeHtml(proposal.id)}"><span>${titleMarkup}<small>${escapeHtml(retailerDisplayName(proposal.retailerId))} · ${escapeHtml(proposal.retailerSku || proposal.payload?.retailerSku || "Item")}${approved ? " · Available in Find" : ""}</small>${note}</span>${actions}</div>`;
  }).join("");
}

// Shared card media. Keep failed URLs quiet during background refreshes, then
// allow a later render to retry. No alternate product image is ever guessed.
const failedProductImages = new Map();
function mediaMarkup(group, { eager = false } = {}) {
  const safeImageUrl = safeHref(group.imageUrl);
  const imageUrl = safeImageUrl ? new URL(safeImageUrl, location.href).href : "";
  const failed = (failedProductImages.get(imageUrl) || 0) > Date.now();
  const image = imageUrl && !failed
    ? `<img data-product-image src="${escapeHtml(imageUrl)}" alt="" loading="${eager ? "eager" : "lazy"}" decoding="async" referrerpolicy="no-referrer">`
    : "";
  return `<div class="card-media" aria-hidden="true"${image ? ' data-image-pending' : ""}><span class="media-fallback">${image ? "Loading image…" : failed ? "Image could not load" : "Image unavailable"}</span>${image}</div>`;
}

function productImageSettled(image, failed) {
  if (!image.matches?.("[data-product-image]")) return;
  const media = image.closest(".card-media");
  if (!media) return;
  media.removeAttribute("data-image-pending");
  if (failed) {
    if (failedProductImages.size >= 256) failedProductImages.delete(failedProductImages.keys().next().value);
    failedProductImages.set(image.src, Date.now() + 5 * 60_000);
    media.querySelector(".media-fallback").textContent = "Image could not load";
    image.remove();
  } else {
    media.querySelector(".media-fallback").hidden = true;
  }
}
document.addEventListener("error", (event) => productImageSettled(event.target, true), true);
document.addEventListener("load", (event) => productImageSettled(event.target, false), true);

function productCardLink(listing, group, content, className) {
  const link = retailerLinkMarkup(listing?.canonicalUrl, group.title, "", className, listing?.listingId || "");
  if (!link) return content;
  // Only locally generated, escaped markup is passed as content.
  return link.replace(' data-store-link', () => ` aria-label="${escapeHtml(`${group.title} at ${listing.retailerName || "store"} (opens in a new tab)`)}" data-store-link`)
    .replace("></a>", () => `>${content}</a>`);
}

// The Yoink mark (Kevin, 2026-10-09): a script check mark with a stem drawn
// down from its point, so it reads as a Y. The header, favicon, companion and
// tray icons draw the same two strokes in the same 64-unit box.
const YOINK_MARK_CHECK = "M15 26c4.5 2 8.5 6.5 12.5 13 5-11.5 12.5-21.5 22.5-29";
const YOINK_MARK_STEM = "M27.5 39c0 6.5-.5 11.5-1.9 16";
function yoinkMarkSvg() {
  return `<svg class="yoink-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path class="yoink-mark-check" d="${YOINK_MARK_CHECK}" pathLength="1"></path><path class="yoink-mark-stem" d="${YOINK_MARK_STEM}" pathLength="1"></path></svg>`;
}

// A wanted item's Want it button becomes Yoink. Right after Want it is saved,
// that item's button draws the mark once: the check, then the stem.
function yoinkButtonMarkup(attributes, label, plan) {
  const drawing = plan?.id && plan.id === state.justYoinked ? " yoink-draw" : "";
  return `<button class="button secondary yoinked${drawing}" ${attributes} type="button" aria-label="${escapeHtml(label)}">${yoinkMarkSvg()}<span>Yoink</span></button>`;
}

document.addEventListener("animationend", (event) => {
  if (!event.target?.classList?.contains("yoink-mark-stem")) return;
  // Drawn once: later renders show the finished mark.
  event.target.closest(".yoink-draw")?.classList.remove("yoink-draw");
  state.justYoinked = "";
});

function cardWantMarkup(listingId, plan, title, modeOverride) {
  const wanted = shopperWants(plan);
  if (!listingId && plan?.id) {
    return wanted
      ? yoinkButtonMarkup(`data-edit-plan="${escapeHtml(plan.id)}"`, `Yoink: ${title} — review saved choices`, plan)
      : `<button class="button primary" data-edit-plan="${escapeHtml(plan.id)}" type="button" aria-label="${escapeHtml(`Want it: ${title} — review saved choices`)}">Want it</button>`;
  }
  if (!listingId) return '<button class="button primary" type="button" disabled title="No supported store listing is available">Want it</button>';
  const mode = modeOverride ?? (wanted ? plan.actionCeiling === "add_to_cart" ? "add_to_cart" : "notify" : "");
  const modeAttribute = mode || modeOverride !== undefined ? ` data-want-mode="${escapeHtml(mode)}"` : "";
  if (wanted) return yoinkButtonMarkup(`data-want-listing="${escapeHtml(listingId)}"${modeAttribute}`, `Yoink: ${title} — edit saved choices`, plan);
  return `<button class="button primary" data-want-listing="${escapeHtml(listingId)}"${modeAttribute} type="button" aria-label="${escapeHtml(`Want it: ${title}`)}">Want it</button>`;
}

function compactProductCardMarkup({ group, listing, plan, wantListingId = listing?.listingId, wantMode, key, storeSummary, note = "", extraActions = "", attributes = "", eagerImage = false }) {
  const price = listingEffectivePrice(listing || {});
  const priceValue = price ? money(price.cents, listing?.currency || group.currency) : "—";
  const priceContext = price ? price.kind === "catalog" ? "Catalog price" : `Last price at ${listing?.retailerName || "store"}` : "Price unavailable";
  const stockWord = listing?.availabilitySellerType === "third_party" && listing.observedAvailability !== "out_of_stock"
    ? "only another seller has it" : labelFor(AVAILABILITY_LABELS, listing?.observedAvailability || "unknown").toLowerCase();
  const checked = listing?.availabilityObservedAt
    ? `${listing.availabilitySource === "browser" ? "Checked" : "Reported"} ${observationTimeMarkup(listing.availabilityObservedAt)} · ${escapeHtml(stockWord)} · ${escapeHtml(observationSourceLabel(listing.availabilitySource))}`
    : "No stock check recorded";
  const exactVariant = variantSummary(group.variantAttributes);
  // Find summaries carry the saved mode without a readiness evaluation.
  const planStatus = plan?.status === "active" && plan.actionCeiling === "add_to_cart" && !plan.automationReadiness && state.overview?.settings?.actionsPaused !== true
    ? "Add to cart" : plan ? wantedStatus(plan).label : "";
  const savedMode = plan && plan.status !== "active" ? ` · ${plan.actionCeiling === "add_to_cart" ? "Adds to cart" : "Alerts"}` : "";
  const planLine = plan ? `${escapeHtml(planStatus)}${savedMode}${Number(plan.targetQuantity || 1) > 1 ? ` · ${Number(plan.targetQuantity)} wanted` : ""}${String(plan.origin || "").startsWith("signal:") ? " · Added by a call" : ""}${plan.origin === "collection_want" ? " · From its All New entry" : ""}` : "";
  const cap = plan?.maxUnitPriceCents ?? plan?.primaryMaxUnitPriceCents;
  return `<article class="product-card product-group compact-product-card" data-ui-key="${escapeHtml(key)}" data-store="${escapeHtml(listing?.retailerId || "")}" ${attributes}>
    ${productCardLink(listing, group, mediaMarkup(group, { eager: eagerImage }), "product-image-link")}
    <h3 title="${escapeHtml(group.title)}">${productCardLink(listing, group, escapeHtml(group.title), "product-title-link")}</h3>
    <div class="card-metadata">
      <p class="product-offer-summary"><span title="${escapeHtml(storeSummary)}">${escapeHtml(storeSummary)}</span>${stockStatusMarkup(listing)}</p>
      <p class="product-observation">${checked}</p>
    </div>
    <div class="card-plan-state">${planLine ? `<span title="${escapeHtml(plan?.automationReadiness?.headline || "")}">${planLine}</span>` : ""}${exactVariant ? `<small class="product-variant" title="${escapeHtml(exactVariant)}">${escapeHtml(exactVariant)}</small>` : ""}${note ? `<small class="wanted-note">${escapeHtml(note)}</small>` : ""}</div>
    <div class="product-price"><strong>${escapeHtml(priceValue)}</strong><small>${escapeHtml(priceContext)}${cap ? `<br>Your limit ${escapeHtml(money(cap))}` : plan ? "<br>No price limit" : ""}</small></div>
    <div class="card-actions">${cardWantMarkup(wantListingId, plan, group.title, wantMode)}<button class="button quiet" data-product-detail="${escapeHtml(group.variantId)}" type="button" aria-label="${escapeHtml(`Details: ${group.title}`)}">Details</button>${extraActions}</div>
  </article>`;
}

// "Want it" is the one way to tell Yoink what to do with a product. A plan a
// call created by itself only watches, so it still offers Want it.
function shopperWants(plan) {
  if (!plan || !["active", "paused", "satisfied"].includes(String(plan.status || ""))) return false;
  return plan.actionCeiling === "add_to_cart" || !String(plan.origin || "").startsWith("signal:");
}

function wantStateLabel(plan) {
  // A cart item at Amazon, Target, Walmart or Best Buy waits for its MSRP; Edit opens Want it to confirm it.
  const quantity = Number(plan.targetQuantity) > 1 ? ` ${Number(plan.targetQuantity)}` : "";
  const mode = plan.actionCeiling !== "add_to_cart" ? "Alerts"
    : plan.automationReadiness?.state === "guarded_add_policy_incomplete" ? `Add${quantity} to cart · needs a price limit` : `Add${quantity} to cart`;
  // A test call's short-lived plan (Setup › Stores › Test call) says so until it is removed.
  if (plan.origin === "test_call") return `Test call · ${mode}`;
  const max = Number(plan.maxUnitPriceCents ?? plan.primaryMaxUnitPriceCents);
  const price = Number.isFinite(max) && max > 0 ? ` · up to ${money(max)}` : "";
  return `${plan.status === "paused" ? "Paused · " : ""}${mode}${price}`;
}

function wantMarkup(listingId, plan, title = "") {
  if (!listingId) return "";
  const named = title ? ` for ${title}` : "";
  if (shopperWants(plan)) {
    return `<span class="want-state${plan.status === "paused" ? " paused" : ""}">${escapeHtml(wantStateLabel(plan))}</span>${yoinkButtonMarkup(
      `data-want-listing="${escapeHtml(listingId)}" data-want-mode="${plan.actionCeiling === "add_to_cart" ? "add_to_cart" : "notify"}"`, `Yoink: edit what Yoink does${named}`, plan)}`;
  }
  return `<button class="button primary" data-want-listing="${escapeHtml(listingId)}" type="button" aria-label="${escapeHtml(`Want it${named}`)}">Want it</button>`;
}

// An "All New …" entry (Kevin, 2026-10-09): its card wants every item, now
// and as new ones appear, each at Yoink's suggested price.
function collectionCardMarkup(group, { eagerImage = false } = {}) {
  const collection = group.collection;
  const id = escapeHtml(group.variantId);
  const count = Number(collection.itemCount || 0);
  const items = count ? `${count.toLocaleString()} item${count === 1 ? "" : "s"}` : "No items yet";
  const button = collection.wanted
    ? yoinkButtonMarkup(`data-want-collection="${id}"`, `Yoink: every ${group.title} item — edit`, { id: `collection:${group.variantId}` })
    : `<button class="button primary" data-want-collection="${id}" type="button" aria-label="${escapeHtml(`Want every item: ${group.title}`)}">Want it</button>`;
  const planLine = collection.wanted ? `Every item · ${collection.mode === "add_to_cart" ? "Add to cart" : "Alerts"}` : "";
  return `<article class="product-card product-group compact-product-card collection-card" data-ui-key="${id}" data-collection="${id}">
    ${mediaMarkup(group, { eager: eagerImage })}
    <h3 title="${escapeHtml(group.title)}">${escapeHtml(group.title)}</h3>
    <div class="card-metadata">
      <p class="product-offer-summary"><span>All New entry</span></p>
      <p class="product-observation">New items join as they appear.</p>
    </div>
    <div class="card-plan-state">${planLine ? `<span>${escapeHtml(planLine)}</span>` : ""}</div>
    <div class="product-price"><strong>${escapeHtml(items)}</strong><small>Each up to Yoink's suggested price</small></div>
    <div class="card-actions">${button}</div>
  </article>`;
}

function productCardMarkup(group, missionByVariant, { eagerImage = false, storeId = state.browse.store } = {}) {
  if (group.collection) return collectionCardMarkup(group, { eagerImage });
  const plan = Object.hasOwn(group, "purchaseIntent") ? group.purchaseIntent : missionByVariant.get(group.variantId);
  const listings = group.listings || [];
  const focusListing = storeId
    ? listings.find((listing) => String(listing.retailerId) === storeId && listing.offerRole !== "alternate")
      || listings.find((listing) => String(listing.retailerId) === storeId) || null
    : null;
  const primary = focusListing || bestListing(group);
  const storeCount = Number(group.storeCount ?? new Set(listings.map((listing) => listing.retailerId)).size);
  // Stores Yoink can't act on yet stay out of view (Kevin, 2026-10-09: "Focus on what we have").
  const storeSummary = primary?.retailerName
    ? `${primary.retailerName}${!focusListing && storeCount > 1 ? ` + ${storeCount - 1} more` : ""}`
    : "No store yet";
  const note = group.collectionTitle ? `Part of ${group.collectionTitle}` : "";
  return compactProductCardMarkup({ group, listing: primary, plan, key: group.variantId || group.id || "", storeSummary, note, eagerImage });
}

// Folds listings into one entry per store when the API payload predates `stores`.
function productStoresFromListings(listings) {
  const stores = new Map();
  for (const listing of listings) {
    const store = stores.get(listing.retailerId);
    if (!store) {
      stores.set(listing.retailerId, { retailerId: listing.retailerId, retailerName: listing.retailerName, primary: listing, alternates: [] });
    } else if (listing.offerRole !== "alternate" && store.primary.offerRole === "alternate") {
      store.alternates.push(store.primary);
      store.primary = listing;
    } else {
      store.alternates.push(listing);
    }
  }
  return [...stores.values()];
}

// A 14-digit GTIN as stores print it: a UPC's 12 digits, else an EAN's 13.
function barcodeLabel(gtin) {
  const value = String(gtin || "");
  return value.startsWith("00") ? value.slice(2) : value.startsWith("0") ? value.slice(1) : value;
}

function renderProductDetail(variantId) {
  const group = currentCatalogProductGroups().find((candidate) => candidate.variantId === variantId);
  if (!group) throw new Error("That product is no longer in the current catalog view. Refresh and try again.");
  const plan = Object.hasOwn(group, "purchaseIntent") ? group.purchaseIntent : state.plans.find((candidate) => candidate.variantId === variantId);
  const exactVariant = variantSummary(group.variantAttributes);
  const primary = bestListing(group);
  $("#productDialogTitle").textContent = group.title;
  const offerRow = (listing) => {
    const price = listingEffectivePrice(listing);
    const chipAvailable = listingStockEvidence(listing).available;
    const sellerNote = listing.sellerType === "third_party" ? "Marketplace seller"
      : listing.sellerType === "first_party" ? `Sold by ${listing.retailerName}`
      : listing.offerRole === "alternate" ? "Another listing at this store" : "";
    return `<div class="detail-row${chipAvailable ? "" : " muted"}" data-offer-listing="${escapeHtml(listing.listingId)}" data-offer-role="${escapeHtml(listing.offerRole || "primary")}">
      <div class="detail-store"><strong>${escapeHtml(listing.retailerName)}</strong><small>SKU ${escapeHtml(listing.retailerSku)}${listing.gtin ? ` · UPC ${escapeHtml(barcodeLabel(listing.gtin))}` : ""}${sellerNote ? ` · ${escapeHtml(sellerNote)}` : ""}</small><small>${stockObservationMarkup(listing)}</small></div>
      <div class="detail-price"><strong>${price ? escapeHtml(money(price.cents, listing.currency)) : "No price"}</strong><small>${price ? price.kind === "seen" ? priceObservationMarkup(listing) : "Catalog price" : ""}</small>${msrpReferenceMarkup(listing)}</div>
      ${stockStatusMarkup(listing, "tag")}
      <div class="detail-actions">
        ${retailerLinkMarkup(listing.canonicalUrl, group.title, `Check ${listing.retailerName} ↗`)}
      </div>
    </div>`;
  };
  // One block per store: the primary offer, then any alternates folded beneath it.
  const stores = (Array.isArray(group.stores) && group.stores.length
    ? [...group.stores]
    : productStoresFromListings(group.listings || []))
    // Cheapest store first, as on the card.
    .sort((first, second) => (listingEffectivePrice(first.primary)?.cents ?? Infinity) - (listingEffectivePrice(second.primary)?.cents ?? Infinity));
  const rows = stores.map((store) => {
    const alternates = Array.isArray(store.alternates) ? store.alternates : [];
    return `<div class="detail-store-group" data-offer-store="${escapeHtml(store.retailerId)}">
      ${offerRow(store.primary)}
      ${alternates.length ? `<details class="offer-alternates"><summary>${alternates.length.toLocaleString()} more listing${alternates.length === 1 ? "" : "s"} at ${escapeHtml(store.retailerName)}</summary><div class="detail-rows">${alternates.map(offerRow).join("")}</div></details>` : ""}
    </div>`;
  }).join("");
  const primaryActions = wantMarkup(primary?.listingId, plan, group.title);
  const detailSummary = [
    exactVariant ? escapeHtml(exactVariant) : "",
    group.brand ? `<span class="tag">${escapeHtml(group.brand)}</span>` : "",
    group.msrpCents ? `<span class="tag">MSRP ${escapeHtml(money(group.msrpCents, group.currency))}</span>` : "",
  ].filter(Boolean).join(" ");
  $("#productDialogBody").innerHTML = `
    <div class="detail-summary">
      ${safeHref(group.imageUrl) ? `<img class="detail-image" src="${escapeHtml(safeHref(group.imageUrl))}" alt="" referrerpolicy="no-referrer">` : ""}
      <div>${detailSummary ? `<p>${detailSummary}</p>` : ""}<div class="inline-actions" data-product-primary-actions>${primaryActions}</div></div>
    </div>
    ${rows ? '<p class="field-help">Cheapest store first. Stock reports can change at any time; a report over 2 hours old is marked stale. Check the store for current stock.</p>' : ""}
    <div class="detail-rows">${rows || '<div class="empty"><p>No store listing yet.</p><button class="button secondary" data-open-product-link type="button">Add a store link</button></div>'}</div>`;
  for (const image of $$("#productDialogBody img")) {
    image.addEventListener("error", () => { image.remove(); }, { once: true });
  }
}

async function openProductDetail(variantId, { routed = false } = {}) {
  const panel = activeUserRoute();
  const request = ++state.entityRequestSequence;
  const key = entityKey();
  if (!currentCatalogProductGroups().some((group) => group.variantId === variantId)) {
    const page = await api(`/api/v1/user/library/products?variant=${encodeURIComponent(variantId)}&limit=1`);
    if (request !== state.entityRequestSequence || panel !== activeUserRoute() || (routed && entityKey() !== key)) return;
    if (!page.items?.length) throw new Error("This product is unavailable or has been removed. Return to the list to find another product.");
    state.detailProduct = page.items[0];
  }
  renderProductDetail(variantId);
  $("#productDialog").showModal();
  if (!routed) { state.entity = { kind: "product", id: variantId, panel }; writeUserRoute("push", panel); $("#productDialog").dataset.entityKey = entityKey(); }
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

// What one wanted item is doing right now, in one pill.
function wantedStatus(plan) {
  if (plan.status === "paused") return { label: "Paused", tone: "" };
  if (plan.status === "satisfied") return { label: "Done", tone: "good" };
  if (plan.status !== "active") return { label: planStatusLabel(plan.status), tone: "" };
  if (plan.actionCeiling !== "add_to_cart") return { label: "Alerts", tone: "info" };
  if (state.overview?.settings?.actionsPaused === true) return { label: "Alerts for now", tone: "warn" };
  return plan.automationReadiness?.readyForGuardedAdd === true
    ? { label: "Adds to cart", tone: "good" }
    : { label: "Waiting", tone: "warn" };
}

function wantedRowMarkup(plan, { showReadiness }) {
  // Preserve the saved action target/mode independently of display-only listing data.
  const fromCall = String(plan.origin || "").startsWith("signal:") && plan.actionCeiling !== "add_to_cart";
  const readiness = plan.automationReadiness || {};
  const note = showReadiness && wantedStatus(plan).label === "Waiting" ? readiness.headline || "" : "";
  return compactProductCardMarkup({
    group: plan, listing: plan.cardListing || {
      listingId: plan.primaryListingId, retailerId: plan.primaryRetailerId,
      retailerName: plan.primaryRetailerName, canonicalUrl: plan.primaryCanonicalUrl,
      currentPriceCents: plan.primaryCurrentPriceCents
    }, plan, key: plan.id,
    wantListingId: plan.wantListingId ?? null,
    wantMode: fromCall ? "" : plan.actionCeiling === "add_to_cart" ? "add_to_cart" : "notify",
    storeSummary: plan.enabledStoreNames || plan.primaryRetailerName || "No selected store",
    note, attributes: `data-plan-id="${escapeHtml(plan.id)}"`,
    extraActions: plan.status === "paused"
      ? `<button class="button quiet" data-toggle-plan-status="${escapeHtml(plan.id)}" type="button">Resume</button>` : ""
  });
}

function renderPlans() {
  const restoreListUi = captureListUi("#planList");
  renderLegacyPlanTransition();
  renderMsrpFillNotice();
  renderCallAddedNotice();
  const total = state.planTotal || state.plans.length;
  const filtered = hasPlanFilters();
  const carting = state.plans.filter((plan) => plan.actionCeiling === "add_to_cart").length;
  const alerting = state.plans.length - carting;
  $("#planSummary").textContent = state.plans.length
    ? [`${total.toLocaleString()} item${total === 1 ? "" : "s"}`,
      !filtered && carting ? `${carting.toLocaleString()} add to cart` : "",
      !filtered && alerting ? `${alerting.toLocaleString()} alert only` : ""].filter(Boolean).join(" · ")
    : filtered ? "No wanted items match." : "";
  $("#planFilterControl").hidden = total < 8 && !filtered;
  $$("[data-plan-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.planView === state.planView)));
  $("#planPagination").hidden = state.planTotal <= state.planPageSize;
  $("#previousPlans").disabled = state.planOffset === 0;
  $("#nextPlans").disabled = state.planOffset + state.plans.length >= state.planTotal;
  $("#planPageStatus").textContent = `${state.planOffset + (state.plans.length ? 1 : 0)}–${state.planOffset + state.plans.length} of ${state.planTotal}`;
  const status = state.overview ? deriveUserHome(state.overview).status : "";
  const showReadiness = ["ready", "paused"].includes(status);
  $("#planList").innerHTML = state.plans.length
    ? state.plans.map((plan) => wantedRowMarkup(plan, { showReadiness })).join("")
    : filtered
      ? '<div class="empty"><p>No wanted items match.</p><button type="button" class="button secondary" id="clearPlanSearch">Show all</button></div>'
      : '<div class="empty"><p>Nothing on your list yet. Find a product and tap Want it.</p><button class="button secondary" data-tab="find" type="button">Find products</button></div>';
  restoreListUi();
}

// Calls used to add items to Wanted by themselves. They no longer do; this
// offers a one-time review so the shopper decides what stays.
const CALL_ADDED_DISMISSED_KEY = "yoinkCallAddedReviewedV1";
function callAddedDismissedKey() {
  const actor = state.overview?.actor?.userId;
  return actor ? `${CALL_ADDED_DISMISSED_KEY}:${actor}` : CALL_ADDED_DISMISSED_KEY;
}
function callAddedDismissed() {
  try { return localStorage.getItem(callAddedDismissedKey()) === "1"; } catch { return false; }
}
function callAddedCount() {
  const counted = Number(state.overview?.counts?.callAddedPlans);
  if (Number.isFinite(counted)) return Math.max(0, counted);
  return state.plans.filter((plan) => String(plan.origin || "").startsWith("signal:")).length;
}
// Wanted › Fill in MSRPs (Kevin, 2026-10-08): cart items at Amazon, Target,
// Walmart and Best Buy wait for an MSRP; this fills them from TrackaLacker or
// the lowest Best Buy, Target or Walmart price in one step, item by item.
function msrpFillCount(plans) {
  return plans.filter((plan) => plan.actionCeiling === "add_to_cart"
    && plan.automationReadiness?.state === "guarded_add_policy_incomplete").length;
}
function renderMsrpFillNotice(plans = state.plans) {
  const host = $("#msrpFillNotice");
  if (!host) return;
  const count = msrpFillCount(plans);
  host.innerHTML = count ? `<section class="call-added-notice" data-msrp-fill-notice>
    <div><strong>${count.toLocaleString()} cart item${count === 1 ? " needs" : "s need"} an MSRP.</strong><span>Yoink only adds an item to your cart at or below its MSRP.</span></div>
    <div class="inline-actions"><button class="button secondary" id="fillMsrps" type="button">Fill in MSRPs</button></div>
  </section>` : "";
}

function syncMsrpFillButton() {
  const checked = $$('#msrpFillList input[name="msrpFillId"]:checked').length;
  const button = $("#applyMsrpFill");
  button.disabled = checked < 1 || state.msrpFill?.saving === true;
  button.textContent = state.msrpFill?.saving ? "Saving…" : checked ? `Set ${checked.toLocaleString()} MSRP${checked === 1 ? "" : "s"}` : "Set MSRPs";
}

async function openMsrpFill() {
  const dialog = $("#msrpFillDialog");
  state.msrpFill = { saving: false };
  $("#msrpFillSummary").textContent = "Looking up MSRPs…";
  $("#msrpFillList").innerHTML = "";
  syncMsrpFillButton();
  if (!dialog.open) dialog.showModal();
  try {
    const { items = [] } = await api("/api/v1/user/purchase-intents/msrp-fill");
    if (!state.msrpFill) return;
    const fillable = items.filter((item) => item.canFill);
    $("#msrpFillSummary").textContent = items.length
      ? `Check each MSRP and untick anything that looks wrong, such as a resale price. ${fillable.length < items.length ? "Items Yoink can't fill stay as they are; set those in Want it." : ""}`.trim()
      : "Every cart item already has an MSRP.";
    $("#msrpFillList").innerHTML = items.map((item) => {
      if (!item.canFill) {
        return `<div class="call-added-item"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.reason)}</small></span></div>`;
      }
      const lowered = item.currentMaxCents && item.newMaxCents < item.currentMaxCents
        ? ` · your max goes from ${money(item.currentMaxCents)} to ${money(item.newMaxCents)}` : ` · max ${money(item.newMaxCents)}`;
      return `<label class="call-added-item"><input name="msrpFillId" type="checkbox" value="${escapeHtml(item.planId)}" checked><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(`MSRP ${money(item.msrpCents)} from ${item.sourceLabel}${lowered}`)}</small></span></label>`;
    }).join("");
  } catch (error) {
    $("#msrpFillSummary").textContent = error.message || "The MSRPs could not load. Try again.";
  }
  syncMsrpFillButton();
}

async function applyMsrpFill(event) {
  event.preventDefault();
  const fill = state.msrpFill;
  const planIds = $$('#msrpFillList input[name="msrpFillId"]:checked').map((input) => input.value);
  if (!fill || fill.saving || !planIds.length) return;
  fill.saving = true;
  syncMsrpFillButton();
  try {
    const result = await api("/api/v1/user/purchase-intents/msrp-fill", {
      method: "POST",
      body: JSON.stringify({ contractVersion: 1, planIds, confirmation: "FILL_MISSING_MSRPS" })
    });
    const updated = Array.isArray(result.updated) ? result.updated.length : 0;
    const skipped = Array.isArray(result.skipped) ? result.skipped : [];
    $("#msrpFillDialog").close();
    await refresh();
    toast(`Set the MSRP for ${updated.toLocaleString()} item${updated === 1 ? "" : "s"}. Yoink can now add ${updated === 1 ? "it" : "them"} to your cart.`, updated === 0);
    if (skipped.length) {
      setInlineStatus($("#planSummary"), {
        state: "info",
        message: `${skipped.length.toLocaleString()} kept no MSRP: ${skipped.map((item) => `${item.title || "an item"} (${item.reason || "it changed"})`).join("; ")}`
      });
    }
  } catch (error) {
    toast(error.message || "The MSRPs could not be set. Try again.", true);
  } finally {
    fill.saving = false;
    if ($("#msrpFillDialog").open) syncMsrpFillButton();
  }
}

function renderCallAddedNotice() {
  const host = $("#callAddedNotice");
  if (!host) return;
  const count = callAddedCount();
  if (!count || callAddedDismissed()) {
    host.replaceChildren();
    return;
  }
  host.innerHTML = `<section class="call-added-notice" data-call-added-notice>
    <div><strong>${count.toLocaleString()} item${count === 1 ? " here was" : "s here were"} added by calls, not by you.</strong><span>Calls no longer add items. Keep what you want and remove the rest.</span></div>
    <div class="inline-actions"><button class="button secondary" id="reviewCallAdded" type="button">Review</button><button class="button quiet" id="dismissCallAdded" type="button">Keep them</button></div>
  </section>`;
}

function dismissCallAddedNotice() {
  try { localStorage.setItem(callAddedDismissedKey(), "1"); } catch { /* The notice returns next visit. */ }
  renderCallAddedNotice();
}

function syncCallAddedRemoveButton() {
  const checked = $$('#callAddedList input[name="callAddedId"]:checked').length;
  const button = $("#removeCallAdded");
  button.disabled = checked < 1 || state.callAdded?.saving === true;
  button.textContent = state.callAdded?.saving ? "Removing…" : checked ? `Remove ${checked.toLocaleString()}` : "Remove";
}

async function openCallAddedReview() {
  const dialog = $("#callAddedDialog");
  state.callAdded = { items: [], saving: false };
  $("#callAddedSummary").textContent = "Loading the items calls added…";
  $("#callAddedList").innerHTML = "";
  syncCallAddedRemoveButton();
  if (!dialog.open) dialog.showModal();
  try {
    const page = await api("/api/v1/user/purchase-intents/call-added");
    if (!state.callAdded) return;
    const items = Array.isArray(page.items) ? page.items : [];
    state.callAdded.items = items;
    const more = Number(page.total || items.length) - items.length;
    $("#callAddedSummary").textContent = items.length
      ? `Uncheck anything you want to keep. Removing an item stops its alerts; Want it brings it back.${more > 0 ? ` ${more.toLocaleString()} more remain after these.` : ""}`
      : "Nothing left to review. Every item on your list is one you chose.";
    $("#callAddedList").innerHTML = items.map((item) => {
      const facts = [item.actionCeiling === "add_to_cart" ? "Adds to cart" : "Alerts",
        item.maxUnitPriceCents ? `up to ${money(item.maxUnitPriceCents)}` : "", item.enabledStoreNames || ""].filter(Boolean).join(" · ");
      return `<label class="call-added-item"><input name="callAddedId" type="checkbox" value="${escapeHtml(item.id)}" checked><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(facts)}</small></span></label>`;
    }).join("");
  } catch (error) {
    $("#callAddedSummary").textContent = error.message || "The items calls added could not load. Try again.";
  }
  syncCallAddedRemoveButton();
}

async function removeCallAddedItems(event) {
  event.preventDefault();
  const review = state.callAdded;
  const ids = $$('#callAddedList input[name="callAddedId"]:checked').map((input) => input.value);
  if (!review || review.saving || !ids.length) return;
  review.saving = true;
  syncCallAddedRemoveButton();
  try {
    const result = await api("/api/v1/user/purchase-intents/call-added/remove", {
      method: "POST",
      body: JSON.stringify({ contractVersion: 1, ids, confirmation: "REMOVE_CALL_ADDED_PLANS" })
    });
    const removed = Number(result.removed || 0);
    const skipped = Array.isArray(result.skipped) ? result.skipped : [];
    $("#callAddedDialog").close();
    if (!skipped.length || removed) dismissCallAddedNotice();
    await refresh();
    toast(`Removed ${removed.toLocaleString()} item${removed === 1 ? "" : "s"} from Wanted.`, skipped.length > 0 && removed === 0);
    // Which items stayed, and why, is too long for a toast; it sits by the list.
    if (skipped.length) {
      setInlineStatus($("#planSummary"), {
        state: "info",
        message: `${skipped.length.toLocaleString()} stayed on Wanted: ${skipped.map((item) => `${item.title || "an item"} (${item.message || "it changed"})`).join("; ")}`
      });
    }
  } catch (error) {
    toast(error.message || "The items could not be removed. Try again.", true);
  } finally {
    review.saving = false;
    if ($("#callAddedDialog").open) syncCallAddedRemoveButton();
  }
}

function renderLegacyPlanTransition() {
  const preview = state.legacyTransition;
  const host = $("#legacyTransitionNotice");
  if (!host) return;
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
    setTab("cart");
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

// A cart can be closed from History or from the Cart's ready list.
function findActionById(actionId) {
  const id = String(actionId || "");
  return state.actions.find((item) => item.id === id) || (state.cartActions || []).find((item) => item.id === id) || null;
}

function actionOutcomeCard(actionId) {
  return $$('[data-action-job]').find((card) => card.dataset.actionJob === String(actionId || "")) || null;
}

function openCartOutcomeDialog(actionId, returnFocus = null) {
  const action = findActionById(actionId);
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
  const action = findActionById(state.cartOutcomeActionId);
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
    state.loadedRoutes.delete("cart");
    if (dialogForm && $("#cartOutcomeDialog").hasAttribute("open")) $("#cartOutcomeDialog").close();
    toast(outcome === "got_it" ? "Purchase recorded and plan progress updated." : "Cart action closed as Missed it.");
    try {
      if (await refresh() === false) throw new Error("Dashboard refresh failed.");
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

let checkoutReports = null;
function openCheckoutReport(id, kind, trigger) {
  checkoutReports ??= globalThis.YoinkCheckoutReports.install({ api, money, escapeHtml, requestConfirmation, toast, onSaved: async () => {
  for (const route of ["cart", "activity"]) state.loadedRoutes.delete(route);
    await refresh(); scheduleAdaptivePoll();
  } });
  return checkoutReports.open(id, kind, trigger);
}

function renderActions() {
  const filtered = Object.values(state.activityFilters).some(Boolean);
  $("#activityFilterSummary").hidden = !filtered;
  $("#clearActivityFilters").hidden = !filtered;
  $("#activityFilterSummary").textContent = `${state.actionTotal} actions matching Insights filters · ${state.activityFilters.window || "all"} · ${state.activityFilters.store || "all stores"} · ${state.activityFilters.product || "all products"}`;
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
  $("#showMoreActions").hidden = visibleActions.length >= filteredActions.length && state.actions.length >= state.actionTotal;
  const restoreListUi = captureListUi("#actionList");
  $("#actionList").innerHTML = visibleActions.length ? visibleActions.map((action) => {
    const stage = actionStage(action);
    const confirmation = (state.actionPlatform?.orderConfirmations || [])
      .find((item) => item.actionJobId === action.id);
    const canClose = closeableCartAction(action);
    const deliverySummary = action.action === "notify" && action.notificationDeliveryState
      ? `Chrome ${words(action.notificationDeliveryState)}${action.notificationDeliveredAt ? ` ${relative(action.notificationDeliveredAt)}` : ""}${action.notificationFailureCode ? ` · ${words(action.notificationFailureCode)}` : ""}${action.notificationConnectorState ? ` · destination ${words(action.notificationConnectorState)}` : ""}`
      : "";
    const deliveryFailed = ["failed", "expired"].includes(String(action.notificationDeliveryState));
    const actionStatusLabel = action.action === "notify" && action.notificationDeliveryState
      ? deliveryFailed ? "Not delivered" : action.notificationDeliveryState === "pending" || action.notificationDeliveryState === "leased" ? "Delivery pending" : "Delivered"
      : action.statusLabel || (stage === "needs_you" ? "Needs you" : labelFor(ACTION_STATE_LABELS, action.state));
    return `<article class="action-card" data-ui-key="${escapeHtml(action.id)}" data-action-job="${escapeHtml(action.id)}" data-store="${escapeHtml(action.retailerId || "")}" data-stage="${escapeHtml(stage)}">
    <div><div class="card-top"><h3>${escapeHtml(action.title)}</h3><span class="tag ${stage === "ready_to_checkout" || action.userReportOutcome === "got_it" || (action.action === "notify" && !deliveryFailed && !["pending", "leased"].includes(String(action.notificationDeliveryState))) ? "good" : stage === "needs_you" || deliveryFailed ? "warn" : stage === "checking" ? "info" : ""}">${escapeHtml(actionStatusLabel)}</span></div>
    <p>${escapeHtml(retailerDisplayName(action.retailerId))} · ${escapeHtml(action.retailerSku)}</p>
    ${confirmation ? `<p><strong>Checkout confirmation observed</strong> · ${escapeHtml(relative(confirmation.observedAt))}. Confirm the result below; Yoink did not collect order or payment details.</p>` : ""}
    <details class="action-evidence"><summary>Details</summary>
      <p>${escapeHtml(labelFor(ACTION_KIND_LABELS, action.action))} · ${escapeHtml(labelFor(DECISION_SOURCE_LABELS, action.decisionSource, "default rules"))} · unit cap ${escapeHtml(money(action.maxUnitPriceCents, action.currency))} · reviewed maximum ${escapeHtml(money(action.maxOrderTotalCents, action.currency))}${action.spendReservationStatus ? ` · ${escapeHtml(labelFor(RESERVATION_LABELS, action.spendReservationStatus))}` : ""}</p>
      ${action.statusSummary ? `<p>${escapeHtml(action.statusSummary)}</p>` : ""}
      ${deliverySummary ? `<p><strong>Delivery:</strong> ${escapeHtml(deliverySummary)}</p>` : ""}
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
    ${action.userReportOutcome ? `<div class="checkout-report-actions"><button class="button secondary" data-checkout-report="${escapeHtml(action.id)}" type="button">Correct report / History</button>${action.userReportOutcome === "got_it" && Number(action.userReportedNetCents) > 0 ? `<button class="button secondary" data-checkout-refund="${escapeHtml(action.id)}" type="button">Record refund</button>` : ""}${Number(action.userReportedRefundedCents) > 0 ? `<small>Charged ${escapeHtml(money(action.userReportedTotalCents))} · Refunded ${escapeHtml(money(action.userReportedRefundedCents))} · Net ${escapeHtml(money(action.userReportedNetCents))}</small>` : ""}</div>` : ""}
    ${canClose ? `<div class="cart-closeout"><span>Checkout result</span><div class="inline-actions"><button class="button secondary" data-cart-got-it="${escapeHtml(action.id)}" type="button">Got it</button><button class="button secondary" data-cart-missed-it="${escapeHtml(action.id)}" type="button">Missed it</button></div><small class="outcome-status" data-outcome-status role="status" aria-live="polite" hidden></small></div>` : ""}
    </div>
  </article>`;
  }).join("") : `<div class="empty">${state.actions.length
    ? `No ${escapeHtml(stageLabels[state.actionStageFilter] || "matching").toLowerCase()} actions.`
    : "No purchase or notification actions have been recorded yet."}</div>`;
  restoreListUi();
}

function callPlan(call) {
  if (Object.hasOwn(call, "purchaseIntent")) return call.purchaseIntent;
  const product = state.products.find((item) => item.listingId === call.listingId);
  return product ? state.plans.find((plan) => plan.variantId === product.variantId) : null;
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
    // Countdown text only matters on screen; a hidden tab re-renders on resume.
    if (document.visibilityState !== "visible") return;
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
  const callFilter = ["all", "products", "drawings", "discord"].includes(state.callFilter) ? state.callFilter : "all";
  state.callFilter = callFilter;
  $$('[data-call-filter]').forEach((button) => {
    const active = button.dataset.callFilter === callFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#callProductResults").hidden = !["all", "products"].includes(callFilter);
  $("#callDrawingResults").hidden = !["all", "drawings"].includes(callFilter);
  $("#callDiscordResults").hidden = callFilter !== "discord";
  return callFilter;
}

function renderCalls() {
  renderWatchHistory();
  renderUpcomingDrops();
  renderWatchQueueSetting();
  renderWalmartDraws();
  const callFilter = syncCallFilterView();
  const calls = Array.isArray(state.calls) ? state.calls : [];
  const drawings = Array.isArray(state.overview?.walmartDraws?.items) ? state.overview.walmartDraws.items : [];
  const visibleCount = callFilter === "discord" ? state.discordCallTotal || state.discordCalls.length
    : callFilter === "products" ? state.callTotal || calls.length : callFilter === "drawings" ? drawings.length : (state.callTotal || calls.length) + drawings.length;
  const countLabel = callFilter === "discord" ? "Discord call" : callFilter === "products" ? "product call" : callFilter === "drawings" ? "drawing" : "call";
  renderDiscordCalls();
  $("#callCount").textContent = `${visibleCount.toLocaleString()} ${countLabel}${visibleCount === 1 ? "" : "s"}`;
  scheduleWalmartHandoffExpiry(calls);
  const visibleCalls = calls.slice(0, state.callDisplayLimit);
  $("#showMoreCalls").hidden = ["drawings", "discord"].includes(callFilter) || (visibleCalls.length >= calls.length && !state.callHasMore);
  const restoreListUi = captureListUi("#callList");
  $("#callList").innerHTML = calls.length ? visibleCalls.map((call) => {
    const plan = callPlan(call);
    const walmartPurchaseAction = walmartPurchaseLinkMarkup(call);
    const storePageAction = walmartPurchaseAction
      ? walmartPdpFallbackLinkMarkup(call)
      : call.canonicalUrl ? retailerLinkMarkup(call.canonicalUrl, call.title, "Store page ↗") : "";
    const watch = call.watch || null;
    const watchActive = watch && ["queued", "observing"].includes(watch.state);
    const result = call.kind === "signal" ? call.result || null : null;
    const membership = String(call.earlyAccess?.membership || "");
    const queueExpected = call.earlyAccess?.queueExpected === true;
    const typeTag = call.kind === "signal" ? "Signal" : call.kind === "queue_open" ? "Queue" : "Drop";
    const stateTag = result ? result.label : words(String(call.status || "received"));
    const stateClass = result ? CALL_RESULT_TONES[result.tone] ?? ""
      : ["confirmed", "seen_in_stock", "in_stock", "purchase_ready"].includes(call.status)
        ? "good"
        : ["failed", "expired", "cancelled"].includes(call.status) ? "warn" : "";
    const qualifierTag = call.falsePositiveReported
      ? "False positive reported"
      : walmartPurchaseAction ? "Buy ready"
        : watchActive ? "Watching"
          : call.kind === "signal" ? call.source === "discord" ? "Discord" : String(call.source || "") : "";
    const qualifierClass = call.falsePositiveReported ? "warn" : walmartPurchaseAction ? "good" : "";
    const details = [
      retailerDisplayName(call.retailerId),
      call.retailerSku,
      call.unitPriceCents ? money(call.unitPriceCents, call.currency) : "",
      relative(call.occurredAt),
      membership ? `Access: ${membership}` : "",
      queueExpected ? "Queue expected" : "",
      call.notificationConnectorState ? `Destination ${words(call.notificationConnectorState)}` : ""
    ].filter(Boolean);
    return `<article class="action-card call-card" data-ui-key="${escapeHtml(call.id)}" data-store="${escapeHtml(call.retailerId || "")}">
      <div><div class="card-top"><h3>${escapeHtml(call.title || `${retailerDisplayName(call.retailerId)} product`)}</h3><span class="tag">${escapeHtml(typeTag)}</span></div>
      <p>${details.map((detail) => escapeHtml(detail)).join(" · ")}</p>
      <div class="call-tags"><span class="tag ${stateClass}">${escapeHtml(stateTag)}</span>${qualifierTag ? `<span class="tag ${qualifierClass}">${escapeHtml(qualifierTag)}</span>` : ""}</div>
      ${result ? callResultReasonMarkup(result) : ""}
      ${call.discord ? discordTraceMarkup(call) : ""}
      ${call.closesAt ? `<p>${escapeHtml(watchWindowSummary(call))}</p>` : ""}
      ${watch ? `<p class="watch-readiness">${escapeHtml(watchReadinessSummary(watch))}</p>` : ""}</div>
      <div class="action-controls"><div class="inline-actions">
        ${walmartPurchaseAction}
        ${call.listingId && !walmartPurchaseAction ? wantMarkup(call.listingId, plan, call.title) : ""}
        ${result ? callFixMarkup(call, { excludeWant: true }) : ""}
        ${call.dropWindowItemId && !watch ? `<button class="button secondary" data-watch-enroll="${escapeHtml(call.dropWindowItemId)}" type="button">Watch</button>` : ""}
        ${watchActive ? `<button class="button quiet" data-watch-cancel="${escapeHtml(watch.id)}" type="button">Stop watching</button>` : ""}
        ${call.kind === "signal" && call.sourceChannelId && !call.falsePositiveReported ? `<button class="button quiet" data-false-positive="${escapeHtml(call.id)}" type="button">Report false positive</button>` : ""}
        ${storePageAction}
      </div></div>
    </article>`;
  }).join("") : '<div class="empty">No calls or scheduled drops have arrived yet.</div>';
  restoreListUi();
}

// Kevin, 2026-10-12: Discord messages that reach Windows' notification centre
// on this PC become calls, each traced to the Yoink product it is about.
const DISCORD_CHANNEL_MODES = Object.freeze([
  ["add", "Add to cart"],
  ["log", "Log only"],
  ["ignore", "Ignore"]
]);

function discordReaderSummary(discord) {
  if (!discord) return "Checking…";
  const reader = discord.reader;
  if (!discord.settings?.enabled || reader?.state === "off") return "Off. Yoink doesn't read Discord notifications.";
  if (!reader || reader.state === "unsupported") {
    return "Yoink reads Discord notifications on the Windows PC it runs on; this Yoink isn't running on Windows.";
  }
  if (reader.state === "starting") return "Starting to read Windows notifications…";
  if (reader.state === "error") return `Yoink can't read Windows notifications right now. ${reader.lastErrorMessage || ""}`.trim();
  const inCentre = Number(reader.discordAppInCentre || 0);
  const calls = Number(reader.calls || 0);
  return [
    `Reading Windows notifications${reader.lastCheckedAt ? ` (checked ${relative(reader.lastCheckedAt)})` : ""}`,
    `${inCentre.toLocaleString()} Discord notification${inCentre === 1 ? "" : "s"} in your notification centre`,
    calls ? `${calls.toLocaleString()} call${calls === 1 ? "" : "s"} since Yoink started` : "no calls since Yoink started",
    reader.lastDiscordAt ? `last Discord message ${relative(reader.lastDiscordAt)}` : ""
  ].filter(Boolean).join(" · ") + ".";
}

function renderDiscordSetup() {
  const discord = state.discord;
  const enabled = $("#discordEnabled");
  if (!enabled) return;
  enabled.checked = discord?.settings?.enabled !== false;
  enabled.disabled = !discord;
  const status = $("#discordReaderStatus");
  status.textContent = discordReaderSummary(discord);
  status.classList.toggle("warn", discord?.reader?.state === "error");
  const channels = Array.isArray(discord?.channels) ? discord.channels : [];
  $("#discordChannelList").innerHTML = channels.map((channel) => {
    const counts = [
      `${Number(channel.calls || 0).toLocaleString()} call${Number(channel.calls) === 1 ? "" : "s"}`,
      `${Number(channel.matched || 0).toLocaleString()} matched to a product`,
      channel.lastCallAt ? `last ${relative(channel.lastCallAt)}` : ""
    ].filter(Boolean).join(" · ");
    const options = DISCORD_CHANNEL_MODES.map(([value, label]) => `<option value="${value}" ${channel.mode === value ? "selected" : ""}>${label}</option>`).join("");
    return `<div class="mini-row"><span><strong>${escapeHtml(channel.name)}</strong><small>${escapeHtml(counts)}</small></span><label class="discord-channel-mode"><span class="sr-only">What Yoink does with ${escapeHtml(channel.name)}</span><select data-discord-channel="${escapeHtml(channel.id)}">${options}</select></label></div>`;
  }).join("") || '<div class="mini-row"><span>No Discord channels yet. A channel appears here after its first message that names a store item, stock or a price.</span></div>';
}

/** The Discord message a call came from, and how Yoink matched it to a product. */
function discordTraceMarkup(call) {
  const discord = call.discord || {};
  const message = String(discord.message || "");
  const trace = String(discord.trace || "");
  const traceLabel = discord.matched ? "Matched" : ["notice", "message"].includes(discord.kind) ? "Not a product" : "Not matched";
  return `<div class="discord-trace">${message ? `<blockquote class="discord-message">${escapeHtml(message)}</blockquote>` : ""}${trace ? `<p><b>${traceLabel}:</b> ${escapeHtml(trace)}</p>` : ""}</div>`;
}

function renderDiscordCalls() {
  const list = $("#discordCallList");
  if (!list || state.callFilter !== "discord") return;
  const calls = Array.isArray(state.discordCalls) ? state.discordCalls : [];
  const restoreListUi = captureListUi("#discordCallList");
  list.innerHTML = calls.length ? calls.map((call) => {
    const result = call.result || { label: "Received", reason: "", tone: "muted" };
    // A call from a configured Discord bot channel carries no notification details.
    const discord = call.discord || null;
    const matched = discord ? discord.matched === true : Boolean(call.listingId);
    // A notice, message or drop time is listed by what it says (Kevin, 2026-10-13).
    const title = matched || (discord && discord.kind && discord.kind !== "item") ? call.title || "Discord message" : "Not matched to a product";
    const details = [
      `Discord ${discord?.channel || ""}`.trim(),
      matched ? retailerDisplayName(call.retailerId) : "",
      call.unitPriceCents ? money(call.unitPriceCents, call.currency) : "",
      relative(call.receivedAt || call.occurredAt)
    ].filter(Boolean);
    const storePage = matched && call.canonicalUrl ? retailerLinkMarkup(call.canonicalUrl, call.title, "Store page ↗") : "";
    return `<article class="action-card call-card discord-call" data-ui-key="${escapeHtml(call.id)}" data-store="${escapeHtml(call.retailerId || "")}">
      <div><div class="card-top"><h3>${escapeHtml(title)}</h3><span class="tag ${CALL_RESULT_TONES[result.tone] ?? ""}">${escapeHtml(result.label)}</span></div>
      <p>${details.map((detail) => escapeHtml(detail)).join(" · ")}</p>
      ${callResultReasonMarkup(result)}
      ${discord ? discordTraceMarkup(call) : ""}</div>
      <div class="action-controls"><div class="inline-actions">${callFixMarkup(call)}${storePage}</div></div>
    </article>`;
  }).join("") : `<div class="empty">${escapeHtml(state.discord?.settings?.enabled === false
    ? "Reading Discord notifications is off. Turn it on in Setup › Discord."
    : "No Discord messages yet. When a message from a Discord server reaches your Windows notifications, it shows here, with the product Yoink matched it to.")}</div>`;
  restoreListUi();
}

async function refreshDiscordCalls() {
  const page = await api("/api/v1/user/calls?source=discord&limit=100");
  state.discordCalls = page.items || [];
  state.discordCallTotal = Number(page.signalTotal ?? state.discordCalls.length);
}

function renderDiscordLinkChoices() {
  const link = state.discordLink;
  const choices = $("#discordLinkChoices");
  if (!link || !choices) return;
  const items = Array.isArray(link.items) ? link.items : [];
  choices.innerHTML = link.loading ? '<div class="mini-row"><span>Finding products…</span></div>'
    : items.map((item) => `<label class="mini-row discord-link-choice"><input type="radio" name="variantId" value="${escapeHtml(item.variantId)}" ${link.variantId === item.variantId ? "checked" : ""}><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml([...(item.stores || [])].join(", ") || "No store yet")}</small></span></label>`).join("")
      || '<div class="mini-row"><span>No products match. Try other words from the product name.</span></div>';
  $("#discordLinkForm").querySelector('button[type="submit"]').disabled = !link.variantId;
}

async function loadDiscordLinkChoices(query = "") {
  const link = state.discordLink;
  if (!link) return;
  const sequence = (link.sequence || 0) + 1;
  link.sequence = sequence;
  link.loading = true;
  renderDiscordLinkChoices();
  const params = new URLSearchParams({ signalId: link.signalId });
  if (query.trim()) params.set("q", query.trim());
  try {
    const page = await api(`/api/v1/user/discord/suggestions?${params}`);
    if (state.discordLink !== link || link.sequence !== sequence) return;
    link.items = page.items || [];
    if (!link.items.some((item) => item.variantId === link.variantId)) link.variantId = "";
  } catch (error) {
    if (state.discordLink === link) toast(error.message || "Products could not load. Try again.", true);
  } finally {
    if (state.discordLink === link && link.sequence === sequence) {
      link.loading = false;
      renderDiscordLinkChoices();
    }
  }
}

function openDiscordLink(signalId) {
  const call = [...state.discordCalls, ...(state.calls || []), ...(state.homeCalls || [])]
    .find((item) => String(item.id || "").replace(/^signal:/, "") === signalId);
  state.discordLink = { signalId, items: [], variantId: "", loading: true, sequence: 0 };
  $("#discordLinkMessage").textContent = call?.discord?.message || call?.title || "";
  const form = $("#discordLinkForm");
  form.elements.query.value = "";
  renderDiscordLinkChoices();
  $("#discordLinkDialog").showModal();
  void loadDiscordLinkChoices();
}

function renderActionPlatform() {
  renderWatchQueueSetting();
  renderWatchHistory();
  renderConnectors();
}

function renderConnectors() {
  const connectors = state.actionPlatform?.connectors || [];
  const deliveries = state.actionPlatform?.connectorDeliveries || [];
  renderConnectorHistory();
  $("#connectorList").innerHTML = connectors.map((connector) => {
    const latest = deliveries.find((delivery) => delivery.connectorId === connector.id);
    return `<div class="mini-row"><span><strong>${escapeHtml(connector.name)}</strong><small>${escapeHtml(words(connector.kind))} · ${connector.events.map(words).join(", ")}${latest ? ` · latest ${words(latest.state)}` : ""}</small></span><div class="inline-actions"><span class="tag ${connector.enabled && connector.runtimeBound ? "good" : "warn"}">${connector.runtimeBound ? connector.enabled ? "Ready" : "Paused" : "Needs setup"}</span><button class="button quiet" data-connector-edit="${escapeHtml(connector.id)}" type="button">Edit</button><button class="button quiet" data-connector-remove="${escapeHtml(connector.id)}" type="button">Remove</button><button class="button quiet" data-connector-test="${escapeHtml(connector.id)}" type="button" ${connector.runtimeBound ? "" : "disabled"}>Test</button><button class="button quiet" data-connector-toggle="${escapeHtml(connector.id)}" type="button">${connector.enabled ? "Pause" : "Enable"}</button></div></div>`;
  }).join("") || '<div class="mini-row"><span>No notification sources yet.</span></div>';
}

function activeUserRoute() {
  return $("[data-panel].active")?.dataset.panel || "cart";
}

function currentCatalogProductGroups() {
  const groups = state.productGroups;
  return state.detailProduct && !groups.some((group) => group.variantId === state.detailProduct.variantId) ? [...groups, state.detailProduct] : groups;
}

function currentCatalogProducts() {
  return state.products;
}

function productForListing(listingId) {
  return currentCatalogProducts().find((item) => item.listingId === listingId)
    || state.calls.find((call) => call.listingId === listingId)?.product;
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
  return Math.max(state.productPageSize, loaded);
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
    if (state.browse.category) parameters.set("category", state.browse.category);
    if (state.browse.price) {
      const [minimum, maximum] = state.browse.price.split("-");
      if (minimum !== "") parameters.set("priceMin", minimum);
      if (maximum !== "") parameters.set("priceMax", maximum);
    }
    parameters.set("sort", state.browse.sort || "newest");
  }
  return `/api/v1/user/library/products?${parameters.toString()}`;
}

const STORE_SWITCH_MAIN = Object.freeze(["target", "walmart", "amazon", "bestbuy"]);

function storeSwitchMarkup(store) {
  const cartAdds = store.cartAdds || null;
  const on = cartAdds?.state === "on";
  const pending = state.storeSwitchPending.has(store.retailerId);
  const canFlip = Boolean(cartAdds) && (on ? cartAdds.canTurnOff : cartAdds.canTurnOn);
  const status = cartAdds?.status || store.summary || "";
  const control = cartAdds && !cartAdds.needsAdmin
    ? `<button class="store-switch" role="switch" aria-checked="${on}" data-store-switch="${escapeHtml(store.retailerId)}" type="button"${canFlip && !pending ? "" : " disabled"} aria-label="${escapeHtml(`Cart adds at ${store.retailerName}`)}"><span class="auto-cart-track" aria-hidden="true"><span class="auto-cart-thumb"></span></span></button>`
    : "";
  return `<article class="store-switch-row" data-store="${escapeHtml(store.retailerId)}" data-switch-state="${on ? "on" : "off"}" data-ready="${cartAdds?.ready === true}">
    <div class="store-switch-main"><strong>${escapeHtml(store.retailerName)}</strong><small>${escapeHtml(pending ? "Updating…" : status)}</small></div>
    ${control}
    ${on ? `<button class="button quiet" data-store-test-call="${escapeHtml(store.retailerId)}" type="button" aria-label="${escapeHtml(`Send a test call for ${store.retailerName}`)}">Test call</button>` : ""}
    <button class="button quiet" data-store-setup="${escapeHtml(store.retailerId)}" type="button" aria-label="${escapeHtml(`${store.retailerName} details`)}">Details</button>
  </article>`;
}

// Setup › Stores: one switch per store. On means Yoink may add to the cart
// there after the same store check Admin uses; off means matches only alert.
function renderStoreSwitches() {
  const host = $("#storeSwitchList");
  if (!host) return;
  const stores = Array.isArray(state.storeSetups) ? state.storeSetups : [];
  if (!stores.length) {
    host.innerHTML = '<p class="field-help">No store status yet. Open Chrome with the Yoink companion, then come back.</p>';
    return;
  }
  const on = (store) => store.cartAdds?.state === "on";
  const main = stores.filter((store) => STORE_SWITCH_MAIN.includes(store.retailerId) || on(store));
  const more = stores.filter((store) => !main.includes(store));
  const paused = state.overview?.settings?.actionsPaused === true;
  host.innerHTML = `${paused && stores.some(on) ? `<p class="store-switch-note">Auto-cart is off, so stores that are on send alerts for now.${homePausedActionMarkup()}</p>` : ""}
    ${main.map(storeSwitchMarkup).join("")}
    ${more.length ? `<details class="store-switch-more"><summary>${more.length.toLocaleString()} more store${more.length === 1 ? "" : "s"}</summary>${more.map(storeSwitchMarkup).join("")}</details>` : ""}`;
}

// Setup › Stores › Test call (Kevin, 2026-10-08): one call for an item the
// shopper picks, so they can watch Chrome add it to the cart and open checkout
// without waiting for a restock. The server runs the usual checks; nothing is ordered.
async function openTestCall(retailerId) {
  const store = (state.storeSetups || []).find((item) => item.retailerId === retailerId);
  const name = store?.retailerName || "this store";
  state.testCall = { retailerId, name, items: null, saved: [], sending: false };
  $("#testCallTitle").textContent = `Test call at ${name}`;
  $("#testCallBody").innerHTML = '<p class="field-help">Checking your items…</p>';
  $("#testCallStatus").textContent = "";
  $("#testCallSend").disabled = true;
  if (!$("#testCallDialog").open) $("#testCallDialog").showModal();
  try {
    const { items, saved } = await api(`/api/v1/user/test-calls/candidates?retailerId=${encodeURIComponent(retailerId)}`);
    if (state.testCall?.retailerId !== retailerId) return;
    state.testCall.items = Array.isArray(items) ? items : [];
    state.testCall.saved = Array.isArray(saved) ? saved : [];
    renderTestCall();
  } catch (error) {
    $("#testCallBody").innerHTML = `<p class="inline-status error" role="alert">${escapeHtml(error.message || "Yoink couldn't load your items. Try again.")}</p>`;
  }
}

// A saved test item's stock as Chrome (or a call) last saw it, so the shopper
// picks one that's in stock (Kevin, 2026-10-12).
function savedTestStockMarkup(item) {
  if (!item.availabilityObservedAt) return "Stock not checked yet. Open its page in Chrome to check it.";
  const otherSeller = item.availabilitySellerType === "third_party" && item.availability !== "out_of_stock";
  const status = otherSeller ? "Only another seller has it" : labelFor(AVAILABILITY_LABELS, item.availability || "unknown");
  const price = item.priceCents && !otherSeller ? ` · ${escapeHtml(money(item.priceCents))}` : "";
  return `${escapeHtml(status)}${price} · ${item.availabilitySource === "browser" ? "checked" : "reported"} ${observationTimeMarkup(item.availabilityObservedAt)} · ${escapeHtml(observationSourceLabel(item.availabilitySource))}`;
}

function savedTestItemsMarkup(test) {
  if (!test.saved?.length) return "";
  const rows = test.saved.map((item) => `<div class="want-choice saved-test-item" data-saved-test-item="${escapeHtml(item.listingId)}">
      <span><strong>${escapeHtml(item.title)}</strong>
        <small data-saved-test-stock="${escapeHtml(item.availability || "")}">${savedTestStockMarkup(item)}</small>
        <small>Max ${escapeHtml(money(item.maxUnitPriceCents))} · quantity ${escapeHtml(String(item.quantity))} · tested ${observationTimeMarkup(item.testedAt)}</small></span>
      <span class="saved-test-actions">
        <button class="button secondary" data-test-again="${escapeHtml(item.listingId)}" type="button" ${test.sending ? "disabled" : ""}>Test again</button>
        <button class="button quiet" data-forget-test-item="${escapeHtml(item.listingId)}" type="button" aria-label="${escapeHtml(`Remove ${item.title} from saved test items`)}">Remove</button>
      </span></div>`).join("");
  return `<fieldset class="want-mode saved-test-items"><legend>Saved test items</legend>${rows}</fieldset>`;
}

function renderTestCall() {
  const test = state.testCall;
  if (!test?.items) return;
  const ready = test.items.filter((item) => item.ready);
  const rows = test.items.map((item, index) => `<label class="want-choice${item.ready ? "" : " disabled"}">
      <input type="radio" name="testCallListing" value="${escapeHtml(item.listingId)}" ${item.ready ? "" : "disabled"} ${item.ready && item === ready[0] ? "checked" : ""} data-index="${index}">
      <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.ready
        ? `${money(item.priceCents)} · your max ${money(item.maxUnitPriceCents)}${item.msrpCents ? ` · MSRP ${money(item.msrpCents)}` : ""}`
        : item.reason)}</small></span></label>`).join("");
  $("#testCallBody").innerHTML = `<p class="field-help">Yoink sends one call for the item you pick, at its last recorded price. Chrome adds it to your ${escapeHtml(test.name)} cart and opens checkout, the same as a real call. Nothing is ordered; remove it from your cart afterwards if you don't want it.</p>
    ${test.items.length ? `<fieldset class="want-mode"><legend>Item</legend>${rows}</fieldset>` : `<p class="field-help">You have no items set to Add to cart at ${escapeHtml(test.name)}. Use Want it on an item first.</p>`}
    ${test.items.length && !ready.length ? `<p class="field-help">None of these is ready for a test call yet.</p>` : ""}
    ${savedTestItemsMarkup(test)}
    <fieldset class="want-mode test-call-link"><legend>Or test any in-stock item</legend>
      <div class="form-row"><label><span>Product link</span><input name="testCallUrl" type="text" inputmode="url" autocomplete="off" placeholder="${test.retailerId === "bestbuy" ? "Paste a Best Buy product link or its SKU" : `Paste a ${escapeHtml(test.name)} product page link`}"></label>
      <label><span>Max price</span><input name="testCallMsrp" inputmode="decimal" autocomplete="off" placeholder="0.00"></label>
      <label><span>Quantity</span><select name="testCallQuantity">${Array.from({ length: 10 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join("")}</select></label></div>
      <small class="field-help">Pick something in stock, sold by ${escapeHtml(test.name)} itself. Yoink adds it at the store's price when that's at or under your max. The test sets it up just for this call, then keeps it under Saved test items to test again. If ${escapeHtml(test.name)} limits how many you can buy, Yoink adds as many as it allows.</small>
      <button class="button secondary" id="testCallLinkSend" type="button">Test this link</button>
    </fieldset>`;
  $("#testCallSend").disabled = !ready.length || test.sending;
}

async function sendTestCall() {
  const test = state.testCall;
  const listingId = $("#testCallForm").querySelector('input[name="testCallListing"]:checked')?.value || "";
  if (!test || test.sending || !listingId) return;
  const item = test.items.find((candidate) => candidate.listingId === listingId);
  test.sending = true;
  $("#testCallSend").disabled = true;
  $("#testCallStatus").textContent = "Sending…";
  try {
    const result = await api("/api/v1/user/test-calls", {
      method: "POST",
      body: JSON.stringify({ contractVersion: 1, listingId, confirmation: "SEND_TEST_CALL" })
    });
    $("#testCallDialog").close();
    if (result.actionJobState === "awaiting_executor") {
      toast(`Test call sent. Chrome will add ${item?.title || "the item"} to your ${test.name} cart and open checkout.`);
    } else {
      toast(`Test call sent, but Yoink didn't add it to the cart: ${result.reason || "it only alerted you."}`, true);
    }
    state.loadedRoutes.delete("cart");
    await refresh({ preservePagination: true });
  } catch (error) {
    test.sending = false;
    $("#testCallStatus").textContent = error.message || "The test call couldn't be sent. Try again.";
    $("#testCallStatus").classList.add("error");
    renderTestCall();
  }
}

// Called items are usually sold out when the shopper tests, so any in-stock item can be linked
// instead; a saved test item is sent again with its own link, max price and quantity.
async function sendTestCallLink(saved = null) {
  const test = state.testCall;
  const form = $("#testCallForm");
  if (!test || test.sending) return;
  const url = saved ? String(saved.canonicalUrl || "") : String(form.elements.testCallUrl?.value || "").trim();
  let msrpCents = null;
  try {
    msrpCents = saved ? Number(saved.maxUnitPriceCents)
      : centsInput(String(form.elements.testCallMsrp?.value || "").replace(/^\$\s*/, "").trim(), "Your max price");
  } catch (problem) {
    $("#testCallStatus").textContent = problem.message;
    $("#testCallStatus").classList.add("error");
    return;
  }
  if (!url || !msrpCents) {
    $("#testCallStatus").textContent = "Paste a product link and your max price.";
    $("#testCallStatus").classList.add("error");
    return;
  }
  const quantity = Math.min(10, Math.max(1, Number(saved ? saved.quantity : form.elements.testCallQuantity?.value) || 1));
  test.sending = true;
  $("#testCallLinkSend").disabled = true;
  document.querySelectorAll("[data-test-again]").forEach((button) => { button.disabled = true; });
  $("#testCallStatus").classList.remove("error");
  $("#testCallStatus").textContent = "Sending…";
  try {
    const result = await api("/api/v1/user/test-calls/link", {
      method: "POST",
      body: JSON.stringify({ contractVersion: 1, url, msrpCents, retailerId: test.retailerId, quantity, confirmation: "SEND_TEST_CALL" })
    });
    $("#testCallDialog").close();
    if (result.actionJobState === "awaiting_executor") {
      toast(`Test call sent. Chrome will add ${saved ? saved.title : "the linked item"} to your ${test.name} cart and open checkout.`);
    } else {
      toast(`Test call sent, but Yoink didn't add it to the cart: ${result.reason || "it only alerted you."}`, true);
    }
    state.loadedRoutes.delete("cart");
    await refresh({ preservePagination: true });
  } catch (error) {
    test.sending = false;
    $("#testCallLinkSend").disabled = false;
    document.querySelectorAll("[data-test-again]").forEach((button) => { button.disabled = false; });
    $("#testCallStatus").textContent = error.message || "The test call couldn't be sent. Try again.";
    $("#testCallStatus").classList.add("error");
  }
}

async function forgetSavedTestItem(listingId) {
  const test = state.testCall;
  if (!test) return;
  try {
    await api(`/api/v1/user/test-calls/saved/${encodeURIComponent(listingId)}`, { method: "DELETE" });
    test.saved = (test.saved || []).filter((item) => item.listingId !== listingId);
    renderTestCall();
  } catch (error) {
    $("#testCallStatus").textContent = error.message || "Yoink couldn't remove it. Try again.";
    $("#testCallStatus").classList.add("error");
  }
}

$("#testCallForm").addEventListener("submit", (event) => {
  event.preventDefault();
  void sendTestCall();
});

async function flipStoreSwitch(button) {
  const retailerId = String(button.dataset.storeSwitch || "");
  const store = (state.storeSetups || []).find((item) => item.retailerId === retailerId);
  const cartAdds = store?.cartAdds;
  if (!store || !cartAdds || state.storeSwitchPending.has(retailerId)) return;
  const turningOn = cartAdds.state !== "on";
  const name = store.retailerName;
  const testMode = state.overview?.settings?.executionMode !== "live";
  const joining = Math.max(0, Number(cartAdds.wantsToJoin || 0));
  const decision = await requestConfirmation(turningOn ? {
    title: `Turn on cart adds at ${name}?`,
    summary: `When a call matches something you want, Yoink adds one to your ${name} cart: the exact item, sold by ${name}, at or under your max price. You still check out yourself.`,
    scope: [
      joining ? `${name} joins ${joining.toLocaleString()} wanted item${joining === 1 ? "" : "s"} set to Add to cart, at the same max price${joining === 1 ? "" : "s"}.` : "",
      testMode ? "Test mode ends, so matches can add to cart." : ""
    ].filter(Boolean),
    confirmLabel: `Turn on ${name}`
  } : {
    title: `Turn off cart adds at ${name}?`,
    summary: `Matches at ${name} send alerts instead. Your wanted items stay as they are. Turning it back on needs a fresh store check.`,
    confirmLabel: `Turn off ${name}`,
    danger: true
  });
  if (!decision.confirmed) return;
  state.storeSwitchPending.add(retailerId);
  renderStoreSwitches();
  try {
    const result = await api(`/api/v1/user/stores/${encodeURIComponent(retailerId)}/${turningOn ? "turn-on" : "turn-off"}`, {
      method: "POST",
      body: JSON.stringify({ confirmation: turningOn ? "TURN_ON_STORE_CART_ADDS" : "TURN_OFF_STORE_CART_ADDS" })
    });
    if (result.store) state.storeSetups = state.storeSetups.map((item) => item.retailerId === retailerId ? result.store : item);
    if (result.disposition === "pending_approval") toast(`Turning on ${name} needs approval. It stays off until then.`);
    else if (turningOn) {
      const updated = Number(result.wants?.updated || 0);
      const skipped = Array.isArray(result.wants?.skipped) ? result.wants.skipped : [];
      toast(`${name} is on.${updated ? ` ${updated.toLocaleString()} wanted item${updated === 1 ? " now adds" : "s now add"} to cart there.` : ""}`);
      if (skipped.length) {
        setInlineStatus($("#storeSwitchList"), {
          state: "info",
          message: `${skipped.length.toLocaleString()} wanted item${skipped.length === 1 ? "" : "s"} kept ${skipped.length === 1 ? "its" : "their"} stores: ${skipped.map((item) => item.title || "an item").join(", ")}. Edit ${skipped.length === 1 ? "it" : "them"} in Wanted to add ${name}.`
        });
      }
    } else toast(`${name} is off. Matches there send alerts.`);
  } catch (error) {
    const action = error.code === "store_check_needed" || error.code === "companion_needed"
      ? { label: "Details", onClick: () => openStoreSetup(retailerId, "", null) } : null;
    toast(error.message || `${name} could not be changed. Try again.`, true, action ? { action } : {});
  } finally {
    state.storeSwitchPending.delete(retailerId);
    state.loadedRoutes.delete("setup");
    state.loadedRoutes.delete("cart");
    await refresh({ preservePagination: true });
  }
}

// Setup › Stores › Retry when sold out (Kevin, 2026-10-09): tries spread over
// a window after a cart add finds the item sold out, in the same tab.
const RESTOCK_RETRY_FALLBACK = { enabled: false, attempts: 3, windowMinutes: 10 };
function restockRetrySummary(value) {
  if (!value.enabled) return "Off: a sold-out item waits for the next call.";
  const spacingSeconds = Math.max(30, Math.floor(value.windowMinutes * 60 / value.attempts));
  const every = spacingSeconds >= 60
    ? `${Math.floor(spacingSeconds / 60)} min${spacingSeconds % 60 ? ` ${spacingSeconds % 60} s` : ""}`
    : `${spacingSeconds} s`;
  return `Up to ${value.attempts} more ${value.attempts === 1 ? "try" : "tries"}, about every ${every}, within ${value.windowMinutes} ${value.windowMinutes === 1 ? "minute" : "minutes"} of the first. Each try checks the price, seller and stock again before adding, and never adds a second one.`;
}

function readRestockRetryForm() {
  const form = $("#restockRetryForm");
  return {
    enabled: form.elements.enabled.checked,
    attempts: Number(form.elements.attempts.value),
    windowMinutes: Number(form.elements.windowMinutes.value)
  };
}

function renderRestockRetry() {
  const form = $("#restockRetryForm");
  if (!form || form.dataset.dirty === "true") return;
  const value = { ...RESTOCK_RETRY_FALLBACK, ...(state.overview?.settings?.restockRetry || {}) };
  form.elements.enabled.checked = value.enabled === true;
  form.elements.attempts.value = String(value.attempts);
  form.elements.windowMinutes.value = String(value.windowMinutes);
  form.querySelector(".restock-retry-fields").hidden = !value.enabled;
  $("#restockRetrySummary").textContent = restockRetrySummary(value);
}

function renderSetup() {
  renderStoreSwitches();
  renderRestockRetry();
  renderPairedDevices();
  renderDiscordSetup();
  renderPairing();
  renderDeliveryCard();
  renderHomeDelivery();
  renderActionPlatform();
  renderPrivacy();
  if (state.overview?.spend) renderSpend(state.overview.spend);
  setSetupSection(state.setupSection, { historyMode: "none", scroll: false });
}

function renderUserRoute(route) {
  if (route === "cart") { renderHomeSections(); renderPlans(); }
  if (route === "find") renderProducts();
  if (route === "calls") renderCalls();
  if (route === "activity") renderActions();
  if (route === "setup") renderSetup();
  renderRouteLoadError(route);
  void restoreEntityDetail();
}

function renderRouteLoadError(route) {
  const panel = document.querySelector(`[data-panel="${route}"]`);
  if (!panel) return;
  panel.querySelector("[data-route-load-error]")?.remove();
  const error = state.routeLoadErrors.get(route);
  if (!error) return;
  const alert = document.createElement("div");
  alert.className = "inline-status error";
  alert.dataset.routeLoadError = route;
  alert.setAttribute("role", "alert");
  const message = document.createElement("span");
  message.className = "inline-status-message";
  const sections = Array.isArray(error.sections) ? error.sections : [];
  message.textContent = sections.length
    ? `Couldn't load ${sections.join(", ")}. What's shown for ${sections.length === 1 ? "it" : "them"} may be out of date or missing.`
    : state.loadedRoutes.has(route)
      ? "Some information could not be loaded. Existing information may be out of date."
      : "This workspace could not load. Check your connection and try again.";
  const retry = document.createElement("button");
  retry.className = "inline-status-action";
  retry.type = "button";
  retry.dataset.retryRoute = route;
  retry.textContent = "Retry";
  alert.append(message, retry);
  panel.prepend(alert);
}

function showRouteFailure(route, error) {
  state.routeLoadErrors.set(route, { code: String(error?.code || "request_failed") });
  const panel = document.querySelector(`[data-panel="${route}"]`);
  panel?.querySelectorAll(".skeleton-list").forEach((node) => node.remove());
  renderRouteLoadError(route);
  setUserDataStale(true);
}

async function loadUserRoute(route, options = {}) {
  try {
    return await loadUserRouteData(route, options);
  } catch (error) {
    showRouteFailure(route, error);
    return false;
  }
}

async function loadUserRouteData(route, { force = false, preservePagination = false } = {}) {
  if (!force && state.loadedRoutes.has(route)) {
    renderUserRoute(route);
    return true;
  }
  state.routeLoadErrors.delete(route);
  const loadStamp = { at: Date.now(), cursor: actionHandoffCursorKey() };
  // A failed secondary request resolves to null and the caller keeps what it
  // already had: an empty fallback would render as "nothing set up" and invite
  // the user to act on false-empty data. The banner names what is missing.
  const routeRequest = (path, section) => {
    const request = api(path);
    return preservePagination ? request : request.catch((error) => {
      const previous = state.routeLoadErrors.get(route);
      const sections = [...new Set([...(previous?.sections || []), section].filter(Boolean))];
      state.routeLoadErrors.set(route, { path, code: String(error?.code || "request_failed"), sections });
      return null;
    });
  };
  if (route === "cart") {
    // Carts waiting for checkout come from the action list only when the
    // compact handoff says there are any; most visits skip that request.
    const counts = state.overview?.actionHandoff?.counts || {};
    const waiting = Number(counts.readyToCheckout || 0) + Number(counts.needsYou || 0);
    const [dropWindowResponse, recentActions, recentCalls, legacyTransition, cartJobs] = await Promise.all([
      routeRequest("/api/v1/user/drop-windows", "drop times"),
      routeRequest("/api/v1/user/jobs?limit=5&offset=0&q=user_reported_", "recent results"),
      routeRequest(`/api/v1/user/calls?limit=${HOME_CALL_LOG_FETCH}`, "calls"),
      routeRequest("/api/v1/user/purchase-intents/legacy-transition", "imported items"),
      waiting > 0 ? routeRequest("/api/v1/user/jobs?limit=100&offset=0", "carts ready to check out") : Promise.resolve(null),
      refreshPlans()
    ]);
    if (dropWindowResponse) state.dropWindows = dropWindowResponse.items || [];
    if (recentCalls) {
      state.homeCalls = (recentCalls.items || []).filter((call) => call.kind === "signal");
      state.homeCallSummary = recentCalls.summary || null;
    }
    if (recentActions) {
      state.homeRecentActions = (recentActions.items || [])
        .filter((action) => ["got_it", "missed_it"].includes(String(action.userReportOutcome)))
        .sort((first, second) => new Date(second.userReportedAt || second.createdAt || 0).getTime()
          - new Date(first.userReportedAt || first.createdAt || 0).getTime())
        .slice(0, 5);
    }
    if (legacyTransition) state.legacyTransition = legacyTransition.preview || null;
    if (cartJobs) state.cartActions = (cartJobs.items || []).filter(closeableCartAction);
    else if (waiting === 0) state.cartActions = [];
    scheduleDropClock();
  } else if (route === "find") {
    const requestSequence = state.productRequestSequence + 1;
    state.productRequestSequence = requestSequence;
    const [products, proposals] = await Promise.all([
      fetchLoadedPages((offset) => productLibraryPath(offset), preservePagination ? loadedProductLimit() : state.productPageSize),
      routeRequest("/api/v1/user/catalog/proposals?limit=100&offset=0", "product suggestions")
    ]);
    // A newer load owns the list; this one is superseded, not failed.
    if (requestSequence !== state.productRequestSequence) return "superseded";
    applyProductPage(products);
    if (proposals) {
      state.proposals = proposals.items || [];
      state.proposalTotal = Number(proposals.total ?? state.proposals.length);
    }
  } else if (route === "calls") {
    const [dropWindows, actionPlatform] = await Promise.all([
      routeRequest("/api/v1/user/drop-windows", "drop times"),
      routeRequest("/api/v1/user/action-platform", "store action status"),
      refreshCalls(),
      state.callFilter === "discord" ? refreshDiscordCalls().catch(() => undefined) : Promise.resolve()
    ]);
    if (dropWindows) state.dropWindows = dropWindows.items || [];
    if (actionPlatform) state.actionPlatform = actionPlatform;
    scheduleDropClock();
  } else if (route === "activity") {
    await refreshActionActivity();
  } else if (route === "setup") {
    const sequence = ++state.preferenceRequestSequence;
    const [privacy, actionPlatform, devicePage, discord] = await Promise.all([
      api("/api/v1/user/privacy"),
      routeRequest("/api/v1/user/action-platform", "store status"),
      api("/api/v1/user/devices"),
      routeRequest("/api/v1/user/discord", "Discord"),
      state.setupSection === "alerts" ? loadConnectorHistory().catch(() => undefined) : Promise.resolve()
    ]);
    if (sequence !== state.preferenceRequestSequence) return "superseded";
    if (discord) state.discord = discord;
    state.devices = devicePage.items || [];
    state.privacy = privacy.inventory || null;
    state.privacyCompliance = privacy.compliance || state.privacyCompliance;
    if (actionPlatform) {
      state.actionPlatform = actionPlatform;
      if (Array.isArray(actionPlatform.storeSetup)) state.storeSetups = actionPlatform.storeSetup;
    }
  }
  const complete = !state.routeLoadErrors.has(route);
  if (complete) {
    state.loadedRoutes.add(route);
    state.routeLoadStamps.set(route, loadStamp);
  } else state.loadedRoutes.delete(route);
  renderUserRoute(route);
  return complete;
}

async function loadMoreProducts() {
  const requestSequence = state.productRequestSequence;
  const products = await api(productLibraryPath(state.productGroups.length));
  if (requestSequence !== state.productRequestSequence) return false;
  applyProductPage(products, true);
  renderProducts();
  return true;
}

async function refresh(options = {}) {
  try { return await refreshDashboard(options); }
  catch (error) { showRouteFailure(activeUserRoute(), error); return false; }
}

async function refreshDashboard({ priorityRoute = "", priorityRouteLoad = null, preservePagination = false } = {}) {
  const route = activeUserRoute();
  const handoffRequestSequence = nextActionHandoffRequestSequence();
  // Visibility resume, retry and post-mutation refreshes overlap. An overview
  // that started before a newer one was applied (e.g. before a Pause PATCH)
  // must not overwrite it; the newer refresh owns the page.
  const overviewSequence = ++state.overviewRequestSequence;
  showUserRouteSkeleton(route);
  const [overview, affiliateRouting] = await Promise.all([
    api("/api/v1/user/overview"),
    state.affiliateRouting
      ? Promise.resolve({ affiliateRouting: state.affiliateRouting })
      : api("/api/v1/affiliate-routing").catch(() => null)
  ]);
  if (overviewSequence < state.overviewAppliedSequence) return "superseded";
  state.overviewAppliedSequence = overviewSequence;
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
  for (const cached of ["cart", "find", "calls", "setup"]) if (cached !== route) state.loadedRoutes.delete(cached);
  let routeComplete = true;
  if (priorityRoute === route && priorityRouteLoad) {
    if (await priorityRouteLoad) {
      state.loadedRoutes.add(route);
      renderUserRoute(route);
    } else {
      routeComplete = await loadUserRoute(route, { force: true, preservePagination });
    }
  } else {
    routeComplete = await loadUserRoute(route, { force: true, preservePagination });
  }
  setUserDataStale(!routeComplete);
  return routeComplete;
}

function applyActionActivity(actions) {
  state.actions = actions?.items || [];
  state.actionTotal = Number(actions?.total ?? state.actions.length);
  state.actionInsights = actions?.insights || null;
  state.actionGlossary = actions?.glossary || {};
}

async function refreshActionActivity() {
  const requestSequence = state.actionActivityRequestSequence + 1;
  state.actionActivityRequestSequence = requestSequence;
  const actions = await fetchLoadedPages((offset) => activityPath(offset), Math.max(100, state.actions.length));
  if (requestSequence < state.actionActivityAppliedSequence) return false;
  state.actionActivityAppliedSequence = requestSequence;
  applyActionActivity(actions);
  renderActions();
  return true;
}

// Refresh all previously loaded pages so background refresh never removes older records.
async function fetchLoadedPages(path, count) {
  let result;
  const items = new Map();
  for (let offset = 0; offset < count;) {
    const page = await api(path(offset));
    result = page;
    for (const item of page.items || []) items.set(item.id || item.variantId, item);
    offset += (page.items || []).length;
    if (!page.items?.length || offset >= Number(page.total ?? offset)) break;
  }
  return { ...result, items: [...items.values()] };
}

async function refreshPlans() {
  const sequence = ++state.planRequestSequence;
  const view = state.planView === "add_to_cart" || state.planView === "notify" ? { action: state.planView }
    : state.planView === "paused" ? { status: "paused" } : {};
  const query = new URLSearchParams({ limit: String(state.planPageSize), offset: String(state.planOffset), q: state.planQuery, ...view });
  const page = await api(`/api/v1/user/purchase-intents?${query}`);
  if (sequence !== state.planRequestSequence) return;
  state.plans = page.items || [];
  state.planTotal = Number(page.total ?? state.plans.length);
  if (!state.plans.length && state.planOffset > 0) {
    state.planOffset = Math.max(0, Math.floor((state.planTotal - 1) / state.planPageSize) * state.planPageSize);
    return refreshPlans();
  }
}

function applyCalls(page, append = false) {
  const byId = new Map((append ? state.calls : []).map((call) => [call.id, call]));
  for (const call of page.items || []) byId.set(call.id, call);
  state.calls = [...byId.values()].sort((a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0) || b.id.localeCompare(a.id));
  state.callTotal = Number(page.total ?? state.calls.length);
  state.callNextOffset = Number(page.nextSignalOffset || 0);
  state.callHasMore = page.hasMore === true;
}

async function refreshCalls() {
  const sequence = ++state.callRequestSequence;
  const loaded = Math.max(100, state.callNextOffset);
  const byId = new Map();
  let page;
  for (let offset = 0; offset < loaded;) {
    page = await api(`/api/v1/user/calls?offset=${offset}`);
    for (const call of page.items || []) byId.set(call.id, call);
    if (!page.hasMore || page.nextSignalOffset <= offset) break;
    offset = page.nextSignalOffset;
  }
  if (sequence !== state.callRequestSequence) return;
  applyCalls({ ...page, items: [...byId.values()] });
}

async function refreshCompactActionHandoff(waitMs = 0) {
  const requestSequence = nextActionHandoffRequestSequence();
  const boundedWaitMs = Math.max(0, Math.min(5_000, Math.floor(Number(waitMs) || 0)));
  const epoch = normalizedActionHandoffEpoch(state.actionHandoffAvailabilityEpoch) || "";
  const version = normalizedActionHandoffVersion(state.actionHandoffAvailabilityVersion) ?? 0;
  const epochQuery = epoch ? `&epoch=${encodeURIComponent(epoch)}` : "";
  const payload = await api(`/api/v1/user/action-handoff?wait=${boundedWaitMs}&version=${version}${epochQuery}`);
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

// A full list reload refetches every loaded page and rebuilds the DOM, so the
// fast (3 s) cadence polls only the compact versioned handoff and reloads the
// visible list when that cursor moved, or when the list is older than the idle
// cadence.
const LIST_ROUTE_MAX_AGE_MS = 30_000;
function actionHandoffCursorKey() {
  return `${state.actionHandoffAvailabilityEpoch ?? ""}:${state.actionHandoffAvailabilityVersion ?? ""}`;
}

async function refreshVisibleActionState(waitMs = 0) {
  const route = activeUserRoute();
  if (route === "activity") return refreshActionActivity();
  const handoff = refreshCompactActionHandoff(waitMs);
  if (!["cart", "find", "calls"].includes(route)) return handoff;
  await handoff;
  const loaded = state.routeLoadStamps.get(route);
  if (loaded && state.loadedRoutes.has(route) && loaded.cursor === actionHandoffCursorKey()
    && Date.now() - loaded.at < LIST_ROUTE_MAX_AGE_MS) return;
  const complete = await loadUserRoute(route, { force: true, preservePagination: true });
  if (complete === false) throw new Error("The visible workspace refresh was incomplete.");
}

function actionToggleErrorCopy(error, pausing) {
  const code = String(error?.code || "");
  const status = Number(error?.status || 0);
  if (code === "authentication_required" || status === 401 || status === 403) {
    return "Sign in again to change Auto-cart.";
  }
  if (!pausing && (code === "resume_blocked" || code === "request_rejected")) {
    // The server names the blocker; its words are the dashboard's words. The
    // raw error message carries the request reference, so it is never shown.
    const blocker = error?.details?.blockers?.[0]?.message;
    if (!blocker && code === "request_rejected") return "Auto-cart could not be turned on. Review what it allows and try again.";
    return String(blocker || RESUME_BLOCKED_FALLBACK)
      .replace(/in Stores before/, "before");
  }
  if (!pausing && code === "resume_pending_approval") return "Turning Auto-cart on is already waiting for approval.";
  if (!pausing && code === "resume_scope_changed") return "What Auto-cart allows changed. Review it and turn it on again.";
  return pausing ? "Auto-cart could not be turned off. Try again." : "Auto-cart could not be turned on. Try again.";
}

function resumeErrorToastOptions(error) {
  const nextAction = error?.details?.nextAction;
  if (!nextAction?.kind) return {};
  return {
    action: {
      label: nextAction.label || "Next step",
      onClick: async () => {
        const proxy = { dataset: { resumeNextAction: nextAction.kind, resumeRetailer: nextAction.retailerId || "", resumeRoute: nextAction.route || "" } };
        await followResumeNextAction(proxy);
      }
    }
  };
}

async function toggleActions(options = {}) {
  if (!state.overview?.settings) {
    toast("Yoink is still loading. Retry in a moment.", true);
    return;
  }
  // Undo passes an explicit direction: inferring it from state.overview would
  // re-send "pause" when the refresh after the pause failed and state is stale.
  const paused = typeof options.paused === "boolean" ? options.paused : state.overview.settings.actionsPaused !== true;
  const resume = resumePreflight();
  if (!paused) {
    // Resuming is the step that lets Yoink touch a cart, so it confirms with
    // the server's own summary of what goes live. Pausing stays one tap.
    if (!resume.allowed) {
      const blocker = resume.blockers?.[0];
      toast(blocker?.message || RESUME_BLOCKED_FALLBACK, true, resumeErrorToastOptions({ details: { nextAction: blocker?.nextAction || resume.nextAction } }));
      return;
    }
    if (!options.skipConfirmation) {
      const confirmation = resume.confirmation || {};
      // The switch is named Auto-cart; the server's summary and scope say what goes live.
      const decision = await requestConfirmation({
        title: "Turn on Auto-cart?",
        summary: confirmation.summary || "Yoink may add one item to a cart when a call matches something you want.",
        scope: Array.isArray(resume.summary) ? resume.summary : [],
        confirmLabel: "Turn on Auto-cart"
      });
      if (!decision.confirmed) return;
    }
  }
  let result;
  try {
    result = await api("/api/v1/user/settings/actions", {
      method: "PATCH",
      body: JSON.stringify({
        paused,
        reason: paused ? "Paused from the user dashboard." : "Resumed from the user dashboard.",
        // Ties the resume to the summary the shopper just confirmed; the
        // server refuses it if what resuming allows has changed since.
        ...(!paused && resume.confirmationToken ? { confirmationToken: String(resume.confirmationToken) } : {})
      })
    });
  } catch (error) {
    // Store-check failures come back as engineering copy; keep the dashboard in plain words.
    const plain = new Error(actionToggleErrorCopy(error, paused));
    plain.code = error?.code;
    plain.reference = error?.reference;
    plain.details = error?.details;
    toast(plain.message, true, { reference: plain.reference, ...resumeErrorToastOptions(error) });
    // A stale confirmation means the summary changed; show the current one.
    if (error?.code === "resume_scope_changed") await refresh();
    return;
  }
  await refresh();
  if (result.disposition === "pending_approval") {
    toast("Turning Auto-cart on needs approval. It stays off until then.");
    return;
  }
  if (paused) {
    const undoable = resume.presentation !== "setting_up" && resumePreflight().allowed;
    toast("Auto-cart is off. Calls are still logged.", false, undoable ? {
      action: { label: "Undo", onClick: () => toggleActions({ paused: false, skipConfirmation: true }) }
    } : {});
    return;
  }
  toast("Auto-cart is on. Yoink adds wanted items at stores that are on, within your limits.");
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
  // Amazon, Target, Walmart and Best Buy add several in one go (Kevin, 2026-10-10); other stores one at a time.
  return Number.isInteger(quantity) && quantity === 1 ? "Yoink adds one to your cart."
    : `Yoink adds up to ${Number.isInteger(quantity) && quantity > 0 ? quantity : "N"}, never more than the store allows per order.`;
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
    <div><small>Spending limit</small><b>${cost.spendingLimit?.allowed === false ? "Needs change" : "Within limits"}</b></div>
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
  $("#createPlanButton").disabled = !state.setupPreflight
    || state.setupPreflight.cost?.spendingLimit?.allowed === false
    || reviewed.checked !== true;
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
    if (preflight.cost?.autoRaised && Number.isSafeInteger(preflight.draft.maxAllInCents)) {
      $("#setupForm").elements.maxAllIn.value = moneyInput(preflight.draft.maxAllInCents);
    }
    state.setupPreflightSignature = setupPreflightInputSignature();
    syncSetupAction();
    renderSetupReview();
    const readiness = preflight.automationReadiness || {};
    const spendingBlocked = preflight.cost?.spendingLimit?.allowed === false;
    renderSetupPreflight(
      spendingBlocked ? "error" : "ready",
      spendingBlocked ? "Review your spending limits" : "Ready for your review",
      spendingBlocked
        ? `${preflight.cost.spendingLimit.message} Lower this plan's maximum or change the spending limit before saving.`
        : `After saving: ${readiness.headline || "the plan will use these limits"}. ${readiness.summary || "Fresh offer checks still apply."} No plan was saved by this check.`,
      preflight
    );
    $("#setupForm").elements.reviewed.disabled = spendingBlocked;
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
    ? firstPlanIntent() === "add_to_cart"
      ? "This product supports notifications only. Review that action before saving."
      : "Notification mode only for this store."
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
  const product = productForListing(listingId);
  if (!product) throw new Error("That product is no longer in this catalog view. Refresh and try again.");
  const group = state.productGroups.find((item) => item.variantId === product.variantId);
  const call = state.calls.find((item) => item.listingId === listingId);
  const existing = group && Object.hasOwn(group, "purchaseIntent") ? group.purchaseIntent : call && Object.hasOwn(call, "purchaseIntent") ? call.purchaseIntent : state.plans.find((plan) => plan.variantId === product.variantId);
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
  const intent = firstPlanIntent();
  form.elements.actionCeiling.value = intent === "add_to_cart" && !addRadio.disabled ? "add_to_cart" : "notify";
  const exactVariant = variantSummary(product.variantAttributes);
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

function savedTargetReadiness(target, mission) {
  if (!target.enabled) return "This store is not used.";
  if (mission.status !== "active") return `Plan ${planStatusLabel(mission.status).toLowerCase()}.`;
  const readiness = mission.automationReadiness;
  if (readiness?.configuredAction === "notify" || mission.intentPolicy?.actionCeiling === "notify") {
    return `Notifications selected. ${readiness?.headline || "Monitoring readiness unavailable."}`;
  }
  const result = readiness?.targets?.find(item => item.targetId === target.id);
  if (result?.readyForGuardedAdd === true && readiness.readyForGuardedAdd === true) {
    return "Ready for calls. Chrome checks each offer before adding one item.";
  }
  return result?.reasonCode !== "runtime_offer_required" && result?.summary
    ? result.summary : readiness?.headline || "Store readiness unavailable. Review setup before expecting cart adds.";
}

async function openPlan(id, { routed = false } = {}) {
  const panel = activeUserRoute();
  const request = ++state.entityRequestSequence;
  const key = entityKey();
  const { purchaseIntent: mission } = await api(`/api/v1/user/purchase-intents/${encodeURIComponent(id)}`);
  if (request !== state.entityRequestSequence || panel !== activeUserRoute() || (routed && entityKey() !== key)) return;
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
  $("#planStoreSetup").innerHTML = [...new Set(mission.targets
    .filter(target => target.executionSupported === true && isGuardedStore(target.retailerId))
    .map(target => target.retailerId))].map(retailerId => storeSetupButton(retailerId, mission.id)).join("");
  $("#targetEditors").innerHTML = mission.targets.map((target) => {
    const legacyFulfillmentMapped = target.legacyFulfillmentMapped === true || target.fulfillment === "manual";
    const fulfillment = shopperFulfillment(target.fulfillment);
    const cartSupported = target.executionSupported === true && isGuardedStore(target.retailerId);
    return `<article class="target-editor" data-target-id="${escapeHtml(target.id)}" data-retailer-id="${escapeHtml(target.retailerId)}" data-execution-supported="${cartSupported}" data-last-observed-price-cents="${Number.isSafeInteger(Number(target.lastObservedPriceCents)) ? Number(target.lastObservedPriceCents) : ""}">
      <div class="card-top"><div><strong>${escapeHtml(target.retailerName)}</strong><small class="target-capability">${cartSupported ? "Browse, notifications, and cart adds supported." : "Browse and notifications supported. Cart adds unavailable."}</small><p>${escapeHtml(target.retailerSku)} · ${escapeHtml(money(target.lastObservedPriceCents, target.currency))}</p></div>${retailerLinkMarkup(target.canonicalUrl, mission.title, "View ↗")}</div>
      <p class="target-readiness"><strong>Saved plan:</strong> ${escapeHtml(savedTargetReadiness(target, mission))}</p>
      ${cartSupported ? "" : '<p class="boundary-note" data-cart-exclusion hidden></p>'}
      <div class="target-fields">
        <label class="check"><input data-field="enabled" type="checkbox" ${target.enabled ? "checked" : ""}><span>Use store</span></label>
        <label><span>Maximum price</span><input data-field="maxPrice" inputmode="decimal" placeholder="Rule limit" value="${target.maxUnitPriceCents ? (target.maxUnitPriceCents / 100).toFixed(2) : ""}"></label>
        <div class="field-note target-fixed-seller"><strong>Seller</strong><span>Store only</span></div>
        <label><span>Delivery</span><select data-field="fulfillment" aria-describedby="planFulfillmentHelp"><option value="shipping" ${fulfillment === "shipping" ? "selected" : ""}>Shipping</option><option value="pickup" ${fulfillment === "pickup" ? "selected" : ""}>Pickup</option></select></label>
        ${legacyFulfillmentMapped ? '<p class="boundary-note legacy-fulfillment-note">This legacy Manual setting is shown as Shipping. Save the plan to confirm the change.</p>' : ""}
      </div>
    </article>`;
  }).join("");
  const supportedTargets = mission.targets.filter((target) => target.executionSupported === true && isGuardedStore(target.retailerId));
  form.elements.actionCeiling.querySelector('option[value="add_to_cart"]').disabled = supportedTargets.length < 1;
  $("#prepareGuardedPlanButton").hidden = supportedTargets.length < 1;
  syncPlanAction();
  $("#planDialog").showModal();
  if (!routed) { state.entity = { kind: "plan", id, panel: activeUserRoute() }; writeUserRoute("push", activeUserRoute()); $("#planDialog").dataset.entityKey = entityKey(); }
}

function planTargetDrafts(form, strict = false) {
  return $$("[data-target-id]", form).map((card) => {
    const rawPrice = $("[data-field=maxPrice]", card).value.trim();
    const dollars = rawPrice ? (strict ? centsInput(rawPrice, "Maximum item price") / 100 : Number(rawPrice)) : null;
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
        // Keep this choice only for the current editor. Saving cart mode still
        // excludes this store; switching back before saving restores the draft.
        if (!Object.hasOwn(card.dataset, "notificationEnabled")) card.dataset.notificationEnabled = String(enabledControl.checked);
        enabledControl.checked = false;
      } else if (enabledControl.checked) {
        if ($("[data-field=fulfillment]", card).value !== "pickup") {
          $("[data-field=fulfillment]", card).value = "shipping";
        }
      }
    }
    if (!adding && Object.hasOwn(card.dataset, "notificationEnabled")) {
      enabledControl.checked = card.dataset.notificationEnabled === "true";
      delete card.dataset.notificationEnabled;
    }
    const exclusion = $("[data-cart-exclusion]", card);
    if (exclusion) {
      exclusion.hidden = !adding;
      exclusion.textContent = card.dataset.notificationEnabled === "true"
        ? "Not used in cart mode. Switch back to Notify only before saving to restore this store."
        : "This store supports notifications only and is not used in cart mode.";
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
            : `The reviewed total covers the current ${money(minimum)} tax and store-fee reserve. Each cart attempt adds what the plan still needs, never more than the store allows, and Chrome rechecks the live offer.`;
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

function renderPairedDevices() {
  // Each active companion also says when it last asked for calls (W2).
  const polls = new Map((deliveryHealthOf(state.overview)?.channel?.devices || []).map((device) => [device.id, device]));
  const row = (device) => {
    const poll = device.status === "active" && polls.has(device.id) ? devicePollSummary(polls.get(device.id)) : null;
    return `<div class="mini-row"><span><strong>${escapeHtml(device.name || "Chrome browser")}</strong><small>v${escapeHtml(device.extensionVersion)} · ${escapeHtml(device.status === "revoked" ? "Revoked" : device.online ? "Online" : "Offline")} · Last seen ${escapeHtml(relative(device.lastSeenAt))}</small>${poll ? `<small class="delivery-poll ${poll.tone}">${escapeHtml(poll.text)}</small>` : ""}</span><span class="inline-actions"><button type="button" class="button quiet" data-rename-browser="${escapeHtml(device.id)}">Rename</button>${device.status === "revoked" ? '<button type="button" class="button quiet" data-repair-browser>Pair again</button>' : ""}${device.status === "active" ? `<button type="button" class="button quiet" data-revoke-browser="${escapeHtml(device.id)}">Revoke</button>` : ""}</span></div>`;
  };
  // Revoked browsers are history; they fold away under the current ones.
  const current = state.devices.filter((device) => device.status !== "revoked");
  const revoked = state.devices.filter((device) => device.status === "revoked");
  $("#pairedDevices").innerHTML = `${current.map(row).join("") || "<p>No paired browsers yet.</p>"}${revoked.length
    ? `<details class="revoked-browsers"><summary>${revoked.length.toLocaleString()} revoked browser${revoked.length === 1 ? "" : "s"}</summary>${revoked.map(row).join("")}</details>` : ""}`;
}

function renderPairing() {
  if (!state.pairing) return;
  const paired = state.devices.some((device) => device.status === "active" && !state.pairing.deviceIds.includes(device.id));
  const seconds = Math.max(0, Math.ceil((new Date(state.pairing.expiresAt).getTime() - Date.now()) / 1000));
  const panel = $("#pairing");
  if (paired || !seconds) {
    clearInterval(state.pairingTimer);
    state.pairingTimer = null;
    panel.innerHTML = paired ? '<strong role="status">Chrome paired successfully</strong><p>Choose a store in the extension to finish its setup.</p>' : '<strong role="status">Pairing code expired</strong><button type="button" class="button secondary" id="regeneratePairing">Create a new code</button>';
    state.pairing.code = "";
    return;
  }
  if (!panel.querySelector("#pairingCountdown")) panel.innerHTML = `<span>One-time code</span><strong>${escapeHtml(state.pairing.code)}</strong><button type="button" class="button quiet" id="copyPairing">Copy code</button><small id="pairingCountdown"></small>`;
  $("#pairingCountdown").textContent = `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// The pairing panel can only see a new device if state.devices changes, and
// nothing else refreshes it while the user pairs from the extension popup
// without leaving this tab. Poll the device list every few seconds while a
// code is live; the countdown still ticks every second.
const PAIRING_DEVICE_POLL_MS = 3_000;
function pairingTick() {
  renderPairing();
  const pairing = state.pairing;
  if (!pairing?.code || pairing.devicePollInFlight) return;
  if (Date.now() - Number(pairing.devicesCheckedAt || 0) < PAIRING_DEVICE_POLL_MS) return;
  pairing.devicePollInFlight = true;
  pairing.devicesCheckedAt = Date.now();
  api("/api/v1/user/devices")
    .then((page) => {
      if (state.pairing !== pairing || !pairing.code) return;
      state.devices = page.items || [];
      renderPairedDevices();
      renderPairing();
    })
    .catch(() => undefined)
    .finally(() => { pairing.devicePollInFlight = false; });
}

async function createPairingCode(showPreferences = false) {
  if (showPreferences) { setTab("setup"); setSetupSection("chrome", { historyMode: "replace" }); }
  const current = await api("/api/v1/user/devices");
  state.devices = current.items || [];
  const result = await api("/api/v1/user/devices/pairing-code", { method: "POST", body: "{}" });
  clearInterval(state.pairingTimer);
  state.pairing = { ...result.pairing, deviceIds: state.devices.map((device) => device.id), devicesCheckedAt: Date.now() };
  const pairing = $("#pairing");
  pairing.hidden = false;
  pairing.innerHTML = "";
  renderPairedDevices();
  renderPairing();
  state.pairingTimer = setInterval(pairingTick, 1000);
  pairing.tabIndex = -1;
  pairing.focus();
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

function openProductLinkDialog(correction = null) {
  const form = $("#productLinkForm");
  form.reset();
  clearProductLinkPreview();
  let draft = correction ? { url: correction.payload?.canonicalUrl || "", title: correction.payload?.title || "" } : null;
  if (!draft) {
    try { const stored = JSON.parse(sessionStorage.getItem(linkDraftKey()) || "null"); if (stored && Date.now() - stored.savedAt < 86_400_000) draft = stored; } catch { /* Draft storage is optional. */ }
  }
  if (draft) { form.elements.url.value = draft.url || ""; form.elements.title.value = draft.title || ""; }
  $("#productLinkDraftStatus").hidden = !draft;
  $("#productLinkDraftStatus").textContent = correction ? `Correct this suggestion and check the link again. Earlier review: ${correction.reviewNote || "Rejected"}. A new submission requires independent review.` : "Draft restored for this tab. Check the link again before submitting.";
  $("#productLinkDialog").showModal();
  if (draft) { $("#productLinkDialog").dataset.dirty = "true"; saveLinkDraft(); }
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
    // A connected-but-quiet source is not "not connected": say what the
    // server's freshness receipt says instead (E-03).
    $("#signalConnectStatus").textContent = signalStep?.state === "attention" && signalStep.summary
      ? signalStep.summary
      : "TrackaLacker is not connected yet. Finish the three steps, then re-check.";
  } finally {
    button.disabled = false;
    button.textContent = "Re-check";
  }
}

async function focusFirstWant() {
  setTab("find");
  await state.routeLoadPromise;
  const control = $("#productList [data-want-listing]");
  if (!control) {
    $("#addProductButton").focus();
    toast("Choose “Add product link” to add an approved product first.");
    return;
  }
  control.focus({ preventScroll: true });
  if (typeof control.scrollIntoView === "function") control.scrollIntoView({ block: "center" });
  const label = control.textContent.trim() || "Want it";
  toast(`Choose “${label}” to tell Yoink what to add to your cart.`);
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
    $("#productLinkPreview").innerHTML = `<div class="card-top"><span class="store">${escapeHtml(preview.retailerName)}</span><span class="tag good">${preview.alreadyInProducts ? "Already in Products" : "Product link recognized"}</span></div>
      <h3>${escapeHtml(preview.catalogTitle || form.elements.title.value.trim() || `${preview.retailerName} item ${preview.retailerSku}`)}</h3><p>${preview.catalogTitle ? "Approved catalog name" : "Name supplied by you; offer data is not verified"} · Item ${escapeHtml(preview.retailerSku)}</p>
      <p>${escapeHtml(preview.alreadyInProducts ? "This exact store item is already available in Products; no review request is needed." : preview.capabilityLabel)}</p>
      ${preview.alreadyInProducts ? `<button class="button secondary" data-product-detail="${escapeHtml(preview.existingVariantId)}" type="button">View product</button>` : "<p><strong>Not accepted from this link:</strong> stock status, price, seller, fulfillment, or permission to purchase.</p>"}
      ${retailerLinkMarkup(preview.canonicalUrl, `${preview.retailerName} product preview`, `${preview.canonicalUrl} ↗`)}`;
    $("#productLinkConfirm").hidden = preview.alreadyInProducts === true;
    $("#submitProductLinkButton").disabled = preview.alreadyInProducts === true;
    (preview.alreadyInProducts
      ? $("#productLinkPreview [data-product-detail]")
      : $("#productLinkConfirm").querySelector("input"))?.focus();
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
  if (!button) return;
  try {
    if (button.dataset.wantListing) {
      for (const id of ["productDialog", "planDialog"]) if ($(`#${id}`).hasAttribute("open")) $(`#${id}`).close();
      await openWant(button.dataset.wantListing, { mode: button.dataset.wantMode || "", trigger: button });
      return;
    }
    if (button.dataset.wantCollection) {
      for (const id of ["productDialog", "planDialog"]) if ($(`#${id}`).hasAttribute("open")) $(`#${id}`).close();
      await openCollectionWant(button.dataset.wantCollection, button);
      return;
    }
    if (button.id === "collectionWantStop") { await stopCollectionWant(); return; }
    if (button.id === "wantStop") { await stopWanting(); return; }
    if (button.id === "wantMore") { await openWantMoreOptions(); return; }
    if (button.dataset.storeSwitch) { await flipStoreSwitch(button); return; }
    if (button.dataset.storeTestCall) { await openTestCall(button.dataset.storeTestCall); return; }
    if (button.id === "testCallLinkSend") { await sendTestCallLink(); return; }
    if (button.dataset.testAgain) {
      const saved = (state.testCall?.saved || []).find((item) => item.listingId === button.dataset.testAgain);
      if (saved) await sendTestCallLink(saved);
      return;
    }
    if (button.dataset.forgetTestItem) { await forgetSavedTestItem(button.dataset.forgetTestItem); return; }
    if (button.dataset.setupSection) { setSetupSection(button.dataset.setupSection, { historyMode: "push" }); return; }
    if (button.id === "reviewCallAdded") { await openCallAddedReview(); return; }
    if (button.id === "fillMsrps") { await openMsrpFill(); return; }
    if (button.id === "dismissCallAdded") { dismissCallAddedNotice(); toast("Kept. They stay on Wanted until you edit or remove them."); return; }
    if (button.id === "keepCallAdded") { $("#callAddedDialog").close(); dismissCallAddedNotice(); return; }
    if (button.dataset.findChip) {
      const key = button.dataset.findChip;
      if (Object.hasOwn(state.browse, key)) {
        state.browse[key] = state.browse[key] === button.dataset.findValue ? "" : String(button.dataset.findValue || "");
        const select = { store: "#browseStore", availability: "#browseAvailability", plan: "#browsePlan" }[key];
        if (select && $(select)) $(select).value = state.browse[key];
        writeUserRoute("replace", "find");
        await loadUserRoute("find", { force: true });
      }
      return;
    }
    if (button.dataset.planView) {
      state.planView = ["add_to_cart", "notify", "paused"].includes(button.dataset.planView) ? button.dataset.planView : "all";
      state.planOffset = 0;
      writeUserRoute("replace", "cart");
      await loadUserRoute("cart", { force: true });
      return;
    }
    if (button.dataset.storeSetup) { await openStoreSetup(button.dataset.storeSetup, button.dataset.setupPlan || "", button); return; }
    if (button.hasAttribute("data-close-store-setup")) { closeStoreSetup(); return; }
    if (button.id === "refreshStoreSetup") { await loadStoreSetup(); return; }
    if (button.id === "returnStoreSetupPlan") {
      const planId = state.storeSetup?.planId;
      if (!planId) return;
      closeStoreSetup({ writeRoute: false });
      setTab("cart", { historyMode: "none" });
      state.entity = { kind: "plan", id: planId, panel: "cart" };
      writeUserRoute("push", "cart");
      await restoreEntityDetail();
      if (state.editingPlan?.id === planId && $("#planDialog").open) toast(`Plan rechecked: ${state.editingPlan.automationReadiness?.headline || "Review the current plan status."}`);
      return;
    }
    if (button.dataset.storeSetupHelp) {
      const help = $("#storeSetupHelp");
      help.hidden = false;
      help.focus();
      return;
    }
    if (button.id === "resumeStoreSetupActions") {
      // The same confirmation and server preflight as the header switch.
      button.disabled = true;
      try {
        await toggleActions({ paused: false });
        if (state.storeSetup) await loadStoreSetup();
      } finally { if (button.isConnected) button.disabled = false; }
      return;
    }
    if (button.dataset.storeSetupSwitch) {
      const retailerId = button.dataset.storeSetupSwitch;
      closeStoreSetup();
      if (activeUserRoute() === "setup") setSetupSection("stores");
      else {
        openSettingsView("stores");
        await state.routeLoadPromise;
      }
      const row = $$("#storeSwitchList [data-store]").find((node) => node.dataset.store === retailerId);
      const control = row?.querySelector("[data-store-switch]:not(:disabled)") || row?.querySelector("[data-store-setup]");
      control?.focus();
      return;
    }
    if (button.dataset.resumeNextAction) {
      await followResumeNextAction(button);
      return;
    }
    if (button.dataset.deliveryLever) {
      await followDeliveryLever(button);
      return;
    }
    if (button.dataset.openSettings) {
      openSettingsView(button.dataset.openSettings);
      return;
    }
    if (button.hasAttribute("data-home-resume-actions")) {
      await toggleActions();
      return;
    }
    if (button.dataset.retryRoute) {
      button.disabled = true;
      await resumeVisibleDashboard();
      return;
    }
    if (button.dataset.renameBrowser) {
      const device = state.devices.find((item) => item.id === button.dataset.renameBrowser);
      if (!device) return;
      const form = $("#browserNameForm");
      form.elements.id.value = device.id;
      form.elements.name.value = device.name || "Chrome browser";
      $("#browserNameDialog").showModal();
      form.elements.name.focus();
      return;
    }
    if (button.hasAttribute("data-repair-browser")) { await createPairingCode(); return; }
    if (button.dataset.connectorRemove) {
      if (!(await requestConfirmation({ title: "Remove this destination?", summary: "This stops queued updates and removes this destination’s delivery history. Sent updates cannot be recalled. You can add the destination again later.", confirmLabel: "Remove destination" })).confirmed) return;
      await api(`/api/v1/user/connectors/${encodeURIComponent(button.dataset.connectorRemove)}`, { method: "DELETE", body: JSON.stringify({ confirmation: "REMOVE_DESTINATION" }) });
      if ($("#connectorForm").elements.id.value === button.dataset.connectorRemove) { $("#connectorForm").reset(); $("#connectorForm").querySelector('[type="submit"]').textContent = "Add destination"; }
      if (state.connectorFilter === button.dataset.connectorRemove) { state.connectorFilter = ""; state.connectorOffset = 0; }
      await refresh();
      toast("Destination removed.");
      return;
    }
    if (button.dataset.retryDelivery) {
      const delivery = state.connectorHistory.items.find((item) => item.id === button.dataset.retryDelivery);
      if (!delivery || !(await requestConfirmation({ title: "Retry this update?", summary: "The same update will be sent to its original destination. It may arrive twice if the destination received the earlier attempt before the request failed.", confirmLabel: "Retry update" })).confirmed) return;
      await api(`/api/v1/user/connectors/deliveries/${encodeURIComponent(delivery.id)}/retry`, { method: "POST", body: JSON.stringify({ confirmation: "RETRY_NOTIFICATION", updatedAt: delivery.updatedAt, attemptCount: delivery.attemptCount }) });
      await loadConnectorHistory(); renderConnectorHistory();
      toast("Update queued for retry."); return;
    }
    if (button.id === "retryDeliveryHistory") { await loadConnectorHistory(); return; }
    if (["previousDeliveries", "nextDeliveries"].includes(button.id)) {
      const previous = state.connectorOffset;
      state.connectorOffset = Math.max(0, previous + (button.id === "nextDeliveries" ? 50 : -50));
      try { await loadConnectorHistory(); } catch (error) { state.connectorOffset = previous; renderConnectorHistory(); throw error; }
      return;
    }
    if (button.id === "retryEntity") { await restoreEntityDetail(); return; }
    if (button.id === "clearActivityFilters") { state.activityFilters = {}; state.actions = []; state.actionDisplayLimit = 25; writeUserRoute("replace", "activity"); await loadUserRoute("activity", { force: true }); return; }
    if (button.id === "moreWatchHistory") { state.watchHistoryLimit += 25; renderWatchHistory(); return; }
    if (button.id === "copyPairing") {
      if (!state.pairing?.code || new Date(state.pairing.expiresAt).getTime() <= Date.now()) { renderPairing(); return; }
      await navigator.clipboard.writeText(state.pairing.code);
      toast("Pairing code copied.");
      return;
    }
    if (button.id === "regeneratePairing") { await createPairingCode(); return; }
    if (button.dataset.revokeBrowser) {
      const confirmation = await requestConfirmation({ title: "Revoke this browser?", summary: "This browser will lose access to your account and new store actions. Existing store carts and local extension data remain; remove that data from Extension settings if needed.", confirmLabel: "Revoke browser" });
      if (!confirmation.confirmed) return;
      await api(`/api/v1/user/devices/${encodeURIComponent(button.dataset.revokeBrowser)}/revoke`, { method: "POST", body: "{}" });
      await refresh();
      toast("Browser access revoked. Create a pairing code to connect it again.");
      return;
    }
    if (button.dataset.connectorEdit) {
      const connector = state.actionPlatform?.connectors?.find((item) => item.id === button.dataset.connectorEdit);
      if (!connector) return;
      const form = $("#connectorForm");
      for (const field of ["id", "name", "kind", "endpointReference"]) form.elements[field].value = connector[field];
      for (const checkbox of form.querySelectorAll('input[name="events"]')) checkbox.checked = connector.events.includes(checkbox.value);
      form.querySelector('[type="submit"]').textContent = "Save destination";
      form.elements.name.focus();
      return;
    }
    if (button.id === "reloadSpendPolicy") {
      if (!(await requestConfirmation({ title: "Load saved limits?", summary: "This replaces your unsaved spending draft with the currently saved limits.", confirmLabel: "Load saved limits" })).confirmed) return;
      $("#spendForm").dataset.dirty = "false";
      document.activeElement?.blur();
      await refresh();
      return;
    }
    if (button.id === "userDataFreshness") {
      button.disabled = true;
      try { await resumeVisibleDashboard(); } finally { button.disabled = false; }
      return;
    }
    if (button.dataset.callFilter) {
      state.callFilter = ["products", "drawings", "discord"].includes(button.dataset.callFilter) ? button.dataset.callFilter : "all";
      state.callDisplayLimit = 25;
      renderCalls();
      writeUserRoute("push", "calls");
      if (state.callFilter === "discord") {
        try {
          await refreshDiscordCalls();
        } catch (error) {
          toast(error.message || "Discord calls could not load. Try again.", true);
        }
        renderCalls();
      }
      return;
    }
    if (button.hasAttribute("data-open-discord-calls")) {
      state.callFilter = "discord";
      state.callDisplayLimit = 25;
      setTab("calls", { historyMode: "push" });
      try { await refreshDiscordCalls(); } catch { /* the empty list says what to do */ }
      renderCalls();
      return;
    }
    if (button.dataset.discordLink) {
      openDiscordLink(button.dataset.discordLink);
      return;
    }
    if (button.dataset.tab) {
      // The Setup tab opens at the top; section links scroll within it.
      if (button.dataset.tab === "setup" && button.closest(".tabs")) state.setupSection = "";
      setTab(button.dataset.tab, { historyMode: "push" });
    }
    if (button.id === "loadMoreProducts") {
      button.disabled = true;
      try { await loadMoreProducts(); } finally { button.disabled = false; }
    }
    if (button.id === "clearPlanSearch") {
      state.planQuery = "";
      state.planView = "all";
      state.planOffset = 0;
      writeUserRoute("replace", "cart");
      $("#planSearch").value = "";
      await loadUserRoute("cart", { force: true });
      return;
    }
    if (["previousPlans", "nextPlans"].includes(button.id)) {
      button.disabled = true;
      state.planOffset = Math.max(0, state.planOffset + (button.id === "nextPlans" ? state.planPageSize : -state.planPageSize));
      try { await loadUserRoute("cart", { force: true }); } finally { button.disabled = false; }
      return;
    }
    if (button.id === "showMoreCalls") {
      button.disabled = true;
      try {
        if (state.callHasMore) {
          const sequence = ++state.callRequestSequence;
          const page = await api(`/api/v1/user/calls?offset=${state.callNextOffset}`);
          if (sequence === state.callRequestSequence) applyCalls(page, true);
        }
        state.callDisplayLimit += 25;
      } finally { button.disabled = false; }
      renderCalls();
    }
    if (button.id === "showMoreActions") {
      button.disabled = true;
      try {
        if (state.actions.length < state.actionTotal) {
          const sequence = ++state.actionActivityRequestSequence;
          const page = await api(activityPath(state.actions.length));
          if (sequence >= state.actionActivityAppliedSequence) {
            state.actionActivityAppliedSequence = sequence;
            applyActionActivity({ ...page, items: [...new Map([...state.actions, ...(page.items || [])].map((item) => [item.id, item])).values()] });
          }
        }
        state.actionDisplayLimit += 25;
      } finally { button.disabled = false; }
      renderActions();
    }
    if (button.dataset.actionStageFilter) {
      state.actionStageFilter = button.dataset.actionStageFilter;
      state.actionDisplayLimit = 25;
      renderActions();
      return;
    }
    if (button.id === "reviewLegacyPlanTransitionButton") {
      openLegacyPlanTransition();
      return;
    }
    if (button.dataset.checkoutReport) { await openCheckoutReport(button.dataset.checkoutReport, "correction", button); return; }
    if (button.dataset.checkoutRefund) { await openCheckoutReport(button.dataset.checkoutRefund, "refund", button); return; }
    if (button.dataset.cartGotIt) {
      openCartOutcomeDialog(button.dataset.cartGotIt, button);
      return;
    }
    if (button.dataset.cartMissedIt) {
      const action = findActionById(button.dataset.cartMissedIt);
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
    if (button.hasAttribute("data-close-dialog")) await closeDraftDialog(button.closest("dialog"));
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
      setTab("setup");
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
      setTab("setup");
      toast(connector.enabled ? "Connector paused." : "Connector enabled.");
    }
    if (button.id === "acknowledgePrivacyChange") {
      await api("/api/v1/user/privacy/change-acknowledged", { method: "POST", body: "{}" });
      await refresh();
      setTab("setup");
      toast("Privacy change notice acknowledged.");
    }
    if (button.dataset.productDetail) await openProductDetail(button.dataset.productDetail);
    if (button.id === "pauseButton") await toggleActions();
    if (button.id === "dismissReleaseAnnouncement") {
      const id = String(state.overview?.announcement?.id || "");
      try { if (id) localStorage.setItem(DISMISSED_ANNOUNCEMENT_KEY, id); } catch { /* Dismissal remains best effort. */ }
      $("#releaseAnnouncement").hidden = true;
    }
    if (button.id === "addProductButton" || button.hasAttribute("data-open-product-link")) {
      if ($("#productDialog").hasAttribute("open")) $("#productDialog").close();
      openProductLinkDialog();
    }
    if (button.dataset.dismissProposal) {
      state.dismissedProposalIds.add(button.dataset.dismissProposal);
      renderProductReviewStatus();
      return;
    }
    if (button.hasAttribute("data-clear-browse")) {
      state.query = "";
      $("#productSearch").value = "";
      state.browse = { store: "", availability: "", plan: "", price: "", sort: state.browse.sort };
      rememberInStockOnly(false);
      writeUserRoute("replace", "find");
      for (const id of ["browseStore", "browseAvailability", "browsePlan", "browsePrice"]) {
        const control = $(`#${id}`);
        if (control) control.value = "";
      }
      await loadUserRoute("find", { force: true });
    }
    if (button.id === "checkProductLinkButton") await checkProductLink();
    if (button.id === "changeSetupStore") {
      const variantId = button.dataset.variantId;
      $("#setupDialog").close();
      if (variantId) await openProductDetail(variantId);
      return;
    }
    if (button.dataset.trackListing) {
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
        summary: "This stops pending checks, ends calls for this product, and removes the plan. Prior action and spend history is retained for safety.",
        confirmLabel: "Delete plan",
        danger: true
      })).confirmed) return;
      button.disabled = true;
      try {
        await api(`/api/v1/user/purchase-intents/${encodeURIComponent(plan.id)}`, {
          method: "DELETE",
          body: JSON.stringify({ confirmation: "DELETE_PURCHASE_PLAN" })
        });
        closeEntityDialog($("#planDialog"));
        state.editingPlan = null;
        await refresh();
        setTab("cart");
        toast("Purchase plan deleted.");
      } finally {
        button.disabled = false;
      }
    }
    if (button.id === "pairButton") {
      await createPairingCode();
    }
    if (button.dataset.firstPlanIntent && firstPlanJourney()) {
      const intent = button.dataset.firstPlanIntent;
      if (["notify", "add_to_cart"].includes(intent) && firstPlanIntentKey()) {
        try { sessionStorage.setItem(firstPlanIntentKey(), JSON.stringify({ intent, savedAt: Date.now() })); }
        catch { toast("Your browser could not keep this choice. Select the action in the plan review."); }
      }
      renderHomePriority();
      $(`[data-first-plan-intent="${intent}"]`)?.focus();
    }
    if (button.dataset.setupAction === "desktop_handoff") {
      // Reconstruct from the origin: never copy pairing codes, auth queries, or entity drafts.
      const link = `${location.origin}/#cart`;
      const label = $("[data-desktop-link]");
      label.hidden = false;
      label.querySelector("input").value = link;
      try { await navigator.clipboard.writeText(link); toast("Desktop setup link copied. Sign in to the same account."); }
      catch { label.querySelector("input").focus(); label.querySelector("input").select(); }
    }
    if (button.dataset.setupAction === "view_plans") setTab("cart");
    if (button.dataset.setupAction === "pair_companion") await createPairingCode(true);
    if (button.dataset.setupAction === "connect_signal") openSignalConnectDialog();
    if (button.dataset.setupAction === "add_product") openProductLinkDialog();
    if (button.dataset.setupAction === "choose_product") await focusFirstWant();
    if (button.dataset.setupAction === "resume_actions") await toggleActions();
  } catch (error) { toast(error.message || "The request failed.", true); }
});

$("#recheckSignalConnection").addEventListener("click", () => { void recheckSignalConnection(); });

$("#connectorForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const events = [...form.querySelectorAll('input[name="events"]:checked')].map((input) => input.value);
  try {
    if (!events.length) throw new Error("Choose at least one connector update.");
    await api(form.elements.id.value ? `/api/v1/user/connectors/${encodeURIComponent(form.elements.id.value)}` : "/api/v1/user/connectors", {
      method: form.elements.id.value ? "PATCH" : "POST",
      body: JSON.stringify({
        contractVersion: 1,
        kind: form.elements.kind.value,
        name: form.elements.name.value.trim(),
        endpointReference: form.elements.endpointReference.value.trim(),
        enabled: form.elements.id.value ? state.actionPlatform?.connectors?.find((item) => item.id === form.elements.id.value)?.enabled !== false : true,
        events
      })
    });
    form.reset();
    form.querySelector('[type="submit"]').textContent = "Add destination";
    for (const checkbox of form.querySelectorAll('input[name="events"]')) checkbox.checked = true;
    await refresh();
    setTab("setup");
    toast("Destination saved. Use Test to verify delivery.");
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
    clearLinkDraft();
    $("#productLinkDialog").close();
    clearProductLinkPreview();
    setTab("find", { load: false });
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
    try { sessionStorage.removeItem(firstPlanIntentKey()); } catch { /* Best effort hint cleanup. */ }
    await refresh();
    setTab("cart");
    toast(draft.actionCeiling === "add_to_cart"
      ? "Plan created. Review its store readiness."
      : "Purchase plan created in notification-only mode.");
  } catch (error) {
    if (error.code === "purchase_intent_exists") {
      $("#setupDialog").close();
      state.setupProduct = null;
      await refresh();
      setTab("cart");
      toast("That product already has a plan. Review its limits before changing it.");
    } else {
      if (["purchase_intent_preflight_required", "purchase_intent_preflight_stale"].includes(error.code)) {
        state.setupPreflight = null;
        state.setupPreflightSignature = "";
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
    closeEntityDialog($("#planDialog")); await refresh(); toast("Plan saved.");
  } catch (error) { toast(error.message || "Plan could not be saved.", true); }
});

// "Want it" sheet: one product, one max price, Add to cart or Alert me. The
// server previews which stores each choice covers; saving sends back that
// preview's fingerprint, so what the shopper saw is what gets saved.
const WANT_PREVIEW_DELAY_MS = 450;
const WANT_PREVIEW_RETRY_CODES = new Set([
  "product_want_preview_changed",
  "product_want_preview_stale",
  "product_want_preview_required"
]);

function storeListWords(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

function shopperWantsPreview(plan) {
  if (!plan || !["active", "paused", "satisfied"].includes(String(plan.status || ""))) return false;
  return plan.mode === "add_to_cart" || !String(plan.origin || "").startsWith("signal:");
}

function readWantInputs() {
  const form = $("#wantForm");
  const mode = form.querySelector('input[name="wantMode"]:checked')?.value === "notify" ? "notify" : "add_to_cart";
  const quantity = Number(form.elements.wantQuantity?.value || 1);
  const raw = String(form.elements.wantMax?.value ?? "").replace(/^\$\s*/, "").trim();
  let maxUnitPriceCents = null;
  let error = "";
  if (raw) {
    try { maxUnitPriceCents = centsInput(raw, "Your max price"); } catch (problem) { error = problem.message; }
  }
  // "Any price up to my max" sets the MSRP aside; Alert me ignores both.
  const anyPrice = form.elements.wantAnyPrice;
  const priceRule = anyPrice ? mode === "add_to_cart" && anyPrice.checked ? "max_price" : "msrp" : null;
  // Only Add to cart uses the MSRP; Alert me ignores the field.
  const msrpField = mode === "add_to_cart" && priceRule !== "max_price" ? form.elements.wantMsrp : null;
  const rawMsrp = String(msrpField?.value ?? "").replace(/^\$\s*/, "").trim();
  let confirmedMsrpCents = null;
  if (msrpField && rawMsrp) {
    try { confirmedMsrpCents = centsInput(rawMsrp, "The MSRP"); } catch (problem) { error = error || problem.message; }
  }
  return {
    mode,
    maxUnitPriceCents,
    confirmedMsrpCents,
    priceRule,
    targetQuantity: Number.isInteger(quantity) && quantity >= 1 && quantity <= 10 ? quantity : 1,
    error: error || (raw ? "" : "Enter the most you'll pay per item.")
      || (msrpField && !rawMsrp ? "Enter the MSRP for this item." : ""),
    blank: !raw
  };
}

function wantInputsMatchPreview(inputs, preview) {
  return Boolean(preview) && !inputs.error
    && inputs.mode === preview.requestedMode
    && inputs.maxUnitPriceCents === preview.maxUnitPriceCents
    && (inputs.confirmedMsrpCents ?? null) === (preview.msrpConfirmation?.confirmedCents ?? null)
    && (inputs.priceRule === null || inputs.mode !== "add_to_cart" || inputs.priceRule === (preview.priceRule || "msrp"))
    && inputs.targetQuantity === preview.targetQuantity;
}

// Add to cart at these stores runs only at or below an MSRP. When none was
// reviewed from a manufacturer page, the shopper confirms it here (Kevin, 2026-10-08).
function wantMsrpConfirmable(preview) {
  return Boolean(preview.priceRule === "max_price" || preview.msrpConfirmation?.needed || preview.msrpConfirmation?.confirmedCents
    || preview.stores.some((store) => store.officialMsrp?.confirmedByYou));
}

function wantMsrpStartCents(preview) {
  return preview.msrpConfirmation?.confirmedCents
    ?? preview.stores.find((store) => store.officialMsrp?.confirmedByYou && !store.officialMsrp.maxPriceOnly)?.officialMsrp.cents
    ?? preview.msrpConfirmation?.suggestedCents
    ?? null;
}

function wantControlsMarkup(preview) {
  const image = safeHref(preview.imageUrl);
  const prices = preview.stores.map((store) => Number(store.priceCents)).filter((cents) => cents > 0);
  const confirmable = wantMsrpConfirmable(preview);
  const reviewed = preview.stores.find((store) => store.officialMsrp && !store.officialMsrp.confirmedByYou)?.officialMsrp;
  const facts = [
    reviewed ? `Official MSRP ${money(reviewed.cents)}` : !confirmable && preview.msrpCents ? `Reported MSRP ${money(preview.msrpCents)}` : "",
    prices.length ? `lowest recorded store price ${money(Math.min(...prices))}` : ""
  ].filter(Boolean).join(" · ");
  const msrpStart = wantMsrpStartCents(preview);
  const variant = Object.entries(preview.variantAttributes || {}).map(([key, value]) => `${key}: ${value}`).join(" · ");
  const guardedCart = preview.stores.some(store => ["amazon", "target", "walmart", "bestbuy"].includes(store.retailerId));
  // How many to add per call (Kevin, 2026-10-10); a store's own limit wins when it is lower.
  const quantities = Array.from({ length: 10 }, (_, index) => index + 1)
    .map((value) => `<option value="${value}" ${preview.targetQuantity === value ? "selected" : ""}>${value}</option>`).join("");
  return `<div class="want-product">${image ? `<img src="${escapeHtml(image)}" alt="" referrerpolicy="no-referrer">` : ""}<p>${escapeHtml(facts || "No price recorded yet.")}</p>${variant ? `<p>Variant: ${escapeHtml(variant)}</p>` : ""}</div>
    <div class="want-history" id="wantHistory"><p class="field-help">Loading price history…</p></div>
    <fieldset class="want-mode"><legend>When it's in stock</legend>
      <label class="want-choice"><input type="radio" name="wantMode" value="add_to_cart" ${preview.requestedMode === "add_to_cart" ? "checked" : ""}><span><strong>Add to cart</strong><small>Yoink adds it. You check out.</small></span></label>
      <label class="want-choice"><input type="radio" name="wantMode" value="notify" ${preview.requestedMode === "notify" ? "checked" : ""}><span><strong>Alert me</strong><small>Yoink only tells you.</small></span></label>
    </fieldset>
    <div class="form-row want-limits">
      <label><span>Max price per item</span><input name="wantMax" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${escapeHtml(moneyInput(preview.maxUnitPriceCents))}" aria-describedby="wantMaxHelp"><small id="wantMaxHelp">Item price only. Shipping, tax and fees are separate; Chrome checks the current offer.</small></label>
      <label><span>Quantity</span><select name="wantQuantity" aria-describedby="wantQuantityHelp">${quantities}</select><small id="wantQuantityHelp">${guardedCart ? "If the store limits how many you can buy, Yoink adds as many as it allows." : "How many Yoink adds."}</small></label>
    </div>
    ${guardedCart ? `<label class="want-check" id="wantAnyPriceRow"><input type="checkbox" name="wantAnyPrice" ${preview.priceRule === "max_price" ? "checked" : ""}><span><strong>Any price up to my max</strong><small>Adds at whatever the store charges, up to your max, only when the store itself sells it. The MSRP isn't checked.</small></span></label>` : ""}
    ${confirmable ? `<div class="form-row want-msrp" id="wantMsrpRow"><label><span>MSRP</span><input name="wantMsrp" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${escapeHtml(moneyInput(msrpStart))}" aria-describedby="wantMsrpHelp"><small id="wantMsrpHelp">${msrpStart && !preview.msrpConfirmation?.confirmedCents && preview.msrpConfirmation?.needed ? `From ${escapeHtml(preview.msrpConfirmation.suggestedLabel || "TrackaLacker")}. ` : ""}Check it's the regular price for this exact item, not a sale price. Yoink adds it to your cart only at or below this.</small></label></div>` : ""}
    <p class="field-help">Sold by the store itself · Shipping · This exact item only.</p>
    <p class="field-help" id="wantReserve">${preview.maxAllInCents ? `Budget reserve: ${escapeHtml(money(preview.maxAllInCents))}. This is an estimate, not a store total.` : "Store total has not been verified."}</p>
    <div class="want-stores" id="wantStores"></div>
    <p class="want-summary" id="wantSummary" role="status" aria-live="polite"></p>`;
}

function wantStoreMarkup(store) {
  const label = store.watch === "add_to_cart" ? store.cartReady ? "Adds to cart" : "Alerts for now"
    : store.watch === "alert" ? "Alerts you" : "Off";
  const tone = store.watch === "add_to_cart" ? store.cartReady ? "good" : "info" : store.watch === "alert" ? "info" : "";
  const note = store.watch === "off" || (store.watch === "add_to_cart" && !store.cartReady) ? store.note : "";
  return `<div class="want-store" data-watch="${escapeHtml(store.watch)}" data-store="${escapeHtml(store.retailerId)}">
    <strong>${escapeHtml(store.retailerName)}<small>Item ${escapeHtml(store.retailerSku)}</small></strong>
    <span>${store.priceCents ? escapeHtml(money(store.priceCents)) : "No price yet"}</span>
    <span class="tag ${tone}">${escapeHtml(label)}</span>
    ${store.officialMsrp?.maxPriceOnly ? `<small>Any price up to ${escapeHtml(money(store.officialMsrp.cents))}; MSRP not checked</small>`
      : store.officialMsrp?.confirmedByYou ? `<small>MSRP ${escapeHtml(money(store.officialMsrp.cents))}, confirmed by you</small>`
      : store.officialMsrp ? `<small>Variant: ${escapeHtml(store.officialMsrp.desiredVariant)} · <a href="${escapeHtml(safeHref(store.officialMsrp.sourceUrl))}" target="_blank" rel="noopener noreferrer">Official MSRP ${escapeHtml(money(store.officialMsrp.cents))}</a></small>` : ""}
    ${note ? `<small>${escapeHtml(note)}</small>` : ""}
  </div>`;
}

// Want it › price history (Kevin, 2026-10-08): a line per store from every
// price Yoink recorded, with the MSRP and the shopper's max as reference lines.
// A store's color follows the store, never its rank (validated set in tokens.css;
// series-N classes, since the CSP drops style attributes).
const PRICE_HISTORY_SERIES = ["walmart", "target", "amazon", "bestbuy"];
function priceHistorySeries(retailerId) {
  const fixed = PRICE_HISTORY_SERIES.indexOf(retailerId);
  if (fixed >= 0) return fixed + 1;
  let hash = 0;
  for (const character of String(retailerId)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 5 + (hash % 4);
}

async function loadWantHistory(listingId) {
  const want = state.want;
  if (!want) return;
  try {
    const { history } = await api(`/api/v1/user/purchase-intents/want/price-history?listingId=${encodeURIComponent(listingId)}`);
    if (state.want !== want) return;
    want.history = history || { stores: [], msrpCents: null };
  } catch {
    if (state.want !== want) return;
    want.history = { stores: [], msrpCents: null };
  }
  renderWantHistory();
}

function historyTicks(low, high) {
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(1, (high - low) / 3))));
  const nice = [1, 2, 2.5, 5, 10].map((factor) => factor * step).find((size) => (high - low) / size <= 4) || step * 10;
  const ticks = [];
  for (let value = Math.ceil(low / nice) * nice; value <= high; value += nice) ticks.push(value);
  return ticks;
}

function priceHistoryChartMarkup(history, maxCents, width = 560) {
  const stores = (history.stores || []).filter((store) => Array.isArray(store.points) && store.points.length);
  if (!stores.length) return '<p class="field-help">No prices recorded for this item yet. Each call and store check adds one.</p>';
  const height = 180;
  const left = 52;
  const right = Math.min(132, Math.round(width * 0.3));
  const top = 12;
  const bottom = 24;
  const times = stores.flatMap((store) => store.points.map((point) => Date.parse(point.at)));
  const start = Math.min(...times);
  const end = Math.max(Date.now(), ...times);
  const values = [...stores.flatMap((store) => store.points.map((point) => point.priceCents)), history.msrpCents, maxCents]
    .filter((value) => Number.isFinite(value) && value > 0);
  let low = Math.min(...values);
  let high = Math.max(...values);
  const pad = Math.max((high - low) * 0.12, high * 0.05);
  low = Math.max(0, low - pad);
  high += pad;
  const x = (time) => left + (end === start ? 1 : (time - start) / (end - start)) * (width - left - right);
  const y = (value) => top + (1 - (value - low) / (high - low)) * (height - top - bottom);
  const day = (time) => new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const grid = historyTicks(low, high).map((value) => `<line class="history-grid" x1="${left}" x2="${width - right}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"></line><text class="history-axis" x="${left - 6}" y="${y(value).toFixed(1)}" text-anchor="end" dominant-baseline="middle">${escapeHtml(money(value))}</text>`).join("");
  const series = stores.map((store) => {
    let path = "";
    store.points.forEach((point, index) => {
      const px = x(Date.parse(point.at)).toFixed(1);
      const py = y(point.priceCents).toFixed(1);
      path += index === 0 ? `M${px},${py}` : `H${px}V${py}`;
    });
    const last = store.points.at(-1);
    return { store, slot: priceHistorySeries(store.retailerId), path: `${path}H${x(end).toFixed(1)}`, endY: y(last.priceCents), last };
  });
  // Direct labels at the right edge, spaced so they never overlap.
  const labels = [...series].sort((a, b) => a.endY - b.endY);
  labels.forEach((item, index) => { item.labelY = index === 0 ? item.endY : Math.max(item.endY, labels[index - 1].labelY + 14); });
  // MSRP labelled at the left end, the max at the right, so they never collide when equal.
  // Lines sit under the store prices; their labels sit on top.
  const shown = (cents) => Number.isFinite(cents) && cents > 0;
  const referenceLine = (cents, kind) => shown(cents)
    ? `<line class="history-ref ${kind}" x1="${left}" x2="${width - right}" y1="${y(cents).toFixed(1)}" y2="${y(cents).toFixed(1)}"></line>` : "";
  const referenceLabel = (cents, label, end) => shown(cents)
    ? `<text class="history-ref-label" x="${end ? width - right - 4 : left + 4}" y="${(y(cents) - 4).toFixed(1)}"${end ? ' text-anchor="end"' : ""}>${escapeHtml(`${label} ${money(cents)}`)}</text>` : "";
  const summary = series.map((item) => `${item.store.retailerName} ${money(item.last.priceCents)}`).join("; ");
  const legend = series.length > 1 ? `<ul class="history-legend">${series.map((item) => `<li><span class="history-swatch series-${item.slot}"></span>${escapeHtml(item.store.retailerName)}</li>`).join("")}</ul>` : "";
  const rows = series.flatMap((item) => item.store.points.map((point) => ({ store: item.store.retailerName, at: point.at, cents: point.priceCents })))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return `${legend}
    <svg class="history-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`Price history since ${day(start)}. Latest: ${summary}.${history.msrpCents ? ` MSRP ${money(history.msrpCents)}.` : ""}`)}" data-start="${start}" data-end="${end}" data-left="${left}" data-right="${width - right}">
      ${grid}
      <text class="history-axis" x="${left}" y="${height - 6}">${escapeHtml(day(start))}</text>
      <text class="history-axis" x="${width - right}" y="${height - 6}" text-anchor="end">${escapeHtml(day(end))}</text>
      ${referenceLine(history.msrpCents, "msrp")}
      ${referenceLine(maxCents, "max")}
      ${series.map((item) => `<path class="history-line series-${item.slot}" d="${item.path}"></path>`).join("")}
      ${referenceLabel(history.msrpCents, "MSRP", false)}
      ${referenceLabel(maxCents, "Your max", true)}
      ${series.map((item) => `<circle class="history-end series-${item.slot}" cx="${x(end).toFixed(1)}" cy="${item.endY.toFixed(1)}" r="4"></circle><text class="history-label" x="${(x(end) + 8).toFixed(1)}" y="${item.labelY.toFixed(1)}" dominant-baseline="middle">${escapeHtml(`${item.store.retailerName} ${money(item.last.priceCents)}`)}</text>`).join("")}
      <line class="history-crosshair" x1="0" x2="0" y1="${top}" y2="${height - bottom}" hidden></line>
      <rect class="history-hit" x="${left}" y="${top}" width="${width - left - right}" height="${height - top - bottom}"></rect>
    </svg>
    <div class="history-tooltip" hidden></div>
    ${priceSummaryMarkup(history.summary, maxCents)}
    <details class="history-table"><summary>Show as table</summary><div class="history-table-scroll"><table><thead><tr><th>Date</th><th>Store</th><th>Price</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(new Date(row.at).toLocaleString())}</td><td>${escapeHtml(row.store)}</td><td>${escapeHtml(money(row.cents))}</td></tr>`).join("")}</tbody></table></div></details>`;
}

// The numbers under the chart (Kevin, 2026-10-09): 90-day low and high, and
// Yoink's suggested price, worked out on the server (summarizePriceHistory).
function priceSummaryMarkup(summary, maxCents) {
  if (!summary?.suggested) return "";
  const day = (at) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const mark = (label, item, extra = "") => `<div${extra}><dt>${escapeHtml(label)}</dt><dd><strong>${escapeHtml(money(item.priceCents))}</strong><small>${escapeHtml(item.at ? `${item.retailerName} · ${day(item.at)}` : `Usual price at ${item.retailerName}`)}</small></dd></div>`;
  const leftOut = summary.stores.filter((store) => !store.counted);
  const use = summary.suggested.priceCents !== maxCents
    ? `<button class="button quiet history-use" type="button" data-use-suggested="${escapeHtml(summary.suggested.priceCents)}">Use as my max</button>` : "";
  return `<dl class="history-stats">
      ${mark(`${summary.windowDays}-day low`, summary.lowest)}
      ${mark(`${summary.windowDays}-day high`, summary.highest)}
      ${mark("Yoink suggests", summary.suggested, ' class="suggested"')}
    </dl>
    <p class="history-stats-help">Suggested: each store's usual price over ${escapeHtml(summary.windowDays)} days, so short spikes don't count, then the highest store within ${escapeHtml(money(summary.toleranceCents))} of the cheapest.${leftOut.length ? ` Left out: ${escapeHtml(leftOut.map((store) => `${store.retailerName} (${money(store.usualCents)})`).join(", "))}.` : ""}</p>
    ${use}`;
}

function renderWantHistory() {
  const want = state.want;
  const host = $("#wantHistory");
  if (!host || !want?.history) return;
  const maxCents = want.preview?.requestedMode === "add_to_cart" || want.preview?.requestedMode === "notify" ? want.preview.maxUnitPriceCents : null;
  // Draw at the dialog's own width so the text stays readable on a phone.
  const width = Math.max(320, Math.min(640, Math.round(host.clientWidth || 560)));
  const key = JSON.stringify([want.history, maxCents, width]);
  if (host.dataset.rendered === key) return;
  host.dataset.rendered = key;
  host.innerHTML = priceHistoryChartMarkup(want.history, maxCents, width);
  const svg = host.querySelector(".history-chart");
  const hit = host.querySelector(".history-hit");
  if (!svg || !hit) return;
  const tooltip = host.querySelector(".history-tooltip");
  const crosshair = host.querySelector(".history-crosshair");
  const start = Number(svg.dataset.start);
  const end = Number(svg.dataset.end);
  const plotLeft = Number(svg.dataset.left);
  const plotRight = Number(svg.dataset.right);
  const move = (event) => {
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const viewX = ((event.clientX - box.left) / box.width) * width;
    const time = start + Math.min(1, Math.max(0, (viewX - plotLeft) / Math.max(1, plotRight - plotLeft))) * (end - start);
    const lines = (want.history.stores || []).map((store) => {
      const seen = store.points.filter((point) => Date.parse(point.at) <= time).at(-1);
      return seen ? `<div><span class="history-swatch series-${priceHistorySeries(store.retailerId)}"></span>${escapeHtml(store.retailerName)} <strong>${escapeHtml(money(seen.priceCents))}</strong></div>` : "";
    }).filter(Boolean);
    crosshair.setAttribute("x1", viewX.toFixed(1));
    crosshair.setAttribute("x2", viewX.toFixed(1));
    crosshair.hidden = false;
    tooltip.innerHTML = `<div class="history-tooltip-date">${escapeHtml(new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))}</div>${lines.join("") || "<div>No price yet</div>"}`;
    tooltip.style.left = `${Math.min(event.clientX - box.left + 12, Math.max(0, box.width - 170))}px`;
    tooltip.style.top = `${Math.round(box.top - host.getBoundingClientRect().top) + 8}px`;
    tooltip.hidden = false;
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerleave", () => { tooltip.hidden = true; crosshair.hidden = true; });
}

function renderWantPreview() {
  const want = state.want;
  const preview = want?.preview;
  if (!preview) return;
  const anyPriceChecked = $("#wantForm").elements.wantAnyPrice?.checked === true;
  const msrpRow = $("#wantMsrpRow");
  if (msrpRow) msrpRow.hidden = preview.requestedMode !== "add_to_cart" || anyPriceChecked;
  const anyPriceRow = $("#wantAnyPriceRow");
  if (anyPriceRow) anyPriceRow.hidden = preview.requestedMode !== "add_to_cart";
  renderWantHistory();
  const reserve = $("#wantReserve");
  if (reserve) reserve.textContent = preview.maxAllInCents
    ? `Budget reserve: ${money(preview.maxAllInCents)}. This is an estimate, not a store total.`
    : "Store total has not been verified.";
  const stores = $("#wantStores");
  if (stores) {
    stores.innerHTML = preview.stores.length
      ? preview.stores.map(wantStoreMarkup).join("")
      : '<p class="field-help">No store sells this item directly yet.</p>';
  }
  const summary = $("#wantSummary");
  if (summary) {
    summary.textContent = want.error || preview.summary;
    summary.classList.toggle("error", Boolean(want.error) || preview.spendingLimit?.allowed === false);
  }
}

function renderWantActions() {
  const want = state.want;
  const actions = $("#wantDialogActions");
  if (!want || !actions) return;
  const preview = want.preview;
  const editing = shopperWantsPreview(preview?.plan);
  const blocked = !preview || want.saving || want.pending || Boolean(want.error) || !preview.canSave;
  actions.innerHTML = [
    editing ? '<button class="button danger" id="wantStop" type="button">Stop wanting</button>' : "",
    preview ? '<button class="button quiet" id="wantMore" type="button">More options</button>' : "",
    '<button class="button quiet" data-close-dialog type="button">Cancel</button>',
    `<button class="button primary" id="wantSave" type="submit" ${blocked ? "disabled" : ""}>${want.saving ? "Saving…" : editing ? "Save" : "Want it"}</button>`
  ].join("");
}

function renderWant() {
  const want = state.want;
  if (!want) return;
  const preview = want.preview;
  if (!preview) {
    $("#wantDialogTitle").textContent = "Want it";
    $("#wantDialogBody").innerHTML = want.error
      ? `<p class="inline-status error" role="alert">${escapeHtml(want.error)}</p>`
      : '<p class="field-help">Checking which stores sell it…</p>';
    renderWantActions();
    return;
  }
  $("#wantDialogTitle").textContent = preview.title;
  $("#wantDialogEyebrow").textContent = shopperWantsPreview(preview.plan) ? "On your Want list" : "Want it";
  if (want.controlsFor !== preview.variantId) {
    want.controlsFor = preview.variantId;
    $("#wantDialogBody").innerHTML = wantControlsMarkup(preview);
    for (const image of $$("#wantDialogBody img")) image.addEventListener("error", () => { image.remove(); }, { once: true });
  }
  renderWantPreview();
  renderWantActions();
}

async function requestWantPreview(inputs) {
  const want = state.want;
  if (!want) return;
  if (want.timer) {
    clearTimeout(want.timer);
    want.timer = null;
  }
  const sequence = ++want.sequence;
  want.pending = true;
  renderWantActions();
  try {
    const { preview } = await api("/api/v1/user/purchase-intents/want/preview", {
      method: "POST",
      body: JSON.stringify({
        contractVersion: 1,
        listingId: want.listingId,
        mode: inputs.mode === "notify" ? "notify" : "add_to_cart",
        ...(inputs.maxUnitPriceCents ? { maxUnitPriceCents: inputs.maxUnitPriceCents } : {}),
        ...(inputs.confirmedMsrpCents ? { confirmedMsrpCents: inputs.confirmedMsrpCents } : {}),
        ...(inputs.priceRule && inputs.mode === "add_to_cart" ? { priceRule: inputs.priceRule } : {}),
        ...(inputs.targetQuantity ? { targetQuantity: inputs.targetQuantity } : {}),
        confirmation: "PREVIEW_PRODUCT_WANT"
      })
    });
    if (state.want !== want || sequence !== want.sequence) return;
    want.preview = preview;
    want.error = "";
  } catch (error) {
    if (state.want !== want || sequence !== want.sequence) return;
    want.error = error.message || "Yoink couldn't check this item. Try again.";
  } finally {
    if (state.want === want && sequence === want.sequence) {
      want.pending = false;
      renderWant();
    }
  }
}

function scheduleWantPreview(delay) {
  const want = state.want;
  if (!want?.preview) return;
  if (want.timer) clearTimeout(want.timer);
  want.timer = null;
  const inputs = readWantInputs();
  if (inputs.error) {
    // A newer input supersedes any check in flight.
    want.sequence += 1;
    want.pending = false;
    want.error = inputs.error;
    renderWantPreview();
    renderWantActions();
    return;
  }
  want.error = "";
  if (wantInputsMatchPreview(inputs, want.preview)) {
    want.pending = false;
    renderWantPreview();
    renderWantActions();
    return;
  }
  want.pending = true;
  renderWantActions();
  want.timer = setTimeout(() => {
    want.timer = null;
    void requestWantPreview(inputs);
  }, delay);
}

async function openWant(listingId, { mode = "", trigger = null } = {}) {
  const dialog = $("#wantDialog");
  if (state.want?.timer) clearTimeout(state.want.timer);
  state.want = { listingId, preview: null, error: "", sequence: 0, timer: null, pending: false, saving: false, controlsFor: "", returnFocus: trigger };
  $("#wantDialogEyebrow").textContent = "Want it";
  renderWant();
  if (!dialog.open) dialog.showModal();
  // An explicit mode (an existing plan's) wins; otherwise the first-plan choice
  // on Home, otherwise Add to cart.
  const startMode = mode || firstPlanIntent() || "add_to_cart";
  await requestWantPreview({ mode: startMode === "notify" ? "notify" : "add_to_cart" });
  void loadWantHistory(listingId);
  // The MSRP field starts filled in (TrackaLacker's MSRP or the one confirmed
  // before); check the item with it so Want it can be pressed right away.
  if (state.want?.preview?.msrpConfirmation?.needed && $("#wantForm").elements.wantMsrp?.value) scheduleWantPreview(0);
}

async function saveWant() {
  const want = state.want;
  const preview = want?.preview;
  if (!want || !preview || want.saving || want.pending) return;
  const inputs = readWantInputs();
  if (inputs.error) {
    scheduleWantPreview(0);
    return;
  }
  if (!wantInputsMatchPreview(inputs, preview)) {
    await requestWantPreview(inputs);
    return;
  }
  if (!preview.canSave) return;
  want.saving = true;
  renderWantActions();
  try {
    const result = await api("/api/v1/user/purchase-intents/want", {
      method: "POST",
      body: JSON.stringify({
        contractVersion: 1,
        listingId: want.listingId,
        mode: preview.requestedMode,
        maxUnitPriceCents: preview.maxUnitPriceCents,
        ...(preview.msrpConfirmation?.confirmedCents ? { confirmedMsrpCents: preview.msrpConfirmation.confirmedCents } : {}),
        ...(preview.requestedMode === "add_to_cart" && preview.priceRule ? { priceRule: preview.priceRule } : {}),
        targetQuantity: preview.targetQuantity,
        confirmation: "SAVE_PRODUCT_WANT",
        previewFingerprint: preview.previewFingerprint,
        previewedAt: preview.previewedAt
      })
    });
    const returnFocus = want.returnFocus;
    want.saving = false;
    const planId = String(result.purchaseIntent?.id || "");
    // Its button turns into Yoink and draws the mark (cleared once drawn, or
    // after a few seconds when it isn't on screen or motion is reduced).
    state.justYoinked = planId;
    setTimeout(() => { if (state.justYoinked === planId) state.justYoinked = ""; }, 4000);
    $("#wantDialog").close();
    await refresh();
    const watched = storeListWords(preview.stores.filter((store) => store.watch !== "off").map((store) => store.retailerName));
    const message = preview.mode === "add_to_cart"
      ? `${preview.title}: Yoink adds it to your cart at ${watched} for up to ${money(preview.maxUnitPriceCents)}.`
      : `${preview.title}: Yoink alerts you when ${watched} has it for up to ${money(preview.maxUnitPriceCents)}.`;
    toast(message, false, {
      ...(returnFocus?.isConnected ? { element: returnFocus } : {}),
      ...(result.created && planId ? {
        durationMs: 10_000,
        action: {
          label: "Undo",
          onClick: async () => {
            await api(`/api/v1/user/purchase-intents/${encodeURIComponent(planId)}`, {
              method: "DELETE",
              body: JSON.stringify({ confirmation: "DELETE_PURCHASE_PLAN" })
            });
            await refresh();
            toast(`${preview.title} is off your Want list.`);
          }
        }
      } : {})
    });
  } catch (error) {
    if (state.want !== want) throw error;
    want.saving = false;
    if (WANT_PREVIEW_RETRY_CODES.has(String(error.code || ""))) {
      await requestWantPreview(inputs);
      want.error = "Something changed, so Yoink checked again. Review it, then save.";
      renderWant();
      return;
    }
    want.error = error.message || "Yoink couldn't save this. Try again.";
    renderWant();
  }
}

async function stopWanting() {
  const want = state.want;
  const preview = want?.preview;
  if (!preview?.plan) return;
  if (!(await requestConfirmation({
    title: `Stop wanting “${preview.title}”?`,
    summary: "Yoink stops watching it for you. Anything already in a store cart stays there.",
    confirmLabel: "Stop wanting",
    danger: true
  })).confirmed) return;
  await api(`/api/v1/user/purchase-intents/${encodeURIComponent(preview.plan.id)}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmation: "DELETE_PURCHASE_PLAN" })
  });
  $("#wantDialog").close();
  await refresh();
  toast(`${preview.title} is off your Want list.`);
}

async function openWantMoreOptions() {
  const want = state.want;
  if (!want?.preview) return;
  const planId = want.preview.plan?.id || "";
  const listingId = want.listingId;
  $("#wantDialog").close();
  if (planId) await openPlan(planId);
  else await openSetup(listingId);
}

// Want every item of an "All New …" entry (Kevin, 2026-10-09). The server
// works out each item's max: Yoink's suggested price, else its first store price.
async function openCollectionWant(variantId, trigger = null) {
  const dialog = $("#collectionWantDialog");
  state.collectionWant = { variantId, preview: null, saving: false, returnFocus: trigger };
  $("#collectionWantTitle").textContent = "All New";
  $("#collectionWantSummary").textContent = "Loading its items…";
  $("#collectionWantList").innerHTML = "";
  renderCollectionWantActions();
  if (!dialog.open) dialog.showModal();
  try {
    const { collection } = await api(`/api/v1/user/collections/want?variantId=${encodeURIComponent(variantId)}`);
    if (state.collectionWant?.variantId !== variantId) return;
    state.collectionWant.preview = collection;
    renderCollectionWant();
  } catch (error) {
    $("#collectionWantSummary").textContent = error.message || "This entry's items could not load. Try again.";
  }
}

function renderCollectionWant() {
  const preview = state.collectionWant?.preview;
  if (!preview) return;
  $("#collectionWantTitle").textContent = preview.title;
  $("#collectionWantEyebrow").textContent = preview.wanted ? "On your Want list" : "Want every item";
  const mode = preview.mode || firstPlanIntent() || "add_to_cart";
  for (const input of $$('#collectionWantForm input[name="collectionMode"]')) input.checked = input.value === (mode === "notify" ? "notify" : "add_to_cart");
  const count = preview.items.length;
  $("#collectionWantSummary").textContent = `${count ? `${count.toLocaleString()} item${count === 1 ? "" : "s"} so far. ` : "No items yet. "}Yoink wants each one now and every new one as it appears. Each item's max is Yoink's suggested price; a brand-new item starts at its first store price. Items you set up yourself stay as you set them.`;
  $("#collectionWantList").innerHTML = preview.items.map((item) => {
    const detail = item.maxUnitPriceCents
      ? `${item.retailerName ? `${item.retailerName} · ` : ""}max ${money(item.maxUnitPriceCents)}${item.note ? ` · ${item.note}` : ""}`
      : item.note || "Waiting for a store price";
    return `<div class="call-added-item collection-item"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(detail)}</small></span></div>`;
  }).join("");
  renderCollectionWantActions();
}

function renderCollectionWantActions() {
  const want = state.collectionWant;
  const save = $("#collectionWantSave");
  $("#collectionWantStop").hidden = !want?.preview?.wanted;
  save.disabled = !want?.preview || want.saving;
  save.textContent = want?.saving ? "Saving…" : want?.preview?.wanted ? "Save" : "Want every item";
}

async function saveCollectionWant(event) {
  event.preventDefault();
  const want = state.collectionWant;
  if (!want?.preview || want.saving) return;
  const mode = $('#collectionWantForm input[name="collectionMode"]:checked')?.value === "notify" ? "notify" : "add_to_cart";
  want.saving = true;
  renderCollectionWantActions();
  try {
    const { collection } = await api("/api/v1/user/collections/want", {
      method: "POST",
      body: JSON.stringify({ contractVersion: 1, variantId: want.variantId, mode, confirmation: "WANT_ALL_NEW_ITEMS" })
    });
    const returnFocus = want.returnFocus;
    state.justYoinked = `collection:${want.variantId}`;
    setTimeout(() => { if (state.justYoinked === `collection:${want.variantId}`) state.justYoinked = ""; }, 4000);
    $("#collectionWantDialog").close();
    await refresh();
    const wanted = collection.wanted.length;
    const doing = mode === "add_to_cart" ? "adds each to your cart" : "alerts you about each";
    toast(`${collection.title}: Yoink ${doing} up to its suggested price. ${wanted.toLocaleString()} item${wanted === 1 ? "" : "s"} wanted now; new ones join as they appear.`, false,
      returnFocus?.isConnected ? { element: returnFocus } : {});
  } catch (error) {
    toast(error.message || "This entry could not be saved. Try again.", true);
  } finally {
    want.saving = false;
    if ($("#collectionWantDialog").open) renderCollectionWantActions();
  }
}

async function stopCollectionWant() {
  const preview = state.collectionWant?.preview;
  if (!preview?.wanted) return;
  if (!(await requestConfirmation({
    title: `Stop wanting every “${preview.title}” item?`,
    summary: "The items it added come off your Want list, and new items stop joining. Items you set up yourself stay. Anything already in a store cart stays there.",
    confirmLabel: "Stop wanting",
    danger: true
  })).confirmed) return;
  const { collection } = await api(`/api/v1/user/collections/want?variantId=${encodeURIComponent(preview.variantId)}`, { method: "DELETE" });
  $("#collectionWantDialog").close();
  await refresh();
  toast(`${preview.title} is off your Want list.${collection?.kept ? ` ${collection.kept} item${collection.kept === 1 ? " stays" : "s stay"} until ${collection.kept === 1 ? "its" : "their"} cart add finishes.` : ""}`);
}

$("#collectionWantForm").addEventListener("submit", (event) => { void saveCollectionWant(event); });
$("#msrpFillForm").addEventListener("submit", (event) => { void applyMsrpFill(event); });
$("#msrpFillForm").addEventListener("change", syncMsrpFillButton);
$("#callAddedForm").addEventListener("submit", (event) => { void removeCallAddedItems(event); });
$("#callAddedForm").addEventListener("change", syncCallAddedRemoveButton);
$("#callAddedDialog").addEventListener("close", () => { state.callAdded = null; });
$("#collectionWantDialog").addEventListener("close", () => { state.collectionWant = null; });

$("#wantForm").addEventListener("submit", (event) => {
  event.preventDefault();
  void saveWant();
});
$("#wantForm").addEventListener("input", (event) => {
  if (event.target.name === "wantMsrp") {
    // A lower MSRP pulls a higher max down with it: cart adds never go above the MSRP.
    const form = $("#wantForm");
    try {
      const msrp = centsInput(String(event.target.value).replace(/^\$\s*/, "").trim(), "The MSRP");
      const max = centsInput(String(form.elements.wantMax.value).replace(/^\$\s*/, "").trim(), "Your max price");
      if (max > msrp) form.elements.wantMax.value = moneyInput(msrp);
    } catch { /* an incomplete number is reported by the preview check */ }
  }
  if (event.target.name === "wantMax" || event.target.name === "wantMsrp") scheduleWantPreview(WANT_PREVIEW_DELAY_MS);
});
$("#discordEnabled").addEventListener("change", async (event) => {
  const input = event.target;
  const enabled = input.checked;
  input.disabled = true;
  try {
    const { settings } = await api("/api/v1/user/discord/settings", { method: "PATCH", body: JSON.stringify({ enabled }) });
    state.discord = { ...(state.discord || {}), settings, reader: state.discord?.reader ? { ...state.discord.reader, state: settings.enabled ? "starting" : "off" } : null };
    toast(settings.enabled ? "Yoink reads Discord notifications on this PC." : "Yoink stopped reading Discord notifications.");
  } catch (error) {
    input.checked = !enabled;
    toast(error.message || "The Discord setting could not be saved. Try again.", true);
  } finally {
    renderDiscordSetup();
  }
});
$("#discordChannelList").addEventListener("change", async (event) => {
  const select = event.target.closest?.("select[data-discord-channel]");
  if (!select) return;
  const channel = (state.discord?.channels || []).find((item) => item.id === select.dataset.discordChannel);
  const previous = channel?.mode || "add";
  select.disabled = true;
  try {
    const { channel: saved } = await api(`/api/v1/user/discord/channels/${encodeURIComponent(select.dataset.discordChannel)}`,
      { method: "PATCH", body: JSON.stringify({ mode: select.value }) });
    if (channel) channel.mode = saved.mode;
    const label = DISCORD_CHANNEL_MODES.find(([value]) => value === saved.mode)?.[1] || saved.mode;
    toast(`${saved.name}: ${label}.`);
  } catch (error) {
    select.value = previous;
    toast(error.message || "The channel could not be saved. Try again.", true);
  } finally {
    select.disabled = false;
  }
});
$("#discordLinkForm").addEventListener("input", (event) => {
  const link = state.discordLink;
  if (!link) return;
  if (event.target.name === "variantId") {
    link.variantId = event.target.value;
    $("#discordLinkForm").querySelector('button[type="submit"]').disabled = !link.variantId;
    return;
  }
  if (event.target.name !== "query") return;
  clearTimeout(link.searchTimer);
  link.searchTimer = setTimeout(() => void loadDiscordLinkChoices(event.target.value), 250);
});
$("#discordLinkForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const link = state.discordLink;
  if (!link?.variantId) return;
  const button = $("#discordLinkForm").querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { linked } = await api("/api/v1/user/discord/links", { method: "POST", body: JSON.stringify({ signalId: link.signalId, variantId: link.variantId }) });
    state.discordLink = null;
    $("#discordLinkDialog").close();
    toast(`Discord messages with these product words now match ${linked.title}.`);
  } catch (error) {
    button.disabled = false;
    toast(error.message || "The product could not be linked. Try again.", true);
  }
});
$("#discordLinkDialog").addEventListener("close", () => {
  clearTimeout(state.discordLink?.searchTimer);
  state.discordLink = null;
});
$("#restockRetryForm").addEventListener("input", () => {
  const form = $("#restockRetryForm");
  form.dataset.dirty = "true";
  const value = readRestockRetryForm();
  form.querySelector(".restock-retry-fields").hidden = !value.enabled;
  const valid = Number.isInteger(value.attempts) && value.attempts >= 1 && value.attempts <= 10
    && Number.isInteger(value.windowMinutes) && value.windowMinutes >= 1 && value.windowMinutes <= 60;
  $("#restockRetrySummary").textContent = valid ? restockRetrySummary(value) : "Tries are 1 to 10, over 1 to 60 minutes.";
});
$("#restockRetryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = $("#restockRetryForm");
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { settings } = await api("/api/v1/user/settings/restock-retry", { method: "PATCH", body: JSON.stringify(readRestockRetryForm()) });
    if (state.overview?.settings && settings?.restockRetry) state.overview.settings.restockRetry = settings.restockRetry;
    delete form.dataset.dirty;
    renderRestockRetry();
    toast(settings?.restockRetry?.enabled ? "Retry when sold out is on." : "Retry when sold out is off.");
  } catch (error) {
    toast(error.message || "Retry when sold out could not be saved. Try again.", true);
  } finally {
    button.disabled = false;
  }
});

$("#wantForm").addEventListener("click", (event) => {
  const use = event.target.closest?.("[data-use-suggested]");
  if (!use) return;
  const form = $("#wantForm");
  if (!form.elements.wantMax) return;
  form.elements.wantMax.value = moneyInput(Number(use.dataset.useSuggested));
  form.elements.wantMax.dispatchEvent(new Event("change", { bubbles: true }));
});
$("#wantForm").addEventListener("change", (event) => {
  if (["wantMode", "wantQuantity", "wantMax", "wantMsrp", "wantAnyPrice"].includes(event.target.name)) scheduleWantPreview(0);
});
$("#wantDialog").addEventListener("close", () => {
  if (state.want?.timer) clearTimeout(state.want.timer);
  const returnFocus = state.want?.returnFocus;
  state.want = null;
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
});

async function closeDraftDialog(dialog) {
  if (!dialog) return;
  if (dialog.dataset.dirty === "true") {
    const result = await requestConfirmation({ title: "Discard this draft?", summary: "Your unsaved edits will be lost. Saved plans and limits have not changed.", confirmLabel: "Discard draft" });
    if (!result.confirmed) return;
  }
  if (dialog.id === "productLinkDialog") clearLinkDraft();
  dialog.dataset.dirty = "false";
  closeEntityDialog(dialog);
}
for (const id of ["setupDialog", "planDialog", "productLinkDialog"]) {
  const dialog = document.getElementById(id);
  if (!dialog) continue;
  dialog.addEventListener("input", () => { dialog.dataset.dirty = "true"; });
  dialog.addEventListener("change", () => { dialog.dataset.dirty = "true"; });
  dialog.addEventListener("cancel", (event) => {
    if (dialog.dataset.dirty !== "true") return;
    event.preventDefault();
    void closeDraftDialog(dialog);
  });
  dialog.addEventListener("close", () => { dialog.dataset.dirty = "false"; });
}
window.addEventListener("beforeunload", (event) => {
  if (!document.querySelector('dialog[open][data-dirty="true"], #spendForm[data-dirty="true"]')) return;
  event.preventDefault();
  event.returnValue = "";
});

for (const type of ["input", "change"]) {
  $("#spendForm").addEventListener(type, () => { $("#spendForm").dataset.dirty = "true"; });
}

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
    $("#spendForm").dataset.dirty = "false";
    document.activeElement?.blur();
    await refresh();
    toast("Spending limits saved.");
  } catch (error) { toast(error.message || "Spending limits could not be saved.", true); }
});

$("#watchQueueMode").addEventListener("change", async (event) => {
  const control = event.currentTarget;
  const previous = state.actionPlatform?.watchQueueMode === "auto_armed" ? "auto_armed" : "manual";
  const mode = control.value === "auto_armed" ? "auto_armed" : "manual";
  control.disabled = true;
  try {
    const queue = await api("/api/v1/user/watch-queue");
    const active = (queue.items || []).filter((item) => ["queued", "observing"].includes(item.state)).length;
    const review = await requestConfirmation({ title: mode === "auto_armed" ? "Automatically watch scheduled drops?" : "Switch to manual watching?", summary: `${active} current watch${active === 1 ? "" : "es"} will keep running until stopped or ended. ${mode === "auto_armed" ? "Open and future drops for active plans can be enrolled automatically. Watching does not add to cart; saved plans and store checks still apply." : "New drops will wait for you to choose Watch. Use Calls to stop any current watch."}`, confirmLabel: "Change watch mode" });
    if (!review.confirmed) { control.value = previous; return; }
    const result = await api("/api/v1/user/watch-queue/settings", {
      method: "PATCH",
      body: JSON.stringify({ mode, confirmation: "SET_WATCH_QUEUE_MODE" })
    });
    state.actionPlatform = {
      ...(state.actionPlatform || {}),
      watchQueueMode: result.watchQueue?.mode || mode
    };
    await refresh();
    setTab("setup");
    setSetupSection("limits", { historyMode: "replace" });
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

for (const [controlId, browseKey] of [
  ["browseStore", "store"],
  ["browseAvailability", "availability"],
  ["browsePlan", "plan"],
  ["browsePrice", "price"],
  ["browseSort", "sort"]
]) {
  $(`#${controlId}`).addEventListener("change", async (event) => {
    state.browse[browseKey] = event.target.value;
    if (browseKey === "availability") rememberInStockOnly(event.target.value === "in_stock");
    writeUserRoute("replace", "find");
    try {
      await loadUserRoute("find", { force: true });
    } catch (error) {
      toast(error.message || "Product filters could not be applied.", true);
    }
  });
}

$("#inStockOnly").addEventListener("change", async (event) => {
  const on = event.target.checked;
  state.browse.availability = on ? "in_stock" : "";
  $("#browseAvailability").value = state.browse.availability;
  rememberInStockOnly(on);
  writeUserRoute("replace", "find");
  try {
    await loadUserRoute("find", { force: true });
  } catch (error) {
    toast(error.message || "Product filters could not be applied.", true);
  }
});

let planSearchTimer;
$("#planSearch").addEventListener("input", (event) => {
  clearTimeout(planSearchTimer);
  state.planQuery = event.target.value.trim();
  state.planRequestSequence += 1;
  planSearchTimer = setTimeout(async () => {
    state.planOffset = 0;
    writeUserRoute("replace", "cart");
    await loadUserRoute("cart", { force: true });
  }, 250);
});

let searchTimer;
$("#productSearch").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    state.query = event.target.value.trim();
    writeUserRoute("replace", "find");
    try { await loadUserRoute("find", { force: true }); } catch (error) { toast(error.message || "Product search failed.", true); }
  }, 250);
});

$("#cartOutcomeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const action = state.cartOutcomeActionId === form.elements.actionId.value
    ? findActionById(state.cartOutcomeActionId) : null;
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

let resumeVisibleDashboardInFlight = null;
function resumeVisibleDashboard() {
  // Visibility changes and the Retry pill can fire back to back; share the
  // in-flight refresh instead of stacking overlapping ones.
  if (resumeVisibleDashboardInFlight) return resumeVisibleDashboardInFlight;
  // A cart-ready handoff is the most time-sensitive dashboard state. Start
  // its compact, versioned watch before the broader overview/workspace
  // refresh so slow secondary data cannot delay the route to checkout.
  const route = activeUserRoute();
  const priorityRouteLoad = beginPriorityRouteLoad(route);
  void beginCompactHandoffWatch(route);
  scheduleAdaptivePoll();
  resumeVisibleDashboardInFlight = refresh({
    priorityRoute: priorityRouteLoad ? route : "",
    priorityRouteLoad,
    preservePagination: true
  })
    .catch(() => setUserDataStale(true))
    .finally(() => {
      resumeVisibleDashboardInFlight = null;
      scheduleAdaptivePoll();
    });
  return resumeVisibleDashboardInFlight;
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
if (initialRoute === "cart") void refreshCompactActionHandoff(0).catch(() => undefined);
refresh({
  priorityRoute: initialPriorityRouteLoad ? initialRoute : "",
  priorityRouteLoad: initialPriorityRouteLoad
}).catch((error) => {
  // With no overview the header must not offer a Pause button that cannot work.
  if (!state.overview) renderOfflineHeader();
  toast(error.message || "Yoink could not load.", true);
}).finally(() => {
  applyHashRoute();
  void beginCompactHandoffWatch(activeUserRoute());
  scheduleAdaptivePoll();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    updateProductEvidenceTimes();
    void resumeVisibleDashboard();
  } else {
    scheduleAdaptivePoll();
  }
});

setInterval(() => {
  if (document.visibilityState === "visible") updateProductEvidenceTimes();
}, 30_000);

function entityKey() {
  return state.entity ? `${state.entity.panel}:${state.entity.kind}:${state.entity.id}` : "";
}

async function restoreEntityDetail() {
  const entity = state.entity;
  const key = entityKey();
  if (!entity || entity.panel !== activeUserRoute() || state.entityLoading?.key === key) return;
  const dialog = $(entity.kind === "plan" ? "#planDialog" : "#productDialog");
  if (dialog.open && dialog.dataset.entityKey === key) return;
  const pending = { key };
  state.entityLoading = pending;
  try {
    if (entity.kind === "plan") await openPlan(entity.id, { routed: true });
    else await openProductDetail(entity.id, { routed: true });
    if (key !== entityKey() || state.entityLoading !== pending) return;
    dialog.dataset.entityKey = key;
    const errorDialog = $("#entityErrorDialog");
    errorDialog.dataset.entityKey = "";
    if (errorDialog.open) errorDialog.close();
  } catch (error) {
    if (key !== entityKey() || state.entityLoading !== pending) return;
    $("#entityErrorMessage").textContent = error.message || "This detail could not load. Retry or return to the list.";
    $("#entityErrorDialog").dataset.entityKey = key;
    if (!$("#entityErrorDialog").open) $("#entityErrorDialog").showModal();
  } finally {
    if (state.entityLoading === pending) state.entityLoading = null;
  }
}

for (const id of ["productDialog", "planDialog", "entityErrorDialog"]) {
  const dialog = $(`#${id}`);
  dialog.addEventListener("cancel", event => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    // Clear the route before a refresh can reopen it while the native close event is queued.
    closeEntityDialog(dialog);
  });
  dialog.addEventListener("close", () => {
    if (!dialog.open && state.entity && dialog.dataset.entityKey === entityKey()) {
      state.entityRequestSequence += 1;
      state.entity = null;
      writeUserRoute("replace", activeUserRoute());
    }
  });
}

async function loadConnectorHistory() {
  const sequence = ++state.connectorHistorySequence;
  state.connectorHistoryLoading = true;
  state.connectorHistoryError = false;
  renderConnectorHistory();
  try {
    const page = await api(`/api/v1/user/connectors/deliveries?offset=${state.connectorOffset}&connector=${encodeURIComponent(state.connectorFilter)}`);
    if (sequence !== state.connectorHistorySequence) return;
    state.connectorHistory = { items: page.items || [], total: Number(page.total || 0) };
    state.connectorHistoryLoaded = true;
    if (!page.items?.length && state.connectorOffset > 0) {
      state.connectorOffset = Math.max(0, Math.floor((state.connectorHistory.total - 1) / 50) * 50);
      return loadConnectorHistory();
    }
  } catch (error) {
    if (sequence !== state.connectorHistorySequence) return;
    state.connectorHistoryError = true;
    throw error;
  } finally {
    if (sequence === state.connectorHistorySequence) {
      state.connectorHistoryLoading = false;
      renderConnectorHistory();
    }
  }
}

function renderConnectorHistory() {
  const select = $("#deliveryConnectorFilter");
  const connectors = state.actionPlatform?.connectors || [];
  select.innerHTML = '<option value="">All destinations</option>' + connectors.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  select.value = state.connectorFilter;
  select.disabled = state.connectorHistoryLoading;
  $("#deliveryHistoryError").hidden = !state.connectorHistoryError;
  $("#deliveryHistoryList").setAttribute("aria-busy", String(state.connectorHistoryLoading));
  const { items, total } = state.connectorHistory;
  $("#deliveryHistoryList").innerHTML = items.map((item) => `<div class="mini-row"><span><strong>${escapeHtml(item.connectorName)} · ${escapeHtml(words(item.eventType))}</strong><small>${escapeHtml(words(item.state))} · ${Number(item.attemptCount)} attempts · ${escapeHtml(relative(item.createdAt))}${item.lastErrorCode ? ` · ${escapeHtml(words(item.lastErrorCode))}` : ""}</small></span>${item.state === "dead_letter" ? `<button class="button quiet" data-retry-delivery="${escapeHtml(item.id)}" type="button">Retry update</button>` : ""}</div>`).join("") || '<p>No updates in this history. Send a test from a configured destination.</p>';
  $("#deliveryPageStatus").textContent = state.connectorHistoryLoading ? "Loading updates…" : state.connectorHistoryError ? "History unavailable" : `${items.length ? state.connectorOffset + 1 : 0}–${state.connectorOffset + items.length} of ${total}`;
  $("#previousDeliveries").disabled = state.connectorHistoryLoading || state.connectorHistoryError || state.connectorOffset === 0;
  $("#nextDeliveries").disabled = state.connectorHistoryLoading || state.connectorHistoryError || state.connectorOffset + items.length >= total;
}

$("#deliveryConnectorFilter").addEventListener("change", async (event) => {
  const previousFilter = state.connectorFilter;
  const previousOffset = state.connectorOffset;
  state.connectorFilter = event.target.value;
  state.connectorOffset = 0;
  try { await loadConnectorHistory(); renderConnectorHistory(); }
  catch (error) { state.connectorFilter = previousFilter; state.connectorOffset = previousOffset; renderConnectorHistory(); toast(error.message, true); }
});

$("#browserNameForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await api(`/api/v1/user/devices/${encodeURIComponent(form.elements.id.value)}`, { method: "PATCH", body: JSON.stringify({ name: form.elements.name.value.trim() }) });
    state.preferenceRequestSequence += 1;
    state.devices = state.devices.map((device) => device.id === form.elements.id.value ? { ...device, name: form.elements.name.value.trim() } : device);
    renderPairedDevices();
    $("#browserNameDialog").close();
    await refresh();
    toast("Browser name saved.");
  } catch (error) { toast(error.message, true); }
  finally { submit.disabled = false; }
});

function activityPath(offset) {
  const query = new URLSearchParams({ limit: "100", offset: String(offset) });
  for (const [key, value] of Object.entries(state.activityFilters)) if (value) query.set(key, value);
  return `/api/v1/user/jobs?${query}`;
}

function renderWatchHistory() {
  const list = $("#watchHistoryList");
  if (!list) return;
  const filter = $("#watchHistoryFilter").value;
  const all = [...(state.actionPlatform?.watchQueue || [])].filter((item) => filter === "all" || (["queued", "observing"].includes(item.state) ? filter === "active" : filter === "ended"))
    .sort((a, b) => String(b.updatedAt || b.closesAt).localeCompare(String(a.updatedAt || a.closesAt)) || b.id.localeCompare(a.id));
  list.innerHTML = all.slice(0, state.watchHistoryLimit).map((item) => `<div class="mini-row"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(retailerDisplayName(item.retailerId))} · ${escapeHtml(words(item.state))}${item.closedReason ? ` · ${escapeHtml(words(item.closedReason))}` : ""} · ${Number(item.observationCount)} checks · ${item.lastObservedAt ? `Last checked ${escapeHtml(relative(item.lastObservedAt))}` : "Not checked yet"}</small></span>${item.missionId ? `<button class="button quiet" data-edit-plan="${escapeHtml(item.missionId)}" type="button">Review plan</button>` : ""}${["queued", "observing"].includes(item.state) ? `<button class="button quiet" data-watch-cancel="${escapeHtml(item.id)}" type="button">Stop watching</button>` : ""}</div>`).join("") || '<p>No matching watches. Choose Watch on a scheduled call to begin.</p>';
  $("#moreWatchHistory").hidden = all.length <= state.watchHistoryLimit;
}

$("#watchHistoryFilter")?.addEventListener("change", () => { state.watchHistoryLimit = 25; renderWatchHistory(); });

function closeEntityDialog(dialog) {
  if (state.entity && dialog.dataset.entityKey === entityKey()) {
    state.entityRequestSequence += 1;
    state.entity = null;
    writeUserRoute("replace", activeUserRoute());
  }
  dialog.dataset.entityKey = "";
  dialog.close();
}

function hasPlanFilters() {
  return Boolean(state.planQuery) || state.planView !== "all";
}

function linkDraftKey() { return state.overview?.actor?.userId ? `yoinkLinkDraft:${state.overview.actor.userId}` : ""; }
function saveLinkDraft() {
  const key = linkDraftKey();
  if (!key) return;
  const form = $("#productLinkForm");
  try { sessionStorage.setItem(key, JSON.stringify({ url: form.elements.url.value, title: form.elements.title.value, savedAt: Date.now() })); }
  catch { $("#productLinkDraftStatus").hidden = false; $("#productLinkDraftStatus").textContent = "This tab could not retain the draft. Keep it open until submission succeeds."; }
}
function clearLinkDraft() { try { if (linkDraftKey()) sessionStorage.removeItem(linkDraftKey()); } catch { /* No stored draft to remove. */ } }
$("#productLinkForm").addEventListener("input", saveLinkDraft);

async function loadReviewHistory(offset = state.reviewHistory.offset) {
  const history = state.reviewHistory;
  const sequence = ++history.sequence;
  history.loading = true; history.error = false; renderReviewHistory();
  try {
    const page = await api(`/api/v1/user/catalog/proposals?limit=25&offset=${Math.max(0, offset)}`);
    if (sequence !== history.sequence) return;
    history.items = page.items || []; history.total = Number(page.total ?? history.items.length); history.offset = Math.max(0, offset);
    if (!history.items.length && history.offset > 0) return loadReviewHistory(Math.max(0, Math.floor((history.total - 1) / 25) * 25));
  } catch { if (sequence === history.sequence) history.error = true; }
  finally { if (sequence === history.sequence) { history.loading = false; renderReviewHistory(); } }
}

function renderReviewHistory() {
  const history = state.reviewHistory;
  $("#reviewHistoryError").hidden = !history.error;
  $("#reviewHistoryList").setAttribute("aria-busy", String(history.loading));
  $("#reviewHistoryList").innerHTML = history.items.map(proposal => `<article class="impact-plan"><strong>${escapeHtml(proposal.payload?.title || "Product suggestion")}</strong><p>${escapeHtml(words(proposal.status))} · ${escapeHtml(retailerDisplayName(proposal.retailerId))} · ${escapeHtml(proposal.retailerSku)}</p><p>Submitted ${escapeHtml(new Date(proposal.createdAt).toLocaleString())}${proposal.decidedAt ? ` · Reviewed ${escapeHtml(new Date(proposal.decidedAt).toLocaleString())}` : ""}</p>${proposal.reviewNote ? `<p>Review note: ${escapeHtml(proposal.reviewNote)}</p>` : ""}${retailerLinkMarkup(proposal.payload?.canonicalUrl, proposal.payload?.title || "Product suggestion", "Review store page ↗")}${proposal.status === "rejected" ? `<button class="button secondary" data-correct-proposal="${escapeHtml(proposal.id)}" type="button">Correct and resubmit</button>` : ""}</article>`).join("") || (history.loading || history.error ? "" : "<p>No product suggestions yet.</p>");
  $("#reviewHistoryPage").textContent = history.loading ? "Loading reviews…" : history.error ? "History unavailable" : `${history.items.length ? history.offset + 1 : 0}–${history.offset + history.items.length} of ${history.total}`;
  $("#previousReviews").disabled = history.loading || history.offset === 0;
  $("#nextReviews").disabled = history.loading || history.offset + history.items.length >= history.total;
}
$("#openReviewHistory").addEventListener("click", () => { $("#reviewHistoryDialog").showModal(); void loadReviewHistory(0); });
$("#retryReviewHistory").addEventListener("click", () => { void loadReviewHistory(); });
$("#previousReviews").addEventListener("click", () => { void loadReviewHistory(state.reviewHistory.offset - 25); });
$("#nextReviews").addEventListener("click", () => { void loadReviewHistory(state.reviewHistory.offset + 25); });
document.addEventListener("click", event => {
  const button = event.target.closest?.("[data-correct-proposal]");
  if (!button) return;
  const proposal = [...state.proposals, ...state.reviewHistory.items].find(item => item.id === button.dataset.correctProposal);
  if (!proposal || proposal.status !== "rejected") return;
  if ($("#reviewHistoryDialog").open) $("#reviewHistoryDialog").close();
  openProductLinkDialog(proposal);
});

function isGuardedStore(retailerId) {
  return ["target", "walmart", "amazon", "bestbuy", "pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"].includes(retailerId);
}

function storeSetupButton(retailerId, planId) {
  return `<button class="button quiet" data-store-setup="${escapeHtml(retailerId)}" data-setup-plan="${escapeHtml(planId)}" type="button">${escapeHtml(retailerDisplayName(retailerId))} setup</button>`;
}

async function openStoreSetup(retailerId, planId, trigger) {
  if (!isGuardedStore(retailerId)) return;
  if (document.querySelector('dialog[open][data-dirty="true"]')) {
    toast("Save or close your plan draft before opening store setup.");
    return;
  }
  for (const id of ["productDialog", "planDialog", "entityErrorDialog"]) {
    const dialog = $(`#${id}`);
    dialog.dataset.entityKey = "";
    if (dialog.open) dialog.close();
  }
  state.entity = null;
  state.entityRequestSequence += 1;
  state.storeSetup = { retailerId, planId, panel: activeUserRoute() };
  state.storeSetupData = null;
  state.storeSetupReturnFocus = trigger;
  writeUserRoute("push", activeUserRoute());
  await loadStoreSetup();
}

function closeStoreSetup({ writeRoute = true } = {}) {
  if (!state.storeSetup) return;
  state.storeSetupSequence += 1;
  state.storeSetup = null;
  state.storeSetupData = null;
  state.storeSetupLoading = false;
  const dialog = $("#storeSetupDialog");
  if (dialog.open) dialog.close();
  if (writeRoute) writeUserRoute("replace", activeUserRoute());
  const trigger = state.storeSetupReturnFocus;
  state.storeSetupReturnFocus = null;
  if (writeRoute) {
    const replacement = trigger && $$('[data-store-setup]').find(button => !button.closest("dialog")
      && button.dataset.storeSetup === trigger.dataset.storeSetup
      && (button.dataset.setupPlan || "") === (trigger.dataset.setupPlan || "")
      && button.closest('[data-panel]')?.classList.contains("active"));
    (trigger?.isConnected && !trigger.closest("dialog") ? trigger : replacement)?.focus();
  }
}

function storeSetupActionMarkup(store, action, { primary = false } = {}) {
  const style = `button ${primary ? "primary" : "quiet"}`;
  const external = (href, label) => `<a class="${style}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>`;
  if (action === "chrome") return external("/#setup/chrome", "Open Chrome setup");
  // A store this account may turn on itself has one place for that: its
  // switch in Setup › Stores, behind the same store check Admin uses.
  if (action === "activation" && store.cartAdds?.canTurnOn) return `<button class="${style}" data-store-setup-switch="${escapeHtml(store.retailerId)}" type="button">Turn on in Setup</button>`;
  if (action === "activation" && store.canActivate) return external(`/admin#stores/qualification/${store.retailerId}`, `Review ${store.retailerName} activation`);
  if (action === "mode" && store.canManageExecution) return external("/admin#settings/guardrails", "Review execution settings");
  if (action === "actions" && store.canManageActions && !store.canResumeActions) return '<small>Turn on a store before turning on Auto-cart.</small>';
  if (action === "actions" && store.canManageActions) return `<button class="${style}" id="resumeStoreSetupActions" type="button">Turn on Auto-cart</button>`;
  if (action === "sign_in") {
    const target = state.storeSetupData?.purchaseIntent?.targets?.find(item => item.enabled && item.retailerId === store.retailerId);
    const home = { target: "https://www.target.com/", walmart: "https://www.walmart.com/", amazon: "https://www.amazon.com/", bestbuy: "https://www.bestbuy.com/", pokemoncenter: "https://www.pokemoncenter.com/", aninebing: "https://www.aninebing.com/", americaneagle: "https://www.ae.com/us/en", athleta: "https://athleta.gap.com/", audioadvice: "https://www.audioadvice.com/", bananarepublic: "https://bananarepublic.gap.com/", bananarepublicfactory: "https://bananarepublicfactory.gapfactory.com/", asus: "https://eshop.asus.com/us/" }[store.retailerId];
    return retailerLinkMarkup(target?.canonicalUrl || store.candidate?.canonicalUrl || home, `${store.retailerName} store setup`, `Open ${store.retailerName} in Chrome ↗`, style);
  }
  const label = action === "permission" ? "How to check permission" : action === "checks" ? "How to run store checks" : "Administrator handoff";
  return `<button class="${style}" data-store-setup-help="${escapeHtml(action)}" type="button">${label}</button>`;
}

function renderStoreSetup() {
  const data = state.storeSetupData;
  const store = data?.stores?.find(item => item.retailerId === state.storeSetup?.retailerId);
  if (!store) throw new Error("This store’s setup could not be loaded. Refresh checks to try again.");
  const plan = data.purchaseIntent;
  const statusNames = { passed: "Passed", attention: "Needs attention", unknown: "Not verified here" };
  const focused = document.activeElement?.closest("[data-store-setup-help]")?.dataset.storeSetupHelp;
  const helpOpen = $("#storeSetupHelp")?.hidden === false;
  const stores = plan
    ? [...new Set((plan.targets || []).filter(target => target.enabled).map(target => target.retailerId))].filter(isGuardedStore)
    : data.stores.map(item => item.retailerId);
  $("#storeSetupContent").innerHTML = `
    <div class="store-setup-stores" aria-label="Store setup selection">${stores.map(id => `<button class="button quiet" data-store-setup="${escapeHtml(id)}" data-setup-plan="${escapeHtml(plan?.id || "")}" aria-pressed="${id === store.retailerId}" type="button">${escapeHtml(retailerDisplayName(id))}</button>`).join("")}</div>
    <p><strong>${escapeHtml(store.summary)}</strong></p>
    ${store.qualificationNotice && store.qualificationNotice !== store.summary ? `<p class="boundary-note">${escapeHtml(store.qualificationNotice)}</p>` : ""}
    <p class="field-help">Checked ${escapeHtml(new Date(data.plan.createdAt).toLocaleTimeString())}. Alerts work at every store. Cart adds need this store turned on and Auto-cart on.</p>
    ${plan ? `<div class="boundary-note"><strong>${escapeHtml(plan.title)} · ${escapeHtml(planStatusLabel(plan.status))}</strong><p>${escapeHtml(plan.automationReadiness?.headline || "Readiness unavailable")}</p><small>Store setup does not change this plan’s status or limits. Return to the plan to recheck it.</small></div>` : ""}
    <div class="store-setup-next"><strong>Next · ${escapeHtml(store.nextOwner)}</strong>${storeSetupActionMarkup(store, store.nextAction, { primary: true })}</div>
    <ol class="store-setup-checks">${store.steps.map(step => `<li data-setup-step="${escapeHtml(step.id)}"><div><strong>${escapeHtml(step.label)}</strong><span class="tag ${step.state === "passed" ? "good" : "warn"}">${escapeHtml(statusNames[step.state] || "Not verified here")}</span></div><small>${escapeHtml(step.owner)}</small><p>${escapeHtml(step.detail)}</p>${step.action && step.action !== store.nextAction ? storeSetupActionMarkup(store, step.action) : ""}</li>`).join("")}</ol>
    <section id="storeSetupHelp" class="boundary-note" tabindex="-1" ${helpOpen ? "" : "hidden"}>
      <h3>Finish in your paired Chrome browser</h3>
      <ol><li>Open Chrome’s Extensions menu, choose Yoink, then open its Settings.</li><li>Under Store access, allow ${escapeHtml(store.retailerName)}. Complete any store sign-in or security check yourself.</li><li>Under Store checks, choose Check again for ${escapeHtml(store.retailerName)}. This runs without adding anything.</li><li>Return here and choose Refresh checks.</li></ol>
      ${store.candidateNote ? `<p>${escapeHtml(store.candidateNote)}</p>` : ""}
      ${store.candidate ? retailerLinkMarkup(store.candidate.canonicalUrl, `${store.retailerName} setup candidate`, `Open check product: ${store.candidate.title || store.retailerName} ↗`) : ""}
      <h3>Administrator handoff</h3><p>Ask your administrator to review ${escapeHtml(store.retailerName)} in the store checks page for your account. They must review the current evidence and explicitly activate this store${plan ? ` for the setup used by “${escapeHtml(plan.title)}”` : ""}. Execution mode may also need review. No request has been sent.</p>
    </section>
    <p class="field-help">Each Add verifies the exact SKU, first-party seller, saved Shipping or Pickup, price and quantity, then confirms the cart change. Checkout remains manual.</p>`;
  $("#returnStoreSetupPlan").hidden = !plan;
  if (focused) [...$$("#storeSetupContent [data-store-setup-help]")].find(button => button.dataset.storeSetupHelp === focused)?.focus();
}

async function loadStoreSetup() {
  const setup = state.storeSetup;
  if (!setup) return;
  const sequence = ++state.storeSetupSequence;
  state.storeSetupLoading = true;
  $("#storeSetupTitle").textContent = `${retailerDisplayName(setup.retailerId)} setup`;
  $("#returnStoreSetupPlan").hidden = true;
  $("#refreshStoreSetup").disabled = true;
  $("#refreshStoreSetup").textContent = "Refreshing…";
  $("#storeSetupContent").setAttribute("aria-busy", "true");
  $("#storeSetupError")?.remove();
  if (!state.storeSetupData) $("#storeSetupContent").innerHTML = '<p role="status">Loading store checks…</p>';
  if (!$("#storeSetupDialog").open) $("#storeSetupDialog").showModal();
  try {
    const [data, routing] = await Promise.all([
      api(`/api/v1/user/readiness${setup.planId ? `?planId=${encodeURIComponent(setup.planId)}` : ""}`),
      state.affiliateRouting ? Promise.resolve(null) : api("/api/v1/affiliate-routing").catch(() => null)
    ]);
    if (sequence !== state.storeSetupSequence || state.storeSetup !== setup) return;
    state.affiliateRouting = routing?.affiliateRouting || state.affiliateRouting;
    state.storeSetupData = data;
    state.storeSetups = data.stores || [];
    renderStoreSetup();
    if (activeUserRoute() === "setup") renderStoreSwitches();
  } catch (error) {
    if (sequence !== state.storeSetupSequence || state.storeSetup !== setup) return;
    if (!state.storeSetupData) $("#storeSetupContent").replaceChildren();
    const message = document.createElement("p");
    message.id = "storeSetupError";
    message.className = "boundary-note";
    message.setAttribute("role", "alert");
    message.textContent = `${state.storeSetupData ? "These checks may be out of date. " : ""}${error.message || "Store checks could not load."} Use Refresh checks to retry, or close setup.`;
    $("#storeSetupContent").prepend(message);
  } finally {
    if (sequence === state.storeSetupSequence) {
      state.storeSetupLoading = false;
      $("#storeSetupContent").removeAttribute("aria-busy");
      $("#refreshStoreSetup").disabled = false;
      $("#refreshStoreSetup").textContent = "Refresh checks";
    }
  }
}

$("#storeSetupDialog").addEventListener("cancel", event => {
  event.preventDefault();
  closeStoreSetup();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.storeSetup && !state.storeSetupLoading) void loadStoreSetup();
});
