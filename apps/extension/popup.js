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
if (!PopupState?.classifyPageContext || !PopupState?.derivePopupView || !PopupState?.appDestinationUrl) {
  throw new Error("Yoink Companion has no packaged popup state model.");
}

const PRODUCTION_PROFILE = POPUP_RUNTIME_CONFIG.profile === "production";
const INSTALLED_VERSION = chrome.runtime.getManifest().version;
const UPDATE_HANDOFF_KEY = PopupState.POPUP_UPDATE_HANDOFF_STORAGE_KEY;
const CART_READY_SOUND_KEY = "yoinkCartReadySoundEnabledV1";
const CART_OUTCOME_DRAFT_KEY = "yoinkCartOutcomeDraftV1";
const NOTIFICATION_ROUTES_KEY = "yoinkNotificationRoutesV1";
const TRACKALACKER_ORIGINS = ["https://trackalacker.com/*", "https://www.trackalacker.com/*"];
const TRACKALACKER_SYNC_ORIGINS = TRACKALACKER_ORIGINS;
const $ = (selector) => document.querySelector(selector);

const ui = {
  health: null,
  page: PopupState.classifyPageContext(""),
  pageAccessGranted: false,
  operation: null,
  result: null,
  updateHandoff: null,
  cartReady: null,
  cartOutcome: null,
  cartOutcomeDraft: null,
  purchaseOpportunity: null,
  cartReadySoundEnabled: false,
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

function sanitizedCartOutcomeDraft(value, now = Date.now()) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const jobId = cleanText(candidate.jobId, 120);
  const amount = cleanText(candidate.amount, 32);
  const recordedAt = new Date(String(candidate.recordedAt || "")).getTime();
  if (candidate.schemaVersion !== 1
    || !/^[A-Za-z0-9_-]{3,120}$/.test(jobId)
    || !Number.isFinite(recordedAt)
    || recordedAt > now + 60_000
    || now - recordedAt >= 24 * 60 * 60_000) return null;
  return { schemaVersion: 1, jobId, amount, recordedAt: new Date(recordedAt).toISOString() };
}

async function persistCartOutcomeDraft(jobId, amount) {
  const draft = sanitizedCartOutcomeDraft({
    schemaVersion: 1,
    jobId,
    amount,
    recordedAt: new Date().toISOString()
  });
  if (!draft) return;
  ui.cartOutcomeDraft = draft;
  await chrome.storage.session.set({ [CART_OUTCOME_DRAFT_KEY]: draft });
}

