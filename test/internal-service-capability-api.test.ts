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
    assert.match(cutoverText, /5 NOLOGIN roles hold 94 exact SELECT grants/);
    assert.match(cutoverText, /Server-bound tenant sessions/);
    assert.match(cutoverText, /82 restrictive policies/);
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
