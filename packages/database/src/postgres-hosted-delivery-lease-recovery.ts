import { createHash, randomBytes } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { SIGNAL_INGRESS_EVENT_TYPE } from "../../contracts/src/signal-ingress.js";
import { BACKGROUND_TASK_KINDS } from "../../domain/src/background-task.js";
import { nowIso, stableHash } from "../../domain/src/ids.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  inspectPostgresCutoverPreflight,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase,
  type PostgresQueryResult,
  type PostgresQuerySession,
  logIdlePostgresClientErrors
} from "./postgres-cutover.js";
import {
  POSTGRES_OBSERVER_WITNESS_REFRESH_CONTRACT_VERSION,
  buildPostgresObserverWitnessRefreshManifest,
  verifyPostgresObserverWitnessRefreshBoundary
} from "./postgres-observer-witness-refresh.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION = 3;
export const POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE =
  "yoink_hosted_delivery_lease_recovery_receipt";
export const POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_FUNCTION =
  "yoink_recover_hosted_delivery_leases";
export const POSTGRES_HOSTED_SIGNAL_INBOX_FUNCTION =
  "yoink_transition_trackalacker_signal_inbox";
export const POSTGRES_HOSTED_SIGNAL_RESOLUTION_PLAN_FUNCTION =
  "yoink_plan_trackalacker_signal_resolution";

const MAXIMUM_DELIVERY_ATTEMPTS = 20;
const MAXIMUM_CLOCK_SKEW_MS = 300_000;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SIGNAL_LEASE_SECONDS = 60;
const SIGNAL_RETRY_SECONDS = 30;
const SIGNAL_RESOLUTION_PLAN_SECONDS = 30;
const FUNCTION_ARGUMENT_TYPES = Object.freeze(["text", "text"] as const);
const FUNCTION_RESULT_TYPE =
  "TABLE(inbox_requeued bigint, inbox_dead_lettered bigint, outbox_requeued bigint, outbox_dead_lettered bigint)";
const SIGNAL_FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text"
] as const);
const SIGNAL_FUNCTION_RESULT_TYPE =
  "TABLE(message_id text, source text, message_key text, event_type text, payload_json text, attempt bigint, lease_expires_at text, disposition text, changed boolean)";
const SIGNAL_RESOLUTION_PLAN_FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text"
] as const);
const SIGNAL_RESOLUTION_PLAN_FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TABLES = Object.freeze([
  "hosted_delivery_receipts",
  "inbox_messages",
  "outbox_events"
] as const);
const QUALIFIED_HANDLER_TASK_KINDS = Object.freeze([
  "notification_recovery",
  "execution_recovery",
  "operational_telemetry_retention",
  "observer_recipe_candidate_evaluation",
  "adapter_alert_reconciliation",
  "observer_recipe_witness_refresh"
] as const);

export interface PostgresHostedDeliveryLeaseRecoveryManifest {
  contractVersion: typeof POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  witnessRefreshContractVersion: typeof POSTGRES_OBSERVER_WITNESS_REFRESH_CONTRACT_VERSION;
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  queueWriteRoleNamespace: string;
  controlRoleNamespace: string;
  notificationRecoveryRoleNamespace: string;
  executionRecoveryRoleNamespace: string;
  operationalRetentionRoleNamespace: string;
  observerCandidateRoleNamespace: string;
  alertDispatchRoleNamespace: string;
  alertReconciliationRoleNamespace: string;
  witnessRefreshRoleNamespace: string;
  leaseRecoveryRoleNamespace: string;
  witnessRefreshManifestFingerprint: string;
  leaseRecoveryRole: {
    kind: "hosted_delivery_lease_recovery_boundary";
    name: string;
    functionName: typeof POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_FUNCTION;
    functionArgumentTypes: string[];
    signalInboxFunctionName: typeof POSTGRES_HOSTED_SIGNAL_INBOX_FUNCTION;
    signalInboxFunctionArgumentTypes: string[];
    signalResolutionPlanFunctionName: typeof POSTGRES_HOSTED_SIGNAL_RESOLUTION_PLAN_FUNCTION;
    signalResolutionPlanFunctionArgumentTypes: string[];
    protectedTableNames: string[];
    forcedRlsTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTableCount: 3;
  forcedRlsTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 3;
  boundaryHandlerTaskKinds: ["hosted_delivery_recovery"];
  qualifiedHandlerTaskKinds: [
    "notification_recovery",
    "execution_recovery",
    "operational_telemetry_retention",
    "observer_recipe_candidate_evaluation",
    "adapter_alert_reconciliation",
    "observer_recipe_witness_refresh"
  ];
  qualifiedHandlerTaskKindCount: 6;
  totalHandlerTaskKindCount: number;
  maximumDeliveryAttempts: 20;
  maximumResolutionPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  databaseServerClock: true;
  deterministicReceiptHashParity: true;
  leaseRecoverySubBoundaryParity: true;
  signalInboxLifecycleRepositoryParity: true;
  signalResolutionPlanRepositoryParity: true;
  signalEvaluationApplyRepositoryParity: false;
  signalEvaluationRepositoryParity: false;
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  mutationAuthority: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresHostedDeliveryLeaseRecoveryQualificationReceipt {
  contractVersion: 3;
  cutoverContractVersion: 3;
  witnessRefreshContractVersion: 1;
  phase: "verified";
  schemaName: string;
  roleManifestFingerprint: string;
  witnessRefreshManifestFingerprint: string;
  leaseRecoveryRoleName: string;
  protectedTableCount: 3;
  forcedRlsTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 3;
  membershipCount: 0;
  activePrincipalCount: 0;
  qualifiedHandlerTaskKindCount: 6;
  totalHandlerTaskKindCount: number;
  maximumDeliveryAttempts: 20;
  maximumResolutionPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  databaseServerClock: true;
  deterministicReceiptHashParity: true;
  leaseRecoverySubBoundaryParity: true;
  signalInboxLifecycleRepositoryParity: true;
  signalResolutionPlanRepositoryParity: true;
  signalEvaluationApplyRepositoryParity: false;
  sharedCatalogMutationFailClosed: true;
  rawSignalPayloadReturned: false;
  signalEvaluationRepositoryParity: false;
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  mutationAuthority: false;
  directTableAccess: false;
  runtimeAuthority: false;
  productionReady: false;
  boundaryCatalogFingerprint: string;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresHostedDeliveryLeaseRecoveryCapabilityProjection {
  contractVersion: 3;
  cutoverContractVersion: 3;
  witnessRefreshContractVersion: 1;
  deterministicManifestImplemented: true;
  atomicQualificationApplyImplemented: true;
  exactEffectivePrivilegeVerification: true;
  immutableBoundaryCatalogFingerprint: true;
  qualificationSuiteParity: true;
  noLogin: true;
  noInherit: true;
  noBypassRls: true;
  securityDefinerRoutineVerified: true;
  serverBoundPrincipalLookup: true;
  databaseServerClock: true;
  deterministicReceiptHashParity: true;
  readCommittedTransactionAdapter: true;
  nativeContentionQualified: true;
  leaseRecoverySubBoundaryParity: true;
  signalInboxLifecycleRepositoryParity: true;
  signalResolutionPlanRepositoryParity: true;
  signalEvaluationApplyRepositoryParity: false;
  sharedCatalogMutationFailClosed: true;
  rawSignalPayloadReturned: false;
  signalEvaluationRepositoryParity: false;
  signalIngressRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  allHandlerRepositoryParity: false;
  handlerTaskKindCount: 6;
  totalHandlerTaskKindCount: number;
  maximumDeliveryAttempts: 20;
  maximumResolutionPlanAgeSeconds: 30;
  protectedTableCount: 3;
  forcedRlsTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 3;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresHostedDeliveryLeaseRecoveryResult {
  inboxRequeued: number;
  inboxDeadLettered: number;
  outboxRequeued: number;
  outboxDeadLettered: number;
}

export interface PostgresHostedSignalInboxLease {
  id: string;
  source: string;
  messageKey: string;
  eventType: typeof SIGNAL_INGRESS_EVENT_TYPE;
  payload: Record<string, unknown>;
  attempt: number;
  leaseExpiresAt: string;
  capabilityToken: string;
}

export interface PostgresHostedSignalResolutionListing {
  id: string;
  variantId: string;
  title: string;
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
  executionSupported: boolean;
  msrpCents: number | null;
  currency: string;
}

export interface PostgresHostedSignalResolutionPlan {
  contractVersion: 1;
  messageId: string;
  payloadHash: string;
  evaluatedAt: string;
  validUntil: string;
  sourceConnection: {
    id: string;
    trustLevel: string;
    autoCreateMissions: boolean;
  };
  signal: {
    signalId: string;
    externalEventId: string;
    eventType: "in_stock" | "restock" | "preorder" | "price_change" | "drop_window" | "queue_open" | "unknown";
    observedAt: string;
    receivedAt: string;
    test: boolean;
    transportHash: string;
  };
  outcome: "duplicate" | "matched" | "ambiguous" | "unresolved";
  duplicateEventId: string;
  resolution: null | {
    status: "matched" | "ambiguous" | "unresolved";
    method: string;
    reason: string;
    listing: PostgresHostedSignalResolutionListing | null;
  };
  sharedCatalogMutationRequired: boolean;
  planFingerprint: string;
}

export interface NodePostgresHostedDeliveryLeaseRecoveryDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface RoleRow extends Record<string, unknown> {
  rolname: string;
  rolsuper: boolean;
  rolinherit: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolcanlogin: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
}

interface RoutineRow extends Record<string, unknown> {
  oid: string;
  routineName: string;
  argumentTypes: string;
  resultType: string;
  volatility: string;
  securityDefiner: boolean;
  strict: boolean;
  leakproof: boolean;
  configuration: string[] | null;
  ownerName: string;
  source: string;
}

interface ReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  cutover_contract_version: string | number | bigint;
  witness_refresh_contract_version: string | number | bigint;
  phase: string;
  role_manifest_fingerprint: string;
  witness_refresh_manifest_fingerprint: string;
  lease_recovery_role_name: string;
  protected_table_count: string | number | bigint;
  forced_rls_table_count: string | number | bigint;
  direct_table_grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  qualified_handler_task_kind_count: string | number | bigint;
  total_handler_task_kind_count: string | number | bigint;
  maximum_delivery_attempts: string | number | bigint;
  maximum_resolution_plan_age_seconds: string | number | bigint;
  server_bound_principal_lookup: boolean;
  database_server_clock: boolean;
  deterministic_receipt_hash_parity: boolean;
  lease_recovery_sub_boundary_parity: boolean;
  signal_inbox_lifecycle_repository_parity: boolean;
  signal_resolution_plan_repository_parity: boolean;
  signal_evaluation_apply_repository_parity: boolean;
  shared_catalog_mutation_fail_closed: boolean;
  raw_signal_payload_returned: boolean;
  signal_evaluation_repository_parity: boolean;
  signal_ingress_repository_parity: boolean;
  hosted_delivery_handler_repository_parity: boolean;
  all_handler_repository_parity: boolean;
  mutation_authority: boolean;
  direct_table_access: boolean;
  runtime_authority: boolean;
  production_ready: boolean;
  boundary_catalog_fingerprint: string;
  applied_at: string;
  verified_at: string;
}

interface BoundaryInspection {
  protectedTableCount: number;
  forcedRlsTableCount: number;
  directTableGrantCount: 0;
  functionGrantCount: 3;
  membershipCount: 0;
  activePrincipalCount: 0;
  boundaryCatalogFingerprint: string;
}

interface RecoveryRow extends Record<string, unknown> {
  inboxRequeued: string | number | bigint;
  inboxDeadLettered: string | number | bigint;
  outboxRequeued: string | number | bigint;
  outboxDeadLettered: string | number | bigint;
}

interface SignalInboxTransitionRow extends Record<string, unknown> {
  messageId: string;
  source: string;
  messageKey: string;
  eventType: string;
  payloadJson: string;
  attempt: string | number | bigint;
  leaseExpiresAt: string;
  disposition: string;
  changed: boolean;
}

interface SignalResolutionPlanRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresHostedDeliveryLeaseRecoveryCapabilityProjection> | null = null;

export class PostgresHostedDeliveryLeaseRecoveryQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresHostedDeliveryLeaseRecoveryQualificationError";
  }
}

function safeSchema(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role namespace is invalid."
    );
  }
  return normalized;
}

function identifier(value: string): string {
  return `"${value}"`;
}

function relation(schema: string, object: string): string {
  return `${identifier(schema)}.${identifier(object)}`;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!INTEGER.test(normalized)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted-delivery lease-recovery ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted-delivery lease-recovery ${label} is out of range.`
    );
  }
  return parsed;
}

function principalId(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized !== value || Buffer.byteLength(normalized, "utf8") > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted-delivery lease-recovery ${label} is invalid.`
    );
  }
  return normalized;
}

function timestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted-delivery lease-recovery ${label} is invalid.`
    );
  }
  return normalized;
}

function signalMessageId(value: unknown): string {
  const normalized = String(value ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/.test(normalized)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal inbox message ID is invalid."
    );
  }
  return normalized;
}

function signalCapabilityToken(value: unknown): string {
  const normalized = String(value ?? "");
  if (!CAPABILITY_TOKEN.test(normalized)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal inbox capability is invalid."
    );
  }
  return normalized;
}

function parsedSignalPayload(value: unknown): Record<string, unknown> {
  const json = String(value ?? "");
  if (!json || Buffer.byteLength(json, "utf8") > 64 * 1024) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal inbox payload is invalid."
    );
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed as Record<string, unknown>;
  } catch {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal inbox payload is invalid."
    );
  }
}

function exactBoolean<T extends boolean>(value: unknown, expected: T, label: string): T {
  if (value !== expected) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted-delivery lease-recovery ${label} is invalid.`
    );
  }
  return expected;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function roleName(namespace: string): string {
  const value = `${namespace}_delivery_lease`;
  if (Buffer.byteLength(value, "utf8") > 63) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role name exceeds 63 bytes."
    );
  }
  return value;
}

