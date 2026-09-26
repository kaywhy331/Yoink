import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import type { SignalEventInput } from "../../contracts/src/index.js";
import { normalizeSignal } from "../../domain/src/normalize.js";
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
  POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONTRACT_VERSION,
  buildPostgresSignalAttributionReceiptApplyManifest,
  verifyPostgresSignalAttributionReceiptApplyBoundary,
  type PostgresSignalAttributionReceiptApplyManifest
} from "./postgres-signal-attribution-receipt-apply.js";
import {
  POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
  buildPostgresTenantQueueWriteManifest,
  verifyPostgresTenantQueueWriteBoundary,
  type PostgresTenantQueueWriteManifest
} from "./postgres-tenant-queue-writes.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

/**
 * PostgreSQL bounded durable signal-INGRESS-ACCEPTANCE writer — closes the
 * gap `postgres-signal-evaluation-repository-composition.ts` names in
 * `POSTGRES_SIGNAL_EVALUATION_REPOSITORY_KNOWN_OUT_OF_SCOPE_WRITES` (§5):
 * `"DurableSignalIngressService's OWN enqueue path ... backed by
 * HostedDeliveryRepository.acceptInbox -- INSERT INTO inbox_messages(...),
 * hosted-delivery-repository.ts:195 -- and BackgroundTaskRepository's
 * create/dedupe writes for a NEW inbound signal"`. That composition module's
 * own §5 is explicit that `hostedDeliveryLeaseRecovery`'s
 * `yoink_transition_trackalacker_signal_inbox` function only
 * leases/completes/fails an ALREADY-enqueued `inbox_messages` row and never
 * INSERTs it — "No boundary module in this repository reproduces the
 * initial enqueue." This module is that missing boundary, for exactly the
 * ONE real caller of `acceptInbox` that a durable signal ever reaches
 * through: `DurableSignalIngressService.acceptTrackalacker`.
 *
 * ---------------------------------------------------------------------
 * 1. SQLITE TRUTH -- `HostedDeliveryRepository.acceptInbox`
 *    (packages/database/src/hosted-delivery-repository.ts:153-213), read in
 *    full together with its one signal-ingress caller,
 *    `DurableSignalIngressService.acceptTrackalacker`
 *    (packages/engine/src/signal-ingress.ts:69-119), also read in full
 * ---------------------------------------------------------------------
 *   `acceptTrackalacker(input, now)` first runs `durableSignal(input, now)`
 *   (signal-ingress.ts:29-58): `normalizeSignal(input, now)` (the SAME
 *   domain helper every signal-processing path uses), then asserts
 *   `normalized.source === "trackalacker"` AND
 *   `normalized.parserVersion === "trackalacker-push-v1"` -- ANY other
 *   source or parser version throws before `acceptInbox` is ever called.
 *   The thirteen-key `SignalEventInput`-shaped object `durableSignal`
 *   returns (`schemaVersion, signalId, sourceConnectionId, source,
 *   externalEventId, eventType, observedAt, receivedAt, test, identity,
 *   offer, evidence, parserVersion`) is that call's ENTIRE envelope -- there
 *   is no other field. It then derives a deterministic idempotency key:
 *
 *     messageKey = `signal:${stableHash(
 *       "yoink_durable_signal_ingress_v1", owner.tenantId, owner.userId,
 *       payload.sourceConnectionId, payload.signalId
 *     )}`
 *
 *   and calls, inside ONE ambient `this.db.transaction(...)`:
 *
 *     this.delivery.acceptInbox({
 *       source: "trackalacker", messageKey,
 *       eventType: SIGNAL_INGRESS_EVENT_TYPE /* "signal_event_v1" *\/,
 *       payload
 *     }, now)
 *
 *   `acceptInbox` itself (hosted-delivery-repository.ts:153-213):
 *   `source`/`eventType` are format-validated identifiers, lowercased;
 *   `messageKey` is format-validated, NOT lowercased. The payload is
 *   normalized by `normalizedPayload` (:96-102): `sanitizeDiagnosticData`
 *   (packages/domain/src/redaction.ts:14-29 -- recursive redaction of
 *   sensitive keys, depth-capped at 4, arrays capped at 50 entries, objects
 *   capped at 100 keys) then `stableJson` (:89-94, a private, unexported
 *   helper -- recursively key-sorted `JSON.stringify`), rejecting anything
 *   whose canonical JSON exceeds `MAX_PAYLOAD_BYTES = 65536` UTF-8 bytes
 *   (:11). `payloadHash = stableHash("hosted_delivery_payload_v1", json)`.
 *
 *   `acceptInbox` then looks up an existing `inbox_messages` row by the
 *   UNIQUE(tenant_id, user_id, source, message_key) key (schema below):
 *     - FOUND, same `payload_hash` AND `event_type`: calls
 *       `recordReceipt("inbox", existing.id, "deduped",
 *       existing.deliveryAttempts, "same_payload", now)` and returns
 *       `{ id: existing.id, disposition: "deduped", state: existing.state,
 *       payloadHash: existing.payloadHash, receivedAt: existing.receivedAt }`
 *       -- note this DOES write a fresh `hosted_delivery_receipts` row (see
 *       §3); it is not a true zero-write.
 *     - FOUND, DIFFERENT `payload_hash` OR `event_type`: throws
 *       `"The inbox idempotency key was already used for different
 *       content."` BEFORE calling `recordReceipt` at all -- a genuine
 *       zero-write, fail-closed conflict.
 *     - NOT FOUND: inside `this.db.transaction`, INSERTs one
 *       `inbox_messages` row (`state = 'accepted'`) and calls
 *       `recordReceipt("inbox", id, "accepted", 0, "new_message", now)`.
 *
 *   `recordReceipt` (:720-748) is a single INSERT into
 *   `hosted_delivery_receipts` with
 *   `receipt_hash = stableHash("hosted_delivery_receipt_v1", tenantId,
 *   userId, direction, messageId, disposition, attempt, reasonCode,
 *   timestamp)`. It is the ONLY write `acceptInbox` performs beyond
 *   `inbox_messages` itself -- `acceptInbox` never calls `AuditRepository`
 *   and never touches `audit_events`/`outbox_events` (unlike
 *   `retryDeadLetterInbox`, which does, but is a different method entirely
 *   and out of scope here). So the true SQLite write set is: conflict =
 *   ZERO writes; dedupe = ONE write (`hosted_delivery_receipts` only);
 *   fresh accept = TWO writes (`inbox_messages` + `hosted_delivery_receipts`).
 *
 *   Back in `acceptTrackalacker`, once `acceptInbox` returns, IF the
 *   resulting `inbox.state` is NOT `"processed"` or `"dead_letter"` (true
 *   for every fresh accept, since a brand-new row is always `"accepted"`;
 *   possibly false for a dedupe against an already-terminal row), it calls,
 *   in a re-scoped service-actor request context:
 *
 *     this.tasks.enqueueServiceTask("hosted_delivery_recovery",
 *       `signal:${inbox.id}`, now)
 *
 *   -- `BackgroundTaskRepository.enqueueServiceTask`
 *   (packages/database/src/background-task-repository.ts:668-721). See §2
 *   for why this half is NOT reimplemented by this module.
 *
 * ---------------------------------------------------------------------
 * 2. TERRITORY SPLIT -- why this module owns ONLY the `inbox_messages` /
 *    `hosted_delivery_receipts` half, and how the task-enqueue half is
 *    independently, exactly covered by `postgres-tenant-queue-writes.ts`
 *    (v0.61-0.63, read in full)
 * ---------------------------------------------------------------------
 *   `enqueueServiceTask` performs, in order: (a)
 *   `ensureDefaultSchedules(now)` -- `INSERT OR IGNORE INTO
 *   background_task_schedules` per task kind, then a conditional `UPDATE`;
 *   (b) `SELECT` the schedule row for `task_kind`; (c) `SELECT` an active
 *   task by `(task_kind, dedupe_key)` for dedupe; (d) `insertTask` --
 *   `INSERT OR IGNORE INTO background_tasks`, then, on success, `event()` --
 *   `INSERT INTO background_task_events` (append-only, never `UPDATE`d).
 *   That is exactly three tables -- `background_task_schedules`,
 *   `background_tasks`, `background_task_events` -- with exactly the
 *   privilege set `postgres-tenant-queue-writes.ts`'s own `TABLE_GRANTS`
 *   (postgres-tenant-queue-writes.ts:215-239) already qualifies for its
 *   `tenant_queue_writer` role: `background_task_schedules` ->
 *   [SELECT,INSERT,UPDATE], `background_tasks` -> [SELECT,INSERT,UPDATE],
 *   `background_task_events` -> [SELECT,INSERT] -- table-for-table,
 *   privilege-for-privilege identical to what `enqueueServiceTask` actually
 *   issues (its own two other granted tables, `background_worker_heartbeats`
 *   and `background_worker_deployment_expectations`, are simply untouched
 *   by this call path). That role is `NOLOGIN`/`NOINHERIT`/no `BYPASSRLS`,
 *   restricted by four server-bound RESTRICTIVE policies, with
 *   `activePrincipalCount: 0` (qualified but inactive) -- the SAME safety
 *   posture every boundary in this family requires.
 *
 *   Because the task-enqueue write family is ALREADY independently
 *   qualified, table-for-table, by a sealed sibling module, this module
 *   does NOT reimplement it: it CONSUMES that boundary by binding
 *   `queueWriteManifest`'s fingerprint into its own manifest (so a drift in
 *   `postgres-tenant-queue-writes.ts`'s role/grant/policy shape breaks THIS
 *   module's build, per `fingerprint` composition below) and by calling
 *   `verifyPostgresTenantQueueWriteBoundary` from both
 *   `verifyPostgresSignalIngressEnqueueApplyBoundary` AND
 *   `applyPostgresSignalIngressEnqueueApplyBoundary` (verify only -- this
 *   module never calls `applyPostgresTenantQueueWriteBoundary`; creating
 *   that role/policy surface remains solely that module's own qualification
 *   flow). This module's OWN SQL function therefore touches exactly TWO
 *   tables -- `inbox_messages`, `hosted_delivery_receipts` -- nothing from
 *   the `background_task*` family at all. A caller composing the full
 *   `acceptTrackalacker` semantics against real PostgreSQL is expected to
 *   invoke THIS module's function, inspect its `disposition`/`receipt`, and
 *   -- mirroring `acceptTrackalacker`'s own `if (!["processed",
 *   "dead_letter"].includes(inbox.state))` branch in application code --
 *   separately invoke the ALREADY-qualified queue-writer for the
 *   `hosted_delivery_recovery` task enqueue when required. That composition
 *   step (plus binding `hostedDeliveryLeaseRecovery` and the resolution
 *   plan) is exactly what `signalIngressRepositoryParity` (kept `false`
 *   below, per the composition module's own §5) still names as open; see
 *   §6.
 *
 * ---------------------------------------------------------------------
 * 3. THE RECEIPT LEDGER IS APPEND-ONLY, EVEN ON DEDUPE -- a genuine
 *    divergence from `postgres-signal-attribution-receipt-apply.ts`'s
 *    `INSERT OR IGNORE` full zero-write reuse
 * ---------------------------------------------------------------------
 *   `attribution_receipts` is a "receipt exists, do nothing more" table:
 *   its sibling boundary's dedupe path performs a genuinely empty
 *   transaction. `hosted_delivery_receipts` is structurally different -- it
 *   is an append-only delivery/audit ledger (SQLite's own trigger-free
 *   design lets `recordReceipt` be called from SIX different disposition
 *   sites: accepted, deduped, leased, processed, delivered/retry/
 *   dead_letter). Reproducing attribution-receipt's "duplicate = zero
 *   writes" behavior here would be WRONG -- it would silently drop a real
 *   SQLite side effect. So this boundary's `outcome`/`already_applied`
 *   naming is deliberately NOT reused: instead of
 *   `mutationApplied`/`idempotentReplay`, the result carries `disposition:
 *   "accepted" | "deduped"` (mirroring `HostedInboxReceipt.disposition`
 *   exactly) plus independent `inboxMutated`/`receiptMutated` booleans and
 *   an honest `mutationRowCount` read back via `GET DIAGNOSTICS` after each
 *   INSERT, not a value hardcoded per branch. "duplicate" is a zero-write
 *   to `inbox_messages` specifically (`inboxMutated: false` always on that
 *   path) -- never a zero-write to the ledger as a whole.
 *
 *   A second, deliberate divergence from SQLite: `recordReceipt`'s `id` is
 *   `newId("delivery_receipt")` -- a fresh random UUID EVERY call, so a
 *   literal network-level retry of the identical `acceptTrackalacker`
 *   invocation would, in SQLite, append a SECOND ledger row. This boundary
 *   instead derives the receipt id deterministically from `request_id`
 *   (itself a deterministic hash of the normalized payload) and inserts it
 *   `ON CONFLICT (id) DO NOTHING` -- so an EXACT retry (same request_id) is
 *   a true no-op on the ledger too, while two DIFFERENT logical calls that
 *   both resolve to the same dedupe outcome (e.g. two distinct retries of
 *   TWO different upstream deliveries for the same signal) still each get
 *   their own ledger row, exactly like SQLite. This is strictly MORE
 *   replay-safe than SQLite, deliberately, not a semantic mismatch -- see
 *   §7's judgment-call note.
 *
 * ---------------------------------------------------------------------
 * 4. WHAT IS DERIVED VS. WHAT IS ACCEPTED (the "revalidate consistency"
 *    design attribution-receipt-apply established)
 * ---------------------------------------------------------------------
 *   `source` and `eventType` are NEVER accepted as caller input at all --
 *   they are the two SQL literals `'trackalacker'` / `'signal_event_v1'`,
 *   matching `acceptTrackalacker`'s own hardcoded call into `acceptInbox`
 *   exactly (never the general, multi-caller `acceptInbox` surface -- see
 *   §6). `messageKey` and `payloadHash` are likewise NEVER accepted:
 *   `messageKey` is derived server-side from the sanitized envelope's own
 *   `sourceConnectionId`/`signalId` fields using the SQL translation of
 *   `stableHash` (`stableHashInputSql`, reused byte-for-byte from
 *   `postgres-signal-attribution-receipt-apply.ts`'s own helper of the same
 *   name); `payloadHash` is derived the same way from the accepted
 *   `payloadJson` alone. There is nothing left for a caller to submit that
 *   could legitimately disagree with the envelope it already carries.
 *
 *   What genuinely CANNOT be derived here, and so is accepted as caller
 *   input, validated structurally: the sanitized envelope JSON itself
 *   (`payloadJson`). `sanitizeDiagnosticData`'s recursive, depth-capped,
 *   regex-driven redaction is exactly the kind of "narrative"
 *   business-logic transform attribution-receipt-apply's own header
 *   discusses (its `outcome`/`reasonCode` fields) -- not sensibly
 *   reproduced a second time in PL/pgSQL. This boundary instead requires
 *   the caller to have ALREADY run the real `sanitizeDiagnosticData` (this
 *   module's own normalizer does so, importing it directly from
 *   `domain/src/redaction.js`) and validates only the RESULT's shape,
 *   size, and the two fields it must extract (`sourceConnectionId`,
 *   `signalId`) -- never the redaction itself.
 *
 * ---------------------------------------------------------------------
 * 5. `inbox_messages` / `hosted_delivery_receipts` SCHEMA (migrations.ts:
 *    949-986)
 * ---------------------------------------------------------------------
 *   `inbox_messages`: `UNIQUE(tenant_id, user_id, source, message_key)`;
 *   `state` CHECKed to the five values used above; `delivery_attempts`
 *   CHECKed 0-20; both tenant_id/user_id `REFERENCES ... ON DELETE CASCADE`.
 *   `hosted_delivery_receipts`: `user_id REFERENCES users(id) ON DELETE SET
 *   NULL` (the one nullable FK here -- irrelevant to this boundary, which
 *   only ever INSERTs fresh rows with a live, session-resolved `user_id`,
 *   never reads one back); `disposition` CHECKed to a seven-value enum
 *   (this boundary only ever writes `'accepted'`/`'deduped'`, the other
 *   five belong to `leaseInbox`/`completeInbox`/`retryInbox`, out of
 *   scope); `attempt` CHECKed 0-20. Neither table has an append-only
 *   trigger in SQLite (unlike `background_task_events`) -- `inbox_messages`
 *   is mutated by later lifecycle calls (lease/complete/retry, all out of
 *   scope for this boundary, which only ever INSERTs) and
 *   `hosted_delivery_receipts` is genuinely insert-only by construction
 *   (no repository method ever UPDATEs or DELETEs a receipt row), which is
 *   why this boundary's own function never issues an `UPDATE`/`DELETE`
 *   against either table.
 *
 * ---------------------------------------------------------------------
 * 6. WHAT STAYS OUT OF SCOPE
 * ---------------------------------------------------------------------
 *   - The GENERAL, non-signal `HostedDeliveryRepository.acceptInbox` caller
 *     (apps/api/src/app.ts:2113, `hostedDelivery.acceptInbox(body)`) --
 *     unscoped `source`/`eventType`, a completely different, request-driven
 *     write family. This boundary hardcodes `source = 'trackalacker'` and
 *     `eventType = SIGNAL_INGRESS_EVENT_TYPE`, matching ONLY
 *     `acceptTrackalacker`'s call, exactly the same "narrow to the real
 *     caller, not the general repository method" discipline
 *     `postgres-signal-attribution-receipt-apply.ts` used for
 *     `AttributionRepository.recordReceipt`.
 *   - `BackgroundTaskRepository.enqueueServiceTask` itself -- covered by
 *     reference, not reimplemented; see §2.
 *   - `leaseInbox`/`completeInbox`/`retryInbox`/`recoverExpiredLeases` and
 *     `DurableSignalIngressService.retryDeadLetter`/
 *     `DurableSignalIngressProcessor.processBatch` -- the DEQUEUE/PROCESSING
 *     half of the inbox lifecycle, already covered by
 *     `postgres-hosted-delivery-lease-recovery.ts`'s
 *     `yoink_transition_trackalacker_signal_inbox` function
 *     (`signalInboxLifecycleRepositoryParity: true`) and
 *     `yoink_recover_hosted_delivery_leases`. This module is strictly the
 *     missing INITIAL-enqueue half those two functions explicitly
 *     disclaim.
 *   - Composing this module's function with the queue-writer's
 *     `enqueueServiceTask` equivalent into ONE atomic caller-side operation
 *     that flips `signalIngressRepositoryParity` to `true` -- that flag
 *     also requires binding `hostedDeliveryLeaseRecovery` (the plan/dequeue
 *     half) and the resolution-plan function, none of which this module
 *     touches. `signalIngressRepositoryParity` stays `false` here; only a
 *     future composition rung (mirroring
 *     `postgres-signal-evaluation-repository-composition.ts`'s own
 *     five-member fan-in) can honestly flip it.
 *
 * ---------------------------------------------------------------------
 * 7. JUDGMENT CALLS FOR REVIEWER SCRUTINY
 * ---------------------------------------------------------------------
 *   - Deriving `messageKey`/`payloadHash` server-side (rather than
 *     accepting and cross-checking them) is a strictly TIGHTER boundary
 *     than accepting-and-validating would be, at the cost of requiring the
 *     caller to submit the pre-sanitized envelope and nothing else --
 *     judged worth it given every other field the real call site would
 *     otherwise submit is fully recoverable from that envelope alone.
 *   - Deterministic, `request_id`-derived receipt ids (§3) are a deliberate
 *     STRICTER-than-SQLite replay-safety improvement, not a reproduction of
 *     SQLite's own (weaker, random-id) behavior. Every other field
 *     (disposition, state, payload hash, timestamps) still matches SQLite's
 *     real values exactly; only the internal ledger-row identity differs,
 *     and that identity is never observed by any caller (the returned
 *     snapshot's `id` is always the INBOX message id, matching
 *     `HostedInboxReceipt.id` exactly -- see §1).
 *   - `sourceConnectionId`/`signalId` are validated structurally (non-empty,
 *     byte-bounded, control-character-free) rather than against
 *     `normalizeSignal`'s exact `cleanText` semantics -- reproducing
 *     `cleanText`'s whitespace-collapsing exactly in PL/pgSQL was judged
 *     not worth it: both fields are already `cleanText`-normalized (and
 *     `sanitizeDiagnosticData`-safe-texted on top) by the time they reach
 *     this boundary, so this SQL only needs to defend against a corrupted
 *     or hand-crafted `payloadJson` bypassing the TS layer entirely, not to
 *     re-run the normalization a second time.
 */

