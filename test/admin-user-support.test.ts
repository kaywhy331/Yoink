import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  AuthorizationError,
  AuthorizationRepository
} from "../packages/database/src/authorization-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import {
  LOCAL_REQUEST_SCOPE,
  runWithRequestScope,
  type RequestScope
} from "../packages/database/src/request-scope.js";

const NOW = Date.parse("2026-09-01T18:00:00.000Z");

function userScope(userId: string): RequestScope {
  return {
    tenantId: LOCAL_TENANT_ID,
    userId,
    actorKind: "user",
    actorId: userId
  };
}

test("admin support creates a complete user workspace and subject-bound pairing without cross-user leakage", () => {
  const db = new YoinkDatabase();
  try {
    const created = runWithRequestScope(LOCAL_REQUEST_SCOPE, () =>
      new AuthorizationRepository(db).createTenantUser({ displayName: "Test Shopper" }, NOW)
    );
    const shopperId = created.user.id;
    assert.equal(created.user.status, "active");
    assert.deepEqual(created.user.activeRoles, ["yoink_user"]);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM source_connections WHERE user_id = ?",
      shopperId
    )?.count, 3);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM attribution_policies WHERE user_id = ?",
      shopperId
    )?.count, 20);
    assert.equal(db.get<{ actionsPaused: number }>(
      "SELECT actions_paused AS actionsPaused FROM app_settings WHERE user_id = ?",
      shopperId
    )?.actionsPaused, 1);

    runWithRequestScope(userScope(shopperId), () => {
      const authorization = new AuthorizationRepository(db);
      assert.throws(
        () => authorization.tenantUsers(),
        (error) => error instanceof AuthorizationError && error.code === "permission_denied"
      );
    });

    const pairing = runWithRequestScope(LOCAL_REQUEST_SCOPE, () =>
      new DeviceRepository(db).createPairingCodeForUser(shopperId, NOW + 1_000)
    );
    const resolved = new DeviceRepository(db).resolvePairingCodeScope(pairing.code, NOW + 1_001);
    assert.equal(resolved?.userId, shopperId);
    const paired = runWithRequestScope(userScope(shopperId), () =>
      new DeviceRepository(db).pair({
        pairingCode: pairing.code,
        extensionVersion: "1.18.1",
        capabilities: { readiness: true, jobReconciliation: true }
      }, NOW + 2_000)
    );
    assert.equal(db.get<{ userId: string }>(
      "SELECT user_id AS userId FROM extension_devices WHERE id = ?",
      paired.id
    )?.userId, shopperId);
    assert.equal(runWithRequestScope(LOCAL_REQUEST_SCOPE, () =>
      new AuthorizationRepository(db).tenantUserDetail(shopperId, NOW + 2_001).devices[0]?.online
    ), true);

    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => {
      const authorization = new AuthorizationRepository(db);
      authorization.pauseTenantUserActions(shopperId, NOW + 3_000);
      const disabled = authorization.setTenantUserStatus(shopperId, "disabled", NOW + 4_000);
      assert.equal(disabled.user.status, "disabled");
      assert.equal(disabled.devices[0]?.status, "revoked");
    });
    assert.equal(new DeviceRepository(db).resolvePairingCodeScope(pairing.code, NOW + 4_001), null);
    assert.deepEqual(runWithRequestScope(userScope(shopperId), () =>
      new AuthorizationRepository(db).permissions()
    ), []);
    assert.equal(db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE event_type IN ('device_pairing_code_created', 'tenant_user_actions_paused', 'tenant_user_disabled')`
    )?.count, 3);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("admin user API enforces read/support/manage permissions and exposes the support workflow", async () => {
  const db = new YoinkDatabase();
  let shopperId = "";
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "admin-user-support-api-test",
    requestScopeResolver(request) {
      if (request.headers["x-test-principal"] === "local") return LOCAL_REQUEST_SCOPE;
      if (request.headers["x-test-principal"] === "shopper" && shopperId) return userScope(shopperId);
      throw new Error("Authenticated request scope is required.");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const mutate = (path: string, method: string, body: Record<string, unknown>) => fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "X-Test-Principal": "local",
      "Content-Type": "application/json",
      Origin: baseUrl
    },
    body: JSON.stringify(body)
  });
  try {
    const create = await mutate("/api/v1/admin/users", "POST", {
      displayName: "API Shopper",
      initialRoleId: "yoink_user"
    });
    assert.equal(create.status, 201);
    assert.equal(create.headers.get("x-yoink-api-surface"), "admin");
    shopperId = (await create.json() as { user: { id: string } }).user.id;

    const supportCreate = await mutate("/api/v1/admin/users", "POST", {
      displayName: "API Support User",
      initialRoleId: "support_readonly"
    });
    assert.equal(supportCreate.status, 201);
    const supportUserId = (await supportCreate.json() as { user: { id: string } }).user.id;
    assert.equal(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM authorization_memberships
      WHERE user_id = ? AND role_id = 'support_readonly' AND status = 'active'`, supportUserId)?.count, 1);
    assert.equal(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM admin_change_requests
      WHERE operation_type = 'authorization_role_grant' AND target_key LIKE 'new_user:%' AND status = 'consumed'`)?.count, 1);

    const denied = await fetch(`${baseUrl}/api/v1/admin/users/${LOCAL_USER_ID}`, {
      headers: { "X-Test-Principal": "shopper" }
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json() as { error: string }).error, "permission_denied");

    const list = await fetch(`${baseUrl}/api/v1/admin/users?q=${encodeURIComponent("API Shopper")}`, {
      headers: { "X-Test-Principal": "local" }
    });
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json() as { users: Array<{ id: string }> }).users.map((user) => user.id), [shopperId]);

    const detail = await fetch(`${baseUrl}/api/v1/admin/users/${shopperId}`, {
      headers: { "X-Test-Principal": "local" }
    });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json() as { user: { displayName: string } }).user.displayName, "API Shopper");

    const pairing = await mutate(`/api/v1/admin/users/${shopperId}/pairing-code`, "POST", {});
    assert.equal(pairing.status, 201);
    assert.match((await pairing.json() as { pairing: { code: string } }).pairing.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const paused = await mutate(`/api/v1/admin/users/${shopperId}/pause-actions`, "POST", {});
    assert.equal(paused.status, 200);
    assert.equal(db.get<{ paused: number }>(
      "SELECT actions_paused AS paused FROM app_settings WHERE user_id = ?",
      shopperId
    )?.paused, 1);

    const resumed = await mutate(`/api/v1/admin/users/${shopperId}/pause-actions`, "POST", { paused: false });
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json() as { actionSettings: { paused: boolean } }).actionSettings.paused, false);
    assert.equal(db.get<{ paused: number }>(
      "SELECT actions_paused AS paused FROM app_settings WHERE user_id = ?",
      shopperId
    )?.paused, 0);

    const disabled = await mutate(`/api/v1/admin/users/${shopperId}`, "PATCH", { status: "disabled" });
    assert.equal(disabled.status, 200);
    assert.equal((await disabled.json() as { user: { status: string } }).user.status, "disabled");
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
