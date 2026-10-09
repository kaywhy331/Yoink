import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const root = join(process.cwd(), "apps/web");

function shopper() {
  const dom = new JSDOM(readFileSync(join(root, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/#cart", runScripts: "outside-only", pretendToBeVisual: true
  });
  const browser = dom.window;
  browser.fetch = () => new Promise(() => undefined);
  browser.setTimeout = () => 1;
  browser.setInterval = () => 1;
  browser.scrollTo = () => undefined;
  browser.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  browser.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  browser.eval(readFileSync(join(root, "user.js"), "utf8") + `
    globalThis.audit = { state, renderSpend, renderCalls, renderProductDetail, renderProducts,
      loadUserRoute, centsInput, applyHashRoute, api, refreshPlans, refreshCalls,
      refreshActionActivity, renderPairing, fetchLoadedPages, setTab, renderPlans, renderWatchHistory, openPlan };
  `);
  browser.audit.state.overview = { walmartDraws: { items: [], latestScan: null } };
  return browser;
}

test("spending drafts and focused timezone survive refresh; conflicts retain the original revision", () => {
  const browser = shopper();
  try {
    const form = browser.document.querySelector("#spendForm");
    const spend = { activeReservedCents: 0, spentTodayCents: 0, policy: {
      revision: 3, dailyCapCents: null, monthlyCapCents: null, perOrderCapCents: null,
      timezone: "UTC", periodResetHour: 0
    } };
    browser.audit.renderSpend(spend);
    form.elements.daily.value = "123.45";
    form.elements.daily.dispatchEvent(new browser.Event("input", { bubbles: true }));
    form.elements.timezone.value = "America/New_York";
    browser.document.querySelector("#pairButton").focus();
    browser.audit.renderSpend({ ...spend, policy: { ...spend.policy, revision: 4, dailyCapCents: 9999 } });
    assert.equal(form.elements.daily.value, "123.45");
    assert.equal(form.elements.timezone.value, "America/New_York");
    assert.equal(form.elements.revision.value, "3");
    assert.match(browser.document.querySelector("#spendDraftStatus").textContent, /changed elsewhere/);
    form.dataset.dirty = "false";
    form.elements.timezone.focus();
    browser.audit.renderSpend(spend);
    assert.equal(form.elements.timezone.value, "America/New_York");
  } finally { browser.close(); }
});

test("a failed first product request leaves a route retry instead of a perpetual skeleton", async () => {
  const browser = shopper();
  try {
    browser.document.querySelector("#productList").innerHTML = '<div class="skeleton-list">Loading</div>';
    browser.fetch = async (path: string) => {
      if (path.includes("library/products")) throw new TypeError("Network lost");
      return { ok: true, json: async () => ({ items: [] }) };
    };
    assert.equal(await browser.audit.loadUserRoute("find", { force: true }), false);
    assert.equal(browser.document.querySelector("#productList .skeleton-list"), null);
    assert.ok(browser.document.querySelector('[data-panel="find"] [data-retry-route="find"]'));
    browser.fetch = async () => ({ ok: true, json: async () => ({ items: [], total: 0 }) });
    assert.equal(await browser.audit.loadUserRoute("find", { force: true }), true);
    assert.equal(browser.document.querySelector('[data-route-load-error="find"]'), null);
    assert.match(browser.document.querySelector("#productList").textContent, /No approved products/);
  } finally { browser.close(); }
});

test("calls offer Want it, show what happened to each call, and paused plans do not claim readiness", () => {
  const browser = shopper();
  try {
    const call = { id: "drop:test", listingId: "listing_test", title: "Test product", kind: "drop_window", status: "scheduled", retailerId: "target", purchaseIntent: null };
    browser.audit.state.calls = [call];
    browser.audit.renderCalls();
    assert.equal(browser.document.querySelector("#callList [data-want-listing]")?.textContent?.trim(), "Want it");
    assert.equal(browser.document.querySelector("[data-call-select]"), null, "calls no longer carry bulk checkboxes");
    browser.audit.state.calls = [{ ...call, purchaseIntent: { id: "plan_test", status: "paused", origin: "user_want", actionCeiling: "add_to_cart", maxUnitPriceCents: 4999 } }];
    browser.audit.renderCalls();
    assert.match(browser.document.querySelector("#callList .want-state")?.textContent ?? "", /Paused · Add to cart · up to \$49\.99/);
    assert.equal(browser.document.querySelector("#callList [data-want-listing]")?.textContent?.trim(), "Yoink", "a wanted item's button reads Yoink");
    assert.doesNotMatch(browser.document.querySelector("#callList").textContent, /Plan ready/);
    browser.audit.state.calls = [{
      id: "signal:over", kind: "signal", listingId: "listing_test", title: "Test product", retailerId: "target",
      occurredAt: new Date().toISOString(), status: "unmatched", unitPriceCents: 6499, currency: "USD",
      purchaseIntent: { id: "plan_test", status: "active", origin: "user_want", actionCeiling: "add_to_cart", maxUnitPriceCents: 5500 },
      result: { kind: "no_action", label: "No action", reason: "Over your max price", detail: "Target listed it at $64.99, over your $55.00 max.", tone: "muted", fix: "edit_want", priceVsMax: "over", priceVsMsrp: "" }
    }];
    browser.audit.renderCalls();
    const text = browser.document.querySelector("#callList").textContent;
    assert.match(text, /No action/);
    assert.match(text, /Over your max price/);
    assert.match(text, /over your \$55\.00 max/);
  } finally { browser.close(); }
});

test("all shopper dialogs have names and monetary input rejects silently rounded or exponential amounts", () => {
  const browser = shopper();
  try {
    for (const dialog of browser.document.querySelectorAll("dialog")) {
      const name = dialog.getAttribute("aria-label") || browser.document.getElementById(dialog.getAttribute("aria-labelledby"))?.textContent;
      assert.ok(name?.trim(), `${dialog.id} needs an accessible name`);
    }
    assert.equal(browser.audit.centsInput("12.34", "Amount"), 1234);
    for (const value of ["12.345", "1e3", "0x10", "-2", "0"]) assert.throws(() => browser.audit.centsInput(value, "Amount"));
  } finally { browser.close(); }
});


test("plan pages, older calls and activity stay reachable after refresh without duplicates", async () => {
  const browser = shopper();
  try {
    const calls = Array.from({ length: 125 }, (_, index) => ({ id: `call_${index}`, title: `Call ${index}`, kind: "signal", occurredAt: new Date(1800000000000 - index * 1000).toISOString() }));
    const jobs = Array.from({ length: 125 }, (_, index) => ({ id: `job_${index}`, title: `Job ${index}`, action: "notify", state: "confirmed" }));
    const offsets: string[] = [];
    browser.fetch = async (path: string) => {
      const url = new URL(path, "http://localhost");
      const offset = Number(url.searchParams.get("offset") || 0);
      offsets.push(`${url.pathname}:${offset}`);
      let page;
      if (path.includes("purchase-intents?")) page = { total: 1001, items: Array.from({ length: 50 }, (_, index) => ({ id: `plan_${offset + index}` })) };
      else if (path.includes("/calls?")) page = { items: calls.slice(offset, offset + 100), total: 125, nextSignalOffset: Math.min(125, offset + 100), hasMore: offset + 100 < 125 };
      else page = { items: jobs.slice(offset, offset + 100), total: 125 };
      return { ok: true, status: 200, json: async () => page };
    };
    browser.audit.state.planOffset = 200;
    await browser.audit.refreshPlans();
    assert.equal(browser.audit.state.plans[0].id, "plan_200");
    assert.equal(browser.audit.state.planTotal, 1001);
    browser.audit.state.callNextOffset = 125;
    await browser.audit.refreshCalls();
    assert.equal(browser.audit.state.calls.length, 125);
    await browser.audit.refreshCalls();
    assert.equal(new Set(browser.audit.state.calls.map((call: { id: string }) => call.id)).size, 125);
    browser.audit.state.actions = jobs;
    await browser.audit.refreshActionActivity();
    assert.equal(browser.audit.state.actions.length, 125);
    assert.ok(offsets.includes("/api/v1/user/jobs:100"));
    assert.ok(offsets.includes("/api/v1/user/calls:100"));
  } finally { browser.close(); }
});

test("pairing expiry removes usable codes and a newly paired browser shows success", () => {
  const browser = shopper();
  try {
    browser.audit.state.pairing = { code: "ABCD-EFGH-IJKL", expiresAt: new Date(Date.now() + 60000).toISOString(), deviceIds: [] };
    browser.audit.renderPairing();
    assert.ok(browser.document.querySelector("#copyPairing"));
    browser.audit.state.pairing.expiresAt = new Date(Date.now() - 1).toISOString();
    browser.audit.renderPairing();
    assert.equal(browser.document.querySelector("#copyPairing"), null);
    assert.match(browser.document.querySelector("#pairing").textContent, /expired/);
    assert.doesNotMatch(browser.document.querySelector("#pairing").textContent, /ABCD/);
    browser.audit.state.devices = [{ id: "new_browser", status: "active" }];
    browser.audit.renderPairing();
    assert.match(browser.document.querySelector("#pairing").textContent, /paired successfully/);
  } finally { browser.close(); }
});

test("a timeout ends a stalled mutation and explains that it may have saved without retrying it", async () => {
  const browser = shopper();
  try {
    let deadline: () => void = () => undefined;
    let requests = 0;
    browser.setTimeout = (callback: () => void) => { deadline = callback; return 1; };
    browser.fetch = (_path: string, options: { signal: AbortSignal }) => {
      requests += 1;
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new browser.DOMException("Aborted", "AbortError"))));
    };
    const pending = browser.audit.api("/api/v1/user/settings", { method: "PATCH", body: "{}" });
    deadline();
    await assert.rejects(pending, /may have|may already/i);
    assert.equal(requests, 1);
  } finally { browser.close(); }
});

