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
  assert.equal(manifest.actionSpendRole.kind, "signal_action_spend_apply_boundary");
  assert.equal(manifest.actionSpendRole.functionName, POSTGRES_SIGNAL_ACTION_SPEND_APPLY_FUNCTION);
  assert.equal(manifest.actionSpendRole.login, false);
  assert.equal(manifest.actionSpendRole.inherit, false);
  assert.equal(manifest.actionSpendRole.bypassRls, false);
  assert.equal(manifest.actionSpendRole.directTableAccess, false);
  assert.equal(manifest.protectedTenantTableCount, 19);
  assert.equal(manifest.forcedRlsTableCount, 19);
  assert.equal(manifest.mutationTableCount, 9);
  assert.deepEqual(manifest.actionSpendRole.mutationTableNames, [
    "action_events", "action_jobs", "audit_events", "exact_offer_keys",
    "mission_decisions", "offer_snapshots", "outbox_events",
    "spend_ledger_entries", "spend_reservations"
  ]);
  assert.equal(manifest.fixedOrderConfigurationLocks, true);
  assert.equal(manifest.sharedWriterLockProtocolImplemented, true);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.currentMissionTargetRevalidation, true);
  assert.equal(manifest.currentSpendPolicyRevalidation, true);
  assert.equal(manifest.remainingQuantityRevalidation, true);
  assert.equal(manifest.siblingClaimRevalidation, true);
  assert.equal(manifest.cooldownRevalidation, true);
  assert.equal(manifest.periodicSpendRevalidation, true);
  assert.equal(manifest.purchaseIntentOnly, true);
  assert.equal(manifest.strategyActionAuthority, false);
  assert.equal(manifest.firstPartyShippingOnly, true);
  assert.equal(manifest.quantityOneOnly, true);
  assert.equal(manifest.addToCartOnly, true);
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
  assert.match(
    source,
    /octet_length\(\(attestation->>'missionId'\)\).*\|\| \(attestation->>'missionId'\) \|\| '\|'/
  );
  assert.doesNotMatch(source, /\|\| attestation->>/);
  assert.match(source, /INSERT INTO .*"action_jobs"/s);
  assert.match(source, /INSERT INTO .*"spend_reservations"/s);
  assert.match(source, /INSERT INTO .*"spend_ledger_entries"/s);
  assert.match(source, /INSERT INTO .*"mission_decisions"/s);
  assert.doesNotMatch(source, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:missions|mission_targets|mission_intent_revisions|user_spend_policies|retailer_adapter_qualifications|inbox_messages)"/);
  assert.doesNotMatch(source, /DELETE\s+FROM|TRUNCATE\s+/i);

  const capability = postgresSignalActionSpendCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.actionSpendRepositoryParity, true);
  assert.equal(capability.sharedWriterLockProtocolImplemented, true);
  assert.equal(capability.writerLockProtocolConsumed, true);
  assert.equal(capability.purchaseIntentOnly, true);
  assert.equal(capability.strategyActionAuthority, false);
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
      manifest.predecessorManifest.writerLockRoleNamespace
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
});
