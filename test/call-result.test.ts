import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_WANT_CONTRACT_VERSION,
  PRODUCT_WANT_PREVIEW_CONFIRMATION,
  PRODUCT_WANT_SAVE_CONFIRMATION,
  TARGET_ADD_ADAPTER_VERSION,
  type ProductWantMode,
  type SignalEventInput
} from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { SignalRepository } from "../packages/database/src/signal-repository.js";
import {
  describeCallResult,
  describeCallRow,
  summarizeCallResults,
  type CallResult,
  type CallResultInput
} from "../packages/domain/src/call-result.js";
import {
  INTENT_PRICE_ABOVE_MAX_REASON,
  INTENT_SELLER_REASON,
  INTENT_TARGET_DISABLED_REASON
} from "../packages/domain/src/strategies.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { enablePlansFromCalls } from "./helpers/plans-from-calls.js";

const NOW = new Date("2026-09-30T18:00:00.000Z").getTime();

function input(overrides: Partial<CallResultInput> = {}): CallResultInput {
  return {
    test: false,
    outcome: "qualified",
    reason: "",
    storeName: "Walmart",
    storeOn: true,
    priceCents: 6499,
    currency: "USD",
    msrpCents: 4999,
    sourceMsrpStatus: "",
    sellerType: "unknown",
    observedAt: "2026-09-30T17:59:58.000Z",
    receivedAt: "2026-09-30T17:59:59.000Z",
    plan: null,
    job: null,
    signedInState: "ready",
    ...overrides
  };
}

const cartPlan = { status: "active", actionCeiling: "add_to_cart", origin: "user_want", targetEnabled: true, targetMaxCents: 5500 };
const alertPlan = { ...cartPlan, actionCeiling: "notify" };
function job(overrides: Partial<NonNullable<CallResultInput["job"]>> = {}): NonNullable<CallResultInput["job"]> {
  return {
    action: "add_to_cart",
    state: "awaiting_executor",
    firstState: "awaiting_executor",
    reasonCode: "purchase_intent_qualified",
    notificationState: "",
    notificationFailureCode: "",
    userReportOutcome: "",
    ...overrides
  };
}

// Shopper copy rules from test/ui-glossary.test.ts, applied to every generated sentence.
const FORBIDDEN = /\b(?:missions?|purchase intents?|retailers?|signals?|opportunit(?:y|ies)|strateg(?:y|ies)|devices?|executors?|connections?|guarded|runners?|lanes?|qualif(?:y|ied|ication|ications)|rehearsals?|read-only|armed)\b/i;

function assertPlainCopy(result: CallResult): void {
  for (const text of [result.label, result.reason, result.detail]) {
    assert.doesNotMatch(text, FORBIDDEN, text);
    assert.doesNotMatch(text, /undefined|null|NaN|\$NaN/, text);
  }
}

