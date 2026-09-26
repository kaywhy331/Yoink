import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { cleanText } from "../../domain/src/normalize.js";
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
  POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONTRACT_VERSION,
  buildPostgresSignalDeadLetterResetApplyManifest,
  verifyPostgresSignalDeadLetterResetApplyBoundary,
  type PostgresSignalDeadLetterResetApplyManifest
} from "./postgres-signal-dead-letter-reset-apply.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

/**
 * PostgreSQL bounded notification-delivery ENSURE writer -- closes the last
 * unqualified write this repository's own accounting has ever named:
 * `NotificationRepository.ensureForJob`. Every prior rung deferred it
 * explicitly rather than covering it:
 * `postgres-signal-evaluation-composition.ts` (rung-1) calls it
 * "handler-level, not repository" in its own out-of-scope list;
 * `postgres-signal-evaluation-repository-composition.ts` (rung-2) repeats
 * that verdict verbatim; `postgres-notification-recovery.ts` is
 * grep-confirmed UPDATE-only against `notification_deliveries` (it
 * reproduces `NotificationRepository.recoverExpired`'s `notification_
 * recovery` TASK-KIND dispatch, never an `INSERT INTO notification_
 * deliveries`); and `postgres-signal-handler-composition.ts` -- the final
 * composition rung, which closes `allHandlerRepositoryParity` itself --
 * names it in as many words as out-of-scope item 1: "This write is
 * genuinely UNQUALIFIED, and remains so after this module. ... an orphaned
 * THIRD scope no flag in this repository -- including
 * hostedDeliveryHandlerRepositoryParity/allHandlerRepositoryParity -- has
 * ever promised to cover." This module is that missing writer. Every fact
 * below was read out of the actual source, not assumed.
 *
 * ---------------------------------------------------------------------
 * 1. SQLITE TRUTH (`NotificationRepository.ensureForJob`,
 *    packages/database/src/notification-repository.ts:77-96, and its ONE
 *    caller `SignalRepository.createActionJob`,
 *    packages/database/src/signal-repository.ts:433-657, specifically
 *    lines 592-638)
 * ---------------------------------------------------------------------
 *   `ensureForJob(jobId, now)`:
 *
 *     1. `SELECT tenant_id, user_id, action FROM action_jobs WHERE id = ?
 *        AND user_id = ?` -- `cleanText(jobId, 160)`,
 *        `currentRequestScope().userId`. Note this WHERE clause omits
 *        `tenant_id` entirely, unlike almost every other ownership query in
 *        this repository; see section 5.
 *     2. `if (!job || job.action !== "notify") return;` -- a SILENT VOID
 *        return: no error, no write, nothing. This branch is unreachable in
 *        every real invocation; see section 2.
 *     3. `INSERT OR IGNORE INTO notification_deliveries(id, tenant_id,
 *        user_id, job_id, state, created_at, updated_at) VALUES
 *        (newId("notification"), job.tenant_id ||
 *        currentRequestScope().tenantId, job.user_id ||
 *        currentRequestScope().userId, jobId, 'pending', timestamp,
 *        timestamp)`. `notification_deliveries` carries `UNIQUE(job_id)`
 *        (migrations.ts:553), so this is a true INSERT-OR-IGNORE on that
 *        key.
 *
 *   True SQLite write set: EXACTLY ONE statement -- the INSERT -- on the
 *   fresh path, and ZERO on the ignored-duplicate path. Unlike EVERY other
 *   writer qualified in this repository so far, `ensureForJob` NEVER calls
 *   `AuditRepository.record` or appends anything to `audit_events`/
 *   `outbox_events`, on either path -- grep-confirmed: no `this.audit(...)`
 *   or `AuditRepository` reference exists anywhere in
 *   `notification-repository.ts`. This module's own accounting says so
 *   honestly (`noAuditOrOutboxWrite: true` below) rather than fabricating an
 *   audit trail SQLite itself never writes.
 *
 *   `ensureForJob`'s ONE caller, `SignalRepository.createActionJob`
 *   (signal-repository.ts:637), invokes it only inside the `if (created)`
 *   block (`created` means the `INSERT OR IGNORE INTO action_jobs` two
 *   statements earlier actually inserted a NEW row, never a replayed
 *   idempotency-key lookup) and only when `effectiveAction === "notify"`
 *   (line 636). Grep-confirmed across every `.ts` file in this repository:
 *   `signal-repository.ts:637` is `ensureForJob`'s ONLY call site anywhere.
 *   `AttributionRepository.recordReceipt` -- already qualified by
 *   `postgres-signal-attribution-receipt-apply.ts` -- is the very next
 *   statement in the SAME `if (created)` block, one line later
 *   (signal-repository.ts:639); this module is that boundary's direct
 *   sibling in every structural sense (same trigger point, same
 *   `UNIQUE(job_id)` INSERT-OR-IGNORE idempotency shape, same "read the
 *   caller's job row, never trust it blind" design) even though its own
 *   PREDECESSOR chain (section below) is `postgres-signal-dead-letter-
 *   reset-apply.ts`, per explicit instruction.
 *
 *   Critical invariant, read out of `createActionJob` in full
 *   (signal-repository.ts:489-491): `state = effectiveAction === "notify"
 *   ? "notify_only" : ...` -- computed BEFORE the `action_jobs` INSERT, and
 *   used AS the inserted row's own `state` column value. Since
 *   `ensureForJob` is only ever invoked when `effectiveAction === "notify"`
 *   (the same condition that produced `state = "notify_only"` moments
 *   earlier in the SAME synchronous call), the freshly created job's
 *   `state` column is ALWAYS exactly `'notify_only'` at the instant
 *   `ensureForJob` reads it back -- even though `ensureForJob`'s own SQL
 *   never checks `state` at all. Nothing can mutate `action_jobs.state`
 *   between the INSERT and this read: `SignalRepository.transitionJob` is
 *   the only method anywhere that ever mutates that column
 *   (`postgres-signal-job-lifecycle-apply.ts`'s own header confirms
 *   `transitionJob` "never calls `NotificationRepository`"), and
 *   `createActionJob` never calls `transitionJob` on the job it just
 *   created.
 *
 * ---------------------------------------------------------------------
 * 2. PRECONDITIONS AND IDEMPOTENCY
 * ---------------------------------------------------------------------
 *   SQLite's own `!job || job.action !== "notify"` branch is a silent
 *   no-op specifically BECAUSE `ensureForJob`'s general signature is wider
 *   than its one real call graph -- but that branch is provably dead code
 *   in production (section 1). This boundary narrows to the one real call
 *   pattern and treats a job that fails ownership, `action`, or the
 *   `state` invariant as a FAIL-CLOSED precondition violation instead of
 *   reproducing an unreachable silent no-op -- the identical "narrow to the
 *   one real call graph" choice `postgres-signal-dead-letter-reset-apply.ts`'s
 *   own `hardcodedEventType` and `postgres-signal-ingress-enqueue-apply.ts`'s
 *   hardcoded `source`/`eventType` already make (`jobOwnershipRevalidated`,
 *   `notifyActionPreconditionEnforced`, `notifyOnlyStatePreconditionEnforced`
 *   below).
 *
 *   Idempotency follows `postgres-signal-attribution-receipt-apply.ts`'s
 *   `insertOrIgnoreReplayParity` design, NOT the audited-replay-graph
 *   pattern most other siblings use: `notification_deliveries` carries
 *   `UNIQUE(job_id)`, exactly like `attribution_receipts`, and SQLite's own
 *   `INSERT OR IGNORE` performs NO comparison at all against the values a
 *   second call would have inserted -- it just does nothing. A delivery
 *   already ensured for a job is therefore an unconditional zero-write
 *   success here too, with no re-validation of the submitted request
 *   against anything (there is, in fact, nothing in the payload BESIDES the
 *   job id to compare -- see section 3).
 *
 *   One genuine divergence from `attribution_receipts`: that table is
 *   truly immutable once written (nothing else in this repository ever
 *   mutates a receipt row), so its replay path can safely echo the
 *   creation-time snapshot verbatim (`immutableReceiptReplay`).
 *   `notification_deliveries` is NOT immutable --
 *   `NotificationRepository.leaseNext`/`.acknowledge`/`.recordInteraction`/
 *   `.recoverExpired` (and their already-qualified PostgreSQL counterpart,
 *   `postgres-notification-recovery.ts`) all advance a delivery's `state`/
 *   `attempts`/`assigned_device_id`/etc. long after `ensureForJob` first
 *   creates it. This boundary's replay path therefore reads back and
 *   echoes the row's CURRENT LIVE `state`/`attempts`/`updated_at` exactly
 *   as they stand at replay time, never a hardcoded `'pending'` -- still an
 *   honest zero-write success (this call itself mutates nothing either
 *   way), just not a claim of unchanged-since-creation immutability
 *   (`mutableDeliveryStateReplayEcho: true` below, the deliberate inverse
 *   of `immutableReceiptReplay`).
 *
 * ---------------------------------------------------------------------
 * 3. WHAT THIS BOUNDARY ACCEPTS VS. DERIVES VS. HARDCODES
 * ---------------------------------------------------------------------
 *   Accepted from the caller: `actionJobId` ONLY -- the entire payload is a
 *   single field plus the fixed confirmation literal. Bounded by the exact
 *   same broad shape `postgres-signal-attribution-receipt-apply.ts` already
 *   uses for the identical field (`cleanText(jobId, 160)`'s own real bound,
 *   `/^[A-Za-z0-9_-]{3,160}$/` -- not the narrower `action_job_<32 hex>`
 *   shape every real id happens to carry today, for the same
 *   "don't-be-more-restrictive-than-SQLite" reasoning every sibling in this
 *   family gives).
 *
 *   Derived server-side and NEVER trusted from the caller: `tenant_id`/
 *   `user_id` (read from the already-owned, locked `action_jobs` row --
 *   reproducing the INTENT of SQLite's `job.tenant_id ||
 *   currentRequestScope().tenantId` / `job.user_id ||
 *   currentRequestScope().userId` fallback expressions without their dead
 *   left-hand branches; see section 5), the delivery `id` (a deterministic
 *   substitute for SQLite's random `newId("notification")`, the same
 *   substitution every sibling in this family makes for its own random
 *   ids), and `created_at`/`updated_at` (database-owned write timestamp,
 *   substituting for SQLite's `nowIso(now)` the same way every sibling's
 *   `databaseOwnedTimestamps` does).
 *
 *   Hardcoded, never caller input: `state = 'pending'` -- the one literal
 *   SQLite's own INSERT hardcodes too.
 *
 *   Unlike `postgres-signal-attribution-receipt-apply.ts`'s
 *   `canonical_url_hash` and `postgres-signal-dead-letter-reset-apply.ts`'s
 *   `receipt_hash` (both of which reproduce the REAL, trailing-pipe-
 *   terminated `stableHash` algorithm from `domain/src/ids.ts` because each
 *   is compared byte-for-byte against a value the real SQLite call also
 *   computes), this boundary has no such downstream `stableHash`-derived
 *   business value at all -- `capability_hash` is `leaseNext`'s concern,
 *   not `ensureForJob`'s, and the delivery `id` substituting for
 *   `newId(...)` is an internal identifier never compared against any
 *   `stableHash(...)` call in TypeScript. The ONLY member of the
 *   `stableHash` family this module touches is its OWN request identity,
 *   which -- like EVERY sibling's own request id, including
 *   `attribution_receipt_record_...` and `dead_letter_reset_...` -- uses
 *   the separator-only `stableHashInput` convention (parts joined with
 *   `'|'`, NO trailing pipe), never the trailing-pipe `stableHash`
 *   convention those two OTHER, business-value hashes use. The two
 *   conventions are never conflated below.
 *
 * ---------------------------------------------------------------------
 * 4. WRITER-LOCK PROTOCOL AND FK AUDIT
 * ---------------------------------------------------------------------
 *   `notification_deliveries`/`action_jobs` are not one of the five domains
 *   `postgres-signal-writer-lock-protocol.ts` guards (`source |
 *   retailer_qualification | settings | mission_policy | spend` --
 *   `PROTECTED_TENANT_TABLES` = app_settings, mission_intent_revisions,
 *   missions, retailer_adapter_qualifications, source_connections,
 *   spend_reservations, user_spend_policies). This is the SAME posture
 *   `postgres-notification-recovery.ts` already documents for the same
 *   table. This boundary never calls it; per-job serialization comes from
 *   `SELECT ... FOR UPDATE OF job` on the one `action_jobs` row this call
 *   touches, plus `UNIQUE(job_id)` + `ON CONFLICT (job_id) DO NOTHING` for
 *   the delivery insert itself -- the identical backstop
 *   `postgres-signal-attribution-receipt-apply.ts` uses.
 *
 *   FK audit (migrations.ts:537-554): `notification_deliveries.tenant_id`
 *   is `ON DELETE CASCADE` (tenants), `.user_id` is `ON DELETE CASCADE`
 *   (users), `.job_id` is `ON DELETE CASCADE` (action_jobs) -- none can
 *   silently orphan a row this function is inserting, since the owning
 *   `action_jobs` row is locked (`FOR UPDATE OF job`) for the whole
 *   transaction. `.assigned_device_id` is `ON DELETE SET NULL`
 *   (extension_devices) but is never referenced by this writer's INSERT
 *   column list at all -- it is left at its table default (NULL), exactly
 *   as SQLite's own INSERT (which also omits it) does. `action_jobs`'
 *   own FKs (`mission_id`/`mission_target_id`/`incident_id` all `ON DELETE
 *   RESTRICT`, `listing_id` `ON DELETE RESTRICT`) cannot dangle under this
 *   writer's own lock either, though this writer reads none of them.
 *
 * ---------------------------------------------------------------------
 * 5. JUDGMENT CALLS FOR REVIEWER SCRUTINY
 * ---------------------------------------------------------------------
 *   - SQLite's own `SELECT tenant_id, user_id, action FROM action_jobs
 *     WHERE id = ? AND user_id = ?` omits `tenant_id` from its WHERE
 *     clause entirely -- unusual for this repository, where almost every
 *     other ownership query filters on both. This boundary's own
 *     `action_jobs` lookup adds `tenant_id = resolved_tenant_id` anyway,
 *     the same defense-in-depth every sibling job-ownership check in this
 *     family already applies (e.g. `postgres-signal-attribution-receipt-
 *     apply.ts`'s identical `action_jobs` join). This is provably a no-op
 *     narrowing, not a behavior change: `users.id` is a global PRIMARY KEY
 *     with exactly one, immutable, `NOT NULL` `tenant_id` FK
 *     (migrations.ts:19-21) and `action_jobs.tenant_id`/`.user_id` are
 *     ALWAYS written together from the SAME `currentRequestScope()` call at
 *     job-creation time (signal-repository.ts:554-555) -- so once
 *     `job.user_id` matches `resolved_user_id` (itself derived from the
 *     SAME `users` row via the tenant-session principal lookup),
 *     `job.tenant_id` can never legitimately disagree with
 *     `resolved_tenant_id`. The identical reasoning covers the dead
 *     `job.tenant_id || currentRequestScope().tenantId` / `job.user_id ||
 *     currentRequestScope().userId` fallback expressions in SQLite's own
 *     code: `tenant_id`/`user_id` are both `NOT NULL` columns, so the `||`
 *     right-hand branch is unreachable and is not reproduced here.
 *   - `job.state = 'notify_only'` is NOT a check SQLite's own
 *     `ensureForJob` code performs anywhere -- it is derived from the
 *     surrounding call-graph invariant (section 1) and enforced
 *     defensively, the same "narrow to the one real call pattern" choice
 *     every hardcoded literal in this family already makes (compare
 *     `postgres-signal-dead-letter-reset-apply.ts`'s `hardcodedEventType`).
 *     Flagged explicitly rather than silently gold-plated: should a FUTURE
 *     caller ever invoke `ensureForJob` from a second call site against a
 *     job not freshly sitting in `notify_only` (none exists today,
 *     grep-confirmed single call site), that caller would newly diverge
 *     from this boundary's own precondition -- an honest, documented risk
 *     of scope-narrowing to today's real call graph, not a silent gap.
 *   - `noAuditOrOutboxWrite: true` is the first claim of its kind in this
 *     family -- every other qualified writer here appends to
 *     `audit_events` at least conditionally. This is not an omission; it
 *     is the literal SQLite truth for this one write (section 1).
 *   - The "already ensured" replay path performs literally no comparison
 *     against the caller's submitted payload for the same reason
 *     `attribution_receipts`' replay path does not: the payload carries
 *     nothing besides the job id itself, so there is nothing else TO
 *     compare.
 */

