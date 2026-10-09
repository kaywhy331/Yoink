import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import { createYoinkServer } from "../apps/api/src/app.js";
import type { TrackalackerCatalogItemInput, TrackalackerKnownListing } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { AuditRepository } from "../packages/database/src/audit-repository.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { SourceRepository } from "../packages/database/src/source-repository.js";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

// Kevin, 2026-10-09: syncing items from TrackaLacker "seems a bit slow". A full
// pass took 1 h 45 min, mostly re-reading History and re-resolving store items
// one at a time with fixed pauses; it was manual and an update cut it off.
const NOW = Date.parse("2026-10-09T18:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const productUrl = (slug: string) => `https://www.trackalacker.com/products/showcase/${slug}`;

function item(listings: TrackalackerCatalogItemInput["listings"], productId = "138022", slug = "fixture"): TrackalackerCatalogItemInput {
  return { sourceProductId: productId, sourceProductSlug: slug, sourceProductUrl: productUrl(slug), title: "Sync Fixture",
    observedAt: new Date(NOW).toISOString(), listings };
}

test("Yoink tells a sync each listing's store item and when its History was last read", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    catalog.upsertTrackalackerItem(item([
      { sourceListingId: "901", storeName: "Target", retailerId: "target", retailerSku: "95280910",
        canonicalUrl: "https://www.target.com/p/-/A-95280910", sourceListingUrl: `${productUrl("fixture")}/listings/901/item`,
        outboundUrl: "https://www.target.com/p/-/A-95280910", availability: "in_stock", unitPriceCents: 2499, historyChecked: true },
      { sourceListingId: "902", storeName: "Other store", sourceListingUrl: `${productUrl("fixture")}/listings/902/item`,
        outboundUrl: "https://example-store.test/item/902" }
    ]), NOW);
    const known = catalog.trackalackerKnownListings();
    assert.deepEqual(known["901"], { retailerId: "target", retailerSku: "95280910", canonicalUrl: "https://www.target.com/p/-/A-95280910",
      outboundUrl: "https://www.target.com/p/-/A-95280910", historyCheckedAt: new Date(NOW).toISOString() } satisfies TrackalackerKnownListing);
    assert.deepEqual(known["902"], { retailerId: "", retailerSku: "", canonicalUrl: "", outboundUrl: "https://example-store.test/item/902", historyCheckedAt: "" },
      "an unresolved listing is known, with no store item and History never read");
    // A later pass that reads 902's History records when, even though it found no MSRP.
    catalog.upsertTrackalackerItem(item([{ sourceListingId: "902", storeName: "Other store",
      sourceListingUrl: `${productUrl("fixture")}/listings/902/item`, outboundUrl: "https://example-store.test/item/902", historyChecked: true }]), NOW + DAY);
    assert.equal(catalog.trackalackerKnownListings()["902"]?.historyCheckedAt, new Date(NOW + DAY).toISOString());
    // Not reading it again leaves the date alone.
    catalog.upsertTrackalackerItem(item([{ sourceListingId: "902", storeName: "Other store",
      sourceListingUrl: `${productUrl("fixture")}/listings/902/item`, outboundUrl: "https://example-store.test/item/902" }]), NOW + 2 * DAY);
    assert.equal(catalog.trackalackerKnownListings()["902"]?.historyCheckedAt, new Date(NOW + DAY).toISOString());
  } finally { db.close(); }
});

test("Yoink tells a sync which products already have a picture, and diagnostics carry the latest field sample", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    catalog.upsertTrackalackerItem({ ...item([], "138022", "pictured"),
      imageUrl: "https://static.trackalacker.com/uploads/products/photo_item/photo/541236/pictured.webp" }, NOW);
    catalog.upsertTrackalackerItem(item([], "138023", "bare"), NOW);
    assert.deepEqual(catalog.trackalackerProductsWithImages(), ["138022"]);
    new AuditRepository(db).record({ correlationId: "tlsync_fixture_1234", aggregateType: "trackalacker_sync",
      eventType: "trackalacker_sync_sample", reasonCode: "raw_field_sample_captured", message: "Captured a sample.",
      data: { photoItem: { id: 541236, photo: { url: "/uploads/products/photo_item/photo/541236/pictured.webp" } } } }, NOW);
    const status = new SourceRepository(db).trackalackerStatus() as { productsWithImages: number; latestFieldSample: { photoItem: unknown } };
    assert.equal(status.productsWithImages, 1);
    assert.deepEqual(status.latestFieldSample.photoItem, { id: 541236, photo: { url: "/uploads/products/photo_item/photo/541236/pictured.webp" } });
  } finally { db.close(); }
});

