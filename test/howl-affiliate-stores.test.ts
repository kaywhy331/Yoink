import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHowlAffiliateRoute,
  HOWL_AFFILIATE_STORES,
  howlAffiliateStoreForDestination
} from "../packages/domain/src/howl-affiliate-stores.js";

test("the curated Howl directory contains the supplied stores without duplicate website scopes", () => {
  assert.equal(HOWL_AFFILIATE_STORES.length, 160);
  assert.equal(new Set(HOWL_AFFILIATE_STORES.map((store) => store.website.toLocaleLowerCase("en-US"))).size, 160);
  assert.deepEqual(
    HOWL_AFFILIATE_STORES.filter((store) => store.hostname === "lenovo.com").map((store) => store.pathPrefix),
    ["/us/en", "/ca/en"]
  );
  assert.ok(HOWL_AFFILIATE_STORES.some((store) => store.storeName === "Target" && store.website === "target.com"));
  assert.ok(HOWL_AFFILIATE_STORES.some((store) => store.storeName === "Walmart Canada" && store.website === "walmart.ca/en"));
});

test("Howl destination matching is exact-host and path-aware", () => {
  assert.equal(
    howlAffiliateStoreForDestination("https://www.target.com/p/example/-/A-12345678")?.storeName,
    "Target"
  );
  assert.equal(
    howlAffiliateStoreForDestination("https://www.lenovo.com/ca/en/p/laptops/example")?.storeName,
    "Lenovo CA"
  );
  assert.equal(
    howlAffiliateStoreForDestination("https://www.leica-camera.com/en-us/photography/cameras/example")?.storeName,
    "Leica"
  );
  for (const rejected of [
    "https://www.amazon.com/dp/B0DCGQ6CJD",
    "https://www.bestbuy.com/site/-/6685081.p",
    "https://www.lenovo.com/gb/en/p/laptops/example",
    "https://target.com.evil.example/p/-/A-12345678",
    "https://evil.target.com/p/-/A-12345678",
    "https://user:secret@target.com/p/-/A-12345678",
    "https://target.com:8443/p/-/A-12345678",
    "http://target.com/p/-/A-12345678"
  ]) {
    assert.equal(howlAffiliateStoreForDestination(rejected), null, rejected);
  }
});

test("the Howl protocol builder wraps only directory destinations", () => {
  const target = buildHowlAffiliateRoute({
    destinationUrl: "https://www.target.com/p/-/A-94972381",
    publisherSlug: "collectwithdodo",
    articleName: "Target product",
    articleUrl: "https://yoink.example/products/target-product"
  });
  const route = new URL(target);
  assert.equal(route.origin, "https://howl.link");
  assert.equal(route.pathname, "/link");
  assert.equal(route.searchParams.get("url"), "https://www.target.com/p/-/A-94972381");
  assert.equal(route.searchParams.get("publisher_slug"), "collectwithdodo");
  assert.equal(route.searchParams.get("article_name"), "Target product");
  assert.equal(route.searchParams.get("article_url"), "https://yoink.example/products/target-product");
  assert.equal(buildHowlAffiliateRoute({
    destinationUrl: "https://www.amazon.com/dp/B0DCGQ6CJD",
    publisherSlug: "collectwithdodo",
    articleName: "Amazon product",
    articleUrl: "https://yoink.example/products/amazon-product"
  }), "");
});
