import { createHash } from "node:crypto";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  type PostgresCutoverDatabase
} from "./postgres-cutover.js";
import {
  POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_CONTRACT_VERSION,
  buildPostgresSignalStrategyEvaluationApplyManifest,
  verifyPostgresSignalStrategyEvaluationApplyBoundary,
  type PostgresSignalStrategyEvaluationApplyManifest
} from "./postgres-signal-strategy-evaluation-apply.js";
import {
  applyPostgresQualifiedFunctionBoundary,
  verifyPostgresQualifiedFunctionBoundary,
  type PostgresQualifiedFunctionBoundaryReceipt,
  type PostgresQualifiedFunctionBoundarySpec
} from "./postgres-qualified-function-boundary.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_RECEIPT_TABLE =
  "yoink_signal_writer_lock_protocol_receipt";
export const POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION =
  "yoink_lock_signal_action_constraints";
export const POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK = "11111";
export const POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_SCOPE_ORDER = Object.freeze([
  "source",
  "retailer_qualification",
  "settings",
  "mission_policy",
  "spend"
] as const);

const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text", "text"
] as const);
const FUNCTION_ARGUMENTS_SQL = `
  expected_tenant_id TEXT, expected_user_id TEXT,
  source_connection_id_input TEXT, retailer_id_input TEXT,
  mission_id_input TEXT, lock_mask TEXT
`;
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TENANT_TABLES = Object.freeze([
  "app_settings",
  "mission_intent_revisions",
  "missions",
  "retailer_adapter_qualifications",
  "source_connections",
  "spend_reservations",
  "user_spend_policies"
] as const);

export interface PostgresSignalWriterLockProtocolManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  strategyEvaluationApplyContractVersion: 1;
  schemaName: string;
  writerLockRoleNamespace: string;
  strategyEvaluationApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalStrategyEvaluationApplyManifest;
  writerLockRole: {
    kind: "signal_writer_lock_protocol_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: [];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  lockProtocolVersion: "signal_action_constraints_v1";
  lockScopeOrder: string[];
  fullLockMask: typeof POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK;
  lockScopeCount: 5;
  protectedTenantTableCount: 7;
  forcedRlsTableCount: 7;
  mutationTableCount: 0;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  sourceOwnershipValidation: true;
  missionOwnershipValidation: true;
  retailerIdentityValidation: true;
  fixedOrderAdvisoryLocks: true;
  lockOnly: true;
  configurationMutation: false;
  reservationMutation: false;
  actionSpendConsumerParity: true;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalWriterLockProtocolCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  strategyEvaluationApplyContractVersion: 1;
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
  sourceOwnershipValidation: true;
  missionOwnershipValidation: true;
  retailerIdentityValidation: true;
  fixedOrderAdvisoryLocks: true;
  lockOnly: true;
  sharedWriterLockProtocolImplemented: true;
  actionSpendConsumerParity: true;
  configurationWriterParity: false;
  reservationWriterParity: false;
  writerLockProtocolParity: false;
  lockScopeOrder: string[];
  fullLockMask: typeof POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK;
  lockScopeCount: 5;
  protectedTenantTableCount: 7;
  forcedRlsTableCount: 7;
  mutationTableCount: 0;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

let cachedCapabilityProjection: PostgresSignalWriterLockProtocolCapabilityProjection | null = null;

export class PostgresSignalWriterLockProtocolQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalWriterLockProtocolQualificationError";
  }
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function relation(schema: string, name: string): string {
  return `${identifier(schema)}.${identifier(name)}`;
}

function safeSchema(value: unknown): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresSignalWriterLockProtocolQualificationError(
      "The PostgreSQL signal writer-lock schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: unknown): string {
  const normalized = String(value ?? "yoink_writer_lock_qual").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalWriterLockProtocolQualificationError(
      "The PostgreSQL signal writer-lock role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  return `${namespace}_signal_writer_lock`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function predecessorNamespaces(manifest: PostgresSignalStrategyEvaluationApplyManifest): string[] {
  const mission = manifest.predecessorManifest;
  const predecessor = mission.predecessorManifest;
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
    mission.missionBindingApplyRoleNamespace,
    manifest.strategyEvaluationRoleNamespace
  ];
}

