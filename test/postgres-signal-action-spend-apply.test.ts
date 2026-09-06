import { verifyCheckoutAccounting } from "./helpers/checkout-accounting-postgres.js";
import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_ACTION_SPEND_APPLY_FUNCTION,
  buildPostgresSignalActionSpendApplyManifest,
  postgresSignalActionSpendCapabilityProjection,
  postgresSignalActionSpendPlanFingerprint,
  signalActionSpendApplyFunctionSource,
  type PostgresSignalActionSpendApplyPlan
} from "../packages/database/src/postgres-signal-action-spend-apply.js";

test("the action/spend boundary is deterministic, least privilege, bounded, and inactive", () => {
  const manifest = buildPostgresSignalActionSpendApplyManifest();
  assert.deepEqual(buildPostgresSignalActionSpendApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.strategyEvaluationApplyContractVersion, 1);
  assert.equal(manifest.writerLockProtocolContractVersion, 1);
  assert.equal(manifest.constraintConfigApplyContractVersion, 1);
  assert.equal(manifest.actionSpendRole.kind, "signal_action_spend_apply_boundary");
  assert.equal(manifest.actionSpendRole.functionName, POSTGRES_SIGNAL_ACTION_SPEND_APPLY_FUNCTION);
  assert.equal(manifest.actionSpendRole.login, false);
  assert.equal(manifest.actionSpendRole.inherit, false);
  assert.equal(manifest.actionSpendRole.bypassRls, false);
  assert.equal(manifest.actionSpendRole.directTableAccess, false);
  // Contract v2 adds the strategies table as a read-only revalidated table
  // (existence/ownership/enabled/revision checks for a strategy-sourced
  // decision), the same way postgres-signal-strategy-evaluation-apply.ts
  // already protects it: it joins protectedTenantTableNames (forced RLS) but
  // never joins mutationTableNames (no strategy row is ever written here).
  assert.equal(manifest.protectedTenantTableCount, 20);
  assert.equal(manifest.forcedRlsTableCount, 20);
  assert.equal(manifest.mutationTableCount, 9);
  assert.deepEqual(manifest.actionSpendRole.mutationTableNames, [
    "action_events", "action_jobs", "audit_events", "exact_offer_keys",
    "mission_decisions", "offer_snapshots", "outbox_events",
    "spend_ledger_entries", "spend_reservations"
  ]);
  assert.ok(manifest.actionSpendRole.protectedTenantTableNames.includes("strategies"));
  assert.equal(
    manifest.actionSpendRole.mutationTableNames.includes("strategies"),
    false
  );
  assert.equal(manifest.fixedOrderConfigurationLocks, true);
  assert.equal(manifest.sharedWriterLockProtocolImplemented, true);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.constraintConfigBoundaryQualified, true);
  assert.equal(manifest.settingsPauseWriterParity, true);
  assert.equal(manifest.guardrailSettingsWriterParity, true);
  assert.equal(manifest.spendPolicyWriterParity, true);
  assert.equal(manifest.settingsWriterParity, false);
  assert.equal(manifest.configurationWriterParity, false);
  assert.equal(manifest.reservationWriterParity, false);
  assert.equal(manifest.currentMissionTargetRevalidation, true);
  assert.equal(manifest.currentSpendPolicyRevalidation, true);
  assert.equal(manifest.remainingQuantityRevalidation, true);
  assert.equal(manifest.siblingClaimRevalidation, true);
  assert.equal(manifest.cooldownRevalidation, true);
  assert.equal(manifest.periodicSpendRevalidation, true);
  // Contract v2: the operation surface now accepts decisionSource "strategy"
  // as well as "purchase_intent", so purchaseIntentOnly is honestly false —
  // but strategyActionAuthority stays false because a strategy decision
  // never receives add_to_cart authority (see strategyCartActionAuthority
  // and strategyFailoverToNotifyEnforced below): SQLite-truth derivation is
  // documented in the module-level comment block above the function source.
  assert.equal(manifest.purchaseIntentOnly, false);
  assert.equal(manifest.strategyActionAuthority, false);
  assert.equal(manifest.strategySemanticsContractVersion, 2);
  assert.equal(manifest.strategyDecisionSourceAccepted, true);
  assert.equal(manifest.strategyExistenceRevalidation, true);
  assert.equal(manifest.strategyFailoverToNotifyEnforced, true);
  assert.equal(manifest.strategyCartActionAuthority, false);
  assert.equal(manifest.strategyReservationAuthority, false);
  assert.equal(manifest.trustedStrategyActionSemanticsQualified, true);
  assert.equal(manifest.exactFirstPartyFulfillmentOnly, true);
  // A strategy decision may request up to 99 units (only its resulting
  // action is always forced to "notify"), so the boundary is no longer
  // exclusively quantity-1 or exclusively add-to-cart.
  assert.equal(manifest.quantityOneOnly, false);
  assert.equal(manifest.addToCartOnly, false);
  assert.equal(manifest.canonicalAttributionOnly, true);
  assert.equal(manifest.actionMutation, true);
  assert.equal(manifest.spendMutation, true);
  assert.equal(manifest.retailerMutation, false);
  assert.equal(manifest.checkoutMutation, false);
  assert.equal(manifest.orderSubmissionMutation, false);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.attributionPolicyParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalActionSpendApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_apply_trackalacker_signal_strategy_evaluation/);
  assert.match(source, /yoink_lock_signal_action_constraints/);
  assert.match(source, /signal_action_spend_00_message_v1/);
  assert.match(source, /signal_action_spend_01_mission_v1/);
  assert.match(source, /shared writer-lock protocol failed/);
  assert.doesNotMatch(source, /signal_action_spend_0[2345]_(?:source|settings|policy|spend)_v1/);
  assert.match(source, /FOR UPDATE OF mission, target/);
  assert.match(source, /remaining quantity is exhausted/);
  assert.match(source, /periodic spending capacity is exhausted/);
  assert.match(source, /mission already has an active purchase claim/);
  assert.match(source, /retailer add lane is not currently qualified/);
  assert.match(source, /fulfillment NOT IN \('shipping', 'pickup'\)/);
  assert.match(source, /target_policy_record\.fulfillment <> fulfillment_value/);
  assert.match(source, /mission_record\.fulfillment <> fulfillment_value/);
  assert.match(
    source,
    /octet_length\(\(attestation->>'missionId'\)\).*\|\| \(attestation->>'missionId'\) \|\| '\|'/
  );
  assert.doesNotMatch(source, /\|\| attestation->>/);
  assert.match(source, /INSERT INTO .*"action_jobs"/s);
  assert.match(source, /INSERT INTO .*"spend_reservations"/s);
  assert.match(source, /INSERT INTO .*"spend_ledger_entries"/s);
  assert.match(source, /INSERT INTO .*"mission_decisions"/s);
  assert.doesNotMatch(source, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:missions|mission_targets|mission_intent_revisions|user_spend_policies|retailer_adapter_qualifications|inbox_messages|strategies)"/);
  assert.doesNotMatch(source, /DELETE\s+FROM|TRUNCATE\s+/i);

  // Contract v2: strategy branch, strategy revalidation, and the fail-closed
  // failover rule are present in the generated PL/pgSQL.
  assert.match(source, /decision_source_value = 'strategy' THEN/);
  assert.match(source, /FROM .*"strategies".*AS strategy/s);
  assert.match(source, /strategy is not currently enabled at the attested revision/);
  assert.match(source, /strategy decision requires a bound strategy identity/);
  // The failover rule: the ONLY assignment of 'notify' to
  // effective_action_value is inside the strategy branch, and it is
  // unconditional (no IF guards it) — this is the fail-closed enforcement
  // that a strategy decision can never reach add_to_cart.
  assert.match(source, /effective_action_value := 'notify';/);
  const notifyAssignments = source.match(/effective_action_value := 'notify';/g) ?? [];
  assert.equal(notifyAssignments.length, 2); // fresh strategy branch + strategy replay branch
  assert.match(source, /effective_action_value := 'add_to_cart';/);
  const addToCartAssignments = source.match(/effective_action_value := 'add_to_cart';/g) ?? [];
  assert.equal(addToCartAssignments.length, 2); // fresh purchase-intent branch + purchase-intent replay branch
  // Strategy-sourced jobs never create a spend reservation, ledger entry, or
  // reservation link — those inserts remain purchase-intent-gated.
  assert.match(
    source,
    /spend_reservation_action_value := 'none';[\s\S]{0,40}spend_ledger_action_value := 'none';/
  );
  assert.match(source, /IF decision_source_value = 'purchase_intent' THEN\s+INSERT INTO .*"spend_reservations"/);
  assert.match(source, /decision source is unsupported/);

  const capability = postgresSignalActionSpendCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.actionSpendRepositoryParity, true);
  assert.equal(capability.sharedWriterLockProtocolImplemented, true);
  assert.equal(capability.writerLockProtocolConsumed, true);
  assert.equal(capability.constraintConfigBoundaryQualified, true);
  assert.equal(capability.settingsPauseWriterParity, true);
  assert.equal(capability.guardrailSettingsWriterParity, true);
  assert.equal(capability.spendPolicyWriterParity, true);
  assert.equal(capability.settingsWriterParity, false);
  assert.equal(capability.configurationWriterParity, false);
  assert.equal(capability.reservationWriterParity, false);
  assert.equal(capability.purchaseIntentOnly, false);
  assert.equal(capability.strategyActionAuthority, false);
  assert.equal(capability.strategySemanticsContractVersion, 2);
  assert.equal(capability.strategyDecisionSourceAccepted, true);
  assert.equal(capability.strategyExistenceRevalidation, true);
  assert.equal(capability.strategyFailoverToNotifyEnforced, true);
  assert.equal(capability.strategyCartActionAuthority, false);
  assert.equal(capability.strategyReservationAuthority, false);
  assert.equal(capability.trustedStrategyActionSemanticsQualified, true);
  assert.equal(capability.quantityOneOnly, false);
  assert.equal(capability.addToCartOnly, false);
  assert.equal(capability.protectedTenantTableCount, 20);
  assert.equal(capability.forcedRlsTableCount, 20);
  assert.equal(capability.actionMutation, true);
  assert.equal(capability.spendMutation, true);
  assert.equal(capability.retailerMutation, false);
  assert.equal(capability.checkoutMutation, false);
  assert.equal(capability.orderSubmissionMutation, false);
  assert.equal(capability.writerLockProtocolParity, false);
  assert.equal(capability.attributionPolicyParity, false);
  assert.equal(capability.actionAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalActionSpendApplyManifest(
      manifest.predecessorManifest,
      manifest.predecessorManifest.constraintConfigRoleNamespace
    ),
    /independent/
  );
});

