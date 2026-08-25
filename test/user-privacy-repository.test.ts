import assert from "node:assert/strict";
import test from "node:test";
import { AuditRepository } from "../packages/database/src/audit-repository.js";
import {
  LOCAL_TENANT_ID,
  LOCAL_USER_ID,
  YoinkDatabase
} from "../packages/database/src/database.js";
import {
  USER_DATA_EXPORT_FORMAT,
  USER_DATA_OWNERSHIP_TABLE_DISPOSITIONS,
  UserPrivacyRepository
} from "../packages/database/src/user-privacy-repository.js";
import { runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";

const NOW = "2026-08-25T04:00:00.000Z";

function categoryCounts(archive: ReturnType<UserPrivacyRepository["export"]>): Record<string, number> {
  return Object.fromEntries(Object.entries(archive.data).map(([category, section]) => [
    category,
    Object.values(section).reduce<number>((count, value) => count
      + (Array.isArray(value) ? value.length : value && typeof value === "object" ? 1 : 0), 0)
  ]));
}

test("user data export is complete by declared category, tenant-isolated, and credential closed", () => {
  const db = new YoinkDatabase();
  const privacy = new UserPrivacyRepository(db);
  try {
    db.run(
      `INSERT INTO extension_devices(
         id, tenant_id, user_id, name, token_hash, extension_version,
         status, capabilities_json, last_seen_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, '0.33.0', 'active', ?, ?, ?, ?)`,
      "device_privacy_local",
      LOCAL_TENANT_ID,
      LOCAL_USER_ID,
      "Privacy test Chrome",
      "DEVICE_TOKEN_SECRET_MUST_NOT_EXPORT",
      JSON.stringify({ notifications: true, observe: true }),
      NOW,
      NOW,
      NOW
    );
    db.run(
      `INSERT INTO device_pairing_codes(
         id, tenant_id, user_id, code_hash, expires_at, used_at, created_at
       ) VALUES (?, ?, ?, ?, ?, '', ?)`,
      "pair_privacy_local",
      LOCAL_TENANT_ID,
      LOCAL_USER_ID,
      "PAIRING_CODE_SECRET_MUST_NOT_EXPORT",
      "2026-08-25T04:05:00.000Z",
      NOW
    );
    db.run(
      `INSERT INTO hosted_request_nonces(
         tenant_id, user_id, nonce_hash, issued_at, expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      LOCAL_TENANT_ID,
      LOCAL_USER_ID,
      "HOSTED_NONCE_SECRET_MUST_NOT_EXPORT",
      NOW,
      "2026-08-25T04:05:00.000Z",
      NOW
    );
    new AuditRepository(db).record({
      correlationId: "privacy_local_marker",
      eventType: "privacy_local_marker",
      reasonCode: "test",
      message: "The authenticated user's event belongs in the export.",
      data: { marker: "LOCAL_USER_DATA_MARKER" }
    }, Date.parse(NOW));

    db.run("INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)", "tenant_privacy_other", "Other tenant", NOW);
    db.run(
      "INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)",
      "user_privacy_other",
      "tenant_privacy_other",
      "Other user",
      NOW
    );
    db.run(
      `INSERT INTO audit_events(
         id, tenant_id, user_id, correlation_id, event_type,
         reason_code, message, data_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "audit_privacy_other",
      "tenant_privacy_other",
      "user_privacy_other",
      "privacy_other_marker",
      "privacy_other_marker",
      "test",
      "This must never cross the tenant boundary.",
      JSON.stringify({ marker: "OTHER_USER_DATA_MUST_NOT_EXPORT" }),
      NOW
    );

    const inventory = privacy.inventory(Date.parse(NOW));
    const archive = privacy.export(Date.parse(NOW));
    const serialized = JSON.stringify(archive);
    assert.equal(archive.format, USER_DATA_EXPORT_FORMAT);
    assert.equal(archive.scope.tenantId, LOCAL_TENANT_ID);
    assert.equal(archive.scope.userId, LOCAL_USER_ID);
    assert.equal(archive.privacyClassification, "restricted_user");
    assert.equal(archive.inventory.credentialMaterialsExcluded, true);
    assert.equal(archive.inventory.accountDeletion.available, false);
    assert.equal(archive.inventory.accountDeletion.state, "infrastructure_gated");
    assert.equal(inventory.totalRecords, archive.inventory.totalRecords);
    assert.deepEqual(
      Object.fromEntries(archive.inventory.categories.map((category) => [category.id, category.recordCount])),
      categoryCounts(archive)
    );

    assert.match(serialized, /LOCAL_USER_DATA_MARKER/);
    assert.match(serialized, /device_privacy_local/);
    const deviceEvidence = archive.data.devices_and_retailer_evidence;
    assert.ok(deviceEvidence);
    assert.deepEqual(
      (deviceEvidence.devices as Array<Record<string, unknown>>)[0]?.capabilities,
      { notifications: true, observe: true }
    );
    assert.equal((deviceEvidence.devices as Array<Record<string, unknown>>)[0]?.credential_generation, 1);
    assert.equal((deviceEvidence.devices as Array<Record<string, unknown>>)[0]?.credential_issued_at, NOW);
    assert.equal((deviceEvidence.devices as Array<Record<string, unknown>>)[0]?.credential_rotation_pending, 0);
    assert.deepEqual(
      (archive.data.community_and_maintenance as Record<string, unknown>).observer_recipe_recovery_evidence,
      []
    );
    assert.doesNotMatch(serialized, /OTHER_USER_DATA_MUST_NOT_EXPORT/);
    assert.doesNotMatch(serialized, /DEVICE_TOKEN_SECRET_MUST_NOT_EXPORT/);
    assert.doesNotMatch(serialized, /PAIRING_CODE_SECRET_MUST_NOT_EXPORT/);
    assert.doesNotMatch(serialized, /HOSTED_NONCE_SECRET_MUST_NOT_EXPORT/);
    assert.doesNotMatch(serialized, /token_hash|code_hash|nonce_hash|capability_nonce_hash|capability_hash|lease_capability_hash/);

    const otherScope: RequestScope = {
      tenantId: "tenant_privacy_other",
      userId: "user_privacy_other",
      actorKind: "user",
      actorId: "user_privacy_other"
    };
    const otherArchive = runWithRequestScope(otherScope, () => privacy.export(Date.parse(NOW)));
    const otherSerialized = JSON.stringify(otherArchive);
    assert.match(otherSerialized, /OTHER_USER_DATA_MUST_NOT_EXPORT/);
    assert.doesNotMatch(otherSerialized, /LOCAL_USER_DATA_MARKER|device_privacy_local/);
  } finally {
    db.close();
  }
});

test("every schema table with a user ownership edge has an explicit export disposition", () => {
  const db = new YoinkDatabase();
  try {
    const userColumns = new Set([
      "user_id", "proposer_user_id", "requested_by_user_id",
      "reviewer_user_id", "subject_user_id"
    ]);
    const tables = db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).map((row) => row.name);
    const userOwned = tables.filter((table) => {
      const columns = db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((column) => column.name);
      const foreignKeys = db.all<{ table: string }>(`PRAGMA foreign_key_list(${table})`);
      return table === "users" || columns.some((column) => userColumns.has(column))
        || foreignKeys.some((foreignKey) => foreignKey.table === "users");
    });
    assert.deepEqual(userOwned, Object.keys(USER_DATA_OWNERSHIP_TABLE_DISPOSITIONS).sort());
    assert.equal(USER_DATA_OWNERSHIP_TABLE_DISPOSITIONS.community_contribution_nonces, "credential_material_excluded");
    assert.equal(USER_DATA_OWNERSHIP_TABLE_DISPOSITIONS.hosted_request_nonces, "credential_material_excluded");
  } finally {
    db.close();
  }
});
