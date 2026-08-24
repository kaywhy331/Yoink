import assert from "node:assert/strict";
import test from "node:test";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { SourceRepository } from "../packages/database/src/source-repository.js";

const NOW = new Date("2026-08-23T08:00:00.000Z").getTime();

test("a paired device records one monotonic, durable, uncapped source sync run", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const device = devices.pair({ pairingCode: code.code }, NOW + 100);
    const sources = new SourceRepository(db);
    const syncId = "tlsync_fixture_12345678";
    const started = sources.startSyncRun(device.id, {
      syncId,
      phase: "starting",
      page: 0,
      pages: 0,
      discovered: 0,
      processed: 0,
      imported: 0,
      failed: 0,
      message: "Starting fixture sync"
    }, NOW + 200);
    assert.equal(started.phase, "starting");

    const discovered = sources.updateSyncRun(device.id, {
      syncId,
      phase: "discovering",
      page: 1,
      pages: 1,
      discovered: 10_001,
      processed: 0,
      imported: 0,
      failed: 0,
      message: `Discovered products with Bearer ${"S".repeat(48)}`
    }, NOW + 300);
    assert.equal(discovered.discovered, 10_001);

    sources.updateSyncRun(device.id, {
      syncId,
      phase: "importing",
      page: 1,
      pages: 1,
      discovered: 10_001,
      processed: 0,
      imported: 0,
      failed: 0,
      message: "Importing"
    }, NOW + 400);
    const item = sources.recordSyncItem(device.id, syncId, "138022", {
      candidatesAccepted: 7,
      listingsMapped: 4,
      listingsCreated: 3
    }, NOW + 500);
    assert.equal(item.outcome, "imported");
    const completed = sources.updateSyncRun(device.id, {
      syncId,
      phase: "complete",
      page: 1,
      pages: 1,
      discovered: 10_001,
      processed: 1,
      imported: 1,
      failed: 0,
      message: "Complete"
    }, NOW + 600);
    assert.equal(completed.phase, "complete");
    assert.ok(completed.completedAt);
    assert.equal(sources.listSyncRuns()[0]?.itemReceiptCount, 1);
    assert.throws(() => sources.updateSyncRun(device.id, {
      syncId,
      phase: "importing",
      page: 1,
      pages: 1,
      discovered: 10_001,
      processed: 1,
      imported: 1,
      failed: 0,
      message: "Cannot reopen"
    }, NOW + 700), /transition/);
    const durable = JSON.stringify(db.all("SELECT * FROM source_sync_runs"));
    assert.equal(durable.includes("S".repeat(48)), false);
    assert.equal(JSON.stringify(db.all("SELECT * FROM source_sync_run_items")).includes(device.token), false);
  } finally {
    db.close();
  }
});

test("a fresh active source sync prevents a competing run on the same device", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const device = devices.pair({ pairingCode: code.code }, NOW + 100);
    const sources = new SourceRepository(db);
    const input = (syncId: string) => ({
      syncId,
      phase: "starting" as const,
      page: 0,
      pages: 0,
      discovered: 0,
      processed: 0,
      imported: 0,
      failed: 0,
      message: "Starting"
    });
    sources.startSyncRun(device.id, input("tlsync_fixture_first_1234"), NOW + 200);
    assert.throws(() => sources.startSyncRun(device.id, input("tlsync_fixture_second_123"), NOW + 300), /already active/);
  } finally {
    db.close();
  }
});

test("unchanged TrackaLacker bridge heartbeats do not flood audit and outbox history", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const device = devices.pair({ pairingCode: code.code }, NOW + 100);
    const sources = new SourceRepository(db);
    const status = {
      state: "ready" as const,
      ready: true,
      subscriptionPresent: true,
      pendingSignals: 0,
      lastHttpStatus: 200,
      errorCode: "",
      lastRegistrationAt: "2026-08-23T08:00:00.000Z",
      lastNotificationAt: "",
      lastDeliveryAt: "",
      updatedAt: "2026-08-23T08:01:00.000Z"
    };
    sources.recordTrackalackerPushStatus(device.id, status, NOW + 200);
    sources.recordTrackalackerPushStatus(device.id, {
      ...status,
      updatedAt: "2026-08-23T08:02:00.000Z"
    }, NOW + 300);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'source_connection_status'"
    )?.count, 1);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM outbox_events WHERE event_type = 'source_connection_status'"
    )?.count, 1);

    sources.recordTrackalackerPushStatus(device.id, {
      ...status,
      pendingSignals: 1,
      updatedAt: "2026-08-23T08:03:00.000Z"
    }, NOW + 400);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'source_connection_status'"
    )?.count, 2);
  } finally {
    db.close();
  }
});
