import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Regression tests for the 2026-09-25 web review fixes (WEB-02..WEB-16 and
// the I1 request marker). Each browser test loads the real bundle into jsdom
// with a fetch that never settles, then drives the functions directly.

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

const webRoot = join(process.cwd(), "apps", "web");
const pendingFetch = () => new Promise<never>(() => undefined);
type Browser = Window & typeof globalThis & { close(): void; eval(source: string): unknown } & Record<string, any>;
type FakeResponse = { ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown> };
const ok = (body: unknown): FakeResponse => ({ ok: true, status: 200, json: async () => body });
const failed = (status = 503): FakeResponse => ({ ok: false, status, json: async () => ({ error: "unavailable", message: "Unavailable." }) });

function prepareBrowser(file: "user.html" | "index.html", url: string): Browser {
  const dom = new JSDOM(readFileSync(join(webRoot, file), "utf8"), { url, runScripts: "outside-only", pretendToBeVisual: true });
  const browser = dom.window as Browser;
  Object.defineProperty(browser, "fetch", { configurable: true, writable: true, value: pendingFetch });
  Object.defineProperty(browser, "setTimeout", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "clearTimeout", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "clearInterval", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async () => ({ confirmed: false, note: "" }) }
  });
  return browser;
}

function loadShopper(): Browser {
  const browser = prepareBrowser("user.html", "http://127.0.0.1:32991/#cart");
  // Top-level const/let in eval'd code stay private to that eval; expose state.
  browser.eval(`${readFileSync(join(webRoot, "user.js"), "utf8")}\nglobalThis.__fxState = state;\n//# sourceURL=fx-web-user.js`);
  return browser;
}

function loadAdmin(view = "overview"): Browser {
  const browser = prepareBrowser("index.html", `http://127.0.0.1:32991/admin#${view}`);
  const source = readFileSync(join(webRoot, "app.js"), "utf8");
  const marker = "\ntry {\n  applyAdminHashRoute();";
  assert.ok(source.includes(marker));
  const instrumented = source.replace(marker, `\nglobalThis.__fxAdmin = { state, api, formatMoney, safeHref, loadLibrary, refresh, renderAdminAnalytics, qualificationLaunchCandidates };${marker}`);
  void browser.eval(`(async () => { ${instrumented}\n })()`);
  return browser;
}

function recordingFetch(browser: Browser, respond: (path: string, options: RequestInit) => FakeResponse | Promise<FakeResponse>) {
  const calls: Array<{ path: string; options: RequestInit }> = [];
  browser.fetch = (async (path: string, options: RequestInit = {}) => {
    calls.push({ path: String(path), options });
    return respond(String(path), options);
  }) as typeof fetch;
  return calls;
}

