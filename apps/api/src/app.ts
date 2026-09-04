import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import {
  ADD_LANES,
  ADD_LANE_IDS,
  addLane,
  RETAILER_OBSERVER_VERSIONS,
  JOB_STATES,
  type AddLaneId,
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
  type LegacyPurchaseIntentTransitionInput,
  type MissionUpdateInput,
  type PurchaseIntentCreateInput,
  type PurchaseIntentDeleteInput,
  type PurchaseIntentPreflightInput,
  type PurchaseProfileApplyInput,
  type PurchaseProfileInput,
  PURCHASE_INTENT_PREFLIGHT_TTL_SECONDS,
  type OperatorAlertAcknowledgeInput,
  type OperatorAlertConnectorInput,
  type OperatorAlertConnectorReplayInput,
  type OperatorAlertResolveInput,
  type OperatorAlertRuleInput,
  type SpendPolicyUpdateInput,
  type RetailerAdapterDiagnosticInput,
  type RetailerReverificationRunInput,
  type RetailerShadowObservationInput,
  type SignalEventInput,
  type SourceSyncProgressInput,
  type StrategyDefinition,
  type SupportedRetailerId,
  type TrackalackerCatalogItemInput,
  type TrackalackerPushStatusInput,
  type TrackalackerRawFieldSample,
  type TargetAddActivationInput,
  type TargetAddRehearsalInput,
  type TargetShadowObservationInput,
  type WalmartAddActivationInput,
  type WalmartAddRehearsalInput,
  type WalmartDrawScanInput
} from "../../../packages/contracts/src/index.js";
import { SIGNAL_INGRESS_EVENT_TYPE } from "../../../packages/contracts/src/signal-ingress.js";
import type {
  DiscordChannelSignalInput,
  SignalProviderChannelInput,
  SignalProviderChannelUpdate,
  SignalProviderEnvelope
} from "../../../packages/contracts/src/signal-provider.js";
import type {
  DropWindowCancelReason,
  DropWindowInput,
  DropWindowUpdateInput,
  OrderConfirmationObservationInput,
  RetailerSessionReadinessInput,
  UserActionConnectorInput,
  WatchQueueMode,
  WatchQueueObservationInput
} from "../../../packages/contracts/src/action-platform.js";
import {
  PRIVACY_CHANGE_VERSION,
  WATCH_QUEUE_MODE_CONFIRMATION
} from "../../../packages/contracts/src/action-platform.js";
import {
  deriveWalmartPurchaseHandoff,
  withWalmartPurchaseHandoff
} from "./walmart-purchase-handoff.js";
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
  EvidenceCapsuleStore,
  EvidenceCapsuleStoreError
} from "../../../packages/database/src/evidence-capsule-store.js";
import {
  ADMIN_CHANGE_OPERATION_POLICIES,
  AdminChangeControlRepository,
  type AdminChangeStatus
} from "../../../packages/database/src/admin-change-control-repository.js";
import { AuthorizationRepository } from "../../../packages/database/src/authorization-repository.js";
import { AdminOverviewRepository } from "../../../packages/database/src/admin-overview-repository.js";
import { AdminAnalyticsRepository } from "../../../packages/database/src/admin-analytics-repository.js";
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
import { StoreLinkInteractionRepository } from "../../../packages/database/src/store-link-interaction-repository.js";
import {
  WalmartPurchaseHandoffInteractionRepository,
  type WalmartPurchaseHandoffRouteKind,
  type WalmartPurchaseHandoffSurface
} from "../../../packages/database/src/walmart-purchase-handoff-interaction-repository.js";
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
import { postgresSignalTargetQualificationCapabilityProjection } from "../../../packages/database/src/postgres-signal-target-qualification-apply.js";
import { postgresSignalSourceTrustCapabilityProjection } from "../../../packages/database/src/postgres-signal-source-trust-apply.js";
import { postgresSignalRetailerQualificationCapabilityProjection } from "../../../packages/database/src/postgres-signal-retailer-qualification-apply.js";
import { postgresSignalMissionPolicyCapabilityProjection } from "../../../packages/database/src/postgres-signal-mission-policy-apply.js";
import { postgresSignalSourceStatusCapabilityProjection } from "../../../packages/database/src/postgres-signal-source-status-apply.js";
import { postgresSignalSourceSyncCapabilityProjection } from "../../../packages/database/src/postgres-signal-source-sync-apply.js";
import { postgresSignalReservationLifecycleCapabilityProjection } from "../../../packages/database/src/postgres-signal-reservation-lifecycle-apply.js";
import { postgresSignalCatalogImportCapabilityProjection } from "../../../packages/database/src/postgres-signal-catalog-import-apply.js";
import { postgresSignalSourceProvisioningCapabilityProjection } from "../../../packages/database/src/postgres-signal-source-provisioning-apply.js";
import { postgresSignalAttributionPolicyCapabilityProjection } from "../../../packages/database/src/postgres-signal-attribution-policy-apply.js";
import { postgresSignalEvaluationCompositionCapabilityProjection } from "../../../packages/database/src/postgres-signal-evaluation-composition.js";
import { postgresSignalAttributionReceiptCapabilityProjection } from "../../../packages/database/src/postgres-signal-attribution-receipt-apply.js";
import { postgresSignalJobLifecycleCapabilityProjection } from "../../../packages/database/src/postgres-signal-job-lifecycle-apply.js";
import { postgresSignalEvaluationRepositoryCompositionCapabilityProjection } from "../../../packages/database/src/postgres-signal-evaluation-repository-composition.js";
import { postgresSignalIngressEnqueueApplyCapabilityProjection } from "../../../packages/database/src/postgres-signal-ingress-enqueue-apply.js";
import { postgresSignalIngressCompositionCapabilityProjection } from "../../../packages/database/src/postgres-signal-ingress-composition.js";
import { postgresSignalDeadLetterResetCapabilityProjection } from "../../../packages/database/src/postgres-signal-dead-letter-reset-apply.js";
import { postgresSignalNotificationEnsureCapabilityProjection } from "../../../packages/database/src/postgres-signal-notification-ensure-apply.js";
import { postgresSignalHandlerCompositionCapabilityProjection } from "../../../packages/database/src/postgres-signal-handler-composition.js";
import {
  PrincipalRepository,
  type HostedPrincipalInput
} from "../../../packages/database/src/principal-repository.js";
import { QualificationRepository } from "../../../packages/database/src/qualification-repository.js";
import {
  LOCAL_REQUEST_SCOPE,
  currentRequestScope,
  isExactLocalRequestScope,
  runWithRequestScope,
  scopedSourceConnectionId,
  type RequestScope
} from "../../../packages/database/src/request-scope.js";
import { SignalRepository } from "../../../packages/database/src/signal-repository.js";
import { SignalProviderRepository } from "../../../packages/database/src/signal-provider-repository.js";
import { DropWindowRepository } from "../../../packages/database/src/drop-window-repository.js";
import { RetailerReadinessRepository } from "../../../packages/database/src/retailer-readiness-repository.js";
import { UserActionConnectorRepository } from "../../../packages/database/src/user-action-connector-repository.js";
import { OrderConfirmationRepository } from "../../../packages/database/src/order-confirmation-repository.js";
import { PrivacyComplianceRepository } from "../../../packages/database/src/privacy-compliance-repository.js";
import { RestockPatternRepository } from "../../../packages/database/src/restock-pattern-repository.js";
import { ActionAnalyticsRepository } from "../../../packages/database/src/action-analytics-repository.js";
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
import { AdminSignalSimulator } from "../../../packages/engine/src/admin-signal-simulator.js";
import { DurableSignalIngressService } from "../../../packages/engine/src/signal-ingress.js";
import { newId, stableHash } from "../../../packages/domain/src/ids.js";
import { BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION } from "../../../packages/domain/src/background-worker-deployment.js";
import {
  buildPurchaseAutomationReadiness,
  type PurchaseAutomationPlanInput,
  type PurchaseAutomationTargetInput
} from "../../../packages/domain/src/purchase-automation-readiness.js";
import { buildUserSetupReadiness } from "../../../packages/domain/src/user-setup.js";
import { actionStatusGlossaryProjection } from "../../../packages/domain/src/action-status.js";
import { currentUserReleaseAnnouncement } from "../../../packages/domain/src/release-announcement.js";
import { discordSignalEnvelope } from "../../../packages/sources/src/discord.js";
import { trackalackerSignalInput } from "../../../packages/sources/src/trackalacker.js";
import { ObserverRecipeTrustAuthority } from "../../../packages/observer-registry/src/trust.js";
import {
  ObserverRecipeWitnessError,
  type ObserverRecipeWitnessPublisher
} from "../../../packages/observer-registry/src/witness.js";
import { resolveExtensionRelease } from "./extension-release.js";
import { ApiError, apiErrorPayload } from "./api-error.js";
import { operationalRouteKey, resolveApiRoutePolicy } from "./api-route-policy.js";
import { presentShopperPurchaseIntent } from "./purchase-intent-presentation.js";
import {
  DEVICE_ACTION_HANDOFF_WAIT_MAX_MS,
  DEVICE_ACTION_JOB_FALLBACK_RECHECK_MS,
  DEVICE_ACTION_JOB_RAPID_RECHECK_MS,
  DEVICE_ACTION_JOB_WAIT_MAX_MS,
  DEVICE_NOTIFICATION_WAIT_MAX_MS,
  USER_ACTION_HANDOFF_WAIT_MAX_MS,
  type ActionJobAvailabilityPulse
} from "./action-job-availability.js";
import {
  emptyInternalServiceCapabilityProjection,
  type InternalServiceCapabilityProjection
} from "./internal-service-capabilities.js";

const MAX_BODY_BYTES = 1_000_000;
const MAX_EVIDENCE_CAPSULE_BODY_BYTES = 5 * 1024 * 1024;
const STATIC_FILES = new Map([
  ["/", "user.html"],
  ["/index.html", "user.html"],
  ["/user.js", "user.js"],
  ["/user.css", "user.css"],
  ["/tokens.css", "tokens.css"],
  ["/components.css", "components.css"],
  ["/dialogs.js", "dialogs.js"],
  ["/dialogs.css", "dialogs.css"],
  ["/status.js", "status.js"],
  ["/status.css", "status.css"],
  ["/admin", "index.html"],
  ["/admin/", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"],
  ["/docs", "docs.html"],
  ["/docs/", "docs.html"],
  ["/docs.html", "docs.html"],
  ["/docs.css", "docs.css"],
  ["/llms.txt", "llms.txt"],
  ["/privacy", "privacy.html"],
  ["/privacy/", "privacy.html"],
  ["/privacy.js", "privacy.js"],
  ["/fonts/manrope.woff2", "fonts/manrope.woff2"]
]);
const ADMIN_STATIC_PATHS = new Set(["/admin", "/admin/", "/app.js", "/styles.css"]);
const ADMIN_SNAPSHOT_VIEW_IDS = [
  "overview", "library", "strategies", "missions", "signals", "actions", "notifications", "attribution", "activity",
  "analytics", "operations", "approvals", "catalog-reviews", "alerts", "community", "settings", "access", "connections"
] as const;
type AdminSnapshotView = typeof ADMIN_SNAPSHOT_VIEW_IDS[number];
const ADMIN_SNAPSHOT_VIEWS = new Set<string>(ADMIN_SNAPSHOT_VIEW_IDS);

function companionCompatibility(appVersion: string, installedVersion: string): {
  compatible: boolean;
  reason: "compatible" | "major_minor_mismatch" | "development_version";
} {
  const parse = (value: string) => /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value || "").trim());
  const app = parse(appVersion);
  const installed = parse(installedVersion);
  if (!app || !installed) return { compatible: true, reason: "development_version" };
  return app[1] === installed[1] && app[2] === installed[2]
    ? { compatible: true, reason: "compatible" }
    : { compatible: false, reason: "major_minor_mismatch" };
}

