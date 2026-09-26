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
  type PostgresQuerySession,
  logIdlePostgresClientErrors
} from "./postgres-cutover.js";
import { POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION } from "./postgres-hosted-delivery-lease-recovery.js";
import { POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION } from "./postgres-signal-catalog-apply.js";
import { POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION } from "./postgres-signal-resolution-apply.js";
import {
  POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION,
  buildPostgresSignalTerminalDecisionApplyManifest,
  verifyPostgresSignalTerminalDecisionApplyBoundary
} from "./postgres-signal-terminal-decision-apply.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_RECEIPT_TABLE =
  "yoink_signal_offer_incident_apply_receipt";
export const POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION =
  "yoink_apply_trackalacker_signal_offer_incident";

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
  "app_settings",
  "audit_events",
  "inbox_messages",
  "mission_decisions",
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
  "offer_observations",
  "signal_incidents",
  "signal_occurrences"
] as const);

type MutationAction = "none" | "insert" | "update";
type OfferIncidentPlanOutcome = "apply_offer_incident" | "already_applied";

export interface PostgresSignalOfferIncidentApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
  catalogApplyContractVersion: 1;
  resolutionApplyContractVersion: 1;
  terminalDecisionApplyContractVersion: 1;
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
  terminalDecisionApplyManifestFingerprint: string;
  offerIncidentApplyRole: {
    kind: "signal_offer_incident_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTenantTableCount: 14;
  forcedRlsTableCount: 14;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  maximumPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  committedResolutionBinding: true;
  settledTerminalDecisionRequired: true;
  actionableOfferRequired: true;
  serverDerivedSemanticKey: true;
  deterministicObservationIdentity: true;
  messageSerialization: true;
  semanticIncidentSerialization: true;
  dedupeWindowRepositoryParity: true;
  idempotentReplay: true;
  partialGraphFailClosed: true;
  offerObservationRepositoryParity: true;
  signalIncidentRepositoryParity: true;
  signalOccurrenceRepositoryParity: true;
  sharedCatalogMutation: false;
  sourceReferenceMutation: false;
  terminalDecisionMutation: false;
  missionMutation: false;
  actionMutation: false;
  offerIncidentGraphMutation: true;
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

export interface PostgresSignalOfferIncidentApplyQualificationReceipt {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
  catalogApplyContractVersion: 1;
  resolutionApplyContractVersion: 1;
  terminalDecisionApplyContractVersion: 1;
  phase: "verified";
  schemaName: string;
  roleManifestFingerprint: string;
  terminalDecisionApplyManifestFingerprint: string;
  offerIncidentApplyRoleName: string;
  protectedTenantTableCount: 14;
  forcedRlsTableCount: 14;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  maximumPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  committedResolutionBinding: true;
  settledTerminalDecisionRequired: true;
  actionableOfferRequired: true;
  serverDerivedSemanticKey: true;
  deterministicObservationIdentity: true;
  messageSerialization: true;
  semanticIncidentSerialization: true;
  dedupeWindowRepositoryParity: true;
  idempotentReplay: true;
  partialGraphFailClosed: true;
  offerObservationRepositoryParity: true;
  signalIncidentRepositoryParity: true;
  signalOccurrenceRepositoryParity: true;
  sharedCatalogMutation: false;
  sourceReferenceMutation: false;
  terminalDecisionMutation: false;
  missionMutation: false;
  actionMutation: false;
  offerIncidentGraphMutation: true;
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

export interface PostgresSignalOfferIncidentApplyCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  hostedDeliveryContractVersion: 3;
  catalogApplyContractVersion: 1;
  resolutionApplyContractVersion: 1;
  terminalDecisionApplyContractVersion: 1;
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
  settledTerminalDecisionRequired: true;
  actionableOfferRequired: true;
  serverDerivedSemanticKey: true;
  deterministicObservationIdentity: true;
  messageSerialization: true;
  semanticIncidentSerialization: true;
  dedupeWindowRepositoryParity: true;
  idempotentReplay: true;
  partialGraphFailClosed: true;
  offerObservationRepositoryParity: true;
  signalIncidentRepositoryParity: true;
  signalOccurrenceRepositoryParity: true;
  sharedCatalogMutation: false;
  sourceReferenceMutation: false;
  terminalDecisionMutation: false;
  missionMutation: false;
  actionMutation: false;
  offerIncidentGraphMutation: true;
  remainingMissionActionGraphMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  maximumPlanAgeSeconds: 30;
  protectedTenantTableCount: 14;
  forcedRlsTableCount: 14;
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

export interface PostgresSignalOfferIncidentApplyPlan {
  contractVersion: 1;
  messageId: string;
  payloadHash: string;
  evaluatedAt: string;
  validUntil: string;
  eventId: string;
  resolutionDecisionId: string;
  terminalDecisionOutcome: "continue_downstream";
  listingId: string;
  variantId: string;
  offerObservationId: string;
  semanticKey: string;
  dedupeWindowSeconds: number;
  outcome: OfferIncidentPlanOutcome;
  incidentId: string;
  offerObservationAction: MutationAction;
  incidentAction: MutationAction;
  occurrenceAction: MutationAction;
  mutationStatementCount: number;
  offerIncidentApplyWillApply: boolean;
  sharedCatalogMutation: false;
  sourceReferenceMutation: false;
  terminalDecisionMutation: false;
  missionMutation: false;
  actionMutation: false;
  rawSignalPayloadReturned: false;
  planFingerprint: string;
}

export interface PostgresSignalOfferIncidentApplyResult {
  contractVersion: 1;
  messageId: string;
  planFingerprint: string;
  eventId: string;
  resolutionDecisionId: string;
  terminalDecisionOutcome: "continue_downstream";
  listingId: string;
  variantId: string;
  offerObservationId: string;
  semanticKey: string;
  dedupeWindowSeconds: number;
  outcome: OfferIncidentPlanOutcome;
  incidentId: string;
  offerObservationAction: MutationAction;
  incidentAction: MutationAction;
  occurrenceAction: MutationAction;
  mutationStatementCount: number;
  offerIncidentApplyApplied: boolean;
  continueDownstream: true;
  mutationAuthority: true;
  idempotentReplay: true;
  sharedCatalogMutated: false;
  sourceReferencesMutated: false;
  terminalDecisionsMutated: false;
  incidentsMutated: boolean;
  offersMutated: boolean;
  missionsMutated: false;
  actionsMutated: false;
  offerIncidentGraphMutated: boolean;
  remainingMissionActionGraphMutated: false;
  inboxLifecycleMutated: false;
  rawSignalPayloadReturned: false;
}

export interface NodePostgresSignalOfferIncidentApplyDatabaseOptions {
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

let cachedCapabilityProjection: Readonly<PostgresSignalOfferIncidentApplyCapabilityProjection> | null = null;

export class PostgresSignalOfferIncidentApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalOfferIncidentApplyQualificationError";
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
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string, fallback: string): string {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  return `${namespace}_signal_offer_incident_apply`;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      `The PostgreSQL signal-offer-incident ${label} is invalid.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      `The PostgreSQL signal-offer-incident ${label} is out of range.`
    );
  }
  return parsed;
}

function exactText(value: unknown, label: string, maximum = 300, allowEmpty = false): string {
  const normalized = String(value ?? "");
  if (normalized.length > maximum || (!allowEmpty && normalized.length === 0)
    || normalized.trim() !== normalized || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      `The PostgreSQL signal-offer-incident ${label} is invalid.`
    );
  }
  return normalized;
}

function exactHash(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!SHA256.test(normalized)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      `The PostgreSQL signal-offer-incident ${label} is invalid.`
    );
  }
  return normalized;
}

function exactTimestamp(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)
    || Number.isNaN(Date.parse(normalized))) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      `The PostgreSQL signal-offer-incident ${label} is invalid.`
    );
  }
  return normalized;
}

function exactBoolean(value: unknown, expected: boolean, label: string): boolean {
  if (value !== expected) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      `The PostgreSQL signal-offer-incident ${label} is invalid.`
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

export function postgresSignalOfferIncidentApplyPlanFingerprint(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  plan: PostgresSignalOfferIncidentApplyPlan
): string {
  return stableHash(
    "postgres_signal_offer_incident_apply_plan_v1",
    principal.tenantId,
    principal.userId,
    plan.contractVersion,
    plan.messageId,
    plan.payloadHash,
    plan.evaluatedAt,
    plan.validUntil,
    plan.eventId,
    plan.resolutionDecisionId,
    plan.terminalDecisionOutcome,
    plan.listingId,
    plan.variantId,
    plan.offerObservationId,
    plan.semanticKey,
    plan.dedupeWindowSeconds,
    plan.outcome,
    plan.incidentId,
    plan.offerObservationAction,
    plan.incidentAction,
    plan.occurrenceAction,
    plan.mutationStatementCount,
    plan.offerIncidentApplyWillApply ? 1 : 0,
    plan.sharedCatalogMutation ? 1 : 0,
    plan.sourceReferenceMutation ? 1 : 0,
    plan.terminalDecisionMutation ? 1 : 0,
    plan.missionMutation ? 1 : 0,
    plan.actionMutation ? 1 : 0,
    plan.rawSignalPayloadReturned ? 1 : 0
  );
}

export function signalOfferIncidentApplyFunctionSource(
  manifest: PostgresSignalOfferIncidentApplyManifest
): string {
  const offerObservationIdInput = stableHashInputSql([
    "'postgres_signal_offer_observation_id_v1'::text",
    "event_record.id::text"
  ]);
  const occurrenceIdInput = stableHashInputSql([
    "'postgres_signal_offer_occurrence_id_v1'::text",
    "event_record.id::text"
  ]);
  const incidentIdInput = stableHashInputSql([
    "'postgres_signal_incident_id_v1'::text",
    "event_record.id::text"
  ]);
  const semanticKeyInput = stableHashInputSql([
    "listing_id_value",
    "event_record.event_type::text",
    "COALESCE(unit_price_cents_value::text, '')",
    "currency_value",
    "seller_type_value",
    "pg_catalog.lower(seller_name_value)",
    "offer_fingerprint_value"
  ]);
  const planInput = stableHashInputSql([
    "'postgres_signal_offer_incident_apply_plan_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'1'::text",
    "message_id_value",
    "payload_hash_value",
    "evaluation_timestamp",
    "valid_until_timestamp",
    "event_record.id::text",
    "resolution_record.id::text",
    "'continue_downstream'::text",
    "listing_id_value",
    "variant_id_value",
    "offer_observation_id_value",
    "semantic_key_value",
    "dedupe_window_seconds_value::text",
    "outcome_value",
    "incident_id_value",
    "offer_observation_action_value",
    "incident_action_value",
    "occurrence_action_value",
    "mutation_statement_count::text",
    "CASE WHEN outcome_value = 'apply_offer_incident' THEN '1' ELSE '0' END",
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
  terminal_plan JSONB;
  terminal_plan_count BIGINT;
  message_id_value TEXT;
  payload_hash_value TEXT;
  event_record RECORD;
  resolution_record RECORD;
  offer_value JSONB;
  listing_id_value TEXT;
  variant_id_value TEXT;
  availability_value TEXT;
  unit_price_text TEXT;
  unit_price_cents_value BIGINT;
  currency_value TEXT;
  seller_name_value TEXT;
  seller_type_value TEXT;
  order_limit_text TEXT;
  order_limit_value BIGINT;
  fulfillment_value TEXT;
  offer_fingerprint_value TEXT;
  dedupe_window_seconds_value BIGINT;
  cutoff_timestamp TEXT;
  source_connection_count BIGINT;
  listing_count BIGINT;
  offer_observation_id_value TEXT;
  occurrence_id_value TEXT;
  new_incident_id_value TEXT;
  semantic_key_value TEXT;
  offer_observation_count BIGINT;
  occurrence_count BIGINT;
  occurrence_id_collision_count BIGINT;
  incident_occurrence_count BIGINT;
  incident_id_collision_count BIGINT;
  offer_record RECORD;
  occurrence_record RECORD;
  incident_record RECORD;
  incident_id_value TEXT;
  outcome_value TEXT;
  offer_observation_action_value TEXT := 'none';
  incident_action_value TEXT := 'none';
  occurrence_action_value TEXT := 'none';
  mutation_statement_count BIGINT := 0;
  plan_fingerprint_value TEXT;
  plan_value JSONB;
  apply_payload JSONB;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = ''
    OR target_message_id !~ '^inbox_[a-f0-9]{32}$'
    OR capability_token !~ '^[A-Za-z0-9_-]{43}$'
    OR operation_name NOT IN ('plan', 'apply')
    OR pg_catalog.octet_length(apply_payload_json) > ${MAXIMUM_APPLY_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal offer-incident request is invalid';
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
    'yoink_signal_offer_incident_message_v1:' || resolved_tenant_id || ':' ||
      resolved_user_id || ':' || target_message_id,
    0
  ));

  IF operation_name = 'plan' THEN
    IF evaluation_timestamp_input <> '' OR apply_payload_json::jsonb <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal offer-incident plan input is invalid';
    END IF;
    evaluation_clock := pg_catalog.statement_timestamp();
  ELSE
    IF evaluation_timestamp_input !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal offer-incident evaluation timestamp is invalid';
    END IF;
    evaluation_clock := evaluation_timestamp_input::timestamptz;
    IF evaluation_clock > pg_catalog.statement_timestamp()
      OR EXTRACT(EPOCH FROM (pg_catalog.statement_timestamp() - evaluation_clock))
        > ${MAXIMUM_PLAN_AGE_SECONDS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal offer-incident plan expired before apply';
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
    INTO terminal_plan, terminal_plan_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_FUNCTION)}(
    expected_tenant_id, expected_user_id, 'plan', target_message_id,
    capability_token, '', '{}'
  ) AS planned;
  IF terminal_plan_count <> 1 OR terminal_plan IS NULL
    OR terminal_plan->>'messageId' <> target_message_id
    OR terminal_plan->>'eventId' !~ '^signal_event_[a-f0-9]{32}$'
    OR terminal_plan->>'resolutionDecisionId' !~ '^resolution_[a-f0-9]{32}$'
    OR terminal_plan->>'payloadHash' !~ '^[a-f0-9]{64}$'
    OR terminal_plan->>'resolutionStatus' <> 'matched'
    OR COALESCE(terminal_plan->>'listingId', '') = ''
    OR COALESCE(terminal_plan->>'variantId', '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal offer-incident predecessor validation failed';
  END IF;
  IF terminal_plan->>'outcome' <> 'continue_downstream'
    OR terminal_plan->>'decisionOutcome' <> ''
    OR terminal_plan->>'terminalDecisionApplyWillApply' <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'terminal signal decision must settle as actionable before offer-incident apply';
  END IF;
  message_id_value := terminal_plan->>'messageId';
  payload_hash_value := terminal_plan->>'payloadHash';
  listing_id_value := terminal_plan->>'listingId';
  variant_id_value := terminal_plan->>'variantId';

  SELECT event.id, event.tenant_id, event.user_id, event.source_connection_id,
         event.signal_id, event.event_type, event.test, event.observed_at,
         event.received_at, event.offer_json, event.resolution_status
    INTO event_record
  FROM ${relation(manifest.schemaName, "signal_events")} AS event
  WHERE event.id = terminal_plan->>'eventId'
    AND event.tenant_id = resolved_tenant_id
    AND event.user_id = resolved_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'committed signal event is unavailable for offer-incident apply';
  END IF;

  SELECT decision.id, decision.event_id, decision.status,
         decision.variant_id, decision.listing_id
    INTO resolution_record
  FROM ${relation(manifest.schemaName, "resolution_decisions")} AS decision
  WHERE decision.id = terminal_plan->>'resolutionDecisionId'
    AND decision.event_id = event_record.id;
  IF NOT FOUND OR resolution_record.status <> 'matched'
    OR event_record.resolution_status <> 'matched'
    OR resolution_record.listing_id <> listing_id_value
    OR resolution_record.variant_id <> variant_id_value THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'committed resolution changed before offer-incident apply';
  END IF;
  IF event_record.test <> 0
    OR event_record.event_type NOT IN ('in_stock', 'restock', 'preorder')
    OR event_record.observed_at !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
    OR event_record.received_at !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal event is not an actionable offer-incident input';
  END IF;

  SELECT COUNT(*) INTO listing_count
  FROM ${relation(manifest.schemaName, "listings")} AS listing
  WHERE listing.id = listing_id_value AND listing.variant_id = variant_id_value;
  IF listing_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'offer-incident listing binding is unavailable';
  END IF;
  SELECT COUNT(*) INTO source_connection_count
  FROM ${relation(manifest.schemaName, "source_connections")} AS connection
  WHERE connection.id = event_record.source_connection_id
    AND connection.tenant_id = resolved_tenant_id
    AND connection.user_id = resolved_user_id;
  IF source_connection_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'offer-incident source connection is unavailable';
  END IF;
  SELECT settings.dedupe_window_seconds
    INTO dedupe_window_seconds_value
  FROM ${relation(manifest.schemaName, "app_settings")} AS settings
  WHERE settings.user_id = resolved_user_id;
  IF NOT FOUND OR dedupe_window_seconds_value < 30 OR dedupe_window_seconds_value > 3600 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'offer-incident dedupe settings are unavailable';
  END IF;

  offer_value := event_record.offer_json::jsonb;
  IF pg_catalog.jsonb_typeof(offer_value) <> 'object'
    OR NOT (offer_value ?& ARRAY[
      'availability', 'unitPriceCents', 'currency', 'sellerName',
      'sellerType', 'orderLimit', 'fulfillment', 'offerFingerprint'
    ])
    OR offer_value - ARRAY[
      'availability', 'unitPriceCents', 'currency', 'sellerName',
      'sellerType', 'orderLimit', 'fulfillment', 'offerFingerprint'
    ] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'offer-incident evidence shape is invalid';
  END IF;
  availability_value := COALESCE(offer_value->>'availability', '');
  unit_price_text := COALESCE(offer_value->>'unitPriceCents', '');
  currency_value := COALESCE(offer_value->>'currency', '');
  seller_name_value := COALESCE(offer_value->>'sellerName', '');
  seller_type_value := COALESCE(offer_value->>'sellerType', '');
  order_limit_text := COALESCE(offer_value->>'orderLimit', '');
  fulfillment_value := COALESCE(offer_value->>'fulfillment', '');
  offer_fingerprint_value := COALESCE(offer_value->>'offerFingerprint', '');
  IF availability_value NOT IN ('in_stock', 'preorder')
    OR (offer_value->'unitPriceCents' <> 'null'::jsonb
      AND (pg_catalog.jsonb_typeof(offer_value->'unitPriceCents') <> 'number'
        OR unit_price_text !~ '^[1-9][0-9]{0,8}$'
        OR unit_price_text::numeric > 100000000))
    OR pg_catalog.length(currency_value) > 3
    OR currency_value <> pg_catalog.upper(currency_value)
    OR pg_catalog.length(seller_name_value) > 160
    OR seller_name_value <> pg_catalog.btrim(seller_name_value)
    OR seller_name_value ~ '[[:cntrl:]]'
    OR seller_type_value NOT IN ('first_party', 'third_party', 'unknown')
    OR (offer_value->'orderLimit' <> 'null'::jsonb
      AND (pg_catalog.jsonb_typeof(offer_value->'orderLimit') <> 'number'
        OR order_limit_text !~ '^[1-9][0-9]?$'
        OR order_limit_text::numeric > 99))
    OR fulfillment_value NOT IN ('shipping', 'pickup', 'either', 'manual', 'unknown')
    OR (offer_fingerprint_value <> '' AND offer_fingerprint_value !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'offer-incident evidence is invalid';
  END IF;
  unit_price_cents_value := CASE WHEN unit_price_text = '' THEN NULL ELSE unit_price_text::bigint END;
  order_limit_value := CASE WHEN order_limit_text = '' THEN NULL ELSE order_limit_text::bigint END;

  semantic_key_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${semanticKeyInput}, 'UTF8')), 'hex'
  );
  offer_observation_id_value := 'offer_observation_' || pg_catalog.substr(
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(${offerObservationIdInput}, 'UTF8')), 'hex'),
    1, 32
  );
  occurrence_id_value := 'occurrence_' || pg_catalog.substr(
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(${occurrenceIdInput}, 'UTF8')), 'hex'),
    1, 32
  );
  new_incident_id_value := 'incident_' || pg_catalog.substr(
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(${incidentIdInput}, 'UTF8')), 'hex'),
    1, 32
  );
  cutoff_timestamp := pg_catalog.to_char(
    (event_record.observed_at::timestamptz
      - pg_catalog.make_interval(secs => dedupe_window_seconds_value::integer)) AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'yoink_signal_offer_incident_semantic_v1:' || resolved_tenant_id || ':' ||
      resolved_user_id || ':' || semantic_key_value,
    0
  ));

  SELECT COUNT(*) INTO offer_observation_count
  FROM ${relation(manifest.schemaName, "offer_observations")} AS observation
  WHERE observation.id = offer_observation_id_value;
  SELECT COUNT(*) INTO occurrence_count
  FROM ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
  WHERE occurrence.event_id = event_record.id;
  SELECT COUNT(*) INTO occurrence_id_collision_count
  FROM ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
  WHERE occurrence.id = occurrence_id_value AND occurrence.event_id <> event_record.id;
  IF offer_observation_count > 1 OR occurrence_count > 1
    OR occurrence_id_collision_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'offer-incident graph identity is ambiguous';
  END IF;

  IF offer_observation_count = 1 AND occurrence_count = 1 THEN
    SELECT observation.* INTO offer_record
    FROM ${relation(manifest.schemaName, "offer_observations")} AS observation
    WHERE observation.id = offer_observation_id_value;
    SELECT occurrence.* INTO occurrence_record
    FROM ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
    WHERE occurrence.event_id = event_record.id;
    IF occurrence_record.incident_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'existing offer-incident occurrence is not linked';
    END IF;
    SELECT incident.* INTO incident_record
    FROM ${relation(manifest.schemaName, "signal_incidents")} AS incident
    WHERE incident.id = occurrence_record.incident_id
      AND incident.tenant_id = resolved_tenant_id
      AND incident.user_id = resolved_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'existing offer-incident record is unavailable';
    END IF;
    SELECT COUNT(*) INTO incident_occurrence_count
    FROM ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
    WHERE occurrence.incident_id = incident_record.id;
    IF offer_record.id <> offer_observation_id_value
      OR offer_record.listing_id <> listing_id_value
      OR offer_record.source_connection_id <> event_record.source_connection_id
      OR offer_record.availability <> availability_value
      OR offer_record.unit_price_cents IS DISTINCT FROM unit_price_cents_value
      OR offer_record.currency <> currency_value
      OR offer_record.seller_name <> seller_name_value
      OR offer_record.seller_type <> seller_type_value
      OR offer_record.order_limit IS DISTINCT FROM order_limit_value
      OR offer_record.offer_fingerprint <> offer_fingerprint_value
      OR offer_record.observed_at <> event_record.observed_at
      OR occurrence_record.id <> occurrence_id_value
      OR occurrence_record.source_connection_id <> event_record.source_connection_id
      OR occurrence_record.observed_at <> event_record.observed_at
      OR occurrence_record.received_at <> event_record.received_at
      OR occurrence_record.created_at <> offer_record.created_at
      OR incident_record.id !~ '^incident_[a-f0-9]{32}$'
      OR incident_record.listing_id <> listing_id_value
      OR incident_record.event_type <> event_record.event_type
      OR incident_record.semantic_key <> semantic_key_value
      OR incident_record.unit_price_cents IS DISTINCT FROM unit_price_cents_value
      OR incident_record.currency <> currency_value
      OR incident_record.seller_name <> seller_name_value
      OR incident_record.seller_type <> seller_type_value
      OR incident_record.offer_fingerprint <> offer_fingerprint_value
      OR incident_record.occurrence_count <> incident_occurrence_count
      OR incident_record.occurrence_count < 1
      OR incident_record.first_observed_at > incident_record.last_observed_at
      OR incident_record.last_observed_at < event_record.observed_at THEN
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'existing offer-incident graph is inconsistent';
    END IF;
    incident_id_value := incident_record.id;
    outcome_value := 'already_applied';
  ELSIF offer_observation_count = 0 AND occurrence_count = 0 THEN
    SELECT incident.* INTO incident_record
    FROM ${relation(manifest.schemaName, "signal_incidents")} AS incident
    WHERE incident.tenant_id = resolved_tenant_id
      AND incident.user_id = resolved_user_id
      AND incident.semantic_key = semantic_key_value
      AND incident.status = 'open'
      AND incident.last_observed_at >= cutoff_timestamp
    ORDER BY incident.last_observed_at DESC, incident.id ASC
    LIMIT 1
    FOR UPDATE;
    IF FOUND THEN
      SELECT COUNT(*) INTO incident_occurrence_count
      FROM ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
      WHERE occurrence.incident_id = incident_record.id;
      IF incident_record.id !~ '^incident_[a-f0-9]{32}$'
        OR incident_record.listing_id <> listing_id_value
        OR incident_record.event_type <> event_record.event_type
        OR incident_record.unit_price_cents IS DISTINCT FROM unit_price_cents_value
        OR incident_record.currency <> currency_value
        OR incident_record.seller_name <> seller_name_value
        OR incident_record.seller_type <> seller_type_value
        OR incident_record.offer_fingerprint <> offer_fingerprint_value
        OR incident_record.occurrence_count <> incident_occurrence_count
        OR incident_record.occurrence_count < 1 THEN
        RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'open offer incident is inconsistent';
      END IF;
      incident_id_value := incident_record.id;
      incident_action_value := 'update';
    ELSE
      SELECT COUNT(*) INTO incident_id_collision_count
      FROM ${relation(manifest.schemaName, "signal_incidents")} AS incident
      WHERE incident.id = new_incident_id_value;
      IF incident_id_collision_count <> 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'new offer-incident identity collides';
      END IF;
      incident_id_value := new_incident_id_value;
      incident_action_value := 'insert';
    END IF;
    outcome_value := 'apply_offer_incident';
    offer_observation_action_value := 'insert';
    occurrence_action_value := 'insert';
    mutation_statement_count := 3;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'partial offer-incident graph fails closed';
  END IF;

  plan_fingerprint_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${planInput}, 'UTF8')), 'hex'
  );
  plan_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_id_value,
    'payloadHash', payload_hash_value,
    'evaluatedAt', evaluation_timestamp,
    'validUntil', valid_until_timestamp,
    'eventId', event_record.id,
    'resolutionDecisionId', resolution_record.id,
    'terminalDecisionOutcome', 'continue_downstream',
    'listingId', listing_id_value,
    'variantId', variant_id_value,
    'offerObservationId', offer_observation_id_value,
    'semanticKey', semantic_key_value,
    'dedupeWindowSeconds', dedupe_window_seconds_value,
    'outcome', outcome_value,
    'incidentId', incident_id_value,
    'offerObservationAction', offer_observation_action_value,
    'incidentAction', incident_action_value,
    'occurrenceAction', occurrence_action_value,
    'mutationStatementCount', mutation_statement_count,
    'offerIncidentApplyWillApply', outcome_value = 'apply_offer_incident',
    'sharedCatalogMutation', FALSE,
    'sourceReferenceMutation', FALSE,
    'terminalDecisionMutation', FALSE,
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal offer-incident apply payload does not match its current plan';
  END IF;

  IF outcome_value = 'apply_offer_incident' THEN
    INSERT INTO ${relation(manifest.schemaName, "offer_observations")}(
      id, listing_id, source_connection_id, availability, unit_price_cents,
      currency, seller_name, seller_type, order_limit, offer_fingerprint,
      observed_at, created_at
    ) VALUES (
      offer_observation_id_value, listing_id_value, event_record.source_connection_id,
      availability_value, unit_price_cents_value, currency_value, seller_name_value,
      seller_type_value, order_limit_value, offer_fingerprint_value,
      event_record.observed_at, evaluation_timestamp
    );
    IF incident_action_value = 'insert' THEN
      INSERT INTO ${relation(manifest.schemaName, "signal_incidents")}(
        id, tenant_id, user_id, listing_id, event_type, semantic_key, status,
        unit_price_cents, currency, seller_name, seller_type, offer_fingerprint,
        first_observed_at, last_observed_at, occurrence_count, closed_reason,
        created_at, updated_at
      ) VALUES (
        incident_id_value, resolved_tenant_id, resolved_user_id, listing_id_value,
        event_record.event_type, semantic_key_value, 'open', unit_price_cents_value,
        currency_value, seller_name_value, seller_type_value, offer_fingerprint_value,
        event_record.observed_at, event_record.observed_at, 1, '',
        evaluation_timestamp, evaluation_timestamp
      );
    ELSE
      UPDATE ${relation(manifest.schemaName, "signal_incidents")} AS incident
      SET occurrence_count = incident.occurrence_count + 1,
          last_observed_at = CASE
            WHEN incident.last_observed_at < event_record.observed_at THEN event_record.observed_at
            ELSE incident.last_observed_at
          END,
          updated_at = evaluation_timestamp
      WHERE incident.id = incident_id_value
        AND incident.tenant_id = resolved_tenant_id
        AND incident.user_id = resolved_user_id
        AND incident.status = 'open';
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'open offer incident changed before corroboration';
      END IF;
    END IF;
    INSERT INTO ${relation(manifest.schemaName, "signal_occurrences")}(
      id, event_id, incident_id, source_connection_id,
      observed_at, received_at, created_at
    ) VALUES (
      occurrence_id_value, event_record.id, incident_id_value,
      event_record.source_connection_id, event_record.observed_at,
      event_record.received_at, evaluation_timestamp
    );
  END IF;

  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_id_value,
    'planFingerprint', plan_fingerprint_value,
    'eventId', event_record.id,
    'resolutionDecisionId', resolution_record.id,
    'terminalDecisionOutcome', 'continue_downstream',
    'listingId', listing_id_value,
    'variantId', variant_id_value,
    'offerObservationId', offer_observation_id_value,
    'semanticKey', semantic_key_value,
    'dedupeWindowSeconds', dedupe_window_seconds_value,
    'outcome', outcome_value,
    'incidentId', incident_id_value,
    'offerObservationAction', offer_observation_action_value,
    'incidentAction', incident_action_value,
    'occurrenceAction', occurrence_action_value,
    'mutationStatementCount', mutation_statement_count,
    'offerIncidentApplyApplied', outcome_value = 'apply_offer_incident',
    'continueDownstream', TRUE,
    'mutationAuthority', TRUE,
    'idempotentReplay', TRUE,
    'sharedCatalogMutated', FALSE,
    'sourceReferencesMutated', FALSE,
    'terminalDecisionsMutated', FALSE,
    'incidentsMutated', outcome_value = 'apply_offer_incident',
    'offersMutated', outcome_value = 'apply_offer_incident',
    'missionsMutated', FALSE,
    'actionsMutated', FALSE,
    'offerIncidentGraphMutated', outcome_value = 'apply_offer_incident',
    'remainingMissionActionGraphMutated', FALSE,
    'inboxLifecycleMutated', FALSE,
    'rawSignalPayloadReturned', FALSE
  )::text;
END
`;
}

export function buildPostgresSignalOfferIncidentApplyManifest(
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
  requestedOfferIncidentApplyRoleNamespace = "yoink_offer_qualification"
): PostgresSignalOfferIncidentApplyManifest {
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
    safeNamespace(requestedOfferIncidentApplyRoleNamespace, "yoink_offer_qualification")
  ] as const;
  const [schemaName, readRoleNamespace, sessionRoleNamespace, queueWriteRoleNamespace,
    controlRoleNamespace, notificationRecoveryRoleNamespace, executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace, observerCandidateRoleNamespace, alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace, witnessRefreshRoleNamespace, leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace, resolutionApplyRoleNamespace,
    sourceReferenceRefreshRoleNamespace, terminalDecisionApplyRoleNamespace,
    offerIncidentApplyRoleNamespace] = values;
  if (new Set(values.slice(1)).size !== values.length - 1) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident role namespace must be independent."
    );
  }
  const previous = buildPostgresSignalTerminalDecisionApplyManifest(
    schemaName, readRoleNamespace, sessionRoleNamespace, queueWriteRoleNamespace,
    controlRoleNamespace, notificationRecoveryRoleNamespace, executionRecoveryRoleNamespace,
    operationalRetentionRoleNamespace, observerCandidateRoleNamespace, alertDispatchRoleNamespace,
    alertReconciliationRoleNamespace, witnessRefreshRoleNamespace, leaseRecoveryRoleNamespace,
    catalogApplyRoleNamespace, resolutionApplyRoleNamespace,
    sourceReferenceRefreshRoleNamespace, terminalDecisionApplyRoleNamespace
  );
  const withoutFingerprint: Omit<PostgresSignalOfferIncidentApplyManifest, "fingerprint"> = {
    contractVersion: POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    hostedDeliveryContractVersion: POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
    catalogApplyContractVersion: POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION,
    resolutionApplyContractVersion: POSTGRES_SIGNAL_RESOLUTION_APPLY_CONTRACT_VERSION,
    terminalDecisionApplyContractVersion:
      POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_CONTRACT_VERSION,
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
    terminalDecisionApplyManifestFingerprint: previous.fingerprint,
    offerIncidentApplyRole: {
      kind: "signal_offer_incident_apply_boundary",
      name: roleName(offerIncidentApplyRoleNamespace),
      functionName: POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTenantTableCount: 14,
    forcedRlsTableCount: 14,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    maximumPlanAgeSeconds: 30,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    committedResolutionBinding: true,
    settledTerminalDecisionRequired: true,
    actionableOfferRequired: true,
    serverDerivedSemanticKey: true,
    deterministicObservationIdentity: true,
    messageSerialization: true,
    semanticIncidentSerialization: true,
    dedupeWindowRepositoryParity: true,
    idempotentReplay: true,
    partialGraphFailClosed: true,
    offerObservationRepositoryParity: true,
    signalIncidentRepositoryParity: true,
    signalOccurrenceRepositoryParity: true,
    sharedCatalogMutation: false,
    sourceReferenceMutation: false,
    terminalDecisionMutation: false,
    missionMutation: false,
    actionMutation: false,
    offerIncidentGraphMutation: true,
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

export function postgresSignalOfferIncidentApplyCapabilityProjection():
PostgresSignalOfferIncidentApplyCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalOfferIncidentApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    hostedDeliveryContractVersion: 3,
    catalogApplyContractVersion: 1,
    resolutionApplyContractVersion: 1,
    terminalDecisionApplyContractVersion: 1,
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
    settledTerminalDecisionRequired: true,
    actionableOfferRequired: true,
    serverDerivedSemanticKey: true,
    deterministicObservationIdentity: true,
    messageSerialization: true,
    semanticIncidentSerialization: true,
    dedupeWindowRepositoryParity: true,
    idempotentReplay: true,
    partialGraphFailClosed: true,
    offerObservationRepositoryParity: true,
    signalIncidentRepositoryParity: true,
    signalOccurrenceRepositoryParity: true,
    sharedCatalogMutation: false,
    sourceReferenceMutation: false,
    terminalDecisionMutation: false,
    missionMutation: false,
    actionMutation: false,
    offerIncidentGraphMutation: true,
    remainingMissionActionGraphMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    maximumPlanAgeSeconds: 30,
    protectedTenantTableCount: 14,
    forcedRlsTableCount: 14,
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
  manifest: PostgresSignalOfferIncidentApplyManifest
): Promise<BoundaryInspection> {
  const role = manifest.offerIncidentApplyRole.name;
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
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident role attributes are unsafe."
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
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident role must have no membership."
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
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident role has a direct table or column grant."
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
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident role has an unauthorized effective table privilege."
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
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident role has an unauthorized effective column privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident role has an invalid schema privilege."
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
    || routine.routineName !== POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE
    || routine.volatility !== "v" || routine.securityDefiner !== true
    || routine.strict !== true || routine.leakproof !== false
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role || routine.source !== signalOfferIncidentApplyFunctionSource(manifest)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident function boundary is incomplete."
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
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident function grant is not exact."
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
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident protected table set is incomplete."
    );
  }
  const mutationTables = protectedTables.rows.filter((row) =>
    (MUTATION_TABLES as readonly string[]).includes(row.tableName)
  );
  if (mutationTables.map((row) => row.tableName).join(",")
    !== [...MUTATION_TABLES].sort().join(",")) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident mutation table set is incomplete."
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
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident role must not access application sequences."
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
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident role must not own application objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident role must not depend on a direct table policy."
    );
  }

  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  if (exactInteger(principals.rows[0]?.count, "active principal count") !== 0) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "Signal-offer-incident qualification cannot activate a runtime principal."
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
  row: Record<string, unknown>,
  manifest: PostgresSignalOfferIncidentApplyManifest
): PostgresSignalOfferIncidentApplyQualificationReceipt {
  if (row.phase !== "verified"
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.terminal_decision_apply_manifest_fingerprint
      !== manifest.terminalDecisionApplyManifestFingerprint
    || row.offer_incident_apply_role_name !== manifest.offerIncidentApplyRole.name
    || !SHA256.test(String(row.boundary_catalog_fingerprint ?? ""))) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident receipt identity is incomplete."
    );
  }
  const counts = [
    [row.contract_version, 1, "contract version"],
    [row.cutover_contract_version, 3, "cutover contract version"],
    [row.hosted_delivery_contract_version, 3, "hosted-delivery contract version"],
    [row.catalog_apply_contract_version, 1, "catalog-apply contract version"],
    [row.resolution_apply_contract_version, 1, "resolution-apply contract version"],
    [row.terminal_decision_apply_contract_version, 1, "terminal-decision contract version"],
    [row.protected_tenant_table_count, 14, "protected table count"],
    [row.forced_rls_table_count, 14, "forced RLS table count"],
    [row.mutation_table_count, 3, "mutation table count"],
    [row.direct_table_grant_count, 0, "direct grant count"],
    [row.function_grant_count, 1, "function grant count"],
    [row.membership_count, 0, "membership count"],
    [row.active_principal_count, 0, "active principal count"],
    [row.maximum_plan_age_seconds, 30, "plan age"]
  ] as const;
  for (const [value, expected, label] of counts) {
    if (exactInteger(value, label) !== expected) {
      throw new PostgresSignalOfferIncidentApplyQualificationError(
        "The PostgreSQL signal-offer-incident receipt uses an unsupported contract."
      );
    }
  }
  const booleans = [
    ["server_bound_principal_lookup", true],
    ["database_plan_revalidation", true],
    ["committed_resolution_binding", true],
    ["settled_terminal_decision_required", true],
    ["actionable_offer_required", true],
    ["server_derived_semantic_key", true],
    ["deterministic_observation_identity", true],
    ["message_serialization", true],
    ["semantic_incident_serialization", true],
    ["dedupe_window_repository_parity", true],
    ["idempotent_replay", true],
    ["partial_graph_fail_closed", true],
    ["offer_observation_repository_parity", true],
    ["signal_incident_repository_parity", true],
    ["signal_occurrence_repository_parity", true],
    ["shared_catalog_mutation", false],
    ["source_reference_mutation", false],
    ["terminal_decision_mutation", false],
    ["mission_mutation", false],
    ["action_mutation", false],
    ["offer_incident_graph_mutation", true],
    ["remaining_mission_action_graph_mutation", false],
    ["inbox_lifecycle_mutation", false],
    ["raw_signal_payload_returned", false],
    ["signal_evaluation_apply_repository_parity", false],
    ["hosted_delivery_handler_repository_parity", false],
    ["mutation_authority", true],
    ["direct_table_access", false],
    ["runtime_authority", false],
    ["production_ready", false]
  ] as const;
  if (booleans.some(([key, expected]) => row[key] !== expected)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident receipt is incomplete or unsafe."
    );
  }
  return {
    contractVersion: 1,
    cutoverContractVersion: 3,
    hostedDeliveryContractVersion: 3,
    catalogApplyContractVersion: 1,
    resolutionApplyContractVersion: 1,
    terminalDecisionApplyContractVersion: 1,
    phase: "verified",
    schemaName: manifest.schemaName,
    roleManifestFingerprint: manifest.fingerprint,
    terminalDecisionApplyManifestFingerprint:
      manifest.terminalDecisionApplyManifestFingerprint,
    offerIncidentApplyRoleName: manifest.offerIncidentApplyRole.name,
    protectedTenantTableCount: 14,
    forcedRlsTableCount: 14,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    maximumPlanAgeSeconds: 30,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    committedResolutionBinding: true,
    settledTerminalDecisionRequired: true,
    actionableOfferRequired: true,
    serverDerivedSemanticKey: true,
    deterministicObservationIdentity: true,
    messageSerialization: true,
    semanticIncidentSerialization: true,
    dedupeWindowRepositoryParity: true,
    idempotentReplay: true,
    partialGraphFailClosed: true,
    offerObservationRepositoryParity: true,
    signalIncidentRepositoryParity: true,
    signalOccurrenceRepositoryParity: true,
    sharedCatalogMutation: false,
    sourceReferenceMutation: false,
    terminalDecisionMutation: false,
    missionMutation: false,
    actionMutation: false,
    offerIncidentGraphMutation: true,
    remainingMissionActionGraphMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    mutationAuthority: true,
    directTableAccess: false,
    runtimeAuthority: false,
    productionReady: false,
    boundaryCatalogFingerprint: String(row.boundary_catalog_fingerprint),
    appliedAt: exactTimestamp(row.applied_at, "application timestamp"),
    verifiedAt: exactTimestamp(row.verified_at, "verification timestamp")
  };
}

