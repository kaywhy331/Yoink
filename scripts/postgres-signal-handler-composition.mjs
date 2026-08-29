#!/usr/bin/env node
import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  buildPostgresSignalHandlerCompositionManifest,
  verifyPostgresSignalHandlerCompositionBoundary
} from "../dist/packages/database/src/postgres-signal-handler-composition.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-handler-composition -- plan
  YOINK_POSTGRES_URL=... npm run postgres:signal-handler-composition -- verify

This creates NO new PostgreSQL role, function, or receipt table, and grants
NO new mutation authority. It proves — deterministically, and re-derivable on
every run — that four already-qualified boundaries (the six-handler-family
observer-witness-refresh chain, the complete durable signal-ingress
composition, the operator dead-letter inbox-reset writer, and the
server-bound notification-delivery ensure writer) compose into one complete,
gap-free PostgreSQL owner for every BACKGROUND_TASK_KINDS entry: two
cross-boundary fingerprint convergence proofs are checked against what each
predecessor actually computes today, every one of the seven real task kinds
maps to exactly one qualified boundary corroborated by that boundary's own
live coverage, and the hosted-delivery handler's own repository surface
(task-kind dispatch plus its dead-letter-reset variant) is confirmed closed.
verify additionally calls all four members' own live-database verify
functions against the real Postgres catalog — unlike rung-1's single-tip
cascade, no one call here transitively covers the other three, so shared
ancestry is deliberately re-verified (idempotent reads, no mutation, no
risk).

This is the final composition rung: it closes
hostedDeliveryHandlerRepositoryParity and allHandlerRepositoryParity.
SQLite remains authoritative.
`);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/YOINK_POSTGRES_URL|TLS|loopback|certificate|namespace|schema is invalid|identifier limit|must share one schema/i.test(message)) {
    return "configuration_invalid";
  }
  if (/witness-refresh convergence/i.test(message)) {
    return "signal_handler_composition_witness_refresh_convergence_broken";
  }
  if (/dead-letter-reset ancestry convergence/i.test(message)) {
    return "signal_handler_composition_dead_letter_reset_ancestry_convergence_broken";
  }
  if (/notification-ensure ancestry convergence/i.test(message)) {
    return "signal_handler_composition_notification_ensure_ancestry_convergence_broken";
  }
  if (/repository parity to hold/i.test(message)) {
    return "signal_handler_composition_repository_parity_required";
  }
  if (/observer-witness-refresh boundary to hold/i.test(message)) {
    return "signal_handler_composition_witness_refresh_required";
  }
  if (/dead-letter-reset-apply boundary to hold/i.test(message)) {
    return "signal_handler_composition_dead_letter_reset_apply_required";
  }
  if (/notification-ensure-apply boundary to hold/i.test(message)) {
    return "signal_handler_composition_notification_ensure_apply_required";
  }
  if (/task-kind mapping for .* is not corroborated/i.test(message)) {
    return "signal_handler_composition_task_kind_mapping_uncorroborated";
  }
  if (/task-kind coverage is not exactly-once complete/i.test(message)) {
    return "signal_handler_composition_task_kind_coverage_incomplete";
  }
  if (/chain is not exactly-once complete/i.test(message)) {
    return "signal_handler_composition_chain_incomplete";
  }
  if (/order drifted/i.test(message)) {
    return "signal_handler_composition_order_drifted";
  }
  if (/coverage accounting/i.test(message)) {
    return "signal_handler_composition_coverage_incomplete";
  }
  if (/drifted from its live sub-boundaries/i.test(message)) {
    return "signal_handler_composition_manifest_drifted";
  }
  if (/ingress-enqueue|signal-ingress|inbox|catalog-apply|resolution-apply|source-reference|terminal-decision|offer-incident|post-incident|mission-binding|strategy-evaluation|writer-lock|constraint-configuration|action\/spend|signal-catalog|hosted-delivery|hosted signal inbox|hosted signal resolution|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|reservation-lifecycle|attribution-receipt|attribution-policy|job-lifecycle|target-qualification|evaluation composition|evaluation-repository|dead-letter|notification-ensure|cutover|manifest|contract/i.test(message)) {
    return "signal_handler_composition_prerequisite_invalid";
  }
  if (/grant|privilege|membership|inherit another role|attribute|principal|boundary|protected table|mutation table|drift|ambiguous|invalid/i.test(message)) {
    return "signal_handler_composition_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_handler_composition_preflight_failed";
  }
  return "postgres_signal_handler_composition_operation_failed";
}

const [command] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else {
    const manifest = buildPostgresSignalHandlerCompositionManifest();
    if (command === "plan") {
      print({ operation: "postgres_signal_handler_composition_plan", manifest });
    } else {
      database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
      print({
        operation: "postgres_signal_handler_composition_verify",
        receipt: await verifyPostgresSignalHandlerCompositionBoundary(database, manifest)
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL signal-handler composition operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
