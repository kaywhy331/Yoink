/**
 * PostgreSQL signal-evaluation APPLY composition — the v0.98 boundary that
 * closes `signalEvaluationApplyRepositoryParity` (declared `false` in
 * postgres-hosted-delivery-lease-recovery.ts). This module creates NO new
 * PostgreSQL role, function, or receipt table, and grants NO new mutation
 * authority. It only proves — deterministically, and re-derivable on every
 * run — that the nine already-qualified "apply" boundaries plus the two
 * writer-discipline boundaries named below compose into one complete,
 * gap-free write path for the SQLite `SignalEngine.process()` evaluation
 * flow. Every fact below was read out of the actual source, not assumed.
 *
 * ---------------------------------------------------------------------
 * 1. WHAT EARNED THE PRIOR "TRUE" FLAGS (precedent: lease-recovery)
 * ---------------------------------------------------------------------
 * postgres-hosted-delivery-lease-recovery.ts sets
 * `signalInboxLifecycleRepositoryParity: true` and
 * `signalResolutionPlanRepositoryParity: true` because that module itself
 * *implements* two full PL/pgSQL functions
 * (`yoink_transition_trackalacker_signal_inbox`,
 * `yoink_plan_trackalacker_signal_resolution`) that reproduce, natively in
 * Postgres, the hosted inbox lease/complete/fail lifecycle and the
 * resolution-plan computation. Those two flags are "individual writer
 * boundary" claims: a single module's own generated SQL was proven to
 * reproduce a specific SQLite write/compute path bit-for-bit, verified via
 * `verifyPostgresQualifiedFunctionBoundary`-style effective-privilege
 * inspection against a real Postgres role.
 *
 * `signalEvaluationApplyRepositoryParity` stayed `false` in that same
 * manifest because the lease-recovery module *only* computes a resolution
 * PLAN (JSON) — it never applies the incident/mission/strategy/spend
 * mutations that plan implies. That downstream apply chain was built
 * later, as nine SEPARATE, independently-qualified boundary modules
 * (catalog-apply through action-spend-apply, each with its own role,
 * SECURITY DEFINER function, and receipt table), plus two writer-discipline
 * modules (constraint-config-apply, writer-lock-protocol) that gate and
 * serialize them. No module ever asserted, in one place, that this set is
 * *complete* — that every SQLite evaluation mutation has exactly one
 * qualified PostgreSQL owner, and that the chain's own predecessor
 * fingerprints are mutually consistent. That is what this module proves.
 * A "repository parity composition" therefore proves CLOSURE over a set of
 * already-qualified individual writers; it does not itself re-implement
 * any mutation.
 *
 * ---------------------------------------------------------------------
 * 2. THE SQLITE EVALUATION SEQUENCE (packages/engine/src/signal-engine.ts
 *    `SignalEngine.process()`, backed by
 *    packages/database/src/signal-repository.ts `SignalRepository`)
 * ---------------------------------------------------------------------
 *   0. `signals.transportDuplicate()` — read-only short-circuit. Zero
 *      mutation; the "duplicate" outcome is a *plan* computed by
 *      postgres-hosted-delivery-lease-recovery.ts, not an apply.
 *   1. `signals.insertEvent()` — INSERT signal_events, UPDATE
 *      source_connections (status/last_event_at).
 *   2. `catalog.resolve()` (read) then, when unresolved and not a test
 *      signal, `catalog.createListingFromExactSignal()` — INSERT into the
 *      shared catalog (listings/variants/listing_urls/product_families)
 *      and the tenant reference tables (source_listing_refs/
 *      source_product_aliases/source_product_refs).
 *   3. `signals.recordResolution()` — UPDATE signal_events.resolution_status,
 *      INSERT resolution_decisions.
 *   3b. Tenant source-reference freshness bookkeeping for the resolved
 *      event (source_listing_refs/source_product_aliases/
 *      source_product_refs), distinct from step 2's *creation* of brand
 *      new references.
 *   4. Branch — resolution.listing is null, or signal.test, or the event/
 *      availability is not actionable: `signals.recordOccurrence(eventId,
 *      signal, null)` + `signals.recordMissionDecision(eventId, null, null,
 *      null, outcome, reason)` + `signals.audit()`, for outcomes
 *      `ambiguous_identity` / `unresolved_identity` / `test_signal` /
 *      `non_actionable_event`. Terminal — no incident, no mission.
 *   5. Mainline — `signals.recordOfferObservation()`,
 *      `signals.findOpenIncident()` (read), then
 *      `signals.corroborateIncident()` (UPDATE signal_incidents) or
 *      `signals.createIncident()` (INSERT signal_incidents), then
 *      `signals.recordOccurrence(eventId, signal, incident.id)`.
 *   6. Branch — an existing job already owns this incident:
 *      `signals.recordMissionDecision(..., "corroborated", ...)` + audit.
 *      Terminal.
 *   7. `control.findMissionForListing()` (read), else
 *      `control.ensureMission()` (INSERT/UPDATE missions, mission_targets,
 *      mission_intent_revisions) when the source is trusted_exact and
 *      auto-create is enabled.
 *   8. Branch — still no mission:
 *      `signals.recordMissionDecision(..., "no_mission", ...)` + audit.
 *      Terminal. (Steps 6 and 8 share one outcome union —
 *      `PostIncidentDecisionOutcome = "corroborated" | "no_mission"` — which
 *      is exactly the type postgres-signal-post-incident-decision-apply.ts
 *      declares.)
 *   9. `evaluateSignalPolicySnapshot()` (pure compute) — strategy/purchase-
 *      intent evaluation. Branch — state is one of
 *      `unmatched|stale|quantity_limited`, or a sibling mission claim
 *      exists, or actions are paused:
 *      `signals.recordMissionDecision(..., evaluation, outcome, ...)` +
 *      audit. Terminal (evaluation ran, no job created).
 *  10. `signals.createActionJob()` — INSERT action_jobs, INSERT
 *      action_events; `OfferIdentityRepository.capture()` — INSERT
 *      exact_offer_keys/offer_snapshots; when the job awaits execution and
 *      has a bounded spend, `SpendLedgerRepository.reserve()` — INSERT
 *      spend_reservations/spend_ledger_entries; then the final
 *      `signals.recordMissionDecision(..., outcome, ...)` for the
 *      qualified/blocked-to-notify outcome.
 *
 * Deliberately OUT of this composition's scope (and therefore why
 * `signalEvaluationRepositoryParity`, `signalIngressRepositoryParity`,
 * `hostedDeliveryHandlerRepositoryParity`, and `allHandlerRepositoryParity`
 * all remain false below):
 *   - `AttributionRepository.recordReceipt()` writes `attribution_receipts`.
 *     No composed boundary's MUTATION_TABLES includes that table —
 *     postgres-signal-attribution-policy-apply.ts governs attribution
 *     POLICY configuration only, not per-job receipt recording.
 *   - `NotificationRepository.ensureForJob()` feeds the hosted-delivery /
 *     notification-recovery handler surface, a different handler-level
 *     composition entirely.
 *   - `SignalRepository.transitionJob()`'s POST-CREATION branches
 *     (`spendLedger.commitForJob`/`releaseForJob` on confirmed/rejected/
 *     expired/cancelled, and the `missions.fulfilled_quantity` UPDATE on a
 *     confirmed submit_order) mutate a job's LIFECYCLE after it already
 *     exists. This composition's scope ends at initial job creation
 *     (step 10 above), matching every composed boundary's own "apply"
 *     naming — none of them own a post-creation transition table.
 *   - `CatalogRepository.upsertListing()`'s reference-table INSERTs are the
 *     manual "add to library" flow, not signal-triggered.
 *
 * ---------------------------------------------------------------------
 * 3. THE MAPPING (see POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES below)
 * ---------------------------------------------------------------------
 * Ten SQLite evaluation mutation families, each mapped to exactly one
 * already-qualified boundary, chosen at (SQLite call-site, decision-outcome)
 * granularity rather than raw table name — several tables (mission_decisions,
 * audit_events, outbox_events, signal_occurrences) are legitimately mutated
 * by more than one boundary for textually disjoint decision-outcome
 * branches (confirmed via each boundary's own outcome-union type: e.g.
 * `PostIncidentDecisionOutcome = "corroborated" | "no_mission"` on
 * postgres-signal-post-incident-decision-apply.ts matches SQLite steps 6
 * and 8 exactly). A raw table-name bijection would therefore be false to
 * the code; a (call-site, outcome) bijection is not.
 *
 * Two further boundaries carry no mutation family of their own but are
 * still required chain members: postgres-signal-writer-lock-protocol.ts
 * (zero mutation tables — a fixed-order advisory-lock primitive consumed by
 * mission-binding/strategy-evaluation/constraint-config/action-spend to
 * guarantee no lock-ordering deadlock across the composed writers) and
 * postgres-signal-constraint-config-apply.ts (its writes — actions-paused,
 * guardrail, spend-policy settings — are operator-driven configuration
 * changes, not signal-triggered mutations; it is consumed as a READ gate by
 * the evaluation flow, e.g. `settings.actionsPaused` in step 9 above).
 *
 * ---------------------------------------------------------------------
 * 4. WHAT FORM THE COMPOSITION TAKES, AND WHY
 * ---------------------------------------------------------------------
 * Every composed boundary from postgres-signal-mission-binding-apply.ts
 * onward already exposes a `predecessorManifest` object plus a direct
 * `<PredecessorName>ManifestFingerprint` string field; the six earlier
 * boundaries (catalog-apply through post-incident-decision-apply) instead
 * take a flat chain of `requested<Name>RoleNamespace` parameters but STILL
 * expose that same direct `<PredecessorName>ManifestFingerprint` field.
 * Every one of those eleven fields is read directly below and compared
 * against an independently-rebuilt predecessor manifest's OWN `.fingerprint`
 * — this is the "cross-boundary sequence contract" the writer-lock-protocol
 * and constraint-config-apply modules already rely on implicitly (their own
 * `verifyPostgresSignalXBoundary` functions cascade to
 * `verifyPostgresSignalYBoundary(database, manifest.predecessorManifest)`
 * one level at a time); this module makes that contract explicit and
 * total across all eleven hops in one place, and fails closed
 * (`PostgresSignalEvaluationCompositionError`) if any hop's declared
 * predecessor fingerprint drifts from what that predecessor actually
 * computes today.
 *
 * Because `verifyPostgresSignalActionSpendApplyBoundary` already cascades
 * to `verifyPostgresSignalConstraintConfigApplyBoundary`, which cascades to
 * `verifyPostgresSignalWriterLockProtocolBoundary`, ... down through
 * `verifyPostgresSignalCatalogApplyBoundary` and
 * `verifyPostgresHostedDeliveryLeaseRecoveryBoundary`, a single call to the
 * chain's tip (`verifyPostgresSignalActionSpendApplyBoundary`) already
 * re-verifies every composed boundary's live Postgres role/function/RLS
 * state. `verifyPostgresSignalEvaluationCompositionBoundary` below performs
 * that one call, plus the in-process fingerprint-chain and coverage
 * re-derivation, and therefore needs no receipt table, no SECURITY DEFINER
 * function, and no role of its own — consistent with the mission's
 * instruction that this composition proves completeness rather than
 * creating a twelfth qualified writer.
 *
 * ---------------------------------------------------------------------
 * 5. JUDGMENT CALLS FOR REVIEWER SCRUTINY
 * ---------------------------------------------------------------------
 *   - Mutation-family granularity is (SQLite call-site, decision-outcome),
 *     not raw table name; see section 3.
 *   - `mutationAuthority: true` on the composed manifest reflects — it does
 *     not grant — the union of the ten mutation-capable composed
 *     boundaries' own `mutationAuthority: true` (every one of catalog-apply
 *     through action-spend-apply declares it; only writer-lock-protocol,
 *     lock-only, declares `false`). `runtimeAuthority` stays `false`
 *     throughout, matching every composed boundary: none of this is wired
 *     to a live principal.
 *   - The PGlite contract test parse-probes all eleven boundaries' own
 *     `signal...FunctionSource(manifest)` output together in one database
 *     (distinct probe function names) to prove joint parseability with no
 *     name collision — this module generates no SQL of its own to probe.
 */