export const POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_RECEIPT_TABLE =
  "yoink_signal_ingress_enqueue_apply_receipt";
export const POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_FUNCTION =
  "yoink_accept_signal_ingress_inbox";
export const POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONFIRMATION =
  "SIGNAL_INGRESS_ACCEPT_V1";

/** Mirrors `SIGNAL_INGRESS_EVENT_TYPE` (contracts/src/signal-ingress.ts:3)
 * and `acceptTrackalacker`'s hardcoded `source: "trackalacker"`
 * (signal-ingress.ts:81) -- both baked into this boundary's SQL as
 * literals, never accepted as caller input; see module header §4/§6. */
export const POSTGRES_SIGNAL_INGRESS_SOURCE = "trackalacker";
export const POSTGRES_SIGNAL_INGRESS_EVENT_TYPE = "signal_event_v1";

const MAXIMUM_ENVELOPE_JSON_BYTES = 65_536;
const MAXIMUM_REQUEST_PAYLOAD_BYTES = 150_000;
const MAXIMUM_SOURCE_CONNECTION_ID_BYTES = 480;
const MAXIMUM_SIGNAL_ID_BYTES = 720;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const REQUEST_ID = /^signal_ingress_accept_[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const INBOX_ID = /^inbox_[a-f0-9]{32}$/;
/** The thirteen top-level keys `durableSignal` always produces
 * (signal-ingress.ts:29-58) -- kept in exact sync with that function; a
 * drift there must be reflected here too (see module header §4). */
const DURABLE_SIGNAL_ENVELOPE_KEYS = Object.freeze([
  "schemaVersion", "signalId", "sourceConnectionId", "source", "externalEventId",
  "eventType", "observedAt", "receivedAt", "test", "identity", "offer", "evidence",
  "parserVersion"
] as const);
const DURABLE_SIGNAL_STATES = Object.freeze([
  "accepted", "processing", "processed", "failed", "dead_letter"
] as const);
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text"
] as const);
const FUNCTION_ARGUMENTS_SQL = `
  expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
  request_id TEXT, request_payload_json TEXT
`;
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TENANT_TABLES = Object.freeze([
  "hosted_delivery_receipts", "inbox_messages"
] as const);
const MUTATION_TABLES = Object.freeze([
  "hosted_delivery_receipts", "inbox_messages"
] as const);

