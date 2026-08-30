import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import { TARGET_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import {
  commitTargetAdd,
  inspectTargetCartBaseline,
  prepareTargetAdd,
  rehearseTargetAdd,
  type TargetAddJob,
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
    maxUnitPriceCents: 6000,
    maxOrderTotalCents: 6000,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Target",
    fulfillment: "shipping",
    expiresAt: new Date(NOW + 60_000).toISOString()
  };
  return { ...base, adapterVersion: TARGET_ADD_ADAPTER_VERSION, ...overrides };
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

  assert.equal(prepareTargetAdd(product(), PRODUCT_URL, job({ quantity: 2 }), NOW).reason, "quantity_not_supported");
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

test("Target selects pickup only for an exact pickup job and only while pickup is available", async () => {
  const document = modernProduct();
  const pickup = document.querySelector<HTMLElement>("[data-test='fulfillment-cell-pickup']");
  const add = document.querySelector<HTMLElement>("#addToCartButtonOrTextIdFor1011483414");
  assert.ok(pickup);
  assert.ok(add);
  let addClicks = 0;
  add.addEventListener("click", () => { addClicks += 1; });
  const pickupJob = job({ fulfillment: "pickup", maxUnitPriceCents: 539 });
  const prepared = prepareTargetAdd(document, PRODUCT_URL, pickupJob, NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = await commitTargetAdd(document, PRODUCT_URL, pickupJob, prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(addClicks, 1);

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
