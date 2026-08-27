import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import {
  AMAZON_ADD_ACTIVATION_CONFIRMATION,
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ACTIVATION_CONFIRMATION,
  BESTBUY_ADD_ADAPTER_VERSION,
  JOB_STATES,
  TARGET_ADD_ACTIVATION_CONFIRMATION,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ACTIVATION_CONFIRMATION,
  WALMART_ADD_ADAPTER_VERSION,
  type CommunityConsentUpdateInput,
  type CommunityContributionInput,
  type IdentityClaimInput,
  type IdentityClaimReviewInput,
  type ObserverRecipePromotionInput,
  type ObserverRecipeProposalInput,
  type ObserverRecipeContributorEligibilityInput,
  type ObserverRecipeRecoveryReviewInput,
  type ObserverRecipeResignInput,
  type ObserverRecipeTrustManifestInstallInput,
  type ObserverRecipeTrialInput,
  type AmazonAddActivationInput,
  type AmazonAddRehearsalInput,
  type BestBuyAddActivationInput,
  type BestBuyAddRehearsalInput,
  type AppSettingsUpdateInput,
  type AttributionPolicyUpdateInput,
  type CatalogListingInput,
  type CatalogIdentityOperationDecisionInput,
  type CatalogIdentityOperationProposalInput,
  type JobState,
  type MissionUpdateInput,
  type PurchaseIntentCreateInput,
  type PurchaseIntentPreflightInput,
  PURCHASE_INTENT_PREFLIGHT_TTL_SECONDS,
  type OperatorAlertAcknowledgeInput,
  type OperatorAlertConnectorInput,
  type OperatorAlertConnectorReplayInput,
  type OperatorAlertResolveInput,
  type OperatorAlertRuleInput,
  type SpendPolicyUpdateInput,
  type RetailerAdapterDiagnosticInput,
  type RetailerShadowObservationInput,
  type SignalEventInput,
  type SourceSyncProgressInput,
  type StrategyDefinition,
  type SupportedRetailerId,
  type TrackalackerCatalogItemInput,
  type TrackalackerPushStatusInput,
  type TargetAddActivationInput,
  type TargetAddRehearsalInput,
  type TargetShadowObservationInput,
  type WalmartAddActivationInput,
  type WalmartAddRehearsalInput,
  type WalmartDrawScanInput
} from "../../../packages/contracts/src/index.js";
import { SIGNAL_INGRESS_EVENT_TYPE } from "../../../packages/contracts/src/signal-ingress.js";
import { CatalogRepository } from "../../../packages/database/src/catalog-repository.js";
import {
  CatalogGovernanceRepository,
  type CatalogProposalDecisionInput
} from "../../../packages/database/src/catalog-governance-repository.js";
import {
  CatalogLinkRepository,
  type ExactProductLinkProposalInput
} from "../../../packages/database/src/catalog-link-repository.js";
import { CatalogIdentityGovernanceRepository } from "../../../packages/database/src/catalog-identity-governance-repository.js";
import { AttributionRepository } from "../../../packages/database/src/attribution-repository.js";
import { BackgroundTaskRepository } from "../../../packages/database/src/background-task-repository.js";
import { AdapterDiagnosticRepository } from "../../../packages/database/src/adapter-diagnostic-repository.js";
import {
  ADMIN_CHANGE_OPERATION_POLICIES,
  AdminChangeControlRepository,
  type AdminChangeStatus
} from "../../../packages/database/src/admin-change-control-repository.js";
import { AuthorizationRepository } from "../../../packages/database/src/authorization-repository.js";
import { AuditRepository } from "../../../packages/database/src/audit-repository.js";
import { ControlRepository } from "../../../packages/database/src/control-repository.js";
import { CommunityEvidenceRepository } from "../../../packages/database/src/community-evidence-repository.js";
import { YoinkDatabase } from "../../../packages/database/src/database.js";
import { DeviceRepository, type PairDeviceInput } from "../../../packages/database/src/device-repository.js";
import { ExecutionRepository } from "../../../packages/database/src/execution-repository.js";
import {
  HostedDeliveryRepository,
  type HostedInboxInput
} from "../../../packages/database/src/hosted-delivery-repository.js";
import { IdentityClaimRepository } from "../../../packages/database/src/identity-claim-repository.js";
import { NotificationRepository } from "../../../packages/database/src/notification-repository.js";
import {
  OBSERVER_RECIPE_CANARY_COHORT_PERCENT,
  OBSERVER_RECIPE_CANARY_MINIMUM_DURATION_MS,
  ObserverRecipeRepository
} from "../../../packages/database/src/observer-recipe-repository.js";
import {
  OBSERVER_RECIPE_CONFLICT_SLO_POLICY_VERSION,
  OBSERVER_RECIPE_CONFLICT_SLO_WINDOW_DAYS
} from "../../../packages/database/src/observer-recipe-conflict-slo-repository.js";
import {
  OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_MAXIMUM_TTL_MS,
  OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_POLICY_VERSION,
  ObserverRecipeContributorEligibilityRepository
} from "../../../packages/database/src/observer-recipe-contributor-eligibility-repository.js";
import {
  OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS,
  OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH,
  OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION
} from "../../../packages/database/src/observer-recipe-recovery-retention-repository.js";
import {
  OPERATIONAL_TELEMETRY_WINDOWS,
  OperationalTelemetryRepository,
  type OperationalRouteKey,
  type OperationalTelemetryWindow
} from "../../../packages/database/src/operational-telemetry-repository.js";
import { OperatorAlertRepository } from "../../../packages/database/src/operator-alert-repository.js";
import { MutationLaneRepository } from "../../../packages/database/src/mutation-lane-repository.js";
import { PORTABILITY_FORMAT } from "../../../packages/database/src/portability.js";
import { postgresCutoverCapabilityProjection } from "../../../packages/database/src/postgres-cutover.js";
import { postgresRuntimeReadRoleCapabilityProjection } from "../../../packages/database/src/postgres-runtime-roles.js";
import { postgresTenantSessionCapabilityProjection } from "../../../packages/database/src/postgres-tenant-session.js";
import { postgresTenantQueueWriteCapabilityProjection } from "../../../packages/database/src/postgres-tenant-queue-writes.js";
import { postgresWorkerControlCapabilityProjection } from "../../../packages/database/src/postgres-worker-control.js";
import { postgresNotificationRecoveryCapabilityProjection } from "../../../packages/database/src/postgres-notification-recovery.js";
import { postgresExecutionRecoveryCapabilityProjection } from "../../../packages/database/src/postgres-execution-recovery.js";
import { postgresOperationalRetentionCapabilityProjection } from "../../../packages/database/src/postgres-operational-retention.js";
import { postgresObserverCandidateEvaluationCapabilityProjection } from "../../../packages/database/src/postgres-observer-repair-candidate-evaluation.js";
import { postgresOperatorAlertConnectorDispatchCapabilityProjection } from "../../../packages/database/src/postgres-operator-alert-connector-dispatch.js";
import { postgresOperatorAlertReconciliationCapabilityProjection } from "../../../packages/database/src/postgres-operator-alert-reconciliation.js";
import { postgresObserverWitnessRefreshCapabilityProjection } from "../../../packages/database/src/postgres-observer-witness-refresh.js";
import { postgresHostedDeliveryLeaseRecoveryCapabilityProjection } from "../../../packages/database/src/postgres-hosted-delivery-lease-recovery.js";
import { postgresSignalCatalogApplyCapabilityProjection } from "../../../packages/database/src/postgres-signal-catalog-apply.js";
import { postgresSignalResolutionApplyCapabilityProjection } from "../../../packages/database/src/postgres-signal-resolution-apply.js";
import { postgresSignalSourceReferenceRefreshCapabilityProjection } from "../../../packages/database/src/postgres-signal-source-reference-refresh.js";
import { postgresSignalTerminalDecisionApplyCapabilityProjection } from "../../../packages/database/src/postgres-signal-terminal-decision-apply.js";
import { postgresSignalOfferIncidentApplyCapabilityProjection } from "../../../packages/database/src/postgres-signal-offer-incident-apply.js";
import { postgresSignalPostIncidentDecisionApplyCapabilityProjection } from "../../../packages/database/src/postgres-signal-post-incident-decision-apply.js";
import { postgresSignalMissionBindingApplyCapabilityProjection } from "../../../packages/database/src/postgres-signal-mission-binding-apply.js";
import { postgresSignalStrategyEvaluationApplyCapabilityProjection } from "../../../packages/database/src/postgres-signal-strategy-evaluation-apply.js";
import { postgresSignalWriterLockProtocolCapabilityProjection } from "../../../packages/database/src/postgres-signal-writer-lock-protocol.js";
import { postgresSignalConstraintConfigCapabilityProjection } from "../../../packages/database/src/postgres-signal-constraint-config-apply.js";
import { postgresSignalActionSpendCapabilityProjection } from "../../../packages/database/src/postgres-signal-action-spend-apply.js";
import {
  PrincipalRepository,
  type HostedPrincipalInput
} from "../../../packages/database/src/principal-repository.js";
import { QualificationRepository } from "../../../packages/database/src/qualification-repository.js";
import {
  LOCAL_REQUEST_SCOPE,
  currentRequestScope,
  runWithRequestScope,
  scopedSourceConnectionId,
  type RequestScope
} from "../../../packages/database/src/request-scope.js";
import { SignalRepository } from "../../../packages/database/src/signal-repository.js";
import { OfferIdentityRepository } from "../../../packages/database/src/offer-identity-repository.js";
import { SpendLedgerRepository } from "../../../packages/database/src/spend-ledger-repository.js";
import { ShadowObservationRepository } from "../../../packages/database/src/shadow-observation-repository.js";
import { SourceRepository } from "../../../packages/database/src/source-repository.js";
import { WalmartDrawRepository } from "../../../packages/database/src/walmart-draw-repository.js";
import {
  USER_DATA_EXPORT_FORMAT,
  UserPrivacyRepository
} from "../../../packages/database/src/user-privacy-repository.js";
import { SignalEngine } from "../../../packages/engine/src/signal-engine.js";
import { DurableSignalIngressService } from "../../../packages/engine/src/signal-ingress.js";
import { newId, stableHash } from "../../../packages/domain/src/ids.js";
import { BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION } from "../../../packages/domain/src/background-worker-deployment.js";
import {
  buildPurchaseAutomationReadiness,
  type PurchaseAutomationPlanInput,
  type PurchaseAutomationTargetInput
} from "../../../packages/domain/src/purchase-automation-readiness.js";
import { buildUserSetupReadiness } from "../../../packages/domain/src/user-setup.js";
import { trackalackerSignalInput } from "../../../packages/sources/src/trackalacker.js";
import { ObserverRecipeTrustAuthority } from "../../../packages/observer-registry/src/trust.js";
import {
  ObserverRecipeWitnessError,
  type ObserverRecipeWitnessPublisher
} from "../../../packages/observer-registry/src/witness.js";
import { resolveExtensionRelease } from "./extension-release.js";
import { ApiError, apiErrorPayload } from "./api-error.js";
import { operationalRouteKey, resolveApiRoutePolicy } from "./api-route-policy.js";
import {
  emptyInternalServiceCapabilityProjection,
  type InternalServiceCapabilityProjection
} from "./internal-service-capabilities.js";

