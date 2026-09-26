import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

const webRoot = join(process.cwd(), "apps", "web");
const pendingFetch = () => new Promise<never>(() => undefined);

function prepareBrowser(html: string, url: string) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const browser = dom.window;
  Object.defineProperty(browser, "fetch", { configurable: true, value: pendingFetch });
  Object.defineProperty(browser, "setTimeout", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "clearTimeout", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
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

test("dashboard refreshes preserve route caches and use state-aware polling", () => {
  const admin = readFileSync(join(webRoot, "app.js"), "utf8");
  const shopper = readFileSync(join(webRoot, "user.js"), "utf8");

  assert.doesNotMatch(admin, /state\.loadedViews\.clear\(\)/);
  assert.doesNotMatch(admin, /setInterval\(refreshFromLoopback/);
  assert.match(admin, /liveView && \(activeJob \|\| activeTask\)\) return 3_000/);
  assert.match(admin, /\["overview", "actions", "notifications", "attribution", "signals", "operations"\][\s\S]+?return liveView \? 15_000/);
  assert.match(admin, /\? 15_000 : 30_000/);
  assert.match(admin, /backgroundRefresh = refresh\(true, \{ preservePagination: true, background: true \}\)/,
    "Admin polling must reload the active collection without collapsing pagination or static Access data.");
  assert.match(admin, /view === "access" && !background/);
  assert.match(admin, /preservePagination \? loadedCollectionLimit\(state\.jobItems\) : COLLECTION_PAGE_SIZE/);
  assert.match(admin, /\.catch\(\(\) => setAdminDataStale\(true\)\)/);

  assert.doesNotMatch(shopper, /state\.loadedRoutes\.clear\(\)/);
  assert.doesNotMatch(shopper, /ACTION_HANDOFF_REARM_MS|setInterval\(poll/);
  assert.match(shopper, /queued \+ checking > 0\) return 3_000/);
  assert.match(shopper, /activeUserRoute\(\) === "activity" \? 15_000 : 30_000/);
  assert.match(shopper, /\["products", "stores", "calls", "plans"\]\.includes\(route\)/);
  assert.match(shopper, /loadUserRoute\(route, \{ force: true, preservePagination: true \}\)/);
  assert.match(shopper, /preservePagination \? loadedProductLimit\(\) : state\.productPageSize/);
  assert.match(shopper, /preservePagination \? loadedStoreProductLimit\(\) : state\.productPageSize/);
  assert.match(shopper, /button\.id === "userDataFreshness"[\s\S]+?await resumeVisibleDashboard\(\)/);
  assert.match(shopper, /preservePagination: true/);
  assert.match(shopper, /return preservePagination \? request : request\.catch\(\(error\) => \{[\s\S]+?return null;[\s\S]+?\}\)/,
    "Background workspace requests must surface a stale state instead of replacing live data with fallbacks.");
  assert.doesNotMatch(shopper, /routeRequest\([^)]*\{ (items|stores): \[\] \}\)/,
    "A failed secondary request keeps the previous state instead of an empty fallback.");
  assert.match(shopper, /if \(readiness\) state\.storeSetups = readiness\.stores/);
  assert.match(shopper, /\.catch\(\(\) => setUserDataStale\(true\)\)/);

  for (const [file, id] of [["index.html", "adminDataFreshness"], ["user.html", "userDataFreshness"]] as const) {
    const html = readFileSync(join(webRoot, file), "utf8");
    assert.match(html, new RegExp(`id="${id}"[^>]+aria-live="polite"[^>]+hidden`));
  }
});

