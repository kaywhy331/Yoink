function popupRuntimeOrigin(value, profile) {
  const parsed = new URL(String(value || ""));
  const exact = !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash;
  const loopback = parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost")
    || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (!exact
    || (profile === "local" && (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1"))
    || (profile === "production" && (parsed.protocol !== "https:" || loopback))) {
    throw new Error("Yoink Companion has an invalid packaged runtime origin.");
  }
  return parsed.origin;
}

const POPUP_RUNTIME_CONFIG = (() => {
  const value = globalThis.YoinkRuntimeConfig;
  const profile = value?.profile === "production" ? "production" : value?.profile === "local" ? "local" : "";
  if (!profile || value?.localPackageUpdates !== (profile === "local")) {
    throw new Error("Yoink Companion has an invalid packaged runtime profile.");
  }
  return Object.freeze({
    profile,
    appOrigin: popupRuntimeOrigin(value.appOrigin, profile),
    localPackageUpdates: value.localPackageUpdates
  });
})();

const PopupState = globalThis.YoinkPopupStateModule;
if (!PopupState?.classifyPageContext || !PopupState?.derivePopupView) {
  throw new Error("Yoink Companion has no packaged popup state model.");
}

const PRODUCTION_PROFILE = POPUP_RUNTIME_CONFIG.profile === "production";
const INSTALLED_VERSION = chrome.runtime.getManifest().version;
const UPDATE_HANDOFF_KEY = PopupState.POPUP_UPDATE_HANDOFF_STORAGE_KEY;
const TRACKALACKER_ORIGINS = ["https://trackalacker.com/*", "https://www.trackalacker.com/*"];
const TRACKALACKER_SYNC_ORIGINS = [...new Set([
  ...TRACKALACKER_ORIGINS,
  ...Object.values(PopupState.RETAILER_ORIGINS).flat()
])];
const $ = (selector) => document.querySelector(selector);

const ui = {
  health: null,
  page: PopupState.classifyPageContext(""),
  pageAccessGranted: false,
  operation: null,
  result: null,
  updateHandoff: null,
  confirmation: null,
  notice: "",
  view: null,
  toastTimer: 0,
  openPanel: null,
  panelOpener: null
};

function cleanText(value, maximum = 360) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function errorMessage(error, fallback = "The request could not be completed.") {
  return PopupState.errorPopupResult("popup", error?.message || fallback).details || fallback;
}

function relativeCheck(value) {
  const time = new Date(String(value || "")).getTime();
  if (!Number.isFinite(time)) return "Not checked";
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1_000));
  if (seconds < 15) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function appUrl(view = "") {
  const url = new URL("/", POPUP_RUNTIME_CONFIG.appOrigin);
  if (view) url.hash = view;
  return url.href;
}

function openYoink(view = "") {
  return chrome.tabs.create({ url: appUrl(view), active: true });
}

function announce(message) {
  const element = $("#assertiveStatus");
  element.textContent = "";
  requestAnimationFrame(() => { element.textContent = cleanText(message); });
}

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = cleanText(message);
  toast.classList.toggle("error", error);
  toast.hidden = false;
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => { toast.hidden = true; }, 4_000);
}

function resultForView() {
  return ui.result?.schemaVersion === 1 ? ui.result : null;
}

function deriveView() {
  return PopupState.derivePopupView({
    health: ui.health,
    page: ui.page,
    installedVersion: INSTALLED_VERSION,
    production: PRODUCTION_PROFILE,
    pageAccessGranted: ui.pageAccessGranted,
    operation: ui.operation,
    lastResult: resultForView(),
    updateHandoff: ui.updateHandoff,
    confirmation: ui.confirmation,
    notice: ui.notice
  });
}

function replaceStatusDetails(details) {
  const fragment = document.createDocumentFragment();
  for (const detail of details) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = detail.label;
    value.textContent = detail.label === "Checked" ? relativeCheck(detail.value) : detail.value;
    row.append(term, value);
    fragment.append(row);
  }
  $("#statusDetails").replaceChildren(fragment);
}

