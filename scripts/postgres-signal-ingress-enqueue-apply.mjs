#!/usr/bin/env node
import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import { buildPostgresSignalPostIncidentDecisionApplyManifest } from "../dist/packages/database/src/postgres-signal-post-incident-decision-apply.js";
import { buildPostgresSignalMissionBindingApplyManifest } from "../dist/packages/database/src/postgres-signal-mission-binding-apply.js";
import { buildPostgresSignalStrategyEvaluationApplyManifest } from "../dist/packages/database/src/postgres-signal-strategy-evaluation-apply.js";
import { buildPostgresSignalWriterLockProtocolManifest } from "../dist/packages/database/src/postgres-signal-writer-lock-protocol.js";
import { buildPostgresSignalConstraintConfigApplyManifest } from "../dist/packages/database/src/postgres-signal-constraint-config-apply.js";
import { buildPostgresSignalActionSpendApplyManifest } from "../dist/packages/database/src/postgres-signal-action-spend-apply.js";
import { buildPostgresSignalTargetQualificationApplyManifest } from "../dist/packages/database/src/postgres-signal-target-qualification-apply.js";
import { buildPostgresSignalSourceTrustApplyManifest } from "../dist/packages/database/src/postgres-signal-source-trust-apply.js";
import { buildPostgresSignalRetailerQualificationApplyManifest } from "../dist/packages/database/src/postgres-signal-retailer-qualification-apply.js";
import { buildPostgresSignalMissionPolicyApplyManifest } from "../dist/packages/database/src/postgres-signal-mission-policy-apply.js";
import { buildPostgresSignalSourceStatusApplyManifest } from "../dist/packages/database/src/postgres-signal-source-status-apply.js";
import { buildPostgresSignalSourceSyncApplyManifest } from "../dist/packages/database/src/postgres-signal-source-sync-apply.js";
import { buildPostgresSignalReservationLifecycleApplyManifest } from "../dist/packages/database/src/postgres-signal-reservation-lifecycle-apply.js";
import { buildPostgresSignalCatalogImportApplyManifest } from "../dist/packages/database/src/postgres-signal-catalog-import-apply.js";
import { buildPostgresSignalSourceProvisioningApplyManifest } from "../dist/packages/database/src/postgres-signal-source-provisioning-apply.js";
import { buildPostgresSignalAttributionPolicyApplyManifest } from "../dist/packages/database/src/postgres-signal-attribution-policy-apply.js";
import { buildPostgresSignalAttributionReceiptApplyManifest } from "../dist/packages/database/src/postgres-signal-attribution-receipt-apply.js";
import { buildPostgresSignalJobLifecycleApplyManifest } from "../dist/packages/database/src/postgres-signal-job-lifecycle-apply.js";
import { buildPostgresTenantQueueWriteManifest } from "../dist/packages/database/src/postgres-tenant-queue-writes.js";
import {
  applyPostgresSignalIngressEnqueueApplyBoundary,
  buildPostgresSignalIngressEnqueueApplyManifest,
  verifyPostgresSignalIngressEnqueueApplyBoundary
} from "../dist/packages/database/src/postgres-signal-ingress-enqueue-apply.js";

const roleArguments = "[private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace] [terminal_decision_role_namespace] [offer_incident_role_namespace] [post_incident_decision_role_namespace] [mission_binding_role_namespace] [strategy_evaluation_role_namespace] [writer_lock_role_namespace] [constraint_config_role_namespace] [action_spend_role_namespace] [target_qualification_role_namespace] [source_trust_role_namespace] [retailer_qualification_role_namespace] [mission_policy_role_namespace] [source_status_role_namespace] [source_sync_role_namespace] [reservation_lifecycle_role_namespace] [catalog_import_role_namespace] [source_provisioning_role_namespace] [attribution_policy_role_namespace] [attribution_receipt_role_namespace] [job_lifecycle_role_namespace] [ingress_enqueue_role_namespace]";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-ingress-enqueue-apply -- plan ${roleArguments}
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_QUALIFICATION_ACK=bounded-signal-ingress-enqueue-apply-qualification \
    npm run postgres:signal-ingress-enqueue-apply -- apply ${roleArguments}
  YOINK_POSTGRES_URL=... npm run postgres:signal-ingress-enqueue-apply -- verify ${roleArguments}

