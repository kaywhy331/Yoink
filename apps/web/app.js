const state = {
  snapshot: null,
  view: "overview",
  editingStrategyId: "",
  editingMission: null,
  settingsDirty: false,
  attributionDirty: false,
  identityDirty: false,
  observerRecipeDirty: false,
  editingOperatorAlertRuleId: "",
  editingOperatorAlertConnectorId: "",
  operationalTelemetry: null,
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
  signalItems: [],
  signalTotal: 0,
  signalQuery: "",
  jobItems: [],
  jobTotal: 0,
  jobQuery: "",
  authorizationUsers: [],
  authorizationRoles: []
};
const COLLECTION_PAGE_SIZE = 200;
const RETAILER_NAMES = Object.freeze({
  target: "Target", walmart: "Walmart", amazon: "Amazon", bestbuy: "Best Buy",
  disney: "Disney Store", ravensburger: "Ravensburger", riot: "Riot Games Merch",
  booksamillion: "Books-A-Million", fanatics: "Fanatics", kohls: "Kohl's", macys: "Macy's",
  pbandai: "Premium Bandai", pokemoncenter: "Pokémon Center"
});
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function retailerName(value) {
  const id = String(value || "");
  return RETAILER_NAMES[id] || `${id.slice(0, 1).toUpperCase()}${id.slice(1)}` || "Unknown retailer";
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
  if (!response.ok) throw new Error(payload.message || `Yoink request failed with HTTP ${response.status}.`);
  return payload;
}

let toastTimer;
function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 4200);
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

function statusDot(kind = "good") { return `<span class="status-dot ${kind}"></span>`; }
function empty(message) { return `<div class="empty">${escapeHtml(message)}</div>`; }

function setView(view) {
  state.view = view;
  $$("[data-view-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === view));
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderStatus() {
  const { settings, capabilities } = state.snapshot;
  const toggle = $("#actionsToggle");
  toggle.textContent = settings.actionsPaused ? "Actions paused" : "Actions enabled";
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
  toggle.title = toggle.disabled ? "Complete at least one retailer add-only qualification before enabling actions." : "Pause or resume qualified action jobs.";
  $("#modeChip").textContent = `${settings.executionMode[0].toUpperCase()}${settings.executionMode.slice(1)} mode`;
  $("#heroStatus").innerHTML = `
    <div class="hero-status-row"><span>${statusDot("good")} Local control plane</span><strong>Ready</strong></div>
    <div class="hero-status-row"><span>${statusDot(settings.actionsPaused ? "warning" : "good")} Actions</span><strong>${settings.actionsPaused ? "Paused" : "Enabled"}</strong></div>
    <div class="hero-status-row"><span>${statusDot("good")} Signal engine</span><strong>Listening</strong></div>
    <div class="hero-status-row"><span>${statusDot(state.snapshot.trackalacker?.ready ? "good" : "warning")} TrackaLacker push</span><strong>${state.snapshot.trackalacker?.ready ? "Connected" : "Not connected"}</strong></div>
    <div class="hero-status-row"><span>${statusDot(state.snapshot.counts.onlineDevices ? "good" : "warning")} Chrome companion</span><strong>${state.snapshot.counts.onlineDevices ? "Online" : "Not paired"}</strong></div>
    <div class="hero-status-row"><span>${statusDot(capabilities.targetReadOnlyShadow ? "good" : "warning")} Target shadow observer</span><strong>${capabilities.targetReadOnlyShadow ? "Read only" : "Unavailable"}</strong></div>
    <div class="hero-status-row"><span>${statusDot(targetActive ? "good" : "warning")} Target add-only</span><strong>${targetActive ? "Active" : targetQualified ? "Qualified · paused" : "Gate closed"}</strong></div>
    <div class="hero-status-row"><span>${statusDot(walmartActive ? "good" : "warning")} Walmart add-only</span><strong>${walmartActive ? "Active" : walmartQualified ? "Qualified · paused" : "Gate closed"}</strong></div>
    <div class="hero-status-row"><span>${statusDot(amazonActive ? "good" : "warning")} Amazon add-only</span><strong>${amazonActive ? "Active" : amazonQualified ? "Qualified · paused" : "Gate closed"}</strong></div>
    <div class="hero-status-row"><span>${statusDot(bestBuyActive ? "good" : "warning")} Best Buy add-only</span><strong>${bestBuyActive ? "Active" : bestBuyQualified ? "Qualified · paused" : "Gate closed"}</strong></div>`;
  const activeStores = [targetActive ? "Target" : "", walmartActive ? "Walmart" : "", amazonActive ? "Amazon" : "", bestBuyActive ? "Best Buy" : ""].filter(Boolean);
  $("#safetyTitle").textContent = activeStores.length ? `Guarded ${activeStores.join(" and ")} adds are active` : "Qualification-gated execution";
  $("#safetyCopy").textContent = activeStores.length
    ? `Chrome may add one exact first-party shipping item at ${activeStores.join(" or ")} to a provably empty cart after fresh seller, price, stock, and fulfillment checks. Checkout and ordering remain disabled.`
    : "Target, Walmart, Amazon, and Best Buy add-only lanes remain independently closed until their live evidence, no-click rehearsal, and explicit activation gates are complete.";
  const executorKind = targetActive || walmartActive || amazonActive || bestBuyActive ? "good" : "warning";
  const targetState = targetActive ? "Target active" : targetQualified ? "Target qualified · paused" : "Target closed";
  const walmartState = walmartActive ? "Walmart active" : walmartQualified ? "Walmart qualified · paused" : "Walmart closed";
  const amazonState = amazonActive ? "Amazon active" : amazonQualified ? "Amazon qualified · paused" : "Amazon closed";
  const bestBuyState = bestBuyActive ? "Best Buy active" : bestBuyQualified ? "Best Buy qualified · paused" : "Best Buy closed";
  $("#targetExecutorStatus").innerHTML = `<span class="status-dot ${executorKind}"></span><strong>${targetState} · ${walmartState} · ${amazonState} · ${bestBuyState}</strong>`;
}

function renderMetrics() {
  const counts = state.snapshot.counts;
  const metrics = [
    ["Variants", counts.variants, "One exact product intent"],
    ["Listings", counts.listings, `${counts.catalogOnlyListings} catalog-only`],
    ["Missions", counts.missions, "Retailer routes grouped"],
    ["Signals", counts.signals, `${counts.openIncidents} open incidents`],
    ["Action jobs", counts.actionJobs, `${counts.pendingNotifications || 0} notifications pending`],
    ["Spend ledger", counts.ledgerEntries || 0, `${counts.activeReservations || 0} active reservations`],
    ["Source products", state.snapshot.trackalacker?.mappedProducts || 0, `${state.snapshot.trackalacker?.candidateListings || 0} source listings captured`]
  ];
  $("#metricGrid").innerHTML = metrics.map(([label, value, note]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${Number(value || 0).toLocaleString()}</strong><small>${escapeHtml(note)}</small></article>`).join("");
}

function renderReadinessGuide() {
  const snapshot = state.snapshot;
  const capabilities = snapshot.capabilities || {};
  const trackalacker = snapshot.trackalacker || {};
  const counts = snapshot.counts || {};
  const purchaseStrategies = (snapshot.strategies || []).filter((strategy) => strategy.enabled && strategy.action !== "notify");
  const checks = [
    {
      label: "Chrome companion",
      done: Number(counts.onlineDevices || 0) > 0,
      detail: Number(counts.onlineDevices || 0) > 0 ? "Paired and online" : "Pair Chrome with one code",
      view: "connections"
    },
    {
      label: "TrackaLacker push",
      done: trackalacker.ready === true,
      detail: trackalacker.ready === true ? "Receiving without stock polling" : "Connect once from the extension",
      view: "connections"
    },
    {
      label: "Followed library",
      done: Number(trackalacker.mappedProducts || 0) > 0,
      detail: Number(trackalacker.mappedProducts || 0) > 0
        ? `${Number(trackalacker.mappedProducts).toLocaleString()} products mapped`
        : "Run one full followed-library sync",
      view: "library"
    },
    {
      label: "Signal strategy",
      done: (snapshot.strategies || []).some((strategy) => strategy.enabled),
      detail: purchaseStrategies.length
        ? `${purchaseStrategies.length} purchase rule${purchaseStrategies.length === 1 ? "" : "s"} enabled`
        : "Catchall notifications active; add a purchase rule when ready",
      view: "strategies"
    },
    {
      label: "Guarded Target action",
      done: capabilities.targetAddMutationAuthorized === true && snapshot.settings.actionsPaused !== true,
      detail: capabilities.targetAddMutationAuthorized !== true
        ? "Qualification or activation still closed"
        : snapshot.settings.actionsPaused ? "Qualified, but globally paused" : "Add-only execution active",
      view: "connections"
    },
    {
      label: "Guarded Walmart action",
      done: capabilities.walmartAddMutationAuthorized === true && snapshot.settings.actionsPaused !== true,
      detail: capabilities.walmartAddMutationAuthorized !== true
        ? "Qualification or activation still closed"
        : snapshot.settings.actionsPaused ? "Qualified, but globally paused" : "Add-only execution active",
      view: "connections"
    },
    {
      label: "Guarded Amazon action",
      done: capabilities.amazonAddMutationAuthorized === true && snapshot.settings.actionsPaused !== true,
      detail: capabilities.amazonAddMutationAuthorized !== true
        ? "Qualification or activation still closed"
        : snapshot.settings.actionsPaused ? "Qualified, but globally paused" : "Add-only execution active",
      view: "connections"
    },
    {
      label: "Guarded Best Buy action",
      done: capabilities.bestBuyAddMutationAuthorized === true && snapshot.settings.actionsPaused !== true,
      detail: capabilities.bestBuyAddMutationAuthorized !== true
        ? "Qualification or activation still closed"
        : snapshot.settings.actionsPaused ? "Qualified, but globally paused" : "Add-only execution active",
      view: "connections"
    }
  ];
  const intakeReady = checks[0].done && checks[1].done;
  const automaticReady = intakeReady && (checks[4].done || checks[5].done || checks[6].done || checks[7].done) && purchaseStrategies.length > 0;
  $("#readinessGate").textContent = automaticReady ? "AUTO READY" : intakeReady ? "SIGNALS READY" : "SETUP NEEDED";
  $("#readinessSummary").textContent = automaticReady
    ? "Real signals can resolve into a guarded Target, Walmart, Amazon, or Best Buy add job when your first matching strategy qualifies them."
    : intakeReady
      ? "Real signals can flow now. Notifications work; purchase actions remain bounded by independent retailer gates and your ordered strategies."
      : "Complete the first unfinished item below. No separate Signals start switch is required.";
  $("#readinessGuide").innerHTML = checks.map((check) => `<article class="readiness-step ${check.done ? "done" : ""}">
    <span class="readiness-mark">${check.done ? "✓" : "○"}</span><div><h3>${escapeHtml(check.label)}</h3><p>${escapeHtml(check.detail)}</p></div><button class="text-button" data-open-view="${escapeHtml(check.view)}" type="button">${check.done ? "Review" : "Set up"}</button>
  </article>`).join("");
}

function signalMarkup(signal) {
  const decision = signal.missionDecision || signal.resolutionStatus || "recorded";
  const kind = ["qualified", "corroborated"].includes(decision) ? "good" : ["test_signal", "actions_paused", "needs_price"].includes(decision) ? "warning" : "";
  return `<article class="timeline-item">
    ${statusDot(kind || "warning")}
    <div><h3>${escapeHtml(signal.title || signal.signalId || "Unresolved signal")}</h3>
      <p>${escapeHtml(signal.retailerId || "Unknown retailer")} · ${escapeHtml(signal.retailerSku || "No exact SKU")} · ${formatMoney(signal.unitPriceCents, signal.currency || "USD")}</p>
      <span class="decision-pill">${escapeHtml(decision.replaceAll("_", " "))}</span>
      <p>${escapeHtml(signal.missionReason || signal.resolutionReason || "Recorded")}</p>
    </div><time>${escapeHtml(relativeTime(signal.observedAt))}</time>
  </article>`;
}

function renderSignals() {
  const signals = state.signalItems;
  $("#recentSignals").innerHTML = signals.length ? signals.slice(0, 6).map(signalMarkup).join("") : empty("No signals received yet. Send a dry-run signal to exercise the pipeline.");
  $("#signalList").innerHTML = signals.length ? signals.map(signalMarkup).join("") : empty("No opportunities yet.");
  $("#signalCount").textContent = `${signals.length.toLocaleString()} of ${Number(state.signalTotal || 0).toLocaleString()} matching opportunities`;
  $("#signalMoreButton").hidden = signals.length >= state.signalTotal;
}

function renderSources() {
  const sources = state.snapshot.sources || [];
  const rows = sources.map((source) => `<div class="status-row"><span>${statusDot(source.status === "connected" ? "good" : "warning")} ${escapeHtml(source.name)}</span><small>${escapeHtml(source.status)}</small></div>`).join("");
  $("#sourceSummary").innerHTML = rows || empty("No source connections configured.");
  $("#connectionList").innerHTML = sources.map((source) => {
    const signals = Number(source.signalCount || 0);
    const matchRate = source.matchRatePercent == null ? "No reliability sample" : `${Number(source.matchRatePercent).toFixed(Number(source.matchRatePercent) % 1 ? 1 : 0)}% exact identity`;
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(source.name)}</h3><p>${escapeHtml(source.source)} · ${escapeHtml(source.trustLevel)}</p></div>${statusDot(source.status === "connected" ? "good" : "warning")}</div><div class="card-meta"><span class="tag ${source.autoCreateMissions ? "good" : ""}">${source.autoCreateMissions ? "Can create missions" : "Existing missions only"}</span><span class="tag">${signals.toLocaleString()} real signals</span><span class="tag ${signals && Number(source.matchRatePercent) === 100 ? "good" : ""}">${escapeHtml(matchRate)}</span><span class="tag">${Number(source.corroboratedSignalCount || 0).toLocaleString()} corroborated</span><span class="tag">${Number(source.unresolvedSignalCount || 0).toLocaleString()} unresolved</span><span class="tag">${escapeHtml(source.lastEventAt ? relativeTime(source.lastEventAt) : "No events")}</span></div></article>`;
  }).join("") || empty("No connections configured.");
  const options = sources.map((source) => `<option value="${escapeHtml(source.id)}" data-source="${escapeHtml(source.source)}">${escapeHtml(source.name)}</option>`).join("");
  $("#listingSourceConnection").innerHTML = options;
  $("#signalSourceConnection").innerHTML = options;
  if (!$("#strategyDialog").open) {
    $("#strategySourceOptions").innerHTML = sources.map((source) => `<label class="check-label"><input data-strategy-source type="checkbox" value="${escapeHtml(source.source)}"><span>${escapeHtml(source.name)}</span></label>`).join("");
  }
  const trackalacker = state.snapshot.trackalacker || {};
  const trackalackerReady = trackalacker.ready === true;
  $("#trackalackerGate").textContent = trackalackerReady ? "CONNECTED" : String(trackalacker.state || "NOT CONNECTED").replaceAll("_", " ").toUpperCase();
  $("#trackalackerConnectionStatus").innerHTML = `<span class="status-dot ${trackalackerReady ? "good" : trackalacker.state === "error" ? "bad" : "warning"}"></span><strong>${trackalackerReady ? "Chrome is receiving TrackaLacker push" : trackalacker.state === "error" ? "Connection needs attention" : "Open the Yoink extension to connect"}</strong>`;
  const latest = trackalacker.devices?.[0];
  $("#trackalackerConnectionDetail").textContent = trackalackerReady
    ? `${Number(trackalacker.mappedProducts || 0).toLocaleString()} followed products and ${Number(trackalacker.candidateListings || 0).toLocaleString()} source listings are mapped. ${latest?.lastNotificationAt ? `Last push ${relativeTime(latest.lastNotificationAt)}.` : "Waiting for the first real push."}`
    : "The extension registers as “Desktop - Windows - Chrome.” Subscription keys remain inside the enrollment request and are never stored by Yoink.";
  const syncRuns = trackalacker.syncRuns || [];
  $("#trackalackerSyncRuns").innerHTML = syncRuns.length ? syncRuns.slice(0, 5).map((run) => {
    const kind = run.phase === "complete" ? "good" : run.phase === "error" ? "bad" : "warning";
    return `<article class="sync-run"><div><strong>${statusDot(kind)} Library sync · ${escapeHtml(String(run.phase).replaceAll("_", " "))}</strong><p>${Number(run.imported || 0).toLocaleString()} imported · ${Number(run.failed || 0).toLocaleString()} failed · ${Number(run.itemReceiptCount || 0).toLocaleString()} durable item receipts</p></div><time>${escapeHtml(relativeTime(run.updatedAt))}</time></article>`;
  }).join("") : "";
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
    return `<article class="device-row"><div><h3>${statusDot(device.online ? "good" : device.status === "revoked" ? "bad" : "warning")} ${escapeHtml(device.name)}</h3><p>${escapeHtml(device.platform || "Chrome")} · extension ${escapeHtml(device.extensionVersion || "unknown")} · ${escapeHtml(transport)} · ${escapeHtml(device.lastSeenAt ? `seen ${relativeTime(device.lastSeenAt)}` : "never seen")} · ${escapeHtml(credentialState)}</p></div>${device.status === "active" ? `<button class="button danger" data-device-revoke="${escapeHtml(device.id)}" type="button">Revoke</button>` : '<span class="tag bad">Revoked</span>'}</article>`;
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
    return `<article class="retailer-readiness-card"><h3>${statusDot(item.observationCount ? "good" : "warning")} ${escapeHtml(name)}</h3><p>${escapeHtml(mode)} · ${Number(item.observationCount || 0).toLocaleString()} observations · ${Number(item.distinctSkuCount || 0).toLocaleString()} SKUs<br>${Number(item.actionableCandidateCount || 0).toLocaleString()} complete candidates${escapeHtml(routeEvidence)} · ${item.latestObservedAt ? escapeHtml(`latest ${relativeTime(item.latestObservedAt)}`) : "none captured"}</p></article>`;
  }).join("");
  const observations = state.snapshot.shadowObservations || [];
  $("#targetShadowList").innerHTML = observations.length ? observations.map((observation) => {
    const kind = observation.observationState === "actionable_candidate" ? "good"
      : observation.observationState === "manual_block" ? "bad" : "warning";
    const routeTag = observation.retailerId === "amazon"
      ? `<span class="tag ${observation.purchaseRouteReady ? "good" : "warning"}">${observation.purchaseRouteReady ? "Offer binding verified" : escapeHtml(String(observation.routeReasonCode || "binding unavailable").replaceAll("_", " "))}</span>`
      : "";
    return `<article class="shadow-evidence-row">
      <div>${statusDot(kind)}<div><h3>${escapeHtml(retailerName(observation.retailerId))} · SKU ${escapeHtml(observation.retailerSku)}</h3><p>${escapeHtml(String(observation.availability).replaceAll("_", " "))} · ${formatMoney(observation.unitPriceCents, observation.currency)} · ${escapeHtml(observation.sellerName || "Seller unknown")} · ${escapeHtml(observation.fulfillment)}</p></div></div>
      <div class="shadow-evidence-meta"><span class="tag ${kind}">${escapeHtml(String(observation.observationState).replaceAll("_", " "))}</span>${routeTag}<time>${escapeHtml(relativeTime(observation.observedAt))}</time></div>
      <a class="canonical-link" href="${escapeHtml(observation.canonicalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(observation.canonicalUrl)}</a>
    </article>`;
  }).join("") : empty("No retailer page has been inspected yet. Open an exact product page and use the extension’s read-only inspection button.");
}