function stableHashInputSql(parts: string[]): string {
  return parts.map((part) =>
    `pg_catalog.octet_length(${part})::text || ':' || ${part} || '|'`
  ).join(" || ");
}

export function postgresHostedSignalResolutionPlanFingerprint(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  plan: PostgresHostedSignalResolutionPlan
): string {
  const resolution = plan.resolution;
  const listing = resolution?.listing;
  return stableHash(
    "postgres_hosted_signal_resolution_plan_v1",
    principal.tenantId,
    principal.userId,
    plan.contractVersion,
    plan.messageId,
    plan.payloadHash,
    plan.evaluatedAt,
    plan.validUntil,
    plan.sourceConnection.id,
    plan.sourceConnection.trustLevel,
    plan.sourceConnection.autoCreateMissions ? 1 : 0,
    plan.signal.signalId,
    plan.signal.externalEventId,
    plan.signal.eventType,
    plan.signal.observedAt,
    plan.signal.receivedAt,
    plan.signal.test ? 1 : 0,
    plan.signal.transportHash,
    plan.outcome,
    plan.duplicateEventId,
    resolution?.status,
    resolution?.method,
    resolution?.reason,
    listing?.id,
    listing?.variantId,
    listing?.title,
    listing?.retailerId,
    listing?.retailerSku,
    listing?.canonicalUrl,
    listing ? (listing.executionSupported ? 1 : 0) : undefined,
    listing?.msrpCents,
    listing?.currency,
    plan.sharedCatalogMutationRequired ? 1 : 0
  );
}

function exactPlanObject(
  value: unknown,
  label: string,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted signal resolution ${label} is invalid.`
    );
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted signal resolution ${label} is not exact.`
    );
  }
  return record;
}

function exactPlanText(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false
): string {
  if (typeof value !== "string" || value.length > maximum
    || (!allowEmpty && value.length === 0) || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted signal resolution ${label} is invalid.`
    );
  }
  return value;
}

function exactPlanBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      `The PostgreSQL hosted signal resolution ${label} is invalid.`
    );
  }
  return value;
}

function parseHostedSignalResolutionPlan(
  value: unknown,
  principal: BackgroundWorkerPrincipal,
  expectedMessageId: string,
  now: number
): PostgresHostedSignalResolutionPlan {
  const root = exactPlanObject(value, "plan", [
    "contractVersion",
    "messageId",
    "payloadHash",
    "evaluatedAt",
    "validUntil",
    "sourceConnection",
    "signal",
    "outcome",
    "duplicateEventId",
    "resolution",
    "sharedCatalogMutationRequired",
    "planFingerprint"
  ]);
  if (root.contractVersion !== 1) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal resolution plan contract is invalid."
    );
  }
  const messageId = signalMessageId(root.messageId);
  if (messageId !== expectedMessageId) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal resolution plan message is invalid."
    );
  }
  const payloadHash = exactPlanText(root.payloadHash, "payload hash", 64);
  const evaluatedAt = timestamp(
    exactPlanText(root.evaluatedAt, "evaluation timestamp", 40),
    "signal resolution evaluation timestamp"
  );
  const validUntil = timestamp(
    exactPlanText(root.validUntil, "expiry timestamp", 40),
    "signal resolution expiry timestamp"
  );
  if (!SHA256.test(payloadHash)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal resolution payload hash is invalid."
    );
  }
  const evaluatedAtMs = Date.parse(evaluatedAt);
  const validUntilMs = Date.parse(validUntil);
  if (Math.abs(evaluatedAtMs - now) > MAXIMUM_CLOCK_SKEW_MS
    || validUntilMs <= evaluatedAtMs
    || validUntilMs - evaluatedAtMs > SIGNAL_RESOLUTION_PLAN_SECONDS * 1_000
    || validUntilMs <= Date.now()) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal resolution plan lifetime is invalid."
    );
  }

  const source = exactPlanObject(root.sourceConnection, "source connection", [
    "id", "trustLevel", "autoCreateMissions"
  ]);
  const sourceConnectionId = exactPlanText(source.id, "source connection ID", 120);
  const trustLevel = exactPlanText(source.trustLevel, "source trust level", 40);
  if (trustLevel !== "trusted_exact" && trustLevel !== "informational") {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal resolution source trust level is invalid."
    );
  }
  const autoCreateMissions = exactPlanBoolean(
    source.autoCreateMissions,
    "source auto-create flag"
  );

  const signal = exactPlanObject(root.signal, "signal", [
    "signalId",
    "externalEventId",
    "eventType",
    "observedAt",
    "receivedAt",
    "test",
    "transportHash"
  ]);
  const signalId = exactPlanText(signal.signalId, "signal ID", 180);
  const externalEventId = exactPlanText(signal.externalEventId, "external event ID", 180);
  const eventType = exactPlanText(signal.eventType, "event type", 20);
  if (!(["in_stock", "restock", "preorder", "price_change", "drop_window", "queue_open", "unknown"] as const)
    .includes(eventType as PostgresHostedSignalResolutionPlan["signal"]["eventType"])) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal resolution event type is invalid."
    );
  }
  const observedAt = timestamp(
    exactPlanText(signal.observedAt, "observed timestamp", 40),
    "signal resolution observed timestamp"
  );
  const receivedAt = timestamp(
    exactPlanText(signal.receivedAt, "received timestamp", 40),
    "signal resolution received timestamp"
  );
  const test = exactPlanBoolean(signal.test, "test flag");
  const transportHash = exactPlanText(signal.transportHash, "transport hash", 64);
  if (!SHA256.test(transportHash)
    || transportHash !== stableHash(sourceConnectionId, externalEventId)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal resolution transport hash is invalid."
    );
  }

  const outcome = exactPlanText(root.outcome, "outcome", 20);
  if (!(["duplicate", "matched", "ambiguous", "unresolved"] as const)
    .includes(outcome as PostgresHostedSignalResolutionPlan["outcome"])) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal resolution outcome is invalid."
    );
  }
  const duplicateEventId = exactPlanText(root.duplicateEventId, "duplicate event ID", 200, true);
  const sharedCatalogMutationRequired = exactPlanBoolean(
    root.sharedCatalogMutationRequired,
    "shared-catalog flag"
  );

  let resolution: PostgresHostedSignalResolutionPlan["resolution"] = null;
  if (root.resolution !== null) {
    const rawResolution = exactPlanObject(root.resolution, "resolution", [
      "status", "method", "reason", "listing"
    ]);
    const status = exactPlanText(rawResolution.status, "resolution status", 20);
    if (!(["matched", "ambiguous", "unresolved"] as const).includes(
      status as Exclude<PostgresHostedSignalResolutionPlan["outcome"], "duplicate">
    )) {
      throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
        "The PostgreSQL hosted signal resolution status is invalid."
      );
    }
    const method = exactPlanText(rawResolution.method, "resolution method", 80);
    const reason = exactPlanText(rawResolution.reason, "resolution reason", 300);
    let listing: PostgresHostedSignalResolutionListing | null = null;
    if (rawResolution.listing !== null) {
      const rawListing = exactPlanObject(rawResolution.listing, "listing", [
        "id",
        "variantId",
        "title",
        "retailerId",
        "retailerSku",
        "canonicalUrl",
        "executionSupported",
        "msrpCents",
        "currency"
      ]);
      const msrpCents = rawListing.msrpCents === null
        ? null
        : exactInteger(rawListing.msrpCents, "signal resolution MSRP");
      if (msrpCents !== null && (msrpCents < 1 || msrpCents > 100_000_000)) {
        throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
          "The PostgreSQL hosted signal resolution MSRP is invalid."
        );
      }
      const canonicalUrl = exactPlanText(rawListing.canonicalUrl, "canonical URL", 4_096);
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(canonicalUrl);
      } catch {
        throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
          "The PostgreSQL hosted signal resolution canonical URL is invalid."
        );
      }
      if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
        throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
          "The PostgreSQL hosted signal resolution canonical URL is invalid."
        );
      }
      const currency = exactPlanText(rawListing.currency, "currency", 3);
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
          "The PostgreSQL hosted signal resolution currency is invalid."
        );
      }
      listing = {
        id: exactPlanText(rawListing.id, "listing ID", 200),
        variantId: exactPlanText(rawListing.variantId, "variant ID", 200),
        title: exactPlanText(rawListing.title, "listing title", 300),
        retailerId: exactPlanText(rawListing.retailerId, "retailer ID", 60),
        retailerSku: exactPlanText(rawListing.retailerSku, "retailer SKU", 64),
        canonicalUrl,
        executionSupported: exactPlanBoolean(
          rawListing.executionSupported,
          "execution-support flag"
        ),
        msrpCents,
        currency
      };
    }
    resolution = {
      status: status as "matched" | "ambiguous" | "unresolved",
      method,
      reason,
      listing
    };
  }

  const allowedMatchedMethods = new Set([
    "source_listing_id",
    "retailer_sku",
    "source_product_preferred_retailer",
    "source_product_retailer",
    "source_product_slug_preferred_retailer",
    "source_product_slug_retailer"
  ]);
  const allowedAmbiguousMethods = new Set([
    "source_product_retailer",
    "source_product_slug_retailer"
  ]);
  if ((outcome === "duplicate" && (!duplicateEventId || resolution !== null
      || sharedCatalogMutationRequired))
    || (outcome !== "duplicate" && (duplicateEventId !== "" || !resolution
      || resolution.status !== outcome))
    || (outcome === "matched" && (!resolution?.listing
      || !allowedMatchedMethods.has(resolution.method) || sharedCatalogMutationRequired))
    || (outcome === "ambiguous" && (resolution?.listing !== null
      || !allowedAmbiguousMethods.has(resolution?.method ?? "")
      || sharedCatalogMutationRequired))
    || (outcome === "unresolved" && (resolution?.listing !== null
      || resolution?.method !== "none"))
    || (sharedCatalogMutationRequired && (outcome !== "unresolved"
      || test || trustLevel !== "trusted_exact" || !autoCreateMissions))) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal resolution plan is internally inconsistent."
    );
  }

  const plan: PostgresHostedSignalResolutionPlan = {
    contractVersion: 1,
    messageId,
    payloadHash,
    evaluatedAt,
    validUntil,
    sourceConnection: { id: sourceConnectionId, trustLevel, autoCreateMissions },
    signal: {
      signalId,
      externalEventId,
      eventType: eventType as PostgresHostedSignalResolutionPlan["signal"]["eventType"],
      observedAt,
      receivedAt,
      test,
      transportHash
    },
    outcome: outcome as PostgresHostedSignalResolutionPlan["outcome"],
    duplicateEventId,
    resolution,
    sharedCatalogMutationRequired,
    planFingerprint: exactPlanText(root.planFingerprint, "plan fingerprint", 64)
  };
  if (!SHA256.test(plan.planFingerprint)
    || plan.planFingerprint !== postgresHostedSignalResolutionPlanFingerprint(principal, plan)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted signal resolution plan fingerprint is invalid."
    );
  }
  return plan;
}

export function hostedDeliveryLeaseRecoveryFunctionSource(
  manifest: PostgresHostedDeliveryLeaseRecoveryManifest
): string {
  const receiptParts = stableHashInputSql([
    "'hosted_delivery_receipt_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "direction_value",
    "message_record.id::text",
    "disposition_value",
    "message_record.attempt::text",
    "'lease_expired'::text",
    "recovery_timestamp"
  ]);
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  recovery_timestamp TEXT;
  message_record RECORD;
  disposition_value TEXT;
  direction_value TEXT;
  receipt_input TEXT;
  inbox_requeued_count BIGINT := 0;
  inbox_dead_lettered_count BIGINT := 0;
  outbox_requeued_count BIGINT := 0;
  outbox_dead_lettered_count BIGINT := 0;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected hosted-delivery lease-recovery principal is invalid';
  END IF;
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
  recovery_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yoink_hosted_delivery_lease_recovery_v1:' || resolved_tenant_id || ':' || resolved_user_id,
      0
    )
  );

  direction_value := 'inbox';
  FOR message_record IN
    SELECT message.id, message.delivery_attempts AS attempt
    FROM ${relation(manifest.schemaName, "inbox_messages")} AS message
    WHERE message.tenant_id = resolved_tenant_id
      AND message.user_id = resolved_user_id
      AND message.state = 'processing'
      AND message.lease_capability_hash <> ''
      AND message.lease_expires_at <> ''
      AND message.lease_expires_at <= recovery_timestamp
    ORDER BY message.lease_expires_at, message.id
    FOR UPDATE
  LOOP
    disposition_value := CASE
      WHEN message_record.attempt >= ${MAXIMUM_DELIVERY_ATTEMPTS} THEN 'dead_letter'
      ELSE 'retry'
    END;
    UPDATE ${relation(manifest.schemaName, "inbox_messages")} AS message
    SET state = CASE WHEN disposition_value = 'dead_letter' THEN 'dead_letter' ELSE 'failed' END,
        lease_capability_hash = '', lease_expires_at = '',
        next_attempt_at = CASE WHEN disposition_value = 'dead_letter' THEN '' ELSE recovery_timestamp END,
        last_error_code = 'lease_expired', updated_at = recovery_timestamp
    WHERE message.id = message_record.id
      AND message.tenant_id = resolved_tenant_id
      AND message.user_id = resolved_user_id
      AND message.state = 'processing'
      AND message.lease_capability_hash <> ''
      AND message.lease_expires_at <> ''
      AND message.lease_expires_at <= recovery_timestamp;
    IF FOUND THEN
      receipt_input := ${receiptParts};
      INSERT INTO ${relation(manifest.schemaName, "hosted_delivery_receipts")}(
        id, tenant_id, user_id, direction, message_id, disposition,
        attempt, reason_code, receipt_hash, created_at
      ) VALUES (
        'delivery_receipt_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
        resolved_tenant_id, resolved_user_id, direction_value, message_record.id,
        disposition_value, message_record.attempt, 'lease_expired',
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(receipt_input, 'UTF8')), 'hex'),
        recovery_timestamp
      );
      IF disposition_value = 'dead_letter' THEN
        inbox_dead_lettered_count := inbox_dead_lettered_count + 1;
      ELSE
        inbox_requeued_count := inbox_requeued_count + 1;
      END IF;
    END IF;
  END LOOP;

  direction_value := 'outbox';
  FOR message_record IN
    SELECT message.id, message.delivery_attempts AS attempt
    FROM ${relation(manifest.schemaName, "outbox_events")} AS message
    WHERE message.tenant_id = resolved_tenant_id
      AND message.delivery_state = 'pending'
      AND message.delivered_at = ''
      AND message.lease_capability_hash <> ''
      AND message.lease_expires_at <> ''
      AND message.lease_expires_at <= recovery_timestamp
    ORDER BY message.lease_expires_at, message.id
    FOR UPDATE
  LOOP
    disposition_value := CASE
      WHEN message_record.attempt >= ${MAXIMUM_DELIVERY_ATTEMPTS} THEN 'dead_letter'
      ELSE 'retry'
    END;
    UPDATE ${relation(manifest.schemaName, "outbox_events")} AS message
    SET delivery_state = CASE WHEN disposition_value = 'dead_letter' THEN 'dead_letter' ELSE 'pending' END,
        lease_capability_hash = '', lease_expires_at = '',
        next_attempt_at = CASE WHEN disposition_value = 'dead_letter' THEN '' ELSE recovery_timestamp END,
        last_error_code = 'lease_expired', updated_at = recovery_timestamp
    WHERE message.id = message_record.id
      AND message.tenant_id = resolved_tenant_id
      AND message.delivery_state = 'pending'
      AND message.delivered_at = ''
      AND message.lease_capability_hash <> ''
      AND message.lease_expires_at <> ''
      AND message.lease_expires_at <= recovery_timestamp;
    IF FOUND THEN
      receipt_input := ${receiptParts};
      INSERT INTO ${relation(manifest.schemaName, "hosted_delivery_receipts")}(
        id, tenant_id, user_id, direction, message_id, disposition,
        attempt, reason_code, receipt_hash, created_at
      ) VALUES (
        'delivery_receipt_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
        resolved_tenant_id, resolved_user_id, direction_value, message_record.id,
        disposition_value, message_record.attempt, 'lease_expired',
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(receipt_input, 'UTF8')), 'hex'),
        recovery_timestamp
      );
      IF disposition_value = 'dead_letter' THEN
        outbox_dead_lettered_count := outbox_dead_lettered_count + 1;
      ELSE
        outbox_requeued_count := outbox_requeued_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT inbox_requeued_count, inbox_dead_lettered_count,
                      outbox_requeued_count, outbox_dead_lettered_count;
END
`;
}

export function hostedSignalInboxFunctionSource(
  manifest: PostgresHostedDeliveryLeaseRecoveryManifest
): string {
  const capabilityParts = stableHashInputSql([
    "'hosted_delivery_capability_v1'::text",
    "message_record.id::text",
    "capability_token"
  ]);
  const receiptParts = stableHashInputSql([
    "'hosted_delivery_receipt_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'inbox'::text",
    "message_record.id::text",
    "disposition_value",
    "message_record.attempt::text",
    "reason_code_value",
    "transition_timestamp"
  ]);
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  transition_timestamp TEXT;
  new_lease_expires_at TEXT;
  new_next_attempt_at TEXT;
  message_record RECORD;
  capability_input TEXT;
  expected_capability_hash TEXT;
  disposition_value TEXT;
  reason_code_value TEXT;
  receipt_input TEXT;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected hosted signal principal is invalid';
  END IF;
  IF operation_name NOT IN ('lease', 'complete', 'fail', 'dead_letter') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal inbox operation is invalid';
  END IF;
  IF capability_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal inbox capability is invalid';
  END IF;
  IF (operation_name = 'lease' AND target_message_id <> '')
    OR (operation_name <> 'lease'
      AND target_message_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal inbox message is invalid';
  END IF;

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

  transition_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  IF operation_name = 'lease' THEN
    SELECT message.id, message.source, message.message_key,
           message.event_type, message.payload_json,
           message.delivery_attempts + 1 AS attempt
      INTO message_record
    FROM ${relation(manifest.schemaName, "inbox_messages")} AS message
    WHERE message.tenant_id = resolved_tenant_id
      AND message.user_id = resolved_user_id
      AND message.event_type = '${SIGNAL_INGRESS_EVENT_TYPE}'
      AND message.delivery_attempts < ${MAXIMUM_DELIVERY_ATTEMPTS}
      AND (
        (message.state IN ('accepted', 'failed')
          AND (message.next_attempt_at = '' OR message.next_attempt_at <= transition_timestamp)
          AND (message.lease_capability_hash = ''
            OR message.lease_expires_at <= transition_timestamp))
        OR (message.state = 'processing'
          AND message.lease_expires_at <> ''
          AND message.lease_expires_at <= transition_timestamp)
      )
    ORDER BY message.received_at, message.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN;
    END IF;

    capability_input := ${capabilityParts};
    expected_capability_hash := pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(capability_input, 'UTF8')),
      'hex'
    );
    new_lease_expires_at := pg_catalog.to_char(
      (pg_catalog.statement_timestamp() + INTERVAL '${SIGNAL_LEASE_SECONDS} seconds') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    UPDATE ${relation(manifest.schemaName, "inbox_messages")} AS message
    SET state = 'processing', delivery_attempts = message_record.attempt,
        lease_capability_hash = expected_capability_hash,
        lease_expires_at = new_lease_expires_at,
        next_attempt_at = '', last_error_code = '',
        updated_at = transition_timestamp
    WHERE message.id = message_record.id
      AND message.tenant_id = resolved_tenant_id
      AND message.user_id = resolved_user_id
      AND message.event_type = '${SIGNAL_INGRESS_EVENT_TYPE}';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'hosted signal inbox lease changed concurrently';
    END IF;
    disposition_value := 'leased';
    reason_code_value := 'worker_lease';
    receipt_input := ${receiptParts};
    INSERT INTO ${relation(manifest.schemaName, "hosted_delivery_receipts")}(
      id, tenant_id, user_id, direction, message_id, disposition,
      attempt, reason_code, receipt_hash, created_at
    ) VALUES (
      'delivery_receipt_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      resolved_tenant_id, resolved_user_id, 'inbox', message_record.id,
      disposition_value, message_record.attempt, reason_code_value,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(receipt_input, 'UTF8')), 'hex'),
      transition_timestamp
    );
    RETURN QUERY SELECT message_record.id::text, message_record.source::text,
      message_record.message_key::text, message_record.event_type::text,
      message_record.payload_json::text, message_record.attempt::bigint,
      new_lease_expires_at, disposition_value, TRUE;
    RETURN;
  END IF;

  SELECT message.id, message.source, message.message_key,
         message.event_type, message.payload_json,
         message.delivery_attempts AS attempt,
         message.lease_capability_hash, message.lease_expires_at
    INTO message_record
  FROM ${relation(manifest.schemaName, "inbox_messages")} AS message
  WHERE message.id = target_message_id
    AND message.tenant_id = resolved_tenant_id
    AND message.user_id = resolved_user_id
    AND message.event_type = '${SIGNAL_INGRESS_EVENT_TYPE}'
    AND message.state = 'processing'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'hosted signal inbox capability is invalid or expired';
  END IF;
  capability_input := ${capabilityParts};
  expected_capability_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(capability_input, 'UTF8')),
    'hex'
  );
  IF message_record.lease_capability_hash <> expected_capability_hash
    OR message_record.lease_expires_at = ''
    OR message_record.lease_expires_at <= transition_timestamp THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'hosted signal inbox capability is invalid or expired';
  END IF;

  IF operation_name = 'complete' THEN
    disposition_value := 'processed';
    reason_code_value := 'worker_ack';
    new_next_attempt_at := '';
    UPDATE ${relation(manifest.schemaName, "inbox_messages")} AS message
    SET state = 'processed', lease_capability_hash = '', lease_expires_at = '',
        next_attempt_at = '', last_error_code = '',
        processed_at = transition_timestamp, updated_at = transition_timestamp
    WHERE message.id = message_record.id
      AND message.tenant_id = resolved_tenant_id
      AND message.user_id = resolved_user_id
      AND message.state = 'processing';
  ELSE
    -- 'dead_letter' mirrors SQLite HostedDeliveryRepository.deadLetterInbox:
    -- a permanent failure (signalFailureIsPermanent in
    -- packages/engine/src/signal-ingress.ts) cannot succeed on retry, so it
    -- is dead-lettered now instead of burning every attempt first.
    disposition_value := CASE
      WHEN operation_name = 'dead_letter' THEN 'dead_letter'
      WHEN message_record.attempt >= ${MAXIMUM_DELIVERY_ATTEMPTS} THEN 'dead_letter'
      ELSE 'retry'
    END;
    reason_code_value := CASE
      WHEN operation_name = 'dead_letter' THEN 'signal_rejected_invalid'
      ELSE 'signal_processing_failed'
    END;
    new_next_attempt_at := CASE
      WHEN disposition_value = 'dead_letter' THEN ''
      ELSE pg_catalog.to_char(
        (pg_catalog.statement_timestamp() + INTERVAL '${SIGNAL_RETRY_SECONDS} seconds') AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    END;
    UPDATE ${relation(manifest.schemaName, "inbox_messages")} AS message
    SET state = CASE WHEN disposition_value = 'dead_letter' THEN 'dead_letter' ELSE 'failed' END,
        lease_capability_hash = '', lease_expires_at = '',
        next_attempt_at = new_next_attempt_at,
        last_error_code = reason_code_value, updated_at = transition_timestamp
    WHERE message.id = message_record.id
      AND message.tenant_id = resolved_tenant_id
      AND message.user_id = resolved_user_id
      AND message.state = 'processing';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'hosted signal inbox transition changed concurrently';
  END IF;
  receipt_input := ${receiptParts};
  INSERT INTO ${relation(manifest.schemaName, "hosted_delivery_receipts")}(
    id, tenant_id, user_id, direction, message_id, disposition,
    attempt, reason_code, receipt_hash, created_at
  ) VALUES (
    'delivery_receipt_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
    resolved_tenant_id, resolved_user_id, 'inbox', message_record.id,
    disposition_value, message_record.attempt, reason_code_value,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(receipt_input, 'UTF8')), 'hex'),
    transition_timestamp
  );
  RETURN QUERY SELECT message_record.id::text, message_record.source::text,
    message_record.message_key::text, message_record.event_type::text,
    message_record.payload_json::text, message_record.attempt::bigint,
    ''::text, disposition_value, TRUE;
