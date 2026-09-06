import assert from "node:assert/strict";
import test from "node:test";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope } from "../packages/database/src/request-scope.js";

test("catalog stock and price retain their own evidence and never expose another user's source", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const { listing } = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
      sourceProductId: "provenance-product", sourceListingId: "provenance-listing",
      title: "Observation product", retailerId: "target", retailerSku: "95003001",
      canonicalUrl: "https://www.target.com/p/-/A-95003001", listingStatus: "in_stock",
      executionSupported: true, observedPriceCents: 1999, currency: "USD",
      observedAt: "2026-09-01T10:00:00.000Z"
    });
    const insert = (id: string, availability: string, price: number | null, at: string) => db.run(
      `INSERT INTO offer_observations(id, listing_id, source_connection_id, availability, unit_price_cents, observed_at, created_at)
       VALUES (?, ?, 'source_browser_local', ?, ?, ?, ?)`, id, listing.id, availability, price, at, at
    );
    insert("observation_new", "out_of_stock", null, "2026-09-01T11:00:00.000Z");
    // A catalog edit and a late old event cannot make old evidence look fresh.
    db.run("UPDATE listings SET updated_at = '2026-09-05T10:00:00.000Z' WHERE id = ?", listing.id);
    insert("observation_late", "in_stock", 999, "2026-08-30T10:00:00.000Z");
    const read = () => {
      const flat = catalog.listLibrary()[0];
      const product = catalog.listLibraryProducts()[0];
      assert.ok(flat);
      assert.ok(product);
      const grouped = (product.listings as Array<Record<string, unknown>>)[0];
      assert.ok(grouped);
      return [flat, grouped];
    };
    for (const item of read()) {
      assert.equal(item.currentPriceCents, 1999);
      assert.equal(item.priceObservedAt, "2026-09-01T10:00:00.000Z");
      assert.equal(item.priceSource, "trackalacker");
      assert.equal(item.observedAvailability, "out_of_stock");
      assert.equal(item.availabilityObservedAt, "2026-09-01T11:00:00.000Z");
      assert.equal(item.availabilitySource, "browser");
      assert.equal(item.status, "in_stock", "this read does not rewrite execution policy or catalog filters");
    }
    for (const scope of [
      { ...LOCAL_REQUEST_SCOPE, userId: "user_other" },
      { ...LOCAL_REQUEST_SCOPE, tenantId: "tenant_other" }
    ]) runWithRequestScope(scope, () => {
      for (const item of read()) {
        assert.equal(item.priceSource, null);
        assert.equal(item.availabilitySource, null);
        assert.equal(item.currentPriceCents, 1999, "shared catalog evidence remains visible");
      }
    });
    insert("observation_same_a", "preorder", 2499, "2026-09-02T10:00:00.000Z");
    insert("observation_same_z", "unknown", 2999, "2026-09-02T10:00:00.000Z");
    for (const item of read()) {
      assert.equal(item.currentPriceCents, 2999);
      assert.equal(item.observedAvailability, "unknown", "latest unknown evidence must not borrow earlier in-stock evidence");
      assert.equal(item.priceObservedAt, item.availabilityObservedAt);
      assert.equal(item.priceSource, "browser");
    }
    db.run("UPDATE source_connections SET source = 'private-channel-name' WHERE id = 'source_browser_local'");
    for (const item of read()) {
      assert.equal(item.availabilitySource, null);
      assert.equal(item.priceSource, null);
      assert.doesNotMatch(JSON.stringify(item), /private-channel-name|source_browser_local/);
    }
    db.run("DELETE FROM offer_observations WHERE listing_id = ?", listing.id);
    for (const item of read()) {
      assert.equal(item.availabilityObservedAt, null);
      assert.equal(item.observedAvailability, null);
      assert.equal(item.priceObservedAt, null);
    }
  } finally { db.close(); }
});
