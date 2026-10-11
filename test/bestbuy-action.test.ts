import { reviewedBrowserJobFixture } from "./helpers/official-msrp-browser.js";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import { BESTBUY_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import {
  commitBestBuyAdd,
  inspectBestBuyCartBaseline,
  inspectBestBuyPostAdd,
  prepareBestBuyAdd,
  raiseBestBuyCartQuantity,
  rehearseBestBuyAdd,
  selectBestBuyShipping,
  type BestBuyAddJob,
  type BestBuyOfferProof,
  verifyBestBuyAddedCart
} from "../apps/extension/src/bestbuy-action.js";
import { observeBestBuyCart } from "../packages/browser-adapters/src/bestbuy.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } } };
const FIXTURES = join(process.cwd(), "test", "fixtures", "retailers");
const PRODUCT_URL = "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149";
const MARKETPLACE_URL = "https://www.bestbuy.com/product/pokemon-tin/JJG2TL3V8K/sku/12716513";
const CART_URL = "https://www.bestbuy.com/cart";
const NOW = new Date("2026-08-23T16:00:00.000Z").getTime();
// The owner's captured product page: its canonical URL names only the product code.
const CAPTURE_URL = "https://www.bestbuy.com/product/ultra-pro-3-x-4-clear-regular-toploader-25-count-pack/J79X4PXVR7";
const CAPTURE_SKU = "6528565";
// Offline replay of a capture uses the visibility the companion recorded.
const CAPTURED_VISIBILITY = { isVisible: (element: Element) => element.getAttribute("data-yoink-vis") === "1" };
const FAST_RAISE = { quietMs: 20, stepTimeoutMs: 400, timeoutMs: 4_000 };
// A simulated store answers each "+" after 30 ms; leave room for a loaded test machine.
const STEPPER_RAISE = { quietMs: 20, stepTimeoutMs: 2_000, timeoutMs: 8_000 };

function fixture(name: string, url: string): Document {
  return new JSDOM(readFileSync(join(FIXTURES, name), "utf8"), { url }).window.document;
}

function product(): Document {
  return fixture("bestbuy-first-party.html", PRODUCT_URL);
}

function semanticDriftProduct(): Document {
  const document = product();
  const price = document.querySelector("[data-testid='customer-price']");
  price?.setAttribute("data-testid", "commerce-amount");
  const packaged = document.querySelector("[data-testid='buy-box'] button");
  if (packaged) {
    const semantic = document.createElement("div");
    semantic.setAttribute("role", "button");
    semantic.setAttribute("tabindex", "0");
    semantic.setAttribute("data-button-state", "primary-cart-action");
    semantic.textContent = "Add to cart";
    packaged.replaceWith(semantic);
  }
  return document;
}

function job(overrides: Partial<BestBuyAddJob> = {}): BestBuyAddJob {
  const base: BrowserActionContract = {
    contractVersion: 1,
    jobId: "job_bestbuy_add_fixture",
    retailerId: "bestbuy",
    retailerSku: "6588149",
    canonicalUrl: PRODUCT_URL,
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: 699,
    maxOrderTotalCents: 699,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Best Buy",
    fulfillment: "shipping",
    expiresAt: new Date(NOW + 60_000).toISOString()
  };
  return reviewedBrowserJobFixture({ ...base, adapterVersion: BESTBUY_ADD_ADAPTER_VERSION, ...overrides }, NOW);
}

test("Best Buy reservation pages need the shopper before Shipping selection or Add preparation", async () => {
  const url = "https://www.bestbuy.com/site/reservation-product/6669869.p";
  const document = fixture("bestbuy-high-velocity-reservation.html", url);
  let clicks = 0;
  document.addEventListener("click", () => { clicks += 1; });
  const exactJob = job({ canonicalUrl: url, retailerSku: "6669869", maxUnitPriceCents: 7499, maxOrderTotalCents: 7499 });
  const selected = await selectBestBuyShipping(document, url, "6669869", undefined, { timeoutMs: 20 });
  assert.deepEqual(selected, { ok: false, reason: "manual_action_required", selectionClicked: false });
  assert.equal(rehearseBestBuyAdd(document, url, exactJob, NOW).reason, "manual_action_required");
  assert.equal(prepareBestBuyAdd(document, url, exactJob, NOW).reason, "manual_action_required");
  assert.equal(clicks, 0);
});

test("Best Buy observes a queue after Add without another click, including Please Wait and queue routes", () => {
  for (const message of ["You're in line", "You are in line", "Please don't refresh or leave this page"]) {
    const d = product();
    let clicks = 0;
    d.querySelector("[data-testid='buy-box'] button")!.addEventListener("click", () => {
      clicks++;
      d.body.insertAdjacentHTML("afterbegin", `<div role="dialog">${message}</div>`);
    });
    const prepared = prepareBestBuyAdd(d, PRODUCT_URL, job(), NOW);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) continue;
    assert.equal(commitBestBuyAdd(d, PRODUCT_URL, job(), prepared.authorizationId, NOW + 1).clicked, true);
    assert.equal(inspectBestBuyPostAdd(d, PRODUCT_URL, job()).state, "queue", message);
    assert.equal(commitBestBuyAdd(d, PRODUCT_URL, job(), prepared.authorizationId, NOW + 2).clicked, false);
    assert.equal(clicks, 1);
  }
  const wait = product();
  const button = wait.querySelector("[data-testid='buy-box'] button")!;
  button.setAttribute("data-testid", "pdp-add-to-cart-6588149");
  button.textContent = "Please Wait…";
  assert.equal(inspectBestBuyPostAdd(wait, PRODUCT_URL, job()).state, "queue");
  wait.body.insertAdjacentHTML("afterbegin", '<dialog open>Confirm your account to continue</dialog>');
  assert.equal(inspectBestBuyPostAdd(wait, PRODUCT_URL, job()).state, "user_action");
  const cartGate = fixture("bestbuy-cart-empty.html", CART_URL);
  cartGate.body.insertAdjacentHTML("afterbegin", '<dialog open>Confirm your account to continue</dialog>');
  assert.equal(inspectBestBuyPostAdd(cartGate, CART_URL, job()).state, "user_action");
  const route = new JSDOM("<main>Loading</main>", { url: "https://www.bestbuy.com/qp" }).window.document;
  assert.equal(inspectBestBuyPostAdd(route, route.URL, job()).state, "queue");
});

