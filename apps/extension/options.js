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
let reverificationPlan = { lanes: [] };

async function renderHealth() {
  const response = await chrome.runtime.sendMessage({ type: "yoink:check-health" }).catch(() => null);
  $("#pairState").textContent = response?.state?.paired
    ? response.state.connected ? "Paired · Ready" : "Paired · Companion unavailable"
    : "Not paired";
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
  if (!lane.candidate) return "No prior candidate";
  const warning = String(lane.qualification?.warning || "none");
  if (warning === "version_changed") return "Version changed";
  if (warning === "expired") return "Expired";
  if (warning === "expiring") return "Expiring soon";
  return lane.qualification?.status === "qualified" ? "Qualified" : "Ready to verify";
}

async function renderReverificationPlan() {
  const response = await chrome.runtime.sendMessage({ type: "yoink:get-reverification-plan" }).catch(() => null);
  if (!response?.ok || !Array.isArray(response.plan?.lanes)) {
    reverificationPlan = { lanes: [] };
    $("#laneReadinessState").textContent = "Unavailable";
    $("#laneReadinessList").replaceChildren();
    $("#reverifyLanes").disabled = true;
    return;
  }
  reverificationPlan = response.plan;
  const rows = response.plan.lanes.map((lane) => {
    const row = document.createElement("div");
    row.className = "permission-row";
    const identity = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = RETAILER_NAMES[lane.retailerId] || lane.retailerId;
    const detail = document.createElement("small");
    detail.textContent = lane.candidate
      ? `${lane.candidate.retailerSku} · ${laneStatus(lane)}`
      : laneStatus(lane);
    identity.append(name, detail);
    const status = document.createElement("span");
    status.textContent = lane.candidate ? "Available" : "Needs candidate";
    row.append(identity, status);
    return row;
  });
  $("#laneReadinessList").replaceChildren(...rows);
  const available = response.plan.lanes.filter((lane) => lane.candidate);
  $("#laneReadinessState").textContent = `${available.length} of ${response.plan.lanes.length} available`;
  $("#reverifyLanes").disabled = available.length === 0;
}

$("#openYoink").href = PopupState.appDestinationUrl(runtime.appOrigin, "dashboard");
$("#reverifyLanes").addEventListener("click", async () => {
  const button = $("#reverifyLanes");
  const retailerIds = reverificationPlan.lanes.filter((lane) => lane.candidate).map((lane) => lane.retailerId);
  const origins = [...new Set(retailerIds.flatMap((retailerId) => PopupState.RETAILER_ORIGINS[retailerId] || []))];
  if (!retailerIds.length || !origins.length) return;
  button.disabled = true;
  $("#reverificationResult").textContent = "Waiting for store access…";
  try {
    const granted = await chrome.permissions.request({ origins });
    if (!granted) throw new Error("Store access was not approved. No checks ran.");
    $("#reverificationResult").textContent = "Re-verifying prior products without clicking Add to cart…";
    const response = await chrome.runtime.sendMessage({
      type: "yoink:reverify-retailer-lanes",
      retailerIds
    });
    if (!response?.ok || !Array.isArray(response.results)) {
      throw new Error(response?.message || "Store lanes could not be re-verified.");
    }
    const passed = response.results.filter((result) => result.outcome === "passed").length;
    $("#reverificationResult").textContent = `${passed} of ${response.results.length} lane${response.results.length === 1 ? "" : "s"} passed the no-click rehearsal.`;
    await renderReverificationPlan();
  } catch (error) {
    $("#reverificationResult").textContent = error instanceof Error ? error.message : "Store lanes could not be re-verified.";
  } finally {
    button.disabled = reverificationPlan.lanes.every((lane) => !lane.candidate);
  }
});
$("#deleteLocalData").addEventListener("click", async () => {
  const approved = confirm("Delete all data stored by Yoink Companion in this Chrome profile?\n\nThis removes pairing credentials, cached evidence, handoffs, queues, and extension settings. It does not delete your Yoink account data.");
  if (!approved) return;
  const button = $("#deleteLocalData");
  button.disabled = true;
  $("#deletionResult").textContent = "Deleting local extension data…";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "yoink:delete-local-data",
      confirmation: "DELETE_ALL_LOCAL_YOINK_DATA"
    });
    if (!response?.ok || response.deleted !== true) throw new Error(response?.message || "Local data could not be deleted.");
    $("#deletionResult").textContent = response.verified
      ? "Local extension data deleted and the receipt was verified."
      : "Local extension data deleted. The companion was unavailable to verify the receipt.";
    await Promise.all([renderHealth(), renderPermissions()]);
  } catch (error) {
    $("#deletionResult").textContent = error instanceof Error ? error.message : "Local data could not be deleted.";
  } finally {
    button.disabled = false;
  }
});

await Promise.all([renderHealth(), renderPermissions(), renderReverificationPlan()]);
