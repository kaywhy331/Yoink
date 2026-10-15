import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { PurchasePolicyRepository } from "../packages/database/src/purchase-policy-repository.js";
import { runWithRequestScope } from "../packages/database/src/request-scope.js";
import { PRODUCT_WANT_PREVIEW_CONFIRMATION, PRODUCT_WANT_SAVE_CONFIRMATION,
  SUGGESTED_WANT_CONFIRMATION, SUGGESTED_PRICES_CONFIRMATION, TEST_CALL_PLAN_ORIGIN,
  type SuggestedWantInput, type ProductWantInput, type MissionUpdateInput } from "../packages/contracts/src/index.js";

const NOW = Date.parse("2026-10-15T16:00:00Z");
const DAY = 86_400_000;

function fixture() {
  const db = new YoinkDatabase();
  const control = new ControlRepository(db);
  const catalog = new CatalogRepository(db);
  function add(name: string, cents = 4999, retailerId = "target", sku = "95123456") {
    const canonicalUrl = retailerId === "target" ? `https://www.target.com/p/-/A-${sku}` : `https://www.walmart.com/ip/${sku}`;
    const listing = catalog.upsertListing({ source: "trackalacker", sourceConnectionId: "source_trackalacker_local",
      sourceProductId: name, sourceListingId: `${name}-${retailerId}`, title: `Fixture ${name}`, retailerId, retailerSku: sku,
      canonicalUrl, observedPriceCents: cents, msrpCents: 19999, currency: "USD", sellerType: "first_party",
      listingStatus: "in_stock", executionSupported: true, observedAt: new Date(NOW - DAY).toISOString() }, NOW - DAY).listing;
    db.run("UPDATE listings SET execution_supported=1 WHERE id=?", listing.id);
    return listing.id;
  }
  function want(listingId: string, mode: "add_to_cart" | "notify" = "add_to_cart", max = 7999, quantity = 1) {
    const input: ProductWantInput = { contractVersion: 1, listingId, mode, maxUnitPriceCents: max, targetQuantity: quantity,
      priceRule: "max_price" as const, confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION };
    const preview = control.previewProductWant(input, NOW);
    return control.saveProductWant({ ...input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, NOW).purchaseIntentId;
  }
  return { db, control, add, want };
}

test("one-tap Want uses the first-party trend as a max, creates no order and preserves an existing want", () => {
  const f = fixture();
  try {
    const id = f.add("cards");
    f.db.run(`INSERT INTO offer_observations(id,listing_id,availability,unit_price_cents,currency,seller_type,observed_at,created_at)
      VALUES ('reseller',?,'in_stock',19999,'USD','third_party',?,?)`, id, new Date(NOW).toISOString(), new Date(NOW).toISOString());
    const request = { contractVersion: 1, listingId: id, confirmation: SUGGESTED_WANT_CONFIRMATION, maxUnitPriceCents: 999999 } as SuggestedWantInput;
    const result = f.control.saveSuggestedProductWant(request, NOW);
    assert.equal(result.preview.maxUnitPriceCents, 4999);
    assert.equal(result.preview.targetQuantity, 1);
    assert.equal(result.preview.mode, "add_to_cart");
    assert.equal(result.preview.priceRule, "max_price");
    assert.equal(result.preview.msrpConfirmation.needed, false);
    assert.equal(result.preview.stores[0]?.priceCents, 4999, "latest reseller price is not the store price");
    assert.equal(result.preview.stores[0]?.officialMsrp?.maxPriceOnly, true, "a trend is never recorded as manufacturer MSRP");
    assert.equal(f.db.get<{ n: number }>("SELECT COUNT(*) n FROM action_jobs")?.n, 0);
    assert.throws(() => f.control.saveSuggestedProductWant(request, NOW + 1), { code: "product_already_wanted" });
    assert.equal(f.db.get<{ n: number }>("SELECT COUNT(*) n FROM missions")?.n, 1);
  } finally { f.db.close(); }
});

test("unknown, marketplace, foreign-currency, future and stale prices cannot become a suggested max", () => {
  for (const mutation of ["seller_type='unknown'", "seller_type='third_party'", "currency='CAD'",
    `observed_at='${new Date(NOW + DAY).toISOString()}'`, `observed_at='${new Date(NOW - 91 * DAY).toISOString()}'`]) {
    const f = fixture();
    try {
      const id = f.add("unverified");
      f.db.run(`UPDATE offer_observations SET ${mutation}`);
      assert.equal(f.control.productPriceHistory(id, NOW).summary, null);
      assert.throws(() => f.control.saveSuggestedProductWant({ contractVersion: 1, listingId: id,
        confirmation: SUGGESTED_WANT_CONFIRMATION }, NOW), { code: "suggested_price_unavailable" });
      const manual = f.control.previewProductWant({ contractVersion: 1, listingId: id, mode: "notify",
        priceRule: "max_price", confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION }, NOW);
      assert.equal(manual.maxUnitPriceCents, null, "the manual fallback must not prefill an unverified MSRP, even for alerts");
      assert.equal(manual.canSave, false);
      assert.equal(f.db.get<{ n: number }>("SELECT COUNT(*) n FROM missions")?.n, 0);
    } finally { f.db.close(); }
  }
});

test("bulk suggested prices updates chosen wants and preserves quantity, mode, pause and ownership", () => {
  const f = fixture();
  try {
    const cart = f.want(f.add("cart"), "add_to_cart", 7999, 2);
    const alert = f.want(f.add("alert", 1799, "walmart", "1234567"), "notify", 2999);
    const omitted = f.want(f.add("omitted", 2499, "target", "95123457"));
    f.db.run("UPDATE missions SET status='paused' WHERE id=?", cart);
    const items = f.control.suggestedPricesPreview(NOW).items;
    assert.equal(items.length, 3);
    const result = f.control.applySuggestedPrices({ contractVersion: 1, confirmation: SUGGESTED_PRICES_CONFIRMATION,
      items: items.filter((item) => item.planId !== omitted) }, NOW + 1);
    assert.equal(result.updated.length, 2);
    assert.deepEqual(result.skipped, []);
    assert.equal(f.db.get<{ status: string; quantity: number }>("SELECT status,target_quantity quantity FROM missions WHERE id=?", cart)?.status, "paused");
    assert.equal(f.db.get<{ quantity: number }>("SELECT target_quantity quantity FROM missions WHERE id=?", cart)?.quantity, 2);
    assert.equal(f.db.get<{ cents: number }>("SELECT max_unit_price_cents cents FROM mission_targets WHERE mission_id=? AND enabled=1", cart)?.cents, 4999);
    assert.equal(f.db.get<{ mode: string }>("SELECT action_ceiling mode FROM mission_intent_revisions WHERE mission_id=? ORDER BY revision DESC LIMIT 1", alert)?.mode, "notify");
    assert.equal(f.db.get<{ cents: number }>("SELECT max_unit_price_cents cents FROM mission_targets WHERE mission_id=? AND enabled=1", omitted)?.cents, 7999);
    const foreign = runWithRequestScope({ tenantId: "another_tenant", userId: "another_user", actorKind: "user", actorId: "another_user" }, () => {
      assert.deepEqual(f.control.suggestedPricesPreview(NOW).items, []);
      return f.control.applySuggestedPrices({ contractVersion: 1, confirmation: SUGGESTED_PRICES_CONFIRMATION, items: [items[0]!] }, NOW + 2);
    });
    assert.equal(foreign.updated.length, 0);
    assert.equal(foreign.skipped[0]?.title, "");
  } finally { f.db.close(); }
});

test("bulk apply rejects changed or expired previews and skips missing first-party prices", () => {
  const f = fixture();
  try {
    const listing = f.add("changed");
    f.want(listing);
    const unknown = f.add("unknown", 2999, "target", "95123457");
    f.want(unknown);
    f.db.run("UPDATE offer_observations SET seller_type='unknown' WHERE listing_id=?", unknown);
    const items = f.control.suggestedPricesPreview(NOW).items;
    assert.equal(items.find((item) => item.title === "Fixture unknown")?.canApply, false);
    f.db.run("UPDATE offer_observations SET unit_price_cents=5999 WHERE listing_id=?", listing);
    const result = f.control.applySuggestedPrices({ contractVersion: 1, confirmation: SUGGESTED_PRICES_CONFIRMATION, items }, NOW + 1);
    assert.equal(result.updated.length, 0);
    assert.equal(result.skipped.length, 2);
    assert.match(result.skipped.find((item) => item.title === "Fixture changed")!.reason, /changed/);
    const expired = f.control.applySuggestedPrices({ contractVersion: 1, confirmation: SUGGESTED_PRICES_CONFIRMATION, items }, NOW + 301_000);
    assert.ok(expired.skipped.every((item) => item.reason.includes("expired")));
  } finally { f.db.close(); }
});

test("bulk pricing keeps selected stores, fulfillment and expiry and excludes temporary test plans", () => {
  const f = fixture();
  try {
    const listing = f.add("choices");
    f.add("choices", 5199, "walmart", "1234568");
    const planId = f.want(listing, "notify", 7999, 3);
    const targets = f.db.all<{ id: string; listingId: string }>(
      "SELECT id,listing_id listingId FROM mission_targets WHERE mission_id=?", planId);
    assert.equal(targets.length, 2);
    const expiry = new Date(NOW + DAY).toISOString();
    f.control.updateMission(planId, { status: "paused", targetQuantity: 3,
      targets: targets.map((target) => ({ id: target.id, enabled: target.listingId === listing,
        maxUnitPriceCents: 7999, sellerPolicy: "first_party_only", fulfillment: "pickup" })),
      policy: { expiresAt: expiry, cooldownSeconds: 100, maxSignalAgeSeconds: 300 }
    } satisfies MissionUpdateInput, NOW);
    const temporary = f.want(f.add("test", 999, "target", "95123999"));
    f.db.run("UPDATE missions SET origin=? WHERE id=?", TEST_CALL_PLAN_ORIGIN, temporary);
    const items = f.control.suggestedPricesPreview(NOW).items;
    assert.equal(items.length, 1);
    const result = f.control.applySuggestedPrices({ contractVersion: 1, confirmation: SUGGESTED_PRICES_CONFIRMATION, items }, NOW + 1);
    assert.equal(result.updated.length, 1);
    const after = f.db.all<{ listingId: string; enabled: number; cents: number; fulfillment: string }>(
      "SELECT listing_id listingId,enabled,max_unit_price_cents cents,fulfillment FROM mission_targets WHERE mission_id=?", planId);
    assert.deepEqual(after.map((target) => [target.enabled, target.cents, target.fulfillment]),
      targets.map((target) => [target.listingId === listing ? 1 : 0, target.listingId === listing ? 5199 : 7999, "pickup"]));
    const policy = f.db.get<{ expiry: string; cooldown: number; freshness: number }>(
      `SELECT expires_at expiry,cooldown_seconds cooldown,max_signal_age_seconds freshness FROM mission_intent_revisions
       WHERE mission_id=? ORDER BY revision DESC LIMIT 1`, planId);
    assert.deepEqual({ ...policy }, { expiry, cooldown: 100, freshness: 300 });
  } finally { f.db.close(); }
});

test("a refreshed observation at the same price does not invalidate a bulk review", () => {
  const f = fixture();
  try {
    const listing = f.add("refreshed");
    f.want(listing);
    const items = f.control.suggestedPricesPreview(NOW).items;
    f.db.run(`INSERT INTO offer_observations(id,listing_id,availability,unit_price_cents,currency,seller_type,observed_at,created_at)
      VALUES ('refreshed-price',?,'in_stock',4999,'USD','first_party',?,?)`, listing,
      new Date(NOW + 1).toISOString(), new Date(NOW + 1).toISOString());
    const result = f.control.applySuggestedPrices({ contractVersion: 1, confirmation: SUGGESTED_PRICES_CONFIRMATION, items }, NOW + 2);
    assert.equal(result.updated.length, 1);
    assert.deepEqual(result.skipped, []);
  } finally { f.db.close(); }
});

test("bulk pricing leaves expired plans and legacy quantities for individual review", () => {
  const f = fixture();
  try {
    const large = f.want(f.add("large"), "notify");
    f.db.run("UPDATE missions SET target_quantity=20 WHERE id=?", large);
    const expired = f.want(f.add("expired", 1999, "target", "95123998"));
    new PurchasePolicyRepository(f.db).revise(expired, { expiresAt: new Date(NOW + 1).toISOString() }, NOW);
    const items = f.control.suggestedPricesPreview(NOW + 2).items;
    assert.ok(items.every((item) => !item.canApply));
    const result = f.control.applySuggestedPrices({ contractVersion: 1, confirmation: SUGGESTED_PRICES_CONFIRMATION, items }, NOW + 3);
    assert.equal(result.updated.length, 0);
    assert.equal(f.db.get<{ quantity: number }>("SELECT target_quantity quantity FROM missions WHERE id=?", large)?.quantity, 20);
  } finally { f.db.close(); }
});

test("customer APIs support one-tap wants and scoped bulk price review", async () => {
  const f = fixture();
  const id = f.add("api");
  f.db.run("UPDATE offer_observations SET observed_at=?", new Date().toISOString());
  const server = createYoinkServer({ db: f.db, webRoot: join(process.cwd(), "apps/web"), version: "suggested-price-test" });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${origin}/api/v1/user/purchase-intents/want/suggested`, { method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ contractVersion: 1, listingId: id, confirmation: SUGGESTED_WANT_CONFIRMATION }) });
    assert.equal(response.status, 201, await response.clone().text());
    const saved = await response.json() as any;
    assert.equal(saved.preview.maxUnitPriceCents, 4999);
    const preview = await (await fetch(`${origin}/api/v1/user/purchase-intents/suggested-prices`)).json() as any;
    assert.equal(preview.items.length, 1);
    const applied = await fetch(`${origin}/api/v1/user/purchase-intents/suggested-prices`, { method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ contractVersion: 1, items: preview.items, confirmation: SUGGESTED_PRICES_CONFIRMATION }) });
    assert.equal(applied.status, 200, await applied.clone().text());
    assert.equal((await applied.json() as any).updated.length, 1);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); f.db.close(); }
});
