import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyLiveOffer, type BrowserActionContract, type LiveOfferObservation } from "../packages/browser-safety/src/index.js";
import {
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  POKEMONCENTER_ADD_ADAPTER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION
} from "../packages/contracts/src/index.js";
import { parseRetailerPriceElement } from "../packages/browser-adapters/src/retailers.js";
import { observeWalmartCart } from "../packages/browser-adapters/src/walmart.js";
import { observeTargetCart } from "../packages/browser-adapters/src/target.js";
import { observeAmericanEagleCart } from "../packages/browser-adapters/src/americaneagle.js";
import { parseQuantityText, parseStepperText, quantityIsOne } from "../packages/browser-adapters/src/dom.js";
import { commitAmazonAdd, prepareAmazonAdd } from "../apps/extension/src/amazon-action.js";
import { commitBestBuyAdd, prepareBestBuyAdd } from "../apps/extension/src/bestbuy-action.js";
import { preparePokemonCenterAdd, type PokemonCenterAddJob } from "../apps/extension/src/pokemoncenter-action.js";
import { commitTargetAdd, prepareTargetAdd } from "../apps/extension/src/target-action.js";
import { commitWalmartAdd, prepareWalmartAdd } from "../apps/extension/src/walmart-action.js";
// @ts-expect-error The selector-pack lint is an importable JavaScript command module.
import { lintSelectorPacks } from "../scripts/lint-selector-packs.mjs";

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } }
};
const NOW = new Date("2026-08-23T16:00:00.000Z").getTime();
const RETAILERS = join(process.cwd(), "test", "fixtures", "retailers");

function load(path: string, url: string): Document {
  return new JSDOM(readFileSync(path, "utf8"), { url }).window.document;
}

function contract(overrides: Partial<BrowserActionContract>): BrowserActionContract {
  return {
    contractVersion: 1,
    jobId: "job_invariants",
    retailerId: "target",
    retailerSku: "1011483414",
    canonicalUrl: "https://www.target.com/p/fixture/-/A-1011483414",
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: 10_000,
    maxOrderTotalCents: 10_000,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "",
    fulfillment: "shipping",
    expiresAt: new Date(NOW + 60_000).toISOString(),
    ...overrides
  };
}

// The four oldest lanes, each with its real fixture and a cap that the fixture
// price clears. `prepare` and `commit` take the same arguments on every lane.
const OLD_LANES = [
  {
    id: "target",
    url: "https://www.target.com/p/fixture/-/A-1011483414",
    document: () => load(join(process.cwd(), "test", "fixtures", "target", "product-first-party.html"), "https://www.target.com/p/fixture/-/A-1011483414"),
    job: (overrides: Partial<BrowserActionContract> = {}) => ({
      ...contract({ retailerId: "target", retailerSku: "1011483414", canonicalUrl: "https://www.target.com/p/fixture/-/A-1011483414", maxUnitPriceCents: 6000, maxOrderTotalCents: 6000, expectedSeller: "Target", ...overrides }),
      adapterVersion: TARGET_ADD_ADAPTER_VERSION
    }),
    prepare: prepareTargetAdd,
    commit: commitTargetAdd
  },
  {
    id: "walmart",
    url: "https://www.walmart.com/ip/fixture/17354421975",
    document: () => load(join(RETAILERS, "walmart-first-party.html"), "https://www.walmart.com/ip/fixture/17354421975"),
    job: (overrides: Partial<BrowserActionContract> = {}) => ({
      ...contract({ retailerId: "walmart", retailerSku: "17354421975", canonicalUrl: "https://www.walmart.com/ip/fixture/17354421975", maxUnitPriceCents: 4500, maxOrderTotalCents: 4500, expectedSeller: "Walmart", ...overrides }),
      adapterVersion: WALMART_ADD_ADAPTER_VERSION
    }),
    prepare: prepareWalmartAdd,
    commit: commitWalmartAdd
  },
  {
    id: "amazon",
    url: "https://www.amazon.com/dp/B0GYTRYV7P",
    document: () => load(join(RETAILERS, "amazon-first-party.html"), "https://www.amazon.com/dp/B0GYTRYV7P"),
    job: (overrides: Partial<BrowserActionContract> = {}) => ({
      ...contract({ retailerId: "amazon", retailerSku: "B0GYTRYV7P", canonicalUrl: "https://www.amazon.com/dp/B0GYTRYV7P", maxUnitPriceCents: 2200, maxOrderTotalCents: 2200, expectedSeller: "Amazon.com", ...overrides }),
      adapterVersion: AMAZON_ADD_ADAPTER_VERSION
    }),
    prepare: prepareAmazonAdd,
    commit: commitAmazonAdd
  },
  {
    id: "bestbuy",
    url: "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149",
    document: () => load(join(RETAILERS, "bestbuy-first-party.html"), "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149"),
    job: (overrides: Partial<BrowserActionContract> = {}) => ({
      ...contract({ retailerId: "bestbuy", retailerSku: "6588149", canonicalUrl: "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149", maxUnitPriceCents: 699, maxOrderTotalCents: 699, expectedSeller: "Best Buy", ...overrides }),
      adapterVersion: BESTBUY_ADD_ADAPTER_VERSION
    }),
    prepare: prepareBestBuyAdd,
    commit: commitBestBuyAdd
  }
] as const;

