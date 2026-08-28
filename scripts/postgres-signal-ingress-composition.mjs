#!/usr/bin/env node
import {
  NodePostgresCutoverDatabase,
  loadPostgresCutoverConnectionConfig
} from "../dist/packages/database/src/postgres-cutover.js";
import {
  buildPostgresSignalIngressCompositionManifest,
  verifyPostgresSignalIngressCompositionBoundary
} from "../dist/packages/database/src/postgres-signal-ingress-composition.js";

function usage() {
  process.stderr.write(`Usage:
  npm run postgres:signal-ingress-composition -- plan
  YOINK_POSTGRES_URL=... npm run postgres:signal-ingress-composition -- verify

This creates NO new PostgreSQL role, function, or receipt table, and grants
NO new mutation authority. It proves — deterministically, and re-derivable on
every run — that four already-qualified boundaries (the signal-ingress
accept/dedupe writer, the tenant queue writer it consumes, the hosted-delivery
lease-recovery transport/plan boundary, and the complete signal-evaluation
repository composition) compose into one complete, gap-free durable
signal-INGRESS repository: three cross-boundary fingerprint convergence
proofs are checked against what each predecessor actually computes today, and
every one of seventeen SQLite ingress plan/mutation families (two own plus
fifteen delegated) maps to exactly one qualified boundary. verify additionally
calls all four members' own live-database verify functions against the real
Postgres catalog — unlike rung-1's single-tip cascade, no one call here
transitively covers the other three, so shared ancestry is deliberately
re-verified (idempotent reads, no mutation, no risk).

Hosted-delivery handler composition and full handler repository parity both
stay closed. SQLite remains authoritative.
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
  if (/shared-ancestry convergence/i.test(message)) {
    return "signal_ingress_composition_shared_ancestry_convergence_broken";
  }
  if (/queue-write convergence/i.test(message)) {
    return "signal_ingress_composition_queue_write_convergence_broken";
  }
  if (/lease-recovery convergence/i.test(message)) {
    return "signal_ingress_composition_lease_recovery_convergence_broken";
  }
  if (/repository parity to hold/i.test(message)) {
    return "signal_ingress_composition_repository_parity_required";
  }
  if (/ingress-enqueue-apply boundary to hold/i.test(message)) {
    return "signal_ingress_composition_ingress_enqueue_apply_required";
  }
  if (/not exactly-once complete/i.test(message)) {
    return "signal_ingress_composition_chain_incomplete";
  }
  if (/order drifted/i.test(message)) {
    return "signal_ingress_composition_order_drifted";
  }
  if (/coverage accounting/i.test(message)) {
    return "signal_ingress_composition_coverage_incomplete";
  }
  if (/drifted from its live sub-boundaries/i.test(message)) {
    return "signal_ingress_composition_manifest_drifted";
  }
  if (/ingress-enqueue|signal-ingress|inbox|catalog-apply|resolution-apply|source-reference|terminal-decision|offer-incident|post-incident|mission-binding|strategy-evaluation|writer-lock|constraint-configuration|action\/spend|signal-catalog|hosted-delivery|hosted signal inbox|hosted signal resolution|witness-refresh|alert-reconciliation|alert-dispatch|observer-candidate|operational-retention|execution-recovery|notification-recovery|worker-control|queue-write|tenant-session|read-role|reservation-lifecycle|attribution-receipt|attribution-policy|job-lifecycle|target-qualification|evaluation composition|evaluation-repository|cutover|manifest|contract/i.test(message)) {
    return "signal_ingress_composition_prerequisite_invalid";
  }
  if (/grant|privilege|membership|inherit another role|attribute|principal|boundary|protected table|mutation table|drift|ambiguous|invalid/i.test(message)) {
    return "signal_ingress_composition_verification_failed";
  }
  if (/server|CREATEROLE|BYPASSRLS/i.test(message)) {
    return "signal_ingress_composition_preflight_failed";
  }
  return "postgres_signal_ingress_composition_operation_failed";
}

const [command] = process.argv.slice(2);
let database = null;

try {
  if (!command || !["plan", "verify"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else {
    const manifest = buildPostgresSignalIngressCompositionManifest();
    if (command === "plan") {
      print({ operation: "postgres_signal_ingress_composition_plan", manifest });
    } else {
      database = new NodePostgresCutoverDatabase(loadPostgresCutoverConnectionConfig());
      print({
        operation: "postgres_signal_ingress_composition_verify",
        receipt: await verifyPostgresSignalIngressCompositionBoundary(database, manifest)
      });
    }
  }
} catch (error) {
  process.stderr.write(`Yoink PostgreSQL signal-ingress composition operation failed safely (${safeFailureCode(error)}).\n`);
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => undefined);
}