test("route changes close read-only details and keep an unsaved plan draft in its workspace", () => {
  const browser = shopper();
  try {
    const product = browser.document.querySelector("#productDialog");
    product.showModal();
    browser.audit.setTab("find", { load: false });
    assert.equal(product.open, false);
    const plan = browser.document.querySelector("#planDialog");
    plan.showModal();
    plan.dataset.dirty = "true";
    browser.audit.setTab("setup", { load: false });
    assert.equal(plan.open, true);
    assert.equal(browser.document.querySelector("[data-panel].active").dataset.panel, "find");
  } finally { browser.close(); }
});


test("plan refresh retains keyboard focus by plan identity", () => {
  const browser = shopper();
  try {
    browser.audit.state.plans = [
      { id: "plan_other", title: "Other fixture", status: "active", actionCeiling: "notify", origin: "user_want", wantListingId: "listing_other" },
      { id: "plan_focus", title: "Focus fixture", status: "active", actionCeiling: "notify", origin: "user_want", wantListingId: "listing_focus" }
    ];
    browser.audit.renderPlans();
    (browser.document.querySelector('[data-plan-id="plan_focus"] [data-want-listing]') as HTMLButtonElement).focus();
    // A refresh that reorders the list still returns focus to the same item's control.
    browser.audit.state.plans = [...browser.audit.state.plans].reverse();
    browser.audit.renderPlans();
    assert.equal(browser.document.activeElement, browser.document.querySelector('[data-plan-id="plan_focus"] [data-want-listing]'));
    assert.equal(browser.document.querySelector("#planList .compact-product-card")?.getAttribute("data-plan-id"), "plan_focus");
  } finally { browser.close(); }
});