type AnyPrepare = (document: Document, url: string, job: never, now?: number) => { ok: boolean; reason: string; authorizationId?: string };
type AnyCommit = (document: Document, url: string, job: never, value: string, now?: number) =>
  { ok: boolean; reason: string; clicked: boolean } | Promise<{ ok: boolean; reason: string; clicked: boolean }>;

test("verifyLiveOffer enforces the order-total cap before any click (I8)", () => {
  const job = contract({ maxUnitPriceCents: 5_500, maxOrderTotalCents: 5_000 });
  const observation: LiveOfferObservation = {
    contractVersion: 1,
    observedAt: new Date(NOW).toISOString(),
    url: job.canonicalUrl,
    pageKind: "product",
    retailerId: "target",
    retailerSku: job.retailerSku,
    availability: "in_stock",
    unitPriceCents: 5_400,
    currency: "USD",
    sellerName: "Target",
    sellerType: "first_party",
    fulfillment: "shipping",
    addControlActionable: true,
    securityChallenge: false,
    interactiveBlock: ""
  };
  assert.deepEqual(verifyLiveOffer(job, observation, NOW), { ok: false, reason: "over_total_cap" });
  assert.equal(verifyLiveOffer({ ...job, maxOrderTotalCents: 5_400 }, observation, NOW).ok, true);
  assert.equal(verifyLiveOffer({ ...job, quantity: 2, maxOrderTotalCents: 10_000 }, observation, NOW).reason, "over_total_cap");
});

