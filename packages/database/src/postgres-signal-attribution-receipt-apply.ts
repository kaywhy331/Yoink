import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import type { AttributionPlan } from "../../contracts/src/index.js";
import { isAttributionProvider } from "../../domain/src/attribution.js";
import { cleanText } from "../../domain/src/normalize.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase
} from "./postgres-cutover.js";
import {
  applyPostgresQualifiedFunctionBoundary,
  verifyPostgresQualifiedFunctionBoundary,
  type PostgresQualifiedFunctionBoundaryReceipt,
  type PostgresQualifiedFunctionBoundarySpec
} from "./postgres-qualified-function-boundary.js";
import {
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS,
  POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS,
  buildPostgresSignalAttributionPolicyApplyManifest,
  verifyPostgresSignalAttributionPolicyApplyBoundary,
  type PostgresSignalAttributionPolicyApplyManifest
} from "./postgres-signal-attribution-policy-apply.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

/**
 * PostgreSQL bounded attribution-RECEIPT writer — closes the first of the
 * three write families `postgres-signal-evaluation-composition.ts` records
 * in `POSTGRES_SIGNAL_EVALUATION_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES`:
 * `"AttributionRepository.recordReceipt -> attribution_receipts
 * (governed by postgres-signal-attribution-policy-apply.ts's POLICY table
 * only)"`. This module is that missing governance — a single, independently
 * qualified boundary for the per-job RECEIPT write the composition module
 * explicitly disclaimed. (The composition module itself is not touched
 * here; closing its own accounting is a separate concern.)
 *
 * ---------------------------------------------------------------------
 * 1. SQLITE TRUTH (`AttributionRepository.recordReceipt`,
 *    packages/database/src/attribution-repository.ts:142, and its one
 *    caller `SignalRepository.createActionJob`,
 *    packages/database/src/signal-repository.ts:639)
 * ---------------------------------------------------------------------
 *   `recordReceipt(jobId, plan: AttributionPlan, canonicalUrl, now)` runs
 *   exactly once per job, immediately after `action_jobs` is INSERTed for
 *   a freshly *created* job (`if (created) { ... recordReceipt(...) }` —
 *   never for a replayed/idempotent job lookup). It executes:
 *
 *     INSERT OR IGNORE INTO attribution_receipts(
 *       id, tenant_id, user_id, job_id, policy_id, retailer_id,
 *       provider, outcome, reason_code, route_url, canonical_url_hash,
 *       created_at
 *     ) VALUES (...)
 *
 *   with `id = newId("attribution_receipt")` (random), tenant/user from
 *   `currentRequestScope()`, and every other column read straight off the
 *   `plan: AttributionPlan` object plus
 *   `canonical_url_hash = stableHash("canonical-attribution-url-v1", canonicalUrl)`.
 *   `attribution_receipts` has `UNIQUE(job_id)` (migrations.ts:602) — so
 *   "OR IGNORE" is a true INSERT-OR-IGNORE on that key: a second call for a
 *   job that already has a receipt inserts NOTHING and performs NO
 *   comparison whatsoever against the newly-submitted plan. Only when the
 *   INSERT actually inserts a row (`inserted.changes === 1`) does SQLite
 *   also call `AuditRepository.record(...)` — which itself, in one
 *   transaction, appends BOTH `audit_events` (`aggregateType:
 *   "attribution_receipt"`, `eventType: "attribution_route_recorded"`,
 *   `reasonCode: plan.reasonCode`, `message: "An immutable
 *   attribution-routing receipt was recorded for an action job."`, `data:
 *   { retailerId, provider, outcome, policyId }`) AND `outbox_events`
 *   (audit-repository.ts:38-67). So the true SQLite write set for a FRESH
 *   receipt is three inserts — `attribution_receipts`, `audit_events`,
 *   `outbox_events` — and for a REPLAYED job-id, the true write set is
 *   ZERO (no audit, no outbox, no attribution_receipts touch at all).
 *
 *   What `recordReceipt` NEVER writes or reads back: `AttributionPlan`'s
 *   own `metadata` (howl publisher slug / article URL, or the amazon
 *   associate tag) and `blocked` fields are simply never referenced by
 *   `recordReceipt` — `attribution_receipts` has no metadata column at
 *   all (migrations.ts:589-603). Both fields are dropped by this boundary
 *   too; see `metadataNeverPersisted` below.
 *
 *   `action_jobs` itself already carries a redundant snapshot of three of
 *   the same attribution fields, set from the SAME `plan`/`canonicalUrl`
 *   values in the SAME `createActionJob` call, one statement earlier
 *   (signal-repository.ts:538-539,572-575): `canonical_url`,
 *   `attribution_url` (`= plan.routeUrl`), `attribution_provider`
 *   (`= plan.provider`). `plan.retailerId` is always `listing.retailerId`
 *   (every branch of `buildAttributionPlan`,
 *   packages/domain/src/attribution.ts:170-225), and `listing.retailerId`
 *   is `listings.retailer_id` for `action_jobs.listing_id`. That
 *   redundancy is what lets this boundary DERIVE — never merely trust —
 *   `provider`, `route_url`, and `retailer_id` straight from the already-
 *   persisted job row instead of accepting them from the caller at all;
 *   see section 2.
 *
 * ---------------------------------------------------------------------
 * 2. WHAT THIS BOUNDARY ACCEPTS VS. DERIVES (the "revalidate consistency"
 *    design)
 * ---------------------------------------------------------------------
 *   `provider`, `routeUrl`, and `retailerId` are NOT part of the request
 *   payload. They are read straight off the locked `action_jobs` row (and,
 *   for `retailerId`, its `listings` join) and used directly to build the
 *   receipt — there is nothing for the caller to submit that could ever
 *   legitimately disagree with what the job itself already carries.
 *   `canonicalUrlHash` is derived the same way, hashing the job's own
 *   `canonical_url` column with the SQLite `stableHash` algorithm
 *   reproduced byte-for-byte in SQL (`stableHashInputSql`, mirroring
 *   `stableHash` in domain/src/ids.ts exactly — length-prefixed parts
 *   joined with "|") — no raw canonical URL ever crosses the wire to this
 *   function. `policyId` is looked up from the CURRENT
 *   `attribution_policies` row for the job's (tenant, user, retailer) —
 *   safe to treat as ground truth because that row's `id` is immutable
 *   once provisioned (never re-INSERTed, only UPDATEd — see
 *   `principal-repository.ts`/`database.ts` provisioning, and
 *   postgres-signal-attribution-policy-apply.ts's own `UPDATE`-only
 *   function body) — but the caller still SUBMITS a `policyId`, which is
 *   revalidated for equality against that lookup, since a caller that
 *   somehow observed a different, stale policy id is exactly the
 *   inconsistency this boundary exists to catch.
 *
 *   `outcome` and `reasonCode` are the one part of the SQLite `plan` that
 *   genuinely cannot be derived here: they are the RESULT of
 *   `buildAttributionPlan`'s branching (mode × policy enabled/provider ×
 *   `attributionPolicyValidity`) evaluated in TypeScript at plan-compute
 *   time, not state persisted anywhere queryable. They are accepted as
 *   caller input, restricted to the exact CHECK-constrained enum
 *   (`outcome`) or a bounded lowercase-snake shape (`reasonCode`) — the
 *   same "accept a caller-computed narrative field, validate it
 *   structurally, never silently re-derive business logic in SQL"
 *   discipline `postgres-signal-reservation-lifecycle-apply.ts` already
 *   uses for `releaseReason`, and the same discipline
 *   postgres-signal-attribution-policy-apply.ts already uses to justify
 *   NOT reproducing `normalizedArticleBaseUrl`'s full URL semantics in
 *   PL/pgSQL.
 *
 * ---------------------------------------------------------------------
 * 3. THE "INSERT OR IGNORE" IDEMPOTENCY, MIRRORED EXACTLY (a deliberate
 *    divergence from most sibling boundaries' audited-replay-graph check)
 * ---------------------------------------------------------------------
 *   Every other apply boundary in this family keys idempotency off its
 *   OWN deterministic `request_id`, and on a replayed `request_id`
 *   re-verifies that the previously-written audit/outbox graph still
 *   matches the newly-submitted payload byte-for-byte (raising `40001` on
 *   drift). `attribution_receipts` has no such need: its idempotency key
 *   is `UNIQUE(job_id)`, exactly like SQLite's own `INSERT OR IGNORE`,
 *   and SQLite performs NO comparison at all on the ignored path — it
 *   just does nothing. Reproducing the stricter audited-replay-graph
 *   check here would make this boundary MORE restrictive than the SQLite
 *   truth it is required to mirror, so it does not: a receipt already
 *   recorded for a job is unconditionally a zero-write success that
 *   returns the ORIGINALLY stored row, regardless of what the new call's
 *   payload says. `request_id`/`request_fingerprint` are still derived,
 *   validated, and included in the result for the same traceability every
 *   sibling module provides — they are just not used to gate the
 *   idempotency decision. See `insertOrIgnoreReplayParity` below.
 *
 * ---------------------------------------------------------------------
 * 4. WRITER-LOCK PROTOCOL AND ON DELETE SET NULL
 * ---------------------------------------------------------------------
 *   `attribution_receipts` is not one of the five domains
 *   `postgres-signal-writer-lock-protocol.ts` guards (source,
 *   retailer_qualification, settings, mission_policy, spend) — same as
 *   `attribution_policies` (see postgres-signal-attribution-policy-apply.ts
 *   §"attribution_policies is not one of the five domains..."). This
 *   boundary therefore never calls it; per-job serialization comes from
 *   `SELECT ... FOR UPDATE OF job` on the one `action_jobs` row this call
 *   touches, plus the `UNIQUE(job_id)` constraint (backstopped by
 *   `ON CONFLICT (job_id) DO NOTHING`) for the receipt insert itself.
 *
 *   `attribution_receipts.policy_id` is `REFERENCES attribution_policies(id)
 *   ON DELETE SET NULL` (migrations.ts:594) — the one FK in this schema
 *   that can silently null out from under an already-written row (no code
 *   path in this repository ever DELETEs an `attribution_policies` row —
 *   provisioning only INSERTs OR IGNOREs once and `replacePolicies`/this
 *   boundary's predecessor only UPDATEs — but the schema still allows it).
 *   The consequence is confined to the REPLAY path: when an existing
 *   receipt is returned, its `policy_id` is read back and reported
 *   AS STORED (via `COALESCE(..., '')`), never re-validated against a
 *   live `attribution_policies` lookup — a receipt is immutable once
 *   written (see the receipt-immutability trigger every boundary in this
 *   family installs), so its `policy_id` column value at replay time is
 *   whatever it already is, not something this function should second-
 *   guess or fail over. The FRESH-insert path's `policyId` consistency
 *   check (section 2) only ever runs while creating a NEW row, when
 *   `ON DELETE SET NULL` cannot yet have fired.
 */