test("a run picks up one an update cut off: it closes that run and skips what it already saved", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const device = devices.pair({ pairingCode: devices.createPairingCode(NOW).code }, NOW + 100);
    const other = devices.pair({ pairingCode: devices.createPairingCode(NOW).code }, NOW + 100);
    const sources = new SourceRepository(db);
    const start = (syncId: string, at: number, resumeOf = "") => sources.startSyncRun(device.id, { syncId, phase: "starting",
      page: 0, pages: 0, discovered: 0, processed: 0, imported: 0, failed: 0, ...(resumeOf ? { resumeOf } : {}) }, at);
    start("tlsync_first_run_1234", NOW + 200);
    sources.recordSyncItem(device.id, "tlsync_first_run_1234", "138022", { candidatesAccepted: 1, listingsMapped: 1, listingsCreated: 0 }, NOW + 300);
    sources.recordSyncItem(device.id, "tlsync_first_run_1234", "138023", { candidatesAccepted: 1, listingsMapped: 1, listingsCreated: 0 }, NOW + 400);
    assert.throws(() => start("tlsync_second_run_123", NOW + 60_000), /already active/, "a fresh run is not replaced by accident");
    const resumed = start("tlsync_second_run_123", NOW + 60_000, "tlsync_first_run_1234");
    assert.equal(resumed.phase, "starting");
    const first = sources.listSyncRuns().find((run) => run.id === "tlsync_first_run_1234")!;
    assert.equal(first.phase, "error");
    assert.match(String(first.message), /picked up where it stopped/);
    assert.deepEqual(sources.syncRunImportedProducts(device.id, "tlsync_first_run_1234").sort(), ["138022", "138023"]);
    assert.deepEqual(sources.syncRunImportedProducts(other.id, "tlsync_first_run_1234"), [], "only the run's own device sees it");
  } finally { db.close(); }
});

test("the companion reads the plan over its device route", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, webRoot: "apps/web", version: "test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const devices = new DeviceRepository(db);
    const device = devices.pair({ pairingCode: devices.createPairingCode(Date.now()).code, capabilities: { trackalackerCatalogSync: true } }, Date.now()) as { id: string; token: string };
    new CatalogRepository(db).upsertTrackalackerItem(item([{ sourceListingId: "901", storeName: "Target", retailerId: "target",
      retailerSku: "95280910", canonicalUrl: "https://www.target.com/p/-/A-95280910", sourceListingUrl: `${productUrl("fixture")}/listings/901/item` }]), Date.now());
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/devices/self/sources/trackalacker/catalog/known`, {
      headers: { Authorization: `Bearer ${device.token}` }
    });
    assert.equal(response.status, 200);
    const { plan } = await response.json() as { plan: { listings: Record<string, TrackalackerKnownListing>; skipProductIds: string[] } };
    assert.equal(plan.listings["901"]?.retailerSku, "95280910");
    assert.deepEqual(plan.skipProductIds, []);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});

// --- The sync script, run against a fake TrackaLacker -------------------------------------

interface FakeOptions {
  products: number;
  listingsPerProduct?: number;
  mode: "quick" | "full";
  known?: Record<string, TrackalackerKnownListing>;
  skipProductIds?: string[];
  latencyMs?: number;
  tooManyRequestsAfter?: number;
  /** Products without photo_items, and the ones Yoink already has a picture for. */
  noPhotos?: boolean;
  productsWithImages?: string[];
}

function fakeTrackalacker(options: FakeOptions) {
  const fetches: Array<{ url: string; startedAt: number }> = [];
  const messages: Array<Record<string, any>> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let productFetches = 0;
  const slugs = Array.from({ length: options.products }, (_, index) => `fixture-${index}`);
  const listingsFor = (index: number) => Array.from({ length: options.listingsPerProduct ?? 1 }, (_, listing) => {
    const id = String(1000 + index * 10 + listing);
    return { id: Number(id), provider: { display_name: "Target" }, url: `https://www.target.com/p/-/A-9${id}`,
      show_path: `/products/showcase/${slugs[index]}/listings/${id}/item`, current_status: { price: "24.99", stock_status: "In Stock" } };
  });
  const page = () => {
    const props = JSON.stringify({ searchResultsProps: { pagination: { total_pages: 1 },
      results: slugs.map((slug, index) => ({ product_id: 5000 + index, slug, name: `Product ${index}`, show_path: `/products/showcase/${slug}` })) } });
    return `<html><body><div data-react-class="products/YourProductsApp" data-react-props="${props.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></div></body></html>`;
  };
  const respond = (url: string, status: number, body: string) => ({
    ok: status >= 200 && status < 300, status, redirected: false, url,
    text: async () => body, json: async () => JSON.parse(body)
  });
  const fetch = async (url: string) => {
    fetches.push({ url, startedAt: Date.now() });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (options.latencyMs) await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
      if (url.includes("/products/followed")) return respond(url, 200, page());
      const product = /\/products\/showcase\/(fixture-\d+)\.json$/.exec(url);
      if (product) {
        productFetches += 1;
        if (options.tooManyRequestsAfter !== undefined && productFetches > options.tooManyRequestsAfter) return respond(url, 429, "slow down");
        const index = slugs.indexOf(product[1]!);
        // photo_items as a path on TrackaLacker's image host, not a full URL.
        const photos = options.noPhotos ? [] : [{ id: 7000 + index, photo: { url: `/uploads/products/photo_item/photo/${7000 + index}/product-${index}.webp` } }];
        return respond(url, 200, JSON.stringify({ product: { name: `Product ${index}`, photo_items: photos, listings: listingsFor(index) } }));
      }
      const productPage = /\/products\/showcase\/(fixture-\d+)$/.exec(url);
      if (productPage) {
        return respond(url, 200, `<html><head><meta property="og:image" content="https://static.trackalacker.com/cdn-cgi/image/fit=pad,width=1200,height=630/uploads/products/photo_item/photo/9${slugs.indexOf(productPage[1]!)}/share.png"></head></html>`);
      }
      if (url.includes("/listings/")) return respond(url, 200, "<html><body><table><tr><th>Time (PDT)</th><th>Price</th><th>Status</th></tr></table></body></html>");
      return respond(url, 404, "");
    } finally {
      inFlight -= 1;
    }
  };
  let finished: (value: Record<string, any>) => void;
  const done = new Promise<Record<string, any>>((resolve) => { finished = resolve; });
  const sendMessage = async (message: Record<string, any>) => {
    messages.push(message);
    if (message.type === "yoink:trackalacker-sync-plan") {
      return { ok: true, mode: options.mode, plan: { listings: options.known ?? {}, skipProductIds: options.skipProductIds ?? [], productsWithImages: options.productsWithImages ?? [] } };
    }
    if (message.type === "yoink:resolve-trackalacker-listing") {
      const sku = /A-(\d+)/.exec(String(message.url))?.[1] ?? "";
      return { ok: true, identity: { retailerId: "target", retailerSku: sku, canonicalUrl: String(message.url) } };
    }
    if (message.type === "yoink:trackalacker-sync-progress" && ["complete", "error"].includes(message.phase)) finished(message);
    return { ok: true };
  };
  const window = new JSDOM("").window;
  const context = createContext({ URL, Date, AbortController, DOMParser: window.DOMParser, setTimeout, clearTimeout, fetch,
    chrome: { runtime: { sendMessage } } });
  runInContext(readFileSync("apps/extension/trackalacker-sync.js", "utf8"), context);
  const api = (context as unknown as { YoinkTrackalackerSync: { startTrackalackerSync: (id: string, mode: string) => { ok: boolean } } }).YoinkTrackalackerSync;
  return {
    start: () => api.startTrackalackerSync("tlsync_fixture_speed_1234", options.mode),
    done,
    fetches,
    messages,
    items: () => messages.filter((message) => message.type === "yoink:trackalacker-sync-item").map((message) => message.item),
    maxInFlight: () => maxInFlight
  };
}

