import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { resolveApiRoutePolicy } from "../apps/api/src/api-route-policy.js";
import {
  COLLECTION_WANT_CONFIRMATION,
  COLLECTION_WANT_ORIGIN,
  PRODUCT_WANT_CONTRACT_VERSION,
  PRODUCT_WANT_PREVIEW_CONFIRMATION,
  PRODUCT_WANT_SAVE_CONFIRMATION,
  PURCHASE_INTENT_DELETE_CONFIRMATION,
  TARGET_ADD_ADAPTER_VERSION,
  type CollectionWantMode,
  type TrackalackerCatalogItemInput,
  type TrackalackerCatalogListingInput
} from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { OfficialMsrpRepository } from "../packages/database/src/official-msrp-repository.js";
import { fallbackItemTitle, isAllNewCollectionTitle, itemTitleFromUrl, sameCollectionItem } from "../packages/domain/src/collections.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";

// "All New …" entries (Kevin, 2026-10-09): every item is its own product,
// linked to its entry; wanting the entry wants each item, now and as new ones
// appear, at Yoink's suggested price, or its first store price while new.

const NOW = new Date("2026-10-09T18:00:00.000Z").getTime();
const DAY = 86_400_000;

function walmartItem(id: string, sku: string, slug: string, priceCents: number): TrackalackerCatalogListingInput {
  return {
    sourceListingId: id, storeName: "Walmart", retailerId: "walmart", retailerSku: sku,
    canonicalUrl: `https://www.walmart.com/ip/${sku}`, outboundUrl: `https://www.walmart.com/ip/${slug}/${sku}`,
    sourceListingUrl: `https://www.trackalacker.com/products/showcase/all-new-needoh/listings/${id}/item`,
    availability: "in_stock", unitPriceCents: priceCents, sellerType: "first_party"
  };
}

const searchLink: TrackalackerCatalogListingInput = {
  sourceListingId: "needoh-target-search", storeName: "Target",
  outboundUrl: "https://www.target.com/s?searchTerm=needoh",
  sourceListingUrl: "https://www.trackalacker.com/products/showcase/all-new-needoh/listings/needoh-target-search/item"
};

function needoh(listings: TrackalackerCatalogListingInput[], observedAt: number): TrackalackerCatalogItemInput {
  return {
    sourceProductId: "tl-all-new-needoh", sourceProductSlug: "all-new-needoh",
    sourceProductUrl: "https://www.trackalacker.com/products/showcase/all-new-needoh",
    title: "All New Needoh", imageUrl: "https://static.trackalacker.com/uploads/products/photo_item/photo/1/needoh.webp",
    observedAt: new Date(observedAt).toISOString(), listings
  };
}

const COUNTDOWN = walmartItem("needoh-1", "18980723646", "NeeDoh-Halloween-Countdown", 1297);
const TEENIE = walmartItem("needoh-2", "20349455720", "Schylling-NeeDoh-Teenie-Color-Change", 597);

function items(db: YoinkDatabase, collectionVariantId: string): Array<{ id: string; title: string; sku: string; role: string }> {
  return db.all<{ id: string; title: string; sku: string; role: string }>(
    `SELECT v.id, v.title, l.retailer_sku AS sku, l.offer_role AS role FROM variants v
     LEFT JOIN listings l ON l.variant_id = v.id WHERE v.collection_variant_id = ? ORDER BY l.retailer_sku`, collectionVariantId);
}

function plans(db: YoinkDatabase): Array<{ title: string; origin: string; status: string; mode: string; cap: number | null }> {
  return db.all<{ title: string; origin: string; status: string; mode: string; cap: number | null }>(
    `SELECT v.title, m.origin, m.status,
            (SELECT action_ceiling FROM mission_intent_revisions ir WHERE ir.mission_id = m.id ORDER BY revision DESC LIMIT 1) AS mode,
            (SELECT MAX(max_unit_price_cents) FROM mission_targets mt WHERE mt.mission_id = m.id AND mt.enabled = 1) AS cap
     FROM missions m JOIN variants v ON v.id = m.variant_id ORDER BY v.title`).map((row) => ({ ...row }));
}

