import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createActionJobAvailabilityPulse, type ActionJobAvailabilityPulse } from "../apps/api/src/action-job-availability.js";
import { operationalRouteKey, resolveApiRoutePolicy } from "../apps/api/src/api-route-policy.js";
import { createYoinkServer } from "../apps/api/src/app.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { OPERATIONAL_ROUTE_KEYS } from "../packages/database/src/operational-telemetry-repository.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope } from "../packages/database/src/request-scope.js";
import { SourceRepository } from "../packages/database/src/source-repository.js";

// The API reads the wall clock, so fixtures are stamped relative to it.
const VERSION = "0.99.0";
const DAY_MS = 24 * 60 * 60_000;
const iso = (time: number) => new Date(time).toISOString();

type Json = Record<string, any>;

async function withServer<T>(
  db: YoinkDatabase,
  run: (baseUrl: string) => Promise<T>,
  actionJobAvailability: ActionJobAvailabilityPulse = createActionJobAvailabilityPulse()
): Promise<T> {
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: VERSION, actionJobAvailability });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Json }> {
  const response = await fetch(url, { headers });
  return { status: response.status, body: await response.json() as Json };
}

async function postTestAlert(baseUrl: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${baseUrl}/api/v1/user/delivery-health/test-alert`, {
    method: "POST",
    headers: { "X-Yoink-Request": "1", "Content-Type": "application/json" },
    body: "{}"
  });
  return { status: response.status, body: await response.json() as Json };
}

function inScope<T>(run: () => T): T {
  return runWithRequestScope(LOCAL_REQUEST_SCOPE, run);
}

/** A current, notification-capable companion that checked in just now. */
function pairCompanion(db: YoinkDatabase, now = Date.now()): { id: string; token: string } {
  return inScope(() => {
    const devices = new DeviceRepository(db);
    const paired = devices.pair({
      pairingCode: devices.createPairingCode(now).code,
      extensionVersion: VERSION,
      capabilities: { notifications: true, jobReconciliation: true }
    }, now);
    return { id: paired.id, token: paired.token };
  });
}

/** One notify-only plan on a TrackaLacker catalog listing (the import stores the source as "connected"). */
function saveNotifyPlan(db: YoinkDatabase, now = Date.now()): void {
  inScope(() => {
    const listing = new CatalogRepository(db).upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "delivery-health-product",
      sourceListingId: "delivery-health-listing",
      title: "Delivery Health Fixture",
      retailerId: "target",
      retailerSku: "95280894",
      canonicalUrl: "https://www.target.com/p/-/A-95280894",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 5_999,
      currency: "USD"
    }, now);
    new ControlRepository(db).createConfiguredMission({
      contractVersion: 1,
      listingId: listing.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 5_999,
      maxAllInCents: 10_000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    } as never, now);
  });
}

/** A push registration the companion reported once, a month ago, and never refreshed. */
function registerOldPush(db: YoinkDatabase, deviceId: string, now = Date.now()): void {
  const then = now - 30 * DAY_MS;
  inScope(() => new SourceRepository(db).recordTrackalackerPushStatus(deviceId, {
    state: "ready",
    ready: true,
    subscriptionPresent: true,
    pendingSignals: 0,
    lastHttpStatus: 201,
    errorCode: "",
    lastRegistrationAt: iso(then),
    lastNotificationAt: iso(then),
    lastDeliveryAt: iso(then),
    updatedAt: iso(then)
  }, then));
}

function trackalacker(sources: Json[]): Json {
  const source = sources.find((item) => item.source === "trackalacker");
  assert.ok(source, "the TrackaLacker source is listed");
  return source;
}

test("overview, user health, the delivery-health route and the admin snapshot carry receipt-backed delivery health (W2)", async () => {
  const db = new YoinkDatabase();
  try {
    saveNotifyPlan(db);
    const companion = pairCompanion(db);
    await withServer(db, async (baseUrl) => {
      const overview = (await getJson(`${baseUrl}/api/v1/user/overview`)).body;
      assert.equal(overview.deliveryHealth.contractVersion, 1);
      assert.equal(overview.deliveryHealth.channel.pairedDevices, 1);
      assert.equal(overview.deliveryHealth.channel.onlineDevices, 1);
      // Online but it has never asked for calls: a status word with a receipt, not "connected".
      assert.equal(overview.deliveryHealth.channel.pollState, "never");
      assert.equal(overview.deliveryHealth.headline, "Chrome is not asking Yoink for calls.");
      assert.deepEqual(overview.deliveryHealth.receipts.map((receipt: Json) => receipt.key),
        ["signal", "job", "lease", "delivered", "cart_ready"]);

      const health = (await getJson(`${baseUrl}/api/v1/user/health`)).body;
      assert.equal(health.deliveryHealth.contractVersion, 1);
      const route = await getJson(`${baseUrl}/api/v1/user/delivery-health`);
      assert.equal(route.status, 200);
      assert.equal(route.body.deliveryHealth.headline, overview.deliveryHealth.headline);

      for (const path of ["/api/v1/admin/snapshot", "/api/v1/admin/snapshot?view=overview"]) {
        const snapshot = (await getJson(`${baseUrl}${path}`)).body;
        assert.equal(snapshot.deliveryHealth.contractVersion, 1, path);
        assert.equal(snapshot.deliveryHealth.channel.pollState, "never", path);
        assert.ok(trackalacker(snapshot.sources).freshness, `${path} sources are decorated`);
      }

      // The companion's lease stamps the poll receipt, and the next read says so.
      const lease = await getJson(`${baseUrl}/api/v1/devices/self/notifications/next`, { Authorization: `Bearer ${companion.token}` });
      assert.equal(lease.status, 200);
      const after = (await getJson(`${baseUrl}/api/v1/user/delivery-health`)).body.deliveryHealth;
      assert.equal(after.channel.pollState, "polling");
      assert.ok(after.channel.lastPollAt);
    });
  } finally {
    db.close();
  }
});

test("a stored-connected TrackaLacker source whose push went quiet is served as stale everywhere (E-03)", async () => {
  const db = new YoinkDatabase();
  try {
    saveNotifyPlan(db);
    const companion = pairCompanion(db);
    registerOldPush(db, companion.id);
    assert.equal(db.get<{ status: string }>(
      "SELECT status FROM source_connections WHERE id = 'source_trackalacker_local'"
    )?.status, "connected", "the stored bit still says connected");
    await withServer(db, async (baseUrl) => {
      const overview = (await getJson(`${baseUrl}/api/v1/user/overview`)).body;
      const source = trackalacker(overview.sources);
      assert.equal(source.status, "stale");
      assert.equal(source.storedStatus, "connected");
      assert.equal(source.freshness.state, "stale");
      assert.equal(source.freshness.recovery?.code, "reconnect_source");
      assert.match(source.freshness.detail, /No push, delivery, or registration from TrackaLacker/);

      // The online companion makes browser observations "connected", but it
      // does not stand in for the quiet feed: setup and plan readiness both
      // ask to reconnect tracking.
      assert.equal(overview.sources.find((item: Json) => item.source === "browser")?.status, "connected");
      const signalStep = overview.setup.steps.find((step: Json) => step.id === "signal");
      assert.notEqual(signalStep.state, "complete");
      assert.equal(signalStep.title, "Reconnect your product tracking");
      assert.equal(overview.setup.level, "needs_signal");
      const readiness = overview.purchaseIntents[0].automationReadiness;
      assert.equal(readiness.state, "needs_signal");
      assert.equal(readiness.headline, "Reconnect your product tracking");

      for (const path of ["/api/v1/admin/snapshot", "/api/v1/admin/snapshot?view=overview", "/api/v1/admin/snapshot?view=connections"]) {
        const snapshot = (await getJson(`${baseUrl}${path}`)).body;
        assert.equal(trackalacker(snapshot.sources).status, "stale", path);
      }
    });
  } finally {
    db.close();
  }
});

test("without a push registration TrackaLacker is served as disconnected, whatever the stored bit says", async () => {
  const db = new YoinkDatabase();
  try {
    saveNotifyPlan(db);
    pairCompanion(db);
    db.run("UPDATE source_connections SET status = 'connected', last_event_at = ? WHERE id = 'source_trackalacker_local'", iso(Date.now()));
    await withServer(db, async (baseUrl) => {
      const overview = (await getJson(`${baseUrl}/api/v1/user/overview`)).body;
      const source = trackalacker(overview.sources);
      assert.equal(source.storedStatus, "connected");
      assert.equal(source.status, "disconnected");
      assert.equal(source.freshness.state, "unknown");
      assert.equal(source.freshness.recovery?.code, "reconnect_source");
      const signalStep = overview.setup.steps.find((step: Json) => step.id === "signal");
      assert.equal(signalStep.title, "Connect your product tracking");
    });
  } finally {
    db.close();
  }
});

test("a test alert needs a plan and a paired companion, wakes held polls, and reaches Chrome through the lease", async () => {
  const db = new YoinkDatabase();
  const pulse = createActionJobAvailabilityPulse();
  let wakes = 0;
  const countingPulse: ActionJobAvailabilityPulse = { ...pulse, notify: (options) => { wakes += 1; return pulse.notify(options); } };
  try {
    await withServer(db, async (baseUrl) => {
      const noPlan = await postTestAlert(baseUrl);
      assert.equal(noPlan.status, 409);
      assert.equal(noPlan.body.error, "test_alert_needs_plan");

      saveNotifyPlan(db);
      const noCompanion = await postTestAlert(baseUrl);
      assert.equal(noCompanion.status, 409);
      assert.equal(noCompanion.body.error, "test_alert_needs_device");

      const companion = pairCompanion(db);
      const wakesBefore = wakes;
      const created = await postTestAlert(baseUrl);
      assert.equal(created.status, 201);
      assert.ok(wakes > wakesBefore, "creating the alert wakes held companion long-polls");
      const { testAlert, deliveryHealth } = created.body;
      assert.match(testAlert.jobId, /^action_job_/);
      assert.ok(testAlert.deliveryId);
      assert.equal(testAlert.title, "Delivery Health Fixture");
      assert.ok(Date.parse(testAlert.expiresAt) > Date.now());
      assert.equal(deliveryHealth.testAlert.deliveryId, testAlert.deliveryId);
      assert.equal(deliveryHealth.testAlert.state, "pending");

      const lease = await getJson(`${baseUrl}/api/v1/devices/self/notifications/next`, { Authorization: `Bearer ${companion.token}` });
      assert.equal(lease.status, 200);
      assert.equal(lease.body.notification?.id, testAlert.deliveryId);
      assert.match(lease.body.notification?.title ?? "", /^Test alert · /);

      const after = (await getJson(`${baseUrl}/api/v1/user/delivery-health`)).body.deliveryHealth;
      assert.equal(after.testAlert.state, "leased");
      assert.equal(after.channel.pollState, "polling");
      // A test ping is not a call: it never counts as a delivered or expired call.
      assert.equal(after.notifications.created, 0);
    }, countingPulse);
  } finally {
    db.close();
  }
});

test("the delivery-health routes are classified user routes with a settings telemetry identity", async () => {
  const cases = [
    ["GET", "/api/v1/user/delivery-health", "user.read"],
    ["POST", "/api/v1/user/delivery-health/test-alert", "user.settings.manage"]
  ] as const;
  for (const [method, path, permission] of cases) {
    const policy = resolveApiRoutePolicy(method, path);
    assert.ok(policy, path);
    assert.equal(policy.pathname, path);
    assert.equal(policy.surface, "user");
    assert.equal(policy.permission, permission);
    assert.equal(policy.classified, true);
    assert.equal(policy.surfaceMismatch, false);
    const routeKey = operationalRouteKey(path, policy);
    assert.equal(routeKey, "user.settings");
    assert.equal(OPERATIONAL_ROUTE_KEYS.includes(routeKey), true);
  }

  // Like every other user mutation, the test alert refuses a plain form post.
  const db = new YoinkDatabase();
  try {
    await withServer(db, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/user/delivery-health/test-alert`, { method: "POST" });
      assert.equal(response.status, 403);
      assert.equal((await response.json() as Json).error, "mutation_header_required");
    });
  } finally {
    db.close();
  }
});
