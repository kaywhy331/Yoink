import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import { readBestBuyPageSku } from "../apps/extension/src/bestbuy-action.js";

// Kevin's Test call, 2026-10-13: Best Buy's own Lorcana pack (6680138) was sold
// out, so its product page featured another seller's offer of the same pack
// under that seller's item number (12911942), and the add stopped as "Store
// page didn't match". Best Buy names one offer of a product at
// /product/<name>/<code>/sku/<number>; a job page that lands on the bare code
// and names another number is opened again on the call's number, and must then
// name that number itself.

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } } };
const source = readFileSync("apps/extension/background.js", "utf8");

const CODE_URL = "https://www.bestbuy.com/product/disney-lorcana-attack-of-the-vine-sleeved-booster/CJ6QGKYQZV";
const PINNED_URL = `${CODE_URL}/sku/6680138`;
const OWN_SKU = "6680138";
const OTHER_SELLER_SKU = "12911942";

const productData = (url: string, sku: string) => `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "Product", name: "Disney - Lorcana: Attack of the Vine! Sleeved Booster", url, sku
})}</script>`;
const page = (html: string, url: string) => new JSDOM(`<!doctype html><html><head>${html}</head><body></body></html>`, { url }).window.document;

function functionSource(name: string): string {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n}", start);
  assert.ok(end > start, name);
  return source.slice(start, end + 2);
}

test("the Best Buy page reader names the number the page itself shows, not the one in the address bar", async () => {
  assert.deepEqual(await readBestBuyPageSku(page(productData(CODE_URL, OTHER_SELLER_SKU), CODE_URL), CODE_URL),
    { ok: true, reason: "verified", sku: OTHER_SELLER_SKU });
  assert.deepEqual(await readBestBuyPageSku(page(productData(CODE_URL, OWN_SKU), PINNED_URL), PINNED_URL),
    { ok: true, reason: "verified", sku: OWN_SKU });
  // Opened on Best Buy's own number but still showing the other seller's offer.
  assert.deepEqual(await readBestBuyPageSku(page(productData(CODE_URL, OTHER_SELLER_SKU), PINNED_URL), PINNED_URL),
    { ok: true, reason: "verified", sku: OTHER_SELLER_SKU });
  assert.deepEqual(await readBestBuyPageSku(page("<title>Best Buy</title>", PINNED_URL), PINNED_URL, { timeoutMs: 0 }),
    { ok: false, reason: "page_sku_missing", sku: "" });
});

test("the Best Buy page reader waits for a SKU label the store draws after the load", async () => {
  const document = page("<title>Best Buy</title>", PINNED_URL);
  setTimeout(() => {
    document.body.innerHTML = `<main><p class="sku-value">${OWN_SKU}</p></main>`;
  }, 150);
  const started = Date.now();
  assert.deepEqual(await readBestBuyPageSku(document, PINNED_URL, { timeoutMs: 2_000 }), { ok: true, reason: "verified", sku: OWN_SKU });
  assert.ok(Date.now() - started < 1_500);
});

function companion(options: { url: string; reads?: Array<Record<string, unknown> | null>; landOn?: string; stop?: string }) {
  const tab = { id: 41, url: options.url, status: "complete" };
  const reads = [...(options.reads ?? [])];
  const moves: string[] = [];
  const calls: string[] = [];
  const context = createContext({
    URL, String, Promise,
    chrome: { tabs: { get: async (id: number) => { if (id !== tab.id) throw new Error("No tab"); return { ...tab }; } } },
    executeAddAction: async (tabId: number, retailerId: string, operation: string) => {
      calls.push(`${operation}@${tab.url}`);
      assert.equal(tabId, tab.id);
      assert.equal(retailerId, "bestbuy");
      return reads.shift() ?? null;
    },
    injectAddAction: async (tabId: number, retailerId: string) => { calls.push(`inject@${tab.url}`); assert.equal(tabId, tab.id); assert.equal(retailerId, "bestbuy"); },
    moveJobTab: async (active: { tabId: number }, url: string, expected: string) => {
      assert.equal(active.tabId, tab.id);
      assert.equal(expected, OWN_SKU);
      moves.push(url);
      if (options.stop) throw Object.assign(new Error("Best Buy opened a different item than the call named."), { storeStop: options.stop });
      tab.url = options.landOn ?? url;
    }
  });
  runInContext(["bestBuyCodeOnlyProductUrl", "bestBuyPinnedOfferUrl", "pinBestBuyOffer"].map(functionSource).join("\n"), context);
  const active = { tabId: tab.id, runnerJob: { retailerId: "bestbuy", retailerSku: OWN_SKU } };
  const pin = async () => JSON.parse(JSON.stringify(await (runInContext("pinBestBuyOffer", context) as (value: unknown) => Promise<unknown>)(active)));
  const pinnedUrl = (value: string, sku: string) => (runInContext("bestBuyPinnedOfferUrl", context) as (a: string, b: string) => string)(value, sku);
  return { pin, pinnedUrl, moves, calls, tab };
}

