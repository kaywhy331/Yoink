import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { SignalEventInput } from "../packages/contracts/src/index.js";
import { AuthorizationRepository } from "../packages/database/src/authorization-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { MIGRATIONS } from "../packages/database/src/migrations.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { enablePlansFromCalls } from "./helpers/plans-from-calls.js";

const NOW = new Date("2026-10-01T15:00:00.000Z").getTime();

function unplannedCall(overrides: Partial<SignalEventInput> = {}): SignalEventInput {
  return {
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId: "plans-from-calls-event",
    eventType: "restock",
    observedAt: new Date(NOW - 1_000).toISOString(),
    identity: {
      sourceProductId: "plans-from-calls-product",
      sourceListingId: "plans-from-calls-listing",
      retailerId: "target",
      retailerSku: "95777001",
      canonicalUrl: "https://www.target.com/p/-/A-95777001",
      title: "Plans From Calls Elite Trainer Box"
    },
    offer: {
      availability: "in_stock",
      unitPriceCents: 4999,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      fulfillment: "shipping"
    },
    ...overrides
  };
}

const count = (db: YoinkDatabase, table: string): number =>
  Number(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)?.count ?? 0);

test("plans from calls is a per-user setting that starts off and is read by settings()", () => {
  const db = new YoinkDatabase();
  try {
    const column = db.all<{ name: string; dflt_value: string | null; notnull: number }>("PRAGMA table_info(app_settings)")
      .find((row) => row.name === "plans_from_calls");
    assert.equal(column?.dflt_value, "0");
    assert.equal(column?.notnull, 1);
    const control = new ControlRepository(db);
    assert.equal(control.settings().plansFromCalls, false);
    const other = new AuthorizationRepository(db).createTenantUser({ displayName: "Another shopper" });
    assert.equal(db.get<{ value: number }>("SELECT plans_from_calls AS value FROM app_settings WHERE user_id = ?", other.user.id)?.value, 0);
    enablePlansFromCalls(db);
    assert.equal(control.settings().plansFromCalls, true);
    assert.throws(() => db.run("UPDATE app_settings SET plans_from_calls = 2 WHERE user_id = ?", LOCAL_USER_ID), /CHECK constraint/);
  } finally {
    db.close();
  }
});

test("an existing install upgrades with plans from calls off", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-plans-from-calls-upgrade-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("PRAGMA synchronous = OFF;");
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 70)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, "2026-09-26T03:50:40.340Z");
    }
    legacy.prepare("INSERT OR IGNORE INTO app_settings(user_id, updated_at) VALUES (?, ?)").run(LOCAL_USER_ID, "2026-09-26T03:50:40.340Z");
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ version: number }>("SELECT MAX(version) AS version FROM schema_migrations")?.version, 82);
      assert.equal(upgraded.get<{ value: number }>("SELECT plans_from_calls AS value FROM app_settings WHERE user_id = ?", LOCAL_USER_ID)?.value, 0);
      assert.equal(new ControlRepository(upgraded).settings().plansFromCalls, false);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("with plans from calls off, a call for an unplanned item is logged as no_mission and creates no plan", () => {
  const db = new YoinkDatabase();
  try {
    new ControlRepository(db).setActionsPaused(false, "Test enabled actions", NOW);
    const result = new SignalEngine(db).process(unplannedCall(), NOW);
    assert.equal(result.decision, "no_mission");
    assert.equal(result.missionCreated, false);
    assert.equal(result.missionId, "");
    assert.equal(result.actionJobId, "");
    assert.match(result.reason, /calls do not create plans/);
    // The trusted call still grows the catalog; only the plan is withheld.
    assert.equal(count(db, "listings"), 1);
    assert.equal(count(db, "missions"), 0);
    assert.equal(count(db, "action_jobs"), 0);
    assert.equal(count(db, "notification_deliveries"), 0);
    assert.deepEqual({ ...db.get("SELECT outcome, mission_id AS missionId FROM mission_decisions") },
      { outcome: "no_mission", missionId: null });
  } finally {
    db.close();
  }
});

test("with plans from calls on, the same call creates the safe notify-only plan as before", () => {
  const db = new YoinkDatabase();
  try {
    enablePlansFromCalls(db);
    new ControlRepository(db).setActionsPaused(false, "Test enabled actions", NOW);
    const result = new SignalEngine(db).process(unplannedCall(), NOW);
    assert.equal(result.missionCreated, true);
    assert.equal(result.decision, "qualified");
    assert.equal(result.actionJobState, "notify_only");
    assert.deepEqual({ ...db.get("SELECT origin, status FROM missions WHERE id = ?", result.missionId) },
      { origin: "signal:trackalacker", status: "active" });
    assert.equal(db.get<{ ceiling: string }>(
      "SELECT action_ceiling AS ceiling FROM mission_intent_revisions WHERE mission_id = ? ORDER BY revision DESC LIMIT 1",
      result.missionId
    )?.ceiling, "notify");
  } finally {
    db.close();
  }
});
