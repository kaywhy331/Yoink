import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  amazonOfferRouteBindable,
  canonicalRetailerProductUrl,
  extractAmazonOfferListingId,
  extractRetailerSku,
  observeRetailerOffer,
  parseRetailerPriceElement,
  retailerAdapterLayoutEvidence,
  retailerAddControl,
  retailerInteractiveBlock,
  retailerSecurityChallenge
} from "../packages/browser-adapters/src/retailers.js";
import { selectedOfferScope } from "../packages/browser-adapters/src/selected-offer.js";
import { collectRetailerShadowAttempt, collectRetailerShadowObservation } from "../apps/extension/src/retailer-shadow.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } } };
const FIXTURES = join(process.cwd(), "test", "fixtures", "retailers");
const SOURCE = readFileSync(join(process.cwd(), "packages", "browser-adapters", "src", "retailers.ts"), "utf8");
const NOW = "2026-08-23T09:00:00.000Z";

function fixture(name: string, url: string): Document {
  return new JSDOM(readFileSync(join(FIXTURES, name), "utf8"), { url }).window.document;
}

test("all generic retailer observers are structurally read-only", () => {
  assert.doesNotMatch(SOURCE, /\.click\s*\(/);
  assert.doesNotMatch(SOURCE, /dispatchEvent\s*\(/);
  assert.doesNotMatch(SOURCE, /\bfetch\s*\(/);
  assert.doesNotMatch(SOURCE, /location\s*=/);
});

test("selector misses expose only a locally unique privacy-bounded structural landmark", () => {
  const url = "https://www.walmart.com/ip/example/17354421975";
  const document = new JSDOM(`<main data-us-item-id="17354421975">
    <meta itemprop="price" content="19.99">
    <p data-testid="seller-display-name">Sold and shipped by Walmart</p>
    <p>Shipping available</p>
    <div role="button" data-testid="pdp-add-to-cart-control" aria-label="Add Private Fixture to cart">Add to cart</div>
  </main>`, { url }).window.document;
  const attempt = collectRetailerShadowAttempt(document, url, "walmart", "shipping");
  assert.equal(attempt.diagnostic.reasonCode, "add_control_selector_miss");
  assert.equal(attempt.diagnostic.layout.addControlCount, 0);
  assert.equal(attempt.diagnostic.layout.genericAddIntentCount, 1);
  assert.deepEqual(attempt.diagnostic.layout.repairLandmarks, [{
    field: "seller",
    elementKind: "p",
    attribute: "data-testid",
    value: "seller-display-name"
  }, {
    field: "addControl",
    elementKind: "role_button",
    attribute: "data-testid",
    value: "pdp-add-to-cart-control"
  }]);
  const serialized = JSON.stringify(attempt.diagnostic.layout.repairLandmarks);
  assert.equal(serialized.includes("Private Fixture"), false);
  assert.equal(serialized.includes("17354421975"), false);

  const unsafe = new JSDOM(`<main>
    <div role="button" data-testid="add-to-cart-17354421975">Add item to cart</div>
    <div role="button" name="checkout-add-to-cart">Add item to cart</div>
    <div role="button" data-test-id="add-to-cart-private-fixture">Add item to cart</div>
    <div role="button" data-automation-id="pdp-add-to-cart">Add first item to cart</div>
    <div role="button" data-automation-id="pdp-add-to-cart">Add second item to cart</div>
  </main>`, { url }).window.document;
  const layout = retailerAdapterLayoutEvidence(unsafe, url, "walmart", "17354421975");
  assert.deepEqual(layout.repairLandmarks, undefined);
});

test("one exact selector-class failure can expose all five privacy-bounded read-only field landmarks", () => {
  const url = "https://www.walmart.com/ip/example/17354421975";
  const document = new JSDOM(`<main data-us-item-id="17354421975">
    <div data-testid="product-availability-status">In stock</div>
    <span data-testid="product-current-price">$19.99</span>
    <p data-testid="seller-display-name">Sold and shipped by Walmart</p>
    <div data-testid="shipping-fulfillment-option" aria-selected="true">Shipping</div>
    <button data-automation-id="atc">Add to cart</button>
  </main>`, { url }).window.document;
  const attempt = collectRetailerShadowAttempt(document, url, "walmart", "shipping");
  assert.equal(attempt.diagnostic.failureStage, "price_binding");
  assert.equal(attempt.diagnostic.reasonCode, "price_selector_miss");
  assert.equal(attempt.diagnostic.layout.genericAvailabilityCandidateCount, 1);
  assert.equal(attempt.diagnostic.layout.genericPriceCandidateCount, 1);
  assert.equal(attempt.diagnostic.layout.genericSellerCandidateCount, 1);
  assert.equal(attempt.diagnostic.layout.genericFulfillmentCandidateCount, 1);
  assert.deepEqual(attempt.diagnostic.layout.repairLandmarks, [
    { field: "availability", elementKind: "div", attribute: "data-testid", value: "product-availability-status" },
    { field: "unitPrice", elementKind: "span", attribute: "data-testid", value: "product-current-price" },
    { field: "seller", elementKind: "p", attribute: "data-testid", value: "seller-display-name" },
    { field: "fulfillment", elementKind: "div", attribute: "data-testid", value: "shipping-fulfillment-option" },
    { field: "addControl", elementKind: "button", attribute: "data-automation-id", value: "atc" }
  ]);
  const serialized = JSON.stringify(attempt.diagnostic.layout.repairLandmarks);
  for (const forbidden of ["19.99", "Sold and shipped by Walmart", "In stock", "Shipping", "17354421975"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("all three generic action stores report constrained semantic layout recovery", () => {
  const cases = [
    {
      retailerId: "walmart" as const,
      url: "https://www.walmart.com/ip/fixture/17354421975",
      sku: "17354421975",
      document: fixture("walmart-first-party.html", "https://www.walmart.com/ip/fixture/17354421975"),
      priceSelector: "[data-automation-id='product-price']",
      controlSelector: "button[data-automation-id='atc']"
    },
    {
      retailerId: "amazon" as const,
      url: "https://www.amazon.com/dp/B0GYTRYV7P",
      sku: "B0GYTRYV7P",
      document: fixture("amazon-first-party.html", "https://www.amazon.com/dp/B0GYTRYV7P"),
      priceSelector: "#corePrice_feature_div",
      controlSelector: "#add-to-cart-button"
    },
    {
      retailerId: "bestbuy" as const,
      url: "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149",
      sku: "6588149",
      document: fixture(
        "bestbuy-first-party.html",
        "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149"
      ),
      priceSelector: "[data-testid='customer-price']",
      controlSelector: "[data-testid='buy-box'] button"
    }
  ];

  for (const entry of cases) {
    const price = entry.document.querySelector(entry.priceSelector);
    assert.ok(price, entry.retailerId);
    for (const attribute of ["id", "class", "data-automation-id", "data-testid", "itemprop"]) {
      price.removeAttribute(attribute);
    }
    price.setAttribute("data-testid", "commerce-amount");
    price.querySelector(".a-offscreen")?.removeAttribute("class");

    const control = entry.document.querySelector(entry.controlSelector);
    assert.ok(control, entry.retailerId);
    const semantic = entry.retailerId === "bestbuy" ? entry.document.createElement("div") : control;
    if (entry.retailerId === "bestbuy") {
      semantic.setAttribute("role", "button");
      semantic.textContent = "Add to cart";
      control.replaceWith(semantic);
    } else {
      for (const attribute of ["id", "name", "data-automation-id", "data-testid", "class"]) {
        semantic.removeAttribute(attribute);
      }
    }
    semantic.setAttribute("data-button-state", "primary-cart-action");

    const attempt = collectRetailerShadowAttempt(entry.document, entry.url, entry.retailerId, "shipping");
    assert.equal(attempt.observation.retailerSku, entry.sku, entry.retailerId);
    assert.equal(attempt.observation.addControlActionable, true, entry.retailerId);
    assert.notEqual(attempt.observation.unitPriceCents, null, entry.retailerId);
    assert.equal(attempt.diagnostic.outcome, "passed", entry.retailerId);
    assert.equal(attempt.diagnostic.failureStage, "complete", entry.retailerId);
    assert.equal(attempt.diagnostic.reasonCode, "semantic_layout_recovered", entry.retailerId);
    assert.equal(attempt.diagnostic.layout.addControlCount, 0, entry.retailerId);
    assert.equal(attempt.diagnostic.layout.priceCandidateCount, 0, entry.retailerId);
    assert.equal(attempt.diagnostic.layout.genericAddIntentCount, 1, entry.retailerId);
    assert.equal(attempt.diagnostic.layout.scopedControlCount, 1, entry.retailerId);
    assert.equal(attempt.diagnostic.layout.genericPriceCandidateCount, 1, entry.retailerId);
    assert.ok(attempt.diagnostic.layout.repairLandmarks?.some((landmark) => landmark.field === "addControl"), entry.retailerId);
    assert.ok(attempt.diagnostic.layout.repairLandmarks?.some((landmark) => landmark.field === "unitPrice"), entry.retailerId);
  }
});

test("retailer URL identity extraction is exact and rejects foreign origins", () => {
  assert.equal(extractRetailerSku("walmart", "https://www.walmart.com/ip/example/17354421975"), "17354421975");
  assert.equal(extractRetailerSku("amazon", "https://www.amazon.com/dp/B0GYTRYV7P"), "B0GYTRYV7P");
  assert.equal(extractRetailerSku("bestbuy", "https://www.bestbuy.com/site/example/6612345.p"), "6612345");
  assert.equal(extractRetailerSku("bestbuy", "https://www.bestbuy.com/product/example/J2FPJKS4SK/sku/6588149"), "6588149");
  assert.equal(extractRetailerSku("bestbuy", "https://www.bestbuy.com/product/example/6588149?skuId=6588149"), "6588149");
  assert.equal(extractRetailerSku("bestbuy", "https://www.bestbuy.com/product/example/J2FPJKS4SK"), "");
  assert.equal(extractRetailerSku("disney", "https://www.disneystore.com/dumbo-jeweled-figurine-by-arribas-brothers-409914998395.html"), "409914998395");
  assert.equal(extractRetailerSku("ravensburger", "https://www.ravensburger.us/en-US/products/games/family-games/oh-my-pigeons-22893"), "22893");
  assert.equal(extractRetailerSku("riot", "https://merch.riotgames.com/en-us/product/riftbound-unleashed-vault/"), "RIFTBOUND-UNLEASHED-VAULT");
  assert.equal(extractRetailerSku("booksamillion", "https://www.booksamillion.com/p/-/F019649505470"), "F019649505470");
  assert.equal(extractRetailerSku("fanatics", "https://www.fanatics.com/marvel/marvel-comics/2026-topps-marvel-comics-chrome-factory-sealed-value-box/o-1256627133+t-1223526399+p-350174258+z-9-955555803"), "350174258");
  assert.equal(extractRetailerSku("kohls", "https://www.kohls.com/product/prd-3384298/mojo-purdue-boilermakers-backpack.jsp"), "3384298");
  assert.equal(extractRetailerSku("macys", "https://www.macys.com/shop/product/gap-gapbody-womens-breathe-thong-underwear-gpw00183?ID=16569610"), "16569610");
  assert.equal(extractRetailerSku("pbandai", "https://p-bandai.com/us/item/N2884150001"), "N2884150001");
  assert.equal(extractRetailerSku("pokemoncenter", "https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder"), "10-10320-101");
  assert.equal(extractRetailerSku("ravensburger", "https://www.ravensburger.us/en-US/products?campaign=22893"), "");
  assert.equal(extractRetailerSku("riot", "https://merch.riotgames.com/en-us/category/riftbound/?page=1"), "");
  assert.equal(extractRetailerSku("booksamillion", "https://www.booksamillion.com/search?query=F019649505470"), "");
  assert.equal(extractRetailerSku("fanatics", "https://www.fanatics.com/"), "");
  assert.equal(extractRetailerSku("kohls", "https://www.kohls.com/catalog.jsp?CN=4294719777"), "");
  assert.equal(extractRetailerSku("macys", "https://www.macys.com/shop/featured/sale?ID=16569610"), "");
  assert.equal(extractRetailerSku("pbandai", "https://p-bandai.com/us/search/N2884150001"), "");
  assert.equal(extractRetailerSku("pokemoncenter", "https://www.pokemoncenter.com/category/trading-card-game?sku=10-10320-101"), "");
  assert.equal(extractRetailerSku("amazon", "https://attacker.example/dp/B0GYTRYV7P"), "");
  assert.equal(extractRetailerSku("walmart", "https://user:password@www.walmart.com/ip/17354421975"), "");
});

test("new read-only retailers preserve exact canonical product identities and discard tracking", () => {
  assert.equal(
    canonicalRetailerProductUrl("disney", "https://www.disneystore.com/dumbo-jeweled-figurine-by-arribas-brothers-409914998395.html?CMP=tracking#details"),
    "https://www.disneystore.com/dumbo-jeweled-figurine-by-arribas-brothers-409914998395.html"
  );
  assert.equal(
    canonicalRetailerProductUrl("ravensburger", "https://www.ravensburger.us/en-US/products/games/family-games/oh-my-pigeons-22893?utm_source=test"),
    "https://www.ravensburger.us/en-US/products/games/family-games/oh-my-pigeons-22893"
  );
  assert.equal(
    canonicalRetailerProductUrl("riot", "https://merch.riotgames.com/en-us/product/riftbound-unleashed-vault/?utm_source=test"),
    "https://merch.riotgames.com/en-us/product/riftbound-unleashed-vault/"
  );
  assert.equal(
    canonicalRetailerProductUrl("booksamillion", "https://www.booksamillion.com/p/-/F019649505470?utm_source=test"),
    "https://www.booksamillion.com/p/-/F019649505470"
  );
  assert.equal(
    canonicalRetailerProductUrl("fanatics", "https://www.fanatics.com/marvel/marvel-comics/2026-topps-marvel-comics-chrome-factory-sealed-value-box/o-1256627133+t-1223526399+p-350174258+z-9-955555803?utm_source=test"),
    "https://www.fanatics.com/marvel/marvel-comics/2026-topps-marvel-comics-chrome-factory-sealed-value-box/o-1256627133+t-1223526399+p-350174258+z-9-955555803"
  );
  assert.equal(
    canonicalRetailerProductUrl("kohls", "https://www.kohls.com/product/prd-3384298/mojo-purdue-boilermakers-backpack.jsp?utm_source=test"),
    "https://www.kohls.com/product/prd-3384298/mojo-purdue-boilermakers-backpack.jsp"
  );
  assert.equal(
    canonicalRetailerProductUrl("macys", "https://www.macys.com/shop/product/gap-gapbody-womens-breathe-thong-underwear-gpw00183?ID=16569610&utm_source=test"),
    "https://www.macys.com/shop/product/gap-gapbody-womens-breathe-thong-underwear-gpw00183?ID=16569610"
  );
  assert.equal(
    canonicalRetailerProductUrl("pbandai", "https://p-bandai.com/us/item/N2884150001?utm_source=test"),
    "https://p-bandai.com/us/item/N2884150001"
  );
  assert.equal(
    canonicalRetailerProductUrl("pokemoncenter", "https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder?utm_source=test"),
    "https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder"
  );
});

test("new read-only observers capture bounded offer evidence without enabling mutation", () => {
  const examples = [
    {
      retailerId: "disney" as const,
      sku: "409914998395",
      url: "https://www.disneystore.com/dumbo-jeweled-figurine-by-arribas-brothers-409914998395.html",
      fixtureName: "disney-first-party.html",
      price: 12900,
      seller: "Disney Store",
      sellerType: "first_party"
    },
    {
      retailerId: "ravensburger" as const,
      sku: "22893",
      url: "https://www.ravensburger.us/en-US/products/games/family-games/oh-my-pigeons-22893",
      fixtureName: "ravensburger-first-party.html",
      price: 1999,
      seller: "Ravensburger",
      sellerType: "first_party"
    },
    {
      retailerId: "riot" as const,
      sku: "RIFTBOUND-UNLEASHED-VAULT",
      url: "https://merch.riotgames.com/en-us/product/riftbound-unleashed-vault/",
      fixtureName: "riot-first-party.html",
      price: 8999,
      seller: "Riot Games Merch",
      sellerType: "first_party"
    },
    {
      retailerId: "booksamillion" as const,
      sku: "F019649505470",
      url: "https://www.booksamillion.com/p/-/F019649505470",
      fixtureName: "booksamillion-first-party.html",
      price: 1499,
      seller: "Books-A-Million",
      sellerType: "first_party"
    },
    {
      retailerId: "fanatics" as const,
      sku: "350174258",
      url: "https://www.fanatics.com/marvel/marvel-comics/2026-topps-marvel-comics-chrome-factory-sealed-value-box/o-1256627133+t-1223526399+p-350174258+z-9-955555803",
      fixtureName: "fanatics-first-party.html",
      price: 3499,
      seller: "Fanatics",
      sellerType: "first_party"
    },
    {
      retailerId: "kohls" as const,
      sku: "3384298",
      url: "https://www.kohls.com/product/prd-3384298/mojo-purdue-boilermakers-backpack.jsp",
      fixtureName: "kohls-first-party.html",
      price: 2499,
      seller: "Kohl's",
      sellerType: "first_party"
    },
    {
      retailerId: "macys" as const,
      sku: "16569610",
      url: "https://www.macys.com/shop/product/gap-gapbody-womens-breathe-thong-underwear-gpw00183?ID=16569610",
      fixtureName: "macys-marketplace.html",
      price: 1800,
      seller: "GAP",
      sellerType: "third_party"
    }
  ];
  for (const example of examples) {
    const document = fixture(example.fixtureName, example.url);
    const observation = observeRetailerOffer(document, example.url, example.retailerId, example.sku, "shipping", NOW);
    assert.deepEqual({
      sku: observation.retailerSku,
      price: observation.unitPriceCents,
      seller: observation.sellerName,
      sellerType: observation.sellerType,
      fulfillment: observation.fulfillment,
      actionable: observation.addControlActionable
    }, {
      sku: example.sku,
      price: example.price,
      seller: example.seller,
      sellerType: example.sellerType,
      fulfillment: "shipping",
      actionable: true
    }, example.retailerId);
    const attempt = collectRetailerShadowAttempt(document, example.url, example.retailerId, "shipping");
    assert.equal(attempt.diagnostic.outcome, "passed", example.retailerId);
    assert.equal(attempt.observation.purchaseRouteKind, "none", example.retailerId);
    assert.equal(attempt.observation.purchaseRouteReady, false, example.retailerId);
  }
});

test("selected-offer scope captures allowlisted variants and fails closed on ambiguous selection", () => {
  const url = "https://www.macys.com/shop/product/example?ID=16569610";
  const selected = new JSDOM(`<!doctype html><body>
    <fieldset><legend>Size</legend>
      <label><input type="radio" name="size" value="Medium" checked> Medium</label>
      <label><input type="radio" name="size" value="Large"> Large</label>
    </fieldset>
  </body>`, { url }).window.document;
  assert.deepEqual(selectedOfferScope(selected, "macys", "16569610"), {
    schemaVersion: 1,
    selectionState: "exact",
    childOfferKey: "16569610",
    attributes: { size: "Medium" }
  });

  const ambiguous = new JSDOM(`<!doctype html><body>
    <fieldset><legend>Color</legend>
      <label><input type="radio" name="color" value="Red"> Red</label>
      <label><input type="radio" name="color" value="Blue"> Blue</label>
    </fieldset>
  </body>`, { url }).window.document;
  assert.deepEqual(selectedOfferScope(ambiguous, "macys", "16569610"), {
    schemaVersion: 1,
    selectionState: "unresolved",
    childOfferKey: "16569610",
    attributes: {}
  });

  assert.equal(selectedOfferScope(fixture("macys-marketplace.html", url), "macys", "16569610").selectionState, "listing_only");
  const liveAmbiguous = fixture("macys-marketplace.html", url);
  liveAmbiguous.querySelector("form")?.insertAdjacentHTML("afterbegin", `
    <fieldset><legend>Size</legend>
      <label><input type="radio" name="size" value="Medium"> Medium</label>
      <label><input type="radio" name="size" value="Large"> Large</label>
    </fieldset>
  `);
  const attempt = collectRetailerShadowAttempt(liveAmbiguous, url, "macys", "shipping");
  assert.equal(attempt.observation.selectedOffer?.selectionState, "unresolved");
  assert.equal(attempt.diagnostic.outcome, "rejected");
  assert.equal(attempt.diagnostic.failureStage, "offer_binding");
  assert.equal(attempt.diagnostic.reasonCode, "listing_variant_unselected");
});

test("new read-only observers fail closed on ambiguous controls and unnamed marketplace fulfillment", () => {
  const disneyUrl = "https://www.disneystore.com/dumbo-jeweled-figurine-by-arribas-brothers-409914998395.html";
  const ambiguous = new JSDOM(`
    <main><meta itemprop="price" content="129.00"><p>Shipping available</p>
      <button>Add to bag</button><button>Add to bag</button></main>
  `, { url: disneyUrl }).window.document;
  const attempt = collectRetailerShadowAttempt(ambiguous, disneyUrl, "disney", "shipping");
  assert.equal(attempt.observation.addControlActionable, false);
  assert.equal(attempt.diagnostic.outcome, "failed");
  assert.equal(attempt.diagnostic.reasonCode, "add_control_ambiguous");

  const fanaticsUrl = "https://www.fanatics.com/marvel/marvel-comics/2026-topps-marvel-comics-chrome-factory-sealed-value-box/o-1256627133+t-1223526399+p-350174258+z-9-955555803";
  const partner = new JSDOM(`
    <main><meta itemprop="price" content="34.99"><p class="shipping">Ships directly from a trusted partner</p>
      <button>Add to cart</button></main>
  `, { url: fanaticsUrl }).window.document;
  const partnerAttempt = collectRetailerShadowAttempt(partner, fanaticsUrl, "fanatics", "shipping");
  assert.equal(partnerAttempt.observation.sellerName, "");
  assert.equal(partnerAttempt.observation.sellerType, "unknown");
  assert.equal(partnerAttempt.diagnostic.reasonCode, "seller_binding_missing");

  const unavailable = new JSDOM(`
    <main><div data-talos="pdpProductPrice"><span class="money-value">$39.99</span></div>
      <p>Ships directly from a trusted partner</p><button disabled>Add to Cart</button></main>
  `, { url: fanaticsUrl }).window.document;
  const unavailableAttempt = collectRetailerShadowAttempt(unavailable, fanaticsUrl, "fanatics", "shipping");
  assert.equal(unavailableAttempt.observation.availability, "out_of_stock");
  assert.equal(unavailableAttempt.diagnostic.outcome, "rejected");
  assert.equal(unavailableAttempt.diagnostic.reasonCode, "listing_unavailable_layout");
});

test("Premium Bandai preserves exact item identity and distinguishes preorder, stock, and closed preorder", () => {
  const examples = [
    ["N2884150001", "pbandai-preorder.html", "preorder", 8900, true],
    ["F2848876001", "pbandai-preorder.html", "preorder", 8900, true],
    ["F2642696004", "pbandai-in-stock.html", "in_stock", 3500, true],
    ["F2754729002", "pbandai-in-stock.html", "in_stock", 3500, true],
    ["N9062600002", "pbandai-out-of-stock.html", "out_of_stock", 7400, false],
    ["F2785243002", "pbandai-out-of-stock.html", "out_of_stock", 7400, false]
  ] as const;
  for (const [sku, fixtureName, availability, price, actionable] of examples) {
    const url = `https://p-bandai.com/us/item/${sku}`;
    const observation = observeRetailerOffer(fixture(fixtureName, url), url, "pbandai", sku, "shipping", NOW);
    assert.equal(observation.availability, availability, sku);
    assert.equal(observation.unitPriceCents, price, sku);
    assert.equal(observation.sellerName, "Premium Bandai", sku);
    assert.equal(observation.sellerType, "first_party", sku);
    assert.equal(observation.fulfillment, "shipping", sku);
    assert.equal(observation.addControlActionable, actionable, sku);
  }
});

test("Pokémon Center keeps full hyphenated SKUs distinct and classifies supplied stock cases", () => {
  const examples = [
    ["100-10326", "p-violet", "pokemoncenter-out-of-stock.html", "out_of_stock", false],
    ["699-17244", "fire-tin", "pokemoncenter-out-of-stock.html", "out_of_stock", false],
    ["290-85866", "terapagos", "pokemoncenter-out-of-stock.html", "out_of_stock", false],
    ["10-10320-101", "mewtwo-mew", "pokemoncenter-in-stock.html", "in_stock", true],
    ["71-10304-101", "espeon", "pokemoncenter-in-stock.html", "in_stock", true],
    ["72-11123-101", "flygon", "pokemoncenter-in-stock.html", "in_stock", true]
  ] as const;
  for (const [sku, slug, fixtureName, availability, actionable] of examples) {
    const url = `https://www.pokemoncenter.com/product/${sku}/${slug}`;
    const observation = observeRetailerOffer(fixture(fixtureName, url), url, "pokemoncenter", sku, "shipping", NOW);
    assert.equal(observation.retailerSku, sku);
    assert.equal(observation.availability, availability, sku);
    assert.equal(observation.sellerName, "Pokémon Center", sku);
    assert.equal(observation.sellerType, "first_party", sku);
    assert.equal(observation.fulfillment, "shipping", sku);
    assert.equal(observation.addControlActionable, actionable, sku);
  }
  assert.notEqual(extractRetailerSku("pokemoncenter", "https://www.pokemoncenter.com/product/10-10320-101/a"), extractRetailerSku("pokemoncenter", "https://www.pokemoncenter.com/product/100-10326/b"));
});

test("Pokémon Center qualification ignores recommendation Adds and cannot substitute one for the product", () => {
  const url = "https://www.pokemoncenter.com/product/10-10320-101/binder";
  const document = fixture("pokemoncenter-add-product.html", url);
  assert.equal(collectRetailerShadowAttempt(document, url, "pokemoncenter", "shipping").diagnostic.outcome, "passed");
  document.querySelector("article button")!.remove();
  const attempt = collectRetailerShadowAttempt(document, url, "pokemoncenter", "shipping");
  assert.equal(attempt.observation.addControlActionable, false);
  assert.notEqual(attempt.diagnostic.outcome, "passed");
});

test("live Premium Bandai and Pokémon Center edge shells cannot become stock evidence", () => {
  const cases = [
    {
      retailerId: "pbandai" as const,
      sku: "N2884150001",
      url: "https://p-bandai.com/us/item/N2884150001",
      fixtureName: "pbandai-page-unavailable.html",
      securityChallenge: false,
      reasonCode: "interactive_unknown"
    },
    {
      retailerId: "pokemoncenter" as const,
      sku: "10-10320-101",
      url: "https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder",
      fixtureName: "pokemoncenter-imperva-challenge.html",
      securityChallenge: true,
      reasonCode: "security_challenge"
    }
  ];
  for (const example of cases) {
    const attempt = collectRetailerShadowAttempt(
      fixture(example.fixtureName, example.url),
      example.url,
      example.retailerId,
      "shipping"
    );
    assert.equal(attempt.observation.retailerSku, example.sku);
    assert.equal(attempt.observation.availability, "unknown");
    assert.equal(attempt.observation.unitPriceCents, null);
    assert.equal(attempt.observation.sellerName, "");
    assert.equal(attempt.observation.sellerType, "unknown");
    assert.equal(attempt.observation.fulfillment, "unknown");
    assert.equal(attempt.observation.addControlActionable, false);
    assert.equal(attempt.observation.securityChallenge, example.securityChallenge);
    assert.equal(attempt.observation.interactiveBlock, "unknown");
    assert.equal(attempt.diagnostic.outcome, "rejected");
    assert.equal(attempt.diagnostic.failureStage, "interactive_block");
    assert.equal(attempt.diagnostic.reasonCode, example.reasonCode);
  }
});

test("Walmart observer binds first-party and named marketplace buy boxes", () => {
  const url = "https://www.walmart.com/ip/example/17354421975";
  const firstParty = observeRetailerOffer(fixture("walmart-first-party.html", url), url, "walmart", "17354421975", "shipping", NOW);
  assert.deepEqual({
    sku: firstParty.retailerSku,
    price: firstParty.unitPriceCents,
    seller: firstParty.sellerName,
    sellerType: firstParty.sellerType,
    fulfillment: firstParty.fulfillment,
    actionable: firstParty.addControlActionable
  }, {
    sku: "17354421975",
    price: 4499,
    seller: "Walmart",
    sellerType: "first_party",
    fulfillment: "shipping",
    actionable: true
  });
  const marketplace = observeRetailerOffer(fixture("walmart-marketplace.html", url), url, "walmart", "17354421975", "shipping", NOW);
  assert.equal(marketplace.sellerType, "third_party");
  assert.equal(marketplace.sellerName, "FIXTURE_WALMART_SELLER");
  assert.equal(marketplace.unitPriceCents, 8999);
  assert.ok(retailerAddControl(fixture("walmart-first-party.html", url), url, "walmart", "17354421975", "shipping"));
  assert.equal(retailerAddControl(fixture("walmart-first-party.html", url), url, "walmart", "999999999", "shipping"), null);
});

test("Walmart recovers the exact selected first-party shipping offer from current page state", () => {
  const url = "https://www.walmart.com/ip/pokemon-deluxe-battle-deck/20895014480";
  const offerId = "E3FEC929BA58303AA09F92D2712898BD";
  const product = {
    usItemId: "20895014480",
    availabilityStatus: "IN_STOCK",
    itemPageAvailabilityStatus: "IN_STOCK",
    showAtc: true,
    isConditionNew: true,
    selectedOfferId: offerId,
    offerId,
    sellerName: "Walmart.com",
    sellerType: "INTERNAL",
    orderLimit: 99,
    priceInfo: { currentPrice: { price: 39.97, currencyUnit: "USD" } },
    conditionOffers: [{
      offerId,
      availabilityStatus: { value: "IN_STOCK" },
      condition: { groupCode: 1 },
      price: { price: 39.97 }
    }],
    fulfillmentOptions: [{
      type: "SHIPPING",
      selected: true,
      intent: true,
      viewOnly: false,
      restricted: false,
      availabilityStatus: "IN_STOCK",
      maxOrderQuantity: 99,
      orderLimit: 99
    }, {
      type: "PICKUP",
      selected: false,
      intent: false,
      viewOnly: false,
      availabilityStatus: "NOT_AVAILABLE"
    }]
  };
  const page = (overrides: Record<string, unknown> = {}) => new JSDOM(`<body><main>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { initialData: { data: { product: { ...product, ...overrides } } } } }
    })}</script>
    <section data-testid="add-to-cart-section"><button data-automation-id="atc">Add to cart</button></section>
  </main></body>`, { url }).window.document;

  const document = page();
  const observation = observeRetailerOffer(document, url, "walmart", "20895014480", "shipping", NOW);
  assert.deepEqual({
    availability: observation.availability,
    price: observation.unitPriceCents,
    seller: observation.sellerName,
    sellerType: observation.sellerType,
    fulfillment: observation.fulfillment,
    actionable: observation.addControlActionable
  }, {
    availability: "in_stock",
    price: 3997,
    seller: "Walmart",
    sellerType: "first_party",
    fulfillment: "shipping",
    actionable: true
  });
  assert.ok(retailerAddControl(document, url, "walmart", "20895014480", "shipping"));
  const attempt = collectRetailerShadowAttempt(document, url, "walmart", "shipping");
  assert.equal(attempt.diagnostic.outcome, "passed");
  assert.equal(attempt.diagnostic.failureStage, "complete");
  assert.equal(attempt.diagnostic.layout.scopedControlCount, 1);

  const duplicateShell = page();
  duplicateShell.querySelector("main")?.insertAdjacentHTML("beforeend", `
    <aside data-testid="sticky-product-action">
      <button data-automation-id="atc">Add to cart</button>
    </aside>
  `);
  const primaryControl = duplicateShell.querySelector("[data-testid='add-to-cart-section'] button");
  const stickyControl = duplicateShell.querySelector("[data-testid='sticky-product-action'] button");
  assert.equal(retailerAddControl(duplicateShell, url, "walmart", "20895014480", "shipping"), primaryControl);
  assert.notEqual(primaryControl, stickyControl);
  const duplicateAttempt = collectRetailerShadowAttempt(duplicateShell, url, "walmart", "shipping");
  assert.equal(duplicateAttempt.diagnostic.outcome, "passed");
  assert.equal(duplicateAttempt.diagnostic.layout.addControlCount, 2);
  assert.equal(duplicateAttempt.diagnostic.layout.scopedControlCount, 1);
  assert.equal(duplicateAttempt.observation.selectedOffer?.selectionState, "exact");

  const ambiguousPrimary = page();
  const duplicatePrimary = ambiguousPrimary.querySelector("[data-testid='add-to-cart-section'] button")?.cloneNode(true);
  if (duplicatePrimary) ambiguousPrimary.querySelector("[data-testid='add-to-cart-section']")?.append(duplicatePrimary);
  assert.equal(retailerAddControl(ambiguousPrimary, url, "walmart", "20895014480", "shipping"), null);

  const thirdParty = observeRetailerOffer(
    page({ sellerName: "Fixture Marketplace", sellerType: "EXTERNAL" }),
    url,
    "walmart",
    "20895014480",
    "shipping",
    NOW
  );
  assert.equal(thirdParty.addControlActionable, false);
  assert.equal(thirdParty.availability, "unknown");

  const pickup = observeRetailerOffer(page(), url, "walmart", "20895014480", "pickup", NOW);
  assert.equal(pickup.addControlActionable, false);
  assert.equal(pickup.fulfillment, "unknown");
});

test("Walmart records explicit product-level out-of-stock fulfillment as an expected stop", () => {
  const url = "https://www.walmart.com/ip/example/20895014480";
  const document = new JSDOM(`
    <main>
      <h1>Exact unavailable product</h1>
      <section data-testid="fulfillment-shipping" aria-label="Shipping out of stock">
        <span>Out of stock</span>
      </section>
    </main>
    <aside data-testid="recommended-products">
      <span itemprop="price">$39.97</span>
      <button data-automation-id="atc">Add to cart</button>
    </aside>
  `, { url }).window.document;

  const attempt = collectRetailerShadowAttempt(document, url, "walmart", "shipping");
  assert.equal(attempt.observation.availability, "out_of_stock");
  assert.equal(attempt.observation.unitPriceCents, null);
  assert.equal(attempt.observation.addControlActionable, false);
  assert.equal(attempt.diagnostic.outcome, "rejected");
  assert.equal(attempt.diagnostic.failureStage, "availability_binding");
  assert.equal(attempt.diagnostic.reasonCode, "listing_unavailable_layout");
  assert.equal(attempt.diagnostic.layout.addControlCount, 0);
  assert.equal(attempt.diagnostic.layout.scopedControlCount, 0);
});

test("Walmart split dollar and cent markup cannot inflate the bound price", () => {
  const document = new JSDOM(`<div data-automation-id="product-price"><span>$119</span><sup>95</sup></div>`).window.document;
  const price = document.querySelector("[data-automation-id='product-price']");
  assert.ok(price);
  assert.equal(parseRetailerPriceElement(price), 11995);

  const semantic = new JSDOM(`<div data-automation-id="product-price"><span>$119</span><sup>95</sup><span>current price $119.95</span></div>`).window.document;
  const semanticPrice = semantic.querySelector("[data-automation-id='product-price']");
  assert.ok(semanticPrice);
  assert.equal(parseRetailerPriceElement(semanticPrice), 11995);

  const expensive = new JSDOM(`<div data-automation-id="product-price">$11,995.00</div>`).window.document;
  const expensivePrice = expensive.querySelector("[data-automation-id='product-price']");
  assert.ok(expensivePrice);
  assert.equal(parseRetailerPriceElement(expensivePrice), 1_199_500);
});

test("Walmart binds price, seller, fulfillment, and control to the exact page SKU", () => {
  const url = "https://www.walmart.com/ip/99-Nights-in-the-Forest-Collectible-Pins-with-DLC/20009805270";
  const observation = observeRetailerOffer(
    fixture("walmart-cross-offer.html", url),
    url,
    "walmart",
    "20009805270",
    "pickup",
    NOW
  );
  assert.deepEqual({
    price: observation.unitPriceCents,
    seller: observation.sellerName,
    sellerType: observation.sellerType,
    fulfillment: observation.fulfillment,
    actionable: observation.addControlActionable
  }, {
    price: 798,
    seller: "Walmart",
    sellerType: "first_party",
    fulfillment: "pickup",
    actionable: true
  });
  const defaulted = observeRetailerOffer(
    fixture("walmart-cross-offer.html", url), url, "walmart", "20009805270", "either", NOW
  );
  assert.equal(defaulted.fulfillment, "unknown");
  assert.equal(defaulted.addControlActionable, false);
});

test("Amazon observer binds ASIN, seller, price, and keeps offer IDs ephemeral", () => {
  const url = "https://www.amazon.com/dp/B0GYTRYV7P";
  const document = fixture("amazon-first-party.html", url);
  const firstParty = observeRetailerOffer(document, url, "amazon", "B0GYTRYV7P", "shipping", NOW);
  assert.equal(firstParty.unitPriceCents, 2186);
  assert.equal(firstParty.sellerType, "first_party");
  assert.equal(firstParty.sellerName, "Amazon.com");
  assert.equal(firstParty.fulfillment, "shipping");
  assert.equal(firstParty.addControlActionable, true);
  const offer = extractAmazonOfferListingId(document, "B0GYTRYV7P");
  assert.equal(offer, "FIXTURE+OFFER/ONE==");
  assert.equal(extractAmazonOfferListingId(document, "B0WRONG000"), "");
  assert.equal(amazonOfferRouteBindable("B0GYTRYV7P", offer), true);
  assert.equal(amazonOfferRouteBindable("B0GYTRYV7P", ""), false);
  assert.equal(amazonOfferRouteBindable("b0gytryv7p", offer), false);
  assert.equal(amazonOfferRouteBindable("B0GYTRYV7P", `${offer}\u0000`), false);
  assert.equal(Object.keys(firstParty).some((key) => /offerlisting|token/i.test(key)), false);

  const routeEvidence = collectRetailerShadowObservation(document, url, "amazon", "shipping");
  assert.deepEqual(routeEvidence.selectedOffer, {
    schemaVersion: 1,
    selectionState: "exact",
    childOfferKey: "B0GYTRYV7P",
    attributes: {}
  });
  assert.equal(routeEvidence.purchaseRouteKind, "amazon_buy_now");
  assert.equal(routeEvidence.purchaseRouteReady, true);
  assert.equal(routeEvidence.routeReasonCode, "offer_route_verified");
  assert.equal(JSON.stringify(routeEvidence).includes(offer), false);
  assert.equal(JSON.stringify(routeEvidence).includes("offerListingID"), false);

  const marketplace = observeRetailerOffer(fixture("amazon-marketplace.html", url), url, "amazon", "B0GYTRYV7P", "shipping", NOW);
  assert.equal(marketplace.sellerType, "third_party");
  assert.equal(marketplace.sellerName, "FIXTURE_SELLER");
  assert.equal(marketplace.unitPriceCents, 12186);
});

test("an unavailable Amazon page cannot borrow a recommendation price without an exact Add control", () => {
  const url = "https://www.amazon.com/dp/B0F2BDXW4J";
  const document = new JSDOM(`
    <main><input id="ASIN" value="B0F2BDXW4J"><h1>Unavailable exact product</h1>
      <div id="availability"><span>Currently unavailable.</span></div></main>
    <aside aria-label="Recommended products"><span class="a-price"><span class="a-offscreen">$40.00</span></span></aside>
  `, { url }).window.document;
  const observation = observeRetailerOffer(document, url, "amazon", "B0F2BDXW4J", "shipping", NOW);
  assert.equal(observation.availability, "out_of_stock");
  assert.equal(observation.addControlActionable, false);
  assert.equal(observation.unitPriceCents, null);
});

test("Amazon observer binds the live Offer Display Feature without admitting marketplace offers", () => {
  const firstPartyUrl = "https://www.amazon.com/dp/B0DCGQ6CJD";
  const firstPartyDocument = fixture("amazon-offer-display-first-party.html", firstPartyUrl);
  assert.equal(retailerInteractiveBlock(firstPartyDocument, firstPartyUrl), "");
  const firstParty = observeRetailerOffer(
    firstPartyDocument,
    firstPartyUrl,
    "amazon",
    "B0DCGQ6CJD",
    "shipping",
    NOW
  );
  assert.deepEqual({
    price: firstParty.unitPriceCents,
    seller: firstParty.sellerName,
    sellerType: firstParty.sellerType,
    fulfillment: firstParty.fulfillment,
    actionable: firstParty.addControlActionable,
    offer: extractAmazonOfferListingId(firstPartyDocument, "B0DCGQ6CJD")
  }, {
    price: 1060,
    seller: "Amazon.com",
    sellerType: "first_party",
    fulfillment: "shipping",
    actionable: true,
    offer: "FIXTURE_ODF_FIRST_PARTY_OFFER"
  });

  const marketplaceUrl = "https://www.amazon.com/dp/B0F2BDXW4J";
  const marketplace = observeRetailerOffer(
    fixture("amazon-offer-display-marketplace.html", marketplaceUrl),
    marketplaceUrl,
    "amazon",
    "B0F2BDXW4J",
    "shipping",
    NOW
  );
  assert.deepEqual({
    price: marketplace.unitPriceCents,
    seller: marketplace.sellerName,
    sellerType: marketplace.sellerType,
    fulfillment: marketplace.fulfillment,
    actionable: marketplace.addControlActionable
  }, {
    price: 12199,
    seller: "Prime Picks (S/N Recorded)",
    sellerType: "third_party",
    fulfillment: "shipping",
    actionable: true
  });

  const separatedMarketplaceUrl = "https://www.amazon.com/dp/B081J5PW5J";
  const separatedMarketplaceDocument = fixture(
    "amazon-offer-display-separated-marketplace.html",
    separatedMarketplaceUrl
  );
  const separatedMarketplace = observeRetailerOffer(
    separatedMarketplaceDocument,
    separatedMarketplaceUrl,
    "amazon",
    "B081J5PW5J",
    "shipping",
    NOW
  );
  assert.deepEqual({
    price: separatedMarketplace.unitPriceCents,
    seller: separatedMarketplace.sellerName,
    sellerType: separatedMarketplace.sellerType,
    fulfillment: separatedMarketplace.fulfillment,
    actionable: separatedMarketplace.addControlActionable,
    offer: extractAmazonOfferListingId(separatedMarketplaceDocument, "B081J5PW5J")
  }, {
    price: 1199,
    seller: "theory11",
    sellerType: "third_party",
    fulfillment: "shipping",
    actionable: true,
    offer: "FIXTURE_ODF_SEPARATED_MARKETPLACE_OFFER"
  });

  const separatedSeller = separatedMarketplaceDocument.querySelector(
    "#merchantInfoFeature_feature_div .offer-display-feature-text-message"
  );
  const separatedFulfiller = separatedMarketplaceDocument.querySelector(
    "#fulfillerInfoFeature_feature_div .offer-display-feature-text-message"
  );
  assert.ok(separatedSeller);
  assert.ok(separatedFulfiller);
  separatedSeller.textContent = "Amazon.com";
  separatedFulfiller.textContent = "Merchant Logistics";
  const mismatchedAmazon = observeRetailerOffer(
    separatedMarketplaceDocument,
    separatedMarketplaceUrl,
    "amazon",
    "B081J5PW5J",
    "shipping",
    NOW
  );
  assert.equal(mismatchedAmazon.sellerName, "Amazon.com");
  assert.equal(mismatchedAmazon.sellerType, "unknown");

  separatedFulfiller.textContent = "Amazon";
  const separatedFirstParty = observeRetailerOffer(
    separatedMarketplaceDocument,
    separatedMarketplaceUrl,
    "amazon",
    "B081J5PW5J",
    "shipping",
    NOW
  );
  assert.equal(separatedFirstParty.sellerName, "Amazon.com");
  assert.equal(separatedFirstParty.sellerType, "first_party");
});

test("Amazon binds canonical accordion tokens and explicit ASINs across alternate layouts", () => {
  const accordionUrl = "https://www.amazon.com/dp/B0FB21526X";
  const accordionDocument = fixture("amazon-accordion-canonical-offer.html", accordionUrl);
  const accordion = observeRetailerOffer(
    accordionDocument,
    accordionUrl,
    "amazon",
    "B0FB21526X",
    "shipping",
    NOW
  );
  assert.deepEqual({
    price: accordion.unitPriceCents,
    sellerType: accordion.sellerType,
    fulfillment: accordion.fulfillment,
    actionable: accordion.addControlActionable,
    offer: extractAmazonOfferListingId(accordionDocument, "B0FB21526X")
  }, {
    price: 7999,
    sellerType: "first_party",
    fulfillment: "shipping",
    actionable: true,
    offer: "FIXTURE_CANONICAL_ACCORDION_OFFER"
  });

  const variationUrl = "https://www.amazon.com/dp/B0FH8M48ZC";
  const variationDocument = fixture("amazon-variation-heavy.html", variationUrl);
  const variation = observeRetailerOffer(
    variationDocument,
    variationUrl,
    "amazon",
    "B0FH8M48ZC",
    "shipping",
    NOW
  );
  assert.deepEqual({
    price: variation.unitPriceCents,
    sellerType: variation.sellerType,
    fulfillment: variation.fulfillment,
    actionable: variation.addControlActionable,
    offer: extractAmazonOfferListingId(variationDocument, "B0FH8M48ZC")
  }, {
    price: 17599,
    sellerType: "first_party",
    fulfillment: "shipping",
    actionable: true,
    offer: "FIXTURE_VARIATION_SELECTED_OFFER"
  });

  const marketplaceUrl = "https://www.amazon.com/dp/B07ZPS1KVD";
  const marketplaceDocument = fixture("amazon-accordion-marketplace.html", marketplaceUrl);
  const marketplace = observeRetailerOffer(
    marketplaceDocument,
    marketplaceUrl,
    "amazon",
    "B07ZPS1KVD",
    "shipping",
    NOW
  );
  assert.equal(marketplace.addControlActionable, true);
  assert.equal(marketplace.fulfillment, "shipping");
  assert.equal(marketplace.sellerType, "third_party");
  assert.equal(marketplace.sellerName, "YOAU Electric Co.,Ltd");

  const diagnostic = collectRetailerShadowAttempt(accordionDocument, accordionUrl, "amazon", "shipping");
  assert.equal(diagnostic.diagnostic.outcome, "passed");
  assert.equal(diagnostic.diagnostic.failureStage, "complete");
  assert.equal(diagnostic.diagnostic.layout.scopeKind, "accordion");
  assert.equal(diagnostic.diagnostic.layout.canonicalOfferDistinctCount, 1);
  assert.equal(diagnostic.diagnostic.layout.alternateOfferDistinctCount, 1);
  assert.equal(JSON.stringify(diagnostic.diagnostic).includes("FIXTURE_CANONICAL_ACCORDION_OFFER"), false);
  assert.equal(JSON.stringify(diagnostic.diagnostic).includes("FIXTURE_SECONDARY_PAYMENT_OFFER"), false);
});

test("Best Buy observer binds exact first-party shipping and rejects marketplace, pickup, and ambiguous SKUs", () => {
  const url = "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149";
  const document = fixture("bestbuy-first-party.html", url);
  const observation = observeRetailerOffer(document, url, "bestbuy", "6588149", "shipping", NOW);
  assert.equal(observation.unitPriceCents, 699);
  assert.equal(observation.sellerType, "first_party");
  assert.equal(observation.sellerName, "Best Buy");
  assert.equal(observation.fulfillment, "shipping");
  assert.equal(observation.addControlActionable, true);
  assert.equal(retailerAddControl(document, url, "bestbuy", "6588149", "shipping")?.textContent, "Add to cart");
  const wrong = observeRetailerOffer(document, url, "bestbuy", "9999999", "shipping", NOW);
  assert.equal(wrong.addControlActionable, false);
  // A page for another product proves nothing about this product's stock.
  assert.equal(wrong.availability, "unknown");

  const marketplaceUrl = "https://www.bestbuy.com/product/pokemon-tin/JJG2TL3V8K/sku/12716513";
  const marketplace = observeRetailerOffer(
    fixture("bestbuy-marketplace.html", marketplaceUrl),
    marketplaceUrl,
    "bestbuy",
    "12716513",
    "shipping",
    NOW
  );
  assert.equal(marketplace.sellerType, "third_party");
  assert.equal(marketplace.sellerName, "Shopville Inc");
  assert.equal(marketplace.addControlActionable, true);

  const pickup = observeRetailerOffer(
    fixture("bestbuy-pickup-selected.html", url),
    url,
    "bestbuy",
    "6588149",
    "shipping",
    NOW
  );
  // The offer binds for pickup only; the empty selection keeps that fact so
  // the diagnostic reads as a fulfillment policy result, not a lost binding.
  assert.equal(pickup.fulfillment, "pickup");
  assert.equal(pickup.availability, "unknown");
  assert.equal(pickup.addControlActionable, false);
  const pickupAttempt = collectRetailerShadowAttempt(fixture("bestbuy-pickup-selected.html", url), url, "bestbuy", "shipping");
  assert.equal(pickupAttempt.diagnostic.outcome, "rejected");
  assert.equal(pickupAttempt.diagnostic.failureStage, "policy");
  assert.equal(pickupAttempt.diagnostic.reasonCode, "fulfillment_not_supported");

  const ambiguous = observeRetailerOffer(
    fixture("bestbuy-ambiguous-sku.html", url),
    url,
    "bestbuy",
    "6588149",
    "shipping",
    NOW
  );
  assert.equal(ambiguous.addControlActionable, false);

  document.querySelector("[data-testid='sold-by']")?.remove();
  const sellerMissing = observeRetailerOffer(document, url, "bestbuy", "6588149", "shipping", NOW);
  assert.equal(sellerMissing.sellerType, "unknown");
  assert.equal(sellerMissing.addControlActionable, false);
});

test("Best Buy ignores challenge phrases in non-observable scripts but still blocks visible security checks", () => {
  const url = "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149";
  const document = fixture("bestbuy-first-party.html", url);
  document.body.insertAdjacentHTML("beforeend", `<script>window.__copy = "Additional security check is required";</script>`);
  assert.equal(retailerSecurityChallenge(document), false);
  const attempt = collectRetailerShadowAttempt(document, url, "bestbuy", "shipping");
  assert.equal(attempt.observation.addControlActionable, true);
  assert.equal(attempt.diagnostic.outcome, "passed");

  document.body.insertAdjacentHTML("afterbegin", `<section>Additional security check is required</section>`);
  assert.equal(retailerSecurityChallenge(document), true);
  const blocked = collectRetailerShadowAttempt(document, url, "bestbuy", "shipping");
  assert.equal(blocked.observation.addControlActionable, false);
  assert.equal(blocked.diagnostic.reasonCode, "security_challenge");
});

test("Best Buy ignores CSS-hidden challenge scaffolding and reports its current account gate as authentication", () => {
  const url = "https://www.bestbuy.com/product/2026-topps-flagship-football-mega-box/J3ZPGXX9RP/sku/6685081";
  const loggedOut = fixture("bestbuy-single-split-shell.html", url);
  loggedOut.head.insertAdjacentHTML("beforeend", `<style>
    .bestbuy-runtime-captcha, .signed-in-only-copy { display: none; }
  </style>`);
  loggedOut.body.insertAdjacentHTML("afterbegin", `
    <div id="captcha-runtime" class="bestbuy-runtime-captcha">Additional security check is required</div>
    <div role="status">High Demand Product — this item is expected to sell out quickly.</div>
    <section data-testid="account-required-gate">
      <h2>Account Required</h2>
      <p>An account is required to purchase this item.</p>
      <a href="/identity/global/signin">Sign In</a>
    </section>`);
  assert.equal(retailerSecurityChallenge(loggedOut, "bestbuy"), false);
  assert.equal(retailerInteractiveBlock(loggedOut, url), "auth");
  const loggedOutAttempt = collectRetailerShadowAttempt(loggedOut, url, "bestbuy", "shipping");
  assert.equal(loggedOutAttempt.observation.securityChallenge, false);
  assert.equal(loggedOutAttempt.observation.interactiveBlock, "auth");
  assert.equal(loggedOutAttempt.diagnostic.reasonCode, "interactive_auth");

  const signedIn = fixture("bestbuy-single-split-shell.html", url);
  signedIn.head.insertAdjacentHTML("beforeend", `<style>
    .bestbuy-runtime-captcha, .account-required-gate { display: none; }
  </style>`);
  signedIn.body.insertAdjacentHTML("afterbegin", `
    <div id="captcha-runtime" class="bestbuy-runtime-captcha">Additional security check is required</div>
    <div role="status">High Demand Product — this item is expected to sell out quickly.</div>
    <section class="account-required-gate">
      <h2>Account Required</h2><p>An account is required to purchase this item.</p>
    </section>`);
  assert.equal(retailerSecurityChallenge(signedIn, "bestbuy"), false);
  assert.equal(retailerInteractiveBlock(signedIn, url), "");
  const signedInOffer = observeRetailerOffer(signedIn, url, "bestbuy", "6685081", "shipping", NOW);
  assert.deepEqual({
    availability: signedInOffer.availability,
    price: signedInOffer.unitPriceCents,
    seller: signedInOffer.sellerName,
    fulfillment: signedInOffer.fulfillment,
    actionable: signedInOffer.addControlActionable
  }, {
    availability: "in_stock",
    price: 4999,
    seller: "Best Buy",
    fulfillment: "shipping",
    actionable: true
  });
});

test("Best Buy diagnoses the captured Pickup layout without confusing Buy Now or accessories with stock", () => {
  const url = "https://www.bestbuy.com/product/disney-lorcana-winterspell-playmat-dragon-fire/CJ6QGKQ8QQ";
  const document = fixture("bestbuy-lorcana-pickup-buy-now.html", url);
  for (const environment of [undefined, { isVisible: () => true }]) {
    const shipping = collectRetailerShadowAttempt(document, url, "bestbuy", "shipping", 1, false, environment);
    assert.equal(shipping.diagnostic.layout.addControlCount, 1);
    assert.equal(shipping.observation.securityChallenge, false);
    assert.equal(shipping.observation.fulfillment, "pickup");
    assert.equal(shipping.observation.availability, "unknown");
    assert.equal(shipping.diagnostic.outcome, "rejected");
    assert.equal(shipping.diagnostic.reasonCode, "fulfillment_not_supported");
    const pickup = collectRetailerShadowAttempt(document, url, "bestbuy", "pickup", 1, false, environment);
    assert.equal(pickup.diagnostic.outcome, "passed");
    assert.equal(pickup.diagnostic.layout.scopedControlCount, 1);
    assert.equal(pickup.observation.unitPriceCents, 2499);
    assert.equal(pickup.observation.sellerName, "Best Buy");
    assert.equal(pickup.observation.availability, "in_stock");
  }
  // Unclassified secondary controls must not turn an exact Pickup offer
  // into an ambiguous shipping diagnostic, either.
  document.querySelector("[data-testid='carousel-add-to-cart-12692462']")!.setAttribute("data-testid", "accessory-add-to-cart");
  assert.equal(collectRetailerShadowAttempt(document, url, "bestbuy", "shipping").diagnostic.reasonCode, "fulfillment_not_supported");
  assert.equal(collectRetailerShadowAttempt(document, url, "bestbuy", "pickup").diagnostic.outcome, "passed");
  for (const radio of document.querySelectorAll("[role='radio']")) {
    radio.setAttribute("aria-checked", String(radio.textContent?.includes("Shipping")));
  }
  assert.equal(collectRetailerShadowAttempt(document, url, "bestbuy", "shipping").diagnostic.outcome, "passed");
  document.querySelector("#a2c")!.append(document.querySelector("[data-testid='pdp-add-to-cart-6667316']")!.cloneNode(true));
  const ambiguous = collectRetailerShadowAttempt(document, url, "bestbuy", "shipping");
  assert.equal(ambiguous.diagnostic.reasonCode, "add_control_ambiguous");
  assert.equal(ambiguous.observation.addControlActionable, false);
});

test("Best Buy observer recognizes modern fulfillment while keeping pickup an explicit opt-in", () => {
  const shippingUrl = "https://www.bestbuy.com/product/ultra-pro-9-pocket-zippered-top-loader-premium-pro-binder/J79X4L6QJF/sku/6670797";
  const shippingDocument = fixture("bestbuy-modern-first-party.html", shippingUrl);
  const shipping = observeRetailerOffer(shippingDocument, shippingUrl, "bestbuy", "6670797", "shipping", NOW);
  assert.deepEqual({
    price: shipping.unitPriceCents,
    seller: shipping.sellerName,
    fulfillment: shipping.fulfillment,
    actionable: shipping.addControlActionable
  }, {
    price: 3299,
    seller: "Best Buy",
    fulfillment: "shipping",
    actionable: true
  });
  const shippingLayout = retailerAdapterLayoutEvidence(shippingDocument, shippingUrl, "bestbuy", "6670797");
  assert.equal(shippingLayout.addControlCount, 1);
  assert.equal(shippingLayout.genericAddIntentCount, 1);
  assert.equal(shippingLayout.scopedControlCount, 1);

  const pickupUrl = "https://www.bestbuy.com/product/ultra-pro-3-x-4-clear-regular-toploader-25-count-pack/J79X4PXVR7/sku/6528565";
  const pickupDocument = fixture("bestbuy-modern-pickup-only.html", pickupUrl);
  assert.equal(retailerAddControl(pickupDocument, pickupUrl, "bestbuy", "6528565", "shipping"), null);
  assert.ok(retailerAddControl(pickupDocument, pickupUrl, "bestbuy", "6528565", "pickup"));
  const pickup = observeRetailerOffer(pickupDocument, pickupUrl, "bestbuy", "6528565", "pickup", NOW);
  assert.deepEqual({
    price: pickup.unitPriceCents,
    seller: pickup.sellerName,
    sellerType: pickup.sellerType,
    fulfillment: pickup.fulfillment,
    actionable: pickup.addControlActionable
  }, {
    price: 549,
    seller: "Best Buy",
    sellerType: "first_party",
    fulfillment: "pickup",
    actionable: true
  });
  const pickupAttempt = collectRetailerShadowAttempt(pickupDocument, pickupUrl, "bestbuy", "pickup");
  assert.equal(pickupAttempt.diagnostic.outcome, "passed");
  assert.equal(pickupAttempt.diagnostic.failureStage, "complete");

  const selectorMissDocument = new JSDOM(`
    <main><section data-testid="buy-box" data-sku-id="6670797">
      <div data-testid="customer-price">$32.99</div><div data-testid="sold-by">Sold by Best Buy</div>
      <div role="radio" aria-checked="true">Shipping available</div>
      <div role="button">Add to cart</div>
    </section></main>
  `, { url: shippingUrl }).window.document;
  const selectorMiss = collectRetailerShadowAttempt(selectorMissDocument, shippingUrl, "bestbuy", "shipping");
  assert.equal(selectorMiss.diagnostic.layout.addControlCount, 0);
  assert.equal(selectorMiss.diagnostic.layout.genericAddIntentCount, 1);
  assert.equal(selectorMiss.diagnostic.outcome, "failed");
  assert.equal(selectorMiss.diagnostic.reasonCode, "add_control_selector_miss");
});

test("Best Buy identifies the exact high-velocity reservation flow without inventing selected fulfillment", () => {
  const url = "https://www.bestbuy.com/site/reservation-product/6669869.p";
  const document = fixture("bestbuy-high-velocity-reservation.html", url);
  const attempt = collectRetailerShadowAttempt(document, url, "bestbuy", "shipping");
  assert.equal(attempt.observation.interactiveBlock, "high_demand");
  assert.equal(attempt.observation.fulfillment, "unknown");
  assert.equal(attempt.observation.addControlActionable, false);
  assert.equal(attempt.diagnostic.outcome, "rejected");
  assert.equal(attempt.diagnostic.failureStage, "interactive_block");
  assert.equal(attempt.diagnostic.reasonCode, "interactive_high_demand");
});

test("Best Buy ignores hidden, unrelated and passive reservation markup on a normal offer", () => {
  const url = "https://www.bestbuy.com/site/normal-product/6588149.p";
  for (const mode of ["hidden", "foreign_sku", "passive", "accessory", "removed"] as const) {
    const document = fixture("bestbuy-first-party.html", url);
    const source = fixture("bestbuy-high-velocity-reservation.html", url);
    const panel = document.importNode(source.querySelector("[data-component-name='FulfillmentSelector']")!, true);
    if (mode !== "foreign_sku") {
      for (const element of panel.querySelectorAll("[data-testid]")) {
        element.setAttribute("data-testid", element.getAttribute("data-testid")!.replace(/6669869/g, "6588149"));
      }
    }
    if (mode === "hidden") panel.setAttribute("hidden", "");
    if (mode === "passive") panel.querySelector("[data-testid*='messaging']")!.textContent = "This item is expected to sell out quickly.";
    if (mode === "accessory") panel.setAttribute("data-testid", "recommendations");
    document.querySelector("main")!.append(panel);
    if (mode === "removed") panel.remove();
    const attempt = collectRetailerShadowAttempt(document, url, "bestbuy", "shipping");
    assert.equal(attempt.observation.interactiveBlock, "", mode);
    assert.equal(attempt.diagnostic.outcome, "passed", mode);
  }
});

test("Best Buy v10 distinguishes passive demand badges from real gates and preserves pickup opt-in", () => {
  const preorderUrl = "https://www.bestbuy.com/product/wizards-of-the-coast-magic-the-gathering-reality-fracture-play-booster-box-30-packs/JJ8VP7Z65T/sku/6678193";
  const preorderDocument = fixture("bestbuy-reality-fracture-preorder.html", preorderUrl);
  const preorder = observeRetailerOffer(preorderDocument, preorderUrl, "bestbuy", "6678193", "either", NOW);
  assert.deepEqual({
    availability: preorder.availability,
    price: preorder.unitPriceCents,
    seller: preorder.sellerName,
    fulfillment: preorder.fulfillment,
    actionable: preorder.addControlActionable,
    block: preorder.interactiveBlock
  }, {
    availability: "preorder",
    price: 15499,
    seller: "Best Buy",
    fulfillment: "shipping",
    actionable: true,
    block: ""
  });

  const highDemandUrl = "https://www.bestbuy.com/product/cardsmiths-mega-man-series-1-collectors-box-2-pack/J39HKFSVZK/sku/6669782";
  const highDemandDocument = fixture("bestbuy-mega-man-high-demand.html", highDemandUrl);
  const highDemand = observeRetailerOffer(highDemandDocument, highDemandUrl, "bestbuy", "6669782", "either", NOW);
  assert.deepEqual({
    availability: highDemand.availability,
    price: highDemand.unitPriceCents,
    seller: highDemand.sellerName,
    fulfillment: highDemand.fulfillment,
    actionable: highDemand.addControlActionable,
    block: highDemand.interactiveBlock
  }, {
    availability: "in_stock",
    price: 1449,
    seller: "Best Buy",
    fulfillment: "shipping",
    actionable: true,
    block: ""
  });
  const highDemandAttempt = collectRetailerShadowAttempt(highDemandDocument, highDemandUrl, "bestbuy", "either");
  assert.equal(highDemandAttempt.diagnostic.outcome, "passed");
  assert.equal(highDemandAttempt.diagnostic.failureStage, "complete");

  const gatedUrl = "https://www.bestbuy.com/product/riftbound-league-of-legends-trading-card-game-unleashed-champion-deck-vex/J3GWY59Q5Z/sku/6669286";
  const gatedDocument = fixture("bestbuy-demand-gate.html", gatedUrl);
  const gated = observeRetailerOffer(gatedDocument, gatedUrl, "bestbuy", "6669286", "shipping", NOW);
  assert.equal(gated.interactiveBlock, "high_demand");
  assert.equal(gated.addControlActionable, false);
  const gatedAttempt = collectRetailerShadowAttempt(gatedDocument, gatedUrl, "bestbuy", "shipping");
  assert.equal(gatedAttempt.diagnostic.outcome, "rejected");
  assert.equal(gatedAttempt.diagnostic.failureStage, "interactive_block");
  assert.equal(gatedAttempt.diagnostic.reasonCode, "interactive_high_demand");

  const pickupCases = [
    ["6612619", "bestbuy-pikachu-pickup-selected.html", "https://www.bestbuy.com/product/ultra-pro-pikachu-playmat-for-pokemon/J79X4L6RHZ/sku/6612619", 1949],
    ["6669690", "bestbuy-hoth-pickup-selected.html", "https://www.bestbuy.com/product/asmodee-star-wars-unlimited-trading-card-game-intro-battle-hoth/J394C9ZSYW/sku/6669690", 1549]
  ] as const;
  for (const [sku, fixtureName, url, price] of pickupCases) {
    const document = fixture(fixtureName, url);
    const observation = observeRetailerOffer(document, url, "bestbuy", sku, "pickup", NOW);
    assert.deepEqual({
      price: observation.unitPriceCents,
      seller: observation.sellerName,
      fulfillment: observation.fulfillment,
      actionable: observation.addControlActionable
    }, { price, seller: "Best Buy", fulfillment: "pickup", actionable: true }, sku);
    assert.equal(retailerAddControl(document, url, "bestbuy", sku, "shipping"), null, sku);
    assert.ok(retailerAddControl(document, url, "bestbuy", sku, "pickup"), sku);
  }
});

test("Best Buy v10 binds one primary action when the same exact offer also renders a sticky duplicate", () => {
  const demandUrl = "https://www.bestbuy.com/product/riftbound-league-of-legends-trading-card-game-unleashed-champion-deck-vex/J3GWY59Q5Z/sku/6669286";
  const passiveDemand = fixture("bestbuy-passive-demand-badge.html", demandUrl);
  const demandObservation = observeRetailerOffer(passiveDemand, demandUrl, "bestbuy", "6669286", "shipping", NOW);
  assert.deepEqual({
    price: demandObservation.unitPriceCents,
    seller: demandObservation.sellerName,
    fulfillment: demandObservation.fulfillment,
    actionable: demandObservation.addControlActionable,
    block: demandObservation.interactiveBlock
  }, {
    price: 1999,
    seller: "Best Buy",
    fulfillment: "shipping",
    actionable: true,
    block: ""
  });

  const duplicateUrl = "https://www.bestbuy.com/product/riftbound-origins-ahri-playmat/J3GWY596JF/sku/6677244";
  const duplicateDocument = fixture("bestbuy-primary-and-sticky-add.html", duplicateUrl);
  const duplicateObservation = observeRetailerOffer(
    duplicateDocument,
    duplicateUrl,
    "bestbuy",
    "6677244",
    "shipping",
    NOW
  );
  assert.deepEqual({
    price: duplicateObservation.unitPriceCents,
    seller: duplicateObservation.sellerName,
    fulfillment: duplicateObservation.fulfillment,
    actionable: duplicateObservation.addControlActionable
  }, {
    price: 2499,
    seller: "Best Buy",
    fulfillment: "shipping",
    actionable: true
  });
  const layout = retailerAdapterLayoutEvidence(duplicateDocument, duplicateUrl, "bestbuy", "6677244");
  assert.equal(layout.addControlCount, 2);
  assert.equal(layout.genericAddIntentCount, 2);
  assert.equal(layout.scopedControlCount, 1);
  assert.ok(retailerAddControl(duplicateDocument, duplicateUrl, "bestbuy", "6677244", "shipping"));

  const unsafeDuplicate = fixture("bestbuy-first-party.html", "https://www.bestbuy.com/product/example/J2FPJKS4SK/sku/6588149");
  const duplicateControl = unsafeDuplicate.querySelector("[data-testid='buy-box'] button")?.cloneNode(true);
  if (duplicateControl) unsafeDuplicate.querySelector("[data-testid='buy-box']")?.append(duplicateControl);
  assert.equal(retailerAddControl(
    unsafeDuplicate,
    "https://www.bestbuy.com/product/example/J2FPJKS4SK/sku/6588149",
    "bestbuy",
    "6588149",
    "shipping"
  ), null);
});

test("Best Buy v10 recovers one exact split-shell action without admitting page-level ambiguity", () => {
  const url = "https://www.bestbuy.com/product/2026-topps-flagship-football-mega-box/J3ZPGXX9RP/sku/6685081";
  const document = fixture("bestbuy-single-split-shell.html", url);
  const observation = observeRetailerOffer(document, url, "bestbuy", "6685081", "shipping", NOW);
  assert.deepEqual({
    price: observation.unitPriceCents,
    seller: observation.sellerName,
    sellerType: observation.sellerType,
    fulfillment: observation.fulfillment,
    actionable: observation.addControlActionable
  }, {
    price: 4999,
    seller: "Best Buy",
    sellerType: "first_party",
    fulfillment: "shipping",
    actionable: true
  });
  const layout = retailerAdapterLayoutEvidence(document, url, "bestbuy", "6685081");
  assert.equal(layout.addControlCount, 1);
  assert.equal(layout.genericAddIntentCount, 1);
  assert.equal(layout.priceCandidateCount, 6);
  assert.equal(layout.scopedControlCount, 1);
  assert.ok(retailerAddControl(document, url, "bestbuy", "6685081", "shipping"));

  const ambiguousPrice = fixture("bestbuy-single-split-shell.html", url);
  const prices = ambiguousPrice.querySelectorAll("[data-testid='customer-price']");
  if (prices[prices.length - 1]) prices[prices.length - 1]!.textContent = "$59.99";
  assert.equal(retailerAddControl(ambiguousPrice, url, "bestbuy", "6685081", "shipping"), null);

  const competingSku = fixture("bestbuy-single-split-shell.html", url);
  competingSku.querySelector("main")?.insertAdjacentHTML("beforeend", "<p>SKU: 6685082</p>");
  assert.equal(retailerAddControl(competingSku, url, "bestbuy", "6685081", "shipping"), null);

  const ambiguousAction = fixture("bestbuy-single-split-shell.html", url);
  const duplicate = ambiguousAction.querySelector(".add-to-cart-button")?.cloneNode(true);
  if (duplicate) ambiguousAction.querySelector("[data-testid='product-action']")?.append(duplicate);
  assert.equal(retailerAddControl(ambiguousAction, url, "bestbuy", "6685081", "shipping"), null);
});

test("Best Buy in-store-only products remain manual unknown evidence rather than global out-of-stock", () => {
  const url = "https://www.bestbuy.com/product/pokemon-trading-card-game-pokemon-day-2026-collection/JJG2TL3JS9/sku/6664887";
  const document = fixture("bestbuy-in-store-only.html", url);
  const observation = observeRetailerOffer(document, url, "bestbuy", "6664887", "either", NOW);
  assert.deepEqual({
    availability: observation.availability,
    price: observation.unitPriceCents,
    sellerType: observation.sellerType,
    fulfillment: observation.fulfillment,
    actionable: observation.addControlActionable,
    block: observation.interactiveBlock
  }, {
    availability: "unknown",
    price: null,
    sellerType: "unknown",
    fulfillment: "unknown",
    actionable: false,
    block: "location"
  });
  const attempt = collectRetailerShadowAttempt(document, url, "bestbuy", "either");
  assert.equal(attempt.diagnostic.outcome, "rejected");
  assert.equal(attempt.diagnostic.failureStage, "interactive_block");
  assert.equal(attempt.diagnostic.reasonCode, "interactive_location");
  assert.equal(attempt.diagnostic.layout.interactiveBlock, "location");
  assert.equal(JSON.stringify(attempt.diagnostic).includes("Pokémon Day"), false);
});

test("generic observers classify auth, MFA, membership, queue, and challenge as manual", () => {
  const page = (markup: string, url = "https://www.walmart.com/ip/example/17354421975") => new JSDOM(`<body>${markup}</body>`, { url }).window.document;
  assert.equal(retailerInteractiveBlock(page(`<form action="/login"><input type="password"></form>`), "https://www.walmart.com/ip/example/17354421975"), "auth");
  assert.equal(retailerInteractiveBlock(page(`<input autocomplete="one-time-code">`), "https://www.walmart.com/ip/example/17354421975"), "mfa");
  assert.equal(retailerInteractiveBlock(page(`<div role="dialog">Join Walmart+ membership required</div>`), "https://www.walmart.com/ip/example/17354421975"), "membership");
  assert.equal(retailerInteractiveBlock(page(`<main>You’re in line in our virtual queue</main>`), "https://www.walmart.com/ip/example/17354421975"), "queue");
  const challenge = page(`<iframe src="https://security.example/captcha"></iframe>`);
  assert.equal(retailerSecurityChallenge(challenge), true);
  assert.equal(retailerInteractiveBlock(challenge, "https://www.walmart.com/ip/example/17354421975"), "unknown");
  const currentWalmartChallenge = page(`<main><h1>Robot or human?</h1><button>Activate and hold the button to confirm</button></main>`);
  assert.equal(retailerSecurityChallenge(currentWalmartChallenge), true);
  assert.equal(retailerInteractiveBlock(currentWalmartChallenge, "https://www.walmart.com/ip/example/17354421975"), "unknown");
  const accessDenied = new JSDOM(`<title>Access Denied - Macy's</title><body>Reference number 123</body>`).window.document;
  assert.equal(retailerSecurityChallenge(accessDenied), true);
  const cloudflare = new JSDOM(`<title>Just a moment...</title><body>Checking your browser</body>`).window.document;
  assert.equal(retailerInteractiveBlock(cloudflare, "https://www.booksamillion.com/p/-/F019649505470"), "unknown");
  const imperva = new JSDOM(`<body><iframe src="https://www.pokemoncenter.com/_Incapsula_Resource?SWUDNSAI=31"></iframe></body>`).window.document;
  assert.equal(retailerSecurityChallenge(imperva), true);
  const unavailableShell = new JSDOM(`<title>PAGE NOT AVAILABLE｜PREMIUM BANDAI</title><body>Page unavailable</body>`).window.document;
  assert.equal(retailerSecurityChallenge(unavailableShell), false);
  assert.equal(retailerInteractiveBlock(unavailableShell, "https://p-bandai.com/us/item/N2884150001"), "unknown");
});

test("Best Buy reports a lost add-control binding as an adapter defect, never as an unavailable listing", () => {
  const url = "https://www.bestbuy.com/product/panini-prizm-fifa-world-cup-2026-soccer-mega-box/JX58X26VJ9/sku/6680948";
  const page = (shippingState: string, control: string) => new JSDOM(`
    <main>
      <section data-testid="fulfillment-purchase-panel" data-sku-id="6680948">
        <p>SKU: 6680948</p>
        <div data-testid="customer-price"><span>$149.99</span></div>
        <div data-testid="sold-by">Sold and shipped by Best Buy</div>
        <div data-testid="fulfillment-card-shipping" role="radio" ${shippingState}><strong>Shipping</strong><span>Get it tomorrow</span></div>
        <div data-testid="fulfillment-card-pickup" role="radio" aria-checked="false"><strong>Pickup</strong><span>Check stores</span></div>
        ${control}
      </section>
    </main>
  `, { url }).window.document;

  // The shipping tile is rendered but no packaged selector marks it selected:
  // the control cannot be scoped, and the page said nothing about stock.
  const lost = collectRetailerShadowAttempt(
    page(`aria-pressed="true"`, `<button data-button-state="ADD_TO_CART">Add to Cart</button>`), url, "bestbuy", "shipping"
  );
  assert.equal(lost.observation.availability, "unknown");
  assert.equal(lost.observation.addControlActionable, false);
  assert.equal(lost.diagnostic.outcome, "failed");
  assert.equal(lost.diagnostic.failureStage, "fulfillment_binding");
  assert.equal(lost.diagnostic.reasonCode, "fulfillment_binding_missing");
  assert.equal(lost.diagnostic.layout.addControlCount, 1);
  assert.equal(lost.diagnostic.layout.scopedControlCount, 0);

  // The same page with a disabled sold-out control is a product-state result.
  const soldOut = collectRetailerShadowAttempt(
    page(`aria-checked="true"`, `<button data-button-state="SOLD_OUT" disabled>Sold Out</button>`), url, "bestbuy", "shipping"
  );
  assert.equal(soldOut.observation.availability, "out_of_stock");
  assert.equal(soldOut.diagnostic.outcome, "rejected");
  assert.equal(soldOut.diagnostic.reasonCode, "listing_unavailable_layout");

  // A selected shipping tile with a usable control passes as before.
  const passing = collectRetailerShadowAttempt(
    page(`aria-checked="true"`, `<button data-button-state="ADD_TO_CART">Add to Cart</button>`), url, "bestbuy", "shipping"
  );
  assert.equal(passing.observation.availability, "in_stock");
  assert.equal(passing.observation.fulfillment, "shipping");
  assert.equal(passing.diagnostic.outcome, "passed");
});
