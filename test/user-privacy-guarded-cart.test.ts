import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { MIGRATIONS } from "../packages/database/src/migrations.js";
import { buildPostgresSchemaManifest } from "../packages/database/src/postgres-schema-manifest.js";
import { runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";
import { UserPrivacyRepository } from "../packages/database/src/user-privacy-repository.js";

const NOW = "2026-10-25T12:00:00.000Z";
const TABLES = ["official_msrp_evidence", "single_cart_attempts", "amazon_approved_test"] as const;
const DELETION_TABLES = [...TABLES, "mission_intent_revisions"];
const AMAZON_ID = "amazon_test_20261002_B0D9ZTW7PS";
const SCOPES: RequestScope[] = [
  { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID, actorKind: "user", actorId: LOCAL_USER_ID },
  { tenantId: LOCAL_TENANT_ID, userId: "privacy_peer", actorKind: "user", actorId: "privacy_peer" },
  { tenantId: "privacy_other_tenant", userId: "privacy_other_user", actorKind: "user", actorId: "privacy_other_user" }
];
type Row = Record<string, SQLInputValue>;

function fixture(db: Pick<YoinkDatabase, "run">, amazonOwner = 0) {
  const insert = (table: string, row: Row) => db.run(
    `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`,
    ...Object.values(row)
  );
  insert("tenants", { id: SCOPES[2]!.tenantId, name: "Synthetic other tenant", created_at: NOW });
  for (const scope of SCOPES.slice(1)) insert("users", {
    id: scope.userId, tenant_id: scope.tenantId, display_name: scope.userId, created_at: NOW
  });
  insert("product_families", { id: "privacy_family", title: "Synthetic puzzle", created_at: NOW, updated_at: NOW });
  insert("variants", { id: "privacy_variant", family_id: "privacy_family", title: "Single item", created_at: NOW, updated_at: NOW });
  insert("retailers", { id: "privacy_store", display_name: "Synthetic store", created_at: NOW, updated_at: NOW });
  insert("listings", { id: "privacy_listing", variant_id: "privacy_variant", retailer_id: "privacy_store",
    retailer_sku: "PRIVACY-SKU", canonical_url: "https://privacy.invalid/item", created_at: NOW, updated_at: NOW });
  const evidence: Row[] = [];
  const attempts: Row[] = [];
  for (const scope of SCOPES) {
    const { tenantId, userId } = scope;
    const owned = { tenant_id: tenantId, user_id: userId };
    insert("extension_devices", { ...owned, id: `device_${userId}`, name: "Synthetic browser",
      token_hash: `PRIVATE_DEVICE_${userId}`, created_at: NOW, updated_at: NOW });
    insert("missions", { ...owned, id: `mission_${userId}`, variant_id: "privacy_variant", created_at: NOW, updated_at: NOW });
    insert("mission_intent_revisions", { ...owned, id: `intent_${userId}`, mission_id: `mission_${userId}`,
      revision: 1, quantity: 1, action_ceiling: "add_to_cart", substitution_policy: "exact_only",
      target_policy_json: "{}", policy_hash: `policy_${userId}`, created_by_actor_id: userId, created_at: NOW });
    const review = { ...owned, id: `evidence_${userId}`, listing_id: "privacy_listing", revision: 1,
      identity_hash: `identity_${userId}`, evidence_hash: `content_${userId}`, desired_variant: "Single item",
      variant_attributes_json: JSON.stringify({ size: "single" }), msrp_cents: 2999,
      source_url: "https://maker.invalid/puzzle", manufacturer_host: "maker.invalid",
      source_excerpt: `Synthetic MSRP for ${userId}`, source_checked_at: NOW, reviewed_by_actor_id: userId,
      reviewed_at: NOW, expires_at: "2026-11-01T12:00:00.000Z", status: "approved" };
    insert("official_msrp_evidence", review);
    evidence.push(review);
    const attempt = { ...owned, id: `attempt_${userId}`, mission_id: `mission_${userId}`, listing_id: "privacy_listing",
      device_id: `device_${userId}`, intent_revision_id: `intent_${userId}`, evidence_id: review.id,
      evidence_hash: review.evidence_hash, pause_settings_at: NOW, created_at: NOW, expires_at: review.expires_at,
      job_id: `job_${userId}`, state: "assigned" };
    insert("single_cart_attempts", attempt);
    attempts.push(attempt);
  }
  const owner = SCOPES[amazonOwner]!;
  const owned = { tenant_id: owner.tenantId, user_id: owner.userId };
  insert("source_connections", { ...owned, id: "privacy_source", source: "trackalacker", name: "Synthetic source",
    created_at: NOW, updated_at: NOW });
  insert("signal_events", { ...owned, id: "privacy_event", source_connection_id: "privacy_source", signal_id: "privacy_signal",
    external_event_id: "privacy_event", transport_hash: "privacy_transport", schema_version: 1, source: "trackalacker",
    event_type: "restock", observed_at: NOW, received_at: NOW, identity_json: "{}", offer_json: "{}",
    evidence_json: "{}", parser_version: "fixture", created_at: NOW });
  const before = { contractVersion: 1, retailerId: "amazon", observedAt: NOW, lineCount: 1,
    lines: [{ retailerSku: "EXISTING-ITEM", quantity: 2 }] };
  const offer = { contractVersion: 1, jobId: AMAZON_ID, retailerId: "amazon", retailerSku: "B0D9ZTW7PS",
    observedAt: NOW, unitPriceCents: 699, currency: "USD", sellerName: "Amazon.com", sellerType: "first_party", fulfillment: "shipping" };
  const proof = { contractVersion: 1, jobId: AMAZON_ID, retailerId: "amazon", retailerSku: "B0D9ZTW7PS",
    observedAt: NOW, quantity: 1, unitPriceCents: 699, sellerName: "Amazon.com", sellerType: "first_party" };
  const after = { ...before, lineCount: 2, lines: [...before.lines, { retailerSku: "B0D9ZTW7PS", quantity: 1 }] };
  const amazon = { ...owned, id: AMAZON_ID, listing_id: "privacy_listing", device_id: `device_${owner.userId}`,
    source_event_id: "privacy_event", authority_json: '{"authority":"PRIVATE_AUTHORITY"}', state: "cart_verified",
    capability_hash: "PRIVATE_CAPABILITY", lease_expires_at: NOW, pause_settings_at: NOW,
    listing_identity_hash: "public_listing_fingerprint", before_cart_json: JSON.stringify({ ...before,
      authority: "PRIVATE_NESTED_AUTHORITY", lines: before.lines.map(line => ({ ...line, lease_hash: "PRIVATE_LINE_LEASE" })) }),
    offer_proof_json: JSON.stringify({ ...offer, capability_hash: "PRIVATE_OFFER_CAPABILITY" }),
    final_cart_json: JSON.stringify({ proof: { ...proof, capabilityToken: "PRIVATE_PROOF_CAPABILITY" },
      after: { ...after, lease_capability_hash: "PRIVATE_AFTER_LEASE" }, authority: "PRIVATE_FINAL_AUTHORITY" }),
    expires_at: "2026-11-01T12:00:00.000Z", created_at: NOW, updated_at: NOW };
  insert("amazon_approved_test", amazon);
  return { evidence, attempts, amazon, before, offer, proof, after };
}

function withoutOwnership({ tenant_id: _tenant, user_id: _user, ...row }: Row): Row { return row; }

for (const amazonOwner of [0, 1, 2]) {
  test(`guarded cart export isolates every actor and redacts security material (Amazon owner ${amazonOwner})`, () => {
    const db = new YoinkDatabase();
    try {
      const f = fixture(db, amazonOwner);
      const privacy = new UserPrivacyRepository(db);
      for (const [index, scope] of SCOPES.entries()) {
        const archive = JSON.parse(JSON.stringify(runWithRequestScope(scope, () => privacy.export(Date.parse(NOW))))) as ReturnType<UserPrivacyRepository["export"]>;
        const inventory = runWithRequestScope(scope, () => privacy.inventory(Date.parse(NOW)));
        const { variant_attributes_json: _attributes, ...review } = withoutOwnership(f.evidence[index]!);
        assert.deepEqual(archive.data.catalog_and_plans!.official_msrp_evidence,
          [{ ...review, variant_attributes: { size: "single" } }]);
        assert.deepEqual(archive.data.actions_and_spending!.single_cart_attempts, [withoutOwnership(f.attempts[index]!)]);
        const { authority_json: _authority, capability_hash: _capability,
          before_cart_json: _before, offer_proof_json: _offer, final_cart_json: _final, ...amazon } = withoutOwnership(f.amazon);
        assert.deepEqual(archive.data.actions_and_spending!.amazon_approved_test, index === amazonOwner ? [{ ...amazon,
          before_cart: f.before, offer_proof: f.offer, final_cart: { proof: f.proof, after: f.after } }] : []);
        assert.doesNotMatch(JSON.stringify(archive), /PRIVATE_|authority_json|capability_hash|lease_hash|lease_capability_hash|capabilityToken/);
        assert.deepEqual(inventory.categories, archive.inventory.categories);
        assert.equal(inventory.totalRecords, archive.inventory.totalRecords);
        assert.equal(archive.inventory.accountDeletion.available, false);
      }
      const wrongTenant = runWithRequestScope({ ...SCOPES[amazonOwner]!, tenantId: "unowned_tenant" }, () => privacy.export());
      assert.deepEqual(wrongTenant.data.catalog_and_plans!.official_msrp_evidence, []);
      assert.deepEqual(wrongTenant.data.actions_and_spending!.single_cart_attempts, []);
      assert.deepEqual(wrongTenant.data.actions_and_spending!.amazon_approved_test, []);
    } finally { db.close(); }
  });

  test(`user deletion physically removes guarded cart rows without affecting peers (Amazon owner ${amazonOwner})`, () => {
    const db = new YoinkDatabase();
    try {
      fixture(db, amazonOwner);
      const owner = SCOPES[amazonOwner]!;
      const peer = SCOPES[(amazonOwner + 1) % SCOPES.length]!;
      for (const scope of SCOPES) {
        assert.throws(() => db.run("DELETE FROM mission_intent_revisions WHERE user_id = ?", scope.userId), /mission intent revisions are append-only/);
        assert.throws(() => db.run("UPDATE mission_intent_revisions SET quantity = 2 WHERE user_id = ?", scope.userId), /mission intent revisions are append-only/);
      }
      const ownerRows = DELETION_TABLES.map(table => db.all(`SELECT * FROM ${table} WHERE tenant_id = ? AND user_id = ?`, owner.tenantId, owner.userId));
      const survivor = SCOPES.find(scope => scope !== owner && scope !== peer)!;
      const survivorRows = DELETION_TABLES.map(table => db.all(`SELECT * FROM ${table} WHERE tenant_id = ? AND user_id = ?`, survivor.tenantId, survivor.userId));
      db.run("DELETE FROM users WHERE tenant_id = ? AND id = ?", peer.tenantId, peer.userId);
      for (const [index, table] of DELETION_TABLES.entries()) {
        assert.equal(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, peer.userId)?.n, 0);
        assert.deepEqual(db.all(`SELECT * FROM ${table} WHERE tenant_id = ? AND user_id = ?`, owner.tenantId, owner.userId), ownerRows[index]);
      }
      db.run("DELETE FROM users WHERE tenant_id = ? AND id = ?", owner.tenantId, owner.userId);
      for (const [index, table] of DELETION_TABLES.entries()) {
        assert.equal(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, owner.userId)?.n, 0);
        assert.deepEqual(db.all(`SELECT * FROM ${table} WHERE tenant_id = ? AND user_id = ?`, survivor.tenantId, survivor.userId), survivorRows[index]);
      }
      assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM official_msrp_evidence WHERE user_id = ?", survivor.userId)?.n, 1);
      assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM single_cart_attempts WHERE user_id = ?", survivor.userId)?.n, 1);
      assert.deepEqual(db.all("PRAGMA foreign_key_check"), []);
    } finally { db.close(); }
  });
}

