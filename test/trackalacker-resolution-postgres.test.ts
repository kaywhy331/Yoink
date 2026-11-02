import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildPostgresHostedDeliveryLeaseRecoveryManifest, hostedSignalResolutionPlanFunctionSource } from "../packages/database/src/postgres-hosted-delivery-lease-recovery.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "../packages/database/src/postgres-tenant-session.js";
import { SIGNAL_INGRESS_EVENT_TYPE } from "../packages/contracts/src/signal-ingress.js";
import { stableHash } from "../packages/domain/src/ids.js";

test("the complete PostgreSQL resolution planner preserves relink ambiguity and ignores stale product routes", async () => {
  const db = new PGlite();
  try {
    const manifest = buildPostgresHostedDeliveryLeaseRecoveryManifest();
    const schema = manifest.schemaName;
    await db.exec(`
      CREATE SCHEMA ${schema};
      SET search_path TO ${schema},public;
      CREATE TABLE ${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE}(principal_role text,tenant_id text,user_id text,active boolean);
      INSERT INTO ${POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE} VALUES (session_user::text,'tenant_fixture','user_fixture',true);
      CREATE TABLE inbox_messages(id text,tenant_id text,user_id text,source text,event_type text,payload_hash text,payload_json text,lease_capability_hash text,lease_expires_at text,state text);
      CREATE TABLE source_connections(id text,tenant_id text,user_id text,source text,trust_level text,auto_create_missions int);
      INSERT INTO source_connections VALUES ('source_fixture','tenant_fixture','user_fixture','trackalacker','trusted_exact',1);
      CREATE TABLE signal_events(id text,tenant_id text,user_id text,source_connection_id text,external_event_id text,signal_id text,transport_hash text);
      CREATE TABLE variants(id text,title text);
      INSERT INTO variants VALUES ('variant_parent','Pokemon Mega Evolution Elite Trainer Box'),('variant_other','A separate exact item');
      CREATE TABLE listings(id text,variant_id text,retailer_id text,retailer_sku text,canonical_url text,execution_supported int,msrp_cents bigint,currency text);
      INSERT INTO listings VALUES
        ('listing_kept','variant_parent','walmart','17964660878','https://www.walmart.com/ip/17964660878',1,5999,'USD'),
        ('listing_incoming','variant_other','walmart','17941473739','https://www.walmart.com/ip/17941473739',1,5999,'USD');
      CREATE TABLE source_listing_refs(source_connection_id text,external_listing_id text,listing_id text);
      INSERT INTO source_listing_refs VALUES ('source_fixture','236493','listing_kept');
      CREATE TABLE source_product_refs(source_connection_id text,external_product_id text,variant_id text);
      INSERT INTO source_product_refs VALUES ('source_fixture','8281','variant_parent');
      CREATE TABLE source_variant_retailer_refs(source_connection_id text,variant_id text,retailer_id text,listing_id text);
      INSERT INTO source_variant_retailer_refs VALUES ('source_fixture','variant_parent','walmart','listing_kept');
      CREATE TABLE source_product_aliases(source_connection_id text,alias_kind text,alias_value text,variant_id text);
      INSERT INTO source_product_aliases VALUES ('source_fixture','trackalacker_slug','pokemon-mega-evolution-elite-trainer-box','variant_parent');
      CREATE FUNCTION replay_resolution(expected_tenant_id text,expected_user_id text,target_message_id text,capability_token text)
      RETURNS TABLE(result_json text) LANGUAGE plpgsql AS $replay$
      ${hostedSignalResolutionPlanFunctionSource(manifest)}
      $replay$;
    `);
    let sequence = 0;
    async function resolve(identity: Record<string, unknown>) {
      const messageId = `inbox_replay_${++sequence}`;
      const capability = "a".repeat(43);
      const now = new Date().toISOString();
      const payload = JSON.stringify({
        schemaVersion: 1, signalId: `signal_replay_${sequence}`, sourceConnectionId: "source_fixture",
        source: "trackalacker", externalEventId: `event_replay_${sequence}`, eventType: "restock",
        observedAt: now, receivedAt: now, test: false, parserVersion: "trackalacker-push-v1",
        identity: { sourceProductId: "8281", sourceListingId: "236493", retailerId: "walmart",
          retailerSku: "17964660878", canonicalUrl: "", title: "Pokemon Mega Evolution Elite Trainer Box", globalIdentifiers: {}, ...identity },
        offer: { availability: "in_stock", unitPriceCents: 5999, currency: "USD", sellerName: "Walmart",
          sellerType: "first_party", orderLimit: null, fulfillment: "shipping", offerFingerprint: "" },
        evidence: { headline: "", body: "", msrpStatus: "", clickUrl: "" }
      });
      await db.query(`INSERT INTO inbox_messages VALUES ($1,'tenant_fixture','user_fixture','trackalacker',$2,$3,$4,$5,$6,'processing')`,
        [messageId, SIGNAL_INGRESS_EVENT_TYPE, stableHash("hosted_delivery_payload_v1", payload), payload,
          stableHash("hosted_delivery_capability_v1", messageId, capability), new Date(Date.now() + 60_000).toISOString()]);
      const response = await db.query<{ result_json: string }>(
        "SELECT * FROM replay_resolution('tenant_fixture','user_fixture',$1,$2)", [messageId, capability]);
      return JSON.parse(response.rows[0]!.result_json);
    }
    const matching = await resolve({});
    assert.equal(matching.resolution.status, "matched");
    assert.equal(matching.resolution.listing.id, "listing_kept");
    for (const identity of [{ retailerSku: "17941473739" }, { retailerId: "target", retailerSku: "" }]) {
      const conflict = await resolve(identity);
      assert.equal(conflict.outcome, "ambiguous");
      assert.equal(conflict.resolution.status, "ambiguous");
      assert.equal(conflict.resolution.method, "source_listing_id");
      assert.equal(conflict.resolution.listing, null);
      assert.equal(conflict.sharedCatalogMutationRequired, false);
    }
    const incoming = await resolve({ sourceListingId: "", retailerSku: "17941473739" });
    assert.equal(incoming.resolution.listing.id, "listing_incoming", "an unconflicted exact SKU still works");
    const product = { sourceListingId: "", retailerSku: "" };
    assert.equal((await resolve(product)).resolution.method, "source_product_preferred_retailer");
    await db.exec("UPDATE listings SET variant_id = 'variant_other' WHERE id = 'listing_kept'");
    for (const identity of [product, { ...product, sourceProductId: "", globalIdentifiers: { trackalacker_slug: "pokemon-mega-evolution-elite-trainer-box" } }]) {
      const stale = await resolve(identity);
      assert.equal(stale.resolution.status, "unresolved");
      assert.equal(stale.resolution.listing, null);
      assert.equal(stale.sharedCatalogMutationRequired, false);
    }
    assert.equal((await resolve({})).resolution.listing.variantId, "variant_other", "a consistent exact listing ID still resolves its retained item");
    assert.deepEqual((await db.query("SELECT listing_id FROM source_listing_refs")).rows, [{ listing_id: "listing_kept" }]);
    assert.equal((await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM signal_events")).rows[0]!.n, 0,
      "planning is read only; it never creates an event or alert");
  } finally { await db.close(); }
});
