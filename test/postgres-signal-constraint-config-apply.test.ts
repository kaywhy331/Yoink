import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_FUNCTION,
  buildPostgresSignalConstraintConfigApplyManifest,
  postgresSignalConstraintConfigCapabilityProjection,
  signalConstraintConfigApplyFunctionSource
} from "../packages/database/src/postgres-signal-constraint-config-apply.js";

test("the constraint-configuration writer is deterministic, bounded, partially ported, and inactive", () => {
  const manifest = buildPostgresSignalConstraintConfigApplyManifest();
  assert.deepEqual(buildPostgresSignalConstraintConfigApplyManifest(), manifest);
  assert.equal(
    manifest.contractVersion,
    POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_CONTRACT_VERSION
  );
  assert.equal(manifest.writerLockProtocolContractVersion, 1);
  assert.equal(
    manifest.constraintConfigRole.kind,
    "signal_constraint_config_apply_boundary"
  );
  assert.equal(
    manifest.constraintConfigRole.functionName,
    POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_FUNCTION
  );
  assert.equal(manifest.constraintConfigRole.login, false);
  assert.equal(manifest.constraintConfigRole.inherit, false);
  assert.equal(manifest.constraintConfigRole.bypassRls, false);
  assert.equal(manifest.constraintConfigRole.directTableAccess, false);
  assert.deepEqual(manifest.constraintConfigRole.protectedTenantTableNames, [
    "app_settings", "audit_events", "outbox_events", "user_spend_policies"
  ]);
  assert.deepEqual(
    manifest.constraintConfigRole.mutationTableNames,
    manifest.constraintConfigRole.protectedTenantTableNames
  );
  assert.equal(manifest.operationCount, 3);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.settingsPauseWriterParity, true);
  assert.equal(manifest.guardrailSettingsWriterParity, true);
  assert.equal(manifest.spendPolicyWriterParity, true);
  assert.equal(manifest.qualificationSettingsWriterParity, false);
  assert.equal(manifest.sourceWriterParity, false);
  assert.equal(manifest.retailerQualificationWriterParity, false);
  assert.equal(manifest.missionPolicyWriterParity, false);
  assert.equal(manifest.settingsWriterParity, false);
  assert.equal(manifest.configurationWriterParity, false);
  assert.equal(manifest.reservationWriterParity, false);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalConstraintConfigApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_lock_signal_action_constraints/);
  assert.match(source, /lock_mask_value := '00100'/);
  assert.match(source, /lock_mask_value := '00001'/);
  assert.match(source, /UPDATE .*"app_settings"/s);
  assert.match(source, /UPDATE .*"user_spend_policies"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:source_connections|retailer_adapter_qualifications|missions|mission_targets|mission_intent_revisions|strategies|spend_reservations|spend_ledger_entries|action_jobs|inbox_messages)"/
  );

  const capability = postgresSignalConstraintConfigCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, true);
  assert.equal(capability.settingsPauseWriterParity, true);
  assert.equal(capability.guardrailSettingsWriterParity, true);
  assert.equal(capability.spendPolicyWriterParity, true);
  assert.equal(capability.settingsWriterParity, false);
  assert.equal(capability.configurationWriterParity, false);
  assert.equal(capability.reservationWriterParity, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalConstraintConfigApplyManifest(
      manifest.predecessorManifest,
      manifest.predecessorManifest.writerLockRoleNamespace
    ),
    /independent/
  );
});

test("the generated constraint-configuration PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    const source = signalConstraintConfigApplyFunctionSource(
      buildPostgresSignalConstraintConfigApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_constraint_config_parse_probe(
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