test("migration82 preserves populated v81 privacy rows and indexes before enabling user cascades", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-privacy82-"));
  const path = join(directory, "fixture.sqlite");
  try {
    const old = new DatabaseSync(path);
    try {
      old.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT;");
      for (const migration of MIGRATIONS.filter(migration => migration.version <= 81)) {
        old.exec(migration.sql);
        old.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(migration.version, migration.name, NOW);
      }
      old.exec("PRAGMA foreign_keys=ON;");
      fixture({ run: (sql, ...params) => old.prepare(sql).run(...params) });
      const tables = (old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY name").all() as Array<{ name: string }>).map(row => row.name);
      const rows = () => tables.map(table => [table, old.prepare(`SELECT * FROM ${table}`).all().map(row => JSON.stringify(row)).sort()]);
      const indexes = () => tables.map(table => [table,
        (old.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number; origin: string; partial: number }>).map(index => ({
          name: index.name.replace("_v82", ""), unique: index.unique, origin: index.origin, partial: index.partial,
          columns: old.prepare(`PRAGMA index_xinfo(${index.name})`).all(),
          sql: old.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(index.name)?.sql
        })).sort((a, b) => a.name.localeCompare(b.name))
      ]);
      const beforeRows = rows();
      const beforeIndexes = indexes();
      const updateTrigger = old.prepare("SELECT sql FROM sqlite_master WHERE name='mission_intent_revisions_no_update'").get()?.sql;
      assert.throws(() => old.prepare("DELETE FROM mission_intent_revisions WHERE user_id = ?").run(LOCAL_USER_ID), /mission intent revisions are append-only/);
      assert.throws(() => old.prepare("DELETE FROM users WHERE id = ?").run(LOCAL_USER_ID), /mission intent revisions are append-only/);
      assert.deepEqual(old.prepare("PRAGMA foreign_key_check").all(), []);
      const migration = MIGRATIONS.find(migration => migration.version === 82)!;
      old.exec("BEGIN IMMEDIATE");
      old.exec(migration.sql);
      old.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(migration.version, migration.name, NOW);
      old.exec("COMMIT");
      assert.deepEqual(rows(), beforeRows, "every existing row survives migration82 unchanged");
      assert.deepEqual(indexes(), beforeIndexes, "every index retains its columns, uniqueness and predicate");
      assert.equal(old.prepare("SELECT sql FROM sqlite_master WHERE name='mission_intent_revisions_no_update'").get()?.sql, updateTrigger);
    } finally { old.close(); }
    const upgraded = new YoinkDatabase(path, { migrationMode: "require_current" });
    try {
      assert.equal(upgraded.get<{ version: number }>("SELECT MAX(version) AS version FROM schema_migrations")?.version, 82);
      for (const table of TABLES) {
        const userEdge = upgraded.all<{ from: string; on_delete: string }>(`PRAGMA foreign_key_list(${table})`).find(edge => edge.from === "user_id");
        assert.equal(userEdge?.on_delete, "CASCADE");
      }
      assert.throws(() => upgraded.run("DELETE FROM mission_intent_revisions WHERE user_id = ?", LOCAL_USER_ID), /mission intent revisions are append-only/);
      assert.throws(() => upgraded.run("UPDATE mission_intent_revisions SET quantity = 2 WHERE user_id = ?", LOCAL_USER_ID), /mission intent revisions are append-only/);
      assert.throws(() => upgraded.run("UPDATE single_cart_attempts SET job_id = ? WHERE user_id = ?", `job_${LOCAL_USER_ID}`, SCOPES[1]!.userId), /UNIQUE/);
      assert.throws(() => upgraded.run("INSERT INTO single_cart_attempts SELECT 'duplicate',tenant_id,user_id,mission_id,listing_id,device_id,intent_revision_id,evidence_id,evidence_hash,pause_settings_at,created_at,expires_at,'','armed' FROM single_cart_attempts WHERE user_id = ?", LOCAL_USER_ID), /UNIQUE/);
      upgraded.run("DELETE FROM users WHERE id = ?", LOCAL_USER_ID);
      for (const table of DELETION_TABLES) assert.equal(upgraded.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, LOCAL_USER_ID)?.n, 0);
      assert.deepEqual(upgraded.all("PRAGMA foreign_key_check"), []);
      assert.equal(upgraded.get<{ integrity_check: string }>("PRAGMA integrity_check")?.integrity_check, "ok");
    } finally { upgraded.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the PostgreSQL schema translation inherits user cascades and the conditional intent delete guard", () => {
  const manifest = buildPostgresSchemaManifest();
  for (const table of TABLES) {
    const descriptor = manifest.tables.find(candidate => candidate.name === table)!;
    assert.equal(descriptor.foreignKeys.find(edge => edge.targetTable === "users")?.onDelete, "CASCADE");
  }
  const intents = manifest.tables.find(table => table.name === "mission_intent_revisions")!;
  const deletion = intents.triggers.find(trigger => trigger.name === "mission_intent_revisions_no_delete")!;
  assert.equal(deletion.condition.replace(/\s+/g, " ").trim(), "EXISTS ( SELECT 1 FROM users WHERE tenant_id = OLD.tenant_id AND id = OLD.user_id )");
  assert.deepEqual(deletion.action, { kind: "reject", message: "mission intent revisions are append-only" });
  assert.equal(intents.triggers.find(trigger => trigger.name === "mission_intent_revisions_no_update")?.condition, "");
});
