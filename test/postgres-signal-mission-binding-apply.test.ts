import assert from "node:assert/strict";
import test from "node:test";
import {
  POSTGRES_SIGNAL_MISSION_BINDING_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION,
  buildPostgresSignalMissionBindingApplyManifest,
  postgresSignalMissionBindingApplyCapabilityProjection,
  postgresSignalMissionBindingApplyPlanFingerprint,
  signalMissionBindingApplyFunctionSource,
  type PostgresSignalMissionBindingApplyPlan
} from "../packages/database/src/postgres-signal-mission-binding-apply.js";

test("the PostgreSQL signal mission-binding boundary is deterministic and least privilege", () => {
  const manifest = buildPostgresSignalMissionBindingApplyManifest();
  assert.deepEqual(buildPostgresSignalMissionBindingApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_MISSION_BINDING_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.postIncidentDecisionApplyContractVersion, 1);
  assert.equal(manifest.missionBindingApplyRole.kind, "signal_mission_binding_apply_boundary");
  assert.equal(manifest.missionBindingApplyRole.functionName, POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION);
  assert.equal(manifest.missionBindingApplyRole.login, false);
  assert.equal(manifest.missionBindingApplyRole.inherit, false);
  assert.equal(manifest.missionBindingApplyRole.bypassRls, false);
  assert.equal(manifest.missionBindingApplyRole.directTableAccess, false);
  assert.deepEqual(manifest.missionBindingApplyRole.protectedTenantTableNames, [
    "action_jobs",
    "app_settings",
    "audit_events",
    "inbox_messages",
    "mission_decisions",
    "mission_intent_revisions",
    "mission_targets",
    "missions",
    "offer_observations",
    "outbox_events",
    "resolution_decisions",
    "signal_events",
    "signal_incidents",
    "signal_occurrences",
    "source_connections",
    "source_listing_refs",
    "source_product_aliases",
    "source_product_refs"
  ]);
  assert.deepEqual(manifest.missionBindingApplyRole.mutationTableNames, [
    "audit_events",
    "mission_intent_revisions",
    "mission_targets",
    "missions",
    "outbox_events"
  ]);
  assert.equal(manifest.protectedTenantTableCount, 18);
  assert.equal(manifest.forcedRlsTableCount, 18);
  assert.equal(manifest.mutationTableCount, 5);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.maximumPlanAgeSeconds, 30);
  assert.equal(manifest.maximumVariantListings, 10_000);
  assert.equal(manifest.settledPostIncidentDecisionRequired, true);
  assert.equal(manifest.variantMissionSerialization, true);
  assert.equal(manifest.existingMissionBinding, true);
  assert.equal(manifest.trustedMissionCreation, true);
  assert.equal(manifest.exactVariantTargetAttachment, true);
  assert.equal(manifest.initialIntentPolicyCreation, true);
  assert.equal(manifest.appendOnlyPolicyRevision, true);
  assert.equal(manifest.missionQuantityParity, true);
  assert.equal(manifest.targetPolicyJsonParity, true);
  assert.equal(manifest.purchasePolicyHashParity, true);
  assert.equal(manifest.idempotentReplay, true);
  assert.equal(manifest.missionBindingRepositoryParity, true);
  assert.equal(manifest.sharedCatalogMutation, false);
  assert.equal(manifest.actionMutation, false);
  assert.equal(manifest.spendMutation, false);
  assert.equal(manifest.inboxLifecycleMutation, false);
  assert.equal(manifest.signalEvaluationApplyRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.mutationAuthority, true);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.postIncidentDecisionApplyManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalMissionBindingApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_apply_trackalacker_signal_post_incident_decision/);
  assert.match(source, /post-incident decision must settle before mission binding/);
  assert.match(source, /yoink_signal_mission_binding_variant_v1:/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /existing mission target graph is inconsistent with the exact variant/);
  assert.match(source, /postgres_signal_mission_binding_apply_plan_v1/);
  assert.match(source, /INSERT INTO .*"missions"/s);
  assert.match(source, /INSERT INTO .*"mission_targets"/s);
  assert.match(source, /INSERT INTO .*"mission_intent_revisions"/s);
  assert.match(source, /pg_catalog\.string_agg/);
  assert.match(source, /pg_catalog\.to_json\(target\.max_unit_price_cents\)::text/);
  assert.doesNotMatch(source, /jsonb_agg/);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:product_families|variants|listings|listing_urls|source_product_refs|source_listing_refs|source_product_aliases)"/
  );
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:signal_events|resolution_decisions|offer_observations|signal_incidents|signal_occurrences|mission_decisions|strategies|action_jobs|action_events|spend_reservations|spend_ledger_entries|inbox_messages)"/
  );
  assert.doesNotMatch(source, /DELETE\s+FROM|TRUNCATE\s+/i);

  const capability = postgresSignalMissionBindingApplyCapabilityProjection();
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.atomicQualificationApplyImplemented, true);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.immutableBoundaryCatalogFingerprint, true);
  assert.equal(capability.qualificationSuiteParity, true);
  assert.equal(capability.noLogin, true);
  assert.equal(capability.noInherit, true);
  assert.equal(capability.noBypassRls, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.twoPhasePlanApply, true);
  assert.equal(capability.readCommittedTransactionAdapter, true);
  assert.equal(capability.trustedMissionCreation, true);
  assert.equal(capability.initialIntentPolicyCreation, true);
  assert.equal(capability.missionQuantityParity, true);
  assert.equal(capability.targetPolicyJsonParity, true);
  assert.equal(capability.purchasePolicyHashParity, true);
  assert.equal(capability.protectedTenantTableCount, 18);
  assert.equal(capability.mutationTableCount, 5);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalMissionBindingApplyManifest(
      manifest.predecessorManifest,
      manifest.predecessorManifest.postIncidentDecisionApplyRoleNamespace
    ),
    /independent/
  );
});

