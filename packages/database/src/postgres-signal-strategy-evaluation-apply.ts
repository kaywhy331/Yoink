import { createHash } from "node:crypto";
import { CART_SIGNAL_FUTURE_SKEW_MS, NOTIFY_SIGNAL_MAX_AGE_SECONDS } from "../../domain/src/strategies.js";
import { MAX_SIGNAL_FUTURE_SKEW_MS } from "../../domain/src/normalize.js";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { nowIso, stableHash } from "../../domain/src/ids.js";
import {
  SIGNAL_POLICY_EVALUATOR_CONTRACT_VERSION,
  signalPolicyEvaluationFingerprint,
  type SignalPolicyEvaluationAttestation
} from "../../domain/src/signal-policy-evaluation.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase,
  logIdlePostgresClientErrors
} from "./postgres-cutover.js";
import {
  POSTGRES_SIGNAL_MISSION_BINDING_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION,
  buildPostgresSignalMissionBindingApplyManifest,
  verifyPostgresSignalMissionBindingApplyBoundary,
  type PostgresSignalMissionBindingApplyManifest
} from "./postgres-signal-mission-binding-apply.js";
import { POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION } from "./postgres-signal-resolution-apply.js";
import {
  applyPostgresQualifiedFunctionBoundary,
  verifyPostgresQualifiedFunctionBoundary,
  type PostgresQualifiedFunctionBoundaryReceipt,
  type PostgresQualifiedFunctionBoundarySpec
} from "./postgres-qualified-function-boundary.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_RECEIPT_TABLE =
  "yoink_signal_strategy_evaluation_apply_receipt";
export const POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION =
  "yoink_apply_trackalacker_signal_strategy_evaluation";

const MAXIMUM_CLOCK_SKEW_MS = 300_000;
const MAXIMUM_PLAN_AGE_SECONDS = 30;
const MAXIMUM_APPLY_PAYLOAD_BYTES = 8_192;
const MAXIMUM_STRATEGIES = 100;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MESSAGE_ID = /^inbox_[a-f0-9]{32}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text", "text", "text"
] as const);
const FUNCTION_ARGUMENTS_SQL = `
  expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
  target_message_id TEXT, capability_token TEXT,
  evaluation_timestamp_input TEXT, apply_payload_json TEXT
`;
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
  "source_product_refs",
  "strategies"
] as const);
const MUTATION_TABLES = Object.freeze([
  "audit_events",
  "mission_decisions",
  "outbox_events"
] as const);
const TERMINAL_STATES = Object.freeze(["unmatched", "stale", "quantity_limited"] as const);

type EvaluationState = SignalPolicyEvaluationAttestation["state"];
type EvaluationOutcome = EvaluationState | "continue_downstream";
type InsertAction = "none" | "insert";

export interface PostgresSignalStrategyEvaluationApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  missionBindingApplyContractVersion: 1;
  evaluatorContractVersion: 1;
  schemaName: string;
  strategyEvaluationRoleNamespace: string;
  missionBindingApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalMissionBindingApplyManifest;
  strategyEvaluationRole: {
    kind: "signal_strategy_evaluation_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTenantTableCount: 19;
  forcedRlsTableCount: 19;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  maximumPlanAgeSeconds: 30;
  maximumStrategies: 100;
  serverBoundPrincipalLookup: true;
  settledMissionBindingRequired: true;
  messageSerialization: true;
  applicationOwnedDeterministicEvaluation: true;
  databaseInputSnapshotRevalidation: true;
  strategySetFingerprintParity: true;
  evaluationFingerprintParity: true;
  terminalEvaluationDecisionParity: true;
  actionableEvaluationZeroWriteHandoff: true;
  sourceTrustRestrictionParity: true;
  idempotentReplay: true;
  sharedCatalogMutation: false;
  missionMutation: false;
  policyMutation: false;
  strategyMutation: false;
  actionMutation: false;
  spendMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  databaseSemanticEvaluation: false;
  signalEvaluationApplyRepositoryParity: true;
  hostedDeliveryHandlerRepositoryParity: false;
  mutationAuthority: true;
  evaluationAuthority: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalStrategyEvaluationApplyCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  missionBindingApplyContractVersion: 1;
  evaluatorContractVersion: 1;
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
  settledMissionBindingRequired: true;
  messageSerialization: true;
  twoPhasePlanApply: true;
  readCommittedTransactionAdapter: true;
  applicationOwnedDeterministicEvaluation: true;
  databaseInputSnapshotRevalidation: true;
  strategySetFingerprintParity: true;
  evaluationFingerprintParity: true;
  terminalEvaluationDecisionParity: true;
  actionableEvaluationZeroWriteHandoff: true;
  sourceTrustRestrictionParity: true;
  idempotentReplay: true;
  sharedCatalogMutation: false;
  missionMutation: false;
  policyMutation: false;
  strategyMutation: false;
  actionMutation: false;
  spendMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  databaseSemanticEvaluation: false;
  signalEvaluationApplyRepositoryParity: true;
  hostedDeliveryHandlerRepositoryParity: false;
  maximumPlanAgeSeconds: 30;
  maximumStrategies: 100;
  protectedTenantTableCount: 19;
  forcedRlsTableCount: 19;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  evaluationAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalStrategyEvaluationApplyPlan {
  contractVersion: 1;
  messageId: string;
  payloadHash: string;
  evaluatedAt: string;
  validUntil: string;
  eventId: string;
  signalId: string;
  resolutionDecisionId: string;
  listingId: string;
  variantId: string;
  offerObservationId: string;
  incidentId: string;
  semanticKey: string;
  missionId: string;
  missionTargetId: string;
  missionEvaluationQuantity: number;
  policyRevisionId: string;
  policyRevision: number;
  policyHash: string;
  strategySetFingerprint: string;
  strategyCount: number;
  evaluationFingerprint: string;
  evaluationState: EvaluationState;
  evaluationReason: string;
  decisionSource: SignalPolicyEvaluationAttestation["decisionSource"];
  strategyId: string;
  strategyRevision: number;
  maxSignalAgeSeconds: number;
  effectiveUnitCapCents: number | null;
  effectiveQuantity: number;
  effectiveAction: SignalPolicyEvaluationAttestation["effectiveAction"];
  sellerPolicy: SignalPolicyEvaluationAttestation["sellerPolicy"];
  fulfillment: SignalPolicyEvaluationAttestation["fulfillment"];
  sourceActionRestricted: boolean;
  outcome: EvaluationOutcome;
  decisionAction: InsertAction;
  auditAction: InsertAction;
  outboxAction: InsertAction;
  mutationStatementCount: number;
  mutationRowCount: number;
  strategyEvaluationApplyWillApply: boolean;
  continueDownstream: boolean;
  sharedCatalogMutation: false;
  missionMutation: false;
  policyMutation: false;
  strategyMutation: false;
  actionMutation: false;
  spendMutation: false;
  inboxLifecycleMutation: false;
  rawSignalPayloadReturned: false;
  evaluationAuthority: false;
  planFingerprint: string;
}

export interface PostgresSignalStrategyEvaluationApplyResult
  extends Omit<PostgresSignalStrategyEvaluationApplyPlan,
    "payloadHash" | "evaluatedAt" | "validUntil" | "decisionAction" | "auditAction" |
    "outboxAction" | "strategyEvaluationApplyWillApply"> {
  decisionAction: InsertAction;
  auditAction: InsertAction;
  outboxAction: InsertAction;
  strategyEvaluationApplyApplied: boolean;
  mutationAuthority: true;
  idempotentReplay: true;
  terminalDecisionMutated: boolean;
}

export interface NodePostgresSignalStrategyEvaluationApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection: Readonly<PostgresSignalStrategyEvaluationApplyCapabilityProjection> | null = null;

export class PostgresSignalStrategyEvaluationApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalStrategyEvaluationApplyQualificationError";
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
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      "The PostgreSQL signal-strategy-evaluation schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      "The PostgreSQL signal-strategy-evaluation role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_signal_evaluate`;
  if (value.length > 63) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      "The PostgreSQL signal-strategy-evaluation role name exceeds PostgreSQL's limit."
    );
  }
  return value;
}

function exactInteger(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      `The PostgreSQL signal-strategy-evaluation ${label} is invalid.`
    );
  }
  return normalized;
}

function exactText(value: unknown, label: string, maximum = 500, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || value !== value.trim()
    || (!allowEmpty && value.length === 0) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      `The PostgreSQL signal-strategy-evaluation ${label} is invalid.`
    );
  }
  return value;
}

function exactTimestamp(value: unknown, label: string): string {
  const normalized = exactText(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)
    || Number.isNaN(Date.parse(normalized))) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      `The PostgreSQL signal-strategy-evaluation ${label} is invalid.`
    );
  }
  return normalized;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function stableHashInputSql(parts: string[]): string {
  return parts.map((part) => `pg_catalog.octet_length(${part})::text || ':' || ${part} || '|'`).join(" || ");
}

function predecessorNamespaces(manifest: PostgresSignalMissionBindingApplyManifest): string[] {
  const predecessor = manifest.predecessorManifest;
  return [
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
    predecessor.postIncidentDecisionApplyRoleNamespace,
    manifest.missionBindingApplyRoleNamespace
  ];
}

export function buildPostgresSignalStrategyEvaluationApplyManifest(
  predecessorManifest = buildPostgresSignalMissionBindingApplyManifest(),
  requestedRoleNamespace = "yoink_strategy_eval_qual"
): PostgresSignalStrategyEvaluationApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName || POSTGRES_CUTOVER_DEFAULT_SCHEMA);
  const strategyEvaluationRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (predecessorNamespaces(predecessorManifest).includes(strategyEvaluationRoleNamespace)) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      "The PostgreSQL signal-strategy-evaluation role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalStrategyEvaluationApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    missionBindingApplyContractVersion: POSTGRES_SIGNAL_MISSION_BINDING_APPLY_CONTRACT_VERSION,
    evaluatorContractVersion: SIGNAL_POLICY_EVALUATOR_CONTRACT_VERSION,
    schemaName,
    strategyEvaluationRoleNamespace,
    missionBindingApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    strategyEvaluationRole: {
      kind: "signal_strategy_evaluation_apply_boundary",
      name: roleName(strategyEvaluationRoleNamespace),
      functionName: POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTenantTableCount: 19,
    forcedRlsTableCount: 19,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    maximumPlanAgeSeconds: 30,
    maximumStrategies: 100,
    serverBoundPrincipalLookup: true,
    settledMissionBindingRequired: true,
    messageSerialization: true,
    applicationOwnedDeterministicEvaluation: true,
    databaseInputSnapshotRevalidation: true,
    strategySetFingerprintParity: true,
    evaluationFingerprintParity: true,
    terminalEvaluationDecisionParity: true,
    actionableEvaluationZeroWriteHandoff: true,
    sourceTrustRestrictionParity: true,
    idempotentReplay: true,
    sharedCatalogMutation: false,
    missionMutation: false,
    policyMutation: false,
    strategyMutation: false,
    actionMutation: false,
    spendMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    databaseSemanticEvaluation: false,
    signalEvaluationApplyRepositoryParity: true,
    hostedDeliveryHandlerRepositoryParity: false,
    mutationAuthority: true,
    evaluationAuthority: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresSignalStrategyEvaluationApplyCapabilityProjection():
PostgresSignalStrategyEvaluationApplyCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalStrategyEvaluationApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    missionBindingApplyContractVersion: 1,
    evaluatorContractVersion: 1,
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
    settledMissionBindingRequired: true,
    messageSerialization: true,
    twoPhasePlanApply: true,
    readCommittedTransactionAdapter: true,
    applicationOwnedDeterministicEvaluation: true,
    databaseInputSnapshotRevalidation: true,
    strategySetFingerprintParity: true,
    evaluationFingerprintParity: true,
    terminalEvaluationDecisionParity: true,
    actionableEvaluationZeroWriteHandoff: true,
    sourceTrustRestrictionParity: true,
    idempotentReplay: true,
    sharedCatalogMutation: false,
    missionMutation: false,
    policyMutation: false,
    strategyMutation: false,
    actionMutation: false,
    spendMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    databaseSemanticEvaluation: false,
    signalEvaluationApplyRepositoryParity: true,
    hostedDeliveryHandlerRepositoryParity: false,
    maximumPlanAgeSeconds: 30,
    maximumStrategies: 100,
    protectedTenantTableCount: 19,
    forcedRlsTableCount: 19,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: true,
    evaluationAuthority: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

export function postgresSignalStrategyEvaluationApplyPlanFingerprint(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  plan: PostgresSignalStrategyEvaluationApplyPlan
): string {
  return stableHash(
    "postgres_signal_strategy_evaluation_apply_plan_v1",
    principal.tenantId,
    principal.userId,
    plan.contractVersion,
    plan.messageId,
    plan.payloadHash,
    plan.evaluatedAt,
    plan.validUntil,
    plan.eventId,
    plan.signalId,
    plan.resolutionDecisionId,
    plan.listingId,
    plan.variantId,
    plan.offerObservationId,
    plan.incidentId,
    plan.semanticKey,
    plan.missionId,
    plan.missionTargetId,
    plan.missionEvaluationQuantity,
    plan.policyRevisionId,
    plan.policyRevision,
    plan.policyHash,
    plan.strategySetFingerprint,
    plan.strategyCount,
    plan.evaluationFingerprint,
    plan.evaluationState,
    plan.evaluationReason,
    plan.decisionSource,
    plan.strategyId,
    plan.strategyRevision,
    plan.maxSignalAgeSeconds,
    plan.effectiveUnitCapCents,
    plan.effectiveQuantity,
    plan.effectiveAction,
    plan.sellerPolicy,
    plan.fulfillment,
    plan.sourceActionRestricted ? 1 : 0,
    plan.outcome,
    plan.decisionAction,
    plan.auditAction,
    plan.outboxAction,
    plan.mutationStatementCount,
    plan.mutationRowCount,
    plan.strategyEvaluationApplyWillApply ? 1 : 0,
    plan.continueDownstream ? 1 : 0,
    plan.sharedCatalogMutation ? 1 : 0,
    plan.missionMutation ? 1 : 0,
    plan.policyMutation ? 1 : 0,
    plan.strategyMutation ? 1 : 0,
    plan.actionMutation ? 1 : 0,
    plan.spendMutation ? 1 : 0,
    plan.inboxLifecycleMutation ? 1 : 0,
    plan.rawSignalPayloadReturned ? 1 : 0,
    plan.evaluationAuthority ? 1 : 0
  );
}

export function signalStrategyEvaluationApplyFunctionSource(
  manifest: PostgresSignalStrategyEvaluationApplyManifest
): string {
  const strategyComponentParts = stableHashInputSql([
    "strategy.id",
    "strategy.name",
    "CASE WHEN strategy.enabled = 1 THEN '1' ELSE '0' END",
    "strategy.position::text",
    "strategy.revision::text",
    "strategy.definition_json"
  ]);
  const evaluationFingerprintParts = stableHashInputSql([
    "'signal-policy-evaluation-v1'::text",
    "'1'::text",
    "signal_transport_hash_value",
    "listing_id_value",
    "mission_id_value",
    "mission_target_id_value",
    "mission_evaluation_quantity_value::text",
    "policy_revision_id_value",
    "policy_revision_value::text",
    "policy_hash_value",
    "strategy_set_fingerprint_value",
    "strategy_count_value::text",
    "evaluation_state_value",
    "evaluation_reason_value",
    "decision_source_value",
    "strategy_id_value",
    "strategy_revision_value::text",
    "max_signal_age_seconds_value::text",
    "COALESCE(effective_unit_cap_value::text, ''::text)",
    "effective_quantity_value::text",
    "effective_action_value",
    "seller_policy_value",
    "fulfillment_value",
    "CASE WHEN source_action_restricted_value THEN '1' ELSE '0' END"
  ]);
  const planFingerprintParts = stableHashInputSql([
    "'postgres_signal_strategy_evaluation_apply_plan_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "'1'::text",
    "message_id_value",
    "payload_hash_value",
    "evaluation_timestamp",
    "valid_until_timestamp",
    "event_id_value",
    "signal_id_value",
    "resolution_id_value",
    "listing_id_value",
    "variant_id_value",
    "offer_observation_id_value",
    "incident_id_value",
    "semantic_key_value",
    "mission_id_value",
    "mission_target_id_value",
    "mission_evaluation_quantity_value::text",
    "policy_revision_id_value",
    "policy_revision_value::text",
    "policy_hash_value",
    "strategy_set_fingerprint_value",
    "strategy_count_value::text",
    "evaluation_fingerprint_value",
    "evaluation_state_value",
    "evaluation_reason_value",
    "decision_source_value",
    "strategy_id_value",
    "strategy_revision_value::text",
    "max_signal_age_seconds_value::text",
    "COALESCE(effective_unit_cap_value::text, ''::text)",
    "effective_quantity_value::text",
    "effective_action_value",
    "seller_policy_value",
    "fulfillment_value",
    "CASE WHEN source_action_restricted_value THEN '1' ELSE '0' END",
    "outcome_value",
    "decision_action_value",
    "audit_action_value",
    "outbox_action_value",
    "mutation_statement_count::text",
    "mutation_row_count::text",
    "CASE WHEN apply_will_apply THEN '1' ELSE '0' END",
    "CASE WHEN continue_downstream_value THEN '1' ELSE '0' END",
    "'0'::text",
    "'0'::text",
    "'0'::text",
    "'0'::text",
    "'0'::text",
    "'0'::text",
    "'0'::text",
    "'0'::text",
    "'0'::text"
  ]);
  const decisionIdParts = stableHashInputSql([
    "'postgres_signal_strategy_evaluation_decision_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "event_id_value",
    "mission_id_value",
    "evaluation_fingerprint_value"
  ]);
  const auditIdParts = stableHashInputSql([
    "'postgres_signal_strategy_evaluation_audit_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "event_id_value",
    "mission_id_value",
    "evaluation_fingerprint_value"
  ]);
  const outboxIdParts = stableHashInputSql([
    "'postgres_signal_strategy_evaluation_outbox_v1'::text",
    "resolved_tenant_id",
    "resolved_user_id",
    "event_id_value",
    "mission_id_value",
    "evaluation_fingerprint_value"
  ]);
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  evaluation_clock TIMESTAMPTZ;
  evaluation_timestamp TEXT;
  valid_until_timestamp TEXT;
  request_payload JSONB;
  attestation JSONB;
  predecessor_plan JSONB;
  predecessor_count BIGINT;
  resolution_discovery JSONB;
  resolution_discovery_count BIGINT;
  existing_attested_decision_count BIGINT := 0;
  replay_discovery BOOLEAN := FALSE;
  replay_record RECORD;
  message_id_value TEXT;
  payload_hash_value TEXT;
  event_id_value TEXT;
  signal_id_value TEXT;
  resolution_id_value TEXT;
  listing_id_value TEXT;
  variant_id_value TEXT;
  offer_observation_id_value TEXT;
  incident_id_value TEXT;
  semantic_key_value TEXT;
  mission_id_value TEXT;
  mission_target_id_value TEXT;
  signal_transport_hash_value TEXT;
  mission_evaluation_quantity_value BIGINT;
  policy_revision_id_value TEXT;
  policy_revision_value BIGINT;
  policy_hash_value TEXT;
  strategy_set_fingerprint_value TEXT;
  strategy_count_value BIGINT;
  evaluation_fingerprint_value TEXT;
  evaluation_state_value TEXT;
  evaluation_reason_value TEXT;
  decision_source_value TEXT;
  strategy_id_value TEXT;
  strategy_revision_value BIGINT;
  max_signal_age_seconds_value BIGINT;
  profile_reconcile_pending_count BIGINT;
  effective_unit_cap_value BIGINT;
  effective_quantity_value BIGINT;
  effective_action_value TEXT;
  seller_policy_value TEXT;
  fulfillment_value TEXT;
  source_action_restricted_value BOOLEAN;
  event_record RECORD;
  mission_record RECORD;
  policy_record RECORD;
  strategy_record RECORD;
  decision_record RECORD;
  audit_record RECORD;
  outbox_record RECORD;
  current_policy_count BIGINT := 0;
  matching_target_count BIGINT := 0;
  matching_enabled_target_count BIGINT := 0;
  strategy_parts TEXT := '';
  computed_strategy_fingerprint TEXT := '';
  computed_evaluation_fingerprint TEXT := '';
  outcome_value TEXT := 'continue_downstream';
  continue_downstream_value BOOLEAN := TRUE;
  decision_id_value TEXT := '';
  audit_id_value TEXT := '';
  outbox_id_value TEXT := '';
  audit_data_json_value TEXT := '';
  outbox_payload_json_value TEXT := '';
  decision_count BIGINT := 0;
  audit_count BIGINT := 0;
  outbox_count BIGINT := 0;
  decision_action_value TEXT := 'none';
  audit_action_value TEXT := 'none';
  outbox_action_value TEXT := 'none';
  mutation_statement_count BIGINT := 0;
  mutation_row_count BIGINT := 0;
  apply_will_apply BOOLEAN := FALSE;
  plan_fingerprint_value TEXT := '';
  plan_value JSONB;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = ''
    OR target_message_id !~ '^inbox_[a-f0-9]{32}$'
    OR capability_token !~ '^[A-Za-z0-9_-]{43}$'
    OR operation_name NOT IN ('plan', 'apply')
    OR pg_catalog.octet_length(apply_payload_json) > ${MAXIMUM_APPLY_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation request is invalid';
  END IF;
  BEGIN
    request_payload := apply_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) <> 'object'
    OR (request_payload - (CASE WHEN operation_name = 'plan'
      THEN ARRAY['attestation']::text[]
      ELSE ARRAY['attestation', 'planFingerprint']::text[] END)) IS DISTINCT FROM '{}'::jsonb
    OR pg_catalog.jsonb_typeof(request_payload->'attestation') IS DISTINCT FROM 'object'
    OR (operation_name = 'plan' AND request_payload ? 'planFingerprint')
    OR (operation_name = 'apply' AND (
      pg_catalog.jsonb_typeof(request_payload->'planFingerprint') IS DISTINCT FROM 'string'
      OR COALESCE(request_payload->>'planFingerprint', '') !~ '^[a-f0-9]{64}$'
    )) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation payload shape is invalid';
  END IF;
  attestation := request_payload->'attestation';
  IF attestation - ARRAY[
      'contractVersion', 'signalTransportHash', 'listingId', 'missionId',
      'missionTargetId', 'missionEvaluationQuantity', 'policyRevisionId',
      'policyRevision', 'policyHash', 'strategySetFingerprint', 'strategyCount',
      'state', 'reason', 'decisionSource', 'strategyId', 'strategyRevision',
      'maxSignalAgeSeconds', 'effectiveUnitCapCents', 'effectiveQuantity',
      'effectiveAction', 'sellerPolicy', 'fulfillment', 'sourceActionRestricted',
      'evaluationFingerprint'
    ]::text[] IS DISTINCT FROM '{}'::jsonb
    OR pg_catalog.jsonb_typeof(attestation->'contractVersion') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(attestation->'signalTransportHash') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'listingId') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'missionId') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'missionTargetId') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'missionEvaluationQuantity') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(attestation->'policyRevisionId') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'policyRevision') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(attestation->'policyHash') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'strategySetFingerprint') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'strategyCount') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(attestation->'state') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'reason') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'decisionSource') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'strategyId') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'strategyRevision') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(attestation->'maxSignalAgeSeconds') IS DISTINCT FROM 'number'
    OR (pg_catalog.jsonb_typeof(attestation->'effectiveUnitCapCents') IS DISTINCT FROM 'number'
      AND pg_catalog.jsonb_typeof(attestation->'effectiveUnitCapCents') IS DISTINCT FROM 'null')
    OR pg_catalog.jsonb_typeof(attestation->'effectiveQuantity') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(attestation->'effectiveAction') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'sellerPolicy') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'fulfillment') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'sourceActionRestricted') IS DISTINCT FROM 'boolean'
    OR pg_catalog.jsonb_typeof(attestation->'evaluationFingerprint') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation attestation shape is invalid';
  END IF;
  IF attestation->>'contractVersion' <> '1'
    OR attestation->>'missionEvaluationQuantity' !~ '^(0|[1-9][0-9]{0,9})$'
    OR attestation->>'policyRevision' !~ '^(0|[1-9][0-9]{0,9})$'
    OR attestation->>'strategyCount' !~ '^(0|[1-9][0-9]{0,9})$'
    OR attestation->>'strategyRevision' !~ '^(0|[1-9][0-9]{0,9})$'
    OR attestation->>'maxSignalAgeSeconds' !~ '^(0|[1-9][0-9]{0,9})$'
    OR attestation->>'effectiveQuantity' !~ '^(0|[1-9][0-9]{0,9})$'
    OR (pg_catalog.jsonb_typeof(attestation->'effectiveUnitCapCents') = 'number'
      AND attestation->>'effectiveUnitCapCents' !~ '^(0|[1-9][0-9]{0,9})$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation numeric values are not canonical integers';
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
    'yoink_signal_strategy_evaluation_message_v1:' || resolved_tenant_id || ':' ||
      resolved_user_id || ':' || target_message_id,
    0
  ));

  IF operation_name = 'plan' THEN
    IF evaluation_timestamp_input <> '' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation plan timestamp is invalid';
    END IF;
    evaluation_clock := pg_catalog.statement_timestamp();
  ELSE
    IF evaluation_timestamp_input !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation timestamp is invalid';
    END IF;
    evaluation_clock := evaluation_timestamp_input::timestamptz;
    IF evaluation_clock > pg_catalog.statement_timestamp()
      OR EXTRACT(EPOCH FROM (pg_catalog.statement_timestamp() - evaluation_clock)) > ${MAXIMUM_PLAN_AGE_SECONDS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation plan expired before apply';
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
    INTO resolution_discovery, resolution_discovery_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION)}(
    expected_tenant_id, expected_user_id, 'plan', target_message_id,
    capability_token, '', '{}'
  ) AS planned;
  IF resolution_discovery_count <> 1 OR resolution_discovery IS NULL
    OR resolution_discovery->>'messageId' <> target_message_id
    OR resolution_discovery->>'outcome' <> 'duplicate'
    OR resolution_discovery->>'duplicateEventId' !~ '^signal_event_[a-f0-9]{32}$'
    OR resolution_discovery->>'payloadHash' !~ '^[a-f0-9]{64}$'
    OR resolution_discovery->>'transportHash' <> attestation->>'signalTransportHash'
    OR resolution_discovery->>'signalId' = '' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal strategy-evaluation capability-bound resolution discovery failed';
  END IF;
  message_id_value := resolution_discovery->>'messageId';
  payload_hash_value := resolution_discovery->>'payloadHash';
  event_id_value := resolution_discovery->>'duplicateEventId';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'yoink_signal_strategy_evaluation_event_mission_v1:' || resolved_tenant_id || ':' ||
      resolved_user_id || ':' || event_id_value || ':' || (attestation->>'missionId'),
    0
  ));

  SELECT COUNT(*) INTO existing_attested_decision_count
  FROM ${relation(manifest.schemaName, "mission_decisions")} AS decision
  WHERE decision.event_id = event_id_value
    AND decision.mission_id = attestation->>'missionId';
  IF existing_attested_decision_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal strategy-evaluation replay identity is ambiguous';
  END IF;
  replay_discovery := existing_attested_decision_count = 1;

  IF replay_discovery THEN
    listing_id_value := attestation->>'listingId';
    mission_id_value := attestation->>'missionId';
    mission_target_id_value := attestation->>'missionTargetId';
    offer_observation_id_value := 'offer_observation_' || pg_catalog.substr(pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        ${stableHashInputSql(["'postgres_signal_offer_observation_id_v1'::text", "event_id_value"])},
        'UTF8'
      )), 'hex'
    ), 1, 32);
    SELECT resolution.id AS resolution_id, resolution.variant_id,
           occurrence.incident_id, incident.semantic_key
      INTO STRICT replay_record
    FROM ${relation(manifest.schemaName, "signal_events")} AS signal
    JOIN ${relation(manifest.schemaName, "resolution_decisions")} AS resolution
      ON resolution.event_id = signal.id
    JOIN ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
      ON occurrence.event_id = signal.id
    JOIN ${relation(manifest.schemaName, "signal_incidents")} AS incident
      ON incident.id = occurrence.incident_id
     AND incident.tenant_id = signal.tenant_id AND incident.user_id = signal.user_id
    JOIN ${relation(manifest.schemaName, "offer_observations")} AS observation
      ON observation.id = offer_observation_id_value
     AND observation.listing_id = resolution.listing_id
     AND observation.source_connection_id = signal.source_connection_id
     AND observation.observed_at = signal.observed_at
    WHERE signal.id = event_id_value AND signal.tenant_id = resolved_tenant_id
      AND signal.user_id = resolved_user_id
      AND signal.signal_id = resolution_discovery->>'signalId'
      AND signal.transport_hash = attestation->>'signalTransportHash'
      AND resolution.status = 'matched' AND resolution.listing_id = listing_id_value;
    resolution_id_value := replay_record.resolution_id;
    variant_id_value := replay_record.variant_id;
    incident_id_value := replay_record.incident_id;
    semantic_key_value := replay_record.semantic_key;
  ELSE
    SELECT MIN(planned.result_json)::jsonb, COUNT(*)
      INTO predecessor_plan, predecessor_count
    FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_MISSION_BINDING_APPLY_FUNCTION)}(
      expected_tenant_id, expected_user_id, 'plan', target_message_id,
      capability_token, '', '{}'
    ) AS planned;
    IF predecessor_count <> 1 OR predecessor_plan IS NULL
      OR predecessor_plan->>'messageId' <> target_message_id
      OR predecessor_plan->>'payloadHash' <> payload_hash_value
      OR predecessor_plan->>'eventId' <> event_id_value
      OR predecessor_plan->>'outcome' <> 'already_bound'
      OR predecessor_plan->>'postIncidentDecisionOutcome' <> 'continue_downstream'
      OR predecessor_plan->>'missionBindingApplyWillApply' <> 'false'
      OR (predecessor_plan->>'mutationStatementCount')::bigint <> 0
      OR (predecessor_plan->>'mutationRowCount')::bigint <> 0
      OR predecessor_plan->>'resolutionDecisionId' !~ '^resolution_[a-f0-9]{32}$'
      OR predecessor_plan->>'offerObservationId' !~ '^offer_observation_[a-f0-9]{32}$'
      OR predecessor_plan->>'incidentId' !~ '^incident_[a-f0-9]{32}$'
      OR predecessor_plan->>'semanticKey' !~ '^[a-f0-9]{64}$'
      OR predecessor_plan->>'listingId' <> attestation->>'listingId'
      OR predecessor_plan->>'missionId' <> attestation->>'missionId'
      OR predecessor_plan->>'missionTargetId' <> attestation->>'missionTargetId'
      OR predecessor_plan->>'policyRevisionId' <> attestation->>'policyRevisionId' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal strategy-evaluation requires settled exact mission binding';
    END IF;
    resolution_id_value := predecessor_plan->>'resolutionDecisionId';
    listing_id_value := predecessor_plan->>'listingId';
    variant_id_value := predecessor_plan->>'variantId';
    offer_observation_id_value := predecessor_plan->>'offerObservationId';
    incident_id_value := predecessor_plan->>'incidentId';
    semantic_key_value := predecessor_plan->>'semanticKey';
    mission_id_value := predecessor_plan->>'missionId';
    mission_target_id_value := predecessor_plan->>'missionTargetId';
  END IF;

  signal_transport_hash_value := attestation->>'signalTransportHash';
  mission_evaluation_quantity_value := (attestation->>'missionEvaluationQuantity')::bigint;
  policy_revision_id_value := attestation->>'policyRevisionId';
  policy_revision_value := (attestation->>'policyRevision')::bigint;
  policy_hash_value := attestation->>'policyHash';
  strategy_set_fingerprint_value := attestation->>'strategySetFingerprint';
  strategy_count_value := (attestation->>'strategyCount')::bigint;
  evaluation_state_value := attestation->>'state';
  evaluation_reason_value := attestation->>'reason';
  decision_source_value := attestation->>'decisionSource';
  strategy_id_value := attestation->>'strategyId';
  strategy_revision_value := (attestation->>'strategyRevision')::bigint;
  max_signal_age_seconds_value := (attestation->>'maxSignalAgeSeconds')::bigint;
  effective_unit_cap_value := CASE WHEN pg_catalog.jsonb_typeof(attestation->'effectiveUnitCapCents') = 'null'
    THEN NULL ELSE (attestation->>'effectiveUnitCapCents')::bigint END;
  effective_quantity_value := (attestation->>'effectiveQuantity')::bigint;
  effective_action_value := attestation->>'effectiveAction';
  seller_policy_value := attestation->>'sellerPolicy';
  fulfillment_value := attestation->>'fulfillment';
  source_action_restricted_value := (attestation->>'sourceActionRestricted')::boolean;
  evaluation_fingerprint_value := attestation->>'evaluationFingerprint';

  IF (attestation->>'contractVersion')::bigint <> 1
    OR attestation->>'listingId' <> listing_id_value
    OR attestation->>'missionId' <> mission_id_value
    OR attestation->>'missionTargetId' <> mission_target_id_value
    OR signal_transport_hash_value !~ '^[a-f0-9]{64}$'
    OR policy_hash_value !~ '^[a-f0-9]{64}$'
    OR strategy_set_fingerprint_value !~ '^[a-f0-9]{64}$'
    OR evaluation_fingerprint_value !~ '^[a-f0-9]{64}$'
    OR mission_evaluation_quantity_value NOT BETWEEN 1 AND 99
    OR policy_revision_value < 1
    OR strategy_count_value NOT BETWEEN 0 AND ${MAXIMUM_STRATEGIES}
    OR evaluation_state_value NOT IN ('matched', 'unmatched', 'stale', 'needs_price', 'quantity_limited')
    OR evaluation_reason_value = '' OR pg_catalog.octet_length(evaluation_reason_value) > 500
    OR evaluation_reason_value <> pg_catalog.btrim(evaluation_reason_value)
    OR evaluation_reason_value ~ '[[:cntrl:]]'
    OR decision_source_value NOT IN ('strategy', 'purchase_intent')
    OR pg_catalog.octet_length(strategy_id_value) > 120
    OR strategy_revision_value NOT BETWEEN 0 AND 2147483647
    OR max_signal_age_seconds_value NOT BETWEEN 10 AND 3600
    OR effective_quantity_value NOT BETWEEN 1 AND 99
    OR (effective_unit_cap_value IS NOT NULL AND effective_unit_cap_value NOT BETWEEN 1 AND 100000000)
    OR effective_action_value NOT IN ('notify', 'add_to_cart', 'prepare_checkout', 'submit_order')
    OR seller_policy_value NOT IN ('first_party_only', 'allow_third_party')
    OR fulfillment_value NOT IN ('shipping', 'pickup', 'either', 'manual', 'unknown')
    OR ((strategy_id_value = '') <> (strategy_revision_value = 0)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation attestation values are invalid';
  END IF;

  SELECT signal.signal_id, signal.transport_hash, signal.source, signal.observed_at,
         signal.offer_json, source_connection.trust_level
    INTO STRICT event_record
  FROM ${relation(manifest.schemaName, "signal_events")} AS signal
  JOIN ${relation(manifest.schemaName, "source_connections")} AS source_connection
    ON source_connection.id = signal.source_connection_id
   AND source_connection.tenant_id = signal.tenant_id
   AND source_connection.user_id = signal.user_id
  WHERE signal.id = event_id_value AND signal.tenant_id = resolved_tenant_id
    AND signal.user_id = resolved_user_id;
  signal_id_value := event_record.signal_id;
  IF event_record.transport_hash <> signal_transport_hash_value THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal strategy-evaluation transport snapshot changed';
  END IF;

  IF NOT replay_discovery THEN
    SELECT mission.status, mission.origin, mission.target_quantity,
         target.enabled AS target_enabled, target.max_unit_price_cents,
         target.seller_policy, target.fulfillment
    INTO STRICT mission_record
  FROM ${relation(manifest.schemaName, "missions")} AS mission
  JOIN ${relation(manifest.schemaName, "mission_targets")} AS target
    ON target.mission_id = mission.id
  WHERE mission.id = mission_id_value AND mission.tenant_id = resolved_tenant_id
    AND mission.user_id = resolved_user_id AND mission.variant_id = variant_id_value
    AND target.id = mission_target_id_value AND target.listing_id = listing_id_value
  FOR SHARE OF mission, target;

  SELECT COUNT(*) INTO current_policy_count
  FROM ${relation(manifest.schemaName, "mission_intent_revisions")} AS policy
  WHERE policy.mission_id = mission_id_value AND policy.tenant_id = resolved_tenant_id
    AND policy.user_id = resolved_user_id
    AND policy.revision = (
      SELECT MAX(candidate.revision)
      FROM ${relation(manifest.schemaName, "mission_intent_revisions")} AS candidate
      WHERE candidate.mission_id = mission_id_value
        AND candidate.tenant_id = resolved_tenant_id AND candidate.user_id = resolved_user_id
    );
  IF current_policy_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal strategy-evaluation current policy is ambiguous';
  END IF;
  SELECT policy.id, policy.revision, policy.quantity, policy.currency,
         policy.max_all_in_cents, policy.action_ceiling, policy.decision_mode,
         policy.max_signal_age_seconds, policy.substitution_policy,
         policy.expires_at, policy.target_policy_json, policy.policy_hash
    INTO STRICT policy_record
  FROM ${relation(manifest.schemaName, "mission_intent_revisions")} AS policy
  WHERE policy.mission_id = mission_id_value AND policy.tenant_id = resolved_tenant_id
    AND policy.user_id = resolved_user_id
  ORDER BY policy.revision DESC LIMIT 1
  FOR SHARE;
  IF policy_record.id <> policy_revision_id_value
    OR policy_record.revision <> policy_revision_value
    OR policy_record.policy_hash <> policy_hash_value
    OR policy_record.currency <> 'USD'
    OR policy_record.decision_mode <> decision_source_value
    OR policy_record.substitution_policy <> 'exact_only' THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal strategy-evaluation current policy snapshot changed';
  END IF;
  IF mission_evaluation_quantity_value <> mission_record.target_quantity THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation mission quantity projection is invalid';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE target.value->'enabled' = 'true'::jsonb)
    INTO matching_target_count, matching_enabled_target_count
  FROM pg_catalog.jsonb_array_elements(policy_record.target_policy_json::jsonb) AS target(value)
  WHERE target.value->>'targetId' = mission_target_id_value
    AND target.value->>'listingId' = listing_id_value;
  IF matching_target_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal strategy-evaluation target policy is ambiguous';
  END IF;

  SELECT COUNT(*), COALESCE(pg_catalog.string_agg(
      ${strategyComponentParts}, '' ORDER BY strategy.position, strategy.id
    ), '')
    INTO strategy_count_value, strategy_parts
  FROM ${relation(manifest.schemaName, "strategies")} AS strategy
  WHERE strategy.tenant_id = resolved_tenant_id AND strategy.user_id = resolved_user_id;
  computed_strategy_fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    ${stableHashInputSql(["'signal-strategy-set-v1'::text", "strategy_count_value::text"])} || strategy_parts,
    'UTF8'
  )), 'hex');
  IF strategy_count_value <> (attestation->>'strategyCount')::bigint
    OR computed_strategy_fingerprint <> strategy_set_fingerprint_value THEN
    RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'signal strategy-evaluation strategy snapshot changed';
  END IF;

  IF strategy_id_value <> '' THEN
    SELECT strategy.id, strategy.enabled, strategy.position, strategy.revision,
           strategy.definition_json
      INTO STRICT strategy_record
    FROM ${relation(manifest.schemaName, "strategies")} AS strategy
    WHERE strategy.id = strategy_id_value AND strategy.tenant_id = resolved_tenant_id
      AND strategy.user_id = resolved_user_id
    FOR SHARE;
    IF strategy_record.enabled <> 1 OR strategy_record.revision <> strategy_revision_value
      OR decision_source_value <> 'strategy'
      OR evaluation_state_value NOT IN ('matched', 'needs_price')
      OR (strategy_record.definition_json::jsonb->>'maxSignalAgeSeconds')::bigint
        <> max_signal_age_seconds_value THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation selected strategy is invalid';
    END IF;
  ELSIF decision_source_value = 'strategy'
    AND evaluation_state_value IN ('matched', 'needs_price') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation selected strategy is missing';
  END IF;
  IF decision_source_value = 'purchase_intent' AND (strategy_id_value <> '' OR strategy_revision_value <> 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'purchase-intent evaluation cannot bind a strategy';
  END IF;
  IF decision_source_value = 'purchase_intent'
    AND (max_signal_age_seconds_value <> policy_record.max_signal_age_seconds
      OR effective_quantity_value <> 1) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'purchase-intent evaluation projection is invalid';
  END IF;
  IF decision_source_value = 'strategy' AND strategy_id_value <> ''
    AND effective_quantity_value > mission_evaluation_quantity_value THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'strategy evaluation quantity exceeds the mission projection';
  END IF;
  IF effective_action_value <> 'notify'
    AND (mission_record.status <> 'active' OR mission_record.target_enabled <> 1) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation current mission target is inactive';
  END IF;
  IF decision_source_value = 'purchase_intent'
    AND evaluation_state_value IN ('matched', 'needs_price')
    AND (mission_record.status <> 'active' OR mission_record.target_enabled <> 1
      OR matching_enabled_target_count <> 1) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation current purchase-intent target is inactive';
  END IF;
  IF decision_source_value = 'purchase_intent'
    AND evaluation_state_value IN ('matched', 'needs_price')
    AND policy_record.expires_at <> ''
    AND policy_record.expires_at::timestamptz <= evaluation_clock THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation current purchase intent is expired';
  END IF;
  -- Declared parity gap (PG-06): SQLite runs
  -- ControlRepository.reconcilePurchaseProfileForListing before evaluating,
  -- revising the plan from its linked quick-add profile. That revision has no
  -- PostgreSQL twin, so when SQLite would revise this plan the hosted plane
  -- fails closed instead of evaluating against the stale revision.
  SELECT COUNT(*) INTO profile_reconcile_pending_count
  FROM ${relation(manifest.schemaName, "missions")} AS mission
  JOIN ${relation(manifest.schemaName, "mission_targets")} AS target
    ON target.mission_id = mission.id
  JOIN ${relation(manifest.schemaName, "app_settings")} AS settings
    ON settings.user_id = mission.user_id
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
    CASE WHEN pg_catalog.jsonb_typeof(settings.purchase_profiles_json::jsonb) = 'array'
      THEN settings.purchase_profiles_json::jsonb ELSE '[]'::jsonb END
  ) AS profile(value)
  WHERE mission.id = mission_id_value AND mission.tenant_id = resolved_tenant_id
    AND mission.user_id = resolved_user_id AND mission.status IN ('active', 'paused')
    AND mission.quick_add_profile_id <> '' AND target.listing_id = listing_id_value
    AND profile.value->>'id' = mission.quick_add_profile_id
    AND (profile.value->>'actionCeiling' IS DISTINCT FROM policy_record.action_ceiling
      OR COALESCE(profile.value->>'updatedAt', '') > mission.updated_at);
  IF profile_reconcile_pending_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal strategy-evaluation purchase-profile reconciliation is not twinned on PostgreSQL';
  END IF;
  END IF;
  IF evaluation_state_value IN ('unmatched', 'stale', 'quantity_limited')
    AND (effective_action_value <> 'notify' OR effective_quantity_value <> 1
      OR effective_unit_cap_value IS NOT NULL OR strategy_id_value <> ''
      OR seller_policy_value <> 'first_party_only' OR fulfillment_value <> 'unknown'
      OR source_action_restricted_value
      OR (decision_source_value = 'strategy' AND max_signal_age_seconds_value <> 120)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'terminal strategy evaluation is not fail closed';
  END IF;
  IF evaluation_state_value = 'needs_price' AND effective_action_value <> 'notify' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'price-required evaluation is not fail closed';
  END IF;
  IF source_action_restricted_value AND evaluation_state_value <> 'matched' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation source restriction is invalid';
  END IF;
  IF NOT replay_discovery THEN
    -- Freshness mirrors signalFreshness (packages/domain/src/strategies.ts):
    -- a cart action needs the attested window and at most
    -- CART_SIGNAL_FUTURE_SKEW_MS of source-clock lead; a notification may use
    -- max(window, NOTIFY_SIGNAL_MAX_AGE_SECONDS) and MAX_SIGNAL_FUTURE_SKEW_MS.
    -- Only evidence outside the notification bound is stale.
    IF evaluation_state_value IN ('matched', 'needs_price')
      AND effective_action_value <> 'notify'
      AND (
        event_record.observed_at::timestamptz > evaluation_clock + INTERVAL '${CART_SIGNAL_FUTURE_SKEW_MS / 1_000} seconds'
        OR EXTRACT(EPOCH FROM (evaluation_clock - event_record.observed_at::timestamptz))
          > max_signal_age_seconds_value
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'nonterminal strategy evaluation uses stale evidence';
    END IF;
    IF evaluation_state_value IN ('matched', 'needs_price')
      AND effective_action_value = 'notify'
      AND (
        event_record.observed_at::timestamptz > evaluation_clock + INTERVAL '${MAX_SIGNAL_FUTURE_SKEW_MS / 1_000} seconds'
        OR EXTRACT(EPOCH FROM (evaluation_clock - event_record.observed_at::timestamptz))
          > GREATEST(max_signal_age_seconds_value, ${NOTIFY_SIGNAL_MAX_AGE_SECONDS})
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'nonterminal strategy evaluation uses stale evidence';
    END IF;
    IF evaluation_state_value = 'stale'
      AND event_record.observed_at::timestamptz <= evaluation_clock + INTERVAL '${MAX_SIGNAL_FUTURE_SKEW_MS / 1_000} seconds'
      AND EXTRACT(EPOCH FROM (evaluation_clock - event_record.observed_at::timestamptz))
        <= GREATEST(max_signal_age_seconds_value, ${NOTIFY_SIGNAL_MAX_AGE_SECONDS}) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'stale strategy evaluation uses fresh evidence';
    END IF;
    IF source_action_restricted_value THEN
      IF decision_source_value <> 'purchase_intent' OR event_record.trust_level = 'trusted_exact'
        OR effective_action_value <> 'notify'
        OR evaluation_reason_value <>
          'The exact offer matched the reviewed plan, but this source is informational and cannot authorize a retailer action.' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation source restriction is invalid';
      END IF;
    ELSIF decision_source_value = 'purchase_intent'
      AND event_record.trust_level <> 'trusted_exact' AND effective_action_value <> 'notify' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'informational source cannot authorize a purchase-intent action';
    END IF;
  END IF;

  computed_evaluation_fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    ${evaluationFingerprintParts}, 'UTF8'
  )), 'hex');
  IF computed_evaluation_fingerprint <> evaluation_fingerprint_value THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation fingerprint is invalid';
  END IF;

  IF evaluation_state_value IN ('unmatched', 'stale', 'quantity_limited') THEN
    outcome_value := evaluation_state_value;
    continue_downstream_value := FALSE;
    decision_id_value := 'mission_decision_' || pg_catalog.substr(pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(${decisionIdParts}, 'UTF8')), 'hex'
    ), 1, 32);
    audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(${auditIdParts}, 'UTF8')), 'hex'
    ), 1, 32);
    outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(${outboxIdParts}, 'UTF8')), 'hex'
    ), 1, 32);
    audit_data_json_value := '{"missionId":' || pg_catalog.to_json(mission_id_value)::text ||
      ',"incidentId":' || pg_catalog.to_json(incident_id_value)::text ||
      ',"evaluationAttestation":' || attestation::text || '}';
    outbox_payload_json_value := '{"auditId":' || pg_catalog.to_json(audit_id_value)::text ||
      ',"correlationId":' || pg_catalog.to_json(signal_id_value)::text ||
      ',"reasonCode":' || pg_catalog.to_json(outcome_value)::text ||
      ',"message":' || pg_catalog.to_json(evaluation_reason_value)::text ||
      ',"data":' || audit_data_json_value || '}';

    SELECT COUNT(*) INTO decision_count
    FROM ${relation(manifest.schemaName, "mission_decisions")} AS decision
    WHERE decision.event_id = event_id_value AND decision.mission_id = mission_id_value;
    SELECT COUNT(*) INTO audit_count
    FROM ${relation(manifest.schemaName, "audit_events")} AS audit
    WHERE audit.id = audit_id_value AND audit.tenant_id = resolved_tenant_id
      AND audit.user_id = resolved_user_id;
    SELECT COUNT(*) INTO outbox_count
    FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
    WHERE outbox.id = outbox_id_value AND outbox.tenant_id = resolved_tenant_id;

    IF decision_count = 0 AND audit_count = 0 AND outbox_count = 0 THEN
      decision_action_value := 'insert';
      audit_action_value := 'insert';
      outbox_action_value := 'insert';
      mutation_statement_count := 3;
      mutation_row_count := 3;
      apply_will_apply := TRUE;
    ELSIF decision_count = 1 AND audit_count = 1 AND outbox_count = 1 THEN
      SELECT decision.id, decision.incident_id, decision.strategy_id,
             decision.strategy_revision, decision.decision_source, decision.outcome,
             decision.reason, decision.effective_action, decision.effective_quantity,
             decision.effective_unit_cap_cents, decision.created_at
        INTO STRICT decision_record
      FROM ${relation(manifest.schemaName, "mission_decisions")} AS decision
      WHERE decision.event_id = event_id_value AND decision.mission_id = mission_id_value;
      SELECT audit.id, audit.correlation_id, audit.event_type, audit.reason_code,
             audit.message, audit.data_json, audit.created_at
        INTO STRICT audit_record
      FROM ${relation(manifest.schemaName, "audit_events")} AS audit
      WHERE audit.id = audit_id_value AND audit.tenant_id = resolved_tenant_id
        AND audit.user_id = resolved_user_id;
      SELECT outbox.id, outbox.aggregate_type, outbox.aggregate_id,
             outbox.event_type, outbox.payload_json, outbox.created_at
        INTO STRICT outbox_record
      FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
      WHERE outbox.id = outbox_id_value AND outbox.tenant_id = resolved_tenant_id;
      IF decision_record.id <> decision_id_value
        OR decision_record.incident_id <> incident_id_value
        OR COALESCE(decision_record.strategy_id, '') <> strategy_id_value
        OR COALESCE(decision_record.strategy_revision, 0) <> strategy_revision_value
        OR decision_record.decision_source <> decision_source_value
        OR decision_record.outcome <> outcome_value
        OR decision_record.reason <> evaluation_reason_value
        OR decision_record.effective_action <> effective_action_value
        OR decision_record.effective_quantity <> effective_quantity_value
        OR decision_record.effective_unit_cap_cents IS DISTINCT FROM effective_unit_cap_value
        OR audit_record.id <> audit_id_value OR audit_record.correlation_id <> signal_id_value
        OR audit_record.event_type <> 'signal_decided' OR audit_record.reason_code <> outcome_value
        OR audit_record.message <> evaluation_reason_value OR audit_record.data_json <> audit_data_json_value
        OR outbox_record.id <> outbox_id_value OR outbox_record.aggregate_type <> 'signal'
        OR outbox_record.aggregate_id <> signal_id_value OR outbox_record.event_type <> 'signal_decided'
        OR outbox_record.payload_json <> outbox_payload_json_value
        OR decision_record.created_at !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
        OR decision_record.created_at <> audit_record.created_at
        OR decision_record.created_at <> outbox_record.created_at THEN
        RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal strategy-evaluation replay graph changed';
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'YK500', MESSAGE = 'signal strategy-evaluation graph is partial';
    END IF;
  ELSE
    SELECT COUNT(*) INTO decision_count
    FROM ${relation(manifest.schemaName, "mission_decisions")} AS decision
    WHERE decision.event_id = event_id_value AND decision.mission_id = mission_id_value;
    IF decision_count <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'YK409', MESSAGE = 'actionable signal already has a terminal mission decision';
    END IF;
  END IF;

  plan_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    ${planFingerprintParts}, 'UTF8'
  )), 'hex');
  plan_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_id_value,
    'payloadHash', payload_hash_value,
    'evaluatedAt', evaluation_timestamp,
    'validUntil', valid_until_timestamp,
    'eventId', event_id_value,
    'signalId', signal_id_value,
    'resolutionDecisionId', resolution_id_value,
    'listingId', listing_id_value,
    'variantId', variant_id_value,
    'offerObservationId', offer_observation_id_value,
    'incidentId', incident_id_value,
    'semanticKey', semantic_key_value,
    'missionId', mission_id_value,
    'missionTargetId', mission_target_id_value,
    'missionEvaluationQuantity', mission_evaluation_quantity_value,
    'policyRevisionId', policy_revision_id_value,
    'policyRevision', policy_revision_value,
    'policyHash', policy_hash_value,
    'strategySetFingerprint', strategy_set_fingerprint_value,
    'strategyCount', strategy_count_value,
    'evaluationFingerprint', evaluation_fingerprint_value,
    'evaluationState', evaluation_state_value,
    'evaluationReason', evaluation_reason_value
  ) || pg_catalog.jsonb_build_object(
    'decisionSource', decision_source_value,
    'strategyId', strategy_id_value,
    'strategyRevision', strategy_revision_value,
    'maxSignalAgeSeconds', max_signal_age_seconds_value,
    'effectiveUnitCapCents', effective_unit_cap_value,
    'effectiveQuantity', effective_quantity_value,
    'effectiveAction', effective_action_value,
    'sellerPolicy', seller_policy_value,
    'fulfillment', fulfillment_value,
    'sourceActionRestricted', source_action_restricted_value,
    'outcome', outcome_value,
    'decisionAction', decision_action_value,
    'auditAction', audit_action_value,
    'outboxAction', outbox_action_value,
    'mutationStatementCount', mutation_statement_count,
    'mutationRowCount', mutation_row_count,
    'strategyEvaluationApplyWillApply', apply_will_apply,
    'continueDownstream', continue_downstream_value,
    'sharedCatalogMutation', FALSE,
    'missionMutation', FALSE,
    'policyMutation', FALSE,
    'strategyMutation', FALSE,
    'actionMutation', FALSE,
    'spendMutation', FALSE,
    'inboxLifecycleMutation', FALSE,
    'rawSignalPayloadReturned', FALSE,
    'evaluationAuthority', FALSE,
    'planFingerprint', plan_fingerprint_value
  );
  IF operation_name = 'plan' THEN
    RETURN QUERY SELECT plan_value::text;
    RETURN;
  END IF;
  IF request_payload->>'planFingerprint' <> plan_fingerprint_value THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal strategy-evaluation apply payload does not match its current plan';
  END IF;

  IF decision_action_value = 'insert' THEN
    INSERT INTO ${relation(manifest.schemaName, "mission_decisions")}(
      id, event_id, incident_id, mission_id, strategy_id, strategy_revision,
      decision_source, outcome, reason, effective_action, effective_quantity,
      effective_unit_cap_cents, created_at
    ) VALUES (
      decision_id_value, event_id_value, incident_id_value, mission_id_value,
      NULLIF(strategy_id_value, ''), NULLIF(strategy_revision_value, 0),
      decision_source_value, outcome_value, evaluation_reason_value,
      effective_action_value, effective_quantity_value, effective_unit_cap_value,
      evaluation_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
      id, tenant_id, user_id, correlation_id, event_type, reason_code,
      message, data_json, created_at
    ) VALUES (
      audit_id_value, resolved_tenant_id, resolved_user_id, signal_id_value,
      'signal_decided', outcome_value, evaluation_reason_value,
      audit_data_json_value, evaluation_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
      id, tenant_id, aggregate_type, aggregate_id, event_type,
      payload_json, created_at, delivered_at, updated_at
    ) VALUES (
      outbox_id_value, resolved_tenant_id, 'signal', signal_id_value,
      'signal_decided', outbox_payload_json_value, evaluation_timestamp, '', evaluation_timestamp
    );
  END IF;
  RETURN QUERY SELECT (pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_id_value,
    'planFingerprint', plan_fingerprint_value,
    'eventId', event_id_value,
    'signalId', signal_id_value,
    'resolutionDecisionId', resolution_id_value,
    'listingId', listing_id_value,
    'variantId', variant_id_value,
    'offerObservationId', offer_observation_id_value,
    'incidentId', incident_id_value,
    'semanticKey', semantic_key_value,
    'missionId', mission_id_value,
    'missionTargetId', mission_target_id_value,
    'missionEvaluationQuantity', mission_evaluation_quantity_value,
    'policyRevisionId', policy_revision_id_value,
    'policyRevision', policy_revision_value,
    'policyHash', policy_hash_value,
    'strategySetFingerprint', strategy_set_fingerprint_value,
    'strategyCount', strategy_count_value,
    'evaluationFingerprint', evaluation_fingerprint_value,
    'evaluationState', evaluation_state_value,
    'evaluationReason', evaluation_reason_value
  ) || pg_catalog.jsonb_build_object(
    'decisionSource', decision_source_value,
    'strategyId', strategy_id_value,
    'strategyRevision', strategy_revision_value,
    'maxSignalAgeSeconds', max_signal_age_seconds_value,
    'effectiveUnitCapCents', effective_unit_cap_value,
    'effectiveQuantity', effective_quantity_value,
    'effectiveAction', effective_action_value,
    'sellerPolicy', seller_policy_value,
    'fulfillment', fulfillment_value,
    'sourceActionRestricted', source_action_restricted_value,
    'outcome', outcome_value,
    'decisionAction', decision_action_value,
    'auditAction', audit_action_value,
    'outboxAction', outbox_action_value,
    'mutationStatementCount', mutation_statement_count,
    'mutationRowCount', mutation_row_count,
    'strategyEvaluationApplyApplied', apply_will_apply,
    'continueDownstream', continue_downstream_value,
    'sharedCatalogMutation', FALSE,
    'missionMutation', FALSE,
    'policyMutation', FALSE,
    'strategyMutation', FALSE,
    'actionMutation', FALSE,
    'spendMutation', FALSE,
    'inboxLifecycleMutation', FALSE,
    'rawSignalPayloadReturned', FALSE,
    'evaluationAuthority', FALSE,
    'mutationAuthority', TRUE,
    'idempotentReplay', TRUE,
    'terminalDecisionMutated', apply_will_apply
  ))::text;
END
`;
}

