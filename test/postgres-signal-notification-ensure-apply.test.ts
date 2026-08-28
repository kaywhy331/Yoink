import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import {
  POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONTRACT_VERSION,
  buildPostgresSignalDeadLetterResetApplyManifest
} from "../packages/database/src/postgres-signal-dead-letter-reset-apply.js";
import {
  POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_FUNCTION,
  POSTGRES_SIGNAL_NOTIFICATION_ENSURE_DELIVERY_STATE,
  POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_ACTION,
  POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_STATE,
  PostgresSignalNotificationEnsureApplyQualificationError,
  buildPostgresSignalNotificationEnsureApplyManifest,
  buildPostgresSignalNotificationEnsureRequestId,
  normalizedPostgresSignalNotificationEnsurePayload,
  postgresSignalNotificationEnsureCapabilityProjection,
  signalNotificationEnsureApplyFunctionSource
} from "../packages/database/src/postgres-signal-notification-ensure-apply.js";
import { NotificationRepository } from "../packages/database/src/notification-repository.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope } from "../packages/database/src/request-scope.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";

const NOW = new Date("2026-08-28T09:00:00.000Z").getTime();
const principal = { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID };

/**
 * Drives a real `SignalRepository.createActionJob`/SQLite fixture (via
 * `SignalEngine.process`, exactly the way `test/notification-repository.
 * test.ts`'s own `notificationFixture` does) through to a fresh,
 * `notify_only` action job and its one `ensureForJob`-created
 * `notification_deliveries` row.
 */
function notifyJobFixture(db: YoinkDatabase): { jobId: string } {
  new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "notify-ensure-product-1",
    sourceListingId: "notify-ensure-listing-1",
    title: "Notification Ensure Fixture",
    retailerId: "target",
    retailerSku: "95280895",
    canonicalUrl: "https://www.target.com/p/-/A-95280895",
    listingStatus: "out_of_stock",
    executionSupported: true,
    msrpCents: 4499,
    observedAt: new Date(NOW - 10_000).toISOString()
  }, NOW);
  const result = new SignalEngine(db).process({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId: "notify-ensure-event-1",
    eventType: "restock",
    observedAt: new Date(NOW - 1_000).toISOString(),
    identity: {
      sourceProductId: "notify-ensure-product-1",
      sourceListingId: "notify-ensure-listing-1",
      retailerId: "target",
      retailerSku: "95280895",
      title: "Notification Ensure Fixture"
    },
    offer: {
      availability: "in_stock",
      unitPriceCents: 4499,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      fulfillment: "shipping"
    }
  }, NOW);
  assert.equal(result.actionJobState, "notify_only");
  assert.notEqual(result.actionJobId, "");
  return { jobId: result.actionJobId };
}

