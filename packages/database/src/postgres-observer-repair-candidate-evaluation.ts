import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import {
  RETAILER_OBSERVER_VERSIONS,
  type ObserverRecipeFieldInput,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { BACKGROUND_TASK_KINDS, type BackgroundTaskResult } from "../../domain/src/background-task.js";
import { newId, stableHash } from "../../domain/src/ids.js";
import {
  OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES,
  OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS
} from "../../engine/src/observer-recipe-candidate-evaluation.js";
import {
  GENERATED_CANDIDATE_LIFETIME_DAYS,
  GENERATED_REPAIR_CANDIDATE_AUDIT_MESSAGE,
  GENERATED_REPAIR_PROVENANCE,
  prepareGeneratedObserverRepairCandidate,
  type GeneratedObserverRepairCandidateInput
} from "./observer-repair-candidate-repository.js";
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
  POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION,
  buildPostgresOperationalRetentionManifest,
  verifyPostgresOperationalRetentionBoundary
} from "./postgres-operational-retention.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION = 1;
export const POSTGRES_OBSERVER_CANDIDATE_EVALUATION_RECEIPT_TABLE =
  "yoink_observer_candidate_evaluation_receipt";
export const POSTGRES_OBSERVER_CANDIDATE_EVALUATION_FUNCTION =
  "yoink_evaluate_observer_repair_candidates";

const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BOUNDARY_HANDLER_TASK_KINDS = Object.freeze([
  "observer_recipe_candidate_evaluation"
] as const);
const QUALIFIED_HANDLER_TASK_KINDS = Object.freeze([
  "notification_recovery",
  "execution_recovery",
  "operational_telemetry_retention",
  "observer_recipe_candidate_evaluation"
] as const);
const PROTECTED_TABLES = Object.freeze([
  "audit_events",
  "observer_recipe_candidates",
  "observer_recipe_lifecycle_events",
  "outbox_events",
  "retailer_adapter_diagnostics"
] as const);
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text",
  "text",
  "text",
  "text",
  "text",
  "text"
] as const);
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const MAXIMUM_CLOCK_SKEW_MS = 300_000;
const APPLY_TIMESTAMP_SKEW_SECONDS = 60;
const MAXIMUM_CANDIDATE_PAYLOAD_BYTES = 131_072;
const SUPPORTED_REPAIR_FIELD_COUNT = 5;
const LIFECYCLE_REASON = "privacy_bounded_repair_candidate_generated";
const AUDIT_EVENT_TYPE = "observer_recipe_repair_candidate_generated";

export interface PostgresObserverCandidateEvaluationManifest {
  contractVersion: typeof POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  operationalRetentionContractVersion: typeof POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION;
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  queueWriteRoleNamespace: string;
  controlRoleNamespace: string;
  notificationRecoveryRoleNamespace: string;
  executionRecoveryRoleNamespace: string;
  operationalRetentionRoleNamespace: string;
  observerCandidateRoleNamespace: string;
  operationalRetentionManifestFingerprint: string;
  observerCandidateRole: {
    kind: "observer_recipe_candidate_evaluation_handler";
    name: string;
    functionName: typeof POSTGRES_OBSERVER_CANDIDATE_EVALUATION_FUNCTION;
    functionArgumentTypes: string[];
    protectedTableNames: string[];
    forcedRlsTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
    insertAccess: false;
    updateAccess: false;
    deleteAccess: false;
  };
  protectedTableCount: 5;
  forcedRlsTableCount: 5;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  boundaryHandlerTaskKinds: ["observer_recipe_candidate_evaluation"];
  boundaryHandlerTaskKindCount: 1;
  qualifiedHandlerTaskKinds: [
    "notification_recovery",
    "execution_recovery",
    "operational_telemetry_retention",
    "observer_recipe_candidate_evaluation"
  ];
  qualifiedHandlerTaskKindCount: 4;
  totalHandlerTaskKindCount: number;
  maximumDiagnosticRows: typeof OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS;
  maximumCandidatesPerRun: typeof OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES;
  supportedRepairFieldCount: typeof SUPPORTED_REPAIR_FIELD_COUNT;
  generatedCandidateLifetimeDays: typeof GENERATED_CANDIDATE_LIFETIME_DAYS;
  serverDerivedEvidencePlan: true;
  serverClockBoundEvaluation: true;
  applicationDeterministicFingerprints: true;
  databaseEvidenceRevalidation: true;
  quarantinedOnly: true;
  generatedCandidatesExecutable: false;
  mutationAuthority: false;
  observerCandidateEvaluationRepositoryParity: true;
  operationalRetentionRepositoryParity: true;
  executionRecoveryRepositoryParity: true;
  notificationRecoveryRepositoryParity: true;
  fullHandlerRepositoryParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresObserverCandidateEvaluationQualificationReceipt {
  contractVersion: typeof POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  operationalRetentionContractVersion: typeof POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION;
  phase: "verified";
  schemaName: string;
  readRoleNamespace: string;
  sessionRoleNamespace: string;
  queueWriteRoleNamespace: string;
  controlRoleNamespace: string;
  notificationRecoveryRoleNamespace: string;
  executionRecoveryRoleNamespace: string;
  operationalRetentionRoleNamespace: string;
  observerCandidateRoleNamespace: string;
  roleManifestFingerprint: string;
  operationalRetentionManifestFingerprint: string;
  observerCandidateRoleName: string;
  protectedTableCount: 5;
  forcedRlsTableCount: 5;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  boundaryHandlerTaskKindCount: 1;
  qualifiedHandlerTaskKindCount: 4;
  totalHandlerTaskKindCount: number;
  boundaryCatalogFingerprint: string;
  maximumDiagnosticRows: typeof OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS;
  maximumCandidatesPerRun: typeof OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES;
  supportedRepairFieldCount: typeof SUPPORTED_REPAIR_FIELD_COUNT;
  generatedCandidateLifetimeDays: typeof GENERATED_CANDIDATE_LIFETIME_DAYS;
  serverBoundPrincipalLookup: true;
  serverDerivedEvidencePlan: true;
  serverClockBoundEvaluation: true;
  applicationDeterministicFingerprints: true;
  databaseEvidenceRevalidation: true;
  quarantinedOnly: true;
  generatedCandidatesExecutable: false;
  mutationAuthority: false;
  observerCandidateEvaluationRepositoryParity: true;
  operationalRetentionRepositoryParity: true;
  executionRecoveryRepositoryParity: true;
  notificationRecoveryRepositoryParity: true;
  fullHandlerRepositoryParity: false;
  directTableAccess: false;
  insertAccess: false;
  updateAccess: false;
  deleteAccess: false;
  runtimeAuthority: false;
  productionReady: false;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresObserverCandidateEvaluationCapabilityProjection {
  contractVersion: typeof POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  operationalRetentionContractVersion: typeof POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION;
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
  serverDerivedEvidencePlan: true;
  serverClockBoundEvaluation: true;
  applicationDeterministicFingerprints: true;
  databaseEvidenceRevalidation: true;
  twoPhasePlanApply: true;
  quarantinedOnly: true;
  generatedCandidatesExecutable: false;
  mutationAuthority: false;
  readCommittedTransactionAdapter: true;
  observerCandidateEvaluationRepositoryParity: true;
  operationalRetentionRepositoryParity: true;
  executionRecoveryRepositoryParity: true;
  notificationRecoveryRepositoryParity: true;
  fullHandlerRepositoryParity: false;
  handlerTaskKindCount: 4;
  totalHandlerTaskKindCount: number;
  maximumDiagnosticRows: typeof OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS;
  maximumCandidatesPerRun: typeof OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES;
  supportedRepairFieldCount: typeof SUPPORTED_REPAIR_FIELD_COUNT;
  generatedCandidateLifetimeDays: typeof GENERATED_CANDIDATE_LIFETIME_DAYS;
  protectedTableCount: 5;
  forcedRlsTableCount: 5;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  insertAccess: false;
  updateAccess: false;
  deleteAccess: false;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresObserverCandidateEvaluationResult extends BackgroundTaskResult {
  repairGroupsEvaluated: number;
  matureRepairGroups: number;
  unsupportedMatureSelectors: number;
  selectorsEvaluated: number;
  candidateFieldsEvaluated: number;
  supportedRepairFields: 5;
  candidatesCreated: number;
  candidatesReused: number;
  candidatesDeferred: number;
  expiredCandidates: number;
  reviewedCandidates: number;
  generatedCandidateLifetimeDays: 30;
  mutationAuthority: false;
  generatedCandidatesExecutable: false;
}

export interface NodePostgresObserverCandidateEvaluationDatabaseOptions {
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

interface RoleAuthorityRow extends Record<string, unknown> {
  rolcreaterole: boolean;
  rolsuper: boolean;
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

interface RoutineAclRow extends Record<string, unknown> {
  grantee: string;
  privilegeType: string;
  grantable: boolean;
}

interface ReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  cutover_contract_version: string | number | bigint;
  operational_retention_contract_version: string | number | bigint;
  phase: string;
  read_role_namespace: string;
  session_role_namespace: string;
  queue_write_role_namespace: string;
  control_role_namespace: string;
  notification_recovery_role_namespace: string;
  execution_recovery_role_namespace: string;
  operational_retention_role_namespace: string;
  observer_candidate_role_namespace: string;
  role_manifest_fingerprint: string;
  operational_retention_manifest_fingerprint: string;
  observer_candidate_role_name: string;
  protected_table_count: string | number | bigint;
  forced_rls_table_count: string | number | bigint;
  direct_table_grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  boundary_handler_task_kind_count: string | number | bigint;
  qualified_handler_task_kind_count: string | number | bigint;
  total_handler_task_kind_count: string | number | bigint;
  boundary_catalog_fingerprint: string;
  maximum_diagnostic_rows: string | number | bigint;
  maximum_candidates_per_run: string | number | bigint;
  supported_repair_field_count: string | number | bigint;
  generated_candidate_lifetime_days: string | number | bigint;
  server_bound_principal_lookup: boolean;
  server_derived_evidence_plan: boolean;
  server_clock_bound_evaluation: boolean;
  application_deterministic_fingerprints: boolean;
  database_evidence_revalidation: boolean;
  quarantined_only: boolean;
  generated_candidates_executable: boolean;
  mutation_authority: boolean;
  observer_candidate_evaluation_repository_parity: boolean;
  operational_retention_repository_parity: boolean;
  execution_recovery_repository_parity: boolean;
  notification_recovery_repository_parity: boolean;
  full_handler_repository_parity: boolean;
  direct_table_access: boolean;
  insert_access: boolean;
  update_access: boolean;
  delete_access: boolean;
  runtime_authority: boolean;
  production_ready: boolean;
  applied_at: string;
  verified_at: string;
}

interface BoundaryInspection {
  protectedTableCount: number;
  forcedRlsTableCount: number;
  directTableGrantCount: number;
  functionGrantCount: number;
  membershipCount: number;
  activePrincipalCount: number;
  boundaryCatalogFingerprint: string;
}

interface CandidatePlanItem extends Record<string, unknown> {
  retailerId: SupportedRetailerId;
  layoutFingerprint: string;
  fields: Partial<Record<string, ObserverRecipeFieldInput>>;
  occurrenceCount: number;
  minimumDistinctDeviceCount: number;
  minimumDistinctSkuCount: number;
  selectorCount: number;
  fieldCount: number;
}

interface CandidatePlan extends Record<string, unknown> {
  evaluationTimestamp: string;
  repairGroupsEvaluated: number;
  matureRepairGroups: number;
  unsupportedMatureSelectors: number;
  selectorsEvaluated: number;
  candidateFieldsEvaluated: number;
  supportedRepairFields: number;
  candidatesDeferred: number;
  generatedCandidateLifetimeDays: number;
  selectedCandidates: CandidatePlanItem[];
}

let cachedCapabilityProjection: Readonly<PostgresObserverCandidateEvaluationCapabilityProjection> | null = null;

export class PostgresObserverCandidateEvaluationQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresObserverCandidateEvaluationQualificationError";
  }
}

function schemaName(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate schema is invalid."
    );
  }
  return normalized;
}