for (const lane of OLD_LANES) {
  test(`${lane.id}: an order-total cap below the live price refuses before the click`, () => {
    const prepare = lane.prepare as unknown as AnyPrepare;
    assert.equal(prepare(lane.document(), lane.url, lane.job() as never, NOW).ok, true, "the fixture prepares under the normal caps");
    assert.deepEqual(prepare(lane.document(), lane.url, lane.job({ maxOrderTotalCents: 1 }) as never, NOW), { ok: false, reason: "over_total_cap" });
  });

  test(`${lane.id}: commit refuses a changed job or a different document than the one prepared`, async () => {
    const prepare = lane.prepare as unknown as AnyPrepare;
    const commit = lane.commit as unknown as AnyCommit;
    // A cart add at these stores carries the server's MSRP proof for the fixture's own price.
    const price = Number((prepare(lane.document(), lane.url, lane.job() as never, NOW) as { proof?: { unitPriceCents?: number } }).proof?.unitPriceCents);
    assert.ok(Number.isSafeInteger(price) && price > 0, "the fixture prepares without a proof");
    const job = (overrides: Partial<BrowserActionContract> = {}) => lane.job({ maxUnitPriceCents: price, officialMsrp: {
      version: 1, evidenceId: `official_msrp_${"a".repeat(32)}`, evidenceHash: "b".repeat(64), listingIdentityHash: "c".repeat(64),
      retailerId: lane.id, retailerSku: lane.job().retailerSku, desiredVariant: "Standard single item", variantAttributes: {},
      msrpCents: price, unitPriceCents: price, currency: "USD", signalObservedAt: new Date(NOW - 1_000).toISOString(),
      expiresAt: new Date(NOW + 60_000).toISOString()
    }, ...overrides });
    const document = lane.document();
    let clicks = 0;
    document.addEventListener("click", () => { clicks += 1; }, true);
    const prepared = prepare(document, lane.url, job() as never, NOW);
    assert.equal(prepared.ok, true, prepared.reason);
    const changed = await commit(document, lane.url, job({ maxOrderTotalCents: 100_000 }) as never, String(prepared.authorizationId), NOW + 1);
    assert.deepEqual(changed, { ok: false, reason: "offer_binding_changed", clicked: false });

    const again = prepare(document, lane.url, job() as never, NOW);
    const otherDocument = await commit(lane.document(), lane.url, job() as never, String(again.authorizationId), NOW + 1);
    assert.deepEqual(otherDocument, { ok: false, reason: "offer_binding_changed", clicked: false });
    assert.equal(clicks, 0);
  });
}

test("Target refuses a product page whose quantity is not 1, or unreadable (EXT-RET-02)", () => {
  const lane = OLD_LANES[0];
  const cases: Record<string, string> = {
    select_two: "<select name='quantity'><option value='1'>1</option><option value='2' selected>2</option></select>",
    input_two: "<input name='quantity' value='2'>",
    picker_two: "<button data-test='custom-quantity-picker' aria-label='quantity 2'>Qty 2</button>",
    picker_unreadable: "<button data-test='custom-quantity-picker'>Choose</button>",
    stepper_only: "<button aria-label='Increase quantity'>+</button>"
  };
  for (const [name, html] of Object.entries(cases)) {
    const document = lane.document();
    document.querySelector("main")!.insertAdjacentHTML("afterbegin", html);
    const result = prepareTargetAdd(document, lane.url, lane.job() as never, NOW);
    assert.equal(result.ok, false, name);
  }
  for (const html of [
    "<select name='quantity'><option value='1' selected>1</option><option value='2'>2</option></select>",
    "<button data-test='custom-quantity-picker' aria-label='quantity 1'>Qty 1</button>",
    "<p data-test='quantityLimitMessage'>Limit 2 per guest</p>"
  ]) {
    const document = lane.document();
    document.querySelector("main")!.insertAdjacentHTML("afterbegin", html);
    assert.equal(prepareTargetAdd(document, lane.url, lane.job() as never, NOW).ok, true, html);
  }
});

test("Walmart refuses a DOM-bound offer whose quantity is not 1, including a stepper (EXT-RET-03)", () => {
  const lane = OLD_LANES[1];
  const cases: Record<string, string> = {
    select_two: "<select aria-label='Quantity'><option value='1'>1</option><option value='2' selected>2</option></select>",
    spinbutton_two: "<div role='spinbutton' aria-valuenow='2'>2</div>",
    stepper: "<button aria-label='Decrease quantity'>-</button><span>2 in cart</span><button aria-label='Increase quantity'>+</button>"
  };
  for (const [name, html] of Object.entries(cases)) {
    const document = lane.document();
    document.querySelector("[data-testid='buy-box']")!.insertAdjacentHTML("afterbegin", html);
    assert.equal(prepareWalmartAdd(document, lane.url, lane.job() as never, NOW).ok, false, name);
  }
  const one = lane.document();
  one.querySelector("[data-testid='buy-box']")!.insertAdjacentHTML("afterbegin",
    "<select aria-label='Quantity'><option value='1' selected>1</option><option value='2'>2</option></select>");
  assert.equal(prepareWalmartAdd(one, lane.url, lane.job() as never, NOW).ok, true);
});

