import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createContext, runInContext } from "node:vm";

// Kevin, 2026-10-12: "If a user is browsing through a product and it becomes
// out of stock. That stock status should reflect, same with in stock." The
// companion reads the product page in front, and each cart add's page, and
// sends the stock it saw. Reading never clicks or changes the page.

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: Record<string, unknown>) => { window: Window & typeof globalThis & { close(): void } } };
const source = readFileSync("apps/extension/background.js", "utf8");

function functionSource(name: string): string {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n}", start);
  assert.ok(end > start, name);
  return source.slice(start, end + 2);
}

const TARGET_PAGE = "https://www.target.com/p/needoh-nice-cube/-/A-95333333";
const observation = (overrides: Record<string, unknown> = {}) => ({
  retailerId: "target", retailerSku: "95333333", availability: "in_stock", unitPriceCents: 749, sellerName: "Target",
  sellerType: "first_party", fulfillment: "shipping", securityChallenge: false, interactiveBlock: "",
  observedAt: "2026-10-12T18:00:00.000Z", ...overrides
});

interface Tab { id: number; active: boolean; status: string; url: string }

function companion(options: {
  tabs?: Tab[];
  reads?: Array<Record<string, unknown> | null>;
  jobTabId?: number;
  permitted?: boolean;
  title?: string;
} = {}) {
  const tabs = new Map((options.tabs ?? [{ id: 7, active: true, status: "complete", url: TARGET_PAGE }]).map((tab) => [tab.id, tab]));
  const reads = [...(options.reads ?? [observation()])];
  const collected: Array<{ tabId: number; retailerId: string; chooseShipping: boolean }> = [];
  const posted: Array<Record<string, any>> = [];
  const context = createContext({
    Date, URL, Map, Promise, JSON, Number, String, Boolean, Object, Array,
    setTimeout: (callback: () => void) => { callback(); return 1; },
    STOCK_CHECK_REREAD_MS: 2 * 60_000, STOCK_CHECK_SETTLE_MS: 1_500, STOCK_CHECK_RETRY_MS: 2_500,
    EVIDENCE_REQUEST_TIMEOUT_MS: 10_000,
    browsingStockReads: new Map(),
    TARGET_ORIGINS: ["https://www.target.com/*"],
    RETAILER_ORIGINS: { walmart: ["https://*.walmart.com/*"], amazon: ["https://*.amazon.com/*"], bestbuy: ["https://*.bestbuy.com/*"] },
    RETAILER_OBSERVER_VERSIONS: { walmart: "walmart-observer", amazon: "amazon-observer", bestbuy: "bestbuy-observer" },
    RETAILER_SKU_PATTERNS: { walmart: /^\d{5,20}$/, amazon: /^[A-Z0-9]{10}$/, bestbuy: /^\d{5,20}$/ },
    storedDevice: async () => ({ token: "fixture-memory-only" }),
    activeJob: async () => options.jobTabId === undefined ? null : { id: "job", tabId: options.jobTabId },
    collectWatchObservation: async (tabId: number, page: { retailerId: string }, chooseShipping: boolean) => {
      collected.push({ tabId, retailerId: page.retailerId, chooseShipping });
      const next = reads.length > 1 ? reads.shift() : reads[0];
      if (!next) throw new Error("observer_collection_failed");
      return next;
    },
    request: async (path: string, init: { body: string }) => { posted.push({ path, ...JSON.parse(init.body) }); return { results: [] }; },
    chrome: {
      tabs: {
        get: async (id: number) => { const tab = tabs.get(id); if (!tab) throw new Error("No tab"); return { ...tab }; },
        query: async () => [...tabs.values()].filter((tab) => tab.active).slice(0, 1)
      },
      permissions: { contains: async () => options.permitted ?? true },
      scripting: { executeScript: async () => [{ frameId: 0, result: options.title ?? "NeeDoh Nice Cube : Target" }] }
    }
  });
  runInContext([
    "canonicalRetailerIdentity", "stockCheckPage", "readPageProductTitle", "readTabProductTitle", "stockCheckItem", "reportStockChecks",
    "observeBrowsingStock", "recheckBrowsingStock", "reportCartAddStock"
  ].map(functionSource).join("\n"), context);
  const call = async (expression: string) => JSON.parse(JSON.stringify(await (runInContext(expression, context) as Promise<unknown>) ?? null));
  return { call, collected, posted, tabs };
}

