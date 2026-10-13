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

async function eventually(assertion: () => void, attempts = 40): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

test("user and admin navigation expose task areas with contextual disclosure", () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const user = new JSDOM(readFileSync(join(webRoot, "user.html"), "utf8"), { url: "http://127.0.0.1:32991/" });
  const admin = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), { url: "http://127.0.0.1:32991/admin" });
  try {
    const doc = user.window.document;
    // Three tabs: Cart, Find and Setup. Calls and History are views inside Cart.
    const userTabs = [...doc.querySelectorAll("main > .tabs > [data-tab]")];
    assert.deepEqual(userTabs.map((item) => item.firstChild?.textContent?.trim()), ["Cart", "Find", "Setup"]);
    assert.deepEqual([...doc.querySelectorAll("[data-panel]")].map((panel) => panel.getAttribute("data-panel")),
      ["cart", "calls", "activity", "find", "setup"]);
    for (const removed of ["home", "products", "stores", "plans", "insights", "preferences", "drawings"]) {
      assert.equal(doc.querySelector(`[data-panel="${removed}"]`), null, `${removed} is not a workspace any more`);
    }
    assert.equal(doc.querySelectorAll("[data-settings-view], [data-settings-panel], .settings-tabs").length, 0);
    // The header has one Auto-cart switch instead of Pause/Resume and a mode pill.
    const autoCart = doc.querySelector("#pauseButton") as HTMLElement;
    assert.equal(autoCart.getAttribute("role"), "switch");
    assert.equal(autoCart.querySelector(".auto-cart-label")?.textContent, "Auto-cart");
    assert.equal(doc.querySelector(".mode-pill"), null);
    assert.equal(doc.querySelectorAll("#calls .subtabs").length, 0);
    assert.deepEqual(
      [...doc.querySelectorAll("#calls [data-call-filter]")].map((item) => item.textContent?.trim()),
      ["All", "Products", "Drawings", "Discord"]
    );
    assert.equal((doc.querySelector("#callDrawingTitle")?.parentElement?.textContent || "").match(/Entry stays manual on Walmart/g)?.length, 1);
    assert.equal(doc.querySelector('[data-panel="calls"] > .back-link[data-tab="cart"]') !== null, true);
    assert.equal(doc.querySelector('[data-panel="activity"] > .back-link[data-tab="cart"]') !== null, true);
    assert.equal(doc.querySelector('[data-panel="activity"] .section-heading h2')?.textContent?.trim(), "History");
    // Setup is one page in sections.
    assert.deepEqual([...doc.querySelectorAll("[data-setup-section]")].map((item) => item.textContent?.trim()),
      ["Stores", "Chrome", "Discord", "Alerts", "Limits", "Your data"]);
    assert.deepEqual([...doc.querySelectorAll("[data-setup-block]")].map((item) => item.getAttribute("data-setup-block")),
      ["stores", "chrome", "discord", "alerts", "limits", "data"]);
    for (const [selector, block] of [["#storeSwitchList", "stores"], ["#pairButton", "chrome"], ["#pairedDevices", "chrome"],
      ["#discordEnabled", "discord"], ["#discordChannelList", "discord"],
      ["#deliveryCard", "alerts"], ["#connectorForm", "alerts"], ["#spendForm", "limits"], ["#watchQueueMode", "limits"],
      ["#privacyExportLink", "data"], ["#analyticsCsv", "data"]] as const) {
      assert.ok(doc.querySelector(selector)?.closest(`[data-setup-block="${block}"]`), `${selector} belongs in Setup › ${block}`);
    }
    assert.match(doc.querySelector("#notifications h3")?.textContent ?? "", /Discord, Slack and webhooks/);
    assert.equal(doc.querySelector("#connections"), null, "the notifications card no longer borrows the sources name");
    assert.equal(doc.querySelectorAll(".preference-card > .icon").length, 0);
    assert.equal(doc.querySelector("#restartWorker"), null);
    assert.equal(doc.querySelector("#healthSummary"), null);
    assert.equal(doc.querySelector("#recoveryReviewList"), null);
    // Cart: the announcement, then what needs you, Wanted, Calls and results.
    const cart = doc.querySelector('[data-panel="cart"]') as HTMLElement;
    assert.equal(cart.firstElementChild?.id, "releaseAnnouncement");
    assert.deepEqual([...cart.querySelectorAll(":scope > section")].map((section) => section.id),
      ["releaseAnnouncement", "homeNow", "wantedSection", "homeCalls", "homeUpcomingDrops", "homeRecent"]);
    assert.equal(doc.querySelector("#wantedSection h2")?.textContent?.trim(), "Wanted");
    assert.equal(doc.querySelector("#homeCalls h2")?.textContent?.trim(), "Calls");
    assert.equal(doc.querySelector("#homeLimits"), null, "limits live in Setup");
    assert.equal(doc.body.textContent?.includes("Deployment reference"), false);
    assert.equal(doc.querySelectorAll("[data-panel].active").length, 1);
    assert.equal(doc.querySelector("[data-panel=cart]")?.classList.contains("active"), true);
    assert.equal(doc.querySelectorAll("#setupGuide").length, 0);
    assert.deepEqual(
      [...doc.querySelectorAll(".product-view-toggle [data-product-view]")].map((item) => item.textContent?.trim()),
      []
    );
    assert.equal(doc.querySelector("#productList")?.getAttribute("data-product-view"), null);
    const callsPanel = doc.querySelector('[data-panel="calls"]') as HTMLElement;
    const callsHeading = callsPanel.querySelector(":scope > .section-heading") as HTMLElement;
    assert.equal(callsHeading.querySelector("h2")?.textContent?.trim(), "Calls");
    assert.equal(callsHeading.querySelector("#callCount") !== null, true);
    assert.equal(callsHeading.querySelectorAll("button, select, .eyebrow").length, 0,
      "the Calls header contains only its title and count");
    // Want it replaced Quick add's setups and bulk tools: each item has one next step.
    assert.equal(callsPanel.querySelector("#callSelectionToolbar"), null);
    for (const removed of ["#quickAddMenu", "#profileDialog", "#planBulkBar", "#planBulkApplyDialog", "#togglePlanBulk"]) {
      assert.equal(doc.querySelector(removed), null, `${removed} is gone`);
    }
    assert.ok(doc.querySelector("#wantDialog #wantForm"));
    assert.ok(doc.querySelector("#callAddedDialog #callAddedForm"));

    const adminTabs = [...admin.window.document.querySelectorAll(".primary-nav > [data-admin-group]")];
    assert.deepEqual(adminTabs.map((item) => item.textContent?.trim()), [
      "Overview", "Inbox", "Stores", "Sources", "Catalog", "Plans", "Activity", "Settings", "Maintainer"
    ]);
    const adminScript = readFileSync(join(webRoot, "app.js"), "utf8");
    for (const [view, label] of [
      ["library", "Catalog"], ["missions", "Plans"], ["activity", "Activity"],
      ["settings", "Settings"], ["access", "Users"], ["operations", "Operations"],
      // Single-item groups carry the page title so the nav label and the page heading agree.
      ["overview", "Overview"], ["stores", "Stores"], ["sources", "Sources"], ["community", "Maintainer"]
    ]) {
      assert.match(adminScript, new RegExp(`view: "${view}", label: "${label}"`));
    }
    assert.doesNotMatch(adminScript, /label: "(?:Listings & review|Purchase plans|Audit|Guardrails & affiliate|Access|System|Now|Store readiness|Source channels|Evidence)"/);
    assert.match(adminScript, /users: "access"/);
    assert.match(adminScript, /"drop-windows": "sources\/drops"/);
    assert.deepEqual(
      [...admin.window.document.querySelectorAll('[data-connections-surface="sources"]')].map((item) => item.textContent?.trim()),
      ["Channels", "Drop windows"]
    );
    assert.equal(admin.window.document.querySelector("#listingDialog h2")?.textContent, "Add listing");
    assert.equal(admin.window.document.querySelectorAll("[data-connections-view]").length, 4);
    assert.equal(admin.window.document.querySelectorAll(".safety-icon").length, 0);
    assert.equal(admin.window.document.querySelectorAll('[data-connections-surface="stores"]').length, 2);
    assert.equal(admin.window.document.querySelectorAll('[data-connections-surface="sources"]').length, 2);
    const qualificationPanels = [...admin.window.document.querySelectorAll("[data-qualification-panel]")] as HTMLElement[];
    assert.equal(qualificationPanels.length, 12);
    assert.equal(qualificationPanels.filter((panel) => !panel.hidden).length, 1);
    assert.equal(qualificationPanels.find((panel) => !panel.hidden)?.dataset.qualificationPanel, "target");
    assert.deepEqual(
      [...admin.window.document.querySelectorAll("[data-qualification-retailer]")].map((item) => item.textContent?.trim()),
      ["Target", "Walmart", "Amazon", "Best Buy", "Pokémon Center", "ASUS", "Audio Advice", "Banana Republic", "Banana Republic Factory", "Athleta", "American Eagle", "ANINE BING"]
    );
    assert.equal(admin.window.document.querySelector("#laneReadinessList"), null);
    assert.equal(admin.window.document.querySelectorAll(".lane-readiness-inline").length, 12);
    assert.equal(admin.window.document.querySelectorAll("[data-community-view]").length, 7);
    assert.equal(admin.window.document.querySelectorAll("[data-operations-view]").length, 3);
    assert.equal(admin.window.document.querySelector('[data-operations-panel="workers"] #adminRestartWorkerButton') !== null, true);
    assert.equal(admin.window.document.querySelector('[data-community-panel="observers"] #observerRecoveryList') !== null, true);
    assert.equal(admin.window.document.querySelector('[data-admin-group="maintainer"]')?.hasAttribute("hidden"), true);
    assert.equal(admin.window.document.querySelectorAll('[data-community-panel="observers"] textarea').length, 2);
    assert.equal(admin.window.document.querySelectorAll('.panel-heading > .button.danger').length, 0);
    assert.equal(admin.window.document.querySelectorAll(".danger-zone > .button.danger").length, 2);
    assert.equal(admin.window.document.querySelectorAll("[data-alerts-view]").length, 3);
    assert.equal(admin.window.document.querySelectorAll("[data-admin-settings-view]").length, 3);
    const actionsView = admin.window.document.querySelector('[data-view-panel="actions"]') as HTMLElement;
    assert.equal(actionsView.querySelectorAll("#jobList").length, 1);
    assert.equal(actionsView.querySelectorAll("#notificationList, #attributionReceiptList").length, 0);
    assert.equal(admin.window.document.querySelector('[data-view-panel="notifications"] #notificationSearch') !== null, true);
    assert.equal(admin.window.document.querySelector('[data-view-panel="notifications"] #notificationMoreButton') !== null, true);
    assert.equal(admin.window.document.querySelector('[data-view-panel="attribution"] #attributionReceiptSearch') !== null, true);
    assert.equal(admin.window.document.querySelector('[data-view-panel="attribution"] #attributionReceiptMoreButton') !== null, true);
    assert.equal(admin.window.document.querySelector('[data-view-panel="signals"] #sendSignalButton'), null);
    assert.equal(admin.window.document.querySelector('[data-operations-panel="tools"] #sendSignalButton') !== null, true);
    assert.equal((admin.window.document.querySelector('#signalForm input[name="mode"][value="dry_run"]') as HTMLInputElement).checked, true);
    assert.equal((admin.window.document.querySelector('#signalForm input[name="mode"][value="live"]') as HTMLInputElement).checked, false);
  } finally {
    user.window.close();
    admin.window.close();
  }
});