function knownFor(products: number, historyCheckedAt: string): Record<string, TrackalackerKnownListing> {
  return Object.fromEntries(Array.from({ length: products }, (_, index) => {
    const id = String(1000 + index * 10);
    return [id, { retailerId: "target", retailerSku: `9${id}`, canonicalUrl: `https://www.target.com/p/-/A-9${id}`,
      outboundUrl: `https://www.target.com/p/-/A-9${id}`, historyCheckedAt }];
  }));
}

test("a quick refresh reads the list and each product once: no History, no store lookups it has done before", async () => {
  const fake = fakeTrackalacker({ products: 4, mode: "quick", known: knownFor(4, "") });
  fake.start();
  const final = await fake.done;
  assert.equal(final.phase, "complete", JSON.stringify(final));
  assert.deepEqual([final.discovered, final.processed, final.imported, final.failed], [4, 4, 4, 0]);
  assert.equal(fake.fetches.length, 5, "the followed page and four product details");
  assert.ok(!fake.fetches.some((entry) => entry.url.includes("/listings/")), "no History pages");
  assert.equal(fake.messages.filter((message) => message.type === "yoink:resolve-trackalacker-listing").length, 0, "no store lookups");
  assert.equal(fake.items()[0].listings[0].retailerSku, "91000");
  assert.equal(fake.items().find((product: any) => product.sourceProductId === "5000").imageUrl,
    "https://static.trackalacker.com/uploads/products/photo_item/photo/7000/product-0.webp", "a photo_items path becomes a full address");
  assert.match(final.message, /Prices and stock refreshed/);
});