test("admin shows skeletons only on first load and never replaces existing rows", () => {
  const browser = prepareBrowser(
    readFileSync(join(webRoot, "index.html"), "utf8"),
    "http://127.0.0.1:32991/admin#overview"
  );
  try {
    const source = readFileSync(join(webRoot, "app.js"), "utf8");
    const marker = "\ntry {\n  applyAdminHashRoute();";
    assert.ok(source.includes(marker));
    const instrumented = source.replace(
      marker,
      "\nglobalThis.__ux12Admin = { state, adminPollDelay, loadedCollectionLimit, showAdminViewSkeleton };\ntry {\n  applyAdminHashRoute();"
    );
    void browser.eval(`(async () => { ${instrumented}\n })()`);

    const controls = (browser as unknown as {
      __ux12Admin: {
        state: { view: string; snapshot: { counts: { activeActionJobs: number } } | null; jobItems: Array<{ state: string }>; backgroundWork: { tasks: Array<{ state: string }> } | null; loadedViews: Set<string> };
        adminPollDelay(): number;
        loadedCollectionLimit(items: unknown[], maximum?: number): number;
        showAdminViewSkeleton(view: string): boolean;
      };
    }).__ux12Admin;
    assert.ok(browser.document.querySelector("#metricGrid .skeleton-list"));
    assert.equal(controls.adminPollDelay(), 15_000);
    controls.state.view = "settings";
    assert.equal(controls.adminPollDelay(), 30_000);
    controls.state.snapshot = { counts: { activeActionJobs: 1 } };
    assert.equal(controls.adminPollDelay(), 30_000);
    controls.state.view = "actions";
    assert.equal(controls.adminPollDelay(), 3_000);
    assert.equal(controls.loadedCollectionLimit(Array.from({ length: 137 })), 137);
    assert.equal(controls.loadedCollectionLimit([]), 50);
    assert.equal(controls.loadedCollectionLimit(Array.from({ length: 550 })), 500);
    assert.equal(controls.loadedCollectionLimit(Array.from({ length: 550 }), 200), 200,
      "library polls stop at the API clamp so a preserved page is never truncated");
    assert.match(source, /loadedCollectionLimit\(state\.libraryItems, COLLECTION_POLL_LIMITS\.library\)/);
    assert.match(source, /COLLECTION_POLL_LIMITS = Object\.freeze\(\{ library: 200 \}\)/);

    const library = browser.document.querySelector("#libraryList") as HTMLElement;
    library.innerHTML = '<article data-existing-row="true">Existing product</article>';
    assert.equal(controls.showAdminViewSkeleton("library"), false);
    assert.ok(library.querySelector('[data-existing-row="true"]'));
  } finally {
    browser.close();
  }
});

test("shopper shows skeletons only on first load and never replaces existing cards", () => {
  const browser = prepareBrowser(
    readFileSync(join(webRoot, "user.html"), "utf8"),
    "http://127.0.0.1:32991/#home"
  );
  try {
    const source = readFileSync(join(webRoot, "user.js"), "utf8");
    const marker = "\napplyHashRoute();\nconst initialRoute";
    assert.ok(source.includes(marker));
    const instrumented = source.replace(
      marker,
      "\nglobalThis.__ux12User = { state, adaptivePollDelay, loadedProductLimit, showUserRouteSkeleton };\napplyHashRoute();\nconst initialRoute"
    );
    browser.eval(instrumented);

    const controls = (browser as unknown as {
      __ux12User: {
        state: { overview: unknown; actionInsights: unknown; loadedRoutes: Set<string> };
        adaptivePollDelay(): number;
        loadedProductLimit(): number;
        showUserRouteSkeleton(route: string): boolean;
      };
    }).__ux12User;
    assert.ok(browser.document.querySelector("#homeRecentList .skeleton-list"));
    assert.equal(controls.adaptivePollDelay(), 30_000);

    browser.document.querySelector('[data-panel="home"]')?.classList.remove("active");
    browser.document.querySelector('[data-panel="activity"]')?.classList.add("active");
    assert.equal(controls.adaptivePollDelay(), 15_000);
    controls.state.actionInsights = { stages: { queued: 1 } };
    assert.equal(controls.adaptivePollDelay(), 3_000);

    Object.assign(controls.state, { productGroups: Array.from({ length: 137 }), productPageSize: 48 });
    assert.equal(controls.loadedProductLimit(), 137);
    Object.assign(controls.state, { productGroups: Array.from({ length: 250 }) });
    assert.equal(controls.loadedProductLimit(), 250);

    const products = browser.document.querySelector("#productList") as HTMLElement;
    products.innerHTML = '<article data-existing-card="true">Existing product</article>';
    assert.equal(controls.showUserRouteSkeleton("products"), false);
    assert.ok(products.querySelector('[data-existing-card="true"]'));
  } finally {
    browser.close();
  }
});