export function buildPostgresSignalWriterLockProtocolManifest(
  predecessorManifest = buildPostgresSignalStrategyEvaluationApplyManifest(),
  requestedRoleNamespace = "yoink_writer_lock_qual"
): PostgresSignalWriterLockProtocolManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const writerLockRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (predecessorNamespaces(predecessorManifest).includes(writerLockRoleNamespace)) {
    throw new PostgresSignalWriterLockProtocolQualificationError(
      "The PostgreSQL signal writer-lock role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalWriterLockProtocolManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    strategyEvaluationApplyContractVersion:
      POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_CONTRACT_VERSION,
    schemaName,
    writerLockRoleNamespace,
    strategyEvaluationApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    writerLockRole: {
      kind: "signal_writer_lock_protocol_boundary",
      name: roleName(writerLockRoleNamespace),
      functionName: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    lockProtocolVersion: "signal_action_constraints_v1",
    lockScopeOrder: [...POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_SCOPE_ORDER],
    fullLockMask: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK,
    lockScopeCount: 5,
    protectedTenantTableCount: 7,
    forcedRlsTableCount: 7,
    mutationTableCount: 0,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    sourceOwnershipValidation: true,
    missionOwnershipValidation: true,
    retailerIdentityValidation: true,
    fixedOrderAdvisoryLocks: true,
    lockOnly: true,
    configurationMutation: false,
    reservationMutation: false,
    actionSpendConsumerParity: true,
    configurationWriterParity: false,
    reservationWriterParity: false,
    writerLockProtocolParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function signalWriterLockProtocolFunctionSource(
  manifest = buildPostgresSignalWriterLockProtocolManifest()
): string {
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  scope_count_value BIGINT;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR lock_mask !~ '^[01]{5}$'
    OR lock_mask = '00000'
    OR (pg_catalog.substr(lock_mask, 1, 1) = '1'
      AND source_connection_id_input !~ '^[A-Za-z0-9_-]{3,160}$')
    OR (pg_catalog.substr(lock_mask, 1, 1) = '0' AND source_connection_id_input <> '')
    OR (pg_catalog.substr(lock_mask, 2, 1) = '1'
      AND retailer_id_input !~ '^[a-z0-9_-]{2,80}$')
    OR (pg_catalog.substr(lock_mask, 2, 1) = '0' AND retailer_id_input <> '')
    OR (pg_catalog.substr(lock_mask, 4, 1) = '1'
      AND mission_id_input !~ '^[A-Za-z0-9_-]{3,160}$')
    OR (pg_catalog.substr(lock_mask, 4, 1) = '0' AND mission_id_input <> '') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal writer-lock request is invalid';
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

  IF pg_catalog.substr(lock_mask, 1, 1) = '1' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'yoink_signal_writer_lock_01_source_v1:' || resolved_tenant_id || ':' ||
        resolved_user_id || ':' || source_connection_id_input, 0
    ));
    PERFORM connection.id
    FROM ${relation(manifest.schemaName, "source_connections")} AS connection
    WHERE connection.id = source_connection_id_input
      AND connection.tenant_id = resolved_tenant_id
      AND connection.user_id = resolved_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal writer-lock source ownership is invalid';
    END IF;
  END IF;

  IF pg_catalog.substr(lock_mask, 2, 1) = '1' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'yoink_signal_writer_lock_02_retailer_qualification_v1:' ||
        resolved_tenant_id || ':' || resolved_user_id || ':' || retailer_id_input, 0
    ));
    PERFORM retailer.id
    FROM ${relation(manifest.schemaName, "retailers")} AS retailer
    WHERE retailer.id = retailer_id_input;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal writer-lock retailer identity is invalid';
    END IF;
  END IF;

  IF pg_catalog.substr(lock_mask, 3, 1) = '1' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'yoink_signal_writer_lock_03_settings_v1:' || resolved_tenant_id || ':' ||
        resolved_user_id, 0
    ));
  END IF;

  IF pg_catalog.substr(lock_mask, 4, 1) = '1' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'yoink_signal_writer_lock_04_mission_policy_v1:' || resolved_tenant_id || ':' ||
        resolved_user_id || ':' || mission_id_input, 0
    ));
    PERFORM mission.id
    FROM ${relation(manifest.schemaName, "missions")} AS mission
    WHERE mission.id = mission_id_input
      AND mission.tenant_id = resolved_tenant_id
      AND mission.user_id = resolved_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal writer-lock mission ownership is invalid';
    END IF;
  END IF;

  IF pg_catalog.substr(lock_mask, 5, 1) = '1' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'yoink_signal_writer_lock_05_spend_v1:' || resolved_tenant_id || ':' ||
        resolved_user_id, 0
    ));
  END IF;

  scope_count_value := pg_catalog.length(pg_catalog.replace(lock_mask, '0', ''));
  RETURN QUERY SELECT pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'lockProtocolVersion', 'signal_action_constraints_v1',
    'lockMask', lock_mask,
    'scopeCount', scope_count_value,
    'lockScopeOrder', pg_catalog.jsonb_build_array(
      'source', 'retailer_qualification', 'settings', 'mission_policy', 'spend'
    ),
    'sourceConnectionId', source_connection_id_input,
    'retailerId', retailer_id_input,
    'missionId', mission_id_input,
    'mutationApplied', FALSE,
    'mutationAuthority', FALSE,
    'runtimeAuthority', FALSE
  )::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalWriterLockProtocolManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_writer_lock_protocol",
    schemaName: manifest.schemaName,
    roleName: manifest.writerLockRole.name,
    functionName: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalWriterLockProtocolFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_writer_lock_protocol_receipt",
    receiptTriggerName: "yoink_signal_writer_lock_protocol_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.strategyEvaluationApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      strategyEvaluationApplyContractVersion: 1,
      lockProtocolVersion: "signal_action_constraints_v1",
      lockScopeOrder: [...POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_SCOPE_ORDER],
      fullLockMask: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK,
      lockOnly: true,
      actionSpendConsumerParity: true,
      configurationWriterParity: false,
      reservationWriterParity: false,
      writerLockProtocolParity: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalWriterLockProtocolCapabilityProjection():
PostgresSignalWriterLockProtocolCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalWriterLockProtocolManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    strategyEvaluationApplyContractVersion: 1,
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
    sourceOwnershipValidation: true,
    missionOwnershipValidation: true,
    retailerIdentityValidation: true,
    fixedOrderAdvisoryLocks: true,
    lockOnly: true,
    sharedWriterLockProtocolImplemented: true,
    actionSpendConsumerParity: true,
    configurationWriterParity: false,
    reservationWriterParity: false,
    writerLockProtocolParity: false,
    lockScopeOrder: [...POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_SCOPE_ORDER],
    fullLockMask: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK,
    lockScopeCount: 5,
    protectedTenantTableCount: 7,
    forcedRlsTableCount: 7,
    mutationTableCount: 0,
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

export type PostgresSignalWriterLockProtocolQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalWriterLockProtocolBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalWriterLockProtocolManifest()
): Promise<PostgresSignalWriterLockProtocolQualificationReceipt> {
  await verifyPostgresSignalStrategyEvaluationApplyBoundary(database, manifest.predecessorManifest);
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalWriterLockProtocolBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalWriterLockProtocolManifest(),
  now = Date.now()
): Promise<PostgresSignalWriterLockProtocolQualificationReceipt> {
  await verifyPostgresSignalStrategyEvaluationApplyBoundary(database, manifest.predecessorManifest);
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}
