import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { resolveApiRoutePolicy } from "../apps/api/src/api-route-policy.js";
import { SAVED_TEST_ITEMS_LIMIT, TEST_CALL_CONFIRMATION, type StockCheckReport } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { RestockPatternRepository } from "../packages/database/src/restock-pattern-repository.js";
import { StockCheckRepository, pageProductTitle } from "../packages/database/src/stock-check-repository.js";
import { TestCallRepository } from "../packages/database/src/test-call-repository.js";

// Kevin, 2026-10-12: "Can we save the items that are being tested. Also register
// the inventory status and log/update the DB during the interactions. If a user
// is browsing through a product and it becomes out of stock. That stock status
// should reflect, same with in stock."

const NOW = Date.parse("2026-10-12T18:00:00.000Z");
const MINUTE = 60_000;

function catalogItem(db: YoinkDatabase, retailerId = "target", retailerSku = "95222222", title = "NeeDoh Teenie Funky Pups") {
  db.run("UPDATE source_connections SET status='connected' WHERE id='source_trackalacker_local'");
  return new CatalogRepository(db).upsertListing({ sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
    sourceProductId: `stock-${retailerId}-${retailerSku}`, sourceListingId: `stock-listing-${retailerId}-${retailerSku}`, title,
    retailerId, retailerSku, canonicalUrl: retailerId === "amazon" ? `https://www.amazon.com/dp/${retailerSku}` : `https://www.target.com/p/-/A-${retailerSku}`,
    executionSupported: true, listingStatus: "out_of_stock", observedPriceCents: 599, msrpCents: 599, currency: "USD",
    observedAt: new Date(NOW - 60 * MINUTE).toISOString() }, NOW - 60 * MINUTE).listing;
}

function seen(overrides: Partial<StockCheckReport> = {}, at = NOW): StockCheckReport {
  return { retailerId: "target", retailerSku: "95222222", availability: "in_stock", unitPriceCents: 599,
    sellerName: "Target", sellerType: "first_party", observedAt: new Date(at).toISOString(), via: "browsing", ...overrides };
}

function latest(db: YoinkDatabase, listingId: string) {
  const row = db.get<{ availability: string; price: number | null; seller: string; source: string; at: string }>(
    `SELECT oo.availability, oo.unit_price_cents AS price, oo.seller_type AS seller, sc.source, oo.observed_at AS at
     FROM offer_observations oo JOIN source_connections sc ON sc.id = oo.source_connection_id
     WHERE oo.listing_id = ? ORDER BY oo.observed_at DESC, oo.id DESC LIMIT 1`, listingId);
  return row ? { ...row } : row;
}

test("what Chrome sees on a product page becomes the item's stock: sold out, back in stock, sold out again", () => {
  const db = new YoinkDatabase();
  try {
    const listing = catalogItem(db);
    const checks = new StockCheckRepository(db);
    assert.equal(latest(db, listing.id)?.availability, "out_of_stock", "the last call said sold out");

    assert.deepEqual(checks.record([seen()], NOW), [{ retailerId: "target", retailerSku: "95222222", outcome: "recorded", changed: true }]);
    assert.deepEqual(latest(db, listing.id), { availability: "in_stock", price: 599, seller: "first_party", source: "browser",
      at: new Date(NOW).toISOString() });

    // The same page a minute later adds nothing; the stock log only grows when something changes or every 10 minutes.
    assert.equal(checks.record([seen({}, NOW + MINUTE)], NOW + MINUTE)[0]?.outcome, "unchanged");
    assert.equal(checks.record([seen({ unitPriceCents: 549 }, NOW + 2 * MINUTE)], NOW + 2 * MINUTE)[0]?.outcome, "recorded", "a new price is recorded");
    assert.deepEqual(checks.record([seen({ availability: "out_of_stock", unitPriceCents: null }, NOW + 3 * MINUTE)], NOW + 3 * MINUTE)[0],
      { retailerId: "target", retailerSku: "95222222", outcome: "recorded", changed: true });
    assert.equal(latest(db, listing.id)?.availability, "out_of_stock");
    assert.equal(checks.record([seen({ availability: "out_of_stock", unitPriceCents: null }, NOW + 14 * MINUTE)], NOW + 14 * MINUTE)[0]?.outcome,
      "recorded", "still sold out ten minutes later is recorded again, so the check time stays current");
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM offer_observations WHERE listing_id = ?", listing.id)?.n, 5);

    // A call's report and Chrome's check share one log: the newest wins either way.
    assert.equal(checks.record([seen({ via: "cart_add" }, NOW + 15 * MINUTE)], NOW + 15 * MINUTE)[0]?.changed, true);
    assert.equal(latest(db, listing.id)?.availability, "in_stock");
  } finally { db.close(); }
});