function roleNamespace(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate role namespace must contain 3 through 32 lowercase letters, numbers, or underscores."
    );
  }
  return normalized;
}

function observerCandidateRoleName(namespace: string): string {
  const value = `${namespace}_observer_candidate`;
  if (Buffer.byteLength(value, "utf8") > 63) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate role name exceeds 63 bytes."
    );
  }
  return value;
}

function identifier(value: string): string {
  return `"${value}"`;
}

function relation(schema: string, object: string): string {
  return `${identifier(schema)}.${identifier(object)}`;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!INTEGER.test(normalized)) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      `The PostgreSQL observer-candidate ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      `The PostgreSQL observer-candidate ${label} is out of range.`
    );
  }
  return parsed;
}

function exactBoolean<const Expected extends boolean>(
  value: unknown,
  expected: Expected,
  label: string
): Expected {
  if (value !== expected) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      `The PostgreSQL observer-candidate ${label} is inconsistent.`
    );
  }
  return expected;
}

function exactTimestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!TIMESTAMP.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      `The PostgreSQL observer-candidate ${label} is invalid.`
    );
  }
  return normalized;
}

function principalId(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized !== value || Buffer.byteLength(normalized, "utf8") > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      `The PostgreSQL observer-candidate ${label} is invalid.`
    );
  }
  return normalized;
}

function runtimeVersion(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!SEMVER.test(normalized)) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate runtime version is invalid."
    );
  }
  return normalized;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

export function observerCandidateFunctionSource(
  manifest: PostgresObserverCandidateEvaluationManifest
): string {
  const supportedTokens = [
    "pdp", "product", "detail", "buy", "box", "fulfillment", "shipping", "delivery",
    "primary", "main", "add", "to", "cart", "bag", "pre", "preorder", "order",
    "button", "btn", "control", "atc", "submit", "action", "purchase", "state",
    "available", "availability", "unavailable", "inventory", "stock", "in", "out", "sold",
    "price", "amount", "cost", "current", "customer", "sale", "offer", "value",
    "seller", "merchant", "vendor", "display", "name", "by", "fulfilled",
    "ship", "pickup", "pick", "up", "store", "method", "option", "selected",
    "status", "label", "message", "info", "commerce"
  ].map(sqlLiteral).join(", ");
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  evaluation_clock TIMESTAMPTZ;
  evaluation_timestamp TEXT;
  candidate_expires_at TEXT;
  evidence_plan JSONB;
  candidate_payload JSONB;
  planned_candidate JSONB;
  proposed_candidate JSONB;
  proposed_count BIGINT;
  proposed_key_count BIGINT;
  existing_id TEXT;
  existing_retailer_id TEXT;
  existing_recipe_version TEXT;
  existing_minimum_extension_version TEXT;
  existing_recipe_json TEXT;
  existing_recipe_fingerprint TEXT;
  existing_lifecycle_state TEXT;
  existing_provenance_code TEXT;
  existing_expires_at TEXT;
  created_count BIGINT := 0;
  reused_count BIGINT := 0;
  expired_count BIGINT := 0;
  reviewed_count BIGINT := 0;
  audit_data JSONB;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected observer-candidate principal is invalid';
  END IF;
  IF runtime_version !~ '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-candidate runtime version is invalid';
  END IF;
  IF operation_name NOT IN ('plan', 'apply') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-candidate operation is invalid';
  END IF;
  IF pg_catalog.octet_length(candidate_payload_json) > ${MAXIMUM_CANDIDATE_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-candidate payload exceeds its bound';
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
    IF evaluation_timestamp_input <> '' OR candidate_payload_json::jsonb <> '[]'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-candidate plan input is invalid';
    END IF;
    evaluation_clock := pg_catalog.statement_timestamp();
  ELSE
    IF evaluation_timestamp_input !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-candidate evaluation timestamp is invalid';
    END IF;
    evaluation_clock := evaluation_timestamp_input::timestamptz;
    IF pg_catalog.abs(EXTRACT(EPOCH FROM (pg_catalog.statement_timestamp() - evaluation_clock)))
         > ${APPLY_TIMESTAMP_SKEW_SECONDS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-candidate plan expired before apply';
    END IF;
  END IF;
  evaluation_timestamp := pg_catalog.to_char(
    evaluation_clock AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  candidate_expires_at := pg_catalog.to_char(
    (evaluation_clock + interval '${GENERATED_CANDIDATE_LIFETIME_DAYS} days') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yoink_observer_candidate_evaluation_v1:' || resolved_tenant_id || ':' || resolved_user_id,
      0
    )
  );

  WITH recent AS MATERIALIZED (
    SELECT diagnostic.id, diagnostic.device_id, diagnostic.retailer_id,
           diagnostic.retailer_sku, diagnostic.adapter_version,
           diagnostic.operation, diagnostic.outcome, diagnostic.failure_stage,
           diagnostic.reason_code, diagnostic.layout_fingerprint,
           diagnostic.layout_json::jsonb AS layout, diagnostic.received_at
    FROM ${relation(manifest.schemaName, "retailer_adapter_diagnostics")} AS diagnostic
    WHERE diagnostic.tenant_id = resolved_tenant_id
      AND diagnostic.user_id = resolved_user_id
    ORDER BY diagnostic.received_at DESC, diagnostic.id DESC
    LIMIT ${OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS}
  ), repair_groups AS (
    SELECT retailer_id, operation, layout_fingerprint,
           MAX(received_at) AS last_seen_at,
           COUNT(*) FILTER (WHERE outcome IN ('failed', 'recovered')) AS repair_count,
           MAX(received_at) FILTER (WHERE outcome = 'failed') AS last_failure_at,
           MAX(received_at) FILTER (WHERE outcome IN ('passed', 'recovered')) AS last_recovery_at
    FROM recent
    GROUP BY retailer_id, operation, layout_fingerprint
  ), latest_failures AS (
    SELECT DISTINCT ON (retailer_id, operation, layout_fingerprint, retailer_sku)
           retailer_id, operation, layout_fingerprint, retailer_sku,
           adapter_version, received_at
    FROM recent
    WHERE outcome = 'failed'
    ORDER BY retailer_id, operation, layout_fingerprint, retailer_sku,
             received_at DESC, id DESC
  ), superseded_groups AS (
    SELECT failure.retailer_id, failure.operation, failure.layout_fingerprint,
           pg_catalog.bool_and(EXISTS (
             SELECT 1 FROM recent AS replacement
             WHERE replacement.retailer_id = failure.retailer_id
               AND replacement.operation = failure.operation
               AND replacement.retailer_sku = failure.retailer_sku
               AND replacement.received_at > failure.received_at
               AND replacement.outcome <> 'failed'
               AND replacement.adapter_version ~ '^(.*)-v[0-9]+$'
               AND failure.adapter_version ~ '^(.*)-v[0-9]+$'
               AND pg_catalog.substring(replacement.adapter_version, '^(.*)-v[0-9]+$')
                 = pg_catalog.substring(failure.adapter_version, '^(.*)-v[0-9]+$')
               AND pg_catalog.substring(replacement.adapter_version, '-v([0-9]+)$')::BIGINT
                 > pg_catalog.substring(failure.adapter_version, '-v([0-9]+)$')::BIGINT
           )) AS fully_superseded
    FROM latest_failures AS failure
    GROUP BY failure.retailer_id, failure.operation, failure.layout_fingerprint
  ), open_groups AS (
    SELECT repair.retailer_id, repair.operation, repair.layout_fingerprint,
           repair.last_seen_at
    FROM repair_groups AS repair
    LEFT JOIN superseded_groups AS superseded
      USING (retailer_id, operation, layout_fingerprint)
    WHERE repair.repair_count > 0
      AND repair.operation = 'observe'
      AND repair.last_failure_at IS NOT NULL
      AND (repair.last_recovery_at IS NULL OR repair.last_failure_at > repair.last_recovery_at)
      AND NOT COALESCE(superseded.fully_superseded, FALSE)
  ), landmark_rows AS (
    SELECT recent.retailer_id, recent.operation, recent.layout_fingerprint,
           recent.device_id, recent.retailer_sku,
           pg_catalog.jsonb_extract_path_text(landmark.value::jsonb, 'field') AS field_name,
           pg_catalog.jsonb_extract_path_text(landmark.value::jsonb, 'elementKind') AS element_kind,
           pg_catalog.jsonb_extract_path_text(landmark.value::jsonb, 'attribute') AS attribute_name,
           pg_catalog.jsonb_extract_path_text(landmark.value::jsonb, 'value') AS landmark_value,
           (CASE WHEN pg_catalog.jsonb_extract_path_text(
               landmark.value::jsonb, 'elementKind'
             ) = 'role_button'
             THEN '[role=''button'']' ELSE pg_catalog.jsonb_extract_path_text(
               landmark.value::jsonb, 'elementKind'
             ) END)
             || '[' || pg_catalog.jsonb_extract_path_text(landmark.value::jsonb, 'attribute') || '='''
             || pg_catalog.jsonb_extract_path_text(landmark.value::jsonb, 'value') || ''']' AS selector
    FROM recent
    JOIN open_groups USING (retailer_id, operation, layout_fingerprint)
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(pg_catalog.jsonb_extract_path(
          recent.layout::jsonb, 'repairLandmarks'
        )) = 'array'
        THEN pg_catalog.jsonb_extract_path(recent.layout::jsonb, 'repairLandmarks')
        ELSE '[]'::jsonb END
    ) AS landmark(value)
    WHERE recent.operation = 'observe' AND recent.outcome = 'failed'
      AND recent.reason_code IN (
        'availability_selector_miss', 'add_control_selector_miss',
        'price_selector_miss', 'seller_selector_miss', 'fulfillment_selector_miss'
      )
  ), ready_suggestions AS (
    SELECT retailer_id, operation, layout_fingerprint, field_name,
           element_kind, attribute_name, landmark_value, selector,
           COUNT(*) AS occurrence_count,
           COUNT(DISTINCT device_id) AS distinct_device_count,
           COUNT(DISTINCT retailer_sku) AS distinct_sku_count
    FROM landmark_rows
    GROUP BY retailer_id, operation, layout_fingerprint, field_name,
             element_kind, attribute_name, landmark_value, selector
    HAVING COUNT(DISTINCT device_id) >= 3 AND COUNT(DISTINCT retailer_sku) >= 2
  ), supported_suggestions AS (
    SELECT * FROM ready_suggestions AS suggestion
    WHERE suggestion.field_name IN ('availability', 'unitPrice', 'seller', 'fulfillment', 'addControl')
      AND suggestion.element_kind IN ('button', 'input', 'role_button', 'div', 'span', 'p', 'label', 'section', 'li')
      AND NOT (suggestion.field_name = 'addControl'
        AND suggestion.element_kind NOT IN ('button', 'input', 'role_button'))
      AND NOT (suggestion.field_name <> 'addControl' AND suggestion.element_kind = 'input')
      AND suggestion.attribute_name IN (
        'data-testid', 'data-test-id', 'data-automation-id', 'data-button-state', 'name', 'itemprop'
      )
      AND suggestion.landmark_value ~ '^[A-Za-z][A-Za-z0-9_.-]{1,63}$'
      AND suggestion.landmark_value !~* '(checkout|buy[_.:-]?now|place[_.:-]?order|submit[_.:-]?order|payment|credit|debit|address|email|phone|account|password|cookie|csrf|token)'
      AND CASE suggestion.field_name
        WHEN 'availability' THEN suggestion.landmark_value ~* '(availability|available|unavailable|inventory|stock|sold[_.-]?out|pre[_.-]?order)'
        WHEN 'unitPrice' THEN suggestion.landmark_value ~* '(price|amount|cost|sale[_.-]?price|customer[_.-]?price|offer[_.-]?price)'
        WHEN 'seller' THEN suggestion.landmark_value ~* '(seller|merchant|vendor|sold[_.-]?by)'
        WHEN 'fulfillment' THEN suggestion.landmark_value ~* '(fulfillment|shipping|delivery|pickup|pick[_.-]?up|ship[_.-]?to)'
        WHEN 'addControl' THEN suggestion.landmark_value ~* '(add|cart|bag|pre[_.-]?order|atc)'
        ELSE FALSE
      END
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(pg_catalog.regexp_split_to_array(
          pg_catalog.lower(suggestion.landmark_value), '[_.-]+'
        )) AS token(value)
        WHERE token.value <> '' AND token.value <> ALL(ARRAY[${supportedTokens}]::text[])
      )
  ), field_groups AS (
    SELECT retailer_id, operation, layout_fingerprint, field_name,
           CASE WHEN field_name = 'addControl' THEN 'disabled_state' ELSE 'text' END AS field_mode,
           pg_catalog.jsonb_agg(selector ORDER BY selector) AS selectors,
           SUM(occurrence_count) AS occurrence_count,
           MIN(distinct_device_count) AS minimum_distinct_device_count,
           MIN(distinct_sku_count) AS minimum_distinct_sku_count
    FROM supported_suggestions
    GROUP BY retailer_id, operation, layout_fingerprint, field_name
  ), candidate_groups AS (
    SELECT field.retailer_id, field.operation, field.layout_fingerprint,
           opened.last_seen_at,
           pg_catalog.jsonb_object_agg(
             field.field_name,
             pg_catalog.jsonb_build_object('mode', field.field_mode, 'selectors', field.selectors)
           ) AS fields,
           SUM(field.occurrence_count) AS occurrence_count,
           MIN(field.minimum_distinct_device_count) AS minimum_distinct_device_count,
           MIN(field.minimum_distinct_sku_count) AS minimum_distinct_sku_count,
           SUM(pg_catalog.jsonb_array_length(field.selectors)) AS selector_count,
           COUNT(*) AS field_count
    FROM field_groups AS field
    JOIN open_groups AS opened USING (retailer_id, operation, layout_fingerprint)
    GROUP BY field.retailer_id, field.operation, field.layout_fingerprint, opened.last_seen_at
  ), selected_candidates AS (
    SELECT * FROM candidate_groups
    ORDER BY last_seen_at DESC, retailer_id, layout_fingerprint
    LIMIT ${OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES}
  )
  SELECT pg_catalog.jsonb_build_object(
    'evaluationTimestamp', evaluation_timestamp,
    'repairGroupsEvaluated', (SELECT COUNT(*) FROM repair_groups WHERE repair_count > 0),
    'matureRepairGroups', (SELECT COUNT(*) FROM candidate_groups),
    'unsupportedMatureSelectors',
      (SELECT COUNT(*) FROM ready_suggestions) - (SELECT COUNT(*) FROM supported_suggestions),
    'selectorsEvaluated', COALESCE((SELECT SUM(selector_count) FROM selected_candidates), 0),
    'candidateFieldsEvaluated', COALESCE((SELECT SUM(field_count) FROM selected_candidates), 0),
    'supportedRepairFields', ${SUPPORTED_REPAIR_FIELD_COUNT},
    'candidatesDeferred', GREATEST(
      0,
      (SELECT COUNT(*) FROM candidate_groups) - ${OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES}
    ),
    'generatedCandidateLifetimeDays', ${GENERATED_CANDIDATE_LIFETIME_DAYS},
    'selectedCandidates', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'retailerId', retailer_id,
        'layoutFingerprint', layout_fingerprint,
        'fields', fields,
        'occurrenceCount', occurrence_count,
        'minimumDistinctDeviceCount', minimum_distinct_device_count,
        'minimumDistinctSkuCount', minimum_distinct_sku_count,
        'selectorCount', selector_count,
        'fieldCount', field_count
      ) ORDER BY last_seen_at DESC, retailer_id, layout_fingerprint)
      FROM selected_candidates
    ), '[]'::jsonb)
  ) INTO evidence_plan;

  IF operation_name = 'plan' THEN
    RETURN QUERY SELECT evidence_plan::text;
    RETURN;
  END IF;

  candidate_payload := candidate_payload_json::jsonb;
  IF pg_catalog.jsonb_typeof(candidate_payload) <> 'array'
    OR pg_catalog.jsonb_array_length(candidate_payload)
      <> pg_catalog.jsonb_array_length(evidence_plan->'selectedCandidates')
    OR pg_catalog.jsonb_array_length(candidate_payload)
      > ${OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-candidate apply set does not match its evidence plan';
  END IF;

  FOR planned_candidate IN
    SELECT value FROM pg_catalog.jsonb_array_elements(evidence_plan->'selectedCandidates') AS item(value)
  LOOP
    SELECT COUNT(*), MIN(item.value::text)::jsonb
      INTO proposed_count, proposed_candidate
    FROM pg_catalog.jsonb_array_elements(candidate_payload) AS item(value)
    WHERE item.value->>'retailerId' = planned_candidate->>'retailerId'
      AND item.value->>'layoutFingerprint' = planned_candidate->>'layoutFingerprint';
    IF proposed_count <> 1 OR proposed_candidate IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-candidate apply item is missing or duplicated';
    END IF;
    SELECT COUNT(*) INTO proposed_key_count
    FROM pg_catalog.jsonb_object_keys(proposed_candidate);
    IF proposed_key_count <> 17
      OR NOT proposed_candidate ?& ARRAY[
        'retailerId', 'layoutFingerprint', 'fields', 'minimumExtensionVersion',
        'occurrenceCount', 'minimumDistinctDeviceCount', 'minimumDistinctSkuCount',
        'selectorCount', 'fieldCount', 'recipeVersion', 'recipeJson',
        'recipeFingerprint', 'candidateId', 'lifecycleEventId',
        'lifecycleEventHash', 'auditId', 'outboxId'
      ]::text[]
      OR proposed_candidate->'fields' <> planned_candidate->'fields'
      OR proposed_candidate->>'minimumExtensionVersion' <> runtime_version
      OR proposed_candidate->>'occurrenceCount' <> planned_candidate->>'occurrenceCount'
      OR proposed_candidate->>'minimumDistinctDeviceCount' <> planned_candidate->>'minimumDistinctDeviceCount'
      OR proposed_candidate->>'minimumDistinctSkuCount' <> planned_candidate->>'minimumDistinctSkuCount'
      OR proposed_candidate->>'selectorCount' <> planned_candidate->>'selectorCount'
      OR proposed_candidate->>'fieldCount' <> planned_candidate->>'fieldCount'
      OR proposed_candidate->>'recipeJson' = ''
      OR pg_catalog.octet_length(proposed_candidate->>'recipeJson') > 12_000
      OR (proposed_candidate->>'recipeJson')::jsonb <> planned_candidate->'fields'
      OR (proposed_candidate->>'recipeVersion')
        !~ ('^' || (planned_candidate->>'retailerId') || '-repair-[a-f0-9]{12}$')
      OR proposed_candidate->>'recipeFingerprint' !~ '^[a-f0-9]{64}$'
      OR proposed_candidate->>'candidateId' !~ '^observer_recipe_[a-f0-9]{32}$'
      OR proposed_candidate->>'lifecycleEventId' !~ '^observer_recipe_event_[a-f0-9]{32}$'
      OR proposed_candidate->>'lifecycleEventHash' !~ '^[a-f0-9]{64}$'
      OR proposed_candidate->>'auditId' !~ '^audit_[a-f0-9]{32}$'
      OR proposed_candidate->>'outboxId' !~ '^outbox_[a-f0-9]{32}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observer-candidate apply item failed evidence revalidation';
    END IF;

    existing_id := NULL;
    SELECT candidate.id, candidate.retailer_id, candidate.recipe_version,
           candidate.minimum_extension_version, candidate.recipe_json,
           candidate.recipe_fingerprint, candidate.lifecycle_state,
           candidate.provenance_code, candidate.expires_at
      INTO existing_id, existing_retailer_id, existing_recipe_version,
           existing_minimum_extension_version, existing_recipe_json,
           existing_recipe_fingerprint, existing_lifecycle_state,
           existing_provenance_code, existing_expires_at
    FROM ${relation(manifest.schemaName, "observer_recipe_candidates")} AS candidate
    WHERE candidate.tenant_id = resolved_tenant_id
      AND candidate.recipe_fingerprint = proposed_candidate->>'recipeFingerprint'
    FOR UPDATE;
    IF existing_id IS NOT NULL THEN
      IF existing_retailer_id <> planned_candidate->>'retailerId'
        OR existing_recipe_version <> proposed_candidate->>'recipeVersion'
        OR existing_minimum_extension_version <> runtime_version
        OR existing_recipe_json <> proposed_candidate->>'recipeJson'
        OR existing_recipe_fingerprint <> proposed_candidate->>'recipeFingerprint'
        OR existing_provenance_code <> ${sqlLiteral(GENERATED_REPAIR_PROVENANCE)} THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'observer-candidate fingerprint conflicts with durable state';
      END IF;
      reused_count := reused_count + 1;
      IF existing_expires_at <= evaluation_timestamp THEN expired_count := expired_count + 1; END IF;
      IF existing_lifecycle_state <> 'quarantined' THEN reviewed_count := reviewed_count + 1; END IF;
    ELSE
      INSERT INTO ${relation(manifest.schemaName, "observer_recipe_candidates")}(
        id, tenant_id, user_id, retailer_id, recipe_version,
        minimum_extension_version, recipe_json, recipe_fingerprint,
        lifecycle_state, rollback_recipe_id, kill_switch, provenance_code,
        signature_key_id, signature, signed_at, expires_at, disabled_reason,
        created_at, updated_at, trust_manifest_generation, trust_manifest_hash
      ) VALUES (
        proposed_candidate->>'candidateId', resolved_tenant_id, resolved_user_id,
        planned_candidate->>'retailerId', proposed_candidate->>'recipeVersion',
        runtime_version, proposed_candidate->>'recipeJson',
        proposed_candidate->>'recipeFingerprint', 'quarantined', '', 0,
        ${sqlLiteral(GENERATED_REPAIR_PROVENANCE)}, '', '', '', candidate_expires_at,
        '', evaluation_timestamp, evaluation_timestamp, 0, ''
      );
      INSERT INTO ${relation(manifest.schemaName, "observer_recipe_lifecycle_events")}(
        id, tenant_id, user_id, recipe_id, from_state, to_state,
        reason_code, event_hash, created_at
      ) VALUES (
        proposed_candidate->>'lifecycleEventId', resolved_tenant_id, resolved_user_id,
        proposed_candidate->>'candidateId', '', 'quarantined', ${sqlLiteral(LIFECYCLE_REASON)},
        proposed_candidate->>'lifecycleEventHash', evaluation_timestamp
      );
      audit_data := pg_catalog.jsonb_build_object(
        'retailerId', planned_candidate->>'retailerId',
        'layoutFingerprint', planned_candidate->>'layoutFingerprint',
        'recipeFingerprint', proposed_candidate->>'recipeFingerprint',
        'fieldCount', (planned_candidate->>'fieldCount')::BIGINT,
        'selectorCount', (planned_candidate->>'selectorCount')::BIGINT,
        'occurrenceCount', (planned_candidate->>'occurrenceCount')::BIGINT,
        'minimumDistinctDeviceCount', (planned_candidate->>'minimumDistinctDeviceCount')::BIGINT,
        'minimumDistinctSkuCount', (planned_candidate->>'minimumDistinctSkuCount')::BIGINT,
        'generated', TRUE, 'executable', FALSE, 'mutationAuthority', FALSE
      );
      INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
        id, tenant_id, user_id, correlation_id, event_type,
        reason_code, message, data_json, created_at
      ) VALUES (
        proposed_candidate->>'auditId', resolved_tenant_id, resolved_user_id,
        proposed_candidate->>'candidateId', ${sqlLiteral(AUDIT_EVENT_TYPE)}, 'quarantined',
        ${sqlLiteral(GENERATED_REPAIR_CANDIDATE_AUDIT_MESSAGE)}, audit_data::text,
        evaluation_timestamp
      );
      INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
        id, tenant_id, aggregate_type, aggregate_id, event_type,
        payload_json, created_at, delivered_at
      ) VALUES (
        proposed_candidate->>'outboxId', resolved_tenant_id, 'observer_recipe',
        proposed_candidate->>'candidateId', ${sqlLiteral(AUDIT_EVENT_TYPE)},
        pg_catalog.jsonb_build_object(
          'auditId', proposed_candidate->>'auditId',
          'correlationId', proposed_candidate->>'candidateId',
          'reasonCode', 'quarantined',
          'message', ${sqlLiteral(GENERATED_REPAIR_CANDIDATE_AUDIT_MESSAGE)},
          'data', audit_data
        )::text,
        evaluation_timestamp, ''
      );
      created_count := created_count + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'repairGroupsEvaluated', evidence_plan->'repairGroupsEvaluated',
    'matureRepairGroups', evidence_plan->'matureRepairGroups',
    'unsupportedMatureSelectors', evidence_plan->'unsupportedMatureSelectors',
    'selectorsEvaluated', evidence_plan->'selectorsEvaluated',
    'candidateFieldsEvaluated', evidence_plan->'candidateFieldsEvaluated',
    'supportedRepairFields', ${SUPPORTED_REPAIR_FIELD_COUNT},
    'candidatesCreated', created_count,
    'candidatesReused', reused_count,
    'candidatesDeferred', evidence_plan->'candidatesDeferred',
    'expiredCandidates', expired_count,
    'reviewedCandidates', reviewed_count,
    'generatedCandidateLifetimeDays', ${GENERATED_CANDIDATE_LIFETIME_DAYS},
    'mutationAuthority', FALSE,
    'generatedCandidatesExecutable', FALSE
  )::text;
END
`;
}

