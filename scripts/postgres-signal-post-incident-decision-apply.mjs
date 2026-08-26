#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresSignalPostIncidentDecisionApplyBoundary,
  buildPostgresSignalPostIncidentDecisionApplyManifest,
  verifyPostgresSignalPostIncidentDecisionApplyBoundary
} from "../dist/packages/database/src/postgres-signal-post-incident-decision-apply.js";

const roleArguments = "[private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace] [terminal_decision_role_namespace] [offer_incident_role_namespace] [post_incident_decision_role_namespace]";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-post-incident-decision-apply -- plan ${roleArguments}
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_QUALIFICATION_ACK=bounded-signal-post-incident-decision-apply-qualification \
    npm run postgres:signal-post-incident-decision-apply -- apply ${roleArguments}
  YOINK_POSTGRES_URL=... npm run postgres:signal-post-incident-decision-apply -- verify ${roleArguments}

The command creates one qualification-only post-incident decision boundary.
Its separate NOLOGIN role has zero direct table or column grants and can execute
one exact server-principal-bound function. It accepts only a fully settled,
exact actionable offer/incident predecessor. It may terminally record either a
corroborated existing action job or a fail-closed no-mission decision, together
with the matching audit and outbox records.

Trusted sources that still require mission binding or creation are projected to
the next stage with zero writes. Catalog, source references, terminal decisions,
offers, incidents, missions, actions, inbox state, runtime principals, retailer
sessions, checkout, and order submission remain closed. SQLite stays
authoritative and handler parity stays 6/7.
`);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/acknowledgement is required/i.test(message)) {
    return "qualification_acknowledgement_required";
  }
  if (/YOINK_POSTGRES_URL|TLS|loopback|certificate|namespace|schema is invalid|identifier limit/i.test(message)) {
    return "configuration_invalid";
  }
  if (/offer-incident|terminal-decision|source-reference|signal-resolution|signal-catalog|hosted-delivery|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate|refuses to reuse/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|inherit another role|attribute|principal|boundary|protected table|mutation table/i.test(message)) {
    return "signal_post_incident_decision_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_post_incident_decision_preflight_failed";
  }
  return "postgres_signal_post_incident_decision_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace, candidateRoleNamespace,
  dispatchRoleNamespace, reconciliationRoleNamespace, witnessRoleNamespace,
  deliveryLeaseRoleNamespace, catalogApplyRoleNamespace,
  resolutionApplyRoleNamespace, sourceReferenceRoleNamespace,
  terminalDecisionRoleNamespace, offerIncidentRoleNamespace,
  postIncidentDecisionRoleNamespace] = process.argv.slice(2);
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
  sourceReferenceRoleNamespace,
  terminalDecisionRoleNamespace,
  offerIncidentRoleNamespace,
  postIncidentDecisionRoleNamespace
];
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_signal_post_incident_decision_apply_plan",
      manifest: buildPostgresSignalPostIncidentDecisionApplyManifest(...args)
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_QUALIFICATION_ACK
        !== "bounded-signal-post-incident-decision-apply-qualification") {
      throw new Error(
        "A bounded PostgreSQL signal post-incident decision qualification acknowledgement is required."
      );
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_signal_post_incident_decision_apply",
        receipt: await applyPostgresSignalPostIncidentDecisionApplyBoundary(database, ...args)
      });
    } else {
      print({
        operation: "postgres_signal_post_incident_decision_verify",
        receipt: await verifyPostgresSignalPostIncidentDecisionApplyBoundary(database, ...args)
      });
    }
  }
} catch (error) {
  process.stderr.write(
    `Yoink PostgreSQL signal post-incident decision operation failed safely (${safeFailureCode(error)}).\n`
  );
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