test("only items in the catalog are recorded, and a report must be well formed and recent", () => {
  const db = new YoinkDatabase();
  try {
    catalogItem(db);
    const checks = new StockCheckRepository(db);
    const before = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM offer_observations")!.n;
    assert.deepEqual(checks.record([seen({ retailerSku: "95999999" })], NOW).map((result) => result.outcome), ["not_in_catalog"],
      "browsing an item Yoink doesn't track saves nothing");
    assert.deepEqual(checks.record([
      seen({ availability: "unknown" as never }),
      seen({ retailerId: "nowhere" as never }),
      seen({ sellerType: "anyone" as never }),
      seen({ via: "guess" as never }),
      seen({ unitPriceCents: -5 }),
      seen({}, NOW - 2 * 60 * MINUTE),
      seen({}, NOW + 30 * MINUTE)
    ], NOW).map((result) => result.outcome), Array(7).fill("rejected"));
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM offer_observations")!.n, before);
    assert.throws(() => checks.record(Array(11).fill(seen()), NOW), /1 to 10/);
    assert.throws(() => checks.record("nope", NOW), /1 to 10/);
  } finally { db.close(); }
});

test("another seller's offer on the store's page keeps its stock but not its price, and isn't shown as the store's", () => {
  const db = new YoinkDatabase();
  try {
    const listing = catalogItem(db, "amazon", "B0GRSZ5TDC", "Schylling NeeDoh Teenie");
    const checks = new StockCheckRepository(db);
    checks.record([seen({ retailerId: "amazon", retailerSku: "B0GRSZ5TDC", unitPriceCents: 2499, sellerName: "Toy Flipper", sellerType: "third_party" })], NOW);
    assert.deepEqual(latest(db, listing.id), { availability: "in_stock", price: null, seller: "third_party", source: "browser",
      at: new Date(NOW).toISOString() });
    const shown = new CatalogRepository(db).listLibrary(50, 0, "", [listing.id])[0];
    assert.equal(shown?.availabilitySellerType, "third_party");
    assert.equal(shown?.currentPriceCents, 599, "the price shown is still the store's own");
    checks.record([seen({ retailerId: "amazon", retailerSku: "B0GRSZ5TDC", unitPriceCents: 599, sellerName: "Amazon.com" }, NOW + MINUTE)], NOW + MINUTE);
    assert.equal(new CatalogRepository(db).listLibrary(50, 0, "", [listing.id])[0]?.availabilitySellerType, undefined);
  } finally { db.close(); }
});

test("Chrome's page checks never count as restocks in an item's restock pattern", () => {
  const db = new YoinkDatabase();
  try {
    const listing = catalogItem(db);
    new StockCheckRepository(db).record([seen()], NOW);
    new StockCheckRepository(db).record([seen({}, NOW + 20 * MINUTE)], NOW + 20 * MINUTE);
    assert.equal(new RestockPatternRepository(db).recompute(listing.id, "America/Los_Angeles", NOW + 30 * MINUTE).sampleCount, 0);
  } finally { db.close(); }
});