test("the user dashboard fetches only the selected workspace", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const requests: string[] = [];
  const overview = {
    settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 0, purchaseIntents: 0, actions: 0, pendingCatalogProposals: 0 },
    sources: [],
    permissions: [],
    spend: {
      activeReservationCount: 0,
      activeReservedCents: 0,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] }
  };
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (pathValue: string) => {
      const path = String(pathValue);
      requests.push(path);
      const payload = path === "/api/v1/user/overview" ? overview
        : path === "/api/v1/affiliate-routing" ? { affiliateRouting: null }
          : path === "/api/v1/user/purchase-intents/legacy-transition" ? { preview: null }
            : { items: [], total: 0 };
      return { ok: true, status: 200, json: async () => payload };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });

  try {
    browser.eval(`${readFileSync(join(webRoot, "user.js"), "utf8")}\n//# sourceURL=ui-information-architecture-test.js`);
    await eventually(() => assert.equal(browser.document.querySelector("#modePill")?.textContent?.trim(), "On"));
    await eventually(() => assert.equal(
      requests.some((path) => path === "/api/v1/user/action-handoff?wait=5000&version=0"),
      true
    ));
    // Cart loads its own sections only: no store status, privacy or full action list.
    assert.deepEqual([...new Set(requests)].sort(), [
      "/api/v1/affiliate-routing",
      "/api/v1/user/action-handoff?wait=0&version=0",
      "/api/v1/user/action-handoff?wait=5000&version=0",
      "/api/v1/user/calls?limit=24",
      "/api/v1/user/drop-windows",
      "/api/v1/user/jobs?limit=5&offset=0&q=user_reported_",
      "/api/v1/user/overview",
      "/api/v1/user/purchase-intents/legacy-transition",
      "/api/v1/user/purchase-intents?limit=50&offset=0&q="
    ]);
    // Cart shows the call log even before any call arrives.
    assert.match(browser.document.querySelector("#homeCallList")?.textContent ?? "", /No calls yet/);
    assert.match(browser.document.querySelector("#planList")?.textContent ?? "", /Find a product and tap Want it/);

    (browser.document.querySelector('.tabs [data-tab="find"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(requests.some((path) => path.startsWith("/api/v1/user/library/products?limit=48")), true));
    await eventually(() => assert.match(browser.document.querySelector("#productList")?.textContent ?? "", /No approved products match/));
    assert.equal(requests.includes("/api/v1/user/jobs?limit=100&offset=0"), false);
    assert.equal(requests.includes("/api/v1/user/privacy"), false);
    assert.equal(browser.document.querySelector("[data-panel=find]")?.classList.contains("active"), true);

    browser.location.hash = "#cart/history";
    await eventually(() => assert.equal(requests.some((path) => path === "/api/v1/user/jobs?limit=100&offset=0"), true));
    await eventually(() => assert.match(browser.document.querySelector("#actionList")?.textContent ?? "", /No purchase or notification actions/));
    assert.equal(browser.document.querySelector('.tabs [data-tab="cart"]')?.getAttribute("aria-current"), "page");
    assert.equal(requests.includes("/api/v1/user/privacy"), false);

    (browser.document.querySelector('.tabs [data-tab="setup"]') as HTMLButtonElement).click();
    await eventually(() => assert.match(browser.document.querySelector("#storeSwitchList")?.textContent ?? "", /No store status yet/));
    assert.equal(requests.includes("/api/v1/user/privacy"), true);
    assert.equal(requests.includes("/api/v1/user/action-platform"), true);
    assert.equal(requests.includes("/api/v1/user/devices"), true);
  } finally {
    browser.close();
  }
});

