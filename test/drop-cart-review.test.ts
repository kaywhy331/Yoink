import assert from "node:assert/strict";
import test from "node:test";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.js";
import { reviewDropCart, type DropCartReviewInput } from "../packages/domain/src/drop-cart-review.js";

const NOW = Date.parse("2026-10-01T16:00:00.000Z");
const timestamp = new Date(NOW - 1_000).toISOString();
const identities = {
  amazon: ["B0WANTIT01", "https://www.amazon.com/dp/B0WANTIT01"],
  target: ["95111111", "https://www.target.com/p/-/A-95111111"],
  walmart: ["6661111", "https://www.walmart.com/ip/6661111"],
  bestbuy: ["6667316", "https://www.bestbuy.com/site/example/6667316.p"]
} as const;

function fixture(retailer: keyof typeof identities = "target"): DropCartReviewInput {
  const [sku, url] = identities[retailer];
  const identity = { retailerId: retailer, retailerSku: sku, canonicalUrl: url, variant: "standard-single" };
  return {
    selection: { ...identity, quantity: 1, fulfillment: "shipping", reviewedUnitPriceCents: 599, action: "add_to_cart" },
    signal: { ...identity, id: "fixture-only", source: "trackalacker", sourceUrl: "https://www.trackalacker.com/listings/123/example",
      trust: "trusted_exact", test: false, observedAt: timestamp, receivedAt: timestamp, unitPriceCents: 599, currency: "USD" },
    productEvidence: { ...identity, title: "Ordinary puzzle", classification: "ordinary_goods", restricted: false,
      ageGated: false, moneyProduct: false, reviewedAt: timestamp,
      msrp: { kind: "manufacturer_msrp", amountCents: 699, currency: "USD", sourceUrl: "https://maker.example/puzzle",
        publisherHost: "maker.example", reviewedAt: timestamp, exactVariantVerified: true } },
    observation: { ...identity, unitPriceCents: 599, currency: "USD", observedAt: timestamp,
      sellerName: ADD_LANES[retailer].firstPartySeller, fulfillment: "shipping", availability: "in_stock", quantity: 1,
      gate: "none", adapterVersion: ADD_LANES[retailer].contractVersion, shippingCents: null, taxCents: null, feesCents: null,
      baselineComplete: true, unresolvedMutation: false, sameBrowserSession: true }
  };
}

for (const retailer of Object.keys(identities) as Array<keyof typeof identities>) {
  test(`${retailer}: fixture review yields only no-click rehearsal, never cart authorization`, () => {
    const result = reviewDropCart(fixture(retailer), NOW);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.status, "ready_for_no_click_rehearsal");
    assert.equal(result.noCartAuthorization, true);
    assert.equal(result.realCartVerified, false);
  });
}

const unsafe: Array<[string, (value: DropCartReviewInput) => void, string]> = [
  ["unknown MSRP", x => { x.productEvidence.msrp = null; }, "official_msrp_unverified"],
  ["Trackalacker MSRP", x => { x.productEvidence.msrp!.kind = "reported_msrp"; }, "official_msrp_unverified"],
  ["crossed-out price", x => { x.productEvidence.msrp!.kind = "crossed_out_price"; }, "official_msrp_unverified"],
  ["higher price", x => { x.observation.unitPriceCents = 699; }, "listed_price_changed"],
  ["lower price", x => { x.observation.unitPriceCents = 499; }, "listed_price_changed"],
  ["stale signal", x => { x.signal.observedAt = new Date(NOW - 120_001).toISOString(); }, "signal_stale"],
  ["stale page", x => { x.observation.observedAt = new Date(NOW - 30_001).toISOString(); }, "page_price_stale"],
  ["changed variant", x => { x.observation.variant = "different"; }, "page_identity_changed"],
  ["untrusted URL", x => { x.selection.canonicalUrl = "https://www.target.com.evil.example/p/-/A-95111111"; }, "retailer_identity_unverified"],
  ["checkout", x => { x.selection.action = "prepare_checkout"; }, "cart_only_action_required"],
  ["quantity two", x => { x.selection.quantity = 2; }, "quantity_must_be_one"],
  ["security gate", x => { x.observation.gate = "captcha"; }, "manual_store_step_required"],
  ["gift card", x => { x.productEvidence.title = "Gift card"; }, "product_restricted_or_unclassified"],
  ["age gated", x => { x.productEvidence.ageGated = true; }, "product_eligibility_unverified"],
  ["money product", x => { x.productEvidence.moneyProduct = true; }, "product_eligibility_unverified"],
  ["uncertain cart", x => { x.observation.unresolvedMutation = true; }, "previous_cart_mutation_unresolved"],
  ["incomplete baseline", x => { x.observation.baselineComplete = false; }, "cart_baseline_unverified"],
  ["fixture event", x => { x.signal.test = true; }, "fixture_signal_not_live"],
  ["third-party seller", x => { x.observation.sellerName = "Marketplace vendor"; }, "first_party_seller_unverified"],
  ["old adapter", x => { x.observation.adapterVersion = "target-add-v10"; }, "adapter_version_mismatch"]
];
for (const [name, change, code] of unsafe) {
  test(`fixture stops for ${name}`, () => {
    const value = fixture();
    change(value);
    const result = reviewDropCart(value, NOW);
    assert.equal(result.status, "needs_review");
    assert.ok(result.blockers.includes(code), result.blockers.join(", "));
  });
}

test("malformed review is rejected without a throw", () => {
  for (const value of [null, [], {}, { selection: 1 }]) {
    assert.deepEqual(reviewDropCart(value, NOW).blockers, ["invalid_review_input"]);
  }
});
