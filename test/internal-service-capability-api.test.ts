import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  loadInternalServiceCapabilityRegistry,
  safeInternalServiceCapabilityProjection
} from "../apps/api/src/internal-service-capabilities.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { postgresCutoverCapabilityProjection } from "../packages/database/src/postgres-cutover.js";
import { postgresRuntimeReadRoleCapabilityProjection } from "../packages/database/src/postgres-runtime-roles.js";
import { postgresTenantSessionCapabilityProjection } from "../packages/database/src/postgres-tenant-session.js";
import { postgresTenantQueueWriteCapabilityProjection } from "../packages/database/src/postgres-tenant-queue-writes.js";
import { postgresWorkerControlCapabilityProjection } from "../packages/database/src/postgres-worker-control.js";
import { postgresNotificationRecoveryCapabilityProjection } from "../packages/database/src/postgres-notification-recovery.js";
import { postgresExecutionRecoveryCapabilityProjection } from "../packages/database/src/postgres-execution-recovery.js";
import { postgresOperationalRetentionCapabilityProjection } from "../packages/database/src/postgres-operational-retention.js";
import { postgresObserverCandidateEvaluationCapabilityProjection } from "../packages/database/src/postgres-observer-repair-candidate-evaluation.js";
import { postgresOperatorAlertConnectorDispatchCapabilityProjection } from "../packages/database/src/postgres-operator-alert-connector-dispatch.js";
import { postgresOperatorAlertReconciliationCapabilityProjection } from "../packages/database/src/postgres-operator-alert-reconciliation.js";
import { postgresObserverWitnessRefreshCapabilityProjection } from "../packages/database/src/postgres-observer-witness-refresh.js";
import { postgresHostedDeliveryLeaseRecoveryCapabilityProjection } from "../packages/database/src/postgres-hosted-delivery-lease-recovery.js";
import { postgresSignalCatalogApplyCapabilityProjection } from "../packages/database/src/postgres-signal-catalog-apply.js";
import { postgresSignalResolutionApplyCapabilityProjection } from "../packages/database/src/postgres-signal-resolution-apply.js";
import { postgresSignalSourceReferenceRefreshCapabilityProjection } from "../packages/database/src/postgres-signal-source-reference-refresh.js";
import { postgresSignalTerminalDecisionApplyCapabilityProjection } from "../packages/database/src/postgres-signal-terminal-decision-apply.js";
import { postgresSignalOfferIncidentApplyCapabilityProjection } from "../packages/database/src/postgres-signal-offer-incident-apply.js";
import { postgresSignalPostIncidentDecisionApplyCapabilityProjection } from "../packages/database/src/postgres-signal-post-incident-decision-apply.js";
import { postgresSignalMissionBindingApplyCapabilityProjection } from "../packages/database/src/postgres-signal-mission-binding-apply.js";
import { postgresSignalStrategyEvaluationApplyCapabilityProjection } from "../packages/database/src/postgres-signal-strategy-evaluation-apply.js";
import { postgresSignalWriterLockProtocolCapabilityProjection } from "../packages/database/src/postgres-signal-writer-lock-protocol.js";
import { postgresSignalConstraintConfigCapabilityProjection } from "../packages/database/src/postgres-signal-constraint-config-apply.js";
import { postgresSignalActionSpendCapabilityProjection } from "../packages/database/src/postgres-signal-action-spend-apply.js";
import { postgresSignalTargetQualificationCapabilityProjection } from "../packages/database/src/postgres-signal-target-qualification-apply.js";
import { postgresSignalSourceTrustCapabilityProjection } from "../packages/database/src/postgres-signal-source-trust-apply.js";
import { postgresSignalRetailerQualificationCapabilityProjection } from "../packages/database/src/postgres-signal-retailer-qualification-apply.js";
import { postgresSignalMissionPolicyCapabilityProjection } from "../packages/database/src/postgres-signal-mission-policy-apply.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 100): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