test("Find sends filters to the server and renders the authoritative total beyond page one", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const requests: string[] = [];
  const group = (retailerId: string, retailerName: string, suffix: string) => ({
    variantId: `variant_${retailerId}_${suffix}`,
    familyId: `family_${retailerId}_${suffix}`,
    title: `${retailerName} Deep Match ${suffix}`,
    brand: "",
    imageUrl: "",
    variantAttributes: {},
    createdAt: "2026-08-30T08:00:00.000Z",
    storeCount: 1,
    listingCount: 1,
    availableListingCount: 1,
    inStockListingCount: 1,
    preorderListingCount: 0,
    outOfStockListingCount: 0,
    bestPriceCents: 1999,
    currency: "USD",
    lastActivityAt: "2026-08-30T08:00:00.000Z",
    listings: [{
      listingId: `listing_${retailerId}_${suffix}`,
      retailerId,
      retailerName,
      retailerSku: retailerId === "walmart" ? `570000000${suffix}` : `9700000${suffix}`,
      canonicalUrl: retailerId === "walmart"
        ? `https://www.walmart.com/ip/570000000${suffix}`
        : `https://www.target.com/p/-/A-9700000${suffix}`,
      status: "in_stock",
      executionSupported: true,
      currentPriceCents: 1999,
      currency: "USD"
    }]
  });
  const overview = {
    settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 202, purchaseIntents: 0, actions: 0, pendingCatalogProposals: 0 },
    sources: [],
    permissions: [],
    spend: {
      activeReservationCount: 0,
      activeReservedCents: 0,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] }
  };
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (pathValue: string) => {
      const path = String(pathValue);
      requests.push(path);
      let payload: Record<string, unknown> = { items: [], total: 0 };
      if (path === "/api/v1/user/overview") payload = overview;
      else if (path === "/api/v1/affiliate-routing") payload = { affiliateRouting: null };
      else if (path === "/api/v1/user/purchase-intents/legacy-transition") payload = { preview: null };
      else if (path.startsWith("/api/v1/user/library/products?")) {
        const query = new URL(path, "http://127.0.0.1:32991").searchParams;
        const walmart = query.get("store") === "walmart";
        payload = {
          items: walmart
            ? [group("walmart", "Walmart", "1"), group("walmart", "Walmart", "2")]
            : [group("target", "Target", "1")],
          total: walmart ? 2 : 202,
          facets: { stores: [
            { retailerId: "target", retailerName: "Target", productCount: 200 },
            { retailerId: "walmart", retailerName: "Walmart", productCount: 2 }
          ] }
        };
      }
      return { ok: true, status: 200, json: async () => payload };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });

  try {
    browser.eval(`${readFileSync(join(webRoot, "user.js"), "utf8")}\n//# sourceURL=server-product-filter-ui-test.js`);
    await eventually(() => assert.equal(browser.document.querySelector("#modePill")?.textContent?.trim(), "On"));
    (browser.document.querySelector('.tabs [data-tab="find"]') as HTMLButtonElement).click();
    await eventually(() => assert.match(browser.document.querySelector("#browseCount")?.textContent ?? "", /202 products/));
    assert.match(browser.document.querySelector("#browseStore")?.textContent ?? "", /Walmart · 2/);
    assert.match(browser.document.querySelector("#productList")?.textContent ?? "", /Target Deep Match/);

    const store = browser.document.querySelector("#browseStore") as HTMLSelectElement;
    store.value = "walmart";
    store.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await eventually(() => assert.match(browser.document.querySelector("#browseCount")?.textContent ?? "", /^2 products$/));
    assert.match(browser.document.querySelector("#productList")?.textContent ?? "", /Walmart Deep Match 1/);
    assert.doesNotMatch(browser.document.querySelector("#productList")?.textContent ?? "", /Target Deep Match/);
    assert.equal((browser.document.querySelector("#loadMoreProducts") as HTMLButtonElement).hidden, true);
    assert.equal(requests.some((path) => path.includes("store=walmart") && path.includes("sort=newest")), true);
    // The quick-filter chip mirrors the select.
    assert.equal(browser.document.querySelector('#findChips [data-find-chip="store"][data-find-value="walmart"]')?.getAttribute("aria-pressed"), "true");

    const availability = browser.document.querySelector("#browseAvailability") as HTMLSelectElement;
    assert.deepEqual([...availability.options].map((option) => [option.value, option.textContent]), [
      ["", "Any"],
      ["in_stock", "In stock"],
      ["preorder", "Preorder"],
      ["out_of_stock", "Out of stock"]
    ]);
  } finally {
    browser.close();
  }
});

