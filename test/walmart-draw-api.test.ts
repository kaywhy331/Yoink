import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { observeWalmartDrawHub } from "../packages/browser-adapters/src/walmart-draw.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } };
};

test("authenticated Chrome posts a sanitized Walmart Draw scan to user and admin read models", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const extensionOrigin = `chrome-extension://${"e".repeat(32)}`;
  try {
    const pairing = await fetch(`${baseUrl}/api/v1/devices/pairing-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    }).then((response) => response.json()) as { pairing: { code: string } };
    const paired = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ pairingCode: pairing.pairing.code })
    }).then((response) => response.json()) as { device: { token: string } };
    const html = readFileSync(join(process.cwd(), "test", "fixtures", "retailers", "walmart-draw-hub.html"), "utf8");
    const document = new JSDOM(html, { url: "https://www.walmart.com/shop/collectibles/draw" }).window.document;
    const payload = observeWalmartDrawHub(document, "https://www.walmart.com/shop/collectibles/draw");
    payload.items = payload.items.map((item) => ({
      ...item,
      closesAt: new Date(Date.now() + 60 * 60_000).toISOString()
    }));
    const posted = await fetch(`${baseUrl}/api/v1/devices/self/walmart-draw/scans`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.device.token}`
      },
      body: JSON.stringify({ ...payload, payment: "DO_NOT_STORE", pageText: "DO_NOT_STORE" })
    });
    assert.equal(posted.status, 201);
    const result = await posted.json() as { scan: { items: unknown[]; outcome: string } };
    assert.equal(result.scan.outcome, "passed");
    assert.equal(result.scan.items.length, 4);

    const overview = await fetch(`${baseUrl}/api/v1/user/overview`).then((response) => response.json()) as {
      walmartDraws: { readOnly: boolean; entryMutationAuthorized: boolean; contingentOrderRisk: boolean; items: unknown[] };
    };
    assert.equal(overview.walmartDraws.readOnly, true);
    assert.equal(overview.walmartDraws.entryMutationAuthorized, false);
    assert.equal(overview.walmartDraws.contingentOrderRisk, true);
    assert.equal(overview.walmartDraws.items.length, 4);

    const snapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
      capabilities: Record<string, boolean>;
      walmartDraws: { items: unknown[] };
    };
    assert.equal(snapshot.counts.walmartDrawScans, 1);
    assert.equal(snapshot.counts.walmartDrawItems, 4);
    assert.equal(snapshot.capabilities.walmartDrawReadOnly, true);
    assert.equal(snapshot.capabilities.walmartDrawEntryMutation, false);
    assert.equal(snapshot.walmartDraws.items.length, 4);
    assert.equal(JSON.stringify(db.all("SELECT * FROM walmart_draw_scans")).includes("DO_NOT_STORE"), false);

    const foreign = await fetch(`${baseUrl}/api/v1/devices/self/walmart-draw/scans`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
        Authorization: `Bearer ${paired.device.token}`
      },
      body: JSON.stringify(payload)
    });
    assert.equal(foreign.status, 403);
  } finally {
    server.close();
    db.close();
  }
});
