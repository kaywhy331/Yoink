const state = { overview: null, products: [], plans: [], actions: [], proposals: [], editingPlan: null, query: "" };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;"
  })[character]);
}

function money(cents, currency = "USD") {
  if (!Number.isFinite(Number(cents))) return "No price recorded";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(cents) / 100);
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
    throw new Error(`${payload.message || `Yoink request failed with HTTP ${response.status}.`}${reference}`);
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

function renderOverview() {
  const { settings, counts, sources, permissions } = state.overview;
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
    <div class="state-row"><span><i class="dot good"></i>Checkout</span><strong>Manual only</strong></div>`;
  const metricRows = [
    [counts.products, "Known listings"],
    [counts.purchaseIntents, "Purchase plans"],
    [counts.actions, "Recorded actions"],
    [counts.pendingCatalogProposals, "Suggestions in review"]
  ];
  $("#metrics").innerHTML = metricRows.map(([value, label]) => `<article class="metric"><strong>${Number(value || 0).toLocaleString()}</strong><span>${escapeHtml(label)}</span></article>`).join("");
  $("#sourceList").innerHTML = (sources || []).map((source) => `<div class="mini-row"><span>${escapeHtml(source.name)}</span><strong>${escapeHtml(source.status)}</strong></div>`).join("") || '<div class="mini-row"><span>No sources configured</span></div>';
}

function renderProducts() {
  const missionByVariant = new Map(state.plans.map((plan) => [plan.variantId, plan]));
  $("#productList").innerHTML = state.products.length ? state.products.map((product) => {
    const plan = missionByVariant.get(product.variantId);
    const available = ["in_stock", "preorder"].includes(product.status);
    return `<article class="product-card">
      <div class="card-top"><span class="store">${escapeHtml(product.retailerName)}</span><span class="tag ${available ? "good" : "warn"}">${escapeHtml(String(product.status).replaceAll("_", " "))}</span></div>
      <h3>${escapeHtml(product.title)}</h3>
      <p>Exact store item ${escapeHtml(product.retailerSku)}</p>
      <div class="tags"><span class="tag">${escapeHtml(money(product.msrpCents, product.currency))}</span><span class="tag">${product.executionSupported ? "Qualified mapping" : "Monitor only"}</span></div>
      <div class="card-actions">
        ${plan ? `<button class="button secondary" data-edit-plan="${escapeHtml(plan.id)}" type="button">Edit preferences</button>` : `<button class="button primary" data-track-listing="${escapeHtml(product.listingId)}" type="button">Track product</button>`}
        <a class="canonical" href="${escapeHtml(product.canonicalUrl)}" target="_blank" rel="noreferrer">View at store ↗</a>
      </div>
    </article>`;
  }).join("") : '<div class="empty">No exact products match yet. Connect a source in the Chrome companion or ask an administrator to review a product suggestion.</div>';
}

function renderPlans() {
  $("#planList").innerHTML = state.plans.length ? state.plans.map((plan) => `<article class="plan-card">
    <div><div class="card-top"><h3>${escapeHtml(plan.title)}</h3><span class="tag ${plan.status === "active" ? "good" : "warn"}">${escapeHtml(plan.status)}</span></div>
    <p>${Number(plan.enabledTargetCount || 0)} of ${Number(plan.targetCount || 0)} stores enabled · quantity ${Number(plan.targetQuantity || 1)} · updated ${escapeHtml(relative(plan.updatedAt))}</p></div>
    <button class="button secondary" data-edit-plan="${escapeHtml(plan.id)}" type="button">Price & store preferences</button>
  </article>`).join("") : '<div class="empty">You have no purchase plans. Choose “Track product” from the Products tab.</div>';
}

function renderActions() {
  $("#actionList").innerHTML = state.actions.length ? state.actions.map((action) => `<article class="action-card">
    <div><div class="card-top"><h3>${escapeHtml(action.title)}</h3><span class="tag ${action.state === "confirmed" ? "good" : "warn"}">${escapeHtml(String(action.state).replaceAll("_", " "))}</span></div>
    <p>${escapeHtml(action.retailerId)} · ${escapeHtml(action.retailerSku)} · ${escapeHtml(String(action.action).replaceAll("_", " "))} · unit cap ${escapeHtml(money(action.maxUnitPriceCents, action.currency))}</p></div>
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
    api("/api/v1/user/missions?limit=200&offset=0"),
    api("/api/v1/user/jobs?limit=100&offset=0"),
    api("/api/v1/user/catalog/proposals?limit=100&offset=0")
  ]);
  state.overview = overview;
  state.products = products.items || [];
  state.plans = plans.items || [];
  state.actions = actions.items || [];
  state.proposals = proposals.items || [];
  renderOverview(); renderProducts(); renderPlans(); renderActions(); renderProposals();
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

async function openPlan(id) {
  const { mission } = await api(`/api/v1/user/missions/${encodeURIComponent(id)}`);
  state.editingPlan = mission;
  const form = $("#planForm");
  form.elements.id.value = mission.id;
  form.elements.status.value = mission.status;
  form.elements.targetQuantity.value = mission.targetQuantity;
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
      await api("/api/v1/user/purchase-intents", { method: "POST", body: JSON.stringify({ listingId: button.dataset.trackListing }) });
      await refresh(); setTab("plans"); toast("Purchase plan created. Add your price and store preferences next.");
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
    await api(`/api/v1/user/missions/${encodeURIComponent(event.currentTarget.elements.id.value)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: event.currentTarget.elements.status.value,
        targetQuantity: Number(event.currentTarget.elements.targetQuantity.value),
        targets
      })
    });
    $("#planDialog").close(); await refresh(); toast("Purchase preferences saved.");
  } catch (error) { toast(error.message || "Preferences could not be saved.", true); }
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
