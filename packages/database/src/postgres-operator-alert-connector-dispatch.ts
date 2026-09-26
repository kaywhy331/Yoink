import { createHash, randomBytes } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { BACKGROUND_TASK_KINDS } from "../../domain/src/background-task.js";
import { stableHash } from "../../domain/src/ids.js";
import type { OperatorAlertConnectorDispatchRepositoryPort } from "../../engine/src/operator-alert-connector-dispatch.js";
import {
  OPERATOR_ALERT_CONNECTOR_MAXIMUM_ATTEMPTS,
  OPERATOR_ALERT_CONNECTOR_MAXIMUM_BINDINGS,
  operatorAlertConnectorCapabilityHash,
  type OperatorAlertConnectorLease,
  type OperatorAlertConnectorPayload
} from "./operator-alert-connector-repository.js";
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
  POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION,
  buildPostgresObserverCandidateEvaluationManifest,
  verifyPostgresObserverCandidateEvaluationBoundary
} from "./postgres-observer-repair-candidate-evaluation.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION = 1;
export const POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_RECEIPT_TABLE =
  "yoink_operator_alert_connector_dispatch_receipt";
export const POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_FUNCTION =
  "yoink_dispatch_operator_alert_connector";

const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const ENDPOINT_REFERENCE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{2,119}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze(Array.from({ length: 12 }, () => "text"));
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TABLES = Object.freeze([
  "operator_alert_connector_deliveries",
  "operator_alert_connector_delivery_events",
  "operator_alert_connectors",
  "operator_alert_incidents"
] as const);
const QUALIFIED_HANDLER_TASK_KINDS = Object.freeze([
  "notification_recovery",
  "execution_recovery",
  "operational_telemetry_retention",
  "observer_recipe_candidate_evaluation"
] as const);
const MAXIMUM_CLOCK_SKEW_MS = 300_000;
const MAXIMUM_BINDINGS_JSON_BYTES = 8_192;
const MAXIMUM_PAYLOAD_BYTES = 4_000;
const DEFAULT_LEASE_SECONDS = 60;

export interface PostgresOperatorAlertConnectorDispatchManifest {
  contractVersion: typeof POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  observerCandidateContractVersion: typeof POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION;
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
  observerCandidateManifestFingerprint: string;
  alertDispatchRole: {
    kind: "operator_alert_connector_dispatch_sub_boundary";
    name: string;
    functionName: typeof POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_FUNCTION;
    functionArgumentTypes: string[];
    protectedTableNames: string[];
    forcedRlsTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTableCount: 4;
  forcedRlsTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  qualifiedHandlerTaskKinds: [
    "notification_recovery",
    "execution_recovery",
    "operational_telemetry_retention",
    "observer_recipe_candidate_evaluation"
  ];
  qualifiedHandlerTaskKindCount: 4;
  totalHandlerTaskKindCount: number;
  maximumBindings: typeof OPERATOR_ALERT_CONNECTOR_MAXIMUM_BINDINGS;
  maximumAttempts: typeof OPERATOR_ALERT_CONNECTOR_MAXIMUM_ATTEMPTS;
  maximumPayloadBytes: typeof MAXIMUM_PAYLOAD_BYTES;
  twoPhaseLease: true;
  applicationHashedOneUseCapabilities: true;
  databaseServerClock: true;
  endpointReferencesOnly: true;
  rawUrlsAccessible: false;
  connectorSecretsAccessible: false;
  alertDispatchRepositoryParity: true;
  alertReconciliationRepositoryParity: false;
  fullHandlerRepositoryParity: false;
  mutationAuthority: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresOperatorAlertConnectorDispatchQualificationReceipt {
  contractVersion: 1;
  cutoverContractVersion: 3;
  observerCandidateContractVersion: 1;
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
  alertDispatchRoleNamespace: string;
  roleManifestFingerprint: string;
  observerCandidateManifestFingerprint: string;
  alertDispatchRoleName: string;
  protectedTableCount: 4;
  forcedRlsTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  qualifiedHandlerTaskKindCount: 4;
  totalHandlerTaskKindCount: number;
  maximumBindings: 20;
  maximumAttempts: 12;
  maximumPayloadBytes: 4000;
  twoPhaseLease: true;
  applicationHashedOneUseCapabilities: true;
  databaseServerClock: true;
  endpointReferencesOnly: true;
  rawUrlsAccessible: false;
  connectorSecretsAccessible: false;
  alertDispatchRepositoryParity: true;
  alertReconciliationRepositoryParity: false;
  fullHandlerRepositoryParity: false;
  mutationAuthority: false;
  directTableAccess: false;
  runtimeAuthority: false;
  productionReady: false;
  boundaryCatalogFingerprint: string;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresOperatorAlertConnectorDispatchCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  observerCandidateContractVersion: 1;
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
  twoPhaseLease: true;
  applicationHashedOneUseCapabilities: true;
  databaseServerClock: true;
  endpointReferencesOnly: true;
  rawUrlsAccessible: false;
  connectorSecretsAccessible: false;
  readCommittedTransactionAdapter: true;
  alertDispatchRepositoryParity: true;
  alertReconciliationRepositoryParity: false;
  fullHandlerRepositoryParity: false;
  handlerTaskKindCount: 4;
  totalHandlerTaskKindCount: number;
  maximumBindings: 20;
  maximumAttempts: 12;
  maximumPayloadBytes: 4000;
  protectedTableCount: 4;
  forcedRlsTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface NodePostgresOperatorAlertConnectorDispatchDatabaseOptions {
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
  observer_candidate_contract_version: string | number | bigint;
  phase: string;
  read_role_namespace: string;
  session_role_namespace: string;
  queue_write_role_namespace: string;
  control_role_namespace: string;
  notification_recovery_role_namespace: string;
  execution_recovery_role_namespace: string;
  operational_retention_role_namespace: string;
  observer_candidate_role_namespace: string;
  alert_dispatch_role_namespace: string;
  role_manifest_fingerprint: string;
  observer_candidate_manifest_fingerprint: string;
  alert_dispatch_role_name: string;
  protected_table_count: string | number | bigint;
  forced_rls_table_count: string | number | bigint;
  direct_table_grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  qualified_handler_task_kind_count: string | number | bigint;
  total_handler_task_kind_count: string | number | bigint;
  maximum_bindings: string | number | bigint;
  maximum_attempts: string | number | bigint;
  maximum_payload_bytes: string | number | bigint;
  two_phase_lease: boolean;
  application_hashed_one_use_capabilities: boolean;
  database_server_clock: boolean;
  endpoint_references_only: boolean;
  raw_urls_accessible: boolean;
  connector_secrets_accessible: boolean;
  alert_dispatch_repository_parity: boolean;
  alert_reconciliation_repository_parity: boolean;
  full_handler_repository_parity: boolean;
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
  directTableGrantCount: number;
  functionGrantCount: number;
  membershipCount: number;
  activePrincipalCount: number;
  boundaryCatalogFingerprint: string;
}

let cachedCapabilityProjection: Readonly<PostgresOperatorAlertConnectorDispatchCapabilityProjection> | null = null;

export class PostgresOperatorAlertConnectorDispatchQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresOperatorAlertConnectorDispatchQualificationError";
  }
}

function schemaName(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch schema is invalid."
    );
  }
  return normalized;
}

function roleNamespace(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_alert_dispatch`;
  if (Buffer.byteLength(value, "utf8") > 63) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch role name exceeds 63 bytes."
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

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!INTEGER.test(normalized)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      `The PostgreSQL operator-alert dispatch ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      `The PostgreSQL operator-alert dispatch ${label} is out of range.`
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
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      `The PostgreSQL operator-alert dispatch ${label} is invalid.`
    );
  }
  return expected;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function principalId(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized !== value || Buffer.byteLength(normalized, "utf8") > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      `The PostgreSQL operator-alert dispatch ${label} is invalid.`
    );
  }
  return normalized;
}