test("the shared quantity reader parses anchored values and fails closed", () => {
  assert.equal(parseQuantityText("Qty 1"), 1);
  assert.equal(parseQuantityText("Quantity: 2"), 2);
  assert.equal(parseQuantityText("Quantity 100"), null);
  assert.equal(parseQuantityText("Quantity 1 of item 5"), null);
  const document = new JSDOM("<main><div id='a'></div></main>").window.document;
  const root = document.querySelector("main")!;
  assert.equal(quantityIsOne(root, [], () => true), true, "no quantity control adds the default single unit");
  root.innerHTML = "<input name='qty' value='abc'>";
  assert.equal(quantityIsOne(root, [], () => true), false);
});

test("Target and Walmart accept realistic single-unit quantity markup and still refuse other readings (FR-02)", () => {
  const target = OLD_LANES[0];
  const targetPasses: Record<string, string> = {
    select_in_wrapper_with_tcin: "<div data-test='quantity-picker'><select aria-label='Quantity'><option value='1' selected>1</option><option value='2'>2</option></select><input type='hidden' name='tcin' value='12345678'></div>",
    picker_chevron: "<button data-test='custom-quantity-picker' aria-label='Select quantity'>Qty 1 <span aria-hidden='true'>\u2304</span></button>",
    stepper_valuenow: "<div data-test='quantity-stepper'><button aria-label='Decrease quantity'>-</button><div role='spinbutton' aria-valuenow='1'>1</div><button aria-label='Increase quantity'>+</button></div>",
    empty_hidden_beside_one: "<input type='hidden' name='quantity' value=''><select name='quantity'><option value='1' selected>1</option></select>"
  };
  for (const [name, html] of Object.entries(targetPasses)) {
    const document = target.document();
    document.querySelector("main")!.insertAdjacentHTML("afterbegin", html);
    assert.equal(prepareTargetAdd(document, target.url, target.job() as never, NOW).ok, true, name);
  }
  const targetRefuses: Record<string, string> = {
    select_two_in_wrapper_with_tcin: "<div data-test='quantity-picker'><select aria-label='Quantity'><option value='1'>1</option><option value='2' selected>2</option></select><input type='hidden' name='tcin' value='12345678'></div>",
    picker_chevron_two: "<button data-test='custom-quantity-picker' aria-label='Select quantity'>Qty 2 <span aria-hidden='true'>\u2304</span></button>",
    picker_chevron_unreadable: "<button data-test='custom-quantity-picker' aria-label='Select quantity'>Qty <span aria-hidden='true'>\u2304</span></button>",
    stepper_valuenow_two: "<div data-test='quantity-stepper'><button aria-label='Decrease quantity'>-</button><div role='spinbutton' aria-valuenow='2'>2</div><button aria-label='Increase quantity'>+</button></div>",
    empty_hidden_alone: "<input type='hidden' name='quantity' value=''>",
    empty_hidden_beside_two: "<input type='hidden' name='quantity' value=''><select name='quantity'><option value='2' selected>2</option></select>"
  };
  for (const [name, html] of Object.entries(targetRefuses)) {
    const document = target.document();
    document.querySelector("main")!.insertAdjacentHTML("afterbegin", html);
    assert.equal(prepareTargetAdd(document, target.url, target.job() as never, NOW).ok, false, name);
  }

  const walmart = OLD_LANES[1];
  const walmartPasses: Record<string, string> = {
    select_one: "<select aria-label='Quantity'><option value='1' selected>1</option><option value='2'>2</option></select>",
    stepper_valuenow: "<div data-testid='quantity-stepper'><button aria-label='Decrease quantity'>-</button><input aria-label='Quantity' value='1' aria-valuenow='1'><button aria-label='Increase quantity'>+</button></div>",
    button_qty_one: "<button aria-label='Quantity 1, change quantity'>Qty 1</button>"
  };
  for (const [name, html] of Object.entries(walmartPasses)) {
    const document = walmart.document();
    document.querySelector("[data-testid='buy-box']")!.insertAdjacentHTML("afterbegin", html);
    assert.equal(prepareWalmartAdd(document, walmart.url, walmart.job() as never, NOW).ok, true, name);
  }
  for (const [name, html] of Object.entries({
    stepper_valuenow_two: "<div data-testid='quantity-stepper'><button aria-label='Decrease quantity'>-</button><input aria-label='Quantity' value='2' aria-valuenow='2'><button aria-label='Increase quantity'>+</button></div>",
    button_qty_two: "<button aria-label='Quantity 2, change quantity'>Qty 2</button>"
  })) {
    const document = walmart.document();
    document.querySelector("[data-testid='buy-box']")!.insertAdjacentHTML("afterbegin", html);
    assert.equal(prepareWalmartAdd(document, walmart.url, walmart.job() as never, NOW).ok, false, name);
  }
});

