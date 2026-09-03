import assert from "node:assert/strict";
import test from "node:test";
import { TARGET_ADD_ADAPTER_VERSION, type SignalEventInput, type StrategyDefinition } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ActionAnalyticsRepository } from "../packages/database/src/action-analytics-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { SignalRepository } from "../packages/database/src/signal-repository.js";
import { SpendLedgerRepository } from "../packages/database/src/spend-ledger-repository.js";
import { runWithRequestScope } from "../packages/database/src/request-scope.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { normalizeSignal } from "../packages/domain/src/normalize.js";

const NOW = new Date("2026-08-22T19:00:00.000Z").getTime();

function purchaseStrategies(): StrategyDefinition[] {
  return [
    {
      id: "strategy_target_msrp",
      name: "Target at MSRP",
      enabled: true,
      position: 1,
      revision: 1,
      sources: ["trackalacker"],
      retailers: ["target"],
      pricePolicy: { kind: "at_or_below_msrp" },
      sellerPolicy: "first_party_only",
      allowedSellers: [],
      includeKeywords: "pokemon + \"elite trainer box\"",
      excludeKeywords: "used | refurbished",
      action: "add_to_cart",
      quantity: 2,
      fulfillment: "shipping",
      maxSignalAgeSeconds: 120
    },
    {
      id: "strategy_catchall_notify",
      name: "Catchall notify",
      enabled: true,
      position: 1_000,
      revision: 1,
      sources: [],
      retailers: [],
      pricePolicy: { kind: "any" },
      sellerPolicy: "first_party_only",
      allowedSellers: [],
      includeKeywords: "",
      excludeKeywords: "",
      action: "notify",
      quantity: 1,
      fulfillment: "shipping",
      maxSignalAgeSeconds: 120
    }
  ];
}

function trackalackerSignal(overrides: Partial<SignalEventInput> = {}): SignalEventInput {
  return {
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId: "track-event-1",
    eventType: "restock",
    observedAt: new Date(NOW - 1_000).toISOString(),
    identity: {
      sourceProductId: "5000",
      sourceListingId: "50001",
      retailerId: "target",
      retailerSku: "95280894",
      canonicalUrl: "https://www.target.com/p/-/A-95280894",
      title: "Pokemon Midnight Elite Trainer Box"
    },
    offer: {
      availability: "in_stock",
      unitPriceCents: 6500,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      orderLimit: 3,
      fulfillment: "shipping",
      offerId: "```ephemeral-offer-secret```"
    },
    evidence: {
      headline: "Pokemon Midnight Elite Trainer Box is in stock at Target",
      body: "In stock for $65.00"
    },
    parserVersion: "test-v1",
    ...overrides
  };
}

function seededEngine(): { db: YoinkDatabase; engine: SignalEngine } {
  const db = new YoinkDatabase();
  const catalog = new CatalogRepository(db);
  catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "5000",
    sourceListingId: "50001",
    title: "Pokemon Midnight Elite Trainer Box",
    retailerId: "target",
    retailerSku: "95280894",
    canonicalUrl: "https://www.target.com/p/-/A-95280894",
    listingStatus: "out_of_stock",
    executionSupported: true,
    msrpCents: 6999,
    currency: "USD",
    observedAt: new Date(NOW - 60_000).toISOString()
  }, NOW);
  const control = new ControlRepository(db);
  control.replaceStrategies(purchaseStrategies());
  control.setActionsPaused(false, "Test enabled actions");
  return { db, engine: new SignalEngine(db) };
}

function qualifyTargetAdd(db: YoinkDatabase): void {
  db.run(
    `INSERT INTO retailer_adapter_qualifications(
       tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
       evidence_hash, qualified_at, updated_at
     ) VALUES (?, ?, 'target', ?, 'add_to_cart', 'qualified', 'signal-engine-target-evidence', ?, ?)`,
    LOCAL_TENANT_ID,
    LOCAL_USER_ID,
    TARGET_ADD_ADAPTER_VERSION,
    new Date(NOW).toISOString(),
    new Date(NOW).toISOString()
  );
}

test("an exact under-MSRP signal creates one mission and a bounded shadow action job", () => {
  const { db, engine } = seededEngine();
  try {
    const result = engine.process(trackalackerSignal(), NOW);
    assert.equal(result.resolution, "matched");
    assert.equal(result.missionCreated, true);
    assert.equal(result.decision, "qualified");
    assert.equal(result.actionJobState, "shadow_ready");

    const job = db.get<{
      action: string;
      quantity: number;
      max_unit_price_cents: number;
      max_order_total_cents: number;
      fulfillment: string;
      expected_seller: string;
    }>("SELECT action, quantity, max_unit_price_cents, max_order_total_cents, fulfillment, expected_seller FROM action_jobs WHERE id = ?", result.actionJobId);
    assert.deepEqual({ ...job }, {
      action: "add_to_cart",
      quantity: 2,
      max_unit_price_cents: 6500,
      max_order_total_cents: 17560,
      fulfillment: "shipping",
      expected_seller: "Target"
    });
    assert.equal(db.get<{ target_quantity: number }>("SELECT target_quantity FROM missions WHERE id = ?", result.missionId)?.target_quantity, 2);

    const storedSignal = db.get<{ offer_json: string }>("SELECT offer_json FROM signal_events WHERE signal_id = ?", result.signalId)?.offer_json ?? "";
    const storedAudit = db.all<{ data_json: string }>("SELECT data_json FROM audit_events").map((row) => row.data_json).join("\n");
    assert.equal(storedSignal.includes("ephemeral-offer-secret"), false);
    assert.equal(storedAudit.includes("ephemeral-offer-secret"), false);
    assert.match(storedSignal, /offerFingerprint/);
  } finally {
    db.close();
  }
});