function runtimeVersion(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!SEMVER.test(normalized)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch runtime version is invalid."
    );
  }
  return normalized;
}

function normalizedBindings(value: Readonly<Record<string, string>>): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch binding registry is invalid."
    );
  }
  const entries = Object.entries(value)
    .filter(([reference, bindingFingerprint]) => ENDPOINT_REFERENCE_PATTERN.test(reference)
      && SHA256.test(bindingFingerprint))
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, OPERATOR_ALERT_CONNECTOR_MAXIMUM_BINDINGS);
  return Object.fromEntries(entries);
}

function normalizedReason(value: unknown, fallback: string): string {
  return String(value ?? "").trim().toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_:-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || fallback;
}

function safeHttpStatus(value: unknown): number {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
}

export function operatorAlertDispatchFunctionSource(
  manifest: PostgresOperatorAlertConnectorDispatchManifest
): string {
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  operation_clock TIMESTAMPTZ := pg_catalog.statement_timestamp();
  operation_timestamp TEXT;
  bindings JSONB;
  binding_count BIGINT;
  requested_http_status BIGINT;
  requested_retry_seconds BIGINT;
  requested_lease_seconds BIGINT;
  requested_permanent BOOLEAN;
  delivery RECORD;
  event_sequence BIGINT;
  recovered_count BIGINT := 0;
  next_attempt BIGINT;
  new_lease_expires_at TEXT;
  new_next_attempt_at TEXT;
  dead_letter BOOLEAN;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected operator-alert dispatch principal is invalid';
  END IF;
  IF runtime_version !~ '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert dispatch runtime version is invalid';
  END IF;
  IF operation_name NOT IN ('expire', 'lease_plan', 'lease_apply', 'complete', 'fail') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert dispatch operation is invalid';
  END IF;
  IF pg_catalog.octet_length(bindings_json) > ${MAXIMUM_BINDINGS_JSON_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert dispatch bindings exceed their bound';
  END IF;
  BEGIN
    bindings := bindings_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert dispatch bindings are invalid';
  END;
  IF pg_catalog.jsonb_typeof(bindings) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert dispatch bindings must be an object';
  END IF;
  SELECT COUNT(*) INTO binding_count FROM pg_catalog.jsonb_each_text(bindings);
  IF binding_count > ${OPERATOR_ALERT_CONNECTOR_MAXIMUM_BINDINGS} OR EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_each_text(bindings) AS binding(reference, fingerprint)
    WHERE binding.reference !~ '^[A-Za-z][A-Za-z0-9_.:-]{2,119}$'
       OR binding.fingerprint !~ '^[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert dispatch bindings are outside the allowlist';
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
  operation_timestamp := pg_catalog.to_char(
    operation_clock AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  IF operation_name = 'expire' THEN
    IF delivery_id <> '' OR capability_hash <> '' OR reason_code <> ''
      OR http_status_text <> '' OR retry_after_seconds_text <> ''
      OR permanent_text <> '' OR lease_seconds_text <> '' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert expiration input is invalid';
    END IF;
    IF binding_count = 0 THEN
      RETURN QUERY SELECT pg_catalog.jsonb_build_object('expiredDeliveries', 0)::text;
      RETURN;
    END IF;
    FOR delivery IN
      SELECT d.id, d.attempt_count
      FROM ${relation(manifest.schemaName, "operator_alert_connector_deliveries")} AS d
      JOIN ${relation(manifest.schemaName, "operator_alert_connectors")} AS c
        ON c.id = d.connector_id AND c.tenant_id = d.tenant_id
      JOIN ${relation(manifest.schemaName, "operator_alert_incidents")} AS incident
        ON incident.id = d.incident_id AND incident.tenant_id = d.tenant_id
      JOIN LATERAL pg_catalog.jsonb_each_text(bindings) AS binding(reference, fingerprint)
        ON binding.reference = d.endpoint_reference
       AND binding.fingerprint = d.endpoint_binding_fingerprint
      WHERE d.tenant_id = resolved_tenant_id
        AND incident.subject_user_id = resolved_user_id
        AND c.enabled = 1
        AND c.endpoint_reference = d.endpoint_reference
        AND c.endpoint_binding_fingerprint = d.endpoint_binding_fingerprint
        AND d.state = 'leased'
        AND d.attempt_count >= ${OPERATOR_ALERT_CONNECTOR_MAXIMUM_ATTEMPTS}
        AND d.lease_expires_at <= operation_timestamp
      ORDER BY d.created_at, d.id
      LIMIT 20
      FOR UPDATE OF d SKIP LOCKED
    LOOP
      UPDATE ${relation(manifest.schemaName, "operator_alert_connector_deliveries")}
      SET state = 'dead_letter', lease_capability_hash = '', lease_expires_at = '',
          next_attempt_at = '', last_error_code = 'lease_attempts_exhausted',
          last_http_status = 0, updated_at = operation_timestamp
      WHERE id = delivery.id AND tenant_id = resolved_tenant_id AND state = 'leased'
        AND attempt_count >= ${OPERATOR_ALERT_CONNECTOR_MAXIMUM_ATTEMPTS}
        AND lease_expires_at <= operation_timestamp;
      IF FOUND THEN
        SELECT COALESCE(MAX(event.sequence), 0) + 1 INTO event_sequence
        FROM ${relation(manifest.schemaName, "operator_alert_connector_delivery_events")} AS event
        WHERE event.delivery_id = delivery.id;
        INSERT INTO ${relation(manifest.schemaName, "operator_alert_connector_delivery_events")}(
          id, tenant_id, delivery_id, sequence, event_type, attempt,
          reason_code, http_status, privacy_classification, created_at
        ) VALUES (
          'alert_connector_event_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
          resolved_tenant_id, delivery.id, event_sequence, 'dead_lettered',
          delivery.attempt_count, 'lease_attempts_exhausted', 0,
          'operational_aggregate', operation_timestamp
        );
        recovered_count := recovered_count + 1;
      END IF;
    END LOOP;
    RETURN QUERY SELECT pg_catalog.jsonb_build_object('expiredDeliveries', recovered_count)::text;
    RETURN;
  END IF;

  IF operation_name IN ('lease_plan', 'lease_apply') THEN
    IF binding_count = 0 OR reason_code <> '' OR http_status_text <> ''
      OR retry_after_seconds_text <> '' OR permanent_text <> ''
      OR lease_seconds_text !~ '^(?:1[5-9]|[2-9][0-9]|[12][0-9]{2}|300)$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert lease input is invalid';
    END IF;
    requested_lease_seconds := lease_seconds_text::bigint;
    IF requested_lease_seconds < 15 OR requested_lease_seconds > 300 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert lease duration is invalid';
    END IF;
    IF operation_name = 'lease_plan' AND (delivery_id <> '' OR capability_hash <> '') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert lease plan input is invalid';
    END IF;
    IF operation_name = 'lease_apply'
      AND (delivery_id !~ '^[A-Za-z0-9_-]{3,120}$' OR capability_hash !~ '^[a-f0-9]{64}$') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert lease apply input is invalid';
    END IF;
    SELECT d.id, d.connector_id, d.endpoint_reference, d.event_id,
           d.payload_json, d.payload_hash, d.state, d.attempt_count,
           d.lease_expires_at
      INTO delivery
    FROM ${relation(manifest.schemaName, "operator_alert_connector_deliveries")} AS d
    JOIN ${relation(manifest.schemaName, "operator_alert_connectors")} AS c
      ON c.id = d.connector_id AND c.tenant_id = d.tenant_id
    JOIN ${relation(manifest.schemaName, "operator_alert_incidents")} AS incident
      ON incident.id = d.incident_id AND incident.tenant_id = d.tenant_id
    JOIN LATERAL pg_catalog.jsonb_each_text(bindings) AS binding(reference, fingerprint)
      ON binding.reference = d.endpoint_reference
     AND binding.fingerprint = d.endpoint_binding_fingerprint
    WHERE d.tenant_id = resolved_tenant_id
      AND incident.subject_user_id = resolved_user_id
      AND c.enabled = 1
      AND c.endpoint_reference = d.endpoint_reference
      AND c.endpoint_binding_fingerprint = d.endpoint_binding_fingerprint
      AND d.attempt_count < ${OPERATOR_ALERT_CONNECTOR_MAXIMUM_ATTEMPTS}
      AND ((d.state IN ('pending', 'retry_wait')
            AND (d.next_attempt_at = '' OR d.next_attempt_at <= operation_timestamp))
        OR (d.state = 'leased' AND d.lease_expires_at <= operation_timestamp))
      AND (operation_name = 'lease_plan' OR d.id = delivery_id)
    ORDER BY d.created_at, d.id
    LIMIT 1
    FOR UPDATE OF d SKIP LOCKED;
    IF delivery.id IS NULL THEN
      IF operation_name = 'lease_apply' THEN
        RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'operator-alert lease candidate changed before apply';
      END IF;
      RETURN QUERY SELECT 'null'::text;
      RETURN;
    END IF;
    IF pg_catalog.octet_length(delivery.payload_json) > ${MAXIMUM_PAYLOAD_BYTES}
      OR pg_catalog.jsonb_typeof(delivery.payload_json::jsonb) <> 'object'
      OR delivery.payload_hash !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'operator-alert connector payload is inconsistent';
    END IF;
    next_attempt := delivery.attempt_count + 1;
    IF operation_name = 'lease_plan' THEN
      RETURN QUERY SELECT pg_catalog.jsonb_build_object(
        'id', delivery.id, 'connectorId', delivery.connector_id,
        'endpointReference', delivery.endpoint_reference, 'eventId', delivery.event_id,
        'payloadJson', delivery.payload_json, 'payloadHash', delivery.payload_hash,
        'attempt', next_attempt
      )::text;
      RETURN;
    END IF;
    new_lease_expires_at := pg_catalog.to_char(
      (operation_clock + pg_catalog.make_interval(secs => requested_lease_seconds::integer))
        AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    UPDATE ${relation(manifest.schemaName, "operator_alert_connector_deliveries")}
    SET state = 'leased', attempt_count = next_attempt,
        lease_capability_hash = capability_hash, lease_expires_at = new_lease_expires_at,
        next_attempt_at = '', last_error_code = '', last_http_status = 0,
        updated_at = operation_timestamp
    WHERE id = delivery.id AND tenant_id = resolved_tenant_id
      AND ((state IN ('pending', 'retry_wait')
            AND (next_attempt_at = '' OR next_attempt_at <= operation_timestamp))
        OR (state = 'leased' AND lease_expires_at <= operation_timestamp));
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'operator-alert lease candidate changed before apply';
    END IF;
    SELECT COALESCE(MAX(event.sequence), 0) + 1 INTO event_sequence
    FROM ${relation(manifest.schemaName, "operator_alert_connector_delivery_events")} AS event
    WHERE event.delivery_id = delivery.id;
    IF delivery.state = 'leased' THEN
      INSERT INTO ${relation(manifest.schemaName, "operator_alert_connector_delivery_events")}(
        id, tenant_id, delivery_id, sequence, event_type, attempt,
        reason_code, http_status, privacy_classification, created_at
      ) VALUES (
        'alert_connector_event_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
        resolved_tenant_id, delivery.id, event_sequence, 'retry_scheduled',
        delivery.attempt_count, 'lease_expired', 0, 'operational_aggregate', operation_timestamp
      );
      event_sequence := event_sequence + 1;
    END IF;
    INSERT INTO ${relation(manifest.schemaName, "operator_alert_connector_delivery_events")}(
      id, tenant_id, delivery_id, sequence, event_type, attempt,
      reason_code, http_status, privacy_classification, created_at
    ) VALUES (
      'alert_connector_event_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      resolved_tenant_id, delivery.id, event_sequence, 'leased', next_attempt,
      'worker_lease', 0, 'operational_aggregate', operation_timestamp
    );
    RETURN QUERY SELECT pg_catalog.jsonb_build_object(
      'id', delivery.id, 'connectorId', delivery.connector_id,
      'endpointReference', delivery.endpoint_reference, 'eventId', delivery.event_id,
      'payloadJson', delivery.payload_json, 'payloadHash', delivery.payload_hash,
      'attempt', next_attempt, 'leaseExpiresAt', new_lease_expires_at
    )::text;
    RETURN;
  END IF;

  IF bindings <> '{}'::jsonb OR delivery_id !~ '^[A-Za-z0-9_-]{3,120}$'
    OR capability_hash !~ '^[a-f0-9]{64}$'
    OR reason_code !~ '^[a-z0-9][a-z0-9_:-]{0,79}$'
    OR lease_seconds_text <> '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert completion input is invalid';
  END IF;
  SELECT d.id, d.attempt_count, d.lease_capability_hash, d.lease_expires_at
    INTO delivery
  FROM ${relation(manifest.schemaName, "operator_alert_connector_deliveries")} AS d
  JOIN ${relation(manifest.schemaName, "operator_alert_incidents")} AS incident
    ON incident.id = d.incident_id AND incident.tenant_id = d.tenant_id
  WHERE d.id = delivery_id AND d.tenant_id = resolved_tenant_id
    AND incident.subject_user_id = resolved_user_id AND d.state = 'leased'
  FOR UPDATE OF d;
  IF delivery.id IS NULL OR delivery.lease_capability_hash <> capability_hash
    OR delivery.lease_expires_at <= operation_timestamp THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'operator-alert connector capability is invalid or expired';
  END IF;
  IF http_status_text !~ '^(?:0|[1-5][0-9]{2})$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert HTTP status is invalid';
  END IF;
  requested_http_status := http_status_text::bigint;

  IF operation_name = 'complete' THEN
    IF retry_after_seconds_text <> '' OR permanent_text <> ''
      OR requested_http_status < 200 OR requested_http_status > 299 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert delivery completion is invalid';
    END IF;
    UPDATE ${relation(manifest.schemaName, "operator_alert_connector_deliveries")}
    SET state = 'delivered', lease_capability_hash = '', lease_expires_at = '',
        next_attempt_at = '', last_error_code = '', last_http_status = requested_http_status,
        delivered_at = operation_timestamp, updated_at = operation_timestamp
    WHERE id = delivery.id AND tenant_id = resolved_tenant_id AND state = 'leased';
    SELECT COALESCE(MAX(event.sequence), 0) + 1 INTO event_sequence
    FROM ${relation(manifest.schemaName, "operator_alert_connector_delivery_events")} AS event
    WHERE event.delivery_id = delivery.id;
    INSERT INTO ${relation(manifest.schemaName, "operator_alert_connector_delivery_events")}(
      id, tenant_id, delivery_id, sequence, event_type, attempt,
      reason_code, http_status, privacy_classification, created_at
    ) VALUES (
      'alert_connector_event_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      resolved_tenant_id, delivery.id, event_sequence, 'delivered', delivery.attempt_count,
      reason_code, requested_http_status, 'operational_aggregate', operation_timestamp
    );
    RETURN QUERY SELECT '{"completed":true}'::text;
    RETURN;
  END IF;

  IF retry_after_seconds_text !~ '^[0-9]{1,5}$' OR permanent_text NOT IN ('true', 'false') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert delivery failure input is invalid';
  END IF;
  requested_retry_seconds := retry_after_seconds_text::bigint;
  IF requested_retry_seconds < 1 OR requested_retry_seconds > 86400 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'operator-alert retry interval is invalid';
  END IF;
  requested_permanent := permanent_text::boolean;
  dead_letter := requested_permanent
    OR delivery.attempt_count >= ${OPERATOR_ALERT_CONNECTOR_MAXIMUM_ATTEMPTS};
  new_next_attempt_at := CASE WHEN dead_letter THEN '' ELSE pg_catalog.to_char(
    (operation_clock + pg_catalog.make_interval(secs => requested_retry_seconds::integer))
      AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) END;
  UPDATE ${relation(manifest.schemaName, "operator_alert_connector_deliveries")}
  SET state = CASE WHEN dead_letter THEN 'dead_letter' ELSE 'retry_wait' END,
      lease_capability_hash = '', lease_expires_at = '', next_attempt_at = new_next_attempt_at,
      last_error_code = reason_code, last_http_status = requested_http_status,
      updated_at = operation_timestamp
  WHERE id = delivery.id AND tenant_id = resolved_tenant_id AND state = 'leased';
  SELECT COALESCE(MAX(event.sequence), 0) + 1 INTO event_sequence
  FROM ${relation(manifest.schemaName, "operator_alert_connector_delivery_events")} AS event
  WHERE event.delivery_id = delivery.id;
  INSERT INTO ${relation(manifest.schemaName, "operator_alert_connector_delivery_events")}(
    id, tenant_id, delivery_id, sequence, event_type, attempt,
    reason_code, http_status, privacy_classification, created_at
  ) VALUES (
    'alert_connector_event_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
    resolved_tenant_id, delivery.id, event_sequence,
    CASE WHEN dead_letter THEN 'dead_lettered' ELSE 'retry_scheduled' END,
    delivery.attempt_count, reason_code, requested_http_status,
    'operational_aggregate', operation_timestamp
  );
  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'disposition', CASE WHEN dead_letter THEN 'dead_letter' ELSE 'retry' END
  )::text;
END
`;
}

export function buildPostgresOperatorAlertConnectorDispatchManifest(
  requestedSchema = POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  requestedReadRoleNamespace = "yoink_qualification",
  requestedSessionRoleNamespace = "yoink_session_qualification",
  requestedQueueWriteRoleNamespace = "yoink_queue_write_qualification",
  requestedControlRoleNamespace = "yoink_control_qualification",
  requestedNotificationRecoveryRoleNamespace = "yoink_notify_qualification",
  requestedExecutionRecoveryRoleNamespace = "yoink_execute_qualification",
  requestedOperationalRetentionRoleNamespace = "yoink_retention_qualification",
  requestedObserverCandidateRoleNamespace = "yoink_candidate_qualification",
  requestedAlertDispatchRoleNamespace = "yoink_dispatch_qualification"
): PostgresOperatorAlertConnectorDispatchManifest {
  const schema = schemaName(requestedSchema);
  const namespaces = [
    roleNamespace(requestedReadRoleNamespace, "yoink_qualification"),
    roleNamespace(requestedSessionRoleNamespace, "yoink_session_qualification"),
    roleNamespace(requestedQueueWriteRoleNamespace, "yoink_queue_write_qualification"),
    roleNamespace(requestedControlRoleNamespace, "yoink_control_qualification"),
    roleNamespace(requestedNotificationRecoveryRoleNamespace, "yoink_notify_qualification"),
    roleNamespace(requestedExecutionRecoveryRoleNamespace, "yoink_execute_qualification"),
    roleNamespace(requestedOperationalRetentionRoleNamespace, "yoink_retention_qualification"),
    roleNamespace(requestedObserverCandidateRoleNamespace, "yoink_candidate_qualification"),
    roleNamespace(requestedAlertDispatchRoleNamespace, "yoink_dispatch_qualification")
  ] as const;
  if (new Set(namespaces).size !== namespaces.length) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "Every PostgreSQL qualification role namespace must be distinct."
    );
  }
  const [readNamespace, sessionNamespace, queueNamespace, controlNamespace,
    notificationNamespace, executionNamespace, retentionNamespace,
    candidateNamespace, dispatchNamespace] = namespaces;
  const candidateManifest = buildPostgresObserverCandidateEvaluationManifest(
    schema,
    readNamespace,
    sessionNamespace,
    queueNamespace,
    controlNamespace,
    notificationNamespace,
    executionNamespace,
    retentionNamespace,
    candidateNamespace
  );
  const withoutFingerprint: Omit<PostgresOperatorAlertConnectorDispatchManifest, "fingerprint"> = {
    contractVersion: POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    observerCandidateContractVersion: POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION,
    schemaName: schema,
    readRoleNamespace: readNamespace,
    sessionRoleNamespace: sessionNamespace,
    queueWriteRoleNamespace: queueNamespace,
    controlRoleNamespace: controlNamespace,
    notificationRecoveryRoleNamespace: notificationNamespace,
    executionRecoveryRoleNamespace: executionNamespace,
    operationalRetentionRoleNamespace: retentionNamespace,
    observerCandidateRoleNamespace: candidateNamespace,
    alertDispatchRoleNamespace: dispatchNamespace,
    observerCandidateManifestFingerprint: candidateManifest.fingerprint,
    alertDispatchRole: {
      kind: "operator_alert_connector_dispatch_sub_boundary",
      name: roleName(dispatchNamespace),
      functionName: POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTableNames: [...PROTECTED_TABLES],
      forcedRlsTableNames: [...PROTECTED_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTableCount: 4,
    forcedRlsTableCount: 4,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    qualifiedHandlerTaskKinds: [...QUALIFIED_HANDLER_TASK_KINDS],
    qualifiedHandlerTaskKindCount: 4,
    totalHandlerTaskKindCount: BACKGROUND_TASK_KINDS.length,
    maximumBindings: OPERATOR_ALERT_CONNECTOR_MAXIMUM_BINDINGS,
    maximumAttempts: OPERATOR_ALERT_CONNECTOR_MAXIMUM_ATTEMPTS,
    maximumPayloadBytes: MAXIMUM_PAYLOAD_BYTES,
    twoPhaseLease: true,
    applicationHashedOneUseCapabilities: true,
    databaseServerClock: true,
    endpointReferencesOnly: true,
    rawUrlsAccessible: false,
    connectorSecretsAccessible: false,
    alertDispatchRepositoryParity: true,
    alertReconciliationRepositoryParity: false,
    fullHandlerRepositoryParity: false,
    mutationAuthority: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresOperatorAlertConnectorDispatchCapabilityProjection():
PostgresOperatorAlertConnectorDispatchCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresOperatorAlertConnectorDispatchManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    observerCandidateContractVersion: POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION,
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
    twoPhaseLease: true,
    applicationHashedOneUseCapabilities: true,
    databaseServerClock: true,
    endpointReferencesOnly: true,
    rawUrlsAccessible: false,
    connectorSecretsAccessible: false,
    readCommittedTransactionAdapter: true,
    alertDispatchRepositoryParity: true,
    alertReconciliationRepositoryParity: false,
    fullHandlerRepositoryParity: false,
    handlerTaskKindCount: 4,
    totalHandlerTaskKindCount: manifest.totalHandlerTaskKindCount,
    maximumBindings: OPERATOR_ALERT_CONNECTOR_MAXIMUM_BINDINGS,
    maximumAttempts: OPERATOR_ALERT_CONNECTOR_MAXIMUM_ATTEMPTS,
    maximumPayloadBytes: MAXIMUM_PAYLOAD_BYTES,
    protectedTableCount: 4,
    forcedRlsTableCount: 4,
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

async function inspectBoundary(
  session: PostgresQuerySession,
  manifest: PostgresOperatorAlertConnectorDispatchManifest
): Promise<BoundaryInspection> {
  const role = manifest.alertDispatchRole.name;
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
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch role has an unsafe attribute."
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
  const membershipCount = exactInteger(membershipResult.rows[0]?.count, "membership count");
  if (membershipCount !== 0) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch role must remain unassigned."
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
  const directTableGrantCount = exactInteger(directResult.rows[0]?.count, "direct grant count");
  if (directTableGrantCount !== 0) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch role has direct table authority."
    );
  }
  const effectiveTables = await session.query<{
    maySelect: boolean; mayInsert: boolean; mayUpdate: boolean; mayDelete: boolean; mayEscalate: boolean;
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
  if (effectiveTables.rows.some((row) => row.maySelect || row.mayInsert || row.mayUpdate
    || row.mayDelete || row.mayEscalate)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch role has an effective table privilege."
    );
  }
  const effectiveColumns = await session.query<{
    maySelect: boolean; mayInsert: boolean; mayUpdate: boolean; mayReference: boolean;
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
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch role has an effective column privilege."
    );
  }
  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch schema privilege is invalid."
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
    || routine.routineName !== manifest.alertDispatchRole.functionName
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE || routine.volatility !== "v"
    || !routine.securityDefiner || !routine.strict || routine.leakproof
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role || routine.source !== operatorAlertDispatchFunctionSource(manifest)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch function boundary is incomplete."
    );
  }
  const routineAcl = await session.query<{ grantee: string; privilegeType: string; grantable: boolean }>(
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
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch function grant is not exact."
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
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch role can access an application-schema sequence."
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
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch protected tables are not forced-RLS exact."
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
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch role must not own schema objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch role depends on a direct table policy."
    );
  }
  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  const activePrincipalCount = exactInteger(principals.rows[0]?.count, "active principal count");
  if (activePrincipalCount !== 0) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "Operator-alert dispatch qualification cannot activate a runtime principal."
    );
  }
  return {
    protectedTableCount: rls.rows.length,
    forcedRlsTableCount: rls.rows.length,
    directTableGrantCount,
    functionGrantCount: routines.rows.length,
    membershipCount,
    activePrincipalCount,
    boundaryCatalogFingerprint: fingerprint({ role: roleRow, routine, routineAcl: routineAcl.rows, rls: rls.rows })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresOperatorAlertConnectorDispatchManifest
): PostgresOperatorAlertConnectorDispatchQualificationReceipt {
  const receipt: PostgresOperatorAlertConnectorDispatchQualificationReceipt = {
    contractVersion: exactInteger(row.contract_version, "receipt contract version") as 1,
    cutoverContractVersion: exactInteger(row.cutover_contract_version, "cutover contract version") as 3,
    observerCandidateContractVersion: exactInteger(
      row.observer_candidate_contract_version,
      "observer-candidate contract version"
    ) as 1,
    phase: row.phase as "verified",
    schemaName: manifest.schemaName,
    readRoleNamespace: row.read_role_namespace,
    sessionRoleNamespace: row.session_role_namespace,
    queueWriteRoleNamespace: row.queue_write_role_namespace,
    controlRoleNamespace: row.control_role_namespace,
    notificationRecoveryRoleNamespace: row.notification_recovery_role_namespace,
    executionRecoveryRoleNamespace: row.execution_recovery_role_namespace,
    operationalRetentionRoleNamespace: row.operational_retention_role_namespace,
    observerCandidateRoleNamespace: row.observer_candidate_role_namespace,
    alertDispatchRoleNamespace: row.alert_dispatch_role_namespace,
    roleManifestFingerprint: row.role_manifest_fingerprint,
    observerCandidateManifestFingerprint: row.observer_candidate_manifest_fingerprint,
    alertDispatchRoleName: row.alert_dispatch_role_name,
    protectedTableCount: exactInteger(row.protected_table_count, "protected-table count") as 4,
    forcedRlsTableCount: exactInteger(row.forced_rls_table_count, "forced-RLS count") as 4,
    directTableGrantCount: exactInteger(row.direct_table_grant_count, "direct-grant count") as 0,
    functionGrantCount: exactInteger(row.function_grant_count, "function-grant count") as 1,
    membershipCount: exactInteger(row.membership_count, "membership count") as 0,
    activePrincipalCount: exactInteger(row.active_principal_count, "active-principal count") as 0,
    qualifiedHandlerTaskKindCount: exactInteger(
      row.qualified_handler_task_kind_count,
      "qualified handler count"
    ) as 4,
    totalHandlerTaskKindCount: exactInteger(row.total_handler_task_kind_count, "total handler count"),
    maximumBindings: exactInteger(row.maximum_bindings, "maximum binding count") as 20,
    maximumAttempts: exactInteger(row.maximum_attempts, "maximum attempt count") as 12,
    maximumPayloadBytes: exactInteger(row.maximum_payload_bytes, "maximum payload bytes") as 4000,
    twoPhaseLease: exactBoolean(row.two_phase_lease, true, "two-phase lease flag"),
    applicationHashedOneUseCapabilities: exactBoolean(
      row.application_hashed_one_use_capabilities,
      true,
      "application-hashed capability flag"
    ),
    databaseServerClock: exactBoolean(row.database_server_clock, true, "server-clock flag"),
    endpointReferencesOnly: exactBoolean(row.endpoint_references_only, true, "endpoint-reference flag"),
    rawUrlsAccessible: exactBoolean(row.raw_urls_accessible, false, "raw-URL flag"),
    connectorSecretsAccessible: exactBoolean(
      row.connector_secrets_accessible,
      false,
      "connector-secret flag"
    ),
    alertDispatchRepositoryParity: exactBoolean(
      row.alert_dispatch_repository_parity,
      true,
      "dispatch-parity flag"
    ),
    alertReconciliationRepositoryParity: exactBoolean(
      row.alert_reconciliation_repository_parity,
      false,
      "reconciliation-parity flag"
    ),
    fullHandlerRepositoryParity: exactBoolean(
      row.full_handler_repository_parity,
      false,
      "full-handler-parity flag"
    ),
    mutationAuthority: exactBoolean(row.mutation_authority, false, "mutation-authority flag"),
    directTableAccess: exactBoolean(row.direct_table_access, false, "direct-table-access flag"),
    runtimeAuthority: exactBoolean(row.runtime_authority, false, "runtime-authority flag"),
    productionReady: exactBoolean(row.production_ready, false, "production-ready flag"),
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    appliedAt: row.applied_at,
    verifiedAt: row.verified_at
  };
  if (receipt.phase !== "verified"
    || receipt.contractVersion !== POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION
    || receipt.cutoverContractVersion !== POSTGRES_CUTOVER_CONTRACT_VERSION
    || receipt.observerCandidateContractVersion !== POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION
    || receipt.readRoleNamespace !== manifest.readRoleNamespace
    || receipt.sessionRoleNamespace !== manifest.sessionRoleNamespace
    || receipt.queueWriteRoleNamespace !== manifest.queueWriteRoleNamespace
    || receipt.controlRoleNamespace !== manifest.controlRoleNamespace
    || receipt.notificationRecoveryRoleNamespace !== manifest.notificationRecoveryRoleNamespace
    || receipt.executionRecoveryRoleNamespace !== manifest.executionRecoveryRoleNamespace
    || receipt.operationalRetentionRoleNamespace !== manifest.operationalRetentionRoleNamespace
    || receipt.observerCandidateRoleNamespace !== manifest.observerCandidateRoleNamespace
    || receipt.alertDispatchRoleNamespace !== manifest.alertDispatchRoleNamespace
    || receipt.roleManifestFingerprint !== manifest.fingerprint
    || receipt.observerCandidateManifestFingerprint !== manifest.observerCandidateManifestFingerprint
    || receipt.alertDispatchRoleName !== manifest.alertDispatchRole.name
    || receipt.protectedTableCount !== manifest.protectedTableCount
    || receipt.forcedRlsTableCount !== manifest.forcedRlsTableCount
    || receipt.directTableGrantCount !== 0 || receipt.functionGrantCount !== 1
    || receipt.membershipCount !== 0 || receipt.activePrincipalCount !== 0
    || receipt.qualifiedHandlerTaskKindCount !== 4
    || receipt.totalHandlerTaskKindCount !== manifest.totalHandlerTaskKindCount
    || receipt.maximumBindings !== OPERATOR_ALERT_CONNECTOR_MAXIMUM_BINDINGS
    || receipt.maximumAttempts !== OPERATOR_ALERT_CONNECTOR_MAXIMUM_ATTEMPTS
    || receipt.maximumPayloadBytes !== MAXIMUM_PAYLOAD_BYTES
    || !receipt.twoPhaseLease || !receipt.applicationHashedOneUseCapabilities
    || !receipt.databaseServerClock || !receipt.endpointReferencesOnly
    || receipt.rawUrlsAccessible || receipt.connectorSecretsAccessible
    || !receipt.alertDispatchRepositoryParity || receipt.alertReconciliationRepositoryParity
    || receipt.fullHandlerRepositoryParity || receipt.mutationAuthority
    || receipt.directTableAccess || receipt.runtimeAuthority || receipt.productionReady
    || !SHA256.test(receipt.boundaryCatalogFingerprint)
    || !TIMESTAMP.test(receipt.appliedAt) || !TIMESTAMP.test(receipt.verifiedAt)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch receipt is inconsistent."
    );
  }
  return receipt;
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresOperatorAlertConnectorDispatchManifest
): Promise<PostgresOperatorAlertConnectorDispatchQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_RECEIPT_TABLE)}
     WHERE singleton = TRUE`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresOperatorAlertConnectorDispatchQualificationReceipt,
  manifest: PostgresOperatorAlertConnectorDispatchManifest
): void {
  if (inspection.protectedTableCount !== receipt.protectedTableCount
    || inspection.forcedRlsTableCount !== receipt.forcedRlsTableCount
    || inspection.directTableGrantCount !== receipt.directTableGrantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.roleManifestFingerprint !== manifest.fingerprint) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert dispatch boundary no longer matches its receipt."
    );
  }
}