function exactBoolean<T extends boolean>(value: unknown, expected: T, label: string): T {
  if (value !== expected) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      `The PostgreSQL signal-strategy-evaluation ${label} is invalid.`
    );
  }
  return expected;
}

function strictBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      `The PostgreSQL signal-strategy-evaluation ${label} is invalid.`
    );
  }
  return value;
}

function exactObject(value: unknown, label: string, expectedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      `The PostgreSQL signal-strategy-evaluation ${label} is invalid.`
    );
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\n") !== [...expectedKeys].sort().join("\n")) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      `The PostgreSQL signal-strategy-evaluation ${label} shape is invalid.`
    );
  }
  return record;
}

function parseFunctionJson(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "string" || value.length > 16_384) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      `The PostgreSQL signal-strategy-evaluation ${label} is invalid.`
    );
  }
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { parsed = null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      `The PostgreSQL signal-strategy-evaluation ${label} is invalid.`
    );
  }
  return parsed as Record<string, unknown>;
}

function evaluationState(value: unknown): EvaluationState {
  if (!["matched", "unmatched", "stale", "needs_price", "quantity_limited"].includes(String(value))) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      "The PostgreSQL signal-strategy-evaluation state is invalid."
    );
  }
  return value as EvaluationState;
}

function outcome(value: unknown): EvaluationOutcome {
  if (!["continue_downstream", "matched", "unmatched", "stale", "needs_price", "quantity_limited"].includes(String(value))) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      "The PostgreSQL signal-strategy-evaluation outcome is invalid."
    );
  }
  return value as EvaluationOutcome;
}