test("calls with no plan, over the max, or turned down for seller read as no action with the reason and numbers", () => {
  const noPlan = describeCallResult(input({ outcome: "no_mission" }));
  assert.equal(noPlan.kind, "no_action");
  assert.equal(noPlan.label, "No action");
  assert.equal(noPlan.reason, "Not on your Want list");
  assert.equal(noPlan.fix, "want_it");
  assert.match(noPlan.detail, /Walmart listed it at \$64\.99, above its \$49\.99 MSRP\./);
  assert.equal(noPlan.priceVsMsrp, "above");

  const overMax = describeCallResult(input({ outcome: "unmatched", reason: INTENT_PRICE_ABOVE_MAX_REASON, plan: cartPlan }));
  assert.equal(overMax.kind, "no_action");
  assert.equal(overMax.reason, "Over your max price");
  assert.equal(overMax.detail, "Walmart listed it at $64.99, over your $55.00 max. That's above its $49.99 MSRP too.");
  assert.equal(overMax.priceVsMax, "over");
  assert.equal(overMax.fix, "edit_want");

  const surge = describeCallResult(input({ outcome: "no_mission", msrpCents: null, sourceMsrpStatus: "surge" }));
  assert.match(surge.detail, /a price surge over MSRP/);
  assert.equal(surge.priceVsMsrp, "above");

  const thirdParty = describeCallResult(input({ outcome: "unmatched", reason: INTENT_SELLER_REASON, sellerType: "third_party", plan: alertPlan }));
  assert.equal(thirdParty.reason, "Sold by another seller");

  // A plan a call created by itself is not a shopper choice.
  const autoPlan = describeCallResult(input({
    outcome: "unmatched",
    reason: INTENT_SELLER_REASON,
    plan: { ...alertPlan, origin: "signal:trackalacker", targetMaxCents: null }
  }));
  assert.equal(autoPlan.reason, "Not on your Want list");
  assert.equal(autoPlan.fix, "want_it");

  const offStore = describeCallResult(input({
    outcome: "unmatched", reason: INTENT_TARGET_DISABLED_REASON, storeName: "Best Buy", storeOn: false, plan: { ...cartPlan, targetEnabled: false }
  }));
  assert.equal(offStore.reason, "Best Buy is off for cart adds");
  assert.equal(offStore.fix, "store_setup");
  const notWatched = describeCallResult(input({
    outcome: "unmatched", reason: INTENT_TARGET_DISABLED_REASON, plan: { ...alertPlan, targetEnabled: false }
  }));
  assert.equal(notWatched.reason, "Not watching Walmart");

  const stale = describeCallResult(input({
    outcome: "stale", observedAt: "2026-09-30T17:10:00.000Z", receivedAt: "2026-09-30T17:59:00.000Z"
  }));
  assert.equal(stale.reason, "Arrived too late");
  assert.match(stale.detail, /49 minutes after the restock/);

  // A no-action outcome never borrows the job an earlier call created on the same restock.
  const paused = describeCallResult(input({ outcome: "plan_paused", plan: { ...cartPlan, status: "paused" }, job: job({ state: "confirmed" }) }));
  assert.equal(paused.kind, "no_action");
  assert.equal(paused.reason, "Paused");
  for (const result of [noPlan, overMax, surge, thirdParty, autoPlan, offStore, notWatched, stale, paused]) assertPlainCopy(result);
});