export async function verifyPostgresOperatorAlertConnectorDispatchBoundary(
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
  requestedAlertDispatchRoleNamespace = "yoink_dispatch_qualification"
): Promise<PostgresOperatorAlertConnectorDispatchQualificationReceipt> {
  const manifest = buildPostgresOperatorAlertConnectorDispatchManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace
  );
  await verifyPostgresObserverCandidateEvaluationBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace,
    manifest.sessionRoleNamespace, manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace, manifest.notificationRecoveryRoleNamespace,
    manifest.executionRecoveryRoleNamespace, manifest.operationalRetentionRoleNamespace,
    manifest.observerCandidateRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresOperatorAlertConnectorDispatchBoundary(
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
  now = Date.now()
): Promise<PostgresOperatorAlertConnectorDispatchQualificationReceipt> {
  const manifest = buildPostgresOperatorAlertConnectorDispatchManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "Operator-alert dispatch qualification requires the supported BYPASSRLS control role."
    );
  }
  const authority = await database.query<{ rolcreaterole: boolean; rolsuper: boolean }>(
    "SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user"
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "Operator-alert dispatch qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresObserverCandidateEvaluationBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace,
    manifest.sessionRoleNamespace, manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace, manifest.notificationRecoveryRoleNamespace,
    manifest.executionRecoveryRoleNamespace, manifest.operationalRetentionRoleNamespace,
    manifest.observerCandidateRoleNamespace
  );
  const existing = await database.query<{
    roleExists: boolean; receiptExists: boolean; functionExists: boolean; guardExists: boolean;
  }>(
    `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1) AS "roleExists",
            pg_catalog.to_regclass($2) IS NOT NULL AS "receiptExists",
            pg_catalog.to_regprocedure($3) IS NOT NULL AS "functionExists",
            pg_catalog.to_regprocedure($4) IS NOT NULL AS "guardExists"`,
    [
      manifest.alertDispatchRole.name,
      `${manifest.schemaName}.${POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_RECEIPT_TABLE}`,
      `${manifest.schemaName}.${POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_FUNCTION}(${FUNCTION_ARGUMENT_TYPES.join(",")})`,
      `${manifest.schemaName}.yoink_guard_operator_alert_dispatch_receipt()`
    ]
  );
  if (existing.rows[0]?.roleExists || existing.rows[0]?.receiptExists
    || existing.rows[0]?.functionExists || existing.rows[0]?.guardExists) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "Operator-alert dispatch qualification refuses to reuse a role, function, guard, or receipt."
    );
  }
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The operator-alert dispatch qualification timestamp is invalid."
    );
  }
  const timestamp = new Date(now).toISOString();
  if (!TIMESTAMP.test(timestamp)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The operator-alert dispatch qualification timestamp is invalid."
    );
  }
  await database.transaction(async (session) => {
    await session.query(
      `CREATE ROLE ${identifier(manifest.alertDispatchRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(`GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)} TO ${identifier(manifest.alertDispatchRole.name)}`);
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, manifest.alertDispatchRole.functionName)}(
         expected_tenant_id text, expected_user_id text, runtime_version text,
         operation_name text, bindings_json text, delivery_id text,
         capability_hash text, reason_code text, http_status_text text,
         retry_after_seconds_text text, permanent_text text, lease_seconds_text text
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${operatorAlertDispatchFunctionSource(manifest)}$yoink$`
    );
    const functionSignature = `${relation(manifest.schemaName, manifest.alertDispatchRole.functionName)}(${FUNCTION_ARGUMENT_TYPES.join(", ")})`;
    await session.query(`REVOKE ALL ON FUNCTION ${functionSignature} FROM PUBLIC`);
    await session.query(`GRANT EXECUTE ON FUNCTION ${functionSignature} TO ${identifier(manifest.alertDispatchRole.name)}`);
    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_RECEIPT_TABLE)}(
         singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
         contract_version BIGINT NOT NULL CHECK (contract_version = 1),
         cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = 3),
         observer_candidate_contract_version BIGINT NOT NULL CHECK (observer_candidate_contract_version = 1),
         phase TEXT NOT NULL CHECK (phase = 'verified'),
         read_role_namespace TEXT NOT NULL, session_role_namespace TEXT NOT NULL,
         queue_write_role_namespace TEXT NOT NULL, control_role_namespace TEXT NOT NULL,
         notification_recovery_role_namespace TEXT NOT NULL,
         execution_recovery_role_namespace TEXT NOT NULL,
         operational_retention_role_namespace TEXT NOT NULL,
         observer_candidate_role_namespace TEXT NOT NULL,
         alert_dispatch_role_namespace TEXT NOT NULL,
         role_manifest_fingerprint TEXT NOT NULL,
         observer_candidate_manifest_fingerprint TEXT NOT NULL,
         alert_dispatch_role_name TEXT NOT NULL,
         protected_table_count BIGINT NOT NULL CHECK (protected_table_count = 4),
         forced_rls_table_count BIGINT NOT NULL CHECK (forced_rls_table_count = 4),
         direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
         function_grant_count BIGINT NOT NULL CHECK (function_grant_count = 1),
         membership_count BIGINT NOT NULL CHECK (membership_count = 0),
         active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
         qualified_handler_task_kind_count BIGINT NOT NULL CHECK (qualified_handler_task_kind_count = 4),
         total_handler_task_kind_count BIGINT NOT NULL,
         maximum_bindings BIGINT NOT NULL CHECK (maximum_bindings = 20),
         maximum_attempts BIGINT NOT NULL CHECK (maximum_attempts = 12),
         maximum_payload_bytes BIGINT NOT NULL CHECK (maximum_payload_bytes = 4000),
         two_phase_lease BOOLEAN NOT NULL CHECK (two_phase_lease = TRUE),
         application_hashed_one_use_capabilities BOOLEAN NOT NULL CHECK (application_hashed_one_use_capabilities = TRUE),
         database_server_clock BOOLEAN NOT NULL CHECK (database_server_clock = TRUE),
         endpoint_references_only BOOLEAN NOT NULL CHECK (endpoint_references_only = TRUE),
         raw_urls_accessible BOOLEAN NOT NULL CHECK (raw_urls_accessible = FALSE),
         connector_secrets_accessible BOOLEAN NOT NULL CHECK (connector_secrets_accessible = FALSE),
         alert_dispatch_repository_parity BOOLEAN NOT NULL CHECK (alert_dispatch_repository_parity = TRUE),
         alert_reconciliation_repository_parity BOOLEAN NOT NULL CHECK (alert_reconciliation_repository_parity = FALSE),
         full_handler_repository_parity BOOLEAN NOT NULL CHECK (full_handler_repository_parity = FALSE),
         mutation_authority BOOLEAN NOT NULL CHECK (mutation_authority = FALSE),
         direct_table_access BOOLEAN NOT NULL CHECK (direct_table_access = FALSE),
         runtime_authority BOOLEAN NOT NULL CHECK (runtime_authority = FALSE),
         production_ready BOOLEAN NOT NULL CHECK (production_ready = FALSE),
         boundary_catalog_fingerprint TEXT NOT NULL,
         applied_at TEXT NOT NULL, verified_at TEXT NOT NULL
       )`
    );
    await session.query(`REVOKE ALL ON TABLE ${relation(manifest.schemaName, POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_RECEIPT_TABLE)} FROM PUBLIC`);
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_guard_operator_alert_dispatch_receipt")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $guard$
       BEGIN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'operator-alert dispatch receipt is immutable'; END
       $guard$`
    );
    await session.query(`REVOKE ALL ON FUNCTION ${relation(manifest.schemaName, "yoink_guard_operator_alert_dispatch_receipt")}() FROM PUBLIC`);
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_operator_alert_dispatch_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON ${relation(manifest.schemaName, POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION ${relation(manifest.schemaName, "yoink_guard_operator_alert_dispatch_receipt")}()`
    );
    const inspection = await inspectBoundary(session, manifest);
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_RECEIPT_TABLE)}(
         singleton, contract_version, cutover_contract_version, observer_candidate_contract_version,
         phase, read_role_namespace, session_role_namespace, queue_write_role_namespace,
         control_role_namespace, notification_recovery_role_namespace,
         execution_recovery_role_namespace, operational_retention_role_namespace,
         observer_candidate_role_namespace, alert_dispatch_role_namespace,
         role_manifest_fingerprint, observer_candidate_manifest_fingerprint,
         alert_dispatch_role_name, protected_table_count, forced_rls_table_count,
         direct_table_grant_count, function_grant_count, membership_count,
         active_principal_count, qualified_handler_task_kind_count, total_handler_task_kind_count,
         maximum_bindings, maximum_attempts, maximum_payload_bytes,
         two_phase_lease, application_hashed_one_use_capabilities, database_server_clock,
         endpoint_references_only, raw_urls_accessible, connector_secrets_accessible,
         alert_dispatch_repository_parity, alert_reconciliation_repository_parity,
         full_handler_repository_parity, mutation_authority, direct_table_access,
         runtime_authority, production_ready, boundary_catalog_fingerprint, applied_at, verified_at
       ) VALUES (
         TRUE, 1, 3, 1, 'verified', $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, 4, 4, 0, 1, 0, 0, 4, $13, 20, 12, 4000,
         TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE,
         FALSE, FALSE, FALSE, $14, $15, $15
       )`,
      [
        manifest.readRoleNamespace, manifest.sessionRoleNamespace,
        manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
        manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
        manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
        manifest.alertDispatchRoleNamespace, manifest.fingerprint,
        manifest.observerCandidateManifestFingerprint, manifest.alertDispatchRole.name,
        manifest.totalHandlerTaskKindCount, inspection.boundaryCatalogFingerprint, timestamp
      ]
    );
  });
  return verifyPostgresOperatorAlertConnectorDispatchBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace,
    manifest.sessionRoleNamespace, manifest.queueWriteRoleNamespace,
    manifest.controlRoleNamespace, manifest.notificationRecoveryRoleNamespace,
    manifest.executionRecoveryRoleNamespace, manifest.operationalRetentionRoleNamespace,
    manifest.observerCandidateRoleNamespace, manifest.alertDispatchRoleNamespace
  );
}

