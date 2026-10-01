const PopupState = globalThis.YoinkPopupStateModule;
if (!PopupState?.RETAILER_ORIGINS || !PopupState?.appDestinationUrl || !PopupState?.packagedRuntimeConfig
  || !PopupState?.retailerDisplayName) {
  throw new Error("Yoink Companion settings are unavailable.");
}
// Same packaged-origin validation as the popup: an invalid runtime-config
// never produces settings links.
const runtime = PopupState.packagedRuntimeConfig(globalThis.YoinkRuntimeConfig);

// Store names come from the one popup-state model shared with the popup.
const retailerName = (retailerId) => PopupState.retailerDisplayName(retailerId);
const COVERAGE_NAMES = {
  first_party_actionable: "first-party",
  shipping_actionable: "shipping",
  pickup_actionable: "pickup",
  offer_route_ready: "exact offer",
  pre_click_rehearsal: "no-click passed"
};
const $ = (selector) => document.querySelector(selector);
let automaticSchedule = null;
let automaticStatusSequence = 0;
let automaticSettingsPending = false;
let manualReverificationPending = false;

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
  openYoink.textContent = paired ? "Open Yoink" : "Open Yoink › Setup › Chrome";
}

async function permissionRow(retailerId, origins) {
  const row = document.createElement("div");
  row.className = "permission-row";
  const label = document.createElement("strong");
  label.textContent = retailerName(retailerId) || retailerId;
  const controls = document.createElement("div");
  const state = document.createElement("span");
  const button = document.createElement("button");
  button.className = "button";
  button.type = "button";
  const render = async () => {
    let granted;
    try {
      granted = await chrome.permissions.contains({ origins });
    } catch {
      state.textContent = "Unavailable";
      button.textContent = "Retry";
      button.dataset.granted = "unknown";
      return;
    }
    state.textContent = granted ? "Allowed" : "Not allowed";
    button.textContent = granted ? "Remove" : "Allow";
    button.dataset.granted = String(granted);
  };
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (button.dataset.granted === "true") {
        await chrome.permissions.remove({ origins });
      } else if (button.dataset.granted === "false") {
        await chrome.permissions.request({ origins });
      }
      await render();
    } catch {
      state.textContent = "Could not change access";
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
    .map(([retailerId, origins]) => permissionRow(retailerId, origins).catch(() => {
      const row = document.createElement("div");
      row.className = "permission-row";
      const label = document.createElement("strong");
      label.textContent = retailerName(retailerId) || retailerId;
      const state = document.createElement("span");
      state.textContent = "Unavailable";
      row.append(label, state);
      return row;
    })));
  $("#permissionList").replaceChildren(...rows);
}

function storeName(retailerId) {
  return retailerName(retailerId) || retailerId || "this store";
}

