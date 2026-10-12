import { reviewedBrowserJobFixture } from "./helpers/official-msrp-browser.js";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import { observeAmazonCart } from "../packages/browser-adapters/src/amazon.js";
import { AMAZON_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import {
  commitAmazonAdd,
  inspectAmazonCartBaseline,
  prepareAmazonAdd,
  rehearseAmazonAdd,
  selectAmazonOwnOffer,
  type AmazonAddJob,
  verifyAmazonAddedCart
} from "../apps/extension/src/amazon-action.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } } };
const RETAILER_FIXTURES = join(process.cwd(), "test", "fixtures", "retailers");
const AMAZON_FIXTURES = join(process.cwd(), "test", "fixtures", "amazon");
const PRODUCT_URL = "https://www.amazon.com/dp/B0GYTRYV7P";
const CART_URL = "https://www.amazon.com/gp/cart/view.html";
const NOW = new Date("2026-08-23T16:00:00.000Z").getTime();

function product(name = "amazon-first-party.html", url = PRODUCT_URL): Document {
  return new JSDOM(readFileSync(join(RETAILER_FIXTURES, name), "utf8"), { url }).window.document;
}

function semanticDriftProduct(): Document {
  const document = product();
  const price = document.querySelector("#corePrice_feature_div");
  price?.removeAttribute("id");
  price?.setAttribute("data-testid", "commerce-amount");
  price?.querySelector(".a-offscreen")?.removeAttribute("class");
  const control = document.querySelector("#add-to-cart-button");
  control?.removeAttribute("id");
  control?.removeAttribute("name");
  control?.setAttribute("data-button-state", "primary-cart-action");
  return document;
}

function pickupProduct(): Document {
  const document = product();
  document.querySelector("form")?.insertAdjacentHTML(
    "beforeend",
    "<div data-feature-name='delivery-option' role='radio' aria-selected='true'>Pickup at Amazon Locker</div>"
  );
  return document;
}

function job(overrides: Partial<AmazonAddJob> = {}): AmazonAddJob {
  const base: BrowserActionContract = {
    contractVersion: 1,
    jobId: "job_amazon_add_fixture",
    retailerId: "amazon",
    retailerSku: "B0GYTRYV7P",
    canonicalUrl: PRODUCT_URL,
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: 2186,
    maxOrderTotalCents: 2200,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Amazon.com",
    fulfillment: "shipping",
    expiresAt: new Date(NOW + 60_000).toISOString()
  };
  return reviewedBrowserJobFixture({ ...base, adapterVersion: AMAZON_ADD_ADAPTER_VERSION, ...overrides }, NOW);
}

test("Amazon rehearsal reaches one exact no-click boundary without exposing the offer ID", () => {
  const document = product();
  let clicks = 0;
  document.querySelector("#add-to-cart-button")?.addEventListener("click", (event) => {
    event.preventDefault();
    clicks += 1;
  });
  const result = rehearseAmazonAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.wouldClick, true);
  assert.equal(JSON.stringify(result).includes("FIXTURE+OFFER/ONE=="), false);
  assert.equal(clicks, 0);

  const queued = product();
  queued.body.insertAdjacentHTML("afterbegin", "<div role='dialog'>You’re in line in our virtual queue</div>");
  assert.deepEqual(rehearseAmazonAdd(queued, PRODUCT_URL, job(), NOW), {
    ok: false,
    reason: "manual_action_required"
  });
});

test("Amazon add consumes authorization once and revalidates the same ephemeral offer binding", () => {
  const document = product();
  let clicks = 0;
  document.querySelector("#add-to-cart-button")?.addEventListener("click", (event) => {
    event.preventDefault();
    clicks += 1;
  });
  const prepared = prepareAmazonAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  assert.equal(JSON.stringify(prepared).includes("FIXTURE+OFFER/ONE=="), false);
  if (!prepared.ok) return;
  const committed = commitAmazonAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(committed.clicked, true);
  assert.equal(clicks, 1);
  assert.deepEqual(commitAmazonAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 200), {
    ok: false,
    reason: "authorization_missing",
    clicked: false
  });

  const changed = product();
  const changedPreparation = prepareAmazonAdd(changed, PRODUCT_URL, job(), NOW);
  assert.equal(changedPreparation.ok, true);
  if (!changedPreparation.ok) return;
  const offer = changed.querySelector("input[name='offerListingID']") as HTMLInputElement | null;
  if (offer) offer.value = "DIFFERENT_EPHEMERAL_OFFER";
  assert.deepEqual(commitAmazonAdd(changed, PRODUCT_URL, job(), changedPreparation.authorizationId, NOW + 100), {
    ok: false,
    reason: "offer_binding_changed",
    clicked: false
  });
});