class AlertDispatchSession implements PostgresQuerySession {
  constructor(private readonly client: PoolClient) {}
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.client.query<T>(sql, [...parameters]);
  }
}

function parseFunctionResult(value: unknown, label: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(String(value ?? "")) as unknown;
    if (parsed === null) return null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed as Record<string, unknown>;
  } catch {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      `The PostgreSQL operator-alert dispatch ${label} is invalid.`
    );
  }
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      `The PostgreSQL operator-alert dispatch ${label} fields are invalid.`
    );
  }
}

function payloadFromJson(value: string): OperatorAlertConnectorPayload {
  if (Buffer.byteLength(value, "utf8") > MAXIMUM_PAYLOAD_BYTES) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert connector payload exceeds its bound."
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert connector payload is malformed."
    );
  }
  const payload = parsed as unknown as OperatorAlertConnectorPayload;
  exactKeys(payload as unknown as Record<string, unknown>, [
    "contractVersion", "eventId", "incidentId", "eventType", "severity", "reasonCode",
    "retailerId", "operation", "failureStage", "layoutFingerprint", "occurrenceCount",
    "affectedEntityCount", "firstSeenAt", "lastSeenAt", "emittedAt", "privacyClassification"
  ], "connector payload");
  if (payload.contractVersion !== 1 || !ID_PATTERN.test(payload.eventId)
    || !ID_PATTERN.test(payload.incidentId)
    || !["info", "warning", "error", "critical"].includes(payload.severity)
    || payload.privacyClassification !== "operational_aggregate"
    || (payload.layoutFingerprint !== "" && !SHA256.test(payload.layoutFingerprint))
    || !Number.isSafeInteger(payload.occurrenceCount) || payload.occurrenceCount < 1
    || !Number.isSafeInteger(payload.affectedEntityCount) || payload.affectedEntityCount < 1
    || !TIMESTAMP.test(payload.firstSeenAt) || !TIMESTAMP.test(payload.lastSeenAt)
    || !TIMESTAMP.test(payload.emittedAt)) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert connector payload contract is invalid."
    );
  }
  return payload;
}

