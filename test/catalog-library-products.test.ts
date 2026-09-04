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
  inStockListingCount: number;
  preorderListingCount: number;
  outOfStockListingCount: number;
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
    assert.equal(elite.inStockListingCount, 2);
    assert.equal(elite.preorderListingCount, 0);
    assert.equal(elite.outOfStockListingCount, 1);
    assert.deepEqual(
      elite.listings.map((listing) => [listing.status, listing.purchasable]).sort(),
      [["in_stock", true], ["in_stock", true], ["out_of_stock", false]],
      "each listing carries the purchasable flag the badge and filter share"
    );
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

test("product filters use exact store, stock state, and selected-store price before pagination", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    seedGroupedCatalog(catalog);
    const inStock = catalog.listLibraryProducts(100, 0, { availability: "in_stock" }) as unknown as LibraryProduct[];
    assert.deepEqual(inStock.map((product) => product.title), ["Grouped Elite Trainer Box"]);
    const outOfStock = catalog.listLibraryProducts(100, 0, { availability: "out_of_stock" }) as unknown as LibraryProduct[];
    assert.deepEqual(outOfStock.map((product) => product.title), ["Grouped Booster Bundle"]);
    const unavailableAlias = catalog.listLibraryProducts(100, 0, { availability: "unavailable" }) as unknown as LibraryProduct[];
    assert.deepEqual(unavailableAlias.map((product) => product.title), ["Grouped Booster Bundle"]);
    const walmartOutOfStock = catalog.listLibraryProducts(100, 0, {
      retailerId: "walmart",
      availability: "out_of_stock",
      sort: "price_asc"
    }) as unknown as LibraryProduct[];
    assert.deepEqual(walmartOutOfStock.map((product) => product.title), [
      "Grouped Booster Bundle",
      "Grouped Elite Trainer Box"
    ]);
    assert.equal(walmartOutOfStock[0]?.bestPriceCents, 2999);
    assert.equal(walmartOutOfStock[1]?.bestPriceCents, 5599);
    assert.equal(walmartOutOfStock.every((product) => product.listings.every((listing) => listing.retailerId === "walmart")), true,
      "a store-level response must never leak another store's offer link");
    assert.deepEqual(walmartOutOfStock.map((product) => product.storeCount), [1, 1]);
    assert.equal(catalog.libraryProductCount({ retailerId: "walmart", priceMaxCents: 4000 }), 1);
    assert.deepEqual(catalog.libraryProductStoreFacets(), [
      { retailerId: "amazon", retailerName: "Amazon", productCount: 1 },
      { retailerId: "target", retailerName: "Target", productCount: 1 },
      { retailerId: "walmart", retailerName: "Walmart", productCount: 2 }
    ]);
  } finally {
    db.close();
  }
});

test("shopper products exclude source-only shells and support bounded popular categories", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const timestamp = new Date().toISOString();
    db.run(
      "INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES ('family_source_shell', 'All New Needoh', '', ?, ?)",
      timestamp,
      timestamp
    );
    db.run(
      "INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at) VALUES ('variant_source_shell', 'family_source_shell', 'All New Needoh', '{}', ?, ?)",
      timestamp,
      timestamp
    );
    catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "category-needoh",
      sourceListingId: "category-needoh-target",
      title: "NeeDoh Nice Cube",
      retailerId: "target",
      retailerSku: "95123456",
      canonicalUrl: "https://www.target.com/p/-/A-95123456",
      listingStatus: "in_stock",
      executionSupported: true,
      observedPriceCents: 699,
      currency: "USD"
    });
    catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "category-lorcana",
      sourceListingId: "category-lorcana-target",
      title: "Disney Lorcana Booster Pack",
      retailerId: "target",
      retailerSku: "95123457",
      canonicalUrl: "https://www.target.com/p/-/A-95123457",
      listingStatus: "in_stock",
      executionSupported: true,
      observedPriceCents: 599,
      currency: "USD"
    });

    const all = catalog.listLibraryProducts(100, 0, { sort: "title" }) as unknown as LibraryProduct[];
    assert.equal(all.some((product) => product.title === "All New Needoh"), false);
    assert.equal(catalog.libraryProductCount(), 2);
    assert.deepEqual(
      (catalog.listLibraryProducts(100, 0, { category: "needoh" }) as unknown as LibraryProduct[]).map((product) => product.title),
      ["NeeDoh Nice Cube"]
    );
    assert.deepEqual(
      (catalog.listLibraryProducts(100, 0, { category: "disney_lorcana" }) as unknown as LibraryProduct[]).map((product) => product.title),
      ["Disney Lorcana Booster Pack"]
    );
  } finally {
    db.close();
  }
});

test("a store filter finds every matching product beyond the first 48 groups", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const base = Date.now() - 10_000;
    for (let index = 0; index < 2; index += 1) {
      catalog.upsertListing({
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker",
        sourceProductId: `deep-walmart-${index}`,
        sourceListingId: `deep-walmart-listing-${index}`,
        title: `Deep Walmart Match ${index}`,
        retailerId: "walmart",
        retailerSku: String(5_600_000_000 + index),
        canonicalUrl: `https://www.walmart.com/ip/${5_600_000_000 + index}`,
        listingStatus: "in_stock",
        executionSupported: true,
        observedPriceCents: 2000 + index,
        currency: "USD"
      }, base + index);
    }
    for (let index = 0; index < 200; index += 1) {
      catalog.upsertListing({
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker",
        sourceProductId: `deep-target-${index}`,
        sourceListingId: `deep-target-listing-${index}`,
        title: `Recent Target Product ${String(index).padStart(3, "0")}`,
        retailerId: "target",
        retailerSku: String(96_000_000 + index),
        canonicalUrl: `https://www.target.com/p/-/A-${96_000_000 + index}`,
        listingStatus: "in_stock",
        executionSupported: true,
        observedPriceCents: 3000 + index,
        currency: "USD"
      }, base + 100 + index);
    }
    const firstPage = catalog.listLibraryProducts(48, 0) as unknown as LibraryProduct[];
    assert.equal(firstPage.some((product) => product.title.startsWith("Deep Walmart Match")), false);
    const matches = catalog.listLibraryProducts(48, 0, { retailerId: "walmart" }) as unknown as LibraryProduct[];
    assert.equal(matches.length, 2);
    assert.equal(catalog.libraryProductCount({ retailerId: "walmart" }), 2);
    assert.equal(matches.every((product) => product.listings.some((listing) => listing.retailerId === "walmart")), true);
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

test("source-only products stay out of shopper browsing until a supported store listing is mapped", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const imported = catalog.upsertTrackalackerItem({
      sourceProductId: "zero-listing-product",
      sourceProductSlug: "zebra-zero-listing-product",
      sourceProductUrl: "https://www.trackalacker.com/products/showcase/zebra-zero-listing-product",
      title: "Zebra Zero Listing Product",
      observedAt: new Date().toISOString(),
      listings: [{
        sourceListingId: "unsupported-gamestop-listing",
        storeName: "GameStop",
        sourceListingUrl: "https://www.trackalacker.com/products/showcase/zebra-zero-listing-product/listings/unsupported-gamestop-listing/item",
        availability: "unknown"
      }]
    });
    assert.equal(imported.candidatesAccepted, 1);
    assert.equal(imported.listingsMapped, 0);

    const products = catalog.listLibraryProducts(100, 0, "Zebra") as unknown as LibraryProduct[];
    assert.deepEqual(products, []);
    assert.equal(catalog.libraryProductCount("Zebra"), 0);
  } finally {
    db.close();
  }
});
