#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresOperationalRetentionBoundary,
  buildPostgresOperationalRetentionManifest,
  verifyPostgresOperationalRetentionBoundary
} from "../dist/packages/database/src/postgres-operational-retention.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:operational-retention -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_OPERATIONAL_RETENTION_QUALIFICATION_ACK=bounded-operational-retention-qualification \
    npm run postgres:operational-retention -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:operational-retention -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace]

The command creates one qualification-only privacy-retention handler role. It
has zero direct table or column grants and may execute exactly one bounded,
server-principal-bound, server-clocked function. That function removes only
expired operational telemetry, completed task history, and at most 500 eligible
quarantined observer-recovery rows while appending the existing retention,
audit, and outbox receipts. Login, membership, signal processing, retailer
actions, runtime authority, and unbounded deletion remain absent.
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
  if (/execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|function|protected-table/i.test(message)) {
    return "operational_retention_verification_failed";
  }
  if (/server|CREATEROLE|control role|BYPASSRLS/i.test(message)) {
    return "operational_retention_preflight_failed";
  }
  return "postgres_operational_retention_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_operational_retention_plan",
      manifest: buildPostgresOperationalRetentionManifest(
        schemaName,
        readRoleNamespace,
        sessionRoleNamespace,
        queueRoleNamespace,
        controlRoleNamespace,
        notificationRoleNamespace,
        executionRoleNamespace,
        retentionRoleNamespace
      )
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_OPERATIONAL_RETENTION_QUALIFICATION_ACK
        !== "bounded-operational-retention-qualification") {
      throw new Error("A bounded PostgreSQL operational-retention qualification acknowledgement is required.");
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_operational_retention_apply",
        receipt: await applyPostgresOperationalRetentionBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace,
          queueRoleNamespace,
          controlRoleNamespace,
          notificationRoleNamespace,
          executionRoleNamespace,
          retentionRoleNamespace
        )
      });
    } else {
      print({
        operation: "postgres_operational_retention_verify",
        receipt: await verifyPostgresOperationalRetentionBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace,
          queueRoleNamespace,
          controlRoleNamespace,
          notificationRoleNamespace,
          executionRoleNamespace,
          retentionRoleNamespace
        )
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL operational-retention operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
