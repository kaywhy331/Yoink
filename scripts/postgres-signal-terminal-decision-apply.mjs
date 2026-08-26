#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresSignalTerminalDecisionApplyBoundary,
  buildPostgresSignalTerminalDecisionApplyManifest,
  verifyPostgresSignalTerminalDecisionApplyBoundary
} from "../dist/packages/database/src/postgres-signal-terminal-decision-apply.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-terminal-decision-apply -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace] [terminal_decision_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_QUALIFICATION_ACK=bounded-signal-terminal-decision-apply-qualification \\
    npm run postgres:signal-terminal-decision-apply -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace] [terminal_decision_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:signal-terminal-decision-apply -- verify \\
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace] [terminal_decision_role_namespace]

The command creates one qualification-only terminal signal-decision boundary.
Its separate NOLOGIN role has zero direct table or column grants and can execute
one exact server-principal-bound function. For a leased TrackaLacker signal
whose event, resolution, and source-reference step are already settled, it may
insert only the occurrence, terminal mission decision, audit, and outbox rows.

Test, unresolved, ambiguous, and non-actionable signals terminate through this
boundary. Actionable matched signals are mutation-free and continue to a later
separately qualified graph. Shared catalog, source references, incidents,
offers, missions, actions, inbox state, runtime principals, and retailer
sessions remain closed. SQLite stays authoritative and handler parity stays
6/7.
`);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/acknowledgement is required/i.test(message)) return "qualification_acknowledgement_required";
  if (/YOINK_POSTGRES_URL|TLS|loopback|certificate|namespace|schema is invalid/i.test(message)) {
    return "configuration_invalid";
  }
  if (/source-reference|signal-resolution|signal-catalog|hosted-delivery|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate|refuses to reuse/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|function|protected table|mutation table/i.test(message)) {
    return "signal_terminal_decision_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_terminal_decision_preflight_failed";
  }
  return "postgres_signal_terminal_decision_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace, candidateRoleNamespace,
  dispatchRoleNamespace, reconciliationRoleNamespace, witnessRoleNamespace,
  deliveryLeaseRoleNamespace, catalogApplyRoleNamespace,
  resolutionApplyRoleNamespace, sourceReferenceRoleNamespace,
  terminalDecisionRoleNamespace] = process.argv.slice(2);
const args = [
  schemaName,
  readRoleNamespace,
  sessionRoleNamespace,
  queueRoleNamespace,
  controlRoleNamespace,
  notificationRoleNamespace,
  executionRoleNamespace,
  retentionRoleNamespace,
  candidateRoleNamespace,
  dispatchRoleNamespace,
  reconciliationRoleNamespace,
  witnessRoleNamespace,
  deliveryLeaseRoleNamespace,
  catalogApplyRoleNamespace,
  resolutionApplyRoleNamespace,
  sourceReferenceRoleNamespace,
  terminalDecisionRoleNamespace
];
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_signal_terminal_decision_apply_plan",
      manifest: buildPostgresSignalTerminalDecisionApplyManifest(...args)
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_QUALIFICATION_ACK
        !== "bounded-signal-terminal-decision-apply-qualification") {
      throw new Error(
        "A bounded PostgreSQL signal terminal-decision qualification acknowledgement is required."
      );
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_signal_terminal_decision_apply",
        receipt: await applyPostgresSignalTerminalDecisionApplyBoundary(database, ...args)
      });
    } else {
      print({
        operation: "postgres_signal_terminal_decision_verify",
        receipt: await verifyPostgresSignalTerminalDecisionApplyBoundary(database, ...args)
      });
    }
  }
} catch (error) {
  process.stderr.write(
    `Yoink PostgreSQL signal terminal-decision operation failed safely (${safeFailureCode(error)}).\n`
  );
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
