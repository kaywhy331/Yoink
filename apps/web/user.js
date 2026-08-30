const state = {
  overview: null,
  products: [],
  productGroups: [],
  productTotal: 0,
  browse: { store: "", availability: "", plan: "", price: "", sort: "newest" },
  profiles: [],
  quickAddBusy: false,
  plans: [],
  legacyTransition: null,
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
const HOWL_PUBLISHER_SLUG = "collectwithdodo";
const HOWL_RETAILER_DOMAINS = Object.freeze([
  "target.com", "walmart.com", "amazon.com", "bestbuy.com", "disneystore.com",
  "ravensburger.us", "merch.riotgames.com", "booksamillion.com", "fanatics.com",
  "kohls.com", "macys.com", "p-bandai.com", "pokemoncenter.com"
]);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;"
  })[character]);
}

function howlAffiliateUrl(value, articleName = "") {
  try {
    const destination = new URL(String(value || ""));
    const host = destination.hostname.toLocaleLowerCase("en-US");
    if (destination.protocol !== "https:" || destination.username || destination.password
      || !HOWL_RETAILER_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "";
    const articleUrl = new URL(location.pathname || "/", location.origin);
    articleUrl.search = "";
    articleUrl.hash = "";
    const route = new URL("https://howl.link/link");
    route.searchParams.set("url", destination.href);
    route.searchParams.set("publisher_slug", HOWL_PUBLISHER_SLUG);
    route.searchParams.set(
      "article_name",
      String(articleName || document.title || "Yoink product dashboard").replace(/\s+/g, " ").trim().slice(0, 100)
        || "Yoink product dashboard"
    );
    route.searchParams.set("article_url", articleUrl.href);
    return route.href;
  } catch {
    return "";
  }
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
  const { settings, counts, permissions, spend } = state.overview;
  const paused = settings.actionsPaused === true;
  $("#modePill").textContent = `${settings.executionMode} mode`;
  for (const button of [$("#pauseButton"), $("#preferencePauseButton")]) {
    button.textContent = paused ? "Resume qualified actions" : "Pause all actions";
  }
  $("#actionStateCopy").textContent = paused
    ? "Purchase actions are paused. Price tracking and notifications continue."
    : "Qualified add-only actions may run within each purchase plan’s limits.";
  $("#adminLink").hidden = !permissions.includes("admin.read");
  $("#heroState").innerHTML = `
    <div class="state-row"><span><i class="dot ${paused ? "warn" : "good"}"></i>Actions</span><strong>${paused ? "Paused" : "Enabled"}</strong></div>
    <div class="state-row"><span><i class="dot ${Number(spend?.activeReservationCount || 0) ? "warn" : "good"}"></i>Reserved capacity</span><strong>${escapeHtml(money(spend?.activeReservedCents || 0))}</strong></div>
    <div class="state-row"><span><i class="dot good"></i>Checkout</span><strong>Manual only</strong></div>`;
  const metricRows = [
    [counts.products, "Known listings"],
    [counts.purchaseIntents, "Purchase plans"],
    [counts.actions, "Recorded actions"],
    [counts.pendingCatalogProposals, "Suggestions in review"]
  ];
  $("#metrics").innerHTML = metricRows.map(([value, label]) => `<article class="metric"><strong>${Number(value || 0).toLocaleString()}</strong><span>${escapeHtml(label)}</span></article>`).join("");
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

function listingEffectivePrice(listing) {
  const current = Number(listing.currentPriceCents);
  if (listing.currentPriceCents !== null && listing.currentPriceCents !== undefined && Number.isFinite(current) && current > 0) {
    return { cents: current, kind: "seen" };
  }
  const msrp = Number(listing.msrpCents);
  if (listing.msrpCents !== null && listing.msrpCents !== undefined && Number.isFinite(msrp) && msrp > 0) {
    return { cents: msrp, kind: "catalog" };
  }
  return null;
}

function listingAvailable(listing) {
  return ["in_stock", "preorder"].includes(String(listing.status));
}

function bestListing(group) {
  return [...(group.listings || [])].sort((first, second) => {
    const availability = Number(!listingAvailable(first)) - Number(!listingAvailable(second));
    if (availability !== 0) return availability;
    const lane = Number(!(first.executionSupported && guardedLaneReady(first.retailerId)))
      - Number(!(second.executionSupported && guardedLaneReady(second.retailerId)));
    if (lane !== 0) return lane;
    const firstPrice = listingEffectivePrice(first)?.cents;
    const secondPrice = listingEffectivePrice(second)?.cents;
    if (firstPrice === undefined && secondPrice === undefined) return 0;
    if (firstPrice === undefined) return 1;
    if (secondPrice === undefined) return -1;
    return firstPrice - secondPrice;
  })[0];
}

function browseFilteredGroups(missionByVariant) {
  const browse = state.browse;
  const timeOf = (value) => {
    const time = new Date(String(value ?? "")).getTime();
    return Number.isFinite(time) ? time : 0;
  };
  const priceOf = (group) => {
    const cents = Number(group.bestPriceCents);
    return group.bestPriceCents !== null && group.bestPriceCents !== undefined && Number.isFinite(cents) ? cents : null;
  };
  const filtered = state.productGroups.filter((group) => {
    const listings = group.listings || [];
    if (browse.store && !listings.some((listing) => String(listing.retailerId) === browse.store)) return false;
    const statuses = listings.map((listing) => String(listing.status));
    if (browse.availability === "available" && !statuses.includes("in_stock")) return false;
    if (browse.availability === "preorder" && !statuses.includes("preorder")) return false;
    if (browse.availability === "unavailable" && listings.some(listingAvailable)) return false;
    if (browse.plan === "planned" && !missionByVariant.has(group.variantId)) return false;
    if (browse.plan === "unplanned" && missionByVariant.has(group.variantId)) return false;
    if (browse.price) {
      const cents = priceOf(group);
      if (cents === null) return false;
      const [min, max] = browse.price.split("-");
      if (min !== "" && cents < Number(min)) return false;
      if (max !== "" && cents >= Number(max)) return false;
    }
    return true;
  });
  const byPriceAsc = (first, second) => {
    const firstPrice = priceOf(first);
    const secondPrice = priceOf(second);
    if (firstPrice === null && secondPrice === null) return 0;
    if (firstPrice === null) return 1;
    if (secondPrice === null) return -1;
    return firstPrice - secondPrice;
  };
  const sorts = {
    newest: (first, second) => timeOf(second.createdAt) - timeOf(first.createdAt),
    oldest: (first, second) => timeOf(first.createdAt) - timeOf(second.createdAt),
    price_asc: byPriceAsc,
    price_desc: (first, second) => byPriceAsc(second, first),
    active: (first, second) => timeOf(second.lastActivityAt) - timeOf(first.lastActivityAt),
    title: (first, second) => String(first.title).localeCompare(String(second.title))
  };
  return filtered.sort(sorts[browse.sort] || sorts.newest);
}

function renderStoreFilterOptions() {
  const select = $("#browseStore");
  if (!select) return;
  const stores = new Map();
  for (const group of state.productGroups) {
    for (const listing of group.listings || []) stores.set(String(listing.retailerId), String(listing.retailerName));
  }
  select.innerHTML = ['<option value="">All stores</option>', ...[...stores.entries()]
    .sort((first, second) => first[1].localeCompare(second[1]))
    .map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)].join("");
  select.value = stores.has(state.browse.store) ? state.browse.store : "";
}

function renderProducts() {
  const missionByVariant = new Map(state.plans.map((plan) => [plan.variantId, plan]));
  renderStoreFilterOptions();
  const groups = browseFilteredGroups(missionByVariant);
  const filtering = Boolean(state.browse.store || state.browse.availability || state.browse.plan || state.browse.price);
  $("#browseCount").textContent = state.productGroups.length
    ? `${groups.length} of ${state.productTotal} product${state.productTotal === 1 ? "" : "s"}`
    : "";
  if (!state.productGroups.length) {
    $("#productList").innerHTML = '<div class="empty"><p>No approved exact products match yet. Paste a supported store product page and Yoink will hold the exact item for independent review.</p><button class="button secondary" data-open-product-link type="button">Add product link</button></div>';
    return;
  }
  if (!groups.length) {
    $("#productList").innerHTML = '<div class="empty"><p>No products match the current filters.</p><button class="button secondary" data-clear-browse type="button">Clear filters</button></div>';
    return;
  }
  $("#productList").innerHTML = groups.map((group) => productCardMarkup(group, missionByVariant)).join("");
  for (const image of $$("#productList .card-media img")) {
    image.addEventListener("error", () => { image.remove(); }, { once: true });
  }
}

function mediaMarkup(group) {
  const letter = String(group.title || "?").trim().charAt(0).toUpperCase() || "?";
  const image = group.imageUrl
    ? `<img src="${escapeHtml(group.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : "";
  return `<button class="card-media" data-product-detail="${escapeHtml(group.variantId)}" type="button" title="${escapeHtml(`View ${group.title} across every store`)}"><span class="media-letter" aria-hidden="true">${escapeHtml(letter)}</span>${image}</button>`;
}

function quickAddMarkup(listing, group) {
  if (!listing) return "";
  const caret = state.profiles.length
    ? `<button class="button primary caret" data-quick-menu="${escapeHtml(listing.listingId)}" type="button" aria-label="Choose a quick-add profile" title="Choose a quick-add profile">▾</button>`
    : "";
  return `<span class="split-button">
    <button class="button primary" data-quick-add="${escapeHtml(listing.listingId)}" type="button" title="${escapeHtml(`Quick add ${group.title} with your default configuration`)}">Quick add</button>
    ${caret}
  </span>`;
}

function productCardMarkup(group, missionByVariant) {
  const plan = missionByVariant.get(group.variantId);
  const listings = group.listings || [];
  const exactVariant = variantSummary(group.variantAttributes);
  const available = Number(group.availableListingCount) > 0;
  const laneReady = listings.some((listing) => listing.executionSupported && guardedLaneReady(listing.retailerId));
  const packaged = listings.some((listing) => listing.executionSupported);
  const focusListing = state.browse.store
    ? listings.find((listing) => String(listing.retailerId) === state.browse.store) || null
    : null;
  const primary = focusListing || bestListing(group);
  const primaryPrice = listingEffectivePrice(primary || {});
  let storeArea = "";
  let priceTag = "";
  if (focusListing) {
    priceTag = `<span class="tag">${primaryPrice
      ? escapeHtml(`${money(primaryPrice.cents, focusListing.currency)} at ${focusListing.retailerName}${primaryPrice.kind === "catalog" ? " · catalog price" : ""}`)
      : escapeHtml(`No ${focusListing.retailerName} price recorded`)}</span>`;
    const others = listings.filter((listing) => listing !== focusListing);
    if (others.length) {
      const prices = others.map((listing) => listingEffectivePrice(listing)?.cents).filter((cents) => cents !== undefined && cents !== null);
      const range = prices.length
        ? prices.length > 1 && Math.min(...prices) !== Math.max(...prices)
          ? ` · ${money(Math.min(...prices), group.currency)}–${money(Math.max(...prices), group.currency)}`
          : ` · ${money(Math.min(...prices), group.currency)}`
        : "";
      storeArea = `<button class="other-stores" data-product-detail="${escapeHtml(group.variantId)}" type="button">${escapeHtml(`${others.length} other store${others.length === 1 ? "" : "s"}${range}`)}</button>`;
    }
  } else {
    priceTag = `<span class="tag">${primaryPrice ? escapeHtml(`From ${money(primaryPrice.cents, group.currency)}`) : "No price recorded"}</span>`;
    storeArea = `<div class="store-chips">${listings.map((listing) => {
      const price = listingEffectivePrice(listing);
      const chipAvailable = listingAvailable(listing);
      const chipTitle = plan
        ? `Review the ${group.title} purchase plan`
        : `Quick add from ${listing.retailerName}`;
      return `<button class="store-chip${chipAvailable ? "" : " muted"}" data-quick-add="${escapeHtml(listing.listingId)}" type="button" title="${escapeHtml(chipTitle)}">
        <span class="chip-store">${escapeHtml(listing.retailerName)}</span>
        <span class="chip-price">${price ? escapeHtml(money(price.cents, listing.currency)) : "No price"}</span>
        <span class="chip-status ${chipAvailable ? "good" : "warn"}">${escapeHtml(words(String(listing.status)))}</span>
      </button>`;
    }).join("")}</div>`;
  }
  const availabilityTag = focusListing
    ? `<span class="tag ${listingAvailable(focusListing) ? "good" : "warn"}">${escapeHtml(`${words(String(focusListing.status))} at ${focusListing.retailerName}`)}</span>`
    : `<span class="tag ${available ? "good" : "warn"}">${available ? escapeHtml(`${group.availableListingCount} of ${group.listingCount} listings available`) : "Out of stock everywhere"}</span>`;
  return `<article class="product-card product-group">
    ${mediaMarkup(group)}
    <div class="card-top"><span class="store">${escapeHtml(focusListing ? focusListing.retailerName : `${group.storeCount} store${Number(group.storeCount) === 1 ? "" : "s"}`)}</span>${availabilityTag}</div>
    <h3><button class="title-link" data-product-detail="${escapeHtml(group.variantId)}" type="button">${escapeHtml(group.title)}</button></h3>
    <p>${exactVariant ? escapeHtml(exactVariant) : "One exact product across every store that offers it."}</p>
    <div class="tags">
      ${priceTag}
      <span class="tag ${laneReady ? "good" : ""}">${packaged ? laneReady ? "Qualified guarded add" : "Packaged mapping · lane pending" : "Monitor only"}</span>
      ${plan ? '<span class="tag good">Plan active</span>' : ""}
    </div>
    ${storeArea}
    <div class="card-actions">
      ${plan ? `<button class="button secondary" data-edit-plan="${escapeHtml(plan.id)}" type="button">Edit purchase plan</button>` : quickAddMarkup(primary, group)}
      ${primary ? `<a class="canonical" href="${escapeHtml(howlAffiliateUrl(primary.canonicalUrl, group.title))}" target="_blank" rel="noopener noreferrer sponsored">View at ${escapeHtml(primary.retailerName)} ↗</a>` : ""}
    </div>
  </article>`;
}

function profileSummary(profile) {
  const price = profile.priceMode === "fixed_cap" ? `cap ${money(profile.maxUnitPriceCents)}`
    : profile.priceMode === "msrp" ? "MSRP cap"
    : profile.priceMode === "msrp_offset_percent" ? `MSRP ${Number(profile.msrpOffsetPercent) > 0 ? "+" : ""}${Number(profile.msrpOffsetPercent || 0)}%`
    : "store price cap";
  const action = profile.actionCeiling === "add_to_cart" ? "add to cart" : "notify only";
  return `qty ${Number(profile.targetQuantity)} · ${price} · ${action}${profile.isDefault ? " · default" : ""}`;
}

// Resolves the per-item price cap for a quick add from a listing's known prices
// and the chosen profile's price mode. Mirrors the server's own price-mode
// resolution used when a profile is later applied to existing plans.
function resolveProfileMaxUnitPriceCents(product, profile) {
  if (!profile) {
    const price = listingEffectivePrice(product);
    return price?.cents ?? null;
  }
  if (profile.priceMode === "fixed_cap") {
    const cents = Number(profile.maxUnitPriceCents);
    return Number.isFinite(cents) && cents > 0 ? cents : null;
  }
  if (profile.priceMode === "msrp" || profile.priceMode === "msrp_offset_percent") {
    const msrp = Number(product.msrpCents);
    if (!Number.isFinite(msrp) || msrp <= 0) return null;
    if (profile.priceMode === "msrp") return msrp;
    const percent = Number(profile.msrpOffsetPercent ?? 0);
    const cents = Math.round(msrp * (100 + percent) / 100);
    return Number.isFinite(cents) && cents > 0 ? cents : null;
  }
  const price = listingEffectivePrice(product);
  return price?.cents ?? null;
}

function closeQuickMenu() {
  const menu = $("#quickAddMenu");
  menu.hidden = true;
  menu.innerHTML = "";
}

function openQuickMenu(anchor, listingId) {
  const menu = $("#quickAddMenu");
  menu.innerHTML = [
    `<button data-quick-add="${escapeHtml(listingId)}" type="button"><strong>System default</strong><small>qty 1 · store price cap · notify only</small></button>`,
    ...state.profiles.map((profile) => `<button data-quick-add="${escapeHtml(listingId)}" data-profile-id="${escapeHtml(profile.id)}" type="button"><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profileSummary(profile))}</small></button>`),
    `<button data-track-listing="${escapeHtml(listingId)}" type="button"><strong>Custom setup…</strong><small>Review every limit before creating the plan</small></button>`
  ].join("");
  const rect = anchor.getBoundingClientRect();
  menu.hidden = false;
  const width = Math.min(300, window.innerWidth - 24);
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 12)}px`;
}