function insertAction(value: unknown, label: string): InsertAction {
  if (value !== "none" && value !== "insert") {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      `The PostgreSQL signal-strategy-evaluation ${label} is invalid.`
    );
  }
  return value;
}

function nullableCents(value: unknown, label: string): number | null {
  return value === null ? null : exactInteger(value, label, 1, 100_000_000);
}

export function validateSignalPolicyEvaluationAttestation(
  value: SignalPolicyEvaluationAttestation
): SignalPolicyEvaluationAttestation {
  const record = exactObject(value, "attestation", [
    "contractVersion", "signalTransportHash", "listingId", "missionId",
    "missionTargetId", "missionEvaluationQuantity", "policyRevisionId",
    "policyRevision", "policyHash", "strategySetFingerprint", "strategyCount",
    "state", "reason", "decisionSource", "strategyId", "strategyRevision",
    "maxSignalAgeSeconds", "effectiveUnitCapCents", "effectiveQuantity",
    "effectiveAction", "sellerPolicy", "fulfillment", "sourceActionRestricted",
    "evaluationFingerprint"
  ]);
  const normalized: SignalPolicyEvaluationAttestation = {
    contractVersion: exactInteger(record.contractVersion, "evaluator contract version", 1, 1) as 1,
    signalTransportHash: exactText(record.signalTransportHash, "signal transport hash", 64),
    listingId: exactText(record.listingId, "listing ID", 160),
    missionId: exactText(record.missionId, "mission ID", 160),
    missionTargetId: exactText(record.missionTargetId, "mission target ID", 160),
    missionEvaluationQuantity: exactInteger(record.missionEvaluationQuantity, "mission evaluation quantity", 1, 99),
    policyRevisionId: exactText(record.policyRevisionId, "policy revision ID", 160),
    policyRevision: exactInteger(record.policyRevision, "policy revision", 1, 2_147_483_647),
    policyHash: exactText(record.policyHash, "policy hash", 64),
    strategySetFingerprint: exactText(record.strategySetFingerprint, "strategy-set fingerprint", 64),
    strategyCount: exactInteger(record.strategyCount, "strategy count", 0, MAXIMUM_STRATEGIES),
    state: evaluationState(record.state),
    reason: exactText(record.reason, "evaluation reason", 500),
    decisionSource: record.decisionSource === "strategy" || record.decisionSource === "purchase_intent"
      ? record.decisionSource
      : (() => { throw new PostgresSignalStrategyEvaluationApplyQualificationError("The evaluation decision source is invalid."); })(),
    strategyId: exactText(record.strategyId, "strategy ID", 120, true),
    strategyRevision: exactInteger(record.strategyRevision, "strategy revision", 0, 2_147_483_647),
    maxSignalAgeSeconds: exactInteger(record.maxSignalAgeSeconds, "maximum signal age", 10, 3_600),
    effectiveUnitCapCents: nullableCents(record.effectiveUnitCapCents, "effective unit cap"),
    effectiveQuantity: exactInteger(record.effectiveQuantity, "effective quantity", 1, 99),
    effectiveAction: ["notify", "add_to_cart", "prepare_checkout", "submit_order"].includes(String(record.effectiveAction))
      ? record.effectiveAction as SignalPolicyEvaluationAttestation["effectiveAction"]
      : (() => { throw new PostgresSignalStrategyEvaluationApplyQualificationError("The evaluation action is invalid."); })(),
    sellerPolicy: record.sellerPolicy === "first_party_only" || record.sellerPolicy === "allow_third_party"
      ? record.sellerPolicy
      : (() => { throw new PostgresSignalStrategyEvaluationApplyQualificationError("The evaluation seller policy is invalid."); })(),
    fulfillment: ["shipping", "pickup", "either", "manual", "unknown"].includes(String(record.fulfillment))
      ? record.fulfillment as SignalPolicyEvaluationAttestation["fulfillment"]
      : (() => { throw new PostgresSignalStrategyEvaluationApplyQualificationError("The evaluation fulfillment is invalid."); })(),
    sourceActionRestricted: typeof record.sourceActionRestricted === "boolean"
      ? record.sourceActionRestricted
      : (() => { throw new PostgresSignalStrategyEvaluationApplyQualificationError("The source restriction is invalid."); })(),
    evaluationFingerprint: exactText(record.evaluationFingerprint, "evaluation fingerprint", 64)
  };
  if (!SHA256.test(normalized.signalTransportHash) || !SHA256.test(normalized.policyHash)
    || !SHA256.test(normalized.strategySetFingerprint) || !SHA256.test(normalized.evaluationFingerprint)
    || (normalized.strategyId === "") !== (normalized.strategyRevision === 0)
    || normalized.evaluationFingerprint !== signalPolicyEvaluationFingerprint(normalized)) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      "The PostgreSQL signal-strategy-evaluation attestation fingerprint is invalid."
    );
  }
  return normalized;
}

