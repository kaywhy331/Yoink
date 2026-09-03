import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("the product-library API applies actor-scoped filters before paging and returns complete store facets", async () => {
  const db = new YoinkDatabase();
  const catalog = new CatalogRepository(db);
  const target = catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "api-filter-target",
    sourceListingId: "api-filter-target-listing",
    title: "Planned Target Product",
    retailerId: "target",
    retailerSku: "97000001",
    canonicalUrl: "https://www.target.com/p/-/A-97000001",
    listingStatus: "in_stock",
    executionSupported: true,
    observedPriceCents: 2499,
    currency: "USD"
  });
  catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "api-filter-walmart-low",
    sourceListingId: "api-filter-walmart-low-listing",
    title: "Walmart Low Product",
    retailerId: "walmart",
    retailerSku: "5700000001",
    canonicalUrl: "https://www.walmart.com/ip/5700000001",
    listingStatus: "in_stock",
    executionSupported: true,
    observedPriceCents: 1999,
    currency: "USD"
  });
  catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "api-filter-walmart-high",
    sourceListingId: "api-filter-walmart-high-listing",
    title: "Walmart High Product",
    retailerId: "walmart",
    retailerSku: "5700000002",
    canonicalUrl: "https://www.walmart.com/ip/5700000002",
    listingStatus: "preorder",
    executionSupported: true,
    observedPriceCents: 7999,
    currency: "USD"
  });
  new ControlRepository(db).ensureUserMission(target.listing.variantId, target.listing.id);

  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "product-library-filter-api-test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const filteredResponse = await fetch(
      `${baseUrl}/api/v1/user/library/products?limit=1&offset=0&store=walmart&availability=in_stock&priceMax=5000&sort=price_asc`
    );
    assert.equal(filteredResponse.status, 200);
    const filtered = await filteredResponse.json() as {
      total: number;
      items: Array<{ title: string; bestPriceCents: number }>;
      facets: { stores: Array<{ retailerId: string; productCount: number }> };
    };
    assert.equal(filtered.total, 1);
    assert.deepEqual(filtered.items.map((item) => [item.title, item.bestPriceCents]), [["Walmart Low Product", 1999]]);
    assert.deepEqual(filtered.facets.stores.map((store) => [store.retailerId, store.productCount]), [
      ["target", 1],
      ["walmart", 2]
    ]);

    const everythingResponse = await fetch(`${baseUrl}/api/v1/user/library/products?sort=title`);
    assert.equal(everythingResponse.status, 200);
    const everything = await everythingResponse.json() as {
      items: Array<{ title: string; listings: Array<{ status: string; purchasable: boolean }> }>;
    };
    assert.deepEqual(
      everything.items.flatMap((item) => item.listings.map((listing) => [item.title, listing.status, listing.purchasable])),
      [
        ["Planned Target Product", "in_stock", true],
        ["Walmart High Product", "preorder", true],
        ["Walmart Low Product", "in_stock", true]
      ],
      "every listing exposes purchasable so the badge and the availability filter agree"
    );

    const plannedResponse = await fetch(`${baseUrl}/api/v1/user/library/products?plan=planned&sort=title`);
    assert.equal(plannedResponse.status, 200);
    const planned = await plannedResponse.json() as { total: number; items: Array<{ title: string }> };
    assert.equal(planned.total, 1);
    assert.deepEqual(planned.items.map((item) => item.title), ["Planned Target Product"]);

    const plannedAliasResponse = await fetch(`${baseUrl}/api/v1/user/library/products?planned=true&sort=title`);
    assert.equal(plannedAliasResponse.status, 200);
    const plannedAlias = await plannedAliasResponse.json() as { total: number; items: Array<{ title: string }> };
    assert.deepEqual(plannedAlias, planned);

    const unavailableAliasResponse = await fetch(`${baseUrl}/api/v1/user/library/products?availability=unavailable`);
    assert.equal(unavailableAliasResponse.status, 200);

    const invalidResponse = await fetch(`${baseUrl}/api/v1/user/library/products?availability=available`);
    assert.equal(invalidResponse.status, 400);
    assert.match(String((await invalidResponse.json() as { message: string }).message), /In stock, Preorder, or Out of stock/);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
