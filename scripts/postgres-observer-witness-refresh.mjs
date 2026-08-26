#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresObserverWitnessRefreshBoundary,
  buildPostgresObserverWitnessRefreshManifest,
  verifyPostgresObserverWitnessRefreshBoundary
} from "../dist/packages/database/src/postgres-observer-witness-refresh.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:witness-refresh -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_WITNESS_REFRESH_QUALIFICATION_ACK=bounded-observer-witness-refresh-qualification \
    npm run postgres:witness-refresh -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:witness-refresh -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace]

The command creates one qualification-only external-witness refresh boundary.
Its NOLOGIN role has zero direct table or column grants and may execute one exact
server-principal-bound function. The application performs HTTPS publication and
pinned Ed25519 verification outside database transactions; PostgreSQL derives the
public checkpoint, revalidates the two-phase plan and canonical receipt evidence,
and appends only public cryptographic metadata, audit, and outbox receipts. The
boundary cannot make network calls, read a private signing key or witness endpoint,
provision a login, activate a principal, grant runtime authority, or mutate a retailer.
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
  if (/alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|function|protected table|protected-table/i.test(message)) {
    return "witness_refresh_verification_failed";
  }
  if (/server|CREATEROLE|control role|BYPASSRLS/i.test(message)) {
    return "witness_refresh_preflight_failed";
  }
  return "postgres_witness_refresh_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace, candidateRoleNamespace,
  dispatchRoleNamespace, reconciliationRoleNamespace,
  witnessRoleNamespace] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_observer_witness_refresh_plan",
      manifest: buildPostgresObserverWitnessRefreshManifest(
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
        witnessRoleNamespace
      )
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_WITNESS_REFRESH_QUALIFICATION_ACK
        !== "bounded-observer-witness-refresh-qualification") {
      throw new Error("A bounded PostgreSQL observer-witness refresh qualification acknowledgement is required.");
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_observer_witness_refresh_apply",
        receipt: await applyPostgresObserverWitnessRefreshBoundary(
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
          reconciliationRoleNamespace,
          witnessRoleNamespace
        )
      });
    } else {
      print({
        operation: "postgres_observer_witness_refresh_verify",
        receipt: await verifyPostgresObserverWitnessRefreshBoundary(
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
          reconciliationRoleNamespace,
          witnessRoleNamespace
        )
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL observer-witness refresh operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