test("a linked test item is saved with its max and quantity, named from its page, and can be tested again or removed", () => {
  const db = new YoinkDatabase();
  try {
    db.run("UPDATE retailers SET execution_supported=1");
    db.run("UPDATE app_settings SET execution_mode='live', actions_paused=0");
    const control = new ControlRepository(db);
    const tests = new TestCallRepository(db);
    const link = (url: string, msrpCents: number, quantity: number, at: number) => tests.inputForLink(
      { contractVersion: 1, url, msrpCents, retailerId: "target", quantity, confirmation: TEST_CALL_CONFIRMATION }, control, at);
    link("https://www.target.com/p/needoh/-/A-95333333", 799, 2, NOW);
    link("https://www.target.com/p/-/A-95444444", 1299, 1, NOW + MINUTE);
    const saved = () => tests.savedItems("target");
    assert.deepEqual(saved().map((item) => [item.retailerSku, item.title, item.maxUnitPriceCents, item.quantity, item.availability]), [
      ["95444444", "Test item at Target (95444444)", 1299, 1, null],
      ["95333333", "Test item at Target (95333333)", 799, 2, null]
    ], "newest test first; the stock isn't known until Chrome looks");
    assert.deepEqual(tests.savedItems("walmart"), [], "each store's Test call lists its own");

    // Chrome reads the first item's page while the shopper looks at it.
    const checks = new StockCheckRepository(db);
    checks.record([seen({ retailerSku: "95333333", unitPriceCents: 749, title: "NeeDoh Nice Cube : Target" }, NOW + 2 * MINUTE)], NOW + 2 * MINUTE);
    const first = saved().find((item) => item.retailerSku === "95333333")!;
    assert.deepEqual([first.title, first.availability, first.availabilitySource, first.priceCents, first.availabilityObservedAt],
      ["NeeDoh Nice Cube", "in_stock", "browser", 749, new Date(NOW + 2 * MINUTE).toISOString()]);
    // A name Chrome reads never replaces a real catalog name.
    const real = catalogItem(db, "target", "95555555", "Riftbound Origins Booster");
    checks.record([seen({ retailerSku: "95555555", title: "Something Else : Target" }, NOW + 2 * MINUTE)], NOW + 2 * MINUTE);
    assert.equal(db.get<{ title: string }>("SELECT title FROM variants WHERE id = ?", real.variantId)?.title, "Riftbound Origins Booster");

    // Test again sends the saved link, max and quantity; that item moves to the top.
    const again = saved().find((item) => item.retailerSku === "95333333")!;
    link(again.canonicalUrl, again.maxUnitPriceCents, again.quantity, NOW + 10 * MINUTE);
    assert.deepEqual(saved().map((item) => [item.retailerSku, item.quantity]), [["95333333", 2], ["95444444", 1]]);

    assert.equal(tests.removeSavedItem(saved()[1]!.listingId, NOW + 11 * MINUTE), true);
    assert.equal(tests.removeSavedItem("listing_missing", NOW + 11 * MINUTE), false);
    assert.deepEqual(saved().map((item) => item.retailerSku), ["95333333"]);
  } finally { db.close(); }
});

test(`Yoink keeps the ${SAVED_TEST_ITEMS_LIMIT} most recent test items and skips entries it can't read`, () => {
  const db = new YoinkDatabase();
  try {
    db.run("UPDATE retailers SET execution_supported=1");
    db.run("UPDATE app_settings SET execution_mode='live', actions_paused=0");
    const control = new ControlRepository(db);
    const tests = new TestCallRepository(db);
    for (let index = 0; index < SAVED_TEST_ITEMS_LIMIT + 2; index += 1) {
      tests.inputForLink({ contractVersion: 1, url: `https://www.target.com/p/-/A-${96000000 + index}`, msrpCents: 500,
        retailerId: "target", confirmation: TEST_CALL_CONFIRMATION }, control, NOW + index * MINUTE);
    }
    const saved = tests.savedItems();
    assert.equal(saved.length, SAVED_TEST_ITEMS_LIMIT);
    assert.equal(saved[0]?.retailerSku, String(96000000 + SAVED_TEST_ITEMS_LIMIT + 1));
    assert.ok(!saved.some((item) => item.retailerSku === "96000000" || item.retailerSku === "96000001"), "the two oldest tests are dropped");
    db.run(`UPDATE app_settings SET test_items_json = '[{"listingId":"x","maxUnitPriceCents":0,"quantity":1,"testedAt":"2026-10-12T18:00:00.000Z"},{"nope":1}]'`);
    assert.deepEqual(tests.savedItems(), []);
    db.run("UPDATE app_settings SET test_items_json = 'not json'");
    assert.deepEqual(tests.savedItems(), []);
  } finally { db.close(); }
});

