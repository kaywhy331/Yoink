#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresWorkerControlBoundary,
  buildPostgresWorkerControlManifest,
  verifyPostgresWorkerControlBoundary
} from "../dist/packages/database/src/postgres-worker-control.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:worker-control -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_WORKER_CONTROL_QUALIFICATION_ACK=bounded-worker-control-qualification \
    npm run postgres:worker-control -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:worker-control -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace]

The command creates one qualification-only background-worker control role. Its
19 exact column privileges expose only user IDs, the singleton ID plus four deployment-expectation
fields, eight heartbeat status fields, and four stop-related heartbeat updates.
Three explicit policies permit only principal pagination, fleet status, and a
resulting heartbeat state of stopped. It never grants table-wide access,
insert, delete, queue-task access, application functions, login, membership,
runtime authority, or a retailer capability.
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
  if (/queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|policy|guard|receipt|already exists|duplicate/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|policy/i.test(message)) {
    return "worker_control_verification_failed";
  }
  if (/server|CREATEROLE|control role|BYPASSRLS/i.test(message)) {
    return "worker_control_preflight_failed";
  }
  return "postgres_worker_control_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_worker_control_plan",
      manifest: buildPostgresWorkerControlManifest(
        schemaName,
        readRoleNamespace,
        sessionRoleNamespace,
        queueRoleNamespace,
        controlRoleNamespace
      )
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_WORKER_CONTROL_QUALIFICATION_ACK
        !== "bounded-worker-control-qualification") {
      throw new Error("A bounded PostgreSQL worker-control qualification acknowledgement is required.");
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_worker_control_apply",
        receipt: await applyPostgresWorkerControlBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace,
          queueRoleNamespace,
          controlRoleNamespace
        )
      });
    } else {
      print({
        operation: "postgres_worker_control_verify",
        receipt: await verifyPostgresWorkerControlBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace,
          queueRoleNamespace,
          controlRoleNamespace
        )
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL worker-control operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
