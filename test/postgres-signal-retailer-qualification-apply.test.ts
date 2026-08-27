import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_FUNCTION,
  buildPostgresSignalRetailerQualificationApplyManifest,
  postgresSignalRetailerQualificationCapabilityProjection,
  signalRetailerQualificationApplyFunctionSource
} from "../packages/database/src/postgres-signal-retailer-qualification-apply.js";

test("the non-Target qualification writer is exact, shared-catalog-safe, and inactive", () => {
  const manifest = buildPostgresSignalRetailerQualificationApplyManifest();
  assert.deepEqual(buildPostgresSignalRetailerQualificationApplyManifest(), manifest);
  assert.equal(
    manifest.contractVersion,
    POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_CONTRACT_VERSION
  );
  assert.equal(manifest.sourceTrustApplyContractVersion, 1);
  assert.equal(manifest.writerLockProtocolContractVersion, 1);
  assert.equal(
    manifest.retailerQualificationRole.kind,
    "signal_retailer_qualification_apply_boundary"
  );
  assert.equal(
    manifest.retailerQualificationRole.functionName,
    POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_FUNCTION
  );
  assert.equal(manifest.retailerQualificationRole.login, false);
  assert.equal(manifest.retailerQualificationRole.inherit, false);
  assert.equal(manifest.retailerQualificationRole.bypassRls, false);
  assert.equal(manifest.retailerQualificationRole.directTableAccess, false);
  assert.deepEqual(manifest.retailerQualificationRole.protectedTenantTableNames, [
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
  assert.deepEqual(manifest.retailerQualificationRole.tenantMutationTableNames, [
    "action_events",
    "action_jobs",
    "audit_events",
    "outbox_events",
    "retailer_adapter_qualifications"
  ]);
  assert.deepEqual(
    manifest.retailerQualificationRole.protectedSharedCatalogTableNames,
    ["listings", "retailers"]
  );
  assert.deepEqual(
    manifest.retailerQualificationRole.sharedCatalogMutationTableNames,
    ["listings", "retailers"]
  );
  assert.equal(manifest.operationCount, 3);
  assert.equal(manifest.supportedRetailerCount, 3);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.retailerQualificationScopeConsumed, true);
  assert.equal(manifest.settingsScopeConsumed, true);
  assert.equal(manifest.globalRetailerSerialization, true);
  assert.equal(manifest.exactPackagedRetailerAllowlist, true);
  assert.equal(manifest.monotonicSharedCatalogPromotion, true);
  assert.equal(manifest.currentEvidenceRevalidation, true);
  assert.equal(manifest.currentDeviceCapabilityRevalidation, true);
  assert.equal(manifest.currentSettingsRevalidation, true);
  assert.equal(manifest.nonTargetQualificationWriterParity, true);
  assert.equal(manifest.nonTargetJobPromotionParity, true);
  assert.equal(manifest.sharedCatalogExecutionWriterParity, true);
  assert.equal(manifest.qualificationSettingsWriterParity, true);
  assert.equal(manifest.sourceTrustWriterParity, true);
  assert.equal(manifest.sourceWriterParity, false);
  assert.equal(manifest.retailerQualificationWriterParity, true);
  assert.equal(manifest.configurationWriterParity, false);
  assert.equal(manifest.reservationWriterParity, false);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalRetailerQualificationApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /activate_walmart_add/);
  assert.match(source, /activate_amazon_add/);
  assert.match(source, /activate_bestbuy_add/);
  assert.match(source, /yoink_lock_signal_action_constraints/);
  assert.match(source, /retailer_id_value, '', '01100'/);
  assert.match(source, /yoink_shared_retailer_execution_v1/);
  assert.match(source, /walmart-add-qualification-evidence-v1/);
  assert.match(source, /amazon-add-qualification-evidence-v1/);
  assert.match(source, /bestbuy-add-qualification-evidence-v1/);
  assert.match(source, /UPDATE .*"retailers"/s);
  assert.match(source, /UPDATE .*"listings"/s);
  assert.match(source, /execution_supported = 1/);
  assert.doesNotMatch(source, /SET\s+execution_supported\s*=\s*0/i);
  assert.match(source, /INSERT INTO .*"retailer_adapter_qualifications"/s);
  assert.match(source, /UPDATE .*"action_jobs"/s);
  assert.match(source, /INSERT INTO .*"action_events"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:source_connections|missions|mission_targets|mission_intent_revisions|strategies|spend_reservations|spend_ledger_entries|inbox_messages)"/
  );

  const capability = postgresSignalRetailerQualificationCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.operationCount, 3);
  assert.equal(capability.supportedRetailerCount, 3);
  assert.equal(capability.protectedTenantTableCount, 9);
  assert.equal(capability.tenantMutationTableCount, 5);
  assert.equal(capability.protectedSharedCatalogTableCount, 2);
  assert.equal(capability.sharedCatalogMutationTableCount, 2);
  assert.equal(capability.totalMutationTableCount, 7);
  assert.equal(capability.retailerQualificationWriterParity, true);
  assert.equal(capability.sourceWriterParity, false);
  assert.equal(capability.sharedCatalogMutationAuthority, true);
  assert.equal(capability.retailerMutationAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalRetailerQualificationApplyManifest(
      manifest.predecessorManifest,
      manifest.predecessorManifest.sourceTrustRoleNamespace
    ),
    /independent/
  );
});

test("the generated non-Target qualification PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    const source = signalRetailerQualificationApplyFunctionSource(
      buildPostgresSignalRetailerQualificationApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_retailer_qualification_parse_probe(
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
