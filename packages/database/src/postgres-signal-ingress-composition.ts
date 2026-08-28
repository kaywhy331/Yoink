/**
 * PostgreSQL signal-INGRESS composition -- the v1.00-adjacent, rung-3
 * boundary that closes `signalIngressRepositoryParity`, the last of the
 * three flags `postgres-signal-evaluation-repository-composition.ts`
 * (rung-2) left `false` alongside `hostedDeliveryHandlerRepositoryParity`
 * and `allHandlerRepositoryParity` (the latter two stay `false` here too --
 * see §5). Like rung-1 and rung-2, this module creates NO new PostgreSQL
 * role, function, receipt table, or mutation path. It proves --
 * deterministically, re-derivable on every run, and by fingerprint-binding
 * four already-qualified boundaries rather than re-implementing any of them
 * -- that the durable signal-INGRESS repository surface (the acceptance,
 * dequeue/lease, and resolution-plan machinery that sits BEFORE and AROUND
 * `SignalEngine.process()`, which rung-1/rung-2 already cover completely)
 * is now covered by exactly one qualified PostgreSQL owner apiece. Every
 * fact below was read out of the actual source, not assumed.
 *
 * ---------------------------------------------------------------------
 * 1. WHAT RUNG-2 LEFT OPEN (precedent: postgres-signal-evaluation-
 *    repository-composition.ts)
 * ---------------------------------------------------------------------
 * Rung-2's own header, verbatim, named the exact gap this module closes:
 * `"DurableSignalIngressService's OWN enqueue path (packages/engine/src/
 * signal-ingress.ts, backed by HostedDeliveryRepository.acceptInbox --
 * INSERT INTO inbox_messages(...), hosted-delivery-repository.ts:195 -- and
 * BackgroundTaskRepository's create/dedupe writes for a NEW inbound signal).
 * This is a genuinely different write family than anything bound here:
 * hostedDeliveryLeaseRecovery's own yoink_transition_trackalacker_signal_
 * inbox function only leases/completes/fails an ALREADY-enqueued
 * inbox_messages row -- it never INSERTs the row in the first place. No
 * boundary module in this repository reproduces the initial enqueue."
 * `signalIngressRepositoryParity` stayed `false` in rung-2's own manifest,
 * in `postgres-hosted-delivery-lease-recovery.ts`'s manifest, and (as of
 * v0.99) in `postgres-signal-ingress-enqueue-apply.ts`'s own manifest --
 * that module's own header §6 says so explicitly: "Composing this module's
 * function with the queue-writer's enqueueServiceTask equivalent into ONE
 * atomic caller-side operation that flips signalIngressRepositoryParity to
 * true ... only a future composition rung (mirroring
 * postgres-signal-evaluation-repository-composition.ts's own five-member
 * fan-in) can honestly flip it." This module is that rung.
 *
 * ---------------------------------------------------------------------
 * 2. THE COMPLETE SQLITE DURABLE-INGRESS SURFACE (packages/engine/src/
 *    signal-ingress.ts, read in full; packages/database/src/hosted-
 *    delivery-repository.ts, the six public methods below read in full)
 * ---------------------------------------------------------------------
 * `DurableSignalIngressService` (signal-ingress.ts:60-150) exposes two
 * public methods, and `DurableSignalIngressProcessor` (signal-ingress.ts:
 * 152-212) exposes one more. Every write any of the three ever performs is
 * enumerated below, mapped to exactly one bound member or named honestly in
 * `POSTGRES_SIGNAL_INGRESS_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES` (§5):
 *
 *   a. `acceptTrackalacker(input, now)` (signal-ingress.ts:69-119) -- the
 *      ONE path a durable signal ever enters through. Inside one ambient
 *      `this.db.transaction(...)`: `HostedDeliveryRepository.acceptInbox`
 *      (hosted-delivery-repository.ts:153-213) INSERTs `inbox_messages` on
 *      a fresh signal (or appends a `hosted_delivery_receipts` dedupe/
 *      conflict row otherwise) -- mapped to `ingressEnqueueApply`'s own
 *      `signal_ingress_accept_enqueue` family. Then, when the resulting
 *      inbox state is not already `"processed"`/`"dead_letter"`,
 *      `BackgroundTaskRepository.enqueueServiceTask("hosted_delivery_
 *      recovery", ...)` (background-task-repository.ts:668-721) writes
 *      `background_task_schedules`/`background_tasks`/`background_task_
 *      events` -- mapped to `tenantQueueWrite`'s own `signal_ingress_task_
 *      wake` family. See §3.
 *   b. The transport/lease lifecycle -- `leaseInboxByEventType` (hosted-
 *      delivery-repository.ts:219), `completeInbox` (:291), `retryInbox`
 *      (:316), `recoverExpiredLeases` (:459), all called from
 *      `DurableSignalIngressProcessor.processBatch` (signal-ingress.ts:
 *      161-211) or from the background-recovery task handler -- mapped to
 *      `hostedDeliveryLeaseRecovery`'s own `yoink_transition_trackalacker_
 *      signal_inbox` and `yoink_recover_hosted_delivery_leases` functions,
 *      already `signalInboxLifecycleRepositoryParity: true`. Delegated
 *      here via `evaluationRepositoryComposition` (rung-2 already lists
 *      this exact family as its own `signal_inbox_lifecycle_transition`
 *      row); re-bound and independently live-verified directly too (§4).
 *   c. The resolution-plan read side -- `signals.transportDuplicate()` plus
 *      catalog/source-reference candidate matching, reproduced natively as
 *      `yoink_plan_trackalacker_signal_resolution` -- already
 *      `signalResolutionPlanRepositoryParity: true`, read-only (every table
 *      reference is a `FROM`/`JOIN`, never an `INSERT`/`UPDATE` -- confirmed
 *      by rung-2's own header §4). Delegated the same way as (b), matching
 *      rung-2's own `signal_resolution_plan_compute` row.
 *   d. `retryDeadLetter(inboxId, correlationId, now)` (signal-ingress.ts:
 *      121-149) -- the OPERATOR-driven dead-letter replay path (reached
 *      only via `apps/api/src/app.ts:1411`, gated by `worker.manage`
 *      authorization). Its own `enqueueServiceTask("hosted_delivery_
 *      recovery", ...)` call is the IDENTICAL task-wake family as (a) --
 *      already covered by `tenantQueueWrite`. Its
 *      `HostedDeliveryRepository.retryDeadLetterInbox` call (hosted-
 *      delivery-repository.ts:611-669), however, is NOT covered by any
 *      bound member -- see §5 item 3.
 *   e. `processBatch(now, maximumSignals)` (signal-ingress.ts:161-211) --
 *      composes (b)'s lease/complete/retry calls around
 *      `SignalEngine.process()`, which rung-1
 *      (`signalEvaluationApplyRepositoryParity: true`) and rung-2
 *      (`signalEvaluationRepositoryParity: true`) already prove complete,
 *      gap-free repository coverage for, end to end. No new write family:
 *      every table `processBatch` itself touches is either (b)'s lease
 *      machinery or `SignalEngine.process()`'s own already-total surface.
 *
 * `HostedDeliveryRepository.acceptInbox`'s OTHER caller (the general,
 * non-signal `apps/api/src/app.ts:2113 hostedDelivery.acceptInbox(body)`
 * path) is out of scope for the same reason `ingressEnqueueApply`'s own
 * header §6 gives: unscoped `source`/`eventType`, a different, request-
 * driven write family this module's hardcoded-`trackalacker` function was
 * never meant to serve.
 *
 * ---------------------------------------------------------------------
 * 3. WHAT CLOSED THE GAP (postgres-signal-ingress-enqueue-apply.ts and
 *    postgres-tenant-queue-writes.ts, both read in full)
 * ---------------------------------------------------------------------
 * `postgres-signal-ingress-enqueue-apply.ts` (v0.99) is a bounded
 * SECURITY DEFINER function, `yoink_accept_signal_ingress_inbox`, that
 * reproduces `acceptInbox`'s own `inbox_messages`/`hosted_delivery_
 * receipts` write pair exactly for the ONE real signal-ingress caller
 * (`source`/`eventType` are hardcoded SQL literals, never caller input --
 * see that module's own header §4/§6), with `messageKey`/`payloadHash`
 * database-derived and the receipt ledger kept append-only even on dedupe.
 * It declares `ingressEnqueueWriterParity: true` and, by its own explicit
 * design (header §2), CONSUMES rather than reimplements the task-enqueue
 * half: it binds `postgres-tenant-queue-writes.ts`'s `tenant_queue_writer`
 * role (already qualified, table-for-table and privilege-for-privilege
 * identical to what `enqueueServiceTask` issues against `background_task_
 * schedules`/`background_tasks`/`background_task_events`) into its own
 * manifest via `queueWriteManifestFingerprint`, and calls
 * `verifyPostgresTenantQueueWriteBoundary` from both its own verify and
 * apply paths (verify only -- it never applies that module's role/grant
 * surface). Together, these two already-qualified boundaries reproduce
 * every write `acceptTrackalacker` (and `retryDeadLetter`'s own
 * `enqueueServiceTask` call) can perform on a fresh or already-known
 * signal. This module's own two NEW families (§4) name each half
 * separately -- `ingressEnqueueApply` for the accept/dedupe write,
 * `tenantQueueWrite` for the task-wake write -- rather than treating the
 * pair as one family, because they are independently qualified boundaries
 * with independent role/grant surfaces, exactly mirroring how rung-1 kept
 * `writerLockProtocol` and `constraintConfigApply` as separate chain
 * members despite both being "writer discipline," not business-mutation,
 * boundaries.
 *
 * ---------------------------------------------------------------------
 * 4. THREE CONVERGENCE PROOFS -- ONE CONNECTED DAG, NOT FOUR ISLANDS
 * ---------------------------------------------------------------------
 * All three are pure, in-process, zero-live-database fingerprint
 * comparisons performed at `build()` time, in the same spirit as rung-1's
 * eleven-hop sequence contract and rung-2's writer-track convergence proof
 * -- fail-closed via `PostgresSignalIngressCompositionError` on any drift:
 *
 *   A. SHARED-ANCESTRY convergence: `ingressEnqueueApply`'s own declared
 *      `attributionReceiptApplyManifestFingerprint` must equal
 *      `evaluationRepositoryComposition.attributionReceiptApplyManifest
 *      .fingerprint`. Both ultimately call the exact same zero-argument
 *      `buildPostgresSignalAttributionReceiptApplyManifest()` (rung-2's own
 *      build function calls it with no arguments; `ingressEnqueueApply`'s
 *      own default parameter is that identical zero-argument call), so this
 *      is a provable, not coincidental, fact -- proving this module's own
 *      chain and rung-2's own chain share one common ancestor rather than
 *      being disconnected islands, the same argument rung-2's own header
 *      §3 made for writer-track-B converging onto rung-1's `actionSpendApply`
 *      tip.
 *   B. QUEUE-WRITE convergence: `ingressEnqueueApply`'s own declared
 *      `queueWriteManifestFingerprint` must equal the SAME-schema
 *      `buildPostgresTenantQueueWriteManifest(schemaName)`'s own
 *      fingerprint, built independently here as this module's own
 *      `tenantQueueWrite` chain member. Proves the queue-writer bound
 *      *inside* `ingressEnqueueApply` and the queue-writer bound *directly*
 *      in this module's own chain are the identical node.
 *   C. LEASE-RECOVERY convergence: `buildPostgresHostedDeliveryLeaseRecovery
 *      Manifest()`'s own fingerprint, built independently here as this
 *      module's own `hostedDeliveryLeaseRecovery` chain member, must equal
 *      `evaluationRepositoryComposition.hostedDeliveryLeaseRecoveryManifest
 *      .fingerprint` -- rung-2's OWN embedded copy is the FULL manifest,
 *      not a `Pick` (unlike writer-track-B's predecessor fields; see §7),
 *      so this is a direct, total fingerprint equality, not a one-field
 *      proxy. Proves the lease-recovery node reachable directly here and
 *      the one reachable transitively through rung-2 are the identical
 *      node.
 *
 * Together, A-C prove this module's four-member chain is ONE connected
 * fingerprint graph rooted, on one side, in rung-1/rung-2's own already-
 * total evaluation-repository DAG, and on the other, in the queue-write
 * infrastructure `ingressEnqueueApply` itself already depends on -- not
 * four accidentally-unrelated qualifications bolted together.
 *
 * ---------------------------------------------------------------------
 * 5. WHAT STAYS OUT OF SCOPE (see
 *    POSTGRES_SIGNAL_INGRESS_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES)
 * ---------------------------------------------------------------------
 *   1. `NotificationRepository.ensureForJob` -- carried forward, unchanged
 *      in substance, from rung-2's own out-of-scope item 1: a handler/
 *      task-kind dispatch concern, not a repository write boundary.
 *   2. `CatalogRepository.upsertListing` reference INSERTs -- carried
 *      forward unchanged from rung-2's own out-of-scope item 2: the manual
 *      "add to library" flow, never signal-triggered.
 *   3. `HostedDeliveryRepository.retryDeadLetterInbox` (hosted-delivery-
 *      repository.ts:611-669) -- the OPERATOR half of §2 item (d). It
 *      UPDATEs `inbox_messages` (resetting a `dead_letter` row back to
 *      `'accepted'`), INSERTs a `hosted_delivery_receipts` row
 *      (`'retry'`/`'operator_retry'`), and calls `AuditRepository.record`
 *      (`audit_events` + `outbox_events`, event type
 *      `'signal_inbox_retried'`). None of this module's bound members
 *      qualify it: `ingressEnqueueApply`'s own function only ever INSERTs a
 *      fresh `'accepted'` row or appends a dedupe/conflict receipt -- it
 *      never UPDATEs an existing `dead_letter` row (its own header §5
 *      confirms `inbox_messages`'s later lifecycle UPDATEs are explicitly
 *      out of scope for that module). `hostedDeliveryLeaseRecovery`'s own
 *      `yoink_transition_trackalacker_signal_inbox` only transitions
 *      `accepted`/`processing` rows FORWARD toward `failed`/`dead_letter`
 *      on lease expiry -- never `dead_letter` back to `accepted` -- and its
 *      own `PROTECTED_TABLES` (`hosted_delivery_receipts`, `inbox_
 *      messages`, `outbox_events`) excludes `audit_events` entirely. A
 *      repository-wide grep for `hosted_inbox`/`signal_inbox_retried`
 *      across every `postgres-*.ts` qualification module returns no other
 *      hit. This is a genuinely distinct write family from
 *      `signalIngressRepositoryParity`'s own scope, which -- per rung-2's
 *      own §5 naming, quoted in full in §1 above -- is specifically the
 *      enqueue path for a NEW inbound signal, not an operator's manual
 *      replay of an already-dead-lettered one. (`retryDeadLetter`'s own
 *      companion `enqueueServiceTask` call IS covered, by the identical
 *      `signal_ingress_task_wake` family §2 item (a) names -- only the
 *      inbox-reset/audit half of that one method is not.)
 *   4. The task-kind DISPATCH mechanism itself (packages/engine/src/
 *      background-worker-runtime.ts:235, `this.handler.execute(context,
 *      lease.taskKind, now)`) -- the code that decides which handler
 *      function actually runs for each of the seven `BACKGROUND_TASK_KINDS`
 *      (packages/domain/src/background-task.ts:59-61: `execution_recovery`,
 *      `notification_recovery`, `hosted_delivery_recovery`,
 *      `adapter_alert_reconciliation`,
 *      `observer_recipe_candidate_evaluation`,
 *      `observer_recipe_witness_refresh`,
 *      `operational_telemetry_retention`), including
 *      `DurableSignalIngressProcessor.processBatch` itself (§2 item (e))
 *      for `hosted_delivery_recovery` -- is pure application-layer
 *      orchestration/routing code with no PostgreSQL repository-write
 *      surface of its own to qualify. `postgres-hosted-delivery-lease-
 *      recovery.ts`'s own `boundaryHandlerTaskKinds` (1) +
 *      `qualifiedHandlerTaskKinds` (6) fields already structurally account
 *      for all seven task-kind NAMES against the protected/RLS-forced
 *      tables each handler's own recovery machinery touches -- but naming a
 *      task kind is not the same as reproducing its handler's dispatch/
 *      execution logic. This is precisely the axis
 *      `hostedDeliveryHandlerRepositoryParity` / `allHandlerRepositoryParity`
 *      track, both still `false` below -- carried forward, unchanged in
 *      substance, from every module in this lineage back through
 *      `postgres-hosted-delivery-lease-recovery.ts` itself.
 *
 * ---------------------------------------------------------------------
 * 6. WHAT FORM THE COMPOSITION TAKES, AND WHY
 * ---------------------------------------------------------------------
 * Like rung-2 (and unlike rung-1's strictly linear chain), this module's
 * four-member chain is a FAN-IN: `ingressEnqueueApply` and `tenantQueueWrite`
 * contribute this module's own two NEW families; `hostedDeliveryLeaseRecovery`
 * and `evaluationRepositoryComposition` are DELEGATED -- their combined
 * seventeen already-total families (2 for lease-recovery's own plan/
 * lifecycle rows, 15 for rung-2's own accounting) are cited by import, never
 * re-listed, to avoid a second, driftable copy of tables rung-2's own
 * `build()` already fails closed on. `hostedDeliveryLeaseRecovery` is bound
 * BOTH directly (its own chain entry, independently live-verified) AND
 * transitively (through `evaluationRepositoryComposition`'s own embedded
 * copy) -- §4 proof C is exactly what makes binding it twice honest rather
 * than redundant-and-silent. `verifyPostgresSignalIngressCompositionBoundary`
 * below therefore calls all four members' own live-database verify
 * functions, deliberately accepting that `tenantQueueWrite` gets re-verified
 * once directly and once more transitively (inside `ingressEnqueueApply`'s
 * own verify), and that `hostedDeliveryLeaseRecovery` gets re-verified once
 * directly and once more transitively (inside `evaluationRepositoryComposition`'s
 * own verify) -- idempotent reads against a live Postgres catalog, no
 * mutation, no risk -- rather than trying to prune that redundancy,
 * exactly the choice rung-2's own header §6 documented and defended.
 *
 * Because none of the four members' own `build...Manifest()` functions
 * creates a new role, function, receipt table, or mutation path, and this
 * module adds no SQL of its own, `noNewRoleCreated`/`noNewFunctionCreated`/
 * `noNewMutationPath` all stay `true` -- this composition proves CLOSURE,
 * it does not create a fifth qualified writer.
 *
 * ---------------------------------------------------------------------
 * 7. JUDGMENT CALLS FOR REVIEWER SCRUTINY
 * ---------------------------------------------------------------------
 *   - `tenantQueueWrite`'s per-entry `mutationAuthority` cannot be read
 *     uniformly the way every other member's can (rung-1/rung-2's own
 *     "read from the capability projection" discipline): a full-file grep
 *     of `postgres-tenant-queue-writes.ts` confirms it exposes NO
 *     `mutationAuthority` field anywhere -- not on its manifest, its
 *     qualification receipt, nor its capability projection. Rather than
 *     inventing a value, this module derives it structurally, in-process,
 *     from that module's own declared `writeRole.tableGrants`: `true` iff
 *     at least one granted table carries `INSERT` or `UPDATE` (it does --
 *     `background_task_schedules`/`background_tasks` both do, the exact
 *     tables `enqueueServiceTask` writes). This is a strictly worse
 *     asymmetry than the one rung-1/rung-2 already documented (some
 *     members lack it on the MANIFEST but still carry it on the capability
 *     projection); here one member lacks it everywhere.
 *   - This module's own two families skip rung-2's `kind: "plan" |
 *     "mutation"` discriminator entirely: both `signal_ingress_accept_
 *     enqueue` and `signal_ingress_task_wake` are mutation families (the
 *     fail-closed CONFLICT path of the former performs zero writes, but
 *     that is a failure branch, not the family's normal shape -- unlike
 *     rung-2's resolution-plan family, which is read-only on EVERY
 *     invocation by construction). Reintroducing an always-`"mutation"`
 *     discriminator here would add a field with no discriminating power;
 *     omitted, mirroring rung-1's simpler, discriminator-free family type
 *     for exactly the same reason.
 *   - `hostedDeliveryLeaseRecovery` is bound both directly and (through
 *     `evaluationRepositoryComposition`) transitively -- see §4 proof C and
 *     §6. This is a deliberate strengthening, not an oversight: rung-2's
 *     own manifest happens to carry the FULL nested `hostedDeliveryLease
 *     RecoveryManifest` (not a `Pick`, unlike writer-track-B's predecessor
 *     fields), so the direct-vs-transitive equality is a complete, total
 *     fingerprint proof here, stronger than the one-field convergence proof
 *     rung-2 itself could manage for its own writer-track-B lineage (that
 *     lineage's `Pick`-typed predecessor fields, documented as a real
 *     limitation in rung-2's own header §7, made a full multi-hop re-walk
 *     mechanically impossible there).
 *   - This module's OWN convergence proof A (§4) is likewise a genuine
 *     ONE-HOP check, not a full re-walk, for the identical reason:
 *     `ingressEnqueueApply.predecessorManifest` is itself `Pick`-typed
 *     (`schemaName` | `fingerprint` | `attributionReceiptRoleNamespace`
 *     only), so nothing upstream of `attributionReceiptApply` is
 *     mechanically reachable from `ingressEnqueueApply`'s own manifest.
 *     The one-hop check is still sound: `attributionReceiptApply` is
 *     exactly the node both chains name as their immediate common
 *     neighbor.
 *   - The PGlite contract test asserts this module exports no
 *     `...FunctionSource` function at all, matching rung-2's own choice for
 *     the identical reason: every one of this module's four bound members
 *     already owns its own PGlite parse-probe test elsewhere in this
 *     repository. This module generates no SQL of its own to probe.
 */
