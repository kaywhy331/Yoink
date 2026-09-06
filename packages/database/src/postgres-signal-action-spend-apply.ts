import { spendAccountingTimeSql } from "./checkout-report-projection.js";
import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import {
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  POKEMONCENTER_ADD_ADAPTER_VERSION,
  ASUS_ADD_ADAPTER_VERSION,
  AUDIOADVICE_ADD_ADAPTER_VERSION,
  BANANAREPUBLIC_ADD_ADAPTER_VERSION,
  BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION,
  ATHLETA_ADD_ADAPTER_VERSION,
  AMERICANEAGLE_ADD_ADAPTER_VERSION,
  ANINEBING_ADD_ADAPTER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION
} from "../../contracts/src/index.js";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import { stableHash } from "../../domain/src/ids.js";
import type { SignalPolicyEvaluationAttestation } from "../../domain/src/signal-policy-evaluation.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase
} from "./postgres-cutover.js";
import {
  POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION,
  validateSignalPolicyEvaluationAttestation
} from "./postgres-signal-strategy-evaluation-apply.js";
import {
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK,
  POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION
} from "./postgres-signal-writer-lock-protocol.js";
import {
  POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_CONTRACT_VERSION,
  buildPostgresSignalConstraintConfigApplyManifest,
  verifyPostgresSignalConstraintConfigApplyBoundary,
  type PostgresSignalConstraintConfigApplyManifest
} from "./postgres-signal-constraint-config-apply.js";
import { POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION } from "./postgres-signal-resolution-apply.js";
import {
  applyPostgresQualifiedFunctionBoundary,
  verifyPostgresQualifiedFunctionBoundary,
  type PostgresQualifiedFunctionBoundaryReceipt,
  type PostgresQualifiedFunctionBoundarySpec
} from "./postgres-qualified-function-boundary.js";
import { canonicalPortabilityJson } from "./portability.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";

export const POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_ACTION_SPEND_APPLY_RECEIPT_TABLE =
  "yoink_signal_action_spend_apply_receipt";
export const POSTGRES_SIGNAL_ACTION_SPEND_APPLY_FUNCTION =
  "yoink_apply_trackalacker_signal_action_spend";

/**
 * Contract v2 — separately qualified trusted strategy action semantics.
 *
 * SQLite-truth enumeration (derived from the actual embedded runtime, not
 * re-derived from first principles), used to bound exactly what a
 * decisionSource = "strategy" request may do here:
 *
 * (a) Action kinds a strategy-owned decision may produce, in SQLite:
 *   - packages/domain/src/strategies.ts:52-55 `actionCappedByMission` caps a
 *     strategy's own `strategy.action` (notify | add_to_cart |
 *     prepare_checkout | submit_order) to "notify" whenever the mission is
 *     disabled or inactive. Otherwise the strategy's configured action passes
 *     through as `effectiveAction` (strategies.ts:122).
 *   - packages/database/src/signal-repository.ts:461-471 (`createActionJob`)
 *     then fails an "add_to_cart" attempt over to "notify" BEFORE any spend
 *     reservation exists, in *live* execution mode, whenever either:
 *       (1) the retailer's add lane is not currently qualified
 *           (`!this.addLaneQualified(listing.retailerId)`,
 *           reason code `guarded_add_lane_not_qualified`), or
 *       (2) the match requests more than one unit
 *           (`evaluation.effectiveQuantity !== 1`,
 *           reason code `guarded_add_quantity_not_supported` — this is the
 *           "live legacy multi-unit strategy adds ... fail over to
 *           notification before reservation" case; only a strategy can
 *           request quantity > 1, purchase-intent is always exactly 1, see
 *           strategies.ts:112-121 vs strategies.ts:227/242).
 *     Only after this failover does SQLite even consider spend/purchase
 *     policy (signal-repository.ts:472-509), and that policy check is itself
 *     skipped entirely once effectiveAction is already "notify"
 *     (signal-repository.ts:472 `if (effectiveAction !== "notify")`).
 *   - This boundary (v2) is deliberately NARROWER than raw SQLite: it does
 *     not attempt to replicate "add lane qualified AND quantity === 1 AND
 *     purchase/spend policy allowed" for a strategy source. Every
 *     decisionSource = "strategy" request unconditionally produces a
 *     notify-only action job here, fail-closed in SQL (see the
 *     `effective_action_value := 'notify'` assignment below, which is the
 *     ONLY place a strategy-sourced action value is ever set). Strategy
 *     decisions NEVER receive add-to-cart authority through this function,
 *     matching the caller's safety constraint even where SQLite would, under
 *     narrow conditions (lane qualified, quantity 1, policy allowed), have
 *     permitted an actual cart mutation.
 *
 * (b) Revalidation applied to a strategy-sourced request:
 *   - Strategy existence + ownership: `strategy.id = strategy_id_value` under
 *     `tenant_id = resolved_tenant_id AND user_id = resolved_user_id`
 *     (mirrors packages/database/src/postgres-signal-strategy-evaluation-apply.ts:1131-1145).
 *   - Strategy enabled + at the exact attested revision: `strategy.enabled = 1
 *     AND strategy.revision = strategy_revision_value` (same precedent file).
 *   - The mission's current policy revision must be in `decision_mode =
 *     'strategy'` (shared policy_record check, already present).
 *   - The mission target must still be active/enabled (kept as a strictly
 *     MORE conservative check than SQLite, which does not require this for a
 *     pure notify outcome — see (c) below for why tightening beyond SQLite is
 *     safe here).
 *   - The attested effective unit cap must be a bounded positive integer,
 *     re-derived against the freshly observed signal price
 *     (`derived_cap_value`) — this boundary additionally requires a numeric
 *     cap even for notify (SQLite allows a null cap for a pure notify-only
 *     strategy with no price policy); documented as a scope-narrowing choice.
 *
 * (c) Spend/reservation interaction for strategy-sourced notify jobs: NONE.
 *   SQLite only creates a spend_reservations row when
 *   `state === "awaiting_executor" && effectiveAction !== "notify"`
 *   (signal-repository.ts:594) — a notify job's `action_jobs.state` is always
 *   "notify_only" (signal-repository.ts:489-491), so `state ===
 *   "awaiting_executor"` is never true for it, and no reservation, no spend
 *   ledger entry, and no reservation link are ever created. This boundary
 *   mirrors that precisely: the spend_reservations / spend_ledger_entries
 *   inserts and the action_jobs.spend_reservation_id link update all remain
 *   inside the `decisionSource = 'purchase_intent'` branch only; a
 *   strategy-sourced action_jobs row is written with `spend_reservation_id`
 *   left NULL, and the immutable-replay check below fails closed if it is
 *   ever non-NULL for a strategy-sourced job. Because a strategy decision
 *   never reaches "awaiting_executor" here, the sibling-claim
 *   (signal-repository.ts:414/activePurchaseJobForMission, only invoked
 *   `if (purchaseRequested)`), cooldown, remaining-quantity, and periodic
 *   spend-cap checks that gate the purchase-intent add path do not apply to
 *   it either — SQLite itself skips all of them for a notify outcome.
 *
 * Since every check this boundary keeps for the strategy branch is either a
 * faithful mirror of a check SQLite already performs, or an ADDITIONAL
 * restriction (never a relaxation) versus SQLite, this is additive,
 * authority-preserving evolution: v1's purchase-intent semantics are
 * unchanged byte-for-byte, and v2 only ever narrows what a strategy decision
 * may do relative to what SQLite would already allow it to do.
 */

const MAXIMUM_CLOCK_SKEW_MS = 300_000;
const MAXIMUM_PLAN_AGE_SECONDS = 30;
const MAXIMUM_APPLY_PAYLOAD_BYTES = 8_192;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MESSAGE_ID = /^inbox_[a-f0-9]{32}$/;
const IDENTIFIER = /^[a-z][a-z0-9_]{2,159}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text", "text", "text"
] as const);
const FUNCTION_ARGUMENTS_SQL = `
  expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
  target_message_id TEXT, capability_token TEXT,
  authorization_timestamp_input TEXT, apply_payload_json TEXT
`;
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TENANT_TABLES = Object.freeze([
  "action_events",
  "action_jobs",
  "app_settings",
  "audit_events",
  "exact_offer_keys",
  "inbox_messages",
  "mission_decisions",
  "mission_intent_revisions",
  "mission_targets",
  "missions",
  "offer_snapshots",
  "outbox_events",
  "retailer_adapter_qualifications",
  "signal_events",
  "signal_incidents",
  "source_connections",
  "spend_ledger_entries",
  "spend_reservations",
  "strategies",
  "user_spend_policies"
] as const);
const MUTATION_TABLES = Object.freeze([
  "action_events",
  "action_jobs",
  "audit_events",
  "exact_offer_keys",
  "mission_decisions",
  "offer_snapshots",
  "outbox_events",
  "spend_ledger_entries",
  "spend_reservations"
] as const);

type InsertAction = "none" | "insert";
type ReuseAction = InsertAction | "reuse";

export interface PostgresSignalActionSpendApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  strategyEvaluationApplyContractVersion: 1;
  writerLockProtocolContractVersion: 1;
  constraintConfigApplyContractVersion: 1;
  schemaName: string;
  actionSpendRoleNamespace: string;
  strategyEvaluationApplyManifestFingerprint: string;
  writerLockProtocolManifestFingerprint: string;
  constraintConfigApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalConstraintConfigApplyManifest;
  actionSpendRole: {
    kind: "signal_action_spend_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_ACTION_SPEND_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  protectedTenantTableCount: 20;
  forcedRlsTableCount: 20;
  mutationTableCount: 9;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  maximumPlanAgeSeconds: 30;
  serverBoundPrincipalLookup: true;
  predecessorEvaluationRequired: true;
  messageSerialization: true;
  missionSerialization: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  constraintConfigBoundaryQualified: true;
  settingsPauseWriterParity: true;
  guardrailSettingsWriterParity: true;
  spendPolicyWriterParity: true;
  qualificationSettingsWriterParity: false;
  sourceWriterParity: false;
  retailerQualificationWriterParity: false;
  missionPolicyWriterParity: false;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  fixedOrderConfigurationLocks: true;
  currentMissionTargetRevalidation: true;
  currentPolicyRevalidation: true;
  currentSourceTrustRevalidation: true;
  currentRetailerQualificationRevalidation: true;
  currentSpendPolicyRevalidation: true;
  remainingQuantityRevalidation: true;
  siblingClaimRevalidation: true;
  cooldownRevalidation: true;
  periodicSpendRevalidation: true;
  exactProductBinding: true;
  purchaseIntentOnly: false;
  strategyActionAuthority: false;
  strategySemanticsContractVersion: 2;
  strategyDecisionSourceAccepted: true;
  strategyExistenceRevalidation: true;
  strategyFailoverToNotifyEnforced: true;
  strategyCartActionAuthority: false;
  strategyReservationAuthority: false;
  trustedStrategyActionSemanticsQualified: true;
  exactFirstPartyFulfillmentOnly: true;
  quantityOneOnly: false;
  addToCartOnly: false;
  canonicalAttributionOnly: true;
  immutableReplay: true;
  lifecycleAwareReplay: true;
  actionMutation: true;
  spendMutation: true;
  retailerMutation: false;
  checkoutMutation: false;
  orderSubmissionMutation: false;
  inboxLifecycleMutation: false;
  writerLockProtocolParity: false;
  attributionPolicyParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  mutationAuthority: true;
  actionAuthority: true;
  runtimeAuthority: false;
  activePrincipalCount: 0;
  fingerprint: string;
}

export interface PostgresSignalActionSpendCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  strategyEvaluationApplyContractVersion: 1;
  writerLockProtocolContractVersion: 1;
  constraintConfigApplyContractVersion: 1;
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
  predecessorEvaluationRequired: true;
  messageSerialization: true;
  missionSerialization: true;
  sharedWriterLockProtocolImplemented: true;
  writerLockProtocolConsumed: true;
  constraintConfigBoundaryQualified: true;
  settingsPauseWriterParity: true;
  guardrailSettingsWriterParity: true;
  spendPolicyWriterParity: true;
  qualificationSettingsWriterParity: false;
  sourceWriterParity: false;
  retailerQualificationWriterParity: false;
  missionPolicyWriterParity: false;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: false;
  twoPhasePlanApply: true;
  readCommittedTransactionAdapter: true;
  fixedOrderConfigurationLocks: true;
  currentMissionTargetRevalidation: true;
  currentPolicyRevalidation: true;
  currentSourceTrustRevalidation: true;
  currentRetailerQualificationRevalidation: true;
  currentSpendPolicyRevalidation: true;
  remainingQuantityRevalidation: true;
  siblingClaimRevalidation: true;
  cooldownRevalidation: true;
  periodicSpendRevalidation: true;
  exactProductBinding: true;
  purchaseIntentOnly: false;
  strategyActionAuthority: false;
  strategySemanticsContractVersion: 2;
  strategyDecisionSourceAccepted: true;
  strategyExistenceRevalidation: true;
  strategyFailoverToNotifyEnforced: true;
  strategyCartActionAuthority: false;
  strategyReservationAuthority: false;
  trustedStrategyActionSemanticsQualified: true;
  exactFirstPartyFulfillmentOnly: true;
  quantityOneOnly: false;
  addToCartOnly: false;
  canonicalAttributionOnly: true;
  immutableReplay: true;
  lifecycleAwareReplay: true;
  actionSpendRepositoryParity: true;
  actionMutation: true;
  spendMutation: true;
  retailerMutation: false;
  checkoutMutation: false;
  orderSubmissionMutation: false;
  inboxLifecycleMutation: false;
  writerLockProtocolParity: false;
  attributionPolicyParity: false;
  hostedDeliveryHandlerRepositoryParity: false;
  maximumPlanAgeSeconds: 30;
  protectedTenantTableCount: 20;
  forcedRlsTableCount: 20;
  mutationTableCount: 9;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  actionAuthority: true;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalActionSpendApplyPlan {
  contractVersion: 1;
  messageId: string;
  payloadHash: string;
  authorizedAt: string;
  validUntil: string;
  eventId: string;
  signalId: string;
  listingId: string;
  variantId: string;
  retailerId: string;
  retailerSku: string;
  incidentId: string;
  missionId: string;
  missionTargetId: string;
  policyRevisionId: string;
  policyRevision: number;
  policyHash: string;
  evaluationFingerprint: string;
  decisionSource: "purchase_intent" | "strategy";
  strategyId: string;
  strategyRevision: number;
  action: "add_to_cart" | "notify";
  initialJobState: "awaiting_executor" | "notify_only";
  quantity: number;
  unitPriceCents: number;
  effectiveUnitCapCents: number;
  maximumAllInCents: number;
  currency: "USD";
  sellerName: string;
  sellerType: "first_party";
  fulfillment: "shipping" | "pickup";
  offerFingerprint: string;
  expiresAt: string;
  exactOfferKeyId: string;
  exactOfferIdentityHash: string;
  offerSnapshotId: string;
  offerEvidenceHash: string;
  actionJobId: string;
  actionIdempotencyKey: string;
  actionEventId: string;
  spendReservationId: string;
  spendIdempotencyKey: string;
  spendLedgerEntryId: string;
  missionDecisionId: string;
  auditId: string;
  outboxId: string;
  exactOfferAction: ReuseAction;
  offerSnapshotAction: ReuseAction;
  actionJobAction: InsertAction;
  actionEventAction: InsertAction;
  spendReservationAction: InsertAction;
  spendLedgerAction: InsertAction;
  missionDecisionAction: InsertAction;
  auditAction: InsertAction;
  outboxAction: InsertAction;
  actionJobReservationLinkAction: InsertAction;
  mutationStatementCount: number;
  mutationRowCount: number;
  actionSpendApplyWillApply: boolean;
  immutableReplay: boolean;
  actionMutation: true;
  spendMutation: true;
  retailerMutation: false;
  checkoutMutation: false;
  orderSubmissionMutation: false;
  inboxLifecycleMutation: false;
  actionAuthority: true;
  planFingerprint: string;
}

