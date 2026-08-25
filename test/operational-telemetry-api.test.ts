import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("the admin telemetry read model receives classified request failures without retaining request detail", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "operational-telemetry-test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { "X-Request-ID": "request_health_raw_001" }
    });
    assert.equal(health.status, 200);

    const missingIntent = await fetch(
      `${baseUrl}/api/v1/user/purchase-intents/mission_missing_private?offerToken=must_not_persist`,
      { headers: { "X-Request-ID": "request_missing_intent_raw_001" } }
    );
    assert.equal(missingIntent.status, 404);
    assert.equal((await missingIntent.json() as { error: string }).error, "purchase_intent_not_found");

    const invalidWindow = await fetch(`${baseUrl}/api/v1/admin/operations/telemetry?window=forever`, {
      headers: { "X-Request-ID": "request_invalid_window_raw_001" }
    });
    assert.equal(invalidWindow.status, 400);
    assert.equal((await invalidWindow.json() as { error: string }).error, "telemetry_window_invalid");

    const deviceHeartbeat = await fetch(`${baseUrl}/api/v1/devices/self/heartbeat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer bearer_token_must_not_persist_000000000000000000000000000000000000",
        Origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "X-Request-ID": "request_device_unauthorized_raw_001"
      }
    });
    assert.equal(deviceHeartbeat.status, 401);
    assert.equal((await deviceHeartbeat.json() as { error: string }).error, "device_unauthorized");

    const telemetryResponse = await fetch(`${baseUrl}/api/v1/admin/operations/telemetry?window=1h`);
    assert.equal(telemetryResponse.status, 200);
    assert.equal(telemetryResponse.headers.get("x-yoink-api-surface"), "admin");
    const telemetry = (await telemetryResponse.json() as {
      telemetry: {
        containsRequestBodies: boolean;
        containsRawUrls: boolean;
        containsProductIdentifiers: boolean;
        totals: { requests: number; clientErrors: number };
        routes: Array<{ routeKey: string; requests: number; errors: number }>;
        errorCodes: Array<{ errorCode: string; occurrences: number }>;
        recentErrors: Array<{
          correlationKey: string;
          routeKey: string;
          errorCode: string;
          actorKind: string;
        }>;
      };
    }).telemetry;
    assert.equal(telemetry.containsRequestBodies, false);
    assert.equal(telemetry.containsRawUrls, false);
    assert.equal(telemetry.containsProductIdentifiers, false);
    assert.equal(telemetry.totals.requests, 4);
    assert.equal(telemetry.totals.clientErrors, 3);
    assert.deepEqual(
      new Set(telemetry.routes.map((item) => item.routeKey)),
      new Set(["public.health", "user.purchase_intents", "admin.operations", "device.heartbeat"])
    );
    assert.deepEqual(
      new Set(telemetry.errorCodes.map((item) => item.errorCode)),
      new Set(["purchase_intent_not_found", "telemetry_window_invalid", "http_401"])
    );
    assert.equal(telemetry.recentErrors.every((item) => /^opcorr_[a-f0-9]{48}$/.test(item.correlationKey)), true);
    const deviceHeartbeatError = telemetry.recentErrors.find((item) => item.routeKey === "device.heartbeat");
    assert.ok(deviceHeartbeatError);
    assert.equal(deviceHeartbeatError.errorCode, "http_401");
    assert.equal(deviceHeartbeatError.actorKind, "device");

    const snapshot = await fetch(`${baseUrl}/api/v1/admin/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
      capabilities: Record<string, boolean>;
    };
    assert.ok(Number(snapshot.counts.operationalRollupRows ?? 0) >= 5);
    assert.equal(snapshot.counts.operationalErrorEvents, 3);
    assert.equal(snapshot.capabilities.privacyBoundedOperationalTelemetry, true);
    assert.equal(snapshot.capabilities.rawRequestCapture, false);

    const durable = JSON.stringify({
      rollups: db.all("SELECT * FROM operational_request_rollups"),
      errors: db.all("SELECT * FROM operational_error_events")
    });
    for (const secret of [
      "request_health_raw_001",
      "request_missing_intent_raw_001",
      "request_invalid_window_raw_001",
      "request_device_unauthorized_raw_001",
      "bearer_token_must_not_persist",
      "mission_missing_private",
      "must_not_persist",
      "offerToken"
    ]) assert.equal(durable.includes(secret), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