test("Best Buy post-Add probes ignore hidden queues, preserve manual gates and reject changed identity", () => {
  const d = product();
  d.body.insertAdjacentHTML("afterbegin", '<div hidden>You are in line</div><script>"waiting room"</script>');
  assert.equal(inspectBestBuyPostAdd(d, PRODUCT_URL, job()).state, "product");
  d.body.insertAdjacentHTML("afterbegin", '<div role="dialog">Added to your cart</div>');
  assert.equal(inspectBestBuyPostAdd(d, PRODUCT_URL, job()).state, "product");
  d.querySelector('[role=dialog]')!.textContent = "Verify your account to continue";
  assert.equal(inspectBestBuyPostAdd(d, PRODUCT_URL, job()).state, "user_action");
  d.querySelector('[role=dialog]')!.remove();
  assert.equal(inspectBestBuyPostAdd(d, PRODUCT_URL, job({ retailerSku: "9999999" })).reason, "listing_mismatch");
  assert.equal(inspectBestBuyPostAdd(d, "https://bestbuy.com.example.org/cart", job()).reason, "page_changed");
});

test("Best Buy distinguishes an unchanged pending cart from a conflicting delta", () => {
  const empty = fixture("bestbuy-cart-empty.html", CART_URL);
  const baseline = inspectBestBuyCartBaseline(empty, CART_URL, NOW);
  const trial = rehearseBestBuyAdd(product(), PRODUCT_URL, job(), NOW);
  assert.equal(baseline.ok, true); assert.equal(trial.ok, true);
  if (!baseline.ok || !trial.ok) return;
  const pending = verifyBestBuyAddedCart(empty, CART_URL, job(), trial.proof, baseline.proof, NOW + 1);
  assert.deepEqual(pending, { ok: false, reason: "cart_delta_unverified", pending: true });
  const wrong = fixture("bestbuy-cart-single.html", CART_URL);
  for (const e of wrong.querySelectorAll('[data-sku-id]')) e.setAttribute('data-sku-id', '9999999');
  const conflict = verifyBestBuyAddedCart(wrong, CART_URL, job(), trial.proof, baseline.proof, NOW + 1);
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.notEqual(conflict.pending, true);
});

test("Best Buy product-code URLs still require the exact page SKU at rehearsal and commit", () => {
  const url = "https://www.bestbuy.com/product/disney-lorcana-winterspell-playmat-dragon-fire/CJ6QGKQ8QQ";
  const document = product();
  assert.equal(rehearseBestBuyAdd(document, url, job(), NOW).ok, true);
  assert.equal(rehearseBestBuyAdd(document, url, job({ retailerSku: "9999999" }), NOW).ok, false);
  const prepared = prepareBestBuyAdd(document, url, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  document.querySelector(".sku-label")!.textContent = "SKU: 9999999";
  const committed = commitBestBuyAdd(document, url, job(), prepared.authorizationId, NOW + 1);
  assert.equal(committed.clicked, false);
});

test("Best Buy uses the captured exact Add control, never Buy Now or the accessory", () => {
  const url = "https://www.bestbuy.com/product/disney-lorcana-winterspell-playmat-dragon-fire/CJ6QGKQ8QQ";
  for (const fulfillment of ["pickup", "shipping"] as const) {
    const document = fixture("bestbuy-lorcana-pickup-buy-now.html", url);
    if (fulfillment === "shipping") {
      for (const radio of document.querySelectorAll("[role='radio']")) {
        radio.setAttribute("aria-checked", String(radio.textContent?.includes("Shipping")));
      }
    }
    const clicks: string[] = [];
    for (const button of document.querySelectorAll("button")) {
      button.addEventListener("click", () => clicks.push(button.getAttribute("data-testid") || ""));
    }
    const exactJob = job({ retailerSku: "6667316", canonicalUrl: url, maxUnitPriceCents: 2499, maxOrderTotalCents: 2499, fulfillment });
    const rehearsal = rehearseBestBuyAdd(document, url, exactJob, NOW);
    assert.equal(rehearsal.ok, fulfillment === "shipping");
    assert.deepEqual(clicks, []);
    const prepared = prepareBestBuyAdd(document, url, exactJob, NOW);
    if (fulfillment === "pickup") {
      assert.deepEqual(prepared, { ok: false, reason: "official_msrp_cart_policy_invalid" });
      assert.equal(commitBestBuyAdd(document, url, exactJob, "no_authorization", NOW + 100).ok, false);
      assert.deepEqual(clicks, []);
      continue;
    }
    assert.equal(prepared.ok, true);
    if (!prepared.ok) continue;
    assert.equal(commitBestBuyAdd(document, url, exactJob, prepared.authorizationId, NOW + 1).clicked, true);
    assert.deepEqual(clicks, ["pdp-add-to-cart-6667316"]);
    document.querySelector("[data-testid='pdp-add-to-cart-6667316']")!.remove();
    assert.equal(prepareBestBuyAdd(document, url, exactJob, NOW + 2).ok, false);
    assert.deepEqual(clicks, ["pdp-add-to-cart-6667316"]);
  }
});

test("Best Buy automatically selects Shipping once and waits for a settled exact offer without adding", async () => {
  const url = "https://www.bestbuy.com/product/disney-lorcana-winterspell-playmat-dragon-fire/CJ6QGKQ8QQ";
  const document = fixture("bestbuy-lorcana-pickup-buy-now.html", url);
  const shipping = document.querySelectorAll("[role='radio']")[1]!;
  const pickup = document.querySelectorAll("[role='radio']")[0]!;
  const clicks: string[] = [];
  document.addEventListener("click", (event) => clicks.push((event.target as Element).getAttribute("role") || "purchase"));
  shipping.addEventListener("click", () => {
    setTimeout(() => {
      pickup.setAttribute("aria-checked", "false");
      shipping.setAttribute("aria-checked", "true");
      document.querySelector("[data-testid='price-block-customer-price']")!.textContent = "$26.99";
    }, 20);
  });
  const result = await selectBestBuyShipping(document, url, "6667316", undefined, { timeoutMs: 600, quietMs: 30 });
  assert.deepEqual(result, { ok: true, reason: "verified", selectionClicked: true });
  assert.deepEqual(clicks, ["radio"]);
  assert.equal((await selectBestBuyShipping(document, url, "6667316")).selectionClicked, false);
  const exactJob = job({ canonicalUrl: url, retailerSku: "6667316", maxUnitPriceCents: 2499, maxOrderTotalCents: 2499 });
  assert.equal(rehearseBestBuyAdd(document, url, exactJob, NOW).reason, "listed_price_changed");
  // Raising a cap does not re-authorize a changed signal price or manufacturer evidence.
  assert.equal(rehearseBestBuyAdd(document, url, { ...exactJob, maxUnitPriceCents: 2699, maxOrderTotalCents: 2699 }, NOW).reason, "official_msrp_authorization_invalid");
  assert.deepEqual(clicks, ["radio"]);
});

test("the packaged Best Buy runner selects Shipping on the incident layout, then qualifies without an Add", async () => {
  const url = "https://www.bestbuy.com/product/disney-lorcana-winterspell-playmat-dragon-fire/CJ6QGKQ8QQ";
  const document = fixture("bestbuy-lorcana-pickup-buy-now.html", url);
  const shipping = document.querySelectorAll("[role='radio']")[1]!;
  const pickup = document.querySelectorAll("[role='radio']")[0]!;
  let shippingClicks = 0;
  let purchaseClicks = 0;
  shipping.addEventListener("click", () => {
    shippingClicks += 1;
    pickup.setAttribute("aria-checked", "false");
    shipping.setAttribute("aria-checked", "true");
  });
  for (const button of document.querySelectorAll("button")) button.addEventListener("click", () => { purchaseClicks += 1; });
  const context = createContext({ document, location: new URL(url), URL, setTimeout, clearTimeout });
  runInContext(readFileSync(join(process.cwd(), "apps/extension/bestbuy-action.js"), "utf8"), context);
  const selected = await runInContext('YoinkBestBuyAction.selectBestBuyShipping(document, location.href, "6667316")', context);
  assert.equal(selected.ok, true);
  const exactJob = job({ canonicalUrl: url, retailerSku: "6667316", maxUnitPriceCents: 2499, maxOrderTotalCents: 2499 });
  const rehearsal = runInContext(`YoinkBestBuyAction.rehearseBestBuyAdd(document, location.href, ${JSON.stringify(exactJob)}, ${NOW})`, context);
  assert.equal(rehearsal.ok, true);
  assert.equal(rehearsal.proof.fulfillment, "shipping");
  assert.equal(shippingClicks, 1);
  assert.equal(purchaseClicks, 0);
});

test("Best Buy Shipping selection never guesses from disabled, hidden, ambiguous, foreign-SKU or purchase controls", async () => {
  const url = "https://www.bestbuy.com/product/disney-lorcana-winterspell-playmat-dragon-fire/CJ6QGKQ8QQ";
  for (const mode of ["disabled", "hidden", "unavailable", "duplicate", "foreign_sku", "checkout", "wrong_page", "challenge", "third_party", "quantity"]) {
    const document = fixture("bestbuy-lorcana-pickup-buy-now.html", url);
    const tile = document.querySelector("[data-testid='pdp-shipping-tile-6667316']")!;
    const control = tile.parentElement!;
    if (mode === "disabled") control.setAttribute("aria-disabled", "true");
    if (mode === "hidden") control.setAttribute("hidden", "");
    if (mode === "unavailable") tile.textContent = "Shipping not available";
    if (mode === "duplicate") control.after(control.cloneNode(true));
    if (mode === "foreign_sku") tile.setAttribute("data-testid", "pdp-shipping-tile-9999999");
    if (mode === "checkout") tile.textContent = "Shipping Buy now Checkout";
    if (mode === "challenge") document.body.insertAdjacentHTML("afterbegin", "<div>Verify you are human</div>");
    if (mode === "third_party") document.querySelector("[data-testid*='sold-by']")!.textContent = "Sold by Other Seller";
    if (mode === "quantity") control.parentElement!.insertAdjacentHTML("beforeend", '<input name="quantity" value="2">');
    let clicks = 0;
    document.addEventListener("click", () => { clicks += 1; });
    const result = await selectBestBuyShipping(document, url, mode === "wrong_page" ? "9999999" : "6667316", undefined, { timeoutMs: 1, quietMs: 0 });
    assert.equal(result.ok, false, mode);
    assert.equal(clicks, 0, mode);
  }
});

test("Best Buy failed or interrupted Shipping selection cannot authorize an Add", async () => {
  const url = "https://www.bestbuy.com/product/disney-lorcana-winterspell-playmat-dragon-fire/CJ6QGKQ8QQ";
  for (const mode of ["no_effect", "changed_sku", "challenge"]) {
    const document = fixture("bestbuy-lorcana-pickup-buy-now.html", url);
    const shipping = document.querySelectorAll("[role='radio']")[1]!;
    const clicks: string[] = [];
    document.addEventListener("click", (event) => clicks.push((event.target as Element).getAttribute("role") || "purchase"));
    shipping.addEventListener("click", () => {
      if (mode === "changed_sku") document.querySelector(".sku-label")!.textContent = "SKU: 9999999";
      if (mode === "challenge") document.body.insertAdjacentHTML("afterbegin", "<div>Verify you are human</div>");
    });
    const result = await selectBestBuyShipping(document, url, "6667316", undefined, { timeoutMs: 10, quietMs: 0 });
    assert.equal(result.ok, false, mode);
    assert.equal(result.reason, mode === "no_effect" ? "fulfillment_selection_failed" : mode === "changed_sku" ? "listing_mismatch" : "manual_action_required");
    assert.deepEqual(clicks, ["radio"]);
  }
});

test("Best Buy rehearsal reaches the exact no-click boundary and high-demand queues fail closed", () => {
  const document = product();
  document.body.insertAdjacentHTML("beforeend", `<script>window.__copy = "Additional security check is required";</script>`);
  let clicks = 0;
  document.querySelector("[data-testid='buy-box'] button")?.addEventListener("click", () => { clicks += 1; });
  const result = rehearseBestBuyAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.wouldClick, true);
  assert.equal(clicks, 0);

  const queued = product();
  queued.body.insertAdjacentHTML("afterbegin", "<div>High Demand Product — join the virtual queue</div>");
  assert.deepEqual(rehearseBestBuyAdd(queued, PRODUCT_URL, job(), NOW), {
    ok: false,
    reason: "manual_action_required"
  });
});