test("a Best Buy job page that names the call's own number goes on without opening again", async () => {
  const run = companion({ url: CODE_URL, reads: [{ ok: true, reason: "verified", sku: OWN_SKU }] });
  assert.deepEqual(await run.pin(), { ok: true, reason: "verified" });
  assert.deepEqual(run.moves, []);
  assert.deepEqual(run.calls, [`readBestBuyPageSku@${CODE_URL}`]);
});

test("a Best Buy job page featuring another seller's number opens again on Best Buy's own offer and reads it there", async () => {
  const run = companion({ url: CODE_URL, reads: [
    { ok: true, reason: "verified", sku: OTHER_SELLER_SKU },
    { ok: true, reason: "verified", sku: OWN_SKU }
  ] });
  assert.deepEqual(await run.pin(), { ok: true, reason: "verified" });
  assert.deepEqual(run.moves, [PINNED_URL]);
  assert.deepEqual(run.calls, [`readBestBuyPageSku@${CODE_URL}`, `inject@${PINNED_URL}`, `readBestBuyPageSku@${PINNED_URL}`]);
});

test("a Best Buy page that still shows another seller's number, or none, after opening on Best Buy's own stays a mismatch", async () => {
  for (const second of [{ ok: true, reason: "verified", sku: OTHER_SELLER_SKU }, { ok: false, reason: "page_sku_missing", sku: "" }, null]) {
    const run = companion({ url: CODE_URL, reads: [{ ok: false, reason: "page_sku_missing", sku: "" }, second] });
    assert.deepEqual(await run.pin(), { ok: false, reason: "listing_mismatch" });
    assert.deepEqual(run.moves, [PINNED_URL]);
  }
  // The store sends the opened offer back to the bare product code.
  const bounced = companion({ url: CODE_URL, landOn: CODE_URL, reads: [
    { ok: true, reason: "verified", sku: OTHER_SELLER_SKU }, { ok: true, reason: "verified", sku: OTHER_SELLER_SKU }
  ] });
  assert.deepEqual(await bounced.pin(), { ok: false, reason: "listing_mismatch" });
});

test("a store check or another item on the reopened Best Buy page stops the job the way the first page would", async () => {
  const run = companion({ url: CODE_URL, stop: "security_challenge", reads: [{ ok: true, reason: "verified", sku: OTHER_SELLER_SKU }] });
  await assert.rejects(run.pin(), (error: { storeStop?: string }) => error.storeStop === "security_challenge");
});

test("a Best Buy page whose address already names an item is read by the existing checks, untouched", async () => {
  for (const url of [PINNED_URL, "https://www.bestbuy.com/site/-/6680138.p", `${CODE_URL}?skuId=6680138`]) {
    const run = companion({ url });
    assert.deepEqual(await run.pin(), { ok: true, reason: "verified" }, url);
    assert.deepEqual(run.moves, [], url);
    assert.deepEqual(run.calls, [], url);
  }
  const run = companion({ url: CODE_URL });
  assert.equal(run.pinnedUrl(`${CODE_URL}/`, OWN_SKU), PINNED_URL);
  assert.equal(run.pinnedUrl(CODE_URL, "B0GRSZ5TDC"), "");
  assert.equal(run.pinnedUrl("https://www.example.com/product/disney-lorcana/CJ6QGKYQZV", OWN_SKU), "");
});

test("every Best Buy job opens Best Buy's own offer before choosing Shipping or reading the offer", () => {
  const prepare = source.slice(source.indexOf("await injectAddAction(active.tabId, retailerId);"), source.indexOf("const first = await executePreparedAddAction("));
  assert.ok(prepare.length > 0);
  const pin = prepare.indexOf("await pinBestBuyOffer(active)");
  assert.ok(pin > 0 && pin < prepare.indexOf("\"selectBestBuyShipping\""));
  assert.match(prepare, /if \(retailerId === "bestbuy"\) \{\s*const own = await pinBestBuyOffer\(active\);\s*if \(!own\?\.ok\) return own;\s*\}/);
});
