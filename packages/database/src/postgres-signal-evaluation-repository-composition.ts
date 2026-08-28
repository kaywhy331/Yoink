/**
 * PostgreSQL signal-EVALUATION-REPOSITORY composition — the v1.00-adjacent
 * boundary that closes `signalEvaluationRepositoryParity` (declared `false`
 * in postgres-hosted-delivery-lease-recovery.ts and in the v0.98
 * postgres-signal-evaluation-composition.ts projection). Like both of those
 * modules, this one creates NO new PostgreSQL role, function, receipt table,
 * or mutation path. It proves — deterministically, re-derivable on every
 * run, and by fingerprint-binding five already-qualified boundaries rather
 * than re-implementing any of them — that the FULL SQLite evaluation
 * repository surface (not just the "apply chain" rung-1 closed) is now
 * covered by exactly one qualified PostgreSQL owner apiece. Every fact below
 * was read out of the actual source, not assumed.
 *
 * ---------------------------------------------------------------------
 * 1. WHAT RUNG-1 LEFT OPEN (precedent: postgres-signal-evaluation-
 *    composition.ts, v0.98)
 * ---------------------------------------------------------------------
 * Rung-1 proved `signalEvaluationApplyRepositoryParity: true`: its own
 * eleven-boundary chain (catalogApply .. actionSpendApply) is a complete,
 * gap-free write path for `SignalEngine.process()` from ingress-event-record
 * through INITIAL action-job creation. It explicitly left
 * `signalEvaluationRepositoryParity: false` and named four write families as
 * `POSTGRES_SIGNAL_EVALUATION_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES`:
 *   1. `AttributionRepository.recordReceipt -> attribution_receipts`
 *   2. `NotificationRepository.ensureForJob` (handler-level, not repository)
 *   3. `SignalRepository.transitionJob` post-creation branches ->
 *      `spend_ledger_entries` (commit/release) and
 *      `missions.fulfilled_quantity`
 *   4. `CatalogRepository.upsertListing` reference INSERTs (manual flow)
 * Separately, postgres-hosted-delivery-lease-recovery.ts already carries
 * `signalResolutionPlanRepositoryParity: true` and
 * `signalInboxLifecycleRepositoryParity: true` for its own two native
 * PL/pgSQL functions (`yoink_plan_trackalacker_signal_resolution`,
 * `yoink_transition_trackalacker_signal_inbox`) — the READ/PLAN half of the
 * evaluation surface that sits BEFORE `SignalEngine.process()` ever runs,
 * and the pre-evaluation dequeue lifecycle. Neither flag alone, nor rung-1's
 * flag alone, amounts to "the full evaluation REPOSITORY is covered" — no
 * module has ever asserted that in one place. That is what this module
 * proves, by fingerprint-binding all of the pieces above (plus the two
 * v0.99/v1.00 residual writers below) into one manifest.
 *
 * ---------------------------------------------------------------------
 * 2. WHAT CLOSED THE GAP (packages/database/src/
 *    postgres-signal-attribution-receipt-apply.ts and
 *    postgres-signal-job-lifecycle-apply.ts, both read in full)
 * ---------------------------------------------------------------------
 * Out-of-scope item 1 above is closed exactly by
 * postgres-signal-attribution-receipt-apply.ts, whose own header says so in
 * as many words ("closes the first of the three write families
 * ... KNOWN_OUT_OF_SCOPE_WRITES"). It reproduces
 * `AttributionRepository.recordReceipt` (attribution_receipts + the
 * fresh-insert-only audit_events/outbox_events pair) with an
 * `attributionReceiptWriterParity: true` flag.
 *
 * Out-of-scope item 3 above is closed by TWO modules working together, read
 * in full:
 *   - postgres-signal-reservation-lifecycle-apply.ts (v0.93, already
 *     qualified BEFORE rung-1 existed) already owns the
 *     `spend_ledger_entries`/`spend_reservations` half — its own
 *     `commit_spend_reservation`/`release_spend_reservation` operations are
 *     exactly `SpendLedgerRepository.commitForJob`/`.releaseForJob`, called
 *     from `transitionJob`'s branch 6c/6a. This module was NOT part of
 *     rung-1's eleven-boundary chain (rung-1's own out-of-scope note treats
 *     the whole "commit/release" family as open) — see section 3 for why it
 *     is still fully accounted for here.
 *   - postgres-signal-job-lifecycle-apply.ts (v1.00) closes the REST:
 *     `action_jobs.state`, `action_events`, `signal_incidents` (closed/
 *     locked), `missions.fulfilled_quantity`, and the final
 *     `audit_events`/`outbox_events` pair for EVERY `transitionJob` branch.
 *     Its own header names the precise residual: "five distinct write
 *     families across three tables reservation-lifecycle-apply never
 *     mentions or touches."
 * Items 2 and 4 remain genuinely out of scope — see section 5.
 *
 * ---------------------------------------------------------------------
 * 3. THE WRITER-TRACK-B DISCOVERY: ONE DAG, NOT TWO FORKS
 * ---------------------------------------------------------------------
 * postgres-signal-attribution-receipt-apply.ts and
 * postgres-signal-job-lifecycle-apply.ts both declare their predecessor as
 * `buildPostgresSignalAttributionPolicyApplyManifest()` — a module that has
 * NOTHING to do with rung-1's own eleven-boundary chain on its face. Reading
 * every `predecessorManifest = build...()` default in that lineage
 * (packages/database/src/postgres-signal-{attribution-policy,
 * source-provisioning,catalog-import,reservation-lifecycle,source-sync,
 * source-status,mission-policy,retailer-qualification,source-trust,
 * target-qualification}-apply.ts) end to end gives this exact chain:
 *
 *   attributionPolicyApply -> sourceProvisioningApply -> catalogImportApply
 *   -> reservationLifecycleApply -> sourceSyncApply -> sourceStatusApply
 *   -> missionPolicyApply -> retailerQualificationApply -> sourceTrustApply
 *   -> targetQualificationApply -> **actionSpendApply**
 *
 * `postgres-signal-target-qualification-apply.ts`'s own default predecessor
 * is `buildPostgresSignalActionSpendApplyManifest()` — rung-1's OWN chain
 * TIP. Because every one of these `build...Manifest()` functions is a pure
 * function of its (defaulted) predecessor manifest, this is not a
 * coincidence to merely note: it is a provable fact this module asserts at
 * build time (no live database needed) by comparing
 * `buildPostgresSignalTargetQualificationApplyManifest()
 *   .actionSpendApplyManifestFingerprint` against rung-1's own
 * `evaluationApplyComposition.actionSpendApplyManifest.fingerprint` — see
 * `buildPostgresSignalEvaluationRepositoryCompositionManifest` below. The
 * practical consequence: `verifyPostgresSignalAttributionReceiptApplyBoundary`
 * and `verifyPostgresSignalJobLifecycleApplyBoundary`, by cascading to their
 * own predecessor's verify function ten hops deep, ALREADY transitively
 * re-verify rung-1's entire eleven-boundary chain (via `actionSpendApply`)
 * AND `reservationLifecycleApply` AND the nine writer-track-B configuration
 * boundaries in between, against the live Postgres catalog, every time
 * either one is called. This module's SQLite evaluation repository is
 * therefore genuinely ONE connected fingerprint DAG rooted in rung-1's own
 * chain, not a fan-in of accidentally-unrelated islands — the strongest
 * form of "completeness argument" available without re-implementing
 * anything.
 *
 * `hostedDeliveryLeaseRecovery` is the one true second root: its own
 * predecessor chain runs through `postgres-observer-witness-refresh.ts` and
 * onward, sharing no node with writer-track-B or rung-1. It is bound here by
 * its own direct fingerprint and independently live-verified (see section
 * 6), not by a fingerprint-equality proof like section 3's.
 *
 * ---------------------------------------------------------------------
 * 4. THE MAPPING (see POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES
 *    below)
 * ---------------------------------------------------------------------
 * This module's chain has five members:
 *   - `evaluationApplyComposition` (rung-1's own eleven-boundary chain,
 *     whose ten already-total mutation families are DELEGATED — cited by
 *     import, never re-listed here, to avoid a second, driftable copy of a
 *     table rung-1's own build() already fails closed on).
 *   - `hostedDeliveryLeaseRecovery`, contributing two families: the
 *     resolution-PLAN compute (read-only — confirmed by reading
 *     `hostedSignalResolutionPlanFunctionSource`: every table reference is a
 *     `FROM`/`JOIN`, never an `INSERT`/`UPDATE` — it returns a JSON plan and
 *     defers any shared-catalog mutation to a later apply step, exactly
 *     matching SQLite's own `signals.transportDuplicate()` +
 *     candidate-matching read path) and the inbox-LIFECYCLE transition
 *     write (lease/complete/fail, pre-evaluation dequeue plumbing).
 *   - `reservationLifecycleApply`, contributing the spend commit/release
 *     family (section 2).
 *   - `attributionReceiptApply`, contributing the attribution-receipt
 *     family (section 2).
 *   - `jobLifecycleApply`, contributing the post-creation job-lifecycle
 *     family (section 2).
 * Five own families + rung-1's ten delegated families = fifteen total
 * mutation/plan families across the complete evaluation-repository surface,
 * each mapped to exactly one of the five chain members (or, transitively,
 * one of rung-1's own eleven).
 *
 * ---------------------------------------------------------------------
 * 5. WHAT STAYS OUT OF SCOPE (see
 *    POSTGRES_SIGNAL_EVALUATION_REPOSITORY_KNOWN_OUT_OF_SCOPE_WRITES)
 * ---------------------------------------------------------------------
 *   - `NotificationRepository.ensureForJob` — a handler/task-kind dispatch
 *     concern (`hostedDeliveryHandlerRepositoryParity`/
 *     `allHandlerRepositoryParity`), not a repository write boundary.
 *     Carried forward from rung-1 unchanged.
 *   - `CatalogRepository.upsertListing` reference INSERTs — the manual "add
 *     to library" flow, never signal-triggered; a request-repository
 *     concern. Carried forward from rung-1 unchanged.
 *   - `DurableSignalIngressService`'s OWN enqueue path (packages/engine/src/
 *     signal-ingress.ts, backed by `HostedDeliveryRepository.acceptInbox` —
 *     `INSERT INTO inbox_messages(...)`, hosted-delivery-repository.ts:195
 *     — and `BackgroundTaskRepository`'s create/dedupe writes for a NEW
 *     inbound signal). This is a genuinely different write family than
 *     anything bound here: `hostedDeliveryLeaseRecovery`'s own
 *     `yoink_transition_trackalacker_signal_inbox` function only
 *     leases/completes/fails an ALREADY-enqueued `inbox_messages` row — it
 *     never INSERTs the row in the first place. No boundary module in this
 *     repository reproduces the initial enqueue. This is exactly the gap
 *     `signalIngressRepositoryParity` (still `false` below) names.
 *
 * ---------------------------------------------------------------------
 * 6. WHAT FORM THE COMPOSITION TAKES, AND WHY (contrast with rung-1)
 * ---------------------------------------------------------------------
 * Rung-1's chain is strictly LINEAR: each of its eleven boundaries declares
 * exactly one predecessor, so a single call to the chain's tip transitively
 * re-verifies everything beneath it. This module's chain is a FAN-IN over a
 * DAG with two roots (rung-1's own chain, reached via writer-track-B, and
 * `hostedDeliveryLeaseRecovery`'s witness-refresh lineage) and two SIBLING
 * leaves (`attributionReceiptApply`/`jobLifecycleApply`, both hanging off
 * `attributionPolicyApply`). No single live call transitively covers all
 * five members, so `verifyPostgresSignalEvaluationRepositoryCompositionBoundary`
 * below calls all five members' own verify functions, deliberately accepting
 * that the shared writer-track-B/rung-1 ancestry gets re-verified multiple
 * times over the network (idempotent reads against a live Postgres catalog;
 * no mutation, no risk) rather than trying to prune that redundancy —
 * explicitness over micro-optimizing round-trips, consistent with
 * `activePrincipalCount: 0`/`runtimeAuthority: false` throughout: nothing
 * here is on a hot path.
 *
 * Because none of the five members' own `build...Manifest()` functions
 * creates a new role, function, receipt table, or mutation path, and this
 * module adds no SQL of its own, `noNewRoleCreated`/`noNewFunctionCreated`/
 * `noNewMutationPath` all stay `true` — this composition proves CLOSURE, it
 * does not create a sixth qualified writer.
 *
 * ---------------------------------------------------------------------
 * 7. JUDGMENT CALLS FOR REVIEWER SCRUTINY
 * ---------------------------------------------------------------------
 *   - `mutationAuthority` per chain entry is read uniformly from each
 *     member's own CAPABILITY PROJECTION function, never its manifest
 *     directly: `attributionReceiptApply`'s and `jobLifecycleApply`'s own
 *     manifests do not carry a top-level `mutationAuthority` field at all
 *     (only their capability projections and result types do), while
 *     `hostedDeliveryLeaseRecovery`'s and `evaluationApplyComposition`'s
 *     manifests carry it directly (and, for `hostedDeliveryLeaseRecovery`,
 *     it is `false` at that level despite the module performing real
 *     mutations — a design choice of that module, not reinterpreted here).
 *     Reading every entry from the capability projection avoids that
 *     three-way asymmetry, mirroring rung-1's own stated reason for doing
 *     the same across its writerLockProtocol/constraintConfigApply pair.
 *   - `reservationLifecycleApply`'s fingerprint is bound directly (its own
 *     zero-arg `build...Manifest()` call) rather than cross-checked against
 *     a nested field reachable from `attributionPolicyApply`, because every
 *     hop in writer-track-B exposes its predecessor as a `Pick<...,
 *     "schemaName" | "fingerprint" | "...RoleNamespace">`, not the full
 *     nested manifest — so the full nine-hop lineage from
 *     `attributionPolicyApply` down to `reservationLifecycleApply` is not
 *     mechanically re-walkable from a single top-level object the way
 *     section 3's `actionSpendApply` convergence check is (that check works
 *     because `targetQualificationApply` is only ONE hop from
 *     `actionSpendApply`, and keeps the FULL manifest, not a `Pick`, in its
 *     own `predecessorManifest` field). This is a real, documented
 *     limitation of the write-once `Pick`-typed predecessor fields upstream,
 *     not an oversight here.
 *   - `POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES` uses a `kind:
 *     "plan" | "mutation"` discriminator absent from rung-1's own family
 *     type: rung-1's ten families are all mutations (`sqliteTables.length >
 *     0` is asserted by its own test suite), but this module's resolution-
 *     plan family is provably read-only (section 4) and would falsify that
 *     invariant if forced into the same shape. `sqliteTables` for a `"plan"`
 *     family is therefore `[]` by construction — it names zero tables
 *     because it WRITES zero tables, not because the family is unresearched.
 *   - The PGlite contract test asserts this module exports no
 *     `...FunctionSource` function at all (unlike rung-1, which parse-probed
 *     its own eleven boundaries' generated SQL): every one of this module's
 *     five members already has its own PGlite parse-probe test
 *     (postgres-signal-evaluation-composition.test.ts for rung-1's eleven,
 *     plus the four sibling `*-apply.test.ts` files for the remaining four)
 *     — this module generates no SQL of its own to probe.
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
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONTRACT_VERSION,
  buildPostgresSignalAttributionPolicyApplyManifest
} from "./postgres-signal-attribution-policy-apply.js";
import {
  POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONTRACT_VERSION,
  buildPostgresSignalAttributionReceiptApplyManifest,
  postgresSignalAttributionReceiptCapabilityProjection,
  verifyPostgresSignalAttributionReceiptApplyBoundary,
  type PostgresSignalAttributionReceiptApplyManifest
} from "./postgres-signal-attribution-receipt-apply.js";
import {
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION,
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT,
  buildPostgresSignalEvaluationCompositionManifest,
  postgresSignalEvaluationCompositionCapabilityProjection,
  verifyPostgresSignalEvaluationCompositionBoundary,
  type PostgresSignalEvaluationCompositionManifest
} from "./postgres-signal-evaluation-composition.js";
import {
  POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONTRACT_VERSION,
  buildPostgresSignalJobLifecycleApplyManifest,
  postgresSignalJobLifecycleCapabilityProjection,
  verifyPostgresSignalJobLifecycleApplyBoundary,
  type PostgresSignalJobLifecycleApplyManifest
} from "./postgres-signal-job-lifecycle-apply.js";
import {
  POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONTRACT_VERSION,
  buildPostgresSignalReservationLifecycleApplyManifest,
  postgresSignalReservationLifecycleCapabilityProjection,
  verifyPostgresSignalReservationLifecycleApplyBoundary,
  type PostgresSignalReservationLifecycleApplyManifest
} from "./postgres-signal-reservation-lifecycle-apply.js";
import {
  buildPostgresSignalTargetQualificationApplyManifest
} from "./postgres-signal-target-qualification-apply.js";

export const POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CONTRACT_VERSION = 1;

export type PostgresSignalEvaluationRepositoryCompositionBoundaryKey =
  | "hostedDeliveryLeaseRecovery"
  | "evaluationApplyComposition"
  | "reservationLifecycleApply"
  | "attributionReceiptApply"
  | "jobLifecycleApply";

/** Structural order — see header section 3/6 (DAG, not a linear chain). */
export const POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_ORDER = Object.freeze([
  "hostedDeliveryLeaseRecovery",
  "evaluationApplyComposition",
  "reservationLifecycleApply",
  "attributionReceiptApply",
  "jobLifecycleApply"
] as const satisfies readonly PostgresSignalEvaluationRepositoryCompositionBoundaryKey[]);