export function buildPostgresObserverCandidateEvaluationManifest(
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification",
  requestedObserverCandidateRoleNamespace = "yoink_candidate_qualification"
): PostgresObserverCandidateEvaluationManifest {
  const schema = schemaName(requestedSchema);
  const readNamespace = roleNamespace(requestedReadRoleNamespace, "yoink_qualification");
  const sessionNamespace = roleNamespace(
    requestedSessionRoleNamespace,
    "yoink_session_qualification"
  );
  const queueNamespace = roleNamespace(
    requestedQueueWriteRoleNamespace,
    "yoink_queue_write_qualification"
  );
  const controlNamespace = roleNamespace(
    requestedControlRoleNamespace,
    "yoink_control_qualification"
  );
  const notificationNamespace = roleNamespace(
    requestedNotificationRecoveryRoleNamespace,
    "yoink_notify_qualification"
  );
  const executionNamespace = roleNamespace(
    requestedExecutionRecoveryRoleNamespace,
    "yoink_execute_qualification"
  );
  const retentionNamespace = roleNamespace(
    requestedOperationalRetentionRoleNamespace,
    "yoink_retention_qualification"
  );
  const candidateNamespace = roleNamespace(
    requestedObserverCandidateRoleNamespace,
    "yoink_candidate_qualification"
  );
  if (new Set([
    readNamespace,
    sessionNamespace,
    queueNamespace,
    controlNamespace,
    notificationNamespace,
    executionNamespace,
    retentionNamespace,
    candidateNamespace
  ]).size !== 8) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL read, session, queue-write, worker-control, notification-recovery, execution-recovery, operational-retention, and observer-candidate namespaces must be distinct."
    );
  }
  const retentionManifest = buildPostgresOperationalRetentionManifest(
    schema,
    readNamespace,
    sessionNamespace,
    queueNamespace,
    controlNamespace,
    notificationNamespace,
    executionNamespace,
    retentionNamespace
  );
  const withoutFingerprint: Omit<PostgresObserverCandidateEvaluationManifest, "fingerprint"> = {
    contractVersion: POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    operationalRetentionContractVersion: POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION,
    schemaName: schema,
    readRoleNamespace: readNamespace,
    sessionRoleNamespace: sessionNamespace,
    queueWriteRoleNamespace: queueNamespace,
    controlRoleNamespace: controlNamespace,
    notificationRecoveryRoleNamespace: notificationNamespace,
    executionRecoveryRoleNamespace: executionNamespace,
    operationalRetentionRoleNamespace: retentionNamespace,
    observerCandidateRoleNamespace: candidateNamespace,
    operationalRetentionManifestFingerprint: retentionManifest.fingerprint,
    observerCandidateRole: {
      kind: "observer_recipe_candidate_evaluation_handler",
      name: observerCandidateRoleName(candidateNamespace),
      functionName: POSTGRES_OBSERVER_CANDIDATE_EVALUATION_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTableNames: [...PROTECTED_TABLES],
      forcedRlsTableNames: [...PROTECTED_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false,
      insertAccess: false,
      updateAccess: false,
      deleteAccess: false
    },
    protectedTableCount: 5,
    forcedRlsTableCount: 5,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    boundaryHandlerTaskKinds: [...BOUNDARY_HANDLER_TASK_KINDS],
    boundaryHandlerTaskKindCount: 1,
    qualifiedHandlerTaskKinds: [...QUALIFIED_HANDLER_TASK_KINDS],
    qualifiedHandlerTaskKindCount: 4,
    totalHandlerTaskKindCount: BACKGROUND_TASK_KINDS.length,
    maximumDiagnosticRows: OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS,
    maximumCandidatesPerRun: OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES,
    supportedRepairFieldCount: SUPPORTED_REPAIR_FIELD_COUNT,
    generatedCandidateLifetimeDays: GENERATED_CANDIDATE_LIFETIME_DAYS,
    serverDerivedEvidencePlan: true,
    serverClockBoundEvaluation: true,
    applicationDeterministicFingerprints: true,
    databaseEvidenceRevalidation: true,
    quarantinedOnly: true,
    generatedCandidatesExecutable: false,
    mutationAuthority: false,
    observerCandidateEvaluationRepositoryParity: true,
    operationalRetentionRepositoryParity: true,
    executionRecoveryRepositoryParity: true,
    notificationRecoveryRepositoryParity: true,
    fullHandlerRepositoryParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresObserverCandidateEvaluationCapabilityProjection():
PostgresObserverCandidateEvaluationCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresObserverCandidateEvaluationManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    operationalRetentionContractVersion: POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION,
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
    serverDerivedEvidencePlan: true,
    serverClockBoundEvaluation: true,
    applicationDeterministicFingerprints: true,
    databaseEvidenceRevalidation: true,
    twoPhasePlanApply: true,
    quarantinedOnly: true,
    generatedCandidatesExecutable: false,
    mutationAuthority: false,
    readCommittedTransactionAdapter: true,
    observerCandidateEvaluationRepositoryParity: true,
    operationalRetentionRepositoryParity: true,
    executionRecoveryRepositoryParity: true,
    notificationRecoveryRepositoryParity: true,
    fullHandlerRepositoryParity: false,
    handlerTaskKindCount: 4,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    maximumDiagnosticRows: OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS,
    maximumCandidatesPerRun: OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES,
    supportedRepairFieldCount: SUPPORTED_REPAIR_FIELD_COUNT,
    generatedCandidateLifetimeDays: GENERATED_CANDIDATE_LIFETIME_DAYS,
    protectedTableCount: 5,
    forcedRlsTableCount: 5,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    insertAccess: false,
    updateAccess: false,
    deleteAccess: false,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

async function inspectBoundary(
  session: PostgresQuerySession,
  manifest: PostgresObserverCandidateEvaluationManifest
): Promise<BoundaryInspection> {
  const role = manifest.observerCandidateRole.name;
  const roleResult = await session.query<RoleRow>(
    `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles WHERE rolname = $1`,
    [role]
  );
  const roleRow = roleResult.rows[0];
  if (roleResult.rows.length !== 1 || !roleRow
    || roleRow.rolsuper || roleRow.rolinherit || roleRow.rolcreaterole
    || roleRow.rolcreatedb || roleRow.rolcanlogin || roleRow.rolreplication
    || roleRow.rolbypassrls) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate role is missing or has an unsafe role attribute."
    );
  }
  const memberships = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM pg_catalog.pg_auth_members membership
     JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid
     JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
     WHERE granted_role.rolname = $1 OR member_role.rolname = $1`,
    [role]
  );
  const membershipCount = exactInteger(memberships.rows[0]?.count, "membership count");
  if (membershipCount !== 0) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate role must not have an active membership."
    );
  }
  const directTableGrants = await session.query<{ count: string | number | bigint }>(
    `SELECT (
       SELECT COUNT(*) FROM information_schema.role_table_grants
       WHERE table_schema = $1 AND grantee = $2
     ) + (
       SELECT COUNT(*) FROM information_schema.role_column_grants
       WHERE table_schema = $1 AND grantee = $2
     ) AS count`,
    [manifest.schemaName, role]
  );
  const directTableGrantCount = exactInteger(
    directTableGrants.rows[0]?.count,
    "direct table-grant count"
  );
  if (directTableGrantCount !== 0) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate role must not have a direct table or column grant."
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
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate role has an unauthorized effective table privilege."
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
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate role has an unauthorized effective column privilege."
    );
  }
  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate role has an invalid schema privilege."
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
    || routine.routineName !== manifest.observerCandidateRole.functionName
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE
    || routine.volatility !== "v" || routine.securityDefiner !== true
    || routine.strict !== true || routine.leakproof !== false
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role
    || routine.source !== observerCandidateFunctionSource(manifest)) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate function boundary is incomplete."
    );
  }
  const routineAcl = await session.query<RoutineAclRow>(
    `SELECT COALESCE(grantee_role.rolname, 'PUBLIC') AS grantee,
            access.privilege_type AS "privilegeType",
            access.is_grantable AS grantable
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
      && row.privilegeType === "EXECUTE" && row.grantable === false)
    || !routineAcl.rows.some((row) => row.grantee === routine.ownerName
      && row.privilegeType === "EXECUTE" && row.grantable === false)
    || routineAcl.rows.some((row) => row.grantee === "PUBLIC")) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate function grant is not exact."
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
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate role must not access application-schema sequences."
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
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate role must not own application-schema objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate role must not depend on direct table policies."
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
  const forcedRows = rls.rows.filter((row) => row.enabled && row.forced);
  if (rls.rows.length !== manifest.protectedTableCount
    || rls.rows.map((row) => row.tableName).join(",") !== [...PROTECTED_TABLES].join(",")
    || forcedRows.map((row) => row.tableName).join(",") !== [...PROTECTED_TABLES].join(",")) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate protected-table scope is incomplete."
    );
  }
  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  const activePrincipalCount = exactInteger(principals.rows[0]?.count, "active principal count");
  if (activePrincipalCount !== 0) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "Observer-candidate qualification cannot activate a runtime principal."
    );
  }
  return {
    protectedTableCount: rls.rows.length,
    forcedRlsTableCount: forcedRows.length,
    directTableGrantCount,
    functionGrantCount: routines.rows.length,
    membershipCount,
    activePrincipalCount,
    boundaryCatalogFingerprint: fingerprint({
      role: roleRow,
      routine,
      routineAcl: routineAcl.rows,
      protectedTables: rls.rows
    })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresObserverCandidateEvaluationManifest
): PostgresObserverCandidateEvaluationQualificationReceipt {
  if (row.phase !== "verified"
    || row.read_role_namespace !== manifest.readRoleNamespace
    || row.session_role_namespace !== manifest.sessionRoleNamespace
    || row.queue_write_role_namespace !== manifest.queueWriteRoleNamespace
    || row.control_role_namespace !== manifest.controlRoleNamespace
    || row.notification_recovery_role_namespace !== manifest.notificationRecoveryRoleNamespace
    || row.execution_recovery_role_namespace !== manifest.executionRecoveryRoleNamespace
    || row.operational_retention_role_namespace !== manifest.operationalRetentionRoleNamespace
    || row.observer_candidate_role_namespace !== manifest.observerCandidateRoleNamespace
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.operational_retention_manifest_fingerprint
      !== manifest.operationalRetentionManifestFingerprint
    || row.observer_candidate_role_name !== manifest.observerCandidateRole.name
    || !SHA256.test(row.boundary_catalog_fingerprint)
    || row.server_bound_principal_lookup !== true
    || row.server_derived_evidence_plan !== true
    || row.server_clock_bound_evaluation !== true
    || row.application_deterministic_fingerprints !== true
    || row.database_evidence_revalidation !== true
    || row.quarantined_only !== true
    || row.generated_candidates_executable !== false
    || row.mutation_authority !== false
    || row.observer_candidate_evaluation_repository_parity !== true
    || row.operational_retention_repository_parity !== true
    || row.execution_recovery_repository_parity !== true
    || row.notification_recovery_repository_parity !== true
    || row.full_handler_repository_parity !== false
    || row.direct_table_access !== false || row.insert_access !== false
    || row.update_access !== false || row.delete_access !== false
    || row.runtime_authority !== false || row.production_ready !== false) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate receipt is incomplete or unsafe."
    );
  }
  if (exactInteger(row.contract_version, "contract version")
      !== POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION
    || exactInteger(row.cutover_contract_version, "cutover contract version")
      !== POSTGRES_CUTOVER_CONTRACT_VERSION
    || exactInteger(row.operational_retention_contract_version, "operational-retention contract version")
      !== POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION
    || exactInteger(row.protected_table_count, "protected table count") !== 5
    || exactInteger(row.forced_rls_table_count, "forced-RLS table count") !== 5
    || exactInteger(row.direct_table_grant_count, "direct table-grant count") !== 0
    || exactInteger(row.function_grant_count, "function grant count") !== 1
    || exactInteger(row.membership_count, "membership count") !== 0
    || exactInteger(row.active_principal_count, "active principal count") !== 0
    || exactInteger(row.boundary_handler_task_kind_count, "boundary handler task-kind count") !== 1
    || exactInteger(row.qualified_handler_task_kind_count, "qualified handler task-kind count") !== 4
    || exactInteger(row.total_handler_task_kind_count, "total handler task-kind count")
      !== manifest.totalHandlerTaskKindCount
    || exactInteger(row.maximum_diagnostic_rows, "maximum diagnostic-row count")
      !== OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS
    || exactInteger(row.maximum_candidates_per_run, "maximum candidate count")
      !== OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES
    || exactInteger(row.supported_repair_field_count, "supported repair-field count")
      !== SUPPORTED_REPAIR_FIELD_COUNT
    || exactInteger(row.generated_candidate_lifetime_days, "candidate lifetime")
      !== GENERATED_CANDIDATE_LIFETIME_DAYS) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate receipt uses an unsupported or active contract."
    );
  }
  return {
    contractVersion: POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    operationalRetentionContractVersion: POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION,
    phase: "verified",
    schemaName: manifest.schemaName,
    readRoleNamespace: manifest.readRoleNamespace,
    sessionRoleNamespace: manifest.sessionRoleNamespace,
    queueWriteRoleNamespace: manifest.queueWriteRoleNamespace,
    controlRoleNamespace: manifest.controlRoleNamespace,
    notificationRecoveryRoleNamespace: manifest.notificationRecoveryRoleNamespace,
    executionRecoveryRoleNamespace: manifest.executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace: manifest.operationalRetentionRoleNamespace,
    observerCandidateRoleNamespace: manifest.observerCandidateRoleNamespace,
    roleManifestFingerprint: row.role_manifest_fingerprint,
    operationalRetentionManifestFingerprint: row.operational_retention_manifest_fingerprint,
    observerCandidateRoleName: row.observer_candidate_role_name,
    protectedTableCount: 5,
    forcedRlsTableCount: 5,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    boundaryHandlerTaskKindCount: 1,
    qualifiedHandlerTaskKindCount: 4,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    maximumDiagnosticRows: OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS,
    maximumCandidatesPerRun: OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES,
    supportedRepairFieldCount: SUPPORTED_REPAIR_FIELD_COUNT,
    generatedCandidateLifetimeDays: GENERATED_CANDIDATE_LIFETIME_DAYS,
    serverBoundPrincipalLookup: true,
    serverDerivedEvidencePlan: true,
    serverClockBoundEvaluation: true,
    applicationDeterministicFingerprints: true,
    databaseEvidenceRevalidation: true,
    quarantinedOnly: true,
    generatedCandidatesExecutable: false,
    mutationAuthority: false,
    observerCandidateEvaluationRepositoryParity: true,
    operationalRetentionRepositoryParity: true,
    executionRecoveryRepositoryParity: true,
    notificationRecoveryRepositoryParity: true,
    fullHandlerRepositoryParity: false,
    directTableAccess: false,
    insertAccess: false,
    updateAccess: false,
    deleteAccess: false,
    runtimeAuthority: false,
    productionReady: false,
    appliedAt: row.applied_at,
    verifiedAt: row.verified_at
  };
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresObserverCandidateEvaluationManifest
): Promise<PostgresObserverCandidateEvaluationQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(
      manifest.schemaName,
      POSTGRES_OBSERVER_CANDIDATE_EVALUATION_RECEIPT_TABLE
    )} WHERE id = 'active'`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresObserverCandidateEvaluationQualificationReceipt,
  manifest: PostgresObserverCandidateEvaluationManifest
): void {
  if (inspection.protectedTableCount !== receipt.protectedTableCount
    || inspection.forcedRlsTableCount !== receipt.forcedRlsTableCount
    || inspection.directTableGrantCount !== receipt.directTableGrantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.roleManifestFingerprint !== manifest.fingerprint) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresObserverCandidateEvaluationBoundary(
  database: PostgresCutoverDatabase,
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification",
  requestedObserverCandidateRoleNamespace = "yoink_candidate_qualification"
): Promise<PostgresObserverCandidateEvaluationQualificationReceipt> {
  const manifest = buildPostgresObserverCandidateEvaluationManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace,
    requestedObserverCandidateRoleNamespace
  );
  await verifyPostgresOperationalRetentionBoundary(
    database,
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace,
    manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresObserverCandidateEvaluationBoundary(
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
  now = Date.now()
): Promise<PostgresObserverCandidateEvaluationQualificationReceipt> {
  const manifest = buildPostgresObserverCandidateEvaluationManifest(
    requestedSchema,
    requestedReadRoleNamespace,
    requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace,
    requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace,
    requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace,
    requestedObserverCandidateRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "Observer-candidate qualification requires the supported cutover/control role with BYPASSRLS."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    "SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user"
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "Observer-candidate qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresOperationalRetentionBoundary(
    database,
    manifest.schemaName,
    manifest.readRoleNamespace,
    manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace,
    manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace
  );
  const appliedAt = new Date(now).toISOString();
  return database.transaction(async (session) => {
    const existing = await session.query<{ count: string | number | bigint }>(
      `SELECT (
         SELECT COUNT(*) FROM pg_catalog.pg_roles WHERE rolname = $1
       ) + (
         SELECT COUNT(*) FROM pg_catalog.pg_class object
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace
         WHERE namespace.nspname = $2 AND object.relname = $3
       ) + (
         SELECT COUNT(*) FROM pg_catalog.pg_proc routine
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
         WHERE namespace.nspname = $2 AND routine.proname = ANY($4::text[])
       ) AS count`,
      [
        manifest.observerCandidateRole.name,
        manifest.schemaName,
        POSTGRES_OBSERVER_CANDIDATE_EVALUATION_RECEIPT_TABLE,
        [
          POSTGRES_OBSERVER_CANDIDATE_EVALUATION_FUNCTION,
          "yoink_observer_candidate_evaluation_receipt_guard"
        ]
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing boundary object count") !== 0) {
      throw new PostgresObserverCandidateEvaluationQualificationError(
        "Observer-candidate qualification refuses an existing role, function, guard, or receipt."
      );
    }
    await session.query(
      `CREATE ROLE ${identifier(manifest.observerCandidateRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.observerCandidateRole.name)}`
    );
    await session.query(
      `CREATE FUNCTION ${relation(
        manifest.schemaName,
        POSTGRES_OBSERVER_CANDIDATE_EVALUATION_FUNCTION
      )}(
         expected_tenant_id TEXT, expected_user_id TEXT, runtime_version TEXT,
         operation_name TEXT, evaluation_timestamp_input TEXT,
         candidate_payload_json TEXT
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${observerCandidateFunctionSource(manifest)}$yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${relation(
        manifest.schemaName,
        POSTGRES_OBSERVER_CANDIDATE_EVALUATION_FUNCTION
      )}(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC`
    );
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${relation(
        manifest.schemaName,
        POSTGRES_OBSERVER_CANDIDATE_EVALUATION_FUNCTION
      )}(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
       TO ${identifier(manifest.observerCandidateRole.name)}`
    );
    await session.query(
      `CREATE TABLE ${relation(
        manifest.schemaName,
        POSTGRES_OBSERVER_CANDIDATE_EVALUATION_RECEIPT_TABLE
      )} (
        id TEXT PRIMARY KEY CHECK (id = 'active'),
        contract_version BIGINT NOT NULL CHECK (
          contract_version = ${POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION}
        ),
        cutover_contract_version BIGINT NOT NULL CHECK (
          cutover_contract_version = ${POSTGRES_CUTOVER_CONTRACT_VERSION}
        ),
        operational_retention_contract_version BIGINT NOT NULL CHECK (
          operational_retention_contract_version = ${POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION}
        ),
        phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
        read_role_namespace TEXT NOT NULL,
        session_role_namespace TEXT NOT NULL,
        queue_write_role_namespace TEXT NOT NULL,
        control_role_namespace TEXT NOT NULL,
        notification_recovery_role_namespace TEXT NOT NULL,
        execution_recovery_role_namespace TEXT NOT NULL,
        operational_retention_role_namespace TEXT NOT NULL,
        observer_candidate_role_namespace TEXT NOT NULL,
        role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
        operational_retention_manifest_fingerprint TEXT NOT NULL CHECK (
          operational_retention_manifest_fingerprint ~ '^[a-f0-9]{64}$'
        ),
        observer_candidate_role_name TEXT NOT NULL,
        protected_table_count BIGINT NOT NULL,
        forced_rls_table_count BIGINT NOT NULL,
        direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
        function_grant_count BIGINT NOT NULL,
        membership_count BIGINT NOT NULL CHECK (membership_count = 0),
        active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
        boundary_handler_task_kind_count BIGINT NOT NULL CHECK (boundary_handler_task_kind_count = 1),
        qualified_handler_task_kind_count BIGINT NOT NULL CHECK (qualified_handler_task_kind_count = 4),
        total_handler_task_kind_count BIGINT NOT NULL,
        boundary_catalog_fingerprint TEXT NOT NULL CHECK (boundary_catalog_fingerprint ~ '^[a-f0-9]{64}$'),
        maximum_diagnostic_rows BIGINT NOT NULL CHECK (
          maximum_diagnostic_rows = ${OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS}
        ),
        maximum_candidates_per_run BIGINT NOT NULL CHECK (
          maximum_candidates_per_run = ${OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES}
        ),
        supported_repair_field_count BIGINT NOT NULL CHECK (
          supported_repair_field_count = ${SUPPORTED_REPAIR_FIELD_COUNT}
        ),
        generated_candidate_lifetime_days BIGINT NOT NULL CHECK (
          generated_candidate_lifetime_days = ${GENERATED_CANDIDATE_LIFETIME_DAYS}
        ),
        server_bound_principal_lookup BOOLEAN NOT NULL DEFAULT TRUE CHECK (server_bound_principal_lookup = TRUE),
        server_derived_evidence_plan BOOLEAN NOT NULL DEFAULT TRUE CHECK (server_derived_evidence_plan = TRUE),
        server_clock_bound_evaluation BOOLEAN NOT NULL DEFAULT TRUE CHECK (server_clock_bound_evaluation = TRUE),
        application_deterministic_fingerprints BOOLEAN NOT NULL DEFAULT TRUE CHECK (
          application_deterministic_fingerprints = TRUE
        ),
        database_evidence_revalidation BOOLEAN NOT NULL DEFAULT TRUE CHECK (database_evidence_revalidation = TRUE),
        quarantined_only BOOLEAN NOT NULL DEFAULT TRUE CHECK (quarantined_only = TRUE),
        generated_candidates_executable BOOLEAN NOT NULL DEFAULT FALSE CHECK (
          generated_candidates_executable = FALSE
        ),
        mutation_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (mutation_authority = FALSE),
        observer_candidate_evaluation_repository_parity BOOLEAN NOT NULL DEFAULT TRUE CHECK (
          observer_candidate_evaluation_repository_parity = TRUE
        ),
        operational_retention_repository_parity BOOLEAN NOT NULL DEFAULT TRUE CHECK (
          operational_retention_repository_parity = TRUE
        ),
        execution_recovery_repository_parity BOOLEAN NOT NULL DEFAULT TRUE CHECK (
          execution_recovery_repository_parity = TRUE
        ),
        notification_recovery_repository_parity BOOLEAN NOT NULL DEFAULT TRUE CHECK (
          notification_recovery_repository_parity = TRUE
        ),
        full_handler_repository_parity BOOLEAN NOT NULL DEFAULT FALSE CHECK (
          full_handler_repository_parity = FALSE
        ),
        direct_table_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (direct_table_access = FALSE),
        insert_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (insert_access = FALSE),
        update_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (update_access = FALSE),
        delete_access BOOLEAN NOT NULL DEFAULT FALSE CHECK (delete_access = FALSE),
        runtime_authority BOOLEAN NOT NULL DEFAULT FALSE CHECK (runtime_authority = FALSE),
        production_ready BOOLEAN NOT NULL DEFAULT FALSE CHECK (production_ready = FALSE),
        applied_at TEXT NOT NULL,
        verified_at TEXT NOT NULL DEFAULT ''
      )`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON ${relation(
        manifest.schemaName,
        POSTGRES_OBSERVER_CANDIDATE_EVALUATION_RECEIPT_TABLE
      )} FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(
        manifest.schemaName,
        POSTGRES_OBSERVER_CANDIDATE_EVALUATION_RECEIPT_TABLE
      )}(
        id, contract_version, cutover_contract_version,
        operational_retention_contract_version, phase, read_role_namespace,
        session_role_namespace, queue_write_role_namespace, control_role_namespace,
        notification_recovery_role_namespace, execution_recovery_role_namespace,
        operational_retention_role_namespace, observer_candidate_role_namespace,
        role_manifest_fingerprint, operational_retention_manifest_fingerprint,
        observer_candidate_role_name, protected_table_count, forced_rls_table_count,
        direct_table_grant_count, function_grant_count, membership_count,
        active_principal_count, boundary_handler_task_kind_count,
        qualified_handler_task_kind_count, total_handler_task_kind_count,
        boundary_catalog_fingerprint, maximum_diagnostic_rows,
        maximum_candidates_per_run, supported_repair_field_count,
        generated_candidate_lifetime_days, applied_at
      ) VALUES (
        'active', $1, $2, $3, 'loading', $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, 0, 0, 0, 0, 0, 0, 1, 4, $15, repeat('0', 64),
        $16, $17, $18, $19, $20
      )`,
      [
        POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION,
        POSTGRES_CUTOVER_CONTRACT_VERSION,
        POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION,
        manifest.readRoleNamespace,
        manifest.sessionRoleNamespace,
        manifest.queueWriteRoleNamespace,
        manifest.controlRoleNamespace,
        manifest.notificationRecoveryRoleNamespace,
        manifest.executionRecoveryRoleNamespace,
        manifest.operationalRetentionRoleNamespace,
        manifest.observerCandidateRoleNamespace,
        manifest.fingerprint,
        manifest.operationalRetentionManifestFingerprint,
        manifest.observerCandidateRole.name,
        manifest.totalHandlerTaskKindCount,
        OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS,
        OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES,
        SUPPORTED_REPAIR_FIELD_COUNT,
        GENERATED_CANDIDATE_LIFETIME_DAYS,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(
        manifest.schemaName,
        POSTGRES_OBSERVER_CANDIDATE_EVALUATION_RECEIPT_TABLE
      )}
       SET phase = 'verified', protected_table_count = $1, forced_rls_table_count = $2,
           direct_table_grant_count = $3, function_grant_count = $4,
           membership_count = $5, active_principal_count = $6,
           boundary_catalog_fingerprint = $7, verified_at = $8
       WHERE id = 'active' AND phase = 'loading'`,
      [
        inspection.protectedTableCount,
        inspection.forcedRlsTableCount,
        inspection.directTableGrantCount,
        inspection.functionGrantCount,
        inspection.membershipCount,
        inspection.activePrincipalCount,
        inspection.boundaryCatalogFingerprint,
        verifiedAt
      ]
    );
    await session.query(
      `CREATE FUNCTION ${relation(
        manifest.schemaName,
        "yoink_observer_candidate_evaluation_receipt_guard"
      )}() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $yoink$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'observer-candidate receipt is immutable';
       END
       $yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${relation(
        manifest.schemaName,
        "yoink_observer_candidate_evaluation_receipt_guard"
      )}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_observer_candidate_evaluation_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(
        manifest.schemaName,
        POSTGRES_OBSERVER_CANDIDATE_EVALUATION_RECEIPT_TABLE
      )}
       FOR EACH ROW EXECUTE FUNCTION ${relation(
        manifest.schemaName,
        "yoink_observer_candidate_evaluation_receipt_guard"
      )}()`
    );
    const receipt = await readReceipt(session, manifest);
    const finalInspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(finalInspection, receipt, manifest);
    return receipt;
  });
}

function jsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      `The PostgreSQL observer-candidate ${label} is invalid.`
    );
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      `The PostgreSQL observer-candidate ${label} has an unexpected shape.`
    );
  }
}

function parseFunctionJson(value: unknown, label: string): Record<string, unknown> {
  try {
    return jsonRecord(JSON.parse(String(value ?? "")) as unknown, label);
  } catch (error) {
    if (error instanceof PostgresObserverCandidateEvaluationQualificationError) throw error;
    throw new PostgresObserverCandidateEvaluationQualificationError(
      `The PostgreSQL observer-candidate ${label} is not valid JSON.`
    );
  }
}

function candidatePlanFromRecord(
  value: Record<string, unknown>,
  principal: BackgroundWorkerPrincipal,
  version: string
): { plan: CandidatePlan; prepared: Array<ReturnType<typeof prepareGeneratedObserverRepairCandidate>> } {
  exactKeys(value, [
    "evaluationTimestamp",
    "repairGroupsEvaluated",
    "matureRepairGroups",
    "unsupportedMatureSelectors",
    "selectorsEvaluated",
    "candidateFieldsEvaluated",
    "supportedRepairFields",
    "candidatesDeferred",
    "generatedCandidateLifetimeDays",
    "selectedCandidates"
  ], "evidence plan");
  const evaluationTimestamp = exactTimestamp(value.evaluationTimestamp, "evaluation timestamp");
  if (Math.abs(Date.now() - Date.parse(evaluationTimestamp)) > MAXIMUM_CLOCK_SKEW_MS) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate server clock differs from the process clock."
    );
  }
  const repairGroupsEvaluated = exactInteger(value.repairGroupsEvaluated, "repair-group count");
  const matureRepairGroups = exactInteger(value.matureRepairGroups, "mature repair-group count");
  const unsupportedMatureSelectors = exactInteger(
    value.unsupportedMatureSelectors,
    "unsupported selector count"
  );
  const selectorsEvaluated = exactInteger(value.selectorsEvaluated, "evaluated selector count");
  const candidateFieldsEvaluated = exactInteger(
    value.candidateFieldsEvaluated,
    "evaluated candidate-field count"
  );
  const supportedRepairFields = exactInteger(value.supportedRepairFields, "supported repair-field count");
  const candidatesDeferred = exactInteger(value.candidatesDeferred, "deferred candidate count");
  const generatedCandidateLifetimeDays = exactInteger(
    value.generatedCandidateLifetimeDays,
    "generated candidate lifetime"
  );
  if (!Array.isArray(value.selectedCandidates)
    || value.selectedCandidates.length > OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES
    || repairGroupsEvaluated > OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS
    || matureRepairGroups > repairGroupsEvaluated
    || value.selectedCandidates.length !== Math.min(
      matureRepairGroups,
      OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES
    )
    || candidatesDeferred !== Math.max(
      0,
      matureRepairGroups - OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES
    )
    || supportedRepairFields !== SUPPORTED_REPAIR_FIELD_COUNT
    || generatedCandidateLifetimeDays !== GENERATED_CANDIDATE_LIFETIME_DAYS) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate evidence-plan aggregate is inconsistent."
    );
  }
  const selectedCandidates: CandidatePlanItem[] = [];
  const prepared = [] as Array<ReturnType<typeof prepareGeneratedObserverRepairCandidate>>;
  const identities = new Set<string>();
  let expectedSelectors = 0;
  let expectedFields = 0;
  for (const raw of value.selectedCandidates) {
    const item = jsonRecord(raw, "planned candidate");
    exactKeys(item, [
      "retailerId",
      "layoutFingerprint",
      "fields",
      "occurrenceCount",
      "minimumDistinctDeviceCount",
      "minimumDistinctSkuCount",
      "selectorCount",
      "fieldCount"
    ], "planned candidate");
    const retailerId = String(item.retailerId ?? "") as SupportedRetailerId;
    const layoutFingerprint = String(item.layoutFingerprint ?? "");
    if (!Object.hasOwn(RETAILER_OBSERVER_VERSIONS, retailerId) || !SHA256.test(layoutFingerprint)) {
      throw new PostgresObserverCandidateEvaluationQualificationError(
        "The PostgreSQL observer-candidate planned identity is invalid."
      );
    }
    const identity = `${retailerId}:${layoutFingerprint}`;
    if (identities.has(identity)) {
      throw new PostgresObserverCandidateEvaluationQualificationError(
        "The PostgreSQL observer-candidate evidence plan contains a duplicate identity."
      );
    }
    identities.add(identity);
    const occurrenceCount = exactInteger(item.occurrenceCount, "planned occurrence count");
    const minimumDistinctDeviceCount = exactInteger(
      item.minimumDistinctDeviceCount,
      "planned device count"
    );
    const minimumDistinctSkuCount = exactInteger(
      item.minimumDistinctSkuCount,
      "planned SKU count"
    );
    const selectorCount = exactInteger(item.selectorCount, "planned selector count");
    const fieldCount = exactInteger(item.fieldCount, "planned field count");
    const fields = jsonRecord(item.fields, "planned fields") as Partial<
      Record<string, ObserverRecipeFieldInput>
    >;
    const input: GeneratedObserverRepairCandidateInput = {
      retailerId,
      layoutFingerprint,
      fields,
      minimumExtensionVersion: version,
      occurrenceCount,
      minimumDistinctDeviceCount,
      minimumDistinctSkuCount
    };
    let candidate;
    try {
      candidate = prepareGeneratedObserverRepairCandidate(principal, input);
    } catch {
      throw new PostgresObserverCandidateEvaluationQualificationError(
        "The PostgreSQL observer-candidate plan contains an unsafe repair selector."
      );
    }
    if (candidate.selectorCount !== selectorCount || candidate.fieldCount !== fieldCount) {
      throw new PostgresObserverCandidateEvaluationQualificationError(
        "The PostgreSQL observer-candidate planned field aggregate is inconsistent."
      );
    }
    expectedSelectors += selectorCount;
    expectedFields += fieldCount;
    selectedCandidates.push({
      retailerId,
      layoutFingerprint,
      fields,
      occurrenceCount,
      minimumDistinctDeviceCount,
      minimumDistinctSkuCount,
      selectorCount,
      fieldCount
    });
    prepared.push(candidate);
  }
  if (selectorsEvaluated !== expectedSelectors || candidateFieldsEvaluated !== expectedFields) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate selected aggregate is inconsistent."
    );
  }
  return {
    plan: {
      evaluationTimestamp,
      repairGroupsEvaluated,
      matureRepairGroups,
      unsupportedMatureSelectors,
      selectorsEvaluated,
      candidateFieldsEvaluated,
      supportedRepairFields,
      candidatesDeferred,
      generatedCandidateLifetimeDays,
      selectedCandidates
    },
    prepared
  };
}

