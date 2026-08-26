#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresHostedDeliveryLeaseRecoveryBoundary,
  buildPostgresHostedDeliveryLeaseRecoveryManifest,
  verifyPostgresHostedDeliveryLeaseRecoveryBoundary
} from "../dist/packages/database/src/postgres-hosted-delivery-lease-recovery.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:delivery-lease-recovery -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_DELIVERY_LEASE_RECOVERY_QUALIFICATION_ACK=bounded-delivery-lease-recovery-qualification \
    npm run postgres:delivery-lease-recovery -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:delivery-lease-recovery -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace]

The command creates one qualification-only hosted-delivery transport
sub-boundary. Its NOLOGIN role has zero direct table or column grants and can
execute two exact, server-principal-bound, server-clocked functions across
three forced-RLS tables. They release expired inbox/outbox leases and perform
the fixed signal_event_v1 lease, acknowledgement, retry, and dead-letter
lifecycle while appending exact delivery receipts.

This is deliberately not the full hosted_delivery_recovery handler: signal
ingress acceptance and evaluation remain outside this boundary, handler parity
stays 6/7,
and no login, principal, runtime authority, signal action, or retailer mutation
is activated.
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
  if (/witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate|refuses to reuse/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|function|protected table|protected-table/i.test(message)) {
    return "delivery_lease_recovery_verification_failed";
  }
  if (/server|CREATEROLE|control role|BYPASSRLS/i.test(message)) {
    return "delivery_lease_recovery_preflight_failed";
  }
  return "postgres_delivery_lease_recovery_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace, candidateRoleNamespace,
  dispatchRoleNamespace, reconciliationRoleNamespace, witnessRoleNamespace,
  deliveryLeaseRoleNamespace] = process.argv.slice(2);
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
  deliveryLeaseRoleNamespace
];
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_hosted_delivery_lease_recovery_plan",
      manifest: buildPostgresHostedDeliveryLeaseRecoveryManifest(...args)
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_DELIVERY_LEASE_RECOVERY_QUALIFICATION_ACK
        !== "bounded-delivery-lease-recovery-qualification") {
      throw new Error(
        "A bounded PostgreSQL hosted-delivery lease-recovery qualification acknowledgement is required."
      );
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_hosted_delivery_lease_recovery_apply",
        receipt: await applyPostgresHostedDeliveryLeaseRecoveryBoundary(database, ...args)
      });
    } else {
      print({
        operation: "postgres_hosted_delivery_lease_recovery_verify",
        receipt: await verifyPostgresHostedDeliveryLeaseRecoveryBoundary(database, ...args)
      });
    }
  }
} catch (error) {
  process.stderr.write(
    `Yoink PostgreSQL hosted-delivery lease-recovery operation failed safely (${safeFailureCode(error)}).\n`
  );
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
