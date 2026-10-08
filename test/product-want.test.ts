import { officialMsrpFixture } from "./helpers/official-msrp.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  PRODUCT_WANT_CONTRACT_VERSION,
  PRODUCT_WANT_PREVIEW_CONFIRMATION,
  PRODUCT_WANT_SAVE_CONFIRMATION,
  type ProductWantInput,
  type ProductWantMode
} from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { OfficialMsrpRepository } from "../packages/database/src/official-msrp-repository.js";
import { SpendLedgerRepository } from "../packages/database/src/spend-ledger-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

const NOW = new Date("2026-09-30T18:00:00.000Z").getTime();

test("Want it refuses to save after a displayed store price changes even below the cap", () => {
  const { db, control, targetId } = fixture();
  try {
    const input = request(targetId, "add_to_cart", { maxUnitPriceCents: 2900 });
    const preview = control.previewProductWant(input, NOW);
    db.run("UPDATE offer_observations SET unit_price_cents = 2799 WHERE listing_id = ?", targetId);
    assert.throws(() => control.saveProductWant({ ...input,
      confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt
    }, NOW + 1_000), { code: "product_want_preview_changed" });
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
  } finally { db.close(); }
});

interface Fixture {
  db: YoinkDatabase;
  control: ControlRepository;
  targetId: string;
  walmartId: string;
  amazonId: string;
  marketplaceId: string;
}

function fixture(): Fixture {
  const db = new YoinkDatabase();
  const catalog = new CatalogRepository(db);
  const listing = (retailerId: string, sku: string, url: string, executionSupported: boolean, observedPriceCents: number | null) =>
    catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
      sourceProductId: "want-it-product", sourceListingId: `want-it-${retailerId}-${sku}`,
      title: "Want It Booster Bundle", retailerId, retailerSku: sku, canonicalUrl: url,
      listingStatus: "in_stock", executionSupported, msrpCents: 2999, observedPriceCents, currency: "USD",
      observedAt: new Date(NOW - 60_000).toISOString()
    }, NOW - 60_000).listing;
  const target = listing("target", "95111111", "https://www.target.com/p/-/A-95111111", true, 3199);
  const walmart = listing("walmart", "6661111", "https://www.walmart.com/ip/6661111", false, 2899);
  const amazon = listing("amazon", "B0WANTIT01", "https://www.amazon.com/dp/B0WANTIT01", true, 3499);
  const marketplace = listing("walmart", "6662222", "https://www.walmart.com/ip/6662222", false, 5999);
  db.run("UPDATE listings SET offer_role = 'alternate', seller_type = 'third_party' WHERE id = ?", marketplace.id);
  // Amazon listings start off until the store is turned on; this account has it on.
  db.run("UPDATE listings SET execution_supported = 1 WHERE id = ?", amazon.id);
  for (const item of [target, walmart, amazon]) officialMsrpFixture(db, item.id, NOW, 2999);
  return { db, control: new ControlRepository(db), targetId: target.id, walmartId: walmart.id, amazonId: amazon.id, marketplaceId: marketplace.id };
}

function request(listingId: string, mode: ProductWantMode, extra: Partial<ProductWantInput> = {}): ProductWantInput {
  return { contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId, mode, confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION, ...extra };
}

function targets(db: YoinkDatabase, missionId: string): Record<string, { enabled: number; cap: number | null; seller: string }> {
  return Object.fromEntries(db.all<{ listingId: string; enabled: number; cap: number | null; seller: string }>(
    `SELECT listing_id AS listingId, enabled, max_unit_price_cents AS cap, seller_policy AS seller
     FROM mission_targets WHERE mission_id = ?`,
    missionId
  ).map((row) => [row.listingId, { enabled: row.enabled, cap: row.cap, seller: row.seller }]));
}

function policy(db: YoinkDatabase, missionId: string): { actionCeiling: string; maxAllInCents: number; decisionMode: string; expiresAt: string } {
  return { ...db.get<{ actionCeiling: string; maxAllInCents: number; decisionMode: string; expiresAt: string }>(
    `SELECT action_ceiling AS actionCeiling, max_all_in_cents AS maxAllInCents,
            decision_mode AS decisionMode, expires_at AS expiresAt
     FROM mission_intent_revisions WHERE mission_id = ? ORDER BY revision DESC LIMIT 1`,
    missionId
  )! };
}

