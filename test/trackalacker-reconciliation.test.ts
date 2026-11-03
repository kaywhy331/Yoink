import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SignalEventInput, TrackalackerCatalogItemInput } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { normalizeSignal } from "../packages/domain/src/normalize.js";
import { productFormOf } from "../packages/domain/src/product-form.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { enablePlansFromCalls } from "./helpers/plans-from-calls.js";

interface Conflict {
  sourceListingId: string;
  retailerId: string;
  retailerSku: string;
  retainedSku: string;
  storeName: string;
  keptProductTitle: string;
  reason: string;
}
interface Product { sourceProductId: string; sourceTitle: string; listings: Conflict[] }
const evidence = JSON.parse(readFileSync("docs/evidence/yoink-03-catalog-reconciliation-2026-10-16.json", "utf8")) as {
  conflictingProducts: Product[];
  journeyTogether: { records: Array<{ sourceProductId: string; title: string; sourceUrl: string;
    listings: Array<{ sourceListingId: string; retailerId: string; retailerSku: string; canonicalUrl: string }> }> };
};
const NOW = Date.parse("2026-10-16T17:00:00.000Z");

function url(store: string, sku: string): string {
  if (store === "walmart") return `https://www.walmart.com/ip/${sku}`;
  if (store === "target") return `https://www.target.com/p/-/A-${sku}`;
  if (store === "amazon") return `https://www.amazon.com/dp/${sku}`;
  if (store === "bestbuy") return `https://www.bestbuy.com/site/-/${sku}.p`;
  return `https://www.ravensburger.us/en-US/products/games/replay-${sku}`;
}

// Real IDs from the evidence, synthetic URLs, prices and times. No external requests.
function item(product: Product, conflict: Conflict, sku: string): TrackalackerCatalogItemInput {
  const sourceProductUrl = `https://www.trackalacker.com/products/showcase/replay-${product.sourceProductId}`;
  return {
    sourceProductId: product.sourceProductId, title: product.sourceTitle, sourceProductUrl,
    sourceProductSlug: `replay-${product.sourceProductId}`, observedAt: new Date(NOW).toISOString(),
    listings: [{ sourceListingId: conflict.sourceListingId, storeName: conflict.storeName,
      retailerId: conflict.retailerId, retailerSku: sku, canonicalUrl: url(conflict.retailerId, sku),
      sourceListingUrl: `${sourceProductUrl}/listings/${conflict.sourceListingId}/fixture`,
      availability: "out_of_stock", unitPriceCents: 2999 }]
  };
}

function signal(product: Product, conflict: Conflict, sku: string): SignalEventInput {
  return {
    sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
    externalEventId: `reconciliation-${conflict.sourceListingId}`, eventType: "restock",
    observedAt: new Date(NOW).toISOString(), identity: {
      sourceProductId: product.sourceProductId, sourceListingId: conflict.sourceListingId,
      retailerId: conflict.retailerId, retailerSku: sku, canonicalUrl: url(conflict.retailerId, sku),
      title: product.sourceTitle
    }, offer: { availability: "in_stock", unitPriceCents: 2999, currency: "USD", sellerType: "first_party", fulfillment: "shipping" }
  };
}

