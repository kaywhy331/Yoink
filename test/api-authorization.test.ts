import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";
import { AuthorizationRepository } from "../packages/database/src/authorization-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";

const USER_SCOPE: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "user",
  actorId: LOCAL_USER_ID
};
const FORGED_MAINTAINER_SCOPE: RequestScope = {
  ...USER_SCOPE,
  actorKind: "maintainer",
  actorId: "signed_maintainer_claim"
};

test("canonical API surfaces enforce persisted permissions and correlate denials", async () => {
  const db = new YoinkDatabase();
  const authorization = new AuthorizationRepository(db);
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "authorization-test",
    requestScopeResolver(request) {
      const principal = String(request.headers["x-test-principal"] ?? "");
      if (principal === "user") return USER_SCOPE;
      if (principal === "forged-maintainer") return FORGED_MAINTAINER_SCOPE;
      if (principal === "local-bootstrap") return LOCAL_REQUEST_SCOPE;
      throw new Error("Authenticated request scope is required.");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const userDashboard = await fetch(`${baseUrl}/`, { headers: { "X-Test-Principal": "user" } });
    assert.equal(userDashboard.status, 200);
    assert.match(await userDashboard.text(), /My purchase assistant/);
    const deniedAdminUi = await fetch(`${baseUrl}/admin`, { headers: { "X-Test-Principal": "user" } });
    assert.equal(deniedAdminUi.status, 403);
    const deniedIdentityRead = await fetch(`${baseUrl}/api/v1/admin/catalog/identity-operations`, {
      headers: { "X-Test-Principal": "user" }
    });
    assert.equal(deniedIdentityRead.status, 403);
    const deniedIdentityProposal = await fetch(`${baseUrl}/api/v1/admin/catalog/identity-operations`, {
      method: "POST",
      headers: {
        "X-Test-Principal": "user",
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: "{}"
    });
    assert.equal(deniedIdentityProposal.status, 403);
    const deniedAlerts = await fetch(`${baseUrl}/api/v1/admin/alerts`, {
      headers: { "X-Test-Principal": "user" }
    });
    assert.equal(deniedAlerts.status, 403);

    const userLibrary = await fetch(`${baseUrl}/api/v1/user/library`, {
      headers: { "X-Test-Principal": "user" }
    });
    assert.equal(userLibrary.status, 200);
    assert.equal(userLibrary.headers.get("x-yoink-api-surface"), "user");
    assert.equal(userLibrary.headers.has("deprecation"), false);

    const legacyLibrary = await fetch(`${baseUrl}/api/v1/library`, {
      headers: { "X-Test-Principal": "user" }
    });
    assert.equal(legacyLibrary.status, 200);
    assert.equal(legacyLibrary.headers.get("deprecation"), "true");

    for (const principal of ["user", "forged-maintainer"]) {
      const denied = await fetch(`${baseUrl}/api/v1/admin/snapshot`, {
        headers: { "X-Test-Principal": principal, "X-Request-ID": "request_explicit_001" }
      });
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.get("x-request-id"), "request_explicit_001");
      const problem = await denied.json() as { error: string; correlationId: string };
      assert.equal(problem.error, "permission_denied");
      assert.equal(problem.correlationId, "request_explicit_001");
    }

    const wrongSurface = await fetch(`${baseUrl}/api/v1/user/qualifications/target-add/activate`, {
      method: "POST",
      headers: {
        "X-Test-Principal": "user",
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: "{}"
    });
    assert.equal(wrongSurface.status, 404);
    assert.equal((await wrongSurface.json() as { error: string }).error, "api_surface_mismatch");

    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => authorization.grantRole(LOCAL_USER_ID, "support_readonly"));
    const allowedAdmin = await fetch(`${baseUrl}/api/v1/admin/snapshot`, {
      headers: { "X-Test-Principal": "user" }
    });
    assert.equal(allowedAdmin.status, 200);
    assert.equal(allowedAdmin.headers.get("x-yoink-api-surface"), "admin");
    const allowedAdminUi = await fetch(`${baseUrl}/admin`, { headers: { "X-Test-Principal": "user" } });
    assert.equal(allowedAdminUi.status, 200);
    assert.match(await allowedAdminUi.text(), /Admin control center/);
    const allowedIdentityRead = await fetch(`${baseUrl}/api/v1/admin/catalog/identity-operations`, {
      headers: { "X-Test-Principal": "user" }
    });
    assert.equal(allowedIdentityRead.status, 200);
    assert.equal(allowedIdentityRead.headers.get("x-yoink-api-surface"), "admin");
    assert.deepEqual(await allowedIdentityRead.json(), { items: [] });
    const allowedAlertRead = await fetch(`${baseUrl}/api/v1/admin/alerts`, {
      headers: { "X-Test-Principal": "user" }
    });
    assert.equal(allowedAlertRead.status, 200);
    const deniedAlertMutation = await fetch(`${baseUrl}/api/v1/admin/alerts/rules`, {
      method: "POST",
      headers: {
        "X-Test-Principal": "user",
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: "{}"
    });
    assert.equal(deniedAlertMutation.status, 403);
    const readonlyIdentityProposal = await fetch(`${baseUrl}/api/v1/admin/catalog/identity-operations`, {
      method: "POST",
      headers: {
        "X-Test-Principal": "user",
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: "{}"
    });
    assert.equal(readonlyIdentityProposal.status, 403);

    const selfAuthorization = await fetch(`${baseUrl}/api/v1/user/authorization`, {
      headers: { "X-Test-Principal": "user" }
    }).then((response) => response.json()) as { permissions: string[] };
    assert.equal(selfAuthorization.permissions.includes("admin.read"), true);
    assert.equal(selfAuthorization.permissions.includes("security.manage"), false);
    assert.equal(selfAuthorization.permissions.includes("catalog.identity.propose"), false);
    assert.equal(selfAuthorization.permissions.includes("catalog.identity.approve"), false);

    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => authorization.grantRole(LOCAL_USER_ID, "catalog_curator"));
    const curatorAuthorization = await fetch(`${baseUrl}/api/v1/user/authorization`, {
      headers: { "X-Test-Principal": "user" }
    }).then((response) => response.json()) as { permissions: string[] };
    assert.equal(curatorAuthorization.permissions.includes("catalog.identity.propose"), true);
    assert.equal(curatorAuthorization.permissions.includes("catalog.identity.approve"), true);
    const curatorProposal = await fetch(`${baseUrl}/api/v1/admin/catalog/identity-operations`, {
      method: "POST",
      headers: {
        "X-Test-Principal": "user",
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: "{}"
    });
    assert.equal(curatorProposal.status, 400);
    assert.equal((await curatorProposal.json() as { error: string }).error, "catalog_identity_confirmation_required");

    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => authorization.grantRole(LOCAL_USER_ID, "security_admin"));
    const permittedAlertMutation = await fetch(`${baseUrl}/api/v1/admin/alerts/rules`, {
      method: "POST",
      headers: {
        "X-Test-Principal": "user",
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: "{}"
    });
    assert.equal(permittedAlertMutation.status, 400);
    assert.equal((await permittedAlertMutation.json() as { error: string }).error, "operator_alert_confirmation_required");
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