END
`;
}

export function hostedSignalResolutionPlanFunctionSource(
  manifest: PostgresHostedDeliveryLeaseRecoveryManifest
): string {
  const capabilityParts = stableHashInputSql([
    "'hosted_delivery_capability_v1'::text",
    "message_record.id::text",
    "capability_token"
  ]);
  const payloadParts = stableHashInputSql([
    "'hosted_delivery_payload_v1'::text",
    "message_record.payload_json::text"
  ]);
  const transportParts = stableHashInputSql([
    "source_connection_id_value",
    "external_event_id_value"
  ]);
  const planParts = stableHashInputSql([
    "'postgres_hosted_signal_resolution_plan_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'1'::text",
    "message_record.id::text",
    "message_record.payload_hash::text",
    "plan_timestamp",
    "valid_until_timestamp",
    "source_connection_id_value",
    "source_record.trust_level::text",
    "CASE WHEN source_record.auto_create_missions = 1 THEN '1' ELSE '0' END",
    "signal_id_value",
    "external_event_id_value",
    "event_type_value",
    "observed_at_value",
    "received_at_value",
    "CASE WHEN test_value THEN '1' ELSE '0' END",
    "transport_hash_value",
    "outcome_value",
    "duplicate_event_id_value",
    "resolution_status_value",
    "resolution_method_value",
    "resolution_reason_value",
    "listing_id_value",
    "listing_variant_id_value",
    "listing_title_value",
    "listing_retailer_id_value",
    "listing_retailer_sku_value",
    "listing_canonical_url_value",
    "CASE WHEN listing_id_value = '' THEN '' WHEN listing_execution_supported_value = 1 THEN '1' ELSE '0' END",
    "COALESCE(listing_msrp_cents_value::text, '')",
    "listing_currency_value",
    "CASE WHEN shared_catalog_mutation_required_value THEN '1' ELSE '0' END"
  ]);
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  plan_timestamp TEXT;
  valid_until_timestamp TEXT;
  message_record RECORD;
  source_record RECORD;
  payload_value JSONB;
  identity_value JSONB;
  offer_value JSONB;
  evidence_value JSONB;
  capability_input TEXT;
  payload_input TEXT;
  transport_input TEXT;
  plan_input TEXT;
  expected_capability_hash TEXT;
  expected_payload_hash TEXT;
  transport_hash_value TEXT;
  plan_fingerprint_value TEXT;
  source_connection_id_value TEXT;
  signal_id_value TEXT;
  external_event_id_value TEXT;
  event_type_value TEXT;
  observed_at_value TEXT;
  received_at_value TEXT;
  test_value BOOLEAN;
  source_product_id_value TEXT;
  source_listing_id_value TEXT;
  retailer_id_value TEXT;
  retailer_sku_value TEXT;
  canonical_url_value TEXT;
  title_value TEXT;
  trackalacker_slug_value TEXT;
  duplicate_count BIGINT := 0;
  duplicate_event_id_value TEXT := '';
  outcome_value TEXT := 'unresolved';
  resolution_status_value TEXT := 'unresolved';
  resolution_method_value TEXT := 'none';
  resolution_reason_value TEXT := 'No exact source-listing or retailer-SKU mapping matched the signal.';
  candidate_count BIGINT := 0;
  listing_id_value TEXT := '';
  listing_variant_id_value TEXT := '';
  listing_title_value TEXT := '';
  listing_retailer_id_value TEXT := '';
  listing_retailer_sku_value TEXT := '';
  listing_canonical_url_value TEXT := '';
  listing_execution_supported_value BIGINT := 0;
  listing_msrp_cents_value BIGINT;
  listing_currency_value TEXT := '';
  shared_catalog_mutation_required_value BOOLEAN := FALSE;
  result_value JSONB;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected hosted signal principal is invalid';
  END IF;
  IF target_message_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal resolution message is invalid';
  END IF;
  IF capability_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal inbox capability is invalid';
  END IF;

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

  plan_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  SELECT message.id, message.source, message.event_type, message.payload_hash,
         message.payload_json, message.lease_capability_hash, message.lease_expires_at
    INTO message_record
  FROM ${relation(manifest.schemaName, "inbox_messages")} AS message
  WHERE message.id = target_message_id
    AND message.tenant_id = resolved_tenant_id
    AND message.user_id = resolved_user_id
    AND message.source = 'trackalacker'
    AND message.event_type = '${SIGNAL_INGRESS_EVENT_TYPE}'
    AND message.state = 'processing'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'hosted signal inbox capability is invalid or expired';
  END IF;

  capability_input := ${capabilityParts};
  expected_capability_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(capability_input, 'UTF8')),
    'hex'
  );
  IF message_record.lease_capability_hash <> expected_capability_hash
    OR message_record.lease_expires_at = ''
    OR message_record.lease_expires_at <= plan_timestamp THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'hosted signal inbox capability is invalid or expired';
  END IF;

  payload_input := ${payloadParts};
  expected_payload_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(payload_input, 'UTF8')),
    'hex'
  );
  IF message_record.payload_hash !~ '^[a-f0-9]{64}$'
    OR message_record.payload_hash <> expected_payload_hash THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal inbox payload hash is invalid';
  END IF;
  BEGIN
    payload_value := message_record.payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal inbox payload is invalid';
  END;
  IF pg_catalog.jsonb_typeof(payload_value) IS DISTINCT FROM 'object'
    OR payload_value - ARRAY[
      'schemaVersion', 'signalId', 'sourceConnectionId', 'source',
      'externalEventId', 'eventType', 'observedAt', 'receivedAt', 'test',
      'identity', 'offer', 'evidence', 'parserVersion'
    ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR pg_catalog.jsonb_typeof(payload_value->'schemaVersion') IS DISTINCT FROM 'number'
    OR COALESCE(payload_value->>'schemaVersion', '') !~ '^[1-9][0-9]*$'
    OR pg_catalog.jsonb_typeof(payload_value->'signalId') IS DISTINCT FROM 'string'
    OR pg_catalog.length(payload_value->>'signalId') NOT BETWEEN 1 AND 180
    OR pg_catalog.jsonb_typeof(payload_value->'sourceConnectionId') IS DISTINCT FROM 'string'
    OR pg_catalog.length(payload_value->>'sourceConnectionId') NOT BETWEEN 1 AND 120
    OR payload_value->>'source' IS DISTINCT FROM 'trackalacker'
    OR pg_catalog.jsonb_typeof(payload_value->'externalEventId') IS DISTINCT FROM 'string'
    OR pg_catalog.length(payload_value->>'externalEventId') NOT BETWEEN 1 AND 180
    OR pg_catalog.jsonb_typeof(payload_value->'eventType') IS DISTINCT FROM 'string'
    OR COALESCE(payload_value->>'eventType', '') NOT IN ('in_stock', 'restock', 'preorder', 'price_change', 'drop_window', 'queue_open', 'unknown')
    OR pg_catalog.jsonb_typeof(payload_value->'observedAt') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(payload_value->'receivedAt') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(payload_value->'test') IS DISTINCT FROM 'boolean'
    OR pg_catalog.jsonb_typeof(payload_value->'identity') IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(payload_value->'offer') IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(payload_value->'evidence') IS DISTINCT FROM 'object'
    OR payload_value->>'parserVersion' IS DISTINCT FROM 'trackalacker-push-v1'
    OR (payload_value->'offer') ? 'offerId' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal inbox payload contract is invalid';
  END IF;

  identity_value := payload_value->'identity';
  offer_value := payload_value->'offer';
  evidence_value := payload_value->'evidence';
  IF identity_value - ARRAY[
      'sourceProductId', 'sourceListingId', 'retailerId', 'retailerSku',
      'canonicalUrl', 'title', 'globalIdentifiers'
    ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR pg_catalog.jsonb_typeof(identity_value->'sourceProductId') IS DISTINCT FROM 'string'
    OR pg_catalog.length(identity_value->>'sourceProductId') > 120
    OR pg_catalog.jsonb_typeof(identity_value->'sourceListingId') IS DISTINCT FROM 'string'
    OR pg_catalog.length(identity_value->>'sourceListingId') > 120
    OR pg_catalog.jsonb_typeof(identity_value->'retailerId') IS DISTINCT FROM 'string'
    OR pg_catalog.length(identity_value->>'retailerId') > 60
    OR pg_catalog.jsonb_typeof(identity_value->'retailerSku') IS DISTINCT FROM 'string'
    OR pg_catalog.length(identity_value->>'retailerSku') > 64
    OR pg_catalog.jsonb_typeof(identity_value->'canonicalUrl') IS DISTINCT FROM 'string'
    OR pg_catalog.length(identity_value->>'canonicalUrl') > 4096
    OR pg_catalog.jsonb_typeof(identity_value->'title') IS DISTINCT FROM 'string'
    OR pg_catalog.length(identity_value->>'title') > 300
    OR pg_catalog.jsonb_typeof(identity_value->'globalIdentifiers') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal identity contract is invalid';
  END IF;
  IF offer_value - ARRAY[
      'availability', 'unitPriceCents', 'currency', 'sellerName',
      'sellerType', 'orderLimit', 'fulfillment', 'offerFingerprint'
    ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR pg_catalog.jsonb_typeof(offer_value->'availability') IS DISTINCT FROM 'string'
    OR COALESCE(offer_value->>'availability', '') NOT IN (
      'in_stock', 'preorder', 'out_of_stock', 'unknown'
    )
    OR NOT (CASE
      WHEN pg_catalog.jsonb_typeof(offer_value->'unitPriceCents') = 'null' THEN TRUE
      WHEN pg_catalog.jsonb_typeof(offer_value->'unitPriceCents') = 'number'
        AND COALESCE(offer_value->>'unitPriceCents', '') ~ '^[1-9][0-9]{0,8}$'
        THEN (offer_value->>'unitPriceCents')::bigint <= 100000000
      ELSE FALSE
    END)
    OR pg_catalog.jsonb_typeof(offer_value->'currency') IS DISTINCT FROM 'string'
    OR COALESCE(offer_value->>'currency', '') !~ '^[A-Z]{3}$'
    OR pg_catalog.jsonb_typeof(offer_value->'sellerName') IS DISTINCT FROM 'string'
    OR pg_catalog.length(offer_value->>'sellerName') > 160
    OR pg_catalog.jsonb_typeof(offer_value->'sellerType') IS DISTINCT FROM 'string'
    OR COALESCE(offer_value->>'sellerType', '') NOT IN ('first_party', 'third_party', 'unknown')
    OR NOT (CASE
      WHEN pg_catalog.jsonb_typeof(offer_value->'orderLimit') = 'null' THEN TRUE
      WHEN pg_catalog.jsonb_typeof(offer_value->'orderLimit') = 'number'
        AND COALESCE(offer_value->>'orderLimit', '') ~ '^[1-9][0-9]?$'
        THEN (offer_value->>'orderLimit')::bigint <= 99
      ELSE FALSE
    END)
    OR pg_catalog.jsonb_typeof(offer_value->'fulfillment') IS DISTINCT FROM 'string'
    OR COALESCE(offer_value->>'fulfillment', '') NOT IN (
      'shipping', 'pickup', 'either', 'manual', 'unknown'
    )
    OR pg_catalog.jsonb_typeof(offer_value->'offerFingerprint') IS DISTINCT FROM 'string'
    OR (COALESCE(offer_value->>'offerFingerprint', '') <> ''
      AND COALESCE(offer_value->>'offerFingerprint', '') !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal offer contract is invalid';
  END IF;
  IF evidence_value - ARRAY[
      'headline', 'body', 'msrpStatus', 'clickUrl'
    ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR pg_catalog.jsonb_typeof(evidence_value->'headline') IS DISTINCT FROM 'string'
    OR pg_catalog.length(evidence_value->>'headline') > 500
    OR pg_catalog.jsonb_typeof(evidence_value->'body') IS DISTINCT FROM 'string'
    OR pg_catalog.length(evidence_value->>'body') > 2000
    OR pg_catalog.jsonb_typeof(evidence_value->'msrpStatus') IS DISTINCT FROM 'string'
    OR pg_catalog.length(evidence_value->>'msrpStatus') > 60
    OR pg_catalog.jsonb_typeof(evidence_value->'clickUrl') IS DISTINCT FROM 'string'
    OR pg_catalog.length(evidence_value->>'clickUrl') > 4096 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal evidence contract is invalid';
  END IF;

  signal_id_value := payload_value->>'signalId';
  source_connection_id_value := payload_value->>'sourceConnectionId';
  external_event_id_value := payload_value->>'externalEventId';
  event_type_value := payload_value->>'eventType';
  observed_at_value := payload_value->>'observedAt';
  received_at_value := payload_value->>'receivedAt';
  test_value := (payload_value->>'test')::boolean;
  source_product_id_value := identity_value->>'sourceProductId';
  source_listing_id_value := identity_value->>'sourceListingId';
  retailer_id_value := identity_value->>'retailerId';
  retailer_sku_value := identity_value->>'retailerSku';
  canonical_url_value := identity_value->>'canonicalUrl';
  title_value := identity_value->>'title';
  trackalacker_slug_value := pg_catalog.lower(
    COALESCE(identity_value->'globalIdentifiers'->>'trackalacker_slug', '')
  );
  BEGIN
    PERFORM observed_at_value::timestamptz;
    PERFORM received_at_value::timestamptz;
    PERFORM message_record.lease_expires_at::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal timestamp contract is invalid';
  END;

  SELECT connection.id, connection.trust_level, connection.auto_create_missions
    INTO source_record
  FROM ${relation(manifest.schemaName, "source_connections")} AS connection
  WHERE connection.id = source_connection_id_value
    AND connection.tenant_id = resolved_tenant_id
    AND connection.user_id = resolved_user_id
    AND connection.source = 'trackalacker';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'hosted signal source connection is unavailable';
  END IF;

  transport_input := ${transportParts};
  transport_hash_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(transport_input, 'UTF8')),
    'hex'
  );
  SELECT MIN(event.id), COUNT(*)
    INTO duplicate_event_id_value, duplicate_count
  FROM ${relation(manifest.schemaName, "signal_events")} AS event
  WHERE event.tenant_id = resolved_tenant_id
    AND event.user_id = resolved_user_id
    AND event.source_connection_id = source_connection_id_value
    AND (event.external_event_id = external_event_id_value
      OR event.signal_id = signal_id_value
      OR event.transport_hash = transport_hash_value);
  duplicate_event_id_value := COALESCE(duplicate_event_id_value, '');
  IF duplicate_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'hosted signal duplicate identity is ambiguous';
  END IF;

  IF duplicate_count = 1 THEN
    outcome_value := 'duplicate';
    resolution_status_value := '';
    resolution_method_value := '';
    resolution_reason_value := '';
  ELSE
    IF source_listing_id_value <> '' THEN
      SELECT listing.id, listing.variant_id, variant.title, listing.retailer_id,
             listing.retailer_sku, listing.canonical_url, listing.execution_supported,
             listing.msrp_cents, listing.currency
        INTO listing_id_value, listing_variant_id_value, listing_title_value,
             listing_retailer_id_value, listing_retailer_sku_value,
             listing_canonical_url_value, listing_execution_supported_value,
             listing_msrp_cents_value, listing_currency_value
      FROM ${relation(manifest.schemaName, "source_listing_refs")} AS reference
      JOIN ${relation(manifest.schemaName, "listings")} AS listing
        ON listing.id = reference.listing_id
      JOIN ${relation(manifest.schemaName, "variants")} AS variant
        ON variant.id = listing.variant_id
      WHERE reference.source_connection_id = source_connection_id_value
        AND reference.external_listing_id = source_listing_id_value;
      IF FOUND THEN
        resolution_method_value := 'source_listing_id';
        IF (retailer_id_value <> '' AND retailer_id_value <> listing_retailer_id_value)
          OR (retailer_sku_value <> '' AND retailer_sku_value <> listing_retailer_sku_value) THEN
          resolution_status_value := 'ambiguous';
          resolution_reason_value := 'The source listing reference conflicts with the supplied retailer identity.';
        ELSE
          resolution_status_value := 'matched';
          resolution_reason_value := 'Matched the exact source listing reference.';
        END IF;
      END IF;
    END IF;

    IF resolution_status_value = 'unresolved'
      AND retailer_id_value <> '' AND retailer_sku_value <> '' THEN
      SELECT listing.id, listing.variant_id, variant.title, listing.retailer_id,
             listing.retailer_sku, listing.canonical_url, listing.execution_supported,
             listing.msrp_cents, listing.currency
        INTO listing_id_value, listing_variant_id_value, listing_title_value,
             listing_retailer_id_value, listing_retailer_sku_value,
             listing_canonical_url_value, listing_execution_supported_value,
             listing_msrp_cents_value, listing_currency_value
      FROM ${relation(manifest.schemaName, "listings")} AS listing
      JOIN ${relation(manifest.schemaName, "variants")} AS variant
        ON variant.id = listing.variant_id
      WHERE listing.retailer_id = retailer_id_value
        AND listing.retailer_sku = retailer_sku_value;
      IF FOUND THEN
        resolution_status_value := 'matched';
        resolution_method_value := 'retailer_sku';
        resolution_reason_value := 'Matched the exact retailer and SKU.';
      END IF;
    END IF;

    IF resolution_status_value = 'unresolved'
      AND source_product_id_value <> '' AND retailer_id_value <> '' THEN
      SELECT listing.id, listing.variant_id, variant.title, listing.retailer_id,
             listing.retailer_sku, listing.canonical_url, listing.execution_supported,
             listing.msrp_cents, listing.currency
        INTO listing_id_value, listing_variant_id_value, listing_title_value,
             listing_retailer_id_value, listing_retailer_sku_value,
             listing_canonical_url_value, listing_execution_supported_value,
             listing_msrp_cents_value, listing_currency_value
      FROM ${relation(manifest.schemaName, "source_product_refs")} AS product_reference
      JOIN ${relation(manifest.schemaName, "source_variant_retailer_refs")} AS preferred
        ON preferred.source_connection_id = product_reference.source_connection_id
       AND preferred.variant_id = product_reference.variant_id
       AND preferred.retailer_id = retailer_id_value
      JOIN ${relation(manifest.schemaName, "listings")} AS listing
        ON listing.id = preferred.listing_id
       AND listing.variant_id = preferred.variant_id
       AND listing.retailer_id = preferred.retailer_id
      JOIN ${relation(manifest.schemaName, "variants")} AS variant
        ON variant.id = listing.variant_id
      WHERE product_reference.source_connection_id = source_connection_id_value
        AND product_reference.external_product_id = source_product_id_value;
      IF FOUND THEN
        resolution_status_value := 'matched';
        resolution_method_value := 'source_product_preferred_retailer';
        resolution_reason_value := 'Matched the preferred exact retailer route for this source product.';
      ELSE
        SELECT COUNT(*) INTO candidate_count
        FROM ${relation(manifest.schemaName, "source_product_refs")} AS reference
        JOIN ${relation(manifest.schemaName, "variants")} AS variant
          ON variant.id = reference.variant_id
        JOIN ${relation(manifest.schemaName, "listings")} AS listing
          ON listing.variant_id = variant.id
        WHERE reference.source_connection_id = source_connection_id_value
          AND reference.external_product_id = source_product_id_value
          AND listing.retailer_id = retailer_id_value;
        IF candidate_count = 1 THEN
          SELECT listing.id, listing.variant_id, variant.title, listing.retailer_id,
                 listing.retailer_sku, listing.canonical_url, listing.execution_supported,
                 listing.msrp_cents, listing.currency
            INTO listing_id_value, listing_variant_id_value, listing_title_value,
                 listing_retailer_id_value, listing_retailer_sku_value,
                 listing_canonical_url_value, listing_execution_supported_value,
                 listing_msrp_cents_value, listing_currency_value
          FROM ${relation(manifest.schemaName, "source_product_refs")} AS reference
          JOIN ${relation(manifest.schemaName, "variants")} AS variant
            ON variant.id = reference.variant_id
          JOIN ${relation(manifest.schemaName, "listings")} AS listing
            ON listing.variant_id = variant.id
          WHERE reference.source_connection_id = source_connection_id_value
            AND reference.external_product_id = source_product_id_value
            AND listing.retailer_id = retailer_id_value;
          resolution_status_value := 'matched';
          resolution_method_value := 'source_product_retailer';
          resolution_reason_value := 'Matched the unique source product and retailer listing.';
        ELSIF candidate_count > 1 THEN
          resolution_status_value := 'ambiguous';
          resolution_method_value := 'source_product_retailer';
          resolution_reason_value := 'Multiple same-retailer listings exist for this source product; an exact listing ID or SKU is required.';
        END IF;
      END IF;
    END IF;

    IF resolution_status_value = 'unresolved'
      AND trackalacker_slug_value <> '' AND retailer_id_value <> '' THEN
      SELECT listing.id, listing.variant_id, variant.title, listing.retailer_id,
             listing.retailer_sku, listing.canonical_url, listing.execution_supported,
             listing.msrp_cents, listing.currency
        INTO listing_id_value, listing_variant_id_value, listing_title_value,
             listing_retailer_id_value, listing_retailer_sku_value,
             listing_canonical_url_value, listing_execution_supported_value,
             listing_msrp_cents_value, listing_currency_value
      FROM ${relation(manifest.schemaName, "source_product_aliases")} AS alias
      JOIN ${relation(manifest.schemaName, "source_variant_retailer_refs")} AS preferred
        ON preferred.source_connection_id = alias.source_connection_id
       AND preferred.variant_id = alias.variant_id
       AND preferred.retailer_id = retailer_id_value
      JOIN ${relation(manifest.schemaName, "listings")} AS listing
        ON listing.id = preferred.listing_id
       AND listing.variant_id = preferred.variant_id
       AND listing.retailer_id = preferred.retailer_id
      JOIN ${relation(manifest.schemaName, "variants")} AS variant
        ON variant.id = listing.variant_id
      WHERE alias.source_connection_id = source_connection_id_value
        AND alias.alias_kind = 'trackalacker_slug'
        AND alias.alias_value = trackalacker_slug_value;
      IF FOUND THEN
        resolution_status_value := 'matched';
        resolution_method_value := 'source_product_slug_preferred_retailer';
        resolution_reason_value := 'Matched the preferred exact retailer route for this TrackaLacker product slug.';
      ELSE
        SELECT COUNT(*) INTO candidate_count
        FROM ${relation(manifest.schemaName, "source_product_aliases")} AS alias
        JOIN ${relation(manifest.schemaName, "variants")} AS variant
          ON variant.id = alias.variant_id
        JOIN ${relation(manifest.schemaName, "listings")} AS listing
          ON listing.variant_id = variant.id
        WHERE alias.source_connection_id = source_connection_id_value
          AND alias.alias_kind = 'trackalacker_slug'
          AND alias.alias_value = trackalacker_slug_value
          AND listing.retailer_id = retailer_id_value;
        IF candidate_count = 1 THEN
          SELECT listing.id, listing.variant_id, variant.title, listing.retailer_id,
                 listing.retailer_sku, listing.canonical_url, listing.execution_supported,
                 listing.msrp_cents, listing.currency
            INTO listing_id_value, listing_variant_id_value, listing_title_value,
                 listing_retailer_id_value, listing_retailer_sku_value,
                 listing_canonical_url_value, listing_execution_supported_value,
                 listing_msrp_cents_value, listing_currency_value
          FROM ${relation(manifest.schemaName, "source_product_aliases")} AS alias
          JOIN ${relation(manifest.schemaName, "variants")} AS variant
            ON variant.id = alias.variant_id
          JOIN ${relation(manifest.schemaName, "listings")} AS listing
            ON listing.variant_id = variant.id
          WHERE alias.source_connection_id = source_connection_id_value
            AND alias.alias_kind = 'trackalacker_slug'
            AND alias.alias_value = trackalacker_slug_value
            AND listing.retailer_id = retailer_id_value;
          resolution_status_value := 'matched';
          resolution_method_value := 'source_product_slug_retailer';
          resolution_reason_value := 'Matched the unique TrackaLacker product slug and retailer listing.';
        ELSIF candidate_count > 1 THEN
          resolution_status_value := 'ambiguous';
          resolution_method_value := 'source_product_slug_retailer';
          resolution_reason_value := 'Multiple same-retailer listings exist for this TrackaLacker product slug; an exact listing ID or SKU is required.';
        END IF;
      END IF;
    END IF;

    outcome_value := resolution_status_value;
    shared_catalog_mutation_required_value := resolution_status_value = 'unresolved'
      AND NOT test_value
      AND source_record.trust_level = 'trusted_exact'
      AND source_record.auto_create_missions = 1
      AND source_product_id_value <> ''
      AND retailer_id_value <> ''
      AND retailer_sku_value <> ''
      AND canonical_url_value <> ''
      AND title_value <> '';
  END IF;

  IF resolution_status_value <> 'matched' THEN
    listing_id_value := '';
    listing_variant_id_value := '';
    listing_title_value := '';
    listing_retailer_id_value := '';
    listing_retailer_sku_value := '';
    listing_canonical_url_value := '';
    listing_execution_supported_value := 0;
    listing_msrp_cents_value := NULL;
    listing_currency_value := '';
  END IF;

  valid_until_timestamp := pg_catalog.to_char(
    LEAST(
      pg_catalog.statement_timestamp() + INTERVAL '${SIGNAL_RESOLUTION_PLAN_SECONDS} seconds',
      message_record.lease_expires_at::timestamptz
    ) AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  IF valid_until_timestamp <= plan_timestamp THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'hosted signal inbox capability is invalid or expired';
  END IF;
  plan_input := ${planParts};
  plan_fingerprint_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(plan_input, 'UTF8')),
    'hex'
  );
  result_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_record.id::text,
    'payloadHash', message_record.payload_hash::text,
    'evaluatedAt', plan_timestamp,
    'validUntil', valid_until_timestamp,
    'sourceConnection', pg_catalog.jsonb_build_object(
      'id', source_connection_id_value,
      'trustLevel', source_record.trust_level::text,
      'autoCreateMissions', source_record.auto_create_missions = 1
    ),
    'signal', pg_catalog.jsonb_build_object(
      'signalId', signal_id_value,
      'externalEventId', external_event_id_value,
      'eventType', event_type_value,
      'observedAt', observed_at_value,
      'receivedAt', received_at_value,
      'test', test_value,
      'transportHash', transport_hash_value
    ),
    'outcome', outcome_value,
    'duplicateEventId', duplicate_event_id_value,
    'resolution', CASE WHEN outcome_value = 'duplicate' THEN 'null'::jsonb ELSE
      pg_catalog.jsonb_build_object(
        'status', resolution_status_value,
        'method', resolution_method_value,
        'reason', resolution_reason_value,
        'listing', CASE WHEN listing_id_value = '' THEN 'null'::jsonb ELSE
          pg_catalog.jsonb_build_object(
            'id', listing_id_value,
            'variantId', listing_variant_id_value,
            'title', listing_title_value,
            'retailerId', listing_retailer_id_value,
            'retailerSku', listing_retailer_sku_value,
            'canonicalUrl', listing_canonical_url_value,
            'executionSupported', listing_execution_supported_value = 1,
            'msrpCents', listing_msrp_cents_value,
            'currency', listing_currency_value
          ) END
      ) END,
    'sharedCatalogMutationRequired', shared_catalog_mutation_required_value,
    'planFingerprint', plan_fingerprint_value
  );
  RETURN QUERY SELECT result_value::text;
END
`;
}