function render() {
  const view = deriveView();
  ui.view = view;
  $("#statusLabel").textContent = view.statusLabel;
  $("#statusDot").className = `status-dot ${view.status}`;
  $("#statusButton").setAttribute("aria-label", `System status: ${view.statusLabel}`);
  replaceStatusDetails(view.details);

  $("#contextSurface").hidden = !view.context.visible;
  $("#contextEyebrow").textContent = view.context.eyebrow;
  $("#contextTitle").textContent = view.context.title;
  $("#contextSupporting").textContent = view.context.supporting;
  $("#contextSupporting").hidden = !view.context.supporting;
  $("#pairFields").hidden = !view.context.pairing;

  const primary = $("#primaryAction");
  primary.hidden = !view.primaryAction;
  primary.textContent = view.primaryAction?.label || "";
  primary.disabled = view.primaryAction?.disabled === true;
  primary.dataset.action = view.primaryAction?.id || "";
  primary.dataset.outcome = view.result?.outcome || "";
  const repeatLabel = view.primaryAction?.id === "inspect_drawings" ? "Inspect drawings again" : "Inspect product again";
  primary.setAttribute("aria-label", view.result && view.primaryAction
    ? `${view.primaryAction.label}. ${repeatLabel}.` : view.primaryAction?.label || "Primary action");
  primary.title = view.result && view.primaryAction ? repeatLabel : "";
  $("#cancelContext").hidden = ui.confirmation === null;

  const showResult = ui.confirmation === null && Boolean(view.result?.details);
  const detailsButton = $("#resultDetailsButton");
  detailsButton.hidden = !showResult;
  if (!showResult) {
    detailsButton.setAttribute("aria-expanded", "false");
    detailsButton.textContent = "View details";
    $("#resultDetails").hidden = true;
  }
  $("#resultDetails").textContent = showResult ? view.result.details : "";

  const activity = view.activity;
  const actionableActivity = activity && activity.action !== "none";
  $("#activityAction").hidden = !actionableActivity;
  $("#activityActionLabel").textContent = actionableActivity ? activity.label : "";
  $("#activityAction").dataset.action = actionableActivity ? activity.action : "";
  $("#activityStatus").hidden = !activity || actionableActivity;
  $("#activityStatus").textContent = activity && !actionableActivity ? activity.label : "";

  $("#syncProducts").hidden = !view.menu.syncProducts;
  $("#shareEvidence").hidden = !view.menu.shareEvidence;
  $("#manageStoreAccess").hidden = !view.menu.manageStoreAccess;
  $("#checkUpdate").hidden = !view.menu.checkUpdates;
  $("#syncProducts").disabled = activity?.id === "sync";
  $("#syncProducts").textContent = activity?.id === "sync" ? activity.label : "Sync products";
}

function setOperation(stage, contextKey = ui.page.key) {
  ui.operation = stage === "idle" ? null : { stage, contextKey };
  render();
}

async function persistResult(result) {
  ui.result = result;
  await chrome.storage.session.set({ [PopupState.POPUP_RESULT_STORAGE_KEY]: result });
}

async function pageAccess() {
  const retailerId = ui.page.kind === "product" || ui.page.kind === "walmart_draw"
    ? ui.page.retailerId : "";
  const origins = retailerId ? PopupState.RETAILER_ORIGINS[retailerId] : null;
  return Boolean(origins && await chrome.permissions.contains({ origins }).catch(() => false));
}

async function refreshHealth() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "yoink:check-health" });
    if (!response?.ok) throw new Error(response?.message || "Health check failed.");
    ui.health = response.state;
  } catch {
    ui.health = { connected: false, checkedAt: new Date().toISOString() };
  }
  ui.pageAccessGranted = await pageAccess();
  render();
}

function closePanels(restoreFocus = false) {
  if (!ui.openPanel) return;
  const opener = ui.panelOpener;
  $(ui.openPanel).hidden = true;
  $("#statusButton").setAttribute("aria-expanded", "false");
  $("#menuButton").setAttribute("aria-expanded", "false");
  ui.openPanel = null;
  ui.panelOpener = null;
  if (restoreFocus) opener?.focus();
}