const PLAN_KEYS = Object.freeze([
  "contractVersion", "messageId", "payloadHash", "evaluatedAt", "validUntil",
  "eventId", "signalId", "resolutionDecisionId", "listingId", "variantId",
  "offerObservationId", "incidentId", "semanticKey", "missionId", "missionTargetId",
  "missionEvaluationQuantity", "policyRevisionId", "policyRevision", "policyHash",
  "strategySetFingerprint", "strategyCount", "evaluationFingerprint", "evaluationState",
  "evaluationReason", "decisionSource", "strategyId", "strategyRevision",
  "maxSignalAgeSeconds", "effectiveUnitCapCents", "effectiveQuantity", "effectiveAction",
  "sellerPolicy", "fulfillment", "sourceActionRestricted", "outcome", "decisionAction",
  "auditAction", "outboxAction", "mutationStatementCount", "mutationRowCount",
  "strategyEvaluationApplyWillApply", "continueDownstream", "sharedCatalogMutation",
  "missionMutation", "policyMutation", "strategyMutation", "actionMutation",
  "spendMutation", "inboxLifecycleMutation", "rawSignalPayloadReturned",
  "evaluationAuthority", "planFingerprint"
] as const);

function parseCommon(record: Record<string, unknown>) {
  const common = {
    contractVersion: exactInteger(record.contractVersion, "contract version", 1, 1) as 1,
    messageId: exactText(record.messageId, "message ID", 40),
    eventId: exactText(record.eventId, "event ID", 80),
    signalId: exactText(record.signalId, "signal ID", 160),
    resolutionDecisionId: exactText(record.resolutionDecisionId, "resolution decision ID", 80),
    listingId: exactText(record.listingId, "listing ID", 160),
    variantId: exactText(record.variantId, "variant ID", 160),
    offerObservationId: exactText(record.offerObservationId, "offer observation ID", 80),
    incidentId: exactText(record.incidentId, "incident ID", 80),
    semanticKey: exactText(record.semanticKey, "semantic key", 64),
    missionId: exactText(record.missionId, "mission ID", 160),
    missionTargetId: exactText(record.missionTargetId, "mission target ID", 160),
    missionEvaluationQuantity: exactInteger(record.missionEvaluationQuantity, "mission evaluation quantity", 1, 99),
    policyRevisionId: exactText(record.policyRevisionId, "policy revision ID", 160),
    policyRevision: exactInteger(record.policyRevision, "policy revision", 1, 2_147_483_647),
    policyHash: exactText(record.policyHash, "policy hash", 64),
    strategySetFingerprint: exactText(record.strategySetFingerprint, "strategy-set fingerprint", 64),
    strategyCount: exactInteger(record.strategyCount, "strategy count", 0, MAXIMUM_STRATEGIES),
    evaluationFingerprint: exactText(record.evaluationFingerprint, "evaluation fingerprint", 64),
    evaluationState: evaluationState(record.evaluationState),
    evaluationReason: exactText(record.evaluationReason, "evaluation reason", 500),
    decisionSource: record.decisionSource as SignalPolicyEvaluationAttestation["decisionSource"],
    strategyId: exactText(record.strategyId, "strategy ID", 120, true),
    strategyRevision: exactInteger(record.strategyRevision, "strategy revision", 0, 2_147_483_647),
    maxSignalAgeSeconds: exactInteger(record.maxSignalAgeSeconds, "maximum signal age", 10, 3_600),
    effectiveUnitCapCents: nullableCents(record.effectiveUnitCapCents, "effective unit cap"),
    effectiveQuantity: exactInteger(record.effectiveQuantity, "effective quantity", 1, 99),
    effectiveAction: record.effectiveAction as SignalPolicyEvaluationAttestation["effectiveAction"],
    sellerPolicy: record.sellerPolicy as SignalPolicyEvaluationAttestation["sellerPolicy"],
    fulfillment: record.fulfillment as SignalPolicyEvaluationAttestation["fulfillment"],
    sourceActionRestricted: strictBoolean(record.sourceActionRestricted, "source restriction"),
    outcome: outcome(record.outcome),
    decisionAction: insertAction(record.decisionAction, "decision action"),
    auditAction: insertAction(record.auditAction, "audit action"),
    outboxAction: insertAction(record.outboxAction, "outbox action"),
    mutationStatementCount: exactInteger(record.mutationStatementCount, "mutation statement count", 0, 3),
    mutationRowCount: exactInteger(record.mutationRowCount, "mutation row count", 0, 3),
    continueDownstream: strictBoolean(record.continueDownstream, "continuation flag"),
    sharedCatalogMutation: exactBoolean(record.sharedCatalogMutation, false, "shared catalog mutation"),
    missionMutation: exactBoolean(record.missionMutation, false, "mission mutation"),
    policyMutation: exactBoolean(record.policyMutation, false, "policy mutation"),
    strategyMutation: exactBoolean(record.strategyMutation, false, "strategy mutation"),
    actionMutation: exactBoolean(record.actionMutation, false, "action mutation"),
    spendMutation: exactBoolean(record.spendMutation, false, "spend mutation"),
    inboxLifecycleMutation: exactBoolean(record.inboxLifecycleMutation, false, "inbox lifecycle mutation"),
    rawSignalPayloadReturned: exactBoolean(record.rawSignalPayloadReturned, false, "raw payload projection"),
    evaluationAuthority: exactBoolean(record.evaluationAuthority, false, "evaluation authority"),
    planFingerprint: exactText(record.planFingerprint, "plan fingerprint", 64)
  };
  if (!MESSAGE_ID.test(common.messageId) || !SHA256.test(common.semanticKey)
    || !SHA256.test(common.policyHash) || !SHA256.test(common.strategySetFingerprint)
    || !SHA256.test(common.evaluationFingerprint) || !SHA256.test(common.planFingerprint)
    || !["strategy", "purchase_intent"].includes(common.decisionSource)
    || !["notify", "add_to_cart", "prepare_checkout", "submit_order"].includes(common.effectiveAction)
    || !["first_party_only", "allow_third_party"].includes(common.sellerPolicy)
    || !["shipping", "pickup", "either", "manual", "unknown"].includes(common.fulfillment)) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      "The PostgreSQL signal-strategy-evaluation projection is invalid."
    );
  }
  return common;
}