function renderAdapterRepairQueue() {
  const queue = state.snapshot.adapterRepairQueue || [];
  const open = Number(state.snapshot.counts.openAdapterRepairGroups || 0);
  const recovered = Number(state.snapshot.counts.recoveredAdapterRepairGroups || 0);
  const events = Number(state.snapshot.counts.adapterDiagnosticEvents || 0);
  const gate = $("#adapterRepairGate");
  gate.textContent = open ? `${open} OPEN` : events ? "MONITORING" : "CLEAR";
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
      return `<div class="card-meta"><span class="tag">${escapeHtml(observerFieldName(suggestion.field))}</span><span class="tag ${ready ? "warning" : ""}">${ready ? "Ready for candidate evaluation" : "Collecting evidence"}</span><span class="tag">never auto-promoted</span><span class="tag">non-executable</span><code>${escapeHtml(suggestion.selector || "")}</code><span>${Number(suggestion.distinctDeviceCount || 0).toLocaleString()}/${Number(suggestion.minimumDeviceCount || 3).toLocaleString()} devices · ${Number(suggestion.distinctSkuCount || 0).toLocaleString()}/${Number(suggestion.minimumSkuCount || 2).toLocaleString()} exact SKUs</span></div>`;
    }).join("");
    return `<article class="adapter-repair-row ${isOpen ? "open" : "recovered"}">
      <div>${statusDot(isOpen ? "bad" : "good")}<div><h3>${escapeHtml(retailer)} · ${escapeHtml(operation)} · ${escapeHtml(item.latestRetailerSku || "unknown SKU")}</h3><p>${escapeHtml(stage)} · ${escapeHtml(reason)} · layout ${escapeHtml(fingerprint || "unknown")}</p></div></div>
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
  gate.textContent = latest?.outcome === "passed" ? "VERIFIED · READ ONLY"
    : latest ? `${String(latest.outcome).toUpperCase()} · READ ONLY` : "NOT SCANNED";
  gate.classList.toggle("danger", ["failed", "manual"].includes(latest?.outcome));
  $("#walmartDrawSummary").innerHTML = `<strong>${items.length.toLocaleString()} current drawing${items.length === 1 ? "" : "s"}</strong><span>${Number(state.snapshot.counts.walmartDrawScans || 0).toLocaleString()} scans · ${failures.toLocaleString()} blocked/failed · entry mutation closed</span>`;
  $("#walmartDrawList").innerHTML = items.length ? items.map((item) => {
    const kind = item.drawState === "active" && item.closesAt ? "good" : "warning";
    const limit = item.orderMaxLimit ? ` · limit ${Number(item.orderMaxLimit)}` : "";
    return `<article class="shadow-evidence-row">
      <div>${statusDot(kind)}<div><h3>Walmart item ${escapeHtml(item.retailerSku)} · ${escapeHtml(item.title)}</h3><p>${formatMoney(item.unitPriceCents, item.currency)} · ${escapeHtml(item.sellerName || "seller unknown")} · condition group ${escapeHtml(item.conditionGroupCode ?? "unknown")}${escapeHtml(limit)}</p></div></div>
      <div class="shadow-evidence-meta"><span class="tag ${kind}">${escapeHtml(String(item.drawState).replaceAll("_", " "))}</span><span class="tag ${item.tracked ? "good" : "warning"}">${item.tracked ? `Matched plan · ${escapeHtml(item.missionStatus || "tracked")}` : "No exact plan match"}</span><time>${item.closesAt ? `closes ${escapeHtml(relativeTime(item.closesAt))}` : "close unknown"}</time></div>
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
    return `<article class="community-evidence-row"><div class="card-top"><div><h3>${escapeHtml(retailerName(item.retailerId))} · ${escapeHtml(item.retailerSku)}</h3><p>${escapeHtml(String(item.availability || "unknown").replaceAll("_", " "))} · ${escapeHtml(projectedPrice)} · ${escapeHtml(item.sellerName || "Seller unknown")} · ${escapeHtml(item.fulfillment || "unknown")}</p></div><span class="tag ${kind}">${escapeHtml(stateLabel)}</span></div><div class="card-meta"><span class="tag">${escapeHtml(communitySelectedOfferLabel(item))}</span><span class="tag">${Number(item.currentContributorVoteCount || 0)} current votes</span><span class="tag">${Number(item.independentDeviceCount || 0)} devices</span>${superseded ? `<span class="tag">${superseded} superseded</span>` : ""}<span class="tag">Observed range ${escapeHtml(priceRange)}</span><span class="tag">Availability ${Math.round(Number(confidence.availability || 0) * 100)}%</span><span class="tag">Price ${Math.round(Number(confidence.price || 0) * 100)}%</span><span class="tag">Expires ${escapeHtml(relativeTime(item.expiresAt))}</span></div></article>`;
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
    return `<article class="community-evidence-row"><div class="card-top"><div><h3>${escapeHtml(retailerName(item.listingRetailerId))} ${escapeHtml(item.listingRetailerSku)} ↔ ${escapeHtml(retailerName(item.referenceRetailerId))} ${escapeHtml(item.referenceRetailerSku)}</h3><p>${escapeHtml(String(item.identifierKind).toUpperCase())} fingerprint ${escapeHtml(String(item.identifierHash).slice(0, 12))} · ${Number(item.independentUserCount || 0)} users · ${Number(item.healthyPairedDeviceCount || 0)} healthy paired devices</p></div><span class="tag ${kind}">${escapeHtml(String(item.publicationState).replaceAll("_", " "))}</span></div><div class="card-meta"><span class="tag ${item.siblingAvailabilityEligible ? "good" : "warning"}">${item.siblingAvailabilityEligible ? "Sibling evidence eligible" : "No sibling stock merge"}</span><span class="tag">Catalog remapped: never</span></div></article>`;
  }).join("") : empty("No cross-store identity projections. Inventory remains attached to each exact retailer listing.");
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
      ? `Next gate: 2 contributor-deduplicated clean passes on 2 exact SKUs${generated ? ", with 2 tenant contributors/devices and every field confirmed by the packaged oracle" : ""}.`
      : nextState === "trusted_read_only" && !promotionReady
        ? `Next gate: a clean 24-hour canary, 5 deduplicated passes, and 3 canary passes on 3 exact SKUs and 2 layouts${generated ? ", including 3 tenant contributors/devices with every field oracle-complete" : ""}.`
        : "";
    return `<article class="community-evidence-row"><div class="card-top"><div><h3>${escapeHtml(retailerName(recipe.retailerId))} · ${escapeHtml(recipe.recipeVersion)}</h3><p>${Object.keys(recipe.fields || {}).length} fields (${escapeHtml(fieldNames)}) · ${selectorCount} bounded selectors · minimum extension ${escapeHtml(recipe.minimumExtensionVersion)} · expires ${escapeHtml(relativeTime(recipe.expiresAt))}</p></div><span class="tag ${kind}">${escapeHtml(String(recipe.lifecycleState).replaceAll("_", " "))}</span></div><div class="card-meta">${generated ? `<span class="tag warning">worker-generated candidate</span><span class="tag ${oracleComplete ? "good" : "warning"}">${oracleComplete} deduplicated oracle passes</span><span class="tag ${oracleContributors >= 2 ? "good" : "warning"}">${oracleContributors} tenant contributors</span><span class="tag">public anti-Sybil quorum pending</span>` : ""}<span class="tag">${cohortPassed} deduplicated passes</span><span class="tag ${Number(trials.failed || 0) ? "bad" : ""}">${Number(trials.failed || 0)} raw failures</span><span class="tag">${cohortSkus} SKUs</span><span class="tag">${cohortLayouts} layouts</span>${recipe.lifecycleState === "canary" ? `<span class="tag ${burnInReady ? "good" : "warning"}">${Math.floor(canaryAgeSeconds / 3_600)}h / 24h canary</span><span class="tag">25% deterministic cohort</span>` : ""}<span class="tag ${packagedConflicts ? "bad" : ""}">${packagedConflicts} packaged conflicts</span><span class="tag ${oracleConflicts ? "bad" : ""}">${oracleConflicts} oracle conflicts</span><span class="tag ${regionalSloKind}">Regional SLO: ${escapeHtml(regionalSloState.replaceAll("_", " "))}</span><span class="tag">${Number(regionalSlo.eligibleTrials || 0)} eligible trials</span><span class="tag">${Number(regionalSlo.distinctEligibleAccounts || 0)} eligible accounts · ${Number(regionalSlo.distinctEligibleRegions || 0)} regions</span><span class="tag">Fingerprint ${escapeHtml(String(recipe.recipeFingerprint).slice(0, 12))}</span><span class="tag ${needsResign ? "bad" : ""}">Root G${Number(recipe.trustManifestGeneration || 0)}</span>${recipe.rollbackRecipeId ? `<span class="tag">Rollback ${escapeHtml(String(recipe.rollbackRecipeId).slice(0, 12))}</span>` : ""}</div>${generated ? '<p class="fine-print">Compiled from thresholded structural landmarks only. Promotion counts only the latest result per tenant contributor, exact SKU, layout, and stage. Canary delivery is deterministic and bounded; packaged conflicts and a multi-contributor regression SLO auto-kill distribution. The regional conflict SLO separately requires fresh external account/device eligibility across multiple coarse regions. Recipe field-fill and all mutation authority remain closed.</p>' : ""}${promotionHint ? `<p class="fine-print">${escapeHtml(promotionHint)}</p>` : ""}<div class="card-actions">${needsResign && trust.signingReady ? `<button class="button secondary" data-observer-resign="${escapeHtml(recipe.id)}" type="button">Re-sign at root G${generation}</button>` : ""}${nextState ? `<button class="button primary" data-observer-promote="${escapeHtml(recipe.id)}" data-observer-target="${escapeHtml(nextState)}" type="button" ${promotionReady ? "" : "disabled"}>Promote to ${escapeHtml(nextState.replaceAll("_", " "))}</button>` : ""}${recipe.lifecycleState !== "disabled" ? `<button class="button danger" data-observer-disable="${escapeHtml(recipe.id)}" type="button">Kill switch</button>` : ""}${recipe.rollbackRecipeId && recipe.lifecycleState !== "disabled" ? `<button class="button secondary" data-observer-rollback="${escapeHtml(recipe.id)}" type="button">Rollback</button>` : ""}</div>${recipe.disabledReason ? `<p class="identity-conflict">Disabled: ${escapeHtml(String(recipe.disabledReason).replaceAll("_", " "))}</p>` : ""}</article>`;
  }).join("") : empty("No declarative observer recipes. Bundled observer versions remain authoritative.");
  const contributorEligibility = registry.contributorEligibility || {};
  const conflictPolicy = registry.regionalConflictSlo || {};
  $("#observerConflictPolicy").textContent = `The ${Number(conflictPolicy.windowDays || 7)}-day SLO counts only the latest packaged-oracle trial per externally eligible account, exact SKU, layout, and stage. It needs ${Number(conflictPolicy.minimumEligibleTrials || 10)} trials from ${Number(conflictPolicy.minimumIndependentAccounts || 3)} accounts across ${Number(conflictPolicy.minimumRegions || 2)} coarse regions; a breach can only undistribute a read-only recipe. The production identity-risk provider is not configured in local mode.`;
  $("#observerEligibilitySummary").innerHTML = `<span class="tag">${Number(contributorEligibility.externallyAttestedDeviceCount || 0)} eligible devices</span><span class="tag">${Number(contributorEligibility.distinctExternallyAttestedAccounts || 0)} eligible accounts</span><span class="tag">${Number(contributorEligibility.distinctExternallyAttestedRegions || 0)} coarse regions</span><span class="tag">TTL ${Number(contributorEligibility.maximumTtlHours || 24)}h</span><span class="tag warning">Local identities never count as public quorum</span><span class="tag">Mutation authority: never</span>`;
  const recoveryEvidence = Array.isArray(registry.recoveryEvidence) ? registry.recoveryEvidence : [];
  const recoveryRetention = registry.recoveryEvidenceRetention || {};
  $("#observerRecoveryPolicy").textContent = `A row appears only when a signed recipe and the packaged structured-page oracle agree while the bundled observer is missing that field. Evidence and review events are automatically removed after ${Number(recoveryRetention.retentionDays || 90)} days without review activity; ${Number(recoveryRetention.receiptCount || 0).toLocaleString()} aggregate deletion receipt${Number(recoveryRetention.receiptCount || 0) === 1 ? " is" : "s are"} retained. Values and reviews are never applied to observations or actions.`;
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
  const label = active ? "Guarded adds active" : qualified ? "Qualified · paused" : evidenceReady ? "Ready for explicit activation" : liveReady ? "Ready for no-click rehearsal" : "Collecting required evidence";
  const kind = active || qualified || evidenceReady || liveReady ? "good" : "warning";
  $(`#${prefix}QualificationSummary`).innerHTML = `<div>
      <span class="tag ${kind}">${escapeHtml(label)}</span>
      <strong>${Number(readiness.observationCount || 0).toLocaleString()} current observations · ${Number(readiness.distinctSkuCount || 0).toLocaleString()} distinct ${identifiers[retailerId]}</strong>
    </div>
    <p>${escapeHtml(readiness.nextStep || "Collect read-only evidence with the Chrome companion.")}</p>
    <small>Observer ${escapeHtml(readiness.adapterVersion || "unknown")} · runner ${escapeHtml(readiness.addAdapterVersion || "unknown")} · ${Number(readiness.evidenceWindowDays || 0)}-day evidence window</small>`;
  $(`#${prefix}QualificationGate`).textContent = active ? "ACTIVE" : qualified ? "PAUSED" : evidenceReady ? "READY" : "GATE CLOSED";
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
  const policy = state.snapshot.futureMutationLanes;
  const labels = { pickup_add: "Pickup add", prepare_checkout: "Prepare checkout", submit_order: "Submit order" };
  $("#futureMutationLaneList").innerHTML = policy?.lanes?.length ? policy.lanes.map((lane) => {
    const met = (lane.requirements || []).filter((requirement) => requirement.met).length;
    return `<article class="community-evidence-row"><div class="card-top"><div><h3>${escapeHtml(lane.retailerName)} · ${escapeHtml(labels[lane.lane] || lane.lane)}</h3><p>${met}/${(lane.requirements || []).length} prerequisites observed · no packaged adapter</p></div><span class="tag warning">CLOSED</span></div><details><summary>Qualification requirements</summary><div class="qualification-check-list">${(lane.requirements || []).map((requirement) => `<article class="qualification-check ${requirement.met ? "met" : "missing"}"><span class="qualification-check-mark" aria-hidden="true">${requirement.met ? "✓" : "○"}</span><div><h3>${escapeHtml(requirement.label)}</h3><p>${escapeHtml(requirement.detail)}</p></div></article>`).join("")}</div></details></article>`;
  }).join("") : empty("Future mutation-lane policy is unavailable; every lane remains closed.");
}

function renderLibrary() {
  const items = state.libraryItems;
  $("#libraryCount").textContent = `${items.length.toLocaleString()} of ${Number(state.libraryTotal || 0).toLocaleString()} matching listings`;
  $("#libraryMoreButton").hidden = items.length >= state.libraryTotal;
  $("#libraryList").innerHTML = items.length ? items.map((item) => `<article class="card"><div class="card-top"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.retailerName)} · ${escapeHtml(item.retailerSku)}</p></div>${statusDot(item.executionSupported ? "good" : "warning")}</div><div class="card-meta"><span class="tag ${item.status === "in_stock" ? "good" : ""}">${escapeHtml(String(item.status).replaceAll("_", " "))}</span><span class="tag">MSRP ${formatMoney(item.msrpCents, item.currency)}</span><span class="tag ${item.executionSupported ? "good" : "warning"}">${item.executionSupported ? "Executable mapping" : "Catalog only"}</span><span class="tag">${item.sourceMappingCount} source map</span><span class="tag">Variant ${escapeHtml(item.variantId)}</span><span class="tag">Listing ${escapeHtml(item.listingId)}</span></div><a class="canonical-link" href="${escapeHtml(item.canonicalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.canonicalUrl)}</a></article>`).join("") : empty("No matching retailer listings.");
}

