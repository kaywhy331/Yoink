#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresOperatorAlertConnectorDispatchBoundary,
  buildPostgresOperatorAlertConnectorDispatchManifest,
  verifyPostgresOperatorAlertConnectorDispatchBoundary
} from "../dist/packages/database/src/postgres-operator-alert-connector-dispatch.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:alert-dispatch -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_ALERT_DISPATCH_QUALIFICATION_ACK=bounded-operator-alert-dispatch-qualification \
    npm run postgres:alert-dispatch -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:alert-dispatch -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace]

The command creates one qualification-only connector-dispatch sub-boundary.
Its NOLOGIN role has zero direct table or column grants and may execute one
server-principal-bound function. The function can lease at most 20 sanitized
webhook deliveries per run, uses the database server clock, accepts only
deployment-owned endpoint references and fingerprints, and never exposes raw
URLs or signing secrets. Application-generated capabilities are stored only as
one-use hashes. This does not qualify alert reconciliation, count as handler
five, provision a login, activate a principal, contact a webhook, or grant
runtime authority.
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
  if (/observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|function|protected table|protected-table/i.test(message)) {
    return "alert_dispatch_verification_failed";
  }
  if (/server|CREATEROLE|control role|BYPASSRLS/i.test(message)) {
    return "alert_dispatch_preflight_failed";
  }
  return "postgres_alert_dispatch_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace, candidateRoleNamespace,
  dispatchRoleNamespace] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_operator_alert_dispatch_plan",
      manifest: buildPostgresOperatorAlertConnectorDispatchManifest(
        schemaName,
        readRoleNamespace,
        sessionRoleNamespace,
        queueRoleNamespace,
        controlRoleNamespace,
        notificationRoleNamespace,
        executionRoleNamespace,
        retentionRoleNamespace,
        candidateRoleNamespace,
        dispatchRoleNamespace
      )
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_ALERT_DISPATCH_QUALIFICATION_ACK
        !== "bounded-operator-alert-dispatch-qualification") {
      throw new Error("A bounded PostgreSQL operator-alert dispatch qualification acknowledgement is required.");
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_operator_alert_dispatch_apply",
        receipt: await applyPostgresOperatorAlertConnectorDispatchBoundary(
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
          dispatchRoleNamespace
        )
      });
    } else {
      print({
        operation: "postgres_operator_alert_dispatch_verify",
        receipt: await verifyPostgresOperatorAlertConnectorDispatchBoundary(
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
          dispatchRoleNamespace
        )
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL operator-alert dispatch operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
