#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresExecutionRecoveryBoundary,
  buildPostgresExecutionRecoveryManifest,
  verifyPostgresExecutionRecoveryBoundary
} from "../dist/packages/database/src/postgres-execution-recovery.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:execution-recovery -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_EXECUTION_RECOVERY_QUALIFICATION_ACK=bounded-execution-recovery-qualification \
    npm run postgres:execution-recovery -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:execution-recovery -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace]

The command creates one qualification-only execution-recovery handler role.
It has zero direct table or column grants and may execute exactly one bounded,
server-principal-bound, server-clocked function. That function can only retire
expired action leases, close expired unleased action windows, release expired
spend reservations, and append their existing action, ledger, audit, and outbox
receipts. Shared incidents are changed only when every bound action and signal
occurrence belongs to the exact caller; otherwise incident mutation fails
closed. Login, membership, checkout, order submission, runtime authority, and
retailer capabilities remain absent.
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
  if (/notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|function|protected-table/i.test(message)) {
    return "execution_recovery_verification_failed";
  }
  if (/server|CREATEROLE|control role|BYPASSRLS/i.test(message)) {
    return "execution_recovery_preflight_failed";
  }
  return "postgres_execution_recovery_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_execution_recovery_plan",
      manifest: buildPostgresExecutionRecoveryManifest(
        schemaName,
        readRoleNamespace,
        sessionRoleNamespace,
        queueRoleNamespace,
        controlRoleNamespace,
        notificationRoleNamespace,
        executionRoleNamespace
      )
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_EXECUTION_RECOVERY_QUALIFICATION_ACK
        !== "bounded-execution-recovery-qualification") {
      throw new Error("A bounded PostgreSQL execution-recovery qualification acknowledgement is required.");
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_execution_recovery_apply",
        receipt: await applyPostgresExecutionRecoveryBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace,
          queueRoleNamespace,
          controlRoleNamespace,
          notificationRoleNamespace,
          executionRoleNamespace
        )
      });
    } else {
      print({
        operation: "postgres_execution_recovery_verify",
        receipt: await verifyPostgresExecutionRecoveryBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace,
          queueRoleNamespace,
          controlRoleNamespace,
          notificationRoleNamespace,
          executionRoleNamespace
        )
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL execution-recovery operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