test("Best Buy add consumes its authorization before one click and revalidates the scoped offer", () => {
  const document = product();
  let clicks = 0;
  document.querySelector("[data-testid='buy-box'] button")?.addEventListener("click", () => { clicks += 1; });
  const prepared = prepareBestBuyAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = commitBestBuyAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(committed.clicked, true);
  assert.equal(clicks, 1);
  assert.deepEqual(commitBestBuyAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 200), {
    ok: false,
    reason: "authorization_missing",
    clicked: false
  });
  assert.equal(clicks, 1);

  const changed = product();
  const changedPreparation = prepareBestBuyAdd(changed, PRODUCT_URL, job(), NOW);
  assert.equal(changedPreparation.ok, true);
  if (!changedPreparation.ok) return;
  const price = changed.querySelector("[data-testid='customer-price']");
  if (price) price.textContent = "$9.99";
  assert.deepEqual(commitBestBuyAdd(changed, PRODUCT_URL, job(), changedPreparation.authorizationId, NOW + 100), {
    ok: false,
    reason: "listed_price_changed",
    clicked: false
  });
});

test("Best Buy safely self-heals unique control and price selector drift", () => {
  const document = semanticDriftProduct();
  const control = document.querySelector("[data-button-state='primary-cart-action']");
  assert.ok(control);
  let clicks = 0;
  control.addEventListener("click", () => { clicks += 1; });
  const rehearsal = rehearseBestBuyAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(rehearsal.ok, true);
  assert.equal(clicks, 0);
  const prepared = prepareBestBuyAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = commitBestBuyAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(clicks, 1);

  const ambiguous = semanticDriftProduct();
  const duplicate = ambiguous.querySelector("[data-button-state='primary-cart-action']")?.cloneNode(true);
  if (duplicate) ambiguous.querySelector("[data-testid='buy-box']")?.append(duplicate);
  assert.equal(prepareBestBuyAdd(ambiguous, PRODUCT_URL, job(), NOW).ok, false);
});

