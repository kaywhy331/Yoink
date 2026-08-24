import assert from "node:assert/strict";
import test from "node:test";
import { AMAZON_ADD_ADAPTER_VERSION, BESTBUY_ADD_ADAPTER_VERSION, TARGET_ADD_ADAPTER_VERSION, WALMART_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

const NOW = new Date("2026-08-22T20:00:00.000Z").getTime();

test("a one-time pairing code creates a hashed device credential", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const pairing = devices.createPairingCode(NOW);
    assert.match(pairing.code, /^[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/);
    const paired = devices.pair({
      pairingCode: pairing.code.toLowerCase(),
      name: "Desktop - Windows - Chrome",
      platform: "windows-chrome",
      extensionVersion: "0.2.0",
      capabilities: { readiness: true, jobReconciliation: true, retailerMutation: false }
    }, NOW + 1_000);

    assert.match(paired.token, /^[A-Za-z0-9_-]{40,100}$/);
    assert.equal(devices.authenticate(paired.token)?.id, paired.id);
    assert.equal(devices.authenticate("not-a-token"), null);
    assert.throws(() => devices.pair({ pairingCode: pairing.code }, NOW + 2_000), /invalid or expired/);

    const stored = JSON.stringify({
      pairing: db.all("SELECT * FROM device_pairing_codes"),
      devices: db.all("SELECT * FROM extension_devices"),
      audit: db.all("SELECT * FROM audit_events")
    });
    assert.equal(stored.includes(pairing.code.replace("-", "")), false);
    assert.equal(stored.includes(paired.token), false);
  } finally {
    db.close();
  }
});

test("pairing codes expire and creating another code invalidates the first", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const first = devices.createPairingCode(NOW);
    const second = devices.createPairingCode(NOW + 1_000);
    assert.throws(() => devices.pair({ pairingCode: first.code }, NOW + 2_000), /invalid or expired/);
    assert.throws(() => devices.pair({ pairingCode: second.code }, NOW + 5 * 60_000 + 1_001), /invalid or expired/);
  } finally {
    db.close();
  }
});

test("heartbeats update sanitized readiness and revocation immediately disables access", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const paired = devices.pair({ pairingCode: code.code }, NOW + 1_000);
    const heartbeat = devices.heartbeat(paired.id, {
      platform: "windows-chrome",
      extensionVersion: "0.2.1",
      capabilities: {
        readiness: true,
        jobReconciliation: true,
        notifications: true,
        retailerShadow: true,
        durableAdapterDiagnostics: true,
        trackalackerPush: true,
        trackalackerCatalogSync: true,
        retailerMutation: true as never,
        targetAddOnly: true,
        targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION,
        walmartAddOnly: true,
        walmartAddAdapterVersion: WALMART_ADD_ADAPTER_VERSION,
        amazonAddOnly: true,
        amazonAddAdapterVersion: AMAZON_ADD_ADAPTER_VERSION,
        bestBuyAddOnly: true,
        bestBuyAddAdapterVersion: BESTBUY_ADD_ADAPTER_VERSION
      }
    }, NOW + 2_000);
    assert.equal(heartbeat.extensionVersion, "0.2.1");
    assert.equal(heartbeat.capabilities.retailerMutation, false);
    assert.equal(heartbeat.capabilities.notifications, true);
    assert.equal(heartbeat.capabilities.retailerShadow, true);
    assert.equal(heartbeat.capabilities.durableAdapterDiagnostics, true);
    assert.equal(heartbeat.capabilities.trackalackerPush, true);
    assert.equal(heartbeat.capabilities.trackalackerCatalogSync, true);
    assert.equal(heartbeat.capabilities.targetAddOnly, true);
    assert.equal(heartbeat.capabilities.targetAddAdapterVersion, TARGET_ADD_ADAPTER_VERSION);
    assert.equal(heartbeat.capabilities.walmartAddOnly, true);
    assert.equal(heartbeat.capabilities.walmartAddAdapterVersion, WALMART_ADD_ADAPTER_VERSION);
    assert.equal(heartbeat.capabilities.amazonAddOnly, true);
    assert.equal(heartbeat.capabilities.amazonAddAdapterVersion, AMAZON_ADD_ADAPTER_VERSION);
    assert.equal(heartbeat.capabilities.bestBuyAddOnly, true);
    assert.equal(heartbeat.capabilities.bestBuyAddAdapterVersion, BESTBUY_ADD_ADAPTER_VERSION);
    const downgraded = devices.heartbeat(paired.id, {
      capabilities: { targetAddOnly: true, targetAddAdapterVersion: "spoofed" as never }
    }, NOW + 2_250);
    assert.equal(downgraded.capabilities.targetAddOnly, false);
    assert.equal(downgraded.capabilities.targetAddAdapterVersion, "");
    assert.equal(downgraded.capabilities.walmartAddOnly, false);
    assert.equal(downgraded.capabilities.walmartAddAdapterVersion, "");
    assert.equal(downgraded.capabilities.amazonAddOnly, false);
    assert.equal(downgraded.capabilities.amazonAddAdapterVersion, "");
    assert.equal(downgraded.capabilities.bestBuyAddOnly, false);
    assert.equal(downgraded.capabilities.bestBuyAddAdapterVersion, "");
    assert.equal(devices.listDevices(NOW + 2_500)[0]?.online, true);
    assert.equal(devices.revoke(paired.id, NOW + 3_000), true);
    assert.equal(devices.authenticate(paired.token), null);
    assert.equal(devices.revoke(paired.id, NOW + 4_000), false);
  } finally {
    db.close();
  }
});
