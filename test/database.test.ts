import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { MIGRATIONS } from "../packages/database/src/migrations.js";

test("initial migration creates the normalized graph and safe local defaults", () => {
  const db = new YoinkDatabase();
  try {
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")?.count, MIGRATIONS.length);
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
        'observer_recipe_candidates', 'observer_recipe_trials', 'observer_recipe_recovery_evidence',
        'observer_recipe_recovery_reviews', 'observer_recipe_recovery_retention_receipts',
        'observer_recipe_contributor_eligibility_states',
        'observer_recipe_lifecycle_events', 'inbox_messages',
        'hosted_delivery_receipts', 'hosted_request_nonces'
      )`)?.count, 16);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM authorization_permissions")?.count, 28);
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
    assert.equal(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN ('walmart_draw_scans', 'walmart_draw_items')`)?.count, 2);
    assert.equal(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'operator_alert_rules', 'operator_alert_incidents',
        'operator_alert_events', 'operator_alert_deliveries',
        'operator_alert_connectors', 'operator_alert_connector_deliveries',
        'operator_alert_connector_delivery_events'
      )`)?.count, 7);
    assert.equal(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'observer_recipe_trust_manifests', 'observer_recipe_transparency_events',
        'observer_recipe_witness_receipts', 'observer_recipe_witness_checks'
      )`)?.count, 4);
    assert.equal(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'operational_request_rollups', 'operational_error_events',
        'operational_telemetry_retention_receipts'
      )`)?.count, 3);
    assert.equal(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'admin_change_requests', 'admin_change_decisions', 'admin_change_events'
      )`)?.count, 3);
    assert.equal(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'background_task_schedules', 'background_tasks',
        'background_task_events', 'background_worker_heartbeats'
      )`)?.count, 4);
    assert.equal(db.get<{ count: number }>(`SELECT COUNT(*) AS count
      FROM authorization_role_permissions
      WHERE role_id = 'security_admin' AND permission_id = 'change.approve'`)?.count, 1);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM operator_alert_rules WHERE tenant_id = ? AND enabled = 1",
      LOCAL_TENANT_ID
    )?.count, 1);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("non-owner processes require an existing database at the exact current schema", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-current-schema-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    assert.throws(
      () => new YoinkDatabase(filePath, { migrationMode: "require_current" }),
      /initialized and migrated by the API/
    );
    assert.equal(existsSync(filePath), false);

    new YoinkDatabase(filePath).close();
    const current = new YoinkDatabase(filePath, { migrationMode: "require_current" });
    assert.equal(current.migrationMode, "require_current");
    assert.equal(current.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")?.count, MIGRATIONS.length);
    current.run("UPDATE schema_migrations SET name = 'tampered_name' WHERE version = 35");
    current.close();

    assert.throws(
      () => new YoinkDatabase(filePath, { migrationMode: "require_current" }),
      /schema is not current/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
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
      assert.equal(second.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")?.count, MIGRATIONS.length);
      second.assertIntegrity();
    } finally {
      second.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 51 retires prior Best Buy qualification after the v7 observer and v6 action change", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-bestbuy-v6-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new YoinkDatabase(filePath);
    legacy.run("DELETE FROM schema_migrations WHERE version = 51");
    legacy.run("UPDATE retailers SET execution_supported = 1 WHERE id = 'bestbuy'");
    legacy.exec(`
      INSERT INTO product_families(id, title, brand, created_at, updated_at)
        VALUES ('family_bestbuy_v6_fixture', 'Best Buy v6 fixture', '', '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z');
      INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
        VALUES ('variant_bestbuy_v6_fixture', 'family_bestbuy_v6_fixture', 'Best Buy v6 fixture', '{}', '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z');
      INSERT INTO listings(
        id, variant_id, retailer_id, retailer_sku, canonical_url, status,
        execution_supported, currency, created_at, updated_at
      ) VALUES (
        'listing_bestbuy_v6_fixture', 'variant_bestbuy_v6_fixture', 'bestbuy', '6677244',
        'https://www.bestbuy.com/site/-/6677244.p', 'in_stock', 1, 'USD',
        '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z'
      );
      INSERT OR REPLACE INTO retailer_adapter_qualifications(
        tenant_id, user_id, retailer_id, adapter_version, highest_action,
        status, evidence_hash, qualified_at, updated_at
      ) VALUES (
        'tenant_local', 'user_local', 'bestbuy', 'bestbuy-add-v5', 'add_to_cart',
        'qualified', 'bestbuy-v5-evidence', '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z'
      );
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ name: string }>(
        "SELECT name FROM schema_migrations WHERE version = 51"
      )?.name, "bestbuy_v7_v6_requalification_boundary");
      assert.equal(upgraded.get<{ execution_supported: number }>(
        "SELECT execution_supported FROM retailers WHERE id = 'bestbuy'"
      )?.execution_supported, 0);
      assert.equal(upgraded.get<{ execution_supported: number }>(
        "SELECT execution_supported FROM listings WHERE id = 'listing_bestbuy_v6_fixture'"
      )?.execution_supported, 0);
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

