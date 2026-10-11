import { reviewedBrowserJobFixture } from "./helpers/official-msrp-browser.js";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import { TARGET_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import { observeTargetCart } from "../packages/browser-adapters/src/target.js";
import {
  abandonTargetAdd,
  commitTargetAdd,
  inspectTargetCartBaseline,
  prepareTargetAdd,
  raiseTargetCartQuantity,
  rehearseTargetAdd,
  type TargetAddJob,
  type TargetCartQuantityInput,
  verifyTargetAddedCart
} from "../apps/extension/src/target-action.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } } };
const FIXTURES = join(process.cwd(), "test", "fixtures", "target");
const PRODUCT_URL = "https://www.target.com/p/fixture/-/A-1011483414";
const NOW = new Date("2026-08-23T03:00:00.000Z").getTime();

function product(): Document {
  return new JSDOM(readFileSync(join(FIXTURES, "product-first-party.html"), "utf8"), { url: PRODUCT_URL }).window.document;
}

function modernProduct(): Document {
  return new JSDOM(readFileSync(join(FIXTURES, "product-modern-pickup-selected.html"), "utf8"), { url: PRODUCT_URL }).window.document;
}

function semanticDriftModernProduct(): Document {
  const document = modernProduct();
  const price = document.querySelector("[data-test='product-price']");
  price?.removeAttribute("data-test");
  price?.setAttribute("data-testid", "commerce-amount");
  document.querySelector("[data-module-type='ProductDetailFulfillment']")?.removeAttribute("data-module-type");
  document.querySelector("[aria-label='Fulfillment']")?.removeAttribute("data-test");
  for (const tile of document.querySelectorAll("[data-test^='fulfillment-cell-']")) tile.removeAttribute("data-test");
  return document;
}

function job(overrides: Partial<TargetAddJob> = {}): TargetAddJob {
  const base: BrowserActionContract = {
    contractVersion: 1,
    jobId: "job_target_add_fixture",
    retailerId: "target",
    retailerSku: "1011483414",
    canonicalUrl: PRODUCT_URL,
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: 5999,
    maxOrderTotalCents: 6000,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Target",
    fulfillment: "shipping",
    expiresAt: new Date(NOW + 60_000).toISOString()
  };
  return reviewedBrowserJobFixture({ ...base, adapterVersion: TARGET_ADD_ADAPTER_VERSION, ...overrides }, NOW);
}

test("Target rehearsal reaches the final click boundary without clicking", () => {
  const document = product();
  let clicks = 0;
  document.querySelector("button")?.addEventListener("click", () => { clicks += 1; });
  const result = rehearseTargetAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.wouldClick, true);
  assert.equal(clicks, 0);
});

test("Target v8 rehearses the current no-TCIN hydrated fulfillment action", () => {
  const document = new JSDOM(`<body><main>
    <div data-test="product-price">$34.99</div>
    <section aria-label="Fulfillment" data-test="@web/AddToCart/FulfillmentSection" role="region">
      <button data-test="fulfillment-cell-pickup" aria-label="pickup - unselected - Available today">Pickup</button>
      <button data-test="fulfillment-cell-shipping" aria-label="shipping - selected - Arrives tomorrow" aria-selected="true">Shipping</button>
      <button>Add to cart</button>
    </section>
  </main></body>`, { url: PRODUCT_URL }).window.document;
  let clicks = 0;
  document.querySelector("[aria-label='Fulfillment'] button:last-child")?.addEventListener("click", () => { clicks += 1; });
  const result = rehearseTargetAdd(document, PRODUCT_URL, job({ maxUnitPriceCents: 3499, maxOrderTotalCents: 3499 }), NOW);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.wouldClick, true);
  assert.equal(clicks, 0);
});

