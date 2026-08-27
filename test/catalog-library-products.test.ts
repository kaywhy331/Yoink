import assert from "node:assert/strict";
import test from "node:test";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

interface LibraryProduct {
  variantId: string;
  familyId: string;
  title: string;
  storeCount: number;
  listingCount: number;
  availableListingCount: number;
  bestPriceCents: number | null;
  currency: string;
  createdAt: string;
  lastActivityAt: string | null;
  listings: Array<Record<string, unknown>>;
}

function seedGroupedCatalog(catalog: CatalogRepository): { eliteVariantId: string } {
  const target = catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "group-9001",
    sourceListingId: "group-900101",
    title: "Grouped Elite Trainer Box",
    retailerId: "target",
    retailerSku: "95000001",
    canonicalUrl: "https://www.target.com/p/-/A-95000001",
    listingStatus: "in_stock",
    executionSupported: true,
    msrpCents: 5999,
    observedPriceCents: 4999,
    currency: "USD"
  });
  const walmart = catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "group-9001",
    sourceListingId: "group-900102",
    title: "Grouped Elite Trainer Box",
    retailerId: "walmart",
    retailerSku: "5590000002",
    canonicalUrl: "https://www.walmart.com/ip/5590000002",
    listingStatus: "out_of_stock",
    executionSupported: true,
    msrpCents: 5599,
    currency: "USD"
  });
  const amazon = catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "group-9001",
    sourceListingId: "group-900103",
    title: "Grouped Elite Trainer Box",
    retailerId: "amazon",
    retailerSku: "B0GROUP011",
    canonicalUrl: "https://www.amazon.com/dp/B0GROUP011",
    listingStatus: "in_stock",
    executionSupported: true,
    msrpCents: 6499,
    currency: "USD"
  });
  assert.equal(walmart.listing.variantId, target.listing.variantId);
  assert.equal(amazon.listing.variantId, target.listing.variantId);
  catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "group-9002",
    sourceListingId: "group-900201",
    title: "Grouped Booster Bundle",
    retailerId: "walmart",
    retailerSku: "5590000003",
    canonicalUrl: "https://www.walmart.com/ip/5590000003",
    listingStatus: "out_of_stock",
    executionSupported: true,
    msrpCents: 2999,
    currency: "USD"
  });
  return { eliteVariantId: target.listing.variantId };
}

test("the product library groups one exact product's listings across every store", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const { eliteVariantId } = seedGroupedCatalog(catalog);
    const products = catalog.listLibraryProducts() as unknown as LibraryProduct[];
    assert.equal(products.length, 2);
    assert.equal(catalog.libraryProductCount(), 2);
    const elite = products.find((product) => product.title === "Grouped Elite Trainer Box");
    assert.ok(elite);
    assert.equal(elite.variantId, eliteVariantId);
    assert.equal(elite.listingCount, 3);
    assert.equal(elite.storeCount, 3);
    assert.equal(elite.availableListingCount, 2);
    assert.equal(elite.currency, "USD");
    assert.equal(
      new Set(elite.listings.map((listing) => String(listing.retailerId))).size,
      3,
      "each store contributes one listing to the same grouped product"
    );
    // The observed Target price beats every other available listing's catalog price.
    assert.equal(elite.bestPriceCents, 4999);
    const bundle = products.find((product) => product.title === "Grouped Booster Bundle");
    assert.ok(bundle);
    assert.equal(bundle.availableListingCount, 0);
    // With no available listing, the catalog price still yields a browsable price point.
    assert.equal(bundle.bestPriceCents, 2999);
  } finally {
    db.close();
  }
});

test("product library search matches title, store, and exact SKU at the product level", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    seedGroupedCatalog(catalog);
    const byTitle = catalog.listLibraryProducts(100, 0, "Elite Trainer") as unknown as LibraryProduct[];
    assert.equal(byTitle.length, 1);
    assert.equal(byTitle[0]?.listingCount, 3, "a store-term search still returns the complete grouped product");
    assert.equal(catalog.libraryProductCount("Elite Trainer"), 1);
    const bySku = catalog.listLibraryProducts(100, 0, "B0GROUP011") as unknown as LibraryProduct[];
    assert.equal(bySku.length, 1);
    assert.equal(bySku[0]?.title, "Grouped Elite Trainer Box");
    const byStore = catalog.listLibraryProducts(100, 0, "Amazon") as unknown as LibraryProduct[];
    assert.equal(byStore.length, 1);
    assert.equal(byStore[0]?.listingCount, 3);
    assert.equal(catalog.listLibraryProducts(100, 0, "No Such Product").length, 0);
    assert.equal(catalog.libraryProductCount("No Such Product"), 0);
  } finally {
    db.close();
  }
});

