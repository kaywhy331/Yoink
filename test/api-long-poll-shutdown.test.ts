import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { runWithRequestScope } from "../packages/database/src/request-scope.js";

const COMPANION_ORIGIN = `chrome-extension://${"a".repeat(32)}`;

async function pairDevice(baseUrl: string, code: string): Promise<string> {
  const paired = await fetch(`${baseUrl}/api/v1/devices/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: COMPANION_ORIGIN },
    body: JSON.stringify({ pairingCode: code, extensionVersion: "1.28.4", capabilities: { notifications: true } })
  });
  assert.equal(paired.status, 201);
  return (await paired.json() as { device: { token: string } }).device.token;
}

test("API-22 and API-08: a newer long-poll supersedes the older one, and shutdown ends waits at once and refuses new requests", async () => {
  const db = new YoinkDatabase();
  const shutdown = new AbortController();
  const code = runWithRequestScope({
    tenantId: LOCAL_TENANT_ID,
    userId: LOCAL_USER_ID,
    actorKind: "user",
    actorId: LOCAL_USER_ID
  }, () => new DeviceRepository(db).createPairingCode().code);
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "1.28.4",
    shutdownSignal: shutdown.signal
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const token = await pairDevice(baseUrl, code);
    const headers = { Authorization: `Bearer ${token}` };

    const olderStartedAt = Date.now();
    // A fresh local install is in shadow mode, so jobs/next answers at once;
    // notifications/next is the wait that is held open.
    const older = fetch(`${baseUrl}/api/v1/devices/self/notifications/next?wait=20000`, { headers });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const newer = fetch(`${baseUrl}/api/v1/devices/self/notifications/next?wait=20000`, { headers });
    const olderResponse = await older;
    assert.equal(olderResponse.status, 200);
    const olderBody = await olderResponse.json() as { notification: unknown; superseded?: boolean };
    assert.equal(olderBody.notification ?? null, null, JSON.stringify(olderBody));
    assert.equal(olderBody.superseded, true, JSON.stringify(olderBody));
    assert.ok(Date.now() - olderStartedAt < 5_000, "the superseded wait returned promptly");

    const abortedAt = Date.now();
    shutdown.abort();
    const newerResponse = await newer;
    assert.equal(newerResponse.status, 200);
    const newerBody = await newerResponse.json() as { notification: unknown; superseded?: boolean };
    assert.equal(newerBody.notification ?? null, null);
    assert.equal(newerBody.superseded, undefined);
    assert.ok(Date.now() - abortedAt < 3_000, "shutdown released both waits within the close window");

    const refused = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(refused.status, 503);
    assert.equal((await refused.json() as { error: string }).error, "shutting_down");
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
    db.close();
  }
});

test("API-22 (FR-04): at the waiter cap a long-poll still leases once and only skips the wait", async () => {
  const db = new YoinkDatabase();
  const scope = { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID, actorKind: "user", actorId: LOCAL_USER_ID } as const;
  const pairingCode = () => runWithRequestScope(scope, () => new DeviceRepository(db).createPairingCode().code);
  const shutdown = new AbortController();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "1.28.4",
    shutdownSignal: shutdown.signal,
    longPollWaitersMax: 1
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const holder = { Authorization: `Bearer ${await pairDevice(baseUrl, pairingCode())}` };
    const other = { Authorization: `Bearer ${await pairDevice(baseUrl, pairingCode())}` };
    const held = fetch(`${baseUrl}/api/v1/devices/self/notifications/next?wait=20000`, { headers: holder });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const startedAt = Date.now();
    const skipped = await fetch(`${baseUrl}/api/v1/devices/self/notifications/next?wait=20000`, { headers: other });
    assert.equal(skipped.status, 200, "the cap never refuses the immediate lease");
    assert.equal(skipped.headers.get("retry-after"), "5");
    const body = await skipped.json() as { notification: unknown; reason?: string; waitSkipped?: boolean; retryAfterMs?: number };
    assert.equal(body.waitSkipped, true, JSON.stringify(body));
    assert.equal(body.retryAfterMs, 5000);
    assert.equal(body.reason, "no_notifications", "the lease ran and answered");
    assert.ok(Date.now() - startedAt < 3_000, "the capped request did not wait");

    // The holder's own newer poll supersedes rather than counting against the cap.
    const superseding = fetch(`${baseUrl}/api/v1/devices/self/notifications/next?wait=20000`, { headers: holder });
    const heldBody = await (await held).json() as { superseded?: boolean; waitSkipped?: boolean };
    assert.equal(heldBody.superseded, true);
    assert.equal(heldBody.waitSkipped, undefined);
    shutdown.abort();
    const supersedingBody = await (await superseding).json() as { waitSkipped?: boolean };
    assert.equal(supersedingBody.waitSkipped, undefined, "a superseding poll is not capped");
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
    db.close();
  }
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

test("API-08: SIGTERM with an open companion long-poll exits 0 promptly and closes the database", async () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-shutdown-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", "apps/api/src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      YOINK_DATA_DIR: directory,
      YOINK_PORT: String(port),
      YOINK_BACKGROUND_WORKER_MODE: "disabled",
      YOINK_HOSTED_MODE: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const readyBy = Date.now() + 60_000;
    while (!/ready at http/.test(output)) {
      if (child.exitCode !== null) assert.fail(`the API exited during startup:\n${output}`);
      if (Date.now() > readyBy) assert.fail(`the API did not become ready:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const pairingCode = await fetch(`${baseUrl}/api/v1/devices/pairing-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(pairingCode.status, 201, await pairingCode.clone().text());
    const code = (await pairingCode.json() as { pairing: { code: string } }).pairing.code;
    const token = await pairDevice(baseUrl, code);
    const wait = fetch(`${baseUrl}/api/v1/devices/self/notifications/next?wait=25000`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then((response) => response.status, () => 0);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const signalledAt = Date.now();
    child.kill("SIGTERM");
    const [exitCode] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
    assert.equal(exitCode, 0, output);
    assert.ok(Date.now() - signalledAt < 3_000, `shutdown took ${Date.now() - signalledAt} ms`);
    assert.match(output, /Yoink stopped \(SIGTERM\)/);
    assert.ok([0, 200].includes(await wait));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
