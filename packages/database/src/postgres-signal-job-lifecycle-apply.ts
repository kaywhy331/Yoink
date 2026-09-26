/**
 * PostgreSQL bounded post-creation action-job LIFECYCLE writer.
 *
 * ---------------------------------------------------------------------
 * 1. SQLITE TRUTH (read completely before writing a line of SQL below)
 * ---------------------------------------------------------------------
 * `SignalRepository.transitionJob()` (packages/database/src/signal-repository.ts,
 * lines ~697-766) is the SQLite truth this boundary reproduces. Every legal
 * action-job state transition after creation is defined by
 * `TRANSITIONS` in packages/domain/src/job-state.ts (`canTransitionJob` /
 * `assertJobTransition`), reused verbatim below (see
 * `POSTGRES_SIGNAL_JOB_LIFECYCLE_TRANSITIONS`, built by calling the real
 * `canTransitionJob` for every (from, to) pair over the real `JOB_STATES`
 * enum — not hand-transcribed) rather than re-typed by hand. Within a single
 * `db.transaction()`, `transitionJob`:
 *   1. Loads the job row (`id, state, incident_id, mission_id, action,
 *      quantity`) scoped `WHERE id = ? AND user_id = ?`.
 *   2. `assertJobTransition(job.state, nextState)` — throws on an illegal
 *      transition (the 47-edge table below).
 *   3. If `nextState === 'cancelled'` and `jobMayHaveMutated(job.state)`
 *      (`adding|cart_verified|checkout_review|submit_authorized|submitting|
 *      confirmed|manual_review|submission_uncertain`) and `!manualResolution`
 *      — throws (only `manual_review`/`submission_uncertain` can legally
 *      reach `cancelled`, so this guard is only ever live for those two).
 *   4. `UPDATE action_jobs SET state = ?, updated_at = ?` (always).
 *   5. `INSERT INTO action_events(...)` with the CALLER's raw `reasonCode`
 *      (`.slice(0, 80)`, no character-class restriction) and `message`
 *      (`.replace(/\s+/g," ").trim().slice(0,500)`) and the caller's
 *      `sanitizeDiagnosticData(evidence)` (always).
 *   6. Branch on `nextState`:
 *      a. `offer_rejected | expired | cancelled` — `closeIncident(status=
 *         'closed', reason=nextState)` **and** `spendLedger.releaseForJob`.
 *      b. `submission_uncertain | manual_review` — incident `status=
 *         'locked', reason=nextState` only (no spend touch).
 *      c. `confirmed` — `closeIncident(status='closed', reason='confirmed')`
 *         **and**: if `job.action === 'submit_order'`,
 *         `spendLedger.commitForJob` **and**
 *         `UPDATE missions SET fulfilled_quantity = MIN(target_quantity,
 *         fulfilled_quantity + job.quantity), status = CASE WHEN
 *         fulfilled_quantity + job.quantity >= target_quantity THEN
 *         'satisfied' ELSE status END`; otherwise `spendLedger.releaseForJob`
 *         (no missions write).
 *      d. every other legal `nextState` (leased, navigating,
 *         verifying_listing, offer_verified, add_authorized, adding,
 *         cart_verified, checkout_review, submit_authorized,
 *         awaiting_executor-via-promotion) — no incident/mission/spend
 *         branch at all; only steps 4-5 plus 7 below run.
 *   7. `this.audit(job.id, "action_job_transition", nextState, message,
 *      {previousState, ...evidence})` — always. `AuditRepository.record`
 *      (audit-repository.ts) INSERTs both `audit_events` **and**
 *      `outbox_events` atomically for every domain event, so every
 *      `transitionJob` call unconditionally appends one audit row and one
 *      outbox row, regardless of branch.
 *   `closeIncident`/`updateIncidentForCurrentScope` (signal-repository.ts
 *   lines 658-695) share one UPDATE that only touches `signal_incidents`
 *   when EVERY `action_jobs` row and EVERY `signal_occurrences`-joined
 *   `signal_events` row referencing that incident belongs to the same
 *   tenant/user — a defensive cross-tenant guard reproduced verbatim below.
 *
 * ---------------------------------------------------------------------
 * 2. THE RESERVATION-LIFECYCLE SPLIT (packages/database/src/
 *    postgres-signal-reservation-lifecycle-apply.ts, v0.93, read fully)
 * ---------------------------------------------------------------------
 * That module ALREADY qualifies exactly two of `transitionJob`'s
 * post-creation effects: `spendLedger.releaseForJob` (its
 * `release_spend_reservation` operation, covering branches 6a/6c-else and
 * the standalone `SpendLedgerRepository.releaseExpired` path) and
 * `spendLedger.commitForJob` (its `commit_spend_reservation` operation,
 * covering branch 6c's `submit_order` half) — i.e. every
 * `spend_reservations` / `spend_ledger_entries` write `transitionJob` can
 * trigger. Its own manifest already carries `missionFulfillmentMutation:
 * false`, `checkoutMutation: false`, `orderSubmissionMutation: false` —
 * placeholders that anticipated exactly this residual writer; this module
 * is what finally earns `missionFulfillmentMutation: true` (on ITS OWN
 * manifest — reservation-lifecycle-apply.ts is untouched and correctly
 * stays `false`, since it still never writes `missions`).
 *
 * What reservation-lifecycle-apply does NOT own, and what this module owns
 * INSTEAD (the exact residual named in
 * `POSTGRES_SIGNAL_EVALUATION_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES` in
 * postgres-signal-evaluation-composition.ts line ~397 — "SignalRepository.
 * transitionJob post-creation branches -> spend_ledger_entries
 * (commit/release) and missions.fulfilled_quantity (job lifecycle after
 * creation, outside evaluation apply)" — that citation names TWO things;
 * this module closes BOTH the `missions.fulfilled_quantity` half directly
 * and the surrounding job/incident/event scaffolding the citation's prose
 * folds into the same sentence but reservation-lifecycle never touched):
 *   - `action_jobs.state` / `updated_at` (steps 4 above) — EVERY branch.
 *   - `action_events` INSERT (step 5) — EVERY branch.
 *   - `signal_incidents.status` / `closed_reason` / `updated_at` (branches
 *     6a/6b/6c) — the "closed"/"locked" incident lifecycle.
 *   - `missions.fulfilled_quantity` / `status` (branch 6c, `submit_order`
 *     only) — the one write the composition module's citation names first.
 *   - the final `audit_events` + `outbox_events` pair for the
 *     `action_job_transition` event (step 7) — EVERY branch.
 * This writer never touches `spend_reservations` or `spend_ledger_entries`
 * — those stay exactly where reservation-lifecycle-apply already owns
 * them. A real (unqualified, out of scope here — `activePrincipalCount: 0`
 * throughout this whole PostgreSQL track) production caller would invoke
 * both boundary functions inside one PostgreSQL transaction for branch 6a/
 * 6c to reproduce SQLite's single-`db.transaction()` atomicity; that
 * orchestration wiring does not exist yet for ANY of these boundaries.
 * Reading confirmed the residual is non-empty — five distinct write
 * families across three tables reservation-lifecycle-apply never
 * mentions or touches — so this module was authored rather than a
 * "redundant boundary" conclusion being reported.
 *
 * ---------------------------------------------------------------------
 * 3. JUDGMENT CALLS (for reviewer scrutiny)
 * ---------------------------------------------------------------------
 *   - Predecessor chain: `predecessorManifest` is
 *     `postgres-signal-attribution-policy-apply.ts`'s manifest (the newest
 *     committed full writer at authoring time), per explicit instruction —
 *     NOT a concurrent, uncommitted sibling module. This module's flag
 *     vocabulary (`sourceTrustWriterParity`, `catalogImportWriterParity`,
 *     `connectionProvisioningWriterParity`, `sqliteValidationParity`, …)
 *     is copied from attribution-policy-apply's OWN final flag values
 *     (its most-current snapshot), not reservation-lifecycle-apply's
 *     older, smaller flag set (e.g. attribution-policy-apply already
 *     carries `sourceWriterParity: true`; reservation-lifecycle-apply's
 *     manifest, authored earlier, still says `false` — the newer snapshot
 *     wins).
 *   - Shared writer-lock domain: the lock protocol's five domains are
 *     `source | retailer_qualification | settings | mission_policy |
 *     spend` (postgres-signal-writer-lock-protocol.ts
 *     `PROTECTED_TENANT_TABLES` = app_settings, mission_intent_revisions,
 *     **missions**, retailer_adapter_qualifications, source_connections,
 *     spend_reservations, user_spend_policies). `action_jobs` /
 *     `action_events` / `signal_incidents` appear in NONE of those five
 *     domains' table lists — only `missions` (this writer's one shared
 *     table with the lock protocol) does, under the `spend` bit's
 *     protection umbrella alongside `spend_reservations`. This writer
 *     consumes mask `'00001'` (the `spend` bit only) — the SAME bit
 *     reservation-lifecycle-apply consumes, deliberately: both boundaries
 *     mutate state hanging off the SAME `action_jobs` row within what was
 *     one SQLite transaction, and `missions.fulfilled_quantity` directly
 *     feeds `SpendLedgerRepository.evaluateReservation`'s capacity math
 *     (`fulfilled + reservedQuantity + quantity > policy.quantity`) — so
 *     serializing under the identical advisory-lock domain as
 *     reservation-lifecycle-apply is the only choice that actually
 *     prevents a race between the two boundaries for a shared job. The
 *     `mission_policy` bit's own table check instead validates
 *     `mission_intent_revisions`-style ownership, an unrelated concern
 *     this writer's own job-scoped `FOR UPDATE` already subsumes (the
 *     job row's own `mission_id` is read under lock, not re-derived).
 *   - `expectedCurrentState` is a field this writer's payload ADDS beyond
 *     `transitionJob`'s literal signature (which just reads whatever
 *     `job.state` currently is). SQLite is single-writer, so this
 *     ambiguity never arises there; a PostgreSQL boundary anticipating
 *     concurrent callers needs an explicit optimistic precondition
 *     ("current job ownership + expected current-state revalidation,
 *     fail-closed on wrong state" per the boundary requirements) so a
 *     caller's stale read never silently transitions the wrong edge.
 *   - Outcome set is deliberately **two**-valued (`applied` |
 *     `already_applied`), narrower than reservation-lifecycle-apply's
 *     three (`applied | already_current | already_applied`).
 *     Reservation-lifecycle-apply's `already_current` bucket is sound
 *     because its `releaseReason` enum is tightly bound to job state (a
 *     matching reason implies a matching state by construction). This
 *     writer's `nextState` carries no such binding to `reasonCode`/
 *     `message`/`evidence` — a job already sitting in `nextState` via a
 *     DIFFERENT request could silently drop the caller's specific
 *     evidence/message if treated as a free no-op. Any mismatch between
 *     the current row and `expectedCurrentState` that is not an exact
 *     replay of the SAME request (matched via the deterministic
 *     `audit_events`/`outbox_events` row) is therefore a hard failure
 *     (`55000`), not a silent no-op.
 *   - Request identity follows attribution-policy-apply's "format-only ID
 *     + fingerprint" pattern, not reservation-lifecycle-apply's
 *     "derive-and-compare-in-SQL" pattern — because `evidence` is
 *     arbitrary caller JSON (like attribution-policy-apply's 13-entry
 *     policy array), impractical to re-derive byte-for-byte in PL/pgSQL.
 *     `buildPostgresSignalJobLifecycleTransitionRequestId` hashes the
 *     WHOLE normalized payload via `canonicalPortabilityJson` client-side;
 *     the database only checks the id's regex shape and then verifies
 *     `requestFingerprint = sha256(request_payload::text)` on every
 *     replay, exactly like attribution-policy-apply.
 *   - `evidence` sanitization follows the same "TypeScript does the
 *     semantic work, PostgreSQL checks only structural bounds" split
 *     attribution-policy-apply's header already documents for
 *     `normalizedArticleBaseUrl`:
 *     `normalizedPostgresSignalJobLifecycleTransitionPayload` calls the
 *     REAL `sanitizeDiagnosticData` (packages/domain/src/redaction.ts) —
 *     byte-for-byte, not reimplemented — plus the two literal inline
 *     string transforms `transitionJob` itself uses for `reasonCode`
 *     (`.slice(0, 80)`) and `message` (`.replace(/\s+/g," ").trim()
 *     .slice(0,500)`); the PL/pgSQL function then only checks that
 *     `message` is already collapsed/trimmed (`message = btrim(regexp_
 *     replace(message, '\s+', ' ', 'g'))`) and that `reasonCode`'s and
 *     `evidence`'s byte lengths are bounded — NOT a character-class
 *     regex on `reasonCode`, because SQLite's own `action_events.
 *     reason_code` column imposes none either (only a length slice);
 *     a stricter PostgreSQL-side regex would silently reject a legal
 *     SQLite value.
 *   - `audit_events.data_json` uses this boundary's own
 *     `{contractVersion, operation, requestId, requestFingerprint,
 *     request, result}` replay-wrapper shape — the SAME shape every
 *     other qualified writer here uses for ITS OWN audit_events row —
 *     rather than attempting to reproduce SQLite's own
 *     `{previousState, ...evidence}` merge shape for `AuditRepository.
 *     record`'s `data` argument. The two are DIFFERENT `audit_events` rows
 *     serving different purposes even in the live SQLite code (compare
 *     `SpendLedgerRepository`'s own audit calls, whose `data` shapes never
 *     match reservation-lifecycle-apply's wrapper either); this writer's
 *     wrapper exists to make ITS OWN replay provably safe, not to mirror
 *     SQLite's audit content byte-for-byte. `action_events.evidence_json`
 *     — a REAL business table, not an internal audit trail — DOES store
 *     the caller's sanitized evidence verbatim, matching SQLite exactly.
 *   - Device/capability revalidation: audited and found not to apply.
 *     `transitionJob` itself performs NO device or capability check of any
 *     kind — every capability-token / `assigned_device_id` / lease check
 *     lives one layer up, in `ExecutionRepository.reconcileJob`
 *     (execution-repository.ts), which validates the capability BEFORE
 *     calling `transitionJob` and separately mutates `assigned_device_id`/
 *     `capability_nonce_hash`/`lease_expires_at` AFTER it returns — both
 *     outside `transitionJob`'s own transaction and therefore outside
 *     this residual's scope. `deviceCapabilityRevalidation: false` below
 *     records this honestly rather than silently omitting the topic.
 *   - FK audit for the graph revalidation join
 *     (`action_jobs.incident_id -> signal_incidents`,
 *     `action_jobs.mission_id -> missions`): both are
 *     `ON DELETE RESTRICT` in migrations.ts (never `ON DELETE SET NULL`),
 *     so once an `action_jobs` row exists, its `incident_id`/`mission_id`
 *     can never dangle or go null out from under this writer's `FOR
 *     UPDATE` join — no defensive NULL-handling is needed in the graph
 *     query. (`ON DELETE SET NULL` DOES appear elsewhere in this schema —
 *     e.g. `mission_decisions.incident_id`, `audit_events.user_id` — but
 *     never on the three FKs this writer's own join depends on.)
 *   - Notification dispatch remains explicitly out of scope: `transitionJob`
 *     never calls `NotificationRepository` (only `createActionJob` does,
 *     on the `notify` branch, already excluded from the composition's own
 *     scope) — consistent with the composition module's own note that the
 *     notification-dispatch family belongs to a future handler-composition
 *     rung, not this writer.
 */