test("HTTP failures retain the server code, status and support reference", async () => {
  const browser = shopper();
  try {
    browser.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: "revision_conflict", message: "Limits changed elsewhere.", correlationId: "case_fixture_123" }) });
    await assert.rejects(browser.audit.api("/api/v1/user/spend-policy"), (error: any) => {
      assert.equal(error.code, "revision_conflict");
      assert.equal(error.status, 409);
      assert.equal(error.reference, "case_fixture_123");
      assert.match(error.message, /Limits changed elsewhere.*case_fixture_123/);
      return true;
    });
  } finally { browser.close(); }
});

test("shared card links keep keyboard focus through polls and distinguish missing or failed images", () => {
  const browser = shopper();
  try {
    browser.audit.state.affiliateRouting = { protocolVersion: 1, endpoint: "https://howl.link/link", publisherSlug: "collectwithdodo", registeredRetailerDomains: ["target.com"], stores: [{ hostname: "target.com", pathPrefix: "/" }] };
    const listing = { listingId: "listing_card", retailerId: "target", retailerName: "Target", canonicalUrl: "https://www.target.com/p/-/A-95111111", currentPriceCents: 1999, currency: "USD", status: "in_stock", observedAvailability: "in_stock", availabilityObservedAt: new Date(Date.now() - 43 * 60_000).toISOString(), availabilitySource: "trackalacker" };
    const group = { variantId: "variant_card", title: "Exact <Card> & product", imageUrl: "https://cdn.example.com/exact.png", listings: [listing] };
    browser.audit.state.productGroups = [group]; browser.audit.state.productTotal = 1;
    browser.audit.state.plans = [{ ...group, id: "plan_card", cardListing: listing, status: "active", actionCeiling: "notify", origin: "user_want", enabledStoreNames: "Target", wantListingId: listing.listingId }];
    for (const [selector, render] of [["#productList", browser.audit.renderProducts], ["#planList", browser.audit.renderPlans]] as const) {
      render();
      let card = browser.document.querySelector(`${selector} .compact-product-card`);
      assert.equal(card.querySelector("h3").textContent, group.title);
      assert.equal(card.querySelector("h3 card"), null);
      const links = card.querySelectorAll("a"); assert.equal(links.length, 2); assert.equal(links[0].href, links[1].href);
      assert.equal(new URL(links[0].href).searchParams.get("url"), listing.canonicalUrl);
      assert.match(card.querySelector(".product-observation").textContent, /Reported 43 min ago/);
      for (const control of [".product-image-link", ".product-title-link", "[data-want-listing]", "[data-product-detail]"]) {
        card.querySelector(control).focus(); render(); card = browser.document.querySelector(`${selector} .compact-product-card`);
        assert.equal(browser.document.activeElement, card.querySelector(control), `${selector} preserves ${control}`);
      }
    }
    const image = browser.document.querySelector('#productList [data-product-image]');
    image.dispatchEvent(new browser.Event('error'));
    assert.match(browser.document.querySelector('#productList .card-media').textContent, /Image could not load/);
    browser.audit.renderProducts();
    assert.equal(browser.document.querySelector('#productList img'), null, 'polling does not repeatedly request a failed image');
    group.imageUrl = ''; listing.availabilityObservedAt = '';
    browser.audit.renderProducts();
    assert.match(browser.document.querySelector('#productList').textContent, /Image unavailable/);
    assert.match(browser.document.querySelector('#productList .product-observation').textContent, /No stock check recorded/);
    listing.availabilityObservedAt = new Date(Date.now() + 60_000).toISOString();
    listing.canonicalUrl = 'javascript:alert(1)';
    browser.audit.renderProducts();
    assert.equal(browser.document.querySelectorAll('#productList a').length, 0);
    assert.match(browser.document.querySelector('#productList .product-observation').textContent, /Time unknown/);
    assert.match(browser.document.querySelector('#productList .product-offer-summary').textContent, /Stock unknown/);
  } finally { browser.close(); }
});