async function readReceipt(
  session: PostgresQuerySession,
  manifest: PostgresSignalOfferIncidentApplyManifest
): Promise<PostgresSignalOfferIncidentApplyQualificationReceipt> {
  const result = await session.query<Record<string, unknown>>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_RECEIPT_TABLE)}
     WHERE singleton = TRUE`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresSignalOfferIncidentApplyQualificationReceipt,
  manifest: PostgresSignalOfferIncidentApplyManifest
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
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresSignalOfferIncidentApplyBoundary(
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
  requestedOfferIncidentApplyRoleNamespace = "yoink_offer_qualification"
): Promise<PostgresSignalOfferIncidentApplyQualificationReceipt> {
  const manifest = buildPostgresSignalOfferIncidentApplyManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
    requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace,
    requestedSourceReferenceRefreshRoleNamespace, requestedTerminalDecisionApplyRoleNamespace,
    requestedOfferIncidentApplyRoleNamespace
  );
  await verifyPostgresSignalTerminalDecisionApplyBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace, manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace, manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace, manifest.leaseRecoveryRoleNamespace,
    manifest.catalogApplyRoleNamespace, manifest.resolutionApplyRoleNamespace,
    manifest.sourceReferenceRefreshRoleNamespace, manifest.terminalDecisionApplyRoleNamespace
  );
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresSignalOfferIncidentApplyBoundary(
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
  now = Date.now()
): Promise<PostgresSignalOfferIncidentApplyQualificationReceipt> {
  if (!Number.isSafeInteger(now)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident qualification timestamp is invalid."
    );
  }
  const manifest = buildPostgresSignalOfferIncidentApplyManifest(
    requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
    requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
    requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
    requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
    requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
    requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
    requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace,
    requestedSourceReferenceRefreshRoleNamespace, requestedTerminalDecisionApplyRoleNamespace,
    requestedOfferIncidentApplyRoleNamespace
  );
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "Signal-offer-incident qualification requires the supported cutover role with BYPASSRLS."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    `SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user`
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "Signal-offer-incident qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPostgresSignalTerminalDecisionApplyBoundary(
    database, manifest.schemaName, manifest.readRoleNamespace, manifest.sessionRoleNamespace,
    manifest.queueWriteRoleNamespace, manifest.controlRoleNamespace,
    manifest.notificationRecoveryRoleNamespace, manifest.executionRecoveryRoleNamespace,
    manifest.operationalRetentionRoleNamespace, manifest.observerCandidateRoleNamespace,
    manifest.alertDispatchRoleNamespace, manifest.alertReconciliationRoleNamespace,
    manifest.witnessRefreshRoleNamespace, manifest.leaseRecoveryRoleNamespace,
    manifest.catalogApplyRoleNamespace, manifest.resolutionApplyRoleNamespace,
    manifest.sourceReferenceRefreshRoleNamespace, manifest.terminalDecisionApplyRoleNamespace
  );
  const appliedAt = nowIso(now);
  return database.transaction(async (session) => {
    const guardFunction = "yoink_guard_signal_offer_incident_apply_receipt";
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
        manifest.offerIncidentApplyRole.name,
        manifest.schemaName,
        POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_RECEIPT_TABLE,
        [POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION, guardFunction]
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing object count") !== 0) {
      throw new PostgresSignalOfferIncidentApplyQualificationError(
        "Signal-offer-incident qualification refuses an existing role, function, guard, or receipt."
      );
    }
    await session.query(
      `CREATE ROLE ${identifier(manifest.offerIncidentApplyRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.offerIncidentApplyRole.name)}`
    );
    for (const table of PROTECTED_TENANT_TABLES) {
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} ENABLE ROW LEVEL SECURITY`);
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} FORCE ROW LEVEL SECURITY`);
    }
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION)}(
         expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
         target_message_id TEXT, capability_token TEXT,
         evaluation_timestamp_input TEXT, apply_payload_json TEXT
       ) RETURNS ${FUNCTION_RESULT_TYPE}
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path TO pg_catalog
       AS $yoink$${signalOfferIncidentApplyFunctionSource(manifest)}$yoink$`
    );
    const signature = `${relation(
      manifest.schemaName,
      POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION
    )}(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)`;
    await session.query(`REVOKE ALL PRIVILEGES ON FUNCTION ${signature} FROM PUBLIC`);
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${signature} TO ${identifier(manifest.offerIncidentApplyRole.name)}`
    );
    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_RECEIPT_TABLE)}(
         singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
         contract_version BIGINT NOT NULL CHECK (contract_version = 1),
         cutover_contract_version BIGINT NOT NULL CHECK (cutover_contract_version = 3),
         hosted_delivery_contract_version BIGINT NOT NULL CHECK (hosted_delivery_contract_version = 3),
         catalog_apply_contract_version BIGINT NOT NULL CHECK (catalog_apply_contract_version = 1),
         resolution_apply_contract_version BIGINT NOT NULL CHECK (resolution_apply_contract_version = 1),
         terminal_decision_apply_contract_version BIGINT NOT NULL
           CHECK (terminal_decision_apply_contract_version = 1),
         phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
         role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         terminal_decision_apply_manifest_fingerprint TEXT NOT NULL
           CHECK (terminal_decision_apply_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         offer_incident_apply_role_name TEXT NOT NULL,
         protected_tenant_table_count BIGINT NOT NULL CHECK (protected_tenant_table_count = 14),
         forced_rls_table_count BIGINT NOT NULL CHECK (forced_rls_table_count = 14),
         mutation_table_count BIGINT NOT NULL CHECK (mutation_table_count = 3),
         direct_table_grant_count BIGINT NOT NULL CHECK (direct_table_grant_count = 0),
         function_grant_count BIGINT NOT NULL CHECK (function_grant_count = 1),
         membership_count BIGINT NOT NULL CHECK (membership_count = 0),
         active_principal_count BIGINT NOT NULL CHECK (active_principal_count = 0),
         maximum_plan_age_seconds BIGINT NOT NULL CHECK (maximum_plan_age_seconds = 30),
         server_bound_principal_lookup BOOLEAN NOT NULL CHECK (server_bound_principal_lookup = TRUE),
         database_plan_revalidation BOOLEAN NOT NULL CHECK (database_plan_revalidation = TRUE),
         committed_resolution_binding BOOLEAN NOT NULL CHECK (committed_resolution_binding = TRUE),
         settled_terminal_decision_required BOOLEAN NOT NULL CHECK (settled_terminal_decision_required = TRUE),
         actionable_offer_required BOOLEAN NOT NULL CHECK (actionable_offer_required = TRUE),
         server_derived_semantic_key BOOLEAN NOT NULL CHECK (server_derived_semantic_key = TRUE),
         deterministic_observation_identity BOOLEAN NOT NULL CHECK (deterministic_observation_identity = TRUE),
         message_serialization BOOLEAN NOT NULL CHECK (message_serialization = TRUE),
         semantic_incident_serialization BOOLEAN NOT NULL CHECK (semantic_incident_serialization = TRUE),
         dedupe_window_repository_parity BOOLEAN NOT NULL CHECK (dedupe_window_repository_parity = TRUE),
         idempotent_replay BOOLEAN NOT NULL CHECK (idempotent_replay = TRUE),
         partial_graph_fail_closed BOOLEAN NOT NULL CHECK (partial_graph_fail_closed = TRUE),
         offer_observation_repository_parity BOOLEAN NOT NULL CHECK (offer_observation_repository_parity = TRUE),
         signal_incident_repository_parity BOOLEAN NOT NULL CHECK (signal_incident_repository_parity = TRUE),
         signal_occurrence_repository_parity BOOLEAN NOT NULL CHECK (signal_occurrence_repository_parity = TRUE),
         shared_catalog_mutation BOOLEAN NOT NULL CHECK (shared_catalog_mutation = FALSE),
         source_reference_mutation BOOLEAN NOT NULL CHECK (source_reference_mutation = FALSE),
         terminal_decision_mutation BOOLEAN NOT NULL CHECK (terminal_decision_mutation = FALSE),
         mission_mutation BOOLEAN NOT NULL CHECK (mission_mutation = FALSE),
         action_mutation BOOLEAN NOT NULL CHECK (action_mutation = FALSE),
         offer_incident_graph_mutation BOOLEAN NOT NULL CHECK (offer_incident_graph_mutation = TRUE),
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
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_RECEIPT_TABLE)} FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_RECEIPT_TABLE)}(
         singleton, contract_version, cutover_contract_version,
         hosted_delivery_contract_version, catalog_apply_contract_version,
         resolution_apply_contract_version, terminal_decision_apply_contract_version,
         phase, role_manifest_fingerprint, terminal_decision_apply_manifest_fingerprint,
         offer_incident_apply_role_name, protected_tenant_table_count,
         forced_rls_table_count, mutation_table_count, direct_table_grant_count,
         function_grant_count, membership_count, active_principal_count,
         maximum_plan_age_seconds, server_bound_principal_lookup,
         database_plan_revalidation, committed_resolution_binding,
         settled_terminal_decision_required, actionable_offer_required,
         server_derived_semantic_key, deterministic_observation_identity,
         message_serialization, semantic_incident_serialization,
         dedupe_window_repository_parity, idempotent_replay,
         partial_graph_fail_closed, offer_observation_repository_parity,
         signal_incident_repository_parity, signal_occurrence_repository_parity,
         shared_catalog_mutation, source_reference_mutation,
         terminal_decision_mutation, mission_mutation, action_mutation,
         offer_incident_graph_mutation, remaining_mission_action_graph_mutation,
         inbox_lifecycle_mutation, raw_signal_payload_returned,
         signal_evaluation_apply_repository_parity,
         hosted_delivery_handler_repository_parity, mutation_authority,
         direct_table_access, runtime_authority, production_ready,
         boundary_catalog_fingerprint, applied_at, verified_at
       ) VALUES (
         TRUE, 1, 3, 3, 1, 1, 1, 'loading', $1, $2, $3,
         14, 14, 3, 0, 1, 0, 0, 30,
         TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE,
         TRUE, TRUE, TRUE, TRUE, TRUE,
         FALSE, FALSE, FALSE, FALSE, FALSE,
         TRUE, FALSE, FALSE, FALSE, FALSE, FALSE,
         TRUE, FALSE, FALSE, FALSE, repeat('0', 64), $4, ''
       )`,
      [
        manifest.fingerprint,
        manifest.terminalDecisionApplyManifestFingerprint,
        manifest.offerIncidentApplyRole.name,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = new Date(Date.parse(appliedAt) + 1).toISOString();
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_RECEIPT_TABLE)}
       SET phase = 'verified', boundary_catalog_fingerprint = $1, verified_at = $2
       WHERE singleton = TRUE AND phase = 'loading'`,
      [inspection.boundaryCatalogFingerprint, verifiedAt]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, guardFunction)}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $guard$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal-offer-incident receipt is immutable';
       END
       $guard$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${relation(manifest.schemaName, guardFunction)}() FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_signal_offer_incident_apply_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION ${relation(manifest.schemaName, guardFunction)}()`
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
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      `The PostgreSQL signal-offer-incident ${label} is invalid.`
    );
  }
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...expectedKeys].sort())) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      `The PostgreSQL signal-offer-incident ${label} has an unexpected shape.`
    );
  }
  return record;
}