test("a live multi-unit strategy match degrades before spend reservation because guarded runners add one", () => {
  const { db, engine } = seededEngine();
  try {
    qualifyTargetAdd(db);
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
    const result = engine.process(trackalackerSignal({ externalEventId: "live-multi-unit-add" }), NOW);
    assert.equal(result.decision, "guarded_add_quantity_not_supported");
    assert.equal(result.actionJobState, "notify_only");
    const job = db.get<{ action: string; quantity: number; reservationId: string | null }>(
      `SELECT action, quantity, spend_reservation_id AS reservationId
       FROM action_jobs WHERE id = ?`,
      result.actionJobId
    );
    assert.deepEqual({ ...job }, { action: "notify", quantity: 2, reservationId: null });
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM spend_reservations")?.count, 0);
  } finally {
    db.close();
  }
});

test("an unqualified live add lane becomes a notification before spend reservation", () => {
  const { db, engine } = seededEngine();
  try {
    engine.control.replaceStrategies([{ ...purchaseStrategies()[0]!, quantity: 1 }], NOW);
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
    const result = engine.process(trackalackerSignal({ externalEventId: "unqualified-live-add" }), NOW);
    assert.equal(result.decision, "guarded_add_lane_not_qualified");
    assert.equal(result.actionJobState, "notify_only");
    const job = db.get<{ action: string; quantity: number; reservationId: string | null }>(
      `SELECT action, quantity, spend_reservation_id AS reservationId
       FROM action_jobs WHERE id = ?`,
      result.actionJobId
    );
    assert.deepEqual({ ...job }, { action: "notify", quantity: 1, reservationId: null });
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM spend_reservations")?.count, 0);
  } finally {
    db.close();
  }
});

