import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_SCOPE_ORDER,
  buildPostgresSignalWriterLockProtocolManifest,
  postgresSignalWriterLockProtocolCapabilityProjection,
  signalWriterLockProtocolFunctionSource
} from "../packages/database/src/postgres-signal-writer-lock-protocol.js";

test("the signal writer-lock protocol is deterministic, ordered, lock-only, and inactive", () => {
  const manifest = buildPostgresSignalWriterLockProtocolManifest();
  assert.deepEqual(buildPostgresSignalWriterLockProtocolManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION);
  assert.equal(manifest.strategyEvaluationApplyContractVersion, 1);
  assert.equal(manifest.writerLockRole.kind, "signal_writer_lock_protocol_boundary");
  assert.equal(manifest.writerLockRole.functionName, POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION);
  assert.equal(manifest.writerLockRole.login, false);
  assert.equal(manifest.writerLockRole.inherit, false);
  assert.equal(manifest.writerLockRole.bypassRls, false);
  assert.equal(manifest.writerLockRole.directTableAccess, false);
  assert.deepEqual(manifest.lockScopeOrder, [...POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_SCOPE_ORDER]);
  assert.equal(manifest.fullLockMask, POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK);
  assert.equal(manifest.protectedTenantTableCount, 7);
  assert.equal(manifest.forcedRlsTableCount, 7);
  assert.equal(manifest.mutationTableCount, 0);
  assert.deepEqual(manifest.writerLockRole.mutationTableNames, []);
  assert.equal(manifest.fixedOrderAdvisoryLocks, true);
  assert.equal(manifest.actionSpendConsumerParity, true);
  assert.equal(manifest.configurationWriterParity, false);
  assert.equal(manifest.reservationWriterParity, false);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalWriterLockProtocolFunctionSource(manifest);
  const sourceOffset = source.indexOf("signal_writer_lock_01_source_v1");
  const qualificationOffset = source.indexOf("signal_writer_lock_02_retailer_qualification_v1");
  const settingsOffset = source.indexOf("signal_writer_lock_03_settings_v1");
  const policyOffset = source.indexOf("signal_writer_lock_04_mission_policy_v1");
  const spendOffset = source.indexOf("signal_writer_lock_05_spend_v1");
  assert.ok(sourceOffset > 0);
  assert.ok(sourceOffset < qualificationOffset);
  assert.ok(qualificationOffset < settingsOffset);
  assert.ok(settingsOffset < policyOffset);
  assert.ok(policyOffset < spendOffset);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /source ownership is invalid/);
  assert.match(source, /mission ownership is invalid/);
  assert.match(source, /retailer identity is invalid/);
  assert.doesNotMatch(source, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE\s+/i);

  const capability = postgresSignalWriterLockProtocolCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.sharedWriterLockProtocolImplemented, true);
  assert.equal(capability.actionSpendConsumerParity, true);
  assert.equal(capability.configurationWriterParity, false);
  assert.equal(capability.reservationWriterParity, false);
  assert.equal(capability.writerLockProtocolParity, false);
  assert.equal(capability.mutationAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalWriterLockProtocolManifest(
      manifest.predecessorManifest,
      manifest.predecessorManifest.strategyEvaluationRoleNamespace
    ),
    /independent/
  );
});

test("the generated signal writer-lock PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    const source = signalWriterLockProtocolFunctionSource(
      buildPostgresSignalWriterLockProtocolManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_writer_lock_parse_probe(
      expected_tenant_id text, expected_user_id text,
      source_connection_id_input text, retailer_id_input text,
      mission_id_input text, lock_mask text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${source}
    $function$`);
  } finally {
    await database.close();
  }
});