function togglePanel(panelSelector, opener) {
  const opening = ui.openPanel !== panelSelector;
  closePanels(false);
  if (!opening) {
    opener.focus();
    return;
  }
  const panel = $(panelSelector);
  panel.hidden = false;
  opener.setAttribute("aria-expanded", "true");
  ui.openPanel = panelSelector;
  ui.panelOpener = opener;
  if (panelSelector === "#overflowPanel") {
    panel.querySelector('[role="menuitem"]:not([hidden]):not(:disabled)')?.focus();
  }
}

async function requestRetailerAccess() {
  if (ui.page.kind !== "product" && ui.page.kind !== "walmart_draw") {
    throw new Error("Open an exact supported retailer page first.");
  }
  if (ui.pageAccessGranted) return;
  const origins = PopupState.RETAILER_ORIGINS[ui.page.retailerId];
  setOperation("requesting_access");
  const granted = await chrome.permissions.request({ origins });
  if (!granted) {
    const error = new Error("Store access wasn’t approved.");
    error.blocked = true;
    throw error;
  }
  ui.pageAccessGranted = true;
}

async function inspectProduct() {
  try {
    await requestRetailerAccess();
    setOperation("inspecting");
    const response = await chrome.runtime.sendMessage({ type: "yoink:inspect-and-qualify" });
    if (!response?.ok) throw new Error(response?.message || "Product inspection failed.");
    if (response.state) ui.health = response.state;
    await persistResult(response.popupResult || PopupState.qualificationPopupResult(response, ui.page));
    ui.notice = "";
    announce(ui.result.summary);
  } catch (error) {
    await persistResult(PopupState.errorPopupResult(ui.page.key, error, error?.blocked === true));
    announce(ui.result.summary);
  } finally {
    setOperation("idle");
  }
}

async function inspectDrawings() {
  try {
    await requestRetailerAccess();
    setOperation("inspecting");
    const response = await chrome.runtime.sendMessage({ type: "yoink:inspect-walmart-draw" });
    if (!response?.ok) throw new Error(response?.message || "Drawing inspection failed.");
    if (response.state) ui.health = response.state;
    await persistResult(response.popupResult || PopupState.drawingsPopupResult(response, ui.page));
    ui.notice = "";
    announce(ui.result.summary);
  } catch (error) {
    await persistResult(PopupState.errorPopupResult(ui.page.key, error, error?.blocked === true));
    announce(ui.result.summary);
  } finally {
    setOperation("idle");
  }
}

async function pairBrowser() {
  const code = $("#pairCode").value.trim();
  if (!code) {
    showToast("Enter the one-time pairing code.", true);
    $("#pairCode").focus();
    return;
  }
  setOperation("pairing");
  try {
    const response = await chrome.runtime.sendMessage({ type: "yoink:pair-device", code });
    if (!response?.ok) throw new Error(response?.message || "Pairing failed.");
    ui.health = response.state;
    $("#pairCode").value = "";
    announce("Browser paired.");
  } catch (error) {
    showToast(errorMessage(error, "The browser could not be paired."), true);
  } finally {
    setOperation("idle");
  }
}

async function reconnectTrackalacker() {
  setOperation("reconnecting");
  try {
    const granted = await chrome.permissions.request({ origins: TRACKALACKER_ORIGINS });
    if (!granted) throw new Error("TrackaLacker access wasn’t approved.");
    const response = await chrome.runtime.sendMessage({ type: "yoink:connect-trackalacker" });
    if (!response?.ok) throw new Error(response?.message || "TrackaLacker could not reconnect.");
    ui.health = response.state;
    showToast("TrackaLacker connected.");
    announce("TrackaLacker connected.");
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    setOperation("idle");
  }
}

