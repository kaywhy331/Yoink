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

$("#openYoink").href = PopupState.appDestinationUrl(runtime.appOrigin, "dashboard");
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

await Promise.all([renderHealth(), renderPermissions()]);
