#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresNotificationRecoveryBoundary,
  buildPostgresNotificationRecoveryManifest,
  verifyPostgresNotificationRecoveryBoundary
} from "../dist/packages/database/src/postgres-notification-recovery.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:notification-recovery -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [recovery_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_NOTIFICATION_RECOVERY_QUALIFICATION_ACK=bounded-notification-recovery-qualification \
    npm run postgres:notification-recovery -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [recovery_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:notification-recovery -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [recovery_role_namespace]

The command creates one qualification-only notification-recovery handler role.
It has zero direct table or column grants and may execute exactly one bounded,
server-principal-bound, server-clocked function. That function can only expire notifications
whose action window closed, fail exhausted delivery leases, or requeue an
expired lease below the attempt limit. It returns aggregate counts, never row
content. Login, membership, insert, delete, other handler families, runtime
authority, and retailer capabilities remain absent.
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
  if (/worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|function/i.test(message)) {
    return "notification_recovery_verification_failed";
  }
  if (/server|CREATEROLE|control role|BYPASSRLS/i.test(message)) {
    return "notification_recovery_preflight_failed";
  }
  return "postgres_notification_recovery_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, recoveryRoleNamespace] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_notification_recovery_plan",
      manifest: buildPostgresNotificationRecoveryManifest(
        schemaName,
        readRoleNamespace,
        sessionRoleNamespace,
        queueRoleNamespace,
        controlRoleNamespace,
        recoveryRoleNamespace
      )
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_NOTIFICATION_RECOVERY_QUALIFICATION_ACK
        !== "bounded-notification-recovery-qualification") {
      throw new Error("A bounded PostgreSQL notification-recovery qualification acknowledgement is required.");
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_notification_recovery_apply",
        receipt: await applyPostgresNotificationRecoveryBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace,
          queueRoleNamespace,
          controlRoleNamespace,
          recoveryRoleNamespace
        )
      });
    } else {
      print({
        operation: "postgres_notification_recovery_verify",
        receipt: await verifyPostgresNotificationRecoveryBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace,
          queueRoleNamespace,
          controlRoleNamespace,
          recoveryRoleNamespace
        )
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL notification-recovery operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
