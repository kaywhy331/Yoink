#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import { buildPostgresSignalPostIncidentDecisionApplyManifest } from "../dist/packages/database/src/postgres-signal-post-incident-decision-apply.js";
import { buildPostgresSignalMissionBindingApplyManifest } from "../dist/packages/database/src/postgres-signal-mission-binding-apply.js";
import { buildPostgresSignalStrategyEvaluationApplyManifest } from "../dist/packages/database/src/postgres-signal-strategy-evaluation-apply.js";
import { buildPostgresSignalWriterLockProtocolManifest } from "../dist/packages/database/src/postgres-signal-writer-lock-protocol.js";
import {
  applyPostgresSignalConstraintConfigApplyBoundary,
  buildPostgresSignalConstraintConfigApplyManifest,
  verifyPostgresSignalConstraintConfigApplyBoundary
} from "../dist/packages/database/src/postgres-signal-constraint-config-apply.js";

const roleArguments = "[private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace] [terminal_decision_role_namespace] [offer_incident_role_namespace] [post_incident_decision_role_namespace] [mission_binding_role_namespace] [strategy_evaluation_role_namespace] [writer_lock_role_namespace] [constraint_config_role_namespace]";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-constraint-config-apply -- plan ${roleArguments}
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_QUALIFICATION_ACK=bounded-signal-constraint-config-apply-qualification \
    npm run postgres:signal-constraint-config-apply -- apply ${roleArguments}
  YOINK_POSTGRES_URL=... npm run postgres:signal-constraint-config-apply -- verify ${roleArguments}

This creates one qualification-only constraint-configuration writer for the
user action-pause, guardrail-settings, and spend-policy operations. Its NOLOGIN
role has zero direct table or column grants. Every mutation authenticates the
server-bound principal, consumes the shared settings or spend lock, enforces
optimistic concurrency, and atomically appends deterministic audit/outbox
receipts.

Qualification-settings, source, retailer-qualification, mission-policy,
strategy, and reservation writers are not yet ported. Whole-system writer-lock
parity, runtime principals, and the SQLite authority switch remain closed.
`);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/acknowledgement is required/i.test(message)) return "qualification_acknowledgement_required";
  if (/YOINK_POSTGRES_URL|TLS|loopback|certificate|namespace|schema is invalid|identifier limit/i.test(message)) return "configuration_invalid";
  if (/writer-lock|strategy-evaluation|mission-binding|post-incident|offer-incident|terminal-decision|source-reference|signal-resolution|signal-catalog|hosted-delivery|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) return "prerequisite_contract_invalid";
  if (/existing role|function|guard|receipt|already exists|duplicate|refuses/i.test(message)) return "qualification_target_reused";
  if (/grant|privilege|membership|inherit another role|attribute|principal|boundary|protected table|mutation table|drift/i.test(message)) return "signal_constraint_config_verification_failed";
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) return "signal_constraint_config_preflight_failed";
  return "postgres_signal_constraint_config_operation_failed";
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
  constraintConfigRoleNamespace] = process.argv.slice(2);
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
    const manifest = buildPostgresSignalConstraintConfigApplyManifest(
      writerLockManifest,
      constraintConfigRoleNamespace
    );
    if (command === "plan") {
      print({ operation: "postgres_signal_constraint_config_apply_plan", manifest });
    } else {
      if (command === "apply"
        && process.env.YOINK_POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_QUALIFICATION_ACK
          !== "bounded-signal-constraint-config-apply-qualification") {
        throw new Error("A bounded PostgreSQL signal constraint-configuration qualification acknowledgement is required.");
      }
      database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
      if (command === "apply") {
        print({
          operation: "postgres_signal_constraint_config_apply",
          receipt: await applyPostgresSignalConstraintConfigApplyBoundary(database, manifest)
        });
      } else {
        print({
          operation: "postgres_signal_constraint_config_verify",
          receipt: await verifyPostgresSignalConstraintConfigApplyBoundary(database, manifest)
        });
      }
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL signal constraint-configuration operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