test("quantity text allows trailing decoration and stepper labels but never a second number (FR-02, FR-03)", () => {
  assert.equal(parseQuantityText("Qty 1 \u2304"), 1);
  assert.equal(parseQuantityText("Qty 1 Edit"), 1);
  assert.equal(parseQuantityText("Quantity 100"), null);
  assert.equal(parseQuantityText("Qty 1 of 5"), null);
  assert.equal(parseStepperText("Decrease quantity 1 Increase quantity"), 1);
  assert.equal(parseStepperText("- 2 +"), 2);
  assert.equal(parseStepperText("Decrease quantity Increase quantity"), null);
  assert.equal(parseStepperText("Quantity 100"), null);
});

test("the price parser skips was, save, list and per-unit prices and refuses disagreement (EXT-RET-08)", () => {
  const element = (html: string) => new JSDOM(`<body>${html}</body>`).window.document.body.firstElementChild!;
  assert.equal(parseRetailerPriceElement(element("<div><span class='strike'>$59.99</span><span>$49.99</span></div>")), 4999);
  assert.equal(parseRetailerPriceElement(element("<div><span><s>$59.99</s></span><span>$49.99</span></div>")), 4999);
  assert.equal(parseRetailerPriceElement(element("<div><span data-testid='was-price'>$59.99</span><span>$49.99</span></div>")), 4999);
  assert.equal(parseRetailerPriceElement(element("<div><span>You save $5.00</span><span>$49.99</span></div>")), 4999);
  assert.equal(parseRetailerPriceElement(element("<div><span>$0.42/oz</span><span>$49.99</span></div>")), 4999);
  assert.equal(parseRetailerPriceElement(element("<div><span>Was $59.99</span><span>Now $49.99</span></div>")), 4999);
  assert.equal(parseRetailerPriceElement(element("<div><span>$49.99</span><span>$44.99</span></div>")), null, "two live-looking prices are ambiguous");
  assert.equal(parseRetailerPriceElement(element("<div><span>$44</span><sup>99</sup></div>")), 4499, "split dollars and cents still parse");
  const amazon = element(`<div id="corePrice_feature_div">
    <span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">$59.99</span></span>
    <span class="a-price priceToPay"><span class="a-offscreen">$49.99</span></span>
    <span class="a-price a-text-price"><span class="a-offscreen">$0.42</span></span>
  </div>`);
  assert.equal(parseRetailerPriceElement(amazon), 4999);
  assert.equal(parseRetailerPriceElement(amazon.querySelector("[data-a-strike] .a-offscreen")!), null, "a struck offscreen price is never a candidate");
  assert.equal(parseRetailerPriceElement(element("<span class='a-price a-text-price apexPriceToPay'><span class='a-offscreen'>$49.99</span></span>")), 4999);
});

