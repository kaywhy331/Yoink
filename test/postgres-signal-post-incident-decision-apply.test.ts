import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAN_DELETED_DECISION_OUTCOME,
  PLAN_DELETED_DECISION_REASON,
  PLAN_PAUSED_DECISION_OUTCOME,
  PLAN_PAUSED_DECISION_REASON
} from "../packages/domain/src/plan-status-decisions.js";
import {
  POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION,
  buildPostgresSignalPostIncidentDecisionApplyManifest,
  postgresSignalPostIncidentDecisionApplyCapabilityProjection,
  postgresSignalPostIncidentDecisionApplyPlanFingerprint,
  signalPostIncidentDecisionApplyFunctionSource,
  type PostgresSignalPostIncidentDecisionApplyPlan
} from "../packages/database/src/postgres-signal-post-incident-decision-apply.js";

test("the PostgreSQL post-incident decision boundary is deterministic and bounded", () => {
  const manifest = buildPostgresSignalPostIncidentDecisionApplyManifest();
  assert.deepEqual(buildPostgresSignalPostIncidentDecisionApplyManifest(), manifest);
  assert.equal(
    manifest.contractVersion,
    POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_CONTRACT_VERSION
  );
  assert.equal(manifest.cutoverContractVersion, 3);
  assert.equal(manifest.hostedDeliveryContractVersion, 3);
  assert.equal(manifest.catalogApplyContractVersion, 1);
  assert.equal(manifest.resolutionApplyContractVersion, 1);
  assert.equal(manifest.sourceReferenceRefreshContractVersion, 1);
  assert.equal(manifest.terminalDecisionApplyContractVersion, 1);
  assert.equal(manifest.offerIncidentApplyContractVersion, 1);
  assert.equal(
    manifest.postIncidentDecisionApplyRole.kind,
    "signal_post_incident_decision_apply_boundary"
  );
  assert.equal(
    manifest.postIncidentDecisionApplyRole.functionName,
    POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION
  );
  assert.equal(manifest.postIncidentDecisionApplyRole.login, false);
  assert.equal(manifest.postIncidentDecisionApplyRole.inherit, false);
  assert.equal(manifest.postIncidentDecisionApplyRole.bypassRls, false);
  assert.equal(manifest.postIncidentDecisionApplyRole.directTableAccess, false);
  assert.deepEqual(manifest.postIncidentDecisionApplyRole.protectedTenantTableNames, [
    "action_jobs",
    "app_settings",
    "audit_events",
    "inbox_messages",
    "mission_decisions",
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
  assert.deepEqual(manifest.postIncidentDecisionApplyRole.mutationTableNames, [
    "audit_events",
    "mission_decisions",
    "outbox_events"
  ]);
  assert.equal(manifest.protectedTenantTableCount, 17);
  assert.equal(manifest.forcedRlsTableCount, 17);
  assert.equal(manifest.mutationTableCount, 3);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.maximumPlanAgeSeconds, 30);
  assert.equal(manifest.serverBoundPrincipalLookup, true);
  assert.equal(manifest.databasePlanRevalidation, true);
  assert.equal(manifest.committedResolutionBinding, true);
  assert.equal(manifest.settledOfferIncidentRequired, true);
  assert.equal(manifest.incidentGraphBinding, true);
  assert.equal(manifest.existingJobCorroboration, true);
  assert.equal(manifest.noMissionFailClosed, true);
  assert.equal(manifest.inactivePlanFailClosed, true);
  assert.equal(manifest.trustedMissionContinuation, true);
  assert.equal(manifest.missionBindingRequiredProjection, true);
  assert.equal(manifest.idempotentReplay, true);
  assert.equal(manifest.postIncidentDecisionRepositoryParity, true);
  assert.equal(manifest.postIncidentAuditOutboxRepositoryParity, true);
  assert.equal(manifest.sharedCatalogMutation, false);
  assert.equal(manifest.sourceReferenceMutation, false);
  assert.equal(manifest.terminalDecisionMutation, false);
  assert.equal(manifest.offerIncidentMutation, false);
  assert.equal(manifest.incidentMutation, false);
  assert.equal(manifest.missionMutation, false);
  assert.equal(manifest.actionMutation, false);
  assert.equal(manifest.postIncidentDecisionGraphMutation, true);
  assert.equal(manifest.remainingMissionActionGraphMutation, false);
  assert.equal(manifest.inboxLifecycleMutation, false);
  assert.equal(manifest.rawSignalPayloadReturned, false);
  assert.equal(manifest.signalEvaluationApplyRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.mutationAuthority, true);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.offerIncidentApplyManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const functionSource = signalPostIncidentDecisionApplyFunctionSource(manifest);
  // Paused and deleted plans fail closed with the engine's exact reasons (C-01).
  assert.match(functionSource, /mission\.status AS mission_status/);
  assert.match(functionSource, /mission_context_status_value IN \('paused', 'deleted'\)/);
  assert.match(functionSource, /variant_mission_status_value IN \('paused', 'deleted'\)/);
  assert.match(functionSource, new RegExp(`'${PLAN_PAUSED_DECISION_OUTCOME}'`));
  assert.match(functionSource, new RegExp(`'${PLAN_DELETED_DECISION_OUTCOME}'`));
  assert.ok(functionSource.includes(`'${PLAN_PAUSED_DECISION_REASON}'`));
  assert.ok(functionSource.includes(`'${PLAN_DELETED_DECISION_REASON}'`));
  assert.match(functionSource, /principal\.principal_role = session_user::text/);
  assert.match(functionSource, /yoink_apply_trackalacker_signal_offer_incident/);
  assert.match(functionSource, /must settle before post-incident decision apply/);
  assert.match(functionSource, /yoink_signal_post_incident_decision_message_v1:/);
  assert.match(functionSource, /pg_advisory_xact_lock/);
  assert.match(functionSource, /FOR UPDATE/);
  assert.match(functionSource, /postgres_signal_post_incident_decision_apply_plan_v1/);
  assert.match(functionSource, /operation_name NOT IN \('plan', 'apply'\)/);
  assert.match(functionSource, /decision_outcome_value := 'corroborated'/);
  assert.match(functionSource, /decision_outcome_value := 'no_mission'/);
  assert.match(functionSource, /mission_binding_required_value := TRUE/);
  assert.match(functionSource, /mission_creation_required_value := variant_mission_count = 0/);
  assert.match(
    functionSource,
    /IF variant_mission_count = 1 THEN\s+mission_id_value := variant_mission_record\.mission_id;\s+ELSE\s+mission_id_value := '';\s+END IF;/s
  );
  assert.doesNotMatch(
    functionSource,
    /mission_id_value := CASE\s+WHEN variant_mission_count = 1 THEN variant_mission_record\.mission_id/s
  );
  assert.match(functionSource, /INSERT INTO .*"mission_decisions"/s);
  assert.match(functionSource, /INSERT INTO .*"audit_events"/s);
  assert.match(functionSource, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(
    functionSource,
    /(?:INSERT INTO|UPDATE|DELETE FROM) .*"(?:product_families|variants|listings|listing_urls|source_variant_retailer_refs|source_product_refs|source_listing_refs|source_product_aliases)"/s
  );
  assert.doesNotMatch(
    functionSource,
    /(?:INSERT INTO|UPDATE|DELETE FROM) .*"(?:signal_events|resolution_decisions|source_connections|offer_observations|signal_incidents|signal_occurrences|missions|mission_targets|strategies|action_jobs|notifications|inbox_messages)"/s
  );
  assert.doesNotMatch(functionSource, /DELETE\s+FROM|TRUNCATE\s+/i);

  const capability = postgresSignalPostIncidentDecisionApplyCapabilityProjection();
  assert.equal(capability.contractVersion, 1);
  assert.equal(capability.offerIncidentApplyContractVersion, 1);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.atomicQualificationApplyImplemented, true);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.immutableBoundaryCatalogFingerprint, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.twoPhasePlanApply, true);
  assert.equal(capability.readCommittedTransactionAdapter, true);
  assert.equal(capability.settledOfferIncidentRequired, true);
  assert.equal(capability.incidentGraphBinding, true);
  assert.equal(capability.existingJobCorroboration, true);
  assert.equal(capability.noMissionFailClosed, true);
  assert.equal(capability.inactivePlanFailClosed, true);
  assert.equal(capability.trustedMissionContinuation, true);
  assert.equal(capability.missionBindingRequiredProjection, true);
  assert.equal(capability.idempotentReplay, true);
  assert.equal(capability.postIncidentDecisionRepositoryParity, true);
  assert.equal(capability.postIncidentAuditOutboxRepositoryParity, true);
  assert.equal(capability.sharedCatalogMutation, false);
  assert.equal(capability.sourceReferenceMutation, false);
  assert.equal(capability.terminalDecisionMutation, false);
  assert.equal(capability.offerIncidentMutation, false);
  assert.equal(capability.incidentMutation, false);
  assert.equal(capability.missionMutation, false);
  assert.equal(capability.actionMutation, false);
  assert.equal(capability.postIncidentDecisionGraphMutation, true);
  assert.equal(capability.remainingMissionActionGraphMutation, false);
  assert.equal(capability.inboxLifecycleMutation, false);
  assert.equal(capability.rawSignalPayloadReturned, false);
  assert.equal(capability.signalEvaluationApplyRepositoryParity, false);
  assert.equal(capability.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(capability.protectedTenantTableCount, 17);
  assert.equal(capability.mutationTableCount, 3);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalPostIncidentDecisionApplyManifest(
      "yoink_qualification",
      "same_namespace",
      "same_namespace"
    ),
    /independent/
  );
});

