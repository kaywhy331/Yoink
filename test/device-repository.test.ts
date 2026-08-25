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
        communityReadOnlyEvidence: true,
        exactSelectedOfferEvidence: true,
        durableAdapterDiagnostics: true,
        privacyBoundedRepairLandmarks: true,
        rotatableDeviceCredentials: true,
        productionTransportProfile: true,
        managedExtensionUpdates: true,
        walmartDrawReadOnly: true,
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
    assert.equal(heartbeat.capabilities.communityReadOnlyEvidence, true);
    assert.equal(heartbeat.capabilities.exactSelectedOfferEvidence, true);
    assert.equal(heartbeat.capabilities.durableAdapterDiagnostics, true);
    assert.equal(heartbeat.capabilities.privacyBoundedRepairLandmarks, true);
    assert.equal(heartbeat.capabilities.rotatableDeviceCredentials, true);
    assert.equal(heartbeat.capabilities.productionTransportProfile, true);
    assert.equal(heartbeat.capabilities.managedExtensionUpdates, true);
    assert.equal(heartbeat.capabilities.walmartDrawReadOnly, true);
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
    assert.equal(downgraded.capabilities.privacyBoundedRepairLandmarks, false);
    assert.equal(downgraded.capabilities.rotatableDeviceCredentials, false);
    assert.equal(downgraded.capabilities.productionTransportProfile, false);
    assert.equal(downgraded.capabilities.managedExtensionUpdates, false);
    assert.equal(devices.listDevices(NOW + 2_500)[0]?.online, true);
    assert.equal(devices.revoke(paired.id, NOW + 3_000), true);
    assert.equal(devices.authenticate(paired.token), null);
    assert.equal(devices.revoke(paired.id, NOW + 4_000), false);
  } finally {
    db.close();
  }
});

test("device credentials rotate in two recoverable phases with a bounded previous-token grace", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const paired = devices.pair({ pairingCode: code.code }, NOW + 1_000);
    const current = devices.authenticate(paired.token, NOW + 2_000);
    assert.equal(current?.credentialSlot, "current");
    assert.equal(current?.credentialGeneration, 1);
    assert.equal(devices.credentialStatus(paired.id, NOW + 2_000).rotationDue, false);
    assert.equal(devices.credentialStatus(paired.id, NOW + 31 * 24 * 60 * 60_000).rotationDue, true);

    const pending = devices.beginCredentialRotation(current!, NOW + 3_000);
    assert.equal(pending.generation, 2);
    assert.match(pending.token, /^[A-Za-z0-9_-]{40,100}$/);
    assert.equal(devices.authenticate(pending.token, NOW + 4_000), null);
    assert.equal(devices.authenticate(paired.token, NOW + 4_000)?.credentialSlot, "current");
    assert.equal(devices.credentialStatus(paired.id, NOW + 4_000).pending, true);

    const committed = devices.commitCredentialRotation(pending.token, pending.generation, NOW + 5_000);
    assert.equal(committed?.credential.generation, 2);
    assert.equal(committed?.credential.pending, false);
    assert.equal(devices.authenticate(pending.token, NOW + 6_000)?.credentialSlot, "current");
    const previous = devices.authenticate(paired.token, NOW + 6_000);
    assert.equal(previous?.credentialSlot, "previous");
    assert.throws(
      () => devices.beginCredentialRotation(previous!, NOW + 6_500),
      /current device credential/
    );

    const idempotent = devices.commitCredentialRotation(pending.token, 2, NOW + 7_000);
    assert.equal(idempotent?.credential.generation, 2);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'extension_device_credential_rotation_committed'"
    )?.count, 1);
    assert.equal(devices.authenticate(paired.token, NOW + 5_000 + 2 * 60_000)?.credentialSlot, "previous");
    assert.equal(devices.authenticate(paired.token, NOW + 5_000 + 2 * 60_000 + 1), null);

    const durable = JSON.stringify(db.all("SELECT * FROM extension_devices"));
    assert.equal(durable.includes(paired.token), false);
    assert.equal(durable.includes(pending.token), false);
  } finally {
    db.close();
  }
});

test("lost and expired pending credentials never invalidate the current Chrome credential", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const code = devices.createPairingCode(NOW);
    const paired = devices.pair({ pairingCode: code.code }, NOW + 1_000);
    const current = devices.authenticate(paired.token, NOW + 2_000)!;
    const lost = devices.beginCredentialRotation(current, NOW + 3_000);
    const replacement = devices.beginCredentialRotation(current, NOW + 4_000);

    assert.equal(devices.commitCredentialRotation(lost.token, lost.generation, NOW + 5_000), null);
    assert.equal(devices.authenticate(paired.token, NOW + 5_000)?.credentialSlot, "current");
    assert.equal(devices.commitCredentialRotation(
      replacement.token,
      replacement.generation,
      NOW + 4_000 + 10 * 60_000 + 1
    ), null);
    assert.equal(devices.authenticate(paired.token, NOW + 4_000 + 10 * 60_000 + 2)?.credentialSlot, "current");

    const final = devices.beginCredentialRotation(current, NOW + 4_000 + 10 * 60_000 + 3);
    assert.ok(devices.commitCredentialRotation(final.token, final.generation, NOW + 4_000 + 10 * 60_000 + 4));
    assert.equal(devices.revoke(paired.id, NOW + 4_000 + 10 * 60_000 + 5), true);
    assert.equal(devices.authenticate(final.token, NOW + 4_000 + 10 * 60_000 + 6), null);
    assert.equal(devices.authenticate(paired.token, NOW + 4_000 + 10 * 60_000 + 6), null);
  } finally {
    db.close();
  }
});
