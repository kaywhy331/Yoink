import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWalmartClickTrackingId,
  buildWalmartPdpUrl,
  buildWalmartPurchaseDestinations,
  buildWalmartReviewOrderUrl,
  extractWalmartItemId
} from "../packages/domain/src/walmart-purchase-route.js";
import { validateWalmartSignalPurchase } from "../packages/domain/src/walmart-purchase-validation.js";

const ITEM_ID = "19988614228";
const PDP_URL = `https://www.walmart.com/ip/Product-Name/${ITEM_ID}`;
const NOW = Date.parse("2026-09-01T19:00:00.000Z");

test("Walmart item identity is extracted only from exact Walmart product URLs", () => {
  assert.equal(extractWalmartItemId(PDP_URL), ITEM_ID);
  assert.equal(extractWalmartItemId(`https://www.walmart.com/ip/${ITEM_ID}?from=/search`), ITEM_ID);
  for (const rejected of [
    `http://www.walmart.com/ip/Product-Name/${ITEM_ID}`,
    `https://walmart.com.evil.example/ip/Product-Name/${ITEM_ID}`,
    `https://evil.walmart.com/ip/Product-Name/${ITEM_ID}`,
    `https://user:secret@www.walmart.com/ip/Product-Name/${ITEM_ID}`,
    `https://www.walmart.com:8443/ip/Product-Name/${ITEM_ID}`,
    `https://www.walmart.com/search?q=${ITEM_ID}`,
    `https://www.walmart.com/ip/Product-Name/${ITEM_ID}/reviews`,
    "not a URL"
  ]) assert.equal(extractWalmartItemId(rejected), "", rejected);
});

test("Walmart route builders generate deterministic review-order, PDP, and tracking destinations", () => {
  assert.equal(buildWalmartPdpUrl(ITEM_ID), `https://www.walmart.com/ip/${ITEM_ID}`);
  assert.equal(
    buildWalmartReviewOrderUrl(ITEM_ID),
    `https://www.walmart.com/affil/cart/reviewOrder?items=${ITEM_ID}&cn=nc&veh=aff`
  );
  assert.deepEqual(
    [...new URL(buildWalmartReviewOrderUrl(ITEM_ID)).searchParams.keys()],
    ["items", "cn", "veh"],
    "Impact/Howl attribution values are never synthesized into the stored destination"
  );
  assert.equal(buildWalmartClickTrackingId(ITEM_ID), `walmart_${ITEM_ID}`);
  assert.deepEqual(buildWalmartPurchaseDestinations(PDP_URL), {
    walmartItemId: ITEM_ID,
    reviewOrderUrl: `https://www.walmart.com/affil/cart/reviewOrder?items=${ITEM_ID}&cn=nc&veh=aff`,
    pdpUrl: `https://www.walmart.com/ip/${ITEM_ID}`,
    trackingId: `walmart_${ITEM_ID}`
  });
  assert.equal(buildWalmartReviewOrderUrl("invalid"), "");
  assert.equal(buildWalmartPurchaseDestinations("https://www.walmart.com/cart"), null);
});

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    retailerId: "walmart",
    retailerSku: ITEM_ID,
    canonicalUrl: PDP_URL,
    availability: "in_stock",
    observedAt: new Date(NOW - 10_000).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
    unitPriceCents: 8_497,
    approvedMaxUnitPriceCents: 9_000,
    currency: "USD",
    sellerName: "Walmart",
    sellerType: "first_party",
    sellerPolicy: "first_party_only",
    observedFulfillment: "shipping",
    missionFulfillment: "shipping",
    sourceTrustLevel: "trusted_exact",
    missionDecision: "qualified",
    cartMutationInFlight: false,
    ...overrides
  };
}

test("Walmart direct purchase validation requires a fresh exact first-party offer inside policy", () => {
  const result = validateWalmartSignalPurchase(candidate(), NOW);
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "ready");
  assert.equal(result.destinations?.walmartItemId, ITEM_ID);

  const cases: Array<[Record<string, unknown>, string]> = [
    [{ retailerId: "target" }, "not_walmart"],
    [{ retailerSku: "20252562938" }, "item_identity_mismatch"],
    [{ availability: "unknown" }, "not_in_stock"],
    [{ observedAt: new Date(NOW - 120_001).toISOString() }, "signal_not_current"],
    [{ expiresAt: new Date(NOW).toISOString() }, "signal_not_current"],
    [{ unitPriceCents: null }, "price_unverified"],
    [{ unitPriceCents: 9_001 }, "price_above_limit"],
    [{ currency: "CAD" }, "currency_unsupported"],
    [{ sellerName: "Marketplace seller", sellerType: "third_party" }, "seller_unverified"],
    [{ sellerPolicy: "allow_third_party" }, "seller_policy_unsupported"],
    [{ observedFulfillment: "pickup" }, "fulfillment_unsupported"],
    [{ missionFulfillment: "pickup" }, "fulfillment_unsupported"],
    [{ sourceTrustLevel: "informational" }, "source_untrusted"],
    [{ missionDecision: "unmatched" }, "mission_not_qualified"],
    [{ cartMutationInFlight: true }, "cart_mutation_in_flight"]
  ];
  for (const [overrides, reason] of cases) {
    assert.equal(validateWalmartSignalPurchase(candidate(overrides), NOW).reason, reason, reason);
  }
});
