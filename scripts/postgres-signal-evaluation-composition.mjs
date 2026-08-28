#!/usr/bin/env node
import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  buildPostgresSignalEvaluationCompositionManifest,
  verifyPostgresSignalEvaluationCompositionBoundary
} from "../dist/packages/database/src/postgres-signal-evaluation-composition.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-evaluation-composition -- plan
  YOINK_POSTGRES_URL=... npm run postgres:signal-evaluation-composition -- verify

This creates NO new PostgreSQL role, function, or receipt table, and grants
NO new mutation authority. It proves — deterministically, and re-derivable on
every run against the same default qualification namespaces every composed
boundary already defaults to — that the eleven already-qualified
signal-evaluation "apply" boundaries (catalog-apply through action-spend-
apply, plus the writer-lock-protocol and constraint-config-apply
writer-discipline boundaries) compose into one complete, gap-free write path
for the SQLite SignalEngine.process() evaluation flow: every declared
cross-boundary predecessor fingerprint is checked against what its
predecessor actually computes today, and every SQLite evaluation mutation
family maps to exactly one qualified boundary. verify additionally cascades
one live call to the chain's tip boundary, which itself cascades down
through all eleven composed boundaries against the real Postgres catalog.

The evaluation repository, durable signal ingress, hosted-delivery handler
composition, and full handler repository parity all stay closed. SQLite
remains authoritative.
`);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/YOINK_POSTGRES_URL|TLS|loopback|certificate|namespace|schema is invalid|identifier limit/i.test(message)) {
    return "configuration_invalid";
  }
  if (/sequence contract/i.test(message)) {
    return "signal_evaluation_composition_sequence_contract_broken";
  }
  if (/not exactly-once complete/i.test(message)) {
    return "signal_evaluation_composition_chain_incomplete";
  }
  if (/order drifted/i.test(message)) {
    return "signal_evaluation_composition_order_drifted";
  }
  if (/coverage accounting/i.test(message)) {
    return "signal_evaluation_composition_coverage_incomplete";
  }
  if (/drifted from its live sub-boundaries/i.test(message)) {
    return "signal_evaluation_composition_manifest_drifted";
  }
  if (/catalog-apply|resolution-apply|source-reference|terminal-decision|offer-incident|post-incident|mission-binding|strategy-evaluation|writer-lock|constraint-configuration|action\/spend|signal-catalog|hosted-delivery|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|cutover|manifest|contract/i.test(message)) {
    return "signal_evaluation_composition_prerequisite_invalid";
  }
  if (/grant|privilege|membership|inherit another role|attribute|principal|boundary|protected table|mutation table|drift/i.test(message)) {
    return "signal_evaluation_composition_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_evaluation_composition_preflight_failed";
  }
  return "postgres_signal_evaluation_composition_operation_failed";
}

const [command] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else {
    const manifest = buildPostgresSignalEvaluationCompositionManifest();
    if (command === "plan") {
      print({ operation: "postgres_signal_evaluation_composition_plan", manifest });
    } else {
      database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
      print({
        operation: "postgres_signal_evaluation_composition_verify",
        receipt: await verifyPostgresSignalEvaluationCompositionBoundary(database, manifest)
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL signal-evaluation composition operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
