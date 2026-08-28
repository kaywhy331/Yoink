import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { emptyInternalServiceCapabilityProjection } from "../apps/api/src/internal-service-capabilities.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { postgresCutoverCapabilityProjection } from "../packages/database/src/postgres-cutover.js";
import { postgresRuntimeReadRoleCapabilityProjection } from "../packages/database/src/postgres-runtime-roles.js";
import { postgresTenantSessionCapabilityProjection } from "../packages/database/src/postgres-tenant-session.js";
import { postgresTenantQueueWriteCapabilityProjection } from "../packages/database/src/postgres-tenant-queue-writes.js";
import { postgresWorkerControlCapabilityProjection } from "../packages/database/src/postgres-worker-control.js";
import { postgresNotificationRecoveryCapabilityProjection } from "../packages/database/src/postgres-notification-recovery.js";
import { postgresExecutionRecoveryCapabilityProjection } from "../packages/database/src/postgres-execution-recovery.js";
import { postgresOperationalRetentionCapabilityProjection } from "../packages/database/src/postgres-operational-retention.js";
import { postgresObserverCandidateEvaluationCapabilityProjection } from "../packages/database/src/postgres-observer-repair-candidate-evaluation.js";
import { postgresOperatorAlertConnectorDispatchCapabilityProjection } from "../packages/database/src/postgres-operator-alert-connector-dispatch.js";
import { postgresOperatorAlertReconciliationCapabilityProjection } from "../packages/database/src/postgres-operator-alert-reconciliation.js";
import { postgresObserverWitnessRefreshCapabilityProjection } from "../packages/database/src/postgres-observer-witness-refresh.js";
import { postgresHostedDeliveryLeaseRecoveryCapabilityProjection } from "../packages/database/src/postgres-hosted-delivery-lease-recovery.js";
import { postgresSignalCatalogApplyCapabilityProjection } from "../packages/database/src/postgres-signal-catalog-apply.js";
import { postgresSignalResolutionApplyCapabilityProjection } from "../packages/database/src/postgres-signal-resolution-apply.js";
import { postgresSignalSourceReferenceRefreshCapabilityProjection } from "../packages/database/src/postgres-signal-source-reference-refresh.js";
import { postgresSignalTerminalDecisionApplyCapabilityProjection } from "../packages/database/src/postgres-signal-terminal-decision-apply.js";
import { postgresSignalOfferIncidentApplyCapabilityProjection } from "../packages/database/src/postgres-signal-offer-incident-apply.js";
import { postgresSignalPostIncidentDecisionApplyCapabilityProjection } from "../packages/database/src/postgres-signal-post-incident-decision-apply.js";
import { postgresSignalMissionBindingApplyCapabilityProjection } from "../packages/database/src/postgres-signal-mission-binding-apply.js";
import { postgresSignalStrategyEvaluationApplyCapabilityProjection } from "../packages/database/src/postgres-signal-strategy-evaluation-apply.js";
import { postgresSignalWriterLockProtocolCapabilityProjection } from "../packages/database/src/postgres-signal-writer-lock-protocol.js";
import { postgresSignalConstraintConfigCapabilityProjection } from "../packages/database/src/postgres-signal-constraint-config-apply.js";
import { postgresSignalActionSpendCapabilityProjection } from "../packages/database/src/postgres-signal-action-spend-apply.js";
import { postgresSignalTargetQualificationCapabilityProjection } from "../packages/database/src/postgres-signal-target-qualification-apply.js";
import { postgresSignalSourceTrustCapabilityProjection } from "../packages/database/src/postgres-signal-source-trust-apply.js";
import { postgresSignalRetailerQualificationCapabilityProjection } from "../packages/database/src/postgres-signal-retailer-qualification-apply.js";
import { postgresSignalMissionPolicyCapabilityProjection } from "../packages/database/src/postgres-signal-mission-policy-apply.js";
import { postgresSignalSourceStatusCapabilityProjection } from "../packages/database/src/postgres-signal-source-status-apply.js";
import { postgresSignalSourceSyncCapabilityProjection } from "../packages/database/src/postgres-signal-source-sync-apply.js";
import { postgresSignalReservationLifecycleCapabilityProjection } from "../packages/database/src/postgres-signal-reservation-lifecycle-apply.js";
import { postgresSignalCatalogImportCapabilityProjection } from "../packages/database/src/postgres-signal-catalog-import-apply.js";
import { postgresSignalSourceProvisioningCapabilityProjection } from "../packages/database/src/postgres-signal-source-provisioning-apply.js";
import { postgresSignalAttributionPolicyCapabilityProjection } from "../packages/database/src/postgres-signal-attribution-policy-apply.js";
import { postgresSignalEvaluationCompositionCapabilityProjection } from "../packages/database/src/postgres-signal-evaluation-composition.js";
import { postgresSignalAttributionReceiptCapabilityProjection } from "../packages/database/src/postgres-signal-attribution-receipt-apply.js";
import { postgresSignalJobLifecycleCapabilityProjection } from "../packages/database/src/postgres-signal-job-lifecycle-apply.js";
import { postgresSignalEvaluationRepositoryCompositionCapabilityProjection } from "../packages/database/src/postgres-signal-evaluation-repository-composition.js";