test("both skeleton treatments honor reduced-motion preferences", () => {
  for (const file of ["styles.css", "user.css"]) {
    const css = readFileSync(join(webRoot, file), "utf8");
    assert.match(css, /\.skeleton-row[^}]+animation: skeleton-shift/s);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]+animation: none !important/);
  }
});

test("an admin poll reloads every row loaded through More without truncating the list", async () => {
  const browser = prepareBrowser(
    readFileSync(join(webRoot, "index.html"), "utf8"),
    "http://127.0.0.1:32991/admin#actions"
  );
  const requests: string[] = [];
  const jobs = Array.from({ length: 120 }, (_, index) => ({
    id: `job_poll_${index}`,
    title: `Poll job ${index}`,
    retailerId: "target",
    retailerSku: `9500${index}`,
    state: "awaiting_executor",
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: 4_999,
    maxOrderTotalCents: 6_000,
    currency: "USD",
    sellerPolicy: "first_party_only",
    attributionProvider: "canonical",
    expiresAt: "2026-09-02T12:00:00.000Z"
  }));
  const snapshot = {
    view: "actions",
    version: "poll-test",
    actor: { displayName: "Poll Fixture", roleLabels: [], sessionKind: "local", signOutUrl: "" },
    permissions: [],
    settings: { actionsPaused: false, executionMode: "live" },
    counts: { onlineDevices: 1, activeActionJobs: 0 },
    trackalacker: { ready: true },
    capabilities: { targetAddQualified: true, targetAddMutationAuthorized: true }
  };
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (pathValue: string) => {
      const path = String(pathValue);
      requests.push(path);
      const url = new URL(path, "http://127.0.0.1:32991");
      let payload: unknown = {};
      if (url.pathname === "/api/v1/admin/snapshot") payload = snapshot;
      if (url.pathname === "/api/v1/user/jobs") {
        const limit = Number(url.searchParams.get("limit"));
        const offset = Number(url.searchParams.get("offset"));
        payload = { items: jobs.slice(offset, offset + limit), total: jobs.length, offset, limit, insights: {}, glossary: {} };
      }
      return { ok: true, status: 200, json: async () => payload };
    }
  });
  try {
    const source = readFileSync(join(webRoot, "app.js"), "utf8");
    const marker = "\ntry {\n  applyAdminHashRoute();";
    assert.ok(source.includes(marker));
    void browser.eval(`(async () => { ${source.replace(
      marker,
      "\nglobalThis.__ux12Poll = { state, refresh };\ntry {\n  applyAdminHashRoute();"
    )}\n })()`);
    const controls = (browser as unknown as {
      __ux12Poll: {
        state: { jobItems: unknown[] };
        refresh(reloadCollections: boolean, options: { preservePagination: boolean }): Promise<void>;
      };
    }).__ux12Poll;
    const rows = () => browser.document.querySelectorAll("#jobList article").length;
    await eventually(() => assert.equal(rows(), 50));
    (browser.document.querySelector("#jobMoreButton") as HTMLButtonElement).click();
    await eventually(() => assert.equal(rows(), 100));
    assert.deepEqual(requests.filter((path) => path.startsWith("/api/v1/user/jobs")), [
      "/api/v1/user/jobs?limit=50&offset=0&q=",
      "/api/v1/user/jobs?limit=50&offset=50&q="
    ]);

    await controls.refresh(true, { preservePagination: true });
    assert.equal(rows(), 100, "a background poll keeps every row the admin loaded through More");
    assert.equal(controls.state.jobItems.length, 100);
    assert.equal(requests.filter((path) => path.startsWith("/api/v1/user/jobs")).at(-1), "/api/v1/user/jobs?limit=100&offset=0&q=");
    assert.match(browser.document.querySelector("#jobCount")?.textContent ?? "", /100 of 120/);
  } finally {
    browser.close();
  }
});

async function eventually(assertion: () => void, attempts = 200): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}
