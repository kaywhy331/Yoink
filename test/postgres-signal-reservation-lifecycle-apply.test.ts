import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_FUNCTION,
  buildPostgresSignalReservationLifecycleApplyManifest,
  buildPostgresSignalReservationLifecycleRequestId,
  postgresSignalReservationLifecycleCapabilityProjection,
  signalReservationLifecycleApplyFunctionSource,
  type PostgresSignalReservationCommitPayload,
  type PostgresSignalReservationReleasePayload
} from "../packages/database/src/postgres-signal-reservation-lifecycle-apply.js";

const principal = { tenantId: "tenant_test", userId: "user_test" };
const release: PostgresSignalReservationReleasePayload = {
  actionJobId: "action_job_fixture_123",
  reservationId: "spend_reservation_fixture_123",
  releaseReason: "add_to_cart_confirmed_without_order",
  confirmation: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION
};
const commit: PostgresSignalReservationCommitPayload = {
  actionJobId: "action_job_submit_fixture_123",
  reservationId: "spend_reservation_submit_fixture_123",
  actualAmountCents: 12_345,
  confirmation: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION
};

test("the reservation-lifecycle writer is deterministic, bounded, complete, and inactive", () => {
  const manifest = buildPostgresSignalReservationLifecycleApplyManifest();
  assert.deepEqual(buildPostgresSignalReservationLifecycleApplyManifest(), manifest);
  assert.equal(
    manifest.contractVersion,
    POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONTRACT_VERSION
  );
  assert.equal(manifest.sourceSyncApplyContractVersion, 1);
  assert.equal(manifest.writerLockProtocolContractVersion, 1);
  assert.equal(
    manifest.reservationLifecycleRole.kind,
    "signal_reservation_lifecycle_apply_boundary"
  );
  assert.equal(
    manifest.reservationLifecycleRole.functionName,
    POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_FUNCTION
  );
  assert.equal(manifest.reservationLifecycleRole.login, false);
  assert.equal(manifest.reservationLifecycleRole.inherit, false);
  assert.equal(manifest.reservationLifecycleRole.bypassRls, false);
  assert.equal(manifest.reservationLifecycleRole.directTableAccess, false);
  assert.deepEqual(manifest.reservationLifecycleRole.protectedTenantTableNames, [
    "action_events",
    "action_jobs",
    "audit_events",
    "outbox_events",
    "spend_ledger_entries",
    "spend_reservations"
  ]);
  assert.deepEqual(manifest.reservationLifecycleRole.mutationTableNames, [
    "audit_events",
    "outbox_events",
    "spend_ledger_entries",
    "spend_reservations"
  ]);
  assert.equal(manifest.operationCount, 2);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.spendScopeConsumed, true);
  assert.equal(manifest.deterministicRequestIdentity, true);
  assert.equal(manifest.immutableLifecycleReplay, true);
  assert.equal(manifest.lifecycleAwareOutboxReplay, true);
  assert.equal(manifest.currentActionReservationGraphRevalidation, true);
  assert.equal(manifest.terminalReleaseStateRevalidation, true);
  assert.equal(manifest.serverClockExpiryRelease, true);
  assert.equal(manifest.possibleMutationExpiryReleaseBlocked, true);
  assert.equal(manifest.verifiedSubmitOrderCommit, true);
  assert.equal(manifest.unambiguousVerifiedTotal, true);
  assert.equal(manifest.reservationCreationPredecessorParity, true);
  assert.equal(manifest.reservationReleaseParity, true);
  assert.equal(manifest.reservationCommitParity, true);
  assert.equal(manifest.appendOnlyLedgerParity, true);
  assert.equal(manifest.atomicReservationLedgerAuditOutbox, true);
  assert.equal(manifest.databaseOwnedTimestamps, true);
  assert.equal(manifest.missionFulfillmentMutation, false);
  assert.equal(manifest.checkoutMutation, false);
  assert.equal(manifest.orderSubmissionMutation, false);
  assert.equal(manifest.sourceSyncWriterParity, true);
  assert.equal(manifest.sourceWriterParity, false);
  assert.equal(manifest.reservationWriterParity, true);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalReservationLifecycleApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_lock_signal_action_constraints/);
  assert.match(source, /'', '', '', '00001'/);
  assert.match(source, /APPLY_SPEND_RESERVATION_LIFECYCLE_V1/);
  assert.match(source, /release_spend_reservation/);
  assert.match(source, /commit_spend_reservation/);
  assert.match(source, /add_to_cart_confirmed_without_order/);
  assert.match(source, /reservation_expired/);
  assert.match(source, /'submitting', 'confirmed', 'manual_review', 'submission_uncertain'/);
  assert.match(source, /jsonb_build_array\(\s*'source', 'retailer_qualification', 'settings', 'mission_policy', 'spend'/);
  assert.match(source, /verified action evidence/);
  assert.match(source, /reserved_delta_cents AS ledger_reserved_delta_cents/);
  assert.match(source, /quantity_delta AS ledger_quantity_delta/);
  assert.match(source, /INSERT INTO .*"spend_ledger_entries"/s);
  assert.match(source, /UPDATE .*"spend_reservations"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:action_jobs|action_events|missions|mission_intent_revisions|offer_snapshots|exact_offer_keys|inbox_messages|retailers|listings|app_settings|user_spend_policies|source_connections|retailer_adapter_qualifications)"/
  );

  const releaseId = buildPostgresSignalReservationLifecycleRequestId(
    principal,
    "release_spend_reservation",
    release
  );
  assert.match(releaseId, /^reservation_lifecycle_[a-f0-9]{32}$/);
  assert.equal(
    buildPostgresSignalReservationLifecycleRequestId(
      principal,
      "release_spend_reservation",
      release
    ),
    releaseId
  );
  assert.notEqual(
    buildPostgresSignalReservationLifecycleRequestId(
      principal,
      "release_spend_reservation",
      { ...release, releaseReason: "cancelled" }
    ),
    releaseId
  );
  assert.notEqual(
    buildPostgresSignalReservationLifecycleRequestId(
      { ...principal, userId: "user_other" },
      "release_spend_reservation",
      release
    ),
    releaseId
  );
  const commitId = buildPostgresSignalReservationLifecycleRequestId(
    principal,
    "commit_spend_reservation",
    commit
  );
  assert.notEqual(commitId, releaseId);
  assert.notEqual(
    buildPostgresSignalReservationLifecycleRequestId(
      principal,
      "commit_spend_reservation",
      { ...commit, actualAmountCents: commit.actualAmountCents + 1 }
    ),
    commitId
  );

  const capability = postgresSignalReservationLifecycleCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, true);
  assert.equal(capability.spendScopeConsumed, true);
  assert.equal(capability.reservationCreationPredecessorParity, true);
  assert.equal(capability.reservationReleaseParity, true);
  assert.equal(capability.reservationCommitParity, true);
  assert.equal(capability.possibleMutationExpiryReleaseBlocked, true);
  assert.equal(capability.reservationWriterParity, true);
  assert.equal(capability.writerLockProtocolParity, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.spendMutationAuthority, true);
  assert.equal(capability.actionAuthority, false);
  assert.equal(capability.checkoutAuthority, false);
  assert.equal(capability.orderSubmissionAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalReservationLifecycleApplyManifest(
      manifest.predecessorManifest as never,
      manifest.predecessorManifest.sourceSyncRoleNamespace
    ),
    /independent/
  );
});

test("the generated reservation-lifecycle PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    const source = signalReservationLifecycleApplyFunctionSource(
      buildPostgresSignalReservationLifecycleApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_reservation_lifecycle_parse_probe(
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
