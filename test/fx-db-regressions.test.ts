import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  TARGET_ADD_ADAPTER_VERSION,
  type MissionUpdateInput,
  type PurchaseIntentPolicy,
  type SignalEventInput
} from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { DATA_DIRECTORY_LOCK_FILE } from "../packages/database/src/data-directory-lock.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeliveryHealthRepository } from "../packages/database/src/delivery-health-repository.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { SignalRepository } from "../packages/database/src/signal-repository.js";
import { ExecutionRepository } from "../packages/database/src/execution-repository.js";
import { NotificationRepository } from "../packages/database/src/notification-repository.js";
import { runWithRequestScope } from "../packages/database/src/request-scope.js";
import { SignalHistoryRetentionRepository } from "../packages/database/src/signal-history-retention-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { enablePlansFromCalls } from "./helpers/plans-from-calls.js";

const NOW = new Date("2026-09-20T12:00:00.000Z").getTime();

function targetSignal(externalEventId: string, overrides: Partial<SignalEventInput["offer"]> = {}, observedAt = NOW - 1_000): SignalEventInput {
  return {
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId,
    eventType: "restock",
    observedAt: new Date(observedAt).toISOString(),
    identity: {
      sourceProductId: "fxdb-product-1",
      sourceListingId: "fxdb-listing-1",
      retailerId: "target",
      retailerSku: "1011483414",
      canonicalUrl: "https://www.target.com/p/-/A-1011483414",
      title: "FX-DB Target Product"
    },
    offer: {
      availability: "in_stock",
      unitPriceCents: 5000,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      orderLimit: 1,
      fulfillment: "shipping",
      ...overrides
    },
    parserVersion: "fxdb-test-v1"
  };
}

/** A reviewed direct Target add plan in live mode with a paired add-capable device. */
function cartPlan(db: YoinkDatabase) {
  const listing = new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "fxdb-product-1",
    sourceListingId: "fxdb-listing-1",
    title: "FX-DB Target Product",
    retailerId: "target",
    retailerSku: "1011483414",
    canonicalUrl: "https://www.target.com/p/-/A-1011483414",
    listingStatus: "out_of_stock",
    executionSupported: true,
    msrpCents: 5999,
    currency: "USD"
  }, NOW);
  const control = new ControlRepository(db);
  control.createConfiguredMission({
    contractVersion: 1,
    listingId: listing.listing.id,
    targetQuantity: 1,
    maxUnitPriceCents: 5999,
    maxAllInCents: 10_000,
    actionCeiling: "add_to_cart",
    sellerPolicy: "first_party_only",
    fulfillment: "shipping",
    substitutionPolicy: "exact_only",
    cooldownSeconds: 0,
    confirmation: "CREATE_EXACT_PURCHASE_PLAN"
  }, NOW);
  control.replaceStrategies([], NOW);
  db.run(
    `INSERT INTO retailer_adapter_qualifications(
       tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
       evidence_hash, qualified_at, updated_at, expires_at
     ) VALUES (?, ?, 'target', ?, 'add_to_cart', 'qualified', 'fxdb-evidence', ?, ?, ?)`,
    LOCAL_TENANT_ID,
    LOCAL_USER_ID,
    TARGET_ADD_ADAPTER_VERSION,
    new Date(NOW).toISOString(),
    new Date(NOW).toISOString(),
    new Date(NOW + 30 * 24 * 60 * 60_000).toISOString()
  );
  db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  const device = devices.pair({
    pairingCode: code.code,
    capabilities: {
      readiness: true,
      jobReconciliation: true,
      notifications: true,
      targetAddOnly: true,
      targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION
    }
  }, NOW + 100);
  return { control, deviceId: device.id, execution: new ExecutionRepository(db) };
}

function setPlanStatus(control: ControlRepository, missionId: string, status: "active" | "paused", now: number) {
  const plan = control.missionDetail(missionId) as Record<string, unknown>;
  return control.updateMission(missionId, {
    status,
    targetQuantity: plan.targetQuantity,
    targets: plan.targets,
    policy: {
      expectedRevision: (plan.intentPolicy as PurchaseIntentPolicy).revision,
      changeReason: "FX-DB regression test status change."
    }
  } as MissionUpdateInput, now);
}

