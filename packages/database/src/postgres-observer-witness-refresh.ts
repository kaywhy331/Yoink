import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import type {
  ObserverRecipeWitnessCheckpoint,
  SignedObserverRecipeWitnessReceipt
} from "../../contracts/src/index.js";
import { BACKGROUND_TASK_KINDS } from "../../domain/src/background-task.js";
import { newId } from "../../domain/src/ids.js";
import type { ObserverRecipeWitnessStatePort } from "../../engine/src/observer-recipe-witness-refresh.js";
import {
  ObserverRecipeWitnessError,
  ObserverRecipeWitnessVerifier,
  observerRecipeWitnessCheckpointHash,
  observerRecipeWitnessReceiptHash,
  observerRecipeWitnessScopedLogId,
  type ObserverRecipeWitnessFailureCode
} from "../../observer-registry/src/witness.js";
import { canonicalJson } from "../../observer-registry/src/trust.js";
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
  POSTGRES_OPERATOR_ALERT_RECONCILIATION_CONTRACT_VERSION,
  buildPostgresOperatorAlertReconciliationManifest,
  verifyPostgresOperatorAlertReconciliationBoundary
} from "./postgres-operator-alert-reconciliation.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_OBSERVER_WITNESS_REFRESH_CONTRACT_VERSION = 1;
export const POSTGRES_OBSERVER_WITNESS_REFRESH_RECEIPT_TABLE =
  "yoink_observer_witness_refresh_receipt";
export const POSTGRES_OBSERVER_WITNESS_REFRESH_FUNCTION =
  "yoink_refresh_observer_witness";
export const POSTGRES_OBSERVER_WITNESS_REFRESH_MAXIMUM_ENVELOPE_BYTES = 65_536;

const MAXIMUM_CLOCK_SKEW_MS = 300_000;
const APPLY_TIMESTAMP_SKEW_SECONDS = 30;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const LOG_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const HTTPS_ORIGIN_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(?::[1-9][0-9]{0,4})?$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{80,120}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze(Array.from({ length: 8 }, () => "text"));
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TABLES = Object.freeze([
  "audit_events",
  "observer_recipe_transparency_events",
  "observer_recipe_trust_manifests",
  "observer_recipe_witness_checks",
  "observer_recipe_witness_receipts",
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
const FAILURE_CODES = new Set<ObserverRecipeWitnessFailureCode>([
  "unavailable",
  "invalid_contract",
  "invalid_signature",
  "checkpoint_conflict",
  "chain_conflict",
  "stale_receipt"
]);

export interface PostgresObserverWitnessRefreshManifest {
  contractVersion: typeof POSTGRES_OBSERVER_WITNESS_REFRESH_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  alertReconciliationContractVersion:
    typeof POSTGRES_OPERATOR_ALERT_RECONCILIATION_CONTRACT_VERSION;
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
  alertReconciliationManifestFingerprint: string;
  witnessRefreshRole: {
    kind: "observer_recipe_witness_refresh_boundary";
    name: string;
    functionName: typeof POSTGRES_OBSERVER_WITNESS_REFRESH_FUNCTION;
    functionArgumentTypes: string[];
    protectedTableNames: string[];
    forcedRlsTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTableCount: 6;
  forcedRlsTableCount: 6;
  directTableGrantCount: 0;
  functionGrantCount: 1;
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
  maximumEnvelopeBytes: 65_536;
  twoPhaseExternalIo: true;
  externalIoOutsideTransaction: true;
  applicationEd25519Verification: true;
  serverDerivedCheckpoint: true;
  databasePlanRevalidation: true;
  databaseServerClock: true;
  serverAuthenticatedReceiptActor: true;
  publicCryptographicMetadataOnly: true;
  witnessRefreshRepositoryParity: true;
  allHandlerRepositoryParity: false;
  mutationAuthority: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresObserverWitnessRefreshQualificationReceipt {
  contractVersion: 1;
  cutoverContractVersion: 3;
  alertReconciliationContractVersion: 1;
  phase: "verified";
  schemaName: string;
  roleManifestFingerprint: string;
  alertReconciliationManifestFingerprint: string;
  witnessRefreshRoleName: string;
  protectedTableCount: 6;
  forcedRlsTableCount: 6;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  qualifiedHandlerTaskKindCount: 6;
  totalHandlerTaskKindCount: number;
  maximumEnvelopeBytes: 65_536;
  twoPhaseExternalIo: true;
  externalIoOutsideTransaction: true;
  applicationEd25519Verification: true;
  serverDerivedCheckpoint: true;
  databasePlanRevalidation: true;
  databaseServerClock: true;
  serverAuthenticatedReceiptActor: true;
  publicCryptographicMetadataOnly: true;
  witnessRefreshRepositoryParity: true;
  allHandlerRepositoryParity: false;
  mutationAuthority: false;
  directTableAccess: false;
  runtimeAuthority: false;
  productionReady: false;
  boundaryCatalogFingerprint: string;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresObserverWitnessRefreshCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  alertReconciliationContractVersion: 1;
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
  twoPhaseExternalIo: true;
  externalIoOutsideTransaction: true;
  applicationEd25519Verification: true;
  serverDerivedCheckpoint: true;
  databasePlanRevalidation: true;
  databaseServerClock: true;
  serverAuthenticatedReceiptActor: true;
  publicCryptographicMetadataOnly: true;
  readCommittedTransactionAdapter: true;
  witnessRefreshRepositoryParity: true;
  allHandlerRepositoryParity: false;
  handlerTaskKindCount: 6;
  totalHandlerTaskKindCount: number;
  maximumEnvelopeBytes: 65_536;
  protectedTableCount: 6;
  forcedRlsTableCount: 6;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresObserverWitnessPublicTrust {
  rootKeyId: string;
  manifestGeneration: number;
  manifestHash: string;
}

export interface NodePostgresObserverWitnessStateOptions {
  publicTrust: PostgresObserverWitnessPublicTrust;
  verifier: ObserverRecipeWitnessVerifier;
  endpointOrigin: string;
  witnessRequired: boolean;
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
  alert_reconciliation_contract_version: string | number | bigint;
  phase: string;
  role_manifest_fingerprint: string;
  alert_reconciliation_manifest_fingerprint: string;
  witness_refresh_role_name: string;
  protected_table_count: string | number | bigint;
  forced_rls_table_count: string | number | bigint;
  direct_table_grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  qualified_handler_task_kind_count: string | number | bigint;
  total_handler_task_kind_count: string | number | bigint;
  maximum_envelope_bytes: string | number | bigint;
  two_phase_external_io: boolean;
  external_io_outside_transaction: boolean;
  application_ed25519_verification: boolean;
  server_derived_checkpoint: boolean;
  database_plan_revalidation: boolean;
  database_server_clock: boolean;
  server_authenticated_receipt_actor: boolean;
  public_cryptographic_metadata_only: boolean;
  witness_refresh_repository_parity: boolean;
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
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  boundaryCatalogFingerprint: string;
}

interface WitnessPlan {
  evaluationTimestamp: string;
  configFingerprint: string;
  checkpoint: ObserverRecipeWitnessCheckpoint | null;
  previousReceiptHash: string;
  previousWitnessSequence: number;
  latestReceipt: {
    envelope: SignedObserverRecipeWitnessReceipt;
    receiptHash: string;
    receivedAt: string;
  } | null;
  latestCheck: {
    outcome: "accepted" | "unavailable" | "invalid" | "conflict" | "stale";
    reasonCode: string;
    checkpointHash: string;
    transparencyEventHash: string;
    receiptHash: string;
    checkedAt: string;
  } | null;
  witnessReceiptCount: number;
  witnessCheckCount: number;
  failedWitnessCheckCount: number;
}

interface PreparedAcceptance {
  receiptId: string;
  checkId: string;
  auditId: string;
  outboxId: string;
  envelope: SignedObserverRecipeWitnessReceipt;
  envelopeCanonicalJson: string;
  payloadJson: string;
  receiptHash: string;
}

interface PreparedFailure {
  code: ObserverRecipeWitnessFailureCode;
  checkId: string;
  auditId: string;
  outboxId: string;
}

export class PostgresObserverWitnessRefreshQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresObserverWitnessRefreshQualificationError";
  }
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness identifier is invalid."
    );
  }
  return `"${value}"`;
}

function relation(schema: string, name: string): string {
  return `${identifier(schema)}.${identifier(name)}`;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function exactInteger(value: unknown, label: string): number {
  const text = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!INTEGER.test(text)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      `The PostgreSQL observer-witness ${label} is invalid.`
    );
  }
  const result = Number(text);
  if (!Number.isSafeInteger(result)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      `The PostgreSQL observer-witness ${label} exceeds the safe range.`
    );
  }
  return result;
}

function exactBoolean<const T extends boolean>(value: unknown, expected: T, label: string): T {
  if (value !== expected) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      `The PostgreSQL observer-witness ${label} is invalid.`
    );
  }
  return expected;
}

function safeNamespace(value: string, label: string): string {
  if (!SAFE_ROLE_NAMESPACE.test(value)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      `The PostgreSQL observer-witness ${label} namespace is invalid.`
    );
  }
  return value;
}

function principalId(value: unknown, label: string): string {
  const text = String(value ?? "");
  if (!ID_PATTERN.test(text)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      `The PostgreSQL observer-witness ${label} is invalid.`
    );
  }
  return text;
}