test("Find quick filters narrow to one store and apply popular categories inside it", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const requests: string[] = [];
  const overview = {
    settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 1, purchaseIntents: 0, actions: 0, pendingCatalogProposals: 0 },
    sources: [], permissions: [],
    spend: {
      activeReservationCount: 0, activeReservedCents: 0, spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] }
  };
  const sharedGroup = {
    variantId: "variant_pokemon_shared",
    familyId: "family_pokemon_shared",
    title: "Pokémon Shared Product",
    brand: "Pokémon",
    imageUrl: "",
    variantAttributes: {},
    createdAt: "2026-09-01T08:00:00.000Z",
    storeCount: 2,
    listingCount: 2,
    availableListingCount: 2,
    inStockListingCount: 2,
    preorderListingCount: 0,
    outOfStockListingCount: 0,
    bestPriceCents: 1299,
    currency: "USD",
    lastActivityAt: "2026-09-01T08:00:00.000Z",
    listings: [
      {
        listingId: "listing_target_store_page",
        retailerId: "target",
        retailerName: "Target",
        retailerSku: "95123456",
        canonicalUrl: "https://www.target.com/p/-/A-95123456",
        status: "in_stock",
        executionSupported: true,
        currentPriceCents: 1299,
        currency: "USD"
      },
      {
        listingId: "listing_walmart_store_page",
        retailerId: "walmart",
        retailerName: "Walmart",
        retailerSku: "5700000001",
        canonicalUrl: "https://www.walmart.com/ip/5700000001",
        status: "in_stock",
        executionSupported: true,
        currentPriceCents: 1399,
        currency: "USD"
      }
    ]
  };
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (pathValue: string) => {
      const path = String(pathValue);
      requests.push(path);
      const payload = path === "/api/v1/user/overview" ? overview
        : path === "/api/v1/affiliate-routing" ? { affiliateRouting: null }
          : path.startsWith("/api/v1/user/library/products?") ? {
            items: [sharedGroup],
            total: 1,
            facets: { stores: [
              { retailerId: "target", retailerName: "Target", productCount: 1 },
              { retailerId: "walmart", retailerName: "Walmart", productCount: 1 }
            ] }
          }
            : { items: [], total: 0 };
      return { ok: true, status: 200, json: async () => payload };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); }
  });

  try {
    browser.eval(`${readFileSync(join(webRoot, "user.js"), "utf8")}\n//# sourceURL=store-browse-ui-test.js`);
    await eventually(() => assert.equal(browser.document.querySelector("#modePill")?.textContent?.trim(), "On"));
    (browser.document.querySelector('.tabs [data-tab="find"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(browser.document.querySelectorAll('#findChips [data-find-chip="store"]').length, 2));
    assert.match(browser.document.querySelector("#findChips")?.textContent ?? "", /Wanted.*Target.*Walmart.*NeeDoh.*Pokémon.*Disney Lorcana.*One Piece/s);
    assert.ok(browser.document.querySelector("#inStockOnly"), "In stock only is a switch beside the search");

    (browser.document.querySelector('#findChips [data-find-value="target"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(browser.document.querySelector('#findChips [data-find-value="target"]')?.getAttribute("aria-pressed"), "true"));
    assert.equal(requests.some((path) => path.includes("store=target")), true);
    assert.equal((browser.document.querySelector("#browseStore") as HTMLSelectElement).value, "target");
    // The card leads with the chosen store's offer.
    assert.equal(browser.document.querySelector("#productList .product-card")?.getAttribute("data-store"), "target");

    (browser.document.querySelector('#findChips [data-find-value="pokemon"]') as HTMLButtonElement).click();
    await eventually(() => {
      assert.equal(requests.some((path) => path.includes("store=target") && path.includes("category=pokemon")), true);
      assert.equal(browser.document.querySelector('#findChips [data-find-value="pokemon"]')?.getAttribute("aria-pressed"), "true");
    });
    assert.match(browser.location.hash, /store=target/);
    assert.match(browser.location.hash, /category=pokemon/);

    // A second tap clears that filter.
    (browser.document.querySelector('#findChips [data-find-value="target"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(browser.document.querySelector('#findChips [data-find-value="target"]')?.getAttribute("aria-pressed"), "false"));
    assert.doesNotMatch(browser.location.hash, /store=target/);
  } finally {
    browser.close();
  }
});

test("large collections use bounded initial pages and responsive navigation", () => {
  const root = process.cwd();
  const userScript = readFileSync(join(root, "apps", "web", "user.js"), "utf8");
  const adminScript = readFileSync(join(root, "apps", "web", "app.js"), "utf8");
  const userCss = readFileSync(join(root, "apps", "web", "user.css"), "utf8");
  assert.match(userScript, /productPageSize: 48/);
  assert.match(userScript, /callDisplayLimit: 25/);
  assert.match(userScript, /actionDisplayLimit: 25/);
  assert.match(adminScript, /const COLLECTION_PAGE_SIZE = 50/);
  assert.match(userCss, /#productList, #planList \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(userCss, /@media \(max-width: 1099px\).*repeat\(3/);
  assert.match(userCss, /@media \(max-width: 849px\).*repeat\(2/);
  assert.match(userCss, /@media \(max-width: 559px\).*grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(userScript, /localStorage\.getItem\(PRODUCT_VIEW_KEY\)/);
});