test("health and the admin Access workspace expose only safe workload capability state", async () => {
  const rawActorIds = ["delivery_worker_private", "eligibility_worker_private", "principal_worker_private"];
  const registry = loadInternalServiceCapabilityRegistry(JSON.stringify({
    [rawActorIds[0]!]: "internal.delivery",
    [rawActorIds[1]!]: "internal.eligibility",
    [rawActorIds[2]!]: "internal.principal"
  }));
  const safeRegistry = safeInternalServiceCapabilityProjection(registry);
  const db = new YoinkDatabase();
  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({
    db,
    webRoot,
    version: "internal-service-capability-test",
    internalServiceCapabilityRegistry: safeRegistry
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#access`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: (path: string, options: RequestInit = {}) => fetch(new URL(path, baseUrl), {
      ...options,
      headers: {
        ...(options.method && options.method !== "GET" ? { Origin: baseUrl } : {}),
        ...(options.headers || {})
      }
    })
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "confirm", { configurable: true, value: () => true });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });

  try {
    const health = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(health.workloadScopedInternalServiceAuthorization, true);
    assert.equal(health.unconfiguredInternalServicesDenied, true);
    assert.equal(health.internalServiceCapabilityHeaderAccepted, false);
    assert.equal(health.internalServiceCapabilityRegistryCount, 3);
    assert.deepEqual(health.internalServiceCapabilityCoverage, { delivery: 1, eligibility: 1, principal: 1 });
    assert.equal(rawActorIds.some((actorId) => JSON.stringify(health).includes(actorId)), false);

    const snapshot = await fetch(`${baseUrl}/api/v1/admin/snapshot`).then((response) => response.json()) as {
      authorization: { internalServices: typeof safeRegistry };
      dataPlane: {
        activeStorageEngine: string;
        postgresCutover: ReturnType<typeof postgresCutoverCapabilityProjection>;
        postgresRuntimeReadRoles: ReturnType<typeof postgresRuntimeReadRoleCapabilityProjection>;
        postgresTenantSessions: ReturnType<typeof postgresTenantSessionCapabilityProjection>;
        postgresTenantQueueWrites: ReturnType<typeof postgresTenantQueueWriteCapabilityProjection>;
        postgresWorkerControl: ReturnType<typeof postgresWorkerControlCapabilityProjection>;
        postgresNotificationRecovery: ReturnType<typeof postgresNotificationRecoveryCapabilityProjection>;
        postgresExecutionRecovery: ReturnType<typeof postgresExecutionRecoveryCapabilityProjection>;
        postgresOperationalRetention: ReturnType<typeof postgresOperationalRetentionCapabilityProjection>;
        postgresObserverCandidateEvaluation: ReturnType<typeof postgresObserverCandidateEvaluationCapabilityProjection>;
        postgresOperatorAlertConnectorDispatch: ReturnType<typeof postgresOperatorAlertConnectorDispatchCapabilityProjection>;
        postgresOperatorAlertReconciliation: ReturnType<typeof postgresOperatorAlertReconciliationCapabilityProjection>;
        postgresObserverWitnessRefresh: ReturnType<typeof postgresObserverWitnessRefreshCapabilityProjection>;
        postgresHostedDeliveryLeaseRecovery: ReturnType<typeof postgresHostedDeliveryLeaseRecoveryCapabilityProjection>;
        postgresSignalCatalogApply: ReturnType<typeof postgresSignalCatalogApplyCapabilityProjection>;
        postgresSignalResolutionApply: ReturnType<typeof postgresSignalResolutionApplyCapabilityProjection>;
        postgresSignalSourceReferenceRefresh: ReturnType<typeof postgresSignalSourceReferenceRefreshCapabilityProjection>;
        postgresSignalTerminalDecisionApply: ReturnType<typeof postgresSignalTerminalDecisionApplyCapabilityProjection>;
        postgresSignalOfferIncidentApply: ReturnType<typeof postgresSignalOfferIncidentApplyCapabilityProjection>;
        postgresSignalPostIncidentDecisionApply: ReturnType<typeof postgresSignalPostIncidentDecisionApplyCapabilityProjection>;
        postgresSignalMissionBindingApply: ReturnType<typeof postgresSignalMissionBindingApplyCapabilityProjection>;
        postgresSignalStrategyEvaluationApply: ReturnType<typeof postgresSignalStrategyEvaluationApplyCapabilityProjection>;
        postgresSignalWriterLockProtocol: ReturnType<typeof postgresSignalWriterLockProtocolCapabilityProjection>;
        postgresSignalConstraintConfigApply: ReturnType<typeof postgresSignalConstraintConfigCapabilityProjection>;
        postgresSignalActionSpendApply: ReturnType<typeof postgresSignalActionSpendCapabilityProjection>;
        postgresSignalTargetQualificationApply: ReturnType<typeof postgresSignalTargetQualificationCapabilityProjection>;
        postgresSignalSourceTrustApply: ReturnType<typeof postgresSignalSourceTrustCapabilityProjection>;
        postgresSignalRetailerQualificationApply: ReturnType<typeof postgresSignalRetailerQualificationCapabilityProjection>;
        postgresSignalMissionPolicyApply: ReturnType<typeof postgresSignalMissionPolicyCapabilityProjection>;
      };
      capabilities: Record<string, unknown>;
    };
    assert.deepEqual(snapshot.authorization.internalServices, safeRegistry);
    assert.equal(snapshot.capabilities.workloadScopedInternalServiceAuthorization, true);
    assert.equal(snapshot.capabilities.internalServiceCapabilityHeaderAccepted, false);
    assert.equal(snapshot.dataPlane.activeStorageEngine, "sqlite");
    assert.deepEqual(snapshot.dataPlane.postgresCutover, postgresCutoverCapabilityProjection());
    assert.deepEqual(snapshot.dataPlane.postgresRuntimeReadRoles, postgresRuntimeReadRoleCapabilityProjection());
    assert.deepEqual(snapshot.dataPlane.postgresTenantSessions, postgresTenantSessionCapabilityProjection());
    assert.deepEqual(
      snapshot.dataPlane.postgresTenantQueueWrites,
      postgresTenantQueueWriteCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresWorkerControl,
      postgresWorkerControlCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresNotificationRecovery,
      postgresNotificationRecoveryCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresExecutionRecovery,
      postgresExecutionRecoveryCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresOperationalRetention,
      postgresOperationalRetentionCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresObserverCandidateEvaluation,
      postgresObserverCandidateEvaluationCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresOperatorAlertConnectorDispatch,
      postgresOperatorAlertConnectorDispatchCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresOperatorAlertReconciliation,
      postgresOperatorAlertReconciliationCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresObserverWitnessRefresh,
      postgresObserverWitnessRefreshCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresHostedDeliveryLeaseRecovery,
      postgresHostedDeliveryLeaseRecoveryCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalCatalogApply,
      postgresSignalCatalogApplyCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalResolutionApply,
      postgresSignalResolutionApplyCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalSourceReferenceRefresh,
      postgresSignalSourceReferenceRefreshCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalTerminalDecisionApply,
      postgresSignalTerminalDecisionApplyCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalOfferIncidentApply,
      postgresSignalOfferIncidentApplyCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalPostIncidentDecisionApply,
      postgresSignalPostIncidentDecisionApplyCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalMissionBindingApply,
      postgresSignalMissionBindingApplyCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalStrategyEvaluationApply,
      postgresSignalStrategyEvaluationApplyCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalWriterLockProtocol,
      postgresSignalWriterLockProtocolCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalConstraintConfigApply,
      postgresSignalConstraintConfigCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalActionSpendApply,
      postgresSignalActionSpendCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalTargetQualificationApply,
      postgresSignalTargetQualificationCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalSourceTrustApply,
      postgresSignalSourceTrustCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalRetailerQualificationApply,
      postgresSignalRetailerQualificationCapabilityProjection()
    );
    assert.deepEqual(
      snapshot.dataPlane.postgresSignalMissionPolicyApply,
      postgresSignalMissionPolicyCapabilityProjection()
    );
    assert.equal(rawActorIds.some((actorId) => JSON.stringify(snapshot).includes(actorId)), false);

    const script = readFileSync(join(webRoot, "app.js"), "utf8");
    await browser.eval(`(async () => { ${script}\n })()`);
    await eventually(() => assert.match(
      browser.document.querySelector("#internalServiceGate")?.textContent ?? "",
      /3 SCOPED/
    ));
    const workloadText = browser.document.querySelector("#internalServiceList")?.textContent ?? "";
    assert.match(workloadText, /internal\.delivery/);
    assert.match(workloadText, /internal\.eligibility/);
    assert.match(workloadText, /internal\.principal/);
    assert.equal(rawActorIds.some((actorId) => workloadText.includes(actorId)), false);
    assert.match(browser.document.querySelector("#postgresCutoverGate")?.textContent ?? "", /QUALIFICATION ONLY/);
    const cutoverText = browser.document.querySelector("#postgresCutoverChecklist")?.textContent ?? "";
    assert.match(cutoverText, /One-shot archive import/);
    assert.match(cutoverText, /Tenant-scope classification/);
    assert.match(cutoverText, /PostgreSQL worker-store contract/);
    assert.match(cutoverText, /Least-privilege read roles/);
    assert.match(cutoverText, /5 NOLOGIN roles hold 95 exact SELECT grants/);
    assert.match(cutoverText, /Server-bound tenant sessions/);
    assert.match(cutoverText, /83 restrictive policies/);
    assert.match(cutoverText, /PostgreSQL permits custom parameter changes, but they cannot widen the mapped tenant/);
    assert.match(cutoverText, /Bounded tenant queue repository/);
    assert.match(cutoverText, /5 tables expose 12 exact grants plus the binder, scope, and one immutable JSON constraint helper/);
    assert.match(cutoverText, /Atomic deployment attestation/);
    assert.match(cutoverText, /Least-privilege fleet control/);
    assert.match(cutoverText, /Server-bound notification recovery/);
    assert.match(cutoverText, /1 of 7 worker task families/);
    assert.match(cutoverText, /Server-bound action and spend recovery/);
    assert.match(cutoverText, /2 of 7 worker task families/);
    assert.match(cutoverText, /refuses cross-tenant shared-incident mutation/);
    assert.match(cutoverText, /Server-bound privacy retention/);
    assert.match(cutoverText, /Server-bound observer candidate evaluation/);
    assert.match(cutoverText, /Server-bound operator-alert connector dispatch/);
    assert.match(cutoverText, /exposes neither raw webhook URLs nor signing secrets/);
    assert.match(cutoverText, /Server-bound operator-alert reconciliation/);
    assert.match(cutoverText, /Coverage is 5 of 7/);
    assert.match(cutoverText, /Server-bound independent witness refresh/);
    assert.match(cutoverText, /Server-bound hosted-delivery lease recovery/);
    assert.match(cutoverText, /signal lifecycle/);
    assert.match(cutoverText, /resolution planning/);
    assert.match(cutoverText, /three principal-bound functions/);
    assert.match(cutoverText, /Coverage is 6 of 7/);
    assert.match(cutoverText, /Server-bound unknown-product catalog creation/);
    assert.match(cutoverText, /separate inactive NOLOGIN boundary/);
    assert.match(cutoverText, /13 canonical retailer formats/);
    assert.match(cutoverText, /cannot refresh existing references/);
    assert.match(cutoverText, /Server-bound signal event and resolution commit/);
    assert.match(cutoverText, /exact event, source heartbeat, and resolution-decision commit/);
    assert.match(cutoverText, /occurrences, incidents, offer observations, missions, actions/);
    assert.match(cutoverText, /Server-bound known-product source-reference refresh/);
    assert.match(cutoverText, /3 tenant source-reference tables/);
    assert.match(cutoverText, /conflicting remap cases fail closed/);
    assert.match(cutoverText, /Server-bound terminal signal decisions/);
    assert.match(cutoverText, /one occurrence, one terminal mission decision/);
    assert.match(cutoverText, /partial graphs and inconsistent replays fail closed/);
    assert.match(cutoverText, /Server-bound actionable offer incidents/);
    assert.match(cutoverText, /Server-bound post-incident decisions/);
    assert.match(cutoverText, /Server-bound signal mission binding/);
    assert.match(cutoverText, /Server-bound strategy and purchase-policy evaluation/);
    assert.match(cutoverText, /ninth independently inactive NOLOGIN boundary/);
    assert.match(cutoverText, /matched and price-required evaluations make a zero-write handoff/);
    assert.match(cutoverText, /PostgreSQL does not claim semantic evaluator authority/);
    assert.match(cutoverText, /Server-bound signal action writer-lock protocol/);
    assert.match(cutoverText, /eleventh independently inactive NOLOGIN boundary/);
    assert.match(cutoverText, /source → retailer qualification → settings → mission policy → spend lock order/);
    assert.match(cutoverText, /Remaining source lifecycle and reservation writers/);
    assert.match(cutoverText, /Server-bound bounded configuration writers/);
    assert.match(cutoverText, /Server-bound Target qualification and settings activation/);
    assert.match(cutoverText, /Server-bound source-trust configuration/);
    assert.match(cutoverText, /twelfth independently inactive NOLOGIN boundary/);
    assert.match(cutoverText, /fourteenth independently inactive NOLOGIN boundary/);
    assert.match(cutoverText, /Server-bound Walmart, Amazon, and Best Buy qualification/);
    assert.match(cutoverText, /fifteenth independently inactive NOLOGIN boundary/);
    assert.match(cutoverText, /Server-bound mission-policy revision/);
    assert.match(cutoverText, /sixteenth independently inactive NOLOGIN boundary/);
    assert.match(cutoverText, /global action pause\/resume, guardrail settings, and periodic spend caps/);
    assert.match(cutoverText, /Server-bound reviewed purchase-intent action and spend/);
    assert.match(cutoverText, /tenth independently inactive NOLOGIN boundary/);
    assert.match(cutoverText, /quantity-one add-to-cart job/);
    assert.match(cutoverText, /Strategy-authorized actions, retailer mutation, checkout, order submission, and inbox completion remain closed/);
    assert.match(cutoverText, /It consumes the shared writer-lock protocol/);
    assert.match(cutoverText, /Runtime principals and full repository parity/);
    assert.match(cutoverText, /Native multi-session lease contention/);
    assert.match(cutoverText, /3 independent PostgreSQL 16 backend sessions/);
    assert.match(cutoverText, /Runtime repositories and deployment drills/);
    assert.match(cutoverText, /Exact logical reconciliation/);
    assert.match(cutoverText, /Production authority/);
    assert.match(cutoverText, /required/);
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