export const POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_RECEIPT_TABLE =
  "yoink_signal_notification_ensure_apply_receipt";
export const POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_FUNCTION =
  "yoink_apply_signal_notification_ensure";
export const POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_CONFIRMATION =
  "NOTIFICATION_ENSURE_V1";

/** Mirrors `createActionJob`'s own `if (effectiveAction === "notify")`
 * guard (signal-repository.ts:636) -- `ensureForJob`'s ONE real caller
 * never invokes it for any other action; see module header SS1/SS2. */
export const POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_ACTION = "notify";
/** Mirrors the `state = "notify_only"` invariant every real call graph
 * guarantees but `ensureForJob`'s own SQL never checks explicitly; see
 * module header SS1/SS5. */
export const POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_STATE = "notify_only";
/** Mirrors `ensureForJob`'s own hardcoded INSERT literal
 * (notification-repository.ts:88). */
export const POSTGRES_SIGNAL_NOTIFICATION_ENSURE_DELIVERY_STATE = "pending";

const MAXIMUM_REQUEST_PAYLOAD_BYTES = 512;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
/** Mirrors `cleanText(jobId, 160)`'s own real bound (notification-
 * repository.ts:80) -- not the narrower `action_job_<32 hex>` shape every
 * real id happens to carry today (module header SS3). */