export const POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_LENGTH = 5;

/**
 * `evaluationApplyComposition` owns no family row of its own here: its ten
 * mutation families are already total (rung-1's own build() fails closed on
 * that), and are cited by import rather than re-listed — see header
 * section 4.
 */
export const POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_DELEGATED_BOUNDARIES = Object.freeze([
  "evaluationApplyComposition"
] as const satisfies readonly PostgresSignalEvaluationRepositoryCompositionBoundaryKey[]);

export interface PostgresSignalEvaluationRepositoryFamily {
  readonly family: string;
  readonly kind: "plan" | "mutation";
  readonly sqliteSource: string;
  readonly sqliteTables: readonly string[];
  readonly boundary: PostgresSignalEvaluationRepositoryCompositionBoundaryKey;
}

/** See header sections 2 and 4 for the derivation of every row below. */
export const POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES = Object.freeze([
  Object.freeze({
    family: "signal_resolution_plan_compute",
    kind: "plan",
    sqliteSource:
      "SignalRepository.transportDuplicate (duplicate short-circuit) + catalog/source-"
      + "reference candidate matching, reproduced natively as "
      + "yoink_plan_trackalacker_signal_resolution -- read-only: every table reference "
      + "in that function is a FROM/JOIN, never an INSERT/UPDATE",
    sqliteTables: Object.freeze([]),
    boundary: "hostedDeliveryLeaseRecovery"
  }),
  Object.freeze({
    family: "signal_inbox_lifecycle_transition",
    kind: "mutation",
    sqliteSource:
      "HostedDeliveryRepository.leaseInboxByEventType/completeInbox/retryInbox "
      + "(pre-evaluation dequeue lifecycle), reproduced natively as "
      + "yoink_transition_trackalacker_signal_inbox",
    sqliteTables: Object.freeze(["inbox_messages", "hosted_delivery_receipts"]),
    boundary: "hostedDeliveryLeaseRecovery"
  }),
  Object.freeze({
    family: "signal_job_lifecycle_spend_settlement",
    kind: "mutation",
    sqliteSource:
      "SpendLedgerRepository.commitForJob/releaseForJob, called from "
      + "SignalRepository.transitionJob's branches 6a/6c and from "
      + "SpendLedgerRepository.releaseExpired",
    sqliteTables: Object.freeze(["spend_reservations", "spend_ledger_entries", "audit_events", "outbox_events"]),
    boundary: "reservationLifecycleApply"
  }),
  Object.freeze({
    family: "signal_attribution_receipt_record",
    kind: "mutation",
    sqliteSource:
      "AttributionRepository.recordReceipt, called once from "
      + "SignalRepository.createActionJob's fresh-job branch only",
    sqliteTables: Object.freeze(["attribution_receipts", "audit_events", "outbox_events"]),
    boundary: "attributionReceiptApply"
  }),
  Object.freeze({
    family: "signal_job_lifecycle_transition",
    kind: "mutation",
    sqliteSource:
      "SignalRepository.transitionJob post-creation branches (action_jobs/action_events/"
      + "signal_incidents/missions.fulfilled_quantity), every branch's final audit+outbox",
    sqliteTables: Object.freeze([
      "action_jobs", "action_events", "signal_incidents", "missions", "audit_events", "outbox_events"
    ]),
    boundary: "jobLifecycleApply"
  })
] as const satisfies readonly PostgresSignalEvaluationRepositoryFamily[]);

