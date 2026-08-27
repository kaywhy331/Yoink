import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_FUNCTION,
  buildPostgresSignalSourceSyncApplyManifest,
  buildPostgresSignalSourceSyncRequestId,
  postgresSignalSourceSyncCapabilityProjection,
  signalSourceSyncApplyFunctionSource,
  type PostgresSignalSourceSyncItemPayload,
  type PostgresSignalSourceSyncProgressPayload
} from "../packages/database/src/postgres-signal-source-sync-apply.js";

const principal = { tenantId: "tenant_test", userId: "user_test" };
const progress: PostgresSignalSourceSyncProgressPayload = {
  deviceId: "device_test_123",
  sourceConnectionId: "source_test_trackalacker",
  syncId: "tlsync_fixture_12345678",
  phase: "discovering",
  page: 1,
  pages: 2,
  discovered: 100,
  processed: 0,
  imported: 0,
  failed: 0,
  message: "Discovering followed products",
  confirmation: POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONFIRMATION
};
const item: PostgresSignalSourceSyncItemPayload = {
  deviceId: progress.deviceId,
  sourceConnectionId: progress.sourceConnectionId,
  syncId: progress.syncId,
  externalProductId: "trackalacker-product:138022",
  candidatesAccepted: 7,
  listingsMapped: 4,
  listingsCreated: 3,
  confirmation: POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONFIRMATION
};

test("the source-sync writer is deterministic, monotonic, bounded, partial, and inactive", () => {
  const manifest = buildPostgresSignalSourceSyncApplyManifest();
  assert.deepEqual(buildPostgresSignalSourceSyncApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.sourceStatusApplyContractVersion, 1);
  assert.equal(manifest.writerLockProtocolContractVersion, 1);
  assert.equal(manifest.sourceSyncRole.kind, "signal_source_sync_apply_boundary");
  assert.equal(manifest.sourceSyncRole.functionName, POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_FUNCTION);
  assert.equal(manifest.sourceSyncRole.login, false);
  assert.equal(manifest.sourceSyncRole.inherit, false);
  assert.equal(manifest.sourceSyncRole.bypassRls, false);
  assert.equal(manifest.sourceSyncRole.directTableAccess, false);
  assert.deepEqual(manifest.sourceSyncRole.protectedTenantTableNames, [
    "audit_events",
    "extension_devices",
    "outbox_events",
    "source_connections",
    "source_sync_run_items",
    "source_sync_runs"
  ]);
  assert.deepEqual(manifest.sourceSyncRole.mutationTableNames, [
    "audit_events",
    "outbox_events",
    "source_sync_run_items",
    "source_sync_runs"
  ]);
  assert.equal(manifest.operationCount, 3);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.sourceScopeConsumed, true);
  assert.equal(manifest.deterministicRequestIdentity, true);
  assert.equal(manifest.immutableAuditedReplay, true);
  assert.equal(manifest.latestStateProgressReplay, true);
  assert.equal(manifest.latestStateItemReplay, true);
  assert.equal(manifest.monotonicProgressCounters, true);
  assert.equal(manifest.boundedActiveRunExclusion, true);
  assert.equal(manifest.staleRunInterruptionParity, true);
  assert.equal(manifest.terminalAuditParity, true);
  assert.equal(manifest.nonTerminalAuditSuppression, true);
  assert.equal(manifest.itemReceiptUpsertParity, true);
  assert.equal(manifest.databaseOwnedTimestamps, true);
  assert.equal(manifest.privacyBoundedMessages, true);
  assert.equal(manifest.atomicRunAuditOutbox, true);
  assert.equal(manifest.currentSourceOwnershipRevalidation, true);
  assert.equal(manifest.currentDeviceOwnershipRevalidation, true);
  assert.equal(manifest.currentRunOwnershipRevalidation, true);
  assert.equal(manifest.activeDeviceOnly, true);
  assert.equal(manifest.activeRunItemOnly, true);
  assert.equal(manifest.privateSourceOnly, true);
  assert.equal(manifest.trackalackerOnly, true);
  assert.equal(manifest.catalogImportExcluded, true);
  assert.equal(manifest.sourceStatusWriterParity, true);
  assert.equal(manifest.sourceSyncWriterParity, true);
  assert.equal(manifest.sourceWriterParity, false);
  assert.equal(manifest.configurationWriterParity, false);
  assert.equal(manifest.reservationWriterParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalSourceSyncApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_lock_signal_action_constraints/);
  assert.match(source, /source_connection_id_value, '', '', '10000'/);
  assert.match(source, /TRACKALACKER_SOURCE_SYNC_V1/);
  assert.match(source, /start_source_sync/);
  assert.match(source, /update_source_sync/);
  assert.match(source, /record_source_sync_item/);
  assert.match(source, /signal source-sync counters cannot move backwards/);
  assert.match(source, /INTERVAL '30 minutes'/);
  assert.match(source, /The previous sync was interrupted before completion\./);
  assert.match(source, /source_sync_started/);
  assert.match(source, /source_sync_finished/);
  assert.match(source, /IF terminal_transition THEN/);
  assert.match(source, /INSERT INTO .*"source_sync_runs"/s);
  assert.match(source, /UPDATE .*"source_sync_runs"/s);
  assert.match(source, /INSERT INTO .*"source_sync_run_items"/s);
  assert.match(source, /UPDATE .*"source_sync_run_items"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:source_listing_candidates|source_listing_refs|source_product_aliases|source_product_refs|source_variant_retailer_refs|retailers|listings|missions|mission_targets|mission_intent_revisions|strategies|action_jobs|spend_reservations|spend_ledger_entries|inbox_messages)"/
  );

  const progressId = buildPostgresSignalSourceSyncRequestId(
    principal,
    "update_source_sync",
    progress
  );
  assert.match(progressId, /^source_sync_[a-f0-9]{32}$/);
  assert.equal(
    buildPostgresSignalSourceSyncRequestId(principal, "update_source_sync", progress),
    progressId
  );
  assert.notEqual(
    buildPostgresSignalSourceSyncRequestId(
      principal,
      "update_source_sync",
      { ...progress, discovered: 101 }
    ),
    progressId
  );
  assert.notEqual(
    buildPostgresSignalSourceSyncRequestId(principal, "start_source_sync", progress),
    progressId
  );
  assert.notEqual(
    buildPostgresSignalSourceSyncRequestId(
      { ...principal, userId: "user_other" },
      "update_source_sync",
      progress
    ),
    progressId
  );
  assert.notEqual(
    buildPostgresSignalSourceSyncRequestId(principal, "record_source_sync_item", item),
    progressId
  );

  const capability = postgresSignalSourceSyncCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, true);
  assert.equal(capability.sourceScopeConsumed, true);
  assert.equal(capability.immutableAuditedReplay, true);
  assert.equal(capability.latestStateProgressReplay, true);
  assert.equal(capability.latestStateItemReplay, true);
  assert.equal(capability.sourceStatusWriterParity, true);
  assert.equal(capability.sourceSyncWriterParity, true);
  assert.equal(capability.sourceWriterParity, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.sharedCatalogMutationAuthority, false);
  assert.equal(capability.actionAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalSourceSyncApplyManifest(
      manifest.predecessorManifest as never,
      manifest.predecessorManifest.sourceStatusRoleNamespace
    ),
    /independent/
  );
});

test("the generated source-sync PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    const source = signalSourceSyncApplyFunctionSource(
      buildPostgresSignalSourceSyncApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_source_sync_parse_probe(
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
