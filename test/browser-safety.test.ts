import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_SAFETY_CONTRACT_VERSION,
  type BrowserActionContract,
  type CartInventoryEvidence,
  type CheckoutEvidence,
  type LiveOfferObservation,
  verifyCheckoutEvidence,
  verifyLiveOffer,
  verifySingleJobCart
} from "../packages/browser-safety/src/index.js";

const NOW = new Date("2026-08-22T22:00:00.000Z").getTime();
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function job(overrides: Partial<BrowserActionContract> = {}): BrowserActionContract {
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    jobId: "job_browser_safety",
    retailerId: "amazon",
    retailerSku: "B0SAFE00001",
    canonicalUrl: "https://www.amazon.com/dp/B0SAFE00001",
    action: "prepare_checkout",
    quantity: 1,
    maxUnitPriceCents: 6000,
    maxOrderTotalCents: 9720,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Amazon.com",
    fulfillment: "shipping",
    expiresAt: new Date(NOW + 60_000).toISOString(),
    ...overrides
  };
}

function offer(overrides: Partial<LiveOfferObservation> = {}): LiveOfferObservation {
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    observedAt: new Date(NOW - 1_000).toISOString(),
    url: "https://www.amazon.com/dp/B0SAFE00001",
    pageKind: "product",
    retailerId: "amazon",
    retailerSku: "B0SAFE00001",
    availability: "in_stock",
    unitPriceCents: 5999,
    currency: "USD",
    sellerName: "Amazon.com",
    sellerType: "first_party",
    fulfillment: "shipping",
    addControlActionable: true,
    securityChallenge: false,
    interactiveBlock: "",
    ...overrides
  };
}

test("live verification binds exact listing, seller, price, fulfillment, and actionable control", () => {
  assert.equal(verifyLiveOffer(job(), offer(), NOW).ok, true);
  const failures: Array<[Partial<LiveOfferObservation>, string]> = [
    [{ retailerSku: "B0WRONG0001" }, "listing_mismatch"],
    [{ unitPriceCents: 6001 }, "over_unit_cap"],
    [{ sellerName: "Marketplace", sellerType: "third_party" }, "third_party_seller"],
    [{ availability: "out_of_stock" }, "out_of_stock"],
    [{ fulfillment: "pickup" }, "fulfillment_unverified"],
    [{ addControlActionable: false }, "add_control_unavailable"],
    [{ securityChallenge: true }, "manual_action_required"]
  ];
  for (const [change, reason] of failures) assert.equal(verifyLiveOffer(job(), offer(change), NOW).reason, reason);
});

test("pickup requires an exact pickup job while ambiguous jobs fail closed", () => {
  assert.equal(verifyLiveOffer(
    job({ fulfillment: "pickup" }),
    offer({ fulfillment: "pickup" }),
    NOW
  ).ok, true);
  assert.equal(verifyLiveOffer(
    job({ fulfillment: "pickup" }),
    offer({ fulfillment: "shipping" }),
    NOW
  ).reason, "fulfillment_unverified");
  assert.equal(verifyLiveOffer(
    job({ fulfillment: "either" }),
    offer({ fulfillment: "pickup" }),
    NOW
  ).reason, "fulfillment_not_supported");
});

test("third-party permission still binds a named live marketplace seller", () => {
  const thirdPartyJob = job({ sellerPolicy: "allow_third_party", expectedSeller: "Sold by Acme Collectibles" });
  assert.equal(verifyLiveOffer(thirdPartyJob, offer({ sellerName: "Acme Collectibles", sellerType: "third_party" }), NOW).ok, true);
  assert.equal(verifyLiveOffer(thirdPartyJob, offer({ sellerName: "Another Seller", sellerType: "third_party" }), NOW).reason, "signal_seller_mismatch");
  assert.equal(verifyLiveOffer(thirdPartyJob, offer({ sellerName: "", sellerType: "third_party" }), NOW).reason, "seller_unverified");
});

function cart(overrides: Partial<CartInventoryEvidence> = {}): CartInventoryEvidence {
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    observedAt: new Date(NOW).toISOString(),
    complete: true,
    independentlyCounted: true,
    independentLineCount: 1,
    lines: [{ retailerSku: "B0SAFE00001", quantity: 1, unitPriceCents: 5999, sellerName: "Amazon.com", sellerType: "first_party" }],
    ...overrides
  };
}

