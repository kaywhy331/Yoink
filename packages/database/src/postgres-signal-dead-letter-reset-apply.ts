import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
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
  POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONTRACT_VERSION,
  buildPostgresSignalJobLifecycleApplyManifest,
  verifyPostgresSignalJobLifecycleApplyBoundary,
  type PostgresSignalJobLifecycleApplyManifest
} from "./postgres-signal-job-lifecycle-apply.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

/**
 * PostgreSQL bounded operator dead-letter INBOX-RESET writer -- closes the
 * third of the four write families
 * `postgres-signal-ingress-composition.ts` records in
 * `POSTGRES_SIGNAL_INGRESS_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES`:
 * `HostedDeliveryRepository.retryDeadLetterInbox`'s own inbox-reset/audit
 * write (that module's own §5 item 3, quoted in full below). This is the
 * last unqualified write family that composition module names before its
 * own four-member chain closes -- `retryDeadLetter`'s OTHER write, the
 * `enqueueServiceTask("hosted_delivery_recovery", ...)` task-wake call, was
 * already covered by `tenantQueueWrite`'s `signal_ingress_task_wake` family
 * (composition §2 item (d)); only the inbox-reset/audit half was open.
 * Every fact below was read out of the actual source, not assumed.
 *
 * ---------------------------------------------------------------------
 * 1. SQLITE TRUTH (`HostedDeliveryRepository.retryDeadLetterInbox`,
 *    packages/database/src/hosted-delivery-repository.ts:611-669, read in
 *    full, plus its ONE caller `DurableSignalIngressService.retryDeadLetter`,
 *    packages/engine/src/signal-ingress.ts:121-149, and THAT method's own
 *    caller `apps/api/src/app.ts:1411-1416`)
 * ---------------------------------------------------------------------
 *   `retryDeadLetterInbox(id, eventType, correlationId, now)`:
 *
 *     1. `this.authorization.require("worker.manage")` -- an RBAC check
 *        against `AuthorizationRepository.permissions()`, which joins
 *        `authorization_memberships`/`authorization_role_permissions` for
 *        `currentRequestScope().userId` (authorization-repository.ts:96-126).
 *        See section 5 for why this boundary does not reproduce it in SQL.
 *     2. `SELECT state FROM inbox_messages WHERE id = ? AND tenant_id = ?
 *        AND user_id = ? AND event_type = ?` -- NOT FOUND throws
 *        `HostedDeliveryError("hosted_inbox_not_found", 404, ...)`; FOUND
 *        but `state !== 'dead_letter'` throws
 *        `HostedDeliveryError("hosted_inbox_state_conflict", 409, ...)`.
 *     3. Inside `this.db.transaction(...)`:
 *        a. `UPDATE inbox_messages SET state = 'accepted', delivery_attempts
 *           = 0, lease_capability_hash = '', lease_expires_at = '',
 *           next_attempt_at = '', last_error_code = '', processed_at = '',
 *           updated_at = ? WHERE id = ? AND tenant_id = ? AND user_id = ?
 *           AND event_type = ? AND state = 'dead_letter'` -- if
 *           `changes !== 1` (a race since step 2's read), throws the same
 *           409 conflict, aborting the transaction.
 *        b. `this.recordReceipt("inbox", cleanId, "retry", 0,
 *           "operator_retry", now)` -- one INSERT into
 *           `hosted_delivery_receipts` with `receipt_hash =
 *           stableHash("hosted_delivery_receipt_v1", tenantId, userId,
 *           "inbox", cleanId, "retry", 0, "operator_retry", timestamp)`
 *           (hosted-delivery-repository.ts:720-748).
 *        c. `this.audit.record({ correlationId, aggregateType:
 *           "hosted_inbox", eventType: "signal_inbox_retried", reasonCode:
 *           "operator_retry", message: "A dead-lettered signal message was
 *           reset for bounded worker evaluation.", data: { inboxMessageId:
 *           cleanId, eventType: safeEventType } }, now)` --
 *           `AuditRepository.record` (audit-repository.ts:28-69) appends
 *           BOTH `audit_events` (`correlation_id` = the CALLER'S
 *           `correlationId`, not `cleanId`) AND `outbox_events`
 *           (`aggregate_type = "hosted_inbox"`, `aggregate_id =
 *           correlationId`, SAME `event_type`) in one transaction.
 *     4. Returns `{ id, eventType, attempt: 0, lastErrorCode: "",
 *        receivedAt: <re-SELECTed by id only, no tenant scope -- harmless
 *        since ids are globally unique and ownership was already verified
 *        in step 2>, updatedAt: timestamp, privacyClassification:
 *        "operational_aggregate" }`.
 *
 *   True SQLite write set: FOUR statements -- one `inbox_messages` UPDATE,
 *   one `hosted_delivery_receipts` INSERT, one `audit_events` INSERT, one
 *   `outbox_events` INSERT -- on success; ZERO on the 404/409 fail-closed
 *   paths (both raised before the transaction opens).
 *
 *   `DurableSignalIngressService.retryDeadLetter` wraps this call plus a
 *   SEPARATE `enqueueServiceTask("hosted_delivery_recovery", ...)` call in
 *   its own ambient transaction. Only the FIRST half --
 *   `retryDeadLetterInbox` itself -- is this module's scope; the task-wake
 *   half is `tenantQueueWrite`'s `signal_ingress_task_wake` family (already
 *   qualified). `apps/api/src/app.ts:1411` is `retryDeadLetterInbox`'s only
 *   HTTP-reachable path (route `POST /api/v1/workers/signal-inbox/
 *   (inbox_[a-f0-9]{32})/retry`, app.ts:695) and, grep-confirmed across
 *   every `.ts` file in this repository, `signal-ingress.ts:124` is its
 *   ONLY caller anywhere -- so `eventType` is, in every real invocation,
 *   the hardcoded `SIGNAL_INGRESS_EVENT_TYPE` literal
 *   (contracts/src/signal-ingress.ts:3, `"signal_event_v1"`), exactly the
 *   scope-narrowing choice `postgres-signal-ingress-enqueue-apply.ts`
 *   already made for the mirror-image accept path (its own header §4/§6).
 *
 * ---------------------------------------------------------------------
 * 2. PRECONDITIONS AND IDEMPOTENCY
 * ---------------------------------------------------------------------
 *   Preconditions, fail-closed: the row must exist, be owned by the
 *   resolved (tenant, user), and carry the hardcoded event type
 *   (`inboxOwnershipRevalidated`); its `state` must be exactly
 *   `'dead_letter'` (`deadLetterStatePreconditionEnforced`) -- anything
 *   else (including a message already reset back to `'accepted'`, or one
 *   still `'processing'`/`'failed'`/`'processed'`) fails closed, mirroring
 *   SQLite's 409 exactly.
 *
 *   Unlike `postgres-signal-attribution-receipt-apply.ts`'s `UNIQUE(job_id)`
 *   "INSERT OR IGNORE" idempotency, `inbox_messages`/`hosted_delivery_
 *   receipts` carry no uniqueness constraint that could key replay
 *   detection off the row's own content -- and a dead-lettered message CAN
 *   legitimately be reset, re-fail through `retryInbox`/`recoverExpired
 *   Leases`, dead-letter a SECOND time, and be reset again: nothing in
 *   SQLite prevents this, and no artificial replay window is invented here
 *   to prevent it either (`repeatedResetAfterReDeadLetterAllowed`). This
 *   boundary therefore follows `postgres-signal-job-lifecycle-apply.ts`'s
 *   and `postgres-signal-reservation-lifecycle-apply.ts`'s AUDITED-REPLAY-
 *   GRAPH pattern instead: `audit_id`/`outbox_id`/the receipt's own id are
 *   derived deterministically from `request_id` (substituting for SQLite's
 *   random `newId(...)` calls, the same substitution every sibling in this
 *   family makes); a replay of the exact same `request_id` finds the
 *   already-written `audit_events` row, verifies the full stored graph is
 *   still internally consistent, and returns the ORIGINAL result
 *   unconditionally as a true zero-write success -- it does NOT also
 *   require the CURRENTLY LIVE `inbox_messages` row to still show
 *   `state = 'accepted'` the way job-lifecycle-apply's replay path compares
 *   `current_state_value` against the stored result's own `job.state`. That
 *   extra check is sound for `action_jobs` (a job only ever moves forward
 *   through one lifecycle graph), but WRONG here: the exact same message
 *   legitimately cycling back through `dead_letter` a second time before an
 *   old request happens to be replayed must not raise a spurious
 *   `YK500` replay failure. See section 5 for why `request_id` collision across two
 *   GENUINELY different reset events is not a practical concern.
 *
 *   `audit_events.data_json` (and the outbox `data` sub-field) use this
 *   boundary's own `{contractVersion, operation, requestId,
 *   requestFingerprint, request, result}` replay-wrapper shape -- the SAME
 *   shape job-lifecycle-apply's and reservation-lifecycle-apply's own
 *   `audit_events` rows use for THEIR OWN replay -- rather than SQLite's
 *   own `{ inboxMessageId, eventType }` `data` shape. Both are DIFFERENT
 *   `audit_events` rows serving different purposes even in the live SQLite
 *   code; this wrapper exists to make ITS OWN replay provably safe, not to
 *   mirror SQLite's audit content byte-for-byte -- job-lifecycle-apply's
 *   own header documents the identical choice for the identical reason.
 *
 * ---------------------------------------------------------------------
 * 3. WHAT THIS BOUNDARY ACCEPTS VS. DERIVES VS. HARDCODES
 * ---------------------------------------------------------------------
 *   Accepted from the caller: `inboxMessageId` (validated against
 *   `hosted-delivery-repository.ts`'s own `IDENTIFIER_PATTERN`, the EXACT
 *   bound `deliveryIdentifier(id, "inbox message ID")` enforces -- not the
 *   tighter `inbox_[a-f0-9]{32}` shape every REAL id happens to carry today,
 *   because reproducing a narrower check here would make this boundary
 *   MORE restrictive than the SQLite truth it mirrors, the same reasoning
 *   `postgres-signal-attribution-receipt-apply.ts`'s own header gives for
 *   its `insertOrIgnoreReplayParity` design) and `correlationId` (bounded
 *   1-160 bytes, control-characters stripped and whitespace already
 *   collapsed/trimmed -- `cleanText`'s exact semantics, matching how
 *   job-lifecycle-apply validates `message` for the identical reason: the
 *   SQLite column this value ultimately reaches imposes no character-class
 *   restriction, only `AuditRepository.record`'s own `cleanText(...,
 *   160)`). `eventType` is HARDCODED, never caller input -- see section 1.
 *
 *   Derived server-side and NEVER trusted from the caller: every mutated
 *   column value (`state`, `delivery_attempts`, `lease_capability_hash`,
 *   `lease_expires_at`, `next_attempt_at`, `last_error_code`,
 *   `processed_at`, `updated_at`), the receipt's `direction`/`disposition`/
 *   `attempt`/`reason_code` (all hardcoded literals in the real SQLite
 *   call: `"inbox"`, `"retry"`, `0`, `"operator_retry"`), the audit/outbox
 *   `event_type`/`reason_code`/`message`/`aggregate_type` (also hardcoded
 *   literals in the real SQLite call), and every id
 *   (`deterministicReceiptIdentity` substitutes for SQLite's random
 *   `newId("delivery_receipt")`/`newId("audit")`/`newId("outbox")`).
 *   `receivedAt` in the returned snapshot is read from the SAME ownership-
 *   locked row this function already holds (not a second, unscoped
 *   re-SELECT the way SQLite's own implementation does) -- byte-identical
 *   in every case, since `received_at` is never mutated by this or any
 *   other write path, just sourced more directly.
 *
 * ---------------------------------------------------------------------
 * 4. WRITER-LOCK PROTOCOL AND FK AUDIT
 * ---------------------------------------------------------------------
 *   `inbox_messages`/`hosted_delivery_receipts` are not one of the five
 *   domains `postgres-signal-writer-lock-protocol.ts` guards (source,
 *   retailer_qualification, settings, mission_policy, spend) -- same
 *   posture `postgres-signal-ingress-enqueue-apply.ts`'s own header
 *   already documents for the same two tables. This boundary never calls
 *   it; per-row serialization comes entirely from `SELECT ... FOR UPDATE OF
 *   inbox` on the one row this call is ever allowed to touch.
 *
 *   FK audit: `inbox_messages.tenant_id`/`user_id` are both `ON DELETE
 *   CASCADE` (migrations.ts:951-953) and `hosted_delivery_receipts.
 *   tenant_id` is `ON DELETE CASCADE` while `user_id` is `ON DELETE SET
 *   NULL` (migrations.ts:975-977) -- neither can silently orphan a row
 *   this function is mutating (the row is locked inside the SAME
 *   transaction). `audit_events.user_id` is `ON DELETE SET NULL`,
 *   `outbox_events.tenant_id` is `ON DELETE CASCADE` -- both consistent
 *   with every sibling in this family; nothing here is FK-reachable from a
 *   row this function itself does not already hold.
 *
 * ---------------------------------------------------------------------
 * 5. JUDGMENT CALLS FOR REVIEWER SCRUTINY
 * ---------------------------------------------------------------------
 *   - RBAC (`worker.manage`) is NOT reproduced in PL/pgSQL. Every other
 *     qualified boundary in this repository -- most directly
 *     `postgres-hosted-delivery-lease-recovery.ts`, which covers
 *     `leaseInboxByEventType`/`completeInbox`/`retryInbox`, all three
 *     gated by `allowedWorker`'s OWN `actorKind === "maintainer"` OR
 *     `internal.delivery` check (hosted-delivery-repository.ts:117-126) --
 *     already establishes this exact precedent: grep-confirmed, that
 *     module never references `AuthorizationRepository`, `allowedWorker`,
 *     or `worker.manage` anywhere. `serverBoundPrincipalLookup` (this
 *     boundary trusts only a principal a caller who has ALREADY performed
 *     the `worker.manage` check in SQLite's own `AuthorizationRepository`
 *     may present) is, exactly as for that module, the full authorization
 *     surface here too -- `authorization_memberships`/`authorization_role_
 *     permissions` are not tenant-scoped RLS-protected mutation tables any
 *     boundary in this family touches. `workerManagePermissionRevalidated:
 *     false` records this honestly below rather than silently omitting the
 *     topic, the same discipline job-lifecycle-apply's own
 *     `deviceCapabilityRevalidation: false` uses.
 *   - Admin change-control (`admin-change-control-repository.ts`,
 *     `AdminChangeControlLevel` step-up/two-person review) does NOT gate
 *     this path at all -- grep-confirmed zero references to
 *     `AdminChangeControlRepository`/`change.approve` anywhere in
 *     `hosted-delivery-repository.ts`, `signal-ingress.ts`, or the
 *     `app.ts` route that reaches it. That workflow protects a DIFFERENT,
 *     unrelated set of operations (catalog identity merges, etc); this
 *     boundary's only real caller-side gate is the single `worker.manage`
 *     permission check addressed above.
 *   - Request-identity collision across two GENUINELY different reset
 *     events for the SAME message: `request_id` is derived from
 *     `(tenantId, userId, inboxMessageId, correlationId, confirmation)`.
 *     In the one real deployment path, `correlationId` is either the
 *     caller-supplied `X-Request-ID` header or a freshly generated
 *     `newId("request")` UUID PER HTTP REQUEST (`apps/api/src/app.ts:
 *     596-599) -- so two distinct HTTP calls, even for the identical
 *     message, carry different `correlationId`s and therefore different
 *     `request_id`s in every real deployment. This is the same
 *     caller-supplied-distinguishing-input trust every sibling's
 *     deterministic-request-id design already relies on (compare
 *     job-lifecycle-apply's own `reasonCode`/`message`/`evidence` bundle).
 *   - `hardcodedEventType` narrows this boundary to the ONE real signal-
 *     ingress dead-letter family. An operator retry of a DIFFERENT
 *     event-type's dead-lettered inbox message (there are none today --
 *     `SIGNAL_INGRESS_EVENT_TYPE` is the only `event_type` ANY inbox
 *     acceptance path in this repository ever writes, confirmed by the
 *     enqueue-apply boundary's own equally hardcoded scope) is out of
 *     scope for the identical reason `ingressEnqueueApply` gives for its
 *     own hardcoded `source`/`eventType` pair.
 */

