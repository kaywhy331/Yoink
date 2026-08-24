import assert from "node:assert/strict";
import test from "node:test";
import type { AttributionPolicyUpdateInput } from "../packages/contracts/src/index.js";
import { AttributionRepository } from "../packages/database/src/attribution-repository.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";

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
    ...["disney", "ravensburger", "riot", "booksamillion", "fanatics", "kohls", "macys", "pbandai", "pokemoncenter"].map((retailerId) => ({
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
    assert.equal(policies.length, 13);
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
  } finally {
    db.close();
  }
});
