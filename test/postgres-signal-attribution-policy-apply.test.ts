import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { AttributionPolicyUpdateInput } from "../packages/contracts/src/index.js";
import { buildPostgresSignalCatalogImportApplyManifest } from "../packages/database/src/postgres-signal-catalog-import-apply.js";
import {
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION,
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS,
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS,
  PostgresSignalAttributionPolicyApplyQualificationError,
  buildPostgresSignalAttributionPolicyApplyManifest,
  buildPostgresSignalAttributionPolicyReplaceRequestId,
  normalizedPostgresSignalAttributionPolicyReplacePayload,
  postgresSignalAttributionPolicyCapabilityProjection,
  signalAttributionPolicyApplyFunctionSource
} from "../packages/database/src/postgres-signal-attribution-policy-apply.js";
import { buildPostgresSignalSourceProvisioningApplyManifest } from "../packages/database/src/postgres-signal-source-provisioning-apply.js";

const principal = { tenantId: "tenant_test", userId: "user_test" };

function inputFor(retailerId: string, overrides: Partial<AttributionPolicyUpdateInput> = {}): AttributionPolicyUpdateInput {
  return {
    retailerId,
    enabled: false,
    provider: "canonical",
    publisherSlug: "",
    articleBaseUrl: "",
    associateTag: "",
    ...overrides
  };
}

function baselineInputs(overrides: Record<string, Partial<AttributionPolicyUpdateInput>> = {}): AttributionPolicyUpdateInput[] {
  // Deliberately submitted out of the canonical alphabetical order and
  // reversed, to prove normalization (not caller order) drives the payload.
  return [...POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS].reverse()
    .map((retailerId) => inputFor(retailerId, overrides[retailerId]));
}

