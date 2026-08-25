import assert from "node:assert/strict";
import test from "node:test";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { NotificationRepository } from "../packages/database/src/notification-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";

const NOW = new Date("2026-08-23T08:00:00.000Z").getTime();

function notificationFixture() {
  const db = new YoinkDatabase();
  new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "notify-product-1",
    sourceListingId: "notify-listing-1",
    title: "Pokemon Notification Fixture",
    retailerId: "target",
    retailerSku: "95280894",
    canonicalUrl: "https://www.target.com/p/-/A-95280894",
    listingStatus: "out_of_stock",
    executionSupported: true,
    msrpCents: 4499,
    observedAt: new Date(NOW - 10_000).toISOString()
  }, NOW);
  const result = new SignalEngine(db).process({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId: "notify-event-1",
    eventType: "restock",
    observedAt: new Date(NOW - 1_000).toISOString(),
    identity: {
      sourceProductId: "notify-product-1",
      sourceListingId: "notify-listing-1",
      retailerId: "target",
      retailerSku: "95280894",
      title: "Pokemon Notification Fixture"
    },
    offer: {
      availability: "in_stock",
      unitPriceCents: 4499,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      fulfillment: "shipping"
    }
  }, NOW);
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode(NOW);
  const device = devices.pair({
    pairingCode: pairing.code,
    extensionVersion: "0.7.0",
    capabilities: { notifications: true }
  }, NOW + 100);
  return { db, result, device };
}

test("notify strategies create one durable Chrome delivery and acknowledge it exactly once", () => {
  const { db, result, device } = notificationFixture();
  try {
    assert.equal(result.actionJobState, "notify_only");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM notification_deliveries")?.count, 1);
    const notifications = new NotificationRepository(db);
    const lease = notifications.leaseNext(device.id, NOW + 200);
    assert.equal(lease.reason, "leased");
    if (lease.reason !== "leased") return;
    assert.equal(lease.notification.title, "Pokemon Notification Fixture");
    assert.equal(lease.notification.retailerId, "target");
    assert.equal(lease.notification.unitPriceCents, 4499);
    assert.match(lease.notification.capabilityToken, /^[A-Za-z0-9_-]{40,100}$/);
    assert.equal(JSON.stringify(db.all("SELECT * FROM notification_deliveries")).includes(lease.notification.capabilityToken), false);

    const acknowledged = notifications.acknowledge(
      device.id,
      lease.notification.id,
      lease.notification.capabilityToken,
      "delivered",
      "",
      NOW + 300
    );
    assert.equal(acknowledged.state, "delivered");
    assert.equal(notifications.leaseNext(device.id, NOW + 400).reason, "no_notifications");
    assert.equal(notifications.recordInteraction(device.id, lease.notification.id, "clicked", NOW + 500).state, "clicked");
    assert.equal(notifications.counts().deliveredNotifications, 0);
    assert.equal(notifications.listRecent()[0]?.state, "clicked");
  } finally {
    db.close();
  }
});

test("notification delivery refuses devices that did not declare the notification capability", () => {
  const { db } = notificationFixture();
  try {
    const devices = new DeviceRepository(db);
    const pairing = devices.createPairingCode(NOW + 1_000);
    const incapable = devices.pair({ pairingCode: pairing.code, capabilities: {} }, NOW + 1_100);
    assert.equal(new NotificationRepository(db).leaseNext(incapable.id, NOW + 1_200).reason, "device_unavailable");
  } finally {
    db.close();
  }
});

test("abandoned notification leases are requeued or failed by bounded background recovery", () => {
  const { db, device } = notificationFixture();
  try {
    const notifications = new NotificationRepository(db);
    db.run("UPDATE action_jobs SET expires_at = ?", new Date(NOW + 86_400_000).toISOString());
    const first = notifications.leaseNext(device.id, NOW + 200);
    assert.equal(first.reason, "leased");
    if (first.reason !== "leased") return;
    assert.deepEqual(notifications.recoverExpired(NOW + 60_201), {
      expiredNotifications: 0,
      requeuedLeases: 1,
      failedLeases: 0
    });
    assert.throws(
      () => notifications.acknowledge(device.id, first.notification.id, first.notification.capabilityToken, "delivered", "", NOW + 60_202),
      /invalid/
    );
    const second = notifications.leaseNext(device.id, NOW + 60_203);
    assert.equal(second.reason, "leased");
    if (second.reason !== "leased") return;
    db.run(
      "UPDATE notification_deliveries SET attempts = 3, lease_expires_at = ? WHERE id = ?",
      new Date(NOW + 60_204).toISOString(),
      second.notification.id
    );
    assert.deepEqual(notifications.recoverExpired(NOW + 60_205), {
      expiredNotifications: 0,
      requeuedLeases: 0,
      failedLeases: 1
    });
    assert.equal(notifications.listRecent()[0]?.state, "failed");
  } finally {
    db.close();
  }
});
