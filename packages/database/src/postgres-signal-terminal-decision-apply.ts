import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { nowIso, stableHash } from "../../domain/src/ids.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  inspectPostgresCutoverPreflight,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase,
  type PostgresQuerySession
} from "./postgres-cutover.js";
import {
  POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION
} from "./postgres-hosted-delivery-lease-recovery.js";
import {
  POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION,
} from "./postgres-signal-catalog-apply.js";
import {
  POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION
} from "./postgres-signal-resolution-apply.js";
import {
  POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION,
  POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION,
  buildPostgresSignalSourceReferenceRefreshManifest,
  verifyPostgresSignalSourceReferenceRefreshBoundary
} from "./postgres-signal-source-reference-refresh.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_RECEIPT_TABLE =
  "yoink_signal_terminal_decision_apply_receipt";
export const POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION =
  "yoink_apply_trackalacker_signal_terminal_decision";

const MAXIMUM_CLOCK_SKEW_MS = 300_000;
const MAXIMUM_PLAN_AGE_SECONDS = 30;
const MAXIMUM_APPLY_PAYLOAD_BYTES = 512;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MESSAGE_ID = /^inbox_[a-f0-9]{32}$/;
const EVENT_ID = /^signal_event_[a-f0-9]{32}$/;
const RESOLUTION_ID = /^resolution_[a-f0-9]{32}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text", "text", "text"
] as const);
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TENANT_TABLES = Object.freeze([
  "audit_events",
  "inbox_messages",
  "mission_decisions",
  "outbox_events",
  "resolution_decisions",
  "signal_events",
  "signal_occurrences",
  "source_connections",
  "source_listing_refs",
  "source_product_aliases",
  "source_product_refs"
] as const);
const MUTATION_TABLES = Object.freeze([
  "audit_events",
  "mission_decisions",
  "outbox_events",
  "signal_occurrences"
] as const);

type InsertAction = "none" | "insert";
type SourceReferenceOutcome =
  | "refresh"
  | "already_current"
  | "no_reference_identity"
  | "not_matched"
  | "test_signal";
type TerminalPlanOutcome = "apply_terminal" | "already_terminal" | "continue_downstream";
type TerminalDecisionOutcome =
  | "test_signal"
  | "ambiguous_identity"
  | "unresolved_identity"
  | "non_actionable_event";