test("Best Buy guarded Add requires exact in-stock Shipping and rejects Pickup and preorders", () => {
  for (const quantity of [0, 11, 1.5]) {
    assert.equal(prepareBestBuyAdd(product(), PRODUCT_URL, job({ quantity }), NOW).reason, "quantity_not_supported", String(quantity));
  }
  // A larger quantity must still clear the order-total cap for all of it.
  assert.equal(prepareBestBuyAdd(product(), PRODUCT_URL, job({ quantity: 2 }), NOW).reason, "over_total_cap");
  assert.equal(prepareBestBuyAdd(product(), PRODUCT_URL, job({ action: "prepare_checkout" }), NOW).reason, "unsupported_action");
  assert.equal(prepareBestBuyAdd(product(), PRODUCT_URL, job({ sellerPolicy: "allow_third_party" }), NOW).reason, "seller_policy_not_supported");
  assert.equal(prepareBestBuyAdd(product(), PRODUCT_URL, job({ fulfillment: "either" }), NOW).reason, "fulfillment_not_supported");
  assert.equal(prepareBestBuyAdd(product(), PRODUCT_URL, job({ fulfillment: "pickup" }), NOW).ok, false);

  const marketplace = fixture("bestbuy-marketplace.html", MARKETPLACE_URL);
  const marketplaceJob = job({ canonicalUrl: MARKETPLACE_URL, retailerSku: "12716513", expectedSeller: "Shopville Inc", maxUnitPriceCents: 26799, maxOrderTotalCents: 26799 });
  assert.equal(prepareBestBuyAdd(marketplace, MARKETPLACE_URL, marketplaceJob, NOW).reason, "third_party_seller");
  const pickup = fixture("bestbuy-pickup-selected.html", PRODUCT_URL);
  let pickupClicks = 0;
  pickup.querySelector("button")?.addEventListener("click", () => { pickupClicks += 1; });
  const pickupJob = job({ fulfillment: "pickup" });
  const pickupPreparation = prepareBestBuyAdd(pickup, PRODUCT_URL, pickupJob, NOW);
  assert.deepEqual(pickupPreparation, { ok: false, reason: "official_msrp_cart_policy_invalid" });
  assert.equal(commitBestBuyAdd(pickup, PRODUCT_URL, pickupJob, "no_authorization", NOW + 100).ok, false);
  assert.equal(pickupClicks, 0);

  const preorderUrl = "https://www.bestbuy.com/product/wizards-of-the-coast-magic-the-gathering-reality-fracture-play-booster-box-30-packs/JJ8VP7Z65T/sku/6678193";
  const preorderJob = job({
    canonicalUrl: preorderUrl,
    retailerSku: "6678193",
    maxUnitPriceCents: 15499,
    maxOrderTotalCents: 15499
  });
  const preorder = fixture("bestbuy-reality-fracture-preorder.html", preorderUrl);
  let preorderClicks = 0;
  preorder.querySelector("button")?.addEventListener("click", () => { preorderClicks += 1; });
  const preorderRehearsal = rehearseBestBuyAdd(preorder, preorderUrl, preorderJob, NOW);
  assert.deepEqual(preorderRehearsal, { ok: false, reason: "stock_unverified" });
  assert.equal(preorderClicks, 0);
  const preorderPreparation = prepareBestBuyAdd(preorder, preorderUrl, preorderJob, NOW);
  assert.deepEqual(preorderPreparation, { ok: false, reason: "stock_unverified" });
  assert.equal(commitBestBuyAdd(preorder, preorderUrl, preorderJob, "no_authorization", NOW + 100).ok, false);
  assert.equal(preorderClicks, 0);
});

test("Best Buy v11 reaches the no-click boundary on the modern fulfillment layout", () => {
  const url = "https://www.bestbuy.com/product/ultra-pro-9-pocket-zippered-top-loader-premium-pro-binder/J79X4L6QJF/sku/6670797";
  const document = fixture("bestbuy-modern-first-party.html", url);
  let clicks = 0;
  document.querySelector("[data-testid='fulfillment-purchase-panel'] button")?.addEventListener("click", () => { clicks += 1; });
  const result = rehearseBestBuyAdd(document, url, job({
    retailerSku: "6670797",
    canonicalUrl: url,
    maxUnitPriceCents: 3299,
    maxOrderTotalCents: 3299
  }), NOW);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.wouldClick, true);
  assert.equal(clicks, 0);
});