async function quickAdd(listingId, profileId = "") {
  if (state.quickAddBusy) return;
  const product = state.products.find((item) => item.listingId === listingId);
  if (!product) throw new Error("That exact product is no longer in the current catalog view. Refresh and try again.");
  const existing = state.plans.find((plan) => plan.variantId === product.variantId);
  if (existing) return openPlan(existing.id);
  const profile = profileId
    ? state.profiles.find((candidate) => candidate.id === profileId)
    : state.profiles.find((candidate) => candidate.isDefault === true) || null;
  if (profileId && !profile) throw new Error("That quick-add profile is no longer available.");
  const maxUnitPriceCents = resolveProfileMaxUnitPriceCents(product, profile);
  if (!maxUnitPriceCents) {
    toast(profile && (profile.priceMode === "msrp" || profile.priceMode === "msrp_offset_percent")
      ? `No MSRP is recorded for ${product.title} yet, so choose your own caps.`
      : `No ${product.retailerName} price is recorded yet, so choose your own caps.`);
    return openSetup(listingId);
  }
  const targetQuantity = Number(profile?.targetQuantity ?? 1);
  const actionCeiling = profile?.actionCeiling === "add_to_cart" && product.executionSupported === true
    ? "add_to_cart"
    : "notify";
  state.quickAddBusy = true;
  try {
    // The item price is the only figure a quick-add profile sets directly; the
    // server always auto-raises the reviewed total to cover taxes and store-fee
    // reserves during this no-write preview, so a single round trip is enough.
    const draft = {
      contractVersion: 2,
      listingId,
      targetQuantity,
      maxUnitPriceCents,
      maxAllInCents: maxUnitPriceCents * targetQuantity,
      actionCeiling,
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      expiresAt: "",
      cooldownSeconds: Number(profile?.cooldownSeconds ?? 0),
      confirmation: "PREFLIGHT_EXACT_PURCHASE_PLAN"
    };
    const { preflight } = await api("/api/v1/user/purchase-intents/preflight", { method: "POST", body: JSON.stringify(draft) });
    await api("/api/v1/user/purchase-intents", {
      method: "POST",
      body: JSON.stringify({
        ...preflight.draft,
        contractVersion: 2,
        quickAddProfileId: profile?.id || "",
        confirmation: "CREATE_EXACT_PURCHASE_PLAN",
        preflightFingerprint: preflight.preflightFingerprint,
        preflightedAt: preflight.preflightedAt
      })
    });
    await refresh();
    toast(actionCeiling === "add_to_cart"
      ? `${product.title} added with ${profile ? `the “${profile.name}” profile` : "your default"} — cart automation obeys your saved limits; checkout stays manual.`
      : `${product.title} added with ${profile ? `the “${profile.name}” profile` : "your default"} — you'll be notified on a fresh exact offer (cap ${money(preflight.draft.maxUnitPriceCents, product.currency)}).`);
  } catch (error) {
    if (error.code === "purchase_intent_exists") {
      await refresh();
      toast("That exact product already has a purchase plan. Review its current limits before changing it.");
    } else {
      throw error;
    }
  } finally {
    state.quickAddBusy = false;
  }
}

