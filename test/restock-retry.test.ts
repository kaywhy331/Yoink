import assert from "node:assert/strict";
import test from "node:test";
import { verifyLiveOffer, type BrowserActionContract, type LiveOfferObservation } from "../packages/browser-safety/src/index.js";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.js";
import { PRODUCT_WANT_PREVIEW_CONFIRMATION, PRODUCT_WANT_SAVE_CONFIRMATION, type ProductWantInput, type SignalEventInput } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ExecutionRepository } from "../packages/database/src/execution-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { officialMsrpFixture } from "./helpers/official-msrp.js";
import { reviewedBrowserJobFixture } from "./helpers/official-msrp-browser.js";

// Kevin, 2026-10-09: "add a config to auto retry the sku X amount of times
// over Y amount of timeframe. Some items go out, but come back in due to
// shopping cart abandonment." He chose: a retry relies on the original call
// plus the live page check, one switch in Setup › Stores.
const NOW = Date.parse("2026-10-09T16:00:00.000Z");
const MINUTE = 60_000;

function fixture() {
  const db = new YoinkDatabase();
  const lane = ADD_LANES.target;
  db.run("UPDATE retailers SET execution_supported=1 WHERE id='target'");
  db.run("UPDATE source_connections SET status='connected' WHERE id='source_trackalacker_local'");
  const listing = new CatalogRepository(db).upsertListing({ sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker", sourceProductId: "restock-target", sourceListingId: "restock-listing-target",
    title: "Restock fixture puzzle", retailerId: "target", retailerSku: "95222222", canonicalUrl: "https://www.target.com/p/-/A-95222222",
    executionSupported: true, listingStatus: "in_stock", observedPriceCents: 2499, msrpCents: 9999,
    currency: "USD", observedAt: new Date(NOW).toISOString() }, NOW).listing;
  db.run("UPDATE listings SET execution_supported=1 WHERE id=?", listing.id);
  officialMsrpFixture(db, listing.id, NOW, 2999);
  const control = new ControlRepository(db);
  const input = { contractVersion: 1 as const, listingId: listing.id, mode: "add_to_cart" as const,
    maxUnitPriceCents: 2999, confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION } satisfies ProductWantInput;
  const preview = control.previewProductWant(input, NOW);
  control.saveProductWant({ ...input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
    previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, NOW);
  db.run(`INSERT INTO retailer_adapter_qualifications(tenant_id,user_id,retailer_id,adapter_version,highest_action,status,
    evidence_hash,qualified_at,updated_at,expires_at) VALUES(?,?,?,?,'add_to_cart','qualified','fixture-only',?,?,?)`,
  LOCAL_TENANT_ID, LOCAL_USER_ID, "target", lane.contractVersion, new Date(NOW).toISOString(), new Date(NOW).toISOString(),
  new Date(NOW + 24 * 60 * MINUTE).toISOString());
  db.run("UPDATE app_settings SET execution_mode='live',actions_paused=0");
  const signal: SignalEventInput = { sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
    externalEventId: "restock-fixture", eventType: "restock", observedAt: new Date(NOW).toISOString(),
    identity: { sourceProductId: "restock-target", sourceListingId: "restock-listing-target", retailerId: "target",
      retailerSku: "95222222", canonicalUrl: listing.canonicalUrl, title: listing.title },
    offer: { availability: "in_stock", unitPriceCents: 2499, currency: "USD", sellerName: lane.firstPartySeller,
      sellerType: "first_party", fulfillment: "shipping", orderLimit: 1 } };
  const queued = new SignalEngine(db).process(signal, NOW + 1_000);
  assert.equal(queued.actionJobState, "awaiting_executor", JSON.stringify(queued));
  const devices = new DeviceRepository(db);
  const deviceId = devices.pair({ pairingCode: devices.createPairingCode(NOW).code,
    capabilities: { jobReconciliation: true, officialMsrpCartV1: true,
      [lane.capability.enabled]: true, [lane.capability.version]: lane.contractVersion } }, NOW).id;
  const executor = new ExecutionRepository(db);
  /** Lease at `at`, open the page, and report what the live page showed. */
  const attempt = (at: number, reason = "out_of_stock") => {
    const lease = executor.leaseNextJob(deviceId, at);
    assert.equal(lease.reason, "leased", JSON.stringify(lease));
    const job = lease.job!;
    executor.reconcileJob(deviceId, job.id, job.capabilityToken, "navigating", "fixture_navigation", "", {}, at + 100);
    executor.reconcileJob(deviceId, job.id, job.capabilityToken, "verifying_listing", "fixture_verify", "", {}, at + 200);
    const reported = executor.reconcileJob(deviceId, job.id, job.capabilityToken, "offer_rejected", reason, "", {}, at + 300);
    return { job, reported };
  };
  const row = (jobId: string) => db.get<{ state: string; retries: number; retryAt: string; until: string; reservation: string; incident: string }>(
    `SELECT aj.state, aj.restock_retries AS retries, aj.restock_retry_at AS retryAt, aj.restock_retry_until AS until,
       sr.status AS reservation, i.status AS incident
     FROM action_jobs aj JOIN spend_reservations sr ON sr.action_job_id = aj.id JOIN signal_incidents i ON i.id = aj.incident_id
     WHERE aj.id = ?`, jobId)!;
  return { db, control, executor, deviceId, attempt, row };
}

test("the setting is off by default, saved within its ranges, and read back", () => {
  const { db, control } = fixture();
  try {
    assert.deepEqual(control.settings().restockRetry, { enabled: false, attempts: 3, windowMinutes: 10 });
    for (const bad of [{ enabled: "yes", attempts: 3, windowMinutes: 10 }, { enabled: true, attempts: 0, windowMinutes: 10 },
      { enabled: true, attempts: 11, windowMinutes: 10 }, { enabled: true, attempts: 3, windowMinutes: 61 }, { enabled: true, attempts: 2.5, windowMinutes: 10 }]) {
      assert.throws(() => control.updateRestockRetry(bad), /Choose whether|Tries must|window must/);
    }
    assert.deepEqual(control.updateRestockRetry({ enabled: true, attempts: 5, windowMinutes: 20 }, NOW).restockRetry,
      { enabled: true, attempts: 5, windowMinutes: 20 });
    db.run("UPDATE app_settings SET restock_retry_json = 'not json'");
    assert.deepEqual(control.settings().restockRetry, { enabled: false, attempts: 3, windowMinutes: 10 }, "damage reads as off");
  } finally { db.close(); }
});

test("a sold-out cart add waits for its next try, then the same call authorizes it after 2 minutes", () => {
  const { db, control, executor, deviceId, attempt, row } = fixture();
  try {
    control.updateRestockRetry({ enabled: true, attempts: 2, windowMinutes: 4 }, NOW);
    const first = attempt(NOW + 2_000);
    assert.equal(first.reported.state, "awaiting_executor", "back in the queue, not ended");
    assert.equal(first.reported.restockRetry, 1);
    // Tries start within the 4-minute window; the last may run 2 more minutes.
    const until = NOW + 2_300 + 4 * MINUTE + 2 * MINUTE;
    assert.equal(first.reported.restockRetryUntil, new Date(until).toISOString());
    assert.equal(first.reported.restockRetryAt, new Date(NOW + 2_300 + 2 * MINUTE).toISOString(), "tries spread evenly over the window");
    const waiting = row(first.job.id);
    assert.deepEqual([waiting.state, waiting.retries, waiting.reservation, waiting.incident], ["awaiting_executor", 1, "active", "open"]);
    // Not before its time: the device is free for other items meanwhile.
    assert.equal(executor.leaseNextJob(deviceId, NOW + 60_000).reason, "no_jobs");
    // Two minutes after the call the next try leases the same job, from the same call.
    const retryAt = Date.parse(String(first.reported.restockRetryAt));
    const lease = executor.leaseNextJob(deviceId, retryAt + 1_000);
    assert.equal(lease.reason, "leased", JSON.stringify(lease));
    assert.equal(lease.job!.id, first.job.id);
    assert.deepEqual(lease.job!.restockRetry, { attempt: 1, until: new Date(until).toISOString() });
    assert.ok(retryAt + 1_000 - NOW > 120_000, "the call is past the 2-minute rule");
    const job = lease.job!;
    executor.reconcileJob(deviceId, job.id, job.capabilityToken, "navigating", "fixture_navigation", "", {}, retryAt + 1_100);
    executor.reconcileJob(deviceId, job.id, job.capabilityToken, "verifying_listing", "fixture_verify", "", {}, retryAt + 1_200);
    // The exact offer still has to match the call's price and item.
    const verified = executor.reconcileJob(deviceId, job.id, job.capabilityToken, "offer_verified", "live_offer_verified", "",
      { unitPriceCents: 2499, retailerSku: "95222222", retailerId: "target" }, retailerAt(retryAt));
    assert.equal(verified.state, "offer_verified");
  } finally { db.close(); }
  function retailerAt(at: number) { return at + 1_300; }
});

test("tries stop after the last one: the job ends, its reservation is released and the call closes", () => {
  const { db, control, attempt, row } = fixture();
  try {
    control.updateRestockRetry({ enabled: true, attempts: 1, windowMinutes: 2 }, NOW);
    const first = attempt(NOW + 2_000);
    assert.equal(first.reported.state, "awaiting_executor");
    const second = attempt(Date.parse(String(first.reported.restockRetryAt)) + 1_000);
    assert.equal(second.job.id, first.job.id);
    assert.equal(second.reported.state, "offer_rejected", "no tries left");
    const ended = row(first.job.id);
    assert.deepEqual([ended.state, ended.retries, ended.reservation], ["offer_rejected", 1, "released"]);
    assert.notEqual(ended.incident, "open");
  } finally { db.close(); }
});

test("a marketplace seller in place of the store is retried too: the store's own stock may be out", () => {
  // Kevin, 2026-10-09: "Out of stock sometimes goes hidden from first party sellers, causing 3rd party sellers to be the purchasing item."
  for (const reason of ["third_party_seller", "seller_unverified", "signal_seller_mismatch", "add_control_unavailable", "price_unavailable", "stock_unverified"]) {
    const { db, control, attempt } = fixture();
    try {
      control.updateRestockRetry({ enabled: true, attempts: 3, windowMinutes: 10 }, NOW);
      assert.equal(attempt(NOW + 2_000, reason).reported.state, "awaiting_executor", `${reason} is retried`);
    } finally { db.close(); }
  }
});

test("only a not-available result is retried, only with the switch on, and never after the window", () => {
  {
    const { db, attempt } = fixture();
    try { assert.equal(attempt(NOW + 2_000).reported.state, "offer_rejected", "switch off"); } finally { db.close(); }
  }
  for (const reason of ["over_unit_cap", "listed_price_changed", "desired_variant_changed", "manual_action_required"]) {
    const { db, control, attempt } = fixture();
    try {
      control.updateRestockRetry({ enabled: true, attempts: 3, windowMinutes: 10 }, NOW);
      assert.equal(attempt(NOW + 2_000, reason).reported.state, "offer_rejected", `${reason} is not retried`);
    } finally { db.close(); }
  }
  {
    const { db, control, executor, deviceId, attempt, row } = fixture();
    try {
      control.updateRestockRetry({ enabled: true, attempts: 2, windowMinutes: 4 }, NOW);
      const first = attempt(NOW + 2_000);
      // The device never came back before the window closed: the job expires instead.
      const late = Date.parse(String(first.reported.restockRetryUntil)) + 1_000;
      assert.equal(executor.leaseNextJob(deviceId, late).reason, "no_jobs");
      assert.deepEqual([row(first.job.id).state, row(first.job.id).reservation], ["expired", "released"]);
    } finally { db.close(); }
  }
});

test("Chrome accepts a retry's call only inside its window; a first try still needs a 2-minute-old call", () => {
  const base: BrowserActionContract = {
    contractVersion: 1, jobId: "job_restock_fixture", retailerId: "target", retailerSku: "95222222",
    canonicalUrl: "https://www.target.com/p/-/A-95222222", action: "add_to_cart", quantity: 1,
    maxUnitPriceCents: 2499, maxOrderTotalCents: 2499, currency: "USD", sellerPolicy: "first_party_only",
    expectedSeller: "Target", fulfillment: "shipping", expiresAt: new Date(NOW + 20 * MINUTE).toISOString()
  };
  const job = reviewedBrowserJobFixture(base, NOW);
  const soldOut: LiveOfferObservation = {
    contractVersion: 1, observedAt: new Date(NOW + 10 * MINUTE).toISOString(), url: base.canonicalUrl, pageKind: "product",
    retailerId: "target", retailerSku: "95222222", availability: "out_of_stock", unitPriceCents: 2499, currency: "USD",
    sellerName: "Target", sellerType: "first_party", fulfillment: "shipping", addControlActionable: false,
    securityChallenge: false, interactiveBlock: ""
  };
  const at = NOW + 10 * MINUTE;
  // A sold-out page is reported as such only once the job itself is valid.
  assert.equal(verifyLiveOffer(job, soldOut, at).ok, false);
  assert.equal((verifyLiveOffer(job, soldOut, at) as { reason: string }).reason, "official_msrp_authorization_invalid", "a 10-minute-old call alone");
  const retry = { ...job, restockRetryUntil: new Date(NOW + 15 * MINUTE).toISOString() };
  assert.equal((verifyLiveOffer(retry, soldOut, at) as { reason: string }).reason, "out_of_stock", "inside the retry window");
  const closed = { ...job, restockRetryUntil: new Date(NOW + 9 * MINUTE).toISOString() };
  assert.equal((verifyLiveOffer(closed, soldOut, at) as { reason: string }).reason, "official_msrp_authorization_invalid", "after the window");
  const tooLong = { ...job, expiresAt: new Date(NOW + 100 * MINUTE).toISOString(), restockRetryUntil: new Date(NOW + 90 * MINUTE).toISOString() };
  assert.equal((verifyLiveOffer(tooLong, soldOut, at) as { reason: string }).reason, "official_msrp_authorization_invalid", "never over 70 minutes from the call");
});
