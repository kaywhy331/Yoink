import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer, type AppDependencies } from "../apps/api/src/app.js";
import {
  allowHostedMutationOrigins,
  createHostedRequestScopeResolver,
  signHostedRequestScope
} from "../apps/api/src/hosted-request-auth.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";

async function withServer(
  dependencies: (db: YoinkDatabase) => Partial<AppDependencies>,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "mutation-gate-test",
    ...dependencies(db)
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
    db.close();
  }
}

test("I1: a cross-port page cannot reach local mutations, and body-less mutations need X-Yoink-Request", async () => {
  await withServer(() => ({}), async (baseUrl) => {
    // A form on another local dev server: no preflight, other port.
    const crossPort = await fetch(`${baseUrl}/api/v1/admin/storage/prune`, {
      method: "POST",
      headers: { Origin: "http://localhost:9999", "X-Yoink-Request": "1" }
    });
    assert.equal(crossPort.status, 403);
    assert.equal((await crossPort.json() as { error: string }).error, "origin_rejected");

    // Same host, other port on 127.0.0.1: still a different origin.
    const otherPort = await fetch(`${baseUrl}/api/v1/settings/actions`, {
      method: "PATCH",
      headers: { Origin: "http://127.0.0.1:5173", "Content-Type": "application/json" },
      body: JSON.stringify({ paused: true })
    });
    assert.equal(otherPort.status, 403);

    // A plain HTML form POST (no JSON, no custom header) is refused even same-origin.
    const formPost = await fetch(`${baseUrl}/api/v1/admin/storage/prune`, {
      method: "POST",
      headers: { Origin: baseUrl, "Content-Type": "application/x-www-form-urlencoded" },
      body: "x=1"
    });
    assert.equal(formPost.status, 403);
    assert.equal((await formPost.json() as { error: string }).error, "mutation_header_required");

    const bareCurl = await fetch(`${baseUrl}/api/v1/admin/storage/prune`, { method: "POST" });
    assert.equal(bareCurl.status, 403);
    assert.equal((await bareCurl.json() as { error: string }).error, "mutation_header_required");

    // The web UI's own requests: exact origin plus the header or a JSON body.
    const ownPage = await fetch(`${baseUrl}/api/v1/settings/actions`, {
      method: "PATCH",
      headers: { Origin: baseUrl, "Content-Type": "application/json", "X-Yoink-Request": "1" },
      body: JSON.stringify({ paused: true })
    });
    assert.equal(ownPage.status, 200);
    const scripted = await fetch(`${baseUrl}/api/v1/settings/actions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: true })
    });
    assert.equal(scripted.status, 200);

    // Safe reads are unaffected.
    assert.equal((await fetch(`${baseUrl}/api/v1/health`)).status < 500, true);
  });
});

test("API-03: the hosted origin gate sees the resolved scope, so originless signed service mutations pass and user mutations do not", async () => {
  const secret = "mutation-gate-hosted-secret-with-at-least-thirty-two-bytes";
  const serviceActor = "hosted_principal_service";
  await withServer((db) => ({
    hostValidator: () => true,
    mutationOriginValidator: allowHostedMutationOrigins(["https://app.yoink.example"]),
    requestScopeResolver: createHostedRequestScopeResolver(db, {
      proxySecret: secret,
      serviceCapabilities: { [serviceActor]: "internal.principal" }
    })
  }), async (baseUrl) => {
    const signed = (actorKind: "service" | "user", actorId: string) => signHostedRequestScope(secret, {
      method: "POST",
      path: "/api/v1/internal/hosted/principals",
      scope: { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID, actorKind, actorId },
      issuedAt: Math.floor(Date.now() / 1_000),
      nonce: randomBytes(24).toString("base64url")
    });
    const service = await fetch(`${baseUrl}/api/v1/internal/hosted/principals`, {
      method: "POST",
      headers: { ...signed("service", serviceActor), "Content-Type": "application/json" },
      body: "{}"
    });
    const serviceError = (await service.json() as { error?: string }).error;
    assert.notEqual(service.status, 403, `service POST was rejected: ${serviceError}`);
    assert.notEqual(serviceError, "origin_rejected");

    const user = await fetch(`${baseUrl}/api/v1/internal/hosted/principals`, {
      method: "POST",
      headers: { ...signed("user", LOCAL_USER_ID), "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(user.status, 403);
    assert.equal((await user.json() as { error: string }).error, "origin_rejected");

    // A hosted request with no valid scope is a typed 401, not a masked 500 (API-11).
    const anonymous = await fetch(`${baseUrl}/api/v1/user/overview`);
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json() as { error: string }).error, "authentication_required");
  });
});