function runtimeVersion(value: unknown): string {
  const text = String(value ?? "");
  if (!SEMVER.test(text)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness runtime version is invalid."
    );
  }
  return text;
}

function timestamp(value: unknown, label: string): string {
  const text = String(value ?? "");
  if (!TIMESTAMP.test(text) || !Number.isFinite(new Date(text).getTime())) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      `The PostgreSQL observer-witness ${label} timestamp is invalid.`
    );
  }
  return text;
}

function jsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      `The PostgreSQL observer-witness ${label} is invalid.`
    );
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      `The PostgreSQL observer-witness ${label} fields are invalid.`
    );
  }
}

function parsedFunctionJson(value: unknown, label: string): Record<string, unknown> {
  try {
    return jsonRecord(JSON.parse(String(value ?? "")), label);
  } catch (error) {
    if (error instanceof PostgresObserverWitnessRefreshQualificationError) throw error;
    throw new PostgresObserverWitnessRefreshQualificationError(
      `The PostgreSQL observer-witness ${label} is malformed.`
    );
  }
}

function validPublicTrust(value: PostgresObserverWitnessPublicTrust): PostgresObserverWitnessPublicTrust {
  if (!value || !SHA256.test(String(value.rootKeyId ?? ""))
    || !Number.isSafeInteger(value.manifestGeneration) || value.manifestGeneration < 1
    || !SHA256.test(String(value.manifestHash ?? ""))) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness public trust binding is invalid."
    );
  }
  return { ...value };
}

