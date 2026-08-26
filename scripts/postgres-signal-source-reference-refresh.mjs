#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresSignalSourceReferenceRefreshBoundary,
  buildPostgresSignalSourceReferenceRefreshManifest,
  verifyPostgresSignalSourceReferenceRefreshBoundary
} from "../dist/packages/database/src/postgres-signal-source-reference-refresh.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-source-reference-refresh -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_QUALIFICATION_ACK=bounded-signal-source-reference-refresh-qualification \
    npm run postgres:signal-source-reference-refresh -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:signal-source-reference-refresh -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace]

The command creates one qualification-only known-product source-reference
sub-boundary. Its separate NOLOGIN role has zero direct table or column grants
and can execute one exact server-principal-bound function. For an already
committed, matched TrackaLacker signal, it may insert or refresh only the exact
source product, source listing, and TrackaLacker-slug reference rows.

Conflicting mappings fail closed; test and unmatched signals are mutation-free;
replay becomes a no-op once the references are current. The boundary cannot
mutate shared catalog rows, downstream evaluation, inbox state, notifications,
audit records, a runtime principal, or a retailer session. SQLite remains
authoritative and complete hosted-delivery handler parity stays 6/7.
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
  if (/signal-resolution|signal-catalog|hosted-delivery|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate|refuses to reuse/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|function|protected table|mutation table/i.test(message)) {
    return "signal_source_reference_refresh_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_source_reference_refresh_preflight_failed";
  }
  return "postgres_signal_source_reference_refresh_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace, candidateRoleNamespace,
  dispatchRoleNamespace, reconciliationRoleNamespace, witnessRoleNamespace,
  deliveryLeaseRoleNamespace, catalogApplyRoleNamespace,
  resolutionApplyRoleNamespace, sourceReferenceRoleNamespace] = process.argv.slice(2);
const args = [
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
  witnessRoleNamespace,
  deliveryLeaseRoleNamespace,
  catalogApplyRoleNamespace,
  resolutionApplyRoleNamespace,
  sourceReferenceRoleNamespace
];
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_signal_source_reference_refresh_plan",
      manifest: buildPostgresSignalSourceReferenceRefreshManifest(...args)
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_QUALIFICATION_ACK
        !== "bounded-signal-source-reference-refresh-qualification") {
      throw new Error(
        "A bounded PostgreSQL signal source-reference refresh qualification acknowledgement is required."
      );
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_signal_source_reference_refresh_apply",
        receipt: await applyPostgresSignalSourceReferenceRefreshBoundary(database, ...args)
      });
    } else {
      print({
        operation: "postgres_signal_source_reference_refresh_verify",
        receipt: await verifyPostgresSignalSourceReferenceRefreshBoundary(database, ...args)
      });
    }
  }
} catch (error) {
  process.stderr.write(
    `Yoink PostgreSQL signal source-reference refresh operation failed safely (${safeFailureCode(error)}).\n`
  );
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
