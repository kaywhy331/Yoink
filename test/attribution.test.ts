import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AttributionPolicyUpdateInput } from "../packages/contracts/src/index.js";
import { AttributionRepository } from "../packages/database/src/attribution-repository.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { seedLegacyStrategyPlan } from "./helpers/legacy-strategy-plan.js";
import { exactRetailerProductLink } from "../packages/domain/src/attribution.js";

test("exact retailer product links bind all supported stores and reject non-product pages", () => {
  const fixtures = [
    ["https://www.target.com/p/example/-/A-95280894?preselect=95280894", "target", "95280894", "https://www.target.com/p/-/A-95280894"],
    ["https://www.walmart.com/ip/example/20009805270?conditionGroupCode=4", "walmart", "20009805270", "https://www.walmart.com/ip/20009805270"],
    ["https://www.amazon.com/Card-Game/dp/B0DCGQ6CJD/ref=tracking", "amazon", "B0DCGQ6CJD", "https://www.amazon.com/dp/B0DCGQ6CJD"],
    ["https://www.bestbuy.com/product/example/J79X4PXVR7/sku/6528565?ref=tracking", "bestbuy", "6528565", "https://www.bestbuy.com/site/-/6528565.p"],
    ["https://www.disneystore.com/dumbo-jeweled-figurine-409914998395.html?CMP=tracking", "disney", "409914998395", "https://www.disneystore.com/dumbo-jeweled-figurine-409914998395.html"],
    ["https://www.ravensburger.us/en-US/products/games/family-games/oh-my-pigeons-22893?tracking=1", "ravensburger", "22893", "https://www.ravensburger.us/en-US/products/games/family-games/oh-my-pigeons-22893"],
    ["https://merch.riotgames.com/en-us/product/riftbound-unleashed-vault/?tracking=1", "riot", "RIFTBOUND-UNLEASHED-VAULT", "https://merch.riotgames.com/en-us/product/riftbound-unleashed-vault/"],
    ["https://www.booksamillion.com/p/-/F019649505470?tracking=1", "booksamillion", "F019649505470", "https://www.booksamillion.com/p/-/F019649505470"],
    ["https://www.fanatics.com/marvel/cards/example/o-1+t-2+p-350174258+z-9-3?_ref=tracking", "fanatics", "350174258", "https://www.fanatics.com/marvel/cards/example/o-1+t-2+p-350174258+z-9-3"],
    ["https://www.kohls.com/product/prd-3384298/mojo-backpack.jsp?tracking=1", "kohls", "3384298", "https://www.kohls.com/product/prd-3384298/mojo-backpack.jsp"],
    ["https://www.macys.com/shop/product/example?ID=16569610&utm_source=test", "macys", "16569610", "https://www.macys.com/shop/product/example?ID=16569610"],
    ["https://p-bandai.com/us/item/N2884150001?tracking=1", "pbandai", "N2884150001", "https://p-bandai.com/us/item/N2884150001"],
    ["https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-binder?tracking=1", "pokemoncenter", "10-10320-101", "https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-binder"]
  ] as const;
  for (const [url, retailerId, retailerSku, canonicalUrl] of fixtures) {
    assert.deepEqual(exactRetailerProductLink(url), { retailerId, retailerSku, canonicalUrl });
  }
  for (const invalid of [
    "http://www.amazon.com/dp/B0DCGQ6CJD",
    "https://user:secret@www.amazon.com/dp/B0DCGQ6CJD",
    "https://www.amazon.com/s?k=cards",
    "https://www.walmart.com/shop/collectibles/draw",
    "https://www.pokemoncenter.com/category/trading-card-game",
    "https://www.disneystore.com/",
    "https://www.amazon.com.evil.example/dp/B0DCGQ6CJD"
  ]) {
    assert.equal(exactRetailerProductLink(invalid), null);
  }
});

function configuredPolicies(): AttributionPolicyUpdateInput[] {
  return [
    {
      retailerId: "target", enabled: true, provider: "howl" as const,
      publisherSlug: "collectwithdodo", articleBaseUrl: "https://example.test/products/", associateTag: ""
    },
    {
      retailerId: "walmart", enabled: false, provider: "howl" as const,
      publisherSlug: "collectwithdodo", articleBaseUrl: "", associateTag: ""
    },
    {
      retailerId: "amazon", enabled: true, provider: "amazon_associates" as const,
      publisherSlug: "", articleBaseUrl: "", associateTag: "pokemon-restocks-20"
    },
    {
      retailerId: "bestbuy", enabled: false, provider: "howl" as const,
      publisherSlug: "collectwithdodo", articleBaseUrl: "", associateTag: ""
    },
    ...["disney", "ravensburger", "riot", "booksamillion", "fanatics", "kohls", "macys", "pbandai", "pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"].map((retailerId) => ({
      retailerId, enabled: false, provider: "canonical" as const,
      publisherSlug: "", articleBaseUrl: "", associateTag: ""
    }))
  ];
}