function openProductDetail(variantId) {
  const group = state.productGroups.find((candidate) => candidate.variantId === variantId);
  if (!group) throw new Error("That product is no longer in the current catalog view. Refresh and try again.");
  const plan = state.plans.find((candidate) => candidate.variantId === variantId);
  const exactVariant = variantSummary(group.variantAttributes);
  $("#productDialogTitle").textContent = group.title;
  const rows = (group.listings || []).map((listing) => {
    const price = listingEffectivePrice(listing);
    const chipAvailable = listingAvailable(listing);
    return `<div class="detail-row${chipAvailable ? "" : " muted"}">
      <div class="detail-store"><strong>${escapeHtml(listing.retailerName)}</strong><small>Exact item ${escapeHtml(listing.retailerSku)}</small></div>
      <div class="detail-price"><strong>${price ? escapeHtml(money(price.cents, listing.currency)) : "No price"}</strong><small>${price ? price.kind === "seen" ? "Last seen" : "Catalog price" : ""}</small></div>
      <span class="tag ${chipAvailable ? "good" : "warn"}">${escapeHtml(words(String(listing.status)))}</span>
      <div class="detail-actions">
        ${plan
          ? `<button class="button secondary" data-edit-plan="${escapeHtml(plan.id)}" type="button">Edit plan</button>`
          : `<button class="button primary" data-quick-add="${escapeHtml(listing.listingId)}" type="button">Quick add</button>
             <button class="button quiet" data-track-listing="${escapeHtml(listing.listingId)}" type="button">Custom setup</button>`}
        <a class="canonical" href="${escapeHtml(howlAffiliateUrl(listing.canonicalUrl, group.title))}" target="_blank" rel="noopener noreferrer sponsored">View ↗</a>
      </div>
    </div>`;
  }).join("");
  $("#productDialogBody").innerHTML = `
    <div class="detail-summary">
      ${group.imageUrl ? `<img class="detail-image" src="${escapeHtml(group.imageUrl)}" alt="" referrerpolicy="no-referrer">` : ""}
      <p>${exactVariant ? escapeHtml(exactVariant) : "One exact product; every store below feeds the same purchase plan."}${plan ? ' <span class="tag good">Plan active</span>' : ""}</p>
    </div>
    <div class="detail-rows">${rows}</div>`;
  for (const image of $$("#productDialogBody img")) {
    image.addEventListener("error", () => { image.remove(); }, { once: true });
  }
  $("#productDialog").showModal();
}

