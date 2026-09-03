import assert from "node:assert/strict";
import test from "node:test";
import { AdminOverviewRepository } from "../packages/database/src/admin-overview-repository.js";
import { AuditRepository } from "../packages/database/src/audit-repository.js";
import { CatalogGovernanceRepository } from "../packages/database/src/catalog-governance-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";

const NOW = new Date("2026-09-01T12:00:00.000Z").getTime();
const RECENT = new Date(NOW - 60 * 60_000).toISOString();
const OLDER = new Date(NOW - 48 * 60 * 60_000).toISOString();
const ONLINE = new Date(NOW - 60_000).toISOString();

function insertActionFixture(db: YoinkDatabase): void {
  db.run("INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES (?, ?, '', ?, ?)", "family_overview", "Overview family", OLDER, RECENT);
  db.run("INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)", "variant_overview", "family_overview", "Overview product", OLDER, RECENT);
  db.run("INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status, execution_supported, msrp_cents, currency, created_at, updated_at) VALUES (?, ?, 'target', '9000000099', ?, 'in_stock', 1, 2499, 'USD', ?, ?)", "listing_overview", "variant_overview", "https://www.target.com/p/-/A-9000000099", OLDER, RECENT);
  db.run("INSERT INTO missions(id, tenant_id, user_id, variant_id, status, origin, target_quantity, fulfilled_quantity, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'manual', 3, 0, ?, ?)", "mission_overview", LOCAL_TENANT_ID, LOCAL_USER_ID, "variant_overview", OLDER, RECENT);
  db.run("INSERT INTO mission_targets(id, mission_id, listing_id, enabled, max_unit_price_cents, currency, seller_policy, fulfillment, created_at, updated_at) VALUES (?, ?, ?, 1, 2499, 'USD', 'first_party_only', 'shipping', ?, ?)", "target_overview", "mission_overview", "listing_overview", OLDER, RECENT);
  db.run("INSERT INTO signal_incidents(id, tenant_id, user_id, listing_id, event_type, semantic_key, status, unit_price_cents, currency, seller_name, seller_type, offer_fingerprint, first_observed_at, last_observed_at, occurrence_count, closed_reason, created_at, updated_at) VALUES (?, ?, ?, ?, 'in_stock', ?, 'open', 1999, 'USD', 'Target', 'first_party', ?, ?, ?, 1, '', ?, ?)", "incident_overview", LOCAL_TENANT_ID, LOCAL_USER_ID, "listing_overview", "overview-semantic", "overview-offer", OLDER, RECENT, OLDER, RECENT);

  for (const [id, createdAt, state] of [
    ["job_overview_recent_carted", RECENT, "confirmed"],
    ["job_overview_recent_missed", RECENT, "cancelled"],
    ["job_overview_old_carted", OLDER, "confirmed"]
  ] as Array<[string, string, string]>) {
    db.run(
      `INSERT INTO action_jobs(
         id, tenant_id, user_id, mission_id, mission_target_id, incident_id, state, action,
         quantity, max_unit_price_cents, max_order_total_cents, currency, seller_policy,
         fulfillment, expected_seller, listing_id, canonical_url, idempotency_key,
         capability_nonce_hash, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'add_to_cart', 1, 2499, 2499, 'USD',
         'first_party_only', 'shipping', 'Target', ?, ?, ?, ?, ?, ?, ?)`,
      id,
      LOCAL_TENANT_ID,
      LOCAL_USER_ID,
      "mission_overview",
      "target_overview",
      "incident_overview",
      state,
      "listing_overview",
      "https://www.target.com/p/-/A-9000000099",
      `idempotency_${id}`,
      `nonce_${id}`,
      new Date(NOW + 60 * 60_000).toISOString(),
      createdAt,
      createdAt
    );
  }

  db.run("INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at) VALUES (?, ?, 'confirmed', 'exact_cart_delta_verified', 'Cart verified.', '{}', ?)", "event_recent_carted", "job_overview_recent_carted", RECENT);
  db.run("INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at) VALUES (?, ?, 'confirmed', 'user_reported_order', 'Checkout reported.', '{}', ?)", "event_recent_got_it", "job_overview_recent_carted", RECENT);
  db.run("INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at) VALUES (?, ?, 'cancelled', 'user_reported_missed_it', 'Miss reported.', '{}', ?)", "event_recent_missed", "job_overview_recent_missed", RECENT);
  db.run("INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at) VALUES (?, ?, 'confirmed', 'exact_cart_delta_verified', 'Cart verified.', '{}', ?)", "event_old_carted", "job_overview_old_carted", OLDER);
}

