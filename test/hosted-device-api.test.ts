import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  allowHostedExtensionOrigins,
  createHostedRequestScopeResolver
} from "../apps/api/src/hosted-request-auth.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { runWithRequestScope } from "../packages/database/src/request-scope.js";

const SECRET = "hosted-device-api-secret-with-at-least-thirty-two-bytes";
const ALLOWED_ORIGIN = `chrome-extension://${"b".repeat(32)}`;
const FOREIGN_ORIGIN = `chrome-extension://${"c".repeat(32)}`;

test("hosted Chrome pairing and recoverable rotation work without proxy identity headers", async () => {
  const db = new YoinkDatabase();
  const pairing = runWithRequestScope({
    tenantId: LOCAL_TENANT_ID,
    userId: LOCAL_USER_ID,
    actorKind: "user",
    actorId: LOCAL_USER_ID
  }, () => new DeviceRepository(db).createPairingCode());
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "hosted-device-test",
    requestScopeResolver: createHostedRequestScopeResolver(db, { proxySecret: SECRET }),
    hostValidator: () => true,
    extensionOriginValidator: allowHostedExtensionOrigins([ALLOWED_ORIGIN]),
    localExtensionReleaseEnabled: false
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const rejectedOrigin = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: FOREIGN_ORIGIN },
      body: JSON.stringify({ pairingCode: pairing.code })
    });
    assert.equal(rejectedOrigin.status, 403);
    assert.equal((await rejectedOrigin.json() as { error: string }).error, "extension_origin_rejected");

    const pairResponse = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ pairingCode: pairing.code, extensionVersion: "0.39.0" })
    });
    assert.equal(pairResponse.status, 201);
    const paired = (await pairResponse.json() as {
      device: { id: string; token: string; credential: { generation: number } };
    }).device;
    assert.equal(paired.credential.generation, 1);

    const beginResponse = await fetch(`${baseUrl}/api/v1/devices/self/credential-rotation/begin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN, Authorization: `Bearer ${paired.token}` },
      body: "{}"
    });
    assert.equal(beginResponse.status, 201);
    const pending = (await beginResponse.json() as {
      rotation: { token: string; generation: number };
    }).rotation;

    const pendingHeartbeat = await fetch(`${baseUrl}/api/v1/devices/self/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN, Authorization: `Bearer ${pending.token}` },
      body: "{}"
    });
    assert.equal(pendingHeartbeat.status, 401);

    const commitResponse = await fetch(`${baseUrl}/api/v1/devices/self/credential-rotation/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN, Authorization: `Bearer ${pending.token}` },
      body: JSON.stringify({ generation: pending.generation })
    });
    assert.equal(commitResponse.status, 200);

    const previousHeartbeat = await fetch(`${baseUrl}/api/v1/devices/self/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN, Authorization: `Bearer ${paired.token}` },
      body: "{}"
    });
    assert.equal(previousHeartbeat.status, 200);
    const currentHeartbeat = await fetch(`${baseUrl}/api/v1/devices/self/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN, Authorization: `Bearer ${pending.token}` },
      body: "{}"
    });
    assert.equal(currentHeartbeat.status, 200);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
