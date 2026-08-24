import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import { BESTBUY_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import {
  commitBestBuyAdd,
  inspectBestBuyEmptyCart,
  prepareBestBuyAdd,
  rehearseBestBuyAdd,
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
  return { ...base, adapterVersion: BESTBUY_ADD_ADAPTER_VERSION, ...overrides };
}

test("Best Buy rehearsal reaches the exact no-click boundary and high-demand queues fail closed", () => {
  const document = product();
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
    reason: "over_unit_cap",
    clicked: false
  });
});

test("Best Buy v3 accepts only Best Buy-sold, selected-shipping, quantity-one add jobs", () => {
  assert.equal(prepareBestBuyAdd(product(), PRODUCT_URL, job({ quantity: 2 }), NOW).reason, "quantity_not_supported");
  assert.equal(prepareBestBuyAdd(product(), PRODUCT_URL, job({ action: "prepare_checkout" }), NOW).reason, "unsupported_action");
  assert.equal(prepareBestBuyAdd(product(), PRODUCT_URL, job({ sellerPolicy: "allow_third_party" }), NOW).reason, "seller_policy_not_supported");
  assert.equal(prepareBestBuyAdd(product(), PRODUCT_URL, job({ fulfillment: "pickup" }), NOW).reason, "fulfillment_not_supported");

  const marketplace = fixture("bestbuy-marketplace.html", MARKETPLACE_URL);
  const marketplaceJob = job({ canonicalUrl: MARKETPLACE_URL, retailerSku: "12716513", expectedSeller: "Shopville Inc", maxUnitPriceCents: 26799, maxOrderTotalCents: 26799 });
  assert.equal(prepareBestBuyAdd(marketplace, MARKETPLACE_URL, marketplaceJob, NOW).reason, "third_party_seller");
  assert.equal(prepareBestBuyAdd(fixture("bestbuy-pickup-selected.html", PRODUCT_URL), PRODUCT_URL, job(), NOW).reason, "out_of_stock");
});

test("Best Buy v3 reaches the no-click boundary on the modern fulfillment layout", () => {
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

test("Best Buy cart preflight requires emptiness and post-add proof requires one exact line", () => {
  const empty = fixture("bestbuy-cart-empty.html", CART_URL);
  assert.deepEqual(inspectBestBuyEmptyCart(empty, CART_URL), { ok: true, reason: "verified_empty" });
  const cart = fixture("bestbuy-cart-single.html", CART_URL);
  assert.deepEqual(inspectBestBuyEmptyCart(cart, CART_URL), { ok: false, reason: "foreign_cart_line" });
  const prepared = prepareBestBuyAdd(product(), PRODUCT_URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const verified = verifyBestBuyAddedCart(cart, CART_URL, job(), prepared.proof, NOW + 500);
  assert.equal(verified.ok, true);
});
