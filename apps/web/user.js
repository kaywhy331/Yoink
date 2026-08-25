const state = {
  overview: null,
  products: [],
  plans: [],
  actions: [],
  proposals: [],
  editingPlan: null,
  setupProduct: null,
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

function variantSummary(attributes) {
  if (!attributes || typeof attributes !== "object") return "";
  return Object.entries(attributes)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([name, value]) => `${words(name)} ${value}`)
    .join(" · ");
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
      <div class="tags"><span class="tag">${escapeHtml(priceKind)} ${escapeHtml(money(currentPrice, product.currency))}${hasCurrentPrice && product.priceObservedAt ? ` · ${escapeHtml(relative(product.priceObservedAt))}` : ""}</span><span class="tag">${product.executionSupported ? "Qualified add mapping" : "Monitor only"}</span></div>
      <div class="card-actions">
        ${plan ? `<button class="button secondary" data-edit-plan="${escapeHtml(plan.id)}" type="button">Edit purchase plan</button>` : `<button class="button primary" data-track-listing="${escapeHtml(product.listingId)}" type="button">Set up purchase</button>`}
        <a class="canonical" href="${escapeHtml(product.canonicalUrl)}" target="_blank" rel="noreferrer">View at store ↗</a>
      </div>
    </article>`;
  }).join("") : '<div class="empty">No exact products match yet. Connect a source in the Chrome companion or ask an administrator to review a product suggestion.</div>';
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

function renderPlans() {
  $("#planList").innerHTML = state.plans.length ? state.plans.map((plan) => {
    const store = plan.primaryRetailerName || "No store enabled";
    const current = plan.primaryCurrentPriceCents ? money(plan.primaryCurrentPriceCents) : "not seen yet";
    const maximum = plan.primaryMaxUnitPriceCents ? money(plan.primaryMaxUnitPriceCents) : "not set";
    const fulfillment = words(plan.primaryFulfillment || "not selected");
    const action = plan.actionCeiling === "add_to_cart" ? "May add one to cart" : "Notifications only";
    return `<article class="plan-card">
      <div><div class="card-top"><h3>${escapeHtml(plan.title)}</h3><span class="tag ${plan.status === "active" ? "good" : "warn"}">${escapeHtml(plan.status)}</span></div>
      <p><strong>${escapeHtml(store)}</strong>${plan.primaryRetailerSku ? ` · exact item ${escapeHtml(plan.primaryRetailerSku)}` : ""} · last seen ${escapeHtml(current)} · maximum ${escapeHtml(maximum)}</p>
      <p>Quantity ${Number(plan.targetQuantity || 1)} · ${escapeHtml(fulfillment)} · ${escapeHtml(action)} · maximum total ${escapeHtml(plan.maxAllInCents ? money(plan.maxAllInCents) : "not set")} · ${Number(plan.enabledTargetCount || 0)} of ${Number(plan.targetCount || 0)} stores enabled</p></div>
      <button class="button secondary" data-edit-plan="${escapeHtml(plan.id)}" type="button">Review or change</button>
    </article>`;
  }).join("") : '<div class="empty">You have no purchase plans. Choose “Set up purchase” from the Products tab and review the exact limits before creating one.</div>';
}

function renderActions() {
  $("#actionList").innerHTML = state.actions.length ? state.actions.map((action) => `<article class="action-card">
    <div><div class="card-top"><h3>${escapeHtml(action.title)}</h3><span class="tag ${action.state === "confirmed" ? "good" : "warn"}">${escapeHtml(String(action.state).replaceAll("_", " "))}</span></div>
    <p>${escapeHtml(action.retailerId)} · ${escapeHtml(action.retailerSku)} · ${escapeHtml(String(action.action).replaceAll("_", " "))} · unit cap ${escapeHtml(money(action.maxUnitPriceCents, action.currency))}${action.spendReservationStatus ? ` · reservation ${escapeHtml(action.spendReservationStatus)}` : ""}</p></div>
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
  const [overview, products, plans, actions, proposals] = await Promise.all([
    api("/api/v1/user/overview"),
    api(`/api/v1/user/library?limit=200&offset=0${query}`),
    api("/api/v1/user/purchase-intents?limit=200&offset=0"),
    api("/api/v1/user/jobs?limit=100&offset=0"),
    api("/api/v1/user/catalog/proposals?limit=100&offset=0")
  ]);
  state.overview = overview;
  state.products = products.items || [];
  state.plans = plans.items || [];
  state.actions = actions.items || [];
  state.proposals = proposals.items || [];
  renderOverview(); renderProducts(); renderWalmartDraws(); renderPlans(); renderActions(); renderProposals();
}

