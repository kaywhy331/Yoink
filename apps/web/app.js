const state = {
  snapshot: null,
  view: "overview",
  editingStrategyId: "",
  editingMission: null,
  settingsDirty: false,
  editingAttributionRetailerId: "",
  affiliateRouting: null,
  howlStoreQuery: "",
  howlStoreExpanded: false,
  identityDirty: false,
  observerRecipeDirty: false,
  editingOperatorAlertRuleId: "",
  editingOperatorAlertConnectorId: "",
  operationalTelemetry: null,
  adminAnalytics: null,
  adminAnalyticsWindow: "7d",
  backgroundWork: null,
  adminChanges: null,
  pairing: null,
  libraryItems: [],
  libraryTotal: 0,
  libraryQuery: "",
  missionItems: [],
  missionTotal: 0,
  missionQuery: "",
  auditItems: [],
  auditTotal: 0,
  auditQuery: "",
  auditFilterSignature: "",
  auditSince: "",
  signalItems: [],
  signalTotal: 0,
  signalQuery: "",
  jobItems: [],
  jobTotal: 0,
  jobQuery: "",
  notificationItems: [],
  notificationTotal: 0,
  notificationQuery: "",
  attributionReceiptItems: [],
  attributionReceiptTotal: 0,
  attributionReceiptQuery: "",
  authorizationUsers: [],
  authorizationRoles: [],
  adminUserQuery: "",
  selectedAdminUser: null,
  adminUserTab: "plans",
  adminUserPairing: null,
  pendingAdminDetail: null,
  adminDetailPushed: { adminUserDialog: null, dropWindowDialog: null },
  signalChannels: [],
  dropWindows: [],
  dropWindowTimezone: "",
  dropWindowDraftProducts: [],
  dropWindowSearchResults: [],
  dropWindowSearchRequestId: 0,
  editingDropWindow: null,
  restockPatterns: [],
  restockPatternProduct: null,
  restockPatternSearchResults: [],
  restockPatternSearchRequestId: 0,
  laneReadiness: [],
  loadedViews: new Set(),
  viewLoadPromise: null,
  connectionsView: "integrations",
  qualificationRetailer: "target",
  listingLinkPreview: null,
  listingLinkPreviewInput: "",
  communityView: "sharing",
  adminSettingsView: "guardrails",
  operationsView: "health",
  alertsView: "incidents",
  overviewWindow: "hours24",
  snapshotRequestId: 0
};
const COLLECTION_PAGE_SIZE = 50;
// Background polls reload every row already on screen. Each cap matches the API clamp for that
// collection so a preserved page can never be silently truncated by the server.
const COLLECTION_POLL_LIMIT = 500;
const COLLECTION_POLL_LIMITS = Object.freeze({ library: 200 });
const loadedCollectionLimit = (items, maximum = COLLECTION_POLL_LIMIT) => Math.max(
  COLLECTION_PAGE_SIZE,
  Math.min(maximum, Array.isArray(items) ? items.length : 0)
);
const TRACKALACKER_SETUP_INSTRUCTIONS = "Connect TrackaLacker to Yoink:\n1. Stay signed in to TrackaLacker in Chrome.\n2. Open the Yoink extension popup.\n3. Choose Reconnect.\n4. Allow TrackaLacker page access when Chrome asks.";
const NON_SENSITIVE_NOTE_HELP = "Do not include page text, account data, product IDs, tokens, payment details, or personal information.";
const ADMIN_NAV_GROUPS = Object.freeze({
  overview: [{ view: "overview", label: "Overview" }],
  inbox: [
    { view: "approvals", label: "Approvals" },
    { view: "catalog-reviews", label: "Catalog reviews" },
    { view: "alerts", label: "Incidents" }
  ],
  stores: [{ view: "stores", label: "Stores" }],
  sources: [{ view: "sources", label: "Sources" }],
  catalog: [{ view: "library", label: "Catalog" }],
  plans: [{ view: "missions", label: "Plans" }, { view: "strategies", label: "Rules" }],
  activity: [
    { view: "actions", label: "Actions" },
    { view: "notifications", label: "Notifications" },
    { view: "attribution", label: "Affiliate routes" },
    { view: "signals", label: "Calls" },
    { view: "analytics", label: "Analytics" },
    { view: "activity", label: "Activity" }
  ],
  settings: [
    { view: "settings", label: "Settings" },
    { view: "access", label: "Users" },
    { view: "operations", label: "Operations" }
  ],
  maintainer: [{ view: "community", label: "Maintainer" }]
});
const ADMIN_GROUP_FOR_VIEW = Object.freeze(Object.fromEntries(
  Object.entries(ADMIN_NAV_GROUPS).flatMap(([group, items]) => items.map((item) => [item.view, group]))
));
// Page titles by view; navigation buttons say "Open {title}" so the label always names the destination.
const ADMIN_VIEW_TITLES = Object.freeze(Object.fromEntries(
  Object.values(ADMIN_NAV_GROUPS).flat().map((item) => [item.view, item.label])
));
const adminViewTitle = (view) => ADMIN_VIEW_TITLES[view] || "Overview";
const ADMIN_PHYSICAL_VIEW = Object.freeze({ sources: "connections", stores: "connections" });
const physicalAdminView = (view) => ADMIN_PHYSICAL_VIEW[view] || view;
const snapshotAdminView = (view) => physicalAdminView(view);
function adminPermissionState() {
  const direct = state.snapshot?.permissions;
  const nested = state.snapshot?.authorization?.permissions;
  const values = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : null;
  return { known: values !== null, values: new Set(values || []) };
}

function syncMaintainerAccess() {
  const permissions = adminPermissionState();
  const capable = permissions.known && permissions.values.has("admin.maintainer");
  const nav = $('[data-admin-group="maintainer"]');
  nav.hidden = !capable;
  $$('[data-maintainer-permission]').forEach((button) => {
    const alternatives = String(button.dataset.maintainerPermission || "").split(/\s+/).filter(Boolean);
    button.hidden = !capable || !alternatives.some((permission) => permissions.values.has(permission));
  });
  if (state.view === "community") {
    const selected = $(`[data-community-view="${state.communityView}"]`);
    if (selected?.hidden) {
      state.communityView = $$('[data-community-view]').find((button) => !button.hidden)?.dataset.communityView || "sharing";
      setCommunityView(state.communityView, { historyMode: "replace" });
    }
  }
  return capable;
}
const RETAILER_NAMES = Object.freeze({
  target: "Target", walmart: "Walmart", amazon: "Amazon", bestbuy: "Best Buy",
  disney: "Disney Store", ravensburger: "Ravensburger", riot: "Riot Games Merch",
  booksamillion: "Books-A-Million", fanatics: "Fanatics", kohls: "Kohl's", macys: "Macy's",
  pbandai: "Premium Bandai", pokemoncenter: "Pokémon Center"
});
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const requestConfirmation = (options) => {
  if (typeof globalThis.YoinkDialogs?.confirmDialog !== "function") {
    throw new Error("The confirmation dialog is unavailable.");
  }
  return globalThis.YoinkDialogs.confirmDialog(options);
};

function retailerName(value) {
  const id = String(value || "");
  return RETAILER_NAMES[id] || `${id.slice(0, 1).toUpperCase()}${id.slice(1)}` || "Unknown store";
}

function plainLabel(value) {
  const label = String(value || "").replaceAll("_", " ").trim();
  return label ? `${label.slice(0, 1).toUpperCase()}${label.slice(1)}` : "Unknown";
}

function observerFieldName(value) {
  return ({
    availability: "Availability",
    unitPrice: "Unit price",
    seller: "Seller",
    fulfillment: "Fulfillment",
    addControl: "Add control"
  })[String(value || "")] || String(value || "Unknown field");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;"
  })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reference = String(payload.correlationId || "");
    const error = new Error(`${payload.message || `Yoink request failed with HTTP ${response.status}.`}${reference ? ` Reference ${reference}.` : ""}`);
    error.reference = reference;
    error.code = String(payload.error || "request_failed");
    error.status = response.status;
    throw error;
  }
  return payload;
}

let statusFallbackReported = false;
function reportStatusFallback() {
  if (statusFallbackReported) return;
  statusFallbackReported = true;
  console.error("Yoink status script did not load; using the inline status fallback.");
}
const statusUi = globalThis.YoinkStatus || {
  currentTrigger: (element) => {
    reportStatusFallback();
    return element || document.activeElement || document.querySelector("main");
  },
  setInlineStatus: (element, options) => {
    reportStatusFallback();
    const status = document.createElement("div");
    status.className = `inline-status ${options.state || "info"}`;
    status.textContent = options.message || "";
    (element || document.querySelector("main") || document.body).insertAdjacentElement?.("afterend", status);
    return status;
  },
  pushToast: (root, options) => {
    reportStatusFallback();
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

function protectedChangePending(result) {
  if (result?.disposition !== "pending_approval") return false;
  setView("approvals");
  toast("Protected change requested. A different authorized person must approve it before you repeat this action.");
  return true;
}

function formatMoney(cents, currency = "USD") {
  if (cents === null || cents === undefined || cents === "" || !Number.isFinite(Number(cents))) return "Not set";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(cents) / 100);
}

function relativeTime(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Unknown time";
  const seconds = Math.round((time - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

const SOURCE_KIND_LABELS = Object.freeze({
  trackalacker: "TrackaLacker",
  browser: "Chrome companion",
  discord: "Discord",
  api: "API",
  drop_window: "Drop windows",
  user_link: "Added by link",
  manual: "Manual"
});
const SOURCE_TRUST_LABELS = Object.freeze({
  trusted_exact: "Trusted source",
  informational: "Informational"
});
const SOURCE_STATUS_LABELS = Object.freeze({
  connected: "Connected",
  disconnected: "Not connected",
  pending: "Pending",
  paused: "Paused",
  error: "Needs attention"
});
const sourceKindLabel = (value) => SOURCE_KIND_LABELS[value] || plainLabel(value);
const sourceTrustLabel = (value) => SOURCE_TRUST_LABELS[value] || plainLabel(value);
const sourceStatusLabel = (value) => SOURCE_STATUS_LABELS[value] || plainLabel(value);

function statusDot(kind = "good", label = "") {
  const stateLabel = label || ({ good: "OK", warning: "Attention", bad: "Error" }[kind] || "Status");
  return `<span class="status-dot ${kind}" role="img" aria-label="${escapeHtml(stateLabel)}"></span>`;
}
function empty(message) { return `<div class="empty">${escapeHtml(message)}</div>`; }

const ADMIN_ROUTE_ALIASES = Object.freeze({
  inbox: "approvals",
  catalog: "library",
  plans: "missions",
  maintainer: "community/sharing",
  preferences: "settings/guardrails",
  health: "operations/health",
  diagnostics: "stores/diagnostics/target",
  connections: "sources/channels",
  users: "access",
  "drop-windows": "sources/drops"
});

function currentAdminHashRoute(view = state.view) {
  if (view === "sources") return `sources/${state.connectionsView === "drops" ? "drops" : "channels"}`;
  if (view === "stores") return `stores/${state.connectionsView === "diagnostics" ? "diagnostics" : "qualification"}/${state.qualificationRetailer}`;
  if (view === "community") return `community/${state.communityView}`;
  if (view === "settings") return `settings/${state.adminSettingsView}`;
  if (view === "operations") return `operations/${state.operationsView}`;
  if (view === "alerts") return `alerts/${state.alertsView}`;
  return view || "overview";
}

function writeAdminRoute(mode, view = state.view) {
  if (mode !== "push" && mode !== "replace") return;
  const route = currentAdminHashRoute(view);
  if (location.hash.slice(1) === route) return;
  history[`${mode}State`](null, "", `#${route}`);
}

const ADMIN_SKELETON_TARGETS = Object.freeze({
  overview: "#metricGrid",
  library: "#libraryList",
  missions: "#missionList",
  signals: "#signalList",
  actions: "#jobList",
  notifications: "#notificationList",
  attribution: "#attributionReceiptList",
  activity: "#auditList",
  analytics: "#adminAnalyticsMetrics",
  operations: "#operationalMetricGrid",
  approvals: "#adminChangeRequestList",
  sources: "#connectionList",
  stores: "#targetQualificationSummary",
  access: "#authorizationUserList"
});

function skeletonMarkup(label, count = 3) {
  return `<div class="skeleton-list" role="status" aria-label="Loading ${escapeHtml(label)}">${Array.from({ length: count }, () => '<span class="skeleton-row" aria-hidden="true"></span>').join("")}</div>`;
}

function showAdminViewSkeleton(view) {
  if (state.loadedViews.has(view)) return false;
  const selector = ADMIN_SKELETON_TARGETS[view];
  if (!selector) return false;
  const target = $(selector);
  if (!target || target.textContent.trim() || target.children.length) return false;
  target.innerHTML = skeletonMarkup(view.replaceAll("-", " "));
  return true;
}

function setView(view, { historyMode = "replace", scroll = true } = {}) {
  const permissions = adminPermissionState();
  if (view === "community" && permissions.known && !permissions.values.has("admin.maintainer")) view = "overview";
  const virtualView = Object.hasOwn(ADMIN_GROUP_FOR_VIEW, view);
  view = virtualView || $$('[data-view-panel]').some((panel) => panel.dataset.viewPanel === view) ? view : "overview";
  const snapshotView = snapshotAdminView(view);
  const changed = state.view !== view || state.snapshot?.view !== snapshotView;
  state.view = view;
  const physicalView = physicalAdminView(view);
  $$("[data-view-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === physicalView));
  const group = ADMIN_GROUP_FOR_VIEW[view] || "overview";
  $$(".nav-button").forEach((button) => {
    const active = button.dataset.adminGroup === group;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  const secondary = $("#adminSecondaryNav");
  const items = ADMIN_NAV_GROUPS[group] || [];
  secondary.hidden = items.length < 2;
  secondary.innerHTML = items.map((item) => `<button class="secondary-nav-button${item.view === view ? " active" : ""}" data-view="${escapeHtml(item.view)}" type="button" ${item.view === view ? 'aria-current="page"' : ""}>${escapeHtml(item.label)}</button>`).join("");
  if (view === "sources") {
    setConnectionsView(["integrations", "drops"].includes(state.connectionsView) ? state.connectionsView : "integrations", { historyMode: "none" });
  }
  if (view === "stores") {
    setConnectionsView(["readiness", "diagnostics"].includes(state.connectionsView) ? state.connectionsView : "readiness", { historyMode: "none" });
  }
  if (view === "community") setCommunityView(state.communityView, { historyMode: "none" });
  if (view === "settings") setAdminSettingsView(state.adminSettingsView, { historyMode: "none" });
  if (view === "operations") setOperationsView(state.operationsView, { historyMode: "none" });
  if (view === "alerts") setAlertsView(state.alertsView, { historyMode: "none" });
  writeAdminRoute(historyMode, view);
  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  if (state.snapshot && changed) {
    showAdminViewSkeleton(view);
    state.viewLoadPromise = refresh(true).catch((error) => toast(error.message || "That admin view could not load.", true));
  }
  scheduleAdminPoll();
}

function setConnectionsView(name, { historyMode = "replace" } = {}) {
  const sourceSurface = state.view === "sources";
  const allowed = new Set(sourceSurface ? ["integrations", "drops"] : ["readiness", "diagnostics"]);
  state.connectionsView = allowed.has(name) ? name : sourceSurface ? "integrations" : "readiness";
  const heading = sourceSurface
    ? { eyebrow: "Inbound product calls", title: "Sources", nav: "Source sections" }
    : { eyebrow: "Qualified store actions", title: "Stores", nav: "Store sections" };
  $("#connectionsEyebrow").textContent = heading.eyebrow;
  $("#connectionsTitle").textContent = heading.title;
  $("#connectionsSectionNav").setAttribute("aria-label", heading.nav);
  $$('[data-connections-view]').forEach((button) => {
    button.hidden = button.dataset.connectionsSurface !== state.view;
    const active = button.dataset.connectionsView === state.connectionsView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-connections-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.connectionsPanel !== state.connectionsView;
  });
  $("#qualificationStoreNav").hidden = state.view !== "stores";
  if (state.connectionsView === "readiness") setQualificationRetailer(state.qualificationRetailer, { historyMode: "none" });
  if (["sources", "stores"].includes(state.view)) writeAdminRoute(historyMode);
}

function setQualificationRetailer(retailerId, { historyMode = "replace" } = {}) {
  const allowed = new Set(["target", "walmart", "amazon", "bestbuy"]);
  state.qualificationRetailer = allowed.has(retailerId) ? retailerId : "target";
  $$('[data-qualification-retailer]').forEach((button) => {
    const active = button.dataset.qualificationRetailer === state.qualificationRetailer;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-qualification-panel]').forEach((panel) => {
    panel.hidden = state.view !== "stores" || state.connectionsView !== "readiness"
      || panel.dataset.qualificationPanel !== state.qualificationRetailer;
  });
  if (state.view === "stores" && state.connectionsView === "readiness") writeAdminRoute(historyMode);
}

function setCommunityView(name, { historyMode = "replace" } = {}) {
  const allowed = new Set(["sharing", "identity", "inventory", "observers", "contributions", "catalog", "data"]);
  state.communityView = allowed.has(name) ? name : "sharing";
  const requestedButton = $(`[data-community-view="${state.communityView}"]`);
  if (requestedButton?.hidden) {
    state.communityView = $$('[data-community-view]').find((button) => !button.hidden)?.dataset.communityView || "sharing";
  }
  $$('[data-community-view]').forEach((button) => {
    const active = button.dataset.communityView === state.communityView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-community-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.communityPanel !== state.communityView;
  });
  if (state.view === "community") writeAdminRoute(historyMode);
}

function setAdminSettingsView(name, { historyMode = "replace" } = {}) {
  const allowed = new Set(["guardrails", "affiliate", "directory"]);
  state.adminSettingsView = allowed.has(name) ? name : "guardrails";
  $$('[data-admin-settings-view]').forEach((button) => {
    const active = button.dataset.adminSettingsView === state.adminSettingsView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-admin-settings-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.adminSettingsPanel !== state.adminSettingsView;
  });
  if (state.view === "settings") writeAdminRoute(historyMode);
}

function setOperationsView(name, { historyMode = "replace" } = {}) {
  const allowed = new Set(["health", "workers", "tools"]);
  state.operationsView = allowed.has(name) ? name : "health";
  $$('[data-operations-view]').forEach((button) => {
    const active = button.dataset.operationsView === state.operationsView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-operations-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.operationsPanel !== state.operationsView;
  });
  if (state.view === "operations") writeAdminRoute(historyMode);
}

function setAlertsView(name, { historyMode = "replace" } = {}) {
  const allowed = new Set(["incidents", "routing", "deliveries"]);
  state.alertsView = allowed.has(name) ? name : "incidents";
  $$('[data-alerts-view]').forEach((button) => {
    const active = button.dataset.alertsView === state.alertsView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-alerts-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.alertsPanel !== state.alertsView;
  });
  $("#addOperatorAlertConnectorButton").hidden = state.alertsView !== "routing";
  $("#addOperatorAlertRuleButton").hidden = state.alertsView !== "routing";
  if (state.view === "alerts") writeAdminRoute(historyMode);
}

function applyAdminHashRoute() {
  const requested = location.hash.slice(1).replace(/^\/+|\/+$/g, "");
  let route = ADMIN_ROUTE_ALIASES[requested] || requested || "overview";
  let [requestedView, section, detail] = route.split("/");
  const validDetailId = (value) => /^[A-Za-z0-9_-]{3,120}$/.test(String(value || ""));
  const detailRoute = requestedView === "access" && section === "user" && validDetailId(detail)
    ? { kind: "user", id: detail }
    : requestedView === "sources" && section === "drops" && validDetailId(detail)
      ? { kind: "drop", id: detail }
      : null;
  state.pendingAdminDetail = detailRoute;
  if (!detailRoute) {
    // The browser already moved off the detail route (Back, a typed hash); nothing to restore.
    state.adminDetailPushed = { adminUserDialog: null, dropWindowDialog: null };
    if ($("#adminUserDialog")?.hasAttribute("open")) $("#adminUserDialog").close();
    if ($("#dropWindowDialog")?.hasAttribute("open")) $("#dropWindowDialog").close();
    state.selectedAdminUser = null;
    state.editingDropWindow = null;
  }
  if (requestedView === "connections") {
    const legacyStoreRoute = ["readiness", "diagnostics"].includes(section);
    requestedView = legacyStoreRoute ? "stores" : "sources";
    section = section === "readiness" ? "qualification" : section === "integrations" ? "channels" : section;
    detail ||= "target";
    route = [requestedView, section, detail].filter(Boolean).join("/");
  }
  if (requestedView === "operations" && section === "data") {
    requestedView = "community";
    section = "data";
  }
  const view = Object.hasOwn(ADMIN_GROUP_FOR_VIEW, requestedView)
    || $$('[data-view-panel]').some((panel) => panel.dataset.viewPanel === requestedView)
    ? requestedView
    : "overview";
  if (view === "sources") {
    state.connectionsView = section === "drops" ? "drops" : "integrations";
  } else if (view === "stores") {
    state.connectionsView = section === "diagnostics" ? "diagnostics" : "readiness";
    state.qualificationRetailer = new Set(["target", "walmart", "amazon", "bestbuy"]).has(detail)
      ? detail
      : "target";
  } else if (view === "community") {
    state.communityView = new Set(["sharing", "identity", "inventory", "observers", "contributions", "catalog", "data"]).has(section)
      ? section
      : "sharing";
  } else if (view === "settings") {
    state.adminSettingsView = new Set(["guardrails", "affiliate", "directory"]).has(section)
      ? section
      : "guardrails";
  } else if (view === "operations") {
    state.operationsView = new Set(["health", "workers", "tools"]).has(section)
      ? section
      : "health";
  } else if (view === "alerts") {
    state.alertsView = new Set(["incidents", "routing", "deliveries"]).has(section)
      ? section
      : "incidents";
  }
  setView(view, { historyMode: "none", scroll: false });
  const canonical = detailRoute
    ? `${detailRoute.kind === "user" ? "access/user" : "sources/drops"}/${detailRoute.id}`
    : currentAdminHashRoute(state.view);
  if (requested !== canonical) history.replaceState(null, "", `#${canonical}`);
}

function deriveAdminOverview(snapshot) {
  const settings = snapshot?.settings || {};
  const capabilities = snapshot?.capabilities || {};
  const counts = snapshot?.counts || {};
  const trackalacker = snapshot?.trackalacker || {};
  const stores = [
    { id: "target", name: "Target", qualified: capabilities.targetAddQualified === true, active: capabilities.targetAddMutationAuthorized === true },
    { id: "walmart", name: "Walmart", qualified: capabilities.walmartAddQualified === true, active: capabilities.walmartAddMutationAuthorized === true },
    { id: "amazon", name: "Amazon", qualified: capabilities.amazonAddQualified === true, active: capabilities.amazonAddMutationAuthorized === true },
    { id: "bestbuy", name: "Best Buy", qualified: capabilities.bestBuyAddQualified === true, active: capabilities.bestBuyAddMutationAuthorized === true }
  ];
  const activeStores = stores.filter((store) => store.active);
  const qualifiedStores = stores.filter((store) => store.qualified);
  // A qualified-but-inactive store is the one to finish; the setup link opens its qualification page.
  const storeToFinish = qualifiedStores.find((store) => !store.active) || null;
  const purchaseRules = (snapshot?.strategies || []).filter((strategy) => strategy.enabled && strategy.action !== "notify");
  const checks = [
    {
      label: "Chrome companion",
      done: Number(counts.onlineDevices || 0) > 0,
      detail: Number(counts.onlineDevices || 0) > 0 ? "Paired and online" : "Pair one Chrome companion",
      view: "sources"
    },
    {
      label: "TrackaLacker calls",
      done: trackalacker.ready === true,
      detail: trackalacker.ready === true ? "Connected and receiving push" : "Reconnect from the extension",
      view: "sources"
    },
    {
      label: "Followed products",
      done: Number(trackalacker.mappedProducts || 0) > 0,
      detail: Number(trackalacker.mappedProducts || 0) > 0
        ? `${Number(trackalacker.mappedProducts).toLocaleString()} products mapped`
        : "Sync the followed-product library",
      view: "library"
    },
    {
      label: "Purchase rule",
      done: purchaseRules.length > 0,
      detail: purchaseRules.length
        ? `${purchaseRules.length} guarded purchase rule${purchaseRules.length === 1 ? "" : "s"} enabled`
        : "Enable one bounded purchase rule",
      view: "strategies"
    },
    {
      label: "Store action lane",
      done: activeStores.length > 0,
      detail: activeStores.length
        ? `${activeStores.map((store) => store.name).join(", ")} ready for guarded adds`
        : qualifiedStores.length
          ? `${qualifiedStores.length} store lane${qualifiedStores.length === 1 ? " is" : "s are"} qualified; activate when ready`
          : "Qualify and activate one store lane",
      view: "stores",
      route: storeToFinish ? `stores/qualification/${storeToFinish.id}` : ""
    }
  ];
  const firstIncomplete = checks.find((check) => !check.done) || null;
  const configured = firstIncomplete === null;
  const signalsReady = checks[0].done && checks[1].done;
  const paused = settings.actionsPaused === true;
  const status = !signalsReady ? "attention" : paused ? "paused" : configured ? "ready" : "monitoring";
  const statusLabel = status === "attention" ? "Needs attention"
    : status === "paused" ? "Paused" : status === "ready" ? "Ready" : "Monitoring";
  const headline = status === "attention"
    ? firstIncomplete?.label === "Chrome companion" ? "Pair Chrome to receive store actions." : "Reconnect the source."
    : status === "paused" ? "Store actions are paused."
      : status === "ready" ? "Yoink is ready for guarded adds."
        : "Calls are live; action setup is next.";
  const summary = status === "attention"
    ? firstIncomplete?.detail || "Finish the next setup step."
    : status === "paused" ? "Calls and notifications continue while guarded store actions wait."
      : status === "ready" ? `${activeStores.map((store) => store.name).join(", ")} can add one item.`
        : `${firstIncomplete?.label || "Action setup"}: ${firstIncomplete?.detail || "review required"}.`;
  return {
    status,
    statusLabel,
    headline,
    summary,
    configured,
    firstIncomplete,
    checks,
    activeStores,
    qualifiedStores,
    rows: [
      { label: "Calls", value: trackalacker.ready === true ? "Live" : "Reconnect", good: trackalacker.ready === true },
      { label: "Chrome", value: Number(counts.onlineDevices || 0) ? `${Number(counts.onlineDevices).toLocaleString()} online` : "Not paired", good: Number(counts.onlineDevices || 0) > 0 },
      {
        label: "Store actions",
        value: activeStores.length ? `${activeStores.length} active${paused ? " · paused" : ""}`
          : qualifiedStores.length ? `${qualifiedStores.length} qualified` : "Setup needed",
        good: activeStores.length > 0 && !paused
      }
    ],
    metrics: snapshot?.overview?.windows || {}
  };
}

function renderAdminAccount() {
  const actor = state.snapshot?.actor || {};
  const displayName = String(actor.displayName || "Signed-in user");
  const roles = Array.isArray(actor.roleLabels) ? actor.roleLabels.filter(Boolean) : [];
  $("#adminAccountAvatar").textContent = displayName.trim().slice(0, 1).toUpperCase() || "Y";
  $("#adminAccountName").textContent = displayName;
  $("#adminAccountRole").textContent = roles.join(" · ") || "Account";
  $("#adminAccountTenant").textContent = actor.tenantName || "Yoink";
  $("#adminAccountSession").textContent = actor.sessionKind === "local" ? "Local session" : "Hosted session";
  const signOut = $("#adminSignOutLink");
  signOut.hidden = !actor.signOutUrl;
  if (actor.signOutUrl) signOut.href = actor.signOutUrl;
}

function renderStatus() {
  const { settings, capabilities } = state.snapshot;
  syncMaintainerAccess();
  renderAdminAccount();
  const inboxCount = Number(state.snapshot.counts?.pendingCatalogProposals || 0)
    + Number(state.snapshot.counts?.pendingAdminChanges || 0)
    + Number(state.snapshot.counts?.openIncidents || 0);
  const inboxBadge = $("#inboxNavBadge");
  inboxBadge.hidden = inboxCount === 0;
  inboxBadge.textContent = inboxCount > 99 ? "99+" : String(inboxCount);
  inboxBadge.setAttribute("aria-label", `${inboxCount} inbox item${inboxCount === 1 ? "" : "s"}`);
  const toggle = $("#actionsToggle");
  toggle.textContent = settings.actionsPaused ? "Resume actions" : "Pause actions";
  toggle.classList.toggle("enabled", !settings.actionsPaused);
  const targetQualified = capabilities.targetAddQualified === true;
  const walmartQualified = capabilities.walmartAddQualified === true;
  const amazonQualified = capabilities.amazonAddQualified === true;
  const bestBuyQualified = capabilities.bestBuyAddQualified === true;
  const targetActive = capabilities.targetAddMutationAuthorized === true;
  const walmartActive = capabilities.walmartAddMutationAuthorized === true;
  const amazonActive = capabilities.amazonAddMutationAuthorized === true;
  const bestBuyActive = capabilities.bestBuyAddMutationAuthorized === true;
  toggle.disabled = settings.actionsPaused && !targetQualified && !walmartQualified && !amazonQualified && !bestBuyQualified;
  const toggleReason = $("#actionsToggleReason");
  toggleReason.hidden = !toggle.disabled;
  toggleReason.textContent = toggle.disabled ? "Set up a store before resuming actions." : "";
  toggle.title = toggle.disabled ? toggleReason.textContent : "Pause or resume store actions.";
  const modeChip = $("#modeChip");
  const actionState = settings.actionsPaused ? "Paused" : "Running";
  modeChip.textContent = actionState;
  modeChip.dataset.mobileLabel = actionState;
  modeChip.dataset.mobileState = settings.actionsPaused ? "paused" : settings.executionMode;
  modeChip.setAttribute("aria-label", `Store actions ${actionState.toLocaleLowerCase("en-US")}; ${settings.executionMode} mode`);
  if (state.view === "overview") {
    const model = deriveAdminOverview(state.snapshot);
    $("#overviewHeadline").textContent = model.headline;
    $("#overviewSummary").textContent = model.summary;
    $("#heroStatus").innerHTML = `<div class="hero-status-head"><span class="mode-chip ${model.status === "attention" ? "danger" : ""}">${escapeHtml(model.statusLabel)}</span><button class="text-button" data-open-view="${escapeHtml(model.firstIncomplete?.view || "stores")}" type="button">Open ${escapeHtml(adminViewTitle(model.firstIncomplete?.view || "stores"))}</button></div>${model.rows.map((row) => `<div class="hero-status-row"><span>${statusDot(row.good ? "good" : "warning", row.good ? "OK" : "Attention")} ${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`).join("")}`;
  }
  if (["sources", "stores"].includes(state.view)) {
    const executorKind = targetActive || walmartActive || amazonActive || bestBuyActive ? "good" : "warning";
    const targetState = targetActive ? "Target active" : targetQualified ? "Target qualified · paused" : "Target closed";
    const walmartState = walmartActive ? "Walmart active" : walmartQualified ? "Walmart qualified · paused" : "Walmart closed";
    const amazonState = amazonActive ? "Amazon active" : amazonQualified ? "Amazon qualified · paused" : "Amazon closed";
    const bestBuyState = bestBuyActive ? "Best Buy active" : bestBuyQualified ? "Best Buy qualified · paused" : "Best Buy closed";
    $("#targetExecutorStatus").innerHTML = `<span class="status-dot ${executorKind}"></span><strong>${targetState} · ${walmartState} · ${amazonState} · ${bestBuyState}</strong>`;
  }
}

function renderMetrics() {
  const model = deriveAdminOverview(state.snapshot);
  const windowKey = state.overviewWindow === "days7" ? "days7" : "hours24";
  const windowLabel = windowKey === "days7" ? "7 days" : "24 hours";
  const counts = model.metrics[windowKey] || {};
  const metrics = [
    ["Calls", counts.signalsReceived],
    ["Jobs created", counts.jobsCreated],
    ["Carted", counts.carted],
    ["Got it", counts.gotIt],
    ["Missed", counts.missed],
    ["Dead letters", counts.deadLetters]
  ];
  $("#metricGrid").setAttribute("aria-label", `Activity in the last ${windowLabel}`);
  $("#metricGrid").innerHTML = metrics.map(([label, value]) => `<article class="metric" data-metric="${escapeHtml(String(label).toLowerCase().replaceAll(" ", "-"))}"><span>${escapeHtml(label)}</span><strong>${Number(value || 0).toLocaleString()}</strong><small>Last ${escapeHtml(windowLabel)}</small></article>`).join("");
  $("#overviewAttributionStrip").setAttribute("aria-label", `Attribution in the last ${windowLabel}`);
  $("#overviewAttributionStrip").innerHTML = `<span>Affiliate path</span><strong>${Number(counts.routesIssued || 0).toLocaleString()} routes</strong><i aria-hidden="true">→</i><strong>${Number(counts.clicks || 0).toLocaleString()} clicks</strong><i aria-hidden="true">→</i><strong>${Number(counts.conversions || 0).toLocaleString()} conversions</strong><button class="text-button" data-open-view="analytics" type="button">View analytics</button>`;
  $$('[data-overview-window]').forEach((button) => {
    const active = button.dataset.overviewWindow === windowKey;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderReadinessGuide() {
  const model = deriveAdminOverview(state.snapshot);
  const panel = $("#readinessPanel");
  panel.hidden = model.configured;
  if (model.configured) {
    $("#readinessGuide").innerHTML = "";
    return;
  }
  const next = model.firstIncomplete;
  const step = Math.max(1, model.checks.findIndex((check) => !check.done) + 1);
  $("#readinessGate").textContent = `Step ${step} of ${model.checks.length}`;
  $("#readinessSummary").textContent = next.detail;
  const target = next.route
    ? `data-open-route="${escapeHtml(next.route)}"`
    : `data-open-view="${escapeHtml(next.view)}"`;
  $("#readinessGuide").innerHTML = `<article class="readiness-step">
    <span class="readiness-mark" aria-hidden="true">○</span><div><h3>${escapeHtml(next.label)}</h3><p>${escapeHtml(next.detail)}</p></div><button class="text-button" ${target} type="button">Open ${escapeHtml(adminViewTitle(next.view))}</button>
  </article>`;
}

function renderAdminAnalytics() {
  const analytics = state.adminAnalytics;
  if (!analytics) {
    $("#adminAnalyticsMetrics").innerHTML = empty("Analytics are loading.");
    $("#adminAnalyticsFunnel").innerHTML = "";
    $("#adminAnalyticsAttribution").innerHTML = "";
    $("#adminAnalyticsStores").innerHTML = "";
    $("#adminAnalyticsLatency").innerHTML = "";
    $("#adminAnalyticsLatencySample").textContent = "";
    $("#adminAnalyticsDays").innerHTML = "";
    return;
  }
  const totals = analytics.totals || {};
  const overCap = analytics.overCap || {};
  const metricRows = [
    ["Calls", totals.signals, "Received"],
    ["Carted", totals.carted, "Cart verified"],
    ["Got it", totals.gotIt, "User confirmed"],
    ["Clicks", totals.clicks, "Store links opened"],
    ["Conversions", totals.conversions, "Affiliate click → Got it"],
    ["Over cap", overCap.count, `${formatMoney(overCap.amountCents || 0)} above reviewed maximum`]
  ];
  $("#adminAnalyticsMetrics").innerHTML = metricRows.map(([label, value, note]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${Number(value || 0).toLocaleString()}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  $("#adminAnalyticsFunnel").innerHTML = [
    ["Calls", totals.signals], ["Matched", totals.matched], ["Jobs", totals.jobs],
    ["Carted", totals.carted], ["Got it", totals.gotIt], ["Missed", totals.missed]
  ].map(([label, value], index, rows) => `<div class="analytics-funnel-row"><span>${index + 1}. ${escapeHtml(label)}</span><strong>${Number(value || 0).toLocaleString()}</strong>${index < rows.length - 1 ? '<i aria-hidden="true">↓</i>' : ""}</div>`).join("");
  $("#adminAnalyticsAttribution").innerHTML = [
    ["Routes issued", totals.routesIssued],
    ["Affiliate routes", totals.affiliateRoutesIssued],
    ["Store-link clicks", totals.clicks],
    ["Affiliate clicks", totals.affiliateClicks],
    ["Conversions", totals.conversions]
  ].map(([label, value]) => `<div class="status-row"><span>${escapeHtml(label)}</span><strong>${Number(value || 0).toLocaleString()}</strong></div>`).join("");
  $("#adminAnalyticsStores").innerHTML = (analytics.stores || []).map((store) => `<tr><th scope="row">${escapeHtml(retailerName(store.retailerId))}</th><td>${Number(store.signals || 0).toLocaleString()}</td><td>${Number(store.matched || 0).toLocaleString()}</td><td>${Number(store.jobs || 0).toLocaleString()}</td><td>${Number(store.carted || 0).toLocaleString()}</td><td>${Number(store.gotIt || 0).toLocaleString()}</td><td>${Number(store.missed || 0).toLocaleString()}</td><td>${Number(store.routesIssued || 0).toLocaleString()}</td><td>${Number(store.clicks || 0).toLocaleString()}</td><td>${Number(store.conversions || 0).toLocaleString()}</td></tr>`).join("") || '<tr><td colspan="10">No activity in this window.</td></tr>';
  const latencyLabels = {
    observedToReceivedMs: "Source observed → received",
    receivedToJobMs: "Received → job",
    jobToLeaseMs: "Job → Chrome",
    leaseToBaselineMs: "Chrome → baseline",
    baselineToOfferMs: "Baseline → offer",
    offerToClickMs: "Offer → authorized click",
    clickToSettleMs: "Click → page settled",
    settleToCartReadyMs: "Page settled → cart proof",
    leaseToCartReadyMs: "Chrome → cart ready",
    clickToCartReadyMs: "Click → cart ready"
  };
  const latency = analytics.latency || {};
  $("#adminAnalyticsLatencySample").textContent = `${Number(latency.jobsSampled || 0).toLocaleString()} job${Number(latency.jobsSampled || 0) === 1 ? "" : "s"} sampled`;
  $("#adminAnalyticsLatency").innerHTML = Object.entries(latencyLabels)
    .map(([key, label]) => [label, latency.hops?.[key]])
    .filter(([, hop]) => Number(hop?.samples || 0) > 0)
    .map(([label, hop]) => `<div class="mini-row"><span><strong>${escapeHtml(label)}</strong><small>${Number(hop.samples).toLocaleString()} sample${Number(hop.samples) === 1 ? "" : "s"}</small></span><strong>p50 ${Number(hop.p50Ms).toLocaleString()} ms · p95 ${Number(hop.p95Ms).toLocaleString()} ms</strong></div>`)
    .join("") || empty("No measured action latency in this window.");
  const days = analytics.days || [];
  const maximum = Math.max(1, ...days.map((day) => Number(day.signals || 0)));
  const daySeries = [
    ["signals", "calls"], ["carted", "carted"], ["got-it", "got it"], ["clicks", "clicks"], ["conversions", "conversions"]
  ];
  const dayValue = (day, key) => Number(day[key === "got-it" ? "gotIt" : key] || 0);
  $("#adminAnalyticsDays").innerHTML = days.map((day) => {
    const bars = daySeries.map(([key, label], index) => {
      const value = dayValue(day, key);
      const width = Math.max(index === 0 ? 2 : 0, Math.round(value * 100 / maximum));
      return `<span class="${key}" style="width:${width}%" title="${value} ${label}"></span>`;
    }).join("");
    const summary = daySeries.map(([key, label]) => `${dayValue(day, key).toLocaleString()} ${label}`).join(" · ");
    return `<div class="analytics-day"><time datetime="${escapeHtml(day.day)}">${escapeHtml(new Date(`${day.day}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</time><div class="analytics-day-bars">${bars}</div><small>${summary}</small></div>`;
  }).join("") || empty("No daily activity in this window.");
  $("#adminAnalyticsWindow").value = analytics.window;
  $("#adminAnalyticsExport").href = `/api/v1/admin/analytics.csv?window=${encodeURIComponent(analytics.window)}`;
}

function renderOverviewReviews() {
  const waiting = state.snapshot.overview?.waiting || {};
  const items = [
    { label: "Catalog reviews", count: Number(waiting.catalogProposals || 0), view: "catalog-reviews" },
    { label: "Approvals", count: Number(waiting.changeRequests || 0), view: "approvals" },
    { label: "Incidents", count: Number(waiting.incidents || 0), view: "alerts" }
  ].filter((item) => item.count > 0);
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const panel = $("#overviewReviewPanel");
  panel.hidden = total === 0;
  $("#overviewReviewCount").textContent = `${total.toLocaleString()} waiting`;
  $("#overviewReviewList").innerHTML = items.map((item) => `<div class="overview-review-row"><strong>${escapeHtml(item.label)}</strong><span>${item.count.toLocaleString()}</span><button class="text-button" data-open-view="${escapeHtml(item.view)}" type="button">Open ${escapeHtml(adminViewTitle(item.view))}</button></div>`).join("");
}

function signalMarkup(signal) {
  const decision = signal.missionDecision || signal.resolutionStatus || "recorded";
  const kind = ["qualified", "corroborated"].includes(decision) ? "good" : ["test_signal", "actions_paused", "needs_price"].includes(decision) ? "warning" : "";
  return `<article class="timeline-item">
    ${statusDot(kind || "warning", plainLabel(decision))}
    <div><h3>${escapeHtml(signal.title || signal.signalId || "Unresolved call")}</h3>
      <p>${escapeHtml(retailerName(signal.retailerId))} · ${escapeHtml(signal.retailerSku || "No exact SKU")} · ${formatMoney(signal.unitPriceCents, signal.currency || "USD")}</p>
      <span class="decision-pill">${escapeHtml(decision.replaceAll("_", " "))}</span>
      <p>${escapeHtml(signal.missionReason || signal.resolutionReason || "Recorded")}</p>
    </div><time>${escapeHtml(relativeTime(signal.observedAt))}</time>
  </article>`;
}

function renderSignals() {
  const signals = state.signalItems;
  $("#recentSignals").innerHTML = signals.length ? signals.slice(0, 4).map(signalMarkup).join("") : empty("No calls received yet. Send a dry-run call to exercise the pipeline.");
  $("#signalList").innerHTML = signals.length ? signals.map(signalMarkup).join("") : empty("No calls yet.");
  $("#signalCount").textContent = `${signals.length.toLocaleString()} of ${Number(state.signalTotal || 0).toLocaleString()} matching calls`;
  $("#signalMoreButton").hidden = signals.length >= state.signalTotal;
}

function renderSources() {
  const sources = state.snapshot.sources || [];
  const rows = sources.map((source) => `<div class="status-row"><span>${statusDot(source.status === "connected" ? "good" : "warning", sourceStatusLabel(source.status))} ${escapeHtml(source.name)}</span><small>${escapeHtml(sourceStatusLabel(source.status))}</small></div>`).join("");
  $("#sourceSummary").innerHTML = rows || empty("No sources configured.");
  $("#connectionList").innerHTML = sources.map((source) => {
    const signals = Number(source.signalCount || 0);
    const matchRate = source.matchRatePercent == null ? "No reliability sample" : `${Number(source.matchRatePercent).toFixed(Number(source.matchRatePercent) % 1 ? 1 : 0)}% product identity`;
    const nextStep = source.status === "connected" ? "Receiving calls; no setup needed."
      : source.source === "trackalacker" ? "Connect from the Yoink extension on a signed-in TrackaLacker tab."
        : source.source === "browser" ? "Pair the user’s Chrome companion below."
          : source.source === "discord" ? "Add the Discord channel ID under Source channels."
            : source.source === "api" ? "Create the endpoint and key from Operations."
              : "Review this source before relying on it.";
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(source.name)}</h3><p>${escapeHtml(sourceKindLabel(source.source))} · ${escapeHtml(sourceTrustLabel(source.trustLevel))}</p></div>${statusDot(source.status === "connected" ? "good" : "warning", sourceStatusLabel(source.status))}</div><p class="source-next-step"><strong>Next:</strong> ${escapeHtml(nextStep)}</p><div class="card-meta"><span class="tag ${source.autoCreateMissions ? "good" : ""}">${source.autoCreateMissions ? "Can create plans" : "Existing plans only"}</span><span class="tag">${signals.toLocaleString()} real calls</span><span class="tag ${signals && Number(source.matchRatePercent) === 100 ? "good" : ""}">${escapeHtml(matchRate)}</span><span class="tag">${Number(source.corroboratedSignalCount || 0).toLocaleString()} corroborated</span><span class="tag">${Number(source.unresolvedSignalCount || 0).toLocaleString()} unresolved</span><span class="tag">${escapeHtml(source.lastEventAt ? relativeTime(source.lastEventAt) : "No events")}</span></div></article>`;
  }).join("") || empty("No sources configured.");
  const options = sources.map((source) => `<option value="${escapeHtml(source.id)}" data-source="${escapeHtml(source.source)}">${escapeHtml(source.name)}</option>`).join("");
  $("#listingSourceConnection").innerHTML = options;
  $("#signalSourceConnection").innerHTML = options;
  if (!$("#strategyDialog").open) {
    $("#strategySourceOptions").innerHTML = sources.map((source) => `<label class="check-label"><input data-strategy-source type="checkbox" value="${escapeHtml(source.source)}"><span>${escapeHtml(source.name)}</span></label>`).join("");
  }
  const trackalacker = state.snapshot.trackalacker || {};
  const trackalackerReady = trackalacker.ready === true;
  $("#trackalackerGate").textContent = trackalackerReady ? "OK" : trackalacker.state === "error" ? "Attention" : "Off";
  $("#trackalackerConnectionStatus").innerHTML = `<span class="status-dot ${trackalackerReady ? "good" : trackalacker.state === "error" ? "bad" : "warning"}"></span><strong>${trackalackerReady ? "TrackaLacker calls live" : trackalacker.state === "error" ? "Source needs attention" : "Open the Chrome companion to connect"}</strong>`;
  const latest = trackalacker.devices?.[0];
  $("#trackalackerConnectionDetail").textContent = trackalackerReady
    ? `${Number(trackalacker.mappedProducts || 0).toLocaleString()} followed products and ${Number(trackalacker.candidateListings || 0).toLocaleString()} source listings are mapped. ${latest?.lastNotificationAt ? `Last push ${relativeTime(latest.lastNotificationAt)}.` : "Waiting for the first real push."}`
    : "Chrome registers as “Desktop - Windows - Chrome”; Yoink never stores subscription keys.";
  const syncRuns = trackalacker.syncRuns || [];
  $("#trackalackerSyncRuns").innerHTML = syncRuns.length ? syncRuns.slice(0, 5).map((run) => {
    const kind = run.phase === "complete" ? "good" : run.phase === "error" ? "bad" : "warning";
    return `<article class="sync-run"><div><strong>${statusDot(kind, plainLabel(run.phase))} Library sync · ${escapeHtml(String(run.phase).replaceAll("_", " "))}</strong><p>${Number(run.imported || 0).toLocaleString()} imported · ${Number(run.failed || 0).toLocaleString()} failed · ${Number(run.itemReceiptCount || 0).toLocaleString()} durable item receipts</p></div><time>${escapeHtml(relativeTime(run.updatedAt))}</time></article>`;
  }).join("") : "";
}

function renderActionPlatformAdmin() {
  const channels = state.signalChannels || [];
  const actionableAttention = channels.some((channel) => channel.provider !== "discord" && channel.health === "attention");
  $("#sourceChannelGate").textContent = actionableAttention ? "Attention" : "OK";
  $("#sourceChannelList").innerHTML = channels.map((channel) => {
    const discordPending = channel.provider === "discord";
    const providerName = discordPending ? "Discord" : channel.provider === "api" ? "API" : plainLabel(channel.provider);
    const healthLabel = discordPending ? "Client pending" : plainLabel(channel.health);
    const healthKind = discordPending ? "" : channel.health === "healthy" ? "good" : channel.health === "attention" ? "warning" : "";
    const setup = discordPending
      ? `<p><strong>Not connected yet: client pending.</strong> When the bot ships, invite it to the server, copy the numeric channel ID, then save that ID here.</p>`
      : `<p><strong>Next:</strong> create the source endpoint and key in Operations, then configure the sender with that credential.</p><button class="text-button" data-open-view="operations" type="button">Open Operations</button>`;
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(channel.name)}</h3><p>${escapeHtml(providerName)} · ${escapeHtml(channel.trustLevel.replaceAll("_", " "))}</p></div><span class="tag ${healthKind}">${escapeHtml(healthLabel)}</span></div><div class="channel-setup">${setup}</div><div class="card-meta"><span class="tag">${Number(channel.acceptedEventCount || 0).toLocaleString()} accepted</span><span class="tag">${Number(channel.rejectedEventCount || 0).toLocaleString()} rejected</span><span class="tag">${Number(channel.falsePositiveCount || 0).toLocaleString()} false positive${Number(channel.falsePositiveCount || 0) === 1 ? "" : "s"}</span><span class="tag">${channel.accuracyBps == null ? "No accuracy sample" : `${(Number(channel.accuracyBps) / 100).toFixed(1)}% accuracy`}</span><span class="tag">p50 ${channel.p50ObservedToReceivedMs == null ? "—" : `${Number(channel.p50ObservedToReceivedMs).toLocaleString()} ms`}</span><span class="tag">p95 ${channel.p95ObservedToReceivedMs == null ? "—" : `${Number(channel.p95ObservedToReceivedMs).toLocaleString()} ms`}</span></div><div class="card-actions"><button class="button secondary" data-source-channel-status="${escapeHtml(channel.id)}" type="button">${channel.status === "active" ? "Pause" : "Activate"}</button><button class="button secondary" data-source-channel-trust="${escapeHtml(channel.id)}" type="button">${channel.trustLevel === "trusted_exact" ? "Set informational" : "Trust product match"}</button><button class="button quiet" data-source-channel-replay="${escapeHtml(channel.id)}" type="button">Replay dead letters</button></div></article>`;
  }).join("") || empty("No provider channels configured.");
  const windows = state.dropWindows || [];
  const scheduledWindows = windows.filter((window) => window.status === "scheduled").length;
  $("#dropWindowGate").textContent = scheduledWindows ? `${scheduledWindows.toLocaleString()} scheduled` : "None scheduled";
  $("#dropWindowList").innerHTML = windows.map((window) => `<button class="card drop-window-card" data-drop-window-open="${escapeHtml(window.id)}" type="button"><div class="card-top"><div><h3>${escapeHtml(window.title)}</h3><p>${escapeHtml(retailerName(window.retailerId))} · ${escapeHtml(window.kind === "queue_open" ? "Queue open" : "Drop window")} · ${Number(window.items?.length || 0).toLocaleString()} products</p></div><span class="tag ${window.status === "active" ? "good" : window.status === "cancelled" ? "bad" : ""}">${escapeHtml(String(window.status).replaceAll("_", " "))}</span></div><div class="card-meta"><span class="tag">Starts ${escapeHtml(relativeTime(window.startsAt))}</span><span class="tag">Closes ${escapeHtml(relativeTime(window.closesAt))}</span><span class="tag">${escapeHtml(dropWindowConfidenceLabel(window.confidenceBps))}</span><span class="tag">${Number(window.optInCount || 0).toLocaleString()} opted in</span></div></button>`).join("") || empty("No drop windows authored yet.");
  $("#restockPatternList").innerHTML = (state.restockPatterns || []).map((pattern) => `<article class="card"><div class="card-top"><div><h3>${escapeHtml(pattern.title || pattern.listingId)}</h3><p>${escapeHtml(retailerName(pattern.retailerId))} · ${escapeHtml(pattern.retailerSku)} · ${escapeHtml(pattern.timezone)}</p></div><span class="tag">${Number(pattern.confidenceBps || 0) / 100}% confidence</span></div><div class="card-meta"><span class="tag">${Number(pattern.sampleCount || 0)} observations</span><span class="tag">Median interval ${pattern.medianIntervalMinutes == null ? "—" : `${pattern.medianIntervalMinutes} min`}</span><span class="tag">Hours ${(pattern.histogram || []).map((count, hour) => ({ count: Number(count || 0), hour })).filter((item) => item.count > 0).map((item) => `${item.hour}:00 (${item.count})`).join(", ") || "—"}</span></div><div class="card-actions"><button class="button secondary" data-use-restock-pattern="${escapeHtml(pattern.id)}" type="button">Use in window</button></div></article>`).join("") || empty("No restock pattern has been computed yet.");
  for (const retailerId of ["target", "walmart", "amazon", "bestbuy"]) {
    const container = $(`#${retailerId}LaneReadiness`);
    const lane = (state.laneReadiness || []).find((item) => item.retailerId === retailerId);
    if (!lane) {
      container.innerHTML = '<p class="fine-print">No guarded add readiness has been recorded for this store.</p>';
      continue;
    }
    const warning = lane.qualification?.warning || "none";
    const qualificationNeedsAttention = warning !== "none";
    const readinessLabel = qualificationNeedsAttention ? warning.replaceAll("_", " ")
      : lane.readyForGuardedAdd ? "Ready" : "Needs setup";
    container.innerHTML = `<div class="adapter-repair-summary"><span>Guarded add readiness</span><strong>${escapeHtml(readinessLabel)}</strong></div><div class="card-meta">${(lane.checklist || []).map((check) => `<span class="tag ${check.ready ? "good" : ""}"><span aria-hidden="true">${check.ready ? "✓" : "○"}</span> ${escapeHtml(check.label)}</span>`).join("")}</div><div class="card-actions">${lane.candidate?.canonicalUrl ? `<a class="button secondary" href="${escapeHtml(lane.candidate.canonicalUrl)}" target="_blank" rel="noopener">Open prior passing SKU</a>` : ""}${lane.qualification?.status === "qualified" ? `<button class="button danger" data-retire-lane="${escapeHtml(lane.retailerId)}" type="button">Retire this lane</button>` : ""}</div>`;
  }
  populateTimezoneSelect($("#dropWindowTimezone"), $("#dropWindowTimezone").value || state.dropWindowTimezone);
  populateTimezoneSelect($("#restockPatternTimezone"), $("#restockPatternTimezone").value || state.dropWindowTimezone);
  renderDropWindowProductPicker();
  renderRestockPatternProductPicker();
  renderDropWindowDuration();
}

function syncSourceChannelReferenceField() {
  const provider = $("#sourceChannelProvider").value;
  const input = $("#sourceChannelReference");
  if (provider === "discord") {
    $("#sourceChannelReferenceLabel").textContent = "Discord channel ID";
    $("#sourceChannelReferenceHelp").textContent = "In Discord, copy the 17–20 digit channel ID that will receive product alerts.";
    input.placeholder = "123456789012345678";
    input.maxLength = 20;
    input.pattern = "[0-9]{17,20}";
    input.inputMode = "numeric";
  } else {
    $("#sourceChannelReferenceLabel").textContent = "API key reference";
    $("#sourceChannelReferenceHelp").textContent = "Use the non-secret reference shown with the endpoint and key in Operations.";
    input.placeholder = "operations:primary-feed";
    input.maxLength = 180;
    input.pattern = "[A-Za-z0-9][A-Za-z0-9_.:-]{1,179}";
    input.inputMode = "text";
  }
  input.value = "";
}

function dropWindowConfidenceLabel(value) {
  const confidence = Number(value || 0);
  return confidence >= 9000 ? "Confirmed" : confidence >= 6500 ? "Likely" : "Rumored";
}

function confidenceOption(value) {
  const confidence = Number(value || 0);
  return confidence >= 9000 ? "10000" : confidence >= 6500 ? "8000" : "5000";
}

function localDateTimeValue(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function populateTimezoneSelect(select, selected = "") {
  if (!select) return;
  const fallback = ["UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York"];
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const timezones = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : fallback;
  const requested = selected || state.dropWindowTimezone || browserZone;
  const values = [...new Set([requested, browserZone, "UTC", ...timezones].filter(Boolean))];
  select.innerHTML = values.map((zone) => `<option value="${escapeHtml(zone)}">${escapeHtml(zone.replaceAll("_", " "))}</option>`).join("");
  select.value = requested;
}

function renderDropWindowDuration() {
  const form = $("#dropWindowForm");
  const output = $("#dropWindowDuration");
  if (!form || !output) return;
  const starts = new Date(form.elements.startsAt.value).getTime();
  const closes = new Date(form.elements.closesAt.value).getTime();
  if (!Number.isFinite(starts) || !Number.isFinite(closes) || closes <= starts) {
    output.textContent = "Choose start and close times.";
    return;
  }
  const minutes = Math.round((closes - starts) / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  output.textContent = `${hours ? `${hours} h` : ""}${hours && remainder ? " " : ""}${remainder ? `${remainder} min` : ""} window`;
}

function listingPickerRow(item, action, disabled = false) {
  return `<button class="listing-picker-result" data-${action}="${escapeHtml(item.listingId)}" type="button" role="option" ${disabled ? "disabled" : ""}><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.retailerName || retailerName(item.retailerId))} · ${escapeHtml(item.retailerSku)}</span></button>`;
}

function renderDropWindowProductPicker() {
  const selection = $("#dropWindowProductSelection");
  const results = $("#dropWindowProductResults");
  const search = $("#dropWindowProductSearch");
  if (!selection || !results || !search) return;
  const products = state.dropWindowDraftProducts;
  const retailerId = products[0]?.retailerId || "";
  $("#dropWindowRetailer").value = retailerId;
  $("#dropWindowStore").textContent = retailerId ? retailerName(retailerId) : "Choose products first";
  selection.innerHTML = products.length
    ? products.map((item) => `<span class="selection-chip"><span>${escapeHtml(item.title)} · ${escapeHtml(item.retailerSku)}</span><button data-remove-drop-window-product="${escapeHtml(item.listingId)}" type="button" aria-label="Remove ${escapeHtml(item.title)}">×</button></span>`).join("") + `<span class="field-help">${products.length} of 50 selected</span>`
    : '<span class="field-help">Choose 1–50 products from one store.</span>';
  const selectedIds = new Set(products.map((item) => item.listingId));
  results.innerHTML = state.dropWindowSearchResults.map((item) => listingPickerRow(
    item,
    "add-drop-window-product",
    selectedIds.has(item.listingId) || (retailerId && item.retailerId !== retailerId)
  )).join("");
  results.hidden = !state.dropWindowSearchResults.length;
  search.setAttribute("aria-expanded", String(!results.hidden));
}

function renderRestockPatternProductPicker() {
  const selection = $("#restockPatternProductSelection");
  const results = $("#restockPatternProductResults");
  const search = $("#restockPatternProductSearch");
  if (!selection || !results || !search) return;
  const product = state.restockPatternProduct;
  $("#restockPatternListingId").value = product?.listingId || "";
  selection.innerHTML = product
    ? `<span class="selection-chip"><span>${escapeHtml(product.title)} · ${escapeHtml(product.retailerName || retailerName(product.retailerId))} · ${escapeHtml(product.retailerSku)}</span><button data-remove-restock-pattern-product type="button" aria-label="Remove ${escapeHtml(product.title)}">×</button></span>`
    : '<span class="field-help">Choose one product.</span>';
  results.innerHTML = state.restockPatternSearchResults.map((item) => listingPickerRow(
    item,
    "choose-restock-pattern-product",
    product?.listingId === item.listingId
  )).join("");
  results.hidden = !state.restockPatternSearchResults.length;
  search.setAttribute("aria-expanded", String(!results.hidden));
}

async function searchListingPicker(kind, query) {
  const requestField = kind === "drop-window" ? "dropWindowSearchRequestId" : "restockPatternSearchRequestId";
  const resultsField = kind === "drop-window" ? "dropWindowSearchResults" : "restockPatternSearchResults";
  const requestId = ++state[requestField];
  const normalized = String(query || "").trim();
  if (normalized.length < 2) {
    state[resultsField] = [];
  } else {
    const result = await api(`/api/v1/user/library?limit=20&offset=0&q=${encodeURIComponent(normalized)}`);
    if (requestId !== state[requestField]) return;
    state[resultsField] = result.items || [];
  }
  if (kind === "drop-window") renderDropWindowProductPicker();
  else renderRestockPatternProductPicker();
}

function useRestockPatternForWindow(pattern) {
  const form = $("#dropWindowForm");
  state.dropWindowDraftProducts = [{
    listingId: pattern.listingId,
    retailerId: pattern.retailerId,
    retailerName: retailerName(pattern.retailerId),
    retailerSku: pattern.retailerSku,
    title: pattern.title || pattern.retailerSku,
    canonicalUrl: pattern.canonicalUrl || ""
  }];
  populateTimezoneSelect(form.elements.timezone, pattern.timezone);
  form.elements.confidenceBps.value = confidenceOption(pattern.confidenceBps);
  if (!form.elements.title.value.trim()) {
    form.elements.title.value = `${retailerName(pattern.retailerId)} observed restock window`;
  }
  renderDropWindowProductPicker();
  form.elements.startsAt.focus();
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function openDropWindow(windowId, { historyMode = "push" } = {}) {
  const result = await api(`/api/v1/admin/drop-windows/${encodeURIComponent(windowId)}`);
  const window = result.window;
  if (!window?.id) throw new Error("The drop window details are unavailable.");
  state.editingDropWindow = window;
  const form = $("#dropWindowEditForm");
  form.reset();
  form.elements.id.value = window.id;
  form.elements.title.value = window.title;
  form.elements.startsAt.value = localDateTimeValue(window.startsAt);
  form.elements.closesAt.value = localDateTimeValue(window.closesAt);
  form.elements.staggerMinutes.value = Math.round(Number(window.spreadSeconds || 0) / 60);
  form.elements.confidenceBps.value = confidenceOption(window.confidenceBps);
  form.elements.earlyAccessNote.value = window.items?.find((item) => item.earlyAccess?.note)?.earlyAccess?.note || "";
  populateTimezoneSelect(form.elements.timezone, window.timezone);
  $("#dropWindowDialogStore").textContent = `${retailerName(window.retailerId)} · ${window.kind === "queue_open" ? "Queue open" : "Drop window"}`;
  $("#dropWindowDialogTitle").textContent = window.title;
  $("#dropWindowDetailSummary").innerHTML = `<span class="tag ${window.status === "active" ? "good" : window.status === "cancelled" ? "bad" : ""}">${escapeHtml(String(window.status).replaceAll("_", " "))}</span><span>${Number(window.items?.length || 0).toLocaleString()} products</span><span>${Number(window.optInCount || 0).toLocaleString()} opted in</span><span>${escapeHtml(dropWindowConfidenceLabel(window.confidenceBps))}</span>`;
  const optedIn = (window.optedInUsers || []).map((user) => user.displayName).filter(Boolean);
  $("#dropWindowOptedIn").textContent = optedIn.length ? `Opted in: ${optedIn.join(", ")}` : "Opted in: nobody yet";
  $("#dropWindowDetailItems").innerHTML = (window.items || []).map((item) => {
    const states = Object.entries(item.watchStateCounts || {}).filter(([, count]) => Number(count) > 0).map(([status, count]) => `${Number(count)} ${status.replaceAll("_", " ")}`).join(" · ") || "No watches";
    return `<article><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(retailerName(item.retailerId))} · ${escapeHtml(item.retailerSku)}</span></div><div><span>${escapeHtml(states)}</span><a href="${escapeHtml(item.canonicalUrl)}" target="_blank" rel="noreferrer">Open product</a></div></article>`;
  }).join("");
  $("#dropWindowTimeline").innerHTML = `<span>Created ${escapeHtml(relativeTime(window.createdAt))}</span><span>Starts ${escapeHtml(new Date(window.startsAt).toLocaleString())}</span><span>Closes ${escapeHtml(new Date(window.closesAt).toLocaleString())}</span>`;
  const editable = window.status === "scheduled";
  $$('input, select', $("#dropWindowEditFields")).forEach((field) => { field.disabled = !editable; });
  $("#saveDropWindowButton").hidden = !editable;
  const open = ["scheduled", "active"].includes(window.status);
  $("#cancelDropWindowButton").hidden = !open;
  $("#cancelDropWindowButton").dataset.confirming = "false";
  $("#cancelDropWindowButton").textContent = "Cancel window";
  $("#dropWindowCancelReasonField").hidden = true;
  $("#replaceDropWindowButton").hidden = !open;
  $("#dropWindowDialog").showModal();
  state.adminDetailPushed.dropWindowDialog = historyMode === "push";
  if (historyMode === "push") history.pushState(null, "", `#sources/drops/${encodeURIComponent(window.id)}`);
}

function replaceDropWindowDraft() {
  const window = state.editingDropWindow;
  if (!window || !["scheduled", "active"].includes(window.status)) return;
  const form = $("#dropWindowForm");
  state.dropWindowDraftProducts = (window.items || []).map((item) => ({
    listingId: item.listingId,
    retailerId: item.retailerId,
    retailerName: retailerName(item.retailerId),
    retailerSku: item.retailerSku,
    title: item.title,
    canonicalUrl: item.canonicalUrl
  }));
  form.elements.title.value = `${window.title} replacement`;
  form.elements.kind.value = window.kind;
  const replacementStart = Math.max(Date.now() + 5 * 60_000, new Date(window.startsAt).getTime());
  const duration = Math.max(15 * 60_000, new Date(window.closesAt).getTime() - new Date(window.startsAt).getTime());
  form.elements.startsAt.value = localDateTimeValue(replacementStart);
  form.elements.closesAt.value = localDateTimeValue(replacementStart + duration);
  form.elements.staggerMinutes.value = Math.round(Number(window.spreadSeconds || 0) / 60);
  form.elements.confidenceBps.value = confidenceOption(window.confidenceBps);
  form.elements.earlyAccessNote.value = window.items?.find((item) => item.earlyAccess?.note)?.earlyAccess?.note || "";
  populateTimezoneSelect(form.elements.timezone, window.timezone);
  renderDropWindowProductPicker();
  form.elements.supersedesId.value = window.id;
  renderDropWindowDuration();
  const dialog = $("#dropWindowDialog");
  dialog.close();
  restoreAdminDetailRoute(dialog);
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  form.elements.title.focus();
}

function renderDevices() {
  const devices = state.snapshot.devices || [];
  const pairing = state.pairing;
  const pairingActive = pairing && new Date(pairing.expiresAt).getTime() > Date.now();
  $("#pairingCodePanel").hidden = !pairingActive;
  if (pairingActive) {
    $("#pairingCode").textContent = pairing.code;
    $("#pairingExpiry").textContent = `Expires ${relativeTime(pairing.expiresAt)}. Creating another code invalidates this one.`;
  } else {
    state.pairing = null;
  }
  $("#deviceList").innerHTML = devices.length ? devices.map((device) => {
    const credential = device.credential || {};
    const transport = device.capabilities?.productionTransportProfile === true
      ? "pinned production transport · browser-managed updates"
      : "local companion transport";
    const credentialState = device.status === "revoked"
      ? `credential generation ${Number(credential.generation || 1).toLocaleString()} revoked`
      : credential.pending
      ? "credential rotation pending recovery"
      : device.capabilities?.rotatableDeviceCredentials !== true
        ? "upgrade companion for automatic credential rotation"
        : credential.rotationDue
          ? "credential rotation due on next health check"
          : `credential generation ${Number(credential.generation || 1).toLocaleString()} · automatic rotation enabled`;
    return `<article class="device-row"><div><h3>${statusDot(device.online ? "good" : device.status === "revoked" ? "bad" : "warning", device.online ? "Online" : plainLabel(device.status))} ${escapeHtml(device.name)}</h3><p>${escapeHtml(device.platform || "Chrome")} · extension ${escapeHtml(device.extensionVersion || "unknown")} · ${escapeHtml(transport)} · ${escapeHtml(device.lastSeenAt ? `seen ${relativeTime(device.lastSeenAt)}` : "never seen")} · ${escapeHtml(credentialState)}</p></div>${device.status === "active" ? `<button class="button danger" data-device-revoke="${escapeHtml(device.id)}" type="button">Revoke</button>` : '<span class="tag bad">Revoked</span>'}</article>`;
  }).join("") : empty("No Chrome companion is paired yet.");
}

function renderShadowObservations() {
  const readiness = state.snapshot.retailerEvidence || [];
  $("#retailerReadinessList").innerHTML = readiness.map((item) => {
    const name = retailerName(item.retailerId);
    const mode = item.mode === "guarded_add" ? "Guarded add lane" : "Read-only observer";
    const routeEvidence = item.retailerId === "amazon"
      ? ` · ${Number(item.purchaseRouteReadyCount || 0).toLocaleString()} ephemeral offer bindings verified`
      : "";
    return `<article class="retailer-readiness-card"><h3>${statusDot(item.observationCount ? "good" : "warning", item.observationCount ? "Evidence available" : "No evidence")} ${escapeHtml(name)}</h3><p>${escapeHtml(mode)} · ${Number(item.observationCount || 0).toLocaleString()} observations · ${Number(item.distinctSkuCount || 0).toLocaleString()} SKUs<br>${Number(item.actionableCandidateCount || 0).toLocaleString()} complete candidates${escapeHtml(routeEvidence)} · ${item.latestObservedAt ? escapeHtml(`latest ${relativeTime(item.latestObservedAt)}`) : "none captured"}</p></article>`;
  }).join("");
  const observations = state.snapshot.shadowObservations || [];
  $("#targetShadowList").innerHTML = observations.length ? observations.map((observation) => {
    const kind = observation.observationState === "actionable_candidate" ? "good"
      : observation.observationState === "manual_block" ? "bad" : "warning";
    const routeTag = observation.retailerId === "amazon"
      ? `<span class="tag ${observation.purchaseRouteReady ? "good" : "warning"}">${observation.purchaseRouteReady ? "Offer binding verified" : escapeHtml(String(observation.routeReasonCode || "binding unavailable").replaceAll("_", " "))}</span>`
      : "";
    return `<article class="shadow-evidence-row">
      <div>${statusDot(kind, plainLabel(observation.observationState))}<div><h3>${escapeHtml(retailerName(observation.retailerId))} · SKU ${escapeHtml(observation.retailerSku)}</h3><p>${escapeHtml(String(observation.availability).replaceAll("_", " "))} · ${formatMoney(observation.unitPriceCents, observation.currency)} · ${escapeHtml(observation.sellerName || "Seller unknown")} · ${escapeHtml(observation.fulfillment)}</p></div></div>
      <div class="shadow-evidence-meta"><span class="tag ${kind}">${escapeHtml(String(observation.observationState).replaceAll("_", " "))}</span>${routeTag}<time>${escapeHtml(relativeTime(observation.observedAt))}</time></div>
      <a class="canonical-link" href="${escapeHtml(observation.canonicalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(observation.canonicalUrl)}</a>
    </article>`;
  }).join("") : empty("No store page has been inspected yet. Open an exact product page and use the Chrome companion’s read-only inspection button.");
}

function renderAdapterRepairQueue() {
  const queue = state.snapshot.adapterRepairQueue || [];
  const open = Number(state.snapshot.counts.openAdapterRepairGroups || 0);
  const recovered = Number(state.snapshot.counts.recoveredAdapterRepairGroups || 0);
  const events = Number(state.snapshot.counts.adapterDiagnosticEvents || 0);
  const gate = $("#adapterRepairGate");
  gate.textContent = open ? "Attention" : "OK";
  gate.classList.toggle("danger", open > 0);
  $("#adapterRepairSummary").innerHTML = `<strong>${open.toLocaleString()} open repair group${open === 1 ? "" : "s"}</strong><span>${events.toLocaleString()} sanitized events · ${recovered.toLocaleString()} recovered groups</span>`;
  $("#adapterRepairList").innerHTML = queue.length ? queue.map((item) => {
    const isOpen = item.status === "open";
    const retailer = retailerName(item.retailerId);
    const operation = String(item.operation || "observe").replaceAll("_", " ");
    const stage = String(item.failureStage || "unknown").replaceAll("_", " ");
    const reason = String(item.reasonCode || "unknown").replaceAll("_", " ");
    const fingerprint = String(item.layoutFingerprint || "").slice(0, 12);
    const suggestions = Array.isArray(item.repairSuggestions) ? item.repairSuggestions.slice(0, 5) : [];
    const suggestionRows = suggestions.map((suggestion) => {
      const ready = suggestion.reviewState === "maintainer_ready";
      return `<div class="card-meta"><span class="tag">${escapeHtml(observerFieldName(suggestion.field))}</span><span class="tag ${ready ? "warning" : ""}">${ready ? "Ready for candidate evaluation" : "Collecting evidence"}</span><span class="tag">never auto-promoted</span><span class="tag">non-executable</span><code>${escapeHtml(suggestion.selector || "")}</code><span>${Number(suggestion.distinctDeviceCount || 0).toLocaleString()}/${Number(suggestion.minimumDeviceCount || 3).toLocaleString()} Chrome companions · ${Number(suggestion.distinctSkuCount || 0).toLocaleString()}/${Number(suggestion.minimumSkuCount || 2).toLocaleString()} exact SKUs</span></div>`;
    }).join("");
    return `<article class="adapter-repair-row ${isOpen ? "open" : "recovered"}">
      <div>${statusDot(isOpen ? "bad" : "good", isOpen ? "Repair needed" : "Recovered")}<div><h3>${escapeHtml(retailer)} · ${escapeHtml(operation)} · ${escapeHtml(item.latestRetailerSku || "unknown SKU")}</h3><p>${escapeHtml(stage)} · ${escapeHtml(reason)} · layout ${escapeHtml(fingerprint || "unknown")}</p></div></div>
      <div class="adapter-repair-meta"><span class="tag ${isOpen ? "bad" : "good"}">${isOpen ? "Repair needed" : "Recovered"}</span><span>${Number(item.occurrenceCount || 0).toLocaleString()} occurrences · ${Number(item.affectedSkuCount || 0).toLocaleString()} SKUs${item.domChangedSeen ? " · DOM changed during retry" : ""}</span><time>${escapeHtml(relativeTime(item.lastSeenAt))}</time></div>
      ${suggestionRows}
    </article>`;
  }).join("") : empty("No adapter repair incidents have been captured. The server is listening for sanitized extension diagnostics.");
}

function renderWalmartDraws() {
  const draws = state.snapshot.walmartDraws || {};
  const latest = draws.latestScan || null;
  const items = Array.isArray(draws.items) ? draws.items : [];
  const failures = Number(state.snapshot.counts.walmartDrawFailures || 0);
  const gate = $("#walmartDrawGate");
  gate.textContent = latest?.outcome === "passed" ? "Verified · read only"
    : latest ? `${plainLabel(latest.outcome)} · read only` : "Not scanned";
  gate.classList.toggle("danger", ["failed", "manual"].includes(latest?.outcome));
  $("#walmartDrawSummary").innerHTML = `<strong>${items.length.toLocaleString()} current drawing${items.length === 1 ? "" : "s"}</strong><span>${Number(state.snapshot.counts.walmartDrawScans || 0).toLocaleString()} scans · ${failures.toLocaleString()} blocked/failed · entry mutation closed</span>`;
  $("#walmartDrawList").innerHTML = items.length ? items.map((item) => {
    const kind = item.drawState === "active" && item.closesAt ? "good" : "warning";
    const limit = item.orderMaxLimit ? ` · limit ${Number(item.orderMaxLimit)}` : "";
    return `<article class="shadow-evidence-row">
      <div>${statusDot(kind, plainLabel(item.drawState))}<div><h3>Walmart item ${escapeHtml(item.retailerSku)} · ${escapeHtml(item.title)}</h3><p>${formatMoney(item.unitPriceCents, item.currency)} · ${escapeHtml(item.sellerName || "seller unknown")} · condition group ${escapeHtml(item.conditionGroupCode ?? "unknown")}${escapeHtml(limit)}</p></div></div>
      <div class="shadow-evidence-meta"><span class="tag ${kind}">${escapeHtml(String(item.drawState).replaceAll("_", " "))}</span><span class="tag ${item.tracked ? "good" : "warning"}">${item.tracked ? `Matched plan · ${escapeHtml(item.missionStatus || "tracked")}` : "No matching plan"}</span><time>${item.closesAt ? `closes ${escapeHtml(relativeTime(item.closesAt))}` : "close unknown"}</time></div>
      <a class="canonical-link" href="${escapeHtml(item.canonicalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.canonicalUrl)}</a>
    </article>`;
  }).join("") : empty(latest ? "No still-open drawings were present in the latest scan." : "Open Walmart’s Draw hub and run the extension’s explicit read-only drawing inspection.");
}

function communityScopeParts(scope) {
  const value = String(scope || "");
  if (value.startsWith("region:")) return { kind: "region", value: value.slice(7) };
  if (value.startsWith("store:")) return { kind: "store", value: "" };
  return { kind: "country", value: value.startsWith("country:") ? value.slice(8) : "US" };
}

function communitySelectedOfferLabel(item) {
  const selected = item?.selectedOffer || {};
  const stateLabel = String(selected.selectionState || "unresolved").replaceAll("_", " ");
  const attributes = Object.entries(selected.attributes || {})
    .map(([key, value]) => `${key} ${value}`)
    .join(" · ");
  return attributes ? `${stateLabel} · ${attributes}` : stateLabel;
}

function renderCommunity() {
  const community = state.snapshot.community || {};
  const counts = state.snapshot.counts || {};
  const consents = community.consents || [];
  const assertions = community.assertions || [];
  const aggregates = community.aggregates || [];
  const enabled = Number(counts.communityEnabledDomains || 0);
  const quarantined = Number(counts.communityQuarantinedAssertions || 0);
  $("#communitySummary").innerHTML = [
    ["Enabled stores", enabled, "Every store starts off"],
    ["Your assertions", Number(counts.communityAssertions || 0), `${Number(counts.communityActiveAssertions || 0)} still current`],
    ["Quarantined", quarantined, "Current conflicts fail closed"],
    ["Advisory projections", aggregates.filter((item) => item.publicationState === "advisory").length, "Three current contributors minimum"]
  ].map(([label, value, detail]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${Number(value).toLocaleString()}</strong><small>${escapeHtml(detail)}</small></article>`).join("");

  $("#communityConsentList").innerHTML = consents.length ? consents.map((consent) => {
    const scope = communityScopeParts(consent.locationScope);
    return `<article class="community-consent-card" data-community-retailer="${escapeHtml(consent.retailerId)}" data-current-scope="${escapeHtml(consent.locationScope)}">
      <div class="card-top"><div><h3>${escapeHtml(consent.retailerName)}</h3><p>${escapeHtml((consent.domains || []).join(", "))}</p></div><span class="tag ${consent.enabled ? "good" : "warning"}">${consent.enabled ? "Opted in" : "Off"}</span></div>
      <div class="community-scope-fields">
        <label><span>Location precision</span><select data-community-scope-kind><option value="country" ${scope.kind === "country" ? "selected" : ""}>Country</option><option value="region" ${scope.kind === "region" ? "selected" : ""}>Region</option><option value="store" ${scope.kind === "store" ? "selected" : ""}>Pickup store</option></select></label>
        <label><span>Country / region / local store ID</span><input data-community-scope-value value="${escapeHtml(scope.value)}" autocomplete="off" placeholder="US, US-CA, or a store ID"></label>
      </div>
      <p class="fine-print">Pickup store IDs are hashed in this browser before submission. ${scope.kind === "store" && consent.enabled ? "A fingerprint is saved; leave the field blank to retain it." : "Country and region scopes contain no precise location."}</p>
      <div class="card-actions"><button class="button primary" data-community-enable="${escapeHtml(consent.retailerId)}" type="button">${consent.enabled ? "Update opt-in" : "Enable sharing"}</button>${consent.enabled ? `<button class="button secondary" data-community-disable="${escapeHtml(consent.retailerId)}" type="button">Disable</button>` : ""}<button class="text-button" data-community-delete="${escapeHtml(consent.retailerId)}" type="button">Delete this store’s contributions</button></div>
    </article>`;
  }).join("") : empty("No supported community evidence domains are available.");

  $("#communityAggregateList").innerHTML = aggregates.length ? aggregates.map((item) => {
    const stateLabel = String(item.publicationState || "insufficient_quorum").replaceAll("_", " ");
    const kind = item.publicationState === "advisory" ? "good" : item.publicationState === "quarantined" ? "bad" : "warning";
    const confidence = item.confidence || {};
    const superseded = Number(item.supersededAssertionCount || 0);
    const priceRange = Number.isSafeInteger(item.priceMinimumCents) && Number.isSafeInteger(item.priceMaximumCents)
      ? `${formatMoney(item.priceMinimumCents, item.currency)}–${formatMoney(item.priceMaximumCents, item.currency)}`
      : "No price range";
    const projectedPrice = item.priceQuorumMet === true
      ? `${formatMoney(item.unitPriceCents, item.currency)} median`
      : "Price quorum pending";
    return `<article class="community-evidence-row"><div class="card-top"><div><h3>${escapeHtml(retailerName(item.retailerId))} · ${escapeHtml(item.retailerSku)}</h3><p>${escapeHtml(String(item.availability || "unknown").replaceAll("_", " "))} · ${escapeHtml(projectedPrice)} · ${escapeHtml(item.sellerName || "Seller unknown")} · ${escapeHtml(item.fulfillment || "unknown")}</p></div><span class="tag ${kind}">${escapeHtml(stateLabel)}</span></div><div class="card-meta"><span class="tag">${escapeHtml(communitySelectedOfferLabel(item))}</span><span class="tag">${Number(item.currentContributorVoteCount || 0)} current votes</span><span class="tag">${Number(item.independentDeviceCount || 0)} Chrome companions</span>${superseded ? `<span class="tag">${superseded} superseded</span>` : ""}<span class="tag">Observed range ${escapeHtml(priceRange)}</span><span class="tag">Availability ${Math.round(Number(confidence.availability || 0) * 100)}%</span><span class="tag">Price ${Math.round(Number(confidence.price || 0) * 100)}%</span><span class="tag">Expires ${escapeHtml(relativeTime(item.expiresAt))}</span></div></article>`;
  }).join("") : empty("No current community projections. The local pilot cannot manufacture independent-user quorum.");

  $("#communityAssertionList").innerHTML = assertions.length ? assertions.map((item) => {
    const kind = item.assertionState === "quarantined" ? "bad" : "good";
    return `<article class="community-evidence-row"><div class="card-top"><div><h3>${escapeHtml(retailerName(item.retailerId))} · ${escapeHtml(item.retailerSku)}</h3><p>${escapeHtml(String(item.availability).replaceAll("_", " "))} · ${formatMoney(item.unitPriceCents, item.currency)} · ${escapeHtml(item.sellerName || "Seller unknown")} · ${escapeHtml(item.fulfillment)} · ${escapeHtml(item.locationScope)}</p></div><span class="tag ${kind}">${escapeHtml(String(item.assertionState).replaceAll("_", " "))}</span></div><div class="card-meta"><span class="tag">${escapeHtml(communitySelectedOfferLabel(item))}</span><span class="tag">Observer ${escapeHtml(item.observerVersion)}</span><span class="tag">Expires ${escapeHtml(relativeTime(item.expiresAt))}</span>${item.quarantineReason ? `<span class="tag bad">${escapeHtml(String(item.quarantineReason).replaceAll("_", " "))}</span>` : ""}</div></article>`;
  }).join("") : empty("You have not shared any community evidence.");
  $("#deleteAllCommunityButton").disabled = assertions.length === 0;
}

function renderIdentityGovernance() {
  const governance = state.snapshot.identityGovernance || {};
  const claims = governance.claims || [];
  const projections = governance.projections || [];
  const form = $("#identityClaimForm");
  const listings = state.libraryItems || [];
  if (!state.identityDirty) {
    const options = listings.map((item) => `<option value="${escapeHtml(item.listingId)}">${escapeHtml(item.retailerName)} · ${escapeHtml(item.retailerSku)} · ${escapeHtml(item.title)}</option>`).join("");
    form.elements.listingId.innerHTML = `<option value="">Choose an exact listing</option>${options}`;
    form.elements.referenceListingId.innerHTML = `<option value="">Choose a different-store reference</option>${options}`;
  }
  form.querySelector("button[type='submit']").disabled = listings.length < 2;
  $("#deleteIdentityClaimsButton").disabled = claims.length === 0;
  $("#identityProjectionList").innerHTML = projections.length ? projections.map((item) => {
    const kind = item.publicationState === "validated_equivalence" ? "good" : item.publicationState === "quarantined" ? "bad" : "warning";
    return `<article class="community-evidence-row"><div class="card-top"><div><h3>${escapeHtml(retailerName(item.listingRetailerId))} ${escapeHtml(item.listingRetailerSku)} ↔ ${escapeHtml(retailerName(item.referenceRetailerId))} ${escapeHtml(item.referenceRetailerSku)}</h3><p>${escapeHtml(String(item.identifierKind).toUpperCase())} fingerprint ${escapeHtml(String(item.identifierHash).slice(0, 12))} · ${Number(item.independentUserCount || 0)} users · ${Number(item.healthyPairedDeviceCount || 0)} healthy Chrome companions</p></div><span class="tag ${kind}">${escapeHtml(String(item.publicationState).replaceAll("_", " "))}</span></div><div class="card-meta"><span class="tag ${item.siblingAvailabilityEligible ? "good" : "warning"}">${item.siblingAvailabilityEligible ? "Sibling evidence eligible" : "No sibling stock merge"}</span><span class="tag">Catalog remapped: never</span></div></article>`;
  }).join("") : empty("No cross-store identity projections. Inventory remains attached to each exact store listing.");
  $("#identityClaimList").innerHTML = claims.length ? claims.map((claim) => {
    const kind = claim.claimState === "reviewed" ? "good" : claim.claimState === "quarantined" || claim.claimState === "rejected" ? "bad" : "warning";
    return `<article class="community-evidence-row"><div class="card-top"><div><h3>${escapeHtml(retailerName(claim.listingRetailerId))} ${escapeHtml(claim.listingRetailerSku)} → ${escapeHtml(retailerName(claim.referenceRetailerId))} ${escapeHtml(claim.referenceRetailerSku)}</h3><p>${escapeHtml(String(claim.identifierKind).toUpperCase())} ${escapeHtml(claim.normalizedIdentifier)} · ${escapeHtml(claim.provenanceNote)}</p></div><span class="tag ${kind}">${escapeHtml(String(claim.claimState).replaceAll("_", " "))}</span></div>${claim.conflictReason ? `<p class="identity-conflict">Conflict: ${escapeHtml(String(claim.conflictReason).replaceAll("_", " "))}</p>` : ""}<div class="card-actions">${claim.claimState === "pending_review" ? `<button class="button secondary" data-identity-review="reviewed" data-identity-claim-id="${escapeHtml(claim.id)}" type="button">Record local review</button>` : ""}${["pending_review", "quarantined"].includes(claim.claimState) ? `<button class="button danger" data-identity-review="rejected" data-identity-claim-id="${escapeHtml(claim.id)}" type="button">Reject claim</button>` : ""}</div></article>`;
  }).join("") : empty("No identity equivalence claims have been proposed.");
}

function renderObserverRegistry() {
  const registry = state.snapshot.observerRegistry || {};
  const recipes = registry.recipes || [];
  const trust = registry.trust || registry.key || {};
  const keyId = String(trust.keyId || "");
  const rootKeyId = String(trust.rootKeyId || "");
  const generation = Number(trust.generation || 0);
  $("#observerRegistryKey").textContent = trust.signingReady
    ? `ROOTED G${generation} · ${keyId.slice(0, 8)}`
    : rootKeyId ? "ROOT PINNED · INSTALL REQUIRED" : "KEY UNAVAILABLE";
  const manifests = Array.isArray(trust.manifests) ? trust.manifests : [];
  const transparency = Array.isArray(trust.transparency) ? trust.transparency : [];
  const witness = trust.witness || {};
  const witnessState = String(witness.state || "disabled");
  const witnessHealthy = witness.healthy === true;
  const witnessConfigured = witness.configured === true;
  const witnessKind = witnessHealthy ? "good" : witnessState === "disabled" ? "warning" : "bad";
  $("#observerTrustSummary").innerHTML = `
    <article class="community-evidence-row">
      <div class="card-top"><div><h3>Package-rooted observer trust</h3><p>Root ${escapeHtml(rootKeyId.slice(0, 16) || "unavailable")} · generation ${generation} · ${Number(trust.revokedKeyCount || 0)} revoked keys · expires ${escapeHtml(trust.expiresAt ? relativeTime(trust.expiresAt) : "not installed")}</p></div><span class="tag ${trust.signingReady ? "good" : "bad"}">${trust.signingReady ? "SIGNING READY" : "DISTRIBUTION CLOSED"}</span></div>
      <div class="card-meta"><span class="tag">${manifests.length} manifest receipts</span><span class="tag">${transparency.length} transparency events</span><span class="tag">Mutation capable: never</span>${trust.manifestHash ? `<span class="tag">Manifest ${escapeHtml(String(trust.manifestHash).slice(0, 12))}</span>` : ""}</div>
    </article>
    <article class="community-evidence-row">
      <div class="card-top"><div><h3>Independent transparency witness</h3><p>${witnessConfigured ? `${escapeHtml(witness.endpointOrigin || "Independent endpoint")} · log ${escapeHtml(witness.logId || "unknown")} · key ${escapeHtml(String(witness.witnessKeyId || "").slice(0, 12))}` : "Local/offline mode has no external witness configured."}</p></div><span class="tag ${witnessKind}">${escapeHtml(witnessState.replaceAll("_", " ").toUpperCase())}</span></div>
      <div class="card-meta"><span class="tag">${Number(witness.witnessReceiptCount || 0)} signed receipts</span><span class="tag ${Number(witness.failedWitnessCheckCount || 0) ? "bad" : ""}">${Number(witness.failedWitnessCheckCount || 0)} failed checks</span><span class="tag">${witness.required ? "Hosted delivery gate" : witnessConfigured ? "Advisory local validation" : "Disabled locally"}</span>${witness.latestReceipt?.validUntil ? `<span class="tag ${witnessHealthy ? "good" : "bad"}">Valid ${escapeHtml(relativeTime(witness.latestReceipt.validUntil))}</span>` : ""}</div>
      ${witness.alarmCode ? `<p class="identity-conflict">Alarm: ${escapeHtml(String(witness.alarmCode).replaceAll("_", " "))}</p>` : ""}
      ${witnessConfigured && witness.checkpoint ? `<div class="card-actions"><button class="button secondary" id="publishObserverWitnessButton" type="button">Publish current checkpoint</button></div>` : ""}
    </article>`;
  const form = $("#observerRecipeForm");
  if (!state.observerRecipeDirty) {
    form.elements.retailerId.innerHTML = Object.entries(RETAILER_NAMES)
      .map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("");
    form.elements.minimumExtensionVersion.value = state.snapshot.version;
  }
  $("#observerRecipeList").innerHTML = recipes.length ? recipes.map((recipe) => {
    const trials = recipe.trials || {};
    const regionalSlo = recipe.regionalConflictSlo || {};
    const regionalSloState = String(regionalSlo.state || "insufficient_evidence");
    const regionalSloKind = regionalSloState === "breached" ? "bad"
      : regionalSloState === "healthy" ? "good" : "warning";
    const kind = recipe.lifecycleState === "trusted_read_only" ? "good"
      : recipe.lifecycleState === "disabled" ? "bad" : recipe.lifecycleState === "quarantined" ? "warning" : "good";
    const nextState = recipe.lifecycleState === "quarantined" ? "shadow"
      : recipe.lifecycleState === "shadow" ? "canary"
        : recipe.lifecycleState === "canary" ? "trusted_read_only" : "";
    const needsResign = ["shadow", "canary", "trusted_read_only"].includes(recipe.lifecycleState)
      && generation > 0
      && (Number(recipe.trustManifestGeneration || 0) !== generation
        || String(recipe.trustManifestHash || "") !== String(trust.manifestHash || ""));
    const selectorCount = Object.values(recipe.fields || {}).reduce((sum, field) => sum + Number(field.selectors?.length || 0), 0);
    const generated = recipe.provenanceCode === "privacy_bounded_repair_miner";
    const fieldNames = Object.keys(recipe.fields || {}).map(observerFieldName).join(", ");
    const oracleComplete = Number(trials.oracleCompleteCohortPassed || 0);
    const packagedConflicts = Number(trials.packagedConflictTrials || 0);
    const oracleConflicts = Number(trials.oracleConflictTrials || 0);
    const cohortPassed = Number(trials.cohortPassed || 0);
    const cohortSkus = Number(trials.distinctCohortSkus || 0);
    const cohortLayouts = Number(trials.distinctCohortLayouts || 0);
    const oracleContributors = Number(trials.distinctOracleContributors || 0);
    const oracleDevices = Number(trials.distinctOracleDevices || 0);
    const canaryPasses = Number(trials.canaryCohortPassed || 0);
    const canarySkus = Number(trials.distinctCanarySkus || 0);
    const canaryLayouts = Number(trials.distinctCanaryLayouts || 0);
    const canaryOraclePasses = Number(trials.canaryOracleCompletePassed || 0);
    const canaryOracleContributors = Number(trials.distinctCanaryOracleContributors || 0);
    const canaryOracleDevices = Number(trials.distinctCanaryOracleDevices || 0);
    const canaryAgeSeconds = Number(trials.canaryAgeSeconds || 0);
    const canaryMinimumSeconds = Number(trials.canaryMinimumDurationSeconds || 86_400);
    const burnInReady = Boolean(trials.canaryStartedAt) && canaryAgeSeconds >= canaryMinimumSeconds;
    const clean = Number(trials.failed || 0) === 0 && packagedConflicts === 0
      && oracleConflicts === 0 && trials.canaryRegressionSloBreached !== true;
    const canaryReady = clean && cohortPassed >= 2 && cohortSkus >= 2
      && (!generated || (oracleComplete >= 2 && Number(trials.distinctOracleCohortSkus || 0) >= 2
        && oracleContributors >= 2 && oracleDevices >= 2));
    const trustedReady = clean && cohortPassed >= 5 && cohortSkus >= 3 && cohortLayouts >= 2
      && burnInReady && canaryPasses >= 3 && canarySkus >= 3 && canaryLayouts >= 2
      && (!generated || (oracleComplete >= 5 && Number(trials.distinctOracleCohortSkus || 0) >= 3
        && Number(trials.distinctOracleCohortLayouts || 0) >= 2 && canaryOraclePasses >= 3
        && canaryOracleContributors >= 3 && canaryOracleDevices >= 3
        && Number(trials.distinctCanaryOracleSkus || 0) >= 3
        && Number(trials.distinctCanaryOracleLayouts || 0) >= 2));
    const promotionReady = nextState === "shadow" || (nextState === "canary" && canaryReady)
      || (nextState === "trusted_read_only" && trustedReady);
    const promotionHint = nextState === "canary" && !promotionReady
      ? `Next gate: 2 contributor-deduplicated clean passes on 2 exact SKUs${generated ? ", with 2 tenant contributors and Chrome companions and every field confirmed by the packaged oracle" : ""}.`
      : nextState === "trusted_read_only" && !promotionReady
        ? `Next gate: a clean 24-hour canary, 5 deduplicated passes, and 3 canary passes on 3 exact SKUs and 2 layouts${generated ? ", including 3 tenant contributors and Chrome companions with every field oracle-complete" : ""}.`
        : "";
    return `<article class="community-evidence-row"><div class="card-top"><div><h3>${escapeHtml(retailerName(recipe.retailerId))} · ${escapeHtml(recipe.recipeVersion)}</h3><p>${Object.keys(recipe.fields || {}).length} fields (${escapeHtml(fieldNames)}) · ${selectorCount} bounded selectors · minimum extension ${escapeHtml(recipe.minimumExtensionVersion)} · expires ${escapeHtml(relativeTime(recipe.expiresAt))}</p></div><span class="tag ${kind}">${escapeHtml(String(recipe.lifecycleState).replaceAll("_", " "))}</span></div><div class="card-meta">${generated ? `<span class="tag warning">worker-generated candidate</span><span class="tag ${oracleComplete ? "good" : "warning"}">${oracleComplete} deduplicated oracle passes</span><span class="tag ${oracleContributors >= 2 ? "good" : "warning"}">${oracleContributors} tenant contributors</span><span class="tag">public anti-Sybil quorum pending</span>` : ""}<span class="tag">${cohortPassed} deduplicated passes</span><span class="tag ${Number(trials.failed || 0) ? "bad" : ""}">${Number(trials.failed || 0)} raw failures</span><span class="tag">${cohortSkus} SKUs</span><span class="tag">${cohortLayouts} layouts</span>${recipe.lifecycleState === "canary" ? `<span class="tag ${burnInReady ? "good" : "warning"}">${Math.floor(canaryAgeSeconds / 3_600)}h / 24h canary</span><span class="tag">25% deterministic cohort</span>` : ""}<span class="tag ${packagedConflicts ? "bad" : ""}">${packagedConflicts} packaged conflicts</span><span class="tag ${oracleConflicts ? "bad" : ""}">${oracleConflicts} oracle conflicts</span><span class="tag ${regionalSloKind}">Regional SLO: ${escapeHtml(regionalSloState.replaceAll("_", " "))}</span><span class="tag">${Number(regionalSlo.eligibleTrials || 0)} eligible trials</span><span class="tag">${Number(regionalSlo.distinctEligibleAccounts || 0)} eligible accounts · ${Number(regionalSlo.distinctEligibleRegions || 0)} regions</span><span class="tag">Fingerprint ${escapeHtml(String(recipe.recipeFingerprint).slice(0, 12))}</span><span class="tag ${needsResign ? "bad" : ""}">Root G${Number(recipe.trustManifestGeneration || 0)}</span>${recipe.rollbackRecipeId ? `<span class="tag">Rollback ${escapeHtml(String(recipe.rollbackRecipeId).slice(0, 12))}</span>` : ""}</div>${generated ? '<p class="fine-print">Compiled from thresholded structural landmarks only. Promotion counts only the latest result per tenant contributor, exact SKU, layout, and stage. Canary delivery is deterministic and bounded; packaged conflicts and a multi-contributor regression SLO auto-kill distribution. The regional conflict SLO separately requires fresh external account and Chrome companion eligibility across multiple coarse regions. Recipe field-fill and all mutation authority remain closed.</p>' : ""}${promotionHint ? `<p class="fine-print">${escapeHtml(promotionHint)}</p>` : ""}<div class="card-actions">${needsResign && trust.signingReady ? `<button class="button secondary" data-observer-resign="${escapeHtml(recipe.id)}" type="button">Re-sign at root G${generation}</button>` : ""}${nextState ? `<button class="button primary" data-observer-promote="${escapeHtml(recipe.id)}" data-observer-target="${escapeHtml(nextState)}" type="button" ${promotionReady ? "" : "disabled"}>Promote to ${escapeHtml(nextState.replaceAll("_", " "))}</button>` : ""}${recipe.lifecycleState !== "disabled" ? `<button class="button danger" data-observer-disable="${escapeHtml(recipe.id)}" type="button">Kill switch</button>` : ""}${recipe.rollbackRecipeId && recipe.lifecycleState !== "disabled" ? `<button class="button secondary" data-observer-rollback="${escapeHtml(recipe.id)}" type="button">Rollback</button>` : ""}</div>${recipe.disabledReason ? `<p class="identity-conflict">Disabled: ${escapeHtml(String(recipe.disabledReason).replaceAll("_", " "))}</p>` : ""}</article>`;
  }).join("") : empty("No declarative observer recipes. Bundled observer versions remain authoritative.");
  const contributorEligibility = registry.contributorEligibility || {};
  const conflictPolicy = registry.regionalConflictSlo || {};
  $("#observerConflictPolicy").textContent = `${Number(conflictPolicy.windowDays || 7)}-day checks use ${Number(conflictPolicy.minimumEligibleTrials || 10)} fresh trials across ${Number(conflictPolicy.minimumRegions || 2)} regions.`;
  $("#observerEligibilitySummary").innerHTML = `<span class="tag">${Number(contributorEligibility.externallyAttestedDeviceCount || 0)} eligible Chrome companions</span><span class="tag">${Number(contributorEligibility.distinctExternallyAttestedAccounts || 0)} eligible accounts</span><span class="tag">${Number(contributorEligibility.distinctExternallyAttestedRegions || 0)} coarse regions</span><span class="tag">TTL ${Number(contributorEligibility.maximumTtlHours || 24)}h</span><span class="tag warning">Local identities never count as public quorum</span><span class="tag">Mutation authority: never</span>`;
  const recoveryEvidence = Array.isArray(registry.recoveryEvidence) ? registry.recoveryEvidence : [];
  const recoveryRetention = registry.recoveryEvidenceRetention || {};
  $("#observerRecoveryPolicy").textContent = `Signed previews expire after ${Number(recoveryRetention.retentionDays || 90)} days; ${Number(recoveryRetention.receiptCount || 0).toLocaleString()} deletion receipt${Number(recoveryRetention.receiptCount || 0) === 1 ? " is" : "s are"} retained.`;
  $("#observerRecoveryList").innerHTML = recoveryEvidence.length ? recoveryEvidence.map((item) => {
    const value = item.valueKind === "cents"
      ? formatMoney(Number(item.normalizedValue), "USD")
      : item.valueKind === "boolean" ? (item.normalizedValue ? "actionable" : "not actionable")
        : String(item.normalizedValue || "").replaceAll("_", " ");
    const reviewState = String(item.reviewState || "unreviewed");
    const reviewKind = reviewState === "confirmed" ? "good" : reviewState === "rejected" ? "bad" : "warning";
    return `<article class="community-evidence-row"><div class="card-top"><div><h3>${escapeHtml(retailerName(item.retailerId))} · ${escapeHtml(item.retailerSku)} · ${escapeHtml(observerFieldName(item.field))}</h3><p>${escapeHtml(value)} · recipe ${escapeHtml(String(item.recipeId || "").slice(0, 12))} · ${escapeHtml(String(item.recipeStateAtTrial || "").replaceAll("_", " "))}</p></div><span class="tag warning">QUARANTINED</span></div><div class="card-meta"><span class="tag">Recipe + packaged oracle agreement</span><span class="tag ${reviewKind}">User review: ${escapeHtml(reviewState.replaceAll("_", " "))}</span><span class="tag">Review events ${Number(item.reviewSequence || 0)}</span><span class="tag">Contributor ${escapeHtml(item.contributorRef || "unknown")}</span><span class="tag ${item.contributorEligibilityState === "externally_attested" ? "good" : "warning"}">${item.contributorEligibilityState === "externally_attested" ? "External account + region eligible" : "Private unverified evidence"}</span>${item.regionRef ? `<span class="tag">Region ref ${escapeHtml(item.regionRef)}</span>` : ""}<span class="tag">Layout ${escapeHtml(String(item.layoutFingerprint || "").slice(0, 12))}</span><span class="tag">Observed ${escapeHtml(relativeTime(item.observedAt))}</span>${item.retentionExpiresAt ? `<span class="tag">Expires ${escapeHtml(relativeTime(item.retentionExpiresAt))}</span>` : ""}<span class="tag">Application: never</span></div><p class="fine-print">This normalized public commerce value is provenance evidence only. User review is append-only and revocable until bounded expiry; neither the value nor its review has changed the stored observation, catalog, qualification, purchase plan, job, or browser behavior.</p></article>`;
  }).join("") : empty("No oracle-agreed missing-field recovery evidence has entered quarantine.");
}

function renderAddQualification(retailerId) {
  const names = { target: "Target", walmart: "Walmart", amazon: "Amazon", bestbuy: "BestBuy" };
  const displayNames = { target: "Target", walmart: "Walmart", amazon: "Amazon", bestbuy: "Best Buy" };
  const identifiers = { target: "TCINs", walmart: "item IDs", amazon: "ASINs", bestbuy: "SKUs" };
  const name = names[retailerId];
  const displayName = displayNames[retailerId];
  const prefix = retailerId;
  const readiness = state.snapshot[retailerId === "bestbuy" ? "bestBuyQualification" : `${prefix}Qualification`];
  if (!readiness) {
    $(`#${prefix}QualificationSummary`).innerHTML = empty(`${displayName} qualification readiness is unavailable.`);
    $(`#${prefix}QualificationChecks`).innerHTML = "";
    return;
  }
  const qualified = readiness.addToCartQualified === true;
  const active = readiness.mutationAuthorized === true;
  const evidenceReady = readiness.qualificationEvidenceReady === true;
  const liveReady = readiness.liveEvidenceReady === true;
  const qualificationWarning = readiness.qualification?.warning || "none";
  const warningLabel = {
    expiring: "Qualification expires soon",
    expired: "Qualification expired",
    version_changed: "Runner changed · re-qualify"
  }[qualificationWarning];
  const label = warningLabel || (active ? "Guarded adds active" : qualified ? "Qualified · paused" : evidenceReady ? "Ready for explicit activation" : liveReady ? "Ready for no-click rehearsal" : "Collecting required evidence");
  const kind = ["expired", "version_changed"].includes(qualificationWarning)
    ? "bad"
    : qualificationWarning === "expiring"
      ? "warning"
      : active || qualified || evidenceReady || liveReady ? "good" : "warning";
  const qualificationExpiry = readiness.qualification?.expiresAt
    ? ` · qualification ${qualificationWarning === "expired" ? "expired" : "expires"} ${relativeTime(readiness.qualification.expiresAt)}`
    : "";
  $(`#${prefix}QualificationSummary`).innerHTML = `<div>
      <span class="tag ${kind}">${escapeHtml(label)}</span>
      <strong>${Number(readiness.observationCount || 0).toLocaleString()} current observations · ${Number(readiness.distinctSkuCount || 0).toLocaleString()} distinct ${identifiers[retailerId]}</strong>
    </div>
    <p>${escapeHtml(readiness.nextStep || "Collect read-only evidence with the Chrome companion.")}</p>
    <small>Observer ${escapeHtml(readiness.adapterVersion || "unknown")} · runner ${escapeHtml(readiness.addAdapterVersion || "unknown")} · ${Number(readiness.evidenceWindowDays || 0)}-day evidence window${escapeHtml(qualificationExpiry)}</small>`;
  $(`#${prefix}QualificationGate`).textContent = qualificationWarning === "expired"
    ? "Expired"
    : qualificationWarning === "version_changed"
      ? "Check again"
      : qualificationWarning === "expiring"
        ? "Expiring"
        : active ? "Active" : qualified ? "Paused" : evidenceReady ? "Ready" : "Closed";
  const activation = $(`#activate${name}AddButton`);
  activation.hidden = qualified;
  activation.disabled = !evidenceReady || Number(state.snapshot.counts.onlineDevices || 0) < 1;
  $(`#activate${name}AddHelp`).hidden = qualified;
  $(`#activate${name}AddHelp`).textContent = evidenceReady
    ? Number(state.snapshot.counts.onlineDevices || 0) < 1
      ? "Reconnect the Chrome companion before activation."
      : "One confirmation enables only the narrow add-to-cart scope above; the global pause remains available."
    : liveReady ? `Run the safe qualification rehearsal once from the extension on a ${displayName}-sold shipping offer.` : "Complete only the checks marked Required; optional coverage can arrive naturally.";
  $(`#${prefix}QualificationChecks`).innerHTML = (readiness.checks || []).map((check) => `<article class="qualification-check ${check.met ? "met" : "missing"} ${check.requiredForQualification === false ? "optional" : ""}">
    <span class="qualification-check-mark" aria-hidden="true">${check.met ? "✓" : "○"}</span>
    <div><h3>${escapeHtml(check.label)} · ${check.requiredForQualification === false ? "Optional" : "Required"}</h3><p>${escapeHtml(check.detail)}</p></div>
    <strong>${Number(check.observed || 0)}/${Number(check.required || 0)}</strong>
  </article>`).join("");
}

function renderQualifications() {
  renderAddQualification("target");
  renderAddQualification("walmart");
  renderAddQualification("amazon");
  renderAddQualification("bestbuy");
  setQualificationRetailer(state.qualificationRetailer);
  const policy = state.snapshot.futureMutationLanes;
  const labels = { prepare_checkout: "Prepare checkout", submit_order: "Submit order" };
  $("#futureMutationLaneList").innerHTML = policy?.lanes?.length ? policy.lanes.map((lane) => {
    const met = (lane.requirements || []).filter((requirement) => requirement.met).length;
    return `<article class="community-evidence-row"><div class="card-top"><div><h3>${escapeHtml(lane.retailerName)} · ${escapeHtml(labels[lane.lane] || lane.lane)}</h3><p>${met}/${(lane.requirements || []).length} prerequisites observed · no packaged adapter</p></div><span class="tag warning">CLOSED</span></div><details><summary>Qualification requirements</summary><div class="qualification-check-list">${(lane.requirements || []).map((requirement) => `<article class="qualification-check ${requirement.met ? "met" : "missing"}"><span class="qualification-check-mark" aria-hidden="true">${requirement.met ? "✓" : "○"}</span><div><h3>${escapeHtml(requirement.label)}</h3><p>${escapeHtml(requirement.detail)}</p></div></article>`).join("")}</div></details></article>`;
  }).join("") : empty("Future mutation-lane policy is unavailable; every lane remains closed.");
}

function renderLibrary() {
  const items = state.libraryItems;
  $("#libraryCount").textContent = `${items.length.toLocaleString()} of ${Number(state.libraryTotal || 0).toLocaleString()} matching listings`;
  $("#libraryMoreButton").hidden = items.length >= state.libraryTotal;
  $("#libraryList").innerHTML = items.length ? items.map((item) => `<article class="card catalog-row" data-store="${escapeHtml(String(item.retailerId || ""))}"><div class="card-top"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.retailerName)} · ${escapeHtml(item.retailerSku)}</p></div><span class="tag ${item.status === "in_stock" ? "good" : item.status === "preorder" ? "info" : "warning"}">${escapeHtml(String(item.status).replaceAll("_", " "))}</span></div><div class="card-meta"><span class="tag">MSRP ${formatMoney(item.msrpCents, item.currency)}</span><span class="tag ${item.executionSupported ? "good" : "warning"}">${item.executionSupported ? "Action mapping" : "Monitor only"}</span></div><details class="record-details"><summary>Technical details</summary><div class="card-meta"><span class="tag">${item.sourceMappingCount} source map</span><span class="tag">Variant ${escapeHtml(item.variantId)}</span><span class="tag">Listing ${escapeHtml(item.listingId)}</span></div><a class="canonical-link" href="${escapeHtml(item.canonicalUrl)}" target="_blank" rel="noreferrer">Open store listing ↗</a></details></article>`).join("") : empty("No matching store listings.");
}

function pricePolicyLabel(strategy) {
  const kind = strategy.pricePolicy.kind.replaceAll("_", " ");
  if (["absolute_max", "above_msrp"].includes(strategy.pricePolicy.kind)) return `${kind} · ${formatMoney(strategy.pricePolicy.maxPriceCents)}`;
  if (strategy.pricePolicy.kind === "slightly_above_msrp") return `${kind} · ${Number(strategy.pricePolicy.toleranceBps || 1000) / 100}%`;
  return kind;
}

function renderStrategies() {
  const strategies = state.snapshot.strategies || [];
  $("#strategyList").innerHTML = strategies.length ? strategies.map((strategy, index) => `<article class="strategy-row"><div class="strategy-rank">${index + 1}</div><div><h3>${escapeHtml(strategy.name)} ${strategy.enabled ? "" : "· Disabled"}</h3><p>${escapeHtml(pricePolicyLabel(strategy))} · ${escapeHtml(strategy.sellerPolicy.replaceAll("_", " "))} · ${escapeHtml(strategy.action.replaceAll("_", " "))} · qty ${escapeHtml(strategy.quantity)}</p><div class="card-meta"><span class="tag">${strategy.retailers.length ? escapeHtml(strategy.retailers.join(", ")) : "All stores"}</span><span class="tag">${strategy.sources.length ? escapeHtml(strategy.sources.join(", ")) : "All sources"}</span>${!strategy.includeKeywords ? '<span class="tag warning">Catchall</span>' : `<span class="tag">${escapeHtml(strategy.includeKeywords)}</span>`}</div></div><div class="strategy-actions"><button class="button secondary" data-strategy-move="up" data-strategy-id="${escapeHtml(strategy.id)}" type="button">↑</button><button class="button secondary" data-strategy-move="down" data-strategy-id="${escapeHtml(strategy.id)}" type="button">↓</button><button class="button secondary" data-strategy-edit="${escapeHtml(strategy.id)}" type="button">Edit</button><button class="button danger" data-strategy-delete="${escapeHtml(strategy.id)}" type="button">Delete</button></div></article>`).join("") : empty("No rules exist. Calls will be recorded without action.");
}

function renderMissions() {
  const missions = state.missionItems;
  $("#missionCount").textContent = `${missions.length.toLocaleString()} of ${Number(state.missionTotal || 0).toLocaleString()} matching plans`;
  $("#missionMoreButton").hidden = missions.length >= state.missionTotal;
  $("#missionList").innerHTML = missions.length ? missions.map((mission) => `<article class="card"><div class="card-top"><div><h3>${escapeHtml(mission.title)}</h3><p>${escapeHtml(mission.origin)} · created ${escapeHtml(relativeTime(mission.createdAt))}</p></div>${statusDot(mission.status === "active" ? "good" : "warning", plainLabel(mission.status))}</div><div class="card-meta"><span class="tag ${mission.status === "active" ? "good" : "warning"}">${escapeHtml(mission.status)}</span><span class="tag">${mission.targetCount} listing targets</span><span class="tag">${mission.enabledTargetCount} enabled</span><span class="tag">Goal ${mission.targetQuantity}</span><span class="tag">${mission.actionCeiling === "notify" ? "Notify me only" : "Add to cart"}</span><span class="tag">${mission.decisionMode === "purchase_intent" ? "Reviewed plan decides" : "Rule defaults decide"}</span></div><div class="card-actions"><button class="button secondary" data-mission-edit="${escapeHtml(mission.id)}" type="button">Edit plan</button></div></article>`).join("") : empty("No plans yet. A trusted live call can create one automatically.");
}

function renderAudit() {
  const items = state.auditItems;
  $("#auditCount").textContent = `${items.length.toLocaleString()} of ${Number(state.auditTotal || 0).toLocaleString()} matching events`;
  $("#auditMoreButton").hidden = items.length >= state.auditTotal;
  $("#auditList").innerHTML = items.length ? items.map((event) => `<article class="timeline-item">
    ${statusDot(event.reasonCode === "error" || String(event.reasonCode).includes("rejected") ? "bad" : "good", plainLabel(event.reasonCode))}
    <div><h3>${escapeHtml(String(event.eventType).replaceAll("_", " "))}</h3><p>${escapeHtml(event.message)}</p><div class="audit-event-meta"><span class="decision-pill">${escapeHtml(String(event.reasonCode).replaceAll("_", " "))}</span><span>${escapeHtml(event.actorKind === "device" ? "Chrome" : plainLabel(event.actorKind || "unknown"))}</span><button class="text-button" data-copy-correlation="${escapeHtml(event.correlationId)}" type="button">Copy id</button></div></div>
    <time>${escapeHtml(relativeTime(event.createdAt))}</time>
  </article>`).join("") : empty("No matching activity has been recorded.");
}

function renderNotifications() {
  const notifications = state.notificationItems;
  $("#notificationCount").textContent = `${notifications.length.toLocaleString()} of ${Number(state.notificationTotal || 0).toLocaleString()} matching notifications`;
  $("#notificationMoreButton").hidden = notifications.length >= state.notificationTotal;
  $("#notificationList").innerHTML = notifications.length ? notifications.map((notification) => {
    const kind = ["delivered", "clicked"].includes(notification.state) ? "good"
      : ["failed", "expired"].includes(notification.state) ? "bad" : "warning";
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(notification.title)}</h3><p>${escapeHtml(retailerName(notification.retailerId))} · ${escapeHtml(notification.retailerSku)}</p></div>${statusDot(kind, plainLabel(notification.state))}</div><div class="card-meta"><span class="tag ${kind}">${escapeHtml(String(notification.state).replaceAll("_", " "))}</span><span class="tag">${Number(notification.attempts || 0)} delivery attempt${Number(notification.attempts || 0) === 1 ? "" : "s"}</span>${notification.failureCode ? `<span class="tag bad">${escapeHtml(notification.failureCode.replaceAll("_", " "))}</span>` : ""}</div><p>${notification.deliveredAt ? `Delivered ${escapeHtml(relativeTime(notification.deliveredAt))}.` : `Created ${escapeHtml(relativeTime(notification.createdAt))}.`}</p></article>`;
  }).join("") : empty("No notification deliveries yet.");
}

function renderAttributionReceipts() {
  const receipts = state.attributionReceiptItems;
  $("#attributionReceiptCount").textContent = `${receipts.length.toLocaleString()} of ${Number(state.attributionReceiptTotal || 0).toLocaleString()} matching routes`;
  $("#attributionReceiptMoreButton").hidden = receipts.length >= state.attributionReceiptTotal;
  $("#attributionReceiptList").innerHTML = receipts.length ? receipts.map((receipt) => {
    const kind = receipt.outcome === "affiliate_route" ? "good"
      : receipt.outcome === "required_route_unavailable" ? "bad" : "warning";
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(receipt.title)}</h3><p>${escapeHtml(retailerName(receipt.retailerId))} · ${escapeHtml(receipt.retailerSku)}</p></div>${statusDot(kind, plainLabel(receipt.outcome))}</div><div class="card-meta"><span class="tag ${kind}">${escapeHtml(String(receipt.outcome).replaceAll("_", " "))}</span><span class="tag">${escapeHtml(String(receipt.provider).replaceAll("_", " "))}</span><span class="tag">${escapeHtml(String(receipt.reasonCode).replaceAll("_", " "))}</span></div><a class="canonical-link" href="${escapeHtml(receipt.routeUrl)}" target="_blank" rel="noreferrer">Open recorded route</a></article>`;
  }).join("") : empty("No attribution receipts yet.");
}

function renderAttributionPolicies() {
  const container = $("#attributionPolicyEditors");
  if (!container) return;
  const policies = state.snapshot.attributionPolicies || [];
  const providerLabel = (policy) => policy.provider === "howl" ? `Howl${policy.howlStoreName ? ` · ${policy.howlStoreName}` : ""}`
    : policy.provider === "amazon_associates" ? "Amazon Associates" : "Canonical store URL";
  container.innerHTML = policies.map((policy) => `<tr data-attribution-retailer="${escapeHtml(policy.retailerId)}">
    <td><strong>${escapeHtml(policy.retailerName)}</strong><small>${escapeHtml(policy.validationReason)}</small></td>
    <td>${policy.enabled ? "Affiliate" : "Canonical"}</td>
    <td>${escapeHtml(providerLabel(policy))}</td>
    <td><span class="plain-state ${policy.valid ? "" : "danger"}">${policy.valid ? "Valid" : "Needs correction"}</span></td>
    <td><button class="button secondary" data-attribution-edit="${escapeHtml(policy.retailerId)}" type="button">Edit</button></td>
  </tr>`).join("");
}

function updateAttributionPolicyFields() {
  const form = $("#attributionPolicyForm");
  const provider = form.elements.provider.value;
  $$('[data-attribution-provider-field]', form).forEach((field) => {
    field.hidden = field.dataset.attributionProviderField !== provider;
  });
}

function openAttributionPolicy(retailerId) {
  const policy = (state.snapshot.attributionPolicies || []).find((item) => item.retailerId === retailerId);
  if (!policy) throw new Error("Refresh before editing this store policy.");
  state.editingAttributionRetailerId = policy.retailerId;
  const form = $("#attributionPolicyForm");
  form.reset();
  form.elements.retailerId.value = policy.retailerId;
  form.elements.enabled.checked = policy.enabled === true;
  form.elements.provider.value = policy.provider;
  form.elements.publisherSlug.value = policy.publisherSlug || "";
  form.elements.articleBaseUrl.value = policy.articleBaseUrl || "";
  form.elements.associateTag.value = policy.associateTag || "";
  const howlOption = form.elements.provider.querySelector('option[value="howl"]');
  howlOption.disabled = policy.howlEligible !== true;
  howlOption.textContent = policy.howlEligible ? `Howl · ${policy.howlStoreName}` : "Howl · unavailable for this store";
  $("#attributionPolicyDialogTitle").textContent = policy.retailerName;
  $("#attributionPolicyEligibility").textContent = policy.validationReason;
  updateAttributionPolicyFields();
  $("#attributionPolicyDialog").showModal();
}

function renderHowlStoreDirectory() {
  const body = $("#howlStoreDirectory");
  if (!body) return;
  const stores = state.affiliateRouting?.stores || [];
  const query = state.howlStoreQuery.trim().toLocaleLowerCase("en-US");
  const visible = stores.filter((store) => !query
    || String(store.storeName || "").toLocaleLowerCase("en-US").includes(query)
    || String(store.website || "").toLocaleLowerCase("en-US").includes(query));
  const rendered = state.howlStoreExpanded ? visible : visible.slice(0, 25);
  $("#howlStoreCount").textContent = `${rendered.length.toLocaleString()} of ${visible.length.toLocaleString()} shown · ${stores.length.toLocaleString()} total`;
  body.innerHTML = rendered.length ? rendered.map((store) => `<tr>
    <td><strong>${escapeHtml(store.storeName)}</strong></td>
    <td>${escapeHtml(store.website)}</td>
    <td><span class="tag good">Howl eligible</span></td>
  </tr>`).join("") : `<tr><td class="affiliate-directory-empty" colspan="3">No Howl stores match this search.</td></tr>`;
  const showAll = $("#howlStoreShowAll");
  showAll.hidden = visible.length <= 25;
  showAll.textContent = state.howlStoreExpanded ? "Show first 25" : `Show all ${visible.length.toLocaleString()}`;
  showAll.setAttribute("aria-expanded", String(state.howlStoreExpanded));
}

function renderSettings() {
  const form = $("#settingsForm");
  if (!form || state.settingsDirty) return;
  const settings = state.snapshot.settings;
  form.elements.dedupeWindowSeconds.value = settings.dedupeWindowSeconds;
  form.elements.taxPercent.value = (Number(settings.taxBps || 0) / 100).toFixed(2).replace(/\.00$/, "");
  form.elements.affiliateMode.value = settings.affiliateMode;
  for (const retailer of ["target", "walmart", "amazon", "bestbuy"]) {
    form.elements[`${retailer}Allowance`].value = (Number(settings.storeAllowancesCents?.[retailer] || 0) / 100).toFixed(2);
  }
}

function renderJobs() {
  const jobs = state.jobItems;
  $("#jobCount").textContent = `${jobs.length.toLocaleString()} of ${Number(state.jobTotal || 0).toLocaleString()} matching actions`;
  $("#jobMoreButton").hidden = jobs.length >= state.jobTotal;
  $("#jobList").innerHTML = jobs.length ? jobs.map((job) => {
    const terminal = ["confirmed", "expired", "cancelled", "offer_rejected"].includes(job.state);
    const needsReview = ["manual_review", "submission_uncertain"].includes(job.state);
    const kind = job.state === "confirmed" ? "good" : needsReview ? "bad" : terminal || job.state === "shadow_ready" ? "warning" : "good";
    const laneActive = job.retailerId === "target"
      ? state.snapshot.capabilities.targetAddMutationAuthorized === true
      : job.retailerId === "walmart"
        ? state.snapshot.capabilities.walmartAddMutationAuthorized === true
      : job.retailerId === "amazon"
          ? state.snapshot.capabilities.amazonAddMutationAuthorized === true
          : job.retailerId === "bestbuy"
            ? state.snapshot.capabilities.bestBuyAddMutationAuthorized === true
            : false;
    const displayName = retailerName(job.retailerId);
    const note = ["target", "walmart", "amazon", "bestbuy"].includes(job.retailerId) && job.action === "add_to_cart" && laneActive
      ? `Chrome will revalidate the exact live ${displayName} offer before any click.`
      : "This action remains recorded until a qualified Chrome companion can safely handle its reviewed scope.";
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(job.title)}</h3><p>${escapeHtml(displayName)} · ${escapeHtml(job.retailerSku)}</p></div>${statusDot(kind, plainLabel(job.state))}</div><div class="card-meta"><span class="tag ${kind}">${escapeHtml(String(job.state).replaceAll("_", " "))}</span><span class="tag">${escapeHtml(String(job.action).replaceAll("_", " "))}</span><span class="tag">Qty ${job.quantity}</span><span class="tag">Unit cap ${formatMoney(job.maxUnitPriceCents, job.currency)}</span><span class="tag">Total cap ${formatMoney(job.maxOrderTotalCents, job.currency)}</span><span class="tag">${escapeHtml(job.sellerPolicy.replaceAll("_", " "))}</span><span class="tag">${escapeHtml(String(job.attributionProvider || "canonical").replaceAll("_", " "))}</span></div><p>Expires ${escapeHtml(relativeTime(job.expiresAt))}. ${escapeHtml(note)}</p>${needsReview ? `<div class="card-actions"><button class="button secondary" data-review-resolution="cancelled" data-job-id="${escapeHtml(job.id)}" type="button">Verified no purchase</button><button class="button primary" data-review-resolution="confirmed" data-job-id="${escapeHtml(job.id)}" type="button">Verified success</button></div>` : ""}</article>`;
  }).join("") : empty("No action jobs yet.");
}

function catalogProposalCards(proposals) {
  return proposals.map((proposal) => `<article class="card" data-catalog-proposal="${escapeHtml(proposal.id)}">
    <div class="card-top"><div><h3>${escapeHtml(proposal.payload?.title || "Catalog listing change")}</h3><p>${escapeHtml(retailerName(proposal.retailerId))} · ${escapeHtml(proposal.retailerSku)} · proposed by ${escapeHtml(proposal.proposerDisplayName || "Unknown user")}</p></div><span class="tag warning">Pending review</span></div>
    <div class="card-meta"><span class="tag">${formatMoney(proposal.payload?.msrpCents, proposal.payload?.currency || "USD")}</span><span class="tag">Submitted ${escapeHtml(relativeTime(proposal.createdAt))}</span></div>
    <details class="catalog-proposal-details"><summary>Details</summary><p>${escapeHtml(proposal.payload?.canonicalUrl || "No store URL")}</p><p>Payload fingerprint ${escapeHtml(proposal.payloadHash || "Unavailable")}</p></details>
    <div class="card-actions"><button class="button secondary" data-catalog-reject="${escapeHtml(proposal.id)}" type="button">Reject</button><button class="button primary" data-catalog-approve="${escapeHtml(proposal.id)}" type="button">Approve exact listing</button></div>
  </article>`).join("");
}

function renderCatalogGovernance() {
  const governance = state.snapshot.catalogGovernance || {};
  const proposals = governance.pending || [];
  const panel = $("#catalogGovernancePanel");
  panel.hidden = governance.reviewCapable !== true && proposals.length === 0;
  if (panel.hidden) return;
  $("#catalogGovernanceGate").textContent = proposals.length ? `${proposals.length} pending` : "OK";
  $("#catalogReviewSummary").innerHTML = `<span>${proposals.length.toLocaleString()} pending</span><button class="text-button" data-open-view="catalog-reviews" type="button">Open Catalog reviews</button>`;
}

function renderCatalogIdentityOperations() {
  const governance = state.snapshot.catalogGovernance || {};
  const operations = governance.identityOperations || [];
  $("#catalogIdentityHeading").hidden = governance.identityProposalCapable !== true && !operations.length;
  $("#proposeCatalogMergeButton").hidden = governance.identityProposalCapable !== true;
  $("#proposeCatalogSplitButton").hidden = governance.identityProposalCapable !== true;
  $("#catalogIdentityOperationList").innerHTML = operations.length ? operations.map((operation) => {
    const payload = operation.payload || {};
    const kind = String(operation.kind || "unknown").replaceAll("_", " ");
    const subject = operation.kind === "merge_variants"
      ? `${payload.sourceVariantId || "source"} → ${payload.targetVariantId || "target"}`
      : operation.kind === "split_variant"
        ? `${payload.sourceVariantId || "variant"} · ${(payload.listingIds || []).length} listing split`
        : `Compensate ${payload.reversedOperationId || "operation"}`;
    const statusKind = operation.status === "applied" ? "good" : operation.status === "rejected" ? "bad" : "warning";
    const canRollback = governance.identityProposalCapable === true
      && operation.status === "applied" && operation.kind !== "rollback" && !operation.revertedByOperationId;
    return `<article class="card">
      <div class="card-top"><div><h3>${escapeHtml(kind)}</h3><p>${escapeHtml(subject)}</p></div><span class="tag ${statusKind}">${escapeHtml(operation.status)}</span></div>
      <div class="card-meta"><span class="tag">${escapeHtml(payload.reasonCode || "no reason")}</span><span class="tag">base ${escapeHtml(String(operation.baseStateHash || "").slice(0, 12))}</span>${operation.requiresDistinctApprover ? '<span class="tag warning">Independent approver required</span>' : '<span class="tag">Single curator review</span>'}${operation.revertedByOperationId ? '<span class="tag warning">Compensated</span>' : ""}</div>
      <p>Proposed by ${escapeHtml(operation.requestedByDisplayName || "Unknown user")} ${escapeHtml(relativeTime(operation.createdAt))}.${operation.reviewedByActorId ? ` Reviewed by ${escapeHtml(operation.reviewedByDisplayName || "Unknown user")}.` : ""}</p>
      <div class="card-actions">${operation.status === "pending" && governance.identityApprovalCapable === true ? `<button class="button secondary" data-catalog-identity-reject="${escapeHtml(operation.id)}" type="button">Reject</button><button class="button primary" data-catalog-identity-approve="${escapeHtml(operation.id)}" type="button">Review and apply</button>` : ""}${canRollback ? `<button class="button secondary" data-catalog-identity-rollback="${escapeHtml(operation.id)}" type="button">Propose rollback</button>` : ""}</div>
    </article>`;
  }).join("") : empty("No catalog identity operations have been proposed.");
}

function renderCatalogReviews() {
  const governance = state.snapshot.catalogGovernance || {};
  const proposals = governance.pending || [];
  $("#inboxCatalogReviewGate").textContent = proposals.length ? `${proposals.length} waiting` : "None waiting";
  $("#inboxCatalogReviewList").innerHTML = governance.reviewCapable !== true
    ? empty("Permission to review catalog suggestions is required.")
    : proposals.length ? catalogProposalCards(proposals) : empty("No catalog suggestions are waiting for review.");
}

function authorizationRoleName(roleId) {
  return state.authorizationRoles.find((role) => role.id === roleId)?.displayName
    || (roleId === "yoink_user" ? "Shopper" : plainLabel(roleId));
}

function renderAdminUserDetail() {
  const detail = state.selectedAdminUser;
  if (!detail?.user) return;
  const authorization = state.snapshot.authorization || {};
  const user = detail.user;
  const active = user.status === "active";
  const canSupport = authorization.userSupportEnabled === true;
  const canManage = authorization.userManagementEnabled === true;
  const canGrant = authorization.roleAdministrationEnabled === true;
  const actionsPaused = detail.actionSettings?.paused !== false;
  $("#adminUserDialogStatus").textContent = active ? "Active user" : "Disabled user";
  $("#adminUserDialogTitle").textContent = user.displayName;
  $("#adminUserDialogSummary").textContent = `${user.planCount} plan${user.planCount === 1 ? "" : "s"} · ${user.onlineDevices} Chrome companion${user.onlineDevices === 1 ? "" : "s"} online`;
  const grantableRoles = state.authorizationRoles.filter((role) => !user.activeRoles.includes(role.id));
  $("#adminUserSupportActions").innerHTML = [
    canSupport ? `<button class="button primary" data-admin-user-pairing type="button" ${active ? "" : "disabled"}>Issue pairing code</button>` : "",
    canSupport ? `<button class="button secondary" data-admin-user-pause type="button" ${active ? "" : "disabled"}>${actionsPaused ? "Resume actions" : "Pause actions"}</button>` : "",
    canGrant && grantableRoles.length ? `<select id="adminUserRoleSelection" aria-label="Role to grant">${grantableRoles.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.displayName)}</option>`).join("")}</select><button class="button secondary" data-admin-user-role-grant type="button">Grant role</button>` : "",
    canManage ? `<button class="button ${active ? "danger" : "secondary"}" data-admin-user-status="${active ? "disabled" : "active"}" type="button">${active ? "Disable user" : "Enable user"}</button>` : ""
  ].join("");
  const pairing = state.adminUserPairing;
  const pairingPanel = $("#adminUserPairing");
  pairingPanel.hidden = !pairing;
  pairingPanel.innerHTML = pairing
    ? `<span>One-time code · expires ${escapeHtml(relativeTime(pairing.expiresAt))}</span><strong>${escapeHtml(pairing.code)}</strong><button class="text-button" data-copy-admin-pairing type="button">Copy</button>`
    : "";
  $$("[data-admin-user-tab]").forEach((button) => {
    const selected = button.dataset.adminUserTab === state.adminUserTab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-current", selected ? "page" : "false");
  });
  const currency = detail.spend?.currency || "USD";
  const spend = `<div class="admin-user-spend"><span class="tag">Committed ${escapeHtml(formatMoney(detail.spend?.committedCents || 0, currency))}</span><span class="tag">Reserved ${escapeHtml(formatMoney(detail.spend?.activeReservedCents || 0, currency))}</span><span class="tag">Per order ${escapeHtml(formatMoney(detail.spend?.perOrderCapCents, currency))}</span></div>`;
  let body = "";
  if (state.adminUserTab === "plans") {
    body = detail.plans.length ? detail.plans.map((plan) => `<article class="admin-user-detail-row"><div><h3>${escapeHtml(plan.title)}</h3><p>${plan.fulfilledQuantity} of ${plan.targetQuantity} fulfilled</p></div><span>${escapeHtml(plainLabel(plan.status))}<br>${escapeHtml(relativeTime(plan.updatedAt))}</span></article>`).join("") : empty("No purchase plans yet.");
  } else if (state.adminUserTab === "actions") {
    body = detail.actions.length ? detail.actions.map((action) => `<article class="admin-user-detail-row"><div><h3>${escapeHtml(action.title)}</h3><p>${escapeHtml(retailerName(action.retailerId))} · ${escapeHtml(plainLabel(action.action))} · ${escapeHtml(formatMoney(action.maximumCents, action.currency))}</p></div><span>${escapeHtml(plainLabel(action.state))}<br>${escapeHtml(relativeTime(action.updatedAt))}</span></article>`).join("") : empty("No store actions yet.");
  } else if (state.adminUserTab === "devices") {
    body = detail.devices.length ? detail.devices.map((device) => `<article class="admin-user-detail-row"><div><h3>${escapeHtml(device.name)}</h3><p>Extension ${escapeHtml(device.extensionVersion || "unknown")} · seen ${escapeHtml(relativeTime(device.lastSeenAt))}</p></div><span class="${device.online ? "tag good" : "tag"}">${device.online ? "Online" : escapeHtml(plainLabel(device.status))}</span></article>`).join("") : empty("No Chrome companions paired.");
  } else {
    body = detail.reviews.length ? detail.reviews.map((review) => `<article class="admin-user-detail-row"><div><h3>${escapeHtml(review.title)}</h3><p>${escapeHtml(retailerName(review.retailerId))} · ${escapeHtml(review.retailerSku)} · ${escapeHtml(plainLabel(review.kind))}</p></div><span>${escapeHtml(plainLabel(review.status))}<br>${escapeHtml(relativeTime(review.createdAt))}</span></article>`).join("") : empty("No catalog reviews submitted.");
  }
  $("#adminUserDetailContent").innerHTML = `${spend}<div class="admin-user-detail-list">${body}</div>`;
}

function renderAuthorization() {
  const internalServices = state.snapshot.authorization?.internalServices || {};
  const serviceDefinitions = internalServices.definitions || [];
  const serviceGate = $("#internalServiceGate");
  serviceGate.textContent = Number(internalServices.configuredServiceCount || 0) > 0
    ? `${Number(internalServices.configuredServiceCount || 0)} scoped`
    : "Deny all";
  serviceGate.className = "plain-state";
  $("#internalServiceList").innerHTML = serviceDefinitions.length
    ? serviceDefinitions.map((definition) => `<article class="card"><div class="card-top"><div><h3>${escapeHtml(definition.actorRef)}</h3><p>Deployment-owned workload reference</p></div><span class="tag good">${escapeHtml(definition.capability)}</span></div><p>One internal capability. This identity cannot provision users, attest eligibility, or process delivery unless that capability is shown.</p></article>`).join("")
    : empty("No internal workload identities are configured. Every hosted service actor is denied by default.");
  const authorization = state.snapshot.authorization || {};
  const canReadUsers = authorization.userReadEnabled === true || authorization.roleAdministrationEnabled === true;
  const canManageUsers = authorization.userManagementEnabled === true;
  const canAdministerRoles = authorization.roleAdministrationEnabled === true;
  $("#authorizationGate").textContent = canReadUsers ? `${state.authorizationUsers.length} users` : "No access";
  $("#createAdminUserButton").hidden = !canManageUsers;
  $("#adminUserSearch").disabled = !canReadUsers;
  $("#authorizationRolesPanel").hidden = !canAdministerRoles;
  if (!canReadUsers) {
    $("#authorizationUserList").innerHTML = empty("Permission to view tenant users is required.");
    $("#authorizationRoleList").innerHTML = "";
    return;
  }
  $("#authorizationUserList").innerHTML = state.authorizationUsers.length ? state.authorizationUsers.map((user) => `<button class="admin-user-row" data-admin-user-open="${escapeHtml(user.id)}" type="button"><div><h3>${escapeHtml(user.displayName)}</h3><p>${escapeHtml(user.activeRoles.map(authorizationRoleName).join(" · ") || "Shopper")} · ${escapeHtml(user.status === "active" ? "Active" : "Disabled")}</p></div><div class="admin-user-row-meta"><strong>${user.planCount} plan${user.planCount === 1 ? "" : "s"}</strong>${user.onlineDevices} Chrome companion${user.onlineDevices === 1 ? "" : "s"} online · ${escapeHtml(relativeTime(user.lastActivityAt))}</div><span class="admin-user-row-arrow" aria-hidden="true">›</span></button>`).join("") : `<div class="empty">${state.adminUserQuery ? "No users match this search." : canManageUsers ? 'No users yet. <button class="text-button" data-admin-user-create type="button">Create the first user</button>' : "No users exist in this tenant."}</div>`;
  $("#authorizationRoleList").innerHTML = state.authorizationRoles.map((role) => `<article class="card"><div class="card-top"><div><h3>${escapeHtml(role.displayName)}</h3><p>${escapeHtml(role.description)}</p></div><span class="tag">${role.permissions.length} permissions</span></div><div class="card-meta">${role.permissions.map((permission) => `<span class="tag">${escapeHtml(permission)}</span>`).join("")}</div></article>`).join("");
  if (state.selectedAdminUser && $("#adminUserDialog").hasAttribute("open")) renderAdminUserDetail();
}

function renderOperatorAlerts() {
  const alerts = state.snapshot.operatorAlerts || {};
  const counts = alerts.counts || {};
  const connectorModel = alerts.connectors || {};
  const connectors = connectorModel.connectors || [];
  const connectorHealth = connectorModel.health || [];
  const healthByConnector = new Map(connectorHealth.map((health) => [health.connectorId, health]));
  const connectorDeliveries = connectorModel.deliveries || [];
  const incidents = alerts.incidents || [];
  const rules = alerts.rules || [];
  const deliveries = alerts.deliveries || [];
  const activeCount = Number(counts.openOperatorAlerts || 0) + Number(counts.acknowledgedOperatorAlerts || 0);
  const criticalCount = Number(counts.criticalOperatorAlerts || 0);
  const gate = $("#operatorAlertGate");
  gate.textContent = activeCount ? "Attention" : "OK";
  gate.classList.toggle("danger", activeCount > 0);
  $("#operatorAlertSummary").textContent = activeCount
    ? `${activeCount.toLocaleString()} active · ${criticalCount.toLocaleString()} critical`
    : "No active incidents.";
  const addButton = $("#addOperatorAlertRuleButton");
  addButton.disabled = alerts.canManage !== true;
  addButton.title = alerts.canManage === true ? "Create a bounded operator alert rule." : "Permission alert.manage is required.";
  const addConnectorButton = $("#addOperatorAlertConnectorButton");
  addConnectorButton.disabled = alerts.canManage !== true;
  addConnectorButton.title = alerts.canManage === true ? "Bind a deployment-owned connector reference." : "Permission alert.manage is required.";
  $("#operatorAlertIncidentList").innerHTML = incidents.length ? incidents.map((incident) => {
    const severityKind = ["critical", "error"].includes(incident.severity) ? "bad" : incident.severity === "warning" ? "warning" : "good";
    const statusKind = incident.status === "resolved" ? "good" : incident.status === "acknowledged" ? "warning" : severityKind;
    const actions = alerts.canManage === true && incident.status !== "resolved"
      ? `<div class="card-actions">${incident.status === "open" ? `<button class="button secondary" data-operator-alert-acknowledge="${escapeHtml(incident.id)}" type="button">Acknowledge</button>` : ""}<button class="button primary" data-operator-alert-resolve="${escapeHtml(incident.id)}" type="button">Resolve</button></div>`
      : "";
    return `<article class="card operator-alert-card ${escapeHtml(statusKind)}">
      <div class="card-top"><div><h3>${escapeHtml(incident.title)}</h3><p>${escapeHtml(incident.summary)}</p></div><span class="tag ${statusKind}">${escapeHtml(incident.status)}</span></div>
      <div class="card-meta"><span class="tag ${severityKind}">${escapeHtml(incident.severity)}</span><span class="tag">${escapeHtml(retailerName(incident.retailerId))}</span><span class="tag">${escapeHtml(String(incident.operation).replaceAll("_", " "))}</span><span class="tag">${Number(incident.occurrenceCount || 0).toLocaleString()} occurrences</span><span class="tag">${Number(incident.affectedEntityCount || 0).toLocaleString()} products</span>${incident.escalationDue ? '<span class="tag bad">Escalation due</span>' : incident.escalatedAt ? '<span class="tag bad">Escalated</span>' : ""}</div>
      <p class="operator-alert-detail">Reason ${escapeHtml(String(incident.reasonCode).replaceAll("_", " "))} · stage ${escapeHtml(String(incident.failureStage).replaceAll("_", " "))} · layout ${escapeHtml(String(incident.layoutFingerprint).slice(0, 12))} · cohort ${escapeHtml(incident.sourceCohort)} · last seen ${escapeHtml(relativeTime(incident.lastSeenAt))}</p>
      ${actions}
    </article>`;
  }).join("") : empty("No operator alert incidents have been recorded. Sanitized extension failures will appear here immediately when a matching rule is enabled.");
  $("#operatorAlertRuleList").innerHTML = rules.length ? rules.map((rule) => `<article class="card">
    <div class="card-top"><div><h3>${escapeHtml(rule.name)}</h3><p>${escapeHtml(rule.eventFamily.replaceAll("_", " "))} · ${rule.retailerScope === "*" ? "all stores" : escapeHtml(retailerName(rule.retailerScope))} · ${rule.operationScope === "*" ? "all operations" : escapeHtml(rule.operationScope.replaceAll("_", " "))}</p></div><span class="tag ${rule.enabled ? "good" : "warning"}">${rule.enabled ? "enabled" : "disabled"}</span></div>
    <div class="card-meta"><span class="tag ${["critical", "error"].includes(rule.severity) ? "bad" : rule.severity === "warning" ? "warning" : "good"}">${escapeHtml(rule.severity)}</span><span class="tag">after ${Number(rule.minimumOccurrences)} occurrence${Number(rule.minimumOccurrences) === 1 ? "" : "s"}</span><span class="tag">dedupe ${Number(rule.dedupeWindowSeconds)}s</span><span class="tag">${Number(rule.escalationAfterSeconds) ? `escalate ${Number(rule.escalationAfterSeconds)}s` : "no escalation"}</span>${(rule.routes || []).map((route) => `<span class="tag">${escapeHtml(String(route).replaceAll("_", " "))}</span>`).join("")}</div>
    ${alerts.canManage === true ? `<div class="card-actions"><button class="button secondary" data-operator-alert-rule-edit="${escapeHtml(rule.id)}" type="button">Edit rule</button></div>` : ""}
  </article>`).join("") : empty("No alert rules are configured.");
  $("#operatorAlertConnectorList").innerHTML = connectors.length ? connectors.map((connector) => {
    const health = healthByConnector.get(connector.id) || {};
    const status = health.status || (!connector.enabled ? "disabled" : connector.runtimeBound ? "idle" : "unbound");
    const kind = status === "healthy" ? "good" : ["critical", "unbound"].includes(status) ? "bad" : "warning";
    const successRate = health.deliverySuccessRatePercent === null || health.deliverySuccessRatePercent === undefined
      ? "no 24h outcomes"
      : `${Number(health.deliverySuccessRatePercent).toLocaleString()}% accepted / 24h`;
    return `<article class="card operator-alert-card ${kind}">
      <div class="card-top"><div><h3>${escapeHtml(connector.name)}</h3><p>${escapeHtml(String(connector.kind).replaceAll("_", " "))} · reference ${escapeHtml(connector.endpointReference)}</p></div><span class="tag ${kind}">${escapeHtml(status)}</span></div>
      <div class="card-meta"><span class="tag">${escapeHtml(connector.minimumSeverity)} and above</span><span class="tag">${Number(health.activeDeliveries || 0)} active</span><span class="tag ${Number(health.unresolvedDeadLetters || 0) ? "bad" : ""}">${Number(health.unresolvedDeadLetters || 0)} dead letters</span><span class="tag">${escapeHtml(successRate)}</span><span class="tag">${Number(health.deliverySloSeconds || 300) / 60}m SLO</span><span class="tag">no URL stored</span><span class="tag">no secret stored</span><span>${escapeHtml(relativeTime(connector.updatedAt))}</span></div>
      ${alerts.canManage === true ? `<div class="card-actions"><button class="button secondary" data-operator-alert-connector-edit="${escapeHtml(connector.id)}" type="button">Edit connector</button></div>` : ""}
    </article>`;
  }).join("") : empty("No external connector is configured. Add one only after its opaque endpoint reference exists in the reviewed deployment registry.");
  const incidentNames = new Map(incidents.map((incident) => [incident.id, incident.title]));
  $("#operatorAlertDeliveryList").innerHTML = deliveries.length ? deliveries.slice(0, 100).map((delivery) => {
    const kind = delivery.deliveryState === "delivered" ? "good" : delivery.deliveryState === "dead_letter" ? "bad" : "warning";
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(incidentNames.get(delivery.incidentId) || "Operator alert")}</h3><p>${escapeHtml(String(delivery.eventType).replaceAll("_", " "))} routed to ${escapeHtml(String(delivery.routeKind).replaceAll("_", " "))}</p></div><span class="tag ${kind}">${escapeHtml(String(delivery.deliveryState).replaceAll("_", " "))}</span></div><div class="card-meta"><span class="tag">operational aggregate</span><span>${escapeHtml(relativeTime(delivery.createdAt))}</span></div></article>`;
  }).join("") : empty("No operator alert delivery receipts exist yet.");
  $("#operatorAlertConnectorDeliveryList").innerHTML = connectorDeliveries.length ? connectorDeliveries.slice(0, 100).map((delivery) => {
    const kind = delivery.deliveryState === "delivered" ? "good" : delivery.deliveryState === "dead_letter" ? "bad" : "warning";
    const replayAction = alerts.canManage === true && delivery.replayEligible === true
      ? `<div class="card-actions"><button class="button secondary" data-operator-alert-connector-retry="${escapeHtml(delivery.id)}" type="button">Replay once</button></div>`
      : "";
    const replayLimit = Number(delivery.maximumManualReplays || 3);
    const replayCount = Number(delivery.manualReplayCount || 0);
    const replayStatus = delivery.deliveryState === "dead_letter" && delivery.replayEligible !== true
      ? `<span class="tag warning">${escapeHtml(operationalLabel(delivery.replayIneligibilityReason || "replay unavailable"))}</span>`
      : "";
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(delivery.connectorName)}</h3><p>${escapeHtml(String(delivery.eventType).replaceAll("_", " "))} · reference ${escapeHtml(delivery.endpointReference)}</p></div><span class="tag ${kind}">${escapeHtml(String(delivery.deliveryState).replaceAll("_", " "))}</span></div><div class="card-meta"><span class="tag">attempt ${Number(delivery.attemptCount || 0)}</span><span class="tag">replays ${replayCount}/${replayLimit}</span>${Number(delivery.lastHttpStatus || 0) ? `<span class="tag">HTTP ${Number(delivery.lastHttpStatus)}</span>` : ""}${delivery.lastErrorCode ? `<span class="tag bad">${escapeHtml(operationalLabel(delivery.lastErrorCode))}</span>` : ""}${replayStatus}<span class="tag">operational aggregate</span><span>${escapeHtml(relativeTime(delivery.updatedAt))}</span></div>${replayAction}</article>`;
  }).join("") : empty("No external connector delivery has been queued.");
}

function operationalLabel(value) {
  return String(value || "unknown").replaceAll(".", " / ").replaceAll("_", " ");
}

function renderOperationalTelemetry() {
  const telemetry = state.operationalTelemetry;
  if (!telemetry) {
    $("#operationalMetricGrid").innerHTML = empty("Operational telemetry is loading.");
    $("#operationalRouteList").innerHTML = "";
    $("#operationalErrorCodeList").innerHTML = "";
    $("#operationalErrorList").innerHTML = "";
    return;
  }
  const totals = telemetry.totals || {};
  const errors = Number(totals.clientErrors || 0) + Number(totals.serverErrors || 0);
  const gate = $("#operationalGate");
  gate.textContent = Number(totals.serverErrors || 0) ? `${Number(totals.serverErrors).toLocaleString()} server errors` : errors ? `${errors.toLocaleString()} errors` : "OK";
  gate.classList.toggle("danger", Number(totals.serverErrors || 0) > 0);
  $("#operationalRetention").textContent = `${Number(telemetry.retentionDays || 0)}-day automatic retention · ${String(telemetry.privacyClassification || "operational aggregate").replaceAll("_", " ")}`;
  const latencyLabels = {
    no_data: "No sample",
    lt_100: "Under 100 ms",
    lt_500: "Under 500 ms",
    lt_2000: "Under 2 s",
    gte_2000: "2 s or more"
  };
  const metrics = [
    ["Requests", totals.requests, `${Number(totals.successes || 0).toLocaleString()} successful`],
    ["Error rate", `${Number(totals.errorRatePercent || 0).toFixed(2)}%`, `${Number(totals.serverErrors || 0).toLocaleString()} server · ${Number(totals.clientErrors || 0).toLocaleString()} client`],
    ["Average latency", `${Number(totals.averageDurationMs || 0).toLocaleString()} ms`, `maximum ${Number(totals.maximumDurationMs || 0).toLocaleString()} ms`],
    ["Approximate p95", latencyLabels[totals.latencyP95Bucket] || operationalLabel(totals.latencyP95Bucket), "Bounded latency histogram"]
  ];
  $("#operationalMetricGrid").innerHTML = metrics.map(([label, value, note]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${typeof value === "number" ? value.toLocaleString() : escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  $("#operationalRouteList").innerHTML = (telemetry.routes || []).length ? telemetry.routes.map((route) => {
    const kind = Number(route.errors || 0) ? "warning" : "good";
    const requestCount = Number(route.requests || 0);
    const errorCount = Number(route.errors || 0);
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(operationalLabel(route.routeKey))}</h3><p>${requestCount.toLocaleString()} request${requestCount === 1 ? "" : "s"} · ${Number(route.averageDurationMs || 0).toLocaleString()} ms average · ${Number(route.maximumDurationMs || 0).toLocaleString()} ms maximum</p></div><span class="tag ${kind}">${Number(route.errorRatePercent || 0).toFixed(2)}% errors</span></div><div class="card-meta"><span class="tag">${errorCount.toLocaleString()} error${errorCount === 1 ? "" : "s"}</span><span class="tag">last seen ${escapeHtml(relativeTime(route.lastSeenAt))}</span></div></article>`;
  }).join("") : empty("No API traffic exists in this window yet.");
  $("#operationalErrorCodeList").innerHTML = (telemetry.errorCodes || []).length ? telemetry.errorCodes.map((item) => `<article class="card"><div class="card-top"><div><h3>${escapeHtml(operationalLabel(item.errorCode))}</h3><p>Last seen ${escapeHtml(relativeTime(item.lastSeenAt))}</p></div><span class="tag warning">${Number(item.occurrences || 0).toLocaleString()} occurrence${Number(item.occurrences || 0) === 1 ? "" : "s"}</span></div></article>`).join("") : empty("No errors exist in this window.");
  $("#operationalErrorList").innerHTML = (telemetry.recentErrors || []).length ? telemetry.recentErrors.map((item) => {
    const kind = Number(item.statusCode || 0) >= 500 ? "bad" : "warning";
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(operationalLabel(item.errorCode))}</h3><p>${escapeHtml(item.method)} · ${escapeHtml(operationalLabel(item.routeKey))} · HTTP ${Number(item.statusCode || 0)}</p></div><span class="tag ${kind}">${Number(item.durationMs || 0).toLocaleString()} ms</span></div><div class="card-meta"><span class="tag">${escapeHtml(item.actorKind)}</span><span class="tag">${escapeHtml(item.privacyClassification)}</span><span class="tag operational-correlation">${escapeHtml(item.correlationKey)}</span><span>${escapeHtml(relativeTime(item.occurredAt))}</span></div></article>`;
  }).join("") : empty("No recent errors exist in this window.");
}

function backgroundTaskLabel(taskKind) {
  const schedule = (state.backgroundWork?.schedules || []).find((item) => item.taskKind === taskKind);
  return schedule?.displayName || operationalLabel(taskKind);
}

function renderPostgresCutover() {
  const dataPlane = state.snapshot.dataPlane || {};
  const model = dataPlane.postgresCutover || state.snapshot.capabilities?.postgresCutover;
  const roleModel = dataPlane.postgresRuntimeReadRoles || state.snapshot.capabilities?.postgresRuntimeReadRoles;
  const sessionModel = dataPlane.postgresTenantSessions || state.snapshot.capabilities?.postgresTenantSessions;
  const queueWriteModel = dataPlane.postgresTenantQueueWrites || state.snapshot.capabilities?.postgresTenantQueueWrites;
  const workerControlModel = dataPlane.postgresWorkerControl || state.snapshot.capabilities?.postgresWorkerControl;
  const notificationRecoveryModel = dataPlane.postgresNotificationRecovery || state.snapshot.capabilities?.postgresNotificationRecovery;
  const executionRecoveryModel = dataPlane.postgresExecutionRecovery || state.snapshot.capabilities?.postgresExecutionRecovery;
  const operationalRetentionModel = dataPlane.postgresOperationalRetention || state.snapshot.capabilities?.postgresOperationalRetention;
  const observerCandidateModel = dataPlane.postgresObserverCandidateEvaluation || state.snapshot.capabilities?.postgresObserverCandidateEvaluation;
  const alertDispatchModel = dataPlane.postgresOperatorAlertConnectorDispatch || state.snapshot.capabilities?.postgresOperatorAlertConnectorDispatch;
  const alertReconciliationModel = dataPlane.postgresOperatorAlertReconciliation || state.snapshot.capabilities?.postgresOperatorAlertReconciliation;
  const observerWitnessModel = dataPlane.postgresObserverWitnessRefresh || state.snapshot.capabilities?.postgresObserverWitnessRefresh;
  const deliveryLeaseRecoveryModel = dataPlane.postgresHostedDeliveryLeaseRecovery || state.snapshot.capabilities?.postgresHostedDeliveryLeaseRecovery;
  const signalCatalogApplyModel = dataPlane.postgresSignalCatalogApply || state.snapshot.capabilities?.postgresSignalCatalogApply;
  const signalResolutionApplyModel = dataPlane.postgresSignalResolutionApply || state.snapshot.capabilities?.postgresSignalResolutionApply;
  const signalSourceReferenceRefreshModel = dataPlane.postgresSignalSourceReferenceRefresh || state.snapshot.capabilities?.postgresSignalSourceReferenceRefresh;
  const signalTerminalDecisionApplyModel = dataPlane.postgresSignalTerminalDecisionApply || state.snapshot.capabilities?.postgresSignalTerminalDecisionApply;
  const signalOfferIncidentApplyModel = dataPlane.postgresSignalOfferIncidentApply || state.snapshot.capabilities?.postgresSignalOfferIncidentApply;
  const signalPostIncidentDecisionApplyModel = dataPlane.postgresSignalPostIncidentDecisionApply || state.snapshot.capabilities?.postgresSignalPostIncidentDecisionApply;
  const signalMissionBindingApplyModel = dataPlane.postgresSignalMissionBindingApply || state.snapshot.capabilities?.postgresSignalMissionBindingApply;
  const signalStrategyEvaluationApplyModel = dataPlane.postgresSignalStrategyEvaluationApply || state.snapshot.capabilities?.postgresSignalStrategyEvaluationApply;
  const signalWriterLockProtocolModel = dataPlane.postgresSignalWriterLockProtocol || state.snapshot.capabilities?.postgresSignalWriterLockProtocol;
  const signalConstraintConfigApplyModel = dataPlane.postgresSignalConstraintConfigApply || state.snapshot.capabilities?.postgresSignalConstraintConfigApply;
  const signalActionSpendApplyModel = dataPlane.postgresSignalActionSpendApply || state.snapshot.capabilities?.postgresSignalActionSpendApply;
  const signalTargetQualificationApplyModel = dataPlane.postgresSignalTargetQualificationApply || state.snapshot.capabilities?.postgresSignalTargetQualificationApply;
  const signalSourceTrustApplyModel = dataPlane.postgresSignalSourceTrustApply || state.snapshot.capabilities?.postgresSignalSourceTrustApply;
  const signalRetailerQualificationApplyModel = dataPlane.postgresSignalRetailerQualificationApply || state.snapshot.capabilities?.postgresSignalRetailerQualificationApply;
  const signalMissionPolicyApplyModel = dataPlane.postgresSignalMissionPolicyApply || state.snapshot.capabilities?.postgresSignalMissionPolicyApply;
  const signalSourceStatusApplyModel = dataPlane.postgresSignalSourceStatusApply || state.snapshot.capabilities?.postgresSignalSourceStatusApply;
  const signalSourceSyncApplyModel = dataPlane.postgresSignalSourceSyncApply || state.snapshot.capabilities?.postgresSignalSourceSyncApply;
  const signalReservationLifecycleApplyModel = dataPlane.postgresSignalReservationLifecycleApply || state.snapshot.capabilities?.postgresSignalReservationLifecycleApply;
  const signalCatalogImportApplyModel = dataPlane.postgresSignalCatalogImportApply || state.snapshot.capabilities?.postgresSignalCatalogImportApply;
  const signalSourceProvisioningApplyModel = dataPlane.postgresSignalSourceProvisioningApply || state.snapshot.capabilities?.postgresSignalSourceProvisioningApply;
  const signalAttributionPolicyApplyModel = dataPlane.postgresSignalAttributionPolicyApply || state.snapshot.capabilities?.postgresSignalAttributionPolicyApply;
  const signalEvaluationCompositionModel = dataPlane.postgresSignalEvaluationComposition || state.snapshot.capabilities?.postgresSignalEvaluationComposition;
  const signalAttributionReceiptApplyModel = dataPlane.postgresSignalAttributionReceiptApply || state.snapshot.capabilities?.postgresSignalAttributionReceiptApply;
  const signalJobLifecycleApplyModel = dataPlane.postgresSignalJobLifecycleApply || state.snapshot.capabilities?.postgresSignalJobLifecycleApply;
  const signalEvaluationRepositoryCompositionModel = dataPlane.postgresSignalEvaluationRepositoryComposition || state.snapshot.capabilities?.postgresSignalEvaluationRepositoryComposition;
  const signalIngressEnqueueApplyModel = dataPlane.postgresSignalIngressEnqueueApply || state.snapshot.capabilities?.postgresSignalIngressEnqueueApply;
  const signalIngressCompositionModel = dataPlane.postgresSignalIngressComposition || state.snapshot.capabilities?.postgresSignalIngressComposition;
  const signalDeadLetterResetApplyModel = dataPlane.postgresSignalDeadLetterResetApply || state.snapshot.capabilities?.postgresSignalDeadLetterResetApply;
  const signalNotificationEnsureApplyModel = dataPlane.postgresSignalNotificationEnsureApply || state.snapshot.capabilities?.postgresSignalNotificationEnsureApply;
  const signalHandlerCompositionModel = dataPlane.postgresSignalHandlerComposition || state.snapshot.capabilities?.postgresSignalHandlerComposition;
  const gate = $("#postgresCutoverGate");
  if (!model) {
    $("#adminRestartWorkerButton").hidden = true;
    gate.textContent = "Unavailable";
    $("#postgresCutoverMetricGrid").innerHTML = empty("PostgreSQL cutover coverage is unavailable.");
    $("#postgresCutoverChecklist").innerHTML = "";
    return;
  }
  gate.textContent = model.productionReady === true ? "Ready" : "Qualification only";
  gate.className = "plain-state";
  const metrics = [
    ["Portable tables", model.portableTableCount, "Bounded streaming import"],
    ["Foreign keys", model.foreignKeyCount, "Validated after unique indexes"],
    ["Indexes", model.indexCount, "Unique and query indexes"],
    ["Column defaults", model.defaultExpressionCount, "Safely translated expressions"],
    ["Direct tenant RLS", model.directTenantRlsTableCount, "Forced, default-deny policies"],
    ["Inherited tenant RLS", model.inheritedTenantRlsTableCount, `${Number(model.mixedTenantRlsTableCount || 0).toLocaleString()} mixed table fails closed`],
    ["Restricted read roles", roleModel?.roleCount, `${Number(roleModel?.grantedTableCount || 0).toLocaleString()} exact table grants`],
    ["Server-bound session policies", sessionModel?.tenantRlsTableCount, "Restrictive tenant intersections"],
    ["Queue-bound tables", queueWriteModel?.tableCount, `${Number(queueWriteModel?.grantCount || 0).toLocaleString()} table grants · ${Number(queueWriteModel?.functionGrantCount || 0).toLocaleString()} exact functions`],
    ["Fleet-control tables", workerControlModel?.tableCount, `${Number(workerControlModel?.grantCount || 0).toLocaleString()} exact column grants · ${Number(workerControlModel?.permissivePolicyCount || 0).toLocaleString()} explicit policies`],
    ["PostgreSQL handler families", observerWitnessModel?.handlerTaskKindCount, `${Number(observerWitnessModel?.totalHandlerTaskKindCount || 0).toLocaleString()} total · six complete handlers + final-handler transport and twenty-six independently qualified signal boundaries proven`]
  ];
  $("#postgresCutoverMetricGrid").innerHTML = metrics.map(([label, value, note]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${Number(value || 0).toLocaleString()}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  const checks = [
    ["One-shot archive import", model.oneShotImportImplemented === true, "A pre-verified archive streams into a new private schema inside one serializable transaction."],
    ["Exact logical reconciliation", model.exactReconciliationImplemented === true, "Every table, row count, and canonical content hash must match before the receipt becomes verified."],
    ["Default-expression parity", model.defaultExpressionParity === true, `${Number(model.defaultExpressionCount || 0).toLocaleString()} packaged column defaults are translated under a strict literal-only policy.`],
    ["Tenant-scope classification", model.tenantScopeClassificationComplete === true && model.inheritedTenantRlsParity === true && model.mixedTenantRlsFailClosed === true, `${Number(model.directTenantRlsTableCount || 0).toLocaleString()} direct and ${Number(model.inheritedTenantRlsTableCount || 0).toLocaleString()} inherited tables receive forced policies; mixed-source rows remain hidden until shared-role semantics are proven.`],
    ["SQLite check parity", model.checkConstraintParity === true, `${Number(model.checkConstraintCount || 0).toLocaleString()} packaged checks receive validated PostgreSQL equivalents.`],
    ["Immutable trigger parity", model.triggerParity === true, `${Number(model.triggerCount || 0).toLocaleString()} packaged trigger invariants receive validated PostgreSQL equivalents.`],
    ["PostgreSQL worker-store contract", model.postgresAsyncWorkerStoreContractParity === true && model.singleConnectionWorkerLeaseSemanticsQualified === true, "Principal pagination, scheduling, tenant-bound SKIP LOCKED leasing, capability transitions, heartbeats, and deployment attestation pass on the inert qualification schema."],
    ["Least-privilege read roles", roleModel?.qualificationSuiteParity === true && roleModel?.noLogin === true && roleModel?.noInherit === true && roleModel?.noBypassRls === true && roleModel?.readOnly === true, `${Number(roleModel?.roleCount || 0).toLocaleString()} NOLOGIN roles hold ${Number(roleModel?.grantedTableCount || 0).toLocaleString()} exact SELECT grants; ${Number(roleModel?.unresolvedTableCount || 0).toLocaleString()} unresolved table remains inaccessible.`],
    ["Server-bound tenant sessions", sessionModel?.qualificationSuiteParity === true && sessionModel?.serverBoundRestrictivePolicies === true && sessionModel?.directParameterScopeExpansionPrevented === true, `${Number(sessionModel?.tenantRlsTableCount || 0).toLocaleString()} restrictive policies intersect the server-owned session principal with every tenant RLS table. PostgreSQL permits custom parameter changes, but they cannot widen the mapped tenant.`],
    ["Bounded tenant queue repository", queueWriteModel?.qualificationSuiteParity === true && queueWriteModel?.serverBoundRestrictivePolicies === true && queueWriteModel?.queueStoreRepositoryParity === true && queueWriteModel?.deleteTableCount === 0, `${Number(queueWriteModel?.tableCount || 0).toLocaleString()} tables expose ${Number(queueWriteModel?.grantCount || 0).toLocaleString()} exact grants plus the binder, scope, and one immutable JSON constraint helper. The fifth table is a SELECT-only singleton deployment expectation; no deployment mutation is granted.`],
    ["Atomic deployment attestation", queueWriteModel?.atomicDeploymentAttestationAndQueueWrite === true, "Every new-work schedule, enqueue, and lease mutation validates the exact API-owned worker version and deployment fingerprint inside the same server-bound READ COMMITTED transaction. Already-leased recovery remains available."],
    ["Least-privilege fleet control", workerControlModel?.qualificationSuiteParity === true && workerControlModel?.controlRepositoryParity === true && workerControlModel?.insertTableCount === 0 && workerControlModel?.deleteTableCount === 0, `${Number(workerControlModel?.tableCount || 0).toLocaleString()} tables expose ${Number(workerControlModel?.grantCount || 0).toLocaleString()} exact column grants for ID-only principal pagination, bounded deployment status, and stop-only heartbeat updates. The role has no table-wide, queue-task, insert, delete, function, login, membership, or runtime authority.`],
    ["Server-bound notification recovery", notificationRecoveryModel?.qualificationSuiteParity === true && notificationRecoveryModel?.notificationRecoveryRepositoryParity === true && notificationRecoveryModel?.serverClockBoundRecovery === true && notificationRecoveryModel?.directTableGrantCount === 0 && notificationRecoveryModel?.functionGrantCount === 1, `${Number(notificationRecoveryModel?.handlerTaskKindCount || 0).toLocaleString()} of ${Number(notificationRecoveryModel?.totalHandlerTaskKindCount || 0).toLocaleString()} worker task families now has native PostgreSQL repository parity. Its NOLOGIN role can execute one exact principal-bound, server-clocked recovery routine and has zero direct table, column, insert, or delete grants.`],
    ["Server-bound action and spend recovery", executionRecoveryModel?.qualificationSuiteParity === true && executionRecoveryModel?.executionRecoveryRepositoryParity === true && executionRecoveryModel?.serverClockBoundRecovery === true && executionRecoveryModel?.sharedIncidentMutationFailClosed === true && executionRecoveryModel?.directTableGrantCount === 0 && executionRecoveryModel?.functionGrantCount === 1, `${Number(executionRecoveryModel?.handlerTaskKindCount || 0).toLocaleString()} of ${Number(executionRecoveryModel?.totalHandlerTaskKindCount || 0).toLocaleString()} worker task families now have native PostgreSQL repository parity. The second NOLOGIN role retires only expired action windows and spend reservations, appends the existing receipts, and refuses cross-tenant shared-incident mutation.`],
    ["Server-bound privacy retention", operationalRetentionModel?.qualificationSuiteParity === true && operationalRetentionModel?.operationalRetentionRepositoryParity === true && operationalRetentionModel?.serverClockBoundRetention === true && operationalRetentionModel?.serverAuthenticatedReceiptActor === true && operationalRetentionModel?.boundedEvidenceDeletionLimit === 500 && operationalRetentionModel?.directTableGrantCount === 0 && operationalRetentionModel?.functionGrantCount === 1, `${Number(operationalRetentionModel?.handlerTaskKindCount || 0).toLocaleString()} of ${Number(operationalRetentionModel?.totalHandlerTaskKindCount || 0).toLocaleString()} worker task families now have native PostgreSQL repository parity. The third NOLOGIN role applies only the existing 30/90-day deletion windows, caps quarantined evidence at 500 rows, and appends bounded retention receipts.`],
    ["Server-bound observer candidate evaluation", observerCandidateModel?.qualificationSuiteParity === true && observerCandidateModel?.observerCandidateEvaluationRepositoryParity === true && observerCandidateModel?.serverDerivedEvidencePlan === true && observerCandidateModel?.databaseEvidenceRevalidation === true && observerCandidateModel?.quarantinedOnly === true && observerCandidateModel?.generatedCandidatesExecutable === false && observerCandidateModel?.directTableGrantCount === 0 && observerCandidateModel?.functionGrantCount === 1, `${Number(observerCandidateModel?.handlerTaskKindCount || 0).toLocaleString()} of ${Number(observerCandidateModel?.totalHandlerTaskKindCount || 0).toLocaleString()} worker task families now have native PostgreSQL repository parity. The fourth NOLOGIN role evaluates at most ${Number(observerCandidateModel?.maximumDiagnosticRows || 0).toLocaleString()} diagnostics, proposes at most ${Number(observerCandidateModel?.maximumCandidatesPerRun || 0).toLocaleString()} unsigned candidates, revalidates evidence server-side, and can create only non-executable quarantine records.`],
    ["Server-bound operator-alert connector dispatch", alertDispatchModel?.qualificationSuiteParity === true && alertDispatchModel?.alertDispatchRepositoryParity === true && alertDispatchModel?.twoPhaseLease === true && alertDispatchModel?.applicationHashedOneUseCapabilities === true && alertDispatchModel?.databaseServerClock === true && alertDispatchModel?.endpointReferencesOnly === true && alertDispatchModel?.rawUrlsAccessible === false && alertDispatchModel?.connectorSecretsAccessible === false && alertDispatchModel?.directTableGrantCount === 0 && alertDispatchModel?.functionGrantCount === 1, `A separate NOLOGIN sub-boundary leases at most ${Number(alertDispatchModel?.maximumBindings || 0).toLocaleString()} deployment-bound connector references with server time and application-generated one-use capabilities. It exposes neither raw webhook URLs nor signing secrets.`],
    ["Server-bound operator-alert reconciliation", alertReconciliationModel?.qualificationSuiteParity === true && alertReconciliationModel?.alertReconciliationRepositoryParity === true && alertReconciliationModel?.fullHandlerRepositoryParity === true && alertReconciliationModel?.serverDerivedRepairGroups === true && alertReconciliationModel?.databaseEvidenceRevalidation === true && alertReconciliationModel?.twoPhasePlanApply === true && alertReconciliationModel?.databaseServerClock === true && alertReconciliationModel?.sanitizedAggregateOnly === true && alertReconciliationModel?.rawUrlsAccessible === false && alertReconciliationModel?.connectorSecretsAccessible === false && alertReconciliationModel?.directTableGrantCount === 0 && alertReconciliationModel?.functionGrantCount === 1, `The complete fifth handler derives at most ${Number(alertReconciliationModel?.maximumGroups || 0).toLocaleString()} repair groups from ${Number(alertReconciliationModel?.maximumDiagnostics || 0).toLocaleString()} sanitized diagnostics, then revalidates incident, lifecycle, route, audit, outbox, and connector-queue mutations in one server-bound transaction. Coverage is ${Number(alertReconciliationModel?.handlerTaskKindCount || 0).toLocaleString()} of ${Number(alertReconciliationModel?.totalHandlerTaskKindCount || 0).toLocaleString()}.`],
    ["Server-bound independent witness refresh", observerWitnessModel?.qualificationSuiteParity === true && observerWitnessModel?.witnessRefreshRepositoryParity === true && observerWitnessModel?.twoPhaseExternalIo === true && observerWitnessModel?.externalIoOutsideTransaction === true && observerWitnessModel?.applicationEd25519Verification === true && observerWitnessModel?.serverDerivedCheckpoint === true && observerWitnessModel?.databasePlanRevalidation === true && observerWitnessModel?.serverAuthenticatedReceiptActor === true && observerWitnessModel?.publicCryptographicMetadataOnly === true && observerWitnessModel?.directTableGrantCount === 0 && observerWitnessModel?.functionGrantCount === 1, `The sixth handler publishes outside database transactions, verifies the pinned Ed25519 witness in the application, then revalidates and appends only public checkpoint, receipt, audit, and outbox metadata through one principal-bound function. Coverage is ${Number(observerWitnessModel?.handlerTaskKindCount || 0).toLocaleString()} of ${Number(observerWitnessModel?.totalHandlerTaskKindCount || 0).toLocaleString()}.`],
    ["Server-bound hosted-delivery lease recovery, signal lifecycle, and resolution planning", deliveryLeaseRecoveryModel?.qualificationSuiteParity === true && deliveryLeaseRecoveryModel?.leaseRecoverySubBoundaryParity === true && deliveryLeaseRecoveryModel?.signalInboxLifecycleRepositoryParity === true && deliveryLeaseRecoveryModel?.signalResolutionPlanRepositoryParity === true && deliveryLeaseRecoveryModel?.signalEvaluationApplyRepositoryParity === false && deliveryLeaseRecoveryModel?.sharedCatalogMutationFailClosed === true && deliveryLeaseRecoveryModel?.rawSignalPayloadReturned === false && deliveryLeaseRecoveryModel?.signalEvaluationRepositoryParity === false && deliveryLeaseRecoveryModel?.signalIngressRepositoryParity === false && deliveryLeaseRecoveryModel?.databaseServerClock === true && deliveryLeaseRecoveryModel?.deterministicReceiptHashParity === true && deliveryLeaseRecoveryModel?.nativeContentionQualified === true && deliveryLeaseRecoveryModel?.directTableGrantCount === 0 && deliveryLeaseRecoveryModel?.functionGrantCount === 3, `The final handler's transport boundary preserves expired inbox/outbox recovery and the fixed signal_event_v1 lifecycle, then derives a capability-bound, ${Number(deliveryLeaseRecoveryModel?.maximumResolutionPlanAgeSeconds || 0).toLocaleString()}-second exact catalog-resolution plan through three principal-bound functions across ${Number(deliveryLeaseRecoveryModel?.protectedTableCount || 0).toLocaleString()} forced-RLS transport tables. Unknown products require separate shared-catalog authority; no raw signal payload or evaluation mutation is returned. Complete-handler coverage deliberately remains ${Number(deliveryLeaseRecoveryModel?.handlerTaskKindCount || 0).toLocaleString()} of ${Number(deliveryLeaseRecoveryModel?.totalHandlerTaskKindCount || 0).toLocaleString()} until plan application and downstream signal evaluation move.`],
    ["Server-bound unknown-product catalog creation", signalCatalogApplyModel?.qualificationSuiteParity === true && signalCatalogApplyModel?.insertOnlyCatalogMutation === true && signalCatalogApplyModel?.sharedCatalogCreateApplyRepositoryParity === true && signalCatalogApplyModel?.databasePlanRevalidation === true && signalCatalogApplyModel?.twoPhasePlanApply === true && signalCatalogApplyModel?.signalEvaluationGraphMutation === false && signalCatalogApplyModel?.rawSignalPayloadReturned === false && signalCatalogApplyModel?.directTableGrantCount === 0 && signalCatalogApplyModel?.functionGrantCount === 1 && signalCatalogApplyModel?.runtimeAuthority === false && signalCatalogApplyModel?.productionReady === false, `A separate inactive NOLOGIN boundary revalidates a ${Number(signalCatalogApplyModel?.maximumPlanAgeSeconds || 0).toLocaleString()}-second leased-signal plan, then can insert only ${Number(signalCatalogApplyModel?.sharedCatalogWriteTableCount || 0).toLocaleString()} shared catalog rows and ${Number(signalCatalogApplyModel?.tenantReferenceWriteTableCount || 0).toLocaleString()} exact tenant source references across ${Number(signalCatalogApplyModel?.supportedExactRetailerCount || 0).toLocaleString()} canonical retailer formats. It cannot refresh existing references, mutate the signal-evaluation graph, complete the inbox lease, expose raw payloads, or act as runtime authority.`],
    ["Server-bound signal event and resolution commit", signalResolutionApplyModel?.qualificationSuiteParity === true && signalResolutionApplyModel?.transportDuplicateRepositoryParity === true && signalResolutionApplyModel?.signalEventInsertRepositoryParity === true && signalResolutionApplyModel?.sourceConnectionHeartbeatRepositoryParity === true && signalResolutionApplyModel?.resolutionDecisionInsertRepositoryParity === true && signalResolutionApplyModel?.sharedCatalogMutationFailClosed === true && signalResolutionApplyModel?.databasePlanRevalidation === true && signalResolutionApplyModel?.twoPhasePlanApply === true && signalResolutionApplyModel?.downstreamSignalGraphMutation === false && signalResolutionApplyModel?.inboxLifecycleMutation === false && signalResolutionApplyModel?.rawSignalPayloadReturned === false && signalResolutionApplyModel?.directTableGrantCount === 0 && signalResolutionApplyModel?.functionGrantCount === 1 && signalResolutionApplyModel?.runtimeAuthority === false && signalResolutionApplyModel?.productionReady === false, `A third independently inactive NOLOGIN boundary serializes and revalidates the leased signal for at most ${Number(signalResolutionApplyModel?.maximumPlanAgeSeconds || 0).toLocaleString()} seconds, then can perform only the existing transport-deduplication no-op or the exact event, source heartbeat, and resolution-decision commit across ${Number(signalResolutionApplyModel?.mutationTableCount || 0).toLocaleString()} mutation tables. Unknown products must pass the catalog-create boundary first; occurrences, incidents, offer observations, missions, actions, and inbox completion remain closed.`],
    ["Server-bound known-product source-reference refresh", signalSourceReferenceRefreshModel?.qualificationSuiteParity === true && signalSourceReferenceRefreshModel?.committedResolutionBinding === true && signalSourceReferenceRefreshModel?.matchedResolutionRequired === true && signalSourceReferenceRefreshModel?.testSignalMutation === false && signalSourceReferenceRefreshModel?.conflictingReferenceFailClosed === true && signalSourceReferenceRefreshModel?.idempotentReplay === true && signalSourceReferenceRefreshModel?.sourceReferenceRefreshRepositoryParity === true && signalSourceReferenceRefreshModel?.sharedCatalogMutation === false && signalSourceReferenceRefreshModel?.downstreamSignalGraphMutation === false && signalSourceReferenceRefreshModel?.inboxLifecycleMutation === false && signalSourceReferenceRefreshModel?.rawSignalPayloadReturned === false && signalSourceReferenceRefreshModel?.directTableGrantCount === 0 && signalSourceReferenceRefreshModel?.functionGrantCount === 1 && signalSourceReferenceRefreshModel?.runtimeAuthority === false && signalSourceReferenceRefreshModel?.productionReady === false, `A fourth independently inactive NOLOGIN boundary binds the exact committed event and unique matched decision, revalidates the leased TrackaLacker signal for at most ${Number(signalSourceReferenceRefreshModel?.maximumPlanAgeSeconds || 0).toLocaleString()} seconds, and can insert or refresh only ${Number(signalSourceReferenceRefreshModel?.mutationTableCount || 0).toLocaleString()} tenant source-reference tables. Test, ambiguous, unresolved, and conflicting remap cases fail closed; raw source identities are hashed in the application plan, while shared catalog, occurrences, incidents, offers, missions, actions, and inbox lifecycle remain untouched.`],
    ["Server-bound terminal signal decisions", signalTerminalDecisionApplyModel?.qualificationSuiteParity === true && signalTerminalDecisionApplyModel?.committedResolutionBinding === true && signalTerminalDecisionApplyModel?.settledSourceReferenceRequired === true && signalTerminalDecisionApplyModel?.terminalOutcomeDerivation === true && signalTerminalDecisionApplyModel?.testSignalTerminalOnly === true && signalTerminalDecisionApplyModel?.nonActionableTerminalOnly === true && signalTerminalDecisionApplyModel?.idempotentReplay === true && signalTerminalDecisionApplyModel?.signalOccurrenceRepositoryParity === true && signalTerminalDecisionApplyModel?.terminalMissionDecisionRepositoryParity === true && signalTerminalDecisionApplyModel?.terminalAuditOutboxRepositoryParity === true && signalTerminalDecisionApplyModel?.remainingDownstreamSignalGraphMutation === false && signalTerminalDecisionApplyModel?.inboxLifecycleMutation === false && signalTerminalDecisionApplyModel?.rawSignalPayloadReturned === false && signalTerminalDecisionApplyModel?.directTableGrantCount === 0 && signalTerminalDecisionApplyModel?.functionGrantCount === 1 && signalTerminalDecisionApplyModel?.runtimeAuthority === false && signalTerminalDecisionApplyModel?.productionReady === false, `A fifth independently inactive NOLOGIN boundary revalidates the committed resolution and settled source-reference predecessor for at most ${Number(signalTerminalDecisionApplyModel?.maximumPlanAgeSeconds || 0).toLocaleString()} seconds. Test signals, ambiguous or unresolved identities, and matched non-actionable offers atomically append one occurrence, one terminal mission decision, one audit event, and one outbox event across exactly ${Number(signalTerminalDecisionApplyModel?.mutationTableCount || 0).toLocaleString()} tables. Actionable offers continue without mutation; partial graphs and inconsistent replays fail closed, and incidents, offer observations, missions, actions, and inbox lifecycle remain untouched.`],
    ["Server-bound actionable offer incidents", signalOfferIncidentApplyModel?.qualificationSuiteParity === true && signalOfferIncidentApplyModel?.committedResolutionBinding === true && signalOfferIncidentApplyModel?.settledTerminalDecisionRequired === true && signalOfferIncidentApplyModel?.actionableOfferRequired === true && signalOfferIncidentApplyModel?.serverDerivedSemanticKey === true && signalOfferIncidentApplyModel?.deterministicObservationIdentity === true && signalOfferIncidentApplyModel?.messageSerialization === true && signalOfferIncidentApplyModel?.semanticIncidentSerialization === true && signalOfferIncidentApplyModel?.dedupeWindowRepositoryParity === true && signalOfferIncidentApplyModel?.idempotentReplay === true && signalOfferIncidentApplyModel?.partialGraphFailClosed === true && signalOfferIncidentApplyModel?.offerObservationRepositoryParity === true && signalOfferIncidentApplyModel?.signalIncidentRepositoryParity === true && signalOfferIncidentApplyModel?.signalOccurrenceRepositoryParity === true && signalOfferIncidentApplyModel?.offerIncidentGraphMutation === true && signalOfferIncidentApplyModel?.remainingMissionActionGraphMutation === false && signalOfferIncidentApplyModel?.inboxLifecycleMutation === false && signalOfferIncidentApplyModel?.rawSignalPayloadReturned === false && signalOfferIncidentApplyModel?.directTableGrantCount === 0 && signalOfferIncidentApplyModel?.functionGrantCount === 1 && signalOfferIncidentApplyModel?.runtimeAuthority === false && signalOfferIncidentApplyModel?.productionReady === false, `A sixth independently inactive NOLOGIN boundary accepts only an exact actionable continuation from the terminal-decision predecessor, revalidates the leased signal for at most ${Number(signalOfferIncidentApplyModel?.maximumPlanAgeSeconds || 0).toLocaleString()} seconds, and atomically inserts the deterministic offer observation and occurrence while creating or corroborating one open semantic incident across exactly ${Number(signalOfferIncidentApplyModel?.mutationTableCount || 0).toLocaleString()} tables. Message and semantic-key advisory locks prevent duplicate graphs, partial or inconsistent replay fails closed, and missions, actions, and inbox lifecycle remain untouched.`],
    ["Server-bound post-incident decisions", signalPostIncidentDecisionApplyModel?.qualificationSuiteParity === true && signalPostIncidentDecisionApplyModel?.committedResolutionBinding === true && signalPostIncidentDecisionApplyModel?.settledOfferIncidentRequired === true && signalPostIncidentDecisionApplyModel?.incidentGraphBinding === true && signalPostIncidentDecisionApplyModel?.existingJobCorroboration === true && signalPostIncidentDecisionApplyModel?.noMissionFailClosed === true && signalPostIncidentDecisionApplyModel?.trustedMissionContinuation === true && signalPostIncidentDecisionApplyModel?.missionBindingRequiredProjection === true && signalPostIncidentDecisionApplyModel?.idempotentReplay === true && signalPostIncidentDecisionApplyModel?.postIncidentDecisionRepositoryParity === true && signalPostIncidentDecisionApplyModel?.postIncidentAuditOutboxRepositoryParity === true && signalPostIncidentDecisionApplyModel?.postIncidentDecisionGraphMutation === true && signalPostIncidentDecisionApplyModel?.remainingMissionActionGraphMutation === false && signalPostIncidentDecisionApplyModel?.inboxLifecycleMutation === false && signalPostIncidentDecisionApplyModel?.rawSignalPayloadReturned === false && signalPostIncidentDecisionApplyModel?.directTableGrantCount === 0 && signalPostIncidentDecisionApplyModel?.functionGrantCount === 1 && signalPostIncidentDecisionApplyModel?.runtimeAuthority === false && signalPostIncidentDecisionApplyModel?.productionReady === false, `A seventh independently inactive NOLOGIN boundary accepts only an exact, fully settled offer/incident graph and revalidates it for at most ${Number(signalPostIncidentDecisionApplyModel?.maximumPlanAgeSeconds || 0).toLocaleString()} seconds. Existing user-owned action jobs with at least two incident observations become corroborated decisions; untrusted or manual sources without an exact mission target fail closed as no-mission. Trusted exact sources project mission binding or creation requirements with zero writes. Terminal decisions atomically append only mission-decision, audit, and outbox records across exactly ${Number(signalPostIncidentDecisionApplyModel?.mutationTableCount || 0).toLocaleString()} tables; catalog, offers, incidents, missions, actions, checkout, order submission, and inbox lifecycle remain untouched.`],
    ["Server-side plan binding", signalMissionBindingApplyModel?.qualificationSuiteParity === true && signalMissionBindingApplyModel?.settledPostIncidentDecisionRequired === true && signalMissionBindingApplyModel?.messageSerialization === true && signalMissionBindingApplyModel?.variantMissionSerialization === true && signalMissionBindingApplyModel?.existingMissionBinding === true && signalMissionBindingApplyModel?.trustedMissionCreation === true && signalMissionBindingApplyModel?.exactVariantTargetAttachment === true && signalMissionBindingApplyModel?.initialIntentPolicyCreation === true && signalMissionBindingApplyModel?.appendOnlyPolicyRevision === true && signalMissionBindingApplyModel?.missionQuantityParity === true && signalMissionBindingApplyModel?.targetPolicyJsonParity === true && signalMissionBindingApplyModel?.purchasePolicyHashParity === true && signalMissionBindingApplyModel?.idempotentReplay === true && signalMissionBindingApplyModel?.missionBindingRepositoryParity === true && signalMissionBindingApplyModel?.missionAuditOutboxRepositoryParity === true && signalMissionBindingApplyModel?.initialPolicyAuditOutboxRepositoryParity === true && signalMissionBindingApplyModel?.sharedCatalogMutation === false && signalMissionBindingApplyModel?.incidentMutation === false && signalMissionBindingApplyModel?.terminalDecisionMutation === false && signalMissionBindingApplyModel?.actionMutation === false && signalMissionBindingApplyModel?.spendMutation === false && signalMissionBindingApplyModel?.inboxLifecycleMutation === false && signalMissionBindingApplyModel?.rawSignalPayloadReturned === false && signalMissionBindingApplyModel?.directTableGrantCount === 0 && signalMissionBindingApplyModel?.functionGrantCount === 1 && signalMissionBindingApplyModel?.runtimeAuthority === false && signalMissionBindingApplyModel?.productionReady === false, `An eighth independently inactive NOLOGIN boundary accepts only the exact mission-binding continuation from a settled post-incident decision and revalidates it for at most ${Number(signalMissionBindingApplyModel?.maximumPlanAgeSeconds || 0).toLocaleString()} seconds. It binds an existing user mission or creates a trusted exact-source mission, attaches up to ${Number(signalMissionBindingApplyModel?.maximumVariantListings || 0).toLocaleString()} known exact-variant listings, preserves mission quantity and byte-identical SQLite policy hashes, creates only a missing initial append-only intent policy, and appends exact audit/outbox receipts across ${Number(signalMissionBindingApplyModel?.mutationTableCount || 0).toLocaleString()} tables. Strategy evaluation, action jobs, spend, checkout, order submission, and inbox completion remain closed.`],
    ["Server-bound strategy and purchase-policy evaluation", signalStrategyEvaluationApplyModel?.qualificationSuiteParity === true && signalStrategyEvaluationApplyModel?.settledMissionBindingRequired === true && signalStrategyEvaluationApplyModel?.applicationOwnedDeterministicEvaluation === true && signalStrategyEvaluationApplyModel?.databaseInputSnapshotRevalidation === true && signalStrategyEvaluationApplyModel?.strategySetFingerprintParity === true && signalStrategyEvaluationApplyModel?.evaluationFingerprintParity === true && signalStrategyEvaluationApplyModel?.terminalEvaluationDecisionParity === true && signalStrategyEvaluationApplyModel?.actionableEvaluationZeroWriteHandoff === true && signalStrategyEvaluationApplyModel?.sourceTrustRestrictionParity === true && signalStrategyEvaluationApplyModel?.idempotentReplay === true && signalStrategyEvaluationApplyModel?.sharedCatalogMutation === false && signalStrategyEvaluationApplyModel?.missionMutation === false && signalStrategyEvaluationApplyModel?.policyMutation === false && signalStrategyEvaluationApplyModel?.strategyMutation === false && signalStrategyEvaluationApplyModel?.actionMutation === false && signalStrategyEvaluationApplyModel?.spendMutation === false && signalStrategyEvaluationApplyModel?.inboxLifecycleMutation === false && signalStrategyEvaluationApplyModel?.rawSignalPayloadReturned === false && signalStrategyEvaluationApplyModel?.databaseSemanticEvaluation === false && signalStrategyEvaluationApplyModel?.evaluationAuthority === false && signalStrategyEvaluationApplyModel?.directTableGrantCount === 0 && signalStrategyEvaluationApplyModel?.functionGrantCount === 1 && signalStrategyEvaluationApplyModel?.runtimeAuthority === false && signalStrategyEvaluationApplyModel?.productionReady === false, `A ninth independently inactive NOLOGIN boundary binds an application-owned deterministic evaluation to the exact event transport hash, mission target, current policy revision, complete ordered strategy-set fingerprint, and source trust for at most ${Number(signalStrategyEvaluationApplyModel?.maximumPlanAgeSeconds || 0).toLocaleString()} seconds. Unmatched, stale, and quantity-limited results append exactly one decision/audit/outbox triplet across ${Number(signalStrategyEvaluationApplyModel?.mutationTableCount || 0).toLocaleString()} tables; matched and price-required evaluations make a zero-write handoff. PostgreSQL does not claim semantic evaluator authority, and action jobs, spend, inbox completion, checkout, and order submission remain closed.`],
    ["Server-bound signal action writer-lock protocol", signalWriterLockProtocolModel?.qualificationSuiteParity === true && signalWriterLockProtocolModel?.sharedWriterLockProtocolImplemented === true && signalWriterLockProtocolModel?.fixedOrderAdvisoryLocks === true && signalWriterLockProtocolModel?.sourceOwnershipValidation === true && signalWriterLockProtocolModel?.missionOwnershipValidation === true && signalWriterLockProtocolModel?.retailerIdentityValidation === true && signalWriterLockProtocolModel?.lockOnly === true && signalWriterLockProtocolModel?.actionSpendConsumerParity === true && signalWriterLockProtocolModel?.configurationWriterParity === false && signalWriterLockProtocolModel?.reservationWriterParity === false && signalWriterLockProtocolModel?.writerLockProtocolParity === false && signalWriterLockProtocolModel?.mutationAuthority === false && signalWriterLockProtocolModel?.directTableGrantCount === 0 && signalWriterLockProtocolModel?.functionGrantCount === 1 && signalWriterLockProtocolModel?.runtimeAuthority === false && signalWriterLockProtocolModel?.productionReady === false, `An eleventh independently inactive NOLOGIN boundary owns the fixed ${Number(signalWriterLockProtocolModel?.lockScopeCount || 0).toLocaleString()}-scope source → retailer qualification → settings → mission policy → spend lock order. It is lock-only, validates the authenticated source, retailer, and mission identities, and the reviewed action/spend, bounded configuration, Target qualification/settings, source-trust, source-status, source-sync, spend-reservation lifecycle, non-Target qualification, and mission-policy transactions consume it. Source catalog import and provisioning writers keep whole-system parity closed.`],
    ["Server-bound bounded configuration writers", signalConstraintConfigApplyModel?.qualificationSuiteParity === true && signalConstraintConfigApplyModel?.atomicQualificationApplyImplemented === true && signalConstraintConfigApplyModel?.serverBoundPrincipalLookup === true && signalConstraintConfigApplyModel?.sharedWriterLockProtocolImplemented === true && signalConstraintConfigApplyModel?.writerLockProtocolConsumed === true && signalConstraintConfigApplyModel?.settingsScopeConsumed === true && signalConstraintConfigApplyModel?.spendScopeConsumed === true && signalConstraintConfigApplyModel?.databaseOwnedTimestamps === true && signalConstraintConfigApplyModel?.optimisticConcurrency === true && signalConstraintConfigApplyModel?.deterministicRequestIdentity === true && signalConstraintConfigApplyModel?.immutableRequestReplay === true && signalConstraintConfigApplyModel?.lifecycleAwareOutboxReplay === true && signalConstraintConfigApplyModel?.atomicAuditOutbox === true && signalConstraintConfigApplyModel?.settingsPauseWriterParity === true && signalConstraintConfigApplyModel?.guardrailSettingsWriterParity === true && signalConstraintConfigApplyModel?.spendPolicyWriterParity === true && signalConstraintConfigApplyModel?.qualificationSettingsWriterParity === false && signalConstraintConfigApplyModel?.sourceWriterParity === false && signalConstraintConfigApplyModel?.retailerQualificationWriterParity === false && signalConstraintConfigApplyModel?.missionPolicyWriterParity === false && signalConstraintConfigApplyModel?.settingsWriterParity === false && signalConstraintConfigApplyModel?.configurationWriterParity === false && signalConstraintConfigApplyModel?.reservationWriterParity === false && signalConstraintConfigApplyModel?.writerLockProtocolParity === false && signalConstraintConfigApplyModel?.directTableGrantCount === 0 && signalConstraintConfigApplyModel?.functionGrantCount === 1 && signalConstraintConfigApplyModel?.runtimeAuthority === false && signalConstraintConfigApplyModel?.productionReady === false, `A twelfth independently inactive NOLOGIN boundary moves the three current user-facing operations—global action pause/resume, guardrail settings, and periodic spend caps—behind one principal-bound function across ${Number(signalConstraintConfigApplyModel?.mutationTableCount || 0).toLocaleString()} tables. It consumes the shared settings or spend lock, requires optimistic revisions, owns timestamps, records atomic audit/outbox receipts, and rejects altered replay. Separate Target qualification/settings, source-trust/status/sync, non-Target qualification, and mission-policy writers now close those lanes; source catalog import, provisioning, and reservation writers remain intentionally closed.`],
    ["Server-bound reviewed purchase-intent action and spend", signalActionSpendApplyModel?.qualificationSuiteParity === true && signalActionSpendApplyModel?.atomicQualificationApplyImplemented === true && signalActionSpendApplyModel?.sharedWriterLockProtocolImplemented === true && signalActionSpendApplyModel?.writerLockProtocolConsumed === true && signalActionSpendApplyModel?.constraintConfigBoundaryQualified === true && signalActionSpendApplyModel?.settingsPauseWriterParity === true && signalActionSpendApplyModel?.guardrailSettingsWriterParity === true && signalActionSpendApplyModel?.spendPolicyWriterParity === true && signalActionSpendApplyModel?.purchaseIntentOnly === false && signalActionSpendApplyModel?.strategyActionAuthority === false && signalActionSpendApplyModel?.strategySemanticsContractVersion === 2 && signalActionSpendApplyModel?.strategyDecisionSourceAccepted === true && signalActionSpendApplyModel?.strategyExistenceRevalidation === true && signalActionSpendApplyModel?.strategyFailoverToNotifyEnforced === true && signalActionSpendApplyModel?.strategyCartActionAuthority === false && signalActionSpendApplyModel?.strategyReservationAuthority === false && signalActionSpendApplyModel?.trustedStrategyActionSemanticsQualified === true && signalActionSpendApplyModel?.fixedOrderConfigurationLocks === true && signalActionSpendApplyModel?.currentMissionTargetRevalidation === true && signalActionSpendApplyModel?.currentPolicyRevalidation === true && signalActionSpendApplyModel?.currentSourceTrustRevalidation === true && signalActionSpendApplyModel?.currentRetailerQualificationRevalidation === true && signalActionSpendApplyModel?.currentSpendPolicyRevalidation === true && signalActionSpendApplyModel?.remainingQuantityRevalidation === true && signalActionSpendApplyModel?.siblingClaimRevalidation === true && signalActionSpendApplyModel?.cooldownRevalidation === true && signalActionSpendApplyModel?.periodicSpendRevalidation === true && signalActionSpendApplyModel?.exactProductBinding === true && signalActionSpendApplyModel?.exactFirstPartyFulfillmentOnly === true && signalActionSpendApplyModel?.quantityOneOnly === false && signalActionSpendApplyModel?.addToCartOnly === false && signalActionSpendApplyModel?.canonicalAttributionOnly === true && signalActionSpendApplyModel?.immutableReplay === true && signalActionSpendApplyModel?.lifecycleAwareReplay === true && signalActionSpendApplyModel?.actionSpendRepositoryParity === true && signalActionSpendApplyModel?.actionMutation === true && signalActionSpendApplyModel?.spendMutation === true && signalActionSpendApplyModel?.retailerMutation === false && signalActionSpendApplyModel?.checkoutMutation === false && signalActionSpendApplyModel?.orderSubmissionMutation === false && signalActionSpendApplyModel?.inboxLifecycleMutation === false && signalActionSpendApplyModel?.configurationWriterParity === false && signalActionSpendApplyModel?.reservationWriterParity === false && signalActionSpendApplyModel?.writerLockProtocolParity === false && signalActionSpendApplyModel?.attributionPolicyParity === false && signalActionSpendApplyModel?.directTableGrantCount === 0 && signalActionSpendApplyModel?.functionGrantCount === 1 && signalActionSpendApplyModel?.runtimeAuthority === false && signalActionSpendApplyModel?.productionReady === false, `A tenth independently inactive NOLOGIN boundary revalidates one exact reviewed purchase intent, current trusted first-party evidence matching the saved Shipping or Pickup choice, quantity and claim availability, retailer qualification, cooldown, and daily/monthly/per-order capacity for at most ${Number(signalActionSpendApplyModel?.maximumPlanAgeSeconds || 0).toLocaleString()} seconds. It consumes the shared writer-lock protocol after the qualified bounded configuration predecessor and can atomically create a quantity-one add-to-cart job, exact offer snapshot, active spend reservation, reserved ledger entry, qualified decision, audit, and outbox receipt across ${Number(signalActionSpendApplyModel?.mutationTableCount || 0).toLocaleString()} tables; reviewed purchase intents retain their guarded add/spend semantics unchanged. Separately qualified trusted strategy decisions may now produce only notification jobs, with strategy existence/enabled/revision revalidation enforced in the database; strategy-sourced cart actions and spend reservations remain structurally closed. Retailer mutation, checkout, order submission, and inbox completion remain closed; remaining request repositories and final handler composition still block activation.`],
    ["Complete signal-evaluation apply composition", signalEvaluationCompositionModel?.deterministicManifestImplemented === true && signalEvaluationCompositionModel?.chainSequenceContractVerified === true && signalEvaluationCompositionModel?.chainBoundaryCount === 11 && signalEvaluationCompositionModel?.mutationFamilyCount === 10 && signalEvaluationCompositionModel?.unmappedMutationFamilyCount === 0 && signalEvaluationCompositionModel?.noNewRoleCreated === true && signalEvaluationCompositionModel?.noNewFunctionCreated === true && signalEvaluationCompositionModel?.noNewMutationPath === true && signalEvaluationCompositionModel?.signalEvaluationApplyRepositoryParity === true && signalEvaluationCompositionModel?.signalEvaluationRepositoryParity === false && signalEvaluationCompositionModel?.signalIngressRepositoryParity === false && signalEvaluationCompositionModel?.hostedDeliveryHandlerRepositoryParity === false && signalEvaluationCompositionModel?.allHandlerRepositoryParity === false && signalEvaluationCompositionModel?.activePrincipalCount === 0 && signalEvaluationCompositionModel?.activeRuntimeRoleApplied === false && signalEvaluationCompositionModel?.mutationAuthority === true && signalEvaluationCompositionModel?.runtimeAuthority === false && signalEvaluationCompositionModel?.productionReady === false, `${Number(signalEvaluationCompositionModel?.chainBoundaryCount || 0).toLocaleString()} qualified signal writers now compose into one deterministically verified evaluation-apply closure — every one of ${Number(signalEvaluationCompositionModel?.mutationFamilyCount || 0).toLocaleString()} SQLite evaluation mutation families maps to exactly one qualified boundary with cross-boundary fingerprint binding — closing signal-evaluation apply repository parity, while the evaluation repository, durable ingress, hosted-delivery handler composition, and full handler parity remain open.`],
    ["Complete signal-evaluation repository composition", signalEvaluationRepositoryCompositionModel?.deterministicManifestImplemented === true && signalEvaluationRepositoryCompositionModel?.writerTrackConvergenceVerified === true && signalEvaluationRepositoryCompositionModel?.chainBoundaryCount === 5 && signalEvaluationRepositoryCompositionModel?.ownFamilyCount === 5 && signalEvaluationRepositoryCompositionModel?.delegatedFamilyCount === 10 && signalEvaluationRepositoryCompositionModel?.totalFamilyCount === 15 && signalEvaluationRepositoryCompositionModel?.unmappedOwnFamilyCount === 0 && signalEvaluationRepositoryCompositionModel?.noNewRoleCreated === true && signalEvaluationRepositoryCompositionModel?.noNewFunctionCreated === true && signalEvaluationRepositoryCompositionModel?.noNewMutationPath === true && signalEvaluationRepositoryCompositionModel?.signalEvaluationApplyRepositoryParity === true && signalEvaluationRepositoryCompositionModel?.signalEvaluationRepositoryParity === true && signalEvaluationRepositoryCompositionModel?.signalIngressRepositoryParity === false && signalEvaluationRepositoryCompositionModel?.hostedDeliveryHandlerRepositoryParity === false && signalEvaluationRepositoryCompositionModel?.allHandlerRepositoryParity === false && signalEvaluationRepositoryCompositionModel?.activePrincipalCount === 0 && signalEvaluationRepositoryCompositionModel?.activeRuntimeRoleApplied === false && signalEvaluationRepositoryCompositionModel?.mutationAuthority === true && signalEvaluationRepositoryCompositionModel?.runtimeAuthority === false && signalEvaluationRepositoryCompositionModel?.productionReady === false, `${Number(signalEvaluationRepositoryCompositionModel?.chainBoundaryCount || 0).toLocaleString()} qualified members — the hosted-delivery transport/plan boundary, the eleven-writer apply closure, the terminal reservation-lifecycle, attribution-receipt, and action-job lifecycle writers — now compose into one deterministically verified complete evaluation repository with cross-boundary fingerprint convergence and ${Number(signalEvaluationRepositoryCompositionModel?.totalFamilyCount || 0).toLocaleString()}-family total coverage, closing signal-evaluation repository parity while durable ingress and handler composition remain open.`],
    ["Server-bound signal-ingress acceptance", signalIngressEnqueueApplyModel?.qualificationSuiteParity === true && signalIngressEnqueueApplyModel?.atomicQualificationApplyImplemented === true && signalIngressEnqueueApplyModel?.serverBoundPrincipalLookup === true && signalIngressEnqueueApplyModel?.callerScopeHardcoded === true && signalIngressEnqueueApplyModel?.messageKeyDatabaseDerived === true && signalIngressEnqueueApplyModel?.payloadHashDatabaseDerived === true && signalIngressEnqueueApplyModel?.sanitizedEnvelopeAcceptedAsInput === true && signalIngressEnqueueApplyModel?.conflictingContentFailsClosed === true && signalIngressEnqueueApplyModel?.receiptLedgerAppendOnly === true && signalIngressEnqueueApplyModel?.deterministicRequestIdentity === true && signalIngressEnqueueApplyModel?.deterministicReceiptIdentity === true && signalIngressEnqueueApplyModel?.databaseOwnedTimestamps === true && signalIngressEnqueueApplyModel?.writerLockProtocolConsumed === false && signalIngressEnqueueApplyModel?.queueWriteBoundaryConsumed === true && signalIngressEnqueueApplyModel?.sourceTrustWriterParity === true && signalIngressEnqueueApplyModel?.sourceStatusWriterParity === true && signalIngressEnqueueApplyModel?.sourceSyncWriterParity === true && signalIngressEnqueueApplyModel?.catalogImportWriterParity === true && signalIngressEnqueueApplyModel?.connectionProvisioningWriterParity === true && signalIngressEnqueueApplyModel?.sourceWriterParity === true && signalIngressEnqueueApplyModel?.retailerQualificationWriterParity === true && signalIngressEnqueueApplyModel?.missionPolicyWriterParity === true && signalIngressEnqueueApplyModel?.settingsWriterParity === false && signalIngressEnqueueApplyModel?.configurationWriterParity === false && signalIngressEnqueueApplyModel?.reservationWriterParity === true && signalIngressEnqueueApplyModel?.attributionPolicyParity === true && signalIngressEnqueueApplyModel?.attributionReceiptWriterParity === true && signalIngressEnqueueApplyModel?.writerLockProtocolParity === false && signalIngressEnqueueApplyModel?.ingressEnqueueWriterParity === true && signalIngressEnqueueApplyModel?.signalIngressRepositoryParity === false && signalIngressEnqueueApplyModel?.directTableGrantCount === 0 && signalIngressEnqueueApplyModel?.functionGrantCount === 1 && signalIngressEnqueueApplyModel?.mutationAuthority === true && signalIngressEnqueueApplyModel?.sharedCatalogMutationAuthority === false && signalIngressEnqueueApplyModel?.actionAuthority === false && signalIngressEnqueueApplyModel?.runtimeAuthority === false && signalIngressEnqueueApplyModel?.productionReady === false, `A twenty-fifth independently inactive NOLOGIN boundary accepts one sanitized TrackaLacker signal envelope through one security-definer function — message identity and payload hash are derived and revalidated in the database, duplicate envelopes append only their own delivery receipt with zero inbox mutation, conflicting same-identity payloads fail closed, and the companion task wake rides the separately qualified tenant queue writer — closing the ingress-enqueue family while the durable-ingress composition remains open.`],
    ["Complete durable signal-ingress composition", signalIngressCompositionModel?.deterministicManifestImplemented === true && signalIngressCompositionModel?.sharedAncestryConvergenceVerified === true && signalIngressCompositionModel?.queueWriteConvergenceVerified === true && signalIngressCompositionModel?.leaseRecoveryConvergenceVerified === true && signalIngressCompositionModel?.chainBoundaryCount === 4 && signalIngressCompositionModel?.ownFamilyCount === 2 && signalIngressCompositionModel?.delegatedFamilyCount === 15 && signalIngressCompositionModel?.totalFamilyCount === 17 && signalIngressCompositionModel?.unmappedOwnFamilyCount === 0 && signalIngressCompositionModel?.noNewRoleCreated === true && signalIngressCompositionModel?.noNewFunctionCreated === true && signalIngressCompositionModel?.noNewMutationPath === true && signalIngressCompositionModel?.signalEvaluationApplyRepositoryParity === true && signalIngressCompositionModel?.signalEvaluationRepositoryParity === true && signalIngressCompositionModel?.signalIngressRepositoryParity === true && signalIngressCompositionModel?.hostedDeliveryHandlerRepositoryParity === false && signalIngressCompositionModel?.allHandlerRepositoryParity === false && signalIngressCompositionModel?.activePrincipalCount === 0 && signalIngressCompositionModel?.activeRuntimeRoleApplied === false && signalIngressCompositionModel?.mutationAuthority === true && signalIngressCompositionModel?.runtimeAuthority === false && signalIngressCompositionModel?.productionReady === false, `${Number(signalIngressCompositionModel?.chainBoundaryCount || 0).toLocaleString()} qualified members — the signal-ingress acceptance writer, the tenant queue writer it consumes, the hosted-delivery transport boundary, and the complete evaluation repository composition — now compose into one deterministically verified durable-ingress repository with cross-boundary fingerprint convergence and ${Number(signalIngressCompositionModel?.totalFamilyCount || 0).toLocaleString()}-family total coverage, closing durable signal-ingress repository parity while the final handler composition remains open.`],
    ["Server-bound dead-letter inbox reset", signalDeadLetterResetApplyModel?.qualificationSuiteParity === true && signalDeadLetterResetApplyModel?.atomicQualificationApplyImplemented === true && signalDeadLetterResetApplyModel?.serverBoundPrincipalLookup === true && signalDeadLetterResetApplyModel?.workerManagePermissionRevalidated === false && signalDeadLetterResetApplyModel?.inboxOwnershipRevalidated === true && signalDeadLetterResetApplyModel?.deadLetterStatePreconditionEnforced === true && signalDeadLetterResetApplyModel?.repeatedResetAfterReDeadLetterAllowed === true && signalDeadLetterResetApplyModel?.deterministicRequestIdentity === true && signalDeadLetterResetApplyModel?.auditedReplayGraphIdempotency === true && signalDeadLetterResetApplyModel?.atomicInboxReceiptAuditOutboxMutation === true && signalDeadLetterResetApplyModel?.databaseOwnedTimestamps === true && signalDeadLetterResetApplyModel?.deterministicReceiptIdentity === true && signalDeadLetterResetApplyModel?.writerLockProtocolConsumed === false && signalDeadLetterResetApplyModel?.sqliteValidationParity === true && signalDeadLetterResetApplyModel?.sourceTrustWriterParity === true && signalDeadLetterResetApplyModel?.sourceStatusWriterParity === true && signalDeadLetterResetApplyModel?.sourceSyncWriterParity === true && signalDeadLetterResetApplyModel?.catalogImportWriterParity === true && signalDeadLetterResetApplyModel?.connectionProvisioningWriterParity === true && signalDeadLetterResetApplyModel?.sourceWriterParity === true && signalDeadLetterResetApplyModel?.retailerQualificationWriterParity === true && signalDeadLetterResetApplyModel?.missionPolicyWriterParity === true && signalDeadLetterResetApplyModel?.settingsWriterParity === false && signalDeadLetterResetApplyModel?.configurationWriterParity === false && signalDeadLetterResetApplyModel?.reservationWriterParity === true && signalDeadLetterResetApplyModel?.attributionPolicyParity === true && signalDeadLetterResetApplyModel?.jobLifecycleWriterParity === true && signalDeadLetterResetApplyModel?.writerLockProtocolParity === false && signalDeadLetterResetApplyModel?.deadLetterResetWriterParity === true && signalDeadLetterResetApplyModel?.signalIngressRepositoryParity === false && signalDeadLetterResetApplyModel?.hostedDeliveryHandlerRepositoryParity === false && signalDeadLetterResetApplyModel?.allHandlerRepositoryParity === false && signalDeadLetterResetApplyModel?.directTableGrantCount === 0 && signalDeadLetterResetApplyModel?.functionGrantCount === 1 && signalDeadLetterResetApplyModel?.mutationAuthority === true && signalDeadLetterResetApplyModel?.runtimeAuthority === false && signalDeadLetterResetApplyModel?.productionReady === false, `A twenty-sixth independently inactive NOLOGIN boundary resets one operator-selected dead-lettered signal inbox message through one security-definer function — dead-letter state is a fail-closed precondition, the reset appends its own receipt-hash-verified delivery ledger row plus one audit and outbox pair, a legitimately re-dead-lettered message may be reset again, and replays echo the original audited result — closing the dead-letter-reset family while the final handler composition remains open.`],
    ["Server-bound notification-delivery ensure", signalNotificationEnsureApplyModel?.qualificationSuiteParity === true && signalNotificationEnsureApplyModel?.atomicQualificationApplyImplemented === true && signalNotificationEnsureApplyModel?.serverBoundPrincipalLookup === true && signalNotificationEnsureApplyModel?.jobOwnershipRevalidated === true && signalNotificationEnsureApplyModel?.notifyActionPreconditionEnforced === true && signalNotificationEnsureApplyModel?.notifyOnlyStatePreconditionEnforced === true && signalNotificationEnsureApplyModel?.deterministicRequestIdentity === true && signalNotificationEnsureApplyModel?.insertOrIgnoreReplayParity === true && signalNotificationEnsureApplyModel?.mutableDeliveryStateReplayEcho === true && signalNotificationEnsureApplyModel?.noAuditOrOutboxWrite === true && signalNotificationEnsureApplyModel?.databaseOwnedTimestamps === true && signalNotificationEnsureApplyModel?.deterministicDeliveryIdentity === true && signalNotificationEnsureApplyModel?.writerLockProtocolConsumed === false && signalNotificationEnsureApplyModel?.sqliteValidationParity === true && signalNotificationEnsureApplyModel?.sourceTrustWriterParity === true && signalNotificationEnsureApplyModel?.sourceStatusWriterParity === true && signalNotificationEnsureApplyModel?.sourceSyncWriterParity === true && signalNotificationEnsureApplyModel?.catalogImportWriterParity === true && signalNotificationEnsureApplyModel?.connectionProvisioningWriterParity === true && signalNotificationEnsureApplyModel?.sourceWriterParity === true && signalNotificationEnsureApplyModel?.retailerQualificationWriterParity === true && signalNotificationEnsureApplyModel?.missionPolicyWriterParity === true && signalNotificationEnsureApplyModel?.settingsWriterParity === false && signalNotificationEnsureApplyModel?.configurationWriterParity === false && signalNotificationEnsureApplyModel?.reservationWriterParity === true && signalNotificationEnsureApplyModel?.attributionPolicyParity === true && signalNotificationEnsureApplyModel?.jobLifecycleWriterParity === true && signalNotificationEnsureApplyModel?.writerLockProtocolParity === false && signalNotificationEnsureApplyModel?.deadLetterResetWriterParity === true && signalNotificationEnsureApplyModel?.notificationEnsureWriterParity === true && signalNotificationEnsureApplyModel?.signalIngressRepositoryParity === false && signalNotificationEnsureApplyModel?.hostedDeliveryHandlerRepositoryParity === false && signalNotificationEnsureApplyModel?.allHandlerRepositoryParity === false && signalNotificationEnsureApplyModel?.directTableGrantCount === 0 && signalNotificationEnsureApplyModel?.functionGrantCount === 1 && signalNotificationEnsureApplyModel?.mutationAuthority === true && signalNotificationEnsureApplyModel?.runtimeAuthority === false && signalNotificationEnsureApplyModel?.productionReady === false, `A twenty-seventh independently inactive NOLOGIN boundary ensures exactly one pending notification delivery for one owned notify-only action job through one security-definer function — an existing delivery is a true zero-write success that echoes the row's live state, and, matching SQLite exactly, no audit or outbox row is ever written on any path — closing the notification-ensure family while the final handler composition remains open.`],
    ["Complete signal-handler composition", signalHandlerCompositionModel?.deterministicManifestImplemented === true && signalHandlerCompositionModel?.witnessRefreshConvergenceVerified === true && signalHandlerCompositionModel?.deadLetterResetAncestryConvergenceVerified === true && signalHandlerCompositionModel?.chainBoundaryCount === 4 && signalHandlerCompositionModel?.taskKindCount === 7 && signalHandlerCompositionModel?.unmappedTaskKindCount === 0 && signalHandlerCompositionModel?.ownFamilyCount === 2 && signalHandlerCompositionModel?.unmappedOwnFamilyCount === 0 && signalHandlerCompositionModel?.noNewRoleCreated === true && signalHandlerCompositionModel?.noNewFunctionCreated === true && signalHandlerCompositionModel?.noNewMutationPath === true && signalHandlerCompositionModel?.signalEvaluationApplyRepositoryParity === true && signalHandlerCompositionModel?.signalEvaluationRepositoryParity === true && signalHandlerCompositionModel?.signalIngressRepositoryParity === true && signalHandlerCompositionModel?.hostedDeliveryHandlerRepositoryParity === true && signalHandlerCompositionModel?.allHandlerRepositoryParity === true && signalHandlerCompositionModel?.activePrincipalCount === 0 && signalHandlerCompositionModel?.activeRuntimeRoleApplied === false && signalHandlerCompositionModel?.mutationAuthority === true && signalHandlerCompositionModel?.runtimeAuthority === false && signalHandlerCompositionModel?.productionReady === false, `${Number(signalHandlerCompositionModel?.chainBoundaryCount || 0).toLocaleString()} qualified members — the six-handler-family observer-witness-refresh chain, the complete durable signal-ingress composition, the operator dead-letter inbox-reset writer, and the server-bound notification-delivery ensure writer — now compose into one deterministically verified complete PostgreSQL owner for every one of ${Number(signalHandlerCompositionModel?.taskKindCount || 0).toLocaleString()} background-task handler families with cross-boundary fingerprint convergence, closing hosted-delivery handler repository parity and full handler repository parity — the handler repository composition completes the hosted-signal plane's handler families.`],
    ["Server-bound attribution-receipt append", signalAttributionReceiptApplyModel?.qualificationSuiteParity === true && signalAttributionReceiptApplyModel?.atomicQualificationApplyImplemented === true && signalAttributionReceiptApplyModel?.serverBoundPrincipalLookup === true && signalAttributionReceiptApplyModel?.jobOwnershipRevalidated === true && signalAttributionReceiptApplyModel?.attributionSnapshotConsistencyRevalidated === true && signalAttributionReceiptApplyModel?.provisionedPolicyRowRequired === true && signalAttributionReceiptApplyModel?.policyIdentityRevalidated === true && signalAttributionReceiptApplyModel?.writerLockProtocolConsumed === false && signalAttributionReceiptApplyModel?.deterministicRequestIdentity === true && signalAttributionReceiptApplyModel?.insertOrIgnoreReplayParity === true && signalAttributionReceiptApplyModel?.auditedOnFreshRecordOnly === true && signalAttributionReceiptApplyModel?.immutableReceiptReplay === true && signalAttributionReceiptApplyModel?.databaseOwnedTimestamps === true && signalAttributionReceiptApplyModel?.databaseDerivedCanonicalUrlHash === true && signalAttributionReceiptApplyModel?.metadataNeverPersisted === true && signalAttributionReceiptApplyModel?.sourceTrustWriterParity === true && signalAttributionReceiptApplyModel?.sourceStatusWriterParity === true && signalAttributionReceiptApplyModel?.sourceSyncWriterParity === true && signalAttributionReceiptApplyModel?.catalogImportWriterParity === true && signalAttributionReceiptApplyModel?.connectionProvisioningWriterParity === true && signalAttributionReceiptApplyModel?.sourceWriterParity === true && signalAttributionReceiptApplyModel?.retailerQualificationWriterParity === true && signalAttributionReceiptApplyModel?.missionPolicyWriterParity === true && signalAttributionReceiptApplyModel?.settingsWriterParity === false && signalAttributionReceiptApplyModel?.configurationWriterParity === false && signalAttributionReceiptApplyModel?.reservationWriterParity === true && signalAttributionReceiptApplyModel?.attributionPolicyParity === true && signalAttributionReceiptApplyModel?.attributionReceiptWriterParity === true && signalAttributionReceiptApplyModel?.writerLockProtocolParity === false && signalAttributionReceiptApplyModel?.directTableGrantCount === 0 && signalAttributionReceiptApplyModel?.functionGrantCount === 1 && signalAttributionReceiptApplyModel?.mutationAuthority === true && signalAttributionReceiptApplyModel?.sharedCatalogMutationAuthority === false && signalAttributionReceiptApplyModel?.actionAuthority === false && signalAttributionReceiptApplyModel?.runtimeAuthority === false && signalAttributionReceiptApplyModel?.productionReady === false, `A twenty-third independently inactive NOLOGIN boundary appends exactly one derive-don't-trust affiliate-routing receipt per action job through one security-definer function — provider, route, policy, and canonical-URL hash are read and revalidated from the locked job graph, never accepted from the wire — with INSERT OR IGNORE zero-write duplicate parity and no audit flood; closes the attribution-receipt family from the evaluation-composition accounting while notification dispatch and post-creation job lifecycle remain open.`],
    ["Server-bound action-job lifecycle", signalJobLifecycleApplyModel?.qualificationSuiteParity === true && signalJobLifecycleApplyModel?.atomicQualificationApplyImplemented === true && signalJobLifecycleApplyModel?.serverBoundPrincipalLookup === true && signalJobLifecycleApplyModel?.writerLockProtocolConsumed === true && signalJobLifecycleApplyModel?.spendScopeConsumed === true && signalJobLifecycleApplyModel?.deterministicRequestIdentity === true && signalJobLifecycleApplyModel?.immutableTransitionReplay === true && signalJobLifecycleApplyModel?.lifecycleAwareOutboxReplay === true && signalJobLifecycleApplyModel?.currentJobOwnershipRevalidation === true && signalJobLifecycleApplyModel?.expectedCurrentStateRevalidation === true && signalJobLifecycleApplyModel?.legalTransitionTableEnforced === true && signalJobLifecycleApplyModel?.possibleMutationCancelGuardEnforced === true && signalJobLifecycleApplyModel?.crossTenantIncidentGuardEnforced === true && signalJobLifecycleApplyModel?.terminalIncidentClosureParity === true && signalJobLifecycleApplyModel?.reviewIncidentLockParity === true && signalJobLifecycleApplyModel?.missionFulfillmentMutation === true && signalJobLifecycleApplyModel?.checkoutMutation === false && signalJobLifecycleApplyModel?.orderSubmissionMutation === false && signalJobLifecycleApplyModel?.spendReservationMutationDeferred === true && signalJobLifecycleApplyModel?.atomicJobLifecycleAuditOutbox === true && signalJobLifecycleApplyModel?.databaseOwnedTimestamps === true && signalJobLifecycleApplyModel?.deviceCapabilityRevalidation === false && signalJobLifecycleApplyModel?.sqliteValidationParity === true && signalJobLifecycleApplyModel?.sourceTrustWriterParity === true && signalJobLifecycleApplyModel?.sourceStatusWriterParity === true && signalJobLifecycleApplyModel?.sourceSyncWriterParity === true && signalJobLifecycleApplyModel?.catalogImportWriterParity === true && signalJobLifecycleApplyModel?.connectionProvisioningWriterParity === true && signalJobLifecycleApplyModel?.sourceWriterParity === true && signalJobLifecycleApplyModel?.retailerQualificationWriterParity === true && signalJobLifecycleApplyModel?.missionPolicyWriterParity === true && signalJobLifecycleApplyModel?.settingsWriterParity === false && signalJobLifecycleApplyModel?.configurationWriterParity === false && signalJobLifecycleApplyModel?.reservationWriterParity === true && signalJobLifecycleApplyModel?.attributionPolicyParity === true && signalJobLifecycleApplyModel?.jobLifecycleWriterParity === true && signalJobLifecycleApplyModel?.writerLockProtocolParity === false && signalJobLifecycleApplyModel?.directTableGrantCount === 0 && signalJobLifecycleApplyModel?.functionGrantCount === 1 && signalJobLifecycleApplyModel?.mutationAuthority === true && signalJobLifecycleApplyModel?.jobLifecycleMutationAuthority === true && signalJobLifecycleApplyModel?.actionAuthority === false && signalJobLifecycleApplyModel?.checkoutAuthority === false && signalJobLifecycleApplyModel?.orderSubmissionAuthority === false && signalJobLifecycleApplyModel?.runtimeAuthority === false && signalJobLifecycleApplyModel?.productionReady === false, `A twenty-fourth independently inactive NOLOGIN boundary applies the complete forty-seven-edge post-creation job state machine under the spend lock — optimistic expected-state preconditions, manual-resolution cancel guards, incident close/lock lifecycle, and the first qualified missions fulfilled-quantity commitment — across ${Number(signalJobLifecycleApplyModel?.mutationTableCount || 0).toLocaleString()} mutation tables, while spend reservations and ledger accounting remain exclusively with the terminal reservation-lifecycle writer. This closes the post-creation job-lifecycle family; notification dispatch and the operator dead-letter inbox-reset remain open.`],
    ["Server-bound Target qualification and settings activation", signalTargetQualificationApplyModel?.qualificationSuiteParity === true && signalTargetQualificationApplyModel?.atomicQualificationApplyImplemented === true && signalTargetQualificationApplyModel?.serverBoundPrincipalLookup === true && signalTargetQualificationApplyModel?.sharedWriterLockProtocolImplemented === true && signalTargetQualificationApplyModel?.writerLockProtocolConsumed === true && signalTargetQualificationApplyModel?.retailerQualificationScopeConsumed === true && signalTargetQualificationApplyModel?.settingsScopeConsumed === true && signalTargetQualificationApplyModel?.databaseOwnedTimestamps === true && signalTargetQualificationApplyModel?.deterministicRequestIdentity === true && signalTargetQualificationApplyModel?.immutableRequestReplay === true && signalTargetQualificationApplyModel?.lifecycleAwareOutboxReplay === true && signalTargetQualificationApplyModel?.atomicQualificationSettingsPromotionAuditOutbox === true && signalTargetQualificationApplyModel?.currentEvidenceRevalidation === true && signalTargetQualificationApplyModel?.currentDeviceCapabilityRevalidation === true && signalTargetQualificationApplyModel?.targetQualificationSettingsWriterParity === true && signalTargetQualificationApplyModel?.targetJobPromotionParity === true && signalTargetQualificationApplyModel?.qualificationSettingsWriterParity === true && signalTargetQualificationApplyModel?.sourceWriterParity === false && signalTargetQualificationApplyModel?.retailerQualificationWriterParity === false && signalTargetQualificationApplyModel?.missionPolicyWriterParity === false && signalTargetQualificationApplyModel?.configurationWriterParity === false && signalTargetQualificationApplyModel?.reservationWriterParity === false && signalTargetQualificationApplyModel?.writerLockProtocolParity === false && signalTargetQualificationApplyModel?.directTableGrantCount === 0 && signalTargetQualificationApplyModel?.functionGrantCount === 1 && signalTargetQualificationApplyModel?.runtimeAuthority === false && signalTargetQualificationApplyModel?.productionReady === false, `A thirteenth independently inactive NOLOGIN boundary revalidates the exact current 30-day Target dossier, passed no-click rehearsal, current Target add-v2 companion, and settings revision. It consumes retailer-qualification then settings locks and atomically qualifies Target, enables live unpaused settings, promotes only fresh first-party remote-fulfillment quantity-one jobs, and appends replay-safe receipts across ${Number(signalTargetQualificationApplyModel?.mutationTableCount || 0).toLocaleString()} mutation tables. Version 0.89 separately closes Walmart, Amazon, and Best Buy activation parity behind a shared-catalog-safe writer.`],
    ["Server-bound source-trust configuration", signalSourceTrustApplyModel?.qualificationSuiteParity === true && signalSourceTrustApplyModel?.atomicQualificationApplyImplemented === true && signalSourceTrustApplyModel?.serverBoundPrincipalLookup === true && signalSourceTrustApplyModel?.sharedWriterLockProtocolImplemented === true && signalSourceTrustApplyModel?.writerLockProtocolConsumed === true && signalSourceTrustApplyModel?.sourceScopeConsumed === true && signalSourceTrustApplyModel?.databaseOwnedTimestamps === true && signalSourceTrustApplyModel?.optimisticConcurrency === true && signalSourceTrustApplyModel?.deterministicRequestIdentity === true && signalSourceTrustApplyModel?.immutableRequestReplay === true && signalSourceTrustApplyModel?.lifecycleAwareOutboxReplay === true && signalSourceTrustApplyModel?.atomicSourceAuditOutbox === true && signalSourceTrustApplyModel?.currentSourceOwnershipRevalidation === true && signalSourceTrustApplyModel?.privateSourceOnly === true && signalSourceTrustApplyModel?.trustedExactAutoCreateCoupling === true && signalSourceTrustApplyModel?.sourceTrustWriterParity === true && signalSourceTrustApplyModel?.sourceWriterParity === false && signalSourceTrustApplyModel?.retailerQualificationWriterParity === false && signalSourceTrustApplyModel?.missionPolicyWriterParity === false && signalSourceTrustApplyModel?.configurationWriterParity === false && signalSourceTrustApplyModel?.reservationWriterParity === false && signalSourceTrustApplyModel?.writerLockProtocolParity === false && signalSourceTrustApplyModel?.directTableGrantCount === 0 && signalSourceTrustApplyModel?.functionGrantCount === 1 && signalSourceTrustApplyModel?.runtimeAuthority === false && signalSourceTrustApplyModel?.productionReady === false, `A fourteenth independently inactive NOLOGIN boundary consumes the shared source lock, revalidates one exact private user-owned connection and optimistic timestamp, and atomically updates trust plus replay-safe audit/outbox receipts across ${Number(signalSourceTrustApplyModel?.mutationTableCount || 0).toLocaleString()} tables. Informational sources can never create missions. General connection lifecycle/status and reservation writers remain closed; versions 0.89 and 0.90 separately close non-Target qualification and mission-policy parity.`],
    ["Server-bound Walmart, Amazon, and Best Buy qualification", signalRetailerQualificationApplyModel?.qualificationSuiteParity === true && signalRetailerQualificationApplyModel?.atomicQualificationApplyImplemented === true && signalRetailerQualificationApplyModel?.serverBoundPrincipalLookup === true && signalRetailerQualificationApplyModel?.sharedWriterLockProtocolImplemented === true && signalRetailerQualificationApplyModel?.writerLockProtocolConsumed === true && signalRetailerQualificationApplyModel?.retailerQualificationScopeConsumed === true && signalRetailerQualificationApplyModel?.settingsScopeConsumed === true && signalRetailerQualificationApplyModel?.globalRetailerSerialization === true && signalRetailerQualificationApplyModel?.exactPackagedRetailerAllowlist === true && signalRetailerQualificationApplyModel?.monotonicSharedCatalogPromotion === true && signalRetailerQualificationApplyModel?.currentEvidenceRevalidation === true && signalRetailerQualificationApplyModel?.currentDeviceCapabilityRevalidation === true && signalRetailerQualificationApplyModel?.currentSettingsRevalidation === true && signalRetailerQualificationApplyModel?.nonTargetQualificationWriterParity === true && signalRetailerQualificationApplyModel?.nonTargetJobPromotionParity === true && signalRetailerQualificationApplyModel?.sharedCatalogExecutionWriterParity === true && signalRetailerQualificationApplyModel?.qualificationSettingsWriterParity === true && signalRetailerQualificationApplyModel?.sourceTrustWriterParity === true && signalRetailerQualificationApplyModel?.sourceWriterParity === false && signalRetailerQualificationApplyModel?.retailerQualificationWriterParity === true && signalRetailerQualificationApplyModel?.configurationWriterParity === false && signalRetailerQualificationApplyModel?.reservationWriterParity === false && signalRetailerQualificationApplyModel?.writerLockProtocolParity === false && signalRetailerQualificationApplyModel?.directTableGrantCount === 0 && signalRetailerQualificationApplyModel?.functionGrantCount === 1 && signalRetailerQualificationApplyModel?.sharedCatalogMutationAuthority === true && signalRetailerQualificationApplyModel?.retailerMutationAuthority === false && signalRetailerQualificationApplyModel?.runtimeAuthority === false && signalRetailerQualificationApplyModel?.productionReady === false, `A fifteenth independently inactive NOLOGIN boundary accepts only the three packaged non-Target add lanes, revalidates each exact 30-day dossier, no-click rehearsal, and Chrome capability, then consumes retailer/settings locks plus a retailer-global catalog lock. It can only promote execution support monotonically across ${Number(signalRetailerQualificationApplyModel?.protectedSharedCatalogTableCount || 0).toLocaleString()} exact shared tables and mutate ${Number(signalRetailerQualificationApplyModel?.tenantMutationTableCount || 0).toLocaleString()} tenant tables. Arbitrary catalog changes, browser mutation, checkout, orders, and runtime authority remain closed.`],
    ["Server-side rule policy revision", signalMissionPolicyApplyModel?.qualificationSuiteParity === true && signalMissionPolicyApplyModel?.atomicQualificationApplyImplemented === true && signalMissionPolicyApplyModel?.serverBoundPrincipalLookup === true && signalMissionPolicyApplyModel?.sharedWriterLockProtocolImplemented === true && signalMissionPolicyApplyModel?.writerLockProtocolConsumed === true && signalMissionPolicyApplyModel?.settingsScopeConsumed === true && signalMissionPolicyApplyModel?.missionPolicyScopeConsumed === true && signalMissionPolicyApplyModel?.optimisticConcurrency === true && signalMissionPolicyApplyModel?.immutableRequestReplay === true && signalMissionPolicyApplyModel?.zeroWriteUnchangedPolicy === true && signalMissionPolicyApplyModel?.appendOnlyPolicyRevision === true && signalMissionPolicyApplyModel?.atomicPolicyAuditOutbox === true && signalMissionPolicyApplyModel?.currentMissionOwnershipRevalidation === true && signalMissionPolicyApplyModel?.currentTargetSnapshotRevalidation === true && signalMissionPolicyApplyModel?.currentSettingsRevalidation === true && signalMissionPolicyApplyModel?.policyHashV2Parity === true && signalMissionPolicyApplyModel?.directPurchaseSafetyParity === true && signalMissionPolicyApplyModel?.sourceWriterParity === false && signalMissionPolicyApplyModel?.retailerQualificationWriterParity === true && signalMissionPolicyApplyModel?.missionPolicyWriterParity === true && signalMissionPolicyApplyModel?.configurationWriterParity === false && signalMissionPolicyApplyModel?.reservationWriterParity === false && signalMissionPolicyApplyModel?.directTableGrantCount === 0 && signalMissionPolicyApplyModel?.functionGrantCount === 1 && signalMissionPolicyApplyModel?.sharedCatalogMutationAuthority === false && signalMissionPolicyApplyModel?.actionAuthority === false && signalMissionPolicyApplyModel?.runtimeAuthority === false && signalMissionPolicyApplyModel?.productionReady === false, `A sixteenth independently inactive NOLOGIN boundary accepts one exact full replacement of a user's current rule policy. It consumes settings and mission-policy locks, revalidates ownership, revision, hash, all targets, listings, tax, and store allowances, preserves the byte-identical intent-policy-v2 hash, and appends one revision plus audit/outbox receipts across ${Number(signalMissionPolicyApplyModel?.mutationTableCount || 0).toLocaleString()} tables. Unchanged policy is a true zero-write success; unsafe direct-purchase preferences fail closed and no action or catalog mutation authority is granted.`],
    ["Server-bound TrackaLacker source status", signalSourceStatusApplyModel?.qualificationSuiteParity === true && signalSourceStatusApplyModel?.atomicQualificationApplyImplemented === true && signalSourceStatusApplyModel?.serverBoundPrincipalLookup === true && signalSourceStatusApplyModel?.sharedWriterLockProtocolImplemented === true && signalSourceStatusApplyModel?.writerLockProtocolConsumed === true && signalSourceStatusApplyModel?.sourceScopeConsumed === true && signalSourceStatusApplyModel?.deterministicRequestIdentity === true && signalSourceStatusApplyModel?.immutableMaterialReplay === true && signalSourceStatusApplyModel?.latestStateReplayOnly === true && signalSourceStatusApplyModel?.nonMaterialAuditSuppression === true && signalSourceStatusApplyModel?.monotonicDeviceTimestamp === true && signalSourceStatusApplyModel?.databaseOwnedEventTimestamps === true && signalSourceStatusApplyModel?.clientObservedAtPreserved === true && signalSourceStatusApplyModel?.atomicMaterialStatusAuditOutbox === true && signalSourceStatusApplyModel?.currentSourceOwnershipRevalidation === true && signalSourceStatusApplyModel?.currentDeviceOwnershipRevalidation === true && signalSourceStatusApplyModel?.activeDeviceOnly === true && signalSourceStatusApplyModel?.privateSourceOnly === true && signalSourceStatusApplyModel?.trackalackerOnly === true && signalSourceStatusApplyModel?.materialChangeAuditParity === true && signalSourceStatusApplyModel?.sourceTrustWriterParity === true && signalSourceStatusApplyModel?.sourceStatusWriterParity === true && signalSourceStatusApplyModel?.sourceSyncWriterParity === false && signalSourceStatusApplyModel?.sourceWriterParity === false && signalSourceStatusApplyModel?.retailerQualificationWriterParity === true && signalSourceStatusApplyModel?.missionPolicyWriterParity === true && signalSourceStatusApplyModel?.configurationWriterParity === false && signalSourceStatusApplyModel?.reservationWriterParity === false && signalSourceStatusApplyModel?.directTableGrantCount === 0 && signalSourceStatusApplyModel?.functionGrantCount === 1 && signalSourceStatusApplyModel?.sharedCatalogMutationAuthority === false && signalSourceStatusApplyModel?.actionAuthority === false && signalSourceStatusApplyModel?.runtimeAuthority === false && signalSourceStatusApplyModel?.productionReady === false, `A seventeenth independently inactive NOLOGIN boundary consumes the source lock and revalidates one exact private TrackaLacker connection plus active user-owned Chrome device. It rejects stale or colliding client timestamps, updates only device/connection status across ${Number(signalSourceStatusApplyModel?.mutationTableCount || 0).toLocaleString()} tables, appends replay-safe audit/outbox receipts only for material changes, and explicitly treats timestamp-only heartbeats as latest-state replay rather than fictional immutable history. A later separate boundary closes source-sync run/item parity; catalog import and provisioning remain closed.`],
    ["Server-bound TrackaLacker source sync", signalSourceSyncApplyModel?.qualificationSuiteParity === true && signalSourceSyncApplyModel?.atomicQualificationApplyImplemented === true && signalSourceSyncApplyModel?.serverBoundPrincipalLookup === true && signalSourceSyncApplyModel?.writerLockProtocolConsumed === true && signalSourceSyncApplyModel?.sourceScopeConsumed === true && signalSourceSyncApplyModel?.deterministicRequestIdentity === true && signalSourceSyncApplyModel?.immutableAuditedReplay === true && signalSourceSyncApplyModel?.latestStateProgressReplay === true && signalSourceSyncApplyModel?.latestStateItemReplay === true && signalSourceSyncApplyModel?.monotonicProgressCounters === true && signalSourceSyncApplyModel?.boundedActiveRunExclusion === true && signalSourceSyncApplyModel?.staleRunInterruptionParity === true && signalSourceSyncApplyModel?.terminalAuditParity === true && signalSourceSyncApplyModel?.nonTerminalAuditSuppression === true && signalSourceSyncApplyModel?.itemReceiptUpsertParity === true && signalSourceSyncApplyModel?.databaseOwnedTimestamps === true && signalSourceSyncApplyModel?.privacyBoundedMessages === true && signalSourceSyncApplyModel?.atomicRunAuditOutbox === true && signalSourceSyncApplyModel?.currentSourceOwnershipRevalidation === true && signalSourceSyncApplyModel?.currentDeviceOwnershipRevalidation === true && signalSourceSyncApplyModel?.currentRunOwnershipRevalidation === true && signalSourceSyncApplyModel?.activeDeviceOnly === true && signalSourceSyncApplyModel?.activeRunItemOnly === true && signalSourceSyncApplyModel?.privateSourceOnly === true && signalSourceSyncApplyModel?.trackalackerOnly === true && signalSourceSyncApplyModel?.catalogImportExcluded === true && signalSourceSyncApplyModel?.sourceStatusWriterParity === true && signalSourceSyncApplyModel?.sourceSyncWriterParity === true && signalSourceSyncApplyModel?.sourceWriterParity === false && signalSourceSyncApplyModel?.directTableGrantCount === 0 && signalSourceSyncApplyModel?.functionGrantCount === 1 && signalSourceSyncApplyModel?.sharedCatalogMutationAuthority === false && signalSourceSyncApplyModel?.actionAuthority === false && signalSourceSyncApplyModel?.runtimeAuthority === false && signalSourceSyncApplyModel?.productionReady === false, `An eighteenth independently inactive NOLOGIN boundary accepts three exact run/progress/item operations under the source lock. It enforces one fresh run per device, monotonic counters, active-run-only item receipts, privacy-bounded messages, terminal audit/outbox replay, and latest-state semantics for unaudited progress/item refreshes across ${Number(signalSourceSyncApplyModel?.mutationTableCount || 0).toLocaleString()} tables. Catalog import and source provisioning remain separately closed.`],
    ["Server-bound spend-reservation lifecycle", signalReservationLifecycleApplyModel?.qualificationSuiteParity === true && signalReservationLifecycleApplyModel?.atomicQualificationApplyImplemented === true && signalReservationLifecycleApplyModel?.serverBoundPrincipalLookup === true && signalReservationLifecycleApplyModel?.sharedWriterLockProtocolImplemented === true && signalReservationLifecycleApplyModel?.writerLockProtocolConsumed === true && signalReservationLifecycleApplyModel?.spendScopeConsumed === true && signalReservationLifecycleApplyModel?.deterministicRequestIdentity === true && signalReservationLifecycleApplyModel?.immutableLifecycleReplay === true && signalReservationLifecycleApplyModel?.lifecycleAwareOutboxReplay === true && signalReservationLifecycleApplyModel?.currentActionReservationGraphRevalidation === true && signalReservationLifecycleApplyModel?.terminalReleaseStateRevalidation === true && signalReservationLifecycleApplyModel?.serverClockExpiryRelease === true && signalReservationLifecycleApplyModel?.possibleMutationExpiryReleaseBlocked === true && signalReservationLifecycleApplyModel?.verifiedSubmitOrderCommit === true && signalReservationLifecycleApplyModel?.unambiguousVerifiedTotal === true && signalReservationLifecycleApplyModel?.reservationCreationPredecessorParity === true && signalReservationLifecycleApplyModel?.reservationReleaseParity === true && signalReservationLifecycleApplyModel?.reservationCommitParity === true && signalReservationLifecycleApplyModel?.appendOnlyLedgerParity === true && signalReservationLifecycleApplyModel?.atomicReservationLedgerAuditOutbox === true && signalReservationLifecycleApplyModel?.databaseOwnedTimestamps === true && signalReservationLifecycleApplyModel?.missionFulfillmentMutation === false && signalReservationLifecycleApplyModel?.checkoutMutation === false && signalReservationLifecycleApplyModel?.orderSubmissionMutation === false && signalReservationLifecycleApplyModel?.sourceSyncWriterParity === true && signalReservationLifecycleApplyModel?.sourceWriterParity === false && signalReservationLifecycleApplyModel?.retailerQualificationWriterParity === true && signalReservationLifecycleApplyModel?.missionPolicyWriterParity === true && signalReservationLifecycleApplyModel?.configurationWriterParity === false && signalReservationLifecycleApplyModel?.reservationWriterParity === true && signalReservationLifecycleApplyModel?.writerLockProtocolParity === false && signalReservationLifecycleApplyModel?.directTableGrantCount === 0 && signalReservationLifecycleApplyModel?.functionGrantCount === 1 && signalReservationLifecycleApplyModel?.mutationAuthority === true && signalReservationLifecycleApplyModel?.spendMutationAuthority === true && signalReservationLifecycleApplyModel?.actionAuthority === false && signalReservationLifecycleApplyModel?.checkoutAuthority === false && signalReservationLifecycleApplyModel?.orderSubmissionAuthority === false && signalReservationLifecycleApplyModel?.runtimeAuthority === false && signalReservationLifecycleApplyModel?.productionReady === false, `A nineteenth independently inactive NOLOGIN boundary consumes only the shared spend lock, revalidates the exact current action/reservation graph, and atomically releases server-verifiable terminal reservations or database-expired reservations before any possible retailer mutation, or commits an exact confirmed submit-order total across ${Number(signalReservationLifecycleApplyModel?.mutationTableCount || 0).toLocaleString()} tables. Every applied transition appends an immutable ledger entry plus audited outbox receipt; exact retries write nothing. It cannot change action state, fill checkout, submit an order, fulfill a mission, or activate PostgreSQL runtime authority.`],
    ["Server-bound TrackaLacker catalog import", signalCatalogImportApplyModel?.qualificationSuiteParity === true && signalCatalogImportApplyModel?.atomicQualificationApplyImplemented === true && signalCatalogImportApplyModel?.serverBoundPrincipalLookup === true && signalCatalogImportApplyModel?.sharedWriterLockProtocolImplemented === true && signalCatalogImportApplyModel?.writerLockProtocolConsumed === true && signalCatalogImportApplyModel?.sourceScopeConsumed === true && signalCatalogImportApplyModel?.deterministicRequestIdentity === true && signalCatalogImportApplyModel?.immutableAuditedReplay === true && signalCatalogImportApplyModel?.boundedCatalogPayload === true && signalCatalogImportApplyModel?.completeSetIdentityConsensus === true && signalCatalogImportApplyModel?.crossTenantCatalogSerialization === true && signalCatalogImportApplyModel?.sourceProductConflictFailClosed === true && signalCatalogImportApplyModel?.sourceAliasConflictFailClosed === true && signalCatalogImportApplyModel?.sourceListingConflictFailClosed === true && signalCatalogImportApplyModel?.sourceCandidateConflictFailClosed === true && signalCatalogImportApplyModel?.registeredRetailerRevalidation === true && signalCatalogImportApplyModel?.canonicalRetailerUrlRevalidation === true && signalCatalogImportApplyModel?.serverDerivedExecutionSupport === true && signalCatalogImportApplyModel?.monotonicSourceObservation === true && signalCatalogImportApplyModel?.candidateUpsertParity === true && signalCatalogImportApplyModel?.listingUpsertParity === true && signalCatalogImportApplyModel?.sourceReferenceUpsertParity === true && signalCatalogImportApplyModel?.preferredRetailerRouteParity === true && signalCatalogImportApplyModel?.idempotentOfferObservation === true && signalCatalogImportApplyModel?.existingMissionTargetAttachmentParity === true && signalCatalogImportApplyModel?.optionalSyncItemCompositionParity === true && signalCatalogImportApplyModel?.atomicCatalogSyncAuditOutbox === true && signalCatalogImportApplyModel?.databaseOwnedTimestamps === true && signalCatalogImportApplyModel?.privacyBoundedReceipts === true && signalCatalogImportApplyModel?.currentSourceOwnershipRevalidation === true && signalCatalogImportApplyModel?.currentDeviceOwnershipRevalidation === true && signalCatalogImportApplyModel?.currentRunOwnershipRevalidation === true && signalCatalogImportApplyModel?.activeDeviceOnly === true && signalCatalogImportApplyModel?.activeRunItemOnly === true && signalCatalogImportApplyModel?.privateSourceOnly === true && signalCatalogImportApplyModel?.trackalackerOnly === true && signalCatalogImportApplyModel?.sourceTrustWriterParity === true && signalCatalogImportApplyModel?.sourceStatusWriterParity === true && signalCatalogImportApplyModel?.sourceSyncWriterParity === true && signalCatalogImportApplyModel?.catalogImportWriterParity === true && signalCatalogImportApplyModel?.connectionProvisioningWriterParity === false && signalCatalogImportApplyModel?.sourceWriterParity === false && signalCatalogImportApplyModel?.retailerQualificationWriterParity === true && signalCatalogImportApplyModel?.missionPolicyWriterParity === true && signalCatalogImportApplyModel?.settingsWriterParity === false && signalCatalogImportApplyModel?.configurationWriterParity === false && signalCatalogImportApplyModel?.reservationWriterParity === true && signalCatalogImportApplyModel?.writerLockProtocolParity === false && signalCatalogImportApplyModel?.directTableGrantCount === 0 && signalCatalogImportApplyModel?.functionGrantCount === 1 && signalCatalogImportApplyModel?.mutationAuthority === true && signalCatalogImportApplyModel?.sharedCatalogMutationAuthority === true && signalCatalogImportApplyModel?.actionAuthority === false && signalCatalogImportApplyModel?.runtimeAuthority === false && signalCatalogImportApplyModel?.productionReady === false, `A twentieth independently inactive NOLOGIN boundary consumes the source lock and accepts one exact, complete-set item import bounded to ${Number(signalCatalogImportApplyModel?.maximumListingsPerItem || 0).toLocaleString()} listings per item across ${Number(signalCatalogImportApplyModel?.supportedExecutionRetailerCount || 0).toLocaleString()} canonical retailer formats. It revalidates the registered retailer and canonical URL for every candidate, fails closed on any product, alias, listing, or candidate identity conflict, and atomically upserts candidates, listings, source references, and preferred routes plus idempotent offer observations and optional existing-mission-target attachment across ${Number(signalCatalogImportApplyModel?.sharedCatalogMutationTableCount || 0).toLocaleString()} shared catalog tables and ${Number(signalCatalogImportApplyModel?.totalMutationTableCount || 0).toLocaleString()} total tables through one security-definer function. Source provisioning remains separately closed.`],
    ["Server-bound source-connection provisioning", signalSourceProvisioningApplyModel?.qualificationSuiteParity === true && signalSourceProvisioningApplyModel?.atomicQualificationApplyImplemented === true && signalSourceProvisioningApplyModel?.serverBoundPrincipalLookup === true && signalSourceProvisioningApplyModel?.sharedWriterLockProtocolImplemented === true && signalSourceProvisioningApplyModel?.writerLockProtocolConsumed === true && signalSourceProvisioningApplyModel?.sourceScopeConsumed === true && signalSourceProvisioningApplyModel?.deterministicRequestIdentity === true && signalSourceProvisioningApplyModel?.deterministicConnectionIdentity === true && signalSourceProvisioningApplyModel?.sqliteOwnedIdParity === true && signalSourceProvisioningApplyModel?.immutableAuditedReplay === true && signalSourceProvisioningApplyModel?.zeroWriteWhenAlreadyProvisioned === true && signalSourceProvisioningApplyModel?.existingIdentityConflictFailClosed === true && signalSourceProvisioningApplyModel?.atomicProvisioningAuditOutbox === true && signalSourceProvisioningApplyModel?.databaseOwnedTimestamps === true && signalSourceProvisioningApplyModel?.privateSourceOnly === true && signalSourceProvisioningApplyModel?.disconnectedInitialStatus === true && signalSourceProvisioningApplyModel?.sourceTrustWriterParity === true && signalSourceProvisioningApplyModel?.sourceStatusWriterParity === true && signalSourceProvisioningApplyModel?.sourceSyncWriterParity === true && signalSourceProvisioningApplyModel?.catalogImportWriterParity === true && signalSourceProvisioningApplyModel?.connectionProvisioningWriterParity === true && signalSourceProvisioningApplyModel?.sourceWriterParity === true && signalSourceProvisioningApplyModel?.retailerQualificationWriterParity === true && signalSourceProvisioningApplyModel?.missionPolicyWriterParity === true && signalSourceProvisioningApplyModel?.settingsWriterParity === false && signalSourceProvisioningApplyModel?.configurationWriterParity === false && signalSourceProvisioningApplyModel?.reservationWriterParity === true && signalSourceProvisioningApplyModel?.writerLockProtocolParity === false && signalSourceProvisioningApplyModel?.directTableGrantCount === 0 && signalSourceProvisioningApplyModel?.functionGrantCount === 1 && signalSourceProvisioningApplyModel?.mutationAuthority === true && signalSourceProvisioningApplyModel?.sharedCatalogMutationAuthority === false && signalSourceProvisioningApplyModel?.actionAuthority === false && signalSourceProvisioningApplyModel?.runtimeAuthority === false && signalSourceProvisioningApplyModel?.productionReady === false, `A twenty-first independently inactive NOLOGIN boundary consumes the source lock and idempotently provisions the ${Number(signalSourceProvisioningApplyModel?.defaultSourceConnectionCount || 0).toLocaleString()} exact default private source connections (${Number(signalSourceProvisioningApplyModel?.trustedExactSourceCount || 0).toLocaleString()} trusted-exact, ${Number(signalSourceProvisioningApplyModel?.informationalSourceCount || 0).toLocaleString()} informational) under one security-definer function, with deterministic SQLite-parity owned identity, disconnected initial status, and exact trust levels across ${Number(signalSourceProvisioningApplyModel?.mutationTableCount || 0).toLocaleString()} tables. Already-provisioned principals see a true zero-write unchanged replay with no audit flood, and any existing connection whose identity conflicts fails closed. This closes the aggregate source-writer parity boundary; the shared writer-lock protocol aggregate remains open.`],
    ["Server-bound attribution-policy replacement", signalAttributionPolicyApplyModel?.qualificationSuiteParity === true && signalAttributionPolicyApplyModel?.atomicQualificationApplyImplemented === true && signalAttributionPolicyApplyModel?.serverBoundPrincipalLookup === true && signalAttributionPolicyApplyModel?.rowLevelLockSerialization === true && signalAttributionPolicyApplyModel?.writerLockProtocolConsumed === false && signalAttributionPolicyApplyModel?.provisionedRowExistenceRequired === true && signalAttributionPolicyApplyModel?.completeRetailerSetRequired === true && signalAttributionPolicyApplyModel?.fixedRetailerOrderNormalization === true && signalAttributionPolicyApplyModel?.deterministicRequestIdentity === true && signalAttributionPolicyApplyModel?.immutableAuditedReplay === true && signalAttributionPolicyApplyModel?.zeroWriteWhenUnchanged === true && signalAttributionPolicyApplyModel?.missingRowFailsClosed === true && signalAttributionPolicyApplyModel?.atomicReplaceAuditOutbox === true && signalAttributionPolicyApplyModel?.databaseOwnedTimestamps === true && signalAttributionPolicyApplyModel?.sqliteValidationParity === true && signalAttributionPolicyApplyModel?.sourceTrustWriterParity === true && signalAttributionPolicyApplyModel?.sourceStatusWriterParity === true && signalAttributionPolicyApplyModel?.sourceSyncWriterParity === true && signalAttributionPolicyApplyModel?.catalogImportWriterParity === true && signalAttributionPolicyApplyModel?.connectionProvisioningWriterParity === true && signalAttributionPolicyApplyModel?.sourceWriterParity === true && signalAttributionPolicyApplyModel?.retailerQualificationWriterParity === true && signalAttributionPolicyApplyModel?.missionPolicyWriterParity === true && signalAttributionPolicyApplyModel?.settingsWriterParity === false && signalAttributionPolicyApplyModel?.configurationWriterParity === false && signalAttributionPolicyApplyModel?.reservationWriterParity === true && signalAttributionPolicyApplyModel?.attributionPolicyParity === true && signalAttributionPolicyApplyModel?.writerLockProtocolParity === false && signalAttributionPolicyApplyModel?.directTableGrantCount === 0 && signalAttributionPolicyApplyModel?.functionGrantCount === 1 && signalAttributionPolicyApplyModel?.mutationAuthority === true && signalAttributionPolicyApplyModel?.sharedCatalogMutationAuthority === false && signalAttributionPolicyApplyModel?.actionAuthority === false && signalAttributionPolicyApplyModel?.runtimeAuthority === false && signalAttributionPolicyApplyModel?.productionReady === false, `A twenty-second independently inactive NOLOGIN boundary replaces the complete ${Number(signalAttributionPolicyApplyModel?.supportedRetailerCount || 0).toLocaleString()}-retailer affiliate-routing policy set through one security-definer function. Concurrent replacements are serialized with ordered row locking on the principal's own policies rather than the shared writer-lock protocol; every enabled policy is revalidated against its provider's exact validity rule, and only changed rows are mutated across ${Number(signalAttributionPolicyApplyModel?.mutationTableCount || 0).toLocaleString()} tables. An identical submitted set is a true zero-write unchanged replay with no audit flood, and an already-applied request returns the same fingerprint-guarded immutable replay. This closes attribution-policy parity; the shared writer-lock protocol aggregate remains open.`],
    ["Runtime principals and full repository parity", queueWriteModel?.principalProvisioningImplemented === true && deliveryLeaseRecoveryModel?.allHandlerRepositoryParity === true && queueWriteModel?.productionReady === true, "No login principal or tenant mapping is activated; production identity provisioning, final ingress/handler composition, every request repository, and the authority switch are still required."],
    ["Native multi-session lease contention", model.nativePostgresQualificationSuite === true && model.fleetLeaseContentionQualified === true, `${Number(model.independentBackendSessionCount || 0).toLocaleString()} independent PostgreSQL ${Number(model.nativePostgresMajorVersion || 0)} backend sessions prove locked-row skipping, distinct work distribution, and one race winner.`],
    ["Runtime repositories and deployment drills", model.asyncRuntimeRepositoryParity === true && model.backupRestoreQualified === true, "PostgreSQL request/task-handler repositories, idempotent handler replay, production load/outage, backup, and restore drills must still pass."],
    ["Production authority", model.productionReady === true, `Active source: ${dataPlane.activeStorageEngine || "sqlite"} · dual write: ${model.dualWriteSupported === true ? "enabled" : "prohibited"}.`]
  ];
  $("#postgresCutoverChecklist").innerHTML = checks.map(([label, ready, detail]) => `<article class="card"><div class="card-top"><div><h3>${escapeHtml(label)}</h3><p>${escapeHtml(detail)}</p></div><span class="tag ${ready ? "good" : "warning"}">${ready ? "proven" : "required"}</span></div></article>`).join("")
    + `<p class="fine-print">Schema manifest ${escapeHtml(String(model.schemaManifestFingerprint || "").slice(0, 16))} · contract ${Number(model.contractVersion || 0)} · PostgreSQL ${Number(model.minimumServerVersionMajor || 0)}+.</p>`;
}

function renderBackgroundWork() {
  const model = state.backgroundWork;
  if (!model) {
    $("#backgroundWorkerMetricGrid").innerHTML = empty("Background work is loading.");
    $("#backgroundWorkerScheduleList").innerHTML = "";
    $("#backgroundWorkerTaskList").innerHTML = "";
    $("#signalInboxDeadLetterList").innerHTML = "";
    $("#backgroundWorkerInstanceList").innerHTML = "";
    return;
  }
  const counts = model.counts || {};
  const deployment = model.deployment || { healthy: false, attested: false, lastErrorCode: "not_attached" };
  const signalIngress = model.signalIngress || {};
  const signalWaiting = Number(signalIngress.accepted || 0) + Number(signalIngress.processing || 0) + Number(signalIngress.failed || 0);
  const activeProblems = Number(counts.deadLetterTasks || 0) + Number(counts.retryingTasks || 0) + Number(signalIngress.deadLetter || 0);
  const gate = $("#backgroundWorkerGate");
  const restartButton = $("#adminRestartWorkerButton");
  restartButton.hidden = !(model.canManage === true
    && deployment.runtimeKind === "local_in_process"
    && deployment.mode === "embedded");
  const deploymentMismatch = ["worker_deployment_mismatch", "worker_deployment_expectation_mismatch"].includes(deployment.lastErrorCode);
  gate.textContent = deploymentMismatch || activeProblems ? "Attention" : deployment.healthy ? "OK" : "Off";
  gate.classList.toggle("danger", activeProblems > 0 || !deployment.healthy);
  const metrics = [
    ["Workers online", counts.onlineWorkers, "30-second heartbeat"],
    ["Deployment contract", deployment.attested ? 1 : 0, deployment.attested ? `attested v${Number(deployment.contractVersion || 0)}` : operationalLabel(deployment.lastErrorCode || "not_attested")],
    ["Call intake", signalWaiting, `${Number(signalIngress.processed || 0).toLocaleString()} processed · ${Number(signalIngress.deadLetter || 0).toLocaleString()} dead letter`],
    ["Schedules", counts.enabledSchedules, `${Number(counts.schedules || 0).toLocaleString()} configured`],
    ["Waiting", Number(counts.pendingTasks || 0) + Number(counts.retryingTasks || 0), `${Number(counts.retryingTasks || 0).toLocaleString()} retrying`],
    ["Dead letter", counts.deadLetterTasks, `${Number(counts.succeededTasks || 0).toLocaleString()} completed`]
  ];
  $("#backgroundWorkerMetricGrid").innerHTML = metrics.map(([label, value, note]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${Number(value || 0).toLocaleString()}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  $("#backgroundWorkerScheduleList").innerHTML = (model.schedules || []).length ? model.schedules.map((schedule) => `<article class="card">
    <div class="card-top"><div><h3>${escapeHtml(schedule.displayName)}</h3><p>${escapeHtml(schedule.description)}</p></div><span class="tag ${schedule.enabled ? "good" : "warning"}">${schedule.enabled ? "enabled" : "paused"}</span></div>
    <div class="card-meta"><span class="tag">every ${Number(schedule.intervalSeconds).toLocaleString()}s</span><span class="tag">next ${escapeHtml(relativeTime(schedule.nextRunAt))}</span>${schedule.lastEnqueuedAt ? `<span class="tag">last queued ${escapeHtml(relativeTime(schedule.lastEnqueuedAt))}</span>` : ""}</div>
    <div class="card-actions"><button class="button secondary" data-worker-schedule-run="${escapeHtml(schedule.id)}" type="button" ${model.canManage ? "" : "disabled"}>Run once</button><button class="button ${schedule.enabled ? "danger" : "primary"}" data-worker-schedule-toggle="${escapeHtml(schedule.id)}" type="button" ${model.canManage ? "" : "disabled"}>${schedule.enabled ? "Pause schedule" : "Resume schedule"}</button></div>
  </article>`).join("") : empty("No background schedules have been initialized yet.");
  const recentTasks = (model.tasks || []).slice(0, 18);
  $("#backgroundWorkerTaskList").innerHTML = recentTasks.length ? recentTasks.map((task) => {
    const kind = task.state === "succeeded" ? "good" : task.state === "dead_letter" ? "bad" : "warning";
    const results = Object.entries(task.result || {}).slice(0, 8).map(([key, value]) => `<span class="tag">${escapeHtml(operationalLabel(key))}: ${escapeHtml(value)}</span>`).join("");
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(backgroundTaskLabel(task.taskKind))}</h3><p>Attempt ${Number(task.attemptCount)} of ${Number(task.maximumAttempts)} · queued ${escapeHtml(relativeTime(task.createdAt))}</p></div><span class="tag ${kind}">${escapeHtml(String(task.state).replaceAll("_", " "))}</span></div><div class="card-meta">${task.lastErrorCode ? `<span class="tag bad">${escapeHtml(operationalLabel(task.lastErrorCode))}</span>` : ""}${results || '<span class="tag">no sensitive payload</span>'}</div>${task.state === "dead_letter" ? `<div class="card-actions"><button class="button primary" data-worker-task-retry="${escapeHtml(task.id)}" type="button" ${model.canManage ? "" : "disabled"}>Retry safely</button></div>` : ""}</article>`;
  }).join("") : empty("No background task has run yet.");
  $("#signalInboxDeadLetterList").innerHTML = (model.signalDeadLetters || []).length ? model.signalDeadLetters.map((message) => `<article class="card"><div class="card-top"><div><h3>TrackaLacker call evaluation stopped</h3><p>Attempt ${Number(message.attempt)} · received ${escapeHtml(relativeTime(message.receivedAt))}</p></div><span class="tag bad">dead letter</span></div><div class="card-meta"><span class="tag bad">${escapeHtml(operationalLabel(message.lastErrorCode || "signal_processing_failed"))}</span><span class="tag">${escapeHtml(message.privacyClassification || "operational_aggregate")}</span><span class="tag operational-correlation">${escapeHtml(message.id)}</span><span>updated ${escapeHtml(relativeTime(message.updatedAt))}</span></div><div class="card-actions"><button class="button primary" data-signal-inbox-retry="${escapeHtml(message.id)}" type="button" ${model.canManage ? "" : "disabled"}>Retry corrected call</button></div></article>`).join("") : empty("No call is in dead letter.");
  $("#backgroundWorkerInstanceList").innerHTML = (model.workers || []).length ? model.workers.map((worker) => `<article class="card"><div class="card-top"><div><h3>${escapeHtml(worker.runtimeKind.replaceAll("_", " "))}</h3><p>${escapeHtml(worker.workerId)} · version ${escapeHtml(worker.runtimeVersion)}</p></div><span class="tag ${worker.online ? "good" : "warning"}">${worker.online ? "online" : worker.state}</span></div><div class="card-meta"><span class="tag">heartbeat ${escapeHtml(relativeTime(worker.heartbeatAt))}</span>${worker.lastErrorCode ? `<span class="tag warning">${escapeHtml(operationalLabel(worker.lastErrorCode))}</span>` : ""}<span class="tag ${worker.deploymentFingerprintPresent ? "good" : "warning"}">${worker.deploymentFingerprintPresent ? "attestation presented" : "legacy heartbeat"}</span><span class="tag">operational aggregate</span><span class="tag">bounded principals</span></div></article>`).join("") : empty("No worker heartbeat has been recorded. Start Yoink in embedded mode or start the standalone worker after the API initializes the database.");
}

function adminChangeLabel(value) {
  return String(value || "unknown").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function renderAdminChanges() {
  const model = state.adminChanges;
  if (!model) {
    $("#changeAssuranceSummary").textContent = "Loading protected changes…";
    $("#adminChangeRequestList").innerHTML = "";
    return;
  }
  const counts = model.counts || {};
  const actor = state.snapshot.actor || {};
  const assurance = {
    level: actor.assuranceLevel || model.assurance?.level || "baseline",
    fresh: actor.assuranceFresh ?? model.assurance?.fresh ?? false,
    expiresAt: actor.assuranceExpiresAt || model.assurance?.expiresAt || ""
  };
  const pending = Number(counts.pending || 0);
  const approved = Number(counts.approved || 0);
  $("#adminChangeGate").textContent = pending ? "Attention" : approved ? `${approved} approved` : "OK";
  if (assurance.level === "local_trusted") {
    $("#changeAssuranceSummary").textContent = `${pending.toLocaleString()} waiting · ${approved.toLocaleString()} ready to retry · Local session can review.`;
  } else if (assurance.fresh) {
    $("#changeAssuranceSummary").textContent = `${pending.toLocaleString()} waiting · ${approved.toLocaleString()} ready to retry · Review available until ${new Date(assurance.expiresAt).toLocaleTimeString()}.`;
  } else {
    $("#changeAssuranceSummary").textContent = "Sign in again to review protected changes; the queue remains visible.";
  }
  const currentUserId = state.snapshot.authorization?.memberships?.[0]?.userId || "";
  $("#adminChangeRequestList").innerHTML = (model.items || []).length ? model.items.map((item) => {
    const timeExpired = ["pending", "approved"].includes(item.status) && new Date(item.expiresAt).getTime() <= Date.now();
    const status = timeExpired ? "expired" : item.status;
    const kind = status === "consumed" ? "good" : ["rejected", "expired"].includes(status) ? "bad" : "warning";
    const summary = Object.entries(item.summary || {}).map(([key, value]) => `<span class="tag"><strong>${escapeHtml(adminChangeLabel(key))}:</strong>&nbsp;${escapeHtml(value)}</span>`).join("");
    const canDecide = status === "pending" && model.approvalCapable === true && assurance.fresh === true;
    const canApprove = canDecide && item.requestedByUserId !== currentUserId;
    const instruction = status === "pending"
      ? "Waiting for a different authorized person to review it."
      : status === "approved"
        ? "Approved. Retry the original action before this request expires."
        : status === "consumed"
          ? "Applied once; this authorization cannot be replayed."
          : status === "rejected" ? "Rejected without applying the protected change." : "Expired without applying the protected change.";
    return `<article class="card operator-alert-card ${kind}">
      <div class="card-top"><div><h3>${escapeHtml(item.operationLabel)}</h3><p>${escapeHtml(instruction)}</p></div><span class="tag ${kind}">${escapeHtml(status)}</span></div>
      <div class="card-meta"><span class="tag ${item.controlLevel === "two_person" ? "warning" : "good"}">${item.controlLevel === "two_person" ? "Independent review" : "Recent sign-in"}</span>${summary}</div>
      <p class="operator-alert-detail">Requested by ${escapeHtml(item.requestedByDisplayName)} ${escapeHtml(relativeTime(item.createdAt))} · expires ${escapeHtml(relativeTime(item.expiresAt))} · ${Number(item.events?.length || 0)} immutable event${Number(item.events?.length || 0) === 1 ? "" : "s"}</p>
      ${canDecide ? `<div class="card-actions"><button class="button secondary" data-admin-change-reject="${escapeHtml(item.id)}" type="button">Reject</button><button class="button primary" data-admin-change-approve="${escapeHtml(item.id)}" type="button" ${canApprove ? "" : 'disabled title="A different user must approve this request."'}>Approve change</button></div>` : ""}
    </article>`;
  }).join("") : empty("No protected administrative changes have been requested yet.");
}

function renderActiveView() {
  const renderers = {
    overview: [renderMetrics, renderReadinessGuide, renderOverviewReviews, renderSignals, renderSources],
    library: [renderSources, renderLibrary, renderCatalogGovernance],
    strategies: [renderSources, renderStrategies],
    missions: [renderMissions],
    signals: [renderSources, renderSignals],
    actions: [renderJobs],
    notifications: [renderNotifications],
    attribution: [renderAttributionReceipts],
    activity: [renderAudit],
    analytics: [renderAdminAnalytics],
    operations: [renderSources, renderOperationalTelemetry, renderBackgroundWork],
    approvals: [renderAdminChanges],
    "catalog-reviews": [renderCatalogReviews],
    alerts: [renderOperatorAlerts],
    community: [renderCommunity, renderIdentityGovernance, renderObserverRegistry, renderCatalogIdentityOperations, renderPostgresCutover],
    settings: [renderSettings, renderAttributionPolicies, renderHowlStoreDirectory],
    access: [renderAuthorization],
    sources: [renderSources, renderActionPlatformAdmin, renderDevices, renderQualifications, renderWalmartDraws, renderAdapterRepairQueue, renderShadowObservations],
    stores: [renderSources, renderActionPlatformAdmin, renderDevices, renderQualifications, renderWalmartDraws, renderAdapterRepairQueue, renderShadowObservations]
  };
  for (const renderer of renderers[state.view] || []) renderer();
}

function render() {
  renderStatus();
  renderActiveView();
}

async function storeFingerprint(retailerId, localStoreId) {
  const normalized = String(localStoreId || "").trim().toLocaleUpperCase("en-US");
  if (!/^[A-Z0-9][A-Z0-9 _.-]{0,79}$/.test(normalized)) throw new Error("Enter the store’s local ID using letters or numbers.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`yoink-community-store-v1|${retailerId}|${normalized}`));
  return `store:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function communityLocationScope(card) {
  const kind = $("[data-community-scope-kind]", card).value;
  const raw = $("[data-community-scope-value]", card).value.trim().toLocaleUpperCase("en-US");
  if (kind === "country") {
    if (!/^[A-Z]{2}$/.test(raw)) throw new Error("Enter a two-letter country code such as US.");
    return `country:${raw}`;
  }
  if (kind === "region") {
    if (!/^[A-Z]{2}-[A-Z0-9]{2,3}$/.test(raw)) throw new Error("Enter an ISO-style region such as US-CA.");
    return `region:${raw}`;
  }
  if (!raw && String(card.dataset.currentScope || "").startsWith("store:")) return card.dataset.currentScope;
  return storeFingerprint(card.dataset.communityRetailer, raw);
}

async function loadLibrary(reset = true, limit = COLLECTION_PAGE_SIZE) {
  const query = $("#librarySearch").value.trim();
  const offset = reset || query !== state.libraryQuery ? 0 : state.libraryItems.length;
  const result = await api(`/api/v1/user/library?limit=${limit}&offset=${offset}&q=${encodeURIComponent(query)}`);
  state.libraryItems = offset === 0 ? result.items || [] : [...state.libraryItems, ...(result.items || [])];
  state.libraryTotal = Number(result.total || 0);
  state.libraryQuery = query;
}

async function loadMissions(reset = true, limit = COLLECTION_PAGE_SIZE) {
  const query = $("#missionSearch").value.trim();
  const offset = reset || query !== state.missionQuery ? 0 : state.missionItems.length;
  const result = await api(`/api/v1/user/missions?limit=${limit}&offset=${offset}&q=${encodeURIComponent(query)}`);
  state.missionItems = offset === 0 ? result.items || [] : [...state.missionItems, ...(result.items || [])];
  state.missionTotal = Number(result.total || 0);
  state.missionQuery = query;
}

async function loadAudit(reset = true, limit = COLLECTION_PAGE_SIZE) {
  const query = $("#auditSearch").value.trim();
  const type = $("#auditType").value;
  const actor = $("#auditActor").value;
  const range = $("#auditRange").value;
  const signature = JSON.stringify({ query, type, actor, range });
  const filtersChanged = signature !== state.auditFilterSignature;
  if (reset || filtersChanged) {
    const rangeMs = { "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000, "30d": 30 * 24 * 60 * 60 * 1000 }[range];
    state.auditSince = rangeMs ? new Date(Date.now() - rangeMs).toISOString() : "";
  }
  const offset = reset || filtersChanged ? 0 : state.auditItems.length;
  const parameters = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (query) parameters.set("q", query);
  if (type) parameters.set("type", type);
  if (actor) parameters.set("actor", actor);
  if (state.auditSince) parameters.set("since", state.auditSince);
  const result = await api(`/api/v1/user/audit?${parameters.toString()}`);
  state.auditItems = offset === 0 ? result.items || [] : [...state.auditItems, ...(result.items || [])];
  state.auditTotal = Number(result.total || 0);
  state.auditQuery = query;
  state.auditFilterSignature = signature;
}

async function loadSignals(reset = true, limit = COLLECTION_PAGE_SIZE) {
  const query = $("#signalSearch").value.trim();
  const offset = reset || query !== state.signalQuery ? 0 : state.signalItems.length;
  const result = await api(`/api/v1/user/signals?limit=${limit}&offset=${offset}&q=${encodeURIComponent(query)}`);
  state.signalItems = offset === 0 ? result.items || [] : [...state.signalItems, ...(result.items || [])];
  state.signalTotal = Number(result.total || 0);
  state.signalQuery = query;
}

async function loadSignalPreview() {
  const result = await api("/api/v1/user/signals?limit=4&offset=0");
  state.signalItems = result.items || [];
  state.signalTotal = Number(result.total || 0);
  state.signalQuery = "";
}

async function loadJobs(reset = true, limit = COLLECTION_PAGE_SIZE) {
  const query = $("#jobSearch").value.trim();
  const offset = reset || query !== state.jobQuery ? 0 : state.jobItems.length;
  const result = await api(`/api/v1/user/jobs?limit=${limit}&offset=${offset}&q=${encodeURIComponent(query)}`);
  state.jobItems = offset === 0 ? result.items || [] : [...state.jobItems, ...(result.items || [])];
  state.jobTotal = Number(result.total || 0);
  state.jobQuery = query;
}

async function loadNotifications(reset = true, limit = COLLECTION_PAGE_SIZE) {
  const query = $("#notificationSearch").value.trim();
  const offset = reset || query !== state.notificationQuery ? 0 : state.notificationItems.length;
  const result = await api(`/api/v1/admin/notifications?limit=${limit}&offset=${offset}&q=${encodeURIComponent(query)}`);
  state.notificationItems = offset === 0 ? result.items || [] : [...state.notificationItems, ...(result.items || [])];
  state.notificationTotal = Number(result.total || 0);
  state.notificationQuery = query;
}

async function loadAttributionReceipts(reset = true, limit = COLLECTION_PAGE_SIZE) {
  const query = $("#attributionReceiptSearch").value.trim();
  const offset = reset || query !== state.attributionReceiptQuery ? 0 : state.attributionReceiptItems.length;
  const result = await api(`/api/v1/admin/attribution-receipts?limit=${limit}&offset=${offset}&q=${encodeURIComponent(query)}`);
  state.attributionReceiptItems = offset === 0 ? result.items || [] : [...state.attributionReceiptItems, ...(result.items || [])];
  state.attributionReceiptTotal = Number(result.total || 0);
  state.attributionReceiptQuery = query;
}

async function loadOperationalTelemetry() {
  const window = $("#operationalWindow").value;
  const result = await api(`/api/v1/admin/operations/telemetry?window=${encodeURIComponent(window)}`);
  state.operationalTelemetry = result.telemetry || null;
}

async function loadAdminAnalytics() {
  const result = await api(`/api/v1/admin/analytics?window=${encodeURIComponent(state.adminAnalyticsWindow)}`);
  state.adminAnalytics = result.analytics || null;
}

async function loadBackgroundWork() {
  const result = await api("/api/v1/admin/workers");
  state.backgroundWork = result.backgroundWork || null;
}

async function loadAdminChanges() {
  state.adminChanges = await api("/api/v1/admin/change-requests?status=all&limit=100");
}

async function loadAffiliateRouting() {
  if (state.affiliateRouting) return;
  const result = await api("/api/v1/affiliate-routing");
  state.affiliateRouting = result.affiliateRouting || null;
}

async function loadActionPlatformAdmin() {
  const [channels, windows, patterns, readiness] = await Promise.all([
    api("/api/v1/admin/sources/channels"),
    api("/api/v1/admin/drop-windows"),
    api("/api/v1/admin/restock-patterns"),
    api("/api/v1/admin/qualifications/readiness")
  ]);
  state.signalChannels = channels.items || [];
  state.dropWindows = windows.items || [];
  state.dropWindowTimezone = windows.timezone || state.dropWindowTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  state.restockPatterns = patterns.items || [];
  state.laneReadiness = readiness.plan?.lanes || [];
}

async function loadAdminUsers() {
  const result = await api(`/api/v1/admin/users?q=${encodeURIComponent(state.adminUserQuery)}`);
  state.authorizationUsers = result.users || [];
}

async function openAdminUser(userId, { historyMode = "push" } = {}) {
  state.selectedAdminUser = await api(`/api/v1/admin/users/${encodeURIComponent(userId)}`);
  state.adminUserTab = "plans";
  state.adminUserPairing = null;
  renderAdminUserDetail();
  $("#adminUserDialog").showModal();
  state.adminDetailPushed.adminUserDialog = historyMode === "push";
  if (historyMode === "push") history.pushState(null, "", `#access/user/${encodeURIComponent(userId)}`);
}

async function openPendingAdminDetail() {
  const pending = state.pendingAdminDetail;
  state.pendingAdminDetail = null;
  if (!pending) return;
  if (pending.kind === "user") await openAdminUser(pending.id, { historyMode: "none" });
  if (pending.kind === "drop") await openDropWindow(pending.id, { historyMode: "none" });
}

async function reloadSelectedAdminUser() {
  if (!state.selectedAdminUser?.user?.id) return;
  state.selectedAdminUser = await api(`/api/v1/admin/users/${encodeURIComponent(state.selectedAdminUser.user.id)}`);
  await loadAdminUsers();
  renderAuthorization();
  renderAdminUserDetail();
}

function openAdminUserCreate() {
  const form = $("#adminUserCreateForm");
  form.reset();
  const roleOptions = state.authorizationRoles.length
    ? state.authorizationRoles
    : [{ id: "yoink_user", displayName: "Shopper" }];
  $("#adminUserInitialRole").innerHTML = roleOptions.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.displayName)}</option>`).join("");
  $("#adminUserInitialRole").value = "yoink_user";
  $("#adminUserCreateDialog").showModal();
  form.elements.displayName.focus();
}

async function loadAdminView(view, {
  force = false,
  collections = true,
  preservePagination = false,
  background = false
} = {}) {
  if (!force && state.loadedViews.has(view)) return;
  if (view === "overview") await loadSignalPreview();
  if (view === "library" && collections) await loadLibrary(true, preservePagination ? loadedCollectionLimit(state.libraryItems, COLLECTION_POLL_LIMITS.library) : COLLECTION_PAGE_SIZE);
  if (view === "missions" && collections) await loadMissions(true, preservePagination ? loadedCollectionLimit(state.missionItems) : COLLECTION_PAGE_SIZE);
  if (view === "signals" && collections) await loadSignals(true, preservePagination ? loadedCollectionLimit(state.signalItems) : COLLECTION_PAGE_SIZE);
  if (view === "actions" && collections) await loadJobs(true, preservePagination ? loadedCollectionLimit(state.jobItems) : COLLECTION_PAGE_SIZE);
  if (view === "notifications" && collections) await loadNotifications(true, preservePagination ? loadedCollectionLimit(state.notificationItems) : COLLECTION_PAGE_SIZE);
  if (view === "attribution" && collections) await loadAttributionReceipts(true, preservePagination ? loadedCollectionLimit(state.attributionReceiptItems) : COLLECTION_PAGE_SIZE);
  if (view === "activity" && collections) await loadAudit(true, preservePagination ? loadedCollectionLimit(state.auditItems) : COLLECTION_PAGE_SIZE);
  if (view === "analytics") await loadAdminAnalytics();
  if (view === "operations") await Promise.all([loadOperationalTelemetry(), loadBackgroundWork()]);
  if (view === "approvals") await loadAdminChanges();
  if (["sources", "stores"].includes(view)) await loadActionPlatformAdmin();
  if (view === "settings") await loadAffiliateRouting();
  if (view === "community" && collections) await loadLibrary(true, preservePagination ? loadedCollectionLimit(state.libraryItems, COLLECTION_POLL_LIMITS.library) : COLLECTION_PAGE_SIZE);
  if (view === "access" && !background) {
    const authorization = state.snapshot.authorization || {};
    const loads = [];
    if (authorization.userReadEnabled === true || authorization.roleAdministrationEnabled === true) {
      loads.push(loadAdminUsers());
    }
    if (authorization.roleAdministrationEnabled === true) {
      loads.push(api("/api/v1/admin/authorization/roles").then((result) => {
        state.authorizationRoles = result.roles || [];
      }));
    } else {
      state.authorizationRoles = [];
    }
    await Promise.all(loads);
  }
  state.loadedViews.add(view);
}

async function refresh(reloadCollections = true, { preservePagination = false, background = false } = {}) {
  const requestedView = state.view;
  const requestedSnapshotView = snapshotAdminView(requestedView);
  const requestId = ++state.snapshotRequestId;
  showAdminViewSkeleton(requestedView);
  let snapshot;
  try {
    snapshot = await api(`/api/v1/admin/snapshot?view=${encodeURIComponent(requestedSnapshotView)}`);
  } catch (error) {
    if (requestedView === "community" && error?.code === "permission_denied") {
      setView("overview", { historyMode: "replace", scroll: false });
      return refresh(reloadCollections, { preservePagination, background });
    }
    throw error;
  }
  if (requestId !== state.snapshotRequestId || requestedView !== state.view) return;
  state.snapshot = snapshot;
  await loadAdminView(state.view, {
    force: true,
    collections: reloadCollections,
    preservePagination,
    background
  });
  render();
  await openPendingAdminDetail();
  setAdminDataStale(false);
}

const ADMIN_ACTIVE_JOB_STATES = new Set([
  "awaiting_executor", "leased", "navigating", "verifying_listing", "offer_verified",
  "add_authorized", "adding", "checkout_review", "submit_authorized", "submitting"
]);
let backgroundRefresh = null;
let adminPollTimer = null;

function setAdminDataStale(stale) {
  const indicator = $("#adminDataFreshness");
  indicator.hidden = !stale;
  indicator.textContent = stale ? "Updates paused · Retry" : "Updates current";
}

function adminPollDelay() {
  const activeJob = Number(state.snapshot?.counts?.activeActionJobs || 0) > 0
    || (!state.snapshot && state.jobItems.some((job) => ADMIN_ACTIVE_JOB_STATES.has(job.state)));
  const activeTask = (state.backgroundWork?.tasks || []).some((task) => ["pending", "leased", "retry_wait"].includes(task.state));
  const liveView = ["overview", "actions", "notifications", "attribution", "signals", "operations"].includes(state.view);
  if (liveView && (activeJob || activeTask)) return 3_000;
  return liveView ? 15_000 : 30_000;
}

function refreshFromLoopback() {
  if (document.visibilityState !== "visible") return Promise.resolve();
  if (backgroundRefresh) return backgroundRefresh;
  backgroundRefresh = refresh(true, { preservePagination: true, background: true })
    .then(() => setAdminDataStale(false))
    .catch(() => setAdminDataStale(true))
    .finally(() => { backgroundRefresh = null; });
  return backgroundRefresh;
}

function scheduleAdminPoll() {
  if (adminPollTimer !== null) clearTimeout(adminPollTimer);
  adminPollTimer = null;
  if (document.visibilityState !== "visible") return;
  adminPollTimer = setTimeout(async () => {
    adminPollTimer = null;
    await refreshFromLoopback();
    scheduleAdminPoll();
  }, adminPollDelay());
}

function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }

function clearListingLinkPreview() {
  state.listingLinkPreview = null;
  state.listingLinkPreviewInput = "";
  $("#listingLinkPreview").hidden = true;
  $("#listingLinkPreview").innerHTML = "";
  $("#listingLinkConfirm").hidden = true;
  $("#listingForm").elements.confirmed.checked = false;
  $("#submitListingLinkButton").disabled = true;
}

function openListingLinkDialog() {
  const form = $("#listingForm");
  form.reset();
  clearListingLinkPreview();
  $("#listingDialog").showModal();
  requestAnimationFrame(() => form.elements.url.focus());
}

async function checkListingLink() {
  const form = $("#listingForm");
  const url = form.elements.url.value.trim();
  if (!url) throw new Error("Paste the store product page first.");
  const button = $("#checkListingLinkButton");
  button.disabled = true;
  button.textContent = "Checking item ID…";
  try {
    const { preview } = await api("/api/v1/user/catalog/link-preview", {
      method: "POST",
      body: JSON.stringify({ url })
    });
    state.listingLinkPreview = preview;
    state.listingLinkPreviewInput = url;
    $("#listingLinkPreview").hidden = false;
    $("#listingLinkPreview").innerHTML = `<div class="card-top"><span class="store">${escapeHtml(preview.retailerName)}</span><span class="tag good">Product found</span></div><h3>${escapeHtml(preview.retailerSku)}</h3><p>${escapeHtml(preview.capabilityLabel)}</p><p><strong>Not accepted from this link:</strong> stock, price, seller, fulfillment, or permission to purchase.</p><p>${escapeHtml(preview.canonicalUrl)}</p>`;
    $("#listingLinkConfirm").hidden = false;
    $("#listingLinkConfirm input").focus();
  } finally {
    button.disabled = false;
    button.textContent = "Check link";
  }
}

const CART_ADD_CAPABILITY = Object.freeze({
  target: "targetAddMutationAuthorized",
  walmart: "walmartAddMutationAuthorized",
  amazon: "amazonAddMutationAuthorized",
  bestbuy: "bestBuyAddMutationAuthorized"
});

function renderSignalModePreview() {
  const form = $("#signalForm");
  const mode = form.elements.mode.value === "live" ? "live" : "dry_run";
  const live = mode === "live";
  const retailerId = form.elements.retailerId?.value || "";
  const storeName = retailerName(retailerId);
  const snapshot = state.snapshot || {};
  const activePlans = Number(snapshot.plans?.activeByStore?.[retailerId] || 0);
  const cartAddsOn = CART_ADD_CAPABILITY[retailerId]
    ? snapshot.capabilities?.[CART_ADD_CAPABILITY[retailerId]] === true
    : false;
  const paused = snapshot.settings?.actionsPaused === true;
  const planLine = activePlans
    ? `${activePlans.toLocaleString()} active ${storeName} plan${activePlans === 1 ? "" : "s"} can match this call.`
    : `No active ${storeName} plan matches this call; a trusted source can create one.`;
  const cartLine = paused
    ? "Actions are paused, so no cart add can start."
    : cartAddsOn
      ? `Cart adds are on for ${storeName}: a matching plan can queue one guarded add of one item.`
      : `Cart adds are off for ${storeName}: a match can only notify.`;
  $("#signalModePreview").innerHTML = live
    ? `<strong>Live call</strong><p>Creates a real ${escapeHtml(storeName)} call record and runs the matching rules.</p><p>${escapeHtml(planLine)}</p><p>${escapeHtml(cartLine)}</p><p>Checkout stays manual; no store control is clicked by this form.</p>`
    : `<strong>Dry-run</strong><p>Creates a test call and decision record only.</p><p>${escapeHtml(planLine)}</p><p>It cannot create a plan, action, notification, spend reservation, store click, or cart change.</p>`;
  $("#sendAdvancedSignalButton").textContent = live ? "Review live call" : "Run dry call";
}
function dollarsToCents(value) {
  if (!String(value || "").trim()) return null;
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars <= 0) throw new Error("Enter a positive dollar amount.");
  return Math.round(dollars * 100);
}
function nonNegativeDollarsToCents(value) {
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars < 0) throw new Error("Enter a non-negative dollar amount.");
  return Math.round(dollars * 100);
}
function commaList(value) { return String(value || "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean); }

function syncStrategyActionFields(form = $("#strategyForm")) {
  const addToCart = form.elements.action.value === "add_to_cart";
  const maxOption = $("[data-max-quantity-option]", form);
  maxOption.hidden = !addToCart;
  maxOption.disabled = !addToCart;
  if (!addToCart && form.elements.quantity.value === "max") form.elements.quantity.value = "1";
}

function openStrategy(strategy = null) {
  state.editingStrategyId = strategy?.id || "";
  const form = $("#strategyForm"); form.reset();
  $("#strategyDialogTitle").textContent = strategy ? "Edit rule" : "Add rule";
  form.elements.id.value = strategy?.id || `strategy_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  form.elements.revision.value = strategy?.revision || 1;
  form.elements.name.value = strategy?.name || "";
  form.elements.position.value = strategy?.position || Math.max(10, ...(state.snapshot.strategies || []).map((item) => item.position + 10));
  form.elements.priceKind.value = strategy?.pricePolicy.kind || "at_or_below_msrp";
  form.elements.maxPrice.value = strategy?.pricePolicy.maxPriceCents ? (strategy.pricePolicy.maxPriceCents / 100).toFixed(2) : "";
  form.elements.tolerancePercent.value = Number(strategy?.pricePolicy.toleranceBps || 1000) / 100;
  form.elements.sellerPolicy.value = strategy?.sellerPolicy || "first_party_only";
  form.elements.allowedSellers.value = (strategy?.allowedSellers || []).join(", ");
  const supportedAction = new Set(["notify", "add_to_cart"]).has(strategy?.action || "notify");
  form.elements.action.value = supportedAction ? strategy?.action || "notify" : "";
  $("#strategyLegacyActionNote").hidden = supportedAction;
  form.elements.quantity.value = strategy?.quantity || 1;
  syncStrategyActionFields(form);
  form.elements.fulfillment.value = strategy?.fulfillment === "pickup"
    ? "pickup" : "shipping";
  $("#strategyLegacyFulfillmentNote").hidden = strategy?.fulfillment !== "manual";
  form.elements.maxSignalAgeSeconds.value = strategy?.maxSignalAgeSeconds || 120;
  const selectedSources = new Set(strategy?.sources || []);
  const selectedRetailers = new Set(strategy?.retailers || []);
  $$('[data-strategy-source]', form).forEach((input) => { input.checked = selectedSources.has(input.value); });
  $$('[data-strategy-retailer]', form).forEach((input) => { input.checked = selectedRetailers.has(input.value); });
  form.elements.includeKeywords.value = strategy?.includeKeywords || "";
  form.elements.excludeKeywords.value = strategy?.excludeKeywords || "";
  form.elements.enabled.checked = strategy?.enabled !== false;
  $("#strategyDialog").showModal();
}

async function openMission(missionId) {
  const result = await api(`/api/v1/user/missions/${encodeURIComponent(missionId)}`);
  const mission = result.mission;
  if (!mission?.id || !Array.isArray(mission.targets)) throw new Error("The plan details are unavailable.");
  state.editingMission = mission;
  const form = $("#missionForm");
  form.reset();
  form.elements.id.value = mission.id;
  form.elements.status.value = mission.status;
  form.elements.targetQuantity.value = mission.targetQuantity;
  $("#missionDialogTitle").textContent = mission.title;
  $("#missionTargetEditors").innerHTML = mission.targets.map((target) => `<article class="mission-target-editor" data-mission-target="${escapeHtml(target.id)}">
    <div class="card-top"><div><h3>${escapeHtml(target.retailerName)} · ${escapeHtml(target.retailerSku)}</h3><p>${escapeHtml(String(target.listingStatus).replaceAll("_", " "))} · last ${formatMoney(target.lastObservedPriceCents, target.currency)} · MSRP ${formatMoney(target.msrpCents, target.currency)}</p></div><span class="tag ${target.executionSupported ? "good" : "warning"}">${target.executionSupported ? "Cart mapping available" : "Monitoring only"}</span></div>
    <div class="form-grid">
      <label class="check-label"><input data-target-field="enabled" type="checkbox" ${target.enabled ? "checked" : ""}><span>Use store</span></label>
      <label><span>Maximum price</span><div class="money-input"><span>$</span><input data-target-field="maxUnitPrice" inputmode="decimal" value="${target.maxUnitPriceCents ? (target.maxUnitPriceCents / 100).toFixed(2) : ""}" placeholder="Rule limit"></div></label>
      <label><span>Seller</span><select data-target-field="sellerPolicy"><option value="inherit" ${target.sellerPolicy === "inherit" ? "selected" : ""}>Use default</option><option value="first_party_only" ${target.sellerPolicy === "first_party_only" ? "selected" : ""}>Store only</option><option value="allow_third_party" ${target.sellerPolicy === "allow_third_party" ? "selected" : ""}>Marketplace allowed</option></select></label>
      <label><span>Fulfillment</span><select data-target-field="fulfillment"><option value="shipping" ${target.fulfillment !== "pickup" ? "selected" : ""}>Shipping (default)</option><option value="pickup" ${target.fulfillment === "pickup" ? "selected" : ""}>Pickup (explicit opt-in)</option></select></label>
      ${target.fulfillment === "manual" ? '<p class="wide">This legacy Manual setting is shown as Shipping. Save the plan to confirm the change.</p>' : ""}
    </div><a class="canonical-link" href="${escapeHtml(target.canonicalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(target.canonicalUrl)}</a>
  </article>`).join("");
  $("#missionDialog").showModal();
}

async function saveStrategies(strategies) {
  await api("/api/v1/user/strategies", { method: "PUT", body: JSON.stringify({ strategies }) });
  await refresh();
}

function configureCatalogIdentityForm(kind) {
  const form = $("#catalogIdentityForm");
  form.elements.kind.value = kind;
  $$('[data-catalog-merge-field]', form).forEach((field) => { field.hidden = kind !== "merge_variants"; });
  $$('[data-catalog-split-field]', form).forEach((field) => { field.hidden = kind !== "split_variant"; });
}

function openCatalogIdentityForm(kind) {
  const form = $("#catalogIdentityForm");
  form.reset();
  configureCatalogIdentityForm(kind);
  form.elements.reasonCode.value = kind === "merge_variants" ? "reviewed_exact_identifier" : "incorrect_variant_grouping";
  $("#catalogIdentityDialog").showModal();
}

function openOperatorAlertRule(rule = null) {
  const form = $("#operatorAlertRuleForm");
  form.reset();
  state.editingOperatorAlertRuleId = rule?.id || "";
  form.elements.id.value = rule?.id || "";
  form.elements.name.value = rule?.name || "";
  form.elements.eventFamily.value = rule?.eventFamily || "adapter_repair";
  form.elements.severity.value = rule?.severity || "warning";
  form.elements.retailerScope.value = rule?.retailerScope || "*";
  form.elements.operationScope.value = rule?.operationScope || "*";
  form.elements.minimumOccurrences.value = rule?.minimumOccurrences || 1;
  form.elements.dedupeWindowSeconds.value = rule?.dedupeWindowSeconds || 900;
  form.elements.escalationAfterSeconds.value = rule?.escalationAfterSeconds ?? 3600;
  form.elements.enabled.checked = rule?.enabled !== false;
  const selectedRoutes = new Set(rule?.routes || ["dashboard", "audit_outbox"]);
  $$('input[name="route"]', form).forEach((input) => { input.checked = selectedRoutes.has(input.value); });
  $("#operatorAlertRuleDialogTitle").textContent = rule ? "Edit alert rule" : "Add alert rule";
  $("#operatorAlertRuleDialog").showModal();
}

function openOperatorAlertConnector(connector = null) {
  const form = $("#operatorAlertConnectorForm");
  form.reset();
  state.editingOperatorAlertConnectorId = connector?.id || "";
  form.elements.id.value = connector?.id || "";
  form.elements.name.value = connector?.name || "";
  form.elements.kind.value = connector?.kind || "webhook";
  form.elements.endpointReference.value = connector?.endpointReference || "";
  form.elements.minimumSeverity.value = connector?.minimumSeverity || "warning";
  form.elements.enabled.checked = connector?.enabled !== false;
  $("#operatorAlertConnectorDialogTitle").textContent = connector ? "Edit alert connector" : "Add alert connector";
  $("#operatorAlertConnectorDialog").showModal();
}

const ADMIN_DETAIL_ROUTES = Object.freeze({
  adminUserDialog: { prefix: "#access/user/", parent: "#access" },
  dropWindowDialog: { prefix: "#sources/drops/", parent: "#sources/drops" }
});

function restoreAdminDetailRoute(dialog) {
  const route = ADMIN_DETAIL_ROUTES[dialog?.id];
  if (!route || !location.hash.startsWith(route.prefix)) return;
  // null means no open detail (or one already handled); the close event and the explicit close
  // path can both call this, so only the first call for an open dialog touches history.
  const pushed = state.adminDetailPushed[dialog.id];
  if (pushed === null) return;
  state.adminDetailPushed[dialog.id] = null;
  if (dialog.id === "adminUserDialog") state.selectedAdminUser = null;
  if (dialog.id === "dropWindowDialog") state.editingDropWindow = null;
  // A dialog opened by pushState in this session goes back to the entry it came from; a deep link
  // (no earlier entry of ours) is rewritten in place so Back never leaves the dashboard.
  if (pushed) history.back();
  else history.replaceState(null, "", route.parent);
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  try {
    if (button.id === "adminDataFreshness") {
      button.disabled = true;
      try { await refreshFromLoopback(); } finally { button.disabled = false; }
      return;
    }
    if (button.dataset.overviewWindow) {
      state.overviewWindow = button.dataset.overviewWindow === "days7" ? "days7" : "hours24";
      renderMetrics();
      return;
    }
    if (button.dataset.view) setView(button.dataset.view, { historyMode: "push" });
    if (button.dataset.connectionsView) setConnectionsView(button.dataset.connectionsView, { historyMode: "push" });
    if (button.dataset.qualificationRetailer) setQualificationRetailer(button.dataset.qualificationRetailer, { historyMode: "push" });
    if (button.dataset.communityView) setCommunityView(button.dataset.communityView, { historyMode: "push" });
    if (button.dataset.adminSettingsView) setAdminSettingsView(button.dataset.adminSettingsView, { historyMode: "push" });
    if (button.dataset.operationsView) setOperationsView(button.dataset.operationsView, { historyMode: "push" });
    if (button.dataset.alertsView) setAlertsView(button.dataset.alertsView, { historyMode: "push" });
    if (button.dataset.openView) setView(button.dataset.openView, { historyMode: "push" });
    if (button.dataset.openRoute) {
      location.hash = `#${button.dataset.openRoute}`;
      return;
    }
    if (button.dataset.attributionEdit) openAttributionPolicy(button.dataset.attributionEdit);
    if (button.id === "howlStoreShowAll") {
      state.howlStoreExpanded = !state.howlStoreExpanded;
      renderHowlStoreDirectory();
    }
    if (button.id === "copyTrackalackerInstructions") {
      await navigator.clipboard.writeText(TRACKALACKER_SETUP_INSTRUCTIONS);
      toast("TrackaLacker setup instructions copied.");
      return;
    }
    if (button.dataset.copyCorrelation) {
      await navigator.clipboard.writeText(button.dataset.copyCorrelation);
      toast("Activity id copied.");
      return;
    }
    if (button.hasAttribute("data-close-dialog")) {
      const dialog = button.closest("dialog");
      dialog?.close();
      restoreAdminDetailRoute(dialog);
    }
    if (button.id === "addListingButton") openListingLinkDialog();
    if (button.id === "addRawListingButton") {
      const form = $("#rawListingForm");
      form.reset();
      $("#rawListingDialog").showModal();
      requestAnimationFrame(() => form.elements.sourceConnectionId.focus());
    }
    if (button.id === "checkListingLinkButton") await checkListingLink();
    if (button.id === "createAdminUserButton" || button.hasAttribute("data-admin-user-create")) openAdminUserCreate();
    if (button.dataset.adminUserOpen) await openAdminUser(button.dataset.adminUserOpen);
    if (button.dataset.adminUserTab) {
      state.adminUserTab = button.dataset.adminUserTab;
      renderAdminUserDetail();
    }
    if (button.hasAttribute("data-admin-user-pairing")) {
      const userId = state.selectedAdminUser?.user?.id;
      if (!userId) throw new Error("Refresh before issuing a pairing code.");
      const result = await api(`/api/v1/admin/users/${encodeURIComponent(userId)}/pairing-code`, { method: "POST", body: "{}" });
      state.selectedAdminUser = result.user;
      state.adminUserPairing = result.pairing;
      await loadAdminUsers();
      renderAuthorization();
      renderAdminUserDetail();
      toast(`Pairing code created for ${state.selectedAdminUser.user.displayName}.`);
    }
    if (button.hasAttribute("data-copy-admin-pairing") && state.adminUserPairing?.code) {
      await navigator.clipboard.writeText(state.adminUserPairing.code);
      toast("Pairing code copied.");
    }
    if (button.hasAttribute("data-admin-user-pause")) {
      const userId = state.selectedAdminUser?.user?.id;
      if (!userId) throw new Error("Refresh before changing this user's actions.");
      const paused = state.selectedAdminUser?.actionSettings?.paused !== false;
      const nextPaused = !paused;
      if (nextPaused && !(await requestConfirmation({
        title: `Pause actions for ${state.selectedAdminUser.user.displayName}?`,
        summary: "Monitoring and notifications continue, but eligible store actions will stop.",
        confirmLabel: "Pause actions"
      })).confirmed) return;
      state.selectedAdminUser = await api(`/api/v1/admin/users/${encodeURIComponent(userId)}/pause-actions`, {
        method: "POST",
        body: JSON.stringify({ paused: nextPaused })
      });
      await loadAdminUsers();
      renderAuthorization();
      renderAdminUserDetail();
      toast(`Store actions ${nextPaused ? "paused" : "resumed"} for ${state.selectedAdminUser.user.displayName}.`);
    }
    if (button.hasAttribute("data-admin-user-role-grant")) {
      const userId = state.selectedAdminUser?.user?.id;
      const roleId = $("#adminUserRoleSelection")?.value;
      if (!userId || !roleId) throw new Error("Choose a role to grant.");
      const result = await api(`/api/v1/admin/authorization/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, { method: "POST", body: "{}" });
      if (protectedChangePending(result)) {
        $("#adminUserDialog").close();
      } else {
        await reloadSelectedAdminUser();
        toast("Role membership granted and audited.");
      }
    }
    if (button.dataset.adminUserStatus) {
      const userId = state.selectedAdminUser?.user?.id;
      const nextStatus = button.dataset.adminUserStatus;
      if (!userId) throw new Error("Refresh before changing this user's status.");
      if (nextStatus === "disabled" && button.dataset.confirming !== "true") {
        button.dataset.confirming = "true";
        button.textContent = "Confirm disable";
        button.focus();
      } else {
        state.selectedAdminUser = await api(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus })
        });
        state.adminUserPairing = null;
        await loadAdminUsers();
        renderAuthorization();
        renderAdminUserDetail();
        toast(`${state.selectedAdminUser.user.displayName} ${nextStatus === "active" ? "enabled" : "disabled"}.`);
      }
    }
    if (button.dataset.dropWindowOpen) await openDropWindow(button.dataset.dropWindowOpen);
    if (button.dataset.addDropWindowProduct) {
      const product = state.dropWindowSearchResults.find((item) => item.listingId === button.dataset.addDropWindowProduct);
      if (!product) throw new Error("Search again before choosing this product.");
      if (state.dropWindowDraftProducts.length >= 50) throw new Error("A drop window can contain at most 50 products.");
      const selectedStore = state.dropWindowDraftProducts[0]?.retailerId;
      if (selectedStore && selectedStore !== product.retailerId) {
        throw new Error(`Choose products from ${retailerName(selectedStore)} only, or clear the current selection.`);
      }
      if (!state.dropWindowDraftProducts.some((item) => item.listingId === product.listingId)) {
        state.dropWindowDraftProducts.push(product);
      }
      renderDropWindowProductPicker();
    }
    if (button.dataset.removeDropWindowProduct) {
      state.dropWindowDraftProducts = state.dropWindowDraftProducts.filter((item) => item.listingId !== button.dataset.removeDropWindowProduct);
      renderDropWindowProductPicker();
    }
    if (button.dataset.chooseRestockPatternProduct) {
      const product = state.restockPatternSearchResults.find((item) => item.listingId === button.dataset.chooseRestockPatternProduct);
      if (!product) throw new Error("Search again before choosing this product.");
      state.restockPatternProduct = product;
      renderRestockPatternProductPicker();
    }
    if (button.hasAttribute("data-remove-restock-pattern-product")) {
      state.restockPatternProduct = null;
      renderRestockPatternProductPicker();
    }
    if (button.id === "replaceDropWindowButton") replaceDropWindowDraft();
    if (button.id === "cancelDropWindowButton") {
      const window = state.editingDropWindow;
      if (!window?.id) throw new Error("Refresh before cancelling this drop window.");
      if (button.dataset.confirming !== "true") {
        button.dataset.confirming = "true";
        button.textContent = "Confirm cancellation";
        $("#dropWindowCancelReasonField").hidden = false;
        $("#dropWindowCancelReason").focus();
      } else {
        const result = await api(`/api/v1/admin/drop-windows/${encodeURIComponent(window.id)}/cancel`, {
          method: "POST",
          body: JSON.stringify({ reasonCode: $("#dropWindowCancelReason").value })
        });
        state.editingDropWindow = result.window;
        const dialog = $("#dropWindowDialog");
        dialog.close();
        restoreAdminDetailRoute(dialog);
        await loadActionPlatformAdmin();
        renderActionPlatformAdmin();
        toast("Drop window cancelled.");
      }
    }
    if (button.dataset.sourceChannelStatus) {
      const channel = state.signalChannels.find((item) => item.id === button.dataset.sourceChannelStatus);
      if (!channel) throw new Error("The source channel is unavailable.");
      await api(`/api/v1/admin/sources/channels/${encodeURIComponent(channel.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: channel.status === "active" ? "paused" : "active" })
      });
      await loadActionPlatformAdmin(); renderActionPlatformAdmin();
      toast(channel.status === "active" ? "Source channel paused." : "Source channel activated.");
    }
    if (button.dataset.sourceChannelTrust) {
      const channel = state.signalChannels.find((item) => item.id === button.dataset.sourceChannelTrust);
      if (!channel) throw new Error("The source channel is unavailable.");
      const trustLevel = channel.trustLevel === "trusted_exact" ? "informational" : "trusted_exact";
      if (trustLevel === "trusted_exact" && !(await requestConfirmation({
        title: "Trust this source for product matches?",
        summary: "Only structured, validated store identity can enter. This choice changes how normalized calls are evaluated.",
        confirmLabel: "Trust source"
      })).confirmed) return;
      await api(`/api/v1/admin/sources/channels/${encodeURIComponent(channel.id)}`, {
        method: "PATCH", body: JSON.stringify({ trustLevel })
      });
      await loadActionPlatformAdmin(); renderActionPlatformAdmin();
      toast("Source channel trust updated.");
    }
    if (button.dataset.sourceChannelReplay) {
      if (!(await requestConfirmation({
        title: "Replay calls from this source?",
        summary: "Up to ten dead-lettered calls will be retried with the existing idempotency and safety checks.",
        confirmLabel: "Replay calls"
      })).confirmed) return;
      const result = await api(`/api/v1/admin/sources/channels/${encodeURIComponent(button.dataset.sourceChannelReplay)}/replay`, {
        method: "POST", body: JSON.stringify({ maximum: 10 })
      });
      await refresh(false);
      toast(`${Number(result.replayed || 0)} dead-lettered call${Number(result.replayed || 0) === 1 ? "" : "s"} queued for replay.`);
    }
    if (button.dataset.useRestockPattern) {
      const pattern = state.restockPatterns.find((item) => item.id === button.dataset.useRestockPattern);
      if (!pattern) throw new Error("Refresh before using this restock pattern.");
      useRestockPatternForWindow(pattern);
      toast("Restock evidence added to a new window draft. Choose the bounded start and close times.");
    }
    if (button.dataset.retireLane) {
      if (!(await requestConfirmation({
        title: `Retire the ${retailerName(button.dataset.retireLane)} lane?`,
        summary: "Other store qualifications remain unchanged.",
        confirmLabel: "Retire lane",
        danger: true
      })).confirmed) return;
      await api(`/api/v1/admin/qualifications/${encodeURIComponent(button.dataset.retireLane)}/retire`, {
        method: "POST",
        body: JSON.stringify({ confirmation: "RETIRE_ONE_RETAILER_LANE", reasonCode: "operator_retired" })
      });
      await refresh(false);
      toast(`${retailerName(button.dataset.retireLane)} lane retired independently.`);
    }
    if (button.id === "sendSignalButton") {
      $("#signalForm").reset();
      renderSignalModePreview();
      $("#signalDialog").showModal();
    }
    if (button.id === "adminRestartWorkerButton") {
      if (!(await requestConfirmation({
        title: "Restart background work?",
        summary: "Active durable tasks remain queued and will be recovered by the embedded worker.",
        confirmLabel: "Restart worker"
      })).confirmed) return;
      button.disabled = true;
      try {
        await api("/api/v1/admin/workers/restart", { method: "POST", body: "{}" });
        await loadBackgroundWork();
        renderBackgroundWork();
        toast("Background worker restarted.");
      } finally {
        button.disabled = false;
      }
    }
    if (button.id === "addStrategyButton") openStrategy();
    if (button.id === "proposeCatalogMergeButton") openCatalogIdentityForm("merge_variants");
    if (button.id === "proposeCatalogSplitButton") openCatalogIdentityForm("split_variant");
    if (button.id === "addOperatorAlertRuleButton") openOperatorAlertRule();
    if (button.id === "addOperatorAlertConnectorButton") openOperatorAlertConnector();
    if (button.dataset.workerScheduleToggle) {
      const schedule = (state.backgroundWork?.schedules || []).find((item) => item.id === button.dataset.workerScheduleToggle);
      if (!schedule) throw new Error("The background schedule is unavailable.");
      if (!(await requestConfirmation({
        title: `${schedule.enabled ? "Pause" : "Resume"} ${schedule.displayName}?`,
        summary: "This changes maintenance only and cannot authorize a store action.",
        confirmLabel: schedule.enabled ? "Pause schedule" : "Resume schedule"
      })).confirmed) return;
      await api(`/api/v1/admin/workers/schedules/${encodeURIComponent(schedule.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !schedule.enabled })
      });
      await loadBackgroundWork(); renderBackgroundWork();
      toast(`${schedule.displayName} ${schedule.enabled ? "paused" : "resumed"}.`);
    }
    if (button.dataset.workerScheduleRun) {
      const schedule = (state.backgroundWork?.schedules || []).find((item) => item.id === button.dataset.workerScheduleRun);
      if (!schedule) throw new Error("The background schedule is unavailable.");
      await api(`/api/v1/admin/workers/schedules/${encodeURIComponent(schedule.id)}/run`, {
        method: "POST",
        body: "{}"
      });
      await loadBackgroundWork(); renderBackgroundWork();
      toast(`${schedule.displayName} queued for one bounded run.`);
    }
    if (button.dataset.workerTaskRetry) {
      if (!(await requestConfirmation({
        title: "Retry this maintenance task?",
        summary: "Attempts restart from zero. The task still has no store action authority.",
        confirmLabel: "Retry task"
      })).confirmed) return;
      await api(`/api/v1/admin/workers/tasks/${encodeURIComponent(button.dataset.workerTaskRetry)}/retry`, {
        method: "POST",
        body: "{}"
      });
      await loadBackgroundWork(); renderBackgroundWork();
      toast("Dead-lettered maintenance task queued for a bounded retry.");
    }
    if (button.dataset.signalInboxRetry) {
      if (!(await requestConfirmation({
        title: "Retry this call?",
        summary: "Continue only after correcting the parser or evaluation issue. Its bounded attempt counter restarts from zero.",
        confirmLabel: "Retry call"
      })).confirmed) return;
      await api(`/api/v1/admin/workers/signal-inbox/${encodeURIComponent(button.dataset.signalInboxRetry)}/retry`, {
        method: "POST",
        body: "{}"
      });
      await loadBackgroundWork(); renderBackgroundWork();
      toast("Call queued for corrected worker evaluation.");
    }
    if (button.dataset.adminChangeApprove) {
      if (!(await requestConfirmation({
        title: "Approve this protected change?",
        summary: "Approval does not apply it. The unchanged original operation must still be retried before expiry.",
        confirmLabel: "Approve change"
      })).confirmed) return;
      await api(`/api/v1/admin/change-requests/${encodeURIComponent(button.dataset.adminChangeApprove)}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision: "approve", confirmation: "APPROVE_HIGH_RISK_CHANGE" })
      });
      await refresh(false);
      toast("Change approved. The original operation can now be retried once.");
    }
    if (button.dataset.adminChangeReject) {
      if (!(await requestConfirmation({
        title: "Reject this protected change?",
        summary: "The change will not be applied.",
        confirmLabel: "Reject change",
        danger: true
      })).confirmed) return;
      await api(`/api/v1/admin/change-requests/${encodeURIComponent(button.dataset.adminChangeReject)}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision: "reject", confirmation: "REJECT_HIGH_RISK_CHANGE" })
      });
      await refresh(false);
      toast("Protected change rejected without applying it.");
    }
    if (button.dataset.operatorAlertRuleEdit) {
      const rule = (state.snapshot.operatorAlerts?.rules || []).find((item) => item.id === button.dataset.operatorAlertRuleEdit);
      if (!rule) throw new Error("The operator alert rule is unavailable.");
      openOperatorAlertRule(rule);
    }
    if (button.dataset.operatorAlertConnectorEdit) {
      const connector = (state.snapshot.operatorAlerts?.connectors?.connectors || []).find((item) => item.id === button.dataset.operatorAlertConnectorEdit);
      if (!connector) throw new Error("The operator alert connector is unavailable.");
      openOperatorAlertConnector(connector);
    }
    if (button.dataset.operatorAlertConnectorRetry) {
      if (!(await requestConfirmation({
        title: "Replay this dead-letter alert?",
        summary: "The original delivery identity, payload, and endpoint binding will be reused once. The message cannot be edited or retargeted.",
        confirmLabel: "Replay alert"
      })).confirmed) return;
      await api(`/api/v1/admin/alerts/connector-deliveries/${encodeURIComponent(button.dataset.operatorAlertConnectorRetry)}/retry`, {
        method: "POST",
        body: JSON.stringify({
          reasonCode: "operator_verified_retry",
          confirmation: "RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY"
        })
      });
      await refresh(false);
      toast("The selected dead-letter alert was scheduled for bounded replay.");
    }
    if (button.dataset.operatorAlertAcknowledge) {
      const decision = await requestConfirmation({
        title: "Acknowledge this operator alert?",
        summary: "Record that investigation has started.",
        note: {
          label: "Acknowledgement note (optional)",
          required: false,
          initialValue: "Investigating the sanitized repair group.",
          helper: "Do not include page text, account data, product IDs, tokens, or personal information."
        },
        confirmLabel: "Acknowledge"
      });
      if (!decision.confirmed) return;
      const note = decision.note;
      await api(`/api/v1/admin/alerts/incidents/${encodeURIComponent(button.dataset.operatorAlertAcknowledge)}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ reasonCode: "operator_investigating", note, confirmation: "ACKNOWLEDGE_OPERATOR_ALERT" })
      });
      await refresh(false); toast("Operator alert acknowledged and audited.");
    }
    if (button.dataset.operatorAlertResolve) {
      const decision = await requestConfirmation({
        title: "Resolve this operator alert?",
        summary: "The historical failure stays closed. A strictly later failure may open a new incident.",
        note: {
          label: "Resolution note",
          required: true,
          helper: "Do not include page text, account data, product IDs, tokens, or personal information."
        },
        confirmLabel: "Resolve alert"
      });
      if (!decision.confirmed) return;
      const note = decision.note;
      await api(`/api/v1/admin/alerts/incidents/${encodeURIComponent(button.dataset.operatorAlertResolve)}/resolve`, {
        method: "POST",
        body: JSON.stringify({ reasonCode: "maintainer_resolved", note, confirmation: "RESOLVE_OPERATOR_ALERT" })
      });
      await refresh(false); toast("Operator alert resolved with an immutable receipt.");
    }
    if (button.dataset.missionEdit) await openMission(button.dataset.missionEdit);
    if (button.id === "createPairingButton") {
      const result = await api("/api/v1/user/devices/pairing-code", { method: "POST", body: "{}" });
      state.pairing = result.pairing; renderDevices(); toast("One-time pairing code created. Enter it in the Yoink extension.");
    }
    if (button.id === "refreshDevicesButton") { await refresh(); toast("Chrome companion status refreshed."); }
    if (button.id === "copyPairingCodeButton" && state.pairing?.code) {
      await navigator.clipboard.writeText(state.pairing.code); toast("Pairing code copied.");
    }
    if (button.dataset.deviceRevoke) {
      if (!(await requestConfirmation({
        title: "Revoke this Chrome companion?",
        summary: "It will need a new one-time code to reconnect.",
        confirmLabel: "Revoke companion",
        danger: true
      })).confirmed) return;
      await api(`/api/v1/user/devices/${encodeURIComponent(button.dataset.deviceRevoke)}/revoke`, { method: "POST", body: "{}" });
      await refresh(); toast("Chrome companion revoked.");
    }
    if (button.dataset.catalogApprove) {
      const decision = await requestConfirmation({
        title: "Approve this exact listing?",
        summary: "The reviewed catalog proposal will be applied.",
        note: { label: "Review note", required: true, helper: NON_SENSITIVE_NOTE_HELP },
        confirmLabel: "Approve listing"
      });
      if (!decision.confirmed) return;
      await api(`/api/v1/admin/catalog/proposals/${encodeURIComponent(button.dataset.catalogApprove)}/decision`, {
        method: "POST",
        body: JSON.stringify({
          outcome: "approve",
          note: decision.note,
          confirmation: "APPROVE_CATALOG_PROPOSAL"
        })
      });
      await refresh(); toast("Catalog proposal approved and applied.");
    }
    if (button.dataset.catalogReject) {
      const decision = await requestConfirmation({
        title: "Reject this exact listing?",
        summary: "The proposal will close without changing the catalog.",
        note: { label: "Rejection note", required: true, helper: NON_SENSITIVE_NOTE_HELP },
        confirmLabel: "Reject listing",
        danger: true
      });
      if (!decision.confirmed) return;
      await api(`/api/v1/admin/catalog/proposals/${encodeURIComponent(button.dataset.catalogReject)}/decision`, {
        method: "POST",
        body: JSON.stringify({ outcome: "reject", note: decision.note, confirmation: "REJECT_CATALOG_PROPOSAL" })
      });
      await refresh(); toast("Catalog proposal rejected.");
    }
    if (button.dataset.catalogIdentityApprove) {
      const decision = await requestConfirmation({
        title: "Apply this catalog identity operation?",
        summary: "The live catalog must still match its immutable proposal fingerprint. Active purchase work fails closed.",
        note: { label: "Independent evidence or safety rationale", required: true, helper: NON_SENSITIVE_NOTE_HELP },
        confirmLabel: "Apply operation"
      });
      if (!decision.confirmed) return;
      await api(`/api/v1/admin/catalog/identity-operations/${encodeURIComponent(button.dataset.catalogIdentityApprove)}/decision`, {
        method: "POST",
        body: JSON.stringify({ outcome: "approve", note: decision.note, confirmation: "APPROVE_CATALOG_IDENTITY_OPERATION" })
      });
      await refresh(); toast("Catalog identity operation reviewed and applied.");
    }
    if (button.dataset.catalogIdentityReject) {
      const decision = await requestConfirmation({
        title: "Reject this catalog identity operation?",
        summary: "The catalog topology will remain unchanged.",
        note: { label: "Rejection reason", required: true, helper: NON_SENSITIVE_NOTE_HELP },
        confirmLabel: "Reject operation",
        danger: true
      });
      if (!decision.confirmed) return;
      await api(`/api/v1/admin/catalog/identity-operations/${encodeURIComponent(button.dataset.catalogIdentityReject)}/decision`, {
        method: "POST",
        body: JSON.stringify({ outcome: "reject", note: decision.note, confirmation: "REJECT_CATALOG_IDENTITY_OPERATION" })
      });
      await refresh(); toast("Catalog identity operation rejected without changing topology.");
    }
    if (button.dataset.catalogIdentityRollback) {
      const decision = await requestConfirmation({
        title: "Propose a compensating rollback?",
        summary: "It will not apply until reviewed. Any topology drift blocks it.",
        note: {
          label: "Compensation reason code",
          required: true,
          initialValue: "compensating_catalog_rollback",
          helper: "Use a short non-sensitive reason code."
        },
        confirmLabel: "Propose rollback",
        danger: true
      });
      if (!decision.confirmed) return;
      await api("/api/v1/admin/catalog/identity-operations", {
        method: "POST",
        body: JSON.stringify({
          kind: "rollback",
          reversedOperationId: button.dataset.catalogIdentityRollback,
          reasonCode: decision.note,
          confirmation: "PROPOSE_CATALOG_IDENTITY_OPERATION"
        })
      });
      await refresh(); toast("Compensating catalog operation submitted for review.");
    }
    if (button.dataset.roleGrant) {
      const select = $(`[data-role-selection="${CSS.escape(button.dataset.roleGrant)}"]`);
      if (!select?.value) throw new Error("Choose a role to grant.");
      const result = await api(`/api/v1/admin/authorization/users/${encodeURIComponent(button.dataset.roleGrant)}/roles/${encodeURIComponent(select.value)}`, { method: "POST", body: "{}" });
      await refresh(false);
      if (!protectedChangePending(result)) toast("Role membership granted and audited.");
    }
    if (button.dataset.roleRevoke && button.dataset.roleRevokeUser) {
      if (!(await requestConfirmation({
        title: `Revoke ${button.dataset.roleRevoke}?`,
        summary: "This user will lose the permissions granted by that role.",
        confirmLabel: "Revoke role",
        danger: true
      })).confirmed) return;
      const result = await api(`/api/v1/admin/authorization/users/${encodeURIComponent(button.dataset.roleRevokeUser)}/roles/${encodeURIComponent(button.dataset.roleRevoke)}`, { method: "DELETE" });
      await refresh(false);
      if (!protectedChangePending(result)) toast("Role membership revoked and audited.");
    }
    if (button.id === "actionsToggle") {
      const paused = !state.snapshot.settings.actionsPaused;
      const result = await api("/api/v1/user/settings/actions", { method: "PATCH", body: JSON.stringify({ paused, reason: paused ? "Paused from the control center." : "Enabled from the control center." }) });
      await refresh();
      if (!protectedChangePending(result)) toast(paused ? "Actions paused. Calls will continue to be recorded." : "Qualified store add-only actions resumed.");
    }
    if (button.dataset.communityEnable) {
      const card = button.closest("[data-community-retailer]");
      const locationScope = await communityLocationScope(card);
      if (!(await requestConfirmation({
        title: `Enable sharing for ${retailerName(button.dataset.communityEnable)}?`,
        summary: "Only explicit one-at-a-time shares from the Chrome companion are permitted.",
        scope: [
          "Shares normalized stock facts from server-accepted evidence.",
          "Never shares page HTML, clicks, forms, account data, payment data, or offer tokens.",
          "Community results remain advisory and cannot trigger actions."
        ],
        confirmLabel: "Enable sharing"
      })).confirmed) return;
      await api(`/api/v1/user/community/consents/${encodeURIComponent(button.dataset.communityEnable)}`, {
        method: "PATCH",
        body: JSON.stringify({
          enabled: true,
          locationScope,
          privacyVersion: state.snapshot.community.privacyVersion,
          confirmation: "SHARE_READ_ONLY_STOCK_EVIDENCE"
        })
      });
      await refresh(false);
      toast(`${retailerName(button.dataset.communityEnable)} community sharing enabled for explicit extension actions.`);
    }
    if (button.dataset.communityDisable) {
      await api(`/api/v1/user/community/consents/${encodeURIComponent(button.dataset.communityDisable)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false, locationScope: "", privacyVersion: "community-readonly-v1", confirmation: "SHARE_READ_ONLY_STOCK_EVIDENCE" })
      });
      await refresh(false);
      toast(`${retailerName(button.dataset.communityDisable)} community sharing disabled.`);
    }
    if (button.dataset.communityDelete) {
      if (!(await requestConfirmation({
        title: `Delete ${retailerName(button.dataset.communityDelete)} contributions?`,
        summary: "Assertions and receipts will be physically deleted. Sharing consent is unchanged.",
        confirmLabel: "Delete contributions",
        danger: true
      })).confirmed) return;
      await api(`/api/v1/user/community/contributions?retailer=${encodeURIComponent(button.dataset.communityDelete)}`, { method: "DELETE" });
      await refresh(false);
      toast(`${retailerName(button.dataset.communityDelete)} community contributions deleted.`);
    }
    if (button.id === "deleteAllCommunityButton") {
      if (!(await requestConfirmation({
        title: "Delete all community contributions?",
        summary: "The complete assertion and receipt ledger will be physically deleted. Store opt-ins are unchanged.",
        confirmLabel: "Delete all contributions",
        danger: true
      })).confirmed) return;
      await api("/api/v1/user/community/contributions", { method: "DELETE" });
      await refresh(false);
      toast("All community contributions deleted.");
    }
    if (button.dataset.identityReview && button.dataset.identityClaimId) {
      const reviewed = button.dataset.identityReview === "reviewed";
      const decision = await requestConfirmation({
        title: reviewed ? "Record this identity review?" : "Reject this identity claim?",
        summary: reviewed
          ? "This records provenance only. It does not remap listings, merge stock, move a plan, or satisfy independent community quorum."
          : "The catalog and plans remain unchanged.",
        note: {
          label: reviewed ? "Evidence reviewed" : "Rejection reason",
          required: true,
          helper: NON_SENSITIVE_NOTE_HELP
        },
        confirmLabel: reviewed ? "Record review" : "Reject claim",
        danger: !reviewed
      });
      if (!decision.confirmed) return;
      await api(`/api/v1/admin/identity/claims/${encodeURIComponent(button.dataset.identityClaimId)}/review`, {
        method: "POST",
        body: JSON.stringify({
          outcome: button.dataset.identityReview,
          note: decision.note,
          confirmation: "REVIEW_IDENTITY_CLAIM_WITHOUT_REMAP"
        })
      });
      await refresh(false);
      toast(reviewed ? "Local identity review recorded without remapping." : "Identity claim rejected.");
    }
    if (button.id === "deleteIdentityClaimsButton") {
      if (!(await requestConfirmation({
        title: "Delete all identity-claim history?",
        summary: "Catalog mappings and plans remain unchanged.",
        confirmLabel: "Delete history",
        danger: true
      })).confirmed) return;
      await api("/api/v1/user/identity/claims", { method: "DELETE" });
      await refresh(false);
      toast("Identity claim history deleted.");
    }
    if (button.id === "publishObserverWitnessButton") {
      if (!(await requestConfirmation({
        title: "Publish this public checkpoint?",
        summary: "The configured independent witness will receive the current cryptographic checkpoint.",
        scope: [
          "No selector data, browsing evidence, product data, or user identity is sent.",
          "No action authority is sent.",
          "Hosted recipe delivery stays closed unless the signed receipt is valid and fresh."
        ],
        confirmLabel: "Publish checkpoint"
      })).confirmed) return;
      button.disabled = true;
      await api("/api/v1/admin/observer-recipes/witness/publish", {
        method: "POST",
        body: JSON.stringify({ confirmation: "PUBLISH_OBSERVER_RECIPE_CHECKPOINT" })
      });
      await refresh(false);
      toast("Independent witness receipt verified and pinned.");
    }
    if (button.dataset.observerPromote && button.dataset.observerTarget) {
      if (!(await requestConfirmation({
        title: `Promote this recipe to ${button.dataset.observerTarget.replaceAll("_", " ")}?`,
        summary: "The Chrome companion still uses only its packaged interpreter.",
        scope: [
          "Cannot execute code or decide product identity.",
          "Cannot navigate, click, or fill forms.",
          "Cannot check out or submit an order."
        ],
        confirmLabel: "Promote recipe"
      })).confirmed) return;
      const result = await api(`/api/v1/admin/observer-recipes/${encodeURIComponent(button.dataset.observerPromote)}/promote`, {
        method: "POST",
        body: JSON.stringify({ targetState: button.dataset.observerTarget, confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE" })
      });
      await refresh(false);
      if (!protectedChangePending(result)) toast(`Observer recipe promoted to ${button.dataset.observerTarget.replaceAll("_", " ")}.`);
    }
    if (button.dataset.observerDisable) {
      if (!(await requestConfirmation({
        title: "Activate the recipe kill switch?",
        summary: "Distribution stops immediately. The packaged observer remains available.",
        confirmLabel: "Activate kill switch",
        danger: true
      })).confirmed) return;
      const result = await api(`/api/v1/admin/observer-recipes/${encodeURIComponent(button.dataset.observerDisable)}/disable`, {
        method: "POST",
        body: JSON.stringify({ confirmation: "DISABLE_OBSERVER_RECIPE", reasonCode: "maintainer_kill_switch" })
      });
      await refresh(false);
      if (!protectedChangePending(result)) toast("Observer recipe disabled immediately.");
    }
    if (button.dataset.observerResign) {
      if (!(await requestConfirmation({
        title: "Re-sign this reviewed recipe?",
        summary: "Its lifecycle state and selectors do not change.",
        scope: [
          "Restores read-only distribution after a trust rotation.",
          "Cannot grant store action authority."
        ],
        confirmLabel: "Re-sign recipe"
      })).confirmed) return;
      const result = await api(`/api/v1/admin/observer-recipes/${encodeURIComponent(button.dataset.observerResign)}/resign`, {
        method: "POST",
        body: JSON.stringify({ confirmation: "RESIGN_ROOTED_OBSERVER_RECIPE" })
      });
      await refresh(false);
      if (!protectedChangePending(result)) toast("Observer recipe re-signed under the current rooted trust generation.");
    }
    if (button.dataset.observerRollback) {
      if (!(await requestConfirmation({
        title: "Roll back this recipe?",
        summary: "The current recipe will be disabled and its pre-reviewed signed target restored.",
        confirmLabel: "Roll back recipe",
        danger: true
      })).confirmed) return;
      const result = await api(`/api/v1/admin/observer-recipes/${encodeURIComponent(button.dataset.observerRollback)}/rollback`, {
        method: "POST",
        body: JSON.stringify({ confirmation: "ROLLBACK_OBSERVER_RECIPE" })
      });
      await refresh(false);
      if (!protectedChangePending(result)) toast("Observer recipe rollback completed.");
    }
    if (button.id === "activateTargetAddButton") {
      const readiness = state.snapshot.targetQualification;
      if (!readiness?.qualificationEvidenceReady || !readiness.qualificationEvidenceHash) {
        throw new Error("Target qualification evidence is not ready yet.");
      }
      if (!(await requestConfirmation({
        title: "Enable guarded Target adds?",
        summary: "This activates only the qualified Target add lane.",
        scope: [
          "Target-sold offer for the reviewed SKU; Shipping by default or selected Pickup.",
          "Quantity one; revalidate SKU, seller, price, stock, and fulfillment before the click.",
          "Require a +1 cart delta with every prior quantity unchanged."
        ],
        confirmLabel: "Enable Target lane"
      })).confirmed) return;
      button.disabled = true;
      const result = await api("/api/v1/admin/qualifications/target-add/activate", {
        method: "POST",
        body: JSON.stringify({
          adapterVersion: readiness.addAdapterVersion,
          evidenceHash: readiness.qualificationEvidenceHash,
          confirmation: "ENABLE_TARGET_ADD_V7"
        })
      });
      await refresh();
      if (!protectedChangePending(result)) toast("Guarded Target add-only execution is active.");
    }
    if (button.id === "activateWalmartAddButton") {
      const readiness = state.snapshot.walmartQualification;
      if (!readiness?.qualificationEvidenceReady || !readiness.qualificationEvidenceHash) {
        throw new Error("Walmart qualification evidence is not ready yet.");
      }
      if (!(await requestConfirmation({
        title: "Enable guarded Walmart adds?",
        summary: "This activates only the qualified Walmart add lane.",
        scope: [
          "Walmart-sold offer for the reviewed item; Shipping by default or selected Pickup.",
          "Quantity one; stop at queues or challenges and revalidate the offer.",
          "Require a +1 cart delta with every prior quantity unchanged."
        ],
        confirmLabel: "Enable Walmart lane"
      })).confirmed) return;
      button.disabled = true;
      const result = await api("/api/v1/admin/qualifications/walmart-add/activate", {
        method: "POST",
        body: JSON.stringify({
          adapterVersion: readiness.addAdapterVersion,
          evidenceHash: readiness.qualificationEvidenceHash,
          confirmation: "ENABLE_WALMART_ADD_V7"
        })
      });
      await refresh();
      if (!protectedChangePending(result)) toast("Guarded Walmart add-only execution is active.");
    }
    if (button.id === "activateAmazonAddButton") {
      const readiness = state.snapshot.amazonQualification;
      if (!readiness?.qualificationEvidenceReady || !readiness.qualificationEvidenceHash) {
        throw new Error("Amazon qualification evidence is not ready yet.");
      }
      if (!(await requestConfirmation({
        title: "Enable guarded Amazon adds?",
        summary: "This activates only the qualified Amazon add lane.",
        scope: [
          "Amazon.com-sold offer with an ephemeral offer binding.",
          "Shipping by default or explicitly configured Pickup; quantity one.",
          "Stop at challenges, revalidate the offer, and require a +1 cart delta."
        ],
        confirmLabel: "Enable Amazon lane"
      })).confirmed) return;
      button.disabled = true;
      const result = await api("/api/v1/admin/qualifications/amazon-add/activate", {
        method: "POST",
        body: JSON.stringify({
          adapterVersion: readiness.addAdapterVersion,
          evidenceHash: readiness.qualificationEvidenceHash,
          confirmation: "ENABLE_AMAZON_ADD_V9"
        })
      });
      await refresh();
      if (!protectedChangePending(result)) toast("Guarded Amazon add-only execution is active.");
    }
    if (button.id === "activateBestBuyAddButton") {
      const readiness = state.snapshot.bestBuyQualification;
      if (!readiness?.qualificationEvidenceReady || !readiness.qualificationEvidenceHash) {
        throw new Error("Best Buy qualification evidence is not ready yet.");
      }
      if (!(await requestConfirmation({
        title: "Enable guarded Best Buy adds?",
        summary: "This activates only the qualified Best Buy add lane.",
        scope: [
          "Offers explicitly labeled Sold by Best Buy only.",
          "Shipping by default or explicitly configured Pickup; quantity one.",
          "Stop at high-demand queues or challenges, revalidate, and require a +1 cart delta."
        ],
        confirmLabel: "Enable Best Buy lane"
      })).confirmed) return;
      button.disabled = true;
      const result = await api("/api/v1/admin/qualifications/bestbuy-add/activate", {
        method: "POST",
        body: JSON.stringify({
          adapterVersion: readiness.addAdapterVersion,
          evidenceHash: readiness.qualificationEvidenceHash,
          confirmation: "ENABLE_BESTBUY_ADD_V10"
        })
      });
      await refresh();
      if (!protectedChangePending(result)) toast("Guarded Best Buy add-only execution is active.");
    }
    if (button.dataset.reviewResolution && button.dataset.jobId) {
      const confirmed = button.dataset.reviewResolution === "confirmed";
      if (!(await requestConfirmation({
        title: confirmed ? "Confirm this action succeeded?" : "Confirm no purchase completed?",
        summary: confirmed
          ? "Continue only after checking the store session and verifying the intended item and result. This updates plan progress."
          : "Continue only after checking the store session or cart. This closes the incident so a future call can try again.",
        confirmLabel: confirmed ? "Confirm success" : "Confirm no purchase",
        danger: !confirmed
      })).confirmed) return;
      await api(`/api/v1/user/jobs/${encodeURIComponent(button.dataset.jobId)}/resolve`, {
        method: "POST",
        body: JSON.stringify({
          outcome: button.dataset.reviewResolution,
          confirmation: "I_REVIEWED_BROWSER_STATE"
        })
      });
      await refresh();
      toast(confirmed ? "Action marked verified successful." : "Action closed as verified no purchase.");
    }
    if (button.dataset.strategyEdit) openStrategy(state.snapshot.strategies.find((item) => item.id === button.dataset.strategyEdit));
    if (button.dataset.strategyDelete) {
      const strategies = state.snapshot.strategies.filter((item) => item.id !== button.dataset.strategyDelete).map((item, index) => ({ ...item, position: (index + 1) * 10 }));
      await saveStrategies(strategies); toast("Rule deleted.");
    }
    if (button.dataset.strategyMove) {
      const strategies = [...state.snapshot.strategies];
      const index = strategies.findIndex((item) => item.id === button.dataset.strategyId);
      const target = button.dataset.strategyMove === "up" ? index - 1 : index + 1;
      if (index >= 0 && target >= 0 && target < strategies.length) [strategies[index], strategies[target]] = [strategies[target], strategies[index]];
      await saveStrategies(strategies.map((item, itemIndex) => ({ ...item, position: (itemIndex + 1) * 10 })));
    }
  } catch (error) { toast(error.message || "The action failed.", true); }
});

$("#sourceChannelProvider").addEventListener("change", syncSourceChannelReferenceField);
syncSourceChannelReferenceField();

$("#sourceChannelForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const values = formObject(form);
    if (values.provider === "discord" && !/^\d{17,20}$/.test(String(values.externalReference || ""))) {
      throw new Error("Enter the 17–20 digit Discord channel ID.");
    }
    await api("/api/v1/admin/sources/channels", {
      method: "POST",
      body: JSON.stringify({
        provider: values.provider,
        name: values.name,
        externalReference: values.externalReference,
        trustLevel: values.trustLevel,
        autoCreateMissions: false,
        replayWindowSeconds: 900
      })
    });
    form.reset();
    syncSourceChannelReferenceField();
    await loadActionPlatformAdmin(); renderActionPlatformAdmin();
    toast("Source channel created with plan auto-creation off.");
  } catch (error) { toast(error.message || "The source channel could not be created.", true); }
});

$("#dropWindowForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const values = formObject(form);
    const products = state.dropWindowDraftProducts;
    if (!products.length || products.length > 50) throw new Error("Choose 1 through 50 products.");
    const stores = new Set(products.map((item) => item.retailerId));
    if (stores.size !== 1 || !values.retailerId) throw new Error("Every product in a drop window must be from one store.");
    const earlyAccessNote = String(values.earlyAccessNote || "").trim();
    await api("/api/v1/admin/drop-windows", {
      method: "POST",
      body: JSON.stringify({
        contractVersion: 1,
        kind: values.kind,
        retailerId: values.retailerId,
        title: values.title,
        startsAt: new Date(values.startsAt).toISOString(),
        closesAt: new Date(values.closesAt).toISOString(),
        spreadSeconds: Number(values.staggerMinutes) * 60,
        confidenceBps: Number(values.confidenceBps),
        timezone: values.timezone,
        ...(values.supersedesId ? { supersedesId: values.supersedesId } : {}),
        products: products.map((product) => ({
          listingId: product.listingId,
          ...(earlyAccessNote ? { earlyAccess: { note: earlyAccessNote } } : {})
        }))
      })
    });
    form.reset();
    state.dropWindowDraftProducts = [];
    state.dropWindowSearchResults = [];
    populateTimezoneSelect(form.elements.timezone, state.dropWindowTimezone);
    await loadActionPlatformAdmin(); renderActionPlatformAdmin();
    toast("Drop window scheduled.");
  } catch (error) { toast(error.message || "The drop window could not be scheduled.", true); }
});

$("#dropWindowEditForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const values = formObject(form);
    const result = await api(`/api/v1/admin/drop-windows/${encodeURIComponent(values.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: values.title,
        startsAt: new Date(values.startsAt).toISOString(),
        closesAt: new Date(values.closesAt).toISOString(),
        spreadSeconds: Number(values.staggerMinutes) * 60,
        confidenceBps: Number(values.confidenceBps),
        timezone: values.timezone,
        earlyAccessNote: String(values.earlyAccessNote || "").trim()
      })
    });
    state.editingDropWindow = result.window;
    const dialog = $("#dropWindowDialog");
    dialog.close();
    restoreAdminDetailRoute(dialog);
    await loadActionPlatformAdmin();
    renderActionPlatformAdmin();
    toast("Drop window updated.");
  } catch (error) { toast(error.message || "The drop window could not be updated.", true); }
});

$("#restockPatternForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const values = formObject(form);
    if (!values.listingId) throw new Error("Choose a product before recomputing its restock pattern.");
    await api("/api/v1/admin/restock-patterns/recompute", {
      method: "POST",
      body: JSON.stringify({ listingId: values.listingId, timezone: values.timezone })
    });
    state.restockPatternProduct = null;
    state.restockPatternSearchResults = [];
    form.reset();
    populateTimezoneSelect(form.elements.timezone, state.dropWindowTimezone);
    await loadActionPlatformAdmin(); renderActionPlatformAdmin();
    toast("Restock pattern recomputed.");
  } catch (error) { toast(error.message || "The restock pattern could not be recomputed.", true); }
});

let dropWindowProductSearchTimer;
$("#dropWindowProductSearch").addEventListener("input", (event) => {
  clearTimeout(dropWindowProductSearchTimer);
  const query = event.currentTarget.value;
  dropWindowProductSearchTimer = setTimeout(() => searchListingPicker("drop-window", query).catch((error) => toast(error.message || "Product search failed.", true)), 250);
});

let restockPatternProductSearchTimer;
$("#restockPatternProductSearch").addEventListener("input", (event) => {
  clearTimeout(restockPatternProductSearchTimer);
  const query = event.currentTarget.value;
  restockPatternProductSearchTimer = setTimeout(() => searchListingPicker("restock-pattern", query).catch((error) => toast(error.message || "Product search failed.", true)), 250);
});

$("#dropWindowForm").addEventListener("input", (event) => {
  if (["startsAt", "closesAt"].includes(event.target.name)) renderDropWindowDuration();
});

let librarySearchTimer;
let adminUserSearchTimer;
$("#adminUserSearch").addEventListener("input", (event) => {
  clearTimeout(adminUserSearchTimer);
  state.adminUserQuery = event.currentTarget.value.trim();
  adminUserSearchTimer = setTimeout(() => loadAdminUsers()
    .then(renderAuthorization)
    .catch((error) => toast(error.message || "User search failed.", true)), 250);
});
$("#operationalWindow").addEventListener("change", async () => {
  try {
    await loadOperationalTelemetry();
    renderOperationalTelemetry();
  } catch (error) {
    toast(error.message || "Operational health could not be loaded.", true);
  }
});
$("#adminAnalyticsWindow").addEventListener("change", async (event) => {
  state.adminAnalyticsWindow = event.currentTarget.value;
  try {
    await loadAdminAnalytics();
    renderAdminAnalytics();
  } catch (error) {
    toast(error.message || "Analytics could not be loaded.", true);
  }
});
$("#librarySearch").addEventListener("input", () => {
  clearTimeout(librarySearchTimer);
  librarySearchTimer = setTimeout(() => loadLibrary(true).then(renderLibrary).catch((error) => toast(error.message || "Library search failed.", true)), 250);
});
let missionSearchTimer;
$("#missionSearch").addEventListener("input", () => {
  clearTimeout(missionSearchTimer);
  missionSearchTimer = setTimeout(() => loadMissions(true).then(renderMissions).catch((error) => toast(error.message || "Plan search failed.", true)), 250);
});
let auditSearchTimer;
$("#auditSearch").addEventListener("input", () => {
  clearTimeout(auditSearchTimer);
  auditSearchTimer = setTimeout(() => loadAudit(true).then(renderAudit).catch((error) => toast(error.message || "Activity search failed.", true)), 250);
});
[$("#auditType"), $("#auditActor"), $("#auditRange")].forEach((filter) => filter.addEventListener("change", () => {
  loadAudit(true).then(renderAudit).catch((error) => toast(error.message || "Activity filters could not be applied.", true));
}));
let signalSearchTimer;
$("#signalSearch").addEventListener("input", () => {
  clearTimeout(signalSearchTimer);
  signalSearchTimer = setTimeout(() => loadSignals(true).then(renderSignals).catch((error) => toast(error.message || "Call search failed.", true)), 250);
});
let jobSearchTimer;
$("#jobSearch").addEventListener("input", () => {
  clearTimeout(jobSearchTimer);
  jobSearchTimer = setTimeout(() => loadJobs(true).then(renderJobs).catch((error) => toast(error.message || "Action search failed.", true)), 250);
});
let notificationSearchTimer;
$("#notificationSearch").addEventListener("input", () => {
  clearTimeout(notificationSearchTimer);
  notificationSearchTimer = setTimeout(() => loadNotifications(true).then(renderNotifications).catch((error) => toast(error.message || "Notification search failed.", true)), 250);
});
let attributionReceiptSearchTimer;
$("#attributionReceiptSearch").addEventListener("input", () => {
  clearTimeout(attributionReceiptSearchTimer);
  attributionReceiptSearchTimer = setTimeout(() => loadAttributionReceipts(true).then(renderAttributionReceipts).catch((error) => toast(error.message || "Affiliate route search failed.", true)), 250);
});
$("#libraryMoreButton").addEventListener("click", async () => {
  try { await loadLibrary(false); renderLibrary(); } catch (error) { toast(error.message || "More listings could not be loaded.", true); }
});
$("#missionMoreButton").addEventListener("click", async () => {
  try { await loadMissions(false); renderMissions(); } catch (error) { toast(error.message || "More plans could not be loaded.", true); }
});
$("#auditMoreButton").addEventListener("click", async () => {
  try { await loadAudit(false); renderAudit(); } catch (error) { toast(error.message || "More activity could not be loaded.", true); }
});
$("#signalMoreButton").addEventListener("click", async () => {
  try { await loadSignals(false); renderSignals(); } catch (error) { toast(error.message || "More calls could not be loaded.", true); }
});
$("#jobMoreButton").addEventListener("click", async () => {
  try { await loadJobs(false); renderJobs(); } catch (error) { toast(error.message || "More actions could not be loaded.", true); }
});
$("#notificationMoreButton").addEventListener("click", async () => {
  try { await loadNotifications(false); renderNotifications(); } catch (error) { toast(error.message || "More notifications could not be loaded.", true); }
});
$("#attributionReceiptMoreButton").addEventListener("click", async () => {
  try { await loadAttributionReceipts(false); renderAttributionReceipts(); } catch (error) { toast(error.message || "More affiliate routes could not be loaded.", true); }
});
$("#adminUserCreateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const values = formObject(form);
    const result = await api("/api/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ displayName: values.displayName, initialRoleId: values.initialRoleId })
    });
    if (protectedChangePending(result)) {
      form.closest("dialog").close();
      return;
    }
    state.selectedAdminUser = result;
    state.adminUserQuery = "";
    state.adminUserTab = "plans";
    state.adminUserPairing = null;
    $("#adminUserSearch").value = "";
    form.closest("dialog").close();
    await loadAdminUsers();
    renderAuthorization();
    renderAdminUserDetail();
    $("#adminUserDialog").showModal();
    state.adminDetailPushed.adminUserDialog = true;
    history.pushState(null, "", `#access/user/${encodeURIComponent(state.selectedAdminUser.user.id)}`);
    toast(`${state.selectedAdminUser.user.displayName} created with actions paused.`);
  } catch (error) { toast(error.message || "The user could not be created.", true); }
});
$("#operatorAlertRuleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const values = formObject(form);
    const routes = $$('input[name="route"]:checked', form).map((input) => input.value);
    if (!routes.length) throw new Error("Choose at least one operator alert route.");
    const payload = {
      eventFamily: values.eventFamily,
      name: values.name,
      enabled: form.elements.enabled.checked,
      severity: values.severity,
      minimumOccurrences: Number(values.minimumOccurrences),
      dedupeWindowSeconds: Number(values.dedupeWindowSeconds),
      escalationAfterSeconds: Number(values.escalationAfterSeconds),
      retailerScope: values.retailerScope,
      operationScope: values.operationScope,
      routes,
      confirmation: "SAVE_OPERATOR_ALERT_RULE"
    };
    const id = String(values.id || "");
    await api(id ? `/api/v1/admin/alerts/rules/${encodeURIComponent(id)}` : "/api/v1/admin/alerts/rules", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    state.editingOperatorAlertRuleId = "";
    form.closest("dialog").close();
    await refresh(false);
    toast("Operator alert rule saved and audited.");
  } catch (error) { toast(error.message || "Operator alert rule could not be saved.", true); }
});
$("#operatorAlertConnectorForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const values = formObject(form);
    const payload = {
      name: values.name,
      enabled: form.elements.enabled.checked,
      kind: values.kind,
      endpointReference: values.endpointReference,
      minimumSeverity: values.minimumSeverity,
      confirmation: "SAVE_OPERATOR_ALERT_CONNECTOR"
    };
    const id = String(values.id || "");
    await api(id ? `/api/v1/admin/alerts/connectors/${encodeURIComponent(id)}` : "/api/v1/admin/alerts/connectors", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    state.editingOperatorAlertConnectorId = "";
    form.closest("dialog").close();
    await refresh(false);
    toast("Operator alert connector saved without storing a URL or signing secret.");
  } catch (error) { toast(error.message || "Operator alert connector could not be saved.", true); }
});
$("#catalogIdentityForm").elements.kind.addEventListener("change", (event) => {
  configureCatalogIdentityForm(event.currentTarget.value);
});
$("#catalogIdentityForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = formObject(event.currentTarget);
    let payload;
    if (values.kind === "merge_variants") {
      if (!values.targetVariantId || !values.reviewedIdentityClaimId) {
        throw new Error("A merge requires the target variant and reviewed exact-identifier claim IDs.");
      }
      payload = {
        kind: values.kind,
        sourceVariantId: values.sourceVariantId,
        targetVariantId: values.targetVariantId,
        reviewedIdentityClaimId: values.reviewedIdentityClaimId,
        reasonCode: values.reasonCode,
        confirmation: "PROPOSE_CATALOG_IDENTITY_OPERATION"
      };
    } else {
      const listingIds = String(values.listingIds || "").split(",").map((value) => value.trim()).filter(Boolean);
      if (!listingIds.length || !values.newTitle || !values.attributeValue) {
        throw new Error("A split requires listing IDs, a new exact-variant title, and an explicit variant dimension.");
      }
      payload = {
        kind: values.kind,
        sourceVariantId: values.sourceVariantId,
        listingIds,
        newTitle: values.newTitle,
        newBrand: values.newBrand,
        newVariantAttributes: { [values.attributeKey]: values.attributeValue },
        reasonCode: values.reasonCode,
        confirmation: "PROPOSE_CATALOG_IDENTITY_OPERATION"
      };
    }
    if (!(await requestConfirmation({
      title: "Send this topology proposal for review?",
      summary: "No catalog row changes until an independent approval.",
      confirmLabel: "Send for review"
    })).confirmed) return;
    await api("/api/v1/admin/catalog/identity-operations", { method: "POST", body: JSON.stringify(payload) });
    $("#catalogIdentityDialog").close();
    await refresh();
    toast("Catalog identity operation submitted for governed review.");
  } catch (error) { toast(error.message || "Catalog identity proposal failed.", true); }
});
$("#listingForm").addEventListener("input", (event) => {
  const form = event.currentTarget;
  if (event.target.name === "url" && form.elements.url.value.trim() !== state.listingLinkPreviewInput) {
    clearListingLinkPreview();
  }
  $("#submitListingLinkButton").disabled = !state.listingLinkPreview
    || form.elements.url.value.trim() !== state.listingLinkPreviewInput
    || form.elements.confirmed.checked !== true;
});

$("#listingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#submitListingLinkButton");
  try {
    const url = form.elements.url.value.trim();
    if (!state.listingLinkPreview || state.listingLinkPreviewInput !== url) {
      throw new Error("Check the product link again before sending it for review.");
    }
    if (form.elements.confirmed.checked !== true) {
      throw new Error("Confirm the product-page review first.");
    }
    button.disabled = true;
    button.textContent = "Sending…";
    const result = await api("/api/v1/user/catalog/link-proposals", {
      method: "POST",
      body: JSON.stringify({
        url,
        title: form.elements.title.value,
        msrpCents: dollarsToCents(form.elements.msrp.value),
        confirmation: "PROPOSE_EXACT_PRODUCT_LINK"
      })
    });
    $("#listingDialog").close();
    clearListingLinkPreview();
    await refresh();
    toast(result.disposition === "duplicate_pending"
      ? "That listing is already waiting for review."
      : "Product link sent for review.");
  } catch (error) {
    toast(error.message || "The product link could not be sent for review.", true);
  } finally {
    button.disabled = !state.listingLinkPreview || form.elements.confirmed.checked !== true;
    button.textContent = "Send for review";
  }
});

$("#rawListingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = formObject(event.currentTarget);
    const source = state.snapshot.sources.find((item) => item.id === values.sourceConnectionId)?.source;
    if (!source) throw new Error("Choose an available source.");
    await api("/api/v1/user/catalog/proposals", { method: "POST", body: JSON.stringify({
      sourceConnectionId: values.sourceConnectionId, source,
      sourceProductId: values.sourceProductId, sourceListingId: values.sourceListingId,
      title: values.title, retailerId: values.retailerId, retailerSku: values.retailerSku,
      canonicalUrl: values.canonicalUrl, listingStatus: values.listingStatus,
      executionSupported: event.currentTarget.elements.executionSupported.checked,
      msrpCents: dollarsToCents(values.msrp), currency: "USD"
    }) });
    event.currentTarget.closest("dialog").close(); await refresh(); toast("Raw listing proposal sent for review.");
  } catch (error) { toast(error.message || "Raw listing proposal could not be sent.", true); }
});

$("#strategyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = formObject(event.currentTarget);
    if (!["notify", "add_to_cart"].includes(values.action)) {
      throw new Error("Choose Notify or Add to cart before saving this rule.");
    }
    const maxPriceCents = dollarsToCents(values.maxPrice);
    const pricePolicy = { kind: values.priceKind };
    if (["absolute_max", "above_msrp"].includes(values.priceKind)) {
      if (maxPriceCents === null) throw new Error("This price policy requires an absolute maximum.");
      pricePolicy.maxPriceCents = maxPriceCents;
    }
    if (values.priceKind === "slightly_above_msrp") {
      const tolerancePercent = Number(values.tolerancePercent);
      if (!Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 100) {
        throw new Error("Slightly-above tolerance must be from 0% through 100%.");
      }
      pricePolicy.toleranceBps = Math.round(tolerancePercent * 100);
    }
    const strategy = {
      id: values.id, name: values.name, enabled: event.currentTarget.elements.enabled.checked,
      position: Number(values.position), revision: Number(values.revision || 1),
      sources: $$('[data-strategy-source]:checked', event.currentTarget).map((input) => input.value),
      retailers: $$('[data-strategy-retailer]:checked', event.currentTarget).map((input) => input.value),
      pricePolicy,
      sellerPolicy: values.sellerPolicy, allowedSellers: commaList(values.allowedSellers), includeKeywords: values.includeKeywords,
      excludeKeywords: values.excludeKeywords, action: values.action,
      quantity: values.action === "add_to_cart" && values.quantity === "max" ? "max" : Number(values.quantity), fulfillment: values.fulfillment,
      maxSignalAgeSeconds: Number(values.maxSignalAgeSeconds)
    };
    const others = state.snapshot.strategies.filter((item) => item.id !== strategy.id);
    await saveStrategies([...others, strategy].sort((left, right) => left.position - right.position));
    event.currentTarget.closest("dialog").close(); toast("Rule saved. The first matching rule wins.");
  } catch (error) { toast(error.message || "Rule could not be saved.", true); }
});

$("#strategyForm").addEventListener("change", (event) => {
  if (event.target.name === "action") syncStrategyActionFields(event.currentTarget);
});

$("#missionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = formObject(event.currentTarget);
    const targets = $$("[data-mission-target]", $("#missionTargetEditors")).map((editor) => ({
      id: editor.dataset.missionTarget,
      enabled: $("[data-target-field='enabled']", editor).checked,
      maxUnitPriceCents: dollarsToCents($("[data-target-field='maxUnitPrice']", editor).value),
      sellerPolicy: $("[data-target-field='sellerPolicy']", editor).value,
      fulfillment: $("[data-target-field='fulfillment']", editor).value
    }));
    if (!targets.length) throw new Error("This plan has no listing targets.");
    await api(`/api/v1/user/missions/${encodeURIComponent(values.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: values.status,
        targetQuantity: Number(values.targetQuantity),
        targets
      })
    });
    state.editingMission = null;
    event.currentTarget.closest("dialog").close();
    await refresh();
    toast("Plan and store target guardrails saved.");
  } catch (error) { toast(error.message || "Plan could not be saved.", true); }
});

$("#identityClaimForm").addEventListener("input", () => { state.identityDirty = true; });
$("#identityClaimForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = formObject(event.currentTarget);
    if (!values.listingId || !values.referenceListingId || values.listingId === values.referenceListingId) {
      throw new Error("Choose two different exact store listings.");
    }
    if (!(await requestConfirmation({
      title: "Propose this cross-store identity claim?",
      summary: "Only exact identifiers and selected variant attributes are accepted.",
      scope: [
        "Does not remap the catalog or merge inventory.",
        "Does not transfer a plan or authorize an action."
      ],
      confirmLabel: "Propose identity claim"
    })).confirmed) return;
    const attributes = {
      ...(values.size ? { size: values.size } : {}),
      ...(values.color ? { color: values.color } : {}),
      ...(values.edition ? { edition: values.edition } : {}),
      ...(values.language ? { language: values.language } : {}),
      ...(values.packCount ? { packCount: Number(values.packCount) } : {}),
      ...(values.condition ? { condition: values.condition } : {})
    };
    await api("/api/v1/user/identity/claims", {
      method: "POST",
      body: JSON.stringify({
        contractVersion: 1,
        listingId: values.listingId,
        referenceListingId: values.referenceListingId,
        identifierKind: values.identifierKind,
        identifierValue: values.identifierValue,
        brand: values.brand,
        mpn: values.mpn,
        attributes,
        provenanceNote: "manual_catalog_review",
        confirmation: "PROPOSE_EXACT_PRODUCT_EQUIVALENCE"
      })
    });
    event.currentTarget.reset();
    state.identityDirty = false;
    await refresh(false);
    toast("Exact identity claim recorded without changing catalog truth.");
  } catch (error) { toast(error.message || "Identity claim could not be recorded.", true); }
});

$("#observerRecipeForm").addEventListener("input", () => { state.observerRecipeDirty = true; });
$("#observerTrustForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = formObject(event.currentTarget);
    let manifest;
    try { manifest = JSON.parse(values.manifestJson); } catch { throw new Error("The trust manifest must be valid JSON."); }
    if (!(await requestConfirmation({
      title: "Install this signed trust manifest?",
      summary: "Yoink will verify the packaged root and immutable trust chain.",
      scope: [
        "Verifies schema, generation, predecessor, active key, lifetimes, and permanent revocations.",
        "Does not grant store action authority."
      ],
      confirmLabel: "Install manifest"
    })).confirmed) return;
    const result = await api("/api/v1/admin/observer-recipes/trust-manifests", {
      method: "POST",
      body: JSON.stringify({
        manifest,
        confirmation: "INSTALL_ROOTED_OBSERVER_RECIPE_TRUST_MANIFEST"
      })
    });
    await refresh(false);
    if (!protectedChangePending(result)) {
      event.currentTarget.reset();
      toast("Root-signed observer trust manifest installed and transparency-receipted.");
    }
  } catch (error) { toast(error.message || "Observer recipe trust manifest could not be installed.", true); }
});

$("#observerRecipeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = formObject(event.currentTarget);
    let fields;
    try { fields = JSON.parse(values.fieldsJson); } catch { throw new Error("Observer recipe field definitions must be valid JSON."); }
    if (!(await requestConfirmation({
      title: "Submit this recipe to quarantine?",
      summary: "The server rejects fields, selectors, attributes, and operations outside the packaged observer-only schema.",
      scope: ["Submission does not distribute or execute the recipe."],
      confirmLabel: "Submit to quarantine"
    })).confirmed) return;
    await api("/api/v1/admin/observer-recipes", {
      method: "POST",
      body: JSON.stringify({
        contractVersion: 1,
        retailerId: values.retailerId,
        recipeVersion: values.recipeVersion,
        minimumExtensionVersion: values.minimumExtensionVersion,
        expiresAt: new Date(Date.now() + Number(values.lifetimeDays) * 24 * 60 * 60_000).toISOString(),
        rollbackRecipeId: values.rollbackRecipeId,
        fields,
        provenanceCode: values.provenanceCode,
        confirmation: "PROPOSE_OBSERVER_ONLY_RECIPE"
      })
    });
    event.currentTarget.reset();
    state.observerRecipeDirty = false;
    await refresh(false);
    toast("Observer-only recipe structurally validated and quarantined.");
  } catch (error) { toast(error.message || "Observer recipe could not be proposed.", true); }
});

$("#settingsForm").addEventListener("input", () => { state.settingsDirty = true; });
$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = formObject(event.currentTarget);
    const taxPercent = Number(values.taxPercent);
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
      throw new Error("Tax reserve must be from 0% through 100%.");
    }
    await api("/api/v1/user/settings", {
      method: "PATCH",
      body: JSON.stringify({
        dedupeWindowSeconds: Number(values.dedupeWindowSeconds),
        affiliateMode: values.affiliateMode,
        taxBps: Math.round(taxPercent * 100),
        storeAllowancesCents: {
          target: nonNegativeDollarsToCents(values.targetAllowance),
          walmart: nonNegativeDollarsToCents(values.walmartAllowance),
          amazon: nonNegativeDollarsToCents(values.amazonAllowance),
          bestbuy: nonNegativeDollarsToCents(values.bestbuyAllowance)
        }
      })
    });
    state.settingsDirty = false;
    await refresh();
    toast("Call and order guardrails saved.");
  } catch (error) { toast(error.message || "Settings could not be saved.", true); }
});

$("#howlStoreFilter").addEventListener("input", (event) => {
  state.howlStoreQuery = event.currentTarget.value;
  state.howlStoreExpanded = false;
  renderHowlStoreDirectory();
});
$("#attributionPolicyForm").elements.provider.addEventListener("change", updateAttributionPolicyFields);
$("#attributionPolicyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const retailerId = form.elements.retailerId.value;
    const policies = (state.snapshot.attributionPolicies || []).map((policy) => policy.retailerId === retailerId ? {
      retailerId,
      enabled: form.elements.enabled.checked,
      provider: form.elements.provider.value,
      publisherSlug: form.elements.publisherSlug.value,
      articleBaseUrl: form.elements.articleBaseUrl.value,
      associateTag: form.elements.associateTag.value
    } : {
      retailerId: policy.retailerId,
      enabled: policy.enabled,
      provider: policy.provider,
      publisherSlug: policy.publisherSlug,
      articleBaseUrl: policy.articleBaseUrl,
      associateTag: policy.associateTag
    });
    const result = await api("/api/v1/admin/attribution-policies", {
      method: "PUT",
      body: JSON.stringify({ policies })
    });
    state.editingAttributionRetailerId = "";
    $("#attributionPolicyDialog").close();
    await refresh();
    if (!protectedChangePending(result)) toast("Store affiliate policy saved.");
  } catch (error) { toast(error.message || "The store affiliate policy could not be saved.", true); }
});

$("#signalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const values = formObject(form);
    const live = values.mode === "live";
    if (live) {
      const decision = await requestConfirmation({
        title: "Send this live call?",
        summary: "This enters the production call pipeline. Existing catalog, plan, price, seller, fulfillment, spend, and store-lane rules still decide whether any action job is created.",
        scope: [
          `${retailerName(values.retailerId)} · ${values.retailerSku || "new listing"}`,
          `${values.title} · ${values.availability.replaceAll("_", " ")}`,
          "No store control is clicked by this form."
        ],
        confirmLabel: "Send live call"
      });
      if (!decision.confirmed) return;
    }
    const source = (state.snapshot.sources || []).find((item) => item.id === values.sourceConnectionId)?.source;
    const body = {
      sourceConnectionId: values.sourceConnectionId, source,
      externalEventId: values.externalEventId, eventType: values.eventType,
      observedAt: new Date().toISOString(), test: !live,
      identity: {
        sourceProductId: values.sourceProductId, sourceListingId: values.sourceListingId,
        retailerId: values.retailerId, retailerSku: values.retailerSku,
        canonicalUrl: values.canonicalUrl, title: values.title
      },
      offer: {
        availability: values.availability, unitPriceCents: dollarsToCents(values.price), currency: "USD",
        sellerName: values.sellerName, sellerType: values.sellerType,
        orderLimit: values.orderLimit ? Number(values.orderLimit) : null,
        fulfillment: values.fulfillment, offerId: values.offerId
      },
      evidence: { headline: `${values.title} call`, body: `Submitted through the local Yoink control center.` },
      parserVersion: "control-center-v1"
    };
    const result = await api("/api/v1/user/signals", { method: "POST", body: JSON.stringify(body) });
    form.closest("dialog").close(); await refresh(); toast(`${live ? "Live" : "Dry-run"} call accepted: ${result.decision.replaceAll("_", " ")}.`);
  } catch (error) { toast(error.message || "Call could not be sent.", true); }
});

$("#signalForm").addEventListener("change", (event) => {
  if (["mode", "retailerId"].includes(event.target.name)) renderSignalModePreview();
});

$("#signalSimulationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#simulateSignalButton");
  const resultElement = $("#signalSimulationResult");
  const values = formObject(form);
  form.setAttribute("aria-busy", "true");
  button.disabled = true;
  button.textContent = "Simulating…";
  resultElement.hidden = false;
  resultElement.classList.remove("error");
  resultElement.textContent = "Running the dry-run call…";
  try {
    const response = await api("/api/v1/admin/signals/simulate", {
      method: "POST",
      body: JSON.stringify({ url: values.url, price: values.price })
    });
    const simulation = response.simulation;
    const identity = simulation.catalog?.matched
      ? simulation.catalog.title
      : `${simulation.retailerName} product`;
    resultElement.innerHTML = `<strong>Dry-run recorded</strong>
      <p>${escapeHtml(identity)} · ${escapeHtml(simulation.retailerSku)} · ${escapeHtml(formatMoney(simulation.unitPriceCents, simulation.currency))}</p>
      <p>${simulation.catalog?.matched ? "Matched the existing catalog listing." : "The exact URL was recognized; no catalog listing was created."}</p>
      <p class="signal-simulation-boundary">No plan · No action job · No store action · No cart change</p>`;
    await loadSignals(true);
    renderSignals();
    toast("Dry-run call recorded.");
  } catch (error) {
    resultElement.classList.add("error");
    resultElement.innerHTML = `<strong>Simulation stopped safely</strong><p>${escapeHtml(error.message || "The call could not be simulated.")}</p>`;
    toast(error.message || "Call could not be simulated.", true);
  } finally {
    form.removeAttribute("aria-busy");
    button.disabled = false;
    button.textContent = "Simulate call";
  }
});

window.addEventListener("hashchange", applyAdminHashRoute);
window.addEventListener("popstate", applyAdminHashRoute);
$("#adminUserDialog").addEventListener("close", (event) => restoreAdminDetailRoute(event.currentTarget));
$("#dropWindowDialog").addEventListener("close", (event) => restoreAdminDetailRoute(event.currentTarget));

try {
  applyAdminHashRoute();
  await refresh();
} catch (error) {
  toast(error.message || "Yoink could not load.", true);
  $("#heroStatus").innerHTML = `<div class="empty">Control plane unavailable.</div>`;
}

scheduleAdminPoll();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void refreshFromLoopback().finally(scheduleAdminPoll);
  } else {
    scheduleAdminPoll();
  }
});
