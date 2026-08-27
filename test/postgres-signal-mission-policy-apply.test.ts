import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_MISSION_POLICY_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_MISSION_POLICY_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_MISSION_POLICY_APPLY_FUNCTION,
  buildPostgresSignalMissionPolicyApplyManifest,
  postgresSignalMissionPolicyCapabilityProjection,
  signalMissionPolicyApplyFunctionSource
} from "../packages/database/src/postgres-signal-mission-policy-apply.js";

test("the mission-policy writer is append-only, exact, and inactive", () => {
  const manifest = buildPostgresSignalMissionPolicyApplyManifest();
  assert.deepEqual(buildPostgresSignalMissionPolicyApplyManifest(), manifest);
  assert.equal(
    manifest.contractVersion,
    POSTGRES_SIGNAL_MISSION_POLICY_APPLY_CONTRACT_VERSION
  );
  assert.equal(manifest.retailerQualificationApplyContractVersion, 1);
  assert.equal(manifest.writerLockProtocolContractVersion, 1);
  assert.equal(
    manifest.missionPolicyRole.kind,
    "signal_mission_policy_apply_boundary"
  );
  assert.equal(
    manifest.missionPolicyRole.functionName,
    POSTGRES_SIGNAL_MISSION_POLICY_APPLY_FUNCTION
  );
  assert.equal(manifest.missionPolicyRole.login, false);
  assert.equal(manifest.missionPolicyRole.inherit, false);
  assert.equal(manifest.missionPolicyRole.bypassRls, false);
  assert.equal(manifest.missionPolicyRole.directTableAccess, false);
  assert.deepEqual(manifest.missionPolicyRole.protectedTenantTableNames, [
    "app_settings",
    "audit_events",
    "mission_intent_revisions",
    "mission_targets",
    "missions",
    "outbox_events"
  ]);
  assert.deepEqual(manifest.missionPolicyRole.mutationTableNames, [
    "audit_events",
    "mission_intent_revisions",
    "outbox_events"
  ]);
  assert.deepEqual(
    manifest.missionPolicyRole.protectedSharedCatalogTableNames,
    ["listings"]
  );
  assert.equal(manifest.operationCount, 1);
  assert.equal(manifest.maximumMissionTargets, 10_000);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.settingsScopeConsumed, true);
  assert.equal(manifest.missionPolicyScopeConsumed, true);
  assert.equal(manifest.optimisticConcurrency, true);
  assert.equal(manifest.deterministicRequestIdentity, true);
  assert.equal(manifest.immutableRequestReplay, true);
  assert.equal(manifest.zeroWriteUnchangedPolicy, true);
  assert.equal(manifest.appendOnlyPolicyRevision, true);
  assert.equal(manifest.atomicPolicyAuditOutbox, true);
  assert.equal(manifest.currentMissionOwnershipRevalidation, true);
  assert.equal(manifest.currentTargetSnapshotRevalidation, true);
  assert.equal(manifest.currentSettingsRevalidation, true);
  assert.equal(manifest.policyHashV2Parity, true);
  assert.equal(manifest.directPurchaseSafetyParity, true);
  assert.equal(manifest.sourceTrustWriterParity, true);
  assert.equal(manifest.sourceWriterParity, false);
  assert.equal(manifest.retailerQualificationWriterParity, true);
  assert.equal(manifest.missionPolicyWriterParity, true);
  assert.equal(manifest.settingsWriterParity, false);
  assert.equal(manifest.configurationWriterParity, false);
  assert.equal(manifest.reservationWriterParity, false);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalMissionPolicyApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /revise_mission_policy/);
  assert.match(source, new RegExp(POSTGRES_SIGNAL_MISSION_POLICY_APPLY_CONFIRMATION));
  assert.match(source, /yoink_lock_signal_action_constraints/);
  assert.match(source, /mission_id_value, '00110'/);
  assert.match(source, /intent-policy-v2/);
  assert.match(source, /expectedPolicyHash/);
  assert.match(source, /expectedRevision/);
  assert.match(source, /LOCK TABLE .*"mission_targets" IN SHARE MODE/s);
  assert.match(source, /LOCK TABLE .*"listings" IN SHARE MODE/s);
  assert.match(source, /FROM .*"app_settings"/s);
  assert.match(source, /FROM .*"missions"/s);
  assert.match(source, /FROM .*"mission_targets"/s);
  assert.match(source, /JOIN .*"listings"/s);
  assert.match(source, /INSERT INTO .*"mission_intent_revisions"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(source, /UPDATE\s+"[^\"]+"\."(?:missions|mission_targets|listings|app_settings)"/i);
  assert.doesNotMatch(source, /DELETE\s+FROM/i);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:action_jobs|action_events|spend_reservations|spend_ledger_entries|source_connections|source_device_states|source_sync_runs|source_sync_run_items|retailers|listings|missions|mission_targets|app_settings)"/
  );

  const capability = postgresSignalMissionPolicyCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.operationCount, 1);
  assert.equal(capability.protectedTenantTableCount, 6);
  assert.equal(capability.forcedRlsTableCount, 6);
  assert.equal(capability.mutationTableCount, 3);
  assert.equal(capability.protectedSharedCatalogTableCount, 1);
  assert.equal(capability.missionPolicyWriterParity, true);
  assert.equal(capability.sourceWriterParity, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.sharedCatalogMutationAuthority, false);
  assert.equal(capability.actionAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalMissionPolicyApplyManifest(
      manifest.predecessorManifest,
      manifest.predecessorManifest.retailerQualificationRoleNamespace
    ),
    /independent/
  );
});

test("the generated mission-policy PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    const source = signalMissionPolicyApplyFunctionSource(
      buildPostgresSignalMissionPolicyApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_mission_policy_parse_probe(
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