test("a reviewed cart plan creates a bounded job without any signal strategy", () => {
  const { db, engine } = seededEngine();
  try {
    const listingId = db.get<{ id: string }>(
      "SELECT id FROM listings WHERE retailer_id = 'target' AND retailer_sku = '95280894'"
    )?.id;
    assert.ok(listingId);
    engine.control.replaceStrategies([], NOW);
    const configured = engine.control.createConfiguredMission({
      contractVersion: 1,
      listingId,
      targetQuantity: 2,
      maxUnitPriceCents: 7000,
      maxAllInCents: 18_680,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 900,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, NOW);
    assert.equal(engine.control.currentPurchaseIntentPolicy(configured.mission.id, NOW).decisionMode, "purchase_intent");

    const result = engine.process(trackalackerSignal({ externalEventId: "direct-plan-cart" }), NOW);
    assert.equal(result.decision, "qualified");
    assert.equal(result.strategyId, "");
    assert.equal(result.actionJobState, "shadow_ready");
    const storedJob = db.get<{
      action: string;
      quantity: number;
      decision_source: string;
      strategy_id: string | null;
      strategy_revision: number | null;
    }>(`SELECT action, quantity, decision_source, strategy_id, strategy_revision
        FROM action_jobs WHERE id = ?`, result.actionJobId);
    assert.deepEqual({ ...storedJob }, {
      action: "add_to_cart",
      quantity: 1,
      decision_source: "purchase_intent",
      strategy_id: null,
      strategy_revision: null
    });
    assert.equal(db.get<{ decision_source: string }>(
      "SELECT decision_source FROM mission_decisions WHERE mission_id = ?",
      configured.mission.id
    )?.decision_source, "purchase_intent");
  } finally {
    db.close();
  }
});

test("the first priced signal self-heals a linked store-price cart profile before evaluation", () => {
  const { db, engine } = seededEngine();
  try {
    const listingId = db.get<{ id: string }>(
      "SELECT id FROM listings WHERE retailer_id = 'target' AND retailer_sku = '95280894'"
    )?.id;
    assert.ok(listingId);
    engine.control.replaceStrategies([], NOW);
    const profile = engine.control.savePurchaseProfile({
      name: "Fresh store price",
      targetQuantity: 1,
      actionCeiling: "add_to_cart",
      fulfillment: "shipping",
      priceMode: "store_price",
      cooldownSeconds: 0
    }, NOW).profiles[0];
    assert.ok(profile);
    const configured = engine.control.createConfiguredMission({
      contractVersion: 1,
      listingId,
      targetQuantity: 1,
      maxUnitPriceCents: 7_000,
      maxAllInCents: 7_000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN",
      quickAddProfileId: profile.id
    }, NOW);
    const beforePrice = engine.control.applyPurchaseProfileToMissions({
      profileId: profile.id,
      missionIds: [configured.mission.id],
      confirmation: "APPLY_PROFILE_TO_SELECTED_PURCHASE_PLANS"
    }, NOW + 1);
    assert.equal(beforePrice.propagation.updatedMissionCount, 0);
    assert.equal(beforePrice.propagation.skipped[0]?.reasonCode, "price_unavailable");

    qualifyTargetAdd(db);
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
    const result = engine.process(trackalackerSignal({ externalEventId: "profile-self-heal-priced-signal" }), NOW + 2);
    assert.equal(result.decision, "qualified");
    assert.equal(result.actionJobState, "awaiting_executor");
    const policy = engine.control.currentPurchaseIntentPolicy(configured.mission.id, NOW + 2);
    assert.equal(policy.actionCeiling, "add_to_cart");
    assert.equal(policy.revision, 2);
    const job = db.get<{ action: string; maxUnitPriceCents: number }>(
      "SELECT action, max_unit_price_cents AS maxUnitPriceCents FROM action_jobs WHERE id = ?",
      result.actionJobId
    );
    assert.equal(job?.action, "add_to_cart");
    assert.equal(job?.maxUnitPriceCents, 6_500);
  } finally {
    db.close();
  }
});

test("a typed Got it close-out commits user-reported spend and satisfies only the intended quantity", () => {
  const { db, engine } = seededEngine();
  try {
    const listingId = db.get<{ id: string }>(
      "SELECT id FROM listings WHERE retailer_id = 'target' AND retailer_sku = '95280894'"
    )?.id;
    assert.ok(listingId);
    engine.control.replaceStrategies([], NOW);
    const configured = engine.control.createConfiguredMission({
      contractVersion: 1,
      listingId,
      targetQuantity: 2,
      maxUnitPriceCents: 7000,
      maxAllInCents: 18_680,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 900,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, NOW);
    qualifyTargetAdd(db);
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
    const created = engine.process(trackalackerSignal({ externalEventId: "user-reported-order" }), NOW);
    const spend = new SpendLedgerRepository(db);
    assert.equal(spend.reservationForJob(created.actionJobId)?.status, "active");
    db.run("UPDATE action_jobs SET state = 'confirmed' WHERE id = ?", created.actionJobId);
    spend.releaseForJob(created.actionJobId, "add_to_cart_confirmed_without_order", NOW + 1_000);
    const phaseLatency = {
      leaseToCartReadyMs: 8_240,
      leaseToBaselineMs: 2_500,
      baselineToOfferMs: 4_000,
      offerToClickMs: 110,
      clickToSettleMs: 410,
      clickToCartReadyMs: 1_630,
      settleToCartReadyMs: 1_220
    };
    db.run(
      `INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at)
       VALUES ('action_event_phase_latency_fixture', ?, 'confirmed', 'target_add_confirmed',
         'Fixture exact cart delta.', ?, ?)`,
      created.actionJobId,
      JSON.stringify({ latency: phaseLatency }),
      new Date(NOW + 1_100).toISOString()
    );

    const signals = new SignalRepository(db);
    const reviewedMaximumCents = Number(db.get<{ maximum: number }>(
      "SELECT max_order_total_cents AS maximum FROM action_jobs WHERE id = ?",
      created.actionJobId
    )?.maximum);
    const reportedTotalCents = reviewedMaximumCents + 500;
    const recorded = signals.reportCartOutcome(
      created.actionJobId,
      "got_it",
      "I_REVIEWED_CHECKOUT_RESULT",
      reportedTotalCents,
      "Manual checkout complete",
      NOW + 2_000
    );
    assert.equal(recorded.disposition, "recorded");
    assert.equal(recorded.outcome, "got_it");
    assert.equal(recorded.overCap, true);
    assert.equal(recorded.overCapAmountCents, 500);
    assert.equal(recorded.reviewedMaximumCents, reviewedMaximumCents);
    assert.equal(recorded.reservationStatus, "committed");
    assert.deepEqual({ ...db.get<{ fulfilled: number; status: string }>(
      "SELECT fulfilled_quantity AS fulfilled, status FROM missions WHERE id = ?",
      configured.mission.id
    ) }, { fulfilled: 1, status: "active" });
    assert.deepEqual({ ...db.get<{ status: string; amount: number }>(
      `SELECT status, committed_amount_cents AS amount
       FROM spend_reservations WHERE action_job_id = ?`,
      created.actionJobId
    ) }, { status: "committed", amount: reportedTotalCents });
    assert.equal(db.get<{ reason: string }>(
      `SELECT reason_code AS reason FROM spend_ledger_entries
       WHERE action_job_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      created.actionJobId
    )?.reason, "user_reported_order_committed");
    const analytics = new ActionAnalyticsRepository(db);
    const snapshot = analytics.snapshot(NOW + 2_001);
    assert.equal(snapshot.spend.committedCents, reportedTotalCents);
    assert.equal(snapshot.spend.overCapCount, 1);
    assert.equal(snapshot.spend.overCapAmountCents, 500);
    assert.equal(snapshot.spend.reportedOrders, 1);
    assert.equal(snapshot.spend.savingsCoveredOrders, 1);
    assert.equal(snapshot.spend.savingsCoverage, "complete");
    const csv = analytics.csv(NOW + 2_001);
    assert.match(csv, /^section,metric,retailer,value,unit,coverage/m);
    assert.match(csv, /funnel,closed,,1,actions,complete/);
    assert.match(csv, new RegExp(`spend,committed_cents,,${reportedTotalCents},cents,USD`));
    assert.match(csv, /spend,over_cap_orders,,1,orders,user_reported/);
    assert.match(csv, /spend,over_cap_amount_cents,,500,cents,user_reported/);
    assert.match(csv, /savings,vs_msrp_cents,/);
    assert.match(csv, /latency,observedToReceivedMs_p50,/);
    assert.match(csv, /latency,leaseToBaselineMs_p50,,2500,milliseconds,1 samples/);
    assert.match(csv, /latency,settleToCartReadyMs_p95,,1220,milliseconds,1 samples/);
    assert.equal(db.get<{ reason: string }>(
      `SELECT reason_code AS reason FROM action_events
       WHERE job_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      created.actionJobId
    )?.reason, "user_reported_order");
    const reportedEvidence = db.get<{ overCap: number; overCapAmount: number; reviewedMaximum: number }>(
      "SELECT json_extract(evidence_json, '$.overCap') AS overCap, json_extract(evidence_json, '$.overCapAmountCents') AS overCapAmount, json_extract(evidence_json, '$.reviewedMaximumCents') AS reviewedMaximum FROM action_events WHERE job_id = ? AND reason_code = 'user_reported_order'",
      created.actionJobId
    );
    assert.deepEqual({ ...reportedEvidence }, {
      overCap: 1,
      overCapAmount: 500,
      reviewedMaximum: reviewedMaximumCents
    });
    assert.equal(db.get<{ reason: string }>(
      "SELECT reason_code AS reason FROM audit_events WHERE correlation_id = ? AND event_type = 'user_reported_spend_committed'",
      created.actionJobId
    )?.reason, "user_reported_order_over_cap");
    const listed = signals.listJobs(20).find((job) => job.id === created.actionJobId);
    assert.equal(listed?.statusLabel, "Got it");
    assert.equal(listed?.stage, "closed");
    assert.equal(listed?.userReportOutcome, "got_it");
    assert.equal(listed?.userReportedTotalCents, reportedTotalCents);
    assert.equal(listed?.decisionReasonCode, "user_reported_order");
    assert.equal(typeof (listed?.latency as Record<string, unknown>)?.observedToReceivedMs, "number");
    assert.deepEqual({ ...(listed?.latency as Record<string, unknown>) }, {
      observedToReceivedMs: (listed?.latency as Record<string, unknown>)?.observedToReceivedMs,
      receivedToJobMs: (listed?.latency as Record<string, unknown>)?.receivedToJobMs,
      jobToLeaseMs: null,
      ...phaseLatency
    });
    const insights = signals.actionInsights() as {
      stages: Record<string, number>;
      latency: { hops: Record<string, { samples: number; p50Ms: number | null; p95Ms: number | null }> };
    };
    assert.equal(insights.stages.closed, 1);
    assert.equal(insights.latency.hops.observedToReceivedMs?.samples, 1);
    assert.equal(Number.isSafeInteger(insights.latency.hops.observedToReceivedMs?.p50Ms), true);
    assert.deepEqual(insights.latency.hops.leaseToBaselineMs, { samples: 1, p50Ms: 2_500, p95Ms: 2_500 });
    assert.deepEqual(insights.latency.hops.baselineToOfferMs, { samples: 1, p50Ms: 4_000, p95Ms: 4_000 });
    assert.deepEqual(insights.latency.hops.offerToClickMs, { samples: 1, p50Ms: 110, p95Ms: 110 });
    assert.deepEqual(insights.latency.hops.settleToCartReadyMs, { samples: 1, p50Ms: 1_220, p95Ms: 1_220 });

    const replay = signals.reportCartOutcome(
      created.actionJobId,
      "got_it",
      "I_REVIEWED_CHECKOUT_RESULT",
      reportedTotalCents,
      "",
      NOW + 3_000
    );
    assert.equal(replay.disposition, "unchanged");
    assert.equal(db.get<{ fulfilled: number }>(
      "SELECT fulfilled_quantity AS fulfilled FROM missions WHERE id = ?",
      configured.mission.id
    )?.fulfilled, 1);
    assert.throws(() => signals.reportCartOutcome(
      created.actionJobId,
      "got_it",
      "I_REVIEWED_CHECKOUT_RESULT",
      reportedTotalCents + 1,
      "",
      NOW + 4_000
    ), /different checkout result/);
  } finally {
    db.close();
  }
});

test("Missed it closes a Needs you cart action without spend or mission fulfillment", () => {
  const { db, engine } = seededEngine();
  try {
    const listingId = db.get<{ id: string }>(
      "SELECT id FROM listings WHERE retailer_id = 'target' AND retailer_sku = '95280894'"
    )?.id;
    assert.ok(listingId);
    engine.control.replaceStrategies([], NOW);
    const configured = engine.control.createConfiguredMission({
      contractVersion: 1,
      listingId,
      targetQuantity: 1,
      maxUnitPriceCents: 7000,
      maxAllInCents: 12_000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 900,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, NOW);
    qualifyTargetAdd(db);
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
    const created = engine.process(trackalackerSignal({ externalEventId: "user-reported-miss" }), NOW);
    db.run("UPDATE action_jobs SET state = 'manual_review' WHERE id = ?", created.actionJobId);
    db.run("UPDATE signal_incidents SET status = 'locked' WHERE id = ?", created.incidentId);

    const signals = new SignalRepository(db);
    const recorded = signals.reportCartOutcome(
      created.actionJobId,
      "missed_it",
      "I_REVIEWED_CHECKOUT_RESULT",
      null,
      "Cart was empty",
      NOW + 2_000
    );
    assert.equal(recorded.state, "cancelled");
    assert.equal(recorded.outcome, "missed_it");
    assert.equal(db.get<{ status: string }>(
      "SELECT status FROM spend_reservations WHERE action_job_id = ?",
      created.actionJobId
    )?.status, "released");
    assert.deepEqual({ ...db.get<{ fulfilled: number; status: string }>(
      "SELECT fulfilled_quantity AS fulfilled, status FROM missions WHERE id = ?",
      configured.mission.id
    ) }, { fulfilled: 0, status: "active" });
    assert.equal(db.get<{ reason: string }>(
      `SELECT reason_code AS reason FROM action_events
       WHERE job_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      created.actionJobId
    )?.reason, "user_reported_missed_it");
    assert.equal(db.get<{ amount: number }>(
      "SELECT COALESCE(SUM(spent_delta_cents), 0) AS amount FROM spend_ledger_entries WHERE action_job_id = ?",
      created.actionJobId
    )?.amount, 0);
    assert.equal(signals.reportCartOutcome(
      created.actionJobId,
      "missed_it",
      "I_REVIEWED_CHECKOUT_RESULT",
      null,
      "",
      NOW + 3_000
    ).disposition, "unchanged");
  } finally {
    db.close();
  }
});

test("a reviewed notification plan cannot be widened by an add strategy", () => {
  const { db, engine } = seededEngine();
  try {
    const listingId = db.get<{ id: string }>(
      "SELECT id FROM listings WHERE retailer_id = 'target' AND retailer_sku = '95280894'"
    )?.id;
    assert.ok(listingId);
    engine.control.createConfiguredMission({
      contractVersion: 1,
      listingId,
      targetQuantity: 1,
      maxUnitPriceCents: 7000,
      maxAllInCents: 7000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, NOW);

    const result = engine.process(trackalackerSignal({ externalEventId: "direct-plan-notify" }), NOW);
    assert.equal(result.decision, "qualified");
    assert.equal(result.strategyId, "");
    assert.equal(result.actionJobState, "notify_only");
    const storedJob = db.get<{ action: string; decision_source: string; strategy_id: string | null }>(
      "SELECT action, decision_source, strategy_id FROM action_jobs WHERE id = ?",
      result.actionJobId
    );
    assert.deepEqual({ ...storedJob }, { action: "notify", decision_source: "purchase_intent", strategy_id: null });
  } finally {
    db.close();
  }
});

test("an informational source cannot authorize a direct cart plan", () => {
  const { db, engine } = seededEngine();
  try {
    const listingId = db.get<{ id: string }>(
      "SELECT id FROM listings WHERE retailer_id = 'target' AND retailer_sku = '95280894'"
    )?.id;
    assert.ok(listingId);
    engine.control.createConfiguredMission({
      contractVersion: 1,
      listingId,
      targetQuantity: 1,
      maxUnitPriceCents: 7000,
      maxAllInCents: 10_840,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, NOW);
    const result = engine.process(trackalackerSignal({
      sourceConnectionId: "source_discord_local",
      source: "discord",
      externalEventId: "direct-plan-informational-source"
    }), NOW);
    assert.equal(result.decision, "untrusted_source");
    assert.equal(result.actionJobState, "notify_only");
    assert.equal(db.get<{ action: string }>(
      "SELECT action FROM action_jobs WHERE id = ?",
      result.actionJobId
    )?.action, "notify");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM spend_reservations")?.count, 0);
  } finally {
    db.close();
  }
});

test("a reviewed purchase plan rejects stale or seller-unverified evidence before creating a job", () => {
  const { db, engine } = seededEngine();
  try {
    const listingId = db.get<{ id: string }>(
      "SELECT id FROM listings WHERE retailer_id = 'target' AND retailer_sku = '95280894'"
    )?.id;
    assert.ok(listingId);
    engine.control.createConfiguredMission({
      contractVersion: 1,
      listingId,
      targetQuantity: 1,
      maxUnitPriceCents: 7000,
      maxAllInCents: 7000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, NOW);
    const stale = engine.process(trackalackerSignal({
      externalEventId: "direct-plan-stale",
      observedAt: new Date(NOW - 121_000).toISOString()
    }), NOW);
    assert.equal(stale.decision, "stale");
    assert.equal(stale.actionJobId, "");
    const sellerUnknown = engine.process(trackalackerSignal({
      externalEventId: "direct-plan-seller-unknown",
      offer: {
        availability: "in_stock",
        unitPriceCents: 6500,
        currency: "USD",
        sellerName: "",
        sellerType: "unknown",
        fulfillment: "shipping"
      }
    }), NOW + 1);
    assert.equal(sellerUnknown.decision, "unmatched");
    assert.equal(sellerUnknown.actionJobId, "");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 0);
  } finally {
    db.close();
  }
});

test("transport duplicates do not create another incident or job", () => {
  const { db, engine } = seededEngine();
  try {
    const first = engine.process(trackalackerSignal(), NOW);
    const duplicate = engine.process(trackalackerSignal(), NOW + 500);
    assert.equal(duplicate.duplicate, true);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events")?.count, 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_incidents")?.count, 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 1);
    assert.ok(first.actionJobId);
  } finally {
    db.close();
  }
});

test("another source corroborates the same opportunity without a second action", () => {
  const { db, engine } = seededEngine();
  try {
    const first = engine.process(trackalackerSignal(), NOW);
    const discord = engine.process({
      ...trackalackerSignal(),
      sourceConnectionId: "source_discord_local",
      source: "discord",
      externalEventId: "discord-event-1",
      identity: {
        retailerId: "target",
        retailerSku: "95280894",
        title: "Pokemon Midnight Elite Trainer Box"
      }
    }, NOW + 1_000);
    assert.equal(discord.corroborated, true);
    assert.equal(discord.incidentId, first.incidentId);
    assert.equal(discord.actionJobId, first.actionJobId);
    assert.equal(db.get<{ occurrence_count: number }>("SELECT occurrence_count FROM signal_incidents WHERE id = ?", first.incidentId)?.occurrence_count, 2);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 1);
  } finally {
    db.close();
  }
});

test("one active purchase job claims sibling store listings but releases after a safe cancellation", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const first = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "sibling-product",
      sourceListingId: "sibling-listing-1",
      title: "Pokemon Sibling Store Fixture",
      retailerId: "target",
      retailerSku: "111111111",
      canonicalUrl: "https://www.target.com/p/-/A-111111111",
      listingStatus: "out_of_stock",
      executionSupported: true,
      msrpCents: 6999
    }, NOW);
    catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "sibling-product",
      sourceListingId: "sibling-listing-2",
      title: "Pokemon Sibling Store Fixture",
      retailerId: "target",
      retailerSku: "222222222",
      canonicalUrl: "https://www.target.com/p/-/A-222222222",
      listingStatus: "out_of_stock",
      executionSupported: true,
      msrpCents: 6999
    }, NOW);
    const control = new ControlRepository(db);
    control.replaceStrategies(purchaseStrategies().map((strategy) => ({ ...strategy, includeKeywords: "" })), NOW);
    control.setActionsPaused(false, "Test enabled actions", NOW);
    const engine = new SignalEngine(db);
    const input = (listingId: string, sku: string, event: string, observedAt: number): SignalEventInput => ({
      ...trackalackerSignal(),
      externalEventId: event,
      observedAt: new Date(observedAt).toISOString(),
      identity: {
        sourceProductId: "sibling-product",
        sourceListingId: listingId,
        retailerId: "target",
        retailerSku: sku,
        canonicalUrl: `https://www.target.com/p/-/A-${sku}`,
        title: "Pokemon Sibling Store Fixture"
      }
    });
    const claimed = engine.process(input("sibling-listing-1", "111111111", "sibling-event-1", NOW - 2_000), NOW);
    const sibling = engine.process(input("sibling-listing-2", "222222222", "sibling-event-2", NOW - 1_000), NOW + 100);
    assert.equal(claimed.actionJobState, "shadow_ready");
    assert.equal(sibling.decision, "sibling_store_claimed");
    assert.equal(sibling.actionJobId, claimed.actionJobId);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 1);

    new SignalRepository(db).transitionJob(
      claimed.actionJobId,
      "cancelled",
      "cancelled_before_mutation",
      "The stale shadow claim was cancelled before mutation.",
      {},
      NOW + 200
    );
    const later = engine.process(input("sibling-listing-2", "222222222", "sibling-event-3", NOW + 500), NOW + 600);
    assert.notEqual(later.actionJobId, claimed.actionJobId);
    assert.equal(later.actionJobState, "shadow_ready");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 2);
    assert.equal(first.listing.variantId, db.get<{ variant_id: string }>("SELECT variant_id FROM listings WHERE retailer_sku = '222222222'")?.variant_id);
  } finally {
    db.close();
  }
});

