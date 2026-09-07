import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { createActionJobAvailabilityPulse } from "../apps/api/src/action-job-availability.js";
import { createYoinkServer } from "../apps/api/src/app.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

// The Chrome companion can pause and resume the shopper's own store actions with
// the dashboard's gates: pausing always applies, resuming needs a qualified store.
test("a paired Chrome companion pauses and resumes store actions through its own device route", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "test",
    actionJobAvailability: createActionJobAvailabilityPulse()
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
  try {
    const codeResponse = await fetch(`${baseUrl}/api/v1/devices/pairing-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    });
    assert.equal(codeResponse.status, 201);
    const code = (await codeResponse.json() as { pairing: { code: string } }).pairing.code;
    const pairResponse = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ pairingCode: code, name: "Pause test Chrome", platform: "windows-chrome", extensionVersion: "test" })
    });
    assert.equal(pairResponse.status, 201);
    const token = (await pairResponse.json() as { device: { token: string } }).device.token;
    const patch = (body: Record<string, unknown>, headers: Record<string, string> = {}) => fetch(`${baseUrl}/api/v1/devices/self/settings/actions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify(body)
    });

    const control = new ControlRepository(db);
    // A fresh install starts in the first-run safety pause.
    assert.equal(control.settings().actionsPaused, true);

    const unqualifiedResume = await patch({ paused: false });
    assert.equal(unqualifiedResume.status, 400);
    assert.match((await unqualifiedResume.json() as { message: string }).message, /Turn on cart adds/);
    assert.equal(control.settings().actionsPaused, true, "an unqualified resume changes nothing");

    const invalid = await patch({ paused: "yes" });
    assert.equal(invalid.status, 400);

    const unauthenticated = await fetch(`${baseUrl}/api/v1/devices/self/settings/actions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ paused: true })
    });
    assert.equal(unauthenticated.status, 401);

    control.setActionsPaused(false, "test resume");
    assert.equal(control.settings().actionsPaused, false);
    const pause = await patch({ paused: true });
    assert.equal(pause.status, 200);
    const pausedBody = await pause.json() as { disposition: string; settings: { actionsPaused: boolean; pauseReason: string } };
    assert.equal(pausedBody.disposition, "applied");
    assert.equal(pausedBody.settings.actionsPaused, true);
    assert.equal(pausedBody.settings.pauseReason, "Paused from the Chrome companion.");
    assert.equal(control.settings().actionsPaused, true);

    // The device heartbeat, which feeds the popup's health, reports the new state.
    const heartbeat = await fetch(`${baseUrl}/api/v1/devices/self/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ platform: "windows-chrome", extensionVersion: "test" })
    });
    assert.equal(heartbeat.status, 200);
    assert.equal((await heartbeat.json() as { controlPlane: { actionsPaused: boolean } }).controlPlane.actionsPaused, true);
  } finally {
    server.close();
    db.close();
  }
});