export interface PostgresSignalActionSpendApplyResult
  extends Omit<PostgresSignalActionSpendApplyPlan,
    "payloadHash" | "authorizedAt" | "validUntil" | "actionSpendApplyWillApply"> {
  actionSpendApplyApplied: boolean;
  mutationAuthority: true;
  idempotentReplay: true;
  actionJobMutated: boolean;
  spendReservationMutated: boolean;
}

export interface NodePostgresSignalActionSpendApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection: Readonly<PostgresSignalActionSpendCapabilityProjection> | null = null;

export class PostgresSignalActionSpendApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalActionSpendApplyQualificationError";
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
    throw new PostgresSignalActionSpendApplyQualificationError(
      "The PostgreSQL signal action/spend schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      "The PostgreSQL signal action/spend role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_action_spend`;
  if (value.length > 63) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      "The PostgreSQL signal action/spend role name exceeds PostgreSQL's limit."
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function predecessorNamespaces(manifest: PostgresSignalConstraintConfigApplyManifest): string[] {
  const writerLock = manifest.predecessorManifest;
  const strategy = writerLock.predecessorManifest;
  const mission = strategy.predecessorManifest;
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
    strategy.strategyEvaluationRoleNamespace,
    writerLock.writerLockRoleNamespace,
    manifest.constraintConfigRoleNamespace
  ];
}

export function buildPostgresSignalActionSpendApplyManifest(
  predecessorManifest = buildPostgresSignalConstraintConfigApplyManifest(),
  requestedRoleNamespace = "yoink_action_spend_qual"
): PostgresSignalActionSpendApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName || POSTGRES_CUTOVER_DEFAULT_SCHEMA);
  const actionSpendRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (predecessorNamespaces(predecessorManifest).includes(actionSpendRoleNamespace)) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      "The PostgreSQL signal action/spend role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalActionSpendApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    strategyEvaluationApplyContractVersion: POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_CONTRACT_VERSION,
    writerLockProtocolContractVersion: POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_CONTRACT_VERSION,
    constraintConfigApplyContractVersion:
      POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_CONTRACT_VERSION,
    schemaName,
    actionSpendRoleNamespace,
    strategyEvaluationApplyManifestFingerprint:
      predecessorManifest.predecessorManifest.predecessorManifest.fingerprint,
    writerLockProtocolManifestFingerprint: predecessorManifest.predecessorManifest.fingerprint,
    constraintConfigApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    actionSpendRole: {
      kind: "signal_action_spend_apply_boundary",
      name: roleName(actionSpendRoleNamespace),
      functionName: POSTGRES_SIGNAL_ACTION_SPEND_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    protectedTenantTableCount: 20,
    forcedRlsTableCount: 20,
    mutationTableCount: 9,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    maximumPlanAgeSeconds: 30,
    serverBoundPrincipalLookup: true,
    predecessorEvaluationRequired: true,
    messageSerialization: true,
    missionSerialization: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    constraintConfigBoundaryQualified: true,
    settingsPauseWriterParity: true,
    guardrailSettingsWriterParity: true,
    spendPolicyWriterParity: true,
    qualificationSettingsWriterParity: false,
    sourceWriterParity: false,
    retailerQualificationWriterParity: false,
    missionPolicyWriterParity: false,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: false,
    fixedOrderConfigurationLocks: true,
    currentMissionTargetRevalidation: true,
    currentPolicyRevalidation: true,
    currentSourceTrustRevalidation: true,
    currentRetailerQualificationRevalidation: true,
    currentSpendPolicyRevalidation: true,
    remainingQuantityRevalidation: true,
    siblingClaimRevalidation: true,
    cooldownRevalidation: true,
    periodicSpendRevalidation: true,
    exactProductBinding: true,
    purchaseIntentOnly: false,
    strategyActionAuthority: false,
    strategySemanticsContractVersion: 2,
    strategyDecisionSourceAccepted: true,
    strategyExistenceRevalidation: true,
    strategyFailoverToNotifyEnforced: true,
    strategyCartActionAuthority: false,
    strategyReservationAuthority: false,
    trustedStrategyActionSemanticsQualified: true,
    exactFirstPartyFulfillmentOnly: true,
    quantityOneOnly: false,
    addToCartOnly: false,
    canonicalAttributionOnly: true,
    immutableReplay: true,
    lifecycleAwareReplay: true,
    actionMutation: true,
    spendMutation: true,
    retailerMutation: false,
    checkoutMutation: false,
    orderSubmissionMutation: false,
    inboxLifecycleMutation: false,
    writerLockProtocolParity: false,
    attributionPolicyParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    mutationAuthority: true,
    actionAuthority: true,
    runtimeAuthority: false,
    activePrincipalCount: 0
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function postgresSignalActionSpendCapabilityProjection():
PostgresSignalActionSpendCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalActionSpendApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    strategyEvaluationApplyContractVersion: 1,
    writerLockProtocolContractVersion: 1,
    constraintConfigApplyContractVersion: 1,
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
    predecessorEvaluationRequired: true,
    messageSerialization: true,
    missionSerialization: true,
    sharedWriterLockProtocolImplemented: true,
    writerLockProtocolConsumed: true,
    constraintConfigBoundaryQualified: true,
    settingsPauseWriterParity: true,
    guardrailSettingsWriterParity: true,
    spendPolicyWriterParity: true,
    qualificationSettingsWriterParity: false,
    sourceWriterParity: false,
    retailerQualificationWriterParity: false,
    missionPolicyWriterParity: false,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: false,
    twoPhasePlanApply: true,
    readCommittedTransactionAdapter: true,
    fixedOrderConfigurationLocks: true,
    currentMissionTargetRevalidation: true,
    currentPolicyRevalidation: true,
    currentSourceTrustRevalidation: true,
    currentRetailerQualificationRevalidation: true,
    currentSpendPolicyRevalidation: true,
    remainingQuantityRevalidation: true,
    siblingClaimRevalidation: true,
    cooldownRevalidation: true,
    periodicSpendRevalidation: true,
    exactProductBinding: true,
    purchaseIntentOnly: false,
    strategyActionAuthority: false,
    strategySemanticsContractVersion: 2,
    strategyDecisionSourceAccepted: true,
    strategyExistenceRevalidation: true,
    strategyFailoverToNotifyEnforced: true,
    strategyCartActionAuthority: false,
    strategyReservationAuthority: false,
    trustedStrategyActionSemanticsQualified: true,
    exactFirstPartyFulfillmentOnly: true,
    quantityOneOnly: false,
    addToCartOnly: false,
    canonicalAttributionOnly: true,
    immutableReplay: true,
    lifecycleAwareReplay: true,
    actionSpendRepositoryParity: true,
    actionMutation: true,
    spendMutation: true,
    retailerMutation: false,
    checkoutMutation: false,
    orderSubmissionMutation: false,
    inboxLifecycleMutation: false,
    writerLockProtocolParity: false,
    attributionPolicyParity: false,
    hostedDeliveryHandlerRepositoryParity: false,
    maximumPlanAgeSeconds: 30,
    protectedTenantTableCount: 20,
    forcedRlsTableCount: 20,
    mutationTableCount: 9,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: true,
    actionAuthority: true,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

export function postgresSignalActionSpendPlanFingerprint(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  plan: PostgresSignalActionSpendApplyPlan
): string {
  return stableHash(
    "postgres_signal_action_spend_apply_plan_v1",
    principal.tenantId,
    principal.userId,
    ...[
      plan.contractVersion, plan.messageId, plan.payloadHash, plan.authorizedAt,
      plan.validUntil, plan.eventId, plan.signalId, plan.listingId, plan.variantId,
      plan.retailerId, plan.retailerSku, plan.incidentId, plan.missionId,
      plan.missionTargetId, plan.policyRevisionId, plan.policyRevision,
      plan.policyHash, plan.evaluationFingerprint, plan.decisionSource,
      plan.strategyId, plan.strategyRevision, plan.action, plan.initialJobState,
      plan.quantity, plan.unitPriceCents, plan.effectiveUnitCapCents,
      plan.maximumAllInCents, plan.currency, plan.sellerName, plan.sellerType,
      plan.fulfillment, plan.offerFingerprint, plan.expiresAt,
      plan.exactOfferKeyId, plan.exactOfferIdentityHash, plan.offerSnapshotId,
      plan.offerEvidenceHash, plan.actionJobId, plan.actionIdempotencyKey,
      plan.actionEventId, plan.spendReservationId, plan.spendIdempotencyKey,
      plan.spendLedgerEntryId, plan.missionDecisionId, plan.auditId,
      plan.outboxId, plan.exactOfferAction, plan.offerSnapshotAction,
      plan.actionJobAction, plan.actionEventAction, plan.spendReservationAction,
      plan.spendLedgerAction, plan.missionDecisionAction, plan.auditAction,
      plan.outboxAction, plan.actionJobReservationLinkAction,
      plan.mutationStatementCount, plan.mutationRowCount,
      plan.actionSpendApplyWillApply ? 1 : 0, plan.immutableReplay ? 1 : 0,
      1, 1, 0, 0, 0, 0, 1
    ]
  );
}

function stableHashInputSql(parts: string[]): string {
  return parts
    .map((part) => `pg_catalog.octet_length((${part}))::text || ':' || (${part}) || '|'`)
    .join(" || ");
}

export function signalActionSpendApplyFunctionSource(
  manifest: PostgresSignalActionSpendApplyManifest
): string {
  const actionJobIdParts = stableHashInputSql([
    "'postgres_signal_action_job_v1'::text", "resolved_tenant_id", "resolved_user_id",
    "event_id_value", "attestation->>'missionId'", "attestation->>'evaluationFingerprint'"
  ]);
  const exactOfferHashParts = stableHashInputSql([
    "'postgres_exact_offer_key_v1'::text", "resolved_tenant_id", "listing_id_value",
    "variant_id_value", "retailer_id_value", "retailer_sku_value", "seller_name_value",
    "'first_party'::text", "fulfillment_value", "offer_fingerprint_value"
  ]);
  const snapshotHashParts = stableHashInputSql([
    "'postgres_offer_snapshot_v1'::text", "resolved_tenant_id", "resolved_user_id",
    "event_id_value", "mission_id_value", "policy_revision_id_value",
    "exact_offer_key_id_value", "unit_price_cents_value::text", "'1'::text",
    "maximum_all_in_cents_value::text", "offer_fingerprint_value",
    "observed_at_value", "expires_at_value"
  ]);
  const actionIdempotencyParts = stableHashInputSql([
    "'postgres_action_idempotency_v1'::text", "resolved_tenant_id", "resolved_user_id",
    "mission_id_value", "policy_revision_id_value", "incident_id_value",
    "evaluation_fingerprint_value", "effective_action_value"
  ]);
  const spendIdempotencyParts = stableHashInputSql([
    "'postgres_spend_idempotency_v1'::text", "action_idempotency_key_value"
  ]);
  const childId = (kind: string, id: string) => stableHashInputSql([
    `'${kind}'::text`, id
  ]);
  const planFingerprintParts = stableHashInputSql([
    "'postgres_signal_action_spend_apply_plan_v1'::text",
    "resolved_tenant_id", "resolved_user_id", "'1'::text", "message_id_value",
    "payload_hash_value", "authorization_timestamp", "valid_until_timestamp",
    "event_id_value", "signal_id_value", "listing_id_value", "variant_id_value",
    "retailer_id_value", "retailer_sku_value", "incident_id_value", "mission_id_value",
    "mission_target_id_value", "policy_revision_id_value", "policy_revision_value::text",
    "policy_hash_value", "evaluation_fingerprint_value", "decision_source_value",
    "strategy_id_value", "strategy_revision_value::text", "effective_action_value",
    "initial_job_state_value", "effective_quantity_value::text", "unit_price_cents_value::text",
    "effective_unit_cap_cents_value::text", "maximum_all_in_cents_value::text",
    "'USD'::text", "seller_name_value", "'first_party'::text", "fulfillment_value",
    "offer_fingerprint_value", "expires_at_value", "exact_offer_key_id_value",
    "exact_offer_identity_hash_value", "offer_snapshot_id_value", "offer_evidence_hash_value",
    "action_job_id_value", "action_idempotency_key_value", "action_event_id_value",
    "spend_reservation_id_value", "spend_idempotency_key_value", "spend_ledger_id_value",
    "mission_decision_id_value", "audit_id_value", "outbox_id_value",
    "exact_offer_action_value", "offer_snapshot_action_value", "action_job_action_value",
    "action_event_action_value", "spend_reservation_action_value", "spend_ledger_action_value",
    "mission_decision_action_value", "audit_action_value", "outbox_action_value",
    "reservation_link_action_value", "mutation_statement_count::text",
    "mutation_row_count::text", "CASE WHEN apply_will_apply THEN '1' ELSE '0' END",
    "CASE WHEN immutable_replay_value THEN '1' ELSE '0' END",
    "'1'::text", "'1'::text", "'0'::text", "'0'::text", "'0'::text", "'0'::text", "'1'::text"
  ]);
  const adapterVersionSql = `CASE retailer_id_value
    WHEN 'target' THEN '${TARGET_ADD_ADAPTER_VERSION}'
    WHEN 'walmart' THEN '${WALMART_ADD_ADAPTER_VERSION}'
    WHEN 'amazon' THEN '${AMAZON_ADD_ADAPTER_VERSION}'
    WHEN 'bestbuy' THEN '${BESTBUY_ADD_ADAPTER_VERSION}'
    WHEN 'pokemoncenter' THEN '${POKEMONCENTER_ADD_ADAPTER_VERSION}'
    WHEN 'asus' THEN '${ASUS_ADD_ADAPTER_VERSION}'
    WHEN 'audioadvice' THEN '${AUDIOADVICE_ADD_ADAPTER_VERSION}'
    WHEN 'bananarepublic' THEN '${BANANAREPUBLIC_ADD_ADAPTER_VERSION}'
    WHEN 'bananarepublicfactory' THEN '${BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION}'
    WHEN 'athleta' THEN '${ATHLETA_ADD_ADAPTER_VERSION}'
    WHEN 'americaneagle' THEN '${AMERICANEAGLE_ADD_ADAPTER_VERSION}'
    WHEN 'aninebing' THEN '${ANINEBING_ADD_ADAPTER_VERSION}'
    ELSE '' END`;
  return `
DECLARE
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  authorization_clock TIMESTAMPTZ;
  authorization_timestamp TEXT;
  valid_until_timestamp TEXT;
  request_payload JSONB;
  attestation JSONB;
  resolution_plan JSONB;
  resolution_plan_count BIGINT;
  evaluation_plan JSONB;
  evaluation_plan_count BIGINT;
  writer_lock_result JSONB;
  writer_lock_result_count BIGINT;
  message_id_value TEXT;
  payload_hash_value TEXT;
  event_id_value TEXT;
  signal_id_value TEXT;
  source_connection_id_value TEXT;
  listing_id_value TEXT;
  variant_id_value TEXT;
  retailer_id_value TEXT;
  retailer_sku_value TEXT;
  canonical_url_value TEXT;
  incident_id_value TEXT;
  mission_id_value TEXT;
  mission_target_id_value TEXT;
  policy_revision_id_value TEXT;
  policy_revision_value BIGINT;
  policy_hash_value TEXT;
  evaluation_fingerprint_value TEXT;
  decision_source_value TEXT;
  strategy_id_value TEXT;
  strategy_revision_value BIGINT;
  effective_action_value TEXT;
  effective_quantity_value BIGINT;
  initial_job_state_value TEXT;
  action_event_reason_code_value TEXT;
  action_event_message_value TEXT;
  audit_reason_code_value TEXT;
  audit_message_value TEXT;
  outbox_message_value TEXT;
  replay_decision_source_value TEXT;
  strategy_record RECORD;
  unit_price_cents_value BIGINT;
  effective_unit_cap_cents_value BIGINT;
  maximum_all_in_cents_value BIGINT;
  seller_name_value TEXT;
  fulfillment_value TEXT;
  offer_fingerprint_value TEXT;
  observed_at_value TEXT;
  expires_at_value TEXT;
  exact_offer_identity_hash_value TEXT;
  exact_offer_key_id_value TEXT;
  offer_evidence_hash_value TEXT;
  offer_snapshot_id_value TEXT;
  action_job_id_value TEXT;
  action_idempotency_key_value TEXT;
  action_event_id_value TEXT;
  spend_reservation_id_value TEXT;
  spend_idempotency_key_value TEXT;
  spend_ledger_id_value TEXT;
  mission_decision_id_value TEXT;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  expected_adapter_version_value TEXT;
  event_record RECORD;
  mission_record RECORD;
  policy_record RECORD;
  target_policy_record RECORD;
  settings_record RECORD;
  qualification_record RECORD;
  spend_policy_record RECORD;
  replay_record RECORD;
  exact_offer_record RECORD;
  snapshot_record RECORD;
  action_event_evidence_value TEXT;
  audit_data_value TEXT;
  outbox_payload_value TEXT;
  exact_offer_count BIGINT := 0;
  snapshot_count BIGINT := 0;
  action_job_count BIGINT := 0;
  partial_graph_count BIGINT := 0;
  matching_target_count BIGINT := 0;
  sibling_claim_count BIGINT := 0;
  reserved_quantity_value BIGINT := 0;
  active_reserved_cents_value BIGINT := 0;
  spent_today_cents_value BIGINT := 0;
  spent_month_cents_value BIGINT := 0;
  derived_cap_value BIGINT;
  allowance_value BIGINT;
  latest_cooldown_action TIMESTAMPTZ;
  exact_offer_action_value TEXT := 'insert';
  offer_snapshot_action_value TEXT := 'insert';
  action_job_action_value TEXT := 'insert';
  action_event_action_value TEXT := 'insert';
  spend_reservation_action_value TEXT := 'insert';
  spend_ledger_action_value TEXT := 'insert';
  mission_decision_action_value TEXT := 'insert';
  audit_action_value TEXT := 'insert';
  outbox_action_value TEXT := 'insert';
  reservation_link_action_value TEXT := 'insert';
  mutation_statement_count BIGINT := 10;
  mutation_row_count BIGINT := 10;
  apply_will_apply BOOLEAN := TRUE;
  immutable_replay_value BOOLEAN := FALSE;
  plan_fingerprint_value TEXT;
  common_value JSONB;
BEGIN
  IF expected_tenant_id = '' OR expected_user_id = ''
    OR target_message_id !~ '^inbox_[a-f0-9]{32}$'
    OR capability_token !~ '^[A-Za-z0-9_-]{43}$'
    OR operation_name NOT IN ('plan', 'apply')
    OR pg_catalog.octet_length(apply_payload_json) > ${MAXIMUM_APPLY_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal action/spend request is invalid';
  END IF;

  BEGIN
    request_payload := apply_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal action/spend payload is invalid JSON';
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal action/spend payload shape is invalid';
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
    OR pg_catalog.jsonb_typeof(attestation->'missionId') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'evaluationFingerprint') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(attestation->'signalTransportHash') IS DISTINCT FROM 'string'
    OR COALESCE(attestation->>'missionId', '') = ''
    OR COALESCE(attestation->>'evaluationFingerprint', '') !~ '^[a-f0-9]{64}$'
    OR COALESCE(attestation->>'signalTransportHash', '') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal action/spend attestation shape is invalid';
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
    'yoink_signal_action_spend_00_message_v1:' || resolved_tenant_id || ':' ||
      resolved_user_id || ':' || target_message_id, 0
  ));

  IF operation_name = 'plan' THEN
    IF authorization_timestamp_input <> '' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal action/spend plan timestamp is invalid';
    END IF;
    authorization_clock := pg_catalog.statement_timestamp();
  ELSE
    IF authorization_timestamp_input !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal action/spend timestamp is invalid';
    END IF;
    authorization_clock := authorization_timestamp_input::timestamptz;
    IF authorization_clock > pg_catalog.statement_timestamp()
      OR EXTRACT(EPOCH FROM (pg_catalog.statement_timestamp() - authorization_clock)) > ${MAXIMUM_PLAN_AGE_SECONDS} THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal action/spend plan expired before apply';
    END IF;
  END IF;
  authorization_timestamp := pg_catalog.to_char(
    authorization_clock AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  valid_until_timestamp := pg_catalog.to_char(
    (authorization_clock + INTERVAL '${MAXIMUM_PLAN_AGE_SECONDS} seconds') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  SELECT MIN(planned.result_json)::jsonb, COUNT(*)
    INTO resolution_plan, resolution_plan_count
  FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_RESOLUTION_APPLY_FUNCTION)}(
    expected_tenant_id, expected_user_id, 'plan', target_message_id,
    capability_token, '', '{}'
  ) AS planned;
  IF resolution_plan_count <> 1 OR resolution_plan IS NULL
    OR resolution_plan->>'messageId' <> target_message_id
    OR resolution_plan->>'outcome' <> 'duplicate'
    OR resolution_plan->>'duplicateEventId' !~ '^signal_event_[a-f0-9]{32}$'
    OR resolution_plan->>'payloadHash' !~ '^[a-f0-9]{64}$'
    OR resolution_plan->>'transportHash' <> attestation->>'signalTransportHash'
    OR COALESCE(resolution_plan->>'signalId', '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend capability-bound resolution discovery failed';
  END IF;
  message_id_value := resolution_plan->>'messageId';
  payload_hash_value := resolution_plan->>'payloadHash';
  event_id_value := resolution_plan->>'duplicateEventId';
  signal_id_value := resolution_plan->>'signalId';
  mission_id_value := attestation->>'missionId';
  evaluation_fingerprint_value := attestation->>'evaluationFingerprint';
  action_job_id_value := 'action_job_' || pg_catalog.substr(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${actionJobIdParts}, 'UTF8')), 'hex'
  ), 1, 32);
  action_event_id_value := 'action_event_' || pg_catalog.substr(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${childId("postgres_signal_action_event_v1", "action_job_id_value")}, 'UTF8')), 'hex'
  ), 1, 32);
  spend_reservation_id_value := 'spend_reservation_' || pg_catalog.substr(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${childId("postgres_signal_spend_reservation_v1", "action_job_id_value")}, 'UTF8')), 'hex'
  ), 1, 32);
  spend_ledger_id_value := 'spend_ledger_' || pg_catalog.substr(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${childId("postgres_signal_spend_ledger_v1", "action_job_id_value")}, 'UTF8')), 'hex'
  ), 1, 32);
  mission_decision_id_value := 'mission_decision_' || pg_catalog.substr(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${childId("postgres_signal_qualified_decision_v1", "action_job_id_value")}, 'UTF8')), 'hex'
  ), 1, 32);
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${childId("postgres_signal_action_audit_v1", "action_job_id_value")}, 'UTF8')), 'hex'
  ), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(${childId("postgres_signal_action_outbox_v1", "action_job_id_value")}, 'UTF8')), 'hex'
  ), 1, 32);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'yoink_signal_action_spend_01_mission_v1:' || resolved_tenant_id || ':' ||
      resolved_user_id || ':' || mission_id_value, 0
  ));
  SELECT COUNT(*), MIN(job.decision_source) INTO action_job_count, replay_decision_source_value
  FROM ${relation(manifest.schemaName, "action_jobs")} AS job
  WHERE job.id = action_job_id_value AND job.tenant_id = resolved_tenant_id
    AND job.user_id = resolved_user_id;
  IF action_job_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend replay identity is ambiguous';
  END IF;

  IF action_job_count = 1 AND replay_decision_source_value = 'purchase_intent' THEN
    immutable_replay_value := TRUE;
    SELECT
      job.mission_id, job.mission_target_id, job.incident_id, job.strategy_id,
      job.strategy_revision, job.decision_source, job.action, job.quantity,
      job.max_unit_price_cents, job.max_order_total_cents, job.currency,
      job.seller_policy, job.fulfillment, job.expected_seller, job.listing_id,
      job.canonical_url, job.attribution_url, job.attribution_provider,
      job.attribution_metadata_json, job.affiliate_mode, job.offer_fingerprint,
      job.idempotency_key, job.expires_at, job.intent_revision_id,
      job.exact_offer_key_id, job.offer_snapshot_id, job.spend_reservation_id,
      job.created_at AS job_created_at,
      listing.variant_id, listing.retailer_id, listing.retailer_sku,
      exact_offer.identity_hash, exact_offer.seller_name AS exact_seller_name,
      exact_offer.seller_type AS exact_seller_type,
      exact_offer.fulfillment AS exact_fulfillment,
      snapshot.evidence_hash, snapshot.unit_price_cents AS snapshot_unit_price,
      snapshot.maximum_all_in_cents AS snapshot_maximum_all_in,
      snapshot.quantity AS snapshot_quantity, snapshot.currency AS snapshot_currency,
      snapshot.seller_name AS snapshot_seller_name,
      snapshot.seller_type AS snapshot_seller_type,
      snapshot.fulfillment AS snapshot_fulfillment,
      snapshot.offer_fingerprint AS snapshot_offer_fingerprint,
      snapshot.observed_at, snapshot.expires_at AS snapshot_expires_at,
      snapshot.created_at AS snapshot_created_at,
      reservation.idempotency_key AS reservation_idempotency_key,
      reservation.action AS reservation_action, reservation.quantity AS reservation_quantity,
      reservation.reserved_amount_cents, reservation.currency AS reservation_currency,
      reservation.expires_at AS reservation_expires_at,
      reservation.created_at AS reservation_created_at,
      ledger.entry_type, ledger.reserved_delta_cents, ledger.spent_delta_cents,
      ledger.quantity_delta, ledger.currency AS ledger_currency,
      ledger.reason_code AS ledger_reason_code, ledger.correlation_id,
      ledger.created_at AS ledger_created_at,
      action_event.state AS event_state, action_event.reason_code AS event_reason_code,
      action_event.evidence_json, action_event.created_at AS event_created_at,
      decision.event_id AS decision_event_id, decision.incident_id AS decision_incident_id,
      decision.strategy_id AS decision_strategy_id,
      decision.strategy_revision AS decision_strategy_revision,
      decision.decision_source AS decision_source_stored, decision.outcome,
      decision.effective_action, decision.effective_quantity,
      decision.effective_unit_cap_cents, decision.created_at AS decision_created_at,
      audit.correlation_id AS audit_correlation_id, audit.event_type AS audit_event_type,
      audit.reason_code AS audit_reason_code, audit.data_json,
      audit.created_at AS audit_created_at,
      outbox.aggregate_type, outbox.aggregate_id, outbox.event_type AS outbox_event_type,
      outbox.payload_json, outbox.created_at AS outbox_created_at,
      policy.revision AS policy_revision, policy.policy_hash
      INTO STRICT replay_record
    FROM ${relation(manifest.schemaName, "action_jobs")} AS job
    JOIN ${relation(manifest.schemaName, "listings")} AS listing ON listing.id = job.listing_id
    JOIN ${relation(manifest.schemaName, "exact_offer_keys")} AS exact_offer
      ON exact_offer.id = job.exact_offer_key_id AND exact_offer.tenant_id = job.tenant_id
    JOIN ${relation(manifest.schemaName, "offer_snapshots")} AS snapshot
      ON snapshot.id = job.offer_snapshot_id AND snapshot.tenant_id = job.tenant_id
     AND snapshot.user_id = job.user_id
    JOIN ${relation(manifest.schemaName, "spend_reservations")} AS reservation
      ON reservation.id = job.spend_reservation_id AND reservation.action_job_id = job.id
     AND reservation.tenant_id = job.tenant_id AND reservation.user_id = job.user_id
    JOIN ${relation(manifest.schemaName, "spend_ledger_entries")} AS ledger
      ON ledger.id = spend_ledger_id_value AND ledger.reservation_id = reservation.id
     AND ledger.action_job_id = job.id
    JOIN ${relation(manifest.schemaName, "action_events")} AS action_event
      ON action_event.id = action_event_id_value AND action_event.job_id = job.id
    JOIN ${relation(manifest.schemaName, "mission_decisions")} AS decision
      ON decision.id = mission_decision_id_value AND decision.mission_id = job.mission_id
    JOIN ${relation(manifest.schemaName, "audit_events")} AS audit
      ON audit.id = audit_id_value AND audit.tenant_id = job.tenant_id
     AND audit.user_id = job.user_id
    JOIN ${relation(manifest.schemaName, "outbox_events")} AS outbox
      ON outbox.id = outbox_id_value AND outbox.tenant_id = job.tenant_id
    JOIN ${relation(manifest.schemaName, "mission_intent_revisions")} AS policy
      ON policy.id = job.intent_revision_id AND policy.mission_id = job.mission_id
    WHERE job.id = action_job_id_value AND job.tenant_id = resolved_tenant_id
      AND job.user_id = resolved_user_id;

    listing_id_value := replay_record.listing_id;
    variant_id_value := replay_record.variant_id;
    retailer_id_value := replay_record.retailer_id;
    retailer_sku_value := replay_record.retailer_sku;
    canonical_url_value := replay_record.canonical_url;
    incident_id_value := replay_record.incident_id;
    mission_target_id_value := replay_record.mission_target_id;
    policy_revision_id_value := replay_record.intent_revision_id;
    policy_revision_value := replay_record.policy_revision;
    policy_hash_value := replay_record.policy_hash;
    decision_source_value := replay_record.decision_source;
    strategy_id_value := COALESCE(replay_record.strategy_id, '');
    strategy_revision_value := COALESCE(replay_record.strategy_revision, 0);
    unit_price_cents_value := replay_record.snapshot_unit_price;
    effective_unit_cap_cents_value := replay_record.max_unit_price_cents;
    maximum_all_in_cents_value := replay_record.max_order_total_cents;
    seller_name_value := replay_record.expected_seller;
    fulfillment_value := replay_record.fulfillment;
    offer_fingerprint_value := replay_record.offer_fingerprint;
    observed_at_value := replay_record.observed_at;
    expires_at_value := replay_record.expires_at;
    exact_offer_key_id_value := replay_record.exact_offer_key_id;
    exact_offer_identity_hash_value := replay_record.identity_hash;
    offer_snapshot_id_value := replay_record.offer_snapshot_id;
    offer_evidence_hash_value := replay_record.evidence_hash;
    action_idempotency_key_value := replay_record.idempotency_key;
    spend_idempotency_key_value := replay_record.reservation_idempotency_key;
    action_event_evidence_value := replay_record.evidence_json;
    audit_data_value := replay_record.data_json;
    outbox_payload_value := replay_record.payload_json;
    IF replay_record.mission_id <> mission_id_value
      OR replay_record.action <> 'add_to_cart' OR replay_record.quantity <> 1
      OR replay_record.max_unit_price_cents IS NULL
      OR replay_record.max_order_total_cents IS NULL
      OR replay_record.currency <> 'USD'
      OR replay_record.seller_policy <> 'first_party_only'
      OR replay_record.fulfillment NOT IN ('shipping', 'pickup')
      OR replay_record.attribution_url <> replay_record.canonical_url
      OR replay_record.attribution_provider <> 'canonical'
      OR replay_record.attribution_metadata_json <> '{}'
      OR replay_record.affiliate_mode <> 'disabled'
      OR replay_record.spend_reservation_id <> spend_reservation_id_value
      OR replay_record.exact_seller_name <> replay_record.expected_seller
      OR replay_record.exact_seller_type <> 'first_party'
      OR replay_record.exact_fulfillment <> replay_record.fulfillment
      OR replay_record.snapshot_unit_price <> replay_record.max_unit_price_cents
      OR replay_record.snapshot_maximum_all_in <> replay_record.max_order_total_cents
      OR replay_record.snapshot_quantity <> 1 OR replay_record.snapshot_currency <> 'USD'
      OR replay_record.snapshot_seller_name <> replay_record.expected_seller
      OR replay_record.snapshot_seller_type <> 'first_party'
      OR replay_record.snapshot_fulfillment <> replay_record.fulfillment
      OR replay_record.snapshot_offer_fingerprint <> replay_record.offer_fingerprint
      OR replay_record.snapshot_expires_at <> replay_record.expires_at
      OR replay_record.reservation_action <> 'add_to_cart'
      OR replay_record.reservation_quantity <> 1
      OR replay_record.reserved_amount_cents <> replay_record.max_order_total_cents
      OR replay_record.reservation_currency <> 'USD'
      OR replay_record.reservation_expires_at <> replay_record.expires_at
      OR replay_record.entry_type <> 'reserved'
      OR replay_record.reserved_delta_cents <> replay_record.max_order_total_cents
      OR replay_record.spent_delta_cents <> 0 OR replay_record.quantity_delta <> 1
      OR replay_record.ledger_currency <> 'USD'
      OR replay_record.ledger_reason_code <> 'action_job_reserved'
      OR replay_record.correlation_id <> action_job_id_value
      OR replay_record.event_state <> 'awaiting_executor'
      OR replay_record.event_reason_code <> 'purchase_intent_qualified'
      OR replay_record.evidence_json::jsonb->>'boundary' <> 'postgres_signal_action_spend_v1'
      OR replay_record.evidence_json::jsonb->'evaluationAttestation' IS DISTINCT FROM attestation
      OR replay_record.decision_event_id <> event_id_value
      OR replay_record.decision_incident_id <> replay_record.incident_id
      OR COALESCE(replay_record.decision_strategy_id, '') <> COALESCE(replay_record.strategy_id, '')
      OR COALESCE(replay_record.decision_strategy_revision, 0) <> COALESCE(replay_record.strategy_revision, 0)
      OR replay_record.decision_source_stored <> replay_record.decision_source
      OR replay_record.outcome <> 'qualified'
      OR replay_record.effective_action <> 'add_to_cart'
      OR replay_record.effective_quantity <> 1
      OR replay_record.effective_unit_cap_cents <> replay_record.max_unit_price_cents
      OR replay_record.audit_correlation_id <> action_job_id_value
      OR replay_record.audit_event_type <> 'action_job_created'
      OR replay_record.audit_reason_code <> 'awaiting_executor'
      OR replay_record.data_json::jsonb->'evaluationAttestation' IS DISTINCT FROM attestation
      OR replay_record.aggregate_type <> 'action_job'
      OR replay_record.aggregate_id <> action_job_id_value
      OR replay_record.outbox_event_type <> 'action_job_created'
      OR replay_record.payload_json::jsonb->>'auditId' <> audit_id_value
      OR replay_record.job_created_at <> replay_record.snapshot_created_at
      OR replay_record.job_created_at <> replay_record.reservation_created_at
      OR replay_record.job_created_at <> replay_record.ledger_created_at
      OR replay_record.job_created_at <> replay_record.event_created_at
      OR replay_record.job_created_at <> replay_record.decision_created_at
      OR replay_record.job_created_at <> replay_record.audit_created_at
      OR replay_record.job_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend replay graph changed';
    END IF;
    effective_action_value := 'add_to_cart';
    initial_job_state_value := 'awaiting_executor';
    effective_quantity_value := 1;
  ELSIF action_job_count = 1 AND replay_decision_source_value = 'strategy' THEN
    -- Contract v2 strategy-sourced replay: mirrors the purchase-intent replay
    -- block above, but the job's spend_reservation_id is required to be NULL
    -- (a strategy decision never creates a reservation, see the module-level
    -- SQLite-truth comment block above), so the reservation/ledger tables are
    -- not joined at all here rather than joined and required non-null.
    immutable_replay_value := TRUE;
    SELECT
      job.mission_id, job.mission_target_id, job.incident_id, job.strategy_id,
      job.strategy_revision, job.decision_source, job.action, job.quantity,
      job.max_unit_price_cents, job.max_order_total_cents, job.currency,
      job.seller_policy, job.fulfillment, job.expected_seller, job.listing_id,
      job.canonical_url, job.attribution_url, job.attribution_provider,
      job.attribution_metadata_json, job.affiliate_mode, job.offer_fingerprint,
      job.idempotency_key, job.expires_at, job.intent_revision_id,
      job.exact_offer_key_id, job.offer_snapshot_id, job.spend_reservation_id,
      job.state AS job_state, job.created_at AS job_created_at,
      listing.variant_id, listing.retailer_id, listing.retailer_sku,
      exact_offer.identity_hash, exact_offer.seller_name AS exact_seller_name,
      exact_offer.seller_type AS exact_seller_type,
      exact_offer.fulfillment AS exact_fulfillment,
      snapshot.evidence_hash, snapshot.unit_price_cents AS snapshot_unit_price,
      snapshot.maximum_all_in_cents AS snapshot_maximum_all_in,
      snapshot.quantity AS snapshot_quantity, snapshot.currency AS snapshot_currency,
      snapshot.seller_name AS snapshot_seller_name,
      snapshot.seller_type AS snapshot_seller_type,
      snapshot.fulfillment AS snapshot_fulfillment,
      snapshot.offer_fingerprint AS snapshot_offer_fingerprint,
      snapshot.observed_at, snapshot.expires_at AS snapshot_expires_at,
      snapshot.created_at AS snapshot_created_at,
      action_event.state AS event_state, action_event.reason_code AS event_reason_code,
      action_event.evidence_json, action_event.created_at AS event_created_at,
      decision.event_id AS decision_event_id, decision.incident_id AS decision_incident_id,
      decision.strategy_id AS decision_strategy_id,
      decision.strategy_revision AS decision_strategy_revision,
      decision.decision_source AS decision_source_stored, decision.outcome,
      decision.effective_action, decision.effective_quantity,
      decision.effective_unit_cap_cents, decision.created_at AS decision_created_at,
      audit.correlation_id AS audit_correlation_id, audit.event_type AS audit_event_type,
      audit.reason_code AS audit_reason_code, audit.data_json,
      audit.created_at AS audit_created_at,
      outbox.aggregate_type, outbox.aggregate_id, outbox.event_type AS outbox_event_type,
      outbox.payload_json, outbox.created_at AS outbox_created_at,
      policy.revision AS policy_revision, policy.policy_hash
      INTO STRICT replay_record
    FROM ${relation(manifest.schemaName, "action_jobs")} AS job
    JOIN ${relation(manifest.schemaName, "listings")} AS listing ON listing.id = job.listing_id
    JOIN ${relation(manifest.schemaName, "exact_offer_keys")} AS exact_offer
      ON exact_offer.id = job.exact_offer_key_id AND exact_offer.tenant_id = job.tenant_id
    JOIN ${relation(manifest.schemaName, "offer_snapshots")} AS snapshot
      ON snapshot.id = job.offer_snapshot_id AND snapshot.tenant_id = job.tenant_id
     AND snapshot.user_id = job.user_id
    JOIN ${relation(manifest.schemaName, "action_events")} AS action_event
      ON action_event.id = action_event_id_value AND action_event.job_id = job.id
    JOIN ${relation(manifest.schemaName, "mission_decisions")} AS decision
      ON decision.id = mission_decision_id_value AND decision.mission_id = job.mission_id
    JOIN ${relation(manifest.schemaName, "audit_events")} AS audit
      ON audit.id = audit_id_value AND audit.tenant_id = job.tenant_id
     AND audit.user_id = job.user_id
    JOIN ${relation(manifest.schemaName, "outbox_events")} AS outbox
      ON outbox.id = outbox_id_value AND outbox.tenant_id = job.tenant_id
    JOIN ${relation(manifest.schemaName, "mission_intent_revisions")} AS policy
      ON policy.id = job.intent_revision_id AND policy.mission_id = job.mission_id
    WHERE job.id = action_job_id_value AND job.tenant_id = resolved_tenant_id
      AND job.user_id = resolved_user_id;

    listing_id_value := replay_record.listing_id;
    variant_id_value := replay_record.variant_id;
    retailer_id_value := replay_record.retailer_id;
    retailer_sku_value := replay_record.retailer_sku;
    canonical_url_value := replay_record.canonical_url;
    incident_id_value := replay_record.incident_id;
    mission_target_id_value := replay_record.mission_target_id;
    policy_revision_id_value := replay_record.intent_revision_id;
    policy_revision_value := replay_record.policy_revision;
    policy_hash_value := replay_record.policy_hash;
    decision_source_value := replay_record.decision_source;
    strategy_id_value := COALESCE(replay_record.strategy_id, '');
    strategy_revision_value := COALESCE(replay_record.strategy_revision, 0);
    effective_action_value := 'notify';
    initial_job_state_value := 'notify_only';
    effective_quantity_value := replay_record.quantity;
    unit_price_cents_value := replay_record.snapshot_unit_price;
    effective_unit_cap_cents_value := replay_record.max_unit_price_cents;
    maximum_all_in_cents_value := replay_record.max_order_total_cents;
    seller_name_value := replay_record.expected_seller;
    fulfillment_value := replay_record.fulfillment;
    offer_fingerprint_value := replay_record.offer_fingerprint;
    observed_at_value := replay_record.observed_at;
    expires_at_value := replay_record.expires_at;
    exact_offer_key_id_value := replay_record.exact_offer_key_id;
    exact_offer_identity_hash_value := replay_record.identity_hash;
    offer_snapshot_id_value := replay_record.offer_snapshot_id;
    offer_evidence_hash_value := replay_record.evidence_hash;
    action_idempotency_key_value := replay_record.idempotency_key;
    spend_idempotency_key_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      ${spendIdempotencyParts}, 'UTF8'
    )), 'hex');
    action_event_evidence_value := replay_record.evidence_json;
    audit_data_value := replay_record.data_json;
    outbox_payload_value := replay_record.payload_json;
    IF replay_record.mission_id <> mission_id_value
      OR replay_record.decision_source <> 'strategy'
      OR replay_record.strategy_id IS NULL OR replay_record.strategy_id = ''
      OR COALESCE(replay_record.strategy_revision, 0) < 1
      OR replay_record.action <> 'notify' OR replay_record.quantity NOT BETWEEN 1 AND 99
      OR replay_record.max_unit_price_cents IS NULL
      OR replay_record.max_order_total_cents IS NULL
      OR replay_record.currency <> 'USD'
      OR replay_record.seller_policy <> 'first_party_only'
      OR replay_record.fulfillment NOT IN ('shipping', 'pickup')
      OR replay_record.attribution_url <> replay_record.canonical_url
      OR replay_record.attribution_provider <> 'canonical'
      OR replay_record.attribution_metadata_json <> '{}'
      OR replay_record.affiliate_mode <> 'disabled'
      OR replay_record.spend_reservation_id IS NOT NULL
      OR replay_record.job_state <> 'notify_only'
      OR replay_record.exact_seller_name <> replay_record.expected_seller
      OR replay_record.exact_seller_type <> 'first_party'
      OR replay_record.exact_fulfillment <> replay_record.fulfillment
      OR replay_record.snapshot_quantity <> 1 OR replay_record.snapshot_currency <> 'USD'
      OR replay_record.snapshot_seller_name <> replay_record.expected_seller
      OR replay_record.snapshot_seller_type <> 'first_party'
      OR replay_record.snapshot_fulfillment <> replay_record.fulfillment
      OR replay_record.snapshot_offer_fingerprint <> replay_record.offer_fingerprint
      OR replay_record.snapshot_expires_at <> replay_record.expires_at
      OR replay_record.event_state <> 'notify_only'
      OR replay_record.event_reason_code <> 'strategy_qualified'
      OR replay_record.evidence_json::jsonb->>'boundary' <> 'postgres_signal_action_spend_v1'
      OR replay_record.evidence_json::jsonb->'evaluationAttestation' IS DISTINCT FROM attestation
      OR replay_record.decision_event_id <> event_id_value
      OR replay_record.decision_incident_id <> replay_record.incident_id
      OR COALESCE(replay_record.decision_strategy_id, '') <> COALESCE(replay_record.strategy_id, '')
      OR COALESCE(replay_record.decision_strategy_revision, 0) <> COALESCE(replay_record.strategy_revision, 0)
      OR replay_record.decision_source_stored <> replay_record.decision_source
      OR replay_record.outcome <> 'qualified'
      OR replay_record.effective_action <> 'notify'
      OR replay_record.effective_quantity <> replay_record.quantity
      OR replay_record.audit_correlation_id <> action_job_id_value
      OR replay_record.audit_event_type <> 'action_job_created'
      OR replay_record.audit_reason_code <> 'notify_only'
      OR replay_record.data_json::jsonb->'evaluationAttestation' IS DISTINCT FROM attestation
      OR replay_record.aggregate_type <> 'action_job'
      OR replay_record.aggregate_id <> action_job_id_value
      OR replay_record.outbox_event_type <> 'action_job_created'
      OR replay_record.payload_json::jsonb->>'auditId' <> audit_id_value
      OR replay_record.job_created_at <> replay_record.snapshot_created_at
      OR replay_record.job_created_at <> replay_record.event_created_at
      OR replay_record.job_created_at <> replay_record.decision_created_at
      OR replay_record.job_created_at <> replay_record.audit_created_at
      OR replay_record.job_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend replay graph changed';
    END IF;
  ELSIF action_job_count = 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend replay decision source is unsupported';
  END IF;

  IF immutable_replay_value THEN
    exact_offer_action_value := 'none';
    offer_snapshot_action_value := 'none';
    action_job_action_value := 'none';
    action_event_action_value := 'none';
    spend_reservation_action_value := 'none';
    spend_ledger_action_value := 'none';
    mission_decision_action_value := 'none';
    audit_action_value := 'none';
    outbox_action_value := 'none';
    reservation_link_action_value := 'none';
    mutation_statement_count := 0;
    mutation_row_count := 0;
    apply_will_apply := FALSE;
  ELSE
    SELECT MIN(planned.result_json)::jsonb, COUNT(*)
      INTO evaluation_plan, evaluation_plan_count
    FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION)}(
      expected_tenant_id, expected_user_id, 'plan', target_message_id,
      capability_token, '', pg_catalog.jsonb_build_object('attestation', attestation)::text
    ) AS planned;
    IF evaluation_plan_count <> 1 OR evaluation_plan IS NULL
      OR evaluation_plan->>'messageId' <> message_id_value
      OR evaluation_plan->>'payloadHash' <> payload_hash_value
      OR evaluation_plan->>'eventId' <> event_id_value
      OR evaluation_plan->>'evaluationFingerprint' <> evaluation_fingerprint_value
      OR evaluation_plan->>'evaluationState' <> 'matched'
      OR evaluation_plan->>'outcome' <> 'continue_downstream'
      OR evaluation_plan->>'continueDownstream' <> 'true'
      OR evaluation_plan->>'effectiveUnitCapCents' !~ '^[1-9][0-9]{0,8}$'
      OR evaluation_plan->>'sellerPolicy' <> 'first_party_only'
      OR evaluation_plan->>'fulfillment' NOT IN ('shipping', 'pickup')
      OR evaluation_plan->>'sourceActionRestricted' <> 'false'
      OR evaluation_plan->>'decisionAction' <> 'none'
      OR evaluation_plan->>'auditAction' <> 'none'
      OR evaluation_plan->>'outboxAction' <> 'none'
      OR evaluation_plan->>'strategyEvaluationApplyWillApply' <> 'false'
      OR evaluation_plan->>'actionMutation' <> 'false'
      OR evaluation_plan->>'spendMutation' <> 'false'
      OR evaluation_plan->>'decisionSource' NOT IN ('purchase_intent', 'strategy')
      OR (evaluation_plan->>'decisionSource' = 'purchase_intent' AND (
        evaluation_plan->>'effectiveAction' <> 'add_to_cart'
        OR evaluation_plan->>'effectiveQuantity' <> '1'
        OR evaluation_plan->>'strategyId' <> ''
        OR evaluation_plan->>'strategyRevision' <> '0'
      ))
      -- Contract v2 strategy branch: any actionable effectiveAction is
      -- accepted here (matching how SQLite's evaluator can still hand a
      -- strategy an "add_to_cart" effectiveAction), but the failover to a
      -- notify-only action is enforced unconditionally below regardless of
      -- what is attested — see the SQLite-truth comment block above this
      -- function. A bound, positive-revision strategy identity and a
      -- 1-99 quantity are required.
      OR (evaluation_plan->>'decisionSource' = 'strategy' AND (
        evaluation_plan->>'effectiveAction' NOT IN
          ('notify', 'add_to_cart', 'prepare_checkout', 'submit_order')
        OR evaluation_plan->>'effectiveQuantity' !~ '^([1-9]|[1-9][0-9])$'
        OR COALESCE(evaluation_plan->>'strategyId', '') = ''
        OR evaluation_plan->>'strategyRevision' !~ '^[1-9][0-9]*$'
      )) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend requires a current matched downstream-eligible evaluation';
    END IF;
    listing_id_value := evaluation_plan->>'listingId';
    variant_id_value := evaluation_plan->>'variantId';
    incident_id_value := evaluation_plan->>'incidentId';
    mission_target_id_value := evaluation_plan->>'missionTargetId';
    policy_revision_id_value := evaluation_plan->>'policyRevisionId';
    policy_revision_value := (evaluation_plan->>'policyRevision')::bigint;
    policy_hash_value := evaluation_plan->>'policyHash';
    decision_source_value := evaluation_plan->>'decisionSource';
    strategy_id_value := evaluation_plan->>'strategyId';
    strategy_revision_value := (evaluation_plan->>'strategyRevision')::bigint;
    effective_unit_cap_cents_value := (evaluation_plan->>'effectiveUnitCapCents')::bigint;
    effective_quantity_value := (evaluation_plan->>'effectiveQuantity')::bigint;

    SELECT signal.source_connection_id, listing.retailer_id
      INTO STRICT source_connection_id_value, retailer_id_value
    FROM ${relation(manifest.schemaName, "signal_events")} AS signal
    JOIN ${relation(manifest.schemaName, "listings")} AS listing
      ON listing.id = listing_id_value
    WHERE signal.id = event_id_value
      AND signal.tenant_id = resolved_tenant_id
      AND signal.user_id = resolved_user_id;

    SELECT MIN(lock_result.result_json)::jsonb, COUNT(*)
      INTO writer_lock_result, writer_lock_result_count
    FROM ${relation(manifest.schemaName, POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FUNCTION)}(
      expected_tenant_id, expected_user_id, source_connection_id_value,
      retailer_id_value, mission_id_value,
      '${POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK}'
    ) AS lock_result;
    IF writer_lock_result_count <> 1 OR writer_lock_result IS NULL
      OR writer_lock_result->>'contractVersion' <> '1'
      OR writer_lock_result->>'lockProtocolVersion' <> 'signal_action_constraints_v1'
      OR writer_lock_result->>'lockMask' <> '${POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_FULL_MASK}'
      OR writer_lock_result->>'scopeCount' <> '5'
      OR writer_lock_result->>'sourceConnectionId' <> source_connection_id_value
      OR writer_lock_result->>'retailerId' <> retailer_id_value
      OR writer_lock_result->>'missionId' <> mission_id_value
      OR writer_lock_result->>'mutationApplied' <> 'false'
      OR writer_lock_result->>'mutationAuthority' <> 'false'
      OR writer_lock_result->>'runtimeAuthority' <> 'false' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend shared writer-lock protocol failed';
    END IF;

    SELECT signal.signal_id, signal.source_connection_id, signal.source,
           signal.observed_at, signal.offer_json,
           source_connection.trust_level, resolution.listing_id,
           resolution.variant_id, occurrence.incident_id,
           incident.status AS incident_status, incident.unit_price_cents,
           incident.currency AS incident_currency,
           incident.seller_name AS incident_seller_name,
           incident.seller_type AS incident_seller_type,
           incident.offer_fingerprint AS incident_offer_fingerprint,
           observation.id AS observation_id,
           observation.unit_price_cents AS observation_unit_price,
           observation.currency AS observation_currency,
           observation.seller_name AS observation_seller_name,
           observation.seller_type AS observation_seller_type,
           observation.order_limit AS observation_order_limit,
           observation.offer_fingerprint AS observation_offer_fingerprint,
           observation.observed_at AS observation_observed_at,
           listing.variant_id AS listing_variant_id,
           listing.retailer_id, listing.retailer_sku, listing.canonical_url,
           listing.execution_supported, listing.msrp_cents,
           listing.currency AS listing_currency
      INTO STRICT event_record
    FROM ${relation(manifest.schemaName, "signal_events")} AS signal
    JOIN ${relation(manifest.schemaName, "source_connections")} AS source_connection
      ON source_connection.id = signal.source_connection_id
     AND source_connection.tenant_id = signal.tenant_id
     AND source_connection.user_id = signal.user_id
    JOIN ${relation(manifest.schemaName, "resolution_decisions")} AS resolution
      ON resolution.event_id = signal.id AND resolution.status = 'matched'
    JOIN ${relation(manifest.schemaName, "signal_occurrences")} AS occurrence
      ON occurrence.event_id = signal.id
    JOIN ${relation(manifest.schemaName, "signal_incidents")} AS incident
      ON incident.id = occurrence.incident_id
     AND incident.tenant_id = signal.tenant_id AND incident.user_id = signal.user_id
    JOIN ${relation(manifest.schemaName, "offer_observations")} AS observation
      ON observation.id = evaluation_plan->>'offerObservationId'
     AND observation.listing_id = resolution.listing_id
     AND observation.source_connection_id = signal.source_connection_id
     AND observation.observed_at = signal.observed_at
    JOIN ${relation(manifest.schemaName, "listings")} AS listing
      ON listing.id = resolution.listing_id
    WHERE signal.id = event_id_value AND signal.tenant_id = resolved_tenant_id
      AND signal.user_id = resolved_user_id
    FOR UPDATE OF source_connection, incident;
    IF event_record.signal_id <> signal_id_value
      OR event_record.source_connection_id <> source_connection_id_value
      OR event_record.listing_id <> listing_id_value
      OR event_record.variant_id <> variant_id_value
      OR event_record.incident_id <> incident_id_value
      OR event_record.listing_variant_id <> variant_id_value
      OR event_record.incident_status <> 'open'
      OR event_record.trust_level <> 'trusted_exact'
      OR event_record.execution_supported <> 1
      OR event_record.listing_currency <> 'USD'
      OR pg_catalog.jsonb_typeof(event_record.offer_json::jsonb->'unitPriceCents')
        IS DISTINCT FROM 'number'
      OR event_record.offer_json::jsonb->>'unitPriceCents' !~ '^[1-9][0-9]{0,8}$'
      OR event_record.offer_json::jsonb->>'availability' NOT IN ('in_stock', 'preorder')
      OR event_record.offer_json::jsonb->>'currency' <> 'USD'
      OR event_record.offer_json::jsonb->>'sellerType' <> 'first_party'
      OR event_record.offer_json::jsonb->>'fulfillment' NOT IN ('shipping', 'pickup')
      OR event_record.offer_json::jsonb->>'fulfillment' <> evaluation_plan->>'fulfillment'
      OR COALESCE(event_record.offer_json::jsonb->>'sellerName', '') = ''
      OR COALESCE(event_record.offer_json::jsonb->>'offerFingerprint', '') = '' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend exact first-party fulfillment offer is invalid';
    END IF;
    IF event_record.retailer_id <> retailer_id_value THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend retailer changed after writer locking';
    END IF;
    retailer_sku_value := event_record.retailer_sku;
    canonical_url_value := event_record.canonical_url;
    unit_price_cents_value := (event_record.offer_json::jsonb->>'unitPriceCents')::bigint;
    seller_name_value := event_record.offer_json::jsonb->>'sellerName';
    fulfillment_value := event_record.offer_json::jsonb->>'fulfillment';
    offer_fingerprint_value := event_record.offer_json::jsonb->>'offerFingerprint';
    observed_at_value := event_record.observed_at;
    IF event_record.unit_price_cents IS DISTINCT FROM unit_price_cents_value
      OR event_record.incident_currency <> 'USD'
      OR event_record.incident_seller_name <> seller_name_value
      OR event_record.incident_seller_type <> 'first_party'
      OR event_record.incident_offer_fingerprint <> offer_fingerprint_value
      OR event_record.observation_unit_price IS DISTINCT FROM unit_price_cents_value
      OR event_record.observation_currency <> 'USD'
      OR event_record.observation_seller_name <> seller_name_value
      OR event_record.observation_seller_type <> 'first_party'
      OR event_record.observation_offer_fingerprint <> offer_fingerprint_value
      OR event_record.observation_observed_at <> observed_at_value
      OR (event_record.observation_order_limit IS NOT NULL
        AND event_record.observation_order_limit < 1) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend offer evidence changed';
    END IF;

    SELECT mission.status, mission.target_quantity, mission.fulfilled_quantity,
           mission.variant_id, target.enabled, target.listing_id,
           target.max_unit_price_cents, target.currency,
           target.seller_policy, target.fulfillment
      INTO STRICT mission_record
    FROM ${relation(manifest.schemaName, "missions")} AS mission
    JOIN ${relation(manifest.schemaName, "mission_targets")} AS target
      ON target.mission_id = mission.id
    WHERE mission.id = mission_id_value AND mission.tenant_id = resolved_tenant_id
      AND mission.user_id = resolved_user_id AND target.id = mission_target_id_value
    FOR UPDATE OF mission, target;
    IF mission_record.status <> 'active' OR mission_record.enabled <> 1
      OR mission_record.variant_id <> variant_id_value
      OR mission_record.listing_id <> listing_id_value
      OR mission_record.currency <> 'USD'
      OR mission_record.target_quantity NOT BETWEEN 1 AND 99
      OR mission_record.fulfilled_quantity < 0
      OR mission_record.fulfilled_quantity >= mission_record.target_quantity THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend current mission target is not actionable';
    END IF;

    SELECT policy.id, policy.revision, policy.quantity, policy.currency,
           policy.max_all_in_cents, policy.action_ceiling, policy.decision_mode,
           policy.max_signal_age_seconds, policy.substitution_policy,
           policy.expires_at, policy.cooldown_seconds,
           policy.target_policy_json, policy.policy_hash
      INTO STRICT policy_record
    FROM ${relation(manifest.schemaName, "mission_intent_revisions")} AS policy
    WHERE policy.mission_id = mission_id_value AND policy.tenant_id = resolved_tenant_id
      AND policy.user_id = resolved_user_id
    ORDER BY policy.revision DESC LIMIT 1 FOR SHARE;
    IF policy_record.id <> policy_revision_id_value
      OR policy_record.revision <> policy_revision_value
      OR policy_record.policy_hash <> policy_hash_value
      OR policy_record.quantity <> mission_record.target_quantity
      OR policy_record.currency <> 'USD'
      OR policy_record.max_all_in_cents IS NULL
      OR policy_record.max_all_in_cents NOT BETWEEN 1 AND 100000000
      OR policy_record.decision_mode <> decision_source_value
      OR policy_record.substitution_policy <> 'exact_only'
      OR (policy_record.expires_at <> ''
        AND policy_record.expires_at::timestamptz <= authorization_clock) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend current purchase policy is not actionable';
    END IF;
    derived_cap_value := unit_price_cents_value;

    IF decision_source_value = 'purchase_intent' THEN
      IF policy_record.action_ceiling NOT IN ('add_to_cart', 'prepare_checkout', 'submit_order') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend current purchase policy is not actionable';
      END IF;
      SELECT COUNT(*) INTO matching_target_count
      FROM pg_catalog.jsonb_array_elements(policy_record.target_policy_json::jsonb) AS target(value)
      WHERE target.value->>'targetId' = mission_target_id_value
        AND target.value->>'listingId' = listing_id_value;
      IF matching_target_count <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend target policy is ambiguous';
      END IF;
      SELECT target.value->>'retailerId' AS retailer_id,
             target.value->'enabled' AS enabled,
             target.value->'maxUnitPriceCents' AS max_unit_price,
             target.value->>'sellerPolicy' AS seller_policy,
             target.value->>'fulfillment' AS fulfillment
        INTO STRICT target_policy_record
      FROM pg_catalog.jsonb_array_elements(policy_record.target_policy_json::jsonb) AS target(value)
      WHERE target.value->>'targetId' = mission_target_id_value
        AND target.value->>'listingId' = listing_id_value;
      IF target_policy_record.retailer_id <> retailer_id_value
        OR target_policy_record.enabled IS DISTINCT FROM 'true'::jsonb
        OR pg_catalog.jsonb_typeof(target_policy_record.max_unit_price)
          IS DISTINCT FROM 'number'
        OR target_policy_record.max_unit_price #>> '{}' !~ '^[1-9][0-9]{0,8}$'
        OR (target_policy_record.max_unit_price #>> '{}')::bigint < unit_price_cents_value
        OR mission_record.max_unit_price_cents IS DISTINCT FROM
          (target_policy_record.max_unit_price #>> '{}')::bigint
        OR target_policy_record.seller_policy <> 'first_party_only'
        OR target_policy_record.fulfillment <> fulfillment_value
        OR mission_record.fulfillment <> fulfillment_value THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend exact target bounds are invalid';
      END IF;

      SELECT settings.actions_paused, settings.execution_mode, settings.affiliate_mode,
             settings.tax_bps, settings.store_allowances_json
        INTO STRICT settings_record
      FROM ${relation(manifest.schemaName, "app_settings")} AS settings
      WHERE settings.user_id = resolved_user_id FOR UPDATE;
      IF settings_record.actions_paused <> 0 OR settings_record.execution_mode <> 'live'
        OR settings_record.affiliate_mode <> 'disabled'
        OR settings_record.tax_bps NOT BETWEEN 0 AND 10000
        OR pg_catalog.jsonb_typeof(settings_record.store_allowances_json::jsonb) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend live canonical execution settings are closed';
      END IF;
      IF settings_record.store_allowances_json::jsonb ? retailer_id_value THEN
        IF pg_catalog.jsonb_typeof(settings_record.store_allowances_json::jsonb->retailer_id_value) <> 'number'
          OR settings_record.store_allowances_json::jsonb->>retailer_id_value !~ '^(0|[1-9][0-9]{0,8})$' THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal action/spend store allowance is invalid';
        END IF;
        allowance_value := (settings_record.store_allowances_json::jsonb->>retailer_id_value)::bigint;
      ELSE
        allowance_value := 0;
      END IF;

      expected_adapter_version_value := ${adapterVersionSql};
      SELECT qualification.adapter_version, qualification.highest_action,
             qualification.status
        INTO qualification_record
      FROM ${relation(manifest.schemaName, "retailer_adapter_qualifications")} AS qualification
      WHERE qualification.tenant_id = resolved_tenant_id
        AND qualification.user_id = resolved_user_id
        AND qualification.retailer_id = retailer_id_value
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend retailer add lane has no current qualification';
      END IF;
      IF expected_adapter_version_value = ''
        OR qualification_record.adapter_version <> expected_adapter_version_value
        OR qualification_record.highest_action <> 'add_to_cart'
        OR qualification_record.status <> 'qualified' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend retailer add lane is not currently qualified';
      END IF;

      SELECT spend.revision, spend.currency, spend.per_order_cap_cents,
             spend.daily_cap_cents, spend.monthly_cap_cents,
             spend.order_submission_enabled
        INTO spend_policy_record
      FROM ${relation(manifest.schemaName, "user_spend_policies")} AS spend
      WHERE spend.tenant_id = resolved_tenant_id AND spend.user_id = resolved_user_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend user spend policy is unavailable';
      END IF;
      IF spend_policy_record.currency <> 'USD' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend currency is unsupported';
      END IF;

      IF strategy_id_value <> '' OR strategy_revision_value <> 0
        OR policy_record.max_signal_age_seconds <> (evaluation_plan->>'maxSignalAgeSeconds')::bigint
        OR (target_policy_record.max_unit_price #>> '{}')::bigint < unit_price_cents_value THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend requires an exact reviewed purchase-intent authorization';
      END IF;
      IF effective_unit_cap_cents_value <> derived_cap_value
        OR effective_unit_cap_cents_value <> unit_price_cents_value THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend effective unit cap was not rederived';
      END IF;
      effective_action_value := 'add_to_cart';
      initial_job_state_value := 'awaiting_executor';
      action_event_reason_code_value := 'purchase_intent_qualified';
      action_event_message_value := 'The exact first-party offer matched the saved fulfillment choice and passed current product, quantity, price, spend, cooldown, claim, and retailer-lane checks.';
      audit_reason_code_value := 'awaiting_executor';
      audit_message_value := 'A bounded first-party exact-fulfillment add-to-cart job and spend reservation were created atomically.';
      outbox_message_value := audit_message_value;

      maximum_all_in_cents_value := pg_catalog.ceil(
        effective_unit_cap_cents_value::numeric * (10000 + settings_record.tax_bps) / 10000
      )::bigint + allowance_value;
      IF maximum_all_in_cents_value NOT BETWEEN 1 AND 100000000
        OR maximum_all_in_cents_value > policy_record.max_all_in_cents
        OR (spend_policy_record.per_order_cap_cents IS NOT NULL
          AND maximum_all_in_cents_value > spend_policy_record.per_order_cap_cents) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend maximum all-in amount exceeds a current cap';
      END IF;

      PERFORM job.id FROM ${relation(manifest.schemaName, "action_jobs")} AS job
      WHERE job.mission_id = mission_id_value AND job.tenant_id = resolved_tenant_id
        AND job.user_id = resolved_user_id FOR UPDATE;
      SELECT COUNT(*) INTO sibling_claim_count
      FROM ${relation(manifest.schemaName, "action_jobs")} AS job
      WHERE job.mission_id = mission_id_value AND job.tenant_id = resolved_tenant_id
        AND job.user_id = resolved_user_id AND job.action <> 'notify'
        AND job.state NOT IN ('confirmed', 'expired', 'cancelled', 'offer_rejected', 'notify_only')
        AND (job.state IN ('manual_review', 'submission_uncertain')
          OR job.expires_at::timestamptz > authorization_clock);
      IF sibling_claim_count <> 0 THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend mission already has an active purchase claim';
      END IF;
      IF policy_record.cooldown_seconds > 0 THEN
        SELECT MAX(job.created_at::timestamptz) INTO latest_cooldown_action
        FROM ${relation(manifest.schemaName, "action_jobs")} AS job
        WHERE job.mission_id = mission_id_value AND job.tenant_id = resolved_tenant_id
          AND job.user_id = resolved_user_id AND job.action <> 'notify'
          AND job.state IN ('confirmed', 'manual_review', 'submission_uncertain');
        IF latest_cooldown_action IS NOT NULL
          AND latest_cooldown_action + (policy_record.cooldown_seconds * INTERVAL '1 second')
            > authorization_clock THEN
          RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend purchase-intent cooldown is active';
        END IF;
      END IF;

      PERFORM reservation.id FROM ${relation(manifest.schemaName, "spend_reservations")} AS reservation
      WHERE reservation.tenant_id = resolved_tenant_id AND reservation.user_id = resolved_user_id
        AND reservation.status = 'active' AND reservation.expires_at::timestamptz > authorization_clock
      FOR UPDATE;
      SELECT COALESCE(SUM(reservation.quantity), 0),
             COALESCE(SUM(reservation.reserved_amount_cents), 0)
        INTO reserved_quantity_value, active_reserved_cents_value
      FROM ${relation(manifest.schemaName, "spend_reservations")} AS reservation
      WHERE reservation.tenant_id = resolved_tenant_id AND reservation.user_id = resolved_user_id
        AND reservation.status = 'active' AND reservation.expires_at::timestamptz > authorization_clock;
      SELECT COALESCE(SUM(reservation.quantity), 0) INTO reserved_quantity_value
      FROM ${relation(manifest.schemaName, "spend_reservations")} AS reservation
      WHERE reservation.tenant_id = resolved_tenant_id AND reservation.user_id = resolved_user_id
        AND reservation.mission_id = mission_id_value
        AND reservation.status = 'active' AND reservation.expires_at::timestamptz > authorization_clock;
      IF mission_record.fulfilled_quantity + reserved_quantity_value + 1 > policy_record.quantity THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend remaining quantity is exhausted';
      END IF;
      SELECT COALESCE(SUM(ledger.spent_delta_cents), 0) INTO spent_today_cents_value
      FROM ${relation(manifest.schemaName, "spend_ledger_entries")} AS ledger
      WHERE ledger.tenant_id = resolved_tenant_id AND ledger.user_id = resolved_user_id
        AND ${spendAccountingTimeSql("postgres", "ledger")}::timestamptz >= pg_catalog.date_trunc('day', authorization_clock AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
      SELECT COALESCE(SUM(ledger.spent_delta_cents), 0) INTO spent_month_cents_value
      FROM ${relation(manifest.schemaName, "spend_ledger_entries")} AS ledger
      WHERE ledger.tenant_id = resolved_tenant_id AND ledger.user_id = resolved_user_id
        AND ${spendAccountingTimeSql("postgres", "ledger")}::timestamptz >= pg_catalog.date_trunc('month', authorization_clock AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
      SELECT COALESCE(SUM(reservation.reserved_amount_cents), 0) INTO active_reserved_cents_value
      FROM ${relation(manifest.schemaName, "spend_reservations")} AS reservation
      WHERE reservation.tenant_id = resolved_tenant_id AND reservation.user_id = resolved_user_id
        AND reservation.status = 'active' AND reservation.expires_at::timestamptz > authorization_clock;
      IF (spend_policy_record.daily_cap_cents IS NOT NULL
          AND spent_today_cents_value + active_reserved_cents_value + maximum_all_in_cents_value
            > spend_policy_record.daily_cap_cents)
        OR (spend_policy_record.monthly_cap_cents IS NOT NULL
          AND spent_month_cents_value + active_reserved_cents_value + maximum_all_in_cents_value
            > spend_policy_record.monthly_cap_cents) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend periodic spending capacity is exhausted';
      END IF;
    ELSIF decision_source_value = 'strategy' THEN
      -- Contract v2: a strategy-owned decision is revalidated against the
      -- strategies table (existence, ownership, enabled, exact attested
      -- revision) and then unconditionally, fail-closed, produces a
      -- notify-only action job. None of the purchase-intent-only gates above
      -- (retailer add-lane qualification, spend policy, sibling claim,
      -- cooldown, remaining quantity, periodic spend cap) apply — SQLite
      -- itself never evaluates any of them for a notify outcome (see the
      -- SQLite-truth comment block above this function, part (c)).
      IF strategy_id_value = '' OR strategy_revision_value < 1 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal action/spend strategy decision requires a bound strategy identity';
      END IF;
      SELECT strategy.enabled, strategy.revision
        INTO STRICT strategy_record
      FROM ${relation(manifest.schemaName, "strategies")} AS strategy
      WHERE strategy.id = strategy_id_value AND strategy.tenant_id = resolved_tenant_id
        AND strategy.user_id = resolved_user_id
      FOR SHARE;
      IF strategy_record.enabled <> 1 OR strategy_record.revision <> strategy_revision_value THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend strategy is not currently enabled at the attested revision';
      END IF;
      IF effective_unit_cap_cents_value <> derived_cap_value THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend strategy effective unit cap was not rederived';
      END IF;

      -- Fail-closed failover enforcement: this is the ONLY place a
      -- strategy-sourced action_jobs.action value is ever assigned in this
      -- function, and it is unconditionally "notify". A strategy decision
      -- can never reach the add_to_cart branch above, regardless of what
      -- effectiveAction the upstream evaluation plan attested.
      effective_action_value := 'notify';
      initial_job_state_value := 'notify_only';
      action_event_reason_code_value := 'strategy_qualified';
      action_event_message_value := 'This strategy-sourced signal was verified against current strategy, mission, and offer state; strategy decisions are limited to notifications and never receive cart or spend-reservation authority.';
      audit_reason_code_value := 'notify_only';
      audit_message_value := 'A bounded first-party exact-fulfillment notification job was created; strategy-sourced decisions never receive cart or spend-reservation authority.';
      outbox_message_value := audit_message_value;
      spend_reservation_action_value := 'none';
      spend_ledger_action_value := 'none';
      reservation_link_action_value := 'none';
      mutation_statement_count := 7;
      mutation_row_count := 7;

      maximum_all_in_cents_value := effective_unit_cap_cents_value * effective_quantity_value;
      IF maximum_all_in_cents_value NOT BETWEEN 1 AND 100000000 THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend strategy maximum all-in amount is out of bounds';
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'signal action/spend decision source is unsupported';
    END IF;

    expires_at_value := pg_catalog.to_char(LEAST(
      observed_at_value::timestamptz + ((evaluation_plan->>'maxSignalAgeSeconds')::bigint * INTERVAL '1 second'),
      authorization_clock + ((evaluation_plan->>'maxSignalAgeSeconds')::bigint * INTERVAL '1 second')
    ) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    exact_offer_identity_hash_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      ${exactOfferHashParts}, 'UTF8'
    )), 'hex');
    exact_offer_key_id_value := 'exact_offer_key_' || pg_catalog.substr(exact_offer_identity_hash_value, 1, 32);
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'yoink_signal_action_spend_06_exact_offer_v1:' || resolved_tenant_id || ':' ||
        exact_offer_identity_hash_value, 0
    ));
    offer_evidence_hash_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      ${snapshotHashParts}, 'UTF8'
    )), 'hex');
    offer_snapshot_id_value := 'offer_snapshot_' || pg_catalog.substr(offer_evidence_hash_value, 1, 32);
    action_idempotency_key_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      ${actionIdempotencyParts}, 'UTF8'
    )), 'hex');
    spend_idempotency_key_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      ${spendIdempotencyParts}, 'UTF8'
    )), 'hex');
    SELECT COUNT(*) INTO exact_offer_count
    FROM ${relation(manifest.schemaName, "exact_offer_keys")} AS exact_offer
    WHERE exact_offer.tenant_id = resolved_tenant_id
      AND (exact_offer.id = exact_offer_key_id_value
        OR exact_offer.identity_hash = exact_offer_identity_hash_value);
    IF exact_offer_count = 1 THEN
      SELECT exact_offer.* INTO STRICT exact_offer_record
      FROM ${relation(manifest.schemaName, "exact_offer_keys")} AS exact_offer
      WHERE exact_offer.tenant_id = resolved_tenant_id
        AND exact_offer.identity_hash = exact_offer_identity_hash_value;
      IF exact_offer_record.id <> exact_offer_key_id_value
        OR exact_offer_record.listing_id <> listing_id_value
        OR exact_offer_record.retailer_id <> retailer_id_value
        OR exact_offer_record.retailer_sku <> retailer_sku_value
        OR exact_offer_record.child_offer_key <> ''
        OR exact_offer_record.attributes_json <> '{}'
        OR exact_offer_record.condition_code <> 'new'
        OR exact_offer_record.seller_name <> seller_name_value
        OR exact_offer_record.seller_key <> pg_catalog.lower(pg_catalog.btrim(seller_name_value))
        OR exact_offer_record.seller_type <> 'first_party'
        OR exact_offer_record.fulfillment <> fulfillment_value
        OR exact_offer_record.region_scope <> '' OR exact_offer_record.store_scope <> '' THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend exact-offer identity changed';
      END IF;
      exact_offer_action_value := 'reuse';
      mutation_statement_count := mutation_statement_count - 1;
      mutation_row_count := mutation_row_count - 1;
    ELSIF exact_offer_count <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend exact-offer identity is ambiguous';
    END IF;
    SELECT COUNT(*) INTO snapshot_count
    FROM ${relation(manifest.schemaName, "offer_snapshots")} AS snapshot
    WHERE snapshot.tenant_id = resolved_tenant_id AND snapshot.user_id = resolved_user_id
      AND (snapshot.id = offer_snapshot_id_value OR snapshot.evidence_hash = offer_evidence_hash_value);
    IF snapshot_count <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend orphan offer snapshot exists';
    END IF;
    SELECT (
      SELECT COUNT(*) FROM ${relation(manifest.schemaName, "action_jobs")}
      WHERE tenant_id = resolved_tenant_id AND user_id = resolved_user_id
        AND (id = action_job_id_value OR idempotency_key = action_idempotency_key_value)
    ) + (
      SELECT COUNT(*) FROM ${relation(manifest.schemaName, "action_events")}
      WHERE id = action_event_id_value
    ) + (
      SELECT COUNT(*) FROM ${relation(manifest.schemaName, "spend_reservations")}
      WHERE tenant_id = resolved_tenant_id AND user_id = resolved_user_id
        AND (id = spend_reservation_id_value OR idempotency_key = spend_idempotency_key_value)
    ) + (
      SELECT COUNT(*) FROM ${relation(manifest.schemaName, "spend_ledger_entries")}
      WHERE id = spend_ledger_id_value
    ) + (
      SELECT COUNT(*) FROM ${relation(manifest.schemaName, "mission_decisions")}
      WHERE id = mission_decision_id_value OR (event_id = event_id_value AND mission_id = mission_id_value)
    ) + (
      SELECT COUNT(*) FROM ${relation(manifest.schemaName, "audit_events")}
      WHERE id = audit_id_value
    ) + (
      SELECT COUNT(*) FROM ${relation(manifest.schemaName, "outbox_events")}
      WHERE id = outbox_id_value
    ) INTO partial_graph_count;
    IF partial_graph_count <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend graph is partial';
    END IF;
    action_event_evidence_value := pg_catalog.jsonb_build_object(
      'boundary', 'postgres_signal_action_spend_v1',
      'evaluationAttestation', attestation,
      'exactOfferKeyId', exact_offer_key_id_value,
      'offerSnapshotId', offer_snapshot_id_value,
      'spendReservationId', spend_reservation_id_value
    )::text;
    audit_data_value := pg_catalog.jsonb_build_object(
      'missionId', mission_id_value,
      'incidentId', incident_id_value,
      'listingId', listing_id_value,
      'spendReservationId', spend_reservation_id_value,
      'maximumAllInCents', maximum_all_in_cents_value,
      'evaluationAttestation', attestation
    )::text;
    outbox_payload_value := pg_catalog.jsonb_build_object(
      'auditId', audit_id_value,
      'correlationId', action_job_id_value,
      'reasonCode', audit_reason_code_value,
      'message', outbox_message_value,
      'data', audit_data_value::jsonb
    )::text;
  END IF;
  plan_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    ${planFingerprintParts}, 'UTF8'
  )), 'hex');
  common_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'messageId', message_id_value,
    'eventId', event_id_value,
    'signalId', signal_id_value,
    'listingId', listing_id_value,
    'variantId', variant_id_value,
    'retailerId', retailer_id_value,
    'retailerSku', retailer_sku_value,
    'incidentId', incident_id_value,
    'missionId', mission_id_value,
    'missionTargetId', mission_target_id_value,
    'policyRevisionId', policy_revision_id_value,
    'policyRevision', policy_revision_value,
    'policyHash', policy_hash_value,
    'evaluationFingerprint', evaluation_fingerprint_value,
    'decisionSource', decision_source_value,
    'strategyId', strategy_id_value,
    'strategyRevision', strategy_revision_value,
    'action', effective_action_value,
    'initialJobState', initial_job_state_value
  ) || pg_catalog.jsonb_build_object(
    'quantity', effective_quantity_value,
    'unitPriceCents', unit_price_cents_value,
    'effectiveUnitCapCents', effective_unit_cap_cents_value,
    'maximumAllInCents', maximum_all_in_cents_value,
    'currency', 'USD',
    'sellerName', seller_name_value,
    'sellerType', 'first_party',
    'fulfillment', fulfillment_value,
    'offerFingerprint', offer_fingerprint_value,
    'expiresAt', expires_at_value,
    'exactOfferKeyId', exact_offer_key_id_value,
    'exactOfferIdentityHash', exact_offer_identity_hash_value,
    'offerSnapshotId', offer_snapshot_id_value,
    'offerEvidenceHash', offer_evidence_hash_value,
    'actionJobId', action_job_id_value,
    'actionIdempotencyKey', action_idempotency_key_value,
    'actionEventId', action_event_id_value,
    'spendReservationId', spend_reservation_id_value,
    'spendIdempotencyKey', spend_idempotency_key_value,
    'spendLedgerEntryId', spend_ledger_id_value
  ) || pg_catalog.jsonb_build_object(
    'missionDecisionId', mission_decision_id_value,
    'auditId', audit_id_value,
    'outboxId', outbox_id_value,
    'exactOfferAction', exact_offer_action_value,
    'offerSnapshotAction', offer_snapshot_action_value,
    'actionJobAction', action_job_action_value,
    'actionEventAction', action_event_action_value,
    'spendReservationAction', spend_reservation_action_value,
    'spendLedgerAction', spend_ledger_action_value,
    'missionDecisionAction', mission_decision_action_value,
    'auditAction', audit_action_value,
    'outboxAction', outbox_action_value,
    'actionJobReservationLinkAction', reservation_link_action_value,
    'mutationStatementCount', mutation_statement_count,
    'mutationRowCount', mutation_row_count,
    'immutableReplay', immutable_replay_value,
    'actionMutation', TRUE,
    'spendMutation', TRUE,
    'retailerMutation', FALSE,
    'checkoutMutation', FALSE,
    'orderSubmissionMutation', FALSE,
    'inboxLifecycleMutation', FALSE,
    'actionAuthority', TRUE,
    'planFingerprint', plan_fingerprint_value
  );
  IF operation_name = 'plan' THEN
    RETURN QUERY SELECT (common_value || pg_catalog.jsonb_build_object(
      'payloadHash', payload_hash_value,
      'authorizedAt', authorization_timestamp,
      'validUntil', valid_until_timestamp,
      'actionSpendApplyWillApply', apply_will_apply
    ))::text;
    RETURN;
  END IF;
  IF request_payload->>'planFingerprint' <> plan_fingerprint_value THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend apply does not match its locked plan';
  END IF;

  IF apply_will_apply THEN
    IF exact_offer_action_value = 'insert' THEN
      INSERT INTO ${relation(manifest.schemaName, "exact_offer_keys")}(
        id, tenant_id, listing_id, retailer_id, retailer_sku,
        child_offer_key, attributes_json, condition_code, seller_name,
        seller_key, seller_type, fulfillment, region_scope, store_scope,
        identity_hash, created_at
      ) VALUES (
        exact_offer_key_id_value, resolved_tenant_id, listing_id_value,
        retailer_id_value, retailer_sku_value, '', '{}', 'new', seller_name_value,
        pg_catalog.lower(pg_catalog.btrim(seller_name_value)), 'first_party',
        fulfillment_value, '', '', exact_offer_identity_hash_value, authorization_timestamp
      );
    END IF;
    IF offer_snapshot_action_value = 'insert' THEN
      INSERT INTO ${relation(manifest.schemaName, "offer_snapshots")}(
        id, tenant_id, user_id, mission_id, intent_revision_id,
        exact_offer_key_id, listing_id, source_observation_id, incident_id,
        availability, unit_price_cents, quantity, item_subtotal_cents,
        maximum_all_in_cents, currency, seller_name, seller_type,
        fulfillment, offer_fingerprint, evidence_hash, observed_at,
        expires_at, created_at
      ) VALUES (
        offer_snapshot_id_value, resolved_tenant_id, resolved_user_id,
        mission_id_value, policy_revision_id_value, exact_offer_key_id_value,
        listing_id_value, event_record.observation_id, incident_id_value,
        event_record.offer_json::jsonb->>'availability', unit_price_cents_value,
        1, unit_price_cents_value, maximum_all_in_cents_value, 'USD',
        seller_name_value, 'first_party', fulfillment_value, offer_fingerprint_value,
        offer_evidence_hash_value, observed_at_value, expires_at_value,
        authorization_timestamp
      );
    END IF;
    INSERT INTO ${relation(manifest.schemaName, "action_jobs")}(
      id, tenant_id, user_id, mission_id, mission_target_id, incident_id,
      strategy_id, strategy_revision, decision_source, state, action, quantity,
      max_unit_price_cents, max_order_total_cents, currency, seller_policy,
      fulfillment, expected_seller, listing_id, canonical_url, attribution_url,
      attribution_provider, attribution_metadata_json, affiliate_mode,
      offer_fingerprint, idempotency_key, capability_nonce_hash,
      expires_at, created_at, updated_at, intent_revision_id,
      exact_offer_key_id, offer_snapshot_id
    ) VALUES (
      action_job_id_value, resolved_tenant_id, resolved_user_id,
      mission_id_value, mission_target_id_value, incident_id_value,
      NULLIF(strategy_id_value, ''), NULLIF(strategy_revision_value, 0),
      decision_source_value, initial_job_state_value, effective_action_value,
      effective_quantity_value,
      effective_unit_cap_cents_value, maximum_all_in_cents_value, 'USD',
      'first_party_only', fulfillment_value, seller_name_value, listing_id_value,
      canonical_url_value, canonical_url_value, 'canonical', '{}', 'disabled',
      offer_fingerprint_value, action_idempotency_key_value,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        ${stableHashInputSql([
          "'postgres_action_capability_nonce_v1'::text", "capability_token", "action_job_id_value"
        ])}, 'UTF8'
      )), 'hex'),
      expires_at_value, authorization_timestamp, authorization_timestamp,
      policy_revision_id_value, exact_offer_key_id_value, offer_snapshot_id_value
    );
    INSERT INTO ${relation(manifest.schemaName, "action_events")}(
      id, job_id, state, reason_code, message, evidence_json, created_at
    ) VALUES (
      action_event_id_value, action_job_id_value, initial_job_state_value,
      action_event_reason_code_value,
      action_event_message_value,
      action_event_evidence_value, authorization_timestamp
    );
    IF decision_source_value = 'purchase_intent' THEN
      INSERT INTO ${relation(manifest.schemaName, "spend_reservations")}(
        id, tenant_id, user_id, mission_id, intent_revision_id,
        exact_offer_key_id, offer_snapshot_id, action_job_id, idempotency_key,
        action, quantity, reserved_amount_cents, committed_amount_cents,
        currency, status, release_reason, expires_at, created_at, updated_at
      ) VALUES (
        spend_reservation_id_value, resolved_tenant_id, resolved_user_id,
        mission_id_value, policy_revision_id_value, exact_offer_key_id_value,
        offer_snapshot_id_value, action_job_id_value, spend_idempotency_key_value,
        'add_to_cart', 1, maximum_all_in_cents_value, 0, 'USD', 'active', '',
        expires_at_value, authorization_timestamp, authorization_timestamp
      );
      UPDATE ${relation(manifest.schemaName, "action_jobs")}
      SET spend_reservation_id = spend_reservation_id_value,
          updated_at = authorization_timestamp
      WHERE id = action_job_id_value AND tenant_id = resolved_tenant_id
        AND user_id = resolved_user_id AND spend_reservation_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal action/spend reservation link changed';
      END IF;
      INSERT INTO ${relation(manifest.schemaName, "spend_ledger_entries")}(
        id, tenant_id, user_id, reservation_id, action_job_id, entry_type,
        reserved_delta_cents, spent_delta_cents, quantity_delta, currency,
        reason_code, correlation_id, metadata_json, created_at
      ) VALUES (
        spend_ledger_id_value, resolved_tenant_id, resolved_user_id,
        spend_reservation_id_value, action_job_id_value, 'reserved',
        maximum_all_in_cents_value, 0, 1, 'USD', 'action_job_reserved',
        action_job_id_value, '{}', authorization_timestamp
      );
    END IF;
    INSERT INTO ${relation(manifest.schemaName, "mission_decisions")}(
      id, event_id, incident_id, mission_id, strategy_id, strategy_revision,
      decision_source, outcome, reason, effective_action, effective_quantity,
      effective_unit_cap_cents, created_at
    ) VALUES (
      mission_decision_id_value, event_id_value, incident_id_value,
      mission_id_value, NULLIF(strategy_id_value, ''),
      NULLIF(strategy_revision_value, 0), decision_source_value, 'qualified',
      attestation->>'reason', effective_action_value, effective_quantity_value,
      effective_unit_cap_cents_value, authorization_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
      id, tenant_id, user_id, correlation_id, event_type,
      reason_code, message, data_json, created_at
    ) VALUES (
      audit_id_value, resolved_tenant_id, resolved_user_id,
      action_job_id_value, 'action_job_created', audit_reason_code_value,
      audit_message_value,
      audit_data_value, authorization_timestamp
    );
    INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
      id, tenant_id, aggregate_type, aggregate_id, event_type,
      payload_json, created_at, delivered_at, updated_at
    ) VALUES (
      outbox_id_value, resolved_tenant_id, 'action_job', action_job_id_value,
      'action_job_created', outbox_payload_value, authorization_timestamp, '',
      authorization_timestamp
    );
  END IF;
  RETURN QUERY SELECT (common_value || pg_catalog.jsonb_build_object(
    'actionSpendApplyApplied', apply_will_apply,
    'mutationAuthority', TRUE,
    'idempotentReplay', TRUE,
    'actionJobMutated', apply_will_apply,
    'spendReservationMutated', apply_will_apply AND decision_source_value = 'purchase_intent'
  ))::text;