import { createHash } from "node:crypto";
import type { PostgresCutoverDatabase } from "./postgres-cutover.js";
import {
  POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
  buildPostgresHostedDeliveryLeaseRecoveryManifest,
  postgresHostedDeliveryLeaseRecoveryCapabilityProjection,
  verifyPostgresHostedDeliveryLeaseRecoveryBoundary,
  type PostgresHostedDeliveryLeaseRecoveryManifest
} from "./postgres-hosted-delivery-lease-recovery.js";
import { canonicalPortabilityJson } from "./portability.js";
import {
  POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CONTRACT_VERSION,
  buildPostgresSignalEvaluationRepositoryCompositionManifest,
  postgresSignalEvaluationRepositoryCompositionCapabilityProjection,
  verifyPostgresSignalEvaluationRepositoryCompositionBoundary,
  type PostgresSignalEvaluationRepositoryCompositionManifest
} from "./postgres-signal-evaluation-repository-composition.js";
import {
  POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONTRACT_VERSION,
  buildPostgresSignalIngressEnqueueApplyManifest,
  postgresSignalIngressEnqueueApplyCapabilityProjection,
  verifyPostgresSignalIngressEnqueueApplyBoundary,
  type PostgresSignalIngressEnqueueApplyManifest
} from "./postgres-signal-ingress-enqueue-apply.js";
import {
  POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
  buildPostgresTenantQueueWriteManifest,
  verifyPostgresTenantQueueWriteBoundary,
  type PostgresTenantQueueWriteManifest
} from "./postgres-tenant-queue-writes.js";