export const POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_RECEIPT_TABLE =
  "yoink_signal_dead_letter_reset_apply_receipt";
export const POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_FUNCTION =
  "yoink_apply_signal_dead_letter_reset";
export const POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONFIRMATION =
  "DEAD_LETTER_RESET_V1";

/** Mirrors `SIGNAL_INGRESS_EVENT_TYPE` (contracts/src/signal-ingress.ts:3)
 * -- `retryDeadLetterInbox`'s ONE real caller always passes this literal;
 * see module header §1. */
export const POSTGRES_SIGNAL_DEAD_LETTER_RESET_EVENT_TYPE = "signal_event_v1";

const MAXIMUM_REQUEST_PAYLOAD_BYTES = 1_024;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
/** Mirrors `IDENTIFIER_PATTERN` (hosted-delivery-repository.ts:12) exactly
 * -- `deliveryIdentifier`'s own real bound, not the narrower
 * `inbox_[a-f0-9]{32}` shape every real id happens to carry (module header
 * §3). */
const INBOX_MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/;
const REQUEST_ID = /^dead_letter_reset_[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text"
] as const);
const FUNCTION_ARGUMENTS_SQL = `
  expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
  request_id TEXT, request_payload_json TEXT
`;
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TENANT_TABLES = Object.freeze([
  "audit_events", "hosted_delivery_receipts", "inbox_messages", "outbox_events"
] as const);
const MUTATION_TABLES = Object.freeze([
  "audit_events", "hosted_delivery_receipts", "inbox_messages", "outbox_events"
] as const);