test("alerts explain why Yoink alerted instead of adding, and failed deliveries say so", () => {
  const alertsOnly = describeCallResult(input({ plan: alertPlan, job: job({ action: "notify", state: "notify_only", notificationState: "delivered" }) }));
  assert.equal(alertsOnly.kind, "alert");
  assert.equal(alertsOnly.label, "Alert sent");
  assert.equal(alertsOnly.reason, "Alerts only");
  assert.equal(alertsOnly.fix, "edit_want");

  // An alert from back when the item was set to alerts says so, even after it switched to Add to cart.
  const then = describeCallResult(input({ plan: cartPlan, job: job({ action: "notify", state: "notify_only", notificationState: "delivered" }) }));
  assert.equal(then.reason, "Alerts only");
  assert.match(then.detail, /^The item was set to alerts when this call came in, so Yoink sent an alert\..*It's set to Add to cart now\.$/);
  assert.equal(then.fix, "");
  assertPlainCopy(then);

  const paused = describeCallResult(input({ outcome: "actions_paused", plan: cartPlan, job: job({ action: "notify", state: "notify_only", notificationState: "pending" }) }));
  assert.equal(paused.label, "Sending alert");
  assert.equal(paused.reason, "Cart adds paused");
  assert.equal(paused.fix, "resume_actions");

  const storeOff = describeCallResult(input({
    outcome: "guarded_add_lane_not_qualified", storeName: "Target", plan: cartPlan,
    job: job({ action: "notify", state: "notify_only", reasonCode: "guarded_add_lane_not_qualified", notificationState: "delivered" })
  }));
  assert.equal(storeOff.reason, "Target is off for cart adds");
  assert.equal(storeOff.fix, "store_setup");

  const spend = describeCallResult(input({
    outcome: "daily_spend_cap_exceeded", plan: cartPlan,
    job: job({ action: "notify", state: "notify_only", reasonCode: "daily_spend_cap_exceeded", notificationState: "clicked" })
  }));
  assert.equal(spend.reason, "Daily limit reached");
  assert.equal(spend.fix, "spending_limits");

  const failed = describeCallResult(input({
    plan: alertPlan,
    job: job({ action: "notify", state: "notify_only", notificationState: "expired", notificationFailureCode: "no_device_poll" })
  }));
  assert.equal(failed.label, "Alert not delivered");
  assert.equal(failed.tone, "warn");
  assert.match(failed.detail, /Chrome never asked Yoink for this call/);
  for (const result of [alertsOnly, paused, storeOff, spend, failed]) assertPlainCopy(result);
});

test("cart attempts read as added, adding, needs you, checked only, or not added with the store's reason", () => {
  const added = describeCallResult(input({ storeName: "Target", plan: cartPlan, job: job({ state: "confirmed", reasonCode: "target_add_confirmed" }) }));
  assert.deepEqual([added.kind, added.label, added.reason, added.fix], ["added", "Added to cart", "In your Target cart", "open_cart"]);

  const waiting = describeCallResult(input({ plan: cartPlan, job: job() }));
  assert.deepEqual([waiting.kind, waiting.reason], ["adding", "Waiting for Chrome"]);
  // Retry when sold out (Kevin, 2026-10-09): the job waits for its next try.
  const retrying = describeCallResult(input({ plan: cartPlan, job: job({ reasonCode: "restock_retry_scheduled" }) }));
  assert.deepEqual([retrying.kind, retrying.reason], ["adding", "Sold out, trying again"]);
  assert.doesNotMatch(retrying.detail, FORBIDDEN);
  const adding = describeCallResult(input({ plan: cartPlan, job: job({ state: "verifying_listing" }) }));
  assert.equal(adding.reason, "Chrome is adding it");

  const needsYou = describeCallResult(input({ plan: cartPlan, job: job({ state: "manual_review", reasonCode: "cart_delta_unverified" }) }));
  assert.deepEqual([needsYou.kind, needsYou.reason], ["needs_you", "Check your Walmart cart"]);

  const checked = describeCallResult(input({ plan: cartPlan, job: job({ state: "expired", firstState: "shadow_ready", reasonCode: "signal_window_expired" }) }));
  assert.equal(checked.kind, "checked");
  const expired = describeCallResult(input({ plan: cartPlan, job: job({ state: "expired", reasonCode: "signal_window_expired" }) }));
  assert.deepEqual([expired.kind, expired.reason], ["not_added", "Chrome didn't get to it in time"]);

  const signedOut = describeCallResult(input({
    storeName: "Amazon", plan: cartPlan, signedInState: "signed_out",
    job: job({ state: "cancelled", reasonCode: "cart_unverified" })
  }));
  assert.deepEqual([signedOut.kind, signedOut.reason, signedOut.fix], ["not_added", "Signed out of Amazon", "store_setup"]);
  const stoppedAtStep = describeCallResult(input({ plan: cartPlan, job: job({ state: "cancelled", reasonCode: "extension_error_verifying_listing_timeout" }) }));
  assert.deepEqual([stoppedAtStep.kind, stoppedAtStep.reason], ["not_added", "Chrome stopped before adding"], "a named step reads like a plain extension error");
  // A store's robot check, or a link that opened another item, is the store's answer (Kevin's Walmart call, 2026-10-12).
  const robotCheck = describeCallResult(input({ plan: cartPlan, signedInState: "signed_out", job: job({ state: "cancelled", reasonCode: "security_challenge" }) }));
  assert.deepEqual([robotCheck.kind, robotCheck.reason, robotCheck.fix], ["not_added", "Walmart wanted a robot check", "store_setup"]);
  assert.match(robotCheck.detail, /Finish it in the open Walmart tab/);
  const robotCheckOnPage = describeCallResult(input({ plan: cartPlan, job: job({ state: "offer_rejected", reasonCode: "security_challenge" }) }));
  assert.equal(robotCheckOnPage.reason, "Walmart wanted a robot check");
  const otherItem = describeCallResult(input({ plan: cartPlan, job: job({ state: "cancelled", reasonCode: "listing_mismatch" }) }));
  assert.deepEqual([otherItem.kind, otherItem.reason], ["not_added", "Store page didn't match"]);
  assert.match(otherItem.detail, /opened a different item/);
  const cartUnread = describeCallResult(input({ storeName: "Amazon", plan: cartPlan, job: job({ state: "cancelled", reasonCode: "cart_page_unverified" }) }));
  assert.equal(cartUnread.reason, "Couldn't read your Amazon cart");
  const soldOut = describeCallResult(input({ plan: cartPlan, job: job({ state: "offer_rejected", reasonCode: "out_of_stock" }) }));
  assert.equal(soldOut.reason, "Sold out when Chrome checked");
  const priceRose = describeCallResult(input({ plan: cartPlan, job: job({ state: "offer_rejected", reasonCode: "over_unit_cap" }) }));
  assert.equal(priceRose.reason, "Price went over your max");
  const outdated = describeCallResult(input({ plan: cartPlan, job: job({ state: "offer_rejected", reasonCode: "adapter_version_mismatch" }) }));
  assert.equal(outdated.reason, "Update the Chrome companion");
  const gotIt = describeCallResult(input({ plan: cartPlan, job: job({ state: "confirmed", userReportOutcome: "got_it" }) }));
  assert.deepEqual([gotIt.kind, gotIt.label], ["added", "Got it"]);

  const repeat = describeCallResult(input({ outcome: "corroborated", plan: cartPlan, job: job({ state: "confirmed" }) }));
  assert.equal(repeat.kind, "repeat");
  const testCall = describeCallResult(input({ test: true, outcome: "test_signal" }));
  assert.equal(testCall.kind, "test");
  for (const result of [added, waiting, adding, needsYou, checked, expired, signedOut, cartUnread, soldOut, priceRose, outdated, gotIt, repeat, testCall]) {
    assertPlainCopy(result);
  }

  assert.deepEqual(summarizeCallResults([added, waiting, needsYou, expired, repeat, testCall]), {
    total: 6, added: 1, adding: 1, needsYou: 1, alerts: 0, notAdded: 1, noAction: 2
  });
});

function trackalackerPush(overrides: Partial<SignalEventInput> & { externalEventId: string }): SignalEventInput {
  return {
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    eventType: "restock",
    observedAt: new Date(NOW - 1_000).toISOString(),
    identity: {
      sourceProductId: "call-log-product",
      sourceListingId: "call-log-target",
      retailerId: "target",
      retailerSku: "95000001",
      canonicalUrl: "https://www.target.com/p/-/A-95000001",
      title: "Call Log Elite Trainer Box"
    },
    // TrackaLacker pushes never say who sells the item or how it ships.
    offer: { availability: "in_stock", unitPriceCents: 6499, currency: "USD", sellerName: "", sellerType: "unknown", fulfillment: "unknown" },
    evidence: { headline: "Call Log Elite Trainer Box is in stock at Target", body: "$64.99", msrpStatus: "above_msrp" },
    parserVersion: "trackalacker-push-v1",
    ...overrides
  };
}

function seeded(): { db: YoinkDatabase; engine: SignalEngine; control: ControlRepository; targetId: string; walmartId: string } {
  const db = new YoinkDatabase();
  const catalog = new CatalogRepository(db);
  const target = catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
    sourceProductId: "call-log-product", sourceListingId: "call-log-target",
    title: "Call Log Elite Trainer Box", retailerId: "target", retailerSku: "95000001",
    canonicalUrl: "https://www.target.com/p/-/A-95000001", listingStatus: "out_of_stock",
    executionSupported: true, msrpCents: 4999, observedPriceCents: 4999, currency: "USD",
    observedAt: new Date(NOW - 3_600_000).toISOString()
  }, NOW - 3_600_000).listing;
  const walmart = catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
    sourceProductId: "call-log-product", sourceListingId: "call-log-walmart",
    title: "Call Log Elite Trainer Box", retailerId: "walmart", retailerSku: "5550001",
    canonicalUrl: "https://www.walmart.com/ip/5550001", listingStatus: "out_of_stock",
    executionSupported: false, msrpCents: 4999, currency: "USD",
    observedAt: new Date(NOW - 3_600_000).toISOString()
  }, NOW - 3_600_000).listing;
  const control = new ControlRepository(db);
  control.setActionsPaused(false, "Test enabled actions");
  return { db, engine: new SignalEngine(db), control, targetId: target.id, walmartId: walmart.id };
}