import { createHash } from "node:crypto";
import type { PostgresCutoverDatabase } from "./postgres-cutover.js";
import {
  POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION,
  buildPostgresSignalActionSpendApplyManifest,
  postgresSignalActionSpendCapabilityProjection,
  verifyPostgresSignalActionSpendApplyBoundary,
  type PostgresSignalActionSpendApplyManifest
} from "./postgres-signal-action-spend-apply.js";
import {
  POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION,
  buildPostgresSignalCatalogApplyManifest,
  postgresSignalCatalogApplyCapabilityProjection
} from "./postgres-signal-catalog-apply.js";
import {
  POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_CONTRACT_VERSION,
  buildPostgresSignalConstraintConfigApplyManifest,
  postgresSignalConstraintConfigCapabilityProjection
} from "./postgres-signal-constraint-config-apply.js";
import {
  POSTGRES_SIGNAL_MISSION_BINDING_APPLY_CONTRACT_VERSION,
  buildPostgresSignalMissionBindingApplyManifest,
  postgresSignalMissionBindingApplyCapabilityProjection
} from "./postgres-signal-mission-binding-apply.js";
import {
  POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_CONTRACT_VERSION,
  buildPostgresSignalOfferIncidentApplyManifest,
  postgresSignalOfferIncidentApplyCapabilityProjection
} from "./postgres-signal-offer-incident-apply.js";
import {
  POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_CONTRACT_VERSION,
  buildPostgresSignalPostIncidentDecisionApplyManifest,
  postgresSignalPostIncidentDecisionApplyCapabilityProjection
} from "./postgres-signal-post-incident-decision-apply.js";
import {
  POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION,
  buildPostgresSignalResolutionApplyManifest,
  postgresSignalResolutionApplyCapabilityProjection
} from "./postgres-signal-resolution-apply.js";
import {
  POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION,
  buildPostgresSignalSourceReferenceRefreshManifest,
  postgresSignalSourceReferenceRefreshCapabilityProjection
} from "./postgres-signal-source-reference-refresh.js";
import {
  POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_CONTRACT_VERSION,
  buildPostgresSignalStrategyEvaluationApplyManifest,
  postgresSignalStrategyEvaluationApplyCapabilityProjection
} from "./postgres-signal-strategy-evaluation-apply.js";
import {
  POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_CONTRACT_VERSION,
  buildPostgresSignalTerminalDecisionApplyManifest,
  postgresSignalTerminalDecisionApplyCapabilityProjection
} from "./postgres-signal-terminal-decision-apply.js";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
  buildPostgresSignalWriterLockProtocolManifest,
  postgresSignalWriterLockProtocolCapabilityProjection
} from "./postgres-signal-writer-lock-protocol.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION = 1;

