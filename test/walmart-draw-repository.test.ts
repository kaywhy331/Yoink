import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { WalmartDrawScanInput } from "../packages/contracts/src/index.js";
import { observeWalmartDrawHub } from "../packages/browser-adapters/src/walmart-draw.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { WalmartDrawRepository } from "../packages/database/src/walmart-draw-repository.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } };
};
const NOW = new Date("2026-08-24T19:10:00.000Z").getTime();
const URL = "https://www.walmart.com/shop/collectibles/draw";

function pairedDevice(db: YoinkDatabase): { id: string; token: string } {
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  return devices.pair({ pairingCode: code.code }, NOW + 500);
}

function scan(): WalmartDrawScanInput {
  const html = readFileSync(join(process.cwd(), "test", "fixtures", "retailers", "walmart-draw-hub.html"), "utf8");
  const document = new JSDOM(html, { url: URL }).window.document;
  return observeWalmartDrawHub(document, URL, new Date(NOW + 1_000).toISOString());
}

test("Walmart Draw scans persist only normalized, exact, read-only item evidence", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new WalmartDrawRepository(db);
    const input = {
      ...scan(),
      addressLineOne: "DO_NOT_STORE",
      paymentMethod: "DO_NOT_STORE",
      cookie: "DO_NOT_STORE",
      items: scan().items.map((item) => ({ ...item, offerToken: "DO_NOT_STORE", pageText: "DO_NOT_STORE" }))
    } as unknown as WalmartDrawScanInput;
    const stored = repository.record(device.id, input, NOW + 2_000);
    assert.equal(stored.outcome, "passed");
    assert.equal(stored.items.length, 4);
    assert.equal(stored.items[0]?.canonicalUrl, "https://www.walmart.com/ip/19624258216");
    assert.equal(stored.items[0]?.sellerName, "Walmart");
    assert.match(stored.evidenceHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(repository.counts(NOW + 2_000), {
      walmartDrawScans: 1,
      walmartDrawItems: 4,
      walmartDrawFailures: 0,
      activeWalmartDraws: 4
    });
    assert.equal(repository.currentItems(NOW + 2_000).length, 4);
    const durable = JSON.stringify(db.all("SELECT * FROM walmart_draw_scans"))
      + JSON.stringify(db.all("SELECT * FROM walmart_draw_items"));
    assert.equal(durable.includes("DO_NOT_STORE"), false);
    assert.equal(durable.includes(device.token), false);

    const retry = repository.record(device.id, input, NOW + 3_000);
    assert.equal(retry.id, stored.id);
    assert.equal(repository.counts(NOW + 3_000).walmartDrawScans, 1);
    repository.record(device.id, {
      adapterVersion: "walmart-draw-observer-v1",
      contractVersion: 1,
      observedAt: new Date(NOW + 4_000).toISOString(),
      pageKind: "walmart_draw_hub",
      outcome: "passed",
      reasonCode: "no_active_drawings",
      expectedCardCount: 0,
      observedCardCount: 0,
      securityChallenge: false,
      interactiveBlock: "",
      items: []
    }, NOW + 5_000);
    assert.equal(repository.currentItems(NOW + 5_000).length, 0);
    assert.equal(repository.counts(NOW + 5_000).activeWalmartDraws, 0);
  } finally {
    db.close();
  }
});

test("Walmart Draw ledger accepts sanitized failures and rejects inconsistent or stale scans", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new WalmartDrawRepository(db);
    const failed: WalmartDrawScanInput = {
      adapterVersion: "walmart-draw-observer-v1",
      contractVersion: 1,
      observedAt: new Date(NOW + 1_000).toISOString(),
      pageKind: "walmart_draw_hub",
      outcome: "failed",
      reasonCode: "observer_runtime_unavailable",
      expectedCardCount: 0,
      observedCardCount: 0,
      securityChallenge: false,
      interactiveBlock: "",
      items: []
    };
    assert.equal(repository.record(device.id, failed, NOW + 2_000).outcome, "failed");
    assert.equal(repository.counts(NOW + 2_000).walmartDrawFailures, 1);
    assert.throws(
      () => repository.record(device.id, { ...failed, outcome: "passed" }, NOW + 2_000),
      /outcome and reason/
    );
    assert.throws(
      () => repository.record(device.id, { ...failed, observedAt: new Date(NOW - 11 * 60_000).toISOString() }, NOW),
      /stale/
    );
    assert.throws(
      () => repository.record(device.id, {
        ...failed,
        outcome: "manual",
        reasonCode: "interactive_auth",
        interactiveBlock: "location"
      }, NOW + 2_000),
      /interactive evidence/
    );
    assert.throws(() => repository.record("device_missing", failed, NOW + 2_000), /unavailable/);
  } finally {
    db.close();
  }
});