async function clearCartOutcomeDraft() {
  ui.cartOutcomeDraft = null;
  await chrome.storage.session.remove(CART_OUTCOME_DRAFT_KEY).catch(() => undefined);
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

function appUrl(destination = "dashboard") {
  return PopupState.appDestinationUrl(POPUP_RUNTIME_CONFIG.appOrigin, destination);
}

function openYoink(destination = "dashboard") {
  return chrome.tabs.create({ url: appUrl(destination), active: true });
}

function openExtensionSettings() {
  return chrome.tabs.create({ url: chrome.runtime.getURL("options.html"), active: true });
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
    cartReady: ui.cartReady,
    cartOutcome: ui.cartOutcome,
    purchaseOpportunity: ui.purchaseOpportunity,
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
  $("#contextResultStatus").textContent = view.resultStatus?.label || "";
  $("#contextResultStatus").dataset.tone = view.resultStatus?.tone || "";
  $("#contextResultStatus").hidden = !view.resultStatus;
  $("#pairFields").hidden = !view.context.pairing;

  const primary = $("#primaryAction");
  const cartOutcomeOwnsPrimary = ["amount", "submitting"].includes(view.cartOutcome?.stage);
  primary.hidden = !view.primaryAction || cartOutcomeOwnsPrimary;
  primary.textContent = view.primaryAction?.label || "";
  primary.disabled = view.primaryAction?.disabled === true;
  primary.dataset.action = view.primaryAction?.id || "";
  primary.setAttribute("aria-label", view.primaryAction?.label || "Primary action");
  primary.title = "";
  $("#cancelContext").hidden = ui.confirmation === null;

  const cartOutcome = view.cartOutcome;
  const cartOutcomePanel = $("#cartOutcome");
  const amountStage = ["amount", "submitting"].includes(cartOutcome?.stage);
  cartOutcomePanel.hidden = !cartOutcome;
  $("#cartOutcomeChoices").hidden = !cartOutcome || amountStage;
  $("#cartOutcomeForm").hidden = !cartOutcome || !amountStage;
  const cartOutcomeAmount = $("#cartOutcomeAmount");
  if (cartOutcome && amountStage && cartOutcomeAmount.dataset.jobId !== cartOutcome.jobId) {
    cartOutcomeAmount.dataset.jobId = cartOutcome.jobId;
    cartOutcomeAmount.value = ui.cartOutcomeDraft?.jobId === cartOutcome.jobId
      ? ui.cartOutcomeDraft.amount
      : Number.isSafeInteger(cartOutcome.reviewedMaximumCents)
        ? (cartOutcome.reviewedMaximumCents / 100).toFixed(2) : "";
  }
  const reviewedMaximum = Number.isSafeInteger(cartOutcome?.reviewedMaximumCents)
    ? `$${(cartOutcome.reviewedMaximumCents / 100).toFixed(2)}` : "";
  $("#cartOutcomeLimit").textContent = reviewedMaximum
    ? `Reviewed maximum: ${reviewedMaximum}`
    : "Enter the exact amount charged.";
  const submittingOutcome = cartOutcome?.stage === "submitting";
  $("#cartOutcomeGotIt").disabled = submittingOutcome;
  $("#cartOutcomeMissedIt").disabled = submittingOutcome;
  $("#cartOutcomeConfirm").disabled = submittingOutcome;
  $("#cartOutcomeBack").disabled = submittingOutcome;
  $("#cartOutcomeConfirm").textContent = submittingOutcome ? "Recording…" : "Record purchase";
  $("#cartOutcomeError").textContent = cartOutcome?.error || "";
  $("#cartOutcomeError").hidden = !cartOutcome?.error;

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
  $("#saveRepairPage").hidden = !view.menu.saveRepairPage;
  $("#checkUpdate").hidden = !view.menu.checkUpdates;
  $("#cartReadySound").setAttribute("aria-checked", String(ui.cartReadySoundEnabled));
  $("#cartReadySound").querySelector(".menu-check").textContent = ui.cartReadySoundEnabled ? "On" : "Off";
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
    panel.querySelector('[role^="menuitem"]:not([hidden]):not(:disabled)')?.focus();
  }
}

async function requestRetailerAccess() {
  if (ui.page.kind !== "product" && ui.page.kind !== "walmart_draw") {
    throw new Error("Open a supported store product page first.");
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
      announce(update.handoff.channel === "managed" ? "Chrome companion update ready." : "Chrome companion update downloaded.");
    } else if (update.downloadStarted) {
      showToast("Update downloaded. Reopen the Chrome companion to finish.");
    } else if (update.managedByBrowser) {
      showToast(update.managedStatus === "throttled"
        ? "Chrome will check again automatically."
        : "No Chrome companion update yet.");
    } else if (update.updateAvailable && !update.packageReady) {
      showToast("The Chrome companion update is still being prepared.", true);
    } else if (update.updateAvailable) {
      showToast("A Chrome companion update is available. Retry the download.", true);
    } else {
      showToast("The Chrome companion is current.");
    }
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    setOperation("idle");
  }
}

async function reloadCompanion() {
  await chrome.storage.session.remove(UPDATE_HANDOFF_KEY).catch(() => undefined);
  announce("Reloading the Chrome companion.");
  chrome.runtime.reload();
}