test("Amazon safely self-heals unique control and price selector drift", () => {
  const document = semanticDriftProduct();
  const control = document.querySelector("[data-button-state='primary-cart-action']");
  assert.ok(control);
  let clicks = 0;
  control.addEventListener("click", (event) => {
    event.preventDefault();
    clicks += 1;
  });
  const rehearsal = rehearseAmazonAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(rehearsal.ok, true);
  assert.equal(clicks, 0);
  const prepared = prepareAmazonAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = commitAmazonAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(clicks, 1);

  const ambiguous = semanticDriftProduct();
  const duplicate = ambiguous.querySelector("[data-button-state='primary-cart-action']")?.cloneNode(true);
  if (duplicate) ambiguous.querySelector("form")?.append(duplicate);
  assert.equal(prepareAmazonAdd(ambiguous, PRODUCT_URL, job(), NOW).ok, false);
});

test("Amazon guarded Add rejects ambiguity and Pickup even with an exact selected pickup offer", () => {
  assert.equal(prepareAmazonAdd(product("amazon-marketplace.html"), PRODUCT_URL, job(), NOW).reason, "third_party_seller");
  const separatedMarketplaceUrl = "https://www.amazon.com/dp/B081J5PW5J";
  assert.equal(prepareAmazonAdd(
    product("amazon-offer-display-separated-marketplace.html", separatedMarketplaceUrl),
    separatedMarketplaceUrl,
    job({
      retailerSku: "B081J5PW5J",
      canonicalUrl: separatedMarketplaceUrl,
      maxUnitPriceCents: 1200,
      maxOrderTotalCents: 1200
    }),
    NOW
  ).reason, "third_party_seller");
  assert.equal(prepareAmazonAdd(product(), PRODUCT_URL, job({ quantity: 11, maxOrderTotalCents: 24_046 }), NOW).reason, "quantity_not_supported");
  assert.equal(prepareAmazonAdd(product(), PRODUCT_URL, job({ quantity: 2 }), NOW).reason, "over_total_cap", "two units must fit the order cap");
  assert.equal(prepareAmazonAdd(product(), PRODUCT_URL, job({ action: "prepare_checkout" }), NOW).reason, "unsupported_action");
  assert.equal(prepareAmazonAdd(product(), PRODUCT_URL, job({ sellerPolicy: "allow_third_party" }), NOW).reason, "seller_policy_not_supported");
  assert.equal(prepareAmazonAdd(product(), PRODUCT_URL, job({ fulfillment: "either" }), NOW).reason, "fulfillment_not_supported");
  assert.equal(prepareAmazonAdd(product(), PRODUCT_URL, job({ fulfillment: "pickup" }), NOW).ok, false);

  const pickup = pickupProduct();
  let pickupClicks = 0;
  pickup.querySelector("#add-to-cart-button")?.addEventListener("click", (event) => {
    event.preventDefault();
    pickupClicks += 1;
  });
  const pickupJob = job({ fulfillment: "pickup" });
  const pickupPreparation = prepareAmazonAdd(pickup, PRODUCT_URL, pickupJob, NOW);
  assert.deepEqual(pickupPreparation, { ok: false, reason: "official_msrp_cart_policy_invalid" });
  assert.equal(commitAmazonAdd(pickup, PRODUCT_URL, pickupJob, "no_authorization", NOW + 100).ok, false);
  assert.equal(pickupClicks, 0);

  const ambiguous = product();
  ambiguous.querySelector("form")?.insertAdjacentHTML("beforeend", "<input name='offerListingID' value='SECOND_OFFER'>");
  assert.equal(prepareAmazonAdd(ambiguous, PRODUCT_URL, job(), NOW).ok, false);

  const accordionUrl = "https://www.amazon.com/dp/B0FB21526X";
  assert.equal(rehearseAmazonAdd(
    product("amazon-accordion-canonical-offer.html", accordionUrl),
    accordionUrl,
    job({
      retailerSku: "B0FB21526X",
      canonicalUrl: accordionUrl,
      maxUnitPriceCents: 7999,
      maxOrderTotalCents: 7999
    }),
    NOW
  ).ok, true);

  const variationUrl = "https://www.amazon.com/dp/B0FH8M48ZC";
  assert.equal(rehearseAmazonAdd(
    product("amazon-variation-heavy.html", variationUrl),
    variationUrl,
    job({
      retailerSku: "B0FH8M48ZC",
      canonicalUrl: variationUrl,
      maxUnitPriceCents: 17599,
      maxOrderTotalCents: 17599
    }),
    NOW
  ).ok, true);

  const marketplaceAccordionUrl = "https://www.amazon.com/dp/B07ZPS1KVD";
  assert.equal(prepareAmazonAdd(
    product("amazon-accordion-marketplace.html", marketplaceAccordionUrl),
    marketplaceAccordionUrl,
    job({
      retailerSku: "B07ZPS1KVD",
      canonicalUrl: marketplaceAccordionUrl,
      maxUnitPriceCents: 27477,
      maxOrderTotalCents: 27477
    }),
    NOW
  ).reason, "third_party_seller");

  const quantityChanged = product();
  quantityChanged.querySelector("form")?.insertAdjacentHTML("beforeend", "<select id='quantity' name='quantity'><option value='2' selected>2</option></select>");
  assert.equal(prepareAmazonAdd(quantityChanged, PRODUCT_URL, job(), NOW).ok, false);
});

