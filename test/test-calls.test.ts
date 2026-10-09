import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.js";
import {
  PRODUCT_WANT_PREVIEW_CONFIRMATION,
  PRODUCT_WANT_SAVE_CONFIRMATION,
  TEST_CALL_CONFIRMATION,
  YOINK_TEST_CALL_SOURCE,
  type ProductWantInput
} from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase, LOCAL_TENANT_ID, LOCAL_USER_ID } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ExecutionRepository } from "../packages/database/src/execution-repository.js";
import { TestCallRepository } from "../packages/database/src/test-call-repository.js";
import { PurchasePolicyRepository } from "../packages/database/src/purchase-policy-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";

// Kevin, 2026-10-08: a Test call per store that really adds the chosen item to
// the cart and opens checkout, without waiting for a restock. No order is placed.
const NOW = Date.parse("2026-10-08T17:00:00.000Z");
const STORES = {
  amazon: ["B0TESTCALL", "https://www.amazon.com/dp/B0TESTCALL"],
  target: ["95222222", "https://www.target.com/p/-/A-95222222"],
  walmart: ["6662229", "https://www.walmart.com/ip/6662229"],
  bestbuy: ["6667329", "https://www.bestbuy.com/site/example/6667329.p"]
} as const;

// `at` is the fixture clock; the HTTP test passes the real one because the server reads Date.now().
function fixture(retailer: keyof typeof STORES = "walmart", { want = true, msrp = 2999, max = 2999, price = 2499 } = {}, at = NOW) {
  const db = new YoinkDatabase();
  const [retailerSku, canonicalUrl] = STORES[retailer];
  const lane = ADD_LANES[retailer];
  db.run("UPDATE retailers SET execution_supported=1 WHERE id=?", retailer);
  db.run("UPDATE source_connections SET status='connected' WHERE id='source_trackalacker_local'");
  const listing = new CatalogRepository(db).upsertListing({ sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker", sourceProductId: `test-call-${retailer}`, sourceListingId: `test-call-listing-${retailer}`,
    title: "Ordinary test-call puzzle", retailerId: retailer, retailerSku, canonicalUrl,
    executionSupported: true, listingStatus: "in_stock", observedPriceCents: price, msrpCents: msrp,
    currency: "USD", observedAt: new Date(at - 60_000).toISOString() }, at - 60_000).listing;
  db.run("UPDATE listings SET execution_supported=1 WHERE id=?", listing.id);
  db.run(`INSERT INTO retailer_adapter_qualifications(tenant_id,user_id,retailer_id,adapter_version,highest_action,status,
    evidence_hash,qualified_at,updated_at,expires_at) VALUES(?,?,?,?,'add_to_cart','qualified','fixture-only',?,?,?)`,
  LOCAL_TENANT_ID, LOCAL_USER_ID, retailer, lane.contractVersion, new Date(at).toISOString(), new Date(at).toISOString(),
  new Date(at + 60 * 60_000).toISOString());
  db.run("UPDATE app_settings SET execution_mode='live', actions_paused=0");
  const control = new ControlRepository(db);
  if (want) {
    const input = { contractVersion: 1 as const, listingId: listing.id, mode: "add_to_cart" as const, maxUnitPriceCents: max,
      confirmedMsrpCents: msrp, confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION } satisfies ProductWantInput;
    const preview = control.previewProductWant(input, at - 30_000);
    control.saveProductWant({ ...input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, at - 30_000);
  }
  const device = () => {
    const devices = new DeviceRepository(db);
    return devices.pair({ pairingCode: devices.createPairingCode(at).code,
      capabilities: { jobReconciliation: true, officialMsrpCartV1: true,
        [lane.capability.enabled]: true, [lane.capability.version]: lane.contractVersion } }, at).id;
  };
  const send = (at = NOW) => new SignalEngine(db).process(new TestCallRepository(db).input(
    { contractVersion: 1, listingId: listing.id, confirmation: TEST_CALL_CONFIRMATION }, at), at);
  return { db, listing, control, device, send };
}

for (const retailer of Object.keys(STORES) as Array<keyof typeof STORES>) {
  test(`${retailer}: a test call adds the chosen item to the cart through the usual checks and is marked TEST`, () => {
    const f = fixture(retailer);
    try {
      const [candidate] = new TestCallRepository(f.db).candidates(retailer, NOW);
      assert.deepEqual({ ready: candidate?.ready, price: candidate?.priceCents, max: candidate?.maxUnitPriceCents, msrp: candidate?.msrpCents },
        { ready: true, price: 2499, max: 2999, msrp: 2999 });
      const observations = () => f.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM offer_observations")!.n;
      const listings = () => f.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM listings")!.n;
      const [observationsBefore, listingsBefore] = [observations(), listings()];
      const result = f.send();
      assert.equal(result.actionJobState, "awaiting_executor", JSON.stringify(result));
      assert.equal(observations(), observationsBefore, "a test call records no store price");
      assert.equal(listings(), listingsBefore, "a test call never creates a listing");
      assert.equal(f.db.get<{ source: string }>("SELECT source FROM signal_events ORDER BY received_at DESC LIMIT 1")?.source, YOINK_TEST_CALL_SOURCE);
      const lease = new ExecutionRepository(f.db).leaseNextJob(f.device(), NOW + 2_000);
      assert.equal(lease.reason, "leased", JSON.stringify(lease));
      assert.equal(lease.job?.testCall, true);
      assert.equal(lease.job?.action, "add_to_cart");
      assert.equal(lease.job?.maxUnitPriceCents, 2499, "the job is capped at the price the test call claimed");
      assert.equal(lease.job?.officialMsrp?.msrpCents, 2999);
    } finally { f.db.close(); }
  });
}

test("a real call's job is never marked TEST", () => {
  const f = fixture("walmart");
  try {
    const [retailerSku, canonicalUrl] = STORES.walmart;
    new SignalEngine(f.db).process({ sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
      externalEventId: "real-call", eventType: "restock", observedAt: new Date(NOW).toISOString(),
      identity: { sourceProductId: "test-call-walmart", sourceListingId: "test-call-listing-walmart", retailerId: "walmart",
        retailerSku, canonicalUrl, title: "Ordinary test-call puzzle" },
      offer: { availability: "in_stock", unitPriceCents: 2499, currency: "USD" } }, NOW);
    const lease = new ExecutionRepository(f.db).leaseNextJob(f.device(), NOW + 2_000);
    assert.equal(lease.reason, "leased", JSON.stringify(lease));
    assert.equal(lease.job?.testCall, undefined);
  } finally { f.db.close(); }
});

test("an item that isn't ready says why, and a test call for it is refused", () => {
  const noMsrp = fixture("walmart", { want: false });
  try {
    assert.deepEqual(new TestCallRepository(noMsrp.db).candidates("walmart", NOW), [], "only Add to cart items are listed");
    assert.throws(() => noMsrp.send(), { code: "test_call_not_wanted" });
  } finally { noMsrp.db.close(); }
  const overMax = fixture("walmart", { max: 2299, msrp: 2299 });
  try {
    const [candidate] = new TestCallRepository(overMax.db).candidates("walmart", NOW);
    assert.equal(candidate?.ready, false);
    assert.equal(candidate?.reason, "The last recorded price, $24.99, is above your max of $22.99.");
    assert.throws(() => overMax.send(), { code: "test_call_not_ready", message: /above your max/ });
    assert.equal(overMax.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM action_jobs")!.n, 0);
  } finally { overMax.db.close(); }
});

test("test calls need Auto-cart on and wait five minutes between calls for the same item", () => {
  const f = fixture("amazon");
  try {
    f.db.run("UPDATE app_settings SET actions_paused=1");
    assert.throws(() => f.send(), { code: "test_call_auto_cart_off" });
    f.db.run("UPDATE app_settings SET actions_paused=0");
    assert.equal(f.send().actionJobState, "awaiting_executor");
    assert.throws(() => f.send(NOW + 60_000), { code: "test_call_too_soon", message: /went out 1 min ago/ });
  } finally { f.db.close(); }
});

test("the test call routes list items and send through the shopper API", async () => {
  const f = fixture("bestbuy", {}, Date.now());
  const server = createYoinkServer({ db: f.db, webRoot: join(process.cwd(), "apps/web"), version: "test" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const listed = await fetch(`${origin}/api/v1/user/test-calls/candidates?retailerId=bestbuy`);
    assert.equal(listed.status, 200);
    const { items } = await listed.json() as { items: Array<{ listingId: string; ready: boolean }> };
    assert.deepEqual(items.map((item) => [item.listingId, item.ready, (item as { reason?: string }).reason]), [[f.listing.id, true, ""]]);
    const unconfirmed = await fetch(`${origin}/api/v1/user/test-calls`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contractVersion: 1, listingId: f.listing.id }) });
    assert.equal(unconfirmed.status, 409);
    const sent = await fetch(`${origin}/api/v1/user/test-calls`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contractVersion: 1, listingId: f.listing.id, confirmation: TEST_CALL_CONFIRMATION }) });
    assert.equal(sent.status, 202);
    const body = await sent.json() as { actionJobState: string; actionJobId: string };
    assert.equal(body.actionJobState, "awaiting_executor");
    assert.match(body.actionJobId, /^[A-Za-z0-9_-]+$/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    f.db.close();
  }
});