// Reason codes are machine identifiers. Everything a person reads here is
// translated into a sentence that says what to do next.
function humanizeReason(reasonCode, retailerId = "") {
  const store = storeName(retailerId);
  const known = {
    verified: "Passed without clicking",
    qualification_evidence_ready: "Evidence ready",
    qualification_candidate_missing: "No candidate product yet",
    qualification_candidate_exhausted: "No candidate passed",
    qualification_blocked: "Check stopped",
    retailer_access_missing: `Allow ${store} access`,
    retailer_session_signed_out: `Sign in to ${store} in Chrome`,
    retailer_session_challenged: `Finish the ${store} security check in Chrome`,
    manual_action_required: `${store} needs you in Chrome`,
    action_job_active: "Waiting for the current cart action",
    companion_update_required: "Update the Chrome companion",
    app_update_required: "Update the Yoink app",
    adapter_version_mismatch: "Chrome companion and Yoink app versions differ",
    product_page_unavailable: "Product page no longer loads",
    out_of_stock: "Product is sold out",
    third_party_seller: "Sold by a marketplace seller",
    fulfillment_not_supported: "Shipping is not offered",
    worker_restarted: "Chrome restarted the companion mid-check",
    no_purchasable_candidate: "No purchasable product to check yet",
    no_candidate: "No candidate product yet"
  };
  if (known[reasonCode]) return known[reasonCode];
  return String(reasonCode || "check_stopped").replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function laneStatus(lane) {
  if (lane.degraded === true) return "Store checks failing · cart adds paused";
  if (lane.blockedReason) return humanizeReason(lane.blockedReason, lane.retailerId);
  if (!lane.candidate) return "Needs a candidate product";
  const warning = String(lane.qualification?.warning || "none");
  if (warning === "version_changed") return "Version changed";
  if (warning === "expired") return "Expired";
  if (warning === "expiring") return "Expiring soon";
  if (lane.evidence?.qualificationEvidenceReady === true
    && lane.qualification?.status !== "qualified") return "Ready to enable";
  return lane.qualification?.status === "qualified" ? "Ready" : "Ready to check";
}

function lastRunText(lane) {
  const run = lane.lastAutomaticRun;
  if (!run?.finishedAt) return "";
  const when = new Date(run.finishedAt);
  const stamp = Number.isFinite(when.getTime()) ? when.toLocaleString() : "";
  const outcome = run.outcome === "passed" ? "passed"
    : run.outcome === "partial" ? "partly passed"
      : humanizeReason(run.reasonCode || run.outcome, lane.retailerId).toLowerCase();
  return stamp ? `Last automatic check ${stamp} · ${outcome}` : "";
}

function resultReason(value, retailerId = "") {
  return humanizeReason(value || "check_stopped", retailerId);
}

function laneResultText(result) {
  if (!result) return "";
  const retailerId = result.retailerId || "";
  const passed = Number(result.passedProductCount) || 0;
  const attempted = Number(result.attemptedProductCount) || 0;
  if (result.outcome === "passed") {
    return attempted > 0
      ? `${passed} of ${attempted} passed · no click`
      : "Evidence already ready";
  }
  if (result.outcome === "partial") {
    return attempted > 0
      ? `${passed} of ${attempted} passed · more evidence needed`
      : "Partly passed · more evidence needed";
  }
  if (result.outcome === "parked" || result.outcome === "access_missing") {
    return `Waiting · ${resultReason(result.reasonCode, retailerId)}`;
  }
  if (result.outcome === "skipped") return `Skipped · ${resultReason(result.reasonCode, retailerId)}`;
  if (result.outcome === "error") return `Stopped · ${resultReason(result.reasonCode, retailerId)}`;
  return `Stopped · ${resultReason(result.reasonCode || result.outcome, retailerId)}`;
}

async function reverifyStore(lane, button, status) {
  const retailerId = lane.retailerId;
  const storeName = retailerName(retailerId) || retailerId;
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
    status.textContent = laneResultText(result);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : `${storeName} could not be checked.`;
  } finally {
    button.disabled = false;
    await renderAutomaticReverification({ preserveResult: true });
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
    return null;
  }
  const rows = response.plan.lanes.map((lane) => {
    const row = document.createElement("div");
    row.className = "lane-readiness-row";
    row.dataset.reverifyRetailer = lane.retailerId;
    const identity = document.createElement("span");
    const name = document.createElement("strong");
    const storeName = retailerName(lane.retailerId) || lane.retailerId;
    name.textContent = storeName;
    const detail = document.createElement("small");
    const candidates = Array.isArray(lane.candidates) && lane.candidates.length
      ? lane.candidates : lane.candidate ? [lane.candidate] : [];
    const coverage = [...new Set(candidates.flatMap((candidate) =>
      Array.isArray(candidate.qualificationTypes) ? candidate.qualificationTypes : []))]
      .map((item) => COVERAGE_NAMES[item]).filter(Boolean).slice(0, 3);
    const lastRun = lastRunText(lane);
    detail.textContent = [
      candidates.length
        ? `${candidates.length} candidate product${candidates.length === 1 ? "" : "s"}${coverage.length ? ` · ${coverage.join(" · ")}` : ""}.`
        : `No safe ${storeName} candidate is available yet.`,
      lane.degraded === true && Array.isArray(lane.degradedReasons) && lane.degradedReasons.length
        ? `Recent failures: ${lane.degradedReasons.map((reason) => humanizeReason(reason, lane.retailerId)).join(", ")}.`
        : "",
      lastRun ? `${lastRun}.` : ""
    ].filter(Boolean).join(" ");
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
    if (!lane.candidate) button.title = "An eligible candidate product is needed.";
    button.addEventListener("click", () => reverifyStore(lane, button, status));
    row.append(identity, status, button);
    return row;
  });
  $("#laneReadinessList").replaceChildren(...rows);
  renderLaneSchedules();
  const available = response.plan.lanes.filter((lane) => lane.candidate);
  const needed = response.plan.lanes.filter((lane) => lane.automaticCheckNeeded === true);
  $("#laneReadinessState").textContent = needed.length
    ? `${needed.length} need checking`
    : `${available.length} stores remembered`;
  return response.plan;
}

function resultsSummary(results, stateRecord) {
  const passed = results.filter((item) => item.outcome === "passed").length;
  const waiting = results.filter((item) => ["parked", "access_missing", "skipped"].includes(item.outcome));
  const waitingText = waiting.length
    ? ` · ${waiting.map((item) => `${storeName(item.retailerId)}: ${resultReason(item.reasonCode, item.retailerId)}`).join(" · ")}`
    : "";
  const stamp = stateRecord?.updatedAt && Number.isFinite(new Date(stateRecord.updatedAt).getTime())
    ? ` Last checked ${new Date(stateRecord.updatedAt).toLocaleString()}.`
    : "";
  return `${passed} of ${results.length} stores ready${waitingText}. No Add controls were clicked.${stamp}`;
}