export function buildPostgresObserverWitnessRefreshManifest(
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
  requestedWitnessRefreshRoleNamespace = "yoink_witness_qualification"
): PostgresObserverWitnessRefreshManifest {
  if (!SAFE_SCHEMA.test(requestedSchema)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness schema is invalid."
    );
  }
  const previous = buildPostgresOperatorAlertReconciliationManifest(
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
    requestedAlertReconciliationRoleNamespace
  );
  const witnessRefreshRoleNamespace = safeNamespace(
    requestedWitnessRefreshRoleNamespace,
    "refresh-role"
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
    previous.alertReconciliationRoleNamespace
  ]);
  if (priorNamespaces.has(witnessRefreshRoleNamespace)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness role namespace must be independent."
    );
  }
  const roleName = `${witnessRefreshRoleNamespace}_witness_refresh`;
  identifier(roleName);
  const withoutFingerprint = {
    contractVersion: POSTGRES_OBSERVER_WITNESS_REFRESH_CONTRACT_VERSION as 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION as 3,
    alertReconciliationContractVersion:
      POSTGRES_OPERATOR_ALERT_RECONCILIATION_CONTRACT_VERSION as 1,
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
    witnessRefreshRoleNamespace,
    alertReconciliationManifestFingerprint: previous.fingerprint,
    witnessRefreshRole: {
      kind: "observer_recipe_witness_refresh_boundary" as const,
      name: roleName,
      functionName: POSTGRES_OBSERVER_WITNESS_REFRESH_FUNCTION as
        typeof POSTGRES_OBSERVER_WITNESS_REFRESH_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTableNames: [...PROTECTED_TABLES],
      forcedRlsTableNames: [...PROTECTED_TABLES],
      login: false as const,
      inherit: false as const,
      bypassRls: false as const,
      directTableAccess: false as const
    },
    protectedTableCount: 6 as const,
    forcedRlsTableCount: 6 as const,
    directTableGrantCount: 0 as const,
    functionGrantCount: 1 as const,
    qualifiedHandlerTaskKinds: [...QUALIFIED_HANDLER_TASK_KINDS] as [
      "notification_recovery",
      "execution_recovery",
      "operational_telemetry_retention",
      "observer_recipe_candidate_evaluation",
      "adapter_alert_reconciliation",
      "observer_recipe_witness_refresh"
    ],
    qualifiedHandlerTaskKindCount: 6 as const,
    totalHandlerTaskKindCount: BACKGROUND_TASK_KINDS.length,
    maximumEnvelopeBytes: POSTGRES_OBSERVER_WITNESS_REFRESH_MAXIMUM_ENVELOPE_BYTES as 65_536,
    twoPhaseExternalIo: true as const,
    externalIoOutsideTransaction: true as const,
    applicationEd25519Verification: true as const,
    serverDerivedCheckpoint: true as const,
    databasePlanRevalidation: true as const,
    databaseServerClock: true as const,
    serverAuthenticatedReceiptActor: true as const,
    publicCryptographicMetadataOnly: true as const,
    witnessRefreshRepositoryParity: true as const,
    allHandlerRepositoryParity: false as const,
    mutationAuthority: false as const,
    activePrincipalCount: 0 as const,
    runtimeAuthority: false as const
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

let cachedCapabilityProjection:
Readonly<PostgresObserverWitnessRefreshCapabilityProjection> | null = null;

export function postgresObserverWitnessRefreshCapabilityProjection():
PostgresObserverWitnessRefreshCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresObserverWitnessRefreshManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    alertReconciliationContractVersion: 1,
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
    twoPhaseExternalIo: true,
    externalIoOutsideTransaction: true,
    applicationEd25519Verification: true,
    serverDerivedCheckpoint: true,
    databasePlanRevalidation: true,
    databaseServerClock: true,
    serverAuthenticatedReceiptActor: true,
    publicCryptographicMetadataOnly: true,
    readCommittedTransactionAdapter: true,
    witnessRefreshRepositoryParity: true,
    allHandlerRepositoryParity: false,
    handlerTaskKindCount: 6,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    maximumEnvelopeBytes: 65_536,
    protectedTableCount: 6,
    forcedRlsTableCount: 6,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

function sqlSha256(expression: string): string {
  return `pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(${expression}, 'UTF8')), 'hex')`;
}

export function observerWitnessRefreshFunctionSource(
  manifest: PostgresObserverWitnessRefreshManifest
): string {
  const checkpointHash = sqlSha256(
    `${literal("yoink-observer-recipe-witness-checkpoint-v1|")} || checkpoint_canonical`
  );
  const receiptHash = sqlSha256(
    `${literal("yoink-observer-recipe-witness-receipt-v1|")} || expected_envelope_canonical`
  );
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  evaluation_clock TIMESTAMPTZ;
  evaluation_timestamp TEXT;
  mutation_timestamp TEXT;
  config_payload JSONB;
  input_payload JSONB;
  current_plan JSONB;
  checkpoint JSONB := 'null'::jsonb;
  checkpoint_canonical TEXT := '';
  derived_checkpoint_hash TEXT := '';
  config_fingerprint TEXT;
  current_manifest_generation BIGINT;
  current_manifest_root_key_id TEXT;
  current_manifest_hash TEXT;
  current_transparency_sequence BIGINT;
  current_transparency_generation BIGINT;
  current_transparency_manifest_hash TEXT;
  current_transparency_event_hash TEXT;
  previous_receipt_hash TEXT := '';
  previous_witness_sequence BIGINT := 0;
  latest_receipt JSONB := 'null'::jsonb;
  latest_check JSONB := 'null'::jsonb;
  receipt_count BIGINT;
  check_count BIGINT;
  failed_check_count BIGINT;
  proposed_acceptance JSONB;
  proposed_failure JSONB;
  proposed_envelope JSONB;
  proposed_receipt_hash TEXT;
  proposed_payload_json TEXT;
  proposed_payload JSONB;
  expected_payload_canonical TEXT;
  expected_envelope_canonical TEXT;
  expected_receipt_hash TEXT;
  expected_witness_sequence BIGINT;
  witnessed_clock TIMESTAMPTZ;
  valid_until_clock TIMESTAMPTZ;
  failure_code TEXT;
  failure_outcome TEXT;
  failure_reason TEXT;
  audit_correlation TEXT;
  audit_event_type TEXT;
  audit_reason_code TEXT;
  audit_message TEXT;
  audit_data JSONB;
  outbox_payload JSONB;
  affected_rows BIGINT;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected observer-witness principal is invalid';
  END IF;
  IF runtime_version !~ '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness runtime version is invalid';
  END IF;
  IF operation_name NOT IN ('plan', 'accept', 'failure') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness operation is invalid';
  END IF;
  IF correlation_id !~ '^witnessrefresh_[a-f0-9]{48}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness correlation is invalid';
  END IF;
  IF pg_catalog.octet_length(config_json) > 4096
    OR pg_catalog.octet_length(payload_json) > ${POSTGRES_OBSERVER_WITNESS_REFRESH_MAXIMUM_ENVELOPE_BYTES * 2} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness input exceeds its bound';
  END IF;
  BEGIN
    config_payload := config_json::jsonb;
    input_payload := payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness JSON input is invalid';
  END;
  IF pg_catalog.jsonb_typeof(config_payload) <> 'object'
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(config_payload)) <> 6
    OR NOT (config_payload ?& ARRAY[
      'rootKeyId', 'manifestGeneration', 'manifestHash',
      'logId', 'witnessKeyId', 'maxAgeSeconds'
    ])
    OR config_payload->>'rootKeyId' !~ '^[a-f0-9]{64}$'
    OR config_payload->>'manifestGeneration' !~ '^[1-9][0-9]*$'
    OR (config_payload->>'manifestGeneration')::NUMERIC > 9007199254740991
    OR config_payload->>'manifestHash' !~ '^[a-f0-9]{64}$'
    OR config_payload->>'logId' !~ '^[a-z0-9][a-z0-9._-]{2,63}$'
    OR config_payload->>'witnessKeyId' !~ '^[a-f0-9]{64}$'
    OR config_payload->>'maxAgeSeconds' !~ '^[1-9][0-9]*$'
    OR (config_payload->>'maxAgeSeconds')::BIGINT NOT BETWEEN 60 AND 86400 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness public configuration is invalid';
  END IF;
  IF pg_catalog.jsonb_typeof(input_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness payload is invalid';
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

  IF operation_name = 'plan' THEN
    IF evaluation_timestamp_input <> '' OR input_payload <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness plan input is invalid';
    END IF;
    evaluation_clock := pg_catalog.statement_timestamp();
  ELSE
    IF evaluation_timestamp_input !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness evaluation timestamp is invalid';
    END IF;
    evaluation_clock := evaluation_timestamp_input::timestamptz;
    IF pg_catalog.abs(EXTRACT(EPOCH FROM (pg_catalog.statement_timestamp() - evaluation_clock)))
         > ${APPLY_TIMESTAMP_SKEW_SECONDS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness plan expired before apply';
    END IF;
  END IF;
  evaluation_timestamp := pg_catalog.to_char(
    evaluation_clock AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  mutation_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yoink_observer_witness_refresh_v1:' || resolved_tenant_id || ':'
        || (config_payload->>'logId'),
      0
    )
  );

  SELECT trust.generation, trust.root_key_id, trust.manifest_hash
    INTO current_manifest_generation, current_manifest_root_key_id, current_manifest_hash
  FROM ${relation(manifest.schemaName, "observer_recipe_trust_manifests")} AS trust
  WHERE trust.tenant_id = resolved_tenant_id
  ORDER BY trust.generation DESC, trust.installed_at DESC, trust.id DESC
  LIMIT 1;
  SELECT event.sequence, event.manifest_generation, event.manifest_hash, event.event_hash
    INTO current_transparency_sequence, current_transparency_generation,
         current_transparency_manifest_hash, current_transparency_event_hash
  FROM ${relation(manifest.schemaName, "observer_recipe_transparency_events")} AS event
  WHERE event.tenant_id = resolved_tenant_id
  ORDER BY event.sequence DESC, event.id DESC
  LIMIT 1;

  IF current_manifest_generation IS NOT NULL
    AND current_manifest_generation = (config_payload->>'manifestGeneration')::BIGINT
    AND current_manifest_root_key_id = config_payload->>'rootKeyId'
    AND current_manifest_hash = config_payload->>'manifestHash'
    AND current_transparency_sequence IS NOT NULL
    AND current_transparency_generation = current_manifest_generation
    AND current_transparency_manifest_hash = current_manifest_hash
    AND current_transparency_event_hash ~ '^[a-f0-9]{64}$' THEN
    checkpoint := pg_catalog.jsonb_build_object(
      'contractVersion', 1,
      'logId', config_payload->>'logId',
      'rootKeyId', config_payload->>'rootKeyId',
      'manifestGeneration', current_manifest_generation,
      'manifestHash', current_manifest_hash,
      'transparencySequence', current_transparency_sequence,
      'transparencyEventHash', current_transparency_event_hash
    );
    checkpoint_canonical := '{"contractVersion":1,"logId":'
      || pg_catalog.to_jsonb(config_payload->>'logId')::text
      || ',"manifestGeneration":' || current_manifest_generation::text
      || ',"manifestHash":' || pg_catalog.to_jsonb(current_manifest_hash)::text
      || ',"rootKeyId":' || pg_catalog.to_jsonb(config_payload->>'rootKeyId')::text
      || ',"transparencyEventHash":' || pg_catalog.to_jsonb(current_transparency_event_hash)::text
      || ',"transparencySequence":' || current_transparency_sequence::text || '}';
    derived_checkpoint_hash := ${checkpointHash};
  END IF;

  SELECT receipt.receipt_hash, receipt.witness_sequence,
         pg_catalog.jsonb_build_object(
           'envelope', pg_catalog.jsonb_build_object(
             'algorithm', 'Ed25519',
             'keyId', receipt.witness_key_id,
             'payload', receipt.payload_json::jsonb,
             'signature', receipt.signature
           ),
           'receiptHash', receipt.receipt_hash,
           'receivedAt', receipt.received_at
         )
    INTO previous_receipt_hash, previous_witness_sequence, latest_receipt
  FROM ${relation(manifest.schemaName, "observer_recipe_witness_receipts")} AS receipt
  WHERE receipt.tenant_id = resolved_tenant_id
    AND receipt.log_id = config_payload->>'logId'
  ORDER BY receipt.witness_sequence DESC, receipt.id DESC
  LIMIT 1;
  previous_receipt_hash := COALESCE(previous_receipt_hash, '');
  previous_witness_sequence := COALESCE(previous_witness_sequence, 0);
  latest_receipt := COALESCE(latest_receipt, 'null'::jsonb);

  SELECT pg_catalog.jsonb_build_object(
           'outcome', witness_check.outcome,
           'reasonCode', witness_check.reason_code,
           'checkpointHash', witness_check.checkpoint_hash,
           'transparencyEventHash', witness_check.transparency_event_hash,
           'receiptHash', witness_check.receipt_hash,
           'checkedAt', witness_check.checked_at
         )
    INTO latest_check
  FROM ${relation(manifest.schemaName, "observer_recipe_witness_checks")} AS witness_check
  WHERE witness_check.tenant_id = resolved_tenant_id
    AND witness_check.log_id = config_payload->>'logId'
  ORDER BY witness_check.checked_at DESC, witness_check.id DESC
  LIMIT 1;
  latest_check := COALESCE(latest_check, 'null'::jsonb);

  SELECT COUNT(*) INTO receipt_count
  FROM ${relation(manifest.schemaName, "observer_recipe_witness_receipts")} AS receipt
  WHERE receipt.tenant_id = resolved_tenant_id
    AND receipt.log_id = config_payload->>'logId';
  SELECT COUNT(*), COUNT(*) FILTER (WHERE witness_check.outcome <> 'accepted')
    INTO check_count, failed_check_count
  FROM ${relation(manifest.schemaName, "observer_recipe_witness_checks")} AS witness_check
  WHERE witness_check.tenant_id = resolved_tenant_id
    AND witness_check.log_id = config_payload->>'logId';

  config_fingerprint := ${sqlSha256("config_payload::text")};
  current_plan := pg_catalog.jsonb_build_object(
    'evaluationTimestamp', evaluation_timestamp,
    'configFingerprint', config_fingerprint,
    'checkpoint', checkpoint,
    'previousReceiptHash', previous_receipt_hash,
    'previousWitnessSequence', previous_witness_sequence,
    'latestReceipt', latest_receipt,
    'latestCheck', latest_check,
    'witnessReceiptCount', receipt_count,
    'witnessCheckCount', check_count,
    'failedWitnessCheckCount', failed_check_count
  );

  IF operation_name = 'plan' THEN
    RETURN QUERY SELECT current_plan::text;
    RETURN;
  END IF;
  IF (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(input_payload)) <> 2
    OR NOT (input_payload ?& ARRAY['plan', CASE WHEN operation_name = 'accept' THEN 'acceptance' ELSE 'failure' END])
    OR input_payload->'plan' <> current_plan THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'observer-witness plan changed before apply';
  END IF;

  IF operation_name = 'accept' THEN
    IF checkpoint = 'null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'observer-witness checkpoint is unavailable';
    END IF;
    proposed_acceptance := input_payload->'acceptance';
    IF pg_catalog.jsonb_typeof(proposed_acceptance) <> 'object'
      OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(proposed_acceptance)) <> 8
      OR NOT (proposed_acceptance ?& ARRAY[
        'receiptId', 'checkId', 'auditId', 'outboxId', 'envelope',
        'envelopeCanonicalJson', 'payloadJson', 'receiptHash'
      ])
      OR proposed_acceptance->>'receiptId' !~ '^observer_recipe_witness_receipt_[a-f0-9]{32}$'
      OR proposed_acceptance->>'checkId' !~ '^observer_recipe_witness_check_[a-f0-9]{32}$'
      OR proposed_acceptance->>'auditId' !~ '^audit_[a-f0-9]{32}$'
      OR proposed_acceptance->>'outboxId' !~ '^outbox_[a-f0-9]{32}$'
      OR proposed_acceptance->>'receiptHash' !~ '^[a-f0-9]{64}$'
      OR pg_catalog.octet_length(proposed_acceptance->>'envelopeCanonicalJson')
        > ${POSTGRES_OBSERVER_WITNESS_REFRESH_MAXIMUM_ENVELOPE_BYTES}
      OR pg_catalog.octet_length(proposed_acceptance->>'payloadJson')
        > ${POSTGRES_OBSERVER_WITNESS_REFRESH_MAXIMUM_ENVELOPE_BYTES} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness acceptance is invalid';
    END IF;
    proposed_envelope := proposed_acceptance->'envelope';
    IF pg_catalog.jsonb_typeof(proposed_envelope) <> 'object'
      OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(proposed_envelope)) <> 4
      OR NOT (proposed_envelope ?& ARRAY['algorithm', 'keyId', 'payload', 'signature'])
      OR proposed_envelope->>'algorithm' <> 'Ed25519'
      OR proposed_envelope->>'keyId' <> config_payload->>'witnessKeyId'
      OR proposed_envelope->>'signature' !~ '^[A-Za-z0-9_-]{80,120}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness envelope is invalid';
    END IF;
    proposed_payload := proposed_envelope->'payload';
    IF pg_catalog.jsonb_typeof(proposed_payload) <> 'object'
      OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(proposed_payload)) <> 7
      OR NOT (proposed_payload ?& ARRAY[
        'contractVersion', 'checkpoint', 'checkpointHash', 'witnessSequence',
        'previousReceiptHash', 'witnessedAt', 'validUntil'
      ])
      OR proposed_payload->>'contractVersion' <> '1'
      OR proposed_payload->'checkpoint' <> checkpoint
      OR proposed_payload->>'checkpointHash' <> derived_checkpoint_hash
      OR proposed_payload->>'previousReceiptHash' <> previous_receipt_hash
      OR proposed_payload->>'witnessSequence' !~ '^[1-9][0-9]*$'
      OR (proposed_payload->>'witnessSequence')::NUMERIC > 9007199254740991
      OR (proposed_payload->>'witnessSequence')::BIGINT <> previous_witness_sequence + 1
      OR proposed_payload->>'witnessedAt' !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
      OR proposed_payload->>'validUntil' !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness receipt payload is invalid';
    END IF;
    witnessed_clock := (proposed_payload->>'witnessedAt')::timestamptz;
    valid_until_clock := (proposed_payload->>'validUntil')::timestamptz;
    IF witnessed_clock > pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
      OR valid_until_clock <= pg_catalog.statement_timestamp()
      OR valid_until_clock <= witnessed_clock
      OR valid_until_clock - witnessed_clock > INTERVAL '24 hours'
      OR witnessed_clock + ((config_payload->>'maxAgeSeconds')::BIGINT * INTERVAL '1 second')
        <= pg_catalog.statement_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness receipt lifetime is invalid';
    END IF;
    expected_witness_sequence := previous_witness_sequence + 1;
    expected_payload_canonical := '{"checkpoint":' || checkpoint_canonical
      || ',"checkpointHash":' || pg_catalog.to_jsonb(derived_checkpoint_hash)::text
      || ',"contractVersion":1'
      || ',"previousReceiptHash":' || pg_catalog.to_jsonb(previous_receipt_hash)::text
      || ',"validUntil":' || pg_catalog.to_jsonb(proposed_payload->>'validUntil')::text
      || ',"witnessSequence":' || expected_witness_sequence::text
      || ',"witnessedAt":' || pg_catalog.to_jsonb(proposed_payload->>'witnessedAt')::text || '}';
    expected_envelope_canonical := '{"algorithm":"Ed25519","keyId":'
      || pg_catalog.to_jsonb(config_payload->>'witnessKeyId')::text
      || ',"payload":' || expected_payload_canonical
      || ',"signature":' || pg_catalog.to_jsonb(proposed_envelope->>'signature')::text || '}';
    expected_receipt_hash := ${receiptHash};
    proposed_receipt_hash := proposed_acceptance->>'receiptHash';
    proposed_payload_json := proposed_acceptance->>'payloadJson';
    IF proposed_acceptance->>'envelopeCanonicalJson' <> expected_envelope_canonical THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness canonical envelope evidence is invalid';
    END IF;
    IF proposed_receipt_hash <> expected_receipt_hash THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness receipt hash evidence is invalid';
    END IF;
    IF proposed_payload_json::jsonb <> proposed_payload THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness payload round-trip evidence is invalid';
    END IF;
    IF EXISTS (
      SELECT 1 FROM ${relation(manifest.schemaName, "observer_recipe_witness_receipts")} AS receipt
      WHERE receipt.tenant_id = resolved_tenant_id
        AND receipt.receipt_hash = proposed_receipt_hash
    ) THEN
      RETURN QUERY SELECT pg_catalog.jsonb_build_object(
        'accepted', TRUE, 'failureRecorded', FALSE, 'idempotent', TRUE
      )::text;
      RETURN;
    END IF;

    INSERT INTO ${relation(manifest.schemaName, "observer_recipe_witness_receipts")}(
      id, tenant_id, log_id, witness_key_id, witness_sequence,
      checkpoint_hash, manifest_generation, manifest_hash,
      transparency_sequence, transparency_event_hash, previous_receipt_hash,
      receipt_hash, payload_json, signature, witnessed_at, valid_until, received_at
    ) VALUES (
      proposed_acceptance->>'receiptId', resolved_tenant_id,
      config_payload->>'logId', config_payload->>'witnessKeyId',
      expected_witness_sequence, derived_checkpoint_hash,
      (checkpoint->>'manifestGeneration')::BIGINT, checkpoint->>'manifestHash',
      (checkpoint->>'transparencySequence')::BIGINT,
      checkpoint->>'transparencyEventHash', previous_receipt_hash,
      proposed_receipt_hash, proposed_payload_json,
      proposed_envelope->>'signature', proposed_payload->>'witnessedAt',
      proposed_payload->>'validUntil', mutation_timestamp
    );
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'observer-witness receipt insert was ambiguous';
    END IF;
    INSERT INTO ${relation(manifest.schemaName, "observer_recipe_witness_checks")}(
      id, tenant_id, log_id, checkpoint_hash, transparency_event_hash,
      outcome, reason_code, receipt_hash, checked_by_actor_id, checked_at
    ) VALUES (
      proposed_acceptance->>'checkId', resolved_tenant_id,
      config_payload->>'logId', derived_checkpoint_hash,
      checkpoint->>'transparencyEventHash', 'accepted',
      'witness_receipt_accepted', proposed_receipt_hash,
      resolved_user_id, mutation_timestamp
    );
    audit_correlation := proposed_receipt_hash;
    audit_event_type := 'observer_recipe_checkpoint_witnessed';
    audit_reason_code := 'independent_signature_verified';
    audit_message := 'An independently signed observer recipe transparency checkpoint was verified and pinned.';
    audit_data := pg_catalog.jsonb_build_object(
      'logId', config_payload->>'logId',
      'witnessKeyId', config_payload->>'witnessKeyId',
      'witnessSequence', expected_witness_sequence,
      'checkpointHash', derived_checkpoint_hash,
      'transparencySequence', (checkpoint->>'transparencySequence')::BIGINT,
      'transparencyEventHash', checkpoint->>'transparencyEventHash',
      'validUntil', proposed_payload->>'validUntil',
      'privacyClassification', 'public_cryptographic_metadata',
      'mutationCapable', FALSE
    );
  ELSE
    proposed_failure := input_payload->'failure';
    IF pg_catalog.jsonb_typeof(proposed_failure) <> 'object'
      OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(proposed_failure)) <> 4
      OR NOT (proposed_failure ?& ARRAY['code', 'checkId', 'auditId', 'outboxId'])
      OR proposed_failure->>'code' NOT IN (
        'unavailable', 'invalid_contract', 'invalid_signature',
        'checkpoint_conflict', 'chain_conflict', 'stale_receipt'
      )
      OR proposed_failure->>'checkId' !~ '^observer_recipe_witness_check_[a-f0-9]{32}$'
      OR proposed_failure->>'auditId' !~ '^audit_[a-f0-9]{32}$'
      OR proposed_failure->>'outboxId' !~ '^outbox_[a-f0-9]{32}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-witness failure receipt is invalid';
    END IF;
    failure_code := proposed_failure->>'code';
    failure_outcome := CASE
      WHEN failure_code = 'unavailable' THEN 'unavailable'
      WHEN failure_code = 'stale_receipt' THEN 'stale'
      WHEN failure_code IN ('checkpoint_conflict', 'chain_conflict') THEN 'conflict'
      ELSE 'invalid'
    END;
    failure_reason := 'witness_' || failure_code;
    INSERT INTO ${relation(manifest.schemaName, "observer_recipe_witness_checks")}(
      id, tenant_id, log_id, checkpoint_hash, transparency_event_hash,
      outcome, reason_code, receipt_hash, checked_by_actor_id, checked_at
    ) VALUES (
      proposed_failure->>'checkId', resolved_tenant_id,
      config_payload->>'logId', derived_checkpoint_hash,
      COALESCE(checkpoint->>'transparencyEventHash', ''), failure_outcome,
      failure_reason, '', resolved_user_id, mutation_timestamp
    );
    audit_correlation := CASE
      WHEN derived_checkpoint_hash <> '' THEN derived_checkpoint_hash
      ELSE 'observer_recipe_witness'
    END;
    audit_event_type := 'observer_recipe_witness_check_failed';
    audit_reason_code := failure_reason;
    audit_message := 'The observer recipe witness check failed closed.';
    audit_data := pg_catalog.jsonb_build_object(
      'logId', config_payload->>'logId',
      'checkpointHash', derived_checkpoint_hash,
      'transparencyEventHash', COALESCE(checkpoint->>'transparencyEventHash', ''),
      'outcome', failure_outcome,
      'privacyClassification', 'public_cryptographic_metadata',
      'distributionAllowed', FALSE,
      'mutationCapable', FALSE
    );
  END IF;

  INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
    id, tenant_id, user_id, correlation_id, event_type,
    reason_code, message, data_json, created_at
  ) VALUES (
    CASE WHEN operation_name = 'accept'
      THEN proposed_acceptance->>'auditId' ELSE proposed_failure->>'auditId' END,
    resolved_tenant_id, resolved_user_id, audit_correlation,
    audit_event_type, audit_reason_code, audit_message,
    audit_data::text, mutation_timestamp
  );
  outbox_payload := pg_catalog.jsonb_build_object(
    'auditId', CASE WHEN operation_name = 'accept'
      THEN proposed_acceptance->>'auditId' ELSE proposed_failure->>'auditId' END,
    'correlationId', audit_correlation,
    'reasonCode', audit_reason_code,
    'message', audit_message,
    'data', audit_data
  );
  INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
    id, tenant_id, aggregate_type, aggregate_id, event_type,
    payload_json, created_at, delivered_at
  ) VALUES (
    CASE WHEN operation_name = 'accept'
      THEN proposed_acceptance->>'outboxId' ELSE proposed_failure->>'outboxId' END,
    resolved_tenant_id, 'observer_recipe_witness', audit_correlation,
    audit_event_type, outbox_payload::text, mutation_timestamp, ''
  );

  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'accepted', operation_name = 'accept',
    'failureRecorded', operation_name = 'failure',
    'idempotent', FALSE
  )::text;
