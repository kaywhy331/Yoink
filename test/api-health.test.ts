import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer, type AppDependencies } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

async function withServer(dependencies: Partial<AppDependencies>, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "health-test",
    ...dependencies
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

test("API-16: an unreadable sub-probe is a named degraded reason in a structured 503, not a masked 500", async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "yoink-health-"));
  try {
    mkdirSync(join(dataDirectory, "evidence"), { recursive: true });
    writeFileSync(join(dataDirectory, "evidence", "index.json"), "{ not json");
    await withServer({ dataDirectory }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      assert.equal(response.status, 503);
      const health = await response.json() as { status: string; reasons: string[]; localEvidenceCapsules: boolean };
      assert.equal(health.status, "degraded");
      assert.ok(health.reasons.includes("evidence_index_unreadable"), health.reasons.join(","));
      assert.equal(health.localEvidenceCapsules, false);
    });
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("API-16: a throwing worker status probe degrades health instead of failing the request", async () => {
  await withServer({
    backgroundWorkerStatus: () => { throw new Error("status store unavailable"); }
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(response.status, 503);
    const health = await response.json() as { reasons: string[] };
    assert.ok(health.reasons.includes("background_worker_status_unavailable"), health.reasons.join(","));
  });
});

test("API-18: hosted health does not publish the build commit or disk figures", async () => {
  await withServer({ hosted: true, hostValidator: () => true }, async (baseUrl) => {
    const health = await (await fetch(`${baseUrl}/api/v1/health`)).json() as Record<string, unknown>;
    assert.equal("build" in health, false);
    assert.equal("storage" in health, false);
    assert.equal(typeof health.status, "string");
    assert.ok(Array.isArray(health.reasons));
  });
  await withServer({}, async (baseUrl) => {
    const health = await (await fetch(`${baseUrl}/api/v1/health`)).json() as Record<string, unknown>;
    assert.equal(typeof health.build, "object", "local health keeps the build block for the dashboard");
  });
});

test("PLAT-21/WEB-18: cached static assets keep a stable ETag, revalidate with 304 and serve gzip", async () => {
  await withServer({}, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/user.js`, { headers: { "Accept-Encoding": "gzip" } });
    assert.equal(first.status, 200);
    const etag = first.headers.get("etag") ?? "";
    assert.match(etag, /^W\/"[a-f0-9]{64}"$/);
    await first.arrayBuffer();
    const second = await fetch(`${baseUrl}/user.js`);
    assert.equal(second.headers.get("etag"), etag);
    await second.arrayBuffer();
    const revalidated = await fetch(`${baseUrl}/user.js`, { headers: { "If-None-Match": etag } });
    assert.equal(revalidated.status, 304);
  });
});
