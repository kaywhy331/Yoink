const PopupState = globalThis.YoinkPopupStateModule;
const runtime = globalThis.YoinkRuntimeConfig;
if (!PopupState?.RETAILER_ORIGINS || !PopupState?.appDestinationUrl || !runtime?.appOrigin) {
  throw new Error("Yoink Companion settings are unavailable.");
}

const RETAILER_NAMES = {
  target: "Target", walmart: "Walmart", amazon: "Amazon", bestbuy: "Best Buy",
  disney: "Disney Store", ravensburger: "Ravensburger", riot: "Riot Games Merch",
  booksamillion: "Books-A-Million", fanatics: "Fanatics", kohls: "Kohl's",
  macys: "Macy's", pbandai: "Premium Bandai", pokemoncenter: "Pokémon Center"
};
const $ = (selector) => document.querySelector(selector);

async function renderHealth() {
  const response = await chrome.runtime.sendMessage({ type: "yoink:check-health" }).catch(() => null);
  const paired = response?.state?.paired === true;
  $("#pairState").textContent = paired
    ? response.state.connected ? "Paired · Ready" : "Paired · Yoink unavailable"
    : "Not paired";
  // An unpaired profile is sent straight to the pairing page in a new tab so
  // this settings tab stays open while the code is entered.
  const openYoink = $("#openYoink");
  openYoink.href = PopupState.appDestinationUrl(runtime.appOrigin, paired ? "dashboard" : "connections");
  openYoink.textContent = paired ? "Open Yoink" : "Open Yoink › Settings › Chrome";
}

async function permissionRow(retailerId, origins) {
  const row = document.createElement("div");
  row.className = "permission-row";
  const label = document.createElement("strong");
  label.textContent = RETAILER_NAMES[retailerId] || retailerId;
  const controls = document.createElement("div");
  const state = document.createElement("span");
  const button = document.createElement("button");
  button.className = "button";
  button.type = "button";
  const render = async () => {
    const granted = await chrome.permissions.contains({ origins });
    state.textContent = granted ? "Allowed" : "Not allowed";
    button.textContent = granted ? "Remove" : "Allow";
    button.dataset.granted = String(granted);
  };
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (button.dataset.granted === "true") {
        await chrome.permissions.remove({ origins });
      } else {
        await chrome.permissions.request({ origins });
      }
      await render();
    } finally {
      button.disabled = false;
    }
  });
  controls.append(state, document.createTextNode(" "), button);
  row.append(label, controls);
  await render();
  return row;
}

async function renderPermissions() {
  const rows = await Promise.all(Object.entries(PopupState.RETAILER_ORIGINS)
    .map(([retailerId, origins]) => permissionRow(retailerId, origins)));
  $("#permissionList").replaceChildren(...rows);
}

function laneStatus(lane) {
  if (!lane.candidate) return "Needs a prior passing product";
  const warning = String(lane.qualification?.warning || "none");
  if (warning === "version_changed") return "Version changed";
  if (warning === "expired") return "Expired";
  if (warning === "expiring") return "Expiring soon";
  return lane.qualification?.status === "qualified" ? "Ready" : "Ready to check";
}