function insertSignal(db: YoinkDatabase, suffix: string, createdAt: string): void {
  db.run(
    `INSERT INTO signal_events(
       id, tenant_id, user_id, source_connection_id, signal_id, external_event_id,
       transport_hash, schema_version, source, event_type, test, observed_at, received_at,
       identity_json, offer_json, evidence_json, parser_version, resolution_status, created_at
     ) VALUES (?, ?, ?, 'source_trackalacker_local', ?, ?, ?, 1, 'trackalacker', 'in_stock', 0,
       ?, ?, '{}', '{}', '{}', 'test-v1', 'resolved', ?)`,
    `signal_event_${suffix}`,
    LOCAL_TENANT_ID,
    LOCAL_USER_ID,
    `signal_${suffix}`,
    `external_${suffix}`,
    `transport_${suffix}`,
    createdAt,
    createdAt,
    createdAt
  );
}

test("admin overview reports independent 24-hour and 7-day activity windows", () => {
  const db = new YoinkDatabase();
  try {
    insertActionFixture(db);
    insertSignal(db, "recent", RECENT);
    insertSignal(db, "old", OLDER);
    db.run("INSERT INTO hosted_delivery_receipts(id, tenant_id, user_id, direction, message_id, disposition, attempt, reason_code, receipt_hash, created_at) VALUES (?, ?, ?, 'inbox', ?, 'dead_letter', 3, 'fixture', ?, ?)", "receipt_recent_dead", LOCAL_TENANT_ID, LOCAL_USER_ID, "message_recent", "hash_recent", RECENT);
    db.run("INSERT INTO hosted_delivery_receipts(id, tenant_id, user_id, direction, message_id, disposition, attempt, reason_code, receipt_hash, created_at) VALUES (?, ?, ?, 'inbox', ?, 'dead_letter', 3, 'fixture', ?, ?)", "receipt_old_dead", LOCAL_TENANT_ID, LOCAL_USER_ID, "message_old", "hash_old", OLDER);
    db.run("INSERT INTO attribution_receipts(id, tenant_id, user_id, job_id, policy_id, retailer_id, provider, outcome, reason_code, route_url, canonical_url_hash, created_at) VALUES (?, ?, ?, ?, NULL, 'target', 'howl', 'affiliate_route', 'howl_enabled', 'https://howl.link/link', 'overview_url_hash', ?)", "overview_attribution", LOCAL_TENANT_ID, LOCAL_USER_ID, "job_overview_recent_carted", RECENT);
    new AuditRepository(db).record({
      correlationId: "job_overview_recent_carted",
      aggregateType: "action_job",
      eventType: "store_link_clicked",
      reasonCode: "affiliate_route_opened",
      message: "Opened.",
      data: { retailerId: "target", routeKind: "affiliate" }
    }, new Date(RECENT).getTime());
    db.run("INSERT INTO extension_devices(id, tenant_id, user_id, name, token_hash, extension_version, status, capabilities_json, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, 'Overview Chrome', ?, '1.18.1', 'active', '{}', ?, ?, ?)", "device_overview", LOCAL_TENANT_ID, LOCAL_USER_ID, "token_hash_overview", ONLINE, OLDER, ONLINE);
    new CatalogGovernanceRepository(db).proposeListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "overview-proposal-product",
      sourceListingId: "overview-proposal-listing",
      title: "Overview proposed product",
      retailerId: "walmart",
      retailerSku: "9000000098",
      canonicalUrl: "https://www.walmart.com/ip/9000000098",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 1999,
      currency: "USD",
      observedAt: RECENT
    });

    const snapshot = new AdminOverviewRepository(db).snapshot(NOW);
    assert.deepEqual(snapshot.windows.hours24, {
      signalsReceived: 1,
      jobsCreated: 2,
      carted: 1,
      gotIt: 1,
      missed: 1,
      deadLetters: 1,
      routesIssued: 1,
      clicks: 1,
      conversions: 1
    });
    assert.deepEqual(snapshot.windows.days7, {
      signalsReceived: 2,
      jobsCreated: 3,
      carted: 2,
      gotIt: 1,
      missed: 1,
      deadLetters: 2,
      routesIssued: 1,
      clicks: 1,
      conversions: 1
    });
    assert.deepEqual(snapshot.waiting, { catalogProposals: 1, changeRequests: 0, incidents: 0 });
    assert.equal(snapshot.devicesOnline, 1);
    assert.equal(new AdminOverviewRepository(db).activeActionJobs(), 0);
    db.run("UPDATE action_jobs SET state = 'adding' WHERE id = ?", "job_overview_recent_missed");
    assert.equal(new AdminOverviewRepository(db).activeActionJobs(), 1);
  } finally {
    db.close();
  }
});

