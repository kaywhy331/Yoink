import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { MIGRATIONS } from "../packages/database/src/migrations.js";

test("initial migration creates the normalized graph and safe local defaults", () => {
  const db = new YoinkDatabase();
  try {
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")?.count, 23);
    assert.equal(db.get<{ name: string }>("SELECT name FROM tenants WHERE id = ?", LOCAL_TENANT_ID)?.name, "Local");
    assert.equal(db.get<{ display_name: string }>("SELECT display_name FROM users WHERE id = ?", LOCAL_USER_ID)?.display_name, "Local user");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailers")?.count, 13);
    assert.equal(db.get<{ execution_supported: number }>("SELECT execution_supported FROM retailers WHERE id = 'bestbuy'")?.execution_supported, 0);
    assert.equal(db.get<{ execution_supported: number }>("SELECT execution_supported FROM retailers WHERE id = 'amazon'")?.execution_supported, 0);
    assert.equal(db.get<{ execution_supported: number }>("SELECT execution_supported FROM retailers WHERE id = 'walmart'")?.execution_supported, 0);
    assert.equal(db.get<{ actions_paused: number }>("SELECT actions_paused FROM app_settings WHERE user_id = ?", LOCAL_USER_ID)?.actions_paused, 1);
    assert.equal(db.get<{ execution_mode: string }>("SELECT execution_mode FROM app_settings WHERE user_id = ?", LOCAL_USER_ID)?.execution_mode, "shadow");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM strategies")?.count, 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM attribution_policies")?.count, 13);
    assert.equal(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM retailers
      WHERE id IN ('disney', 'ravensburger', 'riot', 'booksamillion', 'fanatics', 'kohls', 'macys', 'pbandai', 'pokemoncenter')
        AND execution_supported = 0`)?.count, 9);
    assert.equal(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'community_contribution_consents', 'community_contribution_nonces',
        'community_inventory_assertions', 'community_contribution_receipts',
        'identity_equivalence_claims', 'identity_claim_reviews',
        'observer_recipe_candidates', 'observer_recipe_trials',
        'observer_recipe_lifecycle_events', 'inbox_messages',
        'hosted_delivery_receipts', 'hosted_request_nonces'
      )`)?.count, 12);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM authorization_permissions")?.count, 24);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM authorization_roles")?.count, 7);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM authorization_memberships WHERE user_id = ? AND role_id = 'yoink_user' AND status = 'active'",
      LOCAL_USER_ID
    )?.count, 1);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'catalog_change_proposals'"
    )?.count, 1);
    assert.equal(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'exact_offer_keys', 'mission_intent_revisions', 'offer_snapshots',
        'user_spend_policies', 'spend_reservations', 'spend_ledger_entries'
      )`)?.count, 6);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM user_spend_policies WHERE user_id = ? AND order_submission_enabled = 0",
      LOCAL_USER_ID
    )?.count, 1);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("a file database reopens idempotently", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-db-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const first = new YoinkDatabase(filePath);
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    first.run("UPDATE app_settings SET pause_reason = 'Preserved' WHERE user_id = ?", LOCAL_USER_ID);
    first.close();

    const second = new YoinkDatabase(filePath);
    try {
      assert.equal(second.get<{ pause_reason: string }>("SELECT pause_reason FROM app_settings WHERE user_id = ?", LOCAL_USER_ID)?.pause_reason, "Preserved");
      assert.equal(second.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")?.count, 23);
      second.assertIntegrity();
    } finally {
      second.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an existing 0.2 database upgrades transactionally to shadow observations and add rehearsals", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-db-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;`);
    for (const migration of MIGRATIONS.filter((item) => item.version <= 2)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-22T00:00:00.000Z"
      );
    }
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")?.count, 23);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_shadow_observations")?.count, 0);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_adapter_trials")?.count, 0);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_adapter_diagnostics")?.count, 0);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM notification_deliveries")?.count, 0);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM attribution_policies")?.count, 13);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM source_sync_runs")?.count, 0);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM community_inventory_assertions")?.count, 0);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM identity_equivalence_claims")?.count, 0);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM observer_recipe_candidates")?.count, 0);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM inbox_messages")?.count, 0);
      assert.equal(upgraded.get<{ name: string }>("SELECT name FROM tenants WHERE id = ?", LOCAL_TENANT_ID)?.name, "Local");
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 11 closes any inherited Best Buy execution and qualification state", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-bestbuy-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;`);
    for (const migration of MIGRATIONS.filter((item) => item.version <= 10)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-23T00:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at)
      VALUES ('bestbuy', 'Best Buy', 1, '["bestbuy.com"]', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z');
      UPDATE retailers SET execution_supported = 1 WHERE id = 'bestbuy';
      INSERT INTO retailer_adapter_qualifications(
        retailer_id, adapter_version, highest_action, status,
        evidence_hash, qualified_at, updated_at
      ) VALUES (
        'bestbuy', 'unversioned-bestbuy-runner', 'add_to_cart', 'qualified',
        'legacy-evidence', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z'
      );
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")?.count, 23);
      assert.equal(upgraded.get<{ execution_supported: number }>("SELECT execution_supported FROM retailers WHERE id = 'bestbuy'")?.execution_supported, 0);
      assert.equal(upgraded.get<{ status: string }>("SELECT status FROM retailer_adapter_qualifications WHERE retailer_id = 'bestbuy'")?.status, "retired");
      assert.equal(upgraded.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name IN (
        'retailer_shadow_observations_bestbuy_gate_idx', 'retailer_adapter_trials_bestbuy_gate_idx'
      )`)?.count, 2);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 19 retires Best Buy v2 qualification before the v4/v3 boundary", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-bestbuy-v4-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;`);
    for (const migration of MIGRATIONS.filter((item) => item.version <= 18)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-24T00:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at)
      VALUES ('bestbuy', 'Best Buy', 1, '["bestbuy.com"]', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO retailer_adapter_qualifications(
        tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
        evidence_hash, qualified_at, updated_at
      ) VALUES (
        'tenant_local', 'user_local', 'bestbuy', 'bestbuy-add-v2', 'add_to_cart', 'qualified',
        'v2-evidence', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'
      );
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")?.count, 23);
      assert.equal(upgraded.get<{ execution_supported: number }>("SELECT execution_supported FROM retailers WHERE id = 'bestbuy'")?.execution_supported, 0);
      assert.equal(upgraded.get<{ status: string }>(
        "SELECT status FROM retailer_adapter_qualifications WHERE user_id = 'user_local' AND retailer_id = 'bestbuy'"
      )?.status, "retired");
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 22 backfills existing missions into immutable intent and spend policy", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-intent-ledger-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 21)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-24T00:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at)
      VALUES ('target', 'Target', 1, '["target.com"]', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO product_families(id, title, brand, created_at, updated_at)
      VALUES ('family_upgrade', 'Upgrade product', '', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
      VALUES ('variant_upgrade', 'family_upgrade', 'Upgrade product blue', '{"color":"Blue"}', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status, execution_supported, msrp_cents, currency, created_at, updated_at)
      VALUES ('listing_upgrade', 'variant_upgrade', 'target', '95280894', 'https://www.target.com/p/-/A-95280894', 'in_stock', 1, 4999, 'USD', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO missions(id, tenant_id, user_id, variant_id, status, origin, target_quantity, fulfilled_quantity, created_at, updated_at)
      VALUES ('mission_upgrade', 'tenant_local', 'user_local', 'variant_upgrade', 'active', 'fixture', 2, 0, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO mission_targets(id, mission_id, listing_id, enabled, max_unit_price_cents, currency, seller_policy, fulfillment, created_at, updated_at)
      VALUES ('mission_target_upgrade', 'mission_upgrade', 'listing_upgrade', 1, 4500, 'USD', 'first_party_only', 'shipping', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      const policy = upgraded.get<{ revision: number; quantity: number; action: string; targets: string }>(
        `SELECT revision, quantity, action_ceiling AS action, target_policy_json AS targets
         FROM mission_intent_revisions WHERE mission_id = 'mission_upgrade'`
      );
      assert.equal(policy?.revision, 1);
      assert.equal(policy?.quantity, 2);
      assert.equal(policy?.action, "add_to_cart");
      assert.deepEqual(JSON.parse(policy?.targets ?? "[]"), [{
        targetId: "mission_target_upgrade",
        listingId: "listing_upgrade",
        retailerId: "target",
        enabled: true,
        maxUnitPriceCents: 4500,
        sellerPolicy: "first_party_only",
        fulfillment: "shipping"
      }]);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM user_spend_policies WHERE user_id = 'user_local' AND order_submission_enabled = 0"
      )?.count, 1);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 23 adds reversible catalog identity governance without changing existing catalog topology", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-catalog-identity-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 22)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-24T00:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at)
      VALUES ('target', 'Target', 0, '["target.com"]', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO product_families(id, title, brand, created_at, updated_at)
      VALUES ('family_identity_upgrade', 'Preserved product', 'Example', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
      VALUES ('variant_identity_upgrade', 'family_identity_upgrade', 'Preserved product', '{"edition":"Standard"}', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status, execution_supported, currency, created_at, updated_at)
      VALUES ('listing_identity_upgrade', 'variant_identity_upgrade', 'target', '92345678', 'https://www.target.com/p/-/A-92345678', 'out_of_stock', 0, 'USD', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 23 AND name = 'reversible_catalog_identity_governance'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'catalog_identity_operations', 'catalog_identity_operation_snapshots', 'catalog_identity_operation_events'
        )`)?.count, 3);
      assert.equal(upgraded.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'trigger' AND name IN (
          'catalog_identity_operation_snapshots_no_update', 'catalog_identity_operation_snapshots_no_delete',
          'catalog_identity_operation_events_no_update', 'catalog_identity_operation_events_no_delete'
        )`)?.count, 4);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM authorization_permissions WHERE id IN ('catalog.identity.propose', 'catalog.identity.approve')"
      )?.count, 2);
      assert.equal(upgraded.get<{ count: number }>(`SELECT COUNT(*) AS count FROM authorization_role_permissions
        WHERE role_id IN ('catalog_curator', 'tenant_admin')
          AND permission_id IN ('catalog.identity.propose', 'catalog.identity.approve')`)?.count, 4);
      assert.equal(upgraded.get<{ variantId: string }>(
        "SELECT variant_id AS variantId FROM listings WHERE id = 'listing_identity_upgrade'"
      )?.variantId, "variant_identity_upgrade");
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("catalog identity history is immutable during normal operation and purges with its tenant", () => {
  const db = new YoinkDatabase();
  const tenantId = "tenant_identity_lifecycle";
  const at = "2026-08-24T23:00:00.000Z";
  try {
    db.run("INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)", tenantId, "Identity lifecycle", at);
    db.run(
      `INSERT INTO catalog_identity_operations(
         id, tenant_id, operation_kind, requested_by_user_id,
         requested_by_actor_kind, requested_by_actor_id, payload_json,
         payload_hash, base_state_hash, status, created_at, updated_at
       ) VALUES (
         'catalog_identity_lifecycle_original', ?, 'split_variant', 'deleted_user',
         'user', 'deleted_actor', '{}', 'lifecycle-original', 'before-state',
         'applied', ?, ?
       )`,
      tenantId,
      at,
      at
    );
    db.run(
      `INSERT INTO catalog_identity_operations(
         id, tenant_id, operation_kind, requested_by_user_id,
         requested_by_actor_kind, requested_by_actor_id, payload_json,
         payload_hash, base_state_hash, status, reversed_operation_id,
         created_at, updated_at
       ) VALUES (
         'catalog_identity_lifecycle_rollback', ?, 'rollback', 'deleted_user',
         'user', 'deleted_actor', '{}', 'lifecycle-rollback', 'after-state',
         'applied', 'catalog_identity_lifecycle_original', ?, ?
       )`,
      tenantId,
      at,
      at
    );
    db.run(
      "UPDATE catalog_identity_operations SET reverted_by_operation_id = 'catalog_identity_lifecycle_rollback' WHERE id = 'catalog_identity_lifecycle_original'"
    );
    db.run(
      `INSERT INTO catalog_identity_operation_snapshots(
         id, tenant_id, operation_id, phase, snapshot_json, snapshot_hash, created_at
       ) VALUES ('catalog_identity_lifecycle_snapshot', ?, 'catalog_identity_lifecycle_original', 'before', '{}', 'before-state', ?)`,
      tenantId,
      at
    );
    db.run(
      `INSERT INTO catalog_identity_operation_events(
         id, tenant_id, operation_id, sequence, event_type, actor_kind, actor_id,
         reason_code, state_hash, data_json, created_at
       ) VALUES ('catalog_identity_lifecycle_event', ?, 'catalog_identity_lifecycle_original', 1, 'proposed', 'user', 'deleted_actor',
         'lifecycle_test', 'before-state', '{}', ?)`,
      tenantId,
      at
    );
    assert.throws(
      () => db.run("DELETE FROM catalog_identity_operations WHERE id = 'catalog_identity_lifecycle_original'"),
      /immutable|append-only/
    );
    db.run("DELETE FROM tenants WHERE id = ?", tenantId);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM catalog_identity_operations WHERE tenant_id = ?",
      tenantId
    )?.count, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM catalog_identity_operation_snapshots WHERE tenant_id = ?",
      tenantId
    )?.count, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM catalog_identity_operation_events WHERE tenant_id = ?",
      tenantId
    )?.count, 0);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("the durable schema has no raw offer token column", () => {
  const db = new YoinkDatabase();
  try {
    const tables = ["offer_observations", "offer_snapshots", "exact_offer_keys", "signal_events", "signal_incidents", "action_jobs", "retailer_shadow_observations", "retailer_adapter_trials", "retailer_adapter_diagnostics"];
    for (const table of tables) {
      const columns = db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((row) => row.name);
      assert.equal(columns.includes("offer_id"), false, `${table} must not persist raw offer IDs`);
      assert.equal(columns.includes("offer_listing_id"), false, `${table} must not persist raw offer listing IDs`);
    }
    const sourceStateColumns = db.all<{ name: string }>("PRAGMA table_info(source_device_states)").map((row) => row.name);
    for (const forbidden of ["endpoint", "p256dh", "auth", "cookie", "csrf", "authorization", "device_token"]) {
      assert.equal(sourceStateColumns.includes(forbidden), false, `source_device_states must not persist ${forbidden}`);
    }
  } finally {
    db.close();
  }
});