test("product library pagination pages whole products and never splits a product's stores", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    seedGroupedCatalog(catalog);
    const firstPage = catalog.listLibraryProducts(1, 0) as unknown as LibraryProduct[];
    const secondPage = catalog.listLibraryProducts(1, 1) as unknown as LibraryProduct[];
    assert.equal(firstPage.length, 1);
    assert.equal(secondPage.length, 1);
    assert.notEqual(firstPage[0]?.variantId, secondPage[0]?.variantId);
    const titles = new Set([firstPage[0]?.title, secondPage[0]?.title]);
    assert.deepEqual([...titles].sort(), ["Grouped Booster Bundle", "Grouped Elite Trainer Box"]);
    for (const page of [firstPage, secondPage]) {
      const expected = page[0]?.title === "Grouped Elite Trainer Box" ? 3 : 1;
      assert.equal(page[0]?.listings.length, expected, "every page carries each product's complete store list");
    }
    assert.equal(catalog.listLibraryProducts(1, 2).length, 0);
  } finally {
    db.close();
  }
});

test("a TrackaLacker import stores and refreshes the product image for grouped browsing", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const item = {
      sourceProductId: "9101",
      sourceProductSlug: "image-fixture",
      sourceProductUrl: "https://www.trackalacker.com/products/showcase/image-fixture",
      title: "Image Fixture Product",
      imageUrl: "https://images.trackalacker.example/products/image-fixture.jpg",
      msrpCents: 4999,
      observedAt: new Date().toISOString(),
      listings: [{
        sourceListingId: "910101",
        storeName: "Target",
        retailerId: "target",
        retailerSku: "95111111",
        canonicalUrl: "https://www.target.com/p/-/A-95111111",
        sourceListingUrl: "https://www.trackalacker.com/products/showcase/image-fixture/listings/910101/item",
        availability: "in_stock" as const,
        unitPriceCents: 4999
      }]
    };
    catalog.upsertTrackalackerItem(item);
    const first = catalog.listLibraryProducts(100, 0, "Image Fixture") as unknown as Array<{ imageUrl: string }>;
    assert.equal(first[0]?.imageUrl, "https://images.trackalacker.example/products/image-fixture.jpg");
    catalog.upsertTrackalackerItem({
      ...item,
      observedAt: new Date().toISOString(),
      imageUrl: "https://images.trackalacker.example/products/image-fixture-v2.jpg"
    });
    const second = catalog.listLibraryProducts(100, 0, "Image Fixture") as unknown as Array<{ imageUrl: string }>;
    assert.equal(second[0]?.imageUrl, "https://images.trackalacker.example/products/image-fixture-v2.jpg");
    // A sync payload without an image never clears the stored one.
    const { imageUrl: _omitted, ...itemWithoutImage } = item;
    catalog.upsertTrackalackerItem({ ...itemWithoutImage, observedAt: new Date().toISOString() });
    const third = catalog.listLibraryProducts(100, 0, "Image Fixture") as unknown as Array<{ imageUrl: string }>;
    assert.equal(third[0]?.imageUrl, "https://images.trackalacker.example/products/image-fixture-v2.jpg");
    // Non-HTTPS image URLs are discarded rather than stored.
    catalog.upsertTrackalackerItem({ ...item, observedAt: new Date().toISOString(), imageUrl: "http://images.trackalacker.example/insecure.jpg" });
    const fourth = catalog.listLibraryProducts(100, 0, "Image Fixture") as unknown as Array<{ imageUrl: string }>;
    assert.equal(fourth[0]?.imageUrl, "https://images.trackalacker.example/products/image-fixture-v2.jpg");
  } finally {
    db.close();
  }
});
