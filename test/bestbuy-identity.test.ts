import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInContext } from "node:vm";
import test from "node:test";
// @ts-expect-error jsdom has no bundled TypeScript declarations.
import { JSDOM } from "jsdom";
import { bestBuyPageSku, bestBuyProductCode } from "../packages/browser-adapters/src/bestbuy-identity.js";
import { bestBuyBoundProductCode } from "../packages/browser-adapters/src/bestbuy.js";
import { extractRetailerSku } from "../packages/browser-adapters/src/retailers.js";
import { collectRetailerShadowAttempt } from "../apps/extension/src/retailer-shadow.js";

const URLS = [
  "https://www.bestbuy.com/product/disney-lorcana-winterspell-playmat-dragon-fire/CJ6QGKQ8QQ",
  "https://www.bestbuy.com/product/disney-lorcana-winterspell-playmat-ariel-sonic-warrior/CJ6QGKQ8Q5"
];
const documentFor = (html: string, url = URLS[0]!) => new JSDOM(html, { url }).window.document as Document;

test("Best Buy product codes require page evidence before becoming numeric SKU identities", () => {
  for (const url of URLS) {
    assert.match(bestBuyProductCode(url), /^CJ6QGKQ8Q[Q5]$/);
    assert.equal(extractRetailerSku("bestbuy", url), "");
    const document = documentFor(readFileSync("test/fixtures/retailers/bestbuy-first-party.html", "utf8"), url);
    // Existing synthetic commerce fixture; 6588149 is not asserted to be the
    // live SKU of either supplied Lorcana product.
    const result = collectRetailerShadowAttempt(document, url, "bestbuy");
    assert.equal(result.observation.retailerSku, "6588149");
    assert.equal(result.observation.canonicalUrl, "https://www.bestbuy.com/site/-/6588149.p");
    assert.equal(result.diagnostic.outcome, "passed");
  }
});

test("Best Buy resolves same-product canonical links and structured Product data", () => {
  const url = URLS[0]!;
  const canonical = documentFor(`<link rel="canonical" href="${url}/sku/6588149">`);
  assert.equal(bestBuyPageSku(canonical, url), "6588149");
  const structured = documentFor(`<script type="application/ld+json">${JSON.stringify({
    "@graph": [{ "@type": "Product", url, sku: "6588149" },
      { "@type": "Product", url: URLS[1], sku: "9999999" }]
  })}</script>`);
  assert.equal(bestBuyPageSku(structured, url), "6588149");
  assert.equal(bestBuyPageSku(canonical, URLS[1]!), "");
  const mainRegion = documentFor("<div role='main'><span class='sku-value'>6588149</span></div>");
  assert.equal(bestBuyPageSku(mainRegion, url), "6588149");
});

test("Best Buy refuses missing, conflicting, hidden, and recommendation-only SKU evidence", () => {
  for (const html of [
    "<main><h1>A product without SKU evidence</h1></main>",
    "<main><p class='sku-label'>SKU: 6588149</p><p class='sku-label'>SKU: 9999999</p></main>",
    "<main><aside><p class='sku-label'>SKU: 6588149</p></aside></main>",
    "<main><section class='recommendations'><p class='sku-label'>SKU: 6588149</p></section></main>",
    "<main><p class='sku-label' hidden>SKU: 6588149</p></main>",
    `<script type="application/ld+json">{"@type":"Product","url":"${URLS[1]}","sku":"6588149"}</script>`
  ]) assert.equal(bestBuyPageSku(documentFor(html), URLS[0]!), "", html);
  const conflict = documentFor(`<link rel="canonical" href="${URLS[0]}/sku/6588149"><main><p class="sku-label">SKU: 9999999</p></main>`);
  assert.equal(bestBuyPageSku(conflict, URLS[0]!), "");
});

test("Best Buy product-code recognition excludes other routes and untrusted origins", () => {
  for (const url of [
    "https://www.bestbuy.com/cart/CJ6QGKQ8QQ",
    "https://www.bestbuy.com/product/example/CJ6QGKQ8QQ/checkout",
    "https://www.bestbuy.com/site/searchpage.jsp?skuId=6588149",
    "https://bestbuy.com.evil.test/product/example/CJ6QGKQ8QQ",
    "https://user@www.bestbuy.com/product/example/CJ6QGKQ8QQ",
    "http://www.bestbuy.com/product/example/CJ6QGKQ8QQ"
  ]) assert.equal(bestBuyProductCode(url), "", url);
});

test("the packaged observer resolves both product-code pages through the production bundle", () => {
  const html = readFileSync("test/fixtures/retailers/bestbuy-first-party.html", "utf8");
  const bundle = readFileSync("apps/extension/retailer-shadow.js", "utf8");
  for (const url of URLS) {
    const dom = new JSDOM(html, { url, runScripts: "outside-only" });
    try {
      const context = dom.getInternalVMContext();
      runInContext(bundle, context);
      const result = runInContext("YoinkRetailerShadow.collectRetailerShadowAttempt(document, location.href, 'bestbuy')", context);
      assert.equal(result.observation.retailerSku, "6588149");
      assert.equal(result.diagnostic.outcome, "passed");
    } finally { dom.window.close(); }
  }
});

test("a Best Buy product code binds to an add only through the page's own SKU evidence", () => {
  const url = URLS[0]!;
  const canonical = documentFor(`<link rel="canonical" href="${url}/sku/6588149">`);
  assert.equal(bestBuyBoundProductCode(canonical, url, "6588149"), "CJ6QGKQ8QQ");
  assert.equal(bestBuyBoundProductCode(canonical, url, "9999999"), "");
  assert.equal(bestBuyBoundProductCode(documentFor("<main><h1>No SKU evidence</h1></main>"), url, "6588149"), "");
  // A legacy /site/ route borrows the canonical code only when that code's evidence names this SKU.
  const legacyUrl = "https://www.bestbuy.com/site/-/6588149.p";
  const product = (sku: string) => `<link rel="canonical" href="${url}"><script type="application/ld+json">${
    JSON.stringify({ "@type": "Product", url, sku })}</script>`;
  assert.equal(bestBuyBoundProductCode(documentFor(product("6588149"), legacyUrl), legacyUrl, "6588149"), "CJ6QGKQ8QQ");
  assert.equal(bestBuyBoundProductCode(documentFor(product("9999999"), legacyUrl), legacyUrl, "6588149"), "");
  assert.equal(bestBuyBoundProductCode(documentFor("<main></main>", legacyUrl), legacyUrl, "6588149"), "");
  // The owner's captured page: SKU-less canonical URL, SKU from its product schema and label.
  const captureUrl = "https://www.bestbuy.com/product/ultra-pro-3-x-4-clear-regular-toploader-25-count-pack/J79X4PXVR7";
  const captured = documentFor(readFileSync("test/fixtures/retailers/bestbuy-toploader-capture.html", "utf8"), captureUrl);
  assert.equal(bestBuyPageSku(captured, captureUrl), "6528565");
  assert.equal(bestBuyBoundProductCode(captured, captureUrl, "6528565"), "J79X4PXVR7");
});
