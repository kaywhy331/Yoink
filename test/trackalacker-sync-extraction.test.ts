import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } };
};

const ROOT = process.cwd();
const SOURCE = readFileSync(join(ROOT, "apps", "extension", "trackalacker-sync.js"), "utf8");

type Bridge = Record<string, (...args: never[]) => unknown>;

function loadBridge(extraGlobals: Record<string, unknown> = {}): Bridge {
  const context = createContext({
    URL,
    Date,
    Object,
    Array,
    Map,
    Set,
    RegExp,
    String,
    Number,
    Boolean,
    Math,
    JSON,
    ...extraGlobals
  });
  runInContext(SOURCE, context);
  return (context as unknown as { YoinkTrackalackerSync: Bridge }).YoinkTrackalackerSync;
}

test("broadened image extraction reads img/picture/media/images/srcset candidates and nested {url}/{src}", () => {
  const bridge = loadBridge();
  const productImageUrl = bridge.productImageUrl as (...records: Array<Record<string, unknown> | undefined>) => string;

  assert.equal(productImageUrl({ image_url: "https://cdn.example.com/a.jpg" }), "https://cdn.example.com/a.jpg");
  assert.equal(productImageUrl({ img: "https://cdn.example.com/img.jpg" }), "https://cdn.example.com/img.jpg");
  assert.equal(productImageUrl({ picture: { url: "https://cdn.example.com/picture.jpg" } }), "https://cdn.example.com/picture.jpg");
  assert.equal(productImageUrl({ media: { src: "https://cdn.example.com/media.jpg" } }), "https://cdn.example.com/media.jpg");
  assert.equal(productImageUrl({ images: ["https://cdn.example.com/gallery-1.jpg", "https://cdn.example.com/gallery-2.jpg"] }), "https://cdn.example.com/gallery-1.jpg");
  assert.equal(productImageUrl({ images: [{ url: "https://cdn.example.com/gallery-object.jpg" }] }), "https://cdn.example.com/gallery-object.jpg");
  assert.equal(
    productImageUrl({ srcset: "https://cdn.example.com/small.jpg 1x, https://cdn.example.com/large.jpg 2x" }),
    "https://cdn.example.com/small.jpg"
  );
  assert.equal(
    productImageUrl({ picture: { srcset: "https://cdn.example.com/nested-srcset.jpg 1x" } }),
    "https://cdn.example.com/nested-srcset.jpg"
  );
  // Multiple sources are scanned in order; the first with any usable candidate wins.
  assert.equal(
    productImageUrl(undefined, { unknown_field: "nope" }, { img: "https://cdn.example.com/fallback.jpg" }),
    "https://cdn.example.com/fallback.jpg"
  );
  // Unknown field names anywhere yield no image (this is exactly the self-diagnosing gap the sample capture exists for).
  assert.equal(productImageUrl({ heroImage: "https://cdn.example.com/unrecognized.jpg" }), "");
  // Insecure or credentialed URLs are rejected even under a recognized field name.
  assert.equal(productImageUrl({ image_url: "http://cdn.example.com/insecure.jpg" }), "");
  assert.equal(productImageUrl({ image_url: "https://user:pass@cdn.example.com/creds.jpg" }), "");
});