test("the loopback API serves the control center and processes a dry-run signal", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "0.1.0-test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    const pageBody = await page.text();
    assert.match(pageBody, /My purchase assistant/);
    assert.match(pageBody, /Purchase plans/);
    assert.match(pageBody, /Products, price, and purchase preferences/);
    assert.match(pageBody, /Spending limits/);
    assert.match(pageBody, /Help improve store reading/);
    assert.match(pageBody, /never fills a field, changes a purchase plan, qualifies a store, or clicks anything/);
    assert.match(pageBody, /Review before anything is enabled/);
    assert.match(pageBody, /Server check/);
    assert.match(pageBody, /Create purchase plan/);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);

    const adminPage = await fetch(`${baseUrl}/admin`);
    assert.equal(adminPage.status, 200);
    const adminPageBody = await adminPage.text();
    assert.match(adminPageBody, /Admin control center/);
    assert.match(adminPageBody, /Target add-only qualification/);
    assert.match(adminPageBody, /Adapter repair queue/);
    assert.match(adminPageBody, /non-executable stable-attribute suggestion/);
    assert.match(adminPageBody, /Catalog review queue/);
    assert.match(adminPageBody, /Merge, split, and compensation/);
    assert.match(adminPageBody, /Privacy-bounded service health/);
    assert.match(adminPageBody, /raw URLs, request bodies, product identifiers/);
    assert.match(adminPageBody, /High-risk change control/);
    assert.match(adminPageBody, /Approval never applies a change by itself/);
    assert.match(adminPageBody, /Durable maintenance/);
    assert.match(adminPageBody, /Durable evaluation with closed browser mutation/);
    assert.match(adminPageBody, /latest eligible assertion counts/);
    assert.match(adminPageBody, /renews its credential without asking you to pair again/);
    assert.match(adminPageBody, /Internal service identities/);
    assert.match(adminPageBody, /Unconfigured services are denied/);
    assert.match(adminPageBody, /PostgreSQL cutover/);
    assert.match(adminPageBody, /One source of truth, never dual write/);
    const adminScript = await fetch(`${baseUrl}/app.js`).then((response) => response.text());
    assert.match(adminScript, /\/api\/v1\/admin\/operations\/telemetry/);
    assert.match(adminScript, /renderOperationalTelemetry/);
    assert.match(adminScript, /\/api\/v1\/admin\/change-requests/);
    assert.match(adminScript, /renderAdminChanges/);
    assert.match(adminScript, /\/api\/v1\/admin\/workers/);
    assert.match(adminScript, /renderBackgroundWork/);
    assert.match(adminScript, /renderPostgresCutover/);
    assert.match(adminScript, /renderOperatorAlerts/);
    assert.match(adminScript, /SAVE_OPERATOR_ALERT_CONNECTOR/);
    assert.match(adminScript, /RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY/);
    assert.match(adminScript, /operatorAlertConnectorHealthProjection|deliverySloSeconds/);
    assert.match(adminScript, /currentContributorVoteCount/);
    assert.match(adminScript, /Price quorum pending/);
    assert.match(adminScript, /Observed range/);
    assert.match(adminScript, /Ready for candidate evaluation/);
    assert.match(adminScript, /worker-generated candidate/);
    assert.match(adminPageBody, /may be compiled into one bounded multi-field recipe candidate/);
    assert.match(adminPageBody, /availability, unit price, seller, fulfillment, and add control/);
    assert.match(adminScript, /deduplicated oracle passes/);
    assert.match(adminScript, /public anti-Sybil quorum pending/);
    assert.match(adminScript, /multi-contributor regression SLO auto-kill/);
    assert.match(adminScript, /Next gate: 2 contributor-deduplicated clean passes on 2 exact SKUs/);
    assert.match(adminScript, /25% deterministic cohort/);
    assert.match(adminScript, /Recipe \+ packaged oracle agreement/);
    assert.match(adminScript, /User review:/);
    assert.match(adminScript, /append-only and revocable/);
    assert.match(adminScript, /Application: never/);
    assert.match(adminPageBody, /Normalized missing-field previews/);
    assert.match(adminPageBody, /Regional conflict operations/);
    assert.match(adminPageBody, /Local identities never count as independent public accounts/);
    assert.match(adminScript, /Regional SLO:/);
    assert.match(adminScript, /disable_read_only_distribution_only|read-only recipe/);
    assert.match(adminScript, /promotionReady \? "" : "disabled"/);
    assert.match(adminScript, /automatic rotation enabled/);
    assert.match(adminScript, /pinned production transport/);
    assert.match(adminScript, /Server-bound privacy retention/);
    assert.match(adminScript, /Server-bound observer candidate evaluation/);
    assert.match(adminScript, /Server-bound operator-alert connector dispatch/);
    assert.match(adminScript, /Server-bound operator-alert reconciliation/);
    assert.match(adminScript, /Server-bound independent witness refresh/);
    assert.match(adminScript, /Server-bound hosted-delivery lease recovery/);
    assert.match(adminScript, /signal lifecycle/);
    assert.match(adminScript, /resolution planning/);
    assert.match(adminScript, /three principal-bound functions/);
    assert.match(adminScript, /Server-bound unknown-product catalog creation/);
    assert.match(adminScript, /canonical retailer formats/);
    assert.match(adminScript, /Server-bound signal event and resolution commit/);
    assert.match(adminScript, /source heartbeat/);
    assert.match(adminScript, /Server-bound terminal signal decisions/);
    assert.match(adminScript, /partial graphs and inconsistent replays fail closed/);
    assert.match(adminScript, /Server-bound actionable offer incidents/);
    assert.match(adminScript, /missions, actions, and inbox lifecycle remain untouched/);
    assert.match(adminScript, /Server-bound post-incident decisions/);
    assert.match(adminScript, /Trusted exact sources project mission binding or creation requirements with zero writes/);
    assert.match(adminScript, /Server-bound signal mission binding/);
    assert.match(adminScript, /byte-identical SQLite policy hashes/);
    assert.match(adminScript, /creates only a missing initial append-only intent policy/);
    assert.match(adminScript, /Server-bound bounded configuration writers/);
    assert.match(adminScript, /Server-bound Target qualification and settings activation/);
    assert.match(adminScript, /Server-bound source-trust configuration/);
    assert.match(adminScript, /Server-bound Walmart, Amazon, and Best Buy qualification/);
    assert.match(adminScript, /Server-bound mission-policy revision/);
    assert.match(adminScript, /global action pause\/resume, guardrail settings, and periodic spend caps/);
    assert.match(adminScript, /twenty-three independently qualified signal boundaries proven/);
    assert.match(adminScript, /Server-bound TrackaLacker source sync/);
    assert.match(adminScript, /eighteenth independently inactive NOLOGIN boundary/);
    assert.match(adminScript, /Server-bound spend-reservation lifecycle/);
    assert.match(adminScript, /nineteenth independently inactive NOLOGIN boundary/);
    assert.match(adminScript, /Server-bound TrackaLacker catalog import/);
    assert.match(adminScript, /twentieth independently inactive NOLOGIN boundary/);
    assert.match(adminScript, /Server-bound source-connection provisioning/);
    assert.match(adminScript, /twenty-first independently inactive NOLOGIN boundary/);
    assert.match(adminScript, /Server-bound attribution-policy replacement/);
    assert.match(adminScript, /twenty-second independently inactive NOLOGIN boundary/);
    assert.match(adminScript, /Server-bound reviewed purchase-intent action and spend/);
    assert.match(adminScript, /reviewed purchase intents retain their guarded add\/spend semantics unchanged/);
    assert.match(adminScript, /strategy-sourced cart actions and spend reservations remain structurally closed/);
    assert.match(adminScript, /Retailer mutation, checkout, order submission, and inbox completion remain closed/);
    assert.match(adminScript, /Complete signal-evaluation apply composition/);
    assert.match(adminScript, /qualified signal writers now compose into one deterministically verified evaluation-apply closure/);
    assert.match(adminScript, /closing signal-evaluation apply repository parity/);
    assert.match(adminScript, /Complete signal-evaluation repository composition/);
    assert.match(adminScript, /now compose into one deterministically verified complete evaluation repository/);
    assert.match(adminScript, /closing signal-evaluation repository parity while durable ingress and handler composition remain open/);
    assert.match(adminScript, /Server-bound attribution-receipt append/);
    assert.match(adminScript, /twenty-third independently inactive NOLOGIN boundary/);
    assert.match(adminScript, /derive-don't-trust affiliate-routing receipt/);
    assert.match(adminScript, /closes the attribution-receipt family from the evaluation-composition accounting/);
    assert.match(adminScript, /Server-bound action-job lifecycle/);
    assert.match(adminScript, /twenty-fourth independently inactive NOLOGIN boundary/);
    assert.match(adminScript, /complete forty-seven-edge post-creation job state machine/);
    assert.match(adminScript, /closes the post-creation job-lifecycle family/);
    assert.match(adminScript, /\/api\/v1\/admin\/attribution-policies/);

    const health = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    const emptyInternalServices = emptyInternalServiceCapabilityProjection();
    const postgresCutover = postgresCutoverCapabilityProjection();
    const postgresRuntimeReadRoles = postgresRuntimeReadRoleCapabilityProjection();
    const postgresTenantSessions = postgresTenantSessionCapabilityProjection();
    const postgresTenantQueueWrites = postgresTenantQueueWriteCapabilityProjection();
    const postgresWorkerControl = postgresWorkerControlCapabilityProjection();
    const postgresNotificationRecovery = postgresNotificationRecoveryCapabilityProjection();
    const postgresExecutionRecovery = postgresExecutionRecoveryCapabilityProjection();
    const postgresOperationalRetention = postgresOperationalRetentionCapabilityProjection();
    const postgresObserverCandidateEvaluation = postgresObserverCandidateEvaluationCapabilityProjection();
    const postgresOperatorAlertConnectorDispatch = postgresOperatorAlertConnectorDispatchCapabilityProjection();
    const postgresOperatorAlertReconciliation = postgresOperatorAlertReconciliationCapabilityProjection();
    const postgresObserverWitnessRefresh = postgresObserverWitnessRefreshCapabilityProjection();
    const postgresHostedDeliveryLeaseRecovery = postgresHostedDeliveryLeaseRecoveryCapabilityProjection();
    const postgresSignalCatalogApply = postgresSignalCatalogApplyCapabilityProjection();
    const postgresSignalResolutionApply = postgresSignalResolutionApplyCapabilityProjection();
    const postgresSignalSourceReferenceRefresh = postgresSignalSourceReferenceRefreshCapabilityProjection();
    const postgresSignalTerminalDecisionApply = postgresSignalTerminalDecisionApplyCapabilityProjection();
    const postgresSignalOfferIncidentApply = postgresSignalOfferIncidentApplyCapabilityProjection();
    const postgresSignalPostIncidentDecisionApply =
      postgresSignalPostIncidentDecisionApplyCapabilityProjection();
    const postgresSignalMissionBindingApply =
      postgresSignalMissionBindingApplyCapabilityProjection();
    const postgresSignalStrategyEvaluationApply =
      postgresSignalStrategyEvaluationApplyCapabilityProjection();
    const postgresSignalWriterLockProtocol =
      postgresSignalWriterLockProtocolCapabilityProjection();
    const postgresSignalConstraintConfigApply =
      postgresSignalConstraintConfigCapabilityProjection();
    const postgresSignalActionSpendApply =
      postgresSignalActionSpendCapabilityProjection();
    const postgresSignalTargetQualificationApply =
      postgresSignalTargetQualificationCapabilityProjection();
    const postgresSignalSourceTrustApply =
      postgresSignalSourceTrustCapabilityProjection();
    const postgresSignalRetailerQualificationApply =
      postgresSignalRetailerQualificationCapabilityProjection();
    const postgresSignalMissionPolicyApply =
      postgresSignalMissionPolicyCapabilityProjection();
    const postgresSignalSourceStatusApply =
      postgresSignalSourceStatusCapabilityProjection();
    const postgresSignalSourceSyncApply =
      postgresSignalSourceSyncCapabilityProjection();
    const postgresSignalReservationLifecycleApply =
      postgresSignalReservationLifecycleCapabilityProjection();
    const postgresSignalCatalogImportApply =
      postgresSignalCatalogImportCapabilityProjection();
    const postgresSignalSourceProvisioningApply =
      postgresSignalSourceProvisioningCapabilityProjection();
    const postgresSignalAttributionPolicyApply =
      postgresSignalAttributionPolicyCapabilityProjection();
    const postgresSignalEvaluationComposition =
      postgresSignalEvaluationCompositionCapabilityProjection();
    const postgresSignalAttributionReceiptApply =
      postgresSignalAttributionReceiptCapabilityProjection();
    const postgresSignalJobLifecycleApply =
      postgresSignalJobLifecycleCapabilityProjection();
    const postgresSignalEvaluationRepositoryComposition =
      postgresSignalEvaluationRepositoryCompositionCapabilityProjection();
    assert.deepEqual(health, {
      status: "ready",
      version: "0.1.0-test",
      database: "ready",
      storageEngine: "sqlite",
      portabilityArchiveFormat: "yoink-portability-ndjson-v1",
      userDataExportFormat: "yoink-user-data-json-v1",
      selfServiceUserDataExport: true,
      productionPostgresReady: false,
      postgresCutover,
      postgresRuntimeReadRoles,
      postgresTenantSessions,
      postgresTenantQueueWrites,
      postgresWorkerControl,
      postgresNotificationRecovery,
      postgresExecutionRecovery,
      postgresOperationalRetention,
      postgresObserverCandidateEvaluation,
      postgresOperatorAlertConnectorDispatch,
      postgresOperatorAlertReconciliation,
      postgresObserverWitnessRefresh,
      postgresHostedDeliveryLeaseRecovery,
      postgresSignalCatalogApply,
      postgresSignalResolutionApply,
      postgresSignalSourceReferenceRefresh,
      postgresSignalTerminalDecisionApply,
      postgresSignalOfferIncidentApply,
      postgresSignalPostIncidentDecisionApply,
      postgresSignalMissionBindingApply,
      postgresSignalStrategyEvaluationApply,
      postgresSignalWriterLockProtocol,
      postgresSignalConstraintConfigApply,
      postgresSignalActionSpendApply,
      postgresSignalTargetQualificationApply,
      postgresSignalSourceTrustApply,
      postgresSignalRetailerQualificationApply,
      postgresSignalMissionPolicyApply,
      postgresSignalSourceStatusApply,
      postgresSignalSourceSyncApply,
      postgresSignalReservationLifecycleApply,
      postgresSignalCatalogImportApply,
      postgresSignalSourceProvisioningApply,
      postgresSignalAttributionPolicyApply,
      postgresSignalEvaluationComposition,
      postgresSignalAttributionReceiptApply,
      postgresSignalJobLifecycleApply,
      postgresSignalEvaluationRepositoryComposition,
      durableBackgroundTasks: true,
      durableSignalIngress: true,
      signalEvaluationOutsideDeviceRequest: true,
      durableObserverRepairCandidateEvaluation: true,
      privacyBoundedObserverRepairFieldCount: 5,
      generatedObserverRepairCandidatesExecutable: false,
      generatedObserverRepairCandidatesAutoPromoted: false,
      generatedObserverRepairRequiresIndependentOracle: true,
      generatedObserverRepairIndependentOracleImplemented: false,
      generatedObserverRepairPackagedOracleImplemented: true,
      generatedObserverRepairPackagedOracleRequiredForPromotion: true,
      generatedObserverRepairIndependentAccountOracleImplemented: false,
      generatedObserverRepairTenantContributorQuorumImplemented: true,
      generatedObserverRepairPublicIndependentAccountQuorumImplemented: false,
      observerRecipePackagedConflictAutoKill: true,
      observerRecipeContributorDeduplicatedQuorumImplemented: true,
      observerRecipeCanaryCohortPercent: 25,
      observerRecipeCanaryMinimumDurationHours: 24,
      observerRecipeCanaryRegressionAutoKill: true,
      observerRecipeRecoveryEvidenceStorageImplemented: true,
      observerRecipeRecoveryUserReviewImplemented: true,
      observerRecipeRecoveryReviewRevocationImplemented: true,
      observerRecipeRecoveryRetentionImplemented: true,
      observerRecipeRecoveryRetentionDays: 90,
      observerRecipeRecoveryRetentionReceiptsImplemented: true,
      observerRecipeContributorEligibilitySeamImplemented: true,
      observerRecipeContributorEligibilityPolicyVersion: "observer_recipe_contributor_eligibility_v1",
      observerRecipeContributorEligibilityMaximumTtlHours: 24,
      observerRecipeExternalIdentityRiskProviderConfigured: false,
      observerRecipeRegionalConflictSloImplemented: true,
      observerRecipeRegionalConflictSloPolicyVersion: "observer_recipe_conflict_slo_v1",
      observerRecipeRegionalConflictSloWindowDays: 7,
      observerRecipeRegionalConflictSloMayDisableReadOnlyDistribution: true,
      observerRecipeRegionalConflictSloMayAuthorizeMutation: false,
      observerRecipeRecoveryReviewAffectsApplication: false,
      observerRecipeRecoveryEvidenceApplicationEnabled: false,
      observerRecipeFieldFillEnabled: false,
      durableObserverRecipeWitnessRefresh: true,
      durableOperatorAlertConnectorDispatch: true,
      governedOperatorAlertConnectorReplay: true,
      operatorAlertConnectorHealthProjection: true,
      oneCurrentCommunityVotePerContributor: true,
      robustCommunityPriceProjection: true,
      productionSharedCommunityEvidencePlane: false,
      explainablePurchaseAutomationReadiness: true,
      guardedAddAttemptQuantityOne: true,
      qualifiedAddLaneRequiredBeforeSpendReservation: true,
      serverAuthoritativePurchaseIntentPreflight: true,
      preflightBoundPurchaseIntentCreateV2: true,
      operatorAlertConnectorRegistryConfigured: false,
      observerRecipeWitnessRefreshConfigured: false,
      standaloneWitnessRefreshLoadsSigningKeys: false,
      privacyBoundedRepairLandmarks: true,
      nonExecutableRepairSuggestions: true,
      rotatableDeviceCredentials: true,
      recoverableTwoPhaseDeviceCredentialRotation: true,
      hostedDeviceTransportContract: true,
      internalServiceCapabilityPolicyVersion: 1,
      workloadScopedInternalServiceAuthorization: true,
      unconfiguredInternalServicesDenied: true,
      internalServiceCapabilityHeaderAccepted: false,
      internalServiceCapabilityRegistryConfigured: false,
      internalServiceCapabilityRegistryCount: 0,
      internalServiceCapabilityRegistryFingerprint: emptyInternalServices.fingerprint,
      internalServiceCapabilityCoverage: { delivery: 0, eligibility: 0, principal: 0 },
      separateExtensionRuntimeProfiles: true,
      explicitExtensionOriginPolicy: false,
      localExtensionUpdates: true,
      backgroundWorkerRuntime: "stopped",
      backgroundWorkerHealthy: false,
      backgroundWorkerDeployment: "local_in_process",
      backgroundWorkerMode: "disabled",
      backgroundWorkerDeploymentAttested: false,
      backgroundWorkerDeploymentContractVersion: 2,
      asyncBackgroundWorkerContract: true,
      standaloneBackgroundWorkerProcessReady: true,
      productionWorkerFleetReady: false,
      executionMode: "shadow",
      actionsPaused: true,
      chromeMutationEnabled: false,
      targetAddExecutionEnabled: false,
      walmartAddExecutionEnabled: false,
      amazonAddExecutionEnabled: false,
      bestBuyAddExecutionEnabled: false,
      observerRecipeWitnessRequired: false,
      observerRecipeWitnessState: "disabled",
      observerRecipeWitnessHealthy: false,
      observerRecipeDeliveryWitnessSatisfied: true
    });

    const listingResponse = await fetch(`${baseUrl}/api/v1/user/catalog/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker",
        sourceProductId: "api-product-1",
        sourceListingId: "api-listing-1",
        title: "Yoink API Test Product",
        retailerId: "target",
        retailerSku: "1011483414",
        canonicalUrl: "https://www.target.com/p/-/A-1011483414",
        listingStatus: "out_of_stock",
        executionSupported: true,
        msrpCents: 6999,
        currency: "USD"
      })
    });
    assert.equal(listingResponse.status, 202);
    const catalogProposal = (await listingResponse.json() as {
      proposal: { id: string; status: string };
      disposition: string;
    }).proposal;
    assert.equal(catalogProposal.status, "pending");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings")?.count, 0);

    const decisionResponse = await fetch(`${baseUrl}/api/v1/admin/catalog/proposals/${encodeURIComponent(catalogProposal.id)}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        outcome: "approve",
        note: "Test fixture exact retailer SKU verified.",
        confirmation: "APPROVE_CATALOG_PROPOSAL"
      })
    });
    assert.equal(decisionResponse.status, 200);
    assert.equal((await decisionResponse.json() as { proposal: { status: string } }).proposal.status, "approved");

    const signalResponse = await fetch(`${baseUrl}/api/v1/signals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker",
        externalEventId: "api-event-1",
        eventType: "restock",
        observedAt: new Date().toISOString(),
        test: true,
        identity: {
          sourceProductId: "api-product-1",
          sourceListingId: "api-listing-1",
          retailerId: "target",
          retailerSku: "1011483414",
          title: "Yoink API Test Product"
        },
        offer: { availability: "in_stock", unitPriceCents: 6999, currency: "USD" }
      })
    });
    assert.equal(signalResponse.status, 202);
    const signal = await signalResponse.json() as Record<string, unknown>;
    assert.equal(signal.decision, "test_signal");
    assert.equal(signal.actionJobId, "");

    const snapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
      capabilities: Record<string, unknown>;
      dataPlane: Record<string, unknown>;
      signalIngress: {
        durable: boolean;
        evaluationBoundary: string;
        packagedEventType: string;
        counts: { total: number };
      };
    };
    assert.equal(snapshot.counts.listings, 1);
    assert.equal(snapshot.counts.catalogProposals, 1);
    assert.equal(snapshot.counts.pendingCatalogProposals, 0);
    assert.equal(snapshot.counts.signals, 1);
    assert.equal(snapshot.counts.actionJobs, 0);
    assert.equal(snapshot.counts.queuedSignalMessages, 0);
    assert.equal(snapshot.counts.processedSignalMessages, 0);
    assert.equal(snapshot.counts.deadLetterSignalMessages, 0);
    assert.deepEqual(snapshot.signalIngress, {
      durable: true,
      evaluationBoundary: "standalone_background_worker",
      packagedEventType: "signal_event_v1",
      counts: {
        eventType: "signal_event_v1",
        accepted: 0,
        processing: 0,
        failed: 0,
        processed: 0,
        deadLetter: 0,
        total: 0
      }
    });
    assert.equal(snapshot.counts.catalogIdentityOperations, 0);
    assert.equal(snapshot.counts.pendingCatalogIdentityOperations, 0);
    assert.equal(snapshot.counts.adminChangeRequests, 0);
    assert.equal(snapshot.counts.consumedAdminChanges, 0);
    assert.equal(snapshot.capabilities.retailerMutation, false);
    assert.equal(snapshot.capabilities.communityReadOnlyEvidence, true);
    assert.equal(snapshot.capabilities.oneCurrentCommunityVotePerContributor, true);
    assert.equal(snapshot.capabilities.robustCommunityPriceProjection, true);
    assert.equal(snapshot.capabilities.productionSharedCommunityEvidencePlane, false);
    assert.equal(snapshot.capabilities.storageEngine, "sqlite");
    assert.equal(snapshot.capabilities.freshDatabaseRestoreParity, true);
    assert.equal(snapshot.capabilities.productionPostgresReady, false);
    assert.deepEqual(snapshot.capabilities.postgresCutover, postgresCutover);
    assert.deepEqual(snapshot.capabilities.postgresRuntimeReadRoles, postgresRuntimeReadRoles);
    assert.deepEqual(snapshot.capabilities.postgresTenantSessions, postgresTenantSessions);
    assert.deepEqual(snapshot.capabilities.postgresTenantQueueWrites, postgresTenantQueueWrites);
    assert.deepEqual(snapshot.capabilities.postgresWorkerControl, postgresWorkerControl);
    assert.deepEqual(snapshot.capabilities.postgresNotificationRecovery, postgresNotificationRecovery);
    assert.deepEqual(snapshot.capabilities.postgresExecutionRecovery, postgresExecutionRecovery);
    assert.deepEqual(
      snapshot.capabilities.postgresOperationalRetention,
      postgresOperationalRetention
    );
    assert.deepEqual(
      snapshot.capabilities.postgresObserverCandidateEvaluation,
      postgresObserverCandidateEvaluation
    );
    assert.deepEqual(
      snapshot.capabilities.postgresOperatorAlertConnectorDispatch,
      postgresOperatorAlertConnectorDispatch
    );
    assert.deepEqual(
      snapshot.capabilities.postgresOperatorAlertReconciliation,
      postgresOperatorAlertReconciliation
    );
    assert.deepEqual(
      snapshot.capabilities.postgresObserverWitnessRefresh,
      postgresObserverWitnessRefresh
    );
    assert.deepEqual(
      snapshot.capabilities.postgresHostedDeliveryLeaseRecovery,
      postgresHostedDeliveryLeaseRecovery
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalCatalogApply,
      postgresSignalCatalogApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalResolutionApply,
      postgresSignalResolutionApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalSourceReferenceRefresh,
      postgresSignalSourceReferenceRefresh
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalTerminalDecisionApply,
      postgresSignalTerminalDecisionApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalOfferIncidentApply,
      postgresSignalOfferIncidentApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalPostIncidentDecisionApply,
      postgresSignalPostIncidentDecisionApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalMissionBindingApply,
      postgresSignalMissionBindingApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalStrategyEvaluationApply,
      postgresSignalStrategyEvaluationApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalWriterLockProtocol,
      postgresSignalWriterLockProtocol
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalConstraintConfigApply,
      postgresSignalConstraintConfigApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalActionSpendApply,
      postgresSignalActionSpendApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalTargetQualificationApply,
      postgresSignalTargetQualificationApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalSourceTrustApply,
      postgresSignalSourceTrustApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalRetailerQualificationApply,
      postgresSignalRetailerQualificationApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalMissionPolicyApply,
      postgresSignalMissionPolicyApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalSourceStatusApply,
      postgresSignalSourceStatusApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalSourceSyncApply,
      postgresSignalSourceSyncApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalReservationLifecycleApply,
      postgresSignalReservationLifecycleApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalCatalogImportApply,
      postgresSignalCatalogImportApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalSourceProvisioningApply,
      postgresSignalSourceProvisioningApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalAttributionPolicyApply,
      postgresSignalAttributionPolicyApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalEvaluationComposition,
      postgresSignalEvaluationComposition
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalAttributionReceiptApply,
      postgresSignalAttributionReceiptApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalJobLifecycleApply,
      postgresSignalJobLifecycleApply
    );
    assert.deepEqual(
      snapshot.capabilities.postgresSignalEvaluationRepositoryComposition,
      postgresSignalEvaluationRepositoryComposition
    );
    assert.deepEqual(snapshot.dataPlane, {
      activeStorageEngine: "sqlite",
      postgresCutover,
      postgresRuntimeReadRoles,
      postgresTenantSessions,
      postgresTenantQueueWrites,
      postgresWorkerControl,
      postgresNotificationRecovery,
      postgresExecutionRecovery,
      postgresOperationalRetention,
      postgresObserverCandidateEvaluation,
      postgresOperatorAlertConnectorDispatch,
      postgresOperatorAlertReconciliation,
      postgresObserverWitnessRefresh,
      postgresHostedDeliveryLeaseRecovery,
      postgresSignalCatalogApply,
      postgresSignalResolutionApply,
      postgresSignalSourceReferenceRefresh,
      postgresSignalTerminalDecisionApply,
      postgresSignalOfferIncidentApply,
      postgresSignalPostIncidentDecisionApply,
      postgresSignalMissionBindingApply,
      postgresSignalStrategyEvaluationApply,
      postgresSignalWriterLockProtocol,
      postgresSignalConstraintConfigApply,
      postgresSignalActionSpendApply,
      postgresSignalTargetQualificationApply,
      postgresSignalSourceTrustApply,
      postgresSignalRetailerQualificationApply,
      postgresSignalMissionPolicyApply,
      postgresSignalSourceStatusApply,
      postgresSignalSourceSyncApply,
      postgresSignalReservationLifecycleApply,
      postgresSignalCatalogImportApply,
      postgresSignalSourceProvisioningApply,
      postgresSignalAttributionPolicyApply,
      postgresSignalEvaluationComposition,
      postgresSignalAttributionReceiptApply,
      postgresSignalJobLifecycleApply,
      postgresSignalEvaluationRepositoryComposition
    });
    assert.equal(snapshot.capabilities.reversibleCatalogIdentityGovernance, true);
    assert.equal(snapshot.capabilities.hostedGlobalCatalogAuthority, false);
    assert.equal(snapshot.capabilities.signedAuthenticationAssurance, true);
    assert.equal(snapshot.capabilities.highRiskChangeControl, true);
    assert.equal(snapshot.capabilities.selfServiceUserDataExport, true);
    assert.equal(snapshot.capabilities.userDataExportFormat, "yoink-user-data-json-v1");
    assert.equal(snapshot.capabilities.selfServiceAccountDeletion, false);
    assert.equal(snapshot.capabilities.independentSafetyExpansionApproval, true);
    assert.equal(snapshot.capabilities.productionIdentityProvider, false);
    assert.equal(snapshot.capabilities.durableBackgroundTasks, true);
    assert.equal(snapshot.capabilities.backgroundWorkOutsideRequestHandling, true);
    assert.equal(snapshot.capabilities.durableSignalIngress, true);
    assert.equal(snapshot.capabilities.signalEvaluationOutsideDeviceRequest, true);
    assert.equal(snapshot.capabilities.durableObserverRepairCandidateEvaluation, true);
    assert.equal(snapshot.capabilities.privacyBoundedObserverRepairFieldCount, 5);
    assert.equal(snapshot.capabilities.generatedObserverRepairCandidatesExecutable, false);
    assert.equal(snapshot.capabilities.generatedObserverRepairCandidatesAutoPromoted, false);
    assert.equal(snapshot.capabilities.generatedObserverRepairRequiresIndependentOracle, true);
    assert.equal(snapshot.capabilities.generatedObserverRepairIndependentOracleImplemented, false);
    assert.equal(snapshot.capabilities.generatedObserverRepairPackagedOracleImplemented, true);
    assert.equal(snapshot.capabilities.generatedObserverRepairPackagedOracleRequiredForPromotion, true);
    assert.equal(snapshot.capabilities.generatedObserverRepairIndependentAccountOracleImplemented, false);
    assert.equal(snapshot.capabilities.generatedObserverRepairTenantContributorQuorumImplemented, true);
    assert.equal(snapshot.capabilities.generatedObserverRepairPublicIndependentAccountQuorumImplemented, false);
    assert.equal(snapshot.capabilities.observerRecipePackagedConflictAutoKill, true);
    assert.equal(snapshot.capabilities.observerRecipeContributorDeduplicatedQuorumImplemented, true);
    assert.equal(snapshot.capabilities.observerRecipeCanaryCohortPercent, 25);
    assert.equal(snapshot.capabilities.observerRecipeCanaryMinimumDurationHours, 24);
    assert.equal(snapshot.capabilities.observerRecipeCanaryRegressionAutoKill, true);
    assert.equal(snapshot.capabilities.observerRecipeRecoveryEvidenceStorageImplemented, true);
    assert.equal(snapshot.capabilities.observerRecipeRecoveryUserReviewImplemented, true);
    assert.equal(snapshot.capabilities.observerRecipeRecoveryReviewRevocationImplemented, true);
    assert.equal(snapshot.capabilities.observerRecipeRecoveryRetentionImplemented, true);
    assert.equal(snapshot.capabilities.observerRecipeRecoveryRetentionDays, 90);
    assert.equal(snapshot.capabilities.observerRecipeRecoveryRetentionReceiptsImplemented, true);
    assert.equal(snapshot.capabilities.observerRecipeContributorEligibilitySeamImplemented, true);
    assert.equal(snapshot.capabilities.observerRecipeContributorEligibilityPolicyVersion, "observer_recipe_contributor_eligibility_v1");
    assert.equal(snapshot.capabilities.observerRecipeContributorEligibilityMaximumTtlHours, 24);
    assert.equal(snapshot.capabilities.observerRecipeExternalIdentityRiskProviderConfigured, false);
    assert.equal(snapshot.capabilities.observerRecipeRegionalConflictSloImplemented, true);
    assert.equal(snapshot.capabilities.observerRecipeRegionalConflictSloPolicyVersion, "observer_recipe_conflict_slo_v1");
    assert.equal(snapshot.capabilities.observerRecipeRegionalConflictSloWindowDays, 7);
    assert.equal(snapshot.capabilities.observerRecipeRegionalConflictSloMayDisableReadOnlyDistribution, true);
    assert.equal(snapshot.capabilities.observerRecipeRegionalConflictSloMayAuthorizeMutation, false);
    assert.equal(snapshot.capabilities.observerRecipeRecoveryReviewAffectsApplication, false);
    assert.equal(snapshot.capabilities.observerRecipeRecoveryEvidenceApplicationEnabled, false);
    assert.equal(snapshot.capabilities.observerRecipeFieldFillEnabled, false);
    assert.equal(snapshot.capabilities.durableObserverRecipeWitnessRefresh, true);
    assert.equal(snapshot.capabilities.attestedBackgroundWorkerDeployment, true);
    assert.equal(snapshot.capabilities.observerRecipeWitnessRefreshConfigured, false);
    assert.equal(snapshot.capabilities.standaloneWitnessRefreshLoadsSigningKeys, false);
    assert.equal(snapshot.capabilities.privacyBoundedRepairLandmarks, true);
    assert.equal(snapshot.capabilities.nonExecutableRepairSuggestions, true);
    assert.equal(snapshot.capabilities.rotatableDeviceCredentials, true);
    assert.equal(snapshot.capabilities.recoverableTwoPhaseDeviceCredentialRotation, true);
    assert.equal(snapshot.capabilities.hostedDeviceTransportContract, true);
    assert.equal(snapshot.capabilities.separateExtensionRuntimeProfiles, true);
    assert.equal(snapshot.capabilities.explicitExtensionOriginPolicy, false);
    assert.equal(snapshot.capabilities.hostedDevicePairingScope, false);
    assert.equal(snapshot.capabilities.localExtensionUpdates, true);
    assert.equal(snapshot.capabilities.asyncBackgroundWorkerContract, true);
    assert.equal(snapshot.capabilities.standaloneBackgroundWorkerProcessReady, true);
    assert.equal(snapshot.capabilities.boundedMultiPrincipalWorker, true);
    assert.equal(snapshot.capabilities.productionWorkerFleetReady, false);
    assert.equal(snapshot.capabilities.explainablePurchaseAutomationReadiness, true);
    assert.equal(snapshot.capabilities.guardedAddAttemptQuantityOne, true);
    assert.equal(snapshot.capabilities.qualifiedAddLaneRequiredBeforeSpendReservation, true);
    assert.equal(snapshot.capabilities.serverAuthoritativePurchaseIntentPreflight, true);
    assert.equal(snapshot.capabilities.preflightBoundPurchaseIntentCreateV2, true);

    const libraryPage = await fetch(`${baseUrl}/api/v1/library?limit=1&offset=0&q=Yoink%20API`).then((response) => response.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    assert.equal(libraryPage.total, 1);
    assert.equal(libraryPage.items.length, 1);
    const missionPage = await fetch(`${baseUrl}/api/v1/missions?limit=1&offset=0&q=Yoink%20API`).then((response) => response.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    assert.equal(missionPage.total, 0);
    const guidedDraft = {
      contractVersion: 2 as const,
      listingId: String(libraryPage.items[0]?.listingId ?? ""),
      targetQuantity: 1,
      maxUnitPriceCents: 6999,
      maxAllInCents: 6999,
      actionCeiling: "notify" as const,
      sellerPolicy: "first_party_only" as const,
      fulfillment: "shipping" as const,
      substitutionPolicy: "exact_only" as const,
      cooldownSeconds: 900,
      confirmation: "PREFLIGHT_EXACT_PURCHASE_PLAN" as const
    };
    const preflightResponse = await fetch(`${baseUrl}/api/v1/user/purchase-intents/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify(guidedDraft)
    });
    assert.equal(preflightResponse.status, 200);
    const { preflight } = await preflightResponse.json() as { preflight: {
      contractVersion: number;
      noPurchasePlanSaved: boolean;
      preflightFingerprint: string;
      preflightedAt: string;
      validUntil: string;
      cost: { itemSubtotalCapCents: number; minimumAllInCents: number; headroomCents: number };
      automationReadiness: { configuredAction: string; guardedAddAttemptQuantity: number };
    } };
    assert.equal(preflight.contractVersion, 1);
    assert.equal(preflight.noPurchasePlanSaved, true);
    assert.match(preflight.preflightFingerprint, /^[a-f0-9]{64}$/);
    assert.ok(new Date(preflight.validUntil).getTime() > new Date(preflight.preflightedAt).getTime());
    assert.deepEqual(preflight.cost, {
      itemSubtotalCapCents: 6999,
      taxReserveCents: 0,
      storeReserveCents: 0,
      minimumAllInCents: 6999,
      reviewedAllInCents: 6999,
      headroomCents: 0,
      currency: "USD"
    });
    assert.equal(preflight.automationReadiness.configuredAction, "notify");
    assert.equal(preflight.automationReadiness.guardedAddAttemptQuantity, 1);
    assert.equal((await fetch(`${baseUrl}/api/v1/missions?limit=1&offset=0&q=Yoink%20API`).then((response) => response.json()) as { total: number }).total, 0);
    const mismatchedPreflight = await fetch(`${baseUrl}/api/v1/user/purchase-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        ...guidedDraft,
        confirmation: "CREATE_EXACT_PURCHASE_PLAN",
        preflightFingerprint: "0".repeat(64),
        preflightedAt: preflight.preflightedAt
      })
    });
    assert.equal(mismatchedPreflight.status, 409);
    assert.equal((await mismatchedPreflight.json() as { error: string }).error, "purchase_intent_preflight_required");
    db.run("UPDATE source_connections SET status = 'disconnected' WHERE id = 'source_trackalacker_local'");
    const changedContextPreflight = await fetch(`${baseUrl}/api/v1/user/purchase-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        ...guidedDraft,
        confirmation: "CREATE_EXACT_PURCHASE_PLAN",
        preflightFingerprint: preflight.preflightFingerprint,
        preflightedAt: preflight.preflightedAt
      })
    });
    assert.equal(changedContextPreflight.status, 409);
    assert.equal((await changedContextPreflight.json() as { error: string }).error, "purchase_intent_preflight_required");
    db.run("UPDATE source_connections SET status = 'connected' WHERE id = 'source_trackalacker_local'");
    const purchaseIntentResponse = await fetch(`${baseUrl}/api/v1/user/purchase-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        ...guidedDraft,
        preflightFingerprint: preflight.preflightFingerprint,
        preflightedAt: preflight.preflightedAt,
        confirmation: "CREATE_EXACT_PURCHASE_PLAN"
      })
    });
    assert.equal(purchaseIntentResponse.status, 201);
    const createdPurchaseIntent = await purchaseIntentResponse.json() as {
      created: boolean;
      purchaseIntent: {
        id: string;
        intentPolicy: {
          revision: number;
          actionCeiling: string;
          decisionMode: string;
          maxSignalAgeSeconds: number;
          maxAllInCents: number;
        };
        targets: Array<Record<string, unknown>>;
        automationReadiness: {
          contractVersion: number;
          configuredAction: string;
          readyForGuardedAdd: boolean;
          guardedAddAttemptQuantity: number;
        };
      };
    };
    assert.equal(createdPurchaseIntent.created, true);
    assert.equal(createdPurchaseIntent.purchaseIntent.intentPolicy.revision, 1);
    assert.equal(createdPurchaseIntent.purchaseIntent.intentPolicy.actionCeiling, "notify");
    assert.equal(createdPurchaseIntent.purchaseIntent.intentPolicy.decisionMode, "purchase_intent");
    assert.equal(createdPurchaseIntent.purchaseIntent.intentPolicy.maxSignalAgeSeconds, 120);
    assert.equal(createdPurchaseIntent.purchaseIntent.intentPolicy.maxAllInCents, 6999);
    assert.equal(createdPurchaseIntent.purchaseIntent.automationReadiness.contractVersion, 1);
    assert.equal(createdPurchaseIntent.purchaseIntent.automationReadiness.configuredAction, "notify");
    assert.equal(createdPurchaseIntent.purchaseIntent.automationReadiness.readyForGuardedAdd, false);
    assert.equal(createdPurchaseIntent.purchaseIntent.automationReadiness.guardedAddAttemptQuantity, 1);
    const durableReceipts = JSON.stringify({
      audit: db.all("SELECT data_json FROM audit_events"),
      outbox: db.all("SELECT payload_json FROM outbox_events")
    });
    assert.equal(durableReceipts.includes(preflight.preflightFingerprint), false);
    const intentId = createdPurchaseIntent.purchaseIntent.id;
    const target = createdPurchaseIntent.purchaseIntent.targets[0];
    assert.ok(target);
    assert.equal(target.maxUnitPriceCents, 6999);
    assert.equal(target.sellerPolicy, "first_party_only");
    assert.equal(target.fulfillment, "shipping");
    const duplicateIntent = await fetch(`${baseUrl}/api/v1/user/purchase-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        contractVersion: 1,
        listingId: String(libraryPage.items[0]?.listingId ?? ""),
        targetQuantity: 1,
        maxUnitPriceCents: 6999,
        maxAllInCents: 6999,
        actionCeiling: "notify",
        sellerPolicy: "first_party_only",
        fulfillment: "shipping",
        substitutionPolicy: "exact_only",
        cooldownSeconds: 900,
        confirmation: "CREATE_EXACT_PURCHASE_PLAN"
      })
    });
    assert.equal(duplicateIntent.status, 409);
    assert.equal((await duplicateIntent.json() as { error: string }).error, "purchase_intent_exists");
    const malformedContract = await fetch(`${baseUrl}/api/v1/user/purchase-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        contractVersion: "1",
        listingId: String(libraryPage.items[0]?.listingId ?? ""),
        targetQuantity: "1",
        maxUnitPriceCents: "6999",
        maxAllInCents: "6999",
        actionCeiling: "notify",
        sellerPolicy: "first_party_only",
        fulfillment: "shipping",
        substitutionPolicy: "exact_only",
        cooldownSeconds: "0",
        confirmation: "CREATE_EXACT_PURCHASE_PLAN"
      })
    });
    assert.equal(malformedContract.status, 400);
    assert.equal((await malformedContract.json() as { error: string }).error, "purchase_intent_contract_unsupported");
    const updateIntent = await fetch(`${baseUrl}/api/v1/user/purchase-intents/${encodeURIComponent(intentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        status: "active",
        targetQuantity: 2,
        targets: [{
          id: target.id,
          enabled: true,
          maxUnitPriceCents: 6999,
          sellerPolicy: "first_party_only",
          fulfillment: "shipping"
        }],
        policy: {
          expectedRevision: 1,
          maxAllInCents: 19_000,
          actionCeiling: "add_to_cart",
          decisionMode: "purchase_intent",
          maxSignalAgeSeconds: 120,
          substitutionPolicy: "exact_only",
          cooldownSeconds: 60,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString()
        }
      })
    });
    assert.equal(updateIntent.status, 200);
    const updatedIntent = await updateIntent.json() as {
      purchaseIntent: { intentPolicy: { revision: number; maxAllInCents: number; decisionMode: string } };
    };
    assert.equal(updatedIntent.purchaseIntent.intentPolicy.revision, 2);
    assert.equal(updatedIntent.purchaseIntent.intentPolicy.maxAllInCents, 19_000);
    assert.equal(updatedIntent.purchaseIntent.intentPolicy.decisionMode, "purchase_intent");
    const staleUpdate = await fetch(`${baseUrl}/api/v1/user/purchase-intents/${encodeURIComponent(intentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        status: "active",
        targetQuantity: 2,
        targets: [{
          id: target.id, enabled: true, maxUnitPriceCents: 6999,
          sellerPolicy: "first_party_only", fulfillment: "shipping"
        }],
        policy: { expectedRevision: 1, maxAllInCents: 15_000 }
      })
    });
    assert.equal(staleUpdate.status, 409);
    assert.equal((await staleUpdate.json() as { error: string }).error, "intent_revision_conflict");

    const spendResponse = await fetch(`${baseUrl}/api/v1/user/spend-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        expectedRevision: 1,
        perOrderCapCents: 20_000,
        dailyCapCents: 30_000,
        monthlyCapCents: 100_000
      })
    });
    assert.equal(spendResponse.status, 200);
    assert.equal((await spendResponse.json() as { summary: { policy: { revision: number } } }).summary.policy.revision, 2);
    const spendLedger = await fetch(`${baseUrl}/api/v1/user/spend-ledger`).then((response) => response.json()) as {
      items: unknown[];
      summary: { activeReservedCents: number; spentTodayCents: number };
    };
    assert.deepEqual(spendLedger.items, []);
    assert.equal(spendLedger.summary.activeReservedCents, 0);
    assert.equal(spendLedger.summary.spentTodayCents, 0);

    const updatedMissionPage = await fetch(`${baseUrl}/api/v1/user/purchase-intents?limit=1&offset=0`).then((response) => response.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    assert.equal(updatedMissionPage.total, 1);
    assert.equal(updatedMissionPage.items[0]?.title, "Yoink API Test Product");
    assert.equal(updatedMissionPage.items[0]?.intentRevision, 2);
    assert.equal(
      (updatedMissionPage.items[0]?.automationReadiness as Record<string, unknown>)?.state,
      "guarded_add_lane_closed"
    );
    const activity = await fetch(`${baseUrl}/api/v1/audit?limit=10&q=test_signal`).then((response) => response.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
      outbox: { pendingOutboxEvents: number };
    };
    assert.ok(activity.total >= 1);
    assert.ok(activity.items.length >= 1);
    assert.ok(activity.outbox.pendingOutboxEvents >= 1);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});