test("admin overview counts active plans per store for the advanced call preview", () => {
  const db = new YoinkDatabase();
  try {
    insertActionFixture(db);
    // A paused plan on the same store and a disabled target must not count.
    db.run("INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)", "variant_overview_paused", "family_overview", "Overview paused product", OLDER, RECENT);
    db.run("INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status, execution_supported, msrp_cents, currency, created_at, updated_at) VALUES (?, ?, 'target', '9000000098', ?, 'in_stock', 1, 2499, 'USD', ?, ?)", "listing_overview_paused", "variant_overview_paused", "https://www.target.com/p/-/A-9000000098", OLDER, RECENT);
    db.run("INSERT INTO missions(id, tenant_id, user_id, variant_id, status, origin, target_quantity, fulfilled_quantity, created_at, updated_at) VALUES (?, ?, ?, ?, 'paused', 'manual', 1, 0, ?, ?)", "mission_overview_paused", LOCAL_TENANT_ID, LOCAL_USER_ID, "variant_overview_paused", OLDER, RECENT);
    db.run("INSERT INTO mission_targets(id, mission_id, listing_id, enabled, max_unit_price_cents, currency, seller_policy, fulfillment, created_at, updated_at) VALUES (?, ?, ?, 1, 2499, 'USD', 'first_party_only', 'shipping', ?, ?)", "target_overview_paused", "mission_overview_paused", "listing_overview_paused", OLDER, RECENT);
    db.run("INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status, execution_supported, msrp_cents, currency, created_at, updated_at) VALUES (?, ?, 'walmart', '5700000099', ?, 'in_stock', 1, 2499, 'USD', ?, ?)", "listing_overview_walmart", "variant_overview", "https://www.walmart.com/ip/5700000099", OLDER, RECENT);
    db.run("INSERT INTO mission_targets(id, mission_id, listing_id, enabled, max_unit_price_cents, currency, seller_policy, fulfillment, created_at, updated_at) VALUES (?, ?, ?, 0, 2499, 'USD', 'first_party_only', 'shipping', ?, ?)", "target_overview_walmart_disabled", "mission_overview", "listing_overview_walmart", OLDER, RECENT);
    assert.deepEqual(new AdminOverviewRepository(db).activePlansByStore(), { target: 1 });
  } finally {
    db.close();
  }
});