function want(control: ControlRepository, listingId: string, mode: ProductWantMode, maxUnitPriceCents: number, now = NOW): string {
  // A cart want at Target needs an MSRP; the shopper confirms one equal to their max.
  const confirmedMsrpCents = mode === "add_to_cart" ? maxUnitPriceCents : null;
  const preview = control.previewProductWant({
    contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId, mode, maxUnitPriceCents, confirmedMsrpCents,
    confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION
  }, now);
  return control.saveProductWant({
    contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId, mode, maxUnitPriceCents, confirmedMsrpCents,
    targetQuantity: preview.targetQuantity,
    confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
    previewFingerprint: preview.previewFingerprint,
    previewedAt: preview.previewedAt
  }, now).purchaseIntentId;
}

function latestCall(db: YoinkDatabase): CallResult {
  const row = new SignalRepository(db).listSignals(1, 0, "")[0];
  assert.ok(row);
  return describeCallRow(row);
}

test("the real engine's decisions read back as the call log describes them", () => {
  const { db, engine, control, targetId } = seeded();
  enablePlansFromCalls(db);
  try {
    // No plan, plans from calls on: TrackaLacker creates a watch-only plan by itself, which never alerts on an unconfirmed seller.
    const unplanned = engine.process(trackalackerPush({ externalEventId: "call-log-unplanned" }), NOW);
    assert.equal(unplanned.missionCreated, true);
    assert.equal(unplanned.decision, "unmatched");
    const notWanted = latestCall(db);
    assert.deepEqual([notWanted.kind, notWanted.reason, notWanted.fix], ["no_action", "Not on your Want list", "want_it"]);
    assert.match(notWanted.detail, /Target listed it at \$64\.99, above its \$49\.99 MSRP\./);

    // Want it at Target for up to $55: a $64.99 call is over the max.
    want(control, targetId, "add_to_cart", 5500, NOW + 1_000);
    const over = engine.process(trackalackerPush({ externalEventId: "call-log-over", observedAt: new Date(NOW + 1_500).toISOString() }), NOW + 2_000);
    assert.equal(over.decision, "unmatched");
    const overMax = latestCall(db);
    assert.equal(overMax.reason, "Over your max price");
    assert.equal(overMax.detail, "Target listed it at $64.99, over your $55.00 max. That's above its $49.99 MSRP too.");

    // Alert me: the shopper's own alerts-only plan alerts even though TrackaLacker doesn't name the seller.
    want(control, targetId, "notify", 7000, NOW + 3_000);
    const alerted = engine.process(trackalackerPush({ externalEventId: "call-log-alert", observedAt: new Date(NOW + 3_500).toISOString() }), NOW + 4_000);
    assert.equal(alerted.decision, "qualified");
    assert.ok(alerted.actionJobId);
    const alert = latestCall(db);
    assert.deepEqual([alert.kind, alert.reason], ["alert", "Alerts only"]);
    assert.equal(db.get<{ action: string }>("SELECT action FROM action_jobs WHERE id = ?", alerted.actionJobId)?.action, "notify");
  } finally {
    db.close();
  }
});

