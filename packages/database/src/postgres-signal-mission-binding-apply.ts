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
  POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION,
  buildPostgresSignalPostIncidentDecisionApplyManifest,
  verifyPostgresSignalPostIncidentDecisionApplyBoundary,
  type PostgresSignalPostIncidentDecisionApplyManifest
} from "./postgres-signal-post-incident-decision-apply.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_SIGNAL_MISSION_BINDING_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_MISSION_BINDING_APPLY_RECEIPT_TABLE =
  "yoink_signal_mission_binding_apply_receipt";
export const POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION =
  "yoink_apply_trackalacker_signal_mission_binding";

const MAXIMUM_CLOCK_SKEW_MS = 300_000;
const MAXIMUM_PLAN_AGE_SECONDS = 30;
const MAXIMUM_APPLY_PAYLOAD_BYTES = 512;
const MAXIMUM_VARIANT_LISTINGS = 10_000;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MESSAGE_ID = /^inbox_[a-f0-9]{32}$/;
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
  "mission_intent_revisions",
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
  "mission_intent_revisions",
  "mission_targets",
  "missions",
  "outbox_events"
] as const);

type InsertAction = "none" | "insert";
type MissionBindingOutcome = "apply_mission_binding" | "already_bound";

export interface PostgresSignalMissionBindingApplyManifest {
  contractVersion: typeof POSTGRES_SIGNAL_MISSION_BINDING_APPLY_CONTRACT_VERSION;
  cutoverContractVersion: typeof POSTGRES_CUTOVER_CONTRACT_VERSION;
  postIncidentDecisionApplyContractVersion:
    typeof POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_CONTRACT_VERSION;
  schemaName: string;
  missionBindingApplyRoleNamespace: string;
  postIncidentDecisionApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalPostIncidentDecisionApplyManifest;
  missionBindingApplyRole: {
    kind: "signal_mission_binding_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTenantTableCount: 18;
  forcedRlsTableCount: 18;
  mutationTableCount: 5;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  maximumPlanAgeSeconds: 30;
  maximumVariantListings: 10_000;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  settledPostIncidentDecisionRequired: true;
  messageSerialization: true;
  variantMissionSerialization: true;
  existingMissionBinding: true;
  trustedMissionCreation: true;
  exactVariantTargetAttachment: true;
  initialIntentPolicyCreation: true;
  appendOnlyPolicyRevision: true;
  missionQuantityParity: true;
  targetPolicyJsonParity: true;
  purchasePolicyHashParity: true;
  idempotentReplay: true;
  missionBindingRepositoryParity: true;
  missionAuditOutboxRepositoryParity: true;
  initialPolicyAuditOutboxRepositoryParity: true;
  sharedCatalogMutation: false;
  incidentMutation: false;
  terminalDecisionMutation: false;
  actionMutation: false;
  spendMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  mutationAuthority: true;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalMissionBindingApplyQualificationReceipt {
  contractVersion: 1;
  cutoverContractVersion: 3;
  postIncidentDecisionApplyContractVersion: 1;
  phase: "verified";
  schemaName: string;
  roleManifestFingerprint: string;
  postIncidentDecisionApplyManifestFingerprint: string;
  missionBindingApplyRoleName: string;
  protectedTenantTableCount: 18;
  forcedRlsTableCount: 18;
  mutationTableCount: 5;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  membershipCount: 0;
  activePrincipalCount: 0;
  maximumPlanAgeSeconds: 30;
  maximumVariantListings: 10_000;
  serverBoundPrincipalLookup: true;
  databasePlanRevalidation: true;
  settledPostIncidentDecisionRequired: true;
  messageSerialization: true;
  variantMissionSerialization: true;
  existingMissionBinding: true;
  trustedMissionCreation: true;
  exactVariantTargetAttachment: true;
  initialIntentPolicyCreation: true;
  appendOnlyPolicyRevision: true;
  missionQuantityParity: true;
  targetPolicyJsonParity: true;
  purchasePolicyHashParity: true;
  idempotentReplay: true;
  missionBindingRepositoryParity: true;
  missionAuditOutboxRepositoryParity: true;
  initialPolicyAuditOutboxRepositoryParity: true;
  sharedCatalogMutation: false;
  incidentMutation: false;
  terminalDecisionMutation: false;
  actionMutation: false;
  spendMutation: false;
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

export interface PostgresSignalMissionBindingApplyCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  postIncidentDecisionApplyContractVersion: 1;
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
  databasePlanRevalidation: true;
  twoPhasePlanApply: true;
  readCommittedTransactionAdapter: true;
  settledPostIncidentDecisionRequired: true;
  messageSerialization: true;
  variantMissionSerialization: true;
  existingMissionBinding: true;
  trustedMissionCreation: true;
  exactVariantTargetAttachment: true;
  initialIntentPolicyCreation: true;
  appendOnlyPolicyRevision: true;
  missionQuantityParity: true;
  targetPolicyJsonParity: true;
  purchasePolicyHashParity: true;
  idempotentReplay: true;
  missionBindingRepositoryParity: true;
  missionAuditOutboxRepositoryParity: true;
  initialPolicyAuditOutboxRepositoryParity: true;
  sharedCatalogMutation: false;
  incidentMutation: false;
  terminalDecisionMutation: false;
  actionMutation: false;
  spendMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  signalEvaluationApplyRepositoryParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  maximumPlanAgeSeconds: 30;
  maximumVariantListings: 10_000;
  protectedTenantTableCount: 18;
  forcedRlsTableCount: 18;
  mutationTableCount: 5;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalMissionBindingApplyPlan {
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
  postIncidentDecisionOutcome: "continue_downstream";
  outcome: MissionBindingOutcome;
  missionId: string;
  missionTargetId: string;
  policyRevisionId: string;
  missionCreationRequired: boolean;
  targetInsertCount: number;
  initialPolicyRequired: boolean;
  policyQuantity: number;
  variantListingCount: number;
  missionAction: InsertAction;
  missionTargetAction: InsertAction;
  policyRevisionAction: InsertAction;
  missionAuditAction: InsertAction;
  missionOutboxAction: InsertAction;
  policyAuditAction: InsertAction;
  policyOutboxAction: InsertAction;
  mutationStatementCount: number;
  mutationRowCount: number;
  missionBindingApplyWillApply: boolean;
  sharedCatalogMutation: false;
  incidentMutation: false;
  terminalDecisionMutation: false;
  actionMutation: false;
  spendMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  planFingerprint: string;
}

export interface PostgresSignalMissionBindingApplyResult {
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
  postIncidentDecisionOutcome: "continue_downstream";
  outcome: MissionBindingOutcome;
  missionId: string;
  missionTargetId: string;
  policyRevisionId: string;
  missionCreated: boolean;
  targetsInserted: number;
  initialPolicyCreated: boolean;
  policyQuantity: number;
  variantListingCount: number;
  missionAction: InsertAction;
  missionTargetAction: InsertAction;
  policyRevisionAction: InsertAction;
  missionAuditAction: InsertAction;
  missionOutboxAction: InsertAction;
  policyAuditAction: InsertAction;
  policyOutboxAction: InsertAction;
  mutationStatementCount: number;
  mutationRowCount: number;
  missionBindingApplyApplied: boolean;
  continueDownstream: true;
  mutationAuthority: true;
  idempotentReplay: true;
  sharedCatalogMutated: false;
  incidentsMutated: false;
  terminalDecisionsMutated: false;
  missionsMutated: boolean;
  missionTargetsMutated: boolean;
  purchasePoliciesMutated: boolean;
  actionsMutated: false;
  spendMutated: false;
  inboxLifecycleMutated: false;
  rawSignalPayloadReturned: false;
}

export interface NodePostgresSignalMissionBindingApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface BoundaryInspection {
  protectedTenantTableCount: number;
  forcedRlsTableCount: number;
  mutationTableCount: number;
  directTableGrantCount: number;
  functionGrantCount: number;
  membershipCount: number;
  activePrincipalCount: number;
  boundaryCatalogFingerprint: string;
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
  contract_version: unknown;
  cutover_contract_version: unknown;
  post_incident_decision_apply_contract_version: unknown;
  phase: string;
  role_manifest_fingerprint: string;
  post_incident_decision_apply_manifest_fingerprint: string;
  mission_binding_apply_role_name: string;
  protected_tenant_table_count: unknown;
  forced_rls_table_count: unknown;
  mutation_table_count: unknown;
  direct_table_grant_count: unknown;
  function_grant_count: unknown;
  membership_count: unknown;
  active_principal_count: unknown;
  maximum_plan_age_seconds: unknown;
  maximum_variant_listings: unknown;
  boundary_catalog_fingerprint: string;
  applied_at: string;
  verified_at: string;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

interface RoleAuthorityRow extends Record<string, unknown> {
  rolcreaterole: boolean;
  rolsuper: boolean;
}

let cachedCapabilityProjection: Readonly<PostgresSignalMissionBindingApplyCapabilityProjection> | null = null;

export class PostgresSignalMissionBindingApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalMissionBindingApplyQualificationError";
  }
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function relation(schema: string, name: string): string {
  return `${identifier(schema)}.${identifier(name)}`;
}

function safeSchema(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_SCHEMA.test(normalized)) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_signal_mission_binding`;
  if (value.length > 63) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding role name exceeds PostgreSQL's limit."
    );
  }
  return value;
}

function exactInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      `The PostgreSQL signal-mission-binding ${label} is invalid.`
    );
  }
  return normalized;
}

function exactText(value: unknown, label: string, maximum = 500, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || value !== value.trim()
    || (!allowEmpty && value.length === 0) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      `The PostgreSQL signal-mission-binding ${label} is invalid.`
    );
  }
  return value;
}

function exactTimestamp(value: unknown, label: string): string {
  const normalized = exactText(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)
    || Number.isNaN(Date.parse(normalized))) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      `The PostgreSQL signal-mission-binding ${label} is invalid.`
    );
  }
  return normalized;
}

function exactBoolean(value: unknown, expected: boolean, label: string): boolean {
  if (value !== expected) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      `The PostgreSQL signal-mission-binding ${label} is invalid.`
    );
  }
  return expected;
}

function insertAction(value: unknown, label: string): InsertAction {
  if (value !== "none" && value !== "insert") {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      `The PostgreSQL signal-mission-binding ${label} is invalid.`
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function stableHashInputSql(parts: string[]): string {
  return parts.map((part) =>
    `pg_catalog.octet_length(${part})::text || ':' || ${part} || '|'`
  ).join(" || ");
}

function predecessorNamespaces(manifest: PostgresSignalPostIncidentDecisionApplyManifest): string[] {
  return [
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
    manifest.witnessRefreshRoleNamespace,
    manifest.leaseRecoveryRoleNamespace,
    manifest.catalogApplyRoleNamespace,
    manifest.resolutionApplyRoleNamespace,
    manifest.sourceReferenceRefreshRoleNamespace,
    manifest.terminalDecisionApplyRoleNamespace,
    manifest.offerIncidentApplyRoleNamespace,
    manifest.postIncidentDecisionApplyRoleNamespace
  ];
}

export function buildPostgresSignalMissionBindingApplyManifest(
  predecessorManifest = buildPostgresSignalPostIncidentDecisionApplyManifest(),
  requestedMissionBindingApplyRoleNamespace = "yoink_mission_bind_qual"
): PostgresSignalMissionBindingApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const missionBindingApplyRoleNamespace = safeNamespace(
    requestedMissionBindingApplyRoleNamespace
  );
  if (predecessorNamespaces(predecessorManifest).includes(missionBindingApplyRoleNamespace)) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalMissionBindingApplyManifest, "fingerprint"> = {
    contractVersion: POSTGRES_SIGNAL_MISSION_BINDING_APPLY_CONTRACT_VERSION,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    postIncidentDecisionApplyContractVersion:
      POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_CONTRACT_VERSION,
    schemaName,
    missionBindingApplyRoleNamespace,
    postIncidentDecisionApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    missionBindingApplyRole: {
      kind: "signal_mission_binding_apply_boundary",
      name: roleName(missionBindingApplyRoleNamespace),
      functionName: POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTenantTableCount: 18,
    forcedRlsTableCount: 18,
    mutationTableCount: 5,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    maximumPlanAgeSeconds: 30,
    maximumVariantListings: 10_000,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    settledPostIncidentDecisionRequired: true,
    messageSerialization: true,
    variantMissionSerialization: true,
    existingMissionBinding: true,
    trustedMissionCreation: true,
    exactVariantTargetAttachment: true,
    initialIntentPolicyCreation: true,
    appendOnlyPolicyRevision: true,
    missionQuantityParity: true,
    targetPolicyJsonParity: true,
    purchasePolicyHashParity: true,
    idempotentReplay: true,
    missionBindingRepositoryParity: true,
    missionAuditOutboxRepositoryParity: true,
    initialPolicyAuditOutboxRepositoryParity: true,
    sharedCatalogMutation: false,
    incidentMutation: false,
    terminalDecisionMutation: false,
    actionMutation: false,
    spendMutation: false,
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

export function postgresSignalMissionBindingApplyCapabilityProjection():
PostgresSignalMissionBindingApplyCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalMissionBindingApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    postIncidentDecisionApplyContractVersion: 1,
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
    databasePlanRevalidation: true,
    twoPhasePlanApply: true,
    readCommittedTransactionAdapter: true,
    settledPostIncidentDecisionRequired: true,
    messageSerialization: true,
    variantMissionSerialization: true,
    existingMissionBinding: true,
    trustedMissionCreation: true,
    exactVariantTargetAttachment: true,
    initialIntentPolicyCreation: true,
    appendOnlyPolicyRevision: true,
    missionQuantityParity: true,
    targetPolicyJsonParity: true,
    purchasePolicyHashParity: true,
    idempotentReplay: true,
    missionBindingRepositoryParity: true,
    missionAuditOutboxRepositoryParity: true,
    initialPolicyAuditOutboxRepositoryParity: true,
    sharedCatalogMutation: false,
    incidentMutation: false,
    terminalDecisionMutation: false,
    actionMutation: false,
    spendMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    signalEvaluationApplyRepositoryParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    maximumPlanAgeSeconds: 30,
    maximumVariantListings: 10_000,
    protectedTenantTableCount: 18,
    forcedRlsTableCount: 18,
    mutationTableCount: 5,
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

export function postgresSignalMissionBindingApplyPlanFingerprint(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  plan: PostgresSignalMissionBindingApplyPlan
): string {
  return stableHash(
    "postgres_signal_mission_binding_apply_plan_v1",
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
    plan.postIncidentDecisionOutcome,
    plan.outcome,
    plan.missionId,
    plan.missionTargetId,
    plan.policyRevisionId,
    plan.missionCreationRequired ? 1 : 0,
    plan.targetInsertCount,
    plan.initialPolicyRequired ? 1 : 0,
    plan.policyQuantity,
    plan.variantListingCount,
    plan.missionAction,
    plan.missionTargetAction,
    plan.policyRevisionAction,
    plan.missionAuditAction,
    plan.missionOutboxAction,
    plan.policyAuditAction,
    plan.policyOutboxAction,
    plan.mutationStatementCount,
    plan.mutationRowCount,
    plan.missionBindingApplyWillApply ? 1 : 0,
    plan.sharedCatalogMutation ? 1 : 0,
    plan.incidentMutation ? 1 : 0,
    plan.terminalDecisionMutation ? 1 : 0,
    plan.actionMutation ? 1 : 0,
    plan.spendMutation ? 1 : 0,
    plan.inboxLifecycleMutation ? 1 : 0,
    plan.rawSignalPayloadReturned ? 1 : 0
  );
}

export function signalMissionBindingApplyFunctionSource(
  manifest: PostgresSignalMissionBindingApplyManifest
): string {
  const planParts = stableHashInputSql([
    "'postgres_signal_mission_binding_apply_plan_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'1'::text",
    "message_id_value",
    "payload_hash_value",
    "evaluation_timestamp",
    "valid_until_timestamp",
    "event_id_value",
    "resolution_id_value",
    "listing_id_value",
    "variant_id_value",
    "offer_observation_id_value",
    "incident_id_value",
    "semantic_key_value",
    "'continue_downstream'::text",
    "outcome_value",
    "mission_id_value",
    "mission_target_id_value",
    "policy_revision_id_value",
    "CASE WHEN mission_creation_required_value THEN '1' ELSE '0' END",
    "target_insert_count::text",
    "CASE WHEN initial_policy_required_value THEN '1' ELSE '0' END",
    "policy_quantity_value::text",
    "variant_listing_count::text",
    "mission_action_value",
    "mission_target_action_value",
    "policy_revision_action_value",
    "mission_audit_action_value",
    "mission_outbox_action_value",
    "policy_audit_action_value",
    "policy_outbox_action_value",
    "mutation_statement_count::text",
    "mutation_row_count::text",
    "CASE WHEN outcome_value = 'apply_mission_binding' THEN '1' ELSE '0' END",
    "'0'::text",
    "'0'::text",
    "'0'::text",
    "'0'::text",
    "'0'::text",
    "'0'::text",
    "'0'::text"
  ]);
  const policyHashParts = stableHashInputSql([
    "'intent-policy-v2'::text",
    "mission_id_value",
    "policy_quantity_value::text",
    "'USD'::text",
    "''::text",
    "'add_to_cart'::text",
    "'strategy'::text",
    "'120'::text",
    "'exact_only'::text",
    "''::text",
    "'0'::text",
    "target_policy_json_value"
  ]);
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  evaluation_clock TIMESTAMPTZ;
  evaluation_timestamp TEXT;
  valid_until_timestamp TEXT;
  predecessor_plan JSONB;
  predecessor_plan_count BIGINT;
  message_id_value TEXT;
  payload_hash_value TEXT;
  event_id_value TEXT;
  resolution_id_value TEXT;
  listing_id_value TEXT;
  variant_id_value TEXT;
  offer_observation_id_value TEXT;
  incident_id_value TEXT;
  semantic_key_value TEXT;
  projected_mission_id TEXT;
  projected_binding_required BOOLEAN;
  projected_creation_required BOOLEAN;
  event_record RECORD;
  mission_record RECORD;
  target_record RECORD;
  policy_record RECORD;
  listing_record RECORD;
  mission_count BIGINT := 0;
  target_count BIGINT := 0;
  policy_count BIGINT := 0;
  policy_total_count BIGINT := 0;
  variant_listing_count BIGINT := 0;
  non_usd_listing_count BIGINT := 0;
  target_insert_count BIGINT := 0;
  mission_id_value TEXT := '';
  mission_target_id_value TEXT := '';
  policy_revision_id_value TEXT := '';
  mission_creation_required_value BOOLEAN := FALSE;
  initial_policy_required_value BOOLEAN := FALSE;
  policy_quantity_value BIGINT := 1;
  outcome_value TEXT := 'already_bound';
  mission_action_value TEXT := 'none';
  mission_target_action_value TEXT := 'none';
  policy_revision_action_value TEXT := 'none';
  mission_audit_action_value TEXT := 'none';
  mission_outbox_action_value TEXT := 'none';
  policy_audit_action_value TEXT := 'none';
  policy_outbox_action_value TEXT := 'none';
  mutation_statement_count BIGINT := 0;
  mutation_row_count BIGINT := 0;
  partial_policy_audit_count BIGINT := 0;
  partial_policy_outbox_count BIGINT := 0;
  targets_inserted_value BIGINT := 0;
  target_policy_json_value TEXT := '';
  policy_hash_value TEXT := '';
  mission_audit_id_value TEXT := '';
  mission_outbox_id_value TEXT := '';
  policy_audit_id_value TEXT := '';
  policy_outbox_id_value TEXT := '';
  plan_fingerprint_value TEXT;
  plan_value JSONB;
  apply_payload JSONB;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = ''
    OR target_message_id !~ '^inbox_[a-f0-9]{32}$'
    OR capability_token !~ '^[A-Za-z0-9_-]{43}$'
    OR operation_name NOT IN ('plan', 'apply')
    OR pg_catalog.octet_length(apply_payload_json) > ${MAXIMUM_APPLY_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal mission-binding request is invalid';
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
    'yoink_signal_mission_binding_message_v1:' || resolved_tenant_id || ':' ||
      resolved_user_id || ':' || target_message_id,
    0
  ));

  IF operation_name = 'plan' THEN
    IF evaluation_timestamp_input <> '' OR apply_payload_json::jsonb <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal mission-binding plan input is invalid';
    END IF;
    evaluation_clock := pg_catalog.statement_timestamp();
  ELSE
    IF evaluation_timestamp_input !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal mission-binding evaluation timestamp is invalid';
    END IF;
    evaluation_clock := evaluation_timestamp_input::timestamptz;
    IF evaluation_clock > pg_catalog.statement_timestamp()
      OR EXTRACT(EPOCH FROM (pg_catalog.statement_timestamp() - evaluation_clock))
        > ${MAXIMUM_PLAN_AGE_SECONDS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal mission-binding plan expired before apply';
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
    INTO predecessor_plan, predecessor_plan_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION)}(
    expected_tenant_id, expected_user_id, 'plan', target_message_id,
    capability_token, '', '{}'
  ) AS planned;
  IF predecessor_plan_count <> 1 OR predecessor_plan IS NULL
    OR COALESCE(predecessor_plan->>'variantId', '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal mission-binding predecessor discovery failed';
  END IF;
  variant_id_value := predecessor_plan->>'variantId';

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'yoink_signal_mission_binding_variant_v1:' || resolved_tenant_id || ':' ||
      resolved_user_id || ':' || variant_id_value,
    0
  ));

  SELECT MIN(planned.result_json)::jsonb, COUNT(*)
    INTO predecessor_plan, predecessor_plan_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_FUNCTION)}(
    expected_tenant_id, expected_user_id, 'plan', target_message_id,
    capability_token, '', '{}'
  ) AS planned;
  IF predecessor_plan_count <> 1 OR predecessor_plan IS NULL
    OR predecessor_plan->>'messageId' <> target_message_id
    OR predecessor_plan->>'eventId' !~ '^signal_event_[a-f0-9]{32}$'
    OR predecessor_plan->>'resolutionDecisionId' !~ '^resolution_[a-f0-9]{32}$'
    OR predecessor_plan->>'offerObservationId' !~ '^offer_observation_[a-f0-9]{32}$'
    OR predecessor_plan->>'incidentId' !~ '^incident_[a-f0-9]{32}$'
    OR predecessor_plan->>'semanticKey' !~ '^[a-f0-9]{64}$'
    OR predecessor_plan->>'payloadHash' !~ '^[a-f0-9]{64}$'
    OR COALESCE(predecessor_plan->>'listingId', '') = ''
    OR COALESCE(predecessor_plan->>'variantId', '') = ''
    OR predecessor_plan->>'variantId' <> variant_id_value
    OR predecessor_plan->>'outcome' <> 'continue_downstream'
    OR predecessor_plan->>'decisionOutcome' <> ''
    OR predecessor_plan->>'continueDownstream' <> 'true'
    OR predecessor_plan->>'postIncidentDecisionApplyWillApply' <> 'false'
    OR predecessor_plan->>'missionDecisionAction' <> 'none'
    OR predecessor_plan->>'auditAction' <> 'none'
    OR predecessor_plan->>'outboxAction' <> 'none'
    OR predecessor_plan->>'mutationStatementCount' <> '0' THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'post-incident decision must settle before mission binding';
  END IF;

  message_id_value := predecessor_plan->>'messageId';
  payload_hash_value := predecessor_plan->>'payloadHash';
  event_id_value := predecessor_plan->>'eventId';
  resolution_id_value := predecessor_plan->>'resolutionDecisionId';
  listing_id_value := predecessor_plan->>'listingId';
  variant_id_value := predecessor_plan->>'variantId';
  offer_observation_id_value := predecessor_plan->>'offerObservationId';
  incident_id_value := predecessor_plan->>'incidentId';
  semantic_key_value := predecessor_plan->>'semanticKey';
  projected_mission_id := COALESCE(predecessor_plan->>'missionId', '');
  projected_binding_required := (predecessor_plan->>'missionBindingRequired')::boolean;
  projected_creation_required := (predecessor_plan->>'missionCreationRequired')::boolean;
  IF projected_creation_required AND (NOT projected_binding_required OR projected_mission_id <> '')
    OR projected_binding_required AND NOT projected_creation_required AND projected_mission_id = ''
    OR NOT projected_binding_required AND projected_mission_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'post-incident mission projection is inconsistent';
  END IF;

  SELECT event.id, event.source, event.tenant_id, event.user_id
    INTO event_record
  FROM ${relation(manifest.schemaName, "signal_events")} AS event
  WHERE event.id = event_id_value
    AND event.tenant_id = resolved_tenant_id
    AND event.user_id = resolved_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'committed signal event is unavailable for mission binding';
  END IF;

  SELECT COUNT(*) INTO mission_count
  FROM ${relation(manifest.schemaName, "missions")} AS mission
  WHERE mission.tenant_id = resolved_tenant_id
    AND mission.user_id = resolved_user_id
    AND mission.variant_id = variant_id_value;
  IF mission_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'variant mission binding is ambiguous';
  END IF;
  IF mission_count = 1 THEN
    SELECT mission.* INTO mission_record
    FROM ${relation(manifest.schemaName, "missions")} AS mission
    WHERE mission.tenant_id = resolved_tenant_id
      AND mission.user_id = resolved_user_id
      AND mission.variant_id = variant_id_value
    FOR UPDATE;
    mission_id_value := mission_record.id;
    policy_quantity_value := mission_record.target_quantity;
    IF policy_quantity_value < 1 OR policy_quantity_value > 99 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'existing mission quantity is invalid for initial policy binding';
    END IF;
  END IF;

  IF projected_creation_required THEN
    IF mission_count <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'projected mission creation conflicts with current state';
    END IF;
    mission_creation_required_value := TRUE;
  ELSE
    IF mission_count <> 1 OR mission_id_value <> projected_mission_id THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'projected mission binding no longer matches current state';
    END IF;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE listing.currency <> 'USD')
    INTO variant_listing_count, non_usd_listing_count
  FROM ${relation(manifest.schemaName, "listings")} AS listing
  WHERE listing.variant_id = variant_id_value;
  IF variant_listing_count < 1 OR variant_listing_count > ${MAXIMUM_VARIANT_LISTINGS}
    OR non_usd_listing_count <> 0
    OR NOT EXISTS (
      SELECT 1 FROM ${relation(manifest.schemaName, "listings")} AS listing
      WHERE listing.id = listing_id_value AND listing.variant_id = variant_id_value
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'exact variant target set is unavailable or unsupported';
  END IF;

  IF mission_count = 1 THEN
    IF EXISTS (
      SELECT 1
      FROM ${relation(manifest.schemaName, "mission_targets")} AS target
      JOIN ${relation(manifest.schemaName, "listings")} AS listing
        ON listing.id = target.listing_id
      WHERE target.mission_id = mission_id_value
        AND (listing.variant_id <> variant_id_value
          OR target.currency <> listing.currency)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'existing mission target graph is inconsistent with the exact variant';
    END IF;
    SELECT COUNT(*) INTO target_count
    FROM ${relation(manifest.schemaName, "mission_targets")} AS target
    WHERE target.mission_id = mission_id_value AND target.listing_id = listing_id_value;
    IF target_count > 1
      OR (projected_binding_required AND target_count <> 0)
      OR (NOT projected_binding_required AND target_count <> 1) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'projected exact mission target is inconsistent';
    END IF;
    IF target_count = 1 THEN
      SELECT target.* INTO target_record
      FROM ${relation(manifest.schemaName, "mission_targets")} AS target
      WHERE target.mission_id = mission_id_value AND target.listing_id = listing_id_value;
      mission_target_id_value := target_record.id;
    END IF;
    SELECT COUNT(*) INTO target_insert_count
    FROM ${relation(manifest.schemaName, "listings")} AS listing
    WHERE listing.variant_id = variant_id_value
      AND NOT EXISTS (
        SELECT 1 FROM ${relation(manifest.schemaName, "mission_targets")} AS target
        WHERE target.mission_id = mission_id_value AND target.listing_id = listing.id
      );
    SELECT COUNT(*), COUNT(*) FILTER (
      WHERE policy.tenant_id = resolved_tenant_id
        AND policy.user_id = resolved_user_id
    ) INTO policy_total_count, policy_count
    FROM ${relation(manifest.schemaName, "mission_intent_revisions")} AS policy
    WHERE policy.mission_id = mission_id_value;
    IF policy_total_count <> policy_count THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'existing purchase-intent policy scope is inconsistent';
    END IF;
    IF policy_count > 0 THEN
      SELECT policy.id, policy.revision, policy.quantity INTO policy_record
      FROM ${relation(manifest.schemaName, "mission_intent_revisions")} AS policy
      WHERE policy.mission_id = mission_id_value
        AND policy.tenant_id = resolved_tenant_id
        AND policy.user_id = resolved_user_id
      ORDER BY policy.revision DESC LIMIT 1;
      policy_revision_id_value := policy_record.id;
      policy_quantity_value := policy_record.quantity;
      IF policy_quantity_value < 1 OR policy_quantity_value > 99 THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'existing purchase-intent policy quantity is invalid';
      END IF;
    ELSE
      initial_policy_required_value := TRUE;
      SELECT COUNT(*) INTO partial_policy_audit_count
      FROM ${relation(manifest.schemaName, "audit_events")} AS audit
      WHERE audit.tenant_id = resolved_tenant_id
        AND audit.user_id = resolved_user_id
        AND audit.correlation_id = mission_id_value
        AND audit.event_type = 'purchase_intent_policy_revised';
      SELECT COUNT(*) INTO partial_policy_outbox_count
      FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
      WHERE outbox.tenant_id = resolved_tenant_id
        AND outbox.aggregate_type = 'purchase_intent'
        AND outbox.aggregate_id = mission_id_value
        AND outbox.event_type = 'purchase_intent_policy_revised';
      IF partial_policy_audit_count <> 0 OR partial_policy_outbox_count <> 0 THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'partial initial purchase-intent policy graph is inconsistent';
      END IF;
    END IF;
  ELSE
    target_insert_count := variant_listing_count;
    initial_policy_required_value := TRUE;
  END IF;

  IF mission_creation_required_value THEN
    mission_action_value := 'insert';
    mission_audit_action_value := 'insert';
    mission_outbox_action_value := 'insert';
  END IF;
  IF target_insert_count > 0 THEN
    mission_target_action_value := 'insert';
  END IF;
  IF initial_policy_required_value THEN
    policy_revision_action_value := 'insert';
    policy_audit_action_value := 'insert';
    policy_outbox_action_value := 'insert';
  END IF;
  mutation_statement_count :=
      CASE WHEN mission_action_value = 'insert' THEN 1 ELSE 0 END
    + target_insert_count
    + CASE WHEN policy_revision_action_value = 'insert' THEN 1 ELSE 0 END
    + CASE WHEN mission_audit_action_value = 'insert' THEN 1 ELSE 0 END
    + CASE WHEN mission_outbox_action_value = 'insert' THEN 1 ELSE 0 END
    + CASE WHEN policy_audit_action_value = 'insert' THEN 1 ELSE 0 END
    + CASE WHEN policy_outbox_action_value = 'insert' THEN 1 ELSE 0 END;
  mutation_row_count := mutation_statement_count;
  IF mutation_statement_count > 0 THEN
    outcome_value := 'apply_mission_binding';
  END IF;

  plan_fingerprint_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${planParts}, 'UTF8')), 'hex'
  );
  plan_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_id_value,
    'payloadHash', payload_hash_value,
    'evaluatedAt', evaluation_timestamp,
    'validUntil', valid_until_timestamp,
    'eventId', event_id_value,
    'resolutionDecisionId', resolution_id_value,
    'listingId', listing_id_value,
    'variantId', variant_id_value,
    'offerObservationId', offer_observation_id_value,
    'incidentId', incident_id_value,
    'semanticKey', semantic_key_value,
    'postIncidentDecisionOutcome', 'continue_downstream',
    'outcome', outcome_value,
    'missionId', mission_id_value,
    'missionTargetId', mission_target_id_value,
    'policyRevisionId', policy_revision_id_value,
    'missionCreationRequired', mission_creation_required_value,
    'targetInsertCount', target_insert_count,
    'initialPolicyRequired', initial_policy_required_value,
    'policyQuantity', policy_quantity_value,
    'variantListingCount', variant_listing_count,
    'missionAction', mission_action_value,
    'missionTargetAction', mission_target_action_value,
    'policyRevisionAction', policy_revision_action_value,
    'missionAuditAction', mission_audit_action_value,
    'missionOutboxAction', mission_outbox_action_value,
    'policyAuditAction', policy_audit_action_value,
    'policyOutboxAction', policy_outbox_action_value,
    'mutationStatementCount', mutation_statement_count,
    'mutationRowCount', mutation_row_count,
    'missionBindingApplyWillApply', outcome_value = 'apply_mission_binding',
    'sharedCatalogMutation', FALSE,
    'incidentMutation', FALSE,
    'terminalDecisionMutation', FALSE,
    'actionMutation', FALSE,
    'spendMutation', FALSE,
    'inboxLifecycleMutation', FALSE,
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal mission-binding apply payload does not match its current plan';
  END IF;

  IF mission_action_value = 'insert' THEN
    mission_id_value := 'mission_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    INSERT INTO ${relation(manifest.schemaName, "missions")}(
      id, tenant_id, user_id, variant_id, status, origin,
      target_quantity, fulfilled_quantity, created_at, updated_at
    ) VALUES (
      mission_id_value, resolved_tenant_id, resolved_user_id, variant_id_value,
      'active', pg_catalog.left('signal:' || event_record.source, 60),
      1, 0, evaluation_timestamp, evaluation_timestamp
    );
  END IF;

  IF mission_target_action_value = 'insert' THEN
    FOR listing_record IN
      SELECT listing.id, listing.currency
      FROM ${relation(manifest.schemaName, "listings")} AS listing
      WHERE listing.variant_id = variant_id_value
        AND NOT EXISTS (
          SELECT 1 FROM ${relation(manifest.schemaName, "mission_targets")} AS target
          WHERE target.mission_id = mission_id_value AND target.listing_id = listing.id
        )
      ORDER BY listing.id
    LOOP
      INSERT INTO ${relation(manifest.schemaName, "mission_targets")}(
        id, mission_id, listing_id, enabled, max_unit_price_cents,
        currency, seller_policy, fulfillment, created_at, updated_at
      ) VALUES (
        'mission_target_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
        mission_id_value, listing_record.id, 1, NULL, listing_record.currency,
        'inherit', 'inherit', evaluation_timestamp, evaluation_timestamp
      );
      targets_inserted_value := targets_inserted_value + 1;
    END LOOP;
    IF targets_inserted_value <> target_insert_count THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'exact mission target insertion count changed during apply';
    END IF;
  END IF;

  SELECT target.id INTO mission_target_id_value
  FROM ${relation(manifest.schemaName, "mission_targets")} AS target
  WHERE target.mission_id = mission_id_value AND target.listing_id = listing_id_value;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'exact signal mission target was not bound';
  END IF;

  IF policy_revision_action_value = 'insert' THEN
    SELECT COALESCE(
      '[' || pg_catalog.string_agg(
        '{"targetId":' || pg_catalog.to_json(target.id)::text ||
        ',"listingId":' || pg_catalog.to_json(target.listing_id)::text ||
        ',"retailerId":' || pg_catalog.to_json(listing.retailer_id)::text ||
        ',"enabled":' || pg_catalog.to_json(target.enabled = 1)::text ||
        ',"maxUnitPriceCents":' || COALESCE(
          pg_catalog.to_json(target.max_unit_price_cents)::text,
          'null'
        ) ||
        ',"sellerPolicy":' || pg_catalog.to_json(target.seller_policy)::text ||
        ',"fulfillment":' || pg_catalog.to_json(target.fulfillment)::text || '}',
        ',' ORDER BY target.id
      ) || ']',
      '[]'
    )
      INTO target_policy_json_value
    FROM ${relation(manifest.schemaName, "mission_targets")} AS target
    JOIN ${relation(manifest.schemaName, "listings")} AS listing ON listing.id = target.listing_id
    WHERE target.mission_id = mission_id_value;
    policy_hash_value := pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(${policyHashParts}, 'UTF8')), 'hex'
    );
    policy_revision_id_value :=
      'intent_revision_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    INSERT INTO ${relation(manifest.schemaName, "mission_intent_revisions")}(
      id, tenant_id, user_id, mission_id, revision, quantity, currency,
      max_all_in_cents, action_ceiling, substitution_policy, expires_at,
      cooldown_seconds, target_policy_json, policy_hash, change_reason,
      decision_mode, max_signal_age_seconds, created_by_actor_id, created_at
    ) VALUES (
      policy_revision_id_value, resolved_tenant_id, resolved_user_id,
      mission_id_value, 1, policy_quantity_value, 'USD', NULL, 'add_to_cart', 'exact_only', '',
      0, target_policy_json_value, policy_hash_value,
      'Initial exact purchase policy.', 'strategy', 120,
      session_user::text, evaluation_timestamp
    );
  END IF;

  IF mission_audit_action_value = 'insert' THEN
    mission_audit_id_value := 'audit_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    mission_outbox_id_value := 'outbox_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
      id, tenant_id, user_id, correlation_id, event_type,
      reason_code, message, data_json, created_at
    ) VALUES (
      mission_audit_id_value, resolved_tenant_id, resolved_user_id, mission_id_value,
      'mission_created', pg_catalog.left('signal:' || event_record.source, 60),
      'A mission was created for an exact product variant and all known retailer targets were attached.',
      pg_catalog.jsonb_build_object(
        'variantId', variant_id_value,
        'initialListingId', listing_id_value,
        'targetCount', variant_listing_count,
        'enabledTargetCount', variant_listing_count,
        'creationMode', 'strategy_or_internal'
      )::text,
      evaluation_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
      id, tenant_id, aggregate_type, aggregate_id, event_type,
      payload_json, created_at, delivered_at
    ) VALUES (
      mission_outbox_id_value, resolved_tenant_id, 'mission', mission_id_value,
      'mission_created',
      pg_catalog.jsonb_build_object(
        'auditId', mission_audit_id_value,
        'correlationId', mission_id_value,
        'reasonCode', pg_catalog.left('signal:' || event_record.source, 60),
        'message', 'A mission was created for an exact product variant and all known retailer targets were attached.',
        'data', pg_catalog.jsonb_build_object(
          'variantId', variant_id_value,
          'initialListingId', listing_id_value,
          'targetCount', variant_listing_count,
          'enabledTargetCount', variant_listing_count,
          'creationMode', 'strategy_or_internal'
        )
      )::text,
      evaluation_timestamp, ''
    );
  END IF;

  IF policy_audit_action_value = 'insert' THEN
    policy_audit_id_value := 'audit_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    policy_outbox_id_value := 'outbox_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
      id, tenant_id, user_id, correlation_id, event_type,
      reason_code, message, data_json, created_at
    ) VALUES (
      policy_audit_id_value, resolved_tenant_id, resolved_user_id, mission_id_value,
      'purchase_intent_policy_revised', 'initial_policy',
      'Purchase intent policy revision 1 was recorded append-only.',
      pg_catalog.jsonb_build_object(
        'missionId', mission_id_value,
        'revision', 1,
        'actionCeiling', 'add_to_cart',
        'decisionMode', 'strategy',
        'maxSignalAgeSeconds', 120,
        'substitutionPolicy', 'exact_only',
        'targetCount', variant_listing_count
      )::text,
      evaluation_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
      id, tenant_id, aggregate_type, aggregate_id, event_type,
      payload_json, created_at, delivered_at
    ) VALUES (
      policy_outbox_id_value, resolved_tenant_id, 'purchase_intent', mission_id_value,
      'purchase_intent_policy_revised',
      pg_catalog.jsonb_build_object(
        'auditId', policy_audit_id_value,
        'correlationId', mission_id_value,
        'reasonCode', 'initial_policy',
        'message', 'Purchase intent policy revision 1 was recorded append-only.',
        'data', pg_catalog.jsonb_build_object(
          'missionId', mission_id_value,
          'revision', 1,
          'actionCeiling', 'add_to_cart',
          'decisionMode', 'strategy',
          'maxSignalAgeSeconds', 120,
          'substitutionPolicy', 'exact_only',
          'targetCount', variant_listing_count
        )
      )::text,
      evaluation_timestamp, ''
    );
  END IF;

  IF policy_revision_action_value = 'none' THEN
    policy_revision_id_value := policy_record.id;
  END IF;

  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_id_value,
    'planFingerprint', plan_fingerprint_value,
    'eventId', event_id_value,
    'resolutionDecisionId', resolution_id_value,
    'listingId', listing_id_value,
    'variantId', variant_id_value,
    'offerObservationId', offer_observation_id_value,
    'incidentId', incident_id_value,
    'semanticKey', semantic_key_value,
    'postIncidentDecisionOutcome', 'continue_downstream',
    'outcome', outcome_value,
    'missionId', mission_id_value,
    'missionTargetId', mission_target_id_value,
    'policyRevisionId', policy_revision_id_value,
    'missionCreated', mission_action_value = 'insert',
    'targetsInserted', targets_inserted_value,
    'initialPolicyCreated', policy_revision_action_value = 'insert',
    'policyQuantity', policy_quantity_value,
    'variantListingCount', variant_listing_count,
    'missionAction', mission_action_value,
    'missionTargetAction', mission_target_action_value,
    'policyRevisionAction', policy_revision_action_value,
    'missionAuditAction', mission_audit_action_value,
    'missionOutboxAction', mission_outbox_action_value,
    'policyAuditAction', policy_audit_action_value,
    'policyOutboxAction', policy_outbox_action_value,
    'mutationStatementCount', mutation_statement_count,
    'mutationRowCount', mutation_row_count,
    'missionBindingApplyApplied', outcome_value = 'apply_mission_binding',
    'continueDownstream', TRUE,
    'mutationAuthority', TRUE,
    'idempotentReplay', TRUE,
    'sharedCatalogMutated', FALSE,
    'incidentsMutated', FALSE,
    'terminalDecisionsMutated', FALSE,
    'missionsMutated', mission_action_value = 'insert',
    'missionTargetsMutated', mission_target_action_value = 'insert',
    'purchasePoliciesMutated', policy_revision_action_value = 'insert',
    'actionsMutated', FALSE,
    'spendMutated', FALSE,
    'inboxLifecycleMutated', FALSE,
    'rawSignalPayloadReturned', FALSE
  )::text;
END
`;
}

async function verifyPredecessor(
  database: PostgresCutoverDatabase,
  predecessor: PostgresSignalPostIncidentDecisionApplyManifest
): Promise<void> {
  const verified = await verifyPostgresSignalPostIncidentDecisionApplyBoundary(
    database,
    predecessor.schemaName,
    predecessor.readRoleNamespace,
    predecessor.sessionRoleNamespace,
    predecessor.queueWriteRoleNamespace,
    predecessor.controlRoleNamespace,
    predecessor.notificationRecoveryRoleNamespace,
    predecessor.executionRecoveryRoleNamespace,
    predecessor.operationalRetentionRoleNamespace,
    predecessor.observerCandidateRoleNamespace,
    predecessor.alertDispatchRoleNamespace,
    predecessor.alertReconciliationRoleNamespace,
    predecessor.witnessRefreshRoleNamespace,
    predecessor.leaseRecoveryRoleNamespace,
    predecessor.catalogApplyRoleNamespace,
    predecessor.resolutionApplyRoleNamespace,
    predecessor.sourceReferenceRefreshRoleNamespace,
    predecessor.terminalDecisionApplyRoleNamespace,
    predecessor.offerIncidentApplyRoleNamespace,
    predecessor.postIncidentDecisionApplyRoleNamespace
  );
  if (verified.roleManifestFingerprint !== predecessor.fingerprint) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding predecessor receipt is inconsistent."
    );
  }
}