function wantEntry(control: ControlRepository, variantId: string, mode: CollectionWantMode, now: number) {
  return control.saveCollectionWant({ contractVersion: 1, variantId, mode, confirmation: COLLECTION_WANT_CONFIRMATION }, now);
}

test("an item's name comes from its store link, else a plain placeholder", () => {
  assert.equal(isAllNewCollectionTitle("All New Pokemon"), true);
  assert.equal(isAllNewCollectionTitle("Allnew Pokemon"), false);
  assert.equal(isAllNewCollectionTitle("All New"), false);
  assert.equal(itemTitleFromUrl("https://www.walmart.com/ip/NeeDoh-Halloween-Countdown/18980723646"), "NeeDoh Halloween Countdown");
  assert.equal(itemTitleFromUrl("https://www.target.com/p/needoh-gumdrop/-/A-95123456"), "Needoh Gumdrop");
  assert.equal(itemTitleFromUrl("https://www.bestbuy.com/site/RIFTBOUND-SPIRIT-FORGED-BOOSTER/6680277.p?skuId=6680277"), "Riftbound Spirit Forged Booster");
  assert.equal(itemTitleFromUrl("https://www.walmart.com/ip/18980723646"), "");
  assert.equal(itemTitleFromUrl("https://www.walmart.com/ip/%E0%A4%A-bad/1"), "%E0%A4%A bad", "a malformed escape never throws");
  assert.equal(itemTitleFromUrl("not a url"), "");
  assert.equal(fallbackItemTitle("All New Needoh", "Walmart", "20349455720"), "New Needoh item at Walmart (20349455720)");
});

test("the same item at two stores is one product; a different size, box, count or price is not", () => {
  const same = (first: string, second: string, firstCents: number | null = 3499, secondCents: number | null = 3499) =>
    sameCollectionItem("All New Riftbound", { title: first, priceCents: firstCents }, { title: second, priceCents: secondCents });
  // The real pair from Kevin's data: Target's link and Best Buy's link for one deck set.
  assert.equal(same("Riftbound League Of Legends Trading Card Game Zed Vs Shen Showdown Decks", "Riftbound Zed Vs Shen Showdown Decks"), true);
  assert.equal(same("Riftbound Zed Vs Shen Showdown Decks", "Riftbound Zed Vs Shen Showdown Decks Display"), false, "a display is another item");
  assert.equal(same("Riftbound Spiritforged Booster", "Riftbound Spiritforged Booster 36 Count"), false, "so is a count");
  assert.equal(same("Riftbound Zed Vs Shen Showdown Decks", "Riftbound Jinx Vs Vi Showdown Decks"), false);
  assert.equal(same("Riftbound Zed Vs Shen Showdown Decks", "Riftbound Zed Vs Shen Showdown Decks", 3499, 8999), false, "prices far apart");
  assert.equal(same("Riftbound Zed Vs Shen Showdown Decks", "Riftbound Zed Vs Shen Showdown Decks", 3499, 3899), true, "within $5");
  assert.equal(same("Riftbound Origins", "Riftbound Origins"), false, "the brand and one word is too little to go on");
  assert.equal(same("Riftbound Zed Vs Shen Showdown Decks", "New Riftbound item at Amazon (B0HD16CV7L)"), false);
  assert.equal(same("Riftbound Zed Vs Shen Showdown Decks", "riftbound zed-vs-shen showdown decks", null, 3499), true, "no price: the same words");
  assert.equal(same("Riftbound Zed Vs Shen Showdown Decks", "Riftbound League Zed Vs Shen Showdown Decks", null, 3499), false,
    "no price: an extra word is not enough to go on");
});