async function updateCompanion() {
  setOperation("updating");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "yoink:check-update",
      download: !PRODUCTION_PROFILE,
      requestManaged: PRODUCTION_PROFILE
    });
    if (!response?.ok || !response.update) throw new Error(response?.message || "Update check failed.");
    const update = response.update;
    if (update.handoff) {
      ui.updateHandoff = update.handoff;
      await chrome.storage.session.set({ [UPDATE_HANDOFF_KEY]: update.handoff });
      render();
      announce(update.handoff.channel === "managed" ? "Companion update ready." : "Companion update downloaded.");
    } else if (update.downloadStarted) {
      showToast("Update downloaded. Reopen Yoink Companion to finish.");
    } else if (update.managedByBrowser) {
      showToast(update.managedStatus === "throttled"
        ? "Chrome will check again automatically."
        : "Chrome found no companion update yet.");
    } else if (update.updateAvailable && !update.packageReady) {
      showToast("The companion update package is still being prepared.", true);
    } else if (update.updateAvailable) {
      showToast("A companion update is available. Retry the download.", true);
    } else {
      showToast("The companion is current.");
    }
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    setOperation("idle");
  }
}

async function reloadCompanion() {
  await chrome.storage.session.remove(UPDATE_HANDOFF_KEY).catch(() => undefined);
  announce("Reloading companion.");
  chrome.runtime.reload();
}

async function syncProducts() {
  closePanels(false);
  const button = $("#syncProducts");
  button.disabled = true;
  showToast("Starting product sync…");
  try {
    const granted = await chrome.permissions.request({ origins: TRACKALACKER_SYNC_ORIGINS });
    if (!granted) throw new Error("TrackaLacker and store access wasn’t approved.");
    const response = await chrome.runtime.sendMessage({ type: "yoink:sync-trackalacker" });
    if (!response?.ok) throw new Error(response?.message || "Product sync could not start.");
    showToast(response.alreadyRunning ? "Product sync is already running." : "Product sync started.");
    await refreshHealth();
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    button.disabled = false;
  }
}

async function shareEvidence() {
  if (ui.page.kind !== "product") return;
  try {
    await requestRetailerAccess();
    setOperation("sharing");
    const response = await chrome.runtime.sendMessage({ type: "yoink:contribute-retailer" });
    if (!response?.ok) throw new Error(response?.message || "Evidence could not be shared.");
    if (response.state) ui.health = response.state;
    ui.confirmation = null;
    ui.notice = response.receipt?.disposition === "quarantined" ? "Evidence held for review"
      : response.receipt?.disposition === "deduped" ? "Evidence already recorded" : "Evidence shared";
    showToast(ui.notice);
    announce(ui.notice);
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    setOperation("idle");
  }
}

async function handlePrimaryAction() {
  const action = ui.view?.primaryAction?.id;
  if (!action || ui.view.primaryAction.disabled) return;
  if (action === "retry") return refreshHealth();
  if (action === "pair") return pairBrowser();
  if (action === "update_companion") return updateCompanion();
  if (action === "reload_companion") return reloadCompanion();
  if (action === "open_yoink") return openYoink();
  if (action === "inspect_product") return inspectProduct();
  if (action === "inspect_drawings") return inspectDrawings();
  if (action === "reconnect_trackalacker") return reconnectTrackalacker();
  if (action === "review_pause" || action === "review_mode") return openYoink("settings");
  if (action === "confirm_share_evidence") return shareEvidence();
}

function cancelContext() {
  ui.confirmation = null;
  ui.notice = "";
  render();
  $("#menuButton").focus();
}

function menuItems() {
  return [...$("#overflowPanel").querySelectorAll('[role="menuitem"]')]
    .filter((element) => !element.hidden && !element.disabled);
}

function handleMenuKeys(event) {
  const items = menuItems();
  if (!items.length) return;
  const current = items.indexOf(document.activeElement);
  let next = current;
  if (event.key === "ArrowDown") next = (current + 1 + items.length) % items.length;
  else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else return;
  event.preventDefault();
  items[next]?.focus();
}