test("the attribution-policy writer is deterministic, complete-set-bounded, zero-write-safe, and inactive", () => {
  const manifest = buildPostgresSignalAttributionPolicyApplyManifest();
  assert.deepEqual(buildPostgresSignalAttributionPolicyApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.sourceProvisioningApplyContractVersion, 1);
  assert.equal(manifest.attributionPolicyRole.kind, "signal_attribution_policy_apply_boundary");
  assert.equal(manifest.attributionPolicyRole.functionName, POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION);
  assert.equal(manifest.attributionPolicyRole.login, false);
  assert.equal(manifest.attributionPolicyRole.inherit, false);
  assert.equal(manifest.attributionPolicyRole.bypassRls, false);
  assert.equal(manifest.attributionPolicyRole.directTableAccess, false);
  assert.deepEqual(manifest.attributionPolicyRole.protectedTenantTableNames, [
    "attribution_policies", "audit_events", "outbox_events"
  ]);
  assert.deepEqual(
    manifest.attributionPolicyRole.mutationTableNames,
    manifest.attributionPolicyRole.protectedTenantTableNames
  );
  assert.equal(manifest.operationCount, 1);
  assert.equal(manifest.supportedRetailerCount, 20);
  assert.deepEqual(manifest.supportedRetailers, POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS);
  assert.deepEqual([...manifest.supportedRetailers], [...manifest.supportedRetailers].sort());
  assert.deepEqual(manifest.providerAllowlist, ["canonical", "howl", "amazon_associates"]);
  assert.equal(manifest.protectedTenantTableCount, 3);
  assert.equal(manifest.forcedRlsTableCount, 3);
  assert.equal(manifest.mutationTableCount, 3);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);

  // This boundary is the 22nd of the signal-writer family. Its immediate
  // predecessor link (source-provisioning-apply, the 21st) is verified by
  // fingerprint/namespace identity; source-provisioning-apply's own link
  // back to catalog-import-apply (the 20th) is verified the same way, one
  // hop further, demonstrating the chain is genuinely load-bearing rather
  // than a disconnected copy.
  const sourceProvisioningManifest = buildPostgresSignalSourceProvisioningApplyManifest();
  assert.equal(manifest.sourceProvisioningApplyManifestFingerprint, sourceProvisioningManifest.fingerprint);
  assert.equal(manifest.predecessorManifest.fingerprint, sourceProvisioningManifest.fingerprint);
  assert.equal(manifest.predecessorManifest.schemaName, sourceProvisioningManifest.schemaName);
  assert.equal(
    manifest.predecessorManifest.sourceProvisioningRoleNamespace,
    sourceProvisioningManifest.sourceProvisioningRoleNamespace
  );
  const catalogImportManifest = buildPostgresSignalCatalogImportApplyManifest();
  assert.equal(
    sourceProvisioningManifest.catalogImportApplyManifestFingerprint,
    catalogImportManifest.fingerprint
  );
  assert.equal(
    sourceProvisioningManifest.predecessorManifest.catalogImportRoleNamespace,
    catalogImportManifest.catalogImportRoleNamespace
  );
  assert.notEqual(manifest.attributionPolicyRoleNamespace, sourceProvisioningManifest.sourceProvisioningRoleNamespace);

  assert.equal(manifest.serverBoundPrincipalLookup, true);
  assert.equal(manifest.provisionedRowExistenceRequired, true);
  assert.equal(manifest.completeRetailerSetRequired, true);
  assert.equal(manifest.fixedRetailerOrderNormalization, true);
  assert.equal(manifest.rowLevelLockSerialization, true);
  // `attribution_policies` is not one of the five domains the shared
  // writer-lock protocol guards (source, retailer_qualification, settings,
  // mission_policy, spend) — see postgres-signal-writer-lock-protocol.ts's
  // PROTECTED_TENANT_TABLES. This boundary therefore joins the eight prior
  // boundaries that never call it, serializing instead with its own
  // `SELECT ... FOR UPDATE ORDER BY retailer_id` (asserted in the generated
  // source below).
  assert.equal(manifest.writerLockProtocolConsumed, false);
  assert.equal(manifest.deterministicRequestIdentity, true);
  assert.equal(manifest.immutableAuditedReplay, true);
  assert.equal(manifest.zeroWriteWhenUnchanged, true);
  assert.equal(manifest.missingRowFailsClosed, true);
  assert.equal(manifest.atomicReplaceAuditOutbox, true);
  assert.equal(manifest.databaseOwnedTimestamps, true);
  assert.equal(manifest.sqliteValidationParity, true);

  // World-state carried forward unchanged from source-provisioning-apply
  // (v0.95), plus this boundary's own new closure.
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
  // Closes `attributionPolicyParity`, previously declared false in
  // postgres-signal-action-spend-apply.ts.
  assert.equal(manifest.attributionPolicyParity, true);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalAttributionPolicyApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /replace_attribution_policies/);
  assert.match(source, /ATTRIBUTION_POLICY_REPLACE_V1/);
  assert.match(source, /jsonb_array_length\(request_payload->'policies'\) <> 20/);
  assert.match(source, /NOT IN \('canonical', 'howl', 'amazon_associates'\)/);
  assert.match(source, /fixed_retailers\[entry\.ordinality::int\]/);
  assert.match(source, /FOR UPDATE OF policy/);
  assert.match(source, /ORDER BY policy\.retailer_id/);
  assert.match(source, /jsonb_to_recordset/);
  assert.match(source, /existing_count <> 20/);
  assert.match(source, /signal attribution-policy rows are not fully provisioned/);
  assert.match(source, /signal attribution-policy replay graph changed/);
  assert.match(source, /signal attribution-policy enabled policy fails validity/);
  assert.match(source, /UPDATE .*"attribution_policies"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  // Never calls the shared writer-lock protocol function, and never
  // touches a table outside its own three-table mutation boundary.
  assert.doesNotMatch(source, /yoink_lock_signal_action_constraints/);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:source_connections|retailer_adapter_qualifications|missions|mission_targets|mission_intent_revisions|app_settings|user_spend_policies|spend_reservations|spend_ledger_entries|action_jobs|inbox_messages|retailers)"/
  );

  const requestId = buildPostgresSignalAttributionPolicyReplaceRequestId(
    principal,
    normalizedPostgresSignalAttributionPolicyReplacePayload(baselineInputs())
  );
  assert.match(requestId, /^attribution_policy_replace_[a-f0-9]{32}$/);
  const payload = normalizedPostgresSignalAttributionPolicyReplacePayload(baselineInputs());
  assert.equal(buildPostgresSignalAttributionPolicyReplaceRequestId(principal, payload), requestId);
  assert.notEqual(
    buildPostgresSignalAttributionPolicyReplaceRequestId({ ...principal, userId: "user_other" }, payload),
    requestId
  );
  assert.notEqual(
    buildPostgresSignalAttributionPolicyReplaceRequestId({ ...principal, tenantId: "tenant_other" }, payload),
    requestId
  );
  const changedPayload = normalizedPostgresSignalAttributionPolicyReplacePayload(
    baselineInputs({ amazon: { enabled: true, provider: "amazon_associates", associateTag: "abc-tag" } })
  );
  assert.notEqual(
    buildPostgresSignalAttributionPolicyReplaceRequestId(principal, changedPayload),
    requestId
  );

  const capability = postgresSignalAttributionPolicyCapabilityProjection();
  assert.deepEqual(capability, postgresSignalAttributionPolicyCapabilityProjection());
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, false);
  assert.equal(capability.provisionedRowExistenceRequired, true);
  assert.equal(capability.completeRetailerSetRequired, true);
  assert.equal(capability.rowLevelLockSerialization, true);
  assert.equal(capability.attributionPolicyParity, true);
  assert.equal(capability.writerLockProtocolParity, false);
  assert.equal(capability.sourceWriterParity, true);
  assert.equal(capability.retailerQualificationWriterParity, true);
  assert.equal(capability.missionPolicyWriterParity, true);
  assert.equal(capability.supportedRetailerCount, 20);
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
    () => buildPostgresSignalAttributionPolicyApplyManifest(
      manifest.predecessorManifest as never,
      manifest.predecessorManifest.sourceProvisioningRoleNamespace
    ),
    /independent/
  );
});