END
`;
}

function exactInteger(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      `The PostgreSQL signal action/spend ${label} is invalid.`
    );
  }
  return normalized;
}

function exactText(value: unknown, label: string, maximum = 500, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || value !== value.trim()
    || (!allowEmpty && value.length === 0) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      `The PostgreSQL signal action/spend ${label} is invalid.`
    );
  }
  return value;
}

function exactTimestamp(value: unknown, label: string): string {
  const normalized = exactText(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)
    || Number.isNaN(Date.parse(normalized))) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      `The PostgreSQL signal action/spend ${label} is invalid.`
    );
  }
  return normalized;
}

function strictBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new PostgresSignalActionSpendApplyQualificationError(
      `The PostgreSQL signal action/spend ${label} is invalid.`
    );
  }
  return value;
}

function exactBoolean(value: unknown, expected: boolean, label: string): boolean {
  if (value !== expected) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      `The PostgreSQL signal action/spend ${label} is invalid.`
    );
  }
  return expected;
}

function exactObject(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      `The PostgreSQL signal action/spend ${label} is invalid.`
    );
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\n") !== [...keys].sort().join("\n")) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      `The PostgreSQL signal action/spend ${label} shape is invalid.`
    );
  }
  return record;
}

function parseFunctionJson(value: unknown, label: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch { parsed = null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      `The PostgreSQL signal action/spend ${label} is invalid.`
    );
  }
  return parsed as Record<string, unknown>;
}

function insertAction(value: unknown, label: string): InsertAction {
  if (value !== "none" && value !== "insert") {
    throw new PostgresSignalActionSpendApplyQualificationError(
      `The PostgreSQL signal action/spend ${label} is invalid.`
    );
  }
  return value;
}

function reuseAction(value: unknown, label: string): ReuseAction {
  if (value !== "none" && value !== "insert" && value !== "reuse") {
    throw new PostgresSignalActionSpendApplyQualificationError(
      `The PostgreSQL signal action/spend ${label} is invalid.`
    );
  }
  return value;
}

const PLAN_KEYS = Object.freeze([
  "contractVersion", "messageId", "payloadHash", "authorizedAt", "validUntil",
  "eventId", "signalId", "listingId", "variantId", "retailerId", "retailerSku",
  "incidentId", "missionId", "missionTargetId", "policyRevisionId", "policyRevision",
  "policyHash", "evaluationFingerprint", "decisionSource", "strategyId",
  "strategyRevision", "action", "initialJobState", "quantity", "unitPriceCents",
  "effectiveUnitCapCents", "maximumAllInCents", "currency", "sellerName",
  "sellerType", "fulfillment", "offerFingerprint", "expiresAt", "exactOfferKeyId",
  "exactOfferIdentityHash", "offerSnapshotId", "offerEvidenceHash", "actionJobId",
  "actionIdempotencyKey", "actionEventId", "spendReservationId", "spendIdempotencyKey",
  "spendLedgerEntryId", "missionDecisionId", "auditId", "outboxId", "exactOfferAction",
  "offerSnapshotAction", "actionJobAction", "actionEventAction", "spendReservationAction",
  "spendLedgerAction", "missionDecisionAction", "auditAction", "outboxAction",
  "actionJobReservationLinkAction", "mutationStatementCount", "mutationRowCount",
  "actionSpendApplyWillApply", "immutableReplay", "actionMutation", "spendMutation",
  "retailerMutation", "checkoutMutation", "orderSubmissionMutation",
  "inboxLifecycleMutation", "actionAuthority", "planFingerprint"
] as const);

function parseCommon(record: Record<string, unknown>) {
  const common = {
    contractVersion: exactInteger(record.contractVersion, "contract version", 1, 1) as 1,
    messageId: exactText(record.messageId, "message ID", 40),
    eventId: exactText(record.eventId, "event ID", 160),
    signalId: exactText(record.signalId, "signal ID", 160),
    listingId: exactText(record.listingId, "listing ID", 160),
    variantId: exactText(record.variantId, "variant ID", 160),
    retailerId: exactText(record.retailerId, "retailer ID", 60),
    retailerSku: exactText(record.retailerSku, "retailer SKU", 160),
    incidentId: exactText(record.incidentId, "incident ID", 160),
    missionId: exactText(record.missionId, "mission ID", 160),
    missionTargetId: exactText(record.missionTargetId, "mission target ID", 160),
    policyRevisionId: exactText(record.policyRevisionId, "policy revision ID", 160),
    policyRevision: exactInteger(record.policyRevision, "policy revision", 1, 2_147_483_647),
    policyHash: exactText(record.policyHash, "policy hash", 64),
    evaluationFingerprint: exactText(record.evaluationFingerprint, "evaluation fingerprint", 64),
    decisionSource: record.decisionSource as "purchase_intent" | "strategy",
    strategyId: exactText(record.strategyId, "strategy ID", 120, true),
    strategyRevision: exactInteger(record.strategyRevision, "strategy revision", 0, 2_147_483_647),
    action: record.action as "add_to_cart" | "notify",
    initialJobState: record.initialJobState as "awaiting_executor" | "notify_only",
    quantity: exactInteger(record.quantity, "quantity", 1, 99),
    unitPriceCents: exactInteger(record.unitPriceCents, "unit price", 1, 100_000_000),
    effectiveUnitCapCents: exactInteger(record.effectiveUnitCapCents, "effective unit cap", 1, 100_000_000),
    maximumAllInCents: exactInteger(record.maximumAllInCents, "maximum all-in amount", 1, 100_000_000),
    currency: record.currency as "USD",
    sellerName: exactText(record.sellerName, "seller name", 160),
    sellerType: record.sellerType as "first_party",
    fulfillment: record.fulfillment as "shipping" | "pickup",
    offerFingerprint: exactText(record.offerFingerprint, "offer fingerprint", 256),
    expiresAt: exactTimestamp(record.expiresAt, "expiry timestamp"),
    exactOfferKeyId: exactText(record.exactOfferKeyId, "exact offer key ID", 160),
    exactOfferIdentityHash: exactText(record.exactOfferIdentityHash, "exact offer identity hash", 64),
    offerSnapshotId: exactText(record.offerSnapshotId, "offer snapshot ID", 160),
    offerEvidenceHash: exactText(record.offerEvidenceHash, "offer evidence hash", 64),
    actionJobId: exactText(record.actionJobId, "action job ID", 160),
    actionIdempotencyKey: exactText(record.actionIdempotencyKey, "action idempotency key", 64),
    actionEventId: exactText(record.actionEventId, "action event ID", 160),
    spendReservationId: exactText(record.spendReservationId, "spend reservation ID", 160),
    spendIdempotencyKey: exactText(record.spendIdempotencyKey, "spend idempotency key", 64),
    spendLedgerEntryId: exactText(record.spendLedgerEntryId, "spend ledger entry ID", 160),
    missionDecisionId: exactText(record.missionDecisionId, "mission decision ID", 160),
    auditId: exactText(record.auditId, "audit ID", 160),
    outboxId: exactText(record.outboxId, "outbox ID", 160),
    exactOfferAction: reuseAction(record.exactOfferAction, "exact offer action"),
    offerSnapshotAction: reuseAction(record.offerSnapshotAction, "offer snapshot action"),
    actionJobAction: insertAction(record.actionJobAction, "action job action"),
    actionEventAction: insertAction(record.actionEventAction, "action event action"),
    spendReservationAction: insertAction(record.spendReservationAction, "spend reservation action"),
    spendLedgerAction: insertAction(record.spendLedgerAction, "spend ledger action"),
    missionDecisionAction: insertAction(record.missionDecisionAction, "mission decision action"),
    auditAction: insertAction(record.auditAction, "audit action"),
    outboxAction: insertAction(record.outboxAction, "outbox action"),
    actionJobReservationLinkAction: insertAction(
      record.actionJobReservationLinkAction,
      "reservation link action"
    ),
    mutationStatementCount: exactInteger(record.mutationStatementCount, "mutation statement count", 0, 10),
    mutationRowCount: exactInteger(record.mutationRowCount, "mutation row count", 0, 10),
    immutableReplay: strictBoolean(record.immutableReplay, "immutable replay flag"),
    actionMutation: exactBoolean(record.actionMutation, true, "action mutation") as true,
    spendMutation: exactBoolean(record.spendMutation, true, "spend mutation") as true,
    retailerMutation: exactBoolean(record.retailerMutation, false, "retailer mutation") as false,
    checkoutMutation: exactBoolean(record.checkoutMutation, false, "checkout mutation") as false,
    orderSubmissionMutation: exactBoolean(
      record.orderSubmissionMutation,
      false,
      "order submission mutation"
    ) as false,
    inboxLifecycleMutation: exactBoolean(
      record.inboxLifecycleMutation,
      false,
      "inbox lifecycle mutation"
    ) as false,
    actionAuthority: exactBoolean(record.actionAuthority, true, "action authority") as true,
    planFingerprint: exactText(record.planFingerprint, "plan fingerprint", 64)
  };
  const identifiers = [
    common.eventId, common.listingId, common.variantId, common.incidentId,
    common.missionId, common.missionTargetId, common.policyRevisionId,
    common.exactOfferKeyId, common.offerSnapshotId, common.actionJobId,
    common.actionEventId, common.spendReservationId, common.spendLedgerEntryId,
    common.missionDecisionId, common.auditId, common.outboxId
  ];
  const decisionSourceConsistent = common.decisionSource === "purchase_intent"
    ? common.strategyId === "" && common.strategyRevision === 0
      && common.action === "add_to_cart" && common.initialJobState === "awaiting_executor"
      && common.quantity === 1 && common.unitPriceCents === common.effectiveUnitCapCents
    : common.decisionSource === "strategy"
      ? common.strategyId !== "" && IDENTIFIER.test(common.strategyId)
        && common.strategyRevision >= 1
        && common.action === "notify" && common.initialJobState === "notify_only"
      : false;
  if (!MESSAGE_ID.test(common.messageId)
    || identifiers.some((value) => !IDENTIFIER.test(value))
    || !SHA256.test(common.policyHash) || !SHA256.test(common.evaluationFingerprint)
    || !SHA256.test(common.exactOfferIdentityHash) || !SHA256.test(common.offerEvidenceHash)
    || !SHA256.test(common.actionIdempotencyKey) || !SHA256.test(common.spendIdempotencyKey)
    || !SHA256.test(common.planFingerprint)
    || !decisionSourceConsistent
    || common.currency !== "USD" || common.sellerType !== "first_party"
    || !["shipping", "pickup"].includes(common.fulfillment)
    || common.maximumAllInCents < common.unitPriceCents) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      "The PostgreSQL signal action/spend projection is invalid."
    );
  }
  return common;
}

function parsePlan(
  value: unknown,
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  messageId: string,
  now: number
): PostgresSignalActionSpendApplyPlan {
  const record = exactObject(value, "plan", PLAN_KEYS);
  const common = parseCommon(record);
  const plan: PostgresSignalActionSpendApplyPlan = {
    ...common,
    payloadHash: exactText(record.payloadHash, "payload hash", 64),
    authorizedAt: exactTimestamp(record.authorizedAt, "authorization timestamp"),
    validUntil: exactTimestamp(record.validUntil, "valid-until timestamp"),
    actionSpendApplyWillApply: strictBoolean(
      record.actionSpendApplyWillApply,
      "plan mutation flag"
    )
  };
  const replay = plan.immutableReplay;
  // Always mandatory on a fresh apply, regardless of decision source: the
  // notify-only strategy path still creates an action job, action event,
  // mission decision, audit event, and outbox event.
  const alwaysMandatoryActions = [
    plan.actionJobAction, plan.actionEventAction, plan.missionDecisionAction,
    plan.auditAction, plan.outboxAction
  ];
  // Purchase-intent-only: a strategy-sourced job never creates a spend
  // reservation, spend ledger entry, or reservation link (see the
  // SQLite-truth comment block above the function source).
  const purchaseOnlyActions = [
    plan.spendReservationAction, plan.spendLedgerAction, plan.actionJobReservationLinkAction
  ];
  const optionalInsertCount = [plan.exactOfferAction, plan.offerSnapshotAction]
    .filter((action) => action === "insert").length;
  const mandatoryFreshCount = plan.decisionSource === "purchase_intent" ? 8 : 5;
  if (plan.messageId !== messageId || !SHA256.test(plan.payloadHash)
    || Math.abs(Date.parse(plan.authorizedAt) - now) > MAXIMUM_CLOCK_SKEW_MS
    || Date.parse(plan.validUntil) - Date.parse(plan.authorizedAt)
      !== MAXIMUM_PLAN_AGE_SECONDS * 1_000
    || plan.actionSpendApplyWillApply !== !replay
    || (replay && (plan.exactOfferAction !== "none" || plan.offerSnapshotAction !== "none"
      || alwaysMandatoryActions.some((action) => action !== "none")
      || purchaseOnlyActions.some((action) => action !== "none")
      || plan.mutationStatementCount !== 0 || plan.mutationRowCount !== 0))
    || (!replay && ([plan.exactOfferAction, plan.offerSnapshotAction]
      .some((action) => action === "none")
      || alwaysMandatoryActions.some((action) => action !== "insert")
      || (plan.decisionSource === "purchase_intent"
        ? purchaseOnlyActions.some((action) => action !== "insert")
        : purchaseOnlyActions.some((action) => action !== "none"))
      || plan.mutationStatementCount !== mandatoryFreshCount + optionalInsertCount
      || plan.mutationRowCount !== mandatoryFreshCount + optionalInsertCount))
    || plan.planFingerprint !== postgresSignalActionSpendPlanFingerprint(principal, plan)) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      "The PostgreSQL signal action/spend plan is inconsistent."
    );
  }
  return plan;
}

const RESULT_KEYS = Object.freeze([
  ...PLAN_KEYS.filter((key) => ![
    "payloadHash", "authorizedAt", "validUntil", "actionSpendApplyWillApply"
  ].includes(key)),
  "actionSpendApplyApplied", "mutationAuthority", "idempotentReplay",
  "actionJobMutated", "spendReservationMutated"
] as const);

function parseResult(
  value: unknown,
  plan: PostgresSignalActionSpendApplyPlan
): PostgresSignalActionSpendApplyResult {
  const record = exactObject(value, "apply result", RESULT_KEYS);
  const common = parseCommon(record);
  const result: PostgresSignalActionSpendApplyResult = {
    ...common,
    actionSpendApplyApplied: strictBoolean(record.actionSpendApplyApplied, "apply mutation flag"),
    mutationAuthority: exactBoolean(record.mutationAuthority, true, "mutation authority") as true,
    idempotentReplay: exactBoolean(record.idempotentReplay, true, "idempotent replay") as true,
    actionJobMutated: strictBoolean(record.actionJobMutated, "action-job mutation flag"),
    spendReservationMutated: strictBoolean(
      record.spendReservationMutated,
      "spend-reservation mutation flag"
    )
  };
  for (const key of Object.keys(common)) {
    if (JSON.stringify(result[key as keyof typeof result]) !== JSON.stringify(plan[key as keyof typeof plan])) {
      throw new PostgresSignalActionSpendApplyQualificationError(
        "The PostgreSQL signal action/spend apply result changed after planning."
      );
    }
  }
  if (result.actionSpendApplyApplied !== plan.actionSpendApplyWillApply
    || result.actionJobMutated !== plan.actionSpendApplyWillApply
    || result.spendReservationMutated !==
      (plan.actionSpendApplyWillApply && plan.decisionSource === "purchase_intent")) {
    throw new PostgresSignalActionSpendApplyQualificationError(
      "The PostgreSQL signal action/spend mutation result is inconsistent."
    );
  }
  return result;
}

function boundarySpec(
  manifest: PostgresSignalActionSpendApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_action_spend_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.actionSpendRole.name,
    functionName: POSTGRES_SIGNAL_ACTION_SPEND_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalActionSpendApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_ACTION_SPEND_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_action_spend_apply_receipt",
    receiptTriggerName: "yoink_signal_action_spend_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.constraintConfigApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      strategyEvaluationApplyContractVersion: 1,
      writerLockProtocolContractVersion: 1,
      constraintConfigApplyContractVersion: 1,
      maximumPlanAgeSeconds: 30,
      sharedWriterLockProtocolImplemented: true,
      writerLockProtocolConsumed: true,
      constraintConfigBoundaryQualified: true,
      settingsPauseWriterParity: true,
      guardrailSettingsWriterParity: true,
      spendPolicyWriterParity: true,
      settingsWriterParity: false,
      configurationWriterParity: false,
      reservationWriterParity: false,
      fixedOrderConfigurationLocks: true,
      purchaseIntentOnly: false,
      strategyActionAuthority: false,
      strategySemanticsContractVersion: 2,
      strategyDecisionSourceAccepted: true,
      strategyExistenceRevalidation: true,
      strategyFailoverToNotifyEnforced: true,
      strategyCartActionAuthority: false,
      strategyReservationAuthority: false,
      trustedStrategyActionSemanticsQualified: true,
      strategyRevalidatedTableNames: ["strategies"],
      writerLockProtocolParity: false,
      attributionPolicyParity: false,
      runtimeAuthority: false
    }
  };
}

export type PostgresSignalActionSpendApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalActionSpendApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalActionSpendApplyManifest()
): Promise<PostgresSignalActionSpendApplyQualificationReceipt> {
  await verifyPostgresSignalConstraintConfigApplyBoundary(database, manifest.predecessorManifest);
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalActionSpendApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalActionSpendApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalActionSpendApplyQualificationReceipt> {
  await verifyPostgresSignalConstraintConfigApplyBoundary(database, manifest.predecessorManifest);
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

export class NodePostgresSignalActionSpendApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalActionSpendApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalActionSpendApplyManifest(),
    options: NodePostgresSignalActionSpendApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalActionSpendApplyQualificationError(
        "The PostgreSQL signal action/spend connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_action_spend_qualification"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async applySignalActionSpend(
    principal: BackgroundWorkerPrincipal,
    messageIdValue: string,
    capabilityTokenValue: string,
    attestationValue: SignalPolicyEvaluationAttestation,
    now = Date.now()
  ): Promise<PostgresSignalActionSpendApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const messageId = String(messageIdValue ?? "");
    const capabilityToken = String(capabilityTokenValue ?? "");
    const attestation = validateSignalPolicyEvaluationAttestation(attestationValue);
    if (!MESSAGE_ID.test(messageId) || !CAPABILITY_TOKEN.test(capabilityToken)
      || !Number.isSafeInteger(now) || Math.abs(Date.now() - now) > MAXIMUM_CLOCK_SKEW_MS) {
      throw new PostgresSignalActionSpendApplyQualificationError(
        "The PostgreSQL signal action/spend apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.actionSpendRole.name)}`);
      const call = async (
        operation: "plan" | "apply",
        authorizedAt: string,
        payload: Record<string, unknown>
      ): Promise<Record<string, unknown>> => {
        const result = await client.query<FunctionRow>(
          `SELECT result_json AS "resultJson"
           FROM ${relation(this.manifest.schemaName, POSTGRES_SIGNAL_ACTION_SPEND_APPLY_FUNCTION)}(
             $1, $2, $3, $4, $5, $6, $7
           )`,
          [tenantId, userId, operation, messageId, capabilityToken, authorizedAt, JSON.stringify(payload)]
        );
        if (result.rows.length !== 1 || !result.rows[0]) {
          throw new PostgresSignalActionSpendApplyQualificationError(
            "The PostgreSQL signal action/spend function returned an ambiguous result."
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
        await call("apply", plan.authorizedAt, {
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