test("MSRP uses explicit field units and never promotes an ordinary price into MSRP", () => {
  const bridge = loadBridge();
  const normalizeMoneyToCents = bridge.normalizeMoneyToCents as (value: unknown, unit?: "dollars" | "cents") => number | null;
  const productMsrpCents = bridge.productMsrpCents as (...records: Array<Record<string, unknown> | undefined>) => number | null;

  assert.equal(normalizeMoneyToCents("69.99"), 6999);
  assert.equal(normalizeMoneyToCents("69"), 6900);
  assert.equal(normalizeMoneyToCents("$1,299.00"), 129900);
  assert.equal(normalizeMoneyToCents("9999"), 999900);
  assert.equal(normalizeMoneyToCents("12000"), 1200000, "whole dollar values do not switch units at an arbitrary threshold");
  assert.equal(normalizeMoneyToCents("4999", "cents"), 4999, "a cents field below $100 must not inflate the cap 100x");
  assert.equal(normalizeMoneyToCents("49.99", "cents"), null);
  assert.equal(normalizeMoneyToCents("49.999"), null);
  assert.equal(normalizeMoneyToCents("1,2.99"), null);
  assert.equal(normalizeMoneyToCents("CAD 49.99"), null);
  assert.equal(normalizeMoneyToCents("USD 49.99"), 4999);
  assert.equal(normalizeMoneyToCents(true), null);
  assert.equal(normalizeMoneyToCents("0"), null);
  assert.equal(normalizeMoneyToCents(""), null);
  assert.equal(normalizeMoneyToCents(null), null);
  assert.equal(normalizeMoneyToCents("not-a-number"), null);

  assert.equal(productMsrpCents({ default_price: "69.99" }), null);
  assert.equal(productMsrpCents({ msrp: "59.99" }), 5999);
  assert.equal(productMsrpCents({ msrp_cents: 4999 }), 4999);
  assert.equal(productMsrpCents({ msrp_cents: 12999 }), 12999);
  assert.equal(productMsrpCents({ msrpCents: 12999 }), 12999);
  assert.equal(productMsrpCents({ list_price: "24.00" }), null);
  assert.equal(productMsrpCents({ original_price: "12.50" }), null);
  assert.equal(productMsrpCents({ retail_price: "8.00" }), null);
  assert.equal(productMsrpCents({ msrp: "49.99", msrp_cents: 4999 }), 4999);
  assert.equal(productMsrpCents({ msrp: "49.99", msrp_cents: 5999 }), null);
  assert.equal(productMsrpCents({ msrp: "49.99", currency: "CAD" }), null);
  assert.equal(productMsrpCents({ unrecognized_price_field: "19.99" }), null);
  // First matching field across sources wins; later sources still checked when earlier ones have nothing.
  assert.equal(productMsrpCents({ nothing_here: true }, { msrp: "14.99" }), 1499);
});

test("sanitized field sampling strips credential-like keys, truncates long strings, and bounds depth/array detail", () => {
  const bridge = loadBridge();
  const sanitizedFieldSample = bridge.sanitizedFieldSample as (record: Record<string, unknown> | null, depth?: number) => Record<string, unknown>;

  const longString = "x".repeat(500);
  const sample = sanitizedFieldSample({
    cookie: "abc123",
    session_token: "should-not-appear",
    password: "hunter2",
    api_key: "should-not-appear-either",
    title: longString,
    count: 5,
    active: true,
    nested: { auth: "secret-value", ok: "fine" },
    items: [1, 2, 3, 4]
  });

  assert.equal(sample.cookie, "[stripped]");
  assert.equal(sample.session_token, "[stripped]");
  assert.equal(sample.password, "[stripped]");
  assert.equal(sample.api_key, "[stripped]");
  assert.equal(String(sample.title).length <= 121, true);
  assert.equal(String(sample.title).startsWith("x".repeat(120)), true);
  assert.equal(sample.count, 5);
  assert.equal(sample.active, true);
  assert.equal((sample.nested as Record<string, unknown>).auth, "[stripped]");
  assert.equal((sample.nested as Record<string, unknown>).ok, "fine");
  assert.equal(sample.items, "[array:4]");

  const manyKeys: Record<string, unknown> = {};
  for (let index = 0; index < 80; index += 1) manyKeys[`field_${index}`] = index;
  const boundedKeys = sanitizedFieldSample(manyKeys);
  assert.equal(Object.keys(boundedKeys).length, 60);

  assert.deepEqual(JSON.parse(JSON.stringify(sanitizedFieldSample(null))), {});
});

test("bounded sample enforces the ~4KB cap and marks truncation", () => {
  const bridge = loadBridge();
  const boundedSample = bridge.boundedSample as (value: Record<string, unknown>) => Record<string, unknown>;

  const small = boundedSample({ listItem: { a: 1 } });
  assert.deepEqual(small, { listItem: { a: 1 } });
  assert.equal("truncated" in small, false);

  const huge = boundedSample({
    listItem: { blob: "x".repeat(4_000) },
    productDetail: { blob: "y".repeat(4_000) }
  });
  assert.equal(JSON.stringify(huge).length <= 4_096, true);
  assert.equal(huge.truncated, true);
});