// Kevin, 2026-10-09: "The items needs images." Only 38 of 739 products had one.
test("every product Yoink has no picture for gets its page's share image, on any pass and beyond the old 25", async () => {
  const fake = fakeTrackalacker({ products: 30, mode: "quick", known: knownFor(30, ""), noPhotos: true, productsWithImages: ["5000", "5001"] });
  fake.start();
  const final = await fake.done;
  assert.equal(final.phase, "complete", JSON.stringify(final));
  const pages = fake.fetches.filter((entry) => /\/products\/showcase\/fixture-\d+$/.test(entry.url));
  assert.equal(pages.length, 28, "every product without a picture, none that has one");
  assert.ok(!pages.some((entry) => /fixture-[01]$/.test(entry.url)));
  const pictured = fake.items().filter((product: any) => product.imageUrl);
  assert.equal(pictured.length, 28);
  assert.match(pictured[0].imageUrl, /^https:\/\/static\.trackalacker\.com\/cdn-cgi\/image\/.+\/uploads\/products\/photo_item\/photo\//);
});

test("the sync reports the first photo_items entry in full, so its real shape shows in diagnostics", async () => {
  const fake = fakeTrackalacker({ products: 2, mode: "quick", known: knownFor(2, "") });
  fake.start();
  await fake.done;
  const sample = fake.messages.find((message) => message.type === "yoink:trackalacker-sync-sample")?.sample;
  assert.ok(sample, "a sample was sent");
  assert.equal(Object.keys(sample)[0], "photoItem", "first, so the size cap keeps it");
  assert.deepEqual(JSON.parse(JSON.stringify(sample.photoItem)), { id: 7000, photo: { url: "/uploads/products/photo_item/photo/7000/product-0.webp" } });
});

test("a full pass reads History only for listings not checked in 7 days, and records each one it read", async () => {
  const known = { ...knownFor(3, new Date(Date.now() - DAY).toISOString()),
    "1010": { ...knownFor(3, "")["1010"]!, historyCheckedAt: new Date(Date.now() - 8 * DAY).toISOString() } };
  const fake = fakeTrackalacker({ products: 3, mode: "full", known });
  fake.start();
  const final = await fake.done;
  assert.equal(final.phase, "complete", JSON.stringify(final));
  const history = fake.fetches.filter((entry) => entry.url.includes("/listings/"));
  assert.equal(history.length, 1, "only the listing last read 8 days ago");
  assert.match(history[0]!.url, /\/listings\/1010\//);
  const read = fake.items().flatMap((product: any) => product.listings).filter((listing: any) => listing.historyChecked === true);
  assert.deepEqual(read.map((listing: any) => listing.sourceListingId), ["1010"]);
  assert.match(final.message, /History read for 1 listing/);
});

test("products run a few at a time under one shared pace", async () => {
  const fake = fakeTrackalacker({ products: 6, mode: "quick", known: knownFor(6, ""), latencyMs: 900 });
  const started = Date.now();
  fake.start();
  const final = await fake.done;
  assert.equal(final.phase, "complete");
  assert.ok(fake.maxInFlight() >= 2 && fake.maxInFlight() <= 3, `in flight at once: ${fake.maxInFlight()}`);
  const starts = fake.fetches.map((entry) => entry.startedAt);
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok(starts[index]! - starts[index - 1]! >= 300, "requests start at most about 3 a second");
  }
  // One at a time at 900 ms each would take over 6 s; in parallel about 7 starts × 333 ms + 900 ms.
  assert.ok(Date.now() - started < 4_500, `took ${Date.now() - started} ms`);
});

test("TrackaLacker asking to slow down stops the run without working around it", async () => {
  const fake = fakeTrackalacker({ products: 30, mode: "quick", known: knownFor(30, ""), tooManyRequestsAfter: 2 });
  fake.start();
  const final = await fake.done;
  assert.equal(final.phase, "error");
  assert.equal(final.stopReason, "blocked");
  assert.match(final.message, /asked Yoink to slow down/);
  // At most the products already under way (6 at a time) finish; no new ones start.
  assert.ok(fake.fetches.filter((entry) => entry.url.endsWith(".json")).length <= 9, "no new products after the refusal");
});

test("a resumed run skips the products the interrupted run saved and counts them as done", async () => {
  const fake = fakeTrackalacker({ products: 4, mode: "quick", known: knownFor(4, ""), skipProductIds: ["5000", "5001"] });
  fake.start();
  const final = await fake.done;
  assert.equal(final.phase, "complete");
  assert.deepEqual([final.discovered, final.processed, final.imported], [4, 4, 4]);
  assert.deepEqual(fake.fetches.filter((entry) => entry.url.endsWith(".json")).map((entry) => entry.url.match(/fixture-\d+/)?.[0]).sort(),
    ["fixture-2", "fixture-3"]);
  assert.ok(!fake.messages.some((message) => message.type === "yoink:trackalacker-sync-progress" && message.phase === "discovering"),
    "a resumed run never moves back to discovering");
});