test("the attribution-policy payload normalizer mirrors AttributionRepository.replacePolicies", () => {
  const normalized = normalizedPostgresSignalAttributionPolicyReplacePayload(baselineInputs());
  assert.equal(normalized.confirmation, POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONFIRMATION);
  assert.equal(normalized.policies.length, 20);
  // Canonical alphabetical order, independent of the (reversed) input order.
  assert.deepEqual(normalized.policies.map((policy) => policy.retailerId), [
    ...POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS
  ]);
  for (const policy of normalized.policies) {
    assert.equal(policy.enabled, false);
    assert.equal(policy.provider, "canonical");
  }

  assert.throws(
    () => normalizedPostgresSignalAttributionPolicyReplacePayload(baselineInputs().slice(0, 12)),
    PostgresSignalAttributionPolicyApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalAttributionPolicyReplacePayload([
      inputFor("not_a_retailer"), ...baselineInputs().slice(1)
    ]),
    PostgresSignalAttributionPolicyApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalAttributionPolicyReplacePayload([
      inputFor("target"), ...baselineInputs().slice(1)
    ]),
    /must appear exactly once/
  );
  assert.throws(
    () => normalizedPostgresSignalAttributionPolicyReplacePayload(
      baselineInputs({ target: { enabled: true, provider: "howl", publisherSlug: "", articleBaseUrl: "" } })
    ),
    /Howl requires a valid publisher slug/
  );
  assert.throws(
    () => normalizedPostgresSignalAttributionPolicyReplacePayload(
      baselineInputs({ walmart: { enabled: true, provider: "amazon_associates", associateTag: "abc" } })
    ),
    /Amazon Associates routing is valid only for Amazon/
  );
  assert.throws(
    () => normalizedPostgresSignalAttributionPolicyReplacePayload(
      baselineInputs({
        bestbuy: {
          enabled: true,
          provider: "howl",
          publisherSlug: "collectwithdodo",
          articleBaseUrl: "https://example.com/blog/"
        }
      })
    ),
    /Howl is not available for this store/
  );

  // A disabled policy never enforces howl's slug/URL validity rule, so an
  // invalid (fragment-bearing) article base URL is a benign normalize-to-""
  // rather than a rejection — this isolates the slug/URL normalization
  // side-effects from the validity gate exercised above.
  const disabledHowl = normalizedPostgresSignalAttributionPolicyReplacePayload(
    baselineInputs({
      target: {
        enabled: false,
        provider: "howl",
        publisherSlug: "  CollectWithDodo  ",
        articleBaseUrl: "https://example.com/blog?ref=x#frag"
      }
    })
  );
  const disabledTargetPolicy = disabledHowl.policies.find((policy) => policy.retailerId === "target");
  assert.ok(disabledTargetPolicy);
  assert.equal(disabledTargetPolicy?.publisherSlug, "collectwithdodo");
  assert.equal(disabledTargetPolicy?.articleBaseUrl, "");

  // A genuinely valid enabled howl policy normalizes and passes.
  const validHowl = normalizedPostgresSignalAttributionPolicyReplacePayload(
    baselineInputs({
      target: {
        enabled: true,
        provider: "howl",
        publisherSlug: "CollectWithDodo",
        articleBaseUrl: "https://example.com/blog"
      }
    })
  );
  const validTargetPolicy = validHowl.policies.find((policy) => policy.retailerId === "target");
  assert.ok(validTargetPolicy);
  assert.equal(validTargetPolicy?.publisherSlug, "collectwithdodo");
  assert.equal(validTargetPolicy?.articleBaseUrl, "https://example.com/blog/");
});

test("the generated attribution-policy PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    await database.exec("SET search_path TO pg_catalog");
    const source = signalAttributionPolicyApplyFunctionSource(
      buildPostgresSignalAttributionPolicyApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_attribution_policy_parse_probe(
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