test("a sync files each item of an All New entry as its own product, linked to the entry", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const synced = catalog.upsertTrackalackerItem(needoh([COUNTDOWN, TEENIE, searchLink], NOW - DAY), NOW - DAY);
    const entryId = synced.variantId;
    assert.equal(catalog.isCollectionVariant(entryId), true);
    assert.deepEqual(items(db, entryId).map((item) => [item.title, item.sku, item.role]), [
      ["NeeDoh Halloween Countdown", "18980723646", "primary"],
      ["Schylling NeeDoh Teenie Color Change", "20349455720", "primary"]
    ]);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings WHERE variant_id = ?", entryId)?.count, 0,
      "the entry itself sells nothing");
    assert.equal(catalog.isCollectionVariant(items(db, entryId)[0]!.id), false);

    // The same sync again changes nothing.
    const variants = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM variants")?.count;
    assert.equal(catalog.upsertTrackalackerItem(needoh([COUNTDOWN, TEENIE, searchLink], NOW - DAY + 60_000), NOW - DAY + 60_000).variantId, entryId);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM variants")?.count, variants);

    const products = catalog.listLibraryProducts(100, 0, { search: "needoh" }) as unknown as Array<Record<string, any>>;
    const entry = products.find((product) => product.variantId === entryId);
    assert.deepEqual(entry?.collection, { itemCount: 2, wanted: false, mode: "" });
    const countdown = products.find((product) => product.title === "NeeDoh Halloween Countdown");
    assert.equal(countdown?.collectionVariantId, entryId);
    assert.equal(countdown?.collectionTitle, "All New Needoh");
    assert.equal(countdown?.imageUrl, "https://static.trackalacker.com/uploads/products/photo_item/photo/1/needoh.webp",
      "an item with no picture of its own shows its entry's");
    assert.equal(countdown?.collection, undefined);

    // An entry with no item yet still shows, so it can be wanted ahead of its first item.
    const riftbound = catalog.upsertTrackalackerItem({ ...needoh([], NOW - DAY), sourceProductId: "tl-all-new-riftbound",
      sourceProductSlug: "all-new-riftbound", sourceProductUrl: "https://www.trackalacker.com/products/showcase/all-new-riftbound",
      title: "All New Riftbound" }, NOW - DAY);
    const shown = catalog.listLibraryProducts(100, 0, { search: "riftbound" }) as unknown as Array<Record<string, any>>;
    assert.deepEqual(shown.map((product) => [product.variantId, product.collection?.itemCount]), [[riftbound.variantId, 0]]);
  } finally {
    db.close();
  }
});

test("an item filed under its entry before this release moves to its own product, and a plan on the entry lets go of it", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const control = new ControlRepository(db);
    const entryId = catalog.upsertTrackalackerItem(needoh([COUNTDOWN], NOW - DAY), NOW - DAY).variantId;
    const listingId = db.get<{ id: string }>("SELECT id FROM listings WHERE retailer_sku = '18980723646'")!.id;
    // Before 1.30.26 the item's listing sat on the entry itself, and Want it made a plan for the entry.
    const oldItem = items(db, entryId)[0]!.id;
    db.run("UPDATE listings SET variant_id = ? WHERE id = ?", entryId, listingId);
    db.run("DELETE FROM variants WHERE id = ?", oldItem);
    const preview = control.previewProductWant({ contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId, mode: "notify",
      maxUnitPriceCents: 1500, confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION }, NOW - DAY);
    const entryPlan = control.saveProductWant({ contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId, mode: "notify",
      maxUnitPriceCents: 1500, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, NOW - DAY).purchaseIntentId;

    catalog.upsertTrackalackerItem(needoh([COUNTDOWN], NOW - DAY + 60_000), NOW - DAY + 60_000);
    const moved = items(db, entryId);
    assert.deepEqual(moved.map((item) => [item.title, item.sku, item.role]), [["NeeDoh Halloween Countdown", "18980723646", "primary"]]);
    assert.equal(db.get<{ variantId: string }>("SELECT variant_id AS variantId FROM listings WHERE id = ?", listingId)?.variantId, moved[0]!.id);
    assert.equal(db.get<{ enabled: number }>("SELECT enabled FROM mission_targets WHERE mission_id = ? AND listing_id = ?", entryPlan, listingId)?.enabled, 0);
  } finally {
    db.close();
  }
});