export const POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_RECEIPT_TABLE =
  "yoink_signal_attribution_receipt_apply_receipt";
export const POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_FUNCTION =
  "yoink_apply_signal_attribution_receipt";
export const POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONFIRMATION =
  "ATTRIBUTION_RECEIPT_RECORD_V1";

/** Mirrors `AttributionPlan["outcome"]` in `contracts/src/index.ts` and the
 * `attribution_receipts.outcome` CHECK constraint (migrations.ts:597). */
export const POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_OUTCOMES = Object.freeze([
  "affiliate_route", "canonical_disabled", "canonical_fallback", "required_route_unavailable"
] as const);

const MAXIMUM_ROUTE_URL_BYTES = 4_096;
const MAXIMUM_REQUEST_PAYLOAD_BYTES = 8_192;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{3,160}$/;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;
const ROUTE_URL_PATTERN = /^https:\/\/\S+$/;
const REQUEST_ID = /^attribution_receipt_record_[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RECEIPT_ID = /^attribution_receipt_[a-f0-9]{32}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text"
] as const);
const FUNCTION_ARGUMENTS_SQL = `
  expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
  request_id TEXT, request_payload_json TEXT
`;
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
/**
 * `action_jobs` and `attribution_policies` are read (and, for `action_jobs`,
 * row-locked) but never mutated by this boundary — they are still tenant-
 * scoped RLS-protected tables the function's SQL touches, so they belong
 * here even though they are absent from MUTATION_TABLES. `listings`, which
 * `action_jobs.listing_id` is joined against to derive `retailer_id`, is
 * deliberately NOT listed: it carries no `tenant_id`/`user_id` columns at
 * all (migrations.ts:82-95) — it is shared catalog state, not a
 * tenant-protected table.
 */