END
`;
}

async function inspectBoundary(
  session: PostgresQuerySession,
  manifest: PostgresObserverWitnessRefreshManifest
): Promise<BoundaryInspection> {
  const role = manifest.witnessRefreshRole.name;
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
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness role has an unsafe attribute."
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
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness role must remain unassigned."
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
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness role has direct table authority."
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
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness role has an effective table privilege."
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
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness role has an effective column privilege."
    );
  }
  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness schema privilege is invalid."
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
  const routine = routines.rows[0];
  if (routines.rows.length !== 1 || !routine
    || routine.routineName !== manifest.witnessRefreshRole.functionName
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE || routine.volatility !== "v"
    || !routine.securityDefiner || !routine.strict || routine.leakproof
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role
    || routine.source !== observerWitnessRefreshFunctionSource(manifest)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness function boundary is incomplete."
    );
  }
  const routineAcl = await session.query<{
    grantee: string;
    privilegeType: string;
    grantable: boolean;
  }>(
    `SELECT COALESCE(grantee_role.rolname, 'PUBLIC') AS grantee,
            access.privilege_type AS "privilegeType", access.is_grantable AS grantable
     FROM pg_catalog.pg_proc routine
     CROSS JOIN LATERAL pg_catalog.aclexplode(
       COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
     ) AS access
     LEFT JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid = access.grantee
     WHERE routine.oid = $1::oid ORDER BY grantee`,
    [routine.oid]
  );
  if (routineAcl.rows.length !== 2
    || !routineAcl.rows.some((row) => row.grantee === role
      && row.privilegeType === "EXECUTE" && !row.grantable)
    || !routineAcl.rows.some((row) => row.grantee === routine.ownerName
      && row.privilegeType === "EXECUTE" && !row.grantable)
    || routineAcl.rows.some((row) => row.grantee === "PUBLIC")) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness function grant is not exact."
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
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness role can access an application-schema sequence."
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
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness protected tables are not forced-RLS exact."
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
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness role must not own schema objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness role depends on a direct table policy."
    );
  }
  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  if (exactInteger(principals.rows[0]?.count, "active principal count") !== 0) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "Observer-witness qualification cannot activate a runtime principal."
    );
  }
  return {
    protectedTableCount: rls.rows.length,
    forcedRlsTableCount: rls.rows.length,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    boundaryCatalogFingerprint: fingerprint({
      role: roleRow,
      routine,
      routineAcl: routineAcl.rows,
      rls: rls.rows
    })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresObserverWitnessRefreshManifest
): PostgresObserverWitnessRefreshQualificationReceipt {
  const receipt: PostgresObserverWitnessRefreshQualificationReceipt = {
    contractVersion: exactInteger(row.contract_version, "receipt contract version") as 1,
    cutoverContractVersion: exactInteger(row.cutover_contract_version, "cutover contract version") as 3,
    alertReconciliationContractVersion: exactInteger(
      row.alert_reconciliation_contract_version,
      "alert-reconciliation contract version"
    ) as 1,
    phase: row.phase as "verified",
    schemaName: manifest.schemaName,
    roleManifestFingerprint: row.role_manifest_fingerprint,
    alertReconciliationManifestFingerprint: row.alert_reconciliation_manifest_fingerprint,
    witnessRefreshRoleName: row.witness_refresh_role_name,
    protectedTableCount: exactInteger(row.protected_table_count, "protected-table count") as 6,
    forcedRlsTableCount: exactInteger(row.forced_rls_table_count, "forced-RLS count") as 6,
    directTableGrantCount: exactInteger(row.direct_table_grant_count, "direct-grant count") as 0,
    functionGrantCount: exactInteger(row.function_grant_count, "function-grant count") as 1,
    membershipCount: exactInteger(row.membership_count, "membership count") as 0,
    activePrincipalCount: exactInteger(row.active_principal_count, "active-principal count") as 0,
    qualifiedHandlerTaskKindCount: exactInteger(
      row.qualified_handler_task_kind_count,
      "qualified-handler count"
    ) as 6,
    totalHandlerTaskKindCount: exactInteger(row.total_handler_task_kind_count, "total-handler count"),
    maximumEnvelopeBytes: exactInteger(row.maximum_envelope_bytes, "envelope-size bound") as 65_536,
    twoPhaseExternalIo: exactBoolean(row.two_phase_external_io, true, "two-phase flag"),
    externalIoOutsideTransaction: exactBoolean(
      row.external_io_outside_transaction,
      true,
      "external-I/O flag"
    ),
    applicationEd25519Verification: exactBoolean(
      row.application_ed25519_verification,
      true,
      "Ed25519-verification flag"
    ),
    serverDerivedCheckpoint: exactBoolean(row.server_derived_checkpoint, true, "checkpoint flag"),
    databasePlanRevalidation: exactBoolean(row.database_plan_revalidation, true, "plan flag"),
    databaseServerClock: exactBoolean(row.database_server_clock, true, "database-clock flag"),
    serverAuthenticatedReceiptActor: exactBoolean(
      row.server_authenticated_receipt_actor,
      true,
      "receipt-actor flag"
    ),
    publicCryptographicMetadataOnly: exactBoolean(
      row.public_cryptographic_metadata_only,
      true,
      "metadata-classification flag"
    ),
    witnessRefreshRepositoryParity: exactBoolean(
      row.witness_refresh_repository_parity,
      true,
      "repository-parity flag"
    ),
    allHandlerRepositoryParity: exactBoolean(
      row.all_handler_repository_parity,
      false,
      "all-handler flag"
    ),
    mutationAuthority: exactBoolean(row.mutation_authority, false, "mutation-authority flag"),
    directTableAccess: exactBoolean(row.direct_table_access, false, "direct-table flag"),
    runtimeAuthority: exactBoolean(row.runtime_authority, false, "runtime-authority flag"),
    productionReady: exactBoolean(row.production_ready, false, "production-ready flag"),
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    appliedAt: timestamp(row.applied_at, "applied"),
    verifiedAt: timestamp(row.verified_at, "verified")
  };
  if (receipt.phase !== "verified"
    || receipt.contractVersion !== POSTGRES_OBSERVER_WITNESS_REFRESH_CONTRACT_VERSION
    || receipt.cutoverContractVersion !== POSTGRES_CUTOVER_CONTRACT_VERSION
    || receipt.alertReconciliationContractVersion
      !== POSTGRES_OPERATOR_ALERT_RECONCILIATION_CONTRACT_VERSION
    || receipt.roleManifestFingerprint !== manifest.fingerprint
    || receipt.alertReconciliationManifestFingerprint
      !== manifest.alertReconciliationManifestFingerprint
    || receipt.witnessRefreshRoleName !== manifest.witnessRefreshRole.name
    || receipt.protectedTableCount !== 6 || receipt.forcedRlsTableCount !== 6
    || receipt.directTableGrantCount !== 0 || receipt.functionGrantCount !== 1
    || receipt.membershipCount !== 0 || receipt.activePrincipalCount !== 0
    || receipt.qualifiedHandlerTaskKindCount !== 6
    || receipt.totalHandlerTaskKindCount !== BACKGROUND_TASK_KINDS.length
    || receipt.maximumEnvelopeBytes !== 65_536
    || !receipt.twoPhaseExternalIo || !receipt.externalIoOutsideTransaction
    || !receipt.applicationEd25519Verification || !receipt.serverDerivedCheckpoint
    || !receipt.databasePlanRevalidation || !receipt.databaseServerClock
    || !receipt.serverAuthenticatedReceiptActor || !receipt.publicCryptographicMetadataOnly
    || !receipt.witnessRefreshRepositoryParity || receipt.allHandlerRepositoryParity
    || receipt.mutationAuthority || receipt.directTableAccess
    || receipt.runtimeAuthority || receipt.productionReady) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness qualification receipt is inconsistent."
    );
  }
  return receipt;
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresObserverWitnessRefreshManifest
): Promise<PostgresObserverWitnessRefreshQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_OBSERVER_WITNESS_REFRESH_RECEIPT_TABLE)}
     WHERE singleton = TRUE`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresObserverWitnessRefreshQualificationReceipt,
  manifest: PostgresObserverWitnessRefreshManifest
): void {
  if (inspection.protectedTableCount !== receipt.protectedTableCount
    || inspection.forcedRlsTableCount !== receipt.forcedRlsTableCount
    || inspection.directTableGrantCount !== receipt.directTableGrantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.roleManifestFingerprint !== manifest.fingerprint) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness boundary no longer matches its receipt."
    );
  }
}