test("Chrome knows a product page from its link, including Best Buy's links that only name a product code", async () => {
  const { call } = companion();
  assert.deepEqual(await call(`stockCheckPage(${JSON.stringify(TARGET_PAGE)})`), { retailerId: "target", retailerSku: "95333333", key: "target:95333333" });
  assert.deepEqual(await call(`stockCheckPage("https://www.walmart.com/ip/NeeDoh-Gumdrop/5550001234?athbdg=L1600")`),
    { retailerId: "walmart", retailerSku: "5550001234", key: "walmart:5550001234" });
  assert.deepEqual(await call(`stockCheckPage("https://www.amazon.com/Schylling-NeeDoh/dp/b0grsz5tdc/ref=sr_1_1")`),
    { retailerId: "amazon", retailerSku: "B0GRSZ5TDC", key: "amazon:B0GRSZ5TDC" });
  assert.deepEqual(await call(`stockCheckPage("https://www.bestbuy.com/product/pokemon-elite-trainer-box/JJGCQ8L5W2")`),
    { retailerId: "bestbuy", retailerSku: "", key: "bestbuy:/product/pokemon-elite-trainer-box/jjgcq8l5w2" });
  for (const url of ["https://www.target.com/c/toys", "https://www.amazon.com/s?k=needoh", "https://example.com/p/-/A-95333333", "not a link"]) {
    assert.equal(await call(`stockCheckPage(${JSON.stringify(url)})`), null, url);
  }
});

test("a page's product name: Amazon's title block, the page's share title, its heading, then the tab title", () => {
  const title = (html: string) => {
    const dom = new JSDOM(html, { url: "https://www.amazon.com/dp/B0GRSZ5TDC", runScripts: "outside-only" });
    try { return String(dom.window.eval(`${functionSource("readPageProductTitle")}\nreadPageProductTitle()`)); } finally { dom.window.close(); }
  };
  assert.equal(title(`<html><head><title>Amazon.com: Teenie : Toys</title><meta property="og:title" content="Share"></head>
    <body><h1><span id="productTitle">  Schylling NeeDoh
      Teenie  </span></h1></body></html>`), "Schylling NeeDoh Teenie");
  assert.equal(title(`<html><head><meta property="og:title" content="NeeDoh Nice Cube"></head><body><h1>Heading</h1></body></html>`), "NeeDoh Nice Cube");
  assert.equal(title(`<html><body><h1>Pokémon Elite Trainer Box</h1></body></html>`), "Pokémon Elite Trainer Box");
  assert.equal(title(`<html><head><title>Gumdrop - Walmart.com</title></head><body></body></html>`), "Gumdrop - Walmart.com");
});

test("only a plain stock reading is sent: not a bot check, a sign-in wall, store pickup or an unclear page", async () => {
  const { call } = companion();
  const item = (value: Record<string, unknown>) => call(`stockCheckItem(${JSON.stringify(value)}, "browsing", "NeeDoh")`);
  assert.deepEqual(await item(observation()), { retailerId: "target", retailerSku: "95333333", availability: "in_stock",
    unitPriceCents: 749, sellerName: "Target", sellerType: "first_party", observedAt: "2026-10-12T18:00:00.000Z", via: "browsing", title: "NeeDoh" });
  assert.equal((await item(observation({ availability: "out_of_stock", unitPriceCents: null })))?.availability, "out_of_stock");
  for (const unclear of [{ availability: "unknown" }, { securityChallenge: true }, { interactiveBlock: "auth" }, { fulfillment: "pickup" }, { retailerSku: "" }]) {
    assert.equal(await item(observation(unclear)), null, JSON.stringify(unclear));
  }
});

test("the product page in front is read without touching it, once every two minutes, and its stock is sent", async () => {
  const fixture = companion();
  const now = Date.parse("2026-10-12T18:00:00.000Z");
  assert.deepEqual(await fixture.call(`observeBrowsingStock(7, ${JSON.stringify(TARGET_PAGE)}, ${now})`),
    { read: true, reported: true, availability: "in_stock" });
  assert.deepEqual(fixture.collected, [{ tabId: 7, retailerId: "target", chooseShipping: false }], "no fulfillment is chosen on the shopper's page");
  assert.deepEqual(fixture.posted, [{ path: "/devices/self/stock-checks", contractVersion: 1, items: [{
    retailerId: "target", retailerSku: "95333333", availability: "in_stock", unitPriceCents: 749, sellerName: "Target",
    sellerType: "first_party", observedAt: "2026-10-12T18:00:00.000Z", via: "browsing", title: "NeeDoh Nice Cube : Target" }] }]);
  assert.deepEqual(await fixture.call(`observeBrowsingStock(7, ${JSON.stringify(TARGET_PAGE)}, ${now + 60_000})`),
    { read: false, reason: "read_recently" }, "a page's many load events read it once");
  assert.equal(fixture.posted.length, 1);
  // Two minutes on, the minute check reads it again: it sold out while the shopper looked at it.
  const later = companion({ reads: [observation(), observation({ availability: "out_of_stock", unitPriceCents: null })] });
  await later.call(`observeBrowsingStock(7, ${JSON.stringify(TARGET_PAGE)}, ${Date.now() - 3 * 60_000})`);
  await later.call(`recheckBrowsingStock()`);
  assert.deepEqual(later.posted.map((post) => post.items[0].availability), ["in_stock", "out_of_stock"]);
});