import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { JOB_STATES, type JobState } from "../../contracts/src/index.js";
import { canTransitionJob, jobMayHaveMutated } from "../../domain/src/job-state.js";
import { sanitizeDiagnosticData } from "../../domain/src/redaction.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase,
  logIdlePostgresClientErrors
} from "./postgres-cutover.js";
import {
  applyPostgresQualifiedFunctionBoundary,
  verifyPostgresQualifiedFunctionBoundary,
  type PostgresQualifiedFunctionBoundaryReceipt,
  type PostgresQualifiedFunctionBoundarySpec
} from "./postgres-qualified-function-boundary.js";
import {
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONTRACT_VERSION,
  buildPostgresSignalAttributionPolicyApplyManifest,
  verifyPostgresSignalAttributionPolicyApplyBoundary,
  type PostgresSignalAttributionPolicyApplyManifest
} from "./postgres-signal-attribution-policy-apply.js";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION
} from "./postgres-signal-writer-lock-protocol.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_RECEIPT_TABLE =
  "yoink_signal_job_lifecycle_apply_receipt";
export const POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_FUNCTION =
  "yoink_apply_signal_job_lifecycle";
export const POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONFIRMATION =
  "JOB_LIFECYCLE_TRANSITION_V1";

const MAXIMUM_REQUEST_PAYLOAD_BYTES = 16_384;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const REQUEST_ID = /^job_lifecycle_transition_[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text"
] as const);
const FUNCTION_ARGUMENTS_SQL = `
  expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
  request_id TEXT, request_payload_json TEXT
`;
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";

