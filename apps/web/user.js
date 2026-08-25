const state = {
  overview: null,
  products: [],
  plans: [],
  actions: [],
  proposals: [],
  editingPlan: null,
  setupProduct: null,
  setupPreflight: null,
  setupPreflightRevision: 0,
  setupPreflightTimer: null,
  productLinkPreview: null,
  productLinkPreviewInput: "",
  privacy: null,
  recoveryEvidence: [],
  recoveryRetention: null,
  contributorEligibility: null,
  query: ""
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;"
  })[character]);
}

function money(cents, currency = "USD") {
  if (cents === null || cents === undefined || cents === "" || !Number.isFinite(Number(cents))) return "No price recorded";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(cents) / 100);
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
  if (!Number.isFinite(dollars) || dollars <= 0 || Math.round(dollars * 100) > 100_000_000) {
    throw new Error(`${label} must be a positive dollar amount or blank.`);
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
  if (Math.abs(minutes) < 60) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(minutes, "minute");
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(minutes / 60), "hour");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reference = payload.correlationId ? ` Reference ${payload.correlationId}.` : "";
    const error = new Error(`${payload.message || `Yoink request failed with HTTP ${response.status}.`}${reference}`);
    error.code = String(payload.error || "request_failed");
    error.status = response.status;
    throw error;
  }
  return payload;
}

let toastTimer;
function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 4500);
}