export type PostgresSignalDeadLetterResetOperation = "reset_dead_letter_inbox";

export interface PostgresSignalDeadLetterResetPayload {
  inboxMessageId: string;
  correlationId: string;
  confirmation: typeof POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONFIRMATION;
}

export interface PostgresSignalDeadLetterResetSnapshot {
  id: string;
  eventType: string;
  attempt: 0;
  lastErrorCode: "";
  receivedAt: string;
  updatedAt: string;
  privacyClassification: "operational_aggregate";
}

export interface PostgresSignalDeadLetterResetApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  jobLifecycleApplyContractVersion: 1;
  schemaName: string;
  deadLetterResetRoleNamespace: string;
  jobLifecycleApplyManifestFingerprint: string;
  /** The FULL job-lifecycle-apply manifest -- not a `Pick`, unlike this
   * family's earlier writer-track predecessor fields (documented as a real
   * limitation in postgres-signal-evaluation-repository-composition.ts's
   * own header §7). Embedding the full object lets anything chaining onto
   * THIS module's own manifest later walk the whole predecessor chain
   * mechanically, and lets `verify`/`apply` below call
   * `verifyPostgresSignalJobLifecycleApplyBoundary` directly, with no cast. */
  predecessorManifest: PostgresSignalJobLifecycleApplyManifest;
  deadLetterResetRole: {
    kind: "signal_dead_letter_reset_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 1;
  hardcodedEventType: typeof POSTGRES_SIGNAL_DEAD_LETTER_RESET_EVENT_TYPE;
  protectedTenantTableCount: 4;
  forcedRlsTableCount: 4;
  mutationTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  workerManagePermissionRevalidated: false;
  inboxOwnershipRevalidated: true;
  deadLetterStatePreconditionEnforced: true;
  repeatedResetAfterReDeadLetterAllowed: true;
  deterministicRequestIdentity: true;
  auditedReplayGraphIdempotency: true;
  atomicInboxReceiptAuditOutboxMutation: true;
  databaseOwnedTimestamps: true;
  deterministicReceiptIdentity: true;
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
  // Closes `HostedDeliveryRepository.retryDeadLetterInbox` -- out-of-scope
  // write item 3 in
  // `POSTGRES_SIGNAL_INGRESS_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES`
  // (postgres-signal-ingress-composition.ts).
  deadLetterResetWriterParity: true;
  // Honestly false: this module alone does not bind
  // hostedDeliveryLeaseRecovery, ingressEnqueueApply, or
  // evaluationRepositoryComposition -- only the composition module's own
  // chain (or a future rung that binds this module into it) could ever
  // flip these. See postgres-signal-ingress-composition.ts §5 item 3 for
  // why this family's own write is a genuinely distinct scope from
  // signalIngressRepositoryParity's.
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalDeadLetterResetCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  jobLifecycleApplyContractVersion: 1;
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
  workerManagePermissionRevalidated: false;
  inboxOwnershipRevalidated: true;
  deadLetterStatePreconditionEnforced: true;
  repeatedResetAfterReDeadLetterAllowed: true;
  deterministicRequestIdentity: true;
  auditedReplayGraphIdempotency: true;
  atomicInboxReceiptAuditOutboxMutation: true;
  databaseOwnedTimestamps: true;
  deterministicReceiptIdentity: true;
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
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  operationCount: 1;
  protectedTenantTableCount: 4;
  forcedRlsTableCount: 4;
  mutationTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalDeadLetterResetApplyResult {
  contractVersion: 1;
  operation: PostgresSignalDeadLetterResetOperation;
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  inboxMutated: boolean;
  receiptMutated: boolean;
  auditMutated: boolean;
  outboxMutated: boolean;
  deadLetter: PostgresSignalDeadLetterResetSnapshot;
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
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  mutationAuthority: true;
  runtimeAuthority: false;
}

export interface NodePostgresSignalDeadLetterResetApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalDeadLetterResetCapabilityProjection> | null = null;

export class PostgresSignalDeadLetterResetApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalDeadLetterResetApplyQualificationError";
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
    throw new PostgresSignalDeadLetterResetApplyQualificationError(
      "The PostgreSQL dead-letter reset schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalDeadLetterResetApplyQualificationError(
      "The PostgreSQL dead-letter reset role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_dead_letter_reset`;
  if (value.length > 63) {
    throw new PostgresSignalDeadLetterResetApplyQualificationError(
      "The PostgreSQL dead-letter reset role name exceeds PostgreSQL's limit."
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
 * joined with '|' -- byte-for-byte identical to the TypeScript helper. */
function stableHashInputSql(parts: string[]): string {
  return parts.map((part) => (
    `pg_catalog.octet_length(${part})::text || ':' || ${part}`
  )).join(" || '|' || ");
}

function cleanedCorrelationId(value: unknown): string {
  // Byte-for-byte `cleanText` (domain/src/normalize.ts): strip C0/DEL
  // control characters, collapse whitespace runs to a single space, trim,
  // bound to 160 bytes. Unlike `AuditRepository.record`'s own `|| "system"`
  // fallback, this normalizer fails CLOSED on an empty result rather than
  // silently substituting a literal -- the real (and only) caller chain
  // (apps/api/src/app.ts:596-599) never supplies an empty correlationId, so
  // that fallback path is dead code for this call graph; failing closed is
  // the safer choice for a database boundary than reproducing a
  // convenience default a real caller can never trigger.
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  if (!normalized) {
    throw new PostgresSignalDeadLetterResetApplyQualificationError(
      "A non-empty signal dead-letter reset correlation id is required."
    );
  }
  return normalized;
}

/**
 * Normalizes an `(id, correlationId)` pair -- exactly the SQLite
 * `HostedDeliveryRepository.retryDeadLetterInbox(id, eventType,
 * correlationId, now)` signature minus `eventType` (hardcoded server-side
 * to `POSTGRES_SIGNAL_DEAD_LETTER_RESET_EVENT_TYPE`; module header §1) and
 * `now` (the database owns its own write timestamp) -- into the payload
 * shape the PostgreSQL boundary function accepts.
 */
export function normalizedPostgresSignalDeadLetterResetPayload(input: {
  inboxMessageId: string;
  correlationId: string;
}): PostgresSignalDeadLetterResetPayload {
  const inboxMessageId = String(input?.inboxMessageId ?? "").trim();
  if (!INBOX_MESSAGE_ID.test(inboxMessageId)) {
    throw new PostgresSignalDeadLetterResetApplyQualificationError(
      "A valid signal dead-letter reset inbox message id is required."
    );
  }
  return {
    inboxMessageId,
    correlationId: cleanedCorrelationId(input?.correlationId),
    confirmation: POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONFIRMATION
  };
}

/**
 * Derives the deterministic request id from the principal and the complete
 * normalized payload, matching `postgres-signal-attribution-receipt-
 * apply.ts`'s "derive-and-compare-in-SQL" pattern (not job-lifecycle-
 * apply's "format-only ID + fingerprint" pattern) -- this payload, unlike
 * job-lifecycle-apply's arbitrary `evidence`, is flat and fully
 * re-derivable byte-for-byte in PL/pgSQL.
 */
export function buildPostgresSignalDeadLetterResetRequestId(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  payload: PostgresSignalDeadLetterResetPayload
): string {
  const parts = [
    "postgres-signal-dead-letter-reset-request-v1",
    String(principal?.tenantId ?? ""),
    String(principal?.userId ?? ""),
    String(payload?.inboxMessageId ?? ""),
    String(payload?.correlationId ?? ""),
    String(payload?.confirmation ?? "")
  ];
  return `dead_letter_reset_${createHash("sha256")
    .update(stableHashInput(parts)).digest("hex").slice(0, 32)}`;
}

export function buildPostgresSignalDeadLetterResetApplyManifest(
  predecessorManifest = buildPostgresSignalJobLifecycleApplyManifest(),
  requestedRoleNamespace = "yoink_dead_letter_reset_q"
): PostgresSignalDeadLetterResetApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const deadLetterResetRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (collectRoleNamespaces(predecessorManifest).has(deadLetterResetRoleNamespace)) {
    throw new PostgresSignalDeadLetterResetApplyQualificationError(
      "The PostgreSQL dead-letter reset role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalDeadLetterResetApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    jobLifecycleApplyContractVersion: POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONTRACT_VERSION,
    schemaName,
    deadLetterResetRoleNamespace,
    jobLifecycleApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    deadLetterResetRole: {
      kind: "signal_dead_letter_reset_apply_boundary",
      name: roleName(deadLetterResetRoleNamespace),
      functionName: POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 1,
    hardcodedEventType: POSTGRES_SIGNAL_DEAD_LETTER_RESET_EVENT_TYPE,
    protectedTenantTableCount: 4,
    forcedRlsTableCount: 4,
    mutationTableCount: 4,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    workerManagePermissionRevalidated: false,
    inboxOwnershipRevalidated: true,
    deadLetterStatePreconditionEnforced: true,
    repeatedResetAfterReDeadLetterAllowed: true,
    deterministicRequestIdentity: true,
    auditedReplayGraphIdempotency: true,
    atomicInboxReceiptAuditOutboxMutation: true,
    databaseOwnedTimestamps: true,
    deterministicReceiptIdentity: true,
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
    signalIngressRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    allHandlerRepositoryParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function signalDeadLetterResetApplyFunctionSource(
  manifest = buildPostgresSignalDeadLetterResetApplyManifest()
): string {
  const requestIdentityParts = stableHashInputSql([
    "'postgres-signal-dead-letter-reset-request-v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "inbox_message_id_value",
    "correlation_id_value",
    `'${POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONFIRMATION}'::text`
  ]);
  // stableHash (domain/src/ids.ts) terminates EVERY part with '|', including
  // the last -- unlike this module's request-identity convention above,
  // which joins with '|' as a separator only. The receipt hash claims
  // byte-for-byte stableHash parity, so the trailing terminator is appended
  // explicitly, exactly as postgres-signal-attribution-receipt-apply.ts's
  // own header documents for its `canonical_url_hash` derivation.
  const receiptHashParts = stableHashInputSql([
    "'hosted_delivery_receipt_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'inbox'::text",
    "inbox_message_id_value",
    "'retry'::text",
    "'0'::text",
    "'operator_retry'::text",
    "mutation_timestamp"
  ]) + " || '|'";
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  derived_request_id TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  inbox_message_id_value TEXT;
  correlation_id_value TEXT;
  inbox_row RECORD;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  receipt_id_value TEXT;
  audit_count BIGINT;
  outbox_count BIGINT;
  replay_record RECORD;
  mutation_timestamp TEXT;
  affected_rows BIGINT;
  receipt_hash_value TEXT;
  dead_letter_result_value JSONB;
  result_value JSONB;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name <> 'reset_dead_letter_inbox'
    OR request_id !~ '^dead_letter_reset_[a-f0-9]{32}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal dead-letter reset request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal dead-letter reset payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR request_payload - ARRAY['inboxMessageId', 'correlationId', 'confirmation']::text[]
      IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 3
    OR pg_catalog.jsonb_typeof(request_payload->'inboxMessageId') IS DISTINCT FROM 'string'
    OR request_payload->>'inboxMessageId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$'
    OR pg_catalog.jsonb_typeof(request_payload->'correlationId') IS DISTINCT FROM 'string'
    OR pg_catalog.octet_length(request_payload->>'correlationId') NOT BETWEEN 1 AND 160
    OR (request_payload->>'correlationId') <> pg_catalog.btrim(
      pg_catalog.regexp_replace(request_payload->>'correlationId', '\\s+', ' ', 'g')
    )
    OR (request_payload->>'correlationId') ~ '[[:cntrl:]]'
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> '${POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONFIRMATION}' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal dead-letter reset payload shape is invalid';
  END IF;
  inbox_message_id_value := request_payload->>'inboxMessageId';
  correlation_id_value := request_payload->>'correlationId';

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

  derived_request_id := 'dead_letter_reset_' || pg_catalog.substr(
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      ${requestIdentityParts}, 'UTF8'
    )), 'hex'), 1, 32
  );
  IF request_id <> derived_request_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal dead-letter reset request identity is invalid';
  END IF;
  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(request_payload::text, 'UTF8')
  ), 'hex');

  -- Ownership + existence: the ONE row this call may ever touch, locked for
  -- the duration of the transaction, scoped to the hardcoded event type
  -- (module header §1/§5) -- NOT FOUND fails closed BEFORE any replay
  -- determination, so a replayed request for a message that no longer
  -- belongs to this tenant/user still fails closed rather than returning a
  -- stale cached result.
  SELECT inbox.id AS id, inbox.state AS state, inbox.received_at AS received_at
    INTO inbox_row
  FROM ${relation(manifest.schemaName, "inbox_messages")} AS inbox
  WHERE inbox.id = inbox_message_id_value
    AND inbox.tenant_id = resolved_tenant_id AND inbox.user_id = resolved_user_id
    AND inbox.event_type = '${POSTGRES_SIGNAL_DEAD_LETTER_RESET_EVENT_TYPE}'
  FOR UPDATE OF inbox;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal dead-letter reset inbox ownership is invalid';
  END IF;

  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_dead_letter_reset_request_v1|' || resolved_tenant_id ||
      '|' || resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_dead_letter_reset_outbox_v1|' || audit_id_value, 'UTF8'
    )
  ), 'hex'), 1, 32);
  receipt_id_value := 'delivery_receipt_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_dead_letter_reset_receipt_v1|' || resolved_tenant_id ||
      '|' || resolved_user_id || '|' || audit_id_value, 'UTF8'
    )
  ), 'hex'), 1, 32);

  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} WHERE id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} WHERE id = outbox_id_value;
  IF audit_count <> outbox_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal dead-letter reset request graph is partial';
  END IF;

  -- Audited-replay-graph idempotency (module header §2) -- deliberately
  -- does NOT also require the currently live inbox row to still show
  -- state = 'accepted': a message that legitimately cycled back to
  -- dead_letter a second time before this exact request_id happens to be
  -- replayed must not raise a spurious graph-changed error.
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
      OR replay_record.correlation_id <> correlation_id_value
      OR replay_record.event_type <> 'signal_inbox_retried'
      OR replay_record.reason_code <> 'operator_retry'
      OR replay_record.message <> 'A dead-lettered signal message was reset for bounded worker evaluation.'
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR replay_record.audit_data->'request' IS DISTINCT FROM request_payload
      OR pg_catalog.jsonb_typeof(replay_record.audit_data->'result') IS DISTINCT FROM 'object'
      OR (replay_record.audit_data->'result'->'deadLetter'->>'id') <> inbox_message_id_value
      OR replay_record.outbox_tenant_id <> resolved_tenant_id
      OR replay_record.aggregate_type <> 'hosted_inbox'
      OR replay_record.aggregate_id <> correlation_id_value
      OR replay_record.outbox_event_type <> 'signal_inbox_retried'
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'correlationId' <> correlation_id_value
      OR replay_record.outbox_payload->>'reasonCode' <> 'operator_retry'
      OR replay_record.outbox_payload->>'message' <> 'A dead-lettered signal message was reset for bounded worker evaluation.'
      OR replay_record.outbox_payload->'data' IS DISTINCT FROM replay_record.audit_data
      OR replay_record.audit_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal dead-letter reset replay graph changed';
    END IF;
    RETURN QUERY SELECT (replay_record.audit_data->'result' || pg_catalog.jsonb_build_object(
      'outcome', 'already_applied',
      'mutationApplied', FALSE,
      'idempotentReplay', TRUE,
      'mutationStatementCount', 0,
      'mutationRowCount', 0,
      'inboxMutated', FALSE,
      'receiptMutated', FALSE,
      'auditMutated', FALSE,
      'outboxMutated', FALSE
    ))::text;
    RETURN;
  END IF;

  -- Dead-letter-state precondition, fail-closed (module header §2) --
  -- checked AFTER the replay short-circuit, matching
  -- postgres-signal-job-lifecycle-apply.ts's own ordering: an exact replay
  -- of an already-applied request must never be rejected merely because the
  -- row has since moved on.
  IF inbox_row.state <> 'dead_letter' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'signal dead-letter reset requires a dead-lettered inbox message';
  END IF;

  mutation_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  UPDATE ${relation(manifest.schemaName, "inbox_messages")}
  SET state = 'accepted', delivery_attempts = 0, lease_capability_hash = '',
      lease_expires_at = '', next_attempt_at = '', last_error_code = '',
      processed_at = '', updated_at = mutation_timestamp
  WHERE id = inbox_message_id_value AND tenant_id = resolved_tenant_id AND user_id = resolved_user_id
    AND event_type = '${POSTGRES_SIGNAL_DEAD_LETTER_RESET_EVENT_TYPE}' AND state = 'dead_letter';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal dead-letter reset inbox row changed concurrently';
  END IF;

  receipt_hash_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    ${receiptHashParts}, 'UTF8'
  )), 'hex');
  INSERT INTO ${relation(manifest.schemaName, "hosted_delivery_receipts")}(
    id, tenant_id, user_id, direction, message_id, disposition,
    attempt, reason_code, receipt_hash, created_at
  ) VALUES (
    receipt_id_value, resolved_tenant_id, resolved_user_id, 'inbox', inbox_message_id_value,
    'retry', 0, 'operator_retry', receipt_hash_value, mutation_timestamp
  );

  -- receivedAt is read from the SAME ownership-locked row fetched above,
  -- never mutated by this or any other write path -- byte-identical to
  -- SQLite's own separate re-SELECT, sourced more directly (module header
  -- §3).
  dead_letter_result_value := pg_catalog.jsonb_build_object(
    'id', inbox_message_id_value, 'eventType', '${POSTGRES_SIGNAL_DEAD_LETTER_RESET_EVENT_TYPE}',
    'attempt', 0, 'lastErrorCode', '', 'receivedAt', inbox_row.received_at,
    'updatedAt', mutation_timestamp, 'privacyClassification', 'operational_aggregate'
  );
  result_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1, 'operation', operation_name,
    'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
    'outcome', 'applied', 'mutationApplied', TRUE, 'idempotentReplay', FALSE,
    'mutationStatementCount', 4, 'mutationRowCount', 4,
    'inboxMutated', TRUE, 'receiptMutated', TRUE, 'auditMutated', TRUE, 'outboxMutated', TRUE,
    'deadLetter', dead_letter_result_value,
    'sourceTrustWriterParity', TRUE, 'sourceStatusWriterParity', TRUE, 'sourceSyncWriterParity', TRUE,
    'catalogImportWriterParity', TRUE, 'connectionProvisioningWriterParity', TRUE, 'sourceWriterParity', TRUE,
    'retailerQualificationWriterParity', TRUE, 'missionPolicyWriterParity', TRUE,
    'settingsWriterParity', FALSE, 'configurationWriterParity', FALSE, 'reservationWriterParity', TRUE,
    'attributionPolicyParity', TRUE, 'jobLifecycleWriterParity', TRUE, 'writerLockProtocolParity', FALSE,
    'deadLetterResetWriterParity', TRUE,
    'signalIngressRepositoryParity', FALSE, 'hostedDeliveryHandlerRepositoryParity', FALSE,
    'allHandlerRepositoryParity', FALSE,
    'mutationAuthority', TRUE, 'runtimeAuthority', FALSE
  );
  audit_data_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1, 'operation', operation_name, 'requestId', request_id,
    'requestFingerprint', request_fingerprint_value, 'request', request_payload, 'result', result_value
  );
  outbox_payload_value := pg_catalog.jsonb_build_object(
    'auditId', audit_id_value, 'correlationId', correlation_id_value,
    'reasonCode', 'operator_retry',
    'message', 'A dead-lettered signal message was reset for bounded worker evaluation.',
    'data', audit_data_value
  );

  INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
    id, tenant_id, user_id, correlation_id, event_type,
    reason_code, message, data_json, created_at
  ) VALUES (
    audit_id_value, resolved_tenant_id, resolved_user_id, correlation_id_value,
    'signal_inbox_retried', 'operator_retry',
    'A dead-lettered signal message was reset for bounded worker evaluation.',
    audit_data_value::text, mutation_timestamp
  );
  INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
    id, tenant_id, aggregate_type, aggregate_id, event_type,
    payload_json, created_at, delivered_at
  ) VALUES (
    outbox_id_value, resolved_tenant_id, 'hosted_inbox', correlation_id_value,
    'signal_inbox_retried', outbox_payload_value::text, mutation_timestamp, ''
  );

  RETURN QUERY SELECT result_value::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalDeadLetterResetApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_dead_letter_reset_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.deadLetterResetRole.name,
    functionName: POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalDeadLetterResetApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_dead_letter_reset_apply_receipt",
    receiptTriggerName: "yoink_signal_dead_letter_reset_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.jobLifecycleApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      jobLifecycleApplyContractVersion: 1,
      operationCount: 1,
      hardcodedEventType: POSTGRES_SIGNAL_DEAD_LETTER_RESET_EVENT_TYPE,
      serverBoundPrincipalLookup: true,
      workerManagePermissionRevalidated: false,
      inboxOwnershipRevalidated: true,
      deadLetterStatePreconditionEnforced: true,
      repeatedResetAfterReDeadLetterAllowed: true,
      deterministicRequestIdentity: true,
      auditedReplayGraphIdempotency: true,
      atomicInboxReceiptAuditOutboxMutation: true,
      databaseOwnedTimestamps: true,
      deterministicReceiptIdentity: true,
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
      signalIngressRepositoryParity: false,
      hostedDeliveryHandlerRepositoryParity: false,
      allHandlerRepositoryParity: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalDeadLetterResetCapabilityProjection():
PostgresSignalDeadLetterResetCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalDeadLetterResetApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    jobLifecycleApplyContractVersion: 1,
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
    workerManagePermissionRevalidated: false,
    inboxOwnershipRevalidated: true,
    deadLetterStatePreconditionEnforced: true,
    repeatedResetAfterReDeadLetterAllowed: true,
    deterministicRequestIdentity: true,
    auditedReplayGraphIdempotency: true,
    atomicInboxReceiptAuditOutboxMutation: true,
    databaseOwnedTimestamps: true,
    deterministicReceiptIdentity: true,
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
    signalIngressRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    allHandlerRepositoryParity: false,
    operationCount: 1,
    protectedTenantTableCount: 4,
    forcedRlsTableCount: 4,
    mutationTableCount: 4,
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

export type PostgresSignalDeadLetterResetApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalDeadLetterResetApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalDeadLetterResetApplyManifest()
): Promise<PostgresSignalDeadLetterResetApplyQualificationReceipt> {
  await verifyPostgresSignalJobLifecycleApplyBoundary(database, manifest.predecessorManifest);
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalDeadLetterResetApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalDeadLetterResetApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalDeadLetterResetApplyQualificationReceipt> {
  await verifyPostgresSignalJobLifecycleApplyBoundary(database, manifest.predecessorManifest);
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalDeadLetterResetApplyQualificationError(
      `The PostgreSQL dead-letter reset ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalDeadLetterResetOperation,
  requestId: string
): PostgresSignalDeadLetterResetApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalDeadLetterResetApplyQualificationError(
      "The PostgreSQL dead-letter reset result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const outcome = String(result.outcome ?? "");
  const applied = outcome === "applied";
  const deadLetter = result.deadLetter;
  const validDeadLetter = (entry: unknown): boolean => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const row = entry as Record<string, unknown>;
    return INBOX_MESSAGE_ID.test(String(row.id))
      && row.eventType === POSTGRES_SIGNAL_DEAD_LETTER_RESET_EVENT_TYPE
      && row.attempt === 0
      && row.lastErrorCode === ""
      && typeof row.receivedAt === "string" && row.receivedAt.length > 0
      && typeof row.updatedAt === "string" && row.updatedAt.length > 0
      && row.privacyClassification === "operational_aggregate";
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
    || Number(result.mutationStatementCount) < 0 || Number(result.mutationStatementCount) > 4
    || !Number.isSafeInteger(result.mutationRowCount)
    || Number(result.mutationRowCount) < 0 || Number(result.mutationRowCount) > 4
    || (applied && (result.mutationStatementCount !== 4 || result.mutationRowCount !== 4))
    || (!applied && (result.mutationStatementCount !== 0 || result.mutationRowCount !== 0))
    || typeof result.inboxMutated !== "boolean"
    || typeof result.receiptMutated !== "boolean"
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || result.inboxMutated !== applied
    || result.receiptMutated !== applied
    || result.auditMutated !== applied
    || result.outboxMutated !== applied
    || !validDeadLetter(deadLetter)
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
    || result.signalIngressRepositoryParity !== false
    || result.hostedDeliveryHandlerRepositoryParity !== false
    || result.allHandlerRepositoryParity !== false
    || result.mutationAuthority !== true
    || result.runtimeAuthority !== false) {
    throw new PostgresSignalDeadLetterResetApplyQualificationError(
      "The PostgreSQL dead-letter reset result contract changed."
    );
  }
  return result as unknown as PostgresSignalDeadLetterResetApplyResult;
}

export class NodePostgresSignalDeadLetterResetApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalDeadLetterResetApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalDeadLetterResetApplyManifest(),
    options: NodePostgresSignalDeadLetterResetApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalDeadLetterResetApplyQualificationError(
        "The PostgreSQL dead-letter reset connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_dead_letter_reset"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_signal_dead_letter_reset");
  }

  /**
   * Server-bound principal (operator/admin-scoped -- module header §5): the
   * caller is trusted to have ALREADY performed the `worker.manage` RBAC
   * check the real SQLite call requires, exactly the same trust boundary
   * `postgres-hosted-delivery-lease-recovery.ts` already establishes for
   * `allowedWorker`'s own check.
   */
  async resetDeadLetterInbox(
    principal: BackgroundWorkerPrincipal,
    requestIdValue: string,
    requestPayload: PostgresSignalDeadLetterResetPayload
  ): Promise<PostgresSignalDeadLetterResetApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation: PostgresSignalDeadLetterResetOperation = "reset_dead_letter_inbox";
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (!REQUEST_ID.test(requestId)
      || requestId !== buildPostgresSignalDeadLetterResetRequestId({ tenantId, userId }, requestPayload)
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalDeadLetterResetApplyQualificationError(
        "The PostgreSQL dead-letter reset apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.deadLetterResetRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalDeadLetterResetApplyQualificationError(
          "The PostgreSQL dead-letter reset function returned an ambiguous result."
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
