import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import {
  allowHostedHosts,
  allowHostedMutationOrigins,
  createHostedRequestScopeResolver,
  signHostedRequestScope
} from "../apps/api/src/hosted-request-auth.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";

const SECRET = "hosted-test-secret-with-more-than-thirty-two-bytes";
const SCOPE: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "service",
  actorId: "trusted_proxy"
};

function request(method: string, path: string, headers: Record<string, string>): IncomingMessage {
  return {
    method,
    url: path,
    headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLocaleLowerCase("en-US"), value]))
  } as IncomingMessage;
}

test("hosted scope signatures bind method, path, tenant, user, actor, timestamp, and a one-use nonce", () => {
  const db = new YoinkDatabase();
  try {
    const resolve = createHostedRequestScopeResolver(db, { proxySecret: SECRET });
    const issuedAt = Math.floor(Date.now() / 1_000);
    const headers = signHostedRequestScope(SECRET, {
      method: "GET",
      path: "/api/v1/audit?limit=10",
      scope: SCOPE,
      issuedAt,
      nonce: "scope_nonce_abcdefghijklmnop"
    });
    const signed = request("GET", "/api/v1/audit?limit=10", headers);
    assert.deepEqual(resolve(signed), SCOPE);
    assert.throws(() => resolve(signed), /nonce was already used/);

    const changedPathHeaders = signHostedRequestScope(SECRET, {
      method: "GET",
      path: "/api/v1/audit?limit=10",
      scope: SCOPE,
      issuedAt,
      nonce: "scope_nonce_qrstuvwxyzabcdef"
    });
    assert.throws(
      () => resolve(request("GET", "/api/v1/jobs", changedPathHeaders)),
      /signature is invalid/
    );
    assert.throws(() => createHostedRequestScopeResolver(db, { proxySecret: "short" }), /at least 32 bytes/);
  } finally {
    db.close();
  }
});

test("a paired device bearer token resolves its own tenant/user scope without proxy headers", () => {
  const db = new YoinkDatabase();
  try {
    const device = runWithRequestScope({ ...SCOPE, actorKind: "maintainer", actorId: "local_control" }, () => {
      const devices = new DeviceRepository(db);
      const pairing = devices.createPairingCode();
      return devices.pair({ pairingCode: pairing.code });
    });
    const resolve = createHostedRequestScopeResolver(db, { proxySecret: SECRET });
    const resolved = resolve(request("POST", "/api/v1/devices/self/heartbeat", {
      Authorization: `Bearer ${device.token}`
    }));
    assert.deepEqual(resolved, {
      tenantId: LOCAL_TENANT_ID,
      userId: LOCAL_USER_ID,
      actorKind: "device",
      actorId: device.id
    });
  } finally {
    db.close();
  }
});

test("hosted Host and browser mutation Origin policies are explicit and fail closed", () => {
  const hostPolicy = allowHostedHosts(["yoink.example.com"]);
  assert.equal(hostPolicy(request("GET", "/", { Host: "yoink.example.com" })), true);
  assert.equal(hostPolicy(request("GET", "/", { Host: "attacker.example" })), false);
  const originPolicy = allowHostedMutationOrigins(["https://yoink.example.com"]);
  assert.equal(runWithRequestScope(SCOPE, () => originPolicy(request("POST", "/api", {}))), true);
  assert.equal(runWithRequestScope({ ...SCOPE, actorKind: "user" }, () => originPolicy(request("POST", "/api", {}))), false);
  assert.equal(runWithRequestScope({ ...SCOPE, actorKind: "user" }, () => originPolicy(request("POST", "/api", {
    Origin: "https://yoink.example.com"
  }))), true);
  assert.equal(runWithRequestScope({ ...SCOPE, actorKind: "user" }, () => originPolicy(request("POST", "/api", {
    Origin: "https://attacker.example"
  }))), false);
});
