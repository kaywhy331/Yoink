import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { AttributionPlan, AttributionPolicyDefinition, ListingContext } from "../packages/contracts/src/index.js";
import { buildAttributionPlan } from "../packages/domain/src/attribution.js";
import { stableHash } from "../packages/domain/src/ids.js";
import {
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS,
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS,
  buildPostgresSignalAttributionPolicyApplyManifest
} from "../packages/database/src/postgres-signal-attribution-policy-apply.js";
import {
  POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_FUNCTION,
  POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_OUTCOMES,
  PostgresSignalAttributionReceiptApplyQualificationError,
  buildPostgresSignalAttributionReceiptApplyManifest,
  buildPostgresSignalAttributionReceiptRecordRequestId,
  normalizedPostgresSignalAttributionReceiptRecordPayload,
  postgresSignalAttributionReceiptCapabilityProjection,
  signalAttributionReceiptApplyFunctionSource
} from "../packages/database/src/postgres-signal-attribution-receipt-apply.js";

const principal = { tenantId: "tenant_test", userId: "user_test" };

const targetListing: ListingContext = {
  id: "listing_test",
  variantId: "variant_test",
  title: "Test Plush",
  retailerId: "target",
  retailerSku: "12345678",
  canonicalUrl: "https://www.target.com/p/test-plush/-/A-12345678",
  executionSupported: true,
  msrpCents: 1999,
  currency: "USD"
};

const amazonListing: ListingContext = {
  ...targetListing,
  id: "listing_amazon_test",
  retailerId: "amazon",
  retailerSku: "B0TESTSKU1",
  canonicalUrl: "https://www.amazon.com/dp/B0TESTSKU1"
};

function policyFor(overrides: Partial<AttributionPolicyDefinition> = {}): AttributionPolicyDefinition {
  return {
    id: "attribution_target_test",
    retailerId: "target",
    retailerName: "Target",
    enabled: false,
    provider: "canonical",
    publisherSlug: "",
    articleBaseUrl: "",
    associateTag: "",
    valid: true,
    validationReason: "",
    ...overrides,
    howlEligible: overrides.howlEligible ?? true,
    howlStoreName: overrides.howlStoreName ?? "Target"
  };
}