export const POSTGRES_SIGNAL_INGRESS_COMPOSITION_CONTRACT_VERSION = 1;

export type PostgresSignalIngressCompositionBoundaryKey =
  | "ingressEnqueueApply"
  | "tenantQueueWrite"
  | "hostedDeliveryLeaseRecovery"
  | "evaluationRepositoryComposition";

/** Structural order -- see header section 6 (fan-in, not a linear chain). */
export const POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_ORDER = Object.freeze([
  "ingressEnqueueApply",
  "tenantQueueWrite",
  "hostedDeliveryLeaseRecovery",
  "evaluationRepositoryComposition"
] as const satisfies readonly PostgresSignalIngressCompositionBoundaryKey[]);

export const POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_LENGTH = 4;

/**
 * `hostedDeliveryLeaseRecovery` and `evaluationRepositoryComposition` own no
 * family row of their own here: their combined seventeen families are
 * already total (rung-2's own `build()` fails closed on that, and this
 * module's own convergence proof C -- header section 4 -- ties the directly
 * bound `hostedDeliveryLeaseRecovery` to the exact same node embedded inside
 * `evaluationRepositoryComposition`), and are cited by import rather than
 * re-listed -- see header section 6.
 */
export const POSTGRES_SIGNAL_INGRESS_COMPOSITION_DELEGATED_BOUNDARIES = Object.freeze([
  "hostedDeliveryLeaseRecovery",
  "evaluationRepositoryComposition"
] as const satisfies readonly PostgresSignalIngressCompositionBoundaryKey[]);

