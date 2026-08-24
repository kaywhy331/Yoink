const $ = (selector) => document.querySelector(selector);
const TARGET_ORIGINS = ["https://www.target.com/*"];
const TRACKALACKER_ORIGINS = ["https://trackalacker.com/*", "https://www.trackalacker.com/*"];
const TRACKALACKER_SYNC_ORIGINS = [
  ...TRACKALACKER_ORIGINS,
  "https://*.amazon.com/*",
  "https://*.walmart.com/*",
  "https://*.bestbuy.com/*",
  "https://www.disneystore.com/*",
  "https://*.ravensburger.us/*",
  "https://merch.riotgames.com/*",
  "https://*.booksamillion.com/*",
  "https://*.fanatics.com/*",
  "https://*.kohls.com/*",
  "https://*.macys.com/*",
  "https://*.p-bandai.com/*",
  "https://*.pokemoncenter.com/*"
];
const RETAILER_ORIGINS = {
  target: TARGET_ORIGINS,
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
const INSTALLED_VERSION = chrome.runtime.getManifest().version;

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

function render(state) {
  const connected = state?.connected === true;
  const paired = state?.paired === true;
  $("#statusDot").className = `status-dot ${connected ? paired ? "ready" : "" : "error"}`;
  $("#statusTitle").textContent = connected ? (paired ? "Paired and connected" : "Connected; pairing required") : "Local app unavailable";
  $("#statusCopy").textContent = connected
    ? paired ? `Yoink ${state.version || ""} recognizes this browser.` : "Create a one-time code in Yoink to pair this browser."
    : "Start Yoink, then check again.";
  $("#device").textContent = paired ? (state.deviceName || "Paired Chrome") : "Not paired";
  $("#mode").textContent = connected ? state.executionMode : "—";
  $("#actions").textContent = connected ? (state.actionsPaused ? "Paused" : "Enabled") : "—";
  $("#mutation").textContent = state?.chromeMutationEnabled ? "Enabled" : "Disabled";
  $("#checkedAt").textContent = state?.checkedAt ? new Date(state.checkedAt).toLocaleTimeString() : "—";
  $("#pairCard").hidden = !connected || paired;
  $("#forget").hidden = !paired;
  const targetAccess = state?.targetShadowAccess === true;
  $("#targetAccess").textContent = targetAccess ? "Target page access enabled" : "Target page access not granted";
  $("#inspectTarget").textContent = targetAccess ? "Inspect current Target page" : "Enable and inspect Target";
  $("#inspectTarget").disabled = !connected || !paired;
  $("#rehearseTarget").disabled = !connected || !paired;
  $("#rehearseWalmart").disabled = !connected || !paired;
  $("#rehearseAmazon").disabled = !connected || !paired;
  $("#rehearseBestBuy").disabled = !connected || !paired;
  $("#inspectRetailer").disabled = !connected || !paired;
  $("#inspectWalmartDraw").disabled = !connected || !paired;
  $("#shareCommunity").disabled = !connected || !paired;
  $("#removeTarget").hidden = !targetAccess;
  const trackalacker = state?.trackalackerPush || {};
  $("#trackalackerStatus").textContent = trackalacker.ready
    ? "Connected and listening"
    : trackalacker.state === "error" ? "Connection needs attention" : "Not connected";
  $("#connectTrackalacker").textContent = trackalacker.ready ? "Verify TrackaLacker connection" : "Connect TrackaLacker push";
  $("#connectTrackalacker").disabled = !connected || !paired;
  const sync = state?.trackalackerSync || {};
  const syncUpdatedAt = new Date(sync.updatedAt || "").getTime();
  const syncRunning = ["starting", "discovering", "importing"].includes(sync.phase)
    && Number.isFinite(syncUpdatedAt) && Date.now() - syncUpdatedAt < 10 * 60_000;
  $("#syncTrackalacker").disabled = !connected || !paired || syncRunning;
  $("#syncTrackalacker").textContent = syncRunning
    ? `Syncing ${Number(sync.processed || 0)}/${Number(sync.discovered || 0)}`
    : "Sync followed library";
  if (trackalacker.ready) {
    $("#trackalackerMessage").textContent = trackalacker.errorCode === "silent_push_unavailable"
      ? "Connected, but this Chrome build requires a visible fallback notification and may show an extra alert."
      : trackalacker.pendingSignals
      ? `${trackalacker.pendingSignals} sanitized signal${trackalacker.pendingSignals === 1 ? "" : "s"} waiting for the local app.`
      : "Silent push is active. TrackaLacker's normal browser notifications remain unchanged.";
  } else if (trackalacker.state === "error") {
    $("#trackalackerMessage").textContent = `Connection stopped safely${trackalacker.lastHttpStatus ? ` at HTTP ${trackalacker.lastHttpStatus}` : ""}. Open a signed-in TrackaLacker tab and retry.`;
  }
  if (syncRunning || sync.phase === "complete" || sync.phase === "error") {
    $("#trackalackerMessage").textContent = sync.message || (syncRunning ? "Syncing followed products…" : "TrackaLacker sync finished.");
  }
  const reportedRelease = comparableVersion(state?.version) ? state.version : "—";
  const newerReported = compareVersions(reportedRelease, INSTALLED_VERSION) > 0;
  $("#updateVersions").textContent = `Installed ${INSTALLED_VERSION} · local release ${reportedRelease}`;
  $("#checkUpdate").classList.toggle("update-ready", newerReported);
  $("#checkUpdate").textContent = newerReported ? "Check and download update" : "Check for updates";
  $("#checkUpdate").disabled = !connected;
}

function renderTargetObservation(observation) {
  const price = Number.isSafeInteger(observation?.unitPriceCents)
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(observation.unitPriceCents / 100)
    : "price not observed";
  const state = observation?.observationState === "actionable_candidate"
    ? "Complete candidate evidence"
    : observation?.observationState === "manual_block" ? "Manual browser step detected" : "Not currently actionable";
  $("#targetMessage").textContent = `${state}: TCIN ${observation?.retailerSku || "unknown"} · ${price} · ${observation?.sellerName || "seller unknown"} · ${observation?.fulfillment || "fulfillment unknown"}.`;
}

function retailerFromUrl(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLocaleLowerCase("en-US");
    if (host === "target.com" || host.endsWith(".target.com")) return "target";
    if (host === "walmart.com" || host.endsWith(".walmart.com")) return "walmart";
    if (host === "amazon.com" || host.endsWith(".amazon.com")) return "amazon";
    if (host === "bestbuy.com" || host.endsWith(".bestbuy.com")) return "bestbuy";
    if (host === "disneystore.com" || host.endsWith(".disneystore.com")) return "disney";
    if (host === "ravensburger.us" || host.endsWith(".ravensburger.us")) return "ravensburger";
    if (host === "merch.riotgames.com") return "riot";
    if (host === "booksamillion.com" || host.endsWith(".booksamillion.com")) return "booksamillion";
    if (host === "fanatics.com" || host.endsWith(".fanatics.com")) return "fanatics";
    if (host === "kohls.com" || host.endsWith(".kohls.com")) return "kohls";
    if (host === "macys.com" || host.endsWith(".macys.com")) return "macys";
    if (host === "p-bandai.com" || host.endsWith(".p-bandai.com")) return "pbandai";
    if (host === "pokemoncenter.com" || host.endsWith(".pokemoncenter.com")) return "pokemoncenter";
    return "";
  } catch {
    return "";
  }
}