export interface PostgresSignalTerminalDecisionApplyManifest {
  contractVersion: typeof POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  hostedDeliveryContractVersion: typeof POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION;
  catalogApplyContractVersion: typeof POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION;
  resolutionApplyContractVersion: typeof POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION;
  sourceReferenceRefreshContractVersion:
    typeof POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION;
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
  catalogApplyRoleNamespace: string;
  resolutionApplyRoleNamespace: string;
  sourceReferenceRefreshRoleNamespace: string;
  terminalDecisionApplyRoleNamespace: string;
  sourceReferenceRefreshManifestFingerprint: string;
  terminalDecisionApplyRole: {
    kind: "signal_terminal_decision_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTenantTableCount: 11;
  forcedRlsTableCount: 11;
  mutationTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  maximumPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  committedResolutionBinding: true;
  settledSourceReferenceRequired: true;
  terminalOutcomeDerivation: true;
  testSignalTerminalOnly: true;
  nonActionableTerminalOnly: true;
  idempotentReplay: true;
  signalOccurrenceRepositoryParity: true;
  terminalMissionDecisionRepositoryParity: true;
  terminalAuditOutboxRepositoryParity: true;
  sharedCatalogMutation: false;
  sourceReferenceMutation: false;
  incidentMutation: false;
  offerObservationMutation: false;
  missionMutation: false;
  actionMutation: false;
  terminalSignalEvaluationRepositoryParity: true;
  terminalSignalGraphMutation: true;
  remainingDownstreamSignalGraphMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  mutationAuthority: true;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalTerminalDecisionApplyQualificationReceipt {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
  catalogApplyContractVersion: 1;
  resolutionApplyContractVersion: 1;
  sourceReferenceRefreshContractVersion: 1;
  phase: "verified";
  schemaName: string;
  roleManifestFingerprint: string;
  sourceReferenceRefreshManifestFingerprint: string;
  terminalDecisionApplyRoleName: string;
  protectedTenantTableCount: 11;
  forcedRlsTableCount: 11;
  mutationTableCount: 4;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  maximumPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  committedResolutionBinding: true;
  settledSourceReferenceRequired: true;
  terminalOutcomeDerivation: true;
  testSignalTerminalOnly: true;
  nonActionableTerminalOnly: true;
  idempotentReplay: true;
  signalOccurrenceRepositoryParity: true;
  terminalMissionDecisionRepositoryParity: true;
  terminalAuditOutboxRepositoryParity: true;
  sharedCatalogMutation: false;
  sourceReferenceMutation: false;
  incidentMutation: false;
  offerObservationMutation: false;
  missionMutation: false;
  actionMutation: false;
  terminalSignalEvaluationRepositoryParity: true;
  terminalSignalGraphMutation: true;
  remainingDownstreamSignalGraphMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  mutationAuthority: true;
  directTableAccess: false;
  runtimeAuthority: false;
  productionReady: false;
  boundaryCatalogFingerprint: string;
  appliedAt: string;
  verifiedAt: string;
}

export interface PostgresSignalTerminalDecisionApplyCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
  catalogApplyContractVersion: 1;
  resolutionApplyContractVersion: 1;
  sourceReferenceRefreshContractVersion: 1;
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
  databasePlanRevalidation: true;
  twoPhasePlanApply: true;
  readCommittedTransactionAdapter: true;
  committedResolutionBinding: true;
  settledSourceReferenceRequired: true;
  terminalOutcomeDerivation: true;
  testSignalTerminalOnly: true;
  nonActionableTerminalOnly: true;
  idempotentReplay: true;
  signalOccurrenceRepositoryParity: true;
  terminalMissionDecisionRepositoryParity: true;
  terminalAuditOutboxRepositoryParity: true;
  sharedCatalogMutation: false;
  sourceReferenceMutation: false;
  incidentMutation: false;
  offerObservationMutation: false;
  missionMutation: false;
  actionMutation: false;
  terminalSignalEvaluationRepositoryParity: true;
  terminalSignalGraphMutation: true;
  remainingDownstreamSignalGraphMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  maximumPlanAgeSeconds: 30;
  protectedTenantTableCount: 11;
  forcedRlsTableCount: 11;
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

export interface PostgresSignalTerminalDecisionApplyPlan {
  contractVersion: 1;
  messageId: string;
  payloadHash: string;
  evaluatedAt: string;
  validUntil: string;
  eventId: string;
  resolutionDecisionId: string;
  resolutionStatus: "matched" | "ambiguous" | "unresolved";
  listingId: string;
  variantId: string;
  sourceReferenceOutcome: SourceReferenceOutcome;
  outcome: TerminalPlanOutcome;
  decisionOutcome: TerminalDecisionOutcome | "";
  decisionReasonHash: string;
  auditDataHash: string;
  occurrenceAction: InsertAction;
  missionDecisionAction: InsertAction;
  auditAction: InsertAction;
  outboxAction: InsertAction;
  mutationStatementCount: number;
  terminalDecisionApplyWillApply: boolean;
  sharedCatalogMutation: false;
  sourceReferenceMutation: false;
  incidentMutation: false;
  rawSignalPayloadReturned: false;
  planFingerprint: string;
}

export interface PostgresSignalTerminalDecisionApplyResult {
  contractVersion: 1;
  messageId: string;
  planFingerprint: string;
  eventId: string;
  resolutionDecisionId: string;
  sourceReferenceOutcome: SourceReferenceOutcome;
  outcome: TerminalPlanOutcome;
  decisionOutcome: TerminalDecisionOutcome | "";
  occurrenceAction: InsertAction;
  missionDecisionAction: InsertAction;
  auditAction: InsertAction;
  outboxAction: InsertAction;
  mutationStatementCount: number;
  terminalDecisionApplyApplied: boolean;
  continueDownstream: boolean;
  mutationAuthority: true;
  idempotentReplay: true;
  sharedCatalogMutated: false;
  sourceReferencesMutated: false;
  incidentsMutated: false;
  offersMutated: false;
  missionsMutated: false;
  actionsMutated: false;
  terminalSignalGraphMutated: boolean;
  remainingDownstreamSignalGraphMutated: false;
  inboxLifecycleMutated: false;
  rawSignalPayloadReturned: false;
}

export interface NodePostgresSignalTerminalDecisionApplyDatabaseOptions {
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

interface RoutineAclRow extends Record<string, unknown> {
  grantee: string;
  privilegeType: string;
  grantable: boolean;
}

interface ReceiptRow extends Record<string, unknown> {
  contract_version: string | number | bigint;
  cutover_contract_version: string | number | bigint;
  hosted_delivery_contract_version: string | number | bigint;
  catalog_apply_contract_version: string | number | bigint;
  resolution_apply_contract_version: string | number | bigint;
  source_reference_refresh_contract_version: string | number | bigint;
  phase: string;
  role_manifest_fingerprint: string;
  source_reference_refresh_manifest_fingerprint: string;
  terminal_decision_apply_role_name: string;
  protected_tenant_table_count: string | number | bigint;
  forced_rls_table_count: string | number | bigint;
  mutation_table_count: string | number | bigint;
  direct_table_grant_count: string | number | bigint;
  function_grant_count: string | number | bigint;
  membership_count: string | number | bigint;
  active_principal_count: string | number | bigint;
  maximum_plan_age_seconds: string | number | bigint;
  server_bound_principal_lookup: boolean;
  database_plan_revalidation: boolean;
  committed_resolution_binding: boolean;
  settled_source_reference_required: boolean;
  terminal_outcome_derivation: boolean;
  test_signal_terminal_only: boolean;
  non_actionable_terminal_only: boolean;
  idempotent_replay: boolean;
  signal_occurrence_repository_parity: boolean;
  terminal_mission_decision_repository_parity: boolean;
  terminal_audit_outbox_repository_parity: boolean;
  shared_catalog_mutation: boolean;
  source_reference_mutation: boolean;
  incident_mutation: boolean;
  offer_observation_mutation: boolean;
  mission_mutation: boolean;
  action_mutation: boolean;
  terminal_signal_evaluation_repository_parity: boolean;
  terminal_signal_graph_mutation: boolean;
  remaining_downstream_signal_graph_mutation: boolean;
  inbox_lifecycle_mutation: boolean;
  raw_signal_payload_returned: boolean;
  signal_evaluation_apply_repository_parity: boolean;
  hosted_delivery_handler_repository_parity: boolean;
  mutation_authority: boolean;
  direct_table_access: boolean;
  runtime_authority: boolean;
  production_ready: boolean;
  boundary_catalog_fingerprint: string;
  applied_at: string;
  verified_at: string;
}

interface BoundaryInspection {
  protectedTenantTableCount: number;
  forcedRlsTableCount: number;
  mutationTableCount: number;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  boundaryCatalogFingerprint: string;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

interface RoleAuthorityRow extends Record<string, unknown> {
  rolcreaterole: boolean;
  rolsuper: boolean;
}

let cachedCapabilityProjection: Readonly<PostgresSignalTerminalDecisionApplyCapabilityProjection> | null = null;

export class PostgresSignalTerminalDecisionApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalTerminalDecisionApplyQualificationError";
  }
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function relation(schemaName: string, objectName: string): string {
  return `${identifier(schemaName)}.${identifier(objectName)}`;
}

function safeSchema(value: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SAFE_SCHEMA.test(normalized)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string, fallback: string): string {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  return `${namespace}_signal_terminal_decision_apply`;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      `The PostgreSQL signal-terminal-decision ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      `The PostgreSQL signal-terminal-decision ${label} is out of range.`
    );
  }
  return parsed;
}

function exactText(value: unknown, label: string, maximum = 300, allowEmpty = false): string {
  const normalized = String(value ?? "");
  if (normalized.length > maximum || (!allowEmpty && normalized.length === 0)
    || normalized.trim() !== normalized || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      `The PostgreSQL signal-terminal-decision ${label} is invalid.`
    );
  }
  return normalized;
}

function exactHash(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!SHA256.test(normalized)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      `The PostgreSQL signal-terminal-decision ${label} is invalid.`
    );
  }
  return normalized;
}

function exactTimestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)
    || Number.isNaN(Date.parse(normalized))) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      `The PostgreSQL signal-terminal-decision ${label} is invalid.`
    );
  }
  return normalized;
}

function exactBoolean(value: unknown, expected: boolean, label: string): boolean {
  if (value !== expected) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      `The PostgreSQL signal-terminal-decision ${label} is invalid.`
    );
  }
  return expected;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function stableHashInputSql(parts: string[]): string {
  return parts.map((part) =>
    `pg_catalog.octet_length(${part})::text || ':' || ${part} || '|'`
  ).join(" || ");
}

export function postgresSignalTerminalDecisionApplyPlanFingerprint(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  plan: PostgresSignalTerminalDecisionApplyPlan
): string {
  return stableHash(
    "postgres_signal_terminal_decision_apply_plan_v1",
    principal.tenantId,
    principal.userId,
    plan.contractVersion,
    plan.messageId,
    plan.payloadHash,
    plan.evaluatedAt,
    plan.validUntil,
    plan.eventId,
    plan.resolutionDecisionId,
    plan.resolutionStatus,
    plan.listingId,
    plan.variantId,
    plan.sourceReferenceOutcome,
    plan.outcome,
    plan.decisionOutcome,
    plan.decisionReasonHash,
    plan.auditDataHash,
    plan.occurrenceAction,
    plan.missionDecisionAction,
    plan.auditAction,
    plan.outboxAction,
    plan.mutationStatementCount,
    plan.terminalDecisionApplyWillApply ? 1 : 0,
    plan.sharedCatalogMutation ? 1 : 0,
    plan.sourceReferenceMutation ? 1 : 0,
    plan.incidentMutation ? 1 : 0,
    plan.rawSignalPayloadReturned ? 1 : 0
  );
}

export function signalTerminalDecisionApplyFunctionSource(
  manifest: PostgresSignalTerminalDecisionApplyManifest
): string {
  const planParts = stableHashInputSql([
    "'postgres_signal_terminal_decision_apply_plan_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'1'::text",
    "message_id_value",
    "payload_hash_value",
    "evaluation_timestamp",
    "valid_until_timestamp",
    "event_record.id::text",
    "resolution_record.id::text",
    "resolution_status_value",
    "listing_id_value",
    "variant_id_value",
    "source_reference_outcome_value",
    "outcome_value",
    "decision_outcome_value",
    "decision_reason_hash_value",
    "audit_data_hash_value",
    "occurrence_action_value",
    "mission_decision_action_value",
    "audit_action_value",
    "outbox_action_value",
    "mutation_statement_count::text",
    "CASE WHEN outcome_value = 'apply_terminal' THEN '1' ELSE '0' END",
    "'0'::text",
    "'0'::text",
    "'0'::text",
    "'0'::text"
  ]);
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  evaluation_clock TIMESTAMPTZ;
  evaluation_timestamp TEXT;
  valid_until_timestamp TEXT;
  source_reference_plan JSONB;
  source_reference_plan_count BIGINT;
  source_reference_outcome_value TEXT;
  message_id_value TEXT;
  payload_hash_value TEXT;
  event_record RECORD;
  resolution_record RECORD;
  offer_value JSONB;
  availability_value TEXT := '';
  resolution_status_value TEXT;
  listing_id_value TEXT := '';
  variant_id_value TEXT := '';
  outcome_value TEXT := 'continue_downstream';
  decision_outcome_value TEXT := '';
  decision_reason_value TEXT := '';
  decision_reason_hash_value TEXT;
  audit_data JSONB := '{}'::jsonb;
  audit_data_hash_value TEXT;
  occurrence_action_value TEXT := 'none';
  mission_decision_action_value TEXT := 'none';
  audit_action_value TEXT := 'none';
  outbox_action_value TEXT := 'none';
  mutation_statement_count BIGINT := 0;
  occurrence_count BIGINT := 0;
  mission_decision_count BIGINT := 0;
  audit_count BIGINT := 0;
  outbox_count BIGINT := 0;
  occurrence_record RECORD;
  mission_decision_record RECORD;
  audit_record RECORD;
  outbox_record RECORD;
  occurrence_id_value TEXT := '';
  mission_decision_id_value TEXT := '';
  audit_id_value TEXT := '';
  outbox_id_value TEXT := '';
  plan_input TEXT;
  plan_fingerprint_value TEXT;
  plan_value JSONB;
  apply_payload JSONB;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = ''
    OR target_message_id !~ '^inbox_[a-f0-9]{32}$'
    OR capability_token !~ '^[A-Za-z0-9_-]{43}$'
    OR operation_name NOT IN ('plan', 'apply')
    OR pg_catalog.octet_length(apply_payload_json) > ${MAXIMUM_APPLY_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal terminal-decision request is invalid';
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

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'yoink_signal_terminal_decision_apply_v1:' || resolved_tenant_id || ':' ||
      resolved_user_id || ':' || target_message_id,
    0
  ));

  IF operation_name = 'plan' THEN
    IF evaluation_timestamp_input <> '' OR apply_payload_json::jsonb <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal terminal-decision plan input is invalid';
    END IF;
    evaluation_clock := pg_catalog.statement_timestamp();
  ELSE
    IF evaluation_timestamp_input !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal terminal-decision evaluation timestamp is invalid';
    END IF;
    evaluation_clock := evaluation_timestamp_input::timestamptz;
    IF evaluation_clock > pg_catalog.statement_timestamp()
      OR EXTRACT(EPOCH FROM (pg_catalog.statement_timestamp() - evaluation_clock))
        > ${MAXIMUM_PLAN_AGE_SECONDS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal terminal-decision plan expired before apply';
    END IF;
  END IF;
  evaluation_timestamp := pg_catalog.to_char(
    evaluation_clock AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  valid_until_timestamp := pg_catalog.to_char(
    (evaluation_clock + INTERVAL '${MAXIMUM_PLAN_AGE_SECONDS} seconds') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  SELECT MIN(planned.result_json)::jsonb, COUNT(*)
    INTO source_reference_plan, source_reference_plan_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_FUNCTION)}(
    expected_tenant_id, expected_user_id, 'plan', target_message_id,
    capability_token, '', '{}'
  ) AS planned;
  IF source_reference_plan_count <> 1 OR source_reference_plan IS NULL
    OR source_reference_plan->>'messageId' <> target_message_id
    OR source_reference_plan->>'eventId' !~ '^signal_event_[a-f0-9]{32}$'
    OR source_reference_plan->>'resolutionDecisionId' !~ '^resolution_[a-f0-9]{32}$'
    OR source_reference_plan->>'payloadHash' !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal terminal-decision predecessor validation failed';
  END IF;
  source_reference_outcome_value := COALESCE(source_reference_plan->>'outcome', '');
  IF source_reference_outcome_value NOT IN (
      'refresh', 'already_current', 'no_reference_identity', 'not_matched', 'test_signal'
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal terminal-decision predecessor outcome is invalid';
  END IF;
  IF source_reference_outcome_value = 'refresh'
    OR source_reference_plan->>'sourceReferenceRefreshWillApply' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal source references must settle before terminal-decision apply';
  END IF;

  message_id_value := source_reference_plan->>'messageId';
  payload_hash_value := source_reference_plan->>'payloadHash';

  SELECT event.id, event.tenant_id, event.user_id, event.source_connection_id,
         event.signal_id, event.event_type, event.test, event.observed_at,
         event.received_at, event.offer_json, event.resolution_status
    INTO event_record
  FROM ${relation(manifest.schemaName, "signal_events")} AS event
  WHERE event.id = source_reference_plan->>'eventId'
    AND event.tenant_id = resolved_tenant_id
    AND event.user_id = resolved_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'committed signal event is unavailable for terminal decision';
  END IF;

  SELECT decision.id, decision.event_id, decision.status, decision.method,
         decision.variant_id, decision.listing_id, decision.reason
    INTO resolution_record
  FROM ${relation(manifest.schemaName, "resolution_decisions")} AS decision
  WHERE decision.id = source_reference_plan->>'resolutionDecisionId'
    AND decision.event_id = event_record.id;
  IF NOT FOUND
    OR resolution_record.status <> event_record.resolution_status
    OR source_reference_plan->>'resolutionStatus' <> resolution_record.status
    OR COALESCE(source_reference_plan->>'listingId', '') <> COALESCE(resolution_record.listing_id, '')
    OR COALESCE(source_reference_plan->>'variantId', '') <> COALESCE(resolution_record.variant_id, '') THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'committed resolution changed before terminal decision';
  END IF;

  resolution_status_value := resolution_record.status;
  listing_id_value := COALESCE(resolution_record.listing_id, '');
  variant_id_value := COALESCE(resolution_record.variant_id, '');
  IF resolution_status_value NOT IN ('matched', 'ambiguous', 'unresolved')
    OR (resolution_status_value = 'matched' AND (listing_id_value = '' OR variant_id_value = ''))
    OR (resolution_status_value <> 'matched' AND (listing_id_value <> '' OR variant_id_value <> '')) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'terminal-decision catalog binding is inconsistent';
  END IF;
  IF pg_catalog.length(resolution_record.method) < 1
    OR pg_catalog.length(resolution_record.method) > 100
    OR resolution_record.method <> pg_catalog.btrim(resolution_record.method)
    OR resolution_record.method ~ '[[:cntrl:]]'
    OR pg_catalog.length(resolution_record.reason) < 1
    OR pg_catalog.length(resolution_record.reason) > 500
    OR resolution_record.reason <> pg_catalog.btrim(resolution_record.reason)
    OR resolution_record.reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'terminal-decision resolution evidence is invalid';
  END IF;

  offer_value := event_record.offer_json::jsonb;
  IF pg_catalog.jsonb_typeof(offer_value) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'terminal-decision offer evidence is invalid';
  END IF;
  availability_value := COALESCE(offer_value->>'availability', '');
  IF availability_value NOT IN ('in_stock', 'preorder', 'out_of_stock', 'unknown')
    OR pg_catalog.length(event_record.signal_id) < 1
    OR pg_catalog.length(event_record.signal_id) > 160
    OR event_record.signal_id <> pg_catalog.btrim(event_record.signal_id)
    OR event_record.signal_id ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'terminal-decision signal evidence is invalid';
  END IF;

  IF event_record.test <> 0 THEN
    decision_outcome_value := 'test_signal';
    IF listing_id_value = '' THEN
      decision_reason_value := 'Dry-run signal recorded. ' || resolution_record.reason;
      audit_data := pg_catalog.jsonb_build_object(
        'resolutionMethod', resolution_record.method
      );
    ELSE
      decision_reason_value :=
        'Connectivity test received and resolved; test signals are always dry-run only.';
      audit_data := pg_catalog.jsonb_build_object('listingId', listing_id_value);
    END IF;
  ELSIF resolution_status_value <> 'matched' THEN
    decision_outcome_value := CASE
      WHEN resolution_status_value = 'ambiguous' THEN 'ambiguous_identity'
      ELSE 'unresolved_identity'
    END;
    decision_reason_value := resolution_record.reason;
    audit_data := pg_catalog.jsonb_build_object(
      'resolutionMethod', resolution_record.method
    );
  ELSIF event_record.event_type NOT IN ('in_stock', 'restock', 'preorder')
    OR availability_value NOT IN ('in_stock', 'preorder') THEN
    decision_outcome_value := 'non_actionable_event';
    decision_reason_value :=
      'The signal was recorded as source evidence, but its event or availability is not actionable.';
    audit_data := pg_catalog.jsonb_build_object(
      'eventType', event_record.event_type,
      'availability', availability_value,
      'listingId', listing_id_value
    );
  END IF;

  IF decision_outcome_value <> '' THEN
    IF pg_catalog.length(decision_reason_value) < 1
      OR pg_catalog.length(decision_reason_value) > 500
      OR decision_reason_value <> pg_catalog.btrim(decision_reason_value)
      OR decision_reason_value ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'terminal-decision outcome reason is invalid';
    END IF;

    SELECT COUNT(*) INTO occurrence_count
    FROM ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
    WHERE occurrence.event_id = event_record.id;
    SELECT COUNT(*) INTO mission_decision_count
    FROM ${relation(manifest.schemaName, "mission_decisions")} AS decision
    WHERE decision.event_id = event_record.id;
    SELECT COUNT(*) INTO audit_count
    FROM ${relation(manifest.schemaName, "audit_events")} AS audit
    WHERE audit.tenant_id = resolved_tenant_id
      AND audit.user_id = resolved_user_id
      AND audit.correlation_id = event_record.signal_id
      AND audit.event_type = 'signal_decided';
    SELECT COUNT(*) INTO outbox_count
    FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
    WHERE outbox.tenant_id = resolved_tenant_id
      AND outbox.aggregate_type = 'signal'
      AND outbox.aggregate_id = event_record.signal_id
      AND outbox.event_type = 'signal_decided';

    IF occurrence_count = 0 AND mission_decision_count = 0
      AND audit_count = 0 AND outbox_count = 0 THEN
      outcome_value := 'apply_terminal';
      occurrence_action_value := 'insert';
      mission_decision_action_value := 'insert';
      audit_action_value := 'insert';
      outbox_action_value := 'insert';
      mutation_statement_count := 4;
    ELSIF occurrence_count = 1 AND mission_decision_count = 1
      AND audit_count = 1 AND outbox_count = 1 THEN
      SELECT occurrence.* INTO occurrence_record
      FROM ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
      WHERE occurrence.event_id = event_record.id;
      SELECT decision.* INTO mission_decision_record
      FROM ${relation(manifest.schemaName, "mission_decisions")} AS decision
      WHERE decision.event_id = event_record.id;
      SELECT audit.* INTO audit_record
      FROM ${relation(manifest.schemaName, "audit_events")} AS audit
      WHERE audit.tenant_id = resolved_tenant_id
        AND audit.user_id = resolved_user_id
        AND audit.correlation_id = event_record.signal_id
        AND audit.event_type = 'signal_decided';
      SELECT outbox.* INTO outbox_record
      FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
      WHERE outbox.tenant_id = resolved_tenant_id
        AND outbox.aggregate_type = 'signal'
        AND outbox.aggregate_id = event_record.signal_id
        AND outbox.event_type = 'signal_decided';

      IF occurrence_record.id !~ '^occurrence_[a-f0-9]{32}$'
        OR mission_decision_record.id !~ '^mission_decision_[a-f0-9]{32}$'
        OR audit_record.id !~ '^audit_[a-f0-9]{32}$'
        OR outbox_record.id !~ '^outbox_[a-f0-9]{32}$'
        OR occurrence_record.created_at <> mission_decision_record.created_at
        OR occurrence_record.created_at <> audit_record.created_at
        OR occurrence_record.created_at <> outbox_record.created_at
        OR occurrence_record.incident_id IS NOT NULL
        OR occurrence_record.source_connection_id <> event_record.source_connection_id
        OR occurrence_record.observed_at <> event_record.observed_at
        OR occurrence_record.received_at <> event_record.received_at
        OR mission_decision_record.incident_id IS NOT NULL
        OR mission_decision_record.mission_id IS NOT NULL
        OR mission_decision_record.strategy_id IS NOT NULL
        OR mission_decision_record.strategy_revision IS NOT NULL
        OR mission_decision_record.decision_source <> 'strategy'
        OR mission_decision_record.outcome <> decision_outcome_value
        OR mission_decision_record.reason <> decision_reason_value
        OR mission_decision_record.effective_action <> 'notify'
        OR mission_decision_record.effective_quantity <> 1
        OR mission_decision_record.effective_unit_cap_cents IS NOT NULL
        OR audit_record.reason_code <> decision_outcome_value
        OR audit_record.message <> decision_reason_value
        OR audit_record.data_json::jsonb <> audit_data
        OR outbox_record.payload_json::jsonb <> pg_catalog.jsonb_build_object(
          'auditId', audit_record.id,
          'correlationId', event_record.signal_id,
          'reasonCode', decision_outcome_value,
          'message', decision_reason_value,
          'data', audit_data
        ) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'existing terminal signal decision is inconsistent';
      END IF;
      outcome_value := 'already_terminal';
    ELSE
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'partial terminal signal decision fails closed';
    END IF;
  END IF;

  decision_reason_hash_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(decision_reason_value, 'UTF8')), 'hex'
  );
  audit_data_hash_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(audit_data::text, 'UTF8')), 'hex'
  );
  plan_input := ${planParts};
  plan_fingerprint_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(plan_input, 'UTF8')), 'hex'
  );
  plan_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_id_value,
    'payloadHash', payload_hash_value,
    'evaluatedAt', evaluation_timestamp,
    'validUntil', valid_until_timestamp,
    'eventId', event_record.id,
    'resolutionDecisionId', resolution_record.id,
    'resolutionStatus', resolution_status_value,
    'listingId', listing_id_value,
    'variantId', variant_id_value,
    'sourceReferenceOutcome', source_reference_outcome_value,
    'outcome', outcome_value,
    'decisionOutcome', decision_outcome_value,
    'decisionReasonHash', decision_reason_hash_value,
    'auditDataHash', audit_data_hash_value,
    'occurrenceAction', occurrence_action_value,
    'missionDecisionAction', mission_decision_action_value,
    'auditAction', audit_action_value,
    'outboxAction', outbox_action_value,
    'mutationStatementCount', mutation_statement_count,
    'terminalDecisionApplyWillApply', outcome_value = 'apply_terminal',
    'sharedCatalogMutation', FALSE,
    'sourceReferenceMutation', FALSE,
    'incidentMutation', FALSE,
    'rawSignalPayloadReturned', FALSE,
    'planFingerprint', plan_fingerprint_value
  );
  IF operation_name = 'plan' THEN
    RETURN QUERY SELECT plan_value::text;
    RETURN;
  END IF;

  apply_payload := apply_payload_json::jsonb;
  IF pg_catalog.jsonb_typeof(apply_payload) <> 'object'
    OR apply_payload - ARRAY['planFingerprint']::text[] IS DISTINCT FROM '{}'::jsonb
    OR pg_catalog.jsonb_typeof(apply_payload->'planFingerprint') IS DISTINCT FROM 'string'
    OR apply_payload->>'planFingerprint' <> plan_fingerprint_value THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal terminal-decision apply payload does not match its current plan';
  END IF;

  IF outcome_value = 'apply_terminal' THEN
    occurrence_id_value :=
      'occurrence_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    mission_decision_id_value :=
      'mission_decision_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    audit_id_value := 'audit_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    outbox_id_value := 'outbox_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');

    INSERT INTO ${relation(manifest.schemaName, "signal_occurrences")}(
      id, event_id, incident_id, source_connection_id,
      observed_at, received_at, created_at
    ) VALUES (
      occurrence_id_value, event_record.id, NULL, event_record.source_connection_id,
      event_record.observed_at, event_record.received_at, evaluation_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "mission_decisions")}(
      id, event_id, incident_id, mission_id, strategy_id, strategy_revision,
      decision_source, outcome, reason, effective_action, effective_quantity,
      effective_unit_cap_cents, created_at
    ) VALUES (
      mission_decision_id_value, event_record.id, NULL, NULL, NULL, NULL,
      'strategy', decision_outcome_value, decision_reason_value, 'notify', 1,
      NULL, evaluation_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
      id, tenant_id, user_id, correlation_id, event_type,
      reason_code, message, data_json, created_at
    ) VALUES (
      audit_id_value, resolved_tenant_id, resolved_user_id, event_record.signal_id,
      'signal_decided', decision_outcome_value, decision_reason_value,
      audit_data::text, evaluation_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
      id, tenant_id, aggregate_type, aggregate_id, event_type,
      payload_json, created_at, delivered_at
    ) VALUES (
      outbox_id_value, resolved_tenant_id, 'signal', event_record.signal_id,
      'signal_decided',
      pg_catalog.jsonb_build_object(
        'auditId', audit_id_value,
        'correlationId', event_record.signal_id,
        'reasonCode', decision_outcome_value,
        'message', decision_reason_value,
        'data', audit_data
      )::text,
      evaluation_timestamp, ''
    );
  END IF;

  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_id_value,
    'planFingerprint', plan_fingerprint_value,
    'eventId', event_record.id,
    'resolutionDecisionId', resolution_record.id,
    'sourceReferenceOutcome', source_reference_outcome_value,
    'outcome', outcome_value,
    'decisionOutcome', decision_outcome_value,
    'occurrenceAction', occurrence_action_value,
    'missionDecisionAction', mission_decision_action_value,
    'auditAction', audit_action_value,
    'outboxAction', outbox_action_value,
    'mutationStatementCount', mutation_statement_count,
    'terminalDecisionApplyApplied', outcome_value = 'apply_terminal',
    'continueDownstream', outcome_value = 'continue_downstream',
    'mutationAuthority', TRUE,
    'idempotentReplay', TRUE,
    'sharedCatalogMutated', FALSE,
    'sourceReferencesMutated', FALSE,
    'incidentsMutated', FALSE,
    'offersMutated', FALSE,
    'missionsMutated', FALSE,
    'actionsMutated', FALSE,
    'terminalSignalGraphMutated', outcome_value = 'apply_terminal',
    'remainingDownstreamSignalGraphMutated', FALSE,
    'inboxLifecycleMutated', FALSE,
    'rawSignalPayloadReturned', FALSE
  )::text;
END
`;
}

export function buildPostgresSignalTerminalDecisionApplyManifest(
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
  requestedCatalogApplyRoleNamespace = "yoink_catalog_qualification",
  requestedResolutionApplyRoleNamespace = "yoink_resolution_qualification",
  requestedSourceReferenceRefreshRoleNamespace = "yoink_ref_qualification",
  requestedTerminalDecisionApplyRoleNamespace = "yoink_terminal_qualification"
): PostgresSignalTerminalDecisionApplyManifest {
  const values = [
    safeSchema(requestedSchema),
    safeNamespace(requestedReadRoleNamespace, "yoink_qualification"),
    safeNamespace(requestedSessionRoleNamespace, "yoink_session_qualification"),
    safeNamespace(requestedQueueWriteRoleNamespace, "yoink_queue_write_qualification"),
    safeNamespace(requestedControlRoleNamespace, "yoink_control_qualification"),
    safeNamespace(requestedNotificationRecoveryRoleNamespace, "yoink_notify_qualification"),
    safeNamespace(requestedExecutionRecoveryRoleNamespace, "yoink_execute_qualification"),
    safeNamespace(requestedOperationalRetentionRoleNamespace, "yoink_retention_qualification"),
    safeNamespace(requestedObserverCandidateRoleNamespace, "yoink_candidate_qualification"),
    safeNamespace(requestedAlertDispatchRoleNamespace, "yoink_dispatch_qualification"),
    safeNamespace(requestedAlertReconciliationRoleNamespace, "yoink_reconcile_qualification"),
    safeNamespace(requestedWitnessRefreshRoleNamespace, "yoink_witness_qualification"),
    safeNamespace(requestedLeaseRecoveryRoleNamespace, "yoink_delivery_qualification"),
    safeNamespace(requestedCatalogApplyRoleNamespace, "yoink_catalog_qualification"),
    safeNamespace(requestedResolutionApplyRoleNamespace, "yoink_resolution_qualification"),
    safeNamespace(requestedSourceReferenceRefreshRoleNamespace, "yoink_ref_qualification"),
    safeNamespace(requestedTerminalDecisionApplyRoleNamespace, "yoink_terminal_qualification")
  ] as const;
  const [schemaName, readRoleNamespace, sessionRoleNamespace, queueWriteRoleNamespace,
    controlRoleNamespace, notificationRecoveryRoleNamespace, executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace, observerCandidateRoleNamespace, alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace, witnessRefreshRoleNamespace, leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace, resolutionApplyRoleNamespace,
    sourceReferenceRefreshRoleNamespace,
    terminalDecisionApplyRoleNamespace] = values;
  if (new Set(values.slice(1)).size !== values.length - 1) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision role namespace must be independent."
    );
  }
  const previous = buildPostgresSignalSourceReferenceRefreshManifest(
    schemaName, readRoleNamespace, sessionRoleNamespace, queueWriteRoleNamespace,
    controlRoleNamespace, notificationRecoveryRoleNamespace, executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace, observerCandidateRoleNamespace, alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace, witnessRefreshRoleNamespace, leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace, resolutionApplyRoleNamespace,
    sourceReferenceRefreshRoleNamespace
  );
  const withoutFingerprint: Omit<PostgresSignalTerminalDecisionApplyManifest, "fingerprint"> = {
    contractVersion: POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    hostedDeliveryContractVersion: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
    catalogApplyContractVersion: POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION,
    resolutionApplyContractVersion: POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION,
    sourceReferenceRefreshContractVersion:
      POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION,
    schemaName,
    readRoleNamespace,
    sessionRoleNamespace,
    queueWriteRoleNamespace,
    controlRoleNamespace,
    notificationRecoveryRoleNamespace,
    executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace,
    observerCandidateRoleNamespace,
    alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace,
    witnessRefreshRoleNamespace,
    leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace,
    resolutionApplyRoleNamespace,
    sourceReferenceRefreshRoleNamespace,
    terminalDecisionApplyRoleNamespace,
    sourceReferenceRefreshManifestFingerprint: previous.fingerprint,
    terminalDecisionApplyRole: {
      kind: "signal_terminal_decision_apply_boundary",
      name: roleName(terminalDecisionApplyRoleNamespace),
      functionName: POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTenantTableCount: 11,
    forcedRlsTableCount: 11,
    mutationTableCount: 4,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    maximumPlanAgeSeconds: 30,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    committedResolutionBinding: true,
    settledSourceReferenceRequired: true,
    terminalOutcomeDerivation: true,
    testSignalTerminalOnly: true,
    nonActionableTerminalOnly: true,
    idempotentReplay: true,
    signalOccurrenceRepositoryParity: true,
    terminalMissionDecisionRepositoryParity: true,
    terminalAuditOutboxRepositoryParity: true,
    sharedCatalogMutation: false,
    sourceReferenceMutation: false,
    incidentMutation: false,
    offerObservationMutation: false,
    missionMutation: false,
    actionMutation: false,
    terminalSignalEvaluationRepositoryParity: true,
    terminalSignalGraphMutation: true,
    remainingDownstreamSignalGraphMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    mutationAuthority: true,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresSignalTerminalDecisionApplyCapabilityProjection():
PostgresSignalTerminalDecisionApplyCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalTerminalDecisionApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    hostedDeliveryContractVersion: 3,
    catalogApplyContractVersion: 1,
    resolutionApplyContractVersion: 1,
    sourceReferenceRefreshContractVersion: 1,
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
    databasePlanRevalidation: true,
    twoPhasePlanApply: true,
    readCommittedTransactionAdapter: true,
    committedResolutionBinding: true,
    settledSourceReferenceRequired: true,
    terminalOutcomeDerivation: true,
    testSignalTerminalOnly: true,
    nonActionableTerminalOnly: true,
    idempotentReplay: true,
    signalOccurrenceRepositoryParity: true,
    terminalMissionDecisionRepositoryParity: true,
    terminalAuditOutboxRepositoryParity: true,
    sharedCatalogMutation: false,
    sourceReferenceMutation: false,
    incidentMutation: false,
    offerObservationMutation: false,
    missionMutation: false,
    actionMutation: false,
    terminalSignalEvaluationRepositoryParity: true,
    terminalSignalGraphMutation: true,
    remainingDownstreamSignalGraphMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    maximumPlanAgeSeconds: 30,
    protectedTenantTableCount: 11,
    forcedRlsTableCount: 11,
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

async function inspectBoundary(
  session: PostgresQuerySession,
  manifest: PostgresSignalTerminalDecisionApplyManifest
): Promise<BoundaryInspection> {
  const role = manifest.terminalDecisionApplyRole.name;
  const roleResult = await session.query<RoleRow>(
    `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles WHERE rolname = $1`,
    [role]
  );
  const roleRow = roleResult.rows[0];
  if (roleResult.rows.length !== 1 || !roleRow || roleRow.rolname !== role
    || roleRow.rolsuper || roleRow.rolinherit || roleRow.rolcreaterole
    || roleRow.rolcreatedb || roleRow.rolcanlogin || roleRow.rolreplication
    || roleRow.rolbypassrls) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision role attributes are unsafe."
    );
  }

  const memberships = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_auth_members membership
     JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
     JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid
     WHERE member_role.rolname = $1 OR granted_role.rolname = $1`,
    [role]
  );
  if (exactInteger(memberships.rows[0]?.count, "membership count") !== 0) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision role must have no membership."
    );
  }

  const directGrants = await session.query<{ count: string | number | bigint }>(
    `SELECT (
       SELECT COUNT(*) FROM information_schema.role_table_grants
       WHERE grantee = $1 AND table_schema = $2
     ) + (
       SELECT COUNT(*) FROM information_schema.role_column_grants
       WHERE grantee = $1 AND table_schema = $2
     ) AS count`,
    [role, manifest.schemaName]
  );
  if (exactInteger(directGrants.rows[0]?.count, "direct grant count") !== 0) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision role has a direct table or column grant."
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
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision role has an unauthorized effective table privilege."
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
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision role has an unauthorized effective column privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision role has an invalid schema privilege."
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
    || routine.routineName !== POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE
    || routine.volatility !== "v" || routine.securityDefiner !== true
    || routine.strict !== true || routine.leakproof !== false
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role || routine.source !== signalTerminalDecisionApplyFunctionSource(manifest)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision function boundary is incomplete."
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
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision function grant is not exact."
    );
  }

  const protectedTables = await session.query<{
    tableName: string;
    enabled: boolean;
    forced: boolean;
  }>(
    `SELECT relation.relname AS "tableName", relation.relrowsecurity AS enabled,
            relation.relforcerowsecurity AS forced
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1 AND relation.relname = ANY($2::text[])
     ORDER BY relation.relname`,
    [manifest.schemaName, [...PROTECTED_TENANT_TABLES]]
  );
  if (protectedTables.rows.length !== PROTECTED_TENANT_TABLES.length
    || protectedTables.rows.some((row) => !row.enabled || !row.forced)
    || protectedTables.rows.map((row) => row.tableName).join(",")
      !== [...PROTECTED_TENANT_TABLES].sort().join(",")) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision protected table set is incomplete."
    );
  }
  const mutationTables = protectedTables.rows.filter((row) =>
    (MUTATION_TABLES as readonly string[]).includes(row.tableName)
  );
  if (mutationTables.map((row) => row.tableName).join(",")
    !== [...MUTATION_TABLES].sort().join(",")) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision mutation table set is incomplete."
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
  if (exactInteger(accessibleSequences.rows[0]?.count, "sequence count") !== 0) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision role must not access application sequences."
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
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision role must not own application objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision role must not depend on a direct table policy."
    );
  }

  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  if (exactInteger(principals.rows[0]?.count, "active principal count") !== 0) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "Signal-terminal-decision qualification cannot activate a runtime principal."
    );
  }
  return {
    protectedTenantTableCount: protectedTables.rows.length,
    forcedRlsTableCount: protectedTables.rows.filter((row) => row.forced).length,
    mutationTableCount: mutationTables.length,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    boundaryCatalogFingerprint: fingerprint({
      role: roleRow,
      routine,
      routineAcl: routineAcl.rows,
      protectedTables: protectedTables.rows,
      mutationTables
    })
  };
}

function receiptFromRow(
  row: ReceiptRow,
  manifest: PostgresSignalTerminalDecisionApplyManifest
): PostgresSignalTerminalDecisionApplyQualificationReceipt {
  if (row.phase !== "verified"
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.source_reference_refresh_manifest_fingerprint
      !== manifest.sourceReferenceRefreshManifestFingerprint
    || row.terminal_decision_apply_role_name !== manifest.terminalDecisionApplyRole.name
    || !SHA256.test(row.boundary_catalog_fingerprint)
    || row.server_bound_principal_lookup !== true
    || row.database_plan_revalidation !== true
    || row.committed_resolution_binding !== true
    || row.settled_source_reference_required !== true
    || row.terminal_outcome_derivation !== true
    || row.test_signal_terminal_only !== true
    || row.non_actionable_terminal_only !== true
    || row.idempotent_replay !== true
    || row.signal_occurrence_repository_parity !== true
    || row.terminal_mission_decision_repository_parity !== true
    || row.terminal_audit_outbox_repository_parity !== true
    || row.shared_catalog_mutation !== false
    || row.source_reference_mutation !== false
    || row.incident_mutation !== false
    || row.offer_observation_mutation !== false
    || row.mission_mutation !== false
    || row.action_mutation !== false
    || row.terminal_signal_evaluation_repository_parity !== true
    || row.terminal_signal_graph_mutation !== true
    || row.remaining_downstream_signal_graph_mutation !== false
    || row.inbox_lifecycle_mutation !== false
    || row.raw_signal_payload_returned !== false
    || row.signal_evaluation_apply_repository_parity !== false
    || row.hosted_delivery_handler_repository_parity !== false
    || row.mutation_authority !== true
    || row.direct_table_access !== false
    || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision receipt is incomplete or unsafe."
    );
  }
  const counts = [
    [row.contract_version, 1, "contract version"],
    [row.cutover_contract_version, 3, "cutover contract version"],
    [row.hosted_delivery_contract_version, 3, "hosted-delivery contract version"],
    [row.catalog_apply_contract_version, 1, "catalog-apply contract version"],
    [row.resolution_apply_contract_version, 1, "resolution-apply contract version"],
    [row.source_reference_refresh_contract_version, 1, "source-reference contract version"],
    [row.protected_tenant_table_count, 11, "protected table count"],
    [row.forced_rls_table_count, 11, "forced RLS table count"],
    [row.mutation_table_count, 4, "mutation table count"],
    [row.direct_table_grant_count, 0, "direct grant count"],
    [row.function_grant_count, 1, "function grant count"],
    [row.membership_count, 0, "membership count"],
    [row.active_principal_count, 0, "active principal count"],
    [row.maximum_plan_age_seconds, 30, "plan age"]
  ] as const;
  for (const [value, expected, label] of counts) {
    if (exactInteger(value, label) !== expected) {
      throw new PostgresSignalTerminalDecisionApplyQualificationError(
        "The PostgreSQL signal-terminal-decision receipt uses an unsupported contract."
      );
    }
  }
  return {
    contractVersion: 1,
    cutoverContractVersion: 3,
    hostedDeliveryContractVersion: 3,
    catalogApplyContractVersion: 1,
    resolutionApplyContractVersion: 1,
    sourceReferenceRefreshContractVersion: 1,
    phase: "verified",
    schemaName: manifest.schemaName,
    roleManifestFingerprint: manifest.fingerprint,
    sourceReferenceRefreshManifestFingerprint:
      manifest.sourceReferenceRefreshManifestFingerprint,
    terminalDecisionApplyRoleName: manifest.terminalDecisionApplyRole.name,
    protectedTenantTableCount: 11,
    forcedRlsTableCount: 11,
    mutationTableCount: 4,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    maximumPlanAgeSeconds: 30,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    committedResolutionBinding: true,
    settledSourceReferenceRequired: true,
    terminalOutcomeDerivation: true,
    testSignalTerminalOnly: true,
    nonActionableTerminalOnly: true,
    idempotentReplay: true,
    signalOccurrenceRepositoryParity: true,
    terminalMissionDecisionRepositoryParity: true,
    terminalAuditOutboxRepositoryParity: true,
    sharedCatalogMutation: false,
    sourceReferenceMutation: false,
    incidentMutation: false,
    offerObservationMutation: false,
    missionMutation: false,
    actionMutation: false,
    terminalSignalEvaluationRepositoryParity: true,
    terminalSignalGraphMutation: true,
    remainingDownstreamSignalGraphMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    mutationAuthority: true,
    directTableAccess: false,
    runtimeAuthority: false,
    productionReady: false,
    boundaryCatalogFingerprint: row.boundary_catalog_fingerprint,
    appliedAt: exactTimestamp(row.applied_at, "application timestamp"),
    verifiedAt: exactTimestamp(row.verified_at, "verification timestamp")
  };
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresSignalTerminalDecisionApplyManifest
): Promise<PostgresSignalTerminalDecisionApplyQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_RECEIPT_TABLE)}
     WHERE singleton = TRUE`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresSignalTerminalDecisionApplyQualificationReceipt,
  manifest: PostgresSignalTerminalDecisionApplyManifest
): void {
  if (inspection.protectedTenantTableCount !== receipt.protectedTenantTableCount
    || inspection.forcedRlsTableCount !== receipt.forcedRlsTableCount
    || inspection.mutationTableCount !== receipt.mutationTableCount
    || inspection.directTableGrantCount !== receipt.directTableGrantCount
    || inspection.functionGrantCount !== receipt.functionGrantCount
    || inspection.membershipCount !== receipt.membershipCount
    || inspection.activePrincipalCount !== receipt.activePrincipalCount
    || inspection.boundaryCatalogFingerprint !== receipt.boundaryCatalogFingerprint
    || receipt.roleManifestFingerprint !== manifest.fingerprint) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresSignalTerminalDecisionApplyBoundary(
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
  requestedCatalogApplyRoleNamespace = "yoink_catalog_qualification",
  requestedResolutionApplyRoleNamespace = "yoink_resolution_qualification",
  requestedSourceReferenceRefreshRoleNamespace = "yoink_ref_qualification",
  requestedTerminalDecisionApplyRoleNamespace = "yoink_terminal_qualification"
): Promise<PostgresSignalTerminalDecisionApplyQualificationReceipt> {
  const manifest = buildPostgresSignalTerminalDecisionApplyManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
    requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace,
    requestedSourceReferenceRefreshRoleNamespace,
    requestedTerminalDecisionApplyRoleNamespace
  );
  await verifyPostgresSignalSourceReferenceRefreshBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace, manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace, manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace, manifest.leaseRecoveryRoleNamespace,
    manifest.catalogApplyRoleNamespace, manifest.resolutionApplyRoleNamespace,
    manifest.sourceReferenceRefreshRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresSignalTerminalDecisionApplyBoundary(
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
  requestedCatalogApplyRoleNamespace = "yoink_catalog_qualification",
  requestedResolutionApplyRoleNamespace = "yoink_resolution_qualification",
  requestedSourceReferenceRefreshRoleNamespace = "yoink_ref_qualification",
  requestedTerminalDecisionApplyRoleNamespace = "yoink_terminal_qualification",
  now = Date.now()
): Promise<PostgresSignalTerminalDecisionApplyQualificationReceipt> {
  if (!Number.isSafeInteger(now)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision qualification timestamp is invalid."
    );
  }
  const manifest = buildPostgresSignalTerminalDecisionApplyManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
    requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace,
    requestedSourceReferenceRefreshRoleNamespace,
    requestedTerminalDecisionApplyRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "Signal-terminal-decision qualification requires the supported cutover role with BYPASSRLS."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    `SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user`
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "Signal-terminal-decision qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresSignalSourceReferenceRefreshBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace, manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace, manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace, manifest.leaseRecoveryRoleNamespace,
    manifest.catalogApplyRoleNamespace, manifest.resolutionApplyRoleNamespace,
    manifest.sourceReferenceRefreshRoleNamespace
  );
  const appliedAt = nowIso(now);
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
        manifest.terminalDecisionApplyRole.name,
        manifest.schemaName,
        POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_RECEIPT_TABLE,
        [POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION, "yoink_guard_signal_terminal_decision_apply_receipt"]
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing object count") !== 0) {
      throw new PostgresSignalTerminalDecisionApplyQualificationError(
        "Signal-terminal-decision qualification refuses an existing role, function, guard, or receipt."
      );
    }
    await session.query(
      `CREATE ROLE ${identifier(manifest.terminalDecisionApplyRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.terminalDecisionApplyRole.name)}`
    );
    for (const table of PROTECTED_TENANT_TABLES) {
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} ENABLE ROW LEVEL SECURITY`);
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} FORCE ROW LEVEL SECURITY`);
    }
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION)}(
         expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
         target_message_id TEXT, capability_token TEXT,
         evaluation_timestamp_input TEXT, apply_payload_json TEXT
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${signalTerminalDecisionApplyFunctionSource(manifest)}$yoink$`
    );
    const signature = `${relation(
      manifest.schemaName,
      POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION
    )}(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)`;
    await session.query(`REVOKE ALL PRIVILEGES ON FUNCTION ${signature} FROM PUBLIC`);
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${signature} TO ${identifier(manifest.terminalDecisionApplyRole.name)}`
    );
    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_RECEIPT_TABLE)}(
         singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
         contract_version BIGINT NOT NULL CHECK (contract_version = 1),
         cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = 3),
         hosted_delivery_contract_version BIGINT NOT NULL CHECK (hosted_delivery_contract_version = 3),
         catalog_apply_contract_version BIGINT NOT NULL CHECK (catalog_apply_contract_version = 1),
         resolution_apply_contract_version BIGINT NOT NULL CHECK (resolution_apply_contract_version = 1),
         source_reference_refresh_contract_version BIGINT NOT NULL
           CHECK (source_reference_refresh_contract_version = 1),
         phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
         role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         source_reference_refresh_manifest_fingerprint TEXT NOT NULL
           CHECK (source_reference_refresh_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         terminal_decision_apply_role_name TEXT NOT NULL,
         protected_tenant_table_count BIGINT NOT NULL CHECK (protected_tenant_table_count = 11),
         forced_rls_table_count BIGINT NOT NULL CHECK (forced_rls_table_count = 11),
         mutation_table_count BIGINT NOT NULL CHECK (mutation_table_count = 4),
         direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
         function_grant_count BIGINT NOT NULL CHECK (function_grant_count = 1),
         membership_count BIGINT NOT NULL CHECK (membership_count = 0),
         active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
         maximum_plan_age_seconds BIGINT NOT NULL CHECK (maximum_plan_age_seconds = 30),
         server_bound_principal_lookup BOOLEAN NOT NULL CHECK (server_bound_principal_lookup = TRUE),
         database_plan_revalidation BOOLEAN NOT NULL CHECK (database_plan_revalidation = TRUE),
         committed_resolution_binding BOOLEAN NOT NULL CHECK (committed_resolution_binding = TRUE),
         settled_source_reference_required BOOLEAN NOT NULL CHECK (settled_source_reference_required = TRUE),
         terminal_outcome_derivation BOOLEAN NOT NULL CHECK (terminal_outcome_derivation = TRUE),
         test_signal_terminal_only BOOLEAN NOT NULL CHECK (test_signal_terminal_only = TRUE),
         non_actionable_terminal_only BOOLEAN NOT NULL CHECK (non_actionable_terminal_only = TRUE),
         idempotent_replay BOOLEAN NOT NULL CHECK (idempotent_replay = TRUE),
         signal_occurrence_repository_parity BOOLEAN NOT NULL CHECK (signal_occurrence_repository_parity = TRUE),
         terminal_mission_decision_repository_parity BOOLEAN NOT NULL
           CHECK (terminal_mission_decision_repository_parity = TRUE),
         terminal_audit_outbox_repository_parity BOOLEAN NOT NULL
           CHECK (terminal_audit_outbox_repository_parity = TRUE),
         shared_catalog_mutation BOOLEAN NOT NULL CHECK (shared_catalog_mutation = FALSE),
         source_reference_mutation BOOLEAN NOT NULL CHECK (source_reference_mutation = FALSE),
         incident_mutation BOOLEAN NOT NULL CHECK (incident_mutation = FALSE),
         offer_observation_mutation BOOLEAN NOT NULL CHECK (offer_observation_mutation = FALSE),
         mission_mutation BOOLEAN NOT NULL CHECK (mission_mutation = FALSE),
         action_mutation BOOLEAN NOT NULL CHECK (action_mutation = FALSE),
         terminal_signal_evaluation_repository_parity BOOLEAN NOT NULL
           CHECK (terminal_signal_evaluation_repository_parity = TRUE),
         terminal_signal_graph_mutation BOOLEAN NOT NULL CHECK (terminal_signal_graph_mutation = TRUE),
         remaining_downstream_signal_graph_mutation BOOLEAN NOT NULL
           CHECK (remaining_downstream_signal_graph_mutation = FALSE),
         inbox_lifecycle_mutation BOOLEAN NOT NULL CHECK (inbox_lifecycle_mutation = FALSE),
         raw_signal_payload_returned BOOLEAN NOT NULL CHECK (raw_signal_payload_returned = FALSE),
         signal_evaluation_apply_repository_parity BOOLEAN NOT NULL CHECK (signal_evaluation_apply_repository_parity = FALSE),
         hosted_delivery_handler_repository_parity BOOLEAN NOT NULL CHECK (hosted_delivery_handler_repository_parity = FALSE),
         mutation_authority BOOLEAN NOT NULL CHECK (mutation_authority = TRUE),
         direct_table_access BOOLEAN NOT NULL CHECK (direct_table_access = FALSE),
         runtime_authority BOOLEAN NOT NULL CHECK (runtime_authority = FALSE),
         production_ready BOOLEAN NOT NULL CHECK (production_ready = FALSE),
         boundary_catalog_fingerprint TEXT NOT NULL CHECK (boundary_catalog_fingerprint ~ '^[a-f0-9]{64}$'),
         applied_at TEXT NOT NULL,
         verified_at TEXT NOT NULL
       )`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON TABLE
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_RECEIPT_TABLE)} FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_RECEIPT_TABLE)}(
         singleton, contract_version, cutover_contract_version,
         hosted_delivery_contract_version, catalog_apply_contract_version,
         resolution_apply_contract_version, source_reference_refresh_contract_version,
         phase, role_manifest_fingerprint,
         source_reference_refresh_manifest_fingerprint,
         terminal_decision_apply_role_name, protected_tenant_table_count,
         forced_rls_table_count, mutation_table_count, direct_table_grant_count,
         function_grant_count, membership_count, active_principal_count,
         maximum_plan_age_seconds, server_bound_principal_lookup,
         database_plan_revalidation, committed_resolution_binding,
         settled_source_reference_required, terminal_outcome_derivation,
         test_signal_terminal_only, non_actionable_terminal_only,
         idempotent_replay, signal_occurrence_repository_parity,
         terminal_mission_decision_repository_parity,
         terminal_audit_outbox_repository_parity, shared_catalog_mutation,
         source_reference_mutation, incident_mutation,
         offer_observation_mutation, mission_mutation, action_mutation,
         terminal_signal_evaluation_repository_parity,
         terminal_signal_graph_mutation,
         remaining_downstream_signal_graph_mutation, inbox_lifecycle_mutation,
         raw_signal_payload_returned, signal_evaluation_apply_repository_parity,
         hosted_delivery_handler_repository_parity, mutation_authority,
         direct_table_access, runtime_authority, production_ready,
         boundary_catalog_fingerprint, applied_at, verified_at
       ) VALUES (
         TRUE, 1, 3, 3, 1, 1, 1, 'loading', $1, $2, $3,
         11, 11, 4, 0, 1, 0, 0, 30,
         TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE,
         TRUE, TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
         TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE,
         TRUE, FALSE, FALSE, FALSE, repeat('0', 64), $4, ''
       )`,
      [
        manifest.fingerprint,
        manifest.sourceReferenceRefreshManifestFingerprint,
        manifest.terminalDecisionApplyRole.name,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_RECEIPT_TABLE)}
       SET phase = 'verified', boundary_catalog_fingerprint = $1, verified_at = $2
       WHERE singleton = TRUE AND phase = 'loading'`,
      [inspection.boundaryCatalogFingerprint, verifiedAt]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_guard_signal_terminal_decision_apply_receipt")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $guard$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal-terminal-decision receipt is immutable';
       END
       $guard$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_signal_terminal_decision_apply_receipt")}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_signal_terminal_decision_apply_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_signal_terminal_decision_apply_receipt")}()`
    );
    const receipt = await readReceipt(session, manifest);
    const finalInspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(finalInspection, receipt, manifest);
    return receipt;
  });
}

