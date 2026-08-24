import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import {
  JOB_STATES,
  type CommunityConsentUpdateInput,
  type CommunityContributionInput,
  type IdentityClaimInput,
  type IdentityClaimReviewInput,
  type ObserverRecipePromotionInput,
  type ObserverRecipeProposalInput,
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
  type OperatorAlertAcknowledgeInput,
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
import { CatalogRepository } from "../../../packages/database/src/catalog-repository.js";
import {
  CatalogGovernanceRepository,
  type CatalogProposalDecisionInput
} from "../../../packages/database/src/catalog-governance-repository.js";
import { CatalogIdentityGovernanceRepository } from "../../../packages/database/src/catalog-identity-governance-repository.js";
import { AttributionRepository } from "../../../packages/database/src/attribution-repository.js";
import { AdapterDiagnosticRepository } from "../../../packages/database/src/adapter-diagnostic-repository.js";
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
import { ObserverRecipeRepository } from "../../../packages/database/src/observer-recipe-repository.js";
import { OperatorAlertRepository } from "../../../packages/database/src/operator-alert-repository.js";
import { MutationLaneRepository } from "../../../packages/database/src/mutation-lane-repository.js";
import { PORTABILITY_FORMAT } from "../../../packages/database/src/portability.js";
import {
  PrincipalRepository,
  type HostedPrincipalInput
} from "../../../packages/database/src/principal-repository.js";
import { QualificationRepository } from "../../../packages/database/src/qualification-repository.js";
import {
  LOCAL_REQUEST_SCOPE,
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
import { SignalEngine } from "../../../packages/engine/src/signal-engine.js";
import { newId } from "../../../packages/domain/src/ids.js";
import { trackalackerSignalInput } from "../../../packages/sources/src/trackalacker.js";
import { ObserverRecipeTrustAuthority } from "../../../packages/observer-registry/src/trust.js";
import { resolveExtensionRelease } from "./extension-release.js";
import { ApiError, apiErrorPayload } from "./api-error.js";
import { resolveApiRoutePolicy } from "./api-route-policy.js";

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
  requestScopeResolver?: (request: IncomingMessage) => RequestScope | Promise<RequestScope>;
  hostValidator?: (request: IncomingMessage) => boolean;
  mutationOriginValidator?: (request: IncomingMessage) => boolean;
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
  const catalog = new CatalogRepository(db);
  const catalogGovernance = new CatalogGovernanceRepository(db);
  const catalogIdentityGovernance = new CatalogIdentityGovernanceRepository(db);
  const attribution = new AttributionRepository(db);
  const adapterDiagnostics = new AdapterDiagnosticRepository(db);
  const authorization = new AuthorizationRepository(db);
  const audit = new AuditRepository(db);
  const control = new ControlRepository(db);
  const community = new CommunityEvidenceRepository(db);
  const signals = new SignalRepository(db);
  const offerIdentity = new OfferIdentityRepository(db);
  const spendLedger = new SpendLedgerRepository(db);
  const engine = new SignalEngine(db);
  const devices = new DeviceRepository(db);
  const execution = new ExecutionRepository(db);
  const hostedDelivery = new HostedDeliveryRepository(db);
  const identityClaims = new IdentityClaimRepository(db);
  const notifications = new NotificationRepository(db);
  const mutationLanes = new MutationLaneRepository(db);
  const observerRecipes = new ObserverRecipeRepository(db, dependencies.observerRecipeTrust ?? ObserverRecipeTrustAuthority.ephemeral());
  const operatorAlerts = new OperatorAlertRepository(db);
  const principals = new PrincipalRepository(db);
  const qualifications = new QualificationRepository(db);
  const shadowObservations = new ShadowObservationRepository(db);
  const sourceRuntime = new SourceRepository(db);
  const walmartDraws = new WalmartDrawRepository(db);

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
    const suppliedCorrelationId = String(request.headers["x-request-id"] ?? "").trim();
    const correlationId = /^[A-Za-z0-9_-]{8,120}$/.test(suppliedCorrelationId)
      ? suppliedCorrelationId
      : newId("request");
    response.setHeader("X-Request-ID", correlationId);
    try {
      const requestScope = await requestScopeResolver(request);
      await runWithRequestScope(requestScope, async () => {
      if (!hostValidator(request)) {
        json(response, 403, { error: "invalid_host", message: "The request Host header is not allowed." });
        return;
      }
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);
      if (request.method === "GET" && STATIC_FILES.has(requestUrl.pathname)) {
        authorization.require(ADMIN_STATIC_PATHS.has(requestUrl.pathname) ? "admin.read" : "user.read");
        if (staticResponse(response, webRoot, requestUrl.pathname)) return;
      }

      const routePolicy = resolveApiRoutePolicy(request.method ?? "GET", requestUrl.pathname);
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
      const operatorAlertIncidentActionMatch = /^\/api\/v1\/alerts\/incidents\/([A-Za-z0-9_-]{3,120})\/(acknowledge|resolve)$/.exec(requestUrl.pathname);

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/health") {
        const settings = control.settings();
        const targetAddQualified = qualifications.targetAddQualified();
        const walmartAddQualified = qualifications.walmartAddQualified();
        const amazonAddQualified = qualifications.amazonAddQualified();
        const bestBuyAddQualified = qualifications.bestBuyAddQualified();
        json(response, 200, {
          status: "ready",
          version,
          database: "ready",
          storageEngine: "sqlite",
          portabilityArchiveFormat: PORTABILITY_FORMAT,
          productionPostgresReady: false,
          executionMode: settings.executionMode,
          actionsPaused: settings.actionsPaused,
          chromeMutationEnabled: targetAddQualified || walmartAddQualified || amazonAddQualified || bestBuyAddQualified,
          targetAddExecutionEnabled: targetAddQualified,
          walmartAddExecutionEnabled: walmartAddQualified,
          amazonAddExecutionEnabled: amazonAddQualified,
          bestBuyAddExecutionEnabled: bestBuyAddQualified
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/extension/release") {
        json(response, 200, resolveExtensionRelease(releaseRoot, version).descriptor);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/extension/release/download") {
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

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/user/overview") {
        const missions = control.listMissions(20, 0, "");
        json(response, 200, {
          version,
          settings: control.settings(),
          counts: {
            products: catalog.libraryCount(),
            purchaseIntents: control.missionCount(),
            signals: signals.signalCount(),
            actions: signals.jobCount(),
            notifications: notifications.counts().totalNotifications,
            ...catalogGovernance.mineCounts()
          },
          purchaseIntents: missions,
          spend: spendLedger.summary(Date.now(), false),
          sources: control.listSources(),
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
        const items = control.listMissions(limit, offset, query);
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
        json(response, 200, { purchaseIntent: mission });
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
        if (!chromeExtensionOrigin(request)) {
          json(response, 403, { error: "extension_origin_rejected", message: "Pairing must be initiated by a Chrome extension origin." });
          return;
        }
        const body = await readJson(request);
        const paired = devices.pair(body as unknown as PairDeviceInput);
        json(response, 201, { device: paired });
        return;
      }

      const deviceRoute = requestUrl.pathname.startsWith("/api/v1/devices/self/");
      if (deviceRoute) {
        if (!chromeExtensionOrigin(request)) {
          json(response, 403, { error: "extension_origin_rejected", message: "This route is available only to the Chrome companion." });
          return;
        }
        const device = devices.authenticate(bearerToken(request));
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
          json(response, 200, { trust: observerRecipes.trustBundle(), recipe: observerRecipes.active(retailerId) });
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
          json(response, 202, engine.process(input));
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

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/snapshot") {
        const pairedDevices = devices.listDevices();
        const operatorAlertCounts = operatorAlerts.counts();
        const operatorAlertSnapshot = operatorAlerts.snapshot();
        const targetQualification = shadowObservations.targetQualificationReadiness();
        const walmartQualification = shadowObservations.walmartQualificationReadiness();
        const amazonQualification = shadowObservations.amazonQualificationReadiness();
        const bestBuyQualification = shadowObservations.bestBuyQualificationReadiness();
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
            ...operatorAlertCounts
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
            selectedOfferScopeVersion: 1,
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
            trust: observerRecipes.trustStatus(),
            mutationCapable: false,
            recipes: observerRecipes.list()
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
            roleAdministrationEnabled: authorization.has("security.manage")
          },
          operatorAlerts: operatorAlertSnapshot,
          retailerEvidence: shadowObservations.retailerEvidenceReadiness(),
          targetQualification,
          walmartQualification,
          amazonQualification,
          bestBuyQualification,
          futureMutationLanes: mutationLanes.readiness(),
          trackalacker: sourceRuntime.trackalackerStatus(),
          capabilities: {
            catalog: true,
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
            operatorAlertMutationAuthority: false,
            communityReadOnlyEvidence: true,
            exactSelectedOfferCommunityEvidence: true,
            communityAdvisoryOnly: true,
            identityClaimGovernance: true,
            automaticCatalogRemapping: false,
            reversibleCatalogIdentityGovernance: true,
            hostedGlobalCatalogAuthority: false,
            signedObserverRecipeRegistry: true,
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
            localExtensionUpdates: true,
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

      if (authorizationMembershipMatch && request.method === "POST") {
        json(response, 200, {
          memberships: authorization.grantRole(
            authorizationMembershipMatch[1] ?? "",
            authorizationMembershipMatch[2] ?? ""
          )
        });
        return;
      }

      if (authorizationMembershipMatch && request.method === "DELETE") {
        json(response, 200, {
          memberships: authorization.revokeRole(
            authorizationMembershipMatch[1] ?? "",
            authorizationMembershipMatch[2] ?? ""
          )
        });
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

      if (request.method === "POST" && operatorAlertIncidentActionMatch) {
        const body = await readJson(request);
        const incidentId = operatorAlertIncidentActionMatch[1] ?? "";
        const incident = operatorAlertIncidentActionMatch[2] === "acknowledge"
          ? operatorAlerts.acknowledge(incidentId, body as unknown as OperatorAlertAcknowledgeInput, correlationId)
          : operatorAlerts.resolve(incidentId, body as unknown as OperatorAlertResolveInput, correlationId);
        json(response, 200, { incident });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/user/purchase-intents") {
        const body = await readJson(request);
        const listing = catalog.requireListing(String(body.listingId ?? ""));
        const result = control.ensureMission(listing.variantId, listing.id, "user_selected");
        json(response, result.created ? 201 : 200, {
          purchaseIntent: control.missionDetail(result.mission.id),
          created: result.created
        });
        return;
      }

      if (request.method === "PATCH" && purchaseIntentDetailMatch) {
        const body = await readJson(request);
        json(response, 200, {
          purchaseIntent: control.updateMission(
            purchaseIntentDetailMatch[1] ?? "",
            body as unknown as MissionUpdateInput
          )
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

      if (request.method === "POST" && requestUrl.pathname === "/api/v1/admin/catalog/identity-operations") {
        const body = await readJson(request);
        const result = catalogIdentityGovernance.propose(body as unknown as CatalogIdentityOperationProposalInput);
        json(response, result.disposition === "created" ? 201 : 200, result);
        return;
      }

      if (request.method === "POST" && catalogIdentityOperationDecisionMatch) {
        const body = await readJson(request);
        json(response, 200, catalogIdentityGovernance.decide(
          catalogIdentityOperationDecisionMatch[1] ?? "",
          body as unknown as CatalogIdentityOperationDecisionInput
        ));
        return;
      }

      if (request.method === "POST" && catalogProposalDecisionMatch) {
        const body = await readJson(request);
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
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/observer-recipes/trust-manifests") {
        const body = await readJson(request);
        json(response, 201, {
          trust: observerRecipes.installTrustManifest(body as unknown as ObserverRecipeTrustManifestInstallInput)
        });
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
          json(response, 200, {
            recipe: observerRecipes.promote(recipeId, body as unknown as ObserverRecipePromotionInput)
          });
        } else if (action === "resign") {
          json(response, 200, {
            recipe: observerRecipes.resign(recipeId, body as unknown as ObserverRecipeResignInput)
          });
        } else if (action === "disable") {
          if (body.confirmation !== "DISABLE_OBSERVER_RECIPE") throw new Error("Explicit observer recipe kill-switch confirmation is required.");
          json(response, 200, { recipe: observerRecipes.disable(recipeId, String(body.reasonCode ?? "maintainer_kill_switch")) });
        } else {
          if (body.confirmation !== "ROLLBACK_OBSERVER_RECIPE") throw new Error("Explicit observer recipe rollback confirmation is required.");
          json(response, 200, observerRecipes.rollback(recipeId));
        }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/qualifications/target-add/activate") {
        const body = await readJson(request);
        json(response, 200, qualifications.activateTargetAdd(body as unknown as TargetAddActivationInput));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/qualifications/walmart-add/activate") {
        const body = await readJson(request);
        json(response, 200, qualifications.activateWalmartAdd(body as unknown as WalmartAddActivationInput));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/qualifications/amazon-add/activate") {
        const body = await readJson(request);
        json(response, 200, qualifications.activateAmazonAdd(body as unknown as AmazonAddActivationInput));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/qualifications/bestbuy-add/activate") {
        const body = await readJson(request);
        json(response, 200, qualifications.activateBestBuyAdd(body as unknown as BestBuyAddActivationInput));
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
      if (request.method === "PUT" && requestUrl.pathname === "/api/v1/attribution-policies") {
        const body = await readJson(request);
        if (!Array.isArray(body.policies)) throw new Error("The policies field must be a list.");
        json(response, 200, { policies: attribution.replacePolicies(body.policies as AttributionPolicyUpdateInput[]) });
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
        json(response, 200, { settings: control.setActionsPaused(body.paused, String(body.reason ?? "User changed the global action state.")) });
        return;
      }

      json(response, 404, { error: "not_found", message: "The requested Yoink route does not exist." });
      });
    } catch (error) {
      const problem = apiErrorPayload(error, correlationId);
      json(response, problem.status, problem.payload);
    }
  });
}
