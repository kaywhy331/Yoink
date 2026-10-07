import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  PRODUCT_WANT_CONTRACT_VERSION,
  PRODUCT_WANT_PREVIEW_CONFIRMATION,
  PRODUCT_WANT_SAVE_CONFIRMATION
} from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import {
  ProductImageStore,
  productImageKey,
  productImageSources
} from "../packages/database/src/product-image-store.js";
import {
  PRODUCT_IMAGE_MAX_BYTES,
  productImageDownloadUrl,
  productImageType
} from "../packages/domain/src/product-image.js";
import { ProductImageCache } from "../packages/engine/src/product-image-cache.js";

const UPLOAD = "uploads/products/photo_item/photo/541236/pokemon-30th-celebration-elite-trainer-box.webp";
const BANNER = `https://static.trackalacker.com/cdn-cgi/image/fit=pad,width=1200,height=630,quality=85,format=jpeg/${UPLOAD}`;
const ORIGINAL = `https://static.trackalacker.com/${UPLOAD}`;
const FITTED = `https://static.trackalacker.com/cdn-cgi/image/fit=contain,width=480,height=480,quality=85,format=webp/${UPLOAD}`;
const OTHER_UPLOAD = "uploads/products/photo_item/photo/541238/auto.png";
const OTHER_BANNER = `https://static.trackalacker.com/cdn-cgi/image/fit=pad,width=1200,height=630,quality=85,format=jpeg/${OTHER_UPLOAD}`;
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(32, 7)]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const AVIF = Buffer.concat([Buffer.from([0, 0, 0, 28]), Buffer.from("ftypavif"), Buffer.alloc(8)]);

function tempData(label: string): string {
  return mkdtempSync(join(tmpdir(), `yoink-product-images-${label}-`));
}

function keyOf(sourceUrl: string): string {
  return productImageKey(productImageDownloadUrl(sourceUrl));
}

interface FakeFetch {
  fetch: typeof fetch;
  requests: string[];
}

function fakeFetch(respond: (url: string, init: RequestInit | undefined) => Response | Promise<Response>): FakeFetch {
  const requests: string[] = [];
  return {
    requests,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      return respond(url, init);
    }) as typeof fetch
  };
}

function routine(store: ProductImageStore, sources: string[] | (() => string[]), fetcher: FakeFetch, clock = { now: 0 }, sleeps: number[] = []): ProductImageCache {
  return new ProductImageCache({
    store,
    sources: typeof sources === "function" ? sources : () => sources,
    fetch: fetcher.fetch,
    now: () => clock.now,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    spacingMs: 2_000
  });
}

test("Yoink downloads one product-shaped copy of TrackaLacker photos and leaves every other link alone", () => {
  assert.equal(productImageDownloadUrl(BANNER), FITTED, "the share banner becomes the product photo itself");
  assert.equal(productImageDownloadUrl(ORIGINAL), FITTED, "the original upload maps to the same copy");
  assert.equal(productImageDownloadUrl(`${ORIGINAL}?v=2#top`), FITTED);
  assert.equal(productImageDownloadUrl("https://STATIC.trackalacker.com/" + UPLOAD), FITTED);
  for (const link of [
    "http://static.trackalacker.com/" + UPLOAD,
    "https://static.trackalacker.com:8443/" + UPLOAD,
    "https://user:pass@static.trackalacker.com/" + UPLOAD,
    "https://www.trackalacker.com/" + UPLOAD,
    "https://i5.walmartimages.com/seo/item.jpeg",
    "https://static.trackalacker.com/assets/logo.png",
    "https://static.trackalacker.com/uploads//products/x.png",
    "/media/products/abc.webp",
    "not a link",
    ""
  ]) assert.equal(productImageDownloadUrl(link), "", link);
});

test("only real image bytes count as a product image", () => {
  assert.equal(productImageType(WEBP), "webp");
  assert.equal(productImageType(JPEG), "jpg");
  assert.equal(productImageType(PNG), "png");
  assert.equal(productImageType(AVIF), "avif");
  assert.equal(productImageType(Buffer.from("<!DOCTYPE html><title>Just a moment...</title>")), null);
  assert.equal(productImageType(Buffer.from("{\"error\":\"nope\"}")), null);
  assert.equal(productImageType(Buffer.alloc(0)), null);
});

