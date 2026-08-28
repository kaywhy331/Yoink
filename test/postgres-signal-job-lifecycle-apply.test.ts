import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_FUNCTION,
  POSTGRES_SIGNAL_JOB_LIFECYCLE_MUTATION_RISK_STATES,
  POSTGRES_SIGNAL_JOB_LIFECYCLE_TRANSITIONS,
  PostgresSignalJobLifecycleApplyQualificationError,
  buildPostgresSignalJobLifecycleApplyManifest,
  buildPostgresSignalJobLifecycleTransitionRequestId,
  normalizedPostgresSignalJobLifecycleTransitionPayload,
  postgresSignalJobLifecycleCapabilityProjection,
  signalJobLifecycleApplyFunctionSource,
  type PostgresSignalJobLifecycleTransitionPayload
} from "../packages/database/src/postgres-signal-job-lifecycle-apply.js";

const principal = { tenantId: "tenant_test", userId: "user_test" };

function payload(overrides: Partial<{
  jobId: string;
  expectedCurrentState: string;
  nextState: string;
  reasonCode: string;
  message: string;
  evidence: Record<string, unknown>;
  manualResolution: boolean;
}> = {}): PostgresSignalJobLifecycleTransitionPayload {
  return normalizedPostgresSignalJobLifecycleTransitionPayload({
    jobId: "action_job_fixture_123",
    expectedCurrentState: "awaiting_executor",
    nextState: "leased",
    reasonCode: "device_lease",
    message: "A qualified paired Chrome device leased the action job.",
    evidence: { deviceId: "device_fixture_123" },
    manualResolution: false,
    ...overrides
  } as never);
}

test("the job-lifecycle writer is deterministic, bounded, complete, and inactive", () => {
  const manifest = buildPostgresSignalJobLifecycleApplyManifest();
  assert.deepEqual(buildPostgresSignalJobLifecycleApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.attributionPolicyApplyContractVersion, 1);
  assert.equal(manifest.jobLifecycleRole.kind, "signal_job_lifecycle_apply_boundary");
  assert.equal(manifest.jobLifecycleRole.functionName, POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_FUNCTION);
  assert.equal(manifest.jobLifecycleRole.login, false);
  assert.equal(manifest.jobLifecycleRole.inherit, false);
  assert.equal(manifest.jobLifecycleRole.bypassRls, false);
  assert.equal(manifest.jobLifecycleRole.directTableAccess, false);
  assert.deepEqual(manifest.jobLifecycleRole.protectedTenantTableNames, [
    "action_events",
    "action_jobs",
    "audit_events",
    "missions",
    "outbox_events",
    "signal_events",
    "signal_incidents",
    "signal_occurrences"
  ]);
  assert.deepEqual(manifest.jobLifecycleRole.mutationTableNames, [
    "action_events",
    "action_jobs",
    "audit_events",
    "missions",
    "outbox_events",
    "signal_incidents"
  ]);
  assert.equal(manifest.operationCount, 1);
  assert.equal(manifest.jobStateCount, 19);
  assert.equal(manifest.legalTransitionCount, 47);
  assert.equal(manifest.mutationRiskStateCount, 8);
  assert.equal(manifest.protectedTenantTableCount, 8);
  assert.equal(manifest.mutationTableCount, 6);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.spendScopeConsumed, true);
  assert.equal(manifest.currentJobOwnershipRevalidation, true);
  assert.equal(manifest.expectedCurrentStateRevalidation, true);
  assert.equal(manifest.legalTransitionTableEnforced, true);
  assert.equal(manifest.possibleMutationCancelGuardEnforced, true);
  assert.equal(manifest.crossTenantIncidentGuardEnforced, true);
  assert.equal(manifest.missionFulfillmentMutation, true);
  assert.equal(manifest.checkoutMutation, false);
  assert.equal(manifest.orderSubmissionMutation, false);
  assert.equal(manifest.spendReservationMutationDeferred, true);
  assert.equal(manifest.deviceCapabilityRevalidation, false);
  assert.equal(manifest.reservationWriterParity, true);
  assert.equal(manifest.attributionPolicyParity, true);
  assert.equal(manifest.jobLifecycleWriterParity, true);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  assert.throws(
    () => buildPostgresSignalJobLifecycleApplyManifest(
      manifest.predecessorManifest as never,
      manifest.predecessorManifest.attributionPolicyRoleNamespace
    ),
    /independent/
  );
});

