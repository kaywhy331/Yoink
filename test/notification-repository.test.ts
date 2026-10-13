import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { NotificationRepository } from "../packages/database/src/notification-repository.js";
import { WalmartPurchaseHandoffInteractionRepository } from "../packages/database/src/walmart-purchase-handoff-interaction-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import type { StrategyDefinition } from "../packages/contracts/src/index.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { enablePlansFromCalls } from "./helpers/plans-from-calls.js";

const NOW = new Date("2026-08-23T08:00:00.000Z").getTime();
const WALMART_ITEM_ID = "19988614228";

function notificationFixture() {
  const db = new YoinkDatabase();
  enablePlansFromCalls(db);
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

function walmartNotificationFixture(howl = false) {
  const db = new YoinkDatabase();
  enablePlansFromCalls(db);
  new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "walmart-notify-product",
    sourceListingId: "walmart-notify-listing",
    title: "Walmart Notification Fixture",
    retailerId: "walmart",
    retailerSku: WALMART_ITEM_ID,
    canonicalUrl: `https://www.walmart.com/ip/${WALMART_ITEM_ID}`,
    listingStatus: "out_of_stock",
    executionSupported: true,
    msrpCents: 9_000,
    observedAt: new Date(NOW - 10_000).toISOString()
  }, NOW);
  const strategy: StrategyDefinition = {
    id: "strategy_walmart_notification",
    name: "Walmart notification",
    enabled: true,
    position: 1,
    revision: 1,
    sources: ["trackalacker"],
    retailers: ["walmart"],
    pricePolicy: { kind: "absolute_max", maxPriceCents: 9_000 },
    sellerPolicy: "first_party_only",
    allowedSellers: [],
    includeKeywords: "",
    excludeKeywords: "",
    action: "notify",
    quantity: 1,
    fulfillment: "shipping",
    maxSignalAgeSeconds: 120
  };
  new ControlRepository(db).replaceStrategies([strategy], NOW);
  if (howl) {
    db.run(
      `UPDATE attribution_policies SET enabled = 1, provider = 'howl',
         publisher_slug = 'collectwithdodo', article_base_url = 'https://yoink.example/alerts/'
       WHERE retailer_id = 'walmart'`
    );
  } else {
    // Howl is on for Walmart by default (1.30.40); the direct route is the one with it off.
    db.run("UPDATE attribution_policies SET enabled = 0 WHERE retailer_id = 'walmart'");
  }
  const result = new SignalEngine(db).process({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId: howl ? "walmart-notify-howl-event" : "walmart-notify-direct-event",
    eventType: "restock",
    observedAt: new Date(NOW - 1_000).toISOString(),
    identity: {
      sourceProductId: "walmart-notify-product",
      sourceListingId: "walmart-notify-listing",
      retailerId: "walmart",
      retailerSku: WALMART_ITEM_ID,
      canonicalUrl: `https://www.walmart.com/ip/${WALMART_ITEM_ID}`,
      title: "Walmart Notification Fixture"
    },
    offer: {
      availability: "in_stock",
      unitPriceCents: 8_497,
      currency: "USD",
      sellerName: "Walmart",
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
    // Kevin, 2026-10-13: a call reaches Chrome for its popup and the call log, without a Windows alert.
    assert.equal(lease.notification.alert, false);
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
    assert.equal(notifications.listRecent(10, 0, "pokemon").length, 1);
    assert.equal(notifications.listRecent(10, 0, "walmart").length, 0);
    assert.equal(notifications.listRecent(10, 1).length, 0);
    assert.equal(notifications.recentCount("target"), 1);
    assert.equal(notifications.recentCount("failed"), 0);
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

test("qualified Walmart notifications carry a fresh review-order route with optional Howl attribution", () => {
  for (const howl of [false, true]) {
    const { db, result, device } = walmartNotificationFixture(howl);
    try {
      assert.equal(result.actionJobState, "notify_only");
      const lease = new NotificationRepository(db).leaseNext(device.id, NOW + 200);
      assert.equal(lease.reason, "leased");
      if (lease.reason !== "leased") continue;
      const handoff = lease.notification.purchaseHandoff;
      assert.ok(handoff);
      assert.equal(handoff.walmartItemId, WALMART_ITEM_ID);
      assert.equal(
        handoff.directFallbackUrl,
        `https://www.walmart.com/affil/cart/reviewOrder?items=${WALMART_ITEM_ID}&cn=nc&veh=aff`
      );
      assert.equal(handoff.pdpFallbackUrl, `https://www.walmart.com/ip/${WALMART_ITEM_ID}`);
      assert.equal(handoff.trackingId, `walmart_${WALMART_ITEM_ID}`);
      if (howl) {
        const affiliate = new URL(handoff.destinationUrl);
        assert.equal(affiliate.origin, "https://howl.link");
        assert.equal(affiliate.searchParams.get("url"), handoff.directFallbackUrl);
        assert.equal(affiliate.searchParams.get("u1"), handoff.trackingId);
      } else {
        assert.equal(handoff.destinationUrl, handoff.directFallbackUrl);
      }
      assert.doesNotMatch(handoff.directFallbackUrl, /(?:clickid|nrtv_cid|wmlspartner|sharedid)=/i);
    } finally {
      db.close();
    }
  }
});

test("a dashboard Walmart click closes the delivered Chrome handoff on its assigned device", async () => {
  const { db, result, device } = walmartNotificationFixture(true);
  try {
    const notifications = new NotificationRepository(db);
    const lease = notifications.leaseNext(device.id, NOW + 200);
    assert.equal(lease.reason, "leased");
    if (lease.reason !== "leased") return;
    notifications.acknowledge(
      device.id,
      lease.notification.id,
      lease.notification.capabilityToken,
      "delivered",
      "",
      NOW + 300
    );
    const click = new WalmartPurchaseHandoffInteractionRepository(db).recordClick(
      result.actionJobId,
      "howl",
      NOW + 400,
      "home"
    );
    assert.equal(click.recorded, true);
    assert.equal(click.surface, "home");
    const reconciled = notifications.leaseNext(device.id, NOW + 500);
    assert.equal(reconciled.notification, null);
    assert.deepEqual(reconciled.closedDeliveryIds, [lease.notification.id]);
    const server = createYoinkServer({
      db,
      webRoot: join(process.cwd(), "apps", "web"),
      version: "notification-closure-ack-test"
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const notificationLedger = await fetch(`${baseUrl}/api/v1/admin/notifications?limit=1&offset=0&q=walmart`).then((response) => response.json()) as {
        items: Array<{ retailerId: string }>;
        total: number;
        limit: number;
      };
      assert.equal(notificationLedger.total, 1);
      assert.equal(notificationLedger.limit, 1);
      assert.equal(notificationLedger.items[0]?.retailerId, "walmart");
      const emptyNotificationPage = await fetch(`${baseUrl}/api/v1/admin/notifications?limit=1&offset=1&q=walmart`).then((response) => response.json()) as {
        items: unknown[];
        total: number;
      };
      assert.equal(emptyNotificationPage.total, 1);
      assert.deepEqual(emptyNotificationPage.items, []);
      const attributionLedger = await fetch(`${baseUrl}/api/v1/admin/attribution-receipts?limit=10&offset=0&q=howl`).then((response) => response.json()) as {
        items: Array<{ provider: string }>;
        total: number;
      };
      assert.equal(attributionLedger.total, 1);
      assert.equal(attributionLedger.items[0]?.provider, "howl");
      const response = await fetch(
        `${baseUrl}/api/v1/devices/self/notifications/closures/ack`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${device.token}`,
            "Content-Type": "application/json",
            Origin: `chrome-extension://${"d".repeat(32)}`
          },
          body: JSON.stringify({ contractVersion: 1, deliveryIds: reconciled.closedDeliveryIds })
        }
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { closures: { acknowledged: 1 } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    assert.deepEqual(notifications.leaseNext(device.id, NOW + 700).closedDeliveryIds, []);
    assert.equal(notifications.listRecent()[0]?.state, "clicked");
  } finally {
    db.close();
  }
});

test("Walmart notification delivery falls back to the PDP contract when trusted offer evidence is unavailable", () => {
  const { db, device } = walmartNotificationFixture();
  try {
    db.run("UPDATE source_connections SET trust_level = 'informational' WHERE id = 'source_trackalacker_local'");
    const lease = new NotificationRepository(db).leaseNext(device.id, NOW + 200);
    assert.equal(lease.reason, "leased");
    if (lease.reason !== "leased") return;
    assert.equal(lease.notification.purchaseHandoff, null);
    assert.equal(lease.notification.canonicalUrl, `https://www.walmart.com/ip/${WALMART_ITEM_ID}`);
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