test("Target v8 binds the current direct shipping shell without treating sticky or recommendation controls as the offer", async () => {
  const document = new JSDOM(`<body>
    <main>
      <div data-test="product-price">$44.99</div>
      <div id="above-the-fold-information">
        <section aria-label="Fulfillment" data-test="@web/AddToCart/FulfillmentSection" role="region">
          <div data-test="@web/AddToCart/Fulfillment/ShippingSection">
            <p>Ship to 91722</p><p>Arrives by Monday</p><p>Ships free</p>
            <button id="addToCartButtonOrTextIdFor1011483414" data-test="shippingButton">Add to cart</button>
          </div>
        </section>
      </div>
    </main>
    <aside data-test="recommendations">Target Plus
      <button id="addToCartButtonOrTextIdFor1011483414" data-test="chooseOptionsButton">Add to cart</button>
    </aside>
    <aside data-test="StickyAddToCartFulfillmentSection">
      <button id="addToCartButtonOrTextIdFor1011483414" data-test="addToCartButton">Add to cart</button>
    </aside>
  </body>`, { url: PRODUCT_URL }).window.document;
  const primary = document.querySelector<HTMLElement>("[aria-label='Fulfillment'] #addToCartButtonOrTextIdFor1011483414");
  assert.ok(primary);
  let clicks = 0;
  primary.addEventListener("click", () => { clicks += 1; });

  const directJob = job({ maxUnitPriceCents: 4499, maxOrderTotalCents: 4499 });
  const rehearsal = rehearseTargetAdd(document, PRODUCT_URL, directJob, NOW);
  assert.equal(rehearsal.ok, true);
  assert.equal(rehearsal.ok && rehearsal.proof.sellerName, "Target");
  assert.equal(rehearsal.ok && rehearsal.proof.fulfillment, "shipping");
  assert.equal(clicks, 0);

  const generic = new JSDOM(document.documentElement.outerHTML, { url: PRODUCT_URL }).window.document;
  generic.querySelector("[aria-label='Fulfillment'] #addToCartButtonOrTextIdFor1011483414")
    ?.setAttribute("data-test", "addToCartButton");
  const genericRehearsal = rehearseTargetAdd(generic, PRODUCT_URL, directJob, NOW);
  assert.equal(genericRehearsal.ok, true);
  assert.equal(genericRehearsal.ok && genericRehearsal.proof.fulfillment, "shipping");

  const prepared = prepareTargetAdd(document, PRODUCT_URL, directJob, NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = await commitTargetAdd(document, PRODUCT_URL, directJob, prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(clicks, 1);
});

test("Target never treats a direct pickup shell as Shipping and the guarded policy rejects Pickup", () => {
  const document = new JSDOM(`<body><main>
    <div data-test="product-price">$24.99</div>
    <section aria-label="Fulfillment" data-test="@web/AddToCart/FulfillmentSection" role="region">
      <div data-test="@web/AddToCart/Fulfillment/PickupSection">
        <p>Pickup available today</p>
        <button id="addToCartButtonOrTextIdFor1011483414" data-test="addToCartButton">Add to cart</button>
      </div>
    </section>
  </main></body>`, { url: PRODUCT_URL }).window.document;
  const shippingJob = job({ maxUnitPriceCents: 2499, maxOrderTotalCents: 2499 });
  assert.equal(prepareTargetAdd(document, PRODUCT_URL, shippingJob, NOW).ok, false);
  const pickupJob = job({
    fulfillment: "pickup",
    maxUnitPriceCents: 2499,
    maxOrderTotalCents: 2499
  });
  assert.equal(rehearseTargetAdd(document, PRODUCT_URL, pickupJob, NOW).reason, "official_msrp_cart_policy_invalid");
});

test("Target add authorization clicks at most once and consumes its receipt before mutation", async () => {
  const document = product();
  let clicks = 0;
  document.querySelector("button")?.addEventListener("click", () => { clicks += 1; });
  const prepared = prepareTargetAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = await commitTargetAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(committed.clicked, true);
  assert.equal(clicks, 1);
  const duplicate = await commitTargetAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 200);
  assert.deepEqual(duplicate, { ok: false, reason: "authorization_missing", clicked: false });
  assert.equal(clicks, 1);
});

test("Target add revalidates price, action, quantity, and control identity immediately before clicking", async () => {
  const overPrice = product();
  let clicks = 0;
  overPrice.querySelector("button")?.addEventListener("click", () => { clicks += 1; });
  const prepared = prepareTargetAdd(overPrice, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const price = overPrice.querySelector("[data-test='product-price']");
  if (price) price.textContent = "$600.00";
  assert.deepEqual(await commitTargetAdd(overPrice, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100), {
    ok: false,
    reason: "over_unit_cap",
    clicked: false
  });
  assert.equal(clicks, 0);

  const sellerChanged = product();
  let sellerClicks = 0;
  sellerChanged.querySelector("button")?.addEventListener("click", () => { sellerClicks += 1; });
  const sellerPreparation = prepareTargetAdd(sellerChanged, PRODUCT_URL, job(), NOW);
  assert.equal(sellerPreparation.ok, true);
  if (!sellerPreparation.ok) return;
  sellerChanged.querySelector("main")?.insertAdjacentHTML(
    "beforeend",
    `<p data-test="sold-by">Sold by FIXTURE_REPLACEMENT_SELLER</p>`
  );
  assert.equal((await commitTargetAdd(sellerChanged, PRODUCT_URL, job(), sellerPreparation.authorizationId, NOW + 100)).reason, "third_party_seller");
  assert.equal(sellerClicks, 0);

  for (const quantity of [0, 11, 1.5]) {
    assert.equal(prepareTargetAdd(product(), PRODUCT_URL, job({ quantity, maxOrderTotalCents: 60_000 }), NOW).reason, "quantity_not_supported");
  }
  assert.equal(prepareTargetAdd(product(), PRODUCT_URL, job({ action: "prepare_checkout" }), NOW).reason, "unsupported_action");
  assert.equal(prepareTargetAdd(product(), PRODUCT_URL, job({ sellerPolicy: "allow_third_party" }), NOW).reason, "seller_policy_not_supported");
  assert.equal(prepareTargetAdd(product(), PRODUCT_URL, job({ fulfillment: "either" }), NOW).reason, "fulfillment_not_supported");

  const replaced = product();
  const replacementPreparation = prepareTargetAdd(replaced, PRODUCT_URL, job(), NOW);
  assert.equal(replacementPreparation.ok, true);
  if (!replacementPreparation.ok) return;
  const original = replaced.querySelector("button");
  const clone = original?.cloneNode(true);
  if (original && clone) original.replaceWith(clone);
  assert.equal((await commitTargetAdd(replaced, PRODUCT_URL, job(), replacementPreparation.authorizationId, NOW + 100)).reason, "add_control_changed");
});

test("Target guarded authorization rejects Pickup even when its exact selected offer is available", async () => {
  const document = modernProduct();
  const pickup = document.querySelector<HTMLElement>("[data-test='fulfillment-cell-pickup']");
  const add = document.querySelector<HTMLElement>("#addToCartButtonOrTextIdFor1011483414");
  assert.ok(pickup);
  assert.ok(add);
  let addClicks = 0;
  add.addEventListener("click", () => { addClicks += 1; });
  const pickupJob = job({ fulfillment: "pickup", maxUnitPriceCents: 539 });
  const prepared = prepareTargetAdd(document, PRODUCT_URL, pickupJob, NOW);
  assert.deepEqual(prepared, { ok: false, reason: "official_msrp_cart_policy_invalid" });
  const committed = await commitTargetAdd(document, PRODUCT_URL, pickupJob, "no_authorization", NOW + 100);
  assert.equal(committed.ok, false);
  assert.equal(addClicks, 0);

  const unavailable = modernProduct();
  unavailable.querySelector("[data-test='fulfillment-cell-pickup']")
    ?.setAttribute("aria-label", "pickup - selected - 1 of 3 - Check availability");
  assert.equal(prepareTargetAdd(unavailable, PRODUCT_URL, pickupJob, NOW).ok, false);
});

test("Target runner selects an available remote tile, rebinds the Add control, and then clicks once", async () => {
  const document = modernProduct();
  const shipping = document.querySelector<HTMLElement>("[data-test='fulfillment-cell-shipping']");
  const pickup = document.querySelector("[data-test='fulfillment-cell-pickup']");
  const add = document.querySelector<HTMLElement>("[aria-label='Fulfillment'] #addToCartButtonOrTextIdFor1011483414");
  assert.ok(shipping);
  assert.ok(pickup);
  assert.ok(add);
  let selectionClicks = 0;
  let addClicks = 0;
  shipping.addEventListener("click", () => {
    selectionClicks += 1;
    pickup.setAttribute("aria-label", "pickup - unselected - 1 of 3 - Ready within 2 hours");
    shipping.setAttribute("aria-label", "shipping - selected - 3 of 3 - Arrives by Monday");
    const rebound = add.cloneNode(true) as HTMLElement;
    rebound.setAttribute("data-test", "shippingButton");
    rebound.addEventListener("click", () => { addClicks += 1; });
    add.replaceWith(rebound);
  });

  const rehearsal = rehearseTargetAdd(document, PRODUCT_URL, job({ maxUnitPriceCents: 539 }), NOW);
  assert.equal(rehearsal.ok, true);
  assert.equal(selectionClicks, 0);
  assert.equal(addClicks, 0);

  const prepared = prepareTargetAdd(document, PRODUCT_URL, job({ maxUnitPriceCents: 539 }), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = await commitTargetAdd(
    document,
    PRODUCT_URL,
    job({ maxUnitPriceCents: 539 }),
    prepared.authorizationId,
    NOW + 100
  );
  assert.equal(committed.ok, true);
  assert.equal(committed.clicked, true);
  assert.equal(selectionClicks, 1);
  assert.equal(addClicks, 1);
});

test("Target rechecks job and authorization expiry after fulfillment selection consumes time", async (t) => {
  for (const expires of ["job", "authorization"] as const) {
    t.mock.timers.enable({ apis: ["Date"], now: NOW });
    try {
      const document = modernProduct();
      const shipping = document.querySelector<HTMLElement>("[data-test='fulfillment-cell-shipping']")!;
      const pickup = document.querySelector("[data-test='fulfillment-cell-pickup']")!;
      const add = document.querySelector<HTMLElement>("[aria-label='Fulfillment'] #addToCartButtonOrTextIdFor1011483414")!;
      let clicks = 0;
      shipping.addEventListener("click", () => {
        t.mock.timers.tick(2_000);
        pickup.setAttribute("aria-label", "pickup - unselected - 1 of 3 - Ready within 2 hours");
        shipping.setAttribute("aria-label", "shipping - selected - 3 of 3 - Arrives by Monday");
        const rebound = add.cloneNode(true) as HTMLElement;
        rebound.setAttribute("data-test", "shippingButton");
        rebound.addEventListener("click", () => clicks++);
        add.replaceWith(rebound);
      });
      const preparedAt = expires === "authorization" ? NOW - 9500 : NOW;
      const exactJob = reviewedBrowserJobFixture(job({ maxUnitPriceCents: 539,
        expiresAt: new Date(NOW + (expires === "job" ? 1000 : 60_000)).toISOString() }), preparedAt);
      const prepared = prepareTargetAdd(document, PRODUCT_URL, exactJob, preparedAt);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) continue;
      const committed = await commitTargetAdd(document, PRODUCT_URL, exactJob, prepared.authorizationId, NOW);
      assert.equal(committed.ok, false, expires);
      assert.equal(committed.reason, expires === "job" ? "job_expired" : "authorization_expired");
      assert.equal(clicks, 0);
    } finally { t.mock.timers.reset(); }
  }
});

test("Target safely self-heals current fulfillment and price landmark drift", async () => {
  const document = semanticDriftModernProduct();
  const tiles = [...document.querySelectorAll<HTMLElement>("[aria-label*=' - ']")];
  const pickup = tiles.find((tile) => /^pickup\b/i.test(tile.getAttribute("aria-label") || ""));
  const shipping = tiles.find((tile) => /^shipping\b/i.test(tile.getAttribute("aria-label") || ""));
  const add = document.querySelector<HTMLElement>("[aria-label='Fulfillment'] #addToCartButtonOrTextIdFor1011483414");
  assert.ok(pickup);
  assert.ok(shipping);
  assert.ok(add);
  let selectionClicks = 0;
  let addClicks = 0;
  shipping.addEventListener("click", () => {
    selectionClicks += 1;
    pickup.setAttribute("aria-label", "pickup - unselected - 1 of 3 - Ready within 2 hours");
    shipping.setAttribute("aria-label", "shipping - selected - 3 of 3 - Arrives by Monday");
    const rebound = add.cloneNode(true) as HTMLElement;
    rebound.setAttribute("data-test", "shippingButton");
    rebound.addEventListener("click", () => { addClicks += 1; });
    add.replaceWith(rebound);
  });

  const actionJob = job({ maxUnitPriceCents: 539 });
  assert.equal(rehearseTargetAdd(document, PRODUCT_URL, actionJob, NOW).ok, true);
  assert.equal(selectionClicks, 0);
  assert.equal(addClicks, 0);
  const prepared = prepareTargetAdd(document, PRODUCT_URL, actionJob, NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = await commitTargetAdd(document, PRODUCT_URL, actionJob, prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(selectionClicks, 1);
  assert.equal(addClicks, 1);

  const ambiguous = semanticDriftModernProduct();
  const duplicate = ambiguous.querySelector("[aria-label='Fulfillment'] #addToCartButtonOrTextIdFor1011483414")?.cloneNode(true);
  if (duplicate) ambiguous.querySelector("[aria-label='Fulfillment']")?.append(duplicate);
  assert.equal(prepareTargetAdd(ambiguous, PRODUCT_URL, actionJob, NOW).ok, false);
});

test("Target cart preflight captures a bounded baseline and post-add proof requires an exact delta", () => {
  const empty = new JSDOM(`<body><main><h1>Your cart is empty</h1></main></body>`, { url: "https://www.target.com/cart" }).window.document;
  const baseline = inspectTargetCartBaseline(empty, "https://www.target.com/cart", NOW);
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  assert.deepEqual(baseline.proof.lines, []);
  const cart = new JSDOM(readFileSync(join(FIXTURES, "cart.html"), "utf8"), { url: "https://www.target.com/cart" }).window.document;
  const existing = inspectTargetCartBaseline(cart, "https://www.target.com/cart", NOW);
  assert.equal(existing.ok, true);
  if (!existing.ok) return;
  assert.equal(existing.proof.lineCount, 1);
  const prepared = prepareTargetAdd(product(), PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const verified = verifyTargetAddedCart(cart, "https://www.target.com/cart", job(), prepared.proof, baseline.proof, NOW + 500);
  assert.equal(verified.ok, true);
});

// Late-September 2026 layout: the buy button sits in a ProductDetailAddToCart
// module beside the Fulfillment region (structure taken from a live page).
const SPLIT_URL = "https://www.target.com/p/-/A-1011411628";

function splitProduct(state: "pickup-selected" | "shipping-selected"): Document {
  return new JSDOM(readFileSync(join(FIXTURES, `product-split-module-${state}.html`), "utf8"), { url: SPLIT_URL }).window.document;
}

function splitJob(overrides: Partial<TargetAddJob> = {}): TargetAddJob {
  return job({ jobId: "job_target_split_module", retailerSku: "1011411628", canonicalUrl: SPLIT_URL, maxUnitPriceCents: 4198, ...overrides });
}

/** Makes the pickup-selected page behave like Target after Shipping is clicked. */
function switchToShippingOnClick(document: Document): void {
  const shipped = splitProduct("shipping-selected");
  document.getElementById("SHIPPING")?.addEventListener("click", () => {
    for (const id of ["PICKUP", "DELIVERY", "SHIPPING"]) {
      document.getElementById(id)?.setAttribute("aria-label", shipped.getElementById(id)?.getAttribute("aria-label") ?? "");
    }
    const module = document.querySelector("[data-test='module-product-detail-add-to-cart']");
    const next = shipped.querySelector("[data-test='module-product-detail-add-to-cart']");
    if (module && next) module.innerHTML = next.innerHTML;
  });
}

test("Target split layout: Pickup chosen at a store without stock still reads Shipping as in stock and plans to choose it", () => {
  const document = splitProduct("pickup-selected");
  const prepared = prepareTargetAdd(document, SPLIT_URL, splitJob(), NOW);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  if (prepared.ok) abandonTargetAdd(prepared.authorizationId);
  const rehearsal = rehearseTargetAdd(document, SPLIT_URL, splitJob(), NOW);
  assert.equal(rehearsal.ok, true, JSON.stringify(rehearsal));
});

test("Target split layout: with Shipping chosen the exact-TCIN Add to cart button is bound despite its quantity-stepper marker", () => {
  const document = splitProduct("shipping-selected");
  const result = rehearseTargetAdd(document, SPLIT_URL, splitJob(), NOW);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("Target split layout: commit chooses Shipping, then clicks only the module's Add to cart (never the placeholder, sticky copy or Buy now)", async () => {
  const document = splitProduct("pickup-selected");
  switchToShippingOnClick(document);
  const clicked: string[] = [];
  document.addEventListener("click", (event) => {
    const target = event.target as Element;
    clicked.push(`${target.id}|${target.closest("[data-test='sticky-atc']") ? "sticky" : "page"}|${(target.textContent || "").trim()}`);
  }, true);
  const prepared = prepareTargetAdd(document, SPLIT_URL, splitJob(), NOW);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  if (!prepared.ok) return;
  const commit = await commitTargetAdd(document, SPLIT_URL, splitJob(), prepared.authorizationId, NOW);
  assert.equal(commit.ok, true, JSON.stringify(commit));
  assert.deepEqual(clicked, [
    "SHIPPING|page|Shipping Arrives by Fri, Oct 2",
    "addToCartButtonOrTextIdFor1011411628|page|Add to cart"
  ]);
});

test("Target split layout: a Shipping choice that never turns the button into Add to cart is not clicked", async () => {
  const document = splitProduct("pickup-selected");
  // Selecting Shipping updates the tiles, but the button keeps its placeholder.
  document.getElementById("SHIPPING")?.addEventListener("click", () => {
    document.getElementById("PICKUP")?.setAttribute("aria-label", "Pickup Get it nearby today, ");
    document.getElementById("SHIPPING")?.setAttribute("aria-label", "Shipping Arrives by Fri, Oct 2, selected");
  });
  let placeholderClicks = 0;
  document.getElementById("AddToCart.Fiats")?.addEventListener("click", () => { placeholderClicks += 1; });
  const prepared = prepareTargetAdd(document, SPLIT_URL, splitJob(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const commit = await commitTargetAdd(document, SPLIT_URL, splitJob(), prepared.authorizationId, NOW);
  assert.equal(commit.ok, false);
  assert.equal(commit.clicked, false);
  assert.equal(placeholderClicks, 0);
});

test("Target split layout: an item unavailable for Shipping is not in stock", () => {
  const document = splitProduct("pickup-selected");
  document.getElementById("SHIPPING")?.setAttribute("aria-label", "Shipping Not available, ");
  document.getElementById("SHIPPING")!.textContent = "Shipping Not available";
  const result = rehearseTargetAdd(document, SPLIT_URL, splitJob(), NOW);
  assert.equal(result.ok, false);
});

const SHIP_ONLY_URL = "https://www.target.com/p/-/A-95290386";

function shipOnlyProduct(): Document {
  return new JSDOM(readFileSync(join(FIXTURES, "product-split-module-ship-only.html"), "utf8"), { url: SHIP_ONLY_URL }).window.document;
}

function shipOnlyJob(overrides: Partial<TargetAddJob> = {}): TargetAddJob {
  return job({ jobId: "job_target_ship_only", retailerSku: "95290386", canonicalUrl: SHIP_ONLY_URL, maxUnitPriceCents: 1799, ...overrides });
}

test("Target shipping-only layout: \"Ship to … Arrives by …\" with the module's Add to cart is an in-stock shipping offer", async () => {
  const document = shipOnlyProduct();
  const rehearsal = rehearseTargetAdd(document, SHIP_ONLY_URL, shipOnlyJob(), NOW);
  assert.equal(rehearsal.ok, true, JSON.stringify(rehearsal));
  const clicked: string[] = [];
  document.addEventListener("click", (event) => {
    const target = event.target as Element;
    clicked.push(`${target.id}|${target.closest("[data-test='sticky-atc']") ? "sticky" : "page"}`);
  }, true);
  const prepared = prepareTargetAdd(document, SHIP_ONLY_URL, shipOnlyJob(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const commit = await commitTargetAdd(document, SHIP_ONLY_URL, shipOnlyJob(), prepared.authorizationId, NOW);
  assert.equal(commit.ok, true, JSON.stringify(commit));
  assert.deepEqual(clicked, ["addToCartButtonOrTextIdFor95290386|page"]);
});

test("Target shipping-only layout: no arrival date, an unavailable message, a pickup job or a non-add label is not actionable", () => {
  const noDate = shipOnlyProduct();
  for (const span of noDate.querySelectorAll("[aria-label='Fulfillment'] span")) {
    if (/Arrives/.test(span.textContent || "")) span.textContent = "Shipping not available";
  }
  assert.equal(rehearseTargetAdd(noDate, SHIP_ONLY_URL, shipOnlyJob(), NOW).ok, false);

  assert.equal(rehearseTargetAdd(shipOnlyProduct(), SHIP_ONLY_URL, shipOnlyJob({ fulfillment: "pickup" }), NOW).ok, false);

  const notify = shipOnlyProduct();
  const button = notify.querySelector("[data-module-type='ProductDetailAddToCart'] #addToCartButtonOrTextIdFor95290386");
  if (button) button.textContent = "Notify me when available";
  assert.equal(rehearseTargetAdd(notify, SHIP_ONLY_URL, shipOnlyJob(), NOW).ok, false);
});

test("Target signed in: the module's \"Buy now\" beside Add to cart is never clicked", async () => {
  const document = shipOnlyProduct();
  const buyNow = document.getElementById("sign-in-to-buy-now-button");
  buyNow?.setAttribute("id", "buy-now-button");
  buyNow?.setAttribute("data-test", "buy-now-button");
  buyNow?.setAttribute("aria-label", "Buy now for Yu-Gi-Oh! Battle of Legends Glorious Gallery Box");
  if (buyNow) buyNow.textContent = "Buy now";
  let buyNowClicks = 0;
  buyNow?.addEventListener("click", () => { buyNowClicks += 1; });
  const prepared = prepareTargetAdd(document, SHIP_ONLY_URL, shipOnlyJob(), NOW);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  if (!prepared.ok) return;
  const commit = await commitTargetAdd(document, SHIP_ONLY_URL, shipOnlyJob(), prepared.authorizationId, NOW);
  assert.equal(commit.ok, true, JSON.stringify(commit));
  assert.equal(buyNowClicks, 0);
});

// ---- A plan for several (Kevin, 2026-10-10) ----

function nextData(tcin: string, purchaseLimit: unknown, children: unknown[] = []): string {
  const product = { tcin, ...(children.length ? { children } : {}), item: { fulfillment: { purchase_limit: purchaseLimit } } };
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { dehydratedState: { queries: [{
    queryKey: ["platform/domain-cdui-orchestrations/fetch-cdui-layout-v1", { tcin }],
    state: { data: { data: { data_source_modules: [
      { module_type: "ProductDetailWebDatasourceCircleOffers" },
      { module_type: "ProductDetailWebDatasourceCore", module_data: { data: { product } } }
    ] } } }
  }] } } })}</script>`;
}

function shipOnlyWith(html: string): Document {
  const document = shipOnlyProduct();
  document.body.insertAdjacentHTML("beforeend", html);
  return document;
}

test("Target plans several as one Add and a cart raise, never past the exact TCIN's purchase limit", async () => {
  const plan = shipOnlyJob({ quantity: 3, maxOrderTotalCents: 3 * 1799 });
  // One stays exactly as before: no plan in the result.
  const single = prepareTargetAdd(shipOnlyProduct(), SHIP_ONLY_URL, shipOnlyJob(), NOW);
  assert.equal(single.ok, true);
  assert.equal(single.ok && Object.hasOwn(single, "quantity"), false);
  const quantity = (document: Document, value = plan) => {
    const prepared = prepareTargetAdd(document, SHIP_ONLY_URL, value, NOW);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    return prepared.ok ? prepared.quantity : undefined;
  };
  assert.deepEqual(quantity(shipOnlyProduct()), { requested: 3, storeLimit: null, add: 1, raiseTo: 3 });
  assert.deepEqual(quantity(shipOnlyWith(nextData("95290386", 2))), { requested: 3, storeLimit: 2, add: 1, raiseTo: 2 });
  assert.deepEqual(quantity(shipOnlyWith(nextData("95290386", 10))), { requested: 3, storeLimit: 10, add: 1, raiseTo: 3 });
  // A variation parent's data names the exact child's own limit.
  assert.deepEqual(quantity(shipOnlyWith(nextData("95290000", 10, [{ tcin: "95290386", item: { fulfillment: { purchase_limit: 2 } } }]))),
    { requested: 3, storeLimit: 2, add: 1, raiseTo: 2 });
  // Another product's data (a page that navigated in place) and unusable values are ignored.
  for (const stale of [nextData("2020202020", 1), nextData("95290386", 0), nextData("95290386", 100), nextData("95290386", "two")]) {
    assert.deepEqual(quantity(shipOnlyWith(stale)), { requested: 3, storeLimit: null, add: 1, raiseTo: 3 }, stale);
  }
  // A visible limit in the buy box counts; the lower of the two wins; a recommendation's does not.
  const visibleLimit = shipOnlyProduct();
  visibleLimit.querySelector("[data-test='module-product-detail-add-to-cart']")
    ?.insertAdjacentHTML("beforeend", `<p data-test="quantityLimitMessage">Limit 1 per guest</p>`);
  assert.deepEqual(quantity(visibleLimit), { requested: 3, storeLimit: 1, add: 1, raiseTo: 1 });
  const both = shipOnlyWith(`${nextData("95290386", 2)}<p data-test="purchaseLimitMessage">Limited to 10 per order</p>`);
  assert.deepEqual(quantity(both), { requested: 3, storeLimit: 2, add: 1, raiseTo: 2 });
  const recommended = shipOnlyWith(`<section data-test="recommendations"><p data-test="quantityLimitMessage">Limit 1 per guest</p></section>`);
  assert.deepEqual(quantity(recommended), { requested: 3, storeLimit: null, add: 1, raiseTo: 3 });

  // The Add itself still adds exactly one: the page must read 1 and one click happens.
  const document = shipOnlyWith(nextData("95290386", 2));
  let clicks = 0;
  document.querySelector("[data-module-type='ProductDetailAddToCart'] #addToCartButtonOrTextIdFor95290386")
    ?.addEventListener("click", () => { clicks += 1; });
  const prepared = prepareTargetAdd(document, SHIP_ONLY_URL, plan, NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const commit = await commitTargetAdd(document, SHIP_ONLY_URL, plan, prepared.authorizationId, NOW);
  assert.equal(commit.ok, true, JSON.stringify(commit));
  assert.equal(clicks, 1);
  // The total cap covers the whole plan before anything is clicked.
  assert.equal(prepareTargetAdd(shipOnlyProduct(), SHIP_ONLY_URL, shipOnlyJob({ quantity: 3, maxOrderTotalCents: 2 * 1799 }), NOW).reason,
    "over_total_cap");
});

test("Target reports out_of_stock only for its own sold-out state, not for an Add control it could not bind", async () => {
  const missUrl = "https://www.target.com/p/fixture/-/A-95238329";
  const miss = new JSDOM(readFileSync(join(FIXTURES, "product-selector-miss.html"), "utf8"), { url: missUrl }).window.document;
  const missJob = job({ jobId: "job_target_miss", retailerSku: "95238329", canonicalUrl: missUrl, maxUnitPriceCents: 539, maxOrderTotalCents: 539 });
  assert.equal(prepareTargetAdd(miss, missUrl, missJob, NOW).reason, "add_control_unavailable");
  assert.equal(rehearseTargetAdd(miss, missUrl, missJob, NOW).reason, "add_control_unavailable");

  const soldOutUrl = "https://www.target.com/p/-/A-1010423703";
  const soldOut = new JSDOM(readFileSync(join(FIXTURES, "product-sold-out.html"), "utf8"), { url: soldOutUrl }).window.document;
  const soldOutJob = job({ jobId: "job_target_sold_out", retailerSku: "1010423703", canonicalUrl: soldOutUrl });
  assert.equal(prepareTargetAdd(soldOut, soldOutUrl, soldOutJob, NOW).reason, "out_of_stock");

  // The Add control disappearing between prepare and commit is not "sold out" either.
  const document = product();
  const prepared = prepareTargetAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  document.querySelector("#addToCartButtonOrTextIdFor1011483414")?.remove();
  assert.deepEqual(await commitTargetAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100),
    { ok: false, reason: "add_control_unavailable", clicked: false });
});

// Raising the cart line. Target's cart page has never been captured, so these
// run on SYNTHETIC cart fixtures (test/fixtures/target/cart-quantity-*.html)
// whose markup is assumed; each test wires the store's behaviour itself.
const CART_URL = "https://www.target.com/cart";
const FAST = { maxMs: 2_000, stepWaitMs: 250, settleMs: 40, pollMs: 5 };

function cartPage(name: string): Document {
  return new JSDOM(readFileSync(join(FIXTURES, name), "utf8"), { url: CART_URL }).window.document;
}

function cartLine(document: Document, sku: string): Element {
  const line = [...document.querySelectorAll("[data-test='cartItem']")].find((candidate) => candidate.querySelector(`a[href*='A-${sku}']`));
  assert.ok(line, sku);
  return line;
}

function cartJob(sku: string, unitCents: number, quantity: number): TargetAddJob {
  return job({
    jobId: `job_target_cart_${sku}`,
    retailerSku: sku,
    canonicalUrl: `https://www.target.com/p/-/A-${sku}`,
    quantity,
    maxUnitPriceCents: unitCents,
    maxOrderTotalCents: unitCents * quantity
  });
}

/** Every click and every input/change event that reaches the page. */
function watchCart(document: Document): { clicks: string[]; events: string[] } {
  const clicks: string[] = [];
  const events: string[] = [];
  document.addEventListener("click", (event) => {
    const target = event.target as Element;
    clicks.push(target.id || `${target.getAttribute("role") || target.tagName.toLowerCase()} ${String(target.textContent || "").trim()}`
      + ` in ${target.closest("[role='listbox']")?.id || target.closest("[data-test='cartItem']")?.querySelector("a")?.getAttribute("href") || "page"}`);
  }, true);
  for (const type of ["input", "change"]) {
    document.addEventListener(type, (event) => { events.push(`${type}:${(event.target as Element).id}`); }, true);
  }
  return { clicks, events };
}

test("Target raises a native Qty select on the exact line only, within its highest option, then proves the exact cart delta", async () => {
  const before = cartPage("cart-quantity-select.html");
  cartLine(before, "95290386").remove();
  const baseline = inspectTargetCartBaseline(before, CART_URL, NOW);
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  const plan = shipOnlyJob({ quantity: 3, maxOrderTotalCents: 3 * 1799 });
  const prepared = prepareTargetAdd(shipOnlyProduct(), SHIP_ONLY_URL, plan, NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;

  const document = cartPage("cart-quantity-select.html");
  assert.equal(verifyTargetAddedCart(document, CART_URL, { ...plan, quantity: 1 }, prepared.proof, baseline.proof, NOW + 500).ok, true);
  const select = document.getElementById("cartItem-qty-95290386") as HTMLSelectElement;
  const line = cartLine(document, "95290386");
  // The store: a change shows the line busy, then its total and unit price.
  select.addEventListener("change", () => {
    line.setAttribute("aria-busy", "true");
    setTimeout(() => {
      line.querySelector("[data-test='cartItem-price']")!.innerHTML = `$${(17.99 * Number(select.value)).toFixed(2)} <span>$17.99 each</span>`;
      line.removeAttribute("aria-busy");
    }, 20);
  });
  const seen = watchCart(document);
  const input: TargetCartQuantityInput = { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 };
  const raised = await raiseTargetCartQuantity(document, CART_URL, plan, input, FAST);
  assert.deepEqual(raised, { ok: true, reason: "quantity_set", quantity: 2, storeLimit: 2 });
  assert.deepEqual(seen.events, ["input:cartItem-qty-95290386", "change:cartItem-qty-95290386"]);
  assert.deepEqual(seen.clicks, []);
  assert.equal((document.getElementById("cartItem-qty-1011483414") as HTMLSelectElement).value, "1");
  assert.deepEqual(observeTargetCart(document, new Date(NOW + 900).toISOString()).lines.map((entry) => [entry.retailerSku, entry.quantity, entry.unitPriceCents]),
    [["95290386", 2, 1799], ["1011483414", 1, 5999]]);
  const verified = verifyTargetAddedCart(document, CART_URL, { ...plan, quantity: 2 }, prepared.proof, baseline.proof, NOW + 1_000);
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.equal(verified.ok && verified.proof.quantity, 2);
  assert.equal(verifyTargetAddedCart(document, CART_URL, { ...plan, quantity: 3 }, prepared.proof, baseline.proof, NOW + 1_000).ok, false);
});

test("Target does not report a raise the cart put back, and names Target's limit when it shows one", async () => {
  for (const message of ["", "Limit 1 per guest"]) {
    const document = cartPage("cart-quantity-select.html");
    const select = document.getElementById("cartItem-qty-95290386") as HTMLSelectElement;
    select.addEventListener("change", () => setTimeout(() => {
      select.value = "1";
      if (message) cartLine(document, "95290386").insertAdjacentHTML("beforeend", `<p>${message}</p>`);
    }, 10));
    const raised = await raiseTargetCartQuantity(document, CART_URL, cartJob("95290386", 1799, 3),
      { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 }, { ...FAST, maxMs: 400 });
    assert.deepEqual(raised, message
      ? { ok: false, reason: "quantity_limit_reached", quantity: 1, storeLimit: 1 }
      : { ok: false, reason: "quantity_unchanged", quantity: 1, storeLimit: 2 });
  }
});

function wireDropdown(document: Document, sku: string): void {
  const trigger = document.getElementById(`cartItem-qty-button-${sku}`)!;
  const listbox = document.getElementById(`cartItem-qty-listbox-${sku}`) as HTMLElement;
  trigger.addEventListener("click", () => {
    const open = trigger.getAttribute("aria-expanded") === "true";
    trigger.setAttribute("aria-expanded", String(!open));
    listbox.hidden = open;
  });
  for (const option of listbox.querySelectorAll("[role='option']")) {
    option.addEventListener("click", () => {
      listbox.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      setTimeout(() => {
        trigger.textContent = `Qty ${option.textContent}`;
        trigger.setAttribute("aria-label", `Quantity, ${option.textContent} selected`);
      }, 15);
    });
  }
}

test("Target raises a Qty dropdown through the listbox its own button names, to exactly the plan", async () => {
  const document = cartPage("cart-quantity-dropdown.html");
  wireDropdown(document, "95238329");
  wireDropdown(document, "1011483414");
  const seen = watchCart(document);
  const raised = await raiseTargetCartQuantity(document, CART_URL, cartJob("95238329", 5099, 3),
    { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 }, FAST);
  assert.deepEqual(raised, { ok: true, reason: "quantity_set", quantity: 3, storeLimit: 10 });
  assert.deepEqual(seen.clicks, ["cartItem-qty-button-95238329", "option 3 in cartItem-qty-listbox-95238329"]);
  assert.deepEqual(seen.events, []);
  assert.equal(document.getElementById("cartItem-qty-button-1011483414")?.textContent, "Qty 1");
  assert.deepEqual(observeTargetCart(document, new Date(NOW).toISOString()).lines.map((entry) => [entry.retailerSku, entry.quantity]),
    [["95238329", 3], ["1011483414", 1]]);
});

test("Target never uses a listbox its quantity button does not name, and closes the one it opened", async () => {
  const document = cartPage("cart-quantity-dropdown.html");
  const trigger = document.getElementById("cartItem-qty-button-95238329")!;
  trigger.removeAttribute("aria-controls");
  document.getElementById("cartItem-qty-listbox-95238329")?.removeAttribute("aria-labelledby");
  wireDropdown(document, "95238329");
  const seen = watchCart(document);
  const raised = await raiseTargetCartQuantity(document, CART_URL, cartJob("95238329", 5099, 3),
    { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 }, FAST);
  assert.deepEqual(raised, { ok: false, reason: "quantity_control_unavailable", quantity: 1, storeLimit: null });
  assert.deepEqual(seen.clicks, ["cartItem-qty-button-95238329", "cartItem-qty-button-95238329"]);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
});

function wireStepper(document: Document, sku: string, limit: number | null, respond = true): () => number {
  const line = cartLine(document, sku);
  const value = line.querySelector("[data-test='cartItem-quantity-value']")!;
  const plus = line.querySelector("button[aria-label^='Increase']") as HTMLButtonElement;
  let clicks = 0;
  plus.addEventListener("click", () => {
    clicks += 1;
    if (!respond) return;
    setTimeout(() => {
      const next = Number(value.textContent) + 1;
      value.textContent = String(next);
      if (limit !== null && next >= limit) {
        plus.disabled = true;
        line.querySelector("[data-test='cartItem-limit']")!.textContent = `Limit ${limit} per guest`;
      }
    }, 15);
  });
  return () => clicks;
}

test("Target steps a +/- line up one click at a time and stops at Target's limit, never touching Remove or another line", async () => {
  const limited = cartPage("cart-quantity-stepper.html");
  const plusClicks = wireStepper(limited, "94972381", 2);
  const otherClicks = wireStepper(limited, "1011483414", null);
  const seen = watchCart(limited);
  const job3 = cartJob("94972381", 3999, 3);
  const input: TargetCartQuantityInput = { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 };
  assert.deepEqual(await raiseTargetCartQuantity(limited, CART_URL, job3, input, FAST),
    { ok: true, reason: "quantity_set", quantity: 2, storeLimit: 2 });
  assert.equal(plusClicks(), 1);
  assert.equal(otherClicks(), 0);
  assert.equal(seen.clicks.some((click) => /Remove|Check out|checkout/i.test(click)), false);

  const open = cartPage("cart-quantity-stepper.html");
  // A product name in the "+" label ("Pay Day ... Remover") is not a forbidden action.
  cartLine(open, "94972381").querySelector("button[aria-label^='Increase']")
    ?.setAttribute("aria-label", "Increase quantity of Pay Day Stain Remover Pen");
  const openClicks = wireStepper(open, "94972381", null);
  assert.deepEqual(await raiseTargetCartQuantity(open, CART_URL, job3, input, FAST),
    { ok: true, reason: "quantity_set", quantity: 3, storeLimit: null });
  assert.equal(openClicks(), 2);

  const stuck = cartPage("cart-quantity-stepper.html");
  const stuckClicks = wireStepper(stuck, "94972381", null, false);
  assert.deepEqual(await raiseTargetCartQuantity(stuck, CART_URL, job3, input, FAST),
    { ok: false, reason: "quantity_unchanged", quantity: 1, storeLimit: null });
  assert.equal(stuckClicks(), 1);

  const atLimit = cartPage("cart-quantity-stepper.html");
  (cartLine(atLimit, "94972381").querySelector("button[aria-label^='Increase']") as HTMLButtonElement).disabled = true;
  assert.deepEqual(await raiseTargetCartQuantity(atLimit, CART_URL, job3, input, FAST),
    { ok: false, reason: "quantity_limit_reached", quantity: 1, storeLimit: 1 });
});

test("Target raise refuses without touching the cart unless the line, its quantity and the request are exactly what was verified", async () => {
  const plan = cartJob("95290386", 1799, 3);
  const input: TargetCartQuantityInput = { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 };
  const refused = async (document: Document, expected: string, value = input, url = CART_URL) => {
    const seen = watchCart(document);
    const result = await raiseTargetCartQuantity(document, url, plan, value, FAST);
    assert.equal(result.ok, false, expected);
    assert.equal(result.reason, expected);
    assert.deepEqual([seen.clicks, seen.events], [[], []], expected);
    assert.equal((document.getElementById("cartItem-qty-95290386") as HTMLSelectElement | null)?.value ?? "1", "1");
  };
  await refused(cartPage("cart-quantity-select.html"), "cart_page_unverified", input, SHIP_ONLY_URL);
  await refused(cartPage("cart-quantity-select.html"), "quantity_invalid", { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 4 });
  await refused(cartPage("cart-quantity-select.html"), "quantity_invalid", { baselineQuantity: 1, currentQuantity: 1, targetQuantity: 3 });
  await refused(cartPage("cart-quantity-select.html"), "quantity_invalid", { baselineQuantity: 0, currentQuantity: 3, targetQuantity: 2 });
  const duplicate = cartPage("cart-quantity-select.html");
  const copy = cartLine(duplicate, "95290386").cloneNode(true) as Element;
  copy.querySelector("select")?.setAttribute("id", "cartItem-qty-copy");
  cartLine(duplicate, "95290386").after(copy);
  await refused(duplicate, "quantity_line_ambiguous");
  const twoItems = cartPage("cart-quantity-select.html");
  cartLine(twoItems, "95290386").insertAdjacentHTML("beforeend", `<a href="/p/other/-/A-99999999">Other</a>`);
  await refused(twoItems, "quantity_line_ambiguous");
  await refused(cartPage("cart-quantity-select.html"), "cart_delta_unverified", { baselineQuantity: 1, currentQuantity: 2, targetQuantity: 3 });
  const readOnly = cartPage("cart-quantity-select.html");
  const qtyText = readOnly.createElement("span");
  qtyText.setAttribute("data-test", "cartItem-qty");
  qtyText.textContent = "Qty 1";
  readOnly.querySelector("label[for='cartItem-qty-95290386']")?.remove();
  readOnly.getElementById("cartItem-qty-95290386")?.replaceWith(qtyText);
  await refused(readOnly, "quantity_control_unavailable");
  const challenged = cartPage("cart-quantity-select.html");
  challenged.body.insertAdjacentHTML("beforeend", `<iframe src="https://security.example/captcha"></iframe>`);
  await refused(challenged, "manual_action_required");

  // A line that already shows the whole plan is left alone.
  const done = cartPage("cart-quantity-select.html");
  (done.getElementById("cartItem-qty-95290386") as HTMLSelectElement).value = "2";
  const seen = watchCart(done);
  assert.deepEqual(await raiseTargetCartQuantity(done, CART_URL, plan, { baselineQuantity: 0, currentQuantity: 2, targetQuantity: 2 }, FAST),
    { ok: true, reason: "quantity_set", quantity: 2, storeLimit: 2 });
  assert.deepEqual([seen.clicks, seen.events], [[], []]);
});

test("Target exports the cart raise on its runner global", async () => {
  const runner = (globalThis as unknown as { YoinkTargetAction?: Record<string, unknown> }).YoinkTargetAction;
  assert.equal(typeof runner?.raiseTargetCartQuantity, "function");
});
