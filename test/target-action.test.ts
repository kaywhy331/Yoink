import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import { TARGET_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import {
  commitTargetAdd,
  inspectTargetEmptyCart,
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

test("Target add authorization clicks at most once and consumes its receipt before mutation", () => {
  const document = product();
  let clicks = 0;
  document.querySelector("button")?.addEventListener("click", () => { clicks += 1; });
  const prepared = prepareTargetAdd(document, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const committed = commitTargetAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100);
  assert.equal(committed.ok, true);
  assert.equal(committed.clicked, true);
  assert.equal(clicks, 1);
  const duplicate = commitTargetAdd(document, PRODUCT_URL, job(), prepared.authorizationId, NOW + 200);
  assert.deepEqual(duplicate, { ok: false, reason: "authorization_missing", clicked: false });
  assert.equal(clicks, 1);
});

test("Target add revalidates price, action, quantity, and control identity immediately before clicking", () => {
  const overPrice = product();
  let clicks = 0;
  overPrice.querySelector("button")?.addEventListener("click", () => { clicks += 1; });
  const prepared = prepareTargetAdd(overPrice, PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const price = overPrice.querySelector("[data-test='product-price']");
  if (price) price.textContent = "$600.00";
  assert.deepEqual(commitTargetAdd(overPrice, PRODUCT_URL, job(), prepared.authorizationId, NOW + 100), {
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
  assert.equal(commitTargetAdd(sellerChanged, PRODUCT_URL, job(), sellerPreparation.authorizationId, NOW + 100).reason, "third_party_seller");
  assert.equal(sellerClicks, 0);

  assert.equal(prepareTargetAdd(product(), PRODUCT_URL, job({ quantity: 2 }), NOW).reason, "quantity_not_supported");
  assert.equal(prepareTargetAdd(product(), PRODUCT_URL, job({ action: "prepare_checkout" }), NOW).reason, "unsupported_action");
  assert.equal(prepareTargetAdd(product(), PRODUCT_URL, job({ sellerPolicy: "allow_third_party" }), NOW).reason, "seller_policy_not_supported");
  assert.equal(prepareTargetAdd(product(), PRODUCT_URL, job({ fulfillment: "pickup" }), NOW).reason, "fulfillment_not_supported");

  const replaced = product();
  const replacementPreparation = prepareTargetAdd(replaced, PRODUCT_URL, job(), NOW);
  assert.equal(replacementPreparation.ok, true);
  if (!replacementPreparation.ok) return;
  const original = replaced.querySelector("button");
  const clone = original?.cloneNode(true);
  if (original && clone) original.replaceWith(clone);
  assert.equal(commitTargetAdd(replaced, PRODUCT_URL, job(), replacementPreparation.authorizationId, NOW + 100).reason, "add_control_changed");
});

test("Target cart preflight requires a visibly empty cart and post-add proof requires one exact line", () => {
  const empty = new JSDOM(`<body><main><h1>Your cart is empty</h1></main></body>`, { url: "https://www.target.com/cart" }).window.document;
  assert.deepEqual(inspectTargetEmptyCart(empty, "https://www.target.com/cart"), { ok: true, reason: "verified_empty" });
  const cart = new JSDOM(readFileSync(join(FIXTURES, "cart.html"), "utf8"), { url: "https://www.target.com/cart" }).window.document;
  assert.deepEqual(inspectTargetEmptyCart(cart, "https://www.target.com/cart"), { ok: false, reason: "foreign_cart_line" });
  const prepared = prepareTargetAdd(product(), PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const verified = verifyTargetAddedCart(cart, "https://www.target.com/cart", job(), prepared.proof, NOW + 500);
  assert.equal(verified.ok, true);
});