function renderProfiles() {
  const list = $("#profileList");
  if (!list) return;
  list.innerHTML = state.profiles.length
    ? state.profiles.map((profile) => `<div class="mini-row profile-row"><span><strong>${escapeHtml(profile.name)}</strong><small> · ${escapeHtml(profileSummary(profile))}</small></span><span class="inline-actions"><button class="button quiet" data-profile-edit="${escapeHtml(profile.id)}" type="button">Edit</button><button class="button quiet" data-profile-delete="${escapeHtml(profile.id)}" type="button">Remove</button></span></div>`).join("")
    : '<div class="mini-row"><span>No saved profiles yet. Quick add uses the built-in default until you save one.</span></div>';
}

function renderWalmartDraws() {
  const draws = state.overview.walmartDraws || {};
  const latest = draws.latestScan || null;
  const items = Array.isArray(draws.items) ? draws.items : [];
  $("#walmartDrawSummary").innerHTML = `<article class="plan-card"><div><div class="card-top"><h3>Read-only drawing observer</h3><span class="tag ${latest?.outcome === "passed" ? "good" : "warn"}">${escapeHtml(latest ? String(latest.outcome).replaceAll("_", " ") : "not scanned")}</span></div><p>${latest ? `${Number(latest.observedCardCount || 0)} of ${Number(latest.expectedCardCount || 0)} cards recorded ${relative(latest.observedAt)}.` : "Open the Walmart Draw hub and choose Inspect current drawings in the Chrome companion."} No entry was submitted, and Yoink does not collect drawing account, address, payment, or entry state.</p></div><a class="canonical" href="${escapeHtml(howlAffiliateUrl("https://www.walmart.com/shop/collectibles/draw", "Walmart Collectibles Draw"))}" target="_blank" rel="noopener noreferrer sponsored">Open drawing hub ↗</a></article>`;
  $("#walmartDrawList").innerHTML = items.length ? items.map((item) => `<article class="product-card">
    <div class="card-top"><span class="store">Walmart</span><span class="tag ${item.drawState === "active" ? "good" : "warn"}">${escapeHtml(String(item.drawState || "unknown"))}</span></div>
    <h3>${escapeHtml(item.title)}</h3>
    <p>Exact Walmart item ${escapeHtml(item.retailerSku)} · ${escapeHtml(item.sellerName || "seller unknown")}</p>
    <div class="tags"><span class="tag">${escapeHtml(money(item.unitPriceCents, item.currency))}</span><span class="tag">${item.closesAt ? `Closes ${escapeHtml(relative(item.closesAt))}` : "Closing time unknown"}</span><span class="tag ${item.tracked ? "good" : ""}">${item.tracked ? "Matches your plan" : "Not tracked"}</span></div>
    <div class="card-actions"><a class="canonical" href="${escapeHtml(howlAffiliateUrl(item.canonicalUrl, item.title))}" target="_blank" rel="noopener noreferrer sponsored">View exact item ↗</a><span class="tag warn">Manual entry only</span></div>
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
  renderLegacyPlanTransition();
  $("#planList").innerHTML = state.plans.length ? state.plans.map((plan) => {
    const store = plan.primaryRetailerName || "No store enabled";
    const current = plan.primaryCurrentPriceCents ? money(plan.primaryCurrentPriceCents) : "not seen yet";
    const maximum = plan.primaryMaxUnitPriceCents ? money(plan.primaryMaxUnitPriceCents) : "not set";
    const fulfillment = words(plan.primaryFulfillment || "not selected");
    const action = plan.actionCeiling === "add_to_cart" ? "Add to cart" : "Notify me only";
    const decision = plan.decisionMode === "purchase_intent" ? "This reviewed plan decides" : "Advanced defaults decide";
    return `<article class="plan-card">
      <div class="plan-row">
        <div class="plan-summary">
          <div class="plan-summary-top"><h3>${escapeHtml(plan.title)}</h3><span class="tag ${plan.status === "active" ? "good" : "warn"}">${escapeHtml(plan.status)}</span></div>
          <p class="plan-line"><strong>${escapeHtml(store)}</strong> · cap ${escapeHtml(maximum)} · qty ${Number(plan.targetQuantity || 1)} · ${escapeHtml(action)}</p>
        </div>
        <button class="button secondary" data-edit-plan="${escapeHtml(plan.id)}" type="button">Review or change</button>
      </div>
      <details class="plan-details">
        <summary>Details</summary>
        <p>${plan.primaryRetailerSku ? `Exact item ${escapeHtml(plan.primaryRetailerSku)} · ` : ""}last seen ${escapeHtml(current)} · ${escapeHtml(fulfillment)} · maximum total ${escapeHtml(plan.maxAllInCents ? money(plan.maxAllInCents) : "not set")} · ${Number(plan.enabledTargetCount || 0)} of ${Number(plan.targetCount || 0)} stores enabled</p>
        <p>${escapeHtml(decision)} when a fresh exact offer arrives. Guarded cart attempts add exactly one item and preserve existing cart quantities through an exact delta check.</p>
        ${automationReadinessMarkup(plan.automationReadiness)}
      </details>
    </article>`;
  }).join("") : '<div class="empty">You have no purchase plans. Choose “Set up purchase” from the Products tab and review the exact limits before creating one.</div>';
}

function renderLegacyPlanTransition() {
  const preview = state.legacyTransition;
  const panel = $("#legacyPlanTransition");
  const count = Number(preview?.eligibleCount || 0);
  panel.hidden = count < 1;
  if (!count) return;
  $("#legacyPlanTransitionTitle").textContent = `${count.toLocaleString()} imported plan${count === 1 ? " needs" : "s need"} one review`;
  $("#legacyPlanTransitionCopy").textContent = "Make them explicit notification-only plans now; guarded cart limits still require separate review per product.";
}

function openLegacyPlanTransition() {
  const preview = state.legacyTransition;
  const count = Number(preview?.eligibleCount || 0);
  if (!preview || count < 1) {
    toast("No imported plans currently need transition.");
    return;
  }
  const active = Number(preview.activeCount || 0);
  const paused = Number(preview.pausedCount || 0);
  $("#legacyPlanTransitionSummary").textContent = `${count.toLocaleString()} plan${count === 1 ? "" : "s"} will stop delegating decisions to advanced strategies and become explicit notification-only plans (${active.toLocaleString()} active${paused ? `, ${paused.toLocaleString()} paused` : ""}).`;
  const samples = Array.isArray(preview.samplePlans) ? preview.samplePlans : [];
  $("#legacyPlanTransitionSamples").innerHTML = samples.map((plan) => `<div class="mini-row"><span>${escapeHtml(plan.title)}</span><strong>${escapeHtml(plan.status)}</strong></div>`).join("");
  const form = $("#legacyPlanTransitionForm");
  form.elements.reviewed.checked = false;
  $("#transitionLegacyPlansButton").disabled = true;
  $("#legacyPlanTransitionDialog").showModal();
  requestAnimationFrame(() => form.elements.reviewed.focus());
}

async function transitionLegacyPlans() {
  const preview = state.legacyTransition;
  if (!preview || Number(preview.eligibleCount || 0) < 1) throw new Error("Refresh the current transition preview first.");
  const result = await api("/api/v1/user/purchase-intents/legacy-transition", {
    method: "POST",
    body: JSON.stringify({
      contractVersion: Number(preview.contractVersion),
      previewFingerprint: preview.previewFingerprint,
      confirmation: "CONVERT_LEGACY_PLANS_TO_NOTIFICATIONS"
    })
  });
  return result.transition || {};
}

function renderActions() {
  $("#actionList").innerHTML = state.actions.length ? state.actions.map((action) => `<article class="action-card">
    <div><div class="card-top"><h3>${escapeHtml(action.title)}</h3><span class="tag ${action.state === "confirmed" ? "good" : "warn"}">${escapeHtml(String(action.state).replaceAll("_", " "))}</span></div>
    <p>${escapeHtml(action.retailerId)} · ${escapeHtml(action.retailerSku)} · ${escapeHtml(String(action.action).replaceAll("_", " "))} · ${action.decisionSource === "purchase_intent" ? "reviewed plan" : "advanced default"} · unit cap ${escapeHtml(money(action.maxUnitPriceCents, action.currency))}${action.spendReservationStatus ? ` · reservation ${escapeHtml(action.spendReservationStatus)}` : ""}</p>
    ${action.decisionReason ? `<p><strong>Latest:</strong> ${escapeHtml(action.decisionReason)}${action.decisionReasonCode ? ` · ${escapeHtml(String(action.decisionReasonCode).replaceAll("_", " "))}` : ""}</p>` : ""}</div>
    <div class="inline-actions">${["manual_review", "submission_uncertain"].includes(action.state) ? '<a class="canonical" href="/admin#operations">Review →</a>' : ""}<a class="canonical" href="${escapeHtml(howlAffiliateUrl(action.canonicalUrl, action.title))}" target="_blank" rel="noopener noreferrer sponsored">Store page ↗</a></div>
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
  const [overview, products, plans, legacyTransition, actions, proposals, privacy, recoveryEvidence, profiles] = await Promise.all([
    api("/api/v1/user/overview"),
    api(`/api/v1/user/library/products?limit=200&offset=0${query}`),
    api("/api/v1/user/purchase-intents?limit=200&offset=0"),
    api("/api/v1/user/purchase-intents/legacy-transition"),
    api("/api/v1/user/jobs?limit=100&offset=0"),
    api("/api/v1/user/catalog/proposals?limit=100&offset=0"),
    state.privacy ? Promise.resolve({ inventory: state.privacy }) : api("/api/v1/user/privacy"),
    api("/api/v1/user/community/recovery-evidence"),
    api("/api/v1/user/purchase-profiles").catch(() => ({ items: [] }))
  ]);
  state.overview = overview;
  state.productGroups = products.items || [];
  state.productTotal = Number(products.total ?? state.productGroups.length);
  state.products = state.productGroups.flatMap((group) => (group.listings || []).map((listing) => ({
    variantId: group.variantId,
    title: group.title,
    variantAttributes: group.variantAttributes,
    ...listing
  })));
  state.plans = plans.items || [];
  state.legacyTransition = legacyTransition.preview || null;
  state.actions = actions.items || [];
  state.proposals = proposals.items || [];
  state.privacy = privacy.inventory || null;
  state.recoveryEvidence = recoveryEvidence.items || [];
  state.recoveryRetention = recoveryEvidence.retention || null;
  state.contributorEligibility = recoveryEvidence.contributorEligibility || null;
  state.profiles = profiles.items || [];
  renderOverview(); renderProducts(); renderWalmartDraws(); renderPlans(); renderActions(); renderProposals(); renderPrivacy(); renderRecoveryEvidence(); renderProfiles();
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
  const autoRaisedNote = cost?.autoRaised
    ? `<p class="boundary-note good">Your maximum total was automatically raised to ${escapeHtml(money(cost.reviewedAllInCents, currency))} to cover taxes and store fees — the item price above stays your real cap.</p>`
    : "";
  element.innerHTML = `<div><span>${mode === "ready" ? "Server checked" : mode === "error" ? "Needs attention" : "Server check"}</span><strong>${escapeHtml(headline)}</strong></div>
    <p>${escapeHtml(copy)}</p>${costs}${autoRaisedNote}`;
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
  if (adding && form.elements.fulfillment.value !== "pickup") form.elements.fulfillment.value = "shipping";
  form.elements.fulfillment.disabled = false;
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
          ? `Your current maximum total is below the ${money(minimum.required)} tax and store-fee safety bound. Yoink will automatically raise it to that amount when you save, or choose notifications instead.`
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
  const action = form.elements.actionCeiling.value === "add_to_cart" ? "Add to cart" : "Notify me only";
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
    : "This plan currently uses advanced defaults.";
  $("#planModeCopy").textContent = directPlan
    ? "Checkout stays manual. These limits can authorize only qualified add-only actions and never authorize checkout or order submission."
    : "Saving here converts it to a reviewed direct plan in notification mode unless you explicitly choose and satisfy guarded cart requirements. Checkout stays manual.";
  $("#planDialogTitle").textContent = mission.title;
  $("#targetEditors").innerHTML = mission.targets.map((target) => `<article class="target-editor" data-target-id="${escapeHtml(target.id)}" data-retailer-id="${escapeHtml(target.retailerId)}" data-execution-supported="${target.executionSupported === true}" data-last-observed-price-cents="${Number.isSafeInteger(Number(target.lastObservedPriceCents)) ? Number(target.lastObservedPriceCents) : ""}">
    <div class="card-top"><div><strong>${escapeHtml(target.retailerName)}</strong><span class="tag ${target.executionSupported === true ? "good" : ""} target-capability">${target.executionSupported === true ? "Cart mapping available" : "Monitoring only"}</span><p>${escapeHtml(target.retailerSku)} · ${escapeHtml(money(target.lastObservedPriceCents, target.currency))}</p></div><a class="canonical" href="${escapeHtml(howlAffiliateUrl(target.canonicalUrl, mission.title))}" target="_blank" rel="noopener noreferrer sponsored">View ↗</a></div>
    <div class="target-fields">
      <label class="check"><input data-field="enabled" type="checkbox" ${target.enabled ? "checked" : ""}><span>Use store</span></label>
      <label><span>Maximum price</span><input data-field="maxPrice" inputmode="decimal" placeholder="Strategy limit" value="${target.maxUnitPriceCents ? (target.maxUnitPriceCents / 100).toFixed(2) : ""}"></label>
      <label><span>Seller</span><select data-field="sellerPolicy"><option value="inherit" ${target.sellerPolicy === "inherit" ? "selected" : ""}>Use default</option><option value="first_party_only" ${target.sellerPolicy === "first_party_only" ? "selected" : ""}>Store only</option><option value="allow_third_party" ${target.sellerPolicy === "allow_third_party" ? "selected" : ""}>Marketplace allowed</option></select></label>
      <label><span>Fulfillment</span><select data-field="fulfillment"><option value="shipping" ${target.fulfillment !== "pickup" && target.fulfillment !== "manual" ? "selected" : ""}>Shipping (default)</option><option value="pickup" ${target.fulfillment === "pickup" ? "selected" : ""}>Pickup (explicit opt-in)</option><option value="manual" ${target.fulfillment === "manual" ? "selected" : ""}>Manual only</option></select></label>
    </div>
  </article>`).join("");
  const supportedTargets = mission.targets.filter((target) => target.executionSupported === true);
  form.elements.actionCeiling.querySelector('option[value="add_to_cart"]').disabled = supportedTargets.length < 1;
  $("#prepareGuardedPlanButton").hidden = supportedTargets.length < 1;
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
  $$("[data-target-id]", form).forEach((card) => {
    const supported = card.dataset.executionSupported === "true";
    const enabledControl = $("[data-field=enabled]", card);
    enabledControl.disabled = adding && !supported;
    if (adding && normalizeTargets) {
      if (!supported) {
        enabledControl.checked = false;
      } else if (enabledControl.checked) {
        $("[data-field=sellerPolicy]", card).value = "first_party_only";
        if ($("[data-field=fulfillment]", card).value !== "pickup") {
          $("[data-field=fulfillment]", card).value = "shipping";
        }
      }
    }
  });
  const targets = planTargetDrafts(form);
  const enabled = targets.filter((target) => target.enabled);
  const unsafe = enabled.find((target) => !target.executionSupported
    || target.maxUnitPriceCents === null
    || target.sellerPolicy !== "first_party_only"
    || !["shipping", "pickup"].includes(target.fulfillment));
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
        ? "Every enabled cart store needs a qualified add mapping, a maximum item price, Store only seller, and an exact Shipping or Pickup choice."
        : minimum === null
          ? "Enter a valid quantity and maximum item price for every enabled store."
          : totalTooLow
            ? `Raise the maximum total to at least ${money(minimum)} only if you accept that bound, or choose notifications.`
            : `The reviewed total covers the current ${money(minimum)} tax and store-fee safety bound. Each guarded attempt adds exactly one item, and Chrome still rechecks the exact live offer before any click.`;
}

function prepareGuardedPlanDraft() {
  const form = $("#planForm");
  const supportedCards = $$("[data-target-id]", form).filter((card) => card.dataset.executionSupported === "true");
  if (!supportedCards.length) {
    toast("This plan has no store target with a packaged guarded-cart runner.", true);
    return;
  }
  if (!supportedCards.some((card) => $("[data-field=enabled]", card).checked)) {
    toast("Enable at least one guarded cart capable store, then prepare the draft again.", true);
    return;
  }
  form.elements.actionCeiling.value = "add_to_cart";
  let preparedCount = 0;
  let missingPriceCount = 0;
  let retainedPickupCount = 0;
  for (const card of $$("[data-target-id]", form)) {
    const enabled = $("[data-field=enabled]", card);
    if (card.dataset.executionSupported !== "true") {
      enabled.checked = false;
      continue;
    }
    if (!enabled.checked) continue;
    $("[data-field=sellerPolicy]", card).value = "first_party_only";
    if ($("[data-field=fulfillment]", card).value === "pickup") {
      retainedPickupCount += 1;
    } else {
      $("[data-field=fulfillment]", card).value = "shipping";
    }
    const price = $("[data-field=maxPrice]", card);
    if (!price.value.trim()) {
      const observed = Number(card.dataset.lastObservedPriceCents);
      if (Number.isSafeInteger(observed) && observed > 0) {
        price.value = moneyInput(observed);
      } else {
        missingPriceCount += 1;
      }
    }
    preparedCount += 1;
  }
  syncPlanAction(true);
  const minimum = planAutomaticMinimum(form);
  if (minimum !== null) {
    let currentTotal = null;
    try { currentTotal = centsInput(form.elements.maxAllIn.value, "The all-in cap"); } catch { currentTotal = null; }
    if (currentTotal === null || currentTotal < minimum) form.elements.maxAllIn.value = moneyInput(minimum);
  }
  syncPlanAction();
  toast(missingPriceCount
    ? `Prepared ${preparedCount} supported store${preparedCount === 1 ? "" : "s"}. Enter ${missingPriceCount} missing price cap${missingPriceCount === 1 ? "" : "s"}, then review every field before saving.`
    : `Prepared ${preparedCount} supported store${preparedCount === 1 ? "" : "s"}; Shipping is the default${retainedPickupCount ? ` and ${retainedPickupCount} explicit Pickup choice${retainedPickupCount === 1 ? " was" : "s were"} retained` : ""}. Review every price and the maximum total before saving.`);
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
      <a class="canonical" href="${escapeHtml(howlAffiliateUrl(preview.canonicalUrl, `${preview.retailerName} product preview`))}" target="_blank" rel="noopener noreferrer sponsored">${escapeHtml(preview.canonicalUrl)} ↗</a>`;
    $("#productLinkConfirm").hidden = false;
    $("#productLinkConfirm").querySelector("input").focus();
  } finally {
    button.disabled = false;
    button.textContent = "Check exact link";
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  const quickMenu = $("#quickAddMenu");
  if (!quickMenu.hidden && !quickMenu.contains(event.target) && !(button && button.dataset.quickMenu)) closeQuickMenu();
  if (!button) return;
  try {
    if (button.dataset.tab) setTab(button.dataset.tab);
    if (button.hasAttribute("data-close-dialog")) button.closest("dialog")?.close();
    if (button.dataset.quickMenu) {
      if (!quickMenu.hidden && quickMenu.dataset.anchor === button.dataset.quickMenu) {
        closeQuickMenu();
      } else {
        openQuickMenu(button, button.dataset.quickMenu);
        quickMenu.dataset.anchor = button.dataset.quickMenu;
      }
    }
    if (button.dataset.quickAdd) {
      closeQuickMenu();
      if ($("#productDialog").hasAttribute("open")) $("#productDialog").close();
      await quickAdd(button.dataset.quickAdd, button.dataset.profileId || "");
    }
    if (button.dataset.productDetail) openProductDetail(button.dataset.productDetail);
    if (button.dataset.profileEdit) beginProfileEdit(button.dataset.profileEdit);
    if (button.dataset.profileDelete) {
      const result = await api(`/api/v1/user/purchase-profiles/${encodeURIComponent(button.dataset.profileDelete)}`, { method: "DELETE" });
      state.profiles = result.items || [];
      renderProfiles();
      renderProducts();
      toast("Quick-add profile removed.");
    }
    if (button.id === "pauseButton" || button.id === "preferencePauseButton") await toggleActions();
    if (button.id === "addProductButton" || button.hasAttribute("data-open-product-link")) openProductLinkDialog();
    if (button.hasAttribute("data-clear-browse")) {
      state.browse = { store: "", availability: "", plan: "", price: "", sort: state.browse.sort };
      for (const id of ["browseStore", "browseAvailability", "browsePlan", "browsePrice"]) {
        const control = $(`#${id}`);
        if (control) control.value = "";
      }
      renderProducts();
    }
    if (button.id === "checkProductLinkButton") await checkProductLink();
    if (button.dataset.trackListing) {
      closeQuickMenu();
      if ($("#productDialog").hasAttribute("open")) $("#productDialog").close();
      await openSetup(button.dataset.trackListing);
    }
    if (button.dataset.editPlan) {
      if ($("#productDialog").hasAttribute("open")) $("#productDialog").close();
      await openPlan(button.dataset.editPlan);
    }
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
      toast("Open the Yoink Chrome companion and choose Connect to start tracking your stores.");
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
    // Resubmit the server's own just-validated draft rather than re-reading the
    // form: this is what carries any automatic tax/store-fee reserve raise, and
    // keeps the create request exactly what the preflight fingerprint was bound to.
    const draft = { ...state.setupPreflight.draft, contractVersion: 2, confirmation: "CREATE_EXACT_PURCHASE_PLAN" };
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
$("#prepareGuardedPlanButton").addEventListener("click", prepareGuardedPlanDraft);

