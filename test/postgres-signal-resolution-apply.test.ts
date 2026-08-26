import assert from "node:assert/strict";
import test from "node:test";
import {
  POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION,
  buildPostgresSignalResolutionApplyManifest,
  postgresSignalResolutionApplyCapabilityProjection,
  postgresSignalResolutionApplyPlanFingerprint,
  signalResolutionApplyFunctionSource,
  type PostgresSignalResolutionApplyPlan
} from "../packages/database/src/postgres-signal-resolution-apply.js";

test("the PostgreSQL event-and-resolution apply boundary is deterministic and remains bounded", () => {
  const manifest = buildPostgresSignalResolutionApplyManifest();
  assert.deepEqual(buildPostgresSignalResolutionApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, 3);
  assert.equal(manifest.hostedDeliveryContractVersion, 3);
  assert.equal(manifest.catalogApplyContractVersion, 1);
  assert.equal(manifest.resolutionApplyRole.kind, "signal_event_resolution_apply_boundary");
  assert.equal(manifest.resolutionApplyRole.functionName, POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION);
  assert.equal(manifest.resolutionApplyRole.login, false);
  assert.equal(manifest.resolutionApplyRole.inherit, false);
  assert.equal(manifest.resolutionApplyRole.bypassRls, false);
  assert.equal(manifest.resolutionApplyRole.directTableAccess, false);
  assert.deepEqual(manifest.resolutionApplyRole.protectedTenantTableNames, [
    "inbox_messages",
    "resolution_decisions",
    "signal_events",
    "source_connections"
  ]);
  assert.deepEqual(manifest.resolutionApplyRole.mutationTableNames, [
    "resolution_decisions",
    "signal_events",
    "source_connections"
  ]);
  assert.equal(manifest.protectedTenantTableCount, 4);
  assert.equal(manifest.forcedRlsTableCount, 4);
  assert.equal(manifest.mutationTableCount, 3);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.maximumPlanAgeSeconds, 30);
  assert.equal(manifest.serverBoundPrincipalLookup, true);
  assert.equal(manifest.databasePlanRevalidation, true);
  assert.equal(manifest.transportDuplicateRepositoryParity, true);
  assert.equal(manifest.signalEventInsertRepositoryParity, true);
  assert.equal(manifest.sourceConnectionHeartbeatRepositoryParity, true);
  assert.equal(manifest.resolutionDecisionInsertRepositoryParity, true);
  assert.equal(manifest.sharedCatalogMutationFailClosed, true);
  assert.equal(manifest.sourceReferenceRefreshRepositoryParity, false);
  assert.equal(manifest.downstreamSignalGraphMutation, false);
  assert.equal(manifest.inboxLifecycleMutation, false);
  assert.equal(manifest.rawSignalPayloadReturned, false);
  assert.equal(manifest.signalEvaluationApplyRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.mutationAuthority, true);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.catalogApplyManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalResolutionApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_plan_trackalacker_signal_resolution/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /postgres_signal_resolution_apply_plan_v1/);
  assert.match(source, /operation_name NOT IN \('plan', 'apply'\)/);
  assert.match(source, /requires the separately qualified catalog-create boundary first/);
  assert.match(source, /INSERT INTO .*"signal_events"/s);
  assert.match(source, /UPDATE .*"source_connections"/s);
  assert.match(source, /INSERT INTO .*"resolution_decisions"/s);
  assert.match(source, /'resolver-v1'/);
  assert.doesNotMatch(
    source,
    /INSERT INTO .*"(?:product_families|variants|listings|listing_urls|source_product_refs|source_listing_refs|source_product_aliases)"/s
  );
  assert.doesNotMatch(
    source,
    /INSERT INTO .*"(?:signal_occurrences|signal_incidents|offer_observations|mission_decisions|missions|mission_targets|action_jobs|notifications|outbox_events)"/s
  );
  assert.doesNotMatch(source, /UPDATE .*"inbox_messages"/s);
  assert.doesNotMatch(source, /DELETE\s+FROM|TRUNCATE\s+/i);

  const capability = postgresSignalResolutionApplyCapabilityProjection();
  assert.equal(capability.contractVersion, 1);
  assert.equal(capability.catalogApplyContractVersion, 1);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.atomicQualificationApplyImplemented, true);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.immutableBoundaryCatalogFingerprint, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.twoPhasePlanApply, true);
  assert.equal(capability.readCommittedTransactionAdapter, true);
  assert.equal(capability.transportDuplicateRepositoryParity, true);
  assert.equal(capability.signalEventInsertRepositoryParity, true);
  assert.equal(capability.sourceConnectionHeartbeatRepositoryParity, true);
  assert.equal(capability.resolutionDecisionInsertRepositoryParity, true);
  assert.equal(capability.sharedCatalogMutationFailClosed, true);
  assert.equal(capability.sourceReferenceRefreshRepositoryParity, false);
  assert.equal(capability.downstreamSignalGraphMutation, false);
  assert.equal(capability.inboxLifecycleMutation, false);
  assert.equal(capability.rawSignalPayloadReturned, false);
  assert.equal(capability.signalEvaluationApplyRepositoryParity, false);
  assert.equal(capability.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(capability.protectedTenantTableCount, 4);
  assert.equal(capability.mutationTableCount, 3);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalResolutionApplyManifest(
      "yoink_qualification",
      "same_namespace",
      "same_namespace"
    ),
    /independent/
  );
});

test("the event-and-resolution plan fingerprint binds the principal and every mutation claim", () => {
  const plan: PostgresSignalResolutionApplyPlan = {
    contractVersion: 1,
    messageId: "inbox_00000000000000000000000000000001",
    payloadHash: "1".repeat(64),
    evaluatedAt: "2026-08-26T12:00:00.000Z",
    validUntil: "2026-08-26T12:00:30.000Z",
    sourceConnectionId: "source_connection_test",
    signalId: "signal-test",
    externalEventId: "external-test",
    transportHash: "2".repeat(64),
    outcome: "matched",
    duplicateEventId: "",
    resolutionStatus: "matched",
    resolutionMethod: "retailer_sku",
    resolutionReason: "Matched the exact retailer and SKU.",
    listingId: "listing_test",
    variantId: "variant_test",
    eventWillCreate: true,
    resolutionWillCreate: true,
    sourceHeartbeatWillUpdate: true,
    sharedCatalogMutationRequired: false,
    rawSignalPayloadReturned: false,
    planFingerprint: ""
  };
  const principal = { tenantId: "tenant_test", userId: "user_test" };
  const first = postgresSignalResolutionApplyPlanFingerprint(principal, plan);
  const second = postgresSignalResolutionApplyPlanFingerprint(principal, plan);
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(
    postgresSignalResolutionApplyPlanFingerprint({ ...principal, userId: "user_other" }, plan),
    first
  );
  assert.notEqual(
    postgresSignalResolutionApplyPlanFingerprint(
      principal,
      { ...plan, sourceHeartbeatWillUpdate: false }
    ),
    first
  );
});