async function openCartReady() {
  const item = ui.view?.cartReady;
  if (!item?.jobId) return;
  setOperation("opening_cart");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "yoink:open-cart-ready",
      jobId: item.jobId
    });
    if (!response?.ok || response.opened !== true) throw new Error(response?.message || "The cart tab could not be opened.");
    ui.cartReady = PopupState.cartReadyState(response.cartReady);
    if (response.pending !== true) {
      ui.cartOutcome = { jobId: item.jobId, stage: "choice", error: "" };
    }
    announce(response.pending === true
      ? `${item.retailerName} is finishing another cart check.`
      : item.kind === "needs_you"
        ? `${item.retailerName} opened for review.`
        : `${item.retailerName} cart opened.`);
  } catch (error) {
    showToast(errorMessage(error, "The cart tab could not be opened."), true);
  } finally {
    setOperation("idle");
  }
}

function amountCents(value) {
  const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/.exec(String(value || "").trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number(String(match[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000 ? cents : null;
}

async function reportCartOutcome(outcome, actualTotalCents = null) {
  const current = ui.view?.cartOutcome;
  if (!current?.jobId || !["got_it", "missed_it"].includes(outcome)) return;
  const returnStage = outcome === "got_it" ? "amount" : "choice";
  ui.cartOutcome = { jobId: current.jobId, stage: "submitting", error: "" };
  render();
  try {
    const response = await chrome.runtime.sendMessage({
      type: "yoink:report-cart-outcome",
      jobId: current.jobId,
      outcome,
      actualTotalCents,
      confirmation: "I_REVIEWED_CHECKOUT_RESULT"
    });
    if (!response?.ok) throw new Error(response?.message || "The checkout result could not be recorded.");
    ui.cartReady = PopupState.cartReadyState(response.cartReady);
    ui.cartOutcome = null;
    await clearCartOutcomeDraft();
    const message = outcome === "got_it" ? "Purchase recorded." : "Cart action closed as Missed it.";
    showToast(message);
    announce(message);
  } catch (error) {
    ui.cartOutcome = {
      jobId: current.jobId,
      stage: returnStage,
      error: errorMessage(error, "The checkout result could not be recorded.")
    };
  }
  render();
}

async function refreshPurchaseOpportunity({ rerender = true } = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "yoink:get-purchase-opportunity" });
    ui.purchaseOpportunity = response?.ok ? response.opportunity || null : null;
  } catch {
    ui.purchaseOpportunity = null;
  }
  if (rerender) render();
  return ui.purchaseOpportunity;
}

async function openPurchaseOpportunity() {
  const opportunity = ui.view?.purchaseOpportunity;
  if (!opportunity?.deliveryId) return;
  const pageActionOwnsPrimary = ui.page.kind === "product" || ui.page.kind === "walmart_draw";
  setOperation("opening_cart", pageActionOwnsPrimary ? "purchase-opportunity" : ui.page.key);
  const activityButton = $("#activityAction");
  if (pageActionOwnsPrimary) activityButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "yoink:open-purchase-opportunity",
      deliveryId: opportunity.deliveryId
    });
    if (!response?.ok || response.opened !== true) {
      throw new Error(response?.message || "The Walmart cart link could not be opened.");
    }
    ui.purchaseOpportunity = response.opportunity || null;
    announce("Walmart opened. Review the cart before checkout.");
  } catch (error) {
    await refreshPurchaseOpportunity({ rerender: false });
    showToast(errorMessage(error, "The Walmart cart link could not be opened."), true);
  } finally {
    activityButton.disabled = false;
    setOperation("idle");
  }
}

