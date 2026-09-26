import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("HTTP semantics classify body failures, unsupported methods, and degraded readiness", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "http-semantics-test",
    backgroundWorkerStatus: () => ({
      state: "stopped",
      healthy: false,
      runtimeKind: "standalone",
      mode: "external",
      lastHeartbeatAt: "",
      lastErrorCode: "heartbeat_stale",
      deploymentAttested: true,
      deploymentContractVersion: 3
    })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const mutationHeaders = { Origin: baseUrl, "X-Yoink-Request": "1" };

  try {
    const healthResponse = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthResponse.status, 503);
    const health = await healthResponse.json() as Record<string, unknown>;
    assert.equal(health.status, "degraded");
    assert.equal(health.database, "ready");
    assert.deepEqual(health.reasons, ["background_worker_unhealthy"]);
    assert.equal(health.backgroundWorkerRuntime, "stopped");
    assert.equal("durableBackgroundTasks" in health, false);

    const capabilitiesResponse = await fetch(`${baseUrl}/api/v1/admin/capabilities`);
    assert.equal(capabilitiesResponse.status, 200);
    const capabilities = await capabilitiesResponse.json() as Record<string, unknown>;
    assert.equal(capabilities.durableBackgroundTasks, true);

    const unsupportedMethod = await fetch(`${baseUrl}/api/v1/health`, {
      method: "POST",
      headers: mutationHeaders
    });
    assert.equal(unsupportedMethod.status, 405);
    assert.equal((await unsupportedMethod.json() as { error: string }).error, "method_not_allowed");

    const unsupportedMedia = await fetch(`${baseUrl}/api/v1/user/watch-queue/settings`, {
      method: "PATCH",
      headers: { ...mutationHeaders, "Content-Type": "text/plain" },
      body: "{}"
    });
    assert.equal(unsupportedMedia.status, 415);
    assert.equal((await unsupportedMedia.json() as { error: string }).error, "unsupported_media_type");

    const malformedJson = await fetch(`${baseUrl}/api/v1/user/watch-queue/settings`, {
      method: "PATCH",
      headers: { ...mutationHeaders, "Content-Type": "application/json" },
      body: "{"
    });
    assert.equal(malformedJson.status, 400);
    assert.equal((await malformedJson.json() as { error: string }).error, "invalid_json");

    const oversizedBody = await fetch(`${baseUrl}/api/v1/user/watch-queue/settings`, {
      method: "PATCH",
      headers: { ...mutationHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(1_000_001) })
    });
    assert.equal(oversizedBody.status, 413);
    assert.equal((await oversizedBody.json() as { error: string }).error, "request_body_too_large");
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