export type PostgresSignalEvaluationCompositionBoundaryKey =
  | "catalogApply"
  | "resolutionApply"
  | "sourceReferenceRefresh"
  | "terminalDecisionApply"
  | "offerIncidentApply"
  | "postIncidentDecisionApply"
  | "missionBindingApply"
  | "strategyEvaluationApply"
  | "writerLockProtocol"
  | "constraintConfigApply"
  | "actionSpendApply";

/** Structural (predecessor-verified) order — see header section 4. */
export const POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_ORDER = Object.freeze([
  "catalogApply",
  "resolutionApply",
  "sourceReferenceRefresh",
  "terminalDecisionApply",
  "offerIncidentApply",
  "postIncidentDecisionApply",
  "missionBindingApply",
  "strategyEvaluationApply",
  "writerLockProtocol",
  "constraintConfigApply",
  "actionSpendApply"
] as const satisfies readonly PostgresSignalEvaluationCompositionBoundaryKey[]);

export const POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_LENGTH = 11;

export const POSTGRES_SIGNAL_EVALUATION_COMPOSITION_WRITER_DISCIPLINE_BOUNDARIES = Object.freeze([
  "writerLockProtocol",
  "constraintConfigApply"
] as const satisfies readonly PostgresSignalEvaluationCompositionBoundaryKey[]);

