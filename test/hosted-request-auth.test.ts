import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import {
  allowHostedExtensionOrigins,
  allowHostedHosts,
  allowHostedMutationOrigins,
  createHostedRequestScopeResolver,
  signHostedRequestScope
} from "../apps/api/src/hosted-request-auth.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import {
  isExactLocalRequestScope,
  LOCAL_REQUEST_SCOPE,
  runWithRequestScope,
  type RequestScope
} from "../packages/database/src/request-scope.js";

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

    const imitatedLocalHeaders = signHostedRequestScope(SECRET, {
      method: "GET",
      path: "/api/v1/admin/snapshot",
      scope: LOCAL_REQUEST_SCOPE,
      issuedAt,
      nonce: "scope_nonce_local_boundary_test"
    });
    const imitatedLocal = resolve(request("GET", "/api/v1/admin/snapshot", imitatedLocalHeaders));
    assert.equal(isExactLocalRequestScope(imitatedLocal), false);
    assert.equal(imitatedLocal.requestBoundary, undefined);

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

test("disabled users cannot establish a fresh signed hosted session", () => {
  const db = new YoinkDatabase();
  try {
    db.run("UPDATE users SET status = 'disabled' WHERE id = ?", LOCAL_USER_ID);
    const resolve = createHostedRequestScopeResolver(db, { proxySecret: SECRET });
    const issuedAt = Math.floor(Date.now() / 1_000);
    const userScope: RequestScope = {
      tenantId: LOCAL_TENANT_ID,
      userId: LOCAL_USER_ID,
      actorKind: "user",
      actorId: LOCAL_USER_ID
    };
    const headers = signHostedRequestScope(SECRET, {
      method: "GET",
      path: "/api/v1/user/overview",
      scope: userScope,
      issuedAt,
      nonce: "disabled_user_nonce_abcdefghijk"
    });
    assert.throws(
      () => resolve(request("GET", "/api/v1/user/overview", headers)),
      /principal is unavailable/
    );
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM hosted_request_nonces WHERE user_id = ?",
      LOCAL_USER_ID
    )?.count, 0);
  } finally {
    db.close();
  }
});

test("hosted service capabilities are singular, server-derived, and deny unconfigured actors", () => {
  const db = new YoinkDatabase();
  try {
    const resolve = createHostedRequestScopeResolver(db, {
      proxySecret: SECRET,
      serviceCapabilities: { trusted_proxy: "internal.delivery" }
    });
    const issuedAt = Math.floor(Date.now() / 1_000);
    const scopedHeaders = signHostedRequestScope(SECRET, {
      method: "POST",
      path: "/api/v1/internal/delivery/inbox",
      scope: SCOPE,
      issuedAt,
      nonce: "service_scope_nonce_abcdefghijkl"
    });
    assert.deepEqual(resolve(request("POST", "/api/v1/internal/delivery/inbox", scopedHeaders)), {
      ...SCOPE,
      internalServiceCapability: "internal.delivery"
    });

    const unconfiguredScope: RequestScope = { ...SCOPE, actorId: "constructor" };
    const unconfiguredHeaders = signHostedRequestScope(SECRET, {
      method: "POST",
      path: "/api/v1/internal/delivery/inbox",
      scope: unconfiguredScope,
      issuedAt,
      nonce: "unconfigured_nonce_abcdefghijkl"
    });
    assert.deepEqual(
      resolve(request("POST", "/api/v1/internal/delivery/inbox", unconfiguredHeaders)),
      unconfiguredScope
    );

    const forgedHeaders = signHostedRequestScope(SECRET, {
      method: "POST",
      path: "/api/v1/internal/delivery/inbox",
      scope: unconfiguredScope,
      issuedAt,
      nonce: "forged_capability_nonce_abcdef"
    });
    assert.throws(() => resolve(request("POST", "/api/v1/internal/delivery/inbox", {
      ...forgedHeaders,
      "X-Yoink-Service-Capability": "internal.principal"
    })), /capability headers are not accepted/);
    assert.throws(() => signHostedRequestScope(SECRET, {
      method: "POST",
      path: "/api/v1/internal/delivery/inbox",
      scope: { ...SCOPE, internalServiceCapability: "internal.principal" },
      issuedAt,
      nonce: "signer_capability_nonce_abcdef"
    }), /server-derived/);
    assert.throws(() => createHostedRequestScopeResolver(db, {
      proxySecret: SECRET,
      serviceCapabilities: { invalid: "internal.invalid" }
    } as never), /assignments are invalid/);
  } finally {
    db.close();
  }
});

