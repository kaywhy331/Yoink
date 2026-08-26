#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  buildPostgresSignalPostIncidentDecisionApplyManifest
} from "../dist/packages/database/src/postgres-signal-post-incident-decision-apply.js";
import {
  applyPostgresSignalMissionBindingApplyBoundary,
  buildPostgresSignalMissionBindingApplyManifest,
  verifyPostgresSignalMissionBindingApplyBoundary
} from "../dist/packages/database/src/postgres-signal-mission-binding-apply.js";

const roleArguments = "[private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace] [dispatch_role_namespace] [reconciliation_role_namespace] [witness_role_namespace] [delivery_lease_role_namespace] [catalog_apply_role_namespace] [resolution_apply_role_namespace] [source_reference_role_namespace] [terminal_decision_role_namespace] [offer_incident_role_namespace] [post_incident_decision_role_namespace] [mission_binding_role_namespace]";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-mission-binding-apply -- plan ${roleArguments}
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_SIGNAL_MISSION_BINDING_APPLY_QUALIFICATION_ACK=bounded-signal-mission-binding-apply-qualification \
    npm run postgres:signal-mission-binding-apply -- apply ${roleArguments}
  YOINK_POSTGRES_URL=... npm run postgres:signal-mission-binding-apply -- verify ${roleArguments}

The command creates one qualification-only signal mission-binding boundary.
Its separate NOLOGIN role has zero direct table or column grants and can execute
one exact server-principal-bound function. It accepts only the exact continuation
from a fully settled post-incident decision. It binds an existing user mission
or creates a trusted exact-source mission, attaches all known exact-variant
listings, creates only a missing initial append-only intent policy, and appends
matching audit and outbox receipts.

Strategy evaluation, action jobs, spend reservation, catalog changes, incident
changes, inbox completion, runtime principals, retailer sessions, checkout, and
order submission remain closed. SQLite stays authoritative and handler parity
stays 6/7.
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
  if (/post-incident|offer-incident|terminal-decision|source-reference|signal-resolution|signal-catalog|hosted-delivery|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate|refuses to reuse/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|inherit another role|attribute|principal|boundary|protected table|mutation table/i.test(message)) {
    return "signal_mission_binding_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_mission_binding_preflight_failed";
  }
  return "postgres_signal_mission_binding_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace, candidateRoleNamespace,
  dispatchRoleNamespace, reconciliationRoleNamespace, witnessRoleNamespace,
  deliveryLeaseRoleNamespace, catalogApplyRoleNamespace,
  resolutionApplyRoleNamespace, sourceReferenceRoleNamespace,
  terminalDecisionRoleNamespace, offerIncidentRoleNamespace,
  postIncidentDecisionRoleNamespace, missionBindingRoleNamespace] = process.argv.slice(2);
const predecessorArgs = [
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
  } else {
    const predecessorManifest = buildPostgresSignalPostIncidentDecisionApplyManifest(
      ...predecessorArgs
    );
    const manifest = buildPostgresSignalMissionBindingApplyManifest(
      predecessorManifest,
      missionBindingRoleNamespace
    );
    if (command === "plan") {
      print({
        operation: "postgres_signal_mission_binding_apply_plan",
        manifest
      });
    } else {
      if (command === "apply"
        && process.env.YOINK_POSTGRES_SIGNAL_MISSION_BINDING_APPLY_QUALIFICATION_ACK
          !== "bounded-signal-mission-binding-apply-qualification") {
        throw new Error(
          "A bounded PostgreSQL signal mission-binding qualification acknowledgement is required."
        );
      }
      database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
      if (command === "apply") {
        print({
          operation: "postgres_signal_mission_binding_apply",
          receipt: await applyPostgresSignalMissionBindingApplyBoundary(database, manifest)
        });
      } else {
        print({
          operation: "postgres_signal_mission_binding_verify",
          receipt: await verifyPostgresSignalMissionBindingApplyBoundary(database, manifest)
        });
      }
    }
  }
} catch (error) {
  process.stderr.write(
    `Yoink PostgreSQL signal mission-binding operation failed safely (${safeFailureCode(error)}).\n`
  );
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
