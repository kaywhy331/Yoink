#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresSignalResolutionApplyBoundary,
  buildPostgresSignalResolutionApplyManifest,
  verifyPostgresSignalResolutionApplyBoundary
} from "../dist/packages/database/src/postgres-signal-resolution-apply.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-resolution-apply -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_SIGNAL_RESOLUTION_APPLY_QUALIFICATION_ACK=bounded-signal-resolution-apply-qualification \
    npm run postgres:signal-resolution-apply -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:signal-resolution-apply -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace]

The command creates one qualification-only signal event-and-resolution
sub-boundary. Its separate NOLOGIN role has zero direct table or column grants
and can execute one exact server-principal-bound function. For an already
leased TrackaLacker signal whose current catalog plan does not require product
creation, the function performs transport-deduplication or atomically writes
the signal event, source heartbeat, and resolution decision.

The boundary does not create or refresh catalog references, write occurrences,
incidents, observations, missions, actions, notifications, or audit records,
complete an inbox message, expose the raw payload, compose a runtime principal,
or authorize a retailer action. SQLite remains authoritative and complete
hosted-delivery handler parity stays 6/7.
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
  if (/signal-catalog|hosted-delivery|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate|refuses to reuse/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|function|protected table|mutation table/i.test(message)) {
    return "signal_resolution_apply_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_resolution_apply_preflight_failed";
  }
  return "postgres_signal_resolution_apply_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace, candidateRoleNamespace,
  dispatchRoleNamespace, reconciliationRoleNamespace, witnessRoleNamespace,
  deliveryLeaseRoleNamespace, catalogApplyRoleNamespace,
  resolutionApplyRoleNamespace] = process.argv.slice(2);
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
  resolutionApplyRoleNamespace
];
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_signal_resolution_apply_plan",
      manifest: buildPostgresSignalResolutionApplyManifest(...args)
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_SIGNAL_RESOLUTION_APPLY_QUALIFICATION_ACK
        !== "bounded-signal-resolution-apply-qualification") {
      throw new Error(
        "A bounded PostgreSQL signal-resolution apply qualification acknowledgement is required."
      );
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_signal_resolution_apply_apply",
        receipt: await applyPostgresSignalResolutionApplyBoundary(database, ...args)
      });
    } else {
      print({
        operation: "postgres_signal_resolution_apply_verify",
        receipt: await verifyPostgresSignalResolutionApplyBoundary(database, ...args)
      });
    }
  }
} catch (error) {
  process.stderr.write(
    `Yoink PostgreSQL signal-resolution apply operation failed safely (${safeFailureCode(error)}).\n`
  );
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