test("migration 52 retires prior Best Buy qualification after the v8 observer and v7 split-shell action change", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-bestbuy-v7-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new YoinkDatabase(filePath);
    legacy.run("DELETE FROM schema_migrations WHERE version = 52");
    legacy.run("UPDATE retailers SET execution_supported = 1 WHERE id = 'bestbuy'");
    legacy.exec(`
      INSERT INTO product_families(id, title, brand, created_at, updated_at)
        VALUES ('family_bestbuy_v7_fixture', 'Best Buy v7 fixture', '', '2026-08-29T20:00:00.000Z', '2026-08-29T20:00:00.000Z');
      INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
        VALUES ('variant_bestbuy_v7_fixture', 'family_bestbuy_v7_fixture', 'Best Buy v7 fixture', '{}', '2026-08-29T20:00:00.000Z', '2026-08-29T20:00:00.000Z');
      INSERT INTO listings(
        id, variant_id, retailer_id, retailer_sku, canonical_url, status,
        execution_supported, currency, created_at, updated_at
      ) VALUES (
        'listing_bestbuy_v7_fixture', 'variant_bestbuy_v7_fixture', 'bestbuy', '6685081',
        'https://www.bestbuy.com/site/-/6685081.p', 'in_stock', 1, 'USD',
        '2026-08-29T20:00:00.000Z', '2026-08-29T20:00:00.000Z'
      );
      INSERT OR REPLACE INTO retailer_adapter_qualifications(
        tenant_id, user_id, retailer_id, adapter_version, highest_action,
        status, evidence_hash, qualified_at, updated_at
      ) VALUES (
        'tenant_local', 'user_local', 'bestbuy', 'bestbuy-add-v6', 'add_to_cart',
        'qualified', 'bestbuy-v6-evidence', '2026-08-29T20:00:00.000Z', '2026-08-29T20:00:00.000Z'
      );
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ name: string }>(
        "SELECT name FROM schema_migrations WHERE version = 52"
      )?.name, "bestbuy_v8_v7_split_shell_requalification_boundary");
      assert.equal(upgraded.get<{ execution_supported: number }>(
        "SELECT execution_supported FROM retailers WHERE id = 'bestbuy'"
      )?.execution_supported, 0);
      assert.equal(upgraded.get<{ execution_supported: number }>(
        "SELECT execution_supported FROM listings WHERE id = 'listing_bestbuy_v7_fixture'"
      )?.execution_supported, 0);
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
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")?.count, MIGRATIONS.length);
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
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM walmart_draw_scans")?.count, 0);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM walmart_draw_items")?.count, 0);
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
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")?.count, MIGRATIONS.length);
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
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")?.count, MIGRATIONS.length);
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

test("migration 24 adds a read-only Walmart Draw ledger without changing retailer execution state", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-walmart-draw-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 23)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-24T00:00:00.000Z"
      );
    }
    legacy.exec(`INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at)
      VALUES ('walmart', 'Walmart', 1, '["walmart.com"]', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z')
      ON CONFLICT(id) DO UPDATE SET execution_supported = 1;`);
    legacy.exec(`INSERT INTO retailer_adapter_qualifications(
      tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
      evidence_hash, qualified_at, updated_at
    ) VALUES (
      'tenant_local', 'user_local', 'walmart', 'walmart-add-v3', 'add_to_cart', 'qualified',
      'preserved-draw-migration-evidence', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'
    );`);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 24 AND name = 'walmart_draw_observation_ledger'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN ('walmart_draw_scans', 'walmart_draw_items')`)?.count, 2);
      assert.equal(upgraded.get<{ executionSupported: number }>(
        "SELECT execution_supported AS executionSupported FROM retailers WHERE id = 'walmart'"
      )?.executionSupported, 1);
      const qualification = upgraded.get<{ status: string; evidenceHash: string }>(
        "SELECT status, evidence_hash AS evidenceHash FROM retailer_adapter_qualifications WHERE user_id = 'user_local' AND retailer_id = 'walmart'"
      );
      assert.equal(qualification?.status, "qualified");
      assert.equal(qualification?.evidenceHash, "preserved-draw-migration-evidence");
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 25 adds privacy-classified operator alert control without widening retailer execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-operator-alert-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 24)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-24T00:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT OR IGNORE INTO tenants(id, name, created_at)
      VALUES ('tenant_local', 'Local', '2026-08-24T00:00:00.000Z');
      INSERT OR IGNORE INTO users(id, tenant_id, display_name, created_at)
      VALUES ('user_local', 'tenant_local', 'Local user', '2026-08-24T00:00:00.000Z');
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at)
      VALUES ('walmart', 'Walmart', 1, '["walmart.com"]', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z')
      ON CONFLICT(id) DO UPDATE SET execution_supported = 1;
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 25 AND name = 'privacy_classified_operator_alerts'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'operator_alert_rules', 'operator_alert_incidents',
          'operator_alert_events', 'operator_alert_deliveries'
        )`)?.count, 4);
      const rule = upgraded.get<{ privacy: string; routes: string }>(
        `SELECT privacy_classification AS privacy, routes_json AS routes
         FROM operator_alert_rules WHERE tenant_id = 'tenant_local'`
      );
      assert.equal(rule?.privacy, "operational_configuration");
      assert.deepEqual(JSON.parse(rule?.routes ?? "[]"), ["dashboard", "audit_outbox"]);
      assert.equal(upgraded.get<{ executionSupported: number }>(
        "SELECT execution_supported AS executionSupported FROM retailers WHERE id = 'walmart'"
      )?.executionSupported, 1);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 26 retires TOFU recipes and adds immutable rooted trust without widening execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-rooted-trust-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 25)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-24T00:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT OR IGNORE INTO tenants(id, name, created_at)
      VALUES ('tenant_local', 'Local', '2026-08-24T00:00:00.000Z');
      INSERT OR IGNORE INTO users(id, tenant_id, display_name, created_at)
      VALUES ('user_local', 'tenant_local', 'Local user', '2026-08-24T00:00:00.000Z');
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at)
      VALUES ('target', 'Target', 1, '["target.com"]', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z')
      ON CONFLICT(id) DO UPDATE SET execution_supported = 1;
      INSERT INTO observer_recipe_candidates(
        id, tenant_id, user_id, retailer_id, recipe_version,
        minimum_extension_version, recipe_json, recipe_fingerprint,
        lifecycle_state, rollback_recipe_id, kill_switch, provenance_code,
        signature_key_id, signature, signed_at, expires_at,
        disabled_reason, created_at, updated_at
      ) VALUES (
        'observer_recipe_legacy_tofu', 'tenant_local', 'user_local', 'target', 'target-legacy-tofu',
        '0.15.0', '{"availability":{"mode":"text","selectors":["#availability"]}}',
        '${"f".repeat(64)}', 'shadow', '', 0, 'legacy_tofu', '${"a".repeat(64)}', '${"B".repeat(86)}',
        '2026-08-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z', '',
        '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'
      );
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 26 AND name = 'rooted_observer_recipe_trust'"
      )?.count, 1);
      const retired = upgraded.get<{
        state: string; killSwitch: number; reason: string; signature: string; generation: number; manifestHash: string;
      }>(`SELECT lifecycle_state AS state, kill_switch AS killSwitch, disabled_reason AS reason,
                 signature, trust_manifest_generation AS generation, trust_manifest_hash AS manifestHash
          FROM observer_recipe_candidates WHERE id = 'observer_recipe_legacy_tofu'`);
      assert.deepEqual({ ...retired }, {
        state: "disabled",
        killSwitch: 1,
        reason: "rooted_trust_upgrade_required",
        signature: "",
        generation: 0,
        manifestHash: ""
      });
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM observer_recipe_lifecycle_events WHERE recipe_id = 'observer_recipe_legacy_tofu' AND reason_code = 'rooted_trust_upgrade_required'"
      )?.count, 1);
      assert.equal(upgraded.get<{ executionSupported: number }>(
        "SELECT execution_supported AS executionSupported FROM retailers WHERE id = 'target'"
      )?.executionSupported, 1);
      assert.equal(upgraded.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'trigger' AND name IN (
          'observer_recipe_trust_manifests_no_update', 'observer_recipe_trust_manifests_no_delete',
          'observer_recipe_transparency_no_update', 'observer_recipe_transparency_no_delete'
        )`)?.count, 4);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 27 adds exact selected-offer scope without widening retailer execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-selected-offer-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 26)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-24T00:00:00.000Z"
      );
    }
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 27 AND name = 'exact_selected_offer_community_scope'"
      )?.count, 1);
      const shadowColumns = new Set(upgraded.all<{ name: string }>(
        "PRAGMA table_info(retailer_shadow_observations)"
      ).map((column) => column.name));
      const communityColumns = new Set(upgraded.all<{ name: string }>(
        "PRAGMA table_info(community_inventory_assertions)"
      ).map((column) => column.name));
      for (const name of [
        "selected_offer_state", "child_offer_key", "variant_attributes_json", "selected_offer_fingerprint"
      ]) {
        assert.equal(shadowColumns.has(name), true, name);
        assert.equal(communityColumns.has(name), true, name);
      }
      assert.equal(shadowColumns.has("selected_offer_schema_version"), true);
      assert.equal(upgraded.get<{ count: number }>(`SELECT COUNT(*) AS count FROM retailers
        WHERE id IN ('amazon', 'bestbuy') AND execution_supported = 0`)?.count, 2);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 28 retires only inherited Best Buy execution for observer v5 requalification", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-bestbuy-v5-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 27)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-24T00:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at) VALUES
        ('target', 'Target', 1, '["target.com"]', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
        ('bestbuy', 'Best Buy', 1, '["bestbuy.com"]', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      UPDATE retailers SET execution_supported = 1 WHERE id IN ('target', 'bestbuy');
      INSERT INTO product_families(id, title, brand, created_at, updated_at)
        VALUES ('family_bestbuy_v5_fixture', 'Best Buy v5 fixture', '', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
        VALUES ('variant_bestbuy_v5_fixture', 'family_bestbuy_v5_fixture', 'Best Buy v5 fixture', '{}', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO listings(
        id, variant_id, retailer_id, retailer_sku, canonical_url, status,
        execution_supported, currency, created_at, updated_at
      ) VALUES (
        'listing_bestbuy_v5_fixture', 'variant_bestbuy_v5_fixture', 'bestbuy', '6678193',
        'https://www.bestbuy.com/site/-/6678193.p', 'active', 1, 'USD',
        '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'
      );
      INSERT OR REPLACE INTO retailer_adapter_qualifications(
        tenant_id, user_id, retailer_id, adapter_version, highest_action,
        status, evidence_hash, qualified_at, updated_at
      ) VALUES
        ('tenant_local', 'user_local', 'target', 'target-add-v1', 'add_to_cart', 'qualified', 'target-evidence', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
        ('tenant_local', 'user_local', 'bestbuy', 'bestbuy-add-v3', 'add_to_cart', 'qualified', 'bestbuy-evidence', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 28 AND name = 'bestbuy_v5_requalification_boundary'"
      )?.count, 1);
      assert.equal(upgraded.get<{ execution_supported: number }>(
        "SELECT execution_supported FROM retailers WHERE id = 'bestbuy'"
      )?.execution_supported, 0);
      assert.equal(upgraded.get<{ execution_supported: number }>(
        "SELECT execution_supported FROM listings WHERE id = 'listing_bestbuy_v5_fixture'"
      )?.execution_supported, 0);
      assert.equal(upgraded.get<{ status: string }>(
        "SELECT status FROM retailer_adapter_qualifications WHERE user_id = 'user_local' AND retailer_id = 'bestbuy'"
      )?.status, "retired");
      assert.equal(upgraded.get<{ execution_supported: number }>(
        "SELECT execution_supported FROM retailers WHERE id = 'target'"
      )?.execution_supported, 1);
      assert.equal(upgraded.get<{ status: string }>(
        "SELECT status FROM retailer_adapter_qualifications WHERE user_id = 'user_local' AND retailer_id = 'target'"
      )?.status, "qualified");
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 29 adds immutable external witness receipts without widening retailer execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-observer-witness-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 28)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-24T00:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at) VALUES
        ('target', 'Target', 1, '["target.com"]', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
        ('bestbuy', 'Best Buy', 0, '["bestbuy.com"]', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 29 AND name = 'externally_witnessed_observer_recipe_checkpoints'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN ('observer_recipe_witness_receipts', 'observer_recipe_witness_checks')`)?.count, 2);
      assert.equal(upgraded.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'trigger' AND name IN (
          'observer_recipe_witness_receipts_no_update', 'observer_recipe_witness_receipts_no_delete',
          'observer_recipe_witness_checks_no_update', 'observer_recipe_witness_checks_no_delete'
        )`)?.count, 4);
      assert.equal(upgraded.get<{ execution_supported: number }>(
        "SELECT execution_supported FROM retailers WHERE id = 'target'"
      )?.execution_supported, 1);
      assert.equal(upgraded.get<{ execution_supported: number }>(
        "SELECT execution_supported FROM retailers WHERE id = 'bestbuy'"
      )?.execution_supported, 0);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 30 preserves strategy history and appends direct mode for reviewed user plans", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-mission-decision-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 29)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-24T00:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO tenants(id, name, created_at)
        VALUES ('tenant_upgrade_30', 'Upgrade 30', '2026-08-24T00:00:00.000Z');
      INSERT INTO users(id, tenant_id, display_name, created_at)
        VALUES ('user_upgrade_30', 'tenant_upgrade_30', 'Upgrade user', '2026-08-24T00:00:00.000Z');
      INSERT INTO app_settings(user_id, actions_paused, pause_reason, execution_mode,
        dedupe_window_seconds, affiliate_mode, tax_bps, store_allowances_json, updated_at)
        VALUES ('user_upgrade_30', 1, 'Upgrade fixture', 'shadow', 300,
          'prefer_fallback', 1200, '{"target":3000}', '2026-08-24T00:00:00.000Z');
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at)
        VALUES ('target', 'Target', 1, '["target.com"]', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO product_families(id, title, brand, created_at, updated_at)
        VALUES ('family_upgrade_30', 'Upgrade fixture', '', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
        VALUES ('variant_upgrade_30', 'family_upgrade_30', 'Upgrade fixture', '{}', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status,
        execution_supported, msrp_cents, currency, created_at, updated_at)
        VALUES ('listing_upgrade_30', 'variant_upgrade_30', 'target', '93000030',
          'https://www.target.com/p/-/A-93000030', 'in_stock', 1, 5000, 'USD',
          '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO missions(id, tenant_id, user_id, variant_id, status, origin, target_quantity,
        fulfilled_quantity, created_at, updated_at)
        VALUES ('mission_upgrade_30', 'tenant_upgrade_30', 'user_upgrade_30', 'variant_upgrade_30',
          'active', 'user_guided', 1, 0, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO mission_targets(id, mission_id, listing_id, enabled, max_unit_price_cents,
        currency, seller_policy, fulfillment, created_at, updated_at)
        VALUES ('target_upgrade_30', 'mission_upgrade_30', 'listing_upgrade_30', 1, 5000,
          'USD', 'first_party_only', 'shipping', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO mission_intent_revisions(id, tenant_id, user_id, mission_id, revision, quantity,
        currency, max_all_in_cents, action_ceiling, substitution_policy, expires_at,
        cooldown_seconds, target_policy_json, policy_hash, change_reason, created_by_actor_id, created_at)
        VALUES ('intent_upgrade_30', 'tenant_upgrade_30', 'user_upgrade_30', 'mission_upgrade_30', 1, 1,
          'USD', 9000, 'add_to_cart', 'exact_only', '', 0,
          '[{"targetId":"target_upgrade_30","listingId":"listing_upgrade_30","retailerId":"target","enabled":true,"maxUnitPriceCents":5000,"sellerPolicy":"first_party_only","fulfillment":"shipping"}]',
          'policy-upgrade-30', 'Reviewed in 0.28', 'user_upgrade_30', '2026-08-24T00:00:00.000Z');
      INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
        VALUES ('variant_upgrade_30_unsafe', 'family_upgrade_30', 'Unsafe upgrade fixture', '{}',
          '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status,
        execution_supported, msrp_cents, currency, created_at, updated_at)
        VALUES ('listing_upgrade_30_unsafe', 'variant_upgrade_30_unsafe', 'target', '93000031',
          'https://www.target.com/p/-/A-93000031', 'in_stock', 1, 5000, 'USD',
          '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO missions(id, tenant_id, user_id, variant_id, status, origin, target_quantity,
        fulfilled_quantity, created_at, updated_at)
        VALUES ('mission_upgrade_30_unsafe', 'tenant_upgrade_30', 'user_upgrade_30', 'variant_upgrade_30_unsafe',
          'active', 'user_guided', 1, 0, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO mission_targets(id, mission_id, listing_id, enabled, max_unit_price_cents,
        currency, seller_policy, fulfillment, created_at, updated_at)
        VALUES ('target_upgrade_30_unsafe', 'mission_upgrade_30_unsafe', 'listing_upgrade_30_unsafe', 1, 5000,
          'USD', 'allow_third_party', 'shipping', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
      INSERT INTO mission_intent_revisions(id, tenant_id, user_id, mission_id, revision, quantity,
        currency, max_all_in_cents, action_ceiling, substitution_policy, expires_at,
        cooldown_seconds, target_policy_json, policy_hash, change_reason, created_by_actor_id, created_at)
        VALUES ('intent_upgrade_30_unsafe', 'tenant_upgrade_30', 'user_upgrade_30', 'mission_upgrade_30_unsafe', 1, 1,
          'USD', 9000, 'add_to_cart', 'exact_only', '', 0,
          '[{"targetId":"target_upgrade_30_unsafe","listingId":"listing_upgrade_30_unsafe","retailerId":"target","enabled":true,"maxUnitPriceCents":5000,"sellerPolicy":"allow_third_party","fulfillment":"shipping"}]',
          'policy-upgrade-30-unsafe', 'Unsafe legacy edit', 'user_upgrade_30', '2026-08-24T00:00:00.000Z');
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 30 AND name = 'mission_owned_purchase_decisions'"
      )?.count, 1);
      const revisions = upgraded.all<{ revision: number; decision_mode: string; max_signal_age_seconds: number }>(
        `SELECT revision, decision_mode, max_signal_age_seconds
         FROM mission_intent_revisions WHERE mission_id = 'mission_upgrade_30' ORDER BY revision`
      ).map((row) => ({ ...row }));
      assert.deepEqual(revisions, [
        { revision: 1, decision_mode: "strategy", max_signal_age_seconds: 120 },
        { revision: 2, decision_mode: "purchase_intent", max_signal_age_seconds: 120 }
      ]);
      assert.deepEqual(upgraded.all<{ revision: number; decision_mode: string }>(
        `SELECT revision, decision_mode FROM mission_intent_revisions
         WHERE mission_id = 'mission_upgrade_30_unsafe' ORDER BY revision`
      ).map((row) => ({ ...row })), [
        { revision: 1, decision_mode: "strategy" }
      ]);
      const missionDecisionColumns = upgraded.all<{ name: string }>("PRAGMA table_info(mission_decisions)").map((row) => row.name);
      const actionJobColumns = upgraded.all<{ name: string }>("PRAGMA table_info(action_jobs)").map((row) => row.name);
      assert.equal(missionDecisionColumns.includes("decision_source"), true);
      assert.equal(actionJobColumns.includes("decision_source"), true);
      assert.throws(
        () => upgraded.run("UPDATE mission_intent_revisions SET decision_mode = 'strategy' WHERE id LIKE 'intent_revision_m30_%'"),
        /append-only/
      );
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 31 adds bounded operational telemetry without changing retailer execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-operational-telemetry-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 30)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-25T00:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO tenants(id, name, created_at)
        VALUES ('tenant_upgrade_31', 'Upgrade 31', '2026-08-25T00:00:00.000Z');
      INSERT INTO users(id, tenant_id, display_name, created_at)
        VALUES ('user_upgrade_31', 'tenant_upgrade_31', 'Upgrade user', '2026-08-25T00:00:00.000Z');
      INSERT INTO app_settings(user_id, actions_paused, pause_reason, execution_mode,
        dedupe_window_seconds, affiliate_mode, tax_bps, store_allowances_json, updated_at)
        VALUES ('user_upgrade_31', 0, 'Qualified actions enabled', 'live', 300,
          'prefer_fallback', 1200, '{"target":3000,"walmart":3000}', '2026-08-25T00:00:00.000Z');
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at) VALUES
        ('target', 'Target', 1, '["target.com"]', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'),
        ('walmart', 'Walmart', 1, '["walmart.com"]', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'),
        ('amazon', 'Amazon', 0, '["amazon.com"]', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
      INSERT INTO retailer_adapter_qualifications(
        tenant_id, user_id, retailer_id, adapter_version, highest_action,
        status, evidence_hash, qualified_at, updated_at
      ) VALUES
        ('tenant_upgrade_31', 'user_upgrade_31', 'target', 'target-add-v1', 'add_to_cart',
          'qualified', 'target-evidence-31', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'),
        ('tenant_upgrade_31', 'user_upgrade_31', 'walmart', 'walmart-add-v3', 'add_to_cart',
          'qualified', 'walmart-evidence-31', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 31 AND name = 'privacy_bounded_operational_telemetry'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'operational_request_rollups', 'operational_error_events',
          'operational_telemetry_retention_receipts'
        )`)?.count, 3);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM operational_request_rollups"
      )?.count, 0);
      const settings = upgraded.get<{ actionsPaused: number; executionMode: string }>(
        "SELECT actions_paused AS actionsPaused, execution_mode AS executionMode FROM app_settings WHERE user_id = 'user_upgrade_31'"
      );
      assert.equal(settings?.actionsPaused, 0);
      assert.equal(settings?.executionMode, "live");
      assert.deepEqual(upgraded.all<{ retailerId: string; status: string }>(
        `SELECT retailer_id AS retailerId, status FROM retailer_adapter_qualifications
         WHERE user_id = 'user_upgrade_31' ORDER BY retailer_id`
      ).map((row) => ({ ...row })), [
        { retailerId: "target", status: "qualified" },
        { retailerId: "walmart", status: "qualified" }
      ]);
      assert.equal(upgraded.get<{ executionSupported: number }>(
        "SELECT execution_supported AS executionSupported FROM retailers WHERE id = 'amazon'"
      )?.executionSupported, 0);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 32 adds high-risk change control without widening or closing retailer execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-change-control-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 31)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-25T02:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO tenants(id, name, created_at)
        VALUES ('tenant_upgrade_32', 'Upgrade 32', '2026-08-25T02:00:00.000Z');
      INSERT INTO users(id, tenant_id, display_name, created_at)
        VALUES ('user_upgrade_32', 'tenant_upgrade_32', 'Upgrade user', '2026-08-25T02:00:00.000Z');
      INSERT INTO app_settings(user_id, actions_paused, pause_reason, execution_mode,
        dedupe_window_seconds, affiliate_mode, tax_bps, store_allowances_json, updated_at)
        VALUES ('user_upgrade_32', 0, 'Qualified actions enabled', 'live', 300,
          'prefer_fallback', 1200, '{"target":3000,"walmart":3000}', '2026-08-25T02:00:00.000Z');
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at) VALUES
        ('target', 'Target', 1, '["target.com"]', '2026-08-25T02:00:00.000Z', '2026-08-25T02:00:00.000Z'),
        ('walmart', 'Walmart', 1, '["walmart.com"]', '2026-08-25T02:00:00.000Z', '2026-08-25T02:00:00.000Z'),
        ('amazon', 'Amazon', 0, '["amazon.com"]', '2026-08-25T02:00:00.000Z', '2026-08-25T02:00:00.000Z');
      INSERT INTO retailer_adapter_qualifications(
        tenant_id, user_id, retailer_id, adapter_version, highest_action,
        status, evidence_hash, qualified_at, updated_at
      ) VALUES
        ('tenant_upgrade_32', 'user_upgrade_32', 'target', 'target-add-v1', 'add_to_cart',
          'qualified', 'target-evidence-32', '2026-08-25T02:00:00.000Z', '2026-08-25T02:00:00.000Z'),
        ('tenant_upgrade_32', 'user_upgrade_32', 'walmart', 'walmart-add-v3', 'add_to_cart',
          'qualified', 'walmart-evidence-32', '2026-08-25T02:00:00.000Z', '2026-08-25T02:00:00.000Z');
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 32 AND name = 'high_risk_change_control'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'admin_change_requests', 'admin_change_decisions', 'admin_change_events'
        )`)?.count, 3);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM authorization_permissions WHERE id = 'change.approve'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM authorization_role_permissions WHERE role_id = 'security_admin' AND permission_id = 'change.approve'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM admin_change_requests")?.count, 0);
      assert.deepEqual({ ...upgraded.get<{ actionsPaused: number; executionMode: string }>(
        "SELECT actions_paused AS actionsPaused, execution_mode AS executionMode FROM app_settings WHERE user_id = 'user_upgrade_32'"
      ) }, { actionsPaused: 0, executionMode: "live" });
      assert.deepEqual(upgraded.all<{ retailerId: string; status: string }>(
        `SELECT retailer_id AS retailerId, status FROM retailer_adapter_qualifications
         WHERE user_id = 'user_upgrade_32' ORDER BY retailer_id`
      ).map((row) => ({ ...row })), [
        { retailerId: "target", status: "qualified" },
        { retailerId: "walmart", status: "qualified" }
      ]);
      assert.equal(upgraded.get<{ executionSupported: number }>(
        "SELECT execution_supported AS executionSupported FROM retailers WHERE id = 'amazon'"
      )?.executionSupported, 0);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 33 grants self-service data export without changing retailer execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-user-export-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 32)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-25T04:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at)
      VALUES ('retailer_upgrade_33', 'Upgrade retailer', 1, '["upgrade.example"]',
        '2026-08-25T04:00:00.000Z', '2026-08-25T04:00:00.000Z');
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 33 AND name = 'self_service_user_data_export'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM authorization_permissions WHERE id = 'user.privacy.export'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM authorization_role_permissions WHERE role_id = 'yoink_user' AND permission_id = 'user.privacy.export'"
      )?.count, 1);
      assert.equal(upgraded.get<{ executionSupported: number }>(
        "SELECT execution_supported AS executionSupported FROM retailers WHERE id = 'retailer_upgrade_33'"
      )?.executionSupported, 1);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 34 adds durable background work without widening retailer execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-background-worker-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 33)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-25T08:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at)
      VALUES ('retailer_upgrade_34', 'Worker upgrade retailer', 1, '["worker-upgrade.example"]',
        '2026-08-25T08:00:00.000Z', '2026-08-25T08:00:00.000Z');
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 34 AND name = 'durable_background_worker_foundation'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM authorization_permissions WHERE id = 'worker.manage'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN (
          'background_task_schedules', 'background_tasks',
          'background_task_events', 'background_worker_heartbeats'
        )`
      )?.count, 4);
      assert.equal(upgraded.get<{ executionSupported: number }>(
        "SELECT execution_supported AS executionSupported FROM retailers WHERE id = 'retailer_upgrade_34'"
      )?.executionSupported, 1);
      assert.equal(upgraded.get<{ actionsPaused: number; executionMode: string }>(
        "SELECT actions_paused AS actionsPaused, execution_mode AS executionMode FROM app_settings WHERE user_id = ?",
        LOCAL_USER_ID
      )?.actionsPaused, 1);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 35 upgrades only the packaged signal-recovery schedule default", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-signal-ingress-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 34)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-25T08:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO background_task_schedules(
        id, tenant_id, subject_user_id, task_kind, display_name, description,
        enabled, interval_seconds, next_run_at, last_enqueued_at,
        created_by_actor_id, updated_by_actor_id, privacy_classification,
        created_at, updated_at
      ) VALUES (
        'background_schedule_upgrade_35', '${LOCAL_TENANT_ID}', '${LOCAL_USER_ID}',
        'hosted_delivery_recovery', 'Inbox and outbox recovery',
        'Retire expired hosted delivery capabilities and requeue or dead-letter abandoned work.',
        1, 60, '2026-08-25T08:00:00.000Z', '', 'legacy_worker', 'legacy_worker',
        'operational_configuration', '2026-08-25T08:00:00.000Z', '2026-08-25T08:00:00.000Z'
      );
      INSERT INTO tenants(id, name, created_at)
      VALUES ('tenant_schedule_custom_35', 'Custom schedule tenant', '2026-08-25T08:00:00.000Z');
      INSERT INTO users(id, tenant_id, display_name, created_at)
      VALUES ('user_schedule_custom_35', 'tenant_schedule_custom_35', 'Custom schedule user', '2026-08-25T08:00:00.000Z');
      INSERT INTO background_task_schedules(
        id, tenant_id, subject_user_id, task_kind, display_name, description,
        enabled, interval_seconds, next_run_at, last_enqueued_at,
        created_by_actor_id, updated_by_actor_id, privacy_classification,
        created_at, updated_at
      ) VALUES (
        'background_schedule_custom_35', 'tenant_schedule_custom_35', 'user_schedule_custom_35',
        'hosted_delivery_recovery', 'Inbox and outbox recovery',
        'Retire expired hosted delivery capabilities and requeue or dead-letter abandoned work.',
        1, 45, '2026-08-25T08:00:00.000Z', '', 'custom_operator', 'custom_operator',
        'operational_configuration', '2026-08-25T08:00:00.000Z', '2026-08-25T08:00:00.000Z'
      );
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 35 AND name = 'durable_signal_ingress'"
      )?.count, 1);
      assert.deepEqual({ ...upgraded.get<{
        displayName: string;
        description: string;
        intervalSeconds: number;
        updatedByActorId: string;
      }>(
        `SELECT display_name AS displayName, description, interval_seconds AS intervalSeconds,
                updated_by_actor_id AS updatedByActorId
         FROM background_task_schedules WHERE id = 'background_schedule_upgrade_35'`
      ) }, {
        displayName: "Signal inbox and delivery recovery",
        description: "Process packaged signal messages, then retire expired inbox and outbox capabilities safely.",
        intervalSeconds: 15,
        updatedByActorId: "migration_35"
      });
      assert.equal(upgraded.get<{ executionSupported: number }>(
        "SELECT execution_supported AS executionSupported FROM retailers WHERE id = 'bestbuy'"
      )?.executionSupported, 0);
      assert.deepEqual({ ...upgraded.get<{ displayName: string; intervalSeconds: number; updatedByActorId: string }>(
        `SELECT display_name AS displayName, interval_seconds AS intervalSeconds,
                updated_by_actor_id AS updatedByActorId
         FROM background_task_schedules WHERE id = 'background_schedule_custom_35'`
      ) }, {
        displayName: "Inbox and outbox recovery",
        intervalSeconds: 45,
        updatedByActorId: "custom_operator"
      });
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 36 backfills recoverable device credential state without exposing or rotating the credential", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-device-credential-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 35)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-25T09:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO tenants(id, name, created_at)
      VALUES ('tenant_device_upgrade_36', 'Device upgrade tenant', '2026-07-01T09:00:00.000Z');
      INSERT INTO users(id, tenant_id, display_name, created_at)
      VALUES ('user_device_upgrade_36', 'tenant_device_upgrade_36', 'Device upgrade user', '2026-07-01T09:00:00.000Z');
      INSERT INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at)
      VALUES ('target', 'Target', 1, '["target.com"]', '2026-07-01T09:00:00.000Z', '2026-07-01T09:00:00.000Z');
      INSERT INTO retailer_adapter_qualifications(
        tenant_id, user_id, retailer_id, adapter_version, highest_action,
        status, evidence_hash, qualified_at, updated_at
      ) VALUES (
        'tenant_device_upgrade_36', 'user_device_upgrade_36', 'target',
        'target-add-v1', 'add_to_cart', 'qualified', '${"b".repeat(64)}',
        '2026-07-01T09:00:00.000Z', '2026-07-01T09:00:00.000Z'
      );
      INSERT INTO extension_devices(
        id, tenant_id, user_id, name, token_hash, extension_version,
        status, capabilities_json, last_seen_at, created_at, updated_at
      ) VALUES (
        'device_upgrade_36', 'tenant_device_upgrade_36', 'user_device_upgrade_36',
        'Legacy Chrome', '${"a".repeat(64)}', '0.37.0', 'active', '{}',
        '2026-08-25T08:59:00.000Z', '2026-07-01T09:00:00.000Z', '2026-08-25T08:59:00.000Z'
      );
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 36 AND name = 'recoverable_device_credential_rotation'"
      )?.count, 1);
      assert.deepEqual({ ...upgraded.get<{
        generation: number;
        issuedAt: string;
        pendingHash: string;
        pendingGeneration: number;
        previousHash: string;
      }>(
        `SELECT credential_generation AS generation, credential_issued_at AS issuedAt,
                pending_token_hash AS pendingHash, pending_token_generation AS pendingGeneration,
                previous_token_hash AS previousHash
         FROM extension_devices WHERE id = 'device_upgrade_36'`
      ) }, {
        generation: 1,
        issuedAt: "2026-07-01T09:00:00.000Z",
        pendingHash: "",
        pendingGeneration: 0,
        previousHash: ""
      });
      assert.equal(upgraded.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'index' AND name IN (
           'extension_devices_pending_token_hash_idx', 'extension_devices_previous_token_hash_idx'
         )`
      )?.count, 2);
      assert.equal(upgraded.get<{ status: string }>(
        `SELECT status FROM retailer_adapter_qualifications
         WHERE tenant_id = 'tenant_device_upgrade_36'
           AND user_id = 'user_device_upgrade_36' AND retailer_id = 'target'`
      )?.status, "qualified");
      assert.throws(
        () => upgraded.run(
          "UPDATE extension_devices SET pending_token_hash = 'invalid-state' WHERE id = 'device_upgrade_36'"
        ),
        /credential state is invalid/
      );
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 37 adds the witness-refresh task kind without losing durable worker history", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-witness-worker-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 36)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-25T10:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO tenants(id, name, created_at)
      VALUES ('tenant_witness_upgrade_37', 'Witness upgrade tenant', '2026-08-25T10:00:00.000Z');
      INSERT INTO users(id, tenant_id, display_name, created_at)
      VALUES ('user_witness_upgrade_37', 'tenant_witness_upgrade_37', 'Witness upgrade user', '2026-08-25T10:00:00.000Z');
      INSERT INTO background_task_schedules(
        id, tenant_id, subject_user_id, task_kind, display_name, description,
        enabled, interval_seconds, next_run_at, last_enqueued_at,
        created_by_actor_id, updated_by_actor_id, privacy_classification,
        created_at, updated_at
      ) VALUES (
        'background_schedule_upgrade_37', 'tenant_witness_upgrade_37', 'user_witness_upgrade_37',
        'execution_recovery', 'Preserved schedule', 'Preserved before migration 37.',
        1, 30, '2026-08-25T10:00:00.000Z', '', 'legacy_worker', 'legacy_worker',
        'operational_configuration', '2026-08-25T10:00:00.000Z', '2026-08-25T10:00:00.000Z'
      );
      INSERT INTO background_tasks(
        id, tenant_id, subject_user_id, schedule_id, task_kind, dedupe_key,
        state, priority, attempt_count, maximum_attempts, scheduled_for,
        privacy_classification, created_at, updated_at
      ) VALUES (
        'background_task_upgrade_37', 'tenant_witness_upgrade_37', 'user_witness_upgrade_37',
        'background_schedule_upgrade_37', 'execution_recovery', 'upgrade-37-fixture',
        'pending', 50, 0, 5, '2026-08-25T10:00:00.000Z',
        'operational_aggregate', '2026-08-25T10:00:00.000Z', '2026-08-25T10:00:00.000Z'
      );
      INSERT INTO background_task_events(
        id, tenant_id, subject_user_id, task_id, sequence, event_type, attempt,
        reason_code, worker_id, privacy_classification, created_at
      ) VALUES (
        'background_task_event_upgrade_37', 'tenant_witness_upgrade_37', 'user_witness_upgrade_37',
        'background_task_upgrade_37', 1, 'scheduled', 0, 'migration_fixture', '',
        'operational_aggregate', '2026-08-25T10:00:00.000Z'
      );
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 37 AND name = 'durable_observer_witness_refresh'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM background_task_schedules WHERE id = 'background_schedule_upgrade_37'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM background_tasks WHERE id = 'background_task_upgrade_37'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM background_task_events WHERE id = 'background_task_event_upgrade_37'"
      )?.count, 1);
      upgraded.run(
        `INSERT INTO background_task_schedules(
           id, tenant_id, subject_user_id, task_kind, display_name, description,
           enabled, interval_seconds, next_run_at, created_by_actor_id, updated_by_actor_id,
           privacy_classification, created_at, updated_at
         ) VALUES (?, ?, ?, 'observer_recipe_witness_refresh', ?, ?, 1, 60, ?, ?, ?,
           'operational_configuration', ?, ?)`,
        "background_schedule_witness_upgrade_37",
        "tenant_witness_upgrade_37",
        "user_witness_upgrade_37",
        "Observer trust witness refresh",
        "Refresh independent witness receipts.",
        "2026-08-25T10:00:00.000Z",
        "migration_37",
        "migration_37",
        "2026-08-25T10:00:00.000Z",
        "2026-08-25T10:00:00.000Z"
      );
      assert.throws(
        () => upgraded.run(
          "UPDATE background_task_events SET reason_code = 'changed' WHERE id = 'background_task_event_upgrade_37'"
        ),
        /append-only/
      );
      assert.deepEqual(upgraded.all("PRAGMA foreign_key_check"), []);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migrations 38 through 40 preserve heartbeat history and harden governed alert recovery", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-worker-attestation-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 37)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-25T11:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO background_worker_heartbeats(
        tenant_id, subject_user_id, worker_id, runtime_kind, runtime_version,
        state, started_at, heartbeat_at, stopped_at, last_error_code,
        privacy_classification
      ) VALUES (
        'tenant_local', 'user_local', 'background_worker_upgrade_38', 'standalone', '0.40.0',
        'stopped', '2026-08-25T11:00:00.000Z', '2026-08-25T11:00:00.000Z',
        '2026-08-25T11:00:00.000Z', '', 'operational_aggregate'
      );
    `);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 38 AND name = 'attested_background_worker_deployment'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 39 AND name = 'durable_operator_alert_connectors'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 40 AND name = 'governed_operator_alert_connector_recovery'"
      )?.count, 1);
      assert.equal(upgraded.get<{ deploymentFingerprint: string }>(
        `SELECT deployment_fingerprint AS deploymentFingerprint
         FROM background_worker_heartbeats WHERE worker_id = 'background_worker_upgrade_38'`
      )?.deploymentFingerprint, "");
      assert.equal(upgraded.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'
         AND name IN ('background_worker_deployment_expectations', 'background_worker_deployment_events')`
      )?.count, 2);
      assert.equal(upgraded.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'
         AND name IN ('operator_alert_connectors', 'operator_alert_connector_deliveries',
                      'operator_alert_connector_delivery_events')`
      )?.count, 3);
      assert.match(upgraded.get<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'operator_alert_connector_deliveries_update_guard'"
      )?.sql ?? "", /OLD\.state = 'dead_letter'.*NEW\.state = 'pending'|NEW\.state = 'pending'[\s\S]*OLD\.state = 'dead_letter'/);
      assert.throws(() => upgraded.run(
        `INSERT INTO background_worker_deployment_expectations(
           id, contract_version, desired_mode, runtime_version, deployment_fingerprint,
           privacy_classification, updated_at
         ) VALUES ('active', 1, 'external', '0.42.0', ?, 'operational_configuration', ?)`,
        "a".repeat(64),
        "2026-08-25T11:00:00.000Z"
      ), /constraint failed/);
      upgraded.run(
        "UPDATE background_worker_heartbeats SET deployment_fingerprint = ? WHERE worker_id = 'background_worker_upgrade_38'",
        "a".repeat(64)
      );
      assert.throws(
        () => upgraded.run(
          "UPDATE background_worker_heartbeats SET deployment_fingerprint = 'invalid' WHERE worker_id = 'background_worker_upgrade_38'"
        ),
        /constraint failed/
      );
      upgraded.run(
        `INSERT INTO background_worker_deployment_events(
           id, sequence, contract_version, from_mode, to_mode,
           from_deployment_fingerprint, to_deployment_fingerprint,
           runtime_version, previous_event_hash, event_hash, reason_code,
           privacy_classification, created_at
         ) VALUES (
           'background_worker_deployment_event_upgrade_38', 1, 1, '', 'external', '', ?,
           '0.41.0', '', ?, 'api_startup_contract', 'operational_configuration',
           '2026-08-25T11:00:00.000Z'
         )`,
        "a".repeat(64),
        "b".repeat(64)
      );
      assert.throws(
        () => upgraded.run(
          "DELETE FROM background_worker_deployment_events WHERE sequence = 1"
        ),
        /append-only/
      );
      assert.deepEqual(upgraded.all("PRAGMA foreign_key_check"), []);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 41 adds bounded observer-repair evaluation without losing durable work or widening retailers", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-observer-repair-worker-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 40)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-25T12:00:00.000Z"
      );
    }
    legacy.exec(`
      INSERT INTO background_task_schedules(
        id, tenant_id, subject_user_id, task_kind, display_name, description,
        enabled, interval_seconds, next_run_at, last_enqueued_at,
        created_by_actor_id, updated_by_actor_id, privacy_classification,
        created_at, updated_at
      ) VALUES (
        'background_schedule_upgrade_41', 'tenant_local', 'user_local',
        'adapter_alert_reconciliation', 'Preserved repair alerts',
        'Preserved before migration 41.', 1, 60, '2026-08-25T12:00:00.000Z', '',
        'legacy_worker', 'legacy_worker', 'operational_configuration',
        '2026-08-25T12:00:00.000Z', '2026-08-25T12:00:00.000Z'
      );
      INSERT INTO background_tasks(
        id, tenant_id, subject_user_id, schedule_id, task_kind, dedupe_key,
        state, priority, attempt_count, maximum_attempts, scheduled_for,
        privacy_classification, created_at, updated_at
      ) VALUES (
        'background_task_upgrade_41', 'tenant_local', 'user_local',
        'background_schedule_upgrade_41', 'adapter_alert_reconciliation',
        'upgrade-41-fixture', 'pending', 50, 0, 5,
        '2026-08-25T12:00:00.000Z', 'operational_aggregate',
        '2026-08-25T12:00:00.000Z', '2026-08-25T12:00:00.000Z'
      );
      INSERT INTO background_task_events(
        id, tenant_id, subject_user_id, task_id, sequence, event_type, attempt,
        reason_code, worker_id, privacy_classification, created_at
      ) VALUES (
        'background_task_event_upgrade_41', 'tenant_local', 'user_local',
        'background_task_upgrade_41', 1, 'scheduled', 0, 'migration_fixture', '',
        'operational_aggregate', '2026-08-25T12:00:00.000Z'
      );
    `);
    const qualificationCount = Number(legacy.prepare(
      "SELECT COUNT(*) AS count FROM retailer_adapter_qualifications"
    ).get()?.count ?? 0);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 41 AND name = 'durable_observer_repair_candidate_evaluation'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM background_task_schedules WHERE id = 'background_schedule_upgrade_41'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM background_tasks WHERE id = 'background_task_upgrade_41'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM background_task_events WHERE id = 'background_task_event_upgrade_41'"
      )?.count, 1);
      upgraded.run(
        `INSERT INTO background_task_schedules(
           id, tenant_id, subject_user_id, task_kind, display_name, description,
           enabled, interval_seconds, next_run_at, created_by_actor_id, updated_by_actor_id,
           privacy_classification, created_at, updated_at
         ) VALUES (?, ?, ?, 'observer_recipe_candidate_evaluation', ?, ?, 1, 60, ?, ?, ?,
           'operational_configuration', ?, ?)`,
        "background_schedule_repair_candidate_upgrade_41",
        "tenant_local",
        "user_local",
        "Observer repair candidate evaluation",
        "Compile only mature bounded landmarks into quarantined candidates.",
        "2026-08-25T12:00:00.000Z",
        "migration_41",
        "migration_41",
        "2026-08-25T12:00:00.000Z",
        "2026-08-25T12:00:00.000Z"
      );
      assert.throws(() => upgraded.run(
        `INSERT INTO background_task_schedules(
           id, tenant_id, subject_user_id, task_kind, display_name, description,
           enabled, interval_seconds, next_run_at, created_by_actor_id, updated_by_actor_id,
           privacy_classification, created_at, updated_at
         ) VALUES ('background_schedule_invalid_upgrade_41', 'tenant_local', 'user_local',
           'observer_recipe_mutation', 'Invalid', 'Must remain closed.', 1, 60,
           '2026-08-25T12:00:00.000Z', 'migration_41', 'migration_41',
           'operational_configuration', '2026-08-25T12:00:00.000Z', '2026-08-25T12:00:00.000Z')`
      ), /constraint failed/);
      const candidateInsert = `INSERT INTO observer_recipe_candidates(
        id, tenant_id, user_id, retailer_id, recipe_version,
        minimum_extension_version, recipe_json, recipe_fingerprint,
        lifecycle_state, rollback_recipe_id, kill_switch, provenance_code,
        signature_key_id, signature, signed_at, expires_at, disabled_reason,
        trust_manifest_generation, trust_manifest_hash, created_at, updated_at
      ) VALUES (?, 'tenant_local', 'user_local', 'bestbuy', ?, '0.47.0',
        '{"addControl":{"mode":"disabled_state","selectors":["button[data-testid=''pdp-add-to-cart-control'']"]}}',
        ?, 'quarantined', '', 0, 'privacy_bounded_repair_miner', '', '', '',
        '2026-09-24T12:00:00.000Z', '', 0, '',
        '2026-08-25T12:00:00.000Z', '2026-08-25T12:00:00.000Z')`;
      upgraded.run(candidateInsert, "observer_recipe_upgrade_41_a", "bestbuy-repair-upgrade-a", "a".repeat(64));
      assert.throws(
        () => upgraded.run(candidateInsert, "observer_recipe_upgrade_41_b", "bestbuy-repair-upgrade-b", "a".repeat(64)),
        /UNIQUE constraint failed/
      );
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM retailer_adapter_qualifications"
      )?.count, qualificationCount);
      assert.deepEqual(upgraded.all("PRAGMA foreign_key_check"), []);
      upgraded.assertIntegrity();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migrations 42 through 47 preserve legacy trials and add bounded oracle, recovery, retention, and regional eligibility governance", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-observer-oracle-upgrade-test-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    const legacy = new DatabaseSync(filePath);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((item) => item.version <= 41)) {
      legacy.exec(migration.sql);
      legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-08-25T13:00:00.000Z"
      );
    }
    legacy.exec("PRAGMA foreign_keys = OFF;");
    legacy.exec(`
      INSERT INTO extension_devices(
        id, tenant_id, user_id, name, token_hash, extension_version,
        status, capabilities_json, last_seen_at, created_at, updated_at
      ) VALUES (
        'device_oracle_upgrade_42', 'tenant_local', 'user_local', 'Legacy Chrome',
        '${"a".repeat(64)}', '0.48.0', 'active', '{"observerRecipeShadow":true}',
        '2026-08-25T13:00:00.000Z', '2026-08-25T13:00:00.000Z', '2026-08-25T13:00:00.000Z'
      );
      INSERT INTO observer_recipe_candidates(
        id, tenant_id, user_id, retailer_id, recipe_version,
        minimum_extension_version, recipe_json, recipe_fingerprint,
        lifecycle_state, rollback_recipe_id, kill_switch, provenance_code,
        signature_key_id, signature, signed_at, expires_at, disabled_reason,
        trust_manifest_generation, trust_manifest_hash, created_at, updated_at
      ) VALUES (
        'observer_recipe_oracle_upgrade_42', 'tenant_local', 'user_local', 'amazon',
        'amazon-oracle-upgrade', '0.48.0',
        '{"unitPrice":{"mode":"text","selectors":[".a-price .a-offscreen"]}}',
        '${"b".repeat(64)}', 'shadow', '', 0, 'sanitized_layout_repair', '', '', '',
        '2026-09-25T13:00:00.000Z', '', 0, '',
        '2026-08-25T13:00:00.000Z', '2026-08-25T13:00:00.000Z'
      );
      INSERT INTO observer_recipe_trials(
        id, tenant_id, user_id, device_id, recipe_id, retailer_id,
        retailer_sku, observer_version, layout_fingerprint, outcome,
        evaluated_field_count, agreed_field_count, ambiguous_field_count,
        observed_at, received_at
      ) VALUES (
        'observer_recipe_trial_upgrade_42', 'tenant_local', 'user_local',
        'device_oracle_upgrade_42', 'observer_recipe_oracle_upgrade_42', 'amazon',
        'B002OB49L4', 'amazon-observer-v6', '${"c".repeat(64)}', 'passed',
        1, 1, 0, '2026-08-25T13:00:00.000Z', '2026-08-25T13:00:01.000Z'
      );
    `);
    const qualificationCount = Number(legacy.prepare(
      "SELECT COUNT(*) AS count FROM retailer_adapter_qualifications"
    ).get()?.count ?? 0);
    legacy.close();

    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 42 AND name = 'packaged_observer_recipe_oracle'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 43 AND name = 'observer_recipe_contributor_canary_governance'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 44 AND name = 'quarantined_observer_recipe_recovery_evidence'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 45 AND name = 'observer_recipe_recovery_user_reviews'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 46 AND name = 'observer_recipe_recovery_retention'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 47 AND name = 'observer_recipe_regional_conflict_eligibility'"
      )?.count, 1);
      const preserved = upgraded.get<Record<string, unknown>>(
        `SELECT validation_profile, oracle_evaluated_field_count,
                packaged_conflict_field_count, field_outcomes_json, recipe_state_at_trial,
                eligibility_policy_version, eligibility_state,
                contributor_ref_hash, eligibility_proof_hash, region_scope
         FROM observer_recipe_trials WHERE id = 'observer_recipe_trial_upgrade_42'`
      );
      assert.deepEqual({ ...preserved }, {
        validation_profile: "legacy_packaged_comparison",
        oracle_evaluated_field_count: 0,
        packaged_conflict_field_count: 0,
        field_outcomes_json: "[]",
        recipe_state_at_trial: "legacy_unknown",
        eligibility_policy_version: "",
        eligibility_state: "unverified",
        contributor_ref_hash: "",
        eligibility_proof_hash: "",
        region_scope: ""
      });
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'observer_recipe_trials_oracle_gate_idx'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'observer_recipe_trials_contributor_stage_idx'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'observer_recipe_recovery_evidence_review_idx'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM observer_recipe_recovery_evidence"
      )?.count, 0);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM observer_recipe_recovery_reviews"
      )?.count, 0);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM observer_recipe_recovery_retention_receipts"
      )?.count, 0);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'observer_recipe_recovery_reviews_current_idx'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'observer_recipe_recovery_reviews_no_update'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name IN ('observer_recipe_recovery_retention_receipts_owner_idx', 'observer_recipe_recovery_evidence_owner_retention_idx', 'observer_recipe_recovery_reviews_retention_idx')"
      )?.count, 3);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name IN ('observer_recipe_recovery_retention_receipts_no_update', 'observer_recipe_recovery_retention_receipts_no_delete')"
      )?.count, 2);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM authorization_permissions WHERE id = 'internal.eligibility'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM observer_recipe_contributor_eligibility_states"
      )?.count, 0);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name IN ('extension_devices_tenant_user_id_unique', 'observer_recipe_contributor_eligibility_expiry_idx', 'observer_recipe_trials_regional_conflict_slo_idx')"
      )?.count, 3);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name IN ('observer_recipe_contributor_eligibility_monotonic', 'observer_recipe_contributor_eligibility_no_delete')"
      )?.count, 2);
      assert.throws(
        () => upgraded.run("UPDATE observer_recipe_trials SET validation_profile = 'untrusted_page_script'"),
        /constraint failed/
      );
      assert.throws(
        () => upgraded.run("UPDATE observer_recipe_trials SET field_outcomes_json = '{\"rawDom\":\"DO_NOT_STORE\"}'"),
        /constraint failed/
      );
      assert.throws(
        () => upgraded.run("UPDATE observer_recipe_trials SET recipe_state_at_trial = 'checkout'"),
        /constraint failed/
      );
      assert.throws(
        () => upgraded.run("UPDATE observer_recipe_trials SET eligibility_state = 'trusted_local_user'"),
        /constraint failed/
      );
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM retailer_adapter_qualifications"
      )?.count, qualificationCount);
      assert.deepEqual(upgraded.all("PRAGMA foreign_key_check"), []);
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

function createVersion47SignalIncidentFixture(filePath: string, ambiguousOwner = false): void {
  const legacy = new DatabaseSync(filePath);
  legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");
  for (const migration of MIGRATIONS.filter((item) => item.version <= 47)) {
    legacy.exec(migration.sql);
    legacy.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
      migration.version,
      migration.name,
      "2026-08-26T09:00:00.000Z"
    );
  }
  legacy.exec(`
    PRAGMA foreign_keys = ON;

    INSERT INTO tenants(id, name, created_at)
    VALUES ('tenant_incident_a', 'Incident A', '2026-08-26T09:00:00.000Z');
    INSERT INTO users(id, tenant_id, display_name, created_at)
    VALUES ('user_incident_a', 'tenant_incident_a', 'Incident A', '2026-08-26T09:00:00.000Z');
    INSERT INTO retailers(
      id, display_name, execution_supported, domains_json, created_at, updated_at
    ) VALUES (
      'target', 'Target', 0, '["target.com"]',
      '2026-08-26T09:00:00.000Z', '2026-08-26T09:00:00.000Z'
    );
    INSERT INTO source_connections(
      id, tenant_id, user_id, source, name, status, trust_level,
      auto_create_missions, is_private, last_event_at, created_at, updated_at
    ) VALUES (
      'source_incident_a', 'tenant_incident_a', 'user_incident_a',
      'trackalacker', 'TrackaLacker A', 'connected', 'trusted_exact',
      1, 1, '2026-08-26T09:00:00.000Z',
      '2026-08-26T09:00:00.000Z', '2026-08-26T09:00:00.000Z'
    );
    INSERT INTO product_families(id, title, brand, created_at, updated_at)
    VALUES (
      'family_incident', 'Incident product', '',
      '2026-08-26T09:00:00.000Z', '2026-08-26T09:00:00.000Z'
    );
    INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
    VALUES (
      'variant_incident', 'family_incident', 'Incident product', '{}',
      '2026-08-26T09:00:00.000Z', '2026-08-26T09:00:00.000Z'
    );
    INSERT INTO listings(
      id, variant_id, retailer_id, retailer_sku, canonical_url, status,
      execution_supported, msrp_cents, currency, created_at, updated_at
    ) VALUES (
      'listing_incident', 'variant_incident', 'target', 'INCIDENT-1',
      'https://www.target.com/p/-/A-INCIDENT-1', 'active', 0, 1000, 'USD',
      '2026-08-26T09:00:00.000Z', '2026-08-26T09:00:00.000Z'
    );
    INSERT INTO signal_events(
      id, tenant_id, user_id, source_connection_id, signal_id,
      external_event_id, transport_hash, schema_version, source, event_type,
      test, observed_at, received_at, identity_json, offer_json,
      evidence_json, parser_version, resolution_status, created_at
    ) VALUES (
      'event_incident_a', 'tenant_incident_a', 'user_incident_a', 'source_incident_a',
      'signal_incident_a', 'external_incident_a', 'transport_incident_a', 1,
      'trackalacker', 'restock', 0,
      '2026-08-26T09:00:00.000Z', '2026-08-26T09:00:00.000Z',
      '{}', '{}', '{}', 'trackalacker-push-v1', 'matched',
      '2026-08-26T09:00:00.000Z'
    );
    INSERT INTO signal_incidents(
      id, listing_id, event_type, semantic_key, status, unit_price_cents,
      currency, seller_name, seller_type, offer_fingerprint,
      first_observed_at, last_observed_at, occurrence_count,
      closed_reason, created_at, updated_at
    ) VALUES (
      'incident_owned_v48', 'listing_incident', 'restock', 'semantic_incident',
      'open', 1000, 'USD', 'Target', 'first_party', 'offer_incident',
      '2026-08-26T09:00:00.000Z', '2026-08-26T09:00:00.000Z', 1, '',
      '2026-08-26T09:00:00.000Z', '2026-08-26T09:00:00.000Z'
    );
    INSERT INTO signal_occurrences(
      id, event_id, incident_id, source_connection_id,
      observed_at, received_at, created_at
    ) VALUES (
      'occurrence_incident_a', 'event_incident_a', 'incident_owned_v48',
      'source_incident_a', '2026-08-26T09:00:00.000Z',
      '2026-08-26T09:00:00.000Z', '2026-08-26T09:00:00.000Z'
    );
  `);
  if (ambiguousOwner) {
    legacy.exec(`
      INSERT INTO tenants(id, name, created_at)
      VALUES ('tenant_incident_b', 'Incident B', '2026-08-26T09:00:00.000Z');
      INSERT INTO users(id, tenant_id, display_name, created_at)
      VALUES ('user_incident_b', 'tenant_incident_b', 'Incident B', '2026-08-26T09:00:00.000Z');
      INSERT INTO source_connections(
        id, tenant_id, user_id, source, name, status, trust_level,
        auto_create_missions, is_private, last_event_at, created_at, updated_at
      ) VALUES (
        'source_incident_b', 'tenant_incident_b', 'user_incident_b',
        'trackalacker', 'TrackaLacker B', 'connected', 'trusted_exact',
        1, 1, '2026-08-26T09:00:00.000Z',
        '2026-08-26T09:00:00.000Z', '2026-08-26T09:00:00.000Z'
      );
      INSERT INTO signal_events(
        id, tenant_id, user_id, source_connection_id, signal_id,
        external_event_id, transport_hash, schema_version, source, event_type,
        test, observed_at, received_at, identity_json, offer_json,
        evidence_json, parser_version, resolution_status, created_at
      ) VALUES (
        'event_incident_b', 'tenant_incident_b', 'user_incident_b', 'source_incident_b',
        'signal_incident_b', 'external_incident_b', 'transport_incident_b', 1,
        'trackalacker', 'restock', 0,
        '2026-08-26T09:00:00.000Z', '2026-08-26T09:00:00.000Z',
        '{}', '{}', '{}', 'trackalacker-push-v1', 'matched',
        '2026-08-26T09:00:00.000Z'
      );
      INSERT INTO signal_occurrences(
        id, event_id, incident_id, source_connection_id,
        observed_at, received_at, created_at
      ) VALUES (
        'occurrence_incident_b', 'event_incident_b', 'incident_owned_v48',
        'source_incident_b', '2026-08-26T09:00:00.000Z',
        '2026-08-26T09:00:00.000Z', '2026-08-26T09:00:00.000Z'
      );
    `);
  }
  legacy.close();
}

test("migration 48 assigns every signal incident one exact owner and preserves child references", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-signal-incident-owner-upgrade-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    createVersion47SignalIncidentFixture(filePath);
    const upgraded = new YoinkDatabase(filePath);
    try {
      assert.deepEqual({ ...upgraded.get(
        "SELECT tenant_id AS tenantId, user_id AS userId FROM signal_incidents WHERE id = 'incident_owned_v48'"
      ) }, {
        tenantId: "tenant_incident_a",
        userId: "user_incident_a"
      });
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM signal_occurrences WHERE incident_id = 'incident_owned_v48'"
      )?.count, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 48 AND name = 'tenant_owned_signal_incidents'"
      )?.count, 1);
      assert.deepEqual(upgraded.all("PRAGMA foreign_key_check"), []);
      assert.equal(upgraded.get<{ foreign_keys: number }>("PRAGMA foreign_keys")?.foreign_keys, 1);
      assert.equal(upgraded.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'signal_incidents_listing_owner_idx'"
      )?.count, 1);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 48 fails atomically when historical evidence gives one incident multiple owners", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-signal-incident-ambiguous-upgrade-"));
  const filePath = join(directory, "yoink.sqlite");
  try {
    createVersion47SignalIncidentFixture(filePath, true);
    assert.throws(
      () => new YoinkDatabase(filePath),
      /distinct_owner_count|CHECK constraint failed/
    );
    const preserved = new DatabaseSync(filePath, { readOnly: true });
    try {
      assert.equal(preserved.prepare(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 48"
      ).get()?.count, 0);
      assert.equal(preserved.prepare(
        "SELECT COUNT(*) AS count FROM pragma_table_info('signal_incidents') WHERE name IN ('tenant_id', 'user_id')"
      ).get()?.count, 0);
      assert.equal(preserved.prepare(
        "SELECT COUNT(*) AS count FROM signal_incidents WHERE id = 'incident_owned_v48'"
      ).get()?.count, 1);
    } finally {
      preserved.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
