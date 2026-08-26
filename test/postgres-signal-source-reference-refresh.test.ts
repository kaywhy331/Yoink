import assert from "node:assert/strict";
import test from "node:test";
import {
  POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION,
  POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION,
  buildPostgresSignalSourceReferenceRefreshManifest,
  postgresSignalSourceReferenceRefreshCapabilityProjection,
  postgresSignalSourceReferenceRefreshPlanFingerprint,
  signalSourceReferenceRefreshFunctionSource,
  type PostgresSignalSourceReferenceRefreshPlan
} from "../packages/database/src/postgres-signal-source-reference-refresh.js";

test("the PostgreSQL known-product source-reference boundary is deterministic and bounded", () => {
  const manifest = buildPostgresSignalSourceReferenceRefreshManifest();
  assert.deepEqual(buildPostgresSignalSourceReferenceRefreshManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, 3);
  assert.equal(manifest.hostedDeliveryContractVersion, 3);
  assert.equal(manifest.catalogApplyContractVersion, 1);
  assert.equal(manifest.resolutionApplyContractVersion, 1);
  assert.equal(manifest.sourceReferenceRefreshRole.kind, "signal_source_reference_refresh_boundary");
  assert.equal(
    manifest.sourceReferenceRefreshRole.functionName,
    POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION
  );
  assert.equal(manifest.sourceReferenceRefreshRole.login, false);
  assert.equal(manifest.sourceReferenceRefreshRole.inherit, false);
  assert.equal(manifest.sourceReferenceRefreshRole.bypassRls, false);
  assert.equal(manifest.sourceReferenceRefreshRole.directTableAccess, false);
  assert.deepEqual(manifest.sourceReferenceRefreshRole.protectedTenantTableNames, [
    "inbox_messages",
    "resolution_decisions",
    "signal_events",
    "source_connections",
    "source_listing_refs",
    "source_product_aliases",
    "source_product_refs"
  ]);
  assert.deepEqual(manifest.sourceReferenceRefreshRole.mutationTableNames, [
    "source_listing_refs",
    "source_product_aliases",
    "source_product_refs"
  ]);
  assert.equal(manifest.protectedTenantTableCount, 7);
  assert.equal(manifest.forcedRlsTableCount, 7);
  assert.equal(manifest.mutationTableCount, 3);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.maximumPlanAgeSeconds, 30);
  assert.equal(manifest.serverBoundPrincipalLookup, true);
  assert.equal(manifest.databasePlanRevalidation, true);
  assert.equal(manifest.committedResolutionBinding, true);
  assert.equal(manifest.matchedResolutionRequired, true);
  assert.equal(manifest.testSignalMutation, false);
  assert.equal(manifest.conflictingReferenceFailClosed, true);
  assert.equal(manifest.idempotentReplay, true);
  assert.equal(manifest.sourceProductReferenceRepositoryParity, true);
  assert.equal(manifest.sourceListingReferenceRepositoryParity, true);
  assert.equal(manifest.sourceProductAliasRepositoryParity, true);
  assert.equal(manifest.sharedCatalogMutation, false);
  assert.equal(manifest.sourceReferenceRefreshRepositoryParity, true);
  assert.equal(manifest.downstreamSignalGraphMutation, false);
  assert.equal(manifest.inboxLifecycleMutation, false);
  assert.equal(manifest.rawSignalPayloadReturned, false);
  assert.equal(manifest.signalEvaluationApplyRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.mutationAuthority, true);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.resolutionApplyManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const functionSource = signalSourceReferenceRefreshFunctionSource(manifest);
  assert.match(functionSource, /principal\.principal_role = session_user::text/);
  assert.match(functionSource, /yoink_plan_trackalacker_signal_resolution/);
  assert.match(functionSource, /signal event and resolution must commit/);
  assert.match(functionSource, /FOR UPDATE/);
  assert.match(functionSource, /FOR SHARE/);
  assert.match(functionSource, /pg_advisory_xact_lock/);
  assert.match(functionSource, /postgres_signal_source_reference_refresh_plan_v1/);
  assert.match(functionSource, /operation_name NOT IN \('plan', 'apply'\)/);
  assert.match(functionSource, /INSERT INTO .*"source_product_refs"/s);
  assert.match(functionSource, /INSERT INTO .*"source_listing_refs"/s);
  assert.match(functionSource, /INSERT INTO .*"source_product_aliases"/s);
  assert.match(functionSource, /UPDATE .*"source_product_refs"/s);
  assert.match(functionSource, /UPDATE .*"source_listing_refs"/s);
  assert.match(functionSource, /UPDATE .*"source_product_aliases"/s);
  assert.doesNotMatch(
    functionSource,
    /(?:INSERT INTO|UPDATE|DELETE FROM) .*"(?:product_families|variants|listings|listing_urls|source_variant_retailer_refs)"/s
  );
  assert.doesNotMatch(
    functionSource,
    /(?:INSERT INTO|UPDATE|DELETE FROM) .*"(?:signal_events|resolution_decisions|source_connections|signal_occurrences|signal_incidents|offer_observations|mission_decisions|missions|mission_targets|action_jobs|notifications|outbox_events|inbox_messages)"/s
  );
  assert.doesNotMatch(functionSource, /DELETE\s+FROM|TRUNCATE\s+/i);

  const capability = postgresSignalSourceReferenceRefreshCapabilityProjection();
  assert.equal(capability.contractVersion, 1);
  assert.equal(capability.catalogApplyContractVersion, 1);
  assert.equal(capability.resolutionApplyContractVersion, 1);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.atomicQualificationApplyImplemented, true);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.immutableBoundaryCatalogFingerprint, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.twoPhasePlanApply, true);
  assert.equal(capability.readCommittedTransactionAdapter, true);
  assert.equal(capability.committedResolutionBinding, true);
  assert.equal(capability.matchedResolutionRequired, true);
  assert.equal(capability.testSignalMutation, false);
  assert.equal(capability.conflictingReferenceFailClosed, true);
  assert.equal(capability.idempotentReplay, true);
  assert.equal(capability.sourceProductReferenceRepositoryParity, true);
  assert.equal(capability.sourceListingReferenceRepositoryParity, true);
  assert.equal(capability.sourceProductAliasRepositoryParity, true);
  assert.equal(capability.sharedCatalogMutation, false);
  assert.equal(capability.sourceReferenceRefreshRepositoryParity, true);
  assert.equal(capability.downstreamSignalGraphMutation, false);
  assert.equal(capability.inboxLifecycleMutation, false);
  assert.equal(capability.rawSignalPayloadReturned, false);
  assert.equal(capability.signalEvaluationApplyRepositoryParity, false);
  assert.equal(capability.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(capability.protectedTenantTableCount, 7);
  assert.equal(capability.mutationTableCount, 3);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalSourceReferenceRefreshManifest(
      "yoink_qualification",
      "same_namespace",
      "same_namespace"
    ),
    /independent/
  );
});

