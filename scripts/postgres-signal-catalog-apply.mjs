#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresSignalCatalogApplyBoundary,
  buildPostgresSignalCatalogApplyManifest,
  verifyPostgresSignalCatalogApplyBoundary
} from "../dist/packages/database/src/postgres-signal-catalog-apply.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-catalog-apply -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_SIGNAL_CATALOG_APPLY_QUALIFICATION_ACK=bounded-signal-catalog-apply-qualification \
    npm run postgres:signal-catalog-apply -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:signal-catalog-apply -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace]

The command creates one qualification-only, insert-only shared-catalog
sub-boundary. Its separate NOLOGIN role has zero direct table or column grants
and can execute one exact server-principal-bound function. For an already
leased trusted-exact TrackaLacker signal, the function re-derives a current
resolution plan and can create only a missing family, variant, listing,
canonical URL, and exact tenant source references.

The boundary does not refresh an existing source reference, accept or complete
an inbox message, mutate the signal-evaluation graph, compose a runtime
principal, or authorize any retailer action. SQLite remains authoritative and
complete hosted-delivery handler parity stays 6/7.
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
  if (/hosted-delivery|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate|refuses to reuse/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|function|protected table|catalog/i.test(message)) {
    return "signal_catalog_apply_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_catalog_apply_preflight_failed";
  }
  return "postgres_signal_catalog_apply_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace, candidateRoleNamespace,
  dispatchRoleNamespace, reconciliationRoleNamespace, witnessRoleNamespace,
  deliveryLeaseRoleNamespace, catalogApplyRoleNamespace] = process.argv.slice(2);
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
  catalogApplyRoleNamespace
];
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_signal_catalog_apply_plan",
      manifest: buildPostgresSignalCatalogApplyManifest(...args)
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_SIGNAL_CATALOG_APPLY_QUALIFICATION_ACK
        !== "bounded-signal-catalog-apply-qualification") {
      throw new Error(
        "A bounded PostgreSQL signal-catalog apply qualification acknowledgement is required."
      );
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_signal_catalog_apply_apply",
        receipt: await applyPostgresSignalCatalogApplyBoundary(database, ...args)
      });
    } else {
      print({
        operation: "postgres_signal_catalog_apply_verify",
        receipt: await verifyPostgresSignalCatalogApplyBoundary(database, ...args)
      });
    }
  }
} catch (error) {
  process.stderr.write(
    `Yoink PostgreSQL signal-catalog apply operation failed safely (${safeFailureCode(error)}).\n`
  );
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