test("the mission-binding plan fingerprint seals target and policy creation", () => {
  const plan: PostgresSignalMissionBindingApplyPlan = {
    contractVersion: 1,
    messageId: "inbox_00000000000000000000000000000001",
    payloadHash: "1".repeat(64),
    evaluatedAt: "2026-08-26T20:00:00.000Z",
    validUntil: "2026-08-26T20:00:30.000Z",
    eventId: "signal_event_00000000000000000000000000000001",
    resolutionDecisionId: "resolution_00000000000000000000000000000001",
    listingId: "listing_test",
    variantId: "variant_test",
    offerObservationId: "offer_observation_00000000000000000000000000000001",
    incidentId: "incident_00000000000000000000000000000001",
    semanticKey: "2".repeat(64),
    postIncidentDecisionOutcome: "continue_downstream",
    outcome: "apply_mission_binding",
    missionId: "",
    missionTargetId: "",
    policyRevisionId: "",
    missionCreationRequired: true,
    targetInsertCount: 2,
    initialPolicyRequired: true,
    policyQuantity: 1,
    variantListingCount: 2,
    missionAction: "insert",
    missionTargetAction: "insert",
    policyRevisionAction: "insert",
    missionAuditAction: "insert",
    missionOutboxAction: "insert",
    policyAuditAction: "insert",
    policyOutboxAction: "insert",
    mutationStatementCount: 8,
    mutationRowCount: 8,
    missionBindingApplyWillApply: true,
    sharedCatalogMutation: false,
    incidentMutation: false,
    terminalDecisionMutation: false,
    actionMutation: false,
    spendMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    planFingerprint: ""
  };
  const principal = { tenantId: "tenant_test", userId: "user_test" };
  const first = postgresSignalMissionBindingApplyPlanFingerprint(principal, plan);
  assert.equal(first, postgresSignalMissionBindingApplyPlanFingerprint(principal, plan));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(
    postgresSignalMissionBindingApplyPlanFingerprint(
      { ...principal, userId: "user_other" },
      plan
    ),
    first
  );
  assert.notEqual(
    postgresSignalMissionBindingApplyPlanFingerprint(
      principal,
      { ...plan, targetInsertCount: 1, mutationStatementCount: 7, mutationRowCount: 7 }
    ),
    first
  );
  assert.notEqual(
    postgresSignalMissionBindingApplyPlanFingerprint(
      principal,
      { ...plan, policyQuantity: 2 }
    ),
    first
  );
  assert.notEqual(
    postgresSignalMissionBindingApplyPlanFingerprint(
      principal,
      {
        ...plan,
        outcome: "already_bound",
        missionId: "mission_test",
        missionTargetId: "mission_target_test",
        policyRevisionId: "intent_revision_test",
        missionCreationRequired: false,
        targetInsertCount: 0,
        initialPolicyRequired: false,
        missionAction: "none",
        missionTargetAction: "none",
        policyRevisionAction: "none",
        missionAuditAction: "none",
        missionOutboxAction: "none",
        policyAuditAction: "none",
        policyOutboxAction: "none",
        mutationStatementCount: 0,
        mutationRowCount: 0,
        missionBindingApplyWillApply: false
      }
    ),
    first
  );
});