test("a paused or live account turns the same cart want into an alert or a queued cart add", () => {
  const { db, engine, control, targetId } = seeded();
  try {
    want(control, targetId, "add_to_cart", 7000, NOW);
    control.setActionsPaused(true, "Paused for the test");
    engine.process(trackalackerPush({ externalEventId: "call-log-paused" }), NOW + 1_000);
    const paused = latestCall(db);
    assert.deepEqual([paused.kind, paused.reason, paused.fix], ["alert", "Cart adds paused", "resume_actions"]);

    control.setActionsPaused(false, "Resumed for the test");
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0 WHERE user_id = ?", LOCAL_USER_ID);
    db.run(
      `INSERT INTO retailer_adapter_qualifications(
         tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
         evidence_hash, qualified_at, updated_at
       ) VALUES (?, ?, 'target', ?, 'add_to_cart', 'qualified', 'call-log-target-evidence', ?, ?)`,
      LOCAL_TENANT_ID, LOCAL_USER_ID, TARGET_ADD_ADAPTER_VERSION, new Date(NOW).toISOString(), new Date(NOW).toISOString()
    );
    const live = engine.process(trackalackerPush({
      externalEventId: "call-log-live",
      observedAt: new Date(NOW + 400_000).toISOString(),
      offer: { availability: "in_stock", unitPriceCents: 4999, currency: "USD", sellerName: "", sellerType: "unknown", fulfillment: "unknown" }
    }), NOW + 401_000);
    assert.equal(live.actionJobState, "awaiting_executor");
    const queued = latestCall(db);
    assert.deepEqual([queued.kind, queued.label, queued.reason], ["adding", "Adding to cart", "Waiting for Chrome"]);
  } finally {
    db.close();
  }
});