function automaticResultText(response) {
  if (!response) return "Automatic checks are unavailable.";
  if (response.started === false && response.reason === "store_checks_blocked") return "Store checks are waiting for help. See the store status below.";
  if (response.started === false && response.reason === "no_store_checks_needed") return "No stores currently need a check.";
  if (response.started === false && response.reason === "automatic_check_cooldown") {
    return "Automatic checks are waiting out their backoff after the last run.";
  }
  if (response.started === false && response.reason === "automatic_check_daily_cap") {
    return "Automatic checks reached today's limit. They resume tomorrow.";
  }
  if (response.started === false && response.reason === "automatic_checks_disabled") return "Automatic checks off.";
  const stateRecord = typeof response.state === "object" && response.state ? response.state : null;
  const results = Array.isArray(response.results) ? response.results
    : Array.isArray(stateRecord?.results) ? stateRecord.results : [];
  const runState = typeof response.state === "string" ? response.state : stateRecord?.state || "";
  if (runState === "error") {
    const reason = resultReason(response.reasonCode || stateRecord?.reasonCode || "check_stopped");
    return `The last check stopped early · ${reason}.${results.length ? ` ${resultsSummary(results, stateRecord)}` : ""}`;
  }
  if (runState === "running") return "A store check is running now. No Add controls are clicked.";
  if (!results.length) {
    return stateRecord?.updatedAt ? `Last checked ${new Date(stateRecord.updatedAt).toLocaleString()}.` : "";
  }
  return resultsSummary(results, stateRecord);
}

function scheduleTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "time unavailable";
}

function policyDuration(milliseconds) {
  const minutes = milliseconds / 60_000;
  const amount = minutes >= 1440 ? minutes / 1440 : minutes >= 60 ? minutes / 60 : minutes;
  const unit = minutes >= 1440 ? "day" : minutes >= 60 ? "hour" : "minute";
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
}

function renderAutomaticPolicy(policy) {
  const backoffs = Array.isArray(policy?.failureBackoffMs) ? policy.failureBackoffMs : [];
  const values = [policy?.dailyRunLimit, policy?.firstRunDelayMinutes, policy?.attentionPeriodMinutes,
    policy?.steadyPeriodMinutes, policy?.passBackoffMs, policy?.helpBackoffMs, ...backoffs];
  const valid = policy?.schemaVersion === 1 && policy.dayBoundary === "UTC"
    && Array.isArray(policy.failureBackoffMs) && policy.failureBackoffMs.length
    && values.every(value => Number.isFinite(value) && value > 0);
  $("#automaticCheckPolicy").textContent = valid
    ? `Up to ${policy.dailyRunLimit} automatic runs per UTC day. The first scheduled review is after ${policyDuration(policy.firstRunDelayMinutes * 60_000)}. Reviews repeat every ${policyDuration(policy.attentionPeriodMinutes * 60_000)} when stores need attention, or ${policyDuration(policy.steadyPeriodMinutes * 60_000)} otherwise. Passing stores wait at least ${policyDuration(policy.passBackoffMs)}; repeated failures wait ${policy.failureBackoffMs.map(policyDuration).join(", ")}. Checks needing your help wait ${policyDuration(policy.helpBackoffMs)} unless setup changes. Manual checks bypass these waits and the daily limit.`
    : "The check policy is unavailable. Refresh the schedule or update the Chrome companion.";
}

function renderLaneSchedules() {
  for (const row of document.querySelectorAll("[data-reverify-retailer]")) {
    let label = row.querySelector(".automatic-lane-schedule");
    if (!label) { label = document.createElement("small"); label.className = "automatic-lane-schedule"; row.firstElementChild.append(label); }
    const lane = automaticSchedule?.lanes?.find(item => item.retailerId === row.dataset.reverifyRetailer);
    let next = !lane ? "Schedule unavailable."
      : lane.state === "off" ? "Automatic checks off."
      : lane.state === "current" ? "No automatic check needed."
      : lane.state === "blocked" ? `Waiting: ${resultReason(lane.reasonCode, lane.retailerId)}.`
      : lane.state === "eligible" ? "Eligible now."
      : `${lane.reasonCode === "automatic_check_daily_cap" ? "Daily limit reached. " : ""}Eligible after ${scheduleTime(lane.eligibleAt)}.`;
    if (lane?.lastCheckedAt) next = `Last check: ${scheduleTime(lane.lastCheckedAt)}. ${next}`;
    label.textContent = next;
  }
}