test("the SQLite job-state transition table was reused, not hand-transcribed", () => {
  // Spot-check a representative sample of the 47 real edges reproduced
  // from packages/domain/src/job-state.ts's own canTransitionJob.
  assert.deepEqual(
    POSTGRES_SIGNAL_JOB_LIFECYCLE_TRANSITIONS.shadow_ready,
    ["awaiting_executor", "expired", "cancelled"]
  );
  assert.deepEqual(
    POSTGRES_SIGNAL_JOB_LIFECYCLE_TRANSITIONS.manual_review,
    ["confirmed", "cancelled", "submission_uncertain"]
  );
  assert.deepEqual(POSTGRES_SIGNAL_JOB_LIFECYCLE_TRANSITIONS.notify_only, []);
  assert.deepEqual(POSTGRES_SIGNAL_JOB_LIFECYCLE_TRANSITIONS.confirmed, []);
  const totalEdges = Object.values(POSTGRES_SIGNAL_JOB_LIFECYCLE_TRANSITIONS)
    .reduce((sum, edges) => sum + edges.length, 0);
  assert.equal(totalEdges, 47);
  assert.deepEqual(
    [...POSTGRES_SIGNAL_JOB_LIFECYCLE_MUTATION_RISK_STATES],
    ["adding", "cart_verified", "checkout_review", "submit_authorized", "submitting", "confirmed", "manual_review", "submission_uncertain"]
  );
});

test("normalizedPostgresSignalJobLifecycleTransitionPayload reuses the real SQLite validation and redaction", () => {
  const normalized = payload({
    evidence: { deviceId: "device_fixture_123", authorization: "Bearer super-secret-token-value-000000" }
  });
  // sanitizeDiagnosticData (packages/domain/src/redaction.ts) reused
  // byte-for-byte: the sensitive key is redacted exactly as SQLite would.
  assert.equal(normalized.evidence.authorization, "[REDACTED]");
  assert.equal(normalized.evidence.deviceId, "device_fixture_123");
  assert.equal(normalized.confirmation, POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONFIRMATION);

  // transitionJob's own literal reasonCode/message normalization, reused.
  const messy = payload({
    reasonCode: "x".repeat(200),
    message: "  too   much    whitespace   here  ".padEnd(600, " extra")
  });
  assert.equal(messy.reasonCode.length, 80);
  assert.ok(!/\s{2,}/.test(messy.message));
  assert.equal(messy.message, messy.message.trim());
  assert.ok(messy.message.length <= 500);

  assert.throws(
    () => payload({ expectedCurrentState: "confirmed", nextState: "leased" }),
    PostgresSignalJobLifecycleApplyQualificationError
  );
  assert.throws(
    () => payload({ expectedCurrentState: "manual_review", nextState: "cancelled", manualResolution: false }),
    /manual review/
  );
  const cancelledWithReview = payload({
    expectedCurrentState: "manual_review", nextState: "cancelled", manualResolution: true
  });
  assert.equal(cancelledWithReview.manualResolution, true);
  assert.throws(
    () => normalizedPostgresSignalJobLifecycleTransitionPayload({
      jobId: "action_job_fixture_123",
      expectedCurrentState: "awaiting_executor",
      nextState: "leased",
      reasonCode: "device_lease",
      message: "ok",
      evidence: ["not", "an", "object"] as never,
      manualResolution: false
    }),
    /plain object/
  );
});

test("buildPostgresSignalJobLifecycleTransitionRequestId is deterministic and payload-sensitive", () => {
  const base = payload();
  const id = buildPostgresSignalJobLifecycleTransitionRequestId(principal, base);
  assert.match(id, /^job_lifecycle_transition_[a-f0-9]{32}$/);
  assert.equal(buildPostgresSignalJobLifecycleTransitionRequestId(principal, base), id);
  assert.notEqual(
    buildPostgresSignalJobLifecycleTransitionRequestId(principal, payload({ reasonCode: "different_reason" })),
    id
  );
  assert.notEqual(
    buildPostgresSignalJobLifecycleTransitionRequestId(principal, payload({ evidence: { deviceId: "other" } })),
    id
  );
  assert.notEqual(
    buildPostgresSignalJobLifecycleTransitionRequestId(principal, payload({
      expectedCurrentState: "manual_review", nextState: "cancelled", manualResolution: true
    })),
    id
  );
  assert.notEqual(
    buildPostgresSignalJobLifecycleTransitionRequestId({ ...principal, userId: "user_other" }, base),
    id
  );
});