test("fresh step-up assurance is proxy-signed, time-bounded, and cannot be forged", () => {
  const db = new YoinkDatabase();
  try {
    const resolve = createHostedRequestScopeResolver(db, {
      proxySecret: SECRET,
      maximumStepUpAgeSeconds: 120
    });
    const issuedAt = Math.floor(Date.now() / 1_000);
    const stepUpScope: RequestScope = {
      ...SCOPE,
      actorKind: "user",
      actorId: LOCAL_USER_ID,
      authenticationAssurance: "step_up",
      authenticationTime: issuedAt - 10,
      sessionId: "session_step_up_abcdefghijkl"
    };
    const headers = signHostedRequestScope(SECRET, {
      method: "POST",
      path: "/api/v1/admin/change-requests/request_123/decision",
      scope: stepUpScope,
      issuedAt,
      nonce: "step_up_nonce_abcdefghijkl"
    });
    assert.deepEqual(resolve(request(
      "POST",
      "/api/v1/admin/change-requests/request_123/decision",
      headers
    )), stepUpScope);

    const forgedHeaders = signHostedRequestScope(SECRET, {
      method: "GET",
      path: "/api/v1/admin/snapshot",
      scope: SCOPE,
      issuedAt,
      nonce: "baseline_nonce_abcdefghijkl"
    });
    forgedHeaders["X-Yoink-Authentication-Assurance"] = "step_up";
    forgedHeaders["X-Yoink-Authentication-Time"] = String(issuedAt);
    forgedHeaders["X-Yoink-Session-Id"] = "session_forged_abcdefghijkl";
    assert.throws(
      () => resolve(request("GET", "/api/v1/admin/snapshot", forgedHeaders)),
      /signature is invalid/
    );

    const staleScope: RequestScope = {
      ...stepUpScope,
      authenticationTime: issuedAt - 121,
      sessionId: "session_stale_abcdefghijkl"
    };
    const staleHeaders = signHostedRequestScope(SECRET, {
      method: "GET",
      path: "/api/v1/admin/snapshot",
      scope: staleScope,
      issuedAt,
      nonce: "stale_step_nonce_abcdefghijkl"
    });
    assert.throws(
      () => resolve(request("GET", "/api/v1/admin/snapshot", staleHeaders)),
      /step-up context is expired/
    );
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

    const issuedAt = Math.floor(Date.now() / 1_000);
    const signedProxyHeaders = signHostedRequestScope(SECRET, {
      method: "GET",
      path: "/api/v1/admin/snapshot",
      scope: SCOPE,
      issuedAt,
      nonce: "invalid_bearer_fallback_nonce"
    });
    assert.throws(
      () => resolve(request("GET", "/api/v1/admin/snapshot", {
        ...signedProxyHeaders,
        Authorization: `Bearer ${"z".repeat(48)}`
      })),
      /authenticated request scope is invalid/
    );
  } finally {
    db.close();
  }
});

test("hosted pairing derives one exact tenant scope from the unconsumed one-time code body", () => {
  const db = new YoinkDatabase();
  try {
    const pairing = runWithRequestScope({ ...SCOPE, actorKind: "user", actorId: LOCAL_USER_ID }, () => {
      return new DeviceRepository(db).createPairingCode();
    });
    const resolve = createHostedRequestScopeResolver(db, { proxySecret: SECRET });
    const resolved = resolve(
      request("POST", "/api/v1/devices/pair", {}),
      { body: { pairingCode: pairing.code } }
    );
    assert.equal(resolved.tenantId, LOCAL_TENANT_ID);
    assert.equal(resolved.userId, LOCAL_USER_ID);
    assert.equal(resolved.actorKind, "device");
    assert.match(resolved.actorId, /^pairing_code_[a-f0-9]{32}$/);
    assert.throws(
      () => resolve(request("POST", "/api/v1/devices/pair", {}), { body: { pairingCode: "WRONG-CODE" } }),
      /valid one-time pairing code/
    );
    assert.throws(
      () => resolve(request("POST", "/api/v1/devices/self/heartbeat", {}), { body: { pairingCode: pairing.code } }),
      /authenticated tenant\/user request scope/
    );
  } finally {
    db.close();
  }
});

test("hosted device scope recognizes previous grace and pending commit without widening pending authority", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const state = runWithRequestScope({ ...SCOPE, actorKind: "user", actorId: LOCAL_USER_ID }, () => {
      const pairing = devices.createPairingCode();
      const paired = devices.pair({ pairingCode: pairing.code });
      const current = devices.authenticate(paired.token)!;
      const pending = devices.beginCredentialRotation(current);
      return { paired, pending };
    });
    const resolve = createHostedRequestScopeResolver(db, { proxySecret: SECRET });
    assert.throws(
      () => resolve(request("POST", "/api/v1/devices/self/heartbeat", {
        Authorization: `Bearer ${state.pending.token}`
      })),
      /authenticated request scope/
    );
    const pendingCommit = resolve(request("POST", "/api/v1/devices/self/credential-rotation/commit", {
      Authorization: `Bearer ${state.pending.token}`
    }));
    assert.equal(pendingCommit.actorId, state.paired.id);

    runWithRequestScope(pendingCommit, () => {
      assert.ok(devices.commitCredentialRotation(state.pending.token, state.pending.generation));
    });
    assert.equal(resolve(request("POST", "/api/v1/devices/self/heartbeat", {
      Authorization: `Bearer ${state.paired.token}`
    })).actorId, state.paired.id);
    assert.equal(resolve(request("POST", "/api/v1/devices/self/heartbeat", {
      Authorization: `Bearer ${state.pending.token}`
    })).actorId, state.paired.id);
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

  const extensionOrigin = `chrome-extension://${"b".repeat(32)}`;
  const extensionPolicy = allowHostedExtensionOrigins([extensionOrigin]);
  assert.equal(extensionPolicy(request("POST", "/api/v1/devices/pair", { Origin: extensionOrigin })), true);
  assert.equal(extensionPolicy(request("POST", "/api/v1/devices/pair", {
    Origin: `chrome-extension://${"c".repeat(32)}`
  })), false);
  assert.equal(extensionPolicy(request("POST", "/api/v1/devices/pair", { Origin: "https://yoink.example.com" })), false);
  assert.throws(
    () => allowHostedExtensionOrigins(["chrome-extension://invalid"]),
    /exact chrome-extension origins/
  );
});
