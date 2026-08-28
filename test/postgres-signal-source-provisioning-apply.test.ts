import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { ownedIdForUser } from "../packages/database/src/request-scope.js";
import {
  POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_FUNCTION,
  POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULTS_VERSION,
  POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULT_SOURCES,
  buildPostgresSignalSourceProvisioningApplyManifest,
  buildPostgresSignalSourceProvisioningRequestId,
  expectedDefaultSourceConnectionId,
  postgresSignalSourceProvisioningCapabilityProjection,
  signalSourceProvisioningApplyFunctionSource,
  type PostgresSignalSourceProvisioningPayload
} from "../packages/database/src/postgres-signal-source-provisioning-apply.js";

const principal = { tenantId: "tenant_test", userId: "user_test" };
const payload: PostgresSignalSourceProvisioningPayload = {
  defaultsVersion: POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULTS_VERSION,
  confirmation: POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONFIRMATION
};

test("the source-provisioning writer is deterministic, SQLite-id-parity, zero-write-safe, and inactive", () => {
  const manifest = buildPostgresSignalSourceProvisioningApplyManifest();
  assert.deepEqual(buildPostgresSignalSourceProvisioningApplyManifest(), manifest);
  assert.equal(
    manifest.contractVersion,
    POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONTRACT_VERSION
  );
  assert.equal(manifest.catalogImportApplyContractVersion, 1);
  assert.equal(manifest.writerLockProtocolContractVersion, 1);
  assert.equal(
    manifest.sourceProvisioningRole.kind,
    "signal_source_provisioning_apply_boundary"
  );
  assert.equal(
    manifest.sourceProvisioningRole.functionName,
    POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_FUNCTION
  );
  assert.equal(manifest.sourceProvisioningRole.login, false);
  assert.equal(manifest.sourceProvisioningRole.inherit, false);
  assert.equal(manifest.sourceProvisioningRole.bypassRls, false);
  assert.equal(manifest.sourceProvisioningRole.directTableAccess, false);
  assert.deepEqual(manifest.sourceProvisioningRole.protectedTenantTableNames, [
    "audit_events",
    "outbox_events",
    "source_connections"
  ]);
  assert.deepEqual(manifest.sourceProvisioningRole.mutationTableNames, [
    "audit_events",
    "outbox_events",
    "source_connections"
  ]);
  assert.equal(manifest.operationCount, 1);
  assert.equal(manifest.defaultSourceConnectionCount, 3);
  assert.equal(manifest.trustedExactSourceCount, 2);
  assert.equal(manifest.informationalSourceCount, 1);
  assert.deepEqual(
    manifest.defaultSourceConnections,
    POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULT_SOURCES
  );
  assert.deepEqual(POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULT_SOURCES, [
    { source: "trackalacker", name: "TrackaLacker", trustLevel: "trusted_exact", autoCreateMissions: 1 },
    { source: "browser", name: "Browser observations", trustLevel: "trusted_exact", autoCreateMissions: 1 },
    { source: "discord", name: "Discord", trustLevel: "informational", autoCreateMissions: 0 }
  ]);
  assert.equal(manifest.protectedTenantTableCount, 3);
  assert.equal(manifest.forcedRlsTableCount, 3);
  assert.equal(manifest.mutationTableCount, 3);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.sourceScopeConsumed, true);
  assert.equal(manifest.deterministicRequestIdentity, true);
  assert.equal(manifest.deterministicConnectionIdentity, true);
  assert.equal(manifest.sqliteOwnedIdParity, true);
  assert.equal(manifest.immutableAuditedReplay, true);
  assert.equal(manifest.zeroWriteWhenAlreadyProvisioned, true);
  assert.equal(manifest.existingIdentityConflictFailClosed, true);
  assert.equal(manifest.atomicProvisioningAuditOutbox, true);
  assert.equal(manifest.databaseOwnedTimestamps, true);
  assert.equal(manifest.privateSourceOnly, true);
  assert.equal(manifest.disconnectedInitialStatus, true);

  // The 21st writer: closes its own aggregate flag and, transitively, the
  // "sourceWriterParity" aggregate now that all five source-domain writers
  // (trust, status, sync, catalog-import, connection-provisioning) are true.
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
  // Several writer families (catalog-apply, resolution-apply,
  // source-reference-refresh, terminal-decision-apply, offer-incident-apply,
  // post-incident-decision-apply, mission-binding-apply,
  // strategy-evaluation-apply, plus every non-signal writer) still do not
  // consume the shared five-domain lock protocol, so the protocol-wide
  // aggregate cannot close just because source-provisioning becomes its
  // 11th consumer.
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalSourceProvisioningApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_lock_signal_action_constraints/);
  assert.match(source, /trackalacker_id_value, '', '', '10000'/);
  assert.match(source, /SOURCE_CONNECTION_PROVISIONING_V1/);
  assert.match(source, /provision_source_connections/);
  assert.match(source, /'trackalacker',\s*\n\s*'TrackaLacker', 'disconnected', 'trusted_exact', 1, 1/);
  assert.match(source, /'browser',\s*\n\s*'Browser observations', 'disconnected', 'trusted_exact', 1, 1/);
  assert.match(source, /'discord',\s*\n\s*'Discord', 'disconnected', 'informational', 0, 1/);
  assert.match(source, /ON CONFLICT\(id\) DO NOTHING/);
  assert.match(source, /signal source-provisioning trackalacker connection identity conflicts/);
  assert.match(source, /signal source-provisioning browser connection identity conflicts/);
  assert.match(source, /signal source-provisioning discord connection identity conflicts/);
  assert.match(source, /signal source-provisioning replay graph changed/);
  assert.match(source, /INSERT INTO .*"source_connections"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  // Reproduces `ownedIdForUser`'s exact content-hash (label + userId + prefix,
  // each byte-length-prefixed with a trailing '|', sha256 hex truncated to 24).
  assert.match(source, /'17:yoink_owned_id_v1\|'/);
  assert.match(source, /'19:source_trackalacker\|'/);
  assert.match(source, /'14:source_browser\|'/);
  assert.match(source, /'14:source_discord\|'/);
  assert.match(source, /pg_catalog\.substr\(pg_catalog\.encode\(pg_catalog\.sha256/);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:source_sync_runs|source_sync_run_items|source_listing_candidates|source_listing_refs|source_product_aliases|source_product_refs|source_variant_retailer_refs|retailers|listings|listing_urls|product_families|variants|missions|mission_targets|mission_intent_revisions|strategies|action_jobs|spend_reservations|spend_ledger_entries|inbox_messages|extension_devices|source_device_states)"/
  );

  const requestId = buildPostgresSignalSourceProvisioningRequestId(principal, payload);
  assert.match(requestId, /^source_provisioning_[a-f0-9]{32}$/);
  assert.equal(buildPostgresSignalSourceProvisioningRequestId(principal, payload), requestId);
  assert.notEqual(
    buildPostgresSignalSourceProvisioningRequestId(
      { ...principal, userId: "user_other" },
      payload
    ),
    requestId
  );
  assert.notEqual(
    buildPostgresSignalSourceProvisioningRequestId(
      { ...principal, tenantId: "tenant_other" },
      payload
    ),
    requestId
  );

  // Deterministic connection identity must reproduce the exact SQLite
  // `ownedIdForUser` derivation (the id a SQLite-imported row would carry).
  const expectedTrackalackerId = expectedDefaultSourceConnectionId(principal.userId, "trackalacker");
  const expectedBrowserId = expectedDefaultSourceConnectionId(principal.userId, "browser");
  const expectedDiscordId = expectedDefaultSourceConnectionId(principal.userId, "discord");
  assert.equal(
    expectedTrackalackerId,
    ownedIdForUser("source_trackalacker", principal.userId, "source_trackalacker_local")
  );
  assert.equal(
    expectedBrowserId,
    ownedIdForUser("source_browser", principal.userId, "source_browser_local")
  );
  assert.equal(
    expectedDiscordId,
    ownedIdForUser("source_discord", principal.userId, "source_discord_local")
  );
  assert.match(expectedTrackalackerId, /^source_trackalacker_[a-f0-9]{24}$/);
  assert.match(expectedBrowserId, /^source_browser_[a-f0-9]{24}$/);
  assert.match(expectedDiscordId, /^source_discord_[a-f0-9]{24}$/);
  // The imported local principal keeps its seeded legacy identity — both in
  // the TypeScript helper and inside the generated PL/pgSQL derivation.
  assert.equal(
    expectedDefaultSourceConnectionId("user_local", "trackalacker"),
    "source_trackalacker_local"
  );
  assert.equal(expectedDefaultSourceConnectionId("user_local", "browser"), "source_browser_local");
  assert.equal(expectedDefaultSourceConnectionId("user_local", "discord"), "source_discord_local");
  assert.match(source, /CASE WHEN resolved_user_id = 'user_local' THEN 'source_trackalacker_local'/);
  assert.match(source, /CASE WHEN resolved_user_id = 'user_local' THEN 'source_browser_local'/);
  assert.match(source, /CASE WHEN resolved_user_id = 'user_local' THEN 'source_discord_local'/);
  assert.notEqual(
    expectedDefaultSourceConnectionId("user_other", "trackalacker"),
    expectedTrackalackerId
  );

  const capability = postgresSignalSourceProvisioningCapabilityProjection();
  assert.deepEqual(capability, postgresSignalSourceProvisioningCapabilityProjection());
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, true);
  assert.equal(capability.sourceScopeConsumed, true);
  assert.equal(capability.deterministicConnectionIdentity, true);
  assert.equal(capability.sqliteOwnedIdParity, true);
  assert.equal(capability.zeroWriteWhenAlreadyProvisioned, true);
  assert.equal(capability.existingIdentityConflictFailClosed, true);
  assert.equal(capability.connectionProvisioningWriterParity, true);
  assert.equal(capability.sourceWriterParity, true);
  assert.equal(capability.retailerQualificationWriterParity, true);
  assert.equal(capability.missionPolicyWriterParity, true);
  assert.equal(capability.writerLockProtocolParity, false);
  assert.equal(capability.defaultSourceConnectionCount, 3);
  assert.equal(capability.protectedTenantTableCount, 3);
  assert.equal(capability.mutationTableCount, 3);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activePrincipalCount, 0);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.sharedCatalogMutationAuthority, false);
  assert.equal(capability.actionAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalSourceProvisioningApplyManifest(
      manifest.predecessorManifest as never,
      manifest.predecessorManifest.catalogImportRoleNamespace
    ),
    /independent/
  );
});

test("the generated source-provisioning PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    await database.exec("SET search_path TO pg_catalog");
    const source = signalSourceProvisioningApplyFunctionSource(
      buildPostgresSignalSourceProvisioningApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_source_provisioning_parse_probe(
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