export interface PostgresSignalIngressCompositionFamily {
  readonly family: string;
  readonly sqliteSource: string;
  readonly sqliteTables: readonly string[];
  readonly boundary: PostgresSignalIngressCompositionBoundaryKey;
}

/** See header sections 2 and 3 for the derivation of every row below. */
export const POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILIES = Object.freeze([
  Object.freeze({
    family: "signal_ingress_accept_enqueue",
    sqliteSource:
      "HostedDeliveryRepository.acceptInbox (hosted-delivery-repository.ts:153-213), "
      + "called once from DurableSignalIngressService.acceptTrackalacker's own ambient "
      + "this.db.transaction(...) (signal-ingress.ts:79-118) for a NEW inbound "
      + "trackalacker signal -- fresh accept (INSERT inbox_messages + INSERT "
      + "hosted_delivery_receipts) or dedupe (INSERT hosted_delivery_receipts only); "
      + "the fail-closed conflict path performs zero writes and throws",
    sqliteTables: Object.freeze(["inbox_messages", "hosted_delivery_receipts"]),
    boundary: "ingressEnqueueApply"
  }),
  Object.freeze({
    family: "signal_ingress_task_wake",
    sqliteSource:
      "BackgroundTaskRepository.enqueueServiceTask('hosted_delivery_recovery', "
      + "'signal:<inboxId>', now) (background-task-repository.ts:668-721), called from "
      + "both DurableSignalIngressService.acceptTrackalacker (signal-ingress.ts:90-102, "
      + "whenever the resulting inbox state is not already processed/dead_letter) and "
      + "DurableSignalIngressService.retryDeadLetter (signal-ingress.ts:130-139)",
    sqliteTables: Object.freeze([
      "background_task_schedules", "background_tasks", "background_task_events"
    ]),
    boundary: "tenantQueueWrite"
  })
] as const satisfies readonly PostgresSignalIngressCompositionFamily[]);