function renderAutomaticSchedule(response) {
  automaticSchedule = response.schedule?.schemaVersion === 1 ? response.schedule : null;
  renderAutomaticPolicy(response.policy);
  const schedule = automaticSchedule;
  const text = !schedule ? "Schedule unavailable. Refresh to try again."
    : schedule.running ? "A store check is running. Turning automatic checks off prevents future automatic runs."
    : !schedule.enabled ? "Automatic checks off. Manual checks are still available."
    : schedule.reason === "plan_unavailable" ? "The current store plan could not load. Refresh to try again."
    : schedule.nextEligibleAt ? `${Date.parse(schedule.nextEligibleAt) <= Date.parse(schedule.computedAt) ? "A store is eligible now." : `Next eligible check: ${scheduleTime(schedule.nextEligibleAt)}.`} ${schedule.nextReviewAt ? `Next scheduled review: ${scheduleTime(schedule.nextReviewAt)}. Chrome may delay it.` : "The next scheduled review is unavailable."}`
    : "No store is currently eligible. See each store's status below.";
  $("#automaticCheckSchedule").textContent = schedule?.enabled && response.policy?.dailyRunLimit
    ? `${text} ${schedule.runsToday} of ${response.policy.dailyRunLimit} automatic runs used; the daily count resets ${scheduleTime(schedule.resetAt)}.` : text;
  renderLaneSchedules();
}

async function renderAutomaticReverification({ preserveResult = false } = {}) {
  const sequence = ++automaticStatusSequence;
  const toggle = $("#autoReverification");
  const button = $("#checkNeededStores");
  const result = $("#automaticCheckResult");
  const response = await chrome.runtime.sendMessage({ type: "yoink:get-auto-reverification" }).catch(() => null);
  if (sequence !== automaticStatusSequence || automaticSettingsPending || manualReverificationPending) return;
  if (!response?.ok) {
    toggle.disabled = true;
    button.disabled = true;
    result.textContent = "Automatic checks are unavailable.";
    renderAutomaticSchedule({});
    return;
  }
  toggle.disabled = false;
  toggle.checked = response.settings?.enabled === true;
  button.disabled = response.schedule?.running === true;
  if (!preserveResult) result.textContent = automaticResultText(response);
  renderAutomaticSchedule(response);
}

$("#autoReverification").addEventListener("change", async (event) => {
  const toggle = event.currentTarget;
  const enabled = toggle.checked;
  automaticSettingsPending = true;
  automaticStatusSequence += 1;
  toggle.disabled = true;
  $("#automaticCheckResult").textContent = enabled ? "Enabling automatic checks…" : "Turning automatic checks off…";
  const response = await chrome.runtime.sendMessage({
    type: "yoink:set-auto-reverification",
    enabled
  }).catch(() => null);
  automaticSettingsPending = false;
  // Discard reads started during this write even if they arrive after it.
  automaticStatusSequence += 1;
  toggle.checked = response?.ok ? enabled : !enabled;
  $("#automaticCheckResult").textContent = response?.ok
    ? enabled ? "Automatic checks enabled." : "Automatic checks off."
    : response?.message || "The setting could not be changed.";
  toggle.disabled = false;
  if (response?.ok) await renderAutomaticReverification({ preserveResult: true });
});

$("#checkNeededStores").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  manualReverificationPending = true;
  automaticStatusSequence += 1;
  button.disabled = true;
  $("#automaticCheckResult").textContent = "Checking candidate products without adding…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "yoink:run-auto-reverification" });
    if (!response?.ok) throw new Error(response?.message || "Store checks could not run.");
    $("#automaticCheckResult").textContent = automaticResultText(response);
    await renderReverificationPlan();
  } catch (error) {
    $("#automaticCheckResult").textContent = error instanceof Error ? error.message : "Store checks could not run.";
  } finally {
    manualReverificationPending = false;
    await renderAutomaticReverification({ preserveResult: true });
  }
});

$("#openYoink").href = PopupState.appDestinationUrl(runtime.appOrigin, "dashboard");
$("#laneReadinessRetry").addEventListener("click", () => { void renderReverificationPlan(); });
$("#refreshAutomaticSchedule").addEventListener("click", () => { void renderAutomaticReverification(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void renderAutomaticReverification();
});
setInterval(() => {
  if (document.visibilityState === "visible" && !automaticSettingsPending && !manualReverificationPending) void renderAutomaticReverification();
}, 60_000);

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

await Promise.allSettled([renderHealth(), renderPermissions(), renderReverificationPlan(), renderAutomaticReverification()]);