/**
 * The full set of tables this function's SQL directly names in a FROM,
 * JOIN, INSERT, or UPDATE clause (read-only joins included) — see header
 * section 2 for exactly which of these six are ever mutated.
 * `signal_events`/`signal_occurrences` are read-only (the cross-tenant
 * incident guard); everything else is a residual write owned here.
 */
const PROTECTED_TENANT_TABLES = Object.freeze([
  "action_events",
  "action_jobs",
  "audit_events",
  "missions",
  "outbox_events",
  "signal_events",
  "signal_incidents",
  "signal_occurrences"
] as const);
const MUTATION_TABLES = Object.freeze([
  "action_events",
  "action_jobs",
  "audit_events",
  "missions",
  "outbox_events",
  "signal_incidents"
] as const);

/**
 * Reproduces `TRANSITIONS` in packages/domain/src/job-state.ts by calling
 * the REAL exported `canTransitionJob` for every (from, to) pair over the
 * REAL exported `JOB_STATES` enum — not hand-transcribed, so this can never
 * silently drift from the domain source of truth.
 */
export const POSTGRES_SIGNAL_JOB_LIFECYCLE_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> =
  Object.freeze(Object.fromEntries(
    JOB_STATES.map((from) => [from, Object.freeze(JOB_STATES.filter((to) => canTransitionJob(from, to)))])
  ) as Record<JobState, readonly JobState[]>);

const POSTGRES_SIGNAL_JOB_LIFECYCLE_LEGAL_TRANSITION_COUNT = JOB_STATES.reduce(
  (total, state) => total + POSTGRES_SIGNAL_JOB_LIFECYCLE_TRANSITIONS[state].length,
  0
);
if (POSTGRES_SIGNAL_JOB_LIFECYCLE_LEGAL_TRANSITION_COUNT !== 47) {
  throw new Error("The PostgreSQL job-lifecycle transition table drifted from its expected 47 legal edges.");
}

/** Reproduces `jobMayHaveMutated` over the real `JOB_STATES` enum. */
export const POSTGRES_SIGNAL_JOB_LIFECYCLE_MUTATION_RISK_STATES = Object.freeze(
  JOB_STATES.filter((state) => jobMayHaveMutated(state))
);
if (POSTGRES_SIGNAL_JOB_LIFECYCLE_MUTATION_RISK_STATES.length !== 8) {
  throw new Error("The PostgreSQL job-lifecycle mutation-risk state set drifted from its expected 8 states.");
}

export type PostgresSignalJobLifecycleOperation = "transition_job";

export interface PostgresSignalJobLifecycleTransitionPayload {
  jobId: string;
  expectedCurrentState: JobState;
  nextState: JobState;
  reasonCode: string;
  message: string;
  evidence: Record<string, unknown>;
  manualResolution: boolean;
  confirmation: typeof POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONFIRMATION;
}

type PostgresSignalAttributionPolicyPredecessor = Pick<
  PostgresSignalAttributionPolicyApplyManifest,
  "schemaName" | "fingerprint" | "attributionPolicyRoleNamespace"
>;

export interface PostgresSignalJobLifecycleApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  attributionPolicyApplyContractVersion: 1;
  schemaName: string;
  jobLifecycleRoleNamespace: string;
  attributionPolicyApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalAttributionPolicyPredecessor;
  jobLifecycleRole: {
    kind: "signal_job_lifecycle_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 1;
  jobStateCount: 19;
  legalTransitionCount: 47;
  mutationRiskStateCount: 8;
  protectedTenantTableCount: 8;
  forcedRlsTableCount: 8;
  mutationTableCount: 6;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  writerLockProtocolConsumed: true;
  spendScopeConsumed: true;
  deterministicRequestIdentity: true;
  immutableTransitionReplay: true;
  lifecycleAwareOutboxReplay: true;
  currentJobOwnershipRevalidation: true;
  expectedCurrentStateRevalidation: true;
  legalTransitionTableEnforced: true;
  possibleMutationCancelGuardEnforced: true;
  crossTenantIncidentGuardEnforced: true;
  terminalIncidentClosureParity: true;
  reviewIncidentLockParity: true;
  missionFulfillmentMutation: true;
  checkoutMutation: false;
  orderSubmissionMutation: false;
  spendReservationMutationDeferred: true;
  atomicJobLifecycleAuditOutbox: true;
  databaseOwnedTimestamps: true;
  deviceCapabilityRevalidation: false;
  sqliteValidationParity: true;
  sourceTrustWriterParity: true;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  catalogImportWriterParity: true;
  connectionProvisioningWriterParity: true;
  sourceWriterParity: true;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: true;
  attributionPolicyParity: true;
  jobLifecycleWriterParity: true;
  writerLockProtocolParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalJobLifecycleCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  attributionPolicyApplyContractVersion: 1;
  deterministicManifestImplemented: true;
  atomicQualificationApplyImplemented: true;
  exactEffectivePrivilegeVerification: true;
  immutableBoundaryCatalogFingerprint: true;
  qualificationSuiteParity: true;
  noLogin: true;
  noInherit: true;
  noBypassRls: true;
  securityDefinerRoutineVerified: true;
  phase: "qualified_inactive";
  serverBoundPrincipalLookup: true;
  writerLockProtocolConsumed: true;
  spendScopeConsumed: true;
  deterministicRequestIdentity: true;
  immutableTransitionReplay: true;
  lifecycleAwareOutboxReplay: true;
  currentJobOwnershipRevalidation: true;
  expectedCurrentStateRevalidation: true;
  legalTransitionTableEnforced: true;
  possibleMutationCancelGuardEnforced: true;
  crossTenantIncidentGuardEnforced: true;
  terminalIncidentClosureParity: true;
  reviewIncidentLockParity: true;
  missionFulfillmentMutation: true;
  checkoutMutation: false;
  orderSubmissionMutation: false;
  spendReservationMutationDeferred: true;
  atomicJobLifecycleAuditOutbox: true;
  databaseOwnedTimestamps: true;
  deviceCapabilityRevalidation: false;
  sqliteValidationParity: true;
  sourceTrustWriterParity: true;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  catalogImportWriterParity: true;
  connectionProvisioningWriterParity: true;
  sourceWriterParity: true;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: true;
  attributionPolicyParity: true;
  jobLifecycleWriterParity: true;
  writerLockProtocolParity: false;
  operationCount: 1;
  jobStateCount: 19;
  legalTransitionCount: 47;
  mutationRiskStateCount: 8;
  protectedTenantTableCount: 8;
  forcedRlsTableCount: 8;
  mutationTableCount: 6;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  jobLifecycleMutationAuthority: true;
  actionAuthority: false;
  checkoutAuthority: false;
  orderSubmissionAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalJobLifecycleApplyResult {
  contractVersion: 1;
  operation: PostgresSignalJobLifecycleOperation;
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  jobMutated: boolean;
  actionEventMutated: boolean;
  incidentMutated: boolean;
  missionMutated: boolean;
  auditMutated: boolean;
  outboxMutated: boolean;
  job: Record<string, unknown>;
  incident: Record<string, unknown> | null;
  mission: Record<string, unknown> | null;
  sourceSyncWriterParity: true;
  sourceWriterParity: true;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  configurationWriterParity: false;
  reservationWriterParity: true;
  attributionPolicyParity: true;
  jobLifecycleWriterParity: true;
  writerLockProtocolParity: false;
  mutationAuthority: true;
  jobLifecycleMutationAuthority: true;
  actionAuthority: false;
  checkoutAuthority: false;
  orderSubmissionAuthority: false;
  runtimeAuthority: false;
}

export interface NodePostgresSignalJobLifecycleApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalJobLifecycleCapabilityProjection> | null = null;

export class PostgresSignalJobLifecycleApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalJobLifecycleApplyQualificationError";
  }
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function relation(schema: string, name: string): string {
  return `${identifier(schema)}.${identifier(name)}`;
}

