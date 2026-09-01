import assert from "node:assert/strict";
import test from "node:test";
import type {
  ListingContext,
  MissionContext,
  NormalizedSignal,
  PurchaseIntentPolicy,
  StrategyDefinition
} from "../packages/contracts/src/index.js";
import { evaluatePurchaseIntent, evaluateStrategies } from "../packages/domain/src/strategies.js";

const NOW = new Date("2026-08-29T18:00:00.000Z").getTime();

const LISTING: ListingContext = {
  id: "listing_fulfillment",
  variantId: "variant_fulfillment",
  title: "Exact product",
  retailerId: "target",
  retailerSku: "13331333",
  canonicalUrl: "https://www.target.com/p/example/-/A-13331333",
  executionSupported: true,
  msrpCents: 539,
  currency: "USD"
};

const MISSION: MissionContext = {
  id: "mission_fulfillment",
  status: "active",
  targetQuantity: 1,
  targetId: "target_fulfillment",
  targetEnabled: true,
  maxUnitPriceCents: 539,
  sellerPolicy: "first_party_only",
  fulfillment: "inherit"
};

const STRATEGY: StrategyDefinition = {
  id: "strategy_fulfillment",
  name: "Exact fulfillment",
  enabled: true,
  position: 1,
  revision: 1,
  sources: [],
  retailers: [],
  pricePolicy: { kind: "absolute_max", maxPriceCents: 539 },
  sellerPolicy: "first_party_only",
  allowedSellers: [],
  includeKeywords: "",
  excludeKeywords: "",
  action: "add_to_cart",
  quantity: 1,
  fulfillment: "either",
  maxSignalAgeSeconds: 120
};

function signal(fulfillment: NormalizedSignal["offer"]["fulfillment"]): NormalizedSignal {
  const timestamp = new Date(NOW - 1_000).toISOString();
  return {
    schemaVersion: 1,
    signalId: `signal_${fulfillment}`,
    sourceConnectionId: "source_fulfillment",
    source: "test",
    externalEventId: `event_${fulfillment}`,
    eventType: "in_stock",
    observedAt: timestamp,
    receivedAt: timestamp,
    test: false,
    identity: {
      sourceProductId: "product_fulfillment",
      sourceListingId: "listing_fulfillment",
      retailerId: "target",
      retailerSku: "13331333",
      canonicalUrl: LISTING.canonicalUrl,
      title: LISTING.title,
      globalIdentifiers: {}
    },
    offer: {
      availability: "in_stock",
      unitPriceCents: 539,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      orderLimit: 1,
      fulfillment,
      offerFingerprint: `offer_${fulfillment}`
    },
    evidence: { headline: "", body: "", msrpStatus: "", clickUrl: "" },
    parserVersion: "test-v1",
    transportHash: "a".repeat(64),
    ephemeralOfferId: ""
  };
}

function policy(fulfillment: PurchaseIntentPolicy["targets"][number]["fulfillment"]): PurchaseIntentPolicy {
  return {
    id: "policy_fulfillment",
    missionId: MISSION.id,
    revision: 1,
    quantity: 1,
    currency: "USD",
    maxAllInCents: 539,
    actionCeiling: "add_to_cart",
    decisionMode: "purchase_intent",
    maxSignalAgeSeconds: 120,
    substitutionPolicy: "exact_only",
    expiresAt: "",
    cooldownSeconds: 0,
    targets: [{
      targetId: MISSION.targetId,
      listingId: LISTING.id,
      retailerId: LISTING.retailerId,
      enabled: true,
      maxUnitPriceCents: 539,
      sellerPolicy: "first_party_only",
      fulfillment
    }],
    policyHash: "b".repeat(64),
    changeReason: "test",
    createdByActorId: "actor_test",
    createdAt: new Date(NOW - 2_000).toISOString()
  };
}