test("the notification-ensure writer is deterministic, job-scoped, insert-or-ignore-idempotent, and inactive", () => {
  const manifest = buildPostgresSignalNotificationEnsureApplyManifest();
  assert.deepEqual(buildPostgresSignalNotificationEnsureApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.deadLetterResetApplyContractVersion, POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.notificationEnsureRole.kind, "signal_notification_ensure_apply_boundary");
  assert.equal(manifest.notificationEnsureRole.functionName, POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_FUNCTION);
  assert.equal(manifest.notificationEnsureRole.login, false);
  assert.equal(manifest.notificationEnsureRole.inherit, false);
  assert.equal(manifest.notificationEnsureRole.bypassRls, false);
  assert.equal(manifest.notificationEnsureRole.directTableAccess, false);
  // action_jobs is read (and row-locked) but never mutated -- present in
  // the protected set, absent from the mutation set.
  assert.deepEqual(manifest.notificationEnsureRole.protectedTenantTableNames, [
    "action_jobs", "notification_deliveries"
  ]);
  assert.deepEqual(manifest.notificationEnsureRole.mutationTableNames, ["notification_deliveries"]);
  assert.equal(manifest.operationCount, 1);
  assert.equal(manifest.requiredJobAction, POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_ACTION);
  assert.equal(manifest.requiredJobState, POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_STATE);
  assert.equal(manifest.hardcodedDeliveryState, POSTGRES_SIGNAL_NOTIFICATION_ENSURE_DELIVERY_STATE);
  assert.equal(manifest.requiredJobAction, "notify");
  assert.equal(manifest.requiredJobState, "notify_only");
  assert.equal(manifest.hardcodedDeliveryState, "pending");
  assert.equal(manifest.protectedTenantTableCount, 2);
  assert.equal(manifest.forcedRlsTableCount, 2);
  assert.equal(manifest.mutationTableCount, 1);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);

  // Chains onto dead-letter-reset-apply, per explicit instruction -- not
  // attribution-receipt-apply, its closest structural sibling, and not
  // catalog-import-apply, a concurrently-authored sibling with no ordering
  // relationship to this module. The FULL predecessor manifest is embedded,
  // never a field-literal `Pick`.
  const deadLetterManifest = buildPostgresSignalDeadLetterResetApplyManifest();
  assert.equal(manifest.deadLetterResetApplyManifestFingerprint, deadLetterManifest.fingerprint);
  assert.deepEqual(manifest.predecessorManifest, deadLetterManifest);
  assert.equal(manifest.predecessorManifest.fingerprint, deadLetterManifest.fingerprint);
  assert.equal(manifest.predecessorManifest.schemaName, deadLetterManifest.schemaName);
  assert.equal(
    manifest.predecessorManifest.deadLetterResetRoleNamespace,
    deadLetterManifest.deadLetterResetRoleNamespace
  );
  assert.notEqual(manifest.notificationEnsureRoleNamespace, deadLetterManifest.deadLetterResetRoleNamespace);

  assert.equal(manifest.serverBoundPrincipalLookup, true);
  assert.equal(manifest.jobOwnershipRevalidated, true);
  assert.equal(manifest.notifyActionPreconditionEnforced, true);
  assert.equal(manifest.notifyOnlyStatePreconditionEnforced, true);
  // notification_deliveries is not one of the five domains the shared
  // writer-lock protocol guards (source, retailer_qualification, settings,
  // mission_policy, spend) -- same posture as postgres-notification-
  // recovery.ts for the identical table. Per-job serialization instead
  // comes from `FOR UPDATE OF job` plus UNIQUE(job_id) + ON CONFLICT DO
  // NOTHING (asserted in the source below).
  assert.equal(manifest.writerLockProtocolConsumed, false);
  assert.equal(manifest.deterministicRequestIdentity, true);
  // The insertOrIgnoreReplayParity design attribution-receipt-apply
  // established: an existing delivery for a job is an unconditional
  // zero-write success, exactly like SQLite's INSERT OR IGNORE.
  assert.equal(manifest.insertOrIgnoreReplayParity, true);
  // Unlike attribution_receipts (immutable once written), notification_
  // deliveries is a live, mutable table -- the replay path echoes the
  // row's CURRENT state, not a frozen creation-time snapshot.
  assert.equal(manifest.mutableDeliveryStateReplayEcho, true);
  // The one write in this whole qualified family with a genuinely zero
  // audit trail, on every path -- the real SQLite truth.
  assert.equal(manifest.noAuditOrOutboxWrite, true);
  assert.equal(manifest.databaseOwnedTimestamps, true);
  assert.equal(manifest.deterministicDeliveryIdentity, true);

  // World-state carried forward unchanged from dead-letter-reset-apply.
  assert.equal(manifest.sqliteValidationParity, true);
  assert.equal(manifest.sourceTrustWriterParity, true);
  assert.equal(manifest.sourceStatusWriterParity, true);
  assert.equal(manifest.sourceSyncWriterParity, true);
  assert.equal(manifest.catalogImportWriterParity, true);
  assert.equal(manifest.connectionProvisioningWriterParity, true);
  assert.equal(manifest.sourceWriterParity, true);
  assert.equal(manifest.retailerQualificationWriterParity, true);
  assert.equal(manifest.missionPolicyWriterParity, true);
  assert.equal(manifest.settingsWriterParity, false);
  assert.equal(manifest.configurationWriterParity, false);
  assert.equal(manifest.reservationWriterParity, true);
  assert.equal(manifest.attributionPolicyParity, true);
  assert.equal(manifest.jobLifecycleWriterParity, true);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.deadLetterResetWriterParity, true);
  // Closes NotificationRepository.ensureForJob -> notification_deliveries,
  // the last write postgres-signal-handler-composition.ts's own
  // out-of-scope item 1 names as "genuinely UNQUALIFIED, and remains so
  // after this module."
  assert.equal(manifest.notificationEnsureWriterParity, true);
  // Honestly false at the single-writer level -- only a future composition
  // rung could ever flip these.
  assert.equal(manifest.signalIngressRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.allHandlerRepositoryParity, false);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalNotificationEnsureApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /ensure_notification_delivery/);
  assert.match(source, /NOTIFICATION_ENSURE_V1/);
  assert.match(source, /jsonb_object_keys\(request_payload\)\) <> 2/);
  assert.match(source, /ON CONFLICT \(job_id\) DO NOTHING/);
  assert.match(source, /FOR UPDATE OF job/);
  assert.match(source, /requires a freshly created notify-only action job/);
  assert.match(source, /INSERT INTO .*"notification_deliveries"/s);
  // No audit_events/outbox_events write anywhere -- the real SQLite truth
  // for this one write, unlike every other qualified writer in this
  // repository.
  assert.doesNotMatch(source, /"audit_events"/);
  assert.doesNotMatch(source, /"outbox_events"/);
  // Never calls the shared writer-lock protocol function, and never
  // touches a table outside its own two-table protected boundary.
  assert.doesNotMatch(source, /yoink_lock_signal_action_constraints/);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:action_jobs|action_events|listings|missions|mission_targets|attribution_receipts|attribution_policies|spend_reservations|spend_ledger_entries|retailers|source_connections|inbox_messages|hosted_delivery_receipts)"/
  );
  // Only ever SELECTs action_jobs (for ownership + precondition), never
  // mutates it.
  assert.doesNotMatch(source, /UPDATE\s+"[^"]+"\."action_jobs"/);

  const payload = normalizedPostgresSignalNotificationEnsurePayload("action_job_test");
  const requestId = buildPostgresSignalNotificationEnsureRequestId(principal, payload);
  assert.match(requestId, /^notification_ensure_[a-f0-9]{32}$/);
  assert.equal(buildPostgresSignalNotificationEnsureRequestId(principal, payload), requestId);
  assert.notEqual(
    buildPostgresSignalNotificationEnsureRequestId({ ...principal, userId: "user_other" }, payload),
    requestId
  );
  assert.notEqual(
    buildPostgresSignalNotificationEnsureRequestId({ ...principal, tenantId: "tenant_other" }, payload),
    requestId
  );
  const otherJobPayload = normalizedPostgresSignalNotificationEnsurePayload("action_job_other");
  assert.notEqual(
    buildPostgresSignalNotificationEnsureRequestId(principal, otherJobPayload),
    requestId
  );

  const capability = postgresSignalNotificationEnsureCapabilityProjection();
  assert.deepEqual(capability, postgresSignalNotificationEnsureCapabilityProjection());
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, false);
  assert.equal(capability.insertOrIgnoreReplayParity, true);
  assert.equal(capability.mutableDeliveryStateReplayEcho, true);
  assert.equal(capability.noAuditOrOutboxWrite, true);
  assert.equal(capability.notificationEnsureWriterParity, true);
  assert.equal(capability.writerLockProtocolParity, false);
  assert.equal(capability.deadLetterResetWriterParity, true);
  assert.equal(capability.sourceWriterParity, true);
  assert.equal(capability.retailerQualificationWriterParity, true);
  assert.equal(capability.missionPolicyWriterParity, true);
  assert.equal(capability.operationCount, 1);
  assert.equal(capability.protectedTenantTableCount, 2);
  assert.equal(capability.mutationTableCount, 1);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activePrincipalCount, 0);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalNotificationEnsureApplyManifest(
      manifest.predecessorManifest as never,
      manifest.predecessorManifest.deadLetterResetRoleNamespace
    ),
    /independent/
  );
});