function bindEvents() {
  $("#statusButton").addEventListener("click", (event) => togglePanel("#statusPanel", event.currentTarget));
  $("#menuButton").addEventListener("click", (event) => togglePanel("#overflowPanel", event.currentTarget));
  $("#overflowPanel").addEventListener("keydown", handleMenuKeys);
  $("#primaryAction").addEventListener("click", () => { void handlePrimaryAction(); });
  $("#cancelContext").addEventListener("click", cancelContext);
  $("#openYoink").addEventListener("click", () => { void openYoink(); });
  $("#statusDiagnostics").addEventListener("click", () => { void openYoink("operations"); });
  $("#diagnostics").addEventListener("click", () => { void openYoink("operations"); });
  $("#settings").addEventListener("click", () => { void openYoink("settings"); });
  $("#manageStoreAccess").addEventListener("click", () => { void openYoink("connections"); });
  $("#syncProducts").addEventListener("click", () => { void syncProducts(); });
  $("#checkUpdate").addEventListener("click", () => { closePanels(false); void updateCompanion(); });
  $("#shareEvidence").addEventListener("click", () => {
    closePanels(false);
    ui.confirmation = "share_evidence";
    ui.notice = "";
    render();
    $("#primaryAction").focus();
  });
  $("#activityAction").addEventListener("click", () => {
    const action = ui.view?.activity?.action;
    if (action === "reconnect_trackalacker") void reconnectTrackalacker();
    if (action === "review_pause" || action === "review_mode") void openYoink("settings");
  });
  $("#resultDetailsButton").addEventListener("click", (event) => {
    const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
    event.currentTarget.setAttribute("aria-expanded", String(!expanded));
    event.currentTarget.textContent = expanded ? "View details" : "Hide details";
    $("#resultDetails").hidden = expanded;
  });
  $("#pairCode").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); void pairBrowser(); }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (ui.openPanel) { event.preventDefault(); closePanels(true); return; }
    if ($("#resultDetailsButton").getAttribute("aria-expanded") === "true") {
      event.preventDefault();
      $("#resultDetailsButton").click();
      $("#resultDetailsButton").focus();
      return;
    }
    if (ui.confirmation) { event.preventDefault(); cancelContext(); }
  });
  document.addEventListener("click", (event) => {
    if (!ui.openPanel) return;
    const panel = $(ui.openPanel);
    if (!panel.contains(event.target) && !ui.panelOpener?.contains(event.target)) closePanels(false);
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "yoink:popup-progress" || message.contextKey !== ui.page.key) return false;
    if (["inspecting", "qualifying"].includes(message.stage)) setOperation(message.stage, message.contextKey);
    return false;
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.readiness?.newValue) {
      ui.health = changes.readiness.newValue;
      render();
    }
    if (areaName === "session" && changes[PopupState.POPUP_RESULT_STORAGE_KEY]?.newValue) {
      ui.result = changes[PopupState.POPUP_RESULT_STORAGE_KEY].newValue;
      render();
    }
    if (areaName === "session" && changes[UPDATE_HANDOFF_KEY]) {
      ui.updateHandoff = changes[UPDATE_HANDOFF_KEY].newValue || null;
      render();
    }
  });
}

async function initializePopup() {
  bindEvents();
  const [tabs, storedHealth, storedResult, storedUpdateHandoff] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.local.get("readiness"),
    chrome.storage.session.get(PopupState.POPUP_RESULT_STORAGE_KEY),
    chrome.storage.session.get(UPDATE_HANDOFF_KEY)
  ]);
  ui.page = PopupState.classifyPageContext(tabs[0]?.url);
  ui.health = storedHealth.readiness || null;
  ui.result = storedResult[PopupState.POPUP_RESULT_STORAGE_KEY] || null;
  ui.updateHandoff = storedUpdateHandoff[UPDATE_HANDOFF_KEY] || null;
  ui.pageAccessGranted = await pageAccess();
  render();
  void refreshHealth();
}

globalThis.YoinkPopupController = Object.freeze({
  render,
  deriveView,
  state: ui,
  closePanels
});

void initializePopup();