export function buildPostgresHostedDeliveryLeaseRecoveryManifest(
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification",
  requestedObserverCandidateRoleNamespace = "yoink_candidate_qualification",
  requestedAlertDispatchRoleNamespace = "yoink_dispatch_qualification",
  requestedAlertReconciliationRoleNamespace = "yoink_reconcile_qualification",
  requestedWitnessRefreshRoleNamespace = "yoink_witness_qualification",
  requestedLeaseRecoveryRoleNamespace = "yoink_delivery_qualification"
): PostgresHostedDeliveryLeaseRecoveryManifest {
  const schema = safeSchema(requestedSchema);
  const previous = buildPostgresObserverWitnessRefreshManifest(
    schema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace,
    requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace,
    requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace
  );
  const leaseRecoveryRoleNamespace = safeNamespace(
    requestedLeaseRecoveryRoleNamespace,
    "yoink_delivery_qualification"
  );
  const priorNamespaces = new Set([
    previous.readRoleNamespace,
    previous.sessionRoleNamespace,
    previous.queueWriteRoleNamespace,
    previous.controlRoleNamespace,
    previous.notificationRecoveryRoleNamespace,
    previous.executionRecoveryRoleNamespace,
    previous.operationalRetentionRoleNamespace,
    previous.observerCandidateRoleNamespace,
    previous.alertDispatchRoleNamespace,
    previous.alertReconciliationRoleNamespace,
    previous.witnessRefreshRoleNamespace
  ]);
  if (priorNamespaces.has(leaseRecoveryRoleNamespace)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresHostedDeliveryLeaseRecoveryManifest, "fingerprint"> = {
    contractVersion: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
    cutoverContractVersion: 3,
    witnessRefreshContractVersion: 1,
    schemaName: previous.schemaName,
    readRoleNamespace: previous.readRoleNamespace,
    sessionRoleNamespace: previous.sessionRoleNamespace,
    queueWriteRoleNamespace: previous.queueWriteRoleNamespace,
    controlRoleNamespace: previous.controlRoleNamespace,
    notificationRecoveryRoleNamespace: previous.notificationRecoveryRoleNamespace,
    executionRecoveryRoleNamespace: previous.executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace: previous.operationalRetentionRoleNamespace,
    observerCandidateRoleNamespace: previous.observerCandidateRoleNamespace,
    alertDispatchRoleNamespace: previous.alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace: previous.alertReconciliationRoleNamespace,
    witnessRefreshRoleNamespace: previous.witnessRefreshRoleNamespace,
    leaseRecoveryRoleNamespace,
    witnessRefreshManifestFingerprint: previous.fingerprint,
    leaseRecoveryRole: {
      kind: "hosted_delivery_lease_recovery_boundary",
      name: roleName(leaseRecoveryRoleNamespace),
      functionName: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      signalInboxFunctionName: POSTGRES_HOSTED_SIGNAL_INBOX_FUNCTION,
      signalInboxFunctionArgumentTypes: [...SIGNAL_FUNCTION_ARGUMENT_TYPES],
      signalResolutionPlanFunctionName: POSTGRES_HOSTED_SIGNAL_RESOLUTION_PLAN_FUNCTION,
      signalResolutionPlanFunctionArgumentTypes: [
        ...SIGNAL_RESOLUTION_PLAN_FUNCTION_ARGUMENT_TYPES
      ],
      protectedTableNames: [...PROTECTED_TABLES],
      forcedRlsTableNames: [...PROTECTED_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTableCount: 3,
    forcedRlsTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 3,
    boundaryHandlerTaskKinds: ["hosted_delivery_recovery"],
    qualifiedHandlerTaskKinds: [...QUALIFIED_HANDLER_TASK_KINDS],
    qualifiedHandlerTaskKindCount: 6,
    totalHandlerTaskKindCount: BACKGROUND_TASK_KINDS.length,
    maximumDeliveryAttempts: 20,
    maximumResolutionPlanAgeSeconds: SIGNAL_RESOLUTION_PLAN_SECONDS,
    serverBoundPrincipalLookup: true,
    databaseServerClock: true,
    deterministicReceiptHashParity: true,
    leaseRecoverySubBoundaryParity: true,
    signalInboxLifecycleRepositoryParity: true,
    signalResolutionPlanRepositoryParity: true,
    signalEvaluationApplyRepositoryParity: false,
    signalEvaluationRepositoryParity: false,
    signalIngressRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    allHandlerRepositoryParity: false,
    mutationAuthority: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresHostedDeliveryLeaseRecoveryCapabilityProjection():
PostgresHostedDeliveryLeaseRecoveryCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresHostedDeliveryLeaseRecoveryManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
    cutoverContractVersion: 3,
    witnessRefreshContractVersion: 1,
    deterministicManifestImplemented: true,
    atomicQualificationApplyImplemented: true,
    exactEffectivePrivilegeVerification: true,
    immutableBoundaryCatalogFingerprint: true,
    qualificationSuiteParity: true,
    noLogin: true,
    noInherit: true,
    noBypassRls: true,
    securityDefinerRoutineVerified: true,
    serverBoundPrincipalLookup: true,
    databaseServerClock: true,
    deterministicReceiptHashParity: true,
    readCommittedTransactionAdapter: true,
    nativeContentionQualified: true,
    leaseRecoverySubBoundaryParity: true,
    signalInboxLifecycleRepositoryParity: true,
    signalResolutionPlanRepositoryParity: true,
    signalEvaluationApplyRepositoryParity: false,
    sharedCatalogMutationFailClosed: true,
    rawSignalPayloadReturned: false,
    signalEvaluationRepositoryParity: false,
    signalIngressRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    allHandlerRepositoryParity: false,
    handlerTaskKindCount: 6,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    maximumDeliveryAttempts: 20,
    maximumResolutionPlanAgeSeconds: SIGNAL_RESOLUTION_PLAN_SECONDS,
    protectedTableCount: 3,
    forcedRlsTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 3,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

async function inspectBoundary(
  session: PostgresQuerySession,
  manifest: PostgresHostedDeliveryLeaseRecoveryManifest
): Promise<BoundaryInspection> {
  const role = manifest.leaseRecoveryRole.name;
  const roleResult = await session.query<RoleRow>(
    `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles WHERE rolname = $1`,
    [role]
  );
  const roleRow = roleResult.rows[0];
  if (roleResult.rows.length !== 1 || !roleRow || roleRow.rolsuper || roleRow.rolinherit
    || roleRow.rolcreaterole || roleRow.rolcreatedb || roleRow.rolcanlogin
    || roleRow.rolreplication || roleRow.rolbypassrls) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role has an unsafe attribute."
    );
  }
  const membershipResult = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_auth_members membership
     JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid
     JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
     WHERE granted_role.rolname = $1 OR member_role.rolname = $1`,
    [role]
  );
  if (exactInteger(membershipResult.rows[0]?.count, "membership count") !== 0) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role must remain unassigned."
    );
  }
  const directResult = await session.query<{ count: string | number | bigint }>(
    `SELECT (
       SELECT COUNT(*) FROM information_schema.role_table_grants
       WHERE table_schema = $1 AND grantee = $2
     ) + (
       SELECT COUNT(*) FROM information_schema.role_column_grants
       WHERE table_schema = $1 AND grantee = $2
     ) AS count`,
    [manifest.schemaName, role]
  );
  if (exactInteger(directResult.rows[0]?.count, "direct grant count") !== 0) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role has direct table authority."
    );
  }
  const effectiveTables = await session.query<{
    maySelect: boolean;
    mayInsert: boolean;
    mayUpdate: boolean;
    mayDelete: boolean;
    mayEscalate: boolean;
  }>(
    `SELECT has_table_privilege($2, relation.oid, 'SELECT') AS "maySelect",
            has_table_privilege($2, relation.oid, 'INSERT') AS "mayInsert",
            has_table_privilege($2, relation.oid, 'UPDATE') AS "mayUpdate",
            has_table_privilege($2, relation.oid, 'DELETE') AS "mayDelete",
            (has_table_privilege($2, relation.oid, 'TRUNCATE')
              OR has_table_privilege($2, relation.oid, 'REFERENCES')
              OR has_table_privilege($2, relation.oid, 'TRIGGER')) AS "mayEscalate"
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1 AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')`,
    [manifest.schemaName, role]
  );
  if (effectiveTables.rows.some((row) => row.maySelect || row.mayInsert
    || row.mayUpdate || row.mayDelete || row.mayEscalate)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role has an effective table privilege."
    );
  }
  const effectiveColumns = await session.query<{
    maySelect: boolean;
    mayInsert: boolean;
    mayUpdate: boolean;
    mayReference: boolean;
  }>(
    `SELECT has_column_privilege($2, relation.oid, attribute.attname, 'SELECT') AS "maySelect",
            has_column_privilege($2, relation.oid, attribute.attname, 'INSERT') AS "mayInsert",
            has_column_privilege($2, relation.oid, attribute.attname, 'UPDATE') AS "mayUpdate",
            has_column_privilege($2, relation.oid, attribute.attname, 'REFERENCES') AS "mayReference"
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid
     WHERE namespace.nspname = $1 AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND attribute.attnum > 0 AND NOT attribute.attisdropped`,
    [manifest.schemaName, role]
  );
  if (effectiveColumns.rows.some((row) => row.maySelect || row.mayInsert
    || row.mayUpdate || row.mayReference)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role has an effective column privilege."
    );
  }
  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery schema privilege is invalid."
    );
  }
  const routines = await session.query<RoutineRow>(
    `SELECT routine.oid::text AS oid, routine.proname AS "routineName",
            pg_catalog.oidvectortypes(routine.proargtypes) AS "argumentTypes",
            pg_catalog.pg_get_function_result(routine.oid) AS "resultType",
            routine.provolatile::text AS volatility,
            routine.prosecdef AS "securityDefiner", routine.proisstrict AS strict,
            routine.proleakproof AS leakproof, routine.proconfig AS configuration,
            owner_role.rolname AS "ownerName", routine.prosrc AS source
     FROM pg_catalog.pg_proc routine
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
     JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = routine.proowner
     WHERE namespace.nspname = $1 AND has_function_privilege($2, routine.oid, 'EXECUTE')
     ORDER BY routine.proname, pg_catalog.oidvectortypes(routine.proargtypes)`,
    [manifest.schemaName, role]
  );
  const expectedRoutines = new Map<string, {
    argumentTypes: string;
    resultType: string;
    source: string;
  }>([
    [manifest.leaseRecoveryRole.functionName, {
      argumentTypes: FUNCTION_ARGUMENT_TYPES.join(", "),
      resultType: FUNCTION_RESULT_TYPE,
      source: hostedDeliveryLeaseRecoveryFunctionSource(manifest)
    }],
    [manifest.leaseRecoveryRole.signalInboxFunctionName, {
      argumentTypes: SIGNAL_FUNCTION_ARGUMENT_TYPES.join(", "),
      resultType: SIGNAL_FUNCTION_RESULT_TYPE,
      source: hostedSignalInboxFunctionSource(manifest)
    }],
    [manifest.leaseRecoveryRole.signalResolutionPlanFunctionName, {
      argumentTypes: SIGNAL_RESOLUTION_PLAN_FUNCTION_ARGUMENT_TYPES.join(", "),
      resultType: SIGNAL_RESOLUTION_PLAN_FUNCTION_RESULT_TYPE,
      source: hostedSignalResolutionPlanFunctionSource(manifest)
    }]
  ]);
  if (routines.rows.length !== expectedRoutines.size || routines.rows.some((routine) => {
    const expected = expectedRoutines.get(routine.routineName);
    return !expected || routine.argumentTypes !== expected.argumentTypes
      || routine.resultType !== expected.resultType || routine.volatility !== "v"
      || !routine.securityDefiner || !routine.strict || routine.leakproof
      || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
      || routine.ownerName === role || routine.source !== expected.source;
  })) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery function boundaries are incomplete."
    );
  }
  const routineAcl = await session.query<{
    routineOid: string;
    grantee: string;
    privilegeType: string;
    grantable: boolean;
  }>(
    `SELECT routine.oid::text AS "routineOid",
            COALESCE(grantee_role.rolname, 'PUBLIC') AS grantee,
            access.privilege_type AS "privilegeType", access.is_grantable AS grantable
     FROM pg_catalog.pg_proc routine
     CROSS JOIN LATERAL pg_catalog.aclexplode(
       COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
     ) AS access
     LEFT JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid = access.grantee
     WHERE routine.oid = ANY($1::oid[]) ORDER BY routine.oid, grantee`,
    [routines.rows.map((routine) => routine.oid)]
  );
  if (routineAcl.rows.length !== routines.rows.length * 2
    || routines.rows.some((routine) => {
      const rows = routineAcl.rows.filter((row) => row.routineOid === routine.oid);
      return rows.length !== 2
        || !rows.some((row) => row.grantee === role
          && row.privilegeType === "EXECUTE" && !row.grantable)
        || !rows.some((row) => row.grantee === routine.ownerName
          && row.privilegeType === "EXECUTE" && !row.grantable)
        || rows.some((row) => row.grantee === "PUBLIC");
    })) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery function grants are not exact."
    );
  }
  const accessibleSequences = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_class sequence
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = sequence.relnamespace
     WHERE namespace.nspname = $1 AND sequence.relkind = 'S'
       AND (has_sequence_privilege($2, sequence.oid, 'USAGE')
         OR has_sequence_privilege($2, sequence.oid, 'SELECT')
         OR has_sequence_privilege($2, sequence.oid, 'UPDATE'))`,
    [manifest.schemaName, role]
  );
  if (exactInteger(accessibleSequences.rows[0]?.count, "accessible sequence count") !== 0) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role can access an application sequence."
    );
  }
  const rls = await session.query<{ tableName: string; enabled: boolean; forced: boolean }>(
    `SELECT relation.relname AS "tableName", relation.relrowsecurity AS enabled,
            relation.relforcerowsecurity AS forced
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1 AND relation.relname = ANY($2::text[])
     ORDER BY relation.relname`,
    [manifest.schemaName, [...PROTECTED_TABLES]]
  );
  if (rls.rows.length !== PROTECTED_TABLES.length
    || rls.rows.some((row) => !row.enabled || !row.forced)
    || rls.rows.map((row) => row.tableName).join(",") !== [...PROTECTED_TABLES].join(",")) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery protected tables are not forced-RLS exact."
    );
  }
  const owned = await session.query<{ count: string | number | bigint }>(
    `SELECT (
       SELECT COUNT(*) FROM pg_catalog.pg_class object
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace
       JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = object.relowner
       WHERE namespace.nspname = $1 AND owner_role.rolname = $2
     ) + (
       SELECT COUNT(*) FROM pg_catalog.pg_proc routine
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
       JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = routine.proowner
       WHERE namespace.nspname = $1 AND owner_role.rolname = $2
     ) + (
       SELECT COUNT(*) FROM pg_catalog.pg_namespace namespace
       JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = namespace.nspowner
       WHERE namespace.nspname = $1 AND owner_role.rolname = $2
     ) AS count`,
    [manifest.schemaName, role]
  );
  if (exactInteger(owned.rows[0]?.count, "owned object count") !== 0) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role must not own schema objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery role must not depend on a direct policy."
    );
  }
  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  if (exactInteger(principals.rows[0]?.count, "active principal count") !== 0) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "Hosted-delivery lease-recovery qualification cannot activate a runtime principal."
    );
  }
  return {
    protectedTableCount: rls.rows.length,
    forcedRlsTableCount: rls.rows.length,
    directTableGrantCount: 0,
    functionGrantCount: 3,
    membershipCount: 0,
    activePrincipalCount: 0,
    boundaryCatalogFingerprint: fingerprint({
      role: roleRow,
      routines: routines.rows,
      routineAcl: routineAcl.rows,
      rls: rls.rows
    })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresHostedDeliveryLeaseRecoveryManifest
): PostgresHostedDeliveryLeaseRecoveryQualificationReceipt {
  const receipt: PostgresHostedDeliveryLeaseRecoveryQualificationReceipt = {
    contractVersion: exactInteger(row.contract_version, "receipt contract version") as 3,
    cutoverContractVersion: exactInteger(row.cutover_contract_version, "cutover contract version") as 3,
    witnessRefreshContractVersion: exactInteger(
      row.witness_refresh_contract_version,
      "witness-refresh contract version"
    ) as 1,
    phase: row.phase as "verified",
    schemaName: manifest.schemaName,
    roleManifestFingerprint: row.role_manifest_fingerprint,
    witnessRefreshManifestFingerprint: row.witness_refresh_manifest_fingerprint,
    leaseRecoveryRoleName: row.lease_recovery_role_name,
    protectedTableCount: exactInteger(row.protected_table_count, "protected-table count") as 3,
    forcedRlsTableCount: exactInteger(row.forced_rls_table_count, "forced-RLS count") as 3,
    directTableGrantCount: exactInteger(row.direct_table_grant_count, "direct-grant count") as 0,
    functionGrantCount: exactInteger(row.function_grant_count, "function-grant count") as 3,
    membershipCount: exactInteger(row.membership_count, "membership count") as 0,
    activePrincipalCount: exactInteger(row.active_principal_count, "active-principal count") as 0,
    qualifiedHandlerTaskKindCount: exactInteger(
      row.qualified_handler_task_kind_count,
      "qualified-handler count"
    ) as 6,
    totalHandlerTaskKindCount: exactInteger(row.total_handler_task_kind_count, "total-handler count"),
    maximumDeliveryAttempts: exactInteger(row.maximum_delivery_attempts, "attempt limit") as 20,
    maximumResolutionPlanAgeSeconds: exactInteger(
      row.maximum_resolution_plan_age_seconds,
      "resolution-plan age limit"
    ) as 30,
    serverBoundPrincipalLookup: exactBoolean(
      row.server_bound_principal_lookup,
      true,
      "server-bound-principal flag"
    ),
    databaseServerClock: exactBoolean(row.database_server_clock, true, "server-clock flag"),
    deterministicReceiptHashParity: exactBoolean(
      row.deterministic_receipt_hash_parity,
      true,
      "receipt-hash parity flag"
    ),
    leaseRecoverySubBoundaryParity: exactBoolean(
      row.lease_recovery_sub_boundary_parity,
      true,
      "lease-recovery parity flag"
    ),
    signalInboxLifecycleRepositoryParity: exactBoolean(
      row.signal_inbox_lifecycle_repository_parity,
      true,
      "signal-inbox lifecycle parity flag"
    ),
    signalResolutionPlanRepositoryParity: exactBoolean(
      row.signal_resolution_plan_repository_parity,
      true,
      "signal-resolution plan parity flag"
    ),
    signalEvaluationApplyRepositoryParity: exactBoolean(
      row.signal_evaluation_apply_repository_parity,
      false,
      "signal-evaluation apply parity flag"
    ),
    sharedCatalogMutationFailClosed: exactBoolean(
      row.shared_catalog_mutation_fail_closed,
      true,
      "shared-catalog mutation flag"
    ),
    rawSignalPayloadReturned: exactBoolean(
      row.raw_signal_payload_returned,
      false,
      "raw-signal payload flag"
    ),
    signalEvaluationRepositoryParity: exactBoolean(
      row.signal_evaluation_repository_parity,
      false,
      "signal-evaluation parity flag"
    ),
    signalIngressRepositoryParity: exactBoolean(
      row.signal_ingress_repository_parity,
      false,
      "signal-ingress parity flag"
    ),
    hostedDeliveryHandlerRepositoryParity: exactBoolean(
      row.hosted_delivery_handler_repository_parity,
      false,
      "handler parity flag"
    ),
    allHandlerRepositoryParity: exactBoolean(
      row.all_handler_repository_parity,
      false,
      "all-handler parity flag"
    ),
    mutationAuthority: exactBoolean(row.mutation_authority, false, "mutation-authority flag"),
    directTableAccess: exactBoolean(row.direct_table_access, false, "direct-table flag"),
    runtimeAuthority: exactBoolean(row.runtime_authority, false, "runtime-authority flag"),
    productionReady: exactBoolean(row.production_ready, false, "production-ready flag"),
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    appliedAt: timestamp(row.applied_at, "applied timestamp"),
    verifiedAt: timestamp(row.verified_at, "verified timestamp")
  };
  if (receipt.contractVersion !== POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION
    || receipt.cutoverContractVersion !== 3
    || receipt.witnessRefreshContractVersion !== 1 || receipt.phase !== "verified"
    || receipt.roleManifestFingerprint !== manifest.fingerprint
    || receipt.witnessRefreshManifestFingerprint !== manifest.witnessRefreshManifestFingerprint
    || receipt.leaseRecoveryRoleName !== manifest.leaseRecoveryRole.name
    || receipt.protectedTableCount !== 3 || receipt.forcedRlsTableCount !== 3
    || receipt.directTableGrantCount !== 0 || receipt.functionGrantCount !== 3
    || receipt.membershipCount !== 0 || receipt.activePrincipalCount !== 0
    || receipt.qualifiedHandlerTaskKindCount !== 6
    || receipt.totalHandlerTaskKindCount !== BACKGROUND_TASK_KINDS.length
    || receipt.maximumDeliveryAttempts !== 20
    || receipt.maximumResolutionPlanAgeSeconds !== SIGNAL_RESOLUTION_PLAN_SECONDS
    || !receipt.serverBoundPrincipalLookup || !receipt.databaseServerClock
    || !receipt.deterministicReceiptHashParity || !receipt.leaseRecoverySubBoundaryParity
    || !receipt.signalInboxLifecycleRepositoryParity
    || !receipt.signalResolutionPlanRepositoryParity
    || receipt.signalEvaluationApplyRepositoryParity
    || !receipt.sharedCatalogMutationFailClosed || receipt.rawSignalPayloadReturned
    || receipt.signalEvaluationRepositoryParity
    || receipt.signalIngressRepositoryParity || receipt.hostedDeliveryHandlerRepositoryParity
    || receipt.allHandlerRepositoryParity || receipt.mutationAuthority
    || receipt.directTableAccess || receipt.runtimeAuthority || receipt.productionReady
    || !SHA256.test(receipt.boundaryCatalogFingerprint)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery receipt is incomplete or unsafe."
    );
  }
  return receipt;
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresHostedDeliveryLeaseRecoveryManifest
): Promise<PostgresHostedDeliveryLeaseRecoveryQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE)}
     WHERE singleton = TRUE`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresHostedDeliveryLeaseRecoveryQualificationReceipt
): void {
  if (inspection.protectedTableCount !== receipt.protectedTableCount
    || inspection.forcedRlsTableCount !== receipt.forcedRlsTableCount
    || inspection.directTableGrantCount !== receipt.directTableGrantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "The PostgreSQL hosted-delivery lease-recovery boundary no longer matches its receipt."
    );
  }
}