function parsePlan(
  value: unknown,
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  messageId: string,
  now: number
): PostgresSignalStrategyEvaluationApplyPlan {
  const record = exactObject(value, "plan", PLAN_KEYS);
  const common = parseCommon(record);
  const plan: PostgresSignalStrategyEvaluationApplyPlan = {
    ...common,
    payloadHash: exactText(record.payloadHash, "payload hash", 64),
    evaluatedAt: exactTimestamp(record.evaluatedAt, "evaluation timestamp"),
    validUntil: exactTimestamp(record.validUntil, "valid-until timestamp"),
    strategyEvaluationApplyWillApply: strictBoolean(
      record.strategyEvaluationApplyWillApply,
      "plan mutation flag"
    )
  };
  const terminal = (TERMINAL_STATES as readonly string[]).includes(plan.evaluationState);
  const willApply = terminal && plan.decisionAction === "insert";
  if (plan.messageId !== messageId || !SHA256.test(plan.payloadHash)
    || Math.abs(Date.parse(plan.evaluatedAt) - now) > MAXIMUM_CLOCK_SKEW_MS
    || Date.parse(plan.validUntil) - Date.parse(plan.evaluatedAt) !== MAXIMUM_PLAN_AGE_SECONDS * 1_000
    || plan.outcome !== (terminal ? plan.evaluationState : "continue_downstream")
    || plan.continueDownstream !== !terminal
    || plan.strategyEvaluationApplyWillApply !== willApply
    || plan.auditAction !== plan.decisionAction || plan.outboxAction !== plan.decisionAction
    || plan.mutationStatementCount !== (willApply ? 3 : 0)
    || plan.mutationRowCount !== (willApply ? 3 : 0)
    || plan.planFingerprint !== postgresSignalStrategyEvaluationApplyPlanFingerprint(principal, plan)) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      "The PostgreSQL signal-strategy-evaluation plan is inconsistent."
    );
  }
  return plan;
}