function parseFunctionJson(value: unknown, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? "")) as unknown;
  } catch {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      `The PostgreSQL signal-offer-incident ${label} is not valid JSON.`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      `The PostgreSQL signal-offer-incident ${label} is invalid.`
    );
  }
  return parsed as Record<string, unknown>;
}

function mutationAction(value: unknown, label: string): MutationAction {
  const action = exactText(value, label, 10) as MutationAction;
  if (!new Set<MutationAction>(["none", "insert", "update"]).has(action)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      `The PostgreSQL signal-offer-incident ${label} is invalid.`
    );
  }
  return action;
}

function parsePlan(
  value: Record<string, unknown>,
  principal: BackgroundWorkerPrincipal,
  messageId: string,
  now: number
): PostgresSignalOfferIncidentApplyPlan {
  const record = exactObject(value, "plan", [
    "contractVersion", "messageId", "payloadHash", "evaluatedAt", "validUntil",
    "eventId", "resolutionDecisionId", "terminalDecisionOutcome",
    "listingId", "variantId", "offerObservationId", "semanticKey",
    "dedupeWindowSeconds", "outcome", "incidentId", "offerObservationAction",
    "incidentAction", "occurrenceAction", "mutationStatementCount",
    "offerIncidentApplyWillApply", "sharedCatalogMutation",
    "sourceReferenceMutation", "terminalDecisionMutation", "missionMutation",
    "actionMutation", "rawSignalPayloadReturned", "planFingerprint"
  ]);
  if (exactInteger(record.contractVersion, "plan contract version") !== 1
    || record.messageId !== messageId
    || record.terminalDecisionOutcome !== "continue_downstream") {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident plan identity is invalid."
    );
  }
  const evaluatedAt = exactTimestamp(record.evaluatedAt, "evaluation timestamp");
  const validUntil = exactTimestamp(record.validUntil, "expiry timestamp");
  if (Math.abs(now - Date.parse(evaluatedAt)) > MAXIMUM_CLOCK_SKEW_MS
    || Date.parse(validUntil) <= Date.now()
    || Date.parse(validUntil) <= Date.parse(evaluatedAt)
    || Date.parse(validUntil) - Date.parse(evaluatedAt) > MAXIMUM_PLAN_AGE_SECONDS * 1_000) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident plan lifetime is invalid."
    );
  }
  const outcome = exactText(record.outcome, "outcome", 30) as OfferIncidentPlanOutcome;
  if (!new Set<OfferIncidentPlanOutcome>(["apply_offer_incident", "already_applied"]).has(outcome)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident plan outcome is invalid."
    );
  }
  const offerObservationAction = mutationAction(
    record.offerObservationAction,
    "offer-observation action"
  );
  const incidentAction = mutationAction(record.incidentAction, "incident action");
  const occurrenceAction = mutationAction(record.occurrenceAction, "occurrence action");
  const mutationStatementCount = exactInteger(
    record.mutationStatementCount,
    "mutation statement count"
  );
  const willApply = outcome === "apply_offer_incident";
  if (willApply
    ? (offerObservationAction !== "insert"
      || !new Set<MutationAction>(["insert", "update"]).has(incidentAction)
      || occurrenceAction !== "insert" || mutationStatementCount !== 3)
    : (offerObservationAction !== "none" || incidentAction !== "none"
      || occurrenceAction !== "none" || mutationStatementCount !== 0)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident mutation plan is inconsistent."
    );
  }
  const plan: PostgresSignalOfferIncidentApplyPlan = {
    contractVersion: 1,
    messageId,
    payloadHash: exactHash(record.payloadHash, "payload hash"),
    evaluatedAt,
    validUntil,
    eventId: exactText(record.eventId, "event ID", 200),
    resolutionDecisionId: exactText(record.resolutionDecisionId, "resolution decision ID", 200),
    terminalDecisionOutcome: "continue_downstream",
    listingId: exactText(record.listingId, "listing ID", 200),
    variantId: exactText(record.variantId, "variant ID", 200),
    offerObservationId: exactText(record.offerObservationId, "offer-observation ID", 200),
    semanticKey: exactHash(record.semanticKey, "semantic key"),
    dedupeWindowSeconds: exactInteger(record.dedupeWindowSeconds, "dedupe window"),
    outcome,
    incidentId: exactText(record.incidentId, "incident ID", 200),
    offerObservationAction,
    incidentAction,
    occurrenceAction,
    mutationStatementCount,
    offerIncidentApplyWillApply: exactBoolean(
      record.offerIncidentApplyWillApply,
      willApply,
      "offer-incident apply flag"
    ),
    sharedCatalogMutation: exactBoolean(
      record.sharedCatalogMutation,
      false,
      "shared-catalog flag"
    ) as false,
    sourceReferenceMutation: exactBoolean(
      record.sourceReferenceMutation,
      false,
      "source-reference flag"
    ) as false,
    terminalDecisionMutation: exactBoolean(
      record.terminalDecisionMutation,
      false,
      "terminal-decision flag"
    ) as false,
    missionMutation: exactBoolean(record.missionMutation, false, "mission flag") as false,
    actionMutation: exactBoolean(record.actionMutation, false, "action flag") as false,
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
    || plan.dedupeWindowSeconds < 30 || plan.dedupeWindowSeconds > 3_600
    || plan.planFingerprint !== postgresSignalOfferIncidentApplyPlanFingerprint(principal, plan)) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident plan fingerprint or identity is invalid."
    );
  }
  return plan;
}

