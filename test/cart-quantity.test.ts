import assert from "node:assert/strict";
import test from "node:test";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.js";
import {
  PRODUCT_WANT_PREVIEW_CONFIRMATION,
  PRODUCT_WANT_SAVE_CONFIRMATION,
  TEST_CALL_CONFIRMATION,
  type ProductWantInput
} from "../packages/contracts/src/index.js";
import { describeCallRow } from "../packages/domain/src/call-result.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase, LOCAL_TENANT_ID, LOCAL_USER_ID } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ExecutionRepository } from "../packages/database/src/execution-repository.js";
import { OfficialMsrpRepository } from "../packages/database/src/official-msrp-repository.js";
import { PurchasePolicyRepository } from "../packages/database/src/purchase-policy-repository.js";
import { SignalRepository } from "../packages/database/src/signal-repository.js";
import { StockCheckRepository } from "../packages/database/src/stock-check-repository.js";
import { TestCallRepository } from "../packages/database/src/test-call-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";

// Kevin, 2026-10-10: "add a function for desired qty wanted per signal. If there
// is a limit on the item from the store level, it will know to put the max limit
// of the store if the user config is higher."
const NOW = Date.parse("2026-10-10T17:00:00.000Z");
const STORES = {
  amazon: ["B0QTYTEST1", "https://www.amazon.com/dp/B0QTYTEST1"],
  target: ["95233333", "https://www.target.com/p/-/A-95233333"],
  walmart: ["6663339", "https://www.walmart.com/ip/6663339"],
  bestbuy: ["6667339", "https://www.bestbuy.com/site/example/6667339.p"]
} as const;
type Store = keyof typeof STORES;