function renderRetailerObservation(observation) {
  const price = Number.isSafeInteger(observation?.unitPriceCents)
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(observation.unitPriceCents / 100)
    : "price not observed";
  const retailerNames = {
    bestbuy: "Best Buy", disney: "Disney Store", ravensburger: "Ravensburger",
    riot: "Riot Games Merch", booksamillion: "Books-A-Million", fanatics: "Fanatics",
    kohls: "Kohl's", macys: "Macy's", pbandai: "Premium Bandai", pokemoncenter: "Pokémon Center"
  };
  const retailer = retailerNames[observation?.retailerId]
    || `${String(observation?.retailerId || "Store").slice(0, 1).toUpperCase()}${String(observation?.retailerId || "store").slice(1)}`;
  const evidence = observation?.observationState === "actionable_candidate"
    ? "Complete candidate evidence"
    : observation?.observationState === "manual_block" ? "Manual browser step detected" : "Not currently actionable";
  const route = observation?.retailerId === "amazon"
    ? observation.purchaseRouteReady
      ? " · exact ephemeral offer binding verified; token discarded"
      : ` · offer binding closed: ${String(observation.routeReasonCode || "not ready").replaceAll("_", " ")}`
    : "";
  $("#retailerMessage").textContent = `${retailer}: ${evidence} · ${observation?.retailerSku || "unknown SKU"} · ${price} · ${observation?.sellerName || "seller unknown"} · ${observation?.fulfillment || "fulfillment unknown"}${route}.`;
}