test("the price parser reads common sale layouts and stays null only when genuinely ambiguous (FR-01)", () => {
  const element = (html: string) => new JSDOM(`<body>${html}</body>`).window.document.body.firstElementChild!;
  const layouts: Record<string, [string, number]> = {
    amazon_strike: [`<div class="a-section"><span class="a-price aok-align-center priceToPay"><span class="a-offscreen">$29.99</span><span aria-hidden="true"><span class="a-price-symbol">$</span><span class="a-price-whole">29<span class="a-price-decimal">.</span></span><span class="a-price-fraction">99</span></span></span><span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">$39.99</span></span></div>`, 2999],
    walmart_strike_unit: [`<div data-testid="price-wrap"><span itemprop="price">Now $19.97</span><span class="gray mr1 strike">$24.99</span><div>$0.50/oz</div></div>`, 1997],
    tailwind_line_through: [`<div><span>$19.97</span><span class="text-gray line-through">$24.99</span></div>`, 1997],
    bestbuy_comp_value: [`<div class="priceView-hero-price"><span aria-hidden="true">$199.99</span><div class="pricing-price__regular-price">Comp. Value $249.99</div></div>`, 19999],
    bestbuy_comp_value_plain_class: [`<div><span>$199.99</span><div>Comp. Value $249.99</div></div>`, 19999],
    bestbuy_was: [`<div class="priceView-hero-price"><span aria-hidden="true">$199.99</span><span class="sr-only">Your price for this item is $199.99</span><div class="pricing-price__regular-price">Was $249.99</div></div>`, 19999],
    target_reg: [`<div data-module-type="ProductDetailPrice"><span data-test="product-price">$24.99</span><span data-test="product-regular-price">reg $29.99</span></div>`, 2499],
    target_sale: [`<div data-module-type="ProductDetailPrice"><span data-test="product-price">$24.99</span><div>Sale</div><span class="h-text-grayDark">When purchased online</span></div>`, 2499],
    plain: [`<span>$59.99</span>`, 5999],
    split: [`<span><span>$</span><span>119</span><sup>95</sup></span>`, 11995],
    dollars_off: [`<div><span>$24.99</span><span>$5.00 off</span></div>`, 2499],
    msrp: [`<div><span>$24.99</span><span>MSRP $29.99</span></div>`, 2499],
    compare_at: [`<div><span>$24.99</span><span>Compare at $29.99</span></div>`, 2499],
    original_class: [`<div><span>$24.99</span><span class="price-original">$29.99</span></div>`, 2499],
    structured_itemprop_tiebreak: [`<div><span itemprop="price" content="19.97">$19.97</span><span>$24.99</span></div>`, 1997],
    structured_price_to_pay_tiebreak: [`<div><span class="priceToPay">$19.97</span><span class="a-size-small">$24.99</span></div>`, 1997],
    structured_current_price_tiebreak: [`<div><span data-testid="current-price">$19.97</span><span>$24.99</span></div>`, 1997]
  };
  for (const [name, [html, cents]] of Object.entries(layouts)) {
    assert.equal(parseRetailerPriceElement(element(html)), cents, name);
  }
  // Genuinely ambiguous: two unmarked prices, or two structured markers that disagree.
  assert.equal(parseRetailerPriceElement(element(`<div><span>$19.97</span><span>$24.99</span></div>`)), null);
  assert.equal(parseRetailerPriceElement(element(`<div><span itemprop="price">$19.97</span><span class="priceToPay">$24.99</span></div>`)), null);
  // The strike/MSRP value is never picked even when it is the only price.
  assert.equal(parseRetailerPriceElement(element(`<span class="line-through">$24.99</span>`)), null);
  assert.equal(parseRetailerPriceElement(element(`<div><span class="text-gray line-through">$24.99</span><span>MSRP $29.99</span></div>`)), null);
});

