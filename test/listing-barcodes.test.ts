import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createContext, runInContext } from "node:vm";

// Barcodes (Kevin, 2026-10-09: "Can't we associate them based on a attribute?
// like UPC?"): the companion reads each All New item's barcode off its store page.

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

function readBarcode(html: string, url = "https://www.walmart.com/ip/NeeDoh-Gumdrop/5550001234"): Record<string, unknown> {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  try {
    return JSON.parse(String(dom.window.eval(`${functionSource("readPageBarcode")}\nJSON.stringify(readPageBarcode())`)));
  } finally {
    dom.window.close();
  }
}

test("a product page's own barcode: labelled, in its product data, or named once in its scripts", () => {
  assert.deepEqual(readBarcode(`<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "Product", name: "Zed vs Shen", gtin13: "0196214106611"
  })}</script></head><body><main>Zed vs Shen</main></body></html>`), { gtin: "00196214106611" });

  // A labelled UPC in the details wins over other items' barcodes in the page's scripts.
  assert.deepEqual(readBarcode(`<html><body><main><h1>Zed vs Shen</h1><section>Specifications<div>UPC: 196214106611 2 Pack</div></section></main>
    <script>window.recs = {"upc":"820650000010"};</script></body></html>`), { gtin: "00196214106611" });

  // Walmart: the product data names one barcode.
  assert.deepEqual(readBarcode(`<html><body><main>Gumdrop</main><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { initialData: { data: { product: { usItemId: "5550001234", upc: "196214106611" } } } } }
  })}</script></body></html>`), { gtin: "00196214106611" });

  // Target: product data inside an escaped JSON string.
  assert.deepEqual(readBarcode(`<html><body><main>Deck</main><script>window.__TGT_DATA__ = JSON.parse("{\\"item\\":{\\"primary_barcode\\":\\"196214106611\\"}}");</script></body></html>`,
    "https://www.target.com/p/deck/-/A-1011726392"), { gtin: "00196214106611" });
});

test("no barcode is better than a wrong one: two different, a bad check digit, or a bot check", () => {
  assert.deepEqual(readBarcode(`<html><body><main>Bundle</main><script>var a = {"upc":"196214106611"}; var b = {"upc":"820650000010"};</script></body></html>`),
    { gtin: "", ambiguous: true });
  assert.deepEqual(readBarcode(`<html><body><main>UPC: 196214106612</main></body></html>`), { gtin: "", ambiguous: false });
  assert.deepEqual(readBarcode(`<html><head><title>Robot or human?</title></head><body><main>UPC: 196214106611</main></body></html>`),
    { challenge: true, gtin: "" });
  assert.deepEqual(readBarcode(`<html><body><div id="px-captcha"></div></body></html>`), { challenge: true, gtin: "" });
});

function runner(options: {
  items: Array<Record<string, string>>;
  pages?: Record<string, Record<string, unknown>>;
  permissions?: Record<string, boolean>;
  jobAfterVisits?: number;
  state?: Record<string, unknown>;
}) {
  const memory: Record<string, any> = { barcode: options.state ?? {} };
  const opened: Array<{ url: string; active: boolean }> = [];
  const closed: number[] = [];
  const posted: Array<Record<string, unknown>> = [];
  const tabSkus = new Map<number, string>();
  let tabId = 100;
  const context = createContext({
    Date,
    setTimeout: (callback: () => void) => { callback(); return 1; },
    BARCODE_CHECK_STATE_KEY: "barcode", BARCODE_PAGE_SETTLE_MS: 0, BARCODE_PAGE_PAUSE_MS: 0,
    BARCODE_CHALLENGE_BACKOFF_MS: 6 * 60 * 60_000, BARCODE_RUN_STALE_MS: 15 * 60_000,
    REVERIFICATION_TAB_WAIT_MS: 25_000, EVIDENCE_REQUEST_TIMEOUT_MS: 10_000,
    TARGET_ORIGINS: ["https://www.target.com/*"],
    RETAILER_ORIGINS: { walmart: ["https://www.walmart.com/*"], bestbuy: ["https://www.bestbuy.com/*"] },
    readPageBarcode: () => ({}),
    storedDevice: async () => ({ token: "fixture-memory-only" }),
    activeJob: async () => options.jobAfterVisits !== undefined && opened.length >= options.jobAfterVisits ? { id: "job" } : null,
    waitForExactProductTab: async () => ({ status: "complete" }),
    request: async (path: string, init: { body?: string } = {}) => {
      if (path === "/devices/self/catalog/barcode-plan") return { items: options.items };
      posted.push({ path, ...JSON.parse(String(init.body)) });
      return { barcodes: { recorded: 1, merged: 0, split: 0 } };
    },
    chrome: {
      storage: { local: {
        get: async (key: string) => ({ [key]: structuredClone(memory[key]) }),
        set: async (values: Record<string, unknown>) => { Object.assign(memory, structuredClone(values)); }
      } },
      permissions: { contains: async ({ origins }: { origins: string[] }) =>
        options.permissions?.[new URL(origins[0]!.replace("*", "")).hostname] ?? true },
      tabs: {
        create: async ({ url, active }: { url: string; active: boolean }) => {
          opened.push({ url, active });
          tabId += 1;
          tabSkus.set(tabId, url);
          return { id: tabId };
        },
        remove: async (id: number) => { closed.push(id); }
      },
      scripting: { executeScript: async ({ target }: { target: { tabId: number } }) =>
        [{ frameId: 0, result: options.pages?.[tabSkus.get(target.tabId)!] ?? { gtin: "" } }] }
    }
  });
  runInContext([functionSource("captureListingBarcode"), functionSource("runBarcodeChecks")].join("\n"), context);
  // Objects from the sandbox compare by value only once they are plain JSON.
  const run = async (now = Date.now()) => JSON.parse(JSON.stringify(await (runInContext(`runBarcodeChecks(${now})`, context) as Promise<unknown>))) as Record<string, unknown>;
  return { run, opened, closed, posted, memory };
}