const MAX_BODY_BYTES = 1_000_000;
const STATIC_FILES = new Map([
  ["/", "user.html"],
  ["/index.html", "user.html"],
  ["/user.js", "user.js"],
  ["/user.css", "user.css"],
  ["/admin", "index.html"],
  ["/admin/", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"]
]);
const ADMIN_STATIC_PATHS = new Set(["/admin", "/admin/", "/app.js", "/styles.css"]);

export interface AppDependencies {
  db: YoinkDatabase;
  webRoot: string;
  releaseRoot?: string;
  observerRecipeTrust?: ObserverRecipeTrustAuthority;
  observerRecipeWitness?: ObserverRecipeWitnessPublisher;
  observerRecipeWitnessRequired?: boolean;
  operatorAlertConnectorBindings?: Readonly<Record<string, string>>;
  internalServiceCapabilityRegistry?: InternalServiceCapabilityProjection;
  requestScopeResolver?: (
    request: IncomingMessage,
    context?: { body?: Record<string, unknown> }
  ) => RequestScope | Promise<RequestScope>;
  hostValidator?: (request: IncomingMessage) => boolean;
  mutationOriginValidator?: (request: IncomingMessage) => boolean;
  extensionOriginValidator?: (request: IncomingMessage) => boolean;
  localExtensionReleaseEnabled?: boolean;
  backgroundWorkerStatus?: () => {
    state: "running" | "waiting" | "stopped" | "starting" | "stopping" | "disabled";
    healthy: boolean;
    runtimeKind: "local_in_process" | "standalone";
    mode?: "embedded" | "external" | "disabled";
    lastHeartbeatAt: string;
    lastErrorCode: string;
    deploymentAttested: boolean;
    deploymentContractVersion: number;
  } | Promise<{
    state: "running" | "waiting" | "stopped" | "starting" | "stopping" | "disabled";
    healthy: boolean;
    runtimeKind: "local_in_process" | "standalone";
    mode?: "embedded" | "external" | "disabled";
    lastHeartbeatAt: string;
    lastErrorCode: string;
    deploymentAttested: boolean;
    deploymentContractVersion: number;
  }>;
  version: string;
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  const correlationId = String(response.getHeader("X-Request-ID") ?? "");
  const correlatedPayload = correlationId && payload && typeof payload === "object" && !Array.isArray(payload)
    && typeof (payload as Record<string, unknown>).error === "string"
    && !("correlationId" in payload)
    ? { ...(payload as Record<string, unknown>), correlationId }
    : payload;
  response.end(JSON.stringify(correlatedPayload));
}

function allowedHost(request: IncomingMessage): boolean {
  const host = String(request.headers.host ?? "").toLocaleLowerCase("en-US");
  return /^127\.0\.0\.1(?::\d+)?$/.test(host) || /^localhost(?::\d+)?$/.test(host);
}

function sameOriginMutation(request: IncomingMessage): boolean {
  const origin = String(request.headers.origin ?? "");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function chromeExtensionOrigin(request: IncomingMessage): boolean {
  const origin = String(request.headers.origin ?? "");
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "chrome-extension:"
      && /^[a-p]{32}$/.test(parsed.hostname)
      && (parsed.pathname === "" || parsed.pathname === "/");
  } catch {
    return false;
  }
}

function bearerToken(request: IncomingMessage): string {
  const authorization = String(request.headers.authorization ?? "");
  const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(authorization);
  return match?.[1] ?? "";
}

function adminChangeRequestId(request: IncomingMessage): { changeRequestId?: string } {
  const value = String(request.headers["x-yoink-change-request-id"] ?? "").trim();
  return value ? { changeRequestId: value } : {};
}

function purchaseAutomationPlanInput(plan: Record<string, unknown>): PurchaseAutomationPlanInput {
  const intentPolicy = plan.intentPolicy && typeof plan.intentPolicy === "object" && !Array.isArray(plan.intentPolicy)
    ? plan.intentPolicy as Record<string, unknown>
    : {};
  const rawTargets = Array.isArray(plan.automationTargets)
    ? plan.automationTargets
    : Array.isArray(plan.targets) ? plan.targets : [];
  const targets: PurchaseAutomationTargetInput[] = rawTargets
    .filter((target): target is Record<string, unknown> => Boolean(target) && typeof target === "object" && !Array.isArray(target))
    .map((target) => {
      const maxUnitPrice = target.maxUnitPriceCents === null || target.maxUnitPriceCents === undefined
        ? null
        : Number(target.maxUnitPriceCents);
      return {
        targetId: String(target.targetId ?? target.id ?? ""),
        listingId: String(target.listingId ?? ""),
        retailerId: String(target.retailerId ?? ""),
        retailerName: String(target.retailerName ?? ""),
        retailerSku: String(target.retailerSku ?? ""),
        enabled: target.enabled === true || Number(target.enabled) === 1,
        executionSupported: target.executionSupported === true || Number(target.executionSupported) === 1,
        maxUnitPriceCents: Number.isFinite(maxUnitPrice) ? maxUnitPrice : null,
        sellerPolicy: String(target.sellerPolicy ?? ""),
        fulfillment: String(target.fulfillment ?? "")
      };
    });
  return {
    id: String(plan.id ?? ""),
    status: String(plan.status ?? ""),
    title: String(plan.title ?? ""),
    targetQuantity: Number(plan.targetQuantity ?? 1),
    actionCeiling: String(plan.actionCeiling ?? intentPolicy.actionCeiling ?? "notify"),
    decisionMode: String(plan.decisionMode ?? intentPolicy.decisionMode ?? "strategy"),
    expiresAt: String(plan.expiresAt ?? intentPolicy.expiresAt ?? ""),
    targets
  };
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLocaleLowerCase("en-US");
  if (contentType !== "application/json") throw new Error("Requests with a body must use application/json.");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error("The request body is too large.");
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("The request body is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required.");
  return value as Record<string, unknown>;
}

function staticResponse(response: ServerResponse, webRoot: string, pathname: string): boolean {
  const file = STATIC_FILES.get(pathname);
  if (!file) return false;
  const path = join(webRoot, file);
  let body: Buffer;
  try {
    body = readFileSync(path);
  } catch {
    json(response, 503, { error: "ui_unavailable", message: "The Yoink control-center files are unavailable." });
    return true;
  }
  securityHeaders(response);
  response.statusCode = 200;
  response.setHeader("Content-Type", extname(file) === ".css"
    ? "text/css; charset=utf-8"
    : extname(file) === ".js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
  response.end(body);
  return true;
}

export function createYoinkServer(dependencies: AppDependencies): Server {
  const { db, webRoot, version } = dependencies;
  const releaseRoot = dependencies.releaseRoot ?? join(process.cwd(), "release");
  const requestScopeResolver = dependencies.requestScopeResolver ?? (() => LOCAL_REQUEST_SCOPE);
  const hostValidator = dependencies.hostValidator ?? allowedHost;
  const mutationOriginValidator = dependencies.mutationOriginValidator ?? sameOriginMutation;
  const extensionOriginValidator = dependencies.extensionOriginValidator ?? chromeExtensionOrigin;
  const localExtensionReleaseEnabled = dependencies.localExtensionReleaseEnabled !== false;
  const internalServiceCapabilities = dependencies.internalServiceCapabilityRegistry
    ?? emptyInternalServiceCapabilityProjection();
  const postgresCutover = postgresCutoverCapabilityProjection();
  const postgresRuntimeReadRoles = postgresRuntimeReadRoleCapabilityProjection();
  const postgresTenantSessions = postgresTenantSessionCapabilityProjection();
  const postgresTenantQueueWrites = postgresTenantQueueWriteCapabilityProjection();
  const postgresWorkerControl = postgresWorkerControlCapabilityProjection();
  const postgresNotificationRecovery = postgresNotificationRecoveryCapabilityProjection();
  const postgresExecutionRecovery = postgresExecutionRecoveryCapabilityProjection();
  const postgresOperationalRetention = postgresOperationalRetentionCapabilityProjection();
  const postgresObserverCandidateEvaluation = postgresObserverCandidateEvaluationCapabilityProjection();
  const postgresOperatorAlertConnectorDispatch = postgresOperatorAlertConnectorDispatchCapabilityProjection();
  const postgresOperatorAlertReconciliation = postgresOperatorAlertReconciliationCapabilityProjection();
  const postgresObserverWitnessRefresh = postgresObserverWitnessRefreshCapabilityProjection();
  const postgresHostedDeliveryLeaseRecovery = postgresHostedDeliveryLeaseRecoveryCapabilityProjection();
  const postgresSignalCatalogApply = postgresSignalCatalogApplyCapabilityProjection();
  const postgresSignalResolutionApply = postgresSignalResolutionApplyCapabilityProjection();
  const postgresSignalSourceReferenceRefresh = postgresSignalSourceReferenceRefreshCapabilityProjection();
  const postgresSignalTerminalDecisionApply = postgresSignalTerminalDecisionApplyCapabilityProjection();
  const postgresSignalOfferIncidentApply = postgresSignalOfferIncidentApplyCapabilityProjection();
  const postgresSignalPostIncidentDecisionApply =
    postgresSignalPostIncidentDecisionApplyCapabilityProjection();
  const postgresSignalMissionBindingApply =
    postgresSignalMissionBindingApplyCapabilityProjection();
  const postgresSignalStrategyEvaluationApply =
    postgresSignalStrategyEvaluationApplyCapabilityProjection();
  const postgresSignalWriterLockProtocol =
    postgresSignalWriterLockProtocolCapabilityProjection();
  const postgresSignalConstraintConfigApply =
    postgresSignalConstraintConfigCapabilityProjection();
  const postgresSignalActionSpendApply =
    postgresSignalActionSpendCapabilityProjection();
  const catalog = new CatalogRepository(db);
  const catalogGovernance = new CatalogGovernanceRepository(db);
  const catalogLinks = new CatalogLinkRepository(db);
  const catalogIdentityGovernance = new CatalogIdentityGovernanceRepository(db);
  const attribution = new AttributionRepository(db);
  const backgroundTasks = new BackgroundTaskRepository(db);
  const adapterDiagnostics = new AdapterDiagnosticRepository(db);
  const adminChanges = new AdminChangeControlRepository(db);
  const authorization = new AuthorizationRepository(db);
  const audit = new AuditRepository(db);
  const control = new ControlRepository(db);
  const community = new CommunityEvidenceRepository(db);
  const signals = new SignalRepository(db);
  const offerIdentity = new OfferIdentityRepository(db);
  const spendLedger = new SpendLedgerRepository(db);
  const engine = new SignalEngine(db);
  const signalIngress = new DurableSignalIngressService(db);
  const devices = new DeviceRepository(db);
  const execution = new ExecutionRepository(db);
  const hostedDelivery = new HostedDeliveryRepository(db);
  const identityClaims = new IdentityClaimRepository(db);
  const notifications = new NotificationRepository(db);
  const mutationLanes = new MutationLaneRepository(db);
  const observerContributorEligibility = new ObserverRecipeContributorEligibilityRepository(db);
  const observerRecipes = new ObserverRecipeRepository(
    db,
    dependencies.observerRecipeTrust ?? ObserverRecipeTrustAuthority.ephemeral(),
    {
      ...(dependencies.observerRecipeWitness ? {
        witnessVerifier: dependencies.observerRecipeWitness.verifier,
        witnessEndpointOrigin: dependencies.observerRecipeWitness.endpointOrigin
      } : {}),
      witnessRequired: dependencies.observerRecipeWitnessRequired === true
    }
  );
  const operationalTelemetry = new OperationalTelemetryRepository(db);
  const operatorAlerts = new OperatorAlertRepository(db, dependencies.operatorAlertConnectorBindings ?? {});
  const principals = new PrincipalRepository(db);
  const qualifications = new QualificationRepository(db);
  const shadowObservations = new ShadowObservationRepository(db);
  const sourceRuntime = new SourceRepository(db);
  const walmartDraws = new WalmartDrawRepository(db);
  const userPrivacy = new UserPrivacyRepository(db);
  const guardedAddLanes = () => ({
    target: qualifications.targetAddQualified(),
    walmart: qualifications.walmartAddQualified(),
    amazon: qualifications.amazonAddQualified(),
    bestbuy: qualifications.bestBuyAddQualified()
  });
  const decoratePurchaseIntents = (
    plans: Array<Record<string, unknown>>,
    input: {
      settings?: ReturnType<ControlRepository["settings"]>;
      sources?: Array<Record<string, unknown>>;
      deviceList?: Array<Record<string, unknown>>;
      laneQualifications?: ReturnType<typeof guardedAddLanes>;
      now?: number;
    } = {}
  ): Array<Record<string, unknown>> => {
    const now = input.now ?? Date.now();
    const settings = input.settings ?? control.settings();
    const sources = input.sources ?? control.listSources();
    const deviceList = input.deviceList ?? devices.listDevices(now);
    const context = {
      version,
      executionMode: settings.executionMode,
      actionsPaused: settings.actionsPaused,
      sources,
      devices: deviceList,
      qualifications: input.laneQualifications ?? guardedAddLanes(),
      now
    };
    return plans.map((plan) => {
      const { automationTargets: _automationTargets, ...publicPlan } = plan;
      return {
        ...publicPlan,
        automationReadiness: buildPurchaseAutomationReadiness(purchaseAutomationPlanInput(plan), context)
      };
    });
  };
  const configuredPurchaseIntentPreflight = (
    input: PurchaseIntentPreflightInput,
    now = Date.now(),
    issuedAt = new Date(now).toISOString()
  ) => {
    const preview = control.previewConfiguredMission(input, now);
    const settings = control.settings();
    const readiness = buildPurchaseAutomationReadiness(preview.readinessPlan, {
      version,
      executionMode: settings.executionMode,
      actionsPaused: settings.actionsPaused,
      sources: control.listSources(),
      devices: devices.listDevices(now),
      qualifications: guardedAddLanes(),
      now
    });
    const { readinessPlan: _readinessPlan, ...publicPreview } = preview;
    const scope = currentRequestScope();
    const fingerprint = stableHash(
      "yoink_purchase_intent_preflight_v1",
      scope.tenantId,
      scope.userId,
      issuedAt,
      JSON.stringify(publicPreview),
      JSON.stringify(readiness)
    );
    const issuedAtTime = new Date(issuedAt).getTime();
    return {
      ...publicPreview,
      automationReadiness: readiness,
      preflightFingerprint: fingerprint,
      preflightedAt: issuedAt,
      validForSeconds: PURCHASE_INTENT_PREFLIGHT_TTL_SECONDS,
      validUntil: Number.isFinite(issuedAtTime)
        ? new Date(issuedAtTime + PURCHASE_INTENT_PREFLIGHT_TTL_SECONDS * 1_000).toISOString()
        : ""
    };
  };

  // Local startup is an explicit reconciliation boundary so open, sanitized
  // repair groups that predate migration 25 receive their default operator
  // alert without turning a GET request into a hidden write. Hosted workers
  // will perform this per tenant once Phase 2 transport is deployed.
  if (dependencies.requestScopeResolver === undefined) {
    operatorAlerts.reconcileAdapterRepairs(
      adapterDiagnostics.listRepairQueue(2_000),
      "local_startup_alert_reconciliation"
    );
  }

  return createServer(async (request, response) => {
    const requestStartedAt = Date.now();
    const suppliedCorrelationId = String(request.headers["x-request-id"] ?? "").trim();
    const correlationId = /^[A-Za-z0-9_-]{8,120}$/.test(suppliedCorrelationId)
      ? suppliedCorrelationId
      : newId("request");
    let telemetryScope: RequestScope | null = null;
    let telemetryActorKind: RequestScope["actorKind"] = "service";
    let telemetryErrorCode = "";
    let telemetryPathname = "/";
    try {
      telemetryPathname = new URL(request.url ?? "/", "http://yoink.invalid").pathname;
    } catch {
      telemetryPathname = "/api/v1/invalid";
    }
    const telemetryApplicable = telemetryPathname.startsWith("/api/v1/");
    let telemetryRoute: OperationalRouteKey = operationalRouteKey(telemetryPathname, null);
    response.once("finish", () => {
      const completedScope = telemetryScope;
      if (!telemetryApplicable || !completedScope) return;
      try {
        runWithRequestScope(completedScope, () => operationalTelemetry.record({
          correlationId,
          routeKey: telemetryRoute,
          method: request.method ?? "GET",
          actorKind: telemetryActorKind,
          statusCode: response.statusCode,
          errorCode: telemetryErrorCode || (response.statusCode >= 400 ? `http_${response.statusCode}` : ""),
          durationMs: Date.now() - requestStartedAt
        }));
      } catch {
        // Operational telemetry is deliberately fail-open for request delivery.
        // Its schema and tests keep the captured projection bounded and private.
      }
    });
    response.setHeader("X-Request-ID", correlationId);
    try {
      if (!hostValidator(request)) {
        json(response, 403, { error: "invalid_host", message: "The request Host header is not allowed." });
        return;
      }
      const initialRequestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);
      const pairingRoute = request.method === "POST"
        && initialRequestUrl.pathname === "/api/v1/devices/pair";
      const selfDeviceRoute = initialRequestUrl.pathname.startsWith("/api/v1/devices/self/");
      if ((pairingRoute || selfDeviceRoute) && !extensionOriginValidator(request)) {
        json(response, 403, {
          error: "extension_origin_rejected",
          message: pairingRoute
            ? "Pairing must be initiated by the allowed Chrome companion."
            : "This route is available only to the allowed Chrome companion."
        });
        return;
      }
      const pairingBody = request.method === "POST"
        && initialRequestUrl.pathname === "/api/v1/devices/pair"
        ? await readJson(request)
        : undefined;
      const requestScope = await requestScopeResolver(request, pairingBody ? { body: pairingBody } : {});
      telemetryScope = requestScope;
      telemetryActorKind = requestScope.actorKind;
      await runWithRequestScope(requestScope, async () => {
      const requestUrl = initialRequestUrl;
      if (request.method === "GET" && STATIC_FILES.has(requestUrl.pathname)) {
        authorization.require(ADMIN_STATIC_PATHS.has(requestUrl.pathname) ? "admin.read" : "user.read");
        if (staticResponse(response, webRoot, requestUrl.pathname)) return;
      }

      const routePolicy = resolveApiRoutePolicy(request.method ?? "GET", requestUrl.pathname);
      telemetryRoute = operationalRouteKey(telemetryPathname, routePolicy);
      if (routePolicy?.surface === "device") telemetryActorKind = "device";
      if (routePolicy?.surface === "internal") telemetryActorKind = "service";
      if (routePolicy && !routePolicy.classified) {
        throw new ApiError("api_route_unclassified", 404, "The requested API route is not registered.");
      }
      if (routePolicy?.surfaceMismatch) {
        throw new ApiError("api_surface_mismatch", 404, "The requested route does not exist on this API surface.");
      }
      if (routePolicy?.permission) authorization.require(routePolicy.permission);
      if (routePolicy) {
        requestUrl.pathname = routePolicy.pathname;
        response.setHeader("X-Yoink-API-Surface", routePolicy.surface);
        if (routePolicy.legacy) {
          response.setHeader("Deprecation", "true");
          response.setHeader("Link", `</api/v1/${routePolicy.surface}/>; rel=\"successor-version\"`);
        }
      }
      const purchaseIntentDetailMatch = /^\/api\/v1\/user\/purchase-intents\/([A-Za-z0-9_-]{3,120})$/.exec(requestUrl.pathname);
      const purchaseIntentOffersMatch = /^\/api\/v1\/user\/purchase-intents\/([A-Za-z0-9_-]{3,120})\/offers$/.exec(requestUrl.pathname);
      const catalogIdentityOperationDetailMatch = /^\/api\/v1\/admin\/catalog\/identity-operations\/([A-Za-z0-9_-]{3,120})$/.exec(requestUrl.pathname);
      const catalogIdentityOperationDecisionMatch = /^\/api\/v1\/admin\/catalog\/identity-operations\/([A-Za-z0-9_-]{3,120})\/decision$/.exec(requestUrl.pathname);
      const operatorAlertRuleMatch = /^\/api\/v1\/alerts\/rules\/([A-Za-z0-9_-]{3,120})$/.exec(requestUrl.pathname);
      const operatorAlertConnectorMatch = /^\/api\/v1\/alerts\/connectors\/([A-Za-z0-9_-]{3,120})$/.exec(requestUrl.pathname);
      const operatorAlertConnectorDeliveryRetryMatch = /^\/api\/v1\/alerts\/connector-deliveries\/([A-Za-z0-9_-]{3,120})\/retry$/.exec(requestUrl.pathname);
      const operatorAlertIncidentActionMatch = /^\/api\/v1\/alerts\/incidents\/([A-Za-z0-9_-]{3,120})\/(acknowledge|resolve)$/.exec(requestUrl.pathname);
      const adminChangeRequestDetailMatch = /^\/api\/v1\/change-requests\/(admin_change_[a-f0-9]{32})$/.exec(requestUrl.pathname);
      const adminChangeRequestDecisionMatch = /^\/api\/v1\/change-requests\/(admin_change_[a-f0-9]{32})\/decision$/.exec(requestUrl.pathname);
      const backgroundScheduleMatch = /^\/api\/v1\/workers\/schedules\/([A-Za-z0-9_-]{3,160})$/.exec(requestUrl.pathname);
      const backgroundScheduleRunMatch = /^\/api\/v1\/workers\/schedules\/([A-Za-z0-9_-]{3,160})\/run$/.exec(requestUrl.pathname);
      const backgroundTaskRetryMatch = /^\/api\/v1\/workers\/tasks\/([A-Za-z0-9_-]{3,160})\/retry$/.exec(requestUrl.pathname);
      const signalInboxRetryMatch = /^\/api\/v1\/workers\/signal-inbox\/(inbox_[a-f0-9]{32})\/retry$/.exec(requestUrl.pathname);
      const observerRecoveryReviewMatch = /^\/api\/v1\/community\/recovery-evidence\/([A-Za-z0-9_-]{3,120})\/review$/.exec(requestUrl.pathname);

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/health") {
        const settings = control.settings();
        const targetAddQualified = qualifications.targetAddQualified();
        const walmartAddQualified = qualifications.walmartAddQualified();
        const amazonAddQualified = qualifications.amazonAddQualified();
        const bestBuyAddQualified = qualifications.bestBuyAddQualified();
        const witness = observerRecipes.witnessStatus() as {
          required?: boolean;
          state?: string;
          healthy?: boolean;
          deliveryAllowed?: boolean;
        };
        const backgroundWorker = await dependencies.backgroundWorkerStatus?.() ?? {
          state: "stopped" as const,
          healthy: false,
          runtimeKind: "local_in_process" as const,
          mode: "disabled" as const,
          lastHeartbeatAt: "",
          lastErrorCode: "not_attached",
          deploymentAttested: false,
          deploymentContractVersion: BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION
        };
        json(response, 200, {
          status: "ready",
          version,
          database: "ready",
          storageEngine: "sqlite",
          portabilityArchiveFormat: PORTABILITY_FORMAT,
          userDataExportFormat: USER_DATA_EXPORT_FORMAT,
          selfServiceUserDataExport: true,
          productionPostgresReady: false,
          postgresCutover,
          postgresRuntimeReadRoles,
          postgresTenantSessions,
          postgresTenantQueueWrites,
          postgresWorkerControl,
          postgresNotificationRecovery,
          postgresExecutionRecovery,
          postgresOperationalRetention,
          postgresObserverCandidateEvaluation,
          postgresOperatorAlertConnectorDispatch,
          postgresOperatorAlertReconciliation,
          postgresObserverWitnessRefresh,
          postgresHostedDeliveryLeaseRecovery,
          postgresSignalCatalogApply,
          postgresSignalResolutionApply,
          postgresSignalSourceReferenceRefresh,
          postgresSignalTerminalDecisionApply,
          postgresSignalOfferIncidentApply,
          postgresSignalPostIncidentDecisionApply,
          postgresSignalMissionBindingApply,
          postgresSignalStrategyEvaluationApply,
          postgresSignalWriterLockProtocol,
          postgresSignalConstraintConfigApply,
          postgresSignalActionSpendApply,
          durableBackgroundTasks: true,
          durableSignalIngress: true,
          signalEvaluationOutsideDeviceRequest: true,
          durableObserverRepairCandidateEvaluation: true,
          privacyBoundedObserverRepairFieldCount: 5,
          generatedObserverRepairCandidatesExecutable: false,
          generatedObserverRepairCandidatesAutoPromoted: false,
          generatedObserverRepairRequiresIndependentOracle: true,
          generatedObserverRepairIndependentOracleImplemented: false,
          generatedObserverRepairPackagedOracleImplemented: true,
          generatedObserverRepairPackagedOracleRequiredForPromotion: true,
          generatedObserverRepairIndependentAccountOracleImplemented: false,
          generatedObserverRepairTenantContributorQuorumImplemented: true,
          generatedObserverRepairPublicIndependentAccountQuorumImplemented: false,
          observerRecipePackagedConflictAutoKill: true,
          observerRecipeContributorDeduplicatedQuorumImplemented: true,
          observerRecipeCanaryCohortPercent: OBSERVER_RECIPE_CANARY_COHORT_PERCENT,
          observerRecipeCanaryMinimumDurationHours: OBSERVER_RECIPE_CANARY_MINIMUM_DURATION_MS / 3_600_000,
          observerRecipeCanaryRegressionAutoKill: true,
          observerRecipeRecoveryEvidenceStorageImplemented: true,
          observerRecipeRecoveryUserReviewImplemented: true,
          observerRecipeRecoveryReviewRevocationImplemented: true,
          observerRecipeRecoveryRetentionImplemented: true,
          observerRecipeRecoveryRetentionDays: OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS,
          observerRecipeRecoveryRetentionReceiptsImplemented: true,
          observerRecipeContributorEligibilitySeamImplemented: true,
          observerRecipeContributorEligibilityPolicyVersion: OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_POLICY_VERSION,
          observerRecipeContributorEligibilityMaximumTtlHours:
            OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_MAXIMUM_TTL_MS / 3_600_000,
          observerRecipeExternalIdentityRiskProviderConfigured: false,
          observerRecipeRegionalConflictSloImplemented: true,
          observerRecipeRegionalConflictSloPolicyVersion: OBSERVER_RECIPE_CONFLICT_SLO_POLICY_VERSION,
          observerRecipeRegionalConflictSloWindowDays: OBSERVER_RECIPE_CONFLICT_SLO_WINDOW_DAYS,
          observerRecipeRegionalConflictSloMayDisableReadOnlyDistribution: true,
          observerRecipeRegionalConflictSloMayAuthorizeMutation: false,
          observerRecipeRecoveryReviewAffectsApplication: false,
          observerRecipeRecoveryEvidenceApplicationEnabled: false,
          observerRecipeFieldFillEnabled: false,
          durableObserverRecipeWitnessRefresh: true,
          durableOperatorAlertConnectorDispatch: true,
          governedOperatorAlertConnectorReplay: true,
          operatorAlertConnectorHealthProjection: true,
          oneCurrentCommunityVotePerContributor: true,
          robustCommunityPriceProjection: true,
          productionSharedCommunityEvidencePlane: false,
          explainablePurchaseAutomationReadiness: true,
          guardedAddAttemptQuantityOne: true,
          qualifiedAddLaneRequiredBeforeSpendReservation: true,
          serverAuthoritativePurchaseIntentPreflight: true,
          preflightBoundPurchaseIntentCreateV2: true,
          operatorAlertConnectorRegistryConfigured: Object.keys(dependencies.operatorAlertConnectorBindings ?? {}).length > 0,
          observerRecipeWitnessRefreshConfigured: dependencies.observerRecipeWitness !== undefined,
          standaloneWitnessRefreshLoadsSigningKeys: false,
          privacyBoundedRepairLandmarks: true,
          nonExecutableRepairSuggestions: true,
          rotatableDeviceCredentials: true,
          recoverableTwoPhaseDeviceCredentialRotation: true,
          hostedDeviceTransportContract: true,
          internalServiceCapabilityPolicyVersion: internalServiceCapabilities.policyVersion,
          workloadScopedInternalServiceAuthorization: true,
          unconfiguredInternalServicesDenied: internalServiceCapabilities.unconfiguredServicesDenied,
          internalServiceCapabilityHeaderAccepted: internalServiceCapabilities.clientCapabilityHeadersAccepted,
          internalServiceCapabilityRegistryConfigured: internalServiceCapabilities.configured,
          internalServiceCapabilityRegistryCount: internalServiceCapabilities.configuredServiceCount,
          internalServiceCapabilityRegistryFingerprint: internalServiceCapabilities.fingerprint,
          internalServiceCapabilityCoverage: internalServiceCapabilities.coverage,
          separateExtensionRuntimeProfiles: true,
          explicitExtensionOriginPolicy: dependencies.extensionOriginValidator !== undefined,
          localExtensionUpdates: localExtensionReleaseEnabled,
          backgroundWorkerRuntime: backgroundWorker.state,
          backgroundWorkerHealthy: backgroundWorker.healthy,
          backgroundWorkerDeployment: backgroundWorker.runtimeKind,
          backgroundWorkerMode: backgroundWorker.mode ?? "embedded",
          backgroundWorkerDeploymentAttested: backgroundWorker.deploymentAttested,
          backgroundWorkerDeploymentContractVersion: backgroundWorker.deploymentContractVersion,
          asyncBackgroundWorkerContract: true,
          standaloneBackgroundWorkerProcessReady: true,
          productionWorkerFleetReady: false,
          executionMode: settings.executionMode,
          actionsPaused: settings.actionsPaused,
          chromeMutationEnabled: targetAddQualified || walmartAddQualified || amazonAddQualified || bestBuyAddQualified,
          targetAddExecutionEnabled: targetAddQualified,
          walmartAddExecutionEnabled: walmartAddQualified,
          amazonAddExecutionEnabled: amazonAddQualified,
          bestBuyAddExecutionEnabled: bestBuyAddQualified,
          observerRecipeWitnessRequired: witness.required === true,
          observerRecipeWitnessState: String(witness.state ?? "disabled"),
          observerRecipeWitnessHealthy: witness.healthy === true,
          observerRecipeDeliveryWitnessSatisfied: witness.deliveryAllowed === true
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/extension/release") {
        if (!localExtensionReleaseEnabled) {
          json(response, 404, { error: "local_extension_release_disabled", message: "Hosted companions use the managed production release channel." });
          return;
        }
        json(response, 200, resolveExtensionRelease(releaseRoot, version).descriptor);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/extension/release/download") {
        if (!localExtensionReleaseEnabled) {
          json(response, 404, { error: "local_extension_release_disabled", message: "Hosted companions use the managed production release channel." });
          return;
        }
        const release = resolveExtensionRelease(releaseRoot, version);
        if (!release.descriptor.packageReady || !release.path) {
          json(response, 404, { error: "extension_release_unavailable", message: "The local extension package has not been built yet." });
          return;
        }
        const body = readFileSync(release.path);
        securityHeaders(response);
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/zip");
        response.setHeader("Content-Disposition", `attachment; filename="${release.descriptor.filename}"`);
        response.setHeader("Content-Length", String(body.length));
        response.setHeader("X-Content-SHA256", release.descriptor.sha256);
        response.end(body);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/privacy") {
        json(response, 200, { inventory: userPrivacy.inventory() });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/privacy/export") {
        const archive = userPrivacy.export();
        const body = Buffer.from(`${JSON.stringify(archive, null, 2)}\n`, "utf8");
        const sha256 = createHash("sha256").update(body).digest("hex");
        const date = archive.generatedAt.slice(0, 10);
        securityHeaders(response);
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Content-Disposition", `attachment; filename="Yoink-My-Data-${date}.json"`);
        response.setHeader("Content-Length", String(body.length));
        response.setHeader("X-Content-SHA256", sha256);
        response.setHeader("X-Yoink-Export-Format", USER_DATA_EXPORT_FORMAT);
        response.end(body);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/overview") {
        const now = Date.now();
        const missions = control.listMissions(20, 0, "", true);
        const settings = control.settings();
        const sourceList = control.listSources();
        const proposalCounts = catalogGovernance.mineCounts();
        const deviceList = devices.listDevices(now);
        const laneQualifications = guardedAddLanes();
        const purchaseIntents = decoratePurchaseIntents(missions, {
          settings,
          sources: sourceList,
          deviceList,
          laneQualifications,
          now
        });
        json(response, 200, {
          version,
          settings,
          counts: {
            products: catalog.libraryCount(),
            purchaseIntents: control.missionCount(),
            signals: signals.signalCount(),
            actions: signals.jobCount(),
            notifications: notifications.counts().totalNotifications,
            ...proposalCounts
          },
          purchaseIntents,
          spend: spendLedger.summary(now, false),
          sources: sourceList,
          guardedAddLanes: laneQualifications,
          setup: buildUserSetupReadiness({
            version,
            companionDownloadUrl: localExtensionReleaseEnabled
              ? "/api/v1/extension/release/download"
              : "",
            devices: deviceList,
            sources: sourceList,
            products: catalog.libraryCount(),
            pendingProductProposals: proposalCounts.pendingCatalogProposals,
            plans: purchaseIntents,
            actionsPaused: settings.actionsPaused === true,
            executionMode: String(settings.executionMode ?? "shadow")
          }),
          walmartDraws: {
            readOnly: true,
            entryMutationAuthorized: false,
            contingentOrderRisk: true,
            latestScan: walmartDraws.latestScan(),
            items: walmartDraws.currentItems()
          },
          permissions: authorization.permissions()
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/authorization") {
        json(response, 200, {
          permissions: authorization.permissions(),
          memberships: authorization.memberships()
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/catalog/proposals") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        json(response, 200, { items: catalogGovernance.listMine(limit, offset) });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/purchase-intents") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        const query = String(requestUrl.searchParams.get("q") ?? "");
        const items = decoratePurchaseIntents(control.listMissions(limit, offset, query, true));
        json(response, 200, { items, total: control.missionCount(query), offset, limit: items.length });
        return;
      }

      if (request.method === "GET" && purchaseIntentOffersMatch) {
        const mission = control.missionDetail(purchaseIntentOffersMatch[1] ?? "");
        if (!mission) throw new ApiError("purchase_intent_not_found", 404, "The purchase intent does not exist.");
        json(response, 200, { items: offerIdentity.listSnapshots(purchaseIntentOffersMatch[1] ?? "", 50) });
        return;
      }

      if (request.method === "GET" && purchaseIntentDetailMatch) {
        const mission = control.missionDetail(purchaseIntentDetailMatch[1] ?? "");
        if (!mission) throw new ApiError("purchase_intent_not_found", 404, "The purchase intent does not exist.");
        json(response, 200, { purchaseIntent: decoratePurchaseIntents([mission])[0] });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/spend") {
        json(response, 200, { summary: spendLedger.summary() });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/spend-ledger") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        json(response, 200, { items: spendLedger.listLedger(limit, offset), summary: spendLedger.summary() });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/admin/catalog/proposals") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        const status = String(requestUrl.searchParams.get("status") ?? "pending") as Parameters<typeof catalogGovernance.listForReview>[0];
        json(response, 200, { items: catalogGovernance.listForReview(status, limit, offset) });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/admin/catalog/identity-operations") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        const status = String(requestUrl.searchParams.get("status") ?? "pending") as "pending" | "applied" | "rejected" | "all";
        json(response, 200, { items: catalogIdentityGovernance.list(status, limit, offset) });
        return;
      }

      if (request.method === "GET" && catalogIdentityOperationDetailMatch) {
        json(response, 200, catalogIdentityGovernance.detail(catalogIdentityOperationDetailMatch[1] ?? ""));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/admin/authorization/roles") {
        json(response, 200, { roles: authorization.roles() });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/admin/authorization/users") {
        json(response, 200, { users: authorization.tenantUsers() });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/alerts") {
        json(response, 200, operatorAlerts.snapshot());
        return;
      }

      const authorizationMembershipMatch = /^\/api\/v1\/admin\/authorization\/users\/([A-Za-z0-9_-]{3,120})\/roles\/([A-Za-z0-9_-]{3,120})$/.exec(requestUrl.pathname);
      const catalogProposalDecisionMatch = /^\/api\/v1\/admin\/catalog\/proposals\/(catalog_proposal_[A-Za-z0-9_-]{16,120})\/decision$/.exec(requestUrl.pathname);

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/pair") {
        const body = pairingBody ?? await readJson(request);
        const paired = devices.pair(body as unknown as PairDeviceInput);
        json(response, 201, { device: paired });
        return;
      }

      const deviceRoute = requestUrl.pathname.startsWith("/api/v1/devices/self/");
      if (deviceRoute) {
        const presentedToken = bearerToken(request);
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/credential-rotation/commit") {
          const body = await readJson(request);
          const committed = devices.commitCredentialRotation(presentedToken, body.generation);
          if (!committed) {
            response.setHeader("WWW-Authenticate", "Bearer");
            json(response, 401, { error: "credential_rotation_unauthorized", message: "The pending Chrome credential is invalid or expired." });
            return;
          }
          json(response, 200, { rotation: committed });
          return;
        }
        const device = devices.authenticate(presentedToken);
        if (!device) {
          response.setHeader("WWW-Authenticate", "Bearer");
          json(response, 401, { error: "device_unauthorized", message: "The Chrome companion must be paired again." });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/heartbeat") {
          const body = await readJson(request);
          const updated = devices.heartbeat(device.id, body as Omit<PairDeviceInput, "pairingCode" | "name">);
          const settings = control.settings();
          const targetAddQualified = qualifications.targetAddQualified();
          const walmartAddQualified = qualifications.walmartAddQualified();
          const amazonAddQualified = qualifications.amazonAddQualified();
          const bestBuyAddQualified = qualifications.bestBuyAddQualified();
          json(response, 200, {
            device: updated,
            credential: devices.credentialStatus(device.id),
            controlPlane: {
              executionMode: settings.executionMode,
              actionsPaused: settings.actionsPaused,
              retailerMutationEnabled: targetAddQualified || walmartAddQualified || amazonAddQualified || bestBuyAddQualified,
              targetAddExecutionEnabled: targetAddQualified,
              walmartAddExecutionEnabled: walmartAddQualified,
              amazonAddExecutionEnabled: amazonAddQualified,
              bestBuyAddExecutionEnabled: bestBuyAddQualified
            }
          });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/credential-rotation/begin") {
          if (device.credentialSlot !== "current") {
            json(response, 409, { error: "credential_rotation_stale", message: "The current Chrome credential is required to begin rotation." });
            return;
          }
          json(response, 201, { rotation: devices.beginCredentialRotation(device) });
          return;
        }
        const shadowObservationMatch = /^\/api\/v1\/devices\/self\/shadow-observations\/(target|walmart|amazon|bestbuy|disney|ravensburger|riot|booksamillion|fanatics|kohls|macys|pbandai|pokemoncenter)$/.exec(requestUrl.pathname);
        if (request.method === "POST" && shadowObservationMatch) {
          const body = await readJson(request);
          if (body.retailerId !== shadowObservationMatch[1]) throw new Error("The retailer observation route and payload must match.");
          json(response, 201, {
            observation: shadowObservations.record(device.id, body as unknown as RetailerShadowObservationInput)
          });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/walmart-draw/scans") {
          const body = await readJson(request);
          json(response, 201, {
            scan: walmartDraws.record(device.id, body as unknown as WalmartDrawScanInput)
          });
          return;
        }
        const adapterDiagnosticMatch = /^\/api\/v1\/devices\/self\/adapter-diagnostics\/(target|walmart|amazon|bestbuy|disney|ravensburger|riot|booksamillion|fanatics|kohls|macys|pbandai|pokemoncenter)$/.exec(requestUrl.pathname);
        if (request.method === "POST" && adapterDiagnosticMatch) {
          const body = await readJson(request);
          if (body.retailerId !== adapterDiagnosticMatch[1]) throw new Error("The adapter diagnostic route and payload must match.");
          const recorded = db.transaction(() => {
            const diagnostic = adapterDiagnostics.record(device.id, body as unknown as RetailerAdapterDiagnosticInput);
            const alertReconciliation = operatorAlerts.reconcileAdapterRepairs(
              adapterDiagnostics.listRepairQueue(2_000),
              correlationId
            );
            return { diagnostic, alertReconciliation };
          });
          json(response, 201, {
            ...recorded
          });
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/api/v1/devices/self/community/status") {
          json(response, 200, {
            capable: device.capabilities.communityReadOnlyEvidence && device.capabilities.exactSelectedOfferEvidence,
            consents: community.consents(),
            counts: community.counts()
          });
          return;
        }
        const communityNonceMatch = /^\/api\/v1\/devices\/self\/community\/nonces\/(target|walmart|amazon|bestbuy|disney|ravensburger|riot|booksamillion|fanatics|kohls|macys|pbandai|pokemoncenter)$/.exec(requestUrl.pathname);
        if (request.method === "POST" && communityNonceMatch) {
          if (!device.capabilities.communityReadOnlyEvidence || !device.capabilities.exactSelectedOfferEvidence) {
            throw new Error("Upgrade the Chrome companion before sharing read-only community evidence.");
          }
          const retailerId = communityNonceMatch[1] as SupportedRetailerId;
          json(response, 201, community.issueNonce(device.id, retailerId));
          return;
        }
        const communityContributionMatch = /^\/api\/v1\/devices\/self\/community\/contributions\/(target|walmart|amazon|bestbuy|disney|ravensburger|riot|booksamillion|fanatics|kohls|macys|pbandai|pokemoncenter)$/.exec(requestUrl.pathname);
        if (request.method === "POST" && communityContributionMatch) {
          if (!device.capabilities.communityReadOnlyEvidence || !device.capabilities.exactSelectedOfferEvidence) {
            throw new Error("Upgrade the Chrome companion before sharing read-only community evidence.");
          }
          const retailerId = communityContributionMatch[1] as SupportedRetailerId;
          const body = await readJson(request);
          json(response, 201, community.contribute(
            device.id,
            retailerId,
            body as unknown as CommunityContributionInput
          ));
          return;
        }
        const observerRecipeMatch = /^\/api\/v1\/devices\/self\/observer-recipes\/(target|walmart|amazon|bestbuy|disney|ravensburger|riot|booksamillion|fanatics|kohls|macys|pbandai|pokemoncenter)$/.exec(requestUrl.pathname);
        if (request.method === "GET" && observerRecipeMatch) {
          if (!device.capabilities.observerRecipeShadow) {
            throw new Error("Upgrade the Chrome companion before requesting observer recipes.");
          }
          const retailerId = observerRecipeMatch[1] as SupportedRetailerId;
          const recipe = observerRecipes.active(retailerId, Date.now(), currentRequestScope().userId);
          const witness = observerRecipes.witnessStatus() as { deliveryAllowed?: boolean; state?: string };
          if (recipe && witness.deliveryAllowed !== true) {
            throw new ApiError(
              "observer_recipe_witness_required",
              503,
              `Observer recipe delivery is closed until the current transparency checkpoint is independently witnessed (${String(witness.state ?? "unavailable")}).`
            );
          }
          json(response, 200, { trust: observerRecipes.trustBundle(), recipe });
          return;
        }
        const observerTrialMatch = /^\/api\/v1\/devices\/self\/observer-recipe-trials\/(target|walmart|amazon|bestbuy|disney|ravensburger|riot|booksamillion|fanatics|kohls|macys|pbandai|pokemoncenter)$/.exec(requestUrl.pathname);
        if (request.method === "POST" && observerTrialMatch) {
          const retailerId = observerTrialMatch[1] as SupportedRetailerId;
          const body = await readJson(request);
          if (body.retailerId !== retailerId) throw new Error("The observer recipe trial route and payload must match.");
          json(response, 201, {
            trial: observerRecipes.recordTrial(device.id, body as unknown as ObserverRecipeTrialInput)
          });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/qualification-trials/target-add") {
          const body = await readJson(request);
          json(response, 201, {
            trial: qualifications.recordTargetAddRehearsal(device.id, body as unknown as TargetAddRehearsalInput)
          });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/qualification-trials/walmart-add") {
          const body = await readJson(request);
          json(response, 201, {
            trial: qualifications.recordWalmartAddRehearsal(device.id, body as unknown as WalmartAddRehearsalInput)
          });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/qualification-trials/amazon-add") {
          const body = await readJson(request);
          json(response, 201, {
            trial: qualifications.recordAmazonAddRehearsal(device.id, body as unknown as AmazonAddRehearsalInput)
          });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/qualification-trials/bestbuy-add") {
          const body = await readJson(request);
          json(response, 201, {
            trial: qualifications.recordBestBuyAddRehearsal(device.id, body as unknown as BestBuyAddRehearsalInput)
          });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/sources/trackalacker/status") {
          const body = await readJson(request);
          json(response, 200, {
            status: sourceRuntime.recordTrackalackerPushStatus(device.id, body as unknown as TrackalackerPushStatusInput)
          });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/sources/trackalacker/sync-runs") {
          const body = await readJson(request);
          json(response, 201, { run: sourceRuntime.startSyncRun(device.id, body as unknown as SourceSyncProgressInput) });
          return;
        }
        const sourceSyncRunMatch = /^\/api\/v1\/devices\/self\/sources\/trackalacker\/sync-runs\/(tlsync_[A-Za-z0-9_-]{8,112})$/.exec(requestUrl.pathname);
        if (request.method === "PATCH" && sourceSyncRunMatch) {
          const body = await readJson(request);
          json(response, 200, {
            run: sourceRuntime.updateSyncRun(device.id, {
              ...(body as unknown as SourceSyncProgressInput),
              syncId: sourceSyncRunMatch[1] ?? ""
            })
          });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/sources/trackalacker/signals") {
          const body = await readJson(request);
          const input = trackalackerSignalInput(
            body,
            request.headers["idempotency-key"],
            scopedSourceConnectionId("trackalacker")
          );
          json(response, 202, signalIngress.acceptTrackalacker(input));
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/sources/trackalacker/catalog") {
          const body = await readJson(request);
          const wrappedItem = body.item && typeof body.item === "object" && !Array.isArray(body.item)
            ? body.item as TrackalackerCatalogItemInput
            : body as unknown as TrackalackerCatalogItemInput;
          const item = catalog.upsertTrackalackerItem(wrappedItem);
          const syncReceipt = typeof body.syncId === "string"
            ? sourceRuntime.recordSyncItem(device.id, body.syncId, wrappedItem.sourceProductId, item)
            : null;
          json(response, 202, {
            item,
            syncReceipt
          });
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/api/v1/devices/self/notifications/next") {
          json(response, 200, notifications.leaseNext(device.id));
          return;
        }
        const notificationAckMatch = /^\/api\/v1\/devices\/self\/notifications\/([A-Za-z0-9_-]{3,160})\/ack$/.exec(requestUrl.pathname);
        if (request.method === "POST" && notificationAckMatch) {
          const body = await readJson(request);
          if (typeof body.capabilityToken !== "string" || !["delivered", "failed"].includes(String(body.outcome))) {
            throw new Error("A valid notification capability and delivery outcome are required.");
          }
          json(response, 200, {
            notification: notifications.acknowledge(
              device.id,
              notificationAckMatch[1] ?? "",
              body.capabilityToken,
              body.outcome as "delivered" | "failed",
              String(body.failureCode ?? "")
            )
          });
          return;
        }
        const notificationInteractionMatch = /^\/api\/v1\/devices\/self\/notifications\/([A-Za-z0-9_-]{3,160})\/interaction$/.exec(requestUrl.pathname);
        if (request.method === "POST" && notificationInteractionMatch) {
          const body = await readJson(request);
          if (!["clicked", "dismissed"].includes(String(body.interaction))) {
            throw new Error("A valid notification interaction is required.");
          }
          json(response, 200, {
            notification: notifications.recordInteraction(
              device.id,
              notificationInteractionMatch[1] ?? "",
              body.interaction as "clicked" | "dismissed"
            )
          });
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/api/v1/devices/self/jobs/next") {
          json(response, 200, execution.leaseNextJob(device.id));
          return;
        }
        const eventMatch = /^\/api\/v1\/devices\/self\/jobs\/([A-Za-z0-9_-]{3,120})\/events$/.exec(requestUrl.pathname);
        if (request.method === "POST" && eventMatch) {
          const body = await readJson(request);
          if (typeof body.capabilityToken !== "string" || !JOB_STATES.includes(body.state as JobState)) {
            throw new Error("A valid action-job capability and next state are required.");
          }
          const evidence = body.evidence && typeof body.evidence === "object" && !Array.isArray(body.evidence)
            ? body.evidence as Record<string, unknown>
            : {};
          json(response, 200, {
            job: execution.reconcileJob(
              device.id,
              eventMatch[1] ?? "",
              body.capabilityToken,
              body.state as JobState,
              String(body.reasonCode ?? "device_report"),
              String(body.message ?? "Chrome reported action progress."),
              evidence
            )
          });
          return;
        }
        json(response, 404, { error: "device_route_not_found", message: "The requested Chrome companion route does not exist." });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/operations/telemetry") {
        const requestedWindow = String(requestUrl.searchParams.get("window") ?? "24h");
        if (!Object.prototype.hasOwnProperty.call(OPERATIONAL_TELEMETRY_WINDOWS, requestedWindow)) {
          throw new ApiError("telemetry_window_invalid", 400, "Choose a telemetry window of 1h, 24h, 7d, or 30d.");
        }
        json(response, 200, {
          telemetry: operationalTelemetry.summary(requestedWindow as OperationalTelemetryWindow)
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/workers") {
        const deployment = await dependencies.backgroundWorkerStatus?.() ?? {
          state: "stopped" as const,
          healthy: false,
          runtimeKind: "local_in_process" as const,
          mode: "disabled" as const,
          lastHeartbeatAt: "",
          lastErrorCode: "not_attached",
          deploymentAttested: false,
          deploymentContractVersion: BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION
        };
        json(response, 200, {
          backgroundWork: {
            ...backgroundTasks.snapshot(),
            deployment: {
              state: deployment.state,
              healthy: deployment.healthy,
              runtimeKind: deployment.runtimeKind,
              mode: deployment.mode ?? "embedded",
              lastHeartbeatAt: deployment.lastHeartbeatAt,
              lastErrorCode: deployment.lastErrorCode,
              attested: deployment.deploymentAttested,
              contractVersion: deployment.deploymentContractVersion
            },
            signalIngress: hostedDelivery.inboxEventCounts(SIGNAL_INGRESS_EVENT_TYPE),
            signalDeadLetters: hostedDelivery.listInboxDeadLettersByEventType(SIGNAL_INGRESS_EVENT_TYPE)
          }
        });
        return;
      }

      if (request.method === "PATCH" && backgroundScheduleMatch) {
        const body = await readJson(request);
        json(response, 200, {
          schedule: backgroundTasks.updateSchedule(backgroundScheduleMatch[1] ?? "", {
            ...(body.enabled !== undefined ? { enabled: body.enabled as boolean } : {}),
            ...(body.intervalSeconds !== undefined ? { intervalSeconds: Number(body.intervalSeconds) } : {})
          }, correlationId)
        });
        return;
      }

      if (request.method === "POST" && backgroundScheduleRunMatch) {
        json(response, 202, {
          task: backgroundTasks.enqueueScheduleNow(backgroundScheduleRunMatch[1] ?? "", correlationId)
        });
        return;
      }

      if (request.method === "POST" && backgroundTaskRetryMatch) {
        json(response, 202, {
          task: backgroundTasks.retryDeadLetter(backgroundTaskRetryMatch[1] ?? "", correlationId)
        });
        return;
      }

      if (request.method === "POST" && signalInboxRetryMatch) {
        json(response, 202, {
          receipt: signalIngress.retryDeadLetter(signalInboxRetryMatch[1] ?? "", correlationId)
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/change-requests") {
        const status = String(requestUrl.searchParams.get("status") ?? "all") as AdminChangeStatus | "all";
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        json(response, 200, {
          items: adminChanges.list(status, limit, offset),
          counts: adminChanges.counts(),
          assurance: adminChanges.assuranceStatus(),
          approvalCapable: authorization.has("change.approve"),
          operationPolicies: Object.fromEntries(Object.entries(ADMIN_CHANGE_OPERATION_POLICIES).map(([key, policy]) => [key, {
            label: policy.label,
            controlLevel: policy.controlLevel
          }]))
        });
        return;
      }

      if (request.method === "GET" && adminChangeRequestDetailMatch) {
        json(response, 200, { request: adminChanges.detail(adminChangeRequestDetailMatch[1] ?? "") });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/snapshot") {
        const pairedDevices = devices.listDevices();
        const operatorAlertCounts = operatorAlerts.counts();
        const operatorAlertConnectorCounts = operatorAlerts.connectorCounts();
        const operatorAlertSnapshot = operatorAlerts.snapshot();
        const observerTrust = observerRecipes.trustStatus();
        const observerWitness = (observerTrust.witness ?? {}) as {
          required?: boolean;
          healthy?: boolean;
          deliveryAllowed?: boolean;
        };
        const targetQualification = shadowObservations.targetQualificationReadiness();
        const walmartQualification = shadowObservations.walmartQualificationReadiness();
        const amazonQualification = shadowObservations.amazonQualificationReadiness();
        const bestBuyQualification = shadowObservations.bestBuyQualificationReadiness();
        const adminChangeCounts = adminChanges.counts();
        const backgroundWork = backgroundTasks.snapshot();
        const signalIngressCounts = hostedDelivery.inboxEventCounts(SIGNAL_INGRESS_EVENT_TYPE);
        const qualifiedAddRetailers = [
          targetQualification.addToCartQualified ? "Target" : "",
          walmartQualification.addToCartQualified ? "Walmart" : "",
          amazonQualification.addToCartQualified ? "Amazon" : "",
          bestBuyQualification.addToCartQualified ? "Best Buy" : ""
        ].filter(Boolean);
        json(response, 200, {
          version,
          settings: control.settings(),
          counts: {
            ...catalog.counts(),
            ...signals.counts(),
            ...notifications.counts(),
            ...audit.outboxCounts(),
            auditEvents: audit.count(),
            missions: control.missionCount(),
            ...spendLedger.counts(),
            devices: pairedDevices.length,
            onlineDevices: pairedDevices.filter((device) => device.online === true).length,
            shadowObservations: shadowObservations.count(),
            ...walmartDraws.counts(),
            ...adapterDiagnostics.counts(),
            ...community.counts(),
            ...identityClaims.counts(),
            ...observerRecipes.counts(),
            ...catalogGovernance.counts(),
            ...catalogIdentityGovernance.counts(),
            ...hostedDelivery.counts(),
            ...operationalTelemetry.counts(),
            adminChangeRequests: adminChangeCounts.total,
            pendingAdminChanges: adminChangeCounts.pending,
            approvedAdminChanges: adminChangeCounts.approved,
            consumedAdminChanges: adminChangeCounts.consumed,
            rejectedAdminChanges: adminChangeCounts.rejected,
            expiredAdminChanges: adminChangeCounts.expired,
            backgroundSchedules: backgroundWork.counts.schedules,
            enabledBackgroundSchedules: backgroundWork.counts.enabledSchedules,
            pendingBackgroundTasks: backgroundWork.counts.pendingTasks,
            retryingBackgroundTasks: backgroundWork.counts.retryingTasks,
            deadLetterBackgroundTasks: backgroundWork.counts.deadLetterTasks,
            onlineBackgroundWorkers: backgroundWork.counts.onlineWorkers,
            queuedSignalMessages: signalIngressCounts.accepted + signalIngressCounts.processing + signalIngressCounts.failed,
            processedSignalMessages: signalIngressCounts.processed,
            deadLetterSignalMessages: signalIngressCounts.deadLetter,
            ...operatorAlertCounts,
            ...operatorAlertConnectorCounts
          },
          sources: control.listSources(),
          strategies: control.listStrategies(),
          attributionPolicies: attribution.listPolicies(),
          attributionReceipts: attribution.listReceipts(100),
          library: [],
          missions: [],
          signals: [],
          jobs: [],
          notifications: notifications.listRecent(100),
          auditEvents: [],
          devices: pairedDevices,
          shadowObservations: shadowObservations.listRecent(50),
          walmartDraws: {
            readOnly: true,
            entryMutationAuthorized: false,
            contingentOrderRisk: true,
            latestScan: walmartDraws.latestScan(),
            items: walmartDraws.currentItems()
          },
          adapterRepairQueue: adapterDiagnostics.listRepairQueue(50),
          community: {
            privacyVersion: "community-readonly-v1",
            advisoryOnly: true,
            mutationAuthority: false,
            selectedOfferScopeVersion: 1,
            contributorVotePolicy: "latest_eligible_per_user",
            priceProjectionMethod: "median",
            productionSharedPlane: false,
            unresolvedPublicationEnabled: false,
            consents: community.consents(),
            assertions: community.listRecent(100),
            aggregates: community.aggregates()
          },
          identityGovernance: {
            catalogRemappingEnabled: false,
            reversibleLocalCatalogOperations: true,
            hostedGlobalCatalogAuthority: false,
            siblingAvailabilityRequiresIndependentValidation: true,
            claims: identityClaims.list(100),
            projections: identityClaims.projections()
          },
          observerRegistry: {
            key: observerRecipes.keyInfo(),
            trust: observerTrust,
            mutationCapable: false,
            trialQuorumPolicy: "latest_per_contributor_sku_layout_stage",
            canaryCohortPercent: OBSERVER_RECIPE_CANARY_COHORT_PERCENT,
            canaryMinimumDurationHours: OBSERVER_RECIPE_CANARY_MINIMUM_DURATION_MS / 3_600_000,
            canaryRegressionAutoKill: true,
            tenantContributorQuorum: true,
            publicIndependentAccountQuorum: false,
            recoveryEvidencePolicy: "oracle_agreed_missing_field_quarantine",
            recoveryEvidenceUserReview: "append_only_owner_confirm_reject_revoke",
            recoveryEvidenceRetention: {
              policyVersion: OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION,
              retentionDays: OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS,
              maximumEvidencePerRun: OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH,
              activityResetsExpiry: true,
              ...observerRecipes.recoveryRetentionStatus(20, false)
            },
            contributorEligibility: observerContributorEligibility.status(100, false),
            regionalConflictSlo: observerRecipes.regionalConflictSloStatus(100),
            recoveryEvidenceReviewAffectsApplication: false,
            recoveryEvidenceApplication: false,
            recipeFieldFill: false,
            recipes: observerRecipes.list(),
            recoveryEvidence: observerRecipes.recoveryEvidence()
          },
          catalogGovernance: {
            directUserWritesEnabled: false,
            reviewCapable: authorization.has("catalog.review"),
            identityProposalCapable: authorization.has("catalog.identity.propose"),
            identityApprovalCapable: authorization.has("catalog.identity.approve"),
            pending: authorization.has("catalog.review") ? catalogGovernance.listForReview("pending", 100, 0) : [],
            identityOperations: catalogIdentityGovernance.list("all", 100, 0)
          },
          authorization: {
            permissions: authorization.permissions(),
            memberships: authorization.memberships(),
            roleAdministrationEnabled: authorization.has("security.manage"),
            changeApprovalEnabled: authorization.has("change.approve"),
            assurance: adminChanges.assuranceStatus(),
            internalServices: internalServiceCapabilities
          },
          operatorAlerts: operatorAlertSnapshot,
          backgroundWork,
          signalIngress: {
            durable: true,
            evaluationBoundary: "standalone_background_worker",
            packagedEventType: SIGNAL_INGRESS_EVENT_TYPE,
            counts: signalIngressCounts
          },
          retailerEvidence: shadowObservations.retailerEvidenceReadiness(),
          targetQualification,
          walmartQualification,
          amazonQualification,
          bestBuyQualification,
          futureMutationLanes: mutationLanes.readiness(),
          trackalacker: sourceRuntime.trackalackerStatus(),
          dataPlane: {
            activeStorageEngine: "sqlite",
            postgresCutover,
            postgresRuntimeReadRoles,
            postgresTenantSessions,
            postgresTenantQueueWrites,
            postgresWorkerControl,
            postgresNotificationRecovery,
            postgresExecutionRecovery,
            postgresOperationalRetention,
            postgresObserverCandidateEvaluation,
            postgresOperatorAlertConnectorDispatch,
            postgresOperatorAlertReconciliation,
            postgresObserverWitnessRefresh,
            postgresHostedDeliveryLeaseRecovery,
            postgresSignalCatalogApply,
            postgresSignalResolutionApply,
            postgresSignalSourceReferenceRefresh,
            postgresSignalTerminalDecisionApply,
            postgresSignalOfferIncidentApply,
            postgresSignalPostIncidentDecisionApply,
            postgresSignalMissionBindingApply,
            postgresSignalStrategyEvaluationApply,
            postgresSignalWriterLockProtocol,
            postgresSignalConstraintConfigApply,
            postgresSignalActionSpendApply
          },
          capabilities: {
            catalog: true,
            selfServiceExactProductLinks: true,
            userSetupReadiness: true,
            explainablePurchaseAutomationReadiness: true,
            guardedAddAttemptQuantityOne: true,
            qualifiedAddLaneRequiredBeforeSpendReservation: true,
            serverAuthoritativePurchaseIntentPreflight: true,
            preflightBoundPurchaseIntentCreateV2: true,
            selfServiceUserDataExport: true,
            userDataExportFormat: USER_DATA_EXPORT_FORMAT,
            selfServiceAccountDeletion: false,
            signalEngine: true,
            chromeReadiness: true,
            devicePairing: true,
            jobLeasing: true,
            chromeNotifications: true,
            targetReadOnlyShadow: true,
            walmartReadOnlyShadow: true,
            walmartDrawReadOnly: true,
            walmartDrawEntryMutation: false,
            walmartDrawContingentOrderAuthorization: false,
            amazonReadOnlyShadow: true,
            amazonEphemeralBuyNowRehearsal: true,
            bestBuyReadOnlyShadow: true,
            retailerReadOnlyShadow: true,
            sanitizedAdapterDiagnostics: true,
            durableAdapterDiagnosticDelivery: true,
            privacyClassifiedOperatorAlerts: true,
            durableOperatorAlertConnectors: true,
            governedOperatorAlertConnectorReplay: true,
            operatorAlertConnectorHealthProjection: true,
            operatorAlertConnectorRegistryConfigured: Object.keys(dependencies.operatorAlertConnectorBindings ?? {}).length > 0,
            privacyBoundedOperationalTelemetry: true,
            durableBackgroundTasks: true,
            backgroundWorkOutsideRequestHandling: true,
            durableSignalIngress: true,
            signalEvaluationOutsideDeviceRequest: true,
            durableObserverRepairCandidateEvaluation: true,
            privacyBoundedObserverRepairFieldCount: 5,
            generatedObserverRepairCandidatesExecutable: false,
            generatedObserverRepairCandidatesAutoPromoted: false,
            generatedObserverRepairRequiresIndependentOracle: true,
            generatedObserverRepairIndependentOracleImplemented: false,
            generatedObserverRepairPackagedOracleImplemented: true,
            generatedObserverRepairPackagedOracleRequiredForPromotion: true,
            generatedObserverRepairIndependentAccountOracleImplemented: false,
            generatedObserverRepairTenantContributorQuorumImplemented: true,
            generatedObserverRepairPublicIndependentAccountQuorumImplemented: false,
            observerRecipePackagedConflictAutoKill: true,
            observerRecipeContributorDeduplicatedQuorumImplemented: true,
            observerRecipeCanaryCohortPercent: OBSERVER_RECIPE_CANARY_COHORT_PERCENT,
            observerRecipeCanaryMinimumDurationHours: OBSERVER_RECIPE_CANARY_MINIMUM_DURATION_MS / 3_600_000,
            observerRecipeCanaryRegressionAutoKill: true,
            observerRecipeRecoveryEvidenceStorageImplemented: true,
            observerRecipeRecoveryUserReviewImplemented: true,
            observerRecipeRecoveryReviewRevocationImplemented: true,
            observerRecipeRecoveryRetentionImplemented: true,
            observerRecipeRecoveryRetentionDays: OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS,
            observerRecipeRecoveryRetentionReceiptsImplemented: true,
            observerRecipeContributorEligibilitySeamImplemented: true,
            observerRecipeContributorEligibilityPolicyVersion: OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_POLICY_VERSION,
            observerRecipeContributorEligibilityMaximumTtlHours:
              OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_MAXIMUM_TTL_MS / 3_600_000,
            observerRecipeExternalIdentityRiskProviderConfigured: false,
            observerRecipeRegionalConflictSloImplemented: true,
            observerRecipeRegionalConflictSloPolicyVersion: OBSERVER_RECIPE_CONFLICT_SLO_POLICY_VERSION,
            observerRecipeRegionalConflictSloWindowDays: OBSERVER_RECIPE_CONFLICT_SLO_WINDOW_DAYS,
            observerRecipeRegionalConflictSloMayDisableReadOnlyDistribution: true,
            observerRecipeRegionalConflictSloMayAuthorizeMutation: false,
            observerRecipeRecoveryReviewAffectsApplication: false,
            observerRecipeRecoveryEvidenceApplicationEnabled: false,
            observerRecipeFieldFillEnabled: false,
            durableObserverRecipeWitnessRefresh: true,
            attestedBackgroundWorkerDeployment: true,
            observerRecipeWitnessRefreshConfigured: dependencies.observerRecipeWitness !== undefined,
            standaloneWitnessRefreshLoadsSigningKeys: false,
            privacyBoundedRepairLandmarks: true,
            nonExecutableRepairSuggestions: true,
            rotatableDeviceCredentials: true,
            recoverableTwoPhaseDeviceCredentialRotation: true,
            hostedDeviceTransportContract: true,
            internalServiceCapabilityPolicyVersion: internalServiceCapabilities.policyVersion,
            workloadScopedInternalServiceAuthorization: true,
            unconfiguredInternalServicesDenied: internalServiceCapabilities.unconfiguredServicesDenied,
            internalServiceCapabilityHeaderAccepted: internalServiceCapabilities.clientCapabilityHeadersAccepted,
            internalServiceCapabilityRegistryConfigured: internalServiceCapabilities.configured,
            internalServiceCapabilityRegistryCount: internalServiceCapabilities.configuredServiceCount,
            separateExtensionRuntimeProfiles: true,
            explicitExtensionOriginPolicy: dependencies.extensionOriginValidator !== undefined,
            hostedDevicePairingScope: dependencies.requestScopeResolver !== undefined,
            localInProcessBackgroundWorker: true,
            asyncBackgroundWorkerContract: true,
            standaloneBackgroundWorkerProcessReady: true,
            boundedMultiPrincipalWorker: true,
            productionWorkerFleetReady: false,
            rawRequestCapture: false,
            signedAuthenticationAssurance: true,
            highRiskChangeControl: true,
            independentSafetyExpansionApproval: true,
            productionIdentityProvider: false,
            operatorAlertMutationAuthority: false,
            communityReadOnlyEvidence: true,
            exactSelectedOfferCommunityEvidence: true,
            communityAdvisoryOnly: true,
            oneCurrentCommunityVotePerContributor: true,
            robustCommunityPriceProjection: true,
            productionSharedCommunityEvidencePlane: false,
            identityClaimGovernance: true,
            automaticCatalogRemapping: false,
            reversibleCatalogIdentityGovernance: true,
            hostedGlobalCatalogAuthority: false,
            signedObserverRecipeRegistry: true,
            externallyWitnessedObserverRecipeTransparency: observerWitness.healthy === true,
            hostedObserverRecipeWitnessRequired: observerWitness.required === true,
            observerRecipeDeliveryWitnessSatisfied: observerWitness.deliveryAllowed === true,
            observerRecipeMutation: false,
            pickupMutation: false,
            prepareCheckoutMutation: false,
            submitOrderMutation: false,
            targetQualificationReadiness: true,
            targetAddOnly: true,
            targetAddQualified: targetQualification.addToCartQualified,
            targetAddMutationAuthorized: targetQualification.mutationAuthorized,
            walmartQualificationReadiness: true,
            walmartAddOnly: true,
            walmartAddQualified: walmartQualification.addToCartQualified,
            walmartAddMutationAuthorized: walmartQualification.mutationAuthorized,
            amazonQualificationReadiness: true,
            amazonAddOnly: true,
            amazonAddQualified: amazonQualification.addToCartQualified,
            amazonAddMutationAuthorized: amazonQualification.mutationAuthorized,
            bestBuyQualificationReadiness: true,
            bestBuyAddOnly: true,
            bestBuyAddQualified: bestBuyQualification.addToCartQualified,
            bestBuyAddMutationAuthorized: bestBuyQualification.mutationAuthorized,
            durableSourceSync: true,
            transactionalAuditOutbox: true,
            authenticatedRequestScopeBoundary: dependencies.requestScopeResolver !== undefined,
            localRequestScopeDefault: dependencies.requestScopeResolver === undefined,
            idempotentHostedInboxOutbox: true,
            hostedPrincipalProvisioning: dependencies.requestScopeResolver !== undefined,
            storageEngine: "sqlite",
            portabilityArchiveFormat: PORTABILITY_FORMAT,
            freshDatabaseRestoreParity: true,
            productionPostgresReady: false,
            postgresCutover,
            postgresRuntimeReadRoles,
            postgresTenantSessions,
            postgresTenantQueueWrites,
            postgresWorkerControl,
            postgresNotificationRecovery,
            postgresExecutionRecovery,
            postgresOperationalRetention,
            postgresObserverCandidateEvaluation,
            postgresOperatorAlertConnectorDispatch,
            postgresOperatorAlertReconciliation,
            postgresObserverWitnessRefresh,
            postgresHostedDeliveryLeaseRecovery,
            postgresSignalCatalogApply,
            postgresSignalResolutionApply,
            postgresSignalSourceReferenceRefresh,
            postgresSignalTerminalDecisionApply,
            postgresSignalOfferIncidentApply,
            postgresSignalPostIncidentDecisionApply,
            postgresSignalMissionBindingApply,
            postgresSignalStrategyEvaluationApply,
            postgresSignalWriterLockProtocol,
            postgresSignalConstraintConfigApply,
            postgresSignalActionSpendApply,
            localExtensionUpdates: localExtensionReleaseEnabled,
            retailerMutation: false,
            reason: qualifiedAddRetailers.length
              ? `${qualifiedAddRetailers.join(", ")} add-only execution ${qualifiedAddRetailers.length === 1 ? "is" : "are"} qualified; every other lane, checkout, and order submission remain disabled.`
              : "Retailer add-only execution remains closed until each lane has evidence, rehearsal, and explicit activation."
          }
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/library") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        const query = String(requestUrl.searchParams.get("q") ?? "");
        const items = catalog.listLibrary(limit, offset, query);
        json(response, 200, { items, total: catalog.libraryCount(query), offset, limit: items.length });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/missions") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        const query = String(requestUrl.searchParams.get("q") ?? "");
        const items = control.listMissions(limit, offset, query);
        json(response, 200, { items, total: control.missionCount(query), offset, limit: items.length });
        return;
      }
      const missionDetailMatch = /^\/api\/v1\/missions\/([A-Za-z0-9_-]{3,120})$/.exec(requestUrl.pathname);
      if (request.method === "GET" && missionDetailMatch) {
        const mission = control.missionDetail(missionDetailMatch[1] ?? "");
        json(response, mission ? 200 : 404, mission
          ? { mission }
          : { error: "mission_not_found", message: "The mission does not exist." });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/signals") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        const query = String(requestUrl.searchParams.get("q") ?? "");
        const items = signals.listSignals(limit, offset, query);
        json(response, 200, { items, total: signals.signalCount(query), offset, limit: items.length });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/jobs") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        const query = String(requestUrl.searchParams.get("q") ?? "");
        const items = signals.listJobs(limit, offset, query);
        json(response, 200, { items, total: signals.jobCount(query), offset, limit: items.length });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/audit") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        const query = String(requestUrl.searchParams.get("q") ?? "");
        const items = audit.list(limit, offset, query);
        json(response, 200, { items, total: audit.count(query), offset, limit: items.length, outbox: audit.outboxCounts() });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/strategies") {
        json(response, 200, { items: control.listStrategies() });
        return;
      }

      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "") && !mutationOriginValidator(request)) {
        json(response, 403, { error: "origin_rejected", message: "This mutation requires an explicitly allowed Yoink origin or trusted service/device scope." });
        return;
      }

      if (adminChangeRequestDecisionMatch && request.method === "POST") {
        const body = await readJson(request);
        json(response, 200, {
          request: adminChanges.decide(
            adminChangeRequestDecisionMatch[1] ?? "",
            body as unknown as { decision: "approve" | "reject"; confirmation: string },
            correlationId
          )
        });
        return;
      }

      if (authorizationMembershipMatch && request.method === "POST") {
        const subjectUserId = authorizationMembershipMatch[1] ?? "";
        const roleId = authorizationMembershipMatch[2] ?? "";
        if (!authorization.tenantUsers().some((user) => user.id === subjectUserId)
          || !authorization.roles().some((role) => role.id === roleId)) {
          throw new ApiError("authorization_subject_not_found", 404, "The authorization user or role does not exist.");
        }
        const governed = adminChanges.execute({
          operationType: "authorization_role_grant",
          targetKey: `${subjectUserId}:${roleId}`,
          payload: { subjectUserId, roleId, action: "grant" },
          summary: { subjectUserId, roleId, action: "Grant role" },
          correlationId,
          ...adminChangeRequestId(request)
        }, () => authorization.grantRole(subjectUserId, roleId));
        if (governed.disposition === "pending_approval") {
          json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
          return;
        }
        json(response, 200, { memberships: governed.result });
        return;
      }

      if (authorizationMembershipMatch && request.method === "DELETE") {
        const subjectUserId = authorizationMembershipMatch[1] ?? "";
        const roleId = authorizationMembershipMatch[2] ?? "";
        if (!authorization.tenantUsers().some((user) => user.id === subjectUserId)
          || !authorization.roles().some((role) => role.id === roleId)) {
          throw new ApiError("authorization_subject_not_found", 404, "The authorization user or role does not exist.");
        }
        const governed = adminChanges.execute({
          operationType: "authorization_role_revoke",
          targetKey: `${subjectUserId}:${roleId}`,
          payload: { subjectUserId, roleId, action: "revoke" },
          summary: { subjectUserId, roleId, action: "Revoke role" },
          correlationId,
          ...adminChangeRequestId(request)
        }, () => authorization.revokeRole(subjectUserId, roleId));
        if (governed.disposition === "pending_approval") {
          json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
          return;
        }
        json(response, 200, { memberships: governed.result });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/alerts/rules") {
        const body = await readJson(request);
        const rule = operatorAlerts.saveRule(body as unknown as OperatorAlertRuleInput);
        const reconciliation = operatorAlerts.reconcileAdapterRepairs(adapterDiagnostics.listRepairQueue(2_000), correlationId);
        json(response, 201, { rule, reconciliation });
        return;
      }

      if (request.method === "PATCH" && operatorAlertRuleMatch) {
        const body = await readJson(request);
        const rule = operatorAlerts.saveRule(body as unknown as OperatorAlertRuleInput, operatorAlertRuleMatch[1] ?? "");
        const reconciliation = operatorAlerts.reconcileAdapterRepairs(adapterDiagnostics.listRepairQueue(2_000), correlationId);
        json(response, 200, { rule, reconciliation });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/alerts/connectors") {
        const body = await readJson(request);
        json(response, 201, { connector: operatorAlerts.saveConnector(body as unknown as OperatorAlertConnectorInput) });
        return;
      }

      if (request.method === "PATCH" && operatorAlertConnectorMatch) {
        const body = await readJson(request);
        json(response, 200, {
          connector: operatorAlerts.saveConnector(body as unknown as OperatorAlertConnectorInput, operatorAlertConnectorMatch[1] ?? "")
        });
        return;
      }

      if (request.method === "POST" && operatorAlertConnectorDeliveryRetryMatch) {
        const body = await readJson(request);
        json(response, 202, {
          delivery: operatorAlerts.replayConnectorDelivery(
            operatorAlertConnectorDeliveryRetryMatch[1] ?? "",
            body as unknown as OperatorAlertConnectorReplayInput,
            correlationId
          )
        });
        return;
      }

      if (request.method === "POST" && operatorAlertIncidentActionMatch) {
        const body = await readJson(request);
        const incidentId = operatorAlertIncidentActionMatch[1] ?? "";
        const incident = operatorAlertIncidentActionMatch[2] === "acknowledge"
          ? operatorAlerts.acknowledge(incidentId, body as unknown as OperatorAlertAcknowledgeInput, correlationId)
          : operatorAlerts.resolve(incidentId, body as unknown as OperatorAlertResolveInput, correlationId);
        json(response, 200, { incident });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/user/purchase-intents/preflight") {
        const body = await readJson(request);
        json(response, 200, {
          preflight: configuredPurchaseIntentPreflight(body as unknown as PurchaseIntentPreflightInput)
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/user/purchase-intents") {
        const body = await readJson(request);
        let result;
        if (body.contractVersion === undefined) {
          const listing = catalog.requireListing(String(body.listingId ?? ""));
          result = control.ensureUserMission(listing.variantId, listing.id);
        } else {
          const now = Date.now();
          const expectedPreflightFingerprint = body.contractVersion === 2
            ? configuredPurchaseIntentPreflight({
                ...body,
                contractVersion: 2,
                confirmation: "PREFLIGHT_EXACT_PURCHASE_PLAN"
              } as unknown as PurchaseIntentPreflightInput, now, String(body.preflightedAt ?? "")).preflightFingerprint
            : "";
          result = control.createConfiguredMission(
            body as unknown as PurchaseIntentCreateInput,
            now,
            expectedPreflightFingerprint
          );
        }
        const purchaseIntent = control.missionDetail(result.mission.id);
        if (!purchaseIntent) throw new Error("The saved purchase intent could not be loaded.");
        json(response, result.created ? 201 : 200, {
          purchaseIntent: decoratePurchaseIntents([purchaseIntent])[0],
          created: result.created
        });
        return;
      }

      if (request.method === "PATCH" && purchaseIntentDetailMatch) {
        const body = await readJson(request);
        const purchaseIntent = control.updateMission(
          purchaseIntentDetailMatch[1] ?? "",
          body as unknown as MissionUpdateInput
        );
        json(response, 200, {
          purchaseIntent: decoratePurchaseIntents([purchaseIntent])[0]
        });
        return;
      }

      if (request.method === "PUT" && requestUrl.pathname === "/api/v1/user/spend-policy") {
        const body = await readJson(request);
        spendLedger.updatePolicy(body as unknown as SpendPolicyUpdateInput);
        json(response, 200, { summary: spendLedger.summary() });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/user/catalog/proposals") {
        const body = await readJson(request);
        json(response, 202, catalogGovernance.proposeListing(body as unknown as CatalogListingInput));
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/user/catalog/link-preview") {
        const body = await readJson(request);
        json(response, 200, { preview: catalogLinks.preview(body.url) });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/user/catalog/link-proposals") {
        const body = await readJson(request);
        json(response, 202, catalogLinks.propose(body as unknown as ExactProductLinkProposalInput));
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/admin/catalog/identity-operations") {
        const body = await readJson(request);
        const result = catalogIdentityGovernance.propose(body as unknown as CatalogIdentityOperationProposalInput);
        json(response, result.disposition === "created" ? 201 : 200, result);
        return;
      }

      if (request.method === "POST" && catalogIdentityOperationDecisionMatch) {
        const body = await readJson(request);
        adminChanges.requireFreshStepUp();
        json(response, 200, catalogIdentityGovernance.decide(
          catalogIdentityOperationDecisionMatch[1] ?? "",
          body as unknown as CatalogIdentityOperationDecisionInput
        ));
        return;
      }

      if (request.method === "POST" && catalogProposalDecisionMatch) {
        const body = await readJson(request);
        adminChanges.requireFreshStepUp();
        json(response, 200, catalogGovernance.decide(
          catalogProposalDecisionMatch[1] ?? "",
          body as unknown as CatalogProposalDecisionInput
        ));
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/hosted-delivery/inbox") {
        const body = await readJson(request);
        json(response, 201, { receipt: hostedDelivery.acceptInbox(body as unknown as HostedInboxInput) });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/hosted/principals") {
        const body = await readJson(request);
        json(response, 201, { principal: principals.provision(body as unknown as HostedPrincipalInput) });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/observer-recipe-eligibility") {
        const body = await readJson(request);
        json(response, 200, {
          eligibility: observerContributorEligibility.attest(
            body as unknown as ObserverRecipeContributorEligibilityInput
          )
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/hosted-delivery/inbox/lease") {
        const body = await readJson(request);
        json(response, 200, { lease: hostedDelivery.leaseInbox(Number(body.leaseSeconds ?? 60)) });
        return;
      }
      const hostedInboxActionMatch = /^\/api\/v1\/hosted-delivery\/inbox\/([A-Za-z0-9_-]{3,120})\/(complete|retry)$/.exec(requestUrl.pathname);
      if (request.method === "POST" && hostedInboxActionMatch) {
        const body = await readJson(request);
        const messageId = hostedInboxActionMatch[1] ?? "";
        if (hostedInboxActionMatch[2] === "complete") {
          json(response, 200, { processed: hostedDelivery.completeInbox(messageId, String(body.capabilityToken ?? "")) });
        } else {
          json(response, 200, {
            disposition: hostedDelivery.retryInbox(
              messageId,
              String(body.capabilityToken ?? ""),
              String(body.reasonCode ?? "delivery_failed"),
              Number(body.retryAfterSeconds ?? 30)
            )
          });
        }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/hosted-delivery/outbox/lease") {
        const body = await readJson(request);
        json(response, 200, { lease: hostedDelivery.leaseOutbox(Number(body.leaseSeconds ?? 60)) });
        return;
      }
      const hostedOutboxActionMatch = /^\/api\/v1\/hosted-delivery\/outbox\/([A-Za-z0-9_-]{3,120})\/(complete|retry)$/.exec(requestUrl.pathname);
      if (request.method === "POST" && hostedOutboxActionMatch) {
        const body = await readJson(request);
        const eventId = hostedOutboxActionMatch[1] ?? "";
        if (hostedOutboxActionMatch[2] === "complete") {
          json(response, 200, { delivered: hostedDelivery.completeOutbox(eventId, String(body.capabilityToken ?? "")) });
        } else {
          json(response, 200, {
            disposition: hostedDelivery.retryOutbox(
              eventId,
              String(body.capabilityToken ?? ""),
              String(body.reasonCode ?? "delivery_failed"),
              Number(body.retryAfterSeconds ?? 30)
            )
          });
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/pairing-code") {
        json(response, 201, { pairing: devices.createPairingCode() });
        return;
      }
      const communityConsentMatch = /^\/api\/v1\/community\/consents\/(target|walmart|amazon|bestbuy|disney|ravensburger|riot|booksamillion|fanatics|kohls|macys|pbandai|pokemoncenter)$/.exec(requestUrl.pathname);
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/community/recovery-evidence") {
        json(response, 200, {
          items: observerRecipes.userRecoveryEvidence(100),
          retention: observerRecipes.recoveryRetentionStatus(20, true),
          contributorEligibility: observerContributorEligibility.status(20, true),
          reviewAffectsApplication: false,
          fieldFillEnabled: false
        });
        return;
      }
      if (request.method === "POST" && observerRecoveryReviewMatch) {
        const body = await readJson(request);
        json(response, 200, {
          review: observerRecipes.reviewRecoveryEvidence(
            observerRecoveryReviewMatch[1] ?? "",
            body as unknown as ObserverRecipeRecoveryReviewInput
          )
        });
        return;
      }
      if (request.method === "PATCH" && communityConsentMatch) {
        const retailerId = communityConsentMatch[1] as SupportedRetailerId;
        const body = await readJson(request);
        if (body.retailerId !== undefined && body.retailerId !== retailerId) {
          throw new Error("The community consent route and payload must match.");
        }
        json(response, 200, {
          consent: community.updateConsent({ ...body, retailerId } as unknown as CommunityConsentUpdateInput)
        });
        return;
      }
      if (request.method === "DELETE" && requestUrl.pathname === "/api/v1/community/contributions") {
        json(response, 200, community.deleteContributions(requestUrl.searchParams.get("retailer") ?? ""));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/identity/claims") {
        const body = await readJson(request);
        json(response, 201, { claim: identityClaims.create(body as unknown as IdentityClaimInput) });
        return;
      }
      const identityReviewMatch = /^\/api\/v1\/identity\/claims\/([A-Za-z0-9_-]{3,120})\/review$/.exec(requestUrl.pathname);
      if (request.method === "POST" && identityReviewMatch) {
        const body = await readJson(request);
        json(response, 200, {
          claim: identityClaims.review(identityReviewMatch[1] ?? "", body as unknown as IdentityClaimReviewInput)
        });
        return;
      }
      if (request.method === "DELETE" && requestUrl.pathname === "/api/v1/identity/claims") {
        json(response, 200, identityClaims.deleteClaims());
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/observer-recipes/trust") {
        json(response, 200, observerRecipes.trustStatus());
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/observer-recipes/witness/publish") {
        const body = await readJson(request);
        if (body.confirmation !== "PUBLISH_OBSERVER_RECIPE_CHECKPOINT") {
          throw new Error("Explicit observer recipe witness publication confirmation is required.");
        }
        adminChanges.requireFreshStepUp();
        const publisher = dependencies.observerRecipeWitness;
        const checkpoint = observerRecipes.witnessCheckpoint();
        if (!publisher || !checkpoint) {
          throw new ApiError(
            "observer_recipe_witness_not_configured",
            409,
            "Configure an independent observer recipe witness and install rooted trust before publishing a checkpoint."
          );
        }
        try {
          const receipt = await publisher.publish(checkpoint, observerRecipes.previousWitnessReceiptHash());
          json(response, 201, { witness: observerRecipes.acceptWitnessReceipt(receipt) });
        } catch (error) {
          const code = error instanceof ObserverRecipeWitnessError ? error.code : "unavailable";
          observerRecipes.recordWitnessFailure(code);
          throw new ApiError(
            `observer_recipe_witness_${code}`,
            code === "unavailable" || code === "stale_receipt" ? 503 : 502,
            "The independent observer recipe witness did not return a valid chain-extending receipt; delivery remains closed."
          );
        }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/observer-recipes/trust-manifests") {
        const body = await readJson(request);
        const generation = Number((body.manifest as { payload?: { generation?: unknown } } | undefined)?.payload?.generation);
        if (body.confirmation !== "INSTALL_ROOTED_OBSERVER_RECIPE_TRUST_MANIFEST"
          || !Number.isSafeInteger(generation) || generation < 1) {
          throw new Error("A valid rooted trust manifest and explicit installation confirmation are required.");
        }
        const governed = adminChanges.execute({
          operationType: "observer_recipe_trust_install",
          targetKey: `manifest_generation_${generation}`,
          payload: body,
          summary: { generation, action: "Install rooted observer trust" },
          correlationId,
          ...adminChangeRequestId(request)
        }, () => observerRecipes.installTrustManifest(body as unknown as ObserverRecipeTrustManifestInstallInput));
        if (governed.disposition === "pending_approval") {
          json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
          return;
        }
        json(response, 201, { trust: governed.result });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/observer-recipes") {
        const body = await readJson(request);
        json(response, 201, { recipe: observerRecipes.propose(body as unknown as ObserverRecipeProposalInput) });
        return;
      }
      const observerRecipeActionMatch = /^\/api\/v1\/observer-recipes\/([A-Za-z0-9_-]{3,120})\/(promote|resign|disable|rollback)$/.exec(requestUrl.pathname);
      if (request.method === "POST" && observerRecipeActionMatch) {
        const recipeId = observerRecipeActionMatch[1] ?? "";
        const action = observerRecipeActionMatch[2];
        const body = await readJson(request);
        if (action === "promote") {
          if (body.confirmation !== "PROMOTE_SIGNED_OBSERVER_RECIPE"
            || !["shadow", "canary", "trusted_read_only"].includes(String(body.targetState))) {
            throw new Error("A valid signed observer recipe promotion is required.");
          }
          const governed = adminChanges.execute({
            operationType: "observer_recipe_promote",
            targetKey: recipeId,
            payload: body,
            summary: { recipeId, targetState: String(body.targetState), action: "Promote signed observer recipe" },
            correlationId,
            ...adminChangeRequestId(request)
          }, () => observerRecipes.promote(recipeId, body as unknown as ObserverRecipePromotionInput));
          if (governed.disposition === "pending_approval") {
            json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
            return;
          }
          json(response, 200, { recipe: governed.result });
        } else if (action === "resign") {
          if (body.confirmation !== "RESIGN_ROOTED_OBSERVER_RECIPE") {
            throw new Error("Explicit rooted observer recipe re-signing is required.");
          }
          const governed = adminChanges.execute({
            operationType: "observer_recipe_resign",
            targetKey: recipeId,
            payload: body,
            summary: { recipeId, action: "Re-sign rooted observer recipe" },
            correlationId,
            ...adminChangeRequestId(request)
          }, () => observerRecipes.resign(recipeId, body as unknown as ObserverRecipeResignInput));
          if (governed.disposition === "pending_approval") {
            json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
            return;
          }
          json(response, 200, { recipe: governed.result });
        } else if (action === "disable") {
          if (body.confirmation !== "DISABLE_OBSERVER_RECIPE") throw new Error("Explicit observer recipe kill-switch confirmation is required.");
          const reasonCode = String(body.reasonCode ?? "maintainer_kill_switch");
          const governed = adminChanges.execute({
            operationType: "observer_recipe_disable",
            targetKey: recipeId,
            payload: body,
            summary: { recipeId, reasonCode, action: "Disable observer recipe" },
            correlationId,
            ...adminChangeRequestId(request)
          }, () => observerRecipes.disable(recipeId, reasonCode));
          if (governed.disposition === "pending_approval") {
            json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
            return;
          }
          json(response, 200, { recipe: governed.result });
        } else {
          if (body.confirmation !== "ROLLBACK_OBSERVER_RECIPE") throw new Error("Explicit observer recipe rollback confirmation is required.");
          const governed = adminChanges.execute({
            operationType: "observer_recipe_rollback",
            targetKey: recipeId,
            payload: body,
            summary: { recipeId, action: "Roll back observer recipe" },
            correlationId,
            ...adminChangeRequestId(request)
          }, () => observerRecipes.rollback(recipeId));
          if (governed.disposition === "pending_approval") {
            json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
            return;
          }
          json(response, 200, governed.result);
        }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/qualifications/target-add/activate") {
        const body = await readJson(request);
        if (body.adapterVersion !== TARGET_ADD_ADAPTER_VERSION
          || body.confirmation !== TARGET_ADD_ACTIVATION_CONFIRMATION
          || !/^[a-f0-9]{64}$/.test(String(body.evidenceHash ?? ""))) {
          throw new Error("Explicit Target add-only activation confirmation and current evidence are required.");
        }
        const governed = adminChanges.execute({
          operationType: "retailer_lane_activate",
          targetKey: "target",
          payload: body,
          summary: { retailerId: "target", action: "Activate guarded add-only execution" },
          correlationId,
          ...adminChangeRequestId(request)
        }, () => qualifications.activateTargetAdd(body as unknown as TargetAddActivationInput));
        if (governed.disposition === "pending_approval") {
          json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
          return;
        }
        json(response, 200, governed.result);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/qualifications/walmart-add/activate") {
        const body = await readJson(request);
        if (body.adapterVersion !== WALMART_ADD_ADAPTER_VERSION
          || body.confirmation !== WALMART_ADD_ACTIVATION_CONFIRMATION
          || !/^[a-f0-9]{64}$/.test(String(body.evidenceHash ?? ""))) {
          throw new Error("Explicit Walmart add-only activation confirmation and current evidence are required.");
        }
        const governed = adminChanges.execute({
          operationType: "retailer_lane_activate",
          targetKey: "walmart",
          payload: body,
          summary: { retailerId: "walmart", action: "Activate guarded add-only execution" },
          correlationId,
          ...adminChangeRequestId(request)
        }, () => qualifications.activateWalmartAdd(body as unknown as WalmartAddActivationInput));
        if (governed.disposition === "pending_approval") {
          json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
          return;
        }
        json(response, 200, governed.result);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/qualifications/amazon-add/activate") {
        const body = await readJson(request);
        if (body.adapterVersion !== AMAZON_ADD_ADAPTER_VERSION
          || body.confirmation !== AMAZON_ADD_ACTIVATION_CONFIRMATION
          || !/^[a-f0-9]{64}$/.test(String(body.evidenceHash ?? ""))) {
          throw new Error("Explicit Amazon add-only activation confirmation and current evidence are required.");
        }
        const governed = adminChanges.execute({
          operationType: "retailer_lane_activate",
          targetKey: "amazon",
          payload: body,
          summary: { retailerId: "amazon", action: "Activate guarded add-only execution" },
          correlationId,
          ...adminChangeRequestId(request)
        }, () => qualifications.activateAmazonAdd(body as unknown as AmazonAddActivationInput));
        if (governed.disposition === "pending_approval") {
          json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
          return;
        }
        json(response, 200, governed.result);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/qualifications/bestbuy-add/activate") {
        const body = await readJson(request);
        if (body.adapterVersion !== BESTBUY_ADD_ADAPTER_VERSION
          || body.confirmation !== BESTBUY_ADD_ACTIVATION_CONFIRMATION
          || !/^[a-f0-9]{64}$/.test(String(body.evidenceHash ?? ""))) {
          throw new Error("Explicit Best Buy add-only activation confirmation and current evidence are required.");
        }
        const governed = adminChanges.execute({
          operationType: "retailer_lane_activate",
          targetKey: "bestbuy",
          payload: body,
          summary: { retailerId: "bestbuy", action: "Activate guarded add-only execution" },
          correlationId,
          ...adminChangeRequestId(request)
        }, () => qualifications.activateBestBuyAdd(body as unknown as BestBuyAddActivationInput));
        if (governed.disposition === "pending_approval") {
          json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
          return;
        }
        json(response, 200, governed.result);
        return;
      }
      const revokeMatch = /^\/api\/v1\/devices\/([A-Za-z0-9_-]{3,120})\/revoke$/.exec(requestUrl.pathname);
      if (request.method === "POST" && revokeMatch) {
        const revoked = devices.revoke(revokeMatch[1] ?? "");
        json(response, revoked ? 200 : 404, revoked
          ? { revoked: true }
          : { error: "device_not_found", message: "The active paired device was not found." });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/catalog/listings") {
        const body = await readJson(request);
        json(response, 202, catalogGovernance.proposeListing(body as unknown as CatalogListingInput));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/signals") {
        const body = await readJson(request);
        const result = engine.process(body as unknown as SignalEventInput);
        json(response, 202, result);
        return;
      }
      const reviewResolutionMatch = /^\/api\/v1\/jobs\/([A-Za-z0-9_-]{3,120})\/resolve$/.exec(requestUrl.pathname);
      if (request.method === "POST" && reviewResolutionMatch) {
        const body = await readJson(request);
        if (!["confirmed", "cancelled"].includes(String(body.outcome))) {
          throw new Error("A supported manual-review outcome is required.");
        }
        json(response, 200, {
          job: signals.resolveReviewJob(
            reviewResolutionMatch[1] ?? "",
            body.outcome as "confirmed" | "cancelled",
            String(body.confirmation ?? ""),
            String(body.note ?? "")
          )
        });
        return;
      }
      if (request.method === "PUT" && requestUrl.pathname === "/api/v1/strategies") {
        const body = await readJson(request);
        if (!Array.isArray(body.strategies)) throw new Error("The strategies field must be a list.");
        json(response, 200, { items: control.replaceStrategies(body.strategies as StrategyDefinition[]) });
        return;
      }
      if (request.method === "PATCH" && missionDetailMatch) {
        const body = await readJson(request);
        json(response, 200, { mission: control.updateMission(missionDetailMatch[1] ?? "", body as unknown as MissionUpdateInput) });
        return;
      }
      if (request.method === "PATCH" && requestUrl.pathname === "/api/v1/settings") {
        const body = await readJson(request);
        json(response, 200, { settings: control.updateSettings(body as unknown as AppSettingsUpdateInput) });
        return;
      }
      if (request.method === "PUT" && [
        "/api/v1/attribution-policies",
        "/api/v1/admin/attribution-policies"
      ].includes(requestUrl.pathname)) {
        const body = await readJson(request);
        if (!Array.isArray(body.policies)) throw new Error("The policies field must be a list.");
        const enabledCount = body.policies.filter((policy) => policy && typeof policy === "object"
          && (policy as Record<string, unknown>).enabled === true).length;
        const governed = adminChanges.execute({
          operationType: "affiliate_policy_replace",
          targetKey: "tenant_policies",
          payload: body,
          summary: {
            policyCount: body.policies.length,
            enabledCount,
            action: "Replace affiliate policies"
          },
          correlationId,
          ...adminChangeRequestId(request)
        }, () => attribution.replacePolicies(body.policies as AttributionPolicyUpdateInput[]));
        if (governed.disposition === "pending_approval") {
          json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
          return;
        }
        json(response, 200, { policies: governed.result });
        return;
      }
      if (request.method === "PATCH" && requestUrl.pathname === "/api/v1/settings/actions") {
        const body = await readJson(request);
        if (typeof body.paused !== "boolean") throw new Error("The paused field must be true or false.");
        if (body.paused === false
          && !qualifications.targetAddQualified()
          && !qualifications.walmartAddQualified()
          && !qualifications.amazonAddQualified()
          && !qualifications.bestBuyAddQualified()) {
          throw new Error("At least one add-only retailer lane must be explicitly qualified before actions can be enabled.");
        }
        if (body.paused === true) {
          json(response, 200, { settings: control.setActionsPaused(true, String(body.reason ?? "User paused global purchase actions.")) });
          return;
        }
        const governed = adminChanges.execute({
          operationType: "global_actions_resume",
          targetKey: "global_actions",
          payload: body,
          summary: { action: "Resume global purchase actions" },
          correlationId,
          ...adminChangeRequestId(request)
        }, () => control.setActionsPaused(false, String(body.reason ?? "User resumed global purchase actions.")));
        if (governed.disposition === "pending_approval") {
          json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
          return;
        }
        json(response, 200, { settings: governed.result });
        return;
      }

      json(response, 404, { error: "not_found", message: "The requested Yoink route does not exist." });
      });
    } catch (error) {
      const problem = apiErrorPayload(error, correlationId);
      telemetryErrorCode = problem.payload.error;
      json(response, problem.status, problem.payload);
    }
  });
}