This creates one qualification-only bounded durable signal-INGRESS-ACCEPTANCE
writer boundary. Its NOLOGIN role has zero direct table or column grants and
can call one exact, server-principal-bound function that accepts one
sanitized TrackaLacker signal envelope for the caller's own tenant/user
principal: message identity and payload hash are derived and revalidated
inside the database, a brand-new envelope inserts one inbox message plus one
append-only delivery receipt, a duplicate envelope appends only its own
delivery receipt with zero inbox mutation, and a conflicting same-identity
payload fails closed before any write.

The already-qualified tenant queue-write boundary is consumed (verify only,
never re-applied here) purely for its fingerprint parity; the companion
hosted_delivery_recovery task-enqueue call the real caller performs on a
fresh accept remains that queue-writer's own concern. SQLite remains
authoritative and the durable-ingress composition -- this boundary plus the
lease/dequeue and resolution-plan functions -- stays open.
`);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/acknowledgement is required/i.test(message)) {
    return "qualification_acknowledgement_required";
  }
  if (/YOINK_POSTGRES_URL|TLS|loopback|certificate|namespace|schema is invalid|identifier limit/i.test(message)) {
    return "configuration_invalid";
  }
  if (/job-lifecycle|attribution-receipt|attribution-policy|source-provisioning|catalog-import|reservation-lifecycle|source-sync|source-status|mission-policy|retailer-qualification|source-trust|Target qualification|action\/spend|constraint-configuration|writer-lock|strategy-evaluation|mission-binding|post-incident|offer-incident|terminal-decision|source-reference|signal-resolution|signal-catalog|hosted-delivery|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate|refuses/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|inherit another role|attribute|principal|boundary|protected table|mutation table|drift/i.test(message)) {
    return "signal_ingress_enqueue_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_ingress_enqueue_preflight_failed";
  }
  return "postgres_signal_ingress_enqueue_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace, candidateRoleNamespace,
  dispatchRoleNamespace, reconciliationRoleNamespace, witnessRoleNamespace,
  deliveryLeaseRoleNamespace, catalogApplyRoleNamespace,
  resolutionApplyRoleNamespace, sourceReferenceRoleNamespace,
  terminalDecisionRoleNamespace, offerIncidentRoleNamespace,
  postIncidentDecisionRoleNamespace, missionBindingRoleNamespace,
  strategyEvaluationRoleNamespace, writerLockRoleNamespace,
  constraintConfigRoleNamespace, actionSpendRoleNamespace,
  targetQualificationRoleNamespace, sourceTrustRoleNamespace,
  retailerQualificationRoleNamespace, missionPolicyRoleNamespace,
  sourceStatusRoleNamespace, sourceSyncRoleNamespace,
  reservationLifecycleRoleNamespace, catalogImportRoleNamespace,
  sourceProvisioningRoleNamespace, attributionPolicyRoleNamespace,
  attributionReceiptRoleNamespace, jobLifecycleRoleNamespace,
  ingressEnqueueRoleNamespace] = process.argv.slice(2);
const predecessorArgs = [
  schemaName, readRoleNamespace, sessionRoleNamespace, queueRoleNamespace,
  controlRoleNamespace, notificationRoleNamespace, executionRoleNamespace,
  retentionRoleNamespace, candidateRoleNamespace, dispatchRoleNamespace,
  reconciliationRoleNamespace, witnessRoleNamespace, deliveryLeaseRoleNamespace,
  catalogApplyRoleNamespace, resolutionApplyRoleNamespace,
  sourceReferenceRoleNamespace, terminalDecisionRoleNamespace,
  offerIncidentRoleNamespace, postIncidentDecisionRoleNamespace
];
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else {
    const postIncidentManifest =
      buildPostgresSignalPostIncidentDecisionApplyManifest(...predecessorArgs);
    const missionBindingManifest = buildPostgresSignalMissionBindingApplyManifest(
      postIncidentManifest,
      missionBindingRoleNamespace
    );
    const strategyEvaluationManifest = buildPostgresSignalStrategyEvaluationApplyManifest(
      missionBindingManifest,
      strategyEvaluationRoleNamespace
    );
    const writerLockManifest = buildPostgresSignalWriterLockProtocolManifest(
      strategyEvaluationManifest,
      writerLockRoleNamespace
    );
    const constraintConfigManifest = buildPostgresSignalConstraintConfigApplyManifest(
      writerLockManifest,
      constraintConfigRoleNamespace
    );
    const actionSpendManifest = buildPostgresSignalActionSpendApplyManifest(
      constraintConfigManifest,
      actionSpendRoleNamespace
    );
    const targetQualificationManifest = buildPostgresSignalTargetQualificationApplyManifest(
      actionSpendManifest,
      targetQualificationRoleNamespace
    );
    const sourceTrustManifest = buildPostgresSignalSourceTrustApplyManifest(
      targetQualificationManifest,
      sourceTrustRoleNamespace
    );
    const retailerQualificationManifest =
      buildPostgresSignalRetailerQualificationApplyManifest(
        sourceTrustManifest,
        retailerQualificationRoleNamespace
      );
    const missionPolicyManifest = buildPostgresSignalMissionPolicyApplyManifest(
      retailerQualificationManifest,
      missionPolicyRoleNamespace
    );
    const sourceStatusManifest = buildPostgresSignalSourceStatusApplyManifest(
      missionPolicyManifest,
      sourceStatusRoleNamespace
    );
    const sourceSyncManifest = buildPostgresSignalSourceSyncApplyManifest(
      sourceStatusManifest,
      sourceSyncRoleNamespace
    );
    const reservationLifecycleManifest = buildPostgresSignalReservationLifecycleApplyManifest(
      sourceSyncManifest,
      reservationLifecycleRoleNamespace
    );
    const catalogImportManifest = buildPostgresSignalCatalogImportApplyManifest(
      reservationLifecycleManifest,
      catalogImportRoleNamespace
    );
    const sourceProvisioningManifest = buildPostgresSignalSourceProvisioningApplyManifest(
      catalogImportManifest,
      sourceProvisioningRoleNamespace
    );
    const attributionPolicyManifest = buildPostgresSignalAttributionPolicyApplyManifest(
      sourceProvisioningManifest,
      attributionPolicyRoleNamespace
    );
    const attributionReceiptManifest = buildPostgresSignalAttributionReceiptApplyManifest(
      attributionPolicyManifest,
      attributionReceiptRoleNamespace
    );
    // Built for full chain/namespace-uniqueness parity with every other
    // script in this family, mirroring postgres-signal-job-lifecycle-apply.mjs's
    // own discarded predecessor build -- but NOT this boundary's functional
    // predecessor: postgres-signal-ingress-enqueue-apply.ts's own default
    // predecessor argument is the attribution-receipt manifest built above,
    // not the job-lifecycle manifest built (and discarded) here.
    buildPostgresSignalJobLifecycleApplyManifest(
      attributionPolicyManifest,
      jobLifecycleRoleNamespace
    );
    // The already-qualified tenant queue-write boundary this module binds
    // (verify only -- see postgres-signal-ingress-enqueue-apply.ts's own
    // module header section 2), built from the SAME schema/read/session/
    // queue-write namespaces threaded through the whole family so its
    // fingerprint matches the one live-qualified role, not a fresh one.
    const queueWriteManifest = buildPostgresTenantQueueWriteManifest(
      schemaName,
      readRoleNamespace,
      sessionRoleNamespace,
      queueRoleNamespace
    );
    const manifest = buildPostgresSignalIngressEnqueueApplyManifest(
      attributionReceiptManifest,
      ingressEnqueueRoleNamespace,
      queueWriteManifest
    );
    if (command === "plan") {
      print({ operation: "postgres_signal_ingress_enqueue_apply_plan", manifest });
    } else {
      if (command === "apply"
        && process.env.YOINK_POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_QUALIFICATION_ACK
          !== "bounded-signal-ingress-enqueue-apply-qualification") {
        throw new Error("A bounded PostgreSQL signal-ingress enqueue acknowledgement is required.");
      }
      database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
      if (command === "apply") {
        print({
          operation: "postgres_signal_ingress_enqueue_apply",
          receipt: await applyPostgresSignalIngressEnqueueApplyBoundary(database, manifest)
        });
      } else {
        print({
          operation: "postgres_signal_ingress_enqueue_verify",
          receipt: await verifyPostgresSignalIngressEnqueueApplyBoundary(database, manifest)
        });
      }
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL signal-ingress enqueue operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
