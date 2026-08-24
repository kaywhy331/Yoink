import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createContext, runInContext } from "node:vm";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options?: { url?: string }) => {
    window: { document: Document; location: Location; URL: typeof URL };
  };
};
const ROOT = process.cwd();
const FIXTURES = join(ROOT, "test", "fixtures", "retailers");
const BUNDLE = readFileSync(join(ROOT, "apps", "extension", "retailer-shadow.js"), "utf8");

const EXAMPLES = [
  ["disney", "disney-first-party.html", "https://www.disneystore.com/dumbo-jeweled-figurine-by-arribas-brothers-409914998395.html", "409914998395", 12_900, "first_party"],
  ["ravensburger", "ravensburger-first-party.html", "https://www.ravensburger.us/en-US/products/games/family-games/oh-my-pigeons-22893", "22893", 1_999, "first_party"],
  ["riot", "riot-first-party.html", "https://merch.riotgames.com/en-us/product/riftbound-unleashed-vault/", "RIFTBOUND-UNLEASHED-VAULT", 8_999, "first_party"],
  ["booksamillion", "booksamillion-first-party.html", "https://www.booksamillion.com/p/-/F019649505470", "F019649505470", 1_499, "first_party"],
  ["fanatics", "fanatics-first-party.html", "https://www.fanatics.com/marvel/marvel-comics/2026-topps-marvel-comics-chrome-factory-sealed-value-box/o-1256627133+t-1223526399+p-350174258+z-9-955555803", "350174258", 3_499, "first_party"],
  ["kohls", "kohls-first-party.html", "https://www.kohls.com/product/prd-3384298/mojo-purdue-boilermakers-backpack.jsp", "3384298", 2_499, "first_party"],
  ["macys", "macys-marketplace.html", "https://www.macys.com/shop/product/gap-gapbody-womens-breathe-thong-underwear-gpw00183?ID=16569610", "16569610", 1_800, "third_party"],
  ["pbandai", "pbandai-preorder.html", "https://p-bandai.com/us/item/N2884150001", "N2884150001", 8_900, "first_party"],
  ["pokemoncenter", "pokemoncenter-in-stock.html", "https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder", "10-10320-101", 2_999, "first_party"]
] as const;

function bundleContext(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  const context = createContext({
    document: dom.window.document,
    location: dom.window.location,
    URL: dom.window.URL,
    Date,
    Set,
    Map,
    Object,
    String,
    Number,
    RegExp,
    Array,
    Boolean,
    Math,
    JSON
  });
  runInContext(BUNDLE, context);
  return context;
}