const item = (listingId: string, retailerId: string, retailerSku: string, canonicalUrl: string) => ({ listingId, retailerId, retailerSku, canonicalUrl });
const WALMART = item("l1", "walmart", "5550001234", "https://www.walmart.com/ip/5550001234");
const TARGET = item("l2", "target", "1011726392", "https://www.target.com/p/-/A-1011726392");
const WALMART_TWO = item("l3", "walmart", "5550009999", "https://www.walmart.com/ip/5550009999");
const BESTBUY = item("l4", "bestbuy", "6680277", "https://www.bestbuy.com/site/-/6680277.p");

test("each listed page opens in a background tab, its barcode is sent with the listing, and the tab closes", async () => {
  const fixture = runner({ items: [WALMART, TARGET], pages: { [WALMART.canonicalUrl]: { gtin: "00196214106611" } } });
  const result = await fixture.run();
  assert.deepEqual(result, { ran: true, read: 1, visited: 2 });
  assert.deepEqual(fixture.opened, [{ url: WALMART.canonicalUrl, active: false }, { url: TARGET.canonicalUrl, active: false }]);
  assert.deepEqual(fixture.closed, [101, 102], "every tab it opened is closed");
  assert.deepEqual(fixture.posted.map((post) => post.items), [
    [{ listingId: "l1", retailerId: "walmart", retailerSku: "5550001234", gtin: "00196214106611" }],
    [{ listingId: "l2", retailerId: "target", retailerSku: "1011726392", gtin: "" }]
  ], "a page without a barcode is reported as read, so it waits a week");
  assert.equal(fixture.memory.barcode.runningSince, "");
  assert.equal(fixture.memory.barcode.lastRead, 1);
});

test("a store's bot check stops visits there for six hours, a cart add stops the run, and store access is never asked for", async () => {
  const challenged = runner({ items: [WALMART, WALMART_TWO, TARGET], pages: { [WALMART.canonicalUrl]: { challenge: true, gtin: "" } } });
  const now = Date.now();
  await challenged.run(now);
  assert.deepEqual(challenged.opened.map((tab) => tab.url), [WALMART.canonicalUrl, TARGET.canonicalUrl], "Walmart's second page waits");
  assert.ok(Number(challenged.memory.barcode.backoff.walmart) >= now + 6 * 60 * 60_000 - 1_000);
  assert.ok(!challenged.posted.some((post) => JSON.stringify(post).includes("5550001234")), "a bot check is not a page without a barcode");
  // Six hours on, Walmart is visited again.
  const later = runner({ items: [WALMART_TWO], state: { backoff: challenged.memory.barcode.backoff } });
  await later.run(now + 60_000);
  assert.equal(later.opened.length, 0);

  const busy = runner({ items: [WALMART, TARGET, BESTBUY], jobAfterVisits: 1 });
  await busy.run();
  assert.deepEqual(busy.opened.map((tab) => tab.url), [WALMART.canonicalUrl], "a cart add comes first");

  const noAccess = runner({ items: [BESTBUY, TARGET], permissions: { "www.bestbuy.com": false } });
  await noAccess.run();
  assert.deepEqual(noAccess.opened.map((tab) => tab.url), [TARGET.canonicalUrl]);

  const running = runner({ items: [WALMART], state: { runningSince: new Date().toISOString() } });
  assert.deepEqual(await running.run(), { ran: false, reason: "running" });
  assert.equal(running.opened.length, 0);
});

test("a cart add's page and Inspect send the barcode they find, and nothing when there is none", async () => {
  const fixture = runner({ items: [], pages: {} });
  const context = createContext({
    storedDevice: async () => ({ token: "fixture-memory-only" }),
    readPageBarcode: () => ({}), EVIDENCE_REQUEST_TIMEOUT_MS: 10_000,
    request: async (path: string, init: { body: string }) => { fixture.posted.push({ path, ...JSON.parse(init.body) }); },
    chrome: { scripting: { executeScript: async ({ target }: { target: { tabId: number } }) =>
      [{ frameId: 0, result: target.tabId === 1 ? { gtin: "00196214106611" } : { gtin: "" } }] } }
  });
  runInContext(functionSource("captureListingBarcode"), context);
  await runInContext(`captureListingBarcode(1, "target", "1011726392")`, context);
  await runInContext(`captureListingBarcode(2, "target", "1011726399")`, context);
  assert.deepEqual(fixture.posted, [{ path: "/devices/self/catalog/barcodes",
    items: [{ retailerId: "target", retailerSku: "1011726392", gtin: "00196214106611" }] }]);
  // The cart path never waits on it.
  assert.match(source, /void captureListingBarcode\(active\.tabId, retailerId, active\.runnerJob\.retailerSku\)/);
  assert.match(source, /\[BARCODE_CHECK_ALARM, \{ delayInMinutes: 3, periodInMinutes: 20 \}\]/);
});