test("Amazon cart preflight captures a bounded baseline and post-add proof requires an exact delta", () => {
  const empty = new JSDOM("<body><main id='sc-active-cart'><h1>Your Amazon Cart is empty</h1></main></body>", { url: CART_URL }).window.document;
  const baseline = inspectAmazonCartBaseline(empty, CART_URL, NOW);
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  assert.deepEqual(baseline.proof.lines, []);
  const cart = new JSDOM(readFileSync(join(AMAZON_FIXTURES, "cart.html"), "utf8"), { url: CART_URL }).window.document;
  const existing = inspectAmazonCartBaseline(cart, CART_URL, NOW);
  assert.equal(existing.ok, true);
  if (!existing.ok) return;
  assert.equal(existing.proof.lineCount, 1);
  const prepared = prepareAmazonAdd(product(), PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const verified = verifyAmazonAddedCart(cart, CART_URL, job(), prepared.proof, baseline.proof, NOW + 500);
  assert.equal(verified.ok, true);
});

// Real Amazon pages captured read-only on 2026-10-10 and cut to the buy box
// (test/fixtures/amazon/pdp-*.html). No page script runs under jsdom.
function realProduct(name: string, asin: string): { document: Document; url: string } {
  const url = `https://www.amazon.com/dp/${asin}`;
  return { document: new JSDOM(readFileSync(join(AMAZON_FIXTURES, name), "utf8"), { url }).window.document, url };
}

const ECHO_DOT = "B09B8V1LZ3";
function echoDot() {
  return realProduct("pdp-first-party-B09B8V1LZ3.html", ECHO_DOT);
}

function echoDotJob(quantity: number, overrides: Partial<AmazonAddJob> = {}): AmazonAddJob {
  return job({
    jobId: `job_amazon_echo_dot_${quantity}`,
    retailerSku: ECHO_DOT,
    canonicalUrl: `https://www.amazon.com/dp/${ECHO_DOT}`,
    quantity,
    maxUnitPriceCents: 7999,
    maxOrderTotalCents: 7999 * quantity,
    ...overrides
  });
}

// Stand-in for Amazon's own delegated change handlers on the live page: they
// copy the dropdown into the form field beside it and redraw the prompt.
function withAmazonQuantityHandlers(document: Document): Document {
  document.addEventListener("change", (event) => {
    const select = event.target as HTMLSelectElement;
    if (!select.matches?.("#selectQuantity [name='quantity']")) return;
    select.closest("#selectQuantity")?.querySelectorAll<HTMLInputElement>("input[name='items[0.base][quantity]']")
      .forEach((input) => { input.value = select.value; });
    const prompt = select.closest(".a-dropdown-container")?.querySelector(".a-dropdown-prompt");
    if (prompt) prompt.textContent = select.selectedOptions[0]?.textContent ?? "";
  });
  return document;
}

function quantityState(document: Document) {
  const select = document.querySelector<HTMLSelectElement>("select#quantity");
  return {
    select: select?.value,
    field: document.querySelector<HTMLInputElement>("#selectQuantity input[name='items[0.base][quantity]']")?.value,
    prompt: select?.closest(".a-dropdown-container")?.querySelector(".a-dropdown-prompt")?.textContent?.trim()
  };
}

function countClicks(document: Document): () => number {
  let clicks = 0;
  document.querySelector("#add-to-cart-button")?.addEventListener("click", (event) => {
    event.preventDefault();
    clicks += 1;
  });
  return () => clicks;
}

test("Amazon binds every first-party seller layout and still refuses other sellers", () => {
  const legacy = (html: string) => {
    const document = product();
    document.querySelector("#merchant-info")!.innerHTML = html;
    return document;
  };
  assert.equal(rehearseAmazonAdd(legacy("Ships from and sold by Amazon.com."), PRODUCT_URL, job(), NOW).ok, true);
  assert.equal(rehearseAmazonAdd(legacy("Ships from and sold by Amazon.com"), PRODUCT_URL, job(), NOW).ok, true);
  const tabular = product();
  tabular.querySelector("#merchant-info")!.outerHTML = `<div id="tabular-buybox"><div class="tabular-buybox-container">
    <div class="tabular-buybox-text" tabular-attribute-name="Ships from"> <span>Ships from</span> </div>
    <div class="tabular-buybox-text" tabular-attribute-name="Ships from"> <span>Amazon.com</span> </div>
    <div class="tabular-buybox-text" tabular-attribute-name="Sold by"> <span>Sold by</span> </div>
    <div class="tabular-buybox-text" tabular-attribute-name="Sold by"> <span>Amazon.com</span> </div>
  </div></div>`;
  assert.equal(rehearseAmazonAdd(tabular, PRODUCT_URL, job(), NOW).ok, true);
  const twoRowUrl = "https://www.amazon.com/dp/B081J5PW5J";
  const twoRowJob = job({ retailerSku: "B081J5PW5J", canonicalUrl: twoRowUrl, maxUnitPriceCents: 1199, maxOrderTotalCents: 1199 });
  const twoRow = product("amazon-offer-display-separated-marketplace.html", twoRowUrl);
  twoRow.querySelector("#sellerProfileTriggerId")!.textContent = "Amazon.com";
  assert.equal(rehearseAmazonAdd(twoRow, twoRowUrl, twoRowJob, NOW).ok, true, "Ships from Amazon / Sold by Amazon.com rows");

  assert.equal(prepareAmazonAdd(legacy("Ships from and sold by Coolest Commodities."), PRODUCT_URL, job(), NOW).reason, "third_party_seller");
  assert.equal(prepareAmazonAdd(legacy("Sold by Coolest Commodities and Fulfilled by Amazon."), PRODUCT_URL, job(), NOW).reason, "third_party_seller");
  // Amazon Resale is another seller: it never binds as first party.
  const resale = prepareAmazonAdd(legacy("Ships from Amazon Sold by Amazon Resale"), PRODUCT_URL, job(), NOW);
  assert.equal(resale.ok, false);
  assert.notEqual(resale.reason, "out_of_stock");
  // The real page: shipped by Amazon, sold by a marketplace seller.
  const fba = realProduct("pdp-fba-third-party-B0DJPC4VQD.html", "B0DJPC4VQD");
  assert.equal(rehearseAmazonAdd(fba.document, fba.url, job({
    retailerSku: "B0DJPC4VQD", canonicalUrl: fba.url, maxUnitPriceCents: 997, maxOrderTotalCents: 997
  }), NOW).reason, "third_party_seller");
});

test("Amazon reads fulfillment from the delivery promise, not pickup text elsewhere in the buy box", () => {
  const { document, url } = echoDot();
  const qualified = document.querySelector("#desktop_qualifiedBuyBox")!;
  qualified.insertAdjacentHTML("beforeend",
    "<div class='a-popover-preload' id='a-popover-locker'><span>Pick up at an Amazon Hub Locker near you</span></div>"
    + "<div id='returns-note'><span>Free returns: drop off or pick up at a UPS Store</span></div>");
  const rehearsal = rehearseAmazonAdd(document, url, echoDotJob(1), NOW);
  assert.equal(rehearsal.ok, true, rehearsal.reason);
  assert.equal(rehearsal.ok && rehearsal.proof.fulfillment, "shipping");

  // The synthetic page has no delivery block: its "Ships from" line decides.
  const legacy = product();
  legacy.querySelector("form")!.insertAdjacentHTML("beforeend", "<div class='a-popover-preload'>Pick up in store today</div>");
  assert.equal(rehearseAmazonAdd(legacy, PRODUCT_URL, job(), NOW).ok, true);

  // An offer whose only promise is a pickup is not a shipping offer.
  const pickup = echoDot();
  for (const promise of pickup.document.querySelectorAll("[data-csa-c-delivery-type]")) {
    promise.setAttribute("data-csa-c-delivery-type", "pickup");
    promise.textContent = "FREE pickup Thursday at an Amazon Hub Locker";
  }
  const refused = prepareAmazonAdd(pickup.document, pickup.url, echoDotJob(1), NOW);
  assert.equal(refused.ok, false);
  assert.notEqual(refused.reason, "out_of_stock");
});

test("Amazon names a buy box with no featured offer, reports other pages it cannot bind as add_control_unavailable, and keeps out_of_stock for a page that says so", () => {
  const noOffer = realProduct("pdp-no-featured-offer-B0G3GKNMKP.html", "B0G3GKNMKP");
  const noOfferJob = job({ retailerSku: "B0G3GKNMKP", canonicalUrl: noOffer.url, maxUnitPriceCents: 2999, maxOrderTotalCents: 2999 });
  assert.deepEqual(rehearseAmazonAdd(noOffer.document, noOffer.url, noOfferJob, NOW), { ok: false, reason: "no_featured_offer" });
  assert.deepEqual(prepareAmazonAdd(noOffer.document, noOffer.url, noOfferJob, NOW), { ok: false, reason: "no_featured_offer" });
  // Amazon's newer page also says it above the buy box (Kevin's NeeDoh, 2026-10-12).
  const said = realProduct("pdp-no-featured-offer-B0G3GKNMKP.html", "B0G3GKNMKP");
  for (const button of said.document.querySelectorAll("#buybox-see-all-buying-choices")) button.remove();
  said.document.querySelector("#desktop_buybox")!.insertAdjacentHTML("beforebegin", "<div id='fod-cx-box' class='a-box'>"
    + "<span id='fod-cx-message-with-learn-more'><span>No featured offers available<br></span><a role='button'>Learn more</a></span></div>");
  assert.deepEqual(prepareAmazonAdd(said.document, said.url, noOfferJob, NOW), { ok: false, reason: "no_featured_offer" });
  // The words only in the Learn more popover's preloaded body aren't the page saying them.
  said.document.querySelector("#fod-cx-box")!.remove();
  said.document.body.insertAdjacentHTML("beforeend", "<div class='a-popover-preload'><span id='fod-cx-message-with-learn-more'>"
    + "No featured offers available</span></div>");
  assert.deepEqual(prepareAmazonAdd(said.document, said.url, noOfferJob, NOW), { ok: false, reason: "add_control_unavailable" });

  const unavailable = realProduct("pdp-currently-unavailable-B0D1XD1ZV3.html", "B0D1XD1ZV3");
  assert.deepEqual(prepareAmazonAdd(unavailable.document, unavailable.url, job({
    retailerSku: "B0D1XD1ZV3", canonicalUrl: unavailable.url, maxUnitPriceCents: 24_900, maxOrderTotalCents: 24_900
  }), NOW), { ok: false, reason: "out_of_stock" });

  // The Add button vanishes between prepare and commit: no click, no "sold out".
  const { document, url } = echoDot();
  const clicks = countClicks(document);
  const prepared = prepareAmazonAdd(document, url, echoDotJob(1), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  document.querySelector("#addToCart_feature_div")!.innerHTML = "";
  assert.deepEqual(commitAmazonAdd(document, url, echoDotJob(1), prepared.authorizationId, NOW + 100),
    { ok: false, reason: "add_control_unavailable", clicked: false });
  assert.equal(clicks(), 0);
});

test("Amazon sets the buy-box quantity to the planned add, verifies it, and clicks only while it still shows", () => {
  const { document, url } = echoDot();
  withAmazonQuantityHandlers(document);
  const clicks = countClicks(document);
  // Rehearsal only reads: the dropdown stays at 1.
  const rehearsal = rehearseAmazonAdd(document, url, echoDotJob(2), NOW);
  assert.equal(rehearsal.ok, true, rehearsal.reason);
  assert.deepEqual(rehearsal.ok && rehearsal.quantity, { requested: 2, storeLimit: 4, add: 2, raiseTo: 2 });
  assert.deepEqual(quantityState(document), { select: "1", field: "1", prompt: "1" });

  const prepared = prepareAmazonAdd(document, url, echoDotJob(2), NOW);
  assert.equal(prepared.ok, true, prepared.reason);
  if (!prepared.ok) return;
  assert.deepEqual(prepared.quantity, { requested: 2, storeLimit: 4, add: 2, raiseTo: 2 });
  assert.deepEqual(quantityState(document), { select: "2", field: "2", prompt: "2" });
  const committed = commitAmazonAdd(document, url, echoDotJob(2), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true, committed.reason);
  assert.equal(clicks(), 1);

  // The dropdown changes after prepare: never click.
  const changed = withAmazonQuantityHandlers(echoDot().document);
  const changedClicks = countClicks(changed);
  const again = prepareAmazonAdd(changed, url, echoDotJob(2), NOW);
  assert.equal(again.ok, true, again.reason);
  if (!again.ok) return;
  const select = changed.querySelector<HTMLSelectElement>("select#quantity")!;
  select.value = "3";
  select.dispatchEvent(new changed.defaultView!.Event("change", { bubbles: true }));
  assert.deepEqual(commitAmazonAdd(changed, url, echoDotJob(2), again.authorizationId, NOW + 100),
    { ok: false, reason: "quantity_changed", clicked: false });
  const fieldOnly = withAmazonQuantityHandlers(echoDot().document);
  const third = prepareAmazonAdd(fieldOnly, url, echoDotJob(2), NOW);
  assert.equal(third.ok, true);
  if (!third.ok) return;
  fieldOnly.querySelector<HTMLInputElement>("#selectQuantity input[name='items[0.base][quantity]']")!.value = "1";
  assert.deepEqual(commitAmazonAdd(fieldOnly, url, echoDotJob(2), third.authorizationId, NOW + 100),
    { ok: false, reason: "quantity_changed", clicked: false });
  assert.equal(changedClicks(), 0);
});

// Kevin's Test call, 2026-10-11 (real page, cut to the buy box): Amazon featured
// a marketplace seller's $52.55 offer and listed its own at $60.94 as a
// collapsed "Get it faster" row. Every row keeps its own form and Add button
// in the page; Amazon's stylesheet hides the collapsed ones.
const ACCORDION_ASIN = "B0H1T2JK1M";
function accordion() {
  return realProduct("pdp-accordion-marketplace-featured-B0H1T2JK1M.html", ACCORDION_ASIN);
}
function accordionJob(quantity: number, maxUnitPriceCents: number, overrides: Partial<AmazonAddJob> = {}): AmazonAddJob {
  return job({
    jobId: `job_amazon_accordion_${quantity}`,
    retailerSku: ACCORDION_ASIN,
    canonicalUrl: `https://www.amazon.com/dp/${ACCORDION_ASIN}`,
    quantity,
    maxUnitPriceCents,
    maxOrderTotalCents: maxUnitPriceCents * quantity,
    ...overrides
  });
}
// Stand-in for Amazon's accordion script: a row header click makes that row the chosen one.
function withAmazonAccordion(document: Document): Document {
  for (const header of document.querySelectorAll("[data-action='a-accordion']")) {
    header.addEventListener("click", () => {
      const chosen = header.closest("[data-a-accordion-row-name]");
      for (const row of document.querySelectorAll("[data-a-accordion-row-name]")) row.classList.toggle("a-accordion-active", row === chosen);
    });
  }
  return document;
}
function buyBoxClicks(document: Document): () => Record<string, number> {
  const counts: Record<string, number> = {};
  for (const control of document.querySelectorAll("#add-to-cart-button, #buy-now-button, #add-to-cart-button-ubb, [data-action='a-accordion']")) {
    control.addEventListener("click", (event) => {
      if (control.matches("input")) event.preventDefault();
      const key = `${control.closest("[data-a-accordion-row-name]")?.id}:${control.id || "header"}`;
      counts[key] = (counts[key] ?? 0) + 1;
    });
  }
  return () => ({ ...counts });
}

test("Amazon reads only the chosen row of an accordion buy box: a featured marketplace offer is another seller, not a missing button", () => {
  const { document, url } = accordion();
  // Before, both rows' Add buttons counted and the page read "No Add to cart button".
  assert.deepEqual(rehearseAmazonAdd(document, url, accordionJob(1, 5255), NOW), { ok: false, reason: "third_party_seller" });
  assert.deepEqual(prepareAmazonAdd(document, url, accordionJob(3, 6100), NOW), { ok: false, reason: "third_party_seller" });
});

test("Amazon opens its own offer's row when a marketplace seller is featured, then adds that offer at its own price and limit", async () => {
  const { document, url } = accordion();
  withAmazonAccordion(withAmazonQuantityHandlers(document));
  const clicks = buyBoxClicks(document);
  // Kevin's Test call: a max of $61.00 for 3.
  const testCall = accordionJob(3, 6100);
  assert.deepEqual(await selectAmazonOwnOffer(document, url, testCall, { timeoutMs: 200, pollMs: 5 }),
    { ok: true, reason: "own_offer_selected", selectionClicked: true });
  assert.equal(document.querySelector("#newAccordionRow_1")?.classList.contains("a-accordion-active"), true);
  const prepared = prepareAmazonAdd(document, url, testCall, NOW);
  assert.equal(prepared.ok, true, prepared.reason);
  if (!prepared.ok) return;
  assert.deepEqual([prepared.proof.unitPriceCents, prepared.proof.sellerName, prepared.proof.sellerType], [6094, "Amazon.com", "first_party"],
    "the chosen row's own price, never the featured offer's or the quantity subtotal");
  assert.deepEqual(prepared.quantity, { requested: 3, storeLimit: 5, add: 3, raiseTo: 3 });
  const committed = commitAmazonAdd(document, url, testCall, prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true, committed.reason);
  assert.deepEqual(clicks(), { "newAccordionRow_1:header": 1, "newAccordionRow_1:add-to-cart-button": 1 },
    "one row header, then Amazon's own Add once; never Buy Now, the featured offer or the used one");
  // Already showing Amazon's own offer: nothing to click.
  assert.deepEqual(await selectAmazonOwnOffer(document, url, testCall, { timeoutMs: 200, pollMs: 5 }),
    { ok: true, reason: "own_offer_shown", selectionClicked: false });
  // Any price up to the max adds; a cent over it never does.
  const real = accordion();
  withAmazonAccordion(real.document);
  assert.equal((await selectAmazonOwnOffer(real.document, real.url, accordionJob(1, 6094), { timeoutMs: 200, pollMs: 5 })).reason, "own_offer_selected");
  assert.equal(rehearseAmazonAdd(real.document, real.url, accordionJob(1, 6094), NOW).ok, true);
  assert.equal(rehearseAmazonAdd(real.document, real.url, accordionJob(1, 9999), NOW).ok, true);
  assert.deepEqual(rehearseAmazonAdd(real.document, real.url, accordionJob(1, 6093), NOW), { ok: false, reason: "over_unit_cap" });
});

test("Amazon leaves the featured offer alone when its own costs more than the limit, there is no choice, or the row never opens", async () => {
  const { document, url } = accordion();
  withAmazonAccordion(document);
  const clicks = buyBoxClicks(document);
  assert.deepEqual(await selectAmazonOwnOffer(document, url, accordionJob(1, 5999), { timeoutMs: 200, pollMs: 5 }),
    { ok: false, reason: "over_unit_cap", selectionClicked: false });
  assert.deepEqual(await selectAmazonOwnOffer(document, url, echoDotJob(1), { timeoutMs: 200, pollMs: 5 }),
    { ok: false, reason: "listing_mismatch", selectionClicked: false });
  assert.deepEqual(clicks(), {});
  assert.equal(document.querySelector("#newAccordionRow_0")?.classList.contains("a-accordion-active"), true);
  const single = echoDot();
  assert.deepEqual(await selectAmazonOwnOffer(single.document, single.url, echoDotJob(1), { timeoutMs: 200, pollMs: 5 }),
    { ok: true, reason: "no_offer_choice", selectionClicked: false });
  // Amazon's script never switches rows: the offer check still reads the featured offer.
  const stuck = accordion();
  assert.deepEqual(await selectAmazonOwnOffer(stuck.document, stuck.url, accordionJob(1, 6094), { timeoutMs: 30, pollMs: 5 }),
    { ok: true, reason: "own_offer_unselected", selectionClicked: true });
  assert.deepEqual(prepareAmazonAdd(stuck.document, stuck.url, accordionJob(1, 6094), NOW), { ok: false, reason: "third_party_seller" });
});

test("Amazon fails closed when its page does not take the quantity, and caps the add at the store's limit", () => {
  // Without Amazon's handlers the form field and the drawn dropdown keep 1.
  const { document, url } = echoDot();
  const clicks = countClicks(document);
  assert.deepEqual(prepareAmazonAdd(document, url, echoDotJob(2), NOW), { ok: false, reason: "quantity_unverified" });
  assert.equal(clicks(), 0);

  // The dropdown offers 1-4 and "5+" (a bulk-order prompt): 4 is Amazon's limit.
  const capped = withAmazonQuantityHandlers(echoDot().document);
  const prepared = prepareAmazonAdd(capped, url, echoDotJob(10), NOW);
  assert.equal(prepared.ok, true, prepared.reason);
  assert.deepEqual(prepared.ok && prepared.quantity, { requested: 10, storeLimit: 4, add: 4, raiseTo: 4 });
  assert.equal(quantityState(capped).select, "4");

  // A "Limit N per customer" line in the buy box caps it further.
  const limited = withAmazonQuantityHandlers(echoDot().document);
  limited.querySelector("#selectQuantity")!.insertAdjacentHTML("afterend", "<div class='a-section'><span>Limit 2 per customer</span></div>");
  const limitedAdd = prepareAmazonAdd(limited, url, echoDotJob(3), NOW);
  assert.deepEqual(limitedAdd.ok && limitedAdd.quantity, { requested: 3, storeLimit: 2, add: 2, raiseTo: 2 });
  const coupon = withAmazonQuantityHandlers(echoDot().document);
  coupon.querySelector("#selectQuantity")!.insertAdjacentHTML("afterend", "<div id='couponsInBuybox_feature_div'><span>Save $5 with coupon. Limit 1 per customer</span></div>");
  const couponAdd = prepareAmazonAdd(coupon, url, echoDotJob(3), NOW);
  assert.deepEqual(couponAdd.ok && couponAdd.quantity, { requested: 3, storeLimit: 4, add: 3, raiseTo: 3 }, "a coupon's own limit is not the item's");
  const hiddenLimit = withAmazonQuantityHandlers(echoDot().document);
  hiddenLimit.querySelector("#selectQuantity")!.insertAdjacentHTML("afterend", "<div class='aok-hidden'>Limit 1 per customer</div>");
  const hiddenAdd = prepareAmazonAdd(hiddenLimit, url, echoDotJob(3), NOW);
  assert.deepEqual(hiddenAdd.ok && hiddenAdd.quantity, { requested: 3, storeLimit: 4, add: 3, raiseTo: 3 });

  // One unit never touches the dropdown.
  const single = echoDot();
  const one = prepareAmazonAdd(single.document, url, echoDotJob(1), NOW);
  assert.deepEqual(one.ok && one.quantity, { requested: 1, storeLimit: 4, add: 1, raiseTo: 1 });
  assert.deepEqual(quantityState(single.document), { select: "1", field: "1", prompt: "1" });

  // No dropdown in the buy box: the add is one unit and nothing is raised later.
  const plain = echoDot();
  plain.document.querySelector("select#quantity")!.remove();
  const plainClicks = countClicks(plain.document);
  const plainAdd = prepareAmazonAdd(plain.document, url, echoDotJob(3), NOW);
  assert.deepEqual(plainAdd.ok && plainAdd.quantity, { requested: 3, storeLimit: null, add: 1, raiseTo: 1 });
  if (!plainAdd.ok) return;
  assert.equal(commitAmazonAdd(plain.document, url, echoDotJob(3), plainAdd.authorizationId, NOW + 100).ok, true);
  assert.equal(plainClicks(), 1);
});

function amazonCart(lines: string): Document {
  return new JSDOM(`<!doctype html><body><div id="sc-active-cart" data-name="Active Cart"><div class="a-cardui-body">${lines}</div></div></body>`,
    { url: CART_URL }).window.document;
}

function cartLine(quantityHtml: string, attributes = "", asin = "B0GYTRYV7P"): string {
  return `<div class="a-row sc-list-item sc-list-item-border sc-java-remote-feature" data-asin="${asin}" data-itemtype="active" ${attributes}>
    <span class="a-size-medium sc-product-price">$21.86</span>
    <span class="a-size-small sc-product-seller">Sold by Amazon.com</span>${quantityHtml}</div>`;
}

const cartDropdown = (selected: string) => `<span class="a-dropdown-container"><select name="quantity" class="a-native-dropdown sc-update-quantity-input">
  <option value="0">0 (Delete)</option>${Array.from({ length: 9 }, (_, index) => `<option value="${index + 1}"${String(index + 1) === selected ? " selected" : ""}>${index + 1}</option>`).join("")}
  <option value="10"${selected === "10" ? " selected" : ""}>10+</option></select>
  <span class="a-button a-button-dropdown" aria-hidden="true"><span class="a-dropdown-prompt">${selected === "10" ? "10+" : selected}</span></span></span>`;
const cartBox = (value: string, hidden: boolean) => `<input type="text" name="quantityBox" maxlength="3" class="a-input-text sc-quantity-textfield${hidden ? " sc-hidden" : ""}" value="${value}">`;
const cartStepper = (value: string) => `<div class="sc-quantity-stepper"><span role="button" data-a-selector="decrement" aria-label="Decrease quantity by one">-</span>
  <span data-a-selector="value" role="spinbutton" aria-valuenow="${value}">${value}</span><span role="button" data-a-selector="increment" aria-label="Increase quantity by one">+</span></div>`;

test("the Amazon cart reader reads dropdown, typed box, stepper and line quantities up to 99 and fails closed", () => {
  const quantity = (html: string) => observeAmazonCart(amazonCart(html), new Date(NOW).toISOString()).lines[0]?.quantity;
  assert.equal(quantity(cartLine(cartDropdown("2") + cartBox("", true), "data-quantity='2'")), 2);
  assert.equal(quantity(cartLine(cartDropdown("10") + cartBox("12", false), "data-quantity='12'")), 12, "10+ shows the typed box");
  assert.equal(quantity(cartLine(cartDropdown("10").replace(' aria-hidden="true"', "") + cartBox("12", false))), 12, "a drawn 10+ prompt is not a reading");
  assert.equal(quantity(cartLine(cartStepper("3"), "data-quantity='3'")), 3);
  assert.equal(quantity(cartLine(cartStepper("99"))), 99);
  assert.equal(quantity(cartLine("", "data-quantity='4'")), 4, "a line without a control still states its quantity");
  assert.equal(quantity(cartLine(cartDropdown("2"), "data-quantity='1'")), null, "readings disagree");
  assert.equal(quantity(cartLine(cartBox("100", false))), null);
  assert.equal(quantity(cartLine(cartDropdown("0"))), null);
  assert.equal(quantity(cartLine(cartBox("", false))), null, "an empty visible box is unreadable");
  assert.equal(quantity(cartLine("<span>Qty: 2</span>")), null, "no control and no line quantity");
  // The old reader took the first one or two digits: "Quantity 100" read as 10.
  assert.equal(quantity(cartLine("<span data-testid='item-quantity'>Quantity 100</span>")), null);

  // Two rows of one ASIN are one line holding both.
  const doubled = observeAmazonCart(amazonCart(cartLine(cartDropdown("1"), "data-quantity='1'") + cartLine(cartDropdown("2"), "data-quantity='2'")), new Date(NOW).toISOString());
  assert.equal(doubled.complete, true);
  assert.deepEqual(doubled.lines.map((line) => [line.retailerSku, line.quantity]), [["B0GYTRYV7P", 3]]);
  const baseline = inspectAmazonCartBaseline(amazonCart(cartLine(cartDropdown("1")) + cartLine(cartStepper("2"))), CART_URL, NOW);
  assert.deepEqual(baseline.ok && baseline.proof.lines, [{ retailerSku: "B0GYTRYV7P", quantity: 3 }]);
});

test("Amazon verifies a multi-unit add as the exact cart delta, and an empty guest cart is a verified empty baseline", () => {
  const empty = new JSDOM(readFileSync(join(AMAZON_FIXTURES, "cart-empty-guest.html"), "utf8"), { url: CART_URL }).window.document;
  const emptyBaseline = inspectAmazonCartBaseline(empty, CART_URL, NOW);
  assert.equal(emptyBaseline.ok, true, emptyBaseline.ok ? "" : emptyBaseline.reason);
  assert.deepEqual(emptyBaseline.ok && [emptyBaseline.proof.lineCount, emptyBaseline.proof.lines], [0, []]);

  const twoJob = job({ quantity: 2, maxOrderTotalCents: 4372 });
  const prepared = prepareAmazonAdd(product(), PRODUCT_URL, twoJob, NOW);
  assert.equal(prepared.ok, true, prepared.reason);
  if (!prepared.ok) return;
  const before = inspectAmazonCartBaseline(amazonCart(cartLine(cartDropdown("1"), "data-quantity='1'")), CART_URL, NOW);
  assert.equal(before.ok, true);
  if (!before.ok) return;
  const after = amazonCart(cartLine(cartDropdown("3"), "data-quantity='3'"));
  const verified = verifyAmazonAddedCart(after, CART_URL, twoJob, prepared.proof, before.proof, NOW + 500);
  assert.equal(verified.ok, true, verified.ok ? "" : verified.reason);
  assert.equal(verified.ok && verified.proof.quantity, 2);
  assert.deepEqual(verifyAmazonAddedCart(after, CART_URL, { ...twoJob, quantity: 1 }, prepared.proof, before.proof, NOW + 500),
    { ok: false, reason: "cart_delta_unverified" });
  // From the verified empty cart, an add of two must show exactly two.
  assert.equal(emptyBaseline.ok && verifyAmazonAddedCart(amazonCart(cartLine(cartStepper("2"))), CART_URL, twoJob, prepared.proof, emptyBaseline.proof, NOW + 500).ok, true);
});