test("cart rows read unit prices and anchored quantities (EXT-RET-09, EXT-RET-19)", () => {
  const walmart = new JSDOM(`<main><div data-testid="cart-item" data-us-item-id="17354421975">
    <div data-testid="line-price">$89.98</div>
    <select aria-label="Quantity"><option value="1">1</option><option value="2" selected>2</option></select>
  </div></main>`, { url: "https://www.walmart.com/cart" }).window.document;
  assert.deepEqual(observeWalmartCart(walmart, new Date(NOW).toISOString()).lines.map((line) => [line.quantity, line.unitPriceCents]), [[2, 4499]]);
  const walmartOdd = new JSDOM(`<main><div data-testid="cart-item" data-us-item-id="17354421975">
    <div data-testid="line-price">$89.97</div><input aria-label="Quantity" value="2">
  </div></main>`, { url: "https://www.walmart.com/cart" }).window.document;
  assert.equal(observeWalmartCart(walmartOdd, new Date(NOW).toISOString()).lines[0]?.unitPriceCents, 4499, "odd cents round up, never down");
  const hundred = new JSDOM(`<main><div data-testid="cart-item" data-us-item-id="17354421975">
    <div data-automation-id="product-price">$44.99</div><span data-testid="quantity-label">Quantity 100</span>
  </div></main>`, { url: "https://www.walmart.com/cart" }).window.document;
  assert.equal(observeWalmartCart(hundred, new Date(NOW).toISOString()).lines[0]?.quantity, null);
  const target = new JSDOM(`<main><div data-test="cart-item" data-tcin="1011483414">
    <span data-test="unit-price">$59.99</span><span data-test="item-quantity">Qty 100</span>
  </div></main>`, { url: "https://www.target.com/cart" }).window.document;
  assert.equal(observeTargetCart(target, new Date(NOW).toISOString()).lines[0]?.quantity, null);

  // FR-03: steppers read their value or the lone number between the labels.
  const walmartLine = (quantity: string) => new JSDOM(`<main><div data-testid="cart-item" data-us-item-id="17354421975">
    <div data-automation-id="product-price">$44.99</div>${quantity}
  </div></main>`, { url: "https://www.walmart.com/cart" }).window.document;
  const walmartQuantity = (quantity: string) => observeWalmartCart(walmartLine(quantity), new Date(NOW).toISOString()).lines[0]?.quantity;
  assert.equal(walmartQuantity(`<div data-testid="quantity-stepper"><button><span class="sr-only">Decrease quantity</span></button> <span>1</span> <button><span class="sr-only">Increase quantity</span></button></div>`), 1);
  assert.equal(walmartQuantity(`<div data-testid="quantity-stepper"><button aria-label="Decrease quantity">-</button><span>2</span><button aria-label="Increase quantity">+</button></div>`), 2);
  assert.equal(walmartQuantity(`<div data-testid="quantity-stepper" aria-valuenow="3">Decrease quantity 3 Increase quantity</div>`), 3);
  assert.equal(walmartQuantity(`<div data-testid="quantity-stepper"><button aria-label="Decrease quantity">-</button><input aria-label="Qty" value="2"><button aria-label="Increase quantity">+</button></div>`), 2);
  assert.equal(walmartQuantity(`<div data-testid="quantity-stepper">Decrease quantity 100 Increase quantity</div>`), null);
  const targetLine = (quantity: string) => new JSDOM(`<main><div data-test="cart-item" data-tcin="1011483414">
    <span data-test="unit-price">$59.99</span>${quantity}
  </div></main>`, { url: "https://www.target.com/cart" }).window.document;
  const targetQuantity = (quantity: string) => observeTargetCart(targetLine(quantity), new Date(NOW).toISOString()).lines[0]?.quantity;
  assert.equal(targetQuantity(`<div data-test="cartItem-quantity-stepper"><button>Decrease quantity</button> 1 <button>Increase quantity</button></div>`), 1);
  assert.equal(targetQuantity(`<button data-test="cartItem-quantity">Qty 1 Edit</button>`), 1);
  assert.equal(targetQuantity(`<div data-test="cartItem-quantity"><select aria-label="Quantity"><option value="2" selected>2</option></select><input type="hidden" name="tcin" value="1011483414"></div>`), 2);
  assert.equal(targetQuantity(`<span data-test="item-quantity">Quantity 100</span>`), null);

  // AE shows a line total. 2 units at 10% off leave odd cents; the unit price
  // rounds up instead of refusing the whole cart.
  const ae = new JSDOM(`<body><a class="qa-tnav-bag-icon"><span data-test-content>2</span></a>
    <div class="cart-item" data-sku-id="0045503992" data-product-id="0427_9775_410">
      <a class="product-link" href="/us/en/p/0427_9775_410">Tote</a>
      <span data-testid="quantity">Qty: 2</span><span data-test-cart-item-price>$44.91</span>
    </div></body>`, { url: "https://www.ae.com/us/en/cart" }).window.document;
  const inventory = observeAmericanEagleCart(ae, new Date(NOW).toISOString());
  assert.equal(inventory.complete, true);
  assert.deepEqual(inventory.lines.map((line) => [line.quantity, line.unitPriceCents]), [[2, 2246]]);
});

