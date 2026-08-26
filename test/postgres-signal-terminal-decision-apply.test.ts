import assert from "node:assert/strict";
import test from "node:test";
import {
  POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION,
  buildPostgresSignalTerminalDecisionApplyManifest,
  postgresSignalTerminalDecisionApplyCapabilityProjection,
  postgresSignalTerminalDecisionApplyPlanFingerprint,
  signalTerminalDecisionApplyFunctionSource,
  type PostgresSignalTerminalDecisionApplyPlan
} from "../packages/database/src/postgres-signal-terminal-decision-apply.js";

test("the PostgreSQL terminal signal-decision boundary is deterministic and bounded", () => {
  const manifest = buildPostgresSignalTerminalDecisionApplyManifest();
  assert.deepEqual(buildPostgresSignalTerminalDecisionApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, 3);
  assert.equal(manifest.hostedDeliveryContractVersion, 3);
  assert.equal(manifest.catalogApplyContractVersion, 1);
  assert.equal(manifest.resolutionApplyContractVersion, 1);
  assert.equal(manifest.sourceReferenceRefreshContractVersion, 1);
  assert.equal(manifest.terminalDecisionApplyRole.kind, "signal_terminal_decision_apply_boundary");
  assert.equal(
    manifest.terminalDecisionApplyRole.functionName,
    POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION
  );
  assert.equal(manifest.terminalDecisionApplyRole.login, false);
  assert.equal(manifest.terminalDecisionApplyRole.inherit, false);
  assert.equal(manifest.terminalDecisionApplyRole.bypassRls, false);
  assert.equal(manifest.terminalDecisionApplyRole.directTableAccess, false);
  assert.deepEqual(manifest.terminalDecisionApplyRole.protectedTenantTableNames, [
    "audit_events",
    "inbox_messages",
    "mission_decisions",
    "outbox_events",
    "resolution_decisions",
    "signal_events",
    "signal_occurrences",
    "source_connections",
    "source_listing_refs",
    "source_product_aliases",
    "source_product_refs"
  ]);
  assert.deepEqual(manifest.terminalDecisionApplyRole.mutationTableNames, [
    "audit_events",
    "mission_decisions",
    "outbox_events",
    "signal_occurrences"
  ]);
  assert.equal(manifest.protectedTenantTableCount, 11);
  assert.equal(manifest.forcedRlsTableCount, 11);
  assert.equal(manifest.mutationTableCount, 4);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.maximumPlanAgeSeconds, 30);
  assert.equal(manifest.serverBoundPrincipalLookup, true);
  assert.equal(manifest.databasePlanRevalidation, true);
  assert.equal(manifest.committedResolutionBinding, true);
  assert.equal(manifest.settledSourceReferenceRequired, true);
  assert.equal(manifest.terminalOutcomeDerivation, true);
  assert.equal(manifest.testSignalTerminalOnly, true);
  assert.equal(manifest.nonActionableTerminalOnly, true);
  assert.equal(manifest.idempotentReplay, true);
  assert.equal(manifest.signalOccurrenceRepositoryParity, true);
  assert.equal(manifest.terminalMissionDecisionRepositoryParity, true);
  assert.equal(manifest.terminalAuditOutboxRepositoryParity, true);
  assert.equal(manifest.sharedCatalogMutation, false);
  assert.equal(manifest.sourceReferenceMutation, false);
  assert.equal(manifest.incidentMutation, false);
  assert.equal(manifest.offerObservationMutation, false);
  assert.equal(manifest.missionMutation, false);
  assert.equal(manifest.actionMutation, false);
  assert.equal(manifest.terminalSignalEvaluationRepositoryParity, true);
  assert.equal(manifest.terminalSignalGraphMutation, true);
  assert.equal(manifest.remainingDownstreamSignalGraphMutation, false);
  assert.equal(manifest.inboxLifecycleMutation, false);
  assert.equal(manifest.rawSignalPayloadReturned, false);
  assert.equal(manifest.signalEvaluationApplyRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.mutationAuthority, true);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.sourceReferenceRefreshManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const functionSource = signalTerminalDecisionApplyFunctionSource(manifest);
  assert.match(functionSource, /principal\.principal_role = session_user::text/);
  assert.match(functionSource, /yoink_refresh_trackalacker_signal_source_references/);
  assert.match(functionSource, /source references must settle/);
  assert.match(functionSource, /yoink_signal_terminal_decision_apply_v1:/);
  assert.match(functionSource, /pg_advisory_xact_lock/);
  assert.match(functionSource, /FOR UPDATE/);
  assert.match(functionSource, /postgres_signal_terminal_decision_apply_plan_v1/);
  assert.match(functionSource, /operation_name NOT IN \('plan', 'apply'\)/);
  assert.match(functionSource, /INSERT INTO .*"signal_occurrences"/s);
  assert.match(functionSource, /INSERT INTO .*"mission_decisions"/s);
  assert.match(functionSource, /INSERT INTO .*"audit_events"/s);
  assert.match(functionSource, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(
    functionSource,
    /(?:INSERT INTO|UPDATE|DELETE FROM) .*"(?:product_families|variants|listings|listing_urls|source_variant_retailer_refs|source_product_refs|source_listing_refs|source_product_aliases)"/s
  );
  assert.doesNotMatch(
    functionSource,
    /(?:INSERT INTO|UPDATE|DELETE FROM) .*"(?:signal_events|resolution_decisions|source_connections|signal_incidents|offer_observations|missions|mission_targets|strategies|action_jobs|notifications|inbox_messages)"/s
  );
  assert.doesNotMatch(functionSource, /DELETE\s+FROM|TRUNCATE\s+/i);

  const capability = postgresSignalTerminalDecisionApplyCapabilityProjection();
  assert.equal(capability.contractVersion, 1);
  assert.equal(capability.sourceReferenceRefreshContractVersion, 1);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.atomicQualificationApplyImplemented, true);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.immutableBoundaryCatalogFingerprint, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.twoPhasePlanApply, true);
  assert.equal(capability.readCommittedTransactionAdapter, true);
  assert.equal(capability.committedResolutionBinding, true);
  assert.equal(capability.settledSourceReferenceRequired, true);
  assert.equal(capability.terminalOutcomeDerivation, true);
  assert.equal(capability.testSignalTerminalOnly, true);
  assert.equal(capability.nonActionableTerminalOnly, true);
  assert.equal(capability.idempotentReplay, true);
  assert.equal(capability.signalOccurrenceRepositoryParity, true);
  assert.equal(capability.terminalMissionDecisionRepositoryParity, true);
  assert.equal(capability.terminalAuditOutboxRepositoryParity, true);
  assert.equal(capability.sharedCatalogMutation, false);
  assert.equal(capability.sourceReferenceMutation, false);
  assert.equal(capability.incidentMutation, false);
  assert.equal(capability.offerObservationMutation, false);
  assert.equal(capability.missionMutation, false);
  assert.equal(capability.actionMutation, false);
  assert.equal(capability.terminalSignalEvaluationRepositoryParity, true);
  assert.equal(capability.terminalSignalGraphMutation, true);
  assert.equal(capability.remainingDownstreamSignalGraphMutation, false);
  assert.equal(capability.inboxLifecycleMutation, false);
  assert.equal(capability.rawSignalPayloadReturned, false);
  assert.equal(capability.signalEvaluationApplyRepositoryParity, false);
  assert.equal(capability.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(capability.protectedTenantTableCount, 11);
  assert.equal(capability.mutationTableCount, 4);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalTerminalDecisionApplyManifest(
      "yoink_qualification",
      "same_namespace",
      "same_namespace"
    ),
    /independent/
  );
});