async function toggleActions() {
  const paused = state.overview.settings.actionsPaused !== true;
  await api("/api/v1/user/settings/actions", {
    method: "PATCH",
    body: JSON.stringify({ paused, reason: paused ? "Paused from the user dashboard." : "Resumed from the user dashboard." })
  });
  await refresh();
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

function syncSetupAction() {
  const form = $("#setupForm");
  const adding = form.elements.actionCeiling.value === "add_to_cart";
  if (adding) form.elements.fulfillment.value = "shipping";
  form.elements.fulfillment.disabled = adding;
  const note = $("#setupExecutionNote");
  const minimum = setupAutomaticMinimum();
  const reviewedTotal = setupAmount("maxAllIn", "Maximum total");
  const totalTooLow = adding && minimum && (reviewedTotal === null || reviewedTotal < minimum.required);
  form.elements.maxAllIn.setAttribute("aria-invalid", totalTooLow ? "true" : "false");
  note.className = `boundary-note ${state.setupProduct?.executionSupported && !totalTooLow ? "good" : "warn"}`;
  note.textContent = state.setupProduct?.executionSupported
    ? adding
      ? minimum
        ? totalTooLow
          ? `Your current maximum total is below the ${money(minimum.required)} tax and store-fee safety bound. Raise it only if that remains an amount you accept, or choose notifications.`
          : `Your reviewed total covers the current ${money(minimum.required)} tax and store-fee safety bound. A cart click still requires fresh exact-offer verification in Chrome.`
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
  const form = $("#setupForm");
  form.reset();
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
  form.elements.actionCeiling.value = ["notify", "add_to_cart"].includes(policy.actionCeiling) ? policy.actionCeiling : "notify";
  form.elements.substitutionPolicy.value = policy.substitutionPolicy || "exact_only";
  form.elements.cooldownMinutes.value = Math.round(Number(policy.cooldownSeconds || 0) / 60);
  form.elements.expiresAt.value = localDateTime(policy.expiresAt);
  $("#planDialogTitle").textContent = mission.title;
  $("#targetEditors").innerHTML = mission.targets.map((target) => `<article class="target-editor" data-target-id="${escapeHtml(target.id)}">
    <div class="card-top"><div><strong>${escapeHtml(target.retailerName)}</strong><p>${escapeHtml(target.retailerSku)} · ${escapeHtml(money(target.lastObservedPriceCents, target.currency))}</p></div><a class="canonical" href="${escapeHtml(target.canonicalUrl)}" target="_blank" rel="noreferrer">View ↗</a></div>
    <div class="target-fields">
      <label class="check"><input data-field="enabled" type="checkbox" ${target.enabled ? "checked" : ""}><span>Use store</span></label>
      <label><span>Maximum price</span><input data-field="maxPrice" inputmode="decimal" placeholder="Strategy limit" value="${target.maxUnitPriceCents ? (target.maxUnitPriceCents / 100).toFixed(2) : ""}"></label>
      <label><span>Seller</span><select data-field="sellerPolicy"><option value="inherit" ${target.sellerPolicy === "inherit" ? "selected" : ""}>Use default</option><option value="first_party_only" ${target.sellerPolicy === "first_party_only" ? "selected" : ""}>Store only</option><option value="allow_third_party" ${target.sellerPolicy === "allow_third_party" ? "selected" : ""}>Marketplace allowed</option></select></label>
      <label><span>Fulfillment</span><select data-field="fulfillment"><option value="inherit" ${target.fulfillment === "inherit" ? "selected" : ""}>Use default</option><option value="shipping" ${target.fulfillment === "shipping" ? "selected" : ""}>Shipping</option><option value="pickup" ${target.fulfillment === "pickup" ? "selected" : ""}>Pickup</option><option value="either" ${target.fulfillment === "either" ? "selected" : ""}>Either</option><option value="manual" ${target.fulfillment === "manual" ? "selected" : ""}>Manual only</option></select></label>
    </div>
  </article>`).join("");
  $("#planDialog").showModal();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  try {
    if (button.dataset.tab) setTab(button.dataset.tab);
    if (button.hasAttribute("data-close-dialog")) button.closest("dialog")?.close();
    if (button.id === "pauseButton" || button.id === "preferencePauseButton") await toggleActions();
    if (button.dataset.trackListing) {
      await openSetup(button.dataset.trackListing);
    }
    if (button.dataset.editPlan) await openPlan(button.dataset.editPlan);
    if (button.id === "pairButton") {
      const result = await api("/api/v1/user/devices/pairing-code", { method: "POST", body: "{}" });
      $("#pairing").hidden = false;
      $("#pairing").innerHTML = `<span>One-time code</span><strong>${escapeHtml(result.pairing.code)}</strong><small>Expires ${escapeHtml(relative(result.pairing.expiresAt))}</small>`;
      toast("Enter this one-time code in the Yoink Chrome companion.");
    }
  } catch (error) { toast(error.message || "The request failed.", true); }
});