test("closing an offer-mismatch incident permits a legitimate newer re-signal", () => {
  const { db, engine } = seededEngine();
  try {
    const first = engine.process(trackalackerSignal(), NOW);
    const signals = new SignalRepository(db);
    signals.transitionJob(first.actionJobId, "awaiting_executor", "fixture", "Fixture entered execution.", {}, NOW + 500);
    signals.transitionJob(first.actionJobId, "leased", "fixture", "Fixture lease acquired.", {}, NOW + 750);
    signals.transitionJob(first.actionJobId, "navigating", "fixture", "Fixture navigation started.", {}, NOW + 1_000);
    signals.transitionJob(first.actionJobId, "verifying_listing", "fixture", "Fixture offer verification started.", {}, NOW + 1_250);
    signals.transitionJob(first.actionJobId, "offer_rejected", "live_offer_changed", "The exact live offer no longer matched.", {}, NOW + 2_000);
    const listed = signals.listJobs(20).find((job) => job.id === first.actionJobId);
    assert.equal(listed?.decisionReasonCode, "live_offer_changed");
    assert.equal(listed?.decisionReason, "The exact live offer no longer matched.");
    assert.equal(signals.jobCount("live offer no longer matched"), 1);
    const second = engine.process(trackalackerSignal({
      externalEventId: "track-event-2",
      observedAt: new Date(NOW + 3_000).toISOString()
    }), NOW + 4_000);
    assert.equal(second.duplicate, false);
    assert.equal(second.corroborated, false);
    assert.notEqual(second.incidentId, first.incidentId);
    assert.notEqual(second.actionJobId, first.actionJobId);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 2);
  } finally {
    db.close();
  }
});

