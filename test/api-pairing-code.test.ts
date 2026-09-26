import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { resolveApiRoutePolicy } from "../apps/api/src/api-route-policy.js";
import { LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";

test("API-13: issuing a pairing code for another user needs account management, not support", () => {
  assert.equal(resolveApiRoutePolicy("POST", "/api/v1/admin/users/user_shopper/pairing-code")?.permission, "admin.users.manage");
  assert.equal(resolveApiRoutePolicy("POST", "/api/v1/admin/users/user_shopper/pause-actions")?.permission, "admin.users.support");
});

test("API-14: the local app refuses a pairing code it could never redeem for a non-local user", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "pairing-code-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: Record<string, unknown>) => fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify(body)
  });
  try {
    const created = await post("/api/v1/admin/users", { displayName: "Local Shopper", initialRoleId: "yoink_user" });
    assert.equal(created.status, 201);
    const shopperId = (await created.json() as { user: { id: string } }).user.id;
    const refused = await post(`/api/v1/admin/users/${shopperId}/pairing-code`, {});
    assert.equal(refused.status, 409);
    assert.equal((await refused.json() as { error: string }).error, "hosted_only");
    const own = await post(`/api/v1/admin/users/${LOCAL_USER_ID}/pairing-code`, {});
    assert.equal(own.status, 201);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