async function inspectBoundary(
  session: PostgresQuerySession,
  manifest: PostgresSignalMissionBindingApplyManifest
): Promise<BoundaryInspection> {
  const role = manifest.missionBindingApplyRole.name;
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
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding role attributes are unsafe."
    );
  }

  const memberships = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_auth_members membership
     JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
     WHERE member_role.rolname = $1`,
    [role]
  );
  if (exactInteger(memberships.rows[0]?.count, "membership count") !== 0) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding role must not inherit another role."
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
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding role has a direct table or column grant."
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
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding role has an unauthorized effective table privilege."
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
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding role has an unauthorized effective column privilege."
    );
  }

  const schemaPrivileges = await session.query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
            has_schema_privilege($1, $2, 'CREATE') AS create`,
    [role, manifest.schemaName]
  );
  if (schemaPrivileges.rows[0]?.usage !== true || schemaPrivileges.rows[0]?.create !== false) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding role has an invalid schema privilege."
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
    || routine.routineName !== POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION
    || routine.argumentTypes !== FUNCTION_ARGUMENT_TYPES.join(", ")
    || routine.resultType !== FUNCTION_RESULT_TYPE
    || routine.volatility !== "v" || routine.securityDefiner !== true
    || routine.strict !== true || routine.leakproof !== false
    || JSON.stringify(routine.configuration) !== JSON.stringify(["search_path=pg_catalog"])
    || routine.ownerName === role
    || routine.source !== signalMissionBindingApplyFunctionSource(manifest)) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding function boundary is incomplete."
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
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding function grant is not exact."
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
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding protected table set is incomplete."
    );
  }
  const mutationTables = protectedTables.rows.filter((row) =>
    (MUTATION_TABLES as readonly string[]).includes(row.tableName)
  );
  if (mutationTables.map((row) => row.tableName).join(",")
    !== [...MUTATION_TABLES].sort().join(",")) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding mutation table set is incomplete."
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
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding role must not access application sequences."
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
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding role must not own application objects."
    );
  }
  const policies = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count FROM pg_catalog.pg_policies
     WHERE schemaname = $1 AND $2 = ANY(roles::text[])`,
    [manifest.schemaName, role]
  );
  if (exactInteger(policies.rows[0]?.count, "policy count") !== 0) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding role must not depend on a direct table policy."
    );
  }
  const principals = await session.query<{ count: string | number | bigint }>(
    `SELECT COUNT(*) AS count
     FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)}
     WHERE active = TRUE`
  );
  const activePrincipalCount = exactInteger(
    principals.rows[0]?.count,
    "active principal count"
  );
  if (activePrincipalCount !== 0) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "Signal mission-binding qualification cannot activate a runtime principal."
    );
  }
  return {
    protectedTenantTableCount: protectedTables.rows.length,
    forcedRlsTableCount: protectedTables.rows.filter((row) => row.forced).length,
    mutationTableCount: mutationTables.length,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount,
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
  manifest: PostgresSignalMissionBindingApplyManifest
): PostgresSignalMissionBindingApplyQualificationReceipt {
  const expectedCounts = [
    [row.contract_version, 1, "contract version"],
    [row.cutover_contract_version, 3, "cutover contract version"],
    [row.post_incident_decision_apply_contract_version, 1, "predecessor contract version"],
    [row.protected_tenant_table_count, 18, "protected table count"],
    [row.forced_rls_table_count, 18, "forced RLS table count"],
    [row.mutation_table_count, 5, "mutation table count"],
    [row.direct_table_grant_count, 0, "direct grant count"],
    [row.function_grant_count, 1, "function grant count"],
    [row.membership_count, 0, "membership count"],
    [row.active_principal_count, 0, "active principal count"],
    [row.maximum_plan_age_seconds, 30, "maximum plan age"],
    [row.maximum_variant_listings, 10_000, "maximum variant listings"]
  ] as const;
  for (const [value, expected, label] of expectedCounts) {
    if (exactInteger(value, label) !== expected) {
      throw new PostgresSignalMissionBindingApplyQualificationError(
        "The PostgreSQL signal-mission-binding receipt uses an unsupported contract."
      );
    }
  }
  if (row.phase !== "verified"
    || row.role_manifest_fingerprint !== manifest.fingerprint
    || row.post_incident_decision_apply_manifest_fingerprint
      !== manifest.postIncidentDecisionApplyManifestFingerprint
    || row.mission_binding_apply_role_name !== manifest.missionBindingApplyRole.name
    || !SHA256.test(row.boundary_catalog_fingerprint)) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding receipt is incomplete or unsafe."
    );
  }
  return {
    contractVersion: 1,
    cutoverContractVersion: 3,
    postIncidentDecisionApplyContractVersion: 1,
    phase: "verified",
    schemaName: manifest.schemaName,
    roleManifestFingerprint: manifest.fingerprint,
    postIncidentDecisionApplyManifestFingerprint:
      manifest.postIncidentDecisionApplyManifestFingerprint,
    missionBindingApplyRoleName: manifest.missionBindingApplyRole.name,
    protectedTenantTableCount: 18,
    forcedRlsTableCount: 18,
    mutationTableCount: 5,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    membershipCount: 0,
    activePrincipalCount: 0,
    maximumPlanAgeSeconds: 30,
    maximumVariantListings: 10_000,
    serverBoundPrincipalLookup: true,
    databasePlanRevalidation: true,
    settledPostIncidentDecisionRequired: true,
    messageSerialization: true,
    variantMissionSerialization: true,
    existingMissionBinding: true,
    trustedMissionCreation: true,
    exactVariantTargetAttachment: true,
    initialIntentPolicyCreation: true,
    appendOnlyPolicyRevision: true,
    missionQuantityParity: true,
    targetPolicyJsonParity: true,
    purchasePolicyHashParity: true,
    idempotentReplay: true,
    missionBindingRepositoryParity: true,
    missionAuditOutboxRepositoryParity: true,
    initialPolicyAuditOutboxRepositoryParity: true,
    sharedCatalogMutation: false,
    incidentMutation: false,
    terminalDecisionMutation: false,
    actionMutation: false,
    spendMutation: false,
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
  manifest: PostgresSignalMissionBindingApplyManifest
): Promise<PostgresSignalMissionBindingApplyQualificationReceipt> {
  const result = await session.query<ReceiptRow>(
    `SELECT * FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_MISSION_BINDING_APPLY_RECEIPT_TABLE)}
     WHERE id = 'active'`
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding receipt is missing or ambiguous."
    );
  }
  return receiptFromRow(result.rows[0], manifest);
}

function assertInspectionMatchesReceipt(
  inspection: BoundaryInspection,
  receipt: PostgresSignalMissionBindingApplyQualificationReceipt,
  manifest: PostgresSignalMissionBindingApplyManifest
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
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding boundary no longer matches its verified receipt."
    );
  }
}

export async function verifyPostgresSignalMissionBindingApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalMissionBindingApplyManifest()
): Promise<PostgresSignalMissionBindingApplyQualificationReceipt> {
  await verifyPredecessor(database, manifest.predecessorManifest);
  return database.transaction(async (session) => {
    const receipt = await readReceipt(session, manifest);
    const inspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(inspection, receipt, manifest);
    return receipt;
  });
}

export async function applyPostgresSignalMissionBindingApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalMissionBindingApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalMissionBindingApplyQualificationReceipt> {
  if (!Number.isSafeInteger(now)) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding qualification timestamp is invalid."
    );
  }
  const preflight = await inspectPostgresCutoverPreflight(database);
  if (!preflight.serverVersionSupported || !preflight.cutoverRoleBypassesRls) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "Signal mission-binding qualification requires the supported cutover role with BYPASSRLS."
    );
  }
  const authority = await database.query<RoleAuthorityRow>(
    "SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user"
  );
  if (!authority.rows[0] || !(authority.rows[0].rolsuper || authority.rows[0].rolcreaterole)) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "Signal mission-binding qualification requires temporary CREATEROLE authority."
    );
  }
  await verifyPredecessor(database, manifest.predecessorManifest);
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
        manifest.missionBindingApplyRole.name,
        manifest.schemaName,
        POSTGRES_SIGNAL_MISSION_BINDING_APPLY_RECEIPT_TABLE,
        [
          POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION,
          "yoink_guard_signal_mission_binding_apply_receipt"
        ]
      ]
    );
    if (exactInteger(existing.rows[0]?.count, "existing object count") !== 0) {
      throw new PostgresSignalMissionBindingApplyQualificationError(
        "Signal mission-binding qualification refuses an existing role, function, guard, or receipt."
      );
    }
    await session.query(
      `CREATE ROLE ${identifier(manifest.missionBindingApplyRole.name)}
       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS`
    );
    await session.query(
      `GRANT USAGE ON SCHEMA ${identifier(manifest.schemaName)}
       TO ${identifier(manifest.missionBindingApplyRole.name)}`
    );
    for (const table of PROTECTED_TENANT_TABLES) {
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} ENABLE ROW LEVEL SECURITY`);
      await session.query(`ALTER TABLE ${relation(manifest.schemaName, table)} FORCE ROW LEVEL SECURITY`);
    }
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION)}(
         expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
         target_message_id TEXT, capability_token TEXT,
         evaluation_timestamp_input TEXT, apply_payload_json TEXT
       ) RETURNS TABLE(result_json TEXT)
       LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
       SET search_path TO pg_catalog
       AS $yoink$${signalMissionBindingApplyFunctionSource(manifest)}$yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${relation(
        manifest.schemaName,
        POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION
      )}(${FUNCTION_ARGUMENT_TYPES.join(", ")}) FROM PUBLIC`
    );
    await session.query(
      `GRANT EXECUTE ON FUNCTION ${relation(
        manifest.schemaName,
        POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION
      )}(${FUNCTION_ARGUMENT_TYPES.join(", ")})
       TO ${identifier(manifest.missionBindingApplyRole.name)}`
    );
    await session.query(
      `CREATE TABLE ${relation(manifest.schemaName, POSTGRES_SIGNAL_MISSION_BINDING_APPLY_RECEIPT_TABLE)}(
         id TEXT PRIMARY KEY CHECK (id = 'active'),
         contract_version INTEGER NOT NULL,
         cutover_contract_version INTEGER NOT NULL,
         post_incident_decision_apply_contract_version INTEGER NOT NULL,
         phase TEXT NOT NULL CHECK (phase IN ('loading', 'verified')),
         role_manifest_fingerprint TEXT NOT NULL CHECK (role_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         post_incident_decision_apply_manifest_fingerprint TEXT NOT NULL
           CHECK (post_incident_decision_apply_manifest_fingerprint ~ '^[a-f0-9]{64}$'),
         mission_binding_apply_role_name TEXT NOT NULL,
         protected_tenant_table_count INTEGER NOT NULL,
         forced_rls_table_count INTEGER NOT NULL,
         mutation_table_count INTEGER NOT NULL,
         direct_table_grant_count INTEGER NOT NULL,
         function_grant_count INTEGER NOT NULL,
         membership_count INTEGER NOT NULL,
         active_principal_count INTEGER NOT NULL,
         maximum_plan_age_seconds INTEGER NOT NULL,
         maximum_variant_listings INTEGER NOT NULL,
         boundary_catalog_fingerprint TEXT NOT NULL
           CHECK (boundary_catalog_fingerprint ~ '^[a-f0-9]{64}$'),
         applied_at TEXT NOT NULL,
         verified_at TEXT NOT NULL DEFAULT ''
       )`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_MISSION_BINDING_APPLY_RECEIPT_TABLE)}
       FROM PUBLIC`
    );
    await session.query(
      `INSERT INTO ${relation(manifest.schemaName, POSTGRES_SIGNAL_MISSION_BINDING_APPLY_RECEIPT_TABLE)}(
         id, contract_version, cutover_contract_version,
         post_incident_decision_apply_contract_version, phase,
         role_manifest_fingerprint, post_incident_decision_apply_manifest_fingerprint,
         mission_binding_apply_role_name, protected_tenant_table_count,
         forced_rls_table_count, mutation_table_count, direct_table_grant_count,
         function_grant_count, membership_count, active_principal_count,
         maximum_plan_age_seconds, maximum_variant_listings,
         boundary_catalog_fingerprint, applied_at
       ) VALUES ('active', 1, 3, 1, 'loading', $1, $2, $3,
                 0, 0, 0, 0, 0, 0, 0, 30, 10000, repeat('0', 64), $4)`,
      [
        manifest.fingerprint,
        manifest.postIncidentDecisionApplyManifestFingerprint,
        manifest.missionBindingApplyRole.name,
        appliedAt
      ]
    );
    const inspection = await inspectBoundary(session, manifest);
    const verifiedAt = nowIso(now + 1);
    await session.query(
      `UPDATE ${relation(manifest.schemaName, POSTGRES_SIGNAL_MISSION_BINDING_APPLY_RECEIPT_TABLE)}
       SET phase = 'verified', protected_tenant_table_count = $1,
           forced_rls_table_count = $2, mutation_table_count = $3,
           direct_table_grant_count = $4, function_grant_count = $5,
           membership_count = $6, active_principal_count = $7,
           boundary_catalog_fingerprint = $8, verified_at = $9
       WHERE id = 'active' AND phase = 'loading'`,
      [
        inspection.protectedTenantTableCount,
        inspection.forcedRlsTableCount,
        inspection.mutationTableCount,
        inspection.directTableGrantCount,
        inspection.functionGrantCount,
        inspection.membershipCount,
        inspection.activePrincipalCount,
        inspection.boundaryCatalogFingerprint,
        verifiedAt
      ]
    );
    await session.query(
      `CREATE FUNCTION ${relation(manifest.schemaName, "yoink_guard_signal_mission_binding_apply_receipt")}()
       RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $yoink$
       BEGIN
         RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal-mission-binding receipt is immutable';
       END
       $yoink$`
    );
    await session.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_signal_mission_binding_apply_receipt")}()
       FROM PUBLIC`
    );
    await session.query(
      `CREATE TRIGGER ${identifier("yoink_signal_mission_binding_apply_receipt_immutable")}
       BEFORE UPDATE OR DELETE ON
       ${relation(manifest.schemaName, POSTGRES_SIGNAL_MISSION_BINDING_APPLY_RECEIPT_TABLE)}
       FOR EACH ROW EXECUTE FUNCTION
       ${relation(manifest.schemaName, "yoink_guard_signal_mission_binding_apply_receipt")}()`
    );
    const receipt = await readReceipt(session, manifest);
    const finalInspection = await inspectBoundary(session, manifest);
    assertInspectionMatchesReceipt(finalInspection, receipt, manifest);
    return receipt;
  });
}

function exactObject(value: unknown, label: string, expectedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      `The PostgreSQL signal-mission-binding ${label} is invalid.`
    );
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== [...expectedKeys].sort().join(",")) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      `The PostgreSQL signal-mission-binding ${label} has an unexpected shape.`
    );
  }
  return record;
}

function parseFunctionJson(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "string" || value.length > 64_000) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      `The PostgreSQL signal-mission-binding ${label} is invalid.`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      `The PostgreSQL signal-mission-binding ${label} is not valid JSON.`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      `The PostgreSQL signal-mission-binding ${label} is invalid.`
    );
  }
  return parsed as Record<string, unknown>;
}

const PLAN_KEYS = Object.freeze([
  "contractVersion", "messageId", "payloadHash", "evaluatedAt", "validUntil",
  "eventId", "resolutionDecisionId", "listingId", "variantId",
  "offerObservationId", "incidentId", "semanticKey",
  "postIncidentDecisionOutcome", "outcome", "missionId", "missionTargetId",
  "policyRevisionId", "missionCreationRequired", "targetInsertCount",
  "initialPolicyRequired", "policyQuantity", "variantListingCount", "missionAction",
  "missionTargetAction", "policyRevisionAction", "missionAuditAction",
  "missionOutboxAction", "policyAuditAction", "policyOutboxAction",
  "mutationStatementCount", "mutationRowCount", "missionBindingApplyWillApply",
  "sharedCatalogMutation", "incidentMutation", "terminalDecisionMutation",
  "actionMutation", "spendMutation", "inboxLifecycleMutation",
  "rawSignalPayloadReturned", "planFingerprint"
] as const);

const RESULT_KEYS = Object.freeze([
  "contractVersion", "messageId", "planFingerprint", "eventId",
  "resolutionDecisionId", "listingId", "variantId", "offerObservationId",
  "incidentId", "semanticKey", "postIncidentDecisionOutcome", "outcome",
  "missionId", "missionTargetId", "policyRevisionId", "missionCreated",
  "targetsInserted", "initialPolicyCreated", "policyQuantity", "variantListingCount",
  "missionAction", "missionTargetAction", "policyRevisionAction",
  "missionAuditAction", "missionOutboxAction", "policyAuditAction",
  "policyOutboxAction", "mutationStatementCount", "mutationRowCount",
  "missionBindingApplyApplied", "continueDownstream", "mutationAuthority",
  "idempotentReplay", "sharedCatalogMutated", "incidentsMutated",
  "terminalDecisionsMutated", "missionsMutated", "missionTargetsMutated",
  "purchasePoliciesMutated", "actionsMutated", "spendMutated",
  "inboxLifecycleMutated", "rawSignalPayloadReturned"
] as const);

function parsePlan(
  value: Record<string, unknown>,
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  messageId: string,
  now: number
): PostgresSignalMissionBindingApplyPlan {
  const record = exactObject(value, "plan", PLAN_KEYS);
  if (record.contractVersion !== 1 || record.messageId !== messageId
    || typeof record.payloadHash !== "string" || !SHA256.test(record.payloadHash)
    || typeof record.semanticKey !== "string" || !SHA256.test(record.semanticKey)
    || typeof record.planFingerprint !== "string" || !SHA256.test(record.planFingerprint)) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding plan identity is invalid."
    );
  }
  const evaluatedAt = exactTimestamp(record.evaluatedAt, "plan evaluation timestamp");
  const validUntil = exactTimestamp(record.validUntil, "plan expiry timestamp");
  const evaluatedAtMs = Date.parse(evaluatedAt);
  const validUntilMs = Date.parse(validUntil);
  if (Math.abs(now - evaluatedAtMs) > MAXIMUM_CLOCK_SKEW_MS
    || validUntilMs - evaluatedAtMs !== MAXIMUM_PLAN_AGE_SECONDS * 1_000
    || now > validUntilMs) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding plan lifetime is invalid."
    );
  }
  const eventId = exactText(record.eventId, "event ID", 200);
  const resolutionDecisionId = exactText(record.resolutionDecisionId, "resolution ID", 200);
  const listingId = exactText(record.listingId, "listing ID", 200);
  const variantId = exactText(record.variantId, "variant ID", 200);
  const offerObservationId = exactText(record.offerObservationId, "offer observation ID", 200);
  const incidentId = exactText(record.incidentId, "incident ID", 200);
  if (!/^signal_event_[a-f0-9]{32}$/.test(eventId)
    || !/^resolution_[a-f0-9]{32}$/.test(resolutionDecisionId)
    || !/^offer_observation_[a-f0-9]{32}$/.test(offerObservationId)
    || !/^incident_[a-f0-9]{32}$/.test(incidentId)
    || record.postIncidentDecisionOutcome !== "continue_downstream"
    || (record.outcome !== "apply_mission_binding" && record.outcome !== "already_bound")) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding plan graph is invalid."
    );
  }
  const missionId = exactText(record.missionId, "mission ID", 200, true);
  const missionTargetId = exactText(record.missionTargetId, "mission-target ID", 200, true);
  const policyRevisionId = exactText(record.policyRevisionId, "policy revision ID", 200, true);
  if (typeof record.missionCreationRequired !== "boolean"
    || typeof record.initialPolicyRequired !== "boolean") {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding plan requirements are invalid."
    );
  }
  const missionCreationRequired = record.missionCreationRequired;
  const initialPolicyRequired = record.initialPolicyRequired;
  const targetInsertCount = exactInteger(record.targetInsertCount, "target insert count");
  const policyQuantity = exactInteger(record.policyQuantity, "policy quantity");
  const variantListingCount = exactInteger(record.variantListingCount, "variant listing count");
  if (policyQuantity < 1 || policyQuantity > 99
    || variantListingCount < 1 || variantListingCount > MAXIMUM_VARIANT_LISTINGS
    || targetInsertCount > variantListingCount) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding target counts are invalid."
    );
  }
  const missionAction = insertAction(record.missionAction, "mission action");
  const missionTargetAction = insertAction(record.missionTargetAction, "mission-target action");
  const policyRevisionAction = insertAction(record.policyRevisionAction, "policy action");
  const missionAuditAction = insertAction(record.missionAuditAction, "mission audit action");
  const missionOutboxAction = insertAction(record.missionOutboxAction, "mission outbox action");
  const policyAuditAction = insertAction(record.policyAuditAction, "policy audit action");
  const policyOutboxAction = insertAction(record.policyOutboxAction, "policy outbox action");
  const mutationStatementCount = exactInteger(
    record.mutationStatementCount,
    "mutation statement count"
  );
  const mutationRowCount = exactInteger(record.mutationRowCount, "mutation row count");
  const expectedMutations = (missionAction === "insert" ? 1 : 0)
    + targetInsertCount
    + (policyRevisionAction === "insert" ? 1 : 0)
    + (missionAuditAction === "insert" ? 1 : 0)
    + (missionOutboxAction === "insert" ? 1 : 0)
    + (policyAuditAction === "insert" ? 1 : 0)
    + (policyOutboxAction === "insert" ? 1 : 0);
  const willApply = record.outcome === "apply_mission_binding";
  if (missionCreationRequired !== (missionAction === "insert")
    || initialPolicyRequired !== (policyRevisionAction === "insert")
    || (targetInsertCount > 0) !== (missionTargetAction === "insert")
    || missionAuditAction !== missionAction || missionOutboxAction !== missionAction
    || policyAuditAction !== policyRevisionAction || policyOutboxAction !== policyRevisionAction
    || mutationStatementCount !== expectedMutations || mutationRowCount !== expectedMutations
    || willApply !== (expectedMutations > 0)
    || record.missionBindingApplyWillApply !== willApply
    || (missionCreationRequired ? missionId !== "" : missionId === "")
    || (targetInsertCount === 0 && missionTargetId === "")
    || (initialPolicyRequired ? policyRevisionId !== "" : policyRevisionId === "")) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding mutation plan is inconsistent."
    );
  }
  exactBoolean(record.sharedCatalogMutation, false, "shared-catalog mutation flag");
  exactBoolean(record.incidentMutation, false, "incident mutation flag");
  exactBoolean(record.terminalDecisionMutation, false, "terminal-decision mutation flag");
  exactBoolean(record.actionMutation, false, "action mutation flag");
  exactBoolean(record.spendMutation, false, "spend mutation flag");
  exactBoolean(record.inboxLifecycleMutation, false, "inbox mutation flag");
  exactBoolean(record.rawSignalPayloadReturned, false, "raw payload flag");
  const plan: PostgresSignalMissionBindingApplyPlan = {
    contractVersion: 1,
    messageId,
    payloadHash: record.payloadHash,
    evaluatedAt,
    validUntil,
    eventId,
    resolutionDecisionId,
    listingId,
    variantId,
    offerObservationId,
    incidentId,
    semanticKey: record.semanticKey,
    postIncidentDecisionOutcome: "continue_downstream",
    outcome: record.outcome,
    missionId,
    missionTargetId,
    policyRevisionId,
    missionCreationRequired,
    targetInsertCount,
    initialPolicyRequired,
    policyQuantity,
    variantListingCount,
    missionAction,
    missionTargetAction,
    policyRevisionAction,
    missionAuditAction,
    missionOutboxAction,
    policyAuditAction,
    policyOutboxAction,
    mutationStatementCount,
    mutationRowCount,
    missionBindingApplyWillApply: willApply,
    sharedCatalogMutation: false,
    incidentMutation: false,
    terminalDecisionMutation: false,
    actionMutation: false,
    spendMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    planFingerprint: record.planFingerprint
  };
  if (plan.planFingerprint !== postgresSignalMissionBindingApplyPlanFingerprint(principal, plan)) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding plan fingerprint is invalid."
    );
  }
  return plan;
}

function parseResult(
  value: Record<string, unknown>,
  plan: PostgresSignalMissionBindingApplyPlan
): PostgresSignalMissionBindingApplyResult {
  const record = exactObject(value, "apply result", RESULT_KEYS);
  const stableFields = [
    "contractVersion", "messageId", "planFingerprint", "eventId",
    "resolutionDecisionId", "listingId", "variantId", "offerObservationId",
    "incidentId", "semanticKey", "postIncidentDecisionOutcome", "outcome",
    "policyQuantity", "variantListingCount", "missionAction", "missionTargetAction",
    "policyRevisionAction", "missionAuditAction", "missionOutboxAction",
    "policyAuditAction", "policyOutboxAction", "mutationStatementCount",
    "mutationRowCount"
  ] as const;
  for (const field of stableFields) {
    if (record[field] !== plan[field]) {
      throw new PostgresSignalMissionBindingApplyQualificationError(
        "The PostgreSQL signal-mission-binding apply result changed from its sealed plan."
      );
    }
  }
  const missionId = exactText(record.missionId, "result mission ID", 200);
  const missionTargetId = exactText(record.missionTargetId, "result target ID", 200);
  const policyRevisionId = exactText(record.policyRevisionId, "result policy ID", 200);
  if ((!plan.missionCreationRequired && missionId !== plan.missionId)
    || (plan.missionTargetId !== "" && missionTargetId !== plan.missionTargetId)
    || (!plan.initialPolicyRequired && policyRevisionId !== plan.policyRevisionId)
    || record.missionCreated !== plan.missionCreationRequired
    || exactInteger(record.targetsInserted, "inserted target count") !== plan.targetInsertCount
    || record.initialPolicyCreated !== plan.initialPolicyRequired
    || record.missionBindingApplyApplied !== plan.missionBindingApplyWillApply
    || record.missionsMutated !== plan.missionCreationRequired
    || record.missionTargetsMutated !== (plan.targetInsertCount > 0)
    || record.purchasePoliciesMutated !== plan.initialPolicyRequired) {
    throw new PostgresSignalMissionBindingApplyQualificationError(
      "The PostgreSQL signal-mission-binding apply mutation result is inconsistent."
    );
  }
  exactBoolean(record.continueDownstream, true, "continuation flag");
  exactBoolean(record.mutationAuthority, true, "mutation authority flag");
  exactBoolean(record.idempotentReplay, true, "replay flag");
  exactBoolean(record.sharedCatalogMutated, false, "shared-catalog result flag");
  exactBoolean(record.incidentsMutated, false, "incident result flag");
  exactBoolean(record.terminalDecisionsMutated, false, "terminal-decision result flag");
  exactBoolean(record.actionsMutated, false, "action result flag");
  exactBoolean(record.spendMutated, false, "spend result flag");
  exactBoolean(record.inboxLifecycleMutated, false, "inbox result flag");
  exactBoolean(record.rawSignalPayloadReturned, false, "raw payload result flag");
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
    postIncidentDecisionOutcome: "continue_downstream",
    outcome: plan.outcome,
    missionId,
    missionTargetId,
    policyRevisionId,
    missionCreated: plan.missionCreationRequired,
    targetsInserted: plan.targetInsertCount,
    initialPolicyCreated: plan.initialPolicyRequired,
    policyQuantity: plan.policyQuantity,
    variantListingCount: plan.variantListingCount,
    missionAction: plan.missionAction,
    missionTargetAction: plan.missionTargetAction,
    policyRevisionAction: plan.policyRevisionAction,
    missionAuditAction: plan.missionAuditAction,
    missionOutboxAction: plan.missionOutboxAction,
    policyAuditAction: plan.policyAuditAction,
    policyOutboxAction: plan.policyOutboxAction,
    mutationStatementCount: plan.mutationStatementCount,
    mutationRowCount: plan.mutationRowCount,
    missionBindingApplyApplied: plan.missionBindingApplyWillApply,
    continueDownstream: true,
    mutationAuthority: true,
    idempotentReplay: true,
    sharedCatalogMutated: false,
    incidentsMutated: false,
    terminalDecisionsMutated: false,
    missionsMutated: plan.missionCreationRequired,
    missionTargetsMutated: plan.targetInsertCount > 0,
    purchasePoliciesMutated: plan.initialPolicyRequired,
    actionsMutated: false,
    spendMutated: false,
    inboxLifecycleMutated: false,
    rawSignalPayloadReturned: false
  };
}

export class NodePostgresSignalMissionBindingApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalMissionBindingApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalMissionBindingApplyManifest(),
    options: NodePostgresSignalMissionBindingApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalMissionBindingApplyQualificationError(
        "The PostgreSQL signal-mission-binding connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_mission_binding_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async applySignalMissionBinding(
    principal: BackgroundWorkerPrincipal,
    messageIdValue: string,
    capabilityTokenValue: string,
    now = Date.now()
  ): Promise<PostgresSignalMissionBindingApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const messageId = String(messageIdValue ?? "");
    const capabilityToken = String(capabilityTokenValue ?? "");
    if (!MESSAGE_ID.test(messageId) || !CAPABILITY_TOKEN.test(capabilityToken)
      || !Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresSignalMissionBindingApplyQualificationError(
        "The PostgreSQL signal-mission-binding apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.missionBindingApplyRole.name)}`);
      const call = async (
        operation: "plan" | "apply",
        evaluatedAt: string,
        payload: Record<string, unknown>
      ): Promise<Record<string, unknown>> => {
        const result = await client.query<FunctionRow>(
          `SELECT result_json AS "resultJson"
           FROM ${relation(this.manifest.schemaName, POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION)}(
             $1, $2, $3, $4, $5, $6, $7
           )`,
          [tenantId, userId, operation, messageId, capabilityToken, evaluatedAt, JSON.stringify(payload)]
        );
        if (result.rows.length !== 1 || !result.rows[0]) {
          throw new PostgresSignalMissionBindingApplyQualificationError(
            "The PostgreSQL signal-mission-binding function returned an ambiguous result."
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