test("the compact user action handoff tracks active stages, prioritizes review, and clears after close-out", () => {
  const { db, engine } = seededEngine();
  try {
    const created = engine.process(trackalackerSignal({ externalEventId: "compact-action-handoff" }), NOW);
    const signals = new SignalRepository(db);

    db.run("UPDATE action_jobs SET state = 'awaiting_executor' WHERE id = ?", created.actionJobId);
    assert.deepEqual(signals.actionHandoffSummary(NOW + 1_000), {
      contractVersion: 1,
      generatedAt: new Date(NOW + 1_000).toISOString(),
      counts: { queued: 1, checking: 0, readyToCheckout: 0, needsYou: 0 },
      primary: null
    });

    db.run("UPDATE action_jobs SET state = 'adding' WHERE id = ?", created.actionJobId);
    assert.deepEqual(signals.actionHandoffSummary(NOW + 2_000).counts, {
      queued: 0,
      checking: 1,
      readyToCheckout: 0,
      needsYou: 0
    });

    db.run("UPDATE action_jobs SET state = 'confirmed' WHERE id = ?", created.actionJobId);
    const ready = signals.actionHandoffSummary(NOW + 3_000);
    assert.equal(ready.counts.readyToCheckout, 1);
    assert.equal(ready.primary?.id, created.actionJobId);
    assert.equal(ready.primary?.stage, "ready_to_checkout");
    assert.equal(ready.primary?.statusLabel, "Ready to check out");
    assert.equal(ready.primary?.retailerId, "target");
    assert.equal(ready.primary?.retailerSku, "95280894");
    assert.equal(ready.primary?.title, "Pokemon Midnight Elite Trainer Box");

    db.run("UPDATE action_jobs SET state = 'manual_review' WHERE id = ?", created.actionJobId);
    const review = signals.actionHandoffSummary(NOW + 4_000);
    assert.equal(review.counts.needsYou, 1);
    assert.equal(review.primary?.stage, "needs_you");
    assert.equal(review.primary?.statusLabel, "Needs you");

    db.run(
      `INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at)
       VALUES ('action_event_compact_handoff_closed', ?, 'manual_review',
         'user_reported_missed_it', 'Fixture close-out.', '{}', ?)`,
      created.actionJobId,
      new Date(NOW + 5_000).toISOString()
    );
    assert.deepEqual(signals.actionHandoffSummary(NOW + 6_000), {
      contractVersion: 1,
      generatedAt: new Date(NOW + 6_000).toISOString(),
      counts: { queued: 0, checking: 0, readyToCheckout: 0, needsYou: 0 },
      primary: null
    });
  } finally {
    db.close();
  }
});

