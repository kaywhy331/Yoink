import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildAmazonBuyNowUrl,
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
  assert.equal(attempt.diagnostic.outcome, "failed");
  assert.equal(attempt.diagnostic.failureStage, "offer_binding");
  assert.equal(attempt.diagnostic.reasonCode, "selected_offer_binding_unresolved");
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
  assert.equal(unavailableAttempt.diagnostic.reasonCode, "add_control_disabled");
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
    "either",
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
  const route = new URL(buildAmazonBuyNowUrl({
    asin: "B0GYTRYV7P",
    offerListingId: offer,
    quantity: 1,
    associateTag: "pokemon-restocks-20"
  }));
  assert.equal(route.origin, "https://www.amazon.com");
  assert.equal(route.pathname, "/checkout/entry/buynow");
  assert.equal(route.searchParams.get("items[0.base][asin]"), "B0GYTRYV7P");
  assert.equal(route.searchParams.get("offerListingID"), offer);
  assert.equal(route.searchParams.get("quantity"), "1");
  assert.equal(route.searchParams.get("tag"), "pokemon-restocks-20");
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
    <main><input id="ASIN" value="B0F2BDXW4J"><h1>Unavailable exact product</h1></main>
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
  assert.equal(wrong.availability, "out_of_stock");

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
  assert.equal(pickup.fulfillment, "unknown");
  assert.equal(pickup.addControlActionable, false);

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

test("Best Buy v4 recognizes modern fulfillment and accessible seller controls while retaining shipping-only boundaries", () => {
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
  const pickup = observeRetailerOffer(pickupDocument, pickupUrl, "bestbuy", "6528565", "either", NOW);
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
  const pickupAttempt = collectRetailerShadowAttempt(pickupDocument, pickupUrl, "bestbuy", "either");
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