test("the loopback API rejects a foreign browser origin for mutations", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/settings/actions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify({ paused: false })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { error: string }).error, "origin_rejected");
    const rejectedDelete = await fetch(`http://127.0.0.1:${address.port}/api/v1/community/contributions`, {
      method: "DELETE",
      headers: { Origin: "https://attacker.example" }
    });
    assert.equal(rejectedDelete.status, 403);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});

test("Chrome pairing uses a one-time code and authenticated heartbeat", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
  try {
    const codeResponse = await fetch(`${baseUrl}/api/v1/devices/pairing-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    });
    assert.equal(codeResponse.status, 201);
    const code = (await codeResponse.json() as { pairing: { code: string } }).pairing.code;

    const foreignPair = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify({ pairingCode: code })
    });
    assert.equal(foreignPair.status, 403);

    const pairResponse = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({
        pairingCode: code,
        name: "Desktop - Windows - Chrome",
        platform: "windows-chrome",
        extensionVersion: "0.11.0",
        capabilities: {
          readiness: true,
          jobReconciliation: true,
          communityReadOnlyEvidence: true,
          exactSelectedOfferEvidence: true,
          retailerMutation: false,
          targetAddOnly: true,
          targetAddAdapterVersion: "target-add-v1",
          walmartAddOnly: true,
          walmartAddAdapterVersion: "walmart-add-v3",
          amazonAddOnly: true,
          amazonAddAdapterVersion: "amazon-add-v5",
          bestBuyAddOnly: true,
          bestBuyAddAdapterVersion: "bestbuy-add-v3"
        }
      })
    });
    assert.equal(pairResponse.status, 201);
    const paired = (await pairResponse.json() as { device: { id: string; token: string } }).device;
    assert.ok(paired.id);
    assert.match(paired.token, /^[A-Za-z0-9_-]{40,100}$/);

    const reused = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ pairingCode: code })
    });
    assert.equal(reused.status, 400);

    const heartbeat = await fetch(`${baseUrl}/api/v1/devices/self/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        platform: "windows-chrome",
        extensionVersion: "0.11.0",
        capabilities: {
          readiness: true,
          jobReconciliation: true,
          communityReadOnlyEvidence: true,
          exactSelectedOfferEvidence: true,
          retailerMutation: false,
          targetAddOnly: true,
          targetAddAdapterVersion: "target-add-v1",
          walmartAddOnly: true,
          walmartAddAdapterVersion: "walmart-add-v3",
          amazonAddOnly: true,
          amazonAddAdapterVersion: "amazon-add-v5",
          bestBuyAddOnly: true,
          bestBuyAddAdapterVersion: "bestbuy-add-v3"
        }
      })
    });
    assert.equal(heartbeat.status, 200);
    const heartbeatBody = await heartbeat.json() as { controlPlane: { retailerMutationEnabled: boolean } };
    assert.equal(heartbeatBody.controlPlane.retailerMutationEnabled, false);

    const diagnosticResponse = await fetch(`${baseUrl}/api/v1/devices/self/adapter-diagnostics/bestbuy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        contractVersion: 1,
        observedAt: new Date().toISOString(),
        retailerId: "bestbuy",
        retailerSku: "6612619",
        adapterVersion: "bestbuy-observer-v5",
        operation: "observe",
        outcome: "failed",
        failureStage: "add_control",
        reasonCode: "add_control_selector_miss",
        attemptCount: 1,
        domChanged: false,
        rawDom: "DO_NOT_STORE",
        layout: {
          schemaVersion: 1,
          pageKind: "product",
          scopeKind: "none",
          sellerShape: "legacy",
          fulfillmentShape: "shipping",
          addControlCount: 0,
          genericAddIntentCount: 1,
          scopedControlCount: 0,
          explicitSkuInputCount: 0,
          exactSkuInputCount: 0,
          variationSkuCount: 0,
          canonicalOfferInputCount: 0,
          canonicalOfferDistinctCount: 0,
          alternateOfferInputCount: 0,
          alternateOfferDistinctCount: 0,
          priceCandidateCount: 1,
          quantityControlCount: 0,
          securityChallenge: false,
          interactiveBlock: "",
          pageText: "DO_NOT_STORE",
          repairLandmarks: [{
            field: "addControl",
            elementKind: "role_button",
            attribute: "data-testid",
            value: "pdp-add-to-cart-control",
            textContent: "DO_NOT_STORE"
          }]
        }
      })
    });
    assert.equal(diagnosticResponse.status, 201);
    const diagnosticBody = await diagnosticResponse.json() as { diagnostic: { layout: Record<string, unknown> } };
    assert.equal(JSON.stringify(diagnosticBody).includes("DO_NOT_STORE"), false);

    const nextJob = await fetch(`${baseUrl}/api/v1/devices/self/jobs/next`, {
      headers: { Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` }
    });
    assert.equal(nextJob.status, 200);
    assert.deepEqual(await nextJob.json(), { job: null, reason: "shadow_mode" });

    const shadowResponse = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/target`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "target-observer-v1",
        contractVersion: 1,
        observedAt: new Date().toISOString(),
        pageKind: "product",
        retailerId: "target",
        retailerSku: "1011483414",
        availability: "in_stock",
        unitPriceCents: 5999,
        currency: "USD",
        sellerName: "Target",
        sellerType: "first_party",
        fulfillment: "shipping",
        addControlActionable: true,
        securityChallenge: false,
        interactiveBlock: "",
        selectedOffer: {
          schemaVersion: 1,
          selectionState: "exact",
          childOfferKey: "1011483414",
          attributes: {}
        },
        cookie: "DO_NOT_STORE"
      })
    });
    assert.equal(shadowResponse.status, 201);
    const shadow = (await shadowResponse.json() as { observation: Record<string, unknown> }).observation;
    assert.equal(shadow.observationState, "actionable_candidate");
    assert.equal(shadow.canonicalUrl, "https://www.target.com/p/-/A-1011483414");
    assert.equal("cookie" in shadow, false);

    const consentResponse = await fetch(`${baseUrl}/api/v1/community/consents/target`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        enabled: true,
        locationScope: "country:US",
        privacyVersion: "community-readonly-v1",
        confirmation: "SHARE_READ_ONLY_STOCK_EVIDENCE"
      })
    });
    assert.equal(consentResponse.status, 200);
    const nonceResponse = await fetch(`${baseUrl}/api/v1/devices/self/community/nonces/target`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` },
      body: "{}"
    });
    assert.equal(nonceResponse.status, 201);
    const nonce = (await nonceResponse.json() as { nonce: string }).nonce;
    const contributionResponse = await fetch(`${baseUrl}/api/v1/devices/self/community/contributions/target`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` },
      body: JSON.stringify({
        contractVersion: 1,
        nonce,
        shadowObservationId: shadow.id,
        rawDom: "DO_NOT_STORE"
      })
    });
    assert.equal(contributionResponse.status, 201);
    const contribution = await contributionResponse.json() as {
      receipt: { disposition: string };
      assertion: Record<string, unknown>;
    };
    assert.equal(contribution.receipt.disposition, "accepted");
    assert.equal(contribution.assertion.retailerSku, "1011483414");
    const replay = await fetch(`${baseUrl}/api/v1/devices/self/community/contributions/target`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` },
      body: JSON.stringify({ contractVersion: 1, nonce, shadowObservationId: shadow.id })
    });
    assert.equal(replay.status, 400);

    const rehearsalResponse = await fetch(`${baseUrl}/api/v1/devices/self/qualification-trials/target-add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "target-add-v1",
        observerVersion: "target-observer-v1",
        contractVersion: 1,
        shadowObservationId: shadow.id,
        observedAt: new Date().toISOString(),
        outcome: "passed",
        reasonCode: "verified",
        cookie: "DO_NOT_STORE"
      })
    });
    assert.equal(rehearsalResponse.status, 201);
    const rehearsal = (await rehearsalResponse.json() as { trial: Record<string, unknown> }).trial;
    assert.equal(rehearsal.outcome, "passed");
    assert.equal("cookie" in rehearsal, false);

    const snapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      devices: Array<Record<string, unknown>>;
      counts: Record<string, number>;
      shadowObservations: Array<Record<string, unknown>>;
      community: {
        advisoryOnly: boolean;
        mutationAuthority: boolean;
        contributorVotePolicy: string;
        priceProjectionMethod: string;
        productionSharedPlane: boolean;
        assertions: Array<Record<string, unknown>>;
        aggregates: Array<Record<string, unknown>>;
      };
      adapterRepairQueue: Array<{
        repairSuggestions: Array<{
          selector: string;
          distinctDeviceCount: number;
          distinctSkuCount: number;
          reviewState: string;
          executable: boolean;
        }>;
      }>;
      targetQualification: {
        liveEvidenceReady: boolean;
        rehearsalReady: boolean;
        qualificationEvidenceReady: boolean;
        addToCartQualified: boolean;
        mutationAuthorized: boolean;
        distinctSkuCount: number;
        qualificationEvidenceHash: string;
        checks: Array<{ id: string; met: boolean }>;
      };
    };
    assert.equal(snapshot.counts.devices, 1);
    assert.equal(snapshot.counts.onlineDevices, 1);
    assert.equal(snapshot.counts.shadowObservations, 1);
    assert.equal(snapshot.counts.communityAssertions, 1);
    assert.equal(snapshot.community.advisoryOnly, true);
    assert.equal(snapshot.community.mutationAuthority, false);
    assert.equal(snapshot.community.contributorVotePolicy, "latest_eligible_per_user");
    assert.equal(snapshot.community.priceProjectionMethod, "median");
    assert.equal(snapshot.community.productionSharedPlane, false);
    assert.equal(snapshot.community.assertions.length, 1);
    assert.equal(snapshot.community.aggregates[0]?.publicationState, "insufficient_quorum");
    assert.equal(snapshot.community.aggregates[0]?.currentContributorVoteCount, 1);
    assert.equal(snapshot.community.aggregates[0]?.priceProjectionMethod, "median");
    assert.deepEqual(snapshot.adapterRepairQueue[0]?.repairSuggestions, [{
      field: "addControl",
      selector: "[role='button'][data-testid='pdp-add-to-cart-control']",
      mode: "disabled_state",
      occurrenceCount: 1,
      distinctDeviceCount: 1,
      distinctSkuCount: 1,
      minimumDeviceCount: 3,
      minimumSkuCount: 2,
      reviewState: "collecting_evidence",
      executable: false
    }]);
    assert.equal(snapshot.shadowObservations[0]?.retailerSku, "1011483414");
    assert.equal(snapshot.targetQualification.liveEvidenceReady, false);
    assert.equal(snapshot.targetQualification.rehearsalReady, true);
    assert.equal(snapshot.targetQualification.qualificationEvidenceReady, false);
    assert.equal(snapshot.targetQualification.addToCartQualified, false);
    assert.equal(snapshot.targetQualification.mutationAuthorized, false);
    assert.equal(snapshot.targetQualification.distinctSkuCount, 1);
    assert.equal(snapshot.targetQualification.checks.find((check) => check.id === "first_party_actionable")?.met, true);
    assert.equal(JSON.stringify(snapshot).includes(paired.token), false);
    assert.equal(JSON.stringify(snapshot).includes("DO_NOT_STORE"), false);
    assert.equal(JSON.stringify(db.all("SELECT * FROM community_inventory_assertions")).includes("DO_NOT_STORE"), false);
    assert.equal(JSON.stringify(db.all("SELECT * FROM retailer_shadow_observations")).includes("DO_NOT_STORE"), false);

    const secondShadowResponse = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/target`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "target-observer-v1",
        contractVersion: 1,
        observedAt: new Date().toISOString(),
        pageKind: "product",
        retailerId: "target",
        retailerSku: "202258620",
        availability: "in_stock",
        unitPriceCents: 4499,
        currency: "USD",
        sellerName: "Target",
        sellerType: "first_party",
        fulfillment: "shipping",
        addControlActionable: true,
        securityChallenge: false,
        interactiveBlock: ""
      })
    });
    assert.equal(secondShadowResponse.status, 201);
    const readySnapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      targetQualification: {
        qualificationEvidenceReady: boolean;
        qualificationEvidenceHash: string;
      };
    };
    assert.equal(readySnapshot.targetQualification.qualificationEvidenceReady, true);
    const activation = await fetch(`${baseUrl}/api/v1/qualifications/target-add/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        adapterVersion: "target-add-v1",
        evidenceHash: readySnapshot.targetQualification.qualificationEvidenceHash,
        confirmation: "ENABLE_TARGET_ADD_V1"
      })
    });
    assert.equal(activation.status, 200);
    const activationBody = await activation.json() as { readiness: { mutationAuthorized: boolean; addToCartQualified: boolean } };
    assert.equal(activationBody.readiness.addToCartQualified, true);
    assert.equal(activationBody.readiness.mutationAuthorized, true);
    const liveHealth = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(liveHealth.executionMode, "live");
    assert.equal(liveHealth.actionsPaused, false);
    assert.equal(liveHealth.chromeMutationEnabled, true);

    const pause = await fetch(`${baseUrl}/api/v1/settings/actions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ paused: true })
    });
    assert.equal(pause.status, 200);
    const resume = await fetch(`${baseUrl}/api/v1/settings/actions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ paused: false })
    });
    assert.equal(resume.status, 200);

    const walmartShadowIds: string[] = [];
    for (const [retailerSku, unitPriceCents] of [["17354421975", 4499], ["98765432101", 3999]] as const) {
      const response = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/walmart`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: extensionOrigin,
          Authorization: `Bearer ${paired.token}`
        },
        body: JSON.stringify({
          adapterVersion: "walmart-observer-v4",
          contractVersion: 1,
          observedAt: new Date().toISOString(),
          pageKind: "product",
          retailerId: "walmart",
          retailerSku,
          availability: "in_stock",
          unitPriceCents,
          currency: "USD",
          sellerName: "Walmart",
          sellerType: "first_party",
          fulfillment: "shipping",
          addControlActionable: true,
          securityChallenge: false,
          interactiveBlock: ""
        })
      });
      assert.equal(response.status, 201);
      walmartShadowIds.push(String((await response.json() as { observation: { id: string } }).observation.id));
    }
    const walmartRehearsal = await fetch(`${baseUrl}/api/v1/devices/self/qualification-trials/walmart-add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "walmart-add-v3",
        observerVersion: "walmart-observer-v4",
        contractVersion: 1,
        shadowObservationId: walmartShadowIds[0],
        observedAt: new Date().toISOString(),
        outcome: "passed",
        reasonCode: "verified"
      })
    });
    assert.equal(walmartRehearsal.status, 201);
    const walmartReadySnapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      walmartQualification: { qualificationEvidenceReady: boolean; qualificationEvidenceHash: string };
    };
    assert.equal(walmartReadySnapshot.walmartQualification.qualificationEvidenceReady, true);
    const walmartActivation = await fetch(`${baseUrl}/api/v1/qualifications/walmart-add/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        adapterVersion: "walmart-add-v3",
        evidenceHash: walmartReadySnapshot.walmartQualification.qualificationEvidenceHash,
        confirmation: "ENABLE_WALMART_ADD_V3"
      })
    });
    assert.equal(walmartActivation.status, 200);
    const walmartActivationBody = await walmartActivation.json() as {
      readiness: { addToCartQualified: boolean; mutationAuthorized: boolean };
    };
    assert.equal(walmartActivationBody.readiness.addToCartQualified, true);
    assert.equal(walmartActivationBody.readiness.mutationAuthorized, true);
    const dualLaneHealth = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(dualLaneHealth.targetAddExecutionEnabled, true);
    assert.equal(dualLaneHealth.walmartAddExecutionEnabled, true);

    const amazonShadowIds: string[] = [];
    for (const [retailerSku, unitPriceCents] of [["B0GYTRYV7P", 2186], ["B0AMZN0001", 3199]] as const) {
      const response = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/amazon`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: extensionOrigin,
          Authorization: `Bearer ${paired.token}`
        },
        body: JSON.stringify({
          adapterVersion: "amazon-observer-v6",
          contractVersion: 1,
          observedAt: new Date().toISOString(),
          pageKind: "product",
          retailerId: "amazon",
          retailerSku,
          availability: "in_stock",
          unitPriceCents,
          currency: "USD",
          sellerName: "Amazon.com",
          sellerType: "first_party",
          fulfillment: "shipping",
          addControlActionable: true,
          securityChallenge: false,
          interactiveBlock: "",
          purchaseRouteKind: "amazon_buy_now",
          purchaseRouteReady: true,
          routeReasonCode: "offer_route_verified"
        })
      });
      assert.equal(response.status, 201);
      amazonShadowIds.push(String((await response.json() as { observation: { id: string } }).observation.id));
    }
    const amazonRehearsal = await fetch(`${baseUrl}/api/v1/devices/self/qualification-trials/amazon-add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "amazon-add-v5",
        observerVersion: "amazon-observer-v6",
        contractVersion: 1,
        shadowObservationId: amazonShadowIds[0],
        observedAt: new Date().toISOString(),
        outcome: "passed",
        reasonCode: "verified"
      })
    });
    assert.equal(amazonRehearsal.status, 201);
    const amazonReadySnapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      amazonQualification: { qualificationEvidenceReady: boolean; qualificationEvidenceHash: string };
    };
    assert.equal(amazonReadySnapshot.amazonQualification.qualificationEvidenceReady, true);
    const amazonActivation = await fetch(`${baseUrl}/api/v1/qualifications/amazon-add/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        adapterVersion: "amazon-add-v5",
        evidenceHash: amazonReadySnapshot.amazonQualification.qualificationEvidenceHash,
        confirmation: "ENABLE_AMAZON_ADD_V5"
      })
    });
    assert.equal(amazonActivation.status, 200);
    const amazonActivationBody = await amazonActivation.json() as {
      readiness: { addToCartQualified: boolean; mutationAuthorized: boolean };
    };
    assert.equal(amazonActivationBody.readiness.addToCartQualified, true);
    assert.equal(amazonActivationBody.readiness.mutationAuthorized, true);
    const tripleLaneHealth = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(tripleLaneHealth.amazonAddExecutionEnabled, true);

    const bestBuyShadowIds: string[] = [];
    for (const [retailerSku, unitPriceCents] of [["6588149", 699], ["6550001", 1299]] as const) {
      const response = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/bestbuy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: extensionOrigin,
          Authorization: `Bearer ${paired.token}`
        },
        body: JSON.stringify({
          adapterVersion: "bestbuy-observer-v5",
          contractVersion: 1,
          observedAt: new Date().toISOString(),
          pageKind: "product",
          retailerId: "bestbuy",
          retailerSku,
          availability: "in_stock",
          unitPriceCents,
          currency: "USD",
          sellerName: "Best Buy",
          sellerType: "first_party",
          fulfillment: "shipping",
          addControlActionable: true,
          securityChallenge: false,
          interactiveBlock: ""
        })
      });
      assert.equal(response.status, 201);
      bestBuyShadowIds.push(String((await response.json() as { observation: { id: string } }).observation.id));
    }
    const bestBuyRehearsal = await fetch(`${baseUrl}/api/v1/devices/self/qualification-trials/bestbuy-add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "bestbuy-add-v3",
        observerVersion: "bestbuy-observer-v5",
        contractVersion: 1,
        shadowObservationId: bestBuyShadowIds[0],
        observedAt: new Date().toISOString(),
        outcome: "passed",
        reasonCode: "verified"
      })
    });
    assert.equal(bestBuyRehearsal.status, 201);
    const bestBuyReadySnapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      bestBuyQualification: { qualificationEvidenceReady: boolean; qualificationEvidenceHash: string };
    };
    assert.equal(bestBuyReadySnapshot.bestBuyQualification.qualificationEvidenceReady, true);
    const bestBuyActivation = await fetch(`${baseUrl}/api/v1/qualifications/bestbuy-add/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        adapterVersion: "bestbuy-add-v3",
        evidenceHash: bestBuyReadySnapshot.bestBuyQualification.qualificationEvidenceHash,
        confirmation: "ENABLE_BESTBUY_ADD_V3"
      })
    });
    assert.equal(bestBuyActivation.status, 200);
    const bestBuyActivationBody = await bestBuyActivation.json() as {
      readiness: { addToCartQualified: boolean; mutationAuthorized: boolean };
    };
    assert.equal(bestBuyActivationBody.readiness.addToCartQualified, true);
    assert.equal(bestBuyActivationBody.readiness.mutationAuthorized, true);
    const fourLaneHealth = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(fourLaneHealth.bestBuyAddExecutionEnabled, true);

    const disneyObservation = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/disney`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "disney-observer-v1",
        contractVersion: 1,
        observedAt: new Date().toISOString(),
        pageKind: "product",
        retailerId: "disney",
        retailerSku: "409914998395",
        canonicalUrl: "https://www.disneystore.com/dumbo-jeweled-figurine-409914998395.html?CMP=DO_NOT_STORE",
        availability: "in_stock",
        unitPriceCents: 12900,
        currency: "USD",
        sellerName: "Disney Store",
        sellerType: "first_party",
        fulfillment: "shipping",
        addControlActionable: true,
        securityChallenge: false,
        interactiveBlock: "",
        purchaseRouteKind: "none",
        purchaseRouteReady: false,
        routeReasonCode: "not_applicable"
      })
    });
    assert.equal(disneyObservation.status, 201);
    const disneyStored = (await disneyObservation.json() as { observation: Record<string, unknown> }).observation;
    assert.equal(disneyStored.canonicalUrl, "https://www.disneystore.com/dumbo-jeweled-figurine-409914998395.html");
    assert.equal(db.get<{ execution_supported: number }>(
      "SELECT execution_supported FROM retailers WHERE id = 'disney'"
    )?.execution_supported, 0);
    const expandedSnapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      retailerEvidence: Array<{ retailerId: string; mode: string; observationCount: number }>;
    };
    assert.equal(expandedSnapshot.retailerEvidence.find((item) => item.retailerId === "disney")?.mode, "read_only");
    assert.equal(expandedSnapshot.retailerEvidence.find((item) => item.retailerId === "disney")?.observationCount, 1);

    const revoke = await fetch(`${baseUrl}/api/v1/devices/${paired.id}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    });
    assert.equal(revoke.status, 200);
    const rejectedHeartbeat = await fetch(`${baseUrl}/api/v1/devices/self/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` },
      body: "{}"
    });
    assert.equal(rejectedHeartbeat.status, 401);
    const rejectedShadow = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/target`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` },
      body: "{}"
    });
    assert.equal(rejectedShadow.status, 401);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});

test("Chrome device credential rotation is origin-bound, two-phase, and idempotently recoverable", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = `chrome-extension://${"b".repeat(32)}`;
  try {
    const code = (await fetch(`${baseUrl}/api/v1/devices/pairing-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    }).then((response) => response.json()) as { pairing: { code: string } }).pairing.code;
    const paired = (await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ pairingCode: code })
    }).then((response) => response.json()) as { device: { id: string; token: string } }).device;

    const foreignBegin = await fetch(`${baseUrl}/api/v1/devices/self/credential-rotation/begin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example", Authorization: `Bearer ${paired.token}` },
      body: "{}"
    });
    assert.equal(foreignBegin.status, 403);

    const begin = await fetch(`${baseUrl}/api/v1/devices/self/credential-rotation/begin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` },
      body: "{}"
    });
    assert.equal(begin.status, 201);
    const pending = (await begin.json() as { rotation: { token: string; generation: number; expiresAt: string } }).rotation;
    assert.match(pending.token, /^[A-Za-z0-9_-]{40,100}$/);
    assert.equal(pending.generation, 2);
    assert.ok(new Date(pending.expiresAt).getTime() > Date.now());

    const pendingCannotHeartbeat = await fetch(`${baseUrl}/api/v1/devices/self/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${pending.token}` },
      body: "{}"
    });
    assert.equal(pendingCannotHeartbeat.status, 401);
    const currentStillWorks = await fetch(`${baseUrl}/api/v1/devices/self/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` },
      body: "{}"
    });
    assert.equal(currentStillWorks.status, 200);
    assert.equal((await currentStillWorks.json() as { credential: { pending: boolean } }).credential.pending, true);

    const wrongGeneration = await fetch(`${baseUrl}/api/v1/devices/self/credential-rotation/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${pending.token}` },
      body: JSON.stringify({ generation: 3 })
    });
    assert.equal(wrongGeneration.status, 401);

    const commit = await fetch(`${baseUrl}/api/v1/devices/self/credential-rotation/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${pending.token}` },
      body: JSON.stringify({ generation: pending.generation })
    });
    assert.equal(commit.status, 200);
    const committed = (await commit.json() as {
      rotation: { deviceId: string; credential: { generation: number; pending: boolean } };
    }).rotation;
    assert.equal(committed.deviceId, paired.id);
    assert.equal(committed.credential.generation, 2);
    assert.equal(committed.credential.pending, false);

    const replay = await fetch(`${baseUrl}/api/v1/devices/self/credential-rotation/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${pending.token}` },
      body: JSON.stringify({ generation: pending.generation })
    });
    assert.equal(replay.status, 200);
    const newHeartbeat = await fetch(`${baseUrl}/api/v1/devices/self/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${pending.token}` },
      body: "{}"
    });
    assert.equal(newHeartbeat.status, 200);

    const snapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      devices: Array<{ id: string; credential: { generation: number; pending: boolean } }>;
    };
    assert.equal(snapshot.devices.find((device) => device.id === paired.id)?.credential.generation, 2);
    assert.equal(snapshot.devices.find((device) => device.id === paired.id)?.credential.pending, false);
    assert.equal(JSON.stringify(snapshot).includes(paired.token), false);
    assert.equal(JSON.stringify(snapshot).includes(pending.token), false);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'extension_device_credential_rotation_committed'"
    )?.count, 1);
    assert.ok(Number(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM operational_request_rollups WHERE route_key = 'device.credential_rotation'"
    )?.count) >= 1);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