function safeSchema(value: string): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      "The PostgreSQL job-lifecycle schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      "The PostgreSQL job-lifecycle role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_job_lifecycle`;
  if (value.length > 63) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      "The PostgreSQL job-lifecycle role name exceeds PostgreSQL's limit."
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function collectRoleNamespaces(value: unknown, namespaces = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return namespaces;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith("RoleNamespace") && typeof entry === "string") namespaces.add(entry);
    else if (entry && typeof entry === "object") collectRoleNamespaces(entry, namespaces);
  }
  return namespaces;
}

/**
 * Normalizes and validates a caller-supplied transition request into the
 * exact payload shape the PostgreSQL boundary function accepts, reusing
 * the REAL `sanitizeDiagnosticData` (packages/domain/src/redaction.ts) for
 * `evidence` and `transitionJob`'s own two literal inline string
 * transforms for `reasonCode`/`message` — see header section 3.
 */
export function normalizedPostgresSignalJobLifecycleTransitionPayload(input: {
  jobId: string;
  expectedCurrentState: JobState;
  nextState: JobState;
  reasonCode: string;
  message: string;
  evidence: Record<string, unknown>;
  manualResolution: boolean;
}): PostgresSignalJobLifecycleTransitionPayload {
  const jobId = String(input?.jobId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(jobId)) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      "A valid action-job id is required."
    );
  }
  const jobStateSet = new Set<string>(JOB_STATES);
  if (!jobStateSet.has(input?.expectedCurrentState)) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      "A valid expected current job state is required."
    );
  }
  if (!jobStateSet.has(input?.nextState)) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      "A valid next job state is required."
    );
  }
  if (!canTransitionJob(input.expectedCurrentState, input.nextState)) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      `Action job cannot move from ${input.expectedCurrentState} to ${input.nextState}.`
    );
  }
  if (input.nextState === "cancelled"
    && jobMayHaveMutated(input.expectedCurrentState)
    && input.manualResolution !== true) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      "A job that may have mutated a cart requires manual review instead of ordinary cancellation."
    );
  }
  if (typeof input.manualResolution !== "boolean") {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      "The manual-resolution flag must be boolean."
    );
  }
  // Byte-for-byte reproduction of transitionJob's own literal inline
  // normalization (signal-repository.ts) — not a rewrite of it.
  const reasonCode = String(input?.reasonCode || "state_changed").slice(0, 80);
  const message = String(input?.message || "Action job state changed.").replace(/\s+/g, " ").trim().slice(0, 500);
  const evidenceInput = input?.evidence;
  if (!evidenceInput || typeof evidenceInput !== "object" || Array.isArray(evidenceInput)) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      "The action-job evidence must be a plain object."
    );
  }
  const evidence = sanitizeDiagnosticData(evidenceInput) as Record<string, unknown>;
  return {
    jobId,
    expectedCurrentState: input.expectedCurrentState,
    nextState: input.nextState,
    reasonCode,
    message,
    evidence,
    manualResolution: input.manualResolution,
    confirmation: POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONFIRMATION
  };
}

/**
 * Derives the deterministic request id from the principal and the complete
 * normalized payload, hashing via `canonicalPortabilityJson` (same pattern
 * `postgres-signal-attribution-policy-apply.ts` uses for its own nested
 * `policies` array) since `evidence` is arbitrary caller JSON impractical
 * to re-derive byte-for-byte in PL/pgSQL. The PostgreSQL function only
 * validates this id's *format*; replay safety is instead provided by
 * `requestFingerprint`, computed by the database itself from the
 * jsonb-normalized request payload text — see header section 3.
 */
export function buildPostgresSignalJobLifecycleTransitionRequestId(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  payload: PostgresSignalJobLifecycleTransitionPayload
): string {
  const parts = [
    "postgres-signal-job-lifecycle-transition-request-v1",
    String(principal?.tenantId ?? ""),
    String(principal?.userId ?? ""),
    canonicalPortabilityJson(payload)
  ].join("\n");
  return `job_lifecycle_transition_${createHash("sha256").update(parts).digest("hex").slice(0, 32)}`;
}

export function buildPostgresSignalJobLifecycleApplyManifest(
  predecessorManifest = buildPostgresSignalAttributionPolicyApplyManifest(),
  requestedRoleNamespace = "yoink_job_lifecycle_q"
): PostgresSignalJobLifecycleApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const jobLifecycleRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (collectRoleNamespaces(predecessorManifest).has(jobLifecycleRoleNamespace)) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      "The PostgreSQL job-lifecycle role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalJobLifecycleApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    attributionPolicyApplyContractVersion:
      POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONTRACT_VERSION,
    schemaName,
    jobLifecycleRoleNamespace,
    attributionPolicyApplyManifestFingerprint: predecessorManifest.fingerprint,
    // Store the FULL predecessor manifest object (type-narrowed to the Pick):
    // the ancestral verify chain dereferences fields far beyond the Pick, and
    // a hollow literal collapses every downstream default to yoink_cutover.
    predecessorManifest,
    jobLifecycleRole: {
      kind: "signal_job_lifecycle_apply_boundary",
      name: roleName(jobLifecycleRoleNamespace),
      functionName: POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 1,
    jobStateCount: 19,
    legalTransitionCount: 47,
    mutationRiskStateCount: 8,
    protectedTenantTableCount: 8,
    forcedRlsTableCount: 8,
    mutationTableCount: 6,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    writerLockProtocolConsumed: true,
    spendScopeConsumed: true,
    deterministicRequestIdentity: true,
    immutableTransitionReplay: true,
    lifecycleAwareOutboxReplay: true,
    currentJobOwnershipRevalidation: true,
    expectedCurrentStateRevalidation: true,
    legalTransitionTableEnforced: true,
    possibleMutationCancelGuardEnforced: true,
    crossTenantIncidentGuardEnforced: true,
    terminalIncidentClosureParity: true,
    reviewIncidentLockParity: true,
    missionFulfillmentMutation: true,
    checkoutMutation: false,
    orderSubmissionMutation: false,
    spendReservationMutationDeferred: true,
    atomicJobLifecycleAuditOutbox: true,
    databaseOwnedTimestamps: true,
    deviceCapabilityRevalidation: false,
    sqliteValidationParity: true,
    sourceTrustWriterParity: true,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: true,
    catalogImportWriterParity: true,
    connectionProvisioningWriterParity: true,
    sourceWriterParity: true,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: true,
    attributionPolicyParity: true,
    jobLifecycleWriterParity: true,
    writerLockProtocolParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

function transitionValidityExpressionSql(): string {
  return JOB_STATES
    .filter((state) => POSTGRES_SIGNAL_JOB_LIFECYCLE_TRANSITIONS[state].length > 0)
    .map((state) => {
      const list = POSTGRES_SIGNAL_JOB_LIFECYCLE_TRANSITIONS[state].map((next) => `'${next}'`).join(", ");
      return `(current_state_value = '${state}' AND next_state_value IN (${list}))`;
    })
    .join("\n    OR ");
}

export function signalJobLifecycleApplyFunctionSource(
  manifest = buildPostgresSignalJobLifecycleApplyManifest()
): string {
  const jobStatesSql = JOB_STATES.map((state) => `'${state}'`).join(", ");
  const mutationRiskStatesSql = POSTGRES_SIGNAL_JOB_LIFECYCLE_MUTATION_RISK_STATES
    .map((state) => `'${state}'`).join(", ");
  const transitionValiditySql = transitionValidityExpressionSql();
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  job_id_value TEXT;
  expected_current_state_value TEXT;
  next_state_value TEXT;
  current_state_value TEXT;
  reason_code_value TEXT;
  message_value TEXT;
  evidence_value JSONB;
  manual_resolution_value BOOLEAN;
  writer_lock_result JSONB;
  writer_lock_result_count BIGINT;
  graph_record RECORD;
  branch_kind TEXT;
  incident_status_value TEXT;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  action_event_id_value TEXT;
  audit_count BIGINT;
  outbox_count BIGINT;
  replay_record RECORD;
  mutation_timestamp TEXT;
  affected_rows BIGINT;
  incident_mutated_flag BOOLEAN := FALSE;
  mission_mutated_flag BOOLEAN := FALSE;
  mission_status_before TEXT;
  mission_status_after TEXT;
  statement_count_value BIGINT;
  job_result JSONB;
  incident_result JSONB := NULL;
  mission_result JSONB := NULL;
  result_value JSONB;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name <> 'transition_job'
    OR request_id !~ '^job_lifecycle_transition_[a-f0-9]{32}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal job-lifecycle request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal job-lifecycle payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR request_payload - ARRAY[
        'jobId', 'expectedCurrentState', 'nextState', 'reasonCode',
        'message', 'evidence', 'manualResolution', 'confirmation'
      ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 8
    OR pg_catalog.jsonb_typeof(request_payload->'jobId') IS DISTINCT FROM 'string'
    OR request_payload->>'jobId' !~ '^[A-Za-z0-9_-]{3,160}$'
    OR pg_catalog.jsonb_typeof(request_payload->'expectedCurrentState') IS DISTINCT FROM 'string'
    OR request_payload->>'expectedCurrentState' NOT IN (${jobStatesSql})
    OR pg_catalog.jsonb_typeof(request_payload->'nextState') IS DISTINCT FROM 'string'
    OR request_payload->>'nextState' NOT IN (${jobStatesSql})
    OR pg_catalog.jsonb_typeof(request_payload->'reasonCode') IS DISTINCT FROM 'string'
    OR pg_catalog.octet_length(request_payload->>'reasonCode') NOT BETWEEN 1 AND 80
    OR pg_catalog.jsonb_typeof(request_payload->'message') IS DISTINCT FROM 'string'
    OR pg_catalog.octet_length(request_payload->>'message') NOT BETWEEN 1 AND 500
    OR (request_payload->>'message') <> pg_catalog.btrim(
      pg_catalog.regexp_replace(request_payload->>'message', '\\s+', ' ', 'g')
    )
    OR pg_catalog.jsonb_typeof(request_payload->'evidence') IS DISTINCT FROM 'object'
    OR pg_catalog.octet_length((request_payload->'evidence')::text) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES}
    OR pg_catalog.jsonb_typeof(request_payload->'manualResolution') IS DISTINCT FROM 'boolean'
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> '${POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONFIRMATION}' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal job-lifecycle payload shape is invalid';
  END IF;
  job_id_value := request_payload->>'jobId';
  expected_current_state_value := request_payload->>'expectedCurrentState';
  next_state_value := request_payload->>'nextState';
  reason_code_value := request_payload->>'reasonCode';
  message_value := request_payload->>'message';
  evidence_value := request_payload->'evidence';
  manual_resolution_value := (request_payload->>'manualResolution')::boolean;

  SELECT MIN(principal.tenant_id), MIN(principal.user_id), COUNT(*)
    INTO resolved_tenant_id, resolved_user_id, resolved_principal_count
  FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)} AS principal
  WHERE principal.principal_role = session_user::text AND principal.active = TRUE;
  IF resolved_principal_count <> 1 OR resolved_tenant_id IS NULL
    OR resolved_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant session principal is not active';
  END IF;
  IF resolved_tenant_id <> expected_tenant_id OR resolved_user_id <> expected_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant session principal does not match the expected authenticated principal';
  END IF;

  -- Shared writer-lock protocol, spend domain only — see header section 3
  -- for why this writer and reservation-lifecycle-apply share this bit.
  SELECT MIN(lock_result.result_json)::jsonb, COUNT(*)
    INTO writer_lock_result, writer_lock_result_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION)}(
    expected_tenant_id, expected_user_id, '', '', '', '00001'
  ) AS lock_result;
  IF writer_lock_result_count <> 1 OR writer_lock_result IS NULL
    OR writer_lock_result->>'contractVersion' <> '1'
    OR writer_lock_result->>'lockProtocolVersion' <> 'signal_action_constraints_v1'
    OR writer_lock_result->>'lockMask' <> '00001'
    OR writer_lock_result->>'scopeCount' <> '1'
    OR writer_lock_result->'lockScopeOrder' IS DISTINCT FROM
      pg_catalog.jsonb_build_array(
        'source', 'retailer_qualification', 'settings', 'mission_policy', 'spend'
      )
    OR writer_lock_result->>'sourceConnectionId' <> ''
    OR writer_lock_result->>'retailerId' <> ''
    OR writer_lock_result->>'missionId' <> ''
    OR writer_lock_result->>'mutationApplied' <> 'false'
    OR writer_lock_result->>'mutationAuthority' <> 'false'
    OR writer_lock_result->>'runtimeAuthority' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal job-lifecycle shared writer-lock protocol failed';
  END IF;

  -- Current job ownership + graph revalidation. incident_id/mission_id are
  -- both NOT NULL, ON DELETE RESTRICT on action_jobs (migrations.ts), so
  -- this INNER JOIN can never silently drop a row with a live job.
  SELECT job.id AS job_id, job.state AS job_state, job.action AS job_action,
         job.quantity AS job_quantity, job.incident_id AS job_incident_id,
         job.mission_id AS job_mission_id, job.updated_at AS job_updated_at,
         incident.id AS incident_id, incident.status AS incident_status,
         incident.closed_reason AS incident_closed_reason,
         incident.updated_at AS incident_updated_at,
         mission.id AS mission_id, mission.target_quantity AS mission_target_quantity,
         mission.fulfilled_quantity AS mission_fulfilled_quantity,
         mission.status AS mission_status, mission.updated_at AS mission_updated_at
    INTO graph_record
  FROM ${relation(manifest.schemaName, "action_jobs")} AS job
  JOIN ${relation(manifest.schemaName, "signal_incidents")} AS incident
    ON incident.id = job.incident_id
    AND incident.tenant_id = resolved_tenant_id AND incident.user_id = resolved_user_id
  JOIN ${relation(manifest.schemaName, "missions")} AS mission
    ON mission.id = job.mission_id
    AND mission.tenant_id = resolved_tenant_id AND mission.user_id = resolved_user_id
  WHERE job.id = job_id_value AND job.tenant_id = resolved_tenant_id
    AND job.user_id = resolved_user_id
  FOR UPDATE OF job, incident, mission;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal job-lifecycle action-job ownership is invalid';
  END IF;
  current_state_value := graph_record.job_state;

  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(request_payload::text, 'UTF8')
  ), 'hex');
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_job_lifecycle_request_v1|' || resolved_tenant_id ||
      '|' || resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_job_lifecycle_outbox_v1|' || audit_id_value, 'UTF8'
    )
  ), 'hex'), 1, 32);

  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} WHERE id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} WHERE id = outbox_id_value;
  IF audit_count <> outbox_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal job-lifecycle request graph is partial';
  END IF;

  IF audit_count = 1 THEN
    SELECT audit.tenant_id, audit.user_id, audit.correlation_id,
           audit.event_type, audit.reason_code, audit.message,
           audit.data_json::jsonb AS audit_data, audit.created_at AS audit_created_at,
           outbox.tenant_id AS outbox_tenant_id, outbox.aggregate_type,
           outbox.aggregate_id, outbox.event_type AS outbox_event_type,
           outbox.payload_json::jsonb AS outbox_payload,
           outbox.created_at AS outbox_created_at
      INTO STRICT replay_record
    FROM ${relation(manifest.schemaName, "audit_events")} AS audit
    JOIN ${relation(manifest.schemaName, "outbox_events")} AS outbox
      ON outbox.id = outbox_id_value
    WHERE audit.id = audit_id_value;
    IF replay_record.tenant_id <> resolved_tenant_id
      OR replay_record.user_id <> resolved_user_id
      OR replay_record.correlation_id <> job_id_value
      OR replay_record.event_type <> 'action_job_transition'
      OR replay_record.reason_code <> next_state_value
      OR replay_record.message <> message_value
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR replay_record.audit_data->'request' IS DISTINCT FROM request_payload
      OR pg_catalog.jsonb_typeof(replay_record.audit_data->'result') IS DISTINCT FROM 'object'
      OR (replay_record.audit_data->'result'->'job'->>'id') <> job_id_value
      OR (replay_record.audit_data->'result'->'job'->>'state') <> next_state_value
      OR (replay_record.audit_data->'result'->'job'->>'state') <> current_state_value
      OR replay_record.outbox_tenant_id <> resolved_tenant_id
      OR replay_record.aggregate_type <> 'action_job'
      OR replay_record.aggregate_id <> job_id_value
      OR replay_record.outbox_event_type <> 'action_job_transition'
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'correlationId' <> job_id_value
      OR replay_record.outbox_payload->>'reasonCode' <> next_state_value
      OR replay_record.outbox_payload->>'message' <> message_value
      OR replay_record.outbox_payload->'data' IS DISTINCT FROM replay_record.audit_data
      OR replay_record.audit_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal job-lifecycle replay graph changed';
    END IF;
    RETURN QUERY SELECT (replay_record.audit_data->'result' || pg_catalog.jsonb_build_object(
      'outcome', 'already_applied',
      'mutationApplied', FALSE,
      'idempotentReplay', TRUE,
      'mutationStatementCount', 0,
      'mutationRowCount', 0,
      'jobMutated', FALSE,
      'actionEventMutated', FALSE,
      'incidentMutated', FALSE,
      'missionMutated', FALSE,
      'auditMutated', FALSE,
      'outboxMutated', FALSE
    ))::text;
    RETURN;
  END IF;

  -- Optimistic current-state precondition: fail closed on any mismatch,
  -- including a job another (different) request already moved past this
  -- one — see header section 3 for why this is intentionally NOT a silent
  -- no-op the way reservation-lifecycle-apply's "already_current" is.
  IF current_state_value <> expected_current_state_value THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal job-lifecycle current state does not match the expected state';
  END IF;

  IF NOT (
    ${transitionValiditySql}
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal job-lifecycle transition is not legal from the current state';
  END IF;

  IF next_state_value = 'cancelled'
    AND current_state_value IN (${mutationRiskStatesSql})
    AND NOT manual_resolution_value THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal job-lifecycle cancellation of a possibly mutated job requires manual resolution';
  END IF;

  branch_kind := CASE
    WHEN next_state_value IN ('offer_rejected', 'expired', 'cancelled') THEN 'close_terminal'
    WHEN next_state_value IN ('submission_uncertain', 'manual_review') THEN 'lock_review'
    WHEN next_state_value = 'confirmed' THEN 'close_confirmed'
    ELSE 'plain'
  END;

  mutation_timestamp := pg_catalog.to_char(
    GREATEST(
      pg_catalog.statement_timestamp(),
      graph_record.job_updated_at::timestamptz + INTERVAL '1 millisecond'
    ) AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  UPDATE ${relation(manifest.schemaName, "action_jobs")}
  SET state = next_state_value, updated_at = mutation_timestamp
  WHERE id = job_id_value AND tenant_id = resolved_tenant_id AND user_id = resolved_user_id
    AND state = current_state_value AND updated_at = graph_record.job_updated_at;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal job-lifecycle action-job mutation was ambiguous';
  END IF;

  action_event_id_value := 'action_event_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('postgres_signal_job_lifecycle_action_event_v1|' || audit_id_value, 'UTF8')
  ), 'hex'), 1, 32);
  INSERT INTO ${relation(manifest.schemaName, "action_events")}(
    id, job_id, state, reason_code, message, evidence_json, created_at
  ) VALUES (
    action_event_id_value, job_id_value, next_state_value, reason_code_value,
    message_value, evidence_value::text, mutation_timestamp
  );

  IF branch_kind IN ('close_terminal', 'close_confirmed') THEN
    incident_status_value := 'closed';
  ELSIF branch_kind = 'lock_review' THEN
    incident_status_value := 'locked';
  END IF;

  IF branch_kind <> 'plain' THEN
    -- Reproduces closeIncident/updateIncidentForCurrentScope's defensive
    -- cross-tenant guard verbatim (signal-repository.ts lines 662-695).
    UPDATE ${relation(manifest.schemaName, "signal_incidents")} AS incident
    SET status = incident_status_value, closed_reason = next_state_value,
        updated_at = mutation_timestamp
    WHERE incident.id = graph_record.incident_id
      AND incident.tenant_id = resolved_tenant_id AND incident.user_id = resolved_user_id
      AND NOT EXISTS (
        SELECT 1 FROM ${relation(manifest.schemaName, "action_jobs")} AS other_job
        WHERE other_job.incident_id = incident.id
          AND (other_job.tenant_id <> resolved_tenant_id OR other_job.user_id <> resolved_user_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
        JOIN ${relation(manifest.schemaName, "signal_events")} AS event
          ON event.id = occurrence.event_id
        WHERE occurrence.incident_id = incident.id
          AND (event.tenant_id <> resolved_tenant_id OR event.user_id <> resolved_user_id)
      );
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal job-lifecycle incident mutation was ambiguous';
    END IF;
    incident_mutated_flag := TRUE;
  END IF;

  IF branch_kind = 'close_confirmed' AND graph_record.job_action = 'submit_order' THEN
    SELECT mission.status INTO mission_status_before
    FROM ${relation(manifest.schemaName, "missions")} AS mission
    WHERE mission.id = graph_record.mission_id
      AND mission.tenant_id = resolved_tenant_id AND mission.user_id = resolved_user_id;
    UPDATE ${relation(manifest.schemaName, "missions")} AS mission
    SET fulfilled_quantity = LEAST(
          mission.target_quantity, mission.fulfilled_quantity + graph_record.job_quantity
        ),
        status = CASE
          WHEN mission.fulfilled_quantity + graph_record.job_quantity >= mission.target_quantity
          THEN 'satisfied' ELSE mission.status
        END,
        updated_at = mutation_timestamp
    WHERE mission.id = graph_record.mission_id
      AND mission.tenant_id = resolved_tenant_id AND mission.user_id = resolved_user_id;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal job-lifecycle mission mutation was ambiguous';
    END IF;
    mission_mutated_flag := TRUE;
    -- SQLite twin (SignalRepository.expireNotificationsIfSatisfied): a plan
    -- that just left active by being satisfied expires its still-pending
    -- calls with 'plan_satisfied' instead of letting them ring later.
    SELECT mission.status INTO mission_status_after
    FROM ${relation(manifest.schemaName, "missions")} AS mission
    WHERE mission.id = graph_record.mission_id
      AND mission.tenant_id = resolved_tenant_id AND mission.user_id = resolved_user_id;
    IF mission_status_before = 'active' AND mission_status_after = 'satisfied' THEN
      UPDATE ${relation(manifest.schemaName, "notification_deliveries")} AS delivery
      SET state = 'expired', assigned_device_id = NULL, capability_hash = '',
          lease_expires_at = '', failure_code = 'plan_satisfied',
          updated_at = mutation_timestamp
      WHERE delivery.tenant_id = resolved_tenant_id AND delivery.user_id = resolved_user_id
        AND delivery.state IN ('pending', 'leased')
        AND delivery.job_id IN (
          SELECT job.id FROM ${relation(manifest.schemaName, "action_jobs")} AS job
          WHERE job.mission_id = graph_record.mission_id
            AND job.tenant_id = resolved_tenant_id AND job.user_id = resolved_user_id
        );
    END IF;
  END IF;

  statement_count_value := 4 + incident_mutated_flag::int + mission_mutated_flag::int;

  job_result := pg_catalog.jsonb_build_object(
    'id', job_id_value, 'previousState', current_state_value,
    'state', next_state_value, 'action', graph_record.job_action,
    'incidentId', graph_record.incident_id, 'missionId', graph_record.mission_id,
    'updatedAt', mutation_timestamp
  );
  IF incident_mutated_flag THEN
    incident_result := pg_catalog.jsonb_build_object(
      'id', graph_record.incident_id, 'status', incident_status_value,
      'closedReason', next_state_value, 'updatedAt', mutation_timestamp
    );
  END IF;
  IF mission_mutated_flag THEN
    mission_result := pg_catalog.jsonb_build_object(
      'id', graph_record.mission_id,
      'fulfilledQuantity', LEAST(
        graph_record.mission_target_quantity,
        graph_record.mission_fulfilled_quantity + graph_record.job_quantity
      ),
      'targetQuantity', graph_record.mission_target_quantity,
      'status', CASE
        WHEN graph_record.mission_fulfilled_quantity + graph_record.job_quantity
          >= graph_record.mission_target_quantity
        THEN 'satisfied' ELSE graph_record.mission_status
      END,
      'updatedAt', mutation_timestamp
    );
  END IF;

  result_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1, 'operation', operation_name,
    'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
    'outcome', 'applied', 'mutationApplied', TRUE, 'idempotentReplay', FALSE,
    'mutationStatementCount', statement_count_value,
    'mutationRowCount', statement_count_value,
    'jobMutated', TRUE, 'actionEventMutated', TRUE,
    'incidentMutated', incident_mutated_flag, 'missionMutated', mission_mutated_flag,
    'auditMutated', TRUE, 'outboxMutated', TRUE,
    'job', job_result, 'incident', incident_result, 'mission', mission_result,
    'sourceSyncWriterParity', TRUE, 'sourceWriterParity', TRUE,
    'retailerQualificationWriterParity', TRUE, 'missionPolicyWriterParity', TRUE,
    'configurationWriterParity', FALSE, 'reservationWriterParity', TRUE,
    'attributionPolicyParity', TRUE, 'jobLifecycleWriterParity', TRUE,
    'writerLockProtocolParity', FALSE,
    'mutationAuthority', TRUE, 'jobLifecycleMutationAuthority', TRUE,
    'actionAuthority', FALSE, 'checkoutAuthority', FALSE,
    'orderSubmissionAuthority', FALSE, 'runtimeAuthority', FALSE
  );
  audit_data_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1, 'operation', operation_name,
    'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
    'request', request_payload, 'result', result_value
  );
  outbox_payload_value := pg_catalog.jsonb_build_object(
    'auditId', audit_id_value, 'correlationId', job_id_value,
    'reasonCode', next_state_value, 'message', message_value,
    'data', audit_data_value
  );

  INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
    id, tenant_id, user_id, correlation_id, event_type,
    reason_code, message, data_json, created_at
  ) VALUES (
    audit_id_value, resolved_tenant_id, resolved_user_id, job_id_value,
    'action_job_transition', next_state_value, message_value,
    audit_data_value::text, mutation_timestamp
  );
  INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
    id, tenant_id, aggregate_type, aggregate_id, event_type,
    payload_json, created_at, delivered_at
  ) VALUES (
    outbox_id_value, resolved_tenant_id, 'action_job', job_id_value,
    'action_job_transition', outbox_payload_value::text, mutation_timestamp, ''
  );

  RETURN QUERY SELECT result_value::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalJobLifecycleApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_job_lifecycle_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.jobLifecycleRole.name,
    functionName: POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalJobLifecycleApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_job_lifecycle_apply_receipt",
    receiptTriggerName: "yoink_signal_job_lifecycle_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.attributionPolicyApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      attributionPolicyApplyContractVersion: 1,
      operationCount: 1,
      jobStateCount: 19,
      legalTransitionCount: 47,
      mutationRiskStateCount: 8,
      serverBoundPrincipalLookup: true,
      writerLockProtocolConsumed: true,
      spendScopeConsumed: true,
      deterministicRequestIdentity: true,
      immutableTransitionReplay: true,
      lifecycleAwareOutboxReplay: true,
      currentJobOwnershipRevalidation: true,
      expectedCurrentStateRevalidation: true,
      legalTransitionTableEnforced: true,
      possibleMutationCancelGuardEnforced: true,
      crossTenantIncidentGuardEnforced: true,
      terminalIncidentClosureParity: true,
      reviewIncidentLockParity: true,
      missionFulfillmentMutation: true,
      checkoutMutation: false,
      orderSubmissionMutation: false,
      spendReservationMutationDeferred: true,
      atomicJobLifecycleAuditOutbox: true,
      databaseOwnedTimestamps: true,
      deviceCapabilityRevalidation: false,
      sqliteValidationParity: true,
      sourceTrustWriterParity: true,
      sourceStatusWriterParity: true,
      sourceSyncWriterParity: true,
      catalogImportWriterParity: true,
      connectionProvisioningWriterParity: true,
      sourceWriterParity: true,
      retailerQualificationWriterParity: true,
      missionPolicyWriterParity: true,
      settingsWriterParity: false,
      configurationWriterParity: false,
      reservationWriterParity: true,
      attributionPolicyParity: true,
      jobLifecycleWriterParity: true,
      writerLockProtocolParity: false,
      actionAuthority: false,
      checkoutAuthority: false,
      orderSubmissionAuthority: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalJobLifecycleCapabilityProjection():
PostgresSignalJobLifecycleCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalJobLifecycleApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    attributionPolicyApplyContractVersion: 1,
    deterministicManifestImplemented: true,
    atomicQualificationApplyImplemented: true,
    exactEffectivePrivilegeVerification: true,
    immutableBoundaryCatalogFingerprint: true,
    qualificationSuiteParity: true,
    noLogin: true,
    noInherit: true,
    noBypassRls: true,
    securityDefinerRoutineVerified: true,
    phase: "qualified_inactive",
    serverBoundPrincipalLookup: true,
    writerLockProtocolConsumed: true,
    spendScopeConsumed: true,
    deterministicRequestIdentity: true,
    immutableTransitionReplay: true,
    lifecycleAwareOutboxReplay: true,
    currentJobOwnershipRevalidation: true,
    expectedCurrentStateRevalidation: true,
    legalTransitionTableEnforced: true,
    possibleMutationCancelGuardEnforced: true,
    crossTenantIncidentGuardEnforced: true,
    terminalIncidentClosureParity: true,
    reviewIncidentLockParity: true,
    missionFulfillmentMutation: true,
    checkoutMutation: false,
    orderSubmissionMutation: false,
    spendReservationMutationDeferred: true,
    atomicJobLifecycleAuditOutbox: true,
    databaseOwnedTimestamps: true,
    deviceCapabilityRevalidation: false,
    sqliteValidationParity: true,
    sourceTrustWriterParity: true,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: true,
    catalogImportWriterParity: true,
    connectionProvisioningWriterParity: true,
    sourceWriterParity: true,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: true,
    attributionPolicyParity: true,
    jobLifecycleWriterParity: true,
    writerLockProtocolParity: false,
    operationCount: 1,
    jobStateCount: 19,
    legalTransitionCount: 47,
    mutationRiskStateCount: 8,
    protectedTenantTableCount: 8,
    forcedRlsTableCount: 8,
    mutationTableCount: 6,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: true,
    jobLifecycleMutationAuthority: true,
    actionAuthority: false,
    checkoutAuthority: false,
    orderSubmissionAuthority: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

export type PostgresSignalJobLifecycleApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalJobLifecycleApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalJobLifecycleApplyManifest()
): Promise<PostgresSignalJobLifecycleApplyQualificationReceipt> {
  await verifyPostgresSignalAttributionPolicyApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalAttributionPolicyApplyManifest
  );
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalJobLifecycleApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalJobLifecycleApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalJobLifecycleApplyQualificationReceipt> {
  await verifyPostgresSignalAttributionPolicyApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalAttributionPolicyApplyManifest
  );
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      `The PostgreSQL job-lifecycle ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalJobLifecycleOperation,
  requestId: string
): PostgresSignalJobLifecycleApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      "The PostgreSQL job-lifecycle result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const outcome = String(result.outcome ?? "");
  const job = result.job;
  const incident = result.incident;
  const mission = result.mission;
  const applied = outcome === "applied";
  const validCount = (entry: unknown): boolean =>
    Number.isSafeInteger(entry) && Number(entry) >= 0 && Number(entry) <= 6;
  if (result.contractVersion !== 1
    || result.operation !== operation
    || result.requestId !== requestId
    || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "already_applied"]).has(outcome)
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || result.mutationApplied !== applied
    || result.idempotentReplay !== !applied
    || !validCount(result.mutationStatementCount)
    || !validCount(result.mutationRowCount)
    || (applied && (result.mutationStatementCount !== result.mutationRowCount
      || Number(result.mutationStatementCount) < 4))
    || (!applied && (result.mutationStatementCount !== 0 || result.mutationRowCount !== 0))
    || typeof result.jobMutated !== "boolean"
    || typeof result.actionEventMutated !== "boolean"
    || typeof result.incidentMutated !== "boolean"
    || typeof result.missionMutated !== "boolean"
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || result.jobMutated !== applied
    || result.actionEventMutated !== applied
    || result.auditMutated !== applied
    || result.outboxMutated !== applied
    || (applied && result.missionMutated === true && result.incidentMutated !== true)
    || (applied && Number(result.mutationStatementCount)
      !== 4 + (result.incidentMutated ? 1 : 0) + (result.missionMutated ? 1 : 0))
    || (!applied && (result.incidentMutated !== false || result.missionMutated !== false))
    || !job || typeof job !== "object" || Array.isArray(job)
    || (incident !== null && (!incident || typeof incident !== "object" || Array.isArray(incident)))
    || (mission !== null && (!mission || typeof mission !== "object" || Array.isArray(mission)))
    || result.sourceSyncWriterParity !== true
    || result.sourceWriterParity !== true
    || result.retailerQualificationWriterParity !== true
    || result.missionPolicyWriterParity !== true
    || result.configurationWriterParity !== false
    || result.reservationWriterParity !== true
    || result.attributionPolicyParity !== true
    || result.jobLifecycleWriterParity !== true
    || result.writerLockProtocolParity !== false
    || result.mutationAuthority !== true
    || result.jobLifecycleMutationAuthority !== true
    || result.actionAuthority !== false
    || result.checkoutAuthority !== false
    || result.orderSubmissionAuthority !== false
    || result.runtimeAuthority !== false) {
    throw new PostgresSignalJobLifecycleApplyQualificationError(
      "The PostgreSQL job-lifecycle result contract changed."
    );
  }
  return result as unknown as PostgresSignalJobLifecycleApplyResult;
}

export class NodePostgresSignalJobLifecycleApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalJobLifecycleApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalJobLifecycleApplyManifest(),
    options: NodePostgresSignalJobLifecycleApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalJobLifecycleApplyQualificationError(
        "The PostgreSQL job-lifecycle connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_job_lifecycle"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_signal_job_lifecycle");
  }

  async transitionJob(
    principal: BackgroundWorkerPrincipal,
    operationValue: PostgresSignalJobLifecycleOperation,
    requestIdValue: string,
    requestPayload: PostgresSignalJobLifecycleTransitionPayload
  ): Promise<PostgresSignalJobLifecycleApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation = String(operationValue ?? "") as PostgresSignalJobLifecycleOperation;
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (operation !== "transition_job"
      || !REQUEST_ID.test(requestId)
      || requestId !== buildPostgresSignalJobLifecycleTransitionRequestId(
        { tenantId, userId },
        requestPayload
      )
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalJobLifecycleApplyQualificationError(
        "The PostgreSQL job-lifecycle apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.jobLifecycleRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalJobLifecycleApplyQualificationError(
          "The PostgreSQL job-lifecycle function returned an ambiguous result."
        );
      }
      const parsed = parseFunctionResult(result.rows[0].resultJson, operation, requestId);
      await client.query("COMMIT");
      return parsed;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroyed = true;
        client.release(true);
      }
      throw error;
    } finally {
      if (!destroyed) client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
