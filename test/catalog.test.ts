import assert from "node:assert/strict";
import test from "node:test";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { normalizeSignal } from "../packages/domain/src/normalize.js";

test("catalog keeps out-of-stock unsupported listings for attribution", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const result = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "138022",
      sourceListingId: "777001",
      title: "Riftbound Rumble Champion Deck",
      retailerId: "bestbuy",
      retailerSku: "6612345",
      canonicalUrl: "https://www.bestbuy.com/site/example/6612345.p",
      listingStatus: "out_of_stock",
      executionSupported: true,
      msrpCents: 1999,
      currency: "USD"
    });
    assert.equal(result.listing.executionSupported, false);
    assert.equal(result.listing.msrpCents, 1999);
    assert.equal(catalog.listLibrary().length, 1);
    assert.equal(catalog.counts().catalogOnlyListings, 1);
  } finally {
    db.close();
  }
});

test("the user library keeps the latest observed price separate from catalog MSRP", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "observed-price-product",
      sourceListingId: "observed-price-listing",
      title: "Observed Price Fixture",
      retailerId: "target",
      retailerSku: "95280899",
      canonicalUrl: "https://www.target.com/p/-/A-95280899",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 2495,
      observedPriceCents: 798,
      currency: "USD",
      variantAttributes: { edition: "First", color: "Forest" }
    });
    const item = catalog.listLibrary()[0];
    assert.equal(item?.msrpCents, 2495);
    assert.equal(item?.currentPriceCents, 798);
    assert.equal(typeof item?.variantAttributes, "object");
    assert.deepEqual(item?.variantAttributes, { edition: "First", color: "Forest" });
    assert.equal(item?.executionSupported, true);
  } finally {
    db.close();
  }
});

test("one variant can retain multiple same-retailer listings and one mission owns both targets", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const control = new ControlRepository(db);
    const first = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "9001",
      sourceListingId: "900101",
      title: "Pokemon Exact Variant",
      retailerId: "amazon",
      retailerSku: "B0AAAA0001",
      canonicalUrl: "https://www.amazon.com/dp/B0AAAA0001",
      listingStatus: "out_of_stock",
      executionSupported: true,
      msrpCents: 4999
    });
    const second = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "9001",
      sourceListingId: "900102",
      title: "Pokemon Exact Variant",
      retailerId: "amazon",
      retailerSku: "B0AAAA0002",
      canonicalUrl: "https://www.amazon.com/dp/B0AAAA0002",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4999
    });
    assert.equal(first.listing.variantId, second.listing.variantId);
    assert.notEqual(first.listing.id, second.listing.id);
    assert.equal(catalog.listLibrary().length, 2);
    assert.equal(catalog.libraryCount(), 2);
    assert.equal(catalog.listLibrary(1, 0).length, 1);
    assert.equal(catalog.listLibrary(1, 1).length, 1);
    assert.notEqual(catalog.listLibrary(1, 0)[0]?.listingId, catalog.listLibrary(1, 1)[0]?.listingId);
    assert.equal(catalog.libraryCount("B0AAAA0002"), 1);
    assert.equal(catalog.listLibrary(10, 0, "B0AAAA0002")[0]?.listingId, second.listing.id);

    const firstMission = control.ensureMission(first.listing.variantId, first.listing.id, "signal");
    const secondMission = control.ensureMission(second.listing.variantId, second.listing.id, "signal");
    assert.equal(firstMission.created, true);
    assert.equal(secondMission.created, false);
    assert.equal(firstMission.mission.id, secondMission.mission.id);
    assert.equal(control.listMissions()[0]?.targetCount, 2);
    assert.equal(control.missionCount(), 1);
    assert.equal(control.missionCount("Pokemon Exact"), 1);
    assert.equal(control.missionCount("no-match"), 0);
  } finally {
    db.close();
  }
});

test("signal resolution prefers an exact source listing and detects source-product ambiguity", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    for (const [listingId, sku] of [["88001", "B0BBBB0001"], ["88002", "B0BBBB0002"]] as const) {
      catalog.upsertListing({
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker",
        sourceProductId: "8800",
        sourceListingId: listingId,
        title: "Exact Multi-listing Product",
        retailerId: "amazon",
        retailerSku: sku,
        canonicalUrl: `https://www.amazon.com/dp/${sku}`,
        listingStatus: "out_of_stock",
        executionSupported: true,
        msrpCents: 2999
      });
    }
    const exact = normalizeSignal({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      externalEventId: "event-exact-1",
      eventType: "restock",
      observedAt: new Date().toISOString(),
      identity: { sourceProductId: "8800", sourceListingId: "88002", retailerId: "amazon" },
      offer: { unitPriceCents: 2999, currency: "USD", availability: "in_stock" }
    });
    assert.equal(catalog.resolve(exact).method, "source_listing_id");

    const ambiguous = normalizeSignal({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      externalEventId: "event-ambiguous-1",
      eventType: "restock",
      observedAt: new Date().toISOString(),
      identity: { sourceProductId: "8800", retailerId: "amazon" },
      offer: { unitPriceCents: 2999, currency: "USD", availability: "in_stock" }
    });
    assert.equal(catalog.resolve(ambiguous).status, "ambiguous");
  } finally {
    db.close();
  }
});