export interface PostgresSignalEvaluationMutationFamily {
  readonly family: string;
  readonly sqliteSource: string;
  readonly sqliteTables: readonly string[];
  readonly boundary: PostgresSignalEvaluationCompositionBoundaryKey;
}

/** See header section 2 and 3 for the derivation of every row below. */
export const POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES = Object.freeze([
  Object.freeze({
    family: "signal_ingress_event_record",
    sqliteSource: "SignalRepository.insertEvent",
    sqliteTables: Object.freeze(["signal_events", "source_connections"]),
    boundary: "resolutionApply"
  }),
  Object.freeze({
    family: "signal_resolution_decision_record",
    sqliteSource: "SignalRepository.recordResolution",
    sqliteTables: Object.freeze(["signal_events", "resolution_decisions"]),
    boundary: "resolutionApply"
  }),
  Object.freeze({
    family: "signal_catalog_auto_creation",
    sqliteSource: "CatalogRepository.createListingFromExactSignal",
    sqliteTables: Object.freeze([
      "listings", "variants", "listing_urls", "product_families",
      "source_listing_refs", "source_product_aliases", "source_product_refs"
    ]),
    boundary: "catalogApply"
  }),
  Object.freeze({
    family: "signal_source_reference_freshness",
    sqliteSource: "CatalogRepository resolved-reference bookkeeping (post-resolution)",
    sqliteTables: Object.freeze([
      "source_listing_refs", "source_product_aliases", "source_product_refs"
    ]),
    boundary: "sourceReferenceRefresh"
  }),
  Object.freeze({
    family: "signal_identity_terminal_decision",
    sqliteSource:
      "SignalRepository.recordOccurrence(null)+recordMissionDecision(null)+audit "
      + "[ambiguous_identity|unresolved_identity|test_signal|non_actionable_event]",
    sqliteTables: Object.freeze([
      "signal_occurrences", "mission_decisions", "audit_events", "outbox_events"
    ]),
    boundary: "terminalDecisionApply"
  }),
  Object.freeze({
    family: "signal_offer_incident_tracking",
    sqliteSource:
      "SignalRepository.recordOfferObservation+createIncident/corroborateIncident+recordOccurrence(incident)",
    sqliteTables: Object.freeze(["offer_observations", "signal_incidents", "signal_occurrences"]),
    boundary: "offerIncidentApply"
  }),
  Object.freeze({
    family: "signal_post_incident_decision",
    sqliteSource: "SignalRepository.recordMissionDecision+audit [corroborated|no_mission]",
    sqliteTables: Object.freeze(["mission_decisions", "audit_events", "outbox_events"]),
    boundary: "postIncidentDecisionApply"
  }),
  Object.freeze({
    family: "signal_mission_auto_binding",
    sqliteSource: "ControlRepository.ensureMission+setMissionTargetQuantity",
    sqliteTables: Object.freeze([
      "missions", "mission_targets", "mission_intent_revisions", "audit_events", "outbox_events"
    ]),
    boundary: "missionBindingApply"
  }),
  Object.freeze({
    family: "signal_strategy_evaluation_decision",
    sqliteSource:
      "SignalRepository.recordMissionDecision+audit "
      + "[unmatched|stale|quantity_limited|sibling_store_claimed|actions_paused]",
    sqliteTables: Object.freeze(["mission_decisions", "audit_events", "outbox_events"]),
    boundary: "strategyEvaluationApply"
  }),
  Object.freeze({
    family: "signal_action_job_and_spend_apply",
    sqliteSource:
      "SignalRepository.createActionJob+OfferIdentityRepository.capture"
      + "+SpendLedgerRepository.reserve+final recordMissionDecision",
    sqliteTables: Object.freeze([
      "action_jobs", "action_events", "exact_offer_keys", "offer_snapshots",
      "spend_reservations", "spend_ledger_entries", "mission_decisions",
      "audit_events", "outbox_events"
    ]),
    boundary: "actionSpendApply"
  })
] as const satisfies readonly PostgresSignalEvaluationMutationFamily[]);