function prerequisiteArguments(
  manifest: PostgresHostedDeliveryLeaseRecoveryManifest
): Parameters<typeof verifyPostgresObserverWitnessRefreshBoundary> extends
  [PostgresCutoverDatabase, ...infer Rest] ? Rest : never {
  return [
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace,
    manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace,
    manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace,
    manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace
  ];
}

export async function verifyPostgresHostedDeliveryLeaseRecoveryBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification",
  requestedObserverCandidateRoleNamespace = "yoink_candidate_qualification",
  requestedAlertDispatchRoleNamespace = "yoink_dispatch_qualification",
  requestedAlertReconciliationRoleNamespace = "yoink_reconcile_qualification",
  requestedWitnessRefreshRoleNamespace = "yoink_witness_qualification",
  requestedLeaseRecoveryRoleNamespace = "yoink_delivery_qualification"
): Promise<PostgresHostedDeliveryLeaseRecoveryQualificationReceipt> {
  const manifest = buildPostgresHostedDeliveryLeaseRecoveryManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace,
    requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace,
    requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace,
    requestedLeaseRecoveryRoleNamespace
  );
  await verifyPostgresObserverWitnessRefreshBoundary(database, ...prerequisiteArguments(manifest));
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt);
    return receipt;
  });
}

