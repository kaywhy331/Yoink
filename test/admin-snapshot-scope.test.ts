import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("admin snapshots disclose only the selected workspace while preserving the legacy full projection", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "admin-snapshot-scope-test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const [overviewResponse, connectionsResponse, settingsResponse, fullResponse] = await Promise.all([
      fetch(`${baseUrl}/api/v1/admin/snapshot?view=overview`),
      fetch(`${baseUrl}/api/v1/admin/snapshot?view=connections`),
      fetch(`${baseUrl}/api/v1/admin/snapshot?view=settings`),
      fetch(`${baseUrl}/api/v1/admin/snapshot`)
    ]);
    assert.equal(overviewResponse.status, 200);
    assert.equal(connectionsResponse.status, 200);
    assert.equal(settingsResponse.status, 200);
    assert.equal(fullResponse.status, 200);

    const overview = await overviewResponse.json() as Record<string, unknown>;
    const connections = await connectionsResponse.json() as Record<string, unknown>;
    const settings = await settingsResponse.json() as Record<string, unknown>;
    const full = await fullResponse.json() as Record<string, unknown>;

    assert.equal(overview.view, "overview");
    assert.equal((overview.counts as Record<string, unknown>).activeActionJobs, 0);
    assert.ok(Array.isArray(overview.sources));
    assert.ok(Array.isArray(overview.strategies));
    assert.ok((overview.overview as { windows?: unknown })?.windows);
    assert.deepEqual(Object.keys((overview.overview as { windows: Record<string, unknown> }).windows), ["hours24", "days7"]);
    assert.equal("shadowObservations" in overview, false);
    assert.equal("observerRegistry" in overview, false);
    assert.equal("dataPlane" in overview, false);
    assert.equal("attributionPolicies" in overview, false);

    assert.equal(connections.view, "connections");
    assert.ok(Array.isArray(connections.devices));
    assert.ok(Array.isArray(connections.shadowObservations));
    assert.ok(connections.targetQualification);
    assert.ok(connections.walmartQualification);
    assert.ok(connections.amazonQualification);
    assert.ok(connections.bestBuyQualification);
    assert.equal("community" in connections, false);
    assert.equal("operatorAlerts" in connections, false);

    assert.equal(settings.view, "settings");
    assert.ok(Array.isArray(settings.attributionPolicies));
    assert.equal("devices" in settings, false);
    assert.equal("shadowObservations" in settings, false);
    assert.equal("operatorAlerts" in settings, false);

    assert.equal("view" in full, false);
    assert.ok(full.observerRegistry);
    assert.ok(full.dataPlane);
    assert.ok(Array.isArray(full.shadowObservations));
    assert.ok(Array.isArray(full.attributionPolicies));
    assert.ok(JSON.stringify(overview).length < JSON.stringify(full).length / 2);

    const invalid = await fetch(`${baseUrl}/api/v1/admin/snapshot?view=everything`);
    assert.equal(invalid.status, 400);
    const invalidPayload = await invalid.json() as Record<string, unknown>;
    assert.equal(invalidPayload.error, "invalid_admin_snapshot_view");
    assert.equal(invalidPayload.message, "Choose a supported admin workspace before requesting its live snapshot.");
    assert.match(String(invalidPayload.correlationId), /^request_/);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
