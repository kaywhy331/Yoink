import assert from "node:assert/strict";
import test from "node:test";
import type { TrackalackerCatalogItemInput } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { SourceRepository } from "../packages/database/src/source-repository.js";

// Field, 2026-10-13: 11 of 739 followed products were refused on every hourly
// sync since 10-09 (409 variant_conflict / listing_already_mapped), so none of
// their stores refreshed. One store item now never holds back the others.

const PRODUCT_URL = "https://www.trackalacker.com/products/showcase/pokemon-journey-together-booster-bundle";

function item(overrides: { targetSku?: string; targetPrice?: number; walmartPrice?: number; observedAt: string }): TrackalackerCatalogItemInput {
  const targetSku = overrides.targetSku ?? "94300000";
  return {
    sourceProductId: "140001",
    sourceProductSlug: "pokemon-journey-together-booster-bundle",
    sourceProductUrl: PRODUCT_URL,
    title: "Pokemon Journey Together Booster Bundle",
    msrpCents: 2699,
    observedAt: overrides.observedAt,
    listings: [
      {
        sourceListingId: "7001",
        storeName: "Target",
        retailerId: "target",
        retailerSku: targetSku,
        canonicalUrl: `https://www.target.com/p/item/-/A-${targetSku}`,
        sourceListingUrl: `${PRODUCT_URL}/listings/7001/item`,
        outboundUrl: `https://www.target.com/p/item/-/A-${targetSku}`,
        availability: "in_stock",
        unitPriceCents: overrides.targetPrice ?? 2699
      },
      {
        sourceListingId: "7002",
        storeName: "Walmart",
        retailerId: "walmart",
        retailerSku: "5550001",
        canonicalUrl: "https://www.walmart.com/ip/item/5550001",
        sourceListingUrl: `${PRODUCT_URL}/listings/7002/item`,
        outboundUrl: "https://www.walmart.com/ip/item/5550001",
        availability: "in_stock",
        unitPriceCents: overrides.walmartPrice ?? 2697
      }
    ]
  };
}

function latestPrice(db: YoinkDatabase, retailerId: string, retailerSku: string): number | null {
  return db.get<{ price: number | null }>(
    `SELECT oo.unit_price_cents AS price FROM offer_observations oo JOIN listings l ON l.id = oo.listing_id
     WHERE l.retailer_id = ? AND l.retailer_sku = ? ORDER BY oo.observed_at DESC, oo.id DESC LIMIT 1`,
    retailerId, retailerSku
  )?.price ?? null;
}

function conflictNotes(db: YoinkDatabase): Array<{ reason: string; message: string }> {
  return db.all<{ reason: string; message: string }>(
    "SELECT reason_code AS reason, message FROM audit_events WHERE event_type = 'trackalacker_listing_conflict' ORDER BY created_at"
  );
}