const RESULT_KEYS = Object.freeze([
  ...PLAN_KEYS.filter((key) => ![
    "payloadHash", "evaluatedAt", "validUntil", "strategyEvaluationApplyWillApply"
  ].includes(key)),
  "strategyEvaluationApplyApplied", "mutationAuthority", "idempotentReplay",
  "terminalDecisionMutated"
] as const);

function parseResult(
  value: unknown,
  plan: PostgresSignalStrategyEvaluationApplyPlan
): PostgresSignalStrategyEvaluationApplyResult {
  const record = exactObject(value, "apply result", RESULT_KEYS);
  const common = parseCommon(record);
  const result: PostgresSignalStrategyEvaluationApplyResult = {
    ...common,
    strategyEvaluationApplyApplied: strictBoolean(
      record.strategyEvaluationApplyApplied,
      "apply mutation flag"
    ),
    mutationAuthority: exactBoolean(record.mutationAuthority, true, "mutation authority") as true,
    idempotentReplay: exactBoolean(record.idempotentReplay, true, "idempotent replay") as true,
    terminalDecisionMutated: strictBoolean(
      record.terminalDecisionMutated,
      "terminal-decision mutation flag"
    )
  };
  const comparablePlan = {
    ...plan,
    payloadHash: undefined,
    evaluatedAt: undefined,
    validUntil: undefined,
    strategyEvaluationApplyWillApply: undefined
  } as Record<string, unknown>;
  for (const key of Object.keys(common)) {
    if (JSON.stringify(result[key as keyof typeof result]) !== JSON.stringify(comparablePlan[key])) {
      throw new PostgresSignalStrategyEvaluationApplyQualificationError(
        "The PostgreSQL signal-strategy-evaluation apply result changed after planning."
      );
    }
  }
  if (result.strategyEvaluationApplyApplied !== plan.strategyEvaluationApplyWillApply
    || result.terminalDecisionMutated !== plan.strategyEvaluationApplyWillApply) {
    throw new PostgresSignalStrategyEvaluationApplyQualificationError(
      "The PostgreSQL signal-strategy-evaluation mutation result is inconsistent."
    );
  }
  return result;
}

