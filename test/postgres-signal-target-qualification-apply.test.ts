import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_FUNCTION,
  buildPostgresSignalTargetQualificationApplyManifest,
  postgresSignalTargetQualificationCapabilityProjection,
  signalTargetQualificationApplyFunctionSource
} from "../packages/database/src/postgres-signal-target-qualification-apply.js";

test("the Target qualification/settings writer is deterministic, bounded, complete for Target, and inactive", () => {
  const manifest = buildPostgresSignalTargetQualificationApplyManifest();
  assert.deepEqual(buildPostgresSignalTargetQualificationApplyManifest(), manifest);
  assert.equal(
    manifest.contractVersion,
    POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_CONTRACT_VERSION
  );
  assert.equal(manifest.actionSpendApplyContractVersion, 1);
  assert.equal(manifest.writerLockProtocolContractVersion, 1);
  assert.equal(
    manifest.targetQualificationRole.kind,
    "signal_target_qualification_apply_boundary"
  );
  assert.equal(
    manifest.targetQualificationRole.functionName,
    POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_FUNCTION
  );
  assert.equal(manifest.targetQualificationRole.login, false);
  assert.equal(manifest.targetQualificationRole.inherit, false);
  assert.equal(manifest.targetQualificationRole.bypassRls, false);
  assert.equal(manifest.targetQualificationRole.directTableAccess, false);
  assert.deepEqual(manifest.targetQualificationRole.protectedTenantTableNames, [
    "action_events",
    "action_jobs",
    "app_settings",
    "audit_events",
    "extension_devices",
    "outbox_events",
    "retailer_adapter_qualifications",
    "retailer_adapter_trials",
    "retailer_shadow_observations"
  ]);
  assert.deepEqual(manifest.targetQualificationRole.mutationTableNames, [
    "action_events",
    "action_jobs",
    "app_settings",
    "audit_events",
    "outbox_events",
    "retailer_adapter_qualifications"
  ]);
  assert.equal(manifest.operationCount, 1);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.retailerQualificationScopeConsumed, true);
  assert.equal(manifest.settingsScopeConsumed, true);
  assert.equal(manifest.currentEvidenceRevalidation, true);
  assert.equal(manifest.currentDeviceCapabilityRevalidation, true);
  assert.equal(manifest.targetQualificationSettingsWriterParity, true);
  assert.equal(manifest.targetJobPromotionParity, true);
  assert.equal(manifest.qualificationSettingsWriterParity, true);
  assert.equal(manifest.sourceWriterParity, false);
  assert.equal(manifest.retailerQualificationWriterParity, false);
  assert.equal(manifest.missionPolicyWriterParity, false);
  assert.equal(manifest.settingsWriterParity, false);
  assert.equal(manifest.configurationWriterParity, false);
  assert.equal(manifest.reservationWriterParity, false);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalTargetQualificationApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_lock_signal_action_constraints/);
  assert.match(source, /'', 'target', '', '01100'/);
  assert.match(source, /LOCK TABLE .*"retailer_shadow_observations" IN SHARE MODE/s);
  assert.match(source, /LOCK TABLE .*"retailer_adapter_trials" IN SHARE MODE/s);
  assert.match(source, /target-add-qualification-evidence-v1/);
  assert.match(source, /targetAddAdapterVersion/);
  assert.match(source, /INSERT INTO .*"retailer_adapter_qualifications"/s);
  assert.match(source, /UPDATE .*"app_settings"/s);
  assert.match(source, /UPDATE .*"action_jobs"/s);
  assert.match(source, /INSERT INTO .*"action_events"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:retailers|listings|source_connections|missions|mission_targets|mission_intent_revisions|strategies|spend_reservations|spend_ledger_entries|inbox_messages)"/
  );

  const capability = postgresSignalTargetQualificationCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, true);
  assert.equal(capability.targetQualificationSettingsWriterParity, true);
  assert.equal(capability.targetJobPromotionParity, true);
  assert.equal(capability.qualificationSettingsWriterParity, true);
  assert.equal(capability.retailerQualificationWriterParity, false);
  assert.equal(capability.configurationWriterParity, false);
  assert.equal(capability.reservationWriterParity, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalTargetQualificationApplyManifest(
      manifest.predecessorManifest,
      manifest.predecessorManifest.actionSpendRoleNamespace
    ),
    /independent/
  );
});

test("the generated Target qualification PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    const source = signalTargetQualificationApplyFunctionSource(
      buildPostgresSignalTargetQualificationApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_target_qualification_parse_probe(
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
