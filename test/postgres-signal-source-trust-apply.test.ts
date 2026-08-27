import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_FUNCTION,
  buildPostgresSignalSourceTrustApplyManifest,
  postgresSignalSourceTrustCapabilityProjection,
  signalSourceTrustApplyFunctionSource
} from "../packages/database/src/postgres-signal-source-trust-apply.js";

test("the source-trust writer is deterministic, bounded, partial, and inactive", () => {
  const manifest = buildPostgresSignalSourceTrustApplyManifest();
  assert.deepEqual(buildPostgresSignalSourceTrustApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.targetQualificationApplyContractVersion, 1);
  assert.equal(manifest.writerLockProtocolContractVersion, 1);
  assert.equal(manifest.sourceTrustRole.kind, "signal_source_trust_apply_boundary");
  assert.equal(manifest.sourceTrustRole.functionName, POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_FUNCTION);
  assert.equal(manifest.sourceTrustRole.login, false);
  assert.equal(manifest.sourceTrustRole.inherit, false);
  assert.equal(manifest.sourceTrustRole.bypassRls, false);
  assert.equal(manifest.sourceTrustRole.directTableAccess, false);
  assert.deepEqual(manifest.sourceTrustRole.protectedTenantTableNames, [
    "audit_events",
    "outbox_events",
    "source_connections"
  ]);
  assert.deepEqual(manifest.sourceTrustRole.mutationTableNames, [
    "audit_events",
    "outbox_events",
    "source_connections"
  ]);
  assert.equal(manifest.operationCount, 1);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.sourceScopeConsumed, true);
  assert.equal(manifest.optimisticConcurrency, true);
  assert.equal(manifest.atomicSourceAuditOutbox, true);
  assert.equal(manifest.currentSourceOwnershipRevalidation, true);
  assert.equal(manifest.privateSourceOnly, true);
  assert.equal(manifest.trustedExactAutoCreateCoupling, true);
  assert.equal(manifest.sourceTrustWriterParity, true);
  assert.equal(manifest.sourceWriterParity, false);
  assert.equal(manifest.retailerQualificationWriterParity, false);
  assert.equal(manifest.configurationWriterParity, false);
  assert.equal(manifest.reservationWriterParity, false);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalSourceTrustApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_lock_signal_action_constraints/);
  assert.match(source, /source_connection_id_value, '', '', '10000'/);
  assert.match(source, /CONFIGURE_SOURCE_TRUST_V1/);
  assert.match(source, /trustLevel.*informational.*trusted_exact/s);
  assert.match(source, /autoCreateMissions/s);
  assert.match(source, /FOR UPDATE OF connection/);
  assert.match(source, /UPDATE .*"source_connections"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:retailers|listings|retailer_adapter_qualifications|app_settings|missions|mission_targets|mission_intent_revisions|strategies|action_jobs|spend_reservations|spend_ledger_entries|inbox_messages)"/
  );

  const capability = postgresSignalSourceTrustCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, true);
  assert.equal(capability.sourceScopeConsumed, true);
  assert.equal(capability.sourceTrustWriterParity, true);
  assert.equal(capability.sourceWriterParity, false);
  assert.equal(capability.retailerQualificationWriterParity, false);
  assert.equal(capability.configurationWriterParity, false);
  assert.equal(capability.reservationWriterParity, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalSourceTrustApplyManifest(
      manifest.predecessorManifest,
      manifest.predecessorManifest.targetQualificationRoleNamespace
    ),
    /independent/
  );
});

test("the generated source-trust PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    const source = signalSourceTrustApplyFunctionSource(
      buildPostgresSignalSourceTrustApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_source_trust_parse_probe(
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
