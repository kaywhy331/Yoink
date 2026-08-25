import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { AuditRepository } from "../packages/database/src/audit-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import {
  OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_CONTRACT_VERSION,
  OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_SOURCE
} from "../packages/contracts/src/index.js";
import { runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";

const NOW = new Date("2026-08-24T09:00:00.000Z").getTime();

const LOCAL_USER_SCOPE: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "user",
  actorId: LOCAL_USER_ID
};
const SECOND_USER_SCOPE: RequestScope = {
  tenantId: "tenant_second",
  userId: "user_second",
  actorKind: "user",
  actorId: "user_second"
};
const LOCAL_SERVICE_SCOPE: RequestScope = {
  ...LOCAL_USER_SCOPE,
  actorKind: "service",
  actorId: "hosted_delivery_local"
};
const SECOND_SERVICE_SCOPE: RequestScope = {
  ...SECOND_USER_SCOPE,
  actorKind: "service",
  actorId: "hosted_delivery_second"
};

test("the API applies an authenticated request scope resolver before repository access", async () => {
  const db = new YoinkDatabase();
  const timestamp = new Date(NOW).toISOString();
  db.run("INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)", SECOND_USER_SCOPE.tenantId, "Second", timestamp);
  db.run(
    "INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)",
    SECOND_USER_SCOPE.userId,
    SECOND_USER_SCOPE.tenantId,
    "Second user",
    timestamp
  );
  db.run(
    `INSERT INTO extension_devices(
       id, tenant_id, user_id, name, token_hash, extension_version,
       status, capabilities_json, last_seen_at, created_at, updated_at
     ) VALUES (?, ?, ?, 'Second Chrome', ?, '0.54.0', 'active', '{}', ?, ?, ?)`,
    "device_second_eligibility",
    SECOND_USER_SCOPE.tenantId,
    SECOND_USER_SCOPE.userId,
    "e".repeat(64),
    timestamp,
    timestamp,
    timestamp
  );
  db.run(
    `INSERT INTO authorization_memberships(
       tenant_id, user_id, role_id, status, granted_by_actor_id, created_at, updated_at
     ) VALUES (?, ?, 'yoink_user', 'active', 'test_fixture', ?, ?)`,
    SECOND_USER_SCOPE.tenantId,
    SECOND_USER_SCOPE.userId,
    timestamp,
    timestamp
  );
  const audit = new AuditRepository(db);
  runWithRequestScope(LOCAL_USER_SCOPE, () => audit.record({
    correlationId: "local_only",
    eventType: "scope_test",
    reasonCode: "local",
    message: "local"
  }, NOW));
  runWithRequestScope(SECOND_USER_SCOPE, () => audit.record({
    correlationId: "second_only",
    eventType: "scope_test",
    reasonCode: "second",
    message: "second"
  }, NOW + 1));

  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "hosted-test",
    requestScopeResolver(request) {
      const principal = String(request.headers["x-test-principal"] ?? "");
      if (principal === "local-user") return LOCAL_USER_SCOPE;
      if (principal === "second-user") return SECOND_USER_SCOPE;
      if (principal === "local-service") return LOCAL_SERVICE_SCOPE;
      if (principal === "second-service") return SECOND_SERVICE_SCOPE;
      throw new Error("Authenticated request scope is required.");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const unauthenticated = await fetch(`${baseUrl}/api/v1/audit`);
    assert.equal(unauthenticated.status, 401);
    const authenticationProblem = await unauthenticated.json() as { error: string; message: string; correlationId: string };
    assert.equal(authenticationProblem.error, "authentication_required");
    assert.match(authenticationProblem.message, /Authenticated request scope/);
    assert.equal(authenticationProblem.correlationId, unauthenticated.headers.get("x-request-id"));

    const local = await fetch(`${baseUrl}/api/v1/user/audit`, { headers: { "X-Test-Principal": "local-user" } })
      .then((response) => response.json()) as { items: Array<{ correlationId: string }> };
    const second = await fetch(`${baseUrl}/api/v1/user/audit`, { headers: { "X-Test-Principal": "second-user" } })
      .then((response) => response.json()) as { items: Array<{ correlationId: string }> };
    assert.deepEqual(local.items.map((item) => item.correlationId), ["local_only"]);
    assert.deepEqual(second.items.map((item) => item.correlationId), ["second_only"]);

    const deniedUserDelivery = await fetch(`${baseUrl}/api/v1/internal/delivery/inbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Principal": "second-user" },
      body: "{}"
    });
    assert.equal(deniedUserDelivery.status, 403);
    assert.equal((await deniedUserDelivery.json() as { error: string }).error, "permission_denied");

    const eligibilityNow = Date.now();
    const eligibilityBody = {
      contractVersion: OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_CONTRACT_VERSION,
      deviceId: "device_second_eligibility",
      contributorRefHash: "a".repeat(64),
      regionScope: "subdivision:US-WA",
      accountEligible: true,
      deviceEligible: true,
      regionEligible: true,
      proofHash: "b".repeat(64),
      source: OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_SOURCE,
      attestedAt: new Date(eligibilityNow).toISOString(),
      expiresAt: new Date(eligibilityNow + 60 * 60_000).toISOString()
    };
    const deniedUserEligibility = await fetch(
      `${baseUrl}/api/v1/internal/observer-recipes/contributor-eligibility`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Test-Principal": "second-user" },
        body: JSON.stringify(eligibilityBody)
      }
    );
    assert.equal(deniedUserEligibility.status, 403);
    assert.equal((await deniedUserEligibility.json() as { error: string }).error, "permission_denied");
    const wrongPrincipalEligibility = await fetch(
      `${baseUrl}/api/v1/internal/observer-recipes/contributor-eligibility`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Test-Principal": "local-service" },
        body: JSON.stringify(eligibilityBody)
      }
    );
    assert.equal(wrongPrincipalEligibility.status, 400);
    const acceptedEligibility = await fetch(
      `${baseUrl}/api/v1/internal/observer-recipes/contributor-eligibility`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Test-Principal": "second-service" },
        body: JSON.stringify(eligibilityBody)
      }
    );
    assert.equal(acceptedEligibility.status, 200);
    assert.equal(acceptedEligibility.headers.get("x-yoink-api-surface"), "internal");
    const eligibilityResponse = await acceptedEligibility.json() as {
      eligibility: Record<string, unknown>;
    };
    assert.equal(eligibilityResponse.eligibility.state, "externally_attested");
    assert.equal(eligibilityResponse.eligibility.regionScope, "subdivision:US-WA");
    assert.doesNotMatch(JSON.stringify(eligibilityResponse), new RegExp(`a{64}|b{64}`));
    assert.equal(db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM observer_recipe_contributor_eligibility_states
       WHERE tenant_id = ? AND user_id = ? AND device_id = ?`,
      SECOND_USER_SCOPE.tenantId,
      SECOND_USER_SCOPE.userId,
      "device_second_eligibility"
    )?.count, 1);
    const ownerEligibility = await fetch(`${baseUrl}/api/v1/user/community/recovery-evidence`, {
      headers: { "X-Test-Principal": "second-user" }
    }).then((response) => response.json()) as { contributorEligibility: Record<string, unknown> };
    assert.equal(ownerEligibility.contributorEligibility.externallyAttestedDeviceCount, 1);
    assert.match(JSON.stringify(ownerEligibility.contributorEligibility), /subdivision:US-WA/);

    const accepted = await fetch(`${baseUrl}/api/v1/internal/delivery/inbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Principal": "second-service" },
      body: JSON.stringify({
        source: "hosted_source",
        messageKey: "remote:001",
        eventType: "stock_update",
        payload: { retailerSku: "B002OB49L4", availability: "in_stock" }
      })
    });
    assert.equal(accepted.status, 201);
    assert.equal((await accepted.json() as { receipt: { disposition: string } }).receipt.disposition, "accepted");

    const wrongTenantLease = await fetch(`${baseUrl}/api/v1/internal/delivery/inbox/lease`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Principal": "local-service" },
      body: "{}"
    }).then((response) => response.json()) as { lease: unknown };
    assert.equal(wrongTenantLease.lease, null);
    const rightTenantLease = await fetch(`${baseUrl}/api/v1/internal/delivery/inbox/lease`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Principal": "second-service" },
      body: "{}"
    }).then((response) => response.json()) as { lease: { messageKey: string; capabilityToken: string } };
    assert.equal(rightTenantLease.lease.messageKey, "remote:001");
    assert.match(rightTenantLease.lease.capabilityToken, /^[A-Za-z0-9_-]{43}$/);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
