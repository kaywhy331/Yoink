import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { initializeTenantUserWorkspace } from "../packages/database/src/authorization-repository.js";
import { YoinkDatabase, LOCAL_TENANT_ID, LOCAL_USER_ID } from "../packages/database/src/database.js";
import { type RequestScope } from "../packages/database/src/request-scope.js";

test("shopper overview exposes only the approved settings projection and its own tenant's read-only plansFromCalls flag", async () => {
  const db = new YoinkDatabase();
  const other: RequestScope = { tenantId: "tenant_projection", userId: "user_projection", actorKind: "user", actorId: "user_projection" };
  const customer: RequestScope = { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID, actorKind: "user", actorId: LOCAL_USER_ID };
  const now = new Date().toISOString();
  db.run("INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)", other.tenantId, "Projection tenant", now);
  db.run("INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)", other.userId, other.tenantId, "Projection user", now);
  initializeTenantUserWorkspace(db, { ...other, pauseReason: "First-run safety pause" });
  db.run("UPDATE app_settings SET plans_from_calls = 1, tax_bps = 9876, dedupe_window_seconds = 987 WHERE user_id = ?", other.userId);
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "projection-test",
    requestScopeResolver: req => req.headers["x-test-principal"] === "other" ? other : customer });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (principal: string) => {
    const response = await fetch(`${origin}/api/v1/user/overview`, { headers: { "X-Test-Principal": principal } });
    assert.equal(response.status, 200);
    return await response.json() as { settings: Record<string, unknown> };
  };
  try {
    for (const [principal, expected] of [["local", false], ["other", true]] as const) {
      const { settings } = await get(principal);
      assert.deepEqual(Object.keys(settings).sort(), ["actionsPaused", "executionMode", "pauseReason", "plansFromCalls", "resume"]);
      assert.equal(settings.plansFromCalls, expected);
      for (const path of ["/api/v1/user/settings", "/api/v1/user/settings/restock-retry"]) {
        const response = await fetch(origin + path, { method: "PATCH", headers: {
          Origin: origin, "Content-Type": "application/json", "X-Test-Principal": principal
        }, body: JSON.stringify({ plansFromCalls: !expected }) });
        assert.equal(response.status, 404);
      }
      assert.equal((await get(principal)).settings.plansFromCalls, expected);
    }
    db.run("UPDATE app_settings SET plans_from_calls = 0 WHERE user_id = ?", other.userId);
    db.run("UPDATE app_settings SET plans_from_calls = 1 WHERE user_id = ?", LOCAL_USER_ID);
    assert.equal((await get("other")).settings.plansFromCalls, false);
    assert.equal((await get("local")).settings.plansFromCalls, true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});