test("at startup, items an entry still holds as its own listings are filed as their own products", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const entryId = catalog.upsertTrackalackerItem(needoh([COUNTDOWN, { ...TEENIE, outboundUrl: "" }], NOW - DAY), NOW - DAY).variantId;
    // Before 1.30.26 both listings sat on the entry.
    for (const item of items(db, entryId)) {
      db.run("UPDATE listings SET variant_id = ? WHERE variant_id = ?", entryId, item.id);
      db.run("DELETE FROM variants WHERE id = ?", item.id);
    }
    assert.equal(catalog.refileCollectionListings(NOW), 2);
    assert.deepEqual(items(db, entryId).map((item) => [item.title, item.sku, item.role]), [
      ["NeeDoh Halloween Countdown", "18980723646", "primary"],
      ["New Needoh item at Walmart (20349455720)", "20349455720", "primary"]
    ]);
    assert.equal(catalog.refileCollectionListings(NOW), 0, "once filed, nothing is left to do");
    // A later sync whose link names the item replaces the placeholder name.
    catalog.upsertTrackalackerItem(needoh([COUNTDOWN, TEENIE], NOW), NOW);
    assert.deepEqual(items(db, entryId).map((item) => item.title), ["NeeDoh Halloween Countdown", "Schylling NeeDoh Teenie Color Change"]);
  } finally {
    db.close();
  }
});