test("Howl and Amazon affiliate routes are deterministic, exact, and credential-free", () => {
  const db = new YoinkDatabase();
  try {
    const attribution = new AttributionRepository(db);
    const policies = attribution.replacePolicies(configuredPolicies());
    assert.equal(policies.length, 20);
    assert.equal(policies.find((policy) => policy.retailerId === "target")?.valid, true);
    const target = {
      id: "listing_target",
      variantId: "variant_target",
      title: "Pokémon TCG: Pitch Black Booster Bundle",
      retailerId: "target",
      retailerSku: "1011483414",
      canonicalUrl: "https://www.target.com/p/-/A-1011483414",
      executionSupported: true,
      msrpCents: 3999,
      currency: "USD"
    };
    const howl = attribution.plan(target, target.title, "prefer_fallback");
    assert.equal(howl.provider, "howl");
    assert.equal(howl.outcome, "affiliate_route");
    const howlUrl = new URL(howl.routeUrl);
    assert.equal(howlUrl.origin, "https://howl.link");
    assert.equal(howlUrl.searchParams.get("url"), target.canonicalUrl);
    assert.equal(howlUrl.searchParams.get("publisher_slug"), "collectwithdodo");
    assert.equal(howlUrl.searchParams.get("article_name"), target.title);
    assert.equal(howlUrl.searchParams.get("article_url"), "https://example.test/products/pokemon-tcg-pitch-black-booster-bundle");
    assert.equal(howl.routeUrl.includes("@"), false);

    // Howl ClickMate without an article site (Kevin, 2026-10-13): the product page is also the article URL.
    const [, walmartPolicy] = attribution.replacePolicies(configuredPolicies().map((policy) =>
      policy.retailerId === "walmart" ? { ...policy, enabled: true } : policy)).filter((policy) => ["target", "walmart"].includes(policy.retailerId));
    assert.equal(walmartPolicy?.valid, true, walmartPolicy?.validationReason);
    const walmart = attribution.plan({ ...target, id: "listing_walmart", retailerId: "walmart", retailerSku: "17000001",
      canonicalUrl: "https://www.walmart.com/ip/17000001" }, "Ascended Heroes ETB", "prefer_fallback");
    assert.equal(walmart.provider, "howl");
    const walmartRoute = new URL(walmart.routeUrl);
    assert.equal(walmartRoute.searchParams.get("url"), "https://www.walmart.com/ip/17000001");
    assert.equal(walmartRoute.searchParams.get("article_url"), "https://www.walmart.com/ip/17000001");
    assert.equal(walmartRoute.searchParams.get("article_name"), "Ascended Heroes ETB");

    const amazon = attribution.plan({
      ...target,
      id: "listing_amazon",
      retailerId: "amazon",
      retailerSku: "B0GYTRYV7P",
      canonicalUrl: "https://www.amazon.com/dp/B0GYTRYV7P"
    }, "Amazon Fixture", "prefer_fallback");
    assert.equal(amazon.provider, "amazon_associates");
    assert.equal(new URL(amazon.routeUrl).searchParams.get("tag"), "pokemon-restocks-20");
    assert.deepEqual(amazon.metadata, { associateTag: "pokemon-restocks-20" });

    const disney = attribution.plan({
      ...target,
      id: "listing_disney",
      retailerId: "disney",
      retailerSku: "409914998395",
      canonicalUrl: "https://www.disneystore.com/dumbo-jeweled-figurine-409914998395.html?CMP=discard"
    }, "Disney Fixture", "prefer_fallback");
    assert.equal(disney.provider, "canonical");
    assert.equal(disney.routeUrl, "https://www.disneystore.com/dumbo-jeweled-figurine-409914998395.html");
    assert.throws(() => attribution.plan({
      ...target,
      id: "listing_disney_spoofed",
      retailerId: "disney",
      retailerSku: "409914998395",
      canonicalUrl: "https://www.disneystore.com/search?q=409914998395"
    }, "Spoofed Disney Fixture", "prefer_fallback"), /exact canonical retailer URL/);

    const fanatics = attribution.plan({
      ...target,
      id: "listing_fanatics",
      retailerId: "fanatics",
      retailerSku: "350174258",
      canonicalUrl: "https://www.fanatics.com/marvel/cards/example/o-1+t-2+p-350174258+z-9-3?_ref=discard"
    }, "Fanatics Fixture", "prefer_fallback");
    assert.equal(fanatics.routeUrl, "https://www.fanatics.com/marvel/cards/example/o-1+t-2+p-350174258+z-9-3");
    assert.throws(() => attribution.plan({
      ...target,
      id: "listing_fanatics_spoofed",
      retailerId: "fanatics",
      retailerSku: "350174258",
      canonicalUrl: "https://www.fanatics.com/search?sku=350174258"
    }, "Spoofed Fanatics Fixture", "prefer_fallback"), /exact canonical retailer URL/);
  } finally {
    db.close();
  }
});