async function syncProducts() {
  closePanels(false);
  const button = $("#syncProducts");
  button.disabled = true;
  showToast("Starting product sync…");
  try {
    const granted = await chrome.permissions.request({ origins: TRACKALACKER_SYNC_ORIGINS });
    if (!granted) throw new Error("TrackaLacker access wasn’t approved.");
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

async function saveRepairPage() {
  if (ui.page.kind !== "product") return;
  closePanels(false);
  try {
    await requestRetailerAccess();
    setOperation("saving");
    const response = await chrome.runtime.sendMessage({ type: "yoink:save-repair-page" });
    if (!response?.ok) throw new Error(response?.message || "Could not save this page. Open the product page and try again.");
    if (response.state) ui.health = response.state;
    ui.notice = "Saved on this computer";
    showToast(ui.notice);
    announce(ui.notice);
  } catch (error) {
    showToast(errorMessage(error, "Could not save this page. Open the product page and try again."), true);
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
  if (action === "open_cart") return openCartReady();
  if (action === "open_purchase") return openPurchaseOpportunity();
  if (action === "open_yoink") return openYoink();
  if (action === "inspect_product") return inspectProduct();
  if (action === "inspect_drawings") return inspectDrawings();
  if (action === "reconnect_trackalacker") return reconnectTrackalacker();
  if (action === "review_pause") return openYoink("dashboard");
  if (action === "review_mode") return openYoink("insights");
  if (action === "confirm_share_evidence") return shareEvidence();
}

function cancelContext() {
  ui.confirmation = null;
  ui.notice = "";
  render();
  $("#menuButton").focus();
}

function menuItems() {
  return [...$("#overflowPanel").querySelectorAll('[role^="menuitem"]')]
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
  $("#cartOutcomeGotIt").addEventListener("click", () => {
    const jobId = ui.view?.cartOutcome?.jobId;
    if (!jobId) return;
    ui.cartOutcome = { jobId, stage: "amount", error: "" };
    render();
    void persistCartOutcomeDraft(jobId, $("#cartOutcomeAmount").value);
    $("#cartOutcomeAmount").focus();
    $("#cartOutcomeAmount").select();
  });
  $("#cartOutcomeMissedIt").addEventListener("click", () => { void reportCartOutcome("missed_it"); });
  $("#cartOutcomeBack").addEventListener("click", () => {
    const jobId = ui.view?.cartOutcome?.jobId;
    if (!jobId) return;
    ui.cartOutcome = { jobId, stage: "choice", error: "" };
    $("#cartOutcomeAmount").dataset.jobId = "";
    $("#cartOutcomeAmount").value = "";
    void clearCartOutcomeDraft();
    render();
    $("#cartOutcomeGotIt").focus();
  });
  $("#cartOutcomeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const cents = amountCents($("#cartOutcomeAmount").value);
    if (cents === null) {
      const jobId = ui.view?.cartOutcome?.jobId;
      if (!jobId) return;
      ui.cartOutcome = { jobId, stage: "amount", error: "Enter a valid amount charged." };
      render();
      $("#cartOutcomeAmount").focus();
      return;
    }
    void reportCartOutcome("got_it", cents);
  });
  $("#cartOutcomeAmount").addEventListener("input", (event) => {
    const jobId = ui.view?.cartOutcome?.jobId;
    if (jobId) void persistCartOutcomeDraft(jobId, event.currentTarget.value);
  });
  $("#cancelContext").addEventListener("click", cancelContext);
  $("#openYoink").addEventListener("click", () => { void openYoink(); });
  $("#statusConnections").addEventListener("click", () => { void openYoink("connections"); });
  $("#extensionSettings").addEventListener("click", () => { void openExtensionSettings(); });
  $("#syncProducts").addEventListener("click", () => { void syncProducts(); });
  $("#checkUpdate").addEventListener("click", () => { closePanels(false); void updateCompanion(); });
  $("#cartReadySound").addEventListener("click", async () => {
    ui.cartReadySoundEnabled = !ui.cartReadySoundEnabled;
    await chrome.storage.local.set({ [CART_READY_SOUND_KEY]: ui.cartReadySoundEnabled });
    render();
    showToast(ui.cartReadySoundEnabled ? "Action handoff sound on" : "Action handoff sound off");
  });
  $("#shareEvidence").addEventListener("click", () => {
    closePanels(false);
    ui.confirmation = "share_evidence";
    ui.notice = "";
    render();
    $("#primaryAction").focus();
  });
  $("#saveRepairPage").addEventListener("click", () => { void saveRepairPage(); });
  $("#activityAction").addEventListener("click", () => {
    const action = ui.view?.activity?.action;
    if (action === "open_purchase") void openPurchaseOpportunity();
    if (action === "reconnect_trackalacker") void reconnectTrackalacker();
    if (action === "review_pause") void openYoink("dashboard");
    if (action === "review_mode") void openYoink("insights");
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
    if (["amount", "submitting"].includes(ui.view?.cartOutcome?.stage)) {
      if (ui.view?.cartOutcome?.stage === "submitting") return;
      event.preventDefault();
      ui.cartOutcome = { jobId: ui.view.cartOutcome.jobId, stage: "choice", error: "" };
      render();
      $("#cartOutcomeGotIt").focus();
      return;
    }
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
    if (areaName === "local" && changes[CART_READY_SOUND_KEY]) {
      ui.cartReadySoundEnabled = changes[CART_READY_SOUND_KEY].newValue === true;
      render();
    }
    if (areaName === "local" && changes[NOTIFICATION_ROUTES_KEY]) {
      void refreshPurchaseOpportunity();
    }
    if (areaName === "session" && changes[PopupState.POPUP_RESULT_STORAGE_KEY]?.newValue) {
      ui.result = changes[PopupState.POPUP_RESULT_STORAGE_KEY].newValue;
      render();
    }
    if (areaName === "session" && changes[UPDATE_HANDOFF_KEY]) {
      ui.updateHandoff = changes[UPDATE_HANDOFF_KEY].newValue || null;
      render();
    }
    if (areaName === "session" && changes[PopupState.CART_READY_STORAGE_KEY]) {
      ui.cartReady = PopupState.cartReadyState(changes[PopupState.CART_READY_STORAGE_KEY].newValue);
      if (ui.cartOutcome && !ui.cartReady.items.some((item) => item.jobId === ui.cartOutcome.jobId)) {
        ui.cartOutcome = null;
        void clearCartOutcomeDraft();
      }
      render();
    }
  });
}

async function initializePopup() {
  bindEvents();
  const [tabs, storedLocal, storedResult, storedUpdateHandoff, storedCartReady, storedCartOutcomeDraft, purchaseOpportunity] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.local.get(["readiness", CART_READY_SOUND_KEY]),
    chrome.storage.session.get(PopupState.POPUP_RESULT_STORAGE_KEY),
    chrome.storage.session.get(UPDATE_HANDOFF_KEY),
    chrome.storage.session.get(PopupState.CART_READY_STORAGE_KEY),
    chrome.storage.session.get(CART_OUTCOME_DRAFT_KEY),
    chrome.runtime.sendMessage({ type: "yoink:get-purchase-opportunity" }).catch(() => null)
  ]);
  ui.page = PopupState.classifyPageContext(tabs[0]?.url);
  ui.health = storedLocal.readiness || null;
  ui.cartReadySoundEnabled = storedLocal[CART_READY_SOUND_KEY] === true;
  ui.result = storedResult[PopupState.POPUP_RESULT_STORAGE_KEY] || null;
  ui.updateHandoff = storedUpdateHandoff[UPDATE_HANDOFF_KEY] || null;
  ui.cartReady = PopupState.cartReadyState(storedCartReady[PopupState.CART_READY_STORAGE_KEY]);
  ui.cartOutcomeDraft = sanitizedCartOutcomeDraft(storedCartOutcomeDraft[CART_OUTCOME_DRAFT_KEY]);
  if (ui.cartOutcomeDraft && ui.cartReady.items.some((item) => item.jobId === ui.cartOutcomeDraft.jobId && item.openedAt)) {
    ui.cartOutcome = { jobId: ui.cartOutcomeDraft.jobId, stage: "amount", error: "" };
  } else if (ui.cartOutcomeDraft) {
    await clearCartOutcomeDraft();
  }
  ui.purchaseOpportunity = purchaseOpportunity?.ok ? purchaseOpportunity.opportunity || null : null;
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