export async function applyPostgresHostedDeliveryLeaseRecoveryBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification",
  requestedObserverCandidateRoleNamespace = "yoink_candidate_qualification",
  requestedAlertDispatchRoleNamespace = "yoink_dispatch_qualification",
  requestedAlertReconciliationRoleNamespace = "yoink_reconcile_qualification",
  requestedWitnessRefreshRoleNamespace = "yoink_witness_qualification",
  requestedLeaseRecoveryRoleNamespace = "yoink_delivery_qualification",
  now = Date.now()
): Promise<PostgresHostedDeliveryLeaseRecoveryQualificationReceipt> {
  const manifest = buildPostgresHostedDeliveryLeaseRecoveryManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace,
    requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace,
    requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace,
    requestedLeaseRecoveryRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "Hosted-delivery lease-recovery qualification requires the supported BYPASSRLS control role."
    );
  }
  const authority = await database.query<{ rolcreaterole: boolean; rolsuper: boolean }>(
    "SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user"
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "Hosted-delivery lease-recovery qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresObserverWitnessRefreshBoundary(database, ...prerequisiteArguments(manifest));
  const existing = await database.query<{
    roleExists: boolean;
    receiptExists: boolean;
    functionExists: boolean;
    signalFunctionExists: boolean;
    signalResolutionFunctionExists: boolean;
    guardExists: boolean;
  }>(
    `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1) AS "roleExists",
            pg_catalog.to_regclass($2) IS NOT NULL AS "receiptExists",
            pg_catalog.to_regprocedure($3) IS NOT NULL AS "functionExists",
            pg_catalog.to_regprocedure($4) IS NOT NULL AS "signalFunctionExists",
            pg_catalog.to_regprocedure($5) IS NOT NULL AS "signalResolutionFunctionExists",
            pg_catalog.to_regprocedure($6) IS NOT NULL AS "guardExists"`,
    [
      manifest.leaseRecoveryRole.name,
      `${manifest.schemaName}.${POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE}`,
      `${manifest.schemaName}.${POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_FUNCTION}(text,text)`,
      `${manifest.schemaName}.${POSTGRES_HOSTED_SIGNAL_INBOX_FUNCTION}(text,text,text,text,text)`,
      `${manifest.schemaName}.${POSTGRES_HOSTED_SIGNAL_RESOLUTION_PLAN_FUNCTION}(text,text,text,text)`,
      `${manifest.schemaName}.yoink_guard_hosted_delivery_lease_recovery_receipt()`
    ]
  );
  if (existing.rows[0]?.roleExists || existing.rows[0]?.receiptExists
    || existing.rows[0]?.functionExists || existing.rows[0]?.signalFunctionExists
    || existing.rows[0]?.signalResolutionFunctionExists
    || existing.rows[0]?.guardExists) {
    throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
      "Hosted-delivery lease-recovery qualification refuses to reuse a role, function, guard, or receipt."
    );
  }
  const appliedAt = nowIso(now);
  await database.transaction(async (session) => {
    await session.query(
      `CREATE ROLE ${identifier(manifest.leaseRecoveryRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.leaseRecoveryRole.name)}`
    );
    for (const table of PROTECTED_TABLES) {
      await session.query(
        `ALTER TABLE ${relation(manifest.schemaName, table)} ENABLE ROW LEVEL SECURITY`
      );
      await session.query(
        `ALTER TABLE ${relation(manifest.schemaName, table)} FORCE ROW LEVEL SECURITY`
      );
    }
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, manifest.leaseRecoveryRole.functionName)}(
         expected_tenant_id text, expected_user_id text
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${hostedDeliveryLeaseRecoveryFunctionSource(manifest)}$yoink$`
    );
    const functionSignature = `${relation(
      manifest.schemaName,
      manifest.leaseRecoveryRole.functionName
    )}(text, text)`;
    await session.query(`REVOKE ALL ON FUNCTION ${functionSignature} FROM PUBLIC`);
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${functionSignature}
       TO ${identifier(manifest.leaseRecoveryRole.name)}`
    );
    await session.query(
      `CREATE FUNCTION ${relation(
        manifest.schemaName,
        manifest.leaseRecoveryRole.signalInboxFunctionName
      )}(
         expected_tenant_id text, expected_user_id text, operation_name text,
         target_message_id text, capability_token text
       ) RETURNS ${SIGNAL_FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${hostedSignalInboxFunctionSource(manifest)}$yoink$`
    );
    const signalFunctionSignature = `${relation(
      manifest.schemaName,
      manifest.leaseRecoveryRole.signalInboxFunctionName
    )}(text, text, text, text, text)`;
    await session.query(`REVOKE ALL ON FUNCTION ${signalFunctionSignature} FROM PUBLIC`);
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${signalFunctionSignature}
       TO ${identifier(manifest.leaseRecoveryRole.name)}`
    );
    await session.query(
      `CREATE FUNCTION ${relation(
        manifest.schemaName,
        manifest.leaseRecoveryRole.signalResolutionPlanFunctionName
      )}(
         expected_tenant_id text, expected_user_id text,
         target_message_id text, capability_token text
       ) RETURNS ${SIGNAL_RESOLUTION_PLAN_FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${hostedSignalResolutionPlanFunctionSource(manifest)}$yoink$`
    );
    const signalResolutionFunctionSignature = `${relation(
      manifest.schemaName,
      manifest.leaseRecoveryRole.signalResolutionPlanFunctionName
    )}(text, text, text, text)`;
    await session.query(`REVOKE ALL ON FUNCTION ${signalResolutionFunctionSignature} FROM PUBLIC`);
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${signalResolutionFunctionSignature}
       TO ${identifier(manifest.leaseRecoveryRole.name)}`
    );
    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE)}(
         singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
         contract_version BIGINT NOT NULL CHECK (
           contract_version = ${POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION}
         ),
         cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = 3),
         witness_refresh_contract_version BIGINT NOT NULL CHECK (witness_refresh_contract_version = 1),
         phase TEXT NOT NULL CHECK (phase = 'verified'),
         role_manifest_fingerprint TEXT NOT NULL,
         witness_refresh_manifest_fingerprint TEXT NOT NULL,
         lease_recovery_role_name TEXT NOT NULL,
         protected_table_count BIGINT NOT NULL CHECK (protected_table_count = 3),
         forced_rls_table_count BIGINT NOT NULL CHECK (forced_rls_table_count = 3),
         direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
         function_grant_count BIGINT NOT NULL CHECK (function_grant_count = 3),
         membership_count BIGINT NOT NULL CHECK (membership_count = 0),
         active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
         qualified_handler_task_kind_count BIGINT NOT NULL CHECK (qualified_handler_task_kind_count = 6),
         total_handler_task_kind_count BIGINT NOT NULL CHECK (total_handler_task_kind_count = 7),
         maximum_delivery_attempts BIGINT NOT NULL CHECK (maximum_delivery_attempts = 20),
         maximum_resolution_plan_age_seconds BIGINT NOT NULL CHECK (
           maximum_resolution_plan_age_seconds = ${SIGNAL_RESOLUTION_PLAN_SECONDS}
         ),
         server_bound_principal_lookup BOOLEAN NOT NULL CHECK (server_bound_principal_lookup = TRUE),
         database_server_clock BOOLEAN NOT NULL CHECK (database_server_clock = TRUE),
         deterministic_receipt_hash_parity BOOLEAN NOT NULL CHECK (deterministic_receipt_hash_parity = TRUE),
         lease_recovery_sub_boundary_parity BOOLEAN NOT NULL CHECK (lease_recovery_sub_boundary_parity = TRUE),
         signal_inbox_lifecycle_repository_parity BOOLEAN NOT NULL CHECK (
           signal_inbox_lifecycle_repository_parity = TRUE
         ),
         signal_resolution_plan_repository_parity BOOLEAN NOT NULL CHECK (
           signal_resolution_plan_repository_parity = TRUE
         ),
         signal_evaluation_apply_repository_parity BOOLEAN NOT NULL CHECK (
           signal_evaluation_apply_repository_parity = FALSE
         ),
         shared_catalog_mutation_fail_closed BOOLEAN NOT NULL CHECK (
           shared_catalog_mutation_fail_closed = TRUE
         ),
         raw_signal_payload_returned BOOLEAN NOT NULL CHECK (raw_signal_payload_returned = FALSE),
         signal_evaluation_repository_parity BOOLEAN NOT NULL CHECK (
           signal_evaluation_repository_parity = FALSE
         ),
         signal_ingress_repository_parity BOOLEAN NOT NULL CHECK (signal_ingress_repository_parity = FALSE),
         hosted_delivery_handler_repository_parity BOOLEAN NOT NULL CHECK (hosted_delivery_handler_repository_parity = FALSE),
         all_handler_repository_parity BOOLEAN NOT NULL CHECK (all_handler_repository_parity = FALSE),
         mutation_authority BOOLEAN NOT NULL CHECK (mutation_authority = FALSE),
         direct_table_access BOOLEAN NOT NULL CHECK (direct_table_access = FALSE),
         runtime_authority BOOLEAN NOT NULL CHECK (runtime_authority = FALSE),
         production_ready BOOLEAN NOT NULL CHECK (production_ready = FALSE),
         boundary_catalog_fingerprint TEXT NOT NULL,
         applied_at TEXT NOT NULL,
         verified_at TEXT NOT NULL
       )`
    );
    await session.query(
      `REVOKE ALL ON TABLE ${relation(
        manifest.schemaName,
        POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE
      )} FROM PUBLIC`
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_guard_hosted_delivery_lease_recovery_receipt")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $guard$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'hosted-delivery lease-recovery receipt is immutable';
       END
       $guard$`
    );
    await session.query(
      `REVOKE ALL ON FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_hosted_delivery_lease_recovery_receipt")}()
       FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_hosted_delivery_lease_recovery_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(
        manifest.schemaName,
        POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE
      )}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_hosted_delivery_lease_recovery_receipt")}()`
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `INSERT INTO ${relation(
        manifest.schemaName,
        POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_RECEIPT_TABLE
      )}(
         singleton, contract_version, cutover_contract_version,
         witness_refresh_contract_version, phase, role_manifest_fingerprint,
         witness_refresh_manifest_fingerprint, lease_recovery_role_name,
         protected_table_count, forced_rls_table_count, direct_table_grant_count,
         function_grant_count, membership_count, active_principal_count,
         qualified_handler_task_kind_count, total_handler_task_kind_count,
         maximum_delivery_attempts, maximum_resolution_plan_age_seconds,
         server_bound_principal_lookup,
         database_server_clock, deterministic_receipt_hash_parity,
         lease_recovery_sub_boundary_parity,
         signal_inbox_lifecycle_repository_parity,
         signal_resolution_plan_repository_parity,
         signal_evaluation_apply_repository_parity,
         shared_catalog_mutation_fail_closed, raw_signal_payload_returned,
         signal_evaluation_repository_parity, signal_ingress_repository_parity,
         hosted_delivery_handler_repository_parity, all_handler_repository_parity,
         mutation_authority, direct_table_access, runtime_authority,
         production_ready, boundary_catalog_fingerprint, applied_at, verified_at
       ) VALUES (
         TRUE, ${POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION}, 3, 1,
         'verified', $1, $2, $3,
         3, 3, 0, 3, 0, 0, 6, 7, 20, ${SIGNAL_RESOLUTION_PLAN_SECONDS},
         TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, FALSE,
         FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, $4, $5, $6
       )`,
      [
        manifest.fingerprint,
        manifest.witnessRefreshManifestFingerprint,
        manifest.leaseRecoveryRole.name,
        inspection.boundaryCatalogFingerprint,
        appliedAt,
        verifiedAt
      ]
    );
  });
  return verifyPostgresHostedDeliveryLeaseRecoveryBoundary(
    database,
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace,
    requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace,
    requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace,
    requestedLeaseRecoveryRoleNamespace
  );
}