$("#setupForm").addEventListener("input", (event) => {
  syncSetupAction();
  renderSetupReview();
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
});

$("#setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#createPlanButton");
  try {
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
    if (actionCeiling === "add_to_cart" && state.setupProduct?.executionSupported !== true) {
      throw new Error("This store is monitor-only and cannot be authorized for cart actions.");
    }
    const automaticMinimum = setupAutomaticMinimum();
    if (actionCeiling === "add_to_cart" && automaticMinimum && maxAllInCents < automaticMinimum.required) {
      throw new Error(`Automatic cart actions need a maximum total of at least ${money(automaticMinimum.required)} under your current tax and store-fee safety reserve.`);
    }
    const expiresValue = form.elements.expiresAt.value;
    const expiresAt = expiresValue ? new Date(expiresValue).toISOString() : "";
    button.disabled = true;
    button.textContent = "Creating safely…";
    await api("/api/v1/user/purchase-intents", {
      method: "POST",
      body: JSON.stringify({
        contractVersion: 1,
        listingId: form.elements.listingId.value,
        targetQuantity,
        maxUnitPriceCents,
        maxAllInCents,
        actionCeiling,
        sellerPolicy: "first_party_only",
        fulfillment: form.elements.fulfillment.value,
        substitutionPolicy: "exact_only",
        expiresAt,
        cooldownSeconds: cooldownMinutes * 60,
        confirmation: "CREATE_EXACT_PURCHASE_PLAN"
      })
    });
    $("#setupDialog").close();
    state.setupProduct = null;
    await refresh();
    setTab("plans");
    toast(actionCeiling === "add_to_cart"
      ? "Purchase plan created. Only a qualified exact shipping offer may be added to your cart; checkout stays manual."
      : "Purchase plan created in notification-only mode.");
  } catch (error) {
    if (error.code === "purchase_intent_exists") {
      $("#setupDialog").close();
      state.setupProduct = null;
      await refresh();
      setTab("plans");
      toast("That exact product already has a purchase plan. Review its current limits before changing it.");
    } else {
      toast(error.message || "The purchase plan could not be created.", true);
    }
  } finally {
    button.disabled = false;
    button.textContent = "Create purchase plan";
  }
});

$("#planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const targets = $$("[data-target-id]", event.currentTarget).map((card) => {
      const rawPrice = $("[data-field=maxPrice]", card).value.trim();
      const dollars = rawPrice ? Number(rawPrice) : null;
      if (dollars !== null && (!Number.isFinite(dollars) || dollars <= 0)) throw new Error("Every price cap must be a positive amount or blank.");
      return {
        id: card.dataset.targetId,
        enabled: $("[data-field=enabled]", card).checked,
        maxUnitPriceCents: dollars === null ? null : Math.round(dollars * 100),
        sellerPolicy: $("[data-field=sellerPolicy]", card).value,
        fulfillment: $("[data-field=fulfillment]", card).value
      };
    });
    const expiresValue = event.currentTarget.elements.expiresAt.value;
    await api(`/api/v1/user/purchase-intents/${encodeURIComponent(event.currentTarget.elements.id.value)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: event.currentTarget.elements.status.value,
        targetQuantity: Number(event.currentTarget.elements.targetQuantity.value),
        targets,
        policy: {
          expectedRevision: Number(state.editingPlan.intentPolicy?.revision || 1),
          maxAllInCents: centsInput(event.currentTarget.elements.maxAllIn.value, "The all-in cap"),
          actionCeiling: event.currentTarget.elements.actionCeiling.value,
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