test("a store page's own name loses the store's prefix and suffix", () => {
  assert.equal(pageProductTitle("NeeDoh Nice Cube : Target", "target"), "NeeDoh Nice Cube");
  assert.equal(pageProductTitle("Schylling NeeDoh Gumdrop - Walmart.com", "walmart"), "Schylling NeeDoh Gumdrop");
  assert.equal(pageProductTitle("Pokémon TCG: Elite Trainer Box - Best Buy", "bestbuy"), "Pokémon TCG: Elite Trainer Box");
  assert.equal(pageProductTitle("Amazon.com: Schylling NeeDoh Teenie : Toys & Games", "amazon"), "Schylling NeeDoh Teenie");
  assert.equal(pageProductTitle("  Schylling NeeDoh Teenie  ", "amazon"), "Schylling NeeDoh Teenie");
  assert.equal(pageProductTitle("", "target"), "");
});

test("the companion's stock checks and the saved test items go through their own routes", async () => {
  const db = new YoinkDatabase();
  const now = Date.now();
  const listing = catalogItem(db);
  db.run("UPDATE retailers SET execution_supported=1");
  db.run("UPDATE app_settings SET execution_mode='live', actions_paused=0");
  const devices = new DeviceRepository(db);
  const paired = devices.pair({ pairingCode: devices.createPairingCode().code, name: "Desktop - Windows - Brave" });
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "stock-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { "Content-Type": "application/json", Origin: `chrome-extension://${"a".repeat(32)}`, Authorization: `Bearer ${paired.token}` };
  try {
    assert.equal(resolveApiRoutePolicy("POST", "/api/v1/devices/self/stock-checks")?.permission, "device.self");
    assert.equal(resolveApiRoutePolicy("DELETE", "/api/v1/user/test-calls/saved/listing_abc")?.permission, "user.intent.manage");
    const sent = await fetch(`${origin}/api/v1/devices/self/stock-checks`, { method: "POST", headers,
      body: JSON.stringify({ contractVersion: 1, items: [seen({}, now), seen({ retailerSku: "95999999" }, now)] }) });
    assert.equal(sent.status, 200, await sent.clone().text());
    assert.deepEqual((await sent.json() as { results: Array<{ outcome: string }> }).results.map((result) => result.outcome), ["recorded", "not_in_catalog"]);
    assert.equal(latest(db, listing.id)?.source, "browser");
    for (const body of [{ contractVersion: 1, items: "nope" }, { contractVersion: 2, items: [] }, { contractVersion: 1, items: Array(11).fill(seen({}, now)) }]) {
      const bad = await fetch(`${origin}/api/v1/devices/self/stock-checks`, { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal(bad.status, 400);
    }
    const unpaired = await fetch(`${origin}/api/v1/devices/self/stock-checks`, { method: "POST",
      headers: { ...headers, Authorization: "Bearer nope" }, body: JSON.stringify({ contractVersion: 1, items: [seen({}, now)] }) });
    assert.equal(unpaired.status, 401);

    const tested = await fetch(`${origin}/api/v1/user/test-calls/link`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contractVersion: 1, url: "https://www.target.com/p/-/A-95333333", msrpCents: 799, retailerId: "target",
        quantity: 2, confirmation: TEST_CALL_CONFIRMATION }) });
    assert.equal(tested.status, 202, await tested.clone().text());
    const listed = await fetch(`${origin}/api/v1/user/test-calls/candidates?retailerId=target`).then((response) => response.json()) as
      { items: unknown[]; saved: Array<{ listingId: string; retailerSku: string; quantity: number; maxUnitPriceCents: number }> };
    assert.deepEqual(listed.saved.map((item) => [item.retailerSku, item.quantity, item.maxUnitPriceCents]), [["95333333", 2, 799]]);
    const removed = await fetch(`${origin}/api/v1/user/test-calls/saved/${listed.saved[0]!.listingId}`, { method: "DELETE",
      headers: { "X-Yoink-Request": "1" } });
    assert.deepEqual(await removed.json(), { removed: true });
    const after = await fetch(`${origin}/api/v1/user/test-calls/candidates?retailerId=target`).then((response) => response.json()) as { saved: unknown[] };
    assert.deepEqual(after.saved, []);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
    db.close();
  }
});