function setTab(name) {
  $$("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  $$("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
}

function words(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
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
    pokemoncenter: "Pokémon Center"
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
    return `<a class="button ${quiet ? "quiet" : "secondary"}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  }
  return `<button class="button ${quiet ? "quiet" : "secondary"}" data-setup-action="${escapeHtml(action)}" type="button">${escapeHtml(label)}</button>`;
}

function renderSetupGuide() {
  const guide = $("#setupGuide");
  const setup = state.overview?.setup;
  if (!setup || !Array.isArray(setup.steps)) {
    guide.hidden = true;
    return;
  }
  guide.hidden = false;
  $("#setupGuideHeadline").textContent = setup.headline;
  $("#setupGuideCopy").textContent = setup.summary;
  const completed = Math.max(0, Math.min(Number(setup.totalSteps || 5), Number(setup.completedSteps || 0)));
  const total = Math.max(1, Number(setup.totalSteps || 5));
  $("#setupProgressBar").style.width = `${Math.round(completed * 100 / total)}%`;
  $("#setupProgress").setAttribute("aria-valuemax", String(total));
  $("#setupProgress").setAttribute("aria-valuenow", String(completed));
  $("#setupProgressCopy").textContent = `${completed} of ${total} steps ready`;
  $("#setupSteps").innerHTML = setup.steps.map((item, index) => `<article class="setup-step ${escapeHtml(item.state)}">
    <div class="setup-step-head"><span class="setup-step-number">${item.state === "complete" ? "✓" : index + 1}</span><h4>${escapeHtml(item.title)}</h4><span class="sr-only">${escapeHtml(item.state)}</span></div>
    <p>${escapeHtml(item.summary)}</p>
    <div class="setup-step-actions">${setupActionMarkup(item.primaryAction, item.primaryActionLabel)}${setupActionMarkup(item.secondaryAction, item.secondaryActionLabel, true)}</div>
  </article>`).join("");
}

function renderOverview() {
  const { settings, counts, sources, permissions, spend } = state.overview;
  const paused = settings.actionsPaused === true;
  $("#modePill").textContent = `${settings.executionMode} mode`;
  for (const button of [$("#pauseButton"), $("#preferencePauseButton")]) {
    button.textContent = paused ? "Resume qualified actions" : "Pause all actions";
  }
  $("#actionStateCopy").textContent = paused
    ? "Purchase actions are paused. Product signals and notifications continue."
    : "Qualified add-only actions may run within each purchase plan’s limits.";
  $("#adminLink").hidden = !permissions.includes("admin.read");
  const connectedSources = (sources || []).filter((source) => source.status === "connected").length;
  $("#heroState").innerHTML = `
    <div class="state-row"><span><i class="dot ${paused ? "warn" : "good"}"></i>Actions</span><strong>${paused ? "Paused" : "Enabled"}</strong></div>
    <div class="state-row"><span><i class="dot ${connectedSources ? "good" : "warn"}"></i>Signal sources</span><strong>${connectedSources} connected</strong></div>
    <div class="state-row"><span><i class="dot ${Number(spend?.activeReservationCount || 0) ? "warn" : "good"}"></i>Reserved capacity</span><strong>${escapeHtml(money(spend?.activeReservedCents || 0))}</strong></div>
    <div class="state-row"><span><i class="dot good"></i>Checkout</span><strong>Manual only</strong></div>`;
  const metricRows = [
    [counts.products, "Known listings"],
    [counts.purchaseIntents, "Purchase plans"],
    [counts.actions, "Recorded actions"],
    [counts.pendingCatalogProposals, "Suggestions in review"]
  ];
  $("#metrics").innerHTML = metricRows.map(([value, label]) => `<article class="metric"><strong>${Number(value || 0).toLocaleString()}</strong><span>${escapeHtml(label)}</span></article>`).join("");
  $("#sourceList").innerHTML = (sources || []).map((source) => `<div class="mini-row"><span>${escapeHtml(source.name)}</span><strong>${escapeHtml(source.status)}</strong></div>`).join("") || '<div class="mini-row"><span>No sources configured</span></div>';
  const companionLink = $("#companionDownloadLink");
  const configuredCompanionUrl = state.overview?.setup?.companion?.downloadUrl;
  const companionUrl = configuredCompanionUrl === undefined
    ? "/api/v1/extension/release/download"
    : configuredCompanionUrl;
  companionLink.hidden = !companionUrl;
  if (companionUrl) companionLink.href = companionUrl;
  renderSetupGuide();
  renderSpend(spend);
}

function renderSpend(spend) {
  if (!spend) return;
  $("#spendSummary").textContent = `${money(spend.activeReservedCents)} reserved · ${money(spend.spentTodayCents)} spent today · order submission remains closed.`;
  const form = $("#spendForm");
  if (form.contains(document.activeElement)) return;
  form.elements.revision.value = spend.policy.revision;
  form.elements.perOrder.value = moneyInput(spend.policy.perOrderCapCents);
  form.elements.daily.value = moneyInput(spend.policy.dailyCapCents);
  form.elements.monthly.value = moneyInput(spend.policy.monthlyCapCents);
}

function renderPrivacy() {
  const inventory = state.privacy;
  if (!inventory) return;
  const categories = Array.isArray(inventory.categories) ? inventory.categories : [];
  $("#privacySummary").textContent = `${Number(inventory.totalRecords || 0).toLocaleString()} records across ${categories.length} private categories are ready in one versioned JSON file.`;
  $("#privacyCategories").innerHTML = categories.map((category) => `<div class="mini-row"><span>${escapeHtml(category.label)}</span><strong>${Number(category.recordCount || 0).toLocaleString()}</strong></div>`).join("");
  $("#privacyBoundary").textContent = inventory.credentialMaterialsExcluded === true
    ? "Device tokens, pairing codes, request nonces, and action capabilities are excluded. Other users and tenant-wide administrator data are never included. Account deletion stays closed until hosted identity revocation and durable cleanup are proven."
    : "The data-export boundary is unavailable; do not download until Yoink can verify credential exclusion.";
  $("#privacyExportLink").hidden = inventory.credentialMaterialsExcluded !== true;
}

function recoveryValue(item) {
  if (item.valueKind === "cents") return money(Number(item.normalizedValue), "USD");
  if (item.valueKind === "boolean") return item.normalizedValue ? "Add control available" : "Add control unavailable";
  if (item.valueKind === "enum") return words(item.normalizedValue);
  return String(item.normalizedValue ?? "");
}

function renderRecoveryEvidence() {
  const items = Array.isArray(state.recoveryEvidence) ? state.recoveryEvidence : [];
  const retentionDays = Number(state.recoveryRetention?.retentionDays || 90);
  const eligibleDevices = Number(state.contributorEligibility?.externallyAttestedDeviceCount || 0);
  const eligibilityCopy = eligibleDevices > 0
    ? ` Hosted mode automatically verified ${eligibleDevices} Chrome companion${eligibleDevices === 1 ? "" : "s"} for coarse-region safety; you do not need to configure this.`
    : " Local-mode reviews stay private and never count as independent public-account evidence.";
  const waiting = items.filter((item) => !["confirmed", "rejected"].includes(item.reviewState)).length;
  $("#recoveryReviewSummary").textContent = !items.length
    ? `Nothing needs your review right now. Quarantined details are automatically removed after ${retentionDays} days without new review activity.${eligibilityCopy}`
    : waiting
      ? `${waiting} of ${items.length} quarantined store detail${items.length === 1 ? "" : "s"} can use your review. Details expire after ${retentionDays} inactive days.${eligibilityCopy}`
      : `You reviewed all ${items.length} quarantined store detail${items.length === 1 ? "" : "s"}. You can still change or withdraw an answer; review activity resets the ${retentionDays}-day expiry.${eligibilityCopy}`;
  const fieldNames = {
    availability: "Availability",
    unitPrice: "Price",
    seller: "Seller",
    fulfillment: "Delivery method",
    addControl: "Add-to-cart control"
  };
  $("#recoveryReviewList").innerHTML = items.map((item) => {
    const reviewState = String(item.reviewState || "unreviewed");
    const stateLabel = reviewState === "confirmed" ? "You marked this correct"
      : reviewState === "rejected" ? "You marked this incorrect"
        : reviewState === "revoked" ? "Confirmation withdrawn" : "Not reviewed";
    const stateKind = reviewState === "confirmed" ? "good" : "warn";
    const externallyEligible = item.contributorEligibilityState === "externally_attested";
    const confirm = reviewState !== "confirmed"
      ? `<button class="button secondary" data-recovery-evidence="${escapeHtml(item.id)}" data-recovery-decision="confirmed" type="button">${reviewState === "unreviewed" ? "Yes, correct" : "Mark correct"}</button>`
      : "";
    const reject = reviewState !== "rejected"
      ? `<button class="button quiet" data-recovery-evidence="${escapeHtml(item.id)}" data-recovery-decision="rejected" type="button">No, incorrect</button>`
      : "";
    const revoke = reviewState === "confirmed"
      ? `<button class="button quiet" data-recovery-evidence="${escapeHtml(item.id)}" data-recovery-decision="revoked" type="button">Withdraw confirmation</button>`
      : "";
    return `<article class="recovery-review-item"><div><h4>${escapeHtml(retailerDisplayName(item.retailerId))} item ${escapeHtml(item.retailerSku)} · ${escapeHtml(fieldNames[item.field] || words(item.field))}</h4><p>Yoink read <strong>${escapeHtml(recoveryValue(item))}</strong>. Does that match what the store page showed?</p><div class="recovery-review-meta"><span class="tag ${stateKind}">${escapeHtml(stateLabel)}</span><span class="tag">Quarantined · never applied</span><span class="tag ${externallyEligible ? "good" : "warn"}">${externallyEligible ? "Hosted account + coarse region checked" : "Private review only · not public quorum"}</span>${item.retentionExpiresAt ? `<span class="tag">Automatically removed ${escapeHtml(relative(item.retentionExpiresAt))}</span>` : ""}</div></div><div class="recovery-review-actions">${item.confirmableByCurrentUser === false ? "" : `${confirm}${reject}${revoke}`}</div></article>`;
  }).join("");
}

function renderProducts() {
  const missionByVariant = new Map(state.plans.map((plan) => [plan.variantId, plan]));
  $("#productList").innerHTML = state.products.length ? state.products.map((product) => {
    const plan = missionByVariant.get(product.variantId);
    const available = ["in_stock", "preorder"].includes(product.status);
    const exactVariant = variantSummary(product.variantAttributes);
    const hasCurrentPrice = product.currentPriceCents !== null
      && product.currentPriceCents !== undefined
      && Number.isFinite(Number(product.currentPriceCents));
    const currentPrice = hasCurrentPrice
      ? product.currentPriceCents
      : product.msrpCents;
    const priceKind = hasCurrentPrice ? "Last seen" : "Catalog price";
    return `<article class="product-card">
      <div class="card-top"><span class="store">${escapeHtml(product.retailerName)}</span><span class="tag ${available ? "good" : "warn"}">${escapeHtml(String(product.status).replaceAll("_", " "))}</span></div>
      <h3>${escapeHtml(product.title)}</h3>
      <p>Exact store item ${escapeHtml(product.retailerSku)}${exactVariant ? ` · ${escapeHtml(exactVariant)}` : ""}</p>
      <div class="tags"><span class="tag">${escapeHtml(priceKind)} ${escapeHtml(money(currentPrice, product.currency))}${hasCurrentPrice && product.priceObservedAt ? ` · ${escapeHtml(relative(product.priceObservedAt))}` : ""}</span><span class="tag ${guardedLaneReady(product.retailerId) ? "good" : ""}">${product.executionSupported ? guardedLaneReady(product.retailerId) ? "Qualified guarded add" : "Packaged mapping · lane pending" : "Monitor only"}</span></div>
      <div class="card-actions">
        ${plan ? `<button class="button secondary" data-edit-plan="${escapeHtml(plan.id)}" type="button">Edit purchase plan</button>` : `<button class="button primary" data-track-listing="${escapeHtml(product.listingId)}" type="button">Set up purchase</button>`}
        <a class="canonical" href="${escapeHtml(product.canonicalUrl)}" target="_blank" rel="noreferrer">View at store ↗</a>
      </div>
    </article>`;
  }).join("") : '<div class="empty"><p>No approved exact products match yet. Paste a supported store product page and Yoink will hold the exact item for independent review.</p><button class="button secondary" data-open-product-link type="button">Add product link</button></div>';
}

function renderWalmartDraws() {
  const draws = state.overview.walmartDraws || {};
  const latest = draws.latestScan || null;
  const items = Array.isArray(draws.items) ? draws.items : [];
  $("#walmartDrawSummary").innerHTML = `<article class="plan-card"><div><div class="card-top"><h3>Read-only drawing observer</h3><span class="tag ${latest?.outcome === "passed" ? "good" : "warn"}">${escapeHtml(latest ? String(latest.outcome).replaceAll("_", " ") : "not scanned")}</span></div><p>${latest ? `${Number(latest.observedCardCount || 0)} of ${Number(latest.expectedCardCount || 0)} cards recorded ${relative(latest.observedAt)}.` : "Open the Walmart Draw hub and choose Inspect current drawings in the Chrome companion."} No entry was submitted, and Yoink does not collect drawing account, address, payment, or entry state.</p></div><a class="canonical" href="https://www.walmart.com/shop/collectibles/draw" target="_blank" rel="noreferrer">Open drawing hub ↗</a></article>`;
  $("#walmartDrawList").innerHTML = items.length ? items.map((item) => `<article class="product-card">
    <div class="card-top"><span class="store">Walmart</span><span class="tag ${item.drawState === "active" ? "good" : "warn"}">${escapeHtml(String(item.drawState || "unknown"))}</span></div>
    <h3>${escapeHtml(item.title)}</h3>
    <p>Exact Walmart item ${escapeHtml(item.retailerSku)} · ${escapeHtml(item.sellerName || "seller unknown")}</p>
    <div class="tags"><span class="tag">${escapeHtml(money(item.unitPriceCents, item.currency))}</span><span class="tag">${item.closesAt ? `Closes ${escapeHtml(relative(item.closesAt))}` : "Closing time unknown"}</span><span class="tag ${item.tracked ? "good" : ""}">${item.tracked ? "Matches your plan" : "Not tracked"}</span></div>
    <div class="card-actions"><a class="canonical" href="${escapeHtml(item.canonicalUrl)}" target="_blank" rel="noreferrer">View exact item ↗</a><span class="tag warn">Manual entry only</span></div>
  </article>`).join("") : '<div class="empty">No open drawings are currently recorded. Run one explicit inspection from the Walmart Draw hub; expired drawings disappear from this view.</div>';
}

function automationReadinessMarkup(readiness) {
  if (!readiness || typeof readiness !== "object") return "";
  const ready = readiness.level === "ready";
  const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
  const checkMarkup = checks.map((item) => {
    const symbol = item.state === "pass" ? "✓" : item.state === "runtime" ? "↻" : "•";
    return `<li class="${escapeHtml(item.state)}"><span aria-hidden="true">${symbol}</span><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div></li>`;
  }).join("");
  return `<section class="automation-readiness ${escapeHtml(readiness.level || "waiting")}" aria-label="Automation readiness">
    <div class="automation-readiness-head"><span class="tag ${ready ? "good" : "warn"}">${ready ? "Ready" : readiness.level === "off" ? "Off" : "Needs attention"}</span><strong>${escapeHtml(readiness.headline || "Automation status unavailable")}</strong></div>
    <p>${escapeHtml(readiness.summary || "")}</p>
    ${readiness.nextActionLabel ? `<small class="automation-next"><strong>Next:</strong> ${escapeHtml(readiness.nextActionLabel)}</small>` : ""}
    ${checkMarkup ? `<details><summary>Why this status</summary><ul>${checkMarkup}</ul></details>` : ""}
  </section>`;
}

function renderPlans() {
  $("#planList").innerHTML = state.plans.length ? state.plans.map((plan) => {
    const store = plan.primaryRetailerName || "No store enabled";
    const current = plan.primaryCurrentPriceCents ? money(plan.primaryCurrentPriceCents) : "not seen yet";
    const maximum = plan.primaryMaxUnitPriceCents ? money(plan.primaryMaxUnitPriceCents) : "not set";
    const fulfillment = words(plan.primaryFulfillment || "not selected");
    const action = plan.actionCeiling === "add_to_cart" ? "May add one to cart" : "Notifications only";
    const decision = plan.decisionMode === "purchase_intent" ? "This reviewed plan decides" : "Advanced defaults decide";
    return `<article class="plan-card">
      <div><div class="card-top"><h3>${escapeHtml(plan.title)}</h3><span class="tag ${plan.status === "active" ? "good" : "warn"}">${escapeHtml(plan.status)}</span></div>
      <p><strong>${escapeHtml(store)}</strong>${plan.primaryRetailerSku ? ` · exact item ${escapeHtml(plan.primaryRetailerSku)}` : ""} · last seen ${escapeHtml(current)} · maximum ${escapeHtml(maximum)}</p>
      <p>Quantity ${Number(plan.targetQuantity || 1)} · ${escapeHtml(fulfillment)} · ${escapeHtml(action)} · maximum total ${escapeHtml(plan.maxAllInCents ? money(plan.maxAllInCents) : "not set")} · ${Number(plan.enabledTargetCount || 0)} of ${Number(plan.targetCount || 0)} stores enabled</p>
      <p>${escapeHtml(decision)} when a fresh exact offer arrives. Guarded cart attempts always add exactly one item.</p>
      ${automationReadinessMarkup(plan.automationReadiness)}</div>
      <button class="button secondary" data-edit-plan="${escapeHtml(plan.id)}" type="button">Review or change</button>
    </article>`;
  }).join("") : '<div class="empty">You have no purchase plans. Choose “Set up purchase” from the Products tab and review the exact limits before creating one.</div>';
}

function renderActions() {
  $("#actionList").innerHTML = state.actions.length ? state.actions.map((action) => `<article class="action-card">
    <div><div class="card-top"><h3>${escapeHtml(action.title)}</h3><span class="tag ${action.state === "confirmed" ? "good" : "warn"}">${escapeHtml(String(action.state).replaceAll("_", " "))}</span></div>
    <p>${escapeHtml(action.retailerId)} · ${escapeHtml(action.retailerSku)} · ${escapeHtml(String(action.action).replaceAll("_", " "))} · ${action.decisionSource === "purchase_intent" ? "reviewed plan" : "advanced default"} · unit cap ${escapeHtml(money(action.maxUnitPriceCents, action.currency))}${action.spendReservationStatus ? ` · reservation ${escapeHtml(action.spendReservationStatus)}` : ""}</p></div>
    <a class="canonical" href="${escapeHtml(action.canonicalUrl)}" target="_blank" rel="noreferrer">Store page ↗</a>
  </article>`).join("") : '<div class="empty">No purchase or notification actions have been recorded yet.</div>';
}

function renderProposals() {
  const pending = state.proposals.filter((proposal) => proposal.status === "pending");
  $("#proposalCopy").textContent = pending.length
    ? `${pending.length} product suggestion${pending.length === 1 ? " is" : "s are"} waiting for independent review.`
    : "You have no product suggestions waiting for review.";
  $("#proposalList").innerHTML = pending.slice(0, 5).map((proposal) => `<div class="mini-row"><span>${escapeHtml(proposal.payload.title)}</span><strong>${escapeHtml(proposal.retailerId)}</strong></div>`).join("");
}

async function refresh() {
  const query = state.query ? `&q=${encodeURIComponent(state.query)}` : "";
  const [overview, products, plans, actions, proposals, privacy, recoveryEvidence] = await Promise.all([
    api("/api/v1/user/overview"),
    api(`/api/v1/user/library?limit=200&offset=0${query}`),
    api("/api/v1/user/purchase-intents?limit=200&offset=0"),
    api("/api/v1/user/jobs?limit=100&offset=0"),
    api("/api/v1/user/catalog/proposals?limit=100&offset=0"),
    state.privacy ? Promise.resolve({ inventory: state.privacy }) : api("/api/v1/user/privacy"),
    api("/api/v1/user/community/recovery-evidence")
  ]);
  state.overview = overview;
  state.products = products.items || [];
  state.plans = plans.items || [];
  state.actions = actions.items || [];
  state.proposals = proposals.items || [];
  state.privacy = privacy.inventory || null;
  state.recoveryEvidence = recoveryEvidence.items || [];
  state.recoveryRetention = recoveryEvidence.retention || null;
  state.contributorEligibility = recoveryEvidence.contributorEligibility || null;
  renderOverview(); renderProducts(); renderWalmartDraws(); renderPlans(); renderActions(); renderProposals(); renderPrivacy(); renderRecoveryEvidence();
}

async function toggleActions() {
  const paused = state.overview.settings.actionsPaused !== true;
  const result = await api("/api/v1/user/settings/actions", {
    method: "PATCH",
    body: JSON.stringify({ paused, reason: paused ? "Paused from the user dashboard." : "Resumed from the user dashboard." })
  });
  await refresh();
  if (result.disposition === "pending_approval") {
    toast("Resume request sent for independent approval. Purchase actions remain paused.");
    return;
  }
  toast(paused ? "All purchase actions are paused." : "Qualified purchase actions are enabled within your saved limits.");
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
  if (!state.setupProduct) throw new Error("Choose the exact store product again before continuing.");
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
    fulfillment: form.elements.fulfillment.value,
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
    <div><small>Server-required total</small><b>${escapeHtml(money(cost.minimumAllInCents, currency))}</b></div>
    <div><small>Tax + store reserve</small><b>${escapeHtml(money(Number(cost.taxReserveCents || 0) + Number(cost.storeReserveCents || 0), currency))}</b></div>
    <div><small>Room within your limit</small><b>${escapeHtml(money(cost.headroomCents, currency))}</b></div>
  </div>` : "";
  element.innerHTML = `<div><span>${mode === "ready" ? "Server checked" : mode === "error" ? "Needs attention" : "Server check"}</span><strong>${escapeHtml(headline)}</strong></div>
    <p>${escapeHtml(copy)}</p>${costs}`;
}

function updateSetupCreateState() {
  const form = $("#setupForm");
  const reviewed = form.elements.reviewed;
  $("#createPlanButton").disabled = !state.setupPreflight || reviewed.checked !== true;
}

function invalidateSetupPreflight() {
  clearTimeout(state.setupPreflightTimer);
  state.setupPreflightTimer = null;
  state.setupPreflight = null;
  state.setupPreflightRevision += 1;
  const reviewed = $("#setupForm").elements.reviewed;
  reviewed.checked = false;
  reviewed.disabled = true;
  renderSetupPreflight("checking", "Checking your current choices", "Yoink will validate this exact plan without saving it.");
  updateSetupCreateState();
  return state.setupPreflightRevision;
}

function scheduleSetupPreflight(delay = 250) {
  const revision = invalidateSetupPreflight();
  state.setupPreflightTimer = setTimeout(() => void requestSetupPreflight(revision), delay);
}

async function requestSetupPreflight(revision) {
  if (revision !== state.setupPreflightRevision || !state.setupProduct || !$("#setupDialog").hasAttribute("open")) return;
  let draft;
  try {
    draft = setupDraftPayload("PREFLIGHT_EXACT_PURCHASE_PLAN");
  } catch (error) {
    if (revision === state.setupPreflightRevision) {
      renderSetupPreflight("error", "Complete the plan details", error.message || "Review the highlighted values.");
    }
    return;
  }
  renderSetupPreflight("checking", "Checking price and automation limits", "The server is evaluating this exact draft. No purchase plan has been saved.");
  try {
    const result = await api("/api/v1/user/purchase-intents/preflight", {
      method: "POST",
      body: JSON.stringify(draft)
    });
    if (revision !== state.setupPreflightRevision) return;
    const preflight = result.preflight;
    if (!preflight || preflight.noPurchasePlanSaved !== true
      || !/^[a-f0-9]{64}$/.test(String(preflight.preflightFingerprint || ""))
      || !preflight.preflightedAt) {
      throw new Error("The server did not return a complete no-write plan check.");
    }
    state.setupPreflight = preflight;
    const readiness = preflight.automationReadiness || {};
    renderSetupPreflight(
      "ready",
      "Ready for your review",
      `After saving: ${readiness.headline || "the plan will use these exact limits"}. ${readiness.summary || "Fresh offer checks still apply."} No purchase plan was saved by this check.`,
      preflight
    );
    $("#setupForm").elements.reviewed.disabled = false;
    updateSetupCreateState();
  } catch (error) {
    if (revision !== state.setupPreflightRevision) return;
    renderSetupPreflight("error", "Fix this before saving", error.message || "The server could not validate this exact plan.");
    updateSetupCreateState();
  }
}

function syncSetupAction() {
  const form = $("#setupForm");
  const adding = form.elements.actionCeiling.value === "add_to_cart";
  if (adding) form.elements.fulfillment.value = "shipping";
  form.elements.fulfillment.disabled = adding;
  const note = $("#setupExecutionNote");
  const minimum = setupAutomaticMinimum();
  const reviewedTotal = setupAmount("maxAllIn", "Maximum total");
  const totalTooLow = adding && minimum && (reviewedTotal === null || reviewedTotal < minimum.required);
  const laneReady = guardedLaneReady(state.setupProduct?.retailerId);
  form.elements.maxAllIn.setAttribute("aria-invalid", totalTooLow ? "true" : "false");
  note.className = `boundary-note ${state.setupProduct?.executionSupported && (!adding || laneReady) && !totalTooLow ? "good" : "warn"}`;
  note.textContent = state.setupProduct?.executionSupported
    ? adding
      ? !laneReady
        ? "This store has a packaged runner, but its separate guarded-add qualification is not active. You may save the plan now; monitoring continues while every retailer click stays closed."
        : minimum
        ? totalTooLow
          ? `Your current maximum total is below the ${money(minimum.required)} tax and store-fee safety bound. Raise it only if that remains an amount you accept, or choose notifications.`
          : `Your reviewed total covers the current ${money(minimum.required)} tax and store-fee safety bound. Each guarded attempt adds exactly one item, and Chrome still requires fresh exact-offer verification.`
        : "Enter the item price and quantity to calculate the minimum safe total for a cart action."
      : "This store has a packaged add mapping, but this plan currently authorizes notifications only."
    : "This store is monitor-only. Yoink can notify you, but it cannot click its cart control.";
}

function renderSetupReview() {
  const form = $("#setupForm");
  const product = state.setupProduct;
  if (!product) return;
  const quantity = Math.max(1, Number(form.elements.targetQuantity.value || 1));
  const unit = setupAmount("maxUnitPrice", "Maximum item price");
  const allIn = setupAmount("maxAllIn", "Maximum total");
  const action = form.elements.actionCeiling.value === "add_to_cart" ? "Add one to cart" : "Notify me only";
  const automaticMinimum = setupAutomaticMinimum();
  const expiry = form.elements.expiresAt.value
    ? new Date(form.elements.expiresAt.value).toLocaleString()
    : "No end date";
  const rows = [
    ["Exact item", product.retailerSku],
    ["Store / seller", `${product.retailerName} itself`],
    ["Quantity", String(quantity)],
    ["Maximum each", unit === null ? "Enter an amount" : money(unit, product.currency)],
    ["Maximum total", allIn === null ? "Enter an amount" : money(allIn, product.currency)],
    ...(form.elements.actionCeiling.value === "add_to_cart" && automaticMinimum
      ? [["Minimum safe cart bound", money(automaticMinimum.required, product.currency)]]
      : []),
    ["Availability", words(form.elements.fulfillment.value)],
    ["Yoink may", action],
    ["Substitutions", "None — exact item only"],
    ["Stops", expiry]
  ];
  $("#setupReviewRows").innerHTML = rows.map(([label, value]) => `<div class="review-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

function openSetup(listingId) {
  const product = state.products.find((item) => item.listingId === listingId);
  if (!product) throw new Error("That exact product is no longer in the current catalog view. Refresh and try again.");
  const existing = state.plans.find((plan) => plan.variantId === product.variantId);
  if (existing) return openPlan(existing.id);
  state.setupProduct = product;
  state.setupPreflight = null;
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
  if (addRadio.disabled) form.elements.actionCeiling.value = "notify";
  const exactVariant = variantSummary(product.variantAttributes);
  $("#setupProductSummary").innerHTML = `<div><span class="store">${escapeHtml(product.retailerName)}</span><h3>${escapeHtml(product.title)}</h3><p>Exact item ${escapeHtml(product.retailerSku)}${exactVariant ? ` · ${escapeHtml(exactVariant)}` : ""}</p></div><strong class="exact-price">${escapeHtml(hasCurrentPrice ? money(knownPrice, product.currency) : money(product.msrpCents, product.currency))}</strong>`;
  $("#setupStore").textContent = product.retailerName;
  $("#setupReviewTitle").textContent = product.title;
  syncSetupAction();
  renderSetupReview();
  $("#setupDialog").showModal();
  scheduleSetupPreflight(0);
  requestAnimationFrame(() => form.elements.targetQuantity.focus());
}

async function openPlan(id) {
  const { purchaseIntent: mission } = await api(`/api/v1/user/purchase-intents/${encodeURIComponent(id)}`);
  state.editingPlan = mission;
  const form = $("#planForm");
  form.elements.id.value = mission.id;
  form.elements.status.value = mission.status;
  form.elements.targetQuantity.value = mission.targetQuantity;
  const policy = mission.intentPolicy || {};
  form.elements.maxAllIn.value = moneyInput(policy.maxAllInCents);
  const directPlan = policy.decisionMode === "purchase_intent";
  form.elements.actionCeiling.value = directPlan && ["notify", "add_to_cart"].includes(policy.actionCeiling)
    ? policy.actionCeiling
    : "notify";
  form.elements.substitutionPolicy.value = policy.substitutionPolicy || "exact_only";
  form.elements.cooldownMinutes.value = Math.round(Number(policy.cooldownSeconds || 0) / 60);
  form.elements.expiresAt.value = localDateTime(policy.expiresAt);
  $("#planModeTitle").textContent = directPlan
    ? "This reviewed plan decides directly; advanced strategies are optional."
    : "This source-created plan currently uses advanced defaults.";
  $("#planModeCopy").textContent = directPlan
    ? "Checkout stays manual. These limits can authorize only qualified add-only actions and never authorize checkout or order submission."
    : "Saving here converts it to a reviewed direct plan in notification mode unless you explicitly choose and satisfy guarded cart requirements. Checkout stays manual.";
  $("#planDialogTitle").textContent = mission.title;
  $("#targetEditors").innerHTML = mission.targets.map((target) => `<article class="target-editor" data-target-id="${escapeHtml(target.id)}" data-retailer-id="${escapeHtml(target.retailerId)}" data-execution-supported="${target.executionSupported === true}">
    <div class="card-top"><div><strong>${escapeHtml(target.retailerName)}</strong><p>${escapeHtml(target.retailerSku)} · ${escapeHtml(money(target.lastObservedPriceCents, target.currency))}</p></div><a class="canonical" href="${escapeHtml(target.canonicalUrl)}" target="_blank" rel="noreferrer">View ↗</a></div>
    <div class="target-fields">
      <label class="check"><input data-field="enabled" type="checkbox" ${target.enabled ? "checked" : ""}><span>Use store</span></label>
      <label><span>Maximum price</span><input data-field="maxPrice" inputmode="decimal" placeholder="Strategy limit" value="${target.maxUnitPriceCents ? (target.maxUnitPriceCents / 100).toFixed(2) : ""}"></label>
      <label><span>Seller</span><select data-field="sellerPolicy"><option value="inherit" ${target.sellerPolicy === "inherit" ? "selected" : ""}>Use default</option><option value="first_party_only" ${target.sellerPolicy === "first_party_only" ? "selected" : ""}>Store only</option><option value="allow_third_party" ${target.sellerPolicy === "allow_third_party" ? "selected" : ""}>Marketplace allowed</option></select></label>
      <label><span>Fulfillment</span><select data-field="fulfillment"><option value="inherit" ${target.fulfillment === "inherit" ? "selected" : ""}>Use default</option><option value="shipping" ${target.fulfillment === "shipping" ? "selected" : ""}>Shipping</option><option value="pickup" ${target.fulfillment === "pickup" ? "selected" : ""}>Pickup</option><option value="either" ${target.fulfillment === "either" ? "selected" : ""}>Either</option><option value="manual" ${target.fulfillment === "manual" ? "selected" : ""}>Manual only</option></select></label>
    </div>
  </article>`).join("");
  syncPlanAction();
  $("#planDialog").showModal();
}

function planTargetDrafts(form, strict = false) {
  return $$("[data-target-id]", form).map((card) => {
    const rawPrice = $("[data-field=maxPrice]", card).value.trim();
    const dollars = rawPrice ? Number(rawPrice) : null;
    if (strict && dollars !== null && (!Number.isFinite(dollars) || dollars <= 0)) {
      throw new Error("Every enabled store needs a positive maximum item price for cart actions.");
    }
    return {
      id: card.dataset.targetId,
      retailerId: card.dataset.retailerId,
      executionSupported: card.dataset.executionSupported === "true",
      enabled: $("[data-field=enabled]", card).checked,
      maxUnitPriceCents: dollars !== null && Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null,
      sellerPolicy: $("[data-field=sellerPolicy]", card).value,
      fulfillment: $("[data-field=fulfillment]", card).value
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
  if (adding && normalizeTargets) {
    $$("[data-target-id]", form).forEach((card) => {
      if ($("[data-field=enabled]", card).checked) {
        $("[data-field=sellerPolicy]", card).value = "first_party_only";
        $("[data-field=fulfillment]", card).value = "shipping";
      }
    });
  }
  const targets = planTargetDrafts(form);
  const enabled = targets.filter((target) => target.enabled);
  const unsafe = enabled.find((target) => !target.executionSupported
    || target.maxUnitPriceCents === null
    || target.sellerPolicy !== "first_party_only"
    || target.fulfillment !== "shipping");
  const minimum = planAutomaticMinimum(form, targets);
  const reviewedTotal = (() => {
    try { return centsInput(form.elements.maxAllIn.value, "The all-in cap"); } catch { return null; }
  })();
  const totalTooLow = adding && minimum !== null && (reviewedTotal === null || reviewedTotal < minimum);
  form.elements.maxAllIn.setAttribute("aria-invalid", totalTooLow ? "true" : "false");
  const note = $("#planExecutionNote");
  note.className = `boundary-note ${!adding || (enabled.length && !unsafe && !totalTooLow) ? "good" : "warn"}`;
  note.textContent = !adding
    ? "Fresh exact matches create notifications. No retailer control is clicked."
    : !enabled.length
      ? "Enable one exact store before choosing a cart action."
      : unsafe
        ? "Every enabled cart store needs a qualified add mapping, a maximum item price, Store only seller, and Shipping."
        : minimum === null
          ? "Enter a valid quantity and maximum item price for every enabled store."
          : totalTooLow
            ? `Raise the maximum total to at least ${money(minimum)} only if you accept that bound, or choose notifications.`
            : `The reviewed total covers the current ${money(minimum)} tax and store-fee safety bound. Each guarded attempt adds exactly one item, and Chrome still rechecks the exact live offer before any click.`;
}

async function createPairingCode(showPreferences = false) {
  if (showPreferences) setTab("preferences");
  const result = await api("/api/v1/user/devices/pairing-code", { method: "POST", body: "{}" });
  $("#pairing").hidden = false;
  $("#pairing").innerHTML = `<span>One-time code</span><strong>${escapeHtml(result.pairing.code)}</strong><small>Expires ${escapeHtml(relative(result.pairing.expiresAt))}</small>`;
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

function openProductLinkDialog() {
  const form = $("#productLinkForm");
  form.reset();
  clearProductLinkPreview();
  $("#productLinkDialog").showModal();
  requestAnimationFrame(() => form.elements.url.focus());
}

async function checkProductLink() {
  const form = $("#productLinkForm");
  const url = form.elements.url.value.trim();
  if (!url) throw new Error("Paste the exact store product page first.");
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
    $("#productLinkPreview").innerHTML = `<div class="card-top"><span class="store">${escapeHtml(preview.retailerName)}</span><span class="tag good">Exact item found</span></div>
      <h3>${escapeHtml(preview.retailerSku)}</h3>
      <p>${escapeHtml(preview.capabilityLabel)}</p>
      <p><strong>Not accepted from this link:</strong> stock status, price, seller, fulfillment, or permission to purchase.</p>
      <a class="canonical" href="${escapeHtml(preview.canonicalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(preview.canonicalUrl)} ↗</a>`;
    $("#productLinkConfirm").hidden = false;
    $("#productLinkConfirm").querySelector("input").focus();
  } finally {
    button.disabled = false;
    button.textContent = "Check exact link";
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  try {
    if (button.dataset.tab) setTab(button.dataset.tab);
    if (button.hasAttribute("data-close-dialog")) button.closest("dialog")?.close();
    if (button.id === "pauseButton" || button.id === "preferencePauseButton") await toggleActions();
    if (button.id === "addProductButton" || button.hasAttribute("data-open-product-link")) openProductLinkDialog();
    if (button.id === "checkProductLinkButton") await checkProductLink();
    if (button.dataset.trackListing) {
      await openSetup(button.dataset.trackListing);
    }
    if (button.dataset.editPlan) await openPlan(button.dataset.editPlan);
    if (button.id === "pairButton") {
      await createPairingCode();
    }
    if (button.dataset.recoveryEvidence && button.dataset.recoveryDecision) {
      const confirmations = {
        confirmed: "CONFIRM_NORMALIZED_RECOVERY_EVIDENCE",
        rejected: "REJECT_NORMALIZED_RECOVERY_EVIDENCE",
        revoked: "REVOKE_NORMALIZED_RECOVERY_CONFIRMATION"
      };
      const decision = button.dataset.recoveryDecision;
      const confirmation = confirmations[decision];
      if (!confirmation) throw new Error("Choose a valid store-detail review answer.");
      button.disabled = true;
      try {
        const result = await api(`/api/v1/user/community/recovery-evidence/${encodeURIComponent(button.dataset.recoveryEvidence)}/review`, {
          method: "POST",
          body: JSON.stringify({ contractVersion: 1, decision, confirmation })
        });
        await refresh();
        setTab("preferences");
        const review = result.review || {};
        toast(review.disposition === "unchanged"
          ? "That answer was already saved. The evidence remains quarantined and unused."
          : decision === "confirmed"
            ? "Review saved. The evidence remains quarantined and will not fill fields or trigger actions."
            : decision === "rejected"
              ? "Marked incorrect. The evidence remains quarantined and unused."
              : "Confirmation withdrawn. The evidence remains quarantined and unused.");
      } finally {
        button.disabled = false;
      }
    }
    if (button.dataset.setupAction === "pair_companion") await createPairingCode(true);
    if (button.dataset.setupAction === "connect_signal") {
      setTab("preferences");
      toast("Open the Yoink Chrome companion, sign in to TrackaLacker, then choose Connect.");
    }
    if (button.dataset.setupAction === "add_product") openProductLinkDialog();
    if (button.dataset.setupAction === "choose_product") {
      setTab("products");
      toast("Choose an approved exact product, then select Set up purchase.");
    }
    if (button.dataset.setupAction === "resume_actions") await toggleActions();
  } catch (error) { toast(error.message || "The request failed.", true); }
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
      throw new Error("Check the exact product link again before sending it for review.");
    }
    if (form.elements.confirmed.checked !== true) {
      throw new Error("Confirm the exact product-page review boundary first.");
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
    $("#productLinkDialog").close();
    clearProductLinkPreview();
    await refresh();
    setTab("preferences");
    toast(result.disposition === "duplicate_pending"
      ? "That exact product suggestion is already waiting for review."
      : "Exact product link sent for independent review. No stock claim, purchase plan, or store action was created.");
  } catch (error) {
    toast(error.message || "The product link could not be sent for review.", true);
  } finally {
    button.disabled = !state.productLinkPreview || form.elements.confirmed.checked !== true;
    button.textContent = "Send for review";
  }
});