test("the notification-ensure payload normalizer mirrors NotificationRepository.ensureForJob's cleanText(jobId, 160) bound", () => {
  const payload = normalizedPostgresSignalNotificationEnsurePayload("action_job_1234567890abcdef");
  assert.equal(payload.actionJobId, "action_job_1234567890abcdef");
  assert.equal(payload.confirmation, POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_CONFIRMATION);
  assert.deepEqual(Object.keys(payload).sort(), ["actionJobId", "confirmation"]);

  // cleanText collapses internal whitespace and trims -- not rejected
  // outright, matching every sibling normalizer's own treatment of
  // whitespace-bearing input.
  const collapsed = normalizedPostgresSignalNotificationEnsurePayload("  action_job_x   ");
  assert.equal(collapsed.actionJobId, "action_job_x");

  // cleanText truncates to 160 bytes rather than rejecting -- an
  // over-length but otherwise legal id is silently bounded, not refused,
  // matching cleanText(jobId, 160)'s own real behavior.
  const overLong = "a".repeat(300);
  const truncated = normalizedPostgresSignalNotificationEnsurePayload(overLong);
  assert.equal(truncated.actionJobId.length, 160);
  assert.equal(truncated.actionJobId, "a".repeat(160));

  // Rejections: too short, and characters outside the accepted shape.
  assert.throws(
    () => normalizedPostgresSignalNotificationEnsurePayload(""),
    PostgresSignalNotificationEnsureApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalNotificationEnsurePayload("ab"),
    PostgresSignalNotificationEnsureApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalNotificationEnsurePayload("job id!"),
    PostgresSignalNotificationEnsureApplyQualificationError
  );
});