test("cart verification rejects foreign lines, quantity drift, and a replacement over-cap offer", () => {
  const live = verifyLiveOffer(job(), offer(), NOW);
  assert.equal(live.ok, true);
  if (!live.ok) return;
  assert.equal(verifySingleJobCart(job(), cart(), live.proof, NOW).ok, true);
  assert.equal(verifySingleJobCart(job(), cart({ independentLineCount: 2, lines: [...cart().lines, { retailerSku: "FOREIGN", quantity: 1, unitPriceCents: 1, sellerName: "Amazon.com", sellerType: "first_party" }] }), live.proof, NOW).reason, "foreign_cart_line");
  assert.equal(verifySingleJobCart(job(), cart({ lines: [{ ...cart().lines[0]!, quantity: 2 }] }), live.proof, NOW).reason, "quantity_unavailable");
  assert.equal(verifySingleJobCart(job(), cart({ lines: [{ ...cart().lines[0]!, unitPriceCents: 7000 }] }), live.proof, NOW).reason, "over_unit_cap");
});

function checkout(overrides: Partial<CheckoutEvidence> = {}): CheckoutEvidence {
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    source: "visible-checkout-dom",
    observedAt: new Date(NOW).toISOString(),
    retailerId: "amazon",
    retailerSku: "B0SAFE00001",
    fulfillment: "shipping",
    destinationFingerprint: HASH_A,
    pickupStoreFingerprint: "",
    paymentInstrumentSetFingerprint: HASH_B,
    paymentInstrumentCount: 1,
    substitutions: "not-applicable",
    substitutionSku: "B0SAFE00001",
    cartComplete: true,
    cartIndependentlyCounted: true,
    cartLineCount: 1,
    cartSku: "B0SAFE00001",
    cartQuantity: 1,
    orderTotalCents: 7000,
    unsafeChoices: [],
    submitControlActionable: true,
    ...overrides
  };
}

function cartProof() {
  const live = verifyLiveOffer(job(), offer(), NOW);
  assert.equal(live.ok, true);
  if (!live.ok) throw new Error("fixture offer did not verify");
  const result = verifySingleJobCart(job(), cart(), live.proof, NOW);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("fixture cart did not verify");
  return result.proof;
}

test("checkout review requires exact cart scope, bounded total, and privacy-preserving visible evidence", () => {
  const proof = cartProof();
  assert.equal(verifyCheckoutEvidence(job(), proof, checkout(), NOW).ok, true);
  assert.equal(verifyCheckoutEvidence(job(), proof, checkout({ orderTotalCents: 9721 }), NOW).reason, "over_total_cap");
  assert.equal(verifyCheckoutEvidence(job(), proof, checkout({ cartLineCount: 2 }), NOW).reason, "cart_unverified");
  assert.equal(verifyCheckoutEvidence(job(), proof, checkout({ substitutions: "enabled" }), NOW).reason, "substitution_unverified");
  assert.equal(verifyCheckoutEvidence(job(), proof, checkout({ unsafeChoices: ["membership"] }), NOW).reason, "manual_action_required");
});

test("submit order additionally requires unchanged user-approved checkout fingerprints", () => {
  const proof = cartProof();
  const submit = job({
    action: "submit_order",
    checkoutTrust: {
      destinationFingerprint: HASH_A,
      pickupStoreFingerprint: "",
      paymentInstrumentSetFingerprint: HASH_B,
      paymentInstrumentCount: 1
    }
  });
  assert.equal(verifyCheckoutEvidence(job({ action: "submit_order" }), proof, checkout(), NOW).reason, "checkout_trust_required");
  assert.equal(verifyCheckoutEvidence(submit, proof, checkout(), NOW).ok, true);
  assert.equal(verifyCheckoutEvidence(submit, proof, checkout({ paymentInstrumentSetFingerprint: "c".repeat(64) }), NOW).reason, "checkout_trust_changed");
  assert.equal(verifyCheckoutEvidence(submit, proof, checkout({ submitControlActionable: false }), NOW).reason, "submit_control_unavailable");
});