$("#setupForm").addEventListener("input", (event) => {
  if (event.target.name === "reviewed") {
    updateSetupCreateState();
    return;
  }
  syncSetupAction();
  renderSetupReview();
  scheduleSetupPreflight();
});

$("#setupForm").addEventListener("change", (event) => {
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

$("#setupDialog").addEventListener("close", () => {
  clearTimeout(state.setupPreflightTimer);
  state.setupPreflightTimer = null;
  state.setupPreflight = null;
  state.setupPreflightRevision += 1;
  updateSetupCreateState();
});

$("#setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#createPlanButton");
  try {
    if (!state.setupPreflight) throw new Error("Wait for the current server check before creating this purchase plan.");
    if (form.elements.reviewed.checked !== true) throw new Error("Review and confirm the current server-checked plan first.");
    const draft = setupDraftPayload("CREATE_EXACT_PURCHASE_PLAN");
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
    await refresh();
    setTab("plans");
    toast(draft.actionCeiling === "add_to_cart"
      ? "Purchase plan created. Its readiness card shows whether the exact store lane is armed; checkout stays manual."
      : "Purchase plan created in notification-only mode.");
  } catch (error) {
    if (error.code === "purchase_intent_exists") {
      $("#setupDialog").close();
      state.setupProduct = null;
      await refresh();
      setTab("plans");
      toast("That exact product already has a purchase plan. Review its current limits before changing it.");
    } else {
      if (["purchase_intent_preflight_required", "purchase_intent_preflight_stale"].includes(error.code)) {
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

$("#planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const drafts = planTargetDrafts(form, true);
    const targets = drafts.map(({ retailerId: _retailerId, executionSupported: _executionSupported, ...target }) => target);
    const actionCeiling = form.elements.actionCeiling.value;
    const maxAllInCents = centsInput(form.elements.maxAllIn.value, "The all-in cap");
    if (actionCeiling === "add_to_cart") {
      const enabled = drafts.filter((target) => target.enabled);
      if (!enabled.length) throw new Error("Enable one exact store before choosing a cart action.");
      if (enabled.some((target) => !target.executionSupported
        || target.maxUnitPriceCents === null
        || target.sellerPolicy !== "first_party_only"
        || target.fulfillment !== "shipping")) {
        throw new Error("Every enabled cart store needs a qualified add mapping, a maximum item price, Store only seller, and Shipping.");
      }
      const minimum = planAutomaticMinimum(form, drafts);
      if (minimum === null || maxAllInCents === null || maxAllInCents < minimum) {
        throw new Error(`Guarded cart actions need a maximum total of at least ${minimum === null ? "the calculated safety bound" : money(minimum)}.`);
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
          substitutionPolicy: event.currentTarget.elements.substitutionPolicy.value,
          cooldownSeconds: Number(event.currentTarget.elements.cooldownMinutes.value || 0) * 60,
          expiresAt: expiresValue ? new Date(expiresValue).toISOString() : "",
          changeReason: "Updated from the user purchase dashboard."
        }
      })
    });
    $("#planDialog").close(); await refresh(); toast("Purchase preferences saved.");
  } catch (error) { toast(error.message || "Preferences could not be saved.", true); }
});

$("#spendForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/v1/user/spend-policy", {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: Number(event.currentTarget.elements.revision.value),
        perOrderCapCents: centsInput(event.currentTarget.elements.perOrder.value, "The per-order cap"),
        dailyCapCents: centsInput(event.currentTarget.elements.daily.value, "The daily cap"),
        monthlyCapCents: centsInput(event.currentTarget.elements.monthly.value, "The monthly cap")
      })
    });
    await refresh();
    toast("Spending limits saved.");
  } catch (error) { toast(error.message || "Spending limits could not be saved.", true); }
});

let searchTimer;
$("#productSearch").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    state.query = event.target.value.trim();
    try { await refresh(); } catch (error) { toast(error.message || "Product search failed.", true); }
  }, 250);
});

refresh().catch((error) => toast(error.message || "Yoink could not load.", true));
setInterval(() => { if (document.visibilityState === "visible") refresh().catch(() => undefined); }, 20_000);
