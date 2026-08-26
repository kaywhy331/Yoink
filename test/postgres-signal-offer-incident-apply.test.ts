import assert from "node:assert/strict";
import test from "node:test";
import {
  POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION,
  buildPostgresSignalOfferIncidentApplyManifest,
  postgresSignalOfferIncidentApplyCapabilityProjection,
  postgresSignalOfferIncidentApplyPlanFingerprint,
  signalOfferIncidentApplyFunctionSource,
  type PostgresSignalOfferIncidentApplyPlan
} from "../packages/database/src/postgres-signal-offer-incident-apply.js";

test("the PostgreSQL actionable offer/incident boundary is deterministic and bounded", () => {
  const manifest = buildPostgresSignalOfferIncidentApplyManifest();
  assert.deepEqual(buildPostgresSignalOfferIncidentApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, 3);
  assert.equal(manifest.hostedDeliveryContractVersion, 3);
  assert.equal(manifest.catalogApplyContractVersion, 1);
  assert.equal(manifest.resolutionApplyContractVersion, 1);
  assert.equal(manifest.terminalDecisionApplyContractVersion, 1);
  assert.equal(manifest.offerIncidentApplyRole.kind, "signal_offer_incident_apply_boundary");
  assert.equal(manifest.offerIncidentApplyRole.functionName, POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION);
  assert.equal(manifest.offerIncidentApplyRole.login, false);
  assert.equal(manifest.offerIncidentApplyRole.inherit, false);
  assert.equal(manifest.offerIncidentApplyRole.bypassRls, false);
  assert.equal(manifest.offerIncidentApplyRole.directTableAccess, false);
  assert.deepEqual(manifest.offerIncidentApplyRole.protectedTenantTableNames, [
    "app_settings",
    "audit_events",
    "inbox_messages",
    "mission_decisions",
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
  assert.deepEqual(manifest.offerIncidentApplyRole.mutationTableNames, [
    "offer_observations",
    "signal_incidents",
    "signal_occurrences"
  ]);
  assert.equal(manifest.protectedTenantTableCount, 14);
  assert.equal(manifest.forcedRlsTableCount, 14);
  assert.equal(manifest.mutationTableCount, 3);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.maximumPlanAgeSeconds, 30);
  assert.equal(manifest.serverBoundPrincipalLookup, true);
  assert.equal(manifest.databasePlanRevalidation, true);
  assert.equal(manifest.committedResolutionBinding, true);
  assert.equal(manifest.settledTerminalDecisionRequired, true);
  assert.equal(manifest.actionableOfferRequired, true);
  assert.equal(manifest.serverDerivedSemanticKey, true);
  assert.equal(manifest.deterministicObservationIdentity, true);
  assert.equal(manifest.messageSerialization, true);
  assert.equal(manifest.semanticIncidentSerialization, true);
  assert.equal(manifest.dedupeWindowRepositoryParity, true);
  assert.equal(manifest.idempotentReplay, true);
  assert.equal(manifest.partialGraphFailClosed, true);
  assert.equal(manifest.offerObservationRepositoryParity, true);
  assert.equal(manifest.signalIncidentRepositoryParity, true);
  assert.equal(manifest.signalOccurrenceRepositoryParity, true);
  assert.equal(manifest.sharedCatalogMutation, false);
  assert.equal(manifest.sourceReferenceMutation, false);
  assert.equal(manifest.terminalDecisionMutation, false);
  assert.equal(manifest.missionMutation, false);
  assert.equal(manifest.actionMutation, false);
  assert.equal(manifest.offerIncidentGraphMutation, true);
  assert.equal(manifest.remainingMissionActionGraphMutation, false);
  assert.equal(manifest.inboxLifecycleMutation, false);
  assert.equal(manifest.rawSignalPayloadReturned, false);
  assert.equal(manifest.signalEvaluationApplyRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.mutationAuthority, true);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.terminalDecisionApplyManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const functionSource = signalOfferIncidentApplyFunctionSource(manifest);
  assert.match(functionSource, /principal\.principal_role = session_user::text/);
  assert.match(functionSource, /yoink_apply_trackalacker_signal_terminal_decision/);
  assert.match(functionSource, /must settle as actionable/);
  assert.match(functionSource, /yoink_signal_offer_incident_message_v1:/);
  assert.match(functionSource, /yoink_signal_offer_incident_semantic_v1:/);
  assert.match(functionSource, /pg_advisory_xact_lock/);
  assert.match(functionSource, /FOR UPDATE/);
  assert.match(functionSource, /postgres_signal_offer_incident_apply_plan_v1/);
  assert.match(functionSource, /operation_name NOT IN \('plan', 'apply'\)/);
  assert.match(functionSource, /INSERT INTO .*"offer_observations"/s);
  assert.match(functionSource, /INSERT INTO .*"signal_incidents"/s);
  assert.match(functionSource, /UPDATE .*"signal_incidents"/s);
  assert.match(functionSource, /SET occurrence_count = incident\.occurrence_count \+ 1/);
  assert.match(functionSource, /INSERT INTO .*"signal_occurrences"/s);
  assert.doesNotMatch(
    functionSource,
    /(?:INSERT INTO|UPDATE|DELETE FROM) .*"(?:product_families|variants|listings|listing_urls|source_variant_retailer_refs|source_product_refs|source_listing_refs|source_product_aliases)"/s
  );
  assert.doesNotMatch(
    functionSource,
    /(?:INSERT INTO|UPDATE|DELETE FROM) .*"(?:signal_events|resolution_decisions|source_connections|mission_decisions|missions|mission_targets|strategies|action_jobs|notifications|audit_events|outbox_events|inbox_messages)"/s
  );
  assert.doesNotMatch(functionSource, /DELETE\s+FROM|TRUNCATE\s+/i);

  const capability = postgresSignalOfferIncidentApplyCapabilityProjection();
  assert.equal(capability.contractVersion, 1);
  assert.equal(capability.terminalDecisionApplyContractVersion, 1);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.atomicQualificationApplyImplemented, true);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.immutableBoundaryCatalogFingerprint, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.twoPhasePlanApply, true);
  assert.equal(capability.readCommittedTransactionAdapter, true);
  assert.equal(capability.settledTerminalDecisionRequired, true);
  assert.equal(capability.serverDerivedSemanticKey, true);
  assert.equal(capability.deterministicObservationIdentity, true);
  assert.equal(capability.messageSerialization, true);
  assert.equal(capability.semanticIncidentSerialization, true);
  assert.equal(capability.partialGraphFailClosed, true);
  assert.equal(capability.offerObservationRepositoryParity, true);
  assert.equal(capability.signalIncidentRepositoryParity, true);
  assert.equal(capability.signalOccurrenceRepositoryParity, true);
  assert.equal(capability.sharedCatalogMutation, false);
  assert.equal(capability.sourceReferenceMutation, false);
  assert.equal(capability.terminalDecisionMutation, false);
  assert.equal(capability.missionMutation, false);
  assert.equal(capability.actionMutation, false);
  assert.equal(capability.offerIncidentGraphMutation, true);
  assert.equal(capability.remainingMissionActionGraphMutation, false);
  assert.equal(capability.inboxLifecycleMutation, false);
  assert.equal(capability.rawSignalPayloadReturned, false);
  assert.equal(capability.signalEvaluationApplyRepositoryParity, false);
  assert.equal(capability.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(capability.protectedTenantTableCount, 14);
  assert.equal(capability.mutationTableCount, 3);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalOfferIncidentApplyManifest(
      "yoink_qualification",
      "same_namespace",
      "same_namespace"
    ),
    /independent/
  );
});

