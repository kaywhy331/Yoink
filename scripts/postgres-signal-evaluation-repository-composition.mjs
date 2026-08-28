#!/usr/bin/env node
import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  buildPostgresSignalEvaluationRepositoryCompositionManifest,
  verifyPostgresSignalEvaluationRepositoryCompositionBoundary
} from "../dist/packages/database/src/postgres-signal-evaluation-repository-composition.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-evaluation-repository-composition -- plan
  YOINK_POSTGRES_URL=... npm run postgres:signal-evaluation-repository-composition -- verify

This creates NO new PostgreSQL role, function, or receipt table, and grants
NO new mutation authority. It proves — deterministically, and re-derivable on
every run — that five already-qualified boundaries (the hosted-delivery
lease-recovery transport/plan boundary, rung-1's own eleven-boundary
signal-evaluation "apply" composition, the terminal spend-reservation
lifecycle writer, the attribution-receipt writer, and the post-creation
action-job lifecycle writer) compose into one complete, gap-free SQLite
evaluation REPOSITORY: every declared cross-boundary predecessor fingerprint
is checked against what its predecessor actually computes today, and every
one of fifteen SQLite evaluation plan/mutation families (five own plus
rung-1's ten delegated) maps to exactly one qualified boundary. verify
additionally calls all five members' own live-database verify functions
against the real Postgres catalog — unlike rung-1's single-tip cascade, no
one call here transitively covers the other four, so shared ancestry is
deliberately re-verified (idempotent reads, no mutation, no risk).

Durable signal ingress, hosted-delivery handler composition, and full
handler repository parity all stay closed. SQLite remains authoritative.
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
  if (/writer-track convergence/i.test(message)) {
    return "signal_evaluation_repository_composition_writer_track_convergence_broken";
  }
  if (/residual-writer sequence contract/i.test(message)) {
    return "signal_evaluation_repository_composition_residual_writer_sequence_broken";
  }
  if (/not exactly-once complete/i.test(message)) {
    return "signal_evaluation_repository_composition_chain_incomplete";
  }
  if (/order drifted/i.test(message)) {
    return "signal_evaluation_repository_composition_order_drifted";
  }
  if (/coverage accounting/i.test(message)) {
    return "signal_evaluation_repository_composition_coverage_incomplete";
  }
  if (/drifted from its live sub-boundaries/i.test(message)) {
    return "signal_evaluation_repository_composition_manifest_drifted";
  }
  if (/catalog-apply|resolution-apply|source-reference|terminal-decision|offer-incident|post-incident|mission-binding|strategy-evaluation|writer-lock|constraint-configuration|action\/spend|signal-catalog|hosted-delivery|hosted signal inbox|hosted signal resolution|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|reservation-lifecycle|attribution-receipt|attribution-policy|job-lifecycle|target-qualification|evaluation composition|evaluation-repository|cutover|manifest|contract/i.test(message)) {
    return "signal_evaluation_repository_composition_prerequisite_invalid";
  }
  if (/grant|privilege|membership|inherit another role|attribute|principal|boundary|protected table|mutation table|drift|ambiguous|invalid/i.test(message)) {
    return "signal_evaluation_repository_composition_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_evaluation_repository_composition_preflight_failed";
  }
  return "postgres_signal_evaluation_repository_composition_operation_failed";
}

const [command] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else {
    const manifest = buildPostgresSignalEvaluationRepositoryCompositionManifest();
    if (command === "plan") {
      print({ operation: "postgres_signal_evaluation_repository_composition_plan", manifest });
    } else {
      database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
      print({
        operation: "postgres_signal_evaluation_repository_composition_verify",
        receipt: await verifyPostgresSignalEvaluationRepositoryCompositionBoundary(database, manifest)
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL signal-evaluation-repository composition operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