class HostedDeliveryLeaseRecoverySession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

export class NodePostgresHostedDeliveryLeaseRecoveryDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresHostedDeliveryLeaseRecoveryManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
    requestedReadRoleNamespace = "yoink_qualification",
    requestedSessionRoleNamespace = "yoink_session_qualification",
    requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
    requestedControlRoleNamespace = "yoink_control_qualification",
    requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
    requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
    requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification",
    requestedObserverCandidateRoleNamespace = "yoink_candidate_qualification",
    requestedAlertDispatchRoleNamespace = "yoink_dispatch_qualification",
    requestedAlertReconciliationRoleNamespace = "yoink_reconcile_qualification",
    requestedWitnessRefreshRoleNamespace = "yoink_witness_qualification",
    requestedLeaseRecoveryRoleNamespace = "yoink_delivery_qualification",
    options: NodePostgresHostedDeliveryLeaseRecoveryDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresHostedDeliveryLeaseRecoveryManifest(
      requestedSchema,
      requestedReadRoleNamespace,
      requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace,
      requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace,
      requestedExecutionRecoveryRoleNamespace,
      requestedOperationalRetentionRoleNamespace,
      requestedObserverCandidateRoleNamespace,
      requestedAlertDispatchRoleNamespace,
      requestedAlertReconciliationRoleNamespace,
      requestedWitnessRefreshRoleNamespace,
      requestedLeaseRecoveryRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (maxConnections !== 1 && maxConnections !== 2) {
      throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
        "The PostgreSQL hosted-delivery lease-recovery connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_hosted_delivery_lease_recovery_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_hosted_delivery_lease_recovery_qualification");
  }

  async recover(
    principal: BackgroundWorkerPrincipal,
    now = Date.now()
  ): Promise<PostgresHostedDeliveryLeaseRecoveryResult> {
    const expectedTenantId = principalId(principal.tenantId, "expected tenant ID");
    const expectedUserId = principalId(principal.userId, "expected user ID");
    if (!Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
        "The PostgreSQL hosted-delivery lease-recovery cycle timestamp differs from the process clock."
      );
    }
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.leaseRecoveryRole.name)}`);
      const session = new HostedDeliveryLeaseRecoverySession(client);
      const result = await session.query<RecoveryRow>(
        `SELECT inbox_requeued AS "inboxRequeued",
                inbox_dead_lettered AS "inboxDeadLettered",
                outbox_requeued AS "outboxRequeued",
                outbox_dead_lettered AS "outboxDeadLettered"
         FROM ${relation(
          this.manifest.schemaName,
          this.manifest.leaseRecoveryRole.functionName
        )}($1, $2)`,
        [expectedTenantId, expectedUserId]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
          "The PostgreSQL hosted-delivery lease-recovery function returned an ambiguous result."
        );
      }
      const row = result.rows[0];
      const recovered = {
        inboxRequeued: exactInteger(row.inboxRequeued, "inbox requeue count"),
        inboxDeadLettered: exactInteger(row.inboxDeadLettered, "inbox dead-letter count"),
        outboxRequeued: exactInteger(row.outboxRequeued, "outbox requeue count"),
        outboxDeadLettered: exactInteger(row.outboxDeadLettered, "outbox dead-letter count")
      };
      await client.query("COMMIT");
      return recovered;
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

  private async transitionSignalInbox(
    principal: BackgroundWorkerPrincipal,
    operation: "lease" | "complete" | "fail" | "dead_letter",
    messageId: string,
    capabilityToken: string,
    now: number
  ): Promise<SignalInboxTransitionRow[]> {
    const expectedTenantId = principalId(principal.tenantId, "expected tenant ID");
    const expectedUserId = principalId(principal.userId, "expected user ID");
    if (!Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
        "The PostgreSQL hosted signal inbox timestamp differs from the process clock."
      );
    }
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.leaseRecoveryRole.name)}`);
      const result = await client.query<SignalInboxTransitionRow>(
        `SELECT message_id AS "messageId", source, message_key AS "messageKey",
                event_type AS "eventType", payload_json AS "payloadJson",
                attempt, lease_expires_at AS "leaseExpiresAt", disposition, changed
         FROM ${relation(
          this.manifest.schemaName,
          this.manifest.leaseRecoveryRole.signalInboxFunctionName
        )}($1, $2, $3, $4, $5)`,
        [expectedTenantId, expectedUserId, operation, messageId, capabilityToken]
      );
      await client.query("COMMIT");
      return result.rows;
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

  async leaseSignalInbox(
    principal: BackgroundWorkerPrincipal,
    now = Date.now()
  ): Promise<PostgresHostedSignalInboxLease | null> {
    const capabilityToken = randomBytes(32).toString("base64url");
    const rows = await this.transitionSignalInbox(
      principal,
      "lease",
      "",
      capabilityToken,
      now
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    if (rows.length !== 1 || !row || row.changed !== true || row.disposition !== "leased"
      || row.eventType !== SIGNAL_INGRESS_EVENT_TYPE) {
      throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
        "The PostgreSQL hosted signal inbox lease result is ambiguous."
      );
    }
    const attempt = exactInteger(row.attempt, "signal inbox attempt");
    if (attempt < 1 || attempt > MAXIMUM_DELIVERY_ATTEMPTS) {
      throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
        "The PostgreSQL hosted signal inbox attempt is out of range."
      );
    }
    return {
      id: signalMessageId(row.messageId),
      source: principalId(row.source, "signal inbox source"),
      messageKey: principalId(row.messageKey, "signal inbox message key"),
      eventType: SIGNAL_INGRESS_EVENT_TYPE,
      payload: parsedSignalPayload(row.payloadJson),
      attempt,
      leaseExpiresAt: timestamp(row.leaseExpiresAt, "signal inbox lease expiry"),
      capabilityToken: signalCapabilityToken(capabilityToken)
    };
  }

  async planSignalResolution(
    principal: BackgroundWorkerPrincipal,
    messageId: string,
    capabilityToken: string,
    now = Date.now()
  ): Promise<PostgresHostedSignalResolutionPlan> {
    const expectedTenantId = principalId(principal.tenantId, "expected tenant ID");
    const expectedUserId = principalId(principal.userId, "expected user ID");
    const expectedMessageId = signalMessageId(messageId);
    const expectedCapabilityToken = signalCapabilityToken(capabilityToken);
    if (!Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
        "The PostgreSQL hosted signal resolution timestamp differs from the process clock."
      );
    }
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      // The exact leased inbox row is held with FOR SHARE inside the function. The
      // transaction is therefore read-write even though the function has no write statement.
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.leaseRecoveryRole.name)}`);
      const result = await client.query<SignalResolutionPlanRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
          this.manifest.schemaName,
          this.manifest.leaseRecoveryRole.signalResolutionPlanFunctionName
        )}($1, $2, $3, $4)`,
        [expectedTenantId, expectedUserId, expectedMessageId, expectedCapabilityToken]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
          "The PostgreSQL hosted signal resolution function returned an ambiguous result."
        );
      }
      let rawPlan: unknown;
      try {
        rawPlan = JSON.parse(String(result.rows[0].resultJson ?? ""));
      } catch {
        throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
          "The PostgreSQL hosted signal resolution function returned invalid JSON."
        );
      }
      const plan = parseHostedSignalResolutionPlan(
        rawPlan,
        { ...principal, tenantId: expectedTenantId, userId: expectedUserId },
        expectedMessageId,
        now
      );
      await client.query("COMMIT");
      return plan;
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

  async completeSignalInbox(
    principal: BackgroundWorkerPrincipal,
    messageId: string,
    capabilityToken: string,
    now = Date.now()
  ): Promise<true> {
    const rows = await this.transitionSignalInbox(
      principal,
      "complete",
      signalMessageId(messageId),
      signalCapabilityToken(capabilityToken),
      now
    );
    if (rows.length !== 1 || rows[0]?.changed !== true
      || rows[0].disposition !== "processed" || rows[0].messageId !== messageId) {
      throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
        "The PostgreSQL hosted signal inbox completion result is ambiguous."
      );
    }
    return true;
  }

  async failSignalInbox(
    principal: BackgroundWorkerPrincipal,
    messageId: string,
    capabilityToken: string,
    now = Date.now()
  ): Promise<"retry" | "dead_letter"> {
    const rows = await this.transitionSignalInbox(
      principal,
      "fail",
      signalMessageId(messageId),
      signalCapabilityToken(capabilityToken),
      now
    );
    const disposition = rows[0]?.disposition;
    if (rows.length !== 1 || rows[0]?.changed !== true
      || rows[0].messageId !== messageId
      || (disposition !== "retry" && disposition !== "dead_letter")) {
      throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
        "The PostgreSQL hosted signal inbox failure result is ambiguous."
      );
    }
    return disposition;
  }

  /**
   * Dead-letters a leased signal message at once, for a failure that can never
   * succeed on retry (see signalFailureIsPermanent). Mirrors SQLite
   * HostedDeliveryRepository.deadLetterInbox with reason
   * `signal_rejected_invalid`.
   */
  async deadLetterSignalInbox(
    principal: BackgroundWorkerPrincipal,
    messageId: string,
    capabilityToken: string,
    now = Date.now()
  ): Promise<"dead_letter"> {
    const rows = await this.transitionSignalInbox(
      principal,
      "dead_letter",
      signalMessageId(messageId),
      signalCapabilityToken(capabilityToken),
      now
    );
    if (rows.length !== 1 || rows[0]?.changed !== true
      || rows[0].messageId !== messageId || rows[0].disposition !== "dead_letter") {
      throw new PostgresHostedDeliveryLeaseRecoveryQualificationError(
        "The PostgreSQL hosted signal inbox dead-letter result is ambiguous."
      );
    }
    return "dead_letter";
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
