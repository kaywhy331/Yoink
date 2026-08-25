import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteBackgroundWorkerStore } from "../../packages/database/src/background-worker-store.js";
import { YoinkDatabase } from "../../packages/database/src/database.js";
import { exportPortabilityArchive } from "../../packages/database/src/portability.js";

export const POSTGRES_TEST_WORKER_FINGERPRINT = "d".repeat(64);
export const POSTGRES_TEST_WORKER_VERSION = "postgres-worker-test";

export interface PostgresCutoverFixture {
  directory: string;
  sourcePath: string;
  archivePath: string;
}

export function createPostgresCutoverFixture(): PostgresCutoverFixture {
  const directory = mkdtempSync(join(tmpdir(), "yoink-postgres-cutover-"));
  const sourcePath = join(directory, "source.sqlite");
  const archivePath = join(directory, "snapshot.yoink.ndjson");
  const source = new YoinkDatabase(sourcePath);
  try {
    source.run(
      "INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)",
      "tenant_cutover_other",
      "Other cutover tenant",
      "2026-08-25T12:00:00.000Z"
    );
    source.run(
      "INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)",
      "user_cutover_other",
      "tenant_cutover_other",
      "Other cutover user",
      "2026-08-25T12:00:00.000Z"
    );
    source.run(
      "INSERT INTO app_settings(user_id, updated_at) VALUES (?, ?)",
      "user_cutover_other",
      "2026-08-25T12:00:00.000Z"
    );
    source.run(
      `INSERT INTO source_connections(
         id, tenant_id, user_id, source, name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "source_cutover_other",
      "tenant_cutover_other",
      "user_cutover_other",
      "fixture",
      "PostgreSQL fixture",
      "2026-08-25T12:00:00.000Z",
      "2026-08-25T12:00:00.000Z"
    );
    source.run(
      "INSERT INTO product_families(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
      "family_cutover_scope",
      "Cutover scope family",
      "2026-08-25T12:00:00.000Z",
      "2026-08-25T12:00:00.000Z"
    );
    source.run(
      "INSERT INTO variants(id, family_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      "variant_cutover_scope",
      "family_cutover_scope",
      "Cutover scope variant",
      "2026-08-25T12:00:00.000Z",
      "2026-08-25T12:00:00.000Z"
    );
    source.run(
      `INSERT INTO listings(
         id, variant_id, retailer_id, retailer_sku, canonical_url, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "listing_cutover_scope",
      "variant_cutover_scope",
      "target",
      "cutover-scope-sku",
      "https://www.target.com/p/-/A-cutover-scope-sku",
      "2026-08-25T12:00:00.000Z",
      "2026-08-25T12:00:00.000Z"
    );
    for (const [id, tenantId, userId] of [
      ["mission_cutover_local", "tenant_local", "user_local"],
      ["mission_cutover_other", "tenant_cutover_other", "user_cutover_other"]
    ] as const) {
      source.run(
        `INSERT INTO missions(id, tenant_id, user_id, variant_id, created_at, updated_at)
         VALUES (?, ?, ?, 'variant_cutover_scope', ?, ?)`,
        id,
        tenantId,
        userId,
        "2026-08-25T12:00:00.000Z",
        "2026-08-25T12:00:00.000Z"
      );
    }
    source.run(
      `INSERT INTO signal_events(
         id, tenant_id, user_id, source_connection_id, signal_id,
         external_event_id, transport_hash, schema_version, source, event_type,
         observed_at, received_at, identity_json, offer_json, evidence_json,
         parser_version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'fixture', 'restock', ?, ?, '{}', '{}', '{}', 'fixture-v1', ?)`,
      "signal_cutover_other",
      "tenant_cutover_other",
      "user_cutover_other",
      "source_cutover_other",
      "signal-cutover-other",
      "external-cutover-other",
      "transport-cutover-other",
      "2026-08-25T12:00:00.000Z",
      "2026-08-25T12:00:00.000Z",
      "2026-08-25T12:00:00.000Z"
    );
    source.run(
      `INSERT INTO offer_observations(
         id, listing_id, source_connection_id, availability, observed_at, created_at
       ) VALUES (?, 'listing_cutover_scope', ?, 'in_stock', ?, ?)`,
      "offer_cutover_other",
      "source_cutover_other",
      "2026-08-25T12:00:00.000Z",
      "2026-08-25T12:00:00.000Z"
    );
    source.run(
      `INSERT INTO offer_observations(
         id, listing_id, source_connection_id, availability, observed_at, created_at
       ) VALUES (?, 'listing_cutover_scope', NULL, 'unknown', ?, ?)`,
      "offer_cutover_shared",
      "2026-08-25T12:00:00.000Z",
      "2026-08-25T12:00:00.000Z"
    );
    for (let index = 0; index < 520; index += 1) {
      source.run(
        `INSERT INTO audit_events(
           id, tenant_id, user_id, correlation_id, event_type,
           reason_code, message, data_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `audit_cutover_${index.toString().padStart(4, "0")}`,
        "tenant_cutover_other",
        "user_cutover_other",
        `correlation_cutover_${index}`,
        "postgres_cutover_fixture",
        "fixture",
        `Cutover event ${index}`,
        JSON.stringify({ index, bounded: true }),
        "2026-08-25T12:00:00.000Z"
      );
    }
    new SqliteBackgroundWorkerStore(source).configureDeploymentExpectation(
      "external",
      POSTGRES_TEST_WORKER_FINGERPRINT,
      POSTGRES_TEST_WORKER_VERSION,
      new Date("2026-08-25T12:30:00.000Z").getTime()
    );
    exportPortabilityArchive(source, archivePath, "2026-08-25T13:00:00.000Z");
  } finally {
    source.close();
  }
  return { directory, sourcePath, archivePath };
}