export async function verifyPostgresObserverWitnessRefreshBoundary(
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
  requestedWitnessRefreshRoleNamespace = "yoink_witness_qualification"
): Promise<PostgresObserverWitnessRefreshQualificationReceipt> {
  const manifest = buildPostgresObserverWitnessRefreshManifest(
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
    requestedWitnessRefreshRoleNamespace
  );
  await verifyPostgresOperatorAlertReconciliationBoundary(
    database,
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
    manifest.alertReconciliationRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresObserverWitnessRefreshBoundary(
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
  now = Date.now()
): Promise<PostgresObserverWitnessRefreshQualificationReceipt> {
  const manifest = buildPostgresObserverWitnessRefreshManifest(
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
    requestedWitnessRefreshRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "Observer-witness qualification requires the supported BYPASSRLS control role."
    );
  }
  const authority = await database.query<{ rolcreaterole: boolean; rolsuper: boolean }>(
    "SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user"
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "Observer-witness qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresOperatorAlertReconciliationBoundary(
    database,
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
    manifest.alertReconciliationRoleNamespace
  );
  const existing = await database.query<{
    roleExists: boolean;
    receiptExists: boolean;
    functionExists: boolean;
    guardExists: boolean;
  }>(
    `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1) AS "roleExists",
            pg_catalog.to_regclass($2) IS NOT NULL AS "receiptExists",
            pg_catalog.to_regprocedure($3) IS NOT NULL AS "functionExists",
            pg_catalog.to_regprocedure($4) IS NOT NULL AS "guardExists"`,
    [
      manifest.witnessRefreshRole.name,
      `${manifest.schemaName}.${POSTGRES_OBSERVER_WITNESS_REFRESH_RECEIPT_TABLE}`,
      `${manifest.schemaName}.${POSTGRES_OBSERVER_WITNESS_REFRESH_FUNCTION}(${FUNCTION_ARGUMENT_TYPES.join(",")})`,
      `${manifest.schemaName}.yoink_guard_observer_witness_refresh_receipt()`
    ]
  );
  if (existing.rows[0]?.roleExists || existing.rows[0]?.receiptExists
    || existing.rows[0]?.functionExists || existing.rows[0]?.guardExists) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "Observer-witness qualification refuses to reuse a role, function, guard, or receipt."
    );
  }
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The observer-witness qualification timestamp is invalid."
    );
  }
  const appliedAt = new Date(now).toISOString();
  if (!TIMESTAMP.test(appliedAt)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The observer-witness qualification timestamp is invalid."
    );
  }
  await database.transaction(async (session) => {
    await session.query(
      `CREATE ROLE ${identifier(manifest.witnessRefreshRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.witnessRefreshRole.name)}`
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
      `CREATE FUNCTION ${relation(manifest.schemaName, manifest.witnessRefreshRole.functionName)}(
         expected_tenant_id text, expected_user_id text, runtime_version text,
         operation_name text, config_json text, evaluation_timestamp_input text,
         correlation_id text, payload_json text
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${observerWitnessRefreshFunctionSource(manifest)}$yoink$`
    );
    const functionSignature = `${relation(
      manifest.schemaName,
      manifest.witnessRefreshRole.functionName
    )}(${FUNCTION_ARGUMENT_TYPES.join(", ")})`;
    await session.query(`REVOKE ALL ON FUNCTION ${functionSignature} FROM PUBLIC`);
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${functionSignature}
       TO ${identifier(manifest.witnessRefreshRole.name)}`
    );
    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_OBSERVER_WITNESS_REFRESH_RECEIPT_TABLE)}(
         singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
         contract_version BIGINT NOT NULL CHECK (contract_version = 1),
         cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = 3),
         alert_reconciliation_contract_version BIGINT NOT NULL CHECK (alert_reconciliation_contract_version = 1),
         phase TEXT NOT NULL CHECK (phase = 'verified'),
         role_manifest_fingerprint TEXT NOT NULL,
         alert_reconciliation_manifest_fingerprint TEXT NOT NULL,
         witness_refresh_role_name TEXT NOT NULL,
         protected_table_count BIGINT NOT NULL CHECK (protected_table_count = 6),
         forced_rls_table_count BIGINT NOT NULL CHECK (forced_rls_table_count = 6),
         direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
         function_grant_count BIGINT NOT NULL CHECK (function_grant_count = 1),
         membership_count BIGINT NOT NULL CHECK (membership_count = 0),
         active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
         qualified_handler_task_kind_count BIGINT NOT NULL CHECK (qualified_handler_task_kind_count = 6),
         total_handler_task_kind_count BIGINT NOT NULL,
         maximum_envelope_bytes BIGINT NOT NULL CHECK (maximum_envelope_bytes = 65536),
         two_phase_external_io BOOLEAN NOT NULL CHECK (two_phase_external_io = TRUE),
         external_io_outside_transaction BOOLEAN NOT NULL CHECK (external_io_outside_transaction = TRUE),
         application_ed25519_verification BOOLEAN NOT NULL CHECK (application_ed25519_verification = TRUE),
         server_derived_checkpoint BOOLEAN NOT NULL CHECK (server_derived_checkpoint = TRUE),
         database_plan_revalidation BOOLEAN NOT NULL CHECK (database_plan_revalidation = TRUE),
         database_server_clock BOOLEAN NOT NULL CHECK (database_server_clock = TRUE),
         server_authenticated_receipt_actor BOOLEAN NOT NULL CHECK (server_authenticated_receipt_actor = TRUE),
         public_cryptographic_metadata_only BOOLEAN NOT NULL CHECK (public_cryptographic_metadata_only = TRUE),
         witness_refresh_repository_parity BOOLEAN NOT NULL CHECK (witness_refresh_repository_parity = TRUE),
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
        POSTGRES_OBSERVER_WITNESS_REFRESH_RECEIPT_TABLE
      )} FROM PUBLIC`
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_guard_observer_witness_refresh_receipt")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $guard$
       BEGIN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'observer-witness refresh receipt is immutable'; END
       $guard$`
    );
    await session.query(
      `REVOKE ALL ON FUNCTION ${relation(
        manifest.schemaName,
        "yoink_guard_observer_witness_refresh_receipt"
      )}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_observer_witness_refresh_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(
        manifest.schemaName,
        POSTGRES_OBSERVER_WITNESS_REFRESH_RECEIPT_TABLE
      )}
       FOR EACH ROW EXECUTE FUNCTION ${relation(
        manifest.schemaName,
        "yoink_guard_observer_witness_refresh_receipt"
      )}()`
    );
    const inspection = await inspectBoundary(session, manifest);
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_OBSERVER_WITNESS_REFRESH_RECEIPT_TABLE)}(
         singleton, contract_version, cutover_contract_version,
         alert_reconciliation_contract_version, phase, role_manifest_fingerprint,
         alert_reconciliation_manifest_fingerprint, witness_refresh_role_name,
         protected_table_count, forced_rls_table_count, direct_table_grant_count,
         function_grant_count, membership_count, active_principal_count,
         qualified_handler_task_kind_count, total_handler_task_kind_count,
         maximum_envelope_bytes, two_phase_external_io,
         external_io_outside_transaction, application_ed25519_verification,
         server_derived_checkpoint, database_plan_revalidation,
         database_server_clock, server_authenticated_receipt_actor,
         public_cryptographic_metadata_only, witness_refresh_repository_parity,
         all_handler_repository_parity, mutation_authority, direct_table_access,
         runtime_authority, production_ready, boundary_catalog_fingerprint,
         applied_at, verified_at
       ) VALUES (
         TRUE, 1, 3, 1, 'verified', $1, $2, $3,
         6, 6, 0, 1, 0, 0, 6, $4, 65536,
         TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE,
         FALSE, FALSE, FALSE, FALSE, FALSE, $5, $6, $6
       )`,
      [
        manifest.fingerprint,
        manifest.alertReconciliationManifestFingerprint,
        manifest.witnessRefreshRole.name,
        manifest.totalHandlerTaskKindCount,
        inspection.boundaryCatalogFingerprint,
        appliedAt
      ]
    );
  });
  return verifyPostgresObserverWitnessRefreshBoundary(
    database,
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
  );
}

