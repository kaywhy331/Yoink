import assert from "node:assert/strict";
import test from "node:test";
import { adminBrowser, eventually } from "./helpers/admin-restoration.js";

function click(browser: Window & typeof globalThis, selector: string) {
  (browser.document.querySelector(selector) as HTMLButtonElement).click();
}
function confirm(browser: Window & typeof globalThis) {
  browser.document.querySelector("#confirmDialogForm")!.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
}
const join = (id: string) => `[data-admin-store-join="${id}"]`;
const status = (id: string) => `[data-admin-store-join-status="${id}"]`;

test("admin store join confirms its own Wanted scope and renders every skipped reason", async () => {
  const skips = [
    { id: "spend", title: '<img src=x onerror="attack()">', reason: "spending_limit" },
    { id: "review", title: "Reviewed item", reason: "needs_review" },
    { id: "changed", title: "Changed item", reason: "changed" }
  ];
  let skipped = skips;
  const fixture = await adminBrowser({ route: "stores/qualification/target", respond: async request => request.path.endsWith("/turn-on")
    ? { status: 200, body: { disposition: "turned_on", wants: { updated: 2, skipped } } } : undefined });
  const { browser, requests, snapshot } = fixture;
  try {
    await eventually(() => assert.ok(browser.document.querySelector(join("target"))));
    for (const executionMode of ["test", "live"]) {
      snapshot.settings.executionMode = executionMode;
      await fixture.refresh();
      click(browser, join("target"));
      const dialog = browser.document.querySelector("#confirmDialog")!;
      assert.match(dialog.textContent!, /Enable Target Wanted cart adds\?/);
      for (const text of [
        "Adds this store to your eligible Wanted items using their reviewed item price and quantity.",
        "Only the exact reviewed item, sold by this store at or below your item price limit.",
        "Each item’s total limit may increase for this store’s tax and allowance.",
        "Items blocked by spending limits, review or changes keep their stores.",
        "Paused items stay paused; global pause still applies.", "You place the order manually."
      ]) assert.ok(dialog.textContent!.includes(text));
      assert.equal(dialog.textContent!.includes("Test mode ends, so matches can add to cart."), executionMode !== "live");
      click(browser, "#confirmDialogCancel");
      await eventually(() => assert.equal((browser.document.querySelector(join("target")) as HTMLButtonElement).disabled, false));
      assert.equal(requests.filter(r => r.method === "POST").length, 0);
    }
    for (const count of [3, 1, 2, 0]) {
      skipped = skips.slice(0, count);
      click(browser, join("target")); confirm(browser);
      await eventually(() => assert.equal((browser.document.querySelector(join("target")) as HTMLButtonElement).disabled, false));
      const target = browser.document.querySelector(`#targetQualificationSummary ${status("target")}`)!;
      assert.match(target.textContent!, /Target is enabled\. 2 Wanted items now include this store\./);
      assert.equal(target.querySelectorAll("li").length, count);
      assert.equal(target.querySelector("img"), null);
      if (count) {
        assert.ok(target.textContent!.includes(`${count} ${count === 1 ? "item" : "items"} kept ${count === 1 ? "its" : "their"} stores.`));
        assert.ok(target.textContent!.includes(`Edit ${count === 1 ? "it" : "them"} in Wanted to add Target.`));
        assert.match(target.textContent!, /Spending limit/);
        if (count > 1) assert.match(target.textContent!, /Reviewed item: Needs review/);
        if (count > 2) assert.match(target.textContent!, /Changed item: Item changed/);
      } else assert.doesNotMatch(target.textContent!, /kept|Edit /);
      assert.equal(browser.document.querySelector(status("walmart"))!.textContent, "");
      await fixture.refresh();
      assert.equal(browser.document.querySelector(status("target"))!.textContent, target.textContent);
    }
    for (const request of requests.filter(r => r.method === "POST")) {
      assert.equal(request.path, "/api/v1/admin/stores/target/turn-on");
      assert.deepEqual(request.body, { confirmation: "TURN_ON_STORE_CART_ADDS" });
    }
    assert.equal(snapshot.settings.actionsPaused, true);
    assert.ok(browser.document.querySelector("#activateTargetAddButton"));
    snapshot.targetQualification = null; await fixture.refresh();
    assert.equal((browser.document.querySelector(join("target")) as HTMLButtonElement).disabled, true);
    snapshot.targetQualification = { qualificationEvidenceReady: true, checks: [] }; snapshot.counts.onlineDevices = 0; await fixture.refresh();
    assert.equal((browser.document.querySelector(join("target")) as HTMLButtonElement).disabled, true);
  } finally { fixture.close(); }
});