test("web bundles never rely on inline style attributes and retailer host tables are pre-normalized", () => {
  for (const file of ["app.js", "user.js", "checkout-reports.js"]) {
    const source = readFileSync(join(webRoot, file), "utf8");
    assert.doesNotMatch(source, /style="/, `${file}: the CSP drops style attributes; set widths through the CSSOM`);
  }
  const admin = readFileSync(join(webRoot, "app.js"), "utf8");
  const shopper = readFileSync(join(webRoot, "user.js"), "utf8");
  const qualificationHosts = [...(admin.match(/QUALIFICATION_RETAILER_HOSTS = Object\.freeze\(\{([\s\S]+?)\}\)/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const guardedHosts = [...(shopper.match(/GUARDED_RETAILER_DIRECT_HOSTS = new Set\(\[([^\]]+)\]\)/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(qualificationHosts.includes("audioadvice.com"));
  assert.ok(guardedHosts.includes("audioadvice.com"));
  for (const host of [...qualificationHosts, ...guardedHosts]) {
    assert.equal(host, host!.toLocaleLowerCase("en-US").replace(/\.$/, "").replace(/^www\./, ""), `${host} is compared after www. is stripped`);
  }
});

test("shopper api() marks every request with X-Yoink-Request and formats hostile values safely", async () => {
  const browser = loadShopper();
  try {
    const calls = recordingFetch(browser, () => ok({}));
    await browser.eval(`api("/api/v1/user/overview")`);
    await browser.eval(`api("/api/v1/user/devices/pairing-code", { method: "POST", body: "{}" })`);
    assert.equal((calls[0]!.options.headers as Record<string, string>)["X-Yoink-Request"], "1");
    assert.equal((calls[0]!.options.headers as Record<string, string>)["Content-Type"], undefined);
    assert.equal((calls[1]!.options.headers as Record<string, string>)["X-Yoink-Request"], "1");
    assert.equal((calls[1]!.options.headers as Record<string, string>)["Content-Type"], "application/json");

    for (const currency of [null, "", "US", "not a code", 7]) {
      assert.match(browser.money(1999, currency), /19\.99/);
    }
    assert.match(browser.money(1999, "eur"), /19\.99/);
    assert.equal(browser.safeHref("javascript:alert(1)"), "");
    assert.equal(browser.safeHref("data:text/html,x"), "");
    assert.equal(browser.safeHref("http://evil.example/"), "");
    assert.equal(browser.safeHref("https://www.target.com/p/-/A-1"), "https://www.target.com/p/-/A-1");
    assert.equal(browser.safeHref("/api/v1/extension/release/download"), "/api/v1/extension/release/download");
  } finally {
    browser.close();
  }
});

test("admin api() marks requests, analytics bars use the CSSOM, and day labels stay on the UTC date", async () => {
  const browser = loadAdmin("analytics");
  const previousZone = process.env.TZ;
  try {
    const admin = browser.__fxAdmin;
    const calls = recordingFetch(browser, () => ok({}));
    await admin.api("/api/v1/admin/storage/backup", { method: "POST", body: "{}" });
    assert.equal((calls[0]!.options.headers as Record<string, string>)["X-Yoink-Request"], "1");
    assert.match(admin.formatMoney(500, null), /5\.00/);
    assert.equal(admin.safeHref("javascript:alert(1)"), "");

    process.env.TZ = "Pacific/Kiritimati";
    admin.state.adminAnalytics = {
      window: "7d",
      totals: {}, overCap: {}, funnel: [], attribution: {}, stores: [], latency: {},
      days: [
        { day: "2026-09-01", signals: 10, carted: 5, gotIt: 0, clicks: 0, conversions: 0 },
        { day: "2026-09-02", signals: 2, carted: 0, gotIt: 0, clicks: 0, conversions: 0 }
      ]
    };
    admin.renderAdminAnalytics();
    const rows = [...browser.document.querySelectorAll("#adminAnalyticsDays .analytics-day")];
    assert.equal(rows.length, 2);
    const firstBars = [...rows[0]!.querySelectorAll(".analytics-day-bars span")] as HTMLElement[];
    assert.equal(firstBars[0]!.getAttribute("style")?.includes("width: 100%") ?? false, true);
    assert.equal(firstBars[1]!.style.width, "50%");
    assert.equal((rows[1]!.querySelector(".analytics-day-bars span") as HTMLElement).style.width, "20%");
    assert.match(rows[0]!.querySelector("time")?.textContent ?? "", /\b1\b/, "2026-09-01 must not render as the next day east of UTC+12");
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
    browser.close();
  }
});

test("admin qualification launch accepts Audio Advice product URLs", () => {
  const browser = loadAdmin();
  try {
    const candidates = browser.__fxAdmin.qualificationLaunchCandidates({
      retailerId: "audioadvice",
      candidates: [{ canonicalUrl: "https://www.audioadvice.com/products/sample-speaker", retailerSku: "123" }]
    });
    assert.equal(candidates.length, 1);
    assert.match(candidates[0].url, /^https:\/\/www\.audioadvice\.com\/products\/sample-speaker#/);
  } finally {
    browser.close();
  }
});

test("admin collection loads apply only the newest response", async () => {
  const browser = loadAdmin("library");
  try {
    const admin = browser.__fxAdmin;
    const pending: Array<{ path: string; resolve: (value: FakeResponse) => void }> = [];
    recordingFetch(browser, (path) => new Promise<FakeResponse>((resolve) => pending.push({ path, resolve })));
    const search = browser.document.querySelector("#librarySearch") as HTMLInputElement;
    search.value = "pika";
    const older = admin.loadLibrary(true);
    search.value = "pikachu";
    const newer = admin.loadLibrary(true);
    await new Promise((resolve) => setImmediate(resolve));
    const olderRequest = pending.find((entry) => entry.path.includes("q=pika&") || entry.path.endsWith("q=pika"))!;
    const newerRequest = pending.find((entry) => entry.path.includes("q=pikachu"))!;
    newerRequest.resolve(ok({ items: [{ id: "new" }], total: 1 }));
    await newer;
    olderRequest.resolve(ok({ items: [{ id: "old" }], total: 1 }));
    assert.equal(await older, false);
    assert.deepEqual(admin.state.libraryItems.map((item: { id: string }) => item.id), ["new"]);
    assert.equal(admin.state.libraryQuery, "pikachu");
  } finally {
    browser.close();
  }
});

test("a failed secondary request keeps previous shopper data and names the missing section", async () => {
  const browser = loadShopper();
  try {
    const state = browser.__fxState as Record<string, any>;
    state.storeSetups = [{ retailerId: "target", summary: "Ready" }];
    recordingFetch(browser, (path) => {
      if (path.startsWith("/api/v1/user/action-platform")) return failed();
      if (path.startsWith("/api/v1/user/privacy")) return ok({ inventory: { categories: [], totalRecords: 0 } });
      return ok({ items: [], total: 0, stores: [] });
    });
    const complete = await browser.eval(`loadUserRouteData("setup", { force: true })`);
    assert.equal(complete, false);
    assert.deepEqual(state.storeSetups, [{ retailerId: "target", summary: "Ready" }], "a store status failure must not read as 'no store set up'");
    assert.match(browser.document.querySelector('[data-route-load-error="setup"]')?.textContent ?? "", /store status/);
  } finally {
    browser.close();
  }
});

test("a superseded overview never overwrites a newer one", async () => {
  const browser = loadShopper();
  try {
    const state = browser.__fxState as Record<string, any>;
    for (const name of ["renderOverview", "renderWalmartDraws", "showUserRouteSkeleton"]) browser.eval(`${name} = () => undefined;`);
    browser.eval(`loadUserRoute = async () => true;`);
    state.affiliateRouting = { protocolVersion: 1 };
    const overviews: Array<(value: FakeResponse) => void> = [];
    recordingFetch(browser, (path) => path === "/api/v1/user/overview"
      ? new Promise<FakeResponse>((resolve) => overviews.push(resolve))
      : ok({}));
    const older = browser.eval(`refreshDashboard()`) as Promise<unknown>;
    const newer = browser.eval(`refreshDashboard()`) as Promise<unknown>;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(overviews.length, 2);
    overviews[1]!(ok({ settings: { actionsPaused: true } }));
    assert.equal(await newer, true);
    overviews[0]!(ok({ settings: { actionsPaused: false } }));
    assert.equal(await older, "superseded");
    assert.equal(state.overview.settings.actionsPaused, true);
  } finally {
    browser.close();
  }
});

test("the fast poll reloads a list only when the handoff cursor moved or the list is stale", async () => {
  const browser = loadShopper();
  try {
    const state = browser.__fxState as Record<string, any>;
    browser.eval(`activeUserRoute = () => "find"; refreshCompactActionHandoff = async () => undefined;`);
    let reloads = 0;
    browser.eval(`loadUserRoute = async () => { globalThis.__fxReloads = (globalThis.__fxReloads || 0) + 1; return true; };`);
    const read = () => { reloads = Number(browser.eval("globalThis.__fxReloads || 0")); return reloads; };
    state.loadedRoutes.add("find");
    state.routeLoadStamps.set("find", { at: Date.now(), cursor: browser.eval("actionHandoffCursorKey()") });
    await browser.eval("refreshVisibleActionState(0)");
    assert.equal(read(), 0, "an unchanged cursor on a fresh list skips the full reload");
    state.actionHandoffAvailabilityVersion = Number(state.actionHandoffAvailabilityVersion || 0) + 1;
    await browser.eval("refreshVisibleActionState(0)");
    assert.equal(read(), 1, "a moved cursor reloads the visible list");
    state.routeLoadStamps.set("find", { at: Date.now() - 31_000, cursor: browser.eval("actionHandoffCursorKey()") });
    await browser.eval("refreshVisibleActionState(0)");
    assert.equal(read(), 2, "a list older than the idle cadence reloads");
  } finally {
    browser.close();
  }
});

test("list re-renders keep keyboard focus and open details", () => {
  const browser = loadShopper();
  try {
    const list = browser.document.querySelector("#callList") as HTMLElement;
    const markup = `<article data-ui-key="call_1"><details><summary>More</summary></details><button data-watch-enroll="w1" type="button">Watch</button><button data-want-listing="l1" type="button">Want it</button></article>`;
    list.innerHTML = markup;
    (list.querySelector("details") as HTMLDetailsElement).open = true;
    const want = list.querySelector("[data-want-listing]") as HTMLButtonElement;
    want.focus();
    const restore = browser.eval(`captureListUi("#callList")`) as () => void;
    list.innerHTML = markup;
    restore();
    assert.equal(browser.document.activeElement, list.querySelector("[data-want-listing]"));
    assert.equal((list.querySelector("details") as HTMLDetailsElement).open, true);
  } finally {
    browser.close();
  }
});

test("pairing notices a device paired from the extension without a route reload", async () => {
  const browser = loadShopper();
  try {
    const state = browser.__fxState as Record<string, any>;
    browser.eval(`renderPairedDevices = () => undefined;`);
    const pairing = browser.document.querySelector("#pairing") as HTMLElement;
    pairing.hidden = false;
    state.devices = [];
    state.pairing = { code: "ABCD-1234", expiresAt: new Date(Date.now() + 120_000).toISOString(), deviceIds: [], devicesCheckedAt: 0 };
    const calls = recordingFetch(browser, () => ok({ items: [{ id: "device_new", status: "active" }] }));
    browser.eval("pairingTick()");
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.filter((call) => call.path === "/api/v1/user/devices").length, 1);
    assert.match(pairing.textContent ?? "", /Chrome paired successfully/);
    browser.eval("pairingTick()");
    assert.equal(calls.length, 1, "a finished pairing stops polling");
  } finally {
    browser.close();
  }
});

test("Undo on a shopper pause always resumes and admin strategy Undo re-inserts only the deleted rule", () => {
  const shopper = readFileSync(join(webRoot, "user.js"), "utf8");
  assert.match(shopper, /toggleActions\(\{ paused: false, skipConfirmation: true \}\)/);
  const admin = readFileSync(join(webRoot, "app.js"), "utf8");
  assert.doesNotMatch(admin, /saveStrategies\(previous\)/);
  assert.match(admin, /onClick: async \(\) => \{\n\s+if \(!\(await confirmTenantResume\(\)\)\) return;/,
    "tenant-wide Undo is a resume and confirms like one");
  assert.match(admin, /button\.disabled = state\.serviceStorage\?\.storage\?\.backupAllowed !== true;/);
});

test("shopper resume sends the confirmed preflight token and a stale token reads as plain copy", async () => {
  const browser = loadShopper();
  try {
    const state = browser.__fxState;
    state.overview = {
      settings: {
        actionsPaused: true,
        resume: { paused: true, allowed: true, blockers: [], summary: ["Target"], confirmationToken: "rp1:abcdef0123456789" }
      }
    };
    browser.YoinkDialogs.confirmDialog = async () => ({ confirmed: true, note: "" });
    const bodies: Array<Record<string, unknown>> = [];
    const toasts: string[] = [];
    browser.toast = (message: string) => { toasts.push(String(message)); };
    recordingFetch(browser, (path, options) => {
      if (options.method === "PATCH") {
        bodies.push(JSON.parse(String(options.body)));
        return { ok: false, status: 409, json: async () => ({ error: "resume_scope_changed", message: "Resume scope changed.", details: {} }) };
      }
      return pendingFetch();
    });
    void browser.eval("toggleActions()");
    for (let index = 0; index < 50 && !toasts.length; index += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(bodies[0]?.paused, false);
    assert.equal(bodies[0]?.confirmationToken, "rp1:abcdef0123456789");
    assert.equal(toasts[0], "What Auto-cart allows changed. Review it and turn it on again.");
  } finally {
    browser.close();
  }
});
