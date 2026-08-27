#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import { buildPostgresSignalPostIncidentDecisionApplyManifest } from "../dist/packages/database/src/postgres-signal-post-incident-decision-apply.js";
import { buildPostgresSignalMissionBindingApplyManifest } from "../dist/packages/database/src/postgres-signal-mission-binding-apply.js";
import { buildPostgresSignalStrategyEvaluationApplyManifest } from "../dist/packages/database/src/postgres-signal-strategy-evaluation-apply.js";
import {
  applyPostgresSignalWriterLockProtocolBoundary,
  buildPostgresSignalWriterLockProtocolManifest,
  verifyPostgresSignalWriterLockProtocolBoundary
} from "../dist/packages/database/src/postgres-signal-writer-lock-protocol.js";

const roleArguments = "[private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace] [terminal_decision_role_namespace] [offer_incident_role_namespace] [post_incident_decision_role_namespace] [mission_binding_role_namespace] [strategy_evaluation_role_namespace] [writer_lock_role_namespace]";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-writer-lock-protocol -- plan ${roleArguments}
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_QUALIFICATION_ACK=bounded-signal-writer-lock-protocol-qualification \
    npm run postgres:signal-writer-lock-protocol -- apply ${roleArguments}
  YOINK_POSTGRES_URL=... npm run postgres:signal-writer-lock-protocol -- verify ${roleArguments}

This creates one qualification-only, lock-only protocol for the source,
retailer-qualification, settings, mission-policy, and spend domains. Its
NOLOGIN role has zero direct table or column grants and no mutation authority.
The reviewed action/spend boundary consumes the same database-owned fixed lock
order. Existing configuration and reservation writers are not yet ported, so
writer-lock parity, runtime principals, and the SQLite authority switch remain
closed.
`);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/acknowledgement is required/i.test(message)) return "qualification_acknowledgement_required";
  if (/YOINK_POSTGRES_URL|TLS|loopback|certificate|namespace|schema is invalid|identifier limit/i.test(message)) return "configuration_invalid";
  if (/strategy-evaluation|mission-binding|post-incident|offer-incident|terminal-decision|source-reference|signal-resolution|signal-catalog|hosted-delivery|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) return "prerequisite_contract_invalid";
  if (/existing role|function|guard|receipt|already exists|duplicate|refuses/i.test(message)) return "qualification_target_reused";
  if (/grant|privilege|membership|inherit another role|attribute|principal|boundary|protected table|mutation table|drift/i.test(message)) return "signal_writer_lock_verification_failed";
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) return "signal_writer_lock_preflight_failed";
  return "postgres_signal_writer_lock_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace, candidateRoleNamespace,
  dispatchRoleNamespace, reconciliationRoleNamespace, witnessRoleNamespace,
  deliveryLeaseRoleNamespace, catalogApplyRoleNamespace,
  resolutionApplyRoleNamespace, sourceReferenceRoleNamespace,
  terminalDecisionRoleNamespace, offerIncidentRoleNamespace,
  postIncidentDecisionRoleNamespace, missionBindingRoleNamespace,
  strategyEvaluationRoleNamespace, writerLockRoleNamespace] = process.argv.slice(2);
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
    const manifest = buildPostgresSignalWriterLockProtocolManifest(
      strategyEvaluationManifest,
      writerLockRoleNamespace
    );
    if (command === "plan") {
      print({ operation: "postgres_signal_writer_lock_protocol_plan", manifest });
    } else {
      if (command === "apply"
        && process.env.YOINK_POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_QUALIFICATION_ACK
          !== "bounded-signal-writer-lock-protocol-qualification") {
        throw new Error("A bounded PostgreSQL signal writer-lock qualification acknowledgement is required.");
      }
      database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
      if (command === "apply") {
        print({
          operation: "postgres_signal_writer_lock_protocol_apply",
          receipt: await applyPostgresSignalWriterLockProtocolBoundary(database, manifest)
        });
      } else {
        print({
          operation: "postgres_signal_writer_lock_protocol_verify",
          receipt: await verifyPostgresSignalWriterLockProtocolBoundary(database, manifest)
        });
      }
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL signal writer-lock operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