export const POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILY_COUNT = 5;

/** See header section 5. */
export const POSTGRES_SIGNAL_EVALUATION_REPOSITORY_KNOWN_OUT_OF_SCOPE_WRITES = Object.freeze([
  "NotificationRepository.ensureForJob -> notification/outbox delivery handler surface "
    + "(hosted-delivery / notification-recovery handler composition -- task-kind dispatch "
    + "wiring, not a repository write boundary; tracked by hostedDeliveryHandlerRepositoryParity "
    + "/ allHandlerRepositoryParity, both still false)",
  "CatalogRepository.upsertListing reference INSERTs -> source_listing_refs/"
    + "source_product_aliases/source_product_refs (manual 'add to library' flow, not "
    + "signal-triggered -- a request-repository concern)",
  "DurableSignalIngressService's own enqueue path -> HostedDeliveryRepository.acceptInbox "
    + "'INSERT INTO inbox_messages' (hosted-delivery-repository.ts:195) and "
    + "BackgroundTaskRepository's create/dedupe writes for a NEW inbound signal -- the "
    + "pre-lease, at-ingress write family; hostedDeliveryLeaseRecovery's own inbox function "
    + "only leases/completes/fails an ALREADY-enqueued row, it never INSERTs one; tracked by "
    + "signalIngressRepositoryParity, still false"
] as const);