export interface AppDependencies {
  db: YoinkDatabase;
  webRoot: string;
  releaseRoot?: string;
  observerRecipeTrust?: ObserverRecipeTrustAuthority;
  observerRecipeWitness?: ObserverRecipeWitnessPublisher;
  observerRecipeWitnessRequired?: boolean;
  operatorAlertConnectorBindings?: Readonly<Record<string, string>>;
  userActionConnectorBindings?: Readonly<Record<string, string>>;
  backgroundWorkerWake?: () => void | Promise<void>;
  actionJobAvailability?: ActionJobAvailabilityPulse;
  backgroundWorkerRestart?: () => Promise<void>;
  internalServiceCapabilityRegistry?: InternalServiceCapabilityProjection;
  requestScopeResolver?: (
    request: IncomingMessage,
    context?: { body?: Record<string, unknown> }
  ) => RequestScope | Promise<RequestScope>;
  hostValidator?: (request: IncomingMessage) => boolean;
  mutationOriginValidator?: (request: IncomingMessage) => boolean;
  extensionOriginValidator?: (request: IncomingMessage) => boolean;
  localExtensionReleaseEnabled?: boolean;
  /** Explicit deployment boundary: hosted services never accept or expose page capsules. */
  hosted?: boolean;
  /** Root containing yoink.sqlite; local capsules use its filesystem-only evidence/ child. */
  dataDirectory?: string;
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

function boundedWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    maxAllInCents: plan.maxAllInCents === null || plan.maxAllInCents === undefined
      ? intentPolicy.maxAllInCents === null || intentPolicy.maxAllInCents === undefined
        ? null
        : Number(intentPolicy.maxAllInCents)
      : Number(plan.maxAllInCents),
    actionCeiling: String(plan.actionCeiling ?? intentPolicy.actionCeiling ?? "notify"),
    decisionMode: String(plan.decisionMode ?? intentPolicy.decisionMode ?? "strategy"),
    expiresAt: String(plan.expiresAt ?? intentPolicy.expiresAt ?? ""),
    targets
  };
}

function userPurchaseIntentUpdateInput(body: Record<string, unknown>): MissionUpdateInput {
  const normalized: Record<string, unknown> = { ...body };
  if (Array.isArray(body.targets)) {
    normalized.targets = body.targets.map((target) => {
      if (!target || typeof target !== "object" || Array.isArray(target)) return target;
      const record = target as Record<string, unknown>;
      return { ...record, sellerPolicy: record.sellerPolicy ?? "first_party_only" };
    });
  }
  if (body.policy && typeof body.policy === "object" && !Array.isArray(body.policy)) {
    const policy = body.policy as Record<string, unknown>;
    normalized.policy = { ...policy, substitutionPolicy: policy.substitutionPolicy ?? "exact_only" };
  }
  return normalized as unknown as MissionUpdateInput;
}