test("legacy and ambiguous strategy fulfillment defaults to exact shipping", () => {
  const shipping = evaluateStrategies([STRATEGY], signal("shipping"), LISTING, MISSION, NOW);
  assert.equal(shipping.state, "matched");
  assert.equal(shipping.fulfillment, "shipping");
  assert.equal(evaluateStrategies([STRATEGY], signal("pickup"), LISTING, MISSION, NOW).state, "unmatched");
  assert.equal(evaluateStrategies([STRATEGY], signal("unknown"), LISTING, MISSION, NOW).state, "unmatched");
});

test("pickup is eligible only after an exact pickup configuration and observation", () => {
  const pickupStrategy = { ...STRATEGY, fulfillment: "pickup" as const };
  assert.equal(evaluateStrategies([pickupStrategy], signal("pickup"), LISTING, MISSION, NOW).fulfillment, "pickup");
  assert.equal(evaluateStrategies([pickupStrategy], signal("shipping"), LISTING, MISSION, NOW).state, "unmatched");

  const defaultPlan = evaluatePurchaseIntent(policy("either"), signal("shipping"), LISTING, MISSION, NOW);
  assert.equal(defaultPlan.state, "matched");
  assert.equal(defaultPlan.fulfillment, "shipping");
  assert.equal(evaluatePurchaseIntent(policy("either"), signal("pickup"), LISTING, MISSION, NOW).state, "unmatched");
  assert.equal(evaluatePurchaseIntent(policy("pickup"), signal("pickup"), LISTING, MISSION, NOW).fulfillment, "pickup");
  assert.equal(evaluatePurchaseIntent(policy("pickup"), signal("shipping"), LISTING, MISSION, NOW).state, "unmatched");
});

test("trusted exact cart triggers may defer missing fulfillment to Chrome but never override a conflict", () => {
  const unknown = signal("unknown");
  unknown.offer.sellerName = "";
  unknown.offer.sellerType = "unknown";

  assert.equal(evaluatePurchaseIntent(policy("either"), unknown, LISTING, MISSION, NOW).state, "unmatched");
  const deferredShipping = evaluatePurchaseIntent(
    policy("either"),
    unknown,
    LISTING,
    MISSION,
    NOW,
    { allowDeferredLiveOfferVerification: true }
  );
  assert.equal(deferredShipping.state, "matched");
  assert.equal(deferredShipping.effectiveAction, "add_to_cart");
  assert.equal(deferredShipping.fulfillment, "shipping");
  assert.match(deferredShipping.reason, /Chrome must verify/);

  const noPrice = signal("unknown");
  noPrice.offer.unitPriceCents = null;
  noPrice.offer.sellerName = "";
  noPrice.offer.sellerType = "unknown";
  const deferredPrice = evaluatePurchaseIntent(
    policy("either"),
    noPrice,
    LISTING,
    MISSION,
    NOW,
    { allowDeferredLiveOfferVerification: true }
  );
  assert.equal(deferredPrice.state, "matched");
  assert.equal(deferredPrice.effectiveUnitCapCents, 539);

  const deferredPickup = evaluatePurchaseIntent(
    policy("pickup"),
    unknown,
    LISTING,
    MISSION,
    NOW,
    { allowDeferredLiveOfferVerification: true }
  );
  assert.equal(deferredPickup.state, "matched");
  assert.equal(deferredPickup.fulfillment, "pickup");

  const thirdParty = signal("unknown");
  thirdParty.offer.sellerName = "Marketplace seller";
  thirdParty.offer.sellerType = "third_party";
  assert.equal(evaluatePurchaseIntent(
    policy("either"),
    thirdParty,
    LISTING,
    MISSION,
    NOW,
    { allowDeferredLiveOfferVerification: true }
  ).state, "unmatched");
  assert.equal(evaluatePurchaseIntent(
    policy("pickup"),
    signal("shipping"),
    LISTING,
    MISSION,
    NOW,
    { allowDeferredLiveOfferVerification: true }
  ).state, "unmatched");
});
