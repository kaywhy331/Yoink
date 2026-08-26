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
  POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION
} from "./postgres-signal-catalog-apply.js";
import {
  POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION
} from "./postgres-signal-resolution-apply.js";
import {
  POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION
} from "./postgres-signal-source-reference-refresh.js";
import {
  POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_CONTRACT_VERSION
} from "./postgres-signal-terminal-decision-apply.js";
import {
  POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION,
  buildPostgresSignalOfferIncidentApplyManifest,
  verifyPostgresSignalOfferIncidentApplyBoundary
} from "./postgres-signal-offer-incident-apply.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_RECEIPT_TABLE =
  "yoink_signal_post_incident_decision_apply_receipt";
export const POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION =
  "yoink_apply_trackalacker_signal_post_incident_decision";

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
const OFFER_OBSERVATION_ID = /^offer_observation_[a-f0-9]{32}$/;
const INCIDENT_ID = /^incident_[a-f0-9]{32}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text", "text", "text"
] as const);
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TENANT_TABLES = Object.freeze([
  "action_jobs",
  "app_settings",
  "audit_events",
  "inbox_messages",
  "mission_decisions",
  "mission_targets",
  "missions",
  "offer_observations",
  "outbox_events",
  "resolution_decisions",
  "signal_events",
  "signal_incidents",
  "signal_occurrences",
  "source_connections",
  "source_listing_refs",
  "source_product_aliases",
  "source_product_refs"
] as const);
const MUTATION_TABLES = Object.freeze([
  "audit_events",
  "mission_decisions",
  "outbox_events"
] as const);

type InsertAction = "none" | "insert";
type PostIncidentPlanOutcome =
  | "apply_post_incident_decision"
  | "already_decided"
  | "continue_downstream";
type PostIncidentDecisionOutcome = "corroborated" | "no_mission";

