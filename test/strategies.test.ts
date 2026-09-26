import assert from "node:assert/strict";
import test from "node:test";
import type {
  ListingContext,
  MissionContext,
  PurchaseIntentPolicy,
  SignalEventInput,
  StrategyDefinition
} from "../packages/contracts/src/index.js";
import { MAX_SIGNAL_FUTURE_SKEW_MS, normalizeSignal, withServerReceivedAt } from "../packages/domain/src/normalize.js";
import {
  CURRENCY_MISMATCH_REASON,
  NOTIFY_SIGNAL_MAX_AGE_SECONDS,
  STALE_FOR_CART_INTENT_REASON,
  STALE_FOR_CART_REASON_PREFIX,
  evaluatePurchaseIntent,
  evaluateStrategies,
  signalFreshness
} from "../packages/domain/src/strategies.js";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");

function signal(overrides: { observedAgeMs?: number; currency?: string; unitPriceCents?: number | null; receivedAt?: string } = {}) {
  const input: SignalEventInput = {
    schemaVersion: 1,
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId: "event-1",
    eventType: "in_stock",
    observedAt: new Date(NOW - (overrides.observedAgeMs ?? 5_000)).toISOString(),
    ...(overrides.receivedAt ? { receivedAt: overrides.receivedAt } : {}),
    identity: { retailerId: "target", retailerSku: "95280894", title: "Pokemon Elite Trainer Box" },
    offer: {
      availability: "in_stock",
      unitPriceCents: overrides.unitPriceCents === undefined ? 4_999 : overrides.unitPriceCents,
      currency: overrides.currency ?? "USD",
      sellerType: "first_party",
      fulfillment: "shipping"
    }
  } as SignalEventInput;
  return normalizeSignal(input, NOW);
}

const listing: ListingContext = {
  id: "listing_1",
  variantId: "variant_1",
  title: "Pokemon Elite Trainer Box",
  retailerId: "target",
  retailerSku: "95280894",
  canonicalUrl: "https://www.target.com/p/-/A-95280894",
  executionSupported: true,
  msrpCents: 5_999,
  currency: "USD"
};

const mission: MissionContext = {
  id: "mission_1",
  status: "active",
  targetQuantity: 1,
  targetId: "target_1",
  targetEnabled: true,
  maxUnitPriceCents: 6_000,
  sellerPolicy: "first_party_only",
  fulfillment: "shipping"
};

function policy(actionCeiling: PurchaseIntentPolicy["actionCeiling"], maxSignalAgeSeconds = 120): PurchaseIntentPolicy {
  return {
    id: "policy_1",
    missionId: "mission_1",
    revision: 1,
    quantity: 1,
    currency: "USD",
    maxAllInCents: 7_000,
    actionCeiling,
    decisionMode: "purchase_intent",
    maxSignalAgeSeconds,
    substitutionPolicy: "exact_only",
    expiresAt: "",
    cooldownSeconds: 0,
    targets: [{
      targetId: "target_1",
      listingId: "listing_1",
      retailerId: "target",
      enabled: true,
      maxUnitPriceCents: 6_000,
      sellerPolicy: "first_party_only",
      fulfillment: "shipping"
    }],
    policyHash: "hash",
    changeReason: "",
    createdByActorId: "",
    createdAt: new Date(NOW - 86_400_000).toISOString()
  };
}

function strategy(action: StrategyDefinition["action"]): StrategyDefinition {
  return {
    id: `strategy_${action}`,
    name: `Target ${action}`,
    enabled: true,
    position: 1,
    revision: 1,
    sources: ["trackalacker"],
    retailers: ["target"],
    pricePolicy: { kind: "absolute_max", maxPriceCents: 6_000 },
    sellerPolicy: "first_party_only",
    allowedSellers: [],
    includeKeywords: "",
    excludeKeywords: "",
    action,
    quantity: 1,
    fulfillment: "shipping",
    maxSignalAgeSeconds: 120
  } as StrategyDefinition;
}

test("signalFreshness separates the cart window from the notification bound", () => {
  const at = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();
  assert.equal(signalFreshness(at(119_000), 120, NOW), "cart");
  assert.equal(signalFreshness(at(121_000), 120, NOW), "notify");
  assert.equal(signalFreshness(at(NOTIFY_SIGNAL_MAX_AGE_SECONDS * 1_000), 120, NOW), "notify");
  assert.equal(signalFreshness(at(NOTIFY_SIGNAL_MAX_AGE_SECONDS * 1_000 + 1), 120, NOW), "stale");
  // A configured bound above the notify bound is never shortened.
  assert.equal(signalFreshness(at(3_000_000), 3_600, NOW), "cart");
  assert.equal(signalFreshness(at(3_700_000), 3_600, NOW), "stale");
  // A source clock slightly ahead is fine for a call but not for a cart add.
  assert.equal(signalFreshness(at(-20_000), 120, NOW), "cart");
  assert.equal(signalFreshness(at(-60_000), 120, NOW), "notify");
  assert.equal(signalFreshness(at(-(MAX_SIGNAL_FUTURE_SKEW_MS + 1)), 120, NOW), "stale");
  assert.equal(signalFreshness("not a date", 120, NOW), "stale");
});