export const POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILY_COUNT = 2;

/** See header section 5. */
export const POSTGRES_SIGNAL_INGRESS_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES = Object.freeze([
  "NotificationRepository.ensureForJob -> notification/outbox delivery handler surface "
    + "(hosted-delivery / notification-recovery handler composition -- task-kind dispatch "
    + "wiring, not a repository write boundary; tracked by hostedDeliveryHandlerRepositoryParity "
    + "/ allHandlerRepositoryParity, both still false). Carried forward unchanged from "
    + "postgres-signal-evaluation-repository-composition.ts.",
  "CatalogRepository.upsertListing reference INSERTs -> source_listing_refs/"
    + "source_product_aliases/source_product_refs (manual 'add to library' flow, not "
    + "signal-triggered -- a request-repository concern). Carried forward unchanged.",
  "HostedDeliveryRepository.retryDeadLetterInbox (hosted-delivery-repository.ts:611-669), the "
    + "OPERATOR-driven dead-letter replay reached via DurableSignalIngressService.retryDeadLetter "
    + "(signal-ingress.ts:121-149) and apps/api/src/app.ts:1411 -- UPDATE inbox_messages resetting "
    + "a dead_letter row back to 'accepted', an INSERT into hosted_delivery_receipts "
    + "('retry'/'operator_retry'), and AuditRepository.record's audit_events+outbox_events pair "
    + "('signal_inbox_retried'). Not covered by ingressEnqueueApply (INSERT-only, never UPDATEs an "
    + "existing dead_letter row), not covered by hostedDeliveryLeaseRecovery (its own "
    + "yoink_transition_trackalacker_signal_inbox only transitions accepted/processing rows FORWARD "
    + "on lease expiry, never dead_letter back to accepted, and its PROTECTED_TABLES excludes "
    + "audit_events entirely), and not covered by any other qualified boundary in this repository "
    + "(grep-confirmed). Distinct from signalIngressRepositoryParity's own scope, which is the "
    + "enqueue path for a NEW inbound signal, not an operator's replay of an already-dead-lettered "
    + "one -- retryDeadLetter's own enqueueServiceTask call IS covered, by signal_ingress_task_wake.",
  "The task-kind DISPATCH mechanism itself (packages/engine/src/background-worker-runtime.ts:235, "
    + "'this.handler.execute(context, lease.taskKind, now)') that decides which handler function "
    + "runs for each of the seven BACKGROUND_TASK_KINDS (packages/domain/src/background-task.ts:"
    + "59-61), including DurableSignalIngressProcessor.processBatch itself for "
    + "hosted_delivery_recovery -- pure application-layer orchestration/routing code with no "
    + "PostgreSQL repository-write surface to qualify. Grounds hostedDeliveryHandlerRepositoryParity "
    + "/ allHandlerRepositoryParity, both still false, carried forward in substance from every "
    + "module in this lineage back through postgres-hosted-delivery-lease-recovery.ts itself."
] as const);