for (const product of evidence.conflictingProducts) {
  for (const conflict of product.listings) {
    test(`replay preserves source ${product.sourceProductId}/${conflict.sourceListingId} (${conflict.reason})`, () => {
      const db = new YoinkDatabase();
      try {
        const catalog = new CatalogRepository(db);
        const first = catalog.upsertTrackalackerItem(item(product, conflict, conflict.retainedSku), NOW);
        const listing = db.get<{ id: string }>("SELECT id FROM listings WHERE retailer_id = ? AND retailer_sku = ?",
          conflict.retailerId, conflict.retainedSku)!;
        let retainedVariant = first.variantId;
        if (conflict.reason === "kept_in_other_product") {
          retainedVariant = "variant_retained";
          const timestamp = new Date(NOW).toISOString();
          db.run("INSERT INTO product_families(id,title,brand,created_at,updated_at) VALUES ('family_retained',?,'',?,?)",
            conflict.keptProductTitle, timestamp, timestamp);
          db.run("INSERT INTO variants(id,family_id,title,attributes_json,created_at,updated_at) VALUES (?,'family_retained',?,'{}',?,?)",
            retainedVariant, conflict.keptProductTitle, timestamp, timestamp);
          db.run("UPDATE listings SET variant_id = ? WHERE id = ?", retainedVariant, listing.id);
        }
        const replay = item(product, conflict, conflict.retailerSku);
        catalog.upsertTrackalackerItem(replay, NOW + 1);
        catalog.upsertTrackalackerItem(replay, NOW + 2);
        assert.equal(db.get<{ variant: string }>("SELECT variant_id AS variant FROM listings WHERE id = ?", listing.id)?.variant, retainedVariant);
        assert.equal(db.get<{ variant: string }>("SELECT variant_id AS variant FROM source_product_refs WHERE external_product_id = ?", product.sourceProductId)?.variant, first.variantId);
        assert.equal(db.get<{ id: string }>("SELECT listing_id AS id FROM source_listing_refs WHERE external_listing_id = ?", conflict.sourceListingId)?.id, listing.id);
        assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM listings")?.n, 1);
        assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'trackalacker_listing_conflict'")?.n, 1);
        assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notification_deliveries")?.n, 0);
        assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM action_jobs")?.n, 0);
        const resolution = catalog.resolve(normalizeSignal(signal(product, conflict, conflict.retailerSku), NOW));
        if (conflict.reason === "listing_already_mapped") {
          assert.equal(resolution.status, "ambiguous", "a changed SKU must not borrow the old source-listing route");
          assert.equal(resolution.listing, null);
          const engine = new SignalEngine(db);
          assert.equal(engine.process(signal(product, conflict, conflict.retailerSku), NOW).decision, "ambiguous_identity");
          assert.equal(engine.process(signal(product, conflict, conflict.retailerSku), NOW + 1).duplicate, true);
          assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM signal_events")?.n, 1);
          assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notification_deliveries")?.n, 0);
        } else {
          assert.equal(resolution.listing?.variantId, retainedVariant, "an exact store item keeps its own identity");
          const byProduct = normalizeSignal({ ...signal(product, conflict, conflict.retailerSku),
            identity: { sourceProductId: product.sourceProductId, retailerId: conflict.retailerId } }, NOW);
          assert.equal(catalog.resolve(byProduct).status, "unresolved", "a stale preferred route must not cross product ownership");
          const bySlug = { ...byProduct, identity: { ...byProduct.identity, sourceProductId: "",
            globalIdentifiers: { trackalacker_slug: `replay-${product.sourceProductId}` } } };
          assert.equal(catalog.resolve(bySlug).status, "unresolved");
        }
      } finally { db.close(); }
    });
  }
}

test("Journey Together source IDs remain separate despite compatible booster-box names and replay creates no duplicate alert", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const imported = evidence.journeyTogether.records.map(record => ({
      sourceProductId: record.sourceProductId, title: record.title, sourceProductUrl: record.sourceUrl,
      sourceProductSlug: record.sourceUrl.split("/").at(-1)!, observedAt: new Date(NOW).toISOString(),
      listings: record.listings.map(row => ({ ...row, storeName: row.retailerId,
        sourceListingUrl: `${record.sourceUrl}/listings/${row.sourceListingId}/replay`,
        availability: "out_of_stock" as const, unitPriceCents: 2999 }))
    }));
    for (const input of imported) catalog.upsertTrackalackerItem(input, NOW);
    enablePlansFromCalls(db);
    const input = signal({ sourceProductId: "7760", sourceTitle: imported[1]!.title, listings: [] }, {
      sourceListingId: "201977", retailerId: "target", retailerSku: "94583140", retainedSku: "94583140",
      storeName: "Target", keptProductTitle: "", reason: ""
    }, "94583140");
    const engine = new SignalEngine(db);
    const first = engine.process(input, NOW);
    assert.equal(first.resolution, "matched");
    assert.ok(first.actionJobId, JSON.stringify(first));
    const before = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notification_deliveries")!.n;
    assert.ok(before > 0, "the control creates a local alert to exercise deduplication");
    for (const record of imported) catalog.upsertTrackalackerItem(record, NOW + 1);
    assert.equal(engine.process(input, NOW + 2).duplicate, true);
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notification_deliveries")?.n, before);
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM action_jobs")?.n, 1);
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM variants")?.n, 2);
    assert.deepEqual(imported.map(record => productFormOf(record.title)), ["booster_box", "booster_box"]);
    assert.equal(db.get<{ n: number }>("SELECT COUNT(DISTINCT variant_id) AS n FROM source_product_refs WHERE external_product_id IN ('7127','7760')")?.n, 2);
  } finally { db.close(); }
});