const SAFE_ID = /^[A-Za-z0-9_-]{3,160}$/;
const REQUEST_ID = /^notification_ensure_[a-f0-9]{32}$/;
/** Shape of every id this boundary itself generates (a fixed literal
 * prefix plus 32 lowercase hex characters) -- structurally identical to
 * `newId("notification")`'s own real shape (`<prefix>_` + a dash-stripped
 * v4 UUID's 32 hex digits), so this pattern also validates a row this
 * boundary is REPLAYING that was originally inserted by real SQLite/
 * cutover-migrated data. */
const NOTIFICATION_ID = /^notification_[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
/** The full `notification_deliveries.state` CHECK-constraint enum
 * (migrations.ts:543-544). */
const DELIVERY_STATES = new Set([
  "pending", "leased", "delivered", "clicked", "dismissed", "failed", "expired"
]);
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text"
] as const);
const FUNCTION_ARGUMENTS_SQL = `
  expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
  request_id TEXT, request_payload_json TEXT
`;
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
/**
 * `action_jobs` is read (and row-locked) but never mutated by this
 * boundary -- it is still a tenant-scoped RLS-protected table the
 * function's SQL touches, so it belongs here even though it is absent
 * from `MUTATION_TABLES`.
 */
const PROTECTED_TENANT_TABLES = Object.freeze(["action_jobs", "notification_deliveries"] as const);
const MUTATION_TABLES = Object.freeze(["notification_deliveries"] as const);