function resultFromRecord(
  value: Record<string, unknown>,
  plan: CandidatePlan
): PostgresObserverCandidateEvaluationResult {
  exactKeys(value, [
    "repairGroupsEvaluated",
    "matureRepairGroups",
    "unsupportedMatureSelectors",
    "selectorsEvaluated",
    "candidateFieldsEvaluated",
    "supportedRepairFields",
    "candidatesCreated",
    "candidatesReused",
    "candidatesDeferred",
    "expiredCandidates",
    "reviewedCandidates",
    "generatedCandidateLifetimeDays",
    "mutationAuthority",
    "generatedCandidatesExecutable"
  ], "evaluation result");
  const result: PostgresObserverCandidateEvaluationResult = {
    repairGroupsEvaluated: exactInteger(value.repairGroupsEvaluated, "result repair-group count"),
    matureRepairGroups: exactInteger(value.matureRepairGroups, "result mature-group count"),
    unsupportedMatureSelectors: exactInteger(
      value.unsupportedMatureSelectors,
      "result unsupported-selector count"
    ),
    selectorsEvaluated: exactInteger(value.selectorsEvaluated, "result selector count"),
    candidateFieldsEvaluated: exactInteger(value.candidateFieldsEvaluated, "result field count"),
    supportedRepairFields: exactInteger(value.supportedRepairFields, "result supported-field count") as 5,
    candidatesCreated: exactInteger(value.candidatesCreated, "created candidate count"),
    candidatesReused: exactInteger(value.candidatesReused, "reused candidate count"),
    candidatesDeferred: exactInteger(value.candidatesDeferred, "result deferred count"),
    expiredCandidates: exactInteger(value.expiredCandidates, "expired candidate count"),
    reviewedCandidates: exactInteger(value.reviewedCandidates, "reviewed candidate count"),
    generatedCandidateLifetimeDays: exactInteger(
      value.generatedCandidateLifetimeDays,
      "result candidate lifetime"
    ) as 30,
    mutationAuthority: exactBoolean(value.mutationAuthority, false, "mutation authority"),
    generatedCandidatesExecutable: exactBoolean(
      value.generatedCandidatesExecutable,
      false,
      "generated execution authority"
    )
  };
  if (result.repairGroupsEvaluated !== plan.repairGroupsEvaluated
    || result.matureRepairGroups !== plan.matureRepairGroups
    || result.unsupportedMatureSelectors !== plan.unsupportedMatureSelectors
    || result.selectorsEvaluated !== plan.selectorsEvaluated
    || result.candidateFieldsEvaluated !== plan.candidateFieldsEvaluated
    || result.supportedRepairFields !== SUPPORTED_REPAIR_FIELD_COUNT
    || result.candidatesDeferred !== plan.candidatesDeferred
    || result.generatedCandidateLifetimeDays !== GENERATED_CANDIDATE_LIFETIME_DAYS
    || result.candidatesCreated + result.candidatesReused !== plan.selectedCandidates.length
    || result.expiredCandidates > result.candidatesReused
    || result.reviewedCandidates > result.candidatesReused) {
    throw new PostgresObserverCandidateEvaluationQualificationError(
      "The PostgreSQL observer-candidate result does not match its evidence plan."
    );
  }
  return result;
}