test("wanting an entry wants each item at Yoink's suggested price, leaves the shopper's own Wants alone, and stopping undoes only its own", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const control = new ControlRepository(db);
    const official = new OfficialMsrpRepository(db);
    // Walmart is on for cart adds in this account.
    db.run("UPDATE retailers SET execution_supported = 1 WHERE id = 'walmart'");
    const third = walmartItem("needoh-3", "30000000003", "NeeDoh-Gumdrop", 899);
    const entryId = catalog.upsertTrackalackerItem(needoh([COUNTDOWN, TEENIE, third], NOW - 10 * DAY), NOW - 10 * DAY).variantId;
    const listing = (sku: string) => db.get<{ id: string }>("SELECT id FROM listings WHERE retailer_sku = ?", sku)!.id;
    // The Countdown spiked to $24.97 an hour ago; its usual price is still $12.97.
    db.run(`INSERT INTO offer_observations(id, listing_id, availability, unit_price_cents, currency, observed_at, created_at)
      VALUES ('obs_countdown_spike', ?, 'in_stock', 2497, 'USD', ?, ?)`,
    listing("18980723646"), new Date(NOW - 3_600_000).toISOString(), new Date(NOW - 3_600_000).toISOString());
    // The shopper already wants the Gumdrop as an alert at their own max.
    const preview = control.previewProductWant({ contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId: listing("30000000003"),
      mode: "notify", maxUnitPriceCents: 700, confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION }, NOW - DAY);
    control.saveProductWant({ contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId: listing("30000000003"), mode: "notify",
      maxUnitPriceCents: 700, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, NOW - DAY);

    const before = control.collectionWantPreview(entryId, NOW);
    assert.equal(before.wanted, false);
    assert.deepEqual(before.items.map((item) => [item.title, item.retailerName, item.maxUnitPriceCents, item.note]), [
      ["NeeDoh Gumdrop", "", null, "On your Want list with your own settings."],
      ["NeeDoh Halloween Countdown", "Walmart", 1297, ""],
      ["Schylling NeeDoh Teenie Color Change", "Walmart", 597, ""]
    ]);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions WHERE origin = ?", COLLECTION_WANT_ORIGIN)?.count, 0,
      "the preview saves nothing");

    const result = wantEntry(control, entryId, "add_to_cart", NOW);
    assert.deepEqual(result.wanted.map((item) => [item.title, item.maxUnitPriceCents]), [
      ["NeeDoh Halloween Countdown", 1297],
      ["Schylling NeeDoh Teenie Color Change", 597]
    ]);
    assert.deepEqual(result.waiting.map((item) => item.title), ["NeeDoh Gumdrop"]);
    assert.deepEqual(plans(db), [
      { title: "NeeDoh Gumdrop", origin: "user_want", status: "active", mode: "notify", cap: 700 },
      { title: "NeeDoh Halloween Countdown", origin: COLLECTION_WANT_ORIGIN, status: "active", mode: "add_to_cart", cap: 1297 },
      { title: "Schylling NeeDoh Teenie Color Change", origin: COLLECTION_WANT_ORIGIN, status: "active", mode: "add_to_cart", cap: 597 }
    ]);
    // Add to cart is "Any price up to my max": no MSRP check, the max is the limit.
    const evidence = official.current(listing("18980723646"), NOW)!;
    assert.deepEqual([evidence.maxPriceOnly, evidence.msrpCents], [true, 1297]);

    // Checking again with nothing new leaves each plan's history alone.
    const revisions = () => db.get<{ count: number }>("SELECT COUNT(*) AS count FROM mission_intent_revisions")?.count;
    const count = revisions();
    control.ensureCollectionItemWants(entryId, NOW + 60_000);
    assert.equal(revisions(), count);

    // A new item that appears later is wanted at its first store price.
    catalog.upsertTrackalackerItem(needoh([COUNTDOWN, TEENIE, third, walmartItem("needoh-4", "40000000004", "NeeDoh-Snowball-Crunch", 1497)], NOW + 120_000), NOW + 120_000);
    control.ensureCollectionItemWants(entryId, NOW + 120_000);
    assert.deepEqual(plans(db).find((plan) => plan.title === "NeeDoh Snowball Crunch"),
      { title: "NeeDoh Snowball Crunch", origin: COLLECTION_WANT_ORIGIN, status: "active", mode: "add_to_cart", cap: 1497 });

    // Switching the entry to Alert me switches its items.
    wantEntry(control, entryId, "notify", NOW + 180_000);
    assert.deepEqual(plans(db).filter((plan) => plan.origin === COLLECTION_WANT_ORIGIN).map((plan) => plan.mode), ["notify", "notify", "notify"]);

    // An item the shopper takes off Wanted stays off.
    const teeniePlan = db.get<{ id: string }>(
      "SELECT m.id FROM missions m JOIN variants v ON v.id = m.variant_id WHERE v.title LIKE 'Schylling%'")!.id;
    control.deleteMission(teeniePlan, { confirmation: PURCHASE_INTENT_DELETE_CONFIRMATION }, NOW + 240_000);
    control.ensureCollectionItemWants(entryId, NOW + 300_000);
    assert.equal(plans(db).find((plan) => plan.title.startsWith("Schylling"))?.status, "deleted");
    assert.equal(control.collectionWantPreview(entryId, NOW + 300_000).items.find((item) => item.title.startsWith("Schylling"))?.note,
      "You removed it from Wanted.");

    const library = catalog.listLibraryProducts(100, 0, { search: "needoh" }) as unknown as Array<Record<string, any>>;
    assert.deepEqual(library.find((product) => product.variantId === entryId)?.collection, { itemCount: 4, wanted: true, mode: "notify" });

    const stopped = control.stopCollectionWant(entryId, NOW + 360_000);
    assert.deepEqual([stopped.stopped, stopped.kept], [2, 0]);
    assert.deepEqual(plans(db).filter((plan) => plan.status !== "deleted").map((plan) => [plan.title, plan.origin]), [["NeeDoh Gumdrop", "user_want"]]);
    assert.equal(control.collectionWantPreview(entryId, NOW + 360_000).wanted, false);
    // With the entry no longer wanted, a new item is not wanted.
    assert.deepEqual(control.ensureCollectionItemWants(entryId, NOW + 420_000).wanted, []);
  } finally {
    db.close();
  }
});