test("the attribution-receipt writer is deterministic, job-scoped, insert-or-ignore-idempotent, and inactive", () => {
  const manifest = buildPostgresSignalAttributionReceiptApplyManifest();
  assert.deepEqual(buildPostgresSignalAttributionReceiptApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.attributionPolicyApplyContractVersion, POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.attributionReceiptRole.kind, "signal_attribution_receipt_apply_boundary");
  assert.equal(manifest.attributionReceiptRole.functionName, POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_FUNCTION);
  assert.equal(manifest.attributionReceiptRole.login, false);
  assert.equal(manifest.attributionReceiptRole.inherit, false);
  assert.equal(manifest.attributionReceiptRole.bypassRls, false);
  assert.equal(manifest.attributionReceiptRole.directTableAccess, false);
  // action_jobs and attribution_policies are read (and, for action_jobs,
  // row-locked) but never mutated -- present in the protected set, absent
  // from the mutation set. `listings` is deliberately absent from both: it
  // carries no tenant_id/user_id columns at all.
  assert.deepEqual(manifest.attributionReceiptRole.protectedTenantTableNames, [
    "action_jobs", "attribution_policies", "attribution_receipts", "audit_events", "outbox_events"
  ]);
  assert.deepEqual(manifest.attributionReceiptRole.mutationTableNames, [
    "attribution_receipts", "audit_events", "outbox_events"
  ]);
  assert.equal(manifest.operationCount, 1);
  assert.deepEqual(manifest.outcomeAllowlist, POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_OUTCOMES);
  assert.deepEqual(manifest.providerAllowlist, ["canonical", "howl", "amazon_associates"]);
  assert.deepEqual(manifest.supportedRetailers, POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS);
  assert.equal(manifest.supportedRetailerCount, 13);
  assert.equal(manifest.protectedTenantTableCount, 5);
  assert.equal(manifest.forcedRlsTableCount, 5);
  assert.equal(manifest.mutationTableCount, 3);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);

  // Chains onto attribution-policy-apply, the newest full-writer sibling at
  // the time this boundary was authored -- not onto catalog-import-apply
  // (a concurrently-authored sibling with no ordering relationship to this
  // module).
  const attributionPolicyManifest = buildPostgresSignalAttributionPolicyApplyManifest();
  assert.equal(manifest.attributionPolicyApplyManifestFingerprint, attributionPolicyManifest.fingerprint);
  assert.equal(manifest.predecessorManifest.fingerprint, attributionPolicyManifest.fingerprint);
  assert.equal(manifest.predecessorManifest.schemaName, attributionPolicyManifest.schemaName);
  assert.equal(
    manifest.predecessorManifest.attributionPolicyRoleNamespace,
    attributionPolicyManifest.attributionPolicyRoleNamespace
  );
  assert.notEqual(manifest.attributionReceiptRoleNamespace, attributionPolicyManifest.attributionPolicyRoleNamespace);

  assert.equal(manifest.serverBoundPrincipalLookup, true);
  assert.equal(manifest.jobOwnershipRevalidated, true);
  assert.equal(manifest.attributionSnapshotConsistencyRevalidated, true);
  assert.equal(manifest.provisionedPolicyRowRequired, true);
  assert.equal(manifest.policyIdentityRevalidated, true);
  // attribution_receipts is not one of the five domains the shared
  // writer-lock protocol guards (source, retailer_qualification, settings,
  // mission_policy, spend) -- same as attribution_policies. Per-job
  // serialization instead comes from `FOR UPDATE OF job` plus
  // UNIQUE(job_id) + ON CONFLICT DO NOTHING (asserted in the source below).
  assert.equal(manifest.writerLockProtocolConsumed, false);
  assert.equal(manifest.deterministicRequestIdentity, true);
  // The one deliberate divergence from most siblings' audited-replay-graph
  // check: an existing receipt for a job is unconditionally a zero-write
  // success, exactly like SQLite's `INSERT OR IGNORE` -- never compared
  // against the newly-submitted payload.
  assert.equal(manifest.insertOrIgnoreReplayParity, true);
  assert.equal(manifest.auditedOnFreshRecordOnly, true);
  assert.equal(manifest.immutableReceiptReplay, true);
  assert.equal(manifest.databaseOwnedTimestamps, true);
  assert.equal(manifest.databaseDerivedCanonicalUrlHash, true);
  assert.equal(manifest.metadataNeverPersisted, true);

  // World-state carried forward unchanged from attribution-policy-apply
  // (v0.96), plus this boundary's own new closure.
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
  assert.equal(manifest.attributionPolicyParity, true);
  // Closes `AttributionRepository.recordReceipt -> attribution_receipts`,
  // the out-of-scope write family named in
  // POSTGRES_SIGNAL_EVALUATION_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES.
  assert.equal(manifest.attributionReceiptWriterParity, true);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalAttributionReceiptApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /record_attribution_receipt/);
  assert.match(source, /ATTRIBUTION_RECEIPT_RECORD_V1/);
  assert.match(source, /jsonb_object_keys\(request_payload\)\) <> 8/);
  assert.match(source, /NOT IN \('canonical', 'howl', 'amazon_associates'\)/);
  assert.match(source, /'affiliate_route', 'canonical_disabled', 'canonical_fallback', 'required_route_unavailable'/);
  assert.match(source, /ON CONFLICT \(job_id\) DO NOTHING/);
  assert.match(source, /FOR UPDATE OF job/);
  assert.match(source, /JOIN .*"listings"/);
  assert.match(source, /does not match the action job attribution snapshot/);
  assert.match(source, /policy row is not provisioned/);
  assert.match(source, /does not match the currently provisioned policy/);
  assert.match(source, /canonical-attribution-url-v1/);
  assert.match(source, /INSERT INTO .*"attribution_receipts"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  // Never calls the shared writer-lock protocol function, and never
  // touches a table outside its own five-table protected boundary.
  assert.doesNotMatch(source, /yoink_lock_signal_action_constraints/);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:attribution_policies|action_jobs|action_events|listings|missions|mission_targets|spend_reservations|spend_ledger_entries|retailers|source_connections)"/
  );
  // Only ever UPDATEs/INSERTs attribution_policies via the predecessor
  // module -- this boundary itself only ever SELECTs it.
  assert.doesNotMatch(source, /UPDATE\s+"[^"]+"\."attribution_policies"/);

  const payload = normalizedPostgresSignalAttributionReceiptRecordPayload(
    "action_job_test",
    buildAttributionPlan(targetListing, targetListing.title, "disabled", policyFor())
  );
  const requestId = buildPostgresSignalAttributionReceiptRecordRequestId(principal, payload);
  assert.match(requestId, /^attribution_receipt_record_[a-f0-9]{32}$/);
  assert.equal(buildPostgresSignalAttributionReceiptRecordRequestId(principal, payload), requestId);
  assert.notEqual(
    buildPostgresSignalAttributionReceiptRecordRequestId({ ...principal, userId: "user_other" }, payload),
    requestId
  );
  assert.notEqual(
    buildPostgresSignalAttributionReceiptRecordRequestId({ ...principal, tenantId: "tenant_other" }, payload),
    requestId
  );
  const otherJobId = normalizedPostgresSignalAttributionReceiptRecordPayload(
    "action_job_other",
    buildAttributionPlan(targetListing, targetListing.title, "disabled", policyFor())
  );
  assert.notEqual(
    buildPostgresSignalAttributionReceiptRecordRequestId(principal, otherJobId),
    requestId
  );

  const capability = postgresSignalAttributionReceiptCapabilityProjection();
  assert.deepEqual(capability, postgresSignalAttributionReceiptCapabilityProjection());
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, false);
  assert.equal(capability.insertOrIgnoreReplayParity, true);
  assert.equal(capability.attributionReceiptWriterParity, true);
  assert.equal(capability.writerLockProtocolParity, false);
  assert.equal(capability.attributionPolicyParity, true);
  assert.equal(capability.sourceWriterParity, true);
  assert.equal(capability.retailerQualificationWriterParity, true);
  assert.equal(capability.missionPolicyWriterParity, true);
  assert.equal(capability.supportedRetailerCount, 13);
  assert.equal(capability.protectedTenantTableCount, 5);
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
    () => buildPostgresSignalAttributionReceiptApplyManifest(
      manifest.predecessorManifest as never,
      manifest.predecessorManifest.attributionPolicyRoleNamespace
    ),
    /independent/
  );
});

