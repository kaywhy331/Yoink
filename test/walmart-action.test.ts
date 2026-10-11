import { reviewedBrowserJobFixture } from "./helpers/official-msrp-browser.js";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import { WALMART_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import {
  commitWalmartAdd,
  inspectWalmartCartBaseline,
  prepareWalmartAdd,
  raiseWalmartCartQuantity,
  rehearseWalmartAdd,
  selectWalmartShipping,
  type WalmartAddJob,
  verifyWalmartAddedCart
} from "../apps/extension/src/walmart-action.js";
import { observeWalmartCart, observeWalmartOffer } from "../packages/browser-adapters/src/walmart.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } } };
const RETAILER_FIXTURES = join(process.cwd(), "test", "fixtures", "retailers");
const WALMART_FIXTURES = join(process.cwd(), "test", "fixtures", "walmart");
const PRODUCT_URL = "https://www.walmart.com/ip/fixture/17354421975";
const CART_URL = "https://www.walmart.com/cart";
const NOW = new Date("2026-08-23T16:00:00.000Z").getTime();

function product(): Document {
  return new JSDOM(readFileSync(join(RETAILER_FIXTURES, "walmart-first-party.html"), "utf8"), { url: PRODUCT_URL }).window.document;
}

function semanticDriftProduct(): Document {
  const document = product();
  const price = document.querySelector("[data-automation-id='product-price']");
  price?.removeAttribute("data-automation-id");
  price?.setAttribute("data-testid", "commerce-amount");
  const control = document.querySelector("button[data-automation-id='atc']");
  control?.removeAttribute("data-automation-id");
  control?.setAttribute("data-button-state", "primary-cart-action");
  return document;
}

function pickupProduct(): Document {
  const document = product();
  const fulfillment = document.querySelector("[aria-selected='true']");
  if (fulfillment) fulfillment.textContent = "Pickup at your selected store — ready today";
  return document;
}

function structuredProduct(): Document {
  const offerId = "E3FEC929BA58303AA09F92D2712898BD";
  const productState = {
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
    }]
  };
  return new JSDOM(`<body><main>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { initialData: { data: { product: productState } } } }
    })}</script>
    <section data-testid="add-to-cart-section"><button data-automation-id="atc">Add to cart</button></section>
  </main></body>`, { url: "https://www.walmart.com/ip/fixture/20895014480" }).window.document;
}

function job(overrides: Partial<WalmartAddJob> = {}): WalmartAddJob {
  const base: BrowserActionContract = {
    contractVersion: 1,
    jobId: "job_walmart_add_fixture",
    retailerId: "walmart",
    retailerSku: "17354421975",
    canonicalUrl: PRODUCT_URL,
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: 4499,
    maxOrderTotalCents: 4500,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Walmart",
    fulfillment: "shipping",
    expiresAt: new Date(NOW + 60_000).toISOString()
  };
  return reviewedBrowserJobFixture({ ...base, adapterVersion: WALMART_ADD_ADAPTER_VERSION, ...overrides }, NOW);
}

test("Walmart rehearsal reaches the exact no-click boundary and virtual queues fail closed", () => {
  const document = product();
  let clicks = 0;
  document.querySelector("button")?.addEventListener("click", () => { clicks += 1; });
  const result = rehearseWalmartAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.wouldClick, true);
  assert.equal(clicks, 0);

  const queued = product();
  queued.body.insertAdjacentHTML("afterbegin", "<div role='dialog'>You’re in line in our virtual queue</div>");
  assert.deepEqual(rehearseWalmartAdd(queued, PRODUCT_URL, job(), NOW), {
    ok: false,
    reason: "manual_action_required"
  });
});

test("Walmart v8 rehearses a split current page from its exact selected offer state", () => {
  const url = "https://www.walmart.com/ip/fixture/20895014480";
  const document = structuredProduct();
  let clicks = 0;
  document.querySelector("button[data-automation-id='atc']")?.addEventListener("click", () => { clicks += 1; });
  const exactJob = job({
    retailerSku: "20895014480",
    canonicalUrl: url,
    maxUnitPriceCents: 3997,
    maxOrderTotalCents: 3997
  });
  const result = rehearseWalmartAdd(document, url, exactJob, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.wouldClick, true);
  assert.equal(clicks, 0);
});

test("Walmart add consumes its authorization before one click and revalidates the offer", () => {
  const document = product();
  let clicks = 0;
  document.querySelector("button")?.addEventListener("click", () => { clicks += 1; });
  const prepared = prepareWalmartAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = commitWalmartAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(committed.clicked, true);
  assert.equal(clicks, 1);
  assert.deepEqual(commitWalmartAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 200), {
    ok: false,
    reason: "authorization_missing",
    clicked: false
  });
  assert.equal(clicks, 1);

  const changed = product();
  const changedPreparation = prepareWalmartAdd(changed, PRODUCT_URL, job(), NOW);
  assert.equal(changedPreparation.ok, true);
  if (!changedPreparation.ok) return;
  const price = changed.querySelector("[data-automation-id='product-price']");
  if (price) price.textContent = "$144.99";
  assert.deepEqual(commitWalmartAdd(changed, PRODUCT_URL, job(), changedPreparation.authorizationId, NOW + 100), {
    ok: false,
    reason: "listed_price_changed",
    clicked: false
  });
});

