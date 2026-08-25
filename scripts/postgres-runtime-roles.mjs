#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresRuntimeReadRoles,
  buildPostgresRuntimeReadRoleManifest,
  verifyPostgresRuntimeReadRoles
} from "../dist/packages/database/src/postgres-runtime-roles.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:roles -- plan [private_schema] [role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_ROLE_QUALIFICATION_ACK=read-only-qualification \\
    npm run postgres:roles -- apply [private_schema] [role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:roles -- verify [private_schema] [role_namespace]

The command creates qualification-only NOLOGIN/NOINHERIT/NOBYPASSRLS read roles.
It never creates a login, grants a write, enables runtime authority, or resolves the closed incident table.
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
  if (/cutover receipt|manifest|contract/i.test(message)) return "cutover_contract_invalid";
  if (/existing roles|reused receipt|already exists|duplicate/i.test(message)) return "qualification_target_reused";
  if (/grant|privilege|membership|attribute|policy|receipt/i.test(message)) return "role_verification_failed";
  if (/server|CREATEROLE|control role|BYPASSRLS/i.test(message)) return "role_preflight_failed";
  return "postgres_role_operation_failed";
}

const [command, schemaName, roleNamespace] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_runtime_read_role_plan",
      manifest: buildPostgresRuntimeReadRoleManifest(schemaName, roleNamespace)
    });
  } else {
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      if (process.env.YOINK_POSTGRES_ROLE_QUALIFICATION_ACK !== "read-only-qualification") {
        throw new Error("A read-only role qualification acknowledgement is required.");
      }
      print({
        operation: "postgres_runtime_read_roles_apply",
        receipt: await applyPostgresRuntimeReadRoles(database, schemaName, roleNamespace)
      });
    } else {
      print({
        operation: "postgres_runtime_read_roles_verify",
        receipt: await verifyPostgresRuntimeReadRoles(database, schemaName, roleNamespace)
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL runtime-role operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