async function readJson(request: IncomingMessage, maximumBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLocaleLowerCase("en-US");
  if (contentType !== "application/json") {
    throw new ApiError("unsupported_media_type", 415, "Requests with a body must use application/json.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maximumBytes) throw new ApiError("request_body_too_large", 413, "The request body is too large.");
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("invalid_json", 400, "The request body is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("json_object_required", 400, "A JSON object is required.");
  }
  return value as Record<string, unknown>;
}

const STATIC_VERSION_TOKEN = "{{YOINK_VERSION}}";
const STATIC_PRIVACY_CHANGE_VERSION_TOKEN = "{{PRIVACY_CHANGE_VERSION}}";

function staticDocumentVersion(version: string, html: boolean): string {
  const singleLineVersion = String(version || "unknown").replace(/[\r\n]/g, "");
  if (!html) return singleLineVersion;
  return singleLineVersion
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function staticResponse(response: ServerResponse, webRoot: string, pathname: string, version: string): boolean {
  const file = STATIC_FILES.get(pathname);
  if (!file) return false;
  const path = join(webRoot, file);
  let body: Buffer;
  try {
    body = readFileSync(path);
    const extension = extname(file);
    if (extension === ".html" || extension === ".txt") {
      body = Buffer.from(body.toString("utf8")
        .replaceAll(STATIC_VERSION_TOKEN, staticDocumentVersion(version, extension === ".html"))
        .replaceAll(
          STATIC_PRIVACY_CHANGE_VERSION_TOKEN,
          staticDocumentVersion(PRIVACY_CHANGE_VERSION, extension === ".html")
        ));
    }
  } catch {
    json(response, 503, { error: "ui_unavailable", message: "The Yoink control-center files are unavailable." });
    return true;
  }
  securityHeaders(response);
  response.statusCode = 200;
  response.setHeader("Content-Type", extname(file) === ".css"
    ? "text/css; charset=utf-8"
    : extname(file) === ".js"
      ? "text/javascript; charset=utf-8"
      : extname(file) === ".woff2"
        ? "font/woff2"
        : extname(file) === ".txt" ? "text/plain; charset=utf-8" : "text/html; charset=utf-8");
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
  const hosted = dependencies.hosted === true;
  const evidenceCapsules = new EvidenceCapsuleStore(dependencies.dataDirectory ?? join(process.cwd(), "data"));
  const notifyActionJobAvailability = (rapid = false): void => {
    try {
      dependencies.actionJobAvailability?.notify(rapid ? { rapid: true } : undefined);
    } catch {
      // Availability is a latency optimization; the bounded watch remains authoritative on timeout.
    }
  };
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
  const postgresSignalTargetQualificationApply =
    postgresSignalTargetQualificationCapabilityProjection();
  const postgresSignalSourceTrustApply =
    postgresSignalSourceTrustCapabilityProjection();
  const postgresSignalRetailerQualificationApply =
    postgresSignalRetailerQualificationCapabilityProjection();
  const postgresSignalMissionPolicyApply =
    postgresSignalMissionPolicyCapabilityProjection();
  const postgresSignalSourceStatusApply =
    postgresSignalSourceStatusCapabilityProjection();
  const postgresSignalSourceSyncApply =
    postgresSignalSourceSyncCapabilityProjection();
  const postgresSignalReservationLifecycleApply =
    postgresSignalReservationLifecycleCapabilityProjection();
  const postgresSignalCatalogImportApply =
    postgresSignalCatalogImportCapabilityProjection();
  const postgresSignalSourceProvisioningApply =
    postgresSignalSourceProvisioningCapabilityProjection();
  const postgresSignalAttributionPolicyApply =
    postgresSignalAttributionPolicyCapabilityProjection();
  const postgresSignalEvaluationComposition =
    postgresSignalEvaluationCompositionCapabilityProjection();
  const postgresSignalAttributionReceiptApply =
    postgresSignalAttributionReceiptCapabilityProjection();
  const postgresSignalJobLifecycleApply =
    postgresSignalJobLifecycleCapabilityProjection();
  const postgresSignalEvaluationRepositoryComposition =
    postgresSignalEvaluationRepositoryCompositionCapabilityProjection();
  const postgresSignalIngressEnqueueApply =
    postgresSignalIngressEnqueueApplyCapabilityProjection();
  const postgresSignalIngressComposition =
    postgresSignalIngressCompositionCapabilityProjection();
  const postgresSignalDeadLetterResetApply =
    postgresSignalDeadLetterResetCapabilityProjection();
  const postgresSignalNotificationEnsureApply =
    postgresSignalNotificationEnsureCapabilityProjection();
  const postgresSignalHandlerComposition =
    postgresSignalHandlerCompositionCapabilityProjection();
  const postgresDataPlane = Object.freeze({
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
    postgresSignalActionSpendApply,
    postgresSignalTargetQualificationApply,
    postgresSignalSourceTrustApply,
    postgresSignalRetailerQualificationApply,
    postgresSignalMissionPolicyApply,
    postgresSignalSourceStatusApply,
    postgresSignalSourceSyncApply,
    postgresSignalReservationLifecycleApply,
    postgresSignalCatalogImportApply,
    postgresSignalSourceProvisioningApply,
    postgresSignalAttributionPolicyApply,
    postgresSignalEvaluationComposition,
    postgresSignalAttributionReceiptApply,
    postgresSignalJobLifecycleApply,
    postgresSignalEvaluationRepositoryComposition,
    postgresSignalIngressEnqueueApply,
    postgresSignalIngressComposition,
    postgresSignalDeadLetterResetApply,
    postgresSignalNotificationEnsureApply,
    postgresSignalHandlerComposition
  });
  const catalog = new CatalogRepository(db);
  const catalogGovernance = new CatalogGovernanceRepository(db);
  const catalogLinks = new CatalogLinkRepository(db);
  const catalogIdentityGovernance = new CatalogIdentityGovernanceRepository(db);
  const attribution = new AttributionRepository(db);
  const backgroundTasks = new BackgroundTaskRepository(db);
  const adapterDiagnostics = new AdapterDiagnosticRepository(db);
  const adapterRepairQueueWithCapsules = (limit: number) => {
    const summaries = hosted ? {} : evidenceCapsules.summaries();
    const incidents = operatorAlerts.incidents("all", 500)
      .filter((incident) => incident.eventFamily === "adapter_repair");
    return adapterDiagnostics.listRepairQueue(limit).map((item) => {
      const summary = summaries[`${item.retailerId}:${item.layoutFingerprint}`]
        ?? summaries[item.layoutFingerprint];
      const incident = incidents.find((candidate) => candidate.retailerId === item.retailerId
        && candidate.operation === item.operation
        && candidate.layoutFingerprint === item.layoutFingerprint);
      return {
        ...item,
        evidenceCapsuleCount: summary?.count ?? 0,
        latestEvidenceCapsuleAt: summary?.latestCapturedAt ?? "",
        latestEvidenceCapsuleId: summary?.latestId ?? "",
        repairIncidentId: incident?.id ?? "",
        repairIncidentStatus: incident?.status ?? item.status,
        repairIncidentSummary: incident?.summary ?? "",
        currentReleaseVersion: version
      };
    });
  };
  const adminChanges = new AdminChangeControlRepository(db);
  const authorization = new AuthorizationRepository(db);
  const adminOverview = new AdminOverviewRepository(db);
  /** Attach requester and reviewer display names to governance rows that only store actor ids. */
  const withActorDisplayNames = <T extends { requestedByActorId: string; reviewedByActorId: string }>(rows: T[]) => {
    const names = catalogGovernance.actorDisplayNames(rows.flatMap((row) => [row.requestedByActorId, row.reviewedByActorId]));
    return rows.map((row) => ({
      ...row,
      requestedByDisplayName: names[row.requestedByActorId] ?? "",
      reviewedByDisplayName: names[row.reviewedByActorId] ?? ""
    }));
  };
  const adminAnalytics = new AdminAnalyticsRepository(db);
  const audit = new AuditRepository(db);
  const control = new ControlRepository(db);
  const community = new CommunityEvidenceRepository(db);
  const signals = new SignalRepository(db);
  const signalProviders = new SignalProviderRepository(db);
  const dropWindows = new DropWindowRepository(db);
  const retailerReadiness = new RetailerReadinessRepository(db);
  const userActionConnectors = new UserActionConnectorRepository(
    db,
    dependencies.userActionConnectorBindings ?? {}
  );
  const orderConfirmations = new OrderConfirmationRepository(db);
  const privacyCompliance = new PrivacyComplianceRepository(db);
  const restockPatterns = new RestockPatternRepository(db);
  const actionAnalytics = new ActionAnalyticsRepository(db);
  const offerIdentity = new OfferIdentityRepository(db);
  const spendLedger = new SpendLedgerRepository(db);
  const engine = new SignalEngine(db);
  const adminSignalSimulator = new AdminSignalSimulator(db, engine);
  const signalIngress = new DurableSignalIngressService(
    db,
    dependencies.backgroundWorkerWake,
    () => notifyActionJobAvailability(true)
  );
  const devices = new DeviceRepository(db);
  const execution = new ExecutionRepository(db);
  const hostedDelivery = new HostedDeliveryRepository(db);
  const identityClaims = new IdentityClaimRepository(db);
  const notifications = new NotificationRepository(db);
  const storeLinkInteractions = new StoreLinkInteractionRepository(db);
  const walmartPurchaseHandoffInteractions = new WalmartPurchaseHandoffInteractionRepository(db);
  const userActionHandoffSummary = (now = Date.now()) => {
    const summary = signals.actionHandoffSummary(now);
    if (summary.primary) return summary;
    return withWalmartPurchaseHandoff(
      summary,
      walmartPurchaseHandoffInteractions.latest(now)
    );
  };
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
  const actorProjection = () => {
    const scope = currentRequestScope();
    const principal = db.get<{ displayName: string; tenantName: string }>(
      `SELECT user.display_name AS displayName, tenant.name AS tenantName
       FROM users user
       JOIN tenants tenant ON tenant.id = user.tenant_id
       WHERE user.tenant_id = ? AND user.id = ?`,
      scope.tenantId,
      scope.userId
    );
    const localSession = isExactLocalRequestScope(scope);
    const roleLabels = localSession
      ? ["Local administrator"]
      : db.all<{ displayName: string }>(
        `SELECT role.display_name AS displayName
         FROM authorization_memberships membership
         JOIN authorization_roles role ON role.id = membership.role_id
         WHERE membership.tenant_id = ? AND membership.user_id = ? AND membership.status = 'active'
         ORDER BY role.display_name`,
        scope.tenantId,
        scope.userId
      ).map((role) => role.displayName);
    const assurance = adminChanges.assuranceStatus();
    return {
      displayName: principal?.displayName || "Signed-in user",
      userId: scope.userId,
      tenantName: principal?.tenantName || scope.tenantId,
      roleLabels,
      assuranceLevel: assurance.level,
      assuranceFresh: assurance.fresh,
      assuranceExpiresAt: assurance.expiresAt,
      sessionKind: localSession ? "local" : "hosted",
      signOutUrl: ""
    };
  };
  const guardedAddLanes = () => Object.fromEntries(
    ADD_LANE_IDS.map((retailerId) => [retailerId, qualifications.addQualified(retailerId)])
  ) as Record<AddLaneId, boolean>;
  const activateAndReconcileProfiles = <T extends object>(
    retailerId: AddLaneId,
    activate: () => T
  ) => ({
    ...activate(),
    profileReconciliation: control.reconcilePurchaseProfilesForRetailer(retailerId)
  });
  const ADD_ADAPTER_VERSIONS = Object.fromEntries(
    ADD_LANE_IDS.map((retailerId) => [retailerId, ADD_LANES[retailerId].contractVersion])
  ) as Record<AddLaneId, string>;
  // Companion and app releases can land minutes apart. A packaged-version
  // mismatch is a distinct, typed conflict so the companion can park its
  // automatic checks and ask for an update instead of logging a repair.
  const requireAdapterVersion = (supplied: unknown, expected: string, label: string): void => {
    if (typeof supplied === "string" && supplied === expected) return;
    throw new ApiError(
      "adapter_version_mismatch",
      409,
      `The ${label} version ${String(supplied || "").slice(0, 80) || "(missing)"} does not match this app's ${expected}. Update the Chrome companion or the Yoink app so both run the same release.`
    );
  };
  const recordAndRenewQualification = <T extends { outcome: "passed" | "rejected" }>(
    retailerId: AddLaneId,
    deviceId: string,
    record: () => T
  ) => {
    const trial = record();
    const renewal = trial.outcome === "passed"
      ? qualifications.renewPreviouslyQualified(retailerId, deviceId)
      : { retailerId, renewed: false, reasonCode: "rehearsal_rejected", promotedJobs: 0 };
    const profileReconciliation = renewal.renewed
      ? control.reconcilePurchaseProfilesForRetailer(retailerId)
      : null;
    if (renewal.promotedJobs > 0) notifyActionJobAvailability();
    return { trial, renewal, profileReconciliation };
  };
  const decoratePurchaseIntents = (
    plans: Array<Record<string, unknown>>,
    input: {
      settings?: ReturnType<ControlRepository["settings"]>;
      sources?: Array<Record<string, unknown>>;
      deviceList?: Array<Record<string, unknown>>;
      laneQualifications?: ReturnType<typeof guardedAddLanes>;
      sessionBlockers?: ReturnType<RetailerReadinessRepository["freshSessionBlockers"]>;
      now?: number;
    } = {}
  ): Array<Record<string, unknown>> => {
    const now = input.now ?? Date.now();
    const settings = input.settings ?? control.settings();
    const sources = input.sources ?? control.listSources();
    const deviceList = input.deviceList ?? devices.listDevices(now);
    const spend = spendLedger.summary(now, false);
    const context = {
      version,
      executionMode: settings.executionMode,
      actionsPaused: settings.actionsPaused,
      sources,
      devices: deviceList,
      qualifications: input.laneQualifications ?? guardedAddLanes(),
      spend,
      sessionBlockers: input.sessionBlockers ?? retailerReadiness.freshSessionBlockers(now),
      now
    };
    return plans.map((plan) => {
      const { automationTargets: _automationTargets, ...publicPlan } = presentShopperPurchaseIntent(plan);
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
      spend: spendLedger.summary(now, false),
      sessionBlockers: retailerReadiness.freshSessionBlockers(now),
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
    let telemetryExcludedWaitMs = 0;
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
          durationMs: Math.max(0, Date.now() - requestStartedAt - telemetryExcludedWaitMs)
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
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "")
        && !pairingRoute && !selfDeviceRoute && !mutationOriginValidator(request)) {
        json(response, 403, { error: "origin_rejected", message: "This mutation requires an explicitly allowed Yoink origin or trusted service/device scope." });
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
        if (staticResponse(response, webRoot, requestUrl.pathname, version)) return;
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
      const adminEvidenceCapsuleMatch = /^\/api\/v1\/admin\/evidence-capsules\/(cap_[A-Za-z0-9_-]{8,120})$/.exec(requestUrl.pathname);
      const adminChangeRequestDetailMatch = /^\/api\/v1\/change-requests\/(admin_change_[a-f0-9]{32})$/.exec(requestUrl.pathname);
      const adminChangeRequestDecisionMatch = /^\/api\/v1\/change-requests\/(admin_change_[a-f0-9]{32})\/decision$/.exec(requestUrl.pathname);
      const backgroundScheduleMatch = /^\/api\/v1\/workers\/schedules\/([A-Za-z0-9_-]{3,160})$/.exec(requestUrl.pathname);
      const backgroundScheduleRunMatch = /^\/api\/v1\/workers\/schedules\/([A-Za-z0-9_-]{3,160})\/run$/.exec(requestUrl.pathname);
      const backgroundTaskRetryMatch = /^\/api\/v1\/workers\/tasks\/([A-Za-z0-9_-]{3,160})\/retry$/.exec(requestUrl.pathname);
      const signalInboxRetryMatch = /^\/api\/v1\/workers\/signal-inbox\/(inbox_[a-f0-9]{32})\/retry$/.exec(requestUrl.pathname);
      const signalProviderChannelMatch = /^\/api\/v1\/sources\/channels\/(signal_channel_[a-f0-9]{32})$/.exec(requestUrl.pathname);
      const userConnectorMatch = /^\/api\/v1\/user\/connectors\/(user_connector_[a-f0-9]{32})$/.exec(requestUrl.pathname);
      const userConnectorTestMatch = /^\/api\/v1\/user\/connectors\/(user_connector_[a-f0-9]{32})\/test$/.exec(requestUrl.pathname);
      const watchEnrollMatch = /^\/api\/v1\/user\/watch-queue\/(drop_window_item_[a-f0-9]{32})\/enroll$/.exec(requestUrl.pathname);
      const watchCancelMatch = /^\/api\/v1\/user\/watch-queue\/(watch_item_[a-f0-9]{32})\/cancel$/.exec(requestUrl.pathname);
      const adminUserMatch = /^\/api\/v1\/users\/([A-Za-z0-9_-]{3,120})$/.exec(requestUrl.pathname);
      const adminUserPairingMatch = /^\/api\/v1\/users\/([A-Za-z0-9_-]{3,120})\/pairing-code$/.exec(requestUrl.pathname);
      const adminUserPauseMatch = /^\/api\/v1\/users\/([A-Za-z0-9_-]{3,120})\/pause-actions$/.exec(requestUrl.pathname);
      const adminDropWindowMatch = /^\/api\/v1\/admin\/drop-windows\/(drop_window_[a-f0-9]{32})$/.exec(requestUrl.pathname);
      const adminDropWindowCancelMatch = /^\/api\/v1\/admin\/drop-windows\/(drop_window_[a-f0-9]{32})\/cancel$/.exec(requestUrl.pathname);
      const walmartPurchaseHandoffClickMatch = /^\/api\/v1\/user\/purchase-handoffs\/([A-Za-z0-9_-]{3,120})\/click$/.exec(requestUrl.pathname);
      const sourceChannelReplayMatch = /^\/api\/v1\/sources\/channels\/(signal_channel_[a-f0-9]{32})\/replay$/.exec(requestUrl.pathname);
      const watchObservationMatch = /^\/api\/v1\/devices\/self\/watch-queue\/(watch_item_[a-f0-9]{32})\/observations$/.exec(requestUrl.pathname);
      const readinessDeviceMatch = /^\/api\/v1\/devices\/self\/readiness\/(target|walmart|amazon|bestbuy)$/.exec(requestUrl.pathname);
      const jobEventsBatchMatch = /^\/api\/v1\/devices\/self\/jobs\/([A-Za-z0-9_-]{3,120})\/events\/batch$/.exec(requestUrl.pathname);
      const jobHeartbeatMatch = /^\/api\/v1\/devices\/self\/jobs\/([A-Za-z0-9_-]{3,120})\/heartbeat$/.exec(requestUrl.pathname);
      const deviceCartOutcomeMatch = /^\/api\/v1\/devices\/self\/jobs\/([A-Za-z0-9_-]{3,120})\/outcome$/.exec(requestUrl.pathname);
      const observerRecoveryReviewMatch = /^\/api\/v1\/community\/recovery-evidence\/([A-Za-z0-9_-]{3,120})\/review$/.exec(requestUrl.pathname);

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/health") {
        let databaseReady = false;
        try {
          databaseReady = Number(db.get<{ ok: number }>("SELECT 1 AS ok")?.ok) === 1;
        } catch {
          databaseReady = false;
        }
        const witness = observerRecipes.witnessStatus() as {
          required?: boolean;
          state?: string;
          healthy?: boolean;
        };
        const backgroundWorker = await dependencies.backgroundWorkerStatus?.() ?? {
          state: "disabled" as const,
          healthy: true,
          runtimeKind: "local_in_process" as const,
          mode: "disabled" as const,
          lastHeartbeatAt: "",
          lastErrorCode: "",
          deploymentAttested: false,
          deploymentContractVersion: BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION
        };
        const workerRequired = (backgroundWorker.mode ?? "embedded") !== "disabled";
        const reasons = [
          ...(!databaseReady ? ["database_unavailable"] : []),
          ...(workerRequired && !backgroundWorker.healthy ? ["background_worker_unhealthy"] : []),
          ...(witness.required === true && witness.healthy !== true ? ["observer_witness_unhealthy"] : [])
        ];
        const ready = reasons.length === 0;
        json(response, ready ? 200 : 503, {
          status: ready ? "ready" : "degraded",
          version,
          database: databaseReady ? "ready" : "unavailable",
          reasons,
          backgroundWorkerRuntime: backgroundWorker.state,
          backgroundWorkerHealthy: backgroundWorker.healthy,
          backgroundWorkerMode: backgroundWorker.mode ?? "embedded",
          backgroundWorkerDeployment: backgroundWorker.runtimeKind,
          backgroundWorkerDeploymentAttested: backgroundWorker.deploymentAttested,
          backgroundWorkerDeploymentContractVersion: backgroundWorker.deploymentContractVersion,
          backgroundWorkerLastHeartbeatAt: backgroundWorker.lastHeartbeatAt,
          backgroundWorkerLastErrorCode: backgroundWorker.lastErrorCode,
          observerRecipeWitnessRequired: witness.required === true,
          observerRecipeWitnessState: String(witness.state ?? "disabled"),
          observerRecipeWitnessHealthy: witness.healthy === true,
          localEvidenceCapsules: !hosted && evidenceCapsules.enabled(),
          evidenceCapsuleTransport: hosted ? "none" : "loopback"
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/admin/capabilities") {
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
          postgresSignalTargetQualificationApply,
          postgresSignalSourceTrustApply,
          postgresSignalRetailerQualificationApply,
          postgresSignalMissionPolicyApply,
          postgresSignalSourceStatusApply,
          postgresSignalSourceSyncApply,
          postgresSignalReservationLifecycleApply,
          postgresSignalCatalogImportApply,
          postgresSignalSourceProvisioningApply,
          postgresSignalAttributionPolicyApply,
          postgresSignalEvaluationComposition,
          postgresSignalAttributionReceiptApply,
          postgresSignalJobLifecycleApply,
          postgresSignalEvaluationRepositoryComposition,
          postgresSignalIngressEnqueueApply,
          postgresSignalIngressComposition,
          postgresSignalDeadLetterResetApply,
          postgresSignalNotificationEnsureApply,
          postgresSignalHandlerComposition,
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
          localEvidenceCapsules: !hosted && evidenceCapsules.enabled(),
          evidenceCapsuleTransport: hosted ? "none" : "loopback",
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

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/affiliate-routing") {
        json(response, 200, { affiliateRouting: attribution.routingDirectory() });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/privacy") {
        json(response, 200, { inventory: userPrivacy.inventory(), compliance: privacyCompliance.status() });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/action-platform") {
        const now = Date.now();
        json(response, 200, {
          dropWindows: dropWindows.list(now, true),
          watchQueue: dropWindows.listWatchQueue(now),
          watchQueueMode: dropWindows.watchQueueMode(),
          readiness: retailerReadiness.lanes(now),
          connectors: userActionConnectors.list(),
          connectorDeliveries: userActionConnectors.listDeliveries(50),
          orderConfirmations: orderConfirmations.list(50),
          sources: signalProviders.listChannels(),
          privacy: privacyCompliance.status(),
          analytics: actionAnalytics.snapshot(now)
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/drop-windows") {
        json(response, 200, { items: dropWindows.list(Date.now(), true) });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/watch-queue") {
        json(response, 200, {
          items: dropWindows.listWatchQueue(),
          mode: dropWindows.watchQueueMode()
        });
        return;
      }

      if (request.method === "POST" && walmartPurchaseHandoffClickMatch) {
        const body = await readJson(request);
        if (body.confirmation !== "OPEN_WALMART_PURCHASE_HANDOFF"
          || !["howl", "direct"].includes(String(body.routeKind))
          || !["calls", "home"].includes(String(body.surface ?? "calls"))) {
          throw new ApiError("request_rejected", 400, "A confirmed Walmart purchase handoff route is required.");
        }
        const click = walmartPurchaseHandoffInteractions.recordClick(
          walmartPurchaseHandoffClickMatch[1] ?? "",
          body.routeKind as WalmartPurchaseHandoffRouteKind,
          Date.now(),
          String(body.surface ?? "calls") as WalmartPurchaseHandoffSurface
        );
        notifyActionJobAvailability();
        json(response, 202, {
          click
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/calls") {
        const now = Date.now();
        const signalCalls = signals.listSignals(100, 0, "").map((signal) => ({
          id: `signal:${String(signal.signalId ?? "")}`,
          kind: "signal",
          listingId: String(signal.listingId ?? ""),
          retailerId: String(signal.retailerId ?? ""),
          retailerSku: String(signal.retailerSku ?? ""),
          canonicalUrl: String(signal.canonicalUrl ?? ""),
          title: String(signal.title ?? ""),
          occurredAt: String(signal.observedAt ?? ""),
          status: String(signal.actionJobState ?? signal.missionDecision ?? signal.resolutionStatus ?? "received"),
          unitPriceCents: signal.unitPriceCents ?? null,
          currency: String(signal.currency ?? "USD"),
          actionJobId: String(signal.actionJobId ?? ""),
          notificationDeliveryState: String(signal.actionJobNotificationState ?? ""),
          notificationDeliveredAt: String(signal.actionJobNotificationDeliveredAt ?? ""),
          notificationFailureCode: String(signal.actionJobNotificationFailureCode ?? ""),
          notificationConnectorState: String(signal.actionJobConnectorState ?? ""),
          source: String(signal.source ?? ""),
          sourceChannelId: String(signal.sourceChannelId ?? ""),
          falsePositiveReported: Number(signal.falsePositiveReported ?? 0) === 1,
          purchaseHandoff: deriveWalmartPurchaseHandoff(signal, now)
        }));
        const windowCalls = dropWindows.list(now, false).flatMap((window) => window.items.map((item) => ({
          id: `drop:${item.id}`,
          kind: window.kind,
          listingId: item.listingId,
          retailerId: item.retailerId,
          retailerSku: item.retailerSku,
          canonicalUrl: item.canonicalUrl,
          title: item.title,
          occurredAt: item.expectedAt,
          status: item.watch?.state ?? "scheduled",
          unitPriceCents: null,
          currency: "USD",
          actionJobId: "",
          source: "drop_window",
          dropWindowId: window.id,
          dropWindowItemId: item.id,
          watch: item.watch,
          earlyAccess: item.earlyAccess,
          confidenceBps: window.confidenceBps,
          timezone: window.timezone,
          startsAt: window.startsAt,
          closesAt: window.closesAt
        })));
        const items = [...windowCalls, ...signalCalls]
          .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
          .slice(0, 200);
        json(response, 200, { items, generatedAt: new Date(now).toISOString() });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/user/source-feedback/false-positive") {
        const body = await readJson(request);
        if (body.confirmation !== "REPORT_FALSE_POSITIVE") {
          throw new ApiError("request_rejected", 400, "Explicit false-positive feedback confirmation is required.");
        }
        json(response, 200, signalProviders.reportSignalFalsePositive(String(body.channelId ?? ""), body.signalId));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/readiness") {
        json(response, 200, { plan: retailerReadiness.reverifyPlan() });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/connectors") {
        json(response, 200, {
          items: userActionConnectors.list(),
          deliveries: userActionConnectors.listDeliveries(100)
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/analytics") {
        json(response, 200, { analytics: actionAnalytics.snapshot() });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/analytics.csv") {
        const body = Buffer.from(actionAnalytics.csv(), "utf8");
        securityHeaders(response);
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/csv; charset=utf-8");
        response.setHeader("Content-Disposition", "attachment; filename=Yoink-action-analytics.csv");
        response.setHeader("Content-Length", String(body.length));
        response.end(body);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/admin/analytics") {
        json(response, 200, {
          analytics: adminAnalytics.snapshot(requestUrl.searchParams.get("window") ?? "7d")
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/admin/analytics.csv") {
        const body = Buffer.from(adminAnalytics.csv(requestUrl.searchParams.get("window") ?? "7d"), "utf8");
        securityHeaders(response);
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/csv; charset=utf-8");
        response.setHeader("Content-Disposition", "attachment; filename=Yoink-admin-funnel.csv");
        response.setHeader("Content-Length", String(body.length));
        response.end(body);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/user/store-link-clicks") {
        const body = await readJson(request);
        json(response, 202, { click: storeLinkInteractions.record(body) });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/health") {
        const now = Date.now();
        const worker = await dependencies.backgroundWorkerStatus?.() ?? null;
        const devicesNow = devices.listDevices(now);
        const sourceChannels = signalProviders.listChannels();
        json(response, 200, {
          contractVersion: 1,
          generatedAt: new Date(now).toISOString(),
          version,
          worker,
          counts: {
            devices: devicesNow.length,
            onlineDevices: devicesNow.filter((item) => item.online).length,
            sourceChannels: sourceChannels.length,
            sourceAttention: sourceChannels.filter((item) => item.health === "attention").length,
            watchQueue: dropWindows.listWatchQueue(now).filter((item) => ["queued", "observing"].includes(item.state)).length,
            connectorFailures: userActionConnectors.listDeliveries(500).filter((item) => item.state === "dead_letter").length
          },
          readiness: retailerReadiness.lanes(now),
          sources: sourceChannels,
          connectors: userActionConnectors.list(),
          diagnosticBundle: {
            containsSecrets: false,
            containsUrls: false,
            containsDom: false,
            containsAccountOrPaymentData: false,
            workerState: worker?.state ?? "unavailable",
            workerErrorCode: worker?.lastErrorCode ?? "",
            deviceStates: devicesNow.map((item) => ({
              id: item.id,
              online: item.online,
              status: item.status,
              version: item.version,
              lastSeenAt: item.lastSeenAt
            }))
          }
        });
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
        const sessionBlockers = retailerReadiness.freshSessionBlockers(now);
        const purchaseIntents = decoratePurchaseIntents(missions, {
          settings,
          sources: sourceList,
          deviceList,
          laneQualifications,
          sessionBlockers,
          now
        });
        json(response, 200, {
          version,
          actor: actorProjection(),
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
          actionHandoff: userActionHandoffSummary(now),
          actionHandoffAvailabilityEpoch: dependencies.actionJobAvailability?.currentEpoch() ?? "",
          actionHandoffAvailabilityVersion: dependencies.actionJobAvailability?.currentVersion() ?? 0,
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
          qualificationCandidates: shadowObservations.qualificationCandidates(now),
          announcement: currentUserReleaseAnnouncement(),
          permissions: authorization.permissions()
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/action-handoff") {
        const waitMs = Math.max(0, Math.min(USER_ACTION_HANDOFF_WAIT_MAX_MS,
          Math.floor(Number(requestUrl.searchParams.get("wait") ?? 0) || 0)));
        const requestedVersionValue = Number(requestUrl.searchParams.get("version"));
        const requestedVersion = Number.isSafeInteger(requestedVersionValue) && requestedVersionValue >= 0
          ? requestedVersionValue : -1;
        const requestedEpochValue = String(requestUrl.searchParams.get("epoch") ?? "");
        const requestedEpoch = /^[a-f0-9]{32}$/.test(requestedEpochValue) ? requestedEpochValue : "";
        let availabilityEpoch = dependencies.actionJobAvailability?.currentEpoch() ?? "";
        let availabilityVersion = dependencies.actionJobAvailability?.currentVersion() ?? 0;
        if (waitMs > 0
          && requestedEpoch === availabilityEpoch
          && requestedVersion === availabilityVersion
          && !request.destroyed) {
          const intentionalWaitStartedAt = Date.now();
          try {
            if (dependencies.actionJobAvailability) {
              availabilityVersion = await dependencies.actionJobAvailability.waitAfter(availabilityVersion, waitMs);
            } else {
              await boundedWait(waitMs);
            }
          } catch {
            await boundedWait(Math.min(250, waitMs));
            availabilityVersion = dependencies.actionJobAvailability?.currentVersion() ?? availabilityVersion;
          } finally {
            telemetryExcludedWaitMs += Date.now() - intentionalWaitStartedAt;
          }
        }
        if (request.destroyed) return;
        availabilityEpoch = dependencies.actionJobAvailability?.currentEpoch() ?? availabilityEpoch;
        json(response, 200, {
          actionHandoff: userActionHandoffSummary(),
          availabilityEpoch,
          availabilityVersion
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

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/purchase-intents/legacy-transition") {
        json(response, 200, { preview: control.legacyPurchaseIntentTransitionPreview() });
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

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/users") {
        json(response, 200, {
          users: authorization.tenantUsers(requestUrl.searchParams.get("q") ?? "")
        });
        return;
      }

      if (request.method === "GET" && adminUserMatch) {
        json(response, 200, authorization.tenantUserDetail(adminUserMatch[1] ?? ""));
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
          const compatibility = companionCompatibility(version, updated.extensionVersion);
          const settings = control.settings();
          const targetAddQualified = qualifications.targetAddQualified();
          const walmartAddQualified = qualifications.walmartAddQualified();
          const amazonAddQualified = qualifications.amazonAddQualified();
          const bestBuyAddQualified = qualifications.bestBuyAddQualified();
          json(response, 200, {
            device: updated,
            credential: devices.credentialStatus(device.id),
            controlPlane: {
              companionCompatible: compatibility.compatible,
              companionCompatibilityReason: compatibility.reason,
              executionMode: settings.executionMode,
              actionsPaused: settings.actionsPaused,
              retailerMutationEnabled: targetAddQualified || walmartAddQualified || amazonAddQualified || bestBuyAddQualified,
              targetAddExecutionEnabled: targetAddQualified,
              walmartAddExecutionEnabled: walmartAddQualified,
              amazonAddExecutionEnabled: amazonAddQualified,
              bestBuyAddExecutionEnabled: bestBuyAddQualified,
              communitySharingRetailers: community.consents()
                .filter((consent) => consent.enabled)
                .map((consent) => consent.retailerId)
            }
          });
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/api/v1/devices/self/readiness/reverification-plan") {
          json(response, 200, { plan: retailerReadiness.reverifyPlan() });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/readiness/reverification-runs") {
          const body = await readJson(request);
          const recorded = db.transaction(() => {
            const run = retailerReadiness.recordReverificationRun(device.id, body as unknown as RetailerReverificationRunInput);
            const lane = retailerReadiness.lane(run.retailerId);
            const stallReconciliation = operatorAlerts.reconcileQualificationStalls([lane], correlationId);
            return { run, lane, stallReconciliation };
          });
          json(response, 201, recorded);
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
          if (body.retailerId !== shadowObservationMatch[1]) throw new ApiError("request_rejected", 400, "The retailer observation route and payload must match.");
          requireAdapterVersion(body.adapterVersion, RETAILER_OBSERVER_VERSIONS[shadowObservationMatch[1] as SupportedRetailerId], "retailer observer");
          const observation = shadowObservations.record(device.id, body as unknown as RetailerShadowObservationInput);
          const listing = catalog.exactRetailerListing(observation.retailerId, observation.retailerSku);
          json(response, 201, {
            observation,
            productIdentity: listing ? {
              source: "catalog_exact_retailer_sku",
              retailerId: listing.retailerId,
              retailerSku: listing.retailerSku,
              title: listing.title
            } : null
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
        const evidenceCapsuleMatch = /^\/api\/v1\/devices\/self\/evidence-capsules\/(target|walmart|amazon|bestbuy|disney|ravensburger|riot|booksamillion|fanatics|kohls|macys|pbandai|pokemoncenter)$/.exec(requestUrl.pathname);
        if (request.method === "POST" && evidenceCapsuleMatch) {
          if (hosted) {
            throw new ApiError("evidence_capsules_hosted_forbidden", 403, "Page snapshots for store repairs are local-only.");
          }
          const body = await readJson(request, MAX_EVIDENCE_CAPSULE_BODY_BYTES);
          if (body.retailerId !== evidenceCapsuleMatch[1]) {
            throw new ApiError("request_rejected", 400, "The evidence capsule route and payload must match.");
          }
          try {
            json(response, 202, evidenceCapsules.accept(body));
          } catch (error) {
            if (error instanceof EvidenceCapsuleStoreError) {
              throw new ApiError(error.code, error.status, error.message);
            }
            throw error;
          }
          return;
        }
        const adapterDiagnosticMatch = /^\/api\/v1\/devices\/self\/adapter-diagnostics\/(target|walmart|amazon|bestbuy|disney|ravensburger|riot|booksamillion|fanatics|kohls|macys|pbandai|pokemoncenter)$/.exec(requestUrl.pathname);
        if (request.method === "POST" && adapterDiagnosticMatch) {
          const body = await readJson(request);
          if (body.retailerId !== adapterDiagnosticMatch[1]) throw new ApiError("request_rejected", 400, "The adapter diagnostic route and payload must match.");
          {
            const diagnosticRetailer = adapterDiagnosticMatch[1] as SupportedRetailerId;
            const expectedDiagnosticVersion = body.operation === "observe"
              ? RETAILER_OBSERVER_VERSIONS[diagnosticRetailer]
              : ADD_ADAPTER_VERSIONS[diagnosticRetailer as keyof typeof ADD_ADAPTER_VERSIONS];
            if (expectedDiagnosticVersion) requireAdapterVersion(body.adapterVersion, expectedDiagnosticVersion, "adapter diagnostic");
          }
          let recorded;
          try {
            recorded = db.transaction(() => {
              const diagnostic = adapterDiagnostics.record(device.id, body as unknown as RetailerAdapterDiagnosticInput);
              const alertReconciliation = operatorAlerts.reconcileAdapterRepairs(
                adapterDiagnostics.listRepairQueue(2_000),
                correlationId
              );
              return { diagnostic, alertReconciliation };
            });
          } catch (error) {
            if (error instanceof Error
              && error.message === "The adapter diagnostic contains an unsupported field.") {
              throw new ApiError("request_rejected", 400, error.message);
            }
            throw error;
          }
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
            throw new ApiError("request_rejected", 400, "Upgrade the Chrome companion before sharing read-only community evidence.");
          }
          const retailerId = communityNonceMatch[1] as SupportedRetailerId;
          json(response, 201, community.issueNonce(device.id, retailerId));
          return;
        }
        const communityContributionMatch = /^\/api\/v1\/devices\/self\/community\/contributions\/(target|walmart|amazon|bestbuy|disney|ravensburger|riot|booksamillion|fanatics|kohls|macys|pbandai|pokemoncenter)$/.exec(requestUrl.pathname);
        if (request.method === "POST" && communityContributionMatch) {
          if (!device.capabilities.communityReadOnlyEvidence || !device.capabilities.exactSelectedOfferEvidence) {
            throw new ApiError("request_rejected", 400, "Upgrade the Chrome companion before sharing read-only community evidence.");
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
            throw new ApiError("request_rejected", 400, "Upgrade the Chrome companion before requesting observer recipes.");
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
          if (body.retailerId !== retailerId) throw new ApiError("request_rejected", 400, "The observer recipe trial route and payload must match.");
          json(response, 201, {
            trial: observerRecipes.recordTrial(device.id, body as unknown as ObserverRecipeTrialInput)
          });
          return;
        }
        const addTrialMatch = /^\/api\/v1\/devices\/self\/qualification-trials\/([a-z][a-z0-9]{1,31})-add$/.exec(requestUrl.pathname);
        if (request.method === "POST" && addTrialMatch) {
          const lane = addLane(addTrialMatch[1] ?? "");
          if (!lane) throw new ApiError("not_found", 404, "The guarded store lane was not found.");
          const retailerId = lane.id;
          const body = await readJson(request);
          requireAdapterVersion(body.adapterVersion, lane.contractVersion, "add runner");
          requireAdapterVersion(body.observerVersion, lane.observerVersion, "retailer observer");
          json(response, 201, recordAndRenewQualification(retailerId, device.id,
            () => qualifications.recordAddRehearsal(retailerId, device.id, body as never)));
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
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/sources/trackalacker/signals/batch") {
          const body = await readJson(request);
          if (!Array.isArray(body.signals) || body.signals.length < 1 || body.signals.length > 50) {
            throw new ApiError("request_rejected", 400, "A TrackaLacker signal batch must contain 1 through 50 signals.");
          }
          const envelopes = body.signals.map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
              throw new ApiError("request_rejected", 400, "Every TrackaLacker batch entry must be an object.");
            }
            const item = entry as Record<string, unknown>;
            return {
              contractVersion: 1 as const,
              provider: "trackalacker" as const,
              signal: trackalackerSignalInput(
                item,
                String(item.idempotencyKey ?? ""),
                scopedSourceConnectionId("trackalacker")
              )
            };
          });
          json(response, 202, signalIngress.acceptProviderBatch(envelopes));
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/sources/trackalacker/catalog") {
          const body = await readJson(request);
          const syncId = typeof body.syncId === "string" ? body.syncId : "";
          if (body.rawSample && typeof body.rawSample === "object" && !Array.isArray(body.rawSample)) {
            audit.record({
              correlationId: syncId || device.id,
              aggregateType: "trackalacker_sync",
              eventType: "trackalacker_sync_sample",
              reasonCode: "raw_field_sample_captured",
              message: "Captured a sanitized sample of TrackaLacker's raw followed-product field structure, to diagnose image/MSRP extraction.",
              data: body.rawSample as TrackalackerRawFieldSample
            });
          }
          const hasItemPayload = Boolean(body.item) || typeof body.sourceProductId === "string";
          if (!hasItemPayload) {
            json(response, 202, { item: null, syncReceipt: null });
            return;
          }
          const wrappedItem = body.item && typeof body.item === "object" && !Array.isArray(body.item)
            ? body.item as TrackalackerCatalogItemInput
            : body as unknown as TrackalackerCatalogItemInput;
          const item = catalog.upsertTrackalackerItem(wrappedItem);
          const syncReceipt = syncId
            ? sourceRuntime.recordSyncItem(device.id, syncId, wrappedItem.sourceProductId, item)
            : null;
          json(response, 202, {
            item,
            syncReceipt
          });
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/api/v1/devices/self/notifications/next") {
          const waitMs = Math.max(0, Math.min(
            DEVICE_NOTIFICATION_WAIT_MAX_MS,
            Math.floor(Number(requestUrl.searchParams.get("wait") ?? 0) || 0)
          ));
          const deadline = Date.now() + waitMs;
          let availabilityVersion = dependencies.actionJobAvailability?.currentVersion() ?? 0;
          let lease = notifications.leaseNext(device.id, Date.now());
          while (!lease.notification && lease.reason === "no_notifications"
            && lease.closedDeliveryIds.length === 0
            && Date.now() < deadline && !request.destroyed) {
            const rapidRecheck = (dependencies.actionJobAvailability?.rapidRecheckUntil?.() ?? 0) > Date.now();
            const boundedDelay = Math.min(
              rapidRecheck ? DEVICE_ACTION_JOB_RAPID_RECHECK_MS : DEVICE_ACTION_JOB_FALLBACK_RECHECK_MS,
              Math.max(1, deadline - Date.now())
            );
            const intentionalWaitStartedAt = Date.now();
            try {
              if (dependencies.actionJobAvailability) {
                availabilityVersion = await dependencies.actionJobAvailability.waitAfter(
                  availabilityVersion,
                  boundedDelay
                );
              } else {
                await boundedWait(boundedDelay);
              }
            } catch {
              await boundedWait(boundedDelay);
              availabilityVersion = dependencies.actionJobAvailability?.currentVersion() ?? availabilityVersion;
            } finally {
              telemetryExcludedWaitMs += Date.now() - intentionalWaitStartedAt;
            }
            lease = notifications.leaseNext(device.id, Date.now());
          }
          if (request.destroyed) return;
          json(response, 200, { ...lease, availabilityVersion });
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/api/v1/devices/self/watch-queue/next") {
          json(response, 200, dropWindows.leaseNext(device.id));
          return;
        }
        if (request.method === "POST" && watchObservationMatch) {
          const body = await readJson(request);
          const observed = dropWindows.recordObservation(
            device.id,
            watchObservationMatch[1] ?? "",
            body as unknown as WatchQueueObservationInput
          );
          const receipt = observed.signal
            ? signalIngress.acceptProvider({
                contractVersion: 1,
                provider: "drop_window",
                channelId: observed.channel.id,
                signal: observed.signal
              })
            : null;
          json(response, 202, { item: observed.item, signal: receipt });
          return;
        }
        if (request.method === "POST" && readinessDeviceMatch) {
          const body = await readJson(request);
          if (body.retailerId !== readinessDeviceMatch[1]) {
            throw new ApiError("request_rejected", 400, "The retailer-readiness route and payload must match.");
          }
          const readiness = retailerReadiness.record(
            device.id,
            body as unknown as RetailerSessionReadinessInput
          );
          notifyActionJobAvailability();
          json(response, 200, { readiness });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/order-confirmations") {
          const body = await readJson(request);
          const observation = orderConfirmations.record(
            device.id,
            body as unknown as OrderConfirmationObservationInput
          );
          notifyActionJobAvailability();
          json(response, 202, {
            observation
          });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/action-handoffs/reconcile") {
          const body = await readJson(request);
          if (body.contractVersion !== 1 || !Array.isArray(body.jobIds)) {
            throw new ApiError("request_rejected", 400, "The action-handoff reconciliation contract is invalid.");
          }
          const jobIds = body.jobIds.map((value) => String(value ?? ""));
          const waitMs = Math.max(0, Math.min(
            DEVICE_ACTION_HANDOFF_WAIT_MAX_MS,
            Math.floor(Number(body.waitMs ?? 0) || 0)
          ));
          const requestedVersionValue = Number(body.availabilityVersion);
          const requestedVersion = Number.isSafeInteger(requestedVersionValue) && requestedVersionValue >= 0
            ? requestedVersionValue : -1;
          let availabilityVersion = dependencies.actionJobAvailability?.currentVersion() ?? 0;
          let items = execution.actionHandoffStatuses(device.id, jobIds);
          const initialStatuses = JSON.stringify(items);
          const deadline = Date.now() + waitMs;
          const watchCurrentVersion = requestedVersion === availabilityVersion;
          while (waitMs > 0
            && watchCurrentVersion
            && items.some((item) => item.status !== "closed")
            && Date.now() < deadline
            && !request.aborted
            && !response.destroyed) {
            const boundedDelay = Math.min(
              DEVICE_ACTION_JOB_FALLBACK_RECHECK_MS,
              Math.max(1, deadline - Date.now())
            );
            const intentionalWaitStartedAt = Date.now();
            try {
              if (dependencies.actionJobAvailability) {
                availabilityVersion = await dependencies.actionJobAvailability.waitAfter(
                  availabilityVersion,
                  boundedDelay
                );
              } else {
                await boundedWait(boundedDelay);
              }
            } catch {
              await boundedWait(Math.min(250, boundedDelay));
              availabilityVersion = dependencies.actionJobAvailability?.currentVersion() ?? availabilityVersion;
            } finally {
              telemetryExcludedWaitMs += Date.now() - intentionalWaitStartedAt;
            }
            items = execution.actionHandoffStatuses(device.id, jobIds);
            if (JSON.stringify(items) !== initialStatuses) break;
          }
          if (request.aborted || response.destroyed) return;
          json(response, 200, {
            contractVersion: 1,
            availabilityVersion,
            items
          });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/v1/devices/self/privacy/local-deletion") {
          const body = await readJson(request);
          if (body.contractVersion !== 1
            || body.localCleared !== true
            || body.sessionCleared !== true
            || !Array.isArray(body.retainedKeys)
            || body.retainedKeys.length !== 0) {
            throw new ApiError("request_rejected", 400, "Local deletion must clear both Chrome storage areas and retain no extension keys.");
          }
          json(response, 200, {
            compliance: privacyCompliance.record("local_deletion", "deletion_completed", device.id)
          });
          return;
        }
        if (request.method === "POST"
          && requestUrl.pathname === "/api/v1/devices/self/notifications/closures/ack") {
          const body = await readJson(request);
          if (body.contractVersion !== 1
            || !Array.isArray(body.deliveryIds)
            || body.deliveryIds.length > 100
            || body.deliveryIds.some((value) => !/^[A-Za-z0-9_-]{3,160}$/.test(String(value)))) {
            throw new ApiError("request_rejected", 400, "Valid closed notification delivery IDs are required.");
          }
          json(response, 200, {
            closures: notifications.acknowledgeClosedDeliveries(device.id, body.deliveryIds)
          });
          return;
        }
        const notificationAckMatch = /^\/api\/v1\/devices\/self\/notifications\/([A-Za-z0-9_-]{3,160})\/ack$/.exec(requestUrl.pathname);
        if (request.method === "POST" && notificationAckMatch) {
          const body = await readJson(request);
          if (typeof body.capabilityToken !== "string" || !["delivered", "failed"].includes(String(body.outcome))) {
            throw new ApiError("request_rejected", 400, "A valid notification capability and delivery outcome are required.");
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
            throw new ApiError("request_rejected", 400, "A valid notification interaction is required.");
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
          const compatibility = companionCompatibility(version, device.extensionVersion);
          if (!compatibility.compatible) {
            json(response, 200, {
              job: null,
              reason: "companion_incompatible",
              companionCompatible: false,
              companionCompatibilityReason: compatibility.reason
            });
            return;
          }
          const waitMs = Math.max(0, Math.min(
            DEVICE_ACTION_JOB_WAIT_MAX_MS,
            Math.floor(Number(requestUrl.searchParams.get("wait") ?? 0) || 0)
          ));
          const deadline = Date.now() + waitMs;
          const retailerHintValue = requestUrl.searchParams.get("retailers");
          const accessibleRetailersHint = retailerHintValue === null
            ? undefined
            : retailerHintValue.length <= 80
              ? retailerHintValue.split(",").slice(0, 8)
              : [];
          let availabilityVersion = dependencies.actionJobAvailability?.currentVersion() ?? 0;
          let lease = execution.leaseNextJob(device.id, Date.now(), accessibleRetailersHint);
          while (!lease.job && lease.reason === "no_jobs" && Date.now() < deadline && !request.destroyed) {
            const rapidRecheck = (dependencies.actionJobAvailability?.rapidRecheckUntil?.() ?? 0) > Date.now();
            const boundedDelay = Math.min(
              rapidRecheck ? DEVICE_ACTION_JOB_RAPID_RECHECK_MS : DEVICE_ACTION_JOB_FALLBACK_RECHECK_MS,
              Math.max(1, deadline - Date.now())
            );
            const intentionalWaitStartedAt = Date.now();
            try {
              if (dependencies.actionJobAvailability) {
                availabilityVersion = await dependencies.actionJobAvailability.waitAfter(
                  availabilityVersion,
                  boundedDelay
                );
              } else {
                await boundedWait(boundedDelay);
              }
            } catch {
              await boundedWait(boundedDelay);
              availabilityVersion = dependencies.actionJobAvailability?.currentVersion() ?? availabilityVersion;
            } finally {
              telemetryExcludedWaitMs += Date.now() - intentionalWaitStartedAt;
            }
            lease = execution.leaseNextJob(device.id, Date.now(), accessibleRetailersHint);
          }
          if (request.destroyed) return;
          if (lease.job) notifyActionJobAvailability();
          json(response, 200, lease);
          return;
        }
        if (request.method === "POST" && jobEventsBatchMatch) {
          const body = await readJson(request);
          if (typeof body.capabilityToken !== "string" || !Array.isArray(body.events)) {
            throw new ApiError("request_rejected", 400, "A valid action-job capability and progress event batch are required.");
          }
          const events = body.events.map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
              throw new ApiError("request_rejected", 400, "Every action-job progress event must be an object.");
            }
            const event = entry as Record<string, unknown>;
            if (!JOB_STATES.includes(event.state as JobState)) {
              throw new ApiError("request_rejected", 400, "The action-job progress batch contains an invalid state.");
            }
            return {
              state: event.state as JobState,
              reasonCode: String(event.reasonCode ?? "device_report"),
              message: String(event.message ?? "Chrome reported action progress."),
              evidence: event.evidence && typeof event.evidence === "object" && !Array.isArray(event.evidence)
                ? event.evidence as Record<string, unknown> : {}
            };
          });
          const reconciliation = execution.reconcileJobBatch(
            device.id,
            jobEventsBatchMatch[1] ?? "",
            body.capabilityToken,
            events
          );
          notifyActionJobAvailability();
          json(response, 200, reconciliation);
          return;
        }
        if (request.method === "POST" && jobHeartbeatMatch) {
          const body = await readJson(request);
          json(response, 200, {
            heartbeat: execution.heartbeatJob(
              device.id,
              jobHeartbeatMatch[1] ?? "",
              String(body.capabilityToken ?? "")
            )
          });
          return;
        }
        if (request.method === "POST" && deviceCartOutcomeMatch) {
          const body = await readJson(request);
          if (!["got_it", "missed_it"].includes(String(body.outcome))) {
            throw new ApiError("request_rejected", 400, "Choose Got it or Missed it for this cart action.");
          }
          const outcome = signals.reportCartOutcome(
            deviceCartOutcomeMatch[1] ?? "",
            body.outcome as "got_it" | "missed_it",
            String(body.confirmation ?? ""),
            body.outcome === "got_it" ? Number(body.actualTotalCents) : null,
            String(body.note ?? ""),
            Date.now(),
            device.id
          );
          notifyActionJobAvailability();
          json(response, 200, { outcome });
          return;
        }
        const eventMatch = /^\/api\/v1\/devices\/self\/jobs\/([A-Za-z0-9_-]{3,120})\/events$/.exec(requestUrl.pathname);
        if (request.method === "POST" && eventMatch) {
          const body = await readJson(request);
          if (typeof body.capabilityToken !== "string" || !JOB_STATES.includes(body.state as JobState)) {
            throw new ApiError("request_rejected", 400, "A valid action-job capability and next state are required.");
          }
          const evidence = body.evidence && typeof body.evidence === "object" && !Array.isArray(body.evidence)
            ? body.evidence as Record<string, unknown>
            : {};
          const job = execution.reconcileJob(
            device.id,
            eventMatch[1] ?? "",
            body.capabilityToken,
            body.state as JobState,
            String(body.reasonCode ?? "device_report"),
            String(body.message ?? "Chrome reported action progress."),
            evidence
          );
          notifyActionJobAvailability();
          json(response, 200, { job });
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

      if (requestUrl.pathname === "/api/v1/admin/evidence-capsules" && request.method === "GET") {
        if (hosted) throw new ApiError("evidence_capsules_hosted_forbidden", 403, "Page snapshots for store repairs are local-only.");
        const retailerId = String(requestUrl.searchParams.get("retailerId") ?? "");
        const fingerprint = String(requestUrl.searchParams.get("fingerprint") ?? "");
        const limit = Number(requestUrl.searchParams.get("limit") ?? 50);
        json(response, 200, {
          evidenceCapsulesEnabled: evidenceCapsules.enabled(),
          items: evidenceCapsules.list({ retailerId, fingerprint, limit })
        });
        return;
      }

      if (requestUrl.pathname === "/api/v1/admin/evidence-capsules/settings" && request.method === "PATCH") {
        if (hosted) throw new ApiError("evidence_capsules_hosted_forbidden", 403, "Page snapshots for store repairs are local-only.");
        const body = await readJson(request);
        if (typeof body.enabled !== "boolean") {
          throw new ApiError("request_rejected", 400, "Choose whether to keep page snapshots for store repairs on this device.");
        }
        json(response, 200, evidenceCapsules.setEnabled(body.enabled));
        return;
      }

      if (adminEvidenceCapsuleMatch && request.method === "GET") {
        if (hosted) throw new ApiError("evidence_capsules_hosted_forbidden", 403, "Page snapshots for store repairs are local-only.");
        const capsule = evidenceCapsules.detail(adminEvidenceCapsuleMatch[1] ?? "");
        if (!capsule) throw new ApiError("evidence_capsule_not_found", 404, "The page snapshot no longer exists.");
        json(response, 200, { capsule });
        return;
      }

      if (adminEvidenceCapsuleMatch && request.method === "DELETE") {
        if (hosted) throw new ApiError("evidence_capsules_hosted_forbidden", 403, "Page snapshots for store repairs are local-only.");
        if (!evidenceCapsules.delete(adminEvidenceCapsuleMatch[1] ?? "")) {
          throw new ApiError("evidence_capsule_not_found", 404, "The page snapshot no longer exists.");
        }
        json(response, 200, { deleted: true, id: adminEvidenceCapsuleMatch[1] });
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
        const requestedView = requestUrl.searchParams.get("view");
        if (requestedView && !ADMIN_SNAPSHOT_VIEWS.has(requestedView)) {
          throw new ApiError(
            "invalid_admin_snapshot_view",
            400,
            "Choose a supported admin workspace before requesting its live snapshot."
          );
        }
        const scopedView = requestedView as AdminSnapshotView | null;
        if (scopedView === "community") authorization.require("admin.maintainer");
        if (scopedView) {
          const pairedDevices = devices.listDevices();
          const catalogProposalCounts = catalogGovernance.counts();
          const protectedChangeCounts = adminChanges.counts();
          const incidentCounts = operatorAlerts.counts();
          const targetQualification = shadowObservations.targetQualificationReadiness();
          const walmartQualification = shadowObservations.walmartQualificationReadiness();
          const amazonQualification = shadowObservations.amazonQualificationReadiness();
          const bestBuyQualification = shadowObservations.bestBuyQualificationReadiness();
          const scopedCounts: Record<string, unknown> = {
            onlineDevices: pairedDevices.filter((device) => device.online === true).length,
            activeActionJobs: adminOverview.activeActionJobs(),
            pendingCatalogProposals: catalogProposalCounts.pendingCatalogProposals,
            pendingAdminChanges: protectedChangeCounts.pending,
            openIncidents: incidentCounts.openOperatorAlerts + incidentCounts.acknowledgedOperatorAlerts
              + incidentCounts.fixedPendingLiveOperatorAlerts
          };
          const scopedSnapshot: Record<string, unknown> = {
            view: scopedView,
            version,
            actor: actorProjection(),
            permissions: authorization.permissions(),
            settings: { ...control.settings(), evidenceCapsulesEnabled: !hosted && evidenceCapsules.enabled() },
            counts: scopedCounts,
            trackalacker: sourceRuntime.trackalackerStatus(),
            capabilities: {
              targetReadOnlyShadow: true,
              targetAddQualified: targetQualification.addToCartQualified,
              targetAddMutationAuthorized: targetQualification.mutationAuthorized,
              walmartAddQualified: walmartQualification.addToCartQualified,
              walmartAddMutationAuthorized: walmartQualification.mutationAuthorized,
              amazonAddQualified: amazonQualification.addToCartQualified,
              amazonAddMutationAuthorized: amazonQualification.mutationAuthorized,
              bestBuyAddQualified: bestBuyQualification.addToCartQualified,
              bestBuyAddMutationAuthorized: bestBuyQualification.mutationAuthorized,
              localEvidenceCapsules: !hosted && evidenceCapsules.enabled(),
              evidenceCapsuleTransport: hosted ? "none" : "loopback"
            }
          };

          if (scopedView === "overview") {
            Object.assign(scopedCounts,
              catalog.counts(),
              signals.counts(),
              notifications.counts(),
              audit.outboxCounts(),
              spendLedger.counts(),
              { auditEvents: audit.count(), missions: control.missionCount() }
            );
            scopedCounts.openIncidents = incidentCounts.openOperatorAlerts
              + incidentCounts.acknowledgedOperatorAlerts
              + incidentCounts.fixedPendingLiveOperatorAlerts;
            scopedSnapshot.sources = control.listSources();
            scopedSnapshot.strategies = control.listStrategies();
            scopedSnapshot.overview = adminOverview.snapshot();
          }

          if (["library", "strategies", "signals", "operations", "connections"].includes(scopedView)) {
            scopedSnapshot.sources = control.listSources();
          }
          if (scopedView === "strategies") scopedSnapshot.strategies = control.listStrategies();
          if (scopedView === "operations") scopedSnapshot.plans = { activeByStore: adminOverview.activePlansByStore() };

          if (scopedView === "library") {
            scopedSnapshot.catalogGovernance = {
              directUserWritesEnabled: false,
              reviewCapable: authorization.has("catalog.review"),
              identityProposalCapable: authorization.has("catalog.identity.propose"),
              identityApprovalCapable: authorization.has("catalog.identity.approve"),
              pending: authorization.has("catalog.review") ? catalogGovernance.listForReview("pending", 100, 0) : [],
              identityOperations: withActorDisplayNames(catalogIdentityGovernance.list("all", 100, 0))
            };
          }

          if (scopedView === "catalog-reviews") {
            scopedSnapshot.catalogGovernance = {
              reviewCapable: authorization.has("catalog.review"),
              pending: authorization.has("catalog.review")
                ? catalogGovernance.listForReview("pending", 100, 0)
                : []
            };
          }

          if (scopedView === "activity") Object.assign(scopedCounts, audit.outboxCounts());
          if (["approvals", "catalog-reviews", "access"].includes(scopedView)) {
            scopedSnapshot.authorization = {
              permissions: authorization.permissions(),
              memberships: authorization.memberships(),
              roleAdministrationEnabled: authorization.has("security.manage"),
              userReadEnabled: authorization.has("admin.users.read"),
              userSupportEnabled: authorization.has("admin.users.support"),
              userManagementEnabled: authorization.has("admin.users.manage"),
              changeApprovalEnabled: authorization.has("change.approve"),
              assurance: adminChanges.assuranceStatus(),
              internalServices: internalServiceCapabilities
            };
          }

          if (scopedView === "alerts") scopedSnapshot.operatorAlerts = operatorAlerts.snapshot();

          if (scopedView === "community") {
            const observerTrust = observerRecipes.trustStatus();
            Object.assign(scopedCounts, community.counts(), identityClaims.counts(), observerRecipes.counts());
            scopedSnapshot.dataPlane = postgresDataPlane;
            scopedSnapshot.community = {
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
            };
            scopedSnapshot.identityGovernance = {
              catalogRemappingEnabled: false,
              reversibleLocalCatalogOperations: true,
              hostedGlobalCatalogAuthority: false,
              siblingAvailabilityRequiresIndependentValidation: true,
              claims: identityClaims.list(100),
              projections: identityClaims.projections()
            };
            scopedSnapshot.observerRegistry = {
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
            };
          }

          if (scopedView === "settings") {
            scopedSnapshot.attributionPolicies = attribution.listPolicies();
          }

          if (scopedView === "connections") {
            Object.assign(scopedCounts, walmartDraws.counts(), adapterDiagnostics.counts());
            scopedSnapshot.devices = pairedDevices;
            scopedSnapshot.shadowObservations = shadowObservations.listRecent(50);
            scopedSnapshot.walmartDraws = {
              readOnly: true,
              entryMutationAuthorized: false,
              contingentOrderRisk: true,
              latestScan: walmartDraws.latestScan(),
              items: walmartDraws.currentItems()
            };
            scopedSnapshot.adapterRepairQueue = adapterDiagnostics.listRepairQueue(50);
            scopedSnapshot.retailerEvidence = shadowObservations.retailerEvidenceReadiness();
            scopedSnapshot.targetQualification = targetQualification;
            scopedSnapshot.walmartQualification = walmartQualification;
            scopedSnapshot.amazonQualification = amazonQualification;
            scopedSnapshot.bestBuyQualification = bestBuyQualification;
            scopedSnapshot.futureMutationLanes = mutationLanes.readiness();
          }

          json(response, 200, scopedSnapshot);
          return;
        }

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
          actor: actorProjection(),
          settings: { ...control.settings(), evidenceCapsulesEnabled: !hosted && evidenceCapsules.enabled() },
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
          adapterRepairQueue: adapterRepairQueueWithCapsules(50),
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
            identityOperations: withActorDisplayNames(catalogIdentityGovernance.list("all", 100, 0))
          },
          authorization: {
            permissions: authorization.permissions(),
            memberships: authorization.memberships(),
            roleAdministrationEnabled: authorization.has("security.manage"),
            userReadEnabled: authorization.has("admin.users.read"),
            userSupportEnabled: authorization.has("admin.users.support"),
            userManagementEnabled: authorization.has("admin.users.manage"),
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
          dataPlane: postgresDataPlane,
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
            localEvidenceCapsules: !hosted && evidenceCapsules.enabled(),
            evidenceCapsuleTransport: hosted ? "none" : "loopback",
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
            postgresSignalTargetQualificationApply,
            postgresSignalSourceTrustApply,
            postgresSignalRetailerQualificationApply,
            postgresSignalMissionPolicyApply,
            postgresSignalSourceStatusApply,
            postgresSignalSourceSyncApply,
            postgresSignalReservationLifecycleApply,
            postgresSignalCatalogImportApply,
            postgresSignalSourceProvisioningApply,
            postgresSignalAttributionPolicyApply,
            postgresSignalEvaluationComposition,
            postgresSignalAttributionReceiptApply,
            postgresSignalJobLifecycleApply,
            postgresSignalEvaluationRepositoryComposition,
            postgresSignalIngressEnqueueApply,
            postgresSignalIngressComposition,
            postgresSignalDeadLetterResetApply,
            postgresSignalNotificationEnsureApply,
            postgresSignalHandlerComposition,
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
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/library/products") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        const planFilter = requestUrl.searchParams.get("plan") ?? "";
        const plannedFilter = requestUrl.searchParams.get("planned") ?? "";
        const filters = {
          search: requestUrl.searchParams.get("q") ?? "",
          retailerId: requestUrl.searchParams.get("store") ?? "",
          availability: requestUrl.searchParams.get("availability") ?? "",
          plan: planFilter || (plannedFilter === "true" || plannedFilter === "planned"
            ? "planned"
            : plannedFilter === "false" || plannedFilter === "unplanned" ? "unplanned" : ""),
          category: requestUrl.searchParams.get("category") ?? "",
          priceMinCents: requestUrl.searchParams.get("priceMin") ?? "",
          priceMaxCents: requestUrl.searchParams.get("priceMax") ?? "",
          sort: requestUrl.searchParams.get("sort") ?? "newest"
        };
        const items = catalog.listLibraryProducts(limit, offset, filters);
        json(response, 200, {
          items,
          total: catalog.libraryProductCount(filters),
          offset,
          limit: items.length,
          facets: { stores: catalog.libraryProductStoreFacets() }
        });
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
        json(response, 200, {
          items,
          total: signals.jobCount(query),
          offset,
          limit: items.length,
          insights: signals.actionInsights(),
          glossary: actionStatusGlossaryProjection()
        });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/admin/notifications") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        const query = String(requestUrl.searchParams.get("q") ?? "");
        const items = notifications.listRecent(limit, offset, query);
        json(response, 200, {
          items,
          total: notifications.recentCount(query),
          offset,
          limit: items.length
        });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/admin/attribution-receipts") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        const query = String(requestUrl.searchParams.get("q") ?? "");
        const items = attribution.listReceipts(limit, offset, query);
        json(response, 200, {
          items,
          total: attribution.receiptCount(query),
          offset,
          limit: items.length
        });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/audit") {
        const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
        const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
        const filters = {
          search: String(requestUrl.searchParams.get("q") ?? ""),
          type: String(requestUrl.searchParams.get("type") ?? ""),
          actor: String(requestUrl.searchParams.get("actor") ?? ""),
          since: String(requestUrl.searchParams.get("since") ?? "")
        };
        const items = audit.list(limit, offset, filters);
        json(response, 200, { items, total: audit.count(filters), offset, limit: items.length, outbox: audit.outboxCounts() });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/strategies") {
        json(response, 200, { items: control.listStrategies() });
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

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/users") {
        const body = await readJson(request);
        const displayName = String(body.displayName ?? "").trim();
        const initialRoleId = String(body.initialRoleId ?? "yoink_user").trim() || "yoink_user";
        if (initialRoleId === "yoink_user") {
          json(response, 201, authorization.createTenantUser({ displayName }));
          return;
        }
        if (!authorization.roles().some((role) => role.id === initialRoleId)) {
          throw new ApiError("authorization_subject_not_found", 404, "The initial authorization role does not exist.");
        }
        const governed = adminChanges.execute({
          operationType: "authorization_role_grant",
          targetKey: `new_user:${stableHash("yoink_new_tenant_user_v1", displayName.toLocaleLowerCase("en-US"), initialRoleId)}`,
          payload: { displayName, initialRoleId, action: "create_user_with_role" },
          summary: { subjectUserId: "new user", roleId: initialRoleId, action: "Create user with role" },
          correlationId,
          ...adminChangeRequestId(request)
        }, () => {
          const created = authorization.createTenantUser({ displayName });
          authorization.grantRole(created.user.id, initialRoleId);
          return authorization.tenantUserDetail(created.user.id);
        });
        if (governed.disposition === "pending_approval") {
          json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
          return;
        }
        json(response, 201, governed.result);
        return;
      }

      if (request.method === "POST" && adminUserPairingMatch) {
        const subjectUserId = adminUserPairingMatch[1] ?? "";
        json(response, 201, {
          pairing: devices.createPairingCodeForUser(subjectUserId),
          user: authorization.tenantUserDetail(subjectUserId)
        });
        return;
      }

      if (request.method === "POST" && adminUserPauseMatch) {
        const subjectUserId = adminUserPauseMatch[1] ?? "";
        const body = await readJson(request);
        const paused = body.paused === undefined ? true : body.paused;
        if (typeof paused !== "boolean") {
          throw new ApiError("authorization_input_invalid", 400, "Choose whether store actions should be paused.");
        }
        json(response, 200, authorization.setTenantUserActionsPaused(subjectUserId, paused));
        return;
      }

      if (request.method === "PATCH" && adminUserMatch) {
        const body = await readJson(request);
        json(response, 200, authorization.setTenantUserStatus(
          adminUserMatch[1] ?? "",
          String(body.status ?? "") as "active" | "disabled"
        ));
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

      if (request.method === "POST" && watchEnrollMatch) {
        json(response, 200, { item: dropWindows.enroll(watchEnrollMatch[1] ?? "") });
        return;
      }

      if (request.method === "PATCH" && requestUrl.pathname === "/api/v1/user/watch-queue/settings") {
        const body = await readJson(request);
        if (body.confirmation !== WATCH_QUEUE_MODE_CONFIRMATION) {
          throw new ApiError("request_rejected", 400, "Explicit watch-queue mode confirmation is required.");
        }
        if (!["manual", "auto_armed"].includes(String(body.mode ?? ""))) {
          throw new ApiError("request_rejected", 400, "Choose a supported watch-queue mode.");
        }
        json(response, 200, {
          watchQueue: dropWindows.setWatchQueueMode(String(body.mode ?? "") as WatchQueueMode)
        });
        return;
      }

      if (request.method === "POST" && watchCancelMatch) {
        json(response, 200, { item: dropWindows.cancel(watchCancelMatch[1] ?? "") });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/user/connectors") {
        const body = await readJson(request);
        json(response, 201, {
          connector: userActionConnectors.save(body as unknown as UserActionConnectorInput)
        });
        return;
      }

      if (request.method === "PATCH" && userConnectorMatch) {
        const body = await readJson(request);
        json(response, 200, {
          connector: userActionConnectors.save(
            body as unknown as UserActionConnectorInput,
            userConnectorMatch[1] ?? ""
          )
        });
        return;
      }

      if (request.method === "POST" && userConnectorTestMatch) {
        json(response, 202, {
          delivery: userActionConnectors.queueTest(userConnectorTestMatch[1] ?? "")
        });
        dependencies.backgroundWorkerWake?.();
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/user/privacy/policy-viewed") {
        json(response, 200, { compliance: privacyCompliance.record("privacy_policy", "viewed") });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/user/privacy/change-acknowledged") {
        json(response, 200, { compliance: privacyCompliance.record("change_notice", "acknowledged") });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/user/purchase-intents/legacy-transition") {
        const body = await readJson(request);
        json(response, 200, {
          transition: control.transitionLegacyPurchaseIntents(body as unknown as LegacyPurchaseIntentTransitionInput)
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
          userPurchaseIntentUpdateInput(body)
        );
        notifyActionJobAvailability();
        json(response, 200, {
          purchaseIntent: decoratePurchaseIntents([purchaseIntent])[0]
        });
        return;
      }

      if (request.method === "DELETE" && purchaseIntentDetailMatch) {
        const body = await readJson(request);
        const deletion = control.deleteMission(
          purchaseIntentDetailMatch[1] ?? "",
          body as unknown as PurchaseIntentDeleteInput
        );
        notifyActionJobAvailability();
        json(response, 200, {
          deletion
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
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/hosted-delivery/signals") {
        const body = await readJson(request);
        json(response, 202, signalIngress.acceptProvider(body as unknown as SignalProviderEnvelope));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/hosted-delivery/signals/batch") {
        const body = await readJson(request);
        if (!Array.isArray(body.signals)) throw new ApiError("request_rejected", 400, "A provider signal batch is required.");
        json(response, 202, signalIngress.acceptProviderBatch(
          body.signals as unknown as SignalProviderEnvelope[]
        ));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/hosted-delivery/discord/signals") {
        const body = await readJson(request) as unknown as DiscordChannelSignalInput;
        const channel = signalProviders.requireActiveChannel(body.channelId, "discord");
        json(response, 202, signalIngress.acceptProvider(discordSignalEnvelope(body, channel)));
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
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/sources/channels") {
        json(response, 200, { items: signalProviders.listChannels(requestUrl.searchParams.get("provider") ?? "") });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/sources/channels") {
        const body = await readJson(request);
        const channel = signalProviders.createChannel(body as unknown as SignalProviderChannelInput);
        json(response, channel.created ? 201 : 200, { channel });
        return;
      }
      if (request.method === "PATCH" && signalProviderChannelMatch) {
        const body = await readJson(request);
        json(response, 200, {
          channel: signalProviders.updateChannel(
            signalProviderChannelMatch[1] ?? "",
            body as unknown as SignalProviderChannelUpdate
          )
        });
        return;
      }
      if (request.method === "POST" && sourceChannelReplayMatch) {
        const body = await readJson(request);
        const channel = signalProviders.getChannel(sourceChannelReplayMatch[1] ?? "");
        if (!channel) throw new ApiError("not_found", 404, "The signal provider channel does not exist.");
        const maximum = Math.max(1, Math.min(20, Math.floor(Number(body.maximum ?? 10) || 10)));
        const candidates = db.all<{ id: string }>(
          `SELECT id FROM inbox_messages
           WHERE tenant_id = ? AND user_id = ? AND state = 'dead_letter'
             AND event_type = ?
             AND json_extract(payload_json, '$.sourceConnectionId') = ?
           ORDER BY received_at, id LIMIT ?`,
          currentRequestScope().tenantId,
          currentRequestScope().userId,
          SIGNAL_INGRESS_EVENT_TYPE,
          channel.sourceConnectionId,
          maximum
        );
        const receipts = candidates.map((candidate) =>
          signalIngress.retryDeadLetter(candidate.id, correlationId)
        );
        dependencies.backgroundWorkerWake?.();
        json(response, 202, { channelId: channel.id, replayed: receipts.length, receipts });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/admin/drop-windows") {
        json(response, 200, {
          items: dropWindows.list(Date.now(), true, "tenant"),
          timezone: spendLedger.policy().timezone
        });
        return;
      }
      if (request.method === "GET" && adminDropWindowMatch) {
        const window = dropWindows.detail(adminDropWindowMatch[1] ?? "", Date.now(), "tenant");
        if (!window) throw new ApiError("drop_window_not_found", 404, "The drop window does not exist.");
        json(response, 200, { window });
        return;
      }
      if (request.method === "PATCH" && adminDropWindowMatch) {
        const body = await readJson(request);
        json(response, 200, {
          window: dropWindows.update(
            adminDropWindowMatch[1] ?? "",
            body as unknown as DropWindowUpdateInput,
            Date.now(),
            "tenant"
          )
        });
        return;
      }
      if (request.method === "POST" && adminDropWindowCancelMatch) {
        const body = await readJson(request);
        json(response, 200, {
          window: dropWindows.cancelWindow(
            adminDropWindowCancelMatch[1] ?? "",
            String(body.reasonCode ?? "") as DropWindowCancelReason,
            Date.now(),
            "tenant"
          )
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/admin/drop-windows") {
        const body = await readJson(request);
        const created = dropWindows.create(body as unknown as DropWindowInput);
        const receipts = signalIngress.acceptProviderBatch(created.signals.map((signal) => ({
          contractVersion: 1 as const,
          provider: "drop_window" as const,
          channelId: created.sourceChannelId,
          signal
        })));
        json(response, 201, { window: created, signals: receipts });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/admin/restock-patterns") {
        json(response, 200, {
          items: restockPatterns.list(requestUrl.searchParams.get("retailer") ?? "")
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/admin/restock-patterns/recompute") {
        const body = await readJson(request);
        json(response, 200, {
          pattern: restockPatterns.recompute(body.listingId, body.timezone ?? "UTC")
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/admin/workers/restart") {
        if (!dependencies.backgroundWorkerRestart) {
          throw new ApiError("worker_restart_unavailable", 409, "This deployment does not own an embedded worker to restart.");
        }
        await dependencies.backgroundWorkerRestart();
        json(response, 200, { restarted: true, worker: await dependencies.backgroundWorkerStatus?.() ?? null });
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
          throw new ApiError("request_rejected", 400, "The community consent route and payload must match.");
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
          throw new ApiError("request_rejected", 400, "Explicit observer recipe witness publication confirmation is required.");
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
          throw new ApiError("request_rejected", 400, "A valid rooted trust manifest and explicit installation confirmation are required.");
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
            throw new ApiError("request_rejected", 400, "A valid signed observer recipe promotion is required.");
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
            throw new ApiError("request_rejected", 400, "Explicit rooted observer recipe re-signing is required.");
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
          if (body.confirmation !== "DISABLE_OBSERVER_RECIPE") throw new ApiError("request_rejected", 400, "Explicit observer recipe kill-switch confirmation is required.");
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
          if (body.confirmation !== "ROLLBACK_OBSERVER_RECIPE") throw new ApiError("request_rejected", 400, "Explicit observer recipe rollback confirmation is required.");
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
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/qualifications/readiness") {
        json(response, 200, { plan: retailerReadiness.reverifyPlan() });
        return;
      }
      const retireQualificationMatch = /^\/api\/v1\/qualifications\/([a-z][a-z0-9]{1,31})\/retire$/.exec(requestUrl.pathname);
      if (request.method === "POST" && retireQualificationMatch) {
        const addLaneDefinition = addLane(retireQualificationMatch[1] ?? "");
        if (!addLaneDefinition) throw new ApiError("not_found", 404, "The guarded store lane was not found.");
        const body = await readJson(request);
        if (body.confirmation !== "RETIRE_ONE_RETAILER_LANE") {
          throw new ApiError("request_rejected", 400, "Explicit single-lane retirement confirmation is required.");
        }
        const lane = retailerReadiness.retireLane(
          addLaneDefinition.id,
          body.reasonCode ?? "operator_retired"
        );
        notifyActionJobAvailability();
        json(response, 200, { lane });
        return;
      }
      const activateAddMatch = /^\/api\/v1\/qualifications\/([a-z][a-z0-9]{1,31})-add\/activate$/.exec(requestUrl.pathname);
      if (request.method === "POST" && activateAddMatch) {
        const lane = addLane(activateAddMatch[1] ?? "");
        if (!lane) throw new ApiError("not_found", 404, "The guarded store lane was not found.");
        const retailerId = lane.id;
        const body = await readJson(request);
        if (body.adapterVersion !== lane.contractVersion
          || body.confirmation !== lane.activationConfirmation
          || !/^[a-f0-9]{64}$/.test(String(body.evidenceHash ?? ""))) {
          throw new ApiError(
            "request_rejected",
            400,
            "Explicit " + lane.name + " add-only activation confirmation and current evidence are required."
          );
        }
        const governed = adminChanges.execute({
          operationType: "retailer_lane_activate",
          targetKey: retailerId,
          payload: body,
          summary: { retailerId, action: "Activate guarded add-only execution" },
          correlationId,
          ...adminChangeRequestId(request)
        }, () => activateAndReconcileProfiles(
          retailerId,
          () => qualifications.activateAdd(retailerId, body as never)
        ));
        if (governed.disposition === "pending_approval") {
          json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
          return;
        }
        notifyActionJobAvailability();
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
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/admin/signals/simulate") {
        const body = await readJson(request);
        json(response, 200, { simulation: adminSignalSimulator.simulate(body) });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/signals") {
        const body = await readJson(request);
        const result = engine.process(body as unknown as SignalEventInput);
        if (result.actionJobId) notifyActionJobAvailability();
        json(response, 202, result);
        return;
      }
      const reviewResolutionMatch = /^\/api\/v1\/jobs\/([A-Za-z0-9_-]{3,120})\/resolve$/.exec(requestUrl.pathname);
      if (request.method === "POST" && reviewResolutionMatch) {
        const body = await readJson(request);
        if (!["confirmed", "cancelled"].includes(String(body.outcome))) {
          throw new ApiError("request_rejected", 400, "A supported manual-review outcome is required.");
        }
        const job = signals.resolveReviewJob(
          reviewResolutionMatch[1] ?? "",
          body.outcome as "confirmed" | "cancelled",
          String(body.confirmation ?? ""),
          String(body.note ?? "")
        );
        notifyActionJobAvailability();
        json(response, 200, { job });
        return;
      }
      const cartOutcomeMatch = /^\/api\/v1\/jobs\/([A-Za-z0-9_-]{3,120})\/outcome$/.exec(requestUrl.pathname);
      if (request.method === "POST" && cartOutcomeMatch) {
        const body = await readJson(request);
        if (!["got_it", "missed_it"].includes(String(body.outcome))) {
          throw new ApiError("request_rejected", 400, "Choose Got it or Missed it for this cart action.");
        }
        const outcome = signals.reportCartOutcome(
          cartOutcomeMatch[1] ?? "",
          body.outcome as "got_it" | "missed_it",
          String(body.confirmation ?? ""),
          body.outcome === "got_it" ? Number(body.actualTotalCents) : null,
          String(body.note ?? "")
        );
        notifyActionJobAvailability();
        json(response, 200, { outcome });
        return;
      }
      if (request.method === "PUT" && requestUrl.pathname === "/api/v1/strategies") {
        const body = await readJson(request);
        if (!Array.isArray(body.strategies)) throw new ApiError("request_rejected", 400, "The strategies field must be a list.");
        json(response, 200, { items: control.replaceStrategies(body.strategies as StrategyDefinition[]) });
        return;
      }
      if (request.method === "PATCH" && missionDetailMatch) {
        const body = await readJson(request);
        const mission = control.updateMission(missionDetailMatch[1] ?? "", body as unknown as MissionUpdateInput);
        notifyActionJobAvailability();
        json(response, 200, { mission });
        return;
      }
      if (request.method === "PATCH" && requestUrl.pathname === "/api/v1/settings") {
        const body = await readJson(request);
        json(response, 200, { settings: control.updateSettings(body as unknown as AppSettingsUpdateInput) });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/purchase-profiles") {
        json(response, 200, {
          items: control.listPurchaseProfiles().map((profile) => ({
            ...profile,
            linkedMissionCount: control.purchaseProfileLinkedMissionIds(profile.id).length
          }))
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/purchase-profiles") {
        const body = await readJson(request);
        const saved = control.savePurchaseProfile(body as unknown as PurchaseProfileInput);
        json(response, 200, { items: saved.profiles, propagation: saved.propagation });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/purchase-profiles/apply") {
        const body = await readJson(request);
        const applied = control.applyPurchaseProfileToMissions(body as unknown as PurchaseProfileApplyInput);
        notifyActionJobAvailability();
        json(response, 200, { applied });
        return;
      }
      const purchaseProfileMatch = /^\/api\/v1\/purchase-profiles\/([A-Za-z0-9_-]{3,120})$/.exec(requestUrl.pathname);
      if (request.method === "DELETE" && purchaseProfileMatch) {
        const profileId = purchaseProfileMatch[1] ?? "";
        const profile = control.listPurchaseProfiles().find((candidate) => candidate.id === profileId);
        const unlinkedMissionIds = control.purchaseProfileLinkedMissionIds(profileId);
        const items = control.deletePurchaseProfile(profileId);
        json(response, 200, {
          items,
          deleted: profile ? { profile, unlinkedMissionIds, unlinkedMissionCount: unlinkedMissionIds.length } : null
        });
        return;
      }
      if (request.method === "PUT" && [
        "/api/v1/attribution-policies",
        "/api/v1/admin/attribution-policies"
      ].includes(requestUrl.pathname)) {
        const body = await readJson(request);
        if (!Array.isArray(body.policies)) throw new ApiError("request_rejected", 400, "The policies field must be a list.");
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
      if (request.method === "PATCH" && requestUrl.pathname === "/api/v1/admin/settings/actions") {
        const body = await readJson(request);
        if (typeof body.paused !== "boolean") throw new ApiError("request_rejected", 400, "The paused field must be true or false.");
        const reason = String(body.reason ?? (body.paused
          ? "Administrator paused purchase actions for every shopper."
          : "Administrator resumed qualified purchase actions for every shopper."));
        if (body.paused === true) {
          json(response, 200, control.setTenantActionsPaused(true, reason));
          return;
        }
        const scope = currentRequestScope();
        const governed = adminChanges.execute({
          operationType: "global_actions_resume",
          targetKey: `tenant:${scope.tenantId}:actions`,
          payload: body,
          summary: { action: "Resume purchase actions for every shopper" },
          correlationId,
          ...adminChangeRequestId(request)
        }, () => control.setTenantActionsPaused(false, reason));
        if (governed.disposition === "pending_approval") {
          json(response, 202, { disposition: governed.disposition, changeRequest: governed.request });
          return;
        }
        json(response, 200, governed.result);
        return;
      }
      if (request.method === "PATCH" && requestUrl.pathname === "/api/v1/settings/actions") {
        const body = await readJson(request);
        if (typeof body.paused !== "boolean") throw new ApiError("request_rejected", 400, "The paused field must be true or false.");
        if (body.paused === false
          && !qualifications.targetAddQualified()
          && !qualifications.walmartAddQualified()
          && !qualifications.amazonAddQualified()
          && !qualifications.bestBuyAddQualified()) {
          throw new ApiError("request_rejected", 400, "Turn on cart adds for at least one store in Stores before resuming actions.");
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

      if (routePolicy?.classified) {
        json(response, 405, { error: "method_not_allowed", message: "That HTTP method is not supported for this Yoink route." });
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