function pricePolicyLabel(strategy) {
  const kind = strategy.pricePolicy.kind.replaceAll("_", " ");
  if (["absolute_max", "above_msrp"].includes(strategy.pricePolicy.kind)) return `${kind} · ${formatMoney(strategy.pricePolicy.maxPriceCents)}`;
  if (strategy.pricePolicy.kind === "slightly_above_msrp") return `${kind} · ${Number(strategy.pricePolicy.toleranceBps || 1000) / 100}%`;
  return kind;
}

function renderStrategies() {
  const strategies = state.snapshot.strategies || [];
  $("#strategyList").innerHTML = strategies.length ? strategies.map((strategy, index) => `<article class="strategy-row"><div class="strategy-rank">${index + 1}</div><div><h3>${escapeHtml(strategy.name)} ${strategy.enabled ? "" : "· Disabled"}</h3><p>${escapeHtml(pricePolicyLabel(strategy))} · ${escapeHtml(strategy.sellerPolicy.replaceAll("_", " "))} · ${escapeHtml(strategy.action.replaceAll("_", " "))} · qty ${escapeHtml(strategy.quantity)}</p><div class="card-meta"><span class="tag">${strategy.retailers.length ? escapeHtml(strategy.retailers.join(", ")) : "All retailers"}</span><span class="tag">${strategy.sources.length ? escapeHtml(strategy.sources.join(", ")) : "All sources"}</span>${!strategy.includeKeywords ? '<span class="tag warning">Catchall</span>' : `<span class="tag">${escapeHtml(strategy.includeKeywords)}</span>`}</div></div><div class="strategy-actions"><button class="button secondary" data-strategy-move="up" data-strategy-id="${escapeHtml(strategy.id)}" type="button">↑</button><button class="button secondary" data-strategy-move="down" data-strategy-id="${escapeHtml(strategy.id)}" type="button">↓</button><button class="button secondary" data-strategy-edit="${escapeHtml(strategy.id)}" type="button">Edit</button><button class="button danger" data-strategy-delete="${escapeHtml(strategy.id)}" type="button">Delete</button></div></article>`).join("") : empty("No strategies exist. Signals will be recorded without action.");
}

function renderMissions() {
  const missions = state.missionItems;
  $("#missionCount").textContent = `${missions.length.toLocaleString()} of ${Number(state.missionTotal || 0).toLocaleString()} matching missions`;
  $("#missionMoreButton").hidden = missions.length >= state.missionTotal;
  $("#missionList").innerHTML = missions.length ? missions.map((mission) => `<article class="card"><div class="card-top"><div><h3>${escapeHtml(mission.title)}</h3><p>${escapeHtml(mission.origin)} · created ${escapeHtml(relativeTime(mission.createdAt))}</p></div>${statusDot(mission.status === "active" ? "good" : "warning")}</div><div class="card-meta"><span class="tag ${mission.status === "active" ? "good" : "warning"}">${escapeHtml(mission.status)}</span><span class="tag">${mission.targetCount} listing targets</span><span class="tag">${mission.enabledTargetCount} enabled</span><span class="tag">Goal ${mission.targetQuantity}</span><span class="tag">Intent r${Number(mission.intentRevision || 1)} · ${escapeHtml(String(mission.actionCeiling || "add_to_cart").replaceAll("_", " "))}</span><span class="tag">${mission.decisionMode === "purchase_intent" ? "Reviewed plan decides" : "Strategy defaults decide"}</span></div><div class="card-actions"><button class="button secondary" data-mission-edit="${escapeHtml(mission.id)}" type="button">Edit mission</button></div></article>`).join("") : empty("No missions yet. An exact trusted live signal can create one automatically.");
}

function renderAudit() {
  const items = state.auditItems;
  $("#auditCount").textContent = `${items.length.toLocaleString()} of ${Number(state.auditTotal || 0).toLocaleString()} matching events`;
  $("#auditMoreButton").hidden = items.length >= state.auditTotal;
  $("#outboxSummary").textContent = `${Number(state.snapshot.counts.pendingOutboxEvents || 0).toLocaleString()} tenant event${Number(state.snapshot.counts.pendingOutboxEvents || 0) === 1 ? "" : "s"} retained locally`;
  $("#auditList").innerHTML = items.length ? items.map((event) => `<article class="timeline-item">
    ${statusDot(event.reasonCode === "error" || String(event.reasonCode).includes("rejected") ? "bad" : "good")}
    <div><h3>${escapeHtml(String(event.eventType).replaceAll("_", " "))}</h3><p>${escapeHtml(event.message)}</p><span class="decision-pill">${escapeHtml(String(event.reasonCode).replaceAll("_", " "))}</span><p>Correlation ${escapeHtml(event.correlationId)}</p></div>
    <time>${escapeHtml(relativeTime(event.createdAt))}</time>
  </article>`).join("") : empty("No matching activity has been recorded.");
}

function renderNotifications() {
  const notifications = state.snapshot.notifications || [];
  $("#notificationList").innerHTML = notifications.length ? notifications.map((notification) => {
    const kind = ["delivered", "clicked"].includes(notification.state) ? "good"
      : ["failed", "expired"].includes(notification.state) ? "bad" : "warning";
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(notification.title)}</h3><p>${escapeHtml(notification.retailerId)} · ${escapeHtml(notification.retailerSku)}</p></div>${statusDot(kind)}</div><div class="card-meta"><span class="tag ${kind}">${escapeHtml(String(notification.state).replaceAll("_", " "))}</span><span class="tag">${Number(notification.attempts || 0)} delivery attempt${Number(notification.attempts || 0) === 1 ? "" : "s"}</span>${notification.failureCode ? `<span class="tag bad">${escapeHtml(notification.failureCode.replaceAll("_", " "))}</span>` : ""}</div><p>${notification.deliveredAt ? `Delivered ${escapeHtml(relativeTime(notification.deliveredAt))}.` : `Created ${escapeHtml(relativeTime(notification.createdAt))}.`}</p></article>`;
  }).join("") : empty("No notification deliveries yet.");
}

function renderAttributionReceipts() {
  const receipts = state.snapshot.attributionReceipts || [];
  $("#attributionReceiptList").innerHTML = receipts.length ? receipts.map((receipt) => {
    const kind = receipt.outcome === "affiliate_route" ? "good"
      : receipt.outcome === "required_route_unavailable" ? "bad" : "warning";
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(receipt.title)}</h3><p>${escapeHtml(receipt.retailerId)} · ${escapeHtml(receipt.retailerSku)}</p></div>${statusDot(kind)}</div><div class="card-meta"><span class="tag ${kind}">${escapeHtml(String(receipt.outcome).replaceAll("_", " "))}</span><span class="tag">${escapeHtml(String(receipt.provider).replaceAll("_", " "))}</span><span class="tag">${escapeHtml(String(receipt.reasonCode).replaceAll("_", " "))}</span></div><a class="canonical-link" href="${escapeHtml(receipt.routeUrl)}" target="_blank" rel="noreferrer">Open recorded route</a></article>`;
  }).join("") : empty("No attribution receipts yet.");
}

function renderAttributionPolicies() {
  const container = $("#attributionPolicyEditors");
  if (!container || state.attributionDirty) return;
  const policies = state.snapshot.attributionPolicies || [];
  container.innerHTML = policies.map((policy) => `<article class="attribution-policy-editor" data-attribution-retailer="${escapeHtml(policy.retailerId)}">
    <div class="card-top"><div><h3>${escapeHtml(policy.retailerName)}</h3><p>${escapeHtml(policy.validationReason)}</p></div><span class="tag ${policy.valid ? "good" : "bad"}">${policy.valid ? "Configuration valid" : "Needs correction"}</span></div>
    <div class="form-grid">
      <label class="check-label"><input data-attribution-field="enabled" type="checkbox" ${policy.enabled ? "checked" : ""}><span>Affiliate route enabled</span></label>
      <label><span>Provider</span><select data-attribution-field="provider"><option value="canonical" ${policy.provider === "canonical" ? "selected" : ""}>Canonical retailer URL</option><option value="howl" ${policy.provider === "howl" ? "selected" : ""}>Howl</option><option value="amazon_associates" ${policy.provider === "amazon_associates" ? "selected" : ""}>Amazon Associates</option></select></label>
      <label><span>Howl publisher slug</span><input data-attribution-field="publisherSlug" value="${escapeHtml(policy.publisherSlug)}" placeholder="collectwithdodo"></label>
      <label><span>Public article base URL</span><input data-attribution-field="articleBaseUrl" type="url" value="${escapeHtml(policy.articleBaseUrl)}" placeholder="https://yourdomain.com/products/"></label>
      <label><span>Amazon Associate tag</span><input data-attribution-field="associateTag" value="${escapeHtml(policy.associateTag)}" placeholder="your-tag-20"></label>
    </div>
  </article>`).join("");
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
      : "This job remains recorded until a qualified executor can safely handle its exact scope.";
    return `<article class="card"><div class="card-top"><div><h3>${escapeHtml(job.title)}</h3><p>${escapeHtml(job.retailerId)} · ${escapeHtml(job.retailerSku)}</p></div>${statusDot(kind)}</div><div class="card-meta"><span class="tag ${kind}">${escapeHtml(String(job.state).replaceAll("_", " "))}</span><span class="tag">${escapeHtml(String(job.action).replaceAll("_", " "))}</span><span class="tag">Qty ${job.quantity}</span><span class="tag">Unit cap ${formatMoney(job.maxUnitPriceCents, job.currency)}</span><span class="tag">Total cap ${formatMoney(job.maxOrderTotalCents, job.currency)}</span><span class="tag">${escapeHtml(job.sellerPolicy.replaceAll("_", " "))}</span><span class="tag">${escapeHtml(String(job.attributionProvider || "canonical").replaceAll("_", " "))}</span></div><p>Expires ${escapeHtml(relativeTime(job.expiresAt))}. ${escapeHtml(note)}</p>${needsReview ? `<div class="card-actions"><button class="button secondary" data-review-resolution="cancelled" data-job-id="${escapeHtml(job.id)}" type="button">Verified no purchase</button><button class="button primary" data-review-resolution="confirmed" data-job-id="${escapeHtml(job.id)}" type="button">Verified success</button></div>` : ""}</article>`;
  }).join("") : empty("No action jobs yet.");
}

function renderCatalogGovernance() {
  const governance = state.snapshot.catalogGovernance || {};
  const proposals = governance.pending || [];
  const operations = governance.identityOperations || [];
  const panel = $("#catalogGovernancePanel");
  panel.hidden = governance.reviewCapable !== true
    && governance.identityProposalCapable !== true
    && governance.identityApprovalCapable !== true
    && proposals.length === 0
    && operations.length === 0;
  if (panel.hidden) return;
  const pendingOperations = operations.filter((operation) => operation.status === "pending");
  $("#catalogGovernanceGate").textContent = proposals.length || pendingOperations.length
    ? `${proposals.length + pendingOperations.length} PENDING` : "QUEUE CLEAR";
  $("#catalogProposalList").innerHTML = governance.reviewCapable !== true
    ? ""
    : proposals.length ? proposals.map((proposal) => `<article class="card">
    <div class="card-top"><div><h3>${escapeHtml(proposal.payload?.title || "Catalog listing change")}</h3><p>${escapeHtml(retailerName(proposal.retailerId))} · ${escapeHtml(proposal.retailerSku)} · proposed by ${escapeHtml(proposal.proposerUserId)}</p></div><span class="tag warning">pending review</span></div>
    <div class="card-meta"><span class="tag">${escapeHtml(proposal.payload?.canonicalUrl || "No URL")}</span><span class="tag">${formatMoney(proposal.payload?.msrpCents, proposal.payload?.currency || "USD")}</span><span class="tag">${escapeHtml(proposal.payloadHash?.slice(0, 12) || "no hash")}</span></div>
    <div class="card-actions"><button class="button secondary" data-catalog-reject="${escapeHtml(proposal.id)}" type="button">Reject</button><button class="button primary" data-catalog-approve="${escapeHtml(proposal.id)}" type="button">Approve exact listing</button></div>
  </article>`).join("") : empty("No catalog changes are waiting for review.");
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
      <p>Proposed by ${escapeHtml(operation.requestedByActorId)} ${escapeHtml(relativeTime(operation.createdAt))}.${operation.reviewedByActorId ? ` Reviewed by ${escapeHtml(operation.reviewedByActorId)}.` : ""}</p>
      <div class="card-actions">${operation.status === "pending" && governance.identityApprovalCapable === true ? `<button class="button secondary" data-catalog-identity-reject="${escapeHtml(operation.id)}" type="button">Reject</button><button class="button primary" data-catalog-identity-approve="${escapeHtml(operation.id)}" type="button">Review and apply</button>` : ""}${canRollback ? `<button class="button secondary" data-catalog-identity-rollback="${escapeHtml(operation.id)}" type="button">Propose rollback</button>` : ""}</div>
    </article>`;
  }).join("") : empty("No catalog identity operations have been proposed.");
}

function renderAuthorization() {
  const internalServices = state.snapshot.authorization?.internalServices || {};
  const serviceDefinitions = internalServices.definitions || [];
  const serviceGate = $("#internalServiceGate");
  serviceGate.textContent = Number(internalServices.configuredServiceCount || 0) > 0
    ? `${Number(internalServices.configuredServiceCount || 0)} SCOPED`
    : "DENY ALL";
  serviceGate.className = "mode-chip";
  $("#internalServiceList").innerHTML = serviceDefinitions.length
    ? serviceDefinitions.map((definition) => `<article class="card"><div class="card-top"><div><h3>${escapeHtml(definition.actorRef)}</h3><p>Deployment-owned workload reference</p></div><span class="tag good">${escapeHtml(definition.capability)}</span></div><p>Exactly one internal capability. This identity cannot provision users, attest eligibility, or process delivery unless that exact capability is shown.</p></article>`).join("")
    : empty("No internal workload identities are configured. Every hosted service actor is denied by default.");
  const enabled = state.snapshot.authorization?.roleAdministrationEnabled === true;
  $("#authorizationGate").textContent = enabled ? "ADMIN ENABLED" : "READ ONLY";
  if (!enabled) {
    $("#authorizationUserList").innerHTML = empty("Your role can view administration state but cannot manage security memberships.");
    $("#authorizationRoleList").innerHTML = "";
    return;
  }
  const grantableRoles = state.authorizationRoles.filter((role) => role.id !== "yoink_user");
  $("#authorizationUserList").innerHTML = state.authorizationUsers.length ? state.authorizationUsers.map((user) => `<article class="card">
    <div class="card-top"><div><h3>${escapeHtml(user.displayName)}</h3><p>${escapeHtml(user.id)} · created ${escapeHtml(relativeTime(user.createdAt))}</p></div><span class="tag good">tenant user</span></div>
    <div class="card-meta">${(user.activeRoles || []).map((roleId) => `<span class="tag">${escapeHtml(roleId)}</span>`).join("")}</div>
    <div class="card-actions">
      <select data-role-selection="${escapeHtml(user.id)}">${grantableRoles.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.displayName)}</option>`).join("")}</select>
      <button class="button primary" data-role-grant="${escapeHtml(user.id)}" type="button">Grant role</button>
      ${(user.activeRoles || []).filter((roleId) => roleId !== "yoink_user").map((roleId) => `<button class="button secondary" data-role-revoke-user="${escapeHtml(user.id)}" data-role-revoke="${escapeHtml(roleId)}" type="button">Revoke ${escapeHtml(roleId)}</button>`).join("")}
    </div>
  </article>`).join("") : empty("No users exist in this tenant.");
  $("#authorizationRoleList").innerHTML = state.authorizationRoles.map((role) => `<article class="card"><div class="card-top"><div><h3>${escapeHtml(role.displayName)}</h3><p>${escapeHtml(role.description)}</p></div><span class="tag">${role.permissions.length} permissions</span></div><div class="card-meta">${role.permissions.map((permission) => `<span class="tag">${escapeHtml(permission)}</span>`).join("")}</div></article>`).join("");
}