test("a locked uncertain job can be closed only after explicit user browser review", () => {
  const { db, engine } = seededEngine();
  try {
    const result = engine.process(trackalackerSignal({ externalEventId: "track-event-manual-review" }), NOW);
    db.run("UPDATE action_jobs SET state = 'manual_review' WHERE id = ?", result.actionJobId);
    db.run("UPDATE action_jobs SET expires_at = ? WHERE id = ?", new Date(NOW - 1_000).toISOString(), result.actionJobId);
    db.run("UPDATE signal_incidents SET status = 'locked' WHERE id = ?", result.incidentId);
    const signals = new SignalRepository(db);
    const missionId = db.get<{ mission_id: string }>("SELECT mission_id FROM action_jobs WHERE id = ?", result.actionJobId)?.mission_id;
    assert.ok(missionId);
    assert.equal(signals.activePurchaseJobForMission(missionId, NOW + 86_400_000)?.id, result.actionJobId);
    assert.throws(() => signals.resolveReviewJob(
      result.actionJobId,
      "cancelled",
      "",
      ""
    ), /explicit browser-state confirmation/);
    const resolved = signals.resolveReviewJob(
      result.actionJobId,
      "cancelled",
      "I_REVIEWED_BROWSER_STATE",
      "Retailer cart checked empty",
      NOW + 1_000
    );
    assert.equal(resolved.state, "cancelled");
    assert.equal(db.get<{ status: string }>("SELECT status FROM signal_incidents WHERE id = ?", result.incidentId)?.status, "closed");
    assert.equal(db.get<{ reason_code: string }>("SELECT reason_code FROM action_events WHERE job_id = ? ORDER BY created_at DESC LIMIT 1", result.actionJobId)?.reason_code, "user_verified_no_purchase");
  } finally {
    db.close();
  }
});