test("Best Buy v11 uses the primary action when one exact offer also renders a sticky duplicate", () => {
  const url = "https://www.bestbuy.com/product/riftbound-origins-ahri-playmat/J3GWY596JF/sku/6677244";
  const document = fixture("bestbuy-primary-and-sticky-add.html", url);
  const primary = document.querySelector("[data-testid='purchase-controls'] button");
  const sticky = document.querySelector("[data-testid='sticky-product-action'] button");
  let primaryClicks = 0;
  let stickyClicks = 0;
  primary?.addEventListener("click", () => { primaryClicks += 1; });
  sticky?.addEventListener("click", () => { stickyClicks += 1; });
  const exactJob = job({
    retailerSku: "6677244",
    canonicalUrl: url,
    maxUnitPriceCents: 2499,
    maxOrderTotalCents: 2499
  });
  const rehearsal = rehearseBestBuyAdd(document, url, exactJob, NOW);
  assert.equal(rehearsal.ok, true);
  assert.equal(primaryClicks, 0);
  assert.equal(stickyClicks, 0);
  const prepared = prepareBestBuyAdd(document, url, exactJob, NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(commitBestBuyAdd(document, url, exactJob, prepared.authorizationId, NOW + 100).ok, true);
  assert.equal(primaryClicks, 1);
  assert.equal(stickyClicks, 0);
});

test("Best Buy v11 rehearses and commits one exact split-shell action", () => {
  const url = "https://www.bestbuy.com/product/2026-topps-flagship-football-mega-box/J3ZPGXX9RP/sku/6685081";
  const document = fixture("bestbuy-single-split-shell.html", url);
  const control = document.querySelector(".add-to-cart-button");
  let clicks = 0;
  control?.addEventListener("click", () => { clicks += 1; });
  const exactJob = job({
    retailerSku: "6685081",
    canonicalUrl: url,
    maxUnitPriceCents: 4999,
    maxOrderTotalCents: 5999
  });
  const rehearsal = rehearseBestBuyAdd(document, url, exactJob, NOW);
  assert.equal(rehearsal.ok, true);
  assert.equal(clicks, 0);
  const prepared = prepareBestBuyAdd(document, url, exactJob, NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(commitBestBuyAdd(document, url, exactJob, prepared.authorizationId, NOW + 100).ok, true);
  assert.equal(clicks, 1);
});

test("Best Buy cart preflight captures a bounded baseline and post-add proof requires an exact delta", () => {
  const empty = fixture("bestbuy-cart-empty.html", CART_URL);
  const baseline = inspectBestBuyCartBaseline(empty, CART_URL, NOW);
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  assert.deepEqual(baseline.proof.lines, []);
  const cart = fixture("bestbuy-cart-single.html", CART_URL);
  const existing = inspectBestBuyCartBaseline(cart, CART_URL, NOW);
  assert.equal(existing.ok, true);
  if (!existing.ok) return;
  assert.equal(existing.proof.lineCount, 1);
  const prepared = prepareBestBuyAdd(product(), PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const verified = verifyBestBuyAddedCart(cart, CART_URL, job(), prepared.proof, baseline.proof, NOW + 500);
  assert.equal(verified.ok, true);
});

// ---------------------------------------------------------------------------
// Quantity, honest reasons, SKU-less cart lines and the cart quantity raise.

function capture(shippingAvailable: boolean): Document {
  const document = fixture("bestbuy-toploader-capture.html", CAPTURE_URL);
  if (!shippingAvailable) return document;
  // The captured page after Shipping is chosen: the tile offers delivery and is checked.
  const tile = document.querySelector(`[data-testid='pdp-shipping-tile-${CAPTURE_SKU}']`)!;
  tile.setAttribute("aria-label", "Shipping Get it by Thu, Oct 2");
  document.querySelector(`[data-testid='pdp-shipping-primary-description-${CAPTURE_SKU}']`)!.textContent = "Get it by";
  document.querySelector(`[data-testid='pdp-shipping-secondary-description-${CAPTURE_SKU}']`)!.textContent = "Thu, Oct 2";
  tile.closest("[role='radio']")!.setAttribute("aria-checked", "true");
  document.querySelector(`[data-testid='pdp-pickup-tile-${CAPTURE_SKU}-selected']`)!.closest("[role='radio']")!.setAttribute("aria-checked", "false");
  return document;
}

function captureJob(overrides: Partial<BestBuyAddJob> = {}): BestBuyAddJob {
  return job({
    retailerSku: CAPTURE_SKU,
    canonicalUrl: `https://www.bestbuy.com/site/-/${CAPTURE_SKU}.p`,
    maxUnitPriceCents: 549,
    maxOrderTotalCents: 549,
    ...overrides
  });
}

function cart(name: string): Document {
  return fixture(name, CART_URL);
}

function lineSelect(document: Document, index = 0): HTMLSelectElement {
  return document.querySelectorAll<HTMLSelectElement>("select[aria-label='Quantity']")[index]!;
}

// The first select-fixture line at `quantity` units, with its matching $5.49-a-unit line total.
function firstLineAt(document: Document, quantity: number): void {
  lineSelect(document).value = String(quantity);
  document.querySelector("[data-testid='line-price']")!.textContent = `$${(5.49 * quantity).toFixed(2)}`;
}

test("the captured Best Buy product page prepares one unit unchanged and binds its product code", () => {
  const document = capture(true);
  const clicks: string[] = [];
  document.addEventListener("click", (event) => clicks.push((event.target as Element).closest("button")?.getAttribute("data-testid") || "other"));
  const prepared = prepareBestBuyAdd(document, CAPTURE_URL, captureJob(), NOW, CAPTURED_VISIBILITY);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal("quantity" in prepared, false, "one unit is prepared exactly as before");
  assert.equal(prepared.proof.unitPriceCents, 549);
  assert.equal(prepared.proof.productCode, "J79X4PXVR7");
  assert.deepEqual(clicks, []);
  const committed = commitBestBuyAdd(document, CAPTURE_URL, captureJob(), prepared.authorizationId, NOW + 1, CAPTURED_VISIBILITY);
  assert.equal(committed.ok, true);
  if (committed.ok) assert.equal(committed.proof.productCode, "J79X4PXVR7");
  // Never Buy now, the key accessory or the sponsored item.
  assert.deepEqual(clicks, [`pdp-add-to-cart-${CAPTURE_SKU}`]);

  // The page has no quantity control: two units are one Add plus a cart raise.
  const two = prepareBestBuyAdd(capture(true), CAPTURE_URL, captureJob({ quantity: 2, maxOrderTotalCents: 1098 }), NOW, CAPTURED_VISIBILITY);
  assert.equal(two.ok, true);
  if (two.ok) assert.deepEqual(two.quantity, { requested: 2, storeLimit: null, add: 1, raiseTo: 2 });
  const limited = capture(true);
  limited.querySelector(`[data-testid='pdp-add-to-cart-${CAPTURE_SKU}']`)!.closest("[data-component-name='AddToCart']")!
    .insertAdjacentHTML("beforeend", "<p data-yoink-vis='1'>Limit 1 per customer</p>");
  const capped = prepareBestBuyAdd(limited, CAPTURE_URL, captureJob({ quantity: 2, maxOrderTotalCents: 1098 }), NOW, CAPTURED_VISIBILITY);
  assert.equal(capped.ok, true);
  if (capped.ok) assert.deepEqual(capped.quantity, { requested: 2, storeLimit: 1, add: 1, raiseTo: 1 });
  // A limit printed on the key-accessory offer is not this item's limit.
  const accessory = capture(true);
  const sleeves = [...accessory.querySelectorAll("a[href*='/J79X4P86LV/']")][0]!;
  sleeves.insertAdjacentHTML("afterend", "<p data-yoink-vis='1'>Limit 1 per customer</p>");
  const unaffected = prepareBestBuyAdd(accessory, CAPTURE_URL, captureJob({ quantity: 2, maxOrderTotalCents: 1098 }), NOW, CAPTURED_VISIBILITY);
  assert.equal(unaffected.ok, true);
  if (unaffected.ok) assert.equal(unaffected.quantity?.storeLimit, null);
});

test("Best Buy plans a larger quantity as one Add plus a cart raise, capped by the buy box's stated limit", () => {
  const three = job({ quantity: 3, maxOrderTotalCents: 2097 });
  const document = product();
  let clicks = 0;
  document.addEventListener("click", () => { clicks += 1; });
  const prepared = prepareBestBuyAdd(document, PRODUCT_URL, three, NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.deepEqual(prepared.quantity, { requested: 3, storeLimit: null, add: 1, raiseTo: 3 });
  assert.equal(commitBestBuyAdd(document, PRODUCT_URL, three, prepared.authorizationId, NOW + 1).clicked, true);
  assert.equal(clicks, 1, "one Add click adds one unit");

  for (const [text, limit] of [["Limit 2 per customer", 2], ["Limit 1 per order", 1], ["Limited to 5 per household", 5]] as const) {
    const limited = product();
    limited.querySelector("[data-testid='buy-box']")!.insertAdjacentHTML("beforeend", `<p>${text}</p>`);
    const plan = prepareBestBuyAdd(limited, PRODUCT_URL, three, NOW);
    assert.equal(plan.ok, true, text);
    if (plan.ok) assert.deepEqual(plan.quantity, { requested: 3, storeLimit: limit, add: 1, raiseTo: Math.min(3, limit) }, text);
  }
  const carousel = product();
  carousel.querySelector(".recommendations")!.insertAdjacentHTML("beforeend", "<p>Limit 1 per customer</p>");
  const unaffected = prepareBestBuyAdd(carousel, PRODUCT_URL, three, NOW);
  assert.equal(unaffected.ok && unaffected.quantity?.storeLimit, null);
  const rehearsal = rehearseBestBuyAdd(product(), PRODUCT_URL, three, NOW);
  assert.equal(rehearsal.ok && rehearsal.quantity?.raiseTo, 3);
  // A product-page picker that would add more than one is never bound.
  const picker = product();
  picker.querySelector("[data-testid='buy-box']")!.insertAdjacentHTML("afterbegin",
    "<select name='quantity'><option value='1'>1</option><option value='2' selected>2</option></select>");
  assert.equal(prepareBestBuyAdd(picker, PRODUCT_URL, three, NOW).ok, false);
});

test("Best Buy reports an unbound Add as add_control_unavailable and only stated unavailability as out of stock", () => {
  const ambiguous = semanticDriftProduct();
  ambiguous.querySelector("[data-testid='buy-box']")!.append(ambiguous.querySelector("[data-button-state='primary-cart-action']")!.cloneNode(true));
  assert.deepEqual(prepareBestBuyAdd(ambiguous, PRODUCT_URL, job(), NOW), { ok: false, reason: "add_control_unavailable" });
  const missing = product();
  missing.querySelector("[data-testid='buy-box'] button")!.remove();
  assert.deepEqual(prepareBestBuyAdd(missing, PRODUCT_URL, job(), NOW), { ok: false, reason: "add_control_unavailable" });
  assert.deepEqual(rehearseBestBuyAdd(missing, PRODUCT_URL, job(), NOW), { ok: false, reason: "add_control_unavailable" });

  // The captured page states "Shipping Unavailable" for this SKU: out of stock for a Shipping job.
  const captured = capture(false);
  let clicks = 0;
  captured.addEventListener("click", () => { clicks += 1; });
  assert.deepEqual(prepareBestBuyAdd(captured, CAPTURE_URL, captureJob(), NOW, CAPTURED_VISIBILITY), { ok: false, reason: "out_of_stock" });
  const silent = capture(false);
  silent.querySelector(`[data-testid='pdp-shipping-tile-${CAPTURE_SKU}']`)!.setAttribute("aria-label", "Shipping");
  silent.querySelector(`[data-testid='pdp-shipping-primary-description-${CAPTURE_SKU}']`)!.textContent = "";
  assert.deepEqual(prepareBestBuyAdd(silent, CAPTURE_URL, captureJob(), NOW, CAPTURED_VISIBILITY), { ok: false, reason: "add_control_unavailable" });
  assert.equal(clicks, 0);

  // A binding lost between prepare and commit is reported the same way, without a click.
  const lost = product();
  const prepared = prepareBestBuyAdd(lost, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  lost.querySelector("[data-testid='buy-box'] button")!.remove();
  assert.deepEqual(commitBestBuyAdd(lost, PRODUCT_URL, job(), prepared.authorizationId, NOW + 1),
    { ok: false, reason: "add_control_unavailable", clicked: false });
});

test("Best Buy reads each cart line's own selected quantity, never its option list or a plan row", () => {
  const document = cart("bestbuy-cart-quantity-select.html");
  const read = () => observeBestBuyCart(document, new Date(NOW).toISOString());
  assert.equal(read().complete, true);
  // The first line's total is for two units; the plan row's SKU, price and picker are not the line's.
  assert.deepEqual(read().lines.map((line) => [line.retailerSku, line.quantity, line.unitPriceCents]),
    [[CAPTURE_SKU, 2, 549], ["12941988", 1, 999]]);
  for (const value of [1, 3, 5]) {
    firstLineAt(document, value);
    assert.deepEqual(read().lines.map((line) => [line.quantity, line.unitPriceCents]), [[value, 549], [1, 999]]);
  }
  const plain = cart("bestbuy-cart-quantity-select.html");
  for (const option of lineSelect(plain).options) option.removeAttribute("value");
  assert.equal(observeBestBuyCart(plain).lines[0]?.quantity, 2, "options without values read their selected text");

  const stepper = cart("bestbuy-cart-stepper.html");
  assert.deepEqual(observeBestBuyCart(stepper).lines.map((line) => [line.retailerSku, line.quantity, line.unitPriceCents]), [[CAPTURE_SKU, 2, 549]]);
  stepper.querySelector("[data-testid='quantity-value']")!.remove();
  assert.equal(observeBestBuyCart(stepper).lines[0]?.quantity, null, "a stepper without a readable number is no reading");
  assert.deepEqual(inspectBestBuyCartBaseline(stepper, CART_URL, NOW), { ok: false, reason: "cart_unverified" });

  const disagreeing = cart("bestbuy-cart-quantity-select.html");
  disagreeing.querySelector(".item-list-item .fluid-item")!.insertAdjacentHTML("beforeend",
    "<input type='number' aria-label='Quantity' value='3'>");
  assert.equal(observeBestBuyCart(disagreeing).lines[0]?.quantity, null);

  // A line that names two SKUs is unidentifiable, so the cart cannot be proven.
  const twoSkus = cart("bestbuy-cart-quantity-select.html");
  twoSkus.querySelector(".protection-plan")!.removeAttribute("class");
  assert.equal(observeBestBuyCart(twoSkus).lines[1]?.retailerSku, "");
  assert.deepEqual(inspectBestBuyCartBaseline(twoSkus, CART_URL, NOW), { ok: false, reason: "cart_unverified" });
});

test("Best Buy matches SKU-less /product/<slug>/<code> cart lines only through the code the product page proved", () => {
  const rehearsal = rehearseBestBuyAdd(capture(true), CAPTURE_URL, captureJob(), NOW, CAPTURED_VISIBILITY);
  assert.equal(rehearsal.ok, true);
  if (!rehearsal.ok) return;
  assert.equal(rehearsal.proof.productCode, "J79X4PXVR7");
  // Before the Add the cart holds another product that also links only by its code.
  const before = cart("bestbuy-cart-product-code.html");
  before.querySelector("[data-testid='cart-item']")!.remove();
  const baseline = inspectBestBuyCartBaseline(before, CART_URL, NOW);
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  assert.deepEqual(baseline.proof.lines, [{ retailerSku: "J79X4P86LV", quantity: 1 }]);

  const after = cart("bestbuy-cart-product-code.html");
  const verified = verifyBestBuyAddedCart(after, CART_URL, captureJob(), rehearsal.proof, baseline.proof, NOW + 500);
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.proof.retailerSku, CAPTURE_SKU);
    assert.equal(verified.proof.unitPriceCents, 549);
    // The next job reuses this baseline under its own binding: it is read without this one.
    assert.deepEqual(verified.cartBaseline?.lines, [{ retailerSku: "J79X4P86LV", quantity: 1 }, { retailerSku: "J79X4PXVR7", quantity: 1 }]);
  }
  // Without the page's code the new line is never taken for this SKU.
  const unbound: BestBuyOfferProof = { ...rehearsal.proof };
  delete unbound.productCode;
  assert.deepEqual(verifyBestBuyAddedCart(after, CART_URL, captureJob(), unbound, baseline.proof, NOW + 500),
    { ok: false, reason: "cart_delta_unverified" });
  assert.equal(verifyBestBuyAddedCart(after, CART_URL, captureJob(), { ...rehearsal.proof, productCode: "J79X4P86LV" }, baseline.proof, NOW + 500).ok, false);

  // Already in the cart before the product page was seen: both sides bind the same way.
  const owned = inspectBestBuyCartBaseline(cart("bestbuy-cart-product-code.html"), CART_URL, NOW);
  assert.equal(owned.ok, true);
  if (!owned.ok) return;
  const raised = cart("bestbuy-cart-product-code.html");
  lineSelect(raised).value = "2";
  assert.equal(verifyBestBuyAddedCart(raised, CART_URL, captureJob(), rehearsal.proof, owned.proof, NOW + 500).ok, true);
  assert.deepEqual(verifyBestBuyAddedCart(cart("bestbuy-cart-product-code.html"), CART_URL, captureJob(), rehearsal.proof, owned.proof, NOW + 500),
    { ok: false, reason: "cart_delta_unverified", pending: true });

  // Two lines carrying the job's code, or a line with no identity at all, are never guessed.
  const twice = cart("bestbuy-cart-product-code.html");
  const first = twice.querySelector("[data-testid='cart-item']")!;
  first.after(first.cloneNode(true));
  assert.equal(verifyBestBuyAddedCart(twice, CART_URL, captureJob(), rehearsal.proof, baseline.proof, NOW + 500).ok, false);
  const anonymous = cart("bestbuy-cart-product-code.html");
  for (const anchor of anonymous.querySelectorAll("[data-testid='cart-item']:last-of-type a")) anchor.remove();
  assert.deepEqual(inspectBestBuyCartBaseline(anonymous, CART_URL, NOW), { ok: false, reason: "cart_unverified" });
  assert.equal(verifyBestBuyAddedCart(anonymous, CART_URL, captureJob(), rehearsal.proof, baseline.proof, NOW + 500).ok, false);
  // An explicit SKU on the line outranks the code binding.
  const explicit = cart("bestbuy-cart-product-code.html");
  explicit.querySelector("[data-testid='cart-item']")!.setAttribute("data-sku-id", "9999999");
  assert.equal(observeBestBuyCart(explicit, new Date(NOW).toISOString(), { productCode: "J79X4PXVR7", retailerSku: CAPTURE_SKU }).lines[0]?.retailerSku, "9999999");
});

test("Best Buy raises only the job's cart line select, once, up to the target or the select's highest option", async () => {
  const document = cart("bestbuy-cart-quantity-select.html");
  const events: string[] = [];
  document.addEventListener("change", (event) => events.push(`${lineSelect(document, 1) === event.target ? "other" : "job"}:${(event.target as HTMLSelectElement).value}`));
  document.addEventListener("click", () => events.push("click"));
  const three = captureJob({ quantity: 3, maxOrderTotalCents: 1647 });
  assert.deepEqual(await raiseBestBuyCartQuantity(document, CART_URL, three, { baselineQuantity: 1, currentQuantity: 2, targetQuantity: 4 }, null, FAST_RAISE),
    { ok: true, reason: "quantity_set", quantity: 4, storeLimit: 5 });
  assert.deepEqual(events, ["job:4"]);
  assert.equal(lineSelect(document, 1).value, "1", "the other line is untouched");
  assert.equal(observeBestBuyCart(document).lines[0]?.quantity, 4);

  const capped = cart("bestbuy-cart-quantity-select.html");
  firstLineAt(capped, 1);
  const seven = captureJob({ quantity: 7, maxOrderTotalCents: 549 * 7 });
  assert.deepEqual(await raiseBestBuyCartQuantity(capped, CART_URL, seven, { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 7 }, null, FAST_RAISE),
    { ok: true, reason: "quantity_set", quantity: 5, storeLimit: 5 });

  const limited = cart("bestbuy-cart-quantity-select.html");
  firstLineAt(limited, 1);
  limited.querySelector(".fluid-item")!.insertAdjacentHTML("beforeend", "<p>Limit 2 per customer</p>");
  assert.deepEqual(await raiseBestBuyCartQuantity(limited, CART_URL, three, { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 }, null, FAST_RAISE),
    { ok: true, reason: "quantity_set", quantity: 2, storeLimit: 2 });

  const single = cart("bestbuy-cart-single.html");
  const singleEvents: string[] = [];
  single.addEventListener("change", () => singleEvents.push("change"));
  const cable = job({ quantity: 3, maxOrderTotalCents: 2097 });
  assert.deepEqual(await raiseBestBuyCartQuantity(single, CART_URL, cable, { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 }, null, FAST_RAISE),
    { ok: false, reason: "quantity_limit_reached", quantity: 1, storeLimit: 1 });
  assert.deepEqual(singleEvents, []);
});

test("Best Buy raises a +/- stepper one confirmed step at a time and stops where the store stops", async () => {
  const setup = (onStep: (value: number, plus: Element, document: Document) => void) => {
    const document = cart("bestbuy-cart-stepper.html");
    const shown = document.querySelector("[data-testid='quantity-value']")!;
    const plus = document.querySelector("[aria-label='Increase quantity']")!;
    const clicks: string[] = [];
    document.addEventListener("click", (event) => clicks.push((event.target as Element).getAttribute("aria-label") || (event.target as Element).textContent || ""));
    plus.addEventListener("click", () => setTimeout(() => onStep(Number(shown.textContent), plus, document), 30));
    return { document, shown, clicks };
  };
  const step = (value: number, _plus: Element, document: Document) => {
    document.querySelector("[data-testid='quantity-value']")!.textContent = String(value + 1);
  };
  const three = captureJob({ quantity: 3, maxOrderTotalCents: 1647 });
  const normal = setup(step);
  assert.deepEqual(await raiseBestBuyCartQuantity(normal.document, CART_URL, three, { baselineQuantity: 1, currentQuantity: 2, targetQuantity: 4 }, null, STEPPER_RAISE),
    { ok: true, reason: "quantity_set", quantity: 4, storeLimit: null });
  assert.deepEqual(normal.clicks, ["Increase quantity", "Increase quantity"]);

  const four = captureJob({ quantity: 4, maxOrderTotalCents: 549 * 4 });
  const disabling = setup((value, plus, document) => {
    step(value, plus, document);
    if (value + 1 >= 3) plus.setAttribute("disabled", "");
  });
  assert.deepEqual(await raiseBestBuyCartQuantity(disabling.document, CART_URL, four, { baselineQuantity: 1, currentQuantity: 2, targetQuantity: 5 }, null, STEPPER_RAISE),
    { ok: false, reason: "quantity_limit_reached", quantity: 3, storeLimit: 3 });
  assert.deepEqual(disabling.clicks, ["Increase quantity"]);

  const messaging = setup((value, plus, document) => {
    step(value, plus, document);
    if (value + 1 >= 3) document.querySelector("[data-testid='cart-item']")!.insertAdjacentHTML("beforeend", "<p>Limit 3 per customer</p>");
  });
  assert.deepEqual(await raiseBestBuyCartQuantity(messaging.document, CART_URL, four, { baselineQuantity: 1, currentQuantity: 2, targetQuantity: 5 }, null, STEPPER_RAISE),
    { ok: false, reason: "quantity_limit_reached", quantity: 3, storeLimit: 3 });
  assert.deepEqual(messaging.clicks, ["Increase quantity"]);

  const ignoring = setup(() => undefined);
  assert.deepEqual(await raiseBestBuyCartQuantity(ignoring.document, CART_URL, three, { baselineQuantity: 1, currentQuantity: 2, targetQuantity: 4 }, null, STEPPER_RAISE),
    { ok: false, reason: "quantity_unchanged", quantity: 2, storeLimit: null });
  assert.deepEqual(ignoring.clicks, ["Increase quantity"], "an ignored step is never repeated");
});

test("Best Buy refuses to raise an ambiguous, unbound, changed, out-of-bounds or gated cart line", async () => {
  const three = captureJob({ quantity: 3, maxOrderTotalCents: 1647 });
  const input = { baselineQuantity: 1, currentQuantity: 2, targetQuantity: 4 };
  const attempt = async (document: Document, overrides: Partial<typeof input> = {}, job = three, url = CART_URL, proof: BestBuyOfferProof | null = null) => {
    const events: string[] = [];
    for (const type of ["change", "input", "click"]) document.addEventListener(type, () => events.push(type));
    const result = await raiseBestBuyCartQuantity(document, url, job, { ...input, ...overrides }, proof, FAST_RAISE);
    return { result, events };
  };
  const duplicate = cart("bestbuy-cart-quantity-select.html");
  const line = duplicate.querySelector(".item-list-item")!;
  line.after(line.cloneNode(true));
  assert.deepEqual(await attempt(duplicate), { result: { ok: false, reason: "quantity_line_ambiguous" }, events: [] });
  for (const overrides of [{ targetQuantity: 5 }, { targetQuantity: 1 }, { currentQuantity: 1 }, { baselineQuantity: -1 }, { targetQuantity: 3.5 }]) {
    assert.deepEqual(await attempt(cart("bestbuy-cart-quantity-select.html"), overrides),
      { result: { ok: false, reason: "quantity_target_invalid" }, events: [] }, JSON.stringify(overrides));
  }
  assert.deepEqual(await attempt(cart("bestbuy-cart-quantity-select.html"), { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 }),
    { result: { ok: false, reason: "quantity_line_changed", quantity: 2 }, events: [] });
  const product = fixture("bestbuy-cart-quantity-select.html", CAPTURE_URL);
  assert.deepEqual((await attempt(product, {}, three, CAPTURE_URL)).result, { ok: false, reason: "cart_page_unverified" });
  const challenged = cart("bestbuy-cart-quantity-select.html");
  challenged.body.insertAdjacentHTML("afterbegin", "<div>Verify you are human</div>");
  assert.deepEqual((await attempt(challenged)).result, { ok: false, reason: "manual_action_required" });
  const marketplace = cart("bestbuy-cart-quantity-select.html");
  marketplace.querySelector("[data-testid='sold-by']")!.textContent = "Sold by Shopville Inc";
  assert.deepEqual((await attempt(marketplace)).result, { ok: false, reason: "third_party_seller" });
  assert.deepEqual((await attempt(cart("bestbuy-cart-quantity-select.html"), {}, captureJob({ quantity: 3, maxUnitPriceCents: 500, maxOrderTotalCents: 1500 }))).result,
    { ok: false, reason: "over_unit_cap", quantity: 2, storeLimit: 5 });
  const disabled = cart("bestbuy-cart-quantity-select.html");
  lineSelect(disabled).setAttribute("disabled", "");
  assert.deepEqual(await attempt(disabled), { result: { ok: false, reason: "quantity_control_unavailable", quantity: 2, storeLimit: 5 }, events: [] });

  // A line linked only by its product code is this job's only through the add proof.
  const coded = cart("bestbuy-cart-product-code.html");
  const codedInput = { baselineQuantity: 0, currentQuantity: 1, targetQuantity: 3 };
  assert.deepEqual((await attempt(coded, codedInput)).result, { ok: false, reason: "quantity_line_missing" });
  const rehearsal = rehearseBestBuyAdd(capture(true), CAPTURE_URL, captureJob(), NOW, CAPTURED_VISIBILITY);
  assert.equal(rehearsal.ok, true);
  if (!rehearsal.ok) return;
  assert.deepEqual((await attempt(cart("bestbuy-cart-product-code.html"), codedInput, three, CART_URL, rehearsal.proof)).result,
    { ok: true, reason: "quantity_set", quantity: 3, storeLimit: 3 });
});

test("the packaged Best Buy runner exposes the cart quantity raise", async () => {
  const dom = new JSDOM(readFileSync(join(FIXTURES, "bestbuy-cart-quantity-select.html"), "utf8"), { url: CART_URL, runScripts: "outside-only" } as never) as unknown as {
    getInternalVMContext(): object; window: { close(): void; document: Document };
  };
  try {
    const context = dom.getInternalVMContext();
    runInContext(readFileSync(join(process.cwd(), "apps/extension/bestbuy-action.js"), "utf8"), context);
    const three = captureJob({ quantity: 3, maxOrderTotalCents: 1647 });
    const result = await runInContext(`YoinkBestBuyAction.raiseBestBuyCartQuantity(document, location.href, ${JSON.stringify(three)},
      { baselineQuantity: 1, currentQuantity: 2, targetQuantity: 4 }, null, ${JSON.stringify(FAST_RAISE)})`, context);
    assert.equal(result.ok, true);
    assert.equal(result.quantity, 4);
    assert.equal(dom.window.document.querySelector<HTMLSelectElement>("select[aria-label='Quantity']")!.value, "4");
  } finally {
    dom.window.close();
  }
});