test("the generated job-lifecycle PL/pgSQL is bounded to its exact residual, mirrors the SQLite branches, and consumes the shared lock", () => {
  const manifest = buildPostgresSignalJobLifecycleApplyManifest();
  const source = signalJobLifecycleApplyFunctionSource(manifest);

  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_lock_signal_action_constraints/);
  assert.match(source, /'', '', '', '00001'/);
  assert.match(source, new RegExp(POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONFIRMATION));
  assert.match(source, /transition_job/);

  // The 47-edge legal-transition table, spot-checked in generated SQL form.
  assert.match(source, /current_state_value = 'shadow_ready' AND next_state_value IN \('awaiting_executor', 'expired', 'cancelled'\)/);
  assert.match(source, /current_state_value = 'manual_review' AND next_state_value IN \('confirmed', 'cancelled', 'submission_uncertain'\)/);
  assert.doesNotMatch(source, /current_state_value = 'confirmed' AND next_state_value/);
  assert.doesNotMatch(source, /current_state_value = 'notify_only' AND next_state_value/);

  // The possible-mutation cancellation guard and the cross-tenant incident guard.
  assert.match(source, /'adding', 'cart_verified', 'checkout_review', 'submit_authorized', 'submitting', 'confirmed', 'manual_review', 'submission_uncertain'/);
  assert.match(source, /requires manual resolution/);
  assert.match(source, /NOT EXISTS/);
  assert.match(source, /other_job\.tenant_id <> resolved_tenant_id OR other_job\.user_id <> resolved_user_id/);

  // The three SQLite branch groups, reproduced.
  assert.match(source, /'offer_rejected', 'expired', 'cancelled'.*THEN 'close_terminal'/s);
  assert.match(source, /'submission_uncertain', 'manual_review'.*THEN 'lock_review'/s);
  assert.match(source, /next_state_value = 'confirmed' THEN 'close_confirmed'/);
  assert.match(source, /graph_record\.job_action = 'submit_order'/);
  assert.match(source, /LEAST\(\s*mission\.target_quantity, mission\.fulfilled_quantity \+ graph_record\.job_quantity/);
  assert.match(source, /'satisfied'/);

  assert.match(source, /INSERT INTO .*"action_events"/s);
  assert.match(source, /UPDATE .*"action_jobs"/s);
  assert.match(source, /UPDATE .*"signal_incidents"/s);
  assert.match(source, /UPDATE .*"missions"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);

  // The one bright line this residual must never cross: reservation-lifecycle-
  // apply.ts (and every other already-qualified boundary) owns these tables,
  // never this writer.
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:spend_reservations|spend_ledger_entries|exact_offer_keys|offer_snapshots|mission_intent_revisions|retailers|app_settings|user_spend_policies|source_connections|retailer_adapter_qualifications|attribution_policies|attribution_receipts)"/
  );
});

test("the job-lifecycle capability projection is honest and inactive", () => {
  const capability = postgresSignalJobLifecycleCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, true);
  assert.equal(capability.spendScopeConsumed, true);
  assert.equal(capability.legalTransitionTableEnforced, true);
  assert.equal(capability.possibleMutationCancelGuardEnforced, true);
  assert.equal(capability.crossTenantIncidentGuardEnforced, true);
  assert.equal(capability.missionFulfillmentMutation, true);
  assert.equal(capability.checkoutMutation, false);
  assert.equal(capability.orderSubmissionMutation, false);
  assert.equal(capability.spendReservationMutationDeferred, true);
  assert.equal(capability.deviceCapabilityRevalidation, false);
  assert.equal(capability.jobLifecycleWriterParity, true);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.jobLifecycleMutationAuthority, true);
  assert.equal(capability.actionAuthority, false);
  assert.equal(capability.checkoutAuthority, false);
  assert.equal(capability.orderSubmissionAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.equal(capability.legalTransitionCount, 47);
  assert.equal(capability.mutationRiskStateCount, 8);
});

test("the generated job-lifecycle PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    const source = signalJobLifecycleApplyFunctionSource(
      buildPostgresSignalJobLifecycleApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_job_lifecycle_parse_probe(
      expected_tenant_id text, expected_user_id text, operation_name text,
      request_id text, request_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    SET search_path TO pg_catalog
    AS $function$
    ${source}
    $function$`);
  } finally {
    await database.close();
  }
});
