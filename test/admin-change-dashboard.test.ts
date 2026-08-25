import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { AdminChangeControlRepository } from "../packages/database/src/admin-change-control-repository.js";
import { LOCAL_TENANT_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 80): Promise<void> {
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

test("the admin Approvals workspace reviews an exact request without applying it", async () => {
  const db = new YoinkDatabase();
  const timestamp = new Date().toISOString();
  db.run(
    "INSERT INTO users(id, tenant_id, display_name, created_at) VALUES ('user_dashboard_requester', ?, 'Dashboard requester', ?)",
    LOCAL_TENANT_ID,
    timestamp
  );
  db.run(
    `INSERT INTO authorization_memberships(
       tenant_id, user_id, role_id, status, granted_by_actor_id, created_at, updated_at
     ) VALUES (?, 'user_dashboard_requester', 'security_admin', 'active', 'test_fixture', ?, ?)`,
    LOCAL_TENANT_ID,
    timestamp,
    timestamp
  );
  const requesterScope: RequestScope = {
    tenantId: LOCAL_TENANT_ID,
    userId: "user_dashboard_requester",
    actorKind: "user",
    actorId: "actor_dashboard_requester",
    authenticationAssurance: "step_up",
    authenticationTime: Math.floor(Date.now() / 1_000),
    sessionId: "session_dashboard_requester"
  };
  const changes = new AdminChangeControlRepository(db);
  let protectedExecutions = 0;
  const pending = runWithRequestScope(requesterScope, () => changes.execute({
    operationType: "retailer_lane_activate",
    targetKey: "amazon",
    payload: { retailerId: "amazon", confirmation: "DASHBOARD_EXACT_PAYLOAD" },
    summary: { retailerId: "amazon", action: "Activate guarded add-only execution" },
    correlationId: "dashboard_change_request_001"
  }, () => { protectedExecutions += 1; }));
  assert.equal(pending.disposition, "pending_approval");

  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({ db, webRoot, version: "admin-dashboard-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#approvals`,
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
    const script = readFileSync(join(webRoot, "app.js"), "utf8");
    await browser.eval(`(async () => { ${script}\n })()`);
    await eventually(() => assert.match(browser.document.querySelector("#changeAssuranceTitle")?.textContent ?? "", /Trusted local control center/));
    await eventually(() => assert.match(browser.document.querySelector("#adminChangeRequestList")?.textContent ?? "", /Dashboard requester/));
    assert.match(browser.document.querySelector("#adminChangeRequestList")?.textContent ?? "", /Waiting for a different authorized person/);
    assert.equal(protectedExecutions, 0);

    const approve = browser.document.querySelector(`[data-admin-change-approve="${pending.request.id}"]`) as HTMLButtonElement;
    assert.ok(approve);
    assert.equal(approve.disabled, false);
    approve.click();
    await eventually(() => assert.equal(
      runWithRequestScope(LOCAL_REQUEST_SCOPE, () => changes.detail(pending.request.id).status),
      "approved"
    ));
    await eventually(() => assert.match(browser.document.querySelector("#adminChangeRequestList")?.textContent ?? "", /Approved\. Retry the exact original action/));
    assert.equal(protectedExecutions, 0);
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