function renderWalmartDrawScan(scan) {
  const items = Array.isArray(scan?.items) ? scan.items : [];
  const label = scan?.outcome === "passed" ? "Verified"
    : scan?.outcome === "partial" ? "Partially observed"
      : scan?.outcome === "manual" ? "Manual browser step detected" : "Observation failed";
  const active = items.filter((item) => item.drawState === "active").length;
  const tracked = items.filter((item) => item.tracked === true).length;
  $("#walmartDrawMessage").textContent = `${label}: ${active} active drawing${active === 1 ? "" : "s"} across ${items.length} exact item${items.length === 1 ? "" : "s"}${tracked ? ` · ${tracked} matches a purchase plan` : ""}. Entry remains manual; no account, address, payment, or entry state was collected.`;
}

async function check() {
  $("#statusTitle").textContent = "Checking local app…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "yoink:check-health" });
    if (!response?.ok) throw new Error(response?.message || "Health check failed.");
    render(response.state);
  } catch {
    render({ connected: false, checkedAt: new Date().toISOString() });
  }
}

$("#pair").addEventListener("click", async () => {
  const button = $("#pair");
  const code = $("#pairCode").value.trim();
  $("#pairMessage").textContent = "Pairing…";
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "yoink:pair-device", code });
    if (!response?.ok) throw new Error(response?.message || "Pairing failed.");
    $("#pairCode").value = "";
    render(response.state);
  } catch (error) {
    $("#pairMessage").textContent = error.message || "The code could not be paired.";
  } finally {
    button.disabled = false;
  }
});
$("#forget").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "yoink:forget-device" });
  if (response?.ok) render(response.state);
});
$("#inspectTarget").addEventListener("click", async () => {
  const button = $("#inspectTarget");
  button.disabled = true;
  $("#targetMessage").textContent = "Requesting Target page access…";
  try {
    const granted = await chrome.permissions.request({ origins: TARGET_ORIGINS });
    if (!granted) throw new Error("Target access was not granted.");
    $("#targetMessage").textContent = "Inspecting the active Target product page once…";
    const response = await chrome.runtime.sendMessage({ type: "yoink:inspect-target" });
    if (!response?.ok) throw new Error(response?.message || "Target inspection failed.");
    render(response.state);
    renderTargetObservation(response.observation);
  } catch (error) {
    $("#targetMessage").textContent = error.message || "The Target page could not be inspected.";
    await check();
  } finally {
    button.disabled = false;
  }
});
$("#rehearseTarget").addEventListener("click", async () => {
  const button = $("#rehearseTarget");
  button.disabled = true;
  $("#targetMessage").textContent = "Running the production verifier to its no-click boundary…";
  try {
    const granted = await chrome.permissions.request({ origins: TARGET_ORIGINS });
    if (!granted) throw new Error("Target access was not granted.");
    const response = await chrome.runtime.sendMessage({ type: "yoink:rehearse-target" });
    if (!response?.ok) throw new Error(response?.message || "Target rehearsal failed.");
    render(response.state);
    renderTargetObservation(response.observation);
    $("#targetMessage").textContent = response.rehearsal?.ok
      ? "Safe rehearsal passed. The exact offer reached the final pre-click boundary, and no click occurred."
      : `Safe rehearsal stopped before click: ${String(response.rehearsal?.reason || "offer not verified").replaceAll("_", " ")}.`;
  } catch (error) {
    $("#targetMessage").textContent = error.message || "The Target rehearsal could not run.";
    await check();
  } finally {
    button.disabled = false;
  }
});
$("#inspectRetailer").addEventListener("click", async () => {
  const button = $("#inspectRetailer");
  button.disabled = true;
  $("#retailerMessage").textContent = "Checking the active retailer product page…";
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const retailerId = retailerFromUrl(tabs[0]?.url);
    if (!retailerId) throw new Error("Open an exact supported retailer product page first.");
    const granted = await chrome.permissions.request({ origins: RETAILER_ORIGINS[retailerId] });
    if (!granted) throw new Error("Read-only retailer page access was not granted.");
    const response = await chrome.runtime.sendMessage({ type: "yoink:inspect-retailer" });
    if (!response?.ok) throw new Error(response?.message || "Retailer inspection failed.");
    render(response.state);
    renderRetailerObservation(response.observation);
  } catch (error) {
    $("#retailerMessage").textContent = error.message || "The retailer page could not be inspected.";
    await check();
  } finally {
    button.disabled = false;
  }
});
$("#inspectWalmartDraw").addEventListener("click", async () => {
  const button = $("#inspectWalmartDraw");
  button.disabled = true;
  $("#walmartDrawMessage").textContent = "Requesting read-only Walmart access…";
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(String(tabs[0]?.url || ""));
    if (!(url.hostname === "walmart.com" || url.hostname.endsWith(".walmart.com"))
      || url.pathname.replace(/\/+$/, "") !== "/shop/collectibles/draw") {
      throw new Error("Open Walmart’s exact Collectibles Draw hub first.");
    }
    const granted = await chrome.permissions.request({ origins: RETAILER_ORIGINS.walmart });
    if (!granted) throw new Error("Read-only Walmart page access was not granted.");
    $("#walmartDrawMessage").textContent = "Inspecting current drawings without entering any of them…";
    const response = await chrome.runtime.sendMessage({ type: "yoink:inspect-walmart-draw" });
    if (!response?.ok) throw new Error(response?.message || "Walmart drawing inspection failed.");
    render(response.state);
    renderWalmartDrawScan(response.scan);
  } catch (error) {
    $("#walmartDrawMessage").textContent = error.message || "Walmart drawings could not be inspected.";
    await check();
  } finally {
    button.disabled = false;
  }
});
$("#shareCommunity").addEventListener("click", async () => {
  const button = $("#shareCommunity");
  button.disabled = true;
  $("#communityMessage").textContent = "Validating and sharing this page once…";
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const retailerId = retailerFromUrl(tabs[0]?.url);
    if (!retailerId) throw new Error("Open an exact supported retailer product page first.");
    const granted = await chrome.permissions.request({ origins: RETAILER_ORIGINS[retailerId] });
    if (!granted) throw new Error("Read-only retailer page access was not granted.");
    const response = await chrome.runtime.sendMessage({ type: "yoink:contribute-retailer" });
    if (!response?.ok) throw new Error(response?.message || "The evidence was not shared.");
    render(response.state);
    if (retailerId === "target") renderTargetObservation(response.observation);
    else renderRetailerObservation(response.observation);
    const disposition = response.receipt?.disposition === "deduped" ? "Deduplicated"
      : response.receipt?.disposition === "quarantined" ? "Held for review" : "Accepted";
    const selectionState = String(response.assertion?.selectedOffer?.selectionState || "unresolved").replaceAll("_", " ");
    $("#communityMessage").textContent = `${disposition}: one sanitized, read-only ${selectionState} assertion was recorded. No page text, account data, or offer token was sent.`;
  } catch (error) {
    $("#communityMessage").textContent = error.message || "The evidence could not be shared.";
    await check();
  } finally {
    button.disabled = false;
  }
});
$("#rehearseWalmart").addEventListener("click", async () => {
  const button = $("#rehearseWalmart");
  button.disabled = true;
  $("#retailerMessage").textContent = "Running the Walmart production verifier to its no-click boundary…";
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (retailerFromUrl(tabs[0]?.url) !== "walmart") throw new Error("Open an exact Walmart product page first.");
    const granted = await chrome.permissions.request({ origins: RETAILER_ORIGINS.walmart });
    if (!granted) throw new Error("Walmart page access was not granted.");
    const response = await chrome.runtime.sendMessage({ type: "yoink:rehearse-walmart" });
    if (!response?.ok) throw new Error(response?.message || "Walmart rehearsal failed.");
    render(response.state);
    renderRetailerObservation(response.observation);
    $("#retailerMessage").textContent = response.rehearsal?.ok
      ? "Walmart rehearsal passed. The exact shipping offer reached the final pre-click boundary, and no click occurred."
      : `Walmart rehearsal stopped before click: ${String(response.rehearsal?.reason || "offer not verified").replaceAll("_", " ")}.`;
  } catch (error) {
    $("#retailerMessage").textContent = error.message || "The Walmart rehearsal could not run.";
    await check();
  } finally {
    button.disabled = false;
  }
});
$("#rehearseAmazon").addEventListener("click", async () => {
  const button = $("#rehearseAmazon");
  button.disabled = true;
  $("#retailerMessage").textContent = "Running the Amazon production verifier to its no-click boundary…";
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (retailerFromUrl(tabs[0]?.url) !== "amazon") throw new Error("Open an exact Amazon product page first.");
    const granted = await chrome.permissions.request({ origins: RETAILER_ORIGINS.amazon });
    if (!granted) throw new Error("Amazon page access was not granted.");
    const response = await chrome.runtime.sendMessage({ type: "yoink:rehearse-amazon" });
    if (!response?.ok) throw new Error(response?.message || "Amazon rehearsal failed.");
    render(response.state);
    renderRetailerObservation(response.observation);
    $("#retailerMessage").textContent = response.rehearsal?.ok
      ? "Amazon rehearsal passed. The exact first-party shipping offer reached the final pre-click boundary, and no click occurred."
      : `Amazon rehearsal stopped before click: ${String(response.rehearsal?.reason || "offer not verified").replaceAll("_", " ")}.`;
  } catch (error) {
    $("#retailerMessage").textContent = error.message || "The Amazon rehearsal could not run.";
    await check();
  } finally {
    button.disabled = false;
  }
});
$("#rehearseBestBuy").addEventListener("click", async () => {
  const button = $("#rehearseBestBuy");
  button.disabled = true;
  $("#retailerMessage").textContent = "Running the Best Buy production verifier to its no-click boundary…";
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (retailerFromUrl(tabs[0]?.url) !== "bestbuy") throw new Error("Open an exact Best Buy product page first.");
    const granted = await chrome.permissions.request({ origins: RETAILER_ORIGINS.bestbuy });
    if (!granted) throw new Error("Best Buy page access was not granted.");
    const response = await chrome.runtime.sendMessage({ type: "yoink:rehearse-bestbuy" });
    if (!response?.ok) throw new Error(response?.message || "Best Buy rehearsal failed.");
    render(response.state);
    renderRetailerObservation(response.observation);
    $("#retailerMessage").textContent = response.rehearsal?.ok
      ? "Best Buy rehearsal passed. The exact Best Buy-sold, selected-shipping offer reached the final pre-click boundary, and no click occurred."
      : `Best Buy rehearsal stopped before click: ${String(response.rehearsal?.reason || "offer not verified").replaceAll("_", " ")}.`;
  } catch (error) {
    $("#retailerMessage").textContent = error.message || "The Best Buy rehearsal could not run.";
    await check();
  } finally {
    button.disabled = false;
  }
});
$("#connectTrackalacker").addEventListener("click", async () => {
  const button = $("#connectTrackalacker");
  button.disabled = true;
  $("#trackalackerMessage").textContent = "Requesting TrackaLacker page access and preparing a silent push subscription…";
  try {
    const granted = await chrome.permissions.request({ origins: TRACKALACKER_ORIGINS });
    if (!granted) throw new Error("TrackaLacker page access was not granted.");
    const response = await chrome.runtime.sendMessage({ type: "yoink:connect-trackalacker" });
    if (!response?.ok) throw new Error(response?.message || "TrackaLacker connection failed.");
    render(response.state);
    $("#trackalackerMessage").textContent = `${response.diagnostic || "Device registration succeeded"}. Silent signal delivery is active.`;
  } catch (error) {
    $("#trackalackerMessage").textContent = error.message || "TrackaLacker could not be connected.";
    await check();
  } finally {
    button.disabled = false;
  }
});
$("#syncTrackalacker").addEventListener("click", async () => {
  const button = $("#syncTrackalacker");
  button.disabled = true;
  $("#trackalackerMessage").textContent = "Starting one bounded pass across your followed library…";
  try {
    const granted = await chrome.permissions.request({ origins: TRACKALACKER_SYNC_ORIGINS });
    if (!granted) throw new Error("TrackaLacker page access was not granted.");
    const response = await chrome.runtime.sendMessage({ type: "yoink:sync-trackalacker" });
    if (!response?.ok) throw new Error(response?.message || "TrackaLacker sync failed to start.");
    await check();
  } catch (error) {
    $("#trackalackerMessage").textContent = error.message || "TrackaLacker sync could not start.";
    await check();
  } finally {
    button.disabled = false;
  }
});
$("#removeTarget").addEventListener("click", async () => {
  await chrome.permissions.remove({ origins: TARGET_ORIGINS });
  $("#targetMessage").textContent = "Read-only Target access removed.";
  await check();
});
$("#checkUpdate").addEventListener("click", async () => {
  const button = $("#checkUpdate");
  button.disabled = true;
  $("#updateMessage").textContent = "Checking the local signed-by-hash release feed…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "yoink:check-update", download: true });
    if (!response?.ok || !response.update) throw new Error(response?.message || "Update check failed.");
    const update = response.update;
    $("#updateVersions").textContent = `Installed ${update.installedVersion} · local release ${update.releaseVersion}`;
    if (update.downloadStarted) {
      $("#updateMessage").textContent = "Update downloaded. Extract it over the same Yoink Companion folder, then choose Reload below (or Reload on chrome://extensions). Pairing and local settings remain intact.";
      $("#reloadExtension").hidden = false;
      button.textContent = "Update downloaded";
    } else if (update.updateAvailable && !update.packageReady) {
      $("#updateMessage").textContent = "A newer app build exists, but its companion package is still being prepared. Run the local release packaging step, then retry.";
      button.textContent = "Retry update check";
    } else if (update.updateAvailable) {
      $("#updateMessage").textContent = "A newer companion is available, but Chrome did not start the local download. Retry or open Yoink for the package link.";
      button.textContent = "Retry download";
    } else if (compareVersions(update.installedVersion, update.releaseVersion) > 0) {
      $("#updateMessage").textContent = "This companion is newer than the running local app. Update and restart Yoink before changing the extension.";
      button.textContent = "Check for updates";
    } else {
      $("#updateMessage").textContent = "The installed companion is current. No folder changes are needed.";
      button.textContent = "Check again";
    }
  } catch (error) {
    $("#updateMessage").textContent = error.message || "The local update feed could not be checked.";
    button.textContent = "Retry update check";
  } finally {
    button.disabled = false;
  }
});
$("#reloadExtension").addEventListener("click", () => chrome.runtime.reload());
$("#check").addEventListener("click", check);
$("#open").addEventListener("click", () => chrome.tabs.create({ url: "http://127.0.0.1:32991/" }));

const stored = await chrome.storage.local.get("readiness");
render(stored.readiness);
void check();