test("pausing a plan cancels its queued cart job and the lease never returns it (C06)", () => {
  const db = new YoinkDatabase();
  try {
    const { control, deviceId, execution } = cartPlan(db);
    const processed = new SignalEngine(db).process(targetSignal("fxdb-pause-1"), NOW);
    assert.equal(processed.actionJobState, "awaiting_executor");
    const missionId = String(db.get<{ id: string }>("SELECT mission_id AS id FROM action_jobs WHERE id = ?", processed.actionJobId)?.id);
    setPlanStatus(control, missionId, "paused", NOW + 500);
    const job = db.get<{ state: string }>("SELECT state FROM action_jobs WHERE id = ?", processed.actionJobId);
    assert.equal(job?.state, "cancelled");
    assert.equal(db.get<{ reason: string }>(
      "SELECT reason_code AS reason FROM action_events WHERE job_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      processed.actionJobId
    )?.reason, "plan_paused");
    assert.deepEqual(execution.leaseNextJob(deviceId, NOW + 1_000), { job: null, reason: "no_jobs" });
  } finally {
    db.close();
  }
});

test("the job lease query requires an active plan and an enabled target (C06 defence in depth)", () => {
  const db = new YoinkDatabase();
  try {
    const { deviceId, execution } = cartPlan(db);
    const processed = new SignalEngine(db).process(targetSignal("fxdb-pause-2"), NOW);
    assert.equal(processed.actionJobState, "awaiting_executor");
    db.run("UPDATE missions SET status = 'paused' WHERE id = (SELECT mission_id FROM action_jobs WHERE id = ?)", processed.actionJobId);
    assert.deepEqual(execution.leaseNextJob(deviceId, NOW + 1_000), { job: null, reason: "no_jobs" });
    db.run("UPDATE missions SET status = 'active' WHERE id = (SELECT mission_id FROM action_jobs WHERE id = ?)", processed.actionJobId);
    db.run("UPDATE mission_targets SET enabled = 0 WHERE id = (SELECT mission_target_id FROM action_jobs WHERE id = ?)", processed.actionJobId);
    assert.deepEqual(execution.leaseNextJob(deviceId, NOW + 1_100), { job: null, reason: "no_jobs" });
    db.run("UPDATE mission_targets SET enabled = 1 WHERE id = (SELECT mission_target_id FROM action_jobs WHERE id = ?)", processed.actionJobId);
    assert.equal(execution.leaseNextJob(deviceId, NOW + 1_200).reason, "leased");
  } finally {
    db.close();
  }
});