function resultReason(value) {
  return String(value || "check_stopped").replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

async function reverifyStore(lane, button, status) {
  const retailerId = lane.retailerId;
  const storeName = RETAILER_NAMES[retailerId] || retailerId;
  const origins = PopupState.RETAILER_ORIGINS[retailerId] || [];
  if (!lane.candidate || !origins.length) return;
  button.disabled = true;
  status.textContent = "Checking access…";
  try {
    const alreadyGranted = await chrome.permissions.contains({ origins });
    const granted = alreadyGranted || await chrome.permissions.request({ origins });
    if (!granted) throw new Error(`${storeName} access wasn’t approved. No check ran.`);
    status.textContent = "Checking without adding…";
    const response = await chrome.runtime.sendMessage({
      type: "yoink:reverify-retailer-lanes",
      retailerIds: [retailerId]
    });
    if (!response?.ok || !Array.isArray(response.results)) {
      throw new Error(response?.message || `${storeName} could not be checked.`);
    }
    const result = response.results.find((item) => item.retailerId === retailerId);
    if (!result) throw new Error(`${storeName} did not return a check result.`);
    status.textContent = result.outcome === "passed"
      ? "Passed · no click"
      : `Stopped · ${resultReason(result.reasonCode || result.outcome)}`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : `${storeName} could not be checked.`;
  } finally {
    button.disabled = false;
  }
}

async function renderReverificationPlan() {
  const retry = $("#laneReadinessRetry");
  retry.hidden = true;
  $("#laneReadinessState").textContent = "Checking…";
  const response = await chrome.runtime.sendMessage({ type: "yoink:get-reverification-plan" }).catch(() => null);
  if (!response?.ok || !Array.isArray(response.plan?.lanes)) {
    $("#laneReadinessState").textContent = "Unavailable";
    $("#laneReadinessList").replaceChildren();
    retry.hidden = false;
    return;
  }
  const rows = response.plan.lanes.map((lane) => {
    const row = document.createElement("div");
    row.className = "lane-readiness-row";
    row.dataset.reverifyRetailer = lane.retailerId;
    const identity = document.createElement("span");
    const name = document.createElement("strong");
    const storeName = RETAILER_NAMES[lane.retailerId] || lane.retailerId;
    name.textContent = storeName;
    const detail = document.createElement("small");
    detail.textContent = lane.candidate
      ? `Check ${storeName} again without adding to cart. Prior product ${lane.candidate.retailerSku}.`
      : `Add a passing ${storeName} product before checking again.`;
    identity.append(name, detail);
    const status = document.createElement("span");
    status.className = "lane-status";
    status.dataset.laneStatus = lane.retailerId;
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = laneStatus(lane);
    const button = document.createElement("button");
    button.className = "button";
    button.type = "button";
    button.textContent = "Check again";
    button.disabled = !lane.candidate;
    if (!lane.candidate) button.title = "A prior passing product is needed.";
    button.addEventListener("click", () => reverifyStore(lane, button, status));
    row.append(identity, status, button);
    return row;
  });
  $("#laneReadinessList").replaceChildren(...rows);
  const available = response.plan.lanes.filter((lane) => lane.candidate);
  $("#laneReadinessState").textContent = `${available.length} of ${response.plan.lanes.length} ready`;
}

$("#openYoink").href = PopupState.appDestinationUrl(runtime.appOrigin, "dashboard");
$("#laneReadinessRetry").addEventListener("click", () => { void renderReverificationPlan(); });

// Deleting local data is a two-step inline confirmation instead of a native
// confirm() dialog: the first click arms the button, the second click deletes.
const deleteButton = $("#deleteLocalData");
const cancelDeleteButton = $("#cancelDeleteLocalData");
const DELETE_LABEL = "Delete local extension data";

function disarmDelete() {
  deleteButton.dataset.armed = "false";
  deleteButton.textContent = DELETE_LABEL;
  cancelDeleteButton.hidden = true;
}

function armDelete() {
  deleteButton.dataset.armed = "true";
  deleteButton.textContent = "Confirm delete";
  cancelDeleteButton.hidden = false;
  $("#deletionResult").textContent = "This removes pairing credentials, cached evidence, handoffs, queues, and settings stored in this Chrome profile. Your Yoink account data stays.";
}

async function deleteLocalData() {
  deleteButton.disabled = true;
  cancelDeleteButton.disabled = true;
  $("#deletionResult").textContent = "Deleting local extension data…";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "yoink:delete-local-data",
      confirmation: "DELETE_ALL_LOCAL_YOINK_DATA"
    });
    if (!response?.ok || response.deleted !== true) throw new Error(response?.message || "Local data could not be deleted.");
    $("#deletionResult").textContent = response.verified
      ? "Local extension data deleted and the receipt was verified."
      : "Local extension data deleted. Yoink was unavailable to verify the receipt.";
    await Promise.all([renderHealth(), renderPermissions()]);
  } catch (error) {
    $("#deletionResult").textContent = error instanceof Error ? error.message : "Local data could not be deleted.";
  } finally {
    deleteButton.disabled = false;
    cancelDeleteButton.disabled = false;
    disarmDelete();
  }
}

deleteButton.addEventListener("click", () => {
  if (deleteButton.dataset.armed === "true") {
    void deleteLocalData();
    return;
  }
  armDelete();
});
cancelDeleteButton.addEventListener("click", () => {
  disarmDelete();
  $("#deletionResult").textContent = "";
  deleteButton.focus();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || deleteButton.dataset.armed !== "true" || deleteButton.disabled) return;
  disarmDelete();
  $("#deletionResult").textContent = "";
});

await Promise.all([renderHealth(), renderPermissions(), renderReverificationPlan()]);