function boundarySpec(
  manifest: PostgresSignalStrategyEvaluationApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_strategy_evaluation_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.strategyEvaluationRole.name,
    functionName: POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalStrategyEvaluationApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_strategy_evaluation_apply_receipt",
    receiptTriggerName: "yoink_signal_strategy_evaluation_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.missionBindingApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      missionBindingApplyContractVersion: 1,
      evaluatorContractVersion: 1,
      maximumPlanAgeSeconds: 30,
      maximumStrategies: 100,
      databaseSemanticEvaluation: false,
      evaluationAuthority: false,
      runtimeAuthority: false
    }
  };
}

export type PostgresSignalStrategyEvaluationApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalStrategyEvaluationApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalStrategyEvaluationApplyManifest()
): Promise<PostgresSignalStrategyEvaluationApplyQualificationReceipt> {
  await verifyPostgresSignalMissionBindingApplyBoundary(database, manifest.predecessorManifest);
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalStrategyEvaluationApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalStrategyEvaluationApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalStrategyEvaluationApplyQualificationReceipt> {
  await verifyPostgresSignalMissionBindingApplyBoundary(database, manifest.predecessorManifest);
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

export class NodePostgresSignalStrategyEvaluationApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalStrategyEvaluationApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalStrategyEvaluationApplyManifest(),
    options: NodePostgresSignalStrategyEvaluationApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalStrategyEvaluationApplyQualificationError(
        "The PostgreSQL signal-strategy-evaluation connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_strategy_evaluation_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    logIdlePostgresClientErrors(this.pool, "yoink_postgres_signal_strategy_evaluation_qualification");
  }

  async applySignalStrategyEvaluation(
    principal: BackgroundWorkerPrincipal,
    messageIdValue: string,
    capabilityTokenValue: string,
    attestationValue: SignalPolicyEvaluationAttestation,
    now = Date.now()
  ): Promise<PostgresSignalStrategyEvaluationApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const messageId = String(messageIdValue ?? "");
    const capabilityToken = String(capabilityTokenValue ?? "");
    const attestation = validateSignalPolicyEvaluationAttestation(attestationValue);
    if (!MESSAGE_ID.test(messageId) || !CAPABILITY_TOKEN.test(capabilityToken)
      || !Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresSignalStrategyEvaluationApplyQualificationError(
        "The PostgreSQL signal-strategy-evaluation apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.strategyEvaluationRole.name)}`);
      const call = async (
        operation: "plan" | "apply",
        evaluatedAt: string,
        payload: Record<string, unknown>
      ): Promise<Record<string, unknown>> => {
        const result = await client.query<FunctionRow>(
          `SELECT result_json AS "resultJson"
           FROM ${relation(this.manifest.schemaName, POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION)}(
             $1, $2, $3, $4, $5, $6, $7
           )`,
          [tenantId, userId, operation, messageId, capabilityToken, evaluatedAt, JSON.stringify(payload)]
        );
        if (result.rows.length !== 1 || !result.rows[0]) {
          throw new PostgresSignalStrategyEvaluationApplyQualificationError(
            "The PostgreSQL signal-strategy-evaluation function returned an ambiguous result."
          );
        }
        return parseFunctionJson(result.rows[0].resultJson, `${operation} result`);
      };
      const plan = parsePlan(
        await call("plan", "", { attestation }),
        { tenantId, userId },
        messageId,
        now
      );
      const applied = parseResult(
        await call("apply", plan.evaluatedAt, {
          attestation,
          planFingerprint: plan.planFingerprint
        }),
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