function checkpointFromValue(
  value: unknown,
  binding: Record<string, unknown>
): ObserverRecipeWitnessCheckpoint | null {
  if (value === null) return null;
  const checkpoint = jsonRecord(value, "checkpoint");
  exactKeys(checkpoint, [
    "contractVersion",
    "logId",
    "rootKeyId",
    "manifestGeneration",
    "manifestHash",
    "transparencySequence",
    "transparencyEventHash"
  ], "checkpoint");
  const result = checkpoint as unknown as ObserverRecipeWitnessCheckpoint;
  observerRecipeWitnessCheckpointHash(result);
  if (result.logId !== binding.logId || result.rootKeyId !== binding.rootKeyId
    || result.manifestGeneration !== binding.manifestGeneration
    || result.manifestHash !== binding.manifestHash) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness checkpoint escaped its public trust binding."
    );
  }
  return result;
}

function latestReceiptFromValue(value: unknown): WitnessPlan["latestReceipt"] {
  if (value === null) return null;
  const latest = jsonRecord(value, "latest receipt");
  exactKeys(latest, ["envelope", "receiptHash", "receivedAt"], "latest receipt");
  const envelope = jsonRecord(latest.envelope, "latest receipt envelope");
  exactKeys(envelope, ["algorithm", "keyId", "payload", "signature"], "latest receipt envelope");
  if (!SHA256.test(String(latest.receiptHash ?? ""))) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness latest receipt hash is invalid."
    );
  }
  return {
    envelope: envelope as unknown as SignedObserverRecipeWitnessReceipt,
    receiptHash: String(latest.receiptHash),
    receivedAt: timestamp(latest.receivedAt, "latest-receipt received")
  };
}

