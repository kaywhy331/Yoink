import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import { BESTBUY_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import {
  commitBestBuyAdd,
  inspectBestBuyCartBaseline,
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
  return { ...base, adapterVersion: BESTBUY_ADD_ADAPTER_VERSION, ...overrides };
}

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
    reason: "over_unit_cap",
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

test("Best Buy v11 requires an exact selected Shipping or explicit Pickup offer and accepts preorders", () => {
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
  assert.equal(pickupPreparation.ok, true);
  if (pickupPreparation.ok) {
    assert.equal(commitBestBuyAdd(pickup, PRODUCT_URL, pickupJob, pickupPreparation.authorizationId, NOW + 100).ok, true);
  }
  assert.equal(pickupClicks, 1);

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
  assert.equal(preorderRehearsal.ok, true);
  assert.equal(preorderRehearsal.ok && preorderRehearsal.wouldClick, true);
  assert.equal(preorderClicks, 0);
  const preorderPreparation = prepareBestBuyAdd(preorder, preorderUrl, preorderJob, NOW);
  assert.equal(preorderPreparation.ok, true);
  if (preorderPreparation.ok) {
    assert.equal(commitBestBuyAdd(
      preorder,
      preorderUrl,
      preorderJob,
      preorderPreparation.authorizationId,
      NOW + 100
    ).ok, true);
  }
  assert.equal(preorderClicks, 1);
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
    maxUnitPriceCents: 5999,
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