export const POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT = 10;

/** See header section 2 ("Deliberately OUT of this composition's scope"). */
export const POSTGRES_SIGNAL_EVALUATION_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES = Object.freeze([
  "AttributionRepository.recordReceipt -> attribution_receipts "
    + "(governed by postgres-signal-attribution-policy-apply.ts's POLICY table only)",
  "NotificationRepository.ensureForJob -> notification/outbox delivery handler surface "
    + "(hosted-delivery / notification-recovery handler composition, not this one)",
  "SignalRepository.transitionJob post-creation branches -> spend_ledger_entries "
    + "(commit/release) and missions.fulfilled_quantity (job lifecycle after creation, "
    + "outside evaluation apply)",
  "CatalogRepository.upsertListing reference INSERTs -> source_listing_refs/"
    + "source_product_aliases/source_product_refs (manual library management, not signal-triggered)"
] as const);

export interface PostgresSignalEvaluationCompositionChainEntry {
  readonly boundary: PostgresSignalEvaluationCompositionBoundaryKey;
  readonly contractVersion: number;
  readonly mutationAuthority: boolean;
  readonly fingerprint: string;
}

export interface PostgresSignalEvaluationCompositionManifest {
  contractVersion: typeof POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION;
  actionSpendApplyContractVersion: typeof POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION;
  schemaName: string;
  actionSpendApplyManifest: PostgresSignalActionSpendApplyManifest;
  chain: PostgresSignalEvaluationCompositionChainEntry[];
  chainBoundaryCount: typeof POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_LENGTH;
  mutationFamilies: readonly PostgresSignalEvaluationMutationFamily[];
  mutationFamilyCount: typeof POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT;
  unmappedMutationFamilyCount: 0;
  unmappedChainBoundaryCount: 0;
  writerDisciplineBoundaries: readonly PostgresSignalEvaluationCompositionBoundaryKey[];
  knownOutOfScopeWrites: readonly string[];
  noNewRoleCreated: true;
  noNewFunctionCreated: true;
  noNewMutationPath: true;
  signalEvaluationApplyRepositoryParity: true;
  signalEvaluationRepositoryParity: false;
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  mutationAuthority: true;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalEvaluationCompositionCapabilityProjection {
  contractVersion: typeof POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION;
  actionSpendApplyContractVersion: typeof POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION;
  deterministicManifestImplemented: true;
  chainSequenceContractVerified: true;
  chainBoundaryCount: typeof POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_LENGTH;
  mutationFamilyCount: typeof POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT;
  unmappedMutationFamilyCount: 0;
  noNewRoleCreated: true;
  noNewFunctionCreated: true;
  noNewMutationPath: true;
  signalEvaluationApplyRepositoryParity: true;
  signalEvaluationRepositoryParity: false;
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

export class PostgresSignalEvaluationCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalEvaluationCompositionError";
  }
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

let cachedCapabilityProjection:
Readonly<PostgresSignalEvaluationCompositionCapabilityProjection> | null = null;

export function buildPostgresSignalEvaluationCompositionManifest():
PostgresSignalEvaluationCompositionManifest {
  const catalogApply = buildPostgresSignalCatalogApplyManifest();
  const resolutionApply = buildPostgresSignalResolutionApplyManifest();
  const sourceReferenceRefresh = buildPostgresSignalSourceReferenceRefreshManifest();
  const terminalDecisionApply = buildPostgresSignalTerminalDecisionApplyManifest();
  const offerIncidentApply = buildPostgresSignalOfferIncidentApplyManifest();
  const postIncidentDecisionApply = buildPostgresSignalPostIncidentDecisionApplyManifest();
  const missionBindingApply = buildPostgresSignalMissionBindingApplyManifest();
  const strategyEvaluationApply = buildPostgresSignalStrategyEvaluationApplyManifest();
  const writerLockProtocol = buildPostgresSignalWriterLockProtocolManifest();
  const constraintConfigApply = buildPostgresSignalConstraintConfigApplyManifest();
  const actionSpendApply = buildPostgresSignalActionSpendApplyManifest();

  // Cross-boundary sequence contract (header section 4): every declared
  // predecessor fingerprint must equal what the predecessor itself computes.
  const sequenceContract: ReadonlyArray<readonly [string, string, string]> = [
    ["resolutionApply -> catalogApply", resolutionApply.catalogApplyManifestFingerprint, catalogApply.fingerprint],
    ["sourceReferenceRefresh -> resolutionApply", sourceReferenceRefresh.resolutionApplyManifestFingerprint, resolutionApply.fingerprint],
    ["terminalDecisionApply -> sourceReferenceRefresh", terminalDecisionApply.sourceReferenceRefreshManifestFingerprint, sourceReferenceRefresh.fingerprint],
    ["offerIncidentApply -> terminalDecisionApply", offerIncidentApply.terminalDecisionApplyManifestFingerprint, terminalDecisionApply.fingerprint],
    ["postIncidentDecisionApply -> offerIncidentApply", postIncidentDecisionApply.offerIncidentApplyManifestFingerprint, offerIncidentApply.fingerprint],
    ["missionBindingApply -> postIncidentDecisionApply", missionBindingApply.postIncidentDecisionApplyManifestFingerprint, postIncidentDecisionApply.fingerprint],
    ["strategyEvaluationApply -> missionBindingApply", strategyEvaluationApply.missionBindingApplyManifestFingerprint, missionBindingApply.fingerprint],
    ["writerLockProtocol -> strategyEvaluationApply", writerLockProtocol.strategyEvaluationApplyManifestFingerprint, strategyEvaluationApply.fingerprint],
    ["constraintConfigApply -> writerLockProtocol", constraintConfigApply.writerLockProtocolManifestFingerprint, writerLockProtocol.fingerprint],
    ["actionSpendApply -> constraintConfigApply", actionSpendApply.constraintConfigApplyManifestFingerprint, constraintConfigApply.fingerprint]
  ];
  for (const [label, declared, actual] of sequenceContract) {
    if (declared !== actual) {
      throw new PostgresSignalEvaluationCompositionError(
        `The PostgreSQL signal evaluation composition sequence contract (${label}) is broken.`
      );
    }
  }

  // mutationAuthority is read from each boundary's own capability
  // projection rather than its raw manifest: two of the eleven manifests
  // (writerLockProtocol, constraintConfigApply) do not carry this field at
  // the manifest level — only their capability projections do — while the
  // other nine carry it on both. Reading uniformly from the capability
  // projection avoids that asymmetry.
  const chain: PostgresSignalEvaluationCompositionChainEntry[] = [
    { boundary: "catalogApply", contractVersion: POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION, mutationAuthority: postgresSignalCatalogApplyCapabilityProjection().mutationAuthority, fingerprint: catalogApply.fingerprint },
    { boundary: "resolutionApply", contractVersion: POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION, mutationAuthority: postgresSignalResolutionApplyCapabilityProjection().mutationAuthority, fingerprint: resolutionApply.fingerprint },
    { boundary: "sourceReferenceRefresh", contractVersion: POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION, mutationAuthority: postgresSignalSourceReferenceRefreshCapabilityProjection().mutationAuthority, fingerprint: sourceReferenceRefresh.fingerprint },
    { boundary: "terminalDecisionApply", contractVersion: POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_CONTRACT_VERSION, mutationAuthority: postgresSignalTerminalDecisionApplyCapabilityProjection().mutationAuthority, fingerprint: terminalDecisionApply.fingerprint },
    { boundary: "offerIncidentApply", contractVersion: POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_CONTRACT_VERSION, mutationAuthority: postgresSignalOfferIncidentApplyCapabilityProjection().mutationAuthority, fingerprint: offerIncidentApply.fingerprint },
    { boundary: "postIncidentDecisionApply", contractVersion: POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_CONTRACT_VERSION, mutationAuthority: postgresSignalPostIncidentDecisionApplyCapabilityProjection().mutationAuthority, fingerprint: postIncidentDecisionApply.fingerprint },
    { boundary: "missionBindingApply", contractVersion: POSTGRES_SIGNAL_MISSION_BINDING_APPLY_CONTRACT_VERSION, mutationAuthority: postgresSignalMissionBindingApplyCapabilityProjection().mutationAuthority, fingerprint: missionBindingApply.fingerprint },
    { boundary: "strategyEvaluationApply", contractVersion: POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_CONTRACT_VERSION, mutationAuthority: postgresSignalStrategyEvaluationApplyCapabilityProjection().mutationAuthority, fingerprint: strategyEvaluationApply.fingerprint },
    { boundary: "writerLockProtocol", contractVersion: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION, mutationAuthority: postgresSignalWriterLockProtocolCapabilityProjection().mutationAuthority, fingerprint: writerLockProtocol.fingerprint },
    { boundary: "constraintConfigApply", contractVersion: POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_CONTRACT_VERSION, mutationAuthority: postgresSignalConstraintConfigCapabilityProjection().mutationAuthority, fingerprint: constraintConfigApply.fingerprint },
    { boundary: "actionSpendApply", contractVersion: POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION, mutationAuthority: postgresSignalActionSpendCapabilityProjection().mutationAuthority, fingerprint: actionSpendApply.fingerprint }
  ];

  if (chain.length !== POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_LENGTH
    || new Set(chain.map((entry) => entry.boundary)).size !== chain.length
    || new Set(chain.map((entry) => entry.fingerprint)).size !== chain.length) {
    throw new PostgresSignalEvaluationCompositionError(
      "The PostgreSQL signal evaluation composition chain is not exactly-once complete."
    );
  }
  const chainKeys = new Set(chain.map((entry) => entry.boundary));
  const orderMismatch = POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_ORDER.some(
    (key, index) => chain[index]?.boundary !== key
  );
  if (orderMismatch || !POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_ORDER.every((key) => chainKeys.has(key))) {
    throw new PostgresSignalEvaluationCompositionError(
      "The PostgreSQL signal evaluation composition chain order drifted from its declared sequence."
    );
  }

  const coveredBoundaries = new Set<PostgresSignalEvaluationCompositionBoundaryKey>([
    ...POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES.map((entry) => entry.boundary),
    ...POSTGRES_SIGNAL_EVALUATION_COMPOSITION_WRITER_DISCIPLINE_BOUNDARIES
  ]);
  const unmappedChainBoundaries = POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_ORDER.filter(
    (key) => !coveredBoundaries.has(key)
  );
  const unmappedFamilies = POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES.filter(
    (entry) => !chainKeys.has(entry.boundary)
  );
  if (unmappedChainBoundaries.length !== 0 || unmappedFamilies.length !== 0
    || POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES.length
      !== POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT) {
    throw new PostgresSignalEvaluationCompositionError(
      "The PostgreSQL signal evaluation composition coverage accounting is incomplete."
    );
  }

  const withoutFingerprint: Omit<PostgresSignalEvaluationCompositionManifest, "fingerprint"> = {
    contractVersion: POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION,
    actionSpendApplyContractVersion: POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION,
    schemaName: actionSpendApply.schemaName,
    actionSpendApplyManifest: actionSpendApply,
    chain,
    chainBoundaryCount: POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_LENGTH,
    mutationFamilies: POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES,
    mutationFamilyCount: POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT,
    unmappedMutationFamilyCount: 0,
    unmappedChainBoundaryCount: 0,
    writerDisciplineBoundaries: POSTGRES_SIGNAL_EVALUATION_COMPOSITION_WRITER_DISCIPLINE_BOUNDARIES,
    knownOutOfScopeWrites: POSTGRES_SIGNAL_EVALUATION_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES,
    noNewRoleCreated: true,
    noNewFunctionCreated: true,
    noNewMutationPath: true,
    signalEvaluationApplyRepositoryParity: true,
    signalEvaluationRepositoryParity: false,
    signalIngressRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    allHandlerRepositoryParity: false,
    mutationAuthority: true,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresSignalEvaluationCompositionCapabilityProjection():
PostgresSignalEvaluationCompositionCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalEvaluationCompositionManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION,
    actionSpendApplyContractVersion: POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION,
    deterministicManifestImplemented: true,
    chainSequenceContractVerified: true,
    chainBoundaryCount: POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_LENGTH,
    mutationFamilyCount: POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT,
    unmappedMutationFamilyCount: 0,
    noNewRoleCreated: true,
    noNewFunctionCreated: true,
    noNewMutationPath: true,
    signalEvaluationApplyRepositoryParity: true,
    signalEvaluationRepositoryParity: false,
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
 * Re-derives the composition manifest (catching any drift in the eleven-hop
 * sequence contract or the coverage accounting) and then cascades a single
 * live-database call to the chain's tip boundary. Because every composed
 * boundary's own `verifyPostgresSignalXBoundary` already calls its
 * predecessor's verify function (see header section 4), this one call
 * transitively re-verifies all eleven composed boundaries — plus the
 * hosted-delivery/witness-refresh/base-role foundation beneath them —
 * against the live Postgres catalog. No new role, function, or receipt
 * table exists for this composition itself, so there is nothing further to
 * apply or verify locally.
 */
export async function verifyPostgresSignalEvaluationCompositionBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalEvaluationCompositionManifest()
): Promise<PostgresSignalEvaluationCompositionManifest> {
  const rebuilt = buildPostgresSignalEvaluationCompositionManifest();
  if (rebuilt.fingerprint !== manifest.fingerprint) {
    throw new PostgresSignalEvaluationCompositionError(
      "The PostgreSQL signal evaluation composition manifest has drifted from its live sub-boundaries."
    );
  }
  await verifyPostgresSignalActionSpendApplyBoundary(database, manifest.actionSpendApplyManifest);
  return manifest;
}
