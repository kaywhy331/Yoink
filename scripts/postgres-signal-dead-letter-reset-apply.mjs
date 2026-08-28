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
import { buildPostgresSignalIngressEnqueueApplyManifest } from "../dist/packages/database/src/postgres-signal-ingress-enqueue-apply.js";
import {
  applyPostgresSignalDeadLetterResetApplyBoundary,
  buildPostgresSignalDeadLetterResetApplyManifest,
  verifyPostgresSignalDeadLetterResetApplyBoundary
} from "../dist/packages/database/src/postgres-signal-dead-letter-reset-apply.js";

const roleArguments = "[private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace] [terminal_decision_role_namespace] [offer_incident_role_namespace] [post_incident_decision_role_namespace] [mission_binding_role_namespace] [strategy_evaluation_role_namespace] [writer_lock_role_namespace] [constraint_config_role_namespace] [action_spend_role_namespace] [target_qualification_role_namespace] [source_trust_role_namespace] [retailer_qualification_role_namespace] [mission_policy_role_namespace] [source_status_role_namespace] [source_sync_role_namespace] [reservation_lifecycle_role_namespace] [catalog_import_role_namespace] [source_provisioning_role_namespace] [attribution_policy_role_namespace] [attribution_receipt_role_namespace] [job_lifecycle_role_namespace] [ingress_enqueue_role_namespace] [dead_letter_reset_role_namespace]";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-dead-letter-reset-apply -- plan ${roleArguments}
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_QUALIFICATION_ACK=bounded-signal-dead-letter-reset-apply-qualification \
    npm run postgres:signal-dead-letter-reset-apply -- apply ${roleArguments}
  YOINK_POSTGRES_URL=... npm run postgres:signal-dead-letter-reset-apply -- verify ${roleArguments}

This creates one qualification-only bounded operator dead-letter INBOX-RESET
writer boundary. Its NOLOGIN role has zero direct table or column grants and
can call one exact, server-principal-bound function that resets one
operator-selected dead-lettered signal inbox message through a fail-closed
dead-letter-state precondition: the reset appends its own
receipt-hash-verified delivery ledger row plus one audit and outbox pair, a
legitimately re-dead-lettered message may be reset again, and replays echo
the original audited result.

The already-qualified post-creation job-lifecycle writer is consumed (verify
only, never re-applied here) purely for its fingerprint parity. SQLite
remains authoritative -- this closes the dead-letter-reset family while the
final handler composition stays open.
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
  if (/job-lifecycle|signal-ingress|attribution-receipt|attribution-policy|source-provisioning|catalog-import|reservation-lifecycle|source-sync|source-status|mission-policy|retailer-qualification|source-trust|Target qualification|action\/spend|constraint-configuration|writer-lock|strategy-evaluation|mission-binding|post-incident|offer-incident|terminal-decision|source-reference|signal-resolution|signal-catalog|hosted-delivery|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate|refuses/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|inherit another role|attribute|principal|boundary|protected table|mutation table|drift/i.test(message)) {
    return "signal_dead_letter_reset_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_dead_letter_reset_preflight_failed";
  }
  return "postgres_signal_dead_letter_reset_operation_failed";
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
  ingressEnqueueRoleNamespace, deadLetterResetRoleNamespace] = process.argv.slice(2);
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
    // Built for full chain/namespace-uniqueness parity with every other
    // script in this family, mirroring postgres-signal-job-lifecycle-apply.mjs's
    // own discarded predecessor build -- but NOT this boundary's functional
    // predecessor: postgres-signal-dead-letter-reset-apply.ts's own default
    // predecessor argument is the job-lifecycle manifest built below, not
    // the attribution-receipt manifest built here. Feeds only the
    // ingress-enqueue manifest discarded further below.
    const attributionReceiptManifest = buildPostgresSignalAttributionReceiptApplyManifest(
      attributionPolicyManifest,
      attributionReceiptRoleNamespace
    );
    // The REAL predecessor -- postgres-signal-dead-letter-reset-apply.ts's
    // own default predecessor argument, built the identical way
    // postgres-signal-job-lifecycle-apply.mjs's own script builds it (from
    // attributionPolicyManifest, not attributionReceiptManifest; see that
    // module's own header section 3 "Judgment calls").
    const jobLifecycleManifest = buildPostgresSignalJobLifecycleApplyManifest(
      attributionPolicyManifest,
      jobLifecycleRoleNamespace
    );
    // The already-qualified tenant queue-write boundary
    // postgres-signal-ingress-enqueue-apply.ts's own manifest binds (verify
    // only, never re-applied there) -- built here only to feed the
    // ingress-enqueue manifest discarded immediately below, for full
    // chain/namespace-uniqueness parity with the newest sibling script.
    const queueWriteManifest = buildPostgresTenantQueueWriteManifest(
      schemaName,
      readRoleNamespace,
      sessionRoleNamespace,
      queueRoleNamespace
    );
    // Built for full chain/namespace-uniqueness parity with the newest
    // sibling script in this family -- but NOT this boundary's functional
    // predecessor; see the two comments above.
    buildPostgresSignalIngressEnqueueApplyManifest(
      attributionReceiptManifest,
      ingressEnqueueRoleNamespace,
      queueWriteManifest
    );
    const manifest = buildPostgresSignalDeadLetterResetApplyManifest(
      jobLifecycleManifest,
      deadLetterResetRoleNamespace
    );
    if (command === "plan") {
      print({ operation: "postgres_signal_dead_letter_reset_apply_plan", manifest });
    } else {
      if (command === "apply"
        && process.env.YOINK_POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_QUALIFICATION_ACK
          !== "bounded-signal-dead-letter-reset-apply-qualification") {
        throw new Error("A bounded PostgreSQL signal dead-letter reset acknowledgement is required.");
      }
      database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
      if (command === "apply") {
        print({
          operation: "postgres_signal_dead_letter_reset_apply",
          receipt: await applyPostgresSignalDeadLetterResetApplyBoundary(database, manifest)
        });
      } else {
        print({
          operation: "postgres_signal_dead_letter_reset_verify",
          receipt: await verifyPostgresSignalDeadLetterResetApplyBoundary(database, manifest)
        });
      }
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL signal dead-letter reset operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