function exactObject(
  value: unknown,
  label: string,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      `The PostgreSQL signal-terminal-decision ${label} is invalid.`
    );
  }
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...expectedKeys].sort())) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      `The PostgreSQL signal-terminal-decision ${label} has an unexpected shape.`
    );
  }
  return record;
}

function parseFunctionJson(value: unknown, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? "")) as unknown;
  } catch {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      `The PostgreSQL signal-terminal-decision ${label} is not valid JSON.`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      `The PostgreSQL signal-terminal-decision ${label} is invalid.`
    );
  }
  return parsed as Record<string, unknown>;
}

function insertAction(value: unknown, label: string): InsertAction {
  const action = exactText(value, label, 10) as InsertAction;
  if (!new Set<InsertAction>(["none", "insert"]).has(action)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      `The PostgreSQL signal-terminal-decision ${label} is invalid.`
    );
  }
  return action;
}

function parsePlan(
  value: Record<string, unknown>,
  principal: BackgroundWorkerPrincipal,
  messageId: string,
  now: number
): PostgresSignalTerminalDecisionApplyPlan {
  const record = exactObject(value, "plan", [
    "contractVersion", "messageId", "payloadHash", "evaluatedAt", "validUntil",
    "eventId", "resolutionDecisionId", "resolutionStatus", "listingId",
    "variantId", "sourceReferenceOutcome", "outcome", "decisionOutcome",
    "decisionReasonHash", "auditDataHash", "occurrenceAction",
    "missionDecisionAction", "auditAction", "outboxAction",
    "mutationStatementCount", "terminalDecisionApplyWillApply",
    "sharedCatalogMutation", "sourceReferenceMutation", "incidentMutation",
    "rawSignalPayloadReturned", "planFingerprint"
  ]);
  if (exactInteger(record.contractVersion, "plan contract version") !== 1
    || record.messageId !== messageId) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision plan identity is invalid."
    );
  }
  const evaluatedAt = exactTimestamp(record.evaluatedAt, "evaluation timestamp");
  const validUntil = exactTimestamp(record.validUntil, "expiry timestamp");
  if (Math.abs(now - Date.parse(evaluatedAt)) > MAXIMUM_CLOCK_SKEW_MS
    || Date.parse(validUntil) <= Date.now()
    || Date.parse(validUntil) <= Date.parse(evaluatedAt)
    || Date.parse(validUntil) - Date.parse(evaluatedAt) > MAXIMUM_PLAN_AGE_SECONDS * 1_000) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision plan lifetime is invalid."
    );
  }
  const resolutionStatus = exactText(
    record.resolutionStatus,
    "resolution status",
    20
  ) as PostgresSignalTerminalDecisionApplyPlan["resolutionStatus"];
  if (!new Set(["matched", "ambiguous", "unresolved"]).has(resolutionStatus)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision resolution status is invalid."
    );
  }
  const listingId = exactText(record.listingId, "listing ID", 200, resolutionStatus !== "matched");
  const variantId = exactText(record.variantId, "variant ID", 200, resolutionStatus !== "matched");
  if ((resolutionStatus === "matched" && (!listingId || !variantId))
    || (resolutionStatus !== "matched" && (listingId !== "" || variantId !== ""))) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision catalog binding is inconsistent."
    );
  }
  const sourceReferenceOutcome = exactText(
    record.sourceReferenceOutcome,
    "source-reference outcome",
    30
  ) as SourceReferenceOutcome;
  if (!new Set<SourceReferenceOutcome>([
    "already_current", "no_reference_identity", "not_matched", "test_signal"
  ]).has(sourceReferenceOutcome)
    || (sourceReferenceOutcome === "not_matched" && resolutionStatus === "matched")
    || (["already_current", "no_reference_identity"].includes(sourceReferenceOutcome)
      && resolutionStatus !== "matched")) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision predecessor outcome is inconsistent."
    );
  }
  const outcome = exactText(record.outcome, "outcome", 30) as TerminalPlanOutcome;
  if (!new Set<TerminalPlanOutcome>([
    "apply_terminal", "already_terminal", "continue_downstream"
  ]).has(outcome)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision plan outcome is invalid."
    );
  }
  const decisionOutcome = exactText(
    record.decisionOutcome,
    "decision outcome",
    40,
    outcome === "continue_downstream"
  ) as TerminalDecisionOutcome | "";
  if ((outcome === "continue_downstream" && decisionOutcome !== "")
    || (outcome !== "continue_downstream"
      && !new Set<TerminalDecisionOutcome>([
        "test_signal", "ambiguous_identity", "unresolved_identity", "non_actionable_event"
      ]).has(decisionOutcome as TerminalDecisionOutcome))) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision outcome is inconsistent."
    );
  }
  const occurrenceAction = insertAction(record.occurrenceAction, "occurrence action");
  const missionDecisionAction = insertAction(
    record.missionDecisionAction,
    "mission-decision action"
  );
  const auditAction = insertAction(record.auditAction, "audit action");
  const outboxAction = insertAction(record.outboxAction, "outbox action");
  const actions = [occurrenceAction, missionDecisionAction, auditAction, outboxAction];
  const mutationStatementCount = exactInteger(
    record.mutationStatementCount,
    "mutation statement count"
  );
  const willApply = outcome === "apply_terminal";
  if (mutationStatementCount !== (willApply ? 4 : 0)
    || actions.some((action) => action !== (willApply ? "insert" : "none"))) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision mutation plan is inconsistent."
    );
  }
  const plan: PostgresSignalTerminalDecisionApplyPlan = {
    contractVersion: 1,
    messageId,
    payloadHash: exactHash(record.payloadHash, "payload hash"),
    evaluatedAt,
    validUntil,
    eventId: exactText(record.eventId, "event ID", 200),
    resolutionDecisionId: exactText(record.resolutionDecisionId, "resolution decision ID", 200),
    resolutionStatus,
    listingId,
    variantId,
    sourceReferenceOutcome,
    outcome,
    decisionOutcome,
    decisionReasonHash: exactHash(record.decisionReasonHash, "decision reason hash"),
    auditDataHash: exactHash(record.auditDataHash, "audit data hash"),
    occurrenceAction,
    missionDecisionAction,
    auditAction,
    outboxAction,
    mutationStatementCount,
    terminalDecisionApplyWillApply: exactBoolean(
      record.terminalDecisionApplyWillApply,
      willApply,
      "terminal apply flag"
    ),
    sharedCatalogMutation: exactBoolean(
      record.sharedCatalogMutation,
      false,
      "shared-catalog flag"
    ) as false,
    sourceReferenceMutation: exactBoolean(
      record.sourceReferenceMutation,
      false,
      "source-reference mutation flag"
    ) as false,
    incidentMutation: exactBoolean(
      record.incidentMutation,
      false,
      "incident mutation flag"
    ) as false,
    rawSignalPayloadReturned: exactBoolean(
      record.rawSignalPayloadReturned,
      false,
      "raw payload flag"
    ) as false,
    planFingerprint: exactHash(record.planFingerprint, "plan fingerprint")
  };
  if (!EVENT_ID.test(plan.eventId) || !RESOLUTION_ID.test(plan.resolutionDecisionId)
    || plan.planFingerprint !== postgresSignalTerminalDecisionApplyPlanFingerprint(principal, plan)) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision plan fingerprint or committed identity is invalid."
    );
  }
  return plan;
}