test("a linked in-stock item gets a test call: added to the catalog, a 15-minute plan for that listing only, removed afterwards", () => {
  // Kevin, 2026-10-08: called items are usually sold out, so he links an in-stock item and gives its MSRP.
  const f = fixture("walmart", { want: false });
  try {
    const control = f.control;
    const tests = new TestCallRepository(f.db);
    const link = (url: string, retailerId = "walmart", at = NOW) => tests.inputForLink(
      { contractVersion: 1, url, msrpCents: 1299, retailerId, confirmation: TEST_CALL_CONFIRMATION }, control, at);
    const input = link("https://www.walmart.com/ip/Some-In-Stock-Thing/5551234?athbdg=L1600");
    const listing = f.db.get<{ id: string; title: string }>(
      "SELECT l.id, v.title FROM listings l JOIN variants v ON v.id = l.variant_id WHERE l.retailer_id='walmart' AND l.retailer_sku='5551234'")!;
    assert.equal(listing.title, "Test item at Walmart (5551234)", "a new item is added to the catalog");
    assert.equal(input.offer?.unitPriceCents, 1299, "the call claims the MSRP");
    const plan = f.db.get<{ id: string; origin: string }>(
      "SELECT m.id, m.origin FROM missions m JOIN listings l ON l.variant_id = m.variant_id WHERE l.id = ?", listing.id)!;
    assert.equal(plan.origin, "test_call");
    const policy = new PurchasePolicyRepository(f.db).current(plan.id)!;
    assert.equal(policy.actionCeiling, "add_to_cart");
    assert.equal(Date.parse(policy.expiresAt) - NOW, 15 * 60_000, "the test plan expires after 15 minutes");
    assert.deepEqual(policy.targets.filter((target) => target.enabled).map((target) => [target.listingId, target.maxUnitPriceCents]), [[listing.id, 1299]]);
    const result = new SignalEngine(f.db).process(input, NOW);
    assert.equal(result.actionJobState, "awaiting_executor", JSON.stringify(result));
    const lease = new ExecutionRepository(f.db).leaseNextJob(f.device(), NOW + 2_000);
    assert.equal(lease.job?.testCall, true);
    assert.equal(lease.job?.maxUnitPriceCents, 1299);

    assert.equal(tests.retireTestPlans(control, NOW + 20 * 60_000), 0, "still within ten minutes of its expiry");
    assert.equal(tests.retireTestPlans(control, NOW + 26 * 60_000), 1);
    assert.equal(f.db.get<{ status: string }>("SELECT status FROM missions WHERE id = ?", plan.id)?.status, "deleted");
  } finally { f.db.close(); }
});

test("a link test refuses another store's link, a bad link, a Want list item and a link sent again too soon", () => {
  const f = fixture("walmart");
  try {
    const tests = new TestCallRepository(f.db);
    const link = (url: string, retailerId = "walmart", at = NOW) => () => tests.inputForLink(
      { contractVersion: 1, url, msrpCents: 1299, retailerId, confirmation: TEST_CALL_CONFIRMATION }, f.control, at);
    assert.throws(link("https://www.target.com/p/-/A-95333333"), { code: "test_call_link_store", message: /That link is for Target\. Use Target's Test call\./ });
    assert.throws(link("https://www.walmart.com/search?q=needoh"), { code: "test_call_link_invalid" });
    assert.throws(link(STORES.walmart[1]), { code: "test_call_item_wanted", message: /already on your Want list/ }, "a real Want list item is never rewritten");
    const input = link("https://www.walmart.com/ip/7771234")();
    new SignalEngine(f.db).process(input, NOW);
    assert.throws(link("https://www.walmart.com/ip/7771234", "walmart", NOW + 60_000), { code: "test_call_too_soon" });
  } finally { f.db.close(); }
});