test("Want it previews every store's own offer, defaults the max to MSRP, and saves one cart plan for the stores that are on", () => {
  const { db, control, targetId, walmartId, amazonId, marketplaceId } = fixture();
  try {
    const preview = control.previewProductWant(request(walmartId, "add_to_cart"), NOW, {
      cartReady: (retailerId) => retailerId === "target"
    });
    assert.equal(preview.noPlanSaved, true);
    assert.equal(preview.mode, "add_to_cart");
    assert.equal(preview.maxUnitPriceCents, 2999, "the max starts at the product's MSRP");
    assert.equal(preview.targetQuantity, 1);
    assert.deepEqual(preview.stores.map((store) => [store.retailerName, store.watch, store.note]), [
      ["Amazon", "add_to_cart", "Alerts you until Amazon's store check passes"],
      ["Target", "add_to_cart", "Adds to cart"],
      ["Walmart", "off", "Off: Walmart isn't on for cart adds"]
    ]);
    assert.ok(!preview.stores.some((store) => store.listingId === marketplaceId), "marketplace sellers are never wanted");
    const settings = control.settings();
    const expectedAllIn = Math.max(...["amazon", "target"].map((retailerId) =>
      Math.ceil(2999 * (10_000 + settings.taxBps) / 10_000) + Number(settings.storeAllowancesCents[retailerId] ?? 0)));
    assert.equal(preview.maxAllInCents, expectedAllIn);
    assert.equal(preview.canSave, true);
    assert.match(preview.summary, /^When Amazon or Target has it in stock for \$29\.99 or less, Yoink adds it to your cart\. You check out yourself\./);
    assert.match(preview.summary, /Walmart isn't on for cart adds, so it isn't watched/);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0, "a preview writes nothing");

    const saved = control.saveProductWant({
      ...request(walmartId, "add_to_cart"),
      confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint,
      previewedAt: preview.previewedAt
    }, NOW + 5_000, { cartReady: (retailerId) => retailerId === "target" });
    assert.equal(saved.created, true);
    const rows = targets(db, saved.purchaseIntentId);
    assert.deepEqual(rows[targetId], { enabled: 1, cap: 2999, seller: "first_party_only" });
    assert.deepEqual(rows[amazonId], { enabled: 1, cap: 2999, seller: "first_party_only" });
    assert.equal(rows[walmartId]?.enabled, 0);
    assert.equal(rows[marketplaceId]?.enabled, 0);
    assert.deepEqual(policy(db, saved.purchaseIntentId), {
      actionCeiling: "add_to_cart", maxAllInCents: expectedAllIn, decisionMode: "purchase_intent", expiresAt: ""
    });
    assert.deepEqual({ ...db.get("SELECT origin, quick_add_profile_id AS profile FROM missions WHERE id = ?", saved.purchaseIntentId) },
      { origin: "user_want", profile: "" });
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'purchase_plan_wanted'"
    )?.count, 1);
  } finally {
    db.close();
  }
});

