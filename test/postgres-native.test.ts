import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { PostgresBackgroundWorkerQualificationStore } from "../packages/database/src/postgres-background-worker-store.js";
import {
  applyPostgresRuntimeReadRoles,
  verifyPostgresRuntimeReadRoles
} from "../packages/database/src/postgres-runtime-roles.js";
import {
  NodePostgresCutoverDatabase,
  importPostgresCutoverArchive,
  type PostgresCutoverDatabase
} from "../packages/database/src/postgres-cutover.js";
import {
  NodePostgresTenantReadDatabase,
  POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE,
  applyPostgresTenantSessionBoundary,
  buildPostgresTenantSessionManifest,
  verifyPostgresTenantSessionBoundary
} from "../packages/database/src/postgres-tenant-session.js";
import {
  NodePostgresTenantQueueWriteDatabase,
  applyPostgresTenantQueueWriteBoundary,
  buildPostgresTenantQueueWriteManifest,
  verifyPostgresTenantQueueWriteBoundary
} from "../packages/database/src/postgres-tenant-queue-writes.js";
import {
  NodePostgresWorkerControlDatabase,
  applyPostgresWorkerControlBoundary,
  buildPostgresWorkerControlManifest,
  verifyPostgresWorkerControlBoundary
} from "../packages/database/src/postgres-worker-control.js";
import {
  NodePostgresNotificationRecoveryDatabase,
  applyPostgresNotificationRecoveryBoundary,
  buildPostgresNotificationRecoveryManifest,
  verifyPostgresNotificationRecoveryBoundary
} from "../packages/database/src/postgres-notification-recovery.js";
import {
  NodePostgresExecutionRecoveryDatabase,
  applyPostgresExecutionRecoveryBoundary,
  buildPostgresExecutionRecoveryManifest,
  verifyPostgresExecutionRecoveryBoundary
} from "../packages/database/src/postgres-execution-recovery.js";
import {
  NodePostgresOperationalRetentionDatabase,
  applyPostgresOperationalRetentionBoundary,
  buildPostgresOperationalRetentionManifest,
  verifyPostgresOperationalRetentionBoundary
} from "../packages/database/src/postgres-operational-retention.js";
import {
  NodePostgresObserverCandidateEvaluationDatabase,
  applyPostgresObserverCandidateEvaluationBoundary,
  buildPostgresObserverCandidateEvaluationManifest,
  verifyPostgresObserverCandidateEvaluationBoundary
} from "../packages/database/src/postgres-observer-repair-candidate-evaluation.js";
import {
  NodePostgresOperatorAlertConnectorDispatchDatabase,
  applyPostgresOperatorAlertConnectorDispatchBoundary,
  buildPostgresOperatorAlertConnectorDispatchManifest,
  verifyPostgresOperatorAlertConnectorDispatchBoundary
} from "../packages/database/src/postgres-operator-alert-connector-dispatch.js";
import {
  NodePostgresOperatorAlertReconciliationDatabase,
  applyPostgresOperatorAlertReconciliationBoundary,
  buildPostgresOperatorAlertReconciliationManifest,
  verifyPostgresOperatorAlertReconciliationBoundary
} from "../packages/database/src/postgres-operator-alert-reconciliation.js";
import {
  NodePostgresObserverWitnessState,
  applyPostgresObserverWitnessRefreshBoundary,
  buildPostgresObserverWitnessRefreshManifest,
  verifyPostgresObserverWitnessRefreshBoundary
} from "../packages/database/src/postgres-observer-witness-refresh.js";
import {
  NodePostgresHostedDeliveryLeaseRecoveryDatabase,
  applyPostgresHostedDeliveryLeaseRecoveryBoundary,
  buildPostgresHostedDeliveryLeaseRecoveryManifest,
  postgresHostedSignalResolutionPlanFingerprint,
  verifyPostgresHostedDeliveryLeaseRecoveryBoundary
} from "../packages/database/src/postgres-hosted-delivery-lease-recovery.js";
import {
  NodePostgresSignalCatalogApplyDatabase,
  POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION,
  applyPostgresSignalCatalogApplyBoundary,
  buildPostgresSignalCatalogApplyManifest,
  verifyPostgresSignalCatalogApplyBoundary
} from "../packages/database/src/postgres-signal-catalog-apply.js";
import {
  NodePostgresSignalResolutionApplyDatabase,
  POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION,
  applyPostgresSignalResolutionApplyBoundary,
  buildPostgresSignalResolutionApplyManifest,
  verifyPostgresSignalResolutionApplyBoundary
} from "../packages/database/src/postgres-signal-resolution-apply.js";
import {
  NodePostgresSignalSourceReferenceRefreshDatabase,
  POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION,
  applyPostgresSignalSourceReferenceRefreshBoundary,
  buildPostgresSignalSourceReferenceRefreshManifest,
  verifyPostgresSignalSourceReferenceRefreshBoundary
} from "../packages/database/src/postgres-signal-source-reference-refresh.js";
import {
  NodePostgresSignalTerminalDecisionApplyDatabase,
  POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION,
  applyPostgresSignalTerminalDecisionApplyBoundary,
  buildPostgresSignalTerminalDecisionApplyManifest,
  verifyPostgresSignalTerminalDecisionApplyBoundary
} from "../packages/database/src/postgres-signal-terminal-decision-apply.js";
import {
  NodePostgresSignalOfferIncidentApplyDatabase,
  POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION,
  applyPostgresSignalOfferIncidentApplyBoundary,
  buildPostgresSignalOfferIncidentApplyManifest,
  verifyPostgresSignalOfferIncidentApplyBoundary
} from "../packages/database/src/postgres-signal-offer-incident-apply.js";
import {
  NodePostgresSignalPostIncidentDecisionApplyDatabase,
  POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION,
  applyPostgresSignalPostIncidentDecisionApplyBoundary,
  buildPostgresSignalPostIncidentDecisionApplyManifest,
  verifyPostgresSignalPostIncidentDecisionApplyBoundary
} from "../packages/database/src/postgres-signal-post-incident-decision-apply.js";
import {
  NodePostgresSignalMissionBindingApplyDatabase,
  POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION,
  applyPostgresSignalMissionBindingApplyBoundary,
  buildPostgresSignalMissionBindingApplyManifest,
  verifyPostgresSignalMissionBindingApplyBoundary
} from "../packages/database/src/postgres-signal-mission-binding-apply.js";
import {
  NodePostgresSignalStrategyEvaluationApplyDatabase,
  POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION,
  applyPostgresSignalStrategyEvaluationApplyBoundary,
  buildPostgresSignalStrategyEvaluationApplyManifest,
  verifyPostgresSignalStrategyEvaluationApplyBoundary
} from "../packages/database/src/postgres-signal-strategy-evaluation-apply.js";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION,
  applyPostgresSignalWriterLockProtocolBoundary,
  buildPostgresSignalWriterLockProtocolManifest,
  verifyPostgresSignalWriterLockProtocolBoundary
} from "../packages/database/src/postgres-signal-writer-lock-protocol.js";
import {
  NodePostgresSignalConstraintConfigApplyDatabase,
  POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_FUNCTION,
  applyPostgresSignalConstraintConfigApplyBoundary,
  buildPostgresSignalConstraintConfigApplyManifest,
  verifyPostgresSignalConstraintConfigApplyBoundary
} from "../packages/database/src/postgres-signal-constraint-config-apply.js";
import {
  NodePostgresSignalActionSpendApplyDatabase,
  POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_ACTION_SPEND_APPLY_FUNCTION,
  applyPostgresSignalActionSpendApplyBoundary,
  buildPostgresSignalActionSpendApplyManifest,
  type PostgresSignalActionSpendApplyResult,
  verifyPostgresSignalActionSpendApplyBoundary
} from "../packages/database/src/postgres-signal-action-spend-apply.js";
import {
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_LENGTH,
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_ORDER,
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION,
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT,
  buildPostgresSignalEvaluationCompositionManifest,
  postgresSignalEvaluationCompositionCapabilityProjection,
  verifyPostgresSignalEvaluationCompositionBoundary
} from "../packages/database/src/postgres-signal-evaluation-composition.js";
import {
  NodePostgresSignalTargetQualificationApplyDatabase,
  POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_FUNCTION,
  applyPostgresSignalTargetQualificationApplyBoundary,
  buildPostgresSignalTargetQualificationApplyManifest,
  verifyPostgresSignalTargetQualificationApplyBoundary
} from "../packages/database/src/postgres-signal-target-qualification-apply.js";
import {
  NodePostgresSignalSourceTrustApplyDatabase,
  POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_FUNCTION,
  applyPostgresSignalSourceTrustApplyBoundary,
  buildPostgresSignalSourceTrustApplyManifest,
  verifyPostgresSignalSourceTrustApplyBoundary
} from "../packages/database/src/postgres-signal-source-trust-apply.js";
import {
  NodePostgresSignalRetailerQualificationApplyDatabase,
  POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_FUNCTION,
  applyPostgresSignalRetailerQualificationApplyBoundary,
  buildPostgresSignalRetailerQualificationApplyManifest,
  verifyPostgresSignalRetailerQualificationApplyBoundary
} from "../packages/database/src/postgres-signal-retailer-qualification-apply.js";
import {
  NodePostgresSignalMissionPolicyApplyDatabase,
  POSTGRES_SIGNAL_MISSION_POLICY_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_MISSION_POLICY_APPLY_FUNCTION,
  applyPostgresSignalMissionPolicyApplyBoundary,
  buildPostgresSignalMissionPolicyApplyManifest,
  verifyPostgresSignalMissionPolicyApplyBoundary
} from "../packages/database/src/postgres-signal-mission-policy-apply.js";
import {
  NodePostgresSignalSourceStatusApplyDatabase,
  POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_FUNCTION,
  applyPostgresSignalSourceStatusApplyBoundary,
  buildPostgresSignalSourceStatusApplyManifest,
  buildPostgresSignalSourceStatusRequestId,
  verifyPostgresSignalSourceStatusApplyBoundary,
  type PostgresSignalSourceStatusPayload
} from "../packages/database/src/postgres-signal-source-status-apply.js";
import {
  NodePostgresSignalSourceSyncApplyDatabase,
  POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_FUNCTION,
  applyPostgresSignalSourceSyncApplyBoundary,
  buildPostgresSignalSourceSyncApplyManifest,
  buildPostgresSignalSourceSyncRequestId,
  verifyPostgresSignalSourceSyncApplyBoundary,
  type PostgresSignalSourceSyncItemPayload,
  type PostgresSignalSourceSyncProgressPayload
} from "../packages/database/src/postgres-signal-source-sync-apply.js";
import {
  NodePostgresSignalReservationLifecycleApplyDatabase,
  POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_FUNCTION,
  applyPostgresSignalReservationLifecycleApplyBoundary,
  buildPostgresSignalReservationLifecycleApplyManifest,
  buildPostgresSignalReservationLifecycleRequestId,
  verifyPostgresSignalReservationLifecycleApplyBoundary,
  type PostgresSignalReservationLifecycleOperation,
  type PostgresSignalReservationLifecyclePayload
} from "../packages/database/src/postgres-signal-reservation-lifecycle-apply.js";
import {
  NodePostgresSignalCatalogImportApplyDatabase,
  POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_FUNCTION,
  applyPostgresSignalCatalogImportApplyBoundary,
  buildPostgresSignalCatalogImportApplyManifest,
  buildPostgresSignalCatalogImportRequestId,
  verifyPostgresSignalCatalogImportApplyBoundary,
  type PostgresSignalCatalogImportPayload
} from "../packages/database/src/postgres-signal-catalog-import-apply.js";
import {
  NodePostgresSignalSourceProvisioningApplyDatabase,
  POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_FUNCTION,
  POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULTS_VERSION,
  POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULT_SOURCES,
  applyPostgresSignalSourceProvisioningApplyBoundary,
  buildPostgresSignalSourceProvisioningApplyManifest,
  buildPostgresSignalSourceProvisioningRequestId,
  expectedDefaultSourceConnectionId,
  verifyPostgresSignalSourceProvisioningApplyBoundary,
  type PostgresSignalSourceProvisioningPayload
} from "../packages/database/src/postgres-signal-source-provisioning-apply.js";
import {
  NodePostgresSignalAttributionPolicyApplyDatabase,
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION,
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS,
  applyPostgresSignalAttributionPolicyApplyBoundary,
  buildPostgresSignalAttributionPolicyApplyManifest,
  buildPostgresSignalAttributionPolicyReplaceRequestId,
  normalizedPostgresSignalAttributionPolicyReplacePayload,
  verifyPostgresSignalAttributionPolicyApplyBoundary,
  type PostgresSignalAttributionPolicyReplacePayload
} from "../packages/database/src/postgres-signal-attribution-policy-apply.js";
import {
  NodePostgresSignalAttributionReceiptApplyDatabase,
  POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_FUNCTION,
  POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_OUTCOMES,
  applyPostgresSignalAttributionReceiptApplyBoundary,
  buildPostgresSignalAttributionReceiptApplyManifest,
  buildPostgresSignalAttributionReceiptRecordRequestId,
  normalizedPostgresSignalAttributionReceiptRecordPayload,
  verifyPostgresSignalAttributionReceiptApplyBoundary
} from "../packages/database/src/postgres-signal-attribution-receipt-apply.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { stableHash } from "../packages/domain/src/ids.js";
import { normalizeSignal } from "../packages/domain/src/normalize.js";
import {
  attestSignalPolicyEvaluation,
  signalPolicyEvaluationFingerprint,
  type SignalPolicyEvaluationAttestation
} from "../packages/domain/src/signal-policy-evaluation.js";
import { BackgroundMaintenanceHandler } from "../packages/engine/src/background-maintenance.js";
import { OperatorAlertConnectorDispatchService } from "../packages/engine/src/operator-alert-connector-dispatch.js";
import { OperatorAlertReconciliationService } from "../packages/engine/src/operator-alert-reconciliation.js";
import {
  ObserverRecipeWitnessRefreshError,
  PrincipalBoundObserverRecipeWitnessRefreshService
} from "../packages/engine/src/observer-recipe-witness-refresh.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";
import {
  createObserverRecipeWitnessReceipt,
  ObserverRecipeWitnessError,
  ObserverRecipeWitnessVerifier,
  observerRecipeWitnessReceiptHash,
  observerRecipeWitnessScopedLogId,
  type ObserverRecipeWitnessPublisher
} from "../packages/observer-registry/src/witness.js";
import type { OperatorAlertWebhookRegistry } from "../packages/engine/src/operator-alert-webhook.js";
import type { BackgroundWorkerContext } from "../packages/contracts/src/background-worker.js";
import type {
  AttributionPlan,
  AttributionPolicyUpdateInput,
  ListingContext,
  MissionContext,
  PurchaseIntentPolicy,
  SignalEventInput,
  StrategyDefinition
} from "../packages/contracts/src/index.js";
import {
  AMAZON_ADD_ACTIVATION_CONFIRMATION,
  AMAZON_ADD_ADAPTER_VERSION,
  AMAZON_OBSERVER_VERSION,
  BESTBUY_ADD_ACTIVATION_CONFIRMATION,
  BESTBUY_ADD_ADAPTER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  TARGET_ADD_ACTIVATION_CONFIRMATION,
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_OBSERVER_VERSION,
  WALMART_ADD_ACTIVATION_CONFIRMATION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION
} from "../packages/contracts/src/index.js";
import {
  POSTGRES_TEST_WORKER_FINGERPRINT,
  POSTGRES_TEST_WORKER_VERSION,
  createPostgresCutoverFixture
} from "./support/postgres-cutover-fixture.js";

const NATIVE_NOW = new Date("2026-08-25T17:00:00.000Z").getTime();
const NATIVE_SCHEMA = "yoink_native_qualification";
const NATIVE_ROLE_NAMESPACE = "yoink_native_q";
const NATIVE_TENANT = "tenant_cutover_other";
const NATIVE_USER = "user_cutover_other";
const NATIVE_SESSION_ROLE_NAMESPACE = "yoink_native_session";
const NATIVE_QUEUE_WRITE_ROLE_NAMESPACE = "yoink_native_queue_write";
const NATIVE_WORKER_CONTROL_ROLE_NAMESPACE = "yoink_native_worker_control";
const NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE = "yoink_native_notify";
const NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE = "yoink_native_execute";
const NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE = "yoink_native_retention";
const NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE = "yoink_native_candidate";
const NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE = "yoink_native_dispatch";
const NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE = "yoink_native_reconcile";
const NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE = "yoink_native_witness";
const NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE = "yoink_native_delivery";
const NATIVE_CATALOG_APPLY_ROLE_NAMESPACE = "yoink_native_catalog";
const NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE = "yoink_native_resolution";
const NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE = "yoink_native_ref";
const NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE = "yoink_native_terminal";
const NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE = "yoink_native_offer";
const NATIVE_POST_INCIDENT_DECISION_APPLY_ROLE_NAMESPACE = "yoink_native_post";
const NATIVE_MISSION_BINDING_APPLY_ROLE_NAMESPACE = "yoink_native_mission";
const NATIVE_STRATEGY_EVALUATION_APPLY_ROLE_NAMESPACE = "yoink_native_strategy";
const NATIVE_WRITER_LOCK_ROLE_NAMESPACE = "yoink_native_writer_lock";
const NATIVE_CONSTRAINT_CONFIG_APPLY_ROLE_NAMESPACE = "yoink_native_constraint_config";
const NATIVE_ACTION_SPEND_APPLY_ROLE_NAMESPACE = "yoink_native_action_spend";
const NATIVE_TARGET_QUALIFICATION_APPLY_ROLE_NAMESPACE = "yoink_native_target_qual";
const NATIVE_SOURCE_TRUST_APPLY_ROLE_NAMESPACE = "yoink_native_source_trust";
const NATIVE_RETAILER_QUALIFICATION_APPLY_ROLE_NAMESPACE = "yoink_native_retailer_qual";
const NATIVE_MISSION_POLICY_APPLY_ROLE_NAMESPACE = "yoink_native_policy";
const NATIVE_SOURCE_STATUS_APPLY_ROLE_NAMESPACE = "yoink_native_source_status";
const NATIVE_SOURCE_SYNC_APPLY_ROLE_NAMESPACE = "yoink_native_source_sync";
const NATIVE_RESERVATION_LIFECYCLE_APPLY_ROLE_NAMESPACE =
  "yoink_native_reservation";
const NATIVE_CATALOG_IMPORT_APPLY_ROLE_NAMESPACE = "yoink_native_catalog_import";
const NATIVE_SOURCE_PROVISIONING_APPLY_ROLE_NAMESPACE =
  "yoink_native_source_provisioning";
const NATIVE_ATTRIBUTION_POLICY_APPLY_ROLE_NAMESPACE =
  "yoink_native_attribution_pol";
const NATIVE_ATTRIBUTION_RECEIPT_APPLY_ROLE_NAMESPACE =
  "yoink_native_attribution_rcpt";
const NATIVE_PRINCIPAL_A = "yoink_native_principal_a";
const NATIVE_PRINCIPAL_B = "yoink_native_principal_b";
const NATIVE_PRINCIPAL_C = "yoink_native_principal_c";
const NATIVE_PRINCIPAL_UNMAPPED = "yoink_native_principal_unmapped";
const NATIVE_CONTROL_PRINCIPAL = "yoink_native_control_principal";
const NATIVE_PRINCIPAL_PASSWORD = "yoink_native_principal_only";
const NATIVE_SAME_TENANT_USER = "user_cutover_other_peer";
const NATIVE_ALERT_BINDING = "b".repeat(64);
const NATIVE_ALERT_REGISTRY: OperatorAlertWebhookRegistry = Object.freeze({
  definitions: Object.freeze([Object.freeze({
    reference: "ops_primary",
    endpoint: "https://alerts.example.com/v1/yoink",
    signingSecretEnvironment: "YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY",
    bindingFingerprint: NATIVE_ALERT_BINDING
  })]),
  bindings: Object.freeze({ ops_primary: NATIVE_ALERT_BINDING }),
  fingerprint: "a".repeat(64)
});

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("A temporary PostgreSQL test port was unavailable."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function insertProbeTask(
  database: PostgresCutoverDatabase,
  id: string,
  priority: number,
  scheduledFor: string
): Promise<void> {
  await database.query(
    `INSERT INTO "${NATIVE_SCHEMA}"."background_tasks"(
       id, tenant_id, subject_user_id, task_kind, dedupe_key, state, priority,
       attempt_count, maximum_attempts, scheduled_for, privacy_classification,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'observer_recipe_witness_refresh', $4, 'pending', $5,
               0, 3, $6, 'operational_aggregate', $6, $6)`,
    [id, NATIVE_TENANT, NATIVE_USER, `native:${id}`, priority, scheduledFor]
  );
}

async function insertNotificationRecoveryFixtures(
  database: PostgresCutoverDatabase,
  recoveryNow: number
): Promise<{ expiredLeaseAt: string; currentLeaseAt: string }> {
  const createdAt = new Date(recoveryNow - 7_200_000).toISOString();
  const expiredLeaseAt = new Date(recoveryNow - 60_000).toISOString();
  const currentLeaseAt = new Date(recoveryNow + 60_000).toISOString();
  const currentJobExpiresAt = new Date(recoveryNow + 3_600_000).toISOString();
  await database.query(
    `INSERT INTO "${NATIVE_SCHEMA}"."mission_targets"(
       id, mission_id, listing_id, created_at, updated_at
     ) VALUES
       ('native_notify_target_other', 'mission_cutover_other', 'listing_cutover_scope', $1, $1),
       ('native_notify_target_local', 'mission_cutover_local', 'listing_cutover_scope', $1, $1)`,
    [createdAt]
  );
  await database.query(
    `INSERT INTO "${NATIVE_SCHEMA}"."signal_incidents"(
       id, tenant_id, user_id, listing_id, event_type, semantic_key, first_observed_at,
       last_observed_at, created_at, updated_at
     ) VALUES ('native_notify_incident', $1, $2, 'listing_cutover_scope', 'restock',
               'native-notification-recovery', $3, $3, $3, $3)`,
    [NATIVE_TENANT, NATIVE_USER, createdAt]
  );
  const jobs = [
    ["native_notify_expired", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", expiredLeaseAt],
    ["native_notify_failed", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", currentJobExpiresAt],
    ["native_notify_requeued", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", currentJobExpiresAt],
    ["native_notify_current", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", currentJobExpiresAt],
    ["native_notify_cross_tenant", "tenant_local", "user_local", "mission_cutover_local", "native_notify_target_local", expiredLeaseAt]
  ] as const;
  for (const [id, tenantId, userId, missionId, missionTargetId, expiresAt] of jobs) {
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."action_jobs"(
         id, tenant_id, user_id, mission_id, mission_target_id, incident_id,
         state, action, quantity, seller_policy, fulfillment, listing_id,
         canonical_url, idempotency_key, capability_nonce_hash, expires_at,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'native_notify_incident',
                 'awaiting_executor', 'notify', 1, 'any', 'shipping',
                 'listing_cutover_scope', 'https://www.target.com/p/-/A-cutover-scope-sku',
                 $6, $7, $8, $9, $9)`,
      [id, tenantId, userId, missionId, missionTargetId, `idempotency:${id}`, `nonce:${id}`, expiresAt, createdAt]
    );
  }
  const deliveries = [
    ["native_delivery_expired", NATIVE_TENANT, NATIVE_USER, "native_notify_expired", "pending", 0, ""],
    ["native_delivery_failed", NATIVE_TENANT, NATIVE_USER, "native_notify_failed", "leased", 3, expiredLeaseAt],
    ["native_delivery_requeued", NATIVE_TENANT, NATIVE_USER, "native_notify_requeued", "leased", 2, expiredLeaseAt],
    ["native_delivery_current", NATIVE_TENANT, NATIVE_USER, "native_notify_current", "leased", 2, currentLeaseAt],
    ["native_delivery_cross_tenant", "tenant_local", "user_local", "native_notify_cross_tenant", "pending", 0, ""]
  ] as const;
  for (const [id, tenantId, userId, jobId, state, attempts, leaseExpiresAt] of deliveries) {
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."notification_deliveries"(
         id, tenant_id, user_id, job_id, state, attempts, capability_hash,
         lease_expires_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [id, tenantId, userId, jobId, state, attempts, state === "leased" ? `capability:${id}` : "", leaseExpiresAt, createdAt]
    );
  }
  return { expiredLeaseAt, currentLeaseAt };
}

async function insertExecutionRecoveryFixtures(
  database: PostgresCutoverDatabase,
  recoveryNow: number
): Promise<{ expiredLeaseAt: string; currentLeaseAt: string }> {
  const createdAt = new Date(recoveryNow - 7_200_000).toISOString();
  const expiredLeaseAt = new Date(recoveryNow - 60_000).toISOString();
  const currentLeaseAt = new Date(recoveryNow + 60_000).toISOString();
  const expiredJobAt = new Date(recoveryNow - 120_000).toISOString();
  const currentJobAt = new Date(recoveryNow + 3_600_000).toISOString();
  for (const [suffix, tenantId, userId, missionId] of [
    ["other", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other"],
    ["local", "tenant_local", "user_local", "mission_cutover_local"]
  ] as const) {
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."exact_offer_keys"(
         id, tenant_id, listing_id, retailer_id, retailer_sku,
         seller_name, seller_key, seller_type, fulfillment, identity_hash, created_at
       ) VALUES ($1, $2, 'listing_cutover_scope', 'target', 'cutover-scope-sku',
                 'Target', 'target', 'first_party', 'shipping', $3, $4)`,
      [`native_exec_offer_${suffix}`, tenantId, `native-exec-offer-${suffix}`, createdAt]
    );
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."mission_intent_revisions"(
         id, tenant_id, user_id, mission_id, revision, quantity, currency,
         max_all_in_cents, action_ceiling, substitution_policy, expires_at,
         cooldown_seconds, target_policy_json, policy_hash, created_by_actor_id, created_at
       ) VALUES (
         $1, $2, $3, $4,
         COALESCE((
           SELECT MAX(existing.revision)
           FROM "${NATIVE_SCHEMA}"."mission_intent_revisions" AS existing
           WHERE existing.tenant_id = $2
             AND existing.mission_id = $4
         ), 0) + 1,
         9, 'USD', 2500, 'submit_order',
                 'exact_only', $5, 0, '{}', $6, 'native_execution_fixture', $7)`,
      [
        `native_exec_intent_${suffix}`,
        tenantId,
        userId,
        missionId,
        currentJobAt,
        `native-exec-policy-${suffix}`,
        createdAt
      ]
    );
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."offer_snapshots"(
         id, tenant_id, user_id, mission_id, intent_revision_id,
         exact_offer_key_id, listing_id, availability, unit_price_cents,
         quantity, item_subtotal_cents, maximum_all_in_cents, currency,
         seller_name, seller_type, fulfillment, evidence_hash,
         observed_at, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'listing_cutover_scope', 'in_stock',
                 1000, 1, 1000, 1200, 'USD', 'Target', 'first_party', 'shipping',
                 $7, $8, $9, $8)`,
      [
        `native_exec_snapshot_${suffix}`,
        tenantId,
        userId,
        missionId,
        `native_exec_intent_${suffix}`,
        `native_exec_offer_${suffix}`,
        `native-exec-evidence-${suffix}`,
        createdAt,
        currentJobAt
      ]
    );
  }

  const incidentIds = [
    "native_exec_incident_leased",
    "native_exec_incident_add_authorized",
    "native_exec_incident_adding",
    "native_exec_incident_submitting",
    "native_exec_incident_pending",
    "native_exec_incident_reservation_only",
    "native_exec_incident_current",
    "native_exec_incident_contention",
    "native_exec_incident_shared"
  ];
  for (const incidentId of incidentIds) {
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."signal_incidents"(
         id, tenant_id, user_id, listing_id, event_type, semantic_key, first_observed_at,
         last_observed_at, created_at, updated_at
       ) VALUES ($1, $2, $3, 'listing_cutover_scope', 'restock', $4, $5, $5, $5, $5)`,
      [incidentId, NATIVE_TENANT, NATIVE_USER, `semantic:${incidentId}`, createdAt]
    );
  }

  const jobs = [
    ["native_exec_leased", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", "native_exec_incident_leased", "leased", "add_to_cart", currentJobAt, expiredLeaseAt, currentJobAt],
    ["native_exec_add_authorized", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", "native_exec_incident_add_authorized", "add_authorized", "add_to_cart", currentJobAt, expiredLeaseAt, currentJobAt],
    ["native_exec_adding", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", "native_exec_incident_adding", "adding", "add_to_cart", currentJobAt, expiredLeaseAt, currentJobAt],
    ["native_exec_submitting", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", "native_exec_incident_submitting", "submitting", "submit_order", currentJobAt, expiredLeaseAt, currentJobAt],
    ["native_exec_pending", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", "native_exec_incident_pending", "awaiting_executor", "add_to_cart", expiredJobAt, "", currentJobAt],
    ["native_exec_reservation_only", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", "native_exec_incident_reservation_only", "awaiting_executor", "add_to_cart", currentJobAt, "", expiredJobAt],
    ["native_exec_current", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", "native_exec_incident_current", "leased", "add_to_cart", currentJobAt, currentLeaseAt, null],
    ["native_exec_contention", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", "native_exec_incident_contention", "leased", "add_to_cart", currentJobAt, currentLeaseAt, null],
    ["native_exec_shared", NATIVE_TENANT, NATIVE_USER, "mission_cutover_other", "native_notify_target_other", "native_exec_incident_shared", "leased", "add_to_cart", currentJobAt, expiredLeaseAt, null],
    ["native_exec_cross_tenant", "tenant_local", "user_local", "mission_cutover_local", "native_notify_target_local", "native_exec_incident_shared", "leased", "add_to_cart", currentJobAt, expiredLeaseAt, null]
  ] as const;
  for (const [
    id,
    tenantId,
    userId,
    missionId,
    missionTargetId,
    incidentId,
    state,
    action,
    expiresAt,
    leaseExpiresAt,
    reservationExpiresAt
  ] of jobs) {
    const suffix = tenantId === NATIVE_TENANT ? "other" : "local";
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."action_jobs"(
         id, tenant_id, user_id, mission_id, mission_target_id, incident_id,
         state, action, quantity, max_unit_price_cents, max_order_total_cents,
         currency, seller_policy, fulfillment, expected_seller, listing_id,
         canonical_url, idempotency_key, capability_nonce_hash, expires_at,
         leased_at, lease_expires_at, intent_revision_id, exact_offer_key_id,
         offer_snapshot_id, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 1000, 1200, 'USD',
                 'first_party_only', 'shipping', 'Target', 'listing_cutover_scope',
                 'https://www.target.com/p/-/A-cutover-scope-sku', $9, $10, $11,
                 $12, $12, $13, $14, $15, $16, $16)`,
      [
        id,
        tenantId,
        userId,
        missionId,
        missionTargetId,
        incidentId,
        state,
        action,
        `idempotency:${id}`,
        `original-capability:${id}`,
        expiresAt,
        leaseExpiresAt,
        `native_exec_intent_${suffix}`,
        `native_exec_offer_${suffix}`,
        `native_exec_snapshot_${suffix}`,
        createdAt
      ]
    );
    if (reservationExpiresAt) {
      const reservationId = `native_exec_reservation_${id.replace("native_exec_", "")}`;
      await database.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."spend_reservations"(
           id, tenant_id, user_id, mission_id, intent_revision_id,
           exact_offer_key_id, offer_snapshot_id, action_job_id, idempotency_key,
           action, quantity, reserved_amount_cents, committed_amount_cents,
           currency, status, release_reason, expires_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, 1200, 0,
                   'USD', 'active', '', $11, $12, $12)`,
        [
          reservationId,
          tenantId,
          userId,
          missionId,
          `native_exec_intent_${suffix}`,
          `native_exec_offer_${suffix}`,
          `native_exec_snapshot_${suffix}`,
          id,
          `reservation-idempotency:${id}`,
          action,
          reservationExpiresAt,
          createdAt
        ]
      );
      await database.query(
        `UPDATE "${NATIVE_SCHEMA}"."action_jobs" SET spend_reservation_id = $1 WHERE id = $2`,
        [reservationId, id]
      );
      await database.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."spend_ledger_entries"(
           id, tenant_id, user_id, reservation_id, action_job_id, entry_type,
           reserved_delta_cents, spent_delta_cents, quantity_delta, currency,
           reason_code, correlation_id, metadata_json, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'reserved', 1200, 0, 1, 'USD',
                   'action_job_reserved', $5, '{}', $6)`,
        [`native_exec_ledger_reserved_${id}`, tenantId, userId, reservationId, id, createdAt]
      );
    }
  }
  return { expiredLeaseAt, currentLeaseAt };
}

async function insertOperationalRetentionFixtures(
  database: PostgresCutoverDatabase,
  retentionNow: number
): Promise<void> {
  const oldOperationalAt = new Date(retentionNow - 31 * 24 * 60 * 60_000).toISOString();
  const currentOperationalAt = new Date(retentionNow - 29 * 24 * 60 * 60_000).toISOString();
  const oldEvidenceAt = new Date(retentionNow - 91 * 24 * 60 * 60_000).toISOString();
  const currentEvidenceAt = new Date(retentionNow - 89 * 24 * 60 * 60_000).toISOString();
  const currentReviewAt = new Date(retentionNow - 1 * 24 * 60 * 60_000).toISOString();
  const futureAt = new Date(retentionNow + 24 * 60 * 60_000).toISOString();

  for (const [suffix, tenantId, userId] of [
    ["other", NATIVE_TENANT, NATIVE_USER],
    ["local", "tenant_local", "user_local"]
  ] as const) {
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."extension_devices"(
         id, tenant_id, user_id, name, token_hash, extension_version,
         status, capabilities_json, last_seen_at, created_at, updated_at,
         credential_generation, credential_issued_at
       ) VALUES ($1, $2, $3, 'Native retention device', $4, '0.67.0',
                 'active', '{}', $5, $5, $5, 1, $5)`,
      [
        `native_retention_device_${suffix}`,
        tenantId,
        userId,
        suffix === "other" ? "a".repeat(64) : "b".repeat(64),
        oldEvidenceAt
      ]
    );
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."observer_recipe_candidates"(
         id, tenant_id, user_id, retailer_id, recipe_version,
         minimum_extension_version, recipe_json, recipe_fingerprint,
         lifecycle_state, provenance_code, expires_at, created_at, updated_at
       ) VALUES ($1, $2, $3, 'target', $4, '0.67.0', '{}', $5,
                 'shadow', 'native_retention_fixture', $6, $7, $7)`,
      [
        `native_retention_recipe_${suffix}`,
        tenantId,
        userId,
        `native-retention-${suffix}-v1`,
        suffix === "other" ? "c".repeat(64) : "d".repeat(64),
        futureAt,
        oldEvidenceAt
      ]
    );
  }

  const evidence = [
    ["eligible", "other", NATIVE_TENANT, NATIVE_USER, oldEvidenceAt],
    ["recent_review", "other", NATIVE_TENANT, NATIVE_USER, oldEvidenceAt],
    ["fresh", "other", NATIVE_TENANT, NATIVE_USER, currentEvidenceAt],
    ["eligible", "local", "tenant_local", "user_local", oldEvidenceAt]
  ] as const;
  for (const [kind, suffix, tenantId, userId, observedAt] of evidence) {
    const identity = `${suffix}_${kind}`;
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."observer_recipe_trials"(
         id, tenant_id, user_id, device_id, recipe_id, retailer_id,
         retailer_sku, observer_version, layout_fingerprint, outcome,
         evaluated_field_count, agreed_field_count, ambiguous_field_count,
         observed_at, received_at, validation_profile,
         oracle_evaluated_field_count, oracle_agreed_field_count,
         recipe_state_at_trial
       ) VALUES ($1, $2, $3, $4, $5, 'target', $6, 'target-observer-v4',
                 $7, 'passed', 1, 1, 0, $8, $8,
                 'packaged_structured_oracle_v1', 1, 1, 'shadow')`,
      [
        `native_retention_trial_${identity}`,
        tenantId,
        userId,
        `native_retention_device_${suffix}`,
        `native_retention_recipe_${suffix}`,
        `native-retention-sku-${identity}`,
        suffix === "other" ? "e".repeat(64) : "f".repeat(64),
        observedAt
      ]
    );
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."observer_recipe_recovery_evidence"(
         id, tenant_id, user_id, device_id, trial_id, recipe_id,
         retailer_id, retailer_sku, layout_fingerprint, field_name,
         value_kind, normalized_value, recipe_state_at_trial,
         observed_at, received_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'target', $7, $8,
                 'availability', 'enum', 'in_stock', 'shadow', $9, $9)`,
      [
        `native_retention_evidence_${identity}`,
        tenantId,
        userId,
        `native_retention_device_${suffix}`,
        `native_retention_trial_${identity}`,
        `native_retention_recipe_${suffix}`,
        `native-retention-sku-${identity}`,
        suffix === "other" ? "e".repeat(64) : "f".repeat(64),
        observedAt
      ]
    );
  }
  for (const [kind, createdAt] of [
    ["eligible", oldEvidenceAt],
    ["recent_review", currentReviewAt]
  ] as const) {
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."observer_recipe_recovery_reviews"(
         id, tenant_id, user_id, evidence_id, sequence, decision,
         confirmation_code, evidence_hash, actor_kind, actor_id, created_at
       ) VALUES ($1, $2, $3, $4, 1, 'confirmed',
                 'CONFIRM_NORMALIZED_RECOVERY_EVIDENCE', $5,
                 'user', 'native_retention_reviewer', $6)`,
      [
        `native_retention_review_other_${kind}`,
        NATIVE_TENANT,
        NATIVE_USER,
        `native_retention_evidence_other_${kind}`,
        "9".repeat(64),
        createdAt
      ]
    );
  }

  for (const [suffix, tenantId, bucketAt] of [
    ["old_other", NATIVE_TENANT, oldOperationalAt],
    ["current_other", NATIVE_TENANT, currentOperationalAt],
    ["old_local", "tenant_local", oldOperationalAt]
  ] as const) {
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."operational_request_rollups"(
         tenant_id, bucket_start, route_key, method, actor_kind,
         status_class, latency_bucket, request_count, total_duration_ms,
         max_duration_ms, created_at, updated_at
       ) VALUES ($1, $2, $3, 'GET', 'service', 'success', 'lt_100',
                 1, 10, 10, $2, $2)`,
      [tenantId, bucketAt, `native.retention.${suffix}`]
    );
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."operational_error_events"(
         id, tenant_id, correlation_key, route_key, method, actor_kind,
         status_code, error_code, duration_ms, privacy_classification, occurred_at
       ) VALUES ($1, $2, $3, $4, 'GET', 'service', 500,
                 'native_retention_error', 10, 'operational_aggregate', $5)`,
      [
        `native_retention_error_${suffix}`,
        tenantId,
        `native-retention-correlation-${suffix}`,
        `native.retention.${suffix}`,
        bucketAt
      ]
    );
  }

  const tasks = [
    ["old_terminal", NATIVE_TENANT, NATIVE_USER, "succeeded", oldOperationalAt],
    ["current_terminal", NATIVE_TENANT, NATIVE_USER, "succeeded", currentOperationalAt],
    ["old_dead_letter", NATIVE_TENANT, NATIVE_USER, "dead_letter", oldOperationalAt],
    ["old_terminal_local", "tenant_local", "user_local", "cancelled", oldOperationalAt]
  ] as const;
  for (const [suffix, tenantId, userId, state, completedAt] of tasks) {
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."background_tasks"(
         id, tenant_id, subject_user_id, task_kind, dedupe_key, state,
         priority, attempt_count, maximum_attempts, scheduled_for,
         result_json, completed_at, privacy_classification, created_at, updated_at
       ) VALUES ($1, $2, $3, 'operational_telemetry_retention', $4, $5,
                 50, 1, 3, $6, '{}', $6, 'operational_aggregate', $6, $6)`,
      [
        `native_retention_task_${suffix}`,
        tenantId,
        userId,
        `native-retention:${suffix}`,
        state,
        completedAt
      ]
    );
  }
  await database.query(
    `INSERT INTO "${NATIVE_SCHEMA}"."background_task_events"(
       id, tenant_id, subject_user_id, task_id, sequence, event_type,
       attempt, reason_code, worker_id, privacy_classification, created_at
     ) VALUES ('native_retention_task_event_old', $1, $2,
               'native_retention_task_old_terminal', 1, 'succeeded', 1,
               'native_retention_fixture', 'native_retention_worker',
               'operational_aggregate', $3)`,
    [NATIVE_TENANT, NATIVE_USER, oldOperationalAt]
  );
}

function nativeCandidateLayout(includeUnsupported = false): string {
  return JSON.stringify({
    schemaVersion: 1,
    pageKind: "product",
    scopeKind: "buybox",
    sellerShape: "legacy",
    fulfillmentShape: "shipping",
    addControlCount: 1,
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
    genericAddIntentCount: 1,
    genericAvailabilityCandidateCount: 1,
    genericPriceCandidateCount: 1,
    securityChallenge: false,
    interactiveBlock: "",
    repairLandmarks: [
      {
        field: "availability",
        elementKind: "div",
        attribute: "data-testid",
        value: "availability-status"
      },
      {
        field: "unitPrice",
        elementKind: "span",
        attribute: "data-testid",
        value: "customer-price"
      },
      ...(includeUnsupported ? [{
        field: "unitPrice",
        elementKind: "span",
        attribute: "data-testid",
        value: "offer:price"
      }] : [])
    ]
  });
}

async function insertObserverCandidateGroup(
  database: PostgresCutoverDatabase,
  input: {
    prefix: string;
    tenantId: string;
    userId: string;
    deviceIds: string[];
    layoutFingerprint: string;
    now: number;
    includeUnsupported?: boolean;
    recovered?: boolean;
  }
): Promise<void> {
  const layoutJson = nativeCandidateLayout(input.includeUnsupported === true);
  for (let index = 0; index < input.deviceIds.length; index += 1) {
    const receivedAt = new Date(input.now - (input.deviceIds.length - index + 1) * 1_000).toISOString();
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."retailer_adapter_diagnostics"(
         id, tenant_id, user_id, device_id, retailer_id, retailer_sku,
         adapter_version, contract_version, operation, outcome, failure_stage,
         reason_code, attempt_count, dom_changed, layout_fingerprint,
         layout_json, observed_at, received_at
       ) VALUES ($1, $2, $3, $4, 'target', $5, 'target-observer-v1', 1,
                 'observe', 'failed', 'availability_binding',
                 'availability_selector_miss', 1, 1, $6, $7, $8, $8)`,
      [
        `${input.prefix}_failure_${index + 1}`,
        input.tenantId,
        input.userId,
        input.deviceIds[index],
        index % 2 === 0 ? "111111" : "222222",
        input.layoutFingerprint,
        layoutJson,
        receivedAt
      ]
    );
  }
  if (input.recovered) {
    const recoveredAt = new Date(input.now - 250).toISOString();
    await database.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."retailer_adapter_diagnostics"(
         id, tenant_id, user_id, device_id, retailer_id, retailer_sku,
         adapter_version, contract_version, operation, outcome, failure_stage,
         reason_code, attempt_count, dom_changed, layout_fingerprint,
         layout_json, observed_at, received_at
       ) VALUES ($1, $2, $3, $4, 'target', '111111', 'target-observer-v1', 1,
                 'observe', 'recovered', 'availability_binding',
                 'dom_hydration_recovered', 2, 1, $5, $6, $7, $7)`,
      [
        `${input.prefix}_recovered`,
        input.tenantId,
        input.userId,
        input.deviceIds[0],
        input.layoutFingerprint,
        layoutJson,
        recoveredAt
      ]
    );
  }
}

async function insertObserverCandidateFixtures(
  database: PostgresCutoverDatabase,
  now: number
): Promise<void> {
  for (const [scope, tenantId, userId, tokenPrefix] of [
    ["other", NATIVE_TENANT, NATIVE_USER, "c"],
    ["local", "tenant_local", "user_local", "d"]
  ] as const) {
    for (let index = 1; index <= 3; index += 1) {
      const deviceId = `native_candidate_device_${scope}_${index}`;
      const createdAt = new Date(now - 60_000 - index).toISOString();
      await database.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."extension_devices"(
           id, tenant_id, user_id, name, token_hash, extension_version,
           status, capabilities_json, last_seen_at, created_at, updated_at,
           credential_generation, credential_issued_at
         ) VALUES ($1, $2, $3, 'Native candidate device', $4, '0.68.0',
                   'active', '{}', $5, $5, $5, 1, $5)`,
        [deviceId, tenantId, userId, `${tokenPrefix}${index}`.repeat(32), createdAt]
      );
    }
  }
  const otherDevices = [1, 2, 3].map((index) => `native_candidate_device_other_${index}`);
  await insertObserverCandidateGroup(database, {
    prefix: "native_candidate_mature",
    tenantId: NATIVE_TENANT,
    userId: NATIVE_USER,
    deviceIds: otherDevices,
    layoutFingerprint: "1".repeat(64),
    now,
    includeUnsupported: true
  });
  await insertObserverCandidateGroup(database, {
    prefix: "native_candidate_collecting",
    tenantId: NATIVE_TENANT,
    userId: NATIVE_USER,
    deviceIds: otherDevices.slice(0, 2),
    layoutFingerprint: "2".repeat(64),
    now: now - 20_000
  });
  await insertObserverCandidateGroup(database, {
    prefix: "native_candidate_recovered",
    tenantId: NATIVE_TENANT,
    userId: NATIVE_USER,
    deviceIds: otherDevices,
    layoutFingerprint: "3".repeat(64),
    now: now - 40_000,
    recovered: true
  });
  await insertObserverCandidateGroup(database, {
    prefix: "native_candidate_local",
    tenantId: "tenant_local",
    userId: "user_local",
    deviceIds: [1, 2, 3].map((index) => `native_candidate_device_local_${index}`),
    layoutFingerprint: "4".repeat(64),
    now: now - 10_000
  });
}

async function insertOperatorAlertDispatchFixture(
  database: PostgresCutoverDatabase,
  suffix: string,
  subjectUserId: string,
  now: number,
  exhausted = false
): Promise<string> {
  const createdAt = new Date(now - 10_000).toISOString();
  const expiredAt = new Date(now - 1_000).toISOString();
  const ruleId = "native_alert_rule_other";
  const connectorId = "native_alert_connector_other";
  const incidentId = `native_alert_incident_${suffix}`;
  const eventId = `native_alert_event_${suffix}`;
  const deliveryId = `native_alert_delivery_${suffix}`;
  await database.query(
    `INSERT INTO "${NATIVE_SCHEMA}"."operator_alert_rules"(
       id, tenant_id, event_family, name, enabled, severity,
       minimum_occurrences, dedupe_window_seconds, escalation_after_seconds,
       retailer_scope, operation_scope, routes_json, privacy_classification,
       created_by_actor_id, updated_by_actor_id, created_at, updated_at
     ) VALUES ($1, $2, 'adapter_repair', 'Native dispatch rule', 1, 'warning',
               1, 900, 3600, '*', '*', '["dashboard"]', 'operational_configuration',
               'native_fixture', 'native_fixture', $3, $3)
     ON CONFLICT (id) DO NOTHING`,
    [ruleId, NATIVE_TENANT, createdAt]
  );
  await database.query(
    `INSERT INTO "${NATIVE_SCHEMA}"."operator_alert_connectors"(
       id, tenant_id, name, enabled, kind, endpoint_reference,
       endpoint_binding_fingerprint, minimum_severity, privacy_classification,
       created_by_actor_id, updated_by_actor_id, created_at, updated_at
     ) VALUES ($1, $2, 'Native operations webhook', 1, 'webhook', 'ops_primary',
               $3, 'warning', 'operational_configuration',
               'native_fixture', 'native_fixture', $4, $4)
     ON CONFLICT (id) DO NOTHING`,
    [connectorId, NATIVE_TENANT, NATIVE_ALERT_BINDING, createdAt]
  );
  const layoutFingerprint = stableHash("yoink_native_alert_layout_v1", suffix);
  await database.query(
    `INSERT INTO "${NATIVE_SCHEMA}"."operator_alert_incidents"(
       id, tenant_id, subject_user_id, rule_id, event_family, incident_key_hash,
       severity, status, privacy_classification, title, summary, retailer_id,
       operation, failure_stage, reason_code, layout_fingerprint,
       occurrence_count, affected_entity_count, first_seen_at, last_seen_at,
       last_failure_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'adapter_repair', $5, 'warning', 'open',
               'operational_aggregate', 'Native dispatch incident',
               'Bounded native PostgreSQL dispatch fixture.', 'target', 'observe',
               'offer_binding', 'offer_binding_ambiguous', $6, 2, 1, $7, $7, $7, $7, $7)`,
    [incidentId, NATIVE_TENANT, subjectUserId, ruleId,
      stableHash("yoink_native_alert_incident_v1", suffix), layoutFingerprint, createdAt]
  );
  await database.query(
    `INSERT INTO "${NATIVE_SCHEMA}"."operator_alert_events"(
       id, tenant_id, incident_id, rule_id, event_type, severity, reason_code,
       actor_kind, actor_id, correlation_id, privacy_classification, metadata_json, created_at
     ) VALUES ($1, $2, $3, $4, 'opened', 'warning', 'incident_opened',
               'service', 'native_fixture', $3, 'operational_aggregate', '{}', $5)`,
    [eventId, NATIVE_TENANT, incidentId, ruleId, createdAt]
  );
  const payloadJson = JSON.stringify({
    contractVersion: 1,
    eventId,
    incidentId,
    eventType: "opened",
    severity: "warning",
    reasonCode: "incident_opened",
    retailerId: "target",
    operation: "observe",
    failureStage: "offer_binding",
    layoutFingerprint,
    occurrenceCount: 2,
    affectedEntityCount: 1,
    firstSeenAt: createdAt,
    lastSeenAt: createdAt,
    emittedAt: createdAt,
    privacyClassification: "operational_aggregate"
  });
  await database.query(
    `INSERT INTO "${NATIVE_SCHEMA}"."operator_alert_connector_deliveries"(
       id, tenant_id, connector_id, incident_id, event_id, endpoint_reference,
       endpoint_binding_fingerprint, payload_json, payload_hash,
       idempotency_key_hash, state, privacy_classification, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'ops_primary', $6, $7, $8, $9,
               'pending', 'operational_aggregate', $10, $10)`,
    [deliveryId, NATIVE_TENANT, connectorId, incidentId, eventId,
      NATIVE_ALERT_BINDING, payloadJson,
      stableHash("yoink_operator_alert_connector_payload_v1", payloadJson),
      stableHash("yoink_operator_alert_connector_idempotency_v1", NATIVE_TENANT, connectorId, eventId),
      createdAt]
  );
  await database.query(
    `INSERT INTO "${NATIVE_SCHEMA}"."operator_alert_connector_delivery_events"(
       id, tenant_id, delivery_id, sequence, event_type, attempt,
       reason_code, http_status, privacy_classification, created_at
     ) VALUES ($1, $2, $3, 1, 'queued', 0, 'alert_event_routed', 0,
               'operational_aggregate', $4)`,
    [`native_alert_delivery_event_${suffix}_queued`, NATIVE_TENANT, deliveryId, createdAt]
  );
  if (exhausted) {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const leasedAt = new Date(now - 9_000 + (attempt - 1) * 600).toISOString();
      await database.query(
        `UPDATE "${NATIVE_SCHEMA}"."operator_alert_connector_deliveries"
         SET state = 'leased', attempt_count = $1,
             lease_capability_hash = $2, lease_expires_at = $3,
             next_attempt_at = '', last_error_code = '', last_http_status = 0,
             updated_at = $4 WHERE id = $5`,
        [attempt, stableHash("yoink_native_exhausted_capability_v1", attempt),
          expiredAt, leasedAt, deliveryId]
      );
      if (attempt < 12) {
        const retryAt = new Date(now - 8_700 + (attempt - 1) * 600).toISOString();
        await database.query(
          `UPDATE "${NATIVE_SCHEMA}"."operator_alert_connector_deliveries"
           SET state = 'retry_wait', lease_capability_hash = '', lease_expires_at = '',
               next_attempt_at = $1, last_error_code = 'native_retry',
               last_http_status = 503, updated_at = $1 WHERE id = $2`,
          [retryAt, deliveryId]
        );
      }
    }
  }
  return deliveryId;
}

async function insertOperatorAlertReconciliationDiagnostic(
  database: PostgresCutoverDatabase,
  input: {
    id: string;
    tenantId: string;
    userId: string;
    deviceId: string;
    retailerSku: string;
    layoutFingerprint: string;
    receivedAt: string;
    outcome?: "failed" | "recovered";
  }
): Promise<void> {
  const outcome = input.outcome ?? "failed";
  await database.query(
    `INSERT INTO "${NATIVE_SCHEMA}"."retailer_adapter_diagnostics"(
       id, tenant_id, user_id, device_id, retailer_id, retailer_sku,
       adapter_version, contract_version, operation, outcome, failure_stage,
       reason_code, attempt_count, dom_changed, layout_fingerprint,
       layout_json, observed_at, received_at
     ) VALUES ($1, $2, $3, $4, 'amazon', $5, 'amazon-observer-v4', 1,
               'observe', $6, 'availability_binding', $7,
               $8, 1, $9, '{}', $10, $10)`,
    [
      input.id,
      input.tenantId,
      input.userId,
      input.deviceId,
      input.retailerSku,
      outcome,
      outcome === "failed" ? "availability_selector_miss" : "dom_hydration_recovered",
      outcome === "failed" ? 1 : 2,
      input.layoutFingerprint,
      input.receivedAt
    ]
  );
}

function workerContext(workerId: string): BackgroundWorkerContext {
  return {
    principal: { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
    workerId,
    runtimeKind: "standalone",
    runtimeVersion: POSTGRES_TEST_WORKER_VERSION,
    deploymentFingerprint: POSTGRES_TEST_WORKER_FINGERPRINT
  };
}

test("native PostgreSQL proves server-bound reads, queue writes, fleet control, six handlers, hosted signal lifecycle, catalog creation, event-resolution commit, source-reference refresh, terminal decisions, actionable offer incidents, post-incident decisions, mission binding, strategy evaluation, the shared writer-lock protocol, bounded configuration, reviewed purchase-intent and trusted strategy action/spend semantics, the complete signal-evaluation apply composition, Target qualification/settings, source trust, non-Target retailer qualification, append-only mission-policy revision, no-flood source status, durable source sync, terminal reservation lifecycle, bounded TrackaLacker catalog import, source-connection provisioning, complete-set attribution-policy replacement, and bounded attribution-receipt writing", {
  timeout: 1_200_000
}, async () => {
  const parent = mkdtempSync(join(tmpdir(), "yoink-native-postgres-"));
  const databaseDir = join(parent, "cluster");
  const fixture = createPostgresCutoverFixture();
  const port = await availableLoopbackPort();
  const password = "yoink_native_qualification_only";
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password,
    authMethod: "scram-sha-256",
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--no-sync"],
    postgresFlags: ["-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off"],
    onLog: () => undefined,
    onError: () => undefined
  });
  let importer: NodePostgresCutoverDatabase | null = null;
  let first: NodePostgresCutoverDatabase | null = null;
  let second: NodePostgresCutoverDatabase | null = null;
  let locker: Client | null = null;
  let directClient: Client | null = null;
  let tenantReaderA: NodePostgresTenantReadDatabase | null = null;
  let tenantReaderB: NodePostgresTenantReadDatabase | null = null;
  let tenantReaderUnmapped: NodePostgresTenantReadDatabase | null = null;
  let queueWriterA: NodePostgresTenantQueueWriteDatabase | null = null;
  let queueWriterASecond: NodePostgresTenantQueueWriteDatabase | null = null;
  let queueWriterB: NodePostgresTenantQueueWriteDatabase | null = null;
  let queueWriterUnmapped: NodePostgresTenantQueueWriteDatabase | null = null;
  let workerControl: NodePostgresWorkerControlDatabase | null = null;
  let notificationRecoveryA: NodePostgresNotificationRecoveryDatabase | null = null;
  let notificationRecoveryB: NodePostgresNotificationRecoveryDatabase | null = null;
  let notificationRecoveryUnmapped: NodePostgresNotificationRecoveryDatabase | null = null;
  let notificationDirectClient: Client | null = null;
  let notificationHandlerDb: YoinkDatabase | null = null;
  let executionRecoveryA: NodePostgresExecutionRecoveryDatabase | null = null;
  let executionRecoveryB: NodePostgresExecutionRecoveryDatabase | null = null;
  let executionRecoveryUnmapped: NodePostgresExecutionRecoveryDatabase | null = null;
  let executionDirectClient: Client | null = null;
  let executionHandlerDb: YoinkDatabase | null = null;
  let operationalRetentionA: NodePostgresOperationalRetentionDatabase | null = null;
  let operationalRetentionB: NodePostgresOperationalRetentionDatabase | null = null;
  let operationalRetentionUnmapped: NodePostgresOperationalRetentionDatabase | null = null;
  let operationalRetentionDirectClient: Client | null = null;
  let operationalRetentionHandlerDb: YoinkDatabase | null = null;
  let observerCandidateA: NodePostgresObserverCandidateEvaluationDatabase | null = null;
  let observerCandidateB: NodePostgresObserverCandidateEvaluationDatabase | null = null;
  let observerCandidateUnmapped: NodePostgresObserverCandidateEvaluationDatabase | null = null;
  let observerCandidateDirectClient: Client | null = null;
  let observerCandidateHandlerDb: YoinkDatabase | null = null;
  let alertDispatchA: NodePostgresOperatorAlertConnectorDispatchDatabase | null = null;
  let alertDispatchASecond: NodePostgresOperatorAlertConnectorDispatchDatabase | null = null;
  let alertDispatchB: NodePostgresOperatorAlertConnectorDispatchDatabase | null = null;
  let alertDispatchC: NodePostgresOperatorAlertConnectorDispatchDatabase | null = null;
  let alertDispatchUnmapped: NodePostgresOperatorAlertConnectorDispatchDatabase | null = null;
  let alertDispatchDirectClient: Client | null = null;
  let alertReconciliationA: NodePostgresOperatorAlertReconciliationDatabase | null = null;
  let alertReconciliationASecond: NodePostgresOperatorAlertReconciliationDatabase | null = null;
  let alertReconciliationB: NodePostgresOperatorAlertReconciliationDatabase | null = null;
  let alertReconciliationC: NodePostgresOperatorAlertReconciliationDatabase | null = null;
  let alertReconciliationUnmapped: NodePostgresOperatorAlertReconciliationDatabase | null = null;
  let alertReconciliationDirectClient: Client | null = null;
  let alertReconciliationHandlerDb: YoinkDatabase | null = null;
  let observerWitnessA: NodePostgresObserverWitnessState | null = null;
  let observerWitnessASecond: NodePostgresObserverWitnessState | null = null;
  let observerWitnessB: NodePostgresObserverWitnessState | null = null;
  let observerWitnessUnmapped: NodePostgresObserverWitnessState | null = null;
  let observerWitnessDirectClient: Client | null = null;
  let observerWitnessHandlerDb: YoinkDatabase | null = null;
  let deliveryLeaseRecoveryA: NodePostgresHostedDeliveryLeaseRecoveryDatabase | null = null;
  let deliveryLeaseRecoveryASecond: NodePostgresHostedDeliveryLeaseRecoveryDatabase | null = null;
  let deliveryLeaseRecoveryB: NodePostgresHostedDeliveryLeaseRecoveryDatabase | null = null;
  let deliveryLeaseRecoveryC: NodePostgresHostedDeliveryLeaseRecoveryDatabase | null = null;
  let deliveryLeaseRecoveryUnmapped: NodePostgresHostedDeliveryLeaseRecoveryDatabase | null = null;
  let deliveryLeaseRecoveryDirectClient: Client | null = null;
  let signalCatalogApplyA: NodePostgresSignalCatalogApplyDatabase | null = null;
  let signalCatalogApplyASecond: NodePostgresSignalCatalogApplyDatabase | null = null;
  let signalCatalogApplyB: NodePostgresSignalCatalogApplyDatabase | null = null;
  let signalCatalogApplyC: NodePostgresSignalCatalogApplyDatabase | null = null;
  let signalCatalogApplyUnmapped: NodePostgresSignalCatalogApplyDatabase | null = null;
  let signalCatalogApplyDirectClient: Client | null = null;
  let signalResolutionApplyA: NodePostgresSignalResolutionApplyDatabase | null = null;
  let signalResolutionApplyASecond: NodePostgresSignalResolutionApplyDatabase | null = null;
  let signalResolutionApplyB: NodePostgresSignalResolutionApplyDatabase | null = null;
  let signalResolutionApplyC: NodePostgresSignalResolutionApplyDatabase | null = null;
  let signalResolutionApplyUnmapped: NodePostgresSignalResolutionApplyDatabase | null = null;
  let signalResolutionApplyDirectClient: Client | null = null;
  let signalSourceReferenceA: NodePostgresSignalSourceReferenceRefreshDatabase | null = null;
  let signalSourceReferenceASecond: NodePostgresSignalSourceReferenceRefreshDatabase | null = null;
  let signalSourceReferenceB: NodePostgresSignalSourceReferenceRefreshDatabase | null = null;
  let signalSourceReferenceC: NodePostgresSignalSourceReferenceRefreshDatabase | null = null;
  let signalSourceReferenceUnmapped: NodePostgresSignalSourceReferenceRefreshDatabase | null = null;
  let signalSourceReferenceDirectClient: Client | null = null;
  let signalTerminalDecisionA: NodePostgresSignalTerminalDecisionApplyDatabase | null = null;
  let signalTerminalDecisionASecond: NodePostgresSignalTerminalDecisionApplyDatabase | null = null;
  let signalTerminalDecisionB: NodePostgresSignalTerminalDecisionApplyDatabase | null = null;
  let signalTerminalDecisionC: NodePostgresSignalTerminalDecisionApplyDatabase | null = null;
  let signalTerminalDecisionUnmapped: NodePostgresSignalTerminalDecisionApplyDatabase | null = null;
  let signalTerminalDecisionDirectClient: Client | null = null;
  let signalOfferIncidentA: NodePostgresSignalOfferIncidentApplyDatabase | null = null;
  let signalOfferIncidentASecond: NodePostgresSignalOfferIncidentApplyDatabase | null = null;
  let signalOfferIncidentB: NodePostgresSignalOfferIncidentApplyDatabase | null = null;
  let signalOfferIncidentC: NodePostgresSignalOfferIncidentApplyDatabase | null = null;
  let signalOfferIncidentUnmapped: NodePostgresSignalOfferIncidentApplyDatabase | null = null;
  let signalOfferIncidentDirectClient: Client | null = null;
  let signalPostIncidentDecisionA: NodePostgresSignalPostIncidentDecisionApplyDatabase | null = null;
  let signalPostIncidentDecisionASecond: NodePostgresSignalPostIncidentDecisionApplyDatabase | null = null;
  let signalPostIncidentDecisionB: NodePostgresSignalPostIncidentDecisionApplyDatabase | null = null;
  let signalPostIncidentDecisionC: NodePostgresSignalPostIncidentDecisionApplyDatabase | null = null;
  let signalPostIncidentDecisionUnmapped: NodePostgresSignalPostIncidentDecisionApplyDatabase | null = null;
  let signalPostIncidentDecisionDirectClient: Client | null = null;
  let signalMissionBindingA: NodePostgresSignalMissionBindingApplyDatabase | null = null;
  let signalMissionBindingASecond: NodePostgresSignalMissionBindingApplyDatabase | null = null;
  let signalMissionBindingB: NodePostgresSignalMissionBindingApplyDatabase | null = null;
  let signalMissionBindingC: NodePostgresSignalMissionBindingApplyDatabase | null = null;
  let signalMissionBindingUnmapped: NodePostgresSignalMissionBindingApplyDatabase | null = null;
  let signalMissionBindingDirectClient: Client | null = null;
  let signalStrategyEvaluationA: NodePostgresSignalStrategyEvaluationApplyDatabase | null = null;
  let signalStrategyEvaluationASecond: NodePostgresSignalStrategyEvaluationApplyDatabase | null = null;
  let signalStrategyEvaluationB: NodePostgresSignalStrategyEvaluationApplyDatabase | null = null;
  let signalStrategyEvaluationC: NodePostgresSignalStrategyEvaluationApplyDatabase | null = null;
  let signalStrategyEvaluationUnmapped: NodePostgresSignalStrategyEvaluationApplyDatabase | null = null;
  let signalStrategyEvaluationDirectClient: Client | null = null;
  let signalWriterLockDirectClient: Client | null = null;
  let signalConstraintConfigA: NodePostgresSignalConstraintConfigApplyDatabase | null = null;
  let signalConstraintConfigASecond: NodePostgresSignalConstraintConfigApplyDatabase | null = null;
  let signalConstraintConfigB: NodePostgresSignalConstraintConfigApplyDatabase | null = null;
  let signalConstraintConfigC: NodePostgresSignalConstraintConfigApplyDatabase | null = null;
  let signalConstraintConfigUnmapped: NodePostgresSignalConstraintConfigApplyDatabase | null = null;
  let signalConstraintConfigDirectClient: Client | null = null;
  let signalActionSpendA: NodePostgresSignalActionSpendApplyDatabase | null = null;
  let signalActionSpendASecond: NodePostgresSignalActionSpendApplyDatabase | null = null;
  let signalActionSpendB: NodePostgresSignalActionSpendApplyDatabase | null = null;
  let signalActionSpendC: NodePostgresSignalActionSpendApplyDatabase | null = null;
  let signalActionSpendUnmapped: NodePostgresSignalActionSpendApplyDatabase | null = null;
  let signalActionSpendDirectClient: Client | null = null;
  let signalTargetQualificationA: NodePostgresSignalTargetQualificationApplyDatabase | null = null;
  let signalTargetQualificationASecond: NodePostgresSignalTargetQualificationApplyDatabase | null = null;
  let signalTargetQualificationB: NodePostgresSignalTargetQualificationApplyDatabase | null = null;
  let signalTargetQualificationC: NodePostgresSignalTargetQualificationApplyDatabase | null = null;
  let signalTargetQualificationUnmapped: NodePostgresSignalTargetQualificationApplyDatabase | null = null;
  let signalTargetQualificationDirectClient: Client | null = null;
  let signalSourceTrustA: NodePostgresSignalSourceTrustApplyDatabase | null = null;
  let signalSourceTrustASecond: NodePostgresSignalSourceTrustApplyDatabase | null = null;
  let signalSourceTrustB: NodePostgresSignalSourceTrustApplyDatabase | null = null;
  let signalSourceTrustC: NodePostgresSignalSourceTrustApplyDatabase | null = null;
  let signalSourceTrustUnmapped: NodePostgresSignalSourceTrustApplyDatabase | null = null;
  let signalSourceTrustDirectClient: Client | null = null;
  let signalRetailerQualificationA: NodePostgresSignalRetailerQualificationApplyDatabase | null = null;
  let signalRetailerQualificationASecond: NodePostgresSignalRetailerQualificationApplyDatabase | null = null;
  let signalRetailerQualificationB: NodePostgresSignalRetailerQualificationApplyDatabase | null = null;
  let signalRetailerQualificationC: NodePostgresSignalRetailerQualificationApplyDatabase | null = null;
  let signalRetailerQualificationUnmapped: NodePostgresSignalRetailerQualificationApplyDatabase | null = null;
  let signalRetailerQualificationDirectClient: Client | null = null;
  let signalMissionPolicyA: NodePostgresSignalMissionPolicyApplyDatabase | null = null;
  let signalMissionPolicyASecond: NodePostgresSignalMissionPolicyApplyDatabase | null = null;
  let signalMissionPolicyB: NodePostgresSignalMissionPolicyApplyDatabase | null = null;
  let signalMissionPolicyC: NodePostgresSignalMissionPolicyApplyDatabase | null = null;
  let signalMissionPolicyUnmapped: NodePostgresSignalMissionPolicyApplyDatabase | null = null;
  let signalMissionPolicyDirectClient: Client | null = null;
  let signalSourceStatusA: NodePostgresSignalSourceStatusApplyDatabase | null = null;
  let signalSourceStatusASecond: NodePostgresSignalSourceStatusApplyDatabase | null = null;
  let signalSourceStatusB: NodePostgresSignalSourceStatusApplyDatabase | null = null;
  let signalSourceStatusC: NodePostgresSignalSourceStatusApplyDatabase | null = null;
  let signalSourceStatusUnmapped: NodePostgresSignalSourceStatusApplyDatabase | null = null;
  let signalSourceStatusDirectClient: Client | null = null;
  let signalSourceSyncA: NodePostgresSignalSourceSyncApplyDatabase | null = null;
  let signalSourceSyncASecond: NodePostgresSignalSourceSyncApplyDatabase | null = null;
  let signalSourceSyncB: NodePostgresSignalSourceSyncApplyDatabase | null = null;
  let signalSourceSyncC: NodePostgresSignalSourceSyncApplyDatabase | null = null;
  let signalSourceSyncUnmapped: NodePostgresSignalSourceSyncApplyDatabase | null = null;
  let signalSourceSyncDirectClient: Client | null = null;
  let signalReservationLifecycleA:
    NodePostgresSignalReservationLifecycleApplyDatabase | null = null;
  let signalReservationLifecycleASecond:
    NodePostgresSignalReservationLifecycleApplyDatabase | null = null;
  let signalReservationLifecycleB:
    NodePostgresSignalReservationLifecycleApplyDatabase | null = null;
  let signalReservationLifecycleC:
    NodePostgresSignalReservationLifecycleApplyDatabase | null = null;
  let signalReservationLifecycleUnmapped:
    NodePostgresSignalReservationLifecycleApplyDatabase | null = null;
  let signalReservationLifecycleDirectClient: Client | null = null;
  let signalReservationLifecycleLockClient: Client | null = null;
  let signalCatalogImportA: NodePostgresSignalCatalogImportApplyDatabase | null = null;
  let signalCatalogImportASecond:
    NodePostgresSignalCatalogImportApplyDatabase | null = null;
  let signalCatalogImportB: NodePostgresSignalCatalogImportApplyDatabase | null = null;
  let signalCatalogImportUnmapped:
    NodePostgresSignalCatalogImportApplyDatabase | null = null;
  let signalCatalogImportDirectClient: Client | null = null;
  let signalCatalogImportLockClient: Client | null = null;
  let signalSourceProvisioningA:
    NodePostgresSignalSourceProvisioningApplyDatabase | null = null;
  let signalSourceProvisioningASecond:
    NodePostgresSignalSourceProvisioningApplyDatabase | null = null;
  let signalSourceProvisioningB:
    NodePostgresSignalSourceProvisioningApplyDatabase | null = null;
  let signalSourceProvisioningC:
    NodePostgresSignalSourceProvisioningApplyDatabase | null = null;
  let signalSourceProvisioningCSecond:
    NodePostgresSignalSourceProvisioningApplyDatabase | null = null;
  let signalSourceProvisioningUnmapped:
    NodePostgresSignalSourceProvisioningApplyDatabase | null = null;
  let signalSourceProvisioningDirectClient: Client | null = null;
  let signalAttributionPolicyA:
    NodePostgresSignalAttributionPolicyApplyDatabase | null = null;
  let signalAttributionPolicyASecond:
    NodePostgresSignalAttributionPolicyApplyDatabase | null = null;
  let signalAttributionPolicyB:
    NodePostgresSignalAttributionPolicyApplyDatabase | null = null;
  let signalAttributionPolicyC:
    NodePostgresSignalAttributionPolicyApplyDatabase | null = null;
  let signalAttributionPolicyUnmapped:
    NodePostgresSignalAttributionPolicyApplyDatabase | null = null;
  let signalAttributionPolicyDirectClient: Client | null = null;
  let signalAttributionReceiptA: NodePostgresSignalAttributionReceiptApplyDatabase | null = null;
  let signalAttributionReceiptB: NodePostgresSignalAttributionReceiptApplyDatabase | null = null;
  let signalAttributionReceiptC: NodePostgresSignalAttributionReceiptApplyDatabase | null = null;
  let signalAttributionReceiptUnmapped: NodePostgresSignalAttributionReceiptApplyDatabase | null = null;
  let signalAttributionReceiptDirectClient: Client | null = null;
  try {
    await postgres.initialise();
    await postgres.start();
    const connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
    importer = new NodePostgresCutoverDatabase({
      connectionString,
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    });
    const imported = await importPostgresCutoverArchive(
      importer,
      fixture.archivePath,
      NATIVE_SCHEMA,
      "2026-08-25T16:30:00.000Z"
    );
    assert.equal(imported.matched, true);
    const roles = await applyPostgresRuntimeReadRoles(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      new Date("2026-08-25T16:45:00.000Z").getTime()
    );
    assert.equal(roles.roleCount, 5);
    assert.equal(roles.grantedTableCount, 95);
    assert.equal((await verifyPostgresRuntimeReadRoles(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE
    )).phase, "verified");
    const sessionBoundary = await applyPostgresTenantSessionBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      new Date("2026-08-25T16:50:00.000Z").getTime()
    );
    assert.equal(sessionBoundary.tenantRlsTableCount, 83);
    assert.equal(sessionBoundary.grantCount, 83);
    assert.equal(sessionBoundary.membershipCount, 0);
    assert.equal(sessionBoundary.activePrincipalCount, 0);
    assert.equal(sessionBoundary.restrictivePolicyCount, 83);
    assert.match(sessionBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(sessionBoundary.directParameterSetPrevented, false);
    assert.equal(sessionBoundary.directParameterScopeExpansionPrevented, true);
    assert.equal(sessionBoundary.serverBoundRestrictivePolicies, true);
    assert.equal(sessionBoundary.runtimeAuthority, false);
    assert.deepEqual(
      await verifyPostgresTenantSessionBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE
      ),
      sessionBoundary
    );
    const queueWriteBoundary = await applyPostgresTenantQueueWriteBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      new Date("2026-08-25T16:52:00.000Z").getTime()
    );
    assert.equal(queueWriteBoundary.tableCount, 5);
    assert.equal(queueWriteBoundary.grantCount, 12);
    assert.equal(queueWriteBoundary.functionGrantCount, 3);
    assert.equal(queueWriteBoundary.constraintHelperFunctionCount, 1);
    assert.equal(queueWriteBoundary.membershipCount, 0);
    assert.equal(queueWriteBoundary.activePrincipalCount, 0);
    assert.equal(queueWriteBoundary.restrictivePolicyCount, 4);
    assert.match(queueWriteBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(queueWriteBoundary.deleteAccess, false);
    assert.equal(queueWriteBoundary.handlerRepositoryParity, false);
    assert.equal(queueWriteBoundary.runtimeAuthority, false);
    assert.deepEqual(
      await verifyPostgresTenantQueueWriteBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE
      ),
      queueWriteBoundary
    );
    const workerControlBoundary = await applyPostgresWorkerControlBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      new Date("2026-08-25T16:53:00.000Z").getTime()
    );
    assert.equal(workerControlBoundary.tableCount, 3);
    assert.equal(workerControlBoundary.grantCount, 19);
    assert.equal(workerControlBoundary.membershipCount, 0);
    assert.equal(workerControlBoundary.activePrincipalCount, 0);
    assert.equal(workerControlBoundary.permissivePolicyCount, 3);
    assert.equal(workerControlBoundary.principalEnumeration, true);
    assert.equal(workerControlBoundary.deploymentStatus, true);
    assert.equal(workerControlBoundary.workerStopping, true);
    assert.equal(workerControlBoundary.insertAccess, false);
    assert.equal(workerControlBoundary.deleteAccess, false);
    assert.equal(workerControlBoundary.runtimeAuthority, false);
    assert.match(workerControlBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresWorkerControlBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE
      ),
      workerControlBoundary
    );
    const notificationRecoveryBoundary = await applyPostgresNotificationRecoveryBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:00.000Z").getTime()
    );
    assert.equal(notificationRecoveryBoundary.protectedTableCount, 2);
    assert.equal(notificationRecoveryBoundary.directTableGrantCount, 0);
    assert.equal(notificationRecoveryBoundary.functionGrantCount, 1);
    assert.equal(notificationRecoveryBoundary.membershipCount, 0);
    assert.equal(notificationRecoveryBoundary.activePrincipalCount, 0);
    assert.equal(notificationRecoveryBoundary.handlerTaskKindCount, 1);
    assert.equal(notificationRecoveryBoundary.totalHandlerTaskKindCount, 7);
    assert.equal(notificationRecoveryBoundary.serverBoundPrincipalLookup, true);
    assert.equal(notificationRecoveryBoundary.serverClockBoundRecovery, true);
    assert.equal(notificationRecoveryBoundary.notificationRecoveryRepositoryParity, true);
    assert.equal(notificationRecoveryBoundary.fullHandlerRepositoryParity, false);
    assert.equal(notificationRecoveryBoundary.directTableAccess, false);
    assert.equal(notificationRecoveryBoundary.insertAccess, false);
    assert.equal(notificationRecoveryBoundary.deleteAccess, false);
    assert.equal(notificationRecoveryBoundary.runtimeAuthority, false);
    assert.match(notificationRecoveryBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresNotificationRecoveryBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE
      ),
      notificationRecoveryBoundary
    );
    const executionRecoveryBoundary = await applyPostgresExecutionRecoveryBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:30.000Z").getTime()
    );
    assert.equal(executionRecoveryBoundary.protectedTableCount, 9);
    assert.equal(executionRecoveryBoundary.forcedRlsTableCount, 9);
    assert.equal(executionRecoveryBoundary.indirectScopeTableCount, 0);
    assert.equal(executionRecoveryBoundary.directTableGrantCount, 0);
    assert.equal(executionRecoveryBoundary.functionGrantCount, 1);
    assert.equal(executionRecoveryBoundary.membershipCount, 0);
    assert.equal(executionRecoveryBoundary.activePrincipalCount, 0);
    assert.equal(executionRecoveryBoundary.boundaryHandlerTaskKindCount, 1);
    assert.equal(executionRecoveryBoundary.qualifiedHandlerTaskKindCount, 2);
    assert.equal(executionRecoveryBoundary.totalHandlerTaskKindCount, 7);
    assert.equal(executionRecoveryBoundary.serverBoundPrincipalLookup, true);
    assert.equal(executionRecoveryBoundary.serverClockBoundRecovery, true);
    assert.equal(executionRecoveryBoundary.sharedIncidentMutationFailClosed, true);
    assert.equal(executionRecoveryBoundary.executionRecoveryRepositoryParity, true);
    assert.equal(executionRecoveryBoundary.notificationRecoveryRepositoryParity, true);
    assert.equal(executionRecoveryBoundary.fullHandlerRepositoryParity, false);
    assert.equal(executionRecoveryBoundary.directTableAccess, false);
    assert.equal(executionRecoveryBoundary.insertAccess, false);
    assert.equal(executionRecoveryBoundary.deleteAccess, false);
    assert.equal(executionRecoveryBoundary.runtimeAuthority, false);
    assert.match(executionRecoveryBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresExecutionRecoveryBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE
      ),
      executionRecoveryBoundary
    );
    const operationalRetentionBoundary = await applyPostgresOperationalRetentionBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:45.000Z").getTime()
    );
    assert.equal(operationalRetentionBoundary.protectedTableCount, 10);
    assert.equal(operationalRetentionBoundary.forcedRlsTableCount, 10);
    assert.equal(operationalRetentionBoundary.directTableGrantCount, 0);
    assert.equal(operationalRetentionBoundary.functionGrantCount, 1);
    assert.equal(operationalRetentionBoundary.membershipCount, 0);
    assert.equal(operationalRetentionBoundary.activePrincipalCount, 0);
    assert.equal(operationalRetentionBoundary.boundaryHandlerTaskKindCount, 1);
    assert.equal(operationalRetentionBoundary.qualifiedHandlerTaskKindCount, 3);
    assert.equal(operationalRetentionBoundary.totalHandlerTaskKindCount, 7);
    assert.equal(operationalRetentionBoundary.serverBoundPrincipalLookup, true);
    assert.equal(operationalRetentionBoundary.serverClockBoundRetention, true);
    assert.equal(operationalRetentionBoundary.serverAuthenticatedReceiptActor, true);
    assert.equal(operationalRetentionBoundary.boundedEvidenceDeletionLimit, 500);
    assert.equal(operationalRetentionBoundary.operationalRetentionRepositoryParity, true);
    assert.equal(operationalRetentionBoundary.executionRecoveryRepositoryParity, true);
    assert.equal(operationalRetentionBoundary.notificationRecoveryRepositoryParity, true);
    assert.equal(operationalRetentionBoundary.fullHandlerRepositoryParity, false);
    assert.equal(operationalRetentionBoundary.directTableAccess, false);
    assert.equal(operationalRetentionBoundary.insertAccess, false);
    assert.equal(operationalRetentionBoundary.deleteAccess, false);
    assert.equal(operationalRetentionBoundary.runtimeAuthority, false);
    assert.match(operationalRetentionBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresOperationalRetentionBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE
      ),
      operationalRetentionBoundary
    );
    const observerCandidateBoundary = await applyPostgresObserverCandidateEvaluationBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:50.000Z").getTime()
    );
    assert.equal(observerCandidateBoundary.protectedTableCount, 5);
    assert.equal(observerCandidateBoundary.forcedRlsTableCount, 5);
    assert.equal(observerCandidateBoundary.directTableGrantCount, 0);
    assert.equal(observerCandidateBoundary.functionGrantCount, 1);
    assert.equal(observerCandidateBoundary.membershipCount, 0);
    assert.equal(observerCandidateBoundary.activePrincipalCount, 0);
    assert.equal(observerCandidateBoundary.boundaryHandlerTaskKindCount, 1);
    assert.equal(observerCandidateBoundary.qualifiedHandlerTaskKindCount, 4);
    assert.equal(observerCandidateBoundary.totalHandlerTaskKindCount, 7);
    assert.equal(observerCandidateBoundary.maximumDiagnosticRows, 2_000);
    assert.equal(observerCandidateBoundary.maximumCandidatesPerRun, 25);
    assert.equal(observerCandidateBoundary.supportedRepairFieldCount, 5);
    assert.equal(observerCandidateBoundary.generatedCandidateLifetimeDays, 30);
    assert.equal(observerCandidateBoundary.serverBoundPrincipalLookup, true);
    assert.equal(observerCandidateBoundary.serverDerivedEvidencePlan, true);
    assert.equal(observerCandidateBoundary.serverClockBoundEvaluation, true);
    assert.equal(observerCandidateBoundary.applicationDeterministicFingerprints, true);
    assert.equal(observerCandidateBoundary.databaseEvidenceRevalidation, true);
    assert.equal(observerCandidateBoundary.quarantinedOnly, true);
    assert.equal(observerCandidateBoundary.generatedCandidatesExecutable, false);
    assert.equal(observerCandidateBoundary.mutationAuthority, false);
    assert.equal(observerCandidateBoundary.observerCandidateEvaluationRepositoryParity, true);
    assert.equal(observerCandidateBoundary.fullHandlerRepositoryParity, false);
    assert.equal(observerCandidateBoundary.directTableAccess, false);
    assert.equal(observerCandidateBoundary.insertAccess, false);
    assert.equal(observerCandidateBoundary.updateAccess, false);
    assert.equal(observerCandidateBoundary.deleteAccess, false);
    assert.equal(observerCandidateBoundary.runtimeAuthority, false);
    assert.match(observerCandidateBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresObserverCandidateEvaluationBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE
      ),
      observerCandidateBoundary
    );
    const alertDispatchBoundary = await applyPostgresOperatorAlertConnectorDispatchBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:55.000Z").getTime()
    );
    assert.equal(alertDispatchBoundary.protectedTableCount, 4);
    assert.equal(alertDispatchBoundary.forcedRlsTableCount, 4);
    assert.equal(alertDispatchBoundary.directTableGrantCount, 0);
    assert.equal(alertDispatchBoundary.functionGrantCount, 1);
    assert.equal(alertDispatchBoundary.membershipCount, 0);
    assert.equal(alertDispatchBoundary.activePrincipalCount, 0);
    assert.equal(alertDispatchBoundary.qualifiedHandlerTaskKindCount, 4);
    assert.equal(alertDispatchBoundary.totalHandlerTaskKindCount, 7);
    assert.equal(alertDispatchBoundary.maximumBindings, 20);
    assert.equal(alertDispatchBoundary.maximumAttempts, 12);
    assert.equal(alertDispatchBoundary.maximumPayloadBytes, 4_000);
    assert.equal(alertDispatchBoundary.twoPhaseLease, true);
    assert.equal(alertDispatchBoundary.applicationHashedOneUseCapabilities, true);
    assert.equal(alertDispatchBoundary.databaseServerClock, true);
    assert.equal(alertDispatchBoundary.endpointReferencesOnly, true);
    assert.equal(alertDispatchBoundary.rawUrlsAccessible, false);
    assert.equal(alertDispatchBoundary.connectorSecretsAccessible, false);
    assert.equal(alertDispatchBoundary.alertDispatchRepositoryParity, true);
    assert.equal(alertDispatchBoundary.alertReconciliationRepositoryParity, false);
    assert.equal(alertDispatchBoundary.fullHandlerRepositoryParity, false);
    assert.equal(alertDispatchBoundary.mutationAuthority, false);
    assert.equal(alertDispatchBoundary.directTableAccess, false);
    assert.equal(alertDispatchBoundary.runtimeAuthority, false);
    assert.equal(alertDispatchBoundary.productionReady, false);
    assert.match(alertDispatchBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresOperatorAlertConnectorDispatchBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE
      ),
      alertDispatchBoundary
    );
    const alertReconciliationBoundary = await applyPostgresOperatorAlertReconciliationBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:57.000Z").getTime()
    );
    assert.equal(alertReconciliationBoundary.protectedTableCount, 10);
    assert.equal(alertReconciliationBoundary.forcedRlsTableCount, 10);
    assert.equal(alertReconciliationBoundary.directTableGrantCount, 0);
    assert.equal(alertReconciliationBoundary.functionGrantCount, 1);
    assert.equal(alertReconciliationBoundary.membershipCount, 0);
    assert.equal(alertReconciliationBoundary.activePrincipalCount, 0);
    assert.equal(alertReconciliationBoundary.qualifiedHandlerTaskKindCount, 5);
    assert.equal(alertReconciliationBoundary.totalHandlerTaskKindCount, 7);
    assert.equal(alertReconciliationBoundary.maximumDiagnostics, 2_000);
    assert.equal(alertReconciliationBoundary.maximumGroups, 50);
    assert.equal(alertReconciliationBoundary.maximumActions, 50);
    assert.equal(alertReconciliationBoundary.maximumRules, 50);
    assert.equal(alertReconciliationBoundary.maximumConnectors, 20);
    assert.equal(alertReconciliationBoundary.maximumConnectorPayloadBytes, 4_000);
    assert.equal(alertReconciliationBoundary.serverDerivedRepairGroups, true);
    assert.equal(alertReconciliationBoundary.databaseEvidenceRevalidation, true);
    assert.equal(alertReconciliationBoundary.twoPhasePlanApply, true);
    assert.equal(alertReconciliationBoundary.databaseServerClock, true);
    assert.equal(alertReconciliationBoundary.applicationGeneratedOpaqueIds, true);
    assert.equal(alertReconciliationBoundary.sanitizedAggregateOnly, true);
    assert.equal(alertReconciliationBoundary.endpointReferencesOnly, true);
    assert.equal(alertReconciliationBoundary.rawUrlsAccessible, false);
    assert.equal(alertReconciliationBoundary.connectorSecretsAccessible, false);
    assert.equal(alertReconciliationBoundary.alertDispatchRepositoryParity, true);
    assert.equal(alertReconciliationBoundary.alertReconciliationRepositoryParity, true);
    assert.equal(alertReconciliationBoundary.fullHandlerRepositoryParity, true);
    assert.equal(alertReconciliationBoundary.mutationAuthority, false);
    assert.equal(alertReconciliationBoundary.directTableAccess, false);
    assert.equal(alertReconciliationBoundary.runtimeAuthority, false);
    assert.equal(alertReconciliationBoundary.productionReady, false);
    assert.match(alertReconciliationBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresOperatorAlertReconciliationBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE
      ),
      alertReconciliationBoundary
    );
    const observerWitnessBoundary = await applyPostgresObserverWitnessRefreshBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:59.000Z").getTime()
    );
    assert.equal(observerWitnessBoundary.protectedTableCount, 6);
    assert.equal(observerWitnessBoundary.forcedRlsTableCount, 6);
    assert.equal(observerWitnessBoundary.directTableGrantCount, 0);
    assert.equal(observerWitnessBoundary.functionGrantCount, 1);
    assert.equal(observerWitnessBoundary.membershipCount, 0);
    assert.equal(observerWitnessBoundary.activePrincipalCount, 0);
    assert.equal(observerWitnessBoundary.qualifiedHandlerTaskKindCount, 6);
    assert.equal(observerWitnessBoundary.totalHandlerTaskKindCount, 7);
    assert.equal(observerWitnessBoundary.maximumEnvelopeBytes, 65_536);
    assert.equal(observerWitnessBoundary.twoPhaseExternalIo, true);
    assert.equal(observerWitnessBoundary.externalIoOutsideTransaction, true);
    assert.equal(observerWitnessBoundary.applicationEd25519Verification, true);
    assert.equal(observerWitnessBoundary.serverDerivedCheckpoint, true);
    assert.equal(observerWitnessBoundary.databasePlanRevalidation, true);
    assert.equal(observerWitnessBoundary.databaseServerClock, true);
    assert.equal(observerWitnessBoundary.serverAuthenticatedReceiptActor, true);
    assert.equal(observerWitnessBoundary.publicCryptographicMetadataOnly, true);
    assert.equal(observerWitnessBoundary.witnessRefreshRepositoryParity, true);
    assert.equal(observerWitnessBoundary.allHandlerRepositoryParity, false);
    assert.equal(observerWitnessBoundary.mutationAuthority, false);
    assert.equal(observerWitnessBoundary.directTableAccess, false);
    assert.equal(observerWitnessBoundary.runtimeAuthority, false);
    assert.equal(observerWitnessBoundary.productionReady, false);
    assert.match(observerWitnessBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresObserverWitnessRefreshBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE
      ),
      observerWitnessBoundary
    );
    const deliveryLeaseRecoveryBoundary = await applyPostgresHostedDeliveryLeaseRecoveryBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:59.500Z").getTime()
    );
    assert.equal(deliveryLeaseRecoveryBoundary.protectedTableCount, 3);
    assert.equal(deliveryLeaseRecoveryBoundary.forcedRlsTableCount, 3);
    assert.equal(deliveryLeaseRecoveryBoundary.directTableGrantCount, 0);
    assert.equal(deliveryLeaseRecoveryBoundary.functionGrantCount, 3);
    assert.equal(deliveryLeaseRecoveryBoundary.membershipCount, 0);
    assert.equal(deliveryLeaseRecoveryBoundary.activePrincipalCount, 0);
    assert.equal(deliveryLeaseRecoveryBoundary.qualifiedHandlerTaskKindCount, 6);
    assert.equal(deliveryLeaseRecoveryBoundary.totalHandlerTaskKindCount, 7);
    assert.equal(deliveryLeaseRecoveryBoundary.maximumDeliveryAttempts, 20);
    assert.equal(deliveryLeaseRecoveryBoundary.maximumResolutionPlanAgeSeconds, 30);
    assert.equal(deliveryLeaseRecoveryBoundary.serverBoundPrincipalLookup, true);
    assert.equal(deliveryLeaseRecoveryBoundary.databaseServerClock, true);
    assert.equal(deliveryLeaseRecoveryBoundary.deterministicReceiptHashParity, true);
    assert.equal(deliveryLeaseRecoveryBoundary.leaseRecoverySubBoundaryParity, true);
    assert.equal(deliveryLeaseRecoveryBoundary.signalInboxLifecycleRepositoryParity, true);
    assert.equal(deliveryLeaseRecoveryBoundary.signalResolutionPlanRepositoryParity, true);
    assert.equal(deliveryLeaseRecoveryBoundary.signalEvaluationApplyRepositoryParity, false);
    assert.equal(deliveryLeaseRecoveryBoundary.sharedCatalogMutationFailClosed, true);
    assert.equal(deliveryLeaseRecoveryBoundary.rawSignalPayloadReturned, false);
    assert.equal(deliveryLeaseRecoveryBoundary.signalEvaluationRepositoryParity, false);
    assert.equal(deliveryLeaseRecoveryBoundary.signalIngressRepositoryParity, false);
    assert.equal(deliveryLeaseRecoveryBoundary.hostedDeliveryHandlerRepositoryParity, false);
    assert.equal(deliveryLeaseRecoveryBoundary.allHandlerRepositoryParity, false);
    assert.equal(deliveryLeaseRecoveryBoundary.mutationAuthority, false);
    assert.equal(deliveryLeaseRecoveryBoundary.directTableAccess, false);
    assert.equal(deliveryLeaseRecoveryBoundary.runtimeAuthority, false);
    assert.equal(deliveryLeaseRecoveryBoundary.productionReady, false);
    assert.match(deliveryLeaseRecoveryBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresHostedDeliveryLeaseRecoveryBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE
      ),
      deliveryLeaseRecoveryBoundary
    );
    const signalCatalogApplyBoundary = await applyPostgresSignalCatalogApplyBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:59.750Z").getTime()
    );
    assert.equal(signalCatalogApplyBoundary.protectedTenantTableCount, 4);
    assert.equal(signalCatalogApplyBoundary.forcedRlsTableCount, 4);
    assert.equal(signalCatalogApplyBoundary.sharedCatalogWriteTableCount, 4);
    assert.equal(signalCatalogApplyBoundary.tenantReferenceWriteTableCount, 3);
    assert.equal(signalCatalogApplyBoundary.directTableGrantCount, 0);
    assert.equal(signalCatalogApplyBoundary.functionGrantCount, 1);
    assert.equal(signalCatalogApplyBoundary.membershipCount, 0);
    assert.equal(signalCatalogApplyBoundary.activePrincipalCount, 0);
    assert.equal(signalCatalogApplyBoundary.maximumPlanAgeSeconds, 30);
    assert.equal(signalCatalogApplyBoundary.supportedExactRetailerCount, 13);
    assert.equal(signalCatalogApplyBoundary.serverBoundPrincipalLookup, true);
    assert.equal(signalCatalogApplyBoundary.databasePlanRevalidation, true);
    assert.equal(signalCatalogApplyBoundary.insertOnlyCatalogMutation, true);
    assert.equal(signalCatalogApplyBoundary.sharedCatalogCreateApplyRepositoryParity, true);
    assert.equal(signalCatalogApplyBoundary.sourceReferenceRefreshRepositoryParity, false);
    assert.equal(signalCatalogApplyBoundary.signalEvaluationGraphMutation, false);
    assert.equal(signalCatalogApplyBoundary.rawSignalPayloadReturned, false);
    assert.equal(signalCatalogApplyBoundary.signalEvaluationApplyRepositoryParity, false);
    assert.equal(signalCatalogApplyBoundary.hostedDeliveryHandlerRepositoryParity, false);
    assert.equal(signalCatalogApplyBoundary.mutationAuthority, true);
    assert.equal(signalCatalogApplyBoundary.directTableAccess, false);
    assert.equal(signalCatalogApplyBoundary.runtimeAuthority, false);
    assert.equal(signalCatalogApplyBoundary.productionReady, false);
    assert.match(signalCatalogApplyBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalCatalogApplyBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE
      ),
      signalCatalogApplyBoundary
    );
    const signalResolutionApplyBoundary = await applyPostgresSignalResolutionApplyBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
      NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:59.875Z").getTime()
    );
    assert.equal(signalResolutionApplyBoundary.protectedTenantTableCount, 4);
    assert.equal(signalResolutionApplyBoundary.forcedRlsTableCount, 4);
    assert.equal(signalResolutionApplyBoundary.mutationTableCount, 3);
    assert.equal(signalResolutionApplyBoundary.directTableGrantCount, 0);
    assert.equal(signalResolutionApplyBoundary.functionGrantCount, 1);
    assert.equal(signalResolutionApplyBoundary.membershipCount, 0);
    assert.equal(signalResolutionApplyBoundary.activePrincipalCount, 0);
    assert.equal(signalResolutionApplyBoundary.maximumPlanAgeSeconds, 30);
    assert.equal(signalResolutionApplyBoundary.serverBoundPrincipalLookup, true);
    assert.equal(signalResolutionApplyBoundary.databasePlanRevalidation, true);
    assert.equal(signalResolutionApplyBoundary.transportDuplicateRepositoryParity, true);
    assert.equal(signalResolutionApplyBoundary.signalEventInsertRepositoryParity, true);
    assert.equal(signalResolutionApplyBoundary.sourceConnectionHeartbeatRepositoryParity, true);
    assert.equal(signalResolutionApplyBoundary.resolutionDecisionInsertRepositoryParity, true);
    assert.equal(signalResolutionApplyBoundary.sharedCatalogMutationFailClosed, true);
    assert.equal(signalResolutionApplyBoundary.sourceReferenceRefreshRepositoryParity, false);
    assert.equal(signalResolutionApplyBoundary.downstreamSignalGraphMutation, false);
    assert.equal(signalResolutionApplyBoundary.inboxLifecycleMutation, false);
    assert.equal(signalResolutionApplyBoundary.rawSignalPayloadReturned, false);
    assert.equal(signalResolutionApplyBoundary.signalEvaluationApplyRepositoryParity, false);
    assert.equal(signalResolutionApplyBoundary.hostedDeliveryHandlerRepositoryParity, false);
    assert.equal(signalResolutionApplyBoundary.mutationAuthority, true);
    assert.equal(signalResolutionApplyBoundary.directTableAccess, false);
    assert.equal(signalResolutionApplyBoundary.runtimeAuthority, false);
    assert.equal(signalResolutionApplyBoundary.productionReady, false);
    assert.match(signalResolutionApplyBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalResolutionApplyBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE
      ),
      signalResolutionApplyBoundary
    );
    const signalSourceReferenceBoundary = await applyPostgresSignalSourceReferenceRefreshBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
      NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
      NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:59.950Z").getTime()
    );
    assert.equal(signalSourceReferenceBoundary.protectedTenantTableCount, 7);
    assert.equal(signalSourceReferenceBoundary.forcedRlsTableCount, 7);
    assert.equal(signalSourceReferenceBoundary.mutationTableCount, 3);
    assert.equal(signalSourceReferenceBoundary.directTableGrantCount, 0);
    assert.equal(signalSourceReferenceBoundary.functionGrantCount, 1);
    assert.equal(signalSourceReferenceBoundary.membershipCount, 0);
    assert.equal(signalSourceReferenceBoundary.activePrincipalCount, 0);
    assert.equal(signalSourceReferenceBoundary.maximumPlanAgeSeconds, 30);
    assert.equal(signalSourceReferenceBoundary.serverBoundPrincipalLookup, true);
    assert.equal(signalSourceReferenceBoundary.databasePlanRevalidation, true);
    assert.equal(signalSourceReferenceBoundary.committedResolutionBinding, true);
    assert.equal(signalSourceReferenceBoundary.matchedResolutionRequired, true);
    assert.equal(signalSourceReferenceBoundary.testSignalMutation, false);
    assert.equal(signalSourceReferenceBoundary.conflictingReferenceFailClosed, true);
    assert.equal(signalSourceReferenceBoundary.idempotentReplay, true);
    assert.equal(signalSourceReferenceBoundary.sourceProductReferenceRepositoryParity, true);
    assert.equal(signalSourceReferenceBoundary.sourceListingReferenceRepositoryParity, true);
    assert.equal(signalSourceReferenceBoundary.sourceProductAliasRepositoryParity, true);
    assert.equal(signalSourceReferenceBoundary.sharedCatalogMutation, false);
    assert.equal(signalSourceReferenceBoundary.sourceReferenceRefreshRepositoryParity, true);
    assert.equal(signalSourceReferenceBoundary.downstreamSignalGraphMutation, false);
    assert.equal(signalSourceReferenceBoundary.inboxLifecycleMutation, false);
    assert.equal(signalSourceReferenceBoundary.rawSignalPayloadReturned, false);
    assert.equal(signalSourceReferenceBoundary.signalEvaluationApplyRepositoryParity, false);
    assert.equal(signalSourceReferenceBoundary.hostedDeliveryHandlerRepositoryParity, false);
    assert.equal(signalSourceReferenceBoundary.mutationAuthority, true);
    assert.equal(signalSourceReferenceBoundary.directTableAccess, false);
    assert.equal(signalSourceReferenceBoundary.runtimeAuthority, false);
    assert.equal(signalSourceReferenceBoundary.productionReady, false);
    assert.match(signalSourceReferenceBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalSourceReferenceRefreshBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE
      ),
      signalSourceReferenceBoundary
    );
    const signalTerminalDecisionBoundary = await applyPostgresSignalTerminalDecisionApplyBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
      NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
      NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
      NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:59.960Z").getTime()
    );
    assert.equal(signalTerminalDecisionBoundary.protectedTenantTableCount, 11);
    assert.equal(signalTerminalDecisionBoundary.forcedRlsTableCount, 11);
    assert.equal(signalTerminalDecisionBoundary.mutationTableCount, 4);
    assert.equal(signalTerminalDecisionBoundary.directTableGrantCount, 0);
    assert.equal(signalTerminalDecisionBoundary.functionGrantCount, 1);
    assert.equal(signalTerminalDecisionBoundary.membershipCount, 0);
    assert.equal(signalTerminalDecisionBoundary.activePrincipalCount, 0);
    assert.equal(signalTerminalDecisionBoundary.maximumPlanAgeSeconds, 30);
    assert.equal(signalTerminalDecisionBoundary.serverBoundPrincipalLookup, true);
    assert.equal(signalTerminalDecisionBoundary.databasePlanRevalidation, true);
    assert.equal(signalTerminalDecisionBoundary.committedResolutionBinding, true);
    assert.equal(signalTerminalDecisionBoundary.settledSourceReferenceRequired, true);
    assert.equal(signalTerminalDecisionBoundary.terminalOutcomeDerivation, true);
    assert.equal(signalTerminalDecisionBoundary.testSignalTerminalOnly, true);
    assert.equal(signalTerminalDecisionBoundary.nonActionableTerminalOnly, true);
    assert.equal(signalTerminalDecisionBoundary.idempotentReplay, true);
    assert.equal(signalTerminalDecisionBoundary.signalOccurrenceRepositoryParity, true);
    assert.equal(signalTerminalDecisionBoundary.terminalMissionDecisionRepositoryParity, true);
    assert.equal(signalTerminalDecisionBoundary.terminalAuditOutboxRepositoryParity, true);
    assert.equal(signalTerminalDecisionBoundary.sharedCatalogMutation, false);
    assert.equal(signalTerminalDecisionBoundary.sourceReferenceMutation, false);
    assert.equal(signalTerminalDecisionBoundary.incidentMutation, false);
    assert.equal(signalTerminalDecisionBoundary.offerObservationMutation, false);
    assert.equal(signalTerminalDecisionBoundary.missionMutation, false);
    assert.equal(signalTerminalDecisionBoundary.actionMutation, false);
    assert.equal(signalTerminalDecisionBoundary.terminalSignalEvaluationRepositoryParity, true);
    assert.equal(signalTerminalDecisionBoundary.terminalSignalGraphMutation, true);
    assert.equal(signalTerminalDecisionBoundary.remainingDownstreamSignalGraphMutation, false);
    assert.equal(signalTerminalDecisionBoundary.inboxLifecycleMutation, false);
    assert.equal(signalTerminalDecisionBoundary.rawSignalPayloadReturned, false);
    assert.equal(signalTerminalDecisionBoundary.signalEvaluationApplyRepositoryParity, false);
    assert.equal(signalTerminalDecisionBoundary.hostedDeliveryHandlerRepositoryParity, false);
    assert.equal(signalTerminalDecisionBoundary.mutationAuthority, true);
    assert.equal(signalTerminalDecisionBoundary.directTableAccess, false);
    assert.equal(signalTerminalDecisionBoundary.runtimeAuthority, false);
    assert.equal(signalTerminalDecisionBoundary.productionReady, false);
    assert.match(signalTerminalDecisionBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalTerminalDecisionApplyBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE
      ),
      signalTerminalDecisionBoundary
    );
    const signalOfferIncidentBoundary = await applyPostgresSignalOfferIncidentApplyBoundary(
      importer,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
      NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
      NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
      NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
      NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE,
      new Date("2026-08-25T16:54:59.970Z").getTime()
    );
    assert.equal(signalOfferIncidentBoundary.protectedTenantTableCount, 14);
    assert.equal(signalOfferIncidentBoundary.forcedRlsTableCount, 14);
    assert.equal(signalOfferIncidentBoundary.mutationTableCount, 3);
    assert.equal(signalOfferIncidentBoundary.directTableGrantCount, 0);
    assert.equal(signalOfferIncidentBoundary.functionGrantCount, 1);
    assert.equal(signalOfferIncidentBoundary.membershipCount, 0);
    assert.equal(signalOfferIncidentBoundary.activePrincipalCount, 0);
    assert.equal(signalOfferIncidentBoundary.maximumPlanAgeSeconds, 30);
    assert.equal(signalOfferIncidentBoundary.serverBoundPrincipalLookup, true);
    assert.equal(signalOfferIncidentBoundary.databasePlanRevalidation, true);
    assert.equal(signalOfferIncidentBoundary.committedResolutionBinding, true);
    assert.equal(signalOfferIncidentBoundary.settledTerminalDecisionRequired, true);
    assert.equal(signalOfferIncidentBoundary.actionableOfferRequired, true);
    assert.equal(signalOfferIncidentBoundary.serverDerivedSemanticKey, true);
    assert.equal(signalOfferIncidentBoundary.deterministicObservationIdentity, true);
    assert.equal(signalOfferIncidentBoundary.messageSerialization, true);
    assert.equal(signalOfferIncidentBoundary.semanticIncidentSerialization, true);
    assert.equal(signalOfferIncidentBoundary.dedupeWindowRepositoryParity, true);
    assert.equal(signalOfferIncidentBoundary.idempotentReplay, true);
    assert.equal(signalOfferIncidentBoundary.partialGraphFailClosed, true);
    assert.equal(signalOfferIncidentBoundary.offerObservationRepositoryParity, true);
    assert.equal(signalOfferIncidentBoundary.signalIncidentRepositoryParity, true);
    assert.equal(signalOfferIncidentBoundary.signalOccurrenceRepositoryParity, true);
    assert.equal(signalOfferIncidentBoundary.sharedCatalogMutation, false);
    assert.equal(signalOfferIncidentBoundary.sourceReferenceMutation, false);
    assert.equal(signalOfferIncidentBoundary.terminalDecisionMutation, false);
    assert.equal(signalOfferIncidentBoundary.missionMutation, false);
    assert.equal(signalOfferIncidentBoundary.actionMutation, false);
    assert.equal(signalOfferIncidentBoundary.offerIncidentGraphMutation, true);
    assert.equal(signalOfferIncidentBoundary.remainingMissionActionGraphMutation, false);
    assert.equal(signalOfferIncidentBoundary.inboxLifecycleMutation, false);
    assert.equal(signalOfferIncidentBoundary.rawSignalPayloadReturned, false);
    assert.equal(signalOfferIncidentBoundary.signalEvaluationApplyRepositoryParity, false);
    assert.equal(signalOfferIncidentBoundary.hostedDeliveryHandlerRepositoryParity, false);
    assert.equal(signalOfferIncidentBoundary.mutationAuthority, true);
    assert.equal(signalOfferIncidentBoundary.directTableAccess, false);
    assert.equal(signalOfferIncidentBoundary.runtimeAuthority, false);
    assert.equal(signalOfferIncidentBoundary.productionReady, false);
    assert.match(signalOfferIncidentBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalOfferIncidentApplyBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
        NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE
      ),
      signalOfferIncidentBoundary
    );
    const signalPostIncidentDecisionBoundary =
      await applyPostgresSignalPostIncidentDecisionApplyBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
        NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE,
        NATIVE_POST_INCIDENT_DECISION_APPLY_ROLE_NAMESPACE,
        new Date("2026-08-25T16:54:59.980Z").getTime()
      );
    assert.equal(signalPostIncidentDecisionBoundary.protectedTenantTableCount, 17);
    assert.equal(signalPostIncidentDecisionBoundary.forcedRlsTableCount, 17);
    assert.equal(signalPostIncidentDecisionBoundary.mutationTableCount, 3);
    assert.equal(signalPostIncidentDecisionBoundary.directTableGrantCount, 0);
    assert.equal(signalPostIncidentDecisionBoundary.functionGrantCount, 1);
    assert.equal(signalPostIncidentDecisionBoundary.membershipCount, 0);
    assert.equal(signalPostIncidentDecisionBoundary.activePrincipalCount, 0);
    assert.equal(signalPostIncidentDecisionBoundary.maximumPlanAgeSeconds, 30);
    assert.equal(signalPostIncidentDecisionBoundary.serverBoundPrincipalLookup, true);
    assert.equal(signalPostIncidentDecisionBoundary.databasePlanRevalidation, true);
    assert.equal(signalPostIncidentDecisionBoundary.committedResolutionBinding, true);
    assert.equal(signalPostIncidentDecisionBoundary.settledOfferIncidentRequired, true);
    assert.equal(signalPostIncidentDecisionBoundary.incidentGraphBinding, true);
    assert.equal(signalPostIncidentDecisionBoundary.existingJobCorroboration, true);
    assert.equal(signalPostIncidentDecisionBoundary.noMissionFailClosed, true);
    assert.equal(signalPostIncidentDecisionBoundary.trustedMissionContinuation, true);
    assert.equal(signalPostIncidentDecisionBoundary.missionBindingRequiredProjection, true);
    assert.equal(signalPostIncidentDecisionBoundary.idempotentReplay, true);
    assert.equal(signalPostIncidentDecisionBoundary.postIncidentDecisionRepositoryParity, true);
    assert.equal(signalPostIncidentDecisionBoundary.postIncidentAuditOutboxRepositoryParity, true);
    assert.equal(signalPostIncidentDecisionBoundary.sharedCatalogMutation, false);
    assert.equal(signalPostIncidentDecisionBoundary.sourceReferenceMutation, false);
    assert.equal(signalPostIncidentDecisionBoundary.terminalDecisionMutation, false);
    assert.equal(signalPostIncidentDecisionBoundary.offerIncidentMutation, false);
    assert.equal(signalPostIncidentDecisionBoundary.incidentMutation, false);
    assert.equal(signalPostIncidentDecisionBoundary.missionMutation, false);
    assert.equal(signalPostIncidentDecisionBoundary.actionMutation, false);
    assert.equal(signalPostIncidentDecisionBoundary.postIncidentDecisionGraphMutation, true);
    assert.equal(signalPostIncidentDecisionBoundary.remainingMissionActionGraphMutation, false);
    assert.equal(signalPostIncidentDecisionBoundary.inboxLifecycleMutation, false);
    assert.equal(signalPostIncidentDecisionBoundary.rawSignalPayloadReturned, false);
    assert.equal(signalPostIncidentDecisionBoundary.signalEvaluationApplyRepositoryParity, false);
    assert.equal(signalPostIncidentDecisionBoundary.hostedDeliveryHandlerRepositoryParity, false);
    assert.equal(signalPostIncidentDecisionBoundary.mutationAuthority, true);
    assert.equal(signalPostIncidentDecisionBoundary.directTableAccess, false);
    assert.equal(signalPostIncidentDecisionBoundary.runtimeAuthority, false);
    assert.equal(signalPostIncidentDecisionBoundary.productionReady, false);
    assert.match(
      signalPostIncidentDecisionBoundary.boundaryCatalogFingerprint,
      /^[a-f0-9]{64}$/
    );
    assert.deepEqual(
      await verifyPostgresSignalPostIncidentDecisionApplyBoundary(
        importer,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
        NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE,
        NATIVE_POST_INCIDENT_DECISION_APPLY_ROLE_NAMESPACE
      ),
      signalPostIncidentDecisionBoundary
    );
    const qualifiedSignalMissionBindingPredecessor =
      buildPostgresSignalPostIncidentDecisionApplyManifest(
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
        NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE,
        NATIVE_POST_INCIDENT_DECISION_APPLY_ROLE_NAMESPACE
      );
    const qualifiedSignalMissionBindingManifest =
      buildPostgresSignalMissionBindingApplyManifest(
        qualifiedSignalMissionBindingPredecessor,
        NATIVE_MISSION_BINDING_APPLY_ROLE_NAMESPACE
      );
    const signalMissionBindingBoundary =
      await applyPostgresSignalMissionBindingApplyBoundary(
        importer,
        qualifiedSignalMissionBindingManifest,
        new Date("2026-08-25T16:54:59.990Z").getTime()
      );
    assert.equal(signalMissionBindingBoundary.protectedTenantTableCount, 18);
    assert.equal(signalMissionBindingBoundary.forcedRlsTableCount, 18);
    assert.equal(signalMissionBindingBoundary.mutationTableCount, 5);
    assert.equal(signalMissionBindingBoundary.directTableGrantCount, 0);
    assert.equal(signalMissionBindingBoundary.functionGrantCount, 1);
    assert.equal(signalMissionBindingBoundary.membershipCount, 0);
    assert.equal(signalMissionBindingBoundary.activePrincipalCount, 0);
    assert.equal(signalMissionBindingBoundary.maximumPlanAgeSeconds, 30);
    assert.equal(signalMissionBindingBoundary.maximumVariantListings, 10_000);
    assert.equal(signalMissionBindingBoundary.serverBoundPrincipalLookup, true);
    assert.equal(signalMissionBindingBoundary.databasePlanRevalidation, true);
    assert.equal(signalMissionBindingBoundary.settledPostIncidentDecisionRequired, true);
    assert.equal(signalMissionBindingBoundary.messageSerialization, true);
    assert.equal(signalMissionBindingBoundary.variantMissionSerialization, true);
    assert.equal(signalMissionBindingBoundary.existingMissionBinding, true);
    assert.equal(signalMissionBindingBoundary.trustedMissionCreation, true);
    assert.equal(signalMissionBindingBoundary.exactVariantTargetAttachment, true);
    assert.equal(signalMissionBindingBoundary.initialIntentPolicyCreation, true);
    assert.equal(signalMissionBindingBoundary.appendOnlyPolicyRevision, true);
    assert.equal(signalMissionBindingBoundary.missionQuantityParity, true);
    assert.equal(signalMissionBindingBoundary.targetPolicyJsonParity, true);
    assert.equal(signalMissionBindingBoundary.purchasePolicyHashParity, true);
    assert.equal(signalMissionBindingBoundary.idempotentReplay, true);
    assert.equal(signalMissionBindingBoundary.missionBindingRepositoryParity, true);
    assert.equal(signalMissionBindingBoundary.missionAuditOutboxRepositoryParity, true);
    assert.equal(signalMissionBindingBoundary.initialPolicyAuditOutboxRepositoryParity, true);
    assert.equal(signalMissionBindingBoundary.sharedCatalogMutation, false);
    assert.equal(signalMissionBindingBoundary.incidentMutation, false);
    assert.equal(signalMissionBindingBoundary.terminalDecisionMutation, false);
    assert.equal(signalMissionBindingBoundary.actionMutation, false);
    assert.equal(signalMissionBindingBoundary.spendMutation, false);
    assert.equal(signalMissionBindingBoundary.inboxLifecycleMutation, false);
    assert.equal(signalMissionBindingBoundary.rawSignalPayloadReturned, false);
    assert.equal(signalMissionBindingBoundary.signalEvaluationApplyRepositoryParity, false);
    assert.equal(signalMissionBindingBoundary.hostedDeliveryHandlerRepositoryParity, false);
    assert.equal(signalMissionBindingBoundary.mutationAuthority, true);
    assert.equal(signalMissionBindingBoundary.directTableAccess, false);
    assert.equal(signalMissionBindingBoundary.runtimeAuthority, false);
    assert.equal(signalMissionBindingBoundary.productionReady, false);
    assert.match(signalMissionBindingBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalMissionBindingApplyBoundary(
        importer,
        qualifiedSignalMissionBindingManifest
      ),
      signalMissionBindingBoundary
    );
    const qualifiedSignalStrategyEvaluationManifest =
      buildPostgresSignalStrategyEvaluationApplyManifest(
        qualifiedSignalMissionBindingManifest,
        NATIVE_STRATEGY_EVALUATION_APPLY_ROLE_NAMESPACE
      );
    const signalStrategyEvaluationBoundary =
      await applyPostgresSignalStrategyEvaluationApplyBoundary(
        importer,
        qualifiedSignalStrategyEvaluationManifest,
        new Date("2026-08-25T16:54:59.992Z").getTime()
      );
    assert.equal(signalStrategyEvaluationBoundary.protectedTenantTableCount, 19);
    assert.equal(signalStrategyEvaluationBoundary.forcedRlsTableCount, 19);
    assert.equal(signalStrategyEvaluationBoundary.mutationTableCount, 3);
    assert.equal(signalStrategyEvaluationBoundary.directTableGrantCount, 0);
    assert.equal(signalStrategyEvaluationBoundary.functionGrantCount, 1);
    assert.equal(signalStrategyEvaluationBoundary.membershipCount, 0);
    assert.equal(signalStrategyEvaluationBoundary.activePrincipalCount, 0);
    assert.equal(signalStrategyEvaluationBoundary.metadata.maximumPlanAgeSeconds, 30);
    assert.equal(signalStrategyEvaluationBoundary.metadata.maximumStrategies, 100);
    assert.equal(signalStrategyEvaluationBoundary.metadata.databaseSemanticEvaluation, false);
    assert.equal(signalStrategyEvaluationBoundary.metadata.evaluationAuthority, false);
    assert.equal(signalStrategyEvaluationBoundary.metadata.runtimeAuthority, false);
    assert.match(signalStrategyEvaluationBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalStrategyEvaluationApplyBoundary(
        importer,
        qualifiedSignalStrategyEvaluationManifest
      ),
      signalStrategyEvaluationBoundary
    );
    const qualifiedSignalWriterLockManifest =
      buildPostgresSignalWriterLockProtocolManifest(
        qualifiedSignalStrategyEvaluationManifest,
        NATIVE_WRITER_LOCK_ROLE_NAMESPACE
      );
    const signalWriterLockBoundary = await applyPostgresSignalWriterLockProtocolBoundary(
      importer,
      qualifiedSignalWriterLockManifest,
      new Date("2026-08-25T16:54:59.993Z").getTime()
    );
    assert.equal(signalWriterLockBoundary.protectedTenantTableCount, 7);
    assert.equal(signalWriterLockBoundary.forcedRlsTableCount, 7);
    assert.equal(signalWriterLockBoundary.mutationTableCount, 0);
    assert.equal(signalWriterLockBoundary.directTableGrantCount, 0);
    assert.equal(signalWriterLockBoundary.functionGrantCount, 1);
    assert.equal(signalWriterLockBoundary.membershipCount, 0);
    assert.equal(signalWriterLockBoundary.activePrincipalCount, 0);
    assert.equal(signalWriterLockBoundary.metadata.lockOnly, true);
    assert.equal(signalWriterLockBoundary.metadata.actionSpendConsumerParity, true);
    assert.equal(signalWriterLockBoundary.metadata.configurationWriterParity, false);
    assert.equal(signalWriterLockBoundary.metadata.reservationWriterParity, false);
    assert.equal(signalWriterLockBoundary.metadata.writerLockProtocolParity, false);
    assert.equal(signalWriterLockBoundary.metadata.runtimeAuthority, false);
    assert.match(signalWriterLockBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalWriterLockProtocolBoundary(
        importer,
        qualifiedSignalWriterLockManifest
      ),
      signalWriterLockBoundary
    );
    const qualifiedSignalConstraintConfigManifest =
      buildPostgresSignalConstraintConfigApplyManifest(
        qualifiedSignalWriterLockManifest,
        NATIVE_CONSTRAINT_CONFIG_APPLY_ROLE_NAMESPACE
      );
    const signalConstraintConfigBoundary =
      await applyPostgresSignalConstraintConfigApplyBoundary(
        importer,
        qualifiedSignalConstraintConfigManifest,
        new Date("2026-08-25T16:54:59.994Z").getTime()
      );
    assert.equal(signalConstraintConfigBoundary.protectedTenantTableCount, 4);
    assert.equal(signalConstraintConfigBoundary.forcedRlsTableCount, 4);
    assert.equal(signalConstraintConfigBoundary.mutationTableCount, 4);
    assert.equal(signalConstraintConfigBoundary.directTableGrantCount, 0);
    assert.equal(signalConstraintConfigBoundary.functionGrantCount, 1);
    assert.equal(signalConstraintConfigBoundary.membershipCount, 0);
    assert.equal(signalConstraintConfigBoundary.activePrincipalCount, 0);
    assert.equal(signalConstraintConfigBoundary.metadata.operationCount, 3);
    assert.equal(signalConstraintConfigBoundary.metadata.sharedWriterLockProtocolImplemented, true);
    assert.equal(signalConstraintConfigBoundary.metadata.writerLockProtocolConsumed, true);
    assert.equal(signalConstraintConfigBoundary.metadata.settingsPauseWriterParity, true);
    assert.equal(signalConstraintConfigBoundary.metadata.guardrailSettingsWriterParity, true);
    assert.equal(signalConstraintConfigBoundary.metadata.spendPolicyWriterParity, true);
    assert.equal(signalConstraintConfigBoundary.metadata.qualificationSettingsWriterParity, false);
    assert.equal(signalConstraintConfigBoundary.metadata.sourceWriterParity, false);
    assert.equal(signalConstraintConfigBoundary.metadata.retailerQualificationWriterParity, false);
    assert.equal(signalConstraintConfigBoundary.metadata.missionPolicyWriterParity, false);
    assert.equal(signalConstraintConfigBoundary.metadata.settingsWriterParity, false);
    assert.equal(signalConstraintConfigBoundary.metadata.configurationWriterParity, false);
    assert.equal(signalConstraintConfigBoundary.metadata.reservationWriterParity, false);
    assert.equal(signalConstraintConfigBoundary.metadata.writerLockProtocolParity, false);
    assert.equal(signalConstraintConfigBoundary.metadata.runtimeAuthority, false);
    assert.match(signalConstraintConfigBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalConstraintConfigApplyBoundary(
        importer,
        qualifiedSignalConstraintConfigManifest
      ),
      signalConstraintConfigBoundary
    );
    const qualifiedSignalActionSpendManifest =
      buildPostgresSignalActionSpendApplyManifest(
        qualifiedSignalConstraintConfigManifest,
        NATIVE_ACTION_SPEND_APPLY_ROLE_NAMESPACE
      );
    const signalActionSpendBoundary = await applyPostgresSignalActionSpendApplyBoundary(
      importer,
      qualifiedSignalActionSpendManifest,
      new Date("2026-08-25T16:54:59.995Z").getTime()
    );
    assert.equal(signalActionSpendBoundary.protectedTenantTableCount, 20);
    assert.equal(signalActionSpendBoundary.forcedRlsTableCount, 20);
    assert.equal(signalActionSpendBoundary.mutationTableCount, 9);
    assert.equal(signalActionSpendBoundary.directTableGrantCount, 0);
    assert.equal(signalActionSpendBoundary.functionGrantCount, 1);
    assert.equal(signalActionSpendBoundary.membershipCount, 0);
    assert.equal(signalActionSpendBoundary.activePrincipalCount, 0);
    assert.equal(signalActionSpendBoundary.metadata.maximumPlanAgeSeconds, 30);
    assert.equal(signalActionSpendBoundary.metadata.writerLockProtocolContractVersion, 1);
    assert.equal(signalActionSpendBoundary.metadata.sharedWriterLockProtocolImplemented, true);
    assert.equal(signalActionSpendBoundary.metadata.writerLockProtocolConsumed, true);
    assert.equal(signalActionSpendBoundary.metadata.constraintConfigApplyContractVersion, 1);
    assert.equal(signalActionSpendBoundary.metadata.constraintConfigBoundaryQualified, true);
    assert.equal(signalActionSpendBoundary.metadata.settingsPauseWriterParity, true);
    assert.equal(signalActionSpendBoundary.metadata.guardrailSettingsWriterParity, true);
    assert.equal(signalActionSpendBoundary.metadata.spendPolicyWriterParity, true);
    assert.equal(signalActionSpendBoundary.metadata.configurationWriterParity, false);
    assert.equal(signalActionSpendBoundary.metadata.fixedOrderConfigurationLocks, true);
    assert.equal(signalActionSpendBoundary.metadata.purchaseIntentOnly, false);
    assert.equal(signalActionSpendBoundary.metadata.strategyActionAuthority, false);
    assert.equal(signalActionSpendBoundary.metadata.strategySemanticsContractVersion, 2);
    assert.equal(signalActionSpendBoundary.metadata.strategyDecisionSourceAccepted, true);
    assert.equal(signalActionSpendBoundary.metadata.strategyExistenceRevalidation, true);
    assert.equal(signalActionSpendBoundary.metadata.strategyFailoverToNotifyEnforced, true);
    assert.equal(signalActionSpendBoundary.metadata.strategyCartActionAuthority, false);
    assert.equal(signalActionSpendBoundary.metadata.strategyReservationAuthority, false);
    assert.equal(signalActionSpendBoundary.metadata.trustedStrategyActionSemanticsQualified, true);
    assert.deepEqual(signalActionSpendBoundary.metadata.strategyRevalidatedTableNames, ["strategies"]);
    assert.equal(signalActionSpendBoundary.metadata.writerLockProtocolParity, false);
    assert.equal(signalActionSpendBoundary.metadata.attributionPolicyParity, false);
    assert.equal(signalActionSpendBoundary.metadata.runtimeAuthority, false);
    assert.match(signalActionSpendBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalActionSpendApplyBoundary(
        importer,
        qualifiedSignalActionSpendManifest
      ),
      signalActionSpendBoundary
    );
    await (async () => {
    // --- v0.98: complete signal-evaluation APPLY composition proof ---
    // buildPostgresSignalEvaluationCompositionManifest() and
    // verifyPostgresSignalEvaluationCompositionBoundary() are parameterless —
    // unlike every other boundary module composed above, this module offers
    // no predecessor-manifest or namespace override, so it can only ever
    // describe the ONE reference deployment every composed builder's own
    // zero-arg defaults resolve to (schema "yoink_cutover", role namespaces
    // ending "_qualification"/"_qual"). To prove
    // verifyPostgresSignalEvaluationCompositionBoundary against a live
    // database (not just the module's own PGlite contract tests), this
    // section stands up that complete default-namespaced deployment — base
    // roles through all eleven composed boundaries — inside the same live
    // Postgres instance, independent of (and alongside) the
    // NATIVE_*-namespaced deployment qualified above.
    const defaultChainImported = await importPostgresCutoverArchive(
      importer,
      fixture.archivePath
    );
    assert.equal(defaultChainImported.matched, true);
    await applyPostgresRuntimeReadRoles(importer);
    await applyPostgresTenantSessionBoundary(importer);
    await applyPostgresTenantQueueWriteBoundary(importer);
    await applyPostgresWorkerControlBoundary(importer);
    await applyPostgresNotificationRecoveryBoundary(importer);
    await applyPostgresExecutionRecoveryBoundary(importer);
    await applyPostgresOperationalRetentionBoundary(importer);
    await applyPostgresObserverCandidateEvaluationBoundary(importer);
    await applyPostgresOperatorAlertConnectorDispatchBoundary(importer);
    await applyPostgresOperatorAlertReconciliationBoundary(importer);
    await applyPostgresObserverWitnessRefreshBoundary(importer);
    await applyPostgresHostedDeliveryLeaseRecoveryBoundary(importer);
    await applyPostgresSignalCatalogApplyBoundary(importer);
    await applyPostgresSignalResolutionApplyBoundary(importer);
    await applyPostgresSignalSourceReferenceRefreshBoundary(importer);
    await applyPostgresSignalTerminalDecisionApplyBoundary(importer);
    await applyPostgresSignalOfferIncidentApplyBoundary(importer);
    await applyPostgresSignalPostIncidentDecisionApplyBoundary(importer);
    await applyPostgresSignalMissionBindingApplyBoundary(importer);
    await applyPostgresSignalStrategyEvaluationApplyBoundary(importer);
    await applyPostgresSignalWriterLockProtocolBoundary(importer);
    await applyPostgresSignalConstraintConfigApplyBoundary(importer);
    await applyPostgresSignalActionSpendApplyBoundary(importer);

    const signalEvaluationCompositionManifest = buildPostgresSignalEvaluationCompositionManifest();
    assert.deepEqual(
      buildPostgresSignalEvaluationCompositionManifest(),
      signalEvaluationCompositionManifest
    );
    assert.equal(signalEvaluationCompositionManifest.contractVersion, POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION);
    assert.equal(
      signalEvaluationCompositionManifest.actionSpendApplyContractVersion,
      POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION
    );
    assert.equal(
      signalEvaluationCompositionManifest.schemaName,
      signalEvaluationCompositionManifest.actionSpendApplyManifest.schemaName
    );

    // Chain completeness: eleven fingerprints, exactly once, in the declared
    // predecessor order, each matching what the corresponding boundary
    // module's own zero-arg builder computes today (the same manifests this
    // proof just applied to the live default-namespaced deployment above).
    assert.equal(signalEvaluationCompositionManifest.chain.length, POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_LENGTH);
    assert.equal(signalEvaluationCompositionManifest.chainBoundaryCount, 11);
    assert.deepEqual(
      signalEvaluationCompositionManifest.chain.map((entry) => entry.boundary),
      [...POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_ORDER]
    );
    assert.equal(new Set(signalEvaluationCompositionManifest.chain.map((entry) => entry.boundary)).size, 11);
    assert.equal(new Set(signalEvaluationCompositionManifest.chain.map((entry) => entry.fingerprint)).size, 11);
    const signalEvaluationCompositionBoundaryManifestBuilders: ReadonlyArray<
      readonly [string, () => { readonly fingerprint: string }]
    > = [
      ["catalogApply", buildPostgresSignalCatalogApplyManifest],
      ["resolutionApply", buildPostgresSignalResolutionApplyManifest],
      ["sourceReferenceRefresh", buildPostgresSignalSourceReferenceRefreshManifest],
      ["terminalDecisionApply", buildPostgresSignalTerminalDecisionApplyManifest],
      ["offerIncidentApply", buildPostgresSignalOfferIncidentApplyManifest],
      ["postIncidentDecisionApply", buildPostgresSignalPostIncidentDecisionApplyManifest],
      ["missionBindingApply", buildPostgresSignalMissionBindingApplyManifest],
      ["strategyEvaluationApply", buildPostgresSignalStrategyEvaluationApplyManifest],
      ["writerLockProtocol", buildPostgresSignalWriterLockProtocolManifest],
      ["constraintConfigApply", buildPostgresSignalConstraintConfigApplyManifest],
      ["actionSpendApply", buildPostgresSignalActionSpendApplyManifest]
    ];
    for (const [boundary, builder] of signalEvaluationCompositionBoundaryManifestBuilders) {
      assert.match(builder().fingerprint, /^[a-f0-9]{64}$/);
      assert.equal(
        signalEvaluationCompositionManifest.chain.find((entry) => entry.boundary === boundary)?.fingerprint,
        builder().fingerprint
      );
    }
    for (const entry of signalEvaluationCompositionManifest.chain) {
      assert.match(entry.fingerprint, /^[a-f0-9]{64}$/);
      if (entry.boundary === "writerLockProtocol") {
        assert.equal(entry.mutationAuthority, false);
      } else {
        assert.equal(entry.mutationAuthority, true);
      }
    }

    // Mutation-family coverage: total, zero unmapped, plus the two
    // writer-discipline boundaries that own no family of their own.
    assert.equal(signalEvaluationCompositionManifest.mutationFamilies.length, POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT);
    assert.equal(signalEvaluationCompositionManifest.mutationFamilies.length, 10);
    assert.equal(signalEvaluationCompositionManifest.unmappedMutationFamilyCount, 0);
    assert.equal(signalEvaluationCompositionManifest.unmappedChainBoundaryCount, 0);
    assert.deepEqual(
      [...signalEvaluationCompositionManifest.writerDisciplineBoundaries].sort(),
      ["constraintConfigApply", "writerLockProtocol"]
    );
    const signalEvaluationCompositionCoveredBoundaries = new Set([
      ...signalEvaluationCompositionManifest.mutationFamilies.map((entry) => entry.boundary),
      ...signalEvaluationCompositionManifest.writerDisciplineBoundaries
    ]);
    assert.deepEqual(
      [...signalEvaluationCompositionCoveredBoundaries].sort(),
      [...POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_ORDER].sort()
    );
    assert.ok(signalEvaluationCompositionManifest.knownOutOfScopeWrites.length >= 4);

    // Projection flags: the newly-closed flag is true; every other repository
    // parity flag stays false; runtime authority stays false.
    assert.equal(signalEvaluationCompositionManifest.noNewRoleCreated, true);
    assert.equal(signalEvaluationCompositionManifest.noNewFunctionCreated, true);
    assert.equal(signalEvaluationCompositionManifest.noNewMutationPath, true);
    assert.equal(signalEvaluationCompositionManifest.signalEvaluationApplyRepositoryParity, true);
    assert.equal(signalEvaluationCompositionManifest.signalEvaluationRepositoryParity, false);
    assert.equal(signalEvaluationCompositionManifest.signalIngressRepositoryParity, false);
    assert.equal(signalEvaluationCompositionManifest.hostedDeliveryHandlerRepositoryParity, false);
    assert.equal(signalEvaluationCompositionManifest.allHandlerRepositoryParity, false);
    assert.equal(signalEvaluationCompositionManifest.mutationAuthority, true);
    assert.equal(signalEvaluationCompositionManifest.activePrincipalCount, 0);
    assert.equal(signalEvaluationCompositionManifest.runtimeAuthority, false);
    assert.match(signalEvaluationCompositionManifest.fingerprint, /^[a-f0-9]{64}$/);

    const signalEvaluationCompositionCapability = postgresSignalEvaluationCompositionCapabilityProjection();
    assert.deepEqual(postgresSignalEvaluationCompositionCapabilityProjection(), signalEvaluationCompositionCapability);
    assert.equal(signalEvaluationCompositionCapability.chainBoundaryCount, 11);
    assert.equal(signalEvaluationCompositionCapability.mutationFamilyCount, 10);
    assert.equal(signalEvaluationCompositionCapability.unmappedMutationFamilyCount, 0);
    assert.equal(signalEvaluationCompositionCapability.noNewRoleCreated, true);
    assert.equal(signalEvaluationCompositionCapability.noNewFunctionCreated, true);
    assert.equal(signalEvaluationCompositionCapability.noNewMutationPath, true);
    assert.equal(signalEvaluationCompositionCapability.signalEvaluationApplyRepositoryParity, true);
    assert.equal(signalEvaluationCompositionCapability.signalEvaluationRepositoryParity, false);
    assert.equal(signalEvaluationCompositionCapability.signalIngressRepositoryParity, false);
    assert.equal(signalEvaluationCompositionCapability.hostedDeliveryHandlerRepositoryParity, false);
    assert.equal(signalEvaluationCompositionCapability.allHandlerRepositoryParity, false);
    assert.equal(signalEvaluationCompositionCapability.activePrincipalCount, 0);
    assert.equal(signalEvaluationCompositionCapability.activeRuntimeRoleApplied, false);
    assert.equal(signalEvaluationCompositionCapability.mutationAuthority, true);
    assert.equal(signalEvaluationCompositionCapability.runtimeAuthority, false);
    assert.equal(signalEvaluationCompositionCapability.productionReady, false);
    assert.equal(
      signalEvaluationCompositionCapability.roleTemplateFingerprint,
      signalEvaluationCompositionManifest.fingerprint
    );

    // verifyPostgresSignalEvaluationCompositionBoundary against the live,
    // freshly-qualified default-namespace deployment must PASS: it re-derives
    // the manifest (catching sequence-contract drift) and cascades a single
    // live call to the chain tip (actionSpendApply), which itself cascades
    // down through every composed boundary's own live role/function/RLS
    // inspection.
    assert.deepEqual(
      await verifyPostgresSignalEvaluationCompositionBoundary(importer, signalEvaluationCompositionManifest),
      signalEvaluationCompositionManifest
    );

    // Negative proof: tamper the chain tip's (actionSpendApply) live
    // SECURITY DEFINER function and confirm the composition verify fails
    // closed — mirroring the ALTER FUNCTION ... STABLE / VOLATILE
    // receipt-tamper precedent used elsewhere in this suite (e.g. the
    // mission-binding and strategy-evaluation boundary tamper checks below).
    // The failure surfaces from the cascaded
    // verifyPostgresSignalActionSpendApplyBoundary call, not from the
    // composition's own (purely in-process) sequence-contract check.
    await importer.query(
      `ALTER FUNCTION "${signalEvaluationCompositionManifest.schemaName}"."${POSTGRES_SIGNAL_ACTION_SPEND_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresSignalEvaluationCompositionBoundary(importer, signalEvaluationCompositionManifest),
      /qualified security-definer function is incomplete|drifted from its receipt/
    );
    await importer.query(
      `ALTER FUNCTION "${signalEvaluationCompositionManifest.schemaName}"."${POSTGRES_SIGNAL_ACTION_SPEND_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.deepEqual(
      await verifyPostgresSignalEvaluationCompositionBoundary(importer, signalEvaluationCompositionManifest),
      signalEvaluationCompositionManifest
    );
    })();
    const qualifiedSignalTargetQualificationManifest =
      buildPostgresSignalTargetQualificationApplyManifest(
        qualifiedSignalActionSpendManifest,
        NATIVE_TARGET_QUALIFICATION_APPLY_ROLE_NAMESPACE
      );
    const signalTargetQualificationBoundary =
      await applyPostgresSignalTargetQualificationApplyBoundary(
        importer,
        qualifiedSignalTargetQualificationManifest,
        new Date("2026-08-25T16:54:59.996Z").getTime()
      );
    assert.equal(signalTargetQualificationBoundary.protectedTenantTableCount, 9);
    assert.equal(signalTargetQualificationBoundary.forcedRlsTableCount, 9);
    assert.equal(signalTargetQualificationBoundary.mutationTableCount, 6);
    assert.equal(signalTargetQualificationBoundary.directTableGrantCount, 0);
    assert.equal(signalTargetQualificationBoundary.functionGrantCount, 1);
    assert.equal(signalTargetQualificationBoundary.membershipCount, 0);
    assert.equal(signalTargetQualificationBoundary.activePrincipalCount, 0);
    assert.equal(signalTargetQualificationBoundary.metadata.operationCount, 1);
    assert.equal(signalTargetQualificationBoundary.metadata.writerLockProtocolConsumed, true);
    assert.equal(signalTargetQualificationBoundary.metadata.retailerQualificationScopeConsumed, true);
    assert.equal(signalTargetQualificationBoundary.metadata.settingsScopeConsumed, true);
    assert.equal(signalTargetQualificationBoundary.metadata.currentEvidenceRevalidation, true);
    assert.equal(signalTargetQualificationBoundary.metadata.currentDeviceCapabilityRevalidation, true);
    assert.equal(signalTargetQualificationBoundary.metadata.targetQualificationSettingsWriterParity, true);
    assert.equal(signalTargetQualificationBoundary.metadata.targetJobPromotionParity, true);
    assert.equal(signalTargetQualificationBoundary.metadata.qualificationSettingsWriterParity, true);
    assert.equal(signalTargetQualificationBoundary.metadata.sourceWriterParity, false);
    assert.equal(signalTargetQualificationBoundary.metadata.retailerQualificationWriterParity, false);
    assert.equal(signalTargetQualificationBoundary.metadata.missionPolicyWriterParity, false);
    assert.equal(signalTargetQualificationBoundary.metadata.configurationWriterParity, false);
    assert.equal(signalTargetQualificationBoundary.metadata.reservationWriterParity, false);
    assert.equal(signalTargetQualificationBoundary.metadata.writerLockProtocolParity, false);
    assert.equal(signalTargetQualificationBoundary.metadata.runtimeAuthority, false);
    assert.match(signalTargetQualificationBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalTargetQualificationApplyBoundary(
        importer,
        qualifiedSignalTargetQualificationManifest
      ),
      signalTargetQualificationBoundary
    );
    const qualifiedSignalSourceTrustManifest =
      buildPostgresSignalSourceTrustApplyManifest(
        qualifiedSignalTargetQualificationManifest,
        NATIVE_SOURCE_TRUST_APPLY_ROLE_NAMESPACE
      );
    const signalSourceTrustBoundary = await applyPostgresSignalSourceTrustApplyBoundary(
      importer,
      qualifiedSignalSourceTrustManifest,
      new Date("2026-08-25T16:54:59.997Z").getTime()
    );
    assert.equal(signalSourceTrustBoundary.protectedTenantTableCount, 3);
    assert.equal(signalSourceTrustBoundary.forcedRlsTableCount, 3);
    assert.equal(signalSourceTrustBoundary.mutationTableCount, 3);
    assert.equal(signalSourceTrustBoundary.directTableGrantCount, 0);
    assert.equal(signalSourceTrustBoundary.functionGrantCount, 1);
    assert.equal(signalSourceTrustBoundary.membershipCount, 0);
    assert.equal(signalSourceTrustBoundary.activePrincipalCount, 0);
    assert.equal(signalSourceTrustBoundary.metadata.operationCount, 1);
    assert.equal(signalSourceTrustBoundary.metadata.writerLockProtocolConsumed, true);
    assert.equal(signalSourceTrustBoundary.metadata.sourceScopeConsumed, true);
    assert.equal(signalSourceTrustBoundary.metadata.optimisticConcurrency, true);
    assert.equal(signalSourceTrustBoundary.metadata.atomicSourceAuditOutbox, true);
    assert.equal(signalSourceTrustBoundary.metadata.currentSourceOwnershipRevalidation, true);
    assert.equal(signalSourceTrustBoundary.metadata.privateSourceOnly, true);
    assert.equal(signalSourceTrustBoundary.metadata.trustedExactAutoCreateCoupling, true);
    assert.equal(signalSourceTrustBoundary.metadata.sourceTrustWriterParity, true);
    assert.equal(signalSourceTrustBoundary.metadata.sourceWriterParity, false);
    assert.equal(signalSourceTrustBoundary.metadata.retailerQualificationWriterParity, false);
    assert.equal(signalSourceTrustBoundary.metadata.configurationWriterParity, false);
    assert.equal(signalSourceTrustBoundary.metadata.reservationWriterParity, false);
    assert.equal(signalSourceTrustBoundary.metadata.writerLockProtocolParity, false);
    assert.equal(signalSourceTrustBoundary.metadata.runtimeAuthority, false);
    assert.match(signalSourceTrustBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalSourceTrustApplyBoundary(
        importer,
        qualifiedSignalSourceTrustManifest
      ),
      signalSourceTrustBoundary
    );
    const qualifiedSignalRetailerQualificationManifest =
      buildPostgresSignalRetailerQualificationApplyManifest(
        qualifiedSignalSourceTrustManifest,
        NATIVE_RETAILER_QUALIFICATION_APPLY_ROLE_NAMESPACE
      );
    const signalRetailerQualificationBoundary =
      await applyPostgresSignalRetailerQualificationApplyBoundary(
        importer,
        qualifiedSignalRetailerQualificationManifest,
        new Date("2026-08-25T16:54:59.998Z").getTime()
      );
    assert.equal(signalRetailerQualificationBoundary.protectedTenantTableCount, 9);
    assert.equal(signalRetailerQualificationBoundary.forcedRlsTableCount, 9);
    assert.equal(signalRetailerQualificationBoundary.mutationTableCount, 5);
    assert.equal(signalRetailerQualificationBoundary.directTableGrantCount, 0);
    assert.equal(signalRetailerQualificationBoundary.functionGrantCount, 1);
    assert.equal(signalRetailerQualificationBoundary.membershipCount, 0);
    assert.equal(signalRetailerQualificationBoundary.activePrincipalCount, 0);
    assert.equal(signalRetailerQualificationBoundary.metadata.operationCount, 3);
    assert.deepEqual(
      signalRetailerQualificationBoundary.metadata.supportedRetailerIds,
      ["amazon", "bestbuy", "walmart"]
    );
    assert.deepEqual(
      signalRetailerQualificationBoundary.metadata.protectedSharedCatalogTableNames,
      ["listings", "retailers"]
    );
    assert.equal(
      signalRetailerQualificationBoundary.metadata.sharedCatalogMutationTableCount,
      2
    );
    assert.equal(signalRetailerQualificationBoundary.metadata.totalMutationTableCount, 7);
    assert.equal(signalRetailerQualificationBoundary.metadata.writerLockProtocolConsumed, true);
    assert.equal(
      signalRetailerQualificationBoundary.metadata.retailerQualificationScopeConsumed,
      true
    );
    assert.equal(signalRetailerQualificationBoundary.metadata.settingsScopeConsumed, true);
    assert.equal(signalRetailerQualificationBoundary.metadata.globalRetailerSerialization, true);
    assert.equal(signalRetailerQualificationBoundary.metadata.exactPackagedRetailerAllowlist, true);
    assert.equal(signalRetailerQualificationBoundary.metadata.monotonicSharedCatalogPromotion, true);
    assert.equal(signalRetailerQualificationBoundary.metadata.currentEvidenceRevalidation, true);
    assert.equal(
      signalRetailerQualificationBoundary.metadata.currentDeviceCapabilityRevalidation,
      true
    );
    assert.equal(signalRetailerQualificationBoundary.metadata.currentSettingsRevalidation, true);
    assert.equal(
      signalRetailerQualificationBoundary.metadata.nonTargetQualificationWriterParity,
      true
    );
    assert.equal(
      signalRetailerQualificationBoundary.metadata.sharedCatalogExecutionWriterParity,
      true
    );
    assert.equal(
      signalRetailerQualificationBoundary.metadata.qualificationSettingsWriterParity,
      true
    );
    assert.equal(signalRetailerQualificationBoundary.metadata.sourceTrustWriterParity, true);
    assert.equal(signalRetailerQualificationBoundary.metadata.sourceWriterParity, false);
    assert.equal(
      signalRetailerQualificationBoundary.metadata.retailerQualificationWriterParity,
      true
    );
    assert.equal(signalRetailerQualificationBoundary.metadata.configurationWriterParity, false);
    assert.equal(signalRetailerQualificationBoundary.metadata.reservationWriterParity, false);
    assert.equal(signalRetailerQualificationBoundary.metadata.writerLockProtocolParity, false);
    assert.equal(signalRetailerQualificationBoundary.metadata.retailerMutationAuthority, false);
    assert.equal(signalRetailerQualificationBoundary.metadata.runtimeAuthority, false);
    assert.match(
      signalRetailerQualificationBoundary.boundaryCatalogFingerprint,
      /^[a-f0-9]{64}$/
    );
    assert.deepEqual(
      await verifyPostgresSignalRetailerQualificationApplyBoundary(
        importer,
        qualifiedSignalRetailerQualificationManifest
      ),
      signalRetailerQualificationBoundary
    );
    await (async () => {
    const qualifiedSignalMissionPolicyManifest =
      buildPostgresSignalMissionPolicyApplyManifest(
        qualifiedSignalRetailerQualificationManifest,
        NATIVE_MISSION_POLICY_APPLY_ROLE_NAMESPACE
      );
    const signalMissionPolicyBoundary =
      await applyPostgresSignalMissionPolicyApplyBoundary(
        importer,
        qualifiedSignalMissionPolicyManifest,
        new Date("2026-08-25T16:54:59.999Z").getTime()
      );
    assert.equal(signalMissionPolicyBoundary.protectedTenantTableCount, 6);
    assert.equal(signalMissionPolicyBoundary.forcedRlsTableCount, 6);
    assert.equal(signalMissionPolicyBoundary.mutationTableCount, 3);
    assert.equal(signalMissionPolicyBoundary.directTableGrantCount, 0);
    assert.equal(signalMissionPolicyBoundary.functionGrantCount, 1);
    assert.equal(signalMissionPolicyBoundary.membershipCount, 0);
    assert.equal(signalMissionPolicyBoundary.activePrincipalCount, 0);
    assert.equal(signalMissionPolicyBoundary.metadata.operationCount, 1);
    assert.deepEqual(
      signalMissionPolicyBoundary.metadata.protectedSharedCatalogTableNames,
      ["listings"]
    );
    assert.equal(signalMissionPolicyBoundary.metadata.maximumMissionTargets, 10_000);
    assert.equal(signalMissionPolicyBoundary.metadata.writerLockProtocolConsumed, true);
    assert.equal(signalMissionPolicyBoundary.metadata.settingsScopeConsumed, true);
    assert.equal(signalMissionPolicyBoundary.metadata.missionPolicyScopeConsumed, true);
    assert.equal(signalMissionPolicyBoundary.metadata.zeroWriteUnchangedPolicy, true);
    assert.equal(signalMissionPolicyBoundary.metadata.appendOnlyPolicyRevision, true);
    assert.equal(signalMissionPolicyBoundary.metadata.atomicPolicyAuditOutbox, true);
    assert.equal(signalMissionPolicyBoundary.metadata.currentMissionOwnershipRevalidation, true);
    assert.equal(signalMissionPolicyBoundary.metadata.currentTargetSnapshotRevalidation, true);
    assert.equal(signalMissionPolicyBoundary.metadata.currentSettingsRevalidation, true);
    assert.equal(signalMissionPolicyBoundary.metadata.policyHashV2Parity, true);
    assert.equal(signalMissionPolicyBoundary.metadata.directPurchaseSafetyParity, true);
    assert.equal(signalMissionPolicyBoundary.metadata.sourceTrustWriterParity, true);
    assert.equal(signalMissionPolicyBoundary.metadata.sourceWriterParity, false);
    assert.equal(signalMissionPolicyBoundary.metadata.retailerQualificationWriterParity, true);
    assert.equal(signalMissionPolicyBoundary.metadata.missionPolicyWriterParity, true);
    assert.equal(signalMissionPolicyBoundary.metadata.settingsWriterParity, false);
    assert.equal(signalMissionPolicyBoundary.metadata.configurationWriterParity, false);
    assert.equal(signalMissionPolicyBoundary.metadata.reservationWriterParity, false);
    assert.equal(signalMissionPolicyBoundary.metadata.writerLockProtocolParity, false);
    assert.equal(signalMissionPolicyBoundary.metadata.sharedCatalogMutationAuthority, false);
    assert.equal(signalMissionPolicyBoundary.metadata.actionAuthority, false);
    assert.equal(signalMissionPolicyBoundary.metadata.runtimeAuthority, false);
    assert.match(signalMissionPolicyBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalMissionPolicyApplyBoundary(
        importer,
        qualifiedSignalMissionPolicyManifest
      ),
      signalMissionPolicyBoundary
    );
    const qualifiedSignalSourceStatusManifest =
      buildPostgresSignalSourceStatusApplyManifest(
        qualifiedSignalMissionPolicyManifest,
        NATIVE_SOURCE_STATUS_APPLY_ROLE_NAMESPACE
      );
    const signalSourceStatusBoundary =
      await applyPostgresSignalSourceStatusApplyBoundary(
        importer,
        qualifiedSignalSourceStatusManifest,
        new Date("2026-08-25T16:55:00.000Z").getTime()
      );
    assert.equal(signalSourceStatusBoundary.protectedTenantTableCount, 5);
    assert.equal(signalSourceStatusBoundary.forcedRlsTableCount, 5);
    assert.equal(signalSourceStatusBoundary.mutationTableCount, 4);
    assert.equal(signalSourceStatusBoundary.directTableGrantCount, 0);
    assert.equal(signalSourceStatusBoundary.functionGrantCount, 1);
    assert.equal(signalSourceStatusBoundary.membershipCount, 0);
    assert.equal(signalSourceStatusBoundary.activePrincipalCount, 0);
    assert.equal(signalSourceStatusBoundary.metadata.operationCount, 1);
    assert.equal(signalSourceStatusBoundary.metadata.writerLockProtocolConsumed, true);
    assert.equal(signalSourceStatusBoundary.metadata.sourceScopeConsumed, true);
    assert.equal(signalSourceStatusBoundary.metadata.deterministicRequestIdentity, true);
    assert.equal(signalSourceStatusBoundary.metadata.immutableMaterialReplay, true);
    assert.equal(signalSourceStatusBoundary.metadata.latestStateReplayOnly, true);
    assert.equal(signalSourceStatusBoundary.metadata.nonMaterialAuditSuppression, true);
    assert.equal(signalSourceStatusBoundary.metadata.monotonicDeviceTimestamp, true);
    assert.equal(signalSourceStatusBoundary.metadata.databaseOwnedEventTimestamps, true);
    assert.equal(signalSourceStatusBoundary.metadata.clientObservedAtPreserved, true);
    assert.equal(signalSourceStatusBoundary.metadata.atomicMaterialStatusAuditOutbox, true);
    assert.equal(signalSourceStatusBoundary.metadata.currentSourceOwnershipRevalidation, true);
    assert.equal(signalSourceStatusBoundary.metadata.currentDeviceOwnershipRevalidation, true);
    assert.equal(signalSourceStatusBoundary.metadata.activeDeviceOnly, true);
    assert.equal(signalSourceStatusBoundary.metadata.privateSourceOnly, true);
    assert.equal(signalSourceStatusBoundary.metadata.trackalackerOnly, true);
    assert.equal(signalSourceStatusBoundary.metadata.materialChangeAuditParity, true);
    assert.equal(signalSourceStatusBoundary.metadata.sourceTrustWriterParity, true);
    assert.equal(signalSourceStatusBoundary.metadata.sourceStatusWriterParity, true);
    assert.equal(signalSourceStatusBoundary.metadata.sourceSyncWriterParity, false);
    assert.equal(signalSourceStatusBoundary.metadata.sourceWriterParity, false);
    assert.equal(signalSourceStatusBoundary.metadata.retailerQualificationWriterParity, true);
    assert.equal(signalSourceStatusBoundary.metadata.missionPolicyWriterParity, true);
    assert.equal(signalSourceStatusBoundary.metadata.configurationWriterParity, false);
    assert.equal(signalSourceStatusBoundary.metadata.reservationWriterParity, false);
    assert.equal(signalSourceStatusBoundary.metadata.writerLockProtocolParity, false);
    assert.equal(signalSourceStatusBoundary.metadata.sharedCatalogMutationAuthority, false);
    assert.equal(signalSourceStatusBoundary.metadata.actionAuthority, false);
    assert.equal(signalSourceStatusBoundary.metadata.runtimeAuthority, false);
    assert.match(signalSourceStatusBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalSourceStatusApplyBoundary(
        importer,
        qualifiedSignalSourceStatusManifest
      ),
      signalSourceStatusBoundary
    );
    const qualifiedSignalSourceSyncManifest =
      buildPostgresSignalSourceSyncApplyManifest(
        qualifiedSignalSourceStatusManifest,
        NATIVE_SOURCE_SYNC_APPLY_ROLE_NAMESPACE
      );
    const signalSourceSyncBoundary =
      await applyPostgresSignalSourceSyncApplyBoundary(
        importer,
        qualifiedSignalSourceSyncManifest,
        new Date("2026-08-25T16:56:00.000Z").getTime()
      );
    assert.equal(signalSourceSyncBoundary.protectedTenantTableCount, 6);
    assert.equal(signalSourceSyncBoundary.forcedRlsTableCount, 6);
    assert.equal(signalSourceSyncBoundary.mutationTableCount, 4);
    assert.equal(signalSourceSyncBoundary.directTableGrantCount, 0);
    assert.equal(signalSourceSyncBoundary.functionGrantCount, 1);
    assert.equal(signalSourceSyncBoundary.membershipCount, 0);
    assert.equal(signalSourceSyncBoundary.activePrincipalCount, 0);
    assert.equal(signalSourceSyncBoundary.metadata.operationCount, 3);
    assert.equal(signalSourceSyncBoundary.metadata.writerLockProtocolConsumed, true);
    assert.equal(signalSourceSyncBoundary.metadata.sourceScopeConsumed, true);
    assert.equal(signalSourceSyncBoundary.metadata.deterministicRequestIdentity, true);
    assert.equal(signalSourceSyncBoundary.metadata.immutableAuditedReplay, true);
    assert.equal(signalSourceSyncBoundary.metadata.latestStateProgressReplay, true);
    assert.equal(signalSourceSyncBoundary.metadata.latestStateItemReplay, true);
    assert.equal(signalSourceSyncBoundary.metadata.monotonicProgressCounters, true);
    assert.equal(signalSourceSyncBoundary.metadata.boundedActiveRunExclusion, true);
    assert.equal(signalSourceSyncBoundary.metadata.staleRunInterruptionParity, true);
    assert.equal(signalSourceSyncBoundary.metadata.terminalAuditParity, true);
    assert.equal(signalSourceSyncBoundary.metadata.nonTerminalAuditSuppression, true);
    assert.equal(signalSourceSyncBoundary.metadata.itemReceiptUpsertParity, true);
    assert.equal(signalSourceSyncBoundary.metadata.databaseOwnedTimestamps, true);
    assert.equal(signalSourceSyncBoundary.metadata.privacyBoundedMessages, true);
    assert.equal(signalSourceSyncBoundary.metadata.atomicRunAuditOutbox, true);
    assert.equal(signalSourceSyncBoundary.metadata.currentSourceOwnershipRevalidation, true);
    assert.equal(signalSourceSyncBoundary.metadata.currentDeviceOwnershipRevalidation, true);
    assert.equal(signalSourceSyncBoundary.metadata.currentRunOwnershipRevalidation, true);
    assert.equal(signalSourceSyncBoundary.metadata.activeDeviceOnly, true);
    assert.equal(signalSourceSyncBoundary.metadata.activeRunItemOnly, true);
    assert.equal(signalSourceSyncBoundary.metadata.privateSourceOnly, true);
    assert.equal(signalSourceSyncBoundary.metadata.trackalackerOnly, true);
    assert.equal(signalSourceSyncBoundary.metadata.catalogImportExcluded, true);
    assert.equal(signalSourceSyncBoundary.metadata.sourceStatusWriterParity, true);
    assert.equal(signalSourceSyncBoundary.metadata.sourceSyncWriterParity, true);
    assert.equal(signalSourceSyncBoundary.metadata.sourceWriterParity, false);
    assert.equal(signalSourceSyncBoundary.metadata.sharedCatalogMutationAuthority, false);
    assert.equal(signalSourceSyncBoundary.metadata.actionAuthority, false);
    assert.equal(signalSourceSyncBoundary.metadata.runtimeAuthority, false);
    assert.match(signalSourceSyncBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalSourceSyncApplyBoundary(
        importer,
        qualifiedSignalSourceSyncManifest
      ),
      signalSourceSyncBoundary
    );
    const qualifiedSignalReservationLifecycleManifest =
      buildPostgresSignalReservationLifecycleApplyManifest(
        qualifiedSignalSourceSyncManifest,
        NATIVE_RESERVATION_LIFECYCLE_APPLY_ROLE_NAMESPACE
      );
    const signalReservationLifecycleBoundary =
      await applyPostgresSignalReservationLifecycleApplyBoundary(
        importer,
        qualifiedSignalReservationLifecycleManifest,
        new Date("2026-08-25T16:57:00.000Z").getTime()
      );
    assert.equal(signalReservationLifecycleBoundary.protectedTenantTableCount, 6);
    assert.equal(signalReservationLifecycleBoundary.forcedRlsTableCount, 6);
    assert.equal(signalReservationLifecycleBoundary.mutationTableCount, 4);
    assert.equal(signalReservationLifecycleBoundary.directTableGrantCount, 0);
    assert.equal(signalReservationLifecycleBoundary.functionGrantCount, 1);
    assert.equal(signalReservationLifecycleBoundary.membershipCount, 0);
    assert.equal(signalReservationLifecycleBoundary.activePrincipalCount, 0);
    assert.equal(signalReservationLifecycleBoundary.metadata.operationCount, 2);
    assert.equal(
      signalReservationLifecycleBoundary.metadata.writerLockProtocolConsumed,
      true
    );
    assert.equal(signalReservationLifecycleBoundary.metadata.spendScopeConsumed, true);
    assert.equal(
      signalReservationLifecycleBoundary.metadata.deterministicRequestIdentity,
      true
    );
    assert.equal(
      signalReservationLifecycleBoundary.metadata.immutableLifecycleReplay,
      true
    );
    assert.equal(
      signalReservationLifecycleBoundary.metadata.lifecycleAwareOutboxReplay,
      true
    );
    assert.equal(
      signalReservationLifecycleBoundary.metadata.currentActionReservationGraphRevalidation,
      true
    );
    assert.equal(
      signalReservationLifecycleBoundary.metadata.terminalReleaseStateRevalidation,
      true
    );
    assert.equal(
      signalReservationLifecycleBoundary.metadata.serverClockExpiryRelease,
      true
    );
    assert.equal(
      signalReservationLifecycleBoundary.metadata.possibleMutationExpiryReleaseBlocked,
      true
    );
    assert.equal(
      signalReservationLifecycleBoundary.metadata.verifiedSubmitOrderCommit,
      true
    );
    assert.equal(
      signalReservationLifecycleBoundary.metadata.unambiguousVerifiedTotal,
      true
    );
    assert.equal(
      signalReservationLifecycleBoundary.metadata.reservationCreationPredecessorParity,
      true
    );
    assert.equal(signalReservationLifecycleBoundary.metadata.reservationReleaseParity, true);
    assert.equal(signalReservationLifecycleBoundary.metadata.reservationCommitParity, true);
    assert.equal(signalReservationLifecycleBoundary.metadata.appendOnlyLedgerParity, true);
    assert.equal(
      signalReservationLifecycleBoundary.metadata.atomicReservationLedgerAuditOutbox,
      true
    );
    assert.equal(signalReservationLifecycleBoundary.metadata.databaseOwnedTimestamps, true);
    assert.equal(signalReservationLifecycleBoundary.metadata.missionFulfillmentMutation, false);
    assert.equal(signalReservationLifecycleBoundary.metadata.checkoutMutation, false);
    assert.equal(signalReservationLifecycleBoundary.metadata.orderSubmissionMutation, false);
    assert.equal(signalReservationLifecycleBoundary.metadata.sourceSyncWriterParity, true);
    assert.equal(signalReservationLifecycleBoundary.metadata.sourceWriterParity, false);
    assert.equal(signalReservationLifecycleBoundary.metadata.retailerQualificationWriterParity, true);
    assert.equal(signalReservationLifecycleBoundary.metadata.missionPolicyWriterParity, true);
    assert.equal(signalReservationLifecycleBoundary.metadata.configurationWriterParity, false);
    assert.equal(signalReservationLifecycleBoundary.metadata.reservationWriterParity, true);
    assert.equal(signalReservationLifecycleBoundary.metadata.writerLockProtocolParity, false);
    assert.equal(signalReservationLifecycleBoundary.metadata.actionAuthority, false);
    assert.equal(signalReservationLifecycleBoundary.metadata.checkoutAuthority, false);
    assert.equal(signalReservationLifecycleBoundary.metadata.orderSubmissionAuthority, false);
    assert.equal(signalReservationLifecycleBoundary.metadata.runtimeAuthority, false);
    assert.match(
      signalReservationLifecycleBoundary.boundaryCatalogFingerprint,
      /^[a-f0-9]{64}$/
    );
    assert.deepEqual(
      await verifyPostgresSignalReservationLifecycleApplyBoundary(
        importer,
        qualifiedSignalReservationLifecycleManifest
      ),
      signalReservationLifecycleBoundary
    );
    const qualifiedSignalCatalogImportManifest =
      buildPostgresSignalCatalogImportApplyManifest(
        qualifiedSignalReservationLifecycleManifest,
        NATIVE_CATALOG_IMPORT_APPLY_ROLE_NAMESPACE
      );
    const signalCatalogImportBoundary =
      await applyPostgresSignalCatalogImportApplyBoundary(
        importer,
        qualifiedSignalCatalogImportManifest,
        new Date("2026-08-25T16:58:00.000Z").getTime()
      );
    assert.equal(signalCatalogImportBoundary.protectedTenantTableCount, 14);
    assert.equal(signalCatalogImportBoundary.forcedRlsTableCount, 14);
    assert.equal(signalCatalogImportBoundary.mutationTableCount, 11);
    assert.equal(signalCatalogImportBoundary.directTableGrantCount, 0);
    assert.equal(signalCatalogImportBoundary.functionGrantCount, 1);
    assert.equal(signalCatalogImportBoundary.membershipCount, 0);
    assert.equal(signalCatalogImportBoundary.activePrincipalCount, 0);
    assert.equal(signalCatalogImportBoundary.metadata.operationCount, 1);
    assert.equal(signalCatalogImportBoundary.metadata.maximumListingsPerItem, 250);
    assert.equal(signalCatalogImportBoundary.metadata.writerLockProtocolConsumed, true);
    assert.equal(signalCatalogImportBoundary.metadata.sourceScopeConsumed, true);
    assert.equal(signalCatalogImportBoundary.metadata.completeSetIdentityConsensus, true);
    assert.equal(signalCatalogImportBoundary.metadata.crossTenantCatalogSerialization, true);
    assert.equal(signalCatalogImportBoundary.metadata.canonicalRetailerUrlRevalidation, true);
    assert.equal(signalCatalogImportBoundary.metadata.monotonicSourceObservation, true);
    assert.equal(signalCatalogImportBoundary.metadata.optionalSyncItemCompositionParity, true);
    assert.equal(signalCatalogImportBoundary.metadata.catalogImportWriterParity, true);
    assert.equal(signalCatalogImportBoundary.metadata.connectionProvisioningWriterParity, false);
    assert.equal(signalCatalogImportBoundary.metadata.sourceWriterParity, false);
    assert.equal(signalCatalogImportBoundary.metadata.reservationWriterParity, true);
    assert.equal(signalCatalogImportBoundary.metadata.sharedCatalogMutationAuthority, true);
    assert.equal(signalCatalogImportBoundary.metadata.actionAuthority, false);
    assert.equal(signalCatalogImportBoundary.metadata.runtimeAuthority, false);
    assert.deepEqual(signalCatalogImportBoundary.metadata.protectedSharedCatalogTableNames, [
      "listing_urls", "listings", "product_families", "retailers", "variants"
    ]);
    assert.deepEqual(signalCatalogImportBoundary.metadata.sharedCatalogMutationTableNames, [
      "listing_urls", "listings", "product_families", "variants"
    ]);
    assert.equal(signalCatalogImportBoundary.metadata.protectedSharedCatalogTableCount, 5);
    assert.equal(signalCatalogImportBoundary.metadata.sharedCatalogMutationTableCount, 4);
    assert.equal(signalCatalogImportBoundary.metadata.totalMutationTableCount, 15);
    assert.match(signalCatalogImportBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalCatalogImportApplyBoundary(
        importer,
        qualifiedSignalCatalogImportManifest
      ),
      signalCatalogImportBoundary
    );
    const qualifiedSignalSourceProvisioningManifest =
      buildPostgresSignalSourceProvisioningApplyManifest(
        qualifiedSignalCatalogImportManifest,
        NATIVE_SOURCE_PROVISIONING_APPLY_ROLE_NAMESPACE
      );
    const signalSourceProvisioningBoundary =
      await applyPostgresSignalSourceProvisioningApplyBoundary(
        importer,
        qualifiedSignalSourceProvisioningManifest,
        new Date("2026-08-25T16:59:00.000Z").getTime()
      );
    assert.equal(signalSourceProvisioningBoundary.protectedTenantTableCount, 3);
    assert.equal(signalSourceProvisioningBoundary.forcedRlsTableCount, 3);
    assert.equal(signalSourceProvisioningBoundary.mutationTableCount, 3);
    assert.equal(signalSourceProvisioningBoundary.directTableGrantCount, 0);
    assert.equal(signalSourceProvisioningBoundary.functionGrantCount, 1);
    assert.equal(signalSourceProvisioningBoundary.membershipCount, 0);
    assert.equal(signalSourceProvisioningBoundary.activePrincipalCount, 0);
    assert.equal(signalSourceProvisioningBoundary.metadata.operationCount, 1);
    assert.equal(signalSourceProvisioningBoundary.metadata.defaultSourceConnectionCount, 3);
    assert.equal(signalSourceProvisioningBoundary.metadata.trustedExactSourceCount, 2);
    assert.equal(signalSourceProvisioningBoundary.metadata.informationalSourceCount, 1);
    assert.deepEqual(
      signalSourceProvisioningBoundary.metadata.defaultSourceConnections,
      POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULT_SOURCES
    );
    assert.equal(
      signalSourceProvisioningBoundary.metadata.sharedWriterLockProtocolImplemented,
      true
    );
    assert.equal(signalSourceProvisioningBoundary.metadata.writerLockProtocolConsumed, true);
    assert.equal(signalSourceProvisioningBoundary.metadata.sourceScopeConsumed, true);
    assert.equal(
      signalSourceProvisioningBoundary.metadata.deterministicRequestIdentity,
      true
    );
    assert.equal(
      signalSourceProvisioningBoundary.metadata.deterministicConnectionIdentity,
      true
    );
    assert.equal(signalSourceProvisioningBoundary.metadata.sqliteOwnedIdParity, true);
    assert.equal(signalSourceProvisioningBoundary.metadata.immutableAuditedReplay, true);
    assert.equal(
      signalSourceProvisioningBoundary.metadata.zeroWriteWhenAlreadyProvisioned,
      true
    );
    assert.equal(
      signalSourceProvisioningBoundary.metadata.existingIdentityConflictFailClosed,
      true
    );
    assert.equal(
      signalSourceProvisioningBoundary.metadata.atomicProvisioningAuditOutbox,
      true
    );
    assert.equal(signalSourceProvisioningBoundary.metadata.databaseOwnedTimestamps, true);
    assert.equal(signalSourceProvisioningBoundary.metadata.privateSourceOnly, true);
    assert.equal(signalSourceProvisioningBoundary.metadata.disconnectedInitialStatus, true);
    // The 21st writer: closes its own aggregate flag and, transitively, the
    // "sourceWriterParity" aggregate now that all five source-domain writers
    // (trust, status, sync, catalog-import, connection-provisioning) are true.
    assert.equal(signalSourceProvisioningBoundary.metadata.sourceTrustWriterParity, true);
    assert.equal(signalSourceProvisioningBoundary.metadata.sourceStatusWriterParity, true);
    assert.equal(signalSourceProvisioningBoundary.metadata.sourceSyncWriterParity, true);
    assert.equal(signalSourceProvisioningBoundary.metadata.catalogImportWriterParity, true);
    assert.equal(
      signalSourceProvisioningBoundary.metadata.connectionProvisioningWriterParity,
      true
    );
    assert.equal(signalSourceProvisioningBoundary.metadata.sourceWriterParity, true);
    assert.equal(
      signalSourceProvisioningBoundary.metadata.retailerQualificationWriterParity,
      true
    );
    assert.equal(signalSourceProvisioningBoundary.metadata.missionPolicyWriterParity, true);
    assert.equal(signalSourceProvisioningBoundary.metadata.settingsWriterParity, false);
    assert.equal(signalSourceProvisioningBoundary.metadata.configurationWriterParity, false);
    assert.equal(signalSourceProvisioningBoundary.metadata.reservationWriterParity, true);
    // The shared five-domain lock protocol still has non-consuming writer
    // families, so the protocol-wide aggregate cannot close from this
    // boundary alone.
    assert.equal(signalSourceProvisioningBoundary.metadata.writerLockProtocolParity, false);
    assert.equal(signalSourceProvisioningBoundary.metadata.sharedCatalogMutationAuthority, false);
    assert.equal(signalSourceProvisioningBoundary.metadata.actionAuthority, false);
    assert.equal(signalSourceProvisioningBoundary.metadata.runtimeAuthority, false);
    assert.match(signalSourceProvisioningBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalSourceProvisioningApplyBoundary(
        importer,
        qualifiedSignalSourceProvisioningManifest
      ),
      signalSourceProvisioningBoundary
    );
    const qualifiedSignalAttributionPolicyManifest =
      buildPostgresSignalAttributionPolicyApplyManifest(
        qualifiedSignalSourceProvisioningManifest,
        NATIVE_ATTRIBUTION_POLICY_APPLY_ROLE_NAMESPACE
      );
    const signalAttributionPolicyBoundary =
      await applyPostgresSignalAttributionPolicyApplyBoundary(
        importer,
        qualifiedSignalAttributionPolicyManifest,
        new Date("2026-08-25T16:59:30.000Z").getTime()
      );
    assert.equal(signalAttributionPolicyBoundary.protectedTenantTableCount, 3);
    assert.equal(signalAttributionPolicyBoundary.forcedRlsTableCount, 3);
    assert.equal(signalAttributionPolicyBoundary.mutationTableCount, 3);
    assert.equal(signalAttributionPolicyBoundary.directTableGrantCount, 0);
    assert.equal(signalAttributionPolicyBoundary.functionGrantCount, 1);
    assert.equal(signalAttributionPolicyBoundary.membershipCount, 0);
    assert.equal(signalAttributionPolicyBoundary.activePrincipalCount, 0);
    assert.equal(signalAttributionPolicyBoundary.metadata.operationCount, 1);
    assert.deepEqual(
      qualifiedSignalAttributionPolicyManifest.attributionPolicyRole.protectedTenantTableNames,
      ["attribution_policies", "audit_events", "outbox_events"]
    );
    assert.deepEqual(
      qualifiedSignalAttributionPolicyManifest.attributionPolicyRole.mutationTableNames,
      qualifiedSignalAttributionPolicyManifest.attributionPolicyRole.protectedTenantTableNames
    );
    assert.deepEqual(
      signalAttributionPolicyBoundary.metadata.supportedRetailers,
      POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS
    );
    assert.equal(signalAttributionPolicyBoundary.metadata.supportedRetailerCount, 13);
    assert.deepEqual(
      signalAttributionPolicyBoundary.metadata.providerAllowlist,
      ["canonical", "howl", "amazon_associates"]
    );
    assert.equal(signalAttributionPolicyBoundary.metadata.serverBoundPrincipalLookup, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.provisionedRowExistenceRequired, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.completeRetailerSetRequired, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.fixedRetailerOrderNormalization, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.rowLevelLockSerialization, true);
    // attribution_policies is not one of the five domains the shared
    // writer-lock protocol guards, so this boundary never consumes it and
    // instead serializes concurrent replacements with its own row-level
    // `FOR UPDATE ORDER BY retailer_id` lock.
    assert.equal(signalAttributionPolicyBoundary.metadata.writerLockProtocolConsumed, false);
    assert.equal(signalAttributionPolicyBoundary.metadata.deterministicRequestIdentity, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.immutableAuditedReplay, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.zeroWriteWhenUnchanged, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.missingRowFailsClosed, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.atomicReplaceAuditOutbox, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.databaseOwnedTimestamps, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.sqliteValidationParity, true);
    // The 22nd writer: closes its own aggregate flag. World-state carried
    // forward unchanged from source-provisioning-apply (v0.95).
    assert.equal(signalAttributionPolicyBoundary.metadata.sourceTrustWriterParity, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.sourceStatusWriterParity, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.sourceSyncWriterParity, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.catalogImportWriterParity, true);
    assert.equal(
      signalAttributionPolicyBoundary.metadata.connectionProvisioningWriterParity,
      true
    );
    assert.equal(signalAttributionPolicyBoundary.metadata.sourceWriterParity, true);
    assert.equal(
      signalAttributionPolicyBoundary.metadata.retailerQualificationWriterParity,
      true
    );
    assert.equal(signalAttributionPolicyBoundary.metadata.missionPolicyWriterParity, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.settingsWriterParity, false);
    assert.equal(signalAttributionPolicyBoundary.metadata.configurationWriterParity, false);
    assert.equal(signalAttributionPolicyBoundary.metadata.reservationWriterParity, true);
    assert.equal(signalAttributionPolicyBoundary.metadata.attributionPolicyParity, true);
    // The shared five-domain lock protocol still has non-consuming writer
    // families, so the protocol-wide aggregate cannot close from this
    // boundary alone.
    assert.equal(signalAttributionPolicyBoundary.metadata.writerLockProtocolParity, false);
    assert.equal(signalAttributionPolicyBoundary.metadata.sharedCatalogMutationAuthority, false);
    assert.equal(signalAttributionPolicyBoundary.metadata.actionAuthority, false);
    assert.equal(signalAttributionPolicyBoundary.metadata.runtimeAuthority, false);
    assert.match(signalAttributionPolicyBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalAttributionPolicyApplyBoundary(
        importer,
        qualifiedSignalAttributionPolicyManifest
      ),
      signalAttributionPolicyBoundary
    );

    // attribution-receipt-apply chains onto attribution-policy-apply -- the
    // newest full-writer sibling at the time this boundary was authored --
    // not onto catalog-import-apply (a concurrently-authored sibling with
    // no ordering relationship to this module).
    const qualifiedSignalAttributionReceiptManifest =
      buildPostgresSignalAttributionReceiptApplyManifest(
        qualifiedSignalAttributionPolicyManifest,
        NATIVE_ATTRIBUTION_RECEIPT_APPLY_ROLE_NAMESPACE
      );
    const signalAttributionReceiptBoundary =
      await applyPostgresSignalAttributionReceiptApplyBoundary(
        importer,
        qualifiedSignalAttributionReceiptManifest,
        new Date("2026-08-25T16:59:31.000Z").getTime()
      );
    assert.equal(signalAttributionReceiptBoundary.protectedTenantTableCount, 5);
    assert.equal(signalAttributionReceiptBoundary.forcedRlsTableCount, 5);
    assert.equal(signalAttributionReceiptBoundary.mutationTableCount, 3);
    assert.equal(signalAttributionReceiptBoundary.directTableGrantCount, 0);
    assert.equal(signalAttributionReceiptBoundary.functionGrantCount, 1);
    assert.equal(signalAttributionReceiptBoundary.membershipCount, 0);
    assert.equal(signalAttributionReceiptBoundary.activePrincipalCount, 0);
    assert.equal(signalAttributionReceiptBoundary.metadata.operationCount, 1);
    // action_jobs and attribution_policies are read (and, for action_jobs,
    // row-locked) but never mutated -- present in the protected set, absent
    // from the mutation set. `listings` is deliberately absent from both: it
    // carries no tenant_id/user_id columns at all.
    assert.deepEqual(
      qualifiedSignalAttributionReceiptManifest.attributionReceiptRole.protectedTenantTableNames,
      ["action_jobs", "attribution_policies", "attribution_receipts", "audit_events", "outbox_events"]
    );
    assert.deepEqual(
      qualifiedSignalAttributionReceiptManifest.attributionReceiptRole.mutationTableNames,
      ["attribution_receipts", "audit_events", "outbox_events"]
    );
    assert.deepEqual(
      signalAttributionReceiptBoundary.metadata.supportedRetailers,
      POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS
    );
    assert.equal(signalAttributionReceiptBoundary.metadata.supportedRetailerCount, 13);
    assert.deepEqual(
      signalAttributionReceiptBoundary.metadata.providerAllowlist,
      ["canonical", "howl", "amazon_associates"]
    );
    assert.deepEqual(
      signalAttributionReceiptBoundary.metadata.outcomeAllowlist,
      POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_OUTCOMES
    );
    assert.equal(signalAttributionReceiptBoundary.metadata.serverBoundPrincipalLookup, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.jobOwnershipRevalidated, true);
    assert.equal(
      signalAttributionReceiptBoundary.metadata.attributionSnapshotConsistencyRevalidated,
      true
    );
    assert.equal(signalAttributionReceiptBoundary.metadata.provisionedPolicyRowRequired, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.policyIdentityRevalidated, true);
    // attribution_receipts is not one of the five domains the shared
    // writer-lock protocol guards -- same as attribution_policies. Per-job
    // serialization instead comes from `FOR UPDATE OF job` plus
    // UNIQUE(job_id) + ON CONFLICT DO NOTHING.
    assert.equal(signalAttributionReceiptBoundary.metadata.writerLockProtocolConsumed, false);
    assert.equal(signalAttributionReceiptBoundary.metadata.deterministicRequestIdentity, true);
    // The one deliberate divergence from most siblings' audited-replay-graph
    // check: an existing receipt for a job is unconditionally a zero-write
    // success, exactly like SQLite's own `INSERT OR IGNORE` -- never
    // compared against the newly-submitted payload.
    assert.equal(signalAttributionReceiptBoundary.metadata.insertOrIgnoreReplayParity, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.auditedOnFreshRecordOnly, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.immutableReceiptReplay, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.databaseOwnedTimestamps, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.databaseDerivedCanonicalUrlHash, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.metadataNeverPersisted, true);
    // The 23rd writer: closes its own aggregate flag. World-state carried
    // forward unchanged from attribution-policy-apply (v0.96).
    assert.equal(signalAttributionReceiptBoundary.metadata.sourceTrustWriterParity, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.sourceStatusWriterParity, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.sourceSyncWriterParity, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.catalogImportWriterParity, true);
    assert.equal(
      signalAttributionReceiptBoundary.metadata.connectionProvisioningWriterParity,
      true
    );
    assert.equal(signalAttributionReceiptBoundary.metadata.sourceWriterParity, true);
    assert.equal(
      signalAttributionReceiptBoundary.metadata.retailerQualificationWriterParity,
      true
    );
    assert.equal(signalAttributionReceiptBoundary.metadata.missionPolicyWriterParity, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.settingsWriterParity, false);
    assert.equal(signalAttributionReceiptBoundary.metadata.configurationWriterParity, false);
    assert.equal(signalAttributionReceiptBoundary.metadata.reservationWriterParity, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.attributionPolicyParity, true);
    // Closes `AttributionRepository.recordReceipt -> attribution_receipts`,
    // the out-of-scope write family named in
    // POSTGRES_SIGNAL_EVALUATION_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES.
    assert.equal(signalAttributionReceiptBoundary.metadata.attributionReceiptWriterParity, true);
    assert.equal(signalAttributionReceiptBoundary.metadata.writerLockProtocolParity, false);
    assert.equal(signalAttributionReceiptBoundary.metadata.sharedCatalogMutationAuthority, false);
    assert.equal(signalAttributionReceiptBoundary.metadata.actionAuthority, false);
    assert.equal(signalAttributionReceiptBoundary.metadata.runtimeAuthority, false);
    assert.match(signalAttributionReceiptBoundary.boundaryCatalogFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await verifyPostgresSignalAttributionReceiptApplyBoundary(
        importer,
        qualifiedSignalAttributionReceiptManifest
      ),
      signalAttributionReceiptBoundary
    );
    })();
    const observerWitnessRootKeyId = "1".repeat(64);
    const observerWitnessManifestHash = "2".repeat(64);
    const observerWitnessTransparencyEventHash = "3".repeat(64);
    await importer.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."observer_recipe_trust_manifests"(
         id, tenant_id, generation, root_key_id, manifest_hash,
         previous_manifest_hash, payload_json, signature,
         active_intermediate_key_id, revoked_key_ids_json, issued_at, expires_at,
         installed_by_actor_id, installed_at
       ) VALUES ('native_observer_witness_manifest', $1, 1, $2, $3, '', '{}',
                 'native-public-signature', '', '[]', $4, $5, $6, $4)`,
      [
        NATIVE_TENANT,
        observerWitnessRootKeyId,
        observerWitnessManifestHash,
        "2026-08-25T16:00:00.000Z",
        "2027-08-25T16:00:00.000Z",
        NATIVE_USER
      ]
    );
    await importer.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."observer_recipe_transparency_events"(
         id, tenant_id, sequence, event_type, manifest_generation, manifest_hash,
         signing_key_id, subject_hash, previous_event_hash, event_hash,
         actor_kind, actor_id, created_at
       ) VALUES ('native_observer_witness_transparency', $1, 1, 'manifest_installed',
                 1, $2, '', $2, '', $3, 'user', $4, $5)`,
      [
        NATIVE_TENANT,
        observerWitnessManifestHash,
        observerWitnessTransparencyEventHash,
        NATIVE_USER,
        "2026-08-25T16:00:00.000Z"
      ]
    );
    await importer.close();
    importer = null;

    const qualificationConfig = {
      connectionString,
      tlsMode: "local-insecure" as const,
      certificateAuthorityPem: ""
    };
    first = new NodePostgresCutoverDatabase(qualificationConfig, {
      maxConnections: 1,
      applicationName: "yoink_postgres_fleet_qualification",
      transactionIsolation: "read-committed"
    });
    second = new NodePostgresCutoverDatabase(qualificationConfig, {
      maxConnections: 1,
      applicationName: "yoink_postgres_fleet_qualification",
      transactionIsolation: "read-committed"
    });
    locker = postgres.getPgClient("postgres", "127.0.0.1");
    await locker.connect();
    const [firstIdentity, secondIdentity, lockerIdentity] = await Promise.all([
      first.query<{ backendPid: number; serverVersion: string; applicationName: string }>(
        `SELECT pg_backend_pid() AS "backendPid",
                current_setting('server_version_num') AS "serverVersion",
                current_setting('application_name') AS "applicationName"`
      ),
      second.query<{ backendPid: number; serverVersion: string; applicationName: string }>(
        `SELECT pg_backend_pid() AS "backendPid",
                current_setting('server_version_num') AS "serverVersion",
                current_setting('application_name') AS "applicationName"`
      ),
      locker.query<{ backendPid: number; serverVersion: string }>(
        "SELECT pg_backend_pid() AS \"backendPid\", current_setting('server_version_num') AS \"serverVersion\""
      )
    ]);
    assert.equal(new Set([
      firstIdentity.rows[0]?.backendPid,
      secondIdentity.rows[0]?.backendPid,
      lockerIdentity.rows[0]?.backendPid
    ]).size, 3);
    assert.equal(Math.floor(Number(firstIdentity.rows[0]?.serverVersion ?? 0) / 10_000), 16);
    assert.equal(secondIdentity.rows[0]?.serverVersion, firstIdentity.rows[0]?.serverVersion);
    assert.equal(lockerIdentity.rows[0]?.serverVersion, firstIdentity.rows[0]?.serverVersion);
    assert.equal(firstIdentity.rows[0]?.applicationName, "yoink_postgres_fleet_qualification");
    assert.equal(secondIdentity.rows[0]?.applicationName, "yoink_postgres_fleet_qualification");

    const tenantSessionManifest = buildPostgresTenantSessionManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE
    );
    const queueWriteManifest = buildPostgresTenantQueueWriteManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE
    );
    const workerControlManifest = buildPostgresWorkerControlManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE
    );
    const notificationRecoveryManifest = buildPostgresNotificationRecoveryManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE
    );
    const executionRecoveryManifest = buildPostgresExecutionRecoveryManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE
    );
    const operationalRetentionManifest = buildPostgresOperationalRetentionManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE
    );
    const observerCandidateManifest = buildPostgresObserverCandidateEvaluationManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE
    );
    const alertDispatchManifest = buildPostgresOperatorAlertConnectorDispatchManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE
    );
    const alertReconciliationManifest = buildPostgresOperatorAlertReconciliationManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE
    );
    const observerWitnessManifest = buildPostgresObserverWitnessRefreshManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE
    );
    const deliveryLeaseRecoveryManifest = buildPostgresHostedDeliveryLeaseRecoveryManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE
    );
    const signalCatalogApplyManifest = buildPostgresSignalCatalogApplyManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE
    );
    const signalResolutionApplyManifest = buildPostgresSignalResolutionApplyManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
      NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE
    );
    const signalSourceReferenceManifest = buildPostgresSignalSourceReferenceRefreshManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
      NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
      NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE
    );
    const signalTerminalDecisionManifest = buildPostgresSignalTerminalDecisionApplyManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
      NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
      NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
      NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE
    );
    const signalOfferIncidentManifest = buildPostgresSignalOfferIncidentApplyManifest(
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
      NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
      NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
      NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
      NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE
    );
    const signalPostIncidentDecisionManifest =
      buildPostgresSignalPostIncidentDecisionApplyManifest(
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
        NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE,
        NATIVE_POST_INCIDENT_DECISION_APPLY_ROLE_NAMESPACE
      );
    const signalMissionBindingManifest = buildPostgresSignalMissionBindingApplyManifest(
      signalPostIncidentDecisionManifest,
      NATIVE_MISSION_BINDING_APPLY_ROLE_NAMESPACE
    );
    const signalStrategyEvaluationManifest = buildPostgresSignalStrategyEvaluationApplyManifest(
      signalMissionBindingManifest,
      NATIVE_STRATEGY_EVALUATION_APPLY_ROLE_NAMESPACE
    );
    const signalWriterLockManifest = buildPostgresSignalWriterLockProtocolManifest(
      signalStrategyEvaluationManifest,
      NATIVE_WRITER_LOCK_ROLE_NAMESPACE
    );
    const signalConstraintConfigManifest = buildPostgresSignalConstraintConfigApplyManifest(
      signalWriterLockManifest,
      NATIVE_CONSTRAINT_CONFIG_APPLY_ROLE_NAMESPACE
    );
    const signalActionSpendManifest = buildPostgresSignalActionSpendApplyManifest(
      signalConstraintConfigManifest,
      NATIVE_ACTION_SPEND_APPLY_ROLE_NAMESPACE
    );
    const signalTargetQualificationManifest =
      buildPostgresSignalTargetQualificationApplyManifest(
        signalActionSpendManifest,
        NATIVE_TARGET_QUALIFICATION_APPLY_ROLE_NAMESPACE
      );
    const signalSourceTrustManifest = buildPostgresSignalSourceTrustApplyManifest(
      signalTargetQualificationManifest,
      NATIVE_SOURCE_TRUST_APPLY_ROLE_NAMESPACE
    );
    const signalRetailerQualificationManifest =
      buildPostgresSignalRetailerQualificationApplyManifest(
        signalSourceTrustManifest,
        NATIVE_RETAILER_QUALIFICATION_APPLY_ROLE_NAMESPACE
      );
    const signalMissionPolicyManifest =
      buildPostgresSignalMissionPolicyApplyManifest(
        signalRetailerQualificationManifest,
        NATIVE_MISSION_POLICY_APPLY_ROLE_NAMESPACE
      );
    const signalSourceStatusManifest =
      buildPostgresSignalSourceStatusApplyManifest(
        signalMissionPolicyManifest,
        NATIVE_SOURCE_STATUS_APPLY_ROLE_NAMESPACE
      );
    const signalSourceSyncManifest =
      buildPostgresSignalSourceSyncApplyManifest(
        signalSourceStatusManifest,
        NATIVE_SOURCE_SYNC_APPLY_ROLE_NAMESPACE
      );
    const signalReservationLifecycleManifest =
      buildPostgresSignalReservationLifecycleApplyManifest(
        signalSourceSyncManifest,
        NATIVE_RESERVATION_LIFECYCLE_APPLY_ROLE_NAMESPACE
      );
    const signalCatalogImportManifest =
      buildPostgresSignalCatalogImportApplyManifest(
        signalReservationLifecycleManifest,
        NATIVE_CATALOG_IMPORT_APPLY_ROLE_NAMESPACE
      );
    const signalSourceProvisioningManifest =
      buildPostgresSignalSourceProvisioningApplyManifest(
        signalCatalogImportManifest,
        NATIVE_SOURCE_PROVISIONING_APPLY_ROLE_NAMESPACE
      );
    const signalAttributionPolicyManifest =
      buildPostgresSignalAttributionPolicyApplyManifest(
        signalSourceProvisioningManifest,
        NATIVE_ATTRIBUTION_POLICY_APPLY_ROLE_NAMESPACE
      );
    const signalAttributionReceiptManifest =
      buildPostgresSignalAttributionReceiptApplyManifest(
        signalAttributionPolicyManifest,
        NATIVE_ATTRIBUTION_RECEIPT_APPLY_ROLE_NAMESPACE
      );
    for (const principalRole of [
      NATIVE_PRINCIPAL_A,
      NATIVE_PRINCIPAL_B,
      NATIVE_PRINCIPAL_C,
      NATIVE_PRINCIPAL_UNMAPPED
    ]) {
      await first.query(
        `CREATE ROLE "${principalRole}"
         LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
         PASSWORD '${NATIVE_PRINCIPAL_PASSWORD}'`
      );
      await first.query(
        `GRANT "${tenantSessionManifest.sessionRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${queueWriteManifest.writeRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${notificationRecoveryManifest.recoveryRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${executionRecoveryManifest.executionRecoveryRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${operationalRetentionManifest.operationalRetentionRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${observerCandidateManifest.observerCandidateRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${alertDispatchManifest.alertDispatchRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${alertReconciliationManifest.alertReconciliationRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${observerWitnessManifest.witnessRefreshRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${deliveryLeaseRecoveryManifest.leaseRecoveryRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalCatalogApplyManifest.catalogApplyRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalResolutionApplyManifest.resolutionApplyRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalSourceReferenceManifest.sourceReferenceRefreshRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalTerminalDecisionManifest.terminalDecisionApplyRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalOfferIncidentManifest.offerIncidentApplyRole.name}" TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalPostIncidentDecisionManifest.postIncidentDecisionApplyRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalMissionBindingManifest.missionBindingApplyRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalStrategyEvaluationManifest.strategyEvaluationRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalWriterLockManifest.writerLockRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalConstraintConfigManifest.constraintConfigRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalActionSpendManifest.actionSpendRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalTargetQualificationManifest.targetQualificationRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalSourceTrustManifest.sourceTrustRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalRetailerQualificationManifest.retailerQualificationRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalMissionPolicyManifest.missionPolicyRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalSourceStatusManifest.sourceStatusRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalSourceSyncManifest.sourceSyncRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalReservationLifecycleManifest.reservationLifecycleRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalCatalogImportManifest.catalogImportRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalSourceProvisioningManifest.sourceProvisioningRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalAttributionPolicyManifest.attributionPolicyRole.name}"
         TO "${principalRole}"`
      );
      await first.query(
        `GRANT "${signalAttributionReceiptManifest.attributionReceiptRole.name}"
         TO "${principalRole}"`
      );
    }
    await first.query(
      `CREATE ROLE "${NATIVE_CONTROL_PRINCIPAL}"
       LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
       PASSWORD '${NATIVE_PRINCIPAL_PASSWORD}'`
    );
    await first.query(
      `GRANT "${workerControlManifest.controlRole.name}" TO "${NATIVE_CONTROL_PRINCIPAL}"`
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4), ($5, $6, $7, TRUE, $4)`,
      [
        NATIVE_PRINCIPAL_A,
        NATIVE_TENANT,
        NATIVE_USER,
        "2026-08-25T16:55:00.000Z",
        NATIVE_PRINCIPAL_B,
        "tenant_local",
        "user_local"
      ]
    );
    const principalConnection = (principalRole: string): string =>
      `postgresql://${principalRole}:${NATIVE_PRINCIPAL_PASSWORD}@127.0.0.1:${port}/postgres`;
    tenantReaderA = new NodePostgresTenantReadDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE, { maxConnections: 1 });
    tenantReaderB = new NodePostgresTenantReadDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_B),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE, { maxConnections: 1 });
    tenantReaderUnmapped = new NodePostgresTenantReadDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_UNMAPPED),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE, { maxConnections: 1 });
    queueWriterA = new NodePostgresTenantQueueWriteDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, { maxConnections: 1 });
    queueWriterASecond = new NodePostgresTenantQueueWriteDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, { maxConnections: 1 });
    queueWriterB = new NodePostgresTenantQueueWriteDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_B),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, { maxConnections: 1 });
    queueWriterUnmapped = new NodePostgresTenantQueueWriteDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_UNMAPPED),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, { maxConnections: 1 });
    workerControl = new NodePostgresWorkerControlDatabase({
      connectionString: principalConnection(NATIVE_CONTROL_PRINCIPAL),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    { maxConnections: 1 });
    notificationRecoveryA = new NodePostgresNotificationRecoveryDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, { maxConnections: 2 });
    notificationRecoveryB = new NodePostgresNotificationRecoveryDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_B),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, { maxConnections: 1 });
    notificationRecoveryUnmapped = new NodePostgresNotificationRecoveryDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_UNMAPPED),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, { maxConnections: 1 });
    executionRecoveryA = new NodePostgresExecutionRecoveryDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    { maxConnections: 2 });
    executionRecoveryB = new NodePostgresExecutionRecoveryDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_B),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    { maxConnections: 1 });
    executionRecoveryUnmapped = new NodePostgresExecutionRecoveryDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_UNMAPPED),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    { maxConnections: 1 });
    operationalRetentionA = new NodePostgresOperationalRetentionDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, { maxConnections: 2 });
    operationalRetentionB = new NodePostgresOperationalRetentionDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_B),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, { maxConnections: 1 });
    operationalRetentionUnmapped = new NodePostgresOperationalRetentionDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_UNMAPPED),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, { maxConnections: 1 });
    observerCandidateA = new NodePostgresObserverCandidateEvaluationDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    { maxConnections: 2 });
    observerCandidateB = new NodePostgresObserverCandidateEvaluationDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_B),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    { maxConnections: 1 });
    observerCandidateUnmapped = new NodePostgresObserverCandidateEvaluationDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_UNMAPPED),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    { maxConnections: 1 });
    const alertDispatchDatabase = (
      principalRole: string,
      userId: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresOperatorAlertConnectorDispatchDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, { tenantId: NATIVE_TENANT, userId }, "0.69.0", NATIVE_SCHEMA,
    NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE, { maxConnections });
    alertDispatchA = alertDispatchDatabase(NATIVE_PRINCIPAL_A, NATIVE_USER, 2);
    alertDispatchASecond = alertDispatchDatabase(NATIVE_PRINCIPAL_A, NATIVE_USER);
    alertDispatchB = new NodePostgresOperatorAlertConnectorDispatchDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_B),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, { tenantId: "tenant_local", userId: "user_local" }, "0.69.0", NATIVE_SCHEMA,
    NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE, { maxConnections: 1 });
    alertDispatchC = alertDispatchDatabase(NATIVE_PRINCIPAL_C, NATIVE_SAME_TENANT_USER);
    alertDispatchUnmapped = alertDispatchDatabase(
      NATIVE_PRINCIPAL_UNMAPPED,
      NATIVE_USER
    );
    const alertReconciliationDatabase = (
      principalRole: string,
      userId: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresOperatorAlertReconciliationDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, { tenantId: NATIVE_TENANT, userId }, "0.70.0", NATIVE_SCHEMA,
    NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE, NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
    { maxConnections });
    alertReconciliationA = alertReconciliationDatabase(NATIVE_PRINCIPAL_A, NATIVE_USER, 2);
    alertReconciliationASecond = alertReconciliationDatabase(NATIVE_PRINCIPAL_A, NATIVE_USER);
    alertReconciliationB = new NodePostgresOperatorAlertReconciliationDatabase({
      connectionString: principalConnection(NATIVE_PRINCIPAL_B),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, { tenantId: "tenant_local", userId: "user_local" }, "0.70.0", NATIVE_SCHEMA,
    NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE, NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
    { maxConnections: 1 });
    alertReconciliationC = alertReconciliationDatabase(
      NATIVE_PRINCIPAL_C,
      NATIVE_SAME_TENANT_USER
    );
    alertReconciliationUnmapped = alertReconciliationDatabase(
      NATIVE_PRINCIPAL_UNMAPPED,
      NATIVE_USER
    );
    const observerWitnessSigner = ObserverRecipeSigner.ephemeral();
    const observerWitnessVerifier = new ObserverRecipeWitnessVerifier(
      "yoink-native-witness",
      {
        algorithm: "Ed25519",
        keyId: observerWitnessSigner.keyId,
        publicKeySpki: observerWitnessSigner.publicKeySpki
      },
      120
    );
    const observerWitnessPublicTrust = {
      rootKeyId: observerWitnessRootKeyId,
      manifestGeneration: 1,
      manifestHash: observerWitnessManifestHash
    };
    let observerWitnessPublishCalls = 0;
    let observerWitnessFailure: "unavailable" | null = null;
    const observerWitnessSequenceByHash = new Map<string, number>([["", 0]]);
    const observerWitnessPublisher: ObserverRecipeWitnessPublisher = {
      verifier: observerWitnessVerifier,
      endpointOrigin: "https://witness.example.net",
      async publish(checkpoint, previousReceiptHash, now = Date.now()) {
        observerWitnessPublishCalls += 1;
        if (observerWitnessFailure) {
          throw new ObserverRecipeWitnessError(
            observerWitnessFailure,
            "The native witness publisher is intentionally unavailable."
          );
        }
        const previousSequence = observerWitnessSequenceByHash.get(previousReceiptHash);
        if (previousSequence === undefined) {
          throw new ObserverRecipeWitnessError(
            "chain_conflict",
            "The native witness publisher received an unknown chain head."
          );
        }
        const receipt = createObserverRecipeWitnessReceipt(observerWitnessSigner, {
          checkpoint,
          witnessSequence: previousSequence + 1,
          previousReceiptHash,
          witnessedAt: new Date(now).toISOString(),
          validUntil: new Date(now + 60 * 60_000).toISOString()
        });
        observerWitnessSequenceByHash.set(
          observerRecipeWitnessReceiptHash(receipt),
          receipt.payload.witnessSequence
        );
        return receipt;
      }
    };
    const observerWitnessDatabase = (
      principalRole: string,
      tenantId: string,
      userId: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresObserverWitnessState({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, { tenantId, userId }, "0.71.0", NATIVE_SCHEMA,
    NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE, NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
    NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE, {
      publicTrust: observerWitnessPublicTrust,
      verifier: observerWitnessVerifier,
      endpointOrigin: observerWitnessPublisher.endpointOrigin,
      witnessRequired: true,
      maxConnections
    });
    observerWitnessA = observerWitnessDatabase(
      NATIVE_PRINCIPAL_A,
      NATIVE_TENANT,
      NATIVE_USER,
      2
    );
    observerWitnessASecond = observerWitnessDatabase(
      NATIVE_PRINCIPAL_A,
      NATIVE_TENANT,
      NATIVE_USER
    );
    observerWitnessB = observerWitnessDatabase(
      NATIVE_PRINCIPAL_B,
      "tenant_local",
      "user_local"
    );
    observerWitnessUnmapped = observerWitnessDatabase(
      NATIVE_PRINCIPAL_UNMAPPED,
      NATIVE_TENANT,
      NATIVE_USER
    );
    const deliveryLeaseRecoveryDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresHostedDeliveryLeaseRecoveryDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE, NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
    NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE, NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
    { maxConnections });
    deliveryLeaseRecoveryA = deliveryLeaseRecoveryDatabase(NATIVE_PRINCIPAL_A, 2);
    deliveryLeaseRecoveryASecond = deliveryLeaseRecoveryDatabase(NATIVE_PRINCIPAL_A);
    deliveryLeaseRecoveryB = deliveryLeaseRecoveryDatabase(NATIVE_PRINCIPAL_B);
    deliveryLeaseRecoveryC = deliveryLeaseRecoveryDatabase(NATIVE_PRINCIPAL_C);
    deliveryLeaseRecoveryUnmapped = deliveryLeaseRecoveryDatabase(NATIVE_PRINCIPAL_UNMAPPED);
    const signalCatalogApplyDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalCatalogApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE, NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
    NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE, NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
    NATIVE_CATALOG_APPLY_ROLE_NAMESPACE, { maxConnections });
    signalCatalogApplyA = signalCatalogApplyDatabase(NATIVE_PRINCIPAL_A, 2);
    signalCatalogApplyASecond = signalCatalogApplyDatabase(NATIVE_PRINCIPAL_A);
    signalCatalogApplyB = signalCatalogApplyDatabase(NATIVE_PRINCIPAL_B);
    signalCatalogApplyC = signalCatalogApplyDatabase(NATIVE_PRINCIPAL_C);
    signalCatalogApplyUnmapped = signalCatalogApplyDatabase(NATIVE_PRINCIPAL_UNMAPPED);
    const signalResolutionApplyDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalResolutionApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE, NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
    NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE, NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
    NATIVE_CATALOG_APPLY_ROLE_NAMESPACE, NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
    { maxConnections });
    signalResolutionApplyA = signalResolutionApplyDatabase(NATIVE_PRINCIPAL_A, 2);
    signalResolutionApplyASecond = signalResolutionApplyDatabase(NATIVE_PRINCIPAL_A);
    signalResolutionApplyB = signalResolutionApplyDatabase(NATIVE_PRINCIPAL_B);
    signalResolutionApplyC = signalResolutionApplyDatabase(NATIVE_PRINCIPAL_C);
    signalResolutionApplyUnmapped = signalResolutionApplyDatabase(NATIVE_PRINCIPAL_UNMAPPED);
    const signalSourceReferenceDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalSourceReferenceRefreshDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE, NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
    NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE, NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
    NATIVE_CATALOG_APPLY_ROLE_NAMESPACE, NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
    NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE, { maxConnections });
    signalSourceReferenceA = signalSourceReferenceDatabase(NATIVE_PRINCIPAL_A, 2);
    signalSourceReferenceASecond = signalSourceReferenceDatabase(NATIVE_PRINCIPAL_A);
    signalSourceReferenceB = signalSourceReferenceDatabase(NATIVE_PRINCIPAL_B);
    signalSourceReferenceC = signalSourceReferenceDatabase(NATIVE_PRINCIPAL_C);
    signalSourceReferenceUnmapped = signalSourceReferenceDatabase(NATIVE_PRINCIPAL_UNMAPPED);
    const signalTerminalDecisionDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalTerminalDecisionApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE, NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
    NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE, NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
    NATIVE_CATALOG_APPLY_ROLE_NAMESPACE, NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
    NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
    NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE, { maxConnections });
    signalTerminalDecisionA = signalTerminalDecisionDatabase(NATIVE_PRINCIPAL_A, 2);
    signalTerminalDecisionASecond = signalTerminalDecisionDatabase(NATIVE_PRINCIPAL_A);
    signalTerminalDecisionB = signalTerminalDecisionDatabase(NATIVE_PRINCIPAL_B);
    signalTerminalDecisionC = signalTerminalDecisionDatabase(NATIVE_PRINCIPAL_C);
    signalTerminalDecisionUnmapped = signalTerminalDecisionDatabase(NATIVE_PRINCIPAL_UNMAPPED);
    const signalOfferIncidentDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalOfferIncidentApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE, NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
    NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE, NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
    NATIVE_CATALOG_APPLY_ROLE_NAMESPACE, NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
    NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
    NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
    NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE, { maxConnections });
    signalOfferIncidentA = signalOfferIncidentDatabase(NATIVE_PRINCIPAL_A, 2);
    signalOfferIncidentASecond = signalOfferIncidentDatabase(NATIVE_PRINCIPAL_A);
    signalOfferIncidentB = signalOfferIncidentDatabase(NATIVE_PRINCIPAL_B);
    signalOfferIncidentC = signalOfferIncidentDatabase(NATIVE_PRINCIPAL_C);
    signalOfferIncidentUnmapped = signalOfferIncidentDatabase(NATIVE_PRINCIPAL_UNMAPPED);
    const signalPostIncidentDecisionDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalPostIncidentDecisionApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, NATIVE_SCHEMA, NATIVE_ROLE_NAMESPACE, NATIVE_SESSION_ROLE_NAMESPACE,
    NATIVE_QUEUE_WRITE_ROLE_NAMESPACE, NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
    NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE, NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
    NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE, NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
    NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE, NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
    NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE, NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
    NATIVE_CATALOG_APPLY_ROLE_NAMESPACE, NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
    NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
    NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
    NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE,
    NATIVE_POST_INCIDENT_DECISION_APPLY_ROLE_NAMESPACE, { maxConnections });
    signalPostIncidentDecisionA = signalPostIncidentDecisionDatabase(NATIVE_PRINCIPAL_A, 2);
    signalPostIncidentDecisionASecond = signalPostIncidentDecisionDatabase(NATIVE_PRINCIPAL_A);
    signalPostIncidentDecisionB = signalPostIncidentDecisionDatabase(NATIVE_PRINCIPAL_B);
    signalPostIncidentDecisionC = signalPostIncidentDecisionDatabase(NATIVE_PRINCIPAL_C);
    signalPostIncidentDecisionUnmapped =
      signalPostIncidentDecisionDatabase(NATIVE_PRINCIPAL_UNMAPPED);
    const signalMissionBindingDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalMissionBindingApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalMissionBindingManifest, { maxConnections });
    signalMissionBindingA = signalMissionBindingDatabase(NATIVE_PRINCIPAL_A, 2);
    signalMissionBindingASecond = signalMissionBindingDatabase(NATIVE_PRINCIPAL_A);
    signalMissionBindingB = signalMissionBindingDatabase(NATIVE_PRINCIPAL_B);
    signalMissionBindingC = signalMissionBindingDatabase(NATIVE_PRINCIPAL_C);
    signalMissionBindingUnmapped = signalMissionBindingDatabase(NATIVE_PRINCIPAL_UNMAPPED);
    const signalStrategyEvaluationDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalStrategyEvaluationApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalStrategyEvaluationManifest, { maxConnections });
    signalStrategyEvaluationA = signalStrategyEvaluationDatabase(NATIVE_PRINCIPAL_A, 2);
    signalStrategyEvaluationASecond = signalStrategyEvaluationDatabase(NATIVE_PRINCIPAL_A);
    signalStrategyEvaluationB = signalStrategyEvaluationDatabase(NATIVE_PRINCIPAL_B);
    signalStrategyEvaluationC = signalStrategyEvaluationDatabase(NATIVE_PRINCIPAL_C);
    signalStrategyEvaluationUnmapped = signalStrategyEvaluationDatabase(NATIVE_PRINCIPAL_UNMAPPED);
    const signalConstraintConfigDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalConstraintConfigApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalConstraintConfigManifest, { maxConnections });
    signalConstraintConfigA = signalConstraintConfigDatabase(NATIVE_PRINCIPAL_A, 2);
    signalConstraintConfigASecond = signalConstraintConfigDatabase(NATIVE_PRINCIPAL_A);
    signalConstraintConfigB = signalConstraintConfigDatabase(NATIVE_PRINCIPAL_B);
    signalConstraintConfigC = signalConstraintConfigDatabase(NATIVE_PRINCIPAL_C);
    signalConstraintConfigUnmapped = signalConstraintConfigDatabase(NATIVE_PRINCIPAL_UNMAPPED);
    const signalActionSpendDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalActionSpendApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalActionSpendManifest, { maxConnections });
    signalActionSpendA = signalActionSpendDatabase(NATIVE_PRINCIPAL_A, 2);
    signalActionSpendASecond = signalActionSpendDatabase(NATIVE_PRINCIPAL_A);
    signalActionSpendB = signalActionSpendDatabase(NATIVE_PRINCIPAL_B);
    signalActionSpendC = signalActionSpendDatabase(NATIVE_PRINCIPAL_C);
    signalActionSpendUnmapped = signalActionSpendDatabase(NATIVE_PRINCIPAL_UNMAPPED);
    const signalTargetQualificationDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalTargetQualificationApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalTargetQualificationManifest, { maxConnections });
    signalTargetQualificationA = signalTargetQualificationDatabase(NATIVE_PRINCIPAL_A, 2);
    signalTargetQualificationASecond = signalTargetQualificationDatabase(NATIVE_PRINCIPAL_A);
    signalTargetQualificationB = signalTargetQualificationDatabase(NATIVE_PRINCIPAL_B);
    signalTargetQualificationC = signalTargetQualificationDatabase(NATIVE_PRINCIPAL_C);
    signalTargetQualificationUnmapped = signalTargetQualificationDatabase(NATIVE_PRINCIPAL_UNMAPPED);

    directClient = new Client({ connectionString: principalConnection(NATIVE_PRINCIPAL_A) });
    directClient.on("error", () => undefined);
    await directClient.connect();
    await directClient.query(`SET ROLE "${tenantSessionManifest.sessionRole.name}"`);
    await directClient.query(`SET ${"yoink.tenant_id"} = 'tenant_local'`);
    assert.deepEqual(
      (await directClient.query<{ id: string }>(
        `SELECT id FROM "${NATIVE_SCHEMA}"."users" ORDER BY id`
      )).rows,
      []
    );
    await directClient.query(`SET ${"yoink.tenant_id"} = '${NATIVE_TENANT}'`);
    assert.deepEqual(
      (await directClient.query<{ id: string }>(
        `SELECT id FROM "${NATIVE_SCHEMA}"."users" ORDER BY id`
      )).rows.map((row) => row.id),
      [NATIVE_USER]
    );
    await directClient.end();
    directClient = null;

    const [principalAView, principalBView] = await Promise.all([
      tenantReaderA.readTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => {
          const users = await session.query<{ id: string }>(
            `SELECT id FROM "${NATIVE_SCHEMA}"."users" ORDER BY id`
          );
          const offers = await session.query<{ id: string }>(
            `SELECT id FROM "${NATIVE_SCHEMA}"."offer_observations" ORDER BY id`
          );
          return { users: users.rows.map((row) => row.id), offers: offers.rows.map((row) => row.id) };
        }
      ),
      tenantReaderB.readTransaction(
        { tenantId: "tenant_local", userId: "user_local" },
        async (session) => {
          const users = await session.query<{ id: string }>(
            `SELECT id FROM "${NATIVE_SCHEMA}"."users" ORDER BY id`
          );
          const offers = await session.query<{ id: string }>(
            `SELECT id FROM "${NATIVE_SCHEMA}"."offer_observations" ORDER BY id`
          );
          return { users: users.rows.map((row) => row.id), offers: offers.rows.map((row) => row.id) };
        }
      )
    ]);
    assert.deepEqual(principalAView, {
      users: [NATIVE_USER],
      offers: ["offer_cutover_other"]
    });
    assert.deepEqual(principalBView, {
      users: ["user_local"],
      offers: []
    });
    await assert.rejects(
      tenantReaderA.readTransaction(
        { tenantId: "tenant_local", userId: "user_local" },
        async () => undefined
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      tenantReaderUnmapped.readTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async () => undefined
      ),
      /tenant session principal is not active/
    );
    assert.deepEqual(
      await tenantReaderA.readTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => {
          await session.query(`SET LOCAL ${"yoink.tenant_id"} = 'tenant_local'`);
          return (await session.query<{ id: string }>(
            `SELECT id FROM "${NATIVE_SCHEMA}"."users" ORDER BY id`
          )).rows;
        }
      ),
      []
    );
    await assert.rejects(
      tenantReaderA.readTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        (session) => session.query(
          `INSERT INTO "${NATIVE_SCHEMA}"."app_settings"(user_id, updated_at) VALUES ($1, $2)`,
          [NATIVE_USER, "2026-08-25T16:56:00.000Z"]
        )
      ),
      /read-only|permission denied/i
    );
    assert.deepEqual(
      await tenantReaderA.readTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => (await session.query<{ tenantId: string; userId: string }>(
          `SELECT current_setting('yoink.tenant_id') AS "tenantId",
                  current_setting('yoink.user_id') AS "userId"`
        )).rows[0]
      ),
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER }
    );

    const deliveryLeaseNow = Date.now();
    const deliveryLeaseExpiredAt = new Date(deliveryLeaseNow - 60_000).toISOString();
    const deliveryLeaseCurrentAt = new Date(deliveryLeaseNow + 60_000).toISOString();
    const deliveryLeaseCreatedAt = new Date(deliveryLeaseNow - 120_000).toISOString();
    const insertDeliveryLeaseInbox = async (
      id: string,
      tenantId: string,
      userId: string,
      attempt: number,
      leaseExpiresAt: string
    ) => first!.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."inbox_messages"(
         id, tenant_id, user_id, source, message_key, event_type,
         payload_hash, payload_json, state, delivery_attempts,
         lease_capability_hash, lease_expires_at, received_at, updated_at
       ) VALUES ($1, $2, $3, 'trackalacker', $1, 'native_delivery_recovery_v1',
                 $4, '{}', 'processing', $5, $6, $7, $8, $8)`,
      [id, tenantId, userId, "f".repeat(64), attempt, `lease:${id}`, leaseExpiresAt, deliveryLeaseCreatedAt]
    );
    const insertDeliveryLeaseOutbox = async (
      id: string,
      tenantId: string,
      attempt: number,
      leaseExpiresAt: string
    ) => first!.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."outbox_events"(
         id, tenant_id, aggregate_type, aggregate_id, event_type,
         payload_json, created_at, delivered_at, delivery_attempts,
         delivery_state, lease_capability_hash, lease_expires_at, updated_at
       ) VALUES ($1, $2, 'native_delivery', $1, 'native_delivery_event',
                 '{}', $3, '', $4, 'pending', $5, $6, $3)`,
      [id, tenantId, deliveryLeaseCreatedAt, attempt, `lease:${id}`, leaseExpiresAt]
    );
    await insertDeliveryLeaseInbox(
      "native_delivery_lease_a_inbox_retry",
      NATIVE_TENANT,
      NATIVE_USER,
      4,
      deliveryLeaseExpiredAt
    );
    await insertDeliveryLeaseInbox(
      "native_delivery_lease_a_inbox_dead",
      NATIVE_TENANT,
      NATIVE_USER,
      20,
      deliveryLeaseExpiredAt
    );
    await insertDeliveryLeaseInbox(
      "native_delivery_lease_a_inbox_current",
      NATIVE_TENANT,
      NATIVE_USER,
      2,
      deliveryLeaseCurrentAt
    );
    await insertDeliveryLeaseInbox(
      "native_delivery_lease_b_inbox_retry",
      "tenant_local",
      "user_local",
      3,
      deliveryLeaseExpiredAt
    );
    await insertDeliveryLeaseOutbox(
      "native_delivery_lease_a_outbox_retry",
      NATIVE_TENANT,
      5,
      deliveryLeaseExpiredAt
    );
    await insertDeliveryLeaseOutbox(
      "native_delivery_lease_a_outbox_dead",
      NATIVE_TENANT,
      20,
      deliveryLeaseExpiredAt
    );
    await insertDeliveryLeaseOutbox(
      "native_delivery_lease_a_outbox_current",
      NATIVE_TENANT,
      2,
      deliveryLeaseCurrentAt
    );
    await insertDeliveryLeaseOutbox(
      "native_delivery_lease_b_outbox_retry",
      "tenant_local",
      3,
      deliveryLeaseExpiredAt
    );

    assert.deepEqual(
      await deliveryLeaseRecoveryA.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        deliveryLeaseNow
      ),
      {
        inboxRequeued: 1,
        inboxDeadLettered: 1,
        outboxRequeued: 1,
        outboxDeadLettered: 1
      }
    );
    assert.deepEqual(
      (await first.query<{
        id: string;
        state: string;
        capabilityHash: string;
        leaseExpiresAt: string;
        nextAttemptAt: string;
        errorCode: string;
      }>(
        `SELECT id, state, lease_capability_hash AS "capabilityHash",
                lease_expires_at AS "leaseExpiresAt", next_attempt_at AS "nextAttemptAt",
                last_error_code AS "errorCode"
         FROM "${NATIVE_SCHEMA}"."inbox_messages"
         WHERE id LIKE 'native_delivery_lease_a_inbox_%' ORDER BY id`
      )).rows,
      [
        {
          id: "native_delivery_lease_a_inbox_current",
          state: "processing",
          capabilityHash: "lease:native_delivery_lease_a_inbox_current",
          leaseExpiresAt: deliveryLeaseCurrentAt,
          nextAttemptAt: "",
          errorCode: ""
        },
        {
          id: "native_delivery_lease_a_inbox_dead",
          state: "dead_letter",
          capabilityHash: "",
          leaseExpiresAt: "",
          nextAttemptAt: "",
          errorCode: "lease_expired"
        },
        {
          id: "native_delivery_lease_a_inbox_retry",
          state: "failed",
          capabilityHash: "",
          leaseExpiresAt: "",
          nextAttemptAt: (await first.query<{ value: string }>(
            `SELECT updated_at AS value FROM "${NATIVE_SCHEMA}"."inbox_messages"
             WHERE id = 'native_delivery_lease_a_inbox_retry'`
          )).rows[0]!.value,
          errorCode: "lease_expired"
        }
      ]
    );
    assert.deepEqual(
      (await first.query<{
        id: string;
        state: string;
        capabilityHash: string;
        leaseExpiresAt: string;
        nextAttemptAt: string;
        errorCode: string;
      }>(
        `SELECT id, delivery_state AS state, lease_capability_hash AS "capabilityHash",
                lease_expires_at AS "leaseExpiresAt", next_attempt_at AS "nextAttemptAt",
                last_error_code AS "errorCode"
         FROM "${NATIVE_SCHEMA}"."outbox_events"
         WHERE id LIKE 'native_delivery_lease_a_outbox_%' ORDER BY id`
      )).rows,
      [
        {
          id: "native_delivery_lease_a_outbox_current",
          state: "pending",
          capabilityHash: "lease:native_delivery_lease_a_outbox_current",
          leaseExpiresAt: deliveryLeaseCurrentAt,
          nextAttemptAt: "",
          errorCode: ""
        },
        {
          id: "native_delivery_lease_a_outbox_dead",
          state: "dead_letter",
          capabilityHash: "",
          leaseExpiresAt: "",
          nextAttemptAt: "",
          errorCode: "lease_expired"
        },
        {
          id: "native_delivery_lease_a_outbox_retry",
          state: "pending",
          capabilityHash: "",
          leaseExpiresAt: "",
          nextAttemptAt: (await first.query<{ value: string }>(
            `SELECT updated_at AS value FROM "${NATIVE_SCHEMA}"."outbox_events"
             WHERE id = 'native_delivery_lease_a_outbox_retry'`
          )).rows[0]!.value,
          errorCode: "lease_expired"
        }
      ]
    );
    assert.equal(
      Number((await first.query<{ count: string | number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."inbox_messages"
         WHERE id = 'native_delivery_lease_b_inbox_retry' AND state = 'processing'`
      )).rows[0]?.count),
      1
    );
    assert.equal(
      Number((await first.query<{ count: string | number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."outbox_events"
         WHERE id = 'native_delivery_lease_b_outbox_retry'
           AND delivery_state = 'pending' AND lease_capability_hash <> ''`
      )).rows[0]?.count),
      1
    );
    const deliveryLeaseReceipts = (await first.query<{
      id: string;
      tenantId: string;
      userId: string;
      direction: string;
      messageId: string;
      disposition: string;
      attempt: number;
      reasonCode: string;
      receiptHash: string;
      createdAt: string;
    }>(
      `SELECT id, tenant_id AS "tenantId", user_id AS "userId", direction,
              message_id AS "messageId", disposition, attempt,
              reason_code AS "reasonCode", receipt_hash AS "receiptHash",
              created_at AS "createdAt"
       FROM "${NATIVE_SCHEMA}"."hosted_delivery_receipts"
       WHERE message_id LIKE 'native_delivery_lease_a_%'
       ORDER BY direction, message_id`
    )).rows;
    assert.equal(deliveryLeaseReceipts.length, 4);
    for (const receipt of deliveryLeaseReceipts) {
      assert.match(receipt.id, /^delivery_receipt_[a-f0-9]{32}$/);
      assert.equal(receipt.tenantId, NATIVE_TENANT);
      assert.equal(receipt.userId, NATIVE_USER);
      assert.equal(receipt.reasonCode, "lease_expired");
      assert.equal(
        receipt.receiptHash,
        stableHash(
          "hosted_delivery_receipt_v1",
          receipt.tenantId,
          receipt.userId,
          receipt.direction,
          receipt.messageId,
          receipt.disposition,
          Number(receipt.attempt),
          receipt.reasonCode,
          receipt.createdAt
        )
      );
    }
    assert.deepEqual(
      await deliveryLeaseRecoveryA.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        deliveryLeaseNow
      ),
      {
        inboxRequeued: 0,
        inboxDeadLettered: 0,
        outboxRequeued: 0,
        outboxDeadLettered: 0
      }
    );
    await insertDeliveryLeaseInbox(
      "native_delivery_lease_a_inbox_contention",
      NATIVE_TENANT,
      NATIVE_USER,
      1,
      deliveryLeaseExpiredAt
    );
    await insertDeliveryLeaseOutbox(
      "native_delivery_lease_a_outbox_contention",
      NATIVE_TENANT,
      1,
      deliveryLeaseExpiredAt
    );
    const contendedDeliveryRecovery = await Promise.all([
      deliveryLeaseRecoveryA.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        deliveryLeaseNow
      ),
      deliveryLeaseRecoveryASecond.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        deliveryLeaseNow
      )
    ]);
    assert.deepEqual(
      contendedDeliveryRecovery.reduce((total, result) => ({
        inboxRequeued: total.inboxRequeued + result.inboxRequeued,
        inboxDeadLettered: total.inboxDeadLettered + result.inboxDeadLettered,
        outboxRequeued: total.outboxRequeued + result.outboxRequeued,
        outboxDeadLettered: total.outboxDeadLettered + result.outboxDeadLettered
      }), {
        inboxRequeued: 0,
        inboxDeadLettered: 0,
        outboxRequeued: 0,
        outboxDeadLettered: 0
      }),
      {
        inboxRequeued: 1,
        inboxDeadLettered: 0,
        outboxRequeued: 1,
        outboxDeadLettered: 0
      }
    );
    assert.equal(
      Number((await first.query<{ count: string | number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."hosted_delivery_receipts"
         WHERE message_id IN (
           'native_delivery_lease_a_inbox_contention',
           'native_delivery_lease_a_outbox_contention'
         )`
      )).rows[0]?.count),
      2
    );
    assert.deepEqual(
      await deliveryLeaseRecoveryB.recover(
        { tenantId: "tenant_local", userId: "user_local" },
        deliveryLeaseNow
      ),
      {
        inboxRequeued: 1,
        inboxDeadLettered: 0,
        outboxRequeued: 1,
        outboxDeadLettered: 0
      }
    );
    await assert.rejects(
      deliveryLeaseRecoveryA.recover(
        { tenantId: "tenant_local", userId: "user_local" },
        deliveryLeaseNow
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      deliveryLeaseRecoveryUnmapped.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        deliveryLeaseNow
      ),
      /tenant session principal is not active/
    );

    const signalLifecycleNow = Date.now();
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."users"(id, tenant_id, display_name, created_at)
       VALUES ($1, $2, 'Native same-tenant peer', $3)`,
      [
        NATIVE_SAME_TENANT_USER,
        NATIVE_TENANT,
        new Date(signalLifecycleNow - 10_000).toISOString()
      ]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [
        NATIVE_PRINCIPAL_C,
        NATIVE_TENANT,
        NATIVE_SAME_TENANT_USER,
        new Date(signalLifecycleNow - 5_000).toISOString()
      ]
    );
    const signalFixtureTimestamp = new Date(signalLifecycleNow - 6_000).toISOString();
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."source_connections"(
         id, tenant_id, user_id, source, name, status, trust_level,
         auto_create_missions, is_private, last_event_at, created_at, updated_at
       ) VALUES
         ('native_signal_source_a', $1, $2, 'trackalacker', 'Native signal source A',
          'connected', 'trusted_exact', 1, 1, '', $4, $4),
         ('native_signal_source_a_manual', $1, $2, 'trackalacker',
          'Native signal source A manual', 'connected', 'trusted_exact', 0, 1, '', $4, $4),
         ('native_signal_source_c', $1, $3, 'trackalacker', 'Native signal source C',
          'connected', 'informational', 0, 1, '', $4, $4)`,
      [NATIVE_TENANT, NATIVE_USER, NATIVE_SAME_TENANT_USER, signalFixtureTimestamp]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."listings"(
         id, variant_id, retailer_id, retailer_sku, canonical_url, status,
         execution_supported, msrp_cents, currency, created_at, updated_at
       ) VALUES (
         'listing_native_signal', 'variant_cutover_scope', 'target',
         'NATIVE-SIGNAL-SKU', 'https://www.target.com/p/native-signal/NATIVE-SIGNAL-SKU',
         'in_stock', 1, 1299, 'USD', $1, $1
       )`,
      [signalFixtureTimestamp]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."source_listing_refs"(
         id, source_connection_id, external_listing_id, external_product_id,
         listing_id, source_url, observed_at
       ) VALUES (
         'source_listing_native_signal', 'native_signal_source_a',
         'native-source-listing-a', 'native-source-product-a',
         'listing_native_signal', 'https://trackalacker.example/native-source-listing-a', $1
       )`,
      [signalFixtureTimestamp]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."source_product_refs"(
         id, source_connection_id, external_product_id, variant_id,
         source_url, source_title, observed_at
       ) VALUES (
         'source_product_native_signal_ambiguous', 'native_signal_source_a',
         'native-source-product-ambiguous', 'variant_cutover_scope',
         'https://trackalacker.example/native-source-product-ambiguous',
         'Native ambiguous source product', $1
       )`,
      [signalFixtureTimestamp]
    );
    const insertSignalLifecycleInbox = async (
      id: string,
      tenantId: string,
      userId: string,
      deliveryAttempts: number,
      receivedAt: string,
      payload: Record<string, unknown> = { schemaVersion: 1, signalId: id }
    ) => {
      const payloadJson = JSON.stringify(payload);
      await first!.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."inbox_messages"(
           id, tenant_id, user_id, source, message_key, event_type,
           payload_hash, payload_json, state, delivery_attempts,
           lease_capability_hash, lease_expires_at, next_attempt_at,
           last_error_code, received_at, processed_at, updated_at
         ) VALUES ($1, $2, $3, 'trackalacker', $1, 'signal_event_v1',
                   $4, $5, 'accepted', $6, '', '', '', '', $7, '', $7)`,
        [
          id,
          tenantId,
          userId,
          stableHash("hosted_delivery_payload_v1", payloadJson),
          payloadJson,
          deliveryAttempts,
          receivedAt
        ]
      );
    };
    const resolutionSignalPayload = (
      id: string,
      sourceConnectionId: string,
      identity: {
        sourceProductId: string;
        sourceListingId: string;
        retailerId: string;
        retailerSku: string;
        canonicalUrl: string;
        title: string;
      },
      testSignal = false
    ): Record<string, unknown> => ({
      schemaVersion: 1,
      signalId: `signal-${id}`,
      sourceConnectionId,
      source: "trackalacker",
      externalEventId: `event-${id}`,
      eventType: "restock",
      observedAt: new Date(signalLifecycleNow - 1_000).toISOString(),
      receivedAt: new Date(signalLifecycleNow).toISOString(),
      test: testSignal,
      identity: { ...identity, globalIdentifiers: {} },
      offer: {
        availability: "in_stock",
        unitPriceCents: 1199,
        currency: "USD",
        sellerName: "Target",
        sellerType: "first_party",
        orderLimit: 1,
        fulfillment: "shipping",
        offerFingerprint: stableHash("offer", id)
      },
      evidence: { headline: "Native signal", body: "", msrpStatus: "", clickUrl: "" },
      parserVersion: "trackalacker-push-v1"
    });
    const signalCompleteId = "native_signal_lifecycle_complete";
    const signalRetryId = "native_signal_lifecycle_retry";
    const signalPeerId = "native_signal_lifecycle_peer";
    const signalDeadId = "native_signal_lifecycle_dead";
    await insertSignalLifecycleInbox(
      signalCompleteId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(signalLifecycleNow - 4_000).toISOString()
    );
    await insertSignalLifecycleInbox(
      signalRetryId,
      "tenant_local",
      "user_local",
      0,
      new Date(signalLifecycleNow - 3_000).toISOString()
    );
    await insertSignalLifecycleInbox(
      signalPeerId,
      NATIVE_TENANT,
      NATIVE_SAME_TENANT_USER,
      0,
      new Date(signalLifecycleNow - 2_000).toISOString()
    );

    const contendedSignalLeases = await Promise.all([
      deliveryLeaseRecoveryA.leaseSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        signalLifecycleNow
      ),
      deliveryLeaseRecoveryASecond.leaseSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        signalLifecycleNow
      )
    ]);
    const signalCompleteLease = contendedSignalLeases.find((lease) => lease !== null);
    assert.equal(contendedSignalLeases.filter((lease) => lease !== null).length, 1);
    assert.ok(signalCompleteLease);
    assert.equal(signalCompleteLease.id, signalCompleteId);
    assert.equal(signalCompleteLease.source, "trackalacker");
    assert.equal(signalCompleteLease.messageKey, signalCompleteId);
    assert.equal(signalCompleteLease.eventType, "signal_event_v1");
    assert.deepEqual(signalCompleteLease.payload, {
      schemaVersion: 1,
      signalId: signalCompleteId
    });
    assert.equal(signalCompleteLease.attempt, 1);
    assert.match(signalCompleteLease.capabilityToken, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(Date.parse(signalCompleteLease.leaseExpiresAt) - Date.now() >= 50_000);
    assert.ok(Date.parse(signalCompleteLease.leaseExpiresAt) - Date.now() <= 70_000);
    assert.equal(
      (await first.query<{ capabilityHash: string }>(
        `SELECT lease_capability_hash AS "capabilityHash"
         FROM "${NATIVE_SCHEMA}"."inbox_messages" WHERE id = $1`,
        [signalCompleteId]
      )).rows[0]?.capabilityHash,
      stableHash(
        "hosted_delivery_capability_v1",
        signalCompleteId,
        signalCompleteLease.capabilityToken
      )
    );
    const wrongSignalCapability = `${
      signalCompleteLease.capabilityToken.startsWith("A") ? "B" : "A"
    }${signalCompleteLease.capabilityToken.slice(1)}`;
    await assert.rejects(
      deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        signalCompleteId,
        wrongSignalCapability,
        signalLifecycleNow
      ),
      /capability is invalid or expired/
    );
    await assert.rejects(
      deliveryLeaseRecoveryB.completeSignalInbox(
        { tenantId: "tenant_local", userId: "user_local" },
        signalCompleteId,
        signalCompleteLease.capabilityToken,
        signalLifecycleNow
      ),
      /capability is invalid or expired/
    );
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        signalCompleteId,
        signalCompleteLease.capabilityToken,
        signalLifecycleNow
      ),
      true
    );
    await assert.rejects(
      deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        signalCompleteId,
        signalCompleteLease.capabilityToken,
        signalLifecycleNow
      ),
      /capability is invalid or expired/
    );

    const signalRetryLease = await deliveryLeaseRecoveryB.leaseSignalInbox(
      { tenantId: "tenant_local", userId: "user_local" },
      signalLifecycleNow
    );
    assert.ok(signalRetryLease);
    assert.equal(signalRetryLease.id, signalRetryId);
    assert.equal(
      await deliveryLeaseRecoveryB.failSignalInbox(
        { tenantId: "tenant_local", userId: "user_local" },
        signalRetryId,
        signalRetryLease.capabilityToken,
        signalLifecycleNow
      ),
      "retry"
    );
    const signalRetryRow = (await first.query<{
      state: string;
      attempt: number;
      capabilityHash: string;
      leaseExpiresAt: string;
      nextAttemptAt: string;
      errorCode: string;
    }>(
      `SELECT state, delivery_attempts AS attempt,
              lease_capability_hash AS "capabilityHash",
              lease_expires_at AS "leaseExpiresAt",
              next_attempt_at AS "nextAttemptAt",
              last_error_code AS "errorCode"
       FROM "${NATIVE_SCHEMA}"."inbox_messages" WHERE id = $1`,
      [signalRetryId]
    )).rows[0]!;
    assert.deepEqual({
      state: signalRetryRow.state,
      attempt: Number(signalRetryRow.attempt),
      capabilityHash: signalRetryRow.capabilityHash,
      leaseExpiresAt: signalRetryRow.leaseExpiresAt,
      errorCode: signalRetryRow.errorCode
    }, {
      state: "failed",
      attempt: 1,
      capabilityHash: "",
      leaseExpiresAt: "",
      errorCode: "signal_processing_failed"
    });
    assert.ok(Date.parse(signalRetryRow.nextAttemptAt) - Date.now() >= 20_000);
    assert.ok(Date.parse(signalRetryRow.nextAttemptAt) - Date.now() <= 40_000);
    assert.equal(
      await deliveryLeaseRecoveryB.leaseSignalInbox(
        { tenantId: "tenant_local", userId: "user_local" },
        signalLifecycleNow
      ),
      null
    );

    const signalPeerLease = await deliveryLeaseRecoveryC.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
      signalLifecycleNow
    );
    assert.ok(signalPeerLease);
    assert.equal(signalPeerLease.id, signalPeerId);
    assert.equal(
      await deliveryLeaseRecoveryC.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
        signalPeerId,
        signalPeerLease.capabilityToken,
        signalLifecycleNow
      ),
      true
    );

    await insertSignalLifecycleInbox(
      signalDeadId,
      NATIVE_TENANT,
      NATIVE_USER,
      19,
      new Date(signalLifecycleNow - 1_000).toISOString()
    );
    const signalDeadLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      signalLifecycleNow
    );
    assert.ok(signalDeadLease);
    assert.equal(signalDeadLease.id, signalDeadId);
    assert.equal(signalDeadLease.attempt, 20);
    assert.equal(
      await deliveryLeaseRecoveryA.failSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        signalDeadId,
        signalDeadLease.capabilityToken,
        signalLifecycleNow
      ),
      "dead_letter"
    );
    assert.deepEqual(
      (await first.query<{
        state: string;
        attempt: number;
        nextAttemptAt: string;
        errorCode: string;
      }>(
        `SELECT state, delivery_attempts AS attempt,
                next_attempt_at AS "nextAttemptAt",
                last_error_code AS "errorCode"
         FROM "${NATIVE_SCHEMA}"."inbox_messages" WHERE id = $1`,
        [signalDeadId]
      )).rows.map((row) => ({ ...row, attempt: Number(row.attempt) })),
      [{
        state: "dead_letter",
        attempt: 20,
        nextAttemptAt: "",
        errorCode: "signal_processing_failed"
      }]
    );

    const matchedResolutionId = "native_signal_resolution_matched";
    const matchedResolutionPayload = resolutionSignalPayload(
      matchedResolutionId,
      "native_signal_source_a",
      {
        sourceProductId: "native-source-product-a",
        sourceListingId: "native-source-listing-a",
        retailerId: "target",
        retailerSku: "NATIVE-SIGNAL-SKU",
        canonicalUrl: "https://www.target.com/p/native-signal/NATIVE-SIGNAL-SKU",
        title: "Native signal product"
      }
    );
    const peerResolutionId = "native_signal_resolution_peer";
    const peerResolutionPayload = resolutionSignalPayload(
      peerResolutionId,
      "native_signal_source_c",
      {
        sourceProductId: "",
        sourceListingId: "",
        retailerId: "target",
        retailerSku: "NATIVE-SIGNAL-SKU",
        canonicalUrl: "https://www.target.com/p/native-signal/NATIVE-SIGNAL-SKU",
        title: "Native signal product"
      }
    );
    const ambiguousResolutionId = "native_signal_resolution_ambiguous";
    const ambiguousResolutionPayload = resolutionSignalPayload(
      ambiguousResolutionId,
      "native_signal_source_a",
      {
        sourceProductId: "native-source-product-ambiguous",
        sourceListingId: "",
        retailerId: "target",
        retailerSku: "",
        canonicalUrl: "https://www.target.com/p/native-ambiguous/NATIVE-AMBIGUOUS-SKU",
        title: "Native ambiguous signal product"
      }
    );
    const unresolvedResolutionId = "native_signal_resolution_unresolved";
    const unresolvedResolutionPayload = resolutionSignalPayload(
      unresolvedResolutionId,
      "native_signal_source_a",
      {
        sourceProductId: "native-source-product-unresolved",
        sourceListingId: "native-source-listing-unresolved",
        retailerId: "target",
        retailerSku: "NATIVE-UNRESOLVED-SKU",
        canonicalUrl: "https://www.target.com/p/native-unresolved/NATIVE-UNRESOLVED-SKU",
        title: "Native unresolved signal product"
      }
    );
    const duplicateResolutionId = "native_signal_resolution_duplicate";
    const duplicateResolutionPayload = resolutionSignalPayload(
      duplicateResolutionId,
      "native_signal_source_a",
      {
        sourceProductId: "native-source-product-a",
        sourceListingId: "native-source-listing-a",
        retailerId: "target",
        retailerSku: "NATIVE-SIGNAL-SKU",
        canonicalUrl: "https://www.target.com/p/native-signal/NATIVE-SIGNAL-SKU",
        title: "Native signal product"
      }
    );
    const duplicateEventId = "signal_event_native_resolution_duplicate";
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."signal_events"(
         id, tenant_id, user_id, source_connection_id, signal_id,
         external_event_id, transport_hash, schema_version, source, event_type,
         test, observed_at, received_at, identity_json, offer_json,
         evidence_json, parser_version, resolution_status, created_at
       ) VALUES (
         $1, $2, $3, 'native_signal_source_a', $4, $5, $6, 1,
         'trackalacker', 'restock', 0, $7, $8, $9, $10, $11,
         'trackalacker-push-v1', 'unresolved', $8
       )`,
      [
        duplicateEventId,
        NATIVE_TENANT,
        NATIVE_USER,
        duplicateResolutionPayload.signalId,
        duplicateResolutionPayload.externalEventId,
        stableHash(
          "native_signal_source_a",
          String(duplicateResolutionPayload.externalEventId)
        ),
        duplicateResolutionPayload.observedAt,
        duplicateResolutionPayload.receivedAt,
        JSON.stringify(duplicateResolutionPayload.identity),
        JSON.stringify(duplicateResolutionPayload.offer),
        JSON.stringify(duplicateResolutionPayload.evidence)
      ]
    );
    const signalResolutionMutationCounts = async () => {
      const row = (await first!.query<{
        signalEvents: string | number | bigint;
        resolutionDecisions: string | number | bigint;
        signalOccurrences: string | number | bigint;
        signalIncidents: string | number | bigint;
        offerObservations: string | number | bigint;
        productFamilies: string | number | bigint;
        variants: string | number | bigint;
        listings: string | number | bigint;
        listingUrls: string | number | bigint;
        sourceConnections: string | number | bigint;
        sourceProductRefs: string | number | bigint;
        sourceListingRefs: string | number | bigint;
        sourceAliases: string | number | bigint;
        preferredRefs: string | number | bigint;
        missionDecisions: string | number | bigint;
        auditEvents: string | number | bigint;
        outboxEvents: string | number | bigint;
        missions: string | number | bigint;
        missionTargets: string | number | bigint;
        strategies: string | number | bigint;
        actionJobs: string | number | bigint;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."signal_events") AS "signalEvents",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."resolution_decisions") AS "resolutionDecisions",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."signal_occurrences") AS "signalOccurrences",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."signal_incidents") AS "signalIncidents",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."offer_observations") AS "offerObservations",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."product_families") AS "productFamilies",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."variants") AS variants,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."listings") AS listings,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."listing_urls") AS "listingUrls",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_connections") AS "sourceConnections",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_product_refs") AS "sourceProductRefs",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_listing_refs") AS "sourceListingRefs",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_product_aliases") AS "sourceAliases",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_variant_retailer_refs") AS "preferredRefs",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."mission_decisions") AS "missionDecisions",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events") AS "auditEvents",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events") AS "outboxEvents",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."missions") AS missions,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."mission_targets") AS "missionTargets",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."strategies") AS strategies,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."action_jobs") AS "actionJobs"`
      )).rows[0]!;
      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, Number(value)])
      );
    };
    const countsBeforeResolutionPlans = await signalResolutionMutationCounts();
    const resolutionPlanNow = Date.now();
    const signalEvaluationAdmin = first;
    assert.ok(signalEvaluationAdmin);
    const attestNativeSignalEvaluation = async (input: {
      payload: Record<string, unknown>;
      missionId: string;
      missionTargetId: string;
      listingId: string;
      missionEvaluationQuantity: number;
      strategies: StrategyDefinition[];
      now: number;
    }): Promise<SignalPolicyEvaluationAttestation> => {
      const listingRow = (await signalEvaluationAdmin.query<{
        id: string;
        variantId: string;
        title: string;
        retailerId: string;
        retailerSku: string;
        canonicalUrl: string;
        executionSupported: number;
        msrpCents: number | null;
        currency: string;
      }>(
        `SELECT listing.id, listing.variant_id AS "variantId", variant.title,
                listing.retailer_id AS "retailerId", listing.retailer_sku AS "retailerSku",
                listing.canonical_url AS "canonicalUrl",
                listing.execution_supported AS "executionSupported",
                listing.msrp_cents AS "msrpCents", listing.currency
         FROM "${NATIVE_SCHEMA}"."listings" AS listing
         JOIN "${NATIVE_SCHEMA}"."variants" AS variant ON variant.id = listing.variant_id
         WHERE listing.id = $1`,
        [input.listingId]
      )).rows[0]!;
      const missionRow = (await signalEvaluationAdmin.query<{
        id: string;
        status: MissionContext["status"];
        targetId: string;
        targetEnabled: number;
        maxUnitPriceCents: number | null;
        sellerPolicy: MissionContext["sellerPolicy"];
        fulfillment: MissionContext["fulfillment"];
      }>(
        `SELECT mission.id, mission.status, target.id AS "targetId",
                target.enabled AS "targetEnabled",
                target.max_unit_price_cents AS "maxUnitPriceCents",
                target.seller_policy AS "sellerPolicy", target.fulfillment
         FROM "${NATIVE_SCHEMA}"."missions" AS mission
         JOIN "${NATIVE_SCHEMA}"."mission_targets" AS target ON target.mission_id = mission.id
         WHERE mission.id = $1 AND target.id = $2`,
        [input.missionId, input.missionTargetId]
      )).rows[0]!;
      const policyRow = (await signalEvaluationAdmin.query<{
        id: string;
        missionId: string;
        revision: number;
        quantity: number;
        currency: string;
        maxAllInCents: number | null;
        actionCeiling: PurchaseIntentPolicy["actionCeiling"];
        decisionMode: PurchaseIntentPolicy["decisionMode"];
        maxSignalAgeSeconds: number;
        substitutionPolicy: PurchaseIntentPolicy["substitutionPolicy"];
        expiresAt: string;
        cooldownSeconds: number;
        targetPolicyJson: string;
        policyHash: string;
        changeReason: string;
        createdByActorId: string;
        createdAt: string;
      }>(
        `SELECT id, mission_id AS "missionId", revision, quantity, currency,
                max_all_in_cents AS "maxAllInCents", action_ceiling AS "actionCeiling",
                decision_mode AS "decisionMode",
                max_signal_age_seconds AS "maxSignalAgeSeconds",
                substitution_policy AS "substitutionPolicy", expires_at AS "expiresAt",
                cooldown_seconds AS "cooldownSeconds", target_policy_json AS "targetPolicyJson",
                policy_hash AS "policyHash", change_reason AS "changeReason",
                created_by_actor_id AS "createdByActorId", created_at AS "createdAt"
         FROM "${NATIVE_SCHEMA}"."mission_intent_revisions"
         WHERE mission_id = $1 ORDER BY revision DESC LIMIT 1`,
        [input.missionId]
      )).rows[0]!;
      const listing: ListingContext = {
        ...listingRow,
        executionSupported: Number(listingRow.executionSupported) === 1,
        msrpCents: listingRow.msrpCents === null ? null : Number(listingRow.msrpCents)
      };
      const mission: MissionContext = {
        id: missionRow.id,
        status: missionRow.status,
        targetQuantity: input.missionEvaluationQuantity,
        targetId: missionRow.targetId,
        targetEnabled: Number(missionRow.targetEnabled) === 1,
        maxUnitPriceCents: missionRow.maxUnitPriceCents === null
          ? null : Number(missionRow.maxUnitPriceCents),
        sellerPolicy: missionRow.sellerPolicy,
        fulfillment: missionRow.fulfillment
      };
      const policy: PurchaseIntentPolicy = {
        ...policyRow,
        revision: Number(policyRow.revision),
        quantity: Number(policyRow.quantity),
        maxAllInCents: policyRow.maxAllInCents === null ? null : Number(policyRow.maxAllInCents),
        maxSignalAgeSeconds: Number(policyRow.maxSignalAgeSeconds),
        cooldownSeconds: Number(policyRow.cooldownSeconds),
        targets: JSON.parse(policyRow.targetPolicyJson)
      };
      const normalized = normalizeSignal(input.payload as unknown as SignalEventInput, input.now);
      const sourceTrust = (await signalEvaluationAdmin.query<{ trustLevel: string }>(
        `SELECT trust_level AS "trustLevel" FROM "${NATIVE_SCHEMA}"."source_connections"
         WHERE id = $1`,
        [normalized.sourceConnectionId]
      )).rows[0]!.trustLevel;
      return attestSignalPolicyEvaluation({
        strategies: input.strategies,
        policy,
        signal: normalized,
        listing,
        mission,
        sourceTrustLevel: sourceTrust,
        now: input.now
      });
    };

    await insertSignalLifecycleInbox(
      matchedResolutionId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow - 4_000).toISOString(),
      matchedResolutionPayload
    );
    const matchedResolutionLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow
    );
    assert.ok(matchedResolutionLease);
    assert.equal(matchedResolutionLease.id, matchedResolutionId);
    const wrongResolutionCapability = `${
      matchedResolutionLease.capabilityToken.startsWith("A") ? "B" : "A"
    }${matchedResolutionLease.capabilityToken.slice(1)}`;
    await assert.rejects(
      deliveryLeaseRecoveryA.planSignalResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        matchedResolutionId,
        wrongResolutionCapability,
        resolutionPlanNow
      ),
      /capability is invalid or expired/
    );
    await assert.rejects(
      deliveryLeaseRecoveryB.planSignalResolution(
        { tenantId: "tenant_local", userId: "user_local" },
        matchedResolutionId,
        matchedResolutionLease.capabilityToken,
        resolutionPlanNow
      ),
      /capability is invalid or expired/
    );
    await assert.rejects(
      deliveryLeaseRecoveryC.planSignalResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
        matchedResolutionId,
        matchedResolutionLease.capabilityToken,
        resolutionPlanNow
      ),
      /capability is invalid or expired/
    );
    const matchedResolutionPlan = await deliveryLeaseRecoveryA.planSignalResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      matchedResolutionId,
      matchedResolutionLease.capabilityToken,
      resolutionPlanNow
    );
    assert.equal(matchedResolutionPlan.contractVersion, 1);
    assert.equal(matchedResolutionPlan.messageId, matchedResolutionId);
    assert.equal(
      matchedResolutionPlan.payloadHash,
      stableHash("hosted_delivery_payload_v1", JSON.stringify(matchedResolutionPayload))
    );
    assert.deepEqual(matchedResolutionPlan.sourceConnection, {
      id: "native_signal_source_a",
      trustLevel: "trusted_exact",
      autoCreateMissions: true
    });
    assert.equal(matchedResolutionPlan.outcome, "matched");
    assert.equal(matchedResolutionPlan.duplicateEventId, "");
    assert.equal(matchedResolutionPlan.resolution?.status, "matched");
    assert.equal(matchedResolutionPlan.resolution?.method, "source_listing_id");
    assert.deepEqual(matchedResolutionPlan.resolution?.listing, {
      id: "listing_native_signal",
      variantId: "variant_cutover_scope",
      title: "Cutover scope variant",
      retailerId: "target",
      retailerSku: "NATIVE-SIGNAL-SKU",
      canonicalUrl: "https://www.target.com/p/native-signal/NATIVE-SIGNAL-SKU",
      executionSupported: true,
      msrpCents: 1299,
      currency: "USD"
    });
    assert.equal(matchedResolutionPlan.sharedCatalogMutationRequired, false);
    assert.ok(Date.parse(matchedResolutionPlan.validUntil) > Date.parse(matchedResolutionPlan.evaluatedAt));
    assert.ok(
      Date.parse(matchedResolutionPlan.validUntil) - Date.parse(matchedResolutionPlan.evaluatedAt)
      <= 30_000
    );
    assert.equal(
      matchedResolutionPlan.planFingerprint,
      postgresHostedSignalResolutionPlanFingerprint(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        matchedResolutionPlan
      )
    );
    const publicMatchedPlan = JSON.stringify(matchedResolutionPlan);
    assert.equal(publicMatchedPlan.includes("native-source-product-a"), false);
    assert.equal(publicMatchedPlan.includes("unitPriceCents"), false);
    assert.equal(publicMatchedPlan.includes("evidence"), false);
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        matchedResolutionId,
        matchedResolutionLease.capabilityToken,
        resolutionPlanNow
      ),
      true
    );
    await assert.rejects(
      deliveryLeaseRecoveryA.planSignalResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        matchedResolutionId,
        matchedResolutionLease.capabilityToken,
        resolutionPlanNow
      ),
      /capability is invalid or expired/
    );

    await insertSignalLifecycleInbox(
      peerResolutionId,
      NATIVE_TENANT,
      NATIVE_SAME_TENANT_USER,
      0,
      new Date(resolutionPlanNow - 3_000).toISOString(),
      peerResolutionPayload
    );
    const peerResolutionLease = await deliveryLeaseRecoveryC.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
      resolutionPlanNow
    );
    assert.ok(peerResolutionLease);
    const peerResolutionPlan = await deliveryLeaseRecoveryC.planSignalResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
      peerResolutionId,
      peerResolutionLease.capabilityToken,
      resolutionPlanNow
    );
    assert.equal(peerResolutionPlan.outcome, "matched");
    assert.equal(peerResolutionPlan.resolution?.method, "retailer_sku");
    assert.equal(peerResolutionPlan.resolution?.listing?.id, "listing_native_signal");
    assert.equal(peerResolutionPlan.sourceConnection.trustLevel, "informational");
    assert.equal(peerResolutionPlan.sharedCatalogMutationRequired, false);
    assert.equal(
      await deliveryLeaseRecoveryC.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
        peerResolutionId,
        peerResolutionLease.capabilityToken,
        resolutionPlanNow
      ),
      true
    );

    await insertSignalLifecycleInbox(
      ambiguousResolutionId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow - 2_000).toISOString(),
      ambiguousResolutionPayload
    );
    const ambiguousResolutionLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow
    );
    assert.ok(ambiguousResolutionLease);
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."inbox_messages"
       SET payload_json = $2 WHERE id = $1`,
      [
        ambiguousResolutionId,
        JSON.stringify({ ...ambiguousResolutionPayload, unexpected: "tampered" })
      ]
    );
    await assert.rejects(
      deliveryLeaseRecoveryA.planSignalResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        ambiguousResolutionId,
        ambiguousResolutionLease.capabilityToken,
        resolutionPlanNow
      ),
      /payload hash is invalid/
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."inbox_messages"
       SET payload_json = $2 WHERE id = $1`,
      [ambiguousResolutionId, JSON.stringify(ambiguousResolutionPayload)]
    );
    const ambiguousResolutionPlan = await deliveryLeaseRecoveryA.planSignalResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      ambiguousResolutionId,
      ambiguousResolutionLease.capabilityToken,
      resolutionPlanNow
    );
    assert.equal(ambiguousResolutionPlan.outcome, "ambiguous");
    assert.deepEqual(ambiguousResolutionPlan.resolution, {
      status: "ambiguous",
      method: "source_product_retailer",
      reason: "Multiple same-retailer listings exist for this source product; an exact listing ID or SKU is required.",
      listing: null
    });
    assert.equal(ambiguousResolutionPlan.sharedCatalogMutationRequired, false);
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        ambiguousResolutionId,
        ambiguousResolutionLease.capabilityToken,
        resolutionPlanNow
      ),
      true
    );

    await insertSignalLifecycleInbox(
      unresolvedResolutionId,
      NATIVE_TENANT,
      NATIVE_USER,
      19,
      new Date(resolutionPlanNow - 1_000).toISOString(),
      unresolvedResolutionPayload
    );
    const unresolvedResolutionLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow
    );
    assert.ok(unresolvedResolutionLease);
    const unresolvedResolutionPlan = await deliveryLeaseRecoveryA.planSignalResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      unresolvedResolutionId,
      unresolvedResolutionLease.capabilityToken,
      resolutionPlanNow
    );
    assert.equal(unresolvedResolutionPlan.outcome, "unresolved");
    assert.deepEqual(unresolvedResolutionPlan.resolution, {
      status: "unresolved",
      method: "none",
      reason: "No exact source-listing or retailer-SKU mapping matched the signal.",
      listing: null
    });
    assert.equal(unresolvedResolutionPlan.sharedCatalogMutationRequired, true);
    assert.equal(
      await deliveryLeaseRecoveryA.failSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        unresolvedResolutionId,
        unresolvedResolutionLease.capabilityToken,
        resolutionPlanNow
      ),
      "dead_letter"
    );
    await assert.rejects(
      deliveryLeaseRecoveryA.planSignalResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        unresolvedResolutionId,
        unresolvedResolutionLease.capabilityToken,
        resolutionPlanNow
      ),
      /capability is invalid or expired/
    );

    await insertSignalLifecycleInbox(
      duplicateResolutionId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow).toISOString(),
      duplicateResolutionPayload
    );
    const duplicateResolutionLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow
    );
    assert.ok(duplicateResolutionLease);
    const duplicateResolutionPlan = await deliveryLeaseRecoveryA.planSignalResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      duplicateResolutionId,
      duplicateResolutionLease.capabilityToken,
      resolutionPlanNow
    );
    assert.equal(duplicateResolutionPlan.outcome, "duplicate");
    assert.equal(duplicateResolutionPlan.duplicateEventId, duplicateEventId);
    assert.equal(duplicateResolutionPlan.resolution, null);
    assert.equal(duplicateResolutionPlan.sharedCatalogMutationRequired, false);
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        duplicateResolutionId,
        duplicateResolutionLease.capabilityToken,
        resolutionPlanNow
      ),
      true
    );
    assert.deepEqual(await signalResolutionMutationCounts(), countsBeforeResolutionPlans);

    const catalogSignalId = "inbox_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const catalogSignalBase = resolutionSignalPayload(
      catalogSignalId,
      "native_signal_source_a",
      {
        sourceProductId: "native-catalog-product-a",
        sourceListingId: "native-catalog-listing-a",
        retailerId: "target",
        retailerSku: "999999999",
        canonicalUrl: "https://www.target.com/p/-/A-999999999",
        title: "Native catalog-created product"
      }
    );
    const catalogSignalPayload = {
      ...catalogSignalBase,
      identity: {
        ...(catalogSignalBase.identity as Record<string, unknown>),
        globalIdentifiers: { trackalacker_slug: "native-catalog-created-product" }
      }
    };
    await insertSignalLifecycleInbox(
      catalogSignalId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow + 1_000).toISOString(),
      catalogSignalPayload
    );
    const catalogSignalLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow + 1_000
    );
    assert.ok(catalogSignalLease);
    assert.equal(catalogSignalLease.id, catalogSignalId);
    const catalogResolutionBeforeApply = await deliveryLeaseRecoveryA.planSignalResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      catalogSignalId,
      catalogSignalLease.capabilityToken,
      resolutionPlanNow + 1_000
    );
    assert.equal(catalogResolutionBeforeApply.outcome, "unresolved");
    assert.equal(catalogResolutionBeforeApply.sharedCatalogMutationRequired, true);
    const wrongCatalogCapability = `${
      catalogSignalLease.capabilityToken.startsWith("A") ? "B" : "A"
    }${catalogSignalLease.capabilityToken.slice(1)}`;
    await assert.rejects(
      signalCatalogApplyA.applyExactSignalCatalogCreate(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        catalogSignalId,
        wrongCatalogCapability,
        resolutionPlanNow + 1_000
      ),
      /capability is invalid or expired|inbox capability expired/
    );
    await assert.rejects(
      signalCatalogApplyA.applyExactSignalCatalogCreate(
        { tenantId: "tenant_local", userId: "user_local" },
        catalogSignalId,
        catalogSignalLease.capabilityToken,
        resolutionPlanNow + 1_000
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      signalCatalogApplyB.applyExactSignalCatalogCreate(
        { tenantId: "tenant_local", userId: "user_local" },
        catalogSignalId,
        catalogSignalLease.capabilityToken,
        resolutionPlanNow + 1_000
      ),
      /capability is invalid or expired|inbox binding is unavailable/
    );
    await assert.rejects(
      signalCatalogApplyC.applyExactSignalCatalogCreate(
        { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
        catalogSignalId,
        catalogSignalLease.capabilityToken,
        resolutionPlanNow + 1_000
      ),
      /capability is invalid or expired|inbox binding is unavailable/
    );
    await assert.rejects(
      signalCatalogApplyUnmapped.applyExactSignalCatalogCreate(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        catalogSignalId,
        catalogSignalLease.capabilityToken,
        resolutionPlanNow + 1_000
      ),
      /tenant session principal is not active/
    );
    const catalogCountsBeforeApply = await signalResolutionMutationCounts();
    const catalogApplyResult = await signalCatalogApplyA.applyExactSignalCatalogCreate(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      catalogSignalId,
      catalogSignalLease.capabilityToken,
      resolutionPlanNow + 1_000
    );
    assert.equal(catalogApplyResult.contractVersion, 1);
    assert.equal(catalogApplyResult.messageId, catalogSignalId);
    assert.match(catalogApplyResult.planFingerprint, /^[a-f0-9]{64}$/);
    assert.match(catalogApplyResult.familyId, /^family_[a-f0-9]{32}$/);
    assert.match(catalogApplyResult.variantId, /^variant_[a-f0-9]{32}$/);
    assert.match(catalogApplyResult.listingId, /^listing_[a-f0-9]{32}$/);
    assert.equal(catalogApplyResult.familyCreated, true);
    assert.equal(catalogApplyResult.variantCreated, true);
    assert.equal(catalogApplyResult.listingCreated, true);
    assert.equal(catalogApplyResult.canonicalUrlCreated, true);
    assert.equal(catalogApplyResult.sourceProductRefCreated, true);
    assert.equal(catalogApplyResult.sourceListingRefCreated, true);
    assert.equal(catalogApplyResult.sourceAliasCreated, true);
    assert.equal(catalogApplyResult.sharedCatalogRowsCreated, 4);
    assert.equal(catalogApplyResult.tenantReferenceRowsCreated, 3);
    assert.equal(catalogApplyResult.mutationApplied, true);
    assert.equal(catalogApplyResult.mutationAuthority, true);
    assert.equal(catalogApplyResult.signalEvaluationGraphMutated, false);
    assert.equal(catalogApplyResult.rawSignalPayloadReturned, false);
    const serializedCatalogResult = JSON.stringify(catalogApplyResult);
    assert.equal(serializedCatalogResult.includes("Native catalog-created product"), false);
    assert.equal(serializedCatalogResult.includes("unitPriceCents"), false);
    assert.equal(serializedCatalogResult.includes("evidence"), false);
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...catalogCountsBeforeApply,
      productFamilies: Number(catalogCountsBeforeApply.productFamilies) + 1,
      variants: Number(catalogCountsBeforeApply.variants) + 1,
      listings: Number(catalogCountsBeforeApply.listings) + 1,
      listingUrls: Number(catalogCountsBeforeApply.listingUrls) + 1,
      sourceProductRefs: Number(catalogCountsBeforeApply.sourceProductRefs) + 1,
      sourceListingRefs: Number(catalogCountsBeforeApply.sourceListingRefs) + 1,
      sourceAliases: Number(catalogCountsBeforeApply.sourceAliases) + 1
    });
    assert.deepEqual(
      (await first.query<{
        retailerId: string;
        retailerSku: string;
        canonicalUrl: string;
        status: string;
        executionSupported: number;
        currency: string;
      }>(
        `SELECT retailer_id AS "retailerId", retailer_sku AS "retailerSku",
                canonical_url AS "canonicalUrl", status,
                execution_supported::integer AS "executionSupported", currency
         FROM "${NATIVE_SCHEMA}"."listings" WHERE id = $1`,
        [catalogApplyResult.listingId]
      )).rows,
      [{
        retailerId: "target",
        retailerSku: "999999999",
        canonicalUrl: "https://www.target.com/p/-/A-999999999",
        status: "in_stock",
        executionSupported: 1,
        currency: "USD"
      }]
    );
    assert.deepEqual(
      (await first.query<{ state: string; processedAt: string }>(
        `SELECT state, processed_at AS "processedAt"
         FROM "${NATIVE_SCHEMA}"."inbox_messages" WHERE id = $1`,
        [catalogSignalId]
      )).rows,
      [{ state: "processing", processedAt: "" }]
    );
    const catalogResolutionAfterApply = await deliveryLeaseRecoveryA.planSignalResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      catalogSignalId,
      catalogSignalLease.capabilityToken,
      resolutionPlanNow + 1_000
    );
    assert.equal(catalogResolutionAfterApply.outcome, "matched");
    assert.equal(catalogResolutionAfterApply.resolution?.method, "source_listing_id");
    assert.equal(catalogResolutionAfterApply.resolution?.listing?.id, catalogApplyResult.listingId);
    assert.equal(catalogResolutionAfterApply.sharedCatalogMutationRequired, false);
    await assert.rejects(
      signalResolutionApplyA.applySignalEventResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        catalogSignalId,
        wrongCatalogCapability,
        resolutionPlanNow + 1_000
      ),
      /capability is invalid or expired|inbox capability expired/
    );
    await assert.rejects(
      signalResolutionApplyA.applySignalEventResolution(
        { tenantId: "tenant_local", userId: "user_local" },
        catalogSignalId,
        catalogSignalLease.capabilityToken,
        resolutionPlanNow + 1_000
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      signalResolutionApplyB.applySignalEventResolution(
        { tenantId: "tenant_local", userId: "user_local" },
        catalogSignalId,
        catalogSignalLease.capabilityToken,
        resolutionPlanNow + 1_000
      ),
      /capability is invalid or expired|inbox binding is unavailable/
    );
    await assert.rejects(
      signalResolutionApplyC.applySignalEventResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
        catalogSignalId,
        catalogSignalLease.capabilityToken,
        resolutionPlanNow + 1_000
      ),
      /capability is invalid or expired|inbox binding is unavailable/
    );
    await assert.rejects(
      signalResolutionApplyUnmapped.applySignalEventResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        catalogSignalId,
        catalogSignalLease.capabilityToken,
        resolutionPlanNow + 1_000
      ),
      /tenant session principal is not active/
    );
    const resolutionCountsBeforeApply = await signalResolutionMutationCounts();
    const resolutionApplyResult = await signalResolutionApplyA.applySignalEventResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      catalogSignalId,
      catalogSignalLease.capabilityToken,
      resolutionPlanNow + 1_000
    );
    assert.equal(resolutionApplyResult.contractVersion, 1);
    assert.equal(resolutionApplyResult.messageId, catalogSignalId);
    assert.match(resolutionApplyResult.planFingerprint, /^[a-f0-9]{64}$/);
    assert.match(resolutionApplyResult.eventId, /^signal_event_[a-f0-9]{32}$/);
    assert.match(resolutionApplyResult.resolutionDecisionId, /^resolution_[a-f0-9]{32}$/);
    assert.equal(resolutionApplyResult.duplicate, false);
    assert.equal(resolutionApplyResult.signalEventCreated, true);
    assert.equal(resolutionApplyResult.resolutionDecisionCreated, true);
    assert.equal(resolutionApplyResult.sourceConnectionHeartbeatUpdated, true);
    assert.equal(resolutionApplyResult.mutationStatementCount, 3);
    assert.equal(resolutionApplyResult.mutationApplied, true);
    assert.equal(resolutionApplyResult.mutationAuthority, true);
    assert.equal(resolutionApplyResult.transportDuplicateRepositoryParity, true);
    assert.equal(resolutionApplyResult.downstreamSignalGraphMutated, false);
    assert.equal(resolutionApplyResult.inboxLifecycleMutated, false);
    assert.equal(resolutionApplyResult.rawSignalPayloadReturned, false);
    const serializedResolutionResult = JSON.stringify(resolutionApplyResult);
    assert.equal(serializedResolutionResult.includes("Native catalog-created product"), false);
    assert.equal(serializedResolutionResult.includes("unitPriceCents"), false);
    assert.equal(serializedResolutionResult.includes("evidence"), false);
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...resolutionCountsBeforeApply,
      signalEvents: Number(resolutionCountsBeforeApply.signalEvents) + 1,
      resolutionDecisions: Number(resolutionCountsBeforeApply.resolutionDecisions) + 1
    });
    const storedResolution = (await first.query<{
      eventId: string;
      tenantId: string;
      userId: string;
      sourceConnectionId: string;
      signalId: string;
      externalEventId: string;
      eventType: string;
      resolutionStatus: string;
      identityJson: string;
      offerJson: string;
      evidenceJson: string;
      parserVersion: string;
      resolutionId: string;
      method: string;
      variantId: string | null;
      listingId: string | null;
      reason: string;
      resolverVersion: string;
    }>(
      `SELECT event.id AS "eventId", event.tenant_id AS "tenantId",
              event.user_id AS "userId", event.source_connection_id AS "sourceConnectionId",
              event.signal_id AS "signalId", event.external_event_id AS "externalEventId",
              event.event_type AS "eventType", event.resolution_status AS "resolutionStatus",
              event.identity_json AS "identityJson", event.offer_json AS "offerJson",
              event.evidence_json AS "evidenceJson", event.parser_version AS "parserVersion",
              decision.id AS "resolutionId", decision.method,
              decision.variant_id AS "variantId", decision.listing_id AS "listingId",
              decision.reason, decision.resolver_version AS "resolverVersion"
       FROM "${NATIVE_SCHEMA}"."signal_events" AS event
       JOIN "${NATIVE_SCHEMA}"."resolution_decisions" AS decision
         ON decision.event_id = event.id
       WHERE event.id = $1`,
      [resolutionApplyResult.eventId]
    )).rows[0]!;
    assert.deepEqual({
      eventId: storedResolution.eventId,
      tenantId: storedResolution.tenantId,
      userId: storedResolution.userId,
      sourceConnectionId: storedResolution.sourceConnectionId,
      signalId: storedResolution.signalId,
      externalEventId: storedResolution.externalEventId,
      eventType: storedResolution.eventType,
      resolutionStatus: storedResolution.resolutionStatus,
      parserVersion: storedResolution.parserVersion,
      resolutionId: storedResolution.resolutionId,
      method: storedResolution.method,
      variantId: storedResolution.variantId,
      listingId: storedResolution.listingId,
      reason: storedResolution.reason,
      resolverVersion: storedResolution.resolverVersion
    }, {
      eventId: resolutionApplyResult.eventId,
      tenantId: NATIVE_TENANT,
      userId: NATIVE_USER,
      sourceConnectionId: "native_signal_source_a",
      signalId: String(catalogSignalBase.signalId),
      externalEventId: String(catalogSignalBase.externalEventId),
      eventType: "restock",
      resolutionStatus: "matched",
      parserVersion: "trackalacker-push-v1",
      resolutionId: resolutionApplyResult.resolutionDecisionId,
      method: "source_listing_id",
      variantId: catalogApplyResult.variantId,
      listingId: catalogApplyResult.listingId,
      reason: "Matched the exact source listing reference.",
      resolverVersion: "resolver-v1"
    });
    assert.deepEqual(JSON.parse(storedResolution.identityJson), catalogSignalPayload.identity);
    assert.deepEqual(JSON.parse(storedResolution.offerJson), catalogSignalBase.offer);
    assert.deepEqual(JSON.parse(storedResolution.evidenceJson), catalogSignalBase.evidence);
    assert.deepEqual(
      (await first.query<{ status: string; lastEventAt: string }>(
        `SELECT status, last_event_at AS "lastEventAt"
         FROM "${NATIVE_SCHEMA}"."source_connections" WHERE id = 'native_signal_source_a'`
      )).rows,
      [{ status: "connected", lastEventAt: String(catalogSignalBase.receivedAt) }]
    );
    assert.deepEqual(
      (await first.query<{ state: string; processedAt: string }>(
        `SELECT state, processed_at AS "processedAt"
         FROM "${NATIVE_SCHEMA}"."inbox_messages" WHERE id = $1`,
        [catalogSignalId]
      )).rows,
      [{ state: "processing", processedAt: "" }]
    );
    const resolutionCountsBeforeReplay = await signalResolutionMutationCounts();
    const resolutionReplay = await signalResolutionApplyA.applySignalEventResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      catalogSignalId,
      catalogSignalLease.capabilityToken,
      resolutionPlanNow + 1_000
    );
    assert.equal(resolutionReplay.eventId, resolutionApplyResult.eventId);
    assert.equal(resolutionReplay.resolutionDecisionId, "");
    assert.equal(resolutionReplay.duplicate, true);
    assert.equal(resolutionReplay.signalEventCreated, false);
    assert.equal(resolutionReplay.resolutionDecisionCreated, false);
    assert.equal(resolutionReplay.sourceConnectionHeartbeatUpdated, false);
    assert.equal(resolutionReplay.mutationStatementCount, 0);
    assert.equal(resolutionReplay.mutationApplied, false);
    assert.deepEqual(await signalResolutionMutationCounts(), resolutionCountsBeforeReplay);
    await assert.rejects(
      signalCatalogApplyA.applyExactSignalCatalogCreate(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        catalogSignalId,
        catalogSignalLease.capabilityToken,
        resolutionPlanNow + 1_000
      ),
      /mutation is not required by the current resolution plan/
    );
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        catalogSignalId,
        catalogSignalLease.capabilityToken,
        resolutionPlanNow + 1_000
      ),
      true
    );

    const concurrentCatalogSignalId = "inbox_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const concurrentCatalogSignalBase = resolutionSignalPayload(
      concurrentCatalogSignalId,
      "native_signal_source_a",
      {
        sourceProductId: "native-catalog-product-b",
        sourceListingId: "native-catalog-listing-b",
        retailerId: "target",
        retailerSku: "888888888",
        canonicalUrl: "https://www.target.com/p/-/A-888888888",
        title: "Native concurrent catalog product"
      }
    );
    const concurrentCatalogSignalPayload = {
      ...concurrentCatalogSignalBase,
      identity: {
        ...(concurrentCatalogSignalBase.identity as Record<string, unknown>),
        globalIdentifiers: { trackalacker_slug: "native-concurrent-catalog-product" }
      }
    };
    await insertSignalLifecycleInbox(
      concurrentCatalogSignalId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow + 2_000).toISOString(),
      concurrentCatalogSignalPayload
    );
    const concurrentCatalogLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow + 2_000
    );
    assert.ok(concurrentCatalogLease);
    assert.equal(concurrentCatalogLease.id, concurrentCatalogSignalId);
    await assert.rejects(
      signalResolutionApplyA.applySignalEventResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        concurrentCatalogSignalId,
        concurrentCatalogLease.capabilityToken,
        resolutionPlanNow + 2_000
      ),
      /requires the separately qualified catalog-create boundary first/
    );
    const concurrentCountsBeforeApply = await signalResolutionMutationCounts();
    const concurrentCatalogApply = await Promise.allSettled([
      signalCatalogApplyA.applyExactSignalCatalogCreate(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        concurrentCatalogSignalId,
        concurrentCatalogLease.capabilityToken,
        resolutionPlanNow + 2_000
      ),
      signalCatalogApplyASecond.applyExactSignalCatalogCreate(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        concurrentCatalogSignalId,
        concurrentCatalogLease.capabilityToken,
        resolutionPlanNow + 2_000
      )
    ]);
    const concurrentCatalogWinners = concurrentCatalogApply.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<
        NodePostgresSignalCatalogApplyDatabase["applyExactSignalCatalogCreate"]
      >>> => result.status === "fulfilled"
    );
    const concurrentCatalogLosers = concurrentCatalogApply.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    assert.equal(concurrentCatalogWinners.length, 1);
    assert.equal(concurrentCatalogLosers.length, 1);
    assert.match(
      String(concurrentCatalogLosers[0]?.reason),
      /plan changed because the listing now exists|mutation is not required by the current resolution plan/
    );
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...concurrentCountsBeforeApply,
      productFamilies: Number(concurrentCountsBeforeApply.productFamilies) + 1,
      variants: Number(concurrentCountsBeforeApply.variants) + 1,
      listings: Number(concurrentCountsBeforeApply.listings) + 1,
      listingUrls: Number(concurrentCountsBeforeApply.listingUrls) + 1,
      sourceProductRefs: Number(concurrentCountsBeforeApply.sourceProductRefs) + 1,
      sourceListingRefs: Number(concurrentCountsBeforeApply.sourceListingRefs) + 1,
      sourceAliases: Number(concurrentCountsBeforeApply.sourceAliases) + 1
    });
    const concurrentCatalogResolution = await deliveryLeaseRecoveryA.planSignalResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      concurrentCatalogSignalId,
      concurrentCatalogLease.capabilityToken,
      resolutionPlanNow + 2_000
    );
    assert.equal(concurrentCatalogResolution.outcome, "matched");
    assert.equal(
      concurrentCatalogResolution.resolution?.listing?.id,
      concurrentCatalogWinners[0]?.value.listingId
    );
    const concurrentResolutionCountsBefore = await signalResolutionMutationCounts();
    const concurrentResolutionApply = await Promise.all([
      signalResolutionApplyA.applySignalEventResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        concurrentCatalogSignalId,
        concurrentCatalogLease.capabilityToken,
        resolutionPlanNow + 2_000
      ),
      signalResolutionApplyASecond.applySignalEventResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        concurrentCatalogSignalId,
        concurrentCatalogLease.capabilityToken,
        resolutionPlanNow + 2_000
      )
    ]);
    assert.equal(concurrentResolutionApply.filter((result) => result.mutationApplied).length, 1);
    assert.equal(concurrentResolutionApply.filter((result) => result.duplicate).length, 1);
    assert.equal(
      new Set(concurrentResolutionApply.map((result) => result.eventId)).size,
      1
    );
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...concurrentResolutionCountsBefore,
      signalEvents: Number(concurrentResolutionCountsBefore.signalEvents) + 1,
      resolutionDecisions: Number(concurrentResolutionCountsBefore.resolutionDecisions) + 1
    });
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        concurrentCatalogSignalId,
        concurrentCatalogLease.capabilityToken,
        resolutionPlanNow + 2_000
      ),
      true
    );

    const ambiguousApplyMessageId = "inbox_cccccccccccccccccccccccccccccccc";
    await insertSignalLifecycleInbox(
      ambiguousApplyMessageId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow + 3_000).toISOString(),
      ambiguousResolutionPayload
    );
    const ambiguousApplyLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow + 3_000
    );
    assert.ok(ambiguousApplyLease);
    assert.equal(ambiguousApplyLease.id, ambiguousApplyMessageId);
    const ambiguousApplyResult = await signalResolutionApplyA.applySignalEventResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      ambiguousApplyMessageId,
      ambiguousApplyLease.capabilityToken,
      resolutionPlanNow + 3_000
    );
    assert.equal(ambiguousApplyResult.mutationApplied, true);
    assert.deepEqual(
      (await first.query<{
        status: string;
        method: string;
        variantId: string | null;
        listingId: string | null;
      }>(
        `SELECT decision.status, decision.method,
                decision.variant_id AS "variantId", decision.listing_id AS "listingId"
         FROM "${NATIVE_SCHEMA}"."resolution_decisions" AS decision
         WHERE decision.id = $1`,
        [ambiguousApplyResult.resolutionDecisionId]
      )).rows,
      [{
        status: "ambiguous",
        method: "source_product_retailer",
        variantId: null,
        listingId: null
      }]
    );
    const ambiguousReferenceResult = await signalSourceReferenceA.refreshSignalSourceReferences(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      ambiguousApplyMessageId,
      ambiguousApplyLease.capabilityToken,
      resolutionPlanNow + 3_000
    );
    assert.equal(ambiguousReferenceResult.outcome, "not_matched");
    assert.equal(ambiguousReferenceResult.mutationStatementCount, 0);
    assert.equal(ambiguousReferenceResult.sourceReferenceRefreshApplied, false);
    const countsBeforeAmbiguousTerminal = await signalResolutionMutationCounts();
    const concurrentAmbiguousTerminal = await Promise.all([
      signalTerminalDecisionA.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        ambiguousApplyMessageId,
        ambiguousApplyLease.capabilityToken,
        resolutionPlanNow + 3_000
      ),
      signalTerminalDecisionASecond.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        ambiguousApplyMessageId,
        ambiguousApplyLease.capabilityToken,
        resolutionPlanNow + 3_000
      )
    ]);
    const ambiguousTerminalWinner = concurrentAmbiguousTerminal.find(
      (result) => result.terminalDecisionApplyApplied
    );
    const ambiguousTerminalReplay = concurrentAmbiguousTerminal.find(
      (result) => !result.terminalDecisionApplyApplied
    );
    assert.ok(ambiguousTerminalWinner);
    assert.ok(ambiguousTerminalReplay);
    assert.equal(ambiguousTerminalWinner.outcome, "apply_terminal");
    assert.equal(ambiguousTerminalWinner.decisionOutcome, "ambiguous_identity");
    assert.equal(ambiguousTerminalWinner.sourceReferenceOutcome, "not_matched");
    assert.equal(ambiguousTerminalWinner.occurrenceAction, "insert");
    assert.equal(ambiguousTerminalWinner.missionDecisionAction, "insert");
    assert.equal(ambiguousTerminalWinner.auditAction, "insert");
    assert.equal(ambiguousTerminalWinner.outboxAction, "insert");
    assert.equal(ambiguousTerminalWinner.mutationStatementCount, 4);
    assert.equal(ambiguousTerminalWinner.continueDownstream, false);
    assert.equal(ambiguousTerminalWinner.terminalSignalGraphMutated, true);
    assert.equal(ambiguousTerminalWinner.remainingDownstreamSignalGraphMutated, false);
    assert.equal(ambiguousTerminalReplay.outcome, "already_terminal");
    assert.equal(ambiguousTerminalReplay.decisionOutcome, "ambiguous_identity");
    assert.equal(ambiguousTerminalReplay.mutationStatementCount, 0);
    assert.equal(ambiguousTerminalReplay.occurrenceAction, "none");
    assert.equal(ambiguousTerminalReplay.missionDecisionAction, "none");
    assert.equal(ambiguousTerminalReplay.auditAction, "none");
    assert.equal(ambiguousTerminalReplay.outboxAction, "none");
    assert.equal(ambiguousTerminalReplay.terminalSignalGraphMutated, false);
    assert.equal(
      JSON.stringify(concurrentAmbiguousTerminal).includes("native-source-product-ambiguous"),
      false
    );
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...countsBeforeAmbiguousTerminal,
      signalOccurrences: Number(countsBeforeAmbiguousTerminal.signalOccurrences) + 1,
      missionDecisions: Number(countsBeforeAmbiguousTerminal.missionDecisions) + 1,
      auditEvents: Number(countsBeforeAmbiguousTerminal.auditEvents) + 1,
      outboxEvents: Number(countsBeforeAmbiguousTerminal.outboxEvents) + 1
    });
    const ambiguousTerminalRows = (await first.query<{
      occurrenceIncidentId: string | null;
      sourceConnectionId: string;
      occurrenceObservedAt: string;
      occurrenceReceivedAt: string;
      occurrenceCreatedAt: string;
      missionIncidentId: string | null;
      missionId: string | null;
      strategyId: string | null;
      strategyRevision: number | null;
      decisionSource: string;
      decisionOutcome: string;
      decisionReason: string;
      effectiveAction: string;
      effectiveQuantity: number;
      effectiveUnitCapCents: number | null;
      missionCreatedAt: string;
      resolutionReason: string;
      correlationId: string;
      reasonCode: string;
      auditMessage: string;
      auditData: string;
      auditId: string;
      auditCreatedAt: string;
      aggregateType: string;
      aggregateId: string;
      outboxEventType: string;
      outboxPayload: string;
      outboxCreatedAt: string;
      deliveredAt: string;
    }>(
      `SELECT occurrence.incident_id AS "occurrenceIncidentId",
              occurrence.source_connection_id AS "sourceConnectionId",
              occurrence.observed_at AS "occurrenceObservedAt",
              occurrence.received_at AS "occurrenceReceivedAt",
              occurrence.created_at AS "occurrenceCreatedAt",
              mission.incident_id AS "missionIncidentId",
              mission.mission_id AS "missionId", mission.strategy_id AS "strategyId",
              mission.strategy_revision AS "strategyRevision",
              mission.decision_source AS "decisionSource",
              mission.outcome AS "decisionOutcome", mission.reason AS "decisionReason",
              mission.effective_action AS "effectiveAction",
              mission.effective_quantity AS "effectiveQuantity",
              mission.effective_unit_cap_cents AS "effectiveUnitCapCents",
              mission.created_at AS "missionCreatedAt",
              resolution.reason AS "resolutionReason",
              audit.correlation_id AS "correlationId", audit.reason_code AS "reasonCode",
              audit.message AS "auditMessage", audit.data_json AS "auditData",
              audit.id AS "auditId", audit.created_at AS "auditCreatedAt",
              outbox.aggregate_type AS "aggregateType", outbox.aggregate_id AS "aggregateId",
              outbox.event_type AS "outboxEventType", outbox.payload_json AS "outboxPayload",
              outbox.created_at AS "outboxCreatedAt", outbox.delivered_at AS "deliveredAt"
       FROM "${NATIVE_SCHEMA}"."signal_occurrences" AS occurrence
       JOIN "${NATIVE_SCHEMA}"."signal_events" AS event ON event.id = occurrence.event_id
       JOIN "${NATIVE_SCHEMA}"."resolution_decisions" AS resolution
         ON resolution.event_id = event.id
       JOIN "${NATIVE_SCHEMA}"."mission_decisions" AS mission
         ON mission.event_id = event.id
       JOIN "${NATIVE_SCHEMA}"."audit_events" AS audit
         ON audit.correlation_id = event.signal_id AND audit.event_type = 'signal_decided'
       JOIN "${NATIVE_SCHEMA}"."outbox_events" AS outbox
         ON outbox.aggregate_id = event.signal_id AND outbox.event_type = 'signal_decided'
       WHERE event.id = $1`,
      [ambiguousApplyResult.eventId]
    )).rows;
    assert.equal(ambiguousTerminalRows.length, 1);
    const ambiguousTerminalRow = ambiguousTerminalRows[0]!;
    assert.deepEqual({
      occurrenceIncidentId: ambiguousTerminalRow.occurrenceIncidentId,
      sourceConnectionId: ambiguousTerminalRow.sourceConnectionId,
      occurrenceObservedAt: ambiguousTerminalRow.occurrenceObservedAt,
      occurrenceReceivedAt: ambiguousTerminalRow.occurrenceReceivedAt,
      missionIncidentId: ambiguousTerminalRow.missionIncidentId,
      missionId: ambiguousTerminalRow.missionId,
      strategyId: ambiguousTerminalRow.strategyId,
      strategyRevision: ambiguousTerminalRow.strategyRevision,
      decisionSource: ambiguousTerminalRow.decisionSource,
      decisionOutcome: ambiguousTerminalRow.decisionOutcome,
      decisionReason: ambiguousTerminalRow.decisionReason,
      effectiveAction: ambiguousTerminalRow.effectiveAction,
      effectiveQuantity: Number(ambiguousTerminalRow.effectiveQuantity),
      effectiveUnitCapCents: ambiguousTerminalRow.effectiveUnitCapCents,
      correlationId: ambiguousTerminalRow.correlationId,
      reasonCode: ambiguousTerminalRow.reasonCode,
      auditMessage: ambiguousTerminalRow.auditMessage,
      auditData: JSON.parse(ambiguousTerminalRow.auditData),
      aggregateType: ambiguousTerminalRow.aggregateType,
      aggregateId: ambiguousTerminalRow.aggregateId,
      outboxEventType: ambiguousTerminalRow.outboxEventType,
      deliveredAt: ambiguousTerminalRow.deliveredAt
    }, {
      occurrenceIncidentId: null,
      sourceConnectionId: "native_signal_source_a",
      occurrenceObservedAt: ambiguousResolutionPayload.observedAt,
      occurrenceReceivedAt: ambiguousResolutionPayload.receivedAt,
      missionIncidentId: null,
      missionId: null,
      strategyId: null,
      strategyRevision: null,
      decisionSource: "strategy",
      decisionOutcome: "ambiguous_identity",
      decisionReason: ambiguousTerminalRow.resolutionReason,
      effectiveAction: "notify",
      effectiveQuantity: 1,
      effectiveUnitCapCents: null,
      correlationId: ambiguousResolutionPayload.signalId,
      reasonCode: "ambiguous_identity",
      auditMessage: ambiguousTerminalRow.resolutionReason,
      auditData: { resolutionMethod: "source_product_retailer" },
      aggregateType: "signal",
      aggregateId: ambiguousResolutionPayload.signalId,
      outboxEventType: "signal_decided",
      deliveredAt: ""
    });
    assert.equal(ambiguousTerminalRow.occurrenceCreatedAt, ambiguousTerminalRow.missionCreatedAt);
    assert.equal(ambiguousTerminalRow.occurrenceCreatedAt, ambiguousTerminalRow.auditCreatedAt);
    assert.equal(ambiguousTerminalRow.occurrenceCreatedAt, ambiguousTerminalRow.outboxCreatedAt);
    assert.deepEqual(JSON.parse(ambiguousTerminalRow.outboxPayload), {
      auditId: ambiguousTerminalRow.auditId,
      correlationId: ambiguousResolutionPayload.signalId,
      reasonCode: "ambiguous_identity",
      message: ambiguousTerminalRow.resolutionReason,
      data: { resolutionMethod: "source_product_retailer" }
    });
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."mission_decisions"
       SET effective_quantity = 2 WHERE event_id = $1`,
      [ambiguousApplyResult.eventId]
    );
    await assert.rejects(
      signalTerminalDecisionA.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        ambiguousApplyMessageId,
        ambiguousApplyLease.capabilityToken,
        resolutionPlanNow + 3_000
      ),
      /existing terminal signal decision is inconsistent/
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."mission_decisions"
       SET effective_quantity = 1 WHERE event_id = $1`,
      [ambiguousApplyResult.eventId]
    );
    assert.equal(
      (await signalTerminalDecisionA.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        ambiguousApplyMessageId,
        ambiguousApplyLease.capabilityToken,
        resolutionPlanNow + 3_000
      )).outcome,
      "already_terminal"
    );
    await assert.rejects(
      signalOfferIncidentA.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        ambiguousApplyMessageId,
        ambiguousApplyLease.capabilityToken,
        resolutionPlanNow + 3_000
      ),
      /signal offer-incident predecessor validation failed/
    );
    assert.equal(
      (await first.query<{ state: string }>(
        `SELECT state FROM "${NATIVE_SCHEMA}"."inbox_messages" WHERE id = $1`,
        [ambiguousApplyMessageId]
      )).rows[0]?.state,
      "processing"
    );
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        ambiguousApplyMessageId,
        ambiguousApplyLease.capabilityToken,
        resolutionPlanNow + 3_000
      ),
      true
    );

    const unresolvedApplyMessageId = "inbox_dddddddddddddddddddddddddddddddd";
    const unresolvedTestPayload = resolutionSignalPayload(
      unresolvedApplyMessageId,
      "native_signal_source_a",
      {
        sourceProductId: "native-test-product-unresolved",
        sourceListingId: "native-test-listing-unresolved",
        retailerId: "target",
        retailerSku: "777777777",
        canonicalUrl: "https://www.target.com/p/-/A-777777777",
        title: "Native unresolved dry-run product"
      },
      true
    );
    await insertSignalLifecycleInbox(
      unresolvedApplyMessageId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow + 4_000).toISOString(),
      unresolvedTestPayload
    );
    const unresolvedApplyLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow + 4_000
    );
    assert.ok(unresolvedApplyLease);
    assert.equal(unresolvedApplyLease.id, unresolvedApplyMessageId);
    const unresolvedApplyResult = await signalResolutionApplyA.applySignalEventResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      unresolvedApplyMessageId,
      unresolvedApplyLease.capabilityToken,
      resolutionPlanNow + 4_000
    );
    assert.equal(unresolvedApplyResult.mutationApplied, true);
    assert.deepEqual(
      (await first.query<{
        test: number;
        resolutionStatus: string;
        method: string;
        variantId: string | null;
        listingId: string | null;
      }>(
        `SELECT event.test::integer AS test,
                event.resolution_status AS "resolutionStatus", decision.method,
                decision.variant_id AS "variantId", decision.listing_id AS "listingId"
         FROM "${NATIVE_SCHEMA}"."signal_events" AS event
         JOIN "${NATIVE_SCHEMA}"."resolution_decisions" AS decision
           ON decision.event_id = event.id
         WHERE event.id = $1`,
        [unresolvedApplyResult.eventId]
      )).rows,
      [{
        test: 1,
        resolutionStatus: "unresolved",
        method: "none",
        variantId: null,
        listingId: null
      }]
    );
    const testReferenceResult = await signalSourceReferenceA.refreshSignalSourceReferences(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      unresolvedApplyMessageId,
      unresolvedApplyLease.capabilityToken,
      resolutionPlanNow + 4_000
    );
    assert.equal(testReferenceResult.outcome, "test_signal");
    assert.equal(testReferenceResult.mutationStatementCount, 0);
    assert.equal(testReferenceResult.sourceReferenceRefreshApplied, false);
    const countsBeforeTestTerminal = await signalResolutionMutationCounts();
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."signal_occurrences"(
         id, event_id, incident_id, source_connection_id,
         observed_at, received_at, created_at
       ) VALUES ($1, $2, NULL, 'native_signal_source_a', $3, $4, $5)`,
      [
        "occurrence_native_terminal_partial",
        unresolvedApplyResult.eventId,
        unresolvedTestPayload.observedAt,
        unresolvedTestPayload.receivedAt,
        new Date(resolutionPlanNow + 4_000).toISOString()
      ]
    );
    await assert.rejects(
      signalTerminalDecisionA.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        unresolvedApplyMessageId,
        unresolvedApplyLease.capabilityToken,
        resolutionPlanNow + 4_000
      ),
      /partial terminal signal decision fails closed/
    );
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...countsBeforeTestTerminal,
      signalOccurrences: Number(countsBeforeTestTerminal.signalOccurrences) + 1
    });
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."signal_occurrences" WHERE id = $1`,
      ["occurrence_native_terminal_partial"]
    );
    assert.deepEqual(await signalResolutionMutationCounts(), countsBeforeTestTerminal);
    const testTerminalResult = await signalTerminalDecisionA.applySignalTerminalDecision(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      unresolvedApplyMessageId,
      unresolvedApplyLease.capabilityToken,
      resolutionPlanNow + 4_000
    );
    assert.equal(testTerminalResult.outcome, "apply_terminal");
    assert.equal(testTerminalResult.decisionOutcome, "test_signal");
    assert.equal(testTerminalResult.sourceReferenceOutcome, "test_signal");
    assert.equal(testTerminalResult.mutationStatementCount, 4);
    assert.equal(testTerminalResult.terminalDecisionApplyApplied, true);
    assert.equal(testTerminalResult.continueDownstream, false);
    assert.equal(testTerminalResult.sharedCatalogMutated, false);
    assert.equal(testTerminalResult.sourceReferencesMutated, false);
    assert.equal(testTerminalResult.incidentsMutated, false);
    assert.equal(testTerminalResult.offersMutated, false);
    assert.equal(testTerminalResult.missionsMutated, false);
    assert.equal(testTerminalResult.actionsMutated, false);
    assert.equal(testTerminalResult.inboxLifecycleMutated, false);
    assert.equal(testTerminalResult.rawSignalPayloadReturned, false);
    const testTerminalReplay = await signalTerminalDecisionA.applySignalTerminalDecision(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      unresolvedApplyMessageId,
      unresolvedApplyLease.capabilityToken,
      resolutionPlanNow + 4_000
    );
    assert.equal(testTerminalReplay.outcome, "already_terminal");
    assert.equal(testTerminalReplay.decisionOutcome, "test_signal");
    assert.equal(testTerminalReplay.mutationStatementCount, 0);
    assert.equal(testTerminalReplay.terminalDecisionApplyApplied, false);
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...countsBeforeTestTerminal,
      signalOccurrences: Number(countsBeforeTestTerminal.signalOccurrences) + 1,
      missionDecisions: Number(countsBeforeTestTerminal.missionDecisions) + 1,
      auditEvents: Number(countsBeforeTestTerminal.auditEvents) + 1,
      outboxEvents: Number(countsBeforeTestTerminal.outboxEvents) + 1
    });
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        unresolvedApplyMessageId,
        unresolvedApplyLease.capabilityToken,
        resolutionPlanNow + 4_000
      ),
      true
    );

    const unresolvedTerminalMessageId = "inbox_0123456789abcdef0123456789abcdef";
    const unresolvedTerminalPayload = resolutionSignalPayload(
      unresolvedTerminalMessageId,
      "native_signal_source_a_manual",
      {
        sourceProductId: "native-manual-product-unresolved",
        sourceListingId: "native-manual-listing-unresolved",
        retailerId: "target",
        retailerSku: "NATIVE-MANUAL-UNRESOLVED",
        canonicalUrl: "https://www.target.com/p/-/A-123456789",
        title: "Native manual unresolved signal"
      }
    );
    await insertSignalLifecycleInbox(
      unresolvedTerminalMessageId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow + 4_500).toISOString(),
      unresolvedTerminalPayload
    );
    const unresolvedTerminalLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow + 4_500
    );
    assert.ok(unresolvedTerminalLease);
    assert.equal(unresolvedTerminalLease.id, unresolvedTerminalMessageId);
    const unresolvedTerminalResolution = await signalResolutionApplyA.applySignalEventResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      unresolvedTerminalMessageId,
      unresolvedTerminalLease.capabilityToken,
      resolutionPlanNow + 4_500
    );
    assert.equal(unresolvedTerminalResolution.duplicate, false);
    const unresolvedTerminalReference =
      await signalSourceReferenceA.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        unresolvedTerminalMessageId,
        unresolvedTerminalLease.capabilityToken,
        resolutionPlanNow + 4_500
      );
    assert.equal(unresolvedTerminalReference.outcome, "not_matched");
    assert.equal(unresolvedTerminalReference.mutationStatementCount, 0);
    const countsBeforeUnresolvedTerminal = await signalResolutionMutationCounts();
    const unresolvedTerminalResult =
      await signalTerminalDecisionA.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        unresolvedTerminalMessageId,
        unresolvedTerminalLease.capabilityToken,
        resolutionPlanNow + 4_500
      );
    assert.equal(unresolvedTerminalResult.outcome, "apply_terminal");
    assert.equal(unresolvedTerminalResult.decisionOutcome, "unresolved_identity");
    assert.equal(unresolvedTerminalResult.sourceReferenceOutcome, "not_matched");
    assert.equal(unresolvedTerminalResult.mutationStatementCount, 4);
    assert.equal(unresolvedTerminalResult.terminalDecisionApplyApplied, true);
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...countsBeforeUnresolvedTerminal,
      signalOccurrences: Number(countsBeforeUnresolvedTerminal.signalOccurrences) + 1,
      missionDecisions: Number(countsBeforeUnresolvedTerminal.missionDecisions) + 1,
      auditEvents: Number(countsBeforeUnresolvedTerminal.auditEvents) + 1,
      outboxEvents: Number(countsBeforeUnresolvedTerminal.outboxEvents) + 1
    });
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        unresolvedTerminalMessageId,
        unresolvedTerminalLease.capabilityToken,
        resolutionPlanNow + 4_500
      ),
      true
    );

    const referenceRefreshMessageId = "inbox_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const referenceRefreshPayloadBase = resolutionSignalPayload(
      referenceRefreshMessageId,
      "native_signal_source_a",
      {
        sourceProductId: "native-reference-product-a",
        sourceListingId: "native-reference-listing-a",
        retailerId: "target",
        retailerSku: "NATIVE-SIGNAL-SKU",
        canonicalUrl: "https://www.target.com/p/native-signal/NATIVE-SIGNAL-SKU",
        title: "Native reference product"
      }
    );
    const referenceRefreshPayload: Record<string, unknown> = {
      ...referenceRefreshPayloadBase,
      identity: {
        ...(referenceRefreshPayloadBase.identity as Record<string, unknown>),
        globalIdentifiers: { trackalacker_slug: "native-reference-product-a" }
      }
    };
    const referenceRefreshObservedAt = new Date(signalLifecycleNow - 1_000).toISOString();
    await insertSignalLifecycleInbox(
      referenceRefreshMessageId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow + 5_000).toISOString(),
      referenceRefreshPayload
    );
    const referenceRefreshLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow + 5_000
    );
    assert.ok(referenceRefreshLease);
    assert.equal(referenceRefreshLease.id, referenceRefreshMessageId);
    await assert.rejects(
      signalSourceReferenceA.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /signal event and resolution must commit before source-reference refresh/
    );
    const wrongReferenceCapability = `${
      referenceRefreshLease.capabilityToken.startsWith("A") ? "B" : "A"
    }${referenceRefreshLease.capabilityToken.slice(1)}`;
    await assert.rejects(
      signalSourceReferenceA.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        wrongReferenceCapability,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalSourceReferenceB.refreshSignalSourceReferences(
        { tenantId: "tenant_local", userId: "user_local" },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalSourceReferenceC.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalSourceReferenceUnmapped.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /tenant session principal is not active/
    );
    const referenceResolutionResult = await signalResolutionApplyA.applySignalEventResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      referenceRefreshMessageId,
      referenceRefreshLease.capabilityToken,
      resolutionPlanNow + 5_000
    );
    assert.equal(referenceResolutionResult.duplicate, false);
    await assert.rejects(
      signalTerminalDecisionA.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /signal source references must settle before terminal-decision apply/
    );
    await assert.rejects(
      signalTerminalDecisionA.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        wrongReferenceCapability,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalTerminalDecisionB.applySignalTerminalDecision(
        { tenantId: "tenant_local", userId: "user_local" },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalTerminalDecisionC.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalTerminalDecisionUnmapped.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /tenant session principal is not active/
    );
    const countsBeforeReferenceRefresh = await signalResolutionMutationCounts();
    const concurrentReferenceRefresh = await Promise.all([
      signalSourceReferenceA.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      signalSourceReferenceASecond.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      )
    ]);
    const referenceRefreshWinner = concurrentReferenceRefresh.find(
      (result) => result.sourceReferenceRefreshApplied
    );
    const referenceRefreshReplay = concurrentReferenceRefresh.find(
      (result) => !result.sourceReferenceRefreshApplied
    );
    assert.ok(referenceRefreshWinner);
    assert.ok(referenceRefreshReplay);
    assert.equal(referenceRefreshWinner.outcome, "refresh");
    assert.equal(referenceRefreshWinner.eventId, referenceResolutionResult.eventId);
    assert.equal(
      referenceRefreshWinner.resolutionDecisionId,
      referenceResolutionResult.resolutionDecisionId
    );
    assert.equal(referenceRefreshWinner.sourceProductAction, "insert");
    assert.equal(referenceRefreshWinner.sourceListingAction, "insert");
    assert.equal(referenceRefreshWinner.sourceAliasAction, "insert");
    assert.equal(referenceRefreshWinner.mutationStatementCount, 3);
    assert.equal(referenceRefreshWinner.idempotentReplay, true);
    assert.equal(referenceRefreshWinner.sharedCatalogMutated, false);
    assert.equal(referenceRefreshWinner.downstreamSignalGraphMutated, false);
    assert.equal(referenceRefreshWinner.inboxLifecycleMutated, false);
    assert.equal(referenceRefreshWinner.rawSignalPayloadReturned, false);
    assert.equal(referenceRefreshReplay.outcome, "already_current");
    assert.equal(referenceRefreshReplay.mutationStatementCount, 0);
    assert.equal(referenceRefreshReplay.sourceProductAction, "none");
    assert.equal(referenceRefreshReplay.sourceListingAction, "none");
    assert.equal(referenceRefreshReplay.sourceAliasAction, "none");
    assert.equal(
      JSON.stringify(concurrentReferenceRefresh).includes("native-reference-product-a"),
      false
    );
    assert.equal(
      JSON.stringify(concurrentReferenceRefresh).includes("native-reference-listing-a"),
      false
    );
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...countsBeforeReferenceRefresh,
      sourceProductRefs: Number(countsBeforeReferenceRefresh.sourceProductRefs) + 1,
      sourceListingRefs: Number(countsBeforeReferenceRefresh.sourceListingRefs) + 1,
      sourceAliases: Number(countsBeforeReferenceRefresh.sourceAliases) + 1
    });
    const countsBeforeActionableTerminal = await signalResolutionMutationCounts();
    const actionableTerminalResult = await signalTerminalDecisionA.applySignalTerminalDecision(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      referenceRefreshMessageId,
      referenceRefreshLease.capabilityToken,
      resolutionPlanNow + 5_000
    );
    assert.equal(actionableTerminalResult.outcome, "continue_downstream");
    assert.equal(actionableTerminalResult.decisionOutcome, "");
    assert.equal(actionableTerminalResult.sourceReferenceOutcome, "already_current");
    assert.equal(actionableTerminalResult.occurrenceAction, "none");
    assert.equal(actionableTerminalResult.missionDecisionAction, "none");
    assert.equal(actionableTerminalResult.auditAction, "none");
    assert.equal(actionableTerminalResult.outboxAction, "none");
    assert.equal(actionableTerminalResult.mutationStatementCount, 0);
    assert.equal(actionableTerminalResult.terminalDecisionApplyApplied, false);
    assert.equal(actionableTerminalResult.continueDownstream, true);
    assert.equal(actionableTerminalResult.terminalSignalGraphMutated, false);
    assert.equal(actionableTerminalResult.remainingDownstreamSignalGraphMutated, false);
    assert.deepEqual(await signalResolutionMutationCounts(), countsBeforeActionableTerminal);
    await assert.rejects(
      signalOfferIncidentA.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        wrongReferenceCapability,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalOfferIncidentB.applySignalOfferIncident(
        { tenantId: "tenant_local", userId: "user_local" },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalOfferIncidentC.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalOfferIncidentUnmapped.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /tenant session principal is not active/
    );
    const countsBeforeOfferIncident = await signalResolutionMutationCounts();
    const concurrentOfferIncident = await Promise.all([
      signalOfferIncidentA.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      signalOfferIncidentASecond.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      )
    ]);
    const offerIncidentWinner = concurrentOfferIncident.find(
      (result) => result.offerIncidentApplyApplied
    );
    const offerIncidentReplay = concurrentOfferIncident.find(
      (result) => !result.offerIncidentApplyApplied
    );
    assert.ok(offerIncidentWinner);
    assert.ok(offerIncidentReplay);
    assert.equal(offerIncidentWinner.outcome, "apply_offer_incident");
    assert.equal(offerIncidentWinner.terminalDecisionOutcome, "continue_downstream");
    assert.equal(offerIncidentWinner.offerObservationAction, "insert");
    assert.equal(offerIncidentWinner.incidentAction, "insert");
    assert.equal(offerIncidentWinner.occurrenceAction, "insert");
    assert.equal(offerIncidentWinner.mutationStatementCount, 3);
    assert.equal(offerIncidentWinner.continueDownstream, true);
    assert.equal(offerIncidentWinner.incidentsMutated, true);
    assert.equal(offerIncidentWinner.offersMutated, true);
    assert.equal(offerIncidentWinner.offerIncidentGraphMutated, true);
    assert.equal(offerIncidentWinner.remainingMissionActionGraphMutated, false);
    assert.equal(offerIncidentWinner.sharedCatalogMutated, false);
    assert.equal(offerIncidentWinner.sourceReferencesMutated, false);
    assert.equal(offerIncidentWinner.terminalDecisionsMutated, false);
    assert.equal(offerIncidentWinner.missionsMutated, false);
    assert.equal(offerIncidentWinner.actionsMutated, false);
    assert.equal(offerIncidentWinner.inboxLifecycleMutated, false);
    assert.equal(offerIncidentWinner.rawSignalPayloadReturned, false);
    assert.match(offerIncidentWinner.offerObservationId, /^offer_observation_[a-f0-9]{32}$/);
    assert.match(offerIncidentWinner.incidentId, /^incident_[a-f0-9]{32}$/);
    assert.match(offerIncidentWinner.semanticKey, /^[a-f0-9]{64}$/);
    assert.equal(offerIncidentReplay.outcome, "already_applied");
    assert.equal(offerIncidentReplay.offerObservationAction, "none");
    assert.equal(offerIncidentReplay.incidentAction, "none");
    assert.equal(offerIncidentReplay.occurrenceAction, "none");
    assert.equal(offerIncidentReplay.mutationStatementCount, 0);
    assert.equal(offerIncidentReplay.incidentId, offerIncidentWinner.incidentId);
    assert.equal(offerIncidentReplay.offerObservationId, offerIncidentWinner.offerObservationId);
    assert.equal(
      offerIncidentWinner.semanticKey,
      stableHash(
        offerIncidentWinner.listingId,
        "restock",
        1199,
        "USD",
        "first_party",
        "target",
        (referenceRefreshPayload.offer as Record<string, unknown>).offerFingerprint as string
      )
    );
    assert.equal(JSON.stringify(concurrentOfferIncident).includes("Target"), false);
    assert.equal(JSON.stringify(concurrentOfferIncident).includes("unitPriceCents"), false);
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...countsBeforeOfferIncident,
      signalOccurrences: Number(countsBeforeOfferIncident.signalOccurrences) + 1,
      signalIncidents: Number(countsBeforeOfferIncident.signalIncidents) + 1,
      offerObservations: Number(countsBeforeOfferIncident.offerObservations) + 1
    });
    await assert.rejects(
      signalPostIncidentDecisionA.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        wrongReferenceCapability,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalPostIncidentDecisionB.applySignalPostIncidentDecision(
        { tenantId: "tenant_local", userId: "user_local" },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalPostIncidentDecisionC.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalPostIncidentDecisionUnmapped.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /tenant session principal is not active/
    );
    const countsBeforePostIncidentContinuation = await signalResolutionMutationCounts();
    const postIncidentContinuation =
      await signalPostIncidentDecisionA.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      );
    assert.equal(postIncidentContinuation.outcome, "continue_downstream");
    assert.equal(postIncidentContinuation.decisionOutcome, "");
    assert.equal(postIncidentContinuation.offerIncidentOutcome, "already_applied");
    assert.equal(postIncidentContinuation.missionId, "mission_cutover_other");
    assert.equal(postIncidentContinuation.actionJobId, "");
    assert.equal(postIncidentContinuation.missionBindingRequired, true);
    assert.equal(postIncidentContinuation.missionCreationRequired, false);
    assert.equal(postIncidentContinuation.missionDecisionAction, "none");
    assert.equal(postIncidentContinuation.auditAction, "none");
    assert.equal(postIncidentContinuation.outboxAction, "none");
    assert.equal(postIncidentContinuation.mutationStatementCount, 0);
    assert.equal(postIncidentContinuation.postIncidentDecisionApplyApplied, false);
    assert.equal(postIncidentContinuation.continueDownstream, true);
    assert.equal(postIncidentContinuation.postIncidentDecisionGraphMutated, false);
    assert.equal(postIncidentContinuation.remainingMissionActionGraphMutated, false);
    assert.deepEqual(
      await signalResolutionMutationCounts(),
      countsBeforePostIncidentContinuation
    );
    await assert.rejects(
      signalMissionBindingA.applySignalMissionBinding(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        wrongReferenceCapability,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalMissionBindingB.applySignalMissionBinding(
        { tenantId: "tenant_local", userId: "user_local" },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalMissionBindingC.applySignalMissionBinding(
        { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalMissionBindingUnmapped.applySignalMissionBinding(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /tenant session principal is not active/
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."missions"
       SET target_quantity = 3
       WHERE id = 'mission_cutover_other'`
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."mission_targets"(
         id, mission_id, listing_id, created_at, updated_at
       ) VALUES (
         'native_mission_binding_existing_target', 'mission_cutover_other',
         'listing_native_signal', $1, $1
       )`,
      [new Date(resolutionPlanNow + 5_000).toISOString()]
    );
    const existingTargetIdsBeforeBinding = new Set(
      (await first.query<{ id: string }>(
        `SELECT id FROM "${NATIVE_SCHEMA}"."mission_targets"
         WHERE mission_id = 'mission_cutover_other'`
      )).rows.map((row) => row.id)
    );
    const concurrentExistingMissionBinding = await Promise.all([
      signalMissionBindingA.applySignalMissionBinding(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      signalMissionBindingASecond.applySignalMissionBinding(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      )
    ]);
    const existingBindingWinner = concurrentExistingMissionBinding.find(
      (result) => result.missionBindingApplyApplied
    );
    const existingBindingReplay = concurrentExistingMissionBinding.find(
      (result) => !result.missionBindingApplyApplied
    );
    assert.ok(existingBindingWinner);
    assert.ok(existingBindingReplay);
    assert.equal(existingBindingWinner.outcome, "apply_mission_binding");
    assert.equal(existingBindingWinner.missionId, "mission_cutover_other");
    assert.equal(existingBindingWinner.missionCreated, false);
    assert.ok(existingBindingWinner.targetsInserted >= 1);
    assert.equal(existingBindingWinner.initialPolicyCreated, true);
    assert.equal(existingBindingWinner.policyQuantity, 3);
    assert.equal(existingBindingWinner.missionAction, "none");
    assert.equal(existingBindingWinner.missionTargetAction, "insert");
    assert.equal(existingBindingWinner.policyRevisionAction, "insert");
    assert.equal(
      existingBindingWinner.mutationStatementCount,
      existingBindingWinner.targetsInserted + 3
    );
    assert.equal(
      existingBindingWinner.mutationRowCount,
      existingBindingWinner.targetsInserted + 3
    );
    assert.equal(existingBindingWinner.continueDownstream, true);
    assert.equal(existingBindingWinner.missionsMutated, false);
    assert.equal(existingBindingWinner.missionTargetsMutated, true);
    assert.equal(existingBindingWinner.purchasePoliciesMutated, true);
    assert.equal(existingBindingWinner.actionsMutated, false);
    assert.equal(existingBindingWinner.spendMutated, false);
    assert.equal(existingBindingWinner.inboxLifecycleMutated, false);
    assert.equal(existingBindingReplay.outcome, "already_bound");
    assert.equal(existingBindingReplay.missionId, existingBindingWinner.missionId);
    assert.equal(existingBindingReplay.missionTargetId, existingBindingWinner.missionTargetId);
    assert.equal(existingBindingReplay.policyRevisionId, existingBindingWinner.policyRevisionId);
    assert.equal(existingBindingReplay.policyQuantity, 3);
    assert.equal(existingBindingReplay.targetsInserted, 0);
    assert.equal(existingBindingReplay.mutationStatementCount, 0);
    const insertedExistingMissionTargetIds = (await first.query<{ id: string }>(
      `SELECT id FROM "${NATIVE_SCHEMA}"."mission_targets"
       WHERE mission_id = 'mission_cutover_other'`
    )).rows.map((row) => row.id).filter((id) => !existingTargetIdsBeforeBinding.has(id));
    assert.equal(insertedExistingMissionTargetIds.length, existingBindingWinner.targetsInserted);
    assert.deepEqual(
      (await first.query<{ quantity: number }>(
        `SELECT quantity FROM "${NATIVE_SCHEMA}"."mission_intent_revisions"
         WHERE id = $1`,
        [existingBindingWinner.policyRevisionId]
      )).rows.map((row) => Number(row.quantity)),
      [3]
    );
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."mission_targets" WHERE id = ANY($1::text[])`,
      [insertedExistingMissionTargetIds]
    );
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."mission_targets"
       WHERE id = 'native_mission_binding_existing_target'`
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."source_connections"
       SET auto_create_missions = 0 WHERE id = 'native_signal_source_a'`
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."audit_events"(
         id, tenant_id, user_id, correlation_id, event_type,
         reason_code, message, data_json, created_at
       ) VALUES (
         'audit_native_post_partial', $1, $2, $3, 'signal_decided',
         'partial', 'partial', '{}', $4
       )`,
      [
        NATIVE_TENANT,
        NATIVE_USER,
        referenceRefreshPayload.signalId,
        new Date(resolutionPlanNow + 5_000).toISOString()
      ]
    );
    await assert.rejects(
      signalPostIncidentDecisionA.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /partial post-incident decision fails closed/
    );
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."audit_events" WHERE id = 'audit_native_post_partial'`
    );
    const countsBeforeNoMissionDecision = await signalResolutionMutationCounts();
    const concurrentNoMissionDecision = await Promise.all([
      signalPostIncidentDecisionA.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      signalPostIncidentDecisionASecond.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      )
    ]);
    const noMissionWinner = concurrentNoMissionDecision.find(
      (result) => result.postIncidentDecisionApplyApplied
    );
    const noMissionReplay = concurrentNoMissionDecision.find(
      (result) => !result.postIncidentDecisionApplyApplied
    );
    assert.ok(noMissionWinner);
    assert.ok(noMissionReplay);
    assert.equal(noMissionWinner.outcome, "apply_post_incident_decision");
    assert.equal(noMissionWinner.decisionOutcome, "no_mission");
    assert.equal(noMissionWinner.missionId, "");
    assert.equal(noMissionWinner.actionJobId, "");
    assert.equal(noMissionWinner.missionBindingRequired, false);
    assert.equal(noMissionWinner.missionCreationRequired, false);
    assert.equal(noMissionWinner.missionDecisionAction, "insert");
    assert.equal(noMissionWinner.auditAction, "insert");
    assert.equal(noMissionWinner.outboxAction, "insert");
    assert.equal(noMissionWinner.mutationStatementCount, 3);
    assert.equal(noMissionWinner.postIncidentDecisionGraphMutated, true);
    assert.equal(noMissionWinner.sharedCatalogMutated, false);
    assert.equal(noMissionWinner.sourceReferencesMutated, false);
    assert.equal(noMissionWinner.terminalDecisionsMutated, false);
    assert.equal(noMissionWinner.offerIncidentGraphMutated, false);
    assert.equal(noMissionWinner.incidentsMutated, false);
    assert.equal(noMissionWinner.missionsMutated, false);
    assert.equal(noMissionWinner.actionsMutated, false);
    assert.equal(noMissionWinner.inboxLifecycleMutated, false);
    assert.equal(noMissionWinner.rawSignalPayloadReturned, false);
    assert.equal(noMissionReplay.outcome, "already_decided");
    assert.equal(noMissionReplay.decisionOutcome, "no_mission");
    assert.equal(noMissionReplay.missionDecisionAction, "none");
    assert.equal(noMissionReplay.auditAction, "none");
    assert.equal(noMissionReplay.outboxAction, "none");
    assert.equal(noMissionReplay.mutationStatementCount, 0);
    assert.equal(noMissionReplay.postIncidentDecisionGraphMutated, false);
    assert.equal(JSON.stringify(concurrentNoMissionDecision).includes("Target"), false);
    assert.equal(JSON.stringify(concurrentNoMissionDecision).includes("unitPriceCents"), false);
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...countsBeforeNoMissionDecision,
      missionDecisions: Number(countsBeforeNoMissionDecision.missionDecisions) + 1,
      auditEvents: Number(countsBeforeNoMissionDecision.auditEvents) + 1,
      outboxEvents: Number(countsBeforeNoMissionDecision.outboxEvents) + 1
    });
    const storedNoMissionDecision = (await first.query<{
      decisionId: string;
      incidentId: string;
      missionId: string | null;
      decisionSource: string;
      outcome: string;
      reason: string;
      effectiveAction: string;
      effectiveQuantity: number;
      effectiveUnitCapCents: number | null;
      auditId: string;
      reasonCode: string;
      auditMessage: string;
      auditData: string;
      outboxPayload: string;
      decisionCreatedAt: string;
      auditCreatedAt: string;
      outboxCreatedAt: string;
    }>(
      `SELECT decision.id AS "decisionId", decision.incident_id AS "incidentId",
              decision.mission_id AS "missionId", decision.decision_source AS "decisionSource",
              decision.outcome, decision.reason, decision.effective_action AS "effectiveAction",
              decision.effective_quantity AS "effectiveQuantity",
              decision.effective_unit_cap_cents AS "effectiveUnitCapCents",
              audit.id AS "auditId", audit.reason_code AS "reasonCode",
              audit.message AS "auditMessage", audit.data_json AS "auditData",
              outbox.payload_json AS "outboxPayload",
              decision.created_at AS "decisionCreatedAt",
              audit.created_at AS "auditCreatedAt", outbox.created_at AS "outboxCreatedAt"
       FROM "${NATIVE_SCHEMA}"."mission_decisions" AS decision
       JOIN "${NATIVE_SCHEMA}"."signal_events" AS event ON event.id = decision.event_id
       JOIN "${NATIVE_SCHEMA}"."audit_events" AS audit
         ON audit.correlation_id = event.signal_id AND audit.event_type = 'signal_decided'
       JOIN "${NATIVE_SCHEMA}"."outbox_events" AS outbox
         ON outbox.aggregate_id = event.signal_id AND outbox.event_type = 'signal_decided'
       WHERE decision.event_id = $1`,
      [referenceResolutionResult.eventId]
    )).rows[0]!;
    assert.match(storedNoMissionDecision.decisionId, /^mission_decision_[a-f0-9]{32}$/);
    assert.deepEqual({
      incidentId: storedNoMissionDecision.incidentId,
      missionId: storedNoMissionDecision.missionId,
      decisionSource: storedNoMissionDecision.decisionSource,
      outcome: storedNoMissionDecision.outcome,
      effectiveAction: storedNoMissionDecision.effectiveAction,
      effectiveQuantity: Number(storedNoMissionDecision.effectiveQuantity),
      effectiveUnitCapCents: storedNoMissionDecision.effectiveUnitCapCents,
      reasonCode: storedNoMissionDecision.reasonCode,
      auditMessage: storedNoMissionDecision.auditMessage,
      auditData: JSON.parse(storedNoMissionDecision.auditData)
    }, {
      incidentId: offerIncidentWinner.incidentId,
      missionId: null,
      decisionSource: "strategy",
      outcome: "no_mission",
      effectiveAction: "notify",
      effectiveQuantity: 1,
      effectiveUnitCapCents: null,
      reasonCode: "no_mission",
      auditMessage: storedNoMissionDecision.reason,
      auditData: {
        incidentId: offerIncidentWinner.incidentId,
        listingId: "listing_native_signal"
      }
    });
    assert.equal(
      storedNoMissionDecision.decisionCreatedAt,
      storedNoMissionDecision.auditCreatedAt
    );
    assert.equal(
      storedNoMissionDecision.decisionCreatedAt,
      storedNoMissionDecision.outboxCreatedAt
    );
    assert.deepEqual(JSON.parse(storedNoMissionDecision.outboxPayload), {
      auditId: storedNoMissionDecision.auditId,
      correlationId: referenceRefreshPayload.signalId,
      reasonCode: "no_mission",
      message: storedNoMissionDecision.reason,
      data: {
        incidentId: offerIncidentWinner.incidentId,
        listingId: "listing_native_signal"
      }
    });
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."mission_decisions"
       SET effective_quantity = 2 WHERE event_id = $1`,
      [referenceResolutionResult.eventId]
    );
    await assert.rejects(
      signalPostIncidentDecisionA.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /existing post-incident decision is inconsistent/
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."mission_decisions"
       SET effective_quantity = 1 WHERE event_id = $1`,
      [referenceResolutionResult.eventId]
    );
    assert.equal(
      (await signalPostIncidentDecisionA.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      )).outcome,
      "already_decided"
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."source_connections"
       SET auto_create_missions = 1 WHERE id = 'native_signal_source_a'`
    );
    const storedOfferIncident = (await first.query<{
      observationId: string;
      observationListingId: string;
      observationSourceConnectionId: string;
      availability: string;
      unitPriceCents: number;
      currency: string;
      sellerName: string;
      sellerType: string;
      orderLimit: number;
      offerFingerprint: string;
      observationObservedAt: string;
      observationCreatedAt: string;
      occurrenceId: string;
      occurrenceSourceConnectionId: string;
      occurrenceObservedAt: string;
      occurrenceReceivedAt: string;
      occurrenceCreatedAt: string;
      incidentId: string;
      tenantId: string;
      userId: string;
      incidentListingId: string;
      eventType: string;
      semanticKey: string;
      status: string;
      occurrenceCount: number;
      firstObservedAt: string;
      lastObservedAt: string;
    }>(
      `SELECT observation.id AS "observationId",
              observation.listing_id AS "observationListingId",
              observation.source_connection_id AS "observationSourceConnectionId",
              observation.availability,
              observation.unit_price_cents AS "unitPriceCents",
              observation.currency, observation.seller_name AS "sellerName",
              observation.seller_type AS "sellerType",
              observation.order_limit AS "orderLimit",
              observation.offer_fingerprint AS "offerFingerprint",
              observation.observed_at AS "observationObservedAt",
              observation.created_at AS "observationCreatedAt",
              occurrence.id AS "occurrenceId",
              occurrence.source_connection_id AS "occurrenceSourceConnectionId",
              occurrence.observed_at AS "occurrenceObservedAt",
              occurrence.received_at AS "occurrenceReceivedAt",
              occurrence.created_at AS "occurrenceCreatedAt",
              incident.id AS "incidentId", incident.tenant_id AS "tenantId",
              incident.user_id AS "userId", incident.listing_id AS "incidentListingId",
              incident.event_type AS "eventType", incident.semantic_key AS "semanticKey",
              incident.status, incident.occurrence_count AS "occurrenceCount",
              incident.first_observed_at AS "firstObservedAt",
              incident.last_observed_at AS "lastObservedAt"
       FROM "${NATIVE_SCHEMA}"."signal_occurrences" AS occurrence
       JOIN "${NATIVE_SCHEMA}"."signal_incidents" AS incident
         ON incident.id = occurrence.incident_id
       JOIN "${NATIVE_SCHEMA}"."offer_observations" AS observation
         ON observation.id = $2
       WHERE occurrence.event_id = $1`,
      [referenceResolutionResult.eventId, offerIncidentWinner.offerObservationId]
    )).rows[0]!;
    assert.deepEqual({
      ...storedOfferIncident,
      unitPriceCents: Number(storedOfferIncident.unitPriceCents),
      orderLimit: Number(storedOfferIncident.orderLimit),
      occurrenceCount: Number(storedOfferIncident.occurrenceCount)
    }, {
      observationId: offerIncidentWinner.offerObservationId,
      observationListingId: "listing_native_signal",
      observationSourceConnectionId: "native_signal_source_a",
      availability: "in_stock",
      unitPriceCents: 1199,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      orderLimit: 1,
      offerFingerprint: (referenceRefreshPayload.offer as Record<string, unknown>).offerFingerprint,
      observationObservedAt: referenceRefreshPayload.observedAt,
      observationCreatedAt: storedOfferIncident.observationCreatedAt,
      occurrenceId: `occurrence_${stableHash(
        "postgres_signal_offer_occurrence_id_v1",
        referenceResolutionResult.eventId
      ).slice(0, 32)}`,
      occurrenceSourceConnectionId: "native_signal_source_a",
      occurrenceObservedAt: referenceRefreshPayload.observedAt,
      occurrenceReceivedAt: referenceRefreshPayload.receivedAt,
      occurrenceCreatedAt: storedOfferIncident.observationCreatedAt,
      incidentId: offerIncidentWinner.incidentId,
      tenantId: NATIVE_TENANT,
      userId: NATIVE_USER,
      incidentListingId: "listing_native_signal",
      eventType: "restock",
      semanticKey: offerIncidentWinner.semanticKey,
      status: "open",
      occurrenceCount: 1,
      firstObservedAt: referenceRefreshPayload.observedAt,
      lastObservedAt: referenceRefreshPayload.observedAt
    });
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."offer_observations"
       SET seller_name = 'Corrupt' WHERE id = $1`,
      [offerIncidentWinner.offerObservationId]
    );
    await assert.rejects(
      signalOfferIncidentA.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      /existing offer-incident graph is inconsistent/
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."offer_observations"
       SET seller_name = 'Target' WHERE id = $1`,
      [offerIncidentWinner.offerObservationId]
    );
    assert.equal(
      (await signalOfferIncidentA.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      )).outcome,
      "already_applied"
    );
    assert.deepEqual(
      (await first.query<{
        productRefId: string;
        productVariantId: string;
        productSourceUrl: string;
        productTitle: string;
        productObservedAt: string;
        listingRefId: string;
        listingId: string;
        listingProductId: string;
        listingSourceUrl: string;
        listingObservedAt: string;
        aliasId: string;
        aliasVariantId: string;
        aliasObservedAt: string;
      }>(
        `SELECT product_ref.id AS "productRefId",
                product_ref.variant_id AS "productVariantId",
                product_ref.source_url AS "productSourceUrl",
                product_ref.source_title AS "productTitle",
                product_ref.observed_at AS "productObservedAt",
                listing_ref.id AS "listingRefId",
                listing_ref.listing_id AS "listingId",
                listing_ref.external_product_id AS "listingProductId",
                listing_ref.source_url AS "listingSourceUrl",
                listing_ref.observed_at AS "listingObservedAt",
                alias.id AS "aliasId", alias.variant_id AS "aliasVariantId",
                alias.observed_at AS "aliasObservedAt"
         FROM "${NATIVE_SCHEMA}"."source_product_refs" AS product_ref
         JOIN "${NATIVE_SCHEMA}"."source_listing_refs" AS listing_ref
           ON listing_ref.source_connection_id = product_ref.source_connection_id
          AND listing_ref.external_product_id = product_ref.external_product_id
         JOIN "${NATIVE_SCHEMA}"."source_product_aliases" AS alias
           ON alias.source_connection_id = product_ref.source_connection_id
          AND alias.variant_id = product_ref.variant_id
         WHERE product_ref.source_connection_id = 'native_signal_source_a'
           AND product_ref.external_product_id = 'native-reference-product-a'
           AND listing_ref.external_listing_id = 'native-reference-listing-a'
           AND alias.alias_kind = 'trackalacker_slug'
           AND alias.alias_value = 'native-reference-product-a'`
      )).rows.map((row) => ({
        ...row,
        productRefId: row.productRefId.replace(/^source_product_[a-f0-9]{32}$/, "source_product_<uuid>"),
        listingRefId: row.listingRefId.replace(/^source_listing_[a-f0-9]{32}$/, "source_listing_<uuid>"),
        aliasId: row.aliasId.replace(/^source_alias_[a-f0-9]{32}$/, "source_alias_<uuid>")
      })),
      [{
        productRefId: "source_product_<uuid>",
        productVariantId: "variant_cutover_scope",
        productSourceUrl: "",
        productTitle: "Native reference product",
        productObservedAt: referenceRefreshObservedAt,
        listingRefId: "source_listing_<uuid>",
        listingId: "listing_native_signal",
        listingProductId: "native-reference-product-a",
        listingSourceUrl: "",
        listingObservedAt: referenceRefreshObservedAt,
        aliasId: "source_alias_<uuid>",
        aliasVariantId: "variant_cutover_scope",
        aliasObservedAt: referenceRefreshObservedAt
      }]
    );
    const referenceReplayCounts = await signalResolutionMutationCounts();
    const explicitReferenceReplay = await signalSourceReferenceA.refreshSignalSourceReferences(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      referenceRefreshMessageId,
      referenceRefreshLease.capabilityToken,
      resolutionPlanNow + 5_000
    );
    assert.equal(explicitReferenceReplay.outcome, "already_current");
    assert.equal(explicitReferenceReplay.mutationStatementCount, 0);
    assert.deepEqual(await signalResolutionMutationCounts(), referenceReplayCounts);
    assert.equal(
      (await first.query<{ state: string }>(
        `SELECT state FROM "${NATIVE_SCHEMA}"."inbox_messages" WHERE id = $1`,
        [referenceRefreshMessageId]
      )).rows[0]?.state,
      "processing"
    );
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceRefreshMessageId,
        referenceRefreshLease.capabilityToken,
        resolutionPlanNow + 5_000
      ),
      true
    );

    const referenceUpdateMessageId = "inbox_ffffffffffffffffffffffffffffffff";
    const referenceUpdatePayloadBase = resolutionSignalPayload(
      referenceUpdateMessageId,
      "native_signal_source_a",
      {
        sourceProductId: "native-reference-product-a",
        sourceListingId: "native-reference-listing-a",
        retailerId: "target",
        retailerSku: "NATIVE-SIGNAL-SKU",
        canonicalUrl: "https://www.target.com/p/native-signal/NATIVE-SIGNAL-SKU",
        title: "Native reference product updated"
      }
    );
    const referenceUpdateObservedAt = new Date(signalLifecycleNow + 1_000).toISOString();
    const referenceUpdatePayload: Record<string, unknown> = {
      ...referenceUpdatePayloadBase,
      observedAt: referenceUpdateObservedAt,
      offer: referenceRefreshPayload.offer,
      identity: {
        ...(referenceUpdatePayloadBase.identity as Record<string, unknown>),
        globalIdentifiers: { trackalacker_slug: "native-reference-product-a" }
      }
    };
    await insertSignalLifecycleInbox(
      referenceUpdateMessageId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow + 6_000).toISOString(),
      referenceUpdatePayload
    );
    const referenceUpdateLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow + 6_000
    );
    assert.ok(referenceUpdateLease);
    assert.equal(referenceUpdateLease.id, referenceUpdateMessageId);
    const referenceUpdateResolution = await signalResolutionApplyA.applySignalEventResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      referenceUpdateMessageId,
      referenceUpdateLease.capabilityToken,
      resolutionPlanNow + 6_000
    );
    assert.equal(referenceUpdateResolution.duplicate, false);
    const countsBeforeReferenceUpdate = await signalResolutionMutationCounts();
    const referenceUpdateResult = await signalSourceReferenceA.refreshSignalSourceReferences(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      referenceUpdateMessageId,
      referenceUpdateLease.capabilityToken,
      resolutionPlanNow + 6_000
    );
    assert.equal(referenceUpdateResult.outcome, "refresh");
    assert.equal(referenceUpdateResult.sourceProductAction, "update");
    assert.equal(referenceUpdateResult.sourceListingAction, "update");
    assert.equal(referenceUpdateResult.sourceAliasAction, "update");
    assert.equal(referenceUpdateResult.mutationStatementCount, 3);
    assert.equal(referenceUpdateResult.sourceReferenceRefreshApplied, true);
    assert.deepEqual(await signalResolutionMutationCounts(), countsBeforeReferenceUpdate);
    const referenceUpdateTerminal = await signalTerminalDecisionA.applySignalTerminalDecision(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      referenceUpdateMessageId,
      referenceUpdateLease.capabilityToken,
      resolutionPlanNow + 6_000
    );
    assert.equal(referenceUpdateTerminal.outcome, "continue_downstream");
    assert.equal(referenceUpdateTerminal.mutationStatementCount, 0);
    const partialOfferObservationId = `offer_observation_${stableHash(
      "postgres_signal_offer_observation_id_v1",
      referenceUpdateResolution.eventId
    ).slice(0, 32)}`;
    const partialOffer = referenceUpdatePayload.offer as Record<string, unknown>;
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."offer_observations"(
         id, listing_id, source_connection_id, availability, unit_price_cents,
         currency, seller_name, seller_type, order_limit, offer_fingerprint,
         observed_at, created_at
       ) VALUES ($1, 'listing_native_signal', 'native_signal_source_a',
                 $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        partialOfferObservationId,
        partialOffer.availability,
        partialOffer.unitPriceCents,
        partialOffer.currency,
        partialOffer.sellerName,
        partialOffer.sellerType,
        partialOffer.orderLimit,
        partialOffer.offerFingerprint,
        referenceUpdatePayload.observedAt,
        new Date(resolutionPlanNow + 6_000).toISOString()
      ]
    );
    await assert.rejects(
      signalOfferIncidentA.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceUpdateMessageId,
        referenceUpdateLease.capabilityToken,
        resolutionPlanNow + 6_000
      ),
      /partial offer-incident graph fails closed/
    );
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."offer_observations" WHERE id = $1`,
      [partialOfferObservationId]
    );
    const countsBeforeCorroboration = await signalResolutionMutationCounts();
    const corroborationResult = await signalOfferIncidentA.applySignalOfferIncident(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      referenceUpdateMessageId,
      referenceUpdateLease.capabilityToken,
      resolutionPlanNow + 6_000
    );
    assert.equal(corroborationResult.outcome, "apply_offer_incident");
    assert.equal(corroborationResult.offerObservationAction, "insert");
    assert.equal(corroborationResult.incidentAction, "update");
    assert.equal(corroborationResult.occurrenceAction, "insert");
    assert.equal(corroborationResult.mutationStatementCount, 3);
    assert.equal(corroborationResult.incidentId, offerIncidentWinner.incidentId);
    assert.equal(corroborationResult.semanticKey, offerIncidentWinner.semanticKey);
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...countsBeforeCorroboration,
      signalOccurrences: Number(countsBeforeCorroboration.signalOccurrences) + 1,
      offerObservations: Number(countsBeforeCorroboration.offerObservations) + 1
    });
    assert.deepEqual(
      (await first.query<{
        occurrenceCount: number;
        firstObservedAt: string;
        lastObservedAt: string;
        linkedOccurrences: number;
      }>(
        `SELECT incident.occurrence_count AS "occurrenceCount",
                incident.first_observed_at AS "firstObservedAt",
                incident.last_observed_at AS "lastObservedAt",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."signal_occurrences" AS occurrence
                 WHERE occurrence.incident_id = incident.id) AS "linkedOccurrences"
         FROM "${NATIVE_SCHEMA}"."signal_incidents" AS incident WHERE incident.id = $1`,
        [offerIncidentWinner.incidentId]
      )).rows.map((row) => ({
        ...row,
        occurrenceCount: Number(row.occurrenceCount),
        linkedOccurrences: Number(row.linkedOccurrences)
      })),
      [{
        occurrenceCount: 2,
        firstObservedAt: referenceRefreshPayload.observedAt,
        lastObservedAt: referenceUpdatePayload.observedAt,
        linkedOccurrences: 2
      }]
    );
    const countsBeforeCorroborationReplay = await signalResolutionMutationCounts();
    const corroborationReplay = await signalOfferIncidentA.applySignalOfferIncident(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      referenceUpdateMessageId,
      referenceUpdateLease.capabilityToken,
      resolutionPlanNow + 6_000
    );
    assert.equal(corroborationReplay.outcome, "already_applied");
    assert.equal(corroborationReplay.mutationStatementCount, 0);
    assert.equal(corroborationReplay.incidentId, offerIncidentWinner.incidentId);
    assert.deepEqual(await signalResolutionMutationCounts(), countsBeforeCorroborationReplay);
    const postIncidentFixtureAt = new Date(resolutionPlanNow + 6_000).toISOString();
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."mission_targets"(
         id, mission_id, listing_id, created_at, updated_at
       ) VALUES (
         'native_post_incident_target', 'mission_cutover_other',
         'listing_native_signal', $1, $1
       )`,
      [postIncidentFixtureAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."action_jobs"(
         id, tenant_id, user_id, mission_id, mission_target_id, incident_id,
         state, action, quantity, seller_policy, fulfillment, listing_id,
         canonical_url, idempotency_key, capability_nonce_hash, expires_at,
         created_at, updated_at
       ) VALUES (
         'native_post_incident_action', $1, $2, 'mission_cutover_other',
         'native_post_incident_target', $3, 'awaiting_executor', 'notify', 1,
         'any', 'shipping', 'listing_native_signal',
         'https://www.target.com/p/native-signal/NATIVE-SIGNAL-SKU',
         'native-post-incident-action', 'native-post-incident-capability', $4, $5, $5
       )`,
      [
        NATIVE_TENANT,
        NATIVE_USER,
        corroborationResult.incidentId,
        new Date(resolutionPlanNow + 3_606_000).toISOString(),
        postIncidentFixtureAt
      ]
    );
    const countsBeforeCorroboratedDecision = await signalResolutionMutationCounts();
    const concurrentCorroboratedDecision = await Promise.all([
      signalPostIncidentDecisionA.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceUpdateMessageId,
        referenceUpdateLease.capabilityToken,
        resolutionPlanNow + 6_000
      ),
      signalPostIncidentDecisionASecond.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceUpdateMessageId,
        referenceUpdateLease.capabilityToken,
        resolutionPlanNow + 6_000
      )
    ]);
    const corroboratedWinner = concurrentCorroboratedDecision.find(
      (result) => result.postIncidentDecisionApplyApplied
    );
    const corroboratedReplay = concurrentCorroboratedDecision.find(
      (result) => !result.postIncidentDecisionApplyApplied
    );
    assert.ok(corroboratedWinner);
    assert.ok(corroboratedReplay);
    assert.equal(corroboratedWinner.outcome, "apply_post_incident_decision");
    assert.equal(corroboratedWinner.decisionOutcome, "corroborated");
    assert.equal(corroboratedWinner.offerIncidentOutcome, "already_applied");
    assert.equal(corroboratedWinner.missionId, "mission_cutover_other");
    assert.equal(corroboratedWinner.actionJobId, "native_post_incident_action");
    assert.equal(corroboratedWinner.missionBindingRequired, false);
    assert.equal(corroboratedWinner.missionCreationRequired, false);
    assert.equal(corroboratedWinner.missionDecisionAction, "insert");
    assert.equal(corroboratedWinner.auditAction, "insert");
    assert.equal(corroboratedWinner.outboxAction, "insert");
    assert.equal(corroboratedWinner.mutationStatementCount, 3);
    assert.equal(corroboratedWinner.postIncidentDecisionApplyApplied, true);
    assert.equal(corroboratedWinner.continueDownstream, false);
    assert.equal(corroboratedWinner.postIncidentDecisionGraphMutated, true);
    assert.equal(corroboratedWinner.remainingMissionActionGraphMutated, false);
    assert.equal(corroboratedWinner.missionsMutated, false);
    assert.equal(corroboratedWinner.actionsMutated, false);
    assert.equal(corroboratedReplay.outcome, "already_decided");
    assert.equal(corroboratedReplay.decisionOutcome, "corroborated");
    assert.equal(corroboratedReplay.actionJobId, "native_post_incident_action");
    assert.equal(corroboratedReplay.mutationStatementCount, 0);
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...countsBeforeCorroboratedDecision,
      missionDecisions: Number(countsBeforeCorroboratedDecision.missionDecisions) + 1,
      auditEvents: Number(countsBeforeCorroboratedDecision.auditEvents) + 1,
      outboxEvents: Number(countsBeforeCorroboratedDecision.outboxEvents) + 1
    });
    assert.deepEqual(
      (await first.query<{
        missionId: string;
        incidentId: string;
        outcome: string;
        effectiveAction: string;
        effectiveQuantity: number;
        auditData: string;
      }>(
        `SELECT decision.mission_id AS "missionId",
                decision.incident_id AS "incidentId", decision.outcome,
                decision.effective_action AS "effectiveAction",
                decision.effective_quantity AS "effectiveQuantity",
                audit.data_json AS "auditData"
         FROM "${NATIVE_SCHEMA}"."mission_decisions" AS decision
         JOIN "${NATIVE_SCHEMA}"."signal_events" AS event ON event.id = decision.event_id
         JOIN "${NATIVE_SCHEMA}"."audit_events" AS audit
           ON audit.correlation_id = event.signal_id AND audit.event_type = 'signal_decided'
         WHERE decision.event_id = $1`,
        [referenceUpdateResolution.eventId]
      )).rows.map((row) => ({
        ...row,
        effectiveQuantity: Number(row.effectiveQuantity),
        auditData: JSON.parse(row.auditData)
      })),
      [{
        missionId: "mission_cutover_other",
        incidentId: corroborationResult.incidentId,
        outcome: "corroborated",
        effectiveAction: "notify",
        effectiveQuantity: 1,
        auditData: {
          incidentId: corroborationResult.incidentId,
          actionJobId: "native_post_incident_action"
        }
      }]
    );
    assert.deepEqual(
      (await first.query<{
        productTitle: string;
        productObservedAt: string;
        listingObservedAt: string;
        aliasObservedAt: string;
      }>(
        `SELECT product_ref.source_title AS "productTitle",
                product_ref.observed_at AS "productObservedAt",
                listing_ref.observed_at AS "listingObservedAt",
                alias.observed_at AS "aliasObservedAt"
         FROM "${NATIVE_SCHEMA}"."source_product_refs" AS product_ref
         JOIN "${NATIVE_SCHEMA}"."source_listing_refs" AS listing_ref
           ON listing_ref.source_connection_id = product_ref.source_connection_id
          AND listing_ref.external_product_id = product_ref.external_product_id
         JOIN "${NATIVE_SCHEMA}"."source_product_aliases" AS alias
           ON alias.source_connection_id = product_ref.source_connection_id
          AND alias.variant_id = product_ref.variant_id
         WHERE product_ref.source_connection_id = 'native_signal_source_a'
           AND product_ref.external_product_id = 'native-reference-product-a'
           AND listing_ref.external_listing_id = 'native-reference-listing-a'
           AND alias.alias_kind = 'trackalacker_slug'
           AND alias.alias_value = 'native-reference-product-a'`
      )).rows,
      [{
        productTitle: "Native reference product updated",
        productObservedAt: referenceUpdateObservedAt,
        listingObservedAt: referenceUpdateObservedAt,
        aliasObservedAt: referenceUpdateObservedAt
      }]
    );
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceUpdateMessageId,
        referenceUpdateLease.capabilityToken,
        resolutionPlanNow + 6_000
      ),
      true
    );

    const missionCreateMessageId = "inbox_fedcba9876543210fedcba9876543210";
    const missionCreateObservedAt = new Date(signalLifecycleNow + 1_250).toISOString();
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."variants"(
         id, family_id, title, attributes_json, created_at, updated_at
       ) VALUES (
         'variant_native_mission_create', 'family_cutover_scope',
         'Native mission creation product', '{}', $1, $1
       )`,
      [missionCreateObservedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."listings"(
         id, variant_id, retailer_id, retailer_sku, canonical_url, status,
         execution_supported, msrp_cents, currency, created_at, updated_at
       ) VALUES (
         'listing_native_mission_create', 'variant_native_mission_create', 'target',
         'NATIVE-MISSION-CREATE',
         'https://www.target.com/p/native-mission-create/NATIVE-MISSION-CREATE',
         'in_stock', 1, 1599, 'USD', $1, $1
       )`,
      [missionCreateObservedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."source_product_refs"(
         id, source_connection_id, external_product_id, variant_id,
         source_url, source_title, observed_at
       ) VALUES (
         'source_product_native_mission_create', 'native_signal_source_a',
         'native-mission-create-product', 'variant_native_mission_create',
         'https://trackalacker.example/native-mission-create-product',
         'Native mission creation product', $1
       )`,
      [missionCreateObservedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."source_listing_refs"(
         id, source_connection_id, external_listing_id, external_product_id,
         listing_id, source_url, observed_at
       ) VALUES (
         'source_listing_native_mission_create', 'native_signal_source_a',
         'native-mission-create-listing', 'native-mission-create-product',
         'listing_native_mission_create',
         'https://trackalacker.example/native-mission-create-listing', $1
       )`,
      [missionCreateObservedAt]
    );
    const missionCreatePayloadBase = resolutionSignalPayload(
      missionCreateMessageId,
      "native_signal_source_a",
      {
        sourceProductId: "native-mission-create-product",
        sourceListingId: "native-mission-create-listing",
        retailerId: "target",
        retailerSku: "NATIVE-MISSION-CREATE",
        canonicalUrl: "https://www.target.com/p/native-mission-create/NATIVE-MISSION-CREATE",
        title: "Native mission creation product"
      }
    );
    const missionCreatePayload = {
      ...missionCreatePayloadBase,
      observedAt: missionCreateObservedAt,
      identity: {
        ...(missionCreatePayloadBase.identity as Record<string, unknown>),
        globalIdentifiers: { trackalacker_slug: "native-mission-create-product" }
      }
    };
    await insertSignalLifecycleInbox(
      missionCreateMessageId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow + 6_250).toISOString(),
      missionCreatePayload
    );
    const missionCreateLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow + 6_250
    );
    assert.ok(missionCreateLease);
    assert.equal(missionCreateLease.id, missionCreateMessageId);
    const missionCreateResolution = await signalResolutionApplyA.applySignalEventResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      missionCreateMessageId,
      missionCreateLease.capabilityToken,
      resolutionPlanNow + 6_250
    );
    assert.equal(missionCreateResolution.duplicate, false);
    assert.match(
      missionCreateResolution.resolutionDecisionId,
      /^resolution_[a-f0-9]{32}$/
    );
    const missionCreateReference = await signalSourceReferenceA.refreshSignalSourceReferences(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      missionCreateMessageId,
      missionCreateLease.capabilityToken,
      resolutionPlanNow + 6_250
    );
    assert.equal(missionCreateReference.downstreamSignalGraphMutated, false);
    const missionCreateTerminal = await signalTerminalDecisionA.applySignalTerminalDecision(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      missionCreateMessageId,
      missionCreateLease.capabilityToken,
      resolutionPlanNow + 6_250
    );
    assert.equal(missionCreateTerminal.outcome, "continue_downstream");
    const missionCreateOfferIncident = await signalOfferIncidentA.applySignalOfferIncident(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      missionCreateMessageId,
      missionCreateLease.capabilityToken,
      resolutionPlanNow + 6_250
    );
    assert.equal(missionCreateOfferIncident.continueDownstream, true);
    const missionCreatePostIncident =
      await signalPostIncidentDecisionA.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        resolutionPlanNow + 6_250
      );
    assert.equal(missionCreatePostIncident.outcome, "continue_downstream");
    assert.equal(missionCreatePostIncident.missionId, "");
    assert.equal(missionCreatePostIncident.missionBindingRequired, true);
    assert.equal(missionCreatePostIncident.missionCreationRequired, true);
    const countsBeforeMissionCreation = await signalResolutionMutationCounts();
    const concurrentMissionCreation = await Promise.all([
      signalMissionBindingA.applySignalMissionBinding(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        resolutionPlanNow + 6_250
      ),
      signalMissionBindingASecond.applySignalMissionBinding(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        resolutionPlanNow + 6_250
      )
    ]);
    const missionCreateWinner = concurrentMissionCreation.find((result) => result.missionCreated);
    const missionCreateReplay = concurrentMissionCreation.find((result) => !result.missionCreated);
    assert.ok(missionCreateWinner);
    assert.ok(missionCreateReplay);
    assert.equal(missionCreateWinner.outcome, "apply_mission_binding");
    assert.match(missionCreateWinner.missionId, /^mission_[a-f0-9]{32}$/);
    assert.match(missionCreateWinner.missionTargetId, /^mission_target_[a-f0-9]{32}$/);
    assert.match(missionCreateWinner.policyRevisionId, /^intent_revision_[a-f0-9]{32}$/);
    assert.equal(missionCreateWinner.targetsInserted, 1);
    assert.equal(missionCreateWinner.initialPolicyCreated, true);
    assert.equal(missionCreateWinner.policyQuantity, 1);
    assert.equal(missionCreateWinner.variantListingCount, 1);
    assert.equal(missionCreateWinner.missionAction, "insert");
    assert.equal(missionCreateWinner.missionTargetAction, "insert");
    assert.equal(missionCreateWinner.policyRevisionAction, "insert");
    assert.equal(missionCreateWinner.missionAuditAction, "insert");
    assert.equal(missionCreateWinner.missionOutboxAction, "insert");
    assert.equal(missionCreateWinner.policyAuditAction, "insert");
    assert.equal(missionCreateWinner.policyOutboxAction, "insert");
    assert.equal(missionCreateWinner.mutationStatementCount, 7);
    assert.equal(missionCreateWinner.mutationRowCount, 7);
    assert.equal(missionCreateWinner.missionsMutated, true);
    assert.equal(missionCreateWinner.missionTargetsMutated, true);
    assert.equal(missionCreateWinner.purchasePoliciesMutated, true);
    assert.equal(missionCreateWinner.actionsMutated, false);
    assert.equal(missionCreateWinner.spendMutated, false);
    assert.equal(missionCreateWinner.inboxLifecycleMutated, false);
    assert.equal(missionCreateReplay.outcome, "already_bound");
    assert.equal(missionCreateReplay.missionId, missionCreateWinner.missionId);
    assert.equal(missionCreateReplay.missionTargetId, missionCreateWinner.missionTargetId);
    assert.equal(missionCreateReplay.policyRevisionId, missionCreateWinner.policyRevisionId);
    assert.equal(missionCreateReplay.mutationStatementCount, 0);
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...countsBeforeMissionCreation,
      missions: Number(countsBeforeMissionCreation.missions) + 1,
      missionTargets: Number(countsBeforeMissionCreation.missionTargets) + 1,
      auditEvents: Number(countsBeforeMissionCreation.auditEvents) + 2,
      outboxEvents: Number(countsBeforeMissionCreation.outboxEvents) + 2
    });
    const storedMissionBinding = (await first.query<{
      missionId: string;
      status: string;
      origin: string;
      targetQuantity: number;
      fulfilledQuantity: number;
      targetId: string;
      enabled: number;
      maxUnitPriceCents: number | null;
      currency: string;
      sellerPolicy: string;
      fulfillment: string;
      policyId: string;
      revision: number;
      policyQuantity: number;
      actionCeiling: string;
      decisionMode: string;
      maxSignalAgeSeconds: number;
      substitutionPolicy: string;
      expiresAt: string;
      cooldownSeconds: number;
      targetPolicyJson: string;
      policyHash: string;
      createdByActorId: string;
    }>(
      `SELECT mission.id AS "missionId", mission.status, mission.origin,
              mission.target_quantity AS "targetQuantity",
              mission.fulfilled_quantity AS "fulfilledQuantity",
              target.id AS "targetId", target.enabled,
              target.max_unit_price_cents AS "maxUnitPriceCents",
              target.currency, target.seller_policy AS "sellerPolicy", target.fulfillment,
              policy.id AS "policyId", policy.revision,
              policy.quantity AS "policyQuantity",
              policy.action_ceiling AS "actionCeiling",
              policy.decision_mode AS "decisionMode",
              policy.max_signal_age_seconds AS "maxSignalAgeSeconds",
              policy.substitution_policy AS "substitutionPolicy",
              policy.expires_at AS "expiresAt",
              policy.cooldown_seconds AS "cooldownSeconds",
              policy.target_policy_json AS "targetPolicyJson",
              policy.policy_hash AS "policyHash",
              policy.created_by_actor_id AS "createdByActorId"
       FROM "${NATIVE_SCHEMA}"."missions" AS mission
       JOIN "${NATIVE_SCHEMA}"."mission_targets" AS target ON target.mission_id = mission.id
       JOIN "${NATIVE_SCHEMA}"."mission_intent_revisions" AS policy
         ON policy.mission_id = mission.id
       WHERE mission.id = $1`,
      [missionCreateWinner.missionId]
    )).rows[0]!;
    assert.deepEqual({
      missionId: storedMissionBinding.missionId,
      status: storedMissionBinding.status,
      origin: storedMissionBinding.origin,
      targetQuantity: Number(storedMissionBinding.targetQuantity),
      fulfilledQuantity: Number(storedMissionBinding.fulfilledQuantity),
      targetId: storedMissionBinding.targetId,
      enabled: Number(storedMissionBinding.enabled),
      maxUnitPriceCents: storedMissionBinding.maxUnitPriceCents,
      currency: storedMissionBinding.currency,
      sellerPolicy: storedMissionBinding.sellerPolicy,
      fulfillment: storedMissionBinding.fulfillment,
      policyId: storedMissionBinding.policyId,
      revision: Number(storedMissionBinding.revision),
      policyQuantity: Number(storedMissionBinding.policyQuantity),
      actionCeiling: storedMissionBinding.actionCeiling,
      decisionMode: storedMissionBinding.decisionMode,
      maxSignalAgeSeconds: Number(storedMissionBinding.maxSignalAgeSeconds),
      substitutionPolicy: storedMissionBinding.substitutionPolicy,
      expiresAt: storedMissionBinding.expiresAt,
      cooldownSeconds: Number(storedMissionBinding.cooldownSeconds),
      createdByActorId: storedMissionBinding.createdByActorId
    }, {
      missionId: missionCreateWinner.missionId,
      status: "active",
      origin: "signal:trackalacker",
      targetQuantity: 1,
      fulfilledQuantity: 0,
      targetId: missionCreateWinner.missionTargetId,
      enabled: 1,
      maxUnitPriceCents: null,
      currency: "USD",
      sellerPolicy: "inherit",
      fulfillment: "inherit",
      policyId: missionCreateWinner.policyRevisionId,
      revision: 1,
      policyQuantity: 1,
      actionCeiling: "add_to_cart",
      decisionMode: "strategy",
      maxSignalAgeSeconds: 120,
      substitutionPolicy: "exact_only",
      expiresAt: "",
      cooldownSeconds: 0,
      createdByActorId: NATIVE_PRINCIPAL_A
    });
    const expectedMissionTargetPolicy = [{
      targetId: missionCreateWinner.missionTargetId,
      listingId: "listing_native_mission_create",
      retailerId: "target",
      enabled: true,
      maxUnitPriceCents: null,
      sellerPolicy: "inherit",
      fulfillment: "inherit"
    }];
    assert.equal(storedMissionBinding.targetPolicyJson, JSON.stringify(expectedMissionTargetPolicy));
    assert.equal(
      storedMissionBinding.policyHash,
      stableHash(
        "intent-policy-v2",
        missionCreateWinner.missionId,
        1,
        "USD",
        null,
        "add_to_cart",
        "strategy",
        120,
        "exact_only",
        "",
        0,
        JSON.stringify(expectedMissionTargetPolicy)
      )
    );
    assert.deepEqual(
      (await first.query<{ eventType: string; reasonCode: string; aggregateType: string }>(
        `SELECT audit.event_type AS "eventType", audit.reason_code AS "reasonCode",
                outbox.aggregate_type AS "aggregateType"
         FROM "${NATIVE_SCHEMA}"."audit_events" AS audit
         JOIN "${NATIVE_SCHEMA}"."outbox_events" AS outbox
           ON (outbox.payload_json::jsonb->>'auditId') = audit.id
         WHERE audit.correlation_id = $1
           AND audit.event_type IN ('mission_created', 'purchase_intent_policy_revised')
         ORDER BY audit.event_type`,
        [missionCreateWinner.missionId]
      )).rows,
      [
        { eventType: "mission_created", reasonCode: "signal:trackalacker", aggregateType: "mission" },
        { eventType: "purchase_intent_policy_revised", reasonCode: "initial_policy", aggregateType: "purchase_intent" }
      ]
    );
    const missionCreateDuplicateMessageId = "inbox_13579bdf13579bdf13579bdf13579bdf";
    const missionCreateDuplicateNow = resolutionPlanNow + 6_260;
    await insertSignalLifecycleInbox(
      missionCreateDuplicateMessageId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(missionCreateDuplicateNow).toISOString(),
      missionCreatePayload
    );
    const missionCreateDuplicateLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      missionCreateDuplicateNow
    );
    assert.ok(missionCreateDuplicateLease);
    assert.equal(missionCreateDuplicateLease.id, missionCreateDuplicateMessageId);
    const missionCreateDuplicateResolution = await signalResolutionApplyA.applySignalEventResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      missionCreateDuplicateMessageId,
      missionCreateDuplicateLease.capabilityToken,
      missionCreateDuplicateNow
    );
    assert.equal(missionCreateDuplicateResolution.duplicate, true);
    assert.equal(missionCreateDuplicateResolution.eventId, missionCreateResolution.eventId);
    assert.equal(
      (await signalSourceReferenceA.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateDuplicateMessageId,
        missionCreateDuplicateLease.capabilityToken,
        missionCreateDuplicateNow
      )).mutationStatementCount,
      0
    );
    assert.equal(
      (await signalTerminalDecisionA.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateDuplicateMessageId,
        missionCreateDuplicateLease.capabilityToken,
        missionCreateDuplicateNow
      )).continueDownstream,
      true
    );
    assert.equal(
      (await signalOfferIncidentA.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateDuplicateMessageId,
        missionCreateDuplicateLease.capabilityToken,
        missionCreateDuplicateNow
      )).mutationStatementCount,
      0
    );
    assert.equal(
      (await signalPostIncidentDecisionA.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateDuplicateMessageId,
        missionCreateDuplicateLease.capabilityToken,
        missionCreateDuplicateNow
      )).continueDownstream,
      true
    );
    const missionCreateDuplicateBinding = await signalMissionBindingA.applySignalMissionBinding(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      missionCreateDuplicateMessageId,
      missionCreateDuplicateLease.capabilityToken,
      missionCreateDuplicateNow
    );
    assert.equal(missionCreateDuplicateBinding.outcome, "already_bound");
    assert.equal(missionCreateDuplicateBinding.missionId, missionCreateWinner.missionId);
    assert.equal(missionCreateDuplicateBinding.missionTargetId, missionCreateWinner.missionTargetId);
    assert.equal(missionCreateDuplicateBinding.mutationStatementCount, 0);
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."strategies"
       WHERE tenant_id = $1 AND user_id = $2`,
      [NATIVE_TENANT, NATIVE_USER]
    );
    const nativeMatchedStrategy: StrategyDefinition = {
      id: "strategy_native_signal_evaluation",
      name: "Native exact signal",
      enabled: true,
      position: 1,
      revision: 1,
      sources: ["trackalacker"],
      retailers: ["target"],
      pricePolicy: { kind: "absolute_max", maxPriceCents: 1_300 },
      sellerPolicy: "first_party_only",
      allowedSellers: ["target"],
      includeKeywords: "native",
      excludeKeywords: "damaged",
      action: "add_to_cart",
      quantity: 1,
      fulfillment: "shipping",
      maxSignalAgeSeconds: 120
    };
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."strategies"(
         id, tenant_id, user_id, name, enabled, position, revision,
         definition_json, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 1, 1, 1, $5, $6, $6)`,
      [
        nativeMatchedStrategy.id,
        NATIVE_TENANT,
        NATIVE_USER,
        nativeMatchedStrategy.name,
        JSON.stringify(nativeMatchedStrategy),
        new Date(resolutionPlanNow + 6_250).toISOString()
      ]
    );
    const widenedMissionEvaluationAttestation = await attestNativeSignalEvaluation({
      payload: missionCreatePayload,
      missionId: missionCreateWinner.missionId,
      missionTargetId: missionCreateWinner.missionTargetId,
      listingId: "listing_native_mission_create",
      missionEvaluationQuantity: 5,
      strategies: [nativeMatchedStrategy],
      now: resolutionPlanNow + 6_250
    });
    await assert.rejects(
      signalStrategyEvaluationA.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        widenedMissionEvaluationAttestation,
        resolutionPlanNow + 6_250
      ),
      /mission quantity projection is invalid/
    );
    const matchedEvaluationAttestation = await attestNativeSignalEvaluation({
      payload: missionCreatePayload,
      missionId: missionCreateWinner.missionId,
      missionTargetId: missionCreateWinner.missionTargetId,
      listingId: "listing_native_mission_create",
      missionEvaluationQuantity: 1,
      strategies: [nativeMatchedStrategy],
      now: resolutionPlanNow + 6_250
    });
    assert.equal(matchedEvaluationAttestation.state, "matched");
    assert.equal(matchedEvaluationAttestation.strategyId, nativeMatchedStrategy.id);
    assert.equal(matchedEvaluationAttestation.effectiveAction, "add_to_cart");
    assert.equal(matchedEvaluationAttestation.effectiveQuantity, 1);
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."mission_targets"
       SET enabled = 0, updated_at = $2 WHERE id = $1`,
      [missionCreateWinner.missionTargetId, new Date(resolutionPlanNow + 6_251).toISOString()]
    );
    try {
      await assert.rejects(
        signalStrategyEvaluationA.applySignalStrategyEvaluation(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          missionCreateMessageId,
          missionCreateLease.capabilityToken,
          matchedEvaluationAttestation,
          resolutionPlanNow + 6_250
        ),
        /current mission target is inactive/
      );
    } finally {
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."mission_targets"
         SET enabled = 1, updated_at = $2 WHERE id = $1`,
        [missionCreateWinner.missionTargetId, new Date(resolutionPlanNow + 6_252).toISOString()]
      );
    }
    await assert.rejects(
      signalStrategyEvaluationB.applySignalStrategyEvaluation(
        { tenantId: "tenant_local", userId: "user_local" },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        matchedEvaluationAttestation,
        resolutionPlanNow + 6_250
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalStrategyEvaluationC.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        matchedEvaluationAttestation,
        resolutionPlanNow + 6_250
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await assert.rejects(
      signalStrategyEvaluationUnmapped.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        matchedEvaluationAttestation,
        resolutionPlanNow + 6_250
      ),
      /tenant session principal is not active/
    );
    await assert.rejects(
      signalStrategyEvaluationA.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        { ...matchedEvaluationAttestation, evaluationFingerprint: "0".repeat(64) },
        resolutionPlanNow + 6_250
      ),
      /attestation fingerprint is invalid/
    );
    const countsBeforeMatchedEvaluation = await signalResolutionMutationCounts();
    const matchedEvaluations = await Promise.all([
      signalStrategyEvaluationA.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        matchedEvaluationAttestation,
        resolutionPlanNow + 6_250
      ),
      signalStrategyEvaluationASecond.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        matchedEvaluationAttestation,
        resolutionPlanNow + 6_250
      )
    ]);
    for (const matchedEvaluation of matchedEvaluations) {
      assert.equal(matchedEvaluation.outcome, "continue_downstream");
      assert.equal(matchedEvaluation.evaluationState, "matched");
      assert.equal(matchedEvaluation.strategyId, nativeMatchedStrategy.id);
      assert.equal(matchedEvaluation.decisionAction, "none");
      assert.equal(matchedEvaluation.auditAction, "none");
      assert.equal(matchedEvaluation.outboxAction, "none");
      assert.equal(matchedEvaluation.mutationStatementCount, 0);
      assert.equal(matchedEvaluation.strategyEvaluationApplyApplied, false);
      assert.equal(matchedEvaluation.continueDownstream, true);
      assert.equal(matchedEvaluation.actionMutation, false);
      assert.equal(matchedEvaluation.spendMutation, false);
      assert.equal(matchedEvaluation.evaluationAuthority, false);
      assert.equal(matchedEvaluation.terminalDecisionMutated, false);
    }
    assert.deepEqual(await signalResolutionMutationCounts(), countsBeforeMatchedEvaluation);
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."strategies"
       WHERE tenant_id = $1 AND user_id = $2`,
      [NATIVE_TENANT, NATIVE_USER]
    );
    await assert.rejects(
      signalStrategyEvaluationA.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        matchedEvaluationAttestation,
        resolutionPlanNow + 6_250
      ),
      /strategy snapshot changed/
    );
    const terminalEvaluationAttestation = await attestNativeSignalEvaluation({
      payload: missionCreatePayload,
      missionId: missionCreateWinner.missionId,
      missionTargetId: missionCreateWinner.missionTargetId,
      listingId: "listing_native_mission_create",
      missionEvaluationQuantity: 1,
      strategies: [],
      now: resolutionPlanNow + 6_250
    });
    assert.equal(terminalEvaluationAttestation.state, "unmatched");
    assert.equal(terminalEvaluationAttestation.strategyId, "");
    assert.equal(terminalEvaluationAttestation.effectiveAction, "notify");
    assert.equal(terminalEvaluationAttestation.effectiveQuantity, 1);
    signalStrategyEvaluationDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalStrategyEvaluationDirectClient.on("error", () => undefined);
    await signalStrategyEvaluationDirectClient.connect();
    await signalStrategyEvaluationDirectClient.query(
      `SET ROLE "${signalStrategyEvaluationManifest.strategyEvaluationRole.name}"`
    );
    const directEvaluationPlan = (attestation: unknown) => signalStrategyEvaluationDirectClient!.query(
      `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION}"(
         $1, $2, 'plan', $3, $4, '', $5
       )`,
      [
        NATIVE_TENANT,
        NATIVE_USER,
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        JSON.stringify({ attestation })
      ]
    );
    await assert.rejects(
      directEvaluationPlan({ ...terminalEvaluationAttestation, strategyCount: 0.4 }),
      /numeric values are not canonical integers/
    );
    const {
      effectiveUnitCapCents: _omittedEffectiveUnitCapCents,
      ...missingEffectiveUnitCapAttestation
    } = terminalEvaluationAttestation;
    await assert.rejects(
      directEvaluationPlan(missingEffectiveUnitCapAttestation),
      /attestation shape is invalid/
    );
    await signalStrategyEvaluationDirectClient.end();
    signalStrategyEvaluationDirectClient = null;
    const {
      evaluationFingerprint: _terminalEvaluationFingerprint,
      ...terminalEvaluationWithoutFingerprint
    } = terminalEvaluationAttestation;
    const unsafeTerminalWithoutFingerprint = {
      ...terminalEvaluationWithoutFingerprint,
      sellerPolicy: "allow_third_party" as const
    };
    const unsafeTerminalAttestation: SignalPolicyEvaluationAttestation = {
      ...unsafeTerminalWithoutFingerprint,
      evaluationFingerprint: signalPolicyEvaluationFingerprint(unsafeTerminalWithoutFingerprint)
    };
    await assert.rejects(
      signalStrategyEvaluationA.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        unsafeTerminalAttestation,
        resolutionPlanNow + 6_250
      ),
      /terminal strategy evaluation is not fail closed/
    );
    const countsBeforeTerminalEvaluation = await signalResolutionMutationCounts();
    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_signal_evaluation_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $body$
       BEGIN
         IF NEW.event_type = 'signal_decided' THEN
           RAISE EXCEPTION 'native forced signal evaluation outbox failure';
         END IF;
         RETURN NEW;
       END
       $body$;
       CREATE TRIGGER "yoink_native_reject_signal_evaluation_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_signal_evaluation_outbox"()`
    );
    try {
      await assert.rejects(
        signalStrategyEvaluationA.applySignalStrategyEvaluation(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          missionCreateMessageId,
          missionCreateLease.capabilityToken,
          terminalEvaluationAttestation,
          resolutionPlanNow + 6_250
        ),
        /native forced signal evaluation outbox failure/
      );
      assert.deepEqual(await signalResolutionMutationCounts(), countsBeforeTerminalEvaluation);
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_signal_evaluation_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS "${NATIVE_SCHEMA}"."yoink_native_reject_signal_evaluation_outbox"()`
      );
    }
    const concurrentTerminalEvaluations = await Promise.all([
      signalStrategyEvaluationA.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        terminalEvaluationAttestation,
        resolutionPlanNow + 6_250
      ),
      signalStrategyEvaluationASecond.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateDuplicateMessageId,
        missionCreateDuplicateLease.capabilityToken,
        terminalEvaluationAttestation,
        missionCreateDuplicateNow
      )
    ]);
    const terminalEvaluationWinner = concurrentTerminalEvaluations.find(
      (result) => result.strategyEvaluationApplyApplied
    );
    const terminalEvaluationReplay = concurrentTerminalEvaluations.find(
      (result) => !result.strategyEvaluationApplyApplied
    );
    assert.ok(terminalEvaluationWinner);
    assert.ok(terminalEvaluationReplay);
    assert.equal(terminalEvaluationWinner.outcome, "unmatched");
    assert.equal(terminalEvaluationWinner.evaluationState, "unmatched");
    assert.equal(terminalEvaluationWinner.decisionAction, "insert");
    assert.equal(terminalEvaluationWinner.auditAction, "insert");
    assert.equal(terminalEvaluationWinner.outboxAction, "insert");
    assert.equal(terminalEvaluationWinner.mutationStatementCount, 3);
    assert.equal(terminalEvaluationWinner.mutationRowCount, 3);
    assert.equal(terminalEvaluationWinner.continueDownstream, false);
    assert.equal(terminalEvaluationWinner.terminalDecisionMutated, true);
    assert.equal(terminalEvaluationWinner.actionMutation, false);
    assert.equal(terminalEvaluationWinner.spendMutation, false);
    assert.equal(terminalEvaluationWinner.inboxLifecycleMutation, false);
    assert.equal(terminalEvaluationReplay.outcome, "unmatched");
    assert.equal(terminalEvaluationReplay.decisionAction, "none");
    assert.equal(terminalEvaluationReplay.mutationStatementCount, 0);
    assert.equal(terminalEvaluationReplay.terminalDecisionMutated, false);
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...countsBeforeTerminalEvaluation,
      missionDecisions: Number(countsBeforeTerminalEvaluation.missionDecisions) + 1,
      auditEvents: Number(countsBeforeTerminalEvaluation.auditEvents) + 1,
      outboxEvents: Number(countsBeforeTerminalEvaluation.outboxEvents) + 1
    });
    const storedTerminalEvaluation = (await first.query<{
      decisionId: string;
      outcome: string;
      decisionSource: string;
      effectiveAction: string;
      effectiveQuantity: number;
      strategyId: string | null;
      reason: string;
      decisionCreatedAt: string;
      auditId: string;
      auditReason: string;
      auditData: string;
      auditCreatedAt: string;
      outboxId: string;
      outboxAggregateType: string;
      outboxPayload: string;
      outboxCreatedAt: string;
    }>(
      `SELECT decision.id AS "decisionId", decision.outcome,
              decision.decision_source AS "decisionSource",
              decision.effective_action AS "effectiveAction",
              decision.effective_quantity AS "effectiveQuantity",
              decision.strategy_id AS "strategyId", decision.reason,
              decision.created_at AS "decisionCreatedAt", audit.id AS "auditId",
              audit.reason_code AS "auditReason", audit.data_json AS "auditData",
              audit.created_at AS "auditCreatedAt", outbox.id AS "outboxId",
              outbox.aggregate_type AS "outboxAggregateType",
              outbox.payload_json AS "outboxPayload", outbox.created_at AS "outboxCreatedAt"
       FROM "${NATIVE_SCHEMA}"."mission_decisions" AS decision
       JOIN "${NATIVE_SCHEMA}"."signal_events" AS signal ON signal.id = decision.event_id
       JOIN "${NATIVE_SCHEMA}"."audit_events" AS audit
         ON audit.correlation_id = signal.signal_id AND audit.event_type = 'signal_decided'
        AND audit.reason_code = decision.outcome
       JOIN "${NATIVE_SCHEMA}"."outbox_events" AS outbox
         ON (outbox.payload_json::jsonb->>'auditId') = audit.id
       WHERE decision.mission_id = $1 AND decision.outcome = 'unmatched'`,
      [missionCreateWinner.missionId]
    )).rows[0]!;
    const normalizedStoredTerminalEvaluation = {
      ...storedTerminalEvaluation,
      effectiveQuantity: Number(storedTerminalEvaluation.effectiveQuantity),
      auditData: JSON.parse(storedTerminalEvaluation.auditData),
      outboxPayload: JSON.parse(storedTerminalEvaluation.outboxPayload)
    };
    const expectedTerminalDecisionId = `mission_decision_${stableHash(
      "postgres_signal_strategy_evaluation_decision_v1",
      NATIVE_TENANT,
      NATIVE_USER,
      terminalEvaluationWinner.eventId,
      missionCreateWinner.missionId,
      terminalEvaluationAttestation.evaluationFingerprint
    ).slice(0, 32)}`;
    const expectedTerminalAuditId = `audit_${stableHash(
      "postgres_signal_strategy_evaluation_audit_v1",
      NATIVE_TENANT,
      NATIVE_USER,
      terminalEvaluationWinner.eventId,
      missionCreateWinner.missionId,
      terminalEvaluationAttestation.evaluationFingerprint
    ).slice(0, 32)}`;
    const expectedTerminalOutboxId = `outbox_${stableHash(
      "postgres_signal_strategy_evaluation_outbox_v1",
      NATIVE_TENANT,
      NATIVE_USER,
      terminalEvaluationWinner.eventId,
      missionCreateWinner.missionId,
      terminalEvaluationAttestation.evaluationFingerprint
    ).slice(0, 32)}`;
    assert.equal(storedTerminalEvaluation.decisionId, expectedTerminalDecisionId);
    assert.equal(storedTerminalEvaluation.auditId, expectedTerminalAuditId);
    assert.equal(storedTerminalEvaluation.outboxId, expectedTerminalOutboxId);
    assert.match(storedTerminalEvaluation.decisionCreatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(storedTerminalEvaluation.auditCreatedAt, storedTerminalEvaluation.decisionCreatedAt);
    assert.equal(storedTerminalEvaluation.outboxCreatedAt, storedTerminalEvaluation.decisionCreatedAt);
    assert.deepEqual(normalizedStoredTerminalEvaluation, {
      decisionId: expectedTerminalDecisionId,
      outcome: "unmatched",
      decisionSource: "strategy",
      effectiveAction: "notify",
      effectiveQuantity: 1,
      strategyId: null,
      reason: terminalEvaluationAttestation.reason,
      decisionCreatedAt: storedTerminalEvaluation.decisionCreatedAt,
      auditId: expectedTerminalAuditId,
      auditReason: "unmatched",
      auditData: {
        missionId: missionCreateWinner.missionId,
        incidentId: missionCreateOfferIncident.incidentId,
        evaluationAttestation: terminalEvaluationAttestation
      },
      auditCreatedAt: storedTerminalEvaluation.decisionCreatedAt,
      outboxId: expectedTerminalOutboxId,
      outboxAggregateType: "signal",
      outboxPayload: {
        auditId: expectedTerminalAuditId,
        correlationId: normalizeSignal(
          missionCreatePayload as unknown as SignalEventInput,
          resolutionPlanNow + 6_250
        ).signalId,
        reasonCode: "unmatched",
        message: terminalEvaluationAttestation.reason,
        data: {
          missionId: missionCreateWinner.missionId,
          incidentId: missionCreateOfferIncident.incidentId,
          evaluationAttestation: terminalEvaluationAttestation
        }
      },
      outboxCreatedAt: storedTerminalEvaluation.decisionCreatedAt
    });
    const storedTerminalOutbox = (await first.query<{
      id: string;
      tenantId: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payloadJson: string;
      createdAt: string;
      deliveredAt: string;
      deliveryAttempts: number;
      deliveryState: string;
      leaseCapabilityHash: string;
      leaseExpiresAt: string;
      nextAttemptAt: string;
      lastErrorCode: string;
      updatedAt: string;
    }>(
      `SELECT id, tenant_id AS "tenantId", aggregate_type AS "aggregateType",
              aggregate_id AS "aggregateId", event_type AS "eventType",
              payload_json AS "payloadJson", created_at AS "createdAt",
              delivered_at AS "deliveredAt", delivery_attempts AS "deliveryAttempts",
              delivery_state AS "deliveryState",
              lease_capability_hash AS "leaseCapabilityHash",
              lease_expires_at AS "leaseExpiresAt", next_attempt_at AS "nextAttemptAt",
              last_error_code AS "lastErrorCode", updated_at AS "updatedAt"
       FROM "${NATIVE_SCHEMA}"."outbox_events" WHERE id = $1`,
      [expectedTerminalOutboxId]
    )).rows[0]!;
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."outbox_events" WHERE id = $1`,
      [expectedTerminalOutboxId]
    );
    await assert.rejects(
      signalStrategyEvaluationA.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        terminalEvaluationAttestation,
        resolutionPlanNow + 6_250
      ),
      /graph is partial/
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."outbox_events"(
         id, tenant_id, aggregate_type, aggregate_id, event_type, payload_json,
         created_at, delivered_at, delivery_attempts, delivery_state,
         lease_capability_hash, lease_expires_at, next_attempt_at,
         last_error_code, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        storedTerminalOutbox.id,
        storedTerminalOutbox.tenantId,
        storedTerminalOutbox.aggregateType,
        storedTerminalOutbox.aggregateId,
        storedTerminalOutbox.eventType,
        storedTerminalOutbox.payloadJson,
        storedTerminalOutbox.createdAt,
        storedTerminalOutbox.deliveredAt,
        Number(storedTerminalOutbox.deliveryAttempts),
        storedTerminalOutbox.deliveryState,
        storedTerminalOutbox.leaseCapabilityHash,
        storedTerminalOutbox.leaseExpiresAt,
        storedTerminalOutbox.nextAttemptAt,
        storedTerminalOutbox.lastErrorCode,
        storedTerminalOutbox.updatedAt
      ]
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."audit_events"
       SET message = 'Corrupt terminal evaluation receipt'
       WHERE id = ($1::jsonb->>'auditId')`,
      [storedTerminalEvaluation.outboxPayload]
    );
    await assert.rejects(
      signalStrategyEvaluationA.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        terminalEvaluationAttestation,
        resolutionPlanNow + 6_250
      ),
      /replay graph changed/
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."audit_events"
       SET message = $1 WHERE id = ($2::jsonb->>'auditId')`,
      [terminalEvaluationAttestation.reason, storedTerminalEvaluation.outboxPayload]
    );
    assert.equal(
      (await signalStrategyEvaluationA.applySignalStrategyEvaluation(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        terminalEvaluationAttestation,
        resolutionPlanNow + 6_250
      )).strategyEvaluationApplyApplied,
      false
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."strategies"(
         id, tenant_id, user_id, name, enabled, position, revision,
         definition_json, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 1, 1, 1, $5, $6, $6)`,
      [
        nativeMatchedStrategy.id,
        NATIVE_TENANT,
        NATIVE_USER,
        nativeMatchedStrategy.name,
        JSON.stringify(nativeMatchedStrategy),
        new Date(missionCreateDuplicateNow + 1).toISOString()
      ]
    );
    const postTerminalPolicyHash = stableHash(
      "intent-policy-v2",
      missionCreateWinner.missionId,
      2,
      "USD",
      null,
      "add_to_cart",
      "strategy",
      120,
      "exact_only",
      "",
      0,
      JSON.stringify(expectedMissionTargetPolicy)
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."mission_intent_revisions"(
         id, tenant_id, user_id, mission_id, revision, quantity, currency,
         max_all_in_cents, action_ceiling, substitution_policy, expires_at,
         cooldown_seconds, target_policy_json, policy_hash, change_reason,
         decision_mode, max_signal_age_seconds, created_by_actor_id, created_at
       )
       SELECT 'intent_revision_44444444444444444444444444444444', tenant_id,
              user_id, mission_id, 2, quantity, currency, max_all_in_cents,
              action_ceiling, substitution_policy, expires_at, cooldown_seconds,
              target_policy_json, $2, 'Native post-terminal policy revision.',
              decision_mode, max_signal_age_seconds, created_by_actor_id, $3
       FROM "${NATIVE_SCHEMA}"."mission_intent_revisions" WHERE id = $1`,
      [
        missionCreateWinner.policyRevisionId,
        postTerminalPolicyHash,
        new Date(missionCreateDuplicateNow + 1).toISOString()
      ]
    );
    const deliveredAt = new Date(missionCreateDuplicateNow + 2).toISOString();
    const deliveredUpdatedAt = new Date(missionCreateDuplicateNow + 3).toISOString();
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."outbox_events"
       SET delivered_at = $1, delivery_state = 'delivered', delivery_attempts = 2,
           lease_capability_hash = '', lease_expires_at = '', next_attempt_at = '',
           last_error_code = '', updated_at = $2
       WHERE (payload_json::jsonb->>'auditId') = ($3::jsonb->>'auditId')`,
      [deliveredAt, deliveredUpdatedAt, storedTerminalEvaluation.outboxPayload]
    );
    const countsBeforeImmutableReplay = await signalResolutionMutationCounts();
    const immutableReplay = await signalStrategyEvaluationA.applySignalStrategyEvaluation(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      missionCreateDuplicateMessageId,
      missionCreateDuplicateLease.capabilityToken,
      terminalEvaluationAttestation,
      missionCreateDuplicateNow
    );
    assert.equal(immutableReplay.outcome, "unmatched");
    assert.equal(immutableReplay.strategyEvaluationApplyApplied, false);
    assert.equal(immutableReplay.mutationStatementCount, 0);
    assert.deepEqual(await signalResolutionMutationCounts(), countsBeforeImmutableReplay);
    assert.deepEqual((await first.query<{
      deliveredAt: string;
      deliveryState: string;
      deliveryAttempts: number;
      leaseCapabilityHash: string;
      leaseExpiresAt: string;
      nextAttemptAt: string;
      lastErrorCode: string;
      updatedAt: string;
    }>(
      `SELECT delivered_at AS "deliveredAt", delivery_state AS "deliveryState",
              delivery_attempts AS "deliveryAttempts",
              lease_capability_hash AS "leaseCapabilityHash",
              lease_expires_at AS "leaseExpiresAt", next_attempt_at AS "nextAttemptAt",
              last_error_code AS "lastErrorCode", updated_at AS "updatedAt"
       FROM "${NATIVE_SCHEMA}"."outbox_events"
       WHERE (payload_json::jsonb->>'auditId') = ($1::jsonb->>'auditId')`,
      [storedTerminalEvaluation.outboxPayload]
    )).rows.map((row) => ({ ...row, deliveryAttempts: Number(row.deliveryAttempts) })), [{
      deliveredAt,
      deliveryState: "delivered",
      deliveryAttempts: 2,
      leaseCapabilityHash: "",
      leaseExpiresAt: "",
      nextAttemptAt: "",
      lastErrorCode: "",
      updatedAt: deliveredUpdatedAt
    }]);
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."strategies"
       WHERE tenant_id = $1 AND user_id = $2`,
      [NATIVE_TENANT, NATIVE_USER]
    );
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateMessageId,
        missionCreateLease.capabilityToken,
        resolutionPlanNow + 6_250
      ),
      true
    );
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        missionCreateDuplicateMessageId,
        missionCreateDuplicateLease.capabilityToken,
        missionCreateDuplicateNow
      ),
      true
    );

    const nonActionableMessageId = "inbox_2468ace02468ace02468ace02468ace0";
    const nonActionablePayloadBase = resolutionSignalPayload(
      nonActionableMessageId,
      "native_signal_source_a",
      {
        sourceProductId: "native-reference-product-a",
        sourceListingId: "native-reference-listing-a",
        retailerId: "target",
        retailerSku: "NATIVE-SIGNAL-SKU",
        canonicalUrl: "https://www.target.com/p/native-signal/NATIVE-SIGNAL-SKU",
        title: "Native reference product updated"
      }
    );
    const nonActionablePayload = {
      ...nonActionablePayloadBase,
      eventType: "price_change",
      observedAt: new Date(signalLifecycleNow + 1_500).toISOString(),
      identity: {
        ...(nonActionablePayloadBase.identity as Record<string, unknown>),
        globalIdentifiers: { trackalacker_slug: "native-reference-product-a" }
      },
      offer: {
        ...(nonActionablePayloadBase.offer as Record<string, unknown>),
        availability: "out_of_stock"
      }
    };
    await insertSignalLifecycleInbox(
      nonActionableMessageId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow + 6_500).toISOString(),
      nonActionablePayload
    );
    const nonActionableLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow + 6_500
    );
    assert.ok(nonActionableLease);
    assert.equal(nonActionableLease.id, nonActionableMessageId);
    const nonActionableResolution = await signalResolutionApplyA.applySignalEventResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      nonActionableMessageId,
      nonActionableLease.capabilityToken,
      resolutionPlanNow + 6_500
    );
    assert.equal(nonActionableResolution.duplicate, false);
    const nonActionableReference =
      await signalSourceReferenceA.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        nonActionableMessageId,
        nonActionableLease.capabilityToken,
        resolutionPlanNow + 6_500
      );
    assert.equal(nonActionableReference.outcome, "refresh");
    assert.equal(nonActionableReference.sourceProductAction, "update");
    assert.equal(nonActionableReference.sourceListingAction, "update");
    assert.equal(nonActionableReference.sourceAliasAction, "update");
    const countsBeforeNonActionableTerminal = await signalResolutionMutationCounts();
    const nonActionableTerminal = await signalTerminalDecisionA.applySignalTerminalDecision(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      nonActionableMessageId,
      nonActionableLease.capabilityToken,
      resolutionPlanNow + 6_500
    );
    assert.equal(nonActionableTerminal.outcome, "apply_terminal");
    assert.equal(nonActionableTerminal.decisionOutcome, "non_actionable_event");
    assert.equal(nonActionableTerminal.sourceReferenceOutcome, "already_current");
    assert.equal(nonActionableTerminal.mutationStatementCount, 4);
    assert.equal(nonActionableTerminal.terminalDecisionApplyApplied, true);
    const nonActionableReplay = await signalTerminalDecisionA.applySignalTerminalDecision(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      nonActionableMessageId,
      nonActionableLease.capabilityToken,
      resolutionPlanNow + 6_500
    );
    assert.equal(nonActionableReplay.outcome, "already_terminal");
    assert.equal(nonActionableReplay.decisionOutcome, "non_actionable_event");
    assert.equal(nonActionableReplay.mutationStatementCount, 0);
    assert.deepEqual(await signalResolutionMutationCounts(), {
      ...countsBeforeNonActionableTerminal,
      signalOccurrences: Number(countsBeforeNonActionableTerminal.signalOccurrences) + 1,
      missionDecisions: Number(countsBeforeNonActionableTerminal.missionDecisions) + 1,
      auditEvents: Number(countsBeforeNonActionableTerminal.auditEvents) + 1,
      outboxEvents: Number(countsBeforeNonActionableTerminal.outboxEvents) + 1
    });
    assert.deepEqual(
      (await first.query<{
        outcome: string;
        reasonCode: string;
        dataJson: string;
      }>(
        `SELECT mission.outcome, audit.reason_code AS "reasonCode",
                audit.data_json AS "dataJson"
         FROM "${NATIVE_SCHEMA}"."mission_decisions" AS mission
         JOIN "${NATIVE_SCHEMA}"."signal_events" AS event ON event.id = mission.event_id
         JOIN "${NATIVE_SCHEMA}"."audit_events" AS audit
           ON audit.correlation_id = event.signal_id AND audit.event_type = 'signal_decided'
         WHERE event.id = $1`,
        [nonActionableResolution.eventId]
      )).rows.map((row) => ({
        outcome: row.outcome,
        reasonCode: row.reasonCode,
        data: JSON.parse(row.dataJson)
      })),
      [{
        outcome: "non_actionable_event",
        reasonCode: "non_actionable_event",
        data: {
          eventType: "price_change",
          availability: "out_of_stock",
          listingId: "listing_native_signal"
        }
      }]
    );
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        nonActionableMessageId,
        nonActionableLease.capabilityToken,
        resolutionPlanNow + 6_500
      ),
      true
    );

    const referenceConflictMessageId = "inbox_1234567890abcdef1234567890abcdef";
    const referenceConflictPayload = resolutionSignalPayload(
      referenceConflictMessageId,
      "native_signal_source_a",
      {
        sourceProductId: "native-reference-conflict-product",
        sourceListingId: "native-reference-conflict-listing",
        retailerId: "target",
        retailerSku: "NATIVE-SIGNAL-SKU",
        canonicalUrl: "https://www.target.com/p/native-signal/NATIVE-SIGNAL-SKU",
        title: "Native reference conflict product"
      }
    );
    await insertSignalLifecycleInbox(
      referenceConflictMessageId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(resolutionPlanNow + 7_000).toISOString(),
      referenceConflictPayload
    );
    const referenceConflictLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      resolutionPlanNow + 7_000
    );
    assert.ok(referenceConflictLease);
    assert.equal(referenceConflictLease.id, referenceConflictMessageId);
    const referenceConflictResolution = await signalResolutionApplyA.applySignalEventResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      referenceConflictMessageId,
      referenceConflictLease.capabilityToken,
      resolutionPlanNow + 7_000
    );
    assert.equal(referenceConflictResolution.duplicate, false);
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."source_listing_refs"(
         id, source_connection_id, external_listing_id, external_product_id,
         listing_id, source_url, observed_at
       ) VALUES (
         'source_listing_native_reference_conflict', 'native_signal_source_a',
         'native-reference-conflict-listing', 'native-reference-conflict-product',
         'listing_cutover_scope', '', $1
       )`,
      [String(referenceConflictPayload.observedAt)]
    );
    const countsBeforeReferenceConflict = await signalResolutionMutationCounts();
    await assert.rejects(
      signalSourceReferenceA.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceConflictMessageId,
        referenceConflictLease.capabilityToken,
        resolutionPlanNow + 7_000
      ),
      /source listing reference conflicts with the committed listing/
    );
    assert.deepEqual(await signalResolutionMutationCounts(), countsBeforeReferenceConflict);
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."source_listing_refs"
       WHERE id = 'source_listing_native_reference_conflict'`
    );
    const recoveredReferenceResult = await signalSourceReferenceA.refreshSignalSourceReferences(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      referenceConflictMessageId,
      referenceConflictLease.capabilityToken,
      resolutionPlanNow + 7_000
    );
    assert.equal(recoveredReferenceResult.outcome, "refresh");
    assert.equal(recoveredReferenceResult.sourceProductAction, "insert");
    assert.equal(recoveredReferenceResult.sourceListingAction, "insert");
    assert.equal(recoveredReferenceResult.sourceAliasAction, "none");
    assert.equal(recoveredReferenceResult.mutationStatementCount, 2);
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        referenceConflictMessageId,
        referenceConflictLease.capabilityToken,
        resolutionPlanNow + 7_000
      ),
      true
    );

    await assert.rejects(
      deliveryLeaseRecoveryA.leaseSignalInbox(
        { tenantId: "tenant_local", userId: "user_local" },
        signalLifecycleNow
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      deliveryLeaseRecoveryUnmapped.leaseSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        signalLifecycleNow
      ),
      /tenant session principal is not active/
    );
    const signalLifecycleReceipts = (await first.query<{
      id: string;
      tenantId: string;
      userId: string;
      direction: string;
      messageId: string;
      disposition: string;
      attempt: number;
      reasonCode: string;
      receiptHash: string;
      createdAt: string;
    }>(
      `SELECT id, tenant_id AS "tenantId", user_id AS "userId", direction,
              message_id AS "messageId", disposition, attempt,
              reason_code AS "reasonCode", receipt_hash AS "receiptHash",
              created_at AS "createdAt"
       FROM "${NATIVE_SCHEMA}"."hosted_delivery_receipts"
       WHERE message_id LIKE 'native_signal_lifecycle_%'
       ORDER BY message_id, disposition`
    )).rows;
    assert.equal(signalLifecycleReceipts.length, 8);
    assert.deepEqual(
      signalLifecycleReceipts.map((receipt) => ({
        messageId: receipt.messageId,
        disposition: receipt.disposition,
        attempt: Number(receipt.attempt),
        reasonCode: receipt.reasonCode
      })),
      [
        { messageId: signalCompleteId, disposition: "leased", attempt: 1, reasonCode: "worker_lease" },
        { messageId: signalCompleteId, disposition: "processed", attempt: 1, reasonCode: "worker_ack" },
        { messageId: signalDeadId, disposition: "dead_letter", attempt: 20, reasonCode: "signal_processing_failed" },
        { messageId: signalDeadId, disposition: "leased", attempt: 20, reasonCode: "worker_lease" },
        { messageId: signalPeerId, disposition: "leased", attempt: 1, reasonCode: "worker_lease" },
        { messageId: signalPeerId, disposition: "processed", attempt: 1, reasonCode: "worker_ack" },
        { messageId: signalRetryId, disposition: "leased", attempt: 1, reasonCode: "worker_lease" },
        { messageId: signalRetryId, disposition: "retry", attempt: 1, reasonCode: "signal_processing_failed" }
      ]
    );
    for (const receipt of signalLifecycleReceipts) {
      assert.match(receipt.id, /^delivery_receipt_[a-f0-9]{32}$/);
      assert.equal(receipt.direction, "inbox");
      assert.equal(
        receipt.userId,
        receipt.messageId === signalPeerId
          ? NATIVE_SAME_TENANT_USER
          : receipt.messageId === signalRetryId ? "user_local" : NATIVE_USER
      );
      assert.equal(
        receipt.tenantId,
        receipt.messageId === signalRetryId ? "tenant_local" : NATIVE_TENANT
      );
      assert.equal(
        receipt.receiptHash,
        stableHash(
          "hosted_delivery_receipt_v1",
          receipt.tenantId,
          receipt.userId,
          receipt.direction,
          receipt.messageId,
          receipt.disposition,
          Number(receipt.attempt),
          receipt.reasonCode,
          receipt.createdAt
        )
      );
    }
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
       WHERE principal_role = $1`,
      [NATIVE_PRINCIPAL_C]
    );

    deliveryLeaseRecoveryDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    deliveryLeaseRecoveryDirectClient.on("error", () => undefined);
    await deliveryLeaseRecoveryDirectClient.connect();
    await deliveryLeaseRecoveryDirectClient.query(
      `SET ROLE "${deliveryLeaseRecoveryManifest.leaseRecoveryRole.name}"`
    );
    await assert.rejects(
      deliveryLeaseRecoveryDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."inbox_messages" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      deliveryLeaseRecoveryDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."yoink_recover_hosted_delivery_leases"($1, $2)`,
        [NATIVE_TENANT, "user_local"]
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      deliveryLeaseRecoveryDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."yoink_transition_trackalacker_signal_inbox"(
           $1, $2, 'lease', '', $3
         )`,
        [NATIVE_TENANT, "user_local", "A".repeat(43)]
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      deliveryLeaseRecoveryDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."yoink_plan_trackalacker_signal_resolution"(
           $1, $2, $3, $4
         )`,
        [NATIVE_TENANT, "user_local", matchedResolutionId, "A".repeat(43)]
      ),
      /does not match the expected authenticated principal/
    );
    await deliveryLeaseRecoveryDirectClient.end();
    deliveryLeaseRecoveryDirectClient = null;

    signalCatalogApplyDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalCatalogApplyDirectClient.on("error", () => undefined);
    await signalCatalogApplyDirectClient.connect();
    await signalCatalogApplyDirectClient.query(
      `SET ROLE "${signalCatalogApplyManifest.catalogApplyRole.name}"`
    );
    await assert.rejects(
      signalCatalogApplyDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."product_families" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalCatalogApplyDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."source_product_refs" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalCatalogApplyDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."product_families"(
           id, title, brand, created_at, updated_at
         ) VALUES ('family_ffffffffffffffffffffffffffffffff', 'forbidden', '', $1, $1)`,
        [new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalCatalogApplyDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION}"(
           $1, $2, 'plan', $3, $4, '', '{}'
         )`,
        [NATIVE_TENANT, "user_local", catalogSignalId, "A".repeat(43)]
      ),
      /does not match the expected authenticated principal/
    );
    await signalCatalogApplyDirectClient.end();
    signalCatalogApplyDirectClient = null;

    signalResolutionApplyDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalResolutionApplyDirectClient.on("error", () => undefined);
    await signalResolutionApplyDirectClient.connect();
    await signalResolutionApplyDirectClient.query(
      `SET ROLE "${signalResolutionApplyManifest.resolutionApplyRole.name}"`
    );
    await assert.rejects(
      signalResolutionApplyDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."signal_events" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalResolutionApplyDirectClient.query(
        `UPDATE "${NATIVE_SCHEMA}"."source_connections"
         SET status = 'connected' WHERE id = 'native_signal_source_a'`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalResolutionApplyDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."resolution_decisions"(
           id, event_id, status, method, reason, resolver_version, created_at
         ) VALUES (
           'resolution_ffffffffffffffffffffffffffffffff',
           'signal_event_native_resolution_duplicate',
           'matched', 'forbidden', 'forbidden', 'resolver-v1', $1
         )`,
        [new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalResolutionApplyDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION}"(
           $1, $2, 'plan', $3, $4, '', '{}'
         )`,
        [NATIVE_TENANT, "user_local", catalogSignalId, "A".repeat(43)]
      ),
      /does not match the expected authenticated principal/
    );
    await signalResolutionApplyDirectClient.end();
    signalResolutionApplyDirectClient = null;

    signalSourceReferenceDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalSourceReferenceDirectClient.on("error", () => undefined);
    await signalSourceReferenceDirectClient.connect();
    await signalSourceReferenceDirectClient.query(
      `SET ROLE "${signalSourceReferenceManifest.sourceReferenceRefreshRole.name}"`
    );
    await assert.rejects(
      signalSourceReferenceDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."source_product_refs" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceReferenceDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."source_listing_refs"(
           id, source_connection_id, external_listing_id, external_product_id,
           listing_id, source_url, observed_at
         ) VALUES (
           'source_listing_forbidden', 'native_signal_source_a', 'forbidden', '',
           'listing_native_signal', '', $1
         )`,
        [new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceReferenceDirectClient.query(
        `UPDATE "${NATIVE_SCHEMA}"."source_product_aliases"
         SET observed_at = $1 WHERE source_connection_id = 'native_signal_source_a'`,
        [new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceReferenceDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION}"(
           $1, $2, 'plan', $3, $4, '', '{}'
         )`,
        [NATIVE_TENANT, "user_local", referenceRefreshMessageId, "A".repeat(43)]
      ),
      /does not match the expected authenticated principal/
    );
    await signalSourceReferenceDirectClient.end();
    signalSourceReferenceDirectClient = null;

    signalTerminalDecisionDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalTerminalDecisionDirectClient.on("error", () => undefined);
    await signalTerminalDecisionDirectClient.connect();
    await signalTerminalDecisionDirectClient.query(
      `SET ROLE "${signalTerminalDecisionManifest.terminalDecisionApplyRole.name}"`
    );
    await assert.rejects(
      signalTerminalDecisionDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."signal_occurrences" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalTerminalDecisionDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."mission_decisions"(
           id, event_id, incident_id, mission_id, strategy_id, strategy_revision,
           decision_source, outcome, reason, effective_action, effective_quantity,
           effective_unit_cap_cents, created_at
         ) VALUES (
           'decision_ffffffffffffffffffffffffffffffff',
           'signal_event_ffffffffffffffffffffffffffffffff', NULL, NULL, NULL, NULL,
           'strategy', 'forbidden', 'forbidden', 'notify', 1, NULL, $1
         )`,
        [new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalTerminalDecisionDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."audit_events"(
           id, tenant_id, user_id, correlation_id, event_type,
           reason_code, message, data_json, created_at
         ) VALUES (
           'audit_ffffffffffffffffffffffffffffffff', $1, $2,
           'signal-ffffffffffffffffffffffffffffffff', 'forbidden',
           'forbidden', 'forbidden', '{}', $3
         )`,
        [NATIVE_TENANT, NATIVE_USER, new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalTerminalDecisionDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."outbox_events"(
           id, tenant_id, aggregate_type, aggregate_id,
           event_type, payload_json, created_at, delivered_at
         ) VALUES (
           'outbox_ffffffffffffffffffffffffffffffff', $1, 'signal',
           'signal-ffffffffffffffffffffffffffffffff', 'forbidden', '{}', $2, ''
         )`,
        [NATIVE_TENANT, new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalTerminalDecisionDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION}"(
           $1, $2, 'plan', $3, $4, '', '{}'
         )`,
        [NATIVE_TENANT, "user_local", referenceRefreshMessageId, "A".repeat(43)]
      ),
      /does not match the expected authenticated principal/
    );
    await signalTerminalDecisionDirectClient.end();
    signalTerminalDecisionDirectClient = null;

    signalOfferIncidentDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalOfferIncidentDirectClient.on("error", () => undefined);
    await signalOfferIncidentDirectClient.connect();
    await signalOfferIncidentDirectClient.query(
      `SET ROLE "${signalOfferIncidentManifest.offerIncidentApplyRole.name}"`
    );
    await assert.rejects(
      signalOfferIncidentDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."offer_observations" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalOfferIncidentDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."signal_occurrences"(
           id, event_id, incident_id, source_connection_id,
           observed_at, received_at, created_at
         ) VALUES (
           'occurrence_ffffffffffffffffffffffffffffffff',
           'signal_event_ffffffffffffffffffffffffffffffff', NULL,
           'native_signal_source_a', $1, $1, $1
         )`,
        [new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalOfferIncidentDirectClient.query(
        `UPDATE "${NATIVE_SCHEMA}"."signal_incidents"
         SET occurrence_count = occurrence_count + 1 WHERE id = 'incident_cutover_other'`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalOfferIncidentDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION}"(
           $1, $2, 'plan', $3, $4, '', '{}'
         )`,
        [NATIVE_TENANT, "user_local", referenceRefreshMessageId, "A".repeat(43)]
      ),
      /does not match the expected authenticated principal/
    );
    await signalOfferIncidentDirectClient.end();
    signalOfferIncidentDirectClient = null;

    signalPostIncidentDecisionDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalPostIncidentDecisionDirectClient.on("error", () => undefined);
    await signalPostIncidentDecisionDirectClient.connect();
    await signalPostIncidentDecisionDirectClient.query(
      `SET ROLE "${signalPostIncidentDecisionManifest.postIncidentDecisionApplyRole.name}"`
    );
    await assert.rejects(
      signalPostIncidentDecisionDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."mission_decisions" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalPostIncidentDecisionDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."mission_decisions"(
           id, event_id, incident_id, mission_id, strategy_id, strategy_revision,
           decision_source, outcome, reason, effective_action, effective_quantity,
           effective_unit_cap_cents, created_at
         ) VALUES (
           'mission_decision_ffffffffffffffffffffffffffffffff',
           'signal_event_ffffffffffffffffffffffffffffffff', NULL, NULL, NULL, NULL,
           'strategy', 'forbidden', 'forbidden', 'notify', 1, NULL, $1
         )`,
        [new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalPostIncidentDecisionDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."audit_events"(
           id, tenant_id, user_id, correlation_id, event_type,
           reason_code, message, data_json, created_at
         ) VALUES (
           'audit_post_ffffffffffffffffffffffffffffffff', $1, $2,
           'signal-ffffffffffffffffffffffffffffffff', 'forbidden',
           'forbidden', 'forbidden', '{}', $3
         )`,
        [NATIVE_TENANT, NATIVE_USER, new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalPostIncidentDecisionDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."outbox_events"(
           id, tenant_id, aggregate_type, aggregate_id,
           event_type, payload_json, created_at, delivered_at
         ) VALUES (
           'outbox_post_ffffffffffffffffffffffffffffffff', $1, 'signal',
           'signal-ffffffffffffffffffffffffffffffff', 'forbidden', '{}', $2, ''
         )`,
        [NATIVE_TENANT, new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalPostIncidentDecisionDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION}"(
           $1, $2, 'plan', $3, $4, '', '{}'
         )`,
        [NATIVE_TENANT, "user_local", referenceRefreshMessageId, "A".repeat(43)]
      ),
      /does not match the expected authenticated principal/
    );
    await signalPostIncidentDecisionDirectClient.end();
    signalPostIncidentDecisionDirectClient = null;

    signalMissionBindingDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalMissionBindingDirectClient.on("error", () => undefined);
    await signalMissionBindingDirectClient.connect();
    await signalMissionBindingDirectClient.query(
      `SET ROLE "${signalMissionBindingManifest.missionBindingApplyRole.name}"`
    );
    await assert.rejects(
      signalMissionBindingDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."missions" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalMissionBindingDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."missions"(
           id, tenant_id, user_id, variant_id, status, origin,
           target_quantity, fulfilled_quantity, created_at, updated_at
         ) VALUES (
           'mission_forbidden', $1, $2, 'variant_native_mission_create',
           'active', 'forbidden', 1, 0, $3, $3
         )`,
        [NATIVE_TENANT, NATIVE_USER, new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalMissionBindingDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."mission_targets"(
           id, mission_id, listing_id, enabled, max_unit_price_cents,
           currency, seller_policy, fulfillment, created_at, updated_at
         ) VALUES (
           'mission_target_forbidden', $1, 'listing_native_mission_create',
           1, NULL, 'USD', 'inherit', 'inherit', $2, $2
         )`,
        [missionCreateWinner.missionId, new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalMissionBindingDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION}"(
           $1, $2, 'plan', $3, $4, '', '{}'
         )`,
        [NATIVE_TENANT, "user_local", missionCreateMessageId, "A".repeat(43)]
      ),
      /does not match the expected authenticated principal/
    );
    await signalMissionBindingDirectClient.end();
    signalMissionBindingDirectClient = null;

    signalStrategyEvaluationDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalStrategyEvaluationDirectClient.on("error", () => undefined);
    await signalStrategyEvaluationDirectClient.connect();
    await signalStrategyEvaluationDirectClient.query(
      `SET ROLE "${signalStrategyEvaluationManifest.strategyEvaluationRole.name}"`
    );
    await assert.rejects(
      signalStrategyEvaluationDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."strategies" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalStrategyEvaluationDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."mission_decisions"(
           id, event_id, incident_id, mission_id, decision_source,
           outcome, reason, effective_action, effective_quantity, created_at
         ) VALUES (
           'mission_decision_forbidden', 'signal_event_forbidden', NULL, NULL,
           'strategy', 'unmatched', 'forbidden', 'notify', 1, $1
         )`,
        [new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalStrategyEvaluationDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION}"(
           $1, $2, 'plan', $3, $4, '', $5
         )`,
        [
          NATIVE_TENANT,
          "user_local",
          missionCreateMessageId,
          "A".repeat(43),
          JSON.stringify({ attestation: terminalEvaluationAttestation })
        ]
      ),
      /does not match the expected authenticated principal/
    );
    await signalStrategyEvaluationDirectClient.end();
    signalStrategyEvaluationDirectClient = null;

    // Hoisted out of the IIFE below because they are still read much later
    // in this suite (constraint-config settings reads, and the concurrent
    // action-spend winner's job/reservation ids).
    type NativeConstraintSettingsRow = {
      actionsPaused: string | number;
      pauseReason: string;
      executionMode: string;
      dedupeWindowSeconds: number;
      affiliateMode: string;
      taxBps: number;
      storeAllowancesJson: string;
      updatedAt: string;
    };
    let readNativeConstraintSettings!: () => Promise<NativeConstraintSettingsRow>;
    let actionSpendGraphCounts!: () => Promise<Record<string, number>>;
    let actionSpendWinner!: PostgresSignalActionSpendApplyResult;
    await (async () => {
    const actionSpendNow = Date.now();
    const actionSpendMessageId = "inbox_abcdef0123456789abcdef0123456789";
    const actionSpendObservedAt = new Date(actionSpendNow - 1_000).toISOString();
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."variants"(
         id, family_id, title, attributes_json, created_at, updated_at
       ) VALUES (
         'variant_native_action_spend', 'family_cutover_scope',
         'Native atomic action and spend product', '{}', $1, $1
       )`,
      [actionSpendObservedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."listings"(
         id, variant_id, retailer_id, retailer_sku, canonical_url, status,
         execution_supported, msrp_cents, currency, created_at, updated_at
       ) VALUES (
         'listing_native_action_spend', 'variant_native_action_spend', 'target',
         'NATIVE-ACTION-SPEND',
         'https://www.target.com/p/native-action-spend/NATIVE-ACTION-SPEND',
         'in_stock', 1, 1599, 'USD', $1, $1
       )`,
      [actionSpendObservedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."source_product_refs"(
         id, source_connection_id, external_product_id, variant_id,
         source_url, source_title, observed_at
       ) VALUES (
         'source_product_native_action_spend', 'native_signal_source_a',
         'native-action-spend-product', 'variant_native_action_spend',
         'https://trackalacker.example/native-action-spend-product',
         'Native atomic action and spend product', $1
       )`,
      [actionSpendObservedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."source_listing_refs"(
         id, source_connection_id, external_listing_id, external_product_id,
         listing_id, source_url, observed_at
       ) VALUES (
         'source_listing_native_action_spend', 'native_signal_source_a',
         'native-action-spend-listing', 'native-action-spend-product',
         'listing_native_action_spend',
         'https://trackalacker.example/native-action-spend-listing', $1
       )`,
      [actionSpendObservedAt]
    );
    const actionSpendPayloadBase = resolutionSignalPayload(
      actionSpendMessageId,
      "native_signal_source_a",
      {
        sourceProductId: "native-action-spend-product",
        sourceListingId: "native-action-spend-listing",
        retailerId: "target",
        retailerSku: "NATIVE-ACTION-SPEND",
        canonicalUrl: "https://www.target.com/p/native-action-spend/NATIVE-ACTION-SPEND",
        title: "Native atomic action and spend product"
      }
    );
    const actionSpendPayload = {
      ...actionSpendPayloadBase,
      observedAt: actionSpendObservedAt,
      identity: {
        ...(actionSpendPayloadBase.identity as Record<string, unknown>),
        globalIdentifiers: { trackalacker_slug: "native-action-spend-product" }
      }
    };
    await insertSignalLifecycleInbox(
      actionSpendMessageId,
      NATIVE_TENANT,
      NATIVE_USER,
      0,
      new Date(actionSpendNow).toISOString(),
      actionSpendPayload
    );
    const actionSpendLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      actionSpendNow
    );
    assert.ok(actionSpendLease);
    assert.equal(actionSpendLease.id, actionSpendMessageId);
    assert.equal((await signalResolutionApplyA.applySignalEventResolution(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      actionSpendMessageId,
      actionSpendLease.capabilityToken,
      actionSpendNow
    )).duplicate, false);
    assert.equal((await signalSourceReferenceA.refreshSignalSourceReferences(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      actionSpendMessageId,
      actionSpendLease.capabilityToken,
      actionSpendNow
    )).downstreamSignalGraphMutated, false);
    assert.equal((await signalTerminalDecisionA.applySignalTerminalDecision(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      actionSpendMessageId,
      actionSpendLease.capabilityToken,
      actionSpendNow
    )).continueDownstream, true);
    const actionSpendIncident = await signalOfferIncidentA.applySignalOfferIncident(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      actionSpendMessageId,
      actionSpendLease.capabilityToken,
      actionSpendNow
    );
    assert.equal(actionSpendIncident.continueDownstream, true);
    assert.equal((await signalPostIncidentDecisionA.applySignalPostIncidentDecision(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      actionSpendMessageId,
      actionSpendLease.capabilityToken,
      actionSpendNow
    )).continueDownstream, true);
    const actionSpendBinding = await signalMissionBindingA.applySignalMissionBinding(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      actionSpendMessageId,
      actionSpendLease.capabilityToken,
      actionSpendNow
    );
    assert.equal(actionSpendBinding.missionCreated, true);
    const actionSpendTargetPolicy = [{
      targetId: actionSpendBinding.missionTargetId,
      listingId: "listing_native_action_spend",
      retailerId: "target",
      enabled: true,
      maxUnitPriceCents: 1300,
      sellerPolicy: "first_party_only",
      fulfillment: "shipping"
    }];
    const actionSpendPolicyHash = stableHash(
      "intent-policy-v2",
      actionSpendBinding.missionId,
      2,
      "USD",
      5000,
      "add_to_cart",
      "purchase_intent",
      120,
      "exact_only",
      "",
      0,
      JSON.stringify(actionSpendTargetPolicy)
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."mission_targets"
       SET max_unit_price_cents = 1300, seller_policy = 'first_party_only',
           fulfillment = 'shipping', updated_at = $2
       WHERE id = $1`,
      [
        actionSpendBinding.missionTargetId,
        new Date(actionSpendNow + 1).toISOString()
      ]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."mission_intent_revisions"(
         id, tenant_id, user_id, mission_id, revision, quantity, currency,
         max_all_in_cents, action_ceiling, substitution_policy, expires_at,
         cooldown_seconds, target_policy_json, policy_hash, change_reason,
         decision_mode, max_signal_age_seconds, created_by_actor_id, created_at
       ) VALUES (
         'intent_revision_native_action_spend', $1, $2, $3, 2, 1, 'USD',
         5000, 'add_to_cart', 'exact_only', '', 0, $4, $5,
         'Native bounded action/spend qualification.', 'purchase_intent', 120, $6, $7
       )`,
      [
        NATIVE_TENANT,
        NATIVE_USER,
        actionSpendBinding.missionId,
        JSON.stringify(actionSpendTargetPolicy),
        actionSpendPolicyHash,
        NATIVE_PRINCIPAL_A,
        new Date(actionSpendNow + 1).toISOString()
      ]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."user_spend_policies"(
         user_id, tenant_id, revision, currency, per_order_cap_cents,
         daily_cap_cents, monthly_cap_cents, order_submission_enabled,
         created_at, updated_at
       ) VALUES ($1, $2, 1, 'USD', NULL, NULL, NULL, 0, $3, $3)`,
      [NATIVE_USER, NATIVE_TENANT, new Date(actionSpendNow + 1).toISOString()]
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."app_settings"
       SET actions_paused = 0, pause_reason = '', execution_mode = 'live',
           affiliate_mode = 'disabled', updated_at = $1
       WHERE user_id = $2`,
      [new Date(actionSpendNow + 1).toISOString(), NATIVE_USER]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."retailer_adapter_qualifications"(
         tenant_id, user_id, retailer_id, adapter_version, highest_action,
         status, evidence_hash, qualified_at, updated_at
       ) VALUES ($1, $2, 'target', $3, 'add_to_cart', 'qualified', $4, $5, $5)
       ON CONFLICT (user_id, retailer_id) DO UPDATE SET
         adapter_version = EXCLUDED.adapter_version,
         highest_action = EXCLUDED.highest_action,
         status = EXCLUDED.status,
         evidence_hash = EXCLUDED.evidence_hash,
         qualified_at = EXCLUDED.qualified_at,
         updated_at = EXCLUDED.updated_at`,
      [
        NATIVE_TENANT,
        NATIVE_USER,
        TARGET_ADD_ADAPTER_VERSION,
        stableHash("native-action-spend-qualification", actionSpendBinding.missionId),
        new Date(actionSpendNow + 1).toISOString()
      ]
    );
    const actionSpendAttestation = await attestNativeSignalEvaluation({
      payload: actionSpendPayload,
      missionId: actionSpendBinding.missionId,
      missionTargetId: actionSpendBinding.missionTargetId,
      listingId: "listing_native_action_spend",
      missionEvaluationQuantity: 1,
      strategies: [],
      now: actionSpendNow
    });
    assert.equal(actionSpendAttestation.state, "matched");
    assert.equal(actionSpendAttestation.decisionSource, "purchase_intent");
    assert.equal(actionSpendAttestation.strategyId, "");
    assert.equal(actionSpendAttestation.effectiveUnitCapCents, 1199);
    assert.equal(actionSpendAttestation.effectiveAction, "add_to_cart");
    await assert.rejects(
      signalActionSpendB.applySignalActionSpend(
        { tenantId: "tenant_local", userId: "user_local" },
        actionSpendMessageId,
        actionSpendLease.capabilityToken,
        actionSpendAttestation,
        actionSpendNow
      ),
      /capability (?:is invalid or expired|validation failed)/
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [
        NATIVE_PRINCIPAL_C,
        NATIVE_TENANT,
        NATIVE_SAME_TENANT_USER,
        new Date(actionSpendNow).toISOString()
      ]
    );
    try {
      await assert.rejects(
        signalActionSpendC.applySignalActionSpend(
          { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
          actionSpendMessageId,
          actionSpendLease.capabilityToken,
          actionSpendAttestation,
          actionSpendNow
        ),
        /capability (?:is invalid or expired|validation failed)/
      );
    } finally {
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
         WHERE principal_role = $1`,
        [NATIVE_PRINCIPAL_C]
      );
    }
    await assert.rejects(
      signalActionSpendUnmapped.applySignalActionSpend(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        actionSpendMessageId,
        actionSpendLease.capabilityToken,
        actionSpendAttestation,
        actionSpendNow
      ),
      /tenant session principal is not active/
    );
    readNativeConstraintSettings = async (): Promise<NativeConstraintSettingsRow> =>
      (await first!.query<NativeConstraintSettingsRow>(
        `SELECT actions_paused AS "actionsPaused", pause_reason AS "pauseReason",
                execution_mode AS "executionMode",
                dedupe_window_seconds AS "dedupeWindowSeconds",
                affiliate_mode AS "affiliateMode", tax_bps AS "taxBps",
                store_allowances_json AS "storeAllowancesJson",
                updated_at AS "updatedAt"
         FROM "${NATIVE_SCHEMA}"."app_settings" WHERE user_id = $1`,
        [NATIVE_USER]
      )).rows[0]!;
    const readNativeConstraintEventCounts = async (): Promise<{
      audits: number;
      outbox: number;
    }> => {
      const row = (await first!.query<{ audits: string; outbox: string }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
             WHERE event_type IN (
               'actions_pause_changed', 'guardrail_settings_updated', 'spend_policy_revised'
             )) AS audits,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
             WHERE event_type IN (
               'actions_pause_changed', 'guardrail_settings_updated', 'spend_policy_revised'
             )) AS outbox`
      )).rows[0]!;
      return { audits: Number(row.audits), outbox: Number(row.outbox) };
    };
    const settingsBeforeForcedConstraintFailure = await readNativeConstraintSettings();
    const constraintEventsBeforeForcedFailure = await readNativeConstraintEventCounts();
    const nativeStoreAllowances = JSON.parse(
      settingsBeforeForcedConstraintFailure.storeAllowancesJson
    ) as Record<string, number>;
    const nativeGuardrailPayload = {
      expectedUpdatedAt: settingsBeforeForcedConstraintFailure.updatedAt,
      dedupeWindowSeconds: 301,
      affiliateMode: "disabled",
      taxBps: 1200,
      storeAllowancesCents: {
        target: nativeStoreAllowances.target,
        walmart: nativeStoreAllowances.walmart,
        amazon: nativeStoreAllowances.amazon,
        bestbuy: nativeStoreAllowances.bestbuy
      }
    };
    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_constraint_config_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $body$
       BEGIN
         IF NEW.event_type = 'guardrail_settings_updated' THEN
           RAISE EXCEPTION 'native forced constraint-configuration outbox failure';
         END IF;
         RETURN NEW;
       END
       $body$;
       CREATE TRIGGER "yoink_native_reject_constraint_config_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION
         "${NATIVE_SCHEMA}"."yoink_native_reject_constraint_config_outbox"()`
    );
    try {
      await assert.rejects(
        signalConstraintConfigA.applyConstraintConfiguration(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          "update_guardrail_settings",
          "native_constraint_forced_rollback",
          nativeGuardrailPayload
        ),
        /native forced constraint-configuration outbox failure/
      );
      assert.deepEqual(
        await readNativeConstraintSettings(),
        settingsBeforeForcedConstraintFailure
      );
      assert.deepEqual(
        await readNativeConstraintEventCounts(),
        constraintEventsBeforeForcedFailure
      );
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_constraint_config_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS
           "${NATIVE_SCHEMA}"."yoink_native_reject_constraint_config_outbox"()`
      );
    }
    const guardrailApply = await signalConstraintConfigA.applyConstraintConfiguration(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      "update_guardrail_settings",
      "native_constraint_guardrails",
      nativeGuardrailPayload
    );
    assert.equal(guardrailApply.outcome, "applied");
    assert.equal(guardrailApply.mutationApplied, true);
    assert.equal(guardrailApply.idempotentReplay, false);
    assert.equal(guardrailApply.mutationStatementCount, 3);
    assert.equal(guardrailApply.mutationRowCount, 3);
    assert.equal(guardrailApply.settingsMutated, true);
    assert.equal(guardrailApply.spendPolicyMutated, false);
    assert.equal(guardrailApply.auditMutated, true);
    assert.equal(guardrailApply.outboxMutated, true);
    assert.equal(guardrailApply.configuration.dedupeWindowSeconds, 301);
    assert.equal(guardrailApply.configuration.affiliateMode, "disabled");
    assert.equal(guardrailApply.configuration.taxBps, 1200);
    assert.equal(guardrailApply.configurationWriterParity, false);
    assert.equal(guardrailApply.reservationWriterParity, false);
    assert.equal(guardrailApply.writerLockProtocolParity, false);
    const guardrailReplay = await signalConstraintConfigASecond.applyConstraintConfiguration(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      "update_guardrail_settings",
      "native_constraint_guardrails",
      nativeGuardrailPayload
    );
    assert.equal(guardrailReplay.outcome, "already_applied");
    assert.equal(guardrailReplay.mutationApplied, false);
    assert.equal(guardrailReplay.idempotentReplay, true);
    assert.equal(guardrailReplay.mutationStatementCount, 0);
    assert.deepEqual(guardrailReplay.configuration, guardrailApply.configuration);
    await assert.rejects(
      signalConstraintConfigA.applyConstraintConfiguration(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "update_guardrail_settings",
        "native_constraint_guardrails",
        {
          ...nativeGuardrailPayload,
          expectedUpdatedAt: guardrailApply.configuration.updatedAt,
          dedupeWindowSeconds: 302
        }
      ),
      /replay graph changed/
    );
    await assert.rejects(
      signalConstraintConfigB.applyConstraintConfiguration(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "update_guardrail_settings",
        "native_constraint_wrong_principal",
        {
          ...nativeGuardrailPayload,
          expectedUpdatedAt: guardrailApply.configuration.updatedAt
        }
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      signalConstraintConfigUnmapped.applyConstraintConfiguration(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "update_guardrail_settings",
        "native_constraint_unmapped_principal",
        {
          ...nativeGuardrailPayload,
          expectedUpdatedAt: guardrailApply.configuration.updatedAt
        }
      ),
      /tenant session principal is not active/
    );
    const nativeSpendPolicyPayload = {
      expectedRevision: 1,
      perOrderCapCents: 6000,
      dailyCapCents: 12000,
      monthlyCapCents: 30000
    };
    const spendPolicyApply = await signalConstraintConfigA.applyConstraintConfiguration(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      "update_spend_policy",
      "native_constraint_spend_policy",
      nativeSpendPolicyPayload
    );
    assert.equal(spendPolicyApply.outcome, "applied");
    assert.equal(spendPolicyApply.mutationStatementCount, 3);
    assert.equal(spendPolicyApply.mutationRowCount, 3);
    assert.equal(spendPolicyApply.settingsMutated, false);
    assert.equal(spendPolicyApply.spendPolicyMutated, true);
    assert.equal(spendPolicyApply.configuration.revision, 2);
    assert.equal(spendPolicyApply.configuration.perOrderCapCents, 6000);
    assert.equal(spendPolicyApply.configuration.dailyCapCents, 12000);
    assert.equal(spendPolicyApply.configuration.monthlyCapCents, 30000);
    const spendPolicyReplay = await signalConstraintConfigASecond.applyConstraintConfiguration(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      "update_spend_policy",
      "native_constraint_spend_policy",
      nativeSpendPolicyPayload
    );
    assert.equal(spendPolicyReplay.outcome, "already_applied");
    assert.equal(spendPolicyReplay.idempotentReplay, true);
    assert.deepEqual(spendPolicyReplay.configuration, spendPolicyApply.configuration);
    const spendPolicyUnchanged = await signalConstraintConfigA.applyConstraintConfiguration(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      "update_spend_policy",
      "native_constraint_spend_policy_unchanged",
      { ...nativeSpendPolicyPayload, expectedRevision: 2 }
    );
    assert.equal(spendPolicyUnchanged.outcome, "unchanged");
    assert.equal(spendPolicyUnchanged.mutationApplied, false);
    assert.equal(spendPolicyUnchanged.idempotentReplay, false);
    assert.equal(spendPolicyUnchanged.mutationStatementCount, 0);
    assert.equal(spendPolicyUnchanged.mutationRowCount, 0);
    assert.equal(spendPolicyUnchanged.auditMutated, false);
    assert.equal(spendPolicyUnchanged.outboxMutated, false);
    actionSpendGraphCounts = async (): Promise<Record<string, number>> => {
      const row = (await first!.query<Record<string, string | number | bigint>>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."exact_offer_keys"
             WHERE listing_id = 'listing_native_action_spend') AS "exactOffers",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."offer_snapshots"
             WHERE mission_id = $1) AS snapshots,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."action_jobs"
             WHERE mission_id = $1) AS jobs,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."action_events"
             WHERE job_id IN (SELECT id FROM "${NATIVE_SCHEMA}"."action_jobs"
               WHERE mission_id = $1)) AS "actionEvents",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."spend_reservations"
             WHERE mission_id = $1) AS reservations,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."spend_ledger_entries"
             WHERE action_job_id IN (SELECT id FROM "${NATIVE_SCHEMA}"."action_jobs"
               WHERE mission_id = $1)) AS ledger,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."mission_decisions"
             WHERE mission_id = $1 AND outcome = 'qualified') AS decisions,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
             WHERE event_type = 'action_job_created'
               AND correlation_id IN (SELECT id FROM "${NATIVE_SCHEMA}"."action_jobs"
                 WHERE mission_id = $1)) AS audits,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
             WHERE event_type = 'action_job_created'
               AND aggregate_id IN (SELECT id FROM "${NATIVE_SCHEMA}"."action_jobs"
                 WHERE mission_id = $1)) AS outbox`,
        [actionSpendBinding.missionId]
      )).rows[0]!;
      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, Number(value)])
      );
    };
    const emptyActionSpendGraph = {
      exactOffers: 0,
      snapshots: 0,
      jobs: 0,
      actionEvents: 0,
      reservations: 0,
      ledger: 0,
      decisions: 0,
      audits: 0,
      outbox: 0
    };
    assert.deepEqual(await actionSpendGraphCounts(), emptyActionSpendGraph);
    const settingsBeforeConstraintContention = await readNativeConstraintSettings();
    const constraintDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalConstraintConfigDirectClient = constraintDirectClient;
    constraintDirectClient.on("error", () => undefined);
    await constraintDirectClient.connect();
    await constraintDirectClient.query(
      `SET ROLE "${signalConstraintConfigManifest.constraintConfigRole.name}"`
    );
    await assert.rejects(
      constraintDirectClient.query(
        `SELECT user_id FROM "${NATIVE_SCHEMA}"."app_settings" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      constraintDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_FUNCTION}"(
           $1, $2, 'set_actions_paused', $3, $4
         )`,
        [
          NATIVE_TENANT,
          "user_local",
          "native_constraint_direct_wrong_principal",
          JSON.stringify({
            expectedUpdatedAt: settingsBeforeConstraintContention.updatedAt,
            paused: true,
            reason: "Native direct principal rejection"
          })
        ]
      ),
      /does not match the expected authenticated principal/
    );
    let constraintContentionTransactionOpen = false;
    let constraintBlockedActionAttempt: ReturnType<
      NodePostgresSignalActionSpendApplyDatabase["applySignalActionSpend"]
    > | null = null;
    try {
      await constraintDirectClient.query("BEGIN");
      constraintContentionTransactionOpen = true;
      const pauseReceipt = await constraintDirectClient.query<{ resultJson: string }>(
        `SELECT result_json AS "resultJson"
         FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_FUNCTION}"(
           $1, $2, 'set_actions_paused', $3, $4
         )`,
        [
          NATIVE_TENANT,
          NATIVE_USER,
          "native_constraint_pause_for_action",
          JSON.stringify({
            expectedUpdatedAt: settingsBeforeConstraintContention.updatedAt,
            paused: true,
            reason: "Native config/action contention"
          })
        ]
      );
      assert.equal(pauseReceipt.rows.length, 1);
      assert.deepEqual(JSON.parse(pauseReceipt.rows[0]!.resultJson), {
        contractVersion: 1,
        operation: "set_actions_paused",
        requestId: "native_constraint_pause_for_action",
        requestFingerprint: JSON.parse(pauseReceipt.rows[0]!.resultJson).requestFingerprint,
        outcome: "applied",
        mutationApplied: true,
        idempotentReplay: false,
        mutationStatementCount: 3,
        mutationRowCount: 3,
        settingsMutated: true,
        spendPolicyMutated: false,
        auditMutated: true,
        outboxMutated: true,
        configuration: JSON.parse(pauseReceipt.rows[0]!.resultJson).configuration,
        configurationWriterParity: false,
        reservationWriterParity: false,
        writerLockProtocolParity: false,
        mutationAuthority: true,
        runtimeAuthority: false
      });
      const pauseResult = JSON.parse(pauseReceipt.rows[0]!.resultJson) as {
        requestFingerprint: string;
        configuration: Record<string, unknown>;
      };
      assert.match(pauseResult.requestFingerprint, /^[a-f0-9]{64}$/);
      assert.equal(pauseResult.configuration.actionsPaused, true);
      assert.equal(
        pauseResult.configuration.pauseReason,
        "Native config/action contention"
      );
      let constraintBlockedActionSettled = false;
      constraintBlockedActionAttempt = signalActionSpendA.applySignalActionSpend(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        actionSpendMessageId,
        actionSpendLease.capabilityToken,
        actionSpendAttestation,
        actionSpendNow
      ).finally(() => { constraintBlockedActionSettled = true; });
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      assert.equal(constraintBlockedActionSettled, false);
      assert.deepEqual(await actionSpendGraphCounts(), emptyActionSpendGraph);
      await constraintDirectClient.query("COMMIT");
      constraintContentionTransactionOpen = false;
      await assert.rejects(
        constraintBlockedActionAttempt,
        /live canonical execution settings are closed/
      );
    } finally {
      if (constraintContentionTransactionOpen) {
        await constraintDirectClient.query("ROLLBACK").catch(() => undefined);
      }
      if (constraintBlockedActionAttempt) {
        await constraintBlockedActionAttempt.catch(() => undefined);
      }
      await constraintDirectClient.end().catch(() => undefined);
      signalConstraintConfigDirectClient = null;
    }
    const settingsAfterConstraintPause = await readNativeConstraintSettings();
    assert.equal(Number(settingsAfterConstraintPause.actionsPaused), 1);
    const constraintResume = await signalConstraintConfigASecond.applyConstraintConfiguration(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      "set_actions_paused",
      "native_constraint_resume_after_contention",
      {
        expectedUpdatedAt: settingsAfterConstraintPause.updatedAt,
        paused: false,
        reason: ""
      }
    );
    assert.equal(constraintResume.outcome, "applied");
    assert.equal(constraintResume.settingsMutated, true);
    assert.equal(constraintResume.configuration.actionsPaused, false);
    assert.equal(constraintResume.configuration.pauseReason, "");
    assert.deepEqual(await actionSpendGraphCounts(), emptyActionSpendGraph);
    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_action_spend_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $body$
       BEGIN
         IF NEW.event_type = 'action_job_created' THEN
           RAISE EXCEPTION 'native forced action/spend outbox failure';
         END IF;
         RETURN NEW;
       END
       $body$;
       CREATE TRIGGER "yoink_native_reject_action_spend_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_action_spend_outbox"()`
    );
    try {
      await assert.rejects(
        signalActionSpendA.applySignalActionSpend(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          actionSpendMessageId,
          actionSpendLease.capabilityToken,
          actionSpendAttestation,
          actionSpendNow
        ),
        (error: unknown) => {
          const postgresError = error as Error & {
            where?: string;
            internalQuery?: string;
            position?: string;
          };
          assert.match(
            postgresError.message,
            /native forced action\/spend outbox failure/,
            `Unexpected action/spend PostgreSQL error context: ${JSON.stringify({
              message: postgresError.message,
              where: postgresError.where ?? "",
              internalQuery: postgresError.internalQuery ?? "",
              position: postgresError.position ?? ""
            })}`
          );
          return true;
        }
      );
      assert.deepEqual(await actionSpendGraphCounts(), emptyActionSpendGraph);
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_action_spend_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS "${NATIVE_SCHEMA}"."yoink_native_reject_action_spend_outbox"()`
      );
    }
    signalWriterLockDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalWriterLockDirectClient.on("error", () => undefined);
    await signalWriterLockDirectClient.connect();
    await signalWriterLockDirectClient.query(
      `SET ROLE "${signalWriterLockManifest.writerLockRole.name}"`
    );
    await assert.rejects(
      signalWriterLockDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION}"(
           $1, $2, $3, 'target', $4, $5
         )`,
        [
          NATIVE_TENANT,
          "user_local",
          "native_signal_source_a",
          actionSpendBinding.missionId,
          POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK
        ]
      ),
      /does not match the expected authenticated principal/
    );
    await signalWriterLockDirectClient.query("BEGIN");
    const lockReceipt = await signalWriterLockDirectClient.query<{ resultJson: string }>(
      `SELECT result_json AS "resultJson"
       FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION}"(
         $1, $2, $3, 'target', $4, $5
       )`,
      [
        NATIVE_TENANT,
        NATIVE_USER,
        "native_signal_source_a",
        actionSpendBinding.missionId,
        POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK
      ]
    );
    assert.deepEqual(JSON.parse(lockReceipt.rows[0]!.resultJson), {
      contractVersion: 1,
      lockProtocolVersion: "signal_action_constraints_v1",
      lockMask: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK,
      scopeCount: 5,
      lockScopeOrder: [
        "source", "retailer_qualification", "settings", "mission_policy", "spend"
      ],
      sourceConnectionId: "native_signal_source_a",
      retailerId: "target",
      missionId: actionSpendBinding.missionId,
      mutationApplied: false,
      mutationAuthority: false,
      runtimeAuthority: false
    });
    let actionSpendSettledCount = 0;
    const firstActionSpendAttempt = signalActionSpendA.applySignalActionSpend(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        actionSpendMessageId,
        actionSpendLease.capabilityToken,
        actionSpendAttestation,
        actionSpendNow
      ).finally(() => { actionSpendSettledCount += 1; });
    const secondActionSpendAttempt = signalActionSpendASecond.applySignalActionSpend(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        actionSpendMessageId,
        actionSpendLease.capabilityToken,
        actionSpendAttestation,
        actionSpendNow
      ).finally(() => { actionSpendSettledCount += 1; });
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    assert.equal(actionSpendSettledCount, 0);
    assert.deepEqual(await actionSpendGraphCounts(), emptyActionSpendGraph);
    await signalWriterLockDirectClient.query("COMMIT");
    await signalWriterLockDirectClient.end();
    signalWriterLockDirectClient = null;
    const concurrentActionSpend = await Promise.all([
      firstActionSpendAttempt,
      secondActionSpendAttempt
    ]);
    const actionSpendWinnerFound = concurrentActionSpend.find(
      (result) => result.actionSpendApplyApplied
    );
    const actionSpendReplay = concurrentActionSpend.find(
      (result) => !result.actionSpendApplyApplied
    );
    assert.ok(actionSpendWinnerFound);
    assert.ok(actionSpendReplay);
    actionSpendWinner = actionSpendWinnerFound;
    assert.equal(actionSpendWinner.initialJobState, "awaiting_executor");
    assert.equal(actionSpendWinner.action, "add_to_cart");
    assert.equal(actionSpendWinner.quantity, 1);
    assert.equal(actionSpendWinner.unitPriceCents, 1199);
    assert.equal(actionSpendWinner.effectiveUnitCapCents, 1199);
    assert.equal(actionSpendWinner.maximumAllInCents, 4343);
    assert.equal(actionSpendWinner.sellerName, "Target");
    assert.equal(actionSpendWinner.sellerType, "first_party");
    assert.equal(actionSpendWinner.fulfillment, "shipping");
    assert.equal(actionSpendWinner.exactOfferAction, "insert");
    assert.equal(actionSpendWinner.offerSnapshotAction, "insert");
    assert.equal(actionSpendWinner.mutationStatementCount, 10);
    assert.equal(actionSpendWinner.mutationRowCount, 10);
    assert.equal(actionSpendWinner.actionJobMutated, true);
    assert.equal(actionSpendWinner.spendReservationMutated, true);
    assert.equal(actionSpendWinner.retailerMutation, false);
    assert.equal(actionSpendWinner.checkoutMutation, false);
    assert.equal(actionSpendWinner.orderSubmissionMutation, false);
    assert.equal(actionSpendWinner.inboxLifecycleMutation, false);
    assert.equal(actionSpendReplay.immutableReplay, true);
    assert.equal(actionSpendReplay.mutationStatementCount, 0);
    assert.equal(actionSpendReplay.actionJobMutated, false);
    assert.deepEqual(await actionSpendGraphCounts(), {
      exactOffers: 1,
      snapshots: 1,
      jobs: 1,
      actionEvents: 1,
      reservations: 1,
      ledger: 1,
      decisions: 1,
      audits: 1,
      outbox: 1
    });
    assert.deepEqual((await first.query<{
      jobState: string;
      jobAction: string;
      jobQuantity: number;
      attributionProvider: string;
      affiliateMode: string;
      reservationStatus: string;
      reservedAmountCents: number;
      ledgerEntryType: string;
      reservedDeltaCents: number;
      outcome: string;
    }>(
      `SELECT job.state AS "jobState", job.action AS "jobAction",
              job.quantity AS "jobQuantity",
              job.attribution_provider AS "attributionProvider",
              job.affiliate_mode AS "affiliateMode",
              reservation.status AS "reservationStatus",
              reservation.reserved_amount_cents AS "reservedAmountCents",
              ledger.entry_type AS "ledgerEntryType",
              ledger.reserved_delta_cents AS "reservedDeltaCents",
              decision.outcome
       FROM "${NATIVE_SCHEMA}"."action_jobs" AS job
       JOIN "${NATIVE_SCHEMA}"."spend_reservations" AS reservation
         ON reservation.id = job.spend_reservation_id
       JOIN "${NATIVE_SCHEMA}"."spend_ledger_entries" AS ledger
         ON ledger.reservation_id = reservation.id
       JOIN "${NATIVE_SCHEMA}"."mission_decisions" AS decision
         ON decision.mission_id = job.mission_id AND decision.outcome = 'qualified'
       WHERE job.id = $1`,
      [actionSpendWinner.actionJobId]
    )).rows.map((row) => ({
      ...row,
      jobQuantity: Number(row.jobQuantity),
      reservedAmountCents: Number(row.reservedAmountCents),
      reservedDeltaCents: Number(row.reservedDeltaCents)
    })), [{
      jobState: "awaiting_executor",
      jobAction: "add_to_cart",
      jobQuantity: 1,
      attributionProvider: "canonical",
      affiliateMode: "disabled",
      reservationStatus: "active",
      reservedAmountCents: 4343,
      ledgerEntryType: "reserved",
      reservedDeltaCents: 4343,
      outcome: "qualified"
    }]);
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."action_jobs"
       SET state = 'leased', updated_at = $2 WHERE id = $1`,
      [actionSpendWinner.actionJobId, new Date(actionSpendNow + 2).toISOString()]
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."outbox_events"
       SET delivery_state = 'delivered', delivery_attempts = 1,
           delivered_at = $2, updated_at = $2
       WHERE aggregate_id = $1 AND event_type = 'action_job_created'`,
      [actionSpendWinner.actionJobId, new Date(actionSpendNow + 2).toISOString()]
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."app_settings"
       SET actions_paused = 1, pause_reason = 'Native qualification restored',
           execution_mode = 'shadow', affiliate_mode = 'prefer_fallback', updated_at = $1
       WHERE user_id = $2`,
      [
        new Date(actionSpendNow + 2).toISOString(),
        NATIVE_USER
      ]
    );
    const lifecycleReplay = await signalActionSpendA.applySignalActionSpend(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      actionSpendMessageId,
      actionSpendLease.capabilityToken,
      actionSpendAttestation,
      actionSpendNow
    );
    assert.equal(lifecycleReplay.actionSpendApplyApplied, false);
    assert.equal(lifecycleReplay.immutableReplay, true);
    assert.equal(lifecycleReplay.mutationStatementCount, 0);
    signalActionSpendDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalActionSpendDirectClient.on("error", () => undefined);
    await signalActionSpendDirectClient.connect();
    await signalActionSpendDirectClient.query(
      `SET ROLE "${signalActionSpendManifest.actionSpendRole.name}"`
    );
    await assert.rejects(
      signalActionSpendDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."action_jobs" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalActionSpendDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_ACTION_SPEND_APPLY_FUNCTION}"(
           $1, $2, 'plan', $3, $4, '', $5
         )`,
        [
          NATIVE_TENANT,
          "user_local",
          actionSpendMessageId,
          actionSpendLease.capabilityToken,
          JSON.stringify({ attestation: actionSpendAttestation })
        ]
      ),
      /does not match the expected authenticated principal/
    );
    await signalActionSpendDirectClient.end();
    signalActionSpendDirectClient = null;
    })();

    await (async () => {
      // ---- Trusted strategy action semantics (contract v2) ----
      const strategyActionSpendNow = Date.now();
      const strategyActionSpendMessageId = "inbox_aa11bb22cc33dd44aa11bb22cc33dd44";
      const strategyActionSpendObservedAt = new Date(strategyActionSpendNow - 1_000).toISOString();
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."variants"(
           id, family_id, title, attributes_json, created_at, updated_at
         ) VALUES (
           'variant_native_strategy_action_spend', 'family_cutover_scope',
           'Native trusted strategy action/spend product', '{}', $1, $1
         )`,
        [strategyActionSpendObservedAt]
      );
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."listings"(
           id, variant_id, retailer_id, retailer_sku, canonical_url, status,
           execution_supported, msrp_cents, currency, created_at, updated_at
         ) VALUES (
           'listing_native_strategy_action_spend', 'variant_native_strategy_action_spend',
           'target', 'NATIVE-STRATEGY-ACTION-SPEND',
           'https://www.target.com/p/native-strategy-action-spend/NATIVE-STRATEGY-ACTION-SPEND',
           'in_stock', 1, 1599, 'USD', $1, $1
         )`,
        [strategyActionSpendObservedAt]
      );
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."source_product_refs"(
           id, source_connection_id, external_product_id, variant_id,
           source_url, source_title, observed_at
         ) VALUES (
           'source_product_native_strategy_action_spend', 'native_signal_source_a',
           'native-strategy-action-spend-product', 'variant_native_strategy_action_spend',
           'https://trackalacker.example/native-strategy-action-spend-product',
           'Native trusted strategy action/spend product', $1
         )`,
        [strategyActionSpendObservedAt]
      );
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."source_listing_refs"(
           id, source_connection_id, external_listing_id, external_product_id,
           listing_id, source_url, observed_at
         ) VALUES (
           'source_listing_native_strategy_action_spend', 'native_signal_source_a',
           'native-strategy-action-spend-listing', 'native-strategy-action-spend-product',
           'listing_native_strategy_action_spend',
           'https://trackalacker.example/native-strategy-action-spend-listing', $1
         )`,
        [strategyActionSpendObservedAt]
      );
      const strategyActionSpendPayloadBase = resolutionSignalPayload(
        strategyActionSpendMessageId,
        "native_signal_source_a",
        {
          sourceProductId: "native-strategy-action-spend-product",
          sourceListingId: "native-strategy-action-spend-listing",
          retailerId: "target",
          retailerSku: "NATIVE-STRATEGY-ACTION-SPEND",
          canonicalUrl:
            "https://www.target.com/p/native-strategy-action-spend/NATIVE-STRATEGY-ACTION-SPEND",
          title: "Native trusted strategy action/spend product"
        }
      );
      const strategyActionSpendPayload = {
        ...strategyActionSpendPayloadBase,
        observedAt: strategyActionSpendObservedAt,
        identity: {
          ...(strategyActionSpendPayloadBase.identity as Record<string, unknown>),
          globalIdentifiers: { trackalacker_slug: "native-strategy-action-spend-product" }
        },
        offer: {
          // A strategy may request more than one unit; an order limit of 1
          // (the fixture default) would otherwise force `quantity_limited`.
          ...(strategyActionSpendPayloadBase.offer as Record<string, unknown>),
          orderLimit: null
        }
      };
      await insertSignalLifecycleInbox(
        strategyActionSpendMessageId,
        NATIVE_TENANT,
        NATIVE_USER,
        0,
        new Date(strategyActionSpendNow).toISOString(),
        strategyActionSpendPayload
      );
      const strategyActionSpendLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendNow
      );
      assert.ok(strategyActionSpendLease);
      assert.equal(strategyActionSpendLease.id, strategyActionSpendMessageId);
      assert.equal((await signalResolutionApplyA.applySignalEventResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendMessageId,
        strategyActionSpendLease.capabilityToken,
        strategyActionSpendNow
      )).duplicate, false);
      assert.equal((await signalSourceReferenceA.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendMessageId,
        strategyActionSpendLease.capabilityToken,
        strategyActionSpendNow
      )).downstreamSignalGraphMutated, false);
      assert.equal((await signalTerminalDecisionA.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendMessageId,
        strategyActionSpendLease.capabilityToken,
        strategyActionSpendNow
      )).continueDownstream, true);
      assert.equal((await signalOfferIncidentA.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendMessageId,
        strategyActionSpendLease.capabilityToken,
        strategyActionSpendNow
      )).continueDownstream, true);
      assert.equal((await signalPostIncidentDecisionA.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendMessageId,
        strategyActionSpendLease.capabilityToken,
        strategyActionSpendNow
      )).continueDownstream, true);
      const strategyActionSpendBinding = await signalMissionBindingA.applySignalMissionBinding(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendMessageId,
        strategyActionSpendLease.capabilityToken,
        strategyActionSpendNow
      );
      assert.equal(strategyActionSpendBinding.missionCreated, true);
      // A strategy may bind quantity > 1 (only purchase-intent is pinned to 1);
      // widen the mission's target quantity so both a single-unit and a
      // multi-unit strategy decision are valid against it below.
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."missions"
         SET target_quantity = 3, updated_at = $2 WHERE id = $1`,
        [strategyActionSpendBinding.missionId, new Date(strategyActionSpendNow + 1).toISOString()]
      );
      const strategyActionSpendTargetPolicy = [{
        targetId: strategyActionSpendBinding.missionTargetId,
        listingId: "listing_native_strategy_action_spend",
        retailerId: "target",
        enabled: true,
        maxUnitPriceCents: null,
        sellerPolicy: "inherit",
        fulfillment: "inherit"
      }];
      const strategyActionSpendPolicyHash = stableHash(
        "intent-policy-v2",
        strategyActionSpendBinding.missionId,
        3,
        "USD",
        5000,
        "add_to_cart",
        "strategy",
        120,
        "exact_only",
        "",
        0,
        JSON.stringify(strategyActionSpendTargetPolicy)
      );
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."mission_intent_revisions"(
           id, tenant_id, user_id, mission_id, revision, quantity, currency,
           max_all_in_cents, action_ceiling, substitution_policy, expires_at,
           cooldown_seconds, target_policy_json, policy_hash, change_reason,
           decision_mode, max_signal_age_seconds, created_by_actor_id, created_at
         ) VALUES (
           'intent_revision_native_strategy_action_spend', $1, $2, $3, 2, 3, 'USD',
           5000, 'add_to_cart', 'exact_only', '', 0, $4, $5,
           'Native trusted strategy action/spend qualification.', 'strategy', 120, $6, $7
         )`,
        [
          NATIVE_TENANT,
          NATIVE_USER,
          strategyActionSpendBinding.missionId,
          JSON.stringify(strategyActionSpendTargetPolicy),
          strategyActionSpendPolicyHash,
          NATIVE_PRINCIPAL_A,
          new Date(strategyActionSpendNow + 1).toISOString()
        ]
      );
      const strategyActionSpendGraphCounts = async (): Promise<Record<string, number>> => {
        const row = (await first!.query<Record<string, string | number | bigint>>(
          `SELECT
             (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."action_jobs"
               WHERE mission_id = $1) AS jobs,
             (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."action_events"
               WHERE job_id IN (SELECT id FROM "${NATIVE_SCHEMA}"."action_jobs"
                 WHERE mission_id = $1)) AS "actionEvents",
             (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."spend_reservations"
               WHERE mission_id = $1) AS reservations,
             (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."spend_ledger_entries"
               WHERE action_job_id IN (SELECT id FROM "${NATIVE_SCHEMA}"."action_jobs"
                 WHERE mission_id = $1)) AS ledger,
             (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."mission_decisions"
               WHERE mission_id = $1 AND outcome = 'qualified') AS decisions,
             (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
               WHERE event_type = 'action_job_created'
                 AND correlation_id IN (SELECT id FROM "${NATIVE_SCHEMA}"."action_jobs"
                   WHERE mission_id = $1)) AS audits,
             (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
               WHERE event_type = 'action_job_created'
                 AND aggregate_id IN (SELECT id FROM "${NATIVE_SCHEMA}"."action_jobs"
                   WHERE mission_id = $1)) AS outbox`,
          [strategyActionSpendBinding.missionId]
        )).rows[0]!;
        return Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, Number(value)])
        );
      };
      const emptyStrategyActionSpendGraph = {
        jobs: 0, actionEvents: 0, reservations: 0, ledger: 0,
        decisions: 0, audits: 0, outbox: 0
      };
      assert.deepEqual(await strategyActionSpendGraphCounts(), emptyStrategyActionSpendGraph);

      // (a) A valid strategy-sourced apply creates a notify-only action job:
      // zero spend_reservations/spend_ledger_entries rows, correct
      // quantity/all-in fields, exactly one audit/outbox append.
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."strategies" WHERE tenant_id = $1 AND user_id = $2`,
        [NATIVE_TENANT, NATIVE_USER]
      );

      // (c) disabled / missing / wrong-revision strategy fails closed with
      // zero writes. All three surface identically: the strategy-set
      // fingerprint the shared evaluation-apply boundary recomputes (which
      // embeds every strategy's enabled flag and revision) no longer matches
      // what was attested, so the nested plan call this function makes into
      // that boundary rejects before this function's own dedicated
      // strategies-table recheck is ever reached.
      //
      // A third, independent signal event is required here too: once ANY
      // decision exists for (event_id, mission_id) — as (a) already created
      // — the shared evaluation-apply boundary treats every further
      // evaluation of that same pair as its own "replay discovery" and
      // skips the strategy-set fingerprint check entirely, landing on
      // "actionable signal already has a terminal mission decision"
      // instead of exercising the fail-closed behavior under test.
      const strategyActionSpendFailClosedMessageId = "inbox_cc33dd44ee55ff66cc33dd44ee55ff66";
      const strategyActionSpendFailClosedPayload = {
        ...strategyActionSpendPayload,
        signalId: `signal-${strategyActionSpendFailClosedMessageId}`,
        externalEventId: `event-${strategyActionSpendFailClosedMessageId}`,
        offer: {
          ...(strategyActionSpendPayload.offer as Record<string, unknown>),
          offerFingerprint: stableHash("offer", strategyActionSpendFailClosedMessageId)
        }
      };
      await insertSignalLifecycleInbox(
        strategyActionSpendFailClosedMessageId,
        NATIVE_TENANT,
        NATIVE_USER,
        0,
        new Date(strategyActionSpendNow + 4).toISOString(),
        strategyActionSpendFailClosedPayload
      );
      const strategyActionSpendFailClosedLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendNow
      );
      assert.ok(strategyActionSpendFailClosedLease);
      assert.equal(strategyActionSpendFailClosedLease.id, strategyActionSpendFailClosedMessageId);
      assert.equal((await signalResolutionApplyA.applySignalEventResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendFailClosedMessageId,
        strategyActionSpendFailClosedLease.capabilityToken,
        strategyActionSpendNow
      )).duplicate, false);
      assert.equal((await signalSourceReferenceA.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendFailClosedMessageId,
        strategyActionSpendFailClosedLease.capabilityToken,
        strategyActionSpendNow
      )).downstreamSignalGraphMutated, false);
      assert.equal((await signalTerminalDecisionA.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendFailClosedMessageId,
        strategyActionSpendFailClosedLease.capabilityToken,
        strategyActionSpendNow
      )).continueDownstream, true);
      assert.equal((await signalOfferIncidentA.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendFailClosedMessageId,
        strategyActionSpendFailClosedLease.capabilityToken,
        strategyActionSpendNow
      )).continueDownstream, true);
      assert.equal((await signalPostIncidentDecisionA.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendFailClosedMessageId,
        strategyActionSpendFailClosedLease.capabilityToken,
        strategyActionSpendNow
      )).continueDownstream, true);
      const strategyActionSpendFailClosedBinding = await signalMissionBindingA.applySignalMissionBinding(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendFailClosedMessageId,
        strategyActionSpendFailClosedLease.capabilityToken,
        strategyActionSpendNow
      );
      assert.equal(strategyActionSpendFailClosedBinding.outcome, "already_bound");
      assert.equal(
        strategyActionSpendFailClosedBinding.missionId,
        strategyActionSpendBinding.missionId
      );
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."strategies" WHERE tenant_id = $1 AND user_id = $2`,
        [NATIVE_TENANT, NATIVE_USER]
      );
      const strategyActionSpendFailClosedStrategy: StrategyDefinition = {
        id: "strategy_native_action_spend_fail_closed",
        name: "Native strategy fail closed",
        enabled: true,
        position: 1,
        revision: 1,
        sources: ["trackalacker"],
        retailers: ["target"],
        pricePolicy: { kind: "absolute_max", maxPriceCents: 1_300 },
        sellerPolicy: "first_party_only",
        allowedSellers: ["target"],
        includeKeywords: "",
        excludeKeywords: "",
        action: "notify",
        quantity: 1,
        fulfillment: "shipping",
        maxSignalAgeSeconds: 120
      };
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."strategies"(
           id, tenant_id, user_id, name, enabled, position, revision,
           definition_json, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 1, 1, 1, $5, $6, $6)`,
        [
          strategyActionSpendFailClosedStrategy.id,
          NATIVE_TENANT,
          NATIVE_USER,
          strategyActionSpendFailClosedStrategy.name,
          JSON.stringify(strategyActionSpendFailClosedStrategy),
          new Date(strategyActionSpendNow + 4).toISOString()
        ]
      );
      const strategyActionSpendFailClosedAttestation = await attestNativeSignalEvaluation({
        payload: strategyActionSpendFailClosedPayload,
        missionId: strategyActionSpendBinding.missionId,
        missionTargetId: strategyActionSpendBinding.missionTargetId,
        listingId: "listing_native_strategy_action_spend",
        missionEvaluationQuantity: 3,
        strategies: [strategyActionSpendFailClosedStrategy],
        now: strategyActionSpendNow
      });
      assert.equal(strategyActionSpendFailClosedAttestation.state, "matched");
      assert.equal(
        strategyActionSpendFailClosedAttestation.strategyId,
        strategyActionSpendFailClosedStrategy.id
      );
      assert.equal(strategyActionSpendFailClosedAttestation.strategyRevision, 1);
      const strategyActionSpendGraphBeforeFailClosed = await strategyActionSpendGraphCounts();
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."strategies" SET enabled = 0, updated_at = $2 WHERE id = $1`,
        [strategyActionSpendFailClosedStrategy.id, new Date(strategyActionSpendNow + 5).toISOString()]
      );
      await assert.rejects(
        signalActionSpendA.applySignalActionSpend(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          strategyActionSpendFailClosedMessageId,
          strategyActionSpendFailClosedLease.capabilityToken,
          strategyActionSpendFailClosedAttestation,
          strategyActionSpendNow
        ),
        /strategy snapshot changed/
      );
      assert.deepEqual(await strategyActionSpendGraphCounts(), strategyActionSpendGraphBeforeFailClosed);
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."strategies" SET enabled = 1, updated_at = $2 WHERE id = $1`,
        [strategyActionSpendFailClosedStrategy.id, new Date(strategyActionSpendNow + 6).toISOString()]
      );
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."strategies" SET revision = 2, updated_at = $2 WHERE id = $1`,
        [strategyActionSpendFailClosedStrategy.id, new Date(strategyActionSpendNow + 7).toISOString()]
      );
      await assert.rejects(
        signalActionSpendA.applySignalActionSpend(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          strategyActionSpendFailClosedMessageId,
          strategyActionSpendFailClosedLease.capabilityToken,
          strategyActionSpendFailClosedAttestation,
          strategyActionSpendNow
        ),
        /strategy snapshot changed/
      );
      assert.deepEqual(await strategyActionSpendGraphCounts(), strategyActionSpendGraphBeforeFailClosed);
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."strategies" SET revision = 1, updated_at = $2 WHERE id = $1`,
        [strategyActionSpendFailClosedStrategy.id, new Date(strategyActionSpendNow + 8).toISOString()]
      );
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."strategies" WHERE id = $1`,
        [strategyActionSpendFailClosedStrategy.id]
      );
      await assert.rejects(
        signalActionSpendA.applySignalActionSpend(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          strategyActionSpendFailClosedMessageId,
          strategyActionSpendFailClosedLease.capabilityToken,
          strategyActionSpendFailClosedAttestation,
          strategyActionSpendNow
        ),
        /strategy snapshot changed/
      );
      assert.deepEqual(await strategyActionSpendGraphCounts(), strategyActionSpendGraphBeforeFailClosed);

      const strategyActionSpendCartMessageId = "inbox_bb22cc33dd44ee55bb22cc33dd44ee55";
      const strategyActionSpendCartPayload = {
        ...strategyActionSpendPayload,
        signalId: `signal-${strategyActionSpendCartMessageId}`,
        externalEventId: `event-${strategyActionSpendCartMessageId}`,
        offer: {
          ...(strategyActionSpendPayload.offer as Record<string, unknown>),
          offerFingerprint: stableHash("offer", strategyActionSpendCartMessageId)
        }
      };
      await insertSignalLifecycleInbox(
        strategyActionSpendCartMessageId,
        NATIVE_TENANT,
        NATIVE_USER,
        0,
        new Date(strategyActionSpendNow + 3).toISOString(),
        strategyActionSpendCartPayload
      );
      const strategyActionSpendCartLease = await deliveryLeaseRecoveryA.leaseSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendNow
      );
      assert.ok(strategyActionSpendCartLease);
      assert.equal(strategyActionSpendCartLease.id, strategyActionSpendCartMessageId);
      assert.equal((await signalResolutionApplyA.applySignalEventResolution(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendCartMessageId,
        strategyActionSpendCartLease.capabilityToken,
        strategyActionSpendNow
      )).duplicate, false);
      assert.equal((await signalSourceReferenceA.refreshSignalSourceReferences(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendCartMessageId,
        strategyActionSpendCartLease.capabilityToken,
        strategyActionSpendNow
      )).downstreamSignalGraphMutated, false);
      assert.equal((await signalTerminalDecisionA.applySignalTerminalDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendCartMessageId,
        strategyActionSpendCartLease.capabilityToken,
        strategyActionSpendNow
      )).continueDownstream, true);
      assert.equal((await signalOfferIncidentA.applySignalOfferIncident(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendCartMessageId,
        strategyActionSpendCartLease.capabilityToken,
        strategyActionSpendNow
      )).continueDownstream, true);
      assert.equal((await signalPostIncidentDecisionA.applySignalPostIncidentDecision(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendCartMessageId,
        strategyActionSpendCartLease.capabilityToken,
        strategyActionSpendNow
      )).continueDownstream, true);
      const strategyActionSpendCartBinding = await signalMissionBindingA.applySignalMissionBinding(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendCartMessageId,
        strategyActionSpendCartLease.capabilityToken,
        strategyActionSpendNow
      );
      assert.equal(strategyActionSpendCartBinding.outcome, "already_bound");
      assert.equal(strategyActionSpendCartBinding.missionId, strategyActionSpendBinding.missionId);
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."strategies" WHERE tenant_id = $1 AND user_id = $2`,
        [NATIVE_TENANT, NATIVE_USER]
      );
      const strategyActionSpendCartStrategy: StrategyDefinition = {
        id: "strategy_native_action_spend_cart",
        name: "Native strategy add to cart",
        enabled: true,
        position: 1,
        revision: 1,
        sources: ["trackalacker"],
        retailers: ["target"],
        pricePolicy: { kind: "absolute_max", maxPriceCents: 1_300 },
        sellerPolicy: "first_party_only",
        allowedSellers: ["target"],
        includeKeywords: "",
        excludeKeywords: "",
        action: "add_to_cart",
        quantity: 3,
        fulfillment: "shipping",
        maxSignalAgeSeconds: 120
      };
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."strategies"(
           id, tenant_id, user_id, name, enabled, position, revision,
           definition_json, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 1, 1, 1, $5, $6, $6)`,
        [
          strategyActionSpendCartStrategy.id,
          NATIVE_TENANT,
          NATIVE_USER,
          strategyActionSpendCartStrategy.name,
          JSON.stringify(strategyActionSpendCartStrategy),
          new Date(strategyActionSpendNow + 3).toISOString()
        ]
      );
      const strategyActionSpendCartAttestation = await attestNativeSignalEvaluation({
        payload: strategyActionSpendCartPayload,
        missionId: strategyActionSpendBinding.missionId,
        missionTargetId: strategyActionSpendBinding.missionTargetId,
        listingId: "listing_native_strategy_action_spend",
        missionEvaluationQuantity: 3,
        strategies: [strategyActionSpendCartStrategy],
        now: strategyActionSpendNow
      });
      assert.equal(strategyActionSpendCartAttestation.state, "matched");
      assert.equal(strategyActionSpendCartAttestation.decisionSource, "strategy");
      assert.equal(strategyActionSpendCartAttestation.strategyId, strategyActionSpendCartStrategy.id);
      // The domain evaluator (SQLite truth) really did select add_to_cart —
      // proving it is the Postgres boundary itself, not the evaluator, that
      // forces the failover asserted below.
      assert.equal(strategyActionSpendCartAttestation.effectiveAction, "add_to_cart");
      assert.equal(strategyActionSpendCartAttestation.effectiveQuantity, 3);
      assert.equal(strategyActionSpendCartAttestation.effectiveUnitCapCents, 1199);
      const strategyActionSpendCartResult = await signalActionSpendA.applySignalActionSpend(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendCartMessageId,
        strategyActionSpendCartLease.capabilityToken,
        strategyActionSpendCartAttestation,
        strategyActionSpendNow
      );
      assert.equal(strategyActionSpendCartResult.actionSpendApplyApplied, true);
      assert.equal(strategyActionSpendCartResult.decisionSource, "strategy");
      assert.equal(strategyActionSpendCartResult.action, "notify");
      assert.equal(strategyActionSpendCartResult.initialJobState, "notify_only");
      assert.equal(strategyActionSpendCartResult.quantity, 3);
      assert.equal(strategyActionSpendCartResult.unitPriceCents, 1199);
      assert.equal(strategyActionSpendCartResult.effectiveUnitCapCents, 1199);
      assert.equal(strategyActionSpendCartResult.maximumAllInCents, 3_597);
      // A distinct signal event carries its own offer fingerprint, so this
      // is a fresh exact-offer identity too (not a reuse of (a)'s).
      assert.equal(strategyActionSpendCartResult.exactOfferAction, "insert");
      assert.equal(strategyActionSpendCartResult.offerSnapshotAction, "insert");
      assert.equal(strategyActionSpendCartResult.spendReservationAction, "none");
      assert.equal(strategyActionSpendCartResult.spendLedgerAction, "none");
      assert.equal(strategyActionSpendCartResult.actionJobReservationLinkAction, "none");
      assert.equal(strategyActionSpendCartResult.mutationStatementCount, 7);
      assert.equal(strategyActionSpendCartResult.mutationRowCount, 7);
      assert.equal(strategyActionSpendCartResult.actionJobMutated, true);
      assert.equal(strategyActionSpendCartResult.spendReservationMutated, false);
      assert.deepEqual(await strategyActionSpendGraphCounts(), {
        jobs: 1, actionEvents: 1, reservations: 0, ledger: 0,
        decisions: 1, audits: 1, outbox: 1
      });
      assert.deepEqual((await first.query<{
        jobAction: string;
        jobQuantity: number;
        snapshotQuantity: number;
      }>(
        `SELECT job.action AS "jobAction", job.quantity AS "jobQuantity",
                snapshot.quantity AS "snapshotQuantity"
         FROM "${NATIVE_SCHEMA}"."action_jobs" AS job
         JOIN "${NATIVE_SCHEMA}"."offer_snapshots" AS snapshot ON snapshot.id = job.offer_snapshot_id
         WHERE job.id = $1`,
        [strategyActionSpendCartResult.actionJobId]
      )).rows.map((row) => ({
        ...row,
        jobQuantity: Number(row.jobQuantity),
        snapshotQuantity: Number(row.snapshotQuantity)
      })), [{ jobAction: "notify", jobQuantity: 3, snapshotQuantity: 1 }]);

      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."strategies" WHERE tenant_id = $1 AND user_id = $2`,
        [NATIVE_TENANT, NATIVE_USER]
      );
      const strategyActionSpendNotifyStrategy: StrategyDefinition = {
        id: "strategy_native_action_spend_notify",
        name: "Native strategy notify",
        enabled: true,
        position: 1,
        revision: 1,
        sources: ["trackalacker"],
        retailers: ["target"],
        pricePolicy: { kind: "absolute_max", maxPriceCents: 1_300 },
        sellerPolicy: "first_party_only",
        allowedSellers: ["target"],
        includeKeywords: "",
        excludeKeywords: "",
        action: "notify",
        quantity: 1,
        fulfillment: "shipping",
        maxSignalAgeSeconds: 120
      };
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."strategies"(
           id, tenant_id, user_id, name, enabled, position, revision,
           definition_json, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 1, 1, 1, $5, $6, $6)`,
        [
          strategyActionSpendNotifyStrategy.id,
          NATIVE_TENANT,
          NATIVE_USER,
          strategyActionSpendNotifyStrategy.name,
          JSON.stringify(strategyActionSpendNotifyStrategy),
          new Date(strategyActionSpendNow + 2).toISOString()
        ]
      );
      const strategyActionSpendNotifyAttestation = await attestNativeSignalEvaluation({
        payload: strategyActionSpendPayload,
        missionId: strategyActionSpendBinding.missionId,
        missionTargetId: strategyActionSpendBinding.missionTargetId,
        listingId: "listing_native_strategy_action_spend",
        missionEvaluationQuantity: 3,
        strategies: [strategyActionSpendNotifyStrategy],
        now: strategyActionSpendNow
      });
      assert.equal(strategyActionSpendNotifyAttestation.state, "matched");
      assert.equal(strategyActionSpendNotifyAttestation.decisionSource, "strategy");
      assert.equal(strategyActionSpendNotifyAttestation.strategyId, strategyActionSpendNotifyStrategy.id);
      assert.equal(strategyActionSpendNotifyAttestation.strategyRevision, 1);
      assert.equal(strategyActionSpendNotifyAttestation.effectiveAction, "notify");
      assert.equal(strategyActionSpendNotifyAttestation.effectiveQuantity, 1);
      assert.equal(strategyActionSpendNotifyAttestation.effectiveUnitCapCents, 1199);
      const strategyActionSpendNotifyResult = await signalActionSpendA.applySignalActionSpend(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendMessageId,
        strategyActionSpendLease.capabilityToken,
        strategyActionSpendNotifyAttestation,
        strategyActionSpendNow
      );
      assert.equal(strategyActionSpendNotifyResult.actionSpendApplyApplied, true);
      assert.equal(strategyActionSpendNotifyResult.decisionSource, "strategy");
      assert.equal(strategyActionSpendNotifyResult.strategyId, strategyActionSpendNotifyStrategy.id);
      assert.equal(strategyActionSpendNotifyResult.strategyRevision, 1);
      assert.equal(strategyActionSpendNotifyResult.action, "notify");
      assert.equal(strategyActionSpendNotifyResult.initialJobState, "notify_only");
      assert.equal(strategyActionSpendNotifyResult.quantity, 1);
      assert.equal(strategyActionSpendNotifyResult.unitPriceCents, 1199);
      assert.equal(strategyActionSpendNotifyResult.effectiveUnitCapCents, 1199);
      assert.equal(strategyActionSpendNotifyResult.maximumAllInCents, 1199);
      assert.equal(strategyActionSpendNotifyResult.sellerName, "Target");
      assert.equal(strategyActionSpendNotifyResult.sellerType, "first_party");
      assert.equal(strategyActionSpendNotifyResult.fulfillment, "shipping");
      assert.equal(strategyActionSpendNotifyResult.exactOfferAction, "insert");
      assert.equal(strategyActionSpendNotifyResult.offerSnapshotAction, "insert");
      assert.equal(strategyActionSpendNotifyResult.spendReservationAction, "none");
      assert.equal(strategyActionSpendNotifyResult.spendLedgerAction, "none");
      assert.equal(strategyActionSpendNotifyResult.actionJobReservationLinkAction, "none");
      assert.equal(strategyActionSpendNotifyResult.mutationStatementCount, 7);
      assert.equal(strategyActionSpendNotifyResult.mutationRowCount, 7);
      assert.equal(strategyActionSpendNotifyResult.actionJobMutated, true);
      assert.equal(strategyActionSpendNotifyResult.spendReservationMutated, false);
      assert.equal(strategyActionSpendNotifyResult.retailerMutation, false);
      assert.equal(strategyActionSpendNotifyResult.checkoutMutation, false);
      assert.equal(strategyActionSpendNotifyResult.orderSubmissionMutation, false);
      assert.equal(strategyActionSpendNotifyResult.inboxLifecycleMutation, false);
      assert.deepEqual(await strategyActionSpendGraphCounts(), {
        jobs: 2, actionEvents: 2, reservations: 0, ledger: 0,
        decisions: 2, audits: 2, outbox: 2
      });
      assert.deepEqual((await first.query<{
        jobState: string;
        jobAction: string;
        jobQuantity: number;
        jobStrategyId: string;
        jobStrategyRevision: number;
        jobSpendReservationId: string | null;
        eventState: string;
        eventReasonCode: string;
        outcome: string;
      }>(
        `SELECT job.state AS "jobState", job.action AS "jobAction",
                job.quantity AS "jobQuantity",
                job.strategy_id AS "jobStrategyId",
                job.strategy_revision AS "jobStrategyRevision",
                job.spend_reservation_id AS "jobSpendReservationId",
                event.state AS "eventState", event.reason_code AS "eventReasonCode",
                decision.outcome
         FROM "${NATIVE_SCHEMA}"."action_jobs" AS job
         JOIN "${NATIVE_SCHEMA}"."action_events" AS event ON event.job_id = job.id
         JOIN "${NATIVE_SCHEMA}"."mission_decisions" AS decision
           ON decision.mission_id = job.mission_id AND decision.outcome = 'qualified'
          AND decision.strategy_id = job.strategy_id
         WHERE job.id = $1`,
        [strategyActionSpendNotifyResult.actionJobId]
      )).rows.map((row) => ({
        ...row,
        jobQuantity: Number(row.jobQuantity),
        jobStrategyRevision: Number(row.jobStrategyRevision)
      })), [{
        jobState: "notify_only",
        jobAction: "notify",
        jobQuantity: 1,
        jobStrategyId: strategyActionSpendNotifyStrategy.id,
        jobStrategyRevision: 1,
        jobSpendReservationId: null,
        eventState: "notify_only",
        eventReasonCode: "strategy_qualified",
        outcome: "qualified"
      }]);

      // (b) A strategy decision attempting action add_to_cart in the plan is
      // unconditionally forced to notify in SQL (never a fail-closed
      // rejection, and never cart/spend authority) — the only place a
      // strategy-sourced action_jobs.action value is ever assigned. Quantity
      // > 1 is honored on the job/decision (maximumAllInCents = cap *
      // quantity), while the offer snapshot's own quantity column stays 1
      // (the v1-shared insert).
      //
      // A second, independent signal event is required: a mission_decisions
      // row already exists for (event_id, mission_id) from (a) above, and
      // the shared evaluation-apply boundary this function calls internally
      // fails closed ("actionable signal already has a terminal mission
      // decision") if a fresh (non-replay) evaluation targets an event that
      // already has one.
      assert.notEqual(
        strategyActionSpendCartResult.actionJobId,
        strategyActionSpendNotifyResult.actionJobId
      );




      // (d) Immutable replay of the strategy job returns the original result;
      // the replay's own consistency check requires spend_reservation_id IS
      // NULL for a strategy-sourced job (never true for purchase-intent).
      const strategyActionSpendNotifyReplay = await signalActionSpendA.applySignalActionSpend(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendMessageId,
        strategyActionSpendLease.capabilityToken,
        strategyActionSpendNotifyAttestation,
        strategyActionSpendNow
      );
      assert.equal(strategyActionSpendNotifyReplay.actionSpendApplyApplied, false);
      assert.equal(strategyActionSpendNotifyReplay.immutableReplay, true);
      assert.equal(strategyActionSpendNotifyReplay.mutationStatementCount, 0);
      assert.equal(strategyActionSpendNotifyReplay.actionJobMutated, false);
      assert.equal(strategyActionSpendNotifyReplay.spendReservationMutated, false);
      assert.equal(strategyActionSpendNotifyReplay.actionJobId, strategyActionSpendNotifyResult.actionJobId);
      assert.equal(strategyActionSpendNotifyReplay.action, "notify");
      assert.equal(strategyActionSpendNotifyReplay.quantity, 1);
      assert.equal(strategyActionSpendNotifyReplay.maximumAllInCents, 1199);
      assert.deepEqual(await strategyActionSpendGraphCounts(), {
        jobs: 2, actionEvents: 2, reservations: 0, ledger: 0,
        decisions: 2, audits: 2, outbox: 2
      });
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."action_jobs"
         SET spend_reservation_id = $2, updated_at = $3 WHERE id = $1`,
        [
          strategyActionSpendNotifyResult.actionJobId,
          actionSpendWinner.spendReservationId,
          new Date(strategyActionSpendNow + 9).toISOString()
        ]
      );
      await assert.rejects(
        signalActionSpendA.applySignalActionSpend(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          strategyActionSpendMessageId,
          strategyActionSpendLease.capabilityToken,
          strategyActionSpendNotifyAttestation,
          strategyActionSpendNow
        ),
        /replay graph changed/
      );
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."action_jobs"
         SET spend_reservation_id = NULL, updated_at = $2 WHERE id = $1`,
        [strategyActionSpendNotifyResult.actionJobId, new Date(strategyActionSpendNow + 10).toISOString()]
      );
      const strategyActionSpendNotifyReplayRestored = await signalActionSpendA.applySignalActionSpend(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        strategyActionSpendMessageId,
        strategyActionSpendLease.capabilityToken,
        strategyActionSpendNotifyAttestation,
        strategyActionSpendNow
      );
      assert.equal(strategyActionSpendNotifyReplayRestored.immutableReplay, true);
      assert.equal(strategyActionSpendNotifyReplayRestored.actionSpendApplyApplied, false);
      assert.deepEqual(await strategyActionSpendGraphCounts(), {
        jobs: 2, actionEvents: 2, reservations: 0, ledger: 0,
        decisions: 2, audits: 2, outbox: 2
      });

      // (e) The v1 purchase-intent proofs above remain untouched and passing —
      // the strategy proofs above ran against an independent mission, so the
      // original purchase-intent action/spend graph is unaffected.
      assert.deepEqual(await actionSpendGraphCounts(), {
        exactOffers: 1,
        snapshots: 1,
        jobs: 1,
        actionEvents: 1,
        reservations: 1,
        ledger: 1,
        decisions: 1,
        audits: 1,
        outbox: 1
      });
    })();

    const targetQualificationNow = Date.now();
    const targetQualificationObservedAt = new Date(targetQualificationNow - 1_000).toISOString();
    const targetQualificationExpiresAt = new Date(targetQualificationNow + 300_000).toISOString();
    const targetObservationEvidence = ["1".repeat(64), "2".repeat(64)];
    const targetTrialEvidence = "3".repeat(64);
    const targetQualificationEvidenceHash = stableHash(
      "target-add-qualification-evidence-v1",
      TARGET_ADD_ADAPTER_VERSION,
      ...[...targetObservationEvidence, targetTrialEvidence].sort()
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."extension_devices"(
         id, tenant_id, user_id, name, token_hash, extension_version,
         status, capabilities_json, last_seen_at, created_at, updated_at,
         credential_generation, credential_issued_at
       ) VALUES (
         'native_target_qualification_device', $1, $2,
         'Native Target qualification device', $3, '0.87.0', 'active', $4,
         $5, $5, $5, 1, $5
       )`,
      [
        NATIVE_TENANT,
        NATIVE_USER,
        stableHash("native-target-qualification-device-token"),
        JSON.stringify({
          targetAddOnly: true,
          targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION
        }),
        targetQualificationObservedAt
      ]
    );
    for (const [index, evidenceHash] of targetObservationEvidence.entries()) {
      const sku = `${index + 1}`.repeat(8);
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."retailer_shadow_observations"(
           id, tenant_id, user_id, device_id, retailer_id, adapter_version,
           contract_version, page_kind, retailer_sku, canonical_url,
           availability, unit_price_cents, currency, seller_name, seller_type,
           fulfillment, add_control_actionable, security_challenge,
           interactive_block, observation_state, evidence_hash,
           observed_at, received_at
         ) VALUES (
           $1, $2, $3, 'native_target_qualification_device', 'target', $4,
           1, 'product', $5, $6, 'in_stock', $7, 'USD', 'Target',
           'first_party', 'shipping', 1, 0, '', 'actionable_candidate',
           $8, $9, $9
         )`,
        [
          `native_target_qualification_observation_${index + 1}`,
          NATIVE_TENANT,
          NATIVE_USER,
          TARGET_OBSERVER_VERSION,
          sku,
          `https://www.target.com/p/-/A-${sku}`,
          799 + index,
          evidenceHash,
          targetQualificationObservedAt
        ]
      );
    }
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."retailer_adapter_trials"(
         id, tenant_id, user_id, device_id, retailer_id, adapter_version,
         observer_version, contract_version, trial_kind, shadow_observation_id,
         retailer_sku, outcome, reason_code, evidence_hash, observed_at, received_at
       ) VALUES (
         'native_target_qualification_trial', $1, $2,
         'native_target_qualification_device', 'target', $3, $4, 1,
         'pre_click_rehearsal', 'native_target_qualification_observation_1',
         '11111111', 'passed', 'rehearsal_passed', $5, $6, $6
       )`,
      [
        NATIVE_TENANT,
        NATIVE_USER,
        TARGET_ADD_ADAPTER_VERSION,
        TARGET_OBSERVER_VERSION,
        targetTrialEvidence,
        targetQualificationObservedAt
      ]
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."action_jobs"
       SET state = 'shadow_ready', expires_at = $2, updated_at = $3
       WHERE id = $1`,
      [
        actionSpendWinner.actionJobId,
        targetQualificationExpiresAt,
        targetQualificationObservedAt
      ]
    );
    const targetSettingsSeedAt = new Date(targetQualificationNow - 500).toISOString();
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."app_settings"
       SET actions_paused = 1, pause_reason = 'Native Target qualification gate',
           execution_mode = 'shadow', updated_at = $1
       WHERE user_id = $2`,
      [targetSettingsSeedAt, NATIVE_USER]
    );
    const targetQualificationPayload = {
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      confirmation: TARGET_ADD_ACTIVATION_CONFIRMATION,
      evidenceHash: targetQualificationEvidenceHash,
      expectedSettingsUpdatedAt: targetSettingsSeedAt
    };
    const targetStateSnapshot = async () => {
      const row = (await first!.query<{
        actionsPaused: number;
        pauseReason: string;
        executionMode: string;
        settingsUpdatedAt: string;
        qualificationEvidenceHash: string;
        qualificationUpdatedAt: string;
        jobState: string;
        promotionEvents: string | number | bigint;
        qualificationAudits: string | number | bigint;
        qualificationOutbox: string | number | bigint;
      }>(
        `SELECT settings.actions_paused AS "actionsPaused",
                settings.pause_reason AS "pauseReason",
                settings.execution_mode AS "executionMode",
                settings.updated_at AS "settingsUpdatedAt",
                qualification.evidence_hash AS "qualificationEvidenceHash",
                qualification.updated_at AS "qualificationUpdatedAt",
                job.state AS "jobState",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."action_events" event
                 WHERE event.job_id = job.id
                   AND event.reason_code = 'target_add_v1_activated') AS "promotionEvents",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events" audit
                 WHERE audit.user_id = $1
                   AND audit.event_type = 'retailer_adapter_qualified'
                   AND audit.reason_code = 'explicit_target_add_v1_activation') AS "qualificationAudits",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events" outbox
                 WHERE outbox.tenant_id = $2
                   AND outbox.aggregate_type = 'retailer_qualification'
                   AND outbox.aggregate_id = 'target'
                   AND outbox.event_type = 'retailer_adapter_qualified') AS "qualificationOutbox"
         FROM "${NATIVE_SCHEMA}"."app_settings" settings
         JOIN "${NATIVE_SCHEMA}"."retailer_adapter_qualifications" qualification
           ON qualification.user_id = settings.user_id
          AND qualification.retailer_id = 'target'
         JOIN "${NATIVE_SCHEMA}"."action_jobs" job ON job.id = $3
         WHERE settings.user_id = $1`,
        [NATIVE_USER, NATIVE_TENANT, actionSpendWinner.actionJobId]
      )).rows[0]!;
      return {
        ...row,
        actionsPaused: Number(row.actionsPaused),
        promotionEvents: Number(row.promotionEvents),
        qualificationAudits: Number(row.qualificationAudits),
        qualificationOutbox: Number(row.qualificationOutbox)
      };
    };
    const targetStateBefore = await targetStateSnapshot();
    assert.equal(targetStateBefore.actionsPaused, 1);
    assert.equal(targetStateBefore.executionMode, "shadow");
    assert.equal(targetStateBefore.jobState, "shadow_ready");
    assert.equal(targetStateBefore.promotionEvents, 0);
    await assert.rejects(
      signalTargetQualificationB.applyTargetQualification(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "activate_target_add",
        "native_target_qualification_wrong_tenant_principal",
        targetQualificationPayload
      ),
      /does not match the expected authenticated principal/
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [
        NATIVE_PRINCIPAL_C,
        NATIVE_TENANT,
        NATIVE_SAME_TENANT_USER,
        targetQualificationObservedAt
      ]
    );
    try {
      await assert.rejects(
        signalTargetQualificationC.applyTargetQualification(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          "activate_target_add",
          "native_target_qualification_wrong_user_principal",
          targetQualificationPayload
        ),
        /does not match the expected authenticated principal/
      );
    } finally {
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
         WHERE principal_role = $1`,
        [NATIVE_PRINCIPAL_C]
      );
    }
    await assert.rejects(
      signalTargetQualificationUnmapped.applyTargetQualification(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "activate_target_add",
        "native_target_qualification_unmapped_principal",
        targetQualificationPayload
      ),
      /tenant session principal is not active/
    );
    signalTargetQualificationDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalTargetQualificationDirectClient.on("error", () => undefined);
    await signalTargetQualificationDirectClient.connect();
    await signalTargetQualificationDirectClient.query(
      `SET ROLE "${signalTargetQualificationManifest.targetQualificationRole.name}"`
    );
    await assert.rejects(
      signalTargetQualificationDirectClient.query(
        `SELECT user_id FROM "${NATIVE_SCHEMA}"."retailer_adapter_qualifications" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalTargetQualificationDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_FUNCTION}"(
           $1, $2, 'activate_target_add', $3, $4
         )`,
        [
          NATIVE_TENANT,
          "user_local",
          "native_target_qualification_direct_wrong_principal",
          JSON.stringify(targetQualificationPayload)
        ]
      ),
      /does not match the expected authenticated principal/
    );

    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_target_qualification_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $body$
       BEGIN
         IF NEW.event_type = 'retailer_adapter_qualified'
           AND NEW.aggregate_type = 'retailer_qualification'
           AND NEW.aggregate_id = 'target' THEN
           RAISE EXCEPTION 'native forced Target qualification outbox failure';
         END IF;
         RETURN NEW;
       END
       $body$;
       CREATE TRIGGER "yoink_native_reject_target_qualification_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_target_qualification_outbox"()`
    );
    try {
      await assert.rejects(
        signalTargetQualificationA.applyTargetQualification(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          "activate_target_add",
          "native_target_qualification_rollback",
          targetQualificationPayload
        ),
        /native forced Target qualification outbox failure/
      );
      assert.deepEqual(await targetStateSnapshot(), targetStateBefore);
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_target_qualification_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS "${NATIVE_SCHEMA}"."yoink_native_reject_target_qualification_outbox"()`
      );
    }

    let targetQualificationTransactionOpen = false;
    let blockedTargetReplay: ReturnType<
      NodePostgresSignalTargetQualificationApplyDatabase["applyTargetQualification"]
    > | null = null;
    let blockedTargetConfig: ReturnType<
      NodePostgresSignalConstraintConfigApplyDatabase["applyConstraintConfiguration"]
    > | null = null;
    try {
      await signalTargetQualificationDirectClient.query("BEGIN");
      targetQualificationTransactionOpen = true;
      const firstTargetQualification = await signalTargetQualificationDirectClient.query<{
        resultJson: string;
      }>(
        `SELECT result_json AS "resultJson"
         FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_FUNCTION}"(
           $1, $2, 'activate_target_add', $3, $4
         )`,
        [
          NATIVE_TENANT,
          NATIVE_USER,
          "native_target_qualification_apply",
          JSON.stringify(targetQualificationPayload)
        ]
      );
      const firstTargetResult = JSON.parse(firstTargetQualification.rows[0]!.resultJson) as {
        requestFingerprint: string;
        outcome: string;
        mutationApplied: boolean;
        mutationStatementCount: number;
        mutationRowCount: number;
        qualificationMutated: boolean;
        settingsMutated: boolean;
        promotedJobCount: number;
        actionEventsMutated: number;
        activation: Record<string, unknown>;
      };
      assert.match(firstTargetResult.requestFingerprint, /^[a-f0-9]{64}$/);
      assert.equal(firstTargetResult.outcome, "applied");
      assert.equal(firstTargetResult.mutationApplied, true);
      assert.equal(firstTargetResult.mutationStatementCount, 6);
      assert.equal(firstTargetResult.mutationRowCount, 6);
      assert.equal(firstTargetResult.qualificationMutated, true);
      assert.equal(firstTargetResult.settingsMutated, true);
      assert.equal(firstTargetResult.promotedJobCount, 1);
      assert.equal(firstTargetResult.actionEventsMutated, 1);
      assert.equal(firstTargetResult.activation.evidenceHash, targetQualificationEvidenceHash);
      assert.equal(firstTargetResult.activation.observationCount, 2);
      assert.equal(firstTargetResult.activation.distinctSkuCount, 2);
      assert.equal(firstTargetResult.activation.rehearsalCount, 1);
      assert.equal(firstTargetResult.activation.promotedJobs, 1);
      assert.equal((firstTargetResult.activation.promotions as unknown[]).length, 1);
      let targetReplaySettled = false;
      let targetConfigSettled = false;
      blockedTargetReplay = signalTargetQualificationASecond.applyTargetQualification(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "activate_target_add",
        "native_target_qualification_apply",
        targetQualificationPayload
      ).finally(() => { targetReplaySettled = true; });
      blockedTargetConfig = signalConstraintConfigA.applyConstraintConfiguration(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "set_actions_paused",
        "native_target_qualification_blocked_config",
        {
          expectedUpdatedAt: targetSettingsSeedAt,
          paused: true,
          reason: "Native Target qualification contention"
        }
      ).finally(() => { targetConfigSettled = true; });
      void blockedTargetConfig.catch(() => undefined);
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      assert.equal(targetReplaySettled, false);
      assert.equal(targetConfigSettled, false);
      assert.deepEqual(await targetStateSnapshot(), targetStateBefore);
      await signalTargetQualificationDirectClient.query("COMMIT");
      targetQualificationTransactionOpen = false;
      const replay = await blockedTargetReplay;
      assert.equal(replay.outcome, "already_applied");
      assert.equal(replay.mutationApplied, false);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.mutationStatementCount, 0);
      assert.equal(replay.mutationRowCount, 0);
      assert.equal(replay.promotedJobCount, 1);
      assert.equal(replay.actionEventsMutated, 0);
      await assert.rejects(blockedTargetConfig, /settings revision changed/);
    } finally {
      if (targetQualificationTransactionOpen) {
        await signalTargetQualificationDirectClient.query("ROLLBACK").catch(() => undefined);
      }
      if (blockedTargetReplay) await blockedTargetReplay.catch(() => undefined);
      if (blockedTargetConfig) await blockedTargetConfig.catch(() => undefined);
    }
    const targetStateAfter = await targetStateSnapshot();
    assert.equal(targetStateAfter.actionsPaused, 0);
    assert.equal(targetStateAfter.pauseReason, "");
    assert.equal(targetStateAfter.executionMode, "live");
    assert.notEqual(targetStateAfter.settingsUpdatedAt, targetSettingsSeedAt);
    assert.equal(targetStateAfter.qualificationEvidenceHash, targetQualificationEvidenceHash);
    assert.equal(targetStateAfter.qualificationUpdatedAt, targetStateAfter.settingsUpdatedAt);
    assert.equal(targetStateAfter.jobState, "awaiting_executor");
    assert.equal(targetStateAfter.promotionEvents, 1);
    assert.equal(targetStateAfter.qualificationAudits, targetStateBefore.qualificationAudits + 1);
    assert.equal(targetStateAfter.qualificationOutbox, targetStateBefore.qualificationOutbox + 1);
    await assert.rejects(
      signalTargetQualificationA.applyTargetQualification(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "activate_target_add",
        "native_target_qualification_apply",
        { ...targetQualificationPayload, evidenceHash: "f".repeat(64) }
      ),
      /replay graph changed/
    );
    await signalTargetQualificationDirectClient.end();
    signalTargetQualificationDirectClient = null;
    await Promise.all([
      signalTargetQualificationA.close(),
      signalTargetQualificationASecond.close(),
      signalTargetQualificationB.close(),
      signalTargetQualificationC.close(),
      signalTargetQualificationUnmapped.close()
    ]);
    signalTargetQualificationA = null;
    signalTargetQualificationASecond = null;
    signalTargetQualificationB = null;
    signalTargetQualificationC = null;
    signalTargetQualificationUnmapped = null;

    const signalSourceTrustDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalSourceTrustApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalSourceTrustManifest, { maxConnections });
    signalSourceTrustA = signalSourceTrustDatabase(NATIVE_PRINCIPAL_A, 2);
    signalSourceTrustASecond = signalSourceTrustDatabase(NATIVE_PRINCIPAL_A);
    signalSourceTrustB = signalSourceTrustDatabase(NATIVE_PRINCIPAL_B);
    signalSourceTrustC = signalSourceTrustDatabase(NATIVE_PRINCIPAL_C);
    signalSourceTrustUnmapped = signalSourceTrustDatabase(NATIVE_PRINCIPAL_UNMAPPED);
    const sourceTrustSnapshot = async (): Promise<{
      source: string;
      trustLevel: string;
      autoCreateMissions: number;
      updatedAt: string;
      auditCount: number;
      outboxCount: number;
    }> => {
      const row = (await first!.query<{
        source: string;
        trustLevel: string;
        autoCreateMissions: number;
        updatedAt: string;
        auditCount: string | number | bigint;
        outboxCount: string | number | bigint;
      }>(
        `SELECT connection.source, connection.trust_level AS "trustLevel",
                connection.auto_create_missions AS "autoCreateMissions",
                connection.updated_at AS "updatedAt",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events" audit
                 WHERE audit.user_id = $1
                   AND audit.correlation_id = connection.id
                   AND audit.event_type = 'source_trust_configured') AS "auditCount",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events" outbox
                 WHERE outbox.tenant_id = $2
                   AND outbox.aggregate_type = 'source_connection'
                   AND outbox.aggregate_id = connection.id
                   AND outbox.event_type = 'source_trust_configured') AS "outboxCount"
         FROM "${NATIVE_SCHEMA}"."source_connections" connection
         WHERE connection.id = 'native_signal_source_a'
           AND connection.tenant_id = $2 AND connection.user_id = $1`,
        [NATIVE_USER, NATIVE_TENANT]
      )).rows[0]!;
      return {
        ...row,
        autoCreateMissions: Number(row.autoCreateMissions),
        auditCount: Number(row.auditCount),
        outboxCount: Number(row.outboxCount)
      };
    };
    const sourceTrustBefore = await sourceTrustSnapshot();
    assert.equal(sourceTrustBefore.source, "trackalacker");
    assert.equal(sourceTrustBefore.trustLevel, "trusted_exact");
    assert.equal(sourceTrustBefore.autoCreateMissions, 1);
    const sourceTrustPayload = {
      sourceConnectionId: "native_signal_source_a",
      trustLevel: "informational",
      autoCreateMissions: false,
      expectedUpdatedAt: sourceTrustBefore.updatedAt,
      confirmation: POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_CONFIRMATION
    };
    await assert.rejects(
      signalSourceTrustB.applySourceTrust(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "configure_source_trust",
        "native_source_trust_wrong_tenant_principal",
        sourceTrustPayload
      ),
      /does not match the expected authenticated principal/
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [
        NATIVE_PRINCIPAL_C,
        NATIVE_TENANT,
        NATIVE_SAME_TENANT_USER,
        sourceTrustBefore.updatedAt
      ]
    );
    try {
      await assert.rejects(
        signalSourceTrustC.applySourceTrust(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          "configure_source_trust",
          "native_source_trust_wrong_user_principal",
          sourceTrustPayload
        ),
        /does not match the expected authenticated principal/
      );
    } finally {
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
         WHERE principal_role = $1`,
        [NATIVE_PRINCIPAL_C]
      );
    }
    await assert.rejects(
      signalSourceTrustUnmapped.applySourceTrust(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "configure_source_trust",
        "native_source_trust_unmapped_principal",
        sourceTrustPayload
      ),
      /tenant session principal is not active/
    );
    await assert.rejects(
      signalSourceTrustA.applySourceTrust(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "configure_source_trust",
        "native_source_trust_invalid_auto_create",
        { ...sourceTrustPayload, autoCreateMissions: true }
      ),
      /payload shape is invalid/
    );
    signalSourceTrustDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalSourceTrustDirectClient.on("error", () => undefined);
    await signalSourceTrustDirectClient.connect();
    await signalSourceTrustDirectClient.query(
      `SET ROLE "${signalSourceTrustManifest.sourceTrustRole.name}"`
    );
    await assert.rejects(
      signalSourceTrustDirectClient.query(
        `SELECT trust_level FROM "${NATIVE_SCHEMA}"."source_connections" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceTrustDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_FUNCTION}"(
           $1, $2, 'configure_source_trust', $3, $4
         )`,
        [
          NATIVE_TENANT,
          "user_local",
          "native_source_trust_direct_wrong_principal",
          JSON.stringify(sourceTrustPayload)
        ]
      ),
      /does not match the expected authenticated principal/
    );

    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_source_trust_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $body$
       BEGIN
         IF NEW.event_type = 'source_trust_configured'
           AND NEW.aggregate_type = 'source_connection'
           AND NEW.aggregate_id = 'native_signal_source_a' THEN
           RAISE EXCEPTION 'native forced source-trust outbox failure';
         END IF;
         RETURN NEW;
       END
       $body$;
       CREATE TRIGGER "yoink_native_reject_source_trust_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_source_trust_outbox"()`
    );
    try {
      await assert.rejects(
        signalSourceTrustA.applySourceTrust(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          "configure_source_trust",
          "native_source_trust_rollback",
          sourceTrustPayload
        ),
        /native forced source-trust outbox failure/
      );
      assert.deepEqual(await sourceTrustSnapshot(), sourceTrustBefore);
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_source_trust_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS "${NATIVE_SCHEMA}"."yoink_native_reject_source_trust_outbox"()`
      );
    }

    signalWriterLockDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalWriterLockDirectClient.on("error", () => undefined);
    await signalWriterLockDirectClient.connect();
    await signalWriterLockDirectClient.query(
      `SET ROLE "${signalWriterLockManifest.writerLockRole.name}"`
    );
    let sourceTrustTransactionOpen = false;
    let blockedSourceReplay: ReturnType<
      NodePostgresSignalSourceTrustApplyDatabase["applySourceTrust"]
    > | null = null;
    let blockedSourceLock: Promise<{ rows: Array<{ resultJson: string }> }> | null = null;
    try {
      await signalSourceTrustDirectClient.query("BEGIN");
      sourceTrustTransactionOpen = true;
      const firstSourceTrust = await signalSourceTrustDirectClient.query<{
        resultJson: string;
      }>(
        `SELECT result_json AS "resultJson"
         FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_FUNCTION}"(
           $1, $2, 'configure_source_trust', $3, $4
         )`,
        [
          NATIVE_TENANT,
          NATIVE_USER,
          "native_source_trust_apply",
          JSON.stringify(sourceTrustPayload)
        ]
      );
      const firstSourceResult = JSON.parse(firstSourceTrust.rows[0]!.resultJson) as {
        requestFingerprint: string;
        outcome: string;
        mutationApplied: boolean;
        mutationStatementCount: number;
        mutationRowCount: number;
        sourceMutated: boolean;
        auditMutated: boolean;
        outboxMutated: boolean;
        configuration: Record<string, unknown>;
      };
      assert.match(firstSourceResult.requestFingerprint, /^[a-f0-9]{64}$/);
      assert.equal(firstSourceResult.outcome, "applied");
      assert.equal(firstSourceResult.mutationApplied, true);
      assert.equal(firstSourceResult.mutationStatementCount, 3);
      assert.equal(firstSourceResult.mutationRowCount, 3);
      assert.equal(firstSourceResult.sourceMutated, true);
      assert.equal(firstSourceResult.auditMutated, true);
      assert.equal(firstSourceResult.outboxMutated, true);
      assert.deepEqual(firstSourceResult.configuration, {
        sourceConnectionId: "native_signal_source_a",
        source: "trackalacker",
        trustLevel: "informational",
        autoCreateMissions: false,
        previousTrustLevel: "trusted_exact",
        previousAutoCreateMissions: true,
        updatedAt: firstSourceResult.configuration.updatedAt
      });
      assert.match(String(firstSourceResult.configuration.updatedAt),
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      let sourceReplaySettled = false;
      let sourceLockSettled = false;
      blockedSourceReplay = signalSourceTrustASecond.applySourceTrust(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "configure_source_trust",
        "native_source_trust_apply",
        sourceTrustPayload
      ).finally(() => { sourceReplaySettled = true; });
      const pendingSourceLock = signalWriterLockDirectClient.query<{ resultJson: string }>(
        `SELECT result_json AS "resultJson"
         FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION}"(
           $1, $2, 'native_signal_source_a', '', '', '10000'
         )`,
        [NATIVE_TENANT, NATIVE_USER]
      ).finally(() => { sourceLockSettled = true; });
      blockedSourceLock = pendingSourceLock;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      assert.equal(sourceReplaySettled, false);
      assert.equal(sourceLockSettled, false);
      assert.deepEqual(await sourceTrustSnapshot(), sourceTrustBefore);
      await signalSourceTrustDirectClient.query("COMMIT");
      sourceTrustTransactionOpen = false;
      const replay = await blockedSourceReplay;
      assert.equal(replay.outcome, "already_applied");
      assert.equal(replay.mutationApplied, false);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.mutationStatementCount, 0);
      assert.equal(replay.mutationRowCount, 0);
      assert.equal(replay.sourceMutated, false);
      const lockRows = (await pendingSourceLock).rows;
      assert.equal(lockRows.length, 1);
      assert.deepEqual(JSON.parse(lockRows[0]!.resultJson), {
        contractVersion: 1,
        lockProtocolVersion: "signal_action_constraints_v1",
        lockMask: "10000",
        scopeCount: 1,
        lockScopeOrder: [
          "source",
          "retailer_qualification",
          "settings",
          "mission_policy",
          "spend"
        ],
        sourceConnectionId: "native_signal_source_a",
        retailerId: "",
        missionId: "",
        mutationApplied: false,
        mutationAuthority: false,
        runtimeAuthority: false
      });
    } finally {
      if (sourceTrustTransactionOpen) {
        await signalSourceTrustDirectClient.query("ROLLBACK").catch(() => undefined);
      }
      if (blockedSourceReplay) await blockedSourceReplay.catch(() => undefined);
      if (blockedSourceLock) await blockedSourceLock.catch(() => undefined);
    }
    const sourceTrustAfter = await sourceTrustSnapshot();
    assert.equal(sourceTrustAfter.source, "trackalacker");
    assert.equal(sourceTrustAfter.trustLevel, "informational");
    assert.equal(sourceTrustAfter.autoCreateMissions, 0);
    assert.notEqual(sourceTrustAfter.updatedAt, sourceTrustBefore.updatedAt);
    assert.equal(sourceTrustAfter.auditCount, sourceTrustBefore.auditCount + 1);
    assert.equal(sourceTrustAfter.outboxCount, sourceTrustBefore.outboxCount + 1);
    await assert.rejects(
      signalSourceTrustA.applySourceTrust(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "configure_source_trust",
        "native_source_trust_apply",
        { ...sourceTrustPayload, trustLevel: "trusted_exact" }
      ),
      /replay graph changed/
    );
    await assert.rejects(
      signalSourceTrustA.applySourceTrust(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "configure_source_trust",
        "native_source_trust_stale_revision",
        sourceTrustPayload
      ),
      /revision changed/
    );
    await signalSourceTrustDirectClient.end();
    signalSourceTrustDirectClient = null;
    await signalWriterLockDirectClient.end();
    signalWriterLockDirectClient = null;
    await Promise.all([
      signalSourceTrustA.close(),
      signalSourceTrustASecond.close(),
      signalSourceTrustB.close(),
      signalSourceTrustC.close(),
      signalSourceTrustUnmapped.close()
    ]);
    signalSourceTrustA = null;
    signalSourceTrustASecond = null;
    signalSourceTrustB = null;
    signalSourceTrustC = null;
    signalSourceTrustUnmapped = null;

    await (async () => {
    const signalRetailerQualificationDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalRetailerQualificationApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalRetailerQualificationManifest, { maxConnections });
    signalRetailerQualificationA =
      signalRetailerQualificationDatabase(NATIVE_PRINCIPAL_A, 2);
    signalRetailerQualificationASecond =
      signalRetailerQualificationDatabase(NATIVE_PRINCIPAL_A);
    signalRetailerQualificationB =
      signalRetailerQualificationDatabase(NATIVE_PRINCIPAL_B);
    signalRetailerQualificationC =
      signalRetailerQualificationDatabase(NATIVE_PRINCIPAL_C);
    signalRetailerQualificationUnmapped =
      signalRetailerQualificationDatabase(NATIVE_PRINCIPAL_UNMAPPED);

    const retailerQualificationNow = Date.now();
    const retailerQualificationObservedAt =
      new Date(retailerQualificationNow - 1_000).toISOString();
    const retailerQualificationExpiresAt =
      new Date(retailerQualificationNow + 300_000).toISOString();
    const retailerQualificationDeviceId = "native_retailer_qualification_device";
    const retailerQualificationFixtures = [
      {
        retailerId: "walmart",
        operation: "activate_walmart_add" as const,
        observerVersion: WALMART_OBSERVER_VERSION,
        adapterVersion: WALMART_ADD_ADAPTER_VERSION,
        confirmation: WALMART_ADD_ACTIVATION_CONFIRMATION,
        sellerName: "Walmart",
        skuPrefix: "WAL-NATIVE",
        canonicalBase: "https://www.walmart.com/ip/",
        evidenceNamespace: "walmart-add-qualification-evidence-v1",
        evidenceHashes: ["1".repeat(64), "2".repeat(64)],
        trialEvidenceHash: "3".repeat(64),
        listingId: "listing_native_qualification_walmart"
      },
      {
        retailerId: "amazon",
        operation: "activate_amazon_add" as const,
        observerVersion: AMAZON_OBSERVER_VERSION,
        adapterVersion: AMAZON_ADD_ADAPTER_VERSION,
        confirmation: AMAZON_ADD_ACTIVATION_CONFIRMATION,
        sellerName: "Amazon.com",
        skuPrefix: "B0NATIVE",
        canonicalBase: "https://www.amazon.com/dp/",
        evidenceNamespace: "amazon-add-qualification-evidence-v1",
        evidenceHashes: ["4".repeat(64), "5".repeat(64)],
        trialEvidenceHash: "6".repeat(64),
        listingId: "listing_native_qualification_amazon"
      },
      {
        retailerId: "bestbuy",
        operation: "activate_bestbuy_add" as const,
        observerVersion: BESTBUY_OBSERVER_VERSION,
        adapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
        confirmation: BESTBUY_ADD_ACTIVATION_CONFIRMATION,
        sellerName: "Best Buy",
        skuPrefix: "66789",
        canonicalBase: "https://www.bestbuy.com/site/native/sku/",
        evidenceNamespace: "bestbuy-add-qualification-evidence-v1",
        evidenceHashes: ["7".repeat(64), "8".repeat(64)],
        trialEvidenceHash: "9".repeat(64),
        listingId: "listing_native_qualification_bestbuy"
      }
    ];
    const retailerQualificationRetailerIds =
      retailerQualificationFixtures.map((fixture) => fixture.retailerId);
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."retailer_adapter_qualifications"
       WHERE user_id = $1 AND retailer_id = ANY($2::text[])`,
      [
        NATIVE_USER,
        retailerQualificationRetailerIds
      ]
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."retailers"
       SET execution_supported = 0, updated_at = $2
       WHERE id = ANY($1::text[])`,
      [
        retailerQualificationRetailerIds,
        retailerQualificationObservedAt
      ]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."extension_devices"(
         id, tenant_id, user_id, name, token_hash, extension_version,
         status, capabilities_json, last_seen_at, created_at, updated_at,
         credential_generation, credential_issued_at
       ) VALUES (
         $1, $2, $3, 'Native non-Target qualification device', $4,
         '0.89.0', 'active', $5, $6, $6, $6, 1, $6
       )`,
      [
        retailerQualificationDeviceId,
        NATIVE_TENANT,
        NATIVE_USER,
        stableHash("native-retailer-qualification-device-token"),
        JSON.stringify({
          walmartAddOnly: true,
          walmartAddAdapterVersion: WALMART_ADD_ADAPTER_VERSION,
          amazonAddOnly: true,
          amazonAddAdapterVersion: AMAZON_ADD_ADAPTER_VERSION,
          bestBuyAddOnly: true,
          bestBuyAddAdapterVersion: BESTBUY_ADD_ADAPTER_VERSION
        }),
        retailerQualificationObservedAt
      ]
    );
    for (const fixtureEntry of retailerQualificationFixtures) {
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."listings"(
           id, variant_id, retailer_id, retailer_sku, canonical_url, status,
           execution_supported, msrp_cents, currency, created_at, updated_at
         ) VALUES (
           $1, 'variant_cutover_scope', $2, $3, $4, 'in_stock',
           0, 1299, 'USD', $5, $5
         )`,
        [
          fixtureEntry.listingId,
          fixtureEntry.retailerId,
          `${fixtureEntry.skuPrefix}-LISTING`,
          `${fixtureEntry.canonicalBase}${fixtureEntry.skuPrefix}-LISTING`,
          retailerQualificationObservedAt
        ]
      );
      for (const [index, evidenceHash] of fixtureEntry.evidenceHashes.entries()) {
        const retailerSku = `${fixtureEntry.skuPrefix}-${index + 1}`;
        await first.query(
          `INSERT INTO "${NATIVE_SCHEMA}"."retailer_shadow_observations"(
             id, tenant_id, user_id, device_id, retailer_id, adapter_version,
             contract_version, page_kind, retailer_sku, canonical_url,
             availability, unit_price_cents, currency, seller_name, seller_type,
             fulfillment, add_control_actionable, security_challenge,
             interactive_block, observation_state, evidence_hash,
             observed_at, received_at, purchase_route_ready
           ) VALUES (
             $1, $2, $3, $4, $5, $6, 1, 'product', $7, $8,
             'in_stock', $9, 'USD', $10, 'first_party', 'shipping',
             1, 0, '', 'actionable_candidate', $11, $12, $12, $13
           )`,
          [
            `native_retailer_qualification_${fixtureEntry.retailerId}_observation_${index + 1}`,
            NATIVE_TENANT,
            NATIVE_USER,
            retailerQualificationDeviceId,
            fixtureEntry.retailerId,
            fixtureEntry.observerVersion,
            retailerSku,
            `${fixtureEntry.canonicalBase}${retailerSku}`,
            1299 + index,
            fixtureEntry.sellerName,
            evidenceHash,
            retailerQualificationObservedAt,
            fixtureEntry.retailerId === "amazon" ? 1 : 0
          ]
        );
      }
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."retailer_adapter_trials"(
           id, tenant_id, user_id, device_id, retailer_id, adapter_version,
           observer_version, contract_version, trial_kind, shadow_observation_id,
           retailer_sku, outcome, reason_code, evidence_hash, observed_at, received_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, 1, 'pre_click_rehearsal',
           $8, $9, 'passed', 'rehearsal_passed', $10, $11, $11
         )`,
        [
          `native_retailer_qualification_${fixtureEntry.retailerId}_trial`,
          NATIVE_TENANT,
          NATIVE_USER,
          retailerQualificationDeviceId,
          fixtureEntry.retailerId,
          fixtureEntry.adapterVersion,
          fixtureEntry.observerVersion,
          `native_retailer_qualification_${fixtureEntry.retailerId}_observation_1`,
          `${fixtureEntry.skuPrefix}-1`,
          fixtureEntry.trialEvidenceHash,
          retailerQualificationObservedAt
        ]
      );
    }
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."mission_targets"(
         id, mission_id, listing_id, enabled, max_unit_price_cents,
         currency, seller_policy, fulfillment, created_at, updated_at
       ) VALUES (
         'native_retailer_qualification_walmart_target',
         'mission_cutover_other', 'listing_native_qualification_walmart',
         1, 2000, 'USD', 'first_party_only', 'shipping', $1, $1
       )`,
      [retailerQualificationObservedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."signal_incidents"(
         id, tenant_id, user_id, listing_id, event_type, semantic_key,
         first_observed_at, last_observed_at, created_at, updated_at
       ) VALUES (
         'native_retailer_qualification_walmart_incident', $2, $3,
         'listing_native_qualification_walmart', 'restock',
         'native-retailer-qualification-walmart', $1, $1, $1, $1
       )`,
      [retailerQualificationObservedAt, NATIVE_TENANT, NATIVE_USER]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."action_jobs"(
         id, tenant_id, user_id, mission_id, mission_target_id, incident_id,
         state, action, quantity, max_unit_price_cents, max_order_total_cents,
         currency, seller_policy, fulfillment, expected_seller, listing_id,
         canonical_url, idempotency_key, capability_nonce_hash, expires_at,
         created_at, updated_at
       ) VALUES (
         'native_retailer_qualification_walmart_job', $2, $3,
         'mission_cutover_other', 'native_retailer_qualification_walmart_target',
         'native_retailer_qualification_walmart_incident', 'shadow_ready',
         'add_to_cart', 1, 2000, 2500, 'USD', 'first_party_only', 'shipping',
         'Walmart', 'listing_native_qualification_walmart',
         'https://www.walmart.com/ip/WAL-NATIVE-LISTING',
         'native-retailer-qualification-walmart-job',
         'native-retailer-qualification-capability-hash', $4, $1, $1
       )`,
      [
        retailerQualificationObservedAt,
        NATIVE_TENANT,
        NATIVE_USER,
        retailerQualificationExpiresAt
      ]
    );

    const retailerPayload = (
      fixtureEntry: typeof retailerQualificationFixtures[number]
    ) => ({
      adapterVersion: fixtureEntry.adapterVersion,
      confirmation: fixtureEntry.confirmation,
      evidenceHash: stableHash(
        fixtureEntry.evidenceNamespace,
        fixtureEntry.adapterVersion,
        ...[...fixtureEntry.evidenceHashes, fixtureEntry.trialEvidenceHash].sort()
      )
    });
    const retailerQualificationSnapshot = async (retailerId: string) => {
      const row = (await first!.query<{
        retailerExecutionSupported: number;
        listingExecutionSupported: number;
        qualificationCount: string | number | bigint;
        qualificationEvidenceHash: string;
        jobState: string;
        promotionEvents: string | number | bigint;
        qualificationAudits: string | number | bigint;
        qualificationOutbox: string | number | bigint;
      }>(
        `SELECT retailer.execution_supported AS "retailerExecutionSupported",
                listing.execution_supported AS "listingExecutionSupported",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."retailer_adapter_qualifications" q
                 WHERE q.tenant_id = $1 AND q.user_id = $2
                   AND q.retailer_id = $3) AS "qualificationCount",
                COALESCE((
                  SELECT q.evidence_hash
                  FROM "${NATIVE_SCHEMA}"."retailer_adapter_qualifications" q
                  WHERE q.tenant_id = $1 AND q.user_id = $2
                    AND q.retailer_id = $3
                ), '') AS "qualificationEvidenceHash",
                CASE WHEN $3 = 'walmart' THEN COALESCE((
                  SELECT job.state FROM "${NATIVE_SCHEMA}"."action_jobs" job
                  WHERE job.id = 'native_retailer_qualification_walmart_job'
                ), '') ELSE '' END AS "jobState",
                CASE WHEN $3 = 'walmart' THEN (
                  SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."action_events" event
                  WHERE event.job_id = 'native_retailer_qualification_walmart_job'
                    AND event.reason_code = 'walmart_add_v1_activated'
                ) ELSE 0 END AS "promotionEvents",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events" audit
                 WHERE audit.tenant_id = $1 AND audit.user_id = $2
                   AND audit.correlation_id = $3
                   AND audit.event_type = 'retailer_adapter_qualified')
                  AS "qualificationAudits",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events" outbox
                 WHERE outbox.tenant_id = $1
                   AND outbox.aggregate_type = 'retailer_qualification'
                   AND outbox.aggregate_id = $3
                   AND outbox.event_type = 'retailer_adapter_qualified')
                  AS "qualificationOutbox"
         FROM "${NATIVE_SCHEMA}"."retailers" retailer
         JOIN "${NATIVE_SCHEMA}"."listings" listing
           ON listing.id = $4
         WHERE retailer.id = $3`,
        [
          NATIVE_TENANT,
          NATIVE_USER,
          retailerId,
          `listing_native_qualification_${retailerId}`
        ]
      )).rows[0]!;
      return {
        ...row,
        retailerExecutionSupported: Number(row.retailerExecutionSupported),
        listingExecutionSupported: Number(row.listingExecutionSupported),
        qualificationCount: Number(row.qualificationCount),
        promotionEvents: Number(row.promotionEvents),
        qualificationAudits: Number(row.qualificationAudits),
        qualificationOutbox: Number(row.qualificationOutbox)
      };
    };
    const walmartFixture = retailerQualificationFixtures[0]!;
    const amazonFixture = retailerQualificationFixtures[1]!;
    const bestBuyFixture = retailerQualificationFixtures[2]!;
    const walmartPayload = retailerPayload(walmartFixture);
    const walmartBefore = await retailerQualificationSnapshot("walmart");
    assert.equal(walmartBefore.retailerExecutionSupported, 0);
    assert.equal(walmartBefore.listingExecutionSupported, 0);
    assert.equal(walmartBefore.qualificationCount, 0);
    assert.equal(walmartBefore.jobState, "shadow_ready");
    assert.equal(walmartBefore.promotionEvents, 0);

    await assert.rejects(
      signalRetailerQualificationB.applyRetailerQualification(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "activate_walmart_add",
        "native_retailer_qualification_wrong_tenant_principal",
        walmartPayload
      ),
      /does not match the expected authenticated principal/
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [
        NATIVE_PRINCIPAL_C,
        NATIVE_TENANT,
        NATIVE_SAME_TENANT_USER,
        retailerQualificationObservedAt
      ]
    );
    try {
      await assert.rejects(
        signalRetailerQualificationC.applyRetailerQualification(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          "activate_walmart_add",
          "native_retailer_qualification_wrong_user_principal",
          walmartPayload
        ),
        /does not match the expected authenticated principal/
      );
    } finally {
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
         WHERE principal_role = $1`,
        [NATIVE_PRINCIPAL_C]
      );
    }
    await assert.rejects(
      signalRetailerQualificationUnmapped.applyRetailerQualification(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "activate_walmart_add",
        "native_retailer_qualification_unmapped_principal",
        walmartPayload
      ),
      /tenant session principal is not active/
    );
    await assert.rejects(
      signalRetailerQualificationA.applyRetailerQualification(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "activate_walmart_add",
        "native_retailer_qualification_wrong_adapter",
        retailerPayload(amazonFixture)
      ),
      /payload shape is invalid/
    );

    signalRetailerQualificationDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalRetailerQualificationDirectClient.on("error", () => undefined);
    await signalRetailerQualificationDirectClient.connect();
    await signalRetailerQualificationDirectClient.query(
      `SET ROLE "${signalRetailerQualificationManifest.retailerQualificationRole.name}"`
    );
    await assert.rejects(
      signalRetailerQualificationDirectClient.query(
        `SELECT execution_supported FROM "${NATIVE_SCHEMA}"."retailers" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalRetailerQualificationDirectClient.query(
        `SELECT user_id FROM "${NATIVE_SCHEMA}"."retailer_adapter_qualifications" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalRetailerQualificationDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_FUNCTION}"(
           $1, $2, 'activate_walmart_add', $3, $4
         )`,
        [
          NATIVE_TENANT,
          "user_local",
          "native_retailer_qualification_direct_wrong_principal",
          JSON.stringify(walmartPayload)
        ]
      ),
      /does not match the expected authenticated principal/
    );

    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_retailer_qualification_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $body$
       BEGIN
         IF NEW.event_type = 'retailer_adapter_qualified'
           AND NEW.aggregate_type = 'retailer_qualification'
           AND NEW.aggregate_id = 'walmart' THEN
           RAISE EXCEPTION 'native forced retailer qualification outbox failure';
         END IF;
         RETURN NEW;
       END
       $body$;
       CREATE TRIGGER "yoink_native_reject_retailer_qualification_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_retailer_qualification_outbox"()`
    );
    try {
      await assert.rejects(
        signalRetailerQualificationA.applyRetailerQualification(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          "activate_walmart_add",
          "native_retailer_qualification_rollback",
          walmartPayload
        ),
        /native forced retailer qualification outbox failure/
      );
      assert.deepEqual(
        await retailerQualificationSnapshot("walmart"),
        walmartBefore
      );
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_retailer_qualification_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS
           "${NATIVE_SCHEMA}"."yoink_native_reject_retailer_qualification_outbox"()`
      );
    }

    const retailerSettingsBefore = await readNativeConstraintSettings();
    let retailerQualificationTransactionOpen = false;
    let blockedRetailerReplay: ReturnType<
      NodePostgresSignalRetailerQualificationApplyDatabase["applyRetailerQualification"]
    > | null = null;
    let blockedRetailerConfig: ReturnType<
      NodePostgresSignalConstraintConfigApplyDatabase["applyConstraintConfiguration"]
    > | null = null;
    try {
      await signalRetailerQualificationDirectClient.query("BEGIN");
      retailerQualificationTransactionOpen = true;
      const firstRetailerQualification =
        await signalRetailerQualificationDirectClient.query<{ resultJson: string }>(
          `SELECT result_json AS "resultJson"
           FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_FUNCTION}"(
             $1, $2, 'activate_walmart_add', $3, $4
           )`,
          [
            NATIVE_TENANT,
            NATIVE_USER,
            "native_retailer_qualification_walmart_apply",
            JSON.stringify(walmartPayload)
          ]
        );
      const firstRetailerResult = JSON.parse(
        firstRetailerQualification.rows[0]!.resultJson
      ) as {
        requestFingerprint: string;
        outcome: string;
        mutationApplied: boolean;
        mutationStatementCount: number;
        mutationRowCount: number;
        qualificationMutated: boolean;
        settingsMutated: boolean;
        sharedRetailerMutated: boolean;
        sharedListingsMutated: number;
        sharedCatalogMutated: boolean;
        promotedJobCount: number;
        actionEventsMutated: number;
        retailerQualificationWriterParity: boolean;
        activation: Record<string, unknown>;
      };
      assert.match(firstRetailerResult.requestFingerprint, /^[a-f0-9]{64}$/);
      assert.equal(firstRetailerResult.outcome, "applied");
      assert.equal(firstRetailerResult.mutationApplied, true);
      assert.equal(firstRetailerResult.qualificationMutated, true);
      assert.equal(firstRetailerResult.settingsMutated, false);
      assert.equal(firstRetailerResult.sharedRetailerMutated, true);
      assert.ok(firstRetailerResult.sharedListingsMutated >= 1);
      assert.equal(firstRetailerResult.sharedCatalogMutated, true);
      assert.equal(firstRetailerResult.promotedJobCount, 1);
      assert.equal(firstRetailerResult.actionEventsMutated, 1);
      assert.equal(firstRetailerResult.mutationStatementCount, 7);
      assert.equal(
        firstRetailerResult.mutationRowCount,
        6 + firstRetailerResult.sharedListingsMutated
      );
      assert.equal(firstRetailerResult.retailerQualificationWriterParity, true);
      assert.equal(firstRetailerResult.activation.retailerId, "walmart");
      assert.equal(firstRetailerResult.activation.evidenceHash, walmartPayload.evidenceHash);
      assert.equal(firstRetailerResult.activation.observationCount, 2);
      assert.equal(firstRetailerResult.activation.distinctSkuCount, 2);
      assert.equal(firstRetailerResult.activation.rehearsalCount, 1);
      assert.equal(firstRetailerResult.activation.promotedJobs, 1);
      let retailerReplaySettled = false;
      let retailerConfigSettled = false;
      blockedRetailerReplay =
        signalRetailerQualificationASecond.applyRetailerQualification(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          "activate_walmart_add",
          "native_retailer_qualification_walmart_apply",
          walmartPayload
        ).finally(() => { retailerReplaySettled = true; });
      blockedRetailerConfig = signalConstraintConfigA.applyConstraintConfiguration(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "set_actions_paused",
        "native_retailer_qualification_blocked_config",
        {
          expectedUpdatedAt: retailerSettingsBefore.updatedAt,
          paused: true,
          reason: "Native retailer qualification contention"
        }
      ).finally(() => { retailerConfigSettled = true; });
      void blockedRetailerConfig.catch(() => undefined);
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      assert.equal(retailerReplaySettled, false);
      assert.equal(retailerConfigSettled, false);
      assert.deepEqual(
        await retailerQualificationSnapshot("walmart"),
        walmartBefore
      );
      await signalRetailerQualificationDirectClient.query("COMMIT");
      retailerQualificationTransactionOpen = false;
      const replay = await blockedRetailerReplay;
      assert.equal(replay.outcome, "already_applied");
      assert.equal(replay.mutationApplied, false);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.mutationStatementCount, 0);
      assert.equal(replay.mutationRowCount, 0);
      assert.equal(replay.sharedRetailerMutated, false);
      assert.equal(replay.sharedListingsMutated, 0);
      assert.equal(replay.sharedCatalogMutated, false);
      assert.equal(replay.promotedJobCount, 1);
      assert.equal(replay.actionEventsMutated, 0);
      const pauseResult = await blockedRetailerConfig;
      assert.equal(pauseResult.outcome, "applied");
      assert.equal(pauseResult.settingsMutated, true);
    } finally {
      if (retailerQualificationTransactionOpen) {
        await signalRetailerQualificationDirectClient.query("ROLLBACK")
          .catch(() => undefined);
      }
      if (blockedRetailerReplay) {
        await blockedRetailerReplay.catch(() => undefined);
      }
      if (blockedRetailerConfig) {
        await blockedRetailerConfig.catch(() => undefined);
      }
    }
    const walmartAfter = await retailerQualificationSnapshot("walmart");
    assert.equal(walmartAfter.retailerExecutionSupported, 1);
    assert.equal(walmartAfter.listingExecutionSupported, 1);
    assert.equal(walmartAfter.qualificationCount, 1);
    assert.equal(walmartAfter.qualificationEvidenceHash, walmartPayload.evidenceHash);
    assert.equal(walmartAfter.jobState, "awaiting_executor");
    assert.equal(walmartAfter.promotionEvents, 1);
    assert.equal(walmartAfter.qualificationAudits, walmartBefore.qualificationAudits + 1);
    assert.equal(walmartAfter.qualificationOutbox, walmartBefore.qualificationOutbox + 1);
    await assert.rejects(
      signalRetailerQualificationA.applyRetailerQualification(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "activate_walmart_add",
        "native_retailer_qualification_walmart_apply",
        { ...walmartPayload, evidenceHash: "f".repeat(64) }
      ),
      /replay graph changed/
    );
    const pausedSettings = await readNativeConstraintSettings();
    assert.equal(Number(pausedSettings.actionsPaused), 1);
    const resumeResult =
      await signalConstraintConfigASecond.applyConstraintConfiguration(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "set_actions_paused",
        "native_retailer_qualification_resume",
        {
          expectedUpdatedAt: pausedSettings.updatedAt,
          paused: false,
          reason: ""
        }
      );
    assert.equal(resumeResult.outcome, "applied");

    let globalRetailerLockOpen = false;
    let blockedAmazonApply: ReturnType<
      NodePostgresSignalRetailerQualificationApplyDatabase["applyRetailerQualification"]
    > | null = null;
    try {
      await signalRetailerQualificationDirectClient.query("BEGIN");
      globalRetailerLockOpen = true;
      await signalRetailerQualificationDirectClient.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
           'yoink_shared_retailer_execution_v1:amazon', 0
         ))`
      );
      let amazonSettled = false;
      blockedAmazonApply = signalRetailerQualificationA.applyRetailerQualification(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "activate_amazon_add",
        "native_retailer_qualification_amazon_apply",
        retailerPayload(amazonFixture)
      ).finally(() => { amazonSettled = true; });
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      assert.equal(amazonSettled, false);
      assert.equal(
        (await retailerQualificationSnapshot("amazon")).retailerExecutionSupported,
        0
      );
      await signalRetailerQualificationDirectClient.query("COMMIT");
      globalRetailerLockOpen = false;
      const amazonResult = await blockedAmazonApply;
      assert.equal(amazonResult.outcome, "applied");
      assert.equal(amazonResult.sharedRetailerMutated, true);
      assert.ok(amazonResult.sharedListingsMutated >= 1);
      assert.equal(amazonResult.promotedJobCount, 0);
      assert.equal(amazonResult.activation.offerRouteReadyCount, 2);
      assert.equal(amazonResult.retailerQualificationWriterParity, true);
    } finally {
      if (globalRetailerLockOpen) {
        await signalRetailerQualificationDirectClient.query("ROLLBACK")
          .catch(() => undefined);
      }
      if (blockedAmazonApply) await blockedAmazonApply.catch(() => undefined);
    }
    const amazonAfter = await retailerQualificationSnapshot("amazon");
    assert.equal(amazonAfter.retailerExecutionSupported, 1);
    assert.equal(amazonAfter.listingExecutionSupported, 1);
    assert.equal(amazonAfter.qualificationCount, 1);
    assert.equal(
      amazonAfter.qualificationEvidenceHash,
      retailerPayload(amazonFixture).evidenceHash
    );

    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."retailers"
       SET display_name = 'Tampered Best Buy'
       WHERE id = 'bestbuy'`
    );
    await assert.rejects(
      signalRetailerQualificationA.applyRetailerQualification(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "activate_bestbuy_add",
        "native_retailer_qualification_bestbuy_tampered_identity",
        retailerPayload(bestBuyFixture)
      ),
      /shared retailer identity changed/
    );
    assert.equal(
      (await retailerQualificationSnapshot("bestbuy")).qualificationCount,
      0
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."retailers"
       SET display_name = 'Best Buy'
       WHERE id = 'bestbuy'`
    );
    const bestBuyResult =
      await signalRetailerQualificationA.applyRetailerQualification(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "activate_bestbuy_add",
        "native_retailer_qualification_bestbuy_apply",
        retailerPayload(bestBuyFixture)
      );
    assert.equal(bestBuyResult.outcome, "applied");
    assert.equal(bestBuyResult.sharedRetailerMutated, true);
    assert.ok(bestBuyResult.sharedListingsMutated >= 1);
    assert.equal(bestBuyResult.promotedJobCount, 0);
    assert.equal(bestBuyResult.activation.retailerId, "bestbuy");
    assert.equal(bestBuyResult.retailerQualificationWriterParity, true);
    const bestBuyAfter = await retailerQualificationSnapshot("bestbuy");
    assert.equal(bestBuyAfter.retailerExecutionSupported, 1);
    assert.equal(bestBuyAfter.listingExecutionSupported, 1);
    assert.equal(bestBuyAfter.qualificationCount, 1);
    assert.equal(
      bestBuyAfter.qualificationEvidenceHash,
      retailerPayload(bestBuyFixture).evidenceHash
    );

    await signalRetailerQualificationDirectClient.end();
    signalRetailerQualificationDirectClient = null;
    await Promise.all([
      signalRetailerQualificationA.close(),
      signalRetailerQualificationASecond.close(),
      signalRetailerQualificationB.close(),
      signalRetailerQualificationC.close(),
      signalRetailerQualificationUnmapped.close()
    ]);
    signalRetailerQualificationA = null;
    signalRetailerQualificationASecond = null;
    signalRetailerQualificationB = null;
    signalRetailerQualificationC = null;
    signalRetailerQualificationUnmapped = null;
    })();

    await (async () => {
    const missionPolicyDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalMissionPolicyApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalMissionPolicyManifest, { maxConnections });
    signalMissionPolicyA = missionPolicyDatabase(NATIVE_PRINCIPAL_A);
    signalMissionPolicyASecond = missionPolicyDatabase(NATIVE_PRINCIPAL_A);
    signalMissionPolicyB = missionPolicyDatabase(NATIVE_PRINCIPAL_B);
    signalMissionPolicyC = missionPolicyDatabase(NATIVE_PRINCIPAL_C);
    signalMissionPolicyUnmapped = missionPolicyDatabase(NATIVE_PRINCIPAL_UNMAPPED);

    const missionPolicyMissionId = "mission_native_policy";
    const missionPolicyListingId = "listing_native_policy";
    const missionPolicyTargetId = "target_native_policy";
    const missionPolicyCreatedAt = new Date(Date.now() - 1_000).toISOString();
    const missionPolicyTargetJson = JSON.stringify([{
      targetId: missionPolicyTargetId,
      listingId: missionPolicyListingId,
      retailerId: "walmart",
      enabled: true,
      maxUnitPriceCents: 1500,
      sellerPolicy: "first_party_only",
      fulfillment: "shipping"
    }]);
    const initialMissionPolicyHash = stableHash(
      "intent-policy-v2",
      missionPolicyMissionId,
      2,
      "USD",
      null,
      "notify",
      "strategy",
      120,
      "exact_only",
      "",
      0,
      missionPolicyTargetJson
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."variants"(
         id, family_id, title, attributes_json, created_at, updated_at
       ) VALUES (
         'variant_native_policy', 'family_cutover_scope',
         'Native mission-policy product', '{}', $1, $1
       )`,
      [missionPolicyCreatedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."listings"(
         id, variant_id, retailer_id, retailer_sku, canonical_url, status,
         execution_supported, msrp_cents, currency, created_at, updated_at
       ) VALUES (
         $1, 'variant_native_policy', 'walmart', 'NATIVE-MISSION-POLICY',
         'https://www.walmart.com/ip/NATIVE-MISSION-POLICY', 'in_stock',
         1, 1500, 'USD', $2, $2
       )`,
      [missionPolicyListingId, missionPolicyCreatedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."missions"(
         id, tenant_id, user_id, variant_id, status, origin,
         target_quantity, fulfilled_quantity, created_at, updated_at
       ) VALUES (
         $1, $2, $3, 'variant_native_policy', 'active', 'manual',
         2, 0, $4, $4
       )`,
      [missionPolicyMissionId, NATIVE_TENANT, NATIVE_USER, missionPolicyCreatedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."mission_targets"(
         id, mission_id, listing_id, enabled, max_unit_price_cents,
         currency, seller_policy, fulfillment, created_at, updated_at
       ) VALUES ($1, $2, $3, 1, 1500, 'USD', 'first_party_only',
                 'shipping', $4, $4)`,
      [missionPolicyTargetId, missionPolicyMissionId, missionPolicyListingId,
        missionPolicyCreatedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."mission_intent_revisions"(
         id, tenant_id, user_id, mission_id, revision, quantity, currency,
         max_all_in_cents, action_ceiling, substitution_policy, expires_at,
         cooldown_seconds, target_policy_json, policy_hash, change_reason,
         decision_mode, max_signal_age_seconds, created_by_actor_id, created_at
       ) VALUES (
         'intent_revision_native_policy_initial', $1, $2, $3, 1, 2, 'USD',
         NULL, 'notify', 'exact_only', '', 0, $4, $5,
         'Native initial mission policy.', 'strategy', 120, 'native_fixture', $6
       )`,
      [NATIVE_TENANT, NATIVE_USER, missionPolicyMissionId,
        missionPolicyTargetJson, initialMissionPolicyHash, missionPolicyCreatedAt]
    );

    const missionPolicyPayload = {
      missionId: missionPolicyMissionId,
      expectedRevision: 1,
      expectedPolicyHash: initialMissionPolicyHash,
      maxAllInCents: 100_000,
      actionCeiling: "add_to_cart",
      decisionMode: "purchase_intent",
      maxSignalAgeSeconds: 90,
      substitutionPolicy: "exact_only",
      expiresAt: "",
      cooldownSeconds: 30,
      changeReason: "Native reviewed purchase preferences.",
      confirmation: POSTGRES_SIGNAL_MISSION_POLICY_APPLY_CONFIRMATION
    };
    const missionPolicySnapshot = async () => {
      const row = (await first!.query<{
        revision: string | number | bigint;
        policyHash: string;
        policyCount: string | number | bigint;
        auditCount: string | number | bigint;
        outboxCount: string | number | bigint;
        actionCount: string | number | bigint;
        listingVariantId: string;
      }>(
        `SELECT
           COALESCE(MAX(policy.revision), 0) AS revision,
           COALESCE((ARRAY_AGG(policy.policy_hash ORDER BY policy.revision DESC))[1], '')
             AS "policyHash",
           COUNT(policy.id) AS "policyCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events" audit
            WHERE audit.correlation_id = $1
              AND audit.event_type = 'purchase_intent_policy_revised') AS "auditCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events" outbox
            WHERE outbox.aggregate_id = $1
              AND outbox.event_type = 'purchase_intent_policy_revised') AS "outboxCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."action_jobs" action
            WHERE action.mission_id = $1) AS "actionCount",
           (SELECT listing.variant_id FROM "${NATIVE_SCHEMA}"."listings" listing
            WHERE listing.id = $2) AS "listingVariantId"
         FROM "${NATIVE_SCHEMA}"."mission_intent_revisions" policy
         WHERE policy.mission_id = $1`,
        [missionPolicyMissionId, missionPolicyListingId]
      )).rows[0]!;
      return {
        revision: Number(row.revision),
        policyHash: row.policyHash,
        policyCount: Number(row.policyCount),
        auditCount: Number(row.auditCount),
        outboxCount: Number(row.outboxCount),
        actionCount: Number(row.actionCount),
        listingVariantId: row.listingVariantId
      };
    };
    const missionPolicyBefore = await missionPolicySnapshot();
    assert.deepEqual(missionPolicyBefore, {
      revision: 1,
      policyHash: initialMissionPolicyHash,
      policyCount: 1,
      auditCount: 0,
      outboxCount: 0,
      actionCount: 0,
      listingVariantId: "variant_native_policy"
    });

    await assert.rejects(
      signalMissionPolicyB.applyMissionPolicy(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "revise_mission_policy",
        "native_mission_policy_wrong_tenant_principal",
        missionPolicyPayload
      ),
      /does not match the expected authenticated principal/
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [NATIVE_PRINCIPAL_C, NATIVE_TENANT, NATIVE_SAME_TENANT_USER,
        missionPolicyCreatedAt]
    );
    try {
      await assert.rejects(
        signalMissionPolicyC.applyMissionPolicy(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          "revise_mission_policy",
          "native_mission_policy_wrong_user_principal",
          missionPolicyPayload
        ),
        /does not match the expected authenticated principal/
      );
    } finally {
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
         WHERE principal_role = $1`,
        [NATIVE_PRINCIPAL_C]
      );
    }
    await assert.rejects(
      signalMissionPolicyUnmapped.applyMissionPolicy(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "revise_mission_policy",
        "native_mission_policy_unmapped_principal",
        missionPolicyPayload
      ),
      /tenant session principal is not active/
    );
    await assert.rejects(
      signalMissionPolicyA.applyMissionPolicy(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "revise_mission_policy",
        "native_mission_policy_wrong_revision",
        { ...missionPolicyPayload, expectedRevision: 2 }
      ),
      /revision changed/
    );
    await assert.rejects(
      signalMissionPolicyA.applyMissionPolicy(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "revise_mission_policy",
        "native_mission_policy_wrong_hash",
        { ...missionPolicyPayload, expectedPolicyHash: "f".repeat(64) }
      ),
      /revision changed/
    );
    await assert.rejects(
      signalMissionPolicyA.applyMissionPolicy(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "revise_mission_policy",
        "native_mission_policy_unsafe_direct",
        { ...missionPolicyPayload, maxAllInCents: null }
      ),
      /all-in bound is too low/
    );

    signalMissionPolicyDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalMissionPolicyDirectClient.on("error", () => undefined);
    await signalMissionPolicyDirectClient.connect();
    await signalMissionPolicyDirectClient.query(
      `SET ROLE "${signalMissionPolicyManifest.missionPolicyRole.name}"`
    );
    await assert.rejects(
      signalMissionPolicyDirectClient.query(
        `SELECT policy_hash FROM "${NATIVE_SCHEMA}"."mission_intent_revisions" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalMissionPolicyDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."mission_intent_revisions"(
           id, tenant_id, user_id, mission_id, revision, quantity, currency,
           action_ceiling, substitution_policy, target_policy_json, policy_hash,
           created_by_actor_id, created_at
         ) VALUES ('forbidden_policy', $1, $2, $3, 99, 2, 'USD', 'notify',
                   'exact_only', '[]', $4, 'forbidden', $5)`,
        [NATIVE_TENANT, NATIVE_USER, missionPolicyMissionId,
          "e".repeat(64), missionPolicyCreatedAt]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalMissionPolicyDirectClient.query(
        `UPDATE "${NATIVE_SCHEMA}"."listings" SET execution_supported = 0
         WHERE id = $1`,
        [missionPolicyListingId]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalMissionPolicyDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_FUNCTION}"(
           $1, $2, 'activate_walmart_add', 'forbidden_cross_boundary', '{}'
         )`,
        [NATIVE_TENANT, NATIVE_USER]
      ),
      /permission denied/
    );

    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_mission_policy_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $failure$
       BEGIN
         IF NEW.aggregate_id = '${missionPolicyMissionId}'
           AND NEW.event_type = 'purchase_intent_policy_revised' THEN
           RAISE EXCEPTION 'native forced mission-policy outbox failure';
         END IF;
         RETURN NEW;
       END
       $failure$;
       CREATE TRIGGER "yoink_native_reject_mission_policy_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION
         "${NATIVE_SCHEMA}"."yoink_native_reject_mission_policy_outbox"()`
    );
    try {
      await assert.rejects(
        signalMissionPolicyA.applyMissionPolicy(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          "revise_mission_policy",
          "native_mission_policy_rollback",
          missionPolicyPayload
        ),
        /native forced mission-policy outbox failure/
      );
      assert.deepEqual(await missionPolicySnapshot(), missionPolicyBefore);
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_mission_policy_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS
           "${NATIVE_SCHEMA}"."yoink_native_reject_mission_policy_outbox"()`
      );
    }

    const settingsBeforeMissionPolicy = await readNativeConstraintSettings();
    let missionPolicyTransactionOpen = false;
    let blockedMissionPolicyReplay: ReturnType<
      NodePostgresSignalMissionPolicyApplyDatabase["applyMissionPolicy"]
    > | null = null;
    let blockedMissionPolicyConfig: ReturnType<
      NodePostgresSignalConstraintConfigApplyDatabase["applyConstraintConfiguration"]
    > | null = null;
    let firstMissionPolicyHash = "";
    try {
      await signalMissionPolicyDirectClient.query("BEGIN");
      missionPolicyTransactionOpen = true;
      const firstMissionPolicy =
        await signalMissionPolicyDirectClient.query<{ resultJson: string }>(
          `SELECT result_json AS "resultJson"
           FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_MISSION_POLICY_APPLY_FUNCTION}"(
             $1, $2, 'revise_mission_policy', $3, $4
           )`,
          [
            NATIVE_TENANT,
            NATIVE_USER,
            "native_mission_policy_apply",
            JSON.stringify(missionPolicyPayload)
          ]
        );
      const firstMissionPolicyResult = JSON.parse(
        firstMissionPolicy.rows[0]!.resultJson
      ) as {
        requestFingerprint: string;
        outcome: string;
        mutationApplied: boolean;
        idempotentReplay: boolean;
        mutationStatementCount: number;
        mutationRowCount: number;
        policyMutated: boolean;
        auditMutated: boolean;
        outboxMutated: boolean;
        missionPolicyWriterParity: boolean;
        sharedCatalogMutationAuthority: boolean;
        actionAuthority: boolean;
        runtimeAuthority: boolean;
        policy: { revision: number; policyHash: string; createdByActorId: string };
      };
      firstMissionPolicyHash = firstMissionPolicyResult.policy.policyHash;
      assert.match(firstMissionPolicyResult.requestFingerprint, /^[a-f0-9]{64}$/);
      assert.equal(firstMissionPolicyResult.outcome, "applied");
      assert.equal(firstMissionPolicyResult.mutationApplied, true);
      assert.equal(firstMissionPolicyResult.idempotentReplay, false);
      assert.equal(firstMissionPolicyResult.mutationStatementCount, 3);
      assert.equal(firstMissionPolicyResult.mutationRowCount, 3);
      assert.equal(firstMissionPolicyResult.policyMutated, true);
      assert.equal(firstMissionPolicyResult.auditMutated, true);
      assert.equal(firstMissionPolicyResult.outboxMutated, true);
      assert.equal(firstMissionPolicyResult.missionPolicyWriterParity, true);
      assert.equal(firstMissionPolicyResult.sharedCatalogMutationAuthority, false);
      assert.equal(firstMissionPolicyResult.actionAuthority, false);
      assert.equal(firstMissionPolicyResult.runtimeAuthority, false);
      assert.equal(Number(firstMissionPolicyResult.policy.revision), 2);
      assert.equal(firstMissionPolicyResult.policy.createdByActorId, NATIVE_PRINCIPAL_A);
      assert.equal(
        firstMissionPolicyHash,
        stableHash(
          "intent-policy-v2",
          missionPolicyMissionId,
          2,
          "USD",
          100_000,
          "add_to_cart",
          "purchase_intent",
          90,
          "exact_only",
          "",
          30,
          missionPolicyTargetJson
        )
      );

      let replaySettled = false;
      let configSettled = false;
      blockedMissionPolicyReplay = signalMissionPolicyASecond.applyMissionPolicy(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "revise_mission_policy",
        "native_mission_policy_apply",
        missionPolicyPayload
      ).finally(() => { replaySettled = true; });
      blockedMissionPolicyConfig = signalConstraintConfigA.applyConstraintConfiguration(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "set_actions_paused",
        "native_mission_policy_blocked_config",
        {
          expectedUpdatedAt: settingsBeforeMissionPolicy.updatedAt,
          paused: true,
          reason: "Native mission-policy contention"
        }
      ).finally(() => { configSettled = true; });
      void blockedMissionPolicyConfig.catch(() => undefined);
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      assert.equal(replaySettled, false);
      assert.equal(configSettled, false);
      assert.deepEqual(await missionPolicySnapshot(), missionPolicyBefore);
      await signalMissionPolicyDirectClient.query("COMMIT");
      missionPolicyTransactionOpen = false;

      const replay = await blockedMissionPolicyReplay;
      assert.equal(replay.outcome, "already_applied");
      assert.equal(replay.mutationApplied, false);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.mutationStatementCount, 0);
      assert.equal(replay.mutationRowCount, 0);
      assert.equal(replay.policy.policyHash, firstMissionPolicyHash);
      const pauseResult = await blockedMissionPolicyConfig;
      assert.equal(pauseResult.outcome, "applied");
      assert.equal(pauseResult.settingsMutated, true);
    } finally {
      if (missionPolicyTransactionOpen) {
        await signalMissionPolicyDirectClient.query("ROLLBACK").catch(() => undefined);
      }
      if (blockedMissionPolicyReplay) {
        await blockedMissionPolicyReplay.catch(() => undefined);
      }
      if (blockedMissionPolicyConfig) {
        await blockedMissionPolicyConfig.catch(() => undefined);
      }
    }
    assert.match(firstMissionPolicyHash, /^[a-f0-9]{64}$/);
    const missionPolicyAfter = await missionPolicySnapshot();
    assert.deepEqual(missionPolicyAfter, {
      revision: 2,
      policyHash: firstMissionPolicyHash,
      policyCount: 2,
      auditCount: 1,
      outboxCount: 1,
      actionCount: 0,
      listingVariantId: "variant_native_policy"
    });
    await assert.rejects(
      signalMissionPolicyA.applyMissionPolicy(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "revise_mission_policy",
        "native_mission_policy_apply",
        { ...missionPolicyPayload, changeReason: "Altered replay" }
      ),
      /replay graph changed/
    );

    const unchangedPayload = {
      ...missionPolicyPayload,
      expectedRevision: 2,
      expectedPolicyHash: firstMissionPolicyHash,
      changeReason: "This should remain a zero-write request."
    };
    const unchangedResult = await signalMissionPolicyA.applyMissionPolicy(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      "revise_mission_policy",
      "native_mission_policy_unchanged",
      unchangedPayload
    );
    assert.equal(unchangedResult.outcome, "unchanged");
    assert.equal(unchangedResult.mutationApplied, false);
    assert.equal(unchangedResult.idempotentReplay, false);
    assert.equal(unchangedResult.mutationStatementCount, 0);
    assert.equal(unchangedResult.mutationRowCount, 0);
    assert.deepEqual(await missionPolicySnapshot(), missionPolicyAfter);

    const pausedMissionPolicySettings = await readNativeConstraintSettings();
    assert.equal(Number(pausedMissionPolicySettings.actionsPaused), 1);
    const resumeAfterMissionPolicy =
      await signalConstraintConfigASecond.applyConstraintConfiguration(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "set_actions_paused",
        "native_mission_policy_resume",
        {
          expectedUpdatedAt: pausedMissionPolicySettings.updatedAt,
          paused: false,
          reason: ""
        }
      );
    assert.equal(resumeAfterMissionPolicy.outcome, "applied");

    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."listings"
       SET variant_id = 'variant_cutover_scope'
       WHERE id = $1`,
      [missionPolicyListingId]
    );
    try {
      await assert.rejects(
        signalMissionPolicyA.applyMissionPolicy(
          { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
          "revise_mission_policy",
          "native_mission_policy_catalog_tamper",
          { ...unchangedPayload, cooldownSeconds: 31 }
        ),
        /exact target graph is invalid/
      );
    } finally {
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."listings"
         SET variant_id = 'variant_native_policy'
         WHERE id = $1`,
        [missionPolicyListingId]
      );
    }
    assert.deepEqual(await missionPolicySnapshot(), missionPolicyAfter);

    await signalMissionPolicyDirectClient.end();
    signalMissionPolicyDirectClient = null;
    await Promise.all([
      signalMissionPolicyA.close(),
      signalMissionPolicyASecond.close(),
      signalMissionPolicyB.close(),
      signalMissionPolicyC.close(),
      signalMissionPolicyUnmapped.close()
    ]);
    signalMissionPolicyA = null;
    signalMissionPolicyASecond = null;
    signalMissionPolicyB = null;
    signalMissionPolicyC = null;
    signalMissionPolicyUnmapped = null;
    })();

    await (async () => {
    const sourceStatusDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalSourceStatusApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalSourceStatusManifest, { maxConnections });
    signalSourceStatusA = sourceStatusDatabase(NATIVE_PRINCIPAL_A, 2);
    signalSourceStatusASecond = sourceStatusDatabase(NATIVE_PRINCIPAL_A);
    signalSourceStatusB = sourceStatusDatabase(NATIVE_PRINCIPAL_B);
    signalSourceStatusC = sourceStatusDatabase(NATIVE_PRINCIPAL_C);
    signalSourceStatusUnmapped = sourceStatusDatabase(NATIVE_PRINCIPAL_UNMAPPED);

    const sourceStatusDeviceId = "native_source_status_device";
    const sourceStatusPeerDeviceId = "native_source_status_peer_device";
    const sourceStatusConnectionId = "native_signal_source_a";
    const sourceStatusNow = Date.now();
    const sourceStatusCreatedAt = new Date(sourceStatusNow - 10_000).toISOString();
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."extension_devices"(
         id, tenant_id, user_id, name, token_hash, extension_version,
         status, capabilities_json, last_seen_at, created_at, updated_at,
         credential_generation, credential_issued_at
       ) VALUES
         ($1, $2, $3, 'Native source-status device', $4, '0.91.0',
          'active', '{}', $6, $6, $6, 1, $6),
         ($5, $2, $7, 'Native source-status peer device', $8, '0.91.0',
          'active', '{}', $6, $6, $6, 1, $6)`,
      [
        sourceStatusDeviceId,
        NATIVE_TENANT,
        NATIVE_USER,
        stableHash("native-source-status-device-token"),
        sourceStatusPeerDeviceId,
        sourceStatusCreatedAt,
        NATIVE_SAME_TENANT_USER,
        stableHash("native-source-status-peer-device-token")
      ]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."source_connections"(
         id, tenant_id, user_id, source, name, status, trust_level,
         auto_create_missions, is_private, last_event_at, created_at, updated_at
       ) VALUES
         ('native_source_status_non_track', $1, $2, 'manual',
          'Native non-TrackaLacker source', 'disconnected', 'informational',
          0, 1, '', $3, $3),
         ('native_source_status_public', $1, $2, 'trackalacker',
          'Native public TrackaLacker source', 'disconnected', 'informational',
          0, 0, '', $3, $3)`,
      [NATIVE_TENANT, NATIVE_USER, sourceStatusCreatedAt]
    );

    const principal = { tenantId: NATIVE_TENANT, userId: NATIVE_USER };
    const basePayload: PostgresSignalSourceStatusPayload = {
      deviceId: sourceStatusDeviceId,
      sourceConnectionId: sourceStatusConnectionId,
      state: "registering",
      ready: false,
      subscriptionPresent: true,
      pendingSignals: 2,
      lastHttpStatus: 0,
      errorCode: "",
      lastRegistrationAt: new Date(sourceStatusNow - 2_000).toISOString(),
      lastNotificationAt: "",
      lastDeliveryAt: "",
      updatedAt: new Date(sourceStatusNow).toISOString(),
      confirmation: POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_CONFIRMATION
    };
    const applySourceStatus = (
      database: NodePostgresSignalSourceStatusApplyDatabase,
      payload: PostgresSignalSourceStatusPayload
    ) => database.applySourceStatus(
      principal,
      "record_trackalacker_push_status",
      buildPostgresSignalSourceStatusRequestId(principal, payload),
      payload
    );
    const sourceStatusSnapshot = async () => {
      const row = (await first!.query<{
        connectionStatus: string;
        connectionUpdatedAt: string;
        deviceStateCount: string | number | bigint;
        state: string | null;
        ready: number | null;
        subscriptionPresent: number | null;
        pendingSignals: number | null;
        lastHttpStatus: number | null;
        errorCode: string | null;
        lastRegistrationAt: string | null;
        lastNotificationAt: string | null;
        lastDeliveryAt: string | null;
        updatedAt: string | null;
        auditCount: string | number | bigint;
        outboxCount: string | number | bigint;
        actionCount: string | number | bigint;
      }>(
        `SELECT connection.status AS "connectionStatus",
                connection.updated_at AS "connectionUpdatedAt",
                COUNT(device_state.device_id) AS "deviceStateCount",
                MIN(device_state.state) AS state,
                MIN(device_state.ready) AS ready,
                MIN(device_state.subscription_present) AS "subscriptionPresent",
                MIN(device_state.pending_signals) AS "pendingSignals",
                MIN(device_state.last_http_status) AS "lastHttpStatus",
                MIN(device_state.error_code) AS "errorCode",
                MIN(device_state.last_registration_at) AS "lastRegistrationAt",
                MIN(device_state.last_notification_at) AS "lastNotificationAt",
                MIN(device_state.last_delivery_at) AS "lastDeliveryAt",
                MIN(device_state.updated_at) AS "updatedAt",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events" audit
                 WHERE audit.correlation_id = $1
                   AND audit.event_type = 'source_connection_status') AS "auditCount",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events" outbox
                 WHERE outbox.aggregate_id = $1
                   AND outbox.event_type = 'source_connection_status') AS "outboxCount",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."action_jobs") AS "actionCount"
         FROM "${NATIVE_SCHEMA}"."source_connections" connection
         LEFT JOIN "${NATIVE_SCHEMA}"."source_device_states" device_state
           ON device_state.source_connection_id = connection.id
          AND device_state.device_id = $1
         WHERE connection.id = $2
         GROUP BY connection.status, connection.updated_at`,
        [sourceStatusDeviceId, sourceStatusConnectionId]
      )).rows[0]!;
      return {
        ...row,
        deviceStateCount: Number(row.deviceStateCount),
        ready: row.ready === null ? null : Number(row.ready),
        subscriptionPresent: row.subscriptionPresent === null
          ? null
          : Number(row.subscriptionPresent),
        pendingSignals: row.pendingSignals === null ? null : Number(row.pendingSignals),
        lastHttpStatus: row.lastHttpStatus === null ? null : Number(row.lastHttpStatus),
        auditCount: Number(row.auditCount),
        outboxCount: Number(row.outboxCount),
        actionCount: Number(row.actionCount)
      };
    };
    const sourceStatusBefore = await sourceStatusSnapshot();
    assert.equal(sourceStatusBefore.deviceStateCount, 0);

    await assert.rejects(
      signalSourceStatusB.applySourceStatus(
        principal,
        "record_trackalacker_push_status",
        buildPostgresSignalSourceStatusRequestId(principal, basePayload),
        basePayload
      ),
      /does not match the expected authenticated principal/
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [NATIVE_PRINCIPAL_C, NATIVE_TENANT, NATIVE_SAME_TENANT_USER,
        sourceStatusCreatedAt]
    );
    try {
      await assert.rejects(
        signalSourceStatusC.applySourceStatus(
          principal,
          "record_trackalacker_push_status",
          buildPostgresSignalSourceStatusRequestId(principal, basePayload),
          basePayload
        ),
        /does not match the expected authenticated principal/
      );
      const peerPrincipal = {
        tenantId: NATIVE_TENANT,
        userId: NATIVE_SAME_TENANT_USER
      };
      const peerPayload = {
        ...basePayload,
        sourceConnectionId: "native_signal_source_c",
        deviceId: sourceStatusDeviceId
      };
      await assert.rejects(
        signalSourceStatusC.applySourceStatus(
          peerPrincipal,
          "record_trackalacker_push_status",
          buildPostgresSignalSourceStatusRequestId(peerPrincipal, peerPayload),
          peerPayload
        ),
        /device ownership is invalid/
      );
    } finally {
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
         WHERE principal_role = $1`,
        [NATIVE_PRINCIPAL_C]
      );
    }
    await assert.rejects(
      signalSourceStatusUnmapped.applySourceStatus(
        principal,
        "record_trackalacker_push_status",
        buildPostgresSignalSourceStatusRequestId(principal, basePayload),
        basePayload
      ),
      /tenant session principal is not active/
    );
    await assert.rejects(
      signalSourceStatusA.applySourceStatus(
        principal,
        "record_trackalacker_push_status",
        `source_status_${"f".repeat(32)}`,
        basePayload
      ),
      /apply request is invalid/
    );
    const peerDevicePayload = { ...basePayload, deviceId: sourceStatusPeerDeviceId };
    await assert.rejects(
      applySourceStatus(signalSourceStatusA, peerDevicePayload),
      /device ownership is invalid/
    );
    const nonTrackPayload = {
      ...basePayload,
      sourceConnectionId: "native_source_status_non_track"
    };
    await assert.rejects(
      applySourceStatus(signalSourceStatusA, nonTrackPayload),
      /source is not TrackaLacker/
    );
    const publicPayload = {
      ...basePayload,
      sourceConnectionId: "native_source_status_public"
    };
    await assert.rejects(
      applySourceStatus(signalSourceStatusA, publicPayload),
      /source is not private/
    );
    const invalidReadyPayload = {
      ...basePayload,
      state: "registering" as const,
      ready: true
    };
    await assert.rejects(
      applySourceStatus(signalSourceStatusA, invalidReadyPayload),
      /payload shape is invalid/
    );

    signalSourceStatusDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalSourceStatusDirectClient.on("error", () => undefined);
    await signalSourceStatusDirectClient.connect();
    await signalSourceStatusDirectClient.query(
      `SET ROLE "${signalSourceStatusManifest.sourceStatusRole.name}"`
    );
    await assert.rejects(
      signalSourceStatusDirectClient.query(
        `SELECT state FROM "${NATIVE_SCHEMA}"."source_device_states" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceStatusDirectClient.query(
        `UPDATE "${NATIVE_SCHEMA}"."source_connections" SET status = 'connected'`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceStatusDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."source_sync_runs"(
           id, tenant_id, user_id, source_connection_id, device_id, phase,
           page, pages, discovered, processed, imported, failed, message,
           started_at, updated_at, completed_at
         ) VALUES ('forbidden_source_sync', $1, $2, $3, $4, 'starting',
                   0, 0, 0, 0, 0, 0, '', $5, $5, '')`,
        [NATIVE_TENANT, NATIVE_USER, sourceStatusConnectionId,
          sourceStatusDeviceId, sourceStatusCreatedAt]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceStatusDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_MISSION_POLICY_APPLY_FUNCTION}"(
           $1, $2, 'revise_mission_policy', 'forbidden_cross_boundary', '{}'
         )`,
        [NATIVE_TENANT, NATIVE_USER]
      ),
      /permission denied/
    );

    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_source_status_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $failure$
       BEGIN
         IF NEW.aggregate_id = '${sourceStatusDeviceId}'
           AND NEW.event_type = 'source_connection_status' THEN
           RAISE EXCEPTION 'native forced source-status outbox failure';
         END IF;
         RETURN NEW;
       END
       $failure$;
       CREATE TRIGGER "yoink_native_reject_source_status_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION
         "${NATIVE_SCHEMA}"."yoink_native_reject_source_status_outbox"()`
    );
    try {
      await assert.rejects(
        applySourceStatus(signalSourceStatusA, basePayload),
        /native forced source-status outbox failure/
      );
      assert.deepEqual(await sourceStatusSnapshot(), sourceStatusBefore);
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_source_status_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS
           "${NATIVE_SCHEMA}"."yoink_native_reject_source_status_outbox"()`
      );
    }

    let sourceStatusTransactionOpen = false;
    let blockedSourceStatusReplay: ReturnType<
      NodePostgresSignalSourceStatusApplyDatabase["applySourceStatus"]
    > | null = null;
    const baseRequestId = buildPostgresSignalSourceStatusRequestId(
      principal,
      basePayload
    );
    try {
      await signalSourceStatusDirectClient.query("BEGIN");
      sourceStatusTransactionOpen = true;
      const firstStatusQuery = await signalSourceStatusDirectClient.query<{
        resultJson: string;
      }>(
        `SELECT result_json AS "resultJson"
         FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_FUNCTION}"(
           $1, $2, 'record_trackalacker_push_status', $3, $4
         )`,
        [NATIVE_TENANT, NATIVE_USER, baseRequestId, JSON.stringify(basePayload)]
      );
      const firstStatusResult = JSON.parse(firstStatusQuery.rows[0]!.resultJson) as {
        requestFingerprint: string;
        outcome: string;
        mutationApplied: boolean;
        idempotentReplay: boolean;
        mutationStatementCount: number;
        mutationRowCount: number;
        stateMutated: boolean;
        connectionMutated: boolean;
        auditMutated: boolean;
        outboxMutated: boolean;
        status: Record<string, unknown>;
        sourceStatusWriterParity: boolean;
        sourceSyncWriterParity: boolean;
        sourceWriterParity: boolean;
        sharedCatalogMutationAuthority: boolean;
        actionAuthority: boolean;
        runtimeAuthority: boolean;
      };
      assert.match(firstStatusResult.requestFingerprint, /^[a-f0-9]{64}$/);
      assert.equal(firstStatusResult.outcome, "applied");
      assert.equal(firstStatusResult.mutationApplied, true);
      assert.equal(firstStatusResult.idempotentReplay, false);
      assert.equal(firstStatusResult.mutationStatementCount, 4);
      assert.equal(firstStatusResult.mutationRowCount, 4);
      assert.equal(firstStatusResult.stateMutated, true);
      assert.equal(firstStatusResult.connectionMutated, true);
      assert.equal(firstStatusResult.auditMutated, true);
      assert.equal(firstStatusResult.outboxMutated, true);
      assert.equal(firstStatusResult.sourceStatusWriterParity, true);
      assert.equal(firstStatusResult.sourceSyncWriterParity, false);
      assert.equal(firstStatusResult.sourceWriterParity, false);
      assert.equal(firstStatusResult.sharedCatalogMutationAuthority, false);
      assert.equal(firstStatusResult.actionAuthority, false);
      assert.equal(firstStatusResult.runtimeAuthority, false);
      assert.equal(firstStatusResult.status.updatedAt, basePayload.updatedAt);
      assert.equal(firstStatusResult.status.connectionStatus, "connecting");
      assert.match(
        String(firstStatusResult.status.connectionUpdatedAt),
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );

      let replaySettled = false;
      blockedSourceStatusReplay = applySourceStatus(
        signalSourceStatusASecond,
        basePayload
      ).finally(() => { replaySettled = true; });
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      assert.equal(replaySettled, false);
      assert.deepEqual(await sourceStatusSnapshot(), sourceStatusBefore);
      await signalSourceStatusDirectClient.query("COMMIT");
      sourceStatusTransactionOpen = false;
      const replay = await blockedSourceStatusReplay;
      assert.equal(replay.outcome, "already_applied");
      assert.equal(replay.mutationApplied, false);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.mutationStatementCount, 0);
      assert.equal(replay.mutationRowCount, 0);
      assert.equal(replay.stateMutated, false);
      assert.equal(replay.connectionMutated, false);
      assert.equal(replay.status.updatedAt, basePayload.updatedAt);
    } finally {
      if (sourceStatusTransactionOpen) {
        await signalSourceStatusDirectClient.query("ROLLBACK").catch(() => undefined);
      }
      if (blockedSourceStatusReplay) {
        await blockedSourceStatusReplay.catch(() => undefined);
      }
    }

    const sourceStatusAfterMaterial = await sourceStatusSnapshot();
    assert.equal(sourceStatusAfterMaterial.connectionStatus, "connecting");
    assert.equal(sourceStatusAfterMaterial.deviceStateCount, 1);
    assert.equal(sourceStatusAfterMaterial.state, "registering");
    assert.equal(sourceStatusAfterMaterial.ready, 0);
    assert.equal(sourceStatusAfterMaterial.subscriptionPresent, 1);
    assert.equal(sourceStatusAfterMaterial.pendingSignals, 2);
    assert.equal(sourceStatusAfterMaterial.lastHttpStatus, 0);
    assert.equal(sourceStatusAfterMaterial.errorCode, "");
    assert.equal(sourceStatusAfterMaterial.updatedAt, basePayload.updatedAt);
    assert.equal(sourceStatusAfterMaterial.auditCount, sourceStatusBefore.auditCount + 1);
    assert.equal(sourceStatusAfterMaterial.outboxCount, sourceStatusBefore.outboxCount + 1);
    assert.equal(sourceStatusAfterMaterial.actionCount, sourceStatusBefore.actionCount);

    const materialAudit = (await first.query<{
      reasonCode: string;
      message: string;
      data: Record<string, unknown>;
      outboxData: Record<string, unknown>;
    }>(
      `SELECT audit.reason_code AS "reasonCode", audit.message,
              audit.data_json::jsonb AS data,
              outbox.payload_json::jsonb->'data' AS "outboxData"
       FROM "${NATIVE_SCHEMA}"."audit_events" audit
       JOIN "${NATIVE_SCHEMA}"."outbox_events" outbox
         ON outbox.payload_json::jsonb->>'auditId' = audit.id
       WHERE audit.correlation_id = $1
         AND audit.event_type = 'source_connection_status'`,
      [sourceStatusDeviceId]
    )).rows[0]!;
    assert.equal(materialAudit.reasonCode, "registering");
    assert.equal(materialAudit.message, "TrackaLacker push bridge status changed.");
    assert.equal(materialAudit.data.state, "registering");
    assert.equal(materialAudit.data.pendingSignals, 2);
    assert.equal(materialAudit.data.lastHttpStatus, 0);
    assert.equal(materialAudit.data.errorCode, "");
    assert.deepEqual(materialAudit.outboxData, materialAudit.data);

    const refreshPayload: PostgresSignalSourceStatusPayload = {
      ...basePayload,
      updatedAt: new Date(sourceStatusNow + 1_000).toISOString()
    };
    const refreshResult = await applySourceStatus(signalSourceStatusA, refreshPayload);
    assert.equal(refreshResult.outcome, "refreshed");
    assert.equal(refreshResult.mutationApplied, true);
    assert.equal(refreshResult.idempotentReplay, false);
    assert.equal(refreshResult.mutationStatementCount, 2);
    assert.equal(refreshResult.mutationRowCount, 2);
    assert.equal(refreshResult.stateMutated, true);
    assert.equal(refreshResult.connectionMutated, true);
    assert.equal(refreshResult.auditMutated, false);
    assert.equal(refreshResult.outboxMutated, false);
    const sourceStatusAfterRefresh = await sourceStatusSnapshot();
    assert.equal(sourceStatusAfterRefresh.updatedAt, refreshPayload.updatedAt);
    assert.equal(sourceStatusAfterRefresh.auditCount, sourceStatusAfterMaterial.auditCount);
    assert.equal(sourceStatusAfterRefresh.outboxCount, sourceStatusAfterMaterial.outboxCount);

    const currentReplay = await applySourceStatus(signalSourceStatusA, refreshPayload);
    assert.equal(currentReplay.outcome, "already_current");
    assert.equal(currentReplay.mutationApplied, false);
    assert.equal(currentReplay.idempotentReplay, true);
    assert.equal(currentReplay.mutationStatementCount, 0);
    assert.equal(currentReplay.mutationRowCount, 0);
    assert.deepEqual(await sourceStatusSnapshot(), sourceStatusAfterRefresh);

    const collisionPayload: PostgresSignalSourceStatusPayload = {
      ...refreshPayload,
      pendingSignals: 3
    };
    await assert.rejects(
      applySourceStatus(signalSourceStatusA, collisionPayload),
      /timestamp collision changed state/
    );
    const stalePayload: PostgresSignalSourceStatusPayload = {
      ...refreshPayload,
      updatedAt: new Date(sourceStatusNow - 1).toISOString()
    };
    await assert.rejects(
      applySourceStatus(signalSourceStatusA, stalePayload),
      /update is stale/
    );

    const readyPayload: PostgresSignalSourceStatusPayload = {
      ...refreshPayload,
      state: "ready",
      ready: true,
      pendingSignals: 0,
      lastHttpStatus: 204,
      lastDeliveryAt: new Date(sourceStatusNow + 1_500).toISOString(),
      updatedAt: new Date(sourceStatusNow + 2_000).toISOString()
    };
    const readyResult = await applySourceStatus(signalSourceStatusA, readyPayload);
    assert.equal(readyResult.outcome, "applied");
    assert.equal(readyResult.mutationStatementCount, 4);
    assert.equal(readyResult.status.connectionStatus, "connected");
    const sourceStatusReady = await sourceStatusSnapshot();
    assert.equal(sourceStatusReady.connectionStatus, "connected");
    assert.equal(sourceStatusReady.state, "ready");
    assert.equal(sourceStatusReady.ready, 1);
    assert.equal(sourceStatusReady.pendingSignals, 0);
    assert.equal(sourceStatusReady.lastHttpStatus, 204);
    assert.equal(sourceStatusReady.lastDeliveryAt, readyPayload.lastDeliveryAt);
    assert.equal(sourceStatusReady.auditCount, sourceStatusAfterRefresh.auditCount + 1);
    assert.equal(sourceStatusReady.outboxCount, sourceStatusAfterRefresh.outboxCount + 1);
    assert.equal(sourceStatusReady.actionCount, sourceStatusBefore.actionCount);

    const historicMaterialReplay = await applySourceStatus(
      signalSourceStatusA,
      basePayload
    );
    assert.equal(historicMaterialReplay.outcome, "already_applied");
    assert.equal(historicMaterialReplay.mutationApplied, false);
    assert.equal(historicMaterialReplay.status.updatedAt, basePayload.updatedAt);
    assert.deepEqual(await sourceStatusSnapshot(), sourceStatusReady);
    await assert.rejects(
      applySourceStatus(signalSourceStatusA, refreshPayload),
      /update is stale/
    );

    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."extension_devices"
       SET status = 'disabled' WHERE id = $1`,
      [sourceStatusDeviceId]
    );
    const disabledPayload: PostgresSignalSourceStatusPayload = {
      ...readyPayload,
      updatedAt: new Date(sourceStatusNow + 3_000).toISOString()
    };
    try {
      await assert.rejects(
        applySourceStatus(signalSourceStatusA, disabledPayload),
        /device is not active/
      );
    } finally {
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."extension_devices"
         SET status = 'active' WHERE id = $1`,
        [sourceStatusDeviceId]
      );
    }
    assert.deepEqual(await sourceStatusSnapshot(), sourceStatusReady);

    await signalSourceStatusDirectClient.end();
    signalSourceStatusDirectClient = null;
    await Promise.all([
      signalSourceStatusA.close(),
      signalSourceStatusASecond.close(),
      signalSourceStatusB.close(),
      signalSourceStatusC.close(),
      signalSourceStatusUnmapped.close()
    ]);
    signalSourceStatusA = null;
    signalSourceStatusASecond = null;
    signalSourceStatusB = null;
    signalSourceStatusC = null;
    signalSourceStatusUnmapped = null;
    })();

    await (async () => {
    const sourceSyncDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalSourceSyncApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalSourceSyncManifest, { maxConnections });
    signalSourceSyncA = sourceSyncDatabase(NATIVE_PRINCIPAL_A, 2);
    signalSourceSyncASecond = sourceSyncDatabase(NATIVE_PRINCIPAL_A);
    signalSourceSyncB = sourceSyncDatabase(NATIVE_PRINCIPAL_B);
    signalSourceSyncC = sourceSyncDatabase(NATIVE_PRINCIPAL_C);
    signalSourceSyncUnmapped = sourceSyncDatabase(NATIVE_PRINCIPAL_UNMAPPED);

    const principal = { tenantId: NATIVE_TENANT, userId: NATIVE_USER };
    const sourceSyncDeviceId = "native_source_status_device";
    const sourceSyncPeerDeviceId = "native_source_status_peer_device";
    const sourceSyncConnectionId = "native_signal_source_a";
    const sourceSyncId = "tlsync_native_source_sync_1234";
    const startPayload: PostgresSignalSourceSyncProgressPayload = {
      deviceId: sourceSyncDeviceId,
      sourceConnectionId: sourceSyncConnectionId,
      syncId: sourceSyncId,
      phase: "starting",
      page: 0,
      pages: 0,
      discovered: 0,
      processed: 0,
      imported: 0,
      failed: 0,
      message: "Starting native followed-library sync",
      confirmation: POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONFIRMATION
    };
    const applySourceSync = (
      database: NodePostgresSignalSourceSyncApplyDatabase,
      operation: "start_source_sync" | "update_source_sync" | "record_source_sync_item",
      payload: PostgresSignalSourceSyncProgressPayload | PostgresSignalSourceSyncItemPayload
    ) => database.applySourceSync(
      principal,
      operation,
      buildPostgresSignalSourceSyncRequestId(principal, operation, payload),
      payload
    );
    const sourceSyncSnapshot = async () => {
      const row = (await first!.query<{
        runCount: string | number | bigint;
        itemCount: string | number | bigint;
        auditCount: string | number | bigint;
        outboxCount: string | number | bigint;
        catalogCandidateCount: string | number | bigint;
        catalogReferenceCount: string | number | bigint;
        listingCount: string | number | bigint;
        actionCount: string | number | bigint;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_sync_runs"
            WHERE tenant_id = $1 AND user_id = $2
              AND device_id = $3) AS "runCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_sync_run_items" item
            JOIN "${NATIVE_SCHEMA}"."source_sync_runs" run ON run.id = item.run_id
            WHERE run.tenant_id = $1 AND run.user_id = $2
              AND run.device_id = $3) AS "itemCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
            WHERE tenant_id = $1 AND user_id = $2
              AND event_type IN ('source_sync_started', 'source_sync_finished'))
             AS "auditCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
            WHERE tenant_id = $1 AND aggregate_type = 'source_sync') AS "outboxCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_listing_candidates")
             AS "catalogCandidateCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_product_refs")
             AS "catalogReferenceCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."listings") AS "listingCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."action_jobs") AS "actionCount"`,
        [NATIVE_TENANT, NATIVE_USER, sourceSyncDeviceId]
      )).rows[0]!;
      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, Number(value)])
      ) as Record<keyof typeof row, number>;
    };
    const sourceSyncBefore = await sourceSyncSnapshot();

    await assert.rejects(
      signalSourceSyncB.applySourceSync(
        principal,
        "start_source_sync",
        buildPostgresSignalSourceSyncRequestId(
          principal,
          "start_source_sync",
          startPayload
        ),
        startPayload
      ),
      /does not match the expected authenticated principal/
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [NATIVE_PRINCIPAL_C, NATIVE_TENANT, NATIVE_SAME_TENANT_USER,
        new Date().toISOString()]
    );
    try {
      const peerPrincipal = {
        tenantId: NATIVE_TENANT,
        userId: NATIVE_SAME_TENANT_USER
      };
      const peerPayload: PostgresSignalSourceSyncProgressPayload = {
        ...startPayload,
        sourceConnectionId: "native_signal_source_c",
        syncId: "tlsync_native_peer_sync_1234"
      };
      await assert.rejects(
        signalSourceSyncC.applySourceSync(
          peerPrincipal,
          "start_source_sync",
          buildPostgresSignalSourceSyncRequestId(
            peerPrincipal,
            "start_source_sync",
            peerPayload
          ),
          peerPayload
        ),
        /device ownership is invalid/
      );
    } finally {
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
         WHERE principal_role = $1`,
        [NATIVE_PRINCIPAL_C]
      );
    }
    await assert.rejects(
      signalSourceSyncUnmapped.applySourceSync(
        principal,
        "start_source_sync",
        buildPostgresSignalSourceSyncRequestId(
          principal,
          "start_source_sync",
          startPayload
        ),
        startPayload
      ),
      /tenant session principal is not active/
    );
    await assert.rejects(
      signalSourceSyncA.applySourceSync(
        principal,
        "start_source_sync",
        `source_sync_${"f".repeat(32)}`,
        startPayload
      ),
      /apply request is invalid/
    );
    await assert.rejects(
      applySourceSync(signalSourceSyncA, "start_source_sync", {
        ...startPayload,
        deviceId: sourceSyncPeerDeviceId,
        syncId: "tlsync_native_peer_device_1234"
      }),
      /device ownership is invalid/
    );
    await assert.rejects(
      applySourceSync(signalSourceSyncA, "start_source_sync", {
        ...startPayload,
        sourceConnectionId: "native_source_status_non_track",
        syncId: "tlsync_native_non_track_1234"
      }),
      /source is not TrackaLacker/
    );
    await assert.rejects(
      applySourceSync(signalSourceSyncA, "start_source_sync", {
        ...startPayload,
        sourceConnectionId: "native_source_status_public",
        syncId: "tlsync_native_public_sync_1234"
      }),
      /source is not private/
    );
    await assert.rejects(
      applySourceSync(signalSourceSyncA, "start_source_sync", {
        ...startPayload,
        discovered: 1
      }),
      /must start with zero counters/
    );
    await assert.rejects(
      applySourceSync(signalSourceSyncA, "start_source_sync", {
        ...startPayload,
        message: `Bearer ${"S".repeat(40)}`
      }),
      /progress payload is invalid/
    );

    signalSourceSyncDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalSourceSyncDirectClient.on("error", () => undefined);
    await signalSourceSyncDirectClient.connect();
    await signalSourceSyncDirectClient.query(
      `SET ROLE "${signalSourceSyncManifest.sourceSyncRole.name}"`
    );
    await assert.rejects(
      signalSourceSyncDirectClient.query(
        `SELECT phase FROM "${NATIVE_SCHEMA}"."source_sync_runs" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceSyncDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."source_sync_run_items"(
           id, run_id, external_product_id, outcome, candidates_accepted,
           listings_mapped, listings_created, error_code, created_at, updated_at
         ) VALUES ('forbidden_sync_item', 'forbidden_run', 'forbidden_product',
                   'imported', 0, 0, 0, '', $1, $1)`,
        [new Date().toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceSyncDirectClient.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."action_jobs"
         WHERE id = 'forbidden_source_sync_action'`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceSyncDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_SOURCE_STATUS_APPLY_FUNCTION}"(
           $1, $2, 'record_trackalacker_push_status',
           'forbidden_cross_boundary', '{}'
         )`,
        [NATIVE_TENANT, NATIVE_USER]
      ),
      /permission denied/
    );

    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_source_sync_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $failure$
       BEGIN
         IF NEW.aggregate_id = '${sourceSyncId}'
           AND NEW.event_type = 'source_sync_started' THEN
           RAISE EXCEPTION 'native forced source-sync outbox failure';
         END IF;
         RETURN NEW;
       END
       $failure$;
       CREATE TRIGGER "yoink_native_reject_source_sync_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION
         "${NATIVE_SCHEMA}"."yoink_native_reject_source_sync_outbox"()`
    );
    try {
      await assert.rejects(
        applySourceSync(signalSourceSyncA, "start_source_sync", startPayload),
        /native forced source-sync outbox failure/
      );
      assert.deepEqual(await sourceSyncSnapshot(), sourceSyncBefore);
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_source_sync_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS
           "${NATIVE_SCHEMA}"."yoink_native_reject_source_sync_outbox"()`
      );
    }

    let sourceSyncTransactionOpen = false;
    let blockedStartReplay: ReturnType<
      NodePostgresSignalSourceSyncApplyDatabase["applySourceSync"]
    > | null = null;
    try {
      await signalSourceSyncDirectClient.query("BEGIN");
      sourceSyncTransactionOpen = true;
      const startRequestId = buildPostgresSignalSourceSyncRequestId(
        principal,
        "start_source_sync",
        startPayload
      );
      const startQuery = await signalSourceSyncDirectClient.query<{
        resultJson: string;
      }>(
        `SELECT result_json AS "resultJson"
         FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_FUNCTION}"(
           $1, $2, 'start_source_sync', $3, $4
         )`,
        [NATIVE_TENANT, NATIVE_USER, startRequestId, JSON.stringify(startPayload)]
      );
      const startResult = JSON.parse(startQuery.rows[0]!.resultJson) as {
        outcome: string;
        mutationApplied: boolean;
        mutationStatementCount: number;
        mutationRowCount: number;
        runMutated: boolean;
        itemMutated: boolean;
        auditMutated: boolean;
        outboxMutated: boolean;
        run: Record<string, unknown>;
        sourceStatusWriterParity: boolean;
        sourceSyncWriterParity: boolean;
        sourceWriterParity: boolean;
        sharedCatalogMutationAuthority: boolean;
        actionAuthority: boolean;
        runtimeAuthority: boolean;
      };
      assert.equal(startResult.outcome, "applied");
      assert.equal(startResult.mutationApplied, true);
      assert.equal(startResult.mutationStatementCount, 3);
      assert.equal(startResult.mutationRowCount, 3);
      assert.equal(startResult.runMutated, true);
      assert.equal(startResult.itemMutated, false);
      assert.equal(startResult.auditMutated, true);
      assert.equal(startResult.outboxMutated, true);
      assert.equal(startResult.run.phase, "starting");
      assert.equal(startResult.sourceStatusWriterParity, true);
      assert.equal(startResult.sourceSyncWriterParity, true);
      assert.equal(startResult.sourceWriterParity, false);
      assert.equal(startResult.sharedCatalogMutationAuthority, false);
      assert.equal(startResult.actionAuthority, false);
      assert.equal(startResult.runtimeAuthority, false);

      let replaySettled = false;
      blockedStartReplay = applySourceSync(
        signalSourceSyncASecond,
        "start_source_sync",
        startPayload
      ).finally(() => { replaySettled = true; });
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      assert.equal(replaySettled, false);
      assert.deepEqual(await sourceSyncSnapshot(), sourceSyncBefore);
      await signalSourceSyncDirectClient.query("COMMIT");
      sourceSyncTransactionOpen = false;
      const replay = await blockedStartReplay;
      assert.equal(replay.outcome, "already_applied");
      assert.equal(replay.mutationApplied, false);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.mutationStatementCount, 0);
      assert.equal(replay.run?.phase, "starting");
    } finally {
      if (sourceSyncTransactionOpen) {
        await signalSourceSyncDirectClient.query("ROLLBACK").catch(() => undefined);
      }
      if (blockedStartReplay) await blockedStartReplay.catch(() => undefined);
    }

    const afterStart = await sourceSyncSnapshot();
    assert.equal(afterStart.runCount, sourceSyncBefore.runCount + 1);
    assert.equal(afterStart.itemCount, sourceSyncBefore.itemCount);
    assert.equal(afterStart.auditCount, sourceSyncBefore.auditCount + 1);
    assert.equal(afterStart.outboxCount, sourceSyncBefore.outboxCount + 1);
    assert.equal(afterStart.catalogCandidateCount, sourceSyncBefore.catalogCandidateCount);
    assert.equal(afterStart.catalogReferenceCount, sourceSyncBefore.catalogReferenceCount);
    assert.equal(afterStart.listingCount, sourceSyncBefore.listingCount);
    assert.equal(afterStart.actionCount, sourceSyncBefore.actionCount);

    await assert.rejects(
      applySourceSync(signalSourceSyncA, "start_source_sync", {
        ...startPayload,
        syncId: "tlsync_native_competing_1234"
      }),
      /already active/
    );

    const discoveringPayload: PostgresSignalSourceSyncProgressPayload = {
      ...startPayload,
      phase: "discovering",
      page: 1,
      pages: 2,
      discovered: 10_001,
      message: "Discovered native followed products"
    };
    const discoveringResult = await applySourceSync(
      signalSourceSyncA,
      "update_source_sync",
      discoveringPayload
    );
    assert.equal(discoveringResult.outcome, "applied");
    assert.equal(discoveringResult.mutationStatementCount, 1);
    assert.equal(discoveringResult.auditMutated, false);
    assert.equal(discoveringResult.outboxMutated, false);
    assert.equal(discoveringResult.run?.discovered, 10_001);
    const exactProgressReplay = await applySourceSync(
      signalSourceSyncA,
      "update_source_sync",
      discoveringPayload
    );
    assert.equal(exactProgressReplay.outcome, "already_current");
    assert.equal(exactProgressReplay.mutationApplied, false);
    await assert.rejects(
      applySourceSync(signalSourceSyncA, "update_source_sync", {
        ...discoveringPayload,
        discovered: 10_000
      }),
      /cannot move backwards/
    );

    const itemPayload: PostgresSignalSourceSyncItemPayload = {
      deviceId: sourceSyncDeviceId,
      sourceConnectionId: sourceSyncConnectionId,
      syncId: sourceSyncId,
      externalProductId: "native-product:138022",
      candidatesAccepted: 7,
      listingsMapped: 4,
      listingsCreated: 3,
      confirmation: POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_CONFIRMATION
    };
    const itemResult = await applySourceSync(
      signalSourceSyncA,
      "record_source_sync_item",
      itemPayload
    );
    assert.equal(itemResult.outcome, "applied");
    assert.equal(itemResult.mutationStatementCount, 1);
    assert.equal(itemResult.itemMutated, true);
    assert.equal(itemResult.auditMutated, false);
    assert.equal(itemResult.item?.externalProductId, itemPayload.externalProductId);
    const itemReplay = await applySourceSync(
      signalSourceSyncA,
      "record_source_sync_item",
      itemPayload
    );
    assert.equal(itemReplay.outcome, "already_current");
    assert.equal(itemReplay.mutationApplied, false);
    const refreshedItemPayload: PostgresSignalSourceSyncItemPayload = {
      ...itemPayload,
      candidatesAccepted: 8,
      listingsMapped: 5
    };
    const refreshedItem = await applySourceSync(
      signalSourceSyncA,
      "record_source_sync_item",
      refreshedItemPayload
    );
    assert.equal(refreshedItem.outcome, "refreshed");
    assert.equal(refreshedItem.mutationApplied, true);
    assert.equal(refreshedItem.item?.candidatesAccepted, 8);

    const completedPayload: PostgresSignalSourceSyncProgressPayload = {
      ...discoveringPayload,
      phase: "complete",
      page: 2,
      processed: 1,
      imported: 1,
      message: "Native followed-library sync complete"
    };
    const completedResult = await applySourceSync(
      signalSourceSyncA,
      "update_source_sync",
      completedPayload
    );
    assert.equal(completedResult.outcome, "applied");
    assert.equal(completedResult.mutationStatementCount, 3);
    assert.equal(completedResult.auditMutated, true);
    assert.equal(completedResult.outboxMutated, true);
    assert.equal(completedResult.run?.phase, "complete");
    assert.match(String(completedResult.run?.completedAt), /^\d{4}-\d{2}-\d{2}T/);
    const completedReplay = await applySourceSync(
      signalSourceSyncA,
      "update_source_sync",
      completedPayload
    );
    assert.equal(completedReplay.outcome, "already_applied");
    assert.equal(completedReplay.mutationApplied, false);
    await assert.rejects(
      applySourceSync(signalSourceSyncA, "record_source_sync_item", refreshedItemPayload),
      /run is not active/
    );
    await assert.rejects(
      applySourceSync(signalSourceSyncA, "update_source_sync", {
        ...completedPayload,
        phase: "importing"
      }),
      /phase transition is invalid/
    );

    const staleSyncId = "tlsync_native_stale_sync_1234";
    const staleTimestamp = new Date(Date.now() - 31 * 60_000).toISOString();
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."source_sync_runs"(
         id, tenant_id, user_id, source_connection_id, device_id, phase,
         page, pages, discovered, processed, imported, failed, message,
         started_at, updated_at, completed_at
       ) VALUES ($1, $2, $3, $4, $5, 'importing',
                 1, 1, 1, 0, 0, 0, 'Stale native sync', $6, $6, '')`,
      [staleSyncId, NATIVE_TENANT, NATIVE_USER, sourceSyncConnectionId,
        sourceSyncDeviceId, staleTimestamp]
    );
    const replacementPayload: PostgresSignalSourceSyncProgressPayload = {
      ...startPayload,
      syncId: "tlsync_native_replacement_1234",
      message: "Starting after stale native sync"
    };
    const replacementResult = await applySourceSync(
      signalSourceSyncA,
      "start_source_sync",
      replacementPayload
    );
    assert.equal(replacementResult.outcome, "applied");
    assert.equal(replacementResult.mutationStatementCount, 4);
    assert.equal(replacementResult.interruptedRunMutated, true);
    const staleRow = (await first.query<{
      phase: string;
      message: string;
      completedAt: string;
    }>(
      `SELECT phase, message, completed_at AS "completedAt"
       FROM "${NATIVE_SCHEMA}"."source_sync_runs" WHERE id = $1`,
      [staleSyncId]
    )).rows[0]!;
    assert.equal(staleRow.phase, "error");
    assert.equal(staleRow.message, "The previous sync was interrupted before completion.");
    assert.match(staleRow.completedAt, /^\d{4}-\d{2}-\d{2}T/);

    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."extension_devices"
       SET status = 'disabled' WHERE id = $1`,
      [sourceSyncDeviceId]
    );
    try {
      await assert.rejects(
        applySourceSync(signalSourceSyncA, "update_source_sync", {
          ...replacementPayload,
          phase: "discovering",
          discovered: 1,
          message: "Should fail while device disabled"
        }),
        /device is not active/
      );
    } finally {
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."extension_devices"
         SET status = 'active' WHERE id = $1`,
        [sourceSyncDeviceId]
      );
    }

    const sourceSyncAfter = await sourceSyncSnapshot();
    assert.equal(sourceSyncAfter.itemCount, sourceSyncBefore.itemCount + 1);
    assert.equal(sourceSyncAfter.catalogCandidateCount, sourceSyncBefore.catalogCandidateCount);
    assert.equal(sourceSyncAfter.catalogReferenceCount, sourceSyncBefore.catalogReferenceCount);
    assert.equal(sourceSyncAfter.listingCount, sourceSyncBefore.listingCount);
    assert.equal(sourceSyncAfter.actionCount, sourceSyncBefore.actionCount);

    await signalSourceSyncDirectClient.end();
    signalSourceSyncDirectClient = null;
    await Promise.all([
      signalSourceSyncA.close(),
      signalSourceSyncASecond.close(),
      signalSourceSyncB.close(),
      signalSourceSyncC.close(),
      signalSourceSyncUnmapped.close()
    ]);
    signalSourceSyncA = null;
    signalSourceSyncASecond = null;
    signalSourceSyncB = null;
    signalSourceSyncC = null;
    signalSourceSyncUnmapped = null;
    })();

    await (async () => {
    const catalogImportDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalCatalogImportApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalCatalogImportManifest, { maxConnections });
    signalCatalogImportA = catalogImportDatabase(NATIVE_PRINCIPAL_A, 2);
    signalCatalogImportASecond = catalogImportDatabase(NATIVE_PRINCIPAL_A, 2);
    signalCatalogImportB = catalogImportDatabase(NATIVE_PRINCIPAL_B, 2);
    signalCatalogImportUnmapped = catalogImportDatabase(NATIVE_PRINCIPAL_UNMAPPED);

    const catalogPrincipalA = { tenantId: NATIVE_TENANT, userId: NATIVE_USER };
    const catalogPrincipalB = { tenantId: "tenant_local", userId: "user_local" };
    const catalogDeviceA = "native_catalog_import_device_a";
    const catalogDeviceB = "native_catalog_import_device_b";
    const catalogSourceA = "native_catalog_import_source_a";
    const catalogSourceB = "native_catalog_import_source_b";
    const catalogSyncA = "tlsync_native_catalog_import_1234";
    const fixtureCreatedAt = new Date(Date.now() - 60_000).toISOString();
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."extension_devices"(
         id, tenant_id, user_id, name, token_hash, extension_version,
         status, capabilities_json, last_seen_at, created_at, updated_at,
         credential_generation, credential_issued_at
       ) VALUES
         ($1, $2, $3, 'Native catalog import A', $4, '0.94.0',
          'active', '{}', $8, $8, $8, 1, $8),
         ($5, $6, $7, 'Native catalog import B', $9, '0.94.0',
          'active', '{}', $8, $8, $8, 1, $8)`,
      [
        catalogDeviceA,
        catalogPrincipalA.tenantId,
        catalogPrincipalA.userId,
        stableHash("native_catalog_import_device_a"),
        catalogDeviceB,
        catalogPrincipalB.tenantId,
        catalogPrincipalB.userId,
        fixtureCreatedAt,
        stableHash("native_catalog_import_device_b")
      ]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."source_connections"(
         id, tenant_id, user_id, source, name, status, trust_level,
         auto_create_missions, is_private, last_event_at, created_at, updated_at
       ) VALUES
         ($1, $2, $3, 'trackalacker', 'Native catalog import A', 'connected',
          'informational', 0, 1, '', $7, $7),
         ($4, $5, $6, 'trackalacker', 'Native catalog import B', 'connected',
          'informational', 0, 1, '', $7, $7)`,
      [
        catalogSourceA,
        catalogPrincipalA.tenantId,
        catalogPrincipalA.userId,
        catalogSourceB,
        catalogPrincipalB.tenantId,
        catalogPrincipalB.userId,
        fixtureCreatedAt
      ]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."source_sync_runs"(
         id, tenant_id, user_id, source_connection_id, device_id, phase,
         page, pages, discovered, processed, imported, failed, message,
         started_at, updated_at, completed_at
       ) VALUES ($1, $2, $3, $4, $5, 'importing',
                 1, 1, 1, 0, 0, 0, 'Native catalog import', $6, $6, '')`,
      [catalogSyncA, catalogPrincipalA.tenantId, catalogPrincipalA.userId,
        catalogSourceA, catalogDeviceA, fixtureCreatedAt]
    );

    const applyCatalogImport = (
      database: NodePostgresSignalCatalogImportApplyDatabase,
      principalValue: typeof catalogPrincipalA,
      payloadValue: PostgresSignalCatalogImportPayload
    ) => database.applyCatalogImport(
      principalValue,
      "import_trackalacker_catalog_item",
      buildPostgresSignalCatalogImportRequestId(
        principalValue,
        "import_trackalacker_catalog_item",
        payloadValue
      ),
      payloadValue
    );
    type CatalogSnapshot = {
      families: number;
      variants: number;
      listings: number;
      listingUrls: number;
      productRefs: number;
      aliases: number;
      candidates: number;
      listingRefs: number;
      preferredRefs: number;
      observations: number;
      missionTargets: number;
      syncItems: number;
      audits: number;
      outboxes: number;
      actions: number;
    };
    const catalogSnapshot = async (): Promise<CatalogSnapshot> => {
      const row = (await first!.query<{
        families: string | number | bigint;
        variants: string | number | bigint;
        listings: string | number | bigint;
        listingUrls: string | number | bigint;
        productRefs: string | number | bigint;
        aliases: string | number | bigint;
        candidates: string | number | bigint;
        listingRefs: string | number | bigint;
        preferredRefs: string | number | bigint;
        observations: string | number | bigint;
        missionTargets: string | number | bigint;
        syncItems: string | number | bigint;
        audits: string | number | bigint;
        outboxes: string | number | bigint;
        actions: string | number | bigint;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."product_families") AS families,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."variants") AS variants,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."listings") AS listings,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."listing_urls") AS "listingUrls",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_product_refs"
            WHERE source_connection_id IN ($1, $2)) AS "productRefs",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_product_aliases"
            WHERE source_connection_id IN ($1, $2)) AS aliases,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_listing_candidates"
            WHERE source_connection_id IN ($1, $2)) AS candidates,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_listing_refs"
            WHERE source_connection_id IN ($1, $2)) AS "listingRefs",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_variant_retailer_refs"
            WHERE source_connection_id IN ($1, $2)) AS "preferredRefs",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."offer_observations"
            WHERE source_connection_id IN ($1, $2)) AS observations,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."mission_targets") AS "missionTargets",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_sync_run_items"
            WHERE run_id = $3) AS "syncItems",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
            WHERE event_type = 'trackalacker_catalog_item_imported'
              AND tenant_id IN ($4, $5)) AS audits,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
            WHERE aggregate_type = 'source_catalog_import'
              AND tenant_id IN ($4, $5)) AS outboxes,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."action_jobs") AS actions`,
        [catalogSourceA, catalogSourceB, catalogSyncA,
          catalogPrincipalA.tenantId, catalogPrincipalB.tenantId]
      )).rows[0]!;
      return {
        families: Number(row.families),
        variants: Number(row.variants),
        listings: Number(row.listings),
        listingUrls: Number(row.listingUrls),
        productRefs: Number(row.productRefs),
        aliases: Number(row.aliases),
        candidates: Number(row.candidates),
        listingRefs: Number(row.listingRefs),
        preferredRefs: Number(row.preferredRefs),
        observations: Number(row.observations),
        missionTargets: Number(row.missionTargets),
        syncItems: Number(row.syncItems),
        audits: Number(row.audits),
        outboxes: Number(row.outboxes),
        actions: Number(row.actions)
      };
    };

    const observedAt = new Date().toISOString();
    const initialPayload: PostgresSignalCatalogImportPayload = {
      deviceId: catalogDeviceA,
      sourceConnectionId: catalogSourceA,
      syncId: catalogSyncA,
      sourceProductId: "catalog-product:alpha",
      sourceProductSlug: "native-catalog-product-alpha",
      sourceProductUrl:
        "https://www.trackalacker.com/products/showcase/native-catalog-product-alpha?view=all",
      title: "Native catalog product alpha",
      msrpCents: 4_999,
      observedAt,
      listings: [
        {
          sourceListingId: "catalog-listing:amazon-alpha",
          storeName: "Amazon",
          retailerId: "amazon",
          retailerSku: "B0CATALOG1",
          canonicalUrl: "https://www.amazon.com/dp/B0CATALOG1",
          sourceListingUrl:
            "https://www.trackalacker.com/listings/native-amazon-alpha?view=all",
          outboundUrl: "https://www.amazon.com/dp/B0CATALOG1?tag=native-20",
          availability: "in_stock",
          unitPriceCents: 4_799
        },
        {
          sourceListingId: "catalog-listing:walmart-alpha",
          storeName: "Walmart",
          retailerId: "walmart",
          retailerSku: "987654321",
          canonicalUrl: "https://www.walmart.com/ip/987654321",
          sourceListingUrl:
            "https://www.trackalacker.com/listings/native-walmart-alpha?view=all",
          outboundUrl: "https://www.walmart.com/ip/987654321?athbdg=native",
          availability: "preorder",
          unitPriceCents: 4_899
        },
        {
          sourceListingId: "catalog-listing:other-alpha",
          storeName: "Independent shop",
          retailerId: "",
          retailerSku: "",
          canonicalUrl: "",
          sourceListingUrl:
            "https://www.trackalacker.com/listings/native-other-alpha?view=all",
          outboundUrl: "https://shop.example.com/native-alpha?campaign=one",
          availability: "unknown",
          unitPriceCents: null
        }
      ],
      confirmation: POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONFIRMATION
    };
    const initialRequestId = buildPostgresSignalCatalogImportRequestId(
      catalogPrincipalA,
      "import_trackalacker_catalog_item",
      initialPayload
    );
    const catalogBefore = await catalogSnapshot();

    await assert.rejects(
      signalCatalogImportB.applyCatalogImport(
        catalogPrincipalA,
        "import_trackalacker_catalog_item",
        initialRequestId,
        initialPayload
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      signalCatalogImportUnmapped.applyCatalogImport(
        catalogPrincipalA,
        "import_trackalacker_catalog_item",
        initialRequestId,
        initialPayload
      ),
      /principal is not active/
    );
    await assert.rejects(
      applyCatalogImport(signalCatalogImportA, catalogPrincipalA, {
        ...initialPayload,
        sourceConnectionId: "native_catalog_import_missing_source",
        syncId: ""
      }),
      /source (?:ownership is invalid|is unavailable)/
    );
    await assert.rejects(
      applyCatalogImport(signalCatalogImportA, catalogPrincipalA, {
        ...initialPayload,
        syncId: "",
        listings: [{
          ...initialPayload.listings[0]!,
          canonicalUrl: "https://www.amazon.com/dp/B0DIFFERENT"
        }]
      }),
      /canonical retailer identity is invalid/
    );
    await assert.rejects(
      applyCatalogImport(signalCatalogImportA, catalogPrincipalA, {
        ...initialPayload,
        syncId: "",
        msrpCents: 12.5
      }),
      /product price is invalid/
    );
    const oversizedListings = Array.from({ length: 251 }, (_, index) => ({
      sourceListingId: `catalog-oversized:${index}`,
      storeName: "Unmapped store",
      retailerId: "",
      retailerSku: "",
      canonicalUrl: "",
      sourceListingUrl: `https://www.trackalacker.com/listings/oversized-${index}`,
      outboundUrl: "",
      availability: "unknown" as const,
      unitPriceCents: null
    }));
    await assert.rejects(
      applyCatalogImport(signalCatalogImportA, catalogPrincipalA, {
        ...initialPayload,
        syncId: "",
        listings: oversizedListings
      }),
      /product identity is invalid/
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."extension_devices"
       SET status = 'disabled' WHERE id = $1`,
      [catalogDeviceA]
    );
    try {
      await assert.rejects(
        applyCatalogImport(signalCatalogImportA, catalogPrincipalA, initialPayload),
        /device is unavailable/
      );
    } finally {
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."extension_devices"
         SET status = 'active' WHERE id = $1`,
        [catalogDeviceA]
      );
    }
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."source_connections"
       SET is_private = 0 WHERE id = $1`,
      [catalogSourceA]
    );
    try {
      await assert.rejects(
        applyCatalogImport(signalCatalogImportA, catalogPrincipalA, initialPayload),
        /source is unavailable/
      );
    } finally {
      await first.query(
        `UPDATE "${NATIVE_SCHEMA}"."source_connections"
         SET is_private = 1 WHERE id = $1`,
        [catalogSourceA]
      );
    }
    assert.deepEqual(await catalogSnapshot(), catalogBefore);

    signalCatalogImportDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalCatalogImportDirectClient.on("error", () => undefined);
    await signalCatalogImportDirectClient.connect();
    await signalCatalogImportDirectClient.query(
      `SET ROLE "${signalCatalogImportManifest.catalogImportRole.name}"`
    );
    await assert.rejects(
      signalCatalogImportDirectClient.query(
        `SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."product_families"`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalCatalogImportDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."source_connections"(id)
         VALUES ('forbidden_catalog_import_source')`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalCatalogImportDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_FUNCTION}"(
           $1, $2, 'release_spend_reservation', 'forbidden_cross_boundary', '{}'
         )`,
        [catalogPrincipalA.tenantId, catalogPrincipalA.userId]
      ),
      /permission denied/
    );

    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_catalog_import_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $failure$
       BEGIN
         IF NEW.aggregate_type = 'source_catalog_import'
           AND NEW.aggregate_id = '${initialRequestId}' THEN
           RAISE EXCEPTION 'native forced catalog-import outbox failure';
         END IF;
         RETURN NEW;
       END
       $failure$;
       CREATE TRIGGER "yoink_native_reject_catalog_import_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION
         "${NATIVE_SCHEMA}"."yoink_native_reject_catalog_import_outbox"()`
    );
    try {
      await assert.rejects(
        applyCatalogImport(signalCatalogImportA, catalogPrincipalA, initialPayload),
        /native forced catalog-import outbox failure/
      );
      assert.deepEqual(await catalogSnapshot(), catalogBefore);
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_catalog_import_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS
           "${NATIVE_SCHEMA}"."yoink_native_reject_catalog_import_outbox"()`
      );
    }

    const firstResult = await applyCatalogImport(
      signalCatalogImportA,
      catalogPrincipalA,
      initialPayload
    );
    assert.equal(firstResult.outcome, "applied");
    assert.equal(firstResult.mutationApplied, true);
    assert.equal(firstResult.idempotentReplay, false);
    assert.equal(firstResult.familyCreated, true);
    assert.equal(firstResult.variantCreated, true);
    assert.equal(firstResult.candidatesAccepted, 3);
    assert.equal(firstResult.listingsMapped, 2);
    assert.equal(firstResult.listingsCreated, 2);
    assert.equal(firstResult.offerObservationsCreated, 2);
    assert.equal(firstResult.missionTargetsCreated, 0);
    assert.equal(firstResult.preferredRoutesUpdated, 2);
    assert.equal(firstResult.sourceProductRefMutated, true);
    assert.equal(firstResult.sourceAliasMutated, true);
    assert.equal(firstResult.syncItemMutated, true);
    assert.equal(firstResult.auditMutated, true);
    assert.equal(firstResult.outboxMutated, true);
    assert.equal(firstResult.sharedCatalogMutationAuthority, true);
    assert.equal(firstResult.actionAuthority, false);
    assert.equal(firstResult.runtimeAuthority, false);
    assert.deepEqual(firstResult.syncReceipt, {
      runId: catalogSyncA,
      externalProductId: initialPayload.sourceProductId,
      outcome: "imported",
      candidatesAccepted: 3,
      listingsMapped: 2,
      listingsCreated: 2,
      updatedAt: (firstResult.syncReceipt as { updatedAt: string }).updatedAt
    });
    assert.match(
      String((firstResult.syncReceipt as { updatedAt: string }).updatedAt),
      /^\d{4}-\d{2}-\d{2}T/
    );
    const catalogAfterFirst = await catalogSnapshot();
    assert.deepEqual(catalogAfterFirst, {
      ...catalogBefore,
      families: catalogBefore.families + 1,
      variants: catalogBefore.variants + 1,
      listings: catalogBefore.listings + 2,
      listingUrls: catalogBefore.listingUrls + 4,
      productRefs: catalogBefore.productRefs + 1,
      aliases: catalogBefore.aliases + 1,
      candidates: catalogBefore.candidates + 3,
      listingRefs: catalogBefore.listingRefs + 2,
      preferredRefs: catalogBefore.preferredRefs + 2,
      observations: catalogBefore.observations + 2,
      syncItems: catalogBefore.syncItems + 1,
      audits: catalogBefore.audits + 1,
      outboxes: catalogBefore.outboxes + 1
    });
    const persistedQueryUrls = (await first.query<{
      sourceUrl: string;
      outboundUrl: string;
    }>(
      `SELECT source_url AS "sourceUrl", outbound_url AS "outboundUrl"
       FROM "${NATIVE_SCHEMA}"."source_listing_candidates"
       WHERE source_connection_id = $1 AND external_listing_id = $2`,
      [catalogSourceA, initialPayload.listings[0]!.sourceListingId]
    )).rows[0]!;
    assert.equal(persistedQueryUrls.sourceUrl, initialPayload.listings[0]!.sourceListingUrl);
    assert.equal(persistedQueryUrls.outboundUrl, initialPayload.listings[0]!.outboundUrl);

    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."source_sync_runs"
       SET phase = 'complete', completed_at = $2, updated_at = $2 WHERE id = $1`,
      [catalogSyncA, new Date().toISOString()]
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."outbox_events"
       SET delivery_state = 'delivered', delivery_attempts = 1,
           delivered_at = $2, updated_at = $2
       WHERE aggregate_type = 'source_catalog_import' AND aggregate_id = $1`,
      [initialRequestId, new Date().toISOString()]
    );
    const exactReplay = await applyCatalogImport(
      signalCatalogImportASecond,
      catalogPrincipalA,
      initialPayload
    );
    assert.equal(exactReplay.outcome, "already_applied");
    assert.equal(exactReplay.mutationApplied, false);
    assert.equal(exactReplay.idempotentReplay, true);
    assert.equal(exactReplay.mutationStatementCount, 0);
    assert.equal(exactReplay.mutationRowCount, 0);
    assert.equal(exactReplay.sourceProductRefMutated, false);
    assert.equal(exactReplay.sourceAliasMutated, false);
    assert.equal(exactReplay.syncItemMutated, false);
    assert.equal(exactReplay.auditMutated, false);
    assert.equal(exactReplay.outboxMutated, false);
    assert.deepEqual(await catalogSnapshot(), catalogAfterFirst);
    await assert.rejects(
      applyCatalogImport(signalCatalogImportA, catalogPrincipalA, {
        ...initialPayload,
        observedAt: new Date(Date.parse(observedAt) + 1_000).toISOString()
      }),
      /sync run is not active/
    );
    await assert.rejects(
      signalCatalogImportDirectClient.query(
        `SELECT result_json FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_FUNCTION}"(
           $1, $2, 'import_trackalacker_catalog_item', $3, $4
         )`,
        [catalogPrincipalA.tenantId, catalogPrincipalA.userId, initialRequestId,
          JSON.stringify({ ...initialPayload, title: "Altered replay title" })]
      ),
      /request identity is invalid/
    );
    assert.deepEqual(await catalogSnapshot(), catalogAfterFirst);

    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."missions"(
         id, tenant_id, user_id, variant_id, status, origin,
         target_quantity, fulfilled_quantity, created_at, updated_at
       ) VALUES ('native_catalog_import_mission', $1, $2, $3, 'active',
                 'manual', 1, 0, $4, $4)`,
      [catalogPrincipalA.tenantId, catalogPrincipalA.userId,
        firstResult.variantId, new Date().toISOString()]
    );
    const secondObservedAt = new Date(Date.parse(observedAt) + 2_000).toISOString();
    const secondPayload: PostgresSignalCatalogImportPayload = {
      ...initialPayload,
      syncId: "",
      observedAt: secondObservedAt,
      listings: [
        initialPayload.listings[0]!,
        initialPayload.listings[1]!,
        {
          sourceListingId: "catalog-listing:bestbuy-alpha",
          storeName: "Best Buy",
          retailerId: "bestbuy",
          retailerSku: "6670797",
          canonicalUrl: "https://www.bestbuy.com/site/-/6670797.p",
          sourceListingUrl:
            "https://www.trackalacker.com/listings/native-bestbuy-alpha?view=all",
          outboundUrl:
            "https://www.bestbuy.com/site/-/6670797.p?intl=nosplash",
          availability: "in_stock",
          unitPriceCents: 4_699
        }
      ]
    };
    const secondResult = await applyCatalogImport(
      signalCatalogImportA,
      catalogPrincipalA,
      secondPayload
    );
    assert.equal(secondResult.outcome, "applied");
    assert.equal(secondResult.familyCreated, false);
    assert.equal(secondResult.variantCreated, false);
    assert.equal(secondResult.variantId, firstResult.variantId);
    assert.equal(secondResult.candidatesAccepted, 3);
    assert.equal(secondResult.listingsMapped, 3);
    assert.equal(secondResult.listingsCreated, 1);
    assert.equal(secondResult.offerObservationsCreated, 3);
    assert.equal(secondResult.missionTargetsCreated, 3);
    assert.equal(secondResult.preferredRoutesUpdated, 3);
    assert.equal(secondResult.syncItemMutated, false);
    assert.equal(secondResult.syncReceipt, null);
    const attachedTargets = (await first.query<{
      count: string | number | bigint;
      minimumEnabled: string | number | bigint;
      maximumEnabled: string | number | bigint;
    }>(
      `SELECT COUNT(*) AS count, MIN(enabled) AS "minimumEnabled",
              MAX(enabled) AS "maximumEnabled"
       FROM "${NATIVE_SCHEMA}"."mission_targets"
       WHERE mission_id = 'native_catalog_import_mission'`
    )).rows[0]!;
    assert.equal(Number(attachedTargets.count), 3);
    assert.equal(Number(attachedTargets.minimumEnabled), 0);
    assert.equal(Number(attachedTargets.maximumEnabled), 0);
    await assert.rejects(
      applyCatalogImport(signalCatalogImportA, catalogPrincipalA, {
        ...secondPayload,
        observedAt: new Date(Date.parse(observedAt) - 1_000).toISOString()
      }),
      /source product observation is stale/
    );

    const conflictCreatedAt = new Date().toISOString();
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."product_families"(
         id, title, brand, created_at, updated_at
       ) VALUES ('native_catalog_conflict_family', 'Native conflict', '', $1, $1)`,
      [conflictCreatedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."variants"(
         id, family_id, title, attributes_json, created_at, updated_at
       ) VALUES ('native_catalog_conflict_variant', 'native_catalog_conflict_family',
                 'Native conflict', '{}', $1, $1)`,
      [conflictCreatedAt]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."listings"(
         id, variant_id, retailer_id, retailer_sku, canonical_url, status,
         execution_supported, msrp_cents, currency, created_at, updated_at
       ) VALUES ('native_catalog_conflict_listing', 'native_catalog_conflict_variant',
                 'amazon', 'B0CONFLX01', 'https://www.amazon.com/dp/B0CONFLX01',
                 'in_stock', 0, 4999, 'USD', $1, $1)`,
      [conflictCreatedAt]
    );
    const conflictBefore = await catalogSnapshot();
    await assert.rejects(
      applyCatalogImport(signalCatalogImportA, catalogPrincipalA, {
        ...secondPayload,
        observedAt: new Date(Date.parse(secondObservedAt) + 1_000).toISOString(),
        listings: [
          secondPayload.listings[0]!,
          {
            sourceListingId: "catalog-listing:conflict-alpha",
            storeName: "Amazon",
            retailerId: "amazon",
            retailerSku: "B0CONFLX01",
            canonicalUrl: "https://www.amazon.com/dp/B0CONFLX01",
            sourceListingUrl:
              "https://www.trackalacker.com/listings/native-conflict-alpha",
            outboundUrl: "https://www.amazon.com/dp/B0CONFLX01",
            availability: "in_stock",
            unitPriceCents: 4_999
          }
        ]
      }),
      /exact identities resolve to different variants/
    );
    assert.deepEqual(await catalogSnapshot(), conflictBefore);

    const sharedSku = "B0SHAREX01";
    const sharedObservedAt = new Date(Date.parse(secondObservedAt) + 2_000).toISOString();
    const sharedPayload = (
      deviceId: string,
      sourceConnectionId: string,
      suffix: "a" | "b"
    ): PostgresSignalCatalogImportPayload => ({
      deviceId,
      sourceConnectionId,
      syncId: "",
      sourceProductId: `catalog-product:shared-${suffix}`,
      sourceProductSlug: `native-shared-catalog-product-${suffix}`,
      sourceProductUrl:
        `https://www.trackalacker.com/products/showcase/native-shared-${suffix}`,
      title: "Native shared catalog product",
      msrpCents: 3_999,
      observedAt: sharedObservedAt,
      listings: [{
        sourceListingId: `catalog-listing:shared-${suffix}`,
        storeName: "Amazon",
        retailerId: "amazon",
        retailerSku: sharedSku,
        canonicalUrl: `https://www.amazon.com/dp/${sharedSku}`,
        sourceListingUrl:
          `https://www.trackalacker.com/listings/native-shared-${suffix}`,
        outboundUrl: `https://www.amazon.com/dp/${sharedSku}?tag=native-${suffix}`,
        availability: "in_stock",
        unitPriceCents: 3_899
      }],
      confirmation: POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONFIRMATION
    });
    const sharedPayloadA = sharedPayload(
      catalogDeviceA,
      catalogSourceA,
      "a"
    );
    const sharedPayloadB = sharedPayload(
      catalogDeviceB,
      catalogSourceB,
      "b"
    );
    const sharedBefore = await catalogSnapshot();
    signalCatalogImportLockClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalCatalogImportLockClient.on("error", () => undefined);
    await signalCatalogImportLockClient.connect();
    let sharedLockTransactionOpen = false;
    let sharedImportA: ReturnType<typeof applyCatalogImport> | null = null;
    let sharedImportB: ReturnType<typeof applyCatalogImport> | null = null;
    try {
      await signalCatalogImportLockClient.query("BEGIN");
      sharedLockTransactionOpen = true;
      await signalCatalogImportLockClient.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended($1, 0)
         )`,
        [`yoink_signal_catalog_apply_v1:amazon:${sharedSku}`]
      );
      let sharedASettled = false;
      let sharedBSettled = false;
      sharedImportA = applyCatalogImport(
        signalCatalogImportASecond,
        catalogPrincipalA,
        sharedPayloadA
      ).finally(() => { sharedASettled = true; });
      sharedImportB = applyCatalogImport(
        signalCatalogImportB,
        catalogPrincipalB,
        sharedPayloadB
      ).finally(() => { sharedBSettled = true; });
      const sharedBlockedWaiterCount = async (): Promise<number> => {
        const waiters = await first!.query<{ count: string | number | bigint }>(
          `SELECT COUNT(*) AS count
           FROM pg_catalog.pg_locks AS lock
           JOIN pg_catalog.pg_stat_activity AS activity ON activity.pid = lock.pid
           WHERE lock.locktype = 'advisory' AND lock.granted = FALSE
             AND activity.application_name = 'yoink_postgres_signal_catalog_import'`
        );
        return Number(waiters.rows[0]?.count ?? 0);
      };
      const sharedLockPollDeadline = Date.now() + 10_000;
      while ((await sharedBlockedWaiterCount()) < 2) {
        if (sharedASettled || sharedBSettled) {
          throw new Error(
            "signal catalog-import cross-tenant serialization settled before both sessions blocked"
          );
        }
        if (Date.now() > sharedLockPollDeadline) {
          throw new Error(
            "signal catalog-import cross-tenant serialization did not observe both sessions blocked on the shared advisory lock"
          );
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(sharedASettled, false);
      assert.equal(sharedBSettled, false);
      await signalCatalogImportLockClient.query("COMMIT");
      sharedLockTransactionOpen = false;
      const [sharedResultA, sharedResultB] = await Promise.all([
        sharedImportA,
        sharedImportB
      ]);
      sharedImportA = null;
      sharedImportB = null;
      assert.equal(sharedResultA.variantId, sharedResultB.variantId);
      assert.equal(
        Number(sharedResultA.familyCreated) + Number(sharedResultB.familyCreated),
        1
      );
      assert.equal(
        Number(sharedResultA.variantCreated) + Number(sharedResultB.variantCreated),
        1
      );
      assert.equal(sharedResultA.listingsCreated + sharedResultB.listingsCreated, 1);
    } finally {
      if (sharedLockTransactionOpen) {
        await signalCatalogImportLockClient.query("ROLLBACK").catch(() => undefined);
      }
      if (sharedImportA) await sharedImportA.catch(() => undefined);
      if (sharedImportB) await sharedImportB.catch(() => undefined);
      await signalCatalogImportLockClient.end().catch(() => undefined);
      signalCatalogImportLockClient = null;
    }
    const sharedAfter = await catalogSnapshot();
    assert.equal(sharedAfter.families, sharedBefore.families + 1);
    assert.equal(sharedAfter.variants, sharedBefore.variants + 1);
    assert.equal(sharedAfter.listings, sharedBefore.listings + 1);
    assert.equal(sharedAfter.productRefs, sharedBefore.productRefs + 2);
    assert.equal(sharedAfter.aliases, sharedBefore.aliases + 2);
    assert.equal(sharedAfter.candidates, sharedBefore.candidates + 2);
    assert.equal(sharedAfter.listingRefs, sharedBefore.listingRefs + 2);
    assert.equal(sharedAfter.observations, sharedBefore.observations + 2);
    assert.equal(sharedAfter.audits, sharedBefore.audits + 2);
    assert.equal(sharedAfter.outboxes, sharedBefore.outboxes + 2);
    assert.equal(sharedAfter.actions, catalogBefore.actions);

    await signalCatalogImportDirectClient.end();
    signalCatalogImportDirectClient = null;
    await Promise.all([
      signalCatalogImportA.close(),
      signalCatalogImportASecond.close(),
      signalCatalogImportB.close(),
      signalCatalogImportUnmapped.close()
    ]);
    signalCatalogImportA = null;
    signalCatalogImportASecond = null;
    signalCatalogImportB = null;
    signalCatalogImportUnmapped = null;
    })();

    await (async () => {
    const sourceProvisioningDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalSourceProvisioningApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalSourceProvisioningManifest, { maxConnections });
    signalSourceProvisioningA = sourceProvisioningDatabase(NATIVE_PRINCIPAL_A, 2);
    signalSourceProvisioningASecond = sourceProvisioningDatabase(NATIVE_PRINCIPAL_A);
    signalSourceProvisioningB = sourceProvisioningDatabase(NATIVE_PRINCIPAL_B);
    signalSourceProvisioningC = sourceProvisioningDatabase(NATIVE_PRINCIPAL_C);
    signalSourceProvisioningCSecond = sourceProvisioningDatabase(NATIVE_PRINCIPAL_C);
    signalSourceProvisioningUnmapped = sourceProvisioningDatabase(NATIVE_PRINCIPAL_UNMAPPED);

    const provisioningPrincipalA = { tenantId: NATIVE_TENANT, userId: NATIVE_USER };
    const provisioningPrincipalB = { tenantId: "tenant_local", userId: "user_local" };
    const provisioningPayload: PostgresSignalSourceProvisioningPayload = {
      defaultsVersion: POSTGRES_SIGNAL_SOURCE_PROVISIONING_DEFAULTS_VERSION,
      confirmation: POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONFIRMATION
    };
    const applyProvisioning = (
      database: NodePostgresSignalSourceProvisioningApplyDatabase,
      principalValue: typeof provisioningPrincipalA
    ) => database.provisionSourceConnections(
      principalValue,
      "provision_source_connections",
      buildPostgresSignalSourceProvisioningRequestId(principalValue, provisioningPayload),
      provisioningPayload
    );

    const expectedSourceIds = (userId: string) => ({
      trackalacker: expectedDefaultSourceConnectionId(userId, "trackalacker"),
      browser: expectedDefaultSourceConnectionId(userId, "browser"),
      discord: expectedDefaultSourceConnectionId(userId, "discord")
    });
    const provisioningSnapshot = async (userId: string) => {
      const ids = expectedSourceIds(userId);
      const row = (await first!.query<{
        connections: string | number | bigint;
        audits: string | number | bigint;
        outboxes: string | number | bigint;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."source_connections"
            WHERE id IN ($1, $2, $3)) AS connections,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
            WHERE correlation_id = $4
              AND event_type = 'source_connections_provisioned') AS audits,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
            WHERE event_type = 'source_connections_provisioned'
              AND payload_json::jsonb->>'correlationId' = $4) AS outboxes`,
        [ids.trackalacker, ids.browser, ids.discord, userId]
      )).rows[0]!;
      return {
        connections: Number(row.connections),
        audits: Number(row.audits),
        outboxes: Number(row.outboxes)
      };
    };
    const provisionedRows = async (userId: string) => {
      const ids = expectedSourceIds(userId);
      const result = await first!.query<{
        id: string;
        source: string;
        name: string;
        status: string;
        trustLevel: string;
        autoCreateMissions: number;
        isPrivate: number;
        lastEventAt: string;
      }>(
        `SELECT id, source, name, status, trust_level AS "trustLevel",
                (auto_create_missions)::int AS "autoCreateMissions", (is_private)::int AS "isPrivate",
                last_event_at AS "lastEventAt"
         FROM "${NATIVE_SCHEMA}"."source_connections"
         WHERE id IN ($1, $2, $3)
         ORDER BY source`,
        [ids.trackalacker, ids.browser, ids.discord]
      );
      return result.rows;
    };
    const totalConnectionsForUser = async (
      tenantId: string,
      userId: string
    ): Promise<number> => {
      const row = (await first!.query<{ count: string | number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."source_connections"
         WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId]
      )).rows[0]!;
      return Number(row.count);
    };

    const provisioningBeforeA = await provisioningSnapshot(provisioningPrincipalA.userId);
    assert.equal(provisioningBeforeA.connections, 0);
    assert.equal(provisioningBeforeA.audits, 0);
    assert.equal(provisioningBeforeA.outboxes, 0);

    // Denial matrix: wrong principal.
    await assert.rejects(
      applyProvisioning(signalSourceProvisioningB, provisioningPrincipalA),
      /does not match the expected authenticated principal/
    );
    // Denial matrix: same-tenant peer.
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [NATIVE_PRINCIPAL_C, NATIVE_TENANT, NATIVE_SAME_TENANT_USER,
        new Date(Date.now() - 5_000).toISOString()]
    );
    try {
      await assert.rejects(
        applyProvisioning(signalSourceProvisioningC, provisioningPrincipalA),
        /does not match the expected authenticated principal/
      );
    } finally {
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
         WHERE principal_role = $1`,
        [NATIVE_PRINCIPAL_C]
      );
    }
    // Denial matrix: unmapped principal.
    await assert.rejects(
      applyProvisioning(signalSourceProvisioningUnmapped, provisioningPrincipalA),
      /tenant session principal is not active/
    );
    // Malformed request id: caught client-side before any round trip.
    await assert.rejects(
      signalSourceProvisioningA.provisionSourceConnections(
        provisioningPrincipalA,
        "provision_source_connections",
        `source_provisioning_${"f".repeat(32)}`,
        provisioningPayload
      ),
      /apply request is invalid/
    );

    // Zero direct table SQL for the role, and cross-boundary denial in both
    // directions.
    signalSourceProvisioningDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalSourceProvisioningDirectClient.on("error", () => undefined);
    await signalSourceProvisioningDirectClient.connect();
    await signalSourceProvisioningDirectClient.query(
      `SET ROLE "${signalSourceProvisioningManifest.sourceProvisioningRole.name}"`
    );
    await assert.rejects(
      signalSourceProvisioningDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."source_connections" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceProvisioningDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."audit_events"(id)
         VALUES ('forbidden_source_provisioning_audit')`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceProvisioningDirectClient.query(
        `UPDATE "${NATIVE_SCHEMA}"."outbox_events" SET delivered_at = ''`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalSourceProvisioningDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_FUNCTION}"(
           $1, $2, 'import_trackalacker_catalog_item', 'forbidden_cross_boundary', '{}'
         )`,
        [provisioningPrincipalA.tenantId, provisioningPrincipalA.userId]
      ),
      /permission denied/
    );
    // A sibling role (catalog-import's) cannot call this boundary's function.
    await signalSourceProvisioningDirectClient.query(
      `SET ROLE "${signalCatalogImportManifest.catalogImportRole.name}"`
    );
    await assert.rejects(
      signalSourceProvisioningDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_FUNCTION}"(
           $1, $2, 'provision_source_connections', 'forbidden_cross_boundary_reverse', '{}'
         )`,
        [provisioningPrincipalA.tenantId, provisioningPrincipalA.userId]
      ),
      /permission denied/
    );
    await signalSourceProvisioningDirectClient.query(
      `SET ROLE "${signalSourceProvisioningManifest.sourceProvisioningRole.name}"`
    );

    // Atomicity: a forced outbox failure must leave zero partial writes,
    // including rolling back the TrackaLacker anchor row that is inserted
    // before the shared writer-lock protocol is consumed.
    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_source_provisioning_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $failure$
       BEGIN
         IF NEW.aggregate_type = 'source_connection_provisioning' THEN
           RAISE EXCEPTION 'native forced source-provisioning outbox failure';
         END IF;
         RETURN NEW;
       END
       $failure$;
       CREATE TRIGGER "yoink_native_reject_source_provisioning_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION
         "${NATIVE_SCHEMA}"."yoink_native_reject_source_provisioning_outbox"()`
    );
    try {
      await assert.rejects(
        applyProvisioning(signalSourceProvisioningA, provisioningPrincipalA),
        /native forced source-provisioning outbox failure/
      );
      assert.deepEqual(
        await provisioningSnapshot(provisioningPrincipalA.userId),
        provisioningBeforeA
      );
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_source_provisioning_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS
           "${NATIVE_SCHEMA}"."yoink_native_reject_source_provisioning_outbox"()`
      );
    }

    // First call for a fresh principal.
    const expectedIdsA = expectedSourceIds(provisioningPrincipalA.userId);
    const firstResult = await applyProvisioning(
      signalSourceProvisioningA,
      provisioningPrincipalA
    );
    assert.equal(firstResult.contractVersion, 1);
    assert.equal(firstResult.operation, "provision_source_connections");
    assert.equal(firstResult.outcome, "applied");
    assert.equal(firstResult.mutationApplied, true);
    assert.equal(firstResult.idempotentReplay, false);
    assert.equal(firstResult.mutationStatementCount, 5);
    assert.equal(firstResult.mutationRowCount, 5);
    assert.equal(firstResult.connectionsCreated, 3);
    assert.deepEqual(
      [...firstResult.createdSources].sort(),
      ["browser", "discord", "trackalacker"]
    );
    assert.equal(firstResult.trackalackerConnectionId, expectedIdsA.trackalacker);
    assert.equal(firstResult.browserConnectionId, expectedIdsA.browser);
    assert.equal(firstResult.discordConnectionId, expectedIdsA.discord);
    assert.equal(firstResult.trackalackerCreated, true);
    assert.equal(firstResult.browserCreated, true);
    assert.equal(firstResult.discordCreated, true);
    assert.equal(firstResult.auditMutated, true);
    assert.equal(firstResult.outboxMutated, true);
    assert.equal(firstResult.sourceWriterParity, true);
    assert.equal(firstResult.connectionProvisioningWriterParity, true);
    assert.equal(firstResult.mutationAuthority, true);
    assert.equal(firstResult.sharedCatalogMutationAuthority, false);
    assert.equal(firstResult.actionAuthority, false);
    assert.equal(firstResult.runtimeAuthority, false);

    const provisioningAfterFirst = await provisioningSnapshot(provisioningPrincipalA.userId);
    assert.equal(provisioningAfterFirst.connections, 3);
    assert.equal(provisioningAfterFirst.audits, 1);
    assert.equal(provisioningAfterFirst.outboxes, 1);

    const rowsAfterFirst = await provisionedRows(provisioningPrincipalA.userId);
    assert.equal(rowsAfterFirst.length, 3);
    const [browserRowA, discordRowA, trackalackerRowA] = rowsAfterFirst;
    assert.equal(browserRowA!.id, expectedIdsA.browser);
    assert.equal(browserRowA!.name, "Browser observations");
    assert.equal(browserRowA!.status, "disconnected");
    assert.equal(browserRowA!.trustLevel, "trusted_exact");
    assert.equal(browserRowA!.autoCreateMissions, 1);
    assert.equal(browserRowA!.isPrivate, 1);
    assert.equal(browserRowA!.lastEventAt, "");
    assert.equal(discordRowA!.id, expectedIdsA.discord);
    assert.equal(discordRowA!.name, "Discord");
    assert.equal(discordRowA!.status, "disconnected");
    assert.equal(discordRowA!.trustLevel, "informational");
    assert.equal(discordRowA!.autoCreateMissions, 0);
    assert.equal(discordRowA!.isPrivate, 1);
    assert.equal(trackalackerRowA!.id, expectedIdsA.trackalacker);
    assert.equal(trackalackerRowA!.name, "TrackaLacker");
    assert.equal(trackalackerRowA!.status, "disconnected");
    assert.equal(trackalackerRowA!.trustLevel, "trusted_exact");
    assert.equal(trackalackerRowA!.autoCreateMissions, 1);
    assert.equal(trackalackerRowA!.isPrivate, 1);

    const provisioningAudit = (await first.query<{
      reasonCode: string;
      message: string;
      data: Record<string, unknown>;
      outboxData: Record<string, unknown>;
    }>(
      `SELECT audit.reason_code AS "reasonCode", audit.message,
              audit.data_json::jsonb AS data,
              outbox.payload_json::jsonb->'data' AS "outboxData"
       FROM "${NATIVE_SCHEMA}"."audit_events" audit
       JOIN "${NATIVE_SCHEMA}"."outbox_events" outbox
         ON outbox.payload_json::jsonb->>'auditId' = audit.id
       WHERE audit.correlation_id = $1
         AND audit.event_type = 'source_connections_provisioned'`,
      [provisioningPrincipalA.userId]
    )).rows[0]!;
    assert.equal(provisioningAudit.reasonCode, "source_connections_provisioned");
    assert.equal(provisioningAudit.message, "Default source connections were provisioned.");
    assert.equal(provisioningAudit.data.operation, "provision_source_connections");
    const provisioningAuditResult = provisioningAudit.data.result as Record<string, unknown>;
    assert.equal(provisioningAuditResult.outcome, "applied");
    assert.equal(provisioningAuditResult.connectionsCreated, 3);
    assert.deepEqual(provisioningAudit.outboxData, provisioningAudit.data);

    // Second identical call: zero-write, no-audit-flood.
    const secondResult = await applyProvisioning(
      signalSourceProvisioningASecond,
      provisioningPrincipalA
    );
    assert.equal(secondResult.outcome, "already_applied");
    assert.equal(secondResult.mutationApplied, false);
    assert.equal(secondResult.idempotentReplay, true);
    assert.equal(secondResult.mutationStatementCount, 0);
    assert.equal(secondResult.mutationRowCount, 0);
    assert.equal(secondResult.connectionsCreated, 0);
    assert.deepEqual(secondResult.createdSources, []);
    assert.equal(secondResult.trackalackerCreated, false);
    assert.equal(secondResult.browserCreated, false);
    assert.equal(secondResult.discordCreated, false);
    assert.equal(secondResult.auditMutated, false);
    assert.equal(secondResult.outboxMutated, false);
    assert.equal(secondResult.requestFingerprint, firstResult.requestFingerprint);
    assert.equal(secondResult.trackalackerConnectionId, firstResult.trackalackerConnectionId);
    assert.equal(secondResult.browserConnectionId, firstResult.browserConnectionId);
    assert.equal(secondResult.discordConnectionId, firstResult.discordConnectionId);
    assert.deepEqual(
      await provisioningSnapshot(provisioningPrincipalA.userId),
      provisioningAfterFirst
    );

    // Legacy SQLite parity: the imported archive's local user already owns
    // the exact three default connections under the deterministic local ids
    // (source_trackalacker_local, source_browser_local, source_discord_local),
    // so provisioning is a true zero-write unchanged success against them.
    const legacyBeforeTotal = await totalConnectionsForUser(
      provisioningPrincipalB.tenantId,
      provisioningPrincipalB.userId
    );
    assert.ok(legacyBeforeTotal >= 3, "the imported local user carries its three default connections");
    const legacyResult = await applyProvisioning(
      signalSourceProvisioningB,
      provisioningPrincipalB
    );
    assert.equal(legacyResult.outcome, "unchanged");
    assert.equal(legacyResult.mutationApplied, false);
    assert.equal(legacyResult.connectionsCreated, 0);
    assert.equal(legacyResult.auditMutated, false);
    assert.equal(legacyResult.outboxMutated, false);
    assert.equal(legacyResult.trackalackerConnectionId, "source_trackalacker_local");
    assert.equal(legacyResult.browserConnectionId, "source_browser_local");
    assert.equal(legacyResult.discordConnectionId, "source_discord_local");
    assert.equal(
      await totalConnectionsForUser(
        provisioningPrincipalB.tenantId,
        provisioningPrincipalB.userId
      ),
      legacyBeforeTotal
    );

    // Concurrency race: two distinct backend sessions calling provision for
    // the SAME fresh principal near-simultaneously. PostgreSQL's own
    // insert-conflict serialization on the TrackaLacker anchor row (rather
    // than a fixed sleep) is the deterministic synchronization: whichever
    // session's anchor insert loses the race blocks until the winner
    // commits, then observes the winner's audit row and replays.
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [NATIVE_PRINCIPAL_C, NATIVE_TENANT, NATIVE_SAME_TENANT_USER,
        new Date(Date.now() - 5_000).toISOString()]
    );
    try {
      const racePrincipal = { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER };

      // Identity conflict fail-closed: a pre-existing browser connection under
      // a NON-deterministic id already occupies the (user_id, source, name)
      // identity the deterministic default would claim, so the whole
      // provisioning transaction fails on the unique identity index with zero
      // partial writes.
      const conflictSeedBeforeTotal = await totalConnectionsForUser(
        racePrincipal.tenantId,
        racePrincipal.userId
      );
      const conflictCreatedAt = new Date(Date.now() - 30_000).toISOString();
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."source_connections"(
           id, tenant_id, user_id, source, name, status, trust_level,
           auto_create_missions, is_private, last_event_at, created_at, updated_at
         ) VALUES (
           'native_source_provisioning_legacy_browser', $1, $2, 'browser',
           'Browser observations', 'disconnected', 'trusted_exact', 1, 1, '', $3, $3
         )`,
        [racePrincipal.tenantId, racePrincipal.userId, conflictCreatedAt]
      );
      const conflictBeforeSnapshot = await provisioningSnapshot(racePrincipal.userId);
      const conflictBeforeTotal = await totalConnectionsForUser(
        racePrincipal.tenantId,
        racePrincipal.userId
      );
      assert.equal(conflictBeforeSnapshot.connections, 0);
      assert.equal(conflictBeforeTotal, conflictSeedBeforeTotal + 1);
      await assert.rejects(
        applyProvisioning(signalSourceProvisioningC, racePrincipal),
        /duplicate key value violates unique constraint/
      );
      assert.deepEqual(
        await provisioningSnapshot(racePrincipal.userId),
        conflictBeforeSnapshot
      );
      assert.equal(
        await totalConnectionsForUser(racePrincipal.tenantId, racePrincipal.userId),
        conflictBeforeTotal
      );
      const conflictRows = await provisionedRows(racePrincipal.userId);
      assert.equal(conflictRows.length, 0);
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."source_connections"
         WHERE id = 'native_source_provisioning_legacy_browser'`
      );

      const raceBefore = await provisioningSnapshot(racePrincipal.userId);
      assert.equal(raceBefore.connections, 0);
      const [raceResultOne, raceResultTwo] = await Promise.all([
        applyProvisioning(signalSourceProvisioningC, racePrincipal),
        applyProvisioning(signalSourceProvisioningCSecond, racePrincipal)
      ]);
      const raceApplied = raceResultOne.outcome === "applied" ? raceResultOne : raceResultTwo;
      const raceOther = raceResultOne.outcome === "applied" ? raceResultTwo : raceResultOne;
      assert.equal(raceApplied.mutationApplied, true);
      assert.equal(raceApplied.connectionsCreated, 3);
      assert.deepEqual(
        [...raceApplied.createdSources].sort(),
        ["browser", "discord", "trackalacker"]
      );
      assert.equal(raceOther.mutationApplied, false);
      assert.equal(raceOther.connectionsCreated, 0);
      assert.ok(raceOther.outcome === "already_applied" || raceOther.outcome === "unchanged");
      assert.equal(raceApplied.trackalackerConnectionId, raceOther.trackalackerConnectionId);
      const raceAfter = await provisioningSnapshot(racePrincipal.userId);
      assert.equal(raceAfter.connections, 3);
      assert.equal(raceAfter.audits, 1);
      assert.equal(raceAfter.outboxes, 1);
      const raceRows = await provisionedRows(racePrincipal.userId);
      assert.equal(raceRows.length, 3);
    } finally {
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
         WHERE principal_role = $1`,
        [NATIVE_PRINCIPAL_C]
      );
    }

    // Immutable replay: the same request id, called again after unrelated
    // principals mutated their own state, returns the original result
    // unchanged and writes nothing further.
    const thirdResult = await applyProvisioning(
      signalSourceProvisioningA,
      provisioningPrincipalA
    );
    assert.equal(thirdResult.outcome, "already_applied");
    assert.equal(thirdResult.mutationApplied, false);
    assert.equal(thirdResult.idempotentReplay, true);
    assert.equal(thirdResult.requestId, firstResult.requestId);
    assert.equal(thirdResult.requestFingerprint, firstResult.requestFingerprint);
    assert.equal(thirdResult.trackalackerConnectionId, firstResult.trackalackerConnectionId);
    assert.equal(thirdResult.browserConnectionId, firstResult.browserConnectionId);
    assert.equal(thirdResult.discordConnectionId, firstResult.discordConnectionId);
    assert.deepEqual(
      await provisioningSnapshot(provisioningPrincipalA.userId),
      provisioningAfterFirst
    );

    await signalSourceProvisioningDirectClient.end();
    signalSourceProvisioningDirectClient = null;
    await Promise.all([
      signalSourceProvisioningA.close(),
      signalSourceProvisioningASecond.close(),
      signalSourceProvisioningB.close(),
      signalSourceProvisioningC.close(),
      signalSourceProvisioningCSecond.close(),
      signalSourceProvisioningUnmapped.close()
    ]);
    signalSourceProvisioningA = null;
    signalSourceProvisioningASecond = null;
    signalSourceProvisioningB = null;
    signalSourceProvisioningC = null;
    signalSourceProvisioningCSecond = null;
    signalSourceProvisioningUnmapped = null;
    })();

    await (async () => {
    const attributionPolicyDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalAttributionPolicyApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalAttributionPolicyManifest, { maxConnections });
    signalAttributionPolicyA = attributionPolicyDatabase(NATIVE_PRINCIPAL_A);
    signalAttributionPolicyASecond = attributionPolicyDatabase(NATIVE_PRINCIPAL_A);
    signalAttributionPolicyB = attributionPolicyDatabase(NATIVE_PRINCIPAL_B);
    signalAttributionPolicyC = attributionPolicyDatabase(NATIVE_PRINCIPAL_C);
    signalAttributionPolicyUnmapped = attributionPolicyDatabase(NATIVE_PRINCIPAL_UNMAPPED);

    const attributionPolicyPrincipalA = { tenantId: NATIVE_TENANT, userId: NATIVE_USER };
    const attributionPolicyPrincipalB = { tenantId: "tenant_local", userId: "user_local" };

    const attributionPolicyInputFor = (
      retailerId: string,
      overrides: Partial<AttributionPolicyUpdateInput> = {}
    ): AttributionPolicyUpdateInput => ({
      retailerId,
      enabled: false,
      provider: "canonical",
      publisherSlug: "",
      articleBaseUrl: "",
      associateTag: "",
      ...overrides
    });
    const attributionPolicyInputs = (
      overrides: Record<string, Partial<AttributionPolicyUpdateInput>> = {}
    ): AttributionPolicyUpdateInput[] => POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS
      .map((retailerId) => attributionPolicyInputFor(retailerId, overrides[retailerId]));
    const attributionPolicyBaselinePayload =
      normalizedPostgresSignalAttributionPolicyReplacePayload(attributionPolicyInputs());

    const applyAttributionPolicies = (
      database: NodePostgresSignalAttributionPolicyApplyDatabase,
      principalValue: { tenantId: string; userId: string },
      payload: PostgresSignalAttributionPolicyReplacePayload
    ) => database.replaceAttributionPolicies(
      principalValue,
      "replace_attribution_policies",
      buildPostgresSignalAttributionPolicyReplaceRequestId(principalValue, payload),
      payload
    );

    type AttributionPolicyRowSnapshot = {
      enabled: number;
      provider: string;
      publisherSlug: string;
      articleBaseUrl: string;
      associateTag: string;
      updatedAt: string;
    };
    const attributionPolicySnapshot = async (
      tenantId: string,
      userId: string
    ): Promise<Record<string, AttributionPolicyRowSnapshot>> => {
      const result = await first!.query<{
        retailerId: string; enabled: number; provider: string;
        publisherSlug: string; articleBaseUrl: string; associateTag: string; updatedAt: string;
      }>(
        `SELECT retailer_id AS "retailerId", (enabled)::int AS enabled, provider,
                publisher_slug AS "publisherSlug", article_base_url AS "articleBaseUrl",
                associate_tag AS "associateTag", updated_at AS "updatedAt"
         FROM "${NATIVE_SCHEMA}"."attribution_policies"
         WHERE tenant_id = $1 AND user_id = $2
         ORDER BY retailer_id`,
        [tenantId, userId]
      );
      const byRetailer: Record<string, AttributionPolicyRowSnapshot> = {};
      for (const row of result.rows) {
        byRetailer[row.retailerId] = {
          enabled: Number(row.enabled),
          provider: row.provider,
          publisherSlug: row.publisherSlug,
          articleBaseUrl: row.articleBaseUrl,
          associateTag: row.associateTag,
          updatedAt: row.updatedAt
        };
      }
      return byRetailer;
    };
    const attributionPolicyGraphCounts = async (
      tenantId: string,
      userId: string
    ): Promise<{ policies: number; audits: number; outboxes: number }> => {
      const row = (await first!.query<{
        policies: string | number | bigint;
        audits: string | number | bigint;
        outboxes: string | number | bigint;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."attribution_policies"
            WHERE tenant_id = $1 AND user_id = $2) AS policies,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
            WHERE tenant_id = $1 AND correlation_id = $2
              AND event_type = 'attribution_policies_replaced') AS audits,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
            WHERE tenant_id = $1 AND aggregate_type = 'attribution_policy_set'
              AND aggregate_id = $2) AS outboxes`,
        [tenantId, userId]
      )).rows[0]!;
      return {
        policies: Number(row.policies),
        audits: Number(row.audits),
        outboxes: Number(row.outboxes)
      };
    };

    // Missing-rows fail-closed: NATIVE_PRINCIPAL_A's tenant/user has not been
    // seeded with the 13 required attribution_policies rows yet -- creation
    // is provisioning's job, never this boundary's.
    const attributionPolicyCountsBeforeSeed = await attributionPolicyGraphCounts(
      attributionPolicyPrincipalA.tenantId,
      attributionPolicyPrincipalA.userId
    );
    assert.equal(attributionPolicyCountsBeforeSeed.policies, 0);
    assert.equal(attributionPolicyCountsBeforeSeed.audits, 0);
    assert.equal(attributionPolicyCountsBeforeSeed.outboxes, 0);
    await assert.rejects(
      applyAttributionPolicies(
        signalAttributionPolicyA,
        attributionPolicyPrincipalA,
        attributionPolicyBaselinePayload
      ),
      /rows are not fully provisioned/
    );
    assert.deepEqual(
      await attributionPolicyGraphCounts(
        attributionPolicyPrincipalA.tenantId,
        attributionPolicyPrincipalA.userId
      ),
      attributionPolicyCountsBeforeSeed
    );

    // Seed the exact 13-retailer set for NATIVE_PRINCIPAL_A's tenant/user
    // directly through the superuser connection, matching the schema's
    // defaults (enabled=0, provider='canonical') -- this boundary's function
    // never creates rows itself, only replaces an already-complete set.
    const attributionPolicySeedTimestamp = "2026-08-25T16:59:45.000Z";
    for (const retailerId of POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS) {
      await first.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."attribution_policies"(
           id, tenant_id, user_id, retailer_id, enabled, provider,
           publisher_slug, article_base_url, associate_tag, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 0, 'canonical', '', '', '', $5, $5)`,
        [
          `attribution_${retailerId}_native_a`,
          attributionPolicyPrincipalA.tenantId,
          attributionPolicyPrincipalA.userId,
          retailerId,
          attributionPolicySeedTimestamp
        ]
      );
    }
    const attributionPolicyAfterSeed = await attributionPolicySnapshot(
      attributionPolicyPrincipalA.tenantId,
      attributionPolicyPrincipalA.userId
    );
    assert.equal(Object.keys(attributionPolicyAfterSeed).length, 13);

    // Denial matrix: wrong principal.
    await assert.rejects(
      applyAttributionPolicies(
        signalAttributionPolicyB,
        attributionPolicyPrincipalA,
        attributionPolicyBaselinePayload
      ),
      /does not match the expected authenticated principal/
    );
    // Denial matrix: same-tenant peer.
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [NATIVE_PRINCIPAL_C, NATIVE_TENANT, NATIVE_SAME_TENANT_USER,
        new Date(Date.now() - 5_000).toISOString()]
    );
    try {
      await assert.rejects(
        applyAttributionPolicies(
          signalAttributionPolicyC,
          attributionPolicyPrincipalA,
          attributionPolicyBaselinePayload
        ),
        /does not match the expected authenticated principal/
      );
    } finally {
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
         WHERE principal_role = $1`,
        [NATIVE_PRINCIPAL_C]
      );
    }
    // Denial matrix: unmapped principal.
    await assert.rejects(
      applyAttributionPolicies(
        signalAttributionPolicyUnmapped,
        attributionPolicyPrincipalA,
        attributionPolicyBaselinePayload
      ),
      /tenant session principal is not active/
    );
    // Malformed request id: caught client-side before any round trip.
    await assert.rejects(
      signalAttributionPolicyA.replaceAttributionPolicies(
        attributionPolicyPrincipalA,
        "replace_attribution_policies",
        `attribution_policy_replace_${"f".repeat(32)}`,
        attributionPolicyBaselinePayload
      ),
      /apply request is invalid/
    );

    // Zero direct table SQL for the role, and cross-boundary denial in both
    // directions.
    signalAttributionPolicyDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalAttributionPolicyDirectClient.on("error", () => undefined);
    await signalAttributionPolicyDirectClient.connect();
    await signalAttributionPolicyDirectClient.query(
      `SET ROLE "${signalAttributionPolicyManifest.attributionPolicyRole.name}"`
    );
    await assert.rejects(
      signalAttributionPolicyDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."attribution_policies" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalAttributionPolicyDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."audit_events"(id)
         VALUES ('forbidden_attribution_policy_audit')`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalAttributionPolicyDirectClient.query(
        `UPDATE "${NATIVE_SCHEMA}"."outbox_events" SET delivered_at = ''`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalAttributionPolicyDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_FUNCTION}"(
           $1, $2, 'provision_source_connections', 'forbidden_cross_boundary', '{}'
         )`,
        [attributionPolicyPrincipalA.tenantId, attributionPolicyPrincipalA.userId]
      ),
      /permission denied/
    );
    // A sibling role (source-provisioning's) cannot call this boundary's
    // function either.
    await signalAttributionPolicyDirectClient.query(
      `SET ROLE "${signalSourceProvisioningManifest.sourceProvisioningRole.name}"`
    );
    await assert.rejects(
      signalAttributionPolicyDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION}"(
           $1, $2, 'replace_attribution_policies', 'forbidden_cross_boundary_reverse', '{}'
         )`,
        [attributionPolicyPrincipalA.tenantId, attributionPolicyPrincipalA.userId]
      ),
      /permission denied/
    );
    await signalAttributionPolicyDirectClient.query(
      `SET ROLE "${signalAttributionPolicyManifest.attributionPolicyRole.name}"`
    );

    // Atomicity: a forced outbox failure must leave zero partial writes.
    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_attribution_policy_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $failure$
       BEGIN
         IF NEW.aggregate_type = 'attribution_policy_set' THEN
           RAISE EXCEPTION 'native forced attribution-policy outbox failure';
         END IF;
         RETURN NEW;
       END
       $failure$;
       CREATE TRIGGER "yoink_native_reject_attribution_policy_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION
         "${NATIVE_SCHEMA}"."yoink_native_reject_attribution_policy_outbox"()`
    );
    const attributionPolicyChangedPayload = normalizedPostgresSignalAttributionPolicyReplacePayload(
      attributionPolicyInputs({
        target: { enabled: true },
        amazon: { associateTag: "race-native-amazon-tag" }
      })
    );
    try {
      await assert.rejects(
        applyAttributionPolicies(
          signalAttributionPolicyA,
          attributionPolicyPrincipalA,
          attributionPolicyChangedPayload
        ),
        /native forced attribution-policy outbox failure/
      );
      assert.deepEqual(
        await attributionPolicySnapshot(
          attributionPolicyPrincipalA.tenantId,
          attributionPolicyPrincipalA.userId
        ),
        attributionPolicyAfterSeed
      );
      assert.deepEqual(
        await attributionPolicyGraphCounts(
          attributionPolicyPrincipalA.tenantId,
          attributionPolicyPrincipalA.userId
        ),
        { policies: 13, audits: 0, outboxes: 0 }
      );
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_attribution_policy_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS
           "${NATIVE_SCHEMA}"."yoink_native_reject_attribution_policy_outbox"()`
      );
    }

    // First real replace: enable target (canonical, no extra fields needed)
    // and change amazon's associate tag -- a genuine two-retailer change.
    const attributionPolicyRequestIdFirst = buildPostgresSignalAttributionPolicyReplaceRequestId(
      attributionPolicyPrincipalA,
      attributionPolicyChangedPayload
    );
    const firstAttributionPolicyResult = await applyAttributionPolicies(
      signalAttributionPolicyA,
      attributionPolicyPrincipalA,
      attributionPolicyChangedPayload
    );
    assert.equal(firstAttributionPolicyResult.contractVersion, 1);
    assert.equal(firstAttributionPolicyResult.operation, "replace_attribution_policies");
    assert.equal(firstAttributionPolicyResult.requestId, attributionPolicyRequestIdFirst);
    assert.match(firstAttributionPolicyResult.requestFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(firstAttributionPolicyResult.outcome, "applied");
    assert.equal(firstAttributionPolicyResult.mutationApplied, true);
    assert.equal(firstAttributionPolicyResult.idempotentReplay, false);
    assert.equal(firstAttributionPolicyResult.mutationStatementCount, 3);
    assert.equal(firstAttributionPolicyResult.mutationRowCount, 4);
    assert.equal(firstAttributionPolicyResult.changedRetailerCount, 2);
    assert.deepEqual([...firstAttributionPolicyResult.changedRetailers].sort(), ["amazon", "target"]);
    assert.equal(firstAttributionPolicyResult.policiesMutated, true);
    assert.equal(firstAttributionPolicyResult.auditMutated, true);
    assert.equal(firstAttributionPolicyResult.outboxMutated, true);
    assert.equal(firstAttributionPolicyResult.policies.length, 13);
    const firstTargetPolicy =
      firstAttributionPolicyResult.policies.find((policy) => policy.retailerId === "target");
    assert.ok(firstTargetPolicy);
    assert.equal(firstTargetPolicy?.enabled, true);
    assert.equal(firstTargetPolicy?.provider, "canonical");
    const firstAmazonPolicy =
      firstAttributionPolicyResult.policies.find((policy) => policy.retailerId === "amazon");
    assert.ok(firstAmazonPolicy);
    assert.equal(firstAmazonPolicy?.associateTag, "race-native-amazon-tag");
    assert.equal(firstAttributionPolicyResult.supportedRetailerCount, 13);
    assert.equal(firstAttributionPolicyResult.attributionPolicyParity, true);
    assert.equal(firstAttributionPolicyResult.writerLockProtocolParity, false);
    assert.equal(firstAttributionPolicyResult.mutationAuthority, true);
    assert.equal(firstAttributionPolicyResult.sharedCatalogMutationAuthority, false);
    assert.equal(firstAttributionPolicyResult.actionAuthority, false);
    assert.equal(firstAttributionPolicyResult.runtimeAuthority, false);

    const attributionPolicyAfterFirst = await attributionPolicySnapshot(
      attributionPolicyPrincipalA.tenantId,
      attributionPolicyPrincipalA.userId
    );
    assert.equal(attributionPolicyAfterFirst.target?.enabled, 1);
    assert.equal(attributionPolicyAfterFirst.amazon?.associateTag, "race-native-amazon-tag");
    assert.notEqual(attributionPolicyAfterFirst.target?.updatedAt, attributionPolicySeedTimestamp);
    assert.notEqual(attributionPolicyAfterFirst.amazon?.updatedAt, attributionPolicySeedTimestamp);
    // Only the two changed rows were touched -- every other row's
    // database-owned updated_at is untouched.
    for (const retailerId of POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS) {
      if (retailerId === "target" || retailerId === "amazon") continue;
      assert.equal(
        attributionPolicyAfterFirst[retailerId]?.updatedAt,
        attributionPolicySeedTimestamp,
        `${retailerId} must be untouched`
      );
    }

    const attributionPolicyCountsAfterFirst = await attributionPolicyGraphCounts(
      attributionPolicyPrincipalA.tenantId,
      attributionPolicyPrincipalA.userId
    );
    assert.deepEqual(attributionPolicyCountsAfterFirst, { policies: 13, audits: 1, outboxes: 1 });

    const attributionPolicyAudit = (await first.query<{
      aggregateType: string;
      eventType: string;
      reasonCode: string;
      message: string;
      data: Record<string, unknown>;
      outboxData: Record<string, unknown>;
    }>(
      `SELECT outbox.aggregate_type AS "aggregateType",
              audit.event_type AS "eventType",
              audit.reason_code AS "reasonCode", audit.message,
              audit.data_json::jsonb AS data,
              outbox.payload_json::jsonb->'data' AS "outboxData"
       FROM "${NATIVE_SCHEMA}"."audit_events" audit
       JOIN "${NATIVE_SCHEMA}"."outbox_events" outbox
         ON outbox.payload_json::jsonb->>'auditId' = audit.id
       WHERE audit.correlation_id = $1
         AND audit.event_type = 'attribution_policies_replaced'`,
      [attributionPolicyPrincipalA.userId]
    )).rows[0]!;
    assert.equal(attributionPolicyAudit.aggregateType, "attribution_policy_set");
    assert.equal(attributionPolicyAudit.eventType, "attribution_policies_replaced");
    assert.equal(attributionPolicyAudit.reasonCode, "saved");
    assert.equal(
      attributionPolicyAudit.message,
      "Affiliate-routing policies were validated and saved for every supported retailer."
    );
    assert.equal(attributionPolicyAudit.data.operation, "replace_attribution_policies");
    assert.deepEqual(attributionPolicyAudit.outboxData, attributionPolicyAudit.data);

    // Identical replay of the now-current payload under a NEW request id:
    // the PL/pgSQL function only validates the id's *format*, not that it
    // matches the deterministic derivation, so a caller bypassing the
    // TypeScript layer can submit any correctly-shaped id -- this recomputes
    // zero changes and returns a true zero-write "unchanged" success (not a
    // replay of the earlier "applied" audit).
    const attributionPolicyFreshRequestId = `attribution_policy_replace_${"1".repeat(32)}`;
    const attributionPolicyIdenticalReplayRaw = await signalAttributionPolicyDirectClient.query<{
      resultJson: string;
    }>(
      `SELECT result_json AS "resultJson"
       FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION}"($1, $2, $3, $4, $5)`,
      [
        attributionPolicyPrincipalA.tenantId,
        attributionPolicyPrincipalA.userId,
        "replace_attribution_policies",
        attributionPolicyFreshRequestId,
        JSON.stringify(attributionPolicyChangedPayload)
      ]
    );
    const attributionPolicyIdenticalReplay = JSON.parse(
      attributionPolicyIdenticalReplayRaw.rows[0]!.resultJson
    ) as Record<string, unknown>;
    assert.equal(attributionPolicyIdenticalReplay.outcome, "unchanged");
    assert.equal(attributionPolicyIdenticalReplay.mutationApplied, false);
    assert.equal(attributionPolicyIdenticalReplay.idempotentReplay, false);
    assert.equal(attributionPolicyIdenticalReplay.mutationStatementCount, 0);
    assert.equal(attributionPolicyIdenticalReplay.mutationRowCount, 0);
    assert.equal(attributionPolicyIdenticalReplay.changedRetailerCount, 0);
    assert.equal(attributionPolicyIdenticalReplay.auditMutated, false);
    assert.equal(attributionPolicyIdenticalReplay.outboxMutated, false);
    assert.deepEqual(
      await attributionPolicyGraphCounts(
        attributionPolicyPrincipalA.tenantId,
        attributionPolicyPrincipalA.userId
      ),
      attributionPolicyCountsAfterFirst
    );

    // Same request id, altered payload: rejected via the server-computed
    // requestFingerprint check on replay, never silently returning a
    // mismatched cached result.
    const attributionPolicyAlteredPayload = normalizedPostgresSignalAttributionPolicyReplacePayload(
      attributionPolicyInputs({
        target: { enabled: true },
        amazon: { associateTag: "race-native-amazon-tag-altered" }
      })
    );
    await assert.rejects(
      signalAttributionPolicyDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION}"(
           $1, $2, $3, $4, $5
         )`,
        [
          attributionPolicyPrincipalA.tenantId,
          attributionPolicyPrincipalA.userId,
          "replace_attribution_policies",
          attributionPolicyRequestIdFirst,
          JSON.stringify(attributionPolicyAlteredPayload)
        ]
      ),
      /replay graph changed/
    );
    assert.deepEqual(
      await attributionPolicyGraphCounts(
        attributionPolicyPrincipalA.tenantId,
        attributionPolicyPrincipalA.userId
      ),
      attributionPolicyCountsAfterFirst
    );

    // Validation failures fail closed, even when submitted directly to the
    // security-definer function (bypassing the TypeScript-side normalizer
    // entirely) -- zero writes for each.
    const attributionPolicyRawPolicies = () => POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS.map(
      (retailerId) => ({
        retailerId,
        enabled: false,
        provider: "canonical",
        publisherSlug: "",
        articleBaseUrl: "",
        associateTag: ""
      })
    );
    const attributionPolicyRawPayload = (
      mutate: (policies: ReturnType<typeof attributionPolicyRawPolicies>) => void
    ) => {
      const policies = attributionPolicyRawPolicies();
      mutate(policies);
      return {
        policies,
        confirmation: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONFIRMATION
      };
    };
    const attributionPolicyValidationCounts = await attributionPolicyGraphCounts(
      attributionPolicyPrincipalA.tenantId,
      attributionPolicyPrincipalA.userId
    );

    const invalidHowlPayload = attributionPolicyRawPayload((policies) => {
      const target = policies.find((policy) => policy.retailerId === "target")!;
      target.enabled = true;
      target.provider = "howl";
    });
    await assert.rejects(
      signalAttributionPolicyDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION}"(
           $1, $2, $3, $4, $5
         )`,
        [
          attributionPolicyPrincipalA.tenantId,
          attributionPolicyPrincipalA.userId,
          "replace_attribution_policies",
          `attribution_policy_replace_${"2".repeat(32)}`,
          JSON.stringify(invalidHowlPayload)
        ]
      ),
      /enabled policy fails validity/
    );

    const invalidAmazonAssociatesPayload = attributionPolicyRawPayload((policies) => {
      const walmart = policies.find((policy) => policy.retailerId === "walmart")!;
      walmart.enabled = true;
      walmart.provider = "amazon_associates";
      walmart.associateTag = "validtag123";
    });
    await assert.rejects(
      signalAttributionPolicyDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION}"(
           $1, $2, $3, $4, $5
         )`,
        [
          attributionPolicyPrincipalA.tenantId,
          attributionPolicyPrincipalA.userId,
          "replace_attribution_policies",
          `attribution_policy_replace_${"3".repeat(32)}`,
          JSON.stringify(invalidAmazonAssociatesPayload)
        ]
      ),
      /enabled policy fails validity/
    );

    const shiftedRetailerPayload = attributionPolicyRawPayload((policies) => {
      // Duplicate the first entry ('amazon') into the second slot
      // ('bestbuy'), breaking the fixed positional order every entry must
      // satisfy and dropping 'bestbuy' from the set -- the same failure a
      // duplicated-and-missing retailer pair triggers.
      policies[1] = { ...policies[0]! };
    });
    await assert.rejects(
      signalAttributionPolicyDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION}"(
           $1, $2, $3, $4, $5
         )`,
        [
          attributionPolicyPrincipalA.tenantId,
          attributionPolicyPrincipalA.userId,
          "replace_attribution_policies",
          `attribution_policy_replace_${"4".repeat(32)}`,
          JSON.stringify(shiftedRetailerPayload)
        ]
      ),
      /entry shape is invalid/
    );

    assert.deepEqual(
      await attributionPolicyGraphCounts(
        attributionPolicyPrincipalA.tenantId,
        attributionPolicyPrincipalA.userId
      ),
      attributionPolicyValidationCounts
    );

    // Concurrent replace: two sessions for the SAME principal submit
    // different complete-set payloads near-simultaneously, differing only in
    // 'macys' (both otherwise restate the current target/amazon state
    // established above). The row-level `FOR UPDATE ORDER BY retailer_id`
    // lock (not a fixed sleep) is the deterministic synchronization --
    // whichever session's transaction acquires the locks second blocks until
    // the first commits, then re-reads the now-current state and applies its
    // own full target state on top, so the final row exactly matches
    // whichever payload committed last, and both calls genuinely mutate (one
    // audit each).
    const attributionPolicyRaceOnePayload = normalizedPostgresSignalAttributionPolicyReplacePayload(
      attributionPolicyInputs({
        target: { enabled: true },
        amazon: { associateTag: "race-native-amazon-tag" },
        macys: { publisherSlug: "race-marker-one" }
      })
    );
    const attributionPolicyRaceTwoPayload = normalizedPostgresSignalAttributionPolicyReplacePayload(
      attributionPolicyInputs({
        target: { enabled: true },
        amazon: { associateTag: "race-native-amazon-tag" },
        macys: { publisherSlug: "race-marker-two" }
      })
    );
    const [attributionPolicyRaceOneResult, attributionPolicyRaceTwoResult] = await Promise.all([
      applyAttributionPolicies(
        signalAttributionPolicyA,
        attributionPolicyPrincipalA,
        attributionPolicyRaceOnePayload
      ),
      applyAttributionPolicies(
        signalAttributionPolicyASecond,
        attributionPolicyPrincipalA,
        attributionPolicyRaceTwoPayload
      )
    ]);
    assert.equal(attributionPolicyRaceOneResult.outcome, "applied");
    assert.equal(attributionPolicyRaceTwoResult.outcome, "applied");
    assert.equal(attributionPolicyRaceOneResult.changedRetailerCount, 1);
    assert.equal(attributionPolicyRaceTwoResult.changedRetailerCount, 1);
    assert.deepEqual(attributionPolicyRaceOneResult.changedRetailers, ["macys"]);
    assert.deepEqual(attributionPolicyRaceTwoResult.changedRetailers, ["macys"]);
    const attributionPolicyAfterRace = await attributionPolicySnapshot(
      attributionPolicyPrincipalA.tenantId,
      attributionPolicyPrincipalA.userId
    );
    assert.ok(
      attributionPolicyAfterRace.macys?.publisherSlug === "race-marker-one"
        || attributionPolicyAfterRace.macys?.publisherSlug === "race-marker-two",
      "the final macys row must equal exactly one of the two race payloads"
    );
    const attributionPolicyCountsAfterRace = await attributionPolicyGraphCounts(
      attributionPolicyPrincipalA.tenantId,
      attributionPolicyPrincipalA.userId
    );
    assert.equal(
      attributionPolicyCountsAfterRace.audits,
      attributionPolicyCountsAfterFirst.audits + 2
    );
    assert.equal(
      attributionPolicyCountsAfterRace.outboxes,
      attributionPolicyCountsAfterFirst.outboxes + 2
    );

    // Legacy SQLite parity: the imported archive's local user (tenant_local/
    // user_local) already carries all 13 default attribution_policies rows
    // from YoinkDatabase's local-user bootstrap seed (see
    // packages/database/src/database.ts's `attributionPolicies` list), so
    // resubmitting that exact same set is a true zero-write "unchanged"
    // success against it too -- proving missingRowFailsClosed only fires
    // when rows are genuinely missing.
    const legacyAttributionPolicyPayload = normalizedPostgresSignalAttributionPolicyReplacePayload(
      attributionPolicyInputs({
        target: { provider: "howl", publisherSlug: "collectwithdodo" },
        walmart: { provider: "howl", publisherSlug: "collectwithdodo" },
        bestbuy: { provider: "howl", publisherSlug: "collectwithdodo" },
        amazon: { provider: "amazon_associates", associateTag: "pokemon-restocks-20" }
      })
    );
    const legacyAttributionPolicyCountsBefore = await attributionPolicyGraphCounts(
      attributionPolicyPrincipalB.tenantId,
      attributionPolicyPrincipalB.userId
    );
    assert.equal(legacyAttributionPolicyCountsBefore.policies, 13);
    const legacyAttributionPolicyResult = await applyAttributionPolicies(
      signalAttributionPolicyB,
      attributionPolicyPrincipalB,
      legacyAttributionPolicyPayload
    );
    assert.equal(legacyAttributionPolicyResult.outcome, "unchanged");
    assert.equal(legacyAttributionPolicyResult.mutationApplied, false);
    assert.equal(legacyAttributionPolicyResult.changedRetailerCount, 0);
    assert.deepEqual(
      await attributionPolicyGraphCounts(
        attributionPolicyPrincipalB.tenantId,
        attributionPolicyPrincipalB.userId
      ),
      legacyAttributionPolicyCountsBefore
    );

    // Immutable replay: the same request id, called again after unrelated
    // concurrency and validation activity, must return the original
    // "applied" audit's result unchanged and write nothing further.
    const attributionPolicyImmutableReplay = await applyAttributionPolicies(
      signalAttributionPolicyASecond,
      attributionPolicyPrincipalA,
      attributionPolicyChangedPayload
    );
    assert.equal(attributionPolicyImmutableReplay.outcome, "already_applied");
    assert.equal(attributionPolicyImmutableReplay.mutationApplied, false);
    assert.equal(attributionPolicyImmutableReplay.idempotentReplay, true);
    assert.equal(attributionPolicyImmutableReplay.mutationStatementCount, 0);
    assert.equal(attributionPolicyImmutableReplay.mutationRowCount, 0);
    assert.equal(attributionPolicyImmutableReplay.requestId, attributionPolicyRequestIdFirst);
    assert.equal(
      attributionPolicyImmutableReplay.requestFingerprint,
      firstAttributionPolicyResult.requestFingerprint
    );
    assert.deepEqual(attributionPolicyImmutableReplay.policies, firstAttributionPolicyResult.policies);

    await signalAttributionPolicyDirectClient.end();
    signalAttributionPolicyDirectClient = null;
    await Promise.all([
      signalAttributionPolicyA.close(),
      signalAttributionPolicyASecond.close(),
      signalAttributionPolicyB.close(),
      signalAttributionPolicyC.close(),
      signalAttributionPolicyUnmapped.close()
    ]);
    signalAttributionPolicyA = null;
    signalAttributionPolicyASecond = null;
    signalAttributionPolicyB = null;
    signalAttributionPolicyC = null;
    signalAttributionPolicyUnmapped = null;
    })();

    await (async () => {
    const reservationLifecycleDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalReservationLifecycleApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalReservationLifecycleManifest, { maxConnections });
    signalReservationLifecycleA = reservationLifecycleDatabase(NATIVE_PRINCIPAL_A, 2);
    signalReservationLifecycleASecond = reservationLifecycleDatabase(NATIVE_PRINCIPAL_A);
    signalReservationLifecycleB = reservationLifecycleDatabase(NATIVE_PRINCIPAL_B);
    signalReservationLifecycleC = reservationLifecycleDatabase(NATIVE_PRINCIPAL_C);
    signalReservationLifecycleUnmapped = reservationLifecycleDatabase(
      NATIVE_PRINCIPAL_UNMAPPED
    );

    const reservationLifecycleNow = Date.now();
    const reservationLifecycleCreatedAt = new Date(
      reservationLifecycleNow - 5_000
    ).toISOString();
    const baseReservationId = actionSpendWinner.spendReservationId;
    const createReservationLifecycleFixture = async (input: {
      suffix: string;
      action: "add_to_cart" | "prepare_checkout" | "submit_order";
      state: string;
      expiresAt: string;
      reservedAmountCents?: number;
    }): Promise<{ actionJobId: string; reservationId: string }> => {
      const actionJobId = `native_reservation_${input.suffix}_job`;
      const reservationId = `native_reservation_${input.suffix}`;
      const reservedAmountCents = input.reservedAmountCents ?? 4_343;
      await first!.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."action_jobs"(
           id, tenant_id, user_id, mission_id, mission_target_id, incident_id,
           state, action, quantity, max_unit_price_cents, max_order_total_cents,
           currency, seller_policy, fulfillment, expected_seller, listing_id,
           canonical_url, idempotency_key, capability_nonce_hash, expires_at,
           leased_at, lease_expires_at, intent_revision_id, exact_offer_key_id,
           offer_snapshot_id, created_at, updated_at
         )
         SELECT $1, tenant_id, user_id, mission_id, mission_target_id, incident_id,
                $2, $3, quantity, max_unit_price_cents, $4, currency,
                seller_policy, fulfillment, expected_seller, listing_id,
                canonical_url, $5, capability_nonce_hash, $6, '', '',
                intent_revision_id, exact_offer_key_id, offer_snapshot_id, $7, $7
         FROM "${NATIVE_SCHEMA}"."action_jobs" WHERE id = $8`,
        [
          actionJobId,
          input.state,
          input.action,
          reservedAmountCents,
          `reservation-lifecycle-job:${input.suffix}`,
          input.expiresAt,
          reservationLifecycleCreatedAt,
          actionSpendWinner.actionJobId
        ]
      );
      await first!.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."spend_reservations"(
           id, tenant_id, user_id, mission_id, intent_revision_id,
           exact_offer_key_id, offer_snapshot_id, action_job_id, idempotency_key,
           action, quantity, reserved_amount_cents, committed_amount_cents,
           currency, status, release_reason, expires_at, created_at, updated_at
         )
         SELECT $1, tenant_id, user_id, mission_id, intent_revision_id,
                exact_offer_key_id, offer_snapshot_id, $2, $3, $4, quantity,
                $5, 0, currency, 'active', '', $6, $7, $7
         FROM "${NATIVE_SCHEMA}"."spend_reservations" WHERE id = $8`,
        [
          reservationId,
          actionJobId,
          `reservation-lifecycle-spend:${input.suffix}`,
          input.action,
          reservedAmountCents,
          input.expiresAt,
          reservationLifecycleCreatedAt,
          baseReservationId
        ]
      );
      await first!.query(
        `UPDATE "${NATIVE_SCHEMA}"."action_jobs"
         SET spend_reservation_id = $1 WHERE id = $2`,
        [reservationId, actionJobId]
      );
      await first!.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."spend_ledger_entries"(
           id, tenant_id, user_id, reservation_id, action_job_id, entry_type,
           reserved_delta_cents, spent_delta_cents, quantity_delta, currency,
           reason_code, correlation_id, metadata_json, created_at
         )
         SELECT $1, tenant_id, user_id, $2, $3, 'reserved', $4, 0, quantity,
                currency, 'action_job_reserved', $3, '{}', $5
         FROM "${NATIVE_SCHEMA}"."spend_reservations" WHERE id = $2`,
        [
          `native_reservation_${input.suffix}_reserved`,
          reservationId,
          actionJobId,
          reservedAmountCents,
          reservationLifecycleCreatedAt
        ]
      );
      return { actionJobId, reservationId };
    };
    const releaseFixture = await createReservationLifecycleFixture({
      suffix: "release",
      action: "add_to_cart",
      state: "confirmed",
      expiresAt: new Date(reservationLifecycleNow + 300_000).toISOString()
    });
    const prepareReleaseFixture = await createReservationLifecycleFixture({
      suffix: "prepare_release",
      action: "prepare_checkout",
      state: "confirmed",
      expiresAt: new Date(reservationLifecycleNow + 300_000).toISOString()
    });
    const cancelledReleaseFixture = await createReservationLifecycleFixture({
      suffix: "cancelled_release",
      action: "add_to_cart",
      state: "cancelled",
      expiresAt: new Date(reservationLifecycleNow + 300_000).toISOString()
    });
    const expiredReleaseFixture = await createReservationLifecycleFixture({
      suffix: "expired_release",
      action: "add_to_cart",
      state: "expired",
      expiresAt: new Date(reservationLifecycleNow + 300_000).toISOString()
    });
    const rejectedReleaseFixture = await createReservationLifecycleFixture({
      suffix: "rejected_release",
      action: "add_to_cart",
      state: "offer_rejected",
      expiresAt: new Date(reservationLifecycleNow + 300_000).toISOString()
    });
    const commitFixture = await createReservationLifecycleFixture({
      suffix: "commit",
      action: "submit_order",
      state: "confirmed",
      expiresAt: new Date(reservationLifecycleNow + 300_000).toISOString()
    });
    const expiryFixture = await createReservationLifecycleFixture({
      suffix: "expiry",
      action: "add_to_cart",
      state: "awaiting_executor",
      expiresAt: new Date(reservationLifecycleNow - 1_000).toISOString()
    });
    const futureExpiryFixture = await createReservationLifecycleFixture({
      suffix: "future_expiry",
      action: "add_to_cart",
      state: "awaiting_executor",
      expiresAt: new Date(reservationLifecycleNow + 300_000).toISOString()
    });
    const possibleMutationExpiryFixture = await createReservationLifecycleFixture({
      suffix: "possible_mutation_expiry",
      action: "submit_order",
      state: "confirmed",
      expiresAt: new Date(reservationLifecycleNow - 1_000).toISOString()
    });
    const alreadyReleasedFixture = await createReservationLifecycleFixture({
      suffix: "already_released",
      action: "add_to_cart",
      state: "cancelled",
      expiresAt: new Date(reservationLifecycleNow + 300_000).toISOString()
    });
    const alreadyCommittedFixture = await createReservationLifecycleFixture({
      suffix: "already_committed",
      action: "submit_order",
      state: "confirmed",
      expiresAt: new Date(reservationLifecycleNow + 300_000).toISOString()
    });
    const reservationLifecyclePrincipal = {
      tenantId: NATIVE_TENANT,
      userId: NATIVE_USER
    };
    const applyReservationLifecycle = (
      database: NodePostgresSignalReservationLifecycleApplyDatabase,
      operation: PostgresSignalReservationLifecycleOperation,
      payload: PostgresSignalReservationLifecyclePayload
    ) => database.applyReservationLifecycle(
      reservationLifecyclePrincipal,
      operation,
      buildPostgresSignalReservationLifecycleRequestId(
        reservationLifecyclePrincipal,
        operation,
        payload
      ),
      payload
    );
    const releasePayload = {
      ...releaseFixture,
      releaseReason: "add_to_cart_confirmed_without_order" as const,
      confirmation: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION
    } as const;
    await assert.rejects(
      signalReservationLifecycleB.applyReservationLifecycle(
        reservationLifecyclePrincipal,
        "release_spend_reservation",
        buildPostgresSignalReservationLifecycleRequestId(
          reservationLifecyclePrincipal,
          "release_spend_reservation",
          releasePayload
        ),
        releasePayload
      ),
      /does not match the expected authenticated principal/
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [
        NATIVE_PRINCIPAL_C,
        NATIVE_TENANT,
        NATIVE_SAME_TENANT_USER,
        reservationLifecycleCreatedAt
      ]
    );
    try {
      await assert.rejects(
        signalReservationLifecycleC.applyReservationLifecycle(
          reservationLifecyclePrincipal,
          "release_spend_reservation",
          buildPostgresSignalReservationLifecycleRequestId(
            reservationLifecyclePrincipal,
            "release_spend_reservation",
            releasePayload
          ),
          releasePayload
        ),
        /does not match the expected authenticated principal/
      );
    } finally {
      await first.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
         WHERE principal_role = $1`,
        [NATIVE_PRINCIPAL_C]
      );
    }
    await assert.rejects(
      signalReservationLifecycleUnmapped.applyReservationLifecycle(
        reservationLifecyclePrincipal,
        "release_spend_reservation",
        buildPostgresSignalReservationLifecycleRequestId(
          reservationLifecyclePrincipal,
          "release_spend_reservation",
          releasePayload
        ),
        releasePayload
      ),
      /tenant session principal is not active/
    );
    await assert.rejects(
      signalReservationLifecycleA.applyReservationLifecycle(
        reservationLifecyclePrincipal,
        "release_spend_reservation",
        `reservation_lifecycle_${"f".repeat(32)}`,
        releasePayload
      ),
      /apply request is invalid/
    );
    const wrongConfirmationPayload = {
      ...releasePayload,
      confirmation: "APPLY_SPEND_RESERVATION_LIFECYCLE_V0"
    } as unknown as PostgresSignalReservationLifecyclePayload;
    await assert.rejects(
      applyReservationLifecycle(
        signalReservationLifecycleA,
        "release_spend_reservation",
        wrongConfirmationPayload
      ),
      /payload shape is invalid/
    );
    await assert.rejects(
      applyReservationLifecycle(
        signalReservationLifecycleA,
        "release_spend_reservation",
        {
          ...releasePayload,
          reservationId: commitFixture.reservationId
        }
      ),
      /ownership is invalid/
    );

    signalReservationLifecycleDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalReservationLifecycleDirectClient.on("error", () => undefined);
    await signalReservationLifecycleDirectClient.connect();
    await signalReservationLifecycleDirectClient.query(
      `SET ROLE "${signalReservationLifecycleManifest.reservationLifecycleRole.name}"`
    );
    await assert.rejects(
      signalReservationLifecycleDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."spend_reservations" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalReservationLifecycleDirectClient.query(
        `UPDATE "${NATIVE_SCHEMA}"."action_jobs" SET state = 'confirmed'`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalReservationLifecycleDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_SOURCE_SYNC_APPLY_FUNCTION}"(
           $1, $2, 'start_source_sync', 'source_sync_${"a".repeat(32)}', '{}'
         )`,
        [NATIVE_TENANT, NATIVE_USER]
      ),
      /permission denied/
    );
    await assert.rejects(
      signalReservationLifecycleDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_FUNCTION}"(
           $1, 'user_local', 'release_spend_reservation', $2, $3
         )`,
        [
          NATIVE_TENANT,
          buildPostgresSignalReservationLifecycleRequestId(
            reservationLifecyclePrincipal,
            "release_spend_reservation",
            releasePayload
          ),
          JSON.stringify(releasePayload)
        ]
      ),
      /does not match the expected authenticated principal/
    );
    await signalReservationLifecycleDirectClient.end();
    signalReservationLifecycleDirectClient = null;

    const reservationLifecycleSnapshot = async (fixture: {
      actionJobId: string;
      reservationId: string;
    }) => {
      const row = (await first!.query<{
        jobState: string;
        jobAction: string;
        reservationStatus: string;
        releaseReason: string;
        committedAmountCents: string | number | bigint;
        ledgerCount: string | number | bigint;
        actionEventCount: string | number | bigint;
        auditCount: string | number | bigint;
        outboxCount: string | number | bigint;
        fulfilledQuantity: string | number | bigint;
      }>(
        `SELECT job.state AS "jobState", job.action AS "jobAction",
                reservation.status AS "reservationStatus",
                reservation.release_reason AS "releaseReason",
                reservation.committed_amount_cents AS "committedAmountCents",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."spend_ledger_entries" ledger
                 WHERE ledger.reservation_id = reservation.id) AS "ledgerCount",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."action_events" event
                 WHERE event.job_id = job.id) AS "actionEventCount",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events" audit
                 WHERE audit.correlation_id = job.id
                   AND audit.event_type IN (
                     'spend_reservation_released', 'spend_committed'
                   )) AS "auditCount",
                (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events" outbox
                 WHERE outbox.aggregate_type = 'spend_reservation'
                   AND outbox.aggregate_id = reservation.id) AS "outboxCount",
                mission.fulfilled_quantity AS "fulfilledQuantity"
         FROM "${NATIVE_SCHEMA}"."action_jobs" job
         JOIN "${NATIVE_SCHEMA}"."spend_reservations" reservation
           ON reservation.id = job.spend_reservation_id
         JOIN "${NATIVE_SCHEMA}"."missions" mission ON mission.id = job.mission_id
         WHERE job.id = $1 AND reservation.id = $2`,
        [fixture.actionJobId, fixture.reservationId]
      )).rows[0]!;
      return {
        ...row,
        committedAmountCents: Number(row.committedAmountCents),
        ledgerCount: Number(row.ledgerCount),
        actionEventCount: Number(row.actionEventCount),
        auditCount: Number(row.auditCount),
        outboxCount: Number(row.outboxCount),
        fulfilledQuantity: Number(row.fulfilledQuantity)
      };
    };
    const releaseBefore = await reservationLifecycleSnapshot(releaseFixture);
    const releaseResult = await applyReservationLifecycle(
      signalReservationLifecycleA,
      "release_spend_reservation",
      releasePayload
    );
    assert.equal(releaseResult.outcome, "applied");
    assert.equal(releaseResult.mutationApplied, true);
    assert.equal(releaseResult.idempotentReplay, false);
    assert.equal(releaseResult.mutationStatementCount, 4);
    assert.equal(releaseResult.mutationRowCount, 4);
    assert.equal(releaseResult.reservationMutated, true);
    assert.equal(releaseResult.ledgerMutated, true);
    assert.equal(releaseResult.auditMutated, true);
    assert.equal(releaseResult.outboxMutated, true);
    assert.equal(releaseResult.reservation.status, "released");
    assert.equal(releaseResult.reservation.releaseReason, releasePayload.releaseReason);
    assert.equal(releaseResult.ledger?.entryType, "released");
    assert.equal(releaseResult.ledger?.reservedDeltaCents, -4_343);
    const releaseAfter = await reservationLifecycleSnapshot(releaseFixture);
    assert.deepEqual(releaseAfter, {
      ...releaseBefore,
      reservationStatus: "released",
      releaseReason: releasePayload.releaseReason,
      ledgerCount: releaseBefore.ledgerCount + 1,
      auditCount: releaseBefore.auditCount + 1,
      outboxCount: releaseBefore.outboxCount + 1
    });
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."outbox_events"
       SET delivery_state = 'delivered', delivery_attempts = 1,
           delivered_at = $2, updated_at = $2
       WHERE aggregate_type = 'spend_reservation' AND aggregate_id = $1`,
      [releaseFixture.reservationId, new Date(reservationLifecycleNow + 1_000).toISOString()]
    );
    const releaseReplay = await applyReservationLifecycle(
      signalReservationLifecycleASecond,
      "release_spend_reservation",
      releasePayload
    );
    assert.equal(releaseReplay.outcome, "already_applied");
    assert.equal(releaseReplay.mutationApplied, false);
    assert.equal(releaseReplay.idempotentReplay, true);
    assert.equal(releaseReplay.mutationStatementCount, 0);
    assert.deepEqual(await reservationLifecycleSnapshot(releaseFixture), releaseAfter);

    for (const terminalCase of [
      {
        fixture: prepareReleaseFixture,
        releaseReason: "prepare_checkout_confirmed_without_order" as const
      },
      {
        fixture: cancelledReleaseFixture,
        releaseReason: "cancelled" as const
      },
      {
        fixture: expiredReleaseFixture,
        releaseReason: "expired" as const
      },
      {
        fixture: rejectedReleaseFixture,
        releaseReason: "offer_rejected" as const
      }
    ]) {
      const before = await reservationLifecycleSnapshot(terminalCase.fixture);
      const result = await applyReservationLifecycle(
        signalReservationLifecycleA,
        "release_spend_reservation",
        {
          ...terminalCase.fixture,
          releaseReason: terminalCase.releaseReason,
          confirmation: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION
        }
      );
      assert.equal(result.outcome, "applied");
      assert.equal(result.reservation.status, "released");
      assert.equal(result.reservation.releaseReason, terminalCase.releaseReason);
      assert.deepEqual(await reservationLifecycleSnapshot(terminalCase.fixture), {
        ...before,
        reservationStatus: "released",
        releaseReason: terminalCase.releaseReason,
        ledgerCount: before.ledgerCount + 1,
        auditCount: before.auditCount + 1,
        outboxCount: before.outboxCount + 1
      });
    }

    const futureExpiryBefore = await reservationLifecycleSnapshot(
      futureExpiryFixture
    );
    await assert.rejects(
      applyReservationLifecycle(
        signalReservationLifecycleA,
        "release_spend_reservation",
        {
          ...futureExpiryFixture,
          releaseReason: "reservation_expired",
          confirmation: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION
        }
      ),
      /not bound to the current terminal action state/
    );
    assert.deepEqual(
      await reservationLifecycleSnapshot(futureExpiryFixture),
      futureExpiryBefore
    );
    const possibleMutationExpiryBefore = await reservationLifecycleSnapshot(
      possibleMutationExpiryFixture
    );
    await assert.rejects(
      applyReservationLifecycle(
        signalReservationLifecycleA,
        "release_spend_reservation",
        {
          ...possibleMutationExpiryFixture,
          releaseReason: "reservation_expired",
          confirmation: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION
        }
      ),
      /not bound to the current terminal action state/
    );
    assert.deepEqual(
      await reservationLifecycleSnapshot(possibleMutationExpiryFixture),
      possibleMutationExpiryBefore
    );

    const expiryWrongStatePayload = {
      ...expiryFixture,
      releaseReason: "cancelled" as const,
      confirmation: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION
    } as const;
    await assert.rejects(
      applyReservationLifecycle(
        signalReservationLifecycleA,
        "release_spend_reservation",
        expiryWrongStatePayload
      ),
      /not bound to the current terminal action state/
    );
    const expiryPayload = {
      ...expiryFixture,
      releaseReason: "reservation_expired" as const,
      confirmation: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION
    } as const;
    const expiryResult = await applyReservationLifecycle(
      signalReservationLifecycleA,
      "release_spend_reservation",
      expiryPayload
    );
    assert.equal(expiryResult.outcome, "applied");
    assert.equal(expiryResult.reservation.status, "released");
    assert.equal(expiryResult.reservation.releaseReason, "reservation_expired");
    await assert.rejects(
      applyReservationLifecycle(
        signalReservationLifecycleA,
        "release_spend_reservation",
        { ...expiryPayload, releaseReason: "expired" }
      ),
      /release reason conflicts with the terminal reservation/
    );

    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."spend_reservations"
       SET status = 'released', release_reason = 'cancelled', updated_at = $2
       WHERE id = $1`,
      [
        alreadyReleasedFixture.reservationId,
        new Date(reservationLifecycleNow + 2).toISOString()
      ]
    );
    const alreadyReleasedBefore = await reservationLifecycleSnapshot(
      alreadyReleasedFixture
    );
    const alreadyReleasedResult = await applyReservationLifecycle(
      signalReservationLifecycleA,
      "release_spend_reservation",
      {
        ...alreadyReleasedFixture,
        releaseReason: "cancelled",
        confirmation: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION
      }
    );
    assert.equal(alreadyReleasedResult.outcome, "already_current");
    assert.equal(alreadyReleasedResult.mutationApplied, false);
    assert.equal(alreadyReleasedResult.ledger, null);
    assert.deepEqual(
      await reservationLifecycleSnapshot(alreadyReleasedFixture),
      alreadyReleasedBefore
    );

    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."spend_reservations"
       SET status = 'committed', committed_amount_cents = 4000, updated_at = $2
       WHERE id = $1`,
      [
        alreadyCommittedFixture.reservationId,
        new Date(reservationLifecycleNow + 3).toISOString()
      ]
    );
    const alreadyCommittedBefore = await reservationLifecycleSnapshot(
      alreadyCommittedFixture
    );
    const alreadyCommittedResult = await applyReservationLifecycle(
      signalReservationLifecycleA,
      "commit_spend_reservation",
      {
        ...alreadyCommittedFixture,
        actualAmountCents: 4_000,
        confirmation: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION
      }
    );
    assert.equal(alreadyCommittedResult.outcome, "already_current");
    assert.equal(alreadyCommittedResult.mutationApplied, false);
    assert.equal(alreadyCommittedResult.ledger, null);
    assert.deepEqual(
      await reservationLifecycleSnapshot(alreadyCommittedFixture),
      alreadyCommittedBefore
    );
    await assert.rejects(
      applyReservationLifecycle(
        signalReservationLifecycleA,
        "commit_spend_reservation",
        {
          ...alreadyCommittedFixture,
          actualAmountCents: 4_001,
          confirmation: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION
        }
      ),
      /committed total conflicts with the terminal reservation/
    );
    assert.deepEqual(
      await reservationLifecycleSnapshot(alreadyCommittedFixture),
      alreadyCommittedBefore
    );

    const commitPayload = {
      ...commitFixture,
      actualAmountCents: 4_000,
      confirmation: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONFIRMATION
    } as const;
    const commitBeforeValidation = await reservationLifecycleSnapshot(commitFixture);
    await assert.rejects(
      applyReservationLifecycle(
        signalReservationLifecycleA,
        "commit_spend_reservation",
        { ...commitPayload, actualAmountCents: 4_400 }
      ),
      /not bound to an active verified submit-order result/
    );
    assert.deepEqual(
      await reservationLifecycleSnapshot(commitFixture),
      commitBeforeValidation
    );
    await assert.rejects(
      applyReservationLifecycle(
        signalReservationLifecycleA,
        "commit_spend_reservation",
        commitPayload
      ),
      /lacks a verified numeric total/
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."action_events"(
         id, job_id, state, reason_code, message, evidence_json, created_at
       ) VALUES ($1, $2, 'confirmed', 'native_verified_order',
                 'Native conflicting order evidence', $3, $4)`,
      [
        "native_reservation_commit_event_conflicting",
        commitFixture.actionJobId,
        JSON.stringify({ allInTotalCents: 4_000, orderTotalCents: 3_999 }),
        new Date(reservationLifecycleNow).toISOString()
      ]
    );
    await assert.rejects(
      applyReservationLifecycle(
        signalReservationLifecycleA,
        "commit_spend_reservation",
        commitPayload
      ),
      /total does not match the verified action evidence/
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."action_events"(
         id, job_id, state, reason_code, message, evidence_json, created_at
       ) VALUES ($1, $2, 'confirmed', 'native_verified_order',
                 'Native exact verified order evidence', $3, $4)`,
      [
        "native_reservation_commit_event_exact",
        commitFixture.actionJobId,
        JSON.stringify({ allInTotalCents: 4_000, orderTotalCents: 4_000 }),
        new Date(reservationLifecycleNow + 1).toISOString()
      ]
    );
    const commitBefore = await reservationLifecycleSnapshot(commitFixture);
    await first.query(
      `CREATE FUNCTION "${NATIVE_SCHEMA}"."yoink_native_reject_reservation_outbox"()
       RETURNS trigger LANGUAGE plpgsql AS $body$
       BEGIN
         IF NEW.aggregate_id = '${commitFixture.reservationId}'
           AND NEW.event_type = 'spend_committed' THEN
           RAISE EXCEPTION 'native reservation lifecycle outbox rejection';
         END IF;
         RETURN NEW;
       END
       $body$;
       CREATE TRIGGER "yoink_native_reject_reservation_outbox"
       BEFORE INSERT ON "${NATIVE_SCHEMA}"."outbox_events"
       FOR EACH ROW EXECUTE FUNCTION
         "${NATIVE_SCHEMA}"."yoink_native_reject_reservation_outbox"()`
    );
    try {
      await assert.rejects(
        applyReservationLifecycle(
          signalReservationLifecycleA,
          "commit_spend_reservation",
          commitPayload
        ),
        /native reservation lifecycle outbox rejection/
      );
      assert.deepEqual(
        await reservationLifecycleSnapshot(commitFixture),
        commitBefore
      );
    } finally {
      await first.query(
        `DROP TRIGGER IF EXISTS "yoink_native_reject_reservation_outbox"
           ON "${NATIVE_SCHEMA}"."outbox_events";
         DROP FUNCTION IF EXISTS
           "${NATIVE_SCHEMA}"."yoink_native_reject_reservation_outbox"()`
      );
    }

    signalReservationLifecycleLockClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalReservationLifecycleLockClient.on("error", () => undefined);
    await signalReservationLifecycleLockClient.connect();
    await signalReservationLifecycleLockClient.query(
      `SET ROLE "${signalWriterLockManifest.writerLockRole.name}"`
    );
    let reservationLifecycleLockTransactionOpen = false;
    let blockedCommit:
      ReturnType<NodePostgresSignalReservationLifecycleApplyDatabase["applyReservationLifecycle"]>
      | null = null;
    try {
      await signalReservationLifecycleLockClient.query("BEGIN");
      reservationLifecycleLockTransactionOpen = true;
      const spendLock = await signalReservationLifecycleLockClient.query<{
        resultJson: string;
      }>(
        `SELECT result_json AS "resultJson"
         FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION}"(
           $1, $2, '', '', '', '00001'
         )`,
        [NATIVE_TENANT, NATIVE_USER]
      );
      assert.deepEqual(JSON.parse(spendLock.rows[0]!.resultJson), {
        contractVersion: 1,
        lockProtocolVersion: "signal_action_constraints_v1",
        lockMask: "00001",
        scopeCount: 1,
        lockScopeOrder: [
          "source",
          "retailer_qualification",
          "settings",
          "mission_policy",
          "spend"
        ],
        sourceConnectionId: "",
        retailerId: "",
        missionId: "",
        mutationApplied: false,
        mutationAuthority: false,
        runtimeAuthority: false
      });
      let blockedCommitSettled = false;
      blockedCommit = applyReservationLifecycle(
        signalReservationLifecycleASecond,
        "commit_spend_reservation",
        commitPayload
      ).finally(() => { blockedCommitSettled = true; });
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      assert.equal(blockedCommitSettled, false);
      assert.deepEqual(
        await reservationLifecycleSnapshot(commitFixture),
        commitBefore
      );
      await signalReservationLifecycleLockClient.query("COMMIT");
      reservationLifecycleLockTransactionOpen = false;
      const commitResult = await blockedCommit;
      blockedCommit = null;
      assert.equal(commitResult.outcome, "applied");
      assert.equal(commitResult.mutationApplied, true);
      assert.equal(commitResult.mutationStatementCount, 4);
      assert.equal(commitResult.mutationRowCount, 4);
      assert.equal(commitResult.reservation.status, "committed");
      assert.equal(commitResult.reservation.committedAmountCents, 4_000);
      assert.equal(commitResult.ledger?.entryType, "committed");
      assert.equal(commitResult.ledger?.reservedDeltaCents, -4_343);
      assert.equal(commitResult.ledger?.spentDeltaCents, 4_000);
    } finally {
      if (reservationLifecycleLockTransactionOpen) {
        await signalReservationLifecycleLockClient.query("ROLLBACK").catch(() => undefined);
      }
      if (blockedCommit) await blockedCommit.catch(() => undefined);
      await signalReservationLifecycleLockClient.end().catch(() => undefined);
      signalReservationLifecycleLockClient = null;
    }
    const commitAfter = await reservationLifecycleSnapshot(commitFixture);
    assert.deepEqual(commitAfter, {
      ...commitBefore,
      reservationStatus: "committed",
      committedAmountCents: 4_000,
      ledgerCount: commitBefore.ledgerCount + 1,
      auditCount: commitBefore.auditCount + 1,
      outboxCount: commitBefore.outboxCount + 1
    });
    const commitReplay = await applyReservationLifecycle(
      signalReservationLifecycleA,
      "commit_spend_reservation",
      commitPayload
    );
    assert.equal(commitReplay.outcome, "already_applied");
    assert.equal(commitReplay.mutationApplied, false);
    assert.equal(commitReplay.idempotentReplay, true);
    assert.equal(commitReplay.mutationStatementCount, 0);
    assert.deepEqual(await reservationLifecycleSnapshot(commitFixture), commitAfter);

    const isolatedFixtureExpiry = new Date(
      reservationLifecycleNow + 24 * 60 * 60_000
    ).toISOString();
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."action_jobs"
       SET expires_at = $1
       WHERE tenant_id = $2 AND user_id = $3
         AND id LIKE 'native_reservation_%_job'`,
      [
        isolatedFixtureExpiry,
        NATIVE_TENANT,
        NATIVE_USER
      ]
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."spend_reservations"
       SET expires_at = $1
       WHERE tenant_id = $2 AND user_id = $3 AND status = 'active'
         AND id LIKE 'native_reservation_%'`,
      [
        isolatedFixtureExpiry,
        NATIVE_TENANT,
        NATIVE_USER
      ]
    );

    await Promise.all([
      signalReservationLifecycleA.close(),
      signalReservationLifecycleASecond.close(),
      signalReservationLifecycleB.close(),
      signalReservationLifecycleC.close(),
      signalReservationLifecycleUnmapped.close()
    ]);
    signalReservationLifecycleA = null;
    signalReservationLifecycleASecond = null;
    signalReservationLifecycleB = null;
    signalReservationLifecycleC = null;
    signalReservationLifecycleUnmapped = null;
    })();

    await (async () => {
    // --- v0.99: bounded attribution-RECEIPT writer proof ---
    // Closes `AttributionRepository.recordReceipt -> attribution_receipts`,
    // the write family `postgres-signal-evaluation-composition.ts` names in
    // its own POSTGRES_SIGNAL_EVALUATION_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES
    // as governed only by the attribution-policy-apply POLICY table. One
    // operation appends exactly one receipt for one already-owned action
    // job; provider/routeUrl/retailerId are DERIVED from the locked job row
    // (never trusted from the wire) and revalidated against the submitted
    // plan; canonical_url_hash is derived server-side, reproducing the real
    // TypeScript `stableHash` helper byte-for-byte; and a replayed job_id is
    // a true zero-write INSERT-OR-IGNORE success -- no comparison against
    // the newly-submitted payload at all.
    const attributionReceiptDatabase = (
      principalRole: string,
      maxConnections: 1 | 2 = 1
    ) => new NodePostgresSignalAttributionReceiptApplyDatabase({
      connectionString: principalConnection(principalRole),
      tlsMode: "local-insecure",
      certificateAuthorityPem: ""
    }, signalAttributionReceiptManifest, { maxConnections });
    signalAttributionReceiptA = attributionReceiptDatabase(NATIVE_PRINCIPAL_A);
    signalAttributionReceiptB = attributionReceiptDatabase(NATIVE_PRINCIPAL_B);
    signalAttributionReceiptC = attributionReceiptDatabase(NATIVE_PRINCIPAL_C);
    signalAttributionReceiptUnmapped = attributionReceiptDatabase(NATIVE_PRINCIPAL_UNMAPPED);

    const attributionReceiptPrincipalA = { tenantId: NATIVE_TENANT, userId: NATIVE_USER };
    const attributionReceiptPrincipalB = { tenantId: "tenant_local", userId: "user_local" };

    // Read back -- never assume -- the qualified action job's own
    // attribution snapshot. `actionSpendWinner` was created earlier in this
    // suite by the qualified action/spend boundary, which unconditionally
    // sets `attribution_url = canonical_url` and `attribution_provider =
    // 'canonical'` (postgres-signal-action-spend-apply.ts). The
    // attribution-policy section above provisioned+enabled a 'target'
    // policy row for the same tenant/user. This section fails loudly (via
    // the asserts immediately below) if either upstream fixture ever
    // drifts, rather than silently hardcoding stale values.
    const attributionReceiptJobSnapshot = (await first!.query<{
      canonicalUrl: string;
      attributionUrl: string;
      attributionProvider: string;
      retailerId: string;
    }>(
      `SELECT job.canonical_url AS "canonicalUrl", job.attribution_url AS "attributionUrl",
              job.attribution_provider AS "attributionProvider",
              listing.retailer_id AS "retailerId"
       FROM "${NATIVE_SCHEMA}"."action_jobs" job
       JOIN "${NATIVE_SCHEMA}"."listings" listing ON listing.id = job.listing_id
       WHERE job.id = $1`,
      [actionSpendWinner.actionJobId]
    )).rows[0]!;
    assert.equal(attributionReceiptJobSnapshot.retailerId, "target");
    assert.equal(attributionReceiptJobSnapshot.attributionProvider, "canonical");
    assert.equal(attributionReceiptJobSnapshot.attributionUrl, attributionReceiptJobSnapshot.canonicalUrl);

    const attributionReceiptTargetPolicyId = (await first!.query<{ id: string }>(
      `SELECT id FROM "${NATIVE_SCHEMA}"."attribution_policies"
       WHERE tenant_id = $1 AND user_id = $2 AND retailer_id = 'target'`,
      [NATIVE_TENANT, NATIVE_USER]
    )).rows[0]!.id;

    const attributionReceiptPlan = (overrides: Partial<AttributionPlan> = {}): AttributionPlan => ({
      policyId: attributionReceiptTargetPolicyId,
      retailerId: "target",
      provider: "canonical",
      outcome: "canonical_disabled",
      reasonCode: "attribution_disabled",
      routeUrl: attributionReceiptJobSnapshot.canonicalUrl,
      metadata: {},
      blocked: false,
      ...overrides
    });
    const applyAttributionReceipt = (
      database: NodePostgresSignalAttributionReceiptApplyDatabase,
      principalValue: { tenantId: string; userId: string },
      jobId: string,
      plan: AttributionPlan
    ) => {
      const payload = normalizedPostgresSignalAttributionReceiptRecordPayload(jobId, plan);
      return database.recordAttributionReceipt(
        principalValue,
        buildPostgresSignalAttributionReceiptRecordRequestId(principalValue, payload),
        payload
      );
    };
    const attributionReceiptGraphCounts = async (
      jobId: string
    ): Promise<{ receipts: number; audits: number; outboxes: number }> => {
      const row = (await first!.query<{
        receipts: string | number | bigint;
        audits: string | number | bigint;
        outboxes: string | number | bigint;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."attribution_receipts"
            WHERE job_id = $1) AS receipts,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
            WHERE correlation_id = $1
              AND event_type = 'attribution_route_recorded') AS audits,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
            WHERE aggregate_type = 'attribution_receipt' AND aggregate_id = $1) AS outboxes`,
        [jobId]
      )).rows[0]!;
      return {
        receipts: Number(row.receipts),
        audits: Number(row.audits),
        outboxes: Number(row.outboxes)
      };
    };

    // Fresh receipt for the qualified action job created earlier in the
    // suite by the action/spend boundary proofs.
    assert.deepEqual(
      await attributionReceiptGraphCounts(actionSpendWinner.actionJobId),
      { receipts: 0, audits: 0, outboxes: 0 }
    );
    const firstAttributionReceiptResult = await applyAttributionReceipt(
      signalAttributionReceiptA,
      attributionReceiptPrincipalA,
      actionSpendWinner.actionJobId,
      attributionReceiptPlan()
    );
    assert.equal(firstAttributionReceiptResult.contractVersion, 1);
    assert.equal(firstAttributionReceiptResult.operation, "record_attribution_receipt");
    assert.match(firstAttributionReceiptResult.requestId, /^attribution_receipt_record_[a-f0-9]{32}$/);
    assert.match(firstAttributionReceiptResult.requestFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(firstAttributionReceiptResult.outcome, "applied");
    assert.equal(firstAttributionReceiptResult.mutationApplied, true);
    assert.equal(firstAttributionReceiptResult.idempotentReplay, false);
    assert.equal(firstAttributionReceiptResult.mutationStatementCount, 3);
    assert.equal(firstAttributionReceiptResult.mutationRowCount, 3);
    assert.equal(firstAttributionReceiptResult.receiptMutated, true);
    assert.equal(firstAttributionReceiptResult.auditMutated, true);
    assert.equal(firstAttributionReceiptResult.outboxMutated, true);
    assert.match(firstAttributionReceiptResult.receipt.id, /^attribution_receipt_[a-f0-9]{32}$/);
    assert.equal(firstAttributionReceiptResult.receipt.jobId, actionSpendWinner.actionJobId);
    assert.equal(firstAttributionReceiptResult.receipt.policyId, attributionReceiptTargetPolicyId);
    assert.equal(firstAttributionReceiptResult.receipt.retailerId, "target");
    assert.equal(firstAttributionReceiptResult.receipt.provider, "canonical");
    assert.equal(firstAttributionReceiptResult.receipt.outcome, "canonical_disabled");
    assert.equal(firstAttributionReceiptResult.receipt.reasonCode, "attribution_disabled");
    assert.equal(firstAttributionReceiptResult.receipt.routeUrl, attributionReceiptJobSnapshot.canonicalUrl);
    // The server-derived canonical_url_hash must equal the REAL TypeScript
    // stableHash helper's output over the job's own canonical_url -- proving
    // the PL/pgSQL reproduction agrees with domain/src/ids.ts byte-for-byte,
    // not merely that both sides independently claim a sha256 shape.
    assert.equal(
      firstAttributionReceiptResult.receipt.canonicalUrlHash,
      stableHash("canonical-attribution-url-v1", attributionReceiptJobSnapshot.canonicalUrl)
    );
    assert.equal(typeof firstAttributionReceiptResult.receipt.createdAt, "string");
    assert.ok(firstAttributionReceiptResult.receipt.createdAt.length > 0);
    assert.equal(firstAttributionReceiptResult.attributionReceiptWriterParity, true);
    assert.equal(firstAttributionReceiptResult.writerLockProtocolParity, false);
    assert.equal(firstAttributionReceiptResult.mutationAuthority, true);
    assert.equal(firstAttributionReceiptResult.sharedCatalogMutationAuthority, false);
    assert.equal(firstAttributionReceiptResult.actionAuthority, false);
    assert.equal(firstAttributionReceiptResult.runtimeAuthority, false);
    assert.deepEqual(
      await attributionReceiptGraphCounts(actionSpendWinner.actionJobId),
      { receipts: 1, audits: 1, outboxes: 1 }
    );

    const attributionReceiptAudit = (await first!.query<{
      aggregateType: string;
      eventType: string;
      reasonCode: string;
      message: string;
      data: Record<string, unknown>;
      outboxData: Record<string, unknown>;
    }>(
      `SELECT outbox.aggregate_type AS "aggregateType",
              audit.event_type AS "eventType", audit.reason_code AS "reasonCode",
              audit.message, audit.data_json::jsonb AS data,
              outbox.payload_json::jsonb->'data' AS "outboxData"
       FROM "${NATIVE_SCHEMA}"."audit_events" audit
       JOIN "${NATIVE_SCHEMA}"."outbox_events" outbox
         ON outbox.payload_json::jsonb->>'auditId' = audit.id
       WHERE audit.correlation_id = $1
         AND audit.event_type = 'attribution_route_recorded'`,
      [actionSpendWinner.actionJobId]
    )).rows[0]!;
    assert.equal(attributionReceiptAudit.aggregateType, "attribution_receipt");
    assert.equal(attributionReceiptAudit.eventType, "attribution_route_recorded");
    assert.equal(attributionReceiptAudit.reasonCode, "attribution_disabled");
    assert.equal(
      attributionReceiptAudit.message,
      "An immutable attribution-routing receipt was recorded for an action job."
    );
    assert.equal(attributionReceiptAudit.data.operation, "record_attribution_receipt");
    assert.deepEqual(attributionReceiptAudit.outboxData, attributionReceiptAudit.data);

    // Duplicate call, identical payload: a true zero-write stored-state
    // return, no audit flood.
    const duplicateAttributionReceiptResult = await applyAttributionReceipt(
      signalAttributionReceiptA,
      attributionReceiptPrincipalA,
      actionSpendWinner.actionJobId,
      attributionReceiptPlan()
    );
    assert.equal(duplicateAttributionReceiptResult.outcome, "already_applied");
    assert.equal(duplicateAttributionReceiptResult.mutationApplied, false);
    assert.equal(duplicateAttributionReceiptResult.idempotentReplay, true);
    assert.equal(duplicateAttributionReceiptResult.mutationStatementCount, 0);
    assert.equal(duplicateAttributionReceiptResult.mutationRowCount, 0);
    assert.equal(duplicateAttributionReceiptResult.receiptMutated, false);
    assert.equal(duplicateAttributionReceiptResult.auditMutated, false);
    assert.equal(duplicateAttributionReceiptResult.outboxMutated, false);
    assert.equal(duplicateAttributionReceiptResult.requestId, firstAttributionReceiptResult.requestId);
    assert.deepEqual(duplicateAttributionReceiptResult.receipt, firstAttributionReceiptResult.receipt);
    assert.deepEqual(
      await attributionReceiptGraphCounts(actionSpendWinner.actionJobId),
      { receipts: 1, audits: 1, outboxes: 1 }
    );

    // Receipt-tamper proof, mirroring the depth of this suite's other
    // receipt-tamper checks: unlike every sibling boundary (which re-verifies
    // an audited replay graph and raises 40001 on drift), this module's
    // replay check keys ONLY on job_id -- a maximally-diverged payload
    // (different retailer, provider, outcome, reason code, route URL, and
    // policy id) submitted for the SAME already-recorded job must still
    // return the ORIGINAL stored row untouched, with NO comparison against
    // what was just submitted, and no new audit/outbox row.
    const tamperedAttributionReceiptResult = await applyAttributionReceipt(
      signalAttributionReceiptA,
      attributionReceiptPrincipalA,
      actionSpendWinner.actionJobId,
      attributionReceiptPlan({
        policyId: "attribution_amazon_native_a",
        retailerId: "amazon",
        provider: "howl",
        outcome: "affiliate_route",
        reasonCode: "howl_route_ready",
        routeUrl: "https://howl.link/link?tamper=attempt"
      })
    );
    assert.equal(tamperedAttributionReceiptResult.outcome, "already_applied");
    assert.equal(tamperedAttributionReceiptResult.mutationApplied, false);
    assert.notEqual(tamperedAttributionReceiptResult.requestId, firstAttributionReceiptResult.requestId);
    assert.deepEqual(tamperedAttributionReceiptResult.receipt, firstAttributionReceiptResult.receipt);
    assert.deepEqual(
      await attributionReceiptGraphCounts(actionSpendWinner.actionJobId),
      { receipts: 1, audits: 1, outboxes: 1 }
    );

    // A second, independent qualified job (cloned from actionSpendWinner's
    // job, carrying the SAME real attribution snapshot) so the mismatch and
    // nonexistent/foreign-job fail-closed proofs below run against a job
    // that has never had a receipt recorded.
    const secondAttributionReceiptJobId = "native_attribution_receipt_second_job";
    const secondAttributionReceiptCreatedAt = new Date(Date.now() - 2_000).toISOString();
    await first!.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."action_jobs"(
         id, tenant_id, user_id, mission_id, mission_target_id, incident_id,
         state, action, quantity, max_unit_price_cents, max_order_total_cents,
         currency, seller_policy, fulfillment, expected_seller, listing_id,
         canonical_url, attribution_url, attribution_provider, idempotency_key,
         capability_nonce_hash, expires_at, intent_revision_id,
         exact_offer_key_id, offer_snapshot_id, created_at, updated_at
       )
       SELECT $1, tenant_id, user_id, mission_id, mission_target_id, incident_id,
              state, action, quantity, max_unit_price_cents, max_order_total_cents,
              currency, seller_policy, fulfillment, expected_seller, listing_id,
              canonical_url, attribution_url, attribution_provider, $2,
              capability_nonce_hash, expires_at, intent_revision_id,
              exact_offer_key_id, offer_snapshot_id, $3, $3
       FROM "${NATIVE_SCHEMA}"."action_jobs" WHERE id = $4`,
      [
        secondAttributionReceiptJobId,
        "attribution-receipt-second-job-key",
        secondAttributionReceiptCreatedAt,
        actionSpendWinner.actionJobId
      ]
    );
    assert.deepEqual(
      await attributionReceiptGraphCounts(secondAttributionReceiptJobId),
      { receipts: 0, audits: 0, outboxes: 0 }
    );

    // Plan-field mismatch vs. the job row: fail-closed, zero writes.
    await assert.rejects(
      applyAttributionReceipt(
        signalAttributionReceiptA,
        attributionReceiptPrincipalA,
        secondAttributionReceiptJobId,
        attributionReceiptPlan({ routeUrl: "https://www.target.com/p/mismatched-route/WRONG" })
      ),
      /does not match the action job attribution snapshot/
    );
    assert.deepEqual(
      await attributionReceiptGraphCounts(secondAttributionReceiptJobId),
      { receipts: 0, audits: 0, outboxes: 0 }
    );

    // Policy-identity mismatch (retailer/provider/routeUrl correct, policyId
    // stale): fail-closed, zero writes.
    await assert.rejects(
      applyAttributionReceipt(
        signalAttributionReceiptA,
        attributionReceiptPrincipalA,
        secondAttributionReceiptJobId,
        attributionReceiptPlan({ policyId: "attribution_amazon_native_a" })
      ),
      /does not match the currently provisioned policy/
    );
    assert.deepEqual(
      await attributionReceiptGraphCounts(secondAttributionReceiptJobId),
      { receipts: 0, audits: 0, outboxes: 0 }
    );

    // Nonexistent job: fail-closed.
    await assert.rejects(
      applyAttributionReceipt(
        signalAttributionReceiptA,
        attributionReceiptPrincipalA,
        "native_attribution_receipt_missing_job",
        attributionReceiptPlan()
      ),
      /action job ownership is invalid/
    );
    // Foreign job: exists, but not owned by the calling (correctly
    // authenticated) tenant/user.
    await assert.rejects(
      applyAttributionReceipt(
        signalAttributionReceiptB,
        attributionReceiptPrincipalB,
        actionSpendWinner.actionJobId,
        attributionReceiptPlan()
      ),
      /action job ownership is invalid/
    );

    // Fail-closed rejections above left zero writes -- the correct payload
    // for the same second job now succeeds cleanly, proving the earlier
    // failures never corrupted state.
    const secondAttributionReceiptResult = await applyAttributionReceipt(
      signalAttributionReceiptA,
      attributionReceiptPrincipalA,
      secondAttributionReceiptJobId,
      attributionReceiptPlan()
    );
    assert.equal(secondAttributionReceiptResult.outcome, "applied");
    assert.equal(secondAttributionReceiptResult.receipt.jobId, secondAttributionReceiptJobId);
    assert.notEqual(secondAttributionReceiptResult.receipt.id, firstAttributionReceiptResult.receipt.id);
    assert.equal(
      secondAttributionReceiptResult.receipt.canonicalUrlHash,
      stableHash("canonical-attribution-url-v1", attributionReceiptJobSnapshot.canonicalUrl)
    );
    assert.deepEqual(
      await attributionReceiptGraphCounts(secondAttributionReceiptJobId),
      { receipts: 1, audits: 1, outboxes: 1 }
    );

    // Denial matrix: wrong principal.
    await assert.rejects(
      applyAttributionReceipt(
        signalAttributionReceiptB,
        attributionReceiptPrincipalA,
        actionSpendWinner.actionJobId,
        attributionReceiptPlan()
      ),
      /does not match the expected authenticated principal/
    );
    // Denial matrix: same-tenant peer.
    await first!.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [NATIVE_PRINCIPAL_C, NATIVE_TENANT, NATIVE_SAME_TENANT_USER,
        new Date(Date.now() - 5_000).toISOString()]
    );
    try {
      await assert.rejects(
        applyAttributionReceipt(
          signalAttributionReceiptC,
          attributionReceiptPrincipalA,
          actionSpendWinner.actionJobId,
          attributionReceiptPlan()
        ),
        /does not match the expected authenticated principal/
      );
    } finally {
      await first!.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
         WHERE principal_role = $1`,
        [NATIVE_PRINCIPAL_C]
      );
    }
    // Denial matrix: unmapped principal.
    await assert.rejects(
      applyAttributionReceipt(
        signalAttributionReceiptUnmapped,
        attributionReceiptPrincipalA,
        actionSpendWinner.actionJobId,
        attributionReceiptPlan()
      ),
      /tenant session principal is not active/
    );
    // Malformed request id: caught client-side before any round trip.
    await assert.rejects(
      signalAttributionReceiptA.recordAttributionReceipt(
        attributionReceiptPrincipalA,
        `attribution_receipt_record_${"f".repeat(32)}`,
        normalizedPostgresSignalAttributionReceiptRecordPayload(
          actionSpendWinner.actionJobId,
          attributionReceiptPlan()
        )
      ),
      /apply request is invalid/
    );

    // Zero direct table SQL for the role, and cross-boundary denial in both
    // directions.
    signalAttributionReceiptDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    signalAttributionReceiptDirectClient.on("error", () => undefined);
    await signalAttributionReceiptDirectClient.connect();
    await signalAttributionReceiptDirectClient.query(
      `SET ROLE "${signalAttributionReceiptManifest.attributionReceiptRole.name}"`
    );
    await assert.rejects(
      signalAttributionReceiptDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."attribution_receipts" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalAttributionReceiptDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."action_jobs" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalAttributionReceiptDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."attribution_policies" LIMIT 1`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalAttributionReceiptDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."audit_events"(id)
         VALUES ('forbidden_attribution_receipt_audit')`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalAttributionReceiptDirectClient.query(
        `UPDATE "${NATIVE_SCHEMA}"."outbox_events" SET delivered_at = ''`
      ),
      /permission denied/
    );
    await assert.rejects(
      signalAttributionReceiptDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION}"(
           $1, $2, 'replace_attribution_policies', 'forbidden_cross_boundary', '{}'
         )`,
        [attributionReceiptPrincipalA.tenantId, attributionReceiptPrincipalA.userId]
      ),
      /permission denied/
    );
    // A sibling role (attribution-policy's) cannot call this boundary's
    // function either.
    await signalAttributionReceiptDirectClient.query(
      `SET ROLE "${signalAttributionPolicyManifest.attributionPolicyRole.name}"`
    );
    await assert.rejects(
      signalAttributionReceiptDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_FUNCTION}"(
           $1, $2, 'record_attribution_receipt', 'forbidden_cross_boundary_reverse', '{}'
         )`,
        [attributionReceiptPrincipalA.tenantId, attributionReceiptPrincipalA.userId]
      ),
      /permission denied/
    );
    await signalAttributionReceiptDirectClient.end();
    signalAttributionReceiptDirectClient = null;

    // Immutable replay consistency: called again after unrelated denial-
    // matrix and validation activity, the original request id must return
    // the original "applied" audit's result unchanged and write nothing
    // further.
    const immutableAttributionReceiptReplay = await applyAttributionReceipt(
      signalAttributionReceiptA,
      attributionReceiptPrincipalA,
      actionSpendWinner.actionJobId,
      attributionReceiptPlan()
    );
    assert.equal(immutableAttributionReceiptReplay.outcome, "already_applied");
    assert.equal(immutableAttributionReceiptReplay.mutationApplied, false);
    assert.equal(immutableAttributionReceiptReplay.idempotentReplay, true);
    assert.equal(immutableAttributionReceiptReplay.requestId, firstAttributionReceiptResult.requestId);
    assert.equal(
      immutableAttributionReceiptReplay.requestFingerprint,
      firstAttributionReceiptResult.requestFingerprint
    );
    assert.deepEqual(immutableAttributionReceiptReplay.receipt, firstAttributionReceiptResult.receipt);
    assert.deepEqual(
      await attributionReceiptGraphCounts(actionSpendWinner.actionJobId),
      { receipts: 1, audits: 1, outboxes: 1 }
    );

    await Promise.all([
      signalAttributionReceiptA.close(),
      signalAttributionReceiptB.close(),
      signalAttributionReceiptC.close(),
      signalAttributionReceiptUnmapped.close()
    ]);
    signalAttributionReceiptA = null;
    signalAttributionReceiptB = null;
    signalAttributionReceiptC = null;
    signalAttributionReceiptUnmapped = null;
    })();

    const notificationNow = Date.now();
    const notificationFixture = await insertNotificationRecoveryFixtures(first, notificationNow);
    notificationHandlerDb = new YoinkDatabase();
    const notificationHandler = new BackgroundMaintenanceHandler(notificationHandlerDb, {
      notificationRecovery: notificationRecoveryA
    });
    assert.deepEqual(
      await notificationHandler.execute(
        workerContext("native_notification_handler"),
        "notification_recovery",
        notificationNow
      ),
      {
        expiredNotifications: 1,
        requeuedLeases: 1,
        failedLeases: 1
      }
    );
    assert.deepEqual(
      (await first.query<{
        id: string;
        state: string;
        assignedDeviceId: string | null;
        capabilityHash: string;
        leaseExpiresAt: string;
        failureCode: string;
      }>(
        `SELECT id, state, assigned_device_id AS "assignedDeviceId",
                capability_hash AS "capabilityHash", lease_expires_at AS "leaseExpiresAt",
                failure_code AS "failureCode"
         FROM "${NATIVE_SCHEMA}"."notification_deliveries"
         WHERE tenant_id = $1 AND user_id = $2 AND id LIKE 'native_delivery_%'
         ORDER BY id`,
        [NATIVE_TENANT, NATIVE_USER]
      )).rows,
      [
        {
          id: "native_delivery_current",
          state: "leased",
          assignedDeviceId: null,
          capabilityHash: "capability:native_delivery_current",
          leaseExpiresAt: notificationFixture.currentLeaseAt,
          failureCode: ""
        },
        {
          id: "native_delivery_expired",
          state: "expired",
          assignedDeviceId: null,
          capabilityHash: "",
          leaseExpiresAt: "",
          failureCode: "job_window_expired"
        },
        {
          id: "native_delivery_failed",
          state: "failed",
          assignedDeviceId: null,
          capabilityHash: "",
          leaseExpiresAt: "",
          failureCode: "delivery_attempts_exhausted"
        },
        {
          id: "native_delivery_requeued",
          state: "pending",
          assignedDeviceId: null,
          capabilityHash: "",
          leaseExpiresAt: "",
          failureCode: "lease_expired_requeued"
        }
      ]
    );
    assert.deepEqual(
      await notificationRecoveryA.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        notificationNow
      ),
      { expiredNotifications: 0, requeuedLeases: 0, failedLeases: 0 }
    );
    await assert.rejects(
      notificationRecoveryA.recover(
        { tenantId: "tenant_local", userId: "user_local" },
        notificationNow
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      notificationRecoveryUnmapped.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        notificationNow
      ),
      /tenant session principal is not active/
    );
    assert.deepEqual(
      await notificationRecoveryB.recover(
        { tenantId: "tenant_local", userId: "user_local" },
        notificationNow
      ),
      { expiredNotifications: 1, requeuedLeases: 0, failedLeases: 0 }
    );
    await assert.rejects(
      notificationRecoveryA.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        notificationNow - 600_000
      ),
      /cycle timestamp differs from the process clock/
    );
    notificationDirectClient = new Client({ connectionString: principalConnection(NATIVE_PRINCIPAL_A) });
    notificationDirectClient.on("error", () => undefined);
    await notificationDirectClient.connect();
    await notificationDirectClient.query(
      `SET ROLE "${notificationRecoveryManifest.recoveryRole.name}"`
    );
    await assert.rejects(
      notificationDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."notification_deliveries"`
      ),
      /permission denied/
    );
    await assert.rejects(
      notificationDirectClient.query(
        `UPDATE "${NATIVE_SCHEMA}"."notification_deliveries" SET state = 'delivered'`
      ),
      /permission denied/
    );
    await assert.rejects(
      notificationDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."yoink_bind_tenant_session"()`
      ),
      /permission denied/
    );
    await notificationDirectClient.end();
    notificationDirectClient = null;
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."notification_deliveries"
       SET state = 'leased', attempts = 2, capability_hash = 'capability:contention',
           lease_expires_at = $1, failure_code = ''
       WHERE id = 'native_delivery_requeued'`,
      [notificationFixture.expiredLeaseAt]
    );
    const concurrentRecovery = await Promise.all([
      notificationRecoveryA.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        notificationNow
      ),
      notificationRecoveryA.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        notificationNow
      )
    ]);
    assert.equal(
      concurrentRecovery.reduce((sum, result) => sum + result.requeuedLeases, 0),
      1
    );
    assert.ok(concurrentRecovery.every((result) => result.expiredNotifications === 0
      && result.failedLeases === 0));

    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."action_jobs"
       SET state = 'notify_only'
       WHERE id LIKE 'native_notify_%'`
    );
    const executionNow = Date.now();
    const executionFixture = await insertExecutionRecoveryFixtures(first, executionNow);
    executionHandlerDb = new YoinkDatabase();
    const executionHandler = new BackgroundMaintenanceHandler(executionHandlerDb, {
      executionRecovery: executionRecoveryA
    });
    assert.deepEqual(
      await executionHandler.execute(
        workerContext("native_execution_handler"),
        "execution_recovery",
        executionNow
      ),
      {
        recoveredActionLeases: 5,
        expiredActionJobs: 1,
        releasedSpendReservations: 1
      }
    );
    const executionJobs = (await first.query<{
      id: string;
      state: string;
      capabilityNonceHash: string;
      leaseExpiresAt: string;
    }>(
      `SELECT id, state, capability_nonce_hash AS "capabilityNonceHash",
              lease_expires_at AS "leaseExpiresAt"
       FROM "${NATIVE_SCHEMA}"."action_jobs"
       WHERE tenant_id = $1 AND user_id = $2 AND id LIKE 'native_exec_%'
       ORDER BY id`,
      [NATIVE_TENANT, NATIVE_USER]
    )).rows;
    assert.deepEqual(
      executionJobs.map((job) => ({ id: job.id, state: job.state })),
      [
        { id: "native_exec_add_authorized", state: "cancelled" },
        { id: "native_exec_adding", state: "manual_review" },
        { id: "native_exec_contention", state: "leased" },
        { id: "native_exec_current", state: "leased" },
        { id: "native_exec_leased", state: "expired" },
        { id: "native_exec_pending", state: "expired" },
        { id: "native_exec_reservation_only", state: "awaiting_executor" },
        { id: "native_exec_shared", state: "expired" },
        { id: "native_exec_submitting", state: "submission_uncertain" }
      ]
    );
    for (const job of executionJobs.filter((row) => [
      "native_exec_add_authorized",
      "native_exec_adding",
      "native_exec_leased",
      "native_exec_shared",
      "native_exec_submitting"
    ].includes(row.id))) {
      assert.match(job.capabilityNonceHash, /^[a-f0-9]{64}$/);
      assert.notEqual(job.capabilityNonceHash, `original-capability:${job.id}`);
      assert.notEqual(job.leaseExpiresAt, executionFixture.expiredLeaseAt);
    }
    assert.equal(
      executionJobs.find((job) => job.id === "native_exec_current")?.leaseExpiresAt,
      executionFixture.currentLeaseAt
    );
    assert.equal(
      executionJobs.find((job) => job.id === "native_exec_pending")?.capabilityNonceHash,
      "original-capability:native_exec_pending"
    );
    assert.deepEqual(
      (await first.query<{ id: string; status: string; closedReason: string }>(
        `SELECT id, status, closed_reason AS "closedReason"
         FROM "${NATIVE_SCHEMA}"."signal_incidents"
         WHERE id LIKE 'native_exec_incident_%' ORDER BY id`
      )).rows,
      [
        { id: "native_exec_incident_add_authorized", status: "closed", closedReason: "cancelled" },
        { id: "native_exec_incident_adding", status: "locked", closedReason: "manual_review" },
        { id: "native_exec_incident_contention", status: "open", closedReason: "" },
        { id: "native_exec_incident_current", status: "open", closedReason: "" },
        { id: "native_exec_incident_leased", status: "closed", closedReason: "expired" },
        { id: "native_exec_incident_pending", status: "closed", closedReason: "expired" },
        { id: "native_exec_incident_reservation_only", status: "open", closedReason: "" },
        { id: "native_exec_incident_shared", status: "open", closedReason: "" },
        { id: "native_exec_incident_submitting", status: "locked", closedReason: "submission_uncertain" }
      ]
    );
    assert.deepEqual(
      (await first.query<{ id: string; status: string; releaseReason: string }>(
        `SELECT id, status, release_reason AS "releaseReason"
         FROM "${NATIVE_SCHEMA}"."spend_reservations"
         WHERE tenant_id = $1 AND user_id = $2 AND id LIKE 'native_exec_reservation_%'
         ORDER BY id`,
        [NATIVE_TENANT, NATIVE_USER]
      )).rows,
      [
        { id: "native_exec_reservation_add_authorized", status: "released", releaseReason: "cancelled" },
        { id: "native_exec_reservation_adding", status: "active", releaseReason: "" },
        { id: "native_exec_reservation_leased", status: "released", releaseReason: "expired" },
        { id: "native_exec_reservation_pending", status: "released", releaseReason: "expired" },
        { id: "native_exec_reservation_reservation_only", status: "released", releaseReason: "reservation_expired" },
        { id: "native_exec_reservation_submitting", status: "active", releaseReason: "" }
      ]
    );
    assert.deepEqual(
      (await first.query<{ actionJobId: string; reasonCode: string }>(
        `SELECT action_job_id AS "actionJobId", reason_code AS "reasonCode"
         FROM "${NATIVE_SCHEMA}"."spend_ledger_entries"
         WHERE tenant_id = $1 AND user_id = $2 AND entry_type = 'released'
           AND action_job_id LIKE 'native_exec_%'
         ORDER BY action_job_id`,
        [NATIVE_TENANT, NATIVE_USER]
      )).rows,
      [
        { actionJobId: "native_exec_add_authorized", reasonCode: "cancelled" },
        { actionJobId: "native_exec_leased", reasonCode: "expired" },
        { actionJobId: "native_exec_pending", reasonCode: "expired" },
        { actionJobId: "native_exec_reservation_only", reasonCode: "reservation_expired" }
      ]
    );
    assert.deepEqual(
      (await first.query<{ jobId: string; state: string; reasonCode: string }>(
        `SELECT job_id AS "jobId", state, reason_code AS "reasonCode"
         FROM "${NATIVE_SCHEMA}"."action_events"
         WHERE job_id LIKE 'native_exec_%' ORDER BY job_id`
      )).rows,
      [
        { jobId: "native_exec_add_authorized", state: "cancelled", reasonCode: "lease_expired_before_mutation" },
        { jobId: "native_exec_adding", state: "manual_review", reasonCode: "lease_expired_after_mutation_boundary" },
        { jobId: "native_exec_leased", state: "expired", reasonCode: "lease_expired_before_mutation" },
        { jobId: "native_exec_pending", state: "expired", reasonCode: "signal_window_expired" },
        { jobId: "native_exec_shared", state: "expired", reasonCode: "lease_expired_before_mutation" },
        { jobId: "native_exec_submitting", state: "submission_uncertain", reasonCode: "lease_expired_after_mutation_boundary" }
      ]
    );
    assert.deepEqual(
      (await first.query<{ auditCount: string | number | bigint; outboxCount: string | number | bigint }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
            WHERE correlation_id LIKE 'native_exec_%') AS "auditCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
            WHERE aggregate_id LIKE 'native_exec_%') AS "outboxCount"`
      )).rows.map((row) => ({
        auditCount: Number(row.auditCount),
        outboxCount: Number(row.outboxCount)
      })),
      [{ auditCount: 10, outboxCount: 10 }]
    );
    assert.deepEqual(
      await executionRecoveryA.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        executionNow
      ),
      { recoveredActionLeases: 0, expiredActionJobs: 0, releasedSpendReservations: 0 }
    );
    await assert.rejects(
      executionRecoveryA.recover(
        { tenantId: "tenant_local", userId: "user_local" },
        executionNow
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      executionRecoveryUnmapped.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        executionNow
      ),
      /tenant session principal is not active/
    );
    assert.deepEqual(
      await executionRecoveryB.recover(
        { tenantId: "tenant_local", userId: "user_local" },
        executionNow
      ),
      { recoveredActionLeases: 1, expiredActionJobs: 0, releasedSpendReservations: 0 }
    );
    assert.deepEqual(
      (await first.query<{ id: string; state: string }>(
        `SELECT id, state FROM "${NATIVE_SCHEMA}"."action_jobs"
         WHERE id IN ('native_exec_shared', 'native_exec_cross_tenant') ORDER BY id`
      )).rows,
      [
        { id: "native_exec_cross_tenant", state: "expired" },
        { id: "native_exec_shared", state: "expired" }
      ]
    );
    assert.deepEqual(
      (await first.query<{ status: string; closedReason: string }>(
        `SELECT status, closed_reason AS "closedReason"
         FROM "${NATIVE_SCHEMA}"."signal_incidents"
         WHERE id = 'native_exec_incident_shared'`
      )).rows,
      [{ status: "open", closedReason: "" }]
    );
    await assert.rejects(
      executionRecoveryA.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        executionNow - 600_000
      ),
      /cycle timestamp differs from the process clock/
    );
    executionDirectClient = new Client({ connectionString: principalConnection(NATIVE_PRINCIPAL_A) });
    executionDirectClient.on("error", () => undefined);
    await executionDirectClient.connect();
    await executionDirectClient.query(
      `SET ROLE "${executionRecoveryManifest.executionRecoveryRole.name}"`
    );
    await assert.rejects(
      executionDirectClient.query(`SELECT id FROM "${NATIVE_SCHEMA}"."action_jobs"`),
      /permission denied/
    );
    await assert.rejects(
      executionDirectClient.query(
        `UPDATE "${NATIVE_SCHEMA}"."spend_reservations" SET status = 'committed'`
      ),
      /permission denied/
    );
    await assert.rejects(
      executionDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."yoink_recover_notification_deliveries"($1, $2)`,
        [NATIVE_TENANT, NATIVE_USER]
      ),
      /permission denied/
    );
    await executionDirectClient.end();
    executionDirectClient = null;
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."action_jobs"
       SET lease_expires_at = $1
       WHERE id = 'native_exec_contention' AND state = 'leased'`,
      [executionFixture.expiredLeaseAt]
    );
    const concurrentExecutionRecovery = await Promise.all([
      executionRecoveryA.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        executionNow
      ),
      executionRecoveryA.recover(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        executionNow
      )
    ]);
    assert.equal(
      concurrentExecutionRecovery.reduce((sum, result) => sum + result.recoveredActionLeases, 0),
      1
    );
    assert.ok(concurrentExecutionRecovery.every((result) => result.expiredActionJobs === 0
      && result.releasedSpendReservations === 0));

    const retentionNow = Date.now();
    await insertOperationalRetentionFixtures(first, retentionNow);
    operationalRetentionHandlerDb = new YoinkDatabase();
    const operationalRetentionHandler = new BackgroundMaintenanceHandler(
      operationalRetentionHandlerDb,
      { operationalTelemetryRetention: operationalRetentionA }
    );
    const retentionResult = await operationalRetentionHandler.execute(
      workerContext("native_operational_retention_handler"),
      "operational_telemetry_retention",
      retentionNow
    );
    assert.equal(retentionResult.deletedRollupRows, 1);
    assert.equal(retentionResult.deletedErrorEvents, 1);
    assert.equal(retentionResult.deletedTaskRuns, 1);
    assert.equal(retentionResult.deletedRecoveryEvidence, 1);
    assert.equal(retentionResult.deletedRecoveryReviewEvents, 1);
    assert.equal(retentionResult.recoveryEvidenceRetentionDays, 90);
    assert.match(String(retentionResult.receiptId), /^telemetry_retention_[a-f0-9]{32}$/);
    assert.match(
      String(retentionResult.recoveryEvidenceRetentionReceiptId),
      /^observer_recovery_retention_[a-f0-9]{32}$/
    );
    assert.equal(retentionResult.cutoffAt, retentionResult.taskHistoryCutoffAt);
    assert.ok(Math.abs(
      Date.parse(String(retentionResult.cutoffAt))
        - (retentionNow - 30 * 24 * 60 * 60_000)
    ) < 10_000);
    assert.ok(Math.abs(
      Date.parse(String(retentionResult.recoveryEvidenceCutoffAt))
        - (retentionNow - 90 * 24 * 60 * 60_000)
    ) < 10_000);
    assert.deepEqual(
      (await first.query<{ routeKey: string }>(
        `SELECT route_key AS "routeKey"
         FROM "${NATIVE_SCHEMA}"."operational_request_rollups"
         WHERE route_key LIKE 'native.retention.%' ORDER BY route_key`
      )).rows.map((row) => row.routeKey),
      ["native.retention.current_other", "native.retention.old_local"]
    );
    assert.deepEqual(
      (await first.query<{ id: string }>(
        `SELECT id FROM "${NATIVE_SCHEMA}"."operational_error_events"
         WHERE id LIKE 'native_retention_error_%' ORDER BY id`
      )).rows.map((row) => row.id),
      ["native_retention_error_current_other", "native_retention_error_old_local"]
    );
    assert.deepEqual(
      (await first.query<{ id: string }>(
        `SELECT id FROM "${NATIVE_SCHEMA}"."background_tasks"
         WHERE id LIKE 'native_retention_task_%' ORDER BY id`
      )).rows.map((row) => row.id),
      [
        "native_retention_task_current_terminal",
        "native_retention_task_old_dead_letter",
        "native_retention_task_old_terminal_local"
      ]
    );
    assert.equal(
      Number((await first.query<{ count: string | number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."background_task_events"
         WHERE id = 'native_retention_task_event_old'`
      )).rows[0]?.count),
      0
    );
    assert.deepEqual(
      (await first.query<{ id: string }>(
        `SELECT id FROM "${NATIVE_SCHEMA}"."observer_recipe_recovery_evidence"
         WHERE id LIKE 'native_retention_evidence_%' ORDER BY id`
      )).rows.map((row) => row.id),
      [
        "native_retention_evidence_local_eligible",
        "native_retention_evidence_other_fresh",
        "native_retention_evidence_other_recent_review"
      ]
    );
    assert.deepEqual(
      (await first.query<{ id: string }>(
        `SELECT id FROM "${NATIVE_SCHEMA}"."observer_recipe_recovery_reviews"
         WHERE id LIKE 'native_retention_review_%' ORDER BY id`
      )).rows.map((row) => row.id),
      ["native_retention_review_other_recent_review"]
    );
    assert.deepEqual(
      (await first.query<{
        createdByActorId: string;
        deletedEvidenceCount: string | number | bigint;
        deletedReviewEventCount: string | number | bigint;
      }>(
        `SELECT created_by_actor_id AS "createdByActorId",
                deleted_evidence_count AS "deletedEvidenceCount",
                deleted_review_event_count AS "deletedReviewEventCount"
         FROM "${NATIVE_SCHEMA}"."observer_recipe_recovery_retention_receipts"
         WHERE id = $1`,
        [retentionResult.recoveryEvidenceRetentionReceiptId]
      )).rows.map((row) => ({
        createdByActorId: row.createdByActorId,
        deletedEvidenceCount: Number(row.deletedEvidenceCount),
        deletedReviewEventCount: Number(row.deletedReviewEventCount)
      })),
      [{
        createdByActorId: NATIVE_PRINCIPAL_A,
        deletedEvidenceCount: 1,
        deletedReviewEventCount: 1
      }]
    );
    assert.deepEqual(
      (await first.query<{ auditCount: string | number | bigint; outboxCount: string | number | bigint }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
            WHERE correlation_id = $1) AS "auditCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
            WHERE aggregate_id = $1) AS "outboxCount"`,
        [retentionResult.recoveryEvidenceRetentionReceiptId]
      )).rows.map((row) => ({
        auditCount: Number(row.auditCount),
        outboxCount: Number(row.outboxCount)
      })),
      [{ auditCount: 1, outboxCount: 1 }]
    );

    const retentionReplay = await operationalRetentionA.prune(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      retentionNow
    );
    assert.equal(retentionReplay.deletedRollupRows, 0);
    assert.equal(retentionReplay.deletedErrorEvents, 0);
    assert.equal(retentionReplay.deletedTaskRuns, 0);
    assert.equal(retentionReplay.deletedRecoveryEvidence, 0);
    assert.equal(retentionReplay.deletedRecoveryReviewEvents, 0);
    assert.equal(retentionReplay.receiptId, "");
    assert.equal(retentionReplay.recoveryEvidenceRetentionReceiptId, "");
    await assert.rejects(
      operationalRetentionA.prune(
        { tenantId: "tenant_local", userId: "user_local" },
        retentionNow
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      operationalRetentionUnmapped.prune(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        retentionNow
      ),
      /tenant session principal is not active/
    );
    const crossTenantRetention = await operationalRetentionB.prune(
      { tenantId: "tenant_local", userId: "user_local" },
      retentionNow
    );
    assert.equal(crossTenantRetention.deletedRollupRows, 1);
    assert.equal(crossTenantRetention.deletedErrorEvents, 1);
    assert.equal(crossTenantRetention.deletedTaskRuns, 1);
    assert.equal(crossTenantRetention.deletedRecoveryEvidence, 1);
    assert.equal(crossTenantRetention.deletedRecoveryReviewEvents, 0);
    await assert.rejects(
      operationalRetentionA.prune(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        retentionNow - 600_000
      ),
      /cycle timestamp differs from the process clock/
    );
    operationalRetentionDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    operationalRetentionDirectClient.on("error", () => undefined);
    await operationalRetentionDirectClient.connect();
    await operationalRetentionDirectClient.query(
      `SET ROLE "${operationalRetentionManifest.operationalRetentionRole.name}"`
    );
    await assert.rejects(
      operationalRetentionDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."operational_error_events"`
      ),
      /permission denied/
    );
    await assert.rejects(
      operationalRetentionDirectClient.query(
        `DELETE FROM "${NATIVE_SCHEMA}"."background_tasks"`
      ),
      /permission denied/
    );
    await assert.rejects(
      operationalRetentionDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."yoink_recover_action_execution"($1, $2)`,
        [NATIVE_TENANT, NATIVE_USER]
      ),
      /permission denied/
    );
    await operationalRetentionDirectClient.end();
    operationalRetentionDirectClient = null;

    const contentionAt = new Date(retentionNow - 31 * 24 * 60 * 60_000).toISOString();
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."operational_error_events"(
         id, tenant_id, correlation_key, route_key, method, actor_kind,
         status_code, error_code, duration_ms, privacy_classification, occurred_at
       ) VALUES ('native_retention_error_contention', $1,
                 'native-retention-correlation-contention', 'native.retention.contention',
                 'GET', 'service', 500, 'native_retention_error', 10,
                 'operational_aggregate', $2)`,
      [NATIVE_TENANT, contentionAt]
    );
    const concurrentRetention = await Promise.all([
      operationalRetentionA.prune(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        retentionNow
      ),
      operationalRetentionA.prune(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        retentionNow
      )
    ]);
    assert.equal(
      concurrentRetention.reduce((sum, result) => sum + result.deletedErrorEvents, 0),
      1
    );
    assert.ok(concurrentRetention.every((result) => result.deletedRollupRows === 0
      && result.deletedTaskRuns === 0 && result.deletedRecoveryEvidence === 0));

    const candidateNow = Date.now();
    await insertObserverCandidateFixtures(first, candidateNow);
    observerCandidateHandlerDb = new YoinkDatabase();
    const observerCandidateHandler = new BackgroundMaintenanceHandler(
      observerCandidateHandlerDb,
      { observerRecipeCandidateEvaluation: observerCandidateA }
    );
    const observerCandidateContext: BackgroundWorkerContext = {
      ...workerContext("native_observer_candidate_handler"),
      runtimeVersion: "0.68.0"
    };
    const candidateResult = await observerCandidateHandler.execute(
      observerCandidateContext,
      "observer_recipe_candidate_evaluation",
      candidateNow
    );
    assert.deepEqual(candidateResult, {
      repairGroupsEvaluated: 3,
      matureRepairGroups: 1,
      unsupportedMatureSelectors: 1,
      selectorsEvaluated: 2,
      candidateFieldsEvaluated: 2,
      supportedRepairFields: 5,
      candidatesCreated: 1,
      candidatesReused: 0,
      candidatesDeferred: 0,
      expiredCandidates: 0,
      reviewedCandidates: 0,
      generatedCandidateLifetimeDays: 30,
      mutationAuthority: false,
      generatedCandidatesExecutable: false
    });
    const generatedCandidates = await first.query<{
      id: string;
      tenantId: string;
      userId: string;
      retailerId: string;
      recipeVersion: string;
      minimumExtensionVersion: string;
      recipeJson: string;
      recipeFingerprint: string;
      lifecycleState: string;
      provenanceCode: string;
      signatureKeyId: string;
      signature: string;
      signedAt: string;
      expiresAt: string;
      killSwitch: string | number | bigint;
      trustManifestGeneration: string | number | bigint;
    }>(
      `SELECT id, tenant_id AS "tenantId", user_id AS "userId",
              retailer_id AS "retailerId", recipe_version AS "recipeVersion",
              minimum_extension_version AS "minimumExtensionVersion",
              recipe_json AS "recipeJson", recipe_fingerprint AS "recipeFingerprint",
              lifecycle_state AS "lifecycleState", provenance_code AS "provenanceCode",
              signature_key_id AS "signatureKeyId", signature, signed_at AS "signedAt",
              expires_at AS "expiresAt", kill_switch AS "killSwitch",
              trust_manifest_generation AS "trustManifestGeneration"
       FROM "${NATIVE_SCHEMA}"."observer_recipe_candidates"
       WHERE tenant_id = $1 AND user_id = $2
         AND minimum_extension_version = '0.68.0'
         AND provenance_code = 'privacy_bounded_repair_miner'
       ORDER BY id`,
      [NATIVE_TENANT, NATIVE_USER]
    );
    assert.equal(generatedCandidates.rows.length, 1);
    const generatedCandidate = generatedCandidates.rows[0];
    assert.ok(generatedCandidate);
    assert.equal(generatedCandidate.tenantId, NATIVE_TENANT);
    assert.equal(generatedCandidate.userId, NATIVE_USER);
    assert.equal(generatedCandidate.retailerId, "target");
    assert.match(generatedCandidate.recipeVersion, /^target-repair-[a-f0-9]{12}$/);
    assert.match(generatedCandidate.recipeFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(generatedCandidate.recipeJson), {
      availability: {
        mode: "text",
        selectors: ["div[data-testid='availability-status']"]
      },
      unitPrice: {
        mode: "text",
        selectors: ["span[data-testid='customer-price']"]
      }
    });
    assert.equal(generatedCandidate.lifecycleState, "quarantined");
    assert.equal(generatedCandidate.provenanceCode, "privacy_bounded_repair_miner");
    assert.equal(generatedCandidate.signatureKeyId, "");
    assert.equal(generatedCandidate.signature, "");
    assert.equal(generatedCandidate.signedAt, "");
    assert.equal(Number(generatedCandidate.killSwitch), 0);
    assert.equal(Number(generatedCandidate.trustManifestGeneration), 0);
    assert.ok(Math.abs(
      Date.parse(generatedCandidate.expiresAt)
        - (candidateNow + 30 * 24 * 60 * 60_000)
    ) < 10_000);
    assert.deepEqual(
      (await first.query<{
        lifecycleCount: string | number | bigint;
        auditCount: string | number | bigint;
        outboxCount: string | number | bigint;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."observer_recipe_lifecycle_events"
            WHERE recipe_id = $1 AND from_state = '' AND to_state = 'quarantined'
              AND reason_code = 'privacy_bounded_repair_candidate_generated') AS "lifecycleCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
            WHERE correlation_id = $1 AND event_type = 'observer_recipe_repair_candidate_generated'
              AND reason_code = 'quarantined') AS "auditCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
            WHERE aggregate_id = $1 AND aggregate_type = 'observer_recipe'
              AND event_type = 'observer_recipe_repair_candidate_generated') AS "outboxCount"`,
        [generatedCandidate.id]
      )).rows.map((row) => ({
        lifecycleCount: Number(row.lifecycleCount),
        auditCount: Number(row.auditCount),
        outboxCount: Number(row.outboxCount)
      })),
      [{ lifecycleCount: 1, auditCount: 1, outboxCount: 1 }]
    );

    const candidateReplay = await observerCandidateA.evaluate(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      "0.68.0",
      candidateNow
    );
    assert.equal(candidateReplay.candidatesCreated, 0);
    assert.equal(candidateReplay.candidatesReused, 1);
    await assert.rejects(
      observerCandidateA.evaluate(
        { tenantId: "tenant_local", userId: "user_local" },
        "0.68.0",
        candidateNow
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      observerCandidateUnmapped.evaluate(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "0.68.0",
        candidateNow
      ),
      /tenant session principal is not active/
    );
    const localCandidate = await observerCandidateB.evaluate(
      { tenantId: "tenant_local", userId: "user_local" },
      "0.68.0",
      candidateNow
    );
    assert.equal(localCandidate.repairGroupsEvaluated, 1);
    assert.equal(localCandidate.matureRepairGroups, 1);
    assert.equal(localCandidate.candidatesCreated, 1);
    assert.equal(localCandidate.candidatesReused, 0);
    await assert.rejects(
      observerCandidateA.evaluate(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "0.68.0",
        candidateNow - 600_000
      ),
      /cycle timestamp differs from the process clock/
    );

    observerCandidateDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    observerCandidateDirectClient.on("error", () => undefined);
    await observerCandidateDirectClient.connect();
    await observerCandidateDirectClient.query(
      `SET ROLE "${observerCandidateManifest.observerCandidateRole.name}"`
    );
    await assert.rejects(
      observerCandidateDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."retailer_adapter_diagnostics"`
      ),
      /permission denied/
    );
    await assert.rejects(
      observerCandidateDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."observer_recipe_candidates"(
           id, tenant_id, user_id, retailer_id, recipe_version,
           minimum_extension_version, recipe_json, recipe_fingerprint,
           lifecycle_state, provenance_code, expires_at, created_at, updated_at
         ) VALUES ('forbidden', $1, $2, 'target', 'forbidden', '0.68.0',
                   '{}', $3, 'quarantined', 'forbidden', $4, $4, $4)`,
        [NATIVE_TENANT, NATIVE_USER, "f".repeat(64), new Date(candidateNow).toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      observerCandidateDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."yoink_apply_operational_retention"($1, $2)`,
        [NATIVE_TENANT, NATIVE_USER]
      ),
      /permission denied/
    );
    await assert.rejects(
      observerCandidateDirectClient.query(
        `SELECT result_json FROM "${NATIVE_SCHEMA}"."yoink_evaluate_observer_repair_candidates"(
           $1, $2, '0.68.0', 'plan', '', '[]'
         )`,
        ["tenant_local", "user_local"]
      ),
      /does not match the expected authenticated principal/
    );
    const directPlan = await observerCandidateDirectClient.query<{ result_json: string }>(
      `SELECT result_json FROM "${NATIVE_SCHEMA}"."yoink_evaluate_observer_repair_candidates"(
         $1, $2, '0.68.0', 'plan', '', '[]'
       )`,
      [NATIVE_TENANT, NATIVE_USER]
    );
    const directPlanTimestamp = String(
      (JSON.parse(String(directPlan.rows[0]?.result_json)) as Record<string, unknown>)
        .evaluationTimestamp
    );
    await assert.rejects(
      observerCandidateDirectClient.query(
        `SELECT result_json FROM "${NATIVE_SCHEMA}"."yoink_evaluate_observer_repair_candidates"(
           $1, $2, '0.68.0', 'apply', $3, '[]'
         )`,
        [NATIVE_TENANT, NATIVE_USER, directPlanTimestamp]
      ),
      /apply set does not match its evidence plan/
    );
    await observerCandidateDirectClient.end();
    observerCandidateDirectClient = null;

    await insertObserverCandidateGroup(first, {
      prefix: "native_candidate_contention",
      tenantId: NATIVE_TENANT,
      userId: NATIVE_USER,
      deviceIds: [1, 2, 3].map((index) => `native_candidate_device_other_${index}`),
      layoutFingerprint: "5".repeat(64),
      now: candidateNow + 1_000
    });
    const concurrentCandidates = await Promise.all([
      observerCandidateA.evaluate(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "0.68.0"
      ),
      observerCandidateA.evaluate(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "0.68.0"
      )
    ]);
    assert.equal(
      concurrentCandidates.reduce((sum, result) => sum + result.candidatesCreated, 0),
      1
    );
    assert.ok(concurrentCandidates.every((result) => result.matureRepairGroups === 2
      && result.candidatesCreated + result.candidatesReused === 2));
    assert.equal(
      Number((await first.query<{ count: string | number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."observer_recipe_candidates"
         WHERE tenant_id = $1 AND user_id = $2
           AND minimum_extension_version = '0.68.0'
           AND provenance_code = 'privacy_bounded_repair_miner'`,
        [NATIVE_TENANT, NATIVE_USER]
      )).rows[0]?.count),
      2
    );

    const alertNow = Date.now();
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"(
         principal_role, tenant_id, user_id, active, provisioned_at
       ) VALUES ($1, $2, $3, TRUE, $4)`,
      [NATIVE_PRINCIPAL_C, NATIVE_TENANT, NATIVE_SAME_TENANT_USER,
        new Date(alertNow - 5_000).toISOString()]
    );
    const concurrentDeliveryId = await insertOperatorAlertDispatchFixture(
      first,
      "concurrent",
      NATIVE_USER,
      alertNow
    );
    const peerDeliveryId = await insertOperatorAlertDispatchFixture(
      first,
      "peer",
      NATIVE_SAME_TENANT_USER,
      alertNow
    );
    const exhaustedDeliveryId = await insertOperatorAlertDispatchFixture(
      first,
      "exhausted",
      NATIVE_USER,
      alertNow,
      true
    );
    assert.equal(
      await alertDispatchA.expireExhaustedLeases(NATIVE_ALERT_REGISTRY.bindings, alertNow),
      1
    );
    assert.deepEqual(
      (await first.query<{ id: string; state: string }>(
        `SELECT id, state FROM "${NATIVE_SCHEMA}"."operator_alert_connector_deliveries"
         WHERE id IN ($1, $2, $3) ORDER BY id`,
        [concurrentDeliveryId, peerDeliveryId, exhaustedDeliveryId]
      )).rows,
      [
        { id: concurrentDeliveryId, state: "pending" },
        { id: exhaustedDeliveryId, state: "dead_letter" },
        { id: peerDeliveryId, state: "pending" }
      ]
    );
    const competingLeases = await Promise.all([
      alertDispatchA.leaseNext(NATIVE_ALERT_REGISTRY.bindings, 60, alertNow),
      alertDispatchASecond.leaseNext(NATIVE_ALERT_REGISTRY.bindings, 60, alertNow)
    ]);
    const claimed = competingLeases.filter((lease) => lease !== null);
    assert.equal(claimed.length, 1);
    const claimedLease = claimed[0];
    assert.ok(claimedLease);
    assert.equal(claimedLease.id, concurrentDeliveryId);
    assert.equal(claimedLease.attempt, 1);
    assert.match(claimedLease.capabilityToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(claimedLease.payload.incidentId, "native_alert_incident_concurrent");
    await assert.rejects(
      alertDispatchA.complete(
        claimedLease.id,
        `${claimedLease.capabilityToken}x`,
        "webhook_accepted",
        202,
        alertNow
      ),
      /capability is invalid or expired/
    );
    assert.equal(await alertDispatchA.complete(
      claimedLease.id,
      claimedLease.capabilityToken,
      "webhook_accepted",
      202,
      alertNow
    ), true);
    const peerLease = await alertDispatchC.leaseNext(
      NATIVE_ALERT_REGISTRY.bindings,
      60,
      alertNow
    );
    assert.ok(peerLease);
    assert.equal(peerLease.id, peerDeliveryId);
    assert.equal(await alertDispatchC.complete(
      peerLease.id,
      peerLease.capabilityToken,
      "webhook_accepted",
      204,
      alertNow
    ), true);
    assert.equal(
      await alertDispatchB.leaseNext(NATIVE_ALERT_REGISTRY.bindings, 60, alertNow),
      null
    );
    await assert.rejects(
      alertDispatchUnmapped.leaseNext(NATIVE_ALERT_REGISTRY.bindings, 60, alertNow),
      /tenant session principal is not active/
    );

    const serviceDeliveryId = await insertOperatorAlertDispatchFixture(
      first,
      "service",
      NATIVE_USER,
      alertNow + 1_000
    );
    const serviceResult = await new OperatorAlertConnectorDispatchService(
      alertDispatchA,
      NATIVE_ALERT_REGISTRY,
      {
        async deliver() {
          return {
            disposition: "delivered",
            reasonCode: "webhook_accepted",
            httpStatus: 202
          };
        }
      }
    ).execute(alertNow + 1_000);
    assert.deepEqual(serviceResult, {
      connectorRegistryConfigured: true,
      connectorTransportConfigured: true,
      connectorDeliveriesAttempted: 1,
      connectorDeliveriesSucceeded: 1,
      connectorDeliveriesRetried: 0,
      connectorDeliveriesDeadLettered: 0
    });
    assert.equal(
      (await first.query<{ state: string }>(
        `SELECT state FROM "${NATIVE_SCHEMA}"."operator_alert_connector_deliveries" WHERE id = $1`,
        [serviceDeliveryId]
      )).rows[0]?.state,
      "delivered"
    );
    const retryAt = Date.now();
    const retryDeliveryId = await insertOperatorAlertDispatchFixture(
      first,
      "retry",
      NATIVE_USER,
      retryAt
    );
    const initialRetryLease = await alertDispatchA.leaseNext(
      NATIVE_ALERT_REGISTRY.bindings,
      60,
      retryAt
    );
    assert.ok(initialRetryLease);
    assert.equal(initialRetryLease.id, retryDeliveryId);
    assert.equal(await alertDispatchA.fail(
      initialRetryLease.id,
      initialRetryLease.capabilityToken,
      "webhook_retryable_status",
      503,
      1,
      false,
      retryAt
    ), "retry");
    await new Promise<void>((resolve) => setTimeout(resolve, 1_200));
    const retriedLease = await alertDispatchA.leaseNext(
      NATIVE_ALERT_REGISTRY.bindings,
      60,
      Date.now()
    );
    assert.ok(retriedLease);
    assert.equal(retriedLease.id, retryDeliveryId);
    assert.equal(retriedLease.attempt, 2);
    assert.equal(await alertDispatchA.fail(
      retriedLease.id,
      retriedLease.capabilityToken,
      "webhook_rejected",
      422,
      30,
      true,
      Date.now()
    ), "dead_letter");

    alertDispatchDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    alertDispatchDirectClient.on("error", () => undefined);
    await alertDispatchDirectClient.connect();
    await alertDispatchDirectClient.query(
      `SET ROLE "${alertDispatchManifest.alertDispatchRole.name}"`
    );
    await assert.rejects(
      alertDispatchDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."operator_alert_connector_deliveries"`
      ),
      /permission denied/
    );
    await assert.rejects(
      alertDispatchDirectClient.query(
        `UPDATE "${NATIVE_SCHEMA}"."operator_alert_connector_deliveries"
         SET state = 'dead_letter' WHERE id = $1`,
        [concurrentDeliveryId]
      ),
      /permission denied/
    );
    await assert.rejects(
      alertDispatchDirectClient.query(
        `SELECT result_json FROM "${NATIVE_SCHEMA}"."yoink_dispatch_operator_alert_connector"(
           $1, $2, '0.69.0', 'expire', '{}', '', '', '', '', '', '', ''
         )`,
        [NATIVE_TENANT, NATIVE_SAME_TENANT_USER]
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      alertDispatchDirectClient.query(
        `SELECT * FROM "${NATIVE_SCHEMA}"."yoink_evaluate_observer_repair_candidates"(
           $1, $2, '0.69.0', 'plan', '', '[]'
         )`,
        [NATIVE_TENANT, NATIVE_USER]
      ),
      /permission denied/
    );
    await alertDispatchDirectClient.end();
    alertDispatchDirectClient = null;

    const reconciliationNow = Date.now();
    const reconciliationLayout = "6".repeat(64);
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."operator_alert_rules"
       SET enabled = 0 WHERE tenant_id = $1`,
      [NATIVE_TENANT]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."operator_alert_rules"(
         id, tenant_id, event_family, name, enabled, severity,
         minimum_occurrences, dedupe_window_seconds, escalation_after_seconds,
         retailer_scope, operation_scope, routes_json, privacy_classification,
         created_by_actor_id, updated_by_actor_id, created_at, updated_at
       ) VALUES ('native_alert_reconciliation_rule', $1, 'adapter_repair',
                 'Native Amazon reconciliation', 1, 'warning', 2, 60, 300,
                 'amazon', 'observe', '["dashboard","audit_outbox"]',
                 'operational_configuration', 'native_fixture', 'native_fixture', $2, $2)`,
      [NATIVE_TENANT, new Date(reconciliationNow - 500_000).toISOString()]
    );
    await first.query(
      `INSERT INTO "${NATIVE_SCHEMA}"."extension_devices"(
         id, tenant_id, user_id, name, token_hash, extension_version,
         status, capabilities_json, last_seen_at, created_at, updated_at,
         credential_generation, credential_issued_at
       ) VALUES ('native_alert_peer_device', $1, $2, 'Native alert peer device',
                 $3, '0.70.0', 'active', '{}', $4, $4, $4, 1, $4)`,
      [
        NATIVE_TENANT,
        NATIVE_SAME_TENANT_USER,
        "e".repeat(64),
        new Date(reconciliationNow - 500_000).toISOString()
      ]
    );
    for (const [index, sku] of ["B0AAAA0001", "B0AAAA0002"].entries()) {
      await insertOperatorAlertReconciliationDiagnostic(first, {
        id: `native_alert_reconciliation_failure_${index + 1}`,
        tenantId: NATIVE_TENANT,
        userId: NATIVE_USER,
        deviceId: `native_candidate_device_other_${index + 1}`,
        retailerSku: sku,
        layoutFingerprint: reconciliationLayout,
        receivedAt: new Date(reconciliationNow - 400_000 + index * 1_000).toISOString()
      });
    }
    for (const [index, sku] of ["B0PEER0001", "B0PEER0002"].entries()) {
      await insertOperatorAlertReconciliationDiagnostic(first, {
        id: `native_alert_reconciliation_peer_failure_${index + 1}`,
        tenantId: NATIVE_TENANT,
        userId: NATIVE_SAME_TENANT_USER,
        deviceId: "native_alert_peer_device",
        retailerSku: sku,
        layoutFingerprint: "7".repeat(64),
        receivedAt: new Date(reconciliationNow - 400_000 + index * 1_000).toISOString()
      });
    }

    alertReconciliationHandlerDb = new YoinkDatabase();
    const alertReconciliationHandler = new BackgroundMaintenanceHandler(
      alertReconciliationHandlerDb,
      {
        operatorAlertReconciliation: new OperatorAlertReconciliationService(
          alertReconciliationA
        )
      }
    );
    const alertReconciliationContext: BackgroundWorkerContext = {
      ...workerContext("native_alert_reconciliation_handler"),
      runtimeVersion: "0.70.0"
    };
    const openedAlert = await alertReconciliationHandler.execute(
      alertReconciliationContext,
      "adapter_alert_reconciliation",
      reconciliationNow
    );
    assert.equal(openedAlert.opened, 1);
    assert.equal(openedAlert.updated, 0);
    assert.equal(openedAlert.resolved, 0);
    assert.equal(openedAlert.escalated, 1);
    assert.equal(openedAlert.routed, 4);
    assert.equal(openedAlert.connectorDeliveriesAttempted, 0);
    assert.deepEqual(
      (await first.query<{
        subjectUserId: string;
        severity: string;
        status: string;
        occurrenceCount: string | number | bigint;
        affectedEntityCount: string | number | bigint;
      }>(
        `SELECT subject_user_id AS "subjectUserId", severity, status,
                occurrence_count AS "occurrenceCount",
                affected_entity_count AS "affectedEntityCount"
         FROM "${NATIVE_SCHEMA}"."operator_alert_incidents"
         WHERE rule_id = 'native_alert_reconciliation_rule'
         ORDER BY created_at, id`
      )).rows.map((row) => ({
        subjectUserId: row.subjectUserId,
        severity: row.severity,
        status: row.status,
        occurrenceCount: Number(row.occurrenceCount),
        affectedEntityCount: Number(row.affectedEntityCount)
      })),
      [{
        subjectUserId: NATIVE_USER,
        severity: "error",
        status: "open",
        occurrenceCount: 2,
        affectedEntityCount: 2
      }]
    );
    const firstReconciliationIncident = (await first.query<{ id: string }>(
      `SELECT id FROM "${NATIVE_SCHEMA}"."operator_alert_incidents"
       WHERE rule_id = 'native_alert_reconciliation_rule' AND subject_user_id = $1
       ORDER BY created_at, id LIMIT 1`,
      [NATIVE_USER]
    )).rows[0]?.id;
    assert.ok(firstReconciliationIncident);
    assert.deepEqual(
      (await first.query<{ eventType: string; severity: string }>(
        `SELECT event_type AS "eventType", severity
         FROM "${NATIVE_SCHEMA}"."operator_alert_events"
         WHERE incident_id = $1
         ORDER BY CASE event_type WHEN 'opened' THEN 1 WHEN 'escalated' THEN 2 ELSE 3 END, id`,
        [firstReconciliationIncident]
      )).rows,
      [
        { eventType: "opened", severity: "warning" },
        { eventType: "escalated", severity: "error" }
      ]
    );
    assert.deepEqual(
      (await first.query<{
        auditCount: string | number | bigint;
        outboxCount: string | number | bigint;
        routeCount: string | number | bigint;
        connectorCount: string | number | bigint;
        connectorEventCount: string | number | bigint;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
            WHERE data_json::jsonb->>'incidentId' = $1) AS "auditCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
            WHERE payload_json::jsonb->'data'->>'incidentId' = $1) AS "outboxCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."operator_alert_deliveries"
            WHERE incident_id = $1) AS "routeCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."operator_alert_connector_deliveries"
            WHERE incident_id = $1) AS "connectorCount",
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."operator_alert_connector_delivery_events" AS event
            JOIN "${NATIVE_SCHEMA}"."operator_alert_connector_deliveries" AS delivery
              ON delivery.id = event.delivery_id WHERE delivery.incident_id = $1) AS "connectorEventCount"`,
        [firstReconciliationIncident]
      )).rows.map((row) => ({
        auditCount: Number(row.auditCount),
        outboxCount: Number(row.outboxCount),
        routeCount: Number(row.routeCount),
        connectorCount: Number(row.connectorCount),
        connectorEventCount: Number(row.connectorEventCount)
      })),
      [{
        auditCount: 2,
        outboxCount: 2,
        routeCount: 4,
        connectorCount: 2,
        connectorEventCount: 2
      }]
    );
    assert.equal(
      JSON.stringify((await first.query(
        `SELECT endpoint_reference, payload_json
         FROM "${NATIVE_SCHEMA}"."operator_alert_connector_deliveries"
         WHERE incident_id = $1`,
        [firstReconciliationIncident]
      )).rows).includes("https://"),
      false
    );

    assert.deepEqual(
      await alertReconciliationA.reconcile(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "0.70.0",
        reconciliationNow
      ),
      { opened: 0, updated: 0, resolved: 0, escalated: 0, routed: 0 }
    );
    const repeatedNow = Date.now();
    await insertOperatorAlertReconciliationDiagnostic(first, {
      id: "native_alert_reconciliation_failure_3",
      tenantId: NATIVE_TENANT,
      userId: NATIVE_USER,
      deviceId: "native_candidate_device_other_3",
      retailerSku: "B0AAAA0003",
      layoutFingerprint: reconciliationLayout,
      receivedAt: new Date(repeatedNow - 1_000).toISOString()
    });
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."operator_alert_incidents"
       SET last_routed_at = $1 WHERE id = $2`,
      [new Date(repeatedNow - 120_000).toISOString(), firstReconciliationIncident]
    );
    assert.deepEqual(
      await alertReconciliationA.reconcile(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "0.70.0",
        repeatedNow
      ),
      { opened: 0, updated: 1, resolved: 0, escalated: 0, routed: 2 }
    );

    const recoveredNow = Date.now();
    await insertOperatorAlertReconciliationDiagnostic(first, {
      id: "native_alert_reconciliation_recovered",
      tenantId: NATIVE_TENANT,
      userId: NATIVE_USER,
      deviceId: "native_candidate_device_other_1",
      retailerSku: "B0AAAA0001",
      layoutFingerprint: reconciliationLayout,
      receivedAt: new Date(recoveredNow - 1).toISOString(),
      outcome: "recovered"
    });
    assert.deepEqual(
      await alertReconciliationA.reconcile(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "0.70.0",
        recoveredNow
      ),
      { opened: 0, updated: 0, resolved: 1, escalated: 0, routed: 2 }
    );
    assert.deepEqual(
      (await first.query<{
        occurrenceCount: string | number | bigint;
        affectedEntityCount: string | number | bigint;
      }>(
        `SELECT delivery.payload_json::jsonb->>'occurrenceCount' AS "occurrenceCount",
                delivery.payload_json::jsonb->>'affectedEntityCount' AS "affectedEntityCount"
         FROM "${NATIVE_SCHEMA}"."operator_alert_connector_deliveries" AS delivery
         JOIN "${NATIVE_SCHEMA}"."operator_alert_events" AS event
           ON event.id = delivery.event_id
         WHERE delivery.incident_id = $1 AND event.event_type = 'auto_resolved'`,
        [firstReconciliationIncident]
      )).rows.map((row) => ({
        occurrenceCount: Number(row.occurrenceCount),
        affectedEntityCount: Number(row.affectedEntityCount)
      })),
      [{ occurrenceCount: 3, affectedEntityCount: 3 }]
    );
    assert.deepEqual(
      await alertReconciliationA.reconcile(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "0.70.0",
        recoveredNow
      ),
      { opened: 0, updated: 0, resolved: 0, escalated: 0, routed: 0 }
    );

    const reopenedNow = Date.now();
    await insertOperatorAlertReconciliationDiagnostic(first, {
      id: "native_alert_reconciliation_failure_reopened",
      tenantId: NATIVE_TENANT,
      userId: NATIVE_USER,
      deviceId: "native_candidate_device_other_2",
      retailerSku: "B0AAAA0004",
      layoutFingerprint: reconciliationLayout,
      receivedAt: new Date(reopenedNow).toISOString()
    });
    const reopened = await alertReconciliationA.reconcile(
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
      "0.70.0",
      reopenedNow
    );
    assert.equal(reopened.opened, 1);
    assert.equal(reopened.escalated, 1);
    assert.equal(reopened.routed, 4);

    const contentionNow = Date.now();
    const contentionLayout = "8".repeat(64);
    for (const [index, sku] of ["B0RACE0001", "B0RACE0002"].entries()) {
      await insertOperatorAlertReconciliationDiagnostic(first, {
        id: `native_alert_reconciliation_contention_${index + 1}`,
        tenantId: NATIVE_TENANT,
        userId: NATIVE_USER,
        deviceId: `native_candidate_device_other_${index + 1}`,
        retailerSku: sku,
        layoutFingerprint: contentionLayout,
        receivedAt: new Date(contentionNow - 2_000 + index).toISOString()
      });
    }
    const concurrentReconciliation = await Promise.all([
      alertReconciliationA.reconcile(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "0.70.0",
        contentionNow
      ),
      alertReconciliationASecond.reconcile(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "0.70.0",
        contentionNow
      )
    ]);
    assert.equal(
      concurrentReconciliation.reduce((sum, result) => sum + result.opened, 0),
      1
    );
    assert.equal(
      concurrentReconciliation.reduce((sum, result) => sum + result.routed, 0),
      2
    );
    assert.equal(
      Number((await first.query<{ count: string | number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."operator_alert_incidents"
         WHERE tenant_id = $1 AND subject_user_id = $2
           AND rule_id = 'native_alert_reconciliation_rule'
           AND layout_fingerprint = $3 AND status IN ('open', 'acknowledged')`,
        [NATIVE_TENANT, NATIVE_USER, contentionLayout]
      )).rows[0]?.count),
      1
    );

    const peerResult = await alertReconciliationC.reconcile(
      { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
      "0.70.0",
      reconciliationNow
    );
    assert.equal(peerResult.opened, 1);
    assert.equal(peerResult.escalated, 1);
    assert.equal(
      Number((await first.query<{ count: string | number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."operator_alert_incidents"
         WHERE tenant_id = $1 AND subject_user_id = $2
           AND rule_id = 'native_alert_reconciliation_rule'`,
        [NATIVE_TENANT, NATIVE_SAME_TENANT_USER]
      )).rows[0]?.count),
      1
    );
    await assert.rejects(
      alertReconciliationA.reconcile(
        { tenantId: "tenant_local", userId: "user_local" },
        "0.70.0",
        reconciliationNow
      ),
      /principal changed after construction/
    );
    await assert.rejects(
      alertReconciliationUnmapped.reconcile(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "0.70.0",
        reconciliationNow
      ),
      /tenant session principal is not active/
    );
    const otherTenantIncidentCount = Number((await first.query<{ count: string | number | bigint }>(
      `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."operator_alert_incidents"
       WHERE tenant_id = 'tenant_local'`
    )).rows[0]?.count);
    await alertReconciliationB.reconcile(
      { tenantId: "tenant_local", userId: "user_local" },
      "0.70.0",
      reconciliationNow
    );
    assert.ok(Number((await first.query<{ count: string | number | bigint }>(
      `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."operator_alert_incidents"
       WHERE tenant_id = 'tenant_local'`
    )).rows[0]?.count) >= otherTenantIncidentCount);

    alertReconciliationDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    alertReconciliationDirectClient.on("error", () => undefined);
    await alertReconciliationDirectClient.connect();
    await alertReconciliationDirectClient.query(
      `SET ROLE "${alertReconciliationManifest.alertReconciliationRole.name}"`
    );
    await assert.rejects(
      alertReconciliationDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."retailer_adapter_diagnostics"`
      ),
      /permission denied/
    );
    await assert.rejects(
      alertReconciliationDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."operator_alert_incidents"(
           id, tenant_id, subject_user_id, rule_id, event_family, incident_key_hash,
           severity, status, privacy_classification, title, summary, retailer_id,
           operation, failure_stage, reason_code, layout_fingerprint,
           occurrence_count, affected_entity_count, first_seen_at, last_seen_at,
           last_failure_at, created_at, updated_at
         ) VALUES ('forbidden', $1, $2, 'native_alert_reconciliation_rule',
                   'adapter_repair', $3, 'warning', 'open', 'operational_aggregate',
                   'forbidden', 'forbidden', 'amazon', 'observe', 'runner',
                   'forbidden', $3, 1, 1, $4, $4, $4, $4, $4)`,
        [NATIVE_TENANT, NATIVE_USER, "f".repeat(64), new Date(reconciliationNow).toISOString()]
      ),
      /permission denied/
    );
    await assert.rejects(
      alertReconciliationDirectClient.query(
        `SELECT result_json FROM "${NATIVE_SCHEMA}"."yoink_reconcile_operator_alerts"(
           $1, $2, '0.70.0', 'plan', '', $3, '[]'
         )`,
        [NATIVE_TENANT, NATIVE_SAME_TENANT_USER, `alertcorr_${"a".repeat(48)}`]
      ),
      /does not match the expected authenticated principal/
    );
    const directRevalidationNow = Date.now();
    const directRevalidationLayout = "9".repeat(64);
    for (const [index, sku] of ["B0PLAN0001", "B0PLAN0002"].entries()) {
      await insertOperatorAlertReconciliationDiagnostic(first, {
        id: `native_alert_reconciliation_direct_plan_${index + 1}`,
        tenantId: NATIVE_TENANT,
        userId: NATIVE_USER,
        deviceId: `native_candidate_device_other_${index + 1}`,
        retailerSku: sku,
        layoutFingerprint: directRevalidationLayout,
        receivedAt: new Date(directRevalidationNow - 2_000 + index).toISOString()
      });
    }
    const directCorrelation = `alertcorr_${"b".repeat(48)}`;
    const directReconciliationPlan = await alertReconciliationDirectClient.query<{ result_json: string }>(
      `SELECT result_json FROM "${NATIVE_SCHEMA}"."yoink_reconcile_operator_alerts"(
         $1, $2, '0.70.0', 'plan', '', $3, '[]'
       )`,
      [NATIVE_TENANT, NATIVE_USER, directCorrelation]
    );
    const directPlanPayload = JSON.parse(String(directReconciliationPlan.rows[0]?.result_json)) as {
      evaluationTimestamp: string;
      selectedActions: Array<{ layoutFingerprint: string }>;
    };
    assert.ok(directPlanPayload.selectedActions.some(
      (action) => action.layoutFingerprint === directRevalidationLayout
    ));
    await assert.rejects(
      alertReconciliationDirectClient.query(
        `SELECT result_json FROM "${NATIVE_SCHEMA}"."yoink_reconcile_operator_alerts"(
           $1, $2, '0.70.0', 'apply', $3, $4, '[]'
         )`,
        [
          NATIVE_TENANT,
          NATIVE_USER,
          directPlanPayload.evaluationTimestamp,
          directCorrelation
        ]
      ),
      /apply set does not match its evidence plan/
    );
    assert.equal(
      Number((await first.query<{ count: string | number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."operator_alert_incidents"
         WHERE tenant_id = $1 AND subject_user_id = $2 AND layout_fingerprint = $3`,
        [NATIVE_TENANT, NATIVE_USER, directRevalidationLayout]
      )).rows[0]?.count),
      0
    );
    await assert.rejects(
      alertReconciliationDirectClient.query(
        `SELECT result_json FROM "${NATIVE_SCHEMA}"."yoink_dispatch_operator_alert_connector"(
           $1, $2, '0.70.0', 'expire', '{}', '', '', '', '', '', '', ''
         )`,
        [NATIVE_TENANT, NATIVE_USER]
      ),
      /permission denied/
    );
    await alertReconciliationDirectClient.end();
    alertReconciliationDirectClient = null;

    observerWitnessHandlerDb = new YoinkDatabase();
    const observerWitnessService = new PrincipalBoundObserverRecipeWitnessRefreshService(
      {
        forPrincipal(principal, runtimeVersion) {
          assert.deepEqual(principal, { tenantId: NATIVE_TENANT, userId: NATIVE_USER });
          assert.equal(runtimeVersion, "0.71.0");
          return observerWitnessA!;
        }
      },
      observerWitnessPublisher
    );
    const observerWitnessHandler = new BackgroundMaintenanceHandler(
      observerWitnessHandlerDb,
      { principalBoundObserverRecipeWitnessRefresh: observerWitnessService }
    );
    const observerWitnessContext: BackgroundWorkerContext = {
      ...workerContext("native_observer_witness_handler"),
      runtimeVersion: "0.71.0"
    };
    const observerWitnessNow = Date.now() - 30_000;
    let initialObserverWitnessResult: Awaited<ReturnType<BackgroundMaintenanceHandler["execute"]>>;
    try {
      initialObserverWitnessResult = await observerWitnessHandler.execute(
        observerWitnessContext,
        "observer_recipe_witness_refresh",
        observerWitnessNow
      );
    } catch (error) {
      let rootCause: unknown = error;
      while (rootCause instanceof Error && rootCause.cause !== undefined) {
        rootCause = rootCause.cause;
      }
      throw rootCause;
    }
    assert.deepEqual(
      initialObserverWitnessResult,
      {
        witnessConfigured: true,
        checkpointReady: true,
        refreshAttempted: true,
        receiptAccepted: true,
        deliveryAllowed: true,
        witnessState: "healthy",
        witnessSequence: 1
      }
    );
    assert.equal(observerWitnessPublishCalls, 1);
    const scopedObserverWitnessLogId = observerRecipeWitnessScopedLogId(
      observerWitnessVerifier.logId,
      NATIVE_TENANT
    );
    const firstWitnessEvidence = (await first.query<{
      logId: string;
      witnessKeyId: string;
      witnessSequence: string | number | bigint;
      manifestHash: string;
      transparencyEventHash: string;
      checkedByActorId: string;
      outcome: string;
      reasonCode: string;
      receiptCount: string | number | bigint;
      checkCount: string | number | bigint;
      auditCount: string | number | bigint;
      outboxCount: string | number | bigint;
      storedEvidence: string;
    }>(
      `SELECT receipt.log_id AS "logId", receipt.witness_key_id AS "witnessKeyId",
              receipt.witness_sequence AS "witnessSequence",
              receipt.manifest_hash AS "manifestHash",
              receipt.transparency_event_hash AS "transparencyEventHash",
              witness_check.checked_by_actor_id AS "checkedByActorId",
              witness_check.outcome, witness_check.reason_code AS "reasonCode",
              (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."observer_recipe_witness_receipts"
               WHERE tenant_id = $1 AND log_id = $2) AS "receiptCount",
              (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."observer_recipe_witness_checks"
               WHERE tenant_id = $1 AND log_id = $2) AS "checkCount",
              (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
               WHERE tenant_id = $1 AND event_type = 'observer_recipe_checkpoint_witnessed')
                 AS "auditCount",
              (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
               WHERE tenant_id = $1 AND event_type = 'observer_recipe_checkpoint_witnessed')
                 AS "outboxCount",
              receipt.payload_json || '|' || receipt.signature || '|' || audit.data_json
                AS "storedEvidence"
       FROM "${NATIVE_SCHEMA}"."observer_recipe_witness_receipts" AS receipt
       JOIN "${NATIVE_SCHEMA}"."observer_recipe_witness_checks" AS witness_check
         ON witness_check.receipt_hash = receipt.receipt_hash
       JOIN "${NATIVE_SCHEMA}"."audit_events" AS audit
         ON audit.correlation_id = receipt.receipt_hash
       WHERE receipt.tenant_id = $1 AND receipt.log_id = $2
       ORDER BY receipt.witness_sequence DESC LIMIT 1`,
      [NATIVE_TENANT, scopedObserverWitnessLogId]
    )).rows[0];
    assert.ok(firstWitnessEvidence);
    assert.equal(firstWitnessEvidence.logId, scopedObserverWitnessLogId);
    assert.equal(firstWitnessEvidence.witnessKeyId, observerWitnessSigner.keyId);
    assert.equal(Number(firstWitnessEvidence.witnessSequence), 1);
    assert.equal(firstWitnessEvidence.manifestHash, observerWitnessManifestHash);
    assert.equal(
      firstWitnessEvidence.transparencyEventHash,
      observerWitnessTransparencyEventHash
    );
    assert.equal(firstWitnessEvidence.checkedByActorId, NATIVE_USER);
    assert.equal(firstWitnessEvidence.outcome, "accepted");
    assert.equal(firstWitnessEvidence.reasonCode, "witness_receipt_accepted");
    assert.equal(Number(firstWitnessEvidence.receiptCount), 1);
    assert.equal(Number(firstWitnessEvidence.checkCount), 1);
    assert.equal(Number(firstWitnessEvidence.auditCount), 1);
    assert.equal(Number(firstWitnessEvidence.outboxCount), 1);
    assert.equal(firstWitnessEvidence.storedEvidence.includes("witness.example.net"), false);
    assert.equal(
      firstWitnessEvidence.storedEvidence.includes(observerWitnessSigner.publicKeySpki),
      false
    );
    assert.deepEqual(
      await observerWitnessHandler.execute(
        observerWitnessContext,
        "observer_recipe_witness_refresh",
        observerWitnessNow + 30_000
      ),
      {
        witnessConfigured: true,
        checkpointReady: true,
        refreshAttempted: false,
        receiptAccepted: false,
        deliveryAllowed: true,
        witnessState: "healthy",
        witnessSequence: 1
      }
    );
    assert.equal(observerWitnessPublishCalls, 1);

    const observerWitnessRenewalNow = observerWitnessNow + 61_000;
    assert.deepEqual(
      await observerWitnessHandler.execute(
        observerWitnessContext,
        "observer_recipe_witness_refresh",
        observerWitnessRenewalNow
      ),
      {
        witnessConfigured: true,
        checkpointReady: true,
        refreshAttempted: true,
        receiptAccepted: true,
        deliveryAllowed: true,
        witnessState: "healthy",
        witnessSequence: 2
      }
    );
    assert.equal(observerWitnessPublishCalls, 2);

    const observerWitnessFailureNow = observerWitnessNow + 122_000;
    observerWitnessFailure = "unavailable";
    await assert.rejects(
      observerWitnessHandler.execute(
        observerWitnessContext,
        "observer_recipe_witness_refresh",
        observerWitnessFailureNow
      ),
      (error: unknown) => {
        assert.ok(error instanceof ObserverRecipeWitnessRefreshError);
        assert.equal(error.code, "observer_recipe_witness_unavailable");
        return true;
      }
    );
    observerWitnessFailure = null;
    const failedWitnessEvidence = (await first.query<{
      outcome: string;
      reasonCode: string;
      checkedByActorId: string;
      receiptCount: string | number | bigint;
      checkCount: string | number | bigint;
      auditCount: string | number | bigint;
      outboxCount: string | number | bigint;
    }>(
      `SELECT outcome, reason_code AS "reasonCode",
              checked_by_actor_id AS "checkedByActorId",
              (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."observer_recipe_witness_receipts"
               WHERE tenant_id = $1 AND log_id = $2) AS "receiptCount",
              (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."observer_recipe_witness_checks"
               WHERE tenant_id = $1 AND log_id = $2) AS "checkCount",
              (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."audit_events"
               WHERE tenant_id = $1 AND event_type IN (
                 'observer_recipe_checkpoint_witnessed',
                 'observer_recipe_witness_check_failed'
               ))
                 AS "auditCount",
              (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."outbox_events"
               WHERE tenant_id = $1 AND aggregate_type = 'observer_recipe_witness')
                 AS "outboxCount"
       FROM "${NATIVE_SCHEMA}"."observer_recipe_witness_checks"
       WHERE tenant_id = $1 AND log_id = $2
       ORDER BY checked_at DESC, id DESC LIMIT 1`,
      [NATIVE_TENANT, scopedObserverWitnessLogId]
    )).rows[0];
    assert.ok(failedWitnessEvidence);
    assert.equal(failedWitnessEvidence.outcome, "unavailable");
    assert.equal(failedWitnessEvidence.reasonCode, "witness_unavailable");
    assert.equal(failedWitnessEvidence.checkedByActorId, NATIVE_USER);
    assert.equal(Number(failedWitnessEvidence.receiptCount), 2);
    assert.equal(Number(failedWitnessEvidence.checkCount), 3);
    assert.equal(Number(failedWitnessEvidence.auditCount), 3);
    assert.equal(Number(failedWitnessEvidence.outboxCount), 3);

    const invalidCheckpoint = await observerWitnessA.witnessCheckpoint(
      observerWitnessFailureNow + 1
    );
    assert.ok(invalidCheckpoint);
    const invalidPreviousHash = await observerWitnessA.previousWitnessReceiptHash();
    const invalidSigner = ObserverRecipeSigner.ephemeral();
    const invalidEnvelope = createObserverRecipeWitnessReceipt(invalidSigner, {
      checkpoint: invalidCheckpoint,
      witnessSequence: 3,
      previousReceiptHash: invalidPreviousHash,
      witnessedAt: new Date(observerWitnessFailureNow + 1).toISOString(),
      validUntil: new Date(observerWitnessFailureNow + 3_600_001).toISOString()
    });
    await assert.rejects(
      observerWitnessA.acceptWitnessReceipt({
        ...invalidEnvelope,
        keyId: observerWitnessSigner.keyId
      }, observerWitnessFailureNow + 1),
      (error: unknown) => {
        assert.ok(error instanceof ObserverRecipeWitnessError);
        assert.equal(error.code, "invalid_signature");
        return true;
      }
    );
    assert.deepEqual(
      (await first.query<{ receipts: string | number | bigint; checks: string | number | bigint }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."observer_recipe_witness_receipts"
            WHERE tenant_id = $1 AND log_id = $2) AS receipts,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."observer_recipe_witness_checks"
            WHERE tenant_id = $1 AND log_id = $2) AS checks`,
        [NATIVE_TENANT, scopedObserverWitnessLogId]
      )).rows.map((row) => ({ receipts: Number(row.receipts), checks: Number(row.checks) })),
      [{ receipts: 2, checks: 3 }]
    );

    const observerWitnessContentionNow = observerWitnessNow + 123_000;
    const [contentionCheckpointA, contentionCheckpointB] = await Promise.all([
      observerWitnessA.witnessCheckpoint(observerWitnessContentionNow),
      observerWitnessASecond.witnessCheckpoint(observerWitnessContentionNow)
    ]);
    assert.ok(contentionCheckpointA);
    assert.deepEqual(contentionCheckpointB, contentionCheckpointA);
    const [contentionPreviousA, contentionPreviousB] = await Promise.all([
      observerWitnessA.previousWitnessReceiptHash(),
      observerWitnessASecond.previousWitnessReceiptHash()
    ]);
    assert.equal(contentionPreviousB, contentionPreviousA);
    const contentionReceipt = createObserverRecipeWitnessReceipt(observerWitnessSigner, {
      checkpoint: contentionCheckpointA,
      witnessSequence: 3,
      previousReceiptHash: contentionPreviousA,
      witnessedAt: new Date(observerWitnessContentionNow).toISOString(),
      validUntil: new Date(observerWitnessContentionNow + 60 * 60_000).toISOString()
    });
    const contentionResults = await Promise.allSettled([
      observerWitnessA.acceptWitnessReceipt(contentionReceipt, observerWitnessContentionNow),
      observerWitnessASecond.acceptWitnessReceipt(contentionReceipt, observerWitnessContentionNow)
    ]);
    assert.equal(contentionResults.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(contentionResults.filter((result) => result.status === "rejected").length, 1);
    const rejectedContention = contentionResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    assert.ok(rejectedContention?.reason instanceof ObserverRecipeWitnessError);
    assert.equal(rejectedContention.reason.code, "checkpoint_conflict");
    assert.deepEqual(
      (await first.query<{ receipts: string | number | bigint; checks: string | number | bigint }>(
        `SELECT
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."observer_recipe_witness_receipts"
            WHERE tenant_id = $1 AND log_id = $2) AS receipts,
           (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."observer_recipe_witness_checks"
            WHERE tenant_id = $1 AND log_id = $2) AS checks`,
        [NATIVE_TENANT, scopedObserverWitnessLogId]
      )).rows.map((row) => ({ receipts: Number(row.receipts), checks: Number(row.checks) })),
      [{ receipts: 3, checks: 4 }]
    );

    assert.equal(await observerWitnessB.witnessCheckpoint(Date.now()), null);
    await assert.rejects(
      observerWitnessUnmapped.witnessCheckpoint(Date.now()),
      /tenant session principal is not active/
    );
    observerWitnessDirectClient = new Client({
      connectionString: principalConnection(NATIVE_PRINCIPAL_A)
    });
    observerWitnessDirectClient.on("error", () => undefined);
    await observerWitnessDirectClient.connect();
    await observerWitnessDirectClient.query(
      `SET ROLE "${observerWitnessManifest.witnessRefreshRole.name}"`
    );
    await assert.rejects(
      observerWitnessDirectClient.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."observer_recipe_witness_receipts"`
      ),
      /permission denied/
    );
    await assert.rejects(
      observerWitnessDirectClient.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."observer_recipe_witness_checks"(
           id, tenant_id, log_id, outcome, reason_code,
           checked_by_actor_id, checked_at
         ) VALUES ('forbidden', $1, $2, 'accepted', 'forbidden', $3, $4)`,
        [NATIVE_TENANT, scopedObserverWitnessLogId, NATIVE_USER, new Date().toISOString()]
      ),
      /permission denied/
    );
    const observerWitnessBinding = JSON.stringify({
      rootKeyId: observerWitnessRootKeyId,
      manifestGeneration: 1,
      manifestHash: observerWitnessManifestHash,
      logId: scopedObserverWitnessLogId,
      witnessKeyId: observerWitnessSigner.keyId,
      maxAgeSeconds: 120
    });
    await assert.rejects(
      observerWitnessDirectClient.query(
        `SELECT result_json FROM "${NATIVE_SCHEMA}"."yoink_refresh_observer_witness"(
           $1, $2, '0.71.0', 'plan', $3, '', $4, '{}'
         )`,
        [
          NATIVE_TENANT,
          NATIVE_SAME_TENANT_USER,
          observerWitnessBinding,
          `witnessrefresh_${"a".repeat(48)}`
        ]
      ),
      /does not match the expected authenticated principal/
    );
    const directWitnessCorrelation = `witnessrefresh_${"b".repeat(48)}`;
    const directWitnessPlanResult = await observerWitnessDirectClient.query<{
      result_json: string;
    }>(
      `SELECT result_json FROM "${NATIVE_SCHEMA}"."yoink_refresh_observer_witness"(
         $1, $2, '0.71.0', 'plan', $3, '', $4, '{}'
       )`,
      [NATIVE_TENANT, NATIVE_USER, observerWitnessBinding, directWitnessCorrelation]
    );
    const directWitnessPlan = JSON.parse(
      String(directWitnessPlanResult.rows[0]?.result_json)
    ) as Record<string, unknown>;
    await assert.rejects(
      observerWitnessDirectClient.query(
        `SELECT result_json FROM "${NATIVE_SCHEMA}"."yoink_refresh_observer_witness"(
           $1, $2, '0.71.0', 'accept', $3, $4, $5, $6
         )`,
        [
          NATIVE_TENANT,
          NATIVE_USER,
          observerWitnessBinding,
          directWitnessPlan.evaluationTimestamp,
          directWitnessCorrelation,
          JSON.stringify({
            plan: {
              ...directWitnessPlan,
              witnessCheckCount: Number(directWitnessPlan.witnessCheckCount) + 1
            },
            acceptance: {}
          })
        ]
      ),
      /plan changed before apply/
    );
    await assert.rejects(
      observerWitnessDirectClient.query(
        `SELECT result_json FROM "${NATIVE_SCHEMA}"."yoink_reconcile_operator_alerts"(
           $1, $2, '0.71.0', 'plan', '', $3, '[]'
         )`,
        [NATIVE_TENANT, NATIVE_USER, `alertcorr_${"c".repeat(48)}`]
      ),
      /permission denied/
    );
    await observerWitnessDirectClient.end();
    observerWitnessDirectClient = null;
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"
       WHERE principal_role = $1`,
      [NATIVE_PRINCIPAL_C]
    );

    const heartbeatInsert = (
      writer: NodePostgresTenantQueueWriteDatabase,
      principal: { tenantId: string; userId: string },
      workerId: string
    ) => writer.writeTransaction(principal, async (session) =>
      (await session.query<{ tenantId: string; workerId: string }>(
        `INSERT INTO "${NATIVE_SCHEMA}"."background_worker_heartbeats"(
           tenant_id, subject_user_id, worker_id, runtime_kind, runtime_version,
           state, started_at, heartbeat_at, stopped_at, last_error_code,
           privacy_classification, deployment_fingerprint
         ) VALUES ($1, $2, $3, 'standalone', $4, 'running', $5, $5, '', '',
                   'operational_aggregate', $6)
         RETURNING tenant_id AS "tenantId", worker_id AS "workerId"`,
        [
          principal.tenantId,
          principal.userId,
          workerId,
          POSTGRES_TEST_WORKER_VERSION,
          "2026-08-25T16:57:00.000Z",
          POSTGRES_TEST_WORKER_FINGERPRINT
        ]
      )).rows[0]
    );
    assert.deepEqual(await Promise.all([
      heartbeatInsert(
        queueWriterA,
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        "native_queue_writer_a"
      ),
      heartbeatInsert(
        queueWriterB,
        { tenantId: "tenant_local", userId: "user_local" },
        "native_queue_writer_b"
      )
    ]), [
      { tenantId: NATIVE_TENANT, workerId: "native_queue_writer_a" },
      { tenantId: "tenant_local", workerId: "native_queue_writer_b" }
    ]);
    const [queueViewA, queueViewB] = await Promise.all([
      queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => (await session.query<{ workerId: string }>(
          `SELECT worker_id AS "workerId"
           FROM "${NATIVE_SCHEMA}"."background_worker_heartbeats"
           WHERE worker_id LIKE 'native_queue_%' ORDER BY worker_id`
        )).rows.map((row) => row.workerId)
      ),
      queueWriterB.writeTransaction(
        { tenantId: "tenant_local", userId: "user_local" },
        async (session) => (await session.query<{ workerId: string }>(
          `SELECT worker_id AS "workerId"
           FROM "${NATIVE_SCHEMA}"."background_worker_heartbeats"
           WHERE worker_id LIKE 'native_queue_%' ORDER BY worker_id`
        )).rows.map((row) => row.workerId)
      )
    ]);
    assert.deepEqual(queueViewA, ["native_queue_writer_a"]);
    assert.deepEqual(queueViewB, ["native_queue_writer_b"]);
    assert.deepEqual(
      await queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => (await session.query<{ errorCode: string }>(
          `UPDATE "${NATIVE_SCHEMA}"."background_worker_heartbeats"
           SET last_error_code = 'native_probe'
           WHERE worker_id = 'native_queue_writer_a'
           RETURNING last_error_code AS "errorCode"`
        )).rows
      ),
      [{ errorCode: "native_probe" }]
    );
    assert.deepEqual(
      await queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => (await session.query<{ workerId: string }>(
          `UPDATE "${NATIVE_SCHEMA}"."background_worker_heartbeats"
           SET last_error_code = 'cross_tenant_probe'
           WHERE worker_id = 'native_queue_writer_b'
           RETURNING worker_id AS "workerId"`
        )).rows
      ),
      []
    );
    assert.deepEqual(
      await queueWriterB.writeTransaction(
        { tenantId: "tenant_local", userId: "user_local" },
        async (session) => (await session.query<{ errorCode: string }>(
          `SELECT last_error_code AS "errorCode"
           FROM "${NATIVE_SCHEMA}"."background_worker_heartbeats"
           WHERE worker_id = 'native_queue_writer_b'`
        )).rows
      ),
      [{ errorCode: "" }]
    );
    await assert.rejects(
      queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        (session) => session.query(
          `INSERT INTO "${NATIVE_SCHEMA}"."background_worker_heartbeats"(
             tenant_id, subject_user_id, worker_id, runtime_kind, runtime_version,
             state, started_at, heartbeat_at, stopped_at, last_error_code,
             privacy_classification, deployment_fingerprint
           ) VALUES ('tenant_local', 'user_local', 'native_queue_cross', 'standalone',
                     $1, 'running', $2, $2, '', '', 'operational_aggregate', $3)`,
          [
            POSTGRES_TEST_WORKER_VERSION,
            "2026-08-25T16:57:01.000Z",
            POSTGRES_TEST_WORKER_FINGERPRINT
          ]
        )
      ),
      /row-level security/i
    );
    await assert.rejects(
      queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        (session) => session.query(
          `DELETE FROM "${NATIVE_SCHEMA}"."background_worker_heartbeats"
           WHERE worker_id = 'native_queue_writer_a'`
        )
      ),
      /permission denied/i
    );
    await assert.rejects(
      queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        (session) => session.query(
          `UPDATE "${NATIVE_SCHEMA}"."background_task_events"
           SET reason_code = reason_code WHERE tenant_id = $1`,
          [NATIVE_TENANT]
        )
      ),
      /permission denied/i
    );
    await assert.rejects(
      queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        (session) => session.query(`SELECT id FROM "${NATIVE_SCHEMA}"."users"`)
      ),
      /permission denied/i
    );
    await assert.rejects(
      queueWriterA.writeTransaction(
        { tenantId: "tenant_local", userId: "user_local" },
        async () => undefined
      ),
      /does not match the expected authenticated principal/
    );
    await assert.rejects(
      queueWriterUnmapped.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async () => undefined
      ),
      /tenant session principal is not active/
    );
    assert.deepEqual(
      await queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => (await session.query<{ tenantId: string; userId: string }>(
          `SELECT current_setting('yoink.tenant_id') AS "tenantId",
                  current_setting('yoink.user_id') AS "userId"`
        )).rows[0]
      ),
      { tenantId: NATIVE_TENANT, userId: NATIVE_USER }
    );

    const firstStore = new PostgresBackgroundWorkerQualificationStore(first, NATIVE_SCHEMA, {
      tenantQueueWriteDatabase: queueWriterA,
      workerControlDatabase: workerControl
    });
    const secondStore = new PostgresBackgroundWorkerQualificationStore(second, NATIVE_SCHEMA, {
      tenantQueueWriteDatabase: queueWriterASecond,
      workerControlDatabase: workerControl
    });
    const [firstQualification, secondQualification] = await Promise.all([
      firstStore.qualify(),
      secondStore.qualify()
    ]);
    assert.equal(firstQualification.skipLockedLeaseImplemented, true);
    assert.equal(firstQualification.serverBoundQueueWriteTransactions, true);
    assert.equal(firstQualification.queueStoreWriteRoleParity, true);
    assert.equal(firstQualification.atomicDeploymentAttestationAndQueueWrite, true);
    assert.equal(firstQualification.serverBoundControlTransactions, true);
    assert.equal(firstQualification.controlRepositoryParity, true);
    assert.equal(firstQualification.handlerRepositoryParity, false);
    assert.deepEqual(secondQualification, firstQualification);

    const firstPrincipalPage = await firstStore.listPrincipals("", 1);
    assert.equal(firstPrincipalPage.principals.length, 1);
    assert.notEqual(firstPrincipalPage.nextCursor, "");
    const secondPrincipalPage = await firstStore.listPrincipals(firstPrincipalPage.nextCursor, 1);
    assert.equal(secondPrincipalPage.principals.length, 1);
    assert.notEqual(secondPrincipalPage.nextCursor, "");
    const thirdPrincipalPage = await firstStore.listPrincipals(secondPrincipalPage.nextCursor, 1);
    assert.equal(thirdPrincipalPage.principals.length, 1);
    assert.equal(thirdPrincipalPage.nextCursor, "");
    assert.deepEqual(
      [
        ...firstPrincipalPage.principals,
        ...secondPrincipalPage.principals,
        ...thirdPrincipalPage.principals
      ]
        .map((value) => `${value.tenantId}:${value.userId}`).sort(),
      [
        `${NATIVE_TENANT}:${NATIVE_USER}`,
        `${NATIVE_TENANT}:${NATIVE_SAME_TENANT_USER}`,
        "tenant_local:user_local"
      ].sort()
    );
    assert.deepEqual(
      await workerControl.controlTransaction(async (session) =>
        (await session.query<{ tenantId: string; userId: string }>(
          `SELECT tenant_id AS "tenantId", id AS "userId"
           FROM "${NATIVE_SCHEMA}"."users" ORDER BY tenant_id, id`
        )).rows),
      [
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        { tenantId: NATIVE_TENANT, userId: NATIVE_SAME_TENANT_USER },
        { tenantId: "tenant_local", userId: "user_local" }
      ]
    );
    await assert.rejects(
      workerControl.controlTransaction((session) => session.query(
        `SELECT display_name FROM "${NATIVE_SCHEMA}"."users"`
      )),
      /permission denied/
    );
    await assert.rejects(
      workerControl.controlTransaction((session) => session.query(
        `SELECT updated_at FROM "${NATIVE_SCHEMA}"."background_worker_deployment_expectations"`
      )),
      /permission denied/
    );
    await assert.rejects(
      workerControl.controlTransaction((session) => session.query(
        `UPDATE "${NATIVE_SCHEMA}"."users" SET display_name = 'forbidden'`
      )),
      /permission denied/
    );
    await assert.rejects(
      workerControl.controlTransaction((session) => session.query(
        `UPDATE "${NATIVE_SCHEMA}"."background_worker_deployment_expectations"
         SET runtime_version = 'forbidden' WHERE id = 'active'`
      )),
      /permission denied/
    );
    await assert.rejects(
      workerControl.controlTransaction((session) => session.query(
        `INSERT INTO "${NATIVE_SCHEMA}"."background_worker_heartbeats"(
           tenant_id, subject_user_id, worker_id, runtime_kind, runtime_version,
           state, started_at, heartbeat_at, stopped_at, last_error_code,
           privacy_classification, deployment_fingerprint
         ) VALUES ($1, $2, 'forbidden_control_insert', 'standalone', $3,
                   'running', $4, $4, '', '', 'operational_aggregate', $5)`,
        [
          NATIVE_TENANT,
          NATIVE_USER,
          POSTGRES_TEST_WORKER_VERSION,
          new Date(NATIVE_NOW).toISOString(),
          POSTGRES_TEST_WORKER_FINGERPRINT
        ]
      )),
      /permission denied/
    );
    await assert.rejects(
      workerControl.controlTransaction((session) => session.query(
        `UPDATE "${NATIVE_SCHEMA}"."background_worker_heartbeats"
         SET deployment_fingerprint = $1`,
        [POSTGRES_TEST_WORKER_FINGERPRINT]
      )),
      /permission denied/
    );
    await assert.rejects(
      workerControl.controlTransaction((session) => session.query(
        `SELECT id FROM "${NATIVE_SCHEMA}"."background_tasks"`
      )),
      /permission denied/
    );

    assert.deepEqual(
      await queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        async (session) => (await session.query<{ runtimeVersion: string; fingerprint: string }>(
          `SELECT runtime_version AS "runtimeVersion",
                  deployment_fingerprint AS fingerprint
           FROM "${NATIVE_SCHEMA}"."background_worker_deployment_expectations"
           WHERE id = 'active'`
        )).rows
      ),
      [{
        runtimeVersion: POSTGRES_TEST_WORKER_VERSION,
        fingerprint: POSTGRES_TEST_WORKER_FINGERPRINT
      }]
    );
    await assert.rejects(
      queueWriterA.writeTransaction(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        (session) => session.query(
          `UPDATE "${NATIVE_SCHEMA}"."background_worker_deployment_expectations"
           SET runtime_version = 'forbidden' WHERE id = 'active'`
        )
      ),
      /permission denied/
    );
    const schedulesBeforeAttestationFailure = Number((await first.query<{
      count: string | number | bigint;
    }>(
      `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."background_task_schedules"
       WHERE tenant_id = $1 AND subject_user_id = $2`,
      [NATIVE_TENANT, NATIVE_USER]
    )).rows[0]?.count ?? 0);
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."background_worker_deployment_expectations"
       SET runtime_version = '0.0.0-attestation-mismatch' WHERE id = 'active'`
    );
    await assert.rejects(
      firstStore.ensureSchedules(workerContext("native_atomic_attestation_probe"), NATIVE_NOW),
      /deployment contract does not match/
    );
    assert.equal(
      Number((await first.query<{ count: string | number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."background_task_schedules"
         WHERE tenant_id = $1 AND subject_user_id = $2`,
        [NATIVE_TENANT, NATIVE_USER]
      )).rows[0]?.count ?? 0),
      schedulesBeforeAttestationFailure
    );
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."background_worker_deployment_expectations"
       SET runtime_version = $1 WHERE id = 'active'`,
      [POSTGRES_TEST_WORKER_VERSION]
    );

    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."background_tasks"
       SET state = 'cancelled', completed_at = '2000-01-01T00:00:00.000Z',
           updated_at = '2000-01-01T00:00:00.000Z'
       WHERE id IN (
         'native_retention_task_current_terminal',
         'native_retention_task_old_dead_letter'
       )`
    );
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."background_task_events"
       WHERE tenant_id = $1 AND subject_user_id = $2`,
      [NATIVE_TENANT, NATIVE_USER]
    );
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."background_tasks"
       WHERE tenant_id = $1 AND subject_user_id = $2`,
      [NATIVE_TENANT, NATIVE_USER]
    );
    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."background_task_schedules"
       WHERE tenant_id = $1 AND subject_user_id = $2`,
      [NATIVE_TENANT, NATIVE_USER]
    );

    await firstStore.ensureSchedules(workerContext("native_repository_probe"), NATIVE_NOW);
    assert.equal(
      await firstStore.enqueueDueSchedules(workerContext("native_repository_probe"), NATIVE_NOW),
      7
    );
    const restrictedRepositoryRows = await first.query<{
      schedules: string | number | bigint;
      tasks: string | number | bigint;
      events: string | number | bigint;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."background_task_schedules"
          WHERE tenant_id = $1 AND subject_user_id = $2) AS schedules,
         (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."background_tasks"
          WHERE tenant_id = $1 AND subject_user_id = $2) AS tasks,
         (SELECT COUNT(*) FROM "${NATIVE_SCHEMA}"."background_task_events"
          WHERE tenant_id = $1 AND subject_user_id = $2) AS events`,
      [NATIVE_TENANT, NATIVE_USER]
    );
    assert.deepEqual(restrictedRepositoryRows.rows.map((row) => ({
      schedules: Number(row.schedules),
      tasks: Number(row.tasks),
      events: Number(row.events)
    })), [{ schedules: 7, tasks: 7, events: 7 }]);
    await first.query(
      `UPDATE "${NATIVE_SCHEMA}"."background_tasks"
       SET state = 'cancelled', completed_at = $3, updated_at = $3
       WHERE tenant_id = $1 AND subject_user_id = $2 AND state = 'pending'`,
      [NATIVE_TENANT, NATIVE_USER, "2026-08-25T17:00:00.001Z"]
    );

    await firstStore.heartbeat(workerContext("native_repository_probe"), "", NATIVE_NOW);
    assert.equal(
      (await first.query<{ count: string | number | bigint }>(
        `SELECT COUNT(*) AS count FROM "${NATIVE_SCHEMA}"."background_worker_heartbeats"
         WHERE tenant_id = $1 AND subject_user_id = $2
           AND worker_id = 'native_repository_probe' AND state = 'running'`,
        [NATIVE_TENANT, NATIVE_USER]
      )).rows[0]?.count,
      "1"
    );
    assert.deepEqual(
      await firstStore.deploymentStatus(
        "standalone",
        POSTGRES_TEST_WORKER_FINGERPRINT,
        NATIVE_NOW
      ),
      {
        state: "running",
        healthy: false,
        runtimeKind: "standalone",
        lastHeartbeatAt: new Date(NATIVE_NOW).toISOString(),
        lastErrorCode: "worker_coverage_incomplete",
        coveredPrincipals: 1,
        totalPrincipals: 3,
        deploymentAttested: false,
        deploymentContractVersion: 2
      }
    );
    await firstStore.stopWorker("native_repository_probe", "standalone", "native_control_stop", NATIVE_NOW + 1);
    assert.deepEqual(
      (await first.query<{ state: string; errorCode: string }>(
        `SELECT state, last_error_code AS "errorCode"
         FROM "${NATIVE_SCHEMA}"."background_worker_heartbeats"
         WHERE tenant_id = $1 AND subject_user_id = $2
           AND worker_id = 'native_repository_probe'`,
        [NATIVE_TENANT, NATIVE_USER]
      )).rows,
      [{ state: "stopped", errorCode: "native_control_stop" }]
    );
    await assert.rejects(
      workerControl.controlTransaction((session) => session.query(
        `UPDATE "${NATIVE_SCHEMA}"."background_worker_heartbeats"
         SET state = 'running'
         WHERE worker_id = 'native_repository_probe' AND runtime_kind = 'standalone'`
      )),
      /row-level security policy/
    );
    const scheduledFor = "2026-08-25T16:59:00.000Z";
    await insertProbeTask(first, "native_repository_retry", 25, scheduledFor);
    const retryLease = await firstStore.leaseNext(
      workerContext("native_repository_probe"),
      60,
      NATIVE_NOW
    );
    assert.equal(retryLease?.id, "native_repository_retry");
    await firstStore.fail(
      workerContext("native_repository_probe"),
      retryLease!.id,
      retryLease!.capabilityToken,
      "native_repository_probe",
      NATIVE_NOW + 1
    );
    assert.deepEqual(
      (await first.query<{ state: string; errorCode: string }>(
        `SELECT state, last_error_code AS "errorCode"
         FROM "${NATIVE_SCHEMA}"."background_tasks" WHERE id = 'native_repository_retry'`
      )).rows,
      [{ state: "retry_wait", errorCode: "native_repository_probe" }]
    );

    await insertProbeTask(first, "native_contention_locked", 100, scheduledFor);
    await insertProbeTask(first, "native_contention_skipped", 50, scheduledFor);
    await locker.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await locker.query(
      `SELECT id FROM "${NATIVE_SCHEMA}"."background_tasks"
       WHERE id = 'native_contention_locked' FOR UPDATE`
    );

    const skippedLease = await secondStore.leaseNext(workerContext("native_worker_b"), 60, NATIVE_NOW);
    assert.equal(skippedLease?.id, "native_contention_skipped");
    assert.equal(
      await firstStore.leaseNext(workerContext("native_worker_a"), 60, NATIVE_NOW),
      null
    );
    await secondStore.complete(
      workerContext("native_worker_b"),
      skippedLease!.id,
      skippedLease!.capabilityToken,
      { nativeContentionProbe: true },
      NATIVE_NOW + 1
    );
    await locker.query("ROLLBACK");

    const releasedLease = await firstStore.leaseNext(workerContext("native_worker_a"), 60, NATIVE_NOW + 2);
    assert.equal(releasedLease?.id, "native_contention_locked");
    await assert.rejects(
      firstStore.complete(
        workerContext("native_worker_a"),
        releasedLease!.id,
        "A".repeat(43),
        { nativeContentionProbe: true },
        NATIVE_NOW + 3
      ),
      /capability is invalid or expired/
    );
    await firstStore.complete(
      workerContext("native_worker_a"),
      releasedLease!.id,
      releasedLease!.capabilityToken,
      { nativeContentionProbe: true },
      NATIVE_NOW + 4
    );

    await insertProbeTask(first, "native_contention_race", 75, scheduledFor);
    const raced = await Promise.all([
      firstStore.leaseNext(workerContext("native_worker_a"), 60, NATIVE_NOW + 5),
      secondStore.leaseNext(workerContext("native_worker_b"), 60, NATIVE_NOW + 5)
    ]);
    const winners = raced.filter((lease) => lease !== null);
    assert.equal(winners.length, 1);
    assert.equal(winners[0]?.id, "native_contention_race");
    const winnerIndex = raced.findIndex((lease) => lease !== null);
    const winnerStore = winnerIndex === 0 ? firstStore : secondStore;
    const winnerContext = workerContext(winnerIndex === 0 ? "native_worker_a" : "native_worker_b");
    await winnerStore.complete(
      winnerContext,
      winners[0]!.id,
      winners[0]!.capabilityToken,
      { nativeRaceWinner: true },
      NATIVE_NOW + 6
    );

    const finalTasks = await first.query<{
      id: string;
      state: string;
      attemptCount: string | number | bigint;
      leaseCapabilityHash: string;
    }>(
      `SELECT id, state, attempt_count AS "attemptCount",
              lease_capability_hash AS "leaseCapabilityHash"
       FROM "${NATIVE_SCHEMA}"."background_tasks"
       WHERE id LIKE 'native_contention_%' ORDER BY id`
    );
    assert.deepEqual(finalTasks.rows.map((row) => ({
      id: row.id,
      state: row.state,
      attemptCount: Number(row.attemptCount),
      capabilityCleared: row.leaseCapabilityHash === ""
    })), [
      { id: "native_contention_locked", state: "succeeded", attemptCount: 1, capabilityCleared: true },
      { id: "native_contention_race", state: "succeeded", attemptCount: 1, capabilityCleared: true },
      { id: "native_contention_skipped", state: "succeeded", attemptCount: 1, capabilityCleared: true }
    ]);
    const events = await first.query<{
      taskId: string;
      eventType: string;
      count: string | number | bigint;
    }>(
      `SELECT task_id AS "taskId", event_type AS "eventType", COUNT(*) AS count
       FROM "${NATIVE_SCHEMA}"."background_task_events"
       WHERE task_id LIKE 'native_contention_%'
       GROUP BY task_id, event_type ORDER BY task_id, event_type`
    );
    assert.deepEqual(events.rows.map((row) => ({
      taskId: row.taskId,
      eventType: row.eventType,
      count: Number(row.count)
    })), [
      { taskId: "native_contention_locked", eventType: "leased", count: 1 },
      { taskId: "native_contention_locked", eventType: "succeeded", count: 1 },
      { taskId: "native_contention_race", eventType: "leased", count: 1 },
      { taskId: "native_contention_race", eventType: "succeeded", count: 1 },
      { taskId: "native_contention_skipped", eventType: "leased", count: 1 },
      { taskId: "native_contention_skipped", eventType: "succeeded", count: 1 }
    ]);

    await first.query(
      `DELETE FROM "${NATIVE_SCHEMA}"."${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}"`
    );
    for (const principalRole of [
      NATIVE_PRINCIPAL_A,
      NATIVE_PRINCIPAL_B,
      NATIVE_PRINCIPAL_C,
      NATIVE_PRINCIPAL_UNMAPPED
    ]) {
      await first.query(
        `REVOKE "${tenantSessionManifest.sessionRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${queueWriteManifest.writeRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${notificationRecoveryManifest.recoveryRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${executionRecoveryManifest.executionRecoveryRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${operationalRetentionManifest.operationalRetentionRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${observerCandidateManifest.observerCandidateRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${alertDispatchManifest.alertDispatchRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${alertReconciliationManifest.alertReconciliationRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${observerWitnessManifest.witnessRefreshRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${deliveryLeaseRecoveryManifest.leaseRecoveryRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${signalCatalogApplyManifest.catalogApplyRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${signalResolutionApplyManifest.resolutionApplyRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${signalSourceReferenceManifest.sourceReferenceRefreshRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${signalTerminalDecisionManifest.terminalDecisionApplyRole.name}" FROM "${principalRole}"`
      );
      await first.query(
        `REVOKE "${signalOfferIncidentManifest.offerIncidentApplyRole.name}" FROM "${principalRole}"`
      );
    }
    await first.query(
      `REVOKE "${workerControlManifest.controlRole.name}" FROM "${NATIVE_CONTROL_PRINCIPAL}"`
    );
    const cleanBoundary = await verifyPostgresTenantSessionBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE
    );
    assert.equal(cleanBoundary.boundaryCatalogFingerprint, sessionBoundary.boundaryCatalogFingerprint);
    const cleanQueueWriteBoundary = await verifyPostgresTenantQueueWriteBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE
    );
    assert.equal(
      cleanQueueWriteBoundary.boundaryCatalogFingerprint,
      queueWriteBoundary.boundaryCatalogFingerprint
    );
    const cleanWorkerControlBoundary = await verifyPostgresWorkerControlBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE
    );
    assert.equal(
      cleanWorkerControlBoundary.boundaryCatalogFingerprint,
      workerControlBoundary.boundaryCatalogFingerprint
    );
    const cleanNotificationRecoveryBoundary = await verifyPostgresNotificationRecoveryBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE
    );
    assert.equal(
      cleanNotificationRecoveryBoundary.boundaryCatalogFingerprint,
      notificationRecoveryBoundary.boundaryCatalogFingerprint
    );
    const cleanExecutionRecoveryBoundary = await verifyPostgresExecutionRecoveryBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE
    );
    assert.equal(
      cleanExecutionRecoveryBoundary.boundaryCatalogFingerprint,
      executionRecoveryBoundary.boundaryCatalogFingerprint
    );
    const cleanOperationalRetentionBoundary = await verifyPostgresOperationalRetentionBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE
    );
    assert.equal(
      cleanOperationalRetentionBoundary.boundaryCatalogFingerprint,
      operationalRetentionBoundary.boundaryCatalogFingerprint
    );
    const cleanObserverCandidateBoundary = await verifyPostgresObserverCandidateEvaluationBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE
    );
    assert.equal(
      cleanObserverCandidateBoundary.boundaryCatalogFingerprint,
      observerCandidateBoundary.boundaryCatalogFingerprint
    );
    const cleanAlertDispatchBoundary = await verifyPostgresOperatorAlertConnectorDispatchBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE
    );
    assert.equal(
      cleanAlertDispatchBoundary.boundaryCatalogFingerprint,
      alertDispatchBoundary.boundaryCatalogFingerprint
    );
    const cleanAlertReconciliationBoundary = await verifyPostgresOperatorAlertReconciliationBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE
    );
    assert.equal(
      cleanAlertReconciliationBoundary.boundaryCatalogFingerprint,
      alertReconciliationBoundary.boundaryCatalogFingerprint
    );
    const cleanObserverWitnessBoundary = await verifyPostgresObserverWitnessRefreshBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE
    );
    assert.equal(
      cleanObserverWitnessBoundary.boundaryCatalogFingerprint,
      observerWitnessBoundary.boundaryCatalogFingerprint
    );
    const cleanDeliveryLeaseRecoveryBoundary = await verifyPostgresHostedDeliveryLeaseRecoveryBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE
    );
    assert.equal(
      cleanDeliveryLeaseRecoveryBoundary.boundaryCatalogFingerprint,
      deliveryLeaseRecoveryBoundary.boundaryCatalogFingerprint
    );
    const cleanSignalCatalogApplyBoundary = await verifyPostgresSignalCatalogApplyBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE
    );
    assert.equal(
      cleanSignalCatalogApplyBoundary.boundaryCatalogFingerprint,
      signalCatalogApplyBoundary.boundaryCatalogFingerprint
    );
    const cleanSignalResolutionApplyBoundary = await verifyPostgresSignalResolutionApplyBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
      NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE
    );
    assert.equal(
      cleanSignalResolutionApplyBoundary.boundaryCatalogFingerprint,
      signalResolutionApplyBoundary.boundaryCatalogFingerprint
    );
    const cleanSignalSourceReferenceBoundary = await verifyPostgresSignalSourceReferenceRefreshBoundary(
      first,
      NATIVE_SCHEMA,
      NATIVE_ROLE_NAMESPACE,
      NATIVE_SESSION_ROLE_NAMESPACE,
      NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
      NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
      NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
      NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
      NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
      NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
      NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
      NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
      NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
      NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
      NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
      NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE
    );
    assert.equal(
      cleanSignalSourceReferenceBoundary.boundaryCatalogFingerprint,
      signalSourceReferenceBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION}"(
         text, text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresSignalSourceReferenceRefreshBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION}"(
         text, text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresSignalSourceReferenceRefreshBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      signalSourceReferenceBoundary.boundaryCatalogFingerprint
    );
    const cleanSignalTerminalDecisionBoundary =
      await verifyPostgresSignalTerminalDecisionApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE
      );
    assert.equal(
      cleanSignalTerminalDecisionBoundary.boundaryCatalogFingerprint,
      signalTerminalDecisionBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresSignalTerminalDecisionApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresSignalTerminalDecisionApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      signalTerminalDecisionBoundary.boundaryCatalogFingerprint
    );
    const cleanSignalOfferIncidentBoundary =
      await verifyPostgresSignalOfferIncidentApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
        NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE
      );
    assert.equal(
      cleanSignalOfferIncidentBoundary.boundaryCatalogFingerprint,
      signalOfferIncidentBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresSignalOfferIncidentApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
        NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresSignalOfferIncidentApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
        NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      signalOfferIncidentBoundary.boundaryCatalogFingerprint
    );
    const cleanSignalPostIncidentDecisionBoundary =
      await verifyPostgresSignalPostIncidentDecisionApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
        NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE,
        NATIVE_POST_INCIDENT_DECISION_APPLY_ROLE_NAMESPACE
      );
    assert.equal(
      cleanSignalPostIncidentDecisionBoundary.boundaryCatalogFingerprint,
      signalPostIncidentDecisionBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresSignalPostIncidentDecisionApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
        NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE,
        NATIVE_POST_INCIDENT_DECISION_APPLY_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresSignalPostIncidentDecisionApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE,
        NATIVE_SOURCE_REFERENCE_REFRESH_ROLE_NAMESPACE,
        NATIVE_TERMINAL_DECISION_APPLY_ROLE_NAMESPACE,
        NATIVE_OFFER_INCIDENT_APPLY_ROLE_NAMESPACE,
        NATIVE_POST_INCIDENT_DECISION_APPLY_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      signalPostIncidentDecisionBoundary.boundaryCatalogFingerprint
    );
    const cleanSignalMissionBindingBoundary =
      await verifyPostgresSignalMissionBindingApplyBoundary(
        first,
        signalMissionBindingManifest
      );
    assert.equal(
      cleanSignalMissionBindingBoundary.boundaryCatalogFingerprint,
      signalMissionBindingBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresSignalMissionBindingApplyBoundary(first, signalMissionBindingManifest),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresSignalMissionBindingApplyBoundary(
        first,
        signalMissionBindingManifest
      )).boundaryCatalogFingerprint,
      signalMissionBindingBoundary.boundaryCatalogFingerprint
    );
    const cleanSignalStrategyEvaluationBoundary =
      await verifyPostgresSignalStrategyEvaluationApplyBoundary(
        first,
        signalStrategyEvaluationManifest
      );
    assert.equal(
      cleanSignalStrategyEvaluationBoundary.boundaryCatalogFingerprint,
      signalStrategyEvaluationBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresSignalStrategyEvaluationApplyBoundary(
        first,
        signalStrategyEvaluationManifest
      ),
      /qualified security-definer function is incomplete|drifted from its receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresSignalStrategyEvaluationApplyBoundary(
        first,
        signalStrategyEvaluationManifest
      )).boundaryCatalogFingerprint,
      signalStrategyEvaluationBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresSignalResolutionApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresSignalResolutionApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE,
        NATIVE_RESOLUTION_APPLY_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      signalResolutionApplyBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresSignalCatalogApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."${POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION}"(
         text, text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresSignalCatalogApplyBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE,
        NATIVE_CATALOG_APPLY_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      signalCatalogApplyBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_recover_hosted_delivery_leases"(
         text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresHostedDeliveryLeaseRecoveryBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE
      ),
      /function boundaries are incomplete|no longer matches its receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_recover_hosted_delivery_leases"(
         text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresHostedDeliveryLeaseRecoveryBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE,
        NATIVE_DELIVERY_LEASE_RECOVERY_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      deliveryLeaseRecoveryBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_refresh_observer_witness"(
         text, text, text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresObserverWitnessRefreshBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_refresh_observer_witness"(
         text, text, text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresObserverWitnessRefreshBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE,
        NATIVE_WITNESS_REFRESH_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      observerWitnessBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_reconcile_operator_alerts"(
         text, text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresOperatorAlertReconciliationBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_reconcile_operator_alerts"(
         text, text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresOperatorAlertReconciliationBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE,
        NATIVE_ALERT_RECONCILIATION_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      alertReconciliationBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_dispatch_operator_alert_connector"(
         text, text, text, text, text, text, text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresOperatorAlertConnectorDispatchBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_dispatch_operator_alert_connector"(
         text, text, text, text, text, text, text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresOperatorAlertConnectorDispatchBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE,
        NATIVE_ALERT_DISPATCH_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      alertDispatchBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_evaluate_observer_repair_candidates"(
         text, text, text, text, text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresObserverCandidateEvaluationBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_evaluate_observer_repair_candidates"(
         text, text, text, text, text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresObserverCandidateEvaluationBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE,
        NATIVE_OBSERVER_CANDIDATE_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      observerCandidateBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_apply_operational_retention"(
         text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresOperationalRetentionBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_apply_operational_retention"(
         text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresOperationalRetentionBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_OPERATIONAL_RETENTION_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      operationalRetentionBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_recover_action_execution"(
         text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresExecutionRecoveryBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_recover_action_execution"(
         text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresExecutionRecoveryBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE,
        NATIVE_EXECUTION_RECOVERY_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      executionRecoveryBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_recover_notification_deliveries"(
         text, text
       ) STABLE`
    );
    await assert.rejects(
      verifyPostgresNotificationRecoveryBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_recover_notification_deliveries"(
         text, text
       ) VOLATILE`
    );
    assert.equal(
      (await verifyPostgresNotificationRecoveryBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE,
        NATIVE_NOTIFICATION_RECOVERY_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      notificationRecoveryBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER POLICY "yoink_worker_control_users_select"
       ON "${NATIVE_SCHEMA}"."users" USING (FALSE)`
    );
    await assert.rejects(
      verifyPostgresWorkerControlBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE
      ),
      /no longer matches its verified receipt|policy surface is incomplete/
    );
    await first.query(
      `ALTER POLICY "yoink_worker_control_users_select"
       ON "${NATIVE_SCHEMA}"."users" USING (TRUE)`
    );
    assert.equal(
      (await verifyPostgresWorkerControlBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE,
        NATIVE_WORKER_CONTROL_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      workerControlBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_json_valid"(text) VOLATILE`
    );
    await assert.rejects(
      verifyPostgresTenantQueueWriteBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE
      ),
      /function boundary is incomplete|no longer matches its verified receipt/
    );
    await first.query(
      `ALTER FUNCTION "${NATIVE_SCHEMA}"."yoink_json_valid"(text) IMMUTABLE`
    );
    assert.equal(
      (await verifyPostgresTenantQueueWriteBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE
      )).boundaryCatalogFingerprint,
      queueWriteBoundary.boundaryCatalogFingerprint
    );
    await first.query(
      `ALTER POLICY "yoink_server_queue_write_background_worker_heartbeats"
       ON "${NATIVE_SCHEMA}"."background_worker_heartbeats"
       USING (TRUE) WITH CHECK (TRUE)`
    );
    await assert.rejects(
      verifyPostgresTenantQueueWriteBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE,
        NATIVE_QUEUE_WRITE_ROLE_NAMESPACE
      ),
      /no longer matches its verified receipt/
    );
    await first.query(
      `ALTER POLICY "yoink_server_bound_users" ON "${NATIVE_SCHEMA}"."users"
       USING (TRUE) WITH CHECK (TRUE)`
    );
    await assert.rejects(
      verifyPostgresTenantSessionBoundary(
        first,
        NATIVE_SCHEMA,
        NATIVE_ROLE_NAMESPACE,
        NATIVE_SESSION_ROLE_NAMESPACE
      ),
      /no longer matches its verified receipt/
    );
  } finally {
    await locker?.query("ROLLBACK").catch(() => undefined);
    await Promise.allSettled([
      importer?.close(),
      first?.close(),
      second?.close(),
      locker?.end(),
      directClient?.end(),
      tenantReaderA?.close(),
      tenantReaderB?.close(),
      tenantReaderUnmapped?.close(),
      queueWriterA?.close(),
      queueWriterASecond?.close(),
      queueWriterB?.close(),
      queueWriterUnmapped?.close(),
      workerControl?.close(),
      notificationRecoveryA?.close(),
      notificationRecoveryB?.close(),
      notificationRecoveryUnmapped?.close(),
      notificationDirectClient?.end(),
      executionRecoveryA?.close(),
      executionRecoveryB?.close(),
      executionRecoveryUnmapped?.close(),
      executionDirectClient?.end(),
      operationalRetentionA?.close(),
      operationalRetentionB?.close(),
      operationalRetentionUnmapped?.close(),
      operationalRetentionDirectClient?.end(),
      observerCandidateA?.close(),
      observerCandidateB?.close(),
      observerCandidateUnmapped?.close(),
      observerCandidateDirectClient?.end(),
      alertDispatchA?.close(),
      alertDispatchASecond?.close(),
      alertDispatchB?.close(),
      alertDispatchC?.close(),
      alertDispatchUnmapped?.close(),
      alertDispatchDirectClient?.end(),
      alertReconciliationA?.close(),
      alertReconciliationASecond?.close(),
      alertReconciliationB?.close(),
      alertReconciliationC?.close(),
      alertReconciliationUnmapped?.close(),
      alertReconciliationDirectClient?.end(),
      observerWitnessA?.close(),
      observerWitnessASecond?.close(),
      observerWitnessB?.close(),
      observerWitnessUnmapped?.close(),
      observerWitnessDirectClient?.end(),
      deliveryLeaseRecoveryA?.close(),
      deliveryLeaseRecoveryASecond?.close(),
      deliveryLeaseRecoveryB?.close(),
      deliveryLeaseRecoveryC?.close(),
      deliveryLeaseRecoveryUnmapped?.close(),
      deliveryLeaseRecoveryDirectClient?.end(),
      signalCatalogApplyA?.close(),
      signalCatalogApplyASecond?.close(),
      signalCatalogApplyB?.close(),
      signalCatalogApplyC?.close(),
      signalCatalogApplyUnmapped?.close(),
      signalCatalogApplyDirectClient?.end(),
      signalResolutionApplyA?.close(),
      signalResolutionApplyASecond?.close(),
      signalResolutionApplyB?.close(),
      signalResolutionApplyC?.close(),
      signalResolutionApplyUnmapped?.close(),
      signalResolutionApplyDirectClient?.end(),
      signalSourceReferenceA?.close(),
      signalSourceReferenceASecond?.close(),
      signalSourceReferenceB?.close(),
      signalSourceReferenceC?.close(),
      signalSourceReferenceUnmapped?.close(),
      signalSourceReferenceDirectClient?.end(),
      signalTerminalDecisionA?.close(),
      signalTerminalDecisionASecond?.close(),
      signalTerminalDecisionB?.close(),
      signalTerminalDecisionC?.close(),
      signalTerminalDecisionUnmapped?.close(),
      signalTerminalDecisionDirectClient?.end(),
      signalOfferIncidentA?.close(),
      signalOfferIncidentASecond?.close(),
      signalOfferIncidentB?.close(),
      signalOfferIncidentC?.close(),
      signalOfferIncidentUnmapped?.close(),
      signalOfferIncidentDirectClient?.end(),
      signalPostIncidentDecisionA?.close(),
      signalPostIncidentDecisionASecond?.close(),
      signalPostIncidentDecisionB?.close(),
      signalPostIncidentDecisionC?.close(),
      signalPostIncidentDecisionUnmapped?.close(),
      signalPostIncidentDecisionDirectClient?.end(),
      signalMissionBindingA?.close(),
      signalMissionBindingASecond?.close(),
      signalMissionBindingB?.close(),
      signalMissionBindingC?.close(),
      signalMissionBindingUnmapped?.close(),
      signalMissionBindingDirectClient?.end(),
      signalStrategyEvaluationA?.close(),
      signalStrategyEvaluationASecond?.close(),
      signalStrategyEvaluationB?.close(),
      signalStrategyEvaluationC?.close(),
      signalStrategyEvaluationUnmapped?.close(),
      signalStrategyEvaluationDirectClient?.end(),
      signalWriterLockDirectClient?.end(),
      signalConstraintConfigA?.close(),
      signalConstraintConfigASecond?.close(),
      signalConstraintConfigB?.close(),
      signalConstraintConfigC?.close(),
      signalConstraintConfigUnmapped?.close(),
      (signalConstraintConfigDirectClient as Client | null)?.end(),
      signalActionSpendA?.close(),
      signalActionSpendASecond?.close(),
      signalActionSpendB?.close(),
      signalActionSpendC?.close(),
      signalActionSpendUnmapped?.close(),
      (signalActionSpendDirectClient as Client | null)?.end(),
      signalTargetQualificationA?.close(),
      signalTargetQualificationASecond?.close(),
      signalTargetQualificationB?.close(),
      signalTargetQualificationC?.close(),
      signalTargetQualificationUnmapped?.close(),
      signalTargetQualificationDirectClient?.end(),
      signalSourceTrustA?.close(),
      signalSourceTrustASecond?.close(),
      signalSourceTrustB?.close(),
      signalSourceTrustC?.close(),
      signalSourceTrustUnmapped?.close(),
      signalSourceTrustDirectClient?.end(),
      (signalRetailerQualificationA as
        NodePostgresSignalRetailerQualificationApplyDatabase | null)?.close(),
      (signalRetailerQualificationASecond as
        NodePostgresSignalRetailerQualificationApplyDatabase | null)?.close(),
      (signalRetailerQualificationB as
        NodePostgresSignalRetailerQualificationApplyDatabase | null)?.close(),
      (signalRetailerQualificationC as
        NodePostgresSignalRetailerQualificationApplyDatabase | null)?.close(),
      (signalRetailerQualificationUnmapped as
        NodePostgresSignalRetailerQualificationApplyDatabase | null)?.close(),
      (signalRetailerQualificationDirectClient as Client | null)?.end(),
      (signalMissionPolicyA as
        NodePostgresSignalMissionPolicyApplyDatabase | null)?.close(),
      (signalMissionPolicyASecond as
        NodePostgresSignalMissionPolicyApplyDatabase | null)?.close(),
      (signalMissionPolicyB as
        NodePostgresSignalMissionPolicyApplyDatabase | null)?.close(),
      (signalMissionPolicyC as
        NodePostgresSignalMissionPolicyApplyDatabase | null)?.close(),
      (signalMissionPolicyUnmapped as
        NodePostgresSignalMissionPolicyApplyDatabase | null)?.close(),
      (signalMissionPolicyDirectClient as Client | null)?.end(),
      (signalSourceStatusA as
        NodePostgresSignalSourceStatusApplyDatabase | null)?.close(),
      (signalSourceStatusASecond as
        NodePostgresSignalSourceStatusApplyDatabase | null)?.close(),
      (signalSourceStatusB as
        NodePostgresSignalSourceStatusApplyDatabase | null)?.close(),
      (signalSourceStatusC as
        NodePostgresSignalSourceStatusApplyDatabase | null)?.close(),
      (signalSourceStatusUnmapped as
        NodePostgresSignalSourceStatusApplyDatabase | null)?.close(),
      (signalSourceStatusDirectClient as Client | null)?.end(),
      (signalSourceSyncA as
        NodePostgresSignalSourceSyncApplyDatabase | null)?.close(),
      (signalSourceSyncASecond as
        NodePostgresSignalSourceSyncApplyDatabase | null)?.close(),
      (signalSourceSyncB as
        NodePostgresSignalSourceSyncApplyDatabase | null)?.close(),
      (signalSourceSyncC as
        NodePostgresSignalSourceSyncApplyDatabase | null)?.close(),
      (signalSourceSyncUnmapped as
        NodePostgresSignalSourceSyncApplyDatabase | null)?.close(),
      (signalSourceSyncDirectClient as Client | null)?.end(),
      (signalCatalogImportA as
        NodePostgresSignalCatalogImportApplyDatabase | null)?.close(),
      (signalCatalogImportASecond as
        NodePostgresSignalCatalogImportApplyDatabase | null)?.close(),
      (signalCatalogImportB as
        NodePostgresSignalCatalogImportApplyDatabase | null)?.close(),
      (signalCatalogImportUnmapped as
        NodePostgresSignalCatalogImportApplyDatabase | null)?.close(),
      (signalCatalogImportDirectClient as Client | null)?.end(),
      (signalCatalogImportLockClient as Client | null)?.end(),
      (signalSourceProvisioningA as
        NodePostgresSignalSourceProvisioningApplyDatabase | null)?.close(),
      (signalSourceProvisioningASecond as
        NodePostgresSignalSourceProvisioningApplyDatabase | null)?.close(),
      (signalSourceProvisioningB as
        NodePostgresSignalSourceProvisioningApplyDatabase | null)?.close(),
      (signalSourceProvisioningC as
        NodePostgresSignalSourceProvisioningApplyDatabase | null)?.close(),
      (signalSourceProvisioningCSecond as
        NodePostgresSignalSourceProvisioningApplyDatabase | null)?.close(),
      (signalSourceProvisioningUnmapped as
        NodePostgresSignalSourceProvisioningApplyDatabase | null)?.close(),
      (signalSourceProvisioningDirectClient as Client | null)?.end(),
      (signalAttributionPolicyA as
        NodePostgresSignalAttributionPolicyApplyDatabase | null)?.close(),
      (signalAttributionPolicyASecond as
        NodePostgresSignalAttributionPolicyApplyDatabase | null)?.close(),
      (signalAttributionPolicyB as
        NodePostgresSignalAttributionPolicyApplyDatabase | null)?.close(),
      (signalAttributionPolicyC as
        NodePostgresSignalAttributionPolicyApplyDatabase | null)?.close(),
      (signalAttributionPolicyUnmapped as
        NodePostgresSignalAttributionPolicyApplyDatabase | null)?.close(),
      (signalAttributionPolicyDirectClient as Client | null)?.end(),
      (signalReservationLifecycleA as
        NodePostgresSignalReservationLifecycleApplyDatabase | null)?.close(),
      (signalReservationLifecycleASecond as
        NodePostgresSignalReservationLifecycleApplyDatabase | null)?.close(),
      (signalReservationLifecycleB as
        NodePostgresSignalReservationLifecycleApplyDatabase | null)?.close(),
      (signalReservationLifecycleC as
        NodePostgresSignalReservationLifecycleApplyDatabase | null)?.close(),
      (signalReservationLifecycleUnmapped as
        NodePostgresSignalReservationLifecycleApplyDatabase | null)?.close(),
      (signalReservationLifecycleDirectClient as Client | null)?.end(),
      (signalReservationLifecycleLockClient as Client | null)?.end(),
      (signalAttributionReceiptA as
        NodePostgresSignalAttributionReceiptApplyDatabase | null)?.close(),
      (signalAttributionReceiptB as
        NodePostgresSignalAttributionReceiptApplyDatabase | null)?.close(),
      (signalAttributionReceiptC as
        NodePostgresSignalAttributionReceiptApplyDatabase | null)?.close(),
      (signalAttributionReceiptUnmapped as
        NodePostgresSignalAttributionReceiptApplyDatabase | null)?.close(),
      (signalAttributionReceiptDirectClient as Client | null)?.end()
    ].filter(Boolean) as Array<Promise<void>>);
    notificationHandlerDb?.close();
    executionHandlerDb?.close();
    operationalRetentionHandlerDb?.close();
    observerCandidateHandlerDb?.close();
    alertReconciliationHandlerDb?.close();
    observerWitnessHandlerDb?.close();
    await postgres.stop().catch(() => undefined);
    if (existsSync(parent)) rmSync(parent, { recursive: true, force: true });
    if (existsSync(fixture.directory)) rmSync(fixture.directory, { recursive: true, force: true });
  }
});