const PROTECTED_TENANT_TABLES = Object.freeze([
  "action_jobs",
  "attribution_policies",
  "attribution_receipts",
  "audit_events",
  "outbox_events"
] as const);
const MUTATION_TABLES = Object.freeze([
  "attribution_receipts",
  "audit_events",
  "outbox_events"
] as const);

export type PostgresSignalAttributionReceiptOperation = "record_attribution_receipt";

export interface PostgresSignalAttributionReceiptRecordPayload {
  actionJobId: string;
  policyId: string;
  retailerId: typeof POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS[number];
  provider: typeof POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS[number];
  outcome: typeof POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_OUTCOMES[number];
  reasonCode: string;
  routeUrl: string;
  confirmation: typeof POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONFIRMATION;
}

export interface PostgresSignalAttributionReceiptSnapshot {
  id: string;
  jobId: string;
  policyId: string;
  retailerId: string;
  provider: string;
  outcome: string;
  reasonCode: string;
  routeUrl: string;
  canonicalUrlHash: string;
  createdAt: string;
}

type PostgresSignalAttributionPolicyPredecessor = Pick<
  PostgresSignalAttributionPolicyApplyManifest,
  "schemaName" | "fingerprint" | "attributionPolicyRoleNamespace"
>;

export interface PostgresSignalAttributionReceiptApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  attributionPolicyApplyContractVersion: 1;
  schemaName: string;
  attributionReceiptRoleNamespace: string;
  attributionPolicyApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalAttributionPolicyPredecessor;
  attributionReceiptRole: {
    kind: "signal_attribution_receipt_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 1;
  outcomeAllowlist: typeof POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_OUTCOMES;
  providerAllowlist: typeof POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS;
  supportedRetailers: typeof POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS;
  supportedRetailerCount: typeof POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS.length;
  protectedTenantTableCount: 5;
  forcedRlsTableCount: 5;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  jobOwnershipRevalidated: true;
  attributionSnapshotConsistencyRevalidated: true;
  provisionedPolicyRowRequired: true;
  policyIdentityRevalidated: true;
  writerLockProtocolConsumed: false;
  deterministicRequestIdentity: true;
  insertOrIgnoreReplayParity: true;
  auditedOnFreshRecordOnly: true;
  immutableReceiptReplay: true;
  databaseOwnedTimestamps: true;
  databaseDerivedCanonicalUrlHash: true;
  metadataNeverPersisted: true;
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
  // Closes `AttributionRepository.recordReceipt -> attribution_receipts`,
  // the out-of-scope write family named in
  // `POSTGRES_SIGNAL_EVALUATION_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES`
  // (postgres-signal-evaluation-composition.ts). Named with the "Writer"
  // suffix the majority of this family's own-boundary flags use
  // (sourceTrustWriterParity, ..., reservationWriterParity) rather than
  // the one outlier (`attributionPolicyParity`, established earlier by
  // postgres-signal-action-spend-apply.ts before this module existed).
  attributionReceiptWriterParity: true;
  writerLockProtocolParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalAttributionReceiptCapabilityProjection {
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
  jobOwnershipRevalidated: true;
  attributionSnapshotConsistencyRevalidated: true;
  provisionedPolicyRowRequired: true;
  policyIdentityRevalidated: true;
  writerLockProtocolConsumed: false;
  deterministicRequestIdentity: true;
  insertOrIgnoreReplayParity: true;
  auditedOnFreshRecordOnly: true;
  immutableReceiptReplay: true;
  databaseOwnedTimestamps: true;
  databaseDerivedCanonicalUrlHash: true;
  metadataNeverPersisted: true;
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
  operationCount: 1;
  supportedRetailerCount: typeof POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS.length;
  protectedTenantTableCount: 5;
  forcedRlsTableCount: 5;
  mutationTableCount: 3;
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

export interface PostgresSignalAttributionReceiptApplyResult {
  contractVersion: 1;
  operation: PostgresSignalAttributionReceiptOperation;
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  receiptMutated: boolean;
  auditMutated: boolean;
  outboxMutated: boolean;
  receipt: PostgresSignalAttributionReceiptSnapshot;
  attributionReceiptWriterParity: true;
  writerLockProtocolParity: false;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: false;
  actionAuthority: false;
  runtimeAuthority: false;
}

export interface NodePostgresSignalAttributionReceiptApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalAttributionReceiptCapabilityProjection> | null = null;

export class PostgresSignalAttributionReceiptApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalAttributionReceiptApplyQualificationError";
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
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_attribution_receipt`;
  if (value.length > 63) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt role name exceeds PostgreSQL's limit."
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
 * joined with '|' — byte-for-byte identical to the TypeScript helper. */
function stableHashInputSql(parts: string[]): string {
  return parts.map((part) => (
    `pg_catalog.octet_length(${part})::text || ':' || ${part}`
  )).join(" || '|' || ");
}

/**
 * Normalizes an `(jobId, plan)` pair — exactly the SQLite
 * `AttributionRepository.recordReceipt(jobId, plan, canonicalUrl, now)`
 * signature, minus `canonicalUrl` (derived server-side from the job's own
 * `canonical_url` column; see the module header §2) and `now` (the
 * database owns its own write timestamp; see `databaseOwnedTimestamps`) —
 * into the payload shape the PostgreSQL boundary function accepts.
 * `plan.metadata` and `plan.blocked` are read by nothing in
 * `recordReceipt` and are dropped here too (`metadataNeverPersisted`).
 */
export function normalizedPostgresSignalAttributionReceiptRecordPayload(
  jobId: string,
  plan: AttributionPlan
): PostgresSignalAttributionReceiptRecordPayload {
  const actionJobId = cleanText(jobId, 160);
  if (!SAFE_ID.test(actionJobId)) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt action job id is invalid."
    );
  }
  const policyId = cleanText(plan?.policyId, 160);
  if (!SAFE_ID.test(policyId)) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt policy id is invalid."
    );
  }
  const retailerId = cleanText(plan?.retailerId, 60).toLocaleLowerCase("en-US");
  if (!(POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS as readonly string[]).includes(retailerId)) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt retailer is unsupported."
    );
  }
  if (!isAttributionProvider(plan?.provider)) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt provider is invalid."
    );
  }
  const outcome = String(plan?.outcome ?? "");
  if (!(POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt outcome is invalid."
    );
  }
  const reasonCode = cleanText(plan?.reasonCode, 80);
  if (!REASON_CODE_PATTERN.test(reasonCode)) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt reason code is invalid."
    );
  }
  const routeUrl = cleanText(plan?.routeUrl, MAXIMUM_ROUTE_URL_BYTES);
  if (!routeUrl || Buffer.byteLength(routeUrl, "utf8") > MAXIMUM_ROUTE_URL_BYTES || !ROUTE_URL_PATTERN.test(routeUrl)) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt route URL is invalid."
    );
  }
  return {
    actionJobId,
    policyId,
    retailerId: retailerId as typeof POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS[number],
    provider: plan.provider,
    outcome: outcome as typeof POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_OUTCOMES[number],
    reasonCode,
    routeUrl,
    confirmation: POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONFIRMATION
  };
}

/**
 * Derives the deterministic request id from the principal and the complete
 * normalized payload. Unlike `postgres-signal-reservation-lifecycle-apply.ts`
 * (two operations, so `operation_name` is hashed to distinguish them), this
 * boundary has exactly one operation baked into the id's own literal prefix
 * (`attribution_receipt_record_`), matching
 * `postgres-signal-attribution-policy-apply.ts`'s single-operation choice
 * to omit `operation_name` from its hash input too.
 */
export function buildPostgresSignalAttributionReceiptRecordRequestId(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  payload: PostgresSignalAttributionReceiptRecordPayload
): string {
  const parts = [
    "postgres-signal-attribution-receipt-record-request-v1",
    String(principal?.tenantId ?? ""),
    String(principal?.userId ?? ""),
    String(payload?.actionJobId ?? ""),
    String(payload?.policyId ?? ""),
    String(payload?.retailerId ?? ""),
    String(payload?.provider ?? ""),
    String(payload?.outcome ?? ""),
    String(payload?.reasonCode ?? ""),
    String(payload?.routeUrl ?? ""),
    String(payload?.confirmation ?? "")
  ];
  return `attribution_receipt_record_${createHash("sha256")
    .update(stableHashInput(parts)).digest("hex").slice(0, 32)}`;
}

export function buildPostgresSignalAttributionReceiptApplyManifest(
  predecessorManifest = buildPostgresSignalAttributionPolicyApplyManifest(),
  requestedRoleNamespace = "yoink_attribution_receipt_qual"
): PostgresSignalAttributionReceiptApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const attributionReceiptRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (collectRoleNamespaces(predecessorManifest).has(attributionReceiptRoleNamespace)) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalAttributionReceiptApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    attributionPolicyApplyContractVersion: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONTRACT_VERSION,
    schemaName,
    attributionReceiptRoleNamespace,
    attributionPolicyApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    attributionReceiptRole: {
      kind: "signal_attribution_receipt_apply_boundary",
      name: roleName(attributionReceiptRoleNamespace),
      functionName: POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 1,
    outcomeAllowlist: POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_OUTCOMES,
    providerAllowlist: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS,
    supportedRetailers: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS,
    supportedRetailerCount: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS.length,
    protectedTenantTableCount: 5,
    forcedRlsTableCount: 5,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    jobOwnershipRevalidated: true,
    attributionSnapshotConsistencyRevalidated: true,
    provisionedPolicyRowRequired: true,
    policyIdentityRevalidated: true,
    writerLockProtocolConsumed: false,
    deterministicRequestIdentity: true,
    insertOrIgnoreReplayParity: true,
    auditedOnFreshRecordOnly: true,
    immutableReceiptReplay: true,
    databaseOwnedTimestamps: true,
    databaseDerivedCanonicalUrlHash: true,
    metadataNeverPersisted: true,
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
    'mutationStatementCount', ${mutated ? "3" : "0"},
    'mutationRowCount', ${mutated ? "3" : "0"},
    'receiptMutated', ${mutated ? "TRUE" : "FALSE"},
    'auditMutated', ${mutated ? "TRUE" : "FALSE"},
    'outboxMutated', ${mutated ? "TRUE" : "FALSE"},
    'receipt', receipt_result_value,
    'attributionReceiptWriterParity', TRUE, 'writerLockProtocolParity', FALSE,
    'mutationAuthority', TRUE, 'sharedCatalogMutationAuthority', FALSE,
    'actionAuthority', FALSE, 'runtimeAuthority', FALSE
  )`;
}

export function signalAttributionReceiptApplyFunctionSource(
  manifest = buildPostgresSignalAttributionReceiptApplyManifest()
): string {
  const retailersSql = POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS
    .map((retailerId) => `'${retailerId}'`)
    .join(", ");
  const requestIdentityParts = stableHashInputSql([
    "'postgres-signal-attribution-receipt-record-request-v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "action_job_id_value",
    "policy_id_value",
    "retailer_id_value",
    "provider_value",
    "outcome_value",
    "reason_code_value",
    "route_url_value",
    `'${POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONFIRMATION}'::text`
  ]);
  // stableHash (domain/src/ids.ts) terminates EVERY part with '|', including
  // the last — unlike this module's request-identity convention, which joins
  // with '|' as a separator only. The canonical-URL hash claims byte-for-byte
  // stableHash parity, so the trailing terminator is appended explicitly.
  const canonicalUrlHashParts = stableHashInputSql([
    "'canonical-attribution-url-v1'::text",
    "job_record.job_canonical_url"
  ]) + " || '|'";
  const receiptResultFields = `
      'id', receipt_row.id, 'jobId', receipt_row.job_id,
      'policyId', COALESCE(receipt_row.policy_id, ''),
      'retailerId', receipt_row.retailer_id, 'provider', receipt_row.provider,
      'outcome', receipt_row.outcome, 'reasonCode', receipt_row.reason_code,
      'routeUrl', receipt_row.route_url, 'canonicalUrlHash', receipt_row.canonical_url_hash,
      'createdAt', receipt_row.created_at`;
  return `
DECLARE
  request_payload JSONB;
  request_fingerprint_value TEXT;
  derived_request_id TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  action_job_id_value TEXT;
  policy_id_value TEXT;
  retailer_id_value TEXT;
  provider_value TEXT;
  outcome_value TEXT;
  reason_code_value TEXT;
  route_url_value TEXT;
  job_record RECORD;
  policy_lookup_id TEXT;
  receipt_row RECORD;
  canonical_url_hash_value TEXT;
  receipt_id_value TEXT;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  mutation_timestamp TEXT;
  affected_rows BIGINT;
  receipt_result_value JSONB;
  result_value JSONB;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name <> 'record_attribution_receipt'
    OR request_id !~ '^attribution_receipt_record_[a-f0-9]{32}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal attribution-receipt request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal attribution-receipt payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR request_payload - ARRAY[
      'actionJobId', 'policyId', 'retailerId', 'provider', 'outcome',
      'reasonCode', 'routeUrl', 'confirmation'
    ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 8
    OR pg_catalog.jsonb_typeof(request_payload->'actionJobId') IS DISTINCT FROM 'string'
    OR request_payload->>'actionJobId' !~ '^[A-Za-z0-9_-]{3,160}$'
    OR pg_catalog.jsonb_typeof(request_payload->'policyId') IS DISTINCT FROM 'string'
    OR request_payload->>'policyId' !~ '^[A-Za-z0-9_-]{3,160}$'
    OR pg_catalog.jsonb_typeof(request_payload->'retailerId') IS DISTINCT FROM 'string'
    OR request_payload->>'retailerId' NOT IN (${retailersSql})
    OR pg_catalog.jsonb_typeof(request_payload->'provider') IS DISTINCT FROM 'string'
    OR request_payload->>'provider' NOT IN ('canonical', 'howl', 'amazon_associates')
    OR pg_catalog.jsonb_typeof(request_payload->'outcome') IS DISTINCT FROM 'string'
    OR request_payload->>'outcome' NOT IN (
      'affiliate_route', 'canonical_disabled', 'canonical_fallback', 'required_route_unavailable'
    )
    OR pg_catalog.jsonb_typeof(request_payload->'reasonCode') IS DISTINCT FROM 'string'
    OR request_payload->>'reasonCode' !~ '^[a-z][a-z0-9_]{2,79}$'
    OR pg_catalog.jsonb_typeof(request_payload->'routeUrl') IS DISTINCT FROM 'string'
    OR pg_catalog.octet_length(request_payload->>'routeUrl') NOT BETWEEN 1 AND ${MAXIMUM_ROUTE_URL_BYTES}
    OR request_payload->>'routeUrl' !~ '^https://[^\\s]+$'
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> '${POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONFIRMATION}' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal attribution-receipt payload shape is invalid';
  END IF;
  action_job_id_value := request_payload->>'actionJobId';
  policy_id_value := request_payload->>'policyId';
  retailer_id_value := request_payload->>'retailerId';
  provider_value := request_payload->>'provider';
  outcome_value := request_payload->>'outcome';
  reason_code_value := request_payload->>'reasonCode';
  route_url_value := request_payload->>'routeUrl';

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

  derived_request_id := 'attribution_receipt_record_' || pg_catalog.substr(
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      ${requestIdentityParts}, 'UTF8'
    )), 'hex'), 1, 32
  );
  IF request_id <> derived_request_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal attribution-receipt request identity is invalid';
  END IF;
  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(request_payload::text, 'UTF8')
  ), 'hex');

  -- attribution_receipts is UNIQUE(job_id), exactly mirroring SQLite's
  -- INSERT OR IGNORE. A receipt already recorded for this job is a true
  -- zero-write success: the ORIGINALLY stored row is returned verbatim, with
  -- NO comparison against this call's submitted payload -- reproducing
  -- SQLite's own behavior exactly (see module header §3). policy_id is read
  -- back AS STORED (its FK is ON DELETE SET NULL -- see module header §4) --
  -- never re-checked against a live attribution_policies lookup here.
  SELECT receipt.id, receipt.job_id, receipt.policy_id, receipt.retailer_id,
         receipt.provider, receipt.outcome, receipt.reason_code,
         receipt.route_url, receipt.canonical_url_hash, receipt.created_at
    INTO receipt_row
  FROM ${relation(manifest.schemaName, "attribution_receipts")} AS receipt
  WHERE receipt.job_id = action_job_id_value
    AND receipt.tenant_id = resolved_tenant_id AND receipt.user_id = resolved_user_id;
  IF FOUND THEN
    receipt_result_value := pg_catalog.jsonb_build_object(${receiptResultFields}
    );
    RETURN QUERY SELECT (${commonResultSql("already_applied", false)})::text;
    RETURN;
  END IF;

  -- Job ownership/tenant revalidation: the one row this call is allowed to
  -- touch, locked for the duration of the transaction. listings is joined
  -- read-only (no FOR UPDATE) -- it is shared catalog state, not owned by
  -- this tenant (see PROTECTED_TENANT_TABLES comment above).
  SELECT job.id AS job_id, job.canonical_url AS job_canonical_url,
         job.attribution_url AS job_attribution_url,
         job.attribution_provider AS job_attribution_provider,
         listing.retailer_id AS job_retailer_id
    INTO job_record
  FROM ${relation(manifest.schemaName, "action_jobs")} AS job
  JOIN ${relation(manifest.schemaName, "listings")} AS listing ON listing.id = job.listing_id
  WHERE job.id = action_job_id_value
    AND job.tenant_id = resolved_tenant_id AND job.user_id = resolved_user_id
  FOR UPDATE OF job;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal attribution-receipt action job ownership is invalid';
  END IF;

  -- The job must carry the exact attribution fields the receipt snapshots:
  -- provider/routeUrl/retailerId are never trusted from the caller -- they
  -- are compared against the job's own already-persisted attribution
  -- snapshot (module header §2), which is redundant with the submitted
  -- values by construction in the real SQLite call graph, but revalidated
  -- here defensively.
  IF job_record.job_retailer_id <> retailer_id_value
    OR job_record.job_attribution_provider <> provider_value
    OR job_record.job_attribution_url <> route_url_value THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal attribution-receipt payload does not match the action job attribution snapshot';
  END IF;

  SELECT policy.id INTO policy_lookup_id
  FROM ${relation(manifest.schemaName, "attribution_policies")} AS policy
  WHERE policy.tenant_id = resolved_tenant_id AND policy.user_id = resolved_user_id
    AND policy.retailer_id = retailer_id_value;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal attribution-receipt policy row is not provisioned';
  END IF;
  IF policy_lookup_id <> policy_id_value THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal attribution-receipt policy identity does not match the currently provisioned policy';
  END IF;

  canonical_url_hash_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    ${canonicalUrlHashParts}, 'UTF8'
  )), 'hex');
  mutation_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  receipt_id_value := 'attribution_receipt_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_attribution_receipt_apply_receipt_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || action_job_id_value, 'UTF8'
    )
  ), 'hex'), 1, 32);
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_attribution_receipt_apply_request_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('postgres_signal_attribution_receipt_apply_outbox_v1|' || audit_id_value, 'UTF8')
  ), 'hex'), 1, 32);

  INSERT INTO ${relation(manifest.schemaName, "attribution_receipts")}(
    id, tenant_id, user_id, job_id, policy_id, retailer_id,
    provider, outcome, reason_code, route_url, canonical_url_hash, created_at
  ) VALUES (
    receipt_id_value, resolved_tenant_id, resolved_user_id, action_job_id_value,
    policy_id_value, retailer_id_value, provider_value, outcome_value,
    reason_code_value, route_url_value, canonical_url_hash_value, mutation_timestamp
  )
  ON CONFLICT (job_id) DO NOTHING;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  IF affected_rows = 0 THEN
    -- Lost a race to a concurrent call for the same job between the replay
    -- check above and this INSERT. Fetch the winner's row (job_id is
    -- UNIQUE) and return the same true zero-write success the top-of-
    -- function replay path returns.
    SELECT receipt.id, receipt.job_id, receipt.policy_id, receipt.retailer_id,
           receipt.provider, receipt.outcome, receipt.reason_code,
           receipt.route_url, receipt.canonical_url_hash, receipt.created_at
      INTO STRICT receipt_row
    FROM ${relation(manifest.schemaName, "attribution_receipts")} AS receipt
    WHERE receipt.job_id = action_job_id_value
      AND receipt.tenant_id = resolved_tenant_id AND receipt.user_id = resolved_user_id;
    receipt_result_value := pg_catalog.jsonb_build_object(${receiptResultFields}
    );
    RETURN QUERY SELECT (${commonResultSql("already_applied", false)})::text;
    RETURN;
  END IF;

  -- Fresh insert: mirrors SQLite's "if (inserted.changes === 1) { audit... }"
  -- exactly -- audit_events/outbox_events are appended ONLY on this path,
  -- never on a replay (see module header §1 and §3).
  receipt_result_value := pg_catalog.jsonb_build_object(
    'id', receipt_id_value, 'jobId', action_job_id_value,
    'policyId', policy_id_value, 'retailerId', retailer_id_value,
    'provider', provider_value, 'outcome', outcome_value,
    'reasonCode', reason_code_value, 'routeUrl', route_url_value,
    'canonicalUrlHash', canonical_url_hash_value, 'createdAt', mutation_timestamp
  );
  result_value := ${commonResultSql("applied", true)};
  audit_data_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1, 'operation', operation_name, 'requestId', request_id,
    'requestFingerprint', request_fingerprint_value, 'result', result_value
  );
  outbox_payload_value := pg_catalog.jsonb_build_object(
    'auditId', audit_id_value, 'correlationId', action_job_id_value,
    'reasonCode', reason_code_value,
    'message', 'An immutable attribution-routing receipt was recorded for an action job.',
    'data', audit_data_value
  );
  INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
    id, tenant_id, user_id, correlation_id, event_type,
    reason_code, message, data_json, created_at
  ) VALUES (
    audit_id_value, resolved_tenant_id, resolved_user_id, action_job_id_value,
    'attribution_route_recorded', reason_code_value,
    'An immutable attribution-routing receipt was recorded for an action job.',
    audit_data_value::text, mutation_timestamp
  );
  INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
    id, tenant_id, aggregate_type, aggregate_id, event_type,
    payload_json, created_at, delivered_at
  ) VALUES (
    outbox_id_value, resolved_tenant_id, 'attribution_receipt', action_job_id_value,
    'attribution_route_recorded', outbox_payload_value::text, mutation_timestamp, ''
  );

  RETURN QUERY SELECT result_value::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalAttributionReceiptApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_attribution_receipt_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.attributionReceiptRole.name,
    functionName: POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalAttributionReceiptApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_attribution_receipt_apply_receipt",
    receiptTriggerName: "yoink_signal_attribution_receipt_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.attributionPolicyApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      attributionPolicyApplyContractVersion: 1,
      operationCount: 1,
      outcomeAllowlist: POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_OUTCOMES,
      providerAllowlist: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS,
      supportedRetailers: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS,
      supportedRetailerCount: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS.length,
      serverBoundPrincipalLookup: true,
      jobOwnershipRevalidated: true,
      attributionSnapshotConsistencyRevalidated: true,
      provisionedPolicyRowRequired: true,
      policyIdentityRevalidated: true,
      writerLockProtocolConsumed: false,
      deterministicRequestIdentity: true,
      insertOrIgnoreReplayParity: true,
      auditedOnFreshRecordOnly: true,
      immutableReceiptReplay: true,
      databaseOwnedTimestamps: true,
      databaseDerivedCanonicalUrlHash: true,
      metadataNeverPersisted: true,
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
      sharedCatalogMutationAuthority: false,
      actionAuthority: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalAttributionReceiptCapabilityProjection():
PostgresSignalAttributionReceiptCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalAttributionReceiptApplyManifest();
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
    jobOwnershipRevalidated: true,
    attributionSnapshotConsistencyRevalidated: true,
    provisionedPolicyRowRequired: true,
    policyIdentityRevalidated: true,
    writerLockProtocolConsumed: false,
    deterministicRequestIdentity: true,
    insertOrIgnoreReplayParity: true,
    auditedOnFreshRecordOnly: true,
    immutableReceiptReplay: true,
    databaseOwnedTimestamps: true,
    databaseDerivedCanonicalUrlHash: true,
    metadataNeverPersisted: true,
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
    operationCount: 1,
    supportedRetailerCount: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS.length,
    protectedTenantTableCount: 5,
    forcedRlsTableCount: 5,
    mutationTableCount: 3,
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

export type PostgresSignalAttributionReceiptApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalAttributionReceiptApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalAttributionReceiptApplyManifest()
): Promise<PostgresSignalAttributionReceiptApplyQualificationReceipt> {
  await verifyPostgresSignalAttributionPolicyApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalAttributionPolicyApplyManifest
  );
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalAttributionReceiptApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalAttributionReceiptApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalAttributionReceiptApplyQualificationReceipt> {
  await verifyPostgresSignalAttributionPolicyApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalAttributionPolicyApplyManifest
  );
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      `The PostgreSQL attribution-receipt ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalAttributionReceiptOperation,
  requestId: string
): PostgresSignalAttributionReceiptApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const outcome = String(result.outcome ?? "");
  const receipt = result.receipt;
  const retailerSet = new Set<string>(POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS);
  const providerSet = new Set<string>(POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS);
  const outcomeSet = new Set<string>(POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_OUTCOMES);
  const validReceipt = (entry: unknown): boolean => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const row = entry as Record<string, unknown>;
    return RECEIPT_ID.test(String(row.id))
      && SAFE_ID.test(String(row.jobId))
      && (row.policyId === "" || SAFE_ID.test(String(row.policyId)))
      && retailerSet.has(String(row.retailerId))
      && providerSet.has(String(row.provider))
      && outcomeSet.has(String(row.outcome))
      && REASON_CODE_PATTERN.test(String(row.reasonCode))
      && ROUTE_URL_PATTERN.test(String(row.routeUrl))
      && SHA256.test(String(row.canonicalUrlHash))
      && typeof row.createdAt === "string" && row.createdAt.length > 0;
  };
  if (result.contractVersion !== 1
    || result.operation !== operation
    || result.requestId !== requestId
    || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "already_applied"]).has(outcome)
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || (outcome === "applied"
      && (result.mutationApplied !== true || result.idempotentReplay !== false))
    || (outcome === "already_applied"
      && (result.mutationApplied !== false || result.idempotentReplay !== true))
    || !Number.isSafeInteger(result.mutationStatementCount)
    || Number(result.mutationStatementCount) < 0 || Number(result.mutationStatementCount) > 3
    || !Number.isSafeInteger(result.mutationRowCount)
    || Number(result.mutationRowCount) < 0 || Number(result.mutationRowCount) > 3
    || (outcome === "applied" && (result.mutationStatementCount !== 3 || result.mutationRowCount !== 3))
    || (outcome === "already_applied" && (result.mutationStatementCount !== 0 || result.mutationRowCount !== 0))
    || typeof result.receiptMutated !== "boolean"
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || (outcome === "applied" && (
      result.receiptMutated !== true || result.auditMutated !== true || result.outboxMutated !== true
    ))
    || (outcome === "already_applied" && (
      result.receiptMutated !== false || result.auditMutated !== false || result.outboxMutated !== false
    ))
    || !validReceipt(receipt)
    || result.attributionReceiptWriterParity !== true
    || result.writerLockProtocolParity !== false
    || result.mutationAuthority !== true
    || result.sharedCatalogMutationAuthority !== false
    || result.actionAuthority !== false
    || result.runtimeAuthority !== false) {
    throw new PostgresSignalAttributionReceiptApplyQualificationError(
      "The PostgreSQL attribution-receipt result contract changed."
    );
  }
  return result as unknown as PostgresSignalAttributionReceiptApplyResult;
}

export class NodePostgresSignalAttributionReceiptApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalAttributionReceiptApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalAttributionReceiptApplyManifest(),
    options: NodePostgresSignalAttributionReceiptApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalAttributionReceiptApplyQualificationError(
        "The PostgreSQL attribution-receipt connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_attribution_receipt"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async recordAttributionReceipt(
    principal: BackgroundWorkerPrincipal,
    requestIdValue: string,
    requestPayload: PostgresSignalAttributionReceiptRecordPayload
  ): Promise<PostgresSignalAttributionReceiptApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation: PostgresSignalAttributionReceiptOperation = "record_attribution_receipt";
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (!REQUEST_ID.test(requestId)
      || requestId !== buildPostgresSignalAttributionReceiptRecordRequestId(
        { tenantId, userId },
        requestPayload
      )
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalAttributionReceiptApplyQualificationError(
        "The PostgreSQL attribution-receipt apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.attributionReceiptRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalAttributionReceiptApplyQualificationError(
          "The PostgreSQL attribution-receipt function returned an ambiguous result."
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