test(
  "the notification-ensure request id derivation and delivery shape mirror NotificationRepository.ensureForJob byte-for-byte (SQLite cross-check)",
  () => {
    const db = new YoinkDatabase();
    try {
      const { jobId } = notifyJobFixture(db);

      const jobRow = db.get<{ tenantId: string; userId: string; action: string; state: string }>(
        `SELECT tenant_id AS tenantId, user_id AS userId, action, state FROM action_jobs WHERE id = ?`,
        jobId
      );
      assert.ok(jobRow);
      assert.equal(jobRow?.action, POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_ACTION);
      assert.equal(jobRow?.state, POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_STATE);
      assert.equal(jobRow?.tenantId, LOCAL_TENANT_ID);
      assert.equal(jobRow?.userId, LOCAL_USER_ID);

      // ensureForJob already ran once inside createActionJob (effectiveAction
      // === "notify") -- exactly one notification_deliveries row exists for
      // this job, real SQLite state.
      assert.equal(
        db.get<{ count: number }>("SELECT COUNT(*) AS count FROM notification_deliveries")?.count,
        1
      );
      const deliveryRow = db.get<{
        id: string;
        tenantId: string;
        userId: string;
        jobId: string;
        state: string;
        attempts: number;
        createdAt: string;
        updatedAt: string;
      }>(
        `SELECT id, tenant_id AS tenantId, user_id AS userId, job_id AS jobId, state,
                attempts, created_at AS createdAt, updated_at AS updatedAt
         FROM notification_deliveries WHERE job_id = ?`,
        jobId
      );
      assert.ok(deliveryRow);
      assert.equal(deliveryRow?.jobId, jobId);
      assert.equal(deliveryRow?.tenantId, LOCAL_TENANT_ID);
      assert.equal(deliveryRow?.userId, LOCAL_USER_ID);
      assert.equal(deliveryRow?.state, POSTGRES_SIGNAL_NOTIFICATION_ENSURE_DELIVERY_STATE);
      assert.equal(deliveryRow?.attempts, 0);
      assert.equal(deliveryRow?.createdAt, deliveryRow?.updatedAt);
      // newId("notification") shape: <prefix>_<32 lowercase hex>, the exact
      // shape this boundary's own deterministic id substitute also produces.
      assert.match(String(deliveryRow?.id), /^notification_[0-9a-f]{32}$/);

      // A second real ensureForJob call for the SAME job is SQLite's own
      // true INSERT-OR-IGNORE no-op: zero new rows, the original row
      // untouched -- exactly what insertOrIgnoreReplayParity claims this
      // boundary reproduces.
      const notifications = new NotificationRepository(db);
      runWithRequestScope(LOCAL_REQUEST_SCOPE, () => notifications.ensureForJob(jobId, NOW + 5_000));
      assert.equal(
        db.get<{ count: number }>("SELECT COUNT(*) AS count FROM notification_deliveries")?.count,
        1
      );
      const unchangedRow = db.get<{ id: string; updatedAt: string }>(
        "SELECT id, updated_at AS updatedAt FROM notification_deliveries WHERE job_id = ?",
        jobId
      );
      assert.equal(unchangedRow?.id, deliveryRow?.id);
      assert.equal(unchangedRow?.updatedAt, deliveryRow?.updatedAt);

      // A THIRD call for a jobId that was never persisted at all is also a
      // true SQLite no-op (the `!job` branch) -- still zero rows total.
      runWithRequestScope(
        LOCAL_REQUEST_SCOPE,
        () => notifications.ensureForJob("action_job_does_not_exist", NOW + 6_000)
      );
      assert.equal(
        db.get<{ count: number }>("SELECT COUNT(*) AS count FROM notification_deliveries")?.count,
        1
      );

      // This boundary's own request-id/payload normalizer, cross-checked
      // against the identical real job id.
      const payload = normalizedPostgresSignalNotificationEnsurePayload(jobId);
      assert.equal(payload.actionJobId, jobId);
      const requestId = buildPostgresSignalNotificationEnsureRequestId(principal, payload);
      assert.match(requestId, /^notification_ensure_[a-f0-9]{32}$/);
      assert.equal(buildPostgresSignalNotificationEnsureRequestId(principal, payload), requestId);

      const otherJobPayload = normalizedPostgresSignalNotificationEnsurePayload("action_job_does_not_exist");
      assert.notEqual(
        buildPostgresSignalNotificationEnsureRequestId(principal, otherJobPayload),
        requestId
      );

      db.assertIntegrity();
    } finally {
      db.close();
    }
  }
);

test("the generated notification-ensure PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    await database.exec("SET search_path TO pg_catalog");
    const source = signalNotificationEnsureApplyFunctionSource(
      buildPostgresSignalNotificationEnsureApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_notification_ensure_parse_probe(
      expected_tenant_id text, expected_user_id text, operation_name text,
      request_id text, request_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${source}
    $function$`);
  } finally {
    await database.close();
  }
});
