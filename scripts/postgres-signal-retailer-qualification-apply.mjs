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
import {
  applyPostgresSignalRetailerQualificationApplyBoundary,
  buildPostgresSignalRetailerQualificationApplyManifest,
  verifyPostgresSignalRetailerQualificationApplyBoundary
} from "../dist/packages/database/src/postgres-signal-retailer-qualification-apply.js";

const roleArguments = "[private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace] [terminal_decision_role_namespace] [offer_incident_role_namespace] [post_incident_decision_role_namespace] [mission_binding_role_namespace] [strategy_evaluation_role_namespace] [writer_lock_role_namespace] [constraint_config_role_namespace] [action_spend_role_namespace] [target_qualification_role_namespace] [source_trust_role_namespace] [retailer_qualification_role_namespace]";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-retailer-qualification-apply -- plan ${roleArguments}
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_QUALIFICATION_ACK=bounded-signal-retailer-qualification-apply-qualification \
    npm run postgres:signal-retailer-qualification-apply -- apply ${roleArguments}
  YOINK_POSTGRES_URL=... npm run postgres:signal-retailer-qualification-apply -- verify ${roleArguments}

This creates one qualification-only activation boundary for exactly Walmart,
Amazon, and Best Buy. Its NOLOGIN role has zero direct table or column grants
and can call one server-principal-bound function. PostgreSQL revalidates the
selected retailer's exact current 30-day evidence, no-click rehearsal, and
Chrome capability; consumes retailer-qualification plus settings locks; then
takes a retailer-global catalog lock. One transaction may qualify the user's
fixed add-only adapter, monotonically enable only that packaged retailer and
its existing listings, promote eligible shadow jobs only when actions are
already live and unpaused, and append immutable audit/outbox receipts.

Arbitrary retailers or listings, catalog disable/retirement, source lifecycle,
strategy and mission-policy writers, reservations, attribution-policy parity,
retailer DOM mutation, checkout, order submission, runtime principals, and
the SQLite authority switch stay closed. SQLite remains authoritative.
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
  if (/source-trust|Target qualification|action\/spend|constraint-configuration|writer-lock|strategy-evaluation|mission-binding|post-incident|offer-incident|terminal-decision|source-reference|signal-resolution|signal-catalog|hosted-delivery|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate|refuses/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|inherit another role|attribute|principal|boundary|protected table|mutation table|drift/i.test(message)) {
    return "signal_retailer_qualification_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_retailer_qualification_preflight_failed";
  }
  return "postgres_signal_retailer_qualification_operation_failed";
}

const [
  command, schemaName, readRoleNamespace, sessionRoleNamespace,
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
  retailerQualificationRoleNamespace
] = process.argv.slice(2);
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
    const manifest = buildPostgresSignalRetailerQualificationApplyManifest(
      sourceTrustManifest,
      retailerQualificationRoleNamespace
    );
    if (command === "plan") {
      print({
        operation: "postgres_signal_retailer_qualification_apply_plan",
        manifest
      });
    } else {
      if (command === "apply"
        && process.env.YOINK_POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_QUALIFICATION_ACK
          !== "bounded-signal-retailer-qualification-apply-qualification") {
        throw new Error(
          "A bounded PostgreSQL signal retailer-qualification acknowledgement is required."
        );
      }
      database = new NodePostgresCutoverDatabase(
        loadPostgresCutoverConnectionConfig()
      );
      if (command === "apply") {
        print({
          operation: "postgres_signal_retailer_qualification_apply",
          receipt: await applyPostgresSignalRetailerQualificationApplyBoundary(
            database,
            manifest
          )
        });
      } else {
        print({
          operation: "postgres_signal_retailer_qualification_verify",
          receipt: await verifyPostgresSignalRetailerQualificationApplyBoundary(
            database,
            manifest
          )
        });
      }
    }
  }
} catch (error) {
  process.stderr.write(
    `Yoink PostgreSQL retailer-qualification operation failed safely (${safeFailureCode(error)}).\n`
  );
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