export interface PostgresSignalEvaluationRepositoryCompositionChainEntry {
  readonly boundary: PostgresSignalEvaluationRepositoryCompositionBoundaryKey;
  readonly contractVersion: number;
  readonly mutationAuthority: boolean;
  readonly fingerprint: string;
}

export interface PostgresSignalEvaluationRepositoryCompositionManifest {
  contractVersion: typeof POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CONTRACT_VERSION;
  evaluationApplyCompositionContractVersion: typeof POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION;
  hostedDeliveryLeaseRecoveryContractVersion: typeof POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION;
  reservationLifecycleApplyContractVersion: typeof POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONTRACT_VERSION;
  attributionReceiptApplyContractVersion: typeof POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONTRACT_VERSION;
  jobLifecycleApplyContractVersion: typeof POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONTRACT_VERSION;
  schemaName: string;
  evaluationApplyCompositionManifest: PostgresSignalEvaluationCompositionManifest;
  hostedDeliveryLeaseRecoveryManifest: PostgresHostedDeliveryLeaseRecoveryManifest;
  reservationLifecycleApplyManifest: PostgresSignalReservationLifecycleApplyManifest;
  attributionReceiptApplyManifest: PostgresSignalAttributionReceiptApplyManifest;
  jobLifecycleApplyManifest: PostgresSignalJobLifecycleApplyManifest;
  chain: PostgresSignalEvaluationRepositoryCompositionChainEntry[];
  chainBoundaryCount: typeof POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_LENGTH;
  writerTrackConvergenceVerified: true;
  ownFamilies: readonly PostgresSignalEvaluationRepositoryFamily[];
  ownFamilyCount: typeof POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILY_COUNT;
  delegatedFamilyCount: typeof POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT;
  totalFamilyCount: number;
  unmappedOwnFamilyCount: 0;
  unmappedChainBoundaryCount: 0;
  delegatedBoundaries: readonly PostgresSignalEvaluationRepositoryCompositionBoundaryKey[];
  knownOutOfScopeWrites: readonly string[];
  noNewRoleCreated: true;
  noNewFunctionCreated: true;
  noNewMutationPath: true;
  signalEvaluationApplyRepositoryParity: true;
  signalEvaluationRepositoryParity: true;
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  mutationAuthority: true;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalEvaluationRepositoryCompositionCapabilityProjection {
  contractVersion: typeof POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CONTRACT_VERSION;
  deterministicManifestImplemented: true;
  writerTrackConvergenceVerified: true;
  chainBoundaryCount: typeof POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_LENGTH;
  ownFamilyCount: typeof POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILY_COUNT;
  delegatedFamilyCount: typeof POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT;
  totalFamilyCount: number;
  unmappedOwnFamilyCount: 0;
  noNewRoleCreated: true;
  noNewFunctionCreated: true;
  noNewMutationPath: true;
  signalEvaluationApplyRepositoryParity: true;
  signalEvaluationRepositoryParity: true;
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export class PostgresSignalEvaluationRepositoryCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalEvaluationRepositoryCompositionError";
  }
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

let cachedCapabilityProjection:
Readonly<PostgresSignalEvaluationRepositoryCompositionCapabilityProjection> | null = null;

export function buildPostgresSignalEvaluationRepositoryCompositionManifest():
PostgresSignalEvaluationRepositoryCompositionManifest {
  const evaluationApplyComposition = buildPostgresSignalEvaluationCompositionManifest();
  const hostedDeliveryLeaseRecovery = buildPostgresHostedDeliveryLeaseRecoveryManifest();
  const reservationLifecycleApply = buildPostgresSignalReservationLifecycleApplyManifest();
  const attributionReceiptApply = buildPostgresSignalAttributionReceiptApplyManifest();
  const jobLifecycleApply = buildPostgresSignalJobLifecycleApplyManifest();

  // Writer-track convergence proof (header section 3): writer-track-B's
  // root (targetQualificationApply's own default predecessor) must be the
  // exact same actionSpendApply node rung-1's own chain terminates in --
  // proving this is one connected DAG, not two independently-forked
  // qualification trees. Purely in-process; no live database involved.
  const targetQualificationApply = buildPostgresSignalTargetQualificationApplyManifest();
  if (targetQualificationApply.actionSpendApplyManifestFingerprint
    !== evaluationApplyComposition.actionSpendApplyManifest.fingerprint) {
    throw new PostgresSignalEvaluationRepositoryCompositionError(
      "The PostgreSQL signal evaluation-repository composition's writer-track convergence onto the action-spend-apply boundary is broken."
    );
  }

  // The two residual writers' own declared predecessor fingerprint must
  // equal what attributionPolicyApply itself computes today (header
  // section 7 explains why this is a one-hop check, not a full re-walk).
  const attributionPolicyApply = buildPostgresSignalAttributionPolicyApplyManifest();
  if (attributionReceiptApply.attributionPolicyApplyManifestFingerprint !== attributionPolicyApply.fingerprint
    || jobLifecycleApply.attributionPolicyApplyManifestFingerprint !== attributionPolicyApply.fingerprint) {
    throw new PostgresSignalEvaluationRepositoryCompositionError(
      "The PostgreSQL signal evaluation-repository composition's residual-writer sequence contract is broken."
    );
  }

  // mutationAuthority is read from each boundary's own capability
  // projection rather than its raw manifest -- see header section 7 for the
  // three-way asymmetry this avoids.
  const chain: PostgresSignalEvaluationRepositoryCompositionChainEntry[] = [
    {
      boundary: "hostedDeliveryLeaseRecovery",
      contractVersion: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
      mutationAuthority: postgresHostedDeliveryLeaseRecoveryCapabilityProjection().mutationAuthority,
      fingerprint: hostedDeliveryLeaseRecovery.fingerprint
    },
    {
      boundary: "evaluationApplyComposition",
      contractVersion: POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION,
      mutationAuthority: postgresSignalEvaluationCompositionCapabilityProjection().mutationAuthority,
      fingerprint: evaluationApplyComposition.fingerprint
    },
    {
      boundary: "reservationLifecycleApply",
      contractVersion: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONTRACT_VERSION,
      mutationAuthority: postgresSignalReservationLifecycleCapabilityProjection().mutationAuthority,
      fingerprint: reservationLifecycleApply.fingerprint
    },
    {
      boundary: "attributionReceiptApply",
      contractVersion: POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONTRACT_VERSION,
      mutationAuthority: postgresSignalAttributionReceiptCapabilityProjection().mutationAuthority,
      fingerprint: attributionReceiptApply.fingerprint
    },
    {
      boundary: "jobLifecycleApply",
      contractVersion: POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONTRACT_VERSION,
      mutationAuthority: postgresSignalJobLifecycleCapabilityProjection().mutationAuthority,
      fingerprint: jobLifecycleApply.fingerprint
    }
  ];

  if (chain.length !== POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_LENGTH
    || new Set(chain.map((entry) => entry.boundary)).size !== chain.length
    || new Set(chain.map((entry) => entry.fingerprint)).size !== chain.length) {
    throw new PostgresSignalEvaluationRepositoryCompositionError(
      "The PostgreSQL signal evaluation-repository composition chain is not exactly-once complete."
    );
  }
  const chainKeys = new Set(chain.map((entry) => entry.boundary));
  const orderMismatch = POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_ORDER.some(
    (key, index) => chain[index]?.boundary !== key
  );
  if (orderMismatch || !POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_ORDER.every((key) => chainKeys.has(key))) {
    throw new PostgresSignalEvaluationRepositoryCompositionError(
      "The PostgreSQL signal evaluation-repository composition chain order drifted from its declared sequence."
    );
  }

  const coveredBoundaries = new Set<PostgresSignalEvaluationRepositoryCompositionBoundaryKey>([
    ...POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES.map((entry) => entry.boundary),
    ...POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_DELEGATED_BOUNDARIES
  ]);
  const unmappedChainBoundaries = POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_ORDER.filter(
    (key) => !coveredBoundaries.has(key)
  );
  const unmappedOwnFamilies = POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES.filter(
    (entry) => !chainKeys.has(entry.boundary)
  );
  if (unmappedChainBoundaries.length !== 0 || unmappedOwnFamilies.length !== 0
    || POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES.length
      !== POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILY_COUNT) {
    throw new PostgresSignalEvaluationRepositoryCompositionError(
      "The PostgreSQL signal evaluation-repository composition coverage accounting is incomplete."
    );
  }

  const withoutFingerprint: Omit<PostgresSignalEvaluationRepositoryCompositionManifest, "fingerprint"> = {
    contractVersion: POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CONTRACT_VERSION,
    evaluationApplyCompositionContractVersion: POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION,
    hostedDeliveryLeaseRecoveryContractVersion: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
    reservationLifecycleApplyContractVersion: POSTGRES_SIGNAL_RESERVATION_LIFECYCLE_APPLY_CONTRACT_VERSION,
    attributionReceiptApplyContractVersion: POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONTRACT_VERSION,
    jobLifecycleApplyContractVersion: POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONTRACT_VERSION,
    schemaName: jobLifecycleApply.schemaName,
    evaluationApplyCompositionManifest: evaluationApplyComposition,
    hostedDeliveryLeaseRecoveryManifest: hostedDeliveryLeaseRecovery,
    reservationLifecycleApplyManifest: reservationLifecycleApply,
    attributionReceiptApplyManifest: attributionReceiptApply,
    jobLifecycleApplyManifest: jobLifecycleApply,
    chain,
    chainBoundaryCount: POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_LENGTH,
    writerTrackConvergenceVerified: true,
    ownFamilies: POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES,
    ownFamilyCount: POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILY_COUNT,
    delegatedFamilyCount: POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT,
    totalFamilyCount:
      POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILY_COUNT + POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT,
    unmappedOwnFamilyCount: 0,
    unmappedChainBoundaryCount: 0,
    delegatedBoundaries: POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_DELEGATED_BOUNDARIES,
    knownOutOfScopeWrites: POSTGRES_SIGNAL_EVALUATION_REPOSITORY_KNOWN_OUT_OF_SCOPE_WRITES,
    noNewRoleCreated: true,
    noNewFunctionCreated: true,
    noNewMutationPath: true,
    signalEvaluationApplyRepositoryParity: true,
    signalEvaluationRepositoryParity: true,
    signalIngressRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    allHandlerRepositoryParity: false,
    mutationAuthority: true,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresSignalEvaluationRepositoryCompositionCapabilityProjection():
PostgresSignalEvaluationRepositoryCompositionCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalEvaluationRepositoryCompositionManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CONTRACT_VERSION,
    deterministicManifestImplemented: true,
    writerTrackConvergenceVerified: true,
    chainBoundaryCount: POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_LENGTH,
    ownFamilyCount: POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILY_COUNT,
    delegatedFamilyCount: POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT,
    totalFamilyCount: manifest.totalFamilyCount,
    unmappedOwnFamilyCount: 0,
    noNewRoleCreated: true,
    noNewFunctionCreated: true,
    noNewMutationPath: true,
    signalEvaluationApplyRepositoryParity: true,
    signalEvaluationRepositoryParity: true,
    signalIngressRepositoryParity: false,
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
 * Re-derives the composition manifest (catching any drift in the writer-
 * track convergence proof or the coverage accounting) and then walks all
 * five members' own live-database verify functions. Unlike rung-1's single-
 * tip cascade, no one call here transitively covers the other four -- see
 * header section 6 for why this module deliberately accepts the resulting
 * (harmless, read-only) re-verification of shared ancestry.
 */
export async function verifyPostgresSignalEvaluationRepositoryCompositionBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalEvaluationRepositoryCompositionManifest()
): Promise<PostgresSignalEvaluationRepositoryCompositionManifest> {
  const rebuilt = buildPostgresSignalEvaluationRepositoryCompositionManifest();
  if (rebuilt.fingerprint !== manifest.fingerprint) {
    throw new PostgresSignalEvaluationRepositoryCompositionError(
      "The PostgreSQL signal evaluation-repository composition manifest has drifted from its live sub-boundaries."
    );
  }
  await verifyPostgresSignalEvaluationCompositionBoundary(database, manifest.evaluationApplyCompositionManifest);
  await verifyPostgresHostedDeliveryLeaseRecoveryBoundary(database);
  await verifyPostgresSignalReservationLifecycleApplyBoundary(database, manifest.reservationLifecycleApplyManifest);
  await verifyPostgresSignalAttributionReceiptApplyBoundary(database, manifest.attributionReceiptApplyManifest);
  await verifyPostgresSignalJobLifecycleApplyBoundary(database, manifest.jobLifecycleApplyManifest);
  return manifest;
}