export type PostgresSignalIngressEnqueueOperation = "accept_signal_ingress";

export interface PostgresSignalIngressAcceptPayload {
  payloadJson: string;
  confirmation: typeof POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONFIRMATION;
}

export interface PostgresSignalIngressAcceptSnapshot {
  id: string;
  disposition: "accepted" | "deduped";
  state: typeof DURABLE_SIGNAL_STATES[number];
  payloadHash: string;
  receivedAt: string;
}

type PostgresSignalAttributionReceiptPredecessor = Pick<
  PostgresSignalAttributionReceiptApplyManifest,
  "schemaName" | "fingerprint" | "attributionReceiptRoleNamespace"
>;

type PostgresTenantQueueWriteConsumedManifest = Pick<
  PostgresTenantQueueWriteManifest,
  "schemaName" | "readRoleNamespace" | "sessionRoleNamespace" | "writeRoleNamespace" | "fingerprint"
>;

export interface PostgresSignalIngressEnqueueApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  attributionReceiptApplyContractVersion: 1;
  tenantQueueWriteContractVersion: 3;
  schemaName: string;
  ingressAcceptRoleNamespace: string;
  attributionReceiptApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalAttributionReceiptPredecessor;
  queueWriteManifestFingerprint: string;
  queueWriteManifest: PostgresTenantQueueWriteConsumedManifest;
  ingressAcceptRole: {
    kind: "signal_ingress_enqueue_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 1;
  hardcodedSource: typeof POSTGRES_SIGNAL_INGRESS_SOURCE;
  hardcodedEventType: typeof POSTGRES_SIGNAL_INGRESS_EVENT_TYPE;
  envelopeKeyCount: 13;
  protectedTenantTableCount: 2;
  forcedRlsTableCount: 2;
  mutationTableCount: 2;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  callerScopeHardcoded: true;
  messageKeyDatabaseDerived: true;
  payloadHashDatabaseDerived: true;
  sanitizedEnvelopeAcceptedAsInput: true;
  conflictingContentFailsClosed: true;
  receiptLedgerAppendOnly: true;
  deterministicRequestIdentity: true;
  deterministicReceiptIdentity: true;
  databaseOwnedTimestamps: true;
  writerLockProtocolConsumed: false;
  queueWriteBoundaryConsumed: true;
  // World-state carried forward unchanged from
  // postgres-signal-attribution-receipt-apply.ts (v0.97), plus this
  // boundary's own new closure.
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
  attributionReceiptWriterParity: true;
  writerLockProtocolParity: false;
  // Closes `DurableSignalIngressService`'s own enqueue path (the
  // `HostedDeliveryRepository.acceptInbox` half only -- see module header
  // §2), the out-of-scope write family named in
  // `POSTGRES_SIGNAL_EVALUATION_REPOSITORY_KNOWN_OUT_OF_SCOPE_WRITES`.
  ingressEnqueueWriterParity: true;
  // Stays false until a future composition rung binds this module,
  // hostedDeliveryLeaseRecovery, and the resolution-plan function together
  // -- see module header §6.
  signalIngressRepositoryParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalIngressEnqueueApplyCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  attributionReceiptApplyContractVersion: 1;
  tenantQueueWriteContractVersion: 3;
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
  callerScopeHardcoded: true;
  messageKeyDatabaseDerived: true;
  payloadHashDatabaseDerived: true;
  sanitizedEnvelopeAcceptedAsInput: true;
  conflictingContentFailsClosed: true;
  receiptLedgerAppendOnly: true;
  deterministicRequestIdentity: true;
  deterministicReceiptIdentity: true;
  databaseOwnedTimestamps: true;
  writerLockProtocolConsumed: false;
  queueWriteBoundaryConsumed: true;
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
  attributionReceiptWriterParity: true;
  writerLockProtocolParity: false;
  ingressEnqueueWriterParity: true;
  signalIngressRepositoryParity: false;
  operationCount: 1;
  envelopeKeyCount: 13;
  protectedTenantTableCount: 2;
  forcedRlsTableCount: 2;
  mutationTableCount: 2;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: false;
  actionAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalIngressAcceptResult {
  contractVersion: 1;
  operation: PostgresSignalIngressEnqueueOperation;
  requestId: string;
  requestFingerprint: string;
  disposition: "accepted" | "deduped";
  inboxMutated: boolean;
  receiptMutated: boolean;
  mutationStatementCount: 1 | 2;
  mutationRowCount: number;
  receipt: PostgresSignalIngressAcceptSnapshot;
  ingressEnqueueWriterParity: true;
  signalIngressRepositoryParity: false;
  writerLockProtocolParity: false;
  queueWriteBoundaryConsumed: true;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: false;
  actionAuthority: false;
  runtimeAuthority: false;
}

export interface NodePostgresSignalIngressEnqueueApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalIngressEnqueueApplyCapabilityProjection> | null = null;

export class PostgresSignalIngressEnqueueApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalIngressEnqueueApplyQualificationError";
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
    throw new PostgresSignalIngressEnqueueApplyQualificationError(
      "The PostgreSQL signal-ingress schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalIngressEnqueueApplyQualificationError(
      "The PostgreSQL signal-ingress role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_signal_ingress_accept`;
  if (value.length > 63) {
    throw new PostgresSignalIngressEnqueueApplyQualificationError(
      "The PostgreSQL signal-ingress role name exceeds PostgreSQL's limit."
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

/** SQL translation of `stableHashInput`/`stableHash` (domain/src/ids.ts),
 * reused byte-for-byte from postgres-signal-attribution-receipt-apply.ts's
 * own helper of the same name: each part contributes its UTF-8 byte length,
 * ':', and the part itself, joined with '|'. */
function stableHashInputSql(parts: string[]): string {
  return parts.map((part) => (
    `pg_catalog.octet_length(${part})::text || ':' || ${part}`
  )).join(" || '|' || ");
}

/** Mirrors hosted-delivery-repository.ts's private, unexported `stableJson`
 * helper (:89-94) exactly: a recursively key-sorted canonical JSON
 * serialization. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

/** Mirrors `DurableSignalIngressService`'s private, unexported
 * `durableSignal` helper (packages/engine/src/signal-ingress.ts:29-58)
 * exactly: `normalizeSignal` plus the hardcoded
 * trackalacker/trackalacker-push-v1 assertion, reshaped to the thirteen-key
 * envelope. */
function durableSignalEnvelope(input: SignalEventInput, now: number): Record<string, unknown> {
  const normalized = normalizeSignal(input, now);
  if (normalized.source !== POSTGRES_SIGNAL_INGRESS_SOURCE || normalized.parserVersion !== "trackalacker-push-v1") {
    throw new PostgresSignalIngressEnqueueApplyQualificationError(
      "Durable TrackaLacker ingress requires the packaged parser contract."
    );
  }
  return {
    schemaVersion: normalized.schemaVersion,
    signalId: normalized.signalId,
    sourceConnectionId: normalized.sourceConnectionId,
    source: normalized.source,
    externalEventId: normalized.externalEventId,
    eventType: normalized.eventType,
    observedAt: normalized.observedAt,
    receivedAt: normalized.receivedAt,
    test: normalized.test,
    identity: normalized.identity,
    offer: {
      availability: normalized.offer.availability,
      unitPriceCents: normalized.offer.unitPriceCents,
      currency: normalized.offer.currency,
      sellerName: normalized.offer.sellerName,
      sellerType: normalized.offer.sellerType,
      orderLimit: normalized.offer.orderLimit,
      fulfillment: normalized.offer.fulfillment,
      offerFingerprint: normalized.offer.offerFingerprint
    },
    evidence: normalized.evidence,
    parserVersion: normalized.parserVersion
  };
}

/**
 * Normalizes a durable-signal `(input, now)` pair -- exactly
 * `acceptTrackalacker`'s own `durableSignal(input, now)` call
 * (signal-ingress.ts:70) plus `acceptInbox`'s own `normalizedPayload`
 * (hosted-delivery-repository.ts:96-102) -- into the minimal payload shape
 * this boundary's function accepts. `source`, `eventType`, and `messageKey`
 * are deliberately absent: they are either hardcoded SQL literals or
 * database-derived from the envelope itself; see module header §4.
 */
export function normalizedPostgresSignalIngressAcceptPayload(
  input: SignalEventInput,
  now = Date.now()
): PostgresSignalIngressAcceptPayload {
  const envelope = durableSignalEnvelope(input, now);
  const sanitized = sanitizeDiagnosticData(envelope);
  const payloadJson = stableJson(sanitized);
  if (Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_ENVELOPE_JSON_BYTES) {
    throw new PostgresSignalIngressEnqueueApplyQualificationError(
      "The PostgreSQL signal-ingress sanitized envelope is too large."
    );
  }
  return { payloadJson, confirmation: POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONFIRMATION };
}

/**
 * Derives the deterministic request id from the principal and the complete
 * normalized payload -- this boundary has exactly one operation, baked into
 * the id's own literal prefix (`signal_ingress_accept_`), matching
 * `postgres-signal-attribution-receipt-apply.ts`'s single-operation choice
 * to omit `operation_name` from its hash input too.
 */
export function buildPostgresSignalIngressAcceptRequestId(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  payload: PostgresSignalIngressAcceptPayload
): string {
  const parts = [
    "postgres-signal-ingress-accept-request-v1",
    String(principal?.tenantId ?? ""),
    String(principal?.userId ?? ""),
    String(payload?.payloadJson ?? ""),
    String(payload?.confirmation ?? "")
  ];
  return `signal_ingress_accept_${createHash("sha256")
    .update(stableHashInput(parts)).digest("hex").slice(0, 32)}`;
}

export function buildPostgresSignalIngressEnqueueApplyManifest(
  predecessorManifest = buildPostgresSignalAttributionReceiptApplyManifest(),
  requestedRoleNamespace = "yoink_signal_ingress_accept_qual",
  requestedQueueWriteManifest: PostgresTenantQueueWriteManifest =
    buildPostgresTenantQueueWriteManifest(predecessorManifest.schemaName)
): PostgresSignalIngressEnqueueApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  if (requestedQueueWriteManifest.schemaName !== schemaName) {
    throw new PostgresSignalIngressEnqueueApplyQualificationError(
      "The PostgreSQL signal-ingress queue-write schema must match the predecessor schema."
    );
  }
  const ingressAcceptRoleNamespace = safeNamespace(requestedRoleNamespace);
  const reservedNamespaces = collectRoleNamespaces(predecessorManifest);
  collectRoleNamespaces(requestedQueueWriteManifest, reservedNamespaces);
  if (reservedNamespaces.has(ingressAcceptRoleNamespace)) {
    throw new PostgresSignalIngressEnqueueApplyQualificationError(
      "The PostgreSQL signal-ingress role namespace must be independent."
    );
  }
  const queueWriteManifest: PostgresTenantQueueWriteConsumedManifest = {
    schemaName: requestedQueueWriteManifest.schemaName,
    readRoleNamespace: requestedQueueWriteManifest.readRoleNamespace,
    sessionRoleNamespace: requestedQueueWriteManifest.sessionRoleNamespace,
    writeRoleNamespace: requestedQueueWriteManifest.writeRoleNamespace,
    fingerprint: requestedQueueWriteManifest.fingerprint
  };
  const withoutFingerprint: Omit<PostgresSignalIngressEnqueueApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    attributionReceiptApplyContractVersion: POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONTRACT_VERSION,
    tenantQueueWriteContractVersion: POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
    schemaName,
    ingressAcceptRoleNamespace,
    attributionReceiptApplyManifestFingerprint: predecessorManifest.fingerprint,
    // Store the FULL predecessor manifest object (type-narrowed to the Pick):
    // the ancestral verify chain dereferences fields far beyond the Pick, and
    // a hollow literal collapses every downstream default to yoink_cutover.
    predecessorManifest,
    queueWriteManifestFingerprint: queueWriteManifest.fingerprint,
    queueWriteManifest,
    ingressAcceptRole: {
      kind: "signal_ingress_enqueue_apply_boundary",
      name: roleName(ingressAcceptRoleNamespace),
      functionName: POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 1,
    hardcodedSource: POSTGRES_SIGNAL_INGRESS_SOURCE,
    hardcodedEventType: POSTGRES_SIGNAL_INGRESS_EVENT_TYPE,
    envelopeKeyCount: 13,
    protectedTenantTableCount: 2,
    forcedRlsTableCount: 2,
    mutationTableCount: 2,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    callerScopeHardcoded: true,
    messageKeyDatabaseDerived: true,
    payloadHashDatabaseDerived: true,
    sanitizedEnvelopeAcceptedAsInput: true,
    conflictingContentFailsClosed: true,
    receiptLedgerAppendOnly: true,
    deterministicRequestIdentity: true,
    deterministicReceiptIdentity: true,
    databaseOwnedTimestamps: true,
    writerLockProtocolConsumed: false,
    queueWriteBoundaryConsumed: true,
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
    attributionReceiptWriterParity: true,
    writerLockProtocolParity: false,
    ingressEnqueueWriterParity: true,
    signalIngressRepositoryParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

function resultSql(disposition: "accepted" | "deduped"): string {
  return `pg_catalog.jsonb_build_object(
    'contractVersion', 1, 'operation', operation_name,
    'requestId', request_id, 'requestFingerprint', request_fingerprint_value,
    'disposition', '${disposition}',
    'inboxMutated', ${disposition === "accepted" ? "TRUE" : "FALSE"},
    'receiptMutated', receipt_affected_rows = 1,
    'mutationStatementCount', ${disposition === "accepted" ? "2" : "1"},
    'mutationRowCount', ${disposition === "accepted" ? "1" : "0"} + receipt_affected_rows,
    'receipt', receipt_result_value,
    'ingressEnqueueWriterParity', TRUE, 'signalIngressRepositoryParity', FALSE,
    'writerLockProtocolParity', FALSE, 'queueWriteBoundaryConsumed', TRUE,
    'mutationAuthority', TRUE, 'sharedCatalogMutationAuthority', FALSE,
    'actionAuthority', FALSE, 'runtimeAuthority', FALSE
  )`;
}

export function signalIngressEnqueueApplyFunctionSource(
  manifest = buildPostgresSignalIngressEnqueueApplyManifest()
): string {
  const requestIdentityParts = stableHashInputSql([
    "'postgres-signal-ingress-accept-request-v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "payload_json_value",
    `'${POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONFIRMATION}'::text`
  ]);
  // stableHash (domain/src/ids.ts) terminates EVERY part with '|', including
  // the last — unlike this module's request-identity convention, which joins
  // with '|' as a separator only. The four hashes below claim byte-for-byte
  // stableHash parity, so the trailing terminator is appended explicitly.
  const payloadHashParts = stableHashInputSql([
    "'hosted_delivery_payload_v1'::text",
    "payload_json_value"
  ]) + " || '|'";
  const messageKeyParts = stableHashInputSql([
    "'yoink_durable_signal_ingress_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "source_connection_id_value",
    "signal_id_value"
  ]) + " || '|'";
  const dedupeReceiptHashParts = stableHashInputSql([
    "'hosted_delivery_receipt_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'inbox'::text",
    "existing_row.id",
    "'deduped'::text",
    "existing_row.delivery_attempts::text",
    "'same_payload'::text",
    "mutation_timestamp"
  ]) + " || '|'";
  const acceptReceiptHashParts = stableHashInputSql([
    "'hosted_delivery_receipt_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'inbox'::text",
    "inbox_id_value",
    "'accepted'::text",
    "'0'::text",
    "'new_message'::text",
    "mutation_timestamp"
  ]) + " || '|'";
  const envelopeKeysSql = DURABLE_SIGNAL_ENVELOPE_KEYS.map((key) => `'${key}'`).join(", ");
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  derived_request_id TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  payload_json_value TEXT;
  signal_envelope JSONB;
  source_connection_id_value TEXT;
  signal_id_value TEXT;
  payload_hash_value TEXT;
  message_key_value TEXT;
  existing_row RECORD;
  found_existing BOOLEAN;
  inbox_id_value TEXT;
  receipt_id_value TEXT;
  receipt_hash_value TEXT;
  mutation_timestamp TEXT;
  affected_rows BIGINT;
  receipt_affected_rows BIGINT;
  receipt_result_value JSONB;
  result_value JSONB;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name <> 'accept_signal_ingress'
    OR request_id !~ '^signal_ingress_accept_[a-f0-9]{32}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal ingress accept request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal ingress accept payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR request_payload - ARRAY['payloadJson', 'confirmation']::text[] IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 2
    OR pg_catalog.jsonb_typeof(request_payload->'payloadJson') IS DISTINCT FROM 'string'
    OR pg_catalog.octet_length(request_payload->>'payloadJson') NOT BETWEEN 1 AND ${MAXIMUM_ENVELOPE_JSON_BYTES}
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> '${POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONFIRMATION}' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal ingress accept payload shape is invalid';
  END IF;
  payload_json_value := request_payload->>'payloadJson';

  BEGIN
    signal_envelope := payload_json_value::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal ingress sanitized envelope is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(signal_envelope) IS DISTINCT FROM 'object'
    OR signal_envelope - ARRAY[${envelopeKeysSql}]::text[] IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(signal_envelope)) <> ${DURABLE_SIGNAL_ENVELOPE_KEYS.length}
    OR pg_catalog.jsonb_typeof(signal_envelope->'sourceConnectionId') IS DISTINCT FROM 'string'
    OR pg_catalog.octet_length(signal_envelope->>'sourceConnectionId') NOT BETWEEN 1 AND ${MAXIMUM_SOURCE_CONNECTION_ID_BYTES}
    OR signal_envelope->>'sourceConnectionId' ~ '[[:cntrl:]]'
    OR pg_catalog.jsonb_typeof(signal_envelope->'signalId') IS DISTINCT FROM 'string'
    OR pg_catalog.octet_length(signal_envelope->>'signalId') NOT BETWEEN 1 AND ${MAXIMUM_SIGNAL_ID_BYTES}
    OR signal_envelope->>'signalId' ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal ingress sanitized envelope shape is invalid';
  END IF;
  source_connection_id_value := signal_envelope->>'sourceConnectionId';
  signal_id_value := signal_envelope->>'signalId';

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

  derived_request_id := 'signal_ingress_accept_' || pg_catalog.substr(
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      ${requestIdentityParts}, 'UTF8'
    )), 'hex'), 1, 32
  );
  IF request_id <> derived_request_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal ingress accept request identity is invalid';
  END IF;
  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(request_payload::text, 'UTF8')
  ), 'hex');

  -- Both messageKey and payloadHash are database-derived from the
  -- envelope alone -- never accepted as caller input; see module header §4.
  payload_hash_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    ${payloadHashParts}, 'UTF8'
  )), 'hex');
  message_key_value := 'signal:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    ${messageKeyParts}, 'UTF8'
  )), 'hex');
  mutation_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  -- inbox_messages is UNIQUE(tenant_id, user_id, source, message_key),
  -- mirroring SQLite's own lookup exactly (source/eventType are the SQL
  -- literals 'trackalacker'/'signal_event_v1' -- see module header §4/§6).
  SELECT message.id, message.event_type, message.payload_hash, message.state,
         message.received_at, message.delivery_attempts
    INTO existing_row
  FROM ${relation(manifest.schemaName, "inbox_messages")} AS message
  WHERE message.tenant_id = resolved_tenant_id AND message.user_id = resolved_user_id
    AND message.source = '${POSTGRES_SIGNAL_INGRESS_SOURCE}' AND message.message_key = message_key_value;
  found_existing := FOUND;

  IF NOT found_existing THEN
    inbox_id_value := 'inbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(
        'postgres_signal_ingress_accept_inbox_v1|' || resolved_tenant_id || '|' ||
        resolved_user_id || '|' || message_key_value, 'UTF8'
      )
    ), 'hex'), 1, 32);
    INSERT INTO ${relation(manifest.schemaName, "inbox_messages")}(
      id, tenant_id, user_id, source, message_key, event_type, payload_hash,
      payload_json, state, received_at, updated_at
    ) VALUES (
      inbox_id_value, resolved_tenant_id, resolved_user_id,
      '${POSTGRES_SIGNAL_INGRESS_SOURCE}', message_key_value, '${POSTGRES_SIGNAL_INGRESS_EVENT_TYPE}',
      payload_hash_value, payload_json_value, 'accepted', mutation_timestamp, mutation_timestamp
    )
    ON CONFLICT (tenant_id, user_id, source, message_key) DO NOTHING;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows = 0 THEN
      -- Lost a race to a concurrent call for the same signal between the
      -- lookup above and this INSERT. Re-fetch the winner's row (the
      -- unique key guarantees exactly one) and fall through to the same
      -- dedupe/conflict handling below.
      SELECT message.id, message.event_type, message.payload_hash, message.state,
             message.received_at, message.delivery_attempts
        INTO STRICT existing_row
      FROM ${relation(manifest.schemaName, "inbox_messages")} AS message
      WHERE message.tenant_id = resolved_tenant_id AND message.user_id = resolved_user_id
        AND message.source = '${POSTGRES_SIGNAL_INGRESS_SOURCE}' AND message.message_key = message_key_value;
      found_existing := TRUE;
    ELSE
      -- Fresh accept: mirrors acceptInbox's own transaction exactly --
      -- inbox_messages INSERT, then recordReceipt("accepted", attempt 0,
      -- "new_message"). No audit_events/outbox_events -- acceptInbox never
      -- writes either (see module header §1).
      receipt_id_value := 'delivery_receipt_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to(
          'postgres_signal_ingress_accept_receipt_v1|' || resolved_tenant_id || '|' ||
          resolved_user_id || '|' || request_id, 'UTF8'
        )
      ), 'hex'), 1, 32);
      receipt_hash_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        ${acceptReceiptHashParts}, 'UTF8'
      )), 'hex');
      INSERT INTO ${relation(manifest.schemaName, "hosted_delivery_receipts")}(
        id, tenant_id, user_id, direction, message_id, disposition,
        attempt, reason_code, receipt_hash, created_at
      ) VALUES (
        receipt_id_value, resolved_tenant_id, resolved_user_id, 'inbox', inbox_id_value,
        'accepted', 0, 'new_message', receipt_hash_value, mutation_timestamp
      )
      ON CONFLICT (id) DO NOTHING;
      GET DIAGNOSTICS receipt_affected_rows = ROW_COUNT;
      receipt_result_value := pg_catalog.jsonb_build_object(
        'id', inbox_id_value, 'disposition', 'accepted', 'state', 'accepted',
        'payloadHash', payload_hash_value, 'receivedAt', mutation_timestamp
      );
      result_value := ${resultSql("accepted")};
      RETURN QUERY SELECT result_value::text;
      RETURN;
    END IF;
  END IF;

  -- Dedupe/conflict path -- reached either because inbox_messages already
  -- had this (tenant, user, source, message_key), or because a concurrent
  -- caller won the fresh-insert race above.
  IF existing_row.payload_hash <> payload_hash_value
    OR existing_row.event_type <> '${POSTGRES_SIGNAL_INGRESS_EVENT_TYPE}' THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409',
      MESSAGE = 'signal ingress idempotency key was already used for different content';
  END IF;
  receipt_id_value := 'delivery_receipt_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_ingress_accept_receipt_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  receipt_hash_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    ${dedupeReceiptHashParts}, 'UTF8'
  )), 'hex');
  INSERT INTO ${relation(manifest.schemaName, "hosted_delivery_receipts")}(
    id, tenant_id, user_id, direction, message_id, disposition,
    attempt, reason_code, receipt_hash, created_at
  ) VALUES (
    receipt_id_value, resolved_tenant_id, resolved_user_id, 'inbox', existing_row.id,
    'deduped', existing_row.delivery_attempts, 'same_payload', receipt_hash_value, mutation_timestamp
  )
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS receipt_affected_rows = ROW_COUNT;
  receipt_result_value := pg_catalog.jsonb_build_object(
    'id', existing_row.id, 'disposition', 'deduped', 'state', existing_row.state,
    'payloadHash', existing_row.payload_hash, 'receivedAt', existing_row.received_at
  );
  result_value := ${resultSql("deduped")};
  RETURN QUERY SELECT result_value::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalIngressEnqueueApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_ingress_enqueue_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.ingressAcceptRole.name,
    functionName: POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalIngressEnqueueApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_ingress_enqueue_apply_receipt",
    receiptTriggerName: "yoink_signal_ingress_enqueue_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.attributionReceiptApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      attributionReceiptApplyContractVersion: 1,
      tenantQueueWriteContractVersion: 3,
      operationCount: 1,
      hardcodedSource: POSTGRES_SIGNAL_INGRESS_SOURCE,
      hardcodedEventType: POSTGRES_SIGNAL_INGRESS_EVENT_TYPE,
      envelopeKeyCount: 13,
      queueWriteManifestFingerprint: manifest.queueWriteManifestFingerprint,
      serverBoundPrincipalLookup: true,
      callerScopeHardcoded: true,
      messageKeyDatabaseDerived: true,
      payloadHashDatabaseDerived: true,
      sanitizedEnvelopeAcceptedAsInput: true,
      conflictingContentFailsClosed: true,
      receiptLedgerAppendOnly: true,
      deterministicRequestIdentity: true,
      deterministicReceiptIdentity: true,
      databaseOwnedTimestamps: true,
      writerLockProtocolConsumed: false,
      queueWriteBoundaryConsumed: true,
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
      attributionReceiptWriterParity: true,
      writerLockProtocolParity: false,
      ingressEnqueueWriterParity: true,
      signalIngressRepositoryParity: false,
      sharedCatalogMutationAuthority: false,
      actionAuthority: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalIngressEnqueueApplyCapabilityProjection():
PostgresSignalIngressEnqueueApplyCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalIngressEnqueueApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    attributionReceiptApplyContractVersion: 1,
    tenantQueueWriteContractVersion: 3,
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
    callerScopeHardcoded: true,
    messageKeyDatabaseDerived: true,
    payloadHashDatabaseDerived: true,
    sanitizedEnvelopeAcceptedAsInput: true,
    conflictingContentFailsClosed: true,
    receiptLedgerAppendOnly: true,
    deterministicRequestIdentity: true,
    deterministicReceiptIdentity: true,
    databaseOwnedTimestamps: true,
    writerLockProtocolConsumed: false,
    queueWriteBoundaryConsumed: true,
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
    attributionReceiptWriterParity: true,
    writerLockProtocolParity: false,
    ingressEnqueueWriterParity: true,
    signalIngressRepositoryParity: false,
    operationCount: 1,
    envelopeKeyCount: 13,
    protectedTenantTableCount: 2,
    forcedRlsTableCount: 2,
    mutationTableCount: 2,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: true,
    sharedCatalogMutationAuthority: false,
    actionAuthority: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

export type PostgresSignalIngressEnqueueApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalIngressEnqueueApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalIngressEnqueueApplyManifest()
): Promise<PostgresSignalIngressEnqueueApplyQualificationReceipt> {
  await verifyPostgresSignalAttributionReceiptApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalAttributionReceiptApplyManifest
  );
  await verifyPostgresTenantQueueWriteBoundary(
    database,
    manifest.queueWriteManifest.schemaName,
    manifest.queueWriteManifest.readRoleNamespace,
    manifest.queueWriteManifest.sessionRoleNamespace,
    manifest.queueWriteManifest.writeRoleNamespace
  );
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalIngressEnqueueApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalIngressEnqueueApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalIngressEnqueueApplyQualificationReceipt> {
  await verifyPostgresSignalAttributionReceiptApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalAttributionReceiptApplyManifest
  );
  // Verify only -- creating postgres-tenant-queue-writes.ts's own
  // role/grant/policy surface remains solely that module's own
  // qualification flow; see module header §2.
  await verifyPostgresTenantQueueWriteBoundary(
    database,
    manifest.queueWriteManifest.schemaName,
    manifest.queueWriteManifest.readRoleNamespace,
    manifest.queueWriteManifest.sessionRoleNamespace,
    manifest.queueWriteManifest.writeRoleNamespace
  );
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalIngressEnqueueApplyQualificationError(
      `The PostgreSQL signal-ingress ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalIngressEnqueueOperation,
  requestId: string
): PostgresSignalIngressAcceptResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalIngressEnqueueApplyQualificationError(
      "The PostgreSQL signal-ingress accept result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const disposition = String(result.disposition ?? "");
  const receipt = result.receipt;
  const stateSet = new Set<string>(DURABLE_SIGNAL_STATES);
  const validReceipt = (entry: unknown): boolean => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const row = entry as Record<string, unknown>;
    return INBOX_ID.test(String(row.id))
      && new Set(["accepted", "deduped"]).has(String(row.disposition))
      && stateSet.has(String(row.state))
      && SHA256.test(String(row.payloadHash))
      && typeof row.receivedAt === "string" && row.receivedAt.length > 0;
  };
  if (result.contractVersion !== 1
    || result.operation !== operation
    || result.requestId !== requestId
    || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["accepted", "deduped"]).has(disposition)
    || typeof result.inboxMutated !== "boolean"
    || typeof result.receiptMutated !== "boolean"
    || (disposition === "accepted" && result.inboxMutated !== true)
    || (disposition === "deduped" && result.inboxMutated !== false)
    || (result.mutationStatementCount !== 1 && result.mutationStatementCount !== 2)
    || (disposition === "accepted" && result.mutationStatementCount !== 2)
    || (disposition === "deduped" && result.mutationStatementCount !== 1)
    || !Number.isSafeInteger(result.mutationRowCount)
    || Number(result.mutationRowCount) < 0 || Number(result.mutationRowCount) > 2
    || (disposition === "accepted"
      && (Number(result.mutationRowCount) < 1 || Number(result.mutationRowCount) > 2))
    || (disposition === "deduped"
      && (Number(result.mutationRowCount) < 0 || Number(result.mutationRowCount) > 1))
    || !validReceipt(receipt)
    || result.ingressEnqueueWriterParity !== true
    || result.signalIngressRepositoryParity !== false
    || result.writerLockProtocolParity !== false
    || result.queueWriteBoundaryConsumed !== true
    || result.mutationAuthority !== true
    || result.sharedCatalogMutationAuthority !== false
    || result.actionAuthority !== false
    || result.runtimeAuthority !== false) {
    throw new PostgresSignalIngressEnqueueApplyQualificationError(
      "The PostgreSQL signal-ingress accept result contract changed."
    );
  }
  return result as unknown as PostgresSignalIngressAcceptResult;
}

export class NodePostgresSignalIngressEnqueueApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalIngressEnqueueApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalIngressEnqueueApplyManifest(),
    options: NodePostgresSignalIngressEnqueueApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalIngressEnqueueApplyQualificationError(
        "The PostgreSQL signal-ingress connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_ingress_enqueue_apply"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_signal_ingress_enqueue_apply");
  }

  async acceptSignalIngress(
    principal: BackgroundWorkerPrincipal,
    requestIdValue: string,
    requestPayload: PostgresSignalIngressAcceptPayload
  ): Promise<PostgresSignalIngressAcceptResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation: PostgresSignalIngressEnqueueOperation = "accept_signal_ingress";
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (!REQUEST_ID.test(requestId)
      || requestId !== buildPostgresSignalIngressAcceptRequestId({ tenantId, userId }, requestPayload)
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalIngressEnqueueApplyQualificationError(
        "The PostgreSQL signal-ingress accept request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.ingressAcceptRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalIngressEnqueueApplyQualificationError(
          "The PostgreSQL signal-ingress accept function returned an ambiguous result."
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
