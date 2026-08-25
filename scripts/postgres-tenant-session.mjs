#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresTenantSessionBoundary,
  buildPostgresTenantSessionManifest,
  verifyPostgresTenantSessionBoundary
} from "../dist/packages/database/src/postgres-tenant-session.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:sessions -- plan [private_schema] [read_role_namespace] [session_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_TENANT_SESSION_QUALIFICATION_ACK=server-bound-read-qualification \
    npm run postgres:sessions -- apply [private_schema] [read_role_namespace] [session_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:sessions -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace]

The command creates qualification-only tenant-session infrastructure: one inactive
NOLOGIN read role, a server-owned empty principal registry, zero-argument binding
functions, and restrictive RLS policies. It never creates a login or mapping,
grants a write, enables PostgreSQL runtime authority, or provisions identity.
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
  if (/read-role receipt|cutover|manifest|contract/i.test(message)) return "prerequisite_contract_invalid";
  if (/existing role|registry|binder|receipt|already exists|duplicate/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|policy|scope|principal/i.test(message)) {
    return "tenant_session_verification_failed";
  }
  if (/server|CREATEROLE|control role|BYPASSRLS/i.test(message)) return "tenant_session_preflight_failed";
  return "postgres_tenant_session_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_tenant_session_plan",
      manifest: buildPostgresTenantSessionManifest(schemaName, readRoleNamespace, sessionRoleNamespace)
    });
  } else {
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      if (process.env.YOINK_POSTGRES_TENANT_SESSION_QUALIFICATION_ACK
        !== "server-bound-read-qualification") {
        throw new Error("A server-bound tenant-session qualification acknowledgement is required.");
      }
      print({
        operation: "postgres_tenant_session_apply",
        receipt: await applyPostgresTenantSessionBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace
        )
      });
    } else {
      print({
        operation: "postgres_tenant_session_verify",
        receipt: await verifyPostgresTenantSessionBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace
        )
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL tenant-session operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