test("required attribution fails closed to notification instead of browser mutation", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "attribution-product",
      sourceListingId: "attribution-listing",
      title: "Required Attribution Fixture",
      retailerId: "target",
      retailerSku: "95280894",
      canonicalUrl: "https://www.target.com/p/-/A-95280894",
      listingStatus: "out_of_stock",
      executionSupported: true,
      msrpCents: 4499
    });
    const control = new ControlRepository(db);
    control.replaceStrategies([{
      id: "strategy_required_affiliate",
      name: "Required affiliate purchase",
      enabled: true,
      position: 1,
      revision: 1,
      sources: [],
      retailers: ["target"],
      pricePolicy: { kind: "at_or_below_msrp" },
      sellerPolicy: "first_party_only",
      allowedSellers: [],
      includeKeywords: "",
      excludeKeywords: "",
      action: "add_to_cart",
      quantity: 1,
      fulfillment: "shipping",
      maxSignalAgeSeconds: 120
    }]);
    // Trusted calls now start notify-only; the cart strategy needs a legacy plan.
    seedLegacyStrategyPlan(db, { retailerId: "target", retailerSku: "95280894" });
    // Howl is on for Target by default (1.30.40); with it off, a required route is unavailable.
    db.run("UPDATE attribution_policies SET enabled = 0 WHERE retailer_id = 'target'");
    const current = control.settings();
    control.updateSettings({
      dedupeWindowSeconds: current.dedupeWindowSeconds,
      affiliateMode: "require",
      taxBps: current.taxBps,
      storeAllowancesCents: current.storeAllowancesCents
    });
    control.setActionsPaused(false, "Attribution test enables strategy evaluation.");
    const result = new SignalEngine(db).process({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      externalEventId: "required-affiliate-event",
      eventType: "restock",
      observedAt: new Date().toISOString(),
      identity: {
        sourceProductId: "attribution-product",
        sourceListingId: "attribution-listing",
        retailerId: "target",
        retailerSku: "95280894",
        title: "Required Attribution Fixture"
      },
      offer: {
        availability: "in_stock",
        unitPriceCents: 4499,
        currency: "USD",
        sellerName: "Target",
        sellerType: "first_party",
        fulfillment: "shipping"
      }
    });
    assert.equal(result.decision, "affiliate_route_unavailable");
    assert.equal(result.actionJobState, "notify_only");
    const job = db.get<{ action: string; attribution_url: string; attribution_provider: string }>(
      "SELECT action, attribution_url, attribution_provider FROM action_jobs WHERE id = ?",
      result.actionJobId
    );
    assert.equal(job?.action, "notify");
    assert.equal(job?.attribution_url, "https://www.target.com/p/-/A-95280894");
    assert.equal(job?.attribution_provider, "canonical");
    assert.equal(db.get<{ outcome: string }>("SELECT outcome FROM attribution_receipts WHERE job_id = ?", result.actionJobId)?.outcome, "required_route_unavailable");
    const attribution = new AttributionRepository(db);
    assert.equal(attribution.listReceipts(10, 0, "required attribution").length, 1);
    assert.equal(attribution.listReceipts(10, 1).length, 0);
    assert.equal(attribution.receiptCount("required_route_unavailable"), 1);
    assert.equal(attribution.receiptCount("howl_enabled"), 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM notification_deliveries")?.count, 1);
  } finally {
    db.close();
  }
});