export interface PostgresSignalIngressCompositionChainEntry {
  readonly boundary: PostgresSignalIngressCompositionBoundaryKey;
  readonly contractVersion: number;
  readonly mutationAuthority: boolean;
  readonly fingerprint: string;
}

export interface PostgresSignalIngressCompositionManifest {
  contractVersion: typeof POSTGRES_SIGNAL_INGRESS_COMPOSITION_CONTRACT_VERSION;
  ingressEnqueueApplyContractVersion: typeof POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONTRACT_VERSION;
  tenantQueueWriteContractVersion: typeof POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION;
  hostedDeliveryLeaseRecoveryContractVersion: typeof POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION;
  evaluationRepositoryCompositionContractVersion: typeof POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CONTRACT_VERSION;
  schemaName: string;
  ingressEnqueueApplyManifest: PostgresSignalIngressEnqueueApplyManifest;
  tenantQueueWriteManifest: PostgresTenantQueueWriteManifest;
  hostedDeliveryLeaseRecoveryManifest: PostgresHostedDeliveryLeaseRecoveryManifest;
  evaluationRepositoryCompositionManifest: PostgresSignalEvaluationRepositoryCompositionManifest;
  chain: PostgresSignalIngressCompositionChainEntry[];
  chainBoundaryCount: typeof POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_LENGTH;
  sharedAncestryConvergenceVerified: true;
  queueWriteConvergenceVerified: true;
  leaseRecoveryConvergenceVerified: true;
  ownFamilies: readonly PostgresSignalIngressCompositionFamily[];
  ownFamilyCount: typeof POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILY_COUNT;
  delegatedFamilyCount: number;
  totalFamilyCount: number;
  unmappedOwnFamilyCount: 0;
  unmappedChainBoundaryCount: 0;
  delegatedBoundaries: readonly PostgresSignalIngressCompositionBoundaryKey[];
  knownOutOfScopeWrites: readonly string[];
  noNewRoleCreated: true;
  noNewFunctionCreated: true;
  noNewMutationPath: true;
  signalEvaluationApplyRepositoryParity: true;
  signalEvaluationRepositoryParity: true;
  signalIngressRepositoryParity: true;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  mutationAuthority: true;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalIngressCompositionCapabilityProjection {
  contractVersion: typeof POSTGRES_SIGNAL_INGRESS_COMPOSITION_CONTRACT_VERSION;
  deterministicManifestImplemented: true;
  sharedAncestryConvergenceVerified: true;
  queueWriteConvergenceVerified: true;
  leaseRecoveryConvergenceVerified: true;
  chainBoundaryCount: typeof POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_LENGTH;
  ownFamilyCount: typeof POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILY_COUNT;
  delegatedFamilyCount: number;
  totalFamilyCount: number;
  unmappedOwnFamilyCount: 0;
  noNewRoleCreated: true;
  noNewFunctionCreated: true;
  noNewMutationPath: true;
  signalEvaluationApplyRepositoryParity: true;
  signalEvaluationRepositoryParity: true;
  signalIngressRepositoryParity: true;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export class PostgresSignalIngressCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalIngressCompositionError";
  }
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

/**
 * `postgres-tenant-queue-writes.ts` exposes no `mutationAuthority` field
 * anywhere (manifest, qualification receipt, or capability projection --
 * confirmed absent by direct inspection of that module's source; see header
 * section 7). Derived here, structurally, from that module's own declared
 * `writeRole.tableGrants` instead of invented: `true` iff at least one
 * granted table carries `INSERT` or `UPDATE`.
 */
function tenantQueueWriteMutationAuthority(manifest: PostgresTenantQueueWriteManifest): boolean {
  return manifest.writeRole.tableGrants.some(
    (grant) => grant.privileges.includes("INSERT") || grant.privileges.includes("UPDATE")
  );
}

let cachedCapabilityProjection:
Readonly<PostgresSignalIngressCompositionCapabilityProjection> | null = null;

export function buildPostgresSignalIngressCompositionManifest():
PostgresSignalIngressCompositionManifest {
  const ingressEnqueueApply = buildPostgresSignalIngressEnqueueApplyManifest();
  const tenantQueueWrite = buildPostgresTenantQueueWriteManifest(ingressEnqueueApply.schemaName);
  const hostedDeliveryLeaseRecovery = buildPostgresHostedDeliveryLeaseRecoveryManifest();
  const evaluationRepositoryComposition = buildPostgresSignalEvaluationRepositoryCompositionManifest();

  if (tenantQueueWrite.schemaName !== ingressEnqueueApply.schemaName
    || hostedDeliveryLeaseRecovery.schemaName !== ingressEnqueueApply.schemaName
    || evaluationRepositoryComposition.schemaName !== ingressEnqueueApply.schemaName) {
    throw new PostgresSignalIngressCompositionError(
      "The PostgreSQL signal-ingress composition's bound members must share one schema."
    );
  }

  // Convergence proof A (header section 4): ingressEnqueueApply's own
  // predecessor and rung-2's own embedded attributionReceiptApply must be
  // the identical node.
  if (ingressEnqueueApply.attributionReceiptApplyManifestFingerprint
    !== evaluationRepositoryComposition.attributionReceiptApplyManifest.fingerprint) {
    throw new PostgresSignalIngressCompositionError(
      "The PostgreSQL signal-ingress composition's shared-ancestry convergence is broken."
    );
  }
  // Convergence proof B: the queue-writer bound inside ingressEnqueueApply
  // and the queue-writer bound directly in this module's own chain must be
  // the identical node.
  if (ingressEnqueueApply.queueWriteManifestFingerprint !== tenantQueueWrite.fingerprint) {
    throw new PostgresSignalIngressCompositionError(
      "The PostgreSQL signal-ingress composition's queue-write convergence is broken."
    );
  }
  // Convergence proof C: the lease-recovery boundary bound directly here
  // and the one embedded inside rung-2's own manifest must be the identical
  // node.
  if (hostedDeliveryLeaseRecovery.fingerprint
    !== evaluationRepositoryComposition.hostedDeliveryLeaseRecoveryManifest.fingerprint) {
    throw new PostgresSignalIngressCompositionError(
      "The PostgreSQL signal-ingress composition's lease-recovery convergence is broken."
    );
  }

  // Re-affirm rung-2's own already-proven flags (header section 1) and this
  // module's own closure precondition before ever claiming completeness.
  if (evaluationRepositoryComposition.signalEvaluationApplyRepositoryParity !== true
    || evaluationRepositoryComposition.signalEvaluationRepositoryParity !== true) {
    throw new PostgresSignalIngressCompositionError(
      "The PostgreSQL signal-ingress composition requires rung-2's own repository parity to hold."
    );
  }
  if (ingressEnqueueApply.ingressEnqueueWriterParity !== true) {
    throw new PostgresSignalIngressCompositionError(
      "The PostgreSQL signal-ingress composition requires the ingress-enqueue-apply boundary to hold."
    );
  }

  // mutationAuthority is read from each boundary's own capability
  // projection where one exists -- see header section 7 for the
  // tenantQueueWrite exception, derived structurally instead.
  const chain: PostgresSignalIngressCompositionChainEntry[] = [
    {
      boundary: "ingressEnqueueApply",
      contractVersion: POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONTRACT_VERSION,
      mutationAuthority: postgresSignalIngressEnqueueApplyCapabilityProjection().mutationAuthority,
      fingerprint: ingressEnqueueApply.fingerprint
    },
    {
      boundary: "tenantQueueWrite",
      contractVersion: POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
      mutationAuthority: tenantQueueWriteMutationAuthority(tenantQueueWrite),
      fingerprint: tenantQueueWrite.fingerprint
    },
    {
      boundary: "hostedDeliveryLeaseRecovery",
      contractVersion: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
      mutationAuthority: postgresHostedDeliveryLeaseRecoveryCapabilityProjection().mutationAuthority,
      fingerprint: hostedDeliveryLeaseRecovery.fingerprint
    },
    {
      boundary: "evaluationRepositoryComposition",
      contractVersion: POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CONTRACT_VERSION,
      mutationAuthority: postgresSignalEvaluationRepositoryCompositionCapabilityProjection().mutationAuthority,
      fingerprint: evaluationRepositoryComposition.fingerprint
    }
  ];

  if (chain.length !== POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_LENGTH
    || new Set(chain.map((entry) => entry.boundary)).size !== chain.length
    || new Set(chain.map((entry) => entry.fingerprint)).size !== chain.length) {
    throw new PostgresSignalIngressCompositionError(
      "The PostgreSQL signal-ingress composition chain is not exactly-once complete."
    );
  }
  const chainKeys = new Set(chain.map((entry) => entry.boundary));
  const orderMismatch = POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_ORDER.some(
    (key, index) => chain[index]?.boundary !== key
  );
  if (orderMismatch || !POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_ORDER.every((key) => chainKeys.has(key))) {
    throw new PostgresSignalIngressCompositionError(
      "The PostgreSQL signal-ingress composition chain order drifted from its declared sequence."
    );
  }

  const coveredBoundaries = new Set<PostgresSignalIngressCompositionBoundaryKey>([
    ...POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILIES.map((entry) => entry.boundary),
    ...POSTGRES_SIGNAL_INGRESS_COMPOSITION_DELEGATED_BOUNDARIES
  ]);
  const unmappedChainBoundaries = POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_ORDER.filter(
    (key) => !coveredBoundaries.has(key)
  );
  const unmappedOwnFamilies = POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILIES.filter(
    (entry) => !chainKeys.has(entry.boundary)
  );
  if (unmappedChainBoundaries.length !== 0 || unmappedOwnFamilies.length !== 0
    || POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILIES.length
      !== POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILY_COUNT) {
    throw new PostgresSignalIngressCompositionError(
      "The PostgreSQL signal-ingress composition coverage accounting is incomplete."
    );
  }

  const delegatedFamilyCount = evaluationRepositoryComposition.totalFamilyCount;
  const withoutFingerprint: Omit<PostgresSignalIngressCompositionManifest, "fingerprint"> = {
    contractVersion: POSTGRES_SIGNAL_INGRESS_COMPOSITION_CONTRACT_VERSION,
    ingressEnqueueApplyContractVersion: POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONTRACT_VERSION,
    tenantQueueWriteContractVersion: POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
    hostedDeliveryLeaseRecoveryContractVersion: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
    evaluationRepositoryCompositionContractVersion: POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CONTRACT_VERSION,
    schemaName: ingressEnqueueApply.schemaName,
    ingressEnqueueApplyManifest: ingressEnqueueApply,
    tenantQueueWriteManifest: tenantQueueWrite,
    hostedDeliveryLeaseRecoveryManifest: hostedDeliveryLeaseRecovery,
    evaluationRepositoryCompositionManifest: evaluationRepositoryComposition,
    chain,
    chainBoundaryCount: POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_LENGTH,
    sharedAncestryConvergenceVerified: true,
    queueWriteConvergenceVerified: true,
    leaseRecoveryConvergenceVerified: true,
    ownFamilies: POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILIES,
    ownFamilyCount: POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILY_COUNT,
    delegatedFamilyCount,
    totalFamilyCount: POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILY_COUNT + delegatedFamilyCount,
    unmappedOwnFamilyCount: 0,
    unmappedChainBoundaryCount: 0,
    delegatedBoundaries: POSTGRES_SIGNAL_INGRESS_COMPOSITION_DELEGATED_BOUNDARIES,
    knownOutOfScopeWrites: POSTGRES_SIGNAL_INGRESS_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES,
    noNewRoleCreated: true,
    noNewFunctionCreated: true,
    noNewMutationPath: true,
    signalEvaluationApplyRepositoryParity: true,
    signalEvaluationRepositoryParity: true,
    signalIngressRepositoryParity: true,
    hostedDeliveryHandlerRepositoryParity: false,
    allHandlerRepositoryParity: false,
    mutationAuthority: true,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresSignalIngressCompositionCapabilityProjection():
PostgresSignalIngressCompositionCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalIngressCompositionManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_SIGNAL_INGRESS_COMPOSITION_CONTRACT_VERSION,
    deterministicManifestImplemented: true,
    sharedAncestryConvergenceVerified: true,
    queueWriteConvergenceVerified: true,
    leaseRecoveryConvergenceVerified: true,
    chainBoundaryCount: POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_LENGTH,
    ownFamilyCount: POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILY_COUNT,
    delegatedFamilyCount: manifest.delegatedFamilyCount,
    totalFamilyCount: manifest.totalFamilyCount,
    unmappedOwnFamilyCount: 0,
    noNewRoleCreated: true,
    noNewFunctionCreated: true,
    noNewMutationPath: true,
    signalEvaluationApplyRepositoryParity: true,
    signalEvaluationRepositoryParity: true,
    signalIngressRepositoryParity: true,
    hostedDeliveryHandlerRepositoryParity: false,
    allHandlerRepositoryParity: false,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: true,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

/**
 * Re-derives the composition manifest (catching any drift in the three
 * convergence proofs or the coverage accounting) and then walks all four
 * members' own live-database verify functions. Unlike rung-1's single-tip
 * cascade, no one call here transitively covers the other three -- see
 * header section 6 for why this module deliberately accepts the resulting
 * (harmless, read-only) re-verification of shared ancestry.
 */
export async function verifyPostgresSignalIngressCompositionBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalIngressCompositionManifest()
): Promise<PostgresSignalIngressCompositionManifest> {
  const rebuilt = buildPostgresSignalIngressCompositionManifest();
  if (rebuilt.fingerprint !== manifest.fingerprint) {
    throw new PostgresSignalIngressCompositionError(
      "The PostgreSQL signal-ingress composition manifest has drifted from its live sub-boundaries."
    );
  }
  await verifyPostgresSignalIngressEnqueueApplyBoundary(database, manifest.ingressEnqueueApplyManifest);
  await verifyPostgresTenantQueueWriteBoundary(
    database,
    manifest.tenantQueueWriteManifest.schemaName,
    manifest.tenantQueueWriteManifest.readRoleNamespace,
    manifest.tenantQueueWriteManifest.sessionRoleNamespace,
    manifest.tenantQueueWriteManifest.writeRoleNamespace
  );
  await verifyPostgresHostedDeliveryLeaseRecoveryBoundary(database);
  await verifyPostgresSignalEvaluationRepositoryCompositionBoundary(
    database,
    manifest.evaluationRepositoryCompositionManifest
  );
  return manifest;
}