test("Yoink's own tabs are never read as browsing: background tabs, a cart add's tab, and stores without access", async () => {
  const now = Date.parse("2026-10-12T18:00:00.000Z");
  const background = companion({ tabs: [{ id: 7, active: false, status: "complete", url: TARGET_PAGE }] });
  assert.deepEqual(await background.call(`observeBrowsingStock(7, ${JSON.stringify(TARGET_PAGE)}, ${now})`), { read: false, reason: "not_in_front" });
  background.tabs.set(7, { id: 7, active: true, status: "complete", url: TARGET_PAGE });
  assert.equal((await background.call(`observeBrowsingStock(7, ${JSON.stringify(TARGET_PAGE)}, ${now + 1_000})`))?.reported, true,
    "once the shopper switches to it, it is read");

  const cartAdd = companion({ jobTabId: 7 });
  assert.deepEqual(await cartAdd.call(`observeBrowsingStock(7, ${JSON.stringify(TARGET_PAGE)}, ${now})`), { read: false, reason: "cart_add_tab" });
  const noAccess = companion({ permitted: false });
  assert.deepEqual(await noAccess.call(`observeBrowsingStock(7, ${JSON.stringify(TARGET_PAGE)}, ${now})`), { read: false, reason: "access_missing" });
  for (const fixture of [background, cartAdd, noAccess]) {
    assert.ok(fixture.collected.length <= 1 && fixture.posted.length <= 1);
  }
  assert.equal(cartAdd.collected.length + noAccess.collected.length, 0, "nothing is read");
});

test("a page still drawing is read again once; a page that never shows its stock or moved to another item sends nothing", async () => {
  const now = Date.parse("2026-10-12T18:00:00.000Z");
  const drawing = companion({ reads: [observation({ availability: "unknown" }), observation()] });
  assert.equal((await drawing.call(`observeBrowsingStock(7, ${JSON.stringify(TARGET_PAGE)}, ${now})`))?.reported, true);
  assert.equal(drawing.collected.length, 2);
  const unclear = companion({ reads: [observation({ availability: "unknown" })] });
  assert.deepEqual(await unclear.call(`observeBrowsingStock(7, ${JSON.stringify(TARGET_PAGE)}, ${now})`),
    { read: true, reported: false, reason: "stock_unclear" });
  const moved = companion({ reads: [observation({ retailerSku: "95444444" })] });
  assert.deepEqual(await moved.call(`observeBrowsingStock(7, ${JSON.stringify(TARGET_PAGE)}, ${now})`), { read: false, reason: "page_changed" });
  assert.equal(unclear.posted.length + moved.posted.length, 0);
});

test("a cart add sends the stock it saw: in stock at the checked price, or what a refused add's page shows", async () => {
  const fixture = companion({ reads: [observation({ availability: "out_of_stock", unitPriceCents: null })] });
  await fixture.call(`reportCartAddStock(9, "target", "95333333", { unitPriceCents: 749, sellerType: "first_party", fulfillment: "shipping" }, "NeeDoh Nice Cube")`);
  await fixture.call(`reportCartAddStock(9, "target", "95333333", null, "NeeDoh Nice Cube", "out_of_stock")`);
  assert.deepEqual(fixture.posted.map((post) => [post.items[0].availability, post.items[0].unitPriceCents, post.items[0].via, post.items[0].title]), [
    ["in_stock", 749, "cart_add", "NeeDoh Nice Cube"],
    ["out_of_stock", null, "cart_add", "NeeDoh Nice Cube"]
  ]);
  assert.deepEqual(fixture.collected, [{ tabId: 9, retailerId: "target", chooseShipping: false }], "only the refused add reads the page");
  // The page couldn't be read, but the store said sold out.
  const unread = companion({ reads: [null] });
  await unread.call(`reportCartAddStock(9, "target", "95333333", null, "", "out_of_stock")`);
  await unread.call(`reportCartAddStock(9, "target", "95333333", null, "", "price_above_max")`);
  assert.deepEqual(unread.posted.map((post) => post.items[0].availability), ["out_of_stock"]);
});

test("the companion reads stock on page loads, tab switches and each minute, and never on the cart add's critical path", () => {
  assert.match(source, /void observeBrowsingStock\(tabId, url\)\.catch\(\(\) => undefined\);\n\}\);/);
  assert.match(source, /chrome\.tabs\.onActivated\?\.addListener\(\(\{ tabId \}\) => \{\n {2}void chrome\.tabs\.get\(tabId\)\.then\(\(tab\) => observeBrowsingStock\(tabId, tab\?\.url\)\)/);
  assert.match(source, /void recheckBrowsingStock\(\)\.catch\(\(\) => undefined\);/);
  assert.match(source, /void pageTitle\.then\(\(title\) => reportCartAddStock\(active\.tabId, retailerId, active\.runnerJob\.retailerSku, prepared\.proof, title\)\)/);
  assert.match(functionSource("collectWatchObservation"), /lease\.retailerId === "bestbuy" && chooseShipping/);
});