function parseResult(
  value: Record<string, unknown>,
  plan: PostgresSignalTerminalDecisionApplyPlan
): PostgresSignalTerminalDecisionApplyResult {
  const record = exactObject(value, "apply result", [
    "contractVersion", "messageId", "planFingerprint", "eventId",
    "resolutionDecisionId", "sourceReferenceOutcome", "outcome",
    "decisionOutcome", "occurrenceAction", "missionDecisionAction",
    "auditAction", "outboxAction", "mutationStatementCount",
    "terminalDecisionApplyApplied", "continueDownstream", "mutationAuthority",
    "idempotentReplay", "sharedCatalogMutated", "sourceReferencesMutated",
    "incidentsMutated", "offersMutated", "missionsMutated", "actionsMutated",
    "terminalSignalGraphMutated", "remainingDownstreamSignalGraphMutated",
    "inboxLifecycleMutated", "rawSignalPayloadReturned"
  ]);
  if (record.messageId !== plan.messageId || record.planFingerprint !== plan.planFingerprint
    || record.eventId !== plan.eventId
    || record.resolutionDecisionId !== plan.resolutionDecisionId
    || record.sourceReferenceOutcome !== plan.sourceReferenceOutcome
    || record.outcome !== plan.outcome
    || record.decisionOutcome !== plan.decisionOutcome
    || record.occurrenceAction !== plan.occurrenceAction
    || record.missionDecisionAction !== plan.missionDecisionAction
    || record.auditAction !== plan.auditAction
    || record.outboxAction !== plan.outboxAction
    || exactInteger(record.contractVersion, "result contract version") !== 1
    || exactInteger(record.mutationStatementCount, "result mutation statement count")
      !== plan.mutationStatementCount) {
    throw new PostgresSignalTerminalDecisionApplyQualificationError(
      "The PostgreSQL signal-terminal-decision apply result changed from its sealed plan."
    );
  }
  return {
    contractVersion: 1,
    messageId: plan.messageId,
    planFingerprint: plan.planFingerprint,
    eventId: plan.eventId,
    resolutionDecisionId: plan.resolutionDecisionId,
    sourceReferenceOutcome: plan.sourceReferenceOutcome,
    outcome: plan.outcome,
    decisionOutcome: plan.decisionOutcome,
    occurrenceAction: plan.occurrenceAction,
    missionDecisionAction: plan.missionDecisionAction,
    auditAction: plan.auditAction,
    outboxAction: plan.outboxAction,
    mutationStatementCount: plan.mutationStatementCount,
    terminalDecisionApplyApplied: exactBoolean(
      record.terminalDecisionApplyApplied,
      plan.terminalDecisionApplyWillApply,
      "terminal-applied flag"
    ),
    continueDownstream: exactBoolean(
      record.continueDownstream,
      plan.outcome === "continue_downstream",
      "continue-downstream flag"
    ),
    mutationAuthority: exactBoolean(record.mutationAuthority, true, "authority flag") as true,
    idempotentReplay: exactBoolean(record.idempotentReplay, true, "idempotent flag") as true,
    sharedCatalogMutated: exactBoolean(record.sharedCatalogMutated, false, "catalog flag") as false,
    sourceReferencesMutated: exactBoolean(
      record.sourceReferencesMutated,
      false,
      "source-reference flag"
    ) as false,
    incidentsMutated: exactBoolean(record.incidentsMutated, false, "incident flag") as false,
    offersMutated: exactBoolean(record.offersMutated, false, "offer flag") as false,
    missionsMutated: exactBoolean(record.missionsMutated, false, "mission flag") as false,
    actionsMutated: exactBoolean(record.actionsMutated, false, "action flag") as false,
    terminalSignalGraphMutated: exactBoolean(
      record.terminalSignalGraphMutated,
      plan.terminalDecisionApplyWillApply,
      "terminal graph flag"
    ),
    remainingDownstreamSignalGraphMutated: exactBoolean(
      record.remainingDownstreamSignalGraphMutated,
      false,
      "remaining graph flag"
    ) as false,
    inboxLifecycleMutated: exactBoolean(
      record.inboxLifecycleMutated,
      false,
      "inbox lifecycle flag"
    ) as false,
    rawSignalPayloadReturned: exactBoolean(
      record.rawSignalPayloadReturned,
      false,
      "raw payload result flag"
    ) as false
  };
}

export class NodePostgresSignalTerminalDecisionApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalTerminalDecisionApplyManifest;

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
    requestedCatalogApplyRoleNamespace = "yoink_catalog_qualification",
    requestedResolutionApplyRoleNamespace = "yoink_resolution_qualification",
    requestedSourceReferenceRefreshRoleNamespace = "yoink_ref_qualification",
    requestedTerminalDecisionApplyRoleNamespace = "yoink_terminal_qualification",
    options: NodePostgresSignalTerminalDecisionApplyDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresSignalTerminalDecisionApplyManifest(
      requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
      requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
      requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
      requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
      requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace,
      requestedSourceReferenceRefreshRoleNamespace,
      requestedTerminalDecisionApplyRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalTerminalDecisionApplyQualificationError(
        "The PostgreSQL signal-terminal-decision connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_terminal_decision_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async applySignalTerminalDecision(
    principal: BackgroundWorkerPrincipal,
    messageIdValue: string,
    capabilityTokenValue: string,
    now = Date.now()
  ): Promise<PostgresSignalTerminalDecisionApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const messageId = String(messageIdValue ?? "");
    const capabilityToken = String(capabilityTokenValue ?? "");
    if (!MESSAGE_ID.test(messageId) || !CAPABILITY_TOKEN.test(capabilityToken)
      || !Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresSignalTerminalDecisionApplyQualificationError(
        "The PostgreSQL signal-terminal-decision apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.terminalDecisionApplyRole.name)}`);
      const call = async (
        operation: "plan" | "apply",
        evaluatedAt: string,
        payload: Record<string, unknown>
      ): Promise<Record<string, unknown>> => {
        const result = await client.query<FunctionRow>(
          `SELECT result_json AS "resultJson"
           FROM ${relation(this.manifest.schemaName, POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION)}(
             $1, $2, $3, $4, $5, $6, $7
           )`,
          [tenantId, userId, operation, messageId, capabilityToken, evaluatedAt, JSON.stringify(payload)]
        );
        if (result.rows.length !== 1 || !result.rows[0]) {
          throw new PostgresSignalTerminalDecisionApplyQualificationError(
            "The PostgreSQL signal-terminal-decision function returned an ambiguous result."
          );
        }
        return parseFunctionJson(result.rows[0].resultJson, `${operation} result`);
      };
      const plan = parsePlan(
        await call("plan", "", {}),
        { tenantId, userId },
        messageId,
        now
      );
      const applied = parseResult(
        await call("apply", plan.evaluatedAt, { planFingerprint: plan.planFingerprint }),
        plan
      );
      await client.query("COMMIT");
      return applied;
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