test("an over-MSRP signal falls through to the lower catchall notification", () => {
  const { db, engine } = seededEngine();
  try {
    const result = engine.process(trackalackerSignal({
      externalEventId: "track-event-high-price",
      offer: {
        availability: "in_stock",
        unitPriceCents: 7000,
        currency: "USD",
        sellerName: "Target",
        sellerType: "first_party",
        fulfillment: "shipping"
      }
    }), NOW);
    assert.equal(result.strategyId, "strategy_catchall_notify");
    assert.equal(result.actionJobState, "notify_only");
    assert.equal(result.decision, "qualified");
  } finally {
    db.close();
  }
});

test("an explicit allowed-seller list never qualifies a sellerless signal", () => {
  const { db, engine } = seededEngine();
  try {
    const control = new ControlRepository(db);
    control.replaceStrategies(purchaseStrategies().map((strategy) => strategy.id === "strategy_target_msrp"
      ? { ...strategy, allowedSellers: ["Target"] }
      : strategy));
    const result = engine.process(trackalackerSignal({
      externalEventId: "track-event-seller-missing",
      offer: {
        availability: "in_stock",
        unitPriceCents: 6500,
        currency: "USD",
        sellerName: "",
        sellerType: "unknown",
        fulfillment: "shipping"
      }
    }), NOW);
    assert.equal(result.strategyId, "strategy_catchall_notify");
    assert.equal(result.actionJobState, "notify_only");
  } finally {
    db.close();
  }
});

