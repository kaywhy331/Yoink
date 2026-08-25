#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresTenantQueueWriteBoundary,
  buildPostgresTenantQueueWriteManifest,
  verifyPostgresTenantQueueWriteBoundary
} from "../dist/packages/database/src/postgres-tenant-queue-writes.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:writes -- plan [private_schema] [read_role_namespace] [session_role_namespace] [write_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_TENANT_QUEUE_WRITE_QUALIFICATION_ACK=server-bound-queue-write-qualification \
    npm run postgres:writes -- apply [private_schema] [read_role_namespace] [session_role_namespace] [write_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:writes -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [write_role_namespace]

The command creates one qualification-only, server-bound tenant queue writer.
It grants only the manifested SELECT/INSERT/UPDATE operations on four queue
tables. It never grants DELETE, creates a login or principal mapping, ports a
task handler, enables PostgreSQL runtime authority, or changes retailer actions.
`);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/YOINK_POSTGRES_URL|TLS|loopback|certificate|namespace|schema is invalid/i.test(message)) {
    return "configuration_invalid";
  }
  if (/tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|policy|guard|receipt|already exists|duplicate/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|scope|principal|boundary/i.test(message)) {
    return "tenant_queue_write_verification_failed";
  }
  if (/server|CREATEROLE|control role|BYPASSRLS/i.test(message)) {
    return "tenant_queue_write_preflight_failed";
  }
  return "postgres_tenant_queue_write_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace, writeRoleNamespace] =
  process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_tenant_queue_write_plan",
      manifest: buildPostgresTenantQueueWriteManifest(
        schemaName,
        readRoleNamespace,
        sessionRoleNamespace,
        writeRoleNamespace
      )
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_TENANT_QUEUE_WRITE_QUALIFICATION_ACK
        !== "server-bound-queue-write-qualification") {
      throw new Error("A server-bound tenant queue-write qualification acknowledgement is required.");
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_tenant_queue_write_apply",
        receipt: await applyPostgresTenantQueueWriteBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace,
          writeRoleNamespace
        )
      });
    } else {
      print({
        operation: "postgres_tenant_queue_write_verify",
        receipt: await verifyPostgresTenantQueueWriteBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace,
          writeRoleNamespace
        )
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL tenant queue-write operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