test("a notify-only plan still notifies for a restock that arrived minutes late", () => {
  const late = evaluatePurchaseIntent(policy("notify"), signal({ observedAgeMs: 300_000 }), listing, mission, NOW);
  assert.equal(late.state, "matched");
  assert.equal(late.effectiveAction, "notify");
  assert.equal(late.maxSignalAgeSeconds, 120, "the attested bound stays the plan's own value");
  const tooLate = evaluatePurchaseIntent(policy("notify"), signal({ observedAgeMs: 1_801_000 }), listing, mission, NOW);
  assert.equal(tooLate.state, "stale");
});

test("a cart plan downgrades a signal too old for the cart window to a notification", () => {
  const fresh = evaluatePurchaseIntent(policy("add_to_cart"), signal({ observedAgeMs: 60_000 }), listing, mission, NOW);
  assert.equal(fresh.effectiveAction, "add_to_cart");
  const late = evaluatePurchaseIntent(policy("add_to_cart"), signal({ observedAgeMs: 300_000 }), listing, mission, NOW);
  assert.equal(late.state, "matched");
  assert.equal(late.effectiveAction, "notify");
  assert.equal(late.reason, STALE_FOR_CART_INTENT_REASON);
  assert.equal(late.maxSignalAgeSeconds, 120);
  // An over-cap price is still rejected after the downgrade.
  const overCap = evaluatePurchaseIntent(policy("add_to_cart"), signal({ observedAgeMs: 300_000, unitPriceCents: 7_500 }), listing, mission, NOW);
  assert.equal(overCap.state, "unmatched");
});

test("a signal priced in another currency is never compared with the cap", () => {
  // ¥5000 would pass a $60 cap if the minor units were compared directly.
  const cart = evaluatePurchaseIntent(policy("add_to_cart"), signal({ currency: "JPY", unitPriceCents: 5_000 }), listing, mission, NOW, {
    allowDeferredLiveOfferVerification: true
  });
  assert.equal(cart.state, "needs_price");
  assert.equal(cart.effectiveAction, "notify");
  assert.equal(cart.reason, CURRENCY_MISMATCH_REASON);
  // A CAD price above the USD cap does not suppress the call either.
  const notify = evaluatePurchaseIntent(policy("notify"), signal({ currency: "CAD", unitPriceCents: 9_000 }), listing, mission, NOW);
  assert.equal(notify.state, "needs_price");
  assert.equal(notify.effectiveAction, "notify");

  const strategyCart = evaluateStrategies([strategy("add_to_cart")], signal({ currency: "JPY", unitPriceCents: 5_000 }), listing, mission, NOW);
  assert.equal(strategyCart.state, "needs_price");
  assert.equal(strategyCart.effectiveAction, "notify");
});

test("strategy evaluation notifies late signals and downgrades late cart matches", () => {
  const notify = evaluateStrategies([strategy("notify")], signal({ observedAgeMs: 600_000 }), listing, mission, NOW);
  assert.equal(notify.state, "matched");
  assert.equal(notify.effectiveAction, "notify");
  assert.equal(notify.maxSignalAgeSeconds, 120);

  const cart = evaluateStrategies([strategy("add_to_cart")], signal({ observedAgeMs: 600_000 }), listing, mission, NOW);
  assert.equal(cart.state, "matched");
  assert.equal(cart.effectiveAction, "notify");
  assert.ok(cart.reason.startsWith(STALE_FOR_CART_REASON_PREFIX));

  const fresh = evaluateStrategies([strategy("add_to_cart")], signal({ observedAgeMs: 10_000 }), listing, mission, NOW);
  assert.equal(fresh.effectiveAction, "add_to_cart");

  const stale = evaluateStrategies([strategy("add_to_cart")], signal({ observedAgeMs: 2_000_000 }), listing, mission, NOW);
  assert.equal(stale.state, "stale");
  assert.equal(stale.maxSignalAgeSeconds, 120);
});

test("the engine clamps a future receivedAt to server time without changing the normalized payload", () => {
  const futureIso = new Date(NOW + 86_400_000).toISOString();
  const future = signal({ receivedAt: futureIso });
  assert.equal(future.receivedAt, futureIso, "normalizeSignal keeps durable payloads byte-stable");
  assert.equal(withServerReceivedAt(future, NOW).receivedAt, new Date(NOW).toISOString());
  const past = signal({ receivedAt: new Date(NOW - 2_000).toISOString() });
  assert.equal(withServerReceivedAt(past, NOW), past);
});