test("test signals never create catalog records, missions, incidents, or jobs", () => {
  const db = new YoinkDatabase();
  try {
    const result = new SignalEngine(db).process(trackalackerSignal({
      externalEventId: "track-test-event",
      test: true,
      identity: {
        sourceProductId: "new-test-product",
        sourceListingId: "new-test-listing",
        retailerId: "amazon",
        retailerSku: "B0TEST0001",
        canonicalUrl: "https://www.amazon.com/dp/B0TEST0001",
        title: "Test product"
      }
    }), NOW);
    assert.equal(result.decision, "test_signal");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_incidents")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 0);
  } finally {
    db.close();
  }
});

test("a trusted exact new-product signal creates catalog identity but degrades safely without MSRP", () => {
  const db = new YoinkDatabase();
  try {
    const control = new ControlRepository(db);
    control.replaceStrategies(purchaseStrategies());
    control.setActionsPaused(false, "Test enabled actions");
    const result = new SignalEngine(db).process(trackalackerSignal({
      externalEventId: "brand-new-event",
      identity: {
        sourceProductId: "brand-new-product",
        sourceListingId: "brand-new-listing",
        retailerId: "amazon",
        retailerSku: "B0NEW00001",
        canonicalUrl: "https://www.amazon.com/dp/B0NEW00001",
        title: "Pokemon New Elite Trainer Box"
      }
    }), NOW);
    assert.equal(result.resolutionMethod, "exact_signal_identity");
    assert.equal(result.missionCreated, true);
    assert.equal(result.actionJobState, "notify_only");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings")?.count, 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 1);
  } finally {
    db.close();
  }
});

test("signal incidents with the same semantic offer remain isolated by exact tenant and user", () => {
  const { db, engine } = seededEngine();
  try {
    db.run(
      "INSERT INTO tenants(id, name, created_at) VALUES ('tenant_signal_other', 'Other', ?)",
      new Date(NOW).toISOString()
    );
    db.run(
      `INSERT INTO users(id, tenant_id, display_name, created_at)
       VALUES ('user_signal_other', 'tenant_signal_other', 'Other user', ?)`,
      new Date(NOW).toISOString()
    );
    const listingId = db.get<{ id: string }>(
      "SELECT id FROM listings WHERE retailer_id = 'target' AND retailer_sku = '95280894'"
    )?.id;
    assert.ok(listingId);
    const listing = engine.catalog.requireListing(listingId);
    const signal = normalizeSignal(trackalackerSignal(), NOW);
    const semanticKey = engine.signals.semanticKey(signal, listing);
    const localIncident = engine.signals.createIncident(signal, listing, semanticKey, NOW);

    const otherIncident = runWithRequestScope({
      tenantId: "tenant_signal_other",
      userId: "user_signal_other",
      actorKind: "service",
      actorId: "signal_isolation_test"
    }, () => {
      assert.equal(engine.signals.findOpenIncident(semanticKey, "2026-08-22T00:00:00.000Z"), null);
      assert.throws(
        () => engine.signals.corroborateIncident(localIncident, signal, NOW + 1),
        /no longer exists/
      );
      return engine.signals.createIncident(signal, listing, semanticKey, NOW + 2);
    });

    assert.notEqual(otherIncident.id, localIncident.id);
    assert.deepEqual(db.all(
      `SELECT tenant_id AS tenantId, user_id AS userId, occurrence_count AS occurrenceCount
       FROM signal_incidents WHERE semantic_key = ? ORDER BY tenant_id`,
      semanticKey
    ).map((row) => ({ ...row })), [
      { tenantId: "tenant_local", userId: "user_local", occurrenceCount: 1 },
      { tenantId: "tenant_signal_other", userId: "user_signal_other", occurrenceCount: 1 }
    ]);
  } finally {
    db.close();
  }
});