test("Walmart safely self-heals unique control and price selector drift", () => {
  const document = semanticDriftProduct();
  const control = document.querySelector("[data-button-state='primary-cart-action']");
  assert.ok(control);
  let clicks = 0;
  control.addEventListener("click", () => { clicks += 1; });
  const rehearsal = rehearseWalmartAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(rehearsal.ok, true);
  assert.equal(clicks, 0);
  const prepared = prepareWalmartAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = commitWalmartAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(clicks, 1);

  const ambiguous = semanticDriftProduct();
  const duplicate = ambiguous.querySelector("[data-button-state='primary-cart-action']")?.cloneNode(true);
  if (duplicate) ambiguous.querySelector("[data-testid='buy-box']")?.append(duplicate);
  assert.equal(prepareWalmartAdd(ambiguous, PRODUCT_URL, job(), NOW).ok, false);
});

test("Walmart guarded Add accepts exact Shipping and rejects Pickup quantity-one jobs", () => {
  assert.equal(prepareWalmartAdd(product(), PRODUCT_URL, job({ quantity: 11 }), NOW).reason, "quantity_not_supported");
  assert.equal(prepareWalmartAdd(product(), PRODUCT_URL, job({ quantity: 0 }), NOW).reason, "quantity_not_supported");
  assert.equal(prepareWalmartAdd(product(), PRODUCT_URL, job({ quantity: 2 }), NOW).reason, "over_total_cap");
  assert.equal(prepareWalmartAdd(product(), PRODUCT_URL, job({ action: "prepare_checkout" }), NOW).reason, "unsupported_action");
  assert.equal(prepareWalmartAdd(product(), PRODUCT_URL, job({ sellerPolicy: "allow_third_party" }), NOW).reason, "seller_policy_not_supported");
  assert.equal(prepareWalmartAdd(product(), PRODUCT_URL, job({ fulfillment: "either" }), NOW).reason, "fulfillment_not_supported");
  assert.equal(prepareWalmartAdd(product(), PRODUCT_URL, job({ fulfillment: "pickup" }), NOW).ok, false);

  const pickup = pickupProduct();
  let clicks = 0;
  pickup.querySelector("button")?.addEventListener("click", () => { clicks += 1; });
  const pickupJob = job({ fulfillment: "pickup" });
  const prepared = prepareWalmartAdd(pickup, PRODUCT_URL, pickupJob, NOW);
  assert.deepEqual(prepared, { ok: false, reason: "official_msrp_cart_policy_invalid" });
  assert.equal(commitWalmartAdd(pickup, PRODUCT_URL, pickupJob, "no_authorization", NOW + 100).ok, false);
  assert.equal(clicks, 0);
});