test("browsing every store shows the same item once with each store's listing; a store shows only its own", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const control = new ControlRepository(db);
    const listing = (id: string, store: string, retailerId: string, sku: string, canonicalUrl: string, outboundUrl: string, cents: number): TrackalackerCatalogListingInput => ({
      sourceListingId: id, storeName: store, retailerId, retailerSku: sku, canonicalUrl, outboundUrl,
      sourceListingUrl: `https://www.trackalacker.com/products/showcase/all-new-riftbound/listings/${id}/item`,
      availability: "in_stock", unitPriceCents: cents, sellerType: "first_party"
    });
    const target = listing("rift-target", "Target", "target", "1011726392", "https://www.target.com/p/-/A-1011726392",
      "https://www.target.com/p/riftbound-league-of-legends-trading-card-game-zed-vs-shen-showdown-decks/-/A-1011726392", 3499);
    const bestbuy = listing("rift-bestbuy", "Best Buy", "bestbuy", "6680277", "https://www.bestbuy.com/site/-/6680277.p",
      "https://www.bestbuy.com/product/riftbound-zed-vs-shen-showdown-decks/J3GWY59HZJ", 3499);
    const display = listing("rift-display", "Best Buy", "bestbuy", "6680999", "https://www.bestbuy.com/site/-/6680999.p",
      "https://www.bestbuy.com/product/riftbound-zed-vs-shen-showdown-decks-display/J3GWY59HZK", 20999);
    const entryId = catalog.upsertTrackalackerItem({
      sourceProductId: "tl-all-new-riftbound", sourceProductSlug: "all-new-riftbound",
      sourceProductUrl: "https://www.trackalacker.com/products/showcase/all-new-riftbound",
      title: "All New Riftbound", observedAt: new Date(NOW - DAY).toISOString(), listings: [target, bestbuy, display]
    }, NOW - DAY).variantId;
    assert.deepEqual(items(db, entryId).map((item) => [item.title, item.sku]), [
      ["Riftbound League Of Legends Trading Card Game Zed Vs Shen Showdown Decks", "1011726392"],
      ["Riftbound League Of Legends Trading Card Game Zed Vs Shen Showdown Decks", "6680277"],
      ["Riftbound Zed Vs Shen Showdown Decks Display", "6680999"]
    ]);
    const deck = items(db, entryId)[0]!.id;
    assert.equal(items(db, entryId)[1]!.id, deck, "Target's and Best Buy's deck set are one product");

    const all = catalog.listLibraryProducts(100, 0, { search: "showdown" }) as unknown as Array<Record<string, any>>;
    assert.deepEqual(all.map((product) => [product.title, product.storeCount]).sort(), [
      ["Riftbound League Of Legends Trading Card Game Zed Vs Shen Showdown Decks", 2],
      ["Riftbound Zed Vs Shen Showdown Decks Display", 1]
    ]);
    const atBestBuy = catalog.listLibraryProducts(100, 0, { search: "showdown", retailerId: "bestbuy" }) as unknown as Array<Record<string, any>>;
    const deckAtBestBuy = atBestBuy.find((product) => product.variantId === deck)!;
    assert.deepEqual(deckAtBestBuy.listings.map((item: { retailerId: string }) => item.retailerId), ["bestbuy"], "a store shows only its own listing");

    // Wanting the entry wants the deck set once, at both stores, so only one is added.
    db.run("UPDATE retailers SET execution_supported = 1 WHERE id IN ('target', 'bestbuy')");
    db.run("UPDATE listings SET execution_supported = 1");
    wantEntry(control, entryId, "add_to_cart", NOW);
    const plan = db.get<{ id: string }>("SELECT id FROM missions WHERE variant_id = ?", deck)!;
    assert.deepEqual(db.all<{ retailerId: string }>(
      `SELECT l.retailer_id AS retailerId FROM mission_targets mt JOIN listings l ON l.id = mt.listing_id
       WHERE mt.mission_id = ? AND mt.enabled = 1 ORDER BY l.retailer_id`, plan.id).map((row) => row.retailerId), ["bestbuy", "target"]);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions WHERE origin = ?", COLLECTION_WANT_ORIGIN)?.count, 2);
    assert.deepEqual(control.collectionWantPreview(entryId, NOW).items.map((item) => [item.retailerName, item.maxUnitPriceCents]),
      [["Best Buy and Target", 3499], ["Best Buy", 20999]]);
  } finally {
    db.close();
  }
});

