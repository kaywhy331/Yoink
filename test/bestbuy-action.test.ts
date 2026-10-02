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
  rehearseBestBuyAdd,
  selectBestBuyShipping,
  type BestBuyAddJob,
  verifyBestBuyAddedCart
} from "../apps/extension/src/bestbuy-action.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } } };
const FIXTURES = join(process.cwd(), "test", "fixtures", "retailers");
const PRODUCT_URL = "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149";
const MARKETPLACE_URL = "https://www.bestbuy.com/product/pokemon-tin/JJG2TL3V8K/sku/12716513";
const CART_URL = "https://www.bestbuy.com/cart";
const NOW = new Date("2026-08-23T16:00:00.000Z").getTime();

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
  assert.equal(prepareBestBuyAdd(product(), PRODUCT_URL, job({ quantity: 2 }), NOW).reason, "quantity_not_supported");
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