test("Pokémon Center re-checks the page URL against the job before prepare (EXT-RET-05)", () => {
  const html = readFileSync(join(RETAILERS, "pokemoncenter-add-product.html"), "utf8");
  const url = "https://www.pokemoncenter.com/product/10-10320-101/binder";
  const other = "https://www.pokemoncenter.com/product/10-10320-102/binder";
  const job: PokemonCenterAddJob = {
    adapterVersion: POKEMONCENTER_ADD_ADAPTER_VERSION, contractVersion: 1, jobId: "job_pokemoncenter_invariants",
    retailerId: "pokemoncenter", retailerSku: "10-10320-101", canonicalUrl: url, action: "add_to_cart" as const,
    quantity: 1, maxUnitPriceCents: 2999, maxOrderTotalCents: 2999, currency: "USD",
    sellerPolicy: "first_party_only" as const, expectedSeller: "Pokémon Center", fulfillment: "shipping" as const,
    expiresAt: new Date(NOW + 60_000).toISOString()
  };
  const document = new JSDOM(html, { url: other }).window.document;
  assert.deepEqual(preparePokemonCenterAdd(document, other, job, NOW), { ok: false, reason: "listing_mismatch" });
  const struck = new JSDOM(html.replace("$29.99</p>", "$29.99 <s>$39.99</s></p>"), { url }).window.document;
  assert.equal(preparePokemonCenterAdd(struck, url, job, NOW).ok, true, "a struck was-price does not change the live price");
  assert.deepEqual(preparePokemonCenterAdd(new JSDOM(html, { url }).window.document, url, { ...job, maxOrderTotalCents: 2998 }, NOW),
    { ok: false, reason: "over_total_cap" });
});

test("no shipped extension bundle carries an Amazon Buy Now checkout route (EXT-RET-14)", () => {
  const root = join(process.cwd(), "apps", "extension");
  const bundles = readdirSync(root).filter((name) => name.endsWith(".js"));
  assert.ok(bundles.length > 5);
  for (const name of bundles) {
    assert.doesNotMatch(readFileSync(join(root, name), "utf8"), /checkout\/entry\/buynow/i, name);
  }
});

test("the selector-pack lint rejects checkout tokens in #id and .class selectors (EXT-RET-15)", () => {
  const packRoot = mkdtempSync(join(tmpdir(), "yoink-lint-tokens-"));
  try {
    for (const name of readdirSync(join(process.cwd(), "packages", "browser-adapters", "packs"))) {
      copyFileSync(join(process.cwd(), "packages", "browser-adapters", "packs", name), join(packRoot, name));
    }
    assert.doesNotThrow(() => lintSelectorPacks({ packRoot }));
    for (const selector of ["button#placeOrderButton", ".checkout-btn", "div.payment-options button"]) {
      const pack = JSON.parse(readFileSync(join(process.cwd(), "packages", "browser-adapters", "packs", "target.json"), "utf8"));
      pack.fields.addControl.selectors = [selector];
      writeFileSync(join(packRoot, "target.json"), JSON.stringify(pack));
      assert.throws(() => lintSelectorPacks({ packRoot }), /forbidden #id or \.class token/, selector);
    }
  } finally {
    rmSync(packRoot, { recursive: true, force: true });
  }
});
