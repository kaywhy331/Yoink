import assert from "node:assert/strict";
import test from "node:test";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.js";
import { PRODUCT_WANT_PREVIEW_CONFIRMATION, PRODUCT_WANT_SAVE_CONFIRMATION, type SignalEventInput, type ProductWantInput } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase, LOCAL_TENANT_ID, LOCAL_USER_ID } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ExecutionRepository } from "../packages/database/src/execution-repository.js";
import { OfficialMsrpRepository } from "../packages/database/src/official-msrp-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { runWithRequestScope, LOCAL_REQUEST_SCOPE } from "../packages/database/src/request-scope.js";
import { officialMsrpFixture } from "./helpers/official-msrp.js";
import { createYoinkServer } from "../apps/api/src/app.js";

const NOW = Date.parse("2026-10-01T16:00:00.000Z");
const STORES = {
  amazon: ["B0WANTIT01", "https://www.amazon.com/dp/B0WANTIT01"],
  target: ["95111111", "https://www.target.com/p/-/A-95111111"],
  walmart: ["6661111", "https://www.walmart.com/ip/6661111"],
  bestbuy: ["6667316", "https://www.bestbuy.com/site/example/6667316.p"]
} as const;

function fixture(retailer: keyof typeof STORES = "target", approved = true) {
  const db = new YoinkDatabase();
  const [retailerSku, canonicalUrl] = STORES[retailer];
  const lane = ADD_LANES[retailer];
  // All enablement and source state below belong solely to this in-memory fixture.
  db.run("UPDATE retailers SET execution_supported=1 WHERE id=?", retailer);
  db.run("UPDATE source_connections SET status='connected' WHERE id='source_trackalacker_local'");
  const listing = new CatalogRepository(db).upsertListing({ sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker", sourceProductId: `msrp-${retailer}`, sourceListingId: `msrp-listing-${retailer}`,
    title: "Ordinary fixture puzzle", retailerId: retailer, retailerSku, canonicalUrl,
    executionSupported: true, listingStatus: "in_stock", observedPriceCents: 2499, msrpCents: 9999,
    currency: "USD", observedAt: new Date(NOW).toISOString() }, NOW).listing;
  db.run("UPDATE listings SET execution_supported=1 WHERE id=?", listing.id);
  const approvedEvidence = approved ? officialMsrpFixture(db, listing.id, NOW, 2999) : null;
  const control = new ControlRepository(db);
  const input = { contractVersion: 1 as const, listingId: listing.id, mode: "add_to_cart" as const,
    maxUnitPriceCents: 2999, confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION } satisfies ProductWantInput;
  const save = () => {
    const preview = control.previewProductWant(input, NOW);
    return control.saveProductWant({ ...input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, NOW);
  };
  const signal: SignalEventInput = { sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
    externalEventId: `fixture-${retailer}`, eventType: "restock", observedAt: new Date(NOW).toISOString(),
    identity: { sourceProductId: `msrp-${retailer}`, sourceListingId: `msrp-listing-${retailer}`,
      retailerId: retailer, retailerSku, canonicalUrl: listing.canonicalUrl, title: listing.title },
    offer: { availability: "in_stock", unitPriceCents: 2499, currency: "USD", sellerName: lane.firstPartySeller,
      sellerType: "first_party", fulfillment: "shipping", orderLimit: 1 } };
  const queue = () => {
    db.run(`INSERT INTO retailer_adapter_qualifications(tenant_id,user_id,retailer_id,adapter_version,highest_action,status,
      evidence_hash,qualified_at,updated_at,expires_at) VALUES(?,?,?,?,'add_to_cart','qualified','fixture-only',?,?,?)`,
    LOCAL_TENANT_ID, LOCAL_USER_ID, retailer, lane.contractVersion, new Date(NOW).toISOString(), new Date(NOW).toISOString(), new Date(NOW + 60_000).toISOString());
    db.run("UPDATE app_settings SET execution_mode='live',actions_paused=0");
    return new SignalEngine(db).process(signal, NOW + 1_000);
  };
  const device = (supports = true) => {
    const devices = new DeviceRepository(db);
    return devices.pair({ pairingCode: devices.createPairingCode(NOW).code,
      capabilities: { jobReconciliation: true, officialMsrpCartV1: supports,
        [lane.capability.enabled]: true, [lane.capability.version]: lane.contractVersion } }, NOW).id;
  };
  return { db, listing, control, input, save, signal, queue, device, approvedEvidence };
}

for (const retailer of Object.keys(STORES) as Array<keyof typeof STORES>) {
  test(`${retailer}: reviewed fixture flows through plan, signal and lease with immutable MSRP/variant evidence`, () => {
    const f = fixture(retailer);
    try {
      const saved = f.save();
      const policy = f.control.currentPurchaseIntentPolicy(saved.purchaseIntentId, NOW);
      assert.equal(policy.targets.find(x => x.enabled)?.officialMsrpEvidenceId, f.approvedEvidence!.id);
      const queued = f.queue();
      assert.equal(queued.actionJobState, "awaiting_executor", JSON.stringify(queued));
      const lease = new ExecutionRepository(f.db).leaseNextJob(f.device(), NOW + 2_000);
      assert.equal(lease.reason, "leased", JSON.stringify(lease));
      // Kevin, 2026-10-11: "it should just be max". The call was $24.99; the plan's max is $29.99.
      assert.equal(lease.job?.maxUnitPriceCents, 2999, "the shopper's max is the limit, not the call's price");
      assert.equal(lease.job?.officialMsrp?.msrpCents, 2999);
      assert.equal(lease.job?.officialMsrp?.desiredVariant, "Standard single item");
      assert.equal(lease.job?.quantity, 1);
      assert.equal(lease.job?.action, "add_to_cart");
    } finally { f.db.close(); }
  });
}

for (const retailer of Object.keys(STORES) as Array<keyof typeof STORES>) {
  test(`${retailer}: an MSRP the shopper confirms in Want it flows through plan, signal and lease like reviewed evidence`, () => {
    const f = fixture(retailer, false);
    try {
      const input = { ...f.input, confirmedMsrpCents: 2999 };
      const preview = f.control.previewProductWant(input, NOW);
      assert.equal(preview.canSave, true);
      const saved = f.control.saveProductWant({ ...input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
        previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, NOW);
      const evidence = new OfficialMsrpRepository(f.db).current(f.listing.id, NOW)!;
      assert.equal(evidence.confirmedByOwner, true);
      const policy = f.control.currentPurchaseIntentPolicy(saved.purchaseIntentId, NOW);
      assert.equal(policy.targets.find(x => x.enabled)?.officialMsrpEvidenceId, evidence.id);
      const queued = f.queue();
      assert.equal(queued.actionJobState, "awaiting_executor", JSON.stringify(queued));
      const lease = new ExecutionRepository(f.db).leaseNextJob(f.device(), NOW + 2_000);
      assert.equal(lease.reason, "leased", JSON.stringify(lease));
      assert.equal(lease.job?.officialMsrp?.msrpCents, 2999);
      assert.equal(lease.job?.officialMsrp?.desiredVariant, "Ordinary fixture puzzle");
      assert.equal(lease.job?.action, "add_to_cart");
    } finally { f.db.close(); }
  });
}

test("a call above the MSRP the shopper confirmed is not added to the cart", () => {
  const f = fixture("target", false);
  try {
    const input = { ...f.input, confirmedMsrpCents: 2399, maxUnitPriceCents: 2399 };
    const preview = f.control.previewProductWant(input, NOW);
    f.control.saveProductWant({ ...input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, NOW);
    const queued = f.queue();
    assert.notEqual(queued.actionJobState, "awaiting_executor", "the $24.99 call is above the $23.99 MSRP");
    assert.equal(f.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM action_jobs WHERE action = 'add_to_cart'")?.n, 0);
  } finally { f.db.close(); }
});

for (const [price, added] of [[3499, true], [4099, false]] as const) {
  test(`any price up to my max: a $${(price / 100).toFixed(2)} call ${added ? "is" : "is not"} added with a $39.99 max and a $29.99 manufacturer MSRP`, () => {
    // Kevin, 2026-10-08: the MSRP is ignored under this rule; the max and the store-seller check still apply.
    const f = fixture("walmart", true);
    try {
      const input = { ...f.input, maxUnitPriceCents: 3999, priceRule: "max_price" as const };
      const preview = f.control.previewProductWant(input, NOW);
      f.control.saveProductWant({ ...input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
        previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, NOW);
      f.signal.offer = { ...f.signal.offer!, unitPriceCents: price };
      const queued = f.queue();
      if (added) {
        assert.equal(queued.actionJobState, "awaiting_executor", JSON.stringify(queued));
        const lease = new ExecutionRepository(f.db).leaseNextJob(f.device(), NOW + 2_000);
        assert.equal(lease.job?.maxUnitPriceCents, 3999, "the max is the limit, not the call's price (Kevin, 2026-10-11)");
        assert.equal(lease.job?.sellerPolicy, "first_party_only", "still only when the store itself sells it");
      } else {
        assert.notEqual(queued.actionJobState, "awaiting_executor");
        assert.equal(f.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM action_jobs WHERE action = 'add_to_cart'")?.n, 0);
      }
    } finally { f.db.close(); }
  });
}

test("a device cannot confirm an MSRP for the shopper", () => {
  const f = fixture("target", false);
  try {
    assert.throws(() => runWithRequestScope({ ...LOCAL_REQUEST_SCOPE, actorKind: "device", actorId: "device_fixture" },
      () => new OfficialMsrpRepository(f.db).confirmByOwner(f.listing.id, 2999, NOW)), /permission|authorized|forbidden/i);
    assert.equal(new OfficialMsrpRepository(f.db).current(f.listing.id, NOW), null);
  } finally { f.db.close(); }
});

test("unknown official MSRP blocks plan creation even with a numeric catalog MSRP", () => {
  const f = fixture("target", false);
  try {
    assert.equal(f.control.previewProductWant(f.input, NOW).canSave, false);
    assert.throws(f.save, { code: "product_want_incomplete" });
    assert.equal(f.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM missions")?.n, 0);
  } finally { f.db.close(); }
});

test("new evidence revision requires a new shopper review, including unchanged amounts", () => {
  const f = fixture();
  try {
    const preview = f.control.previewProductWant(f.input, NOW);
    f.save();
    officialMsrpFixture(f.db, f.listing.id, NOW + 1, 2999);
    assert.throws(() => f.control.saveProductWant({ ...f.input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, NOW + 2), { code: "product_want_preview_changed" });
    const queued = f.queue();
    assert.equal(queued.actionJobState, "notify_only", JSON.stringify(queued));
    assert.equal(queued.decision, "official_msrp_plan_review_required");
  } finally { f.db.close(); }
});

for (const change of ["revoked", "identity_changed", "price_missing", "stale", "old_device"] as const) {
  test(`fixture job stops for ${change}`, () => {
    const f = fixture();
    try {
      f.save();
      if (change === "price_missing") f.signal.offer!.unitPriceCents = null;
      if (change === "stale") f.signal.observedAt = new Date(NOW - 121_000).toISOString();
      const queued = f.queue();
      if (["price_missing", "stale"].includes(change)) {
        assert.notEqual(queued.actionJobState, "awaiting_executor");
        return;
      }
      if (change === "revoked") new OfficialMsrpRepository(f.db).revoke(f.listing.id, f.approvedEvidence!.id, NOW + 1_001);
      if (change === "identity_changed") f.db.run("UPDATE variants SET attributes_json=? WHERE id=?", '{"color":"different"}', f.listing.variantId);
      assert.equal(new ExecutionRepository(f.db).leaseNextJob(f.device(change !== "old_device"), NOW + 2_000).job, null);
    } finally { f.db.close(); }
  });
}

test("revocation and pause are checked again at the pre-click server boundary", () => {
  for (const stop of ["revoked", "paused", "shadow"]) {
    const f = fixture();
    try {
      f.save(); f.queue();
      const executor = new ExecutionRepository(f.db);
      const deviceId = f.device();
      const lease = executor.leaseNextJob(deviceId, NOW + 2_000);
      assert.ok(lease.job);
      executor.reconcileJob(deviceId, lease.job.id, lease.job.capabilityToken, "navigating", "fixture_navigation", "", {}, NOW + 2_100);
      executor.reconcileJob(deviceId, lease.job.id, lease.job.capabilityToken, "verifying_listing", "fixture_verify", "", {}, NOW + 2_200);
      if (stop === "revoked") new OfficialMsrpRepository(f.db).revoke(f.listing.id, f.approvedEvidence!.id, NOW + 2_300);
      else if (stop === "paused") f.db.run("UPDATE app_settings SET actions_paused=1");
      else f.db.run("UPDATE app_settings SET execution_mode='shadow'");
      assert.throws(() => executor.reconcileJob(deviceId, lease.job!.id, lease.job!.capabilityToken,
        "offer_verified", "fixture_offer", "", { retailerId: "target", retailerSku: STORES.target[0], unitPriceCents: 2499 }, NOW + 2_400),
      { code: stop === "paused" ? "actions_paused" : stop === "shadow" ? "shadow_mode" : "official_msrp_review_required" });
    } finally { f.db.close(); }
  }
});

test("device signals cannot approve their own MSRP evidence", () => {
  const f = fixture("target", false);
  try {
    assert.throws(() => runWithRequestScope({ ...LOCAL_REQUEST_SCOPE, actorKind: "device", actorId: "device_fixture" },
      () => officialMsrpFixture(f.db, f.listing.id, NOW)), /permission|authorized|forbidden/i);
    assert.equal(new OfficialMsrpRepository(f.db).current(f.listing.id, NOW), null);
  } finally { f.db.close(); }
});

test("persisted review rejects source labels, money products, stale evidence and unverified variants", () => {
  const f = fixture("target", false);
  try {
    for (const override of [
      { manufacturerVerified: false }, { exactVariantVerified: false }, { currency: "EUR" },
      { classification: "money_product" }, { moneyProduct: true }, { restricted: true }, { ageGated: true },
      { sourceUrl: "https://prices.trackalacker.com/example", manufacturerHost: "prices.trackalacker.com" },
      { sourceUrl: "https://www.target.com/example", manufacturerHost: "www.target.com" },
      { sourceCheckedAt: new Date(NOW - 25 * 60 * 60_000).toISOString() }, { desiredVariant: "" }
    ]) {
      assert.throws(() => officialMsrpFixture(f.db, f.listing.id, NOW, 2999, override as never));
      assert.equal(new OfficialMsrpRepository(f.db).current(f.listing.id, NOW), null);
    }
  } finally { f.db.close(); }
});

test("MSRP review expires and is isolated to its shopper scope", () => {
  const f = fixture();
  try {
    const review = new OfficialMsrpRepository(f.db);
    assert.equal(review.current(f.listing.id, NOW + 31 * 24 * 60 * 60_000), null);
    assert.equal(runWithRequestScope({ ...LOCAL_REQUEST_SCOPE, userId: "different_shopper", actorKind: "user" },
      () => review.current(f.listing.id, NOW)), null);
  } finally { f.db.close(); }
});

test("the server authorizes the add at any live price up to the plan's max, never over it or for another item", () => {
  // Kevin, 2026-10-11: "it should just be max". Called at $24.99 with a $29.99 max.
  const f = fixture();
  try {
    f.save(); f.queue();
    const executor = new ExecutionRepository(f.db);
    const deviceId = f.device();
    const { job } = executor.leaseNextJob(deviceId, NOW + 2_000);
    assert.ok(job);
    executor.reconcileJob(deviceId, job.id, job.capabilityToken, "navigating", "fixture_navigation", "", {}, NOW + 2_100);
    executor.reconcileJob(deviceId, job.id, job.capabilityToken, "verifying_listing", "fixture_verify", "", {}, NOW + 2_200);
    const offer = (evidence: Record<string, unknown>, at: number) => () => executor.reconcileJob(deviceId, job.id, job.capabilityToken,
      "offer_verified", "fixture_offer", "", { retailerId: "target", retailerSku: STORES.target[0], ...evidence }, at);
    assert.throws(offer({ unitPriceCents: 3000 }, NOW + 2_300), { code: "official_msrp_offer_changed" }, "a cent over the max");
    assert.throws(offer({ unitPriceCents: 2499, retailerSku: "95999999" }, NOW + 2_310), { code: "official_msrp_offer_changed" }, "another item");
    assert.doesNotThrow(offer({ unitPriceCents: 2999 }, NOW + 2_320), "up to the max, above the call's $24.99");
  } finally { f.db.close(); }
});

test("the server also takes a live price under the call's", () => {
  const f = fixture();
  try {
    f.save(); f.queue();
    const executor = new ExecutionRepository(f.db);
    const deviceId = f.device();
    const { job } = executor.leaseNextJob(deviceId, NOW + 2_000);
    assert.ok(job);
    executor.reconcileJob(deviceId, job.id, job.capabilityToken, "navigating", "fixture_navigation", "", {}, NOW + 2_100);
    executor.reconcileJob(deviceId, job.id, job.capabilityToken, "verifying_listing", "fixture_verify", "", {}, NOW + 2_200);
    assert.doesNotThrow(() => executor.reconcileJob(deviceId, job.id, job.capabilityToken, "offer_verified", "fixture_offer", "",
      { retailerId: "target", retailerSku: STORES.target[0], unitPriceCents: 2498 }, NOW + 2_300));
  } finally { f.db.close(); }
});

test("review API records and revokes scoped manufacturer evidence without enabling cart actions", async () => {
  const f = fixture("target", false);
  const server = createYoinkServer({ db: f.db, version: "fixture-only", webRoot: `${process.cwd()}/apps/web` });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/v1/admin/catalog/listings/${f.listing.id}/msrp-evidence`;
  const post = (body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ msrpCents: 2999 })).status, 400);
    const result = await post({ confirmation: "RECORD_OFFICIAL_MSRP_FOR_EXACT_VARIANT", sourceKind: "manufacturer_msrp",
      sourceUrl: "https://maker.example/ordinary-product", manufacturerHost: "maker.example", manufacturerVerified: true,
      exactVariantVerified: true, desiredVariant: "Standard single item", variantAttributes: {}, msrpCents: 2999,
      currency: "USD", sourceCheckedAt: new Date().toISOString(), sourceExcerpt: "Synthetic API fixture evidence only.",
      classification: "ordinary_goods", restricted: false, ageGated: false, moneyProduct: false });
    assert.equal(result.status, 201, await result.clone().text());
    const { evidence } = await result.json() as { evidence: { id: string } };
    assert.equal((await fetch(url)).status, 200);
    assert.equal(f.db.get<{ actions_paused: number }>("SELECT actions_paused FROM app_settings")?.actions_paused, 1);
    assert.equal(f.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM missions")?.n, 0);
    assert.equal((await post({ confirmation: "REVOKE_OFFICIAL_MSRP_EVIDENCE", evidenceId: evidence.id })).status, 200);
    assert.deepEqual(await (await fetch(url)).json(), { evidence: null });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    f.db.close();
  }
});