function latestCheckFromValue(value: unknown): WitnessPlan["latestCheck"] {
  if (value === null) return null;
  const check = jsonRecord(value, "latest check");
  exactKeys(check, [
    "outcome",
    "reasonCode",
    "checkpointHash",
    "transparencyEventHash",
    "receiptHash",
    "checkedAt"
  ], "latest check");
  type WitnessCheckOutcome = NonNullable<WitnessPlan["latestCheck"]>["outcome"];
  const outcome = String(check.outcome ?? "") as WitnessCheckOutcome;
  if (!["accepted", "unavailable", "invalid", "conflict", "stale"].includes(outcome)
    || !/^[a-z][a-z0-9_]{1,79}$/.test(String(check.reasonCode ?? ""))
    || (![check.checkpointHash, check.transparencyEventHash, check.receiptHash]
      .every((item) => item === "" || SHA256.test(String(item))))) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness latest check is invalid."
    );
  }
  return {
    outcome,
    reasonCode: String(check.reasonCode),
    checkpointHash: String(check.checkpointHash),
    transparencyEventHash: String(check.transparencyEventHash),
    receiptHash: String(check.receiptHash),
    checkedAt: timestamp(check.checkedAt, "latest-check")
  };
}

function witnessPlanFromRecord(
  value: Record<string, unknown>,
  binding: Record<string, unknown>
): WitnessPlan {
  exactKeys(value, [
    "evaluationTimestamp",
    "configFingerprint",
    "checkpoint",
    "previousReceiptHash",
    "previousWitnessSequence",
    "latestReceipt",
    "latestCheck",
    "witnessReceiptCount",
    "witnessCheckCount",
    "failedWitnessCheckCount"
  ], "plan");
  const previousReceiptHash = String(value.previousReceiptHash ?? "");
  if ((previousReceiptHash !== "" && !SHA256.test(previousReceiptHash))
    || !SHA256.test(String(value.configFingerprint ?? ""))) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness plan fingerprint is invalid."
    );
  }
  const result: WitnessPlan = {
    evaluationTimestamp: timestamp(value.evaluationTimestamp, "evaluation"),
    configFingerprint: String(value.configFingerprint),
    checkpoint: checkpointFromValue(value.checkpoint, binding),
    previousReceiptHash,
    previousWitnessSequence: exactInteger(value.previousWitnessSequence, "previous sequence"),
    latestReceipt: latestReceiptFromValue(value.latestReceipt),
    latestCheck: latestCheckFromValue(value.latestCheck),
    witnessReceiptCount: exactInteger(value.witnessReceiptCount, "receipt count"),
    witnessCheckCount: exactInteger(value.witnessCheckCount, "check count"),
    failedWitnessCheckCount: exactInteger(value.failedWitnessCheckCount, "failed-check count")
  };
  if (result.failedWitnessCheckCount > result.witnessCheckCount
    || result.previousWitnessSequence > result.witnessReceiptCount
    || (result.witnessReceiptCount === 0
      ? result.previousReceiptHash !== "" || result.previousWitnessSequence !== 0
        || result.latestReceipt !== null
      : result.previousReceiptHash === "" || result.previousWitnessSequence < 1
        || result.latestReceipt === null
        || result.latestReceipt.receiptHash !== result.previousReceiptHash)) {
    throw new PostgresObserverWitnessRefreshQualificationError(
      "The PostgreSQL observer-witness plan counts are inconsistent."
    );
  }
  return result;
}

function statusFromPlan(
  plan: WitnessPlan,
  verifier: ObserverRecipeWitnessVerifier,
  scopedLogId: string,
  endpointOrigin: string,
  witnessRequired: boolean,
  now: number
): Record<string, unknown> {
  const checkpoint = plan.checkpoint;
  const latest = plan.latestReceipt;
  const latestCheck = plan.latestCheck;
  let state = "awaiting_checkpoint";
  let healthy = false;
  let alarmCode = "observer_recipe_witness_checkpoint_missing";
  if (checkpoint && (!latest
    || latest.envelope.payload.checkpoint.transparencyEventHash !== checkpoint.transparencyEventHash)) {
    state = "witness_pending";
    alarmCode = latestCheck && latestCheck.outcome !== "accepted"
      ? `observer_recipe_witness_${latestCheck.outcome}`
      : "observer_recipe_witness_receipt_missing";
  } else if (checkpoint && latest) {
    const envelope = latest.envelope;
    const historicalNow = Math.min(
      now,
      Math.max(
        new Date(envelope.payload.witnessedAt).getTime(),
        new Date(envelope.payload.validUntil).getTime() - 1
      )
    );
    try {
      verifier.validate(envelope, checkpoint, envelope.payload.previousReceiptHash, historicalNow);
      if (observerRecipeWitnessReceiptHash(envelope) !== latest.receiptHash) {
        throw new Error("receipt hash mismatch");
      }
      if (verifier.receiptFresh(envelope, now)) {
        const failedOutcome = latestCheck && latestCheck.outcome !== "accepted"
          && new Date(latestCheck.checkedAt).getTime() > new Date(latest.receivedAt).getTime()
          ? latestCheck.outcome
          : "";
        state = failedOutcome ? "degraded" : "healthy";
        healthy = true;
        alarmCode = failedOutcome ? `observer_recipe_witness_${failedOutcome}` : "";
      } else {
        state = "stale";
        alarmCode = "observer_recipe_witness_receipt_stale";
      }
    } catch {
      state = "inconsistent";
      alarmCode = "observer_recipe_witness_receipt_invalid";
    }
  }
  return {
    required: witnessRequired,
    configured: true,
    enforcement: witnessRequired ? "required" : "advisory",
    endpointOrigin,
    logId: scopedLogId,
    witnessKeyId: verifier.key.keyId,
    maxAgeSeconds: verifier.maxAgeSeconds,
    state,
    healthy,
    deliveryAllowed: !witnessRequired || healthy,
    alarmCode,
    checkpoint: checkpoint ? {
      manifestGeneration: checkpoint.manifestGeneration,
      manifestHash: checkpoint.manifestHash,
      transparencySequence: checkpoint.transparencySequence,
      transparencyEventHash: checkpoint.transparencyEventHash,
      checkpointHash: observerRecipeWitnessCheckpointHash(checkpoint)
    } : null,
    latestReceipt: latest ? {
      witnessSequence: latest.envelope.payload.witnessSequence,
      checkpointHash: latest.envelope.payload.checkpointHash,
      transparencySequence: latest.envelope.payload.checkpoint.transparencySequence,
      transparencyEventHash: latest.envelope.payload.checkpoint.transparencyEventHash,
      receiptHash: latest.receiptHash,
      witnessedAt: latest.envelope.payload.witnessedAt,
      validUntil: latest.envelope.payload.validUntil,
      receivedAt: latest.receivedAt,
      privacyClassification: "public_cryptographic_metadata"
    } : null,
    latestCheck,
    mutationCapable: false,
    witnessReceiptCount: plan.witnessReceiptCount,
    witnessCheckCount: plan.witnessCheckCount,
    failedWitnessCheckCount: plan.failedWitnessCheckCount
  };
}

class WitnessRefreshSession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

export class NodePostgresObserverWitnessState implements ObserverRecipeWitnessStatePort {
  private readonly pool: Pool;
  readonly manifest: PostgresObserverWitnessRefreshManifest;
  private readonly tenantId: string;
  private readonly userId: string;
  private readonly version: string;
  private readonly publicTrust: PostgresObserverWitnessPublicTrust;
  private readonly verifier: ObserverRecipeWitnessVerifier;
  private readonly scopedLogId: string;
  private readonly endpointOrigin: string;
  private readonly witnessRequired: boolean;
  private readonly binding: Record<string, unknown>;
  private cachedPlan: WitnessPlan | null = null;
  private cachedCorrelationId = "";