function notifyFixture(db: YoinkDatabase) {
  enablePlansFromCalls(db);
  new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "fxdb-notify-product",
    sourceListingId: "fxdb-notify-listing",
    title: "FX-DB Notify Fixture",
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
    externalEventId: "fxdb-notify-event-1",
    eventType: "restock",
    observedAt: new Date(NOW - 1_000).toISOString(),
    identity: {
      sourceProductId: "fxdb-notify-product",
      sourceListingId: "fxdb-notify-listing",
      retailerId: "target",
      retailerSku: "95280894",
      title: "FX-DB Notify Fixture"
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
  const device = devices.pair({ pairingCode: pairing.code, extensionVersion: "0.7.0", capabilities: { notifications: true } }, NOW + 100);
  const missionId = String(db.get<{ id: string }>("SELECT mission_id AS id FROM action_jobs WHERE id = ?", result.actionJobId)?.id);
  return { result, deviceId: device.id, missionId };
}

test("a paused plan's pending call is never leased and pausing expires it as plan_paused (C06)", () => {
  const db = new YoinkDatabase();
  try {
    const { result, deviceId, missionId } = notifyFixture(db);
    assert.equal(result.actionJobState, "notify_only");
    const notifications = new NotificationRepository(db);
    db.run("UPDATE missions SET status = 'paused' WHERE id = ?", missionId);
    assert.equal(notifications.leaseNext(deviceId, NOW + 1_000).reason, "no_notifications");
    db.run("UPDATE missions SET status = 'active' WHERE id = ?", missionId);
    setPlanStatus(new ControlRepository(db), missionId, "paused", NOW + 2_000);
    const delivery = db.get<{ state: string; failureCode: string }>(
      "SELECT state, failure_code AS failureCode FROM notification_deliveries WHERE job_id = ?",
      result.actionJobId
    );
    assert.deepEqual({ ...delivery }, { state: "expired", failureCode: "plan_paused" });
    setPlanStatus(new ControlRepository(db), missionId, "active", NOW + 3_000);
    assert.equal(notifications.leaseNext(deviceId, NOW + 4_000).reason, "no_notifications");
  } finally {
    db.close();
  }
});

test("closing a plan or turning off a listing expires its pending call with a plan code that health never blames on Chrome (FR-05)", () => {
  const updatePlan = (control: ControlRepository, missionId: string, status: string, enabled: boolean, now: number) => {
    const plan = control.missionDetail(missionId) as Record<string, unknown>;
    return control.updateMission(missionId, {
      status,
      targetQuantity: plan.targetQuantity,
      targets: (plan.targets as Array<Record<string, unknown>>).map((target) => ({ ...target, enabled })),
      policy: {
        expectedRevision: (plan.intentPolicy as PurchaseIntentPolicy).revision,
        changeReason: "FX-DB regression test plan change."
      }
    } as MissionUpdateInput, now);
  };
  const deliveryOf = (db: YoinkDatabase, jobId: string) => ({ ...db.get<{ state: string; failureCode: string }>(
    "SELECT state, failure_code AS failureCode FROM notification_deliveries WHERE job_id = ?",
    jobId
  ) });
  for (const [status, enabled, code] of [
    ["active", false, "target_disabled"],
    ["satisfied", true, "plan_satisfied"],
    ["archived", true, "plan_archived"],
    ["paused", true, "plan_paused"]
  ] as const) {
    const db = new YoinkDatabase();
    try {
      const { result, deviceId, missionId } = notifyFixture(db);
      const control = new ControlRepository(db);
      updatePlan(control, missionId, status, enabled, NOW + 1_000);
      assert.deepEqual(deliveryOf(db, result.actionJobId!), { state: "expired", failureCode: code }, code);
      // Expiry recovery after the job window never relabels it as a device failure.
      const notifications = new NotificationRepository(db);
      notifications.recoverExpired(NOW + 48 * 60 * 60_000);
      assert.deepEqual(deliveryOf(db, result.actionJobId!), { state: "expired", failureCode: code }, `${code} after recovery`);
      const health = new DeliveryHealthRepository(db).snapshot({
        devices: new DeviceRepository(db).listDevices(NOW + 2_000), connectors: [], now: NOW + 2_000
      });
      assert.equal(health.notifications.expired, 0, `${code} is not counted as an undelivered call`);
      assert.equal(health.notifications.consecutiveUndelivered, 0, code);
      assert.equal(health.notifications.dominantFailureCode, "", code);
      void deviceId;
    } finally {
      db.close();
    }
  }
  // Re-enabling a listing that was already enabled expires nothing.
  const db = new YoinkDatabase();
  try {
    const { result, missionId } = notifyFixture(db);
    updatePlan(new ControlRepository(db), missionId, "active", true, NOW + 1_000);
    assert.equal(deliveryOf(db, result.actionJobId!).state, "pending");
  } finally {
    db.close();
  }
});

test("a confirmed unit that satisfies the plan expires its other pending calls as plan_satisfied (FR-05)", () => {
  const db = new YoinkDatabase();
  try {
    const { result, missionId } = notifyFixture(db);
    // Simulate the satisfied transition the order-confirmation path performs.
    const signals = new SignalRepository(db) as unknown as {
      expireNotificationsIfSatisfied(missionId: string, wasActive: boolean, now: number): void;
    };
    db.run("UPDATE missions SET status = 'satisfied' WHERE id = ?", missionId);
    signals.expireNotificationsIfSatisfied(missionId, true, NOW + 1_000);
    assert.deepEqual({ ...db.get<{ state: string; failureCode: string }>(
      "SELECT state, failure_code AS failureCode FROM notification_deliveries WHERE job_id = ?",
      result.actionJobId
    ) }, { state: "expired", failureCode: "plan_satisfied" });
  } finally {
    db.close();
  }
});

test("both lease paths stamp the device poll receipt, so expiry is not mislabelled no_device_poll (C16)", () => {
  const db = new YoinkDatabase();
  try {
    const { deviceId } = notifyFixture(db);
    const pollColumns = () => db.get<{ n: string; j: string }>(
      "SELECT last_notification_poll_at AS n, last_job_poll_at AS j FROM extension_devices WHERE id = ?",
      deviceId
    );
    assert.deepEqual({ ...pollColumns() }, { n: "", j: "" });
    assert.equal(new NotificationRepository(db).leaseNext(deviceId, NOW + 1_000).reason, "leased");
    assert.equal(pollColumns()?.n, new Date(NOW + 1_000).toISOString());
    // Shadow mode still answers the poll, and the poll is still receipted.
    assert.equal(new ExecutionRepository(db).leaseNextJob(deviceId, NOW + 2_000).reason, "shadow_mode");
    assert.equal(pollColumns()?.j, new Date(NOW + 2_000).toISOString());
  } finally {
    db.close();
  }
});

test("an expired call after a real poll is job_window_expired, not no_device_poll", () => {
  const db = new YoinkDatabase();
  try {
    const { result, deviceId } = notifyFixture(db);
    db.run("UPDATE extension_devices SET capabilities_json = '{}' WHERE id = ?", deviceId);
    const notifications = new NotificationRepository(db);
    assert.equal(notifications.leaseNext(deviceId, NOW + 1_000).reason, "device_unavailable");
    db.run("UPDATE action_jobs SET expires_at = ? WHERE id = ?", new Date(NOW + 1_500).toISOString(), result.actionJobId);
    notifications.recoverExpired(NOW + 2_000);
    assert.equal(db.get<{ code: string }>(
      "SELECT failure_code AS code FROM notification_deliveries WHERE job_id = ?",
      result.actionJobId
    )?.code, "job_window_expired");
  } finally {
    db.close();
  }
});

test("an unsupported-retailer call at the head of the queue does not hide the deliverable one behind it (DB-18)", () => {
  const db = new YoinkDatabase();
  try {
    const { result, deviceId } = notifyFixture(db);
    const timestamp = new Date(NOW).toISOString();
    db.run(
      "INSERT INTO retailers(id, display_name, created_at, updated_at) VALUES ('fxdbstore', 'FX-DB Store', ?, ?)",
      timestamp,
      timestamp
    );
    // Clone the real job onto an unsupported store listing, queued first.
    db.run(
      `INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, created_at, updated_at)
       SELECT 'listing_fxdb_unsupported', variant_id, 'fxdbstore', 'FX1', 'https://fxdb.example/p/1', created_at, updated_at
       FROM listings WHERE id = (SELECT listing_id FROM action_jobs WHERE id = ?)`,
      result.actionJobId
    );
    const columns = db.all<{ name: string }>("PRAGMA table_info(action_jobs)").map((column) => column.name);
    const select = columns.map((name) => name === "id" ? "'action_job_fxdb_unsupported'"
      : name === "listing_id" ? "'listing_fxdb_unsupported'"
      : name === "idempotency_key" ? "'fxdb-unsupported-key'"
      : name === "offer_snapshot_id" ? "NULL"
      : name === "spend_reservation_id" ? "NULL"
      : name).join(", ");
    db.run(`INSERT INTO action_jobs(${columns.join(", ")}) SELECT ${select} FROM action_jobs WHERE id = ?`, result.actionJobId);
    db.run(
      `INSERT INTO notification_deliveries(id, tenant_id, user_id, job_id, state, created_at, updated_at)
       VALUES ('notification_fxdb_unsupported', ?, ?, 'action_job_fxdb_unsupported', 'pending', ?, ?)`,
      LOCAL_TENANT_ID,
      LOCAL_USER_ID,
      new Date(NOW - 60_000).toISOString(),
      new Date(NOW - 60_000).toISOString()
    );
    const lease = new NotificationRepository(db).leaseNext(deviceId, NOW + 1_000);
    assert.equal(lease.reason, "leased");
    assert.equal(db.get<{ state: string; code: string }>(
      "SELECT state, failure_code AS code FROM notification_deliveries WHERE id = 'notification_fxdb_unsupported'"
    )?.code, "unsupported_retailer");
  } finally {
    db.close();
  }
});

test("a confirmed cart add still in its handoff window covers the plan quantity (CORE-09)", () => {
  const db = new YoinkDatabase();
  try {
    cartPlan(db);
    const first = new SignalEngine(db).process(targetSignal("fxdb-cart-1"), NOW);
    assert.equal(first.actionJobState, "awaiting_executor");
    // The add succeeded; the shopper has not closed it out yet.
    db.run(
      "UPDATE action_jobs SET state = 'confirmed', expires_at = ? WHERE id = ?",
      new Date(NOW + 35 * 60_000).toISOString(),
      first.actionJobId
    );
    db.run("UPDATE spend_reservations SET status = 'released' WHERE action_job_id = ?", first.actionJobId);
    db.run("UPDATE signal_incidents SET status = 'closed', closed_reason = 'confirmed' WHERE id = (SELECT incident_id FROM action_jobs WHERE id = ?)", first.actionJobId);
    const second = new SignalEngine(db).process(targetSignal("fxdb-cart-2", {}, NOW + 9 * 60_000), NOW + 10 * 60_000);
    assert.notEqual(second.actionJobState, "awaiting_executor");
    const awaiting = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs WHERE state = 'awaiting_executor'");
    assert.equal(awaiting?.count, 0);
    if (second.actionJobId) {
      assert.equal(db.get<{ reason: string }>(
        "SELECT reason_code AS reason FROM action_events WHERE job_id = ? ORDER BY created_at, id LIMIT 1",
        second.actionJobId
      )?.reason, "intent_quantity_in_cart");
    }
  } finally {
    db.close();
  }
});

test("a signal priced in another currency never reaches a cart add (C14 currency guard)", () => {
  const db = new YoinkDatabase();
  try {
    cartPlan(db);
    const processed = new SignalEngine(db).process(targetSignal("fxdb-currency-1", { currency: "JPY" }), NOW);
    assert.notEqual(processed.actionJobState, "awaiting_executor");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs WHERE action = 'add_to_cart'")?.count, 0);
  } finally {
    db.close();
  }
});

test("a corroborating signal on an existing job does not capture an orphan offer snapshot (CORE-10)", () => {
  const db = new YoinkDatabase();
  try {
    const { result } = notifyFixture(db);
    const snapshots = () => Number(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM offer_snapshots")?.count);
    const before = snapshots();
    const engine = new SignalEngine(db);
    for (let index = 0; index < 3; index += 1) {
      engine.process({
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker",
        externalEventId: `fxdb-notify-corroborate-${index}`,
        eventType: "restock",
        observedAt: new Date(NOW + index * 1_000).toISOString(),
        identity: {
          sourceProductId: "fxdb-notify-product",
          sourceListingId: "fxdb-notify-listing",
          retailerId: "target",
          retailerSku: "95280894",
          title: "FX-DB Notify Fixture"
        },
        offer: { availability: "in_stock", unitPriceCents: 4499, currency: "USD", sellerName: "Target", sellerType: "first_party", fulfillment: "shipping" }
      }, NOW + index * 1_000 + 500);
    }
    assert.equal(snapshots(), before);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 1);
    assert.ok(result.actionJobId);
  } finally {
    db.close();
  }
});

test("a failed COMMIT leaves transactions usable: depth is restored and the original error surfaces (C19)", () => {
  const db = new YoinkDatabase();
  try {
    db.exec("CREATE TABLE fxdb_parent (id TEXT PRIMARY KEY) STRICT; CREATE TABLE fxdb_child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES fxdb_parent(id)) STRICT;");
    assert.throws(() => db.transaction(() => {
      db.exec("PRAGMA defer_foreign_keys = ON");
      db.run("INSERT INTO fxdb_child(id, parent_id) VALUES ('child', 'missing')");
    }), /FOREIGN KEY/i);
    assert.equal(db.connection.isTransaction, false);
    // A nested transaction must still open with BEGIN IMMEDIATE and commit.
    db.transaction(() => {
      db.run("INSERT INTO fxdb_parent(id) VALUES ('parent')");
      db.transaction(() => db.run("INSERT INTO fxdb_child(id, parent_id) VALUES ('child', 'parent')"));
    });
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM fxdb_child")?.count, 1);
    // An error thrown after SQLite already rolled back is not replaced by "no transaction is active".
    assert.throws(() => db.transaction(() => {
      db.exec("ROLLBACK");
      throw new Error("original failure");
    }), /original failure/);
    db.transaction(() => db.run("INSERT INTO fxdb_parent(id) VALUES ('parent-2')"));
    assert.equal(db.connection.isTransaction, false);
  } finally {
    db.close();
  }
});

test("startup pruning keeps one copy per migration target and never touches manual or foreign files (DB-11)", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-fxdb-backups-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    new YoinkDatabase(filePath).close();
    const fixtures = [
      ["before-v68.2026-09-01T00-00-00-000Z.sqlite", "2026-09-01T00:00:00.000Z"],
      ["before-v69.2026-09-02T00-00-00-000Z.sqlite", "2026-09-02T00:00:00.000Z"],
      ["before-v69.2026-09-03T00-00-00-000Z.sqlite", "2026-09-03T00:00:00.000Z"],
      ["before-v69.2026-09-04T00-00-00-000Z.sqlite", "2026-09-04T00:00:00.000Z"],
      ["manual.2026-08-01T00-00-00-000Z.sqlite", "2026-08-01T00:00:00.000Z"],
      ["manual.2026-08-02T00-00-00-000Z.sqlite", "2026-08-02T00:00:00.000Z"],
      ["manual.2026-08-03T00-00-00-000Z.sqlite", "2026-08-03T00:00:00.000Z"],
      ["manual.2026-08-04T00-00-00-000Z.sqlite", "2026-08-04T00:00:00.000Z"],
      ["bak", "2026-07-01T00:00:00.000Z"],
      ["pre-restore", "2026-07-02T00:00:00.000Z"]
    ] as const;
    for (const [suffix, modifiedAt] of fixtures) {
      writeFileSync(`${filePath}.${suffix}`, "fixture");
      utimesSync(`${filePath}.${suffix}`, new Date(modifiedAt), new Date(modifiedAt));
    }
    writeFileSync(`${filePath}.before-v69.2026-09-02T00-00-00-000Z.sqlite-wal`, "fixture");
    const db = new YoinkDatabase(filePath);
    const names = readdirSync(directory).filter((name) => name.startsWith("yoink.sqlite.")).sort();
    assert.deepEqual(names.filter((name) => name.includes("before-v")), [
      "yoink.sqlite.before-v68.2026-09-01T00-00-00-000Z.sqlite",
      "yoink.sqlite.before-v69.2026-09-04T00-00-00-000Z.sqlite"
    ]);
    assert.equal(names.filter((name) => name.includes("manual.")).length, 4);
    assert.ok(names.includes("yoink.sqlite.bak"));
    assert.ok(names.includes("yoink.sqlite.pre-restore"));
    assert.equal(existsSync(`${filePath}.before-v69.2026-09-02T00-00-00-000Z.sqlite-wal`), false);
    // The operator lever may bound manual copies too.
    const receipt = db.pruneBackups(3, { includeManual: true });
    assert.equal(receipt.removed, 1);
    assert.equal(existsSync(`${filePath}.manual.2026-08-01T00-00-00-000Z.sqlite`), false);
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a file-backed migration owner holds the data-directory lock until close (C18/I6)", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-fxdb-lock-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const db = new YoinkDatabase(filePath);
    assert.equal(existsSync(join(directory, DATA_DIRECTORY_LOCK_FILE)), true);
    // Re-entrant in one process: a second owner open shares the reference.
    const second = new YoinkDatabase(filePath);
    second.close();
    assert.equal(existsSync(join(directory, DATA_DIRECTORY_LOCK_FILE)), true);
    db.close();
    assert.equal(existsSync(join(directory, DATA_DIRECTORY_LOCK_FILE)), false);
    // Readers never take it.
    new YoinkDatabase(filePath).close();
    const reader = new YoinkDatabase(filePath, { migrationMode: "require_current" });
    assert.equal(existsSync(join(directory, DATA_DIRECTORY_LOCK_FILE)), false);
    reader.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("signal history retention removes only old evidence nothing live or financial cites (DB-08)", () => {
  const db = new YoinkDatabase();
  try {
    const { result } = notifyFixture(db);
    const oldIso = new Date(NOW - 200 * 24 * 60 * 60_000).toISOString();
    // One old orphan event (no occurrence) and the real event aged but tied to a job.
    const eventColumns = db.all<{ name: string }>("PRAGMA table_info(signal_events)").map((column) => column.name);
    const select = eventColumns.map((name) => name === "id" ? "'signal_event_fxdb_old'"
      : name === "signal_id" ? "'fxdb-old-signal'"
      : name === "external_event_id" ? "'fxdb-old-external'"
      : name === "transport_hash" ? "'fxdb-old-transport'"
      : name === "received_at" ? `'${oldIso}'`
      : name).join(", ");
    db.run(`INSERT INTO signal_events(${eventColumns.join(", ")}) SELECT ${select} FROM signal_events LIMIT 1`);
    db.run("UPDATE signal_events SET received_at = ? WHERE id <> 'signal_event_fxdb_old'", oldIso);
    db.run(
      "UPDATE notification_deliveries SET state = 'expired', updated_at = ? WHERE job_id = ?",
      oldIso,
      result.actionJobId
    );
    const retention = new SignalHistoryRetentionRepository(db);
    assert.throws(() => retention.prune(NOW), /trusted worker scope/);
    const outcome = runWithRequestScope(
      { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID, actorId: "worker", actorKind: "service" },
      () => retention.prune(NOW)
    );
    assert.equal(outcome.deletedSignalEvents, 1);
    assert.equal(outcome.deletedNotificationDeliveries, 1);
    assert.ok(outcome.signalHistoryRetentionReceiptId);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events WHERE id = 'signal_event_fxdb_old'")?.count, 0);
    assert.ok(Number(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events")?.count) >= 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs WHERE id = ?", result.actionJobId)?.count, 1);
  } finally {
    db.close();
  }
});

test("migration 70 indexes serve the hot per-incident and per-user lookups (C21)", () => {
  const db = new YoinkDatabase();
  try {
    const plan = (sql: string, ...params: string[]) => db.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params)
      .map((row) => row.detail).join(" | ");
    assert.match(plan("SELECT id FROM action_jobs WHERE incident_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1", "i", "u"), /action_jobs_incident_idx/);
    assert.match(plan("SELECT id FROM signal_occurrences WHERE incident_id = ?", "i"), /signal_occurrences_incident_idx/);
    assert.match(plan("SELECT id FROM signal_events WHERE user_id = ? ORDER BY received_at DESC LIMIT 50", "u"), /signal_events_user_received_idx/);
    assert.match(plan("SELECT id FROM audit_events WHERE tenant_id = ? AND event_type = ? ORDER BY created_at DESC LIMIT 1", "t", "e"), /audit_events_tenant_type_time_idx/);
    assert.match(plan("SELECT id FROM audit_events WHERE user_id = ? AND event_type = ? ORDER BY created_at DESC LIMIT 1", "u", "e"), /audit_events_user_type_time_idx/);
  } finally {
    db.close();
  }
});
