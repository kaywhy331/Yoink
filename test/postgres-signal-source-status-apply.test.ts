import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_FUNCTION,
  buildPostgresSignalSourceStatusApplyManifest,
  buildPostgresSignalSourceStatusRequestId,
  postgresSignalSourceStatusCapabilityProjection,
  signalSourceStatusApplyFunctionSource,
  type PostgresSignalSourceStatusPayload
} from "../packages/database/src/postgres-signal-source-status-apply.js";

const principal = { tenantId: "tenant_test", userId: "user_test" };
const payload: PostgresSignalSourceStatusPayload = {
  deviceId: "device_test_123",
  sourceConnectionId: "source_test_trackalacker",
  state: "ready",
  ready: true,
  subscriptionPresent: true,
  pendingSignals: 0,
  lastHttpStatus: 204,
  errorCode: "",
  lastRegistrationAt: "2026-08-27T10:00:00.000Z",
  lastNotificationAt: "",
  lastDeliveryAt: "2026-08-27T10:00:01.000Z",
  updatedAt: "2026-08-27T10:00:02.000Z",
  confirmation: POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONFIRMATION
};

test("the source-status writer is deterministic, no-flood, bounded, partial, and inactive", () => {
  const manifest = buildPostgresSignalSourceStatusApplyManifest();
  assert.deepEqual(buildPostgresSignalSourceStatusApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.missionPolicyApplyContractVersion, 1);
  assert.equal(manifest.writerLockProtocolContractVersion, 1);
  assert.equal(manifest.sourceStatusRole.kind, "signal_source_status_apply_boundary");
  assert.equal(manifest.sourceStatusRole.functionName, POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_FUNCTION);
  assert.equal(manifest.sourceStatusRole.login, false);
  assert.equal(manifest.sourceStatusRole.inherit, false);
  assert.equal(manifest.sourceStatusRole.bypassRls, false);
  assert.equal(manifest.sourceStatusRole.directTableAccess, false);
  assert.deepEqual(manifest.sourceStatusRole.protectedTenantTableNames, [
    "audit_events",
    "extension_devices",
    "outbox_events",
    "source_connections",
    "source_device_states"
  ]);
  assert.deepEqual(manifest.sourceStatusRole.mutationTableNames, [
    "audit_events",
    "outbox_events",
    "source_connections",
    "source_device_states"
  ]);
  assert.equal(manifest.operationCount, 1);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.sourceScopeConsumed, true);
  assert.equal(manifest.deterministicRequestIdentity, true);
  assert.equal(manifest.immutableMaterialReplay, true);
  assert.equal(manifest.latestStateReplayOnly, true);
  assert.equal(manifest.nonMaterialAuditSuppression, true);
  assert.equal(manifest.monotonicDeviceTimestamp, true);
  assert.equal(manifest.databaseOwnedEventTimestamps, true);
  assert.equal(manifest.clientObservedAtPreserved, true);
  assert.equal(manifest.atomicMaterialStatusAuditOutbox, true);
  assert.equal(manifest.currentSourceOwnershipRevalidation, true);
  assert.equal(manifest.currentDeviceOwnershipRevalidation, true);
  assert.equal(manifest.activeDeviceOnly, true);
  assert.equal(manifest.privateSourceOnly, true);
  assert.equal(manifest.trackalackerOnly, true);
  assert.equal(manifest.materialChangeAuditParity, true);
  assert.equal(manifest.sourceTrustWriterParity, true);
  assert.equal(manifest.sourceStatusWriterParity, true);
  assert.equal(manifest.sourceSyncWriterParity, false);
  assert.equal(manifest.sourceWriterParity, false);
  assert.equal(manifest.retailerQualificationWriterParity, true);
  assert.equal(manifest.missionPolicyWriterParity, true);
  assert.equal(manifest.configurationWriterParity, false);
  assert.equal(manifest.reservationWriterParity, false);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalSourceStatusApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_lock_signal_action_constraints/);
  assert.match(source, /source_connection_id_value, '', '', '10000'/);
  assert.match(source, /RECORD_TRACKALACKER_STATUS_V1/);
  assert.match(source, /source_record\.source <> 'trackalacker'/);
  assert.match(source, /device_record\.status <> 'active'/);
  assert.match(source, /signal source-status update is stale/);
  assert.match(source, /signal source-status timestamp collision changed state/);
  assert.match(source, /IF material_change THEN/);
  assert.match(source, /CASE WHEN material_change THEN 4 ELSE 2 END/);
  assert.match(source, /ON CONFLICT\(device_id, source_connection_id\) DO UPDATE/);
  assert.match(source, /UPDATE .*"source_connections"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:source_sync_runs|source_sync_run_items|source_listing_candidates|source_listing_refs|source_product_aliases|source_product_refs|source_variant_retailer_refs|retailers|listings|missions|mission_targets|mission_intent_revisions|strategies|action_jobs|spend_reservations|spend_ledger_entries|inbox_messages)"/
  );

  const requestId = buildPostgresSignalSourceStatusRequestId(principal, payload);
  assert.match(requestId, /^source_status_[a-f0-9]{32}$/);
  assert.equal(buildPostgresSignalSourceStatusRequestId(principal, payload), requestId);
  assert.notEqual(
    buildPostgresSignalSourceStatusRequestId(principal, { ...payload, pendingSignals: 1 }),
    requestId
  );
  assert.notEqual(
    buildPostgresSignalSourceStatusRequestId(
      { ...principal, userId: "user_other" },
      payload
    ),
    requestId
  );

  const capability = postgresSignalSourceStatusCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, true);
  assert.equal(capability.sourceScopeConsumed, true);
  assert.equal(capability.immutableMaterialReplay, true);
  assert.equal(capability.latestStateReplayOnly, true);
  assert.equal(capability.nonMaterialAuditSuppression, true);
  assert.equal(capability.sourceStatusWriterParity, true);
  assert.equal(capability.sourceSyncWriterParity, false);
  assert.equal(capability.sourceWriterParity, false);
  assert.equal(capability.retailerQualificationWriterParity, true);
  assert.equal(capability.missionPolicyWriterParity, true);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.sharedCatalogMutationAuthority, false);
  assert.equal(capability.actionAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalSourceStatusApplyManifest(
      manifest.predecessorManifest,
      manifest.predecessorManifest.missionPolicyRoleNamespace
    ),
    /independent/
  );
});

test("the generated source-status PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    const source = signalSourceStatusApplyFunctionSource(
      buildPostgresSignalSourceStatusApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_source_status_parse_probe(
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