test("Walmart cart preflight captures a bounded baseline and post-add proof requires an exact delta", () => {
  const empty = new JSDOM("<body><main><h1>Your cart is empty</h1></main></body>", { url: CART_URL }).window.document;
  const baseline = inspectWalmartCartBaseline(empty, CART_URL, NOW);
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  assert.deepEqual(baseline.proof.lines, []);
  const cart = new JSDOM(readFileSync(join(WALMART_FIXTURES, "cart.html"), "utf8"), { url: CART_URL }).window.document;
  const existing = inspectWalmartCartBaseline(cart, CART_URL, NOW);
  assert.equal(existing.ok, true);
  if (!existing.ok) return;
  assert.equal(existing.proof.lineCount, 1);
  const prepared = prepareWalmartAdd(product(), PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const verified = verifyWalmartAddedCart(cart, CART_URL, job(), prepared.proof, baseline.proof, NOW + 500);
  assert.equal(verified.ok, true);
});

// Walmart item 17354421975 (Disney Lorcana Fabled sleeved booster). Both
// fixtures carry product fields copied from the real page state captured
// 2026-10-10: condition "Collectible" group 4, code 401001 "New", orderLimit 0,
// and Walmart's sponsored "buy-box-ad" tile with its own Add to cart.
const LORCANA_URL = "https://www.walmart.com/ip/disney-lorcana-fabled-sleeved-booster/17354421975";
type ProductState = Record<string, any>;

function lorcana(state: "in-stock" | "out-of-stock", edit?: (product: ProductState) => void): Document {
  const document = new JSDOM(readFileSync(join(WALMART_FIXTURES, `product-collectible-${state}.html`), "utf8"), { url: LORCANA_URL })
    .window.document;
  if (edit) {
    const script = document.querySelector("script#__NEXT_DATA__");
    const root = JSON.parse(script?.textContent || "{}");
    edit(root.props.pageProps.initialData.data.product);
    if (script) script.textContent = JSON.stringify(root);
  }
  return document;
}

function lorcanaJob(overrides: Partial<WalmartAddJob> = {}): WalmartAddJob {
  return job({ canonicalUrl: "https://www.walmart.com/ip/17354421975", maxUnitPriceCents: 587, maxOrderTotalCents: 3672,
    expectedSeller: "", ...overrides });
}

function countClicks(document: Document): { real: () => number; sponsored: () => number; any: () => number } {
  let real = 0;
  let sponsored = 0;
  let any = 0;
  document.querySelector("[data-testid='add-to-cart-section'] button")?.addEventListener("click", () => { real += 1; });
  document.querySelector("[data-testid='buy-box-ad'] button")?.addEventListener("click", () => { sponsored += 1; });
  for (const button of document.querySelectorAll("button")) button.addEventListener("click", () => { any += 1; });
  return { real: () => real, sponsored: () => sponsored, any: () => any };
}

test("Walmart binds an in-stock collectible from its page state: Collectible New, no order limit, past the sponsored Add", () => {
  const document = lorcana("in-stock");
  const observation = observeWalmartOffer(document, LORCANA_URL, "17354421975", "shipping", new Date(NOW).toISOString());
  assert.deepEqual({
    availability: observation.availability,
    price: observation.unitPriceCents,
    seller: observation.sellerName,
    sellerType: observation.sellerType,
    fulfillment: observation.fulfillment,
    actionable: observation.addControlActionable,
    selection: observation.selectedOffer?.selectionState
  }, {
    availability: "in_stock",
    price: 587,
    seller: "Walmart",
    sellerType: "first_party",
    fulfillment: "shipping",
    actionable: true,
    selection: "exact"
  });
  const clicks = countClicks(document);
  const prepared = prepareWalmartAdd(document, LORCANA_URL, lorcanaJob(), NOW);
  assert.equal(prepared.ok, true, prepared.reason);
  if (!prepared.ok) return;
  assert.equal("quantity" in prepared, false, "a single unit keeps today's result");
  const committed = commitWalmartAdd(document, LORCANA_URL, lorcanaJob(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.deepEqual([clicks.real(), clicks.sponsored()], [1, 0]);

  for (const [name, edit] of Object.entries({
    order_limit_null: (product: ProductState) => { product.orderLimit = null; },
    shipping_limits_zero: (product: ProductState) => { product.fulfillmentOptions[0].maxOrderQuantity = 0; product.fulfillmentOptions[0].orderLimit = 0; },
    plain_new: (product: ProductState) => { product.conditionOffers[0].condition = { groupCode: 1 }; }
  })) {
    assert.equal(prepareWalmartAdd(lorcana("in-stock", edit), LORCANA_URL, lorcanaJob(), NOW).ok, true, name);
  }
});

test("Walmart still refuses pre-owned, restored, graded and unreadable-limit offers, and says why", () => {
  const refused: Record<string, (product: ProductState) => void> = {
    collectible_like_new: (product) => { product.conditionOffers[0].condition = { code: 401002, text: "Like New", groupCode: 4, groupText: "Collectible" }; },
    collectible_new_text_other_code: (product) => { product.conditionOffers[0].condition = { code: 401005, text: "New", groupCode: 4, groupText: "Collectible" }; },
    collectible_offer_not_new: (product) => { product.conditionOffers[0].isConditionNew = false; },
    collectible_preowned: (product) => { product.isPreowned = true; },
    page_not_new: (product) => { product.isConditionNew = false; },
    pre_owned_group: (product) => { product.conditionOffers[0].condition = { groupCode: 3, text: "Pre-Owned" }; },
    restored_group: (product) => { product.conditionOffers[0].condition = { groupCode: 2, text: "Restored" }; },
    negative_limit: (product) => { product.orderLimit = -1; },
    fractional_limit: (product) => { product.orderLimit = 2.5; },
    text_limit: (product) => { product.fulfillmentOptions[0].maxOrderQuantity = "ten"; }
  };
  for (const [name, edit] of Object.entries(refused)) {
    const document = lorcana("in-stock", edit);
    const clicks = countClicks(document);
    const observation = observeWalmartOffer(document, LORCANA_URL, "17354421975", "shipping", new Date(NOW).toISOString());
    assert.equal(observation.availability, "unknown", name);
    assert.deepEqual(prepareWalmartAdd(document, LORCANA_URL, lorcanaJob(), NOW), { ok: false, reason: "add_control_unavailable" }, name);
    assert.equal(clicks.any(), 0, name);
  }
});

test("Walmart reports a page it could not bind as add_control_unavailable, never out_of_stock", () => {
  const loading = lorcana("in-stock");
  loading.querySelector("[data-testid='add-to-cart-section'] button")?.remove();
  assert.deepEqual(prepareWalmartAdd(loading, LORCANA_URL, lorcanaJob(), NOW), { ok: false, reason: "add_control_unavailable" });

  const noState = lorcana("in-stock");
  noState.querySelector("script#__NEXT_DATA__")?.remove();
  assert.deepEqual(prepareWalmartAdd(noState, LORCANA_URL, lorcanaJob(), NOW), { ok: false, reason: "add_control_unavailable" });

  const rerendered = lorcana("in-stock");
  const clicks = countClicks(rerendered);
  const prepared = prepareWalmartAdd(rerendered, LORCANA_URL, lorcanaJob(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  rerendered.querySelector("[data-testid='add-to-cart-section'] button")?.remove();
  assert.deepEqual(commitWalmartAdd(rerendered, LORCANA_URL, lorcanaJob(), prepared.authorizationId, NOW + 100),
    { ok: false, reason: "add_control_unavailable", clicked: false });
  assert.equal(clicks.any(), 0);
});

test("the captured out-of-stock Walmart page still stops without a click, and reads out of stock behind the overlay", () => {
  const captured = lorcana("out-of-stock");
  const clicks = countClicks(captured);
  assert.deepEqual(prepareWalmartAdd(captured, LORCANA_URL, lorcanaJob(), NOW), { ok: false, reason: "manual_action_required" });
  assert.deepEqual(prepareWalmartAdd(captured, LORCANA_URL, lorcanaJob({ quantity: 3 }), NOW), { ok: false, reason: "manual_action_required" });

  const unchallenged = lorcana("out-of-stock");
  unchallenged.querySelector("[data-testid='dialog-modal']")?.remove();
  unchallenged.querySelector("[data-testid='layout-container']")?.removeAttribute("aria-hidden");
  const unchallengedClicks = countClicks(unchallenged);
  assert.equal(observeWalmartOffer(unchallenged, LORCANA_URL, "17354421975", "shipping", new Date(NOW).toISOString()).availability, "out_of_stock");
  assert.deepEqual(prepareWalmartAdd(unchallenged, LORCANA_URL, lorcanaJob(), NOW), { ok: false, reason: "out_of_stock" });
  assert.deepEqual([clicks.any(), unchallengedClicks.any()], [0, 0]);
});

test("Walmart plans a quantity above one: Add puts one in the cart and the cart is raised, never past the store's limit", () => {
  const plan = (document: Document, quantity: number) => {
    const prepared = prepareWalmartAdd(document, LORCANA_URL, lorcanaJob({ quantity }), NOW);
    return prepared.ok ? prepared.quantity : prepared.reason;
  };
  assert.deepEqual(plan(lorcana("in-stock"), 3), { requested: 3, storeLimit: null, add: 1, raiseTo: 3 });
  assert.deepEqual(plan(lorcana("in-stock", (product) => { product.orderLimit = 2; }), 3),
    { requested: 3, storeLimit: 2, add: 1, raiseTo: 2 });
  assert.deepEqual(plan(lorcana("in-stock", (product) => {
    product.orderLimit = 6;
    product.fulfillmentOptions[0].maxOrderQuantity = 4;
  }), 5), { requested: 5, storeLimit: 4, add: 1, raiseTo: 4 });
  assert.deepEqual(plan(lorcana("in-stock", (product) => { product.orderLimit = 12; }), 3),
    { requested: 3, storeLimit: 12, add: 1, raiseTo: 3 });
  const noted = lorcana("in-stock");
  noted.querySelector("[data-testid='add-to-cart-section']")?.insertAdjacentHTML("beforeend", "<p>Limit 2 per order</p>");
  assert.deepEqual(plan(noted, 4), { requested: 4, storeLimit: 2, add: 1, raiseTo: 2 });
  assert.equal(plan(lorcana("in-stock"), 11), "quantity_not_supported");
  assert.equal(prepareWalmartAdd(lorcana("in-stock"), LORCANA_URL, lorcanaJob({ quantity: 7 }), NOW).reason, "over_total_cap");

  const document = lorcana("in-stock");
  const clicks = countClicks(document);
  const rehearsal = rehearseWalmartAdd(document, LORCANA_URL, lorcanaJob({ quantity: 3 }), NOW);
  assert.equal(rehearsal.ok && rehearsal.quantity?.raiseTo, 3);
  const prepared = prepareWalmartAdd(document, LORCANA_URL, lorcanaJob({ quantity: 3 }), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = commitWalmartAdd(document, LORCANA_URL, lorcanaJob({ quantity: 3 }), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.deepEqual([clicks.real(), clicks.sponsored()], [1, 0], "Add is clicked once; the rest is raised in the cart");
});

interface CartLineSpec {
  sku: string;
  title: string;
  quantity: number;
  limit?: number;
  step?: number;
  control?: "stepper" | "select";
}

// A Walmart cart whose lines answer like the store: "+" is disabled while the
// change saves, then the line shows the new quantity in its stepper labels.
function cart(lines: CartLineSpec[]) {
  const document = new JSDOM(`<!doctype html><body><main><h1>Cart</h1>${lines.map((line, index) => `
    <div data-testid="cart-item" data-us-item-id="${line.sku}" id="line-${index}">
      <a href="/ip/item/${line.sku}">${line.title}</a>
      <div data-testid="line-price"></div>
      <p data-testid="seller-display-name">Sold and shipped by Walmart.com</p>
      ${line.control === "select"
        ? `<select aria-label="Quantity">${Array.from({ length: line.limit ?? 12 }, (_, value) => `<option value="${value + 1}">${value + 1}</option>`).join("")}</select>`
        : `<div class="flex items-center"><button type="button" class="minus"><i></i></button><span aria-hidden="true" class="shown"></span><button type="button" class="plus"><i></i></button></div>`}
      <button type="button" class="remove">Remove</button><button type="button" class="save">Save for later</button>
    </div>`).join("")}</main></body>`, { url: CART_URL }).window.document;
  const clicks = new Map<string, number>();
  const forbidden: string[] = [];
  const changes = new Map<string, number>();
  lines.forEach((spec, index) => {
    const line = document.getElementById(`line-${index}`);
    if (!line) return;
    let quantity = spec.quantity;
    const render = () => {
      const price = line.querySelector("[data-testid='line-price']");
      if (price) price.textContent = `$${((587 * quantity) / 100).toFixed(2)}`;
      if (spec.control === "select") {
        const select = line.querySelector("select");
        if (select) select.value = String(quantity);
        return;
      }
      const shown = line.querySelector(".shown");
      if (shown) shown.textContent = String(quantity);
      line.querySelector(".minus")?.setAttribute("aria-label", `Decrease quantity of ${spec.title}, Current Quantity ${quantity}`);
      const plus = line.querySelector(".plus");
      plus?.setAttribute("aria-label", `Increase quantity of ${spec.title}, Current Quantity ${quantity}`);
      if (spec.limit !== undefined && quantity >= spec.limit) plus?.setAttribute("disabled", "");
      else plus?.removeAttribute("disabled");
    };
    render();
    line.querySelector(".plus")?.addEventListener("click", () => {
      clicks.set(spec.sku, (clicks.get(spec.sku) ?? 0) + 1);
      line.querySelector(".plus")?.setAttribute("disabled", "");
      setTimeout(() => { quantity += spec.step ?? 1; render(); }, 15);
    });
    line.querySelector("select")?.addEventListener("change", (event) => {
      changes.set(spec.sku, (changes.get(spec.sku) ?? 0) + 1);
      quantity = Number((event.target as HTMLSelectElement).value);
      setTimeout(render, 15);
    });
    for (const selector of [".minus", ".remove", ".save"]) {
      line.querySelector(selector)?.addEventListener("click", () => { forbidden.push(`${spec.sku}${selector}`); });
    }
  });
  return { document, clicks, forbidden, changes };
}

const LORCANA = { sku: "17354421975", title: "RB DISNEY LORCANA SET 9 BLISTER" };
const RIFTBOUND = { sku: "19637522232", title: "Riftbound Unleashed Booster" };
const FAST = { stepWaitMs: 300, totalMs: 4_000, pollMs: 5 };
const cartQuantity = (document: Document, sku: string) => observeWalmartCart(document, new Date().toISOString())
  .lines.find((line) => line.retailerSku === sku)?.quantity;

test("Walmart's cart reader reads stepper quantities 1 to 99 from the line's own labels", () => {
  for (const quantity of [1, 2, 9, 12, 99]) {
    const { document } = cart([{ ...LORCANA, quantity }]);
    assert.equal(cartQuantity(document, LORCANA.sku), quantity);
  }
  const { document } = cart([{ ...LORCANA, quantity: 2 }]);
  document.querySelector(".plus")?.setAttribute("aria-label", `Increase quantity of ${LORCANA.title}, Current Quantity 100`);
  assert.equal(cartQuantity(document, LORCANA.sku), null, "an unreadable label is not a quantity");
  document.querySelector(".plus")?.setAttribute("aria-label", `Increase quantity of ${LORCANA.title}, Current Quantity 3`);
  assert.equal(cartQuantity(document, LORCANA.sku), null, "labels that disagree are not a quantity");
  const selectCart = cart([{ ...LORCANA, quantity: 4, control: "select" }]).document;
  assert.equal(cartQuantity(selectCart, LORCANA.sku), 4);
  const bare = new JSDOM(`<main><div data-testid="cart-item" data-us-item-id="${LORCANA.sku}"><div data-testid="line-price">$11.74</div>
    <div><button aria-label="Decrease quantity">-</button><span>2</span><button aria-label="Increase quantity">+</button></div></div></main>`,
  { url: CART_URL }).window.document;
  assert.equal(cartQuantity(bare, LORCANA.sku), 2);
});

test("Walmart raises the cart line to the wanted quantity, one '+' at a time, and the exact delta verifies", async () => {
  const empty = new JSDOM("<body><main><h1>Your cart is empty</h1></main></body>", { url: CART_URL }).window.document;
  const baseline = inspectWalmartCartBaseline(empty, CART_URL, NOW);
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  const quantityJob = lorcanaJob({ quantity: 3 });
  const prepared = prepareWalmartAdd(lorcana("in-stock"), LORCANA_URL, quantityJob, NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;

  const { document, clicks, forbidden } = cart([{ ...LORCANA, quantity: 1 }, { ...RIFTBOUND, quantity: 2 }]);
  const raised = await raiseWalmartCartQuantity(document, CART_URL, quantityJob,
    { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 }, FAST);
  assert.deepEqual(raised, { ok: true, reason: "quantity_set", quantity: 3, storeLimit: null });
  assert.deepEqual([clicks.get(LORCANA.sku), clicks.get(RIFTBOUND.sku), forbidden], [2, undefined, []]);
  assert.equal(cartQuantity(document, RIFTBOUND.sku), 2, "another line is never touched");
  const verified = verifyWalmartAddedCart(document, CART_URL, { ...quantityJob, quantity: 3 }, prepared.proof,
    { ...baseline.proof, lines: [{ retailerSku: RIFTBOUND.sku, quantity: 2 }], lineCount: 1 }, NOW + 500);
  assert.equal(verified.ok, true, verified.ok ? "" : verified.reason);
});

test("Walmart stops raising at the store's limit and never goes past the wanted quantity", async () => {
  const limited = cart([{ ...LORCANA, quantity: 1, limit: 2 }]);
  assert.deepEqual(await raiseWalmartCartQuantity(limited.document, CART_URL, lorcanaJob({ quantity: 4 }),
    { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 4 }, FAST),
  { ok: true, reason: "quantity_set", quantity: 2, storeLimit: 2 });
  assert.equal(limited.clicks.get(LORCANA.sku), 1, "a '+' that stays disabled is never clicked");

  const atLimit = cart([{ ...LORCANA, quantity: 1, limit: 1 }]);
  assert.deepEqual(await raiseWalmartCartQuantity(atLimit.document, CART_URL, lorcanaJob({ quantity: 3 }),
    { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 }, FAST),
  { ok: false, reason: "quantity_limit_reached", quantity: 1, storeLimit: 1 });
  assert.equal(atLimit.clicks.get(LORCANA.sku), undefined);

  const message = cart([{ ...LORCANA, quantity: 2 }]);
  message.document.querySelector("[data-testid='cart-item']")?.insertAdjacentHTML("beforeend", "<p>Max qty reached</p>");
  assert.deepEqual(await raiseWalmartCartQuantity(message.document, CART_URL, lorcanaJob({ quantity: 3 }),
    { baselineQuantity: 1, currentQuantity: 2, targetQuantity: 4 }, FAST),
  { ok: false, reason: "quantity_limit_reached", quantity: 2, storeLimit: 2 });
  assert.equal(message.clicks.get(LORCANA.sku), undefined);

  const jumpy = cart([{ ...LORCANA, quantity: 1, step: 2 }]);
  assert.deepEqual(await raiseWalmartCartQuantity(jumpy.document, CART_URL, lorcanaJob({ quantity: 4 }),
    { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 4 }, FAST),
  { ok: false, reason: "cart_unverified", quantity: 3, storeLimit: null });
  assert.equal(jumpy.clicks.get(LORCANA.sku), 1, "a surprise stops the raise at once");

  const selectCart = cart([{ ...LORCANA, quantity: 1, control: "select", limit: 12 }, { ...RIFTBOUND, quantity: 2, control: "select" }]);
  assert.deepEqual(await raiseWalmartCartQuantity(selectCart.document, CART_URL, lorcanaJob({ quantity: 3 }),
    { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 }, FAST),
  { ok: true, reason: "quantity_set", quantity: 3, storeLimit: 12 });
  assert.deepEqual([selectCart.changes.get(LORCANA.sku), selectCart.changes.get(RIFTBOUND.sku)], [1, undefined]);
  const smallSelect = cart([{ ...LORCANA, quantity: 1, control: "select", limit: 2 }]);
  assert.deepEqual(await raiseWalmartCartQuantity(smallSelect.document, CART_URL, lorcanaJob({ quantity: 5 }),
    { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 5 }, FAST),
  { ok: true, reason: "quantity_set", quantity: 2, storeLimit: 2 });
});

test("Walmart refuses to raise an ambiguous, changed or unproven cart line and touches nothing", async () => {
  const input = { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 };
  const twice = cart([{ ...LORCANA, quantity: 1 }, { ...LORCANA, quantity: 1 }]);
  assert.deepEqual(await raiseWalmartCartQuantity(twice.document, CART_URL, lorcanaJob({ quantity: 3 }), input, FAST),
    { ok: false, reason: "quantity_line_ambiguous" });
  const unknownLine = cart([{ ...LORCANA, quantity: 1 }, { ...RIFTBOUND, quantity: 1 }]);
  unknownLine.document.querySelector(`[data-us-item-id='${RIFTBOUND.sku}']`)?.removeAttribute("data-us-item-id");
  unknownLine.document.querySelector(`a[href$='${RIFTBOUND.sku}']`)?.remove();
  assert.deepEqual(await raiseWalmartCartQuantity(unknownLine.document, CART_URL, lorcanaJob({ quantity: 3 }), input, FAST),
    { ok: false, reason: "quantity_line_ambiguous" });
  const changed = cart([{ ...LORCANA, quantity: 2 }]);
  assert.deepEqual(await raiseWalmartCartQuantity(changed.document, CART_URL, lorcanaJob({ quantity: 3 }), input, FAST),
    { ok: false, reason: "cart_unverified", quantity: 2 });
  const missing = cart([{ ...RIFTBOUND, quantity: 1 }]);
  assert.deepEqual(await raiseWalmartCartQuantity(missing.document, CART_URL, lorcanaJob({ quantity: 3 }), input, FAST),
    { ok: false, reason: "cart_unverified" });
  const fine = cart([{ ...LORCANA, quantity: 1 }]);
  assert.deepEqual(await raiseWalmartCartQuantity(fine.document, PRODUCT_URL, lorcanaJob({ quantity: 3 }), input, FAST),
    { ok: false, reason: "cart_page_unverified" });
  assert.deepEqual(await raiseWalmartCartQuantity(fine.document, CART_URL, lorcanaJob({ quantity: 2 }), input, FAST),
    { ok: false, reason: "quantity_invalid" }, "never past the job's own quantity");
  assert.deepEqual(await raiseWalmartCartQuantity(fine.document, CART_URL, lorcanaJob({ quantity: 3 }),
    { baselineQuantity: 1, currentQuantity: 1, targetQuantity: 3 }, FAST), { ok: false, reason: "quantity_invalid" });
  const challenged = cart([{ ...LORCANA, quantity: 1 }]);
  challenged.document.body.insertAdjacentHTML("beforeend", "<div>Robot or human? Activate and hold the button to confirm that you're human.</div>");
  assert.deepEqual(await raiseWalmartCartQuantity(challenged.document, CART_URL, lorcanaJob({ quantity: 3 }), input, FAST),
    { ok: false, reason: "manual_action_required" });
  for (const fixture of [twice, unknownLine, changed, missing, fine, challenged]) {
    assert.deepEqual([[...fixture.clicks.values()], fixture.forbidden], [[], []]);
  }
});

// Walmart may preselect Pickup for an item stocked nearby. The served page
// state then says PICKUP selected and keeps saying so after a click; the
// tiles behave like the store's: a change re-renders every data-selected.
function pickupPreselected(options: { shippingIntent?: string; revert?: boolean } = {}) {
  const document = lorcana("in-stock", (product) => {
    for (const option of product.fulfillmentOptions) {
      option.selected = option.type === "PICKUP";
      option.intent = option.type === "PICKUP";
      if (option.type === "PICKUP") option.availabilityStatus = "IN_STOCK";
    }
  });
  const input = (kind: string) => document.querySelector<HTMLInputElement>(`input#fulfillment-${kind}`);
  const shipping = input("Shipping");
  const pickup = input("Pickup");
  if (!shipping || !pickup) throw new Error("fixture tiles missing");
  pickup.checked = true;
  for (const kind of ["Shipping", "Pickup", "Delivery"]) input(kind)?.setAttribute("data-selected", String(kind === "Pickup"));
  const intent = (kind: string, value: string) => {
    const element = document.querySelector(`[data-seo-id='fulfillment-${kind}-intent']`);
    if (element) element.textContent = value;
  };
  intent("Pickup", "Pickup today");
  if (options.shippingIntent !== undefined) intent("Shipping", options.shippingIntent);
  const clicks: string[] = [];
  // A label's click also clicks its radio, which bubbles back through the
  // label; only clicks aimed at the element itself are counted.
  for (const element of document.querySelectorAll("label, button")) {
    element.addEventListener("click", (event) => {
      if (event.target === element) clicks.push(element.getAttribute("data-testid") || element.textContent?.trim() || element.tagName);
    });
  }
  for (const kind of ["Shipping", "Pickup", "Delivery"]) {
    input(kind)?.addEventListener("change", () => {
      setTimeout(() => {
        if (options.revert) pickup.checked = true;
        for (const other of ["Shipping", "Pickup", "Delivery"]) input(other)?.setAttribute("data-selected", String(Boolean(input(other)?.checked)));
      }, 20);
    });
  }
  return { document, clicks };
}

const SELECT_TIMING = { timeoutMs: 600, pollMs: 5, settleMs: 30 };

test("Walmart switches a Pickup-preselected buy box to Shipping, then prepares from the tile it shows", async () => {
  const { document, clicks } = pickupPreselected();
  assert.deepEqual(prepareWalmartAdd(document, LORCANA_URL, lorcanaJob(), NOW), { ok: false, reason: "add_control_unavailable" });
  assert.deepEqual(await selectWalmartShipping(document, LORCANA_URL, "17354421975", SELECT_TIMING),
    { ok: true, reason: "shipping_selected", selectionClicked: true });
  assert.deepEqual(clicks, ["shipping-tile"], "only the Shipping tile is clicked, once");
  const observation = observeWalmartOffer(document, LORCANA_URL, "17354421975", "shipping", new Date(NOW).toISOString());
  assert.deepEqual([observation.availability, observation.fulfillment, observation.unitPriceCents], ["in_stock", "shipping", 587]);
  const prepared = prepareWalmartAdd(document, LORCANA_URL, lorcanaJob(), NOW);
  assert.equal(prepared.ok, true, prepared.reason);
  assert.deepEqual(await selectWalmartShipping(document, LORCANA_URL, "17354421975", SELECT_TIMING),
    { ok: true, reason: "shipping_already_selected", selectionClicked: false });
  assert.deepEqual(await selectWalmartShipping(lorcana("in-stock"), LORCANA_URL, "17354421975", SELECT_TIMING),
    { ok: true, reason: "shipping_already_selected", selectionClicked: false });
  assert.deepEqual(clicks, ["shipping-tile"]);
});

test("Walmart never selects an unavailable Shipping tile and reports a selection that does not take", async () => {
  const soldOut = pickupPreselected({ shippingIntent: "Out of stock" });
  assert.deepEqual(await selectWalmartShipping(soldOut.document, LORCANA_URL, "17354421975", SELECT_TIMING),
    { ok: false, reason: "fulfillment_unverified", selectionClicked: false });
  const notOffered = pickupPreselected();
  notOffered.document.querySelector("[data-dca-name='ItemBuyBoxFulfillmentShipping']")?.remove();
  assert.deepEqual(await selectWalmartShipping(notOffered.document, LORCANA_URL, "17354421975", SELECT_TIMING),
    { ok: false, reason: "fulfillment_unverified", selectionClicked: false });
  const reverted = pickupPreselected({ revert: true });
  assert.deepEqual(await selectWalmartShipping(reverted.document, LORCANA_URL, "17354421975", SELECT_TIMING),
    { ok: false, reason: "fulfillment_selection_failed", selectionClicked: true });
  assert.deepEqual(reverted.clicks, ["shipping-tile"], "one click, never a second");
  const other = pickupPreselected();
  assert.deepEqual(await selectWalmartShipping(other.document, "https://www.walmart.com/ip/other/19637522232", "17354421975", SELECT_TIMING),
    { ok: false, reason: "listing_mismatch", selectionClicked: false });
  const challenged = pickupPreselected();
  challenged.document.body.insertAdjacentHTML("beforeend", "<div>Robot or human?</div>");
  assert.deepEqual(await selectWalmartShipping(challenged.document, LORCANA_URL, "17354421975", SELECT_TIMING),
    { ok: false, reason: "manual_action_required", selectionClicked: false });
  for (const fixture of [soldOut, notOffered, other, challenged]) assert.deepEqual(fixture.clicks, []);
  assert.deepEqual(prepareWalmartAdd(soldOut.document, LORCANA_URL, lorcanaJob(), NOW), { ok: false, reason: "add_control_unavailable" });
});

test("Walmart's served page state never outvotes the tile the buy box shows", () => {
  const switchedAway = lorcana("in-stock");
  switchedAway.querySelector<HTMLLabelElement>("label[data-testid='pickup-tile']")?.click();
  switchedAway.querySelector("input#fulfillment-Shipping")?.setAttribute("data-selected", "false");
  switchedAway.querySelector("input#fulfillment-Pickup")?.setAttribute("data-selected", "true");
  assert.deepEqual(prepareWalmartAdd(switchedAway, LORCANA_URL, lorcanaJob(), NOW), { ok: false, reason: "add_control_unavailable" });

  const soldOutSince = lorcana("in-stock");
  const shippingIntent = soldOutSince.querySelector("[data-seo-id='fulfillment-Shipping-intent']");
  if (shippingIntent) shippingIntent.textContent = "Out of stock";
  assert.equal(prepareWalmartAdd(soldOutSince, LORCANA_URL, lorcanaJob(), NOW).ok, false,
    "a Shipping tile that now says out of stock outvotes the served page state");

  const loading = pickupPreselected({ shippingIntent: "" });
  const shipping = loading.document.querySelector<HTMLInputElement>("input#fulfillment-Shipping");
  if (shipping) {
    shipping.checked = true;
    shipping.setAttribute("data-selected", "true");
  }
  loading.document.querySelector("input#fulfillment-Pickup")?.setAttribute("data-selected", "false");
  assert.deepEqual(prepareWalmartAdd(loading.document, LORCANA_URL, lorcanaJob(), NOW), { ok: false, reason: "add_control_unavailable" },
    "a Shipping tile picked after load needs an in-stock intent line");
});