function fixture(retailer: Store, { quantity = 3, msrp = 2999 as number | null, max = 2999, price = 2499 } = {}) {
  const db = new YoinkDatabase();
  const [retailerSku, canonicalUrl] = STORES[retailer];
  const lane = ADD_LANES[retailer];
  db.run("UPDATE retailers SET execution_supported=1 WHERE id=?", retailer);
  db.run("UPDATE source_connections SET status='connected' WHERE id='source_trackalacker_local'");
  const listing = new CatalogRepository(db).upsertListing({ sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker", sourceProductId: `qty-${retailer}`, sourceListingId: `qty-listing-${retailer}`,
    title: "Ordinary quantity puzzle", retailerId: retailer, retailerSku, canonicalUrl,
    executionSupported: true, listingStatus: "in_stock", observedPriceCents: price, ...(msrp ? { msrpCents: msrp } : {}),
    currency: "USD", observedAt: new Date(NOW - 60_000).toISOString() }, NOW - 60_000).listing;
  db.run("UPDATE listings SET execution_supported=1 WHERE id=?", listing.id);
  db.run(`INSERT INTO retailer_adapter_qualifications(tenant_id,user_id,retailer_id,adapter_version,highest_action,status,
    evidence_hash,qualified_at,updated_at,expires_at) VALUES(?,?,?,?,'add_to_cart','qualified','fixture-only',?,?,?)`,
  LOCAL_TENANT_ID, LOCAL_USER_ID, retailer, lane.contractVersion, new Date(NOW).toISOString(), new Date(NOW).toISOString(),
  new Date(NOW + 60 * 60_000).toISOString());
  db.run("UPDATE app_settings SET execution_mode='live', actions_paused=0");
  const control = new ControlRepository(db);
  const want = (extra: Partial<ProductWantInput> = {}, at = NOW - 30_000) => {
    const input = { contractVersion: 1 as const, listingId: listing.id, mode: "add_to_cart" as const, maxUnitPriceCents: max,
      ...(msrp ? { confirmedMsrpCents: msrp } : {}), targetQuantity: quantity, confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION,
      ...extra } satisfies ProductWantInput;
    const preview = control.previewProductWant(input, at);
    assert.equal(preview.canSave, true, preview.summary);
    return control.saveProductWant({ ...input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, at).purchaseIntentId;
  };
  const device = (cartQuantity = true) => {
    const devices = new DeviceRepository(db);
    return devices.pair({ pairingCode: devices.createPairingCode(NOW).code,
      capabilities: { jobReconciliation: true, officialMsrpCartV1: true, ...(cartQuantity ? { cartQuantityV1: true } : {}),
        [lane.capability.enabled]: true, [lane.capability.version]: lane.contractVersion } }, NOW).id;
  };
  let calls = 0;
  const call = (at = NOW, unitPriceCents = price) => new SignalEngine(db).process({
    sourceConnectionId: "source_trackalacker_local", source: "trackalacker", externalEventId: `qty-call-${calls += 1}`,
    eventType: "restock", observedAt: new Date(at).toISOString(),
    identity: { sourceProductId: `qty-${retailer}`, sourceListingId: `qty-listing-${retailer}`, retailerId: retailer,
      retailerSku, canonicalUrl, title: "Ordinary quantity puzzle" },
    offer: { availability: "in_stock", unitPriceCents, currency: "USD" } }, at);
  return { db, listing, control, want, device, call, retailerSku };
}

/** Walks a leased job through Chrome's reports to a confirmed add of `added`. */
function confirm(db: YoinkDatabase, deviceId: string, job: { id: string; capabilityToken: string }, retailer: Store,
  retailerSku: string, price: number, evidence: Record<string, unknown>, at = NOW + 2_000) {
  const executor = new ExecutionRepository(db);
  const step = (state: string, reason: string, data: Record<string, unknown> = {}, offset = 0) =>
    executor.reconcileJob(deviceId, job.id, job.capabilityToken, state as never, reason, "", data, at + offset);
  step("navigating", "fixture_navigation", {}, 100);
  step("verifying_listing", "fixture_verify", {}, 200);
  step("offer_verified", "fixture_offer", { retailerId: retailer, retailerSku, unitPriceCents: price }, 300);
  step("add_authorized", "fixture_authorized", {}, 400);
  step("adding", "fixture_adding", {}, 500);
  step("cart_verified", "exact_cart_delta_verified", { retailerId: retailer, retailerSku, ...evidence }, 600);
  return step("confirmed", `${retailer}_add_confirmed`, { retailerId: retailer, retailerSku, ...evidence }, 700);
}

for (const retailer of Object.keys(STORES) as Store[]) {
  test(`${retailer}: a plan for 3 makes a cart job for 3, leased only to a companion that sets quantities`, () => {
    const f = fixture(retailer);
    try {
      const planId = f.want();
      const policy = new PurchasePolicyRepository(f.db).current(planId)!;
      assert.equal(policy.quantity, 3);
      const result = f.call();
      assert.equal(result.actionJobState, "awaiting_executor", JSON.stringify(result));
      const job = f.db.get<{ quantity: number; total: number }>(
        "SELECT quantity, max_order_total_cents AS total FROM action_jobs WHERE id = ?", result.actionJobId)!;
      assert.equal(job.quantity, 3);
      assert.equal(job.total, policy.maxAllInCents, "the plan's reviewed total covers all three");
      const executor = new ExecutionRepository(f.db);
      assert.equal(executor.leaseNextJob(f.device(false), NOW + 2_000).job, null, "an older companion never gets more than one");
      const lease = executor.leaseNextJob(f.device(true), NOW + 2_100);
      assert.equal(lease.reason, "leased", JSON.stringify(lease));
      assert.equal(lease.job?.quantity, 3);
      assert.equal(lease.job?.officialMsrp?.unitPriceCents, 2499);
    } finally { f.db.close(); }
  });
}

test("the store's limit: two added of three wanted is the whole order, and the call log says why", () => {
  const f = fixture("walmart");
  try {
    f.want();
    const result = f.call();
    const deviceId = f.device();
    const lease = new ExecutionRepository(f.db).leaseNextJob(deviceId, NOW + 2_000);
    assert.ok(lease.job, JSON.stringify(lease));
    const confirmed = confirm(f.db, deviceId, lease.job, "walmart", f.retailerSku, 2499,
      { quantity: 2, requestedQuantity: 3, storeLimit: 2 });
    assert.equal(confirmed.state, "confirmed");
    const row = new SignalRepository(f.db).listSignals(10, 0, "").find((entry) => entry.actionJobId === result.actionJobId)!;
    const described = describeCallRow(row as Record<string, unknown>);
    assert.equal(described.kind, "added");
    assert.match(described.detail, /^Chrome added 2 and confirmed your Walmart cart\. Walmart allows 2 per order, so that's the most it could add \(you wanted 3\)\./);
    // While those sit in the cart, another call doesn't add a third.
    const again = f.call(NOW + 60_000);
    assert.notEqual(again.actionJobState, "awaiting_executor", JSON.stringify(again));
  } finally { f.db.close(); }
});

// Kevin's NeeDoh (2026-10-12): a repeat call tops the cart up to the plan's
// quantity, and a cart that already holds it gets checkout, not another add.
test("a call that tops up the cart says how many were already there", () => {
  const f = fixture("walmart");
  try {
    f.want();
    const result = f.call();
    const deviceId = f.device();
    const lease = new ExecutionRepository(f.db).leaseNextJob(deviceId, NOW + 2_000);
    assert.ok(lease.job, JSON.stringify(lease));
    confirm(f.db, deviceId, lease.job, "walmart", f.retailerSku, 2499, { quantity: 2, requestedQuantity: 3, cartQuantityBefore: 1 });
    const row = new SignalRepository(f.db).listSignals(10, 0, "").find((entry) => entry.actionJobId === result.actionJobId)!;
    const described = describeCallRow(row as Record<string, unknown>);
    assert.equal(described.kind, "added");
    assert.equal(described.detail,
      "Chrome added 2 more to the 1 already in your Walmart cart, 3 in all, and confirmed it. Check out there before it sells out.");
  } finally { f.db.close(); }
});

for (const [name, evidence, detail] of [
  ["all the plan wanted", { cartQuantityBefore: 3, requestedQuantity: 3 },
    "Your Walmart cart already had the 3 you wanted, so Chrome didn't add more and opened checkout. Check out there before it sells out."],
  ["the store's limit", { cartQuantityBefore: 2, requestedQuantity: 3, storeLimit: 2 },
    "Your Walmart cart already had 2, Walmart's limit per order (you wanted 3), so Chrome didn't add more and opened checkout. Check out there before it sells out."]
] as const) {
  test(`a call for an item the cart already holds (${name}) says so and that checkout opened`, () => {
    const f = fixture("walmart");
    try {
      f.want();
      const result = f.call();
      const deviceId = f.device();
      const lease = new ExecutionRepository(f.db).leaseNextJob(deviceId, NOW + 2_000);
      assert.ok(lease.job, JSON.stringify(lease));
      const executor = new ExecutionRepository(f.db);
      executor.reconcileJob(deviceId, lease.job.id, lease.job.capabilityToken, "navigating", "cart_baseline_started", "", {}, NOW + 2_100);
      const stopped = executor.reconcileJob(deviceId, lease.job.id, lease.job.capabilityToken, "cancelled", "already_in_cart", "",
        { retailerId: "walmart", retailerSku: f.retailerSku, ...evidence }, NOW + 2_200);
      assert.equal(stopped.state, "cancelled");
      const row = new SignalRepository(f.db).listSignals(10, 0, "").find((entry) => entry.actionJobId === result.actionJobId)!;
      const described = describeCallRow(row as Record<string, unknown>);
      assert.deepEqual([described.kind, described.label, described.reason, described.fix],
        ["added", "Already in cart", "Already in your Walmart cart", "open_cart"]);
      assert.equal(described.detail, detail);
    } finally { f.db.close(); }
  });
}

test("a plan asks only for what it still misses", () => {
  const f = fixture("amazon");
  try {
    const planId = f.want();
    f.db.run("UPDATE missions SET fulfilled_quantity = 2 WHERE id = ?", planId);
    const result = f.call();
    assert.equal(result.actionJobState, "awaiting_executor", JSON.stringify(result));
    assert.equal(f.db.get<{ quantity: number }>("SELECT quantity FROM action_jobs WHERE id = ?", result.actionJobId)?.quantity, 1);
  } finally { f.db.close(); }
});

test("other stores keep adding one at a time", () => {
  const db = new YoinkDatabase();
  try {
    assert.equal(ADD_LANES.pokemoncenter.operations.raiseCart, undefined);
    for (const store of ["target", "walmart", "bestbuy"] as const) assert.ok(ADD_LANES[store].operations.raiseCart);
  } finally { db.close(); }
});

test("a cart item saved before MSRPs is re-armed on any price up to its max, once, and its calls reach the cart", () => {
  const f = fixture("amazon", { quantity: 1, msrp: 2999 });
  try {
    const planId = f.want();
    // Kevin's four Amazon items were set to Add to cart before the MSRP rule: no MSRP evidence is bound.
    f.db.run("UPDATE official_msrp_evidence SET status = 'revoked'");
    const blocked = f.call();
    assert.equal(blocked.actionJobState, "notify_only", JSON.stringify(blocked));
    const row = new SignalRepository(f.db).listSignals(10, 0, "").find((entry) => entry.actionJobId === blocked.actionJobId)!;
    assert.equal(describeCallRow(row as Record<string, unknown>).reason, "No price limit saved",
      "the call log names the missing price limit, not \"set to alerts\"");
    const armed = f.control.armUnconfirmedCartPlans(NOW + 1_000);
    assert.deepEqual(armed.map((plan) => plan.planId), [planId]);
    const evidence = new OfficialMsrpRepository(f.db).current(f.listing.id, NOW + 2_000)!;
    assert.equal(evidence.maxPriceOnly, true);
    assert.equal(evidence.msrpCents, 2999);
    assert.deepEqual(f.control.armUnconfirmedCartPlans(NOW + 3_000), [], "an armed item is left alone");
    const result = f.call(NOW + 4_000, 2899);
    assert.equal(result.actionJobState, "awaiting_executor", JSON.stringify(result));
  } finally { f.db.close(); }
});

test("an item with a confirmed MSRP keeps it: re-arming never replaces a price rule the shopper chose", () => {
  const f = fixture("target", { quantity: 1, msrp: 2999 });
  try {
    f.want();
    const before = new OfficialMsrpRepository(f.db).current(f.listing.id, NOW)!;
    assert.deepEqual(f.control.armUnconfirmedCartPlans(NOW + 1_000), []);
    assert.equal(new OfficialMsrpRepository(f.db).current(f.listing.id, NOW + 2_000)?.id, before.id);
  } finally { f.db.close(); }
});

// Kevin's Walmart Test call, 2026-10-13: Chrome's stock check named the newly
// linked item from its page while the add ran, which changed the identity its
// saved max is bound to, and the server turned the Add step away
// (official_msrp_review_required). The page's name goes on the saved entry.
// Every store's linked item for 2 must reach a confirmed add through that read.
const LINKED: Record<Store, [url: string, sku: string, pageTitle: string, name: string]> = {
  amazon: ["https://www.amazon.com/dp/B0LINKED02", "B0LINKED02",
    "Amazon.com: Bicycle Playing Cards, 2 Pack : Toys & Games", "Bicycle Playing Cards, 2 Pack"],
  target: ["https://www.target.com/p/-/A-95299999", "95299999", "Bicycle Playing Cards, 2 Pack : Target", "Bicycle Playing Cards, 2 Pack"],
  walmart: ["https://www.walmart.com/ip/24920763", "24920763",
    "Bicycle Playing Cards, 2 Pack, Standard Index (Red & Blue) - Walmart.com", "Bicycle Playing Cards, 2 Pack, Standard Index (Red & Blue)"],
  bestbuy: ["https://www.bestbuy.com/site/-/6680138.p", "6680138",
    "Disney - Lorcana: Attack of the Vine! Sleeved Booster - Best Buy", "Disney - Lorcana: Attack of the Vine! Sleeved Booster"]
};
for (const retailer of Object.keys(STORES) as Store[]) {
  test(`${retailer}: a newly linked test item for 2 reaches a confirmed add when Chrome reads its page's name mid-add`, () => {
    const f = fixture(retailer, { quantity: 1 });
    try {
      const [url, sku, pageTitle, name] = LINKED[retailer];
      const tests = new TestCallRepository(f.db);
      const input = tests.inputForLink({ contractVersion: 1, url, msrpCents: 700, retailerId: retailer, quantity: 2,
        confirmation: TEST_CALL_CONFIRMATION }, f.control, NOW);
      const result = new SignalEngine(f.db).process(input, NOW);
      assert.equal(result.actionJobState, "awaiting_executor", JSON.stringify(result));
      const deviceId = f.device();
      const executor = new ExecutionRepository(f.db);
      const lease = executor.leaseNextJob(deviceId, NOW + 1_000);
      assert.ok(lease.job, JSON.stringify(lease));
      assert.equal(lease.job.quantity, 2);
      const job = lease.job;
      const step = (state: string, reason: string, data: Record<string, unknown>, at: number) =>
        executor.reconcileJob(deviceId, job.id, job.capabilityToken, state as never, reason, "", data, at);
      step("navigating", "fixture_navigation", {}, NOW + 1_100);
      step("verifying_listing", "fixture_verify", {}, NOW + 1_200);
      const seen = new StockCheckRepository(f.db).record([{ retailerId: retailer, retailerSku: sku, availability: "in_stock",
        unitPriceCents: 564, sellerName: ADD_LANES[retailer].name, sellerType: "first_party",
        observedAt: new Date(NOW + 1_250).toISOString(), via: "cart_add", title: pageTitle }], NOW + 1_250);
      assert.equal(seen[0]?.outcome, "recorded", JSON.stringify(seen));
      step("offer_verified", "fixture_offer", { retailerId: retailer, retailerSku: sku, unitPriceCents: 564 }, NOW + 1_300);
      assert.equal(step("add_authorized", "fixture_authorized", {}, NOW + 1_400).state, "add_authorized");
      step("adding", "fixture_adding", {}, NOW + 1_500);
      const evidence = { retailerId: retailer, retailerSku: sku, quantity: 2, requestedQuantity: 2 };
      step("cart_verified", "exact_cart_delta_verified", evidence, NOW + 1_600);
      assert.equal(step("confirmed", `${retailer}_add_confirmed`, evidence, NOW + 1_700).state, "confirmed");
      assert.equal(tests.savedItems(retailer)[0]?.title, name);
      const row = new SignalRepository(f.db).listSignals(10, 0, "").find((entry) => entry.actionJobId === result.actionJobId)!;
      assert.equal(describeCallRow(row as Record<string, unknown>).kind, "added");
    } finally { f.db.close(); }
  });
}

test("a linked test call can ask for a quantity, and only 1 to 10", () => {
  const f = fixture("bestbuy", { quantity: 1 });
  try {
    const tests = new TestCallRepository(f.db);
    assert.throws(() => tests.inputForLink({ contractVersion: 1, url: "https://www.bestbuy.com/site/other/6667340.p",
      msrpCents: 1999, retailerId: "bestbuy", quantity: 11, confirmation: TEST_CALL_CONFIRMATION }, f.control, NOW),
    { code: "test_call_quantity_invalid" });
    const input = tests.inputForLink({ contractVersion: 1, url: "https://www.bestbuy.com/site/other/6667340.p",
      msrpCents: 1999, retailerId: "bestbuy", quantity: 2, confirmation: TEST_CALL_CONFIRMATION }, f.control, NOW);
    const result = new SignalEngine(f.db).process(input, NOW);
    assert.equal(result.actionJobState, "awaiting_executor", JSON.stringify(result));
    assert.equal(f.db.get<{ quantity: number }>("SELECT quantity FROM action_jobs WHERE id = ?", result.actionJobId)?.quantity, 2);
  } finally { f.db.close(); }
});