function parseResult(
  value: Record<string, unknown>,
  plan: PostgresSignalOfferIncidentApplyPlan
): PostgresSignalOfferIncidentApplyResult {
  const record = exactObject(value, "apply result", [
    "contractVersion", "messageId", "planFingerprint", "eventId",
    "resolutionDecisionId", "terminalDecisionOutcome", "listingId", "variantId",
    "offerObservationId", "semanticKey", "dedupeWindowSeconds", "outcome",
    "incidentId", "offerObservationAction", "incidentAction", "occurrenceAction",
    "mutationStatementCount", "offerIncidentApplyApplied", "continueDownstream",
    "mutationAuthority", "idempotentReplay", "sharedCatalogMutated",
    "sourceReferencesMutated", "terminalDecisionsMutated", "incidentsMutated",
    "offersMutated", "missionsMutated", "actionsMutated",
    "offerIncidentGraphMutated", "remainingMissionActionGraphMutated",
    "inboxLifecycleMutated", "rawSignalPayloadReturned"
  ]);
  if (exactInteger(record.contractVersion, "result contract version") !== 1
    || record.messageId !== plan.messageId
    || record.planFingerprint !== plan.planFingerprint
    || record.eventId !== plan.eventId
    || record.resolutionDecisionId !== plan.resolutionDecisionId
    || record.terminalDecisionOutcome !== plan.terminalDecisionOutcome
    || record.listingId !== plan.listingId || record.variantId !== plan.variantId
    || record.offerObservationId !== plan.offerObservationId
    || record.semanticKey !== plan.semanticKey
    || exactInteger(record.dedupeWindowSeconds, "result dedupe window")
      !== plan.dedupeWindowSeconds
    || record.outcome !== plan.outcome || record.incidentId !== plan.incidentId
    || record.offerObservationAction !== plan.offerObservationAction
    || record.incidentAction !== plan.incidentAction
    || record.occurrenceAction !== plan.occurrenceAction
    || exactInteger(record.mutationStatementCount, "result mutation statement count")
      !== plan.mutationStatementCount) {
    throw new PostgresSignalOfferIncidentApplyQualificationError(
      "The PostgreSQL signal-offer-incident apply result changed from its sealed plan."
    );
  }
  const mutated = plan.offerIncidentApplyWillApply;
  return {
    contractVersion: 1,
    messageId: plan.messageId,
    planFingerprint: plan.planFingerprint,
    eventId: plan.eventId,
    resolutionDecisionId: plan.resolutionDecisionId,
    terminalDecisionOutcome: "continue_downstream",
    listingId: plan.listingId,
    variantId: plan.variantId,
    offerObservationId: plan.offerObservationId,
    semanticKey: plan.semanticKey,
    dedupeWindowSeconds: plan.dedupeWindowSeconds,
    outcome: plan.outcome,
    incidentId: plan.incidentId,
    offerObservationAction: plan.offerObservationAction,
    incidentAction: plan.incidentAction,
    occurrenceAction: plan.occurrenceAction,
    mutationStatementCount: plan.mutationStatementCount,
    offerIncidentApplyApplied: exactBoolean(
      record.offerIncidentApplyApplied,
      mutated,
      "offer-incident applied flag"
    ),
    continueDownstream: exactBoolean(record.continueDownstream, true, "continue flag") as true,
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
    incidentsMutated: exactBoolean(record.incidentsMutated, mutated, "incident flag"),
    offersMutated: exactBoolean(record.offersMutated, mutated, "offer flag"),
    missionsMutated: exactBoolean(record.missionsMutated, false, "mission flag") as false,
    actionsMutated: exactBoolean(record.actionsMutated, false, "action flag") as false,
    offerIncidentGraphMutated: exactBoolean(
      record.offerIncidentGraphMutated,
      mutated,
      "offer-incident graph flag"
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

export class NodePostgresSignalOfferIncidentApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalOfferIncidentApplyManifest;

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
    options: NodePostgresSignalOfferIncidentApplyDatabaseOptions = {}
  ) {
    this.manifest = buildPostgresSignalOfferIncidentApplyManifest(
      requestedSchema, requestedReadRoleNamespace, requestedSessionRoleNamespace,
      requestedQueueWriteRoleNamespace, requestedControlRoleNamespace,
      requestedNotificationRecoveryRoleNamespace, requestedExecutionRecoveryRoleNamespace,
      requestedOperationalRetentionRoleNamespace, requestedObserverCandidateRoleNamespace,
      requestedAlertDispatchRoleNamespace, requestedAlertReconciliationRoleNamespace,
      requestedWitnessRefreshRoleNamespace, requestedLeaseRecoveryRoleNamespace,
      requestedCatalogApplyRoleNamespace, requestedResolutionApplyRoleNamespace,
      requestedSourceReferenceRefreshRoleNamespace, requestedTerminalDecisionApplyRoleNamespace,
      requestedOfferIncidentApplyRoleNamespace
    );
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalOfferIncidentApplyQualificationError(
        "The PostgreSQL signal-offer-incident connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_offer_incident_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_signal_offer_incident_qualification");
  }

  async applySignalOfferIncident(
    principal: BackgroundWorkerPrincipal,
    messageIdValue: string,
    capabilityTokenValue: string,
    now = Date.now()
  ): Promise<PostgresSignalOfferIncidentApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const messageId = String(messageIdValue ?? "");
    const capabilityToken = String(capabilityTokenValue ?? "");
    if (!MESSAGE_ID.test(messageId) || !CAPABILITY_TOKEN.test(capabilityToken)
      || !Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresSignalOfferIncidentApplyQualificationError(
        "The PostgreSQL signal-offer-incident apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.offerIncidentApplyRole.name)}`);
      const call = async (
        operation: "plan" | "apply",
        evaluatedAt: string,
        payload: Record<string, unknown>
      ): Promise<Record<string, unknown>> => {
        const result = await client.query<FunctionRow>(
          `SELECT result_json AS "resultJson"
           FROM ${relation(this.manifest.schemaName, POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_FUNCTION)}(
             $1, $2, $3, $4, $5, $6, $7
           )`,
          [tenantId, userId, operation, messageId, capabilityToken, evaluatedAt, JSON.stringify(payload)]
        );
        if (result.rows.length !== 1 || !result.rows[0]) {
          throw new PostgresSignalOfferIncidentApplyQualificationError(
            "The PostgreSQL signal-offer-incident function returned an ambiguous result."
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