interface LeasePlan {
  id: string;
  connectorId: string;
  endpointReference: string;
  eventId: string;
  payloadJson: string;
  payloadHash: string;
  payload: OperatorAlertConnectorPayload;
  attempt: number;
}

function leasePlan(value: Record<string, unknown>): LeasePlan {
  exactKeys(value, [
    "id", "connectorId", "endpointReference", "eventId", "payloadJson", "payloadHash", "attempt"
  ], "lease plan");
  const id = String(value.id ?? "");
  const connectorId = String(value.connectorId ?? "");
  const endpointReference = String(value.endpointReference ?? "");
  const eventId = String(value.eventId ?? "");
  const payloadJson = String(value.payloadJson ?? "");
  const payloadHash = String(value.payloadHash ?? "");
  const attempt = exactInteger(value.attempt, "lease attempt");
  if (!ID_PATTERN.test(id) || !ID_PATTERN.test(connectorId) || !ID_PATTERN.test(eventId)
    || !ENDPOINT_REFERENCE_PATTERN.test(endpointReference)
    || !SHA256.test(payloadHash) || attempt < 1 || attempt > OPERATOR_ALERT_CONNECTOR_MAXIMUM_ATTEMPTS
    || stableHash("yoink_operator_alert_connector_payload_v1", payloadJson) !== payloadHash) {
    throw new PostgresOperatorAlertConnectorDispatchQualificationError(
      "The PostgreSQL operator-alert connector lease plan is inconsistent."
    );
  }
  return { id, connectorId, endpointReference, eventId, payloadJson, payloadHash, payload: payloadFromJson(payloadJson), attempt };
}