test("enabled policies reject untrusted article URLs and invalid provider-retailer combinations", () => {
  const db = new YoinkDatabase();
  try {
    const attribution = new AttributionRepository(db);
    const policies = configuredPolicies();
    policies[0] = { ...policies[0]!, articleBaseUrl: "http://insecure.example/products/" };
    assert.throws(() => attribution.replacePolicies(policies), /credential-free HTTPS/);
    const mismatched = configuredPolicies();
    mismatched[0] = { ...mismatched[0]!, provider: "amazon_associates", associateTag: "tag-20" };
    assert.throws(() => attribution.replacePolicies(mismatched), /valid only for Amazon/);
    const unlistedHowlStore = configuredPolicies();
    unlistedHowlStore[3] = {
      ...unlistedHowlStore[3]!, enabled: true, provider: "howl",
      publisherSlug: "collectwithdodo", articleBaseUrl: "https://example.test/products/"
    };
    assert.throws(() => attribution.replacePolicies(unlistedHowlStore), /Howl is not available for this store/);
  } finally {
    db.close();
  }
});

test("a new install's Amazon tag is an empty placeholder, and the old seeded tag is cleared where Amazon was never switched on", () => {
  const db = new YoinkDatabase();
  try {
    const tag = () => db.get<{ tag: string }>("SELECT associate_tag AS tag FROM attribution_policies WHERE id = 'attribution_amazon_local'")?.tag;
    assert.equal(tag(), "");
    assert.equal(db.get<{ tag: string }>("SELECT associate_tag AS tag FROM attribution_policies WHERE id = 'attribution_walmart_local'")?.tag, "");
  } finally {
    db.close();
  }
});

test("Howl is on by default for every store Howl covers, under the shopper's publisher slug (Kevin, 2026-10-13)", () => {
  const db = new YoinkDatabase();
  try {
    const policies = new AttributionRepository(db).listPolicies();
    const on = policies.filter((policy) => policy.enabled).map((policy) => `${policy.retailerId}:${policy.provider}:${policy.publisherSlug}`).sort();
    assert.deepEqual(on, ["americaneagle", "aninebing", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory",
      "fanatics", "kohls", "macys", "target", "walmart"].map((id) => `${id}:howl:collectwithdodo`));
    assert.ok(policies.filter((policy) => policy.enabled).every((policy) => policy.valid), "an empty article URL is valid");
    const amazon = policies.find((policy) => policy.retailerId === "amazon");
    assert.deepEqual([amazon?.enabled, amazon?.associateTag], [false, ""]);
  } finally {
    db.close();
  }
});

test("an install that had Howl off gets it on when it updates; Amazon's old seeded tag is cleared", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-howl-upgrade-"));
  const path = join(directory, "yoink.sqlite");
  try {
    // An install from before 1.30.40: policies as seeded then (all off, the Amazon tag set).
    const before = new YoinkDatabase(path);
    before.run("UPDATE attribution_policies SET enabled = 0");
    before.run("UPDATE attribution_policies SET provider = 'canonical', publisher_slug = '' WHERE retailer_id IN ('aninebing', 'kohls')");
    before.run("UPDATE attribution_policies SET associate_tag = 'pokemon-restocks-20' WHERE retailer_id = 'amazon'");
    before.run("DELETE FROM schema_migrations WHERE version = 81");
    before.close();
    const after = new YoinkDatabase(path);
    try {
      const policy = (retailerId: string) => after.get<{ enabled: number; provider: string; slug: string; tag: string }>(
        "SELECT enabled, provider, publisher_slug AS slug, associate_tag AS tag FROM attribution_policies WHERE retailer_id = ?", retailerId);
      assert.deepEqual({ ...policy("target") }, { enabled: 1, provider: "howl", slug: "collectwithdodo", tag: "" });
      assert.deepEqual({ ...policy("walmart") }, { enabled: 1, provider: "howl", slug: "collectwithdodo", tag: "" });
      assert.deepEqual({ ...policy("aninebing") }, { enabled: 1, provider: "howl", slug: "collectwithdodo", tag: "" });
      assert.deepEqual({ ...policy("bestbuy") }, { enabled: 0, provider: "canonical", slug: "", tag: "" }, "Howl doesn't cover Best Buy");
      assert.deepEqual({ ...policy("amazon") }, { enabled: 0, provider: "amazon_associates", slug: "", tag: "" });
    } finally {
      after.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