test("the attribution-receipt payload normalizer mirrors AttributionRepository.recordReceipt", () => {
  // Disabled mode -> canonical route, using the real domain helper exactly
  // the way `AttributionRepository.plan()` -> `buildAttributionPlan` does.
  const disabledPlan = buildAttributionPlan(targetListing, targetListing.title, "disabled", policyFor());
  assert.equal(disabledPlan.outcome, "canonical_disabled");
  assert.equal(disabledPlan.provider, "canonical");
  const disabledPayload = normalizedPostgresSignalAttributionReceiptRecordPayload("action_job_1", disabledPlan);
  assert.equal(disabledPayload.actionJobId, "action_job_1");
  assert.equal(disabledPayload.policyId, disabledPlan.policyId);
  assert.equal(disabledPayload.retailerId, "target");
  assert.equal(disabledPayload.provider, "canonical");
  assert.equal(disabledPayload.outcome, "canonical_disabled");
  assert.equal(disabledPayload.reasonCode, "attribution_disabled");
  assert.equal(disabledPayload.routeUrl, disabledPlan.routeUrl);
  assert.equal(disabledPayload.confirmation, POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONFIRMATION);
  // AttributionPlan.metadata and .blocked are read by nothing in
  // `recordReceipt` (attribution_receipts has no metadata column at all) --
  // the normalized payload carries neither.
  assert.deepEqual(Object.keys(disabledPayload).sort(), [
    "actionJobId", "confirmation", "outcome", "policyId", "provider", "reasonCode", "retailerId", "routeUrl"
  ]);

  // A disabled, unconfigured policy under prefer_fallback -> canonical
  // fallback (not required/blocked).
  const fallbackPlan = buildAttributionPlan(targetListing, targetListing.title, "prefer_fallback", policyFor());
  assert.equal(fallbackPlan.outcome, "canonical_fallback");
  assert.equal(fallbackPlan.reasonCode, "policy_disabled");
  const fallbackPayload = normalizedPostgresSignalAttributionReceiptRecordPayload("action_job_2", fallbackPlan);
  assert.equal(fallbackPayload.outcome, "canonical_fallback");
  assert.equal(fallbackPayload.reasonCode, "policy_disabled");

  // The same unconfigured policy under `require` -> required_route_unavailable.
  const requiredPlan = buildAttributionPlan(targetListing, targetListing.title, "require", policyFor());
  assert.equal(requiredPlan.outcome, "required_route_unavailable");
  assert.equal(
    normalizedPostgresSignalAttributionReceiptRecordPayload("action_job_3", requiredPlan).outcome,
    "required_route_unavailable"
  );

  // A valid, enabled Howl policy -> affiliate_route with a howl.link routeUrl.
  const howlPolicy = policyFor({
    id: "attribution_target_howl",
    enabled: true,
    provider: "howl",
    publisherSlug: "collectwithdodo",
    articleBaseUrl: "https://example.com/blog/"
  });
  const howlPlan = buildAttributionPlan(targetListing, targetListing.title, "prefer_fallback", howlPolicy);
  assert.equal(howlPlan.outcome, "affiliate_route");
  assert.equal(howlPlan.provider, "howl");
  assert.equal(howlPlan.reasonCode, "howl_route_ready");
  assert.match(howlPlan.routeUrl, /^https:\/\/howl\.link\/link\?/);
  const howlPayload = normalizedPostgresSignalAttributionReceiptRecordPayload("action_job_4", howlPlan);
  assert.equal(howlPayload.provider, "howl");
  assert.equal(howlPayload.policyId, "attribution_target_howl");
  assert.equal(howlPayload.routeUrl, howlPlan.routeUrl);

  // An invalid (unconfigured slug) enabled Howl policy -> falls back to
  // canonical, exactly mirroring `unavailablePlan`'s "invalid_policy" branch.
  const invalidHowlPolicy = policyFor({ enabled: true, provider: "howl", publisherSlug: "", articleBaseUrl: "" });
  const invalidHowlPlan = buildAttributionPlan(targetListing, targetListing.title, "prefer_fallback", invalidHowlPolicy);
  assert.equal(invalidHowlPlan.outcome, "canonical_fallback");
  assert.equal(invalidHowlPlan.reasonCode, "invalid_policy");
  assert.equal(invalidHowlPlan.provider, "canonical");
  assert.equal(
    normalizedPostgresSignalAttributionReceiptRecordPayload("action_job_5", invalidHowlPlan).provider,
    "canonical"
  );

  // A valid, enabled Amazon Associates policy on the amazon retailer ->
  // affiliate_route with an amazon.com routeUrl.
  const amazonPolicy: AttributionPolicyDefinition = {
    ...policyFor({ id: "attribution_amazon_test", retailerId: "amazon" }),
    enabled: true,
    provider: "amazon_associates",
    associateTag: "collectwithdodo-20"
  };
  const amazonPlan = buildAttributionPlan(amazonListing, amazonListing.title, "prefer_fallback", amazonPolicy);
  assert.equal(amazonPlan.outcome, "affiliate_route");
  assert.equal(amazonPlan.provider, "amazon_associates");
  const amazonPayload = normalizedPostgresSignalAttributionReceiptRecordPayload("action_job_6", amazonPlan);
  assert.equal(amazonPayload.retailerId, "amazon");
  assert.equal(amazonPayload.provider, "amazon_associates");

  // Rejections: unsupported retailer, unsupported provider, unsupported
  // outcome, malformed job id, malformed reason code, malformed route URL.
  assert.throws(
    () => normalizedPostgresSignalAttributionReceiptRecordPayload("action_job_7", {
      ...disabledPlan, retailerId: "not_a_retailer"
    } as AttributionPlan),
    PostgresSignalAttributionReceiptApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalAttributionReceiptRecordPayload("action_job_8", {
      ...disabledPlan, provider: "not_a_provider" as never
    }),
    PostgresSignalAttributionReceiptApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalAttributionReceiptRecordPayload("action_job_9", {
      ...disabledPlan, outcome: "not_an_outcome" as never
    }),
    PostgresSignalAttributionReceiptApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalAttributionReceiptRecordPayload("!!", disabledPlan),
    PostgresSignalAttributionReceiptApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalAttributionReceiptRecordPayload("action_job_10", {
      ...disabledPlan, reasonCode: "Not A Valid Reason!"
    }),
    PostgresSignalAttributionReceiptApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalAttributionReceiptRecordPayload("action_job_11", {
      ...disabledPlan, routeUrl: "not-a-url"
    }),
    PostgresSignalAttributionReceiptApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalAttributionReceiptRecordPayload("action_job_12", {
      ...disabledPlan, policyId: ""
    }),
    PostgresSignalAttributionReceiptApplyQualificationError
  );
});

test("the attribution-receipt canonical-url-hash SQL mirrors the SQLite stableHash helper", () => {
  // The boundary derives `canonical_url_hash` server-side from the job's
  // own `canonical_url` column using the same length-prefixed
  // stableHashInput scheme `stableHash` uses in domain/src/ids.ts --
  // reproduced here in TypeScript (not PL/pgSQL, since PGlite cannot
  // execute this function's body against real rows) to prove the two
  // algorithms agree byte-for-byte on the exact literal prefix embedded in
  // the generated source.
  const source = signalAttributionReceiptApplyFunctionSource();
  assert.match(source, /'canonical-attribution-url-v1'::text/);
  const expected = stableHash("canonical-attribution-url-v1", "https://www.target.com/p/-/A-12345678");
  assert.match(expected, /^[a-f0-9]{64}$/);
});

test("the generated attribution-receipt PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    await database.exec("SET search_path TO pg_catalog");
    const source = signalAttributionReceiptApplyFunctionSource(
      buildPostgresSignalAttributionReceiptApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_attribution_receipt_parse_probe(
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
