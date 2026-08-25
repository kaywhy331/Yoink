import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  LOCAL_TENANT_ID,
  LOCAL_USER_ID,
  YoinkDatabase
} from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE, type RequestScope } from "../packages/database/src/request-scope.js";
import { USER_DATA_EXPORT_FORMAT } from "../packages/database/src/user-privacy-repository.js";

const DENIED_SCOPE: RequestScope = {
  tenantId: "tenant_privacy_denied",
  userId: "user_privacy_denied",
  actorKind: "user",
  actorId: "user_privacy_denied"
};

test("privacy inventory and hashed download are user-classified and permission protected", async () => {
  const db = new YoinkDatabase();
  db.run("INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)", DENIED_SCOPE.tenantId, "Denied tenant", new Date().toISOString());
  db.run(
    "INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)",
    DENIED_SCOPE.userId,
    DENIED_SCOPE.tenantId,
    "Denied user",
    new Date().toISOString()
  );
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "privacy-api-test",
    requestScopeResolver(request) {
      return request.headers["x-test-principal"] === "denied" ? DENIED_SCOPE : LOCAL_REQUEST_SCOPE;
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const inventoryResponse = await fetch(`${baseUrl}/api/v1/user/privacy`);
    assert.equal(inventoryResponse.status, 200);
    assert.equal(inventoryResponse.headers.get("x-yoink-api-surface"), "user");
    assert.equal(inventoryResponse.headers.get("cache-control"), "no-store");
    const inventoryPayload = await inventoryResponse.json() as {
      inventory: { format: string; categories: unknown[]; credentialMaterialsExcluded: boolean };
    };
    assert.equal(inventoryPayload.inventory.format, USER_DATA_EXPORT_FORMAT);
    assert.equal(inventoryPayload.inventory.categories.length, 8);
    assert.equal(inventoryPayload.inventory.credentialMaterialsExcluded, true);

    const exportResponse = await fetch(`${baseUrl}/api/v1/user/privacy/export`);
    assert.equal(exportResponse.status, 200);
    assert.equal(exportResponse.headers.get("x-yoink-api-surface"), "user");
    assert.equal(exportResponse.headers.get("x-yoink-export-format"), USER_DATA_EXPORT_FORMAT);
    assert.equal(exportResponse.headers.get("content-type"), "application/json; charset=utf-8");
    assert.match(exportResponse.headers.get("content-disposition") ?? "", /^attachment; filename="Yoink-My-Data-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = await exportResponse.text();
    assert.equal(exportResponse.headers.get("x-content-sha256"), createHash("sha256").update(body, "utf8").digest("hex"));
    assert.equal(exportResponse.headers.get("content-length"), String(Buffer.byteLength(body, "utf8")));
    const archive = JSON.parse(body) as {
      format: string;
      scope: { tenantId: string; userId: string };
      inventory: { credentialMaterialsExcluded: boolean; accountDeletion: { available: boolean } };
    };
    assert.equal(archive.format, USER_DATA_EXPORT_FORMAT);
    assert.deepEqual(archive.scope, { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID });
    assert.equal(archive.inventory.credentialMaterialsExcluded, true);
    assert.equal(archive.inventory.accountDeletion.available, false);

    for (const path of ["/api/v1/user/privacy", "/api/v1/user/privacy/export"]) {
      const denied = await fetch(`${baseUrl}${path}`, { headers: { "X-Test-Principal": "denied" } });
      assert.equal(denied.status, 403);
      assert.equal((await denied.json() as { error: string }).error, "permission_denied");
    }
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
