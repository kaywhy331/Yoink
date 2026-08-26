#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresOperatorAlertReconciliationBoundary,
  buildPostgresOperatorAlertReconciliationManifest,
  verifyPostgresOperatorAlertReconciliationBoundary
} from "../dist/packages/database/src/postgres-operator-alert-reconciliation.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:alert-reconciliation -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_ALERT_RECONCILIATION_QUALIFICATION_ACK=bounded-operator-alert-reconciliation-qualification \
    npm run postgres:alert-reconciliation -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:alert-reconciliation -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace]

The command creates one qualification-only diagnostic-to-incident reconciliation
boundary. Its NOLOGIN role has zero direct table or column grants and may execute
one server-principal-bound function. The function derives bounded sanitized repair
groups, revalidates a two-phase plan, serializes each user, writes aggregate alert
lifecycle receipts, and queues only endpoint references. It cannot read raw webhook
URLs or secrets, contact a webhook, provision a login, activate a principal, grant
runtime authority, or mutate any retailer.
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
  if (/alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|function|protected table|protected-table/i.test(message)) {
    return "alert_reconciliation_verification_failed";
  }
  if (/server|CREATEROLE|control role|BYPASSRLS/i.test(message)) {
    return "alert_reconciliation_preflight_failed";
  }
  return "postgres_alert_reconciliation_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace, candidateRoleNamespace,
  dispatchRoleNamespace, reconciliationRoleNamespace] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_operator_alert_reconciliation_plan",
      manifest: buildPostgresOperatorAlertReconciliationManifest(
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
        reconciliationRoleNamespace
      )
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_ALERT_RECONCILIATION_QUALIFICATION_ACK
        !== "bounded-operator-alert-reconciliation-qualification") {
      throw new Error("A bounded PostgreSQL operator-alert reconciliation qualification acknowledgement is required.");
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_operator_alert_reconciliation_apply",
        receipt: await applyPostgresOperatorAlertReconciliationBoundary(
          database,
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
          reconciliationRoleNamespace
        )
      });
    } else {
      print({
        operation: "postgres_operator_alert_reconciliation_verify",
        receipt: await verifyPostgresOperatorAlertReconciliationBoundary(
          database,
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
          reconciliationRoleNamespace
        )
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL operator-alert reconciliation operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