function renderOperatorAlerts() {
  const alerts = state.snapshot.operatorAlerts || {};
  const counts = alerts.counts || {};
  const connectorModel = alerts.connectors || {};
  const connectorCounts = connectorModel.counts || {};
  const connectors = connectorModel.connectors || [];
  const connectorHealth = connectorModel.health || [];
  const healthByConnector = new Map(connectorHealth.map((health) => [health.connectorId, health]));
  const connectorDeliveries = connectorModel.deliveries || [];
  const incidents = alerts.incidents || [];
  const rules = alerts.rules || [];
  const deliveries = alerts.deliveries || [];
  const activeCount = Number(counts.openOperatorAlerts || 0) + Number(counts.acknowledgedOperatorAlerts || 0);
  const gate = $("#operatorAlertGate");
  gate.textContent = activeCount ? `${activeCount} ACTIVE` : "CLEAR";
  gate.classList.toggle("danger", activeCount > 0);
  const addButton = $("#addOperatorAlertRuleButton");
  addButton.disabled = alerts.canManage !== true;
  addButton.title = alerts.canManage === true ? "Create a bounded operator alert rule." : "Permission alert.manage is required.";
  const addConnectorButton = $("#addOperatorAlertConnectorButton");
  addConnectorButton.disabled = alerts.canManage !== true;
  addConnectorButton.title = alerts.canManage === true ? "Bind a deployment-owned connector reference." : "Permission alert.manage is required.";
  const metrics = [
    ["Open", counts.openOperatorAlerts, `${Number(counts.acknowledgedOperatorAlerts || 0)} acknowledged`],
    ["Critical", counts.criticalOperatorAlerts, "Active incidents only"],
    ["Rules", counts.enabledOperatorAlertRules, `${Number(counts.operatorAlertRules || 0)} configured`],
    ["Connectors", connectorCounts.boundOperatorAlertConnectors, `${Number(connectorCounts.enabledOperatorAlertConnectors || 0)} enabled · ${Number(connectorCounts.criticalOperatorAlertConnectors || 0)} critical`]
  ];
  $("#operatorAlertMetricGrid").innerHTML = metrics.map(([label, value, note]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${Number(value || 0).toLocaleString()}</strong><small>${escapeHtml(note)}</small></article>`).join("");
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
    <div class="card-top"><div><h3>${escapeHtml(rule.name)}</h3><p>${escapeHtml(rule.eventFamily.replaceAll("_", " "))} · ${rule.retailerScope === "*" ? "all retailers" : escapeHtml(retailerName(rule.retailerScope))} · ${rule.operationScope === "*" ? "all operations" : escapeHtml(rule.operationScope.replaceAll("_", " "))}</p></div><span class="tag ${rule.enabled ? "good" : "warning"}">${rule.enabled ? "enabled" : "disabled"}</span></div>
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
  gate.textContent = Number(totals.serverErrors || 0) ? `${Number(totals.serverErrors).toLocaleString()} SERVER ERRORS` : errors ? `${errors.toLocaleString()} ERRORS` : "HEALTHY";
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
  const gate = $("#postgresCutoverGate");
  if (!model) {
    gate.textContent = "UNAVAILABLE";
    $("#postgresCutoverMetricGrid").innerHTML = empty("PostgreSQL cutover coverage is unavailable.");
    $("#postgresCutoverChecklist").innerHTML = "";
    return;
  }
  gate.textContent = model.productionReady === true ? "READY" : "QUALIFICATION ONLY";
  gate.className = "mode-chip";
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
    ["Server-bound signal mission binding", signalMissionBindingApplyModel?.qualificationSuiteParity === true && signalMissionBindingApplyModel?.settledPostIncidentDecisionRequired === true && signalMissionBindingApplyModel?.messageSerialization === true && signalMissionBindingApplyModel?.variantMissionSerialization === true && signalMissionBindingApplyModel?.existingMissionBinding === true && signalMissionBindingApplyModel?.trustedMissionCreation === true && signalMissionBindingApplyModel?.exactVariantTargetAttachment === true && signalMissionBindingApplyModel?.initialIntentPolicyCreation === true && signalMissionBindingApplyModel?.appendOnlyPolicyRevision === true && signalMissionBindingApplyModel?.missionQuantityParity === true && signalMissionBindingApplyModel?.targetPolicyJsonParity === true && signalMissionBindingApplyModel?.purchasePolicyHashParity === true && signalMissionBindingApplyModel?.idempotentReplay === true && signalMissionBindingApplyModel?.missionBindingRepositoryParity === true && signalMissionBindingApplyModel?.missionAuditOutboxRepositoryParity === true && signalMissionBindingApplyModel?.initialPolicyAuditOutboxRepositoryParity === true && signalMissionBindingApplyModel?.sharedCatalogMutation === false && signalMissionBindingApplyModel?.incidentMutation === false && signalMissionBindingApplyModel?.terminalDecisionMutation === false && signalMissionBindingApplyModel?.actionMutation === false && signalMissionBindingApplyModel?.spendMutation === false && signalMissionBindingApplyModel?.inboxLifecycleMutation === false && signalMissionBindingApplyModel?.rawSignalPayloadReturned === false && signalMissionBindingApplyModel?.directTableGrantCount === 0 && signalMissionBindingApplyModel?.functionGrantCount === 1 && signalMissionBindingApplyModel?.runtimeAuthority === false && signalMissionBindingApplyModel?.productionReady === false, `An eighth independently inactive NOLOGIN boundary accepts only the exact mission-binding continuation from a settled post-incident decision and revalidates it for at most ${Number(signalMissionBindingApplyModel?.maximumPlanAgeSeconds || 0).toLocaleString()} seconds. It binds an existing user mission or creates a trusted exact-source mission, attaches up to ${Number(signalMissionBindingApplyModel?.maximumVariantListings || 0).toLocaleString()} known exact-variant listings, preserves mission quantity and byte-identical SQLite policy hashes, creates only a missing initial append-only intent policy, and appends exact audit/outbox receipts across ${Number(signalMissionBindingApplyModel?.mutationTableCount || 0).toLocaleString()} tables. Strategy evaluation, action jobs, spend, checkout, order submission, and inbox completion remain closed.`],
    ["Server-bound strategy and purchase-policy evaluation", signalStrategyEvaluationApplyModel?.qualificationSuiteParity === true && signalStrategyEvaluationApplyModel?.settledMissionBindingRequired === true && signalStrategyEvaluationApplyModel?.applicationOwnedDeterministicEvaluation === true && signalStrategyEvaluationApplyModel?.databaseInputSnapshotRevalidation === true && signalStrategyEvaluationApplyModel?.strategySetFingerprintParity === true && signalStrategyEvaluationApplyModel?.evaluationFingerprintParity === true && signalStrategyEvaluationApplyModel?.terminalEvaluationDecisionParity === true && signalStrategyEvaluationApplyModel?.actionableEvaluationZeroWriteHandoff === true && signalStrategyEvaluationApplyModel?.sourceTrustRestrictionParity === true && signalStrategyEvaluationApplyModel?.idempotentReplay === true && signalStrategyEvaluationApplyModel?.sharedCatalogMutation === false && signalStrategyEvaluationApplyModel?.missionMutation === false && signalStrategyEvaluationApplyModel?.policyMutation === false && signalStrategyEvaluationApplyModel?.strategyMutation === false && signalStrategyEvaluationApplyModel?.actionMutation === false && signalStrategyEvaluationApplyModel?.spendMutation === false && signalStrategyEvaluationApplyModel?.inboxLifecycleMutation === false && signalStrategyEvaluationApplyModel?.rawSignalPayloadReturned === false && signalStrategyEvaluationApplyModel?.databaseSemanticEvaluation === false && signalStrategyEvaluationApplyModel?.evaluationAuthority === false && signalStrategyEvaluationApplyModel?.directTableGrantCount === 0 && signalStrategyEvaluationApplyModel?.functionGrantCount === 1 && signalStrategyEvaluationApplyModel?.runtimeAuthority === false && signalStrategyEvaluationApplyModel?.productionReady === false, `A ninth independently inactive NOLOGIN boundary binds an application-owned deterministic evaluation to the exact event transport hash, mission target, current policy revision, complete ordered strategy-set fingerprint, and source trust for at most ${Number(signalStrategyEvaluationApplyModel?.maximumPlanAgeSeconds || 0).toLocaleString()} seconds. Unmatched, stale, and quantity-limited results append exactly one decision/audit/outbox triplet across ${Number(signalStrategyEvaluationApplyModel?.mutationTableCount || 0).toLocaleString()} tables; matched and price-required evaluations make a zero-write handoff. PostgreSQL does not claim semantic evaluator authority, and action jobs, spend, inbox completion, checkout, and order submission remain closed.`],
    ["Server-bound signal action writer-lock protocol", signalWriterLockProtocolModel?.qualificationSuiteParity === true && signalWriterLockProtocolModel?.sharedWriterLockProtocolImplemented === true && signalWriterLockProtocolModel?.fixedOrderAdvisoryLocks === true && signalWriterLockProtocolModel?.sourceOwnershipValidation === true && signalWriterLockProtocolModel?.missionOwnershipValidation === true && signalWriterLockProtocolModel?.retailerIdentityValidation === true && signalWriterLockProtocolModel?.lockOnly === true && signalWriterLockProtocolModel?.actionSpendConsumerParity === true && signalWriterLockProtocolModel?.configurationWriterParity === false && signalWriterLockProtocolModel?.reservationWriterParity === false && signalWriterLockProtocolModel?.writerLockProtocolParity === false && signalWriterLockProtocolModel?.mutationAuthority === false && signalWriterLockProtocolModel?.directTableGrantCount === 0 && signalWriterLockProtocolModel?.functionGrantCount === 1 && signalWriterLockProtocolModel?.runtimeAuthority === false && signalWriterLockProtocolModel?.productionReady === false, `An eleventh independently inactive NOLOGIN boundary owns the fixed ${Number(signalWriterLockProtocolModel?.lockScopeCount || 0).toLocaleString()}-scope source → retailer qualification → settings → mission policy → spend lock order. It is lock-only, validates the authenticated source, retailer, and mission identities, and the reviewed action/spend, bounded configuration, Target qualification/settings, source-trust, source-status, source-sync, spend-reservation lifecycle, non-Target qualification, and mission-policy transactions consume it. Source catalog import and provisioning writers keep whole-system parity closed.`],
    ["Server-bound bounded configuration writers", signalConstraintConfigApplyModel?.qualificationSuiteParity === true && signalConstraintConfigApplyModel?.atomicQualificationApplyImplemented === true && signalConstraintConfigApplyModel?.serverBoundPrincipalLookup === true && signalConstraintConfigApplyModel?.sharedWriterLockProtocolImplemented === true && signalConstraintConfigApplyModel?.writerLockProtocolConsumed === true && signalConstraintConfigApplyModel?.settingsScopeConsumed === true && signalConstraintConfigApplyModel?.spendScopeConsumed === true && signalConstraintConfigApplyModel?.databaseOwnedTimestamps === true && signalConstraintConfigApplyModel?.optimisticConcurrency === true && signalConstraintConfigApplyModel?.deterministicRequestIdentity === true && signalConstraintConfigApplyModel?.immutableRequestReplay === true && signalConstraintConfigApplyModel?.lifecycleAwareOutboxReplay === true && signalConstraintConfigApplyModel?.atomicAuditOutbox === true && signalConstraintConfigApplyModel?.settingsPauseWriterParity === true && signalConstraintConfigApplyModel?.guardrailSettingsWriterParity === true && signalConstraintConfigApplyModel?.spendPolicyWriterParity === true && signalConstraintConfigApplyModel?.qualificationSettingsWriterParity === false && signalConstraintConfigApplyModel?.sourceWriterParity === false && signalConstraintConfigApplyModel?.retailerQualificationWriterParity === false && signalConstraintConfigApplyModel?.missionPolicyWriterParity === false && signalConstraintConfigApplyModel?.settingsWriterParity === false && signalConstraintConfigApplyModel?.configurationWriterParity === false && signalConstraintConfigApplyModel?.reservationWriterParity === false && signalConstraintConfigApplyModel?.writerLockProtocolParity === false && signalConstraintConfigApplyModel?.directTableGrantCount === 0 && signalConstraintConfigApplyModel?.functionGrantCount === 1 && signalConstraintConfigApplyModel?.runtimeAuthority === false && signalConstraintConfigApplyModel?.productionReady === false, `A twelfth independently inactive NOLOGIN boundary moves the three current user-facing operations—global action pause/resume, guardrail settings, and periodic spend caps—behind one principal-bound function across ${Number(signalConstraintConfigApplyModel?.mutationTableCount || 0).toLocaleString()} tables. It consumes the shared settings or spend lock, requires optimistic revisions, owns timestamps, records atomic audit/outbox receipts, and rejects altered replay. Separate Target qualification/settings, source-trust/status/sync, non-Target qualification, and mission-policy writers now close those lanes; source catalog import, provisioning, and reservation writers remain intentionally closed.`],
    ["Server-bound reviewed purchase-intent action and spend", signalActionSpendApplyModel?.qualificationSuiteParity === true && signalActionSpendApplyModel?.atomicQualificationApplyImplemented === true && signalActionSpendApplyModel?.sharedWriterLockProtocolImplemented === true && signalActionSpendApplyModel?.writerLockProtocolConsumed === true && signalActionSpendApplyModel?.constraintConfigBoundaryQualified === true && signalActionSpendApplyModel?.settingsPauseWriterParity === true && signalActionSpendApplyModel?.guardrailSettingsWriterParity === true && signalActionSpendApplyModel?.spendPolicyWriterParity === true && signalActionSpendApplyModel?.purchaseIntentOnly === false && signalActionSpendApplyModel?.strategyActionAuthority === false && signalActionSpendApplyModel?.strategySemanticsContractVersion === 2 && signalActionSpendApplyModel?.strategyDecisionSourceAccepted === true && signalActionSpendApplyModel?.strategyExistenceRevalidation === true && signalActionSpendApplyModel?.strategyFailoverToNotifyEnforced === true && signalActionSpendApplyModel?.strategyCartActionAuthority === false && signalActionSpendApplyModel?.strategyReservationAuthority === false && signalActionSpendApplyModel?.trustedStrategyActionSemanticsQualified === true && signalActionSpendApplyModel?.fixedOrderConfigurationLocks === true && signalActionSpendApplyModel?.currentMissionTargetRevalidation === true && signalActionSpendApplyModel?.currentPolicyRevalidation === true && signalActionSpendApplyModel?.currentSourceTrustRevalidation === true && signalActionSpendApplyModel?.currentRetailerQualificationRevalidation === true && signalActionSpendApplyModel?.currentSpendPolicyRevalidation === true && signalActionSpendApplyModel?.remainingQuantityRevalidation === true && signalActionSpendApplyModel?.siblingClaimRevalidation === true && signalActionSpendApplyModel?.cooldownRevalidation === true && signalActionSpendApplyModel?.periodicSpendRevalidation === true && signalActionSpendApplyModel?.exactProductBinding === true && signalActionSpendApplyModel?.firstPartyShippingOnly === true && signalActionSpendApplyModel?.quantityOneOnly === false && signalActionSpendApplyModel?.addToCartOnly === false && signalActionSpendApplyModel?.canonicalAttributionOnly === true && signalActionSpendApplyModel?.immutableReplay === true && signalActionSpendApplyModel?.lifecycleAwareReplay === true && signalActionSpendApplyModel?.actionSpendRepositoryParity === true && signalActionSpendApplyModel?.actionMutation === true && signalActionSpendApplyModel?.spendMutation === true && signalActionSpendApplyModel?.retailerMutation === false && signalActionSpendApplyModel?.checkoutMutation === false && signalActionSpendApplyModel?.orderSubmissionMutation === false && signalActionSpendApplyModel?.inboxLifecycleMutation === false && signalActionSpendApplyModel?.configurationWriterParity === false && signalActionSpendApplyModel?.reservationWriterParity === false && signalActionSpendApplyModel?.writerLockProtocolParity === false && signalActionSpendApplyModel?.attributionPolicyParity === false && signalActionSpendApplyModel?.directTableGrantCount === 0 && signalActionSpendApplyModel?.functionGrantCount === 1 && signalActionSpendApplyModel?.runtimeAuthority === false && signalActionSpendApplyModel?.productionReady === false, `A tenth independently inactive NOLOGIN boundary revalidates one exact reviewed purchase intent, current trusted first-party shipping evidence, quantity and claim availability, retailer qualification, cooldown, and daily/monthly/per-order capacity for at most ${Number(signalActionSpendApplyModel?.maximumPlanAgeSeconds || 0).toLocaleString()} seconds. It consumes the shared writer-lock protocol after the qualified bounded configuration predecessor and can atomically create a quantity-one add-to-cart job, exact offer snapshot, active spend reservation, reserved ledger entry, qualified decision, audit, and outbox receipt across ${Number(signalActionSpendApplyModel?.mutationTableCount || 0).toLocaleString()} tables; reviewed purchase intents retain their guarded add/spend semantics unchanged. Separately qualified trusted strategy decisions may now produce only notification jobs, with strategy existence/enabled/revision revalidation enforced in the database; strategy-sourced cart actions and spend reservations remain structurally closed. Retailer mutation, checkout, order submission, and inbox completion remain closed; remaining request repositories and final handler composition still block activation.`],
    ["Complete signal-evaluation apply composition", signalEvaluationCompositionModel?.deterministicManifestImplemented === true && signalEvaluationCompositionModel?.chainSequenceContractVerified === true && signalEvaluationCompositionModel?.chainBoundaryCount === 11 && signalEvaluationCompositionModel?.mutationFamilyCount === 10 && signalEvaluationCompositionModel?.unmappedMutationFamilyCount === 0 && signalEvaluationCompositionModel?.noNewRoleCreated === true && signalEvaluationCompositionModel?.noNewFunctionCreated === true && signalEvaluationCompositionModel?.noNewMutationPath === true && signalEvaluationCompositionModel?.signalEvaluationApplyRepositoryParity === true && signalEvaluationCompositionModel?.signalEvaluationRepositoryParity === false && signalEvaluationCompositionModel?.signalIngressRepositoryParity === false && signalEvaluationCompositionModel?.hostedDeliveryHandlerRepositoryParity === false && signalEvaluationCompositionModel?.allHandlerRepositoryParity === false && signalEvaluationCompositionModel?.activePrincipalCount === 0 && signalEvaluationCompositionModel?.activeRuntimeRoleApplied === false && signalEvaluationCompositionModel?.mutationAuthority === true && signalEvaluationCompositionModel?.runtimeAuthority === false && signalEvaluationCompositionModel?.productionReady === false, `${Number(signalEvaluationCompositionModel?.chainBoundaryCount || 0).toLocaleString()} qualified signal writers now compose into one deterministically verified evaluation-apply closure — every one of ${Number(signalEvaluationCompositionModel?.mutationFamilyCount || 0).toLocaleString()} SQLite evaluation mutation families maps to exactly one qualified boundary with cross-boundary fingerprint binding — closing signal-evaluation apply repository parity, while the evaluation repository, durable ingress, hosted-delivery handler composition, and full handler parity remain open.`],
    ["Complete signal-evaluation repository composition", signalEvaluationRepositoryCompositionModel?.deterministicManifestImplemented === true && signalEvaluationRepositoryCompositionModel?.writerTrackConvergenceVerified === true && signalEvaluationRepositoryCompositionModel?.chainBoundaryCount === 5 && signalEvaluationRepositoryCompositionModel?.ownFamilyCount === 5 && signalEvaluationRepositoryCompositionModel?.delegatedFamilyCount === 10 && signalEvaluationRepositoryCompositionModel?.totalFamilyCount === 15 && signalEvaluationRepositoryCompositionModel?.unmappedOwnFamilyCount === 0 && signalEvaluationRepositoryCompositionModel?.noNewRoleCreated === true && signalEvaluationRepositoryCompositionModel?.noNewFunctionCreated === true && signalEvaluationRepositoryCompositionModel?.noNewMutationPath === true && signalEvaluationRepositoryCompositionModel?.signalEvaluationApplyRepositoryParity === true && signalEvaluationRepositoryCompositionModel?.signalEvaluationRepositoryParity === true && signalEvaluationRepositoryCompositionModel?.signalIngressRepositoryParity === false && signalEvaluationRepositoryCompositionModel?.hostedDeliveryHandlerRepositoryParity === false && signalEvaluationRepositoryCompositionModel?.allHandlerRepositoryParity === false && signalEvaluationRepositoryCompositionModel?.activePrincipalCount === 0 && signalEvaluationRepositoryCompositionModel?.activeRuntimeRoleApplied === false && signalEvaluationRepositoryCompositionModel?.mutationAuthority === true && signalEvaluationRepositoryCompositionModel?.runtimeAuthority === false && signalEvaluationRepositoryCompositionModel?.productionReady === false, `${Number(signalEvaluationRepositoryCompositionModel?.chainBoundaryCount || 0).toLocaleString()} qualified members — the hosted-delivery transport/plan boundary, the eleven-writer apply closure, the terminal reservation-lifecycle, attribution-receipt, and action-job lifecycle writers — now compose into one deterministically verified complete evaluation repository with cross-boundary fingerprint convergence and ${Number(signalEvaluationRepositoryCompositionModel?.totalFamilyCount || 0).toLocaleString()}-family total coverage, closing signal-evaluation repository parity while durable ingress and handler composition remain open.`],
    ["Server-bound signal-ingress acceptance", signalIngressEnqueueApplyModel?.qualificationSuiteParity === true && signalIngressEnqueueApplyModel?.atomicQualificationApplyImplemented === true && signalIngressEnqueueApplyModel?.serverBoundPrincipalLookup === true && signalIngressEnqueueApplyModel?.callerScopeHardcoded === true && signalIngressEnqueueApplyModel?.messageKeyDatabaseDerived === true && signalIngressEnqueueApplyModel?.payloadHashDatabaseDerived === true && signalIngressEnqueueApplyModel?.sanitizedEnvelopeAcceptedAsInput === true && signalIngressEnqueueApplyModel?.conflictingContentFailsClosed === true && signalIngressEnqueueApplyModel?.receiptLedgerAppendOnly === true && signalIngressEnqueueApplyModel?.deterministicRequestIdentity === true && signalIngressEnqueueApplyModel?.deterministicReceiptIdentity === true && signalIngressEnqueueApplyModel?.databaseOwnedTimestamps === true && signalIngressEnqueueApplyModel?.writerLockProtocolConsumed === false && signalIngressEnqueueApplyModel?.queueWriteBoundaryConsumed === true && signalIngressEnqueueApplyModel?.sourceTrustWriterParity === true && signalIngressEnqueueApplyModel?.sourceStatusWriterParity === true && signalIngressEnqueueApplyModel?.sourceSyncWriterParity === true && signalIngressEnqueueApplyModel?.catalogImportWriterParity === true && signalIngressEnqueueApplyModel?.connectionProvisioningWriterParity === true && signalIngressEnqueueApplyModel?.sourceWriterParity === true && signalIngressEnqueueApplyModel?.retailerQualificationWriterParity === true && signalIngressEnqueueApplyModel?.missionPolicyWriterParity === true && signalIngressEnqueueApplyModel?.settingsWriterParity === false && signalIngressEnqueueApplyModel?.configurationWriterParity === false && signalIngressEnqueueApplyModel?.reservationWriterParity === true && signalIngressEnqueueApplyModel?.attributionPolicyParity === true && signalIngressEnqueueApplyModel?.attributionReceiptWriterParity === true && signalIngressEnqueueApplyModel?.writerLockProtocolParity === false && signalIngressEnqueueApplyModel?.ingressEnqueueWriterParity === true && signalIngressEnqueueApplyModel?.signalIngressRepositoryParity === false && signalIngressEnqueueApplyModel?.directTableGrantCount === 0 && signalIngressEnqueueApplyModel?.functionGrantCount === 1 && signalIngressEnqueueApplyModel?.mutationAuthority === true && signalIngressEnqueueApplyModel?.sharedCatalogMutationAuthority === false && signalIngressEnqueueApplyModel?.actionAuthority === false && signalIngressEnqueueApplyModel?.runtimeAuthority === false && signalIngressEnqueueApplyModel?.productionReady === false, `A twenty-fifth independently inactive NOLOGIN boundary accepts one sanitized TrackaLacker signal envelope through one security-definer function — message identity and payload hash are derived and revalidated in the database, duplicate envelopes append only their own delivery receipt with zero inbox mutation, conflicting same-identity payloads fail closed, and the companion task wake rides the separately qualified tenant queue writer — closing the ingress-enqueue family while the durable-ingress composition remains open.`],
    ["Complete durable signal-ingress composition", signalIngressCompositionModel?.deterministicManifestImplemented === true && signalIngressCompositionModel?.sharedAncestryConvergenceVerified === true && signalIngressCompositionModel?.queueWriteConvergenceVerified === true && signalIngressCompositionModel?.leaseRecoveryConvergenceVerified === true && signalIngressCompositionModel?.chainBoundaryCount === 4 && signalIngressCompositionModel?.ownFamilyCount === 2 && signalIngressCompositionModel?.delegatedFamilyCount === 15 && signalIngressCompositionModel?.totalFamilyCount === 17 && signalIngressCompositionModel?.unmappedOwnFamilyCount === 0 && signalIngressCompositionModel?.noNewRoleCreated === true && signalIngressCompositionModel?.noNewFunctionCreated === true && signalIngressCompositionModel?.noNewMutationPath === true && signalIngressCompositionModel?.signalEvaluationApplyRepositoryParity === true && signalIngressCompositionModel?.signalEvaluationRepositoryParity === true && signalIngressCompositionModel?.signalIngressRepositoryParity === true && signalIngressCompositionModel?.hostedDeliveryHandlerRepositoryParity === false && signalIngressCompositionModel?.allHandlerRepositoryParity === false && signalIngressCompositionModel?.activePrincipalCount === 0 && signalIngressCompositionModel?.activeRuntimeRoleApplied === false && signalIngressCompositionModel?.mutationAuthority === true && signalIngressCompositionModel?.runtimeAuthority === false && signalIngressCompositionModel?.productionReady === false, `${Number(signalIngressCompositionModel?.chainBoundaryCount || 0).toLocaleString()} qualified members — the signal-ingress acceptance writer, the tenant queue writer it consumes, the hosted-delivery transport boundary, and the complete evaluation repository composition — now compose into one deterministically verified durable-ingress repository with cross-boundary fingerprint convergence and ${Number(signalIngressCompositionModel?.totalFamilyCount || 0).toLocaleString()}-family total coverage, closing durable signal-ingress repository parity while the final handler composition remains open.`],
    ["Server-bound dead-letter inbox reset", signalDeadLetterResetApplyModel?.qualificationSuiteParity === true && signalDeadLetterResetApplyModel?.atomicQualificationApplyImplemented === true && signalDeadLetterResetApplyModel?.serverBoundPrincipalLookup === true && signalDeadLetterResetApplyModel?.workerManagePermissionRevalidated === false && signalDeadLetterResetApplyModel?.inboxOwnershipRevalidated === true && signalDeadLetterResetApplyModel?.deadLetterStatePreconditionEnforced === true && signalDeadLetterResetApplyModel?.repeatedResetAfterReDeadLetterAllowed === true && signalDeadLetterResetApplyModel?.deterministicRequestIdentity === true && signalDeadLetterResetApplyModel?.auditedReplayGraphIdempotency === true && signalDeadLetterResetApplyModel?.atomicInboxReceiptAuditOutboxMutation === true && signalDeadLetterResetApplyModel?.databaseOwnedTimestamps === true && signalDeadLetterResetApplyModel?.deterministicReceiptIdentity === true && signalDeadLetterResetApplyModel?.writerLockProtocolConsumed === false && signalDeadLetterResetApplyModel?.sqliteValidationParity === true && signalDeadLetterResetApplyModel?.sourceTrustWriterParity === true && signalDeadLetterResetApplyModel?.sourceStatusWriterParity === true && signalDeadLetterResetApplyModel?.sourceSyncWriterParity === true && signalDeadLetterResetApplyModel?.catalogImportWriterParity === true && signalDeadLetterResetApplyModel?.connectionProvisioningWriterParity === true && signalDeadLetterResetApplyModel?.sourceWriterParity === true && signalDeadLetterResetApplyModel?.retailerQualificationWriterParity === true && signalDeadLetterResetApplyModel?.missionPolicyWriterParity === true && signalDeadLetterResetApplyModel?.settingsWriterParity === false && signalDeadLetterResetApplyModel?.configurationWriterParity === false && signalDeadLetterResetApplyModel?.reservationWriterParity === true && signalDeadLetterResetApplyModel?.attributionPolicyParity === true && signalDeadLetterResetApplyModel?.jobLifecycleWriterParity === true && signalDeadLetterResetApplyModel?.writerLockProtocolParity === false && signalDeadLetterResetApplyModel?.deadLetterResetWriterParity === true && signalDeadLetterResetApplyModel?.signalIngressRepositoryParity === false && signalDeadLetterResetApplyModel?.hostedDeliveryHandlerRepositoryParity === false && signalDeadLetterResetApplyModel?.allHandlerRepositoryParity === false && signalDeadLetterResetApplyModel?.directTableGrantCount === 0 && signalDeadLetterResetApplyModel?.functionGrantCount === 1 && signalDeadLetterResetApplyModel?.mutationAuthority === true && signalDeadLetterResetApplyModel?.runtimeAuthority === false && signalDeadLetterResetApplyModel?.productionReady === false, `A twenty-sixth independently inactive NOLOGIN boundary resets one operator-selected dead-lettered signal inbox message through one security-definer function — dead-letter state is a fail-closed precondition, the reset appends its own receipt-hash-verified delivery ledger row plus one audit and outbox pair, a legitimately re-dead-lettered message may be reset again, and replays echo the original audited result — closing the dead-letter-reset family while the final handler composition remains open.`],
    ["Server-bound notification-delivery ensure", signalNotificationEnsureApplyModel?.qualificationSuiteParity === true && signalNotificationEnsureApplyModel?.atomicQualificationApplyImplemented === true && signalNotificationEnsureApplyModel?.serverBoundPrincipalLookup === true && signalNotificationEnsureApplyModel?.jobOwnershipRevalidated === true && signalNotificationEnsureApplyModel?.notifyActionPreconditionEnforced === true && signalNotificationEnsureApplyModel?.notifyOnlyStatePreconditionEnforced === true && signalNotificationEnsureApplyModel?.deterministicRequestIdentity === true && signalNotificationEnsureApplyModel?.insertOrIgnoreReplayParity === true && signalNotificationEnsureApplyModel?.mutableDeliveryStateReplayEcho === true && signalNotificationEnsureApplyModel?.noAuditOrOutboxWrite === true && signalNotificationEnsureApplyModel?.databaseOwnedTimestamps === true && signalNotificationEnsureApplyModel?.deterministicDeliveryIdentity === true && signalNotificationEnsureApplyModel?.writerLockProtocolConsumed === false && signalNotificationEnsureApplyModel?.sqliteValidationParity === true && signalNotificationEnsureApplyModel?.sourceTrustWriterParity === true && signalNotificationEnsureApplyModel?.sourceStatusWriterParity === true && signalNotificationEnsureApplyModel?.sourceSyncWriterParity === true && signalNotificationEnsureApplyModel?.catalogImportWriterParity === true && signalNotificationEnsureApplyModel?.connectionProvisioningWriterParity === true && signalNotificationEnsureApplyModel?.sourceWriterParity === true && signalNotificationEnsureApplyModel?.retailerQualificationWriterParity === true && signalNotificationEnsureApplyModel?.missionPolicyWriterParity === true && signalNotificationEnsureApplyModel?.settingsWriterParity === false && signalNotificationEnsureApplyModel?.configurationWriterParity === false && signalNotificationEnsureApplyModel?.reservationWriterParity === true && signalNotificationEnsureApplyModel?.attributionPolicyParity === true && signalNotificationEnsureApplyModel?.jobLifecycleWriterParity === true && signalNotificationEnsureApplyModel?.writerLockProtocolParity === false && signalNotificationEnsureApplyModel?.deadLetterResetWriterParity === true && signalNotificationEnsureApplyModel?.notificationEnsureWriterParity === true && signalNotificationEnsureApplyModel?.signalIngressRepositoryParity === false && signalNotificationEnsureApplyModel?.hostedDeliveryHandlerRepositoryParity === false && signalNotificationEnsureApplyModel?.allHandlerRepositoryParity === false && signalNotificationEnsureApplyModel?.directTableGrantCount === 0 && signalNotificationEnsureApplyModel?.functionGrantCount === 1 && signalNotificationEnsureApplyModel?.mutationAuthority === true && signalNotificationEnsureApplyModel?.runtimeAuthority === false && signalNotificationEnsureApplyModel?.productionReady === false, `A twenty-seventh independently inactive NOLOGIN boundary ensures exactly one pending notification delivery for one owned notify-only action job through one security-definer function — an existing delivery is a true zero-write success that echoes the row's live state, and, matching SQLite exactly, no audit or outbox row is ever written on any path — closing the notification-ensure family while the final handler composition remains open.`],
    ["Server-bound attribution-receipt append", signalAttributionReceiptApplyModel?.qualificationSuiteParity === true && signalAttributionReceiptApplyModel?.atomicQualificationApplyImplemented === true && signalAttributionReceiptApplyModel?.serverBoundPrincipalLookup === true && signalAttributionReceiptApplyModel?.jobOwnershipRevalidated === true && signalAttributionReceiptApplyModel?.attributionSnapshotConsistencyRevalidated === true && signalAttributionReceiptApplyModel?.provisionedPolicyRowRequired === true && signalAttributionReceiptApplyModel?.policyIdentityRevalidated === true && signalAttributionReceiptApplyModel?.writerLockProtocolConsumed === false && signalAttributionReceiptApplyModel?.deterministicRequestIdentity === true && signalAttributionReceiptApplyModel?.insertOrIgnoreReplayParity === true && signalAttributionReceiptApplyModel?.auditedOnFreshRecordOnly === true && signalAttributionReceiptApplyModel?.immutableReceiptReplay === true && signalAttributionReceiptApplyModel?.databaseOwnedTimestamps === true && signalAttributionReceiptApplyModel?.databaseDerivedCanonicalUrlHash === true && signalAttributionReceiptApplyModel?.metadataNeverPersisted === true && signalAttributionReceiptApplyModel?.sourceTrustWriterParity === true && signalAttributionReceiptApplyModel?.sourceStatusWriterParity === true && signalAttributionReceiptApplyModel?.sourceSyncWriterParity === true && signalAttributionReceiptApplyModel?.catalogImportWriterParity === true && signalAttributionReceiptApplyModel?.connectionProvisioningWriterParity === true && signalAttributionReceiptApplyModel?.sourceWriterParity === true && signalAttributionReceiptApplyModel?.retailerQualificationWriterParity === true && signalAttributionReceiptApplyModel?.missionPolicyWriterParity === true && signalAttributionReceiptApplyModel?.settingsWriterParity === false && signalAttributionReceiptApplyModel?.configurationWriterParity === false && signalAttributionReceiptApplyModel?.reservationWriterParity === true && signalAttributionReceiptApplyModel?.attributionPolicyParity === true && signalAttributionReceiptApplyModel?.attributionReceiptWriterParity === true && signalAttributionReceiptApplyModel?.writerLockProtocolParity === false && signalAttributionReceiptApplyModel?.directTableGrantCount === 0 && signalAttributionReceiptApplyModel?.functionGrantCount === 1 && signalAttributionReceiptApplyModel?.mutationAuthority === true && signalAttributionReceiptApplyModel?.sharedCatalogMutationAuthority === false && signalAttributionReceiptApplyModel?.actionAuthority === false && signalAttributionReceiptApplyModel?.runtimeAuthority === false && signalAttributionReceiptApplyModel?.productionReady === false, `A twenty-third independently inactive NOLOGIN boundary appends exactly one derive-don't-trust affiliate-routing receipt per action job through one security-definer function — provider, route, policy, and canonical-URL hash are read and revalidated from the locked job graph, never accepted from the wire — with INSERT OR IGNORE zero-write duplicate parity and no audit flood; closes the attribution-receipt family from the evaluation-composition accounting while notification dispatch and post-creation job lifecycle remain open.`],
    ["Server-bound action-job lifecycle", signalJobLifecycleApplyModel?.qualificationSuiteParity === true && signalJobLifecycleApplyModel?.atomicQualificationApplyImplemented === true && signalJobLifecycleApplyModel?.serverBoundPrincipalLookup === true && signalJobLifecycleApplyModel?.writerLockProtocolConsumed === true && signalJobLifecycleApplyModel?.spendScopeConsumed === true && signalJobLifecycleApplyModel?.deterministicRequestIdentity === true && signalJobLifecycleApplyModel?.immutableTransitionReplay === true && signalJobLifecycleApplyModel?.lifecycleAwareOutboxReplay === true && signalJobLifecycleApplyModel?.currentJobOwnershipRevalidation === true && signalJobLifecycleApplyModel?.expectedCurrentStateRevalidation === true && signalJobLifecycleApplyModel?.legalTransitionTableEnforced === true && signalJobLifecycleApplyModel?.possibleMutationCancelGuardEnforced === true && signalJobLifecycleApplyModel?.crossTenantIncidentGuardEnforced === true && signalJobLifecycleApplyModel?.terminalIncidentClosureParity === true && signalJobLifecycleApplyModel?.reviewIncidentLockParity === true && signalJobLifecycleApplyModel?.missionFulfillmentMutation === true && signalJobLifecycleApplyModel?.checkoutMutation === false && signalJobLifecycleApplyModel?.orderSubmissionMutation === false && signalJobLifecycleApplyModel?.spendReservationMutationDeferred === true && signalJobLifecycleApplyModel?.atomicJobLifecycleAuditOutbox === true && signalJobLifecycleApplyModel?.databaseOwnedTimestamps === true && signalJobLifecycleApplyModel?.deviceCapabilityRevalidation === false && signalJobLifecycleApplyModel?.sqliteValidationParity === true && signalJobLifecycleApplyModel?.sourceTrustWriterParity === true && signalJobLifecycleApplyModel?.sourceStatusWriterParity === true && signalJobLifecycleApplyModel?.sourceSyncWriterParity === true && signalJobLifecycleApplyModel?.catalogImportWriterParity === true && signalJobLifecycleApplyModel?.connectionProvisioningWriterParity === true && signalJobLifecycleApplyModel?.sourceWriterParity === true && signalJobLifecycleApplyModel?.retailerQualificationWriterParity === true && signalJobLifecycleApplyModel?.missionPolicyWriterParity === true && signalJobLifecycleApplyModel?.settingsWriterParity === false && signalJobLifecycleApplyModel?.configurationWriterParity === false && signalJobLifecycleApplyModel?.reservationWriterParity === true && signalJobLifecycleApplyModel?.attributionPolicyParity === true && signalJobLifecycleApplyModel?.jobLifecycleWriterParity === true && signalJobLifecycleApplyModel?.writerLockProtocolParity === false && signalJobLifecycleApplyModel?.directTableGrantCount === 0 && signalJobLifecycleApplyModel?.functionGrantCount === 1 && signalJobLifecycleApplyModel?.mutationAuthority === true && signalJobLifecycleApplyModel?.jobLifecycleMutationAuthority === true && signalJobLifecycleApplyModel?.actionAuthority === false && signalJobLifecycleApplyModel?.checkoutAuthority === false && signalJobLifecycleApplyModel?.orderSubmissionAuthority === false && signalJobLifecycleApplyModel?.runtimeAuthority === false && signalJobLifecycleApplyModel?.productionReady === false, `A twenty-fourth independently inactive NOLOGIN boundary applies the complete forty-seven-edge post-creation job state machine under the spend lock — optimistic expected-state preconditions, manual-resolution cancel guards, incident close/lock lifecycle, and the first qualified missions fulfilled-quantity commitment — across ${Number(signalJobLifecycleApplyModel?.mutationTableCount || 0).toLocaleString()} mutation tables, while spend reservations and ledger accounting remain exclusively with the terminal reservation-lifecycle writer. This closes the post-creation job-lifecycle family; notification dispatch and the operator dead-letter inbox-reset remain open.`],
    ["Server-bound Target qualification and settings activation", signalTargetQualificationApplyModel?.qualificationSuiteParity === true && signalTargetQualificationApplyModel?.atomicQualificationApplyImplemented === true && signalTargetQualificationApplyModel?.serverBoundPrincipalLookup === true && signalTargetQualificationApplyModel?.sharedWriterLockProtocolImplemented === true && signalTargetQualificationApplyModel?.writerLockProtocolConsumed === true && signalTargetQualificationApplyModel?.retailerQualificationScopeConsumed === true && signalTargetQualificationApplyModel?.settingsScopeConsumed === true && signalTargetQualificationApplyModel?.databaseOwnedTimestamps === true && signalTargetQualificationApplyModel?.deterministicRequestIdentity === true && signalTargetQualificationApplyModel?.immutableRequestReplay === true && signalTargetQualificationApplyModel?.lifecycleAwareOutboxReplay === true && signalTargetQualificationApplyModel?.atomicQualificationSettingsPromotionAuditOutbox === true && signalTargetQualificationApplyModel?.currentEvidenceRevalidation === true && signalTargetQualificationApplyModel?.currentDeviceCapabilityRevalidation === true && signalTargetQualificationApplyModel?.targetQualificationSettingsWriterParity === true && signalTargetQualificationApplyModel?.targetJobPromotionParity === true && signalTargetQualificationApplyModel?.qualificationSettingsWriterParity === true && signalTargetQualificationApplyModel?.sourceWriterParity === false && signalTargetQualificationApplyModel?.retailerQualificationWriterParity === false && signalTargetQualificationApplyModel?.missionPolicyWriterParity === false && signalTargetQualificationApplyModel?.configurationWriterParity === false && signalTargetQualificationApplyModel?.reservationWriterParity === false && signalTargetQualificationApplyModel?.writerLockProtocolParity === false && signalTargetQualificationApplyModel?.directTableGrantCount === 0 && signalTargetQualificationApplyModel?.functionGrantCount === 1 && signalTargetQualificationApplyModel?.runtimeAuthority === false && signalTargetQualificationApplyModel?.productionReady === false, `A thirteenth independently inactive NOLOGIN boundary revalidates the exact current 30-day Target dossier, passed no-click rehearsal, current Target add-v1 companion, and settings revision. It consumes retailer-qualification then settings locks and atomically qualifies Target, enables live unpaused settings, promotes only fresh first-party shipping quantity-one jobs, and appends replay-safe receipts across ${Number(signalTargetQualificationApplyModel?.mutationTableCount || 0).toLocaleString()} mutation tables. Version 0.89 separately closes Walmart, Amazon, and Best Buy activation parity behind a shared-catalog-safe writer.`],
    ["Server-bound source-trust configuration", signalSourceTrustApplyModel?.qualificationSuiteParity === true && signalSourceTrustApplyModel?.atomicQualificationApplyImplemented === true && signalSourceTrustApplyModel?.serverBoundPrincipalLookup === true && signalSourceTrustApplyModel?.sharedWriterLockProtocolImplemented === true && signalSourceTrustApplyModel?.writerLockProtocolConsumed === true && signalSourceTrustApplyModel?.sourceScopeConsumed === true && signalSourceTrustApplyModel?.databaseOwnedTimestamps === true && signalSourceTrustApplyModel?.optimisticConcurrency === true && signalSourceTrustApplyModel?.deterministicRequestIdentity === true && signalSourceTrustApplyModel?.immutableRequestReplay === true && signalSourceTrustApplyModel?.lifecycleAwareOutboxReplay === true && signalSourceTrustApplyModel?.atomicSourceAuditOutbox === true && signalSourceTrustApplyModel?.currentSourceOwnershipRevalidation === true && signalSourceTrustApplyModel?.privateSourceOnly === true && signalSourceTrustApplyModel?.trustedExactAutoCreateCoupling === true && signalSourceTrustApplyModel?.sourceTrustWriterParity === true && signalSourceTrustApplyModel?.sourceWriterParity === false && signalSourceTrustApplyModel?.retailerQualificationWriterParity === false && signalSourceTrustApplyModel?.missionPolicyWriterParity === false && signalSourceTrustApplyModel?.configurationWriterParity === false && signalSourceTrustApplyModel?.reservationWriterParity === false && signalSourceTrustApplyModel?.writerLockProtocolParity === false && signalSourceTrustApplyModel?.directTableGrantCount === 0 && signalSourceTrustApplyModel?.functionGrantCount === 1 && signalSourceTrustApplyModel?.runtimeAuthority === false && signalSourceTrustApplyModel?.productionReady === false, `A fourteenth independently inactive NOLOGIN boundary consumes the shared source lock, revalidates one exact private user-owned connection and optimistic timestamp, and atomically updates trust plus replay-safe audit/outbox receipts across ${Number(signalSourceTrustApplyModel?.mutationTableCount || 0).toLocaleString()} tables. Informational sources can never create missions. General connection lifecycle/status and reservation writers remain closed; versions 0.89 and 0.90 separately close non-Target qualification and mission-policy parity.`],
    ["Server-bound Walmart, Amazon, and Best Buy qualification", signalRetailerQualificationApplyModel?.qualificationSuiteParity === true && signalRetailerQualificationApplyModel?.atomicQualificationApplyImplemented === true && signalRetailerQualificationApplyModel?.serverBoundPrincipalLookup === true && signalRetailerQualificationApplyModel?.sharedWriterLockProtocolImplemented === true && signalRetailerQualificationApplyModel?.writerLockProtocolConsumed === true && signalRetailerQualificationApplyModel?.retailerQualificationScopeConsumed === true && signalRetailerQualificationApplyModel?.settingsScopeConsumed === true && signalRetailerQualificationApplyModel?.globalRetailerSerialization === true && signalRetailerQualificationApplyModel?.exactPackagedRetailerAllowlist === true && signalRetailerQualificationApplyModel?.monotonicSharedCatalogPromotion === true && signalRetailerQualificationApplyModel?.currentEvidenceRevalidation === true && signalRetailerQualificationApplyModel?.currentDeviceCapabilityRevalidation === true && signalRetailerQualificationApplyModel?.currentSettingsRevalidation === true && signalRetailerQualificationApplyModel?.nonTargetQualificationWriterParity === true && signalRetailerQualificationApplyModel?.nonTargetJobPromotionParity === true && signalRetailerQualificationApplyModel?.sharedCatalogExecutionWriterParity === true && signalRetailerQualificationApplyModel?.qualificationSettingsWriterParity === true && signalRetailerQualificationApplyModel?.sourceTrustWriterParity === true && signalRetailerQualificationApplyModel?.sourceWriterParity === false && signalRetailerQualificationApplyModel?.retailerQualificationWriterParity === true && signalRetailerQualificationApplyModel?.configurationWriterParity === false && signalRetailerQualificationApplyModel?.reservationWriterParity === false && signalRetailerQualificationApplyModel?.writerLockProtocolParity === false && signalRetailerQualificationApplyModel?.directTableGrantCount === 0 && signalRetailerQualificationApplyModel?.functionGrantCount === 1 && signalRetailerQualificationApplyModel?.sharedCatalogMutationAuthority === true && signalRetailerQualificationApplyModel?.retailerMutationAuthority === false && signalRetailerQualificationApplyModel?.runtimeAuthority === false && signalRetailerQualificationApplyModel?.productionReady === false, `A fifteenth independently inactive NOLOGIN boundary accepts only the three packaged non-Target add lanes, revalidates each exact 30-day dossier, no-click rehearsal, and Chrome capability, then consumes retailer/settings locks plus a retailer-global catalog lock. It can only promote execution support monotonically across ${Number(signalRetailerQualificationApplyModel?.protectedSharedCatalogTableCount || 0).toLocaleString()} exact shared tables and mutate ${Number(signalRetailerQualificationApplyModel?.tenantMutationTableCount || 0).toLocaleString()} tenant tables. Arbitrary catalog changes, browser mutation, checkout, orders, and runtime authority remain closed.`],
    ["Server-bound mission-policy revision", signalMissionPolicyApplyModel?.qualificationSuiteParity === true && signalMissionPolicyApplyModel?.atomicQualificationApplyImplemented === true && signalMissionPolicyApplyModel?.serverBoundPrincipalLookup === true && signalMissionPolicyApplyModel?.sharedWriterLockProtocolImplemented === true && signalMissionPolicyApplyModel?.writerLockProtocolConsumed === true && signalMissionPolicyApplyModel?.settingsScopeConsumed === true && signalMissionPolicyApplyModel?.missionPolicyScopeConsumed === true && signalMissionPolicyApplyModel?.optimisticConcurrency === true && signalMissionPolicyApplyModel?.immutableRequestReplay === true && signalMissionPolicyApplyModel?.zeroWriteUnchangedPolicy === true && signalMissionPolicyApplyModel?.appendOnlyPolicyRevision === true && signalMissionPolicyApplyModel?.atomicPolicyAuditOutbox === true && signalMissionPolicyApplyModel?.currentMissionOwnershipRevalidation === true && signalMissionPolicyApplyModel?.currentTargetSnapshotRevalidation === true && signalMissionPolicyApplyModel?.currentSettingsRevalidation === true && signalMissionPolicyApplyModel?.policyHashV2Parity === true && signalMissionPolicyApplyModel?.directPurchaseSafetyParity === true && signalMissionPolicyApplyModel?.sourceWriterParity === false && signalMissionPolicyApplyModel?.retailerQualificationWriterParity === true && signalMissionPolicyApplyModel?.missionPolicyWriterParity === true && signalMissionPolicyApplyModel?.configurationWriterParity === false && signalMissionPolicyApplyModel?.reservationWriterParity === false && signalMissionPolicyApplyModel?.directTableGrantCount === 0 && signalMissionPolicyApplyModel?.functionGrantCount === 1 && signalMissionPolicyApplyModel?.sharedCatalogMutationAuthority === false && signalMissionPolicyApplyModel?.actionAuthority === false && signalMissionPolicyApplyModel?.runtimeAuthority === false && signalMissionPolicyApplyModel?.productionReady === false, `A sixteenth independently inactive NOLOGIN boundary accepts one exact full replacement of a user's current mission policy. It consumes settings and mission-policy locks, revalidates ownership, revision, hash, all targets, listings, tax, and store allowances, preserves the byte-identical intent-policy-v2 hash, and appends one revision plus audit/outbox receipts across ${Number(signalMissionPolicyApplyModel?.mutationTableCount || 0).toLocaleString()} tables. Unchanged policy is a true zero-write success; unsafe direct-purchase preferences fail closed and no action or catalog mutation authority is granted.`],
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
  const deploymentMismatch = ["worker_deployment_mismatch", "worker_deployment_expectation_mismatch"].includes(deployment.lastErrorCode);
  gate.textContent = deploymentMismatch
    ? "CONFIG MISMATCH"
    : deployment.healthy
      ? activeProblems ? `${activeProblems} NEED ATTENTION` : "RUNNING"
      : "OFFLINE";
  gate.classList.toggle("danger", activeProblems > 0 || !deployment.healthy);
  const metrics = [
    ["Workers online", counts.onlineWorkers, "30-second heartbeat"],
    ["Deployment contract", deployment.attested ? 1 : 0, deployment.attested ? `attested v${Number(deployment.contractVersion || 0)}` : operationalLabel(deployment.lastErrorCode || "not_attested")],
    ["Signal inbox", signalWaiting, `${Number(signalIngress.processed || 0).toLocaleString()} processed · ${Number(signalIngress.deadLetter || 0).toLocaleString()} dead letter`],
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
  $("#signalInboxDeadLetterList").innerHTML = (model.signalDeadLetters || []).length ? model.signalDeadLetters.map((message) => `<article class="card"><div class="card-top"><div><h3>TrackaLacker signal evaluation stopped</h3><p>Attempt ${Number(message.attempt)} · received ${escapeHtml(relativeTime(message.receivedAt))}</p></div><span class="tag bad">dead letter</span></div><div class="card-meta"><span class="tag bad">${escapeHtml(operationalLabel(message.lastErrorCode || "signal_processing_failed"))}</span><span class="tag">${escapeHtml(message.privacyClassification || "operational_aggregate")}</span><span class="tag operational-correlation">${escapeHtml(message.id)}</span><span>updated ${escapeHtml(relativeTime(message.updatedAt))}</span></div><div class="card-actions"><button class="button primary" data-signal-inbox-retry="${escapeHtml(message.id)}" type="button" ${model.canManage ? "" : "disabled"}>Retry corrected signal</button></div></article>`).join("") : empty("No signal message is in dead letter.");
  $("#backgroundWorkerInstanceList").innerHTML = (model.workers || []).length ? model.workers.map((worker) => `<article class="card"><div class="card-top"><div><h3>${escapeHtml(worker.runtimeKind.replaceAll("_", " "))}</h3><p>${escapeHtml(worker.workerId)} · version ${escapeHtml(worker.runtimeVersion)}</p></div><span class="tag ${worker.online ? "good" : "warning"}">${worker.online ? "online" : worker.state}</span></div><div class="card-meta"><span class="tag">heartbeat ${escapeHtml(relativeTime(worker.heartbeatAt))}</span>${worker.lastErrorCode ? `<span class="tag warning">${escapeHtml(operationalLabel(worker.lastErrorCode))}</span>` : ""}<span class="tag ${worker.deploymentFingerprintPresent ? "good" : "warning"}">${worker.deploymentFingerprintPresent ? "attestation presented" : "legacy heartbeat"}</span><span class="tag">operational aggregate</span><span class="tag">bounded principals</span></div></article>`).join("") : empty("No worker heartbeat has been recorded. Start Yoink in embedded mode or start the standalone worker after the API initializes the database.");
}

function adminChangeLabel(value) {
  return String(value || "unknown").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function renderAdminChanges() {
  const model = state.adminChanges;
  if (!model) {
    $("#adminChangeMetricGrid").innerHTML = empty("Protected changes are loading.");
    $("#adminChangeRequestList").innerHTML = "";
    return;
  }
  const counts = model.counts || {};
  const assurance = model.assurance || { level: "baseline", fresh: false, expiresAt: "" };
  const pending = Number(counts.pending || 0);
  const approved = Number(counts.approved || 0);
  $("#adminChangeMetricGrid").innerHTML = [
    ["Waiting for review", pending, "Needs another authorized person"],
    ["Ready to retry", approved, "Exact operation approved"],
    ["Applied", Number(counts.consumed || 0), "Authorization consumed atomically"],
    ["Closed", Number(counts.rejected || 0) + Number(counts.expired || 0), `${Number(counts.rejected || 0)} rejected · ${Number(counts.expired || 0)} expired`]
  ].map(([label, value, note]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${Number(value).toLocaleString()}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  $("#adminChangeGate").textContent = pending ? `${pending} TO REVIEW` : approved ? `${approved} APPROVED` : "QUEUE CLEAR";
  if (assurance.level === "local_trusted") {
    $("#changeAssuranceTitle").textContent = "Trusted local control center";
    $("#changeAssuranceCopy").textContent = "Local/offline setup stays usable and records protected changes as local-trusted receipts. Hosted deployments require identity-provider step-up and independent approval.";
  } else if (assurance.fresh) {
    $("#changeAssuranceTitle").textContent = "Fresh sign-in verified";
    $("#changeAssuranceCopy").textContent = `This session can request or review protected changes until ${new Date(assurance.expiresAt).toLocaleTimeString()}.`;
  } else {
    $("#changeAssuranceTitle").textContent = "Sign in again before changing protected settings";
    $("#changeAssuranceCopy").textContent = "Your normal session can still view this queue. A hosted identity provider must issue a fresh, signed step-up session before Yoink will request, approve, or apply a protected change.";
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
        ? "Approved. Retry the exact original action before this request expires."
        : status === "consumed"
          ? "Applied once; this authorization cannot be replayed."
          : status === "rejected" ? "Rejected without applying the protected change." : "Expired without applying the protected change.";
    return `<article class="card operator-alert-card ${kind}">
      <div class="card-top"><div><h3>${escapeHtml(item.operationLabel)}</h3><p>${escapeHtml(instruction)}</p></div><span class="tag ${kind}">${escapeHtml(status)}</span></div>
      <div class="card-meta"><span class="tag ${item.controlLevel === "two_person" ? "warning" : "good"}">${item.controlLevel === "two_person" ? "Two people required" : "Fresh sign-in required"}</span>${summary}</div>
      <p class="operator-alert-detail">Requested by ${escapeHtml(item.requestedByDisplayName)} ${escapeHtml(relativeTime(item.createdAt))} · expires ${escapeHtml(relativeTime(item.expiresAt))} · ${Number(item.events?.length || 0)} immutable event${Number(item.events?.length || 0) === 1 ? "" : "s"}</p>
      ${canDecide ? `<div class="card-actions"><button class="button secondary" data-admin-change-reject="${escapeHtml(item.id)}" type="button">Reject</button><button class="button primary" data-admin-change-approve="${escapeHtml(item.id)}" type="button" ${canApprove ? "" : 'disabled title="A different user must approve this request."'}>Approve exact change</button></div>` : ""}
    </article>`;
  }).join("") : empty("No protected administrative changes have been requested yet.");
}

function render() {
  renderStatus(); renderMetrics(); renderReadinessGuide(); renderSignals(); renderSources(); renderDevices(); renderQualifications(); renderWalmartDraws(); renderAdapterRepairQueue(); renderShadowObservations(); renderCommunity(); renderIdentityGovernance(); renderObserverRegistry(); renderLibrary(); renderCatalogGovernance(); renderStrategies(); renderMissions(); renderJobs(); renderNotifications(); renderAttributionReceipts(); renderAudit(); renderSettings(); renderAttributionPolicies(); renderAuthorization(); renderOperatorAlerts(); renderOperationalTelemetry(); renderPostgresCutover(); renderBackgroundWork(); renderAdminChanges();
}

async function storeFingerprint(retailerId, localStoreId) {
  const normalized = String(localStoreId || "").trim().toLocaleUpperCase("en-US");
  if (!/^[A-Z0-9][A-Z0-9 _.-]{0,79}$/.test(normalized)) throw new Error("Enter the retailer’s local store ID using letters or numbers.");
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

async function loadLibrary(reset = true) {
  const query = $("#librarySearch").value.trim();
  const offset = reset || query !== state.libraryQuery ? 0 : state.libraryItems.length;
  const result = await api(`/api/v1/user/library?limit=${COLLECTION_PAGE_SIZE}&offset=${offset}&q=${encodeURIComponent(query)}`);
  state.libraryItems = offset === 0 ? result.items || [] : [...state.libraryItems, ...(result.items || [])];
  state.libraryTotal = Number(result.total || 0);
  state.libraryQuery = query;
}

async function loadMissions(reset = true) {
  const query = $("#missionSearch").value.trim();
  const offset = reset || query !== state.missionQuery ? 0 : state.missionItems.length;
  const result = await api(`/api/v1/user/missions?limit=${COLLECTION_PAGE_SIZE}&offset=${offset}&q=${encodeURIComponent(query)}`);
  state.missionItems = offset === 0 ? result.items || [] : [...state.missionItems, ...(result.items || [])];
  state.missionTotal = Number(result.total || 0);
  state.missionQuery = query;
}

async function loadAudit(reset = true) {
  const query = $("#auditSearch").value.trim();
  const offset = reset || query !== state.auditQuery ? 0 : state.auditItems.length;
  const result = await api(`/api/v1/user/audit?limit=${COLLECTION_PAGE_SIZE}&offset=${offset}&q=${encodeURIComponent(query)}`);
  state.auditItems = offset === 0 ? result.items || [] : [...state.auditItems, ...(result.items || [])];
  state.auditTotal = Number(result.total || 0);
  state.auditQuery = query;
}

async function loadSignals(reset = true) {
  const query = $("#signalSearch").value.trim();
  const offset = reset || query !== state.signalQuery ? 0 : state.signalItems.length;
  const result = await api(`/api/v1/user/signals?limit=${COLLECTION_PAGE_SIZE}&offset=${offset}&q=${encodeURIComponent(query)}`);
  state.signalItems = offset === 0 ? result.items || [] : [...state.signalItems, ...(result.items || [])];
  state.signalTotal = Number(result.total || 0);
  state.signalQuery = query;
}

async function loadJobs(reset = true) {
  const query = $("#jobSearch").value.trim();
  const offset = reset || query !== state.jobQuery ? 0 : state.jobItems.length;
  const result = await api(`/api/v1/user/jobs?limit=${COLLECTION_PAGE_SIZE}&offset=${offset}&q=${encodeURIComponent(query)}`);
  state.jobItems = offset === 0 ? result.items || [] : [...state.jobItems, ...(result.items || [])];
  state.jobTotal = Number(result.total || 0);
  state.jobQuery = query;
}

async function loadOperationalTelemetry() {
  const window = $("#operationalWindow").value;
  const result = await api(`/api/v1/admin/operations/telemetry?window=${encodeURIComponent(window)}`);
  state.operationalTelemetry = result.telemetry || null;
}

async function loadBackgroundWork() {
  const result = await api("/api/v1/admin/workers");
  state.backgroundWork = result.backgroundWork || null;
}

async function loadAdminChanges() {
  state.adminChanges = await api("/api/v1/admin/change-requests?status=all&limit=100");
}

async function refresh(reloadCollections = true) {
  state.snapshot = await api("/api/v1/admin/snapshot");
  await Promise.all([loadOperationalTelemetry(), loadBackgroundWork(), loadAdminChanges()]);
  if (state.snapshot.authorization?.roleAdministrationEnabled === true) {
    const [users, roles] = await Promise.all([
      api("/api/v1/admin/authorization/users"),
      api("/api/v1/admin/authorization/roles")
    ]);
    state.authorizationUsers = users.users || [];
    state.authorizationRoles = roles.roles || [];
  } else {
    state.authorizationUsers = [];
    state.authorizationRoles = [];
  }
  if (reloadCollections) await Promise.all([loadLibrary(true), loadMissions(true), loadAudit(true), loadSignals(true), loadJobs(true)]);
  render();
}

let backgroundRefresh = null;
function refreshFromLoopback() {
  if (document.visibilityState !== "visible" || backgroundRefresh) return;
  backgroundRefresh = refresh(false).catch(() => undefined).finally(() => { backgroundRefresh = null; });
}

function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
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

function openStrategy(strategy = null) {
  state.editingStrategyId = strategy?.id || "";
  const form = $("#strategyForm"); form.reset();
  $("#strategyDialogTitle").textContent = strategy ? "Edit strategy" : "Add strategy";
  form.elements.id.value = strategy?.id || `strategy_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  form.elements.revision.value = strategy?.revision || 1;
  form.elements.name.value = strategy?.name || "";
  form.elements.position.value = strategy?.position || Math.max(10, ...(state.snapshot.strategies || []).map((item) => item.position + 10));
  form.elements.priceKind.value = strategy?.pricePolicy.kind || "at_or_below_msrp";
  form.elements.maxPrice.value = strategy?.pricePolicy.maxPriceCents ? (strategy.pricePolicy.maxPriceCents / 100).toFixed(2) : "";
  form.elements.tolerancePercent.value = Number(strategy?.pricePolicy.toleranceBps || 1000) / 100;
  form.elements.sellerPolicy.value = strategy?.sellerPolicy || "first_party_only";
  form.elements.allowedSellers.value = (strategy?.allowedSellers || []).join(", ");
  form.elements.action.value = strategy?.action || "notify";
  form.elements.quantity.value = strategy?.quantity || 1;
  form.elements.fulfillment.value = strategy?.fulfillment || "shipping";
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
  if (!mission?.id || !Array.isArray(mission.targets)) throw new Error("The mission details are unavailable.");
  state.editingMission = mission;
  const form = $("#missionForm");
  form.reset();
  form.elements.id.value = mission.id;
  form.elements.status.value = mission.status;
  form.elements.targetQuantity.value = mission.targetQuantity;
  $("#missionDialogTitle").textContent = mission.title;
  $("#missionTargetEditors").innerHTML = mission.targets.map((target) => `<article class="mission-target-editor" data-mission-target="${escapeHtml(target.id)}">
    <div class="card-top"><div><h3>${escapeHtml(target.retailerName)} · ${escapeHtml(target.retailerSku)}</h3><p>${escapeHtml(String(target.listingStatus).replaceAll("_", " "))} · last ${formatMoney(target.lastObservedPriceCents, target.currency)} · MSRP ${formatMoney(target.msrpCents, target.currency)}</p></div><span class="tag ${target.executionSupported ? "good" : "warning"}">${target.executionSupported ? "Executable mapping" : "Catalog only"}</span></div>
    <div class="form-grid">
      <label class="check-label"><input data-target-field="enabled" type="checkbox" ${target.enabled ? "checked" : ""}><span>Target enabled</span></label>
      <label><span>Target price cap</span><div class="money-input"><span>$</span><input data-target-field="maxUnitPrice" inputmode="decimal" value="${target.maxUnitPriceCents ? (target.maxUnitPriceCents / 100).toFixed(2) : ""}" placeholder="Use strategy cap"></div></label>
      <label><span>Seller policy</span><select data-target-field="sellerPolicy"><option value="inherit" ${target.sellerPolicy === "inherit" ? "selected" : ""}>Inherit strategy</option><option value="first_party_only" ${target.sellerPolicy === "first_party_only" ? "selected" : ""}>First party only</option><option value="allow_third_party" ${target.sellerPolicy === "allow_third_party" ? "selected" : ""}>Allow third party</option></select></label>
      <label><span>Fulfillment</span><select data-target-field="fulfillment"><option value="inherit" ${target.fulfillment === "inherit" ? "selected" : ""}>Inherit strategy</option><option value="shipping" ${target.fulfillment === "shipping" ? "selected" : ""}>Shipping</option><option value="pickup" ${target.fulfillment === "pickup" ? "selected" : ""}>Pickup</option><option value="either" ${target.fulfillment === "either" ? "selected" : ""}>Either</option><option value="manual" ${target.fulfillment === "manual" ? "selected" : ""}>Manual review</option></select></label>
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

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  try {
    if (button.dataset.view) setView(button.dataset.view);
    if (button.dataset.openView) setView(button.dataset.openView);
    if (button.hasAttribute("data-close-dialog")) button.closest("dialog")?.close();
    if (button.id === "addListingButton") $("#listingDialog").showModal();
    if (button.id === "sendSignalButton") { $("#signalForm").reset(); $("#signalDialog").showModal(); }
    if (button.id === "addStrategyButton") openStrategy();
    if (button.id === "proposeCatalogMergeButton") openCatalogIdentityForm("merge_variants");
    if (button.id === "proposeCatalogSplitButton") openCatalogIdentityForm("split_variant");
    if (button.id === "addOperatorAlertRuleButton") openOperatorAlertRule();
    if (button.id === "addOperatorAlertConnectorButton") openOperatorAlertConnector();
    if (button.dataset.workerScheduleToggle) {
      const schedule = (state.backgroundWork?.schedules || []).find((item) => item.id === button.dataset.workerScheduleToggle);
      if (!schedule) throw new Error("The background schedule is unavailable.");
      if (!confirm(`${schedule.enabled ? "Pause" : "Resume"} ${schedule.displayName}? This changes maintenance only and cannot authorize a retailer action.`)) return;
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
      if (!confirm("Retry this dead-lettered maintenance task? Attempts restart from zero, and the task still has no retailer mutation authority.")) return;
      await api(`/api/v1/admin/workers/tasks/${encodeURIComponent(button.dataset.workerTaskRetry)}/retry`, {
        method: "POST",
        body: "{}"
      });
      await loadBackgroundWork(); renderBackgroundWork();
      toast("Dead-lettered maintenance task queued for a bounded retry.");
    }
    if (button.dataset.signalInboxRetry) {
      if (!confirm("Retry this signal message after the parser or evaluation issue has been corrected? Its bounded attempt counter restarts from zero.")) return;
      await api(`/api/v1/admin/workers/signal-inbox/${encodeURIComponent(button.dataset.signalInboxRetry)}/retry`, {
        method: "POST",
        body: "{}"
      });
      await loadBackgroundWork(); renderBackgroundWork();
      toast("Signal message queued for corrected worker evaluation.");
    }
    if (button.dataset.adminChangeApprove) {
      if (!confirm("Approve this exact protected change? Approval does not apply it; the original operation must still be retried unchanged before expiry.")) return;
      await api(`/api/v1/admin/change-requests/${encodeURIComponent(button.dataset.adminChangeApprove)}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision: "approve", confirmation: "APPROVE_HIGH_RISK_CHANGE" })
      });
      await refresh(false);
      toast("Exact change approved. The original operation can now be retried once.");
    }
    if (button.dataset.adminChangeReject) {
      if (!confirm("Reject this protected change without applying it?")) return;
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
      if (!confirm("Replay this exact dead-letter alert once? The original delivery ID, payload, idempotency identity, and endpoint binding will be reused; the message cannot be edited or retargeted.")) return;
      await api(`/api/v1/admin/alerts/connector-deliveries/${encodeURIComponent(button.dataset.operatorAlertConnectorRetry)}/retry`, {
        method: "POST",
        body: JSON.stringify({
          reasonCode: "operator_verified_retry",
          confirmation: "RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY"
        })
      });
      await refresh(false);
      toast("The exact dead-letter alert was scheduled for bounded replay.");
    }
    if (button.dataset.operatorAlertAcknowledge) {
      const note = prompt("Optional non-sensitive acknowledgement note. Do not include page text, account data, product IDs, tokens, or personal information.", "Investigating the sanitized repair group.");
      if (note === null) return;
      await api(`/api/v1/admin/alerts/incidents/${encodeURIComponent(button.dataset.operatorAlertAcknowledge)}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ reasonCode: "operator_investigating", note, confirmation: "ACKNOWLEDGE_OPERATOR_ALERT" })
      });
      await refresh(false); toast("Operator alert acknowledged and audited.");
    }
    if (button.dataset.operatorAlertResolve) {
      const note = prompt("Describe the non-sensitive resolution. Do not include page text, account data, product IDs, tokens, or personal information.");
      if (!note?.trim()) return;
      if (!confirm("Resolve this operator alert? The same historical failure will stay closed; a strictly later failure may open a new incident.")) return;
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
    if (button.id === "refreshDevicesButton") { await refresh(); toast("Chrome device status refreshed."); }
    if (button.id === "copyPairingCodeButton" && state.pairing?.code) {
      await navigator.clipboard.writeText(state.pairing.code); toast("Pairing code copied.");
    }
    if (button.dataset.deviceRevoke) {
      if (confirm("Revoke this Chrome companion? It will need a new one-time code to reconnect.")) {
        await api(`/api/v1/user/devices/${encodeURIComponent(button.dataset.deviceRevoke)}/revoke`, { method: "POST", body: "{}" });
        await refresh(); toast("Chrome companion revoked.");
      }
    }
    if (button.dataset.catalogApprove) {
      if (!confirm("Approve this normalized exact listing change and apply it to the shared catalog? Existing retailer/SKU identity conflicts will still fail closed.")) return;
      await api(`/api/v1/admin/catalog/proposals/${encodeURIComponent(button.dataset.catalogApprove)}/decision`, {
        method: "POST",
        body: JSON.stringify({
          outcome: "approve",
          note: "Exact listing identifiers reviewed in the admin control center.",
          confirmation: "APPROVE_CATALOG_PROPOSAL"
        })
      });
      await refresh(); toast("Catalog proposal approved and applied.");
    }
    if (button.dataset.catalogReject) {
      const note = prompt("Why is this exact listing suggestion being rejected? This note is recorded in the audit trail.");
      if (!note?.trim()) return;
      await api(`/api/v1/admin/catalog/proposals/${encodeURIComponent(button.dataset.catalogReject)}/decision`, {
        method: "POST",
        body: JSON.stringify({ outcome: "reject", note, confirmation: "REJECT_CATALOG_PROPOSAL" })
      });
      await refresh(); toast("Catalog proposal rejected.");
    }
    if (button.dataset.catalogIdentityApprove) {
      const note = prompt("Record the independent evidence or safety rationale used for this catalog identity decision.");
      if (!note?.trim()) return;
      if (!confirm("Apply this exact topology operation? The live catalog must still match its immutable proposal hash, and active purchase work will fail closed.")) return;
      await api(`/api/v1/admin/catalog/identity-operations/${encodeURIComponent(button.dataset.catalogIdentityApprove)}/decision`, {
        method: "POST",
        body: JSON.stringify({ outcome: "approve", note, confirmation: "APPROVE_CATALOG_IDENTITY_OPERATION" })
      });
      await refresh(); toast("Catalog identity operation reviewed and applied.");
    }
    if (button.dataset.catalogIdentityReject) {
      const note = prompt("Why is this catalog identity operation being rejected?");
      if (!note?.trim()) return;
      await api(`/api/v1/admin/catalog/identity-operations/${encodeURIComponent(button.dataset.catalogIdentityReject)}/decision`, {
        method: "POST",
        body: JSON.stringify({ outcome: "reject", note, confirmation: "REJECT_CATALOG_IDENTITY_OPERATION" })
      });
      await refresh(); toast("Catalog identity operation rejected without changing topology.");
    }
    if (button.dataset.catalogIdentityRollback) {
      const reasonCode = prompt("Enter a short non-sensitive compensation reason code.", "compensating_catalog_rollback");
      if (!reasonCode?.trim()) return;
      if (!confirm("Propose a compensating rollback? It will not apply until reviewed, and any topology drift will block it.")) return;
      await api("/api/v1/admin/catalog/identity-operations", {
        method: "POST",
        body: JSON.stringify({
          kind: "rollback",
          reversedOperationId: button.dataset.catalogIdentityRollback,
          reasonCode,
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
      if (!confirm(`Revoke ${button.dataset.roleRevoke} from this user?`)) return;
      const result = await api(`/api/v1/admin/authorization/users/${encodeURIComponent(button.dataset.roleRevokeUser)}/roles/${encodeURIComponent(button.dataset.roleRevoke)}`, { method: "DELETE" });
      await refresh(false);
      if (!protectedChangePending(result)) toast("Role membership revoked and audited.");
    }
    if (button.id === "actionsToggle") {
      const paused = !state.snapshot.settings.actionsPaused;
      const result = await api("/api/v1/user/settings/actions", { method: "PATCH", body: JSON.stringify({ paused, reason: paused ? "Paused from the control center." : "Enabled from the control center." }) });
      await refresh();
      if (!protectedChangePending(result)) toast(paused ? "Actions paused. Signals will continue to be recorded." : "Qualified retailer add-only actions resumed.");
    }
    if (button.dataset.communityEnable) {
      const card = button.closest("[data-community-retailer]");
      const locationScope = await communityLocationScope(card);
      const approved = confirm(`Enable read-only community sharing for ${retailerName(button.dataset.communityEnable)}?\n\nOnly explicit one-at-a-time shares from the extension are permitted. Yoink sends normalized stock facts derived from server-accepted evidence; it never sends page HTML, clicks, forms, account data, payment data, or offer tokens. Community results remain advisory and cannot trigger actions.`);
      if (!approved) return;
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
      if (!confirm(`Physically delete all of your ${retailerName(button.dataset.communityDelete)} community assertions and receipts? Consent is unchanged.`)) return;
      await api(`/api/v1/user/community/contributions?retailer=${encodeURIComponent(button.dataset.communityDelete)}`, { method: "DELETE" });
      await refresh(false);
      toast(`${retailerName(button.dataset.communityDelete)} community contributions deleted.`);
    }
    if (button.id === "deleteAllCommunityButton") {
      if (!confirm("Physically delete your complete community assertion and receipt ledger? Store opt-ins are unchanged.")) return;
      await api("/api/v1/user/community/contributions", { method: "DELETE" });
      await refresh(false);
      toast("All community contributions deleted.");
    }
    if (button.dataset.identityReview && button.dataset.identityClaimId) {
      const reviewed = button.dataset.identityReview === "reviewed";
      const approved = confirm(reviewed
        ? "Record that you checked this exact identifier claim?\n\nThis is provenance only. It does not remap either listing, merge stock, move a mission, or satisfy independent community quorum."
        : "Reject this identity claim? The catalog and missions remain unchanged.");
      if (!approved) return;
      await api(`/api/v1/admin/identity/claims/${encodeURIComponent(button.dataset.identityClaimId)}/review`, {
        method: "POST",
        body: JSON.stringify({
          outcome: button.dataset.identityReview,
          note: reviewed ? "exact_identifier_checked" : "claim_rejected",
          confirmation: "REVIEW_IDENTITY_CLAIM_WITHOUT_REMAP"
        })
      });
      await refresh(false);
      toast(reviewed ? "Local identity review recorded without remapping." : "Identity claim rejected.");
    }
    if (button.id === "deleteIdentityClaimsButton") {
      if (!confirm("Physically delete all of your identity claims and review history? Catalog mappings and missions are unchanged.")) return;
      await api("/api/v1/user/identity/claims", { method: "DELETE" });
      await refresh(false);
      toast("Identity claim history deleted.");
    }
    if (button.id === "publishObserverWitnessButton") {
      if (!confirm("Publish the current public cryptographic checkpoint to the configured independent witness?\n\nNo selector data, browsing evidence, product data, user identity, or mutation authority is sent. Hosted recipe delivery remains closed unless the signed receipt is valid and fresh.")) return;
      button.disabled = true;
      await api("/api/v1/admin/observer-recipes/witness/publish", {
        method: "POST",
        body: JSON.stringify({ confirmation: "PUBLISH_OBSERVER_RECIPE_CHECKPOINT" })
      });
      await refresh(false);
      toast("Independent witness receipt verified and pinned.");
    }
    if (button.dataset.observerPromote && button.dataset.observerTarget) {
      const approved = confirm(`Promote this signed observer-only recipe to ${button.dataset.observerTarget.replaceAll("_", " ")}?\n\nThe extension still uses only its packaged interpreter. This recipe cannot execute code, decide product identity, navigate, click, fill forms, check out, or submit an order.`);
      if (!approved) return;
      const result = await api(`/api/v1/admin/observer-recipes/${encodeURIComponent(button.dataset.observerPromote)}/promote`, {
        method: "POST",
        body: JSON.stringify({ targetState: button.dataset.observerTarget, confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE" })
      });
      await refresh(false);
      if (!protectedChangePending(result)) toast(`Observer recipe promoted to ${button.dataset.observerTarget.replaceAll("_", " ")}.`);
    }
    if (button.dataset.observerDisable) {
      if (!confirm("Activate the observer recipe kill switch? Distribution stops immediately and the packaged observer remains available.")) return;
      const result = await api(`/api/v1/admin/observer-recipes/${encodeURIComponent(button.dataset.observerDisable)}/disable`, {
        method: "POST",
        body: JSON.stringify({ confirmation: "DISABLE_OBSERVER_RECIPE", reasonCode: "maintainer_kill_switch" })
      });
      await refresh(false);
      if (!protectedChangePending(result)) toast("Observer recipe disabled immediately.");
    }
    if (button.dataset.observerResign) {
      if (!confirm("Re-sign this already reviewed observer-only recipe with the current root-authorized intermediate?\n\nIts lifecycle state and selectors do not change. This restores read-only distribution after a trust rotation and cannot grant mutation authority.")) return;
      const result = await api(`/api/v1/admin/observer-recipes/${encodeURIComponent(button.dataset.observerResign)}/resign`, {
        method: "POST",
        body: JSON.stringify({ confirmation: "RESIGN_ROOTED_OBSERVER_RECIPE" })
      });
      await refresh(false);
      if (!protectedChangePending(result)) toast("Observer recipe re-signed under the current rooted trust generation.");
    }
    if (button.dataset.observerRollback) {
      if (!confirm("Disable this recipe and restore its pre-reviewed signed rollback target?")) return;
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
      const approved = confirm("Enable guarded Target adds?\n\nScope: Target-sold offers, shipping, quantity 1, add-to-cart only. Chrome will require an empty cart and revalidate SKU, seller, price, stock, and fulfillment immediately before clicking. Checkout and order submission remain disabled.");
      if (!approved) return;
      button.disabled = true;
      const result = await api("/api/v1/admin/qualifications/target-add/activate", {
        method: "POST",
        body: JSON.stringify({
          adapterVersion: readiness.addAdapterVersion,
          evidenceHash: readiness.qualificationEvidenceHash,
          confirmation: "ENABLE_TARGET_ADD_V1"
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
      const approved = confirm("Enable guarded Walmart adds?\n\nScope: Walmart-sold offers, explicitly verified shipping, quantity 1, add-to-cart only. Chrome will require an empty cart, stop at queues or challenges, and revalidate SKU, seller, price, stock, and fulfillment immediately before clicking. Checkout and order submission remain disabled.");
      if (!approved) return;
      button.disabled = true;
      const result = await api("/api/v1/admin/qualifications/walmart-add/activate", {
        method: "POST",
        body: JSON.stringify({
          adapterVersion: readiness.addAdapterVersion,
          evidenceHash: readiness.qualificationEvidenceHash,
          confirmation: "ENABLE_WALMART_ADD_V3"
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
      const approved = confirm("Enable guarded Amazon adds?\n\nScope: Amazon.com-sold offers with an exact ephemeral offer binding, explicitly verified shipping, quantity 1, add-to-cart only. Chrome will require an empty cart, stop at queues or challenges, and revalidate ASIN, seller, offer binding, price, stock, and fulfillment immediately before clicking. Buy Now, checkout, and order submission remain disabled.");
      if (!approved) return;
      button.disabled = true;
      const result = await api("/api/v1/admin/qualifications/amazon-add/activate", {
        method: "POST",
        body: JSON.stringify({
          adapterVersion: readiness.addAdapterVersion,
          evidenceHash: readiness.qualificationEvidenceHash,
          confirmation: "ENABLE_AMAZON_ADD_V5"
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
      const approved = confirm("Enable guarded Best Buy adds?\n\nScope: offers explicitly labeled Sold by Best Buy, shipping selected, quantity 1, add-to-cart only. Chrome will require an empty cart, stop at high-demand queues or challenges, and revalidate SKU, seller, price, stock, and fulfillment immediately before clicking. Marketplace, pickup, checkout, and order submission remain disabled.");
      if (!approved) return;
      button.disabled = true;
      const result = await api("/api/v1/admin/qualifications/bestbuy-add/activate", {
        method: "POST",
        body: JSON.stringify({
          adapterVersion: readiness.addAdapterVersion,
          evidenceHash: readiness.qualificationEvidenceHash,
          confirmation: "ENABLE_BESTBUY_ADD_V3"
        })
      });
      await refresh();
      if (!protectedChangePending(result)) toast("Guarded Best Buy add-only execution is active.");
    }
    if (button.dataset.reviewResolution && button.dataset.jobId) {
      const confirmed = button.dataset.reviewResolution === "confirmed";
      const approved = confirm(confirmed
        ? "Confirm this action succeeded?\n\nOnly do this after checking the retailer session and verifying the exact intended item/result. This updates mission fulfillment."
        : "Confirm no purchase completed?\n\nOnly do this after checking the retailer session/cart. This closes the incident so a legitimate future re-signal can try again.");
      if (!approved) return;
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
      await saveStrategies(strategies); toast("Strategy deleted.");
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

let librarySearchTimer;
$("#operationalWindow").addEventListener("change", async () => {
  try {
    await loadOperationalTelemetry();
    renderOperationalTelemetry();
  } catch (error) {
    toast(error.message || "Operational health could not be loaded.", true);
  }
});
$("#librarySearch").addEventListener("input", () => {
  clearTimeout(librarySearchTimer);
  librarySearchTimer = setTimeout(() => loadLibrary(true).then(renderLibrary).catch((error) => toast(error.message || "Library search failed.", true)), 250);
});
let missionSearchTimer;
$("#missionSearch").addEventListener("input", () => {
  clearTimeout(missionSearchTimer);
  missionSearchTimer = setTimeout(() => loadMissions(true).then(renderMissions).catch((error) => toast(error.message || "Mission search failed.", true)), 250);
});
let auditSearchTimer;
$("#auditSearch").addEventListener("input", () => {
  clearTimeout(auditSearchTimer);
  auditSearchTimer = setTimeout(() => loadAudit(true).then(renderAudit).catch((error) => toast(error.message || "Activity search failed.", true)), 250);
});
let signalSearchTimer;
$("#signalSearch").addEventListener("input", () => {
  clearTimeout(signalSearchTimer);
  signalSearchTimer = setTimeout(() => loadSignals(true).then(renderSignals).catch((error) => toast(error.message || "Opportunity search failed.", true)), 250);
});
let jobSearchTimer;
$("#jobSearch").addEventListener("input", () => {
  clearTimeout(jobSearchTimer);
  jobSearchTimer = setTimeout(() => loadJobs(true).then(renderJobs).catch((error) => toast(error.message || "Action search failed.", true)), 250);
});
$("#libraryMoreButton").addEventListener("click", async () => {
  try { await loadLibrary(false); renderLibrary(); } catch (error) { toast(error.message || "More listings could not be loaded.", true); }
});
$("#missionMoreButton").addEventListener("click", async () => {
  try { await loadMissions(false); renderMissions(); } catch (error) { toast(error.message || "More missions could not be loaded.", true); }
});
$("#auditMoreButton").addEventListener("click", async () => {
  try { await loadAudit(false); renderAudit(); } catch (error) { toast(error.message || "More activity could not be loaded.", true); }
});
$("#signalMoreButton").addEventListener("click", async () => {
  try { await loadSignals(false); renderSignals(); } catch (error) { toast(error.message || "More opportunities could not be loaded.", true); }
});
$("#jobMoreButton").addEventListener("click", async () => {
  try { await loadJobs(false); renderJobs(); } catch (error) { toast(error.message || "More actions could not be loaded.", true); }
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
    if (!confirm("Submit this immutable topology proposal for catalog review? No catalog row changes until approval.")) return;
    await api("/api/v1/admin/catalog/identity-operations", { method: "POST", body: JSON.stringify(payload) });
    $("#catalogIdentityDialog").close();
    await refresh();
    toast("Catalog identity operation submitted for governed review.");
  } catch (error) { toast(error.message || "Catalog identity proposal failed.", true); }
});
$("#listingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = formObject(event.currentTarget);
    const source = state.snapshot.sources.find((item) => item.id === values.sourceConnectionId)?.source;
    if (!source) throw new Error("Choose an available source connection.");
    await api("/api/v1/user/catalog/proposals", { method: "POST", body: JSON.stringify({
      sourceConnectionId: values.sourceConnectionId, source,
      sourceProductId: values.sourceProductId, sourceListingId: values.sourceListingId,
      title: values.title, retailerId: values.retailerId, retailerSku: values.retailerSku,
      canonicalUrl: values.canonicalUrl, listingStatus: values.listingStatus,
      executionSupported: event.currentTarget.elements.executionSupported.checked,
      msrpCents: dollarsToCents(values.msrp), currency: "USD"
    }) });
    event.currentTarget.closest("dialog").close(); await refresh(); toast("Exact listing change submitted for governed review.");
  } catch (error) { toast(error.message || "Listing could not be saved.", true); }
});

$("#strategyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = formObject(event.currentTarget);
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
      quantity: values.quantity === "max" ? "max" : Number(values.quantity), fulfillment: values.fulfillment,
      maxSignalAgeSeconds: Number(values.maxSignalAgeSeconds)
    };
    const others = state.snapshot.strategies.filter((item) => item.id !== strategy.id);
    await saveStrategies([...others, strategy].sort((left, right) => left.position - right.position));
    event.currentTarget.closest("dialog").close(); toast("Strategy saved. The first matching rule wins.");
  } catch (error) { toast(error.message || "Strategy could not be saved.", true); }
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
    if (!targets.length) throw new Error("This mission has no exact listing targets.");
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
    toast("Mission and retailer target guardrails saved.");
  } catch (error) { toast(error.message || "Mission could not be saved.", true); }
});

$("#identityClaimForm").addEventListener("input", () => { state.identityDirty = true; });
$("#identityClaimForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = formObject(event.currentTarget);
    if (!values.listingId || !values.referenceListingId || values.listingId === values.referenceListingId) {
      throw new Error("Choose two different exact retailer listings.");
    }
    const approved = confirm("Propose this cross-store identity claim?\n\nOnly exact identifiers and selected variant attributes are accepted. The claim will not remap the catalog, merge inventory, transfer a mission, or authorize an action.");
    if (!approved) return;
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
    const approved = confirm("Install this offline-root signed trust manifest?\n\nYoink will verify the packaged root, exact schema, monotonic generation, predecessor hash, active key, lifetimes, and permanent revocation set. This does not grant any retailer mutation authority.");
    if (!approved) return;
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
    const approved = confirm("Submit this recipe to quarantine?\n\nThe server will reject any field, selector, attribute, or operation outside the packaged observer-only schema. Submission does not distribute or execute the recipe.");
    if (!approved) return;
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
    toast("Signal and order guardrails saved.");
  } catch (error) { toast(error.message || "Settings could not be saved.", true); }
});

$("#attributionForm").addEventListener("input", () => { state.attributionDirty = true; });
$("#attributionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const policies = $$("[data-attribution-retailer]", $("#attributionPolicyEditors")).map((editor) => ({
      retailerId: editor.dataset.attributionRetailer,
      enabled: $("[data-attribution-field='enabled']", editor).checked,
      provider: $("[data-attribution-field='provider']", editor).value,
      publisherSlug: $("[data-attribution-field='publisherSlug']", editor).value,
      articleBaseUrl: $("[data-attribution-field='articleBaseUrl']", editor).value,
      associateTag: $("[data-attribution-field='associateTag']", editor).value
    }));
    const result = await api("/api/v1/admin/attribution-policies", {
      method: "PUT",
      body: JSON.stringify({ policies })
    });
    state.attributionDirty = false;
    await refresh();
    if (!protectedChangePending(result)) toast("Affiliate routing policies saved and validated.");
  } catch (error) { toast(error.message || "Affiliate routing could not be saved.", true); }
});

$("#signalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = formObject(event.currentTarget);
    const source = state.snapshot.sources.find((item) => item.id === values.sourceConnectionId)?.source;
    const body = {
      sourceConnectionId: values.sourceConnectionId, source,
      externalEventId: values.externalEventId, eventType: values.eventType,
      observedAt: new Date().toISOString(), test: event.currentTarget.elements.test.checked,
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
      evidence: { headline: `${values.title} signal`, body: `Submitted through the local Yoink control center.` },
      parserVersion: "control-center-v1"
    };
    const result = await api("/api/v1/user/signals", { method: "POST", body: JSON.stringify(body) });
    event.currentTarget.closest("dialog").close(); await refresh(); toast(`Signal accepted: ${result.decision.replaceAll("_", " ")}.`);
  } catch (error) { toast(error.message || "Signal could not be sent.", true); }
});

window.addEventListener("hashchange", () => setView(location.hash.slice(1) || "overview"));

try {
  await refresh();
  const requested = location.hash.slice(1);
  if ($(`[data-view-panel="${CSS.escape(requested)}"]`)) setView(requested); else setView("overview");
} catch (error) {
  toast(error.message || "Yoink could not load.", true);
  $("#heroStatus").innerHTML = `<div class="empty">Control plane unavailable.</div>`;
}

setInterval(refreshFromLoopback, 3_000);