test("watch history includes terminal reasons beyond the first page and filters running watches", () => {
  const browser = shopper();
  try {
    browser.audit.state.actionPlatform = { watchQueue: Array.from({ length: 36 }, (_, index) => ({ id: `watch_${index}`, title: `Watch ${index}`, state: index === 0 ? "observing" : "window_closed", retailerId: "target", missionId: `mission_${index}`, closedReason: index === 0 ? "" : "window_expired", observationCount: 3, closesAt: "2026-09-05T12:00:00.000Z" })) };
    browser.audit.renderWatchHistory();
    assert.equal(browser.document.querySelectorAll("#watchHistoryList .mini-row").length, 25);
    assert.equal(browser.document.querySelector("#moreWatchHistory").hidden, false);
    browser.audit.state.watchHistoryLimit = 50;
    browser.audit.renderWatchHistory();
    assert.equal(browser.document.querySelectorAll("#watchHistoryList .mini-row").length, 36);
    assert.match(browser.document.querySelector("#watchHistoryList").textContent, /Window expired/);
    browser.document.querySelector("#watchHistoryFilter").value = "active";
    browser.audit.renderWatchHistory();
    assert.equal(browser.document.querySelectorAll("#watchHistoryList .mini-row").length, 1);
    assert.equal(browser.document.querySelector("[data-watch-cancel]").dataset.watchCancel, "watch_0");
  } finally { browser.close(); }
});

test("a late plan detail response cannot open over another workspace", async () => {
  const browser = shopper();
  try {
    let release: (value: unknown) => void = () => undefined;
    browser.fetch = () => new Promise((resolve) => { release = resolve; });
    const pending = browser.audit.openPlan("plan_late");
    browser.audit.setTab("find", { load: false });
    release({ ok: true, json: async () => ({ purchaseIntent: { id: "plan_late" } }) });
    await pending;
    assert.equal(browser.document.querySelector("#planDialog").open, false);
  } finally { browser.close(); }
});


test("Escape clears an entity route before a refresh can reopen the closing dialog", () => {
  const browser = shopper();
  try {
    for (const [panel, kind, dialogId, parameter] of [["cart", "plan", "planDialog", "planId"], ["find", "product", "productDialog", "productId"]]) {
      browser.audit.setTab(panel, { load: false });
      browser.history.replaceState(null, "", `#${panel}?${parameter}=entity_escape`);
      browser.audit.state.entity = { panel, kind, id: "entity_escape" };
      const dialog = browser.document.getElementById(dialogId);
      dialog.dataset.entityKey = `${panel}:${kind}:entity_escape`;
      dialog.showModal();
      browser.audit.applyHashRoute();
      assert.equal(dialog.open, true, "Applying the current route must preserve its open dialog");
      const cancel = new browser.Event("cancel", { cancelable: true });
      dialog.dispatchEvent(cancel);
      assert.equal(cancel.defaultPrevented, true);
      assert.equal(browser.audit.state.entity, null);
      assert.equal(browser.location.hash, `#${panel}`);
      browser.audit.applyHashRoute();
      assert.equal(dialog.open, false);
    }
  } finally { browser.close(); }
});