test("the terminal-decision plan fingerprint binds every outcome and write claim", () => {
  const plan: PostgresSignalTerminalDecisionApplyPlan = {
    contractVersion: 1,
    messageId: "inbox_00000000000000000000000000000001",
    payloadHash: "1".repeat(64),
    evaluatedAt: "2026-08-26T16:00:00.000Z",
    validUntil: "2026-08-26T16:00:30.000Z",
    eventId: "signal_event_00000000000000000000000000000001",
    resolutionDecisionId: "resolution_00000000000000000000000000000001",
    resolutionStatus: "unresolved",
    listingId: "",
    variantId: "",
    sourceReferenceOutcome: "not_matched",
    outcome: "apply_terminal",
    decisionOutcome: "unresolved_identity",
    decisionReasonHash: "2".repeat(64),
    auditDataHash: "3".repeat(64),
    occurrenceAction: "insert",
    missionDecisionAction: "insert",
    auditAction: "insert",
    outboxAction: "insert",
    mutationStatementCount: 4,
    terminalDecisionApplyWillApply: true,
    sharedCatalogMutation: false,
    sourceReferenceMutation: false,
    incidentMutation: false,
    rawSignalPayloadReturned: false,
    planFingerprint: ""
  };
  const principal = { tenantId: "tenant_test", userId: "user_test" };
  const first = postgresSignalTerminalDecisionApplyPlanFingerprint(principal, plan);
  assert.equal(first, postgresSignalTerminalDecisionApplyPlanFingerprint(principal, plan));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(
    postgresSignalTerminalDecisionApplyPlanFingerprint(
      { ...principal, userId: "user_other" },
      plan
    ),
    first
  );
  assert.notEqual(
    postgresSignalTerminalDecisionApplyPlanFingerprint(
      principal,
      { ...plan, decisionOutcome: "ambiguous_identity" }
    ),
    first
  );
});