test("the post-incident plan fingerprint binds decisions and mission projections", () => {
  const plan: PostgresSignalPostIncidentDecisionApplyPlan = {
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
    offerIncidentOutcome: "already_applied",
    outcome: "apply_post_incident_decision",
    decisionOutcome: "corroborated",
    missionId: "mission_test",
    actionJobId: "action_test",
    missionBindingRequired: false,
    missionCreationRequired: false,
    decisionReasonHash: "3".repeat(64),
    auditDataHash: "4".repeat(64),
    missionDecisionAction: "insert",
    auditAction: "insert",
    outboxAction: "insert",
    mutationStatementCount: 3,
    postIncidentDecisionApplyWillApply: true,
    sharedCatalogMutation: false,
    sourceReferenceMutation: false,
    terminalDecisionMutation: false,
    offerIncidentMutation: false,
    incidentMutation: false,
    missionMutation: false,
    actionMutation: false,
    rawSignalPayloadReturned: false,
    planFingerprint: ""
  };
  const principal = { tenantId: "tenant_test", userId: "user_test" };
  const first = postgresSignalPostIncidentDecisionApplyPlanFingerprint(principal, plan);
  assert.equal(first, postgresSignalPostIncidentDecisionApplyPlanFingerprint(principal, plan));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(
    postgresSignalPostIncidentDecisionApplyPlanFingerprint(
      { ...principal, userId: "user_other" },
      plan
    ),
    first
  );
  assert.notEqual(
    postgresSignalPostIncidentDecisionApplyPlanFingerprint(
      principal,
      { ...plan, actionJobId: "action_other" }
    ),
    first
  );
  assert.notEqual(
    postgresSignalPostIncidentDecisionApplyPlanFingerprint(
      principal,
      {
        ...plan,
        outcome: "continue_downstream",
        decisionOutcome: "",
        actionJobId: "",
        missionBindingRequired: true,
        missionDecisionAction: "none",
        auditAction: "none",
        outboxAction: "none",
        mutationStatementCount: 0,
        postIncidentDecisionApplyWillApply: false
      }
    ),
    first
  );
});