class ObserverCandidateEvaluationSession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

export class NodePostgresObserverCandidateEvaluationDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresObserverCandidateEvaluationManifest;

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
    options: NodePostgresObserverCandidateEvaluationDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresObserverCandidateEvaluationManifest(
      requestedSchema,
      requestedReadRoleNamespace,
      requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace,
      requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace,
      requestedExecutionRecoveryRoleNamespace,
      requestedOperationalRetentionRoleNamespace,
      requestedObserverCandidateRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresObserverCandidateEvaluationQualificationError(
        "The PostgreSQL observer-candidate connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_observer_candidate_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_observer_candidate_qualification");
  }

  async evaluate(
    principal: BackgroundWorkerPrincipal,
    requestedRuntimeVersion: string,
    now = Date.now()
  ): Promise<PostgresObserverCandidateEvaluationResult> {
    const tenantId = principalId(principal?.tenantId, "expected tenant ID");
    const userId = principalId(principal?.userId, "expected user ID");
    const version = runtimeVersion(requestedRuntimeVersion);
    if (!Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresObserverCandidateEvaluationQualificationError(
        "The PostgreSQL observer-candidate cycle timestamp differs from the process clock."
      );
    }
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.observerCandidateRole.name)}`);
      const session = new ObserverCandidateEvaluationSession(client);
      const planResult = await session.query<{ resultJson: string }>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
          this.manifest.schemaName,
          POSTGRES_OBSERVER_CANDIDATE_EVALUATION_FUNCTION
        )}($1, $2, $3, 'plan', '', '[]')`,
        [tenantId, userId, version]
      );
      if (planResult.rows.length !== 1 || !planResult.rows[0]) {
        throw new PostgresObserverCandidateEvaluationQualificationError(
          "The PostgreSQL observer-candidate plan returned an ambiguous result."
        );
      }
      const planned = candidatePlanFromRecord(
        parseFunctionJson(planResult.rows[0].resultJson, "evidence plan"),
        { tenantId, userId },
        version
      );
      const payload = planned.plan.selectedCandidates.map((candidate, index) => {
        const prepared = planned.prepared[index];
        if (!prepared) {
          throw new PostgresObserverCandidateEvaluationQualificationError(
            "The PostgreSQL observer-candidate prepared identity is missing."
          );
        }
        const candidateId = newId("observer_recipe");
        const lifecycleEventId = newId("observer_recipe_event");
        return {
          retailerId: candidate.retailerId,
          layoutFingerprint: candidate.layoutFingerprint,
          fields: prepared.fields,
          minimumExtensionVersion: version,
          occurrenceCount: candidate.occurrenceCount,
          minimumDistinctDeviceCount: candidate.minimumDistinctDeviceCount,
          minimumDistinctSkuCount: candidate.minimumDistinctSkuCount,
          selectorCount: candidate.selectorCount,
          fieldCount: candidate.fieldCount,
          recipeVersion: prepared.recipeVersion,
          recipeJson: prepared.recipeJson,
          recipeFingerprint: prepared.recipeFingerprint,
          candidateId,
          lifecycleEventId,
          lifecycleEventHash: stableHash(
            "observer-recipe-lifecycle-v1",
            candidateId,
            "",
            "quarantined",
            LIFECYCLE_REASON,
            planned.plan.evaluationTimestamp
          ),
          auditId: newId("audit"),
          outboxId: newId("outbox")
        };
      });
      const applyResult = await session.query<{ resultJson: string }>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
          this.manifest.schemaName,
          POSTGRES_OBSERVER_CANDIDATE_EVALUATION_FUNCTION
        )}($1, $2, $3, 'apply', $4, $5)`,
        [
          tenantId,
          userId,
          version,
          planned.plan.evaluationTimestamp,
          JSON.stringify(payload)
        ]
      );
      if (applyResult.rows.length !== 1 || !applyResult.rows[0]) {
        throw new PostgresObserverCandidateEvaluationQualificationError(
          "The PostgreSQL observer-candidate apply returned an ambiguous result."
        );
      }
      const result = resultFromRecord(
        parseFunctionJson(applyResult.rows[0].resultJson, "evaluation result"),
        planned.plan
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroyed = true;
        client.release(true);
        throw error;
      }
      throw error;
    } finally {
      if (!destroyed) client.release();
    }
  }

  async execute(
    principal: BackgroundWorkerPrincipal,
    requestedRuntimeVersion: string,
    now = Date.now()
  ): Promise<PostgresObserverCandidateEvaluationResult> {
    return this.evaluate(principal, requestedRuntimeVersion, now);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