test("the generated action/spend PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    const source = signalActionSpendApplyFunctionSource(
      buildPostgresSignalActionSpendApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_action_spend_parse_probe(
      expected_tenant_id text, expected_user_id text, operation_name text,
      target_message_id text, capability_token text,
      authorization_timestamp_input text, apply_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${source}
    $function$`);
  } finally {
    await database.close();
  }
});

test("the action/spend fingerprint seals every identity, bound, and mutation", () => {
  const plan: PostgresSignalActionSpendApplyPlan = {
    contractVersion: 1,
    messageId: "inbox_00000000000000000000000000000001",
    payloadHash: "1".repeat(64),
    authorizedAt: "2026-08-26T20:00:00.000Z",
    validUntil: "2026-08-26T20:00:30.000Z",
    eventId: "signal_event_00000000000000000000000000000001",
    signalId: "signal_test",
    listingId: "listing_test",
    variantId: "variant_test",
    retailerId: "target",
    retailerSku: "12345678",
    incidentId: "incident_00000000000000000000000000000001",
    missionId: "mission_test",
    missionTargetId: "mission_target_test",
    policyRevisionId: "intent_revision_test",
    policyRevision: 3,
    policyHash: "2".repeat(64),
    evaluationFingerprint: "3".repeat(64),
    decisionSource: "purchase_intent",
    strategyId: "",
    strategyRevision: 0,
    action: "add_to_cart",
    initialJobState: "awaiting_executor",
    quantity: 1,
    unitPriceCents: 799,
    effectiveUnitCapCents: 799,
    maximumAllInCents: 1_099,
    currency: "USD",
    sellerName: "Target",
    sellerType: "first_party",
    fulfillment: "shipping",
    offerFingerprint: "offer-test",
    expiresAt: "2026-08-26T20:02:00.000Z",
    exactOfferKeyId: "exact_offer_key_00000000000000000000000000000001",
    exactOfferIdentityHash: "4".repeat(64),
    offerSnapshotId: "offer_snapshot_00000000000000000000000000000001",
    offerEvidenceHash: "5".repeat(64),
    actionJobId: "action_job_00000000000000000000000000000001",
    actionIdempotencyKey: "6".repeat(64),
    actionEventId: "action_event_00000000000000000000000000000001",
    spendReservationId: "spend_reservation_00000000000000000000000000000001",
    spendIdempotencyKey: "7".repeat(64),
    spendLedgerEntryId: "spend_ledger_00000000000000000000000000000001",
    missionDecisionId: "mission_decision_00000000000000000000000000000001",
    auditId: "audit_00000000000000000000000000000001",
    outboxId: "outbox_00000000000000000000000000000001",
    exactOfferAction: "insert",
    offerSnapshotAction: "insert",
    actionJobAction: "insert",
    actionEventAction: "insert",
    spendReservationAction: "insert",
    spendLedgerAction: "insert",
    missionDecisionAction: "insert",
    auditAction: "insert",
    outboxAction: "insert",
    actionJobReservationLinkAction: "insert",
    mutationStatementCount: 10,
    mutationRowCount: 10,
    actionSpendApplyWillApply: true,
    immutableReplay: false,
    actionMutation: true,
    spendMutation: true,
    retailerMutation: false,
    checkoutMutation: false,
    orderSubmissionMutation: false,
    inboxLifecycleMutation: false,
    actionAuthority: true,
    planFingerprint: ""
  };
  const principal = { tenantId: "tenant_test", userId: "user_test" };
  const first = postgresSignalActionSpendPlanFingerprint(principal, plan);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, postgresSignalActionSpendPlanFingerprint(principal, plan));
  assert.notEqual(
    postgresSignalActionSpendPlanFingerprint(principal, {
      ...plan,
      maximumAllInCents: plan.maximumAllInCents + 1
    }),
    first
  );
  assert.notEqual(
    postgresSignalActionSpendPlanFingerprint(principal, {
      ...plan,
      immutableReplay: true,
      actionSpendApplyWillApply: false,
      mutationStatementCount: 0,
      mutationRowCount: 0
    }),
    first
  );
  assert.notEqual(
    postgresSignalActionSpendPlanFingerprint(principal, {
      ...plan,
      fulfillment: "pickup"
    }),
    first
  );
});

test("the action/spend fingerprint is deterministic for strategy-sourced payloads and distinct from purchase-intent", () => {
  const purchaseIntentPlan: PostgresSignalActionSpendApplyPlan = {
    contractVersion: 1,
    messageId: "inbox_00000000000000000000000000000002",
    payloadHash: "8".repeat(64),
    authorizedAt: "2026-08-26T20:00:00.000Z",
    validUntil: "2026-08-26T20:00:30.000Z",
    eventId: "signal_event_00000000000000000000000000000002",
    signalId: "signal_test_2",
    listingId: "listing_test_2",
    variantId: "variant_test_2",
    retailerId: "target",
    retailerSku: "87654321",
    incidentId: "incident_00000000000000000000000000000002",
    missionId: "mission_test_2",
    missionTargetId: "mission_target_test_2",
    policyRevisionId: "intent_revision_test_2",
    policyRevision: 1,
    policyHash: "9".repeat(64),
    evaluationFingerprint: "a".repeat(64),
    decisionSource: "purchase_intent",
    strategyId: "",
    strategyRevision: 0,
    action: "add_to_cart",
    initialJobState: "awaiting_executor",
    quantity: 1,
    unitPriceCents: 500,
    effectiveUnitCapCents: 500,
    maximumAllInCents: 650,
    currency: "USD",
    sellerName: "Target",
    sellerType: "first_party",
    fulfillment: "shipping",
    offerFingerprint: "offer-test-2",
    expiresAt: "2026-08-26T20:02:00.000Z",
    exactOfferKeyId: "exact_offer_key_00000000000000000000000000000002",
    exactOfferIdentityHash: "b".repeat(64),
    offerSnapshotId: "offer_snapshot_00000000000000000000000000000002",
    offerEvidenceHash: "c".repeat(64),
    actionJobId: "action_job_00000000000000000000000000000002",
    actionIdempotencyKey: "d".repeat(64),
    actionEventId: "action_event_00000000000000000000000000000002",
    spendReservationId: "spend_reservation_00000000000000000000000000000002",
    spendIdempotencyKey: "e".repeat(64),
    spendLedgerEntryId: "spend_ledger_00000000000000000000000000000002",
    missionDecisionId: "mission_decision_00000000000000000000000000000002",
    auditId: "audit_00000000000000000000000000000002",
    outboxId: "outbox_00000000000000000000000000000002",
    exactOfferAction: "insert",
    offerSnapshotAction: "insert",
    actionJobAction: "insert",
    actionEventAction: "insert",
    spendReservationAction: "insert",
    spendLedgerAction: "insert",
    missionDecisionAction: "insert",
    auditAction: "insert",
    outboxAction: "insert",
    actionJobReservationLinkAction: "insert",
    mutationStatementCount: 10,
    mutationRowCount: 10,
    actionSpendApplyWillApply: true,
    immutableReplay: false,
    actionMutation: true,
    spendMutation: true,
    retailerMutation: false,
    checkoutMutation: false,
    orderSubmissionMutation: false,
    inboxLifecycleMutation: false,
    actionAuthority: true,
    planFingerprint: ""
  };
  // Same identifying fields as purchaseIntentPlan, but decisionSource is
  // "strategy": a bound strategy identity, a multi-unit quantity (the "live
  // legacy multi-unit strategy adds ... fail over to notification" case),
  // a notify-only action, and no reservation/ledger/link mutation.
  const strategyPlan: PostgresSignalActionSpendApplyPlan = {
    ...purchaseIntentPlan,
    decisionSource: "strategy",
    strategyId: "strategy_test",
    strategyRevision: 1,
    action: "notify",
    initialJobState: "notify_only",
    quantity: 3,
    maximumAllInCents: 1500,
    spendReservationAction: "none",
    spendLedgerAction: "none",
    actionJobReservationLinkAction: "none",
    mutationStatementCount: 7,
    mutationRowCount: 7
  };
  const principal = { tenantId: "tenant_test", userId: "user_test" };
  const purchaseIntentFingerprint = postgresSignalActionSpendPlanFingerprint(
    principal,
    purchaseIntentPlan
  );
  const strategyFingerprint = postgresSignalActionSpendPlanFingerprint(principal, strategyPlan);
  assert.match(strategyFingerprint, /^[a-f0-9]{64}$/);
  // Deterministic: recomputing from the same strategy-sourced payload
  // reproduces the exact same request ID.
  assert.equal(strategyFingerprint, postgresSignalActionSpendPlanFingerprint(principal, strategyPlan));
  // Distinct: a strategy-sourced request never collides with the
  // otherwise-identical purchase-intent request it was derived from.
  assert.notEqual(strategyFingerprint, purchaseIntentFingerprint);
  // Distinct: a different strategy identity changes the request ID.
  assert.notEqual(
    postgresSignalActionSpendPlanFingerprint(principal, { ...strategyPlan, strategyId: "strategy_other" }),
    strategyFingerprint
  );
  // Distinct: a different strategy revision changes the request ID.
  assert.notEqual(
    postgresSignalActionSpendPlanFingerprint(principal, { ...strategyPlan, strategyRevision: 2 }),
    strategyFingerprint
  );
  // Distinct: a different quantity (multi-unit strategy match) changes the
  // request ID even though the resulting action is notify either way.
  assert.notEqual(
    postgresSignalActionSpendPlanFingerprint(principal, { ...strategyPlan, quantity: 4 }),
    strategyFingerprint
  );
});

test("PostgreSQL spending periods apply corrected charges and refunds to the original charge date", async () => {
  const db = new PGlite();
  try { await verifyCheckoutAccounting((sql, params) => db.query(sql, params)); }
  finally { await db.close(); }
});