test("a store item Yoink moved to another product stays there and still refreshes; the rest of the product syncs", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const first = catalog.upsertTrackalackerItem(item({ observedAt: "2026-10-13T10:00:00.000Z" }), Date.parse("2026-10-13T10:00:01.000Z"));
    // A barcode split (or the shopper) files the Walmart item under its own product.
    db.run(`INSERT INTO product_families(id, title, brand, created_at, updated_at)
            VALUES ('family_split', 'Journey Together Booster Bundle 2-Pack', '', '2026-10-13T11:00:00.000Z', '2026-10-13T11:00:00.000Z')`);
    db.run(`INSERT INTO variants(id, family_id, title, attributes_json, msrp_cents, created_at, updated_at)
            VALUES ('variant_split', 'family_split', 'Journey Together Booster Bundle 2-Pack', '{}', 5398, '2026-10-13T11:00:00.000Z', '2026-10-13T11:00:00.000Z')`);
    db.run("UPDATE listings SET variant_id = 'variant_split', msrp_cents = 5398 WHERE retailer_id = 'walmart'");

    const second = catalog.upsertTrackalackerItem(
      item({ targetPrice: 2499, walmartPrice: 2599, observedAt: "2026-10-13T12:00:00.000Z" }),
      Date.parse("2026-10-13T12:00:01.000Z")
    );
    assert.equal(second.variantId, first.variantId);
    assert.equal(second.listingsMapped, 2);
    assert.equal(latestPrice(db, "target", "94300000"), 2499);
    assert.equal(latestPrice(db, "walmart", "5550001"), 2599);
    const walmart = db.get<{ variantId: string; msrp: number }>(
      "SELECT variant_id AS variantId, msrp_cents AS msrp FROM listings WHERE retailer_id = 'walmart'");
    assert.equal(walmart?.variantId, "variant_split", "TrackaLacker's grouping never undoes Yoink's");
    assert.equal(walmart?.msrp, 5398, "the other product's MSRP is not overwritten with this one's");
    assert.equal(db.get<{ observedAt: string }>(
      "SELECT observed_at AS observedAt FROM source_variant_retailer_refs WHERE variant_id = ? AND retailer_id = 'walmart'", first.variantId)?.observedAt,
      "2026-10-13T10:00:00.000Z", "the moved item is not made this product's Walmart route again");
    assert.equal(db.get<{ variantId: string }>(
      "SELECT variant_id AS variantId FROM source_product_refs WHERE external_product_id = '140001'")?.variantId, first.variantId);

    catalog.upsertTrackalackerItem(item({ observedAt: "2026-10-13T13:00:00.000Z" }), Date.parse("2026-10-13T13:00:01.000Z"));
    const notes = conflictNotes(db);
    assert.deepEqual(notes.map((note) => note.reason), ["kept_in_other_product"], "noted once, not every hour");
    assert.match(notes[0]!.message, /Walmart item 5550001 under Pokemon Journey Together Booster Bundle; Yoink keeps it under Journey Together Booster Bundle 2-Pack/);
  } finally {
    db.close();
  }
});

test("a TrackaLacker listing that now links another store item keeps the one Yoink has; its other stores still sync", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    catalog.upsertTrackalackerItem(item({ observedAt: "2026-10-13T10:00:00.000Z" }), Date.parse("2026-10-13T10:00:01.000Z"));
    const relinked = item({ targetSku: "94399999", targetPrice: 1999, walmartPrice: 2599, observedAt: "2026-10-13T12:00:00.000Z" });

    const result = catalog.upsertTrackalackerItem(relinked, Date.parse("2026-10-13T12:00:01.000Z"));
    assert.equal(result.listingsMapped, 1);
    assert.equal(latestPrice(db, "walmart", "5550001"), 2599, "the product's other store refreshed");
    assert.equal(latestPrice(db, "target", "94300000"), 2699, "the kept item takes no price from the new link");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings WHERE retailer_sku = '94399999'")?.count, 0);
    assert.equal(db.get<{ sku: string }>(
      `SELECT l.retailer_sku AS sku FROM source_listing_refs r JOIN listings l ON l.id = r.listing_id
       WHERE r.external_listing_id = '7001'`)?.sku, "94300000");
    // The listing's candidate row is left as it was, so the next sync looks the link up again.
    assert.equal(db.get<{ sku: string; outbound: string }>(
      "SELECT retailer_sku AS sku, outbound_url AS outbound FROM source_listing_candidates WHERE external_listing_id = '7001'")?.sku, "94300000");

    catalog.upsertTrackalackerItem(relinked, Date.parse("2026-10-13T13:00:01.000Z"));
    const notes = conflictNotes(db);
    assert.deepEqual(notes.map((note) => note.reason), ["listing_already_mapped"]);
    assert.match(notes[0]!.message, /now links Target item 94399999 for Pokemon Journey Together Booster Bundle; Yoink keeps item 94300000/);

    const status = new SourceRepository(db).trackalackerStatus();
    const conflicts = status.listingConflicts as Array<Record<string, unknown>>;
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.reason, "listing_already_mapped");
    assert.equal(conflicts[0]!.retailerSku, "94399999");
    assert.equal(conflicts[0]!.keptRetailerSku, "94300000");
    assert.equal(conflicts[0]!.productTitle, "Pokemon Journey Together Booster Bundle");
  } finally {
    db.close();
  }
});