test("Alert me watches every store, and a want with no store on for cart adds falls back to alerts", () => {
  const { db, control, targetId, walmartId, amazonId } = fixture();
  try {
    const alertPreview = control.previewProductWant(request(targetId, "notify", { maxUnitPriceCents: 3500, targetQuantity: 2 }), NOW);
    assert.equal(alertPreview.mode, "notify");
    assert.deepEqual(alertPreview.stores.map((store) => store.watch), ["alert", "alert", "alert"]);
    assert.equal(alertPreview.maxAllInCents, 7000);
    assert.equal(alertPreview.summary, "Yoink alerts you when Amazon, Target or Walmart has it in stock for $35.00 or less.");
    const saved = control.saveProductWant({
      ...request(targetId, "notify", { maxUnitPriceCents: 3500, targetQuantity: 2 }),
      confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: alertPreview.previewFingerprint,
      previewedAt: alertPreview.previewedAt
    }, NOW);
    const rows = targets(db, saved.purchaseIntentId);
    assert.deepEqual([rows[targetId]?.enabled, rows[walmartId]?.enabled, rows[amazonId]?.enabled], [1, 1, 1]);
    assert.equal(policy(db, saved.purchaseIntentId).actionCeiling, "notify");

    db.run("UPDATE listings SET execution_supported = 0");
    const fallback = control.previewProductWant(request(targetId, "add_to_cart"), NOW);
    assert.equal(fallback.requestedMode, "add_to_cart");
    assert.equal(fallback.mode, "notify");
    assert.match(fallback.summary, /^None of this item's stores is on for cart adds yet, so Yoink will alert you/);
    assert.equal(fallback.plan?.id, saved.purchaseIntentId);
    assert.equal(fallback.maxUnitPriceCents, 3500, "an existing want keeps its max");
    assert.equal(fallback.targetQuantity, 2, "and its quantity");
  } finally {
    db.close();
  }
});

test("saving needs the matching, fresh preview", () => {
  const { db, control, targetId } = fixture();
  try {
    const preview = control.previewProductWant(request(targetId, "add_to_cart"), NOW);
    const save = (overrides: Partial<ProductWantInput>, now = NOW + 1_000) => () => control.saveProductWant({
      ...request(targetId, "add_to_cart"),
      confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint,
      previewedAt: preview.previewedAt,
      ...overrides
    }, now);
    assert.throws(save({ maxUnitPriceCents: 2500 }), { code: "product_want_preview_changed" });
    assert.throws(save({ previewFingerprint: "" }), { code: "product_want_preview_required" });
    assert.throws(save({}, NOW + 301_000), { code: "product_want_preview_stale" });
    assert.throws(save({ confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION }), { code: "product_want_confirmation_required" });
    db.run("UPDATE app_settings SET tax_bps = tax_bps + 100");
    assert.throws(save({}), { code: "product_want_preview_changed" }, "a changed tax reserve changes the saved total");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
  } finally {
    db.close();
  }
});

test("Want it takes over a Quick add plan: one store becomes every cart store, and the setup link is dropped", () => {
  const { db, control, targetId, walmartId, amazonId } = fixture();
  try {
    const saveResult = control.savePurchaseProfile({
      name: "add 1 to cart", targetQuantity: 1, actionCeiling: "add_to_cart", fulfillment: "shipping",
      priceMode: "msrp_offset_percent", maxUnitPriceCents: null, msrpOffsetPercent: 5, isDefault: true, cooldownSeconds: 0
    });
    const profile = saveResult.profiles.find((candidate) => candidate.name === "add 1 to cart");
    assert.ok(profile);
    const created = control.createConfiguredMission({
      contractVersion: 1, listingId: walmartId, targetQuantity: 1, maxUnitPriceCents: 2899, maxAllInCents: 2899,
      actionCeiling: "notify", sellerPolicy: "first_party_only", fulfillment: "shipping",
      substitutionPolicy: "exact_only", cooldownSeconds: 0, quickAddProfileId: profile.id,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, NOW);
    const missionId = created.mission.id;
    assert.equal(db.get<{ profile: string }>("SELECT quick_add_profile_id AS profile FROM missions WHERE id = ?", missionId)?.profile, profile.id);

    const preview = control.previewProductWant(request(walmartId, "add_to_cart", { maxUnitPriceCents: 2900 }), NOW + 1_000);
    assert.equal(preview.plan?.id, missionId);
    assert.equal(preview.plan?.mode, "notify");
    const saved = control.saveProductWant({
      ...request(walmartId, "add_to_cart", { maxUnitPriceCents: 2900 }),
      confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint,
      previewedAt: preview.previewedAt
    }, NOW + 2_000);
    assert.equal(saved.purchaseIntentId, missionId);
    assert.equal(saved.created, false);
    const rows = targets(db, missionId);
    assert.deepEqual([rows[targetId]?.enabled, rows[amazonId]?.enabled, rows[walmartId]?.enabled], [1, 1, 0]);
    assert.equal(rows[targetId]?.cap, 2900);
    assert.equal(policy(db, missionId).actionCeiling, "add_to_cart");
    assert.deepEqual({ ...db.get("SELECT origin, quick_add_profile_id AS profile, status FROM missions WHERE id = ?", missionId) },
      { origin: "user_want", profile: "", status: "active" });

    // Wanting a finished item again starts a fresh count.
    db.run("UPDATE missions SET status = 'satisfied', fulfilled_quantity = 1 WHERE id = ?", missionId);
    const again = control.previewProductWant(request(targetId, "add_to_cart"), NOW + 3_000);
    control.saveProductWant({
      ...request(targetId, "add_to_cart"),
      confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: again.previewFingerprint,
      previewedAt: again.previewedAt
    }, NOW + 4_000);
    assert.deepEqual({ ...db.get("SELECT status, fulfilled_quantity AS fulfilled FROM missions WHERE id = ?", missionId) },
      { status: "active", fulfilled: 0 });
  } finally {
    db.close();
  }
});

test("a cart want over the spending limit cannot be saved, and a product without a price asks for one", () => {
  const { db, control, targetId } = fixture();
  try {
    const spend = new SpendLedgerRepository(db);
    spend.updatePolicy({ expectedRevision: spend.policy().revision, perOrderCapCents: 2000, dailyCapCents: null, monthlyCapCents: null });
    const preview = control.previewProductWant(request(targetId, "add_to_cart"), NOW);
    assert.equal(preview.canSave, false);
    assert.equal(preview.spendingLimit.reasonCode, "per_order_cap_exceeded");
    assert.match(preview.summary, /per-order spending limit\. Lower the max price, choose Alert me, or raise your spending limit\.$/);
    assert.throws(() => control.saveProductWant({
      ...request(targetId, "add_to_cart"),
      confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint,
      previewedAt: preview.previewedAt
    }, NOW + 1_000), { code: "per_order_cap_exceeded" });
    const alerts = control.previewProductWant(request(targetId, "notify"), NOW);
    assert.equal(alerts.canSave, true, "alerts never reserve spending");

    db.run("UPDATE variants SET msrp_cents = NULL");
    db.run("UPDATE listings SET msrp_cents = NULL");
    db.run("DELETE FROM offer_observations");
    db.run("UPDATE official_msrp_evidence SET status='revoked'");
    const noPrice = control.previewProductWant(request(targetId, "add_to_cart"), NOW);
    assert.equal(noPrice.maxUnitPriceCents, null);
    assert.equal(noPrice.canSave, false);
    assert.match(noPrice.summary, /^Confirm the MSRP to have Yoink add this to your cart\./);
    assert.deepEqual(noPrice.msrpConfirmation, { needed: true, suggestedCents: null, confirmedCents: null });
  } finally {
    db.close();
  }
});

test("Want it asks for the MSRP where none is reviewed, records the shopper's confirmation on save, and binds the plan to it", () => {
  // Kevin, 2026-10-08: confirming the MSRP in Want it replaces a manufacturer page at Amazon, Target, Walmart and Best Buy.
  const { db, control, targetId, amazonId } = fixture();
  try {
    db.run("UPDATE official_msrp_evidence SET status='revoked'");
    const evidenceRows = () => db.get<{ count: number }>("SELECT COUNT(*) AS count FROM official_msrp_evidence")!.count;
    const before = evidenceRows();
    const asking = control.previewProductWant(request(targetId, "add_to_cart"), NOW);
    assert.deepEqual(asking.msrpConfirmation, { needed: true, suggestedCents: 2999, confirmedCents: null },
      "the catalog's MSRP is offered for the shopper to confirm");
    assert.deepEqual(asking.stores.filter((store) => store.watch === "off").map((store) => store.note),
      ["Off: confirm the MSRP to add to cart here", "Off: confirm the MSRP to add to cart here", "Off: Walmart isn't on for cart adds"]);
    assert.equal(asking.canSave, false);
    assert.match(asking.summary, /^Confirm the MSRP to have Yoink add this to your cart\./);

    const confirmed = control.previewProductWant(request(targetId, "add_to_cart", { confirmedMsrpCents: 2999 }), NOW);
    assert.equal(confirmed.msrpConfirmation.needed, false);
    assert.equal(confirmed.maxUnitPriceCents, 2999, "the max starts at the confirmed MSRP");
    assert.deepEqual(confirmed.stores.filter((store) => store.watch === "add_to_cart").map((store) => [store.retailerId, store.officialMsrp]), [
      ["amazon", { id: "", cents: 2999, sourceUrl: "", desiredVariant: "Want It Booster Bundle", expiresAt: "", confirmedByYou: true }],
      ["target", { id: "", cents: 2999, sourceUrl: "", desiredVariant: "Want It Booster Bundle", expiresAt: "", confirmedByYou: true }]
    ]);
    assert.equal(confirmed.canSave, true);
    assert.equal(evidenceRows(), before, "a preview records nothing");

    const overMsrp = control.previewProductWant(request(targetId, "add_to_cart", { confirmedMsrpCents: 2999, maxUnitPriceCents: 3100 }), NOW);
    assert.equal(overMsrp.canSave, false);
    assert.equal(overMsrp.summary, "Set your max at or below the MSRP ($29.99).");

    const save = (extra: Partial<ProductWantInput>, at: number) => {
      const preview = control.previewProductWant(request(targetId, "add_to_cart", extra), at);
      return control.saveProductWant({ ...request(targetId, "add_to_cart", extra), confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
        previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, at + 1_000);
    };
    const saved = save({ confirmedMsrpCents: 2999 }, NOW);
    const official = new OfficialMsrpRepository(db);
    const targetEvidence = official.current(targetId, NOW + 2_000)!;
    assert.equal(targetEvidence.confirmedByOwner, true);
    assert.equal(targetEvidence.msrpCents, 2999);
    assert.equal(official.current(amazonId, NOW + 2_000)!.confirmedByOwner, true);
    assert.equal(evidenceRows(), before + 2, "one confirmation per store that adds to cart");
    const bound = JSON.parse(db.get<{ json: string }>(`SELECT target_policy_json AS json FROM mission_intent_revisions
      WHERE mission_id = ? ORDER BY revision DESC LIMIT 1`, saved.purchaseIntentId)!.json) as Array<{ listingId: string; officialMsrpEvidenceId?: string }>;
    assert.equal(bound.find((target) => target.listingId === targetId)?.officialMsrpEvidenceId, targetEvidence.id);

    save({ confirmedMsrpCents: 2999 }, NOW + 10_000);
    assert.equal(evidenceRows(), before + 2, "saving the same MSRP again reuses the confirmation");
    save({ confirmedMsrpCents: 2799 }, NOW + 20_000);
    assert.equal(official.current(targetId, NOW + 22_000)!.msrpCents, 2799, "the shopper can correct their own MSRP");
    assert.equal(targets(db, saved.purchaseIntentId)[targetId]?.cap, 2799, "the max follows the corrected MSRP");
  } finally {
    db.close();
  }
});

test("a shopper's MSRP never replaces a manufacturer-reviewed one", () => {
  const { db, control, targetId } = fixture();
  try {
    const before = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM official_msrp_evidence")!.count;
    const preview = control.previewProductWant(request(targetId, "add_to_cart", { confirmedMsrpCents: 3999 }), NOW);
    assert.equal(preview.msrpConfirmation.needed, false);
    const store = preview.stores.find((item) => item.retailerId === "target")!;
    assert.equal(store.officialMsrp?.cents, 2999);
    assert.equal(store.officialMsrp?.confirmedByYou, false);
    control.saveProductWant({ ...request(targetId, "add_to_cart", { confirmedMsrpCents: 3999 }), confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, NOW + 1_000);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM official_msrp_evidence")!.count, before);
  } finally {
    db.close();
  }
});

test("the Want it routes preview and save through the shopper API", async () => {
  const { db, targetId, amazonId } = fixture();
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "test" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) => fetch(`${origin}/api/v1/user/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  try {
    const previewResponse = await post("purchase-intents/want/preview", request(amazonId, "add_to_cart", { maxUnitPriceCents: 2900 }));
    assert.equal(previewResponse.status, 200);
    const { preview } = await previewResponse.json() as { preview: Record<string, any> };
    assert.equal(preview.mode, "add_to_cart");
    // No store check has passed on this fresh account, and it starts paused and in test mode.
    assert.ok(preview.stores.every((store: { cartReady: boolean }) => store.cartReady === false));
    assert.match(String(preview.summary), /Cart adds are paused right now/);
    const saved = await post("purchase-intents/want", {
      ...request(amazonId, "add_to_cart", { maxUnitPriceCents: 2900 }),
      confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint,
      previewedAt: preview.previewedAt
    });
    assert.equal(saved.status, 201, JSON.stringify(await saved.clone().json()));
    const body = await saved.json() as { purchaseIntent: Record<string, any>; created: boolean };
    assert.equal(body.created, true);
    assert.equal(body.purchaseIntent.intentPolicy.actionCeiling, "add_to_cart");
    const watched = preview.stores.filter((store: { watch: string }) => store.watch !== "off").map((store: { listingId: string }) => store.listingId);
    assert.ok(watched.includes(targetId));
    assert.deepEqual(
      body.purchaseIntent.targets.filter((target: { enabled: boolean }) => target.enabled).map((target: { listingId: string }) => target.listingId).sort(),
      watched.sort()
    );
    assert.ok(body.purchaseIntent.automationReadiness, "the saved plan comes back decorated like every plan payload");
    const stale = await post("purchase-intents/want", {
      ...request(amazonId, "add_to_cart", { maxUnitPriceCents: 2800 }),
      confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint,
      previewedAt: preview.previewedAt
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as { error: string }).error, "product_want_preview_changed");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