test("saved copies are found by their download address, survive a restart, and only unused ones are pruned", () => {
  const dataDirectory = tempData("store");
  try {
    const store = new ProductImageStore(dataDirectory);
    assert.equal(store.localUrl(BANNER), BANNER, "no copy yet: the original link stays");
    const name = store.save(keyOf(BANNER), WEBP, "webp");
    assert.equal(name, `${keyOf(BANNER)}.webp`);
    assert.equal(store.localUrl(BANNER), `/media/products/${name}`);
    assert.equal(store.localUrl(ORIGINAL), `/media/products/${name}`, "the same photo by another link uses the same copy");
    assert.equal(store.localUrl("https://i5.walmartimages.com/seo/item.jpeg"), "https://i5.walmartimages.com/seo/item.jpeg");
    assert.deepEqual(store.read(name)?.body, WEBP);
    assert.equal(store.read(name)?.contentType, "image/webp");
    for (const bad of ["../yoink.sqlite", `${keyOf(BANNER)}.html`, `${keyOf(OTHER_BANNER)}.webp`, ""]) assert.equal(store.read(bad), null, bad);

    store.save(keyOf(OTHER_BANNER), PNG, "png");
    writeFileSync(join(store.directory, `${"a".repeat(64)}.partial-0123456789abcdef`), "cut off");
    writeFileSync(join(store.directory, "notes.txt"), "not ours");
    const reopened = new ProductImageStore(dataDirectory);
    assert.equal(reopened.savedCount, 2, "a restart finds the saved copies");
    assert.equal(reopened.localUrl(OTHER_BANNER), `/media/products/${keyOf(OTHER_BANNER)}.png`);
    assert.ok(!readdirSync(reopened.directory).some((file) => file.includes(".partial-")), "a cut-off save is cleared");

    assert.equal(reopened.prune(new Set([keyOf(BANNER)])), 1);
    assert.equal(reopened.localUrl(OTHER_BANNER), OTHER_BANNER);
    assert.ok(existsSync(join(reopened.directory, name)));
    assert.ok(existsSync(join(reopened.directory, "notes.txt")), "files Yoink did not write are left alone");
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("each image is downloaded once, one at a time, and never from a host Yoink does not save from", async () => {
  const dataDirectory = tempData("once");
  try {
    const store = new ProductImageStore(dataDirectory);
    const fetcher = fakeFetch((_url, init) => {
      assert.equal(init?.redirect, "error", "a download never follows a redirect elsewhere");
      assert.match(String((init?.headers as Record<string, string>)["User-Agent"]), /Yoink/);
      return new Response(WEBP, { status: 200, headers: { "content-type": "image/webp" } });
    });
    const sleeps: number[] = [];
    const cache = routine(store, [BANNER, ORIGINAL, OTHER_BANNER, "https://i5.walmartimages.com/seo/item.jpeg"], fetcher, { now: 0 }, sleeps);
    const first = await cache.runOnce();
    assert.deepEqual(first, { saved: 2, failed: 0, pending: 0, unsupported: 1, removed: 0 });
    assert.deepEqual(fetcher.requests, [FITTED, productImageDownloadUrl(OTHER_BANNER)], "one download per photo, in priority order");
    assert.deepEqual(sleeps, [2_000], "a pause between downloads");
    assert.equal(store.localUrl(BANNER), `/media/products/${keyOf(BANNER)}.webp`);

    const second = await cache.runOnce();
    assert.deepEqual(second, { saved: 0, failed: 0, pending: 0, unsupported: 1, removed: 0 });
    assert.equal(fetcher.requests.length, 2, "saved images are never downloaded again");
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("a failed download keeps the original link and retries later, not on every run", async () => {
  const dataDirectory = tempData("retry");
  try {
    const store = new ProductImageStore(dataDirectory);
    let status = 503;
    const fetcher = fakeFetch(() => new Response(status === 200 ? WEBP : "busy", { status }));
    const clock = { now: 0 };
    const cache = routine(store, [BANNER], fetcher, clock);
    assert.equal((await cache.runOnce()).failed, 1);
    assert.equal(store.localUrl(BANNER), BANNER);
    clock.now += 9 * 60_000;
    assert.deepEqual(await cache.runOnce(), { saved: 0, failed: 0, pending: 1, unsupported: 0, removed: 0 });
    assert.equal(fetcher.requests.length, 1, "no retry inside the first ten minutes");
    clock.now += 2 * 60_000;
    assert.equal((await cache.runOnce()).failed, 1, "retried after ten minutes");
    clock.now += 11 * 60_000;
    assert.equal(fetcher.requests.length, 2, "the second wait doubles to twenty minutes");
    assert.equal((await cache.runOnce()).saved, 0);
    clock.now += 10 * 60_000;
    status = 200;
    assert.equal((await cache.runOnce()).saved, 1);
    assert.equal(fetcher.requests.length, 3);

    const gone = fakeFetch(() => new Response("gone", { status: 404 }));
    const missing = routine(store, [OTHER_BANNER], gone, clock);
    await missing.runOnce();
    clock.now += 23 * 60 * 60_000;
    await missing.runOnce();
    assert.equal(gone.requests.length, 1, "a missing image waits a day before the next try");
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("a browser check, an oversized file or a refused redirect is never saved", async () => {
  const dataDirectory = tempData("refuse");
  try {
    const store = new ProductImageStore(dataDirectory);
    const responses: Array<() => Response | Promise<Response>> = [
      () => new Response("<!DOCTYPE html><title>Just a moment...</title>", { status: 200, headers: { "content-type": "text/html" } }),
      () => new Response(WEBP, { status: 200, headers: { "content-length": String(PRODUCT_IMAGE_MAX_BYTES + 1) } }),
      () => new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }
      }), { status: 200 }),
      () => Promise.reject(new TypeError("fetch failed: redirect mode is set to error"))
    ];
    for (const respond of responses) {
      const cache = routine(store, [BANNER], fakeFetch(respond));
      const summary = await cache.runOnce();
      assert.equal(summary.saved, 0);
      assert.equal(summary.failed, 1);
      assert.equal(store.localUrl(BANNER), BANNER);
    }
    assert.deepEqual(readdirSync(store.directory), [], "nothing was written");
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("a catalog read that fails or comes back empty never deletes saved copies", async () => {
  const dataDirectory = tempData("prune");
  try {
    const store = new ProductImageStore(dataDirectory);
    store.save(keyOf(BANNER), WEBP, "webp");
    store.save(keyOf(OTHER_BANNER), WEBP, "webp");
    const none = fakeFetch(() => new Response(WEBP));
    await routine(store, () => { throw new Error("database is busy"); }, none).runOnce();
    await routine(store, [], none).runOnce();
    assert.equal(store.savedCount, 2);
    const summary = await routine(store, [ORIGINAL], none).runOnce();
    assert.equal(summary.removed, 1, "a copy no product links to any more is removed");
    assert.equal(store.savedCount, 1);
    assert.equal(none.requests.length, 0);
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for the image routine");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("the schedule runs after start, again soon after an import wakes it, and stop ends a download in flight", async () => {
  const dataDirectory = tempData("schedule");
  try {
    const store = new ProductImageStore(dataDirectory);
    const sources = [BANNER];
    let hang = false;
    const fetcher = fakeFetch((_url, init) => hang
      ? new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        })
      : new Response(WEBP));
    const cache = new ProductImageCache({
      store, sources: () => sources, fetch: fetcher.fetch, startDelayMs: 1, intervalMs: 60 * 60_000, spacingMs: 0
    });
    cache.start();
    await waitFor(() => store.savedCount === 1);
    sources.unshift(OTHER_BANNER);
    cache.wake();
    await waitFor(() => store.savedCount === 2);
    assert.equal(fetcher.requests.length, 2, "the import's image arrived without waiting for the hourly run");

    hang = true;
    sources.unshift("https://static.trackalacker.com/uploads/products/photo_item/photo/9/hangs.webp");
    cache.wake();
    await waitFor(() => fetcher.requests.length === 3);
    await cache.stop();
    assert.equal(store.savedCount, 2, "a stopped download saves nothing");
    cache.wake();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(fetcher.requests.length, 3, "a stopped routine stays stopped");
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("the routine reads every distinct stored image link, newest product first", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const item = (id: string, imageUrl: string) => ({
      sourceProductId: id,
      sourceProductSlug: `image-order-${id}`,
      sourceProductUrl: `https://www.trackalacker.com/products/showcase/image-order-${id}`,
      title: `Image Order ${id}`,
      imageUrl,
      observedAt: new Date().toISOString(),
      listings: []
    });
    catalog.upsertTrackalackerItem(item("1", BANNER));
    catalog.upsertTrackalackerItem(item("2", OTHER_BANNER));
    catalog.upsertTrackalackerItem(item("3", BANNER));
    db.run("UPDATE variants SET created_at = '2026-09-01T00:00:00.000Z' WHERE title = 'Image Order 1'");
    db.run("UPDATE variants SET created_at = '2026-09-02T00:00:00.000Z' WHERE title = 'Image Order 2'");
    db.run("UPDATE variants SET created_at = '2026-09-03T00:00:00.000Z' WHERE title = 'Image Order 3'");
    assert.deepEqual(productImageSources(db), [BANNER, OTHER_BANNER]);
  } finally {
    db.close();
  }
});

test("dashboards load a saved copy from Yoink and keep the original link until one exists", async () => {
  const dataDirectory = tempData("api");
  const db = new YoinkDatabase();
  const store = new ProductImageStore(dataDirectory);
  const server = createYoinkServer({
    db, dataDirectory, productImages: store, webRoot: join(process.cwd(), "apps", "web"), version: "test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const getJson = async (path: string) => {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, path);
    return await response.json() as Record<string, unknown>;
  };
  const postJson = async (path: string, body: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: baseUrl }, body: JSON.stringify(body)
    });
    const payload = await response.json() as Record<string, unknown>;
    assert.ok(response.status < 300, `${path}: ${JSON.stringify(payload)}`);
    return payload;
  };
  try {
    new CatalogRepository(db).upsertTrackalackerItem({
      sourceProductId: "9201",
      sourceProductSlug: "image-cache-fixture",
      sourceProductUrl: "https://www.trackalacker.com/products/showcase/image-cache-fixture",
      title: "Image Cache Fixture",
      imageUrl: BANNER,
      msrpCents: 4999,
      observedAt: new Date().toISOString(),
      listings: [{
        sourceListingId: "920101",
        storeName: "Target",
        retailerId: "target",
        retailerSku: "95222222",
        canonicalUrl: "https://www.target.com/p/-/A-95222222",
        sourceListingUrl: "https://www.trackalacker.com/products/showcase/image-cache-fixture/listings/920101/item",
        availability: "in_stock",
        unitPriceCents: 4999
      }]
    });
    const products = async () => (await getJson("/api/v1/user/library/products?q=Image%20Cache")).items as Array<Record<string, unknown>>;
    assert.equal((await products())[0]?.imageUrl, BANNER, "before a copy exists the dashboard keeps the original link");

    const saved = `/media/products/${keyOf(BANNER)}.webp`;
    store.save(keyOf(BANNER), WEBP, "webp");
    const product = (await products())[0];
    assert.equal(product?.imageUrl, saved);

    const image = await fetch(`${baseUrl}${saved}`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/webp");
    assert.equal(image.headers.get("cache-control"), "private, max-age=604800");
    assert.equal(image.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), WEBP);
    for (const missing of [`/media/products/${"0".repeat(64)}.webp`, "/media/products/..%2Fyoink.sqlite", "/media/products/"]) {
      assert.equal((await fetch(`${baseUrl}${missing}`)).status, 404, missing);
    }

    const listingId = String((product?.listings as Array<Record<string, unknown>>)[0]?.listingId ?? "");
    const want = { contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId, mode: "notify" };
    const preview = (await postJson("/api/v1/user/purchase-intents/want/preview", {
      ...want, confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION
    })).preview as Record<string, unknown>;
    assert.equal(preview.imageUrl, saved, "Want it shows the saved copy");
    await postJson("/api/v1/user/purchase-intents/want", {
      ...want,
      confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint,
      previewedAt: preview.previewedAt
    });
    const plans = (await getJson("/api/v1/user/purchase-intents")).items as Array<Record<string, unknown>>;
    assert.equal(plans[0]?.imageUrl, saved, "Wanted shows the saved copy");
  } finally {
    server.close();
    db.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("a hosted Yoink never serves or links saved copies", async () => {
  const dataDirectory = tempData("hosted");
  const db = new YoinkDatabase();
  const store = new ProductImageStore(dataDirectory);
  store.save(keyOf(BANNER), WEBP, "webp");
  const server = createYoinkServer({
    db, dataDirectory, hosted: true, productImages: store, webRoot: join(process.cwd(), "apps", "web"), version: "test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${baseUrl}/media/products/${keyOf(BANNER)}.webp`)).status, 404);
  } finally {
    server.close();
    db.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});