test("admin store join keeps pending approval, errors and ambiguous outcomes distinct", async () => {
  for (const code of [202, 400, 403, 409, "timeout", "unknown"] as const) {
    const fixture = await adminBrowser({ route: "stores/qualification/target", respond: async request => {
      if (!request.path.endsWith("/turn-on")) return;
      if (code === "timeout") throw Object.assign(new Error("The request timed out. Check the current state before trying again; your change may have been saved."), { code: "request_timeout" });
      return code === "unknown" ? { status: 200, body: {} } : { status: code, body: code === 202
        ? { disposition: "pending_approval" } : { error: "denied", message: "Store operation refused", correlationId: "reference-join" } };
    } });
    try {
      const { browser } = fixture;
      await eventually(() => assert.ok(browser.document.querySelector(join("target"))));
      click(browser, join("target")); confirm(browser);
      await eventually(() => assert.equal(fixture.requests.filter(r => r.method === "POST").length, 1));
      await eventually(() => assert.ok(browser.document.querySelector(status("target"))!.textContent));
      const text = browser.document.querySelector(status("target"))!.textContent!;
      assert.doesNotMatch(text, /is enabled|now include/);
      if (code === 202) { assert.match(text, /Pending approval/); assert.equal(browser.location.hash, "#approvals"); }
      else if (code === "timeout") assert.match(text, /timed out.*may have been saved/);
      else if (code === "unknown") assert.match(text, /outcome is unknown/);
      else assert.match(text, /reference-join/);
      assert.equal(fixture.requests.filter(r => r.method === "POST").length, 1);
    } finally { fixture.close(); }
  }
});

test("admin store join suppresses duplicate requests", async () => {
  let release: (() => void) | undefined;
  const fixture = await adminBrowser({ route: "stores/qualification/target", respond: async request => {
    if (!request.path.endsWith("/turn-on")) return;
    await new Promise<void>(resolve => { release = resolve; });
    return { status: 200, body: { disposition: "turned_on", wants: { updated: 1, skipped: [] } } };
  } });
  try {
    const { browser } = fixture;
    await eventually(() => assert.ok(browser.document.querySelector(join("target"))));
    click(browser, join("target")); click(browser, join("target"));
    assert.equal(fixture.requests.filter(r => r.method === "POST").length, 0);
    // The real shared dialog cancels Target when Walmart replaces it.
    click(browser, join("walmart")); confirm(browser);
    await eventually(() => assert.ok(release));
    click(browser, join("walmart"));
    assert.deepEqual(fixture.requests.filter(r => r.method === "POST").map(r => r.path), ["/api/v1/admin/stores/walmart/turn-on"]);
    release!();
    await eventually(() => assert.match(browser.document.querySelector(status("walmart"))!.textContent!, /1 Wanted item/));
    assert.equal(browser.document.querySelector(status("target"))!.textContent, "");
  } finally { release?.(); fixture.close(); }
});

test('admin store join retains the actual server result when the refresh fails', async () => {
  let failRefresh = false;
  const fixture = await adminBrowser({ route: 'stores/qualification/target', respond: async request => {
    if (request.path.endsWith('/turn-on')) {
      failRefresh = true;
      return { status: 200, body: { disposition: 'turned_on', wants: { updated: 1, skipped: [] } } };
    }
    if (failRefresh && request.path.startsWith('/api/v1/admin/snapshot?')) return { status: 503, body: { message: 'Snapshot unavailable' } };
  } });
  try {
    const { browser } = fixture;
    click(browser, join('target')); confirm(browser);
    await eventually(() => assert.match(browser.document.querySelector(status('target'))!.textContent!, /1 Wanted item now include this store/));
    assert.match(browser.document.querySelector(status('target'))!.textContent!, /refreshed status is unavailable.*Snapshot unavailable/);
    assert.equal(fixture.requests.filter(r => r.method === 'POST').length, 1);
    assert.equal(browser.document.querySelector(status('walmart'))!.textContent, '');
  } finally { fixture.close(); }
});