test("the production generic observer bundle extracts all nine read-only retailers without mutation", () => {
  assert.doesNotMatch(BUNDLE, /\.click\s*\(|dispatchEvent\s*\(|\bfetch\s*\(/);
  for (const [retailerId, fixtureName, url, sku, price, sellerType] of EXAMPLES) {
    const context = bundleContext(readFileSync(join(FIXTURES, fixtureName), "utf8"), url);
    const result = runInContext(
      `YoinkRetailerShadow.collectRetailerShadowAttempt(document, location.href, ${JSON.stringify(retailerId)}, "shipping")`,
      context
    ) as { observation: Record<string, unknown>; diagnostic: Record<string, unknown> };
    const plain = JSON.parse(JSON.stringify(result)) as typeof result;
    assert.equal(plain.observation.retailerId, retailerId);
    assert.equal(plain.observation.retailerSku, sku);
    assert.equal(plain.observation.unitPriceCents, price);
    assert.equal(plain.observation.sellerType, sellerType);
    assert.equal(plain.observation.fulfillment, "shipping");
    assert.equal(plain.observation.addControlActionable, true);
    assert.equal(plain.observation.purchaseRouteKind, "none");
    assert.equal(plain.observation.purchaseRouteReady, false);
    assert.equal(plain.diagnostic.outcome, "passed");
    assert.equal("pageText" in plain.observation, false);
    assert.equal("html" in plain.observation, false);
  }
});

test("the production observer bundle extracts all four exact Walmart Draw cards read-only", () => {
  const url = "https://www.walmart.com/shop/collectibles/draw";
  const context = bundleContext(readFileSync(join(FIXTURES, "walmart-draw-hub.html"), "utf8"), url);
  const result = runInContext(
    `YoinkRetailerShadow.observeWalmartDrawHub(document, location.href, "2026-08-24T19:10:00.000Z")`,
    context
  ) as Record<string, unknown>;
  const plain = JSON.parse(JSON.stringify(result)) as { outcome: string; observedCardCount: number; items: Array<Record<string, unknown>> };
  assert.equal(plain.outcome, "passed");
  assert.equal(plain.observedCardCount, 4);
  assert.deepEqual(plain.items.map((item) => [item.retailerSku, item.unitPriceCents, item.orderMaxLimit]), [
    ["19624258216", 597, 99],
    ["19536452232", 597, 99],
    ["5631614124", 5997, 5],
    ["18029663536", 4998, 5]
  ]);
  assert.ok(plain.items.every((item) => item.addControlSuppressed === true));
  assert.equal(JSON.stringify(plain).includes("entryToken"), false);
});

test("the production generic observer bundle rejects category and search pages that merely mention product IDs", () => {
  const rejects = [
    ["disney", "https://www.disneystore.com/search?q=409914998395"],
    ["ravensburger", "https://www.ravensburger.us/en-US/products?campaign=22893"],
    ["riot", "https://merch.riotgames.com/en-us/category/riftbound/?product=riftbound-unleashed-vault"],
    ["booksamillion", "https://www.booksamillion.com/search?query=F019649505470"],
    ["fanatics", "https://www.fanatics.com/search?sku=350174258"],
    ["kohls", "https://www.kohls.com/catalog.jsp?CN=3384298"],
    ["macys", "https://www.macys.com/shop/featured/sale?ID=16569610"],
    ["pbandai", "https://p-bandai.com/us/search/N2884150001"],
    ["pokemoncenter", "https://www.pokemoncenter.com/category/trading-card-game?sku=10-10320-101"]
  ] as const;
  for (const [retailerId, url] of rejects) {
    const context = bundleContext("<main>Product reference only</main>", url);
    assert.throws(
      () => runInContext(
        `YoinkRetailerShadow.collectRetailerShadowAttempt(document, location.href, ${JSON.stringify(retailerId)}, "shipping")`,
        context
      ),
      /exact supported retailer product page/,
      retailerId
    );
  }
});

test("the production observer bundle rejects live edge shells without publishing false stock", () => {
  const cases = [
    ["pbandai", "pbandai-page-unavailable.html", "https://p-bandai.com/us/item/N2884150001", "interactive_unknown"],
    ["pokemoncenter", "pokemoncenter-imperva-challenge.html", "https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder", "security_challenge"]
  ] as const;
  for (const [retailerId, fixtureName, url, reasonCode] of cases) {
    const context = bundleContext(readFileSync(join(FIXTURES, fixtureName), "utf8"), url);
    const result = runInContext(
      `YoinkRetailerShadow.collectRetailerShadowAttempt(document, location.href, ${JSON.stringify(retailerId)}, "shipping")`,
      context
    ) as { observation: Record<string, unknown>; diagnostic: Record<string, unknown> };
    const plain = JSON.parse(JSON.stringify(result)) as typeof result;
    assert.equal(plain.observation.availability, "unknown");
    assert.equal(plain.observation.unitPriceCents, null);
    assert.equal(plain.observation.sellerType, "unknown");
    assert.equal(plain.observation.fulfillment, "unknown");
    assert.equal(plain.observation.addControlActionable, false);
    assert.equal(plain.observation.interactiveBlock, "unknown");
    assert.equal(plain.diagnostic.outcome, "rejected");
    assert.equal(plain.diagnostic.failureStage, "interactive_block");
    assert.equal(plain.diagnostic.reasonCode, reasonCode);
  }
});