export class NodePostgresOperatorAlertConnectorDispatchDatabase
implements OperatorAlertConnectorDispatchRepositoryPort {
  private readonly pool: Pool;
  readonly manifest: PostgresOperatorAlertConnectorDispatchManifest;
  private readonly tenantId: string;
  private readonly userId: string;
  private readonly version: string;

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
    options: NodePostgresOperatorAlertConnectorDispatchDatabaseOptions = {}
  ) {
    this.tenantId = principalId(principal?.tenantId, "tenant ID");
    this.userId = principalId(principal?.userId, "user ID");
    this.version = runtimeVersion(requestedRuntimeVersion);
    this.manifest = buildPostgresOperatorAlertConnectorDispatchManifest(
      requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
      requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
      requestedAlertDispatchRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresOperatorAlertConnectorDispatchQualificationError(
        "The PostgreSQL operator-alert dispatch connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_alert_dispatch_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_alert_dispatch_qualification");
  }

  private assertNow(now: number): void {
    if (!Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresOperatorAlertConnectorDispatchQualificationError(
        "The PostgreSQL operator-alert dispatch timestamp differs from the process clock."
      );
    }
  }

  private async call(
    session: PostgresQuerySession,
    operation: "expire" | "lease_plan" | "lease_apply" | "complete" | "fail",
    values: {
      bindings?: Readonly<Record<string, string>>;
      deliveryId?: string;
      capabilityHash?: string;
      reasonCode?: string;
      httpStatus?: string;
      retryAfterSeconds?: string;
      permanent?: string;
      leaseSeconds?: string;
    } = {}
  ): Promise<Record<string, unknown> | null> {
    const result = await session.query<{ resultJson: string }>(
      `SELECT result_json AS "resultJson"
       FROM ${relation(this.manifest.schemaName, this.manifest.alertDispatchRole.functionName)}(
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       )`,
      [
        this.tenantId, this.userId, this.version, operation,
        JSON.stringify(normalizedBindings(values.bindings ?? {})),
        values.deliveryId ?? "", values.capabilityHash ?? "", values.reasonCode ?? "",
        values.httpStatus ?? "", values.retryAfterSeconds ?? "",
        values.permanent ?? "", values.leaseSeconds ?? ""
      ]
    );
    if (result.rows.length !== 1 || !result.rows[0]) {
      throw new PostgresOperatorAlertConnectorDispatchQualificationError(
        "The PostgreSQL operator-alert dispatch function returned an ambiguous result."
      );
    }
    return parseFunctionResult(result.rows[0].resultJson, `${operation} result`);
  }

  private async transaction<T>(work: (session: PostgresQuerySession) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.alertDispatchRole.name)}`);
      const value = await work(new AlertDispatchSession(client));
      await client.query("COMMIT");
      return value;
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

  async expireExhaustedLeases(
    availableBindings: Readonly<Record<string, string>>,
    now = Date.now()
  ): Promise<number> {
    this.assertNow(now);
    return this.transaction(async (session) => {
      const value = await this.call(session, "expire", { bindings: availableBindings });
      if (!value) throw new PostgresOperatorAlertConnectorDispatchQualificationError("The expiration result is missing.");
      exactKeys(value, ["expiredDeliveries"], "expiration result");
      const count = exactInteger(value.expiredDeliveries, "expired-delivery count");
      if (count > 20) throw new PostgresOperatorAlertConnectorDispatchQualificationError("The expiration result exceeds its bound.");
      return count;
    });
  }

  async leaseNext(
    availableBindings: Readonly<Record<string, string>>,
    leaseSeconds = DEFAULT_LEASE_SECONDS,
    now = Date.now()
  ): Promise<OperatorAlertConnectorLease | null> {
    this.assertNow(now);
    const safeLeaseSeconds = Math.max(15, Math.min(300, Math.floor(Number(leaseSeconds) || DEFAULT_LEASE_SECONDS)));
    if (!Object.keys(normalizedBindings(availableBindings)).length) return null;
    return this.transaction(async (session) => {
      const plannedValue = await this.call(session, "lease_plan", {
        bindings: availableBindings,
        leaseSeconds: String(safeLeaseSeconds)
      });
      if (!plannedValue) return null;
      const planned = leasePlan(plannedValue);
      const capabilityToken = randomBytes(32).toString("base64url");
      const capabilityHash = operatorAlertConnectorCapabilityHash(planned.id, capabilityToken);
      const appliedValue = await this.call(session, "lease_apply", {
        bindings: availableBindings,
        deliveryId: planned.id,
        capabilityHash,
        leaseSeconds: String(safeLeaseSeconds)
      });
      if (!appliedValue) {
        throw new PostgresOperatorAlertConnectorDispatchQualificationError(
          "The PostgreSQL operator-alert lease apply result is missing."
        );
      }
      exactKeys(appliedValue, [
        "id", "connectorId", "endpointReference", "eventId", "payloadJson", "payloadHash",
        "attempt", "leaseExpiresAt"
      ], "lease apply result");
      const { leaseExpiresAt, ...comparable } = appliedValue;
      const applied = leasePlan(comparable);
      if (canonicalPortabilityJson(applied) !== canonicalPortabilityJson(planned)
        || !TIMESTAMP.test(String(leaseExpiresAt ?? ""))) {
        throw new PostgresOperatorAlertConnectorDispatchQualificationError(
          "The PostgreSQL operator-alert lease changed between plan and apply."
        );
      }
      return {
        id: applied.id,
        connectorId: applied.connectorId,
        endpointReference: applied.endpointReference,
        eventId: applied.eventId,
        payload: applied.payload,
        attempt: applied.attempt,
        capabilityToken,
        leaseExpiresAt: String(leaseExpiresAt)
      };
    });
  }

  async complete(
    id: string,
    capabilityToken: string,
    reasonCode: string,
    httpStatus: number,
    now = Date.now()
  ): Promise<boolean> {
    this.assertNow(now);
    if (!ID_PATTERN.test(id)) {
      throw new PostgresOperatorAlertConnectorDispatchQualificationError("The delivery ID is invalid.");
    }
    const status = safeHttpStatus(httpStatus);
    if (status < 200 || status > 299) {
      throw new PostgresOperatorAlertConnectorDispatchQualificationError("A successful HTTP status is required.");
    }
    return this.transaction(async (session) => {
      const value = await this.call(session, "complete", {
        deliveryId: id,
        capabilityHash: operatorAlertConnectorCapabilityHash(id, String(capabilityToken ?? "")),
        reasonCode: normalizedReason(reasonCode, "webhook_accepted"),
        httpStatus: String(status)
      });
      if (!value) throw new PostgresOperatorAlertConnectorDispatchQualificationError("The completion result is missing.");
      exactKeys(value, ["completed"], "completion result");
      if (value.completed !== true) throw new PostgresOperatorAlertConnectorDispatchQualificationError("The completion result is invalid.");
      return true;
    });
  }

  async fail(
    id: string,
    capabilityToken: string,
    reasonCode: string,
    httpStatus: number,
    retryAfterSeconds: number,
    permanent: boolean,
    now = Date.now()
  ): Promise<"retry" | "dead_letter"> {
    this.assertNow(now);
    if (!ID_PATTERN.test(id)) {
      throw new PostgresOperatorAlertConnectorDispatchQualificationError("The delivery ID is invalid.");
    }
    const retrySeconds = Math.max(1, Math.min(86_400, Math.floor(Number(retryAfterSeconds) || 30)));
    return this.transaction(async (session) => {
      const value = await this.call(session, "fail", {
        deliveryId: id,
        capabilityHash: operatorAlertConnectorCapabilityHash(id, String(capabilityToken ?? "")),
        reasonCode: normalizedReason(reasonCode, "webhook_delivery_failed"),
        httpStatus: String(safeHttpStatus(httpStatus)),
        retryAfterSeconds: String(retrySeconds),
        permanent: permanent ? "true" : "false"
      });
      if (!value) throw new PostgresOperatorAlertConnectorDispatchQualificationError("The failure result is missing.");
      exactKeys(value, ["disposition"], "failure result");
      if (value.disposition !== "retry" && value.disposition !== "dead_letter") {
        throw new PostgresOperatorAlertConnectorDispatchQualificationError("The failure disposition is invalid.");
      }
      return value.disposition;
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