test("the source-reference plan fingerprint binds the principal and every mutation claim", () => {
  const plan: PostgresSignalSourceReferenceRefreshPlan = {
    contractVersion: 1,
    messageId: "inbox_00000000000000000000000000000001",
    payloadHash: "1".repeat(64),
    evaluatedAt: "2026-08-26T12:00:00.000Z",
    validUntil: "2026-08-26T12:00:30.000Z",
    eventId: "signal_event_00000000000000000000000000000001",
    resolutionDecisionId: "resolution_00000000000000000000000000000001",
    resolutionStatus: "matched",
    listingId: "listing_test",
    variantId: "variant_test",
    referenceIdentityHash: "2".repeat(64),
    outcome: "refresh",
    sourceProductAction: "insert",
    sourceListingAction: "update",
    sourceAliasAction: "none",
    mutationStatementCount: 2,
    sourceReferenceRefreshWillApply: true,
    sharedCatalogMutation: false,
    rawSignalPayloadReturned: false,
    planFingerprint: ""
  };
  const principal = { tenantId: "tenant_test", userId: "user_test" };
  const first = postgresSignalSourceReferenceRefreshPlanFingerprint(principal, plan);
  const second = postgresSignalSourceReferenceRefreshPlanFingerprint(principal, plan);
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(
    postgresSignalSourceReferenceRefreshPlanFingerprint(
      { ...principal, userId: "user_other" },
      plan
    ),
    first
  );
  assert.notEqual(
    postgresSignalSourceReferenceRefreshPlanFingerprint(
      principal,
      { ...plan, sourceAliasAction: "insert", mutationStatementCount: 3 }
    ),
    first
  );
});