$("#reviewLegacyPlanTransitionButton").addEventListener("click", openLegacyPlanTransition);
$("#legacyPlanTransitionForm").elements.reviewed.addEventListener("change", (event) => {
  $("#transitionLegacyPlansButton").disabled = event.target.checked !== true;
});
$("#legacyPlanTransitionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#transitionLegacyPlansButton");
  try {
    if (form.elements.reviewed.checked !== true) {
      throw new Error("Review and confirm the notification-only transition first.");
    }
    button.disabled = true;
    button.textContent = "Updating plans…";
    const transition = await transitionLegacyPlans();
    $("#legacyPlanTransitionDialog").close();
    await refresh();
    setTab("plans");
    const count = Number(transition.transitionedCount || 0);
    toast(`${count.toLocaleString()} imported plan${count === 1 ? " is" : "s are"} now user-controlled and notification-ready. Guarded cart actions still require explicit limits per product.`);
  } catch (error) {
    if (error.code === "legacy_purchase_intent_transition_stale") await refresh();
    toast(error.message || "The imported plans could not be transitioned.", true);
  } finally {
    button.textContent = "Make plans monitoring-ready";
    button.disabled = form.elements.reviewed.checked !== true;
  }
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
        || !["shipping", "pickup"].includes(target.fulfillment))) {
        throw new Error("Every enabled cart store needs a qualified add mapping, a maximum item price, Store only seller, and an exact Shipping or Pickup choice.");
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

function beginProfileEdit(profileId) {
  const profile = state.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) return;
  const form = $("#profileForm");
  form.elements.id.value = profile.id;
  form.elements.name.value = profile.name;
  form.elements.targetQuantity.value = profile.targetQuantity;
  form.elements.priceMode.value = profile.priceMode;
  form.elements.maxUnitPrice.value = profile.priceMode === "fixed_cap" ? moneyInput(profile.maxUnitPriceCents) : "";
  form.elements.msrpOffsetPercent.value = profile.priceMode === "msrp_offset_percent" && profile.msrpOffsetPercent !== null
    ? String(profile.msrpOffsetPercent)
    : "";
  form.elements.actionCeiling.value = profile.actionCeiling;
  form.elements.cooldownMinutes.value = Math.round(Number(profile.cooldownSeconds || 0) / 60);
  form.elements.isDefault.checked = profile.isDefault === true;
  syncProfilePriceMode();
  $("#saveProfileButton").textContent = "Save changes";
  $("#resetProfileButton").hidden = false;
  setTab("preferences");
  form.elements.name.focus();
}