  constructor(
    config: PostgresCutoverConnectionConfig,
    principal: BackgroundWorkerPrincipal,
    requestedRuntimeVersion: string,
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
    options: NodePostgresObserverWitnessStateOptions
  ) {
    this.tenantId = principalId(principal?.tenantId, "tenant ID");
    this.userId = principalId(principal?.userId, "user ID");
    this.version = runtimeVersion(requestedRuntimeVersion);
    this.publicTrust = validPublicTrust(options?.publicTrust);
    if (!(options?.verifier instanceof ObserverRecipeWitnessVerifier)) {
      throw new PostgresObserverWitnessRefreshQualificationError(
        "The PostgreSQL observer-witness verifier is invalid."
      );
    }
    this.verifier = options.verifier;
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(String(options.endpointOrigin ?? ""));
    } catch {
      throw new PostgresObserverWitnessRefreshQualificationError(
        "The PostgreSQL observer-witness endpoint origin is invalid."
      );
    }
    this.endpointOrigin = parsedOrigin.origin;
    if (!HTTPS_ORIGIN_PATTERN.test(this.endpointOrigin)
      || parsedOrigin.origin !== String(options.endpointOrigin)
      || parsedOrigin.username || parsedOrigin.password
      || (parsedOrigin.pathname !== "" && parsedOrigin.pathname !== "/")
      || parsedOrigin.search || parsedOrigin.hash) {
      throw new PostgresObserverWitnessRefreshQualificationError(
        "The PostgreSQL observer-witness endpoint origin is invalid."
      );
    }
    this.witnessRequired = options.witnessRequired === true;
    this.scopedLogId = observerRecipeWitnessScopedLogId(
      this.verifier.logId,
      this.tenantId
    );
    this.binding = Object.freeze({
      rootKeyId: this.publicTrust.rootKeyId,
      manifestGeneration: this.publicTrust.manifestGeneration,
      manifestHash: this.publicTrust.manifestHash,
      logId: this.scopedLogId,
      witnessKeyId: this.verifier.key.keyId,
      maxAgeSeconds: this.verifier.maxAgeSeconds
    });
    this.manifest = buildPostgresObserverWitnessRefreshManifest(
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
      requestedWitnessRefreshRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (maxConnections !== 1 && maxConnections !== 2) {
      throw new PostgresObserverWitnessRefreshQualificationError(
        "The PostgreSQL observer-witness connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_observer_witness_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_observer_witness_qualification");
  }

  private assertNow(now: number): void {
    if (!Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresObserverWitnessRefreshQualificationError(
        "The PostgreSQL observer-witness timestamp differs from the process clock."
      );
    }
  }

  private correlation(now: number): string {
    return `witnessrefresh_${createHash("sha256")
      .update(`${this.tenantId}|${this.userId}|${now}|${newId("witness_refresh")}`)
      .digest("hex").slice(0, 48)}`;
  }

  private async call(
    operation: "plan" | "accept" | "failure",
    evaluationTimestamp: string,
    correlationId: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.witnessRefreshRole.name)}`);
      const session = new WitnessRefreshSession(client);
      const result = await session.query<{ resultJson: string }>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(this.manifest.schemaName, this.manifest.witnessRefreshRole.functionName)}(
           $1, $2, $3, $4, $5, $6, $7, $8
         )`,
        [
          this.tenantId,
          this.userId,
          this.version,
          operation,
          JSON.stringify(this.binding),
          evaluationTimestamp,
          correlationId,
          JSON.stringify(payload)
        ]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresObserverWitnessRefreshQualificationError(
          "The PostgreSQL observer-witness function returned an ambiguous result."
        );
      }
      const parsed = parsedFunctionJson(result.rows[0].resultJson, `${operation} result`);
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

  private async loadPlan(now: number): Promise<WitnessPlan> {
    this.assertNow(now);
    const correlationId = this.correlation(now);
    const plan = witnessPlanFromRecord(
      await this.call("plan", "", correlationId, {}),
      this.binding
    );
    this.cachedPlan = plan;
    this.cachedCorrelationId = correlationId;
    return plan;
  }

  private preparedAcceptance(
    plan: WitnessPlan,
    value: unknown,
    now: number
  ): PreparedAcceptance {
    if (!plan.checkpoint) {
      throw new ObserverRecipeWitnessError(
        "checkpoint_conflict",
        "No configured observer recipe checkpoint is available to witness."
      );
    }
    const receipt = this.verifier.validate(
      value,
      plan.checkpoint,
      plan.previousReceiptHash,
      now
    );
    if (!this.verifier.receiptFresh(receipt, now)) {
      throw new ObserverRecipeWitnessError(
        "stale_receipt",
        "The observer recipe witness receipt is outside the configured freshness window."
      );
    }
    if (receipt.payload.witnessSequence !== plan.previousWitnessSequence + 1) {
      throw new ObserverRecipeWitnessError(
        "chain_conflict",
        "The observer recipe witness sequence does not extend the pinned witness chain."
      );
    }
    const envelopeCanonicalJson = canonicalJson(receipt);
    const payloadJson = JSON.stringify(receipt.payload);
    if (Buffer.byteLength(envelopeCanonicalJson, "utf8")
        > POSTGRES_OBSERVER_WITNESS_REFRESH_MAXIMUM_ENVELOPE_BYTES
      || Buffer.byteLength(payloadJson, "utf8")
        > POSTGRES_OBSERVER_WITNESS_REFRESH_MAXIMUM_ENVELOPE_BYTES) {
      throw new ObserverRecipeWitnessError(
        "invalid_contract",
        "The observer recipe witness receipt exceeds the bounded contract."
      );
    }
    return {
      receiptId: newId("observer_recipe_witness_receipt"),
      checkId: newId("observer_recipe_witness_check"),
      auditId: newId("audit"),
      outboxId: newId("outbox"),
      envelope: receipt,
      envelopeCanonicalJson,
      payloadJson,
      receiptHash: observerRecipeWitnessReceiptHash(receipt)
    };
  }

  async witnessCheckpoint(now = Date.now()): Promise<ObserverRecipeWitnessCheckpoint | null> {
    return (await this.loadPlan(now)).checkpoint;
  }

  async previousWitnessReceiptHash(): Promise<string> {
    if (!this.cachedPlan) {
      throw new PostgresObserverWitnessRefreshQualificationError(
        "The PostgreSQL observer-witness state was not planned before publication."
      );
    }
    return this.cachedPlan.previousReceiptHash;
  }

  async witnessStatus(now = Date.now()): Promise<Record<string, unknown>> {
    this.assertNow(now);
    const plan = this.cachedPlan ?? await this.loadPlan(now);
    return statusFromPlan(
      plan,
      this.verifier,
      this.scopedLogId,
      this.endpointOrigin,
      this.witnessRequired,
      now
    );
  }

  async acceptWitnessReceipt(value: unknown, now = Date.now()): Promise<Record<string, unknown>> {
    this.assertNow(now);
    const plan = this.cachedPlan;
    const correlationId = this.cachedCorrelationId;
    if (!plan || !correlationId) {
      throw new ObserverRecipeWitnessError(
        "checkpoint_conflict",
        "The observer recipe witness receipt has no current PostgreSQL plan."
      );
    }
    const acceptance = this.preparedAcceptance(plan, value, now);
    try {
      const result = await this.call("accept", plan.evaluationTimestamp, correlationId, {
        plan,
        acceptance
      });
      exactKeys(result, ["accepted", "failureRecorded", "idempotent"], "accept result");
      if (result.accepted !== true || result.failureRecorded !== false
        || typeof result.idempotent !== "boolean") {
        throw new PostgresObserverWitnessRefreshQualificationError(
          "The PostgreSQL observer-witness acceptance result is invalid."
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/plan changed|checkpoint is unavailable/i.test(message)) {
        throw new ObserverRecipeWitnessError(
          "checkpoint_conflict",
          "The observer recipe witness checkpoint changed before receipt application.",
          { cause: error }
        );
      }
      if (/sequence|previous|chain/i.test(message)) {
        throw new ObserverRecipeWitnessError(
          "chain_conflict",
          "The observer recipe witness chain changed before receipt application.",
          { cause: error }
        );
      }
      if (/lifetime|stale/i.test(message)) {
        throw new ObserverRecipeWitnessError(
          "stale_receipt",
          "The observer recipe witness receipt expired before database application.",
          { cause: error }
        );
      }
      if (/receipt|envelope|payload|verification evidence/i.test(message)) {
        throw new ObserverRecipeWitnessError(
          "invalid_contract",
          "The observer recipe witness receipt failed database revalidation.",
          { cause: error }
        );
      }
      throw error;
    } finally {
      this.cachedPlan = null;
      this.cachedCorrelationId = "";
    }
    const after = await this.loadPlan(now);
    return statusFromPlan(
      after,
      this.verifier,
      this.scopedLogId,
      this.endpointOrigin,
      this.witnessRequired,
      now
    );
  }

  async recordWitnessFailure(
    code: ObserverRecipeWitnessFailureCode,
    now = Date.now()
  ): Promise<Record<string, unknown>> {
    this.assertNow(now);
    if (!FAILURE_CODES.has(code)) {
      throw new PostgresObserverWitnessRefreshQualificationError(
        "The PostgreSQL observer-witness failure code is invalid."
      );
    }
    const plan = await this.loadPlan(now);
    const correlationId = this.cachedCorrelationId;
    const failure: PreparedFailure = {
      code,
      checkId: newId("observer_recipe_witness_check"),
      auditId: newId("audit"),
      outboxId: newId("outbox")
    };
    try {
      const result = await this.call("failure", plan.evaluationTimestamp, correlationId, {
        plan,
        failure
      });
      exactKeys(result, ["accepted", "failureRecorded", "idempotent"], "failure result");
      if (result.accepted !== false || result.failureRecorded !== true
        || result.idempotent !== false) {
        throw new PostgresObserverWitnessRefreshQualificationError(
          "The PostgreSQL observer-witness failure result is invalid."
        );
      }
    } finally {
      this.cachedPlan = null;
      this.cachedCorrelationId = "";
    }
    const after = await this.loadPlan(now);
    return statusFromPlan(
      after,
      this.verifier,
      this.scopedLogId,
      this.endpointOrigin,
      this.witnessRequired,
      now
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