test("og:image extraction reads the meta tag regardless of attribute order and returns empty when absent", () => {
  const bridge = loadBridge();
  const extractOgImage = bridge.extractOgImage as (html: string) => string;

  assert.equal(
    extractOgImage('<html><head><meta property="og:image" content="https://cdn.example.com/a.jpg"></head></html>'),
    "https://cdn.example.com/a.jpg"
  );
  assert.equal(
    extractOgImage('<html><head><meta content="https://cdn.example.com/b.jpg" property="og:image"></head></html>'),
    "https://cdn.example.com/b.jpg"
  );
  assert.equal(
    extractOgImage('<meta name="description" content="no image here"><meta property="og:title" content="Widget">'),
    ""
  );
  assert.equal(extractOgImage(""), "");
});

test("fallback enrichment caches per slug and hard-caps fetches per sync run without ever throwing", async () => {
  let fetchCalls = 0;
  const bridge = loadBridge({
    fetch: async (url: string) => {
      fetchCalls += 1;
      return {
        ok: true,
        redirected: false,
        url,
        text: async () => `<html><head><meta property="og:image" content="https://cdn.example.com/enriched.jpg"></head></html>`
      };
    },
    AbortController,
    setTimeout,
    clearTimeout
  });
  const enrichMissingImage = bridge.enrichMissingImage as (
    product: { imageUrl: string; sourceProductSlug: string; sourceProductUrl: string },
    cache: Map<string, string>,
    budget: { remaining: number }
  ) => Promise<string>;

  const cache = new Map<string, string>();
  const budget = { remaining: 1 };

  const productA = { imageUrl: "", sourceProductSlug: "widget-a", sourceProductUrl: "https://www.trackalacker.com/products/showcase/widget-a" };
  const first = await enrichMissingImage(productA, cache, budget);
  assert.equal(first, "https://cdn.example.com/enriched.jpg");
  assert.equal(fetchCalls, 1);
  assert.equal(budget.remaining, 0);

  // Same slug again: served from cache, no additional fetch even though budget is exhausted.
  const cached = await enrichMissingImage(productA, cache, budget);
  assert.equal(cached, "https://cdn.example.com/enriched.jpg");
  assert.equal(fetchCalls, 1);

  // A different slug with budget exhausted: no fetch, empty result, never throws.
  const productB = { imageUrl: "", sourceProductSlug: "widget-b", sourceProductUrl: "https://www.trackalacker.com/products/showcase/widget-b" };
  const overBudget = await enrichMissingImage(productB, cache, budget);
  assert.equal(overBudget, "");
  assert.equal(fetchCalls, 1);

  // Already has an image: never attempts enrichment.
  const productC = { imageUrl: "https://cdn.example.com/already-there.jpg", sourceProductSlug: "widget-c", sourceProductUrl: "https://www.trackalacker.com/products/showcase/widget-c" };
  const alreadyPresent = await enrichMissingImage(productC, cache, budget);
  assert.equal(alreadyPresent, "https://cdn.example.com/already-there.jpg");
  assert.equal(fetchCalls, 1);
});

test("fallback enrichment never blocks the sync when the product page fetch fails", async () => {
  const bridge = loadBridge({
    fetch: async () => {
      throw new Error("network down");
    },
    AbortController,
    setTimeout,
    clearTimeout
  });
  const enrichMissingImage = bridge.enrichMissingImage as (
    product: { imageUrl: string; sourceProductSlug: string; sourceProductUrl: string },
    cache: Map<string, string>,
    budget: { remaining: number }
  ) => Promise<string>;

  const cache = new Map<string, string>();
  const budget = { remaining: 5 };
  const product = { imageUrl: "", sourceProductSlug: "widget-fail", sourceProductUrl: "https://www.trackalacker.com/products/showcase/widget-fail" };
  const result = await enrichMissingImage(product, cache, budget);
  assert.equal(result, "");
  assert.equal(budget.remaining, 4, "the attempt still consumes budget even though it failed");
});