export type PostgresSignalNotificationEnsureOperation = "ensure_notification_delivery";

export interface PostgresSignalNotificationEnsurePayload {
  actionJobId: string;
  confirmation: typeof POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_CONFIRMATION;
}

export interface PostgresSignalNotificationEnsureSnapshot {
  id: string;
  jobId: string;
  state: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface PostgresSignalNotificationEnsureApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  deadLetterResetApplyContractVersion: 1;
  schemaName: string;
  notificationEnsureRoleNamespace: string;
  deadLetterResetApplyManifestFingerprint: string;
  /** The FULL dead-letter-reset-apply manifest -- not a `Pick`, matching
   * that module's own choice to embed job-lifecycle-apply's FULL manifest
   * (documented in that module's own header SS"predecessorManifest" doc as
   * a deliberate improvement over this family's earlier `Pick`-based
   * predecessor fields). Embedding the full object lets anything chaining
   * onto THIS module's own manifest later walk the whole predecessor chain
   * mechanically, and lets `verify`/`apply` below call
   * `verifyPostgresSignalDeadLetterResetApplyBoundary` directly, with no
   * cast. */
  predecessorManifest: PostgresSignalDeadLetterResetApplyManifest;
  notificationEnsureRole: {
    kind: "signal_notification_ensure_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 1;
  requiredJobAction: typeof POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_ACTION;
  requiredJobState: typeof POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_STATE;
  hardcodedDeliveryState: typeof POSTGRES_SIGNAL_NOTIFICATION_ENSURE_DELIVERY_STATE;
  protectedTenantTableCount: 2;
  forcedRlsTableCount: 2;
  mutationTableCount: 1;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  jobOwnershipRevalidated: true;
  notifyActionPreconditionEnforced: true;
  notifyOnlyStatePreconditionEnforced: true;
  deterministicRequestIdentity: true;
  insertOrIgnoreReplayParity: true;
  mutableDeliveryStateReplayEcho: true;
  noAuditOrOutboxWrite: true;
  databaseOwnedTimestamps: true;
  deterministicDeliveryIdentity: true;
  writerLockProtocolConsumed: false;
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
  deadLetterResetWriterParity: true;
  // Closes `NotificationRepository.ensureForJob` -- named in as many words
  // as out-of-scope item 1 in
  // `POSTGRES_SIGNAL_HANDLER_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES`
  // (postgres-signal-handler-composition.ts), the last write that
  // module's own final composition rung left "genuinely UNQUALIFIED".
  notificationEnsureWriterParity: true;
  // Honestly false: a single writer module does not, by itself, complete
  // any composition-level scope -- only a future composition rung that
  // binds this module in could ever flip these, the same discipline
  // `postgres-signal-dead-letter-reset-apply.ts`'s own header documents for
  // the identical fields.
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalNotificationEnsureCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  deadLetterResetApplyContractVersion: 1;
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
  jobOwnershipRevalidated: true;
  notifyActionPreconditionEnforced: true;
  notifyOnlyStatePreconditionEnforced: true;
  deterministicRequestIdentity: true;
  insertOrIgnoreReplayParity: true;
  mutableDeliveryStateReplayEcho: true;
  noAuditOrOutboxWrite: true;
  databaseOwnedTimestamps: true;
  deterministicDeliveryIdentity: true;
  writerLockProtocolConsumed: false;
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
  deadLetterResetWriterParity: true;
  notificationEnsureWriterParity: true;
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  operationCount: 1;
  protectedTenantTableCount: 2;
  forcedRlsTableCount: 2;
  mutationTableCount: 1;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalNotificationEnsureApplyResult {
  contractVersion: 1;
  operation: PostgresSignalNotificationEnsureOperation;
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  notificationDeliveryMutated: boolean;
  delivery: PostgresSignalNotificationEnsureSnapshot;
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
  deadLetterResetWriterParity: true;
  notificationEnsureWriterParity: true;
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  mutationAuthority: true;
  runtimeAuthority: false;
}

export interface NodePostgresSignalNotificationEnsureApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalNotificationEnsureCapabilityProjection> | null = null;

export class PostgresSignalNotificationEnsureApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalNotificationEnsureApplyQualificationError";
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
    throw new PostgresSignalNotificationEnsureApplyQualificationError(
      "The PostgreSQL notification-ensure schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalNotificationEnsureApplyQualificationError(
      "The PostgreSQL notification-ensure role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_notification_ensure`;
  if (value.length > 63) {
    throw new PostgresSignalNotificationEnsureApplyQualificationError(
      "The PostgreSQL notification-ensure role name exceeds PostgreSQL's limit."
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

function stableHashInput(parts: string[]): string {
  return parts.map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`).join("|");
}

/** SQL translation of `stableHashInput`/`stableHash` (domain/src/ids.ts):
 * each part contributes its UTF-8 byte length, ':', and the part itself,
 * joined with '|' -- byte-for-byte identical to the TypeScript helper. This
 * boundary uses ONLY the separator-only `stableHashInput` convention (for
 * its own request identity) and never the trailing-pipe `stableHash`
 * convention -- see module header SS3 for why it has no downstream
 * business value needing the latter. */
function stableHashInputSql(parts: string[]): string {
  return parts.map((part) => (
    `pg_catalog.octet_length(${part})::text || ':' || ${part}`
  )).join(" || '|' || ");
}

/**
 * Normalizes a `jobId` -- exactly the SQLite `NotificationRepository.
 * ensureForJob(jobId, now)` signature minus `now` (the database owns its
 * own write timestamp; `databaseOwnedTimestamps` below) -- into the payload
 * shape the PostgreSQL boundary function accepts.
 */
export function normalizedPostgresSignalNotificationEnsurePayload(
  jobId: string
): PostgresSignalNotificationEnsurePayload {
  const actionJobId = cleanText(jobId, 160);
  if (!SAFE_ID.test(actionJobId)) {
    throw new PostgresSignalNotificationEnsureApplyQualificationError(
      "The PostgreSQL notification-ensure action job id is invalid."
    );
  }
  return { actionJobId, confirmation: POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_CONFIRMATION };
}

/**
 * Derives the deterministic request id from the principal and the complete
 * normalized payload, matching `postgres-signal-attribution-receipt-
 * apply.ts`'s "derive-and-compare-in-SQL" pattern -- this payload, unlike
 * job-lifecycle-apply's arbitrary `evidence`, is flat and fully
 * re-derivable byte-for-byte in PL/pgSQL.
 */
export function buildPostgresSignalNotificationEnsureRequestId(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  payload: PostgresSignalNotificationEnsurePayload
): string {
  const parts = [
    "postgres-signal-notification-ensure-request-v1",
    String(principal?.tenantId ?? ""),
    String(principal?.userId ?? ""),
    String(payload?.actionJobId ?? ""),
    String(payload?.confirmation ?? "")
  ];
  return `notification_ensure_${createHash("sha256")
    .update(stableHashInput(parts)).digest("hex").slice(0, 32)}`;
}

export function buildPostgresSignalNotificationEnsureApplyManifest(
  predecessorManifest = buildPostgresSignalDeadLetterResetApplyManifest(),
  requestedRoleNamespace = "yoink_notification_ensure_qual"
): PostgresSignalNotificationEnsureApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const notificationEnsureRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (collectRoleNamespaces(predecessorManifest).has(notificationEnsureRoleNamespace)) {
    throw new PostgresSignalNotificationEnsureApplyQualificationError(
      "The PostgreSQL notification-ensure role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalNotificationEnsureApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    deadLetterResetApplyContractVersion: POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONTRACT_VERSION,
    schemaName,
    notificationEnsureRoleNamespace,
    deadLetterResetApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    notificationEnsureRole: {
      kind: "signal_notification_ensure_apply_boundary",
      name: roleName(notificationEnsureRoleNamespace),
      functionName: POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 1,
    requiredJobAction: POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_ACTION,
    requiredJobState: POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_STATE,
    hardcodedDeliveryState: POSTGRES_SIGNAL_NOTIFICATION_ENSURE_DELIVERY_STATE,
    protectedTenantTableCount: 2,
    forcedRlsTableCount: 2,
    mutationTableCount: 1,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    jobOwnershipRevalidated: true,
    notifyActionPreconditionEnforced: true,
    notifyOnlyStatePreconditionEnforced: true,
    deterministicRequestIdentity: true,
    insertOrIgnoreReplayParity: true,
    mutableDeliveryStateReplayEcho: true,
    noAuditOrOutboxWrite: true,
    databaseOwnedTimestamps: true,
    deterministicDeliveryIdentity: true,
    writerLockProtocolConsumed: false,
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
    deadLetterResetWriterParity: true,
    notificationEnsureWriterParity: true,
    signalIngressRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    allHandlerRepositoryParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

function commonResultSql(outcome: "applied" | "already_applied", mutated: boolean): string {
  return `pg_catalog.jsonb_build_object(
    'contractVersion', 1, 'operation', operation_name,
    'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
    'outcome', '${outcome}', 'mutationApplied', ${mutated ? "TRUE" : "FALSE"},
    'idempotentReplay', ${mutated ? "FALSE" : "TRUE"},
    'mutationStatementCount', ${mutated ? "1" : "0"},
    'mutationRowCount', ${mutated ? "1" : "0"},
    'notificationDeliveryMutated', ${mutated ? "TRUE" : "FALSE"},
    'delivery', delivery_result_value,
    'sourceTrustWriterParity', TRUE, 'sourceStatusWriterParity', TRUE, 'sourceSyncWriterParity', TRUE,
    'catalogImportWriterParity', TRUE, 'connectionProvisioningWriterParity', TRUE, 'sourceWriterParity', TRUE,
    'retailerQualificationWriterParity', TRUE, 'missionPolicyWriterParity', TRUE,
    'settingsWriterParity', FALSE, 'configurationWriterParity', FALSE, 'reservationWriterParity', TRUE,
    'attributionPolicyParity', TRUE, 'jobLifecycleWriterParity', TRUE, 'writerLockProtocolParity', FALSE,
    'deadLetterResetWriterParity', TRUE, 'notificationEnsureWriterParity', TRUE,
    'signalIngressRepositoryParity', FALSE, 'hostedDeliveryHandlerRepositoryParity', FALSE,
    'allHandlerRepositoryParity', FALSE,
    'mutationAuthority', TRUE, 'runtimeAuthority', FALSE
  )`;
}

export function signalNotificationEnsureApplyFunctionSource(
  manifest = buildPostgresSignalNotificationEnsureApplyManifest()
): string {
  const requestIdentityParts = stableHashInputSql([
    "'postgres-signal-notification-ensure-request-v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "action_job_id_value",
    `'${POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_CONFIRMATION}'::text`
  ]);
  const deliveryResultFields = `
      'id', delivery_row.id, 'jobId', delivery_row.job_id, 'state', delivery_row.state,
      'attempts', delivery_row.attempts, 'createdAt', delivery_row.created_at,
      'updatedAt', delivery_row.updated_at`;
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  derived_request_id TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  action_job_id_value TEXT;
  job_record RECORD;
  delivery_row RECORD;
  notification_id_value TEXT;
  mutation_timestamp TEXT;
  affected_rows BIGINT;
  delivery_result_value JSONB;
  result_value JSONB;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name <> 'ensure_notification_delivery'
    OR request_id !~ '^notification_ensure_[a-f0-9]{32}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal notification-ensure request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal notification-ensure payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR request_payload - ARRAY['actionJobId', 'confirmation']::text[] IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 2
    OR pg_catalog.jsonb_typeof(request_payload->'actionJobId') IS DISTINCT FROM 'string'
    OR request_payload->>'actionJobId' !~ '^[A-Za-z0-9_-]{3,160}$'
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> '${POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_CONFIRMATION}' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal notification-ensure payload shape is invalid';
  END IF;
  action_job_id_value := request_payload->>'actionJobId';

  SELECT MIN(principal.tenant_id), MIN(principal.user_id), COUNT(*)
    INTO resolved_tenant_id, resolved_user_id, resolved_principal_count
  FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)} AS principal
  WHERE principal.principal_role = session_user::text AND principal.active = TRUE;
  IF resolved_principal_count <> 1 OR resolved_tenant_id IS NULL OR resolved_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant session principal is not active';
  END IF;
  IF resolved_tenant_id <> expected_tenant_id OR resolved_user_id <> expected_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant session principal does not match the expected authenticated principal';
  END IF;

  derived_request_id := 'notification_ensure_' || pg_catalog.substr(
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      ${requestIdentityParts}, 'UTF8'
    )), 'hex'), 1, 32
  );
  IF request_id <> derived_request_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal notification-ensure request identity is invalid';
  END IF;
  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(request_payload::text, 'UTF8')
  ), 'hex');

  -- notification_deliveries is UNIQUE(job_id), exactly mirroring SQLite's
  -- INSERT OR IGNORE. A delivery already ensured for this job is a true
  -- zero-write success: unlike attribution_receipts (immutable once
  -- written), this table is LIVE -- leaseNext/acknowledge/recordInteraction/
  -- recoverExpired all advance it after creation -- so the row's CURRENT
  -- state/attempts/updated_at are echoed back exactly as they now stand,
  -- never a stale creation-time snapshot (module header SS2).
  SELECT delivery.id, delivery.job_id, delivery.state, delivery.attempts,
         delivery.created_at, delivery.updated_at
    INTO delivery_row
  FROM ${relation(manifest.schemaName, "notification_deliveries")} AS delivery
  WHERE delivery.job_id = action_job_id_value
    AND delivery.tenant_id = resolved_tenant_id AND delivery.user_id = resolved_user_id;
  IF FOUND THEN
    delivery_result_value := pg_catalog.jsonb_build_object(${deliveryResultFields}
    );
    RETURN QUERY SELECT (${commonResultSql("already_applied", false)})::text;
    RETURN;
  END IF;

  -- Job ownership/tenant revalidation: the one action_jobs row this call is
  -- allowed to touch, locked for the duration of the transaction. SQLite's
  -- own ensureForJob SELECT filters only by (id, user_id) -- omitting
  -- tenant_id entirely (module header SS1/SS5); this boundary adds it
  -- anyway, the same defense-in-depth every sibling job-ownership check in
  -- this family already applies, provably a no-op narrowing here (module
  -- header SS5).
  SELECT job.id, job.action, job.state INTO job_record
  FROM ${relation(manifest.schemaName, "action_jobs")} AS job
  WHERE job.id = action_job_id_value
    AND job.tenant_id = resolved_tenant_id AND job.user_id = resolved_user_id
  FOR UPDATE OF job;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal notification-ensure action job ownership is invalid';
  END IF;

  -- Precondition, fail-closed: mirrors ensureForJob's own
  -- "action <> 'notify' => no-op" check (module header SS1/SS2) PLUS the
  -- state = 'notify_only' invariant every real call graph guarantees but
  -- SQLite's own code never checks explicitly (module header SS5).
  IF job_record.action <> '${POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_ACTION}'
    OR job_record.state <> '${POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_STATE}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal notification-ensure requires a freshly created notify-only action job';
  END IF;

  mutation_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  notification_id_value := 'notification_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_notification_ensure_apply_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || action_job_id_value, 'UTF8'
    )
  ), 'hex'), 1, 32);

  INSERT INTO ${relation(manifest.schemaName, "notification_deliveries")}(
    id, tenant_id, user_id, job_id, state, created_at, updated_at
  ) VALUES (
    notification_id_value, resolved_tenant_id, resolved_user_id, action_job_id_value,
    '${POSTGRES_SIGNAL_NOTIFICATION_ENSURE_DELIVERY_STATE}', mutation_timestamp, mutation_timestamp
  )
  ON CONFLICT (job_id) DO NOTHING;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  IF affected_rows = 0 THEN
    -- Lost a race to a concurrent call for the same job between the replay
    -- check above and this INSERT. Fetch the winner's row (job_id is
    -- UNIQUE) and return the same true zero-write success the top-of-
    -- function replay path returns.
    SELECT delivery.id, delivery.job_id, delivery.state, delivery.attempts,
           delivery.created_at, delivery.updated_at
      INTO STRICT delivery_row
    FROM ${relation(manifest.schemaName, "notification_deliveries")} AS delivery
    WHERE delivery.job_id = action_job_id_value
      AND delivery.tenant_id = resolved_tenant_id AND delivery.user_id = resolved_user_id;
    delivery_result_value := pg_catalog.jsonb_build_object(${deliveryResultFields}
    );
    RETURN QUERY SELECT (${commonResultSql("already_applied", false)})::text;
    RETURN;
  END IF;

  -- Fresh insert: no audit_events/outbox_events write on EITHER path --
  -- ensureForJob's real SQLite write set is a single INSERT OR IGNORE and
  -- nothing else (module header SS1/SS2/SS5, noAuditOrOutboxWrite).
  delivery_result_value := pg_catalog.jsonb_build_object(
    'id', notification_id_value, 'jobId', action_job_id_value,
    'state', '${POSTGRES_SIGNAL_NOTIFICATION_ENSURE_DELIVERY_STATE}', 'attempts', 0,
    'createdAt', mutation_timestamp, 'updatedAt', mutation_timestamp
  );
  result_value := ${commonResultSql("applied", true)};

  RETURN QUERY SELECT result_value::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalNotificationEnsureApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_notification_ensure_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.notificationEnsureRole.name,
    functionName: POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalNotificationEnsureApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_notification_ensure_apply_receipt",
    receiptTriggerName: "yoink_signal_notification_ensure_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.deadLetterResetApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      deadLetterResetApplyContractVersion: 1,
      operationCount: 1,
      requiredJobAction: POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_ACTION,
      requiredJobState: POSTGRES_SIGNAL_NOTIFICATION_ENSURE_REQUIRED_JOB_STATE,
      hardcodedDeliveryState: POSTGRES_SIGNAL_NOTIFICATION_ENSURE_DELIVERY_STATE,
      serverBoundPrincipalLookup: true,
      jobOwnershipRevalidated: true,
      notifyActionPreconditionEnforced: true,
      notifyOnlyStatePreconditionEnforced: true,
      deterministicRequestIdentity: true,
      insertOrIgnoreReplayParity: true,
      mutableDeliveryStateReplayEcho: true,
      noAuditOrOutboxWrite: true,
      databaseOwnedTimestamps: true,
      deterministicDeliveryIdentity: true,
      writerLockProtocolConsumed: false,
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
      deadLetterResetWriterParity: true,
      notificationEnsureWriterParity: true,
      signalIngressRepositoryParity: false,
      hostedDeliveryHandlerRepositoryParity: false,
      allHandlerRepositoryParity: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalNotificationEnsureCapabilityProjection():
PostgresSignalNotificationEnsureCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalNotificationEnsureApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    deadLetterResetApplyContractVersion: 1,
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
    jobOwnershipRevalidated: true,
    notifyActionPreconditionEnforced: true,
    notifyOnlyStatePreconditionEnforced: true,
    deterministicRequestIdentity: true,
    insertOrIgnoreReplayParity: true,
    mutableDeliveryStateReplayEcho: true,
    noAuditOrOutboxWrite: true,
    databaseOwnedTimestamps: true,
    deterministicDeliveryIdentity: true,
    writerLockProtocolConsumed: false,
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
    deadLetterResetWriterParity: true,
    notificationEnsureWriterParity: true,
    signalIngressRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    allHandlerRepositoryParity: false,
    operationCount: 1,
    protectedTenantTableCount: 2,
    forcedRlsTableCount: 2,
    mutationTableCount: 1,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: true,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

export type PostgresSignalNotificationEnsureApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalNotificationEnsureApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalNotificationEnsureApplyManifest()
): Promise<PostgresSignalNotificationEnsureApplyQualificationReceipt> {
  await verifyPostgresSignalDeadLetterResetApplyBoundary(database, manifest.predecessorManifest);
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalNotificationEnsureApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalNotificationEnsureApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalNotificationEnsureApplyQualificationReceipt> {
  await verifyPostgresSignalDeadLetterResetApplyBoundary(database, manifest.predecessorManifest);
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalNotificationEnsureApplyQualificationError(
      `The PostgreSQL notification-ensure ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalNotificationEnsureOperation,
  requestId: string
): PostgresSignalNotificationEnsureApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalNotificationEnsureApplyQualificationError(
      "The PostgreSQL notification-ensure result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const outcome = String(result.outcome ?? "");
  const applied = outcome === "applied";
  const delivery = result.delivery;
  const validDelivery = (entry: unknown): boolean => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const row = entry as Record<string, unknown>;
    return NOTIFICATION_ID.test(String(row.id))
      && SAFE_ID.test(String(row.jobId))
      && DELIVERY_STATES.has(String(row.state))
      && Number.isSafeInteger(row.attempts) && Number(row.attempts) >= 0 && Number(row.attempts) <= 10
      && typeof row.createdAt === "string" && row.createdAt.length > 0
      && typeof row.updatedAt === "string" && row.updatedAt.length > 0
      && (!applied || (row.state === POSTGRES_SIGNAL_NOTIFICATION_ENSURE_DELIVERY_STATE && row.attempts === 0));
  };
  if (result.contractVersion !== 1
    || result.operation !== operation
    || result.requestId !== requestId
    || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "already_applied"]).has(outcome)
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || result.mutationApplied !== applied
    || result.idempotentReplay !== !applied
    || !Number.isSafeInteger(result.mutationStatementCount)
    || Number(result.mutationStatementCount) < 0 || Number(result.mutationStatementCount) > 1
    || !Number.isSafeInteger(result.mutationRowCount)
    || Number(result.mutationRowCount) < 0 || Number(result.mutationRowCount) > 1
    || (applied && (result.mutationStatementCount !== 1 || result.mutationRowCount !== 1))
    || (!applied && (result.mutationStatementCount !== 0 || result.mutationRowCount !== 0))
    || typeof result.notificationDeliveryMutated !== "boolean"
    || result.notificationDeliveryMutated !== applied
    || !validDelivery(delivery)
    || result.sourceTrustWriterParity !== true
    || result.sourceStatusWriterParity !== true
    || result.sourceSyncWriterParity !== true
    || result.catalogImportWriterParity !== true
    || result.connectionProvisioningWriterParity !== true
    || result.sourceWriterParity !== true
    || result.retailerQualificationWriterParity !== true
    || result.missionPolicyWriterParity !== true
    || result.settingsWriterParity !== false
    || result.configurationWriterParity !== false
    || result.reservationWriterParity !== true
    || result.attributionPolicyParity !== true
    || result.jobLifecycleWriterParity !== true
    || result.writerLockProtocolParity !== false
    || result.deadLetterResetWriterParity !== true
    || result.notificationEnsureWriterParity !== true
    || result.signalIngressRepositoryParity !== false
    || result.hostedDeliveryHandlerRepositoryParity !== false
    || result.allHandlerRepositoryParity !== false
    || result.mutationAuthority !== true
    || result.runtimeAuthority !== false) {
    throw new PostgresSignalNotificationEnsureApplyQualificationError(
      "The PostgreSQL notification-ensure result contract changed."
    );
  }
  return result as unknown as PostgresSignalNotificationEnsureApplyResult;
}

export class NodePostgresSignalNotificationEnsureApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalNotificationEnsureApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalNotificationEnsureApplyManifest(),
    options: NodePostgresSignalNotificationEnsureApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalNotificationEnsureApplyQualificationError(
        "The PostgreSQL notification-ensure connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_notification_ensure"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_signal_notification_ensure");
  }

  /**
   * Server-bound principal: the caller is trusted to have already resolved
   * the authenticated (tenant, user) pair the same way every other boundary
   * in this repository does -- `ensureForJob` itself performs no
   * capability/permission check beyond ownership (module header SS1).
   */
  async ensureNotificationDelivery(
    principal: BackgroundWorkerPrincipal,
    requestIdValue: string,
    requestPayload: PostgresSignalNotificationEnsurePayload
  ): Promise<PostgresSignalNotificationEnsureApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation: PostgresSignalNotificationEnsureOperation = "ensure_notification_delivery";
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (!REQUEST_ID.test(requestId)
      || requestId !== buildPostgresSignalNotificationEnsureRequestId({ tenantId, userId }, requestPayload)
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalNotificationEnsureApplyQualificationError(
        "The PostgreSQL notification-ensure apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.notificationEnsureRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_NOTIFICATION_ENSURE_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalNotificationEnsureApplyQualificationError(
          "The PostgreSQL notification-ensure function returned an ambiguous result."
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