test("wanting an entry needs its confirmation and an All New entry", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const control = new ControlRepository(db);
    const entryId = catalog.upsertTrackalackerItem(needoh([COUNTDOWN], NOW - DAY), NOW - DAY).variantId;
    assert.throws(() => control.saveCollectionWant({ contractVersion: 1, variantId: entryId, mode: "add_to_cart",
      confirmation: "NOPE" as typeof COLLECTION_WANT_CONFIRMATION }, NOW), /Confirm wanting every item/);
    assert.throws(() => control.saveCollectionWant({ contractVersion: 1, variantId: entryId, mode: "buy" as CollectionWantMode,
      confirmation: COLLECTION_WANT_CONFIRMATION }, NOW), /Choose Add to cart or Alert me/);
    assert.throws(() => wantEntry(control, items(db, entryId)[0]!.id, "notify", NOW), { code: "collection_not_found" });
    assert.throws(() => control.collectionWantPreview("variant_missing", NOW), { code: "collection_not_found" });
  } finally {
    db.close();
  }
});

test("a call for a brand-new item of a wanted entry wants it at the call's price and queues the cart add", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const control = new ControlRepository(db);
    const entryId = catalog.upsertTrackalackerItem(needoh([searchLink], NOW - DAY), NOW - DAY).variantId;
    wantEntry(control, entryId, "add_to_cart", NOW - DAY);
    control.setActionsPaused(false, "Test enabled actions");
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0 WHERE user_id = ?", LOCAL_USER_ID);
    db.run(
      `INSERT INTO retailer_adapter_qualifications(
         tenant_id, user_id, retailer_id, adapter_version, highest_action, status, evidence_hash, qualified_at, updated_at
       ) VALUES (?, ?, 'target', ?, 'add_to_cart', 'qualified', 'all-new-target-evidence', ?, ?)`,
      LOCAL_TENANT_ID, LOCAL_USER_ID, TARGET_ADD_ADAPTER_VERSION, new Date(NOW).toISOString(), new Date(NOW).toISOString()
    );
    const result = new SignalEngine(db).process({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      externalEventId: "all-new-needoh-gumdrop-call",
      eventType: "restock",
      observedAt: new Date(NOW - 1_000).toISOString(),
      identity: {
        sourceProductId: "tl-all-new-needoh",
        sourceListingId: "needoh-target-gumdrop",
        retailerId: "target",
        retailerSku: "95123456",
        canonicalUrl: "https://www.target.com/p/needoh-gumdrop/-/A-95123456",
        title: "All New Needoh"
      },
      offer: { availability: "in_stock", unitPriceCents: 799, currency: "USD", sellerName: "", sellerType: "unknown", fulfillment: "unknown" },
      evidence: { headline: "All New Needoh is in stock at Target", body: "$7.99", msrpStatus: "unknown" },
      parserVersion: "trackalacker-push-v1"
    }, NOW);
    assert.deepEqual(items(db, entryId).map((item) => [item.title, item.sku]), [["Needoh Gumdrop", "95123456"]]);
    assert.deepEqual(plans(db), [{ title: "Needoh Gumdrop", origin: COLLECTION_WANT_ORIGIN, status: "active", mode: "add_to_cart", cap: 799 }]);
    assert.equal(result.actionJobState, "awaiting_executor", JSON.stringify(result));
  } finally {
    db.close();
  }
});