function resetProfileForm() {
  const form = $("#profileForm");
  form.reset();
  form.elements.id.value = "";
  syncProfilePriceMode();
  $("#saveProfileButton").textContent = "Save profile";
  $("#resetProfileButton").hidden = true;
}

function syncProfilePriceMode() {
  const form = $("#profileForm");
  const mode = form.elements.priceMode.value;
  form.elements.maxUnitPrice.disabled = mode !== "fixed_cap";
  if (mode !== "fixed_cap") form.elements.maxUnitPrice.value = "";
  form.elements.msrpOffsetPercent.disabled = mode !== "msrp_offset_percent";
  if (mode !== "msrp_offset_percent") form.elements.msrpOffsetPercent.value = "";
}

$("#profileForm").elements.priceMode.addEventListener("change", syncProfilePriceMode);
syncProfilePriceMode();

$("#resetProfileButton").addEventListener("click", resetProfileForm);

$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const cooldownMinutes = Number(form.elements.cooldownMinutes.value || 0);
    if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 0 || cooldownMinutes > 43_200) {
      throw new Error("The wait between attempts must be from zero through 43,200 minutes.");
    }
    const priceMode = ["fixed_cap", "msrp", "msrp_offset_percent"].includes(form.elements.priceMode.value)
      ? form.elements.priceMode.value
      : "store_price";
    let msrpOffsetPercent = null;
    if (priceMode === "msrp_offset_percent") {
      const raw = form.elements.msrpOffsetPercent.value.trim();
      const parsed = Number(raw);
      if (!raw || !Number.isInteger(parsed) || parsed < -90 || parsed > 90) {
        throw new Error("The MSRP offset percent must be a whole number from -90 through 90.");
      }
      msrpOffsetPercent = parsed;
    }
    const result = await api("/api/v1/user/purchase-profiles", {
      method: "POST",
      body: JSON.stringify({
        id: form.elements.id.value || undefined,
        name: form.elements.name.value.trim(),
        targetQuantity: Number(form.elements.targetQuantity.value),
        actionCeiling: form.elements.actionCeiling.value === "add_to_cart" ? "add_to_cart" : "notify",
        priceMode,
        maxUnitPriceCents: priceMode === "fixed_cap" ? centsInput(form.elements.maxUnitPrice.value, "The fixed maximum item price") : null,
        msrpOffsetPercent,
        isDefault: form.elements.isDefault.checked === true,
        cooldownSeconds: cooldownMinutes * 60
      })
    });
    state.profiles = result.items || [];
    resetProfileForm();
    renderProfiles();
    renderProducts();
    const propagation = result.propagation || {};
    const updatedCount = Number(propagation.updatedMissionCount || 0);
    const skippedCount = Array.isArray(propagation.skipped) ? propagation.skipped.length : 0;
    if (updatedCount || skippedCount) {
      const parts = [];
      if (updatedCount) parts.push(`${updatedCount} linked purchase plan${updatedCount === 1 ? "" : "s"} updated`);
      if (skippedCount) parts.push(`${skippedCount} kept its prior limits (price not yet known)`);
      toast(`Quick-add profile saved. ${parts.join("; ")}.`);
    } else {
      toast("Quick-add profile saved.");
    }
  } catch (error) { toast(error.message || "The profile could not be saved.", true); }
});

for (const [controlId, browseKey] of [
  ["browseStore", "store"],
  ["browseAvailability", "availability"],
  ["browsePlan", "plan"],
  ["browsePrice", "price"],
  ["browseSort", "sort"]
]) {
  $(`#${controlId}`).addEventListener("change", (event) => {
    state.browse[browseKey] = event.target.value;
    renderProducts();
  });
}

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
