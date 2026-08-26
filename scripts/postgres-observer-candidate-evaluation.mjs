#!/usr/bin/env node

import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  applyPostgresObserverCandidateEvaluationBoundary,
  buildPostgresObserverCandidateEvaluationManifest,
  verifyPostgresObserverCandidateEvaluationBoundary
} from "../dist/packages/database/src/postgres-observer-repair-candidate-evaluation.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:observer-candidates -- plan [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace]
  YOINK_POSTGRES_URL=... YOINK_POSTGRES_OBSERVER_CANDIDATE_QUALIFICATION_ACK=bounded-quarantined-observer-candidate-qualification \
    npm run postgres:observer-candidates -- apply [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace]
  YOINK_POSTGRES_URL=... npm run postgres:observer-candidates -- verify \
    [private_schema] [read_role_namespace] [session_role_namespace] [queue_role_namespace] [control_role_namespace] [notification_role_namespace] [execution_role_namespace] [retention_role_namespace] [candidate_role_namespace]

The command creates one qualification-only observer-repair candidate handler
role. It has zero direct table or column grants and may execute exactly one
server-principal-bound function. The two-phase function derives at most 25
candidates from the newest 2,000 sanitized diagnostics, revalidates the exact
evidence before insertion, and can create only unsigned, quarantined,
non-executable observer candidates. Login, membership, signing, promotion,
distribution, field fill, retailer actions, and runtime authority remain absent.
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
  if (/operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "prerequisite_contract_invalid";
  }
  if (/existing role|function|guard|receipt|already exists|duplicate/i.test(message)) {
    return "qualification_target_reused";
  }
  if (/grant|privilege|membership|attribute|principal|boundary|function|protected-table/i.test(message)) {
    return "observer_candidate_verification_failed";
  }
  if (/server|CREATEROLE|control role|BYPASSRLS/i.test(message)) {
    return "observer_candidate_preflight_failed";
  }
  return "postgres_observer_candidate_operation_failed";
}

const [command, schemaName, readRoleNamespace, sessionRoleNamespace,
  queueRoleNamespace, controlRoleNamespace, notificationRoleNamespace,
  executionRoleNamespace, retentionRoleNamespace,
  candidateRoleNamespace] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "apply", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "plan") {
    print({
      operation: "postgres_observer_candidate_plan",
      manifest: buildPostgresObserverCandidateEvaluationManifest(
        schemaName,
        readRoleNamespace,
        sessionRoleNamespace,
        queueRoleNamespace,
        controlRoleNamespace,
        notificationRoleNamespace,
        executionRoleNamespace,
        retentionRoleNamespace,
        candidateRoleNamespace
      )
    });
  } else {
    if (command === "apply"
      && process.env.YOINK_POSTGRES_OBSERVER_CANDIDATE_QUALIFICATION_ACK
        !== "bounded-quarantined-observer-candidate-qualification") {
      throw new Error("A bounded PostgreSQL observer-candidate qualification acknowledgement is required.");
    }
    database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
    if (command === "apply") {
      print({
        operation: "postgres_observer_candidate_apply",
        receipt: await applyPostgresObserverCandidateEvaluationBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace,
          queueRoleNamespace,
          controlRoleNamespace,
          notificationRoleNamespace,
          executionRoleNamespace,
          retentionRoleNamespace,
          candidateRoleNamespace
        )
      });
    } else {
      print({
        operation: "postgres_observer_candidate_verify",
        receipt: await verifyPostgresObserverCandidateEvaluationBoundary(
          database,
          schemaName,
          readRoleNamespace,
          sessionRoleNamespace,
          queueRoleNamespace,
          controlRoleNamespace,
          notificationRoleNamespace,
          executionRoleNamespace,
          retentionRoleNamespace,
          candidateRoleNamespace
        )
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL observer-candidate operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