test("the shopper routes preview, want and stop an entry, and a catalog sync wants its new items", async () => {
  const db = new YoinkDatabase();
  const catalog = new CatalogRepository(db);
  const now = Date.now();
  const entryId = catalog.upsertTrackalackerItem(needoh([COUNTDOWN], now - DAY), now - DAY).variantId;
  const devices = new DeviceRepository(db);
  const paired = devices.pair({ pairingCode: devices.createPairingCode().code, name: "Desktop - Windows - Chrome" });
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "all-new-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const route = `${root}/api/v1/user/collections/want`;
  try {
    for (const [method, permission] of [["GET", "user.read"], ["POST", "user.intent.manage"], ["DELETE", "user.intent.manage"]]) {
      const policy = resolveApiRoutePolicy(method!, "/api/v1/user/collections/want");
      assert.deepEqual([policy?.pathname, policy?.surface, policy?.permission], ["/api/v1/user/collections/want", "user", permission]);
    }

    const preview = await fetch(`${route}?variantId=${encodeURIComponent(entryId)}`);
    assert.equal(preview.status, 200);
    const { collection: before } = await preview.json() as { collection: Record<string, any> };
    assert.deepEqual([before.title, before.wanted, before.items.length], ["All New Needoh", false, 1]);

    const saved = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractVersion: 1, variantId: entryId, mode: "add_to_cart", confirmation: COLLECTION_WANT_CONFIRMATION }) });
    assert.equal(saved.status, 200, await saved.clone().text());
    const { collection } = await saved.json() as { collection: Record<string, any> };
    assert.deepEqual(collection.wanted.map((item: { title: string; maxUnitPriceCents: number }) => [item.title, item.maxUnitPriceCents]),
      [["NeeDoh Halloween Countdown", 1297]]);

    // The companion's next sync brings a new item; it is wanted as it is filed.
    const sync = await fetch(`${root}/api/v1/devices/self/sources/trackalacker/catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: `chrome-extension://${"a".repeat(32)}`, Authorization: `Bearer ${paired.token}` },
      body: JSON.stringify({ item: needoh([COUNTDOWN, TEENIE], Date.now()) })
    });
    assert.equal(sync.status, 202, await sync.clone().text());
    assert.deepEqual(plans(db).map((plan) => [plan.title, plan.origin, plan.cap]), [
      ["NeeDoh Halloween Countdown", COLLECTION_WANT_ORIGIN, 1297],
      ["Schylling NeeDoh Teenie Color Change", COLLECTION_WANT_ORIGIN, 597]
    ]);

    const library = await fetch(`${root}/api/v1/user/library/products?q=needoh`).then((response) => response.json()) as { items: Array<Record<string, any>> };
    assert.deepEqual(library.items.find((item) => item.variantId === entryId)?.collection, { itemCount: 2, wanted: true, mode: "add_to_cart" });

    const stop = await fetch(`${route}?variantId=${encodeURIComponent(entryId)}`, { method: "DELETE", headers: { "X-Yoink-Request": "1" } });
    assert.equal(stop.status, 200);
    assert.equal((await stop.json() as { collection: { stopped: number } }).collection.stopped, 2);
    assert.equal(plans(db).filter((plan) => plan.status !== "deleted").length, 0);

    const notEntry = await fetch(`${route}?variantId=${encodeURIComponent(items(db, entryId)[0]!.id)}`);
    assert.equal(notEntry.status, 404);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
    db.close();
  }
});