test("the offer/incident plan fingerprint binds dedupe identity and every write claim", () => {
  const plan: PostgresSignalOfferIncidentApplyPlan = {
    contractVersion: 1,
    messageId: "inbox_00000000000000000000000000000001",
    payloadHash: "1".repeat(64),
    evaluatedAt: "2026-08-26T18:00:00.000Z",
    validUntil: "2026-08-26T18:00:30.000Z",
    eventId: "signal_event_00000000000000000000000000000001",
    resolutionDecisionId: "resolution_00000000000000000000000000000001",
    terminalDecisionOutcome: "continue_downstream",
    listingId: "listing_test",
    variantId: "variant_test",
    offerObservationId: "offer_observation_00000000000000000000000000000001",
    semanticKey: "2".repeat(64),
    dedupeWindowSeconds: 300,
    outcome: "apply_offer_incident",
    incidentId: "incident_00000000000000000000000000000001",
    offerObservationAction: "insert",
    incidentAction: "insert",
    occurrenceAction: "insert",
    mutationStatementCount: 3,
    offerIncidentApplyWillApply: true,
    sharedCatalogMutation: false,
    sourceReferenceMutation: false,
    terminalDecisionMutation: false,
    missionMutation: false,
    actionMutation: false,
    rawSignalPayloadReturned: false,
    planFingerprint: ""
  };
  const principal = { tenantId: "tenant_test", userId: "user_test" };
  const first = postgresSignalOfferIncidentApplyPlanFingerprint(principal, plan);
  assert.equal(first, postgresSignalOfferIncidentApplyPlanFingerprint(principal, plan));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(
    postgresSignalOfferIncidentApplyPlanFingerprint(
      { ...principal, userId: "user_other" },
      plan
    ),
    first
  );
  assert.notEqual(
    postgresSignalOfferIncidentApplyPlanFingerprint(
      principal,
      { ...plan, incidentAction: "update" }
    ),
    first
  );
  assert.notEqual(
    postgresSignalOfferIncidentApplyPlanFingerprint(
      principal,
      { ...plan, dedupeWindowSeconds: 600 }
    ),
    first
  );
});