test("parseFollowedPage captures a raw first-item sample even when its field names are unrecognized, self-diagnosing zero extraction", () => {
  const propsJson = JSON.stringify({
    searchResultsProps: {
      results: [
        {
          product_id: 138022,
          slug: "pokemon-etb",
          name: "Pokemon Pitch Black Elite Trainer Box",
          heroImage: "https://cdn.example.com/etb.jpg",
          priceInCents: 6999
        },
        {
          product_id: 138023,
          slug: "riftbound-deck",
          name: "Riftbound Deck",
          image_url: "https://cdn.example.com/riftbound.jpg",
          default_price: "21.86"
        },
        {
          product_id: 138024,
          slug: "explicit-msrp-deck",
          name: "Deck with explicit MSRP",
          msrp_cents: 2186
        }
      ],
      pagination: { total_pages: 1 }
    }
  });
  const html = `<html><body><div data-react-class="products/YourProductsApp" data-react-props='${propsJson}'></div></body></html>`;
  const dom = new JSDOM(html, { url: "https://www.trackalacker.com/products/followed" });
  const bridge = loadBridge({ document: dom.window.document });
  const parseFollowedPage = bridge.parseFollowedPage as (
    documentValue: Document,
    pageUrl: string,
    sampleSink?: { listItem: Record<string, unknown> | null; productDetail: Record<string, unknown> | null }
  ) => { items: Array<{ sourceProductId: string; imageUrl: string; msrpCents: number | null }> };

  const sink: {
    listItem: Record<string, unknown> | null;
    productDetail: Record<string, unknown> | null;
  } = { listItem: null, productDetail: null };
  const parsed = parseFollowedPage(dom.window.document, "https://www.trackalacker.com/products/followed", sink);

  // Item 1 uses unrecognized field names: extraction correctly finds nothing.
  const unrecognized = parsed.items.find((item) => item.sourceProductId === "138022");
  assert.ok(unrecognized);
  assert.equal(unrecognized?.imageUrl, "");
  assert.equal(unrecognized?.msrpCents, null);

  // An ordinary default price remains unknown as MSRP, while image extraction still works.
  const recognized = parsed.items.find((item) => item.sourceProductId === "138023");
  assert.ok(recognized);
  assert.equal(recognized?.imageUrl, "https://cdn.example.com/riftbound.jpg");
  assert.equal(recognized?.msrpCents, null);
  assert.equal(parsed.items.find((item) => item.sourceProductId === "138024")?.msrpCents, 2186);

  // The sample sink captured the FIRST raw item's true field names regardless of
  // whether they were recognized — this is what lets an operator see the real payload.
  assert.equal(sink.listItem?.product_id, 138022);
  assert.equal(sink.listItem?.heroImage, "https://cdn.example.com/etb.jpg");
  assert.equal(sink.listItem?.priceInCents, 6999);
});

test("retained photo_items field supports bounded nested photos and skips unusable gallery entries", () => {
  const image = loadBridge().productImageUrl as (record: Record<string, unknown>) => string;
  assert.equal(image({ photo_items: [null, { photo: { url: "https://static.trackalacker.com/uploads/products/photo_item/photo/123/exact.png" } }] }),
    "https://static.trackalacker.com/uploads/products/photo_item/photo/123/exact.png");
  assert.equal(image({ photo_items: [{ photo: { url: "javascript:alert(1)" } }, { image_url: "https://cdn.example.com/exact.png" }] }), "https://cdn.example.com/exact.png");
  assert.equal(image({ photo_items: [{ photo: { url: "https://user:pass@cdn.example.com/wrong.png" } }] }), "");
  assert.equal(image({ photo_items: [{ unrelated: "https://cdn.example.com/not-a-product.png" }] }), "");
  assert.equal(image({ canonical_image_url: "https://cdn.example.com/canonical.png" }), "https://cdn.example.com/canonical.png");
  assert.equal(image({ photo_items: [{ photo: { original: { url: "https://cdn.example.com/original.png" } } }] }), "https://cdn.example.com/original.png");
});

test("srcset preserves CDN transformation commas and encoded image query separators", () => {
  const bridge = loadBridge();
  const image = bridge.productImageUrl as (record: Record<string, unknown>) => string;
  const url = "https://static.trackalacker.com/cdn-cgi/image/fit=pad,width=1200,height=630,quality=85,format=jpeg/uploads/exact.png";
  assert.equal(image({ srcset: `${url} 1200w, https://cdn.example.com/large.png 2400w` }), url);
  assert.equal(image({ photo_items: [{ photo: { srcset: `${url} 1x` } }] }), url);
  const og = bridge.extractOgImage as (html: string) => string;
  assert.equal(og('<meta property="og:image" content="https://cdn.example.com/a.png?width=600&amp;height=400">'), "https://cdn.example.com/a.png?width=600&height=400");
});