export interface PostgresSignalPostIncidentDecisionApplyManifest {
  contractVersion: typeof POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  hostedDeliveryContractVersion: typeof POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION;
  catalogApplyContractVersion: typeof POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION;
  resolutionApplyContractVersion: typeof POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION;
  sourceReferenceRefreshContractVersion:
    typeof POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION;
  terminalDecisionApplyContractVersion:
    typeof POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_CONTRACT_VERSION;
  offerIncidentApplyContractVersion:
    typeof POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_CONTRACT_VERSION;
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
  offerIncidentApplyRoleNamespace: string;
  postIncidentDecisionApplyRoleNamespace: string;
  offerIncidentApplyManifestFingerprint: string;
  postIncidentDecisionApplyRole: {
    kind: "signal_post_incident_decision_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTenantTableCount: 17;
  forcedRlsTableCount: 17;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  maximumPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  committedResolutionBinding: true;
  settledOfferIncidentRequired: true;
  incidentGraphBinding: true;
  existingJobCorroboration: true;
  noMissionFailClosed: true;
  trustedMissionContinuation: true;
  missionBindingRequiredProjection: true;
  idempotentReplay: true;
  postIncidentDecisionRepositoryParity: true;
  postIncidentAuditOutboxRepositoryParity: true;
  sharedCatalogMutation: false;
  sourceReferenceMutation: false;
  terminalDecisionMutation: false;
  offerIncidentMutation: false;
  incidentMutation: false;
  missionMutation: false;
  actionMutation: false;
  postIncidentDecisionGraphMutation: true;
  remainingMissionActionGraphMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  mutationAuthority: true;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalPostIncidentDecisionApplyQualificationReceipt {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
  catalogApplyContractVersion: 1;
  resolutionApplyContractVersion: 1;
  sourceReferenceRefreshContractVersion: 1;
  terminalDecisionApplyContractVersion: 1;
  offerIncidentApplyContractVersion: 1;
  phase: "verified";
  schemaName: string;
  roleManifestFingerprint: string;
  offerIncidentApplyManifestFingerprint: string;
  postIncidentDecisionApplyRoleName: string;
  protectedTenantTableCount: 17;
  forcedRlsTableCount: 17;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  maximumPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  committedResolutionBinding: true;
  settledOfferIncidentRequired: true;
  incidentGraphBinding: true;
  existingJobCorroboration: true;
  noMissionFailClosed: true;
  trustedMissionContinuation: true;
  missionBindingRequiredProjection: true;
  idempotentReplay: true;
  postIncidentDecisionRepositoryParity: true;
  postIncidentAuditOutboxRepositoryParity: true;
  sharedCatalogMutation: false;
  sourceReferenceMutation: false;
  terminalDecisionMutation: false;
  offerIncidentMutation: false;
  incidentMutation: false;
  missionMutation: false;
  actionMutation: false;
  postIncidentDecisionGraphMutation: true;
  remainingMissionActionGraphMutation: false;
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

export interface PostgresSignalPostIncidentDecisionApplyCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
  catalogApplyContractVersion: 1;
  resolutionApplyContractVersion: 1;
  sourceReferenceRefreshContractVersion: 1;
  terminalDecisionApplyContractVersion: 1;
  offerIncidentApplyContractVersion: 1;
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
  settledOfferIncidentRequired: true;
  incidentGraphBinding: true;
  existingJobCorroboration: true;
  noMissionFailClosed: true;
  trustedMissionContinuation: true;
  missionBindingRequiredProjection: true;
  idempotentReplay: true;
  postIncidentDecisionRepositoryParity: true;
  postIncidentAuditOutboxRepositoryParity: true;
  sharedCatalogMutation: false;
  sourceReferenceMutation: false;
  terminalDecisionMutation: false;
  offerIncidentMutation: false;
  incidentMutation: false;
  missionMutation: false;
  actionMutation: false;
  postIncidentDecisionGraphMutation: true;
  remainingMissionActionGraphMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  maximumPlanAgeSeconds: 30;
  protectedTenantTableCount: 17;
  forcedRlsTableCount: 17;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalPostIncidentDecisionApplyPlan {
  contractVersion: 1;
  messageId: string;
  payloadHash: string;
  evaluatedAt: string;
  validUntil: string;
  eventId: string;
  resolutionDecisionId: string;
  listingId: string;
  variantId: string;
  offerObservationId: string;
  incidentId: string;
  semanticKey: string;
  offerIncidentOutcome: "already_applied";
  outcome: PostIncidentPlanOutcome;
  decisionOutcome: PostIncidentDecisionOutcome | "";
  missionId: string;
  actionJobId: string;
  missionBindingRequired: boolean;
  missionCreationRequired: boolean;
  decisionReasonHash: string;
  auditDataHash: string;
  missionDecisionAction: InsertAction;
  auditAction: InsertAction;
  outboxAction: InsertAction;
  mutationStatementCount: number;
  postIncidentDecisionApplyWillApply: boolean;
  sharedCatalogMutation: false;
  sourceReferenceMutation: false;
  terminalDecisionMutation: false;
  offerIncidentMutation: false;
  incidentMutation: false;
  missionMutation: false;
  actionMutation: false;
  rawSignalPayloadReturned: false;
  planFingerprint: string;
}

export interface PostgresSignalPostIncidentDecisionApplyResult {
  contractVersion: 1;
  messageId: string;
  planFingerprint: string;
  eventId: string;
  resolutionDecisionId: string;
  listingId: string;
  variantId: string;
  offerObservationId: string;
  incidentId: string;
  semanticKey: string;
  offerIncidentOutcome: "already_applied";
  outcome: PostIncidentPlanOutcome;
  decisionOutcome: PostIncidentDecisionOutcome | "";
  missionId: string;
  actionJobId: string;
  missionBindingRequired: boolean;
  missionCreationRequired: boolean;
  missionDecisionAction: InsertAction;
  auditAction: InsertAction;
  outboxAction: InsertAction;
  mutationStatementCount: number;
  postIncidentDecisionApplyApplied: boolean;
  continueDownstream: boolean;
  mutationAuthority: true;
  idempotentReplay: true;
  sharedCatalogMutated: false;
  sourceReferencesMutated: false;
  terminalDecisionsMutated: false;
  offerIncidentGraphMutated: false;
  incidentsMutated: false;
  missionsMutated: false;
  actionsMutated: false;
  postIncidentDecisionGraphMutated: boolean;
  remainingMissionActionGraphMutated: false;
  inboxLifecycleMutated: false;
  rawSignalPayloadReturned: false;
}

export interface NodePostgresSignalPostIncidentDecisionApplyDatabaseOptions {
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
  terminal_decision_apply_contract_version: string | number | bigint;
  offer_incident_apply_contract_version: string | number | bigint;
  phase: string;
  role_manifest_fingerprint: string;
  offer_incident_apply_manifest_fingerprint: string;
  post_incident_decision_apply_role_name: string;
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
  settled_offer_incident_required: boolean;
  incident_graph_binding: boolean;
  existing_job_corroboration: boolean;
  no_mission_fail_closed: boolean;
  trusted_mission_continuation: boolean;
  mission_binding_required_projection: boolean;
  idempotent_replay: boolean;
  post_incident_decision_repository_parity: boolean;
  post_incident_audit_outbox_repository_parity: boolean;
  shared_catalog_mutation: boolean;
  source_reference_mutation: boolean;
  terminal_decision_mutation: boolean;
  offer_incident_mutation: boolean;
  incident_mutation: boolean;
  mission_mutation: boolean;
  action_mutation: boolean;
  post_incident_decision_graph_mutation: boolean;
  remaining_mission_action_graph_mutation: boolean;
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

let cachedCapabilityProjection:
Readonly<PostgresSignalPostIncidentDecisionApplyCapabilityProjection> | null = null;
export class PostgresSignalPostIncidentDecisionApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalPostIncidentDecisionApplyQualificationError";
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
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string, fallback: string): string {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const name = `${namespace}_signal_post_incident_decision_apply`;
  if (name.length > 63) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision role name exceeds PostgreSQL's limit."
    );
  }
  return name;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      `The PostgreSQL signal-post-incident-decision ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      `The PostgreSQL signal-post-incident-decision ${label} is out of range.`
    );
  }
  return parsed;
}

function exactText(value: unknown, label: string, maximum = 300, allowEmpty = false): string {
  const normalized = String(value ?? "");
  if (normalized.length > maximum || (!allowEmpty && normalized.length === 0)
    || normalized.trim() !== normalized || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      `The PostgreSQL signal-post-incident-decision ${label} is invalid.`
    );
  }
  return normalized;
}

function exactHash(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!SHA256.test(normalized)) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      `The PostgreSQL signal-post-incident-decision ${label} is invalid.`
    );
  }
  return normalized;
}

function exactTimestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)
    || Number.isNaN(Date.parse(normalized))) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      `The PostgreSQL signal-post-incident-decision ${label} is invalid.`
    );
  }
  return normalized;
}

function exactBoolean(value: unknown, expected: boolean, label: string): boolean {
  if (value !== expected) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      `The PostgreSQL signal-post-incident-decision ${label} is invalid.`
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

export function postgresSignalPostIncidentDecisionApplyPlanFingerprint(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  plan: PostgresSignalPostIncidentDecisionApplyPlan
): string {
  return stableHash(
    "postgres_signal_post_incident_decision_apply_plan_v1",
    principal.tenantId,
    principal.userId,
    plan.contractVersion,
    plan.messageId,
    plan.payloadHash,
    plan.evaluatedAt,
    plan.validUntil,
    plan.eventId,
    plan.resolutionDecisionId,
    plan.listingId,
    plan.variantId,
    plan.offerObservationId,
    plan.incidentId,
    plan.semanticKey,
    plan.offerIncidentOutcome,
    plan.outcome,
    plan.decisionOutcome,
    plan.missionId,
    plan.actionJobId,
    plan.missionBindingRequired ? 1 : 0,
    plan.missionCreationRequired ? 1 : 0,
    plan.decisionReasonHash,
    plan.auditDataHash,
    plan.missionDecisionAction,
    plan.auditAction,
    plan.outboxAction,
    plan.mutationStatementCount,
    plan.postIncidentDecisionApplyWillApply ? 1 : 0,
    plan.sharedCatalogMutation ? 1 : 0,
    plan.sourceReferenceMutation ? 1 : 0,
    plan.terminalDecisionMutation ? 1 : 0,
    plan.offerIncidentMutation ? 1 : 0,
    plan.incidentMutation ? 1 : 0,
    plan.missionMutation ? 1 : 0,
    plan.actionMutation ? 1 : 0,
    plan.rawSignalPayloadReturned ? 1 : 0
  );
}

export function signalPostIncidentDecisionApplyFunctionSource(
  manifest: PostgresSignalPostIncidentDecisionApplyManifest
): string {
  const planParts = stableHashInputSql([
    "'postgres_signal_post_incident_decision_apply_plan_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'1'::text",
    "message_id_value",
    "payload_hash_value",
    "evaluation_timestamp",
    "valid_until_timestamp",
    "event_record.id::text",
    "resolution_record.id::text",
    "listing_id_value",
    "variant_id_value",
    "offer_observation_id_value",
    "incident_id_value",
    "semantic_key_value",
    "offer_incident_outcome_value",
    "outcome_value",
    "decision_outcome_value",
    "mission_id_value",
    "action_job_id_value",
    "CASE WHEN mission_binding_required_value THEN '1' ELSE '0' END",
    "CASE WHEN mission_creation_required_value THEN '1' ELSE '0' END",
    "decision_reason_hash_value",
    "audit_data_hash_value",
    "mission_decision_action_value",
    "audit_action_value",
    "outbox_action_value",
    "mutation_statement_count::text",
    "CASE WHEN outcome_value = 'apply_post_incident_decision' THEN '1' ELSE '0' END",
    "'0'::text",
    "'0'::text",
    "'0'::text",
    "'0'::text",
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
  offer_incident_plan JSONB;
  offer_incident_plan_count BIGINT;
  offer_incident_outcome_value TEXT;
  message_id_value TEXT;
  payload_hash_value TEXT;
  event_record RECORD;
  resolution_record RECORD;
  occurrence_record RECORD;
  incident_record RECORD;
  offer_observation_record RECORD;
  source_connection_record RECORD;
  mission_context_record RECORD;
  variant_mission_record RECORD;
  action_job_record RECORD;
  listing_id_value TEXT;
  variant_id_value TEXT;
  offer_observation_id_value TEXT;
  incident_id_value TEXT;
  semantic_key_value TEXT;
  mission_id_value TEXT := '';
  action_job_id_value TEXT := '';
  mission_binding_required_value BOOLEAN := FALSE;
  mission_creation_required_value BOOLEAN := FALSE;
  outcome_value TEXT := 'continue_downstream';
  decision_outcome_value TEXT := '';
  decision_reason_value TEXT := '';
  decision_reason_hash_value TEXT;
  audit_data JSONB := '{}'::jsonb;
  audit_data_hash_value TEXT;
  mission_decision_action_value TEXT := 'none';
  audit_action_value TEXT := 'none';
  outbox_action_value TEXT := 'none';
  mutation_statement_count BIGINT := 0;
  occurrence_count BIGINT;
  incident_count BIGINT;
  offer_observation_count BIGINT;
  source_connection_count BIGINT;
  mission_context_count BIGINT;
  variant_mission_count BIGINT;
  action_job_count BIGINT;
  owned_action_job_count BIGINT;
  action_job_mission_count BIGINT;
  mission_decision_count BIGINT;
  audit_count BIGINT;
  outbox_count BIGINT;
  mission_decision_record RECORD;
  audit_record RECORD;
  outbox_record RECORD;
  mission_decision_id_value TEXT := '';
  audit_id_value TEXT := '';
  outbox_id_value TEXT := '';
  plan_fingerprint_value TEXT;
  plan_value JSONB;
  apply_payload JSONB;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = ''
    OR target_message_id !~ '^inbox_[a-f0-9]{32}$'
    OR capability_token !~ '^[A-Za-z0-9_-]{43}$'
    OR operation_name NOT IN ('plan', 'apply')
    OR pg_catalog.octet_length(apply_payload_json) > ${MAXIMUM_APPLY_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal post-incident decision request is invalid';
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
    'yoink_signal_post_incident_decision_message_v1:' || resolved_tenant_id || ':' ||
      resolved_user_id || ':' || target_message_id,
    0
  ));

  IF operation_name = 'plan' THEN
    IF evaluation_timestamp_input <> '' OR apply_payload_json::jsonb <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal post-incident decision plan input is invalid';
    END IF;
    evaluation_clock := pg_catalog.statement_timestamp();
  ELSE
    IF evaluation_timestamp_input !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal post-incident decision evaluation timestamp is invalid';
    END IF;
    evaluation_clock := evaluation_timestamp_input::timestamptz;
    IF evaluation_clock > pg_catalog.statement_timestamp()
      OR EXTRACT(EPOCH FROM (pg_catalog.statement_timestamp() - evaluation_clock))
        > ${MAXIMUM_PLAN_AGE_SECONDS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal post-incident decision plan expired before apply';
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
    INTO offer_incident_plan, offer_incident_plan_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION)}(
    expected_tenant_id, expected_user_id, 'plan', target_message_id,
    capability_token, '', '{}'
  ) AS planned;
  IF offer_incident_plan_count <> 1 OR offer_incident_plan IS NULL
    OR offer_incident_plan->>'messageId' <> target_message_id
    OR offer_incident_plan->>'eventId' !~ '^signal_event_[a-f0-9]{32}$'
    OR offer_incident_plan->>'resolutionDecisionId' !~ '^resolution_[a-f0-9]{32}$'
    OR offer_incident_plan->>'offerObservationId' !~ '^offer_observation_[a-f0-9]{32}$'
    OR offer_incident_plan->>'incidentId' !~ '^incident_[a-f0-9]{32}$'
    OR offer_incident_plan->>'semanticKey' !~ '^[a-f0-9]{64}$'
    OR offer_incident_plan->>'payloadHash' !~ '^[a-f0-9]{64}$'
    OR COALESCE(offer_incident_plan->>'listingId', '') = ''
    OR COALESCE(offer_incident_plan->>'variantId', '') = ''
    OR offer_incident_plan->>'terminalDecisionOutcome' <> 'continue_downstream' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal post-incident decision predecessor validation failed';
  END IF;
  offer_incident_outcome_value := COALESCE(offer_incident_plan->>'outcome', '');
  IF offer_incident_outcome_value <> 'already_applied'
    OR offer_incident_plan->>'offerIncidentApplyWillApply' <> 'false'
    OR offer_incident_plan->>'offerObservationAction' <> 'none'
    OR offer_incident_plan->>'incidentAction' <> 'none'
    OR offer_incident_plan->>'occurrenceAction' <> 'none'
    OR offer_incident_plan->>'mutationStatementCount' <> '0' THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal offer-incident graph must settle before post-incident decision apply';
  END IF;

  message_id_value := offer_incident_plan->>'messageId';
  payload_hash_value := offer_incident_plan->>'payloadHash';
  listing_id_value := offer_incident_plan->>'listingId';
  variant_id_value := offer_incident_plan->>'variantId';
  offer_observation_id_value := offer_incident_plan->>'offerObservationId';
  incident_id_value := offer_incident_plan->>'incidentId';
  semantic_key_value := offer_incident_plan->>'semanticKey';

  SELECT event.id, event.tenant_id, event.user_id, event.source_connection_id,
         event.signal_id, event.event_type, event.test, event.observed_at,
         event.received_at, event.resolution_status
    INTO event_record
  FROM ${relation(manifest.schemaName, "signal_events")} AS event
  WHERE event.id = offer_incident_plan->>'eventId'
    AND event.tenant_id = resolved_tenant_id
    AND event.user_id = resolved_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'committed signal event is unavailable for post-incident decision';
  END IF;

  SELECT decision.id, decision.event_id, decision.status,
         decision.variant_id, decision.listing_id
    INTO resolution_record
  FROM ${relation(manifest.schemaName, "resolution_decisions")} AS decision
  WHERE decision.id = offer_incident_plan->>'resolutionDecisionId'
    AND decision.event_id = event_record.id;
  IF NOT FOUND
    OR event_record.test <> 0
    OR resolution_record.status <> 'matched'
    OR event_record.resolution_status <> 'matched'
    OR resolution_record.listing_id <> listing_id_value
    OR resolution_record.variant_id <> variant_id_value THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'post-incident committed resolution binding is inconsistent';
  END IF;

  SELECT COUNT(*) INTO occurrence_count
  FROM ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
  WHERE occurrence.event_id = event_record.id;
  IF occurrence_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'post-incident occurrence binding is unavailable';
  END IF;
  SELECT occurrence.* INTO occurrence_record
  FROM ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
  WHERE occurrence.event_id = event_record.id;

  SELECT COUNT(*) INTO incident_count
  FROM ${relation(manifest.schemaName, "signal_incidents")} AS incident
  WHERE incident.id = incident_id_value
    AND incident.tenant_id = resolved_tenant_id
    AND incident.user_id = resolved_user_id;
  IF incident_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'post-incident incident binding is unavailable';
  END IF;
  SELECT incident.* INTO incident_record
  FROM ${relation(manifest.schemaName, "signal_incidents")} AS incident
  WHERE incident.id = incident_id_value
    AND incident.tenant_id = resolved_tenant_id
    AND incident.user_id = resolved_user_id
  FOR UPDATE;

  SELECT COUNT(*) INTO offer_observation_count
  FROM ${relation(manifest.schemaName, "offer_observations")} AS observation
  WHERE observation.id = offer_observation_id_value
    AND observation.listing_id = listing_id_value
    AND observation.source_connection_id = event_record.source_connection_id;
  IF offer_observation_count <> 1
    OR occurrence_record.incident_id <> incident_id_value
    OR occurrence_record.source_connection_id <> event_record.source_connection_id
    OR occurrence_record.observed_at <> event_record.observed_at
    OR occurrence_record.received_at <> event_record.received_at
    OR incident_record.listing_id <> listing_id_value
    OR incident_record.semantic_key <> semantic_key_value
    OR incident_record.status <> 'open'
    OR incident_record.occurrence_count < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'post-incident graph binding is inconsistent';
  END IF;
  SELECT observation.* INTO offer_observation_record
  FROM ${relation(manifest.schemaName, "offer_observations")} AS observation
  WHERE observation.id = offer_observation_id_value;

  SELECT COUNT(*) INTO source_connection_count
  FROM ${relation(manifest.schemaName, "source_connections")} AS connection
  WHERE connection.id = event_record.source_connection_id
    AND connection.tenant_id = resolved_tenant_id
    AND connection.user_id = resolved_user_id;
  IF source_connection_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'post-incident source connection is unavailable';
  END IF;
  SELECT connection.* INTO source_connection_record
  FROM ${relation(manifest.schemaName, "source_connections")} AS connection
  WHERE connection.id = event_record.source_connection_id
    AND connection.tenant_id = resolved_tenant_id
    AND connection.user_id = resolved_user_id;

  SELECT COUNT(*) INTO action_job_count
  FROM ${relation(manifest.schemaName, "action_jobs")} AS job
  WHERE job.incident_id = incident_id_value;
  SELECT COUNT(*) INTO owned_action_job_count
  FROM ${relation(manifest.schemaName, "action_jobs")} AS job
  WHERE job.incident_id = incident_id_value
    AND job.tenant_id = resolved_tenant_id
    AND job.user_id = resolved_user_id;
  IF action_job_count <> owned_action_job_count OR action_job_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'post-incident action-job binding is ambiguous';
  END IF;

  SELECT COUNT(*) INTO mission_context_count
  FROM ${relation(manifest.schemaName, "missions")} AS mission
  JOIN ${relation(manifest.schemaName, "mission_targets")} AS target
    ON target.mission_id = mission.id
  WHERE mission.tenant_id = resolved_tenant_id
    AND mission.user_id = resolved_user_id
    AND mission.variant_id = variant_id_value
    AND target.listing_id = listing_id_value;
  IF mission_context_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'post-incident mission context is ambiguous';
  END IF;
  IF mission_context_count = 1 THEN
    SELECT mission.id AS mission_id, target.id AS target_id
      INTO mission_context_record
    FROM ${relation(manifest.schemaName, "missions")} AS mission
    JOIN ${relation(manifest.schemaName, "mission_targets")} AS target
      ON target.mission_id = mission.id
    WHERE mission.tenant_id = resolved_tenant_id
      AND mission.user_id = resolved_user_id
      AND mission.variant_id = variant_id_value
      AND target.listing_id = listing_id_value;
  END IF;

  SELECT COUNT(*) INTO variant_mission_count
  FROM ${relation(manifest.schemaName, "missions")} AS mission
  WHERE mission.tenant_id = resolved_tenant_id
    AND mission.user_id = resolved_user_id
    AND mission.variant_id = variant_id_value;
  IF variant_mission_count > 1
    OR (mission_context_count = 1 AND variant_mission_count <> 1) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'post-incident variant mission is ambiguous';
  END IF;
  IF variant_mission_count = 1 THEN
    SELECT mission.id AS mission_id INTO variant_mission_record
    FROM ${relation(manifest.schemaName, "missions")} AS mission
    WHERE mission.tenant_id = resolved_tenant_id
      AND mission.user_id = resolved_user_id
      AND mission.variant_id = variant_id_value;
  END IF;

  IF action_job_count = 1 THEN
    SELECT job.* INTO action_job_record
    FROM ${relation(manifest.schemaName, "action_jobs")} AS job
    WHERE job.incident_id = incident_id_value
      AND job.tenant_id = resolved_tenant_id
      AND job.user_id = resolved_user_id;
    SELECT COUNT(*) INTO action_job_mission_count
    FROM ${relation(manifest.schemaName, "missions")} AS mission
    WHERE mission.id = action_job_record.mission_id
      AND mission.tenant_id = resolved_tenant_id
      AND mission.user_id = resolved_user_id;
    IF incident_record.occurrence_count < 2
      OR action_job_mission_count <> 1
      OR action_job_record.listing_id <> listing_id_value THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'post-incident corroboration graph is inconsistent';
    END IF;
    decision_outcome_value := 'corroborated';
    decision_reason_value :=
      'This signal corroborates an active opportunity; the existing action job remains authoritative.';
    mission_id_value := action_job_record.mission_id;
    action_job_id_value := action_job_record.id;
    audit_data := pg_catalog.jsonb_build_object(
      'incidentId', incident_id_value,
      'actionJobId', action_job_id_value
    );
  ELSIF mission_context_count = 0
    AND NOT (
      source_connection_record.auto_create_missions = 1
      AND source_connection_record.trust_level = 'trusted_exact'
    ) THEN
    decision_outcome_value := 'no_mission';
    decision_reason_value :=
      'The exact listing was recorded, but this source is not allowed to create a mission and no mission target exists.';
    audit_data := pg_catalog.jsonb_build_object(
      'incidentId', incident_id_value,
      'listingId', listing_id_value
    );
  ELSE
    IF mission_context_count = 1 THEN
      mission_id_value := mission_context_record.mission_id;
    ELSE
      mission_binding_required_value := TRUE;
      mission_creation_required_value := variant_mission_count = 0;
      mission_id_value := CASE
        WHEN variant_mission_count = 1 THEN variant_mission_record.mission_id
        ELSE ''
      END;
    END IF;
  END IF;

  IF decision_outcome_value <> '' THEN
    IF pg_catalog.length(decision_reason_value) < 1
      OR pg_catalog.length(decision_reason_value) > 500
      OR decision_reason_value <> pg_catalog.btrim(decision_reason_value)
      OR decision_reason_value ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'post-incident decision reason is invalid';
    END IF;

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

    IF mission_decision_count = 0 AND audit_count = 0 AND outbox_count = 0 THEN
      outcome_value := 'apply_post_incident_decision';
      mission_decision_action_value := 'insert';
      audit_action_value := 'insert';
      outbox_action_value := 'insert';
      mutation_statement_count := 3;
    ELSIF mission_decision_count = 1 AND audit_count = 1 AND outbox_count = 1 THEN
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

      IF mission_decision_record.id !~ '^mission_decision_[a-f0-9]{32}$'
        OR audit_record.id !~ '^audit_[a-f0-9]{32}$'
        OR outbox_record.id !~ '^outbox_[a-f0-9]{32}$'
        OR mission_decision_record.created_at <> audit_record.created_at
        OR mission_decision_record.created_at <> outbox_record.created_at
        OR mission_decision_record.incident_id <> incident_id_value
        OR mission_decision_record.mission_id IS DISTINCT FROM NULLIF(mission_id_value, '')
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
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'existing post-incident decision is inconsistent';
      END IF;
      outcome_value := 'already_decided';
    ELSE
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'partial post-incident decision fails closed';
    END IF;
  ELSE
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
    IF mission_decision_count <> 0 OR audit_count <> 0 OR outbox_count <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'downstream post-incident decision is already terminal';
    END IF;
  END IF;

  decision_reason_hash_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(decision_reason_value, 'UTF8')), 'hex'
  );
  audit_data_hash_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(audit_data::text, 'UTF8')), 'hex'
  );
  plan_fingerprint_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${planParts}, 'UTF8')), 'hex'
  );
  plan_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_id_value,
    'payloadHash', payload_hash_value,
    'evaluatedAt', evaluation_timestamp,
    'validUntil', valid_until_timestamp,
    'eventId', event_record.id,
    'resolutionDecisionId', resolution_record.id,
    'listingId', listing_id_value,
    'variantId', variant_id_value,
    'offerObservationId', offer_observation_id_value,
    'incidentId', incident_id_value,
    'semanticKey', semantic_key_value,
    'offerIncidentOutcome', offer_incident_outcome_value,
    'outcome', outcome_value,
    'decisionOutcome', decision_outcome_value,
    'missionId', mission_id_value,
    'actionJobId', action_job_id_value,
    'missionBindingRequired', mission_binding_required_value,
    'missionCreationRequired', mission_creation_required_value,
    'decisionReasonHash', decision_reason_hash_value,
    'auditDataHash', audit_data_hash_value,
    'missionDecisionAction', mission_decision_action_value,
    'auditAction', audit_action_value,
    'outboxAction', outbox_action_value,
    'mutationStatementCount', mutation_statement_count,
    'postIncidentDecisionApplyWillApply',
      outcome_value = 'apply_post_incident_decision',
    'sharedCatalogMutation', FALSE,
    'sourceReferenceMutation', FALSE,
    'terminalDecisionMutation', FALSE,
    'offerIncidentMutation', FALSE,
    'incidentMutation', FALSE,
    'missionMutation', FALSE,
    'actionMutation', FALSE,
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal post-incident decision apply payload does not match its current plan';
  END IF;

  IF outcome_value = 'apply_post_incident_decision' THEN
    mission_decision_id_value :=
      'mission_decision_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    audit_id_value := 'audit_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    outbox_id_value := 'outbox_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');

    INSERT INTO ${relation(manifest.schemaName, "mission_decisions")}(
      id, event_id, incident_id, mission_id, strategy_id, strategy_revision,
      decision_source, outcome, reason, effective_action, effective_quantity,
      effective_unit_cap_cents, created_at
    ) VALUES (
      mission_decision_id_value, event_record.id, incident_id_value,
      NULLIF(mission_id_value, ''), NULL, NULL, 'strategy',
      decision_outcome_value, decision_reason_value, 'notify', 1,
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
    'listingId', listing_id_value,
    'variantId', variant_id_value,
    'offerObservationId', offer_observation_id_value,
    'incidentId', incident_id_value,
    'semanticKey', semantic_key_value,
    'offerIncidentOutcome', offer_incident_outcome_value,
    'outcome', outcome_value,
    'decisionOutcome', decision_outcome_value,
    'missionId', mission_id_value,
    'actionJobId', action_job_id_value,
    'missionBindingRequired', mission_binding_required_value,
    'missionCreationRequired', mission_creation_required_value,
    'missionDecisionAction', mission_decision_action_value,
    'auditAction', audit_action_value,
    'outboxAction', outbox_action_value,
    'mutationStatementCount', mutation_statement_count,
    'postIncidentDecisionApplyApplied',
      outcome_value = 'apply_post_incident_decision',
    'continueDownstream', outcome_value = 'continue_downstream',
    'mutationAuthority', TRUE,
    'idempotentReplay', TRUE,
    'sharedCatalogMutated', FALSE,
    'sourceReferencesMutated', FALSE,
    'terminalDecisionsMutated', FALSE,
    'offerIncidentGraphMutated', FALSE,
    'incidentsMutated', FALSE,
    'missionsMutated', FALSE,
    'actionsMutated', FALSE,
    'postIncidentDecisionGraphMutated',
      outcome_value = 'apply_post_incident_decision',
    'remainingMissionActionGraphMutated', FALSE,
    'inboxLifecycleMutated', FALSE,
    'rawSignalPayloadReturned', FALSE
  )::text;
END
`;
}

export function buildPostgresSignalPostIncidentDecisionApplyManifest(
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
  requestedOfferIncidentApplyRoleNamespace = "yoink_offer_qualification",
  requestedPostIncidentDecisionApplyRoleNamespace = "yoink_post_incident_qual"
): PostgresSignalPostIncidentDecisionApplyManifest {
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
    safeNamespace(requestedTerminalDecisionApplyRoleNamespace, "yoink_terminal_qualification"),
    safeNamespace(requestedOfferIncidentApplyRoleNamespace, "yoink_offer_qualification"),
    safeNamespace(
      requestedPostIncidentDecisionApplyRoleNamespace,
      "yoink_post_incident_qual"
    )
  ] as const;
  const [schemaName, readRoleNamespace, sessionRoleNamespace, queueWriteRoleNamespace,
    controlRoleNamespace, notificationRecoveryRoleNamespace, executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace, observerCandidateRoleNamespace, alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace, witnessRefreshRoleNamespace, leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace, resolutionApplyRoleNamespace,
    sourceReferenceRefreshRoleNamespace, terminalDecisionApplyRoleNamespace,
    offerIncidentApplyRoleNamespace, postIncidentDecisionApplyRoleNamespace] = values;
  if (new Set(values.slice(1)).size !== values.length - 1) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision role namespace must be independent."
    );
  }
  const previous = buildPostgresSignalOfferIncidentApplyManifest(
    schemaName, readRoleNamespace, sessionRoleNamespace, queueWriteRoleNamespace,
    controlRoleNamespace, notificationRecoveryRoleNamespace, executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace, observerCandidateRoleNamespace, alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace, witnessRefreshRoleNamespace, leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace, resolutionApplyRoleNamespace,
    sourceReferenceRefreshRoleNamespace, terminalDecisionApplyRoleNamespace,
    offerIncidentApplyRoleNamespace
  );
  const withoutFingerprint: Omit<
    PostgresSignalPostIncidentDecisionApplyManifest,
    "fingerprint"
  > = {
    contractVersion: POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    hostedDeliveryContractVersion: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
    catalogApplyContractVersion: POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION,
    resolutionApplyContractVersion: POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION,
    sourceReferenceRefreshContractVersion:
      POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_CONTRACT_VERSION,
    terminalDecisionApplyContractVersion:
      POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_CONTRACT_VERSION,
    offerIncidentApplyContractVersion:
      POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_CONTRACT_VERSION,
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
    offerIncidentApplyRoleNamespace,
    postIncidentDecisionApplyRoleNamespace,
    offerIncidentApplyManifestFingerprint: previous.fingerprint,
    postIncidentDecisionApplyRole: {
      kind: "signal_post_incident_decision_apply_boundary",
      name: roleName(postIncidentDecisionApplyRoleNamespace),
      functionName: POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTenantTableCount: 17,
    forcedRlsTableCount: 17,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    maximumPlanAgeSeconds: 30,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    committedResolutionBinding: true,
    settledOfferIncidentRequired: true,
    incidentGraphBinding: true,
    existingJobCorroboration: true,
    noMissionFailClosed: true,
    trustedMissionContinuation: true,
    missionBindingRequiredProjection: true,
    idempotentReplay: true,
    postIncidentDecisionRepositoryParity: true,
    postIncidentAuditOutboxRepositoryParity: true,
    sharedCatalogMutation: false,
    sourceReferenceMutation: false,
    terminalDecisionMutation: false,
    offerIncidentMutation: false,
    incidentMutation: false,
    missionMutation: false,
    actionMutation: false,
    postIncidentDecisionGraphMutation: true,
    remainingMissionActionGraphMutation: false,
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

export function postgresSignalPostIncidentDecisionApplyCapabilityProjection():
PostgresSignalPostIncidentDecisionApplyCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalPostIncidentDecisionApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    hostedDeliveryContractVersion: 3,
    catalogApplyContractVersion: 1,
    resolutionApplyContractVersion: 1,
    sourceReferenceRefreshContractVersion: 1,
    terminalDecisionApplyContractVersion: 1,
    offerIncidentApplyContractVersion: 1,
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
    settledOfferIncidentRequired: true,
    incidentGraphBinding: true,
    existingJobCorroboration: true,
    noMissionFailClosed: true,
    trustedMissionContinuation: true,
    missionBindingRequiredProjection: true,
    idempotentReplay: true,
    postIncidentDecisionRepositoryParity: true,
    postIncidentAuditOutboxRepositoryParity: true,
    sharedCatalogMutation: false,
    sourceReferenceMutation: false,
    terminalDecisionMutation: false,
    offerIncidentMutation: false,
    incidentMutation: false,
    missionMutation: false,
    actionMutation: false,
    postIncidentDecisionGraphMutation: true,
    remainingMissionActionGraphMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    maximumPlanAgeSeconds: 30,
    protectedTenantTableCount: 17,
    forcedRlsTableCount: 17,
    mutationTableCount: 3,
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
  manifest: PostgresSignalPostIncidentDecisionApplyManifest
): Promise<BoundaryInspection> {
  const role = manifest.postIncidentDecisionApplyRole.name;
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
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision role attributes are unsafe."
    );
  }

  const memberships = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_auth_members membership
     JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
     WHERE member_role.rolname = $1`,
    [role]
  );
  if (exactInteger(memberships.rows[0]?.count, "membership count") !== 0) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision role must not inherit another role."
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
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision role has a direct table or column grant."
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
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision role has an unauthorized effective table privilege."
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
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision role has an unauthorized effective column privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision role has an invalid schema privilege."
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
    || routine.routineName !== POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE
    || routine.volatility !== "v" || routine.securityDefiner !== true
    || routine.strict !== true || routine.leakproof !== false
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role || routine.source !== signalPostIncidentDecisionApplyFunctionSource(manifest)) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision function boundary is incomplete."
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
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision function grant is not exact."
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
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision protected table set is incomplete."
    );
  }
  const mutationTables = protectedTables.rows.filter((row) =>
    (MUTATION_TABLES as readonly string[]).includes(row.tableName)
  );
  if (mutationTables.map((row) => row.tableName).join(",")
    !== [...MUTATION_TABLES].sort().join(",")) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision mutation table set is incomplete."
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
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision role must not access application sequences."
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
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision role must not own application objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision role must not depend on a direct table policy."
    );
  }

  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  if (exactInteger(principals.rows[0]?.count, "active principal count") !== 0) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "Signal post-incident-decision qualification cannot activate a runtime principal."
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
  manifest: PostgresSignalPostIncidentDecisionApplyManifest
): PostgresSignalPostIncidentDecisionApplyQualificationReceipt {
  if (row.phase !== "verified"
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.offer_incident_apply_manifest_fingerprint
      !== manifest.offerIncidentApplyManifestFingerprint
    || row.post_incident_decision_apply_role_name
      !== manifest.postIncidentDecisionApplyRole.name
    || !SHA256.test(row.boundary_catalog_fingerprint)
    || row.server_bound_principal_lookup !== true
    || row.database_plan_revalidation !== true
    || row.committed_resolution_binding !== true
    || row.settled_offer_incident_required !== true
    || row.incident_graph_binding !== true
    || row.existing_job_corroboration !== true
    || row.no_mission_fail_closed !== true
    || row.trusted_mission_continuation !== true
    || row.mission_binding_required_projection !== true
    || row.idempotent_replay !== true
    || row.post_incident_decision_repository_parity !== true
    || row.post_incident_audit_outbox_repository_parity !== true
    || row.shared_catalog_mutation !== false
    || row.source_reference_mutation !== false
    || row.terminal_decision_mutation !== false
    || row.offer_incident_mutation !== false
    || row.incident_mutation !== false
    || row.mission_mutation !== false
    || row.action_mutation !== false
    || row.post_incident_decision_graph_mutation !== true
    || row.remaining_mission_action_graph_mutation !== false
    || row.inbox_lifecycle_mutation !== false
    || row.raw_signal_payload_returned !== false
    || row.signal_evaluation_apply_repository_parity !== false
    || row.hosted_delivery_handler_repository_parity !== false
    || row.mutation_authority !== true
    || row.direct_table_access !== false
    || row.runtime_authority !== false
    || row.production_ready !== false) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision receipt is incomplete or unsafe."
    );
  }
  const counts = [
    [row.contract_version, 1, "contract version"],
    [row.cutover_contract_version, 3, "cutover contract version"],
    [row.hosted_delivery_contract_version, 3, "hosted-delivery contract version"],
    [row.catalog_apply_contract_version, 1, "catalog-apply contract version"],
    [row.resolution_apply_contract_version, 1, "resolution-apply contract version"],
    [row.source_reference_refresh_contract_version, 1, "source-reference contract version"],
    [row.terminal_decision_apply_contract_version, 1, "terminal-decision contract version"],
    [row.offer_incident_apply_contract_version, 1, "offer-incident contract version"],
    [row.protected_tenant_table_count, 17, "protected table count"],
    [row.forced_rls_table_count, 17, "forced RLS table count"],
    [row.mutation_table_count, 3, "mutation table count"],
    [row.direct_table_grant_count, 0, "direct grant count"],
    [row.function_grant_count, 1, "function grant count"],
    [row.membership_count, 0, "membership count"],
    [row.active_principal_count, 0, "active principal count"],
    [row.maximum_plan_age_seconds, 30, "plan age"]
  ] as const;
  for (const [value, expected, label] of counts) {
    if (exactInteger(value, label) !== expected) {
      throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
        "The PostgreSQL signal-post-incident-decision receipt uses an unsupported contract."
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
    terminalDecisionApplyContractVersion: 1,
    offerIncidentApplyContractVersion: 1,
    phase: "verified",
    schemaName: manifest.schemaName,
    roleManifestFingerprint: manifest.fingerprint,
    offerIncidentApplyManifestFingerprint:
      manifest.offerIncidentApplyManifestFingerprint,
    postIncidentDecisionApplyRoleName: manifest.postIncidentDecisionApplyRole.name,
    protectedTenantTableCount: 17,
    forcedRlsTableCount: 17,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    maximumPlanAgeSeconds: 30,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    committedResolutionBinding: true,
    settledOfferIncidentRequired: true,
    incidentGraphBinding: true,
    existingJobCorroboration: true,
    noMissionFailClosed: true,
    trustedMissionContinuation: true,
    missionBindingRequiredProjection: true,
    idempotentReplay: true,
    postIncidentDecisionRepositoryParity: true,
    postIncidentAuditOutboxRepositoryParity: true,
    sharedCatalogMutation: false,
    sourceReferenceMutation: false,
    terminalDecisionMutation: false,
    offerIncidentMutation: false,
    incidentMutation: false,
    missionMutation: false,
    actionMutation: false,
    postIncidentDecisionGraphMutation: true,
    remainingMissionActionGraphMutation: false,
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
  manifest: PostgresSignalPostIncidentDecisionApplyManifest
): Promise<PostgresSignalPostIncidentDecisionApplyQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_RECEIPT_TABLE)}
     WHERE singleton = TRUE`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresSignalPostIncidentDecisionApplyQualificationReceipt,
  manifest: PostgresSignalPostIncidentDecisionApplyManifest
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
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresSignalPostIncidentDecisionApplyBoundary(
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
  requestedOfferIncidentApplyRoleNamespace = "yoink_offer_qualification",
  requestedPostIncidentDecisionApplyRoleNamespace = "yoink_post_incident_qual"
): Promise<PostgresSignalPostIncidentDecisionApplyQualificationReceipt> {
  const manifest = buildPostgresSignalPostIncidentDecisionApplyManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
    requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace,
    requestedSourceReferenceRefreshRoleNamespace, requestedTerminalDecisionApplyRoleNamespace,
    requestedOfferIncidentApplyRoleNamespace, requestedPostIncidentDecisionApplyRoleNamespace
  );
  await verifyPostgresSignalOfferIncidentApplyBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace, manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace, manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace, manifest.leaseRecoveryRoleNamespace,
    manifest.catalogApplyRoleNamespace, manifest.resolutionApplyRoleNamespace,
    manifest.sourceReferenceRefreshRoleNamespace, manifest.terminalDecisionApplyRoleNamespace,
    manifest.offerIncidentApplyRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresSignalPostIncidentDecisionApplyBoundary(
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
  requestedOfferIncidentApplyRoleNamespace = "yoink_offer_qualification",
  requestedPostIncidentDecisionApplyRoleNamespace = "yoink_post_incident_qual",
  now = Date.now()
): Promise<PostgresSignalPostIncidentDecisionApplyQualificationReceipt> {
  if (!Number.isSafeInteger(now)) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision qualification timestamp is invalid."
    );
  }
  const manifest = buildPostgresSignalPostIncidentDecisionApplyManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
    requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace,
    requestedSourceReferenceRefreshRoleNamespace, requestedTerminalDecisionApplyRoleNamespace,
    requestedOfferIncidentApplyRoleNamespace, requestedPostIncidentDecisionApplyRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "Signal post-incident-decision qualification requires the supported cutover role with BYPASSRLS."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    `SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user`
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "Signal post-incident-decision qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresSignalOfferIncidentApplyBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace, manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace, manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace, manifest.leaseRecoveryRoleNamespace,
    manifest.catalogApplyRoleNamespace, manifest.resolutionApplyRoleNamespace,
    manifest.sourceReferenceRefreshRoleNamespace, manifest.terminalDecisionApplyRoleNamespace,
    manifest.offerIncidentApplyRoleNamespace
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
        manifest.postIncidentDecisionApplyRole.name,
        manifest.schemaName,
        POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_RECEIPT_TABLE,
        [
          POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION,
          "yoink_guard_signal_post_incident_decision_apply_receipt"
        ]
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing object count") !== 0) {
      throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
        "Signal post-incident-decision qualification refuses an existing role, function, guard, or receipt."
      );
    }
    await session.query(
      `CREATE ROLE ${identifier(manifest.postIncidentDecisionApplyRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.postIncidentDecisionApplyRole.name)}`
    );
    for (const table of PROTECTED_TENANT_TABLES) {
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} ENABLE ROW LEVEL SECURITY`);
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} FORCE ROW LEVEL SECURITY`);
    }
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION)}(
         expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
         target_message_id TEXT, capability_token TEXT,
         evaluation_timestamp_input TEXT, apply_payload_json TEXT
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${signalPostIncidentDecisionApplyFunctionSource(manifest)}$yoink$`
    );
    const signature = `${relation(
      manifest.schemaName,
      POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION
    )}(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)`;
    await session.query(`REVOKE ALL PRIVILEGES ON FUNCTION ${signature} FROM PUBLIC`);
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${signature} TO ${identifier(manifest.postIncidentDecisionApplyRole.name)}`
    );
    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_RECEIPT_TABLE)}(
         singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
         contract_version BIGINT NOT NULL CHECK (contract_version = 1),
         cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = 3),
         hosted_delivery_contract_version BIGINT NOT NULL CHECK (hosted_delivery_contract_version = 3),
         catalog_apply_contract_version BIGINT NOT NULL CHECK (catalog_apply_contract_version = 1),
         resolution_apply_contract_version BIGINT NOT NULL CHECK (resolution_apply_contract_version = 1),
         source_reference_refresh_contract_version BIGINT NOT NULL
           CHECK (source_reference_refresh_contract_version = 1),
         terminal_decision_apply_contract_version BIGINT NOT NULL
           CHECK (terminal_decision_apply_contract_version = 1),
         offer_incident_apply_contract_version BIGINT NOT NULL
           CHECK (offer_incident_apply_contract_version = 1),
         phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
         role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         offer_incident_apply_manifest_fingerprint TEXT NOT NULL
           CHECK (offer_incident_apply_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         post_incident_decision_apply_role_name TEXT NOT NULL,
         protected_tenant_table_count BIGINT NOT NULL CHECK (protected_tenant_table_count = 17),
         forced_rls_table_count BIGINT NOT NULL CHECK (forced_rls_table_count = 17),
         mutation_table_count BIGINT NOT NULL CHECK (mutation_table_count = 3),
         direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
         function_grant_count BIGINT NOT NULL CHECK (function_grant_count = 1),
         membership_count BIGINT NOT NULL CHECK (membership_count = 0),
         active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
         maximum_plan_age_seconds BIGINT NOT NULL CHECK (maximum_plan_age_seconds = 30),
         server_bound_principal_lookup BOOLEAN NOT NULL CHECK (server_bound_principal_lookup = TRUE),
         database_plan_revalidation BOOLEAN NOT NULL CHECK (database_plan_revalidation = TRUE),
         committed_resolution_binding BOOLEAN NOT NULL CHECK (committed_resolution_binding = TRUE),
         settled_offer_incident_required BOOLEAN NOT NULL CHECK (settled_offer_incident_required = TRUE),
         incident_graph_binding BOOLEAN NOT NULL CHECK (incident_graph_binding = TRUE),
         existing_job_corroboration BOOLEAN NOT NULL CHECK (existing_job_corroboration = TRUE),
         no_mission_fail_closed BOOLEAN NOT NULL CHECK (no_mission_fail_closed = TRUE),
         trusted_mission_continuation BOOLEAN NOT NULL CHECK (trusted_mission_continuation = TRUE),
         mission_binding_required_projection BOOLEAN NOT NULL
           CHECK (mission_binding_required_projection = TRUE),
         idempotent_replay BOOLEAN NOT NULL CHECK (idempotent_replay = TRUE),
         post_incident_decision_repository_parity BOOLEAN NOT NULL
           CHECK (post_incident_decision_repository_parity = TRUE),
         post_incident_audit_outbox_repository_parity BOOLEAN NOT NULL
           CHECK (post_incident_audit_outbox_repository_parity = TRUE),
         shared_catalog_mutation BOOLEAN NOT NULL CHECK (shared_catalog_mutation = FALSE),
         source_reference_mutation BOOLEAN NOT NULL CHECK (source_reference_mutation = FALSE),
         terminal_decision_mutation BOOLEAN NOT NULL CHECK (terminal_decision_mutation = FALSE),
         offer_incident_mutation BOOLEAN NOT NULL CHECK (offer_incident_mutation = FALSE),
         incident_mutation BOOLEAN NOT NULL CHECK (incident_mutation = FALSE),
         mission_mutation BOOLEAN NOT NULL CHECK (mission_mutation = FALSE),
         action_mutation BOOLEAN NOT NULL CHECK (action_mutation = FALSE),
         post_incident_decision_graph_mutation BOOLEAN NOT NULL
           CHECK (post_incident_decision_graph_mutation = TRUE),
         remaining_mission_action_graph_mutation BOOLEAN NOT NULL
           CHECK (remaining_mission_action_graph_mutation = FALSE),
         inbox_lifecycle_mutation BOOLEAN NOT NULL CHECK (inbox_lifecycle_mutation = FALSE),
         raw_signal_payload_returned BOOLEAN NOT NULL CHECK (raw_signal_payload_returned = FALSE),
         signal_evaluation_apply_repository_parity BOOLEAN NOT NULL
           CHECK (signal_evaluation_apply_repository_parity = FALSE),
         hosted_delivery_handler_repository_parity BOOLEAN NOT NULL
           CHECK (hosted_delivery_handler_repository_parity = FALSE),
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
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_RECEIPT_TABLE)} FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_RECEIPT_TABLE)}(
         singleton, contract_version, cutover_contract_version,
         hosted_delivery_contract_version, catalog_apply_contract_version,
         resolution_apply_contract_version, source_reference_refresh_contract_version,
         terminal_decision_apply_contract_version, offer_incident_apply_contract_version,
         phase, role_manifest_fingerprint, offer_incident_apply_manifest_fingerprint,
         post_incident_decision_apply_role_name, protected_tenant_table_count,
         forced_rls_table_count, mutation_table_count, direct_table_grant_count,
         function_grant_count, membership_count, active_principal_count,
         maximum_plan_age_seconds, server_bound_principal_lookup,
         database_plan_revalidation, committed_resolution_binding,
         settled_offer_incident_required, incident_graph_binding,
         existing_job_corroboration, no_mission_fail_closed,
         trusted_mission_continuation, mission_binding_required_projection,
         idempotent_replay, post_incident_decision_repository_parity,
         post_incident_audit_outbox_repository_parity, shared_catalog_mutation,
         source_reference_mutation, terminal_decision_mutation,
         offer_incident_mutation, incident_mutation, mission_mutation,
         action_mutation, post_incident_decision_graph_mutation,
         remaining_mission_action_graph_mutation, inbox_lifecycle_mutation,
         raw_signal_payload_returned, signal_evaluation_apply_repository_parity,
         hosted_delivery_handler_repository_parity, mutation_authority,
         direct_table_access, runtime_authority, production_ready,
         boundary_catalog_fingerprint, applied_at, verified_at
       ) VALUES (
         TRUE, 1, 3, 3, 1, 1, 1, 1, 1, 'loading', $1, $2, $3,
         17, 17, 3, 0, 1, 0, 0, 30,
         TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE,
         FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
         TRUE, FALSE, FALSE, FALSE, FALSE, FALSE,
         TRUE, FALSE, FALSE, FALSE, repeat('0', 64), $4, ''
       )`,
      [
        manifest.fingerprint,
        manifest.offerIncidentApplyManifestFingerprint,
        manifest.postIncidentDecisionApplyRole.name,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_RECEIPT_TABLE)}
       SET phase = 'verified', boundary_catalog_fingerprint = $1, verified_at = $2
       WHERE singleton = TRUE AND phase = 'loading'`,
      [inspection.boundaryCatalogFingerprint, verifiedAt]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_guard_signal_post_incident_decision_apply_receipt")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $guard$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal-post-incident-decision receipt is immutable';
       END
       $guard$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_signal_post_incident_decision_apply_receipt")}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_signal_post_incident_decision_apply_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_signal_post_incident_decision_apply_receipt")}()`
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
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      `The PostgreSQL signal-post-incident-decision ${label} is invalid.`
    );
  }
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...expectedKeys].sort())) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      `The PostgreSQL signal-post-incident-decision ${label} has an unexpected shape.`
    );
  }
  return record;
}

function parseFunctionJson(value: unknown, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? "")) as unknown;
  } catch {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      `The PostgreSQL signal-post-incident-decision ${label} is not valid JSON.`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      `The PostgreSQL signal-post-incident-decision ${label} is invalid.`
    );
  }
  return parsed as Record<string, unknown>;
}

function insertAction(value: unknown, label: string): InsertAction {
  const action = exactText(value, label, 10) as InsertAction;
  if (!new Set<InsertAction>(["none", "insert"]).has(action)) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      `The PostgreSQL signal-post-incident-decision ${label} is invalid.`
    );
  }
  return action;
}

function parsePlan(
  value: Record<string, unknown>,
  principal: BackgroundWorkerPrincipal,
  messageId: string,
  now: number
): PostgresSignalPostIncidentDecisionApplyPlan {
  const record = exactObject(value, "plan", [
    "contractVersion", "messageId", "payloadHash", "evaluatedAt", "validUntil",
    "eventId", "resolutionDecisionId", "listingId", "variantId",
    "offerObservationId", "incidentId", "semanticKey", "offerIncidentOutcome",
    "outcome", "decisionOutcome", "missionId", "actionJobId",
    "missionBindingRequired", "missionCreationRequired", "decisionReasonHash",
    "auditDataHash", "missionDecisionAction", "auditAction", "outboxAction",
    "mutationStatementCount", "postIncidentDecisionApplyWillApply",
    "sharedCatalogMutation", "sourceReferenceMutation", "terminalDecisionMutation",
    "offerIncidentMutation", "incidentMutation", "missionMutation", "actionMutation",
    "rawSignalPayloadReturned", "planFingerprint"
  ]);
  if (exactInteger(record.contractVersion, "plan contract version") !== 1
    || record.messageId !== messageId
    || record.offerIncidentOutcome !== "already_applied") {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision plan identity is invalid."
    );
  }
  const evaluatedAt = exactTimestamp(record.evaluatedAt, "evaluation timestamp");
  const validUntil = exactTimestamp(record.validUntil, "expiry timestamp");
  if (Math.abs(now - Date.parse(evaluatedAt)) > MAXIMUM_CLOCK_SKEW_MS
    || Date.parse(validUntil) <= Date.now()
    || Date.parse(validUntil) <= Date.parse(evaluatedAt)
    || Date.parse(validUntil) - Date.parse(evaluatedAt) > MAXIMUM_PLAN_AGE_SECONDS * 1_000) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision plan lifetime is invalid."
    );
  }
  const outcome = exactText(record.outcome, "outcome", 40) as PostIncidentPlanOutcome;
  if (!new Set<PostIncidentPlanOutcome>([
    "apply_post_incident_decision", "already_decided", "continue_downstream"
  ]).has(outcome)) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision plan outcome is invalid."
    );
  }
  const decisionOutcome = exactText(
    record.decisionOutcome,
    "decision outcome",
    20,
    outcome === "continue_downstream"
  ) as PostIncidentDecisionOutcome | "";
  if ((outcome === "continue_downstream" && decisionOutcome !== "")
    || (outcome !== "continue_downstream"
      && !new Set<PostIncidentDecisionOutcome>([
        "corroborated", "no_mission"
      ]).has(decisionOutcome as PostIncidentDecisionOutcome))) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision outcome is inconsistent."
    );
  }
  if (typeof record.missionBindingRequired !== "boolean"
    || typeof record.missionCreationRequired !== "boolean") {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision mission projection is invalid."
    );
  }
  const missionBindingRequired = record.missionBindingRequired;
  const missionCreationRequired = record.missionCreationRequired;
  const missionId = exactText(record.missionId, "mission ID", 200, true);
  const actionJobId = exactText(record.actionJobId, "action-job ID", 200, true);
  const terminalDecision = outcome !== "continue_downstream";
  if (terminalDecision
    ? (missionBindingRequired || missionCreationRequired
      || (decisionOutcome === "corroborated" && (!missionId || !actionJobId))
      || (decisionOutcome === "no_mission" && (missionId !== "" || actionJobId !== "")))
    : (actionJobId !== ""
      || (!missionBindingRequired && (missionId === "" || missionCreationRequired))
      || (missionBindingRequired && missionCreationRequired && missionId !== "")
      || (missionBindingRequired && !missionCreationRequired && missionId === ""))) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision mission binding is inconsistent."
    );
  }
  const missionDecisionAction = insertAction(
    record.missionDecisionAction,
    "mission-decision action"
  );
  const auditAction = insertAction(record.auditAction, "audit action");
  const outboxAction = insertAction(record.outboxAction, "outbox action");
  const actions = [missionDecisionAction, auditAction, outboxAction];
  const mutationStatementCount = exactInteger(
    record.mutationStatementCount,
    "mutation statement count"
  );
  const willApply = outcome === "apply_post_incident_decision";
  if (mutationStatementCount !== (willApply ? 3 : 0)
    || actions.some((action) => action !== (willApply ? "insert" : "none"))) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision mutation plan is inconsistent."
    );
  }
  const plan: PostgresSignalPostIncidentDecisionApplyPlan = {
    contractVersion: 1,
    messageId,
    payloadHash: exactHash(record.payloadHash, "payload hash"),
    evaluatedAt,
    validUntil,
    eventId: exactText(record.eventId, "event ID", 200),
    resolutionDecisionId: exactText(record.resolutionDecisionId, "resolution decision ID", 200),
    listingId: exactText(record.listingId, "listing ID", 200),
    variantId: exactText(record.variantId, "variant ID", 200),
    offerObservationId: exactText(record.offerObservationId, "offer-observation ID", 200),
    incidentId: exactText(record.incidentId, "incident ID", 200),
    semanticKey: exactHash(record.semanticKey, "semantic key"),
    offerIncidentOutcome: "already_applied",
    outcome,
    decisionOutcome,
    missionId,
    actionJobId,
    missionBindingRequired,
    missionCreationRequired,
    decisionReasonHash: exactHash(record.decisionReasonHash, "decision reason hash"),
    auditDataHash: exactHash(record.auditDataHash, "audit data hash"),
    missionDecisionAction,
    auditAction,
    outboxAction,
    mutationStatementCount,
    postIncidentDecisionApplyWillApply: exactBoolean(
      record.postIncidentDecisionApplyWillApply,
      willApply,
      "post-incident apply flag"
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
    terminalDecisionMutation: exactBoolean(
      record.terminalDecisionMutation,
      false,
      "terminal-decision mutation flag"
    ) as false,
    offerIncidentMutation: exactBoolean(
      record.offerIncidentMutation,
      false,
      "offer-incident mutation flag"
    ) as false,
    incidentMutation: exactBoolean(
      record.incidentMutation,
      false,
      "incident mutation flag"
    ) as false,
    missionMutation: exactBoolean(record.missionMutation, false, "mission mutation flag") as false,
    actionMutation: exactBoolean(record.actionMutation, false, "action mutation flag") as false,
    rawSignalPayloadReturned: exactBoolean(
      record.rawSignalPayloadReturned,
      false,
      "raw payload flag"
    ) as false,
    planFingerprint: exactHash(record.planFingerprint, "plan fingerprint")
  };
  if (!EVENT_ID.test(plan.eventId) || !RESOLUTION_ID.test(plan.resolutionDecisionId)
    || !OFFER_OBSERVATION_ID.test(plan.offerObservationId)
    || !INCIDENT_ID.test(plan.incidentId)
    || plan.planFingerprint
      !== postgresSignalPostIncidentDecisionApplyPlanFingerprint(principal, plan)) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision plan fingerprint or committed identity is invalid."
    );
  }
  return plan;
}

function parseResult(
  value: Record<string, unknown>,
  plan: PostgresSignalPostIncidentDecisionApplyPlan
): PostgresSignalPostIncidentDecisionApplyResult {
  const record = exactObject(value, "apply result", [
    "contractVersion", "messageId", "planFingerprint", "eventId",
    "resolutionDecisionId", "listingId", "variantId", "offerObservationId",
    "incidentId", "semanticKey", "offerIncidentOutcome", "outcome",
    "decisionOutcome", "missionId", "actionJobId", "missionBindingRequired",
    "missionCreationRequired", "missionDecisionAction", "auditAction",
    "outboxAction", "mutationStatementCount", "postIncidentDecisionApplyApplied",
    "continueDownstream", "mutationAuthority", "idempotentReplay",
    "sharedCatalogMutated", "sourceReferencesMutated", "terminalDecisionsMutated",
    "offerIncidentGraphMutated", "incidentsMutated", "missionsMutated",
    "actionsMutated", "postIncidentDecisionGraphMutated",
    "remainingMissionActionGraphMutated", "inboxLifecycleMutated",
    "rawSignalPayloadReturned"
  ]);
  if (exactInteger(record.contractVersion, "result contract version") !== 1
    || record.messageId !== plan.messageId
    || record.planFingerprint !== plan.planFingerprint
    || record.eventId !== plan.eventId
    || record.resolutionDecisionId !== plan.resolutionDecisionId
    || record.listingId !== plan.listingId
    || record.variantId !== plan.variantId
    || record.offerObservationId !== plan.offerObservationId
    || record.incidentId !== plan.incidentId
    || record.semanticKey !== plan.semanticKey
    || record.offerIncidentOutcome !== plan.offerIncidentOutcome
    || record.outcome !== plan.outcome
    || record.decisionOutcome !== plan.decisionOutcome
    || record.missionId !== plan.missionId
    || record.actionJobId !== plan.actionJobId
    || record.missionBindingRequired !== plan.missionBindingRequired
    || record.missionCreationRequired !== plan.missionCreationRequired
    || record.missionDecisionAction !== plan.missionDecisionAction
    || record.auditAction !== plan.auditAction
    || record.outboxAction !== plan.outboxAction
    || exactInteger(record.mutationStatementCount, "result mutation statement count")
      !== plan.mutationStatementCount) {
    throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
      "The PostgreSQL signal-post-incident-decision apply result changed from its sealed plan."
    );
  }
  return {
    contractVersion: 1,
    messageId: plan.messageId,
    planFingerprint: plan.planFingerprint,
    eventId: plan.eventId,
    resolutionDecisionId: plan.resolutionDecisionId,
    listingId: plan.listingId,
    variantId: plan.variantId,
    offerObservationId: plan.offerObservationId,
    incidentId: plan.incidentId,
    semanticKey: plan.semanticKey,
    offerIncidentOutcome: "already_applied",
    outcome: plan.outcome,
    decisionOutcome: plan.decisionOutcome,
    missionId: plan.missionId,
    actionJobId: plan.actionJobId,
    missionBindingRequired: plan.missionBindingRequired,
    missionCreationRequired: plan.missionCreationRequired,
    missionDecisionAction: plan.missionDecisionAction,
    auditAction: plan.auditAction,
    outboxAction: plan.outboxAction,
    mutationStatementCount: plan.mutationStatementCount,
    postIncidentDecisionApplyApplied: exactBoolean(
      record.postIncidentDecisionApplyApplied,
      plan.postIncidentDecisionApplyWillApply,
      "post-incident applied flag"
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
    terminalDecisionsMutated: exactBoolean(
      record.terminalDecisionsMutated,
      false,
      "terminal-decision flag"
    ) as false,
    offerIncidentGraphMutated: exactBoolean(
      record.offerIncidentGraphMutated,
      false,
      "offer-incident graph flag"
    ) as false,
    incidentsMutated: exactBoolean(record.incidentsMutated, false, "incident flag") as false,
    missionsMutated: exactBoolean(record.missionsMutated, false, "mission flag") as false,
    actionsMutated: exactBoolean(record.actionsMutated, false, "action flag") as false,
    postIncidentDecisionGraphMutated: exactBoolean(
      record.postIncidentDecisionGraphMutated,
      plan.postIncidentDecisionApplyWillApply,
      "post-incident graph flag"
    ),
    remainingMissionActionGraphMutated: exactBoolean(
      record.remainingMissionActionGraphMutated,
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

export class NodePostgresSignalPostIncidentDecisionApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalPostIncidentDecisionApplyManifest;

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
    requestedOfferIncidentApplyRoleNamespace = "yoink_offer_qualification",
    requestedPostIncidentDecisionApplyRoleNamespace = "yoink_post_incident_qual",
    options: NodePostgresSignalPostIncidentDecisionApplyDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresSignalPostIncidentDecisionApplyManifest(
      requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
      requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
      requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
      requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
      requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace,
      requestedSourceReferenceRefreshRoleNamespace,
      requestedTerminalDecisionApplyRoleNamespace, requestedOfferIncidentApplyRoleNamespace,
      requestedPostIncidentDecisionApplyRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
        "The PostgreSQL signal-post-incident-decision connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_post_incident_decision_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async applySignalPostIncidentDecision(
    principal: BackgroundWorkerPrincipal,
    messageIdValue: string,
    capabilityTokenValue: string,
    now = Date.now()
  ): Promise<PostgresSignalPostIncidentDecisionApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const messageId = String(messageIdValue ?? "");
    const capabilityToken = String(capabilityTokenValue ?? "");
    if (!MESSAGE_ID.test(messageId) || !CAPABILITY_TOKEN.test(capabilityToken)
      || !Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
        "The PostgreSQL signal-post-incident-decision apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.postIncidentDecisionApplyRole.name)}`);
      const call = async (
        operation: "plan" | "apply",
        evaluatedAt: string,
        payload: Record<string, unknown>
      ): Promise<Record<string, unknown>> => {
        const result = await client.query<FunctionRow>(
          `SELECT result_json AS "resultJson"
           FROM ${relation(this.manifest.schemaName, POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION)}(
             $1, $2, $3, $4, $5, $6, $7
           )`,
          [tenantId, userId, operation, messageId, capabilityToken, evaluatedAt, JSON.stringify(payload)]
        );
        if (result.rows.length !== 1 || !result.rows[0]) {
          throw new PostgresSignalPostIncidentDecisionApplyQualificationError(
            "The PostgreSQL signal-post-incident-decision function returned an ambiguous result."
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
