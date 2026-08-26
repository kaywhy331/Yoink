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
import { YoinkDatabase } from "../packages/database/src/database.js";
import { stableHash } from "../packages/domain/src/ids.js";
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
       ) VALUES ($1, $2, $3, $4, 1, 9, 'USD', 2500, 'submit_order',
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

test("native PostgreSQL proves server-bound reads, queue writes, fleet control, six handlers, hosted signal lifecycle, resolution planning, and insert-only catalog creation", {
  timeout: 600_000
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
    assert.equal(
      await deliveryLeaseRecoveryA.completeSignalInbox(
        { tenantId: NATIVE_TENANT, userId: NATIVE_USER },
        concurrentCatalogSignalId,
        concurrentCatalogLease.capabilityToken,
        resolutionPlanNow + 2_000
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
      signalCatalogApplyDirectClient?.end()
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
